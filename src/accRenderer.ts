import { ACCESSORY_ART, type AccentAnchor } from './collectibles';

type Ctx = CanvasRenderingContext2D;

function fill(ctx: Ctx, color: string): void {
  ctx.fillStyle = color;
  ctx.fill();
}

function stroke(ctx: Ctx, color: string, w = 1.2): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function ell(ctx: Ctx, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

function round(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function poly(ctx: Ctx, pts: number[][]): void {
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
}

/** 星形（用于帽尖、装饰点） */
function star(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? r : r * 0.44;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(ang) * rad;
    const py = y + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  fill(ctx, color);
}

/* ---------------- 头部 ---------------- */

function cap(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 2, 30, 24, 0, Math.PI, Math.PI * 2);
  fill(ctx, c1);
  ctx.beginPath();
  ctx.ellipse(0, 2, 30, 24, 0, Math.PI * 1.05, Math.PI * 1.95);
  stroke(ctx, c2, 2);
  ell(ctx, 4, 2, 30, 5);
  fill(ctx, c2);
}

function beanie(ctx: Ctx, c1: string, c2: string, t: number): void {
  ctx.beginPath();
  ctx.ellipse(0, 4, 29, 25, 0, Math.PI * 1.02, Math.PI * 1.98);
  fill(ctx, c1);
  round(ctx, -29, -1, 58, 9, 4);
  fill(ctx, c2);
  const sway = Math.sin(t * 2.2) * 1.6;
  ell(ctx, sway, -26, 6.5, 6.5);
  fill(ctx, c2);
}

function coneHat(ctx: Ctx, c1: string, c2: string, t: number): void {
  poly(ctx, [[-26, 2], [26, 2], [3, -42]]);
  fill(ctx, c1);
  poly(ctx, [[-7, -18], [26, 2], [3, -42]]);
  fill(ctx, c2);
  ell(ctx, 0, 2, 30, 6);
  fill(ctx, c1);
  star(ctx, 3, -44 + Math.sin(t * 2) * 1.2, 4.2, '#ffe066');
}

function chefHat(ctx: Ctx, c1: string, c2: string): void {
  round(ctx, -22, -10, 44, 14, 4);
  fill(ctx, c2);
  ell(ctx, -14, -22, 13, 12);
  fill(ctx, c1);
  ell(ctx, 2, -26, 14, 13);
  fill(ctx, c1);
  ell(ctx, 17, -21, 12, 11);
  fill(ctx, c1);
}

function hood(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 6, 32, 30, 0, Math.PI * 1.0, Math.PI * 2.0);
  fill(ctx, c1);
  ell(ctx, -14, -18, 7, 7);
  fill(ctx, '#ffffff');
  ell(ctx, 14, -18, 7, 7);
  fill(ctx, '#ffffff');
  ell(ctx, -14, -18, 3, 3);
  fill(ctx, c2);
  ell(ctx, 14, -18, 3, 3);
  fill(ctx, c2);
}

function earband(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 6, 29, 26, 0, Math.PI * 1.1, Math.PI * 1.9);
  stroke(ctx, c1, 3.4);
  poly(ctx, [[-24, -8], [-16, -30], [-7, -9]]);
  fill(ctx, c1);
  poly(ctx, [[24, -8], [16, -30], [7, -9]]);
  fill(ctx, c1);
  poly(ctx, [[-20, -10], [-16, -24], [-11, -10]]);
  fill(ctx, c2);
  poly(ctx, [[20, -10], [16, -24], [11, -10]]);
  fill(ctx, c2);
}

function antler(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 6, 28, 25, 0, Math.PI * 1.12, Math.PI * 1.88);
  stroke(ctx, c1, 2.6);
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(dir * 15, -10);
    ctx.quadraticCurveTo(dir * 22, -24, dir * 14, -34);
    stroke(ctx, c1, 3.2);
    ctx.beginPath();
    ctx.moveTo(dir * 19, -20);
    ctx.quadraticCurveTo(dir * 27, -24, dir * 29, -18);
    stroke(ctx, c2, 2.4);
    ctx.beginPath();
    ctx.moveTo(dir * 16, -28);
    ctx.quadraticCurveTo(dir * 10, -34, dir * 8, -30);
    stroke(ctx, c2, 2.2);
  }
}

function partyHat(ctx: Ctx, c1: string, c2: string): void {
  poly(ctx, [[-17, 2], [17, 2], [4, -36]]);
  fill(ctx, c1);
  for (let i = 0; i < 3; i += 1) {
    poly(ctx, [[-13 + i * 9, 2 - i * 11], [13 - i * 9, 2 - i * 11], [4, -6 - i * 11]]);
    fill(ctx, c2);
  }
  ell(ctx, 4, -38, 4.6, 4.6);
  fill(ctx, c2);
}

function crown(ctx: Ctx, c1: string, c2: string, t: number): void {
  poly(ctx, [[-22, 2], [-22, -14], [-13, -5], [-6, -18], [2, -5], [10, -18], [17, -5], [22, -14], [22, 2]]);
  fill(ctx, c1);
  round(ctx, -22, 0, 44, 6, 2);
  fill(ctx, c2);
  ell(ctx, -12, -1, 2.4, 2.4);
  fill(ctx, '#ff7a9c');
  ell(ctx, 3, -1, 2.6, 2.6);
  fill(ctx, '#7ce0ff');
  ell(ctx, 14, -1, 2.4, 2.4);
  fill(ctx, '#a8ff8a');
  star(ctx, 2, -20 + Math.sin(t * 1.6) * 1.1, 2.6, '#fff6c8');
}

function nightcap(ctx: Ctx, c1: string, c2: string, t: number): void {
  const sway = Math.sin(t * 1.8) * 3;
  ctx.beginPath();
  ctx.moveTo(-24, 2);
  ctx.quadraticCurveTo(-6, -34, 26 + sway, -26 + sway * 0.4);
  ctx.quadraticCurveTo(12, -10, 24, 2);
  ctx.closePath();
  fill(ctx, c1);
  round(ctx, -25, -2, 50, 8, 4);
  fill(ctx, c2);
  ell(ctx, 28 + sway, -25 + sway * 0.4, 5, 5);
  fill(ctx, c2);
}

function earmuff(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 6, 30, 27, 0, Math.PI * 1.05, Math.PI * 1.95);
  stroke(ctx, c1, 3.2);
  ell(ctx, -28, 2, 8.5, 11);
  fill(ctx, c1);
  ell(ctx, -28, 2, 5, 7);
  fill(ctx, c2);
  ell(ctx, 28, 2, 8.5, 11);
  fill(ctx, c1);
  ell(ctx, 28, 2, 5, 7);
  fill(ctx, c2);
}

/* ---------------- 面部 ---------------- */

function glassesRound(ctx: Ctx, c1: string, c2: string): void {
  for (const dir of [-1, 1]) {
    ell(ctx, dir * 13, 0, 9.5, 9.5);
    fill(ctx, c2);
    ell(ctx, dir * 13, 0, 9.5, 9.5);
    stroke(ctx, c1, 2.2);
  }
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.lineTo(4, 0);
  stroke(ctx, c1, 2);
}

function glassesHeart(ctx: Ctx, c1: string, c2: string): void {
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    const x = dir * 13;
    ctx.moveTo(x, 6);
    ctx.bezierCurveTo(x - 12, -2, x - 7, -12, x, -5);
    ctx.bezierCurveTo(x + 7, -12, x + 12, -2, x, 6);
    ctx.closePath();
    fill(ctx, c1);
    ctx.globalAlpha = 0.45;
    fill(ctx, c2);
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.moveTo(-5, -2);
  ctx.lineTo(5, -2);
  stroke(ctx, c1, 2.2);
}

function glassesPixel(ctx: Ctx, c1: string, c2: string): void {
  for (const dir of [-1, 1]) {
    ctx.fillStyle = c1;
    ctx.fillRect(dir * 13 - 11, -6, 22, 11);
    ctx.fillStyle = c2;
    ctx.fillRect(dir * 13 - 8, -3.5, 6, 3);
  }
  ctx.fillStyle = c1;
  ctx.fillRect(-4, -3, 8, 3);
}

function goggles(ctx: Ctx, c1: string, c2: string): void {
  round(ctx, -25, -7, 50, 15, 7);
  fill(ctx, c1);
  for (const dir of [-1, 1]) {
    round(ctx, dir * 13 - 8, -4.5, 16, 10, 5);
    fill(ctx, c2);
    ctx.globalAlpha = 0.5;
    fill(ctx, '#ffffff');
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.moveTo(-25, -2);
  ctx.lineTo(-32, -5);
  ctx.moveTo(25, -2);
  ctx.lineTo(32, -5);
  stroke(ctx, c1, 3);
}

function eyePatch(ctx: Ctx, c1: string, c2: string): void {
  ell(ctx, 13, 0, 10, 8);
  fill(ctx, c1);
  ctx.beginPath();
  ctx.moveTo(4, -6);
  ctx.lineTo(-24, -14);
  stroke(ctx, c2, 2.6);
  ell(ctx, 13, 0, 10, 8);
  stroke(ctx, c2, 1.4);
}

function mask(ctx: Ctx, c1: string, c2: string): void {
  round(ctx, -16, -2, 32, 16, 7);
  fill(ctx, c1);
  round(ctx, -16, -2, 32, 16, 7);
  stroke(ctx, c2, 1.4);
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.lineTo(-27, -5);
  ctx.moveTo(16, 0);
  ctx.lineTo(27, -5);
  stroke(ctx, c2, 2);
}

function blush(ctx: Ctx, c1: string, c2: string): void {
  ctx.globalAlpha = 0.72;
  ell(ctx, -21, 15, 10, 6);
  fill(ctx, c1);
  ell(ctx, 21, 15, 10, 6);
  fill(ctx, c1);
  ctx.globalAlpha = 1;
}

function eyewear(ctx: Ctx, c1: string, c2: string): void {
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(dir * 13, 0, 10.5, 11.5, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 0.55;
    fill(ctx, c1);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.ellipse(dir * 13, 0, 10.5, 11.5, 0, 0, Math.PI * 2);
    stroke(ctx, c2, 1.4);
  }
  ctx.beginPath();
  ctx.moveTo(-3, 0);
  ctx.lineTo(3, 0);
  stroke(ctx, c2, 1.4);
}

function sticker(ctx: Ctx, c1: string, c2: string): void {
  for (const dir of [-1, 1]) {
    star(ctx, dir * 14, -2, 6.2, c1);
    star(ctx, dir * 24, -8, 3.4, c2);
  }
}

function eyeshadow(ctx: Ctx, c1: string, c2: string): void {
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(dir * 13, -9, 11, 5.5, dir * 0.14, Math.PI, Math.PI * 2);
    ctx.globalAlpha = 0.6;
    fill(ctx, c1);
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(dir * 13, -14, 8, 3.6, dir * 0.14, Math.PI, Math.PI * 2);
    fill(ctx, c2);
    ctx.globalAlpha = 1;
  }
}

function eyeliner(ctx: Ctx, c1: string, _c2: string): void {
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(dir * 13 - 10, -9);
    ctx.quadraticCurveTo(dir * 13, -15, dir * 13 + 12, -8);
    stroke(ctx, c1, 2);
  }
}

function whiskerSticker(ctx: Ctx, c1: string, _c2: string): void {
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(dir * 22, 2 + i * 5);
      ctx.quadraticCurveTo(dir * 34, 1 + i * 6, dir * 44, -1 + i * 7);
      stroke(ctx, c1, 1.6);
    }
  }
}

function monocle(ctx: Ctx, c1: string, c2: string): void {
  ell(ctx, 13, 0, 10.5, 11);
  ctx.globalAlpha = 0.4;
  fill(ctx, c2);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.ellipse(13, 0, 10.5, 11, 0, 0, Math.PI * 2);
  stroke(ctx, c1, 2.2);
  ctx.beginPath();
  ctx.moveTo(20, 8);
  ctx.quadraticCurveTo(30, 22, 26, 34);
  stroke(ctx, c1, 1.4);
}

function veil(ctx: Ctx, c1: string, c2: string): void {
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(-26, -6);
  ctx.quadraticCurveTo(0, -12, 26, -6);
  ctx.quadraticCurveTo(24, 26, 0, 30);
  ctx.quadraticCurveTo(-24, 26, -26, -6);
  ctx.closePath();
  fill(ctx, c1);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.ellipse(0, -6, 26, 6, 0, Math.PI, Math.PI * 2);
  stroke(ctx, c2, 2);
}

function balloon2d(ctx: Ctx, c1: string, c2: string, t: number): void {
  const sway = Math.sin(t * 1.4) * 3;
  ctx.beginPath();
  ctx.moveTo(0, 14);
  ctx.quadraticCurveTo(sway, 28, sway * 1.4, 42);
  stroke(ctx, c2, 1.3);
  ctx.beginPath();
  ctx.ellipse(sway * 0.5, -6, 13, 16, 0, 0, Math.PI * 2);
  fill(ctx, c1);
  ell(ctx, sway * 0.5 - 4, -12, 3.4, 5);
  fill(ctx, '#ffffff');
  ctx.globalAlpha = 0.5;
  poly(ctx, [[-4, 12], [4, 12], [0, 17]]);
  fill(ctx, c2);
  ctx.globalAlpha = 1;
}

/* ---------------- 颈部 ---------------- */

function collarBell(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 9, 0, Math.PI * 0.08, Math.PI * 0.92);
  stroke(ctx, c1, 6);
  ell(ctx, 0, 7, 5.2, 5.2);
  fill(ctx, c2);
  ctx.beginPath();
  ctx.moveTo(-2.2, 8.4);
  ctx.lineTo(2.2, 8.4);
  stroke(ctx, '#8a6410', 1.2);
}

function bowtie(ctx: Ctx, c1: string, c2: string): void {
  poly(ctx, [[0, 0], [-20, -9], [-20, 9]]);
  fill(ctx, c1);
  poly(ctx, [[0, 0], [20, -9], [20, 9]]);
  fill(ctx, c1);
  ell(ctx, 0, 0, 5, 5.4);
  fill(ctx, c2);
}

function scarf(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, 26, 10, 0, Math.PI * 0.05, Math.PI * 0.95);
  stroke(ctx, c1, 9);
  round(ctx, 12, 2, 11, 26, 4);
  fill(ctx, c1);
  for (let i = 0; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(-22 + i * 6, -6);
    ctx.lineTo(-18 + i * 6, 6);
    stroke(ctx, c2, 1.6);
  }
  ctx.globalAlpha = 0.5;
  round(ctx, 12, 24, 11, 5, 2);
  fill(ctx, c2);
  ctx.globalAlpha = 1;
}

function tie(ctx: Ctx, c1: string, c2: string): void {
  poly(ctx, [[-7, -6], [7, -6], [5, 2], [-5, 2]]);
  fill(ctx, c2);
  poly(ctx, [[-5, 3], [5, 3], [2, 26], [0, 30], [-2, 26]]);
  fill(ctx, c1);
}

function towel(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, 25, 9, 0, Math.PI * 0.1, Math.PI * 0.9);
  stroke(ctx, c1, 8);
  round(ctx, 10, 0, 9, 18, 3);
  fill(ctx, c2);
}

function pearl(ctx: Ctx, c1: string, c2: string): void {
  for (let i = -4; i <= 4; i += 1) {
    const a = Math.PI * (0.15 + ((i + 4) / 8) * 0.7);
    ell(ctx, Math.cos(a) * 24, Math.sin(a) * 11, 3.4, 3.4);
    fill(ctx, c1);
    ell(ctx, Math.cos(a) * 24 - 1, Math.sin(a) * 11 - 1, 1.1, 1.1);
    fill(ctx, '#ffffff');
  }
  ell(ctx, 0, 13, 4.4, 4.4);
  fill(ctx, c2);
}

function rainCollar(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, 28, 11, 0, Math.PI * 0.02, Math.PI * 0.98);
  stroke(ctx, c1, 10);
  ctx.beginPath();
  ctx.ellipse(0, 0, 28, 11, 0, Math.PI * 0.02, Math.PI * 0.98);
  stroke(ctx, c2, 1.6);
  round(ctx, -4, 8, 8, 8, 2);
  fill(ctx, c2);
}

function bandana(ctx: Ctx, c1: string, c2: string): void {
  poly(ctx, [[-26, -2], [26, -2], [0, 22]]);
  fill(ctx, c1);
  poly(ctx, [[-26, -2], [26, -2], [0, 4]]);
  fill(ctx, c2);
  for (let i = 0; i < 3; i += 1) {
    ell(ctx, -10 + i * 10, 6 + i, 1.6, 1.6);
    fill(ctx, c2);
  }
}

/* ---------------- 背部 ---------------- */

function wingsAngel(ctx: Ctx, c1: string, c2: string, t: number): void {
  const flap = Math.sin(t * 2.4) * 2;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(dir * 26, -22 + flap, dir * 44, -6, dir * 30, 12);
    ctx.bezierCurveTo(dir * 22, 2, dir * 12, 2, 0, 6);
    ctx.closePath();
    fill(ctx, c1);
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.bezierCurveTo(dir * 18, -8, dir * 28, 0, dir * 22, 9);
    stroke(ctx, c2, 1.2);
  }
}

function wingsDevil(ctx: Ctx, c1: string, c2: string, t: number): void {
  const flap = Math.sin(t * 3.2) * 2.4;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(dir * 30, -26 + flap, dir * 34, 2);
    ctx.quadraticCurveTo(dir * 24, -2, dir * 18, 10);
    ctx.quadraticCurveTo(dir * 10, 0, 0, 6);
    ctx.closePath();
    fill(ctx, c1);
    ctx.beginPath();
    ctx.moveTo(dir * 4, 0);
    ctx.quadraticCurveTo(dir * 24, -12 + flap, dir * 30, 2);
    stroke(ctx, c2, 1.4);
  }
}

function wingsButterfly(ctx: Ctx, c1: string, c2: string, t: number): void {
  const flap = Math.sin(t * 3.6) * 3;
  for (const dir of [-1, 1]) {
    ell(ctx, dir * 17, -10 + flap * 0.4, 14, 16);
    fill(ctx, c1);
    ell(ctx, dir * 14, 8 - flap * 0.4, 10, 11);
    fill(ctx, c2);
    ell(ctx, dir * 15, -12, 3.4, 3.4);
    fill(ctx, '#ffffff');
  }
}

function backpack(ctx: Ctx, c1: string, c2: string): void {
  round(ctx, -15, -12, 30, 30, 8);
  fill(ctx, c1);
  round(ctx, -11, 6, 22, 10, 4);
  fill(ctx, c2);
  ctx.beginPath();
  ctx.moveTo(-9, -12);
  ctx.quadraticCurveTo(0, -20, 9, -12);
  stroke(ctx, c2, 2);
}

function cape(ctx: Ctx, c1: string, c2: string, t: number): void {
  const sway = Math.sin(t * 1.6) * 3;
  ctx.beginPath();
  ctx.moveTo(-14, -8);
  ctx.quadraticCurveTo(-30 + sway, 24, -20 + sway, 40);
  ctx.quadraticCurveTo(0, 46, 20 + sway, 40);
  ctx.quadraticCurveTo(30 + sway, 24, 14, -8);
  ctx.closePath();
  fill(ctx, c1);
  ctx.beginPath();
  ctx.moveTo(-8, -6);
  ctx.quadraticCurveTo(0, 14, 8, -6);
  stroke(ctx, c2, 1.6);
}

function jetpack(ctx: Ctx, c1: string, c2: string, t: number): void {
  for (const dir of [-1, 1]) {
    round(ctx, dir * 12 - 6, -10, 12, 24, 6);
    fill(ctx, c1);
    const flame = 6 + Math.sin(t * 12 + dir) * 2.4;
    poly(ctx, [[dir * 12 - 4, 14], [dir * 12 + 4, 14], [dir * 12, 14 + flame]]);
    fill(ctx, c2);
  }
  round(ctx, -10, -12, 20, 16, 6);
  fill(ctx, c1);
}

function shell(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 6, 22, 18, 0, Math.PI, Math.PI * 2);
  fill(ctx, c1);
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * 6, -2);
    ctx.lineTo(i * 6, 12);
    stroke(ctx, c2, 1.2);
  }
  ctx.beginPath();
  ctx.ellipse(0, 6, 22, 18, 0, Math.PI, Math.PI * 2);
  stroke(ctx, c2, 1.6);
}

/* ---------------- 爪子 ---------------- */

function sock(ctx: Ctx, c1: string, c2: string): void {
  round(ctx, -8, -6, 16, 18, 5);
  fill(ctx, c1);
  round(ctx, -8, -6, 16, 5, 2.5);
  fill(ctx, c2);
}

function boot(ctx: Ctx, c1: string, c2: string): void {
  round(ctx, -9, -8, 18, 18, 5);
  fill(ctx, c1);
  round(ctx, -11, 6, 24, 6, 3);
  fill(ctx, c2);
}

function cuff(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, 8.5, 5, 0, 0, Math.PI * 2);
  stroke(ctx, c1, 3.4);
  ell(ctx, 0, -6, 2.2, 2.2);
  fill(ctx, c2);
}

function slipper(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 3, 11, 7, 0, 0, Math.PI * 2);
  fill(ctx, c1);
  ell(ctx, 0, 6, 8, 2.4);
  fill(ctx, c2);
}

/* ---------------- 地面 ---------------- */

function cushion(ctx: Ctx, c1: string, c2: string): void {
  ell(ctx, 0, 0, 46, 12);
  fill(ctx, c1);
  ell(ctx, 0, -2, 40, 9);
  fill(ctx, c2);
  ctx.globalAlpha = 0.35;
  ell(ctx, 0, 0, 46, 12);
  stroke(ctx, '#ffffff', 1.2);
  ctx.globalAlpha = 1;
}

function rug(ctx: Ctx, c1: string, c2: string): void {
  ell(ctx, 0, 0, 54, 14);
  fill(ctx, c1);
  ell(ctx, 0, 0, 44, 10);
  stroke(ctx, c2, 1.6);
  ell(ctx, 0, 0, 30, 6.5);
  stroke(ctx, c2, 1.2);
}

function box(ctx: Ctx, c1: string, c2: string): void {
  poly(ctx, [[-32, 0], [-32, -22], [0, -30], [32, -22], [32, 0], [0, 8]]);
  fill(ctx, c1);
  poly(ctx, [[-32, -22], [0, -30], [32, -22], [0, -14]]);
  fill(ctx, c2);
}

function treeBase(ctx: Ctx, c1: string, c2: string): void {
  ell(ctx, 0, 0, 46, 12);
  fill(ctx, c1);
  round(ctx, -34, -4, 68, 10, 5);
  fill(ctx, c2);
  round(ctx, 22, -18, 8, 22, 3);
  fill(ctx, c1);
}

function cabin(ctx: Ctx, c1: string, c2: string): void {
  round(ctx, -34, -26, 68, 26, 4);
  fill(ctx, c1);
  poly(ctx, [[-40, -26], [0, -46], [40, -26]]);
  fill(ctx, c2);
  round(ctx, -8, -12, 16, 12, 2);
  fill(ctx, '#3a2a1c');
}

function mat(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.moveTo(-50, 0);
  ctx.lineTo(50, 0);
  ctx.lineTo(38, 12);
  ctx.lineTo(-38, 12);
  ctx.closePath();
  fill(ctx, c1);
  for (let i = -3; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * 13, 0);
    ctx.lineTo(i * 10, 12);
    stroke(ctx, c2, 2);
  }
}

function snowPit(ctx: Ctx, c1: string, c2: string): void {
  ell(ctx, 0, 0, 46, 13);
  fill(ctx, c1);
  ell(ctx, 0, 1, 30, 8);
  fill(ctx, c2);
}

/* ---------------- 道具 ---------------- */

function propFish(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 6, -0.12, 0, Math.PI * 2);
  fill(ctx, c1);
  poly(ctx, [[12, 0], [20, -6], [20, 6]]);
  fill(ctx, c1);
  ell(ctx, -6, -1.4, 1.4, 1.4);
  fill(ctx, c2);
}

function propCup(ctx: Ctx, c1: string, c2: string, t: number): void {
  round(ctx, -9, -10, 18, 20, 3);
  fill(ctx, c1);
  round(ctx, -9, -10, 18, 5, 2);
  fill(ctx, c2);
  ctx.beginPath();
  ctx.moveTo(9, -5);
  ctx.quadraticCurveTo(16, -2, 9, 4);
  stroke(ctx, c1, 2.4);
  const rise = (t * 14) % 18;
  ctx.globalAlpha = 0.4 * (1 - rise / 18);
  ctx.beginPath();
  ctx.moveTo(-2, -12 - rise);
  ctx.quadraticCurveTo(2, -16 - rise, -1, -20 - rise);
  stroke(ctx, '#ffffff', 1.6);
  ctx.globalAlpha = 1;
}

function propBook(ctx: Ctx, c1: string, c2: string): void {
  round(ctx, -12, -8, 24, 16, 2);
  fill(ctx, c1);
  round(ctx, -9, -6, 18, 12, 1.5);
  fill(ctx, c2);
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(0, 8);
  stroke(ctx, c1, 1.4);
}

function propYarn(ctx: Ctx, c1: string, c2: string): void {
  ell(ctx, 0, 0, 9, 9);
  fill(ctx, c1);
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 9, 0.6, 0, Math.PI * 1.6);
  stroke(ctx, c2, 1.2);
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 9, -0.6, 0, Math.PI * 1.6);
  stroke(ctx, c2, 1.2);
  ctx.beginPath();
  ctx.moveTo(8, 4);
  ctx.quadraticCurveTo(18, 8, 14, 14);
  stroke(ctx, c1, 1.4);
}

function propUmbrella(ctx: Ctx, c1: string, c2: string): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 12, 0, Math.PI, Math.PI * 2);
  fill(ctx, c1);
  for (let i = -1; i <= 1; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * 9, -11 + Math.abs(i) * 2);
    ctx.quadraticCurveTo(i * 4, -4, 0, 0);
    stroke(ctx, c2, 1.2);
  }
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 18);
  ctx.quadraticCurveTo(0, 22, -5, 21);
  stroke(ctx, c2, 2);
}

const SHAPES: Record<string, (ctx: Ctx, c1: string, c2: string, t: number) => void> = {
  cap,
  beanie,
  coneHat,
  chefHat,
  hood,
  earband,
  antler,
  partyHat,
  crown,
  nightcap,
  earmuff,
  glassesRound,
  glassesHeart,
  glassesPixel,
  goggles,
  eyePatch,
  mask,
  blush,
  collarBell,
  bowtie,
  scarf,
  tie,
  towel,
  pearl,
  rainCollar,
  bandana,
  wingsAngel,
  wingsDevil,
  wingsButterfly,
  backpack,
  cape,
  jetpack,
  shell,
  sock,
  boot,
  cuff,
  slipper,
  cushion,
  rug,
  box,
  treeBase,
  cabin,
  mat,
  snowPit,
  propFish,
  propCup,
  propBook,
  propYarn,
  propUmbrella,
  eyewear,
  sticker,
  eyeshadow,
  eyeliner,
  whiskerSticker,
  monocle,
  veil,
  balloon2d,
};

/** 新增造型先映射到最接近的既有 2D 函数，之后逐个画专属版 */
const SHAPE_FALLBACK: Record<string, string> = {
  sunhat: 'cap', beret: 'beanie', helmet: 'hood', wreath: 'earband', pumpkin: 'beanie',
  eyewear: 'eyewear', sticker: 'sticker', monocle: 'monocle', veil: 'veil',
  whiskerSticker: 'whiskerSticker', eyeshadow: 'eyeshadow', eyeliner: 'eyeliner',
  balloon: 'balloon2d',
  snood: 'scarf', furCollar: 'scarf', pendant: 'collarBell', laceCollar: 'pearl',
  nameTag: 'collarBell', neckBrace: 'scarf', bib: 'bandana',
  wingsBee: 'wingsButterfly', glider: 'wingsButterfly', parachute: 'wingsAngel',
  lantern: 'jetpack', balloons: 'wingsButterfly', flag: 'cape',
  quiver: 'backpack', guitar: 'backpack', basket: 'backpack', surfboard: 'cape',
  plushPaw: 'sock', wristband: 'cuff', ring: 'cuff', pawSticker: 'sock',
  glove: 'sock', nails: 'cuff', sneaker: 'boot',
  wand: 'propUmbrella', phone: 'propBook', miniKeyboard: 'propBook', notepad: 'propBook',
  donut: 'propYarn', lollipop: 'propYarn', fishbowl: 'propYarn',
  telescope: 'propUmbrella', camera: 'propBook', wrench: 'propCup',
  pillBottle: 'propCup', mic: 'propCup', pencil: 'propUmbrella',
};

/** 在锚点上绘制一件配饰 */
export function drawAccessory(ctx: Ctx, id: string, a: AccentAnchor): void {
  const art = ACCESSORY_ART[id];
  if (!art) return;
  const fn = SHAPES[art.shape] ?? SHAPES[SHAPE_FALLBACK[art.shape] ?? ''];
  if (!fn) return;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.scale(a.s, a.s);
  if (a.dir < 0) ctx.scale(-1, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  fn(ctx, art.c1, art.c2, a.t);
  ctx.restore();
}
