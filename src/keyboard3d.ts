import * as THREE from 'three';
import {
  getKeyboardLayout,
  resolveKeyByVk,
  type KeyboardLayoutId,
  type KeySpec,
} from './keyboardLayout';
import type { KeyboardOrientation } from './catEngine';

export class Spring1D {
  public x: number;
  public v = 0;
  public hz: number;
  public damping: number;

  constructor(x = 0, hz = 2, damping = 0.7) {
    this.x = x;
    this.hz = hz;
    this.damping = damping;
  }

  public step(target: number, dt: number): number {
    const w = 2 * Math.PI * this.hz;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (w * w * (target - this.x) - 2 * this.damping * w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }

  public kick(v: number): void {
    this.v += v;
  }

  public set(x: number): void {
    this.x = x;
    this.v = 0;
  }
}

export class Spring3D {
  public x: THREE.Vector3;
  public v = new THREE.Vector3();
  public hz: number;
  public damping: number;

  constructor(x: THREE.Vector3, hz = 3.2, damping = 0.78) {
    this.x = x.clone();
    this.hz = hz;
    this.damping = damping;
  }

  public step(target: THREE.Vector3, dt: number): THREE.Vector3 {
    const w = 2 * Math.PI * this.hz;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v.x += (w * w * (target.x - this.x.x) - 2 * this.damping * w * this.v.x) * h;
      this.v.y += (w * w * (target.y - this.x.y) - 2 * this.damping * w * this.v.y) * h;
      this.v.z += (w * w * (target.z - this.x.z) - 2 * this.damping * w * this.v.z) * h;
      this.x.x += this.v.x * h;
      this.x.y += this.v.y * h;
      this.x.z += this.v.z * h;
    }
    return this.x;
  }
}

export const approach = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Lightweight static BufferGeometry merger (position + normal + optional vertex color)
 * to collapse static multi-mesh props (headset, keyboard chassis, whiskers, mouse seams) into single draw calls.
 */
export function mergeStaticGeometries(
  parts: Array<{ geo: THREE.BufferGeometry; matrix?: THREE.Matrix4; color?: string }>,
): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  let hasColor = false;

  const prepared = parts.map(({ geo, matrix, color }) => {
    const g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (color !== undefined) hasColor = true;
    const pos = g.attributes.position;
    const idx = g.getIndex();
    totalVerts += pos.count;
    totalIndices += idx ? idx.count : pos.count;
    return { g, color };
  });

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = hasColor ? new Float32Array(totalVerts * 3) : null;
  const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);
  const tmpCol = new THREE.Color();

  let vOffset = 0;
  let iOffset = 0;
  for (const { g, color } of prepared) {
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const count = pos.count;
    for (let i = 0; i < count; i++) {
      const dst = (vOffset + i) * 3;
      positions[dst] = pos.getX(i);
      positions[dst + 1] = pos.getY(i);
      positions[dst + 2] = pos.getZ(i);
      normals[dst] = nrm.getX(i);
      normals[dst + 1] = nrm.getY(i);
      normals[dst + 2] = nrm.getZ(i);
    }
    if (colors) {
      tmpCol.set(color ?? '#ffffff');
      for (let i = 0; i < count; i++) {
        const dst = (vOffset + i) * 3;
        colors[dst] = tmpCol.r;
        colors[dst + 1] = tmpCol.g;
        colors[dst + 2] = tmpCol.b;
      }
    }
    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices[iOffset++] = idx.getX(i) + vOffset;
      }
    } else {
      for (let i = 0; i < count; i++) {
        indices[iOffset++] = vOffset + i;
      }
    }
    vOffset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (colors) {
    merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

/** Dynamic variable-radius 3D tube rebuilt cleanly in place each frame (zero GC churn, precomputed trig). */
export class TaperTube3D {
  public readonly mesh: THREE.Mesh;
  private readonly n: number;
  private readonly m: number;
  private readonly pts: THREE.Vector3[];
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly T = new THREE.Vector3();
  private readonly N = new THREE.Vector3();
  private readonly B = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(segments: number, radial: number, material: THREE.Material, renderOrder = 0) {
    this.n = segments;
    this.m = radial;
    this.cosTable = new Float32Array(radial);
    this.sinTable = new Float32Array(radial);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      this.cosTable[j] = Math.cos(a);
      this.sinTable[j] = Math.sin(a);
    }

    const geo = new THREE.BufferGeometry();
    const count = (segments + 1) * radial;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute(
      'along',
      new THREE.BufferAttribute(
        Float32Array.from({ length: count }, (_, k) => Math.floor(k / radial) / segments),
        1,
      ),
    );
    const index: number[] = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j;
        const b = i * radial + ((j + 1) % radial);
        const c = a + radial;
        const d = b + radial;
        index.push(a, b, c, b, d, c);
      }
    }
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.renderOrder = renderOrder;
    this.mesh.frustumCulled = false;
    this.pts = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
  }

  public update(
    point: (t: number, out: THREE.Vector3) => void,
    radius: (t: number) => number,
    grow: number | ((t: number) => number) = 0,
  ): void {
    const { n, m, pts, cosTable, sinTable, T, N, B, tmp } = this;
    for (let i = 0; i <= n; i++) point(i / n, pts[i]);
    const pos = this.mesh.geometry.attributes.position.array as Float32Array;
    const nrm = this.mesh.geometry.attributes.normal.array as Float32Array;
    const isGrowFn = typeof grow === 'function';
    for (let i = 0; i <= n; i++) {
      T.subVectors(pts[Math.min(n, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      if (i === 0) {
        tmp.set(0, 1, 0);
        if (Math.abs(T.dot(tmp)) > 0.9) tmp.set(1, 0, 0);
        N.crossVectors(T, tmp).normalize();
      } else {
        B.crossVectors(N, T);
        N.crossVectors(T, B).normalize();
      }
      B.crossVectors(T, N).normalize();
      const u = i / n;
      const gVal = isGrowFn ? (grow as (t: number) => number)(u) : (grow as number);
      const r = Math.max(0.0008, radius(u) + gVal);
      const px = pts[i].x;
      const py = pts[i].y;
      const pz = pts[i].z;
      const nx = N.x;
      const ny = N.y;
      const nz = N.z;
      const bx = B.x;
      const by = B.y;
      const bz = B.z;
      for (let j = 0; j < m; j++) {
        const ca = cosTable[j];
        const sa = sinTable[j];
        const c = ca * r;
        const s = sa * r;
        const k = (i * m + j) * 3;
        pos[k] = px + nx * c + bx * s;
        pos[k + 1] = py + ny * c + by * s;
        pos[k + 2] = pz + nz * c + bz * s;
        nrm[k] = nx * ca + bx * sa;
        nrm[k + 1] = ny * ca + by * sa;
        nrm[k + 2] = nz * ca + bz * sa;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
}

interface KeyEntry3D {
  spec: KeySpec;
  index: number;
  x: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  down: boolean;
  depth: number;
  glow: number;
}

interface KeyAtlasData {
  tex: THREE.CanvasTexture;
  rects: Map<string, [number, number, number, number]>;
}

const keyAtlasCache = new Map<string, KeyAtlasData>();
const miscTextureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Packs all unique keycap legends for a layout + orientation into ONE single crisp power-of-2
 * CanvasTexture atlas (128x128 per tile with 2px inner bleed padding), collapsing 67-108 separate
 * keycap textures and 201-324 draw calls into just 2 InstancedMesh draw calls total!
 */
interface KbAtlasPalette {
  alpha: string;
  mod: string;
  accent: string;
  textAlpha: string;
  textDark: string;
}

function getKeycapAtlas(
  layoutId: KeyboardLayoutId,
  keys: readonly KeySpec[],
  rotated180: boolean,
  rog = false,
  pal?: KbAtlasPalette,
): KeyAtlasData {
  const p: KbAtlasPalette =
    pal ??
    (rog
      ? { alpha: '#f4f5f7', mod: '#17191f', accent: '#6a5ae0', textAlpha: '#2b2d34', textDark: '#f2f3f5' }
      : { alpha: '#f9f8f3', mod: '#e6e4db', accent: '#f59b2e', textAlpha: '#2b2d34', textDark: '#2b2d34' });
  const cacheKey = `${layoutId}|${rotated180 ? 1 : 0}|${p.alpha}|${p.mod}|${p.accent}|${p.textAlpha}|${p.textDark}`;
  const cached = keyAtlasCache.get(cacheKey);
  if (cached) return cached;

  const unique: Array<{ key: string; label: string; accent: 'base' | 'mod' | 'orange' }> = [];
  const seen = new Set<string>();
  for (const spec of keys) {
    const accent: 'base' | 'mod' | 'orange' =
      spec.accent === 'orange' ? 'orange' : spec.accent === 'mod' ? 'mod' : 'base';
    const label = spec.id === 'space' ? '' : spec.id === 'esc' ? 'Esc' : spec.label;
    const tk = `${label}|${accent}`;
    if (!seen.has(tk)) {
      seen.add(tk);
      unique.push({ key: tk, label, accent });
    }
  }

  // Place orange accent tiles on their own isolated bottom row so mipmaps NEVER bleed orange onto cream keys!
  const nonOrange = unique.filter((u) => u.accent !== 'orange');
  const orangeOnly = unique.filter((u) => u.accent === 'orange');

  const CELL = 128;
  const cols = nonOrange.length <= 56 ? 8 : 16;
  const nonOrangeRows = Math.ceil(nonOrange.length / cols);
  const totalRows = nonOrangeRows + (orangeOnly.length > 0 ? 1 : 0);
  const atlasW = cols * CELL;
  const atlasH = totalRows <= 8 ? 1024 : 2048;

  const c = document.createElement('canvas');
  c.width = atlasW;
  c.height = atlasH;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f9f8f3';
  g.fillRect(0, 0, atlasW, atlasH);

  const rects = new Map<string, [number, number, number, number]>();
  const PAD = 10.0;

  const paintTile = (
    item: { key: string; label: string; accent: 'base' | 'mod' | 'orange' },
    col: number,
    row: number,
  ) => {
    const ox = col * CELL;
    const oy = row * CELL;

    g.fillStyle =
      item.accent === 'orange' ? p.accent : item.accent === 'mod' ? p.mod : p.alpha;
    g.fillRect(ox, oy, CELL, CELL);

    // Sculpted concave PBT keycap sheen
    const grad = g.createLinearGradient(0, oy + PAD, 0, oy + CELL - PAD);
    grad.addColorStop(0, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0.08)');
    g.fillStyle = grad;
    g.fillRect(ox, oy, CELL, CELL);

    if (item.label) {
      g.save();
      g.translate(ox + CELL * 0.5, oy + CELL * 0.5);
      if (rotated180) g.rotate(Math.PI);
      const len = item.label.length;
      const fontSize = len >= 4 ? 29 : len === 3 ? 35 : len === 2 ? 42 : 52;
      g.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
      g.fillStyle = item.accent === 'orange' ? '#ffffff' : item.accent === 'mod' ? p.textDark : p.textAlpha;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(item.label, 0, 2);
      g.restore();
    }

    // CanvasTexture uses flipY = true: canvas y=0 -> v=1, y=atlasH -> v=0
    const u0 = (ox + PAD) / atlasW;
    const du = (CELL - PAD * 2) / atlasW;
    const v0 = 1.0 - (oy + CELL - PAD) / atlasH;
    const dv = (CELL - PAD * 2) / atlasH;
    rects.set(item.key, [u0, v0, du, dv]);
  };

  for (let i = 0; i < nonOrange.length; i++) {
    paintTile(nonOrange[i], i % cols, Math.floor(i / cols));
  }
  if (orangeOnly.length > 0) {
    // Place orange tiles on the bottom-most atlas row for a full-row mipmap buffer + 10px per-tile padding!
    const orangeRow = Math.floor(atlasH / CELL) - 1;
    g.fillStyle = '#f59b2e';
    g.fillRect(0, orangeRow * CELL, atlasW, CELL);
    for (let i = 0; i < orangeOnly.length; i++) {
      paintTile(orangeOnly[i], i % cols, orangeRow);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const entry: KeyAtlasData = { tex, rects };
  keyAtlasCache.set(cacheKey, entry);
  return entry;
}

function makeSoftShadowTexture(): THREE.CanvasTexture {
  const hit = miscTextureCache.get('shadow:desk');
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 22, 128, 128, 122);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.44)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.20)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  miscTextureCache.set('shadow:desk', tex);
  return tex;
}

function makePrivacyTexture(): THREE.CanvasTexture {
  const hit = miscTextureCache.get('privacy:shield');
  if (hit) return hit;
  const pCanvas = document.createElement('canvas');
  pCanvas.width = 512;
  pCanvas.height = 160;
  const pg = pCanvas.getContext('2d')!;
  pg.fillStyle = 'rgba(15, 20, 32, 0.88)';
  pg.fillRect(0, 0, 512, 160);
  pg.strokeStyle = 'rgba(244, 114, 182, 0.65)';
  pg.lineWidth = 6;
  pg.strokeRect(6, 6, 500, 148);
  pg.font = 'bold 34px "Segoe UI", "PingFang SC", sans-serif';
  pg.fillStyle = '#fbcfe8';
  pg.textAlign = 'center';
  pg.textBaseline = 'middle';
  pg.fillText('🔒 密码防偷窥 · 已隐藏按键', 256, 80);
  const pTex = new THREE.CanvasTexture(pCanvas);
  pTex.colorSpace = THREE.SRGBColorSpace;
  miscTextureCache.set('privacy:shield', pTex);
  return pTex;
}

function makeMouseLabelTexture(char: 'L' | 'R', rotated180: boolean): THREE.CanvasTexture {
  const key = `mouse:${char}:${rotated180 ? 1 : 0}`;
  const hit = miscTextureCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.save();
  g.translate(32, 32);
  if (rotated180) g.rotate(Math.PI);
  g.font = '800 36px "Segoe UI", system-ui, sans-serif';
  g.fillStyle = 'rgba(42, 46, 56, 0.56)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(char, 0, 2);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  miscTextureCache.set(key, tex);
  return tex;
}

function makeRoundedSlabGeo(w: number, d: number, h: number, r: number, y: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const x0 = -w / 2;
  const z0 = -d / 2;
  s.moveTo(x0 + r, z0);
  s.lineTo(x0 + w - r, z0);
  s.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + r);
  s.lineTo(x0 + w, z0 + d - r);
  s.quadraticCurveTo(x0 + w, z0 + d, x0 + w - r, z0 + d);
  s.lineTo(x0 + r, z0 + d);
  s.quadraticCurveTo(x0, z0 + d, x0, z0 + d - r);
  s.lineTo(x0, z0 + r);
  s.quadraticCurveTo(x0, z0, x0 + r, z0);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(Math.PI / 2);
  g.translate(0, y + h, 0);
  return g;
}

function createInstancedKeyTopMaterial(atlasTex: THREE.CanvasTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlasTex },
    },
    vertexShader: `
      attribute vec4 aUvRect;
      attribute vec3 aTint;
      varying vec2 vAtlasUv;
      varying vec3 vTint;
      void main() {
        vAtlasUv = aUvRect.xy + uv * aUvRect.zw;
        vTint = aTint;
        vec4 mvPosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uAtlas;
      varying vec2 vAtlasUv;
      varying vec3 vTint;
      void main() {
        vec4 texel = texture2D(uAtlas, vAtlasUv);
        gl_FragColor = vec4(texel.rgb * vTint, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * KuroCat's iconic clean desktop gear in real 3D:
 * - Slightly canted matte-charcoal mechanical keyboard rendered with 2 InstancedMeshes + 1 Texture Atlas
 * - Cordless oval split-plate L/R mini mouse with engraved L/R & dual-color highlight
 */
export interface KbPreset {
  id?: string;
  name?: string;
  case?: string;
  bezel?: string;
  plate?: string;
  alpha?: string;
  mod?: string;
  accent?: string;
  legendAlpha?: string;
  legendDark?: string;
  screen?: boolean;
}

export class KeyboardAndMouse3D {
  public readonly boardGroup = new THREE.Group();
  /** 键下 RGB 灯层（加色混合，压在键帽之下、定位板之上） */
  private rgbPlane: THREE.Mesh | null = null;
  private rgbTime = 0;
  private rgbState = { mode: 1, color: '#22e0e6', bright: 0.85, speed: 1 };
  private lightsOff = false;
  private paletteMode = 0;
  private paletteColors: [string, string, string] = ['#22e0e6', '#2b6cf0', '#e14ec4'];
  public readonly mouseGroup = new THREE.Group();
  public readonly deskGroup = new THREE.Group();

  private readonly capSideGeo: THREE.CylinderGeometry;
  private readonly capTopBaseGeo: THREE.PlaneGeometry;
  private readonly capSideMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  private readonly chassisMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly kbShadowMat: THREE.MeshBasicMaterial;
  private readonly shadowTex = makeSoftShadowTexture();

  private readonly sideColorBase = new THREE.Color('#dad7cd');
  private readonly sideColorMod = new THREE.Color('#c4c0b4');
  private readonly sideColorOrange = new THREE.Color('#c4741a');
  private readonly whiteColor = new THREE.Color('#ffffff');

  private keys = new Map<string, KeyEntry3D>();
  private activeKeys = new Set<KeyEntry3D>();
  private sideInstanced: THREE.InstancedMesh | null = null;
  private topInstanced: THREE.InstancedMesh | null = null;
  private topTintAttr: THREE.InstancedBufferAttribute | null = null;
  private topTintArray: Float32Array | null = null;
  private boardDisposables: Array<{ dispose(): void }> = [];

  private layoutId: KeyboardLayoutId = '65';
  private preset: KbPreset | null = null;
  private orientation: KeyboardOrientation = 'cat';
  private hitColor = new THREE.Color('#d4f044');
  private rightBtnColor = new THREE.Color('#ff7b3b');
  private boardH = 0.115;
  private capH = 0.056;
  private boardWidth = 2.4;

  // Scratch objects (zero per-frame GC allocations)
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpCol = new THREE.Color();

  // Cordless 3D KuroCat Mini Mouse
  private readonly mouseShape = new THREE.Group();
  private readonly mouseBodyMat: THREE.MeshBasicMaterial;
  private readonly leftBtnMat: THREE.MeshBasicMaterial;
  private readonly rightBtnMat: THREE.MeshBasicMaterial;
  private readonly wheelMat: THREE.MeshBasicMaterial;
  private readonly mouseLabelLMat: THREE.MeshBasicMaterial;
  private readonly mouseLabelRMat: THREE.MeshBasicMaterial;
  private readonly mouseHome = new THREE.Vector3(-1.32, 0.015, 1.04);
  private readonly mouseOffset = new THREE.Vector3();
  private readonly mouseTarget = new THREE.Vector3();
  private readonly mouseFollow = new Spring3D(new THREE.Vector3(), 5.5, 0.78);
  private leftPress = 0;
  private rightPress = 0;
  private wheelGlow = 0;
  private lastDeskHopY = Number.NaN;

  private privacyPlate: THREE.Mesh | null = null;
  private privacyMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    // Open-ended 4-sided beveled keycap frustum (no invisible underside!)
    this.capSideGeo = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.80, Math.SQRT1_2, 1, 4, 1, true);
    this.capSideGeo.rotateY(Math.PI / 4);
    this.capSideGeo.translate(0, 0.5, 0);

    // Exact square top face matching the frustum top corners (+-0.40 at y=1.0)
    this.capTopBaseGeo = new THREE.PlaneGeometry(0.80, 0.80);
    this.capTopBaseGeo.rotateX(-Math.PI / 2);
    this.capTopBaseGeo.translate(0, 1.0, 0);

    this.kbShadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
    });
    this.privacyMat = new THREE.MeshBasicMaterial({
      map: makePrivacyTexture(),
      transparent: true,
      opacity: 0,
      depthTest: false,
    });

    // Subtle playful KuroCat keyboard tilt matching original catEngine.ts
    this.boardGroup.position.set(0.24, 0.015, 1.08);
    this.boardGroup.rotation.set(0.06, -0.042, 0);
    this.deskGroup.add(this.boardGroup);

    // Build Cordless KuroCat Oval Split-Plate Mini Mouse
    this.mouseGroup.position.copy(this.mouseHome);
    this.mouseShape.rotation.y = -0.10;
    this.mouseGroup.add(this.mouseShape);

    const MW = 0.165;
    const MH = 0.098;
    const ML = 0.228;
    const domeGeo = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const q = domeGeo.attributes.position;
    const colors: number[] = [];
    const topC = new THREE.Color('#f7f7f2');
    const sideC = new THREE.Color('#cbc8be');
    const c = new THREE.Color();
    for (let i = 0; i < q.count; i++) {
      const x = q.getX(i);
      const y = q.getY(i);
      const z = q.getZ(i);
      q.setXYZ(i, x * (1 - 0.07 * z), y * (1 - 0.12 * z), z);
      c.copy(sideC).lerp(topC, smoothstep(0.08, 0.76, y));
      colors.push(c.r, c.g, c.b);
    }
    domeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mouseShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(MW * 3.1, ML * 2.8),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.78 }),
    );
    mouseShadow.rotation.x = -Math.PI / 2;
    mouseShadow.position.set(0, 0.002, 0.012);

    const baseSkirt = new THREE.Mesh(
      new THREE.CylinderGeometry(MW * 0.96, MW * 0.92, 0.018, 24),
      new THREE.MeshBasicMaterial({ color: '#b7b5ac' }),
    );
    baseSkirt.scale.set(1, 1, ML / MW);
    baseSkirt.position.y = 0.008;

    this.mouseBodyMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: '#ffffff' });
    const dome = new THREE.Mesh(domeGeo, this.mouseBodyMat);
    dome.scale.set(MW, MH, ML);
    dome.position.y = 0.012;

    const onTop = (x: number, z: number) =>
      0.012 +
      MH *
        (1 - (0.12 * z) / ML) *
        Math.sqrt(Math.max(0, 1 - (x / (MW * (1 - (0.07 * z) / ML))) ** 2 - (z / ML) ** 2));

    // Merge vertical & horizontal mouse seams into a single static draw call
    const seamMat = new THREE.MeshBasicMaterial({ color: '#8e9099', depthTest: true });
    const vSeam = new TaperTube3D(12, 4, seamMat, 6);
    vSeam.update(
      (t, out) => {
        const z = mix(-0.01, ML * 0.95, t);
        out.set(0, onTop(0, z) + 0.003, z);
      },
      () => 0.0038,
    );
    const hSeam = new TaperTube3D(14, 4, seamMat, 6);
    hSeam.update(
      (t, out) => {
        const x = mix(-MW * 0.94, MW * 0.94, t);
        const z = -0.01 + 0.012 * Math.cos(Math.PI * (t - 0.5));
        out.set(x, onTop(x, z) + 0.003, z);
      },
      () => 0.0036,
    );
    const mergedSeamsGeo = mergeStaticGeometries([
      { geo: vSeam.mesh.geometry },
      { geo: hSeam.mesh.geometry },
    ]);
    vSeam.mesh.geometry.dispose();
    hSeam.mesh.geometry.dispose();
    const seamsMesh = new THREE.Mesh(mergedSeamsGeo, seamMat);
    seamsMesh.renderOrder = 6;

    this.wheelMat = new THREE.MeshBasicMaterial({ color: '#555966', depthTest: true });
    const wheel = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), this.wheelMat);
    wheel.scale.set(0.016, 0.013, 0.036);
    wheel.position.set(0, onTop(0, ML * 0.44) + 0.005, ML * 0.44);
    wheel.renderOrder = 7;

    // Curved surface-hugging LMB (+X in cat-facing) & RMB (-X in cat-facing) highlight plates
    const makeBtnPatch = (sideSign: -1 | 1) => {
      const geo = new THREE.PlaneGeometry(1, 1, 8, 8);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) + 0.5;
        const v = pos.getY(i) + 0.5;
        const ang = (1 - v) * (Math.PI * 0.46);
        const rad = 0.08 + u * 0.85;
        const x = sideSign * Math.max(0.010, Math.cos(ang) * rad * MW * 0.92);
        const z = Math.max(0.004, Math.sin(ang) * rad * ML * 0.92);
        pos.setXYZ(i, x, onTop(x, z) + 0.004, z);
      }
      geo.computeVertexNormals();
      return geo;
    };

    this.leftBtnMat = new THREE.MeshBasicMaterial({
      color: '#d4f044',
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const leftBtn = new THREE.Mesh(makeBtnPatch(1), this.leftBtnMat);
    leftBtn.renderOrder = 5;
    leftBtn.visible = false;

    this.rightBtnMat = new THREE.MeshBasicMaterial({
      color: '#ff7b3b',
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const rightBtn = new THREE.Mesh(makeBtnPatch(-1), this.rightBtnMat);
    rightBtn.renderOrder = 5;
    rightBtn.visible = false;

    this.mouseLabelLMat = new THREE.MeshBasicMaterial({
      map: makeMouseLabelTexture('L', true),
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this.mouseLabelRMat = new THREE.MeshBasicMaterial({
      map: makeMouseLabelTexture('R', true),
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const lblGeo = new THREE.PlaneGeometry(0.068, 0.068);
    lblGeo.rotateX(-Math.PI / 2);
    const lblL = new THREE.Mesh(lblGeo, this.mouseLabelLMat);
    lblL.position.set(MW * 0.42, onTop(MW * 0.42, ML * 0.48) + 0.009, ML * 0.48);
    lblL.renderOrder = 8;
    const lblR = new THREE.Mesh(lblGeo, this.mouseLabelRMat);
    lblR.position.set(-MW * 0.42, onTop(-MW * 0.42, ML * 0.48) + 0.009, ML * 0.48);
    lblR.renderOrder = 8;

    this.mouseShape.add(
      mouseShadow,
      baseSkirt,
      dome,
      leftBtn,
      rightBtn,
      seamsMesh,
      wheel,
      lblL,
      lblR,
    );
    this.mouseShape.userData.leftBtn = leftBtn;
    this.mouseShape.userData.rightBtn = rightBtn;
    this.deskGroup.add(this.mouseGroup);

    scene.add(this.deskGroup);
    this.rebuildBoard('65', 'cat');
  }

  /** 应用自定义键盘配色（来自 %APPDATA%\kuro-cat-pet\keyboards\*.json） */
  public setPreset(p: KbPreset | null): void {
    this.preset = p;
    this.sideInstanced = null; // 强制重建
    this.rebuildBoard(this.layoutId, this.orientation);
  }

  public setAccentColors(primaryHex: string, rightHex: string): void {
    this.hitColor.set(primaryHex);
    this.rightBtnColor.set(rightHex);
    this.leftBtnMat.color.set(primaryHex);
    this.rightBtnMat.color.set(rightHex);
  }

  public setStyle(style: '3d' | '2d'): void {
    const is3D = style === '3d';
    this.mouseBodyMat.vertexColors = is3D;
    this.mouseBodyMat.color.set(is3D ? '#ffffff' : '#f4f4f0');
    this.mouseBodyMat.needsUpdate = true;
  }

  public rebuildBoard(layoutId: KeyboardLayoutId, orientation: KeyboardOrientation): void {
    // Skip redundant rebuild if nothing changed and meshes already exist
    if (this.sideInstanced && this.layoutId === layoutId && this.orientation === orientation) {
      return;
    }

    this.layoutId = layoutId;
    this.orientation = orientation;
    this.keys.clear();
    this.activeKeys.clear();

    while (this.boardGroup.children.length > 0) {
      this.boardGroup.remove(this.boardGroup.children[0]);
    }
    for (const d of this.boardDisposables) {
      d.dispose();
    }
    this.boardDisposables.length = 0;

    const layout = getKeyboardLayout(layoutId);
    const is108 = layoutId === '108';
    const isRog = layoutId === '75';
    const isCatFacing = orientation === 'cat';

    // 配色优先级：自定义预设 > ROG 75 默认 > 原版奶油色
    const pal = this.preset;
    this.sideColorBase.set(pal?.alpha ?? (isRog ? '#f4f5f7' : '#dad7cd'));
    this.sideColorMod.set(pal?.mod ?? (isRog ? '#17191f' : '#c4c0b4'));
    this.sideColorOrange.set(pal?.accent ?? (isRog ? '#6a5ae0' : '#c4741a'));

    // Sync mouse orientation (180° cat-facing vs 0° viewer-facing)
    this.mouseShape.rotation.y = isCatFacing ? -0.10 : Math.PI - 0.10;
    this.mouseLabelLMat.map = makeMouseLabelTexture('L', isCatFacing);
    this.mouseLabelRMat.map = makeMouseLabelTexture('R', isCatFacing);
    this.mouseLabelLMat.needsUpdate = true;
    this.mouseLabelRMat.needsUpdate = true;

    const U = is108 ? 0.122 : isRog ? 0.132 : 0.150;
    const CAP = U * 0.87;
    const W = layout.totalUnits * U + 0.14;
    const D = layout.totalRows * U + 0.14;
    this.boardWidth = W;
    this.boardH = 0.112;
    this.capH = is108 ? 0.048 : isRog ? 0.050 : 0.056;

    this.boardGroup.position.set(0.24, 0.015, 1.08);
    this.mouseHome.set(is108 ? -1.46 : -1.16, 0.015, 0.96);

    // Soft grounded desk shadow under keyboard
    const kbShadowGeo = new THREE.PlaneGeometry(W * 1.18, D * 1.38);
    const kbShadow = new THREE.Mesh(kbShadowGeo, this.kbShadowMat);
    kbShadow.rotation.x = -Math.PI / 2;
    kbShadow.position.set(0, 0.002, 0.025);
    this.boardDisposables.push(kbShadowGeo);

    // Merge baseChassis + topBezel + plate into 1 single vertex-colored draw call!
    const baseGeo = makeRoundedSlabGeo(W, D, this.boardH, 0.068, 0);
    const bezelGeo = makeRoundedSlabGeo(W - 0.014, D - 0.014, 0.014, 0.060, this.boardH - 0.008);
    const plateGeo = makeRoundedSlabGeo(W - 0.062, D - 0.062, 0.008, 0.044, this.boardH + 0.004);
    const chassisGeo = mergeStaticGeometries([
      { geo: baseGeo, color: pal?.case ?? (isRog ? '#e4e7ec' : '#202229') },
      { geo: bezelGeo, color: pal?.bezel ?? (isRog ? '#f7f8fa' : '#2c2f38') },
      { geo: plateGeo, color: pal?.plate ?? (isRog ? '#cfd4db' : '#181a20') },
    ]);
    baseGeo.dispose();
    bezelGeo.dispose();
    plateGeo.dispose();
    const chassisMesh = new THREE.Mesh(chassisGeo, this.chassisMat);
    this.boardDisposables.push(chassisGeo);
    this.boardGroup.add(kbShadow, chassisMesh);

    // —— 键下 RGB 灯层：位于定位板上方、键帽下方，只从键缝里透出来 ——
    const rgbGeo = new THREE.PlaneGeometry(W - 0.085, D - 0.065);
    const rgbMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBright: { value: this.rgbState.bright },
        uMode: { value: this.rgbState.mode },
        uColA: { value: new THREE.Color(this.rgbState.color) },
        uColB: { value: new THREE.Color('#2b6cf0') },
        uColC: { value: new THREE.Color('#e14ec4') },
        uColorMode: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime; uniform float uBright; uniform float uMode;
        uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uColC;
        uniform float uColorMode; // 0=彩虹 1=纯色 2=混色
        varying vec2 vUv;

        // HSV → RGB，用来做整片彩虹，而不是两色渐变
        vec3 hsv2rgb(vec3 c) {
          vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return c.z * mix(vec3(1.0), rgb, c.y);
        }

        void main() {
          float g;
          vec3 col;
          if (uMode < 1.5) {
            // 彩虹渐变：色相铺满整排 + 三层光带叠加以增强层次
            float hue = fract(vUv.x * 1.05 + uTime * 0.07);
            float sat = 0.95;
            col = hsv2rgb(vec3(hue, sat, 1.0));
            float layer1 = 0.78 + 0.22 * sin(vUv.x * 9.42 + uTime * 0.9);        // 主光带
            float layer2 = 0.16 * sin(vUv.x * 21.99 - uTime * 1.6);               // 细密流动
            float layer3 = 0.10 * sin(vUv.y * 6.28 + uTime * 0.55);               // 纵向缓慢起伏
            g = layer1 + layer2 + layer3;
          } else if (uMode < 2.5) {
            // 彩虹呼吸：色相整体缓慢旋转 + 亮度起伏，像呼吸灯但仍有色彩流动
            float hue = fract(uTime * 0.05 + vUv.y * 0.25);
            col = hsv2rgb(vec3(hue, 0.88, 1.0));
            g = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 1.45));
          } else {
            // 流光：斜向扫过的彩色光带，带宽处饱和、带外留一点底色
            float band = fract(vUv.x * 1.05 - vUv.y * 0.35 - uTime * 0.20);
            float sweep = smoothstep(0.0, 0.22, band) * (1.0 - smoothstep(0.26, 0.78, band));
            float hue = fract(vUv.x * 0.75 - uTime * 0.12 + band * 0.35);
            col = hsv2rgb(vec3(hue, 0.95, 1.0));
            g = 0.14 + 0.86 * sweep;
          }
          // —— 配色模式：0 彩虹（默认） / 1 纯色 / 2 三色混合 ——
          if (uColorMode > 1.5) {
            float t = clamp(vUv.x, 0.0, 1.0);
            col = t < 0.5
              ? mix(uColA, uColB, smoothstep(0.0, 0.5, t))
              : mix(uColB, uColC, smoothstep(0.5, 1.0, t));
          } else if (uColorMode > 0.5) {
            col = uColA;
          }

          // 亮度归一但保留对比：0.55~1.12，浅色键帽上也能看清光带层次
          g = 0.55 + 0.57 * clamp(g, 0.0, 1.0);
          // 边缘柔化：靠外侧渐弱，形成自然光晕而不是硬边
          float halo = smoothstep(0.0, 0.12, vUv.x) * smoothstep(0.0, 0.12, 1.0 - vUv.x);
          g *= mix(0.82, 1.0, halo);
          // 只留 3% 主色染色，保持彩虹饱和
          col = mix(col, uColA, 0.03);
          // 轻度软压缩，避免高亮过曝刺眼
          float lit = g * uBright;
          lit = lit / (1.0 + lit * 0.35);
          gl_FragColor = vec4(col * lit * 1.25, lit * 0.95);
        }
      `,
    });
    const rgbPlane = new THREE.Mesh(rgbGeo, rgbMat);
    rgbPlane.rotation.x = -Math.PI / 2;
    rgbPlane.position.set(0, this.boardH + 0.0135, 0.012); // 定位板顶面 = boardH+0.012，灯层必须在其之上、键帽之下
    rgbPlane.renderOrder = 3;
    this.rgbPlane = rgbPlane;
    this.boardDisposables.push(rgbGeo);
    this.boardGroup.add(rgbPlane);

    // ROG 75% 右上角的屏幕 + 旋钮（参考图那块深色小面板）
    if (pal?.screen ?? isRog) {
      const sw = 3.35 * U;
      const sd = 1.02 * U;
      const su = 14.9;
      const sxc = isCatFacing ? layout.totalUnits - su : su;
      const px = (sxc - layout.totalUnits * 0.5) * U;
      // 行也要跟着翻转，否则「面向猫咪」时屏幕会跑到键帽下面
      const sr = isCatFacing ? layout.totalRows - 0.5 : 0.5;
      const pz = (sr - layout.totalRows * 0.5) * U;

      // 银色边框 + 深色屏
      const frameGeo = makeRoundedSlabGeo(sw + 0.03, sd + 0.03, 0.030, 0.03, this.boardH + 0.004);
      const frameMat = new THREE.MeshBasicMaterial({ color: '#cfd4db' });
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.position.set(px, 0, pz);
      this.boardGroup.add(frame);

      const panelGeo = makeRoundedSlabGeo(sw, sd, 0.024, 0.024, this.boardH + 0.014);
      const panelMat = new THREE.MeshBasicMaterial({ color: '#0b0c10' });
      const panel = new THREE.Mesh(panelGeo, panelMat);
      panel.position.set(px, 0, pz);
      this.boardGroup.add(panel);

      // 屏幕内容：紫色小徽标 + KURO 字样
      const scr = document.createElement('canvas');
      scr.width = 256;
      scr.height = 80;
      const sc = scr.getContext('2d')!;
      sc.fillStyle = '#0b0c10';
      sc.fillRect(0, 0, 256, 80);
      sc.strokeStyle = '#7a63ff';
      sc.lineWidth = 3;
      sc.beginPath();
      sc.arc(40, 40, 17, Math.PI * 0.15, Math.PI * 1.85);
      sc.stroke();
      sc.fillStyle = '#b39dff';
      sc.beginPath();
      sc.arc(40, 40, 6, 0, Math.PI * 2);
      sc.fill();
      sc.fillStyle = '#e8e2ff';
      sc.font = '700 26px "Segoe UI", sans-serif';
      sc.fillText('KURO', 78, 50);
      sc.fillStyle = '#7a63ff';
      sc.fillRect(78, 60, 96, 3);
      const scrTex = new THREE.CanvasTexture(scr);
      scrTex.colorSpace = THREE.SRGBColorSpace;
      const scrMat = new THREE.MeshBasicMaterial({ map: scrTex });
      const scrGeo = new THREE.PlaneGeometry(sw * 0.86, sd * 0.62);
      const scrMesh = new THREE.Mesh(scrGeo, scrMat);
      scrMesh.rotation.x = -Math.PI / 2;
      scrMesh.position.set(px - sw * 0.02, this.boardH + 0.040, pz);
      this.boardGroup.add(scrMesh);
      this.boardDisposables.push(frameGeo, frameMat, panelGeo, panelMat, scrGeo, scrMat, scrTex);

      const knobGeo = new THREE.CylinderGeometry(0.070, 0.078, 0.055, 22);
      const knobMat = new THREE.MeshBasicMaterial({ color: '#cfd4db' });
      const knob = new THREE.Mesh(knobGeo, knobMat);
      knob.position.set(px + sw * 0.5 + 0.035, this.boardH + 0.052, pz);
      this.boardGroup.add(knob);
      this.boardDisposables.push(knobGeo, knobMat);
    }

    // Single Texture Atlas + 2 InstancedMeshes for ALL 67 or 108 keycaps (2 draw calls total!)
    const keyCount = layout.keys.length;
    const atlas = getKeycapAtlas(layoutId, layout.keys, isCatFacing, isRog, {
      alpha: pal?.alpha ?? (isRog ? '#f4f5f7' : '#f9f8f3'),
      mod: pal?.mod ?? (isRog ? '#17191f' : '#e6e4db'),
      accent: pal?.accent ?? (isRog ? '#6a5ae0' : '#f59b2e'),
      textAlpha: pal?.legendAlpha ?? '#2b2d34',
      textDark: pal?.legendDark ?? (isRog ? '#f2f3f5' : '#2b2d34'),
    });

    const sideInst = new THREE.InstancedMesh(this.capSideGeo, this.capSideMat, keyCount);
    sideInst.frustumCulled = false;

    const topGeo = this.capTopBaseGeo.clone();
    const uvRects = new Float32Array(keyCount * 4);
    const tints = new Float32Array(keyCount * 3);
    const uvAttr = new THREE.InstancedBufferAttribute(uvRects, 4);
    const tintAttr = new THREE.InstancedBufferAttribute(tints, 3);
    tintAttr.setUsage(THREE.DynamicDrawUsage);
    topGeo.setAttribute('aUvRect', uvAttr);
    topGeo.setAttribute('aTint', tintAttr);

    const topMat = createInstancedKeyTopMaterial(atlas.tex);
    const topInst = new THREE.InstancedMesh(topGeo, topMat, keyCount);
    topInst.frustumCulled = false;
    this.boardDisposables.push(topGeo, topMat);

    const baseY = this.boardH + 0.008;
    for (let i = 0; i < keyCount; i++) {
      const spec = layout.keys[i];
      const rY = spec.rowY ?? spec.row;
      const rSpan = spec.rowSpan ?? 1;
      const uCenter = spec.uStart + spec.uWidth * 0.5;
      const rCenter = rY + rSpan * 0.5;

      const screenU = isCatFacing ? layout.totalUnits - uCenter : uCenter;
      const screenR = isCatFacing ? layout.totalRows - rCenter : rCenter;

      const x = (screenU - layout.totalUnits * 0.5) * U;
      const z = (screenR - layout.totalRows * 0.5) * U;
      const scaleX = Math.max(0.06, spec.uWidth * U - (U - CAP));
      const scaleY = this.capH;
      const scaleZ = Math.max(0.06, rSpan * U - (U - CAP));

      this.tmpPos.set(x, baseY, z);
      this.tmpScale.set(scaleX, scaleY, scaleZ);
      this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      sideInst.setMatrixAt(i, this.tmpMat);
      topInst.setMatrixAt(i, this.tmpMat);

      const accent: 'base' | 'mod' | 'orange' =
        spec.accent === 'orange' ? 'orange' : spec.accent === 'mod' ? 'mod' : 'base';
      sideInst.setColorAt(
        i,
        accent === 'orange'
          ? this.sideColorOrange
          : accent === 'mod'
            ? this.sideColorMod
            : this.sideColorBase,
      );

      const legendText = spec.id === 'space' ? '' : spec.id === 'esc' ? 'Esc' : spec.label;
      const rect = atlas.rects.get(`${legendText}|${accent}`) ?? [0, 0, 0.1, 0.1];
      uvRects[i * 4] = rect[0];
      uvRects[i * 4 + 1] = rect[1];
      uvRects[i * 4 + 2] = rect[2];
      uvRects[i * 4 + 3] = rect[3];

      tints[i * 3] = 1;
      tints[i * 3 + 1] = 1;
      tints[i * 3 + 2] = 1;

      this.keys.set(spec.id, {
        spec,
        index: i,
        x,
        z,
        scaleX,
        scaleY,
        scaleZ,
        down: false,
        depth: 0,
        glow: 0,
      });
    }

    sideInst.instanceMatrix.needsUpdate = true;
    if (sideInst.instanceColor) sideInst.instanceColor.needsUpdate = true;
    topInst.instanceMatrix.needsUpdate = true;
    this.sideInstanced = sideInst;
    this.topInstanced = topInst;
    this.topTintAttr = tintAttr;
    this.topTintArray = tints;
    this.boardGroup.add(sideInst, topInst);

    // Privacy dark frosted shield over the 3D keyboard
    const privGeo = new THREE.PlaneGeometry(W - 0.08, D - 0.08);
    this.boardDisposables.push(privGeo);
    this.privacyPlate = new THREE.Mesh(privGeo, this.privacyMat);
    this.privacyPlate.rotation.x = -Math.PI / 2;
    this.privacyPlate.position.set(0, this.boardH + this.capH + 0.025, 0);
    this.privacyPlate.renderOrder = 30;
    this.privacyPlate.visible = false;
    this.boardGroup.add(this.privacyPlate);

    this.deskGroup.updateMatrixWorld(false);
    this.boardGroup.updateMatrixWorld(false);
  }

  public getLayoutId(): KeyboardLayoutId {
    return this.layoutId;
  }

  public getOrientation(): KeyboardOrientation {
    return this.orientation;
  }

  public getBoardWidth(): number {
    return this.boardWidth;
  }

  public resolveKey(vk: number): KeyEntry3D | null {
    const spec = resolveKeyByVk(vk, this.layoutId);
    if (!spec) return null;
    return this.keys.get(spec.id) || null;
  }

  public getKeyById(id: string): KeyEntry3D | null {
    return this.keys.get(id) || null;
  }

  public setKeyDown(id: string, down: boolean): void {
    const k = this.keys.get(id);
    if (!k) return;
    if (k.down !== down) {
      k.down = down;
      this.activeKeys.add(k);
    } else if (down) {
      this.activeKeys.add(k);
    }
  }

  public releaseAllKeys(): void {
    for (const k of this.keys.values()) {
      if (k.down) {
        k.down = false;
        this.activeKeys.add(k);
      }
    }
  }

  public keyTopWorld(id: string, out = new THREE.Vector3()): THREE.Vector3 {
    const k = this.keys.get(id);
    this.deskGroup.updateMatrixWorld(false);
    this.boardGroup.updateMatrixWorld(false);
    if (!k) return out.set(0.24, this.boardH + this.capH, 1.08);
    return out
      .set(k.x, this.boardH + 0.008 + this.capH - k.depth, k.z)
      .applyMatrix4(this.boardGroup.matrixWorld);
  }

  public isRightEdgeTailKey(id: string): boolean {
    const k = this.keys.get(id);
    if (!k) return false;
    return k.x >= this.boardWidth * 0.22;
  }

  public setMouseNormalized(nx: number, ny: number): void {
    this.mouseTarget.set((nx - 0.5) * 0.22, 0, (ny - 0.5) * 0.14);
  }

  public pulseScrollWheel(): void {
    this.wheelGlow = 1;
  }

  public mouseTopWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.deskGroup.updateMatrixWorld(false);
    this.mouseGroup.updateMatrixWorld(false);
    this.mouseShape.updateMatrixWorld(false);
    return out.set(0, 0.115, -0.05).applyMatrix4(this.mouseShape.matrixWorld);
  }

  /** 配色：0 彩虹 / 1 纯色 / 2 混色（三色） */
  public setPaletteMode(mode: number, colors: [string, string, string]): void {
    const mat = this.rgbPlane?.material as THREE.ShaderMaterial | undefined;
    this.paletteMode = mode;
    this.paletteColors = colors;
    if (!mat) return;
    mat.uniforms.uColorMode.value = mode;
    (mat.uniforms.uColA.value as THREE.Color).set(colors[0]);
    (mat.uniforms.uColB.value as THREE.Color).set(colors[1]);
    (mat.uniforms.uColC.value as THREE.Color).set(colors[2]);
  }

  /** 键盘总灯光开关：true = 全部熄灭（RGB 灯层 + 按键按下的发光） */
  public setLightsOff(off: boolean): void {
    this.lightsOff = off;
    if (off) {
      for (const k of this.keys.values()) k.glow = 0;
      if (this.rgbPlane) this.rgbPlane.visible = false;
    }
  }

  public setRgb(opts: Partial<{ mode: number; color: string; bright: number; speed: number }>): void {
    if (opts.mode !== undefined) this.rgbState.mode = opts.mode;
    if (opts.color) {
      this.rgbState.color = opts.color;
      const mat = this.rgbPlane?.material as THREE.ShaderMaterial | undefined;
      if (mat) (mat.uniforms.uColA.value as THREE.Color).set(opts.color);
    }
    if (opts.bright !== undefined) this.rgbState.bright = Math.max(0, Math.min(1.5, opts.bright));
    if (opts.speed !== undefined) this.rgbState.speed = Math.max(0.1, Math.min(3, opts.speed));
  }

  public update(
    dt: number,
    leftDown: boolean,
    rightDown: boolean,
    deskHopY: number,
    privacyAlpha: number,
  ): void {
    // RGB 灯层动画：模式 0 = 关闭；总开关关闭时整层不渲染
    if (this.rgbPlane) {
      const on = !this.lightsOff && this.rgbState.mode > 0 && this.rgbState.bright > 0.01;
      this.rgbPlane.visible = on;
      if (on) {
        this.rgbTime += dt * this.rgbState.speed;
        const mat = this.rgbPlane.material as THREE.ShaderMaterial;
        mat.uniforms.uTime.value = this.rgbTime;
        mat.uniforms.uBright.value = this.rgbState.bright;
        mat.uniforms.uMode.value = this.rgbState.mode;
      }
    }

    if (deskHopY !== this.lastDeskHopY) {
      this.deskGroup.position.y = deskHopY;
      this.lastDeskHopY = deskHopY;
    }

    // Only animate keys that are actually pressed or rebounding/fading (0-3 keys instead of 67-108!)
    if (this.activeKeys.size > 0 && this.sideInstanced && this.topInstanced && this.topTintAttr && this.topTintArray) {
      let matrixDirty = false;
      let tintDirty = false;
      const baseY = this.boardH + 0.008;
      const kDownDepth = approach(62, dt);
      const kUpDepth = approach(24, dt);
      const kDownGlow = approach(44, dt);
      const kUpGlow = approach(6.5, dt);

      for (const k of this.activeKeys) {
        const targetDepth = k.down ? 0.032 : 0;
        k.depth += (targetDepth - k.depth) * (k.down ? kDownDepth : kUpDepth);
        k.glow += this.lightsOff ? -k.glow : ((k.down ? 1 : 0) - k.glow) * (k.down ? kDownGlow : kUpGlow);

        const settled = !k.down && k.depth < 0.00025 && k.glow < 0.002;
        if (settled) {
          k.depth = 0;
          k.glow = 0;
          this.activeKeys.delete(k);
        }

        this.tmpPos.set(k.x, baseY - k.depth, k.z);
        this.tmpScale.set(k.scaleX, k.scaleY, k.scaleZ);
        this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
        this.sideInstanced.setMatrixAt(k.index, this.tmpMat);
        this.topInstanced.setMatrixAt(k.index, this.tmpMat);
        matrixDirty = true;

        this.tmpCol.copy(this.whiteColor).lerp(this.hitColor, k.glow * 0.90);
        const off = k.index * 3;
        this.topTintArray[off] = this.tmpCol.r;
        this.topTintArray[off + 1] = this.tmpCol.g;
        this.topTintArray[off + 2] = this.tmpCol.b;
        tintDirty = true;
      }

      if (matrixDirty) {
        this.sideInstanced.instanceMatrix.needsUpdate = true;
        this.topInstanced.instanceMatrix.needsUpdate = true;
      }
      if (tintDirty) {
        this.topTintAttr.needsUpdate = true;
      }
    }

    if (this.privacyPlate) {
      this.privacyPlate.visible = privacyAlpha > 0.02;
      this.privacyMat.opacity = privacyAlpha;
    }

    this.mouseTarget.multiplyScalar(1 - approach(1.6, dt));
    this.mouseOffset.copy(this.mouseFollow.step(this.mouseTarget, dt));
    this.mouseGroup.position.copy(this.mouseHome).add(this.mouseOffset);

    this.leftPress += ((leftDown ? 1 : 0) - this.leftPress) * approach(32, dt);
    this.rightPress += ((rightDown ? 1 : 0) - this.rightPress) * approach(32, dt);
    if (this.leftPress < 0.002 && !leftDown) this.leftPress = 0;
    if (this.rightPress < 0.002 && !rightDown) this.rightPress = 0;
    this.wheelGlow = Math.max(0, this.wheelGlow - dt * 3.8);

    // Hide transparent L/R click highlight patches completely when not pressed (saves 2 alpha draw calls!)
    const leftBtn = this.mouseShape.userData.leftBtn as THREE.Mesh | undefined;
    const rightBtn = this.mouseShape.userData.rightBtn as THREE.Mesh | undefined;
    this.leftBtnMat.opacity = 0.88 * this.leftPress;
    this.rightBtnMat.opacity = 0.88 * this.rightPress;
    if (leftBtn) leftBtn.visible = this.leftPress > 0.005;
    if (rightBtn) rightBtn.visible = this.rightPress > 0.005;

    this.wheelMat.color.set('#555966').lerp(this.hitColor, this.wheelGlow);

    const anyPress = Math.max(this.leftPress, this.rightPress);
    this.mouseShape.scale.set(1 + 0.03 * anyPress, 1 - 0.10 * anyPress, 1);
  }
}
