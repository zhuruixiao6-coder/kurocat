import {
  ACCESSORY_ART,
  EFFECT_ART,
  EFFECT_TRIGGER,
  accessoryVisible,
  type ActivityState,
  type FxMotion,
} from './collectibles';
import { drawAccessory } from './accRenderer';
import { drawFxParticle, hexA, motionOfEffect, shapeOfEffect, type FxShape } from './fxDraw';

export interface ScreenAnchor {
  x: number;
  y: number;
  s: number;
  dir: number;
}

/** 3D 模式下的配饰层：一张透明画布盖在 WebGL 画布上，按投影出来的锚点绘制 */
export class AccOverlay {
  private ctx: CanvasRenderingContext2D;
  private equipped: Record<string, string> = {};
  private triggers: Record<string, string> = {};
  private totalKeys = 0;

  private lastKeyAt = 0;
  private keyStamps: number[] = [];
  private streakStart = 0;
  private clickUntil = 0;
  private feedUntil = 0;
  private toggled = false;
  private fxId: string | null = null;
  private keyCount = 0;
  private particles: Array<{
    icon: string;
    shape: FxShape;
    color: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    rot: number;
    spin: number;
    born: number;
    life: number;
    motion: FxMotion;
  }> = [];
  /** 猫头在屏幕上的位置：粒子从这里冒出来，而不是屏幕正中 */
  private origin = { x: 0, y: 0, has: false };
  private auraUntil = 0;
  /** 常驻特效的环境粒子节拍 */
  private nextAmbientAt = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
  }

  public setCollectibles(equipped: Record<string, string>, triggers: Record<string, string>, totalKeys: number): void {
    this.equipped = equipped || {};
    if (triggers) this.triggers = triggers;
    this.totalKeys = totalKeys || 0;
    const fx = this.equipped['fx'];
    const next = fx && EFFECT_ART[fx] ? fx : null;
    if (next !== this.fxId) this.nextAmbientAt = 0;
    this.fxId = next;
  }

  public setTriggers(triggers: Record<string, string>): void {
    this.triggers = triggers || {};
  }

  public notifyKey(): void {
    const now = performance.now();
    this.lastKeyAt = now;
    this.keyStamps.push(now);
    if (this.keyStamps.length > 24) this.keyStamps.shift();
    if (!this.streakStart) this.streakStart = now;
    this.keyCount += 1;

    const fx = this.fxId;
    if (!fx) return;
    const trig = EFFECT_TRIGGER[fx];
    if (!trig) return;
    switch (trig.kind) {
      case 'always':
        this.spawn(3);
        break;
      case 'everyN':
        if (this.keyCount % trig.n === 0) this.spawn(3);
        break;
      case 'typing':
        this.spawn(1);
        break;
      case 'combo':
        if (this.keyStamps.length >= 6) this.spawn(2);
        break;
      case 'streak':
        if (this.streakStart && now - this.streakStart > 30000) this.spawn(2);
        break;
      case 'milestone':
        if (this.totalKeys > 0 && this.totalKeys % trig.n === 0) this.spawn(6);
        break;
      default:
        break;
    }
  }

  private spawn(count: number): void {
    const fx = this.fxId;
    if (!fx) return;
    const art = EFFECT_ART[fx];
    if (!art) return;
    const now = performance.now();
    const base = this.origin.has
      ? this.origin
      : { x: window.innerWidth * 0.5, y: window.innerHeight * 0.45 };
    const shape = shapeOfEffect(art.name, art.icon);
    const motion = motionOfEffect(art.name, art.motion);

    for (let i = 0; i < count; i += 1) {
      let x = base.x + (Math.random() - 0.5) * 78;
      let y = base.y + (Math.random() - 0.5) * 46;
      let vx = (Math.random() - 0.5) * 26;
      let vy = -(20 + Math.random() * 26);

      switch (motion) {
        case 'rise':
          vy = -(26 + Math.random() * 34);
          break;
        case 'fall':
          y = base.y - 46 - Math.random() * 56;
          vy = 24 + Math.random() * 30;
          break;
        case 'burst': {
          const ang = Math.random() * Math.PI * 2;
          const sp = 52 + Math.random() * 54;
          vx = Math.cos(ang) * sp;
          vy = Math.sin(ang) * sp;
          break;
        }
        case 'orbit': {
          const ang = Math.random() * Math.PI * 2;
          x = base.x + Math.cos(ang) * 92;
          y = base.y + Math.sin(ang) * 34;
          vx = -Math.sin(ang) * 34;
          vy = Math.cos(ang) * 12;
          break;
        }
        case 'ring': {
          const ang = Math.random() * Math.PI * 2;
          x = base.x + Math.cos(ang) * 44;
          y = base.y + Math.sin(ang) * 20;
          vx = Math.cos(ang) * 30;
          vy = Math.sin(ang) * 12;
          break;
        }
        case 'trail':
          x = base.x + (Math.random() - 0.5) * 34;
          y = base.y + (Math.random() - 0.5) * 24;
          vx = (Math.random() - 0.5) * 44;
          vy = 8 + Math.random() * 16;
          break;
        case 'aura': {
          const ang = Math.random() * Math.PI * 2;
          x = base.x + Math.cos(ang) * 64;
          y = base.y + Math.sin(ang) * 28;
          vx = Math.cos(ang) * 10;
          vy = 8 + Math.random() * 10;
          break;
        }
        default:
          break;
      }

      this.particles.push({
        icon: art.icon,
        shape,
        color: art.color,
        x,
        y,
        vx,
        vy,
        size: art.motion === 'aura' || art.motion === 'ring' ? 8 + Math.random() * 5 : 10 + Math.random() * 7,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 3.2,
        born: now,
        life: 900 + Math.random() * 900,
        motion: art.motion,
      });
    }
    if (this.particles.length > 80) this.particles.splice(0, this.particles.length - 80);
    if (art.motion === 'aura' || art.motion === 'orbit' || art.motion === 'ring') {
      this.auraUntil = now + 1500;
    }
  }

  public notifyAction(action: 'click' | 'feed' | 'toggle' | 'wake'): void {
    const now = performance.now();
    this.lastKeyAt = now;
    if (action === 'click') this.clickUntil = now + 6000;
    if (action === 'feed') this.feedUntil = now + 12000;
    if (action === 'toggle') this.toggled = !this.toggled;
  }

  private state(): ActivityState {
    const now = performance.now();
    this.keyStamps = this.keyStamps.filter((t) => now - t < 1000);
    const idleSeconds = this.lastKeyAt ? (now - this.lastKeyAt) / 1000 : 0;
    return {
      typingActive: idleSeconds < 1.6,
      combo: this.keyStamps.length,
      idleSeconds,
      typingStreak: this.streakStart ? (now - this.streakStart) / 1000 : 0,
      toggled: this.toggled,
      clickPulse: now < this.clickUntil,
      feedPulse: now < this.feedUntil,
      hoverHead: false,
      stretchPulse: false,
      totalKeys: this.totalKeys,
    };
  }

  public resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** anchors: slot -> 屏幕坐标 */
  /** 常驻特效：不等按键也在持续冒粒子，按节奏稀疏一些，避免糊屏 */
  private ambientParticles(now: number): void {
    if (!this.fxId) return;
    const art = EFFECT_ART[this.fxId];
    if (!art) return;
    // 光环/环绕类本身就是持续视觉，粒子少一点；爆发类多给一点
    const interval = art.motion === 'aura' || art.motion === 'orbit' || art.motion === 'ring' ? 260 : 180;
    if (now < this.nextAmbientAt) return;
    this.nextAmbientAt = now + interval;
    this.spawn(1);
    if (art.motion === 'aura' || art.motion === 'orbit' || art.motion === 'ring') {
      this.auraUntil = now + 1200;
    }
  }

  public draw(anchors: Record<string, ScreenAnchor>): void {
    const ctx = this.ctx;
    const head = anchors?.['head'] ?? anchors?.['face'] ?? anchors?.['neck'];
    if (head) {
      this.origin = { x: head.x, y: head.y + 26 * head.s, has: true };
    }
    this.ambientParticles(performance.now());
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // 配饰已经改成 3D 真几何体（挂 headMount / neckMount / catRoot，参与深度遮挡），
    // 这里只负责特效粒子，绝不再往 3D 画面上盖一层 2D 贴纸。
    this.drawParticles();
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    const now = performance.now();
    const fx = this.fxId;
    const art = fx ? EFFECT_ART[fx] : null;
    const base = this.origin.has
      ? this.origin
      : { x: window.innerWidth * 0.5, y: window.innerHeight * 0.42 };

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 常驻光环：环绕猫头的柔光，不再画在屏幕正中
    if (art && now < this.auraUntil && (art.motion === 'aura' || art.motion === 'ring' || art.motion === 'orbit')) {
      const cross = ctx.createRadialGradient(base.x, base.y, 6, base.x, base.y, 96);
      cross.addColorStop(0, hexA(art.color, 0.24));
      cross.addColorStop(0.55, hexA(art.color, 0.10));
      cross.addColorStop(1, hexA(art.color, 0));
      ctx.fillStyle = cross;
      ctx.beginPath();
      ctx.ellipse(base.x, base.y, 96, 60, 0, 0, Math.PI * 2);
      ctx.fill();

      if (art.motion === 'ring') {
        for (let i = 0; i < 3; i += 1) {
          const t = ((now / 1400 + i / 3) % 1);
          const r = 26 + t * 70;
          ctx.strokeStyle = hexA(art.color, (1 - t) * 0.55);
          ctx.lineWidth = 1.6 * (1 - t) + 0.5;
          ctx.beginPath();
          ctx.ellipse(base.x, base.y, r, r * 0.40, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    for (const p of this.particles) {
      const age = now - p.born;
      const k = age / p.life;
      if (k >= 1) continue;
      const dt = age / 1000;
      const ease = 1 - Math.pow(1 - Math.min(1, k), 2);
      // 上浮的越飘越快、下落的带一点重力、爆发的会减速
      const drag = p.motion === 'burst' ? 1 - Math.min(0.65, dt * 1.5) : 1;
      const x = p.x + p.vx * dt * (p.motion === 'burst' ? 1 : 1 + dt * 0.25);
      const y =
        p.y +
        p.vy * dt * (p.motion === 'burst' ? 1 : 1 + dt * 0.2) +
        (p.motion === 'fall' ? 26 * dt * dt : 0);
      void drag;
      const alpha = k < 0.16 ? k / 0.16 : 1 - (k - 0.16) / 0.84;
      const size = p.size * (0.55 + 0.65 * ease);
      drawFxParticle(
        ctx,
        p.shape,
        p.color,
        x,
        y,
        size,
        p.rot + p.spin * dt,
        Math.max(0, alpha) * 0.82,
      );
    }

    // 十字星光：亮核在叠加混合下补一点点白，更有「发光」感
    ctx.restore();
    this.particles = this.particles.filter((p) => now - p.born < p.life);
  }
}
