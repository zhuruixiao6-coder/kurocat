/**
 * 商城 1:1 预览图：用**同一套 3D 几何**离屏渲染，不是图标。
 *
 * 一只中性的猫半身像（有耳朵、口鼻、胡须、有高光的眼睛），
 * 把配饰真实挂到 headMount / neckMount / catRoot 上再拍一张，
 * 所以预览里看到的贴合关系、大小比例 = 戴上以后的样子。
 * 背景透明，卡片里可以直接压在深色底上。
 */
import * as THREE from 'three';
import { buildAccessory3D, createAccMaterial, type Acc3DCtx } from './acc3d';
import type { CatalogItem } from './catalog';

const HEAD_CY = 1.58;
const Z_SCALE = 0.82;
const COLLAR_Y = 1.32;

/** 与 catEngine3d 一致的体表轮廓（r, y） */
const PROFILE: Array<[number, number]> = [
  [0.0, 0.0], [0.46, 0.006], [0.60, 0.06], [0.74, 0.19], [0.80, 0.43], [0.76, 0.67],
  [0.68, 0.91], [0.60, 1.12], [0.57, 1.30], [0.548, 1.52], [0.516, 1.74], [0.448, 1.94],
  [0.295, 2.015], [0.0, 2.06],
];

function radiusAtY(y: number): number {
  const cy = Math.max(0, Math.min(2.06, y));
  for (let i = 0; i < PROFILE.length - 1; i += 1) {
    const [r0, y0] = PROFILE[i];
    const [r1, y1] = PROFILE[i + 1];
    if (cy >= y0 && cy <= y1) {
      const t = y1 - y0 > 1e-6 ? (cy - y0) / (y1 - y0) : 0;
      return r0 + (r1 - r0) * t;
    }
  }
  return 0;
}

function surfaceZ(x: number, y: number): number {
  const R = Math.max(0.05, radiusAtY(HEAD_CY + y));
  const u = Math.max(-0.985, Math.min(0.985, x / R));
  return R * Z_SCALE * Math.sqrt(Math.max(0, 1 - u * u));
}

interface CamPreset {
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
}

const CAMERA: Record<string, CamPreset> = {
  // 统一用「略偏右 3/4 视角」：既看得见脸，也看得出配饰的体积
  head: { pos: [0.54, 2.10, 2.96], target: [0, 1.86, 0], fov: 26 },
  face: { pos: [0.26, 1.76, 2.05], target: [0, 1.68, 0.24], fov: 24 },
  neck: { pos: [0.44, 1.58, 2.65], target: [0, 1.34, 0.10], fov: 25 },
  // 背部：绕到斜后方，能同时看到侧脸和背后的东西
  back: { pos: [2.30, 1.98, -2.05], target: [0, 1.16, -0.04], fov: 34 },
  paw: { pos: [0.45, 0.80, 1.75], target: [0, 0.14, 0.52], fov: 30 },
  floor: { pos: [0.40, 1.55, 3.30], target: [0, 0.05, 0.08], fov: 36 },
  prop: { pos: [-0.04, 1.06, 2.92], target: [-0.28, 0.34, 0.36], fov: 26 },
  fx: { pos: [0.30, 1.55, 3.35], target: [0, 1.16, 0], fov: 30 },
};

export class AccPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly catRoot = new THREE.Group();
  private readonly headMount = new THREE.Group();
  private readonly neckMount = new THREE.Group();
  private readonly cache = new Map<string, string>();
  private current: THREE.Group | null = null;

  constructor(size = 132) {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(2.5, window.devicePixelRatio || 1));
    this.renderer.setSize(size, size, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 40);
    this.scene.add(this.catRoot);

    this.headMount.position.set(0, HEAD_CY, 0);
    this.neckMount.position.set(0, COLLAR_Y, 0);
    this.catRoot.add(this.headMount, this.neckMount);
    this.buildBust();
    this.buildContactShadow();
  }

  /** 中性的猫半身像：只用来交代「戴在哪儿」，不抢配饰的颜色 */
  private buildBust(): void {
    const fur = createAccMaterial('#BDB1A0', { spec: 0.06, rim: 0.55, rough: 0.9 });
    const furDeep = createAccMaterial('#9C9080', { spec: 0.05, rim: 0.36, rough: 0.95 });
    const innerEar = createAccMaterial('#C79C92', { spec: 0.03, rim: 0.3, rough: 0.95 });

    // 身体（共享轮廓）
    const pts: THREE.Vector2[] = [];
    for (let y = 0.52; y <= 2.06; y += 0.035) {
      pts.push(new THREE.Vector2(Math.max(0.001, radiusAtY(y)), y));
    }
    pts.push(new THREE.Vector2(0.001, 2.065));
    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 56), fur);
    body.scale.z = Z_SCALE;
    this.catRoot.add(body);

    // 耳朵：竖起的三角，外倾一点，能从头饰边缘露出来
    for (const s of [-1, 1] as const) {
      const ear = new THREE.Group();
      // 耳朵：形状/大小/位置/细节冻结（与改造前完全一致，只补偿 HEAD_CY 的 0.02）
      const shell = new THREE.Mesh(new THREE.ConeGeometry(0.185, 0.34, 20, 1), fur);
      shell.scale.z = 0.62;
      ear.add(shell);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.225, 16, 1), innerEar);
      inner.position.set(0, -0.012, 0.052);
      inner.scale.z = 0.40;
      ear.add(inner);
      ear.position.set(s * 0.295, 0.248 + HEAD_CY, -0.035);
      ear.rotation.z = -s * 0.20;
      ear.rotation.x = -0.10;
      this.catRoot.add(ear);
    }

    // 脸颊：两团鼓起的腮，让正面不是一根柱子
    for (const s of [-1, 1] as const) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.195, 26, 20), fur);
      cheek.position.set(s * 0.195, -0.010 + HEAD_CY, surfaceZ(0.195, -0.010) - 0.165);
      cheek.scale.set(0.88, 0.76, 0.50);
      this.catRoot.add(cheek);
    }

    // 口鼻：一小团向前鼓的肉垫
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.165, 28, 22), fur);
    muzzle.position.set(0, 0.005 + HEAD_CY, surfaceZ(0, 0.005) - 0.060);
    muzzle.scale.set(1.28, 0.70, 0.62);
    this.catRoot.add(muzzle);

    // 下巴
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.128, 22, 18), furDeep);
    chin.position.set(0, -0.100 + HEAD_CY, surfaceZ(0, -0.100) - 0.090);
    chin.scale.set(1.05, 0.58, 0.48);
    this.catRoot.add(chin);

    // 鼻子：小三角（压扁的球做出心形感）
    const noseMat = createAccMaterial('#B4867A', { spec: 0.24, rim: 0.24, rough: 0.55 });
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.044, 18, 14), noseMat);
    nose.position.set(0, 0.070 + HEAD_CY, surfaceZ(0, 0.070) + 0.040);
    nose.scale.set(1.16, 0.80, 0.66);
    this.catRoot.add(nose);

    // 嘴：从鼻子往下的两段小弧
    const mouthMat = createAccMaterial('#8E6A5E', { spec: 0.05, rim: 0.1, rough: 0.9 });
    for (const s of [-1, 1] as const) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.046 + HEAD_CY, surfaceZ(0, 0.046) + 0.038),
        new THREE.Vector3(s * 0.048, 0.012 + HEAD_CY, surfaceZ(s * 0.048, 0.012) + 0.040),
        new THREE.Vector3(s * 0.092, 0.022 + HEAD_CY, surfaceZ(s * 0.092, 0.022) + 0.030),
      ]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.0085, 8, false), mouthMat);
      this.catRoot.add(tube);
    }

    // 胡须根部的小点
    for (const s of [-1, 1] as const) {
      for (let i = 0; i < 3; i += 1) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.010, 10, 8), furDeep);
        dot.position.set(
          s * 0.105,
          0.012 - i * 0.030 + HEAD_CY,
          surfaceZ(0.105, 0.012 - i * 0.03) + 0.030,
        );
        this.catRoot.add(dot);
      }
    }

    // 胡须：细而弯，向外舒展
    const whiskerMat = createAccMaterial('#F2EADC', { spec: 0.2, rim: 0.4, rough: 0.6 });
    for (const s of [-1, 1] as const) {
      for (let i = 0; i < 3; i += 1) {
        const y0 = 0.010 - i * 0.030;
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(s * 0.115, y0 + HEAD_CY, surfaceZ(0.115, y0) + 0.030),
          new THREE.Vector3(s * 0.34, y0 + 0.030 - i * 0.010 + HEAD_CY, surfaceZ(0.34, y0) * 0.86),
          new THREE.Vector3(s * 0.56, y0 + 0.060 - i * 0.030 + HEAD_CY, surfaceZ(0.50, y0) * 0.42),
        ]);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.0055, 6, false), whiskerMat);
        this.catRoot.add(tube);
      }
    }

    // 眼睛：眼白 + 虹膜 + 瞳孔 + 两处高光，正面看有神
    const eyeWhite = createAccMaterial('#F6F1E6', { spec: 0.3, rim: 0.2, rough: 0.4 });
    const irisMat = createAccMaterial('#7EA8B8', { spec: 0.55, rim: 0.35, rough: 0.28 });
    const pupilMat = createAccMaterial('#241F1C', { spec: 0.6, rim: 0.08, rough: 0.22 });
    const shineMat = createAccMaterial('#FFFFFF', { spec: 1, rim: 0.2, rough: 0.05 });
    for (const s of [-1, 1] as const) {
      const ex = s * 0.228;
      const ey = 0.146;
      const ez = surfaceZ(ex, ey);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.148, 24, 18), eyeWhite);
      ball.position.set(ex, ey + HEAD_CY, ez - 0.030);
      ball.scale.set(1.02, 1.04, 0.56);
      this.catRoot.add(ball);

      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.108, 22, 16), irisMat);
      iris.position.set(ex, ey + HEAD_CY, ez + 0.040);
      iris.scale.set(1.0, 1.02, 0.26);
      this.catRoot.add(iris);

      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.052, 18, 14), pupilMat);
      pupil.position.set(ex, ey + HEAD_CY, ez + 0.060);
      pupil.scale.set(0.74, 1.24, 0.24);
      this.catRoot.add(pupil);

      const hi = new THREE.Mesh(new THREE.SphereGeometry(0.030, 14, 12), shineMat);
      hi.position.set(ex - s * 0.026, ey + 0.046 + HEAD_CY, ez + 0.064);
      hi.scale.set(1, 1.05, 0.5);
      this.catRoot.add(hi);
      const hi2 = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), shineMat);
      hi2.position.set(ex + s * 0.032, ey - 0.040 + HEAD_CY, ez + 0.060);
      hi2.scale.set(1, 1, 0.5);
      this.catRoot.add(hi2);

      // 上眼睑：一条稍深的弧，眼睛才不会像贴上去的球
      const lid = new THREE.Mesh(
        new THREE.SphereGeometry(0.146, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.22),
        fur,
      );
      lid.position.set(ex, ey + 0.058 + HEAD_CY, ez - 0.026);
      lid.scale.set(1.02, 1.0, 0.52);
      this.catRoot.add(lid);

      // 腮红
      const cheekBlush = new THREE.Mesh(
        new THREE.SphereGeometry(0.105, 16, 12),
        createAccMaterial('#D9A292', { spec: 0.03, rim: 0.1, opacity: 0.5, rough: 0.9 }),
      );
      cheekBlush.position.set(s * 0.285, -0.020 + HEAD_CY, surfaceZ(0.285, -0.020) - 0.085);
      cheekBlush.scale.set(0.95, 0.52, 0.14);
      this.catRoot.add(cheekBlush);
    }
  }

  /** 脚下一团柔和的接触阴影，让商品看起来「站在地上」而不是飘着 */
  private buildContactShadow(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.42)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.16)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.5),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.012, 0.08);
    this.catRoot.add(shadow);
  }

  private ctx(): Acc3DCtx {
    return {
      headRadius: (ly: number) => radiusAtY(HEAD_CY + ly),
      surfaceZ,
      collarR: radiusAtY(COLLAR_Y),
      zScale: Z_SCALE,
    };
  }

  /** 渲染一张预览（透明底 dataURL，已按 id 缓存） */
  render(item: CatalogItem): string {
    const hit = this.cache.get(item.id);
    if (hit) return hit;

    const cam = CAMERA[item.slot] ?? CAMERA.head;
    this.camera.fov = cam.fov;
    this.camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    this.camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
    this.camera.updateProjectionMatrix();

    const group = buildAccessory3D(item.shape, item.c1, item.c2, item.slot, this.ctx(), item.id);
    if (group && item.slot === 'paw') {
      // 半身像没有手臂，把爪饰摆在「收爪」位置，并套上爪子的比例
      group.position.set(-0.24, 0.16, 0.54);
      group.scale.set(0.126, 0.080, 0.118);
    }
    if (group && item.slot === 'prop') {
      // 道具和半身像贴太近会看着像穿模：整体向镜头前挪、略微外移
      group.position.z += 0.14;
      group.position.x -= 0.05;
    }
    if (group) {
      const parent =
        item.slot === 'neck'
          ? this.neckMount
          : item.slot === 'head' || item.slot === 'face'
            ? this.headMount
            : this.catRoot;
      parent.add(group);
      this.current = group;
    }
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');

    if (group) {
      group.parent?.remove(group);
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      });
    }
    this.current = null;
    this.cache.set(item.id, url);
    return url;
  }
}
