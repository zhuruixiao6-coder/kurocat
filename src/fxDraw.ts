/**
 * 特效粒子的绘制：不用 emoji 字体，改成真正画出来的发光图形。
 *
 * 350 件特效共用这一套画笔 —— 形状按 emoji 归类（星星 / 心 / 花瓣 /
 * 叶子 / 雪 / 火 / 水珠 / 泡泡 / 音符 / 铜钱 / 蝴蝶 / 糖果），
 * 统一带径向光晕 + 描边 + 旋转，深色桌面上看起来是「光」而不是贴纸。
 */

export type FxShape =
  | 'star'
  | 'heart'
  | 'petal'
  | 'leaf'
  | 'snow'
  | 'flame'
  | 'drop'
  | 'bubble'
  | 'note'
  | 'coin'
  | 'candy'
  | 'bug'
  | 'ribbon'
  | 'glyph'
  | 'bolt'
  | 'feather'
  | 'cloud'
  | 'paw'
  | 'spark';

const ICON_SHAPE: Array<[RegExp, FxShape]> = [
  [/[⭐✨🌟💫✴️❇️🌠]/u, 'star'],
  [/[❤💖💗💕💞💓💘🧡💛💚💙💜🤍🖤]/u, 'heart'],
  [/[🌸🌺🌷🌹💮🏵️🌼]/u, 'petal'],
  [/[🍁🍂🍃🌿🍀]/u, 'leaf'],
  [/[❄🌨🌬️]/u, 'snow'],
  [/[🔥🕯️]/u, 'flame'],
  [/[💧💦🌊]/u, 'drop'],
  [/[🫧⚪⭕🔵💠]/u, 'bubble'],
  [/[🎵🎶♪♫🎼]/u, 'note'],
  [/[🪙💰👑💎]/u, 'coin'],
  [/[🍬🍭🍩🍪🧁]/u, 'candy'],
  [/[🦋🐝🐞🪰]/u, 'bug'],
];


/** 按特效名字判断形状（名字比 emoji 具体得多：枫叶/泡泡/代码符…） */
const NAME_SHAPE: Array<[RegExp, FxShape]> = [
  [/枫叶|秋叶|落叶|树叶|叶子|绿叶|叶/, 'leaf'],
  [/樱花|花瓣|桃花|梅花|花朵|花/, 'petal'],
  [/泡泡|气泡|皂泡|泡/, 'bubble'],
  [/雪|霜|冰晶|冰花/, 'snow'],
  [/雨|水滴|水珠|泪|涟漪|波纹|水波/, 'drop'],
  [/火焰|火苗|篝火|烛光|火/, 'flame'],
  [/爱心|心形|恋爱|心动|比心|心/, 'heart'],
  [/音符|旋律|音乐|歌声|曲子|乐谱/, 'note'],
  [/星星|星光|星尘|流星|璀璨|闪耀|闪光|星/, 'star'],
  [/金币|硬币|铜钱|财宝|钻石|元宝|钱/, 'coin'],
  [/糖果|甜甜圈|蛋糕|饼干|布丁|棒棒糖/, 'candy'],
  [/蝴蝶|萤火虫|蜜蜂|甲虫|小虫/, 'bug'],
  [/彩带|飘带|丝带|礼花|彩纸|极光/, 'ribbon'],
  [/代码|字符|像素|文字|数字|符号|指令/, 'glyph'],
  [/闪电|雷电|电光|电弧/, 'bolt'],
  [/羽毛|绒羽|羽/, 'feather'],
  [/云雾|云朵|雾气|烟雾|霾|云/, 'cloud'],
  [/爪印|脚印|肉垫|小爪|爪/, 'paw'],
];

/** 名字里带方向词时，覆盖目录里的默认运动方式 */
export function motionOfEffect(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  if (/上升|升腾|升起|飘起|浮起|升空/.test(name)) return 'rise';
  if (/飘落|落下|坠落|秋叶|落叶|雪|雨滴|下雨/.test(name)) return 'fall';
  if (/环绕|旋绕|盘旋|围绕/.test(name)) return 'orbit';
  if (/爆发|暴击|迸发|炸裂|烟花|礼花|彩带/.test(name)) return 'burst';
  if (/光晕|光圈|呼吸|涟漪|极光|光环/.test(name)) return 'aura';
  if (/拖尾|尾迹|轨迹|拖影/.test(name)) return 'trail';
  return fallback;
}

export function shapeOfEffect(name: string | undefined, icon: string): FxShape {
  if (name) {
    for (const [re, shape] of NAME_SHAPE) {
      if (re.test(name)) return shape;
    }
  }
  return shapeOf(icon);
}

export function shapeOf(icon: string): FxShape {
  for (const [re, shape] of ICON_SHAPE) {
    if (re.test(icon)) return shape;
  }
  return 'spark';
}

function starPath(ctx: CanvasRenderingContext2D, r: number, points = 5, inner = 0.44): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const rad = i % 2 ? r * inner : r;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function heartPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, r * 0.72);
  ctx.bezierCurveTo(-r * 1.35, -r * 0.18, -r * 0.56, -r * 1.05, 0, -r * 0.34);
  ctx.bezierCurveTo(r * 0.56, -r * 1.05, r * 1.35, -r * 0.18, 0, r * 0.72);
  ctx.closePath();
}

function petalPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, r * 1.02);
  ctx.bezierCurveTo(-r * 0.95, r * 0.25, -r * 0.62, -r * 0.92, 0, -r * 1.02);
  ctx.bezierCurveTo(r * 0.62, -r * 0.92, r * 0.95, r * 0.25, 0, r * 1.02);
  ctx.closePath();
}

function leafPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r * 0.95, -r * 0.1, 0, r);
  ctx.quadraticCurveTo(-r * 0.95, -r * 0.1, 0, -r);
  ctx.closePath();
}

function dropPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.bezierCurveTo(r * 0.75, -r * 0.15, r * 0.62, r * 0.92, 0, r * 0.92);
  ctx.bezierCurveTo(-r * 0.62, r * 0.92, -r * 0.75, -r * 0.15, 0, -r);
  ctx.closePath();
}

function flamePath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r * 0.55, -r * 0.15, r * 0.42, r * 0.42);
  ctx.quadraticCurveTo(r * 0.28, r * 0.92, 0, r * 0.92);
  ctx.quadraticCurveTo(-r * 0.34, r * 0.92, -r * 0.44, r * 0.38);
  ctx.quadraticCurveTo(-r * 0.52, -r * 0.28, -r * 0.16, -r * 0.52);
  ctx.quadraticCurveTo(0, -r * 0.72, 0, -r);
  ctx.closePath();
}

function snowPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    // 两侧小叉
    for (const s of [-1, 1] as const) {
      const bx = Math.cos(a) * r * 0.55;
      const by = Math.sin(a) * r * 0.55;
      const ba = a + s * 0.75;
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(ba) * r * 0.36, by + Math.sin(ba) * r * 0.36);
    }
  }
}

function notePath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.ellipse(-r * 0.36, r * 0.62, r * 0.42, r * 0.32, -0.4, 0, Math.PI * 2);
  ctx.closePath();
  ctx.rect(r * -0.06, -r * 0.9, r * 0.16, r * 1.55);
  ctx.moveTo(r * 0.1, -r * 0.9);
  ctx.quadraticCurveTo(r * 0.85, -r * 0.66, r * 0.62, -r * 0.12);
  ctx.quadraticCurveTo(r * 0.44, -r * 0.5, r * 0.1, -r * 0.5);
  ctx.closePath();
}

function bubblePath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.closePath();
}

function coinPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
  const h = r * 0.34;
  ctx.moveTo(-h, -h);
  ctx.lineTo(h, -h);
  ctx.lineTo(h, h);
  ctx.lineTo(-h, h);
  ctx.closePath();
}

function candyPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.62, r * 0.46, 0, 0, Math.PI * 2);
  ctx.moveTo(-r * 0.55, 0);
  ctx.lineTo(-r * 1.15, -r * 0.5);
  ctx.lineTo(-r * 1.02, 0);
  ctx.lineTo(-r * 1.15, r * 0.5);
  ctx.closePath();
  ctx.moveTo(r * 0.55, 0);
  ctx.lineTo(r * 1.15, -r * 0.5);
  ctx.lineTo(r * 1.02, 0);
  ctx.lineTo(r * 1.15, r * 0.5);
  ctx.closePath();
}

function bugPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  // 右上翅
  ctx.moveTo(0, -r * 0.1);
  ctx.bezierCurveTo(r * 0.5, -r * 1.15, r * 1.2, -r * 0.85, r * 0.86, -r * 0.05);
  // 右下翅
  ctx.bezierCurveTo(r * 1.15, r * 0.55, r * 0.55, r * 0.85, 0, r * 0.22);
  // 左下翅
  ctx.bezierCurveTo(-r * 0.55, r * 0.85, -r * 1.15, r * 0.55, -r * 0.86, -r * 0.05);
  // 左上翅
  ctx.bezierCurveTo(-r * 1.2, -r * 0.85, -r * 0.5, -r * 1.15, 0, -r * 0.1);
  ctx.closePath();
  // 身体
  ctx.moveTo(0, -r * 0.62);
  ctx.ellipse(0, 0, r * 0.13, r * 0.66, 0, 0, Math.PI * 2);
}

function sparkPath(ctx: CanvasRenderingContext2D, r: number): void {
  // 四角闪光：细长的十字 + 中心亮核
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.25);
  ctx.quadraticCurveTo(r * 0.16, -r * 0.18, r * 1.15, 0);
  ctx.quadraticCurveTo(r * 0.16, r * 0.18, 0, r * 1.25);
  ctx.quadraticCurveTo(-r * 0.16, r * 0.18, -r * 1.15, 0);
  ctx.quadraticCurveTo(-r * 0.16, -r * 0.18, 0, -r * 1.25);
  ctx.closePath();
}


function ribbonPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(-r * 1.25, -r * 0.35);
  ctx.bezierCurveTo(-r * 0.5, -r * 0.95, r * 0.25, r * 0.15, r * 1.25, -r * 0.45);
  ctx.lineTo(r * 1.25, r * 0.05);
  ctx.bezierCurveTo(r * 0.25, r * 0.7, -r * 0.5, -r * 0.35, -r * 1.25, r * 0.25);
  ctx.closePath();
}

function glyphPath(ctx: CanvasRenderingContext2D, r: number): void {
  const w = r * 0.92;
  const h = r * 0.86;
  const rad = r * 0.2;
  ctx.beginPath();
  ctx.moveTo(-w + rad, -h);
  ctx.arcTo(w, -h, w, h, rad);
  ctx.arcTo(w, h, -w, h, rad);
  ctx.arcTo(-w, h, -w, -h, rad);
  ctx.arcTo(-w, -h, w, -h, rad);
  ctx.closePath();
}

function boltPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(r * 0.18, -r * 1.1);
  ctx.lineTo(-r * 0.62, r * 0.12);
  ctx.lineTo(-r * 0.06, r * 0.12);
  ctx.lineTo(-r * 0.24, r * 1.1);
  ctx.lineTo(r * 0.64, -r * 0.16);
  ctx.lineTo(r * 0.06, -r * 0.16);
  ctx.closePath();
}

function featherPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, r * 1.05);
  ctx.bezierCurveTo(-r * 0.5, r * 0.3, -r * 0.42, -r * 0.75, r * 0.12, -r * 1.05);
  ctx.bezierCurveTo(r * 0.5, -r * 0.7, r * 0.55, r * 0.25, 0, r * 1.05);
  ctx.closePath();
  // 羽轴
  ctx.moveTo(r * 0.04, r * 1.0);
  ctx.quadraticCurveTo(-r * 0.06, r * 0.1, r * 0.12, -r * 1.0);
}

function cloudPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.arc(-r * 0.55, r * 0.18, r * 0.40, Math.PI * 0.55, Math.PI * 1.5);
  ctx.arc(-r * 0.08, -r * 0.22, r * 0.52, Math.PI * 1.15, Math.PI * 1.9);
  ctx.arc(r * 0.46, -r * 0.02, r * 0.44, Math.PI * 1.5, Math.PI * 0.45);
  ctx.lineTo(-r * 0.55, r * 0.58);
  ctx.closePath();
}

function pawPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.ellipse(0, r * 0.34, r * 0.62, r * 0.5, 0, 0, Math.PI * 2);
  for (let i = 0; i < 3; i += 1) {
    const a = -Math.PI * 0.78 + i * Math.PI * 0.28;
    ctx.moveTo(Math.cos(a) * r * 0.78 + r * 0.24, Math.sin(a) * r * 0.66 - r * 0.42 + r * 0.24);
    ctx.arc(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.66 - r * 0.42, r * 0.22, 0, Math.PI * 2);
  }
}

function drawShape(ctx: CanvasRenderingContext2D, shape: FxShape, r: number): void {
  switch (shape) {
    case 'star':
      starPath(ctx, r);
      break;
    case 'heart':
      heartPath(ctx, r);
      break;
    case 'petal':
      petalPath(ctx, r);
      break;
    case 'leaf':
      leafPath(ctx, r);
      break;
    case 'snow':
      snowPath(ctx, r);
      break;
    case 'flame':
      flamePath(ctx, r);
      break;
    case 'drop':
      dropPath(ctx, r);
      break;
    case 'bubble':
      bubblePath(ctx, r);
      break;
    case 'note':
      notePath(ctx, r);
      break;
    case 'coin':
      coinPath(ctx, r);
      break;
    case 'candy':
      candyPath(ctx, r);
      break;
    case 'bug':
      bugPath(ctx, r);
      break;
    case 'ribbon':
      ribbonPath(ctx, r);
      break;
    case 'glyph':
      glyphPath(ctx, r);
      break;
    case 'bolt':
      boltPath(ctx, r);
      break;
    case 'feather':
      featherPath(ctx, r);
      break;
    case 'cloud':
      cloudPath(ctx, r);
      break;
    case 'paw':
      pawPath(ctx, r);
      break;
    default:
      sparkPath(ctx, r);
      break;
  }
}

/** 一粒发光粒子：外晕 + 实心 + 高光点 */
export function drawFxParticle(
  ctx: CanvasRenderingContext2D,
  shape: FxShape,
  color: string,
  x: number,
  y: number,
  size: number,
  rot: number,
  alpha: number,
): void {
  if (alpha <= 0.01) return;
  const r = Math.max(1.5, size * 0.5);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  // 外晕：径向渐变，叠加混合下会变成柔和光团
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.6);
  glow.addColorStop(0, hexA(color, 0.38 * alpha));
  glow.addColorStop(0.45, hexA(color, 0.14 * alpha));
  glow.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = Math.min(1, alpha);
  drawShape(ctx, shape, r);

  if (shape === 'snow' || shape === 'bubble') {
    ctx.strokeStyle = hexA(color, 0.85 * alpha);
    ctx.lineWidth = Math.max(1, r * 0.20);
    ctx.stroke();
    ctx.fillStyle = hexA(color, 0.20 * alpha);
    ctx.fill();
  } else {
    const fill = ctx.createLinearGradient(-r, -r, r, r);
    fill.addColorStop(0, hexA('#ffffff', 0.95 * alpha));
    fill.addColorStop(0.42, hexA(color, 0.95 * alpha));
    fill.addColorStop(1, hexA(color, 0.75 * alpha));
    ctx.fillStyle = fill;
    ctx.fill();
    // 高光点
    ctx.beginPath();
    ctx.arc(-r * 0.28, -r * 0.34, Math.max(0.8, r * 0.16), 0, Math.PI * 2);
    ctx.fillStyle = hexA('#ffffff', 0.9 * alpha);
    ctx.fill();
  }
  ctx.restore();
}

/** #rrggbb + alpha → rgba() */
export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(num)) return `rgba(255,255,255,${a})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
