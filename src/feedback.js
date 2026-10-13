import { COLORS } from './levels.js?v=0.6.0';

// Presentation only. The resolver owns all moves; feedback never changes puzzle state.
export class SortFeedback {
  constructor(scene) {
    this.scene = scene;
    this.effects = new Set();
    this.tokens = new Set();
    this.pressedBalls = new Map();
    this.pressEffects = new Set();
    this.cameraPulse = { progress: 0 };
    this.phase = 'idle';
    this.gentle = false;
    this.lastDuration = 0;
  }
  own(object) { this.effects.add(object); return object; }
  remove(object) {
    if (!this.effects.delete(object)) return;
    this.scene.tweens.killTweensOf(object);
    object.destroy();
  }
  reset() {
    this.releasePress();
    this.scene.tweens.killTweensOf(this.cameraPulse);
    this.scene.cameras.main.setScroll(0, 0);
    this.scene.sfx?.win?.stop();
    for (const object of [...this.effects]) this.remove(object);
    for (const token of this.tokens) { token.getAnimations().forEach(animation => animation.cancel()); token.remove(); }
    this.tokens.clear();
    this.phase = 'idle';
  }
  press(move) {
    this.releasePress();
    const s = this.scene.layout[0].scale;
    for (const transfer of move.transfers) {
      const ball = this.scene.balls.get(`${transfer.from}:${transfer.fromSlot}`);
      this.pressedBalls.set(ball, { y: ball.y });
      const halo = this.own(this.scene.add.graphics({ x: ball.x, y: ball.y }).setDepth(7).setName('press-halo'));
      halo.fillStyle(COLORS[move.color].fill, .13).fillCircle(0, 0, 25 * s);
      halo.lineStyle(2, 0xffffff, .65).strokeCircle(0, 0, 22 * s);
      this.pressEffects.add(halo);
      if (!this.scene.gentleMotion) {
        this.scene.tweens.add({ targets: ball, scaleX: 1.18, scaleY: .82, y: ball.y + 3, duration: 85, ease: 'Quad.easeOut' });
        this.scene.tweens.add({ targets: halo, scale: 1.15, alpha: .55, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }
  releasePress() {
    for (const [ball, rest] of this.pressedBalls) {
      this.scene.tweens.killTweensOf(ball);
      if (ball.scene) ball.setScale(1).setY(rest.y);
    }
    this.pressedBalls.clear();
    for (const halo of this.pressEffects) this.remove(halo);
    this.pressEffects.clear();
  }
  reject(index) {
    this.releasePress();
    const { x, top, scale: s } = this.scene.layout[index];
    const ring = this.own(this.scene.add.graphics({ x, y: top + 76 * s }).setDepth(7).setName('reject-ring'));
    ring.lineStyle(3, 0xffd46f, .8).strokeRoundedRect(-37 * s, -89 * s, 74 * s, 184 * s, 18 * s);
    this.fade(ring, 240);
  }
  landing(x, y, color) {
    if (this.gentle) return;
    const s = this.scene.layout[0].scale;
    const ring = this.own(this.scene.add.graphics({ x, y: y + 17 * s }).setDepth(24).setName('landing-ring'));
    ring.lineStyle(2, color, .85).strokeEllipse(0, 0, 32 * s, 9 * s);
    this.animate(ring, { scaleX: 2.1, scaleY: 1.5, alpha: 0, duration: 230, ease: 'Cubic.easeOut' }).then(() => this.remove(ring));
    const glint = this.own(this.scene.add.graphics({ x: x - 10 * s, y: y - 12 * s }).setDepth(24).setName('landing-glint'));
    glint.fillStyle(0xfff4d9).fillTriangle(0, -8, 3, 0, -3, 0).fillTriangle(0, 8, 3, 0, -3, 0)
      .fillTriangle(-6, 0, 0, -2, 0, 2).fillTriangle(6, 0, 0, -2, 0, 2);
    this.animate(glint, { scale: 1.4, alpha: 0, duration: 190, ease: 'Sine.easeOut' }).then(() => this.remove(glint));
    for (const side of [-1, 1]) {
      const dust = this.own(this.scene.add.graphics({ x: x + side * 14, y: y + 12 }).setDepth(23).setName('landing-spark'));
      dust.fillStyle(color, .85).fillCircle(0, 0, 2.5);
      this.animate(dust, { x: x + side * 32, y: y - 7, scale: .2, alpha: 0, duration: 240, ease: 'Cubic.easeOut' }).then(() => this.remove(dust));
    }
  }
  charge(x, y, color) {
    if (this.gentle) return;
    const aura = this.own(this.scene.add.graphics({ x, y }).setDepth(1).setName('charge-aura'));
    aura.fillStyle(color, .14).fillCircle(0, 0, 75).fillStyle(color, .16).fillCircle(0, 0, 45);
    this.animate(aura, { scale: 1.3, alpha: 0, duration: 390, ease: 'Sine.easeOut' }).then(() => this.remove(aura));
    for (let index = 0; index < 8; index++) {
      const angle = Math.PI * 2 * index / 8;
      const spark = this.own(this.scene.add.graphics({ x: x + Math.cos(angle) * 66, y: y + Math.sin(angle) * 66 }).setDepth(26).setName('charge-spark'));
      spark.fillStyle(color, .9).fillCircle(0, 0, 3);
      this.animate(spark, { x, y, scale: .25, duration: 180, ease: 'Cubic.easeIn' }).then(() => this.remove(spark));
    }
  }
  impact(x, y, color) {
    if (this.gentle) return;
    // A bounded, damped visual impulse. Input is still locked for collection.
    const camera = this.scene.cameras.main, pulse = this.cameraPulse;
    this.scene.tweens.killTweensOf(pulse);
    pulse.progress = 0;
    this.scene.tweens.add({ targets: pulse, progress: 1, duration: 180, ease: 'Linear', onUpdate: () => {
      const t = pulse.progress, amplitude = 3 * (1 - t) ** 2;
      camera.setScroll(Math.sin(t * Math.PI * 4) * amplitude, Math.sin(t * Math.PI * 3) * amplitude * .7);
    }, onComplete: () => camera.setScroll(0, 0) });
    const wave = this.own(this.scene.add.graphics({ x, y }).setDepth(25).setName('collection-wave'));
    wave.lineStyle(3, color, .8).strokeCircle(0, 0, 24);
    this.animate(wave, { scale: 4, alpha: 0, duration: 360, ease: 'Cubic.easeOut' }).then(() => this.remove(wave));
  }
  animate(targets, config) {
    return new Promise(resolve => this.scene.tweens.add({ targets, ...config, onComplete: resolve }));
  }
  async fade(object, duration = 240) {
    await this.animate(object, { alpha: 0, duration, ease: 'Sine.easeOut' });
    this.remove(object);
  }
  rim(index, color, strong = false) {
    const { x, top, scale: s } = this.scene.layout[index];
    const glow = this.own(this.scene.add.graphics().setDepth(6));
    glow.fillStyle(color, strong ? .2 : .1).fillRoundedRect(x - 38 * s, top - 14 * s, 76 * s, 184 * s, 18 * s);
    glow.lineStyle(strong ? 4 : 2, color, .9).strokeRoundedRect(x - 40 * s, top - 16 * s, 80 * s, 188 * s, 19 * s);
    this.fade(glow, strong ? 360 : 200);
  }
  burst(x, y, color, count = 9) {
    if (this.gentle) return;
    const ring = this.own(this.scene.add.graphics({ x, y }).setDepth(25));
    ring.lineStyle(3, color, .85).strokeCircle(0, 0, 19);
    this.animate(ring, { scale: 2.2, alpha: 0, duration: 330, ease: 'Cubic.easeOut' }).then(() => this.remove(ring));
    for (let index = 0; index < count; index++) {
      const angle = Math.PI * 2 * index / count;
      const distance = 30 + index % 3 * 12;
      const spark = this.own(this.scene.add.graphics({ x, y }).setDepth(25));
      spark.fillStyle(index % 3 ? color : 0xfff3d5).fillCircle(0, 0, index % 2 ? 3 : 2);
      this.animate(spark, { x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance,
        scale: .15, alpha: 0, duration: 300 + index % 3 * 70, ease: 'Cubic.easeOut' }).then(() => this.remove(spark));
    }
  }
  label(x, y, message, color) {
    const label = this.own(this.scene.add.text(x, y, message, { fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: '24px', fontStyle: 'bold', color, stroke: '#fffaf3', strokeThickness: 5 })
      .setResolution(this.scene.game.canvas.width / 480).setOrigin(.5).setDepth(35));
    this.animate(label, { y: y - (this.gentle ? 0 : 20), alpha: 0, delay: 260, duration: 340,
      ease: 'Sine.easeOut' }).then(() => this.remove(label));
  }
  async gather(move, counts) {
    this.phase = 'anticipation';
    this.started = performance.now();
    const scene = this.scene, tint = COLORS[move.color].fill;
    const moving = move.transfers.map(transfer => scene.balls.get(`${transfer.from}:${transfer.fromSlot}`));
    this.rim(move.destination, tint);
    if (this.gentle) await scene.delay(90);
    else await this.animate(moving, { scaleX: 1.14, scaleY: .86, duration: 85, ease: 'Quad.easeOut' });
    scene.clearPreview(false);
    scene.emptyLabels.get(move.destination)?.setVisible(false);
    scene.playSound('pickup');
    this.phase = 'gather';
    await Promise.all(move.transfers.map(async (transfer, order) => {
      const ball = moving[order];
      const target = scene.position(transfer.to, transfer.toSlot);
      await scene.delay(order * (this.gentle ? 30 : 55) + 1);
      counts[transfer.from]--;
      scene.fillLabels.get(transfer.from).setText(`${transfer.from + 1}  ·  ${counts[transfer.from]}/4`);
      ball.setDepth(20 + order);
      if (this.gentle) {
        // No spatial travel, but a readable transition instead of the old 1 ms teleport.
        await this.animate(ball, { alpha: .12, duration: 140, ease: 'Sine.easeInOut' });
        ball.setPosition(target.x, target.y);
        await this.animate(ball, { alpha: 1, duration: 170, ease: 'Sine.easeOut' });
      } else {
        const trail = this.own(scene.add.graphics().setDepth(18));
        const points = [];
        const trace = () => {
          points.push({ x: ball.x, y: ball.y });
          if (points.length > 6) points.shift();
          trail.clear();
          for (let index = 1; index < points.length; index++) {
            trail.lineStyle(index * 1.6, tint, index / points.length * .23)
              .lineBetween(points[index - 1].x, points[index - 1].y, points[index].x, points[index].y);
          }
        };
        const startY = scene.layout[transfer.from].top - 24 * scene.layout[transfer.from].scale;
        await this.animate(ball, { y: startY, scaleX: .88, scaleY: 1.14, duration: 120,
          ease: 'Cubic.easeOut', onUpdate: trace });
        const start = { x: ball.x, y: ball.y };
        const end = { x: target.x, y: scene.layout[transfer.to].top - 24 * scene.layout[transfer.to].scale };
        const arc = { progress: 0 };
        const dx = end.x - start.x;
        const controls = [Math.max(14, start.y - 48), Math.max(14, end.y - 48)];
        await this.animate(arc, { progress: 1, duration: 230, ease: 'Sine.easeInOut', onUpdate: () => {
          const t = arc.progress, u = 1 - t;
          ball.x = u ** 3 * start.x + 3 * u * u * t * (start.x + dx * .35) + 3 * u * t * t * (end.x - dx * .35) + t ** 3 * end.x;
          ball.y = u ** 3 * start.y + 3 * u * u * t * controls[0] + 3 * u * t * t * controls[1] + t ** 3 * end.y;
          ball.setScale(1.08, .94);
          trace();
        } });
        await this.animate(ball, { x: target.x, y: target.y, scaleX: .9, scaleY: 1.12,
          duration: 130, ease: 'Cubic.easeIn', onUpdate: trace });
        this.fade(trail, 100);
      }
      counts[transfer.to]++;
      scene.fillLabels.get(transfer.to).setText(`${transfer.to + 1}  ·  ${counts[transfer.to]}/4`);
      scene.playSound('land', { rate: 1 + order * .07, volume: .65 });
      this.rim(transfer.to, tint);
      this.landing(target.x, target.y, tint);
      if (!this.gentle) {
        ball.setScale(1.22, .8);
        await this.animate(ball, { scaleX: 1, scaleY: 1, duration: 120, ease: 'Back.easeOut' });
      }
    }));
    this.phase = 'settle';
    return moving;
  }
  async collect(move, moving) {
    const scene = this.scene, { x, top, scale: s } = scene.layout[move.destination], color = COLORS[move.color];
    const centerY = top + 74 * s;
    const existing = [...scene.balls.entries()].filter(([key]) => key.startsWith(`${move.destination}:`)).map(([, ball]) => ball);
    const batch = [...existing, ...moving];
    this.phase = 'complete';
    this.rim(move.destination, color.fill, true);
    this.label(x, top - 5 * s, '4 / 4', color.ink || '#5e3978');
    this.charge(x, centerY, color.fill);
    if (this.gentle) {
      scene.playSound('complete', { rate: 1 + (scene.session.state.cleared.length - 1) * .04 });
      await this.animate(batch, { alpha: 0, duration: 250, ease: 'Sine.easeInOut' });
    } else {
      await this.animate(batch, { scaleX: 1.15, scaleY: .86, duration: 75, yoyo: true, ease: 'Sine.easeInOut' });
      scene.playSound('complete', { rate: 1 + (scene.session.state.cleared.length - 1) * .04 });
      this.burst(x, centerY, color.fill, 12);
      this.impact(x, centerY, color.fill);
      await this.animate(batch, { x, y: centerY, scale: .4, alpha: 0, duration: 100, ease: 'Cubic.easeIn' });
      this.phase = 'collect';
      // A DOM token can cross the canvas edge and actually reach the HUD chip.
      const rect = scene.game.canvas.getBoundingClientRect();
      const chip = document.querySelector(`[data-color="${move.color}"]`).getBoundingClientRect();
      const from = { x: rect.x + x * rect.width / 480 - 14, y: rect.y + centerY * rect.height / 520 - 14 };
      const to = { x: chip.x + chip.width / 2 - 14, y: chip.y + chip.height / 2 - 14 };
      const token = document.createElement('span');
      token.className = 'collection-token';
      token.style.setProperty('--color', color.css);
      token.textContent = color.symbol;
      token.setAttribute('aria-hidden', 'true');
      document.body.append(token);
      this.tokens.add(token);
      const transform = (point, scale) => `translate(${point.x}px, ${point.y}px) scale(${scale})`;
      const animation = token.animate([
        { transform: transform(from, 1.2), opacity: 1 },
        { transform: transform({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 24 }, 1), opacity: 1, offset: .5 },
        { transform: transform(to, .8), opacity: .8 }
      ], { duration: 280, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
      await animation.finished.catch(() => {});
      token.remove();
      this.tokens.delete(token);
    }
  }
  finish() {
    this.lastDuration = Math.round(performance.now() - this.started);
    this.phase = 'idle';
  }
  celebrate() {
    const scene = this.scene;
    scene.playSound('win', { volume: .8 });
    const halo = this.own(scene.add.graphics({ x: 240, y: 246 }).setDepth(30).setName('victory-halo'));
    halo.fillStyle(0x35d3b0, .08).fillCircle(0, 0, 105).fillStyle(0x35d3b0, .1).fillCircle(0, 0, 75);
    this.animate(halo, { scale: this.gentle ? 1 : 1.8, alpha: 0, duration: 950, ease: 'Sine.easeOut' }).then(() => this.remove(halo));
    if (!this.gentle) for (let index = 0; index < 32; index++) {
      const side = index % 2 ? 1 : -1, startX = side < 0 ? 80 : 400;
      const confetti = this.own(scene.add.graphics({ x: startX, y: 220 }).setDepth(36).setName('confetti'));
      confetti.fillStyle([0x35d3b0, 0xff8f78, 0xffd46f, 0x91a7ff][index % 4]).fillRect(-3, -5, 6, 10);
      confetti.progress = 0;
      this.animate(confetti, { progress: 1, rotation: side * (4 + index % 4), duration: 1050 + index % 5 * 80,
        ease: 'Linear', onUpdate: () => {
          const t = confetti.progress;
          confetti.setPosition(startX - side * (40 + index % 8 * 19) * t, 220 - (130 + index % 6 * 23) * t + 340 * t * t);
          confetti.setAlpha(Math.min(1, (1 - t) * 4)).setScale(Math.max(.2, Math.abs(Math.cos(t * Math.PI * 3))), 1);
        } }).then(() => this.remove(confetti));
    }
    this.burst(185, 247, 0x35d3b0, 10);
    this.burst(295, 247, 0xffd46f, 10);
  }
}
