import { COLORS } from './levels.js?v=0.3.0';

// Presentation only. The resolver owns all moves; feedback never changes puzzle state.
export class SortFeedback {
  constructor(scene) {
    this.scene = scene;
    this.effects = new Set();
    this.tokens = new Set();
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
    for (const object of [...this.effects]) this.remove(object);
    for (const token of this.tokens) { token.getAnimations().forEach(animation => animation.cancel()); token.remove(); }
    this.tokens.clear();
    this.phase = 'idle';
  }
  animate(targets, config) {
    return new Promise(resolve => this.scene.tweens.add({ targets, ...config, onComplete: resolve }));
  }
  async fade(object, duration = 240) {
    await this.animate(object, { alpha: 0, duration, ease: 'Sine.easeOut' });
    this.remove(object);
  }
  rim(index, color, strong = false) {
    const { x, top } = this.scene.layout[index];
    const glow = this.own(this.scene.add.graphics().setDepth(6));
    glow.fillStyle(color, strong ? .2 : .1).fillRoundedRect(x - 38, top - 14, 76, 184, 18);
    glow.lineStyle(strong ? 4 : 2, color, .9).strokeRoundedRect(x - 40, top - 16, 80, 188, 19);
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
      fontSize: '24px', fontStyle: 'bold', color, stroke: '#101c2d', strokeThickness: 5 }).setOrigin(.5).setDepth(35));
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
        const startY = scene.layout[transfer.from].top - 24;
        await this.animate(ball, { y: startY, scaleX: .88, scaleY: 1.14, duration: 120,
          ease: 'Cubic.easeOut', onUpdate: trace });
        const start = { x: ball.x, y: ball.y };
        const end = { x: target.x, y: scene.layout[transfer.to].top - 24 };
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
      if (!this.gentle) {
        ball.setScale(1.22, .8);
        await this.animate(ball, { scaleX: 1, scaleY: 1, duration: 120, ease: 'Back.easeOut' });
      }
    }));
    this.phase = 'settle';
    return moving;
  }
  async collect(move, moving) {
    const scene = this.scene, { x, top } = scene.layout[move.destination], color = COLORS[move.color];
    const existing = [...scene.balls.entries()].filter(([key]) => key.startsWith(`${move.destination}:`)).map(([, ball]) => ball);
    const batch = [...existing, ...moving];
    this.phase = 'complete';
    this.rim(move.destination, color.fill, true);
    this.label(x, top + 64, '4 / 4', color.css);
    scene.playSound('complete');
    if (this.gentle) {
      await this.animate(batch, { alpha: 0, duration: 250, ease: 'Sine.easeInOut' });
    } else {
      await this.animate(batch, { scaleX: 1.15, scaleY: .86, duration: 75, yoyo: true, ease: 'Sine.easeInOut' });
      this.burst(x, top + 74, color.fill, 12);
      await this.animate(batch, { x, y: top + 74, scale: .4, alpha: 0, duration: 100, ease: 'Cubic.easeIn' });
      this.phase = 'collect';
      // A DOM token can cross the canvas edge and actually reach the HUD chip.
      const rect = scene.game.canvas.getBoundingClientRect();
      const chip = document.querySelector(`[data-color="${move.color}"]`).getBoundingClientRect();
      const from = { x: rect.x + x * rect.width / 480 - 14, y: rect.y + (top + 74) * rect.height / 520 - 14 };
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
    const title = this.own(scene.add.text(240, 246, 'Чисто!', { fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: '48px', fontStyle: 'bold', color: '#a5efde', stroke: '#101c2d', strokeThickness: 7 }).setOrigin(.5).setDepth(40));
    if (this.gentle) title.setAlpha(0);
    else title.setScale(.65);
    this.animate(title, { scale: 1, alpha: 1, duration: 260, ease: this.gentle ? 'Sine.easeOut' : 'Back.easeOut' });
    this.animate(title, { alpha: 0, delay: 1050, duration: 300 }).then(() => this.remove(title));
    this.burst(185, 247, 0x35d3b0, 10);
    this.burst(295, 247, 0xffd46f, 10);
  }
}
