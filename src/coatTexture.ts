import * as THREE from 'three';

/**
 * 一比一毛色贴图（橘白奶盖）。
 *
 * 身体是 LatheGeometry：u 绕身体一圈（u=0 在正前方 +z，u=0.5 在背面），
 * v 沿身体轮廓从底部 0 到头顶 1。所以直接按真实猫的斑纹在 (u, v) 上画，
 * 再交给毛发着色器做光照，就能得到和照片同款的毛色分布，而不是靠程序化随机条纹。
 */
export function makeOrangeBibCoat(size = 1024): THREE.CanvasTexture {
  const W = size;
  const H = size;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const px = (u: number) => u * W;
  const py = (v: number) => (1 - v) * H;

  // 底色：暖橘，背侧稍深，腹部稍亮
  const base = ctx.createLinearGradient(0, py(0.0), 0, py(1.0));
  base.addColorStop(0, '#C97C33');
  base.addColorStop(0.45, '#D98A3E');
  base.addColorStop(0.75, '#E0954A');
  base.addColorStop(1, '#CE7F35');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // 背脊（u=0.5 附近）压暗一层
  const back = ctx.createLinearGradient(px(0.3), 0, px(0.7), 0);
  back.addColorStop(0, 'rgba(150,82,30,0)');
  back.addColorStop(0.5, 'rgba(150,82,30,0.22)');
  back.addColorStop(1, 'rgba(150,82,30,0)');
  ctx.fillStyle = back;
  ctx.fillRect(px(0.3), py(0.62), px(0.4), py(0.0) - py(0.62));

  // 虎斑：身体两侧的横向条带（背面更密，正面被白围兜盖住）
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i += 1) {
    const v0 = 0.06 + i * 0.022;
    if (v0 > 0.68) break;
    for (const side of [-1, 1]) {
      const cx = 0.5 + side * (0.13 + (i % 3) * 0.035);
      const wob = Math.sin(i * 1.7) * 0.02;
      ctx.beginPath();
      ctx.moveTo(px(cx - 0.10), py(v0));
      ctx.quadraticCurveTo(px(cx + wob), py(v0 + 0.026), px(cx + 0.10), py(v0 + 0.012));
      ctx.strokeStyle = `rgba(140,74,26,${0.30 + (i % 4) * 0.05})`;
      ctx.lineWidth = H * 0.010;
      ctx.stroke();
    }
  }
  // 前侧肋部的横纹（照片里能看到的条带，画得靠近正面一点）
  ctx.save();
  for (let i = 0; i < 9; i += 1) {
    const v0 = 0.16 + i * 0.045;
    const amp = 0.028 + (i % 3) * 0.006;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(px(side * 0.075), py(v0));
      ctx.quadraticCurveTo(px(side * (0.115 + amp)), py(v0 + 0.020), px(side * (0.16 + amp)), py(v0 + 0.006));
      ctx.strokeStyle = `rgba(150,80,28,${0.34 + (i % 3) * 0.06})`;
      ctx.lineWidth = H * 0.0085;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
  ctx.restore();

  // 头顶三道 M 纹
  for (let i = 0; i < 3; i += 1) {
    const u = (i - 1) * 0.022;
    ctx.beginPath();
    ctx.moveTo(px(u), py(0.905));
    ctx.quadraticCurveTo(px(u * 1.6), py(0.945), px(u * 0.7), py(0.975));
    ctx.strokeStyle = 'rgba(130,68,24,0.55)';
    ctx.lineWidth = H * 0.009;
    ctx.stroke();
  }
  ctx.restore();

  // 白围兜：从胸口一路连到下巴（u 在 0/1 处是同一块，两边都要画）
  const bib = (uOffset: number) => {
    ctx.beginPath();
    ctx.moveTo(px(uOffset - 0.055), py(0.700));
    ctx.bezierCurveTo(px(uOffset - 0.105), py(0.640), px(uOffset - 0.115), py(0.560), px(uOffset - 0.100), py(0.480));
    ctx.bezierCurveTo(px(uOffset - 0.088), py(0.410), px(uOffset - 0.060), py(0.350), px(uOffset - 0.030), py(0.318));
    ctx.lineTo(px(uOffset + 0.030), py(0.318));
    ctx.bezierCurveTo(px(uOffset + 0.060), py(0.350), px(uOffset + 0.088), py(0.410), px(uOffset + 0.100), py(0.480));
    ctx.bezierCurveTo(px(uOffset + 0.115), py(0.560), px(uOffset + 0.105), py(0.640), px(uOffset + 0.055), py(0.700));
    ctx.closePath();
  };
  for (const off of [0, 1, -1]) {
    bib(off);
    const g2 = ctx.createLinearGradient(0, py(0.72), 0, py(0.31));
    g2.addColorStop(0, '#FFFDF8');
    g2.addColorStop(0.75, '#FBF5EA');
    g2.addColorStop(1, '#F3EADB');
    ctx.fillStyle = g2;
    ctx.fill();
  }

  // 口鼻白块 + 鼻梁白线（脸在 u=0 附近，v 0.70~0.88）
  const muzzle = ctx.createRadialGradient(px(0), py(0.735), 2, px(0), py(0.735), H * 0.085);
  muzzle.addColorStop(0, 'rgba(255,253,248,1)');
  muzzle.addColorStop(0.72, 'rgba(255,252,246,0.95)');
  muzzle.addColorStop(1, 'rgba(255,250,242,0)');
  for (const off of [0, 1, -1] as const) {
    ctx.save();
    ctx.translate(px(off), 0);
    ctx.fillStyle = muzzle;
    ctx.beginPath();
    ctx.ellipse(0, py(0.735), W * 0.085, H * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
    // 鼻梁白线
    ctx.beginPath();
    ctx.moveTo(-W * 0.014, py(0.760));
    ctx.quadraticCurveTo(-W * 0.018, py(0.792), -W * 0.006, py(0.816));
    ctx.quadraticCurveTo(0, py(0.822), W * 0.006, py(0.816));
    ctx.quadraticCurveTo(W * 0.018, py(0.792), W * 0.014, py(0.760));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,252,246,0.92)';
    ctx.fill();
    ctx.restore();
  }

  // 轻微毛束噪点，避免纯色平涂
  for (let i = 0; i < 1600; i += 1) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const a = 0.05 + Math.random() * 0.06;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,240,220,${a})` : `rgba(120,66,26,${a * 0.9})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 1.5 + Math.random() * 3, 0.8 + Math.random() * 1.2, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
