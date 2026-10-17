import { PuzzleSession, planMove, status } from './model.js?v=0.17.0';
import { LEVELS, COLORS } from './levels.js?v=0.17.0';
import { SortFeedback } from './feedback.js?v=0.17.0';
import { loadBest, rememberBest } from './best.js?v=0.17.0';
import { loadRun, saveRun } from './resume.js?v=0.17.0';

const ui = Object.fromEntries(['level-label', 'level-progress', 'level-name', 'levels', 'tip',
  'status-panel', 'next', 'message', 'undo', 'restart', 'sound', 'menu',
  'level-dialog', 'close-menu', 'help', 'help-dialog', 'close-help', 'dismiss-notice', 'motion', 'motion-note', 'victory', 'victory-title', 'victory-detail', 'candy-box'].map(id => [id, document.getElementById(id)]));
for (const id of ['welcome', 'play', 'welcome-levels', 'welcome-settings', 'welcome-help', 'welcome-status', 'welcome-progress', 'go-home', 'menu-title']) ui[id] = document.getElementById(id);
// Phaser 4.2.1 has no GameConfig.resolution: render a denser canvas, keep logical coordinates.
const renderDensity = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const AUDIO_KEYS = ['pickup', 'complete', 'land', 'win', 'seal', 'unlock', 'undo'];
// SFX group trim in dB; the retained stopper and victory keep their existing gain.
const SFX_DB = { pickup: -1.5, complete: -2.5, land: 0, win: 0, seal: 0, unlock: -2, undo: -4 };
const lessons = {
  gather: 'Нажми на △. Четыре одинаковых конфеты — готово!',
  partial: 'Собери △. Спрятанные конфеты пока останутся.',
  receiver: 'Нажми на банку со стрелкой. Магнит — приёмник.',
  practice: 'Открывай спрятанные цвета, собирая верхние.',
  space: 'Оставляй место для сбора. Ошибку можно отменить.',
  challenge: 'Выбирай порядок цветов и собери всё поле.',
  lock: 'Собери четыре △ — откроется коралловый замок.',
  'lock-choice': 'Какой замок открыть первым: ○ или △?',
  'lock-chain': 'Собирай цвет замка, чтобы открыть следующую банку.',
  'branch-space': 'Сравни два первых цвета: какой оставит больше места?',
  'hidden-key': 'Ключ ○ спрятан под другими конфетами.',
  'three-paths': 'Попробуй найти самый короткий путь.'
};
function reasonText(move) {
  return move.reason === 'locked' ? `Собери четыре ${COLORS[move.color].symbol}, чтобы открыть эту банку.` : reasons[move.reason];
}
const reasons = {
  empty: 'Нажми на стопку с конфетами, чтобы выбрать верхний цвет.',
  'no-space': 'Нет приёмника. Освободи место или отмени ход.',
  covered: 'Этот цвет спрятан. Сначала открой его другим сбором.'
};
function moveCount(moves) {
  const ending = moves % 10 === 1 && moves % 100 !== 11 ? 'ход' : moves % 10 >= 2 && moves % 10 <= 4 && !(moves % 100 >= 12 && moves % 100 <= 14) ? 'хода' : 'ходов';
  return `${moves} ${ending}`;
}

function drawCandyGlyph(graphics, color) {
  if (color === 'A') graphics.strokeCircle(0, 0, 6);
  if (color === 'B') graphics.strokeTriangle(0, -7, -7, 6, 7, 6);
  if (color === 'C') graphics.strokeRect(-6, -6, 12, 12);
  if (color === 'D') graphics.beginPath().moveTo(0, -8).lineTo(7, 0).lineTo(0, 8).lineTo(-7, 0).closePath().strokePath();
  if (color === 'E') graphics.lineBetween(-7, 0, 7, 0).lineBetween(0, -7, 0, 7);
  if (color === 'F') graphics.lineBetween(-7, -3, 7, -3).lineBetween(-7, 3, 7, 3);
}

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
      top: view.wide ? 76 : 90 + row * 340, scale: view.wide ? 1.16 : count <= 4 ? 1.36 : 1.3 };
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
    this.screen = 'home';
    this.bestScores = loadBest();
    this.savedRun = loadRun(LEVELS);
    this.hasStarted = Boolean(this.savedRun) || LEVELS.some(level => this.bestScores[level.lesson] !== undefined);
    this.actions = [];
    this.boardObjects = [];
    this.balls = new Map();
    this.jarViews = new Map();
    this.lockViews = new Map();
    this.pressed = null;
    this.previewMove = null;
    this.recordedState = null;
    this.audioPlays = Object.fromEntries(AUDIO_KEYS.map(key => [key, 0]));
    this.audioEvents = [];
    this.landVoice = 0;
  }
  preload() {
    this.load.image('glass-jar', './assets/glass-jar.png?v=0.13.2');
    for (const { texture } of Object.values(COLORS)) if (texture) this.load.image(texture, `./assets/${texture}.png?v=0.13.2`);
    for (const key of AUDIO_KEYS) this.load.audio(key, `./assets/${key}.wav?v=0.17.0`);
  }
  create() {
    // Preserve the illustrated rim and foot; give the clear body room for four candies.
    const jarTexture = this.textures.get('glass-jar');
    jarTexture.add('rim', 0, 168, 91, 688, 176);
    jarTexture.add('body', 0, 168, 267, 688, 1000);
    jarTexture.add('foot', 0, 168, 1267, 688, 214);
    this.cameras.main.setOrigin(0, 0).setZoom(renderDensity);
    this.markers = this.add.graphics().setDepth(5);
    this.feedback = new SortFeedback(this);
    let motion = 'auto';
    try { motion = localStorage.getItem('magnetic-sort-motion') || 'auto'; } catch { /* Optional preference. */ }
    this.setMotion(motion);
    ui.motion.addEventListener('change', () => this.setMotion(ui.motion.value));
    motionQuery.addEventListener('change', () => this.setMotion(this.motionPreference));
    const makeSound = key => {
      const sound = this.sound.add(key);
      sound.on('play', () => {
        this.audioPlays[key]++;
        this.audioEvents.push({ key, at: performance.now(), phase: this.feedback.phase, rate: sound.rate, volume: sound.volume });
        if (this.audioEvents.length > 100) this.audioEvents.shift();
      });
      return sound;
    };
    this.sfx = Object.fromEntries(AUDIO_KEYS.map(key => [key, makeSound(key)]));
    // Four bounded voices let every candy's glass tail finish in both motion modes.
    this.landPool = [this.sfx.land, ...Array.from({ length: 3 }, () => makeSound('land'))];
    let muted = false;
    try { muted = localStorage.getItem('magnetic-sort-muted') === 'true'; } catch { /* Storage is optional. */ }
    this.setMuted(muted);
    ui.sound.addEventListener('click', () => this.setMuted(!this.muted));
    const closeMenu = () => {
      ui['level-dialog'].close();
      // The dialog's close event is queued; the visible board must be ready immediately.
      this.input.enabled = this.screen === 'game' && !ui['help-dialog'].open;
    };
    for (let index = 0; index < LEVELS.length; index++) {
      const button = document.createElement('button');
      const title = document.createElement('span'), record = document.createElement('span'), check = document.createElement('span');
      title.className = 'level-title'; title.textContent = `${index + 1}. ${LEVELS[index].name}`;
      record.className = 'level-record';
      check.className = 'level-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true'); check.hidden = true;
      button.append(title, record, check);
      button.addEventListener('click', () => { this.showGame(false); this.openLevel(index); closeMenu(); });
      ui.levels.append(button);
    }
    ui.menu.addEventListener('click', () => this.openMenu());
    ui['welcome-levels'].addEventListener('click', () => this.openMenu('levels'));
    ui['welcome-settings'].addEventListener('click', () => this.openMenu('settings'));
    ui.play.addEventListener('click', () => this.showGame());
    ui['go-home'].addEventListener('click', () => { closeMenu(); this.showHome(); });
    ui['close-menu'].addEventListener('click', closeMenu);
    const syncInput = () => { this.input.enabled = this.screen === 'game' && !ui['level-dialog'].open && !ui['help-dialog'].open; };
    ui['level-dialog'].addEventListener('close', syncInput);
    const openHelp = () => {
      if (this.busy) return;
      this.pressed = null;
      this.clearPreview();
      this.input.enabled = false;
      ui.tip.hidden = this.screen === 'home';
      ui['level-name'].textContent = this.screen === 'home' ? 'Как играть' : LEVELS[this.levelIndex].name;
      ui['help-dialog'].showModal();
    };
    ui.help.addEventListener('click', openHelp);
    ui['welcome-help'].addEventListener('click', openHelp);
    ui['close-help'].addEventListener('click', () => { ui['help-dialog'].close(); syncInput(); });
    ui['help-dialog'].addEventListener('close', syncInput);
    ui['dismiss-notice'].addEventListener('click', () => this.hideNotice());
    ui.undo.addEventListener('click', () => this.undo());
    ui.restart.addEventListener('click', () => { closeMenu(); this.restart(); });
    ui.next.addEventListener('click', () => this.openLevel((this.levelIndex + 1) % LEVELS.length));
    this.input.keyboard.on('keydown', event => {
      if (this.screen !== 'game' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || ui['level-dialog'].open || ui['help-dialog'].open) return;
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
    this.openLevel(this.savedRun?.index ?? Math.max(0, LEVELS.findIndex(level => this.bestScores[level.lesson] === undefined)), this.savedRun);
    this.savedRun = null;
    this.showHome();
    // FIT must also react when DOM text or screen orientation changes the parent.
    this.resizeObserver = new ResizeObserver(() => this.fitBoard());
    this.resizeObserver.observe(document.getElementById('game'));

    // Read-only diagnostics, available only to local QA. No game-state setters.
    if (new URLSearchParams(location.search).has('qa')) {
      window.__sortQA = { snapshot: () => ({
        version: '0.17.0', screen: this.screen, state: structuredClone(this.session.state), busy: this.busy, level: this.levelIndex,
        inputEnabled: this.input.enabled,
        status: status(this.session.state), history: this.session.history.length,
        renderer: this.game.renderer.type, receivers: receivers(this.session.state),
        preview: this.previewMove ? { ...this.previewMove } : null,
        motion: { preference: this.motionPreference, effective: this.gentleMotion ? 'gentle' : 'full', systemReduced: motionQuery.matches },
        feedback: { phase: this.feedback.phase, effects: this.feedback.effects.size, reactions: this.feedback.reactions.size, lastDuration: this.feedback.lastDuration,
          undoVisuals: this.feedback.undoVisuals.size, lastUndoDuration: this.feedback.lastUndoDuration },
        camera: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY },
        effects: [...this.feedback.effects].map(effect => ({ name: effect.name, x: effect.x, y: effect.y, alpha: effect.alpha, scaleX: effect.scaleX, scaleY: effect.scaleY, angle: effect.angle,
          depth: effect.depth, width: effect.name === 'rubber-lid' ? effect.getAt(0).displayWidth : undefined,
          height: effect.name === 'rubber-lid' ? effect.getAt(0).displayHeight : undefined })),
        balls: [...this.balls].map(([id, ball]) => ({ id, x: ball.x, y: ball.y, scaleX: ball.scaleX, scaleY: ball.scaleY, alpha: ball.alpha,
          contact: { y: ball.getAt(0).y, scaleX: ball.getAt(0).scaleX, scaleY: ball.getAt(0).scaleY } })),
        jars: [...this.jarViews].map(([index, jar]) => ({ index, rotation: jar.rotation })),
        locks: [...this.lockViews].map(([index, lock]) => ({ index, x: lock.x, y: lock.y, alpha: lock.alpha, shackleY: lock.getByName('shackle').y })),
        audio: { muted: this.muted, engineMuted: this.sound.mute, plays: { ...this.audioPlays },
          decoded: AUDIO_KEYS.every(key => this.cache.audio.exists(key)), events: [...this.audioEvents], landVoices: this.landPool.length,
          context: this.sound.context?.state ?? 'html5' },
        centers: this.layout.map(({ x, top, scale }) => ({ x, y: top + 88 * scale })),
        view: { ...this.view },
        presentation: { density: renderDensity, canvas: [this.game.canvas.width, this.game.canvas.height],
          tubeScale: this.layout[0].scale, victoryVisible: !ui.victory.hidden,
          moveMarkers: this.boardObjects.filter(object => object.name === 'move-affordance' && object.visible).length }
      }) };
    }
    document.body.dataset.ready = 'true';
    for (const id of ['play', 'welcome-levels', 'welcome-settings', 'welcome-help']) ui[id].disabled = false;
    ui['welcome-status'].hidden = true;
    ui.play.focus({ preventScroll: true });
  }
  openMenu(mode = 'all') {
    if (this.busy) return;
    this.pressed = null;
    this.clearPreview();
    this.input.enabled = false;
    ui['level-dialog'].dataset.mode = mode;
    ui['menu-title'].textContent = mode === 'settings' ? 'Настройки' : mode === 'levels' ? 'Уровни' : 'Магнитная сортировка';
    ui.restart.hidden = this.screen === 'home' || mode !== 'all';
    ui['go-home'].hidden = this.screen === 'home';
    ui['level-dialog'].showModal();
  }
  showHome() {
    if (this.busy) return;
    this.screen = 'home';
    if (this.hasStarted && status(this.session.state) === 'won') this.openLevel((this.levelIndex + 1) % LEVELS.length);
    this.pressed = null;
    this.clearPreview();
    this.feedback.reset();
    this.input.enabled = false;
    document.body.dataset.screen = 'home';
    const card = document.querySelector('.game-card');
    card.inert = true;
    card.setAttribute('aria-hidden', 'true');
    ui.welcome.hidden = false;
    ui.welcome.inert = false;
    this.updateHomeProgress();
    if (document.body.dataset.ready === 'true') ui.play.focus({ preventScroll: true });
  }
  showGame(showLesson = true) {
    if (this.busy) return;
    const firstStart = !this.hasStarted;
    this.screen = 'game';
    this.hasStarted = true;
    document.body.dataset.screen = 'game';
    ui.welcome.inert = true;
    ui.welcome.hidden = true;
    const card = document.querySelector('.game-card');
    card.inert = false;
    card.removeAttribute('aria-hidden');
    this.input.enabled = !ui['level-dialog'].open && !ui['help-dialog'].open;
    this.fitBoard();
    const lesson = LEVELS[this.levelIndex].lesson;
    if ((firstStart || !this.session.state.moves) && showLesson && !this.seenLessons.has(lesson)) this.say(lessons[lesson], 'coach');
    ui.menu.focus({ preventScroll: true });
    this.persistRun();
  }
  persistRun() {
    if (!this.hasStarted || this.busy) return;
    const won = status(this.session.state) === 'won';
    const index = won ? (this.levelIndex + 1) % LEVELS.length : this.levelIndex;
    saveRun(LEVELS[index], won ? [] : this.actions);
  }
  updateHomeProgress() {
    const completed = LEVELS.filter(level => this.bestScores[level.lesson] !== undefined).length;
    ui.play.querySelector('span').textContent = this.hasStarted ? 'Продолжить' : 'Играть';
    ui['welcome-progress'].textContent = `Уровень ${this.levelIndex + 1} · пройдено ${completed}/${LEVELS.length}`;
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
  playSound(key, config = {}) {
    if (this.muted) return;
    const sound = key === 'land' ? this.landPool[this.landVoice++ % this.landPool.length] : this.sfx[key];
    sound.play({ ...config, volume: (config.volume ?? 1) * 10 ** (SFX_DB[key] / 20) });
  }
  stopSounds() { for (const sound of new Set([...Object.values(this.sfx ?? {}), ...(this.landPool ?? [])])) sound.stop(); }
  openLevel(index, restored = null) {
    if (this.busy) return;
    this.hideNotice();
    this.feedback.reset();
    this.levelIndex = index;
    this.recordedState = null;
    this.session = restored?.session ?? new PuzzleSession(LEVELS[index].tubes, LEVELS[index].locks);
    this.actions = restored ? [...restored.actions] : [];
    this.layout = tubeLayout(this.session.state.tubes.length, this.view);
    this.pressed = null;
    this.drawBoard();
    this.refresh();
    const lesson = LEVELS[index].lesson;
    if (this.screen === 'game' && !this.seenLessons.has(lesson)) this.say(lessons[lesson], 'coach');
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
    this.feedback.clearUndo();
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
    // One continuous illustrated world lives under the transparent canvas and HUD.
    if (status(state) === 'won') return;
    for (const [index, tube] of state.tubes.entries()) {
      const { x, top, scale: s } = this.layout[index];
      const locked = state.locks[index];
      const receiver = tube.length && targets[tube[0]] === index;
      const tint = receiver ? COLORS[tube[0]].fill : 0x9e82b2;
      background.save().translateCanvas(x, top).scaleCanvas(s, s);
      background.fillStyle(0x415cad, .10).fillEllipse(3, 204, 100, 22);
      background.fillStyle(0x4652a8, .18).fillEllipse(1, 200, 78, 11);
      background.restore();
      // Glass pivots at its base; shadows and hit areas stay on the tray.
      const decoration = this.add.graphics().setName('jar-decoration');
      decoration.save().translateCanvas(0, -198 * s).scaleCanvas(s, s);
      decoration.fillStyle(receiver ? tint : 0xc6f6ff, receiver ? .11 : .16).fillRoundedRect(-35, 3, 70, 174, 16);
      const parts = [decoration,
        this.add.image(0, -220 * s, 'glass-jar', 'rim').setOrigin(.5, 0).setDisplaySize(94 * s, 24 * s),
        this.add.image(0, -196 * s, 'glass-jar', 'body').setOrigin(.5, 0).setDisplaySize(94 * s, 174 * s),
        this.add.image(0, -22 * s, 'glass-jar', 'foot').setOrigin(.5, 0).setDisplaySize(94 * s, 22 * s)];
      const glass = this.own(this.add.container(x, top + 198 * s, parts).setDepth(1).setName(`jar-${index}`));
      this.jarViews.set(index, glass);
      if (receiver) {
        // A raised, rounded U-shaped magnet remains the receiver marker.
        for (const [width, color, alpha, dy] of [[9, 0x584ca0, .65, 2], [7, tint, 1, 0], [2, 0xffffff, .5, -1]]) {
          decoration.save().translateCanvas(0, dy).lineStyle(width, color, alpha).beginPath().moveTo(-12, -46)
            .lineTo(-12, -35).arc(-6, -35, 6, Math.PI, Math.PI / 2, true).lineTo(6, -29)
            .arc(6, -35, 6, Math.PI / 2, 0, true).lineTo(12, -46).strokePath().restore();
        }
        decoration.lineStyle(5, 0xfff7ff).lineBetween(-12, -46, -12, -41)
          .lineBetween(12, -46, 12, -41);
      }
      if (LEVELS[this.levelIndex].lesson === 'receiver' && state.moves === 0 && index === 1) {
        decoration.fillStyle(COLORS.B.fill).fillTriangle(-7, -37, 7, -37, 0, -27);
      }
      decoration.restore();
      for (const [slot, color] of tube.entries()) {
        const point = this.position(index, slot);
        this.balls.set(`${index}:${slot}`, this.own(this.makeBall(point.x, point.y, color).setAlpha(locked ? .58 : 1)));
      }
      if (locked) this.lockViews.set(index, this.own(this.makeLock(index, locked)));
      if (tube.length && !locked) {
        const point = this.position(index, tube.length - 1);
        if (planMove(state, index).valid) {
          this.own(this.add.graphics().setDepth(1.5).setName('move-affordance')).lineStyle(2, COLORS[tube.at(-1)].fill, .8).strokeCircle(point.x, point.y, 26 * s);
        } else {
          this.text(x + 31 * s, point.y - 10 * s, '×', 18 * s, '#79638a').setDepth(3).setName('move-affordance');
        }
      }

    }
  }
  makeLock(index, color) {
    const { x, top, scale } = this.layout[index], { fill, ink } = COLORS[color];
    const band = this.add.graphics();
    const dark = parseInt(ink.slice(1), 16);
    band.fillStyle(dark, .5).fillRoundedRect(-43, -20, 86, 18, 7);
    band.fillStyle(fill).fillRoundedRect(-43, -23, 86, 17, 7);
    band.fillStyle(0xffffff, .35).fillRoundedRect(-38, -22, 76, 5, 2);
    const shackle = this.add.graphics().setName('shackle');
    shackle.lineStyle(7, dark).beginPath().moveTo(-9, -15).lineTo(-9, -28)
      .arc(0, -28, 9, Math.PI, Math.PI * 2).lineTo(9, -15).strokePath();
    shackle.lineStyle(4, fill).beginPath().moveTo(-9, -17).lineTo(-9, -28)
      .arc(0, -28, 9, Math.PI, Math.PI * 2).lineTo(9, -17).strokePath();
    shackle.lineStyle(1.5, 0xffffff, .65).beginPath().arc(0, -28, 8, Math.PI * 1.1, Math.PI * 1.75).strokePath();
    const badge = this.add.graphics();
    badge.fillStyle(dark, .65).fillRoundedRect(-16, -24, 32, 29, 7);
    badge.fillStyle(fill).fillRoundedRect(-16, -27, 32, 29, 7);
    badge.lineStyle(1.5, 0xffffff, .8).strokeRoundedRect(-15, -27, 30, 27, 7);
    badge.fillStyle(0xffffff, .35).fillRoundedRect(-12, -24, 24, 7, 3);
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
    // A pale lower edge gives the symbols the same moulded finish as the candy and lid.
    ball.save().translateCanvas(0, 1.25).lineStyle(3, 0xffffff, .68);
    drawCandyGlyph(ball, color);
    ball.restore().lineStyle(2.3, 0x392442, .9);
    drawCandyGlyph(ball, color);
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
    if (this.screen !== 'game' || this.busy || status(this.session.state) !== 'playing') return;
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
    if (this.screen !== 'game' || this.busy || ui['level-dialog'].open || ui['help-dialog'].open || status(this.session.state) !== 'playing') return;
    if (index < 0 || index >= this.session.state.tubes.length) return;
    const planned = planMove(this.session.state, index);
    if (!planned.valid) { this.feedback.reject(index); this.say(reasonText(planned)); return; }
    this.hideNotice();
    this.feedback.beginMove();
    this.feedback.gentle = this.gentleMotion;
    this.preview(index);
    this.busy = true;
    // Hints describe the resting board. They must not float in vacated slots while sealing.
    this.boardObjects.filter(object => object.name === 'move-affordance').forEach(object => object.setVisible(false));
    this.refresh();
    const move = this.session.move(index);
    this.actions.push(index);
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
    if (this.screen !== 'game' || this.busy || !this.session.history.length) return;
    const reversed = planMove(this.session.history.at(-1), this.actions.at(-1));
    if (!this.session.undo()) return;
    this.actions.pop();
    this.feedback.reset();
    this.hideNotice();
    this.pressed = null;
    this.drawBoard(); this.refresh();
    if (reversed.valid) this.feedback.reverse(reversed);
  }
  restart() { if (this.screen === 'game' && !this.busy) this.openLevel(this.levelIndex); }
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
  updateProgress(colors, cleared) {
    const progress = ui['level-progress'];
    const palette = colors.join('');
    if (progress.dataset.palette !== palette) {
      progress.replaceChildren(...colors.map(color => {
        const candy = document.createElement('span');
        candy.className = 'progress-candy';
        candy.textContent = COLORS[color].symbol;
        candy.style.setProperty('--candy-fill', COLORS[color].css);
        candy.style.setProperty('--candy-ink', COLORS[color].ink ?? '#392442');
        candy.setAttribute('aria-hidden', 'true');
        return candy;
      }));
      progress.dataset.palette = palette;
    }
    colors.forEach((color, index) => progress.children[index].classList.toggle('collected', cleared.includes(color)));
    progress.setAttribute('aria-valuemax', String(colors.length));
    progress.setAttribute('aria-valuenow', String(cleared.length));
    progress.setAttribute('aria-valuetext', `${cleared.length} из ${colors.length}`);
  }
  refresh() {
    const state = this.session.state, result = status(state);
    const won = result === 'won' && !this.busy;
    document.querySelector('.game-shell').classList.toggle('is-won', won);
    ui.victory.hidden = !won;
    document.getElementById('game').setAttribute('aria-hidden', String(won));
    const colors = [...new Set(this.session.initial.tubes.flat())].sort();
    ui['level-label'].textContent = `${this.levelIndex + 1} / ${LEVELS.length}`;
    this.updateProgress(colors, state.cleared);
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
      const best = this.bestScores[LEVELS[index].lesson];
      button.querySelector('.level-record').textContent = best === undefined ? '' : `Рекорд: ${moveCount(best)}`;
      button.querySelector('.level-check').hidden = best === undefined;
      if (best === undefined) button.removeAttribute('aria-label');
      else button.setAttribute('aria-label', `${index + 1}. ${LEVELS[index].name}. Пройден. Рекорд: ${moveCount(best)}`);
    });
    ui.next.hidden = this.busy || result !== 'won';
    if (result === 'won' && !this.busy) {
      const finished = this.levelIndex === LEVELS.length - 1;
      ui.next.textContent = finished ? 'Ещё раз →' : 'Дальше →';
      ui['victory-title'].textContent = 'Готово!';
      const moves = state.moves;
      if (this.recordedState !== state) {
        const result = rememberBest(this.bestScores, LEVELS[this.levelIndex].lesson, moves);
        this.bestScores = result.scores;
        this.newRecord = result.improved;
        this.recordedState = state;
        const button = ui.levels.children[this.levelIndex];
        button.querySelector('.level-record').textContent = `Рекорд: ${moveCount(this.bestScores[LEVELS[this.levelIndex].lesson])}`;
        button.querySelector('.level-check').hidden = false;
        button.setAttribute('aria-label', `${this.levelIndex + 1}. ${LEVELS[this.levelIndex].name}. Пройден. Рекорд: ${moveCount(this.bestScores[LEVELS[this.levelIndex].lesson])}`);
      }
      ui['victory-detail'].textContent = this.newRecord ? `За ${moveCount(moves)} · новый рекорд!` : `За ${moveCount(moves)} · лучший: ${this.bestScores[LEVELS[this.levelIndex].lesson]}`;
      ui['candy-box'].replaceChildren(...colors.flatMap(color => Array.from({ length: 4 }, () => {
        const cell = document.createElement('span'), candy = document.createElement('img'), symbol = document.createElement('span');
        cell.className = 'gift-candy';
        candy.src = `./assets/${COLORS[color].texture}.png?v=0.13.2`;
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
    this.updateHomeProgress();
    this.persistRun();
  }
}

new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', width: boardView().width * renderDensity, height: boardView().height * renderDensity, transparent: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: SortScene, input: { activePointers: 2 }, disableContextMenu: true,
  title: 'Magnetic Sort', version: '0.17.0'
});
