import { PuzzleSession, planMove, status } from './model.js?v=0.6.0';
import { LEVELS, COLORS } from './levels.js?v=0.6.0';
import { SortFeedback } from './feedback.js?v=0.6.0';

const ui = Object.fromEntries(['level-label', 'level-name', 'moves', 'levels', 'tip', 'progress',
  'color-progress', 'status-panel', 'next', 'message', 'undo', 'restart', 'sound', 'menu',
  'level-dialog', 'close-menu', 'motion', 'motion-note', 'victory', 'victory-title', 'victory-detail', 'candy-box'].map(id => [id, document.getElementById(id)]));
// Phaser 4.2.1 has no GameConfig.resolution: render a denser canvas, keep logical coordinates.
const renderDensity = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const idleMessage = 'Удерживай стопку, чтобы увидеть маршрут.';
const reasons = {
  empty: 'Нажми на стопку с конфетами, чтобы выбрать верхний цвет.',
  'no-space': 'Нужен пустой контейнер или одноцветный приёмник этого цвета.',
  covered: 'Остальные конфеты этого цвета спрятаны. Сначала открой их.'
};

function tubeLayout(count) {
  const columns = count <= 4 ? count : Math.ceil(count / 2);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, count - row * columns);
    return { x: (index % columns + .5) * (480 / inRow), top: count <= 4 ? 144 : 56 + row * 252, scale: count <= 4 ? 1.25 : 1 };
  });
}
function receivers(state) {
  const result = {};
  state.tubes.forEach((tube, index) => {
    if (tube.length && tube.length < 4 && tube.every(color => color === tube[0]) && result[tube[0]] === undefined) {
      result[tube[0]] = index;
    }
  });
  return result;
}

class SortScene extends Phaser.Scene {
  constructor() { super('sort'); }
  init() {
    this.busy = false;
    this.boardObjects = [];
    this.balls = new Map();
    this.pressed = null;
    this.previewMove = null;
    this.audioPlays = { pickup: 0, complete: 0, land: 0, win: 0 };
    this.fillLabels = new Map();
    this.emptyLabels = new Map();
  }
  preload() {
    for (const { texture } of Object.values(COLORS)) if (texture) this.load.image(texture, `./assets/${texture}.png?v=0.6.0`);
    for (const key of ['pickup', 'complete', 'land', 'win']) this.load.audio(key, `./assets/${key}.wav?v=0.6.0`);
  }
  create() {
    this.cameras.main.setOrigin(0, 0).setZoom(renderDensity);
    this.markers = this.add.graphics().setDepth(5);
    this.feedback = new SortFeedback(this);
    let motion = 'auto';
    try { motion = localStorage.getItem('magnetic-sort-motion') || 'auto'; } catch { /* Optional preference. */ }
    this.setMotion(motion);
    ui.motion.addEventListener('change', () => this.setMotion(ui.motion.value));
    motionQuery.addEventListener('change', () => this.setMotion(this.motionPreference));
    this.sfx = Object.fromEntries(['pickup', 'complete', 'land', 'win'].map(key => {
      const sound = this.sound.add(key);
      sound.on('play', () => { this.audioPlays[key]++; });
      return [key, sound];
    }));
    let muted = false;
    try { muted = localStorage.getItem('magnetic-sort-muted') === 'true'; } catch { /* Storage is optional. */ }
    this.setMuted(muted);
    ui.sound.addEventListener('click', () => this.setMuted(!this.muted));
    const closeMenu = () => {
      ui['level-dialog'].close();
      // The dialog's close event is queued; the visible board must be ready immediately.
      this.input.enabled = true;
    };
    for (let index = 0; index < LEVELS.length; index++) {
      const button = document.createElement('button');
      button.textContent = `${index + 1}. ${LEVELS[index].name}`;
      button.addEventListener('click', () => { this.openLevel(index); closeMenu(); });
      ui.levels.append(button);
    }
    ui.menu.addEventListener('click', () => {
      if (this.busy) return;
      this.pressed = null;
      this.clearPreview();
      this.input.enabled = false;
      ui['level-dialog'].showModal();
    });
    ui['close-menu'].addEventListener('click', closeMenu);
    ui['level-dialog'].addEventListener('close', () => { this.input.enabled = true; });
    ui.undo.addEventListener('click', () => this.undo());
    ui.restart.addEventListener('click', () => this.restart());
    ui.next.addEventListener('click', () => this.openLevel((this.levelIndex + 1) % LEVELS.length));
    this.input.keyboard.on('keydown', event => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || ui['level-dialog'].open) return;
      if (/^[1-6]$/.test(event.key)) this.choose(Number(event.key) - 1);
      if (event.code === 'KeyZ') this.undo();
      if (event.code === 'KeyR') this.restart();
    });
    this.input.on('pointerup', pointer => {
      if (this.pressed?.id === pointer.id) this.pressed = null;
      if (pointer.wasTouch && !this.busy) this.clearPreview(false);
    });
    this.input.on('pointerupoutside', pointer => {
      if (this.pressed?.id === pointer.id) this.pressed = null;
      if (!this.busy) this.clearPreview();
    });
    this.input.on('gameout', () => { this.pressed = null; if (!this.busy) this.clearPreview(); });
    this.createInputZones();
    this.scale.on('resize', () => {
      if (!this.busy) { this.pressed = null; this.drawBoard(); }
    });
    this.openLevel(0);
    // FIT must also react when DOM text or screen orientation changes the parent.
    this.resizeObserver = new ResizeObserver(() => this.fitBoard());
    this.resizeObserver.observe(document.getElementById('game'));

    // Read-only diagnostics, available only to local QA. No game-state setters.
    if (new URLSearchParams(location.search).has('qa')) {
      window.__sortQA = { snapshot: () => ({
        version: '0.6.0', state: structuredClone(this.session.state), busy: this.busy, level: this.levelIndex,
        inputEnabled: this.input.enabled,
        status: status(this.session.state), history: this.session.history.length,
        renderer: this.game.renderer.type, receivers: receivers(this.session.state),
        preview: this.previewMove ? { ...this.previewMove } : null,
        motion: { preference: this.motionPreference, effective: this.gentleMotion ? 'gentle' : 'full', systemReduced: motionQuery.matches },
        feedback: { phase: this.feedback.phase, effects: this.feedback.effects.size, tokens: this.feedback.tokens.size, lastDuration: this.feedback.lastDuration },
        camera: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY },
        effects: [...this.feedback.effects].map(effect => ({ name: effect.name, x: effect.x, y: effect.y, alpha: effect.alpha, scaleX: effect.scaleX })),
        balls: [...this.balls].map(([id, ball]) => ({ id, x: ball.x, y: ball.y, scaleX: ball.scaleX, scaleY: ball.scaleY, alpha: ball.alpha })),
        audio: { muted: this.muted, engineMuted: this.sound.mute, plays: { ...this.audioPlays },
          decoded: ['pickup', 'complete', 'land', 'win'].every(key => this.cache.audio.exists(key)),
          context: this.sound.context?.state ?? 'html5' },
        centers: this.layout.map(({ x, top, scale }) => ({ x, y: top + 80 * scale })),
        presentation: { density: renderDensity, canvas: [this.game.canvas.width, this.game.canvas.height],
          tubeScale: this.layout[0].scale, victoryVisible: !ui.victory.hidden }
      }) };
    }
    document.body.dataset.ready = 'true';
  }
  setMuted(muted) {
    // Keep the user's preference separate from the gain node while audio is locked.
    this.muted = muted;
    this.sound.setMute(muted);
    ui.sound.textContent = muted ? 'Звук: выкл' : 'Звук: вкл';
    ui.sound.setAttribute('aria-pressed', String(muted));
    ui.sound.setAttribute('aria-label', muted ? 'Включить звук' : 'Выключить звук');
    ui.sound.title = ui.sound.getAttribute('aria-label');
    try { localStorage.setItem('magnetic-sort-muted', String(muted)); } catch { /* Optional preference. */ }
  }
  setMotion(preference) {
    this.motionPreference = ['auto', 'full', 'gentle'].includes(preference) ? preference : 'auto';
    this.gentleMotion = this.motionPreference === 'gentle' || (this.motionPreference === 'auto' && motionQuery.matches);
    document.body.dataset.motion = this.gentleMotion ? 'gentle' : 'full';
    ui.motion.value = this.motionPreference;
    ui['motion-note'].textContent = this.gentleMotion ? 'Мягкие переходы, без полётов и искр.' : 'Полёты конфет, пружинящие посадки и искры.';
    try { localStorage.setItem('magnetic-sort-motion', this.motionPreference); } catch { /* Optional preference. */ }
  }
  playSound(key, config) { if (!this.muted) this.sfx[key].play(config); }
  openLevel(index) {
    if (this.busy) return;
    this.feedback.reset();
    this.levelIndex = index;
    this.session = new PuzzleSession(LEVELS[index].tubes);
    this.layout = tubeLayout(this.session.state.tubes.length);
    this.pressed = null;
    this.drawBoard();
    this.refresh();
    this.say('Собери по четыре одинаковых и очисти поле.');
  }
  own(object) { this.boardObjects.push(object); return object; }
  text(x, y, value, size = 14, color = '#74677d') {
    const readableSize = Math.max(size, 10 / (this.scale.displaySize.width / 480));
    return this.own(this.add.text(x, y, value, { fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: `${readableSize}px`, color }).setResolution(renderDensity).setOrigin(.5));
  }
  position(index, slot) { const { x, top, scale } = this.layout[index]; return { x, y: top + (140 - slot * 36) * scale }; }
  drawBoard() {
    this.feedback.releasePress();
    this.markers.clear();
    this.previewMove = null;
    this.boardObjects.forEach(object => object.destroy());
    this.boardObjects = [];
    this.balls.clear();
    this.fillLabels.clear();
    this.emptyLabels.clear();
    this.zones.forEach((zone, index) => {
      const layout = this.layout[index];
      zone.setVisible(Boolean(layout));
      if (layout && status(this.session.state) !== 'won') {
        zone.setPosition(layout.x, layout.top + 81 * layout.scale).setScale(layout.scale);
        zone.setInteractive();
      }
      else zone.disableInteractive();
    });
    const state = this.session.state;
    const targets = receivers(state);
    const background = this.own(this.add.graphics());
    // Quiet confectionery tray: the candies carry the strongest contrast.
    background.fillStyle(0xfff8ef).fillRoundedRect(0, 0, 480, 520, 24);
    if (status(state) === 'won') return;
    for (const [x, y, angle] of [[28, 102, -.5], [438, 142, .4], [38, 444, .5], [450, 392, -.5]]) {
      background.lineStyle(4, 0xe9d9db, .65).lineBetween(x, y, x + 7, y + angle * 10);
    }
    for (const [index, tube] of state.tubes.entries()) {
      const { x, top, scale: s } = this.layout[index];
      const receiver = tube.length && targets[tube[0]] === index;
      const tint = receiver ? COLORS[tube[0]].fill : 0x9e82b2;
      background.save().translateCanvas(x, top).scaleCanvas(s, s);
      background.fillStyle(0x8e6b96, .16).fillEllipse(2, 175, 80, 16);
      background.fillStyle(0xffffff, .8).fillRoundedRect(-38, -14, 76, 184, 22);
      background.fillStyle(receiver ? tint : 0xe9dff3, receiver ? .09 : .28).fillRoundedRect(-34, -10, 68, 177, 19);
      background.lineStyle(2.5, tint, .95).strokeRoundedRect(-38, -14, 76, 184, 22);
      background.lineStyle(3, 0xffffff, .95).lineBetween(-31, 9, -31, 134);
      background.lineStyle(1.5, 0xffffff, .9).lineBetween(30, 20, 30, 123);
      background.fillStyle(0xffffff, .85).fillEllipse(0, -14, 74, 12);
      background.lineStyle(2.5, tint, .95).strokeEllipse(0, -14, 74, 12);
      background.lineStyle(2, 0xffffff, .95).lineBetween(-23, -18, 17, -18);
      background.lineStyle(3, 0xffffff, .8).lineBetween(-18, 163, 18, 163);
      if (receiver) {
        // Large U-shaped magnet. The dedicated lesson explains the symbol.
        background.lineStyle(5, tint).beginPath().moveTo(-12, -46)
          .lineTo(-12, -29).lineTo(12, -29).lineTo(12, -46).strokePath();
        background.lineStyle(5, 0x655170).lineBetween(-12, -46, -12, -41)
          .lineBetween(12, -46, 12, -41);
      }
      background.fillStyle(0xffffff, .85).fillRoundedRect(-36, 178, 72, 26, 13);
      background.restore();
      this.fillLabels.set(index, this.text(x, top + 191 * s, `${index + 1}  ·  ${tube.length}/4`, 16 * s, receiver ? COLORS[tube[0]].ink : '#6d577c'));
      for (const [slot, color] of tube.entries()) {
        const point = this.position(index, slot);
        this.balls.set(`${index}:${slot}`, this.own(this.makeBall(point.x, point.y, color)));
      }
      if (tube.length) {
        const point = this.position(index, tube.length - 1);
        if (planMove(state, index).valid) {
          background.lineStyle(2, COLORS[tube.at(-1)].fill, .8).strokeCircle(point.x, point.y, 23 * s);
        } else {
          this.text(x + 28 * s, point.y - 9 * s, '×', 18 * s, '#79638a').setDepth(3);
        }
      }

    }
  }
  createInputZones() {
    this.zones = [];
    for (let index = 0; index < 6; index++) {
      const zone = this.add.zone(0, 0, 90, 198).setDepth(10).setInteractive({ useHandCursor: true });
      this.zones.push(zone);
      zone.on('pointerover', pointer => { if (!pointer.wasTouch) this.preview(index); });
      zone.on('pointerout', pointer => {
        if (this.pressed?.id === pointer.id) this.pressed = null;
        if (!this.busy) this.clearPreview();
      });
      zone.on('pointerdown', pointer => {
        if (this.busy || this.pressed || (!pointer.wasTouch && !pointer.leftButtonDown())) return;
        this.pressed = { index, id: pointer.id };
        this.preview(index);
        const move = planMove(this.session.state, index);
        if (move.valid) this.feedback.press(move);
      });
      zone.on('pointerup', pointer => {
        if (this.pressed?.index === index && this.pressed.id === pointer.id) {
          this.pressed = null;
          this.choose(index);
        }
      });
    }
  }
  makeBall(x, y, color) {
    const shadow = this.add.graphics();
    shadow.fillStyle(0x67516c, .14).fillEllipse(0, 7, 37, 30);
    const { texture } = COLORS[color];
    const candy = texture ? this.add.image(0, 0, texture).setDisplaySize(40, 40)
      : this.add.graphics().fillStyle(COLORS[color].fill).fillCircle(0, 0, 18);
    const ball = this.add.graphics();
    ball.lineStyle(2.3, 0x392442, .86);
    if (color === 'A') ball.strokeCircle(0, 0, 6);
    if (color === 'B') ball.strokeTriangle(0, -7, -7, 6, 7, 6);
    if (color === 'C') ball.strokeRect(-6, -6, 12, 12);
    if (color === 'D') ball.beginPath().moveTo(0, -8).lineTo(7, 0).lineTo(0, 8).lineTo(-7, 0).closePath().strokePath();
    if (color === 'E') ball.lineBetween(-7, 0, 7, 0).lineBetween(0, -7, 0, 7);
    if (color === 'F') ball.lineBetween(-7, -3, 7, -3).lineBetween(-7, 3, 7, 3);
    // Unit root scale keeps the existing press, flight and landing tweens intact.
    const visual = this.add.container(0, 0, [shadow, candy, ball]).setScale(this.layout[0].scale);
    return this.add.container(x, y, [visual]).setDepth(2);
  }
  fitBoard() {
    const rect = document.getElementById('game').getBoundingClientRect();
    const bounds = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
    if (bounds === this.boardBounds) return;
    this.boardBounds = bounds;
    // Update synchronously when the HUD changes; ResizeObserver follows a frame later.
    // Phaser 4.2.1 refresh() reads cached parentSize, so update its bounds first.
    this.scale.getParentBounds();
    this.scale.refresh();
  }
  say(message) { ui.message.textContent = message; this.fitBoard(); }
  clearPreview(resetMessage = true) {
    this.feedback.releasePress();
    this.markers.clear();
    this.previewMove = null;
    if (resetMessage && status(this.session.state) === 'playing') this.say(idleMessage);
  }
  preview(index) {
    if (this.busy || status(this.session.state) !== 'playing') return;
    const move = planMove(this.session.state, index);
    this.clearPreview(false);
    if (!move.valid) { this.say(reasons[move.reason]); return; }
    this.previewMove = { source: index, destination: move.destination, color: move.color };
    const destination = this.layout[move.destination];
    const s = destination.scale;
    const end = { x: destination.x, y: destination.top - 18 * s };
    const sourceIndices = [...new Set(move.transfers.map(transfer => transfer.from))];
    this.markers.lineStyle(2, COLORS[move.color].fill, .6);
    for (const source of sourceIndices) {
      const from = this.position(source, this.session.state.tubes[source].length - 1);
      const bendY = Math.min(from.y - 36, end.y - 30);
      this.markers.beginPath().moveTo(from.x, from.y - 24).lineTo(from.x, bendY)
        .lineTo(end.x, bendY).lineTo(end.x, end.y - 5).strokePath();
    }
    this.markers.fillStyle(COLORS[move.color].fill).fillTriangle(end.x, end.y, end.x - 6, end.y - 10, end.x + 6, end.y - 10);
    this.markers.lineStyle(3, COLORS[move.color].fill);
    for (const transfer of move.transfers) {
      const point = this.position(transfer.from, transfer.fromSlot);
      this.markers.strokeCircle(point.x, point.y, 21 * s);
    }
    this.markers.strokeRoundedRect(destination.x - 41 * s, destination.top - 17 * s, 82 * s, 190 * s, 20 * s);
    const total = this.session.state.tubes[move.destination].length + move.transfers.length;
    this.say(`В приёмник № ${move.destination + 1} → ${total}/4${move.dispatch ? ' · партия готова!' : ' · остальные пока спрятаны.'}`);
  }
  tween(targets, config) {
    return new Promise(resolve => this.tweens.add({ targets, ...config, onComplete: resolve }));
  }
  delay(duration) { return new Promise(resolve => this.time.delayedCall(duration, resolve)); }
  async choose(index) {
    if (this.busy || ui['level-dialog'].open || status(this.session.state) !== 'playing') return;
    const planned = planMove(this.session.state, index);
    if (!planned.valid) { this.feedback.reject(index); this.say(reasons[planned.reason]); return; }
    this.feedback.reset();
    this.feedback.gentle = this.gentleMotion;
    this.preview(index);
    this.busy = true;
    this.refresh();
    const counts = this.session.state.tubes.map(tube => tube.length);
    const move = this.session.move(index);
    const moving = await this.feedback.gather(move, counts);
    if (move.dispatch) await this.feedback.collect(move, moving);
    else this.feedback.rim(move.destination, COLORS[move.color].fill, true);
    this.feedback.finish();
    this.busy = false;
    this.drawBoard();
    this.refresh();
    if (move.dispatch) ui['color-progress'].querySelector(`[data-color="${move.color}"]`)?.classList.add('collect');
    if (status(this.session.state) === 'won') this.feedback.celebrate();
    if (status(this.session.state) === 'playing') {
      this.say(move.dispatch ? 'Партия собрана! Место освободилось.' : 'Группа ждёт в приёмнике. Открой остальные конфеты.');
    }
  }
  undo() {
    if (this.busy || !this.session.undo()) return;
    this.feedback.reset();
    this.pressed = null;
    this.drawBoard(); this.refresh(); this.say('Ход отменён. Попробуй другой цвет.');
  }
  restart() { if (!this.busy) this.openLevel(this.levelIndex); }
  tutorialText() {
    const level = LEVELS[this.levelIndex], state = this.session.state;
    if (status(state) === 'won') return 'Все цвета собраны. Можно продолжить или отменить последний ход.';
    if (!state.moves || this.busy) return level.tip;
    if (level.lesson === 'gather') return 'Теперь собери ○. Приёмник заберёт все открытые конфеты своего цвета.';
    if (level.lesson === 'partial') return state.cleared.length ? 'Приёмник отмечен магнитом. Нажми на оставшийся цвет.' : 'Открой спрятанные конфеты другим цветом. Неполная группа никуда не пропадёт.';
    if (level.lesson === 'receiver') return 'Одноцветный приёмник работает даже без пустых контейнеров. Собери оставшиеся конфеты.';
    if (level.lesson === 'space' && state.moves === 1 && state.tubes[3].join('') === 'AA') {
      return 'Сбор △ откроет □ в № 2 — новый приёмник. Сбор □ сейчас займёт последнее пустое место.';
    }
    if (level.lesson === 'space') return 'Ищи ход, который откроет одноцветный приёмник. Если упёрся в тупик, вернись на ход назад.';
    return level.tip;
  }
  refresh() {
    const state = this.session.state, result = status(state);
    const won = result === 'won' && !this.busy;
    document.querySelector('.game-shell').classList.toggle('is-won', won);
    ui.victory.hidden = !won;
    document.getElementById('game').setAttribute('aria-hidden', String(won));
    const colors = [...new Set(this.session.initial.tubes.flat())].sort();
    ui['level-label'].textContent = `УРОВЕНЬ ${this.levelIndex + 1} / ${LEVELS.length}`;
    ui['level-name'].textContent = LEVELS[this.levelIndex].name;
    ui.moves.textContent = state.moves;
    ui.tip.textContent = this.tutorialText();
    ui.progress.textContent = `${state.cleared.length} / ${colors.length}`;
    ui.undo.disabled = this.busy || this.session.history.length === 0;
    ui.restart.disabled = this.busy;
    ui.next.disabled = this.busy;
    ui.menu.disabled = this.busy;
    ui.undo.classList.toggle('rescue', !this.busy && result === 'stuck');
    [...ui.levels.children].forEach((button, index) => {
      if (index === this.levelIndex) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    ui['color-progress'].replaceChildren(...colors.map(color => {
      const chip = document.createElement('span'), done = state.cleared.includes(color);
      chip.className = `color-chip${done ? ' done' : ''}`;
      chip.dataset.color = color;
      chip.style.setProperty('--color', COLORS[color].css);
      chip.style.setProperty('--ink', COLORS[color].ink || '#493454');
      chip.textContent = done ? '✓' : COLORS[color].symbol;
      chip.title = `${COLORS[color].name}: ${done ? 'собрано' : 'на поле'}`;
      chip.setAttribute('aria-label', chip.title);
      return chip;
    }));
    ui['status-panel'].classList.toggle('stuck', !this.busy && result === 'stuck');
    ui['status-panel'].classList.toggle('won', !this.busy && result === 'won');
    ui.next.hidden = this.busy || result !== 'won';
    ui.restart.hidden = !this.busy && result === 'won';
    if (result === 'won' && !this.busy) {
      const finished = this.levelIndex === LEVELS.length - 1;
      ui.next.textContent = finished ? 'Ещё раз →' : 'Дальше →';
      ui['victory-title'].textContent = 'Готово!';
      const moves = state.moves, ending = moves % 10 === 1 && moves % 100 !== 11 ? 'ход' : moves % 10 >= 2 && moves % 10 <= 4 && !(moves % 100 >= 12 && moves % 100 <= 14) ? 'хода' : 'ходов';
      ui['victory-detail'].textContent = `За ${moves} ${ending}`;
      ui['candy-box'].replaceChildren(...colors.flatMap(color => Array.from({ length: 4 }, () => {
        const cell = document.createElement('span'), candy = document.createElement('img'), symbol = document.createElement('span');
        cell.className = 'gift-candy';
        candy.src = `./assets/${COLORS[color].texture}.png?v=0.6.0`;
        candy.alt = '';
        candy.width = candy.height = 96;
        symbol.textContent = COLORS[color].symbol;
        cell.append(candy, symbol);
        return cell;
      })));
      this.say('');
    }
    if (result === 'stuck' && !this.busy) {
      this.say('Нет места для сбора. Отмени ход и попробуй открыть приёмник.');
    }
    this.fitBoard();
  }
}

new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', width: 480 * renderDensity, height: 520 * renderDensity, backgroundColor: '#fff8ef',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: SortScene, input: { activePointers: 2 }, disableContextMenu: true,
  title: 'Magnetic Sort', version: '0.6.0'
});
