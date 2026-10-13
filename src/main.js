import { PuzzleSession, planMove, status } from './model.js?v=0.11.0';
import { LEVELS, COLORS } from './levels.js?v=0.11.0';
import { SortFeedback } from './feedback.js?v=0.11.0';

const ui = Object.fromEntries(['level-label', 'level-name', 'levels', 'tip',
  'status-panel', 'next', 'message', 'undo', 'restart', 'sound', 'menu',
  'level-dialog', 'close-menu', 'help', 'help-dialog', 'close-help', 'dismiss-notice', 'motion', 'motion-note', 'victory', 'victory-title', 'victory-detail', 'candy-box'].map(id => [id, document.getElementById(id)]));
// Phaser 4.2.1 has no GameConfig.resolution: render a denser canvas, keep logical coordinates.
const renderDensity = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const lessons = {
  gather: 'Нажми на △. Четыре одинаковых конфеты — готово!',
  partial: 'Собери △. Спрятанные конфеты пока останутся.',
  receiver: 'Нажми на банку со стрелкой. Магнит — приёмник.',
  practice: 'Открывай спрятанные цвета, собирая верхние.',
  space: 'Оставляй место для сбора. Ошибку можно отменить.',
  challenge: 'Выбирай порядок цветов и собери всё поле.',
  lock: 'Собери четыре △ — откроется коралловый замок.',
  'lock-choice': 'Какой замок открыть первым: ○ или △?',
  'lock-chain': 'Собирай цвет замка, чтобы открыть следующую банку.'
};
function reasonText(move) {
  return move.reason === 'locked' ? `Собери четыре ${COLORS[move.color].symbol}, чтобы открыть эту банку.` : reasons[move.reason];
}
const reasons = {
  empty: 'Нажми на стопку с конфетами, чтобы выбрать верхний цвет.',
  'no-space': 'Нет приёмника. Освободи место или отмени ход.',
  covered: 'Этот цвет спрятан. Сначала открой его другим сбором.'
};

function boardView() {
  const wide = matchMedia('(orientation: landscape) and (max-height: 500px) and (min-width: 600px)').matches;
  return wide ? { width: 720, height: 320, wide } : { width: 480, height: 720, wide };
}
function tubeLayout(count, view) {
  const columns = view.wide ? count : Math.ceil(count / 2);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, count - row * columns);
    return { x: (index % columns + .5) * (view.width / inRow),
      top: view.wide ? 76 : 90 + row * 330, scale: view.wide ? 1.16 : count <= 4 ? 1.36 : 1.3 };
  });
}
function receivers(state) {
  const result = {};
  state.tubes.forEach((tube, index) => {
    if (!state.locks[index] && tube.length && tube.length < 4 && tube.every(color => color === tube[0]) && result[tube[0]] === undefined) {
      result[tube[0]] = index;
    }
  });
  return result;
}

class SortScene extends Phaser.Scene {
  constructor() { super('sort'); }
  init() {
    this.view = boardView();
    this.seenLessons = new Set();
    try { this.seenLessons = new Set(JSON.parse(localStorage.getItem('magnetic-sort-lessons') || '[]')); } catch { /* Optional guidance history. */ }
    this.busy = false;
    this.boardObjects = [];
    this.balls = new Map();
    this.jarViews = new Map();
    this.lockViews = new Map();
    this.pressed = null;
    this.previewMove = null;
    this.audioPlays = { pickup: 0, complete: 0, land: 0, win: 0 };
  }
  preload() {
    for (const { texture } of Object.values(COLORS)) if (texture) this.load.image(texture, `./assets/${texture}.png?v=0.11.0`);
    for (const key of ['pickup', 'complete', 'land', 'win']) this.load.audio(key, `./assets/${key}.wav?v=0.11.0`);
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
      this.input.enabled = !ui['help-dialog'].open;
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
    const syncInput = () => { this.input.enabled = !ui['level-dialog'].open && !ui['help-dialog'].open; };
    ui['level-dialog'].addEventListener('close', syncInput);
    ui.help.addEventListener('click', () => {
      if (this.busy) return;
      this.pressed = null;
      this.clearPreview();
      this.input.enabled = false;
      ui['help-dialog'].showModal();
    });
    ui['close-help'].addEventListener('click', () => { ui['help-dialog'].close(); syncInput(); });
    ui['help-dialog'].addEventListener('close', syncInput);
    ui['dismiss-notice'].addEventListener('click', () => this.hideNotice());
    ui.undo.addEventListener('click', () => this.undo());
    ui.restart.addEventListener('click', () => { closeMenu(); this.restart(); });
    ui.next.addEventListener('click', () => this.openLevel((this.levelIndex + 1) % LEVELS.length));
    this.input.keyboard.on('keydown', event => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || ui['level-dialog'].open || ui['help-dialog'].open) return;
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
        version: '0.11.0', state: structuredClone(this.session.state), busy: this.busy, level: this.levelIndex,
        inputEnabled: this.input.enabled,
        status: status(this.session.state), history: this.session.history.length,
        renderer: this.game.renderer.type, receivers: receivers(this.session.state),
        preview: this.previewMove ? { ...this.previewMove } : null,
        motion: { preference: this.motionPreference, effective: this.gentleMotion ? 'gentle' : 'full', systemReduced: motionQuery.matches },
        feedback: { phase: this.feedback.phase, effects: this.feedback.effects.size, reactions: this.feedback.reactions.size, lastDuration: this.feedback.lastDuration },
        camera: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY },
        effects: [...this.feedback.effects].map(effect => ({ name: effect.name, x: effect.x, y: effect.y, alpha: effect.alpha, scaleX: effect.scaleX })),
        balls: [...this.balls].map(([id, ball]) => ({ id, x: ball.x, y: ball.y, scaleX: ball.scaleX, scaleY: ball.scaleY, alpha: ball.alpha,
          contact: { y: ball.getAt(0).y, scaleX: ball.getAt(0).scaleX, scaleY: ball.getAt(0).scaleY } })),
        jars: [...this.jarViews].map(([index, jar]) => ({ index, rotation: jar.rotation })),
        locks: [...this.lockViews].map(([index, lock]) => ({ index, x: lock.x, y: lock.y, alpha: lock.alpha, shackleY: lock.getByName('shackle').y })),
        audio: { muted: this.muted, engineMuted: this.sound.mute, plays: { ...this.audioPlays },
          decoded: ['pickup', 'complete', 'land', 'win'].every(key => this.cache.audio.exists(key)),
          context: this.sound.context?.state ?? 'html5' },
        centers: this.layout.map(({ x, top, scale }) => ({ x, y: top + 88 * scale })),
        view: { ...this.view },
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
    this.hideNotice();
    this.feedback.reset();
    this.levelIndex = index;
    this.session = new PuzzleSession(LEVELS[index].tubes, LEVELS[index].locks);
    this.layout = tubeLayout(this.session.state.tubes.length, this.view);
    this.pressed = null;
    this.drawBoard();
    this.refresh();
    const lesson = LEVELS[index].lesson;
    if (!this.seenLessons.has(lesson)) this.say(lessons[lesson], 'coach');
  }
  own(object) { this.boardObjects.push(object); return object; }
  text(x, y, value, size = 14, color = '#74677d') {
    const readableSize = Math.max(size, 10 / (this.scale.displaySize.width / this.view.width));
    return this.own(this.add.text(x, y, value, { fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: `${readableSize}px`, color }).setResolution(renderDensity).setOrigin(.5));
  }
  position(index, slot) { const { x, top, scale } = this.layout[index]; return { x, y: top + (154 - slot * 42) * scale }; }
  jarOutline(graphics, x, top, scale, color, width = 2.5, alpha = .95) {
    // Shared by the glass, route preview and landing/rejection highlights.
    graphics.save().translateCanvas(x, top).scaleCanvas(scale, scale);
    graphics.lineStyle(width, color, alpha).beginPath()
      .arc(-18, 10, 24, -Math.PI + .94, -Math.PI, true).lineTo(-42, 166)
      .arc(-18, 166, 24, Math.PI, Math.PI / 2, true).lineTo(18, 190)
      .arc(18, 166, 24, Math.PI / 2, 0, true).lineTo(42, 10)
      .arc(18, 10, 24, 0, -.94, true).strokePath();
    graphics.strokeEllipse(0, -14, 82, 12);
    graphics.restore();
  }
  drawBoard() {
    this.feedback.releasePress();
    this.feedback.clearReactions();
    this.markers.clear();
    this.previewMove = null;
    this.boardObjects.forEach(object => object.destroy());
    this.boardObjects = [];
    this.balls.clear();
    this.jarViews.clear();
    this.lockViews.clear();
    this.zones.forEach((zone, index) => {
      const layout = this.layout[index];
      zone.setVisible(Boolean(layout));
      if (layout && status(this.session.state) !== 'won') {
        const locked = Boolean(this.session.state.locks[index]);
        // Include the shackle: tapping the visible lock must explain how to open it.
        zone.setSize(94, locked ? 244 : 218);
        zone.setPosition(layout.x, layout.top + (locked ? 78 : 88) * layout.scale).setScale(layout.scale);
        zone.setInteractive();
      }
      else zone.disableInteractive();
    });
    const state = this.session.state;
    const targets = receivers(state);
    const background = this.own(this.add.graphics());
    // Quiet confectionery tray: the candies carry the strongest contrast.
    background.fillStyle(0xfff8ef).fillRoundedRect(0, 0, this.view.width, this.view.height, 24);
    // Fixed, low-contrast glaze grain; no animated noise behind the puzzle.
    for (let row = 0; row < Math.ceil(this.view.height / 36); row++) {
      for (let column = 0; column < Math.ceil(this.view.width / 36); column++) {
        const x = 12 + column * 36 + row % 2 * 12;
        const y = 16 + row * 36 + column % 3 * 3;
        background.fillStyle(0xd8bfa8, .13).fillCircle(x, y, .65);
      }
    }
    if (status(state) === 'won') return;
    for (const [x, y, angle] of [[20, this.view.height * .4, -.5], [this.view.width - 20, this.view.height * .65, .4]]) {
      background.lineStyle(4, 0xe9d9db, .65).lineBetween(x, y, x + 7, y + angle * 10);
    }
    for (const [index, tube] of state.tubes.entries()) {
      const { x, top, scale: s } = this.layout[index];
      const locked = state.locks[index];
      const receiver = tube.length && targets[tube[0]] === index;
      const tint = receiver ? COLORS[tube[0]].fill : 0x9e82b2;
      background.save().translateCanvas(x, top).scaleCanvas(s, s);
      background.fillStyle(0x987681, .07).fillEllipse(3, 198, 98, 24);
      background.fillStyle(0x987681, .14).fillEllipse(2, 195, 78, 13);
      background.restore();
      // Glass pivots at its base; shadows and hit areas stay on the tray.
      const glass = this.own(this.add.graphics({ x, y: top + 190 * s }).setDepth(1).setName(`jar-${index}`));
      this.jarViews.set(index, glass);
      glass.save().translateCanvas(0, -190 * s).scaleCanvas(s, s);
      glass.fillStyle(0xffffff, .8).fillRoundedRect(-42, -14, 84, 204, 24);
      glass.fillStyle(receiver ? tint : 0xe9dff3, receiver ? .09 : .28).fillRoundedRect(-38, -10, 76, 197, 21);
      glass.lineStyle(3, 0xffffff, .95).lineBetween(-35, 11, -35, 151);
      glass.lineStyle(1.5, 0xffffff, .9).lineBetween(34, 22, 34, 143);
      glass.fillStyle(0xfffcff).fillEllipse(0, -14, 82, 12);
      this.jarOutline(glass, 0, 0, 1, tint);
      glass.lineStyle(3, 0xffffff, .8).lineBetween(-20, 183, 20, 183);
      if (receiver) {
        // Large U-shaped magnet. The dedicated lesson explains the symbol.
        glass.lineStyle(5, tint).beginPath().moveTo(-12, -46)
          .lineTo(-12, -29).lineTo(12, -29).lineTo(12, -46).strokePath();
        glass.lineStyle(5, 0x655170).lineBetween(-12, -46, -12, -41)
          .lineBetween(12, -46, 12, -41);
      }
      if (LEVELS[this.levelIndex].lesson === 'receiver' && state.moves === 0 && index === 1) {
        glass.fillStyle(COLORS.B.fill).fillTriangle(-7, -37, 7, -37, 0, -27);
      }
      glass.restore();
      for (const [slot, color] of tube.entries()) {
        const point = this.position(index, slot);
        this.balls.set(`${index}:${slot}`, this.own(this.makeBall(point.x, point.y, color).setAlpha(locked ? .58 : 1)));
      }
      if (locked) this.lockViews.set(index, this.own(this.makeLock(index, locked)));
      if (tube.length && !locked) {
        const point = this.position(index, tube.length - 1);
        if (planMove(state, index).valid) {
          this.own(this.add.graphics().setDepth(1.5)).lineStyle(2, COLORS[tube.at(-1)].fill, .8).strokeCircle(point.x, point.y, 26 * s);
        } else {
          this.text(x + 31 * s, point.y - 10 * s, '×', 18 * s, '#79638a').setDepth(3);
        }
      }

    }
  }
  makeLock(index, color) {
    const { x, top, scale } = this.layout[index], { fill, ink } = COLORS[color];
    const band = this.add.graphics();
    band.fillStyle(fill).fillRoundedRect(-43, -22, 86, 16, 6);
    band.lineStyle(2, 0xffffff, .8).lineBetween(-36, -19, 36, -19);
    band.lineStyle(2, fill, .7).lineBetween(-36, -5, 36, -5);
    const shackle = this.add.graphics().setName('shackle');
    shackle.lineStyle(4, parseInt(ink.slice(1), 16)).beginPath().moveTo(-9, -15).lineTo(-9, -28)
      .arc(0, -28, 9, Math.PI, Math.PI * 2).lineTo(9, -15).strokePath();
    const badge = this.add.graphics();
    badge.fillStyle(0xfffcf7).fillRoundedRect(-15, -26, 30, 27, 6);
    badge.lineStyle(2.5, fill).strokeRoundedRect(-15, -26, 30, 27, 6);
    // Same geometric code as the candy: the key is identifiable without color.
    badge.lineStyle(2.5, parseInt(ink.slice(1), 16));
    if (color === 'A') badge.strokeCircle(0, -12, 6);
    if (color === 'B') badge.strokeTriangle(0, -19, -7, -6, 7, -6);
    if (color === 'C') badge.strokeRect(-6, -18, 12, 12);
    if (color === 'D') badge.beginPath().moveTo(0, -20).lineTo(7, -12).lineTo(0, -4).lineTo(-7, -12).closePath().strokePath();
    return this.add.container(x, top, [band, shackle, badge]).setScale(scale).setDepth(8).setName(`lock-${index}`);
  }
  createInputZones() {
    this.zones = [];
    for (let index = 0; index < 6; index++) {
      const zone = this.add.zone(0, 0, 94, 218).setDepth(10).setInteractive({ useHandCursor: true });
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
    const visual = this.add.container(0, 0, [shadow, candy, ball]).setScale(this.layout[0].scale * 1.125);
    return this.add.container(x, y, [visual]).setDepth(2);
  }
  fitBoard() {
    const rect = document.getElementById('game').getBoundingClientRect();
    const bounds = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
    const nextView = boardView();
    const viewChanged = !this.busy && nextView.wide !== this.view.wide;
    if (bounds === this.boardBounds && !viewChanged) return;
    this.boardBounds = bounds;
    // Update synchronously when the HUD changes; ResizeObserver follows a frame later.
    // Phaser 4.2.1 refresh() reads cached parentSize, so update its bounds first.
    this.scale.getParentBounds();
    if (viewChanged) {
      this.feedback.reset();
      this.view = nextView;
      this.layout = tubeLayout(this.session.state.tubes.length, this.view);
      this.scale.setGameSize(this.view.width * renderDensity, this.view.height * renderDensity);
    } else this.scale.refresh();
  }
  hideNotice() {
    clearTimeout(this.noticeTimer);
    if (ui['status-panel'].dataset.kind === 'coach' && this.levelIndex !== undefined) {
      this.seenLessons.add(LEVELS[this.levelIndex].lesson);
      try { localStorage.setItem('magnetic-sort-lessons', JSON.stringify([...this.seenLessons])); } catch { /* Optional. */ }
    }
    ui['status-panel'].hidden = true;
    document.querySelector('.hud').classList.remove('has-notice');
    ui['status-panel'].dataset.kind = '';
  }
  say(message, kind = 'error') {
    this.hideNotice();
    ui.message.textContent = message;
    ui['status-panel'].dataset.kind = kind;
    ui['status-panel'].hidden = false;
    document.querySelector('.hud').classList.add('has-notice');
    if (kind === 'error') this.noticeTimer = setTimeout(() => this.hideNotice(), 3500);
  }
  clearPreview(resetMessage = true) {
    this.feedback.releasePress();
    this.markers.clear();
    this.previewMove = null;
  }
  preview(index) {
    if (this.busy || status(this.session.state) !== 'playing') return;
    const move = planMove(this.session.state, index);
    this.clearPreview(false);
    if (!move.valid) { this.say(reasonText(move)); return; }
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
      this.markers.strokeCircle(point.x, point.y, 24 * s);
    }
    this.jarOutline(this.markers, destination.x, destination.top, s, COLORS[move.color].fill, 3, 1);
  }
  tween(targets, config) {
    return new Promise(resolve => this.tweens.add({ targets, ...config, onComplete: resolve }));
  }
  delay(duration) { return new Promise(resolve => this.time.delayedCall(duration, resolve)); }
  async choose(index) {
    if (this.busy || ui['level-dialog'].open || ui['help-dialog'].open || status(this.session.state) !== 'playing') return;
    if (index < 0 || index >= this.session.state.tubes.length) return;
    const planned = planMove(this.session.state, index);
    if (!planned.valid) { this.feedback.reject(index); this.say(reasonText(planned)); return; }
    this.hideNotice();
    this.feedback.beginMove();
    this.feedback.gentle = this.gentleMotion;
    this.preview(index);
    this.busy = true;
    this.refresh();
    const move = this.session.move(index);
    const moving = await this.feedback.gather(move);
    if (move.dispatch) await this.feedback.collect(move, moving);
    else this.feedback.rim(move.destination, COLORS[move.color].fill, true);
    if (move.unlocked.length) await this.feedback.unlock(move);
    this.feedback.finish();
    this.busy = false;
    this.drawBoard();
    this.refresh();
    if (status(this.session.state) === 'won') this.feedback.celebrate();
  }
  undo() {
    if (this.busy || !this.session.undo()) return;
    this.feedback.reset();
    this.hideNotice();
    this.pressed = null;
    this.drawBoard(); this.refresh();
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
      return 'Сбор △ откроет одноцветную стопку □ — новый приёмник. Сбор □ сейчас займёт последнее пустое место.';
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
    ui['level-label'].textContent = `${this.levelIndex + 1} / ${LEVELS.length}`;
    ui['level-name'].textContent = LEVELS[this.levelIndex].name;
    ui.tip.textContent = this.tutorialText();
    ui.undo.disabled = this.busy || this.session.history.length === 0;
    ui.restart.disabled = this.busy;
    ui.next.disabled = this.busy;
    ui.menu.disabled = this.busy;
    ui.help.disabled = this.busy;
    ui.undo.classList.toggle('rescue', !this.busy && result === 'stuck');
    [...ui.levels.children].forEach((button, index) => {
      if (index === this.levelIndex) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    ui.next.hidden = this.busy || result !== 'won';
    if (result === 'won' && !this.busy) {
      const finished = this.levelIndex === LEVELS.length - 1;
      ui.next.textContent = finished ? 'Ещё раз →' : 'Дальше →';
      ui['victory-title'].textContent = 'Готово!';
      const moves = state.moves, ending = moves % 10 === 1 && moves % 100 !== 11 ? 'ход' : moves % 10 >= 2 && moves % 10 <= 4 && !(moves % 100 >= 12 && moves % 100 <= 14) ? 'хода' : 'ходов';
      ui['victory-detail'].textContent = `За ${moves} ${ending}`;
      ui['candy-box'].replaceChildren(...colors.flatMap(color => Array.from({ length: 4 }, () => {
        const cell = document.createElement('span'), candy = document.createElement('img'), symbol = document.createElement('span');
        cell.className = 'gift-candy';
        candy.src = `./assets/${COLORS[color].texture}.png?v=0.11.0`;
        candy.alt = '';
        candy.width = candy.height = 96;
        symbol.textContent = COLORS[color].symbol;
        cell.append(candy, symbol);
        return cell;
      })));
      this.hideNotice();
    }
    if (result === 'stuck' && !this.busy) {
      this.say('Нет места. Отмени ход и открой приёмник.', 'stuck');
    }
    this.fitBoard();
  }
}

new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', width: boardView().width * renderDensity, height: boardView().height * renderDensity, backgroundColor: '#fff8ef',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: SortScene, input: { activePointers: 2 }, disableContextMenu: true,
  title: 'Magnetic Sort', version: '0.11.0'
});
