import { PuzzleSession, planMove, status } from './model.js';
import { LEVELS, COLORS } from './levels.js';

const ui = Object.fromEntries(['level-label', 'level-name', 'moves', 'levels', 'tip', 'progress',
  'color-progress', 'status-panel', 'next', 'message', 'undo', 'restart', 'sound', 'menu',
  'level-dialog', 'close-menu'].map(id => [id, document.getElementById(id)]));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const idleMessage = 'Удерживай стопку, чтобы увидеть маршрут.';
const reasons = {
  empty: 'Нажми на стопку с шарами, чтобы выбрать верхний цвет.',
  'no-space': 'Нужен пустой контейнер или одноцветный приёмник этого цвета.',
  covered: 'Остальные шары этого цвета спрятаны. Сначала открой их.'
};

function tubeLayout(count) {
  const columns = count <= 4 ? count : Math.ceil(count / 2);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, count - row * columns);
    return { x: (index % columns + .5) * (480 / inRow), top: count <= 4 ? 154 : 56 + row * 252 };
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
    this.audioPlays = { pickup: 0, complete: 0 };
  }
  preload() {
    this.load.audio('pickup', './assets/pickup.wav');
    this.load.audio('complete', './assets/complete.wav');
  }
  create() {
    this.markers = this.add.graphics().setDepth(5);
    this.sfx = Object.fromEntries(['pickup', 'complete'].map(key => {
      const sound = this.sound.add(key);
      sound.on('play', () => { this.audioPlays[key]++; });
      return [key, sound];
    }));
    let muted = false;
    try { muted = localStorage.getItem('magnetic-sort-muted') === 'true'; } catch { /* Storage is optional. */ }
    this.setMuted(muted);
    ui.sound.addEventListener('click', () => this.setMuted(!this.muted));
    for (let index = 0; index < LEVELS.length; index++) {
      const button = document.createElement('button');
      button.textContent = `${index + 1}. ${LEVELS[index].name}`;
      button.addEventListener('click', () => { this.openLevel(index); ui['level-dialog'].close(); });
      ui.levels.append(button);
    }
    ui.menu.addEventListener('click', () => {
      if (this.busy) return;
      this.pressed = null;
      this.clearPreview();
      this.input.enabled = false;
      ui['level-dialog'].showModal();
    });
    ui['close-menu'].addEventListener('click', () => ui['level-dialog'].close());
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
    this.openLevel(0);
    this.scale.on('resize', () => {
      if (!this.busy) { this.pressed = null; this.drawBoard(); }
    });
    // FIT must also react when DOM text or screen orientation changes the parent.
    this.resizeObserver = new ResizeObserver(() => this.scale.refresh());
    this.resizeObserver.observe(document.getElementById('game'));

    // Read-only diagnostics, available only to local QA. No game-state setters.
    if (new URLSearchParams(location.search).has('qa')) {
      window.__sortQA = { snapshot: () => ({
        state: structuredClone(this.session.state), busy: this.busy, level: this.levelIndex,
        status: status(this.session.state), history: this.session.history.length,
        renderer: this.game.renderer.type, receivers: receivers(this.session.state),
        preview: this.previewMove ? { ...this.previewMove } : null,
        audio: { muted: this.muted, engineMuted: this.sound.mute, plays: { ...this.audioPlays },
          decoded: ['pickup', 'complete'].every(key => this.cache.audio.exists(key)),
          context: this.sound.context?.state ?? 'html5' },
        centers: this.layout.map(({ x, top }) => ({ x, y: top + 80 }))
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
  playSound(key) { if (!this.muted) this.sfx[key].play(); }
  openLevel(index) {
    if (this.busy) return;
    this.levelIndex = index;
    this.session = new PuzzleSession(LEVELS[index].tubes);
    this.layout = tubeLayout(this.session.state.tubes.length);
    this.pressed = null;
    this.drawBoard();
    this.refresh();
    this.say('Собери по четыре одинаковых и очисти поле.');
  }
  own(object) { this.boardObjects.push(object); return object; }
  text(x, y, value, size = 14, color = '#9cacbf') {
    const readableSize = Math.max(size, 10 / (this.scale.displaySize.width / 480));
    return this.own(this.add.text(x, y, value, { fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: `${readableSize}px`, color }).setOrigin(.5));
  }
  position(index, slot) { const { x, top } = this.layout[index]; return { x, y: top + 140 - slot * 36 }; }
  drawBoard() {
    this.markers.clear();
    this.previewMove = null;
    this.boardObjects.forEach(object => object.destroy());
    this.boardObjects = [];
    this.balls.clear();
    this.zones.forEach((zone, index) => {
      const layout = this.layout[index];
      zone.setVisible(Boolean(layout));
      if (layout) { zone.setPosition(layout.x, layout.top + 81); zone.setInteractive(); }
      else zone.disableInteractive();
    });
    const state = this.session.state;
    const targets = receivers(state);
    const background = this.own(this.add.graphics());
    background.fillStyle(0x101c2d, .55).fillRoundedRect(0, 0, 480, 520, 18);
    for (const [index, tube] of state.tubes.entries()) {
      const { x, top } = this.layout[index];
      const receiver = tube.length && targets[tube[0]] === index;
      const tint = receiver ? COLORS[tube[0]].fill : 0x4d6580;
      background.fillStyle(0x24354b, .8).fillRoundedRect(x - 38, top - 14, 76, 184, 18);
      background.lineStyle(2, tint, .9).strokeRoundedRect(x - 38, top - 14, 76, 184, 18);
      background.lineStyle(4, receiver ? tint : 0x71879d).lineBetween(x - 23, top - 14, x + 23, top - 14);
      if (receiver) {
        // Large U-shaped magnet. The dedicated lesson explains the symbol.
        background.lineStyle(5, tint).beginPath().moveTo(x - 12, top - 46)
          .lineTo(x - 12, top - 29).lineTo(x + 12, top - 29).lineTo(x + 12, top - 46).strokePath();
        background.lineStyle(5, 0xeaf1fb).lineBetween(x - 12, top - 46, x - 12, top - 41)
          .lineBetween(x + 12, top - 46, x + 12, top - 41);
      }
      for (let slot = 0; slot < 4; slot++) {
        const point = this.position(index, slot);
        background.lineStyle(1, 0x425771, .5).strokeCircle(point.x, point.y, 18);
      }
      this.text(x, top + 191, `${index + 1}  ·  ${tube.length}/4`, 16, receiver ? COLORS[tube[0]].css : '#9cacbf');
      if (!tube.length) this.text(x, top + 76, 'пусто', 15, '#8097b0');
      for (const [slot, color] of tube.entries()) {
        const point = this.position(index, slot);
        this.balls.set(`${index}:${slot}`, this.own(this.makeBall(point.x, point.y, color)));
      }
      if (tube.length) {
        const point = this.position(index, tube.length - 1);
        if (planMove(state, index).valid) {
          background.lineStyle(2, COLORS[tube.at(-1)].fill, .65).strokeCircle(point.x, point.y, 23);
        } else {
          this.text(x + 28, point.y - 9, '×', 18, '#b3bac6').setDepth(3);
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
    const ball = this.add.graphics({ x, y }).setDepth(2);
    ball.fillStyle(0x050d18, .45).fillCircle(0, 3, 19);
    ball.fillStyle(COLORS[color].fill).fillCircle(0, 0, 18);
    ball.fillStyle(0xffffff, .2).fillCircle(-6, -7, 5);
    ball.lineStyle(2.5, 0x172335, .9);
    if (color === 'A') ball.strokeCircle(0, 0, 6);
    if (color === 'B') ball.strokeTriangle(0, -7, -7, 6, 7, 6);
    if (color === 'C') ball.strokeRect(-6, -6, 12, 12);
    if (color === 'D') ball.beginPath().moveTo(0, -8).lineTo(7, 0).lineTo(0, 8).lineTo(-7, 0).closePath().strokePath();
    if (color === 'E') ball.lineBetween(-7, 0, 7, 0).lineBetween(0, -7, 0, 7);
    if (color === 'F') ball.lineBetween(-7, -3, 7, -3).lineBetween(-7, 3, 7, 3);
    return ball;
  }
  say(message) { ui.message.textContent = message; }
  clearPreview(resetMessage = true) {
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
    const end = { x: destination.x, y: destination.top - 18 };
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
      this.markers.strokeCircle(point.x, point.y, 21);
    }
    this.markers.strokeRoundedRect(destination.x - 41, destination.top - 17, 82, 190, 20);
    const total = this.session.state.tubes[move.destination].length + move.transfers.length;
    this.say(`В приёмник № ${move.destination + 1} → ${total}/4${move.dispatch ? ' · партия готова!' : ' · остальные пока спрятаны.'}`);
  }
  tween(targets, config) {
    return new Promise(resolve => this.tweens.add({ targets, ...config, onComplete: resolve }));
  }
  delay(duration) { return new Promise(resolve => this.time.delayedCall(duration, resolve)); }
  collectionPoint(color) {
    const chip = ui['color-progress'].querySelector(`[data-color="${color}"]`).getBoundingClientRect();
    const canvas = this.game.canvas.getBoundingClientRect();
    return { x: (chip.x + chip.width / 2 - canvas.x) * 480 / canvas.width,
      y: (chip.y + chip.height / 2 - canvas.y) * 520 / canvas.height };
  }
  async choose(index) {
    if (this.busy || ui['level-dialog'].open || status(this.session.state) !== 'playing') return;
    const planned = planMove(this.session.state, index);
    if (!planned.valid) { this.say(reasons[planned.reason]); return; }
    this.preview(index);
    this.busy = true;
    this.refresh();
    // Even a quick touch sees the destination before movement starts.
    await this.delay(reducedMotion ? 1 : 100);
    const move = this.session.move(index);
    this.clearPreview(false);
    this.playSound('pickup');
    const moving = move.transfers.map(transfer => this.balls.get(`${transfer.from}:${transfer.fromSlot}`));
    await Promise.all(move.transfers.map((transfer, index) => {
      const point = this.position(transfer.to, transfer.toSlot);
      return this.tween(moving[index], { x: point.x, y: point.y, duration: reducedMotion ? 1 : 220,
        delay: reducedMotion ? 0 : index * 25, ease: 'Cubic.easeInOut' });
    }));
    if (move.dispatch) {
      this.playSound('complete');
      const existing = [...this.balls.entries()].filter(([key]) => key.startsWith(`${move.destination}:`)).map(([, ball]) => ball);
      const target = this.collectionPoint(move.color);
      await this.tween([...existing, ...moving], { ...target, alpha: .15, scaleX: .55, scaleY: .55,
        duration: reducedMotion ? 1 : 200, ease: 'Cubic.easeIn' });
    } else if (!reducedMotion) {
      // A short pulse distinguishes a waiting group from a completed one.
      const destination = this.layout[move.destination];
      const pulse = this.add.graphics().setDepth(4);
      pulse.lineStyle(3, COLORS[move.color].fill).strokeRoundedRect(destination.x - 41, destination.top - 17, 82, 190, 20);
      this.tween(pulse, { alpha: 0, duration: 180 }).then(() => pulse.destroy());
    }
    this.busy = false;
    this.drawBoard();
    this.refresh();
    if (move.dispatch) ui['color-progress'].querySelector(`[data-color="${move.color}"]`)?.classList.add('collect');
    if (status(this.session.state) === 'playing') {
      this.say(move.dispatch ? 'Партия собрана! Место освободилось.' : 'Группа ждёт в приёмнике. Открой остальные шары.');
    }
  }
  undo() {
    if (this.busy || !this.session.undo()) return;
    this.pressed = null;
    this.drawBoard(); this.refresh(); this.say('Ход отменён. Попробуй другой цвет.');
  }
  restart() { if (!this.busy) this.openLevel(this.levelIndex); }
  tutorialText() {
    const level = LEVELS[this.levelIndex], state = this.session.state;
    if (status(state) === 'won') return 'Все цвета собраны. Можно продолжить или отменить последний ход.';
    if (!state.moves || this.busy) return level.tip;
    if (level.lesson === 'gather') return 'Теперь собери ○. Приёмник заберёт все открытые шары своего цвета.';
    if (level.lesson === 'partial') return state.cleared.length ? 'Приёмник отмечен магнитом. Нажми на оставшийся цвет.' : 'Открой спрятанные шары другим цветом. Неполная группа никуда не пропадёт.';
    if (level.lesson === 'receiver') return 'Одноцветный приёмник работает даже без пустых контейнеров. Собери оставшиеся шары.';
    if (level.lesson === 'space' && state.moves === 1 && state.tubes[3].join('') === 'AA') {
      return 'Сбор △ откроет □ в № 2 — новый приёмник. Сбор □ сейчас займёт последнее пустое место.';
    }
    if (level.lesson === 'space') return 'Ищи ход, который откроет одноцветный приёмник. Если упёрся в тупик, вернись на ход назад.';
    return level.tip;
  }
  refresh() {
    const state = this.session.state, result = status(state);
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
      this.say(finished ? `Все шесть уровней пройдены! Последний — за ${state.moves} ходов.` : `Поле свободно! Все партии собраны за ${state.moves} ходов.`);
    }
    if (result === 'stuck' && !this.busy) {
      this.say('Нет места для сбора. Отмени ход и попробуй открыть приёмник.');
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', width: 480, height: 520, backgroundColor: '#172335',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: SortScene, input: { activePointers: 2 }, disableContextMenu: true,
  title: 'Magnetic Sort', version: '0.2.0'
});
