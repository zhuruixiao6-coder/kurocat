/**
 * 3D 配饰构建器。
 *
 * 设计原则（和内置「电竞耳机」完全一致）：
 * 1. **真几何体**，不是贴图/画布叠加 —— 进同一个 scene，参与 z-buffer，
 *    该被猫头挡住就被挡住，该压住毛就压住毛，这才是「融合在一起」。
 * 2. **挂点局部坐标系**建面 —— 头饰建在 headMount 局部空间里，
 *    猫歪头/呼吸时整件配饰跟着走，不会浮在屏幕上。
 * 3. **贴着曲面长** —— 帽子用 `headRadius(y)+厚度` 车一圈 Lathe，
 *    眼镜/口罩用 `surfaceZ(x,y)` 贴合体表，项圈用 `collarR` 车环。
 *
 * 坐标系约定：
 * - head 局部：y=0.105 是眼睛线，x=±0.232 是眼心，y≈0.31 额头，y=0.42 头顶；
 *   猫体是 y 轴 Lathe，z 方向压扁到 Z_SCALE。
 * - neck 局部：半径单位是 collarR（neckMount 自带缩放）。
 * - back / floor / prop：catRoot 局部，y=0 是地面。
 * - paw：单位球空间（引擎会把 arm.paw 的位移/缩放复制过来）。
 */
import * as THREE from 'three';

export interface Acc3DCtx {
  /** head 局部 y → 该高度处猫体半径 */
  headRadius: (localY: number) => number;
  /** head 局部 (x,y) → 该点体表 z（已含 Z_SCALE） */
  surfaceZ: (x: number, y: number) => number;
  /** 颈部基础半径 */
  collarR: number;
  /** 体表 z 压扁系数 */
  zScale: number;
}

// ---------------------------------------------------------------- 基础工具

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * 和耳机同一套「棚拍」着色：包裹式漫反射 + 高光 + 边缘光。
 * 单面/双面都能正确受光（背面翻转法线）。
 */
export function createAccMaterial(
  hex: string,
  opts: {
    spec?: number;
    opacity?: number;
    rim?: number;
    glow?: number;
    rough?: number;
    grain?: number;
    map?: THREE.Texture;
  } = {},
): THREE.ShaderMaterial {
  const { spec = 0.18, opacity = 1, rim = 0.26, glow = 0, rough = 0.5 } = opts;
  // 布料颗粒更明显、金属几乎没有：让「毛线 / 皮 / 塑料」看起来是不同的东西
  const grain = opts.grain ?? (rough > 0.72 ? 0.085 : rough > 0.5 ? 0.05 : 0.022);
  return new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color(hex) },
      uSpec: { value: spec },
      uOpacity: { value: opacity },
      uRim: { value: rim },
      uGlow: { value: glow },
      uRough: { value: rough },
      uGrain: { value: grain },
      uIs3D: { value: 1 },
      uMap: { value: opts.map ?? null },
      uHasMap: { value: opts.map ? 1 : 0 },
    },
    transparent: opacity < 0.999 || Boolean(opts.map),
    depthWrite: opacity > 0.999 && !opts.map,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uBase;
      uniform float uSpec;
      uniform float uOpacity;
      uniform float uRim;
      uniform float uGlow;
      uniform float uRough;
      uniform float uGrain;
      uniform sampler2D uMap;
      uniform float uHasMap;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        vec3 v = normalize(vV);

        // 主光（左上前）+ 补光（右下后），和电竞耳机同一套棚拍布光
        vec3 L1 = normalize(vec3(-0.42, 0.74, 0.52));
        vec3 L2 = normalize(vec3(0.62, -0.20, 0.40));
        float wrap = 0.34;
        float d1 = max(0.0, (dot(n, L1) + wrap) / (1.0 + wrap));
        float d2 = max(0.0, dot(n, L2));

        // 半球环境光：朝上吃天光、朝下吃地面反光 → 明暗有层次，侧面不死黑
        float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 amb = mix(uBase * 0.34, uBase * 0.58 + vec3(0.035, 0.042, 0.055), sky);
        vec3 col = amb + uBase * (d1 * 0.50 + d2 * 0.13);

        // 高光：粗糙度越低越锐（塑料/金属 ≠ 绒布）
        vec3 h = normalize(L1 + v);
        float specPow = mix(96.0, 10.0, clamp(uRough, 0.0, 1.0));
        col += vec3(pow(max(dot(n, h), 0.0), specPow) * uSpec);

        // 菲涅尔边缘光：轮廓一圈微微提亮，跟猫的绒毛边缘光对齐
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        col += uBase * fres * uRim * 1.55;

        col += uBase * uGlow;

        // 微颗粒：布料像织物、皮面有细纹、金属几乎光滑
        float n1 = fract(sin(dot(floor(vW * 260.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float n2 = fract(sin(dot(floor(vW * 61.0), vec3(39.346, 11.135, 83.155))) * 24634.6345);
        col *= 1.0 + (n1 - 0.5) * uGrain + (n2 - 0.5) * uGrain * 1.6;

        float alpha = uOpacity;
        if (uHasMap > 0.5) {
          vec4 tex = texture2D(uMap, vUv);
          col *= tex.rgb;
          alpha *= tex.a;
        }
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
}

function make(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(geo, mat);
}

function place(
  obj: THREE.Object3D,
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scl: [number, number, number] = [1, 1, 1],
): THREE.Object3D {
  obj.position.set(pos[0], pos[1], pos[2]);
  obj.rotation.set(rot[0], rot[1], rot[2]);
  obj.scale.set(scl[0], scl[1], scl[2]);
  return obj;
}

/** 沿曲线生成半径渐变的管（帽尖、鹿角、眼镜腿都用它） */
function taperTube(
  pts: Array<[number, number, number]>,
  r0: number,
  r1: number,
  segs = 18,
  radial = 8,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    'centripetal',
  );
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i += 1) {
    const u = i / segs;
    const p = curve.getPoint(u);
    const n = frames.normals[i];
    const b = frames.binormals[i];
    // 两端各留一点点收口，避免看到「空心管口」
    const cap = Math.min(1, Math.sin(Math.PI * Math.min(1, Math.max(0.06, u))) * 1.6);
    const r = mix(r0, r1, u) * cap;
    for (let j = 0; j < radial; j += 1) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.push(
        p.x + (n.x * ca + b.x * sa) * r,
        p.y + (n.y * ca + b.y * sa) * r,
        p.z + (n.z * ca + b.z * sa) * r,
      );
    }
  }
  for (let i = 0; i < segs; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 贴着头壳长的一层「壳」：从 y0 一直到头顶收口 */
function headShell(
  ctx: Acc3DCtx,
  y0: number,
  thick: number,
  opts: { bulge?: number; y1?: number; segs?: number; dome?: number; radial?: number } = {},
): THREE.BufferGeometry {
  const { bulge = 0, y1 = 0.418, segs = 20, dome = thick * 2.1, radial = 56 } = opts;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= segs; i += 1) {
    const y = mix(y0, y1, i / segs);
    const r = Math.max(0.001, ctx.headRadius(y) + thick + bulge * (1 - i / segs));
    pts.push(new THREE.Vector2(r, y));
  }
  // 帽冠：用四分之一椭圆收成圆顶，而不是直接在 0.03 内收成一个点
  // —— 之前那种「压平封口」就是预览里帽子像锅盖的原因
  const rTop = Math.max(0.02, ctx.headRadius(y1) + thick);
  const domeSegs = 10;
  for (let i = 1; i <= domeSegs; i += 1) {
    const t = i / domeSegs;
    const r = rTop * Math.cos((t * Math.PI) / 2);
    const y = y1 + dome * Math.sin((t * Math.PI) / 2);
    pts.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const geo = new THREE.LatheGeometry(pts, radial);
  // 猫头是扁的（z 方向 0.82），帽壳必须跟着压扁，否则前后会「飘」在头外面
  geo.scale(1, 1, ctx.zScale);
  return geo;
}

/** 环绕头部的圈（帽檐、发带、护目镜带） */
function headRing(
  ctx: Acc3DCtx,
  y: number,
  extra: number,
  tube: number,
  radial = 10,
): THREE.BufferGeometry {
  const r = Math.max(0.02, ctx.headRadius(y) + extra);
  const geo = new THREE.TorusGeometry(r, tube, radial, 40);
  geo.rotateX(Math.PI / 2);
  geo.scale(1, 1, ctx.zScale);
  return geo;
}

/** 跨过头顶的发箍：沿颅骨正中矢状面的轮廓走，正面能看到完整拱形，不会陷进头里 */
function crownBandGeo(ctx: Acc3DCtx, y0: number, extra: number, tube: number): THREE.BufferGeometry {
  const yTop = 0.466;
  const N = 18;
  // 先取颅骨正中矢状面的轮廓，再沿法线向外推一个管半径 —— 这样箍是「骑」在毛上，不是埋进去
  const spine: Array<[number, number]> = [];
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const y = mix(y0, yTop, t);
    const r = Math.max(0.012, ctx.headRadius(y));
    const dy = 0.006;
    const r1 = Math.max(0.012, ctx.headRadius(y + dy));
    const r0 = Math.max(0.012, ctx.headRadius(y - dy));
    const dr = (r1 - r0) / (2 * dy);
    const nl = Math.hypot(1, dr) || 1;
    const nx = 1 / nl;
    const ny = -dr / nl;
    spine.push([r + (extra + tube * 0.55) * nx, y + (extra + tube * 0.55) * ny]);
  }
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < spine.length; i += 1) {
    const [x, y] = spine[i];
    pts.push([-x, y, 0]);
  }
  // 顶部圆滑过渡
  const top = spine[spine.length - 1];
  pts.push([0, top[1] + 0.012, 0]);
  for (let i = spine.length - 1; i >= 0; i -= 1) {
    const [x, y] = spine[i];
    pts.push([x, y, 0]);
  }
  return taperTube(pts, tube, tube, 54, 8);
}

/** 贴合脸部曲面的片（口罩、腮红） */function facePatch(
  ctx: Acc3DCtx,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  zOff: number,
  segs = 12,
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(1, 1, segs, segs);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const u = p.getX(i) + 0.5;
    const v = p.getY(i) + 0.5;
    const x = mix(x0, x1, u);
    const y = mix(y0, y1, v);
    p.setXYZ(i, x, y, ctx.surfaceZ(x, y) + zOff);
  }
  geo.computeVertexNormals();
  return geo;
}

/** 圆角矩形（背包、书本、垫子都用） */
function roundedBox(w: number, h: number, d: number, r: number, seg = 3): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = geo.attributes.position;
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const hz = d / 2 - r;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 1) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const cx = Math.max(-hx, Math.min(hx, v.x));
    const cy = Math.max(-hy, Math.min(hy, v.y));
    const cz = Math.max(-hz, Math.min(hz, v.z));
    const dir = new THREE.Vector3(v.x - cx, v.y - cy, v.z - cz);
    if (dir.lengthSq() > 1e-8) {
      dir.normalize().multiplyScalar(r);
      p.setXYZ(i, cx + dir.x, cy + dir.y, cz + dir.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function heartShape(s: number): THREE.Shape {
  const sh = new THREE.Shape();
  sh.moveTo(0, -s * 0.55);
  sh.bezierCurveTo(s * 0.55, s * 0.02, s * 0.62, s * 0.62, 0, s * 0.30);
  sh.bezierCurveTo(-s * 0.62, s * 0.62, -s * 0.55, s * 0.02, 0, -s * 0.55);
  return sh;
}



/** 给可动部件打标记并记录初始变换，引擎每帧按种类驱动 */
export type AccAnimKind = 'flap' | 'glide' | 'swing' | 'sway' | 'tip' | 'float' | 'spin';

export function markAnim(
  obj: THREE.Object3D,
  kind: AccAnimKind,
  side = 1,
  amp = 1,
  phase = 0,
): THREE.Object3D {
  obj.userData.anim = { kind, side, amp, phase };
  obj.userData.base = {
    rx: obj.rotation.x,
    ry: obj.rotation.y,
    rz: obj.rotation.z,
    px: obj.position.x,
    py: obj.position.y,
    pz: obj.position.z,
  };
  return obj;
}

// ---------------------------------------------------------------- 细节工具

/** 沿二次贝塞尔采样，用于给帽檐滚边 */
function quadPoints(
  a: [number, number],
  c: [number, number],
  b: [number, number],
  n: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/** 一圈小珠子（缝线 / 铆钉 / 珠链） */
function beadRing(
  radius: number,
  y: number,
  count: number,
  beadR: number,
  mat: THREE.Material,
  zScale = 1,
  from = 0,
  to = Math.PI * 2,
  beadScale: [number, number, number] = [1, 1, 1],
): THREE.Group {
  const grp = new THREE.Group();
  const geo = new THREE.SphereGeometry(beadR, 12, 8);
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    const a = from + (to - from) * t;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(Math.sin(a) * radius, y, Math.cos(a) * radius * zScale);
    m.scale.set(beadScale[0], beadScale[1], beadScale[2]);
    grp.add(m);
  }
  return grp;
}

/** 沿一组点铺一条细管（缝线 / 骨架 / 滚边） */
function seamTube(
  pts: Array<[number, number, number]>,
  r0: number,
  r1: number,
  mat: THREE.Material,
  segs = 16,
  radial = 6,
): THREE.Mesh {
  return new THREE.Mesh(taperTube(pts, r0, r1, segs, radial), mat);
}


// ---------------------------------------------------------------- 精细版：棒球帽 / 毛线帽 / 眼镜 / 项圈 / 天使翅膀


// ---------------------------------------------------------------- 精细版：面部

/** 心形墨镜：带倒角的镜框 + 内嵌镜片 + 镜腿 + 鼻梁 */
function buildHeartGlasses(
  g: THREE.Group,
  ctx: Acc3DCtx,
  frame: THREE.Material,
  c2: string,
  EYE_X: number,
  EYE_Y: number,
  frontZ: (x: number, y: number) => number,
): void {
  const lens = createAccMaterial(c2, { spec: 0.85, opacity: 0.55, rim: 0.5, rough: 0.12 });
  const shine = createAccMaterial('#ffffff', { spec: 1, opacity: 0.5 });
  const ringZ = frontZ(EYE_X, EYE_Y) + 0.058;
  for (const s of [-1, 1] as const) {
    const outer = new THREE.ExtrudeGeometry(heartShape(0.170), {
      depth: 0.026,
      bevelEnabled: true,
      bevelSize: 0.010,
      bevelThickness: 0.008,
      bevelSegments: 3,
      curveSegments: 26,
    });
    g.add(place(make(outer, frame), [s * EYE_X, EYE_Y - 0.012, ringZ]));
    const glass = new THREE.ExtrudeGeometry(heartShape(0.146), { depth: 0.008, bevelEnabled: false, curveSegments: 24 });
    g.add(place(make(glass, lens), [s * EYE_X, EYE_Y - 0.012, ringZ + 0.020]));
    // 高光条
    g.add(place(make(new THREE.PlaneGeometry(0.040, 0.090), shine), [s * EYE_X - 0.052, EYE_Y + 0.018, ringZ + 0.030], [0, 0, -0.5]));
    // 镜腿
    g.add(
      make(
        taperTube(
          [
            [s * (EYE_X + 0.150), EYE_Y + 0.006, ringZ - 0.030],
            [s * (EYE_X + 0.185), EYE_Y + 0.012, ringZ - 0.150],
            [s * (EYE_X + 0.120), EYE_Y + 0.008, 0.010],
          ],
          0.010,
          0.008,
          14,
          6,
        ),
        frame,
      ),
    );
  }
  // 鼻梁
  g.add(
    make(
      taperTube(
        [
          [-EYE_X + 0.130, EYE_Y + 0.012, ringZ + 0.004],
          [0, EYE_Y + 0.040, ringZ + 0.018],
          [EYE_X - 0.130, EYE_Y + 0.012, ringZ + 0.004],
        ],
        0.011,
        0.011,
        14,
        6,
      ),
      frame,
    ),
  );
}

/** 电竞护目镜：镜筒 + 镜片 + 外圈 + 缓冲垫 + 侧通风 + 可调头带 */
function buildGogglesFine(
  g: THREE.Group,
  ctx: Acc3DCtx,
  c1: string,
  c2: string,
  EYE_X: number,
  EYE_Y: number,
  frontZ: (x: number, y: number) => number,
): void {
  const shell = createAccMaterial(c1, { spec: 0.35, rough: 0.45, rim: 0.34 });
  const rubber = createAccMaterial('#2a2d34', { spec: 0.15, rough: 0.8 });
  const glass = createAccMaterial(c2, { spec: 0.9, rough: 0.1, opacity: 0.62, rim: 0.55, glow: 0.06 });
  const metal = createAccMaterial('#b9c2ce', { spec: 0.85, rough: 0.22 });
  const z0 = frontZ(EYE_X, EYE_Y);
  for (const s of [-1, 1] as const) {
    // 镜筒
    const cup = new THREE.CylinderGeometry(0.150, 0.132, 0.090, 30, 1, true);
    cup.rotateX(Math.PI / 2);
    g.add(place(make(cup, shell), [s * EYE_X, EYE_Y, z0 + 0.012]));
    // 镜片（略微外凸）
    const lens = new THREE.SphereGeometry(0.128, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.42);
    lens.rotateX(Math.PI / 2);
    g.add(place(make(lens, glass), [s * EYE_X, EYE_Y, z0 + 0.058], [0, 0, 0], [1, 1, 0.55]));
    // 外圈
    g.add(place(make(new THREE.TorusGeometry(0.150, 0.014, 10, 34), shell), [s * EYE_X, EYE_Y, z0 + 0.056]));
    // 内圈（压住镜片边缘）
    g.add(place(make(new THREE.TorusGeometry(0.132, 0.008, 8, 30), metal), [s * EYE_X, EYE_Y, z0 + 0.050]));
    // 贴脸的缓冲垫
    g.add(place(make(new THREE.TorusGeometry(0.140, 0.020, 10, 30), rubber), [s * EYE_X, EYE_Y, z0 - 0.028]));
    // 侧通风口（三条）
    for (let i = 0; i < 3; i += 1) {
      g.add(place(make(roundedBox(0.010, 0.028, 0.026, 0.004, 1), rubber), [s * (EYE_X + 0.140), EYE_Y - 0.030 + i * 0.026, z0 + 0.010]));
    }
  }
  // 中间鼻桥
  g.add(place(make(roundedBox(0.075, 0.045, 0.055, 0.018, 2), shell), [0, EYE_Y - 0.005, z0 + 0.030]));
  // 头带：绕到脑后 + 调节扣
  const strapR = ctx.headRadius(EYE_Y) + 0.020;
  const strap = new THREE.TorusGeometry(strapR, 0.024, 10, 44, Math.PI * 1.30);
  strap.rotateX(Math.PI / 2);
  strap.rotateY(Math.PI / 2 + Math.PI * 0.35);
  strap.scale(1, 1, ctx.zScale);
  g.add(place(make(strap, rubber), [0, EYE_Y + 0.004, 0]));
  g.add(place(make(roundedBox(0.070, 0.040, 0.030, 0.010, 2), metal), [0, EYE_Y + 0.006, -(strapR * ctx.zScale) - 0.010]));
}

/** 像素墨镜：8-bit 方块镜框 + 深色镜片 + 像素纹理 */
function buildPixelShades(
  g: THREE.Group,
  ctx: Acc3DCtx,
  c1: string,
  EYE_X: number,
  EYE_Y: number,
  frontZ: (x: number, y: number) => number,
): void {
  const frame = createAccMaterial(c1, { spec: 0.3, rough: 0.5 });
  const dark = createAccMaterial('#12141a', { spec: 0.6, rough: 0.2 });
  const hi = createAccMaterial('#ffffff', { spec: 1, opacity: 0.35 });
  const z = frontZ(EYE_X, EYE_Y) + 0.050;
  const cell = 0.030;
  for (const s of [-1, 1] as const) {
    const cx = s * EYE_X;
    // 镜框：3x3 的像素块拼成一个方框
    for (let r = -1; r <= 1; r += 1) {
      for (let c = -1; c <= 1; c += 1) {
        if (r !== 0 && c !== 0) continue; // 只留边
        g.add(place(make(new THREE.BoxGeometry(cell, cell, 0.040), frame), [cx + c * cell * 1.6, EYE_Y + r * cell * 1.2, z]));
      }
    }
    // 镜片：一个 3x2 的深色方块
    g.add(place(make(new THREE.BoxGeometry(cell * 3.2, cell * 2.2, 0.030), dark), [cx, EYE_Y, z + 0.006]));
    // 像素高光
    g.add(place(make(new THREE.BoxGeometry(cell * 0.9, cell * 0.9, 0.004), hi), [cx - cell * 0.8, EYE_Y + cell * 0.5, z + 0.024]));
    // 镜腿
    g.add(place(make(new THREE.BoxGeometry(0.020, 0.022, 0.150), frame), [s * (EYE_X + 0.090), EYE_Y + 0.004, z - 0.090]));
  }
  g.add(place(make(new THREE.BoxGeometry(0.065, 0.022, 0.030), frame), [0, EYE_Y + 0.006, z]));
}

/** 小口罩：弧形布面 + 三道褶 + 鼻梁条 + 耳挂 */
function buildMaskFine(
  g: THREE.Group,
  ctx: Acc3DCtx,
  c1: string,
  c2: string,
  frontZ: (x: number, y: number) => number,
): void {
  const cloth = createAccMaterial(c1, { spec: 0.05, rough: 0.92, rim: 0.3 });
  const edge = createAccMaterial(c2, { spec: 0.12, rough: 0.7 });
  const cord = createAccMaterial('#f2f0ea', { spec: 0.2, rough: 0.7 });
  // 布面：盖住口鼻到下巴
  const patch = facePatch(ctx, -0.40, 0.40, -0.235, 0.145, 0.030, 22);
  g.add(make(patch, cloth));
  // 上沿包边
  g.add(
    seamTube(
      [
        [-0.395, 0.140, frontZ(-0.395, 0.140) + 0.036],
        [0, 0.165, frontZ(0, 0.165) + 0.042],
        [0.395, 0.140, frontZ(0.395, 0.140) + 0.036],
      ],
      0.014,
      0.014,
      edge,
      18,
      6,
    ),
  );
  // 三道褶
  for (const yy of [0.050, -0.045, -0.140]) {
    g.add(
      seamTube(
        [
          [-0.360, yy, frontZ(-0.360, yy) + 0.034],
          [0, yy - 0.012, frontZ(0, yy - 0.012) + 0.040],
          [0.360, yy, frontZ(0.360, yy) + 0.034],
        ],
        0.009,
        0.009,
        edge,
        16,
        5,
      ),
    );
  }
  // 鼻梁条
  g.add(place(make(new THREE.CapsuleGeometry(0.009, 0.18, 4, 8), edge), [0, 0.118, frontZ(0, 0.118) + 0.046], [0, 0, Math.PI / 2]));
  // 耳挂
  for (const s of [-1, 1] as const) {
    g.add(
      make(
        taperTube(
          [
            [s * 0.395, 0.130, frontZ(s * 0.395, 0.130) + 0.030],
            [s * 0.475, 0.090, 0.16],
            [s * 0.430, -0.030, -0.06],
          ],
          0.008,
          0.007,
          16,
          4,
        ),
        cord,
      ),
    );
  }
}

/** 单眼眼罩：皮质眼罩 + 缝线 + 系带 + 小徽记 */
function buildEyePatchFine(
  g: THREE.Group,
  ctx: Acc3DCtx,
  c1: string,
  c2: string,
  EYE_X: number,
  EYE_Y: number,
  frontZ: (x: number, y: number) => number,
): void {
  const leather = createAccMaterial(c1, { spec: 0.35, rough: 0.45, rim: 0.3 });
  const stitch = createAccMaterial(c2, { spec: 0.1, rough: 0.8 });
  const cord = createAccMaterial('#2a2622', { spec: 0.2, rough: 0.7 });
  const s = 1;
  const cx = s * EYE_X;
  const cz = frontZ(cx, EYE_Y) + 0.026;
  // 眼罩本体（椭圆薄片，贴合面部）
  const patch = new THREE.SphereGeometry(0.135, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.55);
  patch.rotateX(Math.PI / 2);
  g.add(place(make(patch, leather), [cx, EYE_Y, cz], [0, 0, 0], [1.0, 1.12, 0.42]));
  // 缝线一圈
  for (let i = 0; i < 22; i += 1) {
    const a = (i / 22) * Math.PI * 2;
    g.add(
      place(
        make(new THREE.SphereGeometry(0.0065, 8, 6), stitch),
        [cx + Math.cos(a) * 0.118, EYE_Y + Math.sin(a) * 0.130, cz + 0.026],
      ),
    );
  }
  // 中间的小星星
  g.add(place(make(new THREE.OctahedronGeometry(0.030, 0), stitch), [cx, EYE_Y + 0.006, cz + 0.048], [0, 0, 0], [1, 1.2, 0.4]));
  // 系带：向后绕到脑后
  for (const dir of [-1, 1] as const) {
    g.add(
      make(
        taperTube(
          [
            [cx + dir * 0.120, EYE_Y + 0.020, cz - 0.010],
            [dir * 0.34, EYE_Y + 0.070, 0.06],
            [dir * 0.30, EYE_Y + 0.090, -0.28],
          ],
          0.009,
          0.008,
          18,
          5,
        ),
        cord,
      ),
    );
  }
}

/** 精细棒球帽：分片帽冠 + 六道缝 + 顶扣 + 带滚边和缝线的帽檐 + 内汗带 */

/** 肩披：开口的伞形布面，下摆带波浪 */
function capeletGeo(
  yTop: number,
  yBot: number,
  rTop: number,
  rBot: number,
  gapDeg: number,
  zScale: number,
  waves = 6,
): THREE.BufferGeometry {
  const gap = (gapDeg * Math.PI) / 180;
  const an = 56;
  const tn = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= an; i += 1) {
    const a = gap / 2 + (i / an) * (Math.PI * 2 - gap);
    for (let j = 0; j <= tn; j += 1) {
      const t = j / tn;
      const wav = Math.sin(a * waves) * 0.045 * t * t;
      const r = mix(rTop, rBot, t) + wav;
      const y = mix(yTop, yBot, t) + Math.sin(a * waves + 0.6) * 0.018 * t * t;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r * zScale);
    }
  }
  for (let i = 0; i < an; i += 1) {
    for (let j = 0; j < tn; j += 1) {
      const a0 = i * (tn + 1) + j;
      const a1 = a0 + 1;
      const b0 = (i + 1) * (tn + 1) + j;
      const b1 = b0 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}


/** 水手帽：白色帽冠 + 蓝帽墙 + 金徽 + 黑色帽檐 */
function buildSailorFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const white = createAccMaterial('#f2f4f2', { spec: 0.12, rough: 0.8, rim: 0.4 });
  const navy = createAccMaterial(c2, { spec: 0.16, rough: 0.66 });
  const gold = createAccMaterial('#d8b45a', { spec: 0.9, rough: 0.2 });
  const black = createAccMaterial('#1c1f26', { spec: 0.5, rough: 0.3 });
  const y0 = 0.286;
  const R = ctx.headRadius(y0) + 0.044;
  // 帽冠：扁圆顶
  g.add(make(crownGeo(ctx, R, y0, 0.060, 0.105, 0.94, 56), white));
  // 蓝帽墙
  const wall = new THREE.CylinderGeometry(R * 1.005, R * 1.005, 0.056, 56, 1, true);
  wall.scale(1, 1, ctx.zScale);
  g.add(place(make(wall, navy), [0, y0 + 0.016, 0]));
  // 金徽
  g.add(place(make(new THREE.TorusGeometry(0.040, 0.008, 10, 24), gold), [0, y0 + 0.016, R * ctx.zScale * 0.995], [0, 0, 0], [1, 1.2, 1]));
  g.add(place(make(new THREE.SphereGeometry(0.020, 14, 10), gold), [0, y0 + 0.016, R * ctx.zScale * 0.995], [0, 0, 0], [1, 1.3, 0.6]));
  // 黑色帽檐
  const brimShape = new THREE.Shape();
  const BR = R * 0.96;
  brimShape.moveTo(-BR * 0.66, 0);
  brimShape.quadraticCurveTo(-BR * 0.60, 0.30, 0, 0.36);
  brimShape.quadraticCurveTo(BR * 0.60, 0.30, BR * 0.66, 0);
  brimShape.lineTo(-BR * 0.66, 0);
  const brimGeo = new THREE.ExtrudeGeometry(brimShape, { depth: 0.020, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.005, bevelSegments: 2, curveSegments: 30 });
  brimGeo.rotateX(Math.PI / 2);
  g.add(place(make(brimGeo, black), [0, y0 + 0.006, ctx.surfaceZ(0, y0) * 0.50], [0.20, 0, 0], [1, 1, 1.02]));
  // 帽口内衬
  g.add(place(make(headRing(ctx, y0 + 0.002, 0.030, 0.016, 18), black), [0, 0, 0]));
}

/** 兔耳发箍：细发箍 + 两只长耳（内耳粉色） */
function buildBunnyFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const fur = createAccMaterial('#f6f2ea', { spec: 0.05, rough: 0.92, rim: 0.4 });
  const pink = createAccMaterial('#e8a8b4', { spec: 0.06, rough: 0.86 });
  const bandMat = createAccMaterial(c1, { spec: 0.2, rough: 0.6 });
  const Z = ctx.zScale;
  // 发箍
  const band = headRing(ctx, 0.300, 0.024, 0.022, 14);
  g.add(make(band, bandMat));
  // 两只长耳
  for (const s2 of [-1, 1] as const) {
    const ear = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.30, 8, 18), fur);
    shell.scale.set(1, 1, 0.62);
    ear.add(shell);
    const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.24, 6, 14), pink);
    inner.position.set(0, 0.006, 0.035);
    inner.scale.set(1, 1, 0.42);
    ear.add(inner);
    ear.position.set(s2 * 0.15, 0.50, -0.02);
    ear.rotation.z = s2 * 0.16;
    ear.rotation.x = -0.12;
    markAnim(ear, 'tip', s2, 0.7, s2 > 0 ? 0.4 : 0);
    g.add(ear);
  }
}

/** 牛仔帽：宽卷边 + 高冠（顶部压出凹槽）+ 皮帽带 */
function buildCowboyFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const felt = createAccMaterial(c1, { spec: 0.08, rough: 0.9, rim: 0.34 });
  const leather = createAccMaterial('#6b4a32', { spec: 0.35, rough: 0.45 });
  const Z = ctx.zScale;
  const y0 = 0.300;
  // 帽檐：两侧上卷
  const brimPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    brimPts.push(new THREE.Vector2(0.36 + t * 0.52, 0.055 * Math.pow(t, 2.4) - 0.012));
  }
  const brim = new THREE.LatheGeometry(brimPts, 56);
  brim.scale(1, 1, Z * 1.08);
  g.add(place(make(brim, felt), [0, y0, 0]));
  const rim = new THREE.TorusGeometry(0.875, 0.018, 10, 56);
  rim.rotateX(Math.PI / 2);
  rim.scale(1, 1, Z * 1.08);
  g.add(place(make(rim, felt), [0, y0 + 0.043, 0]));
  // 帽冠：上窄下宽的梯形，顶部略压扁
  const crown = new THREE.CylinderGeometry(0.30, 0.44, 0.34, 44, 4, false);
  crown.scale(1, 1, Z);
  const crownMesh = make(crown, felt);
  place(crownMesh, [0, y0 + 0.17, 0]);
  g.add(crownMesh);
  // 顶部凹槽：两侧压出两个凹陷的小球
  const dentMat = createAccMaterial(c1, { spec: 0.05, rough: 0.95 });
  for (const s2 of [-1, 1] as const) {
    g.add(place(make(new THREE.SphereGeometry(0.115, 16, 12), dentMat), [s2 * 0.20, y0 + 0.335, 0], [0, 0, 0], [1, 0.45, 1.5]));
  }
  g.add(place(make(new THREE.SphereGeometry(0.30, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), felt), [0, y0 + 0.34, 0], [0, 0, 0], [1, 0.24, 1]));
  // 皮帽带 + 扣
  g.add(place(make(new THREE.TorusGeometry(0.445, 0.024, 10, 48), leather), [0, y0 + 0.060, 0], [Math.PI / 2, 0, 0], [1, 1, Z]));
  g.add(place(make(roundedBox(0.070, 0.055, 0.024, 0.010, 2), createAccMaterial('#c8a24a', { spec: 0.85, rough: 0.25 })), [0, y0 + 0.060, 0.450]));
}

/** 卫衣兜帽：纯色兜帽 + 抽绳（和青蛙头套区分开） */
function buildHoodieFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const cloth = createAccMaterial(c1, { spec: 0.07, rough: 0.93, rim: 0.32 });
  const cord = createAccMaterial(c2, { spec: 0.12, rough: 0.8 });
  const Z = ctx.zScale;
  g.add(make(headShell(ctx, 0.130, 0.045, { y1: 0.412, dome: 0.115, segs: 34 }), cloth));
  const roll = new THREE.TorusGeometry(ctx.headRadius(0.130) + 0.048, 0.036, 12, 48);
  roll.rotateX(Math.PI / 2);
  roll.scale(1, 1, Z);
  g.add(place(make(roll, cloth), [0, 0.145, 0.010]));
  // 抽绳 + 绳头
  for (const s2 of [-1, 1] as const) {
    g.add(
      make(
        taperTube(
          [
            [s2 * 0.075, 0.150, 0.330],
            [s2 * 0.095, 0.070, 0.360],
            [s2 * 0.080, -0.010, 0.365],
          ],
          0.010,
          0.008,
          14,
          5,
        ),
        cord,
      ),
    );
    g.add(place(make(new THREE.CylinderGeometry(0.016, 0.018, 0.036, 10), cord), [s2 * 0.080, -0.028, 0.365]));
  }
  // 后脑的兜帽折线
  g.add(beadRing(ctx.headRadius(0.150) + 0.060, 0.170, 40, 0.0055, cloth, Z));
}

/**
 * 帽冠：帽箍 + 直立冠身 + 圆顶。
 * 之前的 headShell 是「贴着颅骨的一层皮」，所以帽子看起来像涂在头上；
 * 真正的帽子要在头顶上方撑出体积。
 */
function crownGeo(
  ctx: Acc3DCtx,
  radius: number,
  y0: number,
  wall: number,
  domeH: number,
  taper = 0.92,
  radial = 60,
): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(radius * 1.01, y0)];
  const wallSeg = 6;
  for (let i = 1; i <= wallSeg; i += 1) {
    const t = i / wallSeg;
    pts.push(new THREE.Vector2(radius * (1 - (1 - taper) * t), y0 + wall * t));
  }
  const domeSeg = 12;
  const rTop = radius * taper;
  for (let i = 1; i <= domeSeg; i += 1) {
    const t = i / domeSeg;
    const r = rTop * Math.cos((t * Math.PI) / 2);
    const y = y0 + wall + domeH * Math.sin((t * Math.PI) / 2);
    pts.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const geo = new THREE.LatheGeometry(pts, radial);
  geo.scale(1, 1, ctx.zScale);
  return geo;
}


/** 睡帽：翻边 + 竖罗纹 + 长长的软垂尾 + 毛球 */
function buildNightcapFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const cloth = createAccMaterial(c1, { spec: 0.05, rough: 0.96, rim: 0.34 });
  const trim = createAccMaterial(c2, { spec: 0.12, rough: 0.75 });
  const stitch = createAccMaterial('#f6ecd8', { spec: 0.05, rough: 0.9 });
  const Z = ctx.zScale;

  // 帽体：从帽箍往上收，收到 0.2 半径后拐成垂尾
  const pts: THREE.Vector2[] = [];
  const y0 = 0.244;
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    const y = y0 + t * 0.26;
    const r = mix(ctx.headRadius(y0) + 0.035, 0.16, Math.pow(t, 0.85));
    pts.push(new THREE.Vector2(Math.max(0.02, r), y));
  }
  const body = new THREE.LatheGeometry(pts, 48);
  body.scale(1, 1, Z);
  g.add(make(body, cloth));

  // 竖罗纹
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    const line: Array<[number, number, number]> = [];
    for (let k = 0; k <= 5; k += 1) {
      const t = k / 5;
      const y = y0 + t * 0.255;
      const r = mix(ctx.headRadius(y0) + 0.040, 0.175, Math.pow(t, 0.85));
      line.push([Math.sin(a) * r, y, Math.cos(a) * r * Z]);
    }
    g.add(seamTube(line, 0.0075, 0.0045, cloth, 12, 5));
  }

  // 翻边（厚）
  g.add(make(headRing(ctx, y0 + 0.014, 0.034, 0.042, 20), cloth));
  g.add(beadRing(ctx.headRadius(y0) + 0.070, y0 + 0.004, 46, 0.0055, stitch, Z));
  g.add(beadRing(ctx.headRadius(y0) + 0.070, y0 + 0.030, 46, 0.0055, stitch, Z));

  // 垂尾：先向后上挑，再垂到侧面
  const tailGrp = new THREE.Group();
  tailGrp.position.set(0, y0 + 0.255, 0);
  const tail = taperTube(
    [
      [0, 0, 0],
      [0.07, 0.080, -0.03],
      [0.22, 0.030, -0.02],
      [0.36, -0.12, 0.03],
      [0.42, -0.30, 0.08],
    ],
    0.155,
    0.045,
    26,
    12,
  );
  tailGrp.add(make(tail, cloth));
  // 尾端毛球
  const pom = new THREE.Group();
  for (const [dx, dy, dz, r] of [[0, 0, 0, 0.072], [0.045, 0.02, 0.02, 0.046], [-0.04, -0.01, 0.03, 0.044], [0.01, -0.03, -0.04, 0.042]] as const) {
    pom.add(place(make(new THREE.SphereGeometry(r, 16, 12), trim), [dx, dy, dz]));
  }
  place(pom, [0.430, -0.365, 0.09]);
  tailGrp.add(pom);
  markAnim(tailGrp, 'tip', 1, 0.9, 0);
  g.add(tailGrp);
}

/** 女巫帽：宽帽檐 + 尖锥 + 弯尖 + 缎带扣 */
function buildWitchHatFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const felt = createAccMaterial(c1, { spec: 0.06, rough: 0.95, rim: 0.34 });
  const ribbon = createAccMaterial(c2, { spec: 0.3, rough: 0.45 });
  const metal = createAccMaterial('#d8b45a', { spec: 0.9, rough: 0.2 });
  const Z = ctx.zScale;
  const y0 = 0.300;

  // 帽檐：中间厚、边缘薄的浅锥盘
  const brimPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i += 1) {
    const t = i / 10;
    brimPts.push(new THREE.Vector2(0.40 + t * 0.48, -0.018 * t * t));
  }
  const brim = new THREE.LatheGeometry(brimPts, 56);
  brim.scale(1, 1, Z);
  g.add(place(make(brim, felt), [0, y0, 0]));
  // 檐边加厚
  const rimGeo = new THREE.TorusGeometry(0.88, 0.020, 10, 56);
  rimGeo.rotateX(Math.PI / 2);
  rimGeo.scale(1, 1, Z);
  g.add(place(make(rimGeo, felt), [0, y0 - 0.018, 0]));

  // 锥身：下粗上细，最后一段弯向一侧
  const coneGrp = new THREE.Group();
  coneGrp.position.set(0, y0, 0);
  const coneGeo = new THREE.ConeGeometry(0.46, 0.70, 40, 1, true);
  coneGrp.add(place(make(coneGeo, felt), [0, 0.35, 0]));
  // 弯尖
  const tip = taperTube(
    [
      [0, 0.68, 0],
      [0.02, 0.78, 0],
      [0.10, 0.85, 0.01],
      [0.19, 0.84, 0.02],
    ],
    0.085,
    0.018,
    20,
    10,
  );
  coneGrp.add(make(tip, felt));
  markAnim(coneGrp, 'tip', 1, 1.1, 0.3);
  g.add(coneGrp);

  // 缎带 + 方形扣
  g.add(place(make(new THREE.TorusGeometry(0.465, 0.030, 12, 48), ribbon), [0, y0 + 0.030, 0], [Math.PI / 2, 0, 0], [1, 1, Z]));
  g.add(place(make(roundedBox(0.085, 0.065, 0.030, 0.012, 2), metal), [0, y0 + 0.030, 0.468], [0, 0, 0]));
  g.add(place(make(roundedBox(0.048, 0.034, 0.014, 0.006, 1), createAccMaterial('#2a2a30', { spec: 0.2 })), [0, y0 + 0.030, 0.486]));
}

/** 派对尖帽：锥体 + 斜条纹 + 顶球 + 系带 */
function buildPartyHatFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const paper = createAccMaterial(c1, { spec: 0.42, rough: 0.35, rim: 0.4 });
  const stripe = createAccMaterial(c2, { spec: 0.5, rough: 0.3 });
  const Z = ctx.zScale;
  const y0 = 0.300;
  const H = 0.60;
  const baseR = 0.375;

  const cone = new THREE.ConeGeometry(baseR, H, 40, 1, true);
  const coneGrp = new THREE.Group();
  coneGrp.position.set(0, y0, 0);
  coneGrp.add(place(make(cone, paper), [0, H * 0.5, 0]));
  // 斜条纹：沿锥面绕三圈的细管
  for (let k = 0; k < 4; k += 1) {
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i <= 30; i += 1) {
      const t = i / 30;
      const a = t * Math.PI * 2.2 + k * 2.1;
      const h = 0.06 + t * (H - 0.14);
      const r = baseR * (1 - h / H) * 1.012;
      pts.push([Math.sin(a) * r, h, Math.cos(a) * r]);
    }
    coneGrp.add(seamTube(pts, 0.0085, 0.0085, stripe, 36, 5));
  }
  markAnim(coneGrp, 'tip', 1, 1.0, 0.5);
  g.add(coneGrp);

  // 顶球
  g.add(place(make(new THREE.SphereGeometry(0.052, 18, 14), stripe), [0, y0 + H + 0.02, 0]));
  // 帽箍
  g.add(place(make(new THREE.TorusGeometry(baseR + 0.004, 0.020, 10, 44), stripe), [0, y0 + 0.014, 0], [Math.PI / 2, 0, 0], [1, 1, Z]));
  // 系带（从帽箍两侧垂到下巴）
  for (const s2 of [-1, 1] as const) {
    g.add(
      make(
        taperTube(
          [
            [s2 * (baseR - 0.02), y0 + 0.01, 0.06],
            [s2 * 0.34, y0 - 0.16, 0.16],
            [s2 * 0.18, y0 - 0.30, 0.20],
          ],
          0.007,
          0.006,
          14,
          4,
        ),
        stripe,
      ),
    );
  }
}

/**
 * 弧形遮阳板：沿前额绕一圈再向前伸出，而不是一块平板。
 * 返回的是上下两层 + 外沿滚边的组合，看起来有厚度。
 */
function visorGeo(ctx: Acc3DCtx, y0: number, len: number, arcDeg: number, droop: number): THREE.BufferGeometry {
  const R = ctx.headRadius(y0) + 0.018;
  const arc = (arcDeg * Math.PI) / 180;
  const an = 30;
  const tn = 5;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= an; i += 1) {
    const a = -arc / 2 + (i / an) * arc;
    for (let j = 0; j <= tn; j += 1) {
      const t = j / tn;
      const r = R + t * len;
      const y = y0 - t * droop - Math.pow(Math.abs(a) / (arc / 2), 2) * 0.02;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r * 1.0);
    }
  }
  for (let i = 0; i < an; i += 1) {
    for (let j = 0; j < tn; j += 1) {
      const a0 = i * (tn + 1) + j;
      const a1 = a0 + 1;
      const b0 = (i + 1) * (tn + 1) + j;
      const b1 = b0 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 精细棒球帽：圆顶帽冠（六道缝 + 顶扣 + 透气孔 + 徽章）+ 弧形遮阳板 */
function buildCapFine(
  g: THREE.Group,
  ctx: Acc3DCtx,
  main: THREE.Material,
  trim: THREE.Material,
  soft: THREE.Material,
): void {
  void soft;
  const dark = createAccMaterial('#1a2436', { spec: 0.05, rough: 0.95 });
  const RIM_Y = 0.284;

  // 帽冠：贴合头顶的圆顶
  const CROWN_R = ctx.headRadius(RIM_Y) + 0.040;
  g.add(make(crownGeo(ctx, CROWN_R, RIM_Y - 0.010, 0.150, 0.170, 0.82), main));

  // 顶扣 + 扣座
  g.add(place(make(new THREE.CylinderGeometry(0.027, 0.027, 0.007, 24), trim), [0, 0.602, 0], [0.06, 0, 0]));
  g.add(place(make(new THREE.TorusGeometry(0.028, 0.0045, 8, 24), trim), [0, 0.600, 0], [Math.PI / 2, 0, 0]));

  // 六道缝：沿着帽冠收到顶扣
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const pts: Array<[number, number, number]> = [];
    for (let k = 0; k <= 6; k += 1) {
      const t = k / 6;
      const y = mix(RIM_Y + 0.006, 0.596, t);
      const rr = Math.max(0.012, (CROWN_R - 0.006) * Math.cos(t * Math.PI * 0.47));
      pts.push([Math.sin(a) * rr, y, Math.cos(a) * rr * ctx.zScale]);
    }
    g.add(seamTube(pts, 0.0068, 0.0042, dark, 18, 5));
  }

  // 透气孔：左右各两个
  const eyeletMat = createAccMaterial('#16202f', { spec: 0.1, rough: 0.8 });
  const eyeletRing = createAccMaterial('#c9d2e0', { spec: 0.7, rough: 0.25 });
  for (const a of [Math.PI * 0.34, -Math.PI * 0.34]) {
    for (const yy of [0.378, 0.414]) {
      const rr = CROWN_R - 0.006;
      const x = Math.sin(a) * rr;
      const z = Math.cos(a) * rr * ctx.zScale;
      g.add(place(make(new THREE.CircleGeometry(0.011, 14), eyeletMat), [x, yy, z], [0, a, 0]));
      g.add(place(make(new THREE.TorusGeometry(0.014, 0.0035, 8, 18), eyeletRing), [x, yy, z], [0, a, 0]));
    }
  }

  // 前片徽章
  const badge = new THREE.Group();
  badge.add(make(roundedBox(0.120, 0.078, 0.008, 0.018, 3), createAccMaterial('#f2c14a', { spec: 0.35, rough: 0.45 })));
  const badgeRim = make(new THREE.TorusGeometry(0.042, 0.0045, 8, 28), trim);
  place(badgeRim, [0, 0, 0.005], [0, 0, 0], [1.3, 0.84, 1]);
  badge.add(badgeRim);
  for (const [bx, by, br] of [[-0.022, 0.004, 0.010], [0.004, 0.010, 0.012], [0.028, 0.002, 0.009]] as const) {
    badge.add(place(make(new THREE.SphereGeometry(br, 10, 8), trim), [bx, by, 0.007]));
  }
  place(badge, [0, 0.368, CROWN_R - 0.006], [-0.04, 0, 0]);
  g.add(badge);

  // 帽檐：贴合前额的弧形板，只向前伸一小段
  const R = ctx.headRadius(0.302) + 0.020;
  const brimLen = 0.34;
  const shape = new THREE.Shape();
  shape.moveTo(-R * 0.62, 0);
  shape.quadraticCurveTo(-R * 0.52, brimLen * 0.80, 0, brimLen);
  shape.quadraticCurveTo(R * 0.52, brimLen * 0.80, R * 0.62, 0);
  shape.lineTo(-R * 0.62, 0);
  const brimGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.024,
    bevelEnabled: true,
    bevelSize: 0.008,
    bevelThickness: 0.007,
    bevelSegments: 3,
    curveSegments: 34,
  });
  brimGeo.rotateX(Math.PI / 2);
  brimGeo.translate(0, -0.012, 0);
  const brim = make(brimGeo, trim);
  place(brim, [0, 0.318, ctx.surfaceZ(0, 0.302) * 0.56], [0.34, 0, 0], [1, 1, 1.06]);
  g.add(brim);

  // 帽檐下的深色衬里
  const under = make(brimGeo.clone(), dark);
  place(under, [0, 0.300, ctx.surfaceZ(0, 0.302) * 0.56], [0.34, 0, 0], [0.97, 1, 1.0]);
  g.add(under);

  // 檐口缝线：贴着帽檐外沿的一排小针脚（按同一套贝塞尔曲线取样）
  const edgePts: Array<[number, number]> = [];
  for (let i = 0; i <= 20; i += 1) {
    const t = i / 20;
    const u = 1 - t;
    const px = u * u * (-R * 0.62) + 2 * u * t * (-R * 0.52) + t * t * 0;
    const py = u * u * 0 + 2 * u * t * (brimLen * 0.80) + t * t * brimLen;
    edgePts.push([px, py]);
  }
  for (let i = 20; i >= 0; i -= 1) {
    const t = i / 20;
    const u = 1 - t;
    const px = u * u * 0 + 2 * u * t * (R * 0.52) + t * t * (R * 0.62);
    const py = u * u * brimLen + 2 * u * t * (brimLen * 0.80) + t * t * 0;
    edgePts.push([px, py]);
  }
  for (let i = 0; i < edgePts.length; i += 2) {
    const [px, pz] = edgePts[i];
    const y = 0.318 + pz * Math.sin(0.34) - 0.016;
    const z = ctx.surfaceZ(0, 0.302) * 0.56 + pz * Math.cos(0.34);
    g.add(place(make(new THREE.SphereGeometry(0.0072, 10, 8), dark), [px, y, z]));
  }

  // 后部调节带 + 金属扣（参考图里的后扣）
  const strapMat = createAccMaterial('#2a3550', { spec: 0.3, rough: 0.5 });
  g.add(place(make(roundedBox(0.16, 0.036, 0.020, 0.008, 2), strapMat), [0, RIM_Y + 0.004, -(CROWN_R - 0.004) * ctx.zScale], [0, 0, 0]));
  g.add(place(make(new THREE.TorusGeometry(0.022, 0.006, 8, 16), createAccMaterial('#c9b06a', { spec: 0.85, rough: 0.2 })), [0.055, RIM_Y + 0.004, -(CROWN_R - 0.010) * ctx.zScale], [0, Math.PI / 2, 0]));

  // 帽口内衬 + 帽边
  g.add(place(make(headRing(ctx, RIM_Y + 0.006, 0.026, 0.018, 18), dark), [0, 0, 0]));
  g.add(make(headRing(ctx, RIM_Y + 0.018, 0.040, 0.011, 18), trim));
}

function buildBeanieFine(
  g: THREE.Group,
  ctx: Acc3DCtx,
  main: THREE.Material,
  trim: THREE.Material,
  soft: THREE.Material,
): void {
  const dark = createAccMaterial('#8fa4bd', { spec: 0.03, rough: 0.98 });
  g.add(make(headShell(ctx, 0.218, 0.028, { y1: 0.432, dome: 0.165, segs: 32 }), soft));

  // 24 条竖向织纹
  for (let i = 0; i < 32; i += 1) {
    const a = (i / 32) * Math.PI * 2;
    const pts: Array<[number, number, number]> = [];
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      const y = mix(0.222, 0.505, t);
      const r = (ctx.headRadius(y) + 0.060) * (1 - 0.02 * t);
      pts.push([Math.sin(a) * r, y, Math.cos(a) * r * ctx.zScale]);
    }
    g.add(seamTube(pts, 0.0085, 0.0065, main, 10, 5));
  }

  // 翻边上的双圈缝线
  for (const dy of [0.020, -0.018]) {
    g.add(beadRing(ctx.headRadius(0.232) + 0.082, 0.232 + dy, 40, 0.0055, dark, ctx.zScale));
  }

  // 侧边织标（小布片 + 描边）
  const label = new THREE.Group();
  label.add(make(roundedBox(0.072, 0.040, 0.010, 0.010, 2), createAccMaterial('#e8eef6', { spec: 0.2, rough: 0.6 })));
  label.add(place(make(new THREE.TorusGeometry(0.026, 0.0045, 8, 18), dark), [0, 0, 0.006], [0, 0, 0], [1.3, 0.72, 1]));
  place(label, [0.27, 0.300, 0.22], [0.1, 0.7, 0]);
  g.add(label);

  // 双层翻边
  g.add(make(headRing(ctx, 0.232, 0.030, 0.050, 20), main));
  g.add(make(headRing(ctx, 0.250, 0.026, 0.018, 16), dark));
  g.add(make(headRing(ctx, 0.222, -0.006, 0.028, 16), dark));

  // 毛球：一簇小球堆出来，比单个球更像毛线球
  const puff = new THREE.Group();
  const puffs: Array<[number, number, number, number]> = [
    [0, 0, 0, 0.072],
    [0.045, -0.012, 0.020, 0.048],
    [-0.040, -0.010, 0.026, 0.046],
    [0.010, -0.016, -0.048, 0.045],
    [-0.014, 0.034, -0.012, 0.042],
    [0.028, 0.030, 0.030, 0.038],
  ];
  const more: Array<[number, number, number, number]> = [
    [0.052, 0.010, -0.026, 0.034], [-0.050, 0.006, -0.030, 0.033],
    [0.004, -0.038, 0.010, 0.032], [-0.024, 0.038, 0.026, 0.030],
  ];
  for (const [x, y, z, r] of [...puffs, ...more]) {
    puff.add(place(make(new THREE.SphereGeometry(r, 16, 12), trim), [x, y, z]));
  }
  g.add(place(puff, [0, 0.612, 0]));
}

/** 精细圆框眼镜：双层框 + 鼻托 + 铰链 + 折弯镜腿 + 镜片高光 */
function buildGlassesFine(
  g: THREE.Group,
  ctx: Acc3DCtx,
  main: THREE.Material,
  c2: string,
  lens: THREE.Material,
): void {
  const EYE_Y = 0.140;
  const EYE_X = 0.215;
  const frontZ = (x: number, y: number) => ctx.surfaceZ(x, y);
  const ringZ = frontZ(EYE_X, EYE_Y) + 0.075;
  const dark = createAccMaterial('#241f1c', { spec: 0.3, rough: 0.35 });
  const shine = createAccMaterial('#ffffff', { spec: 0.9, opacity: 0.5, rim: 0.6 });

  for (const s of [-1, 1] as const) {
    // 镜框（外框 + 内圈细线）
    const ring = make(new THREE.TorusGeometry(0.116, 0.0078, 14, 52), main);
    place(ring, [s * EYE_X, EYE_Y, ringZ], [0, 0, 0], [1.0, 1.06, 1]);
    g.add(ring);
    const inner = make(new THREE.TorusGeometry(0.104, 0.0026, 10, 44), dark);
    place(inner, [s * EYE_X, EYE_Y, ringZ + 0.005], [0, 0, 0], [1.0, 1.06, 1]);
    g.add(inner);

    // 镜片 + 斜向高光条
    const glass = make(new THREE.CircleGeometry(0.112, 44), createAccMaterial(c2, { spec: 0.7, opacity: 0.15, rim: 0.35, rough: 0.15 }));
    place(glass, [s * EYE_X, EYE_Y, ringZ - 0.004], [0, 0, 0], [1.0, 1.06, 1]);
    g.add(glass);
    const streak = make(new THREE.PlaneGeometry(0.030, 0.100), shine);
    place(streak, [s * EYE_X - 0.042, EYE_Y + 0.024, ringZ - 0.002], [0, 0, -0.55], [1, 1, 1]);
    g.add(streak);

    // 镜片外圈细刻纹
    const engrave = make(new THREE.TorusGeometry(0.110, 0.0018, 8, 40), createAccMaterial('#e6dccf', { spec: 0.6, rough: 0.3 }));
    place(engrave, [s * EYE_X, EYE_Y, ringZ + 0.004], [0, 0, 0], [1.0, 1.06, 1]);
    g.add(engrave);

    // 铰链块
    const hinge = make(roundedBox(0.024, 0.030, 0.024, 0.007, 2), dark);
    place(hinge, [s * (EYE_X + 0.124), EYE_Y + 0.010, ringZ - 0.012]);
    g.add(hinge);
    // 铰链螺丝
    g.add(
      place(
        make(new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 10), createAccMaterial('#f0e7da', { spec: 0.8, rough: 0.2 })),
        [s * (EYE_X + 0.132), EYE_Y + 0.012, ringZ + 0.003],
        [Math.PI / 2, 0, 0],
      ),
    );

    // 镜腿：两段折弯 + 末端耳勾
    const temple = taperTube(
      [
        [s * (EYE_X + 0.128), EYE_Y + 0.012, ringZ - 0.020],
        [s * (EYE_X + 0.170), EYE_Y + 0.026, ringZ - 0.150],
        [s * (EYE_X + 0.118), EYE_Y + 0.028, 0.010],
        [s * (EYE_X + 0.084), EYE_Y - 0.022, -0.070],
      ],
      0.0125,
      0.0095,
      16,
      7,
    );
    g.add(make(temple, main));
    g.add(
      place(
        make(new THREE.CapsuleGeometry(0.0105, 0.030, 6, 10), dark),
        [s * (EYE_X + 0.084), EYE_Y - 0.036, -0.078],
        [0.7, 0, 0],
      ),
    );
  }

  // 鼻托（两片透明小垫 + 支撑臂）
  for (const s of [-1, 1] as const) {
    g.add(
      make(
        taperTube(
          [
            [s * 0.052, EYE_Y + 0.010, ringZ - 0.004],
            [s * 0.038, EYE_Y - 0.045, ringZ - 0.030],
          ],
          0.0062,
          0.0055,
          8,
          5,
        ),
        dark,
      ),
    );
    const pad = make(new THREE.SphereGeometry(0.010, 14, 10), createAccMaterial(c2, { spec: 0.4, rough: 0.3 }));
    g.add(place(pad, [s * 0.034, EYE_Y - 0.052, ringZ - 0.034], [0, 0, 0], [1, 1.5, 0.5]));
  }

  // 鼻梁
  g.add(
    make(
      taperTube(
        [
          [-EYE_X + 0.106, EYE_Y + 0.016, ringZ - 0.006],
          [0, EYE_Y + 0.040, ringZ + 0.010],
          [EYE_X - 0.106, EYE_Y + 0.016, ringZ - 0.006],
        ],
        0.0092,
        0.0092,
        14,
        7,
      ),
      main,
    ),
  );
}

/** 精细铃铛项圈：皮圈 + 双侧缝线 + 金属扣 + 挂环 + 带开口的铃铛 */
function buildCollarFine(
  g: THREE.Group,
  ctx: Acc3DCtx,
  c1: string,
  c2: string,
): void {
  const R = ctx.collarR;
  const Z = ctx.zScale;
  const band = createAccMaterial(c1, { spec: 0.22, rough: 0.42 });
  const stitch = createAccMaterial('#f2e6d0', { spec: 0.05, rough: 0.9 });
  const metal = createAccMaterial('#d9b23c', { spec: 0.85, rough: 0.22 });

  // 皮圈本体（18 段环向 + 48 细分）
  const geo = new THREE.TorusGeometry(R + 0.018, 0.052, 20, 64);
  geo.rotateX(Math.PI / 2);
  geo.scale(1, 1, Z);
  g.add(make(geo, band));

  // 上下两道缝线（细珠）+ 中间一道更细的压线
  for (const dy of [0.030, -0.030]) {
    g.add(beadRing(R + 0.018, dy, 44, 0.0062, stitch, Z, 0, Math.PI * 2, [1, 0.8, 1]));
  }
  g.add(beadRing(R + 0.018, 0, 48, 0.0036, stitch, Z, 0, Math.PI * 2, [1, 0.7, 1]));

  // 侧边 D 形环
  const dring = new THREE.Group();
  dring.add(place(make(new THREE.TorusGeometry(0.030, 0.0065, 10, 20, Math.PI * 1.4), metal), [0, 0, 0], [0, Math.PI / 2, 0]));
  dring.add(place(make(roundedBox(0.020, 0.014, 0.020, 0.005, 1), metal), [0, 0.020, 0]));
  place(dring, [0.30, -0.010, (R + 0.030) * Z * 0.84], [0, -0.5, 0]);
  g.add(dring);

  // 金属扣（左侧）+ 铆钉
  const buckle = new THREE.Group();
  buckle.add(place(make(roundedBox(0.075, 0.062, 0.030, 0.010, 2), metal), [0, 0, 0]));
  buckle.add(place(make(new THREE.TorusGeometry(0.021, 0.006, 10, 18), metal), [0.030, 0, 0.012], [0, Math.PI / 2, 0]));
  place(buckle, [-0.30, 0.0, (R + 0.028) * Z * 0.86], [0.15, -0.35, 0]);
  g.add(buckle);
  for (const dx of [0.10, 0.20]) {
    g.add(place(make(new THREE.SphereGeometry(0.011, 12, 10), metal), [dx, 0.0, (R + 0.030) * Z * 0.95]));
  }

  // 挂环 + 铃铛
  const frontZ = (R + 0.064) * Z;
  g.add(place(make(new THREE.TorusGeometry(0.026, 0.009, 10, 20), metal), [0, -0.040, frontZ - 0.014], [Math.PI / 2, 0, 0]));

  const bell = new THREE.Group();
  bell.add(place(make(new THREE.SphereGeometry(0.085, 26, 20), metal), [0, 0, 0], [0, 0, 0], [1, 1.04, 0.94]));
  // 铃铛开口
  bell.add(place(make(new THREE.TorusGeometry(0.032, 0.008, 8, 20), createAccMaterial('#8a6a16', { spec: 0.4, rough: 0.5 })), [0, -0.062, 0.014], [Math.PI / 2, 0, 0]));
  // 内部小锤
  bell.add(place(make(new THREE.SphereGeometry(0.017, 12, 10), metal), [0, -0.064, 0]));
  // 铃身刻纹（两道细环）
  for (const dy of [0.034, 0.008]) {
    bell.add(place(make(new THREE.TorusGeometry(0.071 - dy * 0.4, 0.0034, 8, 32), createAccMaterial('#a8821f', { spec: 0.5, rough: 0.45 })), [0, dy, 0], [Math.PI / 2, 0, 0]));
  }
  // 高光条
  bell.add(place(make(new THREE.SphereGeometry(0.020, 12, 10), createAccMaterial('#fff3c4', { spec: 1, opacity: 0.55, rim: 0.4 })), [0.020, 0.026, 0.045], [0, 0, 0], [1, 1.5, 0.4]));
  place(bell, [0, -0.108, frontZ]);
  markAnim(bell, 'swing', 1, 1, 0);
  g.add(bell);
}

/** 精细天使翅膀：三层飞羽，逐根带羽轴 */
/** 程序化羽毛贴图：羽轴 + 细密羽枝 + 柔边 alpha，一次性生成后复用 */
let featherTexCache: THREE.CanvasTexture | null = null;
function getFeatherTexture(): THREE.CanvasTexture {
  if (featherTexCache) return featherTexCache;
  const W = 512;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const cy = H * 0.5;
  const rootX = 6;
  const tipX = W - 10;
  const halfW = (x: number) => {
    const t = (x - rootX) / (tipX - rootX);
    // 细长羽形：根部窄、35% 处最宽、末端收成尖
    const swell = Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.62) * 0.86)), 0.7);
    return H * 0.36 * swell * (1 - 0.55 * Math.pow(t, 3.2));
  };
  // 1) 柔边羽形（blur 让轮廓不起硬边，像绒毛）
  ctx.save();
  ctx.filter = 'blur(5.5px)';
  ctx.beginPath();
  ctx.moveTo(rootX, cy);
  for (let x = rootX; x <= tipX; x += 4) ctx.lineTo(x, cy - halfW(x));
  ctx.quadraticCurveTo(tipX + 6, cy, tipX - 2, cy + 1);
  for (let x = tipX; x >= rootX; x -= 4) ctx.lineTo(x, cy + halfW(x));
  ctx.closePath();
  const g = ctx.createLinearGradient(rootX, 0, tipX, 0);
  g.addColorStop(0, 'rgba(226,223,214,1)');
  g.addColorStop(0.45, 'rgba(247,245,239,1)');
  g.addColorStop(1, 'rgba(255,254,250,1)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  // 2) 羽枝纹理：只画在羽形内部
  ctx.globalCompositeOperation = 'source-atop';
  ctx.lineCap = 'round';
  for (let x = rootX + 6; x < tipX - 3; x += 2.4) {
    const hw = halfW(x) * 0.94;
    if (hw < 2) continue;
    const tilt = 10 + 8 * ((x - rootX) / (tipX - rootX));
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, cy + dir * 1.2);
      ctx.quadraticCurveTo(x + tilt * 0.5, cy + dir * hw * 0.55, x + tilt, cy + dir * hw);
      ctx.strokeStyle = dir > 0 ? 'rgba(126,120,108,0.34)' : 'rgba(255,255,255,0.44)';
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }
  }
  // 2.5) 下缘柔和暗边，模拟上一片羽压在下一片上的阴影
  const sg = ctx.createLinearGradient(0, cy, 0, H);
  sg.addColorStop(0, 'rgba(0,0,0,0)');
  sg.addColorStop(0.72, 'rgba(120,114,104,0.07)');
  sg.addColorStop(0.72, 'rgba(120,114,104,0.09)');
  sg.addColorStop(1, 'rgba(92,86,78,0.34)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, cy, W, H - cy);
  // 3) 羽轴：靠近根部深、往尖端变亮
  const rg = ctx.createLinearGradient(rootX, 0, tipX, 0);
  rg.addColorStop(0, 'rgba(176,170,158,0.34)');
  rg.addColorStop(0.6, 'rgba(255,255,255,0.55)');
  rg.addColorStop(1, 'rgba(255,255,255,0.15)');
  ctx.strokeStyle = rg;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(rootX + 2, cy);
  ctx.quadraticCurveTo(W * 0.55, cy - 2, tipX - 6, cy - 4);
  ctx.stroke();
  // 4) 轻微斑驳，避免塑料般的均匀
  for (let i = 0; i < 90; i += 1) {
    const x = rootX + Math.random() * (tipX - rootX);
    const y = cy + (Math.random() - 0.5) * H * 0.8;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(170,164,152,0.07)';
    ctx.beginPath();
    ctx.ellipse(x, y, Math.random() * 10 + 3, Math.random() * 4 + 1.5, Math.random(), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  featherTexCache = tex;
  return tex;
}

function buildAngelWingsFine(
  parent: THREE.Group,
  c1: string,
  c2: string,
  s: number,
): void {
  // 以肩关节为轴建一个子组，扇动时整片翅膀绕肩转
  const g = new THREE.Group();
  const PIVOT_Y = 1.26;
  g.position.set(s * 0.25, PIVOT_Y, -0.42);
  g.rotation.set(0.04, s * 0.16, s * 0.08);
  markAnim(g, 'glide', s, 1.0, s > 0 ? 0 : 0.9);
  parent.add(g);

  const tex = getFeatherTexture();
  const mixHex = (a: string, b: string, t: number) =>
    `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
  // 四档羽色：越靠里越暗，层次靠明暗差，不靠描边
  // 洁白羽：底色全部往白里提，灰调只保留极少（原来掺 28%~52% 灰，远看发青灰）
  const tipMat = createAccMaterial(mixHex(c1, '#ffffff', 0.90), { map: tex, spec: 0.02, rough: 0.96, rim: 0.16, grain: 0, glow: 0.03 });
  const midMat = createAccMaterial(mixHex(c1, '#ffffff', 0.76), { map: tex, spec: 0.02, rough: 0.96, rim: 0.15, grain: 0, glow: 0.022 });
  const deepMat = createAccMaterial(mixHex(c1, c2, 0.10), { map: tex, spec: 0.02, rough: 0.95, rim: 0.14, grain: 0, glow: 0.015 });
  const downMat = createAccMaterial(mixHex(c1, '#ffffff', 0.62), { map: tex, spec: 0.01, rough: 1, rim: 0.12, grain: 0, glow: 0.02, opacity: 0.82 });

  const fract = (n: number) => n - Math.floor(n);
  const rand = (i: number, k: number) => fract(Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453);

  /** 一片羽毛：贴图平面 + 沿长度的下垂弯度 + 侧向微卷 */
  const featherGeo = (len: number, wide: number, curl: number) => {
    const geo = new THREE.PlaneGeometry(len, wide, 10, 6);
    geo.translate(len * 0.5, 0, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i);
      const y = p.getY(i);
      const t = Math.min(1, Math.max(0, x / len));
      p.setZ(i, curl * t * t * len * 0.22 + Math.sin(t * Math.PI) * wide * 0.05);
      p.setY(i, y - curl * t * t * wide * 0.22);
    }
    // 左翼：把几何沿 x 镜像（不是靠对象负缩放，避免法线翻转导致发黑）
    if (s < 0) geo.scale(-1, 1, 1);
    geo.computeVertexNormals();
    return geo;
  };

  const row = (
    count: number,
    rowIdx: number,
    yBase: number,
    lenMin: number,
    lenMax: number,
    spread: number,
    lift: number,
    mat: THREE.Material,
    zOff: number,
    wideScale: number,
  ) => {
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0 : i / (count - 1);
      const r1 = rand(i, rowIdx);
      const r2 = rand(i + 17, rowIdx + 3);
      const r3 = rand(i + 41, rowIdx + 7);
      const len = mix(lenMin, lenMax, t) * (0.90 + 0.20 * r1);
      const wide = len * wideScale * (0.88 + 0.24 * r2);
      const swing = mix(0.14, 0.62 + spread * 0.12, t) + (r3 - 0.5) * 0.10;
      const rootX = s * (-0.05 + t * 0.36 + (r2 - 0.5) * 0.014);
      const rootY = yBase - PIVOT_Y + t * 0.13 + (r1 - 0.5) * 0.012 + lift * 0.06;
      const feather = make(featherGeo(len, wide, 0.45 + r2 * 0.55), mat);
      place(
        feather,
        [rootX, rootY, zOff + (r1 - 0.5) * 0.010],
        [0.05 + (r2 - 0.5) * 0.10, s * (0.30 + (r3 - 0.5) * 0.18), -s * swing],
      );
      g.add(feather);
    }
  };

  // 肩部：三片短覆羽叠着盖住接缝（比一个光球自然）
  for (let i = 0; i < 3; i += 1) {
    const t = i / 2;
    const f = make(featherGeo(0.20 - t * 0.04, 0.075, 0.5), i === 1 ? midMat : deepMat);
    place(f, [s * (0.04 + t * 0.05), 0.045 - t * 0.03, -0.02 - t * 0.012], [0.1, s * 0.42, -s * (0.9 + t * 0.25)]);
    g.add(f);
  }

  // 四层羽：长飞羽 → 次飞羽 → 覆羽 → 绒羽
  row(11, 0, 1.335, 0.52, 0.92, 0.62, 0.16, tipMat, 0.0, 0.23);
  row(10, 1, 1.215, 0.42, 0.70, 0.80, -0.02, midMat, -0.032, 0.25);
  row(9, 2, 1.115, 0.28, 0.46, 0.96, -0.20, deepMat, -0.062, 0.28);
  row(7, 3, 1.040, 0.16, 0.26, 1.04, -0.34, downMat, -0.084, 0.34);
}


// ---------------------------------------------------------------- 精细版：皇冠 / 围巾 / 领结 / 背包 / 披风 / 袜靴 / 坐垫 / 道具

/** 皇冠：绒面冠圈（上下滚边 + 内衬）+ 八枚金尖 + 尖端珍珠 + 主宝石 + 细丝饰 */
function buildCrownFine(
  g: THREE.Group,
  ctx: Acc3DCtx,
  c1: string,
  c2: string,
): void {
  // 参考图是整顶金属冠：主体也用金属，只是稍暗一点，靠光影区分层次
  const velvet = createAccMaterial(c2, { spec: 0.62, rough: 0.42, rim: 0.30 });
  const gold = createAccMaterial(c2, { spec: 0.92, rough: 0.18, rim: 0.34 });
  const goldDark = createAccMaterial(c2, { spec: 0.55, rough: 0.34 });
  const lining = createAccMaterial('#3a1420', { spec: 0.05, rough: 0.96 });
  const pearl = createAccMaterial('#f8f2e2', { spec: 0.85, rough: 0.14 });
  const gem = createAccMaterial(c1, { spec: 1.0, rough: 0.06, glow: 0.18 });
  const R = ctx.headRadius(0.30) + 0.030;
  const Z = ctx.zScale;

  // 内衬：从里面能看到一圈深色绒，不像空心铁皮
  g.add(place(make(headRing(ctx, 0.288, 0.010, 0.034, 14), lining), [0, 0.002, 0]));

  // 冠圈：下窄上宽，正面微微外扩
  const band = make(new THREE.CylinderGeometry(R * 1.03, R * 0.97, 0.118, 56, 1, true), velvet);
  place(band, [0, 0.320, 0], [0, 0, 0], [1, 1, Z]);
  g.add(band);

  // 上下滚边 + 一圈铆钉（参考图里冠圈上的圆钉）
  g.add(place(make(headRing(ctx, 0.326, 0.026, 0.011, 14), gold), [0, 0.022, 0]));
  g.add(place(make(headRing(ctx, 0.302, 0.030, 0.010, 14), gold), [0, -0.020, 0]));
  for (let i = 0; i < 20; i += 1) {
    const a = (i / 20) * Math.PI * 2;
    g.add(place(make(new THREE.SphereGeometry(0.011, 10, 8), gold), [Math.sin(a) * (R - 0.004), 0.318, Math.cos(a) * (R - 0.004) * Z], [0, 0, 0], [1, 1, 0.5]));
  }

  // 八枚尖：金片 + 顶端珍珠 + 两翼小勾
  const N = 8;
  for (let i = 0; i < N; i += 1) {
    const a = (i / N) * Math.PI * 2;
    const x = Math.sin(a) * R * 0.99;
    const z = Math.cos(a) * R * 0.99 * Z;
    // 花形尖：中间一枚长瓣 + 两侧小瓣
    const spike = make(new THREE.ConeGeometry(0.040, 0.150, 8), gold);
    place(spike, [x, 0.400, z], [0, -a, 0], [1, 1, 0.70]);
    g.add(spike);
    for (const s2 of [-1, 1] as const) {
      const side = make(new THREE.ConeGeometry(0.020, 0.072, 6), gold);
      place(side, [x + Math.cos(a) * s2 * 0.042, 0.372, z - Math.sin(a) * s2 * 0.042], [0, -a, 0], [1, 1, 0.6]);
      g.add(side);
    }
    // 尖底的小托
    g.add(place(make(new THREE.CylinderGeometry(0.050, 0.042, 0.016, 4), goldDark), [x, 0.330, z], [0, -a + Math.PI / 4, 0], [1, 1, 0.72]));
    // 珍珠
    g.add(place(make(new THREE.SphereGeometry(0.025, 16, 12), pearl), [x, 0.478, z]));
    // 尖侧的小勾丝
    for (const s of [-1, 1] as const) {
      const bx = Math.sin(a + s * 0.16) * R * 0.99;
      const bz = Math.cos(a + s * 0.16) * R * 0.99 * Z;
      g.add(
        seamTube(
          [
            [x, 0.352, z],
            [(x + bx) * 0.5, 0.382, (z + bz) * 0.5],
            [bx, 0.352, bz],
          ],
          0.0075,
          0.0055,
          goldDark,
          10,
          5,
        ),
      );
    }
    // 冠圈上的小宝石（尖与尖之间）
    if (i % 2 === 0) {
      const ga = a + Math.PI / N;
      const gx = Math.sin(ga) * (R + 0.006);
      const gz = Math.cos(ga) * (R + 0.006) * Z;
      g.add(place(make(new THREE.TorusGeometry(0.021, 0.006, 8, 16), gold), [gx, 0.318, gz], [0, -ga, 0]));
      g.add(place(make(new THREE.SphereGeometry(0.017, 14, 10), gem), [gx, 0.318, gz], [0, -ga, 0], [1, 1, 0.7]));
    }
  }

  // 正面主宝石：金托 + 椭圆宝石 + 高光点
  const fz = (R + 0.020) * Z;
  g.add(place(make(new THREE.TorusGeometry(0.058, 0.014, 12, 28), gold), [0, 0.320, fz], [0, 0, 0], [1, 1.3, 1]));
  g.add(place(make(new THREE.SphereGeometry(0.050, 22, 18), gem), [0, 0.320, fz], [0, 0, 0], [1, 1.32, 0.62]));
  g.add(
    place(
      make(new THREE.SphereGeometry(0.016, 12, 10), createAccMaterial('#ffffff', { spec: 1, opacity: 0.8, rim: 0.3 })),
      [-0.016, 0.344, fz + 0.030],
      [0, 0, 0],
      [1, 1.4, 0.4],
    ),
  );
  // 主宝石两侧的卷草纹
  for (const s of [-1, 1] as const) {
    g.add(
      seamTube(
        [
          [s * 0.070, 0.300, (R + 0.012) * Z],
          [s * 0.115, 0.330, (R + 0.008) * Z * 0.96],
          [s * 0.150, 0.302, (R + 0.004) * Z * 0.92],
        ],
        0.0085,
        0.0055,
        goldDark,
        12,
        5,
      ),
    );
  }
}

/** 围巾：三层缠绕 + 针脚 + 侧结 + 双垂尾 + 流苏 */
function buildScarfFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const R = ctx.collarR;
  const Z = ctx.zScale;
  const cloth = createAccMaterial(c1, { spec: 0.05, rough: 0.96, rim: 0.34 });
  const accent = createAccMaterial(c2, { spec: 0.05, rough: 0.95, rim: 0.30 });
  const thread = createAccMaterial('#f4ecdc', { spec: 0.06, rough: 0.9 });

  // 三层缠绕：半径与高度错开，看起来是绕上去的布，而不是一个圈
  const layers: Array<[number, number, number, THREE.Material]> = [
    [R + 0.038, -0.092, 0.052, cloth],
    [R + 0.046, -0.040, 0.056, accent],
    [R + 0.036, 0.016, 0.048, cloth],
  ];
  for (let i = 0; i < layers.length; i += 1) {
    const [r, y, tube, mat] = layers[i];
    const geo = new THREE.TorusGeometry(r, tube, 16, 48);
    geo.rotateX(Math.PI / 2);
    geo.scale(1, 1.0, Z);
    const m = make(geo, mat);
    m.position.set(Math.sin(i * 2.2) * 0.014, y, Math.cos(i * 2.2) * 0.010);
    m.rotation.y = i * 0.18;
    g.add(m);
    // 上下两道针脚
    for (const dy of [tube * 0.62, -tube * 0.62]) {
      g.add(beadRing(r, y + dy, 40, 0.0058, thread, Z, 0, Math.PI * 2, [1, 0.75, 1]));
    }
  }

  // 侧结：一小团布 + 两道扎带
  const knot = new THREE.Group();
  knot.add(place(make(new THREE.SphereGeometry(0.085, 18, 14), cloth), [0, 0, 0], [0, 0, 0], [1, 0.9, 0.8]));
  knot.add(place(make(new THREE.TorusGeometry(0.088, 0.016, 10, 26), accent), [0, 0.026, 0], [Math.PI / 2, 0, 0], [1, 1, 0.8]));
  knot.add(place(make(new THREE.TorusGeometry(0.086, 0.014, 10, 26), accent), [0, -0.030, 0], [Math.PI / 2, 0, 0], [1, 1, 0.8]));
  place(knot, [0.26, -0.046, (R + 0.045) * Z * 0.72], [0.2, 0.5, 0.1]);
  g.add(knot);

  // 两条垂尾（一长一短）+ 底端流苏
  const tails: Array<[number, number, number, number]> = [
    [0.10, -0.30, 0.30, 0.12],
    [-0.02, -0.24, 0.22, -0.10],
  ];
  for (let i = 0; i < tails.length; i += 1) {
    const [dx, dy, h, tilt] = tails[i];
    const grp = new THREE.Group();
    const w = 0.21 - i * 0.03;
    const body = make(roundedBox(w, h, 0.062, 0.030, 3), i === 0 ? cloth : accent);
    grp.add(place(body, [dx, dy, (R + 0.030) * Z], [0.16, 0, tilt]));
    // 底端加厚的一道边
    grp.add(place(make(roundedBox(w * 1.02, 0.048, 0.070, 0.022, 2), accent), [dx, dy - h * 0.5, (R + 0.028) * Z], [0.16, 0, tilt]));
    // 流苏
    for (let k = 0; k < 6; k += 1) {
      const fx = dx - w * 0.42 + (k / 5) * w * 0.84;
      grp.add(
        make(
          taperTube(
            [
              [fx, dy - h * 0.5 - 0.020, (R + 0.030) * Z],
              [fx + tilt * 0.05, dy - h * 0.5 - 0.070, (R + 0.026) * Z],
              [fx + tilt * 0.09, dy - h * 0.5 - 0.108, (R + 0.020) * Z],
            ],
            0.010,
            0.005,
            8,
            5,
          ),
          thread,
        ),
      );
    }
    markAnim(grp, 'sway', 1, 1, i * 0.7);
    g.add(grp);
  }
}

/** 领结：左右各三片折布 + 中央结 + 金属扣 + 两条飘带 */
function buildBowtieFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const R = ctx.collarR;
  const Z = ctx.zScale;
  const cloth = createAccMaterial(c1, { spec: 0.20, rough: 0.55, rim: 0.32 });
  const shade = createAccMaterial(c2, { spec: 0.16, rough: 0.6 });
  const metal = createAccMaterial('#d8b45a', { spec: 0.9, rough: 0.18 });

  for (const s of [-1, 1] as const) {
    // 三片折布：越靠外越窄，叠出错落
    const folds: Array<[number, number, number, number]> = [
      [0.135, 0.175, 0.095, 0.10],
      [0.205, 0.215, 0.070, 0.02],
      [0.180, 0.135, 0.058, -0.12],
    ];
    for (let i = 0; i < folds.length; i += 1) {
      const [dx, w, h, tilt] = folds[i];
      const piece = make(roundedBox(w, h, 0.050, 0.024, 3), i === 1 ? shade : cloth);
      place(piece, [s * dx, -0.070 + i * 0.006, (R + 0.028) * Z], [0.05, 0, s * tilt]);
      g.add(piece);
    }
    // 飘带
    g.add(
      make(
        taperTube(
          [
            [s * 0.04, -0.10, (R + 0.026) * Z],
            [s * 0.10, -0.20, (R + 0.018) * Z],
            [s * 0.07, -0.30, (R + 0.010) * Z],
          ],
          0.030,
          0.018,
          12,
          6,
        ),
        shade,
      ),
    );
  }
  // 中央结
  g.add(place(make(roundedBox(0.075, 0.085, 0.058, 0.024, 3), cloth), [0, -0.070, (R + 0.034) * Z], [0.05, 0, 0]));
  g.add(place(make(new THREE.TorusGeometry(0.030, 0.008, 10, 22), metal), [0, -0.070, (R + 0.052) * Z], [0, 0, 0], [1, 1.1, 1]));
  g.add(place(make(new THREE.SphereGeometry(0.014, 12, 10), metal), [0, -0.070, (R + 0.056) * Z]));
}

/** 背包：主体 + 前袋 + 翻盖 + 金属扣 + 提手 + 双肩带（带调节扣）+ 拉链珠 */
function buildBackpackFine(g: THREE.Group, c1: string, c2: string): void {
  const body = createAccMaterial(c1, { spec: 0.16, rough: 0.62, rim: 0.30 });
  const trim = createAccMaterial(c2, { spec: 0.22, rough: 0.5 });
  const metal = createAccMaterial('#c9b06a', { spec: 0.85, rough: 0.22 });
  const dark = createAccMaterial('#2a2622', { spec: 0.1, rough: 0.8 });

  // 主体：底部略鼓
  g.add(place(make(roundedBox(0.52, 0.50, 0.28, 0.09, 4), body), [0, 1.14, -0.54], [-0.05, 0, 0]));
  // 前袋
  g.add(place(make(roundedBox(0.36, 0.22, 0.10, 0.06, 3), trim), [0, 1.03, -0.415], [-0.10, 0, 0]));
  g.add(place(make(roundedBox(0.38, 0.040, 0.11, 0.018, 2), metal), [0, 1.135, -0.420], [-0.10, 0, 0]));
  // 翻盖 + 扣带
  g.add(place(make(roundedBox(0.48, 0.17, 0.09, 0.045, 3), trim), [0, 1.35, -0.55], [-0.12, 0, 0]));
  for (const s of [-0.24, 0, 0.24]) {
    g.add(place(make(roundedBox(0.048, 0.10, 0.026, 0.010, 2), dark), [s, 1.29, -0.500], [-0.12, 0, 0]));
    g.add(place(make(new THREE.TorusGeometry(0.022, 0.007, 8, 18), metal), [s, 1.240, -0.503], [0.2, 0, 0], [1, 1.2, 1]));
  }
  // 顶部提手
  g.add(
    make(
      taperTube(
        [
          [-0.065, 1.405, -0.54],
          [0, 1.442, -0.525],
          [0.065, 1.405, -0.54],
        ],
        0.016,
        0.016,
        14,
        6,
      ),
      dark,
    ),
  );
  // 拉链：顶部一圈小珠
  for (let i = 0; i < 16; i += 1) {
    const t = i / 15;
    g.add(place(make(new THREE.SphereGeometry(0.011, 8, 6), metal), [-0.24 + t * 0.48, 1.39, -0.555], [0, 0, 0], [1, 0.7, 0.7]));
  }
  // 肩带 + 调节扣
  for (const s of [-1, 1] as const) {
    g.add(
      make(
        taperTube(
          [
            [s * 0.24, 1.42, -0.50],
            [s * 0.40, 1.22, -0.24],
            [s * 0.36, 1.02, 0.02],
            [s * 0.30, 0.90, 0.18],
          ],
          0.032,
          0.026,
          18,
          7,
        ),
        trim,
      ),
    );
    g.add(place(make(roundedBox(0.075, 0.055, 0.030, 0.012, 2), metal), [s * 0.385, 1.16, -0.20], [0.1, s * 0.3, 0]));
    // 腰带
    g.add(
      make(
        taperTube(
          [
            [s * 0.26, 1.04, -0.46],
            [s * 0.34, 0.99, -0.16],
            [s * 0.30, 0.94, 0.10],
          ],
          0.024,
          0.020,
          12,
          6,
        ),
        dark,
      ),
    );
  }
  // 侧袋
  for (const s of [-1, 1] as const) {
    g.add(place(make(roundedBox(0.09, 0.20, 0.16, 0.04, 2), body), [s * 0.30, 1.06, -0.62], [0, 0, s * 0.04]));
  }
}

/** 小披风（肩披）：高领 + 开襟伞面 + 波浪下摆 + 铜环系带 */
function buildCapeFine(g: THREE.Group, c1: string, c2: string): void {
  const wool = createAccMaterial(c1, { spec: 0.05, rough: 0.96, rim: 0.34 });
  const woolDark = createAccMaterial(c1, { spec: 0.04, rough: 0.98, rim: 0.26 });
  const brass = createAccMaterial('#c8a24a', { spec: 0.9, rough: 0.22 });
  const cord = createAccMaterial(c1, { spec: 0.08, rough: 0.9 });
  const Z = 0.86;

  // 肩面：从领口向外张开，前面留 46° 开口
  const body = capeletGeo(1.56, 1.06, 0.30, 0.80, 46, Z, 6);
  g.add(make(body, wool));
  // 内层：深一号的衬里，边缘露出来有厚度
  const inner = capeletGeo(1.55, 1.09, 0.29, 0.76, 46, Z, 6);
  inner.scale(0.995, 0.995, 0.995);
  g.add(make(inner, woolDark));

  // 下摆卷边：沿波浪边一圈
  const hemPts: Array<[number, number, number]> = [];
  const gap = (46 * Math.PI) / 180;
  for (let i = 0; i <= 56; i += 1) {
    const a = gap / 2 + (i / 56) * (Math.PI * 2 - gap);
    const wav = Math.sin(a * 6) * 0.045;
    const r = 0.80 + wav;
    hemPts.push([Math.sin(a) * r, 1.06 + Math.sin(a * 6 + 0.6) * 0.018, Math.cos(a) * r * Z]);
  }
  g.add(seamTube(hemPts, 0.016, 0.016, woolDark, 60, 6));

  // 高领：前开口的立领
  const collarGeo = new THREE.CylinderGeometry(0.30, 0.34, 0.18, 44, 1, true, gap / 2, Math.PI * 2 - gap);
  collarGeo.scale(1, 1, Z);
  g.add(place(make(collarGeo, wool), [0, 1.60, 0]));
  // 领口卷边
  const collarRim = new THREE.TorusGeometry(0.30, 0.014, 8, 44, Math.PI * 2 - gap);
  collarRim.rotateX(Math.PI / 2);
  collarRim.scale(1, 1, Z);
  g.add(place(make(collarRim, woolDark), [0, 1.69, 0], [0, gap / 2, 0]));

  // 两个铜环 + 系带蝴蝶结
  for (const s2 of [-1, 1] as const) {
    const a = s2 * (gap / 2 + 0.10);
    g.add(
      place(
        make(new THREE.TorusGeometry(0.030, 0.008, 10, 20), brass),
        [Math.sin(a) * 0.335, 1.575, Math.cos(a) * 0.335 * Z],
        [0, -a, 0.1],
      ),
    );
  }
  // 蝴蝶结：两个环 + 两条垂带
  for (const s2 of [-1, 1] as const) {
    g.add(
      make(
        taperTube(
          [
            [0, 1.560, 0.330],
            [s2 * 0.075, 1.585, 0.345],
            [s2 * 0.095, 1.535, 0.350],
            [0, 1.545, 0.335],
          ],
          0.014,
          0.012,
          14,
          6,
        ),
        cord,
      ),
    );
    g.add(
      make(
        taperTube(
          [
            [s2 * 0.012, 1.545, 0.335],
            [s2 * 0.045, 1.470, 0.350],
            [s2 * 0.030, 1.400, 0.345],
          ],
          0.012,
          0.009,
          12,
          5,
        ),
        cord,
      ),
    );
  }
  g.add(place(make(new THREE.SphereGeometry(0.026, 14, 10), cord), [0, 1.552, 0.335], [0, 0, 0], [1.2, 0.8, 0.8]));
  markAnim(g, 'sway', 1, 0.6, 0);
}

/** 袜套：罗纹口 + 袜身 + 脚跟 / 脚尖补片 + 两道条纹（单位球空间） */
function buildSockFine(g: THREE.Group, c1: string, c2: string): void {
  const cloth = createAccMaterial(c1, { spec: 0.08, rough: 0.9, rim: 0.34 });
  const trim = createAccMaterial(c2, { spec: 0.16, rough: 0.62 });
  const dark = createAccMaterial('#2b2b30', { spec: 0.1, rough: 0.75 });

  // 袜身
  const shell = make(new THREE.SphereGeometry(1.06, 26, 20, 0, Math.PI * 2, 0, Math.PI * 0.62), cloth);
  place(shell, [0, -0.04, 0], [Math.PI * 0.5, 0, 0], [1.02, 1.0, 1.0]);
  g.add(shell);
  // 罗纹袖口：一圈竖向小条
  g.add(place(make(new THREE.TorusGeometry(0.86, 0.11, 14, 34), trim), [0, -0.07, 0.34], [0, 0, 0], [1, 1, 0.72]));
  for (let i = 0; i < 22; i += 1) {
    const a = (i / 22) * Math.PI * 2;
    g.add(
      place(
        make(new THREE.CapsuleGeometry(0.017, 0.11, 4, 8), trim),
        [Math.sin(a) * 0.88, -0.07, 0.34 + Math.cos(a) * 0.88 * 0.72],
        [0, -a, 0],
      ),
    );
  }
  // 两道条纹
  for (const dz of [0.52, 0.60]) {
    g.add(place(make(new THREE.TorusGeometry(0.90 - (dz - 0.52) * 0.5, 0.030, 8, 30), trim), [0, -0.06, dz * 0.62], [0, 0, 0], [1, 1, 0.9]));
  }
  // 脚跟 / 脚尖补片
  g.add(place(make(new THREE.SphereGeometry(0.42, 16, 12), dark), [0, -0.44, 0.14], [0, 0, 0], [1.0, 0.7, 0.9]));
  g.add(place(make(new THREE.SphereGeometry(0.38, 16, 12), trim), [0, 0.30, 0.86], [0, 0, 0], [1.0, 0.8, 0.5]));
}

/** 靴子：靴筒 + 翻口 + 鞋底 + 鞋跟 + 鞋带与鞋眼（单位球空间） */
function buildBootFine(g: THREE.Group, c1: string, c2: string): void {
  const leather = createAccMaterial(c1, { spec: 0.24, rough: 0.55, rim: 0.32 });
  const trim = createAccMaterial(c2, { spec: 0.20, rough: 0.6 });
  const sole = createAccMaterial('#2c2a28', { spec: 0.12, rough: 0.8 });
  const lace = createAccMaterial('#f2e8d4', { spec: 0.1, rough: 0.85 });

  // 靴筒
  g.add(place(make(new THREE.CylinderGeometry(0.78, 0.86, 1.25, 26, 1, true), leather), [0, 0.10, 0.10], [0.06, 0, 0]));
  // 翻口
  g.add(place(make(new THREE.TorusGeometry(0.79, 0.10, 12, 30), trim), [0, 0.72, 0.09], [Math.PI / 2, 0, 0], [1, 1, 0.95]));
  // 鞋头
  g.add(place(make(new THREE.SphereGeometry(0.86, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.55), leather), [0, -0.30, 0.26], [Math.PI * 0.48, 0, 0], [1, 0.9, 1.05]));
  // 鞋底 + 缝线
  g.add(place(make(roundedBox(1.72, 0.20, 2.10, 0.14, 3), sole), [0, -0.86, 0.20]));
  for (let i = 0; i < 12; i += 1) {
    const t = i / 11;
    g.add(place(make(new THREE.SphereGeometry(0.020, 8, 6), lace), [-0.72 + t * 1.44, -0.74, 1.16], [0, 0, 0], [1, 0.7, 0.7]));
  }
  // 鞋跟
  g.add(place(make(roundedBox(1.30, 0.30, 0.52, 0.10, 2), sole), [0, -0.95, -0.52]));
  // 鞋带：三道交叉 + 鞋眼
  for (let i = 0; i < 3; i += 1) {
    const y = 0.18 - i * 0.24;
    g.add(
      make(
        taperTube(
          [
            [-0.32, y, 0.80],
            [0, y - 0.06, 0.90],
            [0.32, y, 0.80],
          ],
          0.016,
          0.016,
          10,
          5,
        ),
        lace,
      ),
    );
    for (const s of [-1, 1] as const) {
      g.add(place(make(new THREE.TorusGeometry(0.028, 0.008, 8, 14), trim), [s * 0.33, y, 0.79], [0, s * 0.4, 0]));
    }
  }
}

/** 坐垫：绗缝上层 + 侧边 + 滚边 + 四个角结 + 流苏 */
function buildCushionFine(g: THREE.Group, c1: string, c2: string): void {
  const soft = createAccMaterial(c1, { spec: 0.05, rough: 0.92, rim: 0.32 });
  const trim = createAccMaterial(c2, { spec: 0.14, rough: 0.6 });
  const thread = createAccMaterial('#f4ecdc', { spec: 0.06, rough: 0.9 });
  const R = 0.74;

  // 侧边
  g.add(place(make(new THREE.CylinderGeometry(R, R * 0.97, 0.16, 48), soft), [0, 0.09, -0.26], [0, 0, 0], [1, 1, 0.92]));
  // 上层：中间微微鼓起
  const top = new THREE.SphereGeometry(R, 44, 12, 0, Math.PI * 2, 0, Math.PI * 0.36);
  const topMesh = make(top, soft);
  place(topMesh, [0, 0.135, -0.26], [0, 0, 0], [1, 0.42, 0.92]);
  g.add(topMesh);
  // 滚边
  g.add(place(make(new THREE.TorusGeometry(R, 0.045, 10, 52), trim), [0, 0.158, -0.26], [Math.PI / 2, 0, 0], [1, 1, 0.92]));
  // 绗缝：四道径向缝线 + 中央扣结
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pts: Array<[number, number, number]> = [];
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      pts.push([Math.sin(a) * R * t, 0.148 + Math.cos(t * 1.4) * 0.030, Math.cos(a) * R * t * 0.92 - 0.26]);
    }
    g.add(seamTube(pts, 0.010, 0.004, thread, 14, 5));
  }
  g.add(place(make(new THREE.SphereGeometry(0.055, 16, 12), trim), [0, 0.185, -0.26], [0, 0, 0], [1, 0.7, 1]));
  // 四个角结 + 短流苏
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.sin(a) * R * 0.99;
    const z = Math.cos(a) * R * 0.99 * 0.92 - 0.26;
    g.add(place(make(new THREE.SphereGeometry(0.038, 14, 10), trim), [x, 0.165, z]));
    g.add(
      make(
        taperTube(
          [
            [x, 0.155, z],
            [x * 1.05, 0.100, z * 1.05],
            [x * 1.08, 0.050, z * 1.08],
          ],
          0.013,
          0.006,
          8,
          5,
        ),
        thread,
      ),
    );
  }
}

/** 咖啡杯：杯身 + 杯口 + 把手 + 咖啡面 + 碟子 */
function buildCupFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  const pts: THREE.Vector2[] = [
    [0.001, 0.0], [0.16, 0.0], [0.175, 0.02], [0.185, 0.12], [0.20, 0.30],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const shell = make(new THREE.LatheGeometry(pts, 40), base);
  g.add(shell);
  g.add(place(make(new THREE.TorusGeometry(0.20, 0.014, 10, 40), accent), [0, 0.30, 0], [Math.PI / 2, 0, 0]));
  const coffee = make(new THREE.CircleGeometry(0.186, 40), accent);
  g.add(place(coffee, [0, 0.285, 0], [-Math.PI / 2, 0, 0]));
  const handle = make(new THREE.TorusGeometry(0.095, 0.020, 10, 26, Math.PI * 1.35), base);
  place(handle, [0.185, 0.18, 0], [0, 0, -0.5]);
  g.add(handle);
  g.add(place(make(new THREE.CylinderGeometry(0.30, 0.28, 0.020, 40), accent), [0, 0.005, 0], [0, 0, 0], [1, 1, 1]));
}

/** 书本：封面 + 书页（压出层次）+ 书脊 + 书签带 + 烫金角 */
function buildBookFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  g.add(place(make(roundedBox(0.30, 0.42, 0.075, 0.012, 2), base), [0, 0.21, 0]));
  for (let i = 0; i < 5; i += 1) {
    g.add(place(make(roundedBox(0.276, 0.40, 0.006, 0.003, 1), accent), [0.006, 0.21, 0.032 + i * 0.006]));
  }
  g.add(place(make(roundedBox(0.030, 0.42, 0.078, 0.010, 2), accent), [-0.152, 0.21, 0]));
  // 书签
  g.add(place(make(roundedBox(0.026, 0.16, 0.006, 0.004, 1), accent), [0.075, 0.13, 0.044], [0, 0, 0.06]));
  // 封面压印
  g.add(place(make(new THREE.TorusGeometry(0.055, 0.0045, 8, 26), accent), [0.035, 0.28, 0.040], [0, 0, 0], [1, 0.8, 1]));
}

/** 毛线球：缠绕的线（多圈交错的环）+ 毛线针 + 线头 */
function buildYarnFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  g.add(place(make(new THREE.SphereGeometry(0.15, 22, 18), base), [0, 0.16, 0]));
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI;
    const geo = new THREE.TorusGeometry(0.148, 0.010, 6, 26);
    const m = make(geo, i % 2 ? accent : base);
    m.position.set(0, 0.16, 0);
    m.rotation.set(a, a * 1.7, i * 0.5);
    g.add(m);
  }
  // 针织针
  g.add(place(make(new THREE.CylinderGeometry(0.008, 0.008, 0.44, 8), accent), [0.10, 0.30, 0.02], [0, 0, -0.42]));
  g.add(place(make(new THREE.SphereGeometry(0.020, 10, 8), accent), [0.30, 0.40, 0.02]));
  // 线头
  g.add(
    make(
      taperTube(
        [
          [0.13, 0.10, 0.05],
          [0.22, 0.06, 0.10],
          [0.28, 0.10, 0.04],
          [0.33, 0.04, 0.08],
        ],
        0.007,
        0.005,
        14,
        5,
      ),
      base,
    ),
  );
}

/** 小鱼干：鱼身 + 尾鳍 + 背鳍 + 腹鳍 + 眼 + 鳞片 */
function buildFishFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  const body = make(new THREE.SphereGeometry(0.15, 22, 16), base);
  place(body, [0, 0.14, 0], [0, 0, 0], [1.55, 0.62, 0.55]);
  g.add(body);
  // 尾鳍
  const tail = make(new THREE.ConeGeometry(0.10, 0.16, 3), accent);
  place(tail, [-0.245, 0.14, 0], [0, 0, Math.PI / 2], [1, 1, 0.45]);
  g.add(tail);
  // 背鳍 / 腹鳍
  for (const [dy, rot] of [[0.075, 0], [-0.060, Math.PI]] as const) {
    const fin = make(new THREE.ConeGeometry(0.075, 0.10, 3), accent);
    place(fin, [0.02, 0.14 + dy, 0], [0, 0, rot + 0.2], [1, 1, 0.36]);
    g.add(fin);
  }
  // 眼
  g.add(place(make(new THREE.SphereGeometry(0.022, 12, 10), createAccMaterial('#2a2320', { spec: 0.6 })), [0.155, 0.172, 0.062]));
  g.add(place(make(new THREE.SphereGeometry(0.009, 8, 6), createAccMaterial('#ffffff', { spec: 0.9, opacity: 0.9 })), [0.163, 0.180, 0.078]));
  // 鳞片：三排小弧
  for (let r = 0; r < 3; r += 1) {
    for (let i = 0; i < 4; i += 1) {
      const x = -0.06 + i * 0.055;
      const y = 0.175 - r * 0.030;
      g.add(
        place(
          make(new THREE.TorusGeometry(0.028, 0.0045, 6, 14, Math.PI), accent),
          [x, y, 0.055],
          [Math.PI / 2, 0, 0],
          [1, 1, 0.5],
        ),
      );
    }
  }
}

/** 甜甜圈：面包体 + 淋面（带波浪边）+ 彩针 */
function buildDonutFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  const dough = make(new THREE.TorusGeometry(0.145, 0.080, 16, 32), base);
  place(dough, [0, 0.13, 0], [Math.PI / 2, 0, 0]);
  g.add(dough);
  const glaze = make(new THREE.TorusGeometry(0.145, 0.055, 14, 32), accent);
  place(glaze, [0, 0.170, 0], [Math.PI / 2, 0, 0]);
  g.add(glaze);
  // 淋面波浪边
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * Math.PI * 2;
    g.add(
      place(
        make(new THREE.SphereGeometry(0.022, 10, 8), accent),
        [Math.cos(a) * 0.145, 0.126, Math.sin(a) * 0.145],
        [0, 0, 0],
        [1, 0.8, 1],
      ),
    );
  }
  // 彩针
  const colors = ['#f27a9a', '#f2d24a', '#7ac8f2', '#8ef27a', '#f2a24a'];
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2 + 0.3;
    const r = 0.10 + (i % 3) * 0.022;
    g.add(
      place(
        make(new THREE.CapsuleGeometry(0.007, 0.028, 4, 6), createAccMaterial(colors[i % 5], { spec: 0.4 })),
        [Math.cos(a) * r, 0.196 - (i % 2) * 0.006, Math.sin(a) * r],
        [0.2, a, Math.PI / 2],
      ),
    );
  }
}

// ---------------------------------------------------------------- 头饰

function buildHead(shape: string, c1: string, c2: string, ctx: Acc3DCtx): THREE.Group {
  const g = new THREE.Group();
  const main = createAccMaterial(c1, { spec: 0.14 });
  const trim = createAccMaterial(c2, { spec: 0.24 });
  const soft = createAccMaterial(c1, { spec: 0.06, rim: 0.34 });

  switch (shape) {
    case 'cap': {
      buildCapFine(g, ctx, main, trim, soft);
      break;
    }
    case 'beanie': {
      buildBeanieFine(g, ctx, main, trim, soft);
      break;
    }
    case 'coneHat': {
      buildWitchHatFine(g, ctx, c1, c2);
      break;
    }
    case 'partyHat': {
      buildPartyHatFine(g, ctx, c1, c2);
      break;
    }
    case 'chefHat': {
      const cloth = createAccMaterial('#f4f2ec', { spec: 0.06, rough: 0.9, rim: 0.4 });
      const Z = ctx.zScale;
      // 帽箍：上下口径按颅骨收放，做成有锥度的筒，避免下半圈埋进额头
      const bandY0 = 0.214;
      const bandY1 = 0.344;
      const rBot = ctx.headRadius(bandY0) + 0.030;
      const rTop = ctx.headRadius(bandY1) + 0.032;
      const bandR = (rBot + rTop) / 2;
      const band = new THREE.CylinderGeometry(rTop, rBot, bandY1 - bandY0, 48, 1, true);
      band.scale(1, 1, Z);
      g.add(place(make(band, cloth), [0, (bandY0 + bandY1) / 2, 0]));
      // 上沿滚边 + 下沿滚边，把筒口收干净
      for (const [ry, rr, tube] of [[bandY1, rTop, 0.012], [bandY0, rBot, 0.010]] as const) {
        const rimGeo = new THREE.TorusGeometry(rr, tube, 10, 48);
        rimGeo.rotateX(Math.PI / 2);
        rimGeo.scale(1, 1, Z);
        g.add(place(make(rimGeo, createAccMaterial('#e9e4d6', { spec: 0.05, rough: 0.9 })), [0, ry, 0]));
      }
      // 竖褶
      for (let i = 0; i < 22; i += 1) {
        const a = (i / 22) * Math.PI * 2;
        g.add(
          place(
            make(new THREE.CapsuleGeometry(0.008, 0.100, 4, 6), cloth),
            [Math.sin(a) * (bandR + 0.004), 0.282, Math.cos(a) * (bandR + 0.004) * Z],
            [0, -a, 0],
          ),
        );
      }
      // 帽顶：三团 + 顶上一团，做成蓬松的厨师帽
      for (const [dx, dz, r] of [[-0.200, 0.030, 0.175], [0.205, 0.010, 0.180], [0.010, -0.130, 0.185], [0.000, 0.075, 0.190]] as const) {
        g.add(place(make(new THREE.SphereGeometry(r, 24, 18), cloth), [dx, 0.470, dz], [0, 0, 0], [1.05, 0.92, 1.05]));
      }
      // 褶皱线（从箍顶向上收）
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        g.add(
          seamTube(
            [
              [Math.sin(a) * (bandR + 0.004), 0.350, Math.cos(a) * (bandR + 0.004) * Z],
              [Math.sin(a) * (bandR * 0.82), 0.420, Math.cos(a) * (bandR * 0.82) * Z],
              [Math.sin(a) * (bandR * 0.46), 0.492, Math.cos(a) * (bandR * 0.46) * Z],
            ],
            0.006,
            0.004,
            cloth,
            12,
            5,
          ),
        );
      }
      // 箍下沿的缝线
      g.add(beadRing(ctx.headRadius(0.222) + 0.036, 0.222, 44, 0.0055, createAccMaterial('#e6e0d2', { spec: 0.05, rough: 0.9 }), Z));
      break;
    }
    case 'hatFrog': {
      // 青蛙头套：橄榄绿圆顶 + 两个凸眼包 + 嘴缝（参考图第 6 件）
      const skin = createAccMaterial('#6FA84A', { spec: 0.10, rough: 0.78, rim: 0.30 });
      const skinDark = createAccMaterial('#547F35', { spec: 0.08, rough: 0.82 });
      const eyeW = createAccMaterial('#F7F4E6', { spec: 0.24, rough: 0.42 });
      const pupil = createAccMaterial('#191917', { spec: 0.36, rough: 0.26 });
      const Z = ctx.zScale;
      const R = ctx.headRadius(0.30) + 0.050;
      const dome = new THREE.SphereGeometry(R, 30, 22);
      dome.scale(1, 0.94, Z);
      g.add(place(make(dome, skin), [0, 0.312, 0]));
      for (const sx of [-1, 1] as const) {
        g.add(place(make(new THREE.SphereGeometry(0.095, 20, 16), skin), [sx * 0.150, 0.452, 0.410], [0, 0, 0], [1, 0.96, 0.9]));
        g.add(place(make(new THREE.SphereGeometry(0.070, 18, 14), eyeW), [sx * 0.153, 0.459, 0.470], [0, 0, 0], [1, 1, 0.6]));
        g.add(place(make(new THREE.SphereGeometry(0.030, 14, 12), pupil), [sx * 0.156, 0.461, 0.505]));
        g.add(place(make(new THREE.SphereGeometry(0.012, 10, 8), skinDark), [sx * 0.052, 0.352, 0.430]));
      }
      // 嘴缝：一段横向圆弧
      const mouth = new THREE.TorusGeometry(R * 0.62, 0.0075, 8, 26, Math.PI * 0.72);
      mouth.rotateX(Math.PI / 2);
      mouth.rotateY(Math.PI / 2);
      g.add(place(make(mouth, skinDark), [0, 0.286, 0.395], [0, 0, 0], [1, 1, Z * 0.9]));
      break;
    }
    case 'hatPumpkin': {
      // 南瓜帽：橙色南瓜身 + 八道瓜棱 + 瓜蒂（参考图第 26 件）
      const pump = createAccMaterial('#E07A2A', { spec: 0.12, rough: 0.72, rim: 0.34 });
      const pumpDark = createAccMaterial('#C8661C', { spec: 0.10, rough: 0.78 });
      const stem = createAccMaterial('#6E5A2C', { spec: 0.08, rough: 0.88 });
      const Z = ctx.zScale;
      const R = ctx.headRadius(0.30) + 0.062;
      const body = new THREE.SphereGeometry(R, 30, 20);
      body.scale(1, 0.74, Z);
      g.add(place(make(body, pump), [0, 0.330, 0]));
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        const pts: Array<[number, number, number]> = [];
        for (let k = 0; k <= 6; k += 1) {
          const t = k / 6;
          const phi = 0.15 + t * Math.PI * 0.78;
          const rr = R * Math.sin(phi) * 0.995;
          const yy = 0.330 + R * 0.74 * Math.cos(phi);
          pts.push([Math.sin(a) * rr, yy, Math.cos(a) * rr * Z]);
        }
        g.add(seamTube(pts, 0.007, 0.004, pumpDark, 10, 4));
      }
      const stalk = new THREE.CylinderGeometry(R * 0.11, R * 0.15, R * 0.32, 12);
      g.add(place(make(stalk, stem), [0, 0.330 + R * 0.66, -0.010], [0.12, 0, 0.10]));
      // 小叶子
      const leaf = new THREE.SphereGeometry(R * 0.20, 14, 10);
      leaf.scale(1, 0.16, 0.62);
      g.add(place(make(leaf, createAccMaterial('#5F8B3A', { spec: 0.10, rough: 0.85 })), [R * 0.20, 0.330 + R * 0.60, 0.02], [0.2, -0.5, 0.25]));
      break;
    }
    case 'wreathDaisy': {
      // 雏菊花环：藤圈 + 12 朵小白花 + 叶片（参考图第 18 件）
      const vine = createAccMaterial('#7C6A3C', { spec: 0.06, rough: 0.92 });
      const petalMat = createAccMaterial('#FFFDF6', { spec: 0.14, rough: 0.62, rim: 0.36 });
      const coreMat = createAccMaterial('#F2C230', { spec: 0.18, rough: 0.58 });
      const leafMat = createAccMaterial('#6E8F45', { spec: 0.10, rough: 0.86 });
      const Z = ctx.zScale;
      const R = ctx.headRadius(0.36) + 0.028;
      const ring = new THREE.TorusGeometry(R, 0.017, 10, 60);
      ring.rotateX(Math.PI / 2);
      g.add(place(make(ring, vine), [0, 0.372, 0], [0.06, 0, 0], [1, 1, Z]));
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2 + 0.2;
        const px = Math.sin(a) * R;
        const pz = Math.cos(a) * R * Z;
        const scl = 0.85 + ((i * 37) % 30) / 100;
        for (let p = 0; p < 5; p += 1) {
          const pa = (p / 5) * Math.PI * 2;
          const petal = new THREE.SphereGeometry(0.017 * scl, 8, 6);
          petal.scale(1, 0.42, 1.5);
          g.add(
            place(
              make(petal, petalMat),
              [px + Math.cos(pa) * 0.022 * scl, 0.372 + 0.012, pz + Math.sin(pa) * 0.022 * Z],
              [0, -pa, 0],
            ),
          );
        }
        g.add(place(make(new THREE.SphereGeometry(0.011 * scl, 10, 8), coreMat), [px, 0.372 + 0.016, pz]));
        if (i % 3 === 0) {
          const lf = new THREE.SphereGeometry(0.026, 8, 6);
          lf.scale(1, 0.18, 0.6);
          g.add(place(make(lf, leafMat), [px * 1.12, 0.366, pz * 1.12], [0.2, -a, 0.3]));
        }
      }
      break;
    }
    case 'hatStraw': {
      // 草帽：宽帽檐 + 圆顶 + 棕色帽带（参考图第 13 件）
      const straw = createAccMaterial('#D9B878', { spec: 0.08, rough: 0.88, rim: 0.28 });
      const strawDark = createAccMaterial('#C4A263', { spec: 0.06, rough: 0.9 });
      const band = createAccMaterial('#8A5A2E', { spec: 0.10, rough: 0.7 });
      const Z = ctx.zScale;
      const brimR = ctx.headRadius(0.28) + 0.185;
      const brim = new THREE.CylinderGeometry(brimR, brimR * 1.02, 0.014, 48);
      g.add(place(make(brim, straw), [0, 0.268, 0], [0.05, 0, 0], [1, 1, Z]));
      const edge = new THREE.TorusGeometry(brimR * 0.99, 0.010, 8, 56);
      edge.rotateX(Math.PI / 2);
      g.add(place(make(edge, strawDark), [0, 0.268, 0], [0.05, 0, 0], [1, 1, Z]));
      const crownR = ctx.headRadius(0.34) + 0.032;
      const crown = new THREE.SphereGeometry(crownR, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.58);
      crown.scale(1, 1.15, Z);
      g.add(place(make(crown, straw), [0, 0.272, 0]));
      const rib = new THREE.TorusGeometry(crownR * 0.98, 0.013, 8, 40);
      rib.rotateX(Math.PI / 2);
      g.add(place(make(rib, band), [0, 0.300, 0], [0, 0, 0], [1, 1, Z]));
      break;
    }
    case 'hood': {
      const felt = createAccMaterial(c1, { spec: 0.05, rough: 0.95, rim: 0.32 });
      const Z = ctx.zScale;
      const y0 = 0.150;
      // 头套本体：从头两侧包到后脑，前面留出脸
      g.add(make(headShell(ctx, y0, 0.036, { y1: 0.420, dome: 0.105, segs: 30 }), felt));
      // 面部开口的卷边（前倾，像头套的收口）
      const roll = new THREE.TorusGeometry(ctx.headRadius(y0) + 0.040, 0.040, 14, 46);
      roll.rotateX(Math.PI / 2);
      roll.scale(1, 1, Z);
      g.add(place(make(roll, felt), [0, y0 + 0.010, 0.010]));
      // 卷边上的缝线
      g.add(beadRing(ctx.headRadius(y0) + 0.040, y0 + 0.038, 46, 0.0055, createAccMaterial('#f4ead6', { spec: 0.05, rough: 0.9 }), Z));
      // 两只蛙眼：底座 + 眼白 + 瞳孔 + 高光
      for (const s2 of [-1, 1] as const) {
        const ex = s2 * 0.215;
        const ey = y0 + 0.255;
        const ez = 0.12;
        g.add(place(make(new THREE.SphereGeometry(0.125, 20, 16), felt), [ex, ey - 0.020, ez], [0, 0, 0], [1, 1, 0.95]));
        g.add(place(make(new THREE.SphereGeometry(0.098, 20, 16), createAccMaterial('#f8faf0', { spec: 0.35, rough: 0.4 })), [ex, ey + 0.010, ez + 0.045], [0, 0, 0], [1, 0.95, 0.8]));
        g.add(place(make(new THREE.SphereGeometry(0.052, 16, 12), createAccMaterial('#2a2a24', { spec: 0.6, rough: 0.2 })), [ex, ey + 0.012, ez + 0.108], [0, 0, 0], [1, 1.1, 0.5]));
        g.add(place(make(new THREE.SphereGeometry(0.018, 10, 8), createAccMaterial('#ffffff', { spec: 1, opacity: 0.85 })), [ex - 0.024, ey + 0.042, ez + 0.126]));
      }
      // 头顶前缘的两个鼻孔
      for (const s2 of [-1, 1] as const) {
        g.add(place(make(new THREE.SphereGeometry(0.013, 10, 8), createAccMaterial('#2a3a2a', { spec: 0.2, rough: 0.8 })), [s2 * 0.045, 0.395, 0.36]));
      }
      break;
    }
    case 'earband': {
      // 发箍跨过头顶（不再是横着套一圈，那样会整条陷进后脑）
      g.add(make(crownBandGeo(ctx, 0.232, 0.036, 0.028), main));
      for (const s of [-1, 1] as const) {
        const ear = make(new THREE.ConeGeometry(0.078, 0.160, 4), main);
        place(ear, [s * 0.158, 0.470, 0.0], [0, Math.PI / 4, -s * 0.22], [1, 1, 0.70]);
        g.add(ear);
        g.add(
          place(
            make(new THREE.ConeGeometry(0.044, 0.094, 4), trim),
            [s * 0.158, 0.460, 0.020],
            [0, Math.PI / 4, -s * 0.22],
            [1, 1, 0.48],
          ),
        );
      }
      break;
    }
    case 'antler': {
      for (const s of [-1, 1] as const) {
        const base: [number, number, number] = [s * 0.18, 0.30, -0.02];
        const mid: [number, number, number] = [s * 0.26, 0.43, -0.03];
        const top: [number, number, number] = [s * 0.22, 0.56, 0.0];
        g.add(make(taperTube([base, mid, top], 0.030, 0.016, 12, 6), main));
        g.add(
          make(
            taperTube(
              [
                [s * 0.245, 0.395, -0.025],
                [s * 0.36, 0.455, -0.02],
                [s * 0.40, 0.525, 0.0],
              ],
              0.020,
              0.010,
              10,
              6,
            ),
            main,
          ),
        );
        g.add(
          make(
            taperTube(
              [
                [s * 0.225, 0.48, -0.02],
                [s * 0.30, 0.545, 0.0],
                [s * 0.29, 0.60, 0.03],
              ],
              0.017,
              0.009,
              10,
              6,
            ),
            main,
          ),
        );
      }
      // 根部皮套 + 尖端小球：不像两根光秃秃的棍子
      for (const s2 of [-1, 1] as const) {
        // 皮套放在鹿角露出头皮的位置，才看得见
        const cuff = make(new THREE.CylinderGeometry(0.046, 0.050, 0.050, 14), trim);
        place(cuff, [s2 * 0.236, 0.452, -0.02], [0, 0, s2 * 0.30]);
        g.add(cuff);
        g.add(place(make(new THREE.SphereGeometry(0.019, 12, 10), trim), [s2 * 0.22, 0.565, 0.0]));
        g.add(place(make(new THREE.SphereGeometry(0.016, 12, 10), trim), [s2 * 0.40, 0.528, 0.0]));
        g.add(place(make(new THREE.SphereGeometry(0.014, 12, 10), trim), [s2 * 0.29, 0.604, 0.03]));
      }
      g.add(make(crownBandGeo(ctx, 0.242, 0.013, 0.020), trim));
      break;
    }
    case 'sailorCap': {
      buildSailorFine(g, ctx, c1, c2);
      break;
    }
    case 'bunnyEars': {
      buildBunnyFine(g, ctx, c1, c2);
      break;
    }
    case 'cowboyHat': {
      buildCowboyFine(g, ctx, c1, c2);
      break;
    }
    case 'hoodie': {
      buildHoodieFine(g, ctx, c1, c2);
      break;
    }
    case 'crown': {
      buildCrownFine(g, ctx, c1, c2);
      break;
    }
    case 'nightcap': {
      buildNightcapFine(g, ctx, c1, c2);
      break;
    }
    case 'earmuff': {
      const faux = createAccMaterial('#8a6a52', { spec: 0.03, rough: 0.98, rim: 0.3 });
      const bandMat = createAccMaterial(c1, { spec: 0.16, rough: 0.6 });
      const metal = createAccMaterial('#b9c2ce', { spec: 0.8, rough: 0.25 });
      const Z = ctx.zScale;
      // 头带：绕过头顶的细带
      const band = new THREE.TorusGeometry(ctx.headRadius(0.30) + 0.048, 0.024, 10, 48, Math.PI);
      band.rotateY(Math.PI / 2);
      g.add(place(make(band, bandMat), [0, 0.300, 0], [0, 0, Math.PI / 2]));
      // 两侧罩杯
      for (const s2 of [-1, 1] as const) {
        const x = s2 * (ctx.headRadius(0.185) + 0.036);
        const grp = new THREE.Group();
        // 罩体
        grp.add(place(make(new THREE.SphereGeometry(0.150, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), bandMat), [0, 0, 0], [0, 0, s2 * Math.PI / 2], [0.62, 1, 1]));
        // 毛绒耳垫
        grp.add(place(make(new THREE.TorusGeometry(0.112, 0.045, 14, 34), faux), [s2 * -0.030, 0, 0], [0, Math.PI / 2, 0]));
        // 罩面外圈
        grp.add(place(make(new THREE.TorusGeometry(0.138, 0.016, 10, 34), bandMat), [s2 * 0.028, 0, 0], [0, Math.PI / 2, 0]));
        // 滑扣
        grp.add(place(make(roundedBox(0.036, 0.055, 0.030, 0.010, 2), metal), [s2 * -0.010, 0.130, 0]));
        place(grp, [x, 0.190, 0.02], [0, 0, 0], [1, 1, 1]);
        g.add(grp);
      }
      break;
    }
    case 'sunhat': {
      g.add(make(headShell(ctx, 0.262, 0.026, { y1: 0.428, dome: 0.100, segs: 24 }), main));
      const R = ctx.headRadius(0.286) + 0.05;
      const brim = make(new THREE.CylinderGeometry(R * 1.62, R * 1.68, 0.018, 34), trim);
      place(brim, [0, 0.286, 0], [0, 0, 0], [1, 1, ctx.zScale]);
      g.add(brim);
      // 帽檐编织纹：三圈同心细线
      for (const k of [1.22, 1.42, 1.58]) {
        g.add(
          place(
            make(new THREE.TorusGeometry(R * k, 0.0065, 8, 54), trim),
            [0, 0.306, 0],
            [Math.PI / 2, 0, 0],
            [1, 1, ctx.zScale],
          ),
        );
      }
      // 放射方向的编条
      for (let i = 0; i < 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        g.add(
          seamTube(
            [
              [Math.sin(a) * R * 1.16, 0.306, Math.cos(a) * R * 1.16 * ctx.zScale],
              [Math.sin(a) * R * 1.64, 0.300, Math.cos(a) * R * 1.64 * ctx.zScale],
            ],
            0.0055,
            0.0055,
            trim,
            6,
            4,
          ),
        );
      }
      g.add(make(headRing(ctx, 0.312, 0.022, 0.030), main));
      // 缎带 + 侧蝴蝶结
      const ribbon = createAccMaterial(c2, { spec: 0.34, rough: 0.4 });
      g.add(make(headRing(ctx, 0.318, 0.034, 0.020, 12), ribbon));
      for (const s2 of [-1, 1] as const) {
        g.add(
          place(
            make(roundedBox(0.10, 0.055, 0.030, 0.020, 3), ribbon),
            [0.30 + s2 * 0.045, 0.318, 0.16],
            [0.1, s2 * 0.5, s2 * 0.3],
          ),
        );
      }
      g.add(place(make(new THREE.SphereGeometry(0.026, 14, 10), ribbon), [0.30, 0.318, 0.16]));
      g.add(make(headRing(ctx, 0.304, -0.006, 0.024, 10), createAccMaterial(c2, { spec: 0.04, rough: 0.95 })));
      break;
    }
    case 'beret': {
      // 帽体：双层毡（外层 + 稍小的内层，做出厚度）
      const dome = make(headShell(ctx, 0.264, 0.040, { y1: 0.408, dome: 0.135, segs: 28 }), soft);
      place(dome, [0, 0.004, 0], [0, 0, 0]);
      g.add(dome);
      const innerFelt = make(headShell(ctx, 0.270, 0.020, { y1: 0.400, dome: 0.110, segs: 22 }), createAccMaterial(c1, { spec: 0.03, rough: 0.98 }));
      place(innerFelt, [0, 0.006, 0], [0, 0, 0]);
      g.add(innerFelt);
      // 顶蒂：小圆柄 + 圆头（参考图里那个小揪）
      g.add(place(make(new THREE.CylinderGeometry(0.013, 0.015, 0.030, 12), main), [0, 0.532, 0]));
      g.add(place(make(new THREE.SphereGeometry(0.021, 14, 12), main), [0, 0.548, 0], [0, 0, 0], [1, 0.85, 1]));
      // 帽冠上的一圈软褶
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        const pts: Array<[number, number, number]> = [];
        for (let k = 0; k <= 3; k += 1) {
          const t = k / 3;
          const y = mix(0.270, 0.492, t);
          const r = (ctx.headRadius(y) + 0.034) * (1 - 0.30 * t * t);
          pts.push([Math.sin(a) * r + 0.030 * t, y, Math.cos(a) * r * ctx.zScale]);
        }
        g.add(seamTube(pts, 0.0085, 0.0055, soft, 10, 5));
      }
      // 顶扣：小柄 + 圆帽
      g.add(place(make(new THREE.CylinderGeometry(0.010, 0.010, 0.018, 10), trim), [-0.10, 0.384, 0.03]));
      g.add(place(make(new THREE.SphereGeometry(0.030, 16, 12), trim), [-0.10, 0.400, 0.03], [0, 0, 0], [1, 0.72, 1]));
      // 皮质帽箍（比毡体更窄更硬）+ 两道缝线
      const leather = createAccMaterial('#5a3626', { spec: 0.35, rough: 0.42 });
      g.add(make(headRing(ctx, 0.266, 0.008, 0.038, 18), leather));
      g.add(beadRing(ctx.headRadius(0.266) + 0.046, 0.278, 46, 0.0048, createAccMaterial('#d8c8a8', { spec: 0.1, rough: 0.8 }), ctx.zScale));
      g.add(beadRing(ctx.headRadius(0.266) + 0.046, 0.254, 46, 0.0048, createAccMaterial('#d8c8a8', { spec: 0.1, rough: 0.8 }), ctx.zScale));
      // 帽边缝线（小珠），贴着帽边不往外扎
      g.add(place(make(headRing(ctx, 0.266, 0.000, 0.014, 12), createAccMaterial('#4a2c1e', { spec: 0.2, rough: 0.7 })), [0, -0.030, 0]));
      break;
    }
    case 'helmet': {
      g.add(make(headShell(ctx, 0.196, 0.030, { y1: 0.436, dome: 0.115, segs: 26 }), main));
      g.add(make(headRing(ctx, 0.204, 0.036, 0.030, 16), trim));
      const visor = make(
        facePatch(ctx, -0.34, 0.34, 0.030, 0.225, 0.048, 12),
        createAccMaterial(c2, { spec: 0.55, opacity: 0.46 }),
      );
      g.add(visor);
      const ridge = make(new THREE.TorusGeometry(0.30, 0.024, 10, 26, Math.PI), trim);
      place(ridge, [0, 0.320, 0], [0, Math.PI / 2, 0], [1, 1, 0.55]);
      g.add(ridge);
      // 三条通风槽（深色内凹）
      const vent = createAccMaterial('#1e242c', { spec: 0.08, rough: 0.9 });
      for (const dx of [-0.16, 0, 0.16]) {
        g.add(place(make(roundedBox(0.058, 0.014, 0.18, 0.010, 2), vent), [dx, 0.410, 0.02], [0.2, 0, 0]));
      }
      // 侧铰链 + 下巴带
      for (const s2 of [-1, 1] as const) {
        g.add(place(make(new THREE.CylinderGeometry(0.028, 0.028, 0.014, 16), trim), [s2 * 0.330, 0.238, 0.02], [0, 0, Math.PI / 2]));
      }
      g.add(
        make(
          taperTube(
            [
              [-0.33, 0.24, 0.02],
              [-0.22, 0.02, 0.10],
              [0.22, 0.02, 0.10],
              [0.33, 0.24, 0.02],
            ],
            0.012,
            0.012,
            16,
            6,
          ),
          createAccMaterial('#2a2f38', { spec: 0.1, rough: 0.8 }),
        ),
      );
      break;
    }
    case 'wreath': {
      const R = ctx.headRadius(0.300) + 0.050;
      const leafMat = createAccMaterial('#5f9a52', { spec: 0.12 });
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        const x = Math.sin(a) * R;
        const z = Math.cos(a) * R * ctx.zScale;
        const flower = make(new THREE.SphereGeometry(0.060, 10, 8), i % 2 ? main : trim);
        g.add(place(flower, [x, 0.312 + Math.sin(i * 1.7) * 0.016, z], [0, 0, 0], [1, 0.78, 1]));
        const leaf = make(new THREE.SphereGeometry(0.048, 12, 8), leafMat);
        g.add(place(leaf, [x * 1.03, 0.292, z * 1.03], [0, -a, 0], [1, 0.40, 0.62]));
        // 叶脉
        g.add(seamTube([[x * 1.03, 0.292, z * 1.03], [x * 1.12, 0.286, z * 1.12]], 0.0045, 0.003, leafMat, 4, 4));
        // 浆果
        if (i % 3 === 1) {
          g.add(place(make(new THREE.SphereGeometry(0.026, 12, 10), createAccMaterial('#c23a4a', { spec: 0.45, rough: 0.3 })), [x * 0.98, 0.336, z * 0.98]));
        }
      }
      // 后方缎带
      for (const s2 of [-1, 1] as const) {
        g.add(
          make(
            taperTube(
              [
                [0, 0.300, -R * 1.02],
                [s2 * 0.10, 0.255, -R * 1.16],
                [s2 * 0.16, 0.195, -R * 1.10],
              ],
              0.024,
              0.014,
              10,
              6,
            ),
            trim,
          ),
        );
      }
      break;
    }
    case 'pumpkin': {
      g.add(make(headShell(ctx, 0.246, 0.072, { y1: 0.392, segs: 16 }), soft));
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        const rib = make(new THREE.TorusGeometry(ctx.headRadius(0.30) + 0.076, 0.015, 6, 16, Math.PI), trim);
        place(rib, [0, 0.245, 0], [0, a, 0], [1, 1, 0.92]);
        g.add(rib);
      }
      const stemMat = createAccMaterial('#4d7a3a', { spec: 0.16, rough: 0.8 });
      g.add(place(make(new THREE.CylinderGeometry(0.028, 0.042, 0.095, 12), stemMat), [0, 0.470, 0], [0, 0, 0.12]));
      // 柄上的棱
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        g.add(place(make(new THREE.CapsuleGeometry(0.006, 0.080, 4, 6), stemMat), [Math.sin(a) * 0.032, 0.470, Math.cos(a) * 0.032], [0, 0, 0.12]));
      }
      // 卷须
      g.add(
        make(
          taperTube(
            [
              [0.030, 0.492, 0.02],
              [0.105, 0.520, 0.06],
              [0.160, 0.470, 0.10],
              [0.130, 0.430, 0.14],
            ],
            0.011,
            0.005,
            16,
            5,
          ),
          stemMat,
        ),
      );
      // 叶子
      const leaf2 = make(new THREE.SphereGeometry(0.085, 16, 10), stemMat);
      place(leaf2, [-0.085, 0.452, 0.06], [0.1, 0, 0.5], [1.35, 0.16, 0.72]);
      g.add(leaf2);
      break;
    }
    default:
      return g;
  }
  return g;
}

// ---------------------------------------------------------------- 面部

/** 沿脸部曲面铺一条宽度渐变的带子（眼线 / 眼影 / 纱边） */
function faceRibbon(
  ctx: Acc3DCtx,
  pts: Array<[number, number]>,
  widths: number[],
  zOff: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const [x, y] = pts[i];
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(n - 1, i + 1)];
    let tx = p1[0] - p0[0];
    let ty = p1[1] - p0[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;
    const hw = Math.max(0.0015, widths[i]) * 0.5;
    const ax = x + nx * hw;
    const ay = y + ny * hw;
    const bx = x - nx * hw;
    const by = y - ny * hw;
    pos.push(ax, ay, ctx.surfaceZ(ax, ay) + zOff);
    pos.push(bx, by, ctx.surfaceZ(bx, by) + zOff);
  }
  for (let i = 0; i < n - 1; i += 1) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function starShapePath(R: number, r: number, points = 5): THREE.Shape {
  const sh = new THREE.Shape();
  for (let i = 0; i < points * 2; i += 1) {
    const rad = i % 2 ? r : R;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad;
    if (i === 0) sh.moveTo(px, py);
    else sh.lineTo(px, py);
  }
  sh.closePath();
  return sh;
}

/** 腮红贴：三层叠加的粉雾 + 细小闪粉，边缘自然过渡而不是一块平板 */
function buildBlushFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const shimmer = createAccMaterial(c2, { spec: 0.55, opacity: 0.55, rim: 0.15, rough: 0.35 });
  for (const s of [-1, 1] as const) {
    const cx = s * 0.232;
    const cy = -0.072;
    const layers: Array<[number, number, number]> = [
      [0.122, 0.20, 0.012],
      [0.088, 0.30, 0.015],
      [0.052, 0.40, 0.018],
    ];
    for (const [rr, op, z] of layers) {
      g.add(
        make(
          facePatch(ctx, cx - rr, cx + rr, cy - rr * 0.66, cy + rr * 0.66, z, 12),
          createAccMaterial(c1, { spec: 0.04, opacity: op, rim: 0.05, rough: 0.92 }),
        ),
      );
    }
    // 闪粉：固定分布，不闪烁
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2 + 0.4;
      const rr = 0.085 * Math.sqrt(((i % 4) + 1) / 4);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.62;
      g.add(
        place(
          make(new THREE.SphereGeometry(0.0055, 8, 6), shimmer),
          [x, y, ctx.surfaceZ(x, y) + 0.022],
        ),
      );
    }
  }
}

/** 猫眼美瞳：淡色镜片 + 角膜环 + 外眼角三根短睫，不遮瞳孔 */
function buildCatEyeLensFine(
  g: THREE.Group,
  ctx: Acc3DCtx,
  c1: string,
  c2: string,
  EX: number,
  EY: number,
): void {
  const glass = createAccMaterial(c1, { spec: 0.95, opacity: 0.16, rim: 0.5, rough: 0.08 });
  const rim = createAccMaterial(c2, { spec: 0.7, opacity: 0.42, rim: 0.3, rough: 0.22 });
  const glint = createAccMaterial('#ffffff', { spec: 1, opacity: 0.75, rim: 0.2, rough: 0.05 });
  for (const s of [-1, 1] as const) {
    const x = s * EX;
    const z = ctx.surfaceZ(x, EY) + 0.030;
    g.add(place(make(new THREE.CircleGeometry(0.150, 34), glass), [x, EY, z], [0, 0, 0], [1, 0.88, 1]));
    g.add(
      place(make(new THREE.TorusGeometry(0.148, 0.0062, 10, 36), rim), [x, EY, z + 0.002], [0, 0, 0], [1, 0.88, 1]),
    );
    // 镜片内侧一圈更淡的过渡，避免边缘像贴纸
    g.add(
      place(
        make(new THREE.TorusGeometry(0.128, 0.014, 8, 32), createAccMaterial(c1, { spec: 0.8, opacity: 0.16, rough: 0.1 })),
        [x, EY, z - 0.002],
        [0, 0, 0],
        [1, 0.88, 1],
      ),
    );
    // 高光：左上一小段弧
    g.add(
      place(
        make(new THREE.TorusGeometry(0.096, 0.006, 6, 18, Math.PI * 0.42), glint),
        [x - s * 0.014, EY + 0.024, z + 0.006],
        [0, 0, Math.PI * 0.62],
      ),
    );
    // 外眼角短睫（三根，向外上挑）
    for (let i = 0; i < 3; i += 1) {
      const px = x + s * (0.128 + i * 0.008);
      const py = EY + 0.055 + i * 0.026;
      g.add(
        seamTube(
          [
            [px, py, ctx.surfaceZ(px, py) + 0.032],
            [px + s * 0.040, py + 0.028, ctx.surfaceZ(px + s * 0.04, py + 0.028) + 0.020],
            [px + s * 0.066, py + 0.062, ctx.surfaceZ(px + s * 0.066, py + 0.062) + 0.008],
          ],
          0.007,
          0.0028,
          rim,
          10,
          5,
        ),
      );
    }
  }
}

/** 贴纸类：雪花 / 星星 / 泪滴，靠商品 id 区分，不再一律画星星 */
function buildStickerFine(
  g: THREE.Group,
  ctx: Acc3DCtx,
  c1: string,
  c2: string,
  id: string,
  EX: number,
  EY: number,
): void {
  const glossy = createAccMaterial(c1, { spec: 0.85, opacity: 0.9, rim: 0.35, rough: 0.16 });
  const edge = createAccMaterial(c2, { spec: 0.5, opacity: 0.95, rim: 0.25, rough: 0.3 });
  const glint = createAccMaterial('#ffffff', { spec: 1, opacity: 0.8, rough: 0.05 });

  if (id.includes('face_14')) {
    // 雪花贴：六臂冰晶，每臂两对分枝 + 中心六边形
    const flake = (cx: number, cy: number, R: number) => {
      const zOf = (x: number, y: number) => ctx.surfaceZ(x, y) + 0.018;
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const ex = cx + Math.cos(a) * R;
        const ey = cy + Math.sin(a) * R;
        g.add(
          make(
            taperTube(
              [
                [cx, cy, zOf(cx, cy)],
                [mix(cx, ex, 0.55), mix(cy, ey, 0.55), zOf(mix(cx, ex, 0.55), mix(cy, ey, 0.55)) + 0.004],
                [ex, ey, zOf(ex, ey)],
              ],
              0.0095,
              0.0042,
              12,
              5,
            ),
            glossy,
          ),
        );
        for (const t of [0.52, 0.78] as const) {
          const bx = mix(cx, ex, t);
          const by = mix(cy, ey, t);
          const bl = R * (0.26 - t * 0.12);
          for (const sgn of [-1, 1] as const) {
            const a2 = a + sgn * 0.68;
            const tx = bx + Math.cos(a2) * bl;
            const ty = by + Math.sin(a2) * bl;
            g.add(
              make(
                taperTube(
                  [
                    [bx, by, zOf(bx, by) + 0.002],
                    [tx, ty, zOf(tx, ty)],
                  ],
                  0.0055,
                  0.0022,
                  6,
                  4,
                ),
                glossy,
              ),
            );
          }
        }
      }
      g.add(place(make(new THREE.CylinderGeometry(R * 0.16, R * 0.16, 0.012, 6), edge), [cx, cy, zOf(cx, cy) + 0.006]));
      g.add(place(make(new THREE.SphereGeometry(R * 0.055, 10, 8), glint), [cx - R * 0.02, cy + R * 0.03, zOf(cx, cy) + 0.016]));
    };
    flake(-0.315, 0.018, 0.085);
    flake(0.315, 0.018, 0.085);
    flake(0.352, -0.135, 0.045);
    return;
  }

  if (id.includes('face_15')) {
    // 泪滴贴：右眼下一滴，尖端朝上、圆底朝下，带白色贴纸描边
    const cx = EX + 0.030;
    const cy = -0.012;
    const z = ctx.surfaceZ(cx, cy) + 0.020;
    const shp = tearShapePath(0.105);
    const backing = make(new THREE.ExtrudeGeometry(shp, { depth: 0.006, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.003, bevelSegments: 2, curveSegments: 16 }), edge);
    place(backing, [cx, cy, z], [0, 0, 0.16], [1.16, 1.16, 1]);
    g.add(backing);
    const drop = make(new THREE.ExtrudeGeometry(tearShapePath(0.096), { depth: 0.010, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 16 }), glossy);
    place(drop, [cx, cy, z + 0.006], [0, 0, 0.16]);
    g.add(drop);
    g.add(place(make(new THREE.SphereGeometry(0.014, 10, 8), glint), [cx - 0.020, cy - 0.020, z + 0.020], [0, 0, 0], [1, 0.7, 0.5]));
    return;
  }

  // 星星眼贴：五角星贴片，底下垫一层深色贴纸边
  for (const s of [-1, 1] as const) {
    const x = s * (EX + 0.036);
    const y = -0.052;
    const z = ctx.surfaceZ(x, y) + 0.018;
    const inner = make(
      new THREE.ExtrudeGeometry(starShapePath(0.062, 0.026), {
        depth: 0.010,
        bevelEnabled: true,
        bevelSize: 0.004,
        bevelThickness: 0.003,
        bevelSegments: 2,
      }),
      glossy,
    );
    place(inner, [x, y, z], [0, 0, s * 0.18]);
    g.add(inner);
    g.add(
      place(
        make(new THREE.ExtrudeGeometry(starShapePath(0.070, 0.030), { depth: 0.004, bevelEnabled: false }), edge),
        [x, y, z - 0.006],
        [0, 0, s * 0.18],
      ),
    );
    g.add(place(make(new THREE.SphereGeometry(0.009, 8, 6), glint), [x - 0.012, y + 0.014, z + 0.014], [0, 0, 0], [1, 0.7, 0.5]));
  }
}

function tearShapePath(s: number): THREE.Shape {
  const sh = new THREE.Shape();
  sh.moveTo(0, s * 0.92);
  sh.bezierCurveTo(s * 0.46, s * 0.26, s * 0.42, -s * 0.22, 0, -s * 0.54);
  sh.bezierCurveTo(-s * 0.42, -s * 0.22, -s * 0.46, s * 0.26, 0, s * 0.92);
  return sh;
}

/** 单片眼镜：金丝双圈 + 螺钉 + 垂到领口的珠链 + 镜面高光 */
function buildMonocleFine(
  g: THREE.Group,
  ctx: Acc3DCtx,
  frame: THREE.Material,
  c2: string,
  EX: number,
  EY: number,
  frontZ: (x: number, y: number) => number,
): void {
  const z = frontZ(EX, EY) + 0.058;
  const gold = createAccMaterial(c2, { spec: 0.9, rough: 0.18 });
  g.add(place(make(new THREE.TorusGeometry(0.150, 0.0145, 12, 32), frame), [EX, EY, z], [0, 0, 0], [1, 0.98, 1]));
  g.add(place(make(new THREE.TorusGeometry(0.135, 0.0055, 8, 30), gold), [EX, EY, z + 0.004], [0, 0, 0], [1, 0.98, 1]));
  g.add(
    place(
      make(new THREE.CircleGeometry(0.146, 30), createAccMaterial('#cfe4ee', { spec: 0.95, opacity: 0.22, rim: 0.6, rough: 0.05 })),
      [EX, EY, z - 0.006],
      [0, 0, 0],
      [1, 0.98, 1],
    ),
  );
  // 三颗固定螺钉
  for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.15] as const) {
    g.add(
      place(
        make(new THREE.SphereGeometry(0.010, 10, 8), gold),
        [EX + Math.cos(a) * 0.150, EY + Math.sin(a) * 0.147, z + 0.005],
        [0, 0, 0],
        [1, 1, 0.6],
      ),
    );
  }
  // 镜面斜高光
  g.add(
    place(
      make(new THREE.CapsuleGeometry(0.006, 0.10, 4, 6), createAccMaterial('#ffffff', { spec: 1, opacity: 0.55, rough: 0.05 })),
      [EX - 0.038, EY + 0.030, z + 0.008],
      [0, 0, Math.PI * 0.72],
    ),
  );
  // 吊环 + 珠链：从镜框下沿垂到领口
  const ringZ = frontZ(EX + 0.12, EY - 0.10);
  g.add(place(make(new THREE.TorusGeometry(0.016, 0.006, 8, 14), gold), [EX + 0.122, EY - 0.104, ringZ + 0.050], [0, 0, 0]));
  const chain: Array<[number, number, number]> = [
    [EX + 0.150, EY - 0.150, ringZ + 0.030],
    [EX + 0.230, EY - 0.250, frontZ(EX + 0.230, EY - 0.250) + 0.022],
    [EX + 0.250, EY - 0.360, frontZ(EX + 0.250, EY - 0.360) + 0.020],
    [EX + 0.215, EY - 0.470, frontZ(EX + 0.215, EY - 0.470) + 0.018],
  ];
  const beads = beadRing(1, 0, 1, 0.011, gold);
  beads.clear();
  const geo = new THREE.SphereGeometry(0.011, 10, 8);
  const curve = new THREE.CatmullRomCurve3(chain.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  for (let i = 0; i <= 16; i += 1) {
    const p = curve.getPoint(i / 16);
    beads.add(place(new THREE.Mesh(geo, gold), [p.x, p.y, p.z], [0, 0, 0], [1, 1, 0.85]));
  }
  g.add(beads);
}

/** 猫须贴：根部小珠 + 三根加长须，沿脸颊弧度向前，不穿模 */
function buildWhiskerStickerFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const hair = createAccMaterial(c1, { spec: 0.35, opacity: 0.95, rim: 0.25, rough: 0.4 });
  const bead = createAccMaterial(c2, { spec: 0.6, rough: 0.3 });
  for (const s of [-1, 1] as const) {
    for (let i = 0; i < 3; i += 1) {
      const y0 = -0.045 - i * 0.040;
      const x0 = s * 0.315;
      const x1 = s * 0.455;
      const y1 = y0 - 0.010 - i * 0.012;
      const x2 = s * 0.600;
      const y2 = y0 - 0.030 - i * 0.022;
      g.add(
        make(
          taperTube(
            [
              [x0, y0, ctx.surfaceZ(x0, y0) + 0.022],
              [x1, y1, ctx.surfaceZ(x1, y1) + 0.014],
              [x2, y2, ctx.surfaceZ(x2, y2) + 0.004],
            ],
            0.0095,
            0.0035,
            14,
            5,
          ),
          hair,
        ),
      );
      g.add(
        place(
          make(new THREE.SphereGeometry(0.013, 10, 8), bead),
          [x0, y0, ctx.surfaceZ(x0, y0) + 0.026],
          [0, 0, 0],
          [1, 0.8, 0.7],
        ),
      );
    }
  }
}

/** 眼线贴：沿上眼睑的渐细带 + 外眼角上扬的飞线 */
function buildEyelinerFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, EX: number, EY: number): void {
  const ink = createAccMaterial(`#${new THREE.Color(c1).multiplyScalar(0.55).getHexString()}`, { spec: 0.22, opacity: 0.95, rim: 0.12, rough: 0.5 });
  for (const s of [-1, 1] as const) {
    const pts: Array<[number, number]> = [];
    const widths: number[] = [];
    const N = 10;
    for (let i = 0; i <= N; i += 1) {
      const t = i / N;
      const x = s * mix(EX - 0.172, EX + 0.176, t);
      const u = Math.max(-0.96, Math.min(0.96, (x - s * EX) / 0.182));
      const lid = EY + 0.118 * Math.sqrt(Math.max(0, 1 - u * u)) + 0.004;
      const y = lid + Math.sin(t * Math.PI) * 0.008 + t * t * 0.020;
      pts.push([x, y]);
      widths.push(mix(0.014, 0.044, t) * (1 - Math.pow(t, 6) * 0.35));
    }
    // 飞线：从外眼角抡出去
    const tipX = s * (EX + 0.262);
    const tipY = EY + 0.200;
    pts.push([s * (EX + 0.222), EY + 0.150], [tipX, tipY]);
    widths.push(0.020, 0.0035);
    g.add(make(faceRibbon(ctx, pts, widths, 0.050), ink));
    // 下眼睑一小段内眼线
    const lowPts: Array<[number, number]> = [];
    const lowW: number[] = [];
    for (let i = 0; i <= 5; i += 1) {
      const t = i / 5;
      lowPts.push([s * mix(EX - 0.10, EX + 0.10, t), EY - 0.098 - Math.sin(t * Math.PI) * 0.012]);
      lowW.push(mix(0.004, 0.010, Math.sin(t * Math.PI)));
    }
    g.add(make(faceRibbon(ctx, lowPts, lowW, 0.048), ink));
  }
}

/** 彩虹眼影：三道由深到浅的色带 + 细闪，贴着眼窝弧度 */
function buildEyeshadowFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string, EX: number, EY: number): void {
  const light = `#${new THREE.Color(c1).lerp(new THREE.Color('#ffffff'), 0.45).getHexString()}`;
  const bands: Array<[number, number, string, number]> = [
    [0.122, 0.048, c1, 0.34],
    [0.160, 0.043, c2, 0.28],
    [0.196, 0.038, light, 0.24],
  ];
  for (const s of [-1, 1] as const) {
    for (const [yOff, w, col, op] of bands) {
      const pts: Array<[number, number]> = [];
      const widths: number[] = [];
      for (let i = 0; i <= 8; i += 1) {
        const t = i / 8;
        const x = s * mix(EX - 0.175, EX + 0.185, t);
        const y = EY + yOff + Math.sin(t * Math.PI) * 0.026 - t * 0.020;
        pts.push([x, y]);
        widths.push(w * (0.35 + Math.sin(t * Math.PI) * 0.75));
      }
      g.add(make(faceRibbon(ctx, pts, widths, 0.046), createAccMaterial(col, { spec: 0.4, opacity: op, rim: 0.2, rough: 0.5 })));
    }
    // 细闪
    const glint = createAccMaterial('#ffffff', { spec: 1, opacity: 0.55, rough: 0.1 });
    for (let i = 0; i < 6; i += 1) {
      const t = (i + 0.5) / 6;
      const x = s * mix(EX - 0.13, EX + 0.15, t);
      const y = EY + 0.118 + Math.sin(t * Math.PI) * 0.03;
      g.add(place(make(new THREE.SphereGeometry(0.0055, 8, 6), glint), [x, y, ctx.surfaceZ(x, y) + 0.032]));
    }
  }
}

/** 面纱：薄纱 + 蕾丝点阵 + 扇贝边 + 头顶纱箍，轻微飘动 */
function buildVeilFine(g: THREE.Group, ctx: Acc3DCtx, c1: string, c2: string): void {
  const pivot = new THREE.Group();
  pivot.position.set(0, 0.286, 0);
  const inner = new THREE.Group();
  inner.position.set(0, -0.286, 0);
  pivot.add(inner);
  markAnim(pivot, 'sway', 1, 0.5);
  g.add(pivot);

  const gauze = createAccMaterial(c1, { spec: 0.42, opacity: 0.22, rim: 0.6, rough: 0.35 });
  const lace = createAccMaterial(c2, { spec: 0.3, opacity: 0.8, rim: 0.3, rough: 0.55 });
  inner.add(make(facePatch(ctx, -0.470, 0.470, -0.360, 0.250, 0.062, 20), gauze));
  // 蕾丝点阵
  for (let xi = 0; xi < 11; xi += 1) {
    const x = -0.44 + xi * 0.088;
    for (let yi = 0; yi < 7; yi += 1) {
      const y = -0.33 + yi * 0.092;
      if (Math.abs(x) > 0.44 || y > 0.24) continue;
      const z = ctx.surfaceZ(x, y) + 0.064;
      inner.add(place(make(new THREE.SphereGeometry(0.0048, 8, 6), lace), [x, y, z], [0, 0, 0], [1, 1, 0.5]));
    }
  }
  // 扇贝下摆：一串小弧 + 珠边
  for (let i = 0; i < 9; i += 1) {
    const x = -0.40 + i * 0.10;
    const y = -0.352 - Math.sin((i / 8) * Math.PI) * 0.030;
    const z = ctx.surfaceZ(x, y) + 0.062;
    inner.add(place(make(new THREE.TorusGeometry(0.048, 0.0055, 6, 14, Math.PI), lace), [x, y + 0.010, z]));
  }
  // 顶部纱箍 + 侧边小结
  g.add(make(headRing(ctx, 0.268, 0.030, 0.018), lace));
  for (const s of [-1, 1] as const) {
    g.add(
      place(
        make(new THREE.SphereGeometry(0.030, 12, 10), lace),
        [s * 0.34, 0.300, 0.020],
        [0, 0, 0],
        [1.3, 0.9, 0.8],
      ),
    );
    g.add(
      make(
        taperTube(
          [
            [s * 0.36, 0.280, 0.030],
            [s * 0.40, 0.200, 0.060],
            [s * 0.38, 0.120, 0.080],
          ],
          0.010,
          0.005,
          10,
          5,
        ),
        lace,
      ),
    );
  }
}

function buildFace(shape: string, c1: string, c2: string, ctx: Acc3DCtx, id = ''): THREE.Group {
  const g = new THREE.Group();
  const frame = createAccMaterial(c1, { spec: 0.42, rim: 0.30 });
  const lens = createAccMaterial(c2, { spec: 0.55, opacity: 0.34, rim: 0.45 });
  const EYE_Y = 0.140;
  const EYE_X = 0.215;
  const frontZ = (x: number, y: number) => ctx.surfaceZ(x, y);

  switch (shape) {
    case 'glassesRound': {
      buildGlassesFine(g, ctx, frame, c2, lens);
      break;
    }
    case 'glassesHeart': {
      buildHeartGlasses(g, ctx, frame, c2, EYE_X, EYE_Y, frontZ);
      break;
    }
    case 'goggles': {
      buildGogglesFine(g, ctx, c1, c2, EYE_X, EYE_Y, frontZ);
      break;
    }
    case 'glassesPixel': {
      buildPixelShades(g, ctx, c1, EYE_X, EYE_Y, frontZ);
      break;
    }
    case 'eyePatch': {
      buildEyePatchFine(g, ctx, c1, c2, EYE_X, EYE_Y, frontZ);
      break;
    }
    case 'mask': {
      buildMaskFine(g, ctx, c1, c2, frontZ);
      break;
    }
    case 'blush': {
      buildBlushFine(g, ctx, c1, c2);
      break;
    }
    case 'eyewear': {
      buildCatEyeLensFine(g, ctx, c1, c2, EYE_X, EYE_Y);
      break;
    }
    case 'sticker': {
      buildStickerFine(g, ctx, c1, c2, id, EYE_X, EYE_Y);
      break;
    }
    case 'monocle': {
      buildMonocleFine(g, ctx, frame, c2, EYE_X, EYE_Y, frontZ);
      break;
    }
    case 'whiskerSticker': {
      buildWhiskerStickerFine(g, ctx, c1, c2);
      break;
    }
    case 'eyeliner': {
      buildEyelinerFine(g, ctx, c1, EYE_X, EYE_Y);
      break;
    }
    case 'eyeshadow': {
      buildEyeshadowFine(g, ctx, c1, c2, EYE_X, EYE_Y);
      break;
    }
    case 'veil': {
      buildVeilFine(g, ctx, c1, c2);
      break;
    }
    default:
      return g;
  }
  return g;
}

// ---------------------------------------------------------------- 颈部（neckMount 局部，半径以 collarR 为基准）

function buildNeck(shape: string, c1: string, c2: string, ctx: Acc3DCtx): THREE.Group {
  const g = new THREE.Group();
  const cloth = createAccMaterial(c1, { spec: 0.10, rim: 0.28 });
  const accent = createAccMaterial(c2, { spec: 0.30, rim: 0.30 });
  const R = ctx.collarR;
  const Z = ctx.zScale;

  const ring = (rr: number, tube: number, mat: THREE.Material, y = 0, scaleY = 1) => {
    const geo = new THREE.TorusGeometry(rr, tube, 10, 36);
    geo.rotateX(Math.PI / 2);
    geo.scale(1, scaleY, Z);
    return place(make(geo, mat), [0, y, 0]);
  };

  switch (shape) {
    case 'collarBell': {
      buildCollarFine(g, ctx, c1, c2);
      break;
    }
    case 'bowtie': {
      buildBowtieFine(g, ctx, c1, c2);
      break;
    }
    case 'scarf': {
      buildScarfFine(g, ctx, c1, c2);
      break;
    }
    case 'tie': {
      g.add(ring(R + 0.012, 0.022, cloth));
      const z = (R + 0.05) * Z;
      g.add(place(make(roundedBox(0.085, 0.075, 0.045, 0.018, 2), accent), [0, -0.045, z]));
      const blade = make(new THREE.ConeGeometry(0.075, 0.30, 4), cloth);
      place(blade, [0, -0.215, z - 0.005], [Math.PI, Math.PI / 4, 0], [1, 1, 0.34]);
      g.add(blade);
      // 领带中缝 + 尖端衬里
      g.add(seamTube([[0, -0.06, z + 0.012], [0, -0.30, z + 0.004]], 0.0055, 0.0045, accent, 10, 4));
      g.add(place(make(new THREE.ConeGeometry(0.052, 0.036, 4), accent), [0, -0.352, z - 0.004], [Math.PI, Math.PI / 4, 0], [1, 1, 0.30]));
      // 领结的压痕
      g.add(place(make(new THREE.SphereGeometry(0.020, 12, 10), accent), [0, -0.045, z + 0.026], [0, 0, 0], [1.6, 0.8, 0.5]));
      // 领带夹
      g.add(place(make(roundedBox(0.070, 0.018, 0.016, 0.008, 2), accent), [0.012, -0.155, z + 0.020], [0, 0, 0.08]));
      break;
    }
    case 'towel': {
      g.add(ring(R + 0.026, 0.055, cloth, 0.005, 1.02));
      const hang = make(roundedBox(0.18, 0.20, 0.05, 0.02, 3), cloth);
      g.add(place(hang, [-0.05, -0.15, (R + 0.03) * Z], [0.10, 0, -0.06]));
      // 下端包边 + 两道折痕
      g.add(place(make(roundedBox(0.19, 0.030, 0.055, 0.012, 2), accent), [-0.05, -0.248, (R + 0.028) * Z], [0.10, 0, -0.06]));
      for (const dy of [-0.10, -0.19]) {
        g.add(seamTube([[-0.14, dy, (R + 0.052) * Z], [0.04, dy - 0.008, (R + 0.050) * Z]], 0.0045, 0.0040, accent, 6, 4));
      }
      // 侧面小挂环
      g.add(place(make(new THREE.TorusGeometry(0.026, 0.008, 8, 16), accent), [0.10, -0.02, (R + 0.020) * Z], [0, Math.PI / 2, 0]));
      break;
    }
    case 'pearl': {
      const pearlMat = createAccMaterial(c2, { spec: 0.85, rough: 0.16, rim: 0.45 });
      const metal = createAccMaterial('#d8b45a', { spec: 0.9, rough: 0.2 });
      // 两串：外串长、内串短，符合真实项链的层次
      const strands: Array<[number, number, number]> = [
        [R + 0.012, -0.052, 0.034],
        [R + 0.008, -0.012, 0.025],
      ];
      for (let si = 0; si < strands.length; si += 1) {
        const [rr, yy, bead] = strands[si];
        const n = 26;
        for (let i = 0; i < n; i += 1) {
          const a = (i / n) * Math.PI * 2;
          // 后颈处收紧一点，看起来是挂在脖子上而不是一个圈
          const back = Math.cos(a) < 0 ? 0.86 : 1.0;
          g.add(
            place(
              make(new THREE.SphereGeometry(i % 2 === 0 ? bead : bead * 0.82, 16, 12), pearlMat),
              [Math.sin(a) * rr * back, yy + Math.sin(a * 2) * 0.003, Math.cos(a) * rr * Z * back],
            ),
          );
        }
      }
      // 后扣
      g.add(place(make(new THREE.TorusGeometry(0.024, 0.008, 8, 16), metal), [0, -0.032, -(R + 0.014) * Z * 0.9], [0, Math.PI / 2, 0]));
      // 前方大坠珠 + 金托
      g.add(place(make(new THREE.TorusGeometry(0.030, 0.007, 8, 18), metal), [0, -0.086, (R + 0.020) * Z], [Math.PI / 2, 0, 0]));
      const drop = make(new THREE.SphereGeometry(0.052, 20, 16), pearlMat);
      place(drop, [0, -0.128, (R + 0.022) * Z], [0, 0, 0], [0.9, 1.2, 0.75]);
      g.add(drop);
      g.add(place(make(new THREE.SphereGeometry(0.014, 10, 8), createAccMaterial('#ffffff', { spec: 1, opacity: 0.8 })), [-0.014, -0.108, (R + 0.048) * Z]));
      break;
    }
    case 'rainCollar': {
      // 雨衣领：向上外翻的喇叭口
      const flare = make(
        new THREE.CylinderGeometry(R + 0.20, R + 0.02, 0.24, 30, 1, true),
        cloth,
      );
      place(flare, [0, 0.055, 0], [0, 0, 0], [1, 1, Z]);
      g.add(flare);
      g.add(ring(R + 0.028, 0.030, accent, -0.045));
      // 翻边滚边
      g.add(place(make(new THREE.TorusGeometry(R + 0.205, 0.014, 8, 46), accent), [0, 0.175, 0], [Math.PI / 2, 0, 0], [1, 1, Z]));
      // 抽绳 + 绳扣
      const cord = createAccMaterial(c2, { spec: 0.1, rough: 0.85 });
      for (const s2 of [-1, 1] as const) {
        g.add(
          make(
            taperTube(
              [
                [s2 * 0.055, -0.040, (R + 0.055) * Z],
                [s2 * 0.085, -0.120, (R + 0.070) * Z],
                [s2 * 0.070, -0.185, (R + 0.060) * Z],
              ],
              0.009,
              0.008,
              12,
              5,
            ),
            cord,
          ),
        );
        g.add(place(make(new THREE.CylinderGeometry(0.018, 0.020, 0.030, 10), accent), [s2 * 0.072, -0.196, (R + 0.060) * Z]));
      }
      break;
    }
    case 'bandana': {
      // 领圈：折叠的布带
      g.add(ring(R + 0.014, 0.034, cloth, 0.004, 1.0));
      g.add(ring(R + 0.016, 0.008, accent, 0.030, 1.0));
      // 三角巾：从领口前垂下，带厚度与外翻边
      const tri = new THREE.Shape();
      tri.moveTo(-0.22, 0);
      tri.quadraticCurveTo(-0.10, -0.16, 0, -0.36);
      tri.quadraticCurveTo(0.10, -0.16, 0.22, 0);
      tri.closePath();
      const geo = new THREE.ExtrudeGeometry(tri, {
        depth: 0.024,
        bevelEnabled: true,
        bevelSize: 0.009,
        bevelThickness: 0.007,
        bevelSegments: 3,
        curveSegments: 22,
      });
      const clothTri = make(geo, cloth);
      place(clothTri, [0, -0.040, (R + 0.020) * Z - 0.012], [0.20, 0, 0]);
      g.add(clothTri);
      // 下摆卷边
      for (const s2 of [-1, 1] as const) {
        g.add(
          seamTube(
            [
              [s2 * 0.216, -0.036, (R + 0.030) * Z],
              [s2 * 0.10, -0.190, (R + 0.040) * Z],
              [0, -0.392, (R + 0.044) * Z],
            ],
            0.011,
            0.008,
            accent,
            16,
            6,
          ),
        );
      }
      // 侧结 + 两条小尾
      const knot = new THREE.Group();
      knot.add(place(make(new THREE.SphereGeometry(0.052, 16, 12), cloth), [0, 0, 0], [0, 0, 0], [1, 0.9, 0.85]));
      knot.add(place(make(new THREE.TorusGeometry(0.054, 0.013, 8, 20), accent), [0, 0.016, 0], [Math.PI / 2, 0, 0], [1, 1, 0.85]));
      for (const s2 of [-1, 1] as const) {
        knot.add(
          make(
            taperTube(
              [
                [0, -0.02, 0],
                [s2 * 0.05, -0.11, 0.02],
                [s2 * 0.035, -0.19, 0.03],
              ],
              0.030,
              0.016,
              10,
              6,
            ),
            cloth,
          ),
        );
      }
      place(knot, [0.235, -0.030, (R + 0.020) * Z * 0.66], [0.1, 0.5, 0.12]);
      g.add(knot);
      break;
    }
    case 'snood': {
      g.add(ring(R + 0.032, 0.094, cloth, -0.055, 1.30));
      // 竖罗纹
      for (let i = 0; i < 26; i += 1) {
        const a = (i / 26) * Math.PI * 2;
        const rr = R + 0.098;
        g.add(
          place(
            make(new THREE.CapsuleGeometry(0.011, 0.150, 4, 6), cloth),
            [Math.sin(a) * rr, -0.055, Math.cos(a) * rr * Z],
            [0, -a, 0],
          ),
        );
      }
      g.add(ring(R + 0.040, 0.024, accent, 0.055, 1.10));
      g.add(beadRing(R + 0.036, -0.085, 42, 0.0055, accent, Z));
      g.add(beadRing(R + 0.036, 0.040, 42, 0.0055, accent, Z));
      break;
    }
    case 'furCollar': {
      g.add(ring(R + 0.026, 0.062, cloth, -0.01, 1.05));
      for (let i = 0; i < 24; i += 1) {
        const a2 = (i / 24) * Math.PI * 2;
        const rr = 0.062 + (i % 3) * 0.010;
        const fluff = make(new THREE.SphereGeometry(0.056 + (i % 2) * 0.014, 12, 10), i % 2 ? accent : cloth);
        g.add(
          place(fluff, [
            Math.sin(a2) * (R + rr),
            -0.01 + Math.cos(a2 * 3) * 0.014,
            Math.cos(a2) * (R + rr) * Z,
          ]),
        );
      }
      // 内侧衬边
      g.add(ring(R + 0.010, 0.020, accent, -0.01, 1.0));
      // 前方小铃铛吊饰
      const charm = new THREE.Group();
      charm.add(place(make(new THREE.SphereGeometry(0.036, 14, 12), createAccMaterial('#d9b23c', { spec: 0.9, rough: 0.2 })), [0, 0, 0]));
      charm.add(place(make(new THREE.TorusGeometry(0.014, 0.005, 8, 14), createAccMaterial('#d9b23c', { spec: 0.9, rough: 0.2 })), [0, 0.036, 0], [Math.PI / 2, 0, 0]));
      place(charm, [0, -0.105, (R + 0.070) * Z]);
      markAnim(charm, 'swing', 1, 1.1, 0.5);
      g.add(charm);
      break;
    }
    case 'pendant': {
      g.add(ring(R + 0.010, 0.014, accent, 0.0, 1.0));
      const z = (R + 0.03) * Z;
      const starGeo = new THREE.Shape();
      for (let i = 0; i < 10; i += 1) {
        const rad = i % 2 ? 0.030 : 0.070;
        const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
        if (i === 0) starGeo.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
        else starGeo.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
      }
      starGeo.closePath();
      // 链条：一圈小环
      const chainMat = createAccMaterial(c2, { spec: 0.85, rough: 0.22 });
      for (let i = 0; i < 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        g.add(
          place(
            make(new THREE.TorusGeometry(0.020, 0.0055, 6, 12), chainMat),
            [Math.sin(a) * (R + 0.012), Math.cos(a * 2) * 0.008, Math.cos(a) * (R + 0.012) * Z],
            [0, -a, i % 2 ? Math.PI / 2 : 0],
          ),
        );
      }
      const star = make(new THREE.ExtrudeGeometry(starGeo, { depth: 0.014, bevelEnabled: false }), accent);
      const starGrp = new THREE.Group();
      starGrp.add(place(star, [0, -0.105, z], [0, 0, 0]));
      // 星托 + 高光
      starGrp.add(place(make(new THREE.TorusGeometry(0.072, 0.008, 8, 20), chainMat), [0, -0.105, z - 0.004]));
      starGrp.add(place(make(new THREE.SphereGeometry(0.016, 12, 10), createAccMaterial('#ffffff', { spec: 1, opacity: 0.8 })), [-0.028, -0.078, z + 0.012]));
      markAnim(starGrp, 'swing', 1, 1.2, 0.6);
      g.add(starGrp);
      break;
    }
    case 'laceCollar': {
      g.add(ring(R + 0.018, 0.024, cloth, 0.0, 1.0));
      for (const [rr, yy, cnt, sc] of [[0.042, -0.030, 20, 1.0], [0.060, -0.048, 26, 0.72]] as const) {
        for (let i = 0; i < cnt; i += 1) {
          const a2 = (i / cnt) * Math.PI * 2;
          const petal = make(new THREE.SphereGeometry(0.048 * sc, 10, 8), accent);
          g.add(
            place(
              petal,
              [Math.sin(a2) * (R + rr), yy, Math.cos(a2) * (R + rr) * Z],
              [0, 0, 0],
              [1, 0.40, 1],
            ),
          );
        }
      }
      // 珠边
      g.add(beadRing(R + 0.020, 0.006, 40, 0.0060, createAccMaterial('#f8f2e6', { spec: 0.7, rough: 0.25 }), Z));
      // 前系带
      for (const s2 of [-1, 1] as const) {
        g.add(
          make(
            taperTube(
              [
                [s2 * 0.030, -0.020, (R + 0.045) * Z],
                [s2 * 0.075, -0.080, (R + 0.052) * Z],
                [s2 * 0.055, -0.140, (R + 0.045) * Z],
              ],
              0.014,
              0.009,
              10,
              5,
            ),
            accent,
          ),
        );
      }
      break;
    }
    case 'nameTag': {
      g.add(ring(R + 0.014, 0.026, cloth, 0.0, 1.0));
      const plate = make(roundedBox(0.20, 0.13, 0.030, 0.030, 2), accent);
      g.add(place(plate, [0, -0.075, (R + 0.035) * Z], [0.12, 0, 0]));
      // 压印边框 + 两行铭文位 + 铆钉
      const dark = createAccMaterial('#3a3a40', { spec: 0.35, rough: 0.5 });
      for (const dy of [0.020, -0.020]) {
        g.add(place(make(roundedBox(0.150, 0.010, 0.006, 0.004, 1), dark), [0, -0.075 + dy, (R + 0.052) * Z], [0.12, 0, 0]));
      }
      for (const s2 of [-1, 1] as const) {
        g.add(place(make(new THREE.SphereGeometry(0.012, 10, 8), createAccMaterial('#d8d2c4', { spec: 0.8, rough: 0.2 })), [s2 * 0.082, -0.075, (R + 0.050) * Z]));
      }
      g.add(place(make(new THREE.TorusGeometry(0.024, 0.008, 8, 16), accent), [0, -0.012, (R + 0.030) * Z], [0, Math.PI / 2, 0]));
      break;
    }
    case 'neckBrace': {
      g.add(ring(R + 0.040, 0.075, cloth, 0.02, 1.35));
      const pad2 = make(roundedBox(0.24, 0.20, 0.10, 0.05, 3), accent);
      g.add(place(pad2, [0, -0.075, (R + 0.055) * Z], [0.10, 0, 0]));
      // 绑带
      for (const dy of [0.055, -0.055]) {
        g.add(
          place(
            make(new THREE.TorusGeometry(R + 0.055, 0.014, 8, 40), cloth),
            [0, dy, 0],
            [Math.PI / 2, 0, 0],
            [1, 1, Z],
          ),
        );
      }
      // 魔术贴的横向细纹
      for (let i = 0; i < 8; i += 1) {
        g.add(place(make(new THREE.BoxGeometry(0.20, 0.006, 0.006), cloth), [0, -0.135 + i * 0.017, (R + 0.106) * Z], [0.10, 0, 0]));
      }
      break;
    }
    case 'bib': {
      g.add(ring(R + 0.012, 0.020, cloth, 0.0, 1.0));
      const body2 = make(roundedBox(0.34, 0.26, 0.045, 0.075, 3), cloth);
      g.add(place(body2, [0, -0.155, (R + 0.03) * Z], [0.10, 0, 0]));
      // 前口袋 + 上沿滚边
      g.add(place(make(roundedBox(0.24, 0.13, 0.020, 0.040, 3), accent), [0, -0.205, (R + 0.056) * Z], [0.10, 0, 0]));
      g.add(place(make(roundedBox(0.25, 0.018, 0.024, 0.008, 2), accent), [0, -0.142, (R + 0.058) * Z], [0.10, 0, 0]));
      // 四周针脚
      for (let i = 0; i < 14; i += 1) {
        const t = i / 13;
        g.add(place(make(new THREE.SphereGeometry(0.006, 8, 6), createAccMaterial('#f6ecd8', { spec: 0.05, rough: 0.9 })), [-0.15 + t * 0.30, -0.038, (R + 0.050) * Z]));
      }
      // 颈部按扣
      g.add(place(make(new THREE.SphereGeometry(0.016, 12, 10), accent), [0.10, 0.005, (R + 0.028) * Z]));
      break;
    }
    default:
      return g;
  }
  return g;
}

// ---------------------------------------------------------------- 背部（catRoot 局部）

function buildBack(shape: string, c1: string, c2: string, ctx: Acc3DCtx): THREE.Group {
  const g = new THREE.Group();
  const body = createAccMaterial(c1, { spec: 0.14, rim: 0.34 });
  const trim = createAccMaterial(c2, { spec: 0.28, rim: 0.30 });
  const Z = ctx.zScale;

  switch (shape) {
    case 'wingsAngel':
    case 'wingsDevil':
    case 'wingsButterfly': {
      if (shape === 'wingsAngel') {
        for (const s of [-1, 1] as const) buildAngelWingsFine(g, c1, c2, s);
        break;
      }
      const isDevil = shape === 'wingsDevil';
      const membraneMat = createAccMaterial(c1, { spec: isDevil ? 0.30 : 0.42, opacity: isDevil ? 0.94 : 0.9, rim: 0.5, rough: 0.45 });
      const lineMat = createAccMaterial(c2, { spec: 0.4, rim: 0.3, rough: 0.4 });
      const lowerMat = createAccMaterial(c2, { spec: 0.38, opacity: 0.9, rim: 0.45 });
      const mkShape = (s: number, lower: boolean): THREE.Shape => {
        const sh = new THREE.Shape();
        const span = lower ? 0.46 : 0.66;
        if (isDevil) {
          // 蝙蝠翼：膜 + 三个下垂尖
          sh.moveTo(0, 0);
          sh.quadraticCurveTo(s * span * 0.52, 0.34, s * span * 1.00, 0.20);
          sh.quadraticCurveTo(s * span * 0.86, 0.04, s * span * 0.78, -0.06);
          sh.quadraticCurveTo(s * span * 0.62, 0.06, s * span * 0.54, -0.18);
          sh.quadraticCurveTo(s * span * 0.36, -0.02, s * span * 0.26, -0.26);
          sh.quadraticCurveTo(s * span * 0.12, -0.08, 0, 0);
        } else if (!lower) {
          // 上翅：饱满的蝶翼，外缘略方
          sh.moveTo(0, 0);
          sh.bezierCurveTo(s * span * 0.46, 0.36, s * span * 0.97, 0.32, s * span * 0.95, 0.07);
          sh.bezierCurveTo(s * span * 0.93, -0.16, s * span * 0.50, -0.28, 0, -0.06);
        } else {
          // 下翅：圆一点、略下垂
          sh.moveTo(0, 0);
          sh.bezierCurveTo(s * span * 0.44, 0.06, s * span * 0.94, -0.04, s * span * 0.86, -0.30);
          sh.bezierCurveTo(s * span * 0.78, -0.54, s * span * 0.30, -0.50, 0, -0.18);
        }
        return sh;
      };
      const addWing = (s: number, lower: boolean) => {
        const geo = new THREE.ExtrudeGeometry(mkShape(s, lower), {
          depth: 0.018,
          bevelEnabled: true,
          bevelSize: 0.007,
          bevelThickness: 0.006,
          bevelSegments: 2,
          curveSegments: 16,
        });
        const wing = make(geo, lower ? lowerMat : membraneMat);
        wing.position.set(s * 0.02, lower ? -0.06 : 0.02, 0);
        wing.rotation.set(0.02, s * 0.30, s * (lower ? 0.34 : 0.08));
        wing.scale.setScalar(lower ? 1.12 : 1.34);
        // 翅脉：从根部向外发散，压在膜面上
        const veins: Array<Array<[number, number]>> = lower
          ? [
              [[0, 0], [s * 0.16, -0.10], [s * 0.34, -0.26]],
              [[0, 0], [s * 0.24, -0.06], [s * 0.44, -0.16]],
            ]
          : [
              [[0, 0], [s * 0.26, 0.16], [s * 0.60, 0.16]],
              [[0, 0], [s * 0.28, 0.02], [s * 0.62, 0.02]],
              [[0, 0], [s * 0.22, -0.10], [s * 0.50, -0.18]],
            ];
        for (const v of veins) {
          wing.add(
            seamTube(
              [
                [v[0][0], v[0][1], 0.020],
                [v[1][0], v[1][1], 0.020],
                [v[2][0], v[2][1], 0.020],
              ],
              isDevil ? 0.008 : 0.006,
              0.003,
              lineMat,
              12,
              5,
            ),
          );
        }
        // 根部覆鳞
        wing.add(place(make(new THREE.SphereGeometry(0.075, 14, 10), lineMat), [s * 0.03, -0.01, 0.012], [0, 0, 0], [1.1, 0.7, 0.55]));
        return wing;
      };
      for (const s of [-1, 1] as const) {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.17, 1.16, -0.46);
        markAnim(pivot, 'flap', s, isDevil ? 0.55 : 0.85, s > 0 ? 0 : 0.5);
        pivot.add(addWing(s, false));
        if (!isDevil) pivot.add(addWing(s, true));
        g.add(pivot);
      }
      // 背中线：蝶类的身体 / 恶魔的脊
      g.add(
        place(
          make(new THREE.CapsuleGeometry(0.055, isDevil ? 0.34 : 0.28, 6, 10), lineMat),
          [0, 1.02, -0.50],
          [0.18, 0, 0],
        ),
      );
      break;
    }
    case 'backpack': {
      buildBackpackFine(g, c1, c2);
      break;
    }
    case 'cape': {
      buildCapeFine(g, c1, c2);
      break;
    }
    case 'jetpack': {
      for (const s of [-1, 1] as const) {
        const tank = make(new THREE.CylinderGeometry(0.115, 0.115, 0.52, 16), body);
        place(tank, [s * 0.30, 1.16, -0.58], [0.05, 0, 0]);
        g.add(tank);
        g.add(place(make(new THREE.SphereGeometry(0.115, 14, 10), trim), [s * 0.30, 1.42, -0.575], [0, 0, 0], [1, 0.7, 1]));
        const nozzle = make(new THREE.ConeGeometry(0.075, 0.16, 14), trim);
        place(nozzle, [s * 0.30, 0.86, -0.59], [Math.PI, 0, 0]);
        g.add(nozzle);
        const flame = make(
          new THREE.ConeGeometry(0.06, 0.22, 12),
          createAccMaterial('#ff9a3d', { spec: 0.1, opacity: 0.85, glow: 0.25 }),
        );
        place(flame, [s * 0.30, 0.72, -0.59], [Math.PI, 0, 0]);
        g.add(flame);
      }
      g.add(place(make(roundedBox(0.26, 0.44, 0.16, 0.06, 3), trim), [0, 1.16, -0.54]));
      // 仪表盘 + 指示灯
      g.add(place(make(new THREE.CylinderGeometry(0.052, 0.052, 0.020, 18), createAccMaterial('#d8e2ee', { spec: 0.6, rough: 0.25 })), [0, 1.20, -0.455], [Math.PI / 2, 0, 0]));
      g.add(place(make(new THREE.BoxGeometry(0.006, 0.036, 0.006), createAccMaterial('#c8423a', { spec: 0.5 })), [0, 1.20, -0.443], [0, 0, 0.5]));
      // 两条背带
      for (const s2 of [-1, 1] as const) {
        g.add(
          make(
            taperTube(
              [
                [s2 * 0.20, 1.38, -0.54],
                [s2 * 0.34, 1.20, -0.26],
                [s2 * 0.30, 1.00, 0.06],
              ],
              0.026,
              0.022,
              12,
              6,
            ),
            trim,
          ),
        );
      }
      // 铆钉
      for (const [rx, ry] of [[-0.10, 0.98], [0.10, 0.98], [-0.10, 1.34], [0.10, 1.34]] as const) {
        g.add(place(make(new THREE.SphereGeometry(0.014, 10, 8), createAccMaterial('#b9c2ce', { spec: 0.8, rough: 0.2 })), [rx, ry, -0.462]));
      }
      break;
    }
    case 'shell': {
      const shell = make(new THREE.SphereGeometry(0.52, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), body);
      place(shell, [0, 1.02, -0.44], [0.35, 0, 0], [1.1, 1.1, 0.62]);
      g.add(shell);
      for (let i = 0; i < 5; i += 1) {
        const rib = make(
          new THREE.TorusGeometry(0.16 + i * 0.05, 0.014, 8, 24, Math.PI),
          trim,
        );
        place(rib, [0, 1.02 + i * 0.055, -0.44 - i * 0.02], [Math.PI * 0.42, 0, 0]);
        g.add(rib);
      }
      // 盾片：每一圈之间加小块凸起
      for (let ring = 0; ring < 3; ring += 1) {
        for (let i = -1; i <= 1; i += 1) {
          g.add(
            place(
              make(new THREE.SphereGeometry(0.075 - ring * 0.012, 12, 10), trim),
              [i * 0.20, 1.10 + ring * 0.10, -0.46 + ring * 0.02],
              [0, 0, 0],
              [1, 0.7, 0.35],
            ),
          );
        }
      }
      // 壳口的一圈包边
      g.add(place(make(new THREE.TorusGeometry(0.545, 0.020, 8, 34), trim), [0, 1.02, -0.44], [Math.PI * 0.42, 0, 0], [1.05, 0.94, 1]));
      break;
    }
    case 'wingsBee': {
      const membrane = createAccMaterial(c1, { spec: 0.55, opacity: 0.52, rim: 0.65, rough: 0.2 });
      const edge = createAccMaterial(c2, { spec: 0.45, opacity: 0.85, rim: 0.35, rough: 0.35 });
      for (const s of [-1, 1] as const) {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.22, 1.32, -0.47);
        markAnim(pivot, 'flap', s, 1.15, s > 0 ? 0 : 0.6);
        g.add(pivot);
        const lobes: Array<[number, number, number, number, number]> = [
          [0.30, 0.150, 0.255, 0.150, 0.26],
          [0.190, 0.100, 0.205, -0.035, 0.10],
        ];
        for (const [rx, ry, px, py, rot] of lobes) {
          const wing = make(new THREE.CircleGeometry(1, 30), membrane);
          wing.scale.set(rx, ry, 1);
          wing.position.set(s * px, py, 0);
          wing.rotation.z = s * rot;
          pivot.add(wing);
          const rim = make(new THREE.TorusGeometry(1, 0.018, 8, 36), edge);
          rim.scale.set(rx, ry, 1);
          rim.position.set(s * px, py, 0);
          rim.rotation.z = s * rot;
          pivot.add(rim);
          for (let i = 0; i < 3; i += 1) {
            const a = 0.18 + (i / 3) * Math.PI * 0.62;
            const ex = s * (px + Math.cos(a) * rx * 0.9);
            const ey = py + Math.sin(a) * ry * 0.9;
            pivot.add(
              seamTube(
                [
                  [s * px * 0.12, py * 0.15, 0.003],
                  [s * (px * 0.55), py + Math.sin(a) * ry * 0.42, 0.003],
                  [ex, ey, 0.003],
                ],
                0.0055,
                0.0022,
                edge,
                10,
                4,
              ),
            );
          }
        }
      }
      break;
    }
    case 'glider': {
      for (const s2 of [-1, 1] as const) {
        const sail = make(
          new THREE.ConeGeometry(0.34, 0.62, 3, 1, true),
          createAccMaterial(c1, { spec: 0.22, opacity: 0.85 }),
        );
        place(sail, [s2 * 0.52, 1.36, -0.30], [Math.PI * 0.5, 0, s2 * 0.35], [1, 1, 0.5]);
        g.add(sail);
      }
      // 骨架支杆 + 布面缝线
      g.add(place(make(new THREE.CylinderGeometry(0.016, 0.016, 1.10, 10), trim), [0, 1.36, -0.34], [0, 0, Math.PI / 2]));
      for (const s2 of [-1, 1] as const) {
        g.add(
          make(
            taperTube(
              [
                [s2 * 0.10, 1.36, -0.34],
                [s2 * 0.44, 1.50, -0.34],
                [s2 * 0.72, 1.34, -0.32],
              ],
              0.014,
              0.010,
              10,
              5,
            ),
            trim,
          ),
        );
        g.add(
          make(
            taperTube(
              [
                [s2 * 0.10, 1.36, -0.34],
                [s2 * 0.40, 1.18, -0.34],
                [s2 * 0.66, 1.10, -0.32],
              ],
              0.013,
              0.009,
              10,
              5,
            ),
            trim,
          ),
        );
      }
      break;
    }
    case 'parachute': {
      const dome = make(new THREE.SphereGeometry(0.72, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), body);
      place(dome, [0, 2.02, -0.16], [0, 0, 0], [1, 0.72, 0.86]);
      g.add(dome);
      for (const s2 of [-1, 1] as const) {
        g.add(
          make(
            taperTube(
              [
                [s2 * 0.60, 2.00, -0.16],
                [s2 * 0.40, 1.70, -0.06],
                [s2 * 0.26, 1.44, 0.02],
              ],
              0.009,
              0.009,
              12,
              5,
            ),
            trim,
          ),
        );
      }
      // 伞面分片缝线 + 承重带
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        g.add(
          seamTube(
            [
              [0, 2.05, -0.16],
              [Math.sin(a) * 0.44, 1.94, -0.16 + Math.cos(a) * 0.38],
              [Math.sin(a) * 0.70, 1.80, -0.16 + Math.cos(a) * 0.60],
            ],
            0.007,
            0.006,
            trim,
            10,
            4,
          ),
        );
      }
      g.add(place(make(new THREE.SphereGeometry(0.05, 14, 10), trim), [0, 2.08, -0.16]));
      break;
    }
    case 'lantern': {
      const body2 = make(new THREE.SphereGeometry(0.20, 16, 12), createAccMaterial(c1, {
        spec: 0.1,
        glow: 0.22,
      }));
      const lanternGrp = new THREE.Group();
      lanternGrp.add(place(body2, [0.62, 1.28, -0.20], [0, 0, 0], [1, 1.12, 1]));
      markAnim(lanternGrp, 'swing', 1, 0.7, 1.2);
      g.add(lanternGrp);
      for (const s2 of [-1, 1] as const) {
        g.add(place(make(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12), trim), [0.62, 1.28 + s2 * 0.21, -0.20]));
      }
      g.add(make(taperTube([[0.62, 1.48, -0.20], [0.66, 1.62, -0.18], [0.62, 1.72, -0.16]], 0.008, 0.008, 8, 4), trim));
      // 灯笼骨架 + 底穗
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        g.add(
          make(
            taperTube(
              [
                [0.62 + Math.sin(a) * 0.03, 1.48, -0.20 + Math.cos(a) * 0.03],
                [0.62 + Math.sin(a) * 0.20, 1.28, -0.20 + Math.cos(a) * 0.20],
                [0.62 + Math.sin(a) * 0.03, 1.08, -0.20 + Math.cos(a) * 0.03],
              ],
              0.007,
              0.007,
              10,
              4,
            ),
            trim,
          ),
        );
      }
      g.add(place(make(new THREE.ConeGeometry(0.035, 0.10, 8), trim), [0.62, 1.00, -0.20], [Math.PI, 0, 0]));
      break;
    }
    case 'balloons': {
      for (const [dx, dy, s2] of [[-0.10, 0.52, 0.24], [0.14, 0.62, 0.20], [0.02, 0.40, 0.17]] as const) {
        const ball = make(new THREE.SphereGeometry(s2, 16, 12), createAccMaterial(c1, { spec: 0.45, rim: 0.5 }));
        place(ball, [0.56 + dx, 1.42 + dy, -0.18], [0, 0, 0], [1, 1.14, 1]);
        g.add(ball);
        g.add(
          make(
            taperTube(
              [
                [0.56 + dx, 1.42 + dy - s2 * 1.1, -0.18],
                [0.60 + dx * 0.5, 1.30 + dy * 0.4, -0.16],
                [0.58, 1.10, -0.14],
              ],
              0.006,
              0.006,
              10,
              4,
            ),
            trim,
          ),
        );
        // 气球嘴 + 高光
        g.add(place(make(new THREE.ConeGeometry(0.024, 0.04, 10), trim), [0.56 + dx, 1.42 + dy - s2 * 1.12, -0.18], [Math.PI, 0, 0]));
        g.add(place(make(new THREE.SphereGeometry(0.045, 12, 10), createAccMaterial('#ffffff', { spec: 1, opacity: 0.5 })), [0.56 + dx - s2 * 0.4, 1.42 + dy + s2 * 0.5, -0.10], [0, 0, 0], [1, 1.3, 0.4]));
      }
      // 绑在一起的结
      g.add(place(make(new THREE.SphereGeometry(0.040, 12, 10), trim), [0.58, 1.10, -0.15]));
      break;
    }
    case 'quiver': {
      const tube = make(new THREE.CylinderGeometry(0.11, 0.13, 0.52, 14, 1, true), body);
      place(tube, [-0.42, 1.18, -0.44], [0.28, 0, 0.18]);
      g.add(tube);
      g.add(place(make(new THREE.TorusGeometry(0.115, 0.018, 8, 16), trim), [-0.50, 1.30, -0.47], [0.28, 0, 0.18]));
      for (let i = 0; i < 3; i += 1) {
        const dx = (i - 1) * 0.05;
        g.add(
          place(
            make(new THREE.CylinderGeometry(0.014, 0.014, 0.30, 6), trim),
            [-0.42 + dx, 1.46, -0.44 + i * 0.02],
            [0.30, 0, 0.18 + dx * 0.5],
          ),
        );
        const fletch = make(new THREE.ConeGeometry(0.035, 0.09, 6), trim);
        place(fletch, [-0.42 + dx, 1.63, -0.43 + i * 0.02], [0.30, 0, 0.18]);
        g.add(fletch);
        // 羽毛纹（两片小三角）
        for (const s2 of [-1, 1] as const) {
          g.add(
            place(
              make(new THREE.ConeGeometry(0.018, 0.07, 3), trim),
              [-0.42 + dx + s2 * 0.026, 1.60, -0.43 + i * 0.02],
              [0.30, 0, 0.18 + s2 * 0.4],
            ),
          );
        }
      }
      // 背带
      g.add(
        make(
          taperTube(
            [
              [-0.34, 1.36, -0.50],
              [-0.16, 1.20, -0.20],
              [0.02, 1.02, 0.04],
            ],
            0.026,
            0.022,
            14,
            6,
          ),
          trim,
        ),
      );
      break;
    }
    case 'guitar': {
      const lower = make(new THREE.SphereGeometry(0.24, 18, 14), body);
      place(lower, [0.50, 1.10, -0.42], [0, 0, 0], [1, 1.15, 0.42]);
      g.add(lower);
      const upper = make(new THREE.SphereGeometry(0.17, 16, 12), body);
      place(upper, [0.50, 1.36, -0.42], [0, 0, 0], [1, 1.1, 0.40]);
      g.add(upper);
      g.add(place(make(new THREE.TorusGeometry(0.075, 0.012, 8, 18), trim), [0.50, 1.12, -0.345], [0, 0, 0], [1, 1, 0.5]));
      const neck = make(new THREE.BoxGeometry(0.075, 0.44, 0.05), trim);
      place(neck, [0.50, 1.62, -0.42], [-0.12, 0, 0]);
      g.add(neck);
      const head = make(roundedBox(0.11, 0.14, 0.055, 0.02, 1), trim);
      g.add(place(head, [0.50, 1.86, -0.45], [-0.12, 0, 0]));
      // 琴弦
      const stringMat = createAccMaterial('#e8e4d8', { spec: 0.85, rough: 0.2 });
      for (let i = 0; i < 4; i += 1) {
        const dx = -0.028 + i * 0.019;
        g.add(
          make(
            taperTube(
              [
                [0.50 + dx, 1.06, -0.372],
                [0.50 + dx * 0.8, 1.50, -0.392],
                [0.50 + dx * 0.6, 1.84, -0.425],
              ],
              0.0035,
              0.0035,
              14,
              4,
            ),
            stringMat,
          ),
        );
      }
      // 品丝
      for (let i = 0; i < 5; i += 1) {
        g.add(place(make(new THREE.BoxGeometry(0.072, 0.006, 0.010), stringMat), [0.50, 1.50 + i * 0.055, -0.400], [-0.12, 0, 0]));
      }
      // 护板 + 拾音孔内圈
      g.add(place(make(new THREE.TorusGeometry(0.058, 0.008, 8, 20), createAccMaterial('#2a2320', { spec: 0.4, rough: 0.6 })), [0.50, 1.12, -0.344], [0, 0, 0], [1, 1, 0.5]));
      g.add(place(make(new THREE.CircleGeometry(0.052, 20), createAccMaterial('#1c1815', { spec: 0.1, rough: 0.9 })), [0.50, 1.12, -0.352], [0, 0, 0], [1, 1, 1]));
      break;
    }
    case 'basket': {
      const wall = make(new THREE.CylinderGeometry(0.30, 0.24, 0.40, 18, 1, true), body);
      place(wall, [0.52, 1.02, -0.36], [0.10, 0, 0]);
      g.add(wall);
      for (let i = 0; i < 4; i += 1) {
        const hoop = make(new THREE.TorusGeometry(0.285 - i * 0.016, 0.016, 6, 20), trim);
        place(hoop, [0.52, 0.90 + i * 0.10, -0.36], [Math.PI / 2 + 0.10, 0, 0], [1, 1, 0.9]);
        g.add(hoop);
      }
      for (const s2 of [-1, 1] as const) {
        g.add(
          place(
            make(new THREE.TorusGeometry(0.09, 0.014, 8, 16, Math.PI), trim),
            [0.52 + s2 * 0.24, 1.26, -0.35],
            [0, Math.PI / 2, 0],
            [1, 1, 1],
          ),
        );
      }
      // 竖向编条
      for (let i = 0; i < 18; i += 1) {
        const a = (i / 18) * Math.PI * 2;
        g.add(
          make(
            taperTube(
              [
                [0.52 + Math.sin(a) * 0.30, 1.22, -0.36 + Math.cos(a) * 0.30],
                [0.52 + Math.sin(a) * 0.28, 1.02, -0.36 + Math.cos(a) * 0.28],
                [0.52 + Math.sin(a) * 0.24, 0.82, -0.36 + Math.cos(a) * 0.24],
              ],
              0.008,
              0.008,
              10,
              4,
            ),
            body,
          ),
        );
      }
      // 口沿加厚
      g.add(place(make(new THREE.TorusGeometry(0.305, 0.024, 10, 30), trim), [0.52, 1.22, -0.36], [Math.PI / 2 + 0.10, 0, 0], [1, 1, 0.92]));
      break;
    }
    case 'surfboard': {
      const board = make(new THREE.SphereGeometry(0.30, 18, 14), createAccMaterial(c1, { spec: 0.4, rim: 0.35 }));
      place(board, [0.58, 1.16, -0.40], [0.05, 0.20, 0], [0.34, 2.6, 1.0]);
      g.add(board);
      const stripe = make(new THREE.BoxGeometry(0.02, 0.72, 0.06), trim);
      place(stripe, [0.58, 1.16, -0.435], [0, 0.20, 0]);
      g.add(stripe);
      // 第二条纹 + 尾鳍
      g.add(place(make(new THREE.BoxGeometry(0.02, 0.60, 0.05), trim), [0.50, 1.16, -0.437], [0, 0.20, 0]));
      g.add(place(make(new THREE.ConeGeometry(0.075, 0.18, 4), trim), [0.58, 0.60, -0.30], [0.2, 0.2, Math.PI], [1, 1, 0.4]));
      // 脚绳
      g.add(
        make(
          taperTube(
            [
              [0.58, 1.60, -0.42],
              [0.70, 1.52, -0.36],
              [0.74, 1.38, -0.30],
            ],
            0.008,
            0.007,
            12,
            4,
          ),
          trim,
        ),
      );
      markAnim(g, 'float', 1, 1, 0.3);
      break;
    }
    case 'flag': {
      g.add(place(make(new THREE.CylinderGeometry(0.012, 0.012, 0.70, 8), trim), [0.50, 1.30, -0.34]));
      const cloth2 = make(roundedBox(0.30, 0.20, 0.012, 0.010, 1), body);
      g.add(place(cloth2, [0.66, 1.56, -0.34], [0, 0, -0.12]));
      break;
    }
    default:
      return g;
  }
  return g;
}

// ---------------------------------------------------------------- 爪子（单位球空间）

function buildPaw(shape: string, c1: string, c2: string): THREE.Group {
  const g = new THREE.Group();
  const cloth = createAccMaterial(c1, { spec: 0.10, rim: 0.30 });
  const trim = createAccMaterial(c2, { spec: 0.26, rim: 0.28 });

  switch (shape) {
    case 'sock': {
      buildSockFine(g, c1, c2);
      break;
    }
    case 'boot': {
      buildBootFine(g, c1, c2);
      break;
    }
    case 'cuff': {
      g.add(place(make(new THREE.TorusGeometry(0.98, 0.16, 14, 30), cloth), [0, 0.02, 0.52], [0.2, 0, 0]));
      // 罗纹 + 上下缝线
      for (let i = 0; i < 22; i += 1) {
        const a = (i / 22) * Math.PI * 2;
        g.add(
          place(
            make(new THREE.CapsuleGeometry(0.030, 0.16, 4, 8), cloth),
            [Math.sin(a) * 1.06, 0.02 - Math.cos(a) * 0.14 * Math.sin(0.2), 0.52 + Math.cos(a) * 0.98],
            [0.2, -a, 0],
          ),
        );
      }
      for (const dy of [0.13, -0.11]) {
        g.add(place(make(new THREE.TorusGeometry(0.99, 0.012, 6, 30), trim), [0, 0.02 + dy, 0.52], [0.2, 0, 0]));
      }
      break;
    }
    case 'slipper': {
      const body = make(new THREE.SphereGeometry(1.08, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), cloth);
      place(body, [0, -0.05, 0.05], [Math.PI * 0.46, 0, 0], [1.05, 1.0, 1.15]);
      g.add(body);
      // 鞋面毛球 + 内衬
      g.add(place(make(new THREE.SphereGeometry(0.30, 14, 12), trim), [0, 0.18, 0.62], [0, 0, 0], [1.6, 0.5, 0.7]));
      g.add(place(make(new THREE.SphereGeometry(0.15, 14, 12), trim), [0, 0.30, 0.58], [0, 0, 0], [1.6, 0.7, 1.0]));
      // 鞋底
      g.add(place(make(roundedBox(1.86, 0.18, 2.10, 0.10, 2), trim), [0, -0.86, 0.06]));
      // 内衬边
      g.add(place(make(new THREE.TorusGeometry(0.86, 0.055, 8, 26), createAccMaterial('#f2ead8', { spec: 0.05, rough: 0.9 })), [0, 0.20, 0.20], [Math.PI / 2.1, 0, 0], [1, 1, 1.1]));
      break;
    }
    case 'plushPaw': {
      for (let i = 0; i < 10; i += 1) {
        const ang = (i / 10) * Math.PI * 2;
        const puff = make(new THREE.SphereGeometry(0.32 + (i % 2) * 0.03, 14, 10), i % 2 ? trim : cloth);
        g.add(place(puff, [Math.sin(ang) * 0.86, 0.06, Math.cos(ang) * 0.86], [0, 0, 0], [1, 0.7, 1]));
      }
      // 中央肉垫 + 四个脚趾豆
      g.add(place(make(new THREE.SphereGeometry(0.40, 16, 12), trim), [0, 0.28, 0.10], [0, 0, 0], [1, 0.30, 0.9]));
      for (const [dx, dz, sc] of [[-0.30, 0.52, 0.13], [0, 0.62, 0.14], [0.30, 0.52, 0.13], [0.44, 0.26, 0.11], [-0.44, 0.26, 0.11]] as const) {
        g.add(place(make(new THREE.SphereGeometry(sc, 12, 10), trim), [dx, 0.30, dz], [0, 0, 0], [1, 0.4, 1]));
      }
      break;
    }
    case 'wristband': {
      g.add(place(make(new THREE.TorusGeometry(1.02, 0.20, 14, 30), cloth), [0, 0.10, 0.44], [0.28, 0, 0]));
      // 两道彩色条 + 缝线
      for (const dy of [0.16, 0.02]) {
        g.add(place(make(new THREE.TorusGeometry(1.03, 0.045, 10, 30), trim), [0, 0.10 + dy, 0.44], [0.28, 0, 0]));
      }
      for (const dy of [0.26, -0.06]) {
        g.add(place(make(new THREE.TorusGeometry(1.02, 0.012, 6, 30), trim), [0, 0.10 + dy, 0.44], [0.28, 0, 0]));
      }
      // 正面小标
      g.add(place(make(roundedBox(0.18, 0.12, 0.03, 0.02, 2), trim), [0, 0.10, 1.46], [0.28, 0, 0]));
      break;
    }
    case 'ring': {
      const metal = createAccMaterial(c2, { spec: 0.92, rough: 0.16 });
      g.add(place(make(new THREE.TorusGeometry(1.04, 0.085, 14, 34), metal), [0, 0.02, 0.50], [0.22, 0, 0]));
      // 宝石 + 四爪
      const gem = make(new THREE.OctahedronGeometry(0.20, 0), createAccMaterial(c1, { spec: 1.0, rough: 0.06, glow: 0.16 }));
      place(gem, [0, 0.16, 1.42], [0, 0, 0], [1, 0.85, 0.7]);
      g.add(gem);
      for (const dx of [-0.13, 0.13]) {
        g.add(place(make(new THREE.CapsuleGeometry(0.030, 0.14, 4, 8), metal), [dx, 0.10, 1.42], [0, 0, dx > 0 ? -0.5 : 0.5]));
      }
      break;
    }
    case 'pawSticker': {
      // 肉垫贴纸：大垫 + 四个趾垫 + 描边
      const pad = make(new THREE.CircleGeometry(0.44, 22), cloth);
      place(pad, [0, 0.80, 0.46], [-0.9, 0, 0], [1, 0.86, 1]);
      g.add(pad);
      const rim = make(new THREE.TorusGeometry(0.44, 0.030, 8, 28), trim);
      place(rim, [0, 0.80, 0.455], [-0.9, 0, 0], [1, 0.86, 1]);
      g.add(rim);
      for (const [dx, dy, sc] of [[-0.30, 0.44, 0.14], [-0.10, 0.50, 0.15], [0.12, 0.50, 0.15], [0.31, 0.44, 0.14]] as const) {
        g.add(place(make(new THREE.CircleGeometry(sc, 14), trim), [dx, 0.80 + dy * 0.8, 0.47], [-0.9, 0, 0], [1, 1.15, 1]));
      }
      break;
    }
    case 'sneaker': {
      const shell2 = make(new THREE.SphereGeometry(1.06, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), cloth);
      place(shell2, [0, -0.04, 0.06], [Math.PI * 0.42, 0, 0], [1.02, 1.0, 1.1]);
      g.add(shell2);
      const sole = make(roundedBox(1.90, 0.30, 2.10, 0.16, 2), trim);
      g.add(place(sole, [0, -0.92, 0.06]));
      // 鞋舌 + 鞋带 + 侧面装饰条
      g.add(place(make(new THREE.BoxGeometry(0.72, 0.42, 0.08), trim), [0, 0.34, 0.72], [0.42, 0, 0]));
      for (let i = 0; i < 4; i += 1) {
        g.add(place(make(new THREE.BoxGeometry(0.74, 0.045, 0.05), trim), [0, 0.34 - i * 0.14, 0.88 - i * 0.05], [0.3, 0, 0]));
      }
      for (const s2 of [-1, 1] as const) {
        g.add(place(make(roundedBox(0.10, 0.26, 1.10, 0.05, 2), trim), [s2 * 0.98, 0.06, 0.10], [0, 0, s2 * 0.1]));
      }
      // 鞋底缝线
      for (let i = 0; i < 10; i += 1) {
        g.add(place(make(new THREE.SphereGeometry(0.022, 8, 6), trim), [-0.80 + i * 0.178, -0.76, 1.10]));
      }
      break;
    }
    case 'nails': {
      const gloss = createAccMaterial(c1, { spec: 0.85, rough: 0.15, glow: 0.06 });
      const sparkle = createAccMaterial('#ffffff', { spec: 1, opacity: 0.9 });
      for (const dx of [-0.44, 0, 0.44] as const) {
        const tip = make(new THREE.ConeGeometry(0.13, 0.22, 10), gloss);
        place(tip, [dx, 0.62, 0.72], [1.25, 0, 0]);
        g.add(tip);
        g.add(place(make(new THREE.SphereGeometry(0.030, 10, 8), sparkle), [dx - 0.03, 0.66, 0.80], [0, 0, 0], [1, 1.4, 0.4]));
      }
      break;
    }
    case 'glove': {
      const shell = make(roundedBox(1.70, 1.30, 1.90, 0.35, 3), cloth);
      g.add(place(shell, [0, 0.02, 0.06]));
      // 袖口罗纹
      g.add(place(make(new THREE.TorusGeometry(1.02, 0.16, 12, 28), trim), [0, -0.58, 0.06], [1.57, 0, 0]));
      for (let i = 0; i < 20; i += 1) {
        const a = (i / 20) * Math.PI * 2;
        g.add(
          place(
            make(new THREE.CapsuleGeometry(0.026, 0.14, 4, 6), trim),
            [Math.sin(a) * 1.04, -0.66, 0.06 + Math.cos(a) * 1.04],
            [0, -a, 0],
          ),
        );
      }
      // 手背护块 + 指缝
      g.add(place(make(roundedBox(1.10, 0.16, 1.30, 0.10, 2), trim), [0, 0.56, 0.02], [0.05, 0, 0]));
      for (const dx of [-0.55, 0.55]) {
        g.add(place(make(new THREE.CapsuleGeometry(0.030, 0.9, 4, 8), trim), [dx, 0.60, 0.02], [0, 0, 0]));
      }
      break;
    }
    default:
      return g;
  }
  return g;
}

// ---------------------------------------------------------------- 地面（catRoot 局部，y≈0）

function buildFloor(shape: string, c1: string, c2: string): THREE.Group {
  const g = new THREE.Group();
  const base = createAccMaterial(c1, { spec: 0.10, rim: 0.24 });
  const accent = createAccMaterial(c2, { spec: 0.16, rim: 0.24 });
  const soft = createAccMaterial(c1, { spec: 0.04, rim: 0.3 });

  switch (shape) {
    case 'cushion': {
      buildCushionFine(g, c1, c2);
      break;
    }
    case 'rug': {
      const rug = make(new THREE.CircleGeometry(1.02, 40), soft);
      rug.geometry.rotateX(-Math.PI / 2);
      place(rug, [0, 0.004, 0.02], [0, 0, 0], [1, 1, 0.86]);
      g.add(rug);
      // 同心纹样 + 中央小花 + 周围流苏
      for (const [rr, tube] of [[0.86, 0.018], [0.72, 0.026], [0.52, 0.018], [0.30, 0.014]] as const) {
        g.add(place(make(new THREE.TorusGeometry(rr, tube, 8, 48), accent), [0, 0.006, 0.02], [Math.PI / 2, 0, 0], [1, 1, 0.86]));
      }
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2;
        g.add(
          place(
            make(new THREE.SphereGeometry(0.045, 10, 8), accent),
            [Math.sin(a) * 0.20, 0.014, Math.cos(a) * 0.20 * 0.86 + 0.02],
            [0, 0, 0],
            [1, 0.45, 1],
          ),
        );
      }
      for (let i = 0; i < 40; i += 1) {
        const a = (i / 40) * Math.PI * 2;
        g.add(
          make(
            taperTube(
              [
                [Math.sin(a) * 1.02, 0.006, Math.cos(a) * 1.02 * 0.86 + 0.02],
                [Math.sin(a) * 1.13, 0.004, Math.cos(a) * 1.13 * 0.86 + 0.02],
              ],
              0.014,
              0.008,
              4,
              4,
            ),
            accent,
          ),
        );
      }
      break;
    }
    case 'box': {
      const wall = 0.06;
      g.add(place(make(roundedBox(1.30, wall, 1.10, 0.02, 1), base), [0, 0.03, 0]));
      for (const s of [-1, 1] as const) {
        g.add(place(make(roundedBox(1.30, 0.42, wall, 0.02, 1), base), [0, 0.22, s * 0.55]));
        g.add(place(make(roundedBox(wall, 0.42, 1.10, 0.02, 1), base), [s * 0.65, 0.22, 0]));
      }
      // 四片翻盖（向外翻）+ 胶带 + 側面标签
      const card = createAccMaterial('#c8a878', { spec: 0.06, rough: 0.95 });
      for (const s of [-1, 1] as const) {
        g.add(place(make(roundedBox(1.28, 0.26, 0.05, 0.02, 1), card), [0, 0.46, s * 0.72], [s * 0.55, 0, 0]));
        g.add(place(make(roundedBox(0.05, 0.26, 1.04, 0.02, 1), card), [s * 0.82, 0.46, 0], [0, 0, -s * 0.55]));
      }
      g.add(place(make(roundedBox(1.30, 0.30, 0.02, 0.02, 1), accent), [0, 0.15, -0.565], [0.32, 0, 0]));
      g.add(place(make(roundedBox(0.16, 0.30, 0.025, 0.006, 1), accent), [0, 0.30, -0.58], [0.32, 0, 0]));
      g.add(place(make(roundedBox(0.30, 0.16, 0.010, 0.006, 1), accent), [0.30, 0.20, 0.56]));
      break;
    }
    case 'treeBase': {
      g.add(place(make(new THREE.CylinderGeometry(0.72, 0.78, 0.12, 26), base), [0, 0.06, -0.05]));
      g.add(place(make(new THREE.CylinderGeometry(0.085, 0.095, 0.70, 14), accent), [0.42, 0.44, -0.30]));
      g.add(place(make(new THREE.CylinderGeometry(0.40, 0.40, 0.09, 22), base), [0.42, 0.82, -0.30]));
      // 剑麻缠绕纹（柱子上的一圈圈）
      for (let i = 0; i < 10; i += 1) {
        g.add(place(make(new THREE.TorusGeometry(0.093, 0.010, 6, 18), accent), [0.42, 0.14 + i * 0.062, -0.30], [Math.PI / 2, 0, 0]));
      }
      // 第二根柱子 + 顶台 + 吊球
      g.add(place(make(new THREE.CylinderGeometry(0.070, 0.080, 0.52, 12), accent), [-0.40, 0.32, -0.34]));
      g.add(place(make(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 20), base), [-0.40, 0.60, -0.34]));
      g.add(make(taperTube([[-0.10, 0.90, -0.20], [0.02, 0.78, -0.16], [0.06, 0.66, -0.14]], 0.006, 0.006, 10, 4), accent));
      g.add(place(make(new THREE.SphereGeometry(0.075, 14, 12), accent), [0.06, 0.62, -0.14]));
      break;
    }
    case 'cabin': {
      g.add(place(make(roundedBox(1.10, 0.52, 0.90, 0.04, 2), base), [0, 0.26, -0.12]));
      const roof = make(new THREE.CylinderGeometry(0.72, 0.72, 1.16, 3), accent);
      place(roof, [0, 0.66, -0.12], [0, 0, Math.PI / 2], [1, 1, 1]);
      g.add(roof);
      // 瓦片纹理（横向几道）
      for (let i = 0; i < 3; i += 1) {
        g.add(place(make(new THREE.CylinderGeometry(0.70 - i * 0.06, 0.70 - i * 0.06, 1.14, 3), base), [0, 0.60 - i * 0.11, -0.12], [0, 0, Math.PI / 2], [1.02, 1, 1.02]));
      }
      // 门 + 窗 + 烟囱
      g.add(place(make(roundedBox(0.26, 0.34, 0.06, 0.03, 2), accent), [0, 0.16, 0.34]));
      g.add(place(make(new THREE.SphereGeometry(0.012, 8, 6), createAccMaterial('#e8d8a8', { spec: 0.8, rough: 0.2 })), [0.08, 0.16, 0.38]));
      g.add(place(make(roundedBox(0.18, 0.16, 0.05, 0.02, 2), createAccMaterial('#8fd0f0', { spec: 0.55, rough: 0.2 })), [-0.30, 0.30, 0.34]));
      g.add(place(make(new THREE.CylinderGeometry(0.07, 0.08, 0.26, 10), base), [0.30, 0.66, -0.32]));
      break;
    }
    case 'mat': {
      const mat = make(roundedBox(1.34, 0.035, 1.10, 0.10, 2), soft);
      g.add(place(mat, [0, 0.018, 0.02]));
      // 绗缝网格 + 四角流苏
      for (const dx of [-0.42, 0, 0.42]) {
        g.add(seamTube([[dx, 0.040, -0.44], [dx, 0.040, 0.48]], 0.006, 0.006, accent, 8, 4));
      }
      for (const dz of [-0.30, 0.10, 0.44]) {
        g.add(seamTube([[-0.56, 0.040, dz], [0.56, 0.040, dz]], 0.006, 0.006, accent, 8, 4));
      }
      g.add(place(make(new THREE.TorusGeometry(0.44, 0.012, 6, 30), accent), [0, 0.042, 0.02], [Math.PI / 2, 0, 0], [1, 1, 0.82]));
      for (const [dx, dz] of [[-0.60, -0.44], [0.60, -0.44], [-0.60, 0.48], [0.60, 0.48]] as const) {
        g.add(make(taperTube([[dx, 0.030, dz], [dx * 1.08, 0.010, dz * 1.06]], 0.014, 0.007, 6, 4), accent));
      }
      break;
    }
    case 'snowPit': {
      const pit = make(new THREE.CylinderGeometry(0.96, 0.80, 0.14, 30), soft);
      g.add(place(pit, [0, 0.03, 0], [0, 0, 0], [1, 1, 0.9]));
      g.add(place(make(new THREE.TorusGeometry(0.92, 0.075, 10, 34), accent), [0, 0.075, 0], [0, 0, 0], [1, 1, 0.9]));
      // 雪堆：几团起伏 + 脚印
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        g.add(
          place(
            make(new THREE.SphereGeometry(0.16, 14, 10), base),
            [Math.sin(a) * 0.98, 0.06, Math.cos(a) * 0.98 * 0.9],
            [0, 0, 0],
            [1, 0.55, 1],
          ),
        );
      }
      for (const [dx, dz] of [[-0.18, 0.20], [0.05, 0.02], [0.26, -0.16]] as const) {
        g.add(place(make(new THREE.SphereGeometry(0.085, 12, 10), accent), [dx, 0.030, dz], [0, 0, 0], [1, 0.35, 1.15]));
      }
      break;
    }
    default:
      return g;
  }
  return g;
}

// ---------------------------------------------------------------- 道具（catRoot 局部，猫右前方）

function buildProp(shape: string, c1: string, c2: string): THREE.Group {
  const g = new THREE.Group();
  const base = createAccMaterial(c1, { spec: 0.22, rim: 0.28 });
  const accent = createAccMaterial(c2, { spec: 0.34, rim: 0.28 });

  switch (shape) {
    case 'propFish': {
      buildFishFine(g, base, accent);
      break;
    }
    case 'propCup': {
      buildCupFine(g, base, accent);
      break;
    }
    case 'propBook': {
      buildBookFine(g, base, accent);
      break;
    }
    case 'propYarn': {
      buildYarnFine(g, base, accent);
      break;
    }
    case 'propUmbrella': {
      buildUmbrellaFine(g, base, accent);
      break;
    }
    case 'wand': {
      buildWandFine(g, base, accent);
      break;
    }
    case 'phone': {
      buildPhoneFine(g, base, accent);
      break;
    }
    case 'donut': {
      buildDonutFine(g, base, accent);
      break;
    }
    case 'lollipop': {
      buildLollipopFine(g, base, accent);
      break;
    }
    case 'balloon': {
      buildBalloonFine(g, c1, c2);
      break;
    }
    case 'camera': {
      buildCameraFine(g, base, accent);
      break;
    }
    case 'mic': {
      buildMicFine(g, base, accent);
      break;
    }
    case 'telescope': {
      buildTelescopeFine(g, base, accent);
      break;
    }
    case 'wrench': {
      buildWrenchFine(g, base, accent);
      break;
    }
    case 'pillBottle': {
      buildBottleFine(g, base, accent);
      break;
    }
    case 'miniKeyboard': {
      buildKeyboardFine(g, base, accent);
      break;
    }
    case 'notepad': {
      buildNotepadFine(g, base, accent);
      break;
    }
    case 'fishbowl': {
      buildBowlFine(g, c1, c2);
      break;
    }
    case 'pencil': {
      buildPencilFine(g, base, accent);
      break;
    }
    default:
      return g;
  }
  return g;
}


// ---------------------------------------------------------------- 精细版：小道具

function buildUmbrellaFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  // 伞面：八片，边缘略下垂
  const canopy = make(new THREE.ConeGeometry(0.42, 0.26, 8, 1, true), base);
  place(canopy, [0, 0.62, 0]);
  g.add(canopy);
  // 伞骨
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    g.add(
      seamTube(
        [
          [0, 0.75, 0],
          [Math.sin(a) * 0.24, 0.68, Math.cos(a) * 0.24],
          [Math.sin(a) * 0.41, 0.60, Math.cos(a) * 0.41],
        ],
        0.008,
        0.006,
        accent,
        10,
        5,
      ),
    );
  }
  // 伞尖 + 伞杆 + 弯柄
  g.add(place(make(new THREE.CylinderGeometry(0.010, 0.010, 0.06, 8), accent), [0, 0.77, 0]));
  g.add(place(make(new THREE.SphereGeometry(0.018, 12, 10), accent), [0, 0.80, 0]));
  g.add(place(make(new THREE.CylinderGeometry(0.014, 0.014, 0.58, 10), accent), [0, 0.31, 0]));
  g.add(
    make(
      taperTube(
        [
          [0, 0.02, 0],
          [0.03, -0.03, 0.01],
          [0.10, -0.03, 0.01],
          [0.12, 0.02, 0.01],
        ],
        0.014,
        0.012,
        12,
        6,
      ),
      accent,
    ),
  );
  // 伞面边缘的滚边
  g.add(place(make(new THREE.TorusGeometry(0.415, 0.012, 8, 34), accent), [0, 0.505, 0], [Math.PI / 2, 0, 0]));
}

function buildWandFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  // 杆：带螺旋缠绕
  g.add(place(make(new THREE.CylinderGeometry(0.014, 0.016, 0.50, 12), accent), [0, 0.25, 0], [0, 0, -0.14]));
  const gold = createAccMaterial('#e8c86a', { spec: 0.9, rough: 0.18 });
  for (let i = 0; i < 10; i += 1) {
    const t = i / 10;
    g.add(
      make(
        taperTube(
          [
            [-t * 0.14 + 0.012, 0.05 + t * 0.44, 0.016],
            [-t * 0.14 + 0.008, 0.065 + t * 0.44, 0.0],
            [-t * 0.14 + 0.012, 0.05 + t * 0.44, -0.016],
          ],
          0.006,
          0.006,
          6,
          4,
        ),
        gold,
      ),
    );
  }
  // 星形杖头
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 ? 0.042 : 0.090;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) starShape.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else starShape.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  starShape.closePath();
  const star = make(
    new THREE.ExtrudeGeometry(starShape, { depth: 0.030, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 }),
    createAccMaterial('#ffd95e', { spec: 0.85, rough: 0.14, glow: 0.20 }),
  );
  place(star, [-0.075, 0.575, 0], [0, 0, -0.14]);
  g.add(star);
  // 星周围的小星点
  for (const [dx, dy, dz, sc] of [[0.02, 0.62, 0.02, 0.028], [-0.16, 0.50, 0.02, 0.020], [-0.02, 0.48, -0.02, 0.016]] as const) {
    g.add(place(make(new THREE.SphereGeometry(sc, 10, 8), gold), [dx, dy, dz], [0, 0, 0], [1, 1.5, 0.5]));
  }
}

function buildPhoneFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  // 机身 + 中框高光
  g.add(place(make(roundedBox(0.255, 0.455, 0.042, 0.046, 3), base), [0, 0.23, 0], [0, 0, 0.05]));
  g.add(place(make(roundedBox(0.262, 0.462, 0.028, 0.045, 2), createAccMaterial('#8a8f9a', { spec: 0.7, rough: 0.25 })), [0, 0.23, 0], [0, 0, 0.05]));
  // 屏幕
  const screen = make(new THREE.PlaneGeometry(0.215, 0.405), createAccMaterial('#22303c', { spec: 0.4, rough: 0.2 }));
  g.add(place(screen, [0, 0.232, 0.024], [0, 0, 0.05]));
  // 屏幕里的 App 块
  const appMat = createAccMaterial('#ffffff', { spec: 0.2, opacity: 0.55 });
  for (let r = 0; r < 4; r += 1) {
    for (let c2i = 0; c2i < 3; c2i += 1) {
      g.add(place(make(new THREE.PlaneGeometry(0.042, 0.042), appMat), [-0.062 + c2i * 0.062, 0.34 - r * 0.058, 0.026], [0, 0, 0.05]));
    }
  }
  // 刘海 + 听筒
  g.add(place(make(roundedBox(0.085, 0.020, 0.006, 0.008, 2), createAccMaterial('#1c1c20', { spec: 0.3 })), [0, 0.415, 0.027], [0, 0, 0.05]));
  // 侧键
  g.add(place(make(new THREE.BoxGeometry(0.008, 0.060, 0.016), accent), [0.132, 0.28, 0]));
  g.add(place(make(new THREE.BoxGeometry(0.008, 0.038, 0.016), accent), [-0.132, 0.30, 0]));
}

function buildLollipopFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  g.add(place(make(new THREE.CylinderGeometry(0.011, 0.011, 0.30, 10), accent), [0, 0.15, 0]));
  // 糖体
  const candy = make(new THREE.CylinderGeometry(0.135, 0.135, 0.055, 32), base);
  place(candy, [0, 0.39, 0], [Math.PI / 2, 0, 0]);
  g.add(candy);
  // 螺旋纹：一圈渐缩的管
  const spiral: Array<[number, number, number]> = [];
  for (let i = 0; i <= 60; i += 1) {
    const t = i / 60;
    const a = t * Math.PI * 5.2;
    const r = 0.128 * (1 - t * 0.92);
    spiral.push([Math.cos(a) * r, 0.395 + Math.sin(a) * r, 0.030]);
  }
  g.add(seamTube(spiral, 0.014, 0.006, accent, 60, 5));
  // 包装纸边 + 高光
  g.add(place(make(new THREE.TorusGeometry(0.136, 0.010, 8, 30), accent), [0, 0.39, 0.026], [0, 0, 0]));
  g.add(place(make(new THREE.SphereGeometry(0.030, 12, 10), createAccMaterial('#ffffff', { spec: 1, opacity: 0.6 })), [0.045, 0.445, 0.038], [0, 0, 0], [1.4, 1, 0.4]));
}

function buildBalloonFine(g: THREE.Group, c1: string, c2: string): void {
  const accent = createAccMaterial(c2, { spec: 0.3, rim: 0.3, rough: 0.5 });
  const ball = make(new THREE.SphereGeometry(0.17, 24, 18), createAccMaterial(c1, { spec: 0.55, rim: 0.55, rough: 0.22 }));
  place(ball, [0, 0.46, 0], [0, 0, 0], [1, 1.16, 1]);
  g.add(ball);
  // 气球嘴
  g.add(place(make(new THREE.ConeGeometry(0.028, 0.05, 10), accent), [0, 0.285, 0], [Math.PI, 0, 0]));
  // 绳子：略带卷曲
  g.add(
    make(
      taperTube(
        [
          [0, 0.27, 0],
          [0.035, 0.19, 0.01],
          [-0.020, 0.11, -0.01],
          [0.028, 0.04, 0.01],
          [0, 0.0, 0],
        ],
        0.0065,
        0.005,
        22,
        4,
      ),
      accent,
    ),
  );
  // 高光
  g.add(place(make(new THREE.SphereGeometry(0.045, 14, 12), createAccMaterial('#ffffff', { spec: 1, opacity: 0.55 })), [-0.06, 0.53, 0.10], [0, 0, 0], [1, 1.4, 0.4]));
}

function buildCameraFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  // 机身 + 顶部取景凸起
  g.add(place(make(roundedBox(0.36, 0.23, 0.19, 0.030, 3), base), [0, 0.16, 0]));
  g.add(place(make(roundedBox(0.10, 0.055, 0.10, 0.014, 2), accent), [0.02, 0.30, 0]));
  // 镜头组：三道环
  for (const [dz, rr, tube] of [[0.098, 0.085, 0.017], [0.112, 0.070, 0.010], [0.122, 0.055, 0.008]] as const) {
    g.add(place(make(new THREE.TorusGeometry(rr, tube, 10, 30), createAccMaterial('#9aa2ae', { spec: 0.85, rough: 0.2 })), [0, 0.16, dz]));
  }
  g.add(place(make(new THREE.CircleGeometry(0.048, 26), createAccMaterial('#2a3340', { spec: 0.9, rough: 0.1 })), [0, 0.16, 0.124]));
  // 反光点
  g.add(place(make(new THREE.CircleGeometry(0.016, 14), createAccMaterial('#cfe6ff', { spec: 1, opacity: 0.9 })), [-0.016, 0.178, 0.126]));
  // 闪光灯 + 快门 + 挂绳
  g.add(place(make(roundedBox(0.055, 0.030, 0.012, 0.006, 1), createAccMaterial('#fff3cc', { spec: 0.7, glow: 0.15 })), [-0.12, 0.275, 0.075]));
  g.add(place(make(new THREE.CylinderGeometry(0.018, 0.018, 0.020, 14), accent), [0.13, 0.282, 0]));
  g.add(
    make(
      taperTube(
        [
          [-0.17, 0.22, 0],
          [-0.24, 0.14, 0.02],
          [-0.22, 0.04, 0.04],
        ],
        0.007,
        0.006,
        12,
        4,
      ),
      accent,
    ),
  );
}

function buildMicFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  // 手柄
  g.add(place(make(new THREE.CylinderGeometry(0.048, 0.060, 0.24, 18), accent), [0, 0.12, 0]));
  // 手柄上的环
  for (const dy of [0.03, 0.10, 0.17]) {
    g.add(place(make(new THREE.TorusGeometry(0.053, 0.007, 8, 22), createAccMaterial('#9aa0aa', { spec: 0.8, rough: 0.25 })), [0, dy, 0], [Math.PI / 2, 0, 0]));
  }
  // 网罩
  g.add(place(make(new THREE.SphereGeometry(0.078, 22, 16), base), [0, 0.27, 0], [0, 0, 0], [1, 1.15, 1]));
  // 网纹：经纬细线
  for (let i = 0; i < 5; i += 1) {
    const y = 0.245 + i * 0.020;
    const rr = Math.sqrt(Math.max(0.0001, 0.078 * 0.078 - Math.pow(y - 0.27, 2))) * 1.0;
    g.add(place(make(new THREE.TorusGeometry(rr, 0.0045, 6, 24), createAccMaterial('#5a5f68', { spec: 0.6, rough: 0.3 })), [0, y, 0], [Math.PI / 2, 0, 0]));
  }
  // 开关
  g.add(place(make(roundedBox(0.030, 0.014, 0.010, 0.004, 1), createAccMaterial('#c8423a', { spec: 0.5 })), [0, 0.055, 0.056]));
}

function buildTelescopeFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  // 主筒 + 副筒（伸缩结构）
  g.add(place(make(new THREE.CylinderGeometry(0.088, 0.098, 0.26, 20), base), [0, 0.34, 0], [0.85, 0, 0.22]));
  g.add(place(make(new THREE.CylinderGeometry(0.072, 0.082, 0.14, 20), accent), [0.085, 0.455, 0.035], [0.85, 0, 0.22]));
  // 环箍
  for (const [dx, dy, dz, rr] of [[0.02, 0.40, 0.005, 0.098], [0.055, 0.435, 0.02, 0.088], [0.11, 0.478, 0.045, 0.080]] as const) {
    g.add(place(make(new THREE.TorusGeometry(rr, 0.010, 8, 24), createAccMaterial('#b9a87a', { spec: 0.7, rough: 0.3 })), [dx, dy, dz], [0.85 + Math.PI / 2, 0, 0.22]));
  }
  // 目镜 + 遮光罩
  g.add(place(make(new THREE.CylinderGeometry(0.058, 0.050, 0.045, 18), accent), [-0.075, 0.255, -0.036], [0.85, 0, 0.22]));
  // 三脚架
  for (const [ax, az] of [[-1, 0.1], [0.7, 0.7], [0.7, -0.6]] as const) {
    g.add(
      make(
        taperTube(
          [
            [0, 0.22, 0],
            [ax * 0.10, 0.10, az * 0.10],
            [ax * 0.20, 0.0, az * 0.20],
          ],
          0.012,
          0.009,
          10,
          5,
        ),
        accent,
      ),
    );
  }
  // 支架连接件
  g.add(place(make(new THREE.SphereGeometry(0.028, 14, 10), accent), [0, 0.225, 0]));
}

function buildWrenchFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  // 手柄（略带弧度）
  g.add(
    make(
      taperTube(
        [
          [0.02, 0.02, 0],
          [-0.04, 0.14, 0],
          [-0.075, 0.28, 0],
          [-0.09, 0.36, 0],
        ],
        0.036,
        0.030,
        16,
        8,
      ),
      base,
    ),
  );
  // 开口钳头：两段弧形
  const jawMat = createAccMaterial('#b8bec8', { spec: 0.85, rough: 0.22 });
  for (const s2 of [-1, 1] as const) {
    g.add(
      make(
        taperTube(
          [
            [-0.09, 0.35, 0],
            [-0.115 + s2 * 0.045, 0.42, 0],
            [-0.10 + s2 * 0.085, 0.44, 0],
          ],
          0.026,
          0.016,
          10,
          6,
        ),
        jawMat,
      ),
    );
  }
  // 尺寸刻纹
  for (let i = 0; i < 5; i += 1) {
    g.add(place(make(new THREE.BoxGeometry(0.012, 0.004, 0.004), accent), [-0.045 + i * 0.004, 0.10 + i * 0.045, 0.030], [0, 0, 0.2]));
  }
}

function buildBottleFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  // 瓶身 + 圆肩
  g.add(place(make(new THREE.CylinderGeometry(0.100, 0.100, 0.22, 26), base), [0, 0.11, 0]));
  g.add(place(make(new THREE.SphereGeometry(0.100, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), base), [0, 0.22, 0], [0, 0, 0], [1, 0.5, 1]));
  // 瓶盖：带竖棱
  const capMat = createAccMaterial('#e8eef6', { spec: 0.45, rough: 0.35 });
  g.add(place(make(new THREE.CylinderGeometry(0.062, 0.064, 0.060, 20), capMat), [0, 0.285, 0]));
  for (let i = 0; i < 18; i += 1) {
    const a = (i / 18) * Math.PI * 2;
    g.add(place(make(new THREE.BoxGeometry(0.006, 0.052, 0.006), capMat), [Math.sin(a) * 0.064, 0.285, Math.cos(a) * 0.064], [0, -a, 0]));
  }
  // 标签：白底 + 两行字位 + 十字标记
  const labelMat = createAccMaterial('#f6f4ee', { spec: 0.12, rough: 0.6 });
  g.add(place(make(new THREE.CylinderGeometry(0.102, 0.102, 0.115, 26, 1, true), labelMat), [0, 0.115, 0]));
  g.add(place(make(new THREE.BoxGeometry(0.10, 0.010, 0.004), createAccMaterial('#c8423a', { spec: 0.2 })), [0, 0.135, 0.101]));
  g.add(place(make(new THREE.BoxGeometry(0.070, 0.008, 0.004), createAccMaterial('#8a8f9a', { spec: 0.2 })), [0, 0.112, 0.101]));
  // 十字
  g.add(place(make(new THREE.BoxGeometry(0.050, 0.014, 0.004), createAccMaterial('#c8423a', { spec: 0.2 })), [0, 0.082, 0.101]));
  g.add(place(make(new THREE.BoxGeometry(0.014, 0.050, 0.004), createAccMaterial('#c8423a', { spec: 0.2 })), [0, 0.082, 0.101]));
}

function buildKeyboardFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  // 外壳 + 内凹面
  g.add(place(make(roundedBox(0.44, 0.055, 0.31, 0.018, 3), base), [0, 0.028, 0]));
  g.add(place(make(roundedBox(0.415, 0.020, 0.285, 0.010, 2), createAccMaterial('#3a3d46', { spec: 0.2, rough: 0.6 })), [0, 0.052, 0]));
  // 键帽：4 行，空格加长
  const keyMat = createAccMaterial('#4a4e58', { spec: 0.25, rough: 0.5 });
  const accentKey = createAccMaterial('#c8f538', { spec: 0.35, rough: 0.4, glow: 0.05 });
  for (let r = 0; r < 3; r += 1) {
    for (let c2i = 0; c2i < 6; c2i += 1) {
      g.add(
        place(
          make(roundedBox(0.052, 0.028, 0.052, 0.008, 2), r === 1 && c2i === 2 ? accentKey : keyMat),
          [-0.165 + c2i * 0.066, 0.076, -0.088 + r * 0.068],
        ),
      );
    }
  }
  g.add(place(make(roundedBox(0.18, 0.028, 0.050, 0.008, 2), keyMat), [-0.02, 0.076, 0.116]));
  // 指示灯 + 线
  g.add(place(make(new THREE.SphereGeometry(0.008, 8, 6), createAccMaterial('#7ef09a', { spec: 0.6, glow: 0.2 })), [0.185, 0.062, -0.125]));
  g.add(make(taperTube([[0.21, 0.040, 0.02], [0.27, 0.020, 0.08], [0.31, 0.006, 0.02]], 0.007, 0.006, 12, 4), keyMat));
}

function buildNotepadFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  // 底板 + 纸页堆叠
  g.add(place(make(roundedBox(0.26, 0.026, 0.34, 0.012, 2), base), [0, 0.013, 0]));
  for (let i = 0; i < 4; i += 1) {
    g.add(place(make(roundedBox(0.232, 0.005, 0.305, 0.004, 1), createAccMaterial('#fbf8f0', { spec: 0.05, rough: 0.9 })), [0.004, 0.029 + i * 0.005, 0.012]));
  }
  // 横线
  for (let i = 0; i < 6; i += 1) {
    g.add(place(make(new THREE.BoxGeometry(0.19, 0.0015, 0.003), accent), [0.01, 0.052, -0.10 + i * 0.044]));
  }
  // 装订环
  for (let i = 0; i < 5; i += 1) {
    g.add(
      place(
        make(new THREE.TorusGeometry(0.020, 0.006, 8, 14, Math.PI * 1.4), createAccMaterial('#c8ccd4', { spec: 0.8, rough: 0.25 })),
        [-0.08 + i * 0.04, 0.048, -0.155],
        [Math.PI / 2, 0, 0],
      ),
    );
  }
  // 旁边放支铅笔
  g.add(place(make(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), accent), [0.10, 0.045, 0.10], [0, 0, Math.PI / 2], [1, 1, 1]));
  g.add(place(make(new THREE.ConeGeometry(0.012, 0.030, 8), createAccMaterial('#e8c08a', { spec: 0.2 })), [0.222, 0.045, 0.10], [0, 0, -Math.PI / 2]));
}

function buildBowlFine(g: THREE.Group, c1: string, c2: string): void {
  void c2;
  // 玻璃缸
  g.add(place(make(new THREE.SphereGeometry(0.175, 26, 18), createAccMaterial(c1, { spec: 0.65, opacity: 0.38, rim: 0.5 })), [0, 0.175, 0], [0, 0, 0], [1, 0.96, 1]));
  // 水面
  g.add(place(make(new THREE.CircleGeometry(0.150, 28), createAccMaterial('#9fe0f6', { spec: 0.5, opacity: 0.55 })), [0, 0.275, 0], [-Math.PI / 2, 0, 0]));
  // 缸口
  g.add(place(make(new THREE.TorusGeometry(0.108, 0.010, 8, 26), createAccMaterial('#cfe8f2', { spec: 0.8, opacity: 0.55 })), [0, 0.330, 0], [Math.PI / 2, 0, 0]));
  // 小鱼
  const fish2 = make(new THREE.SphereGeometry(0.050, 16, 12), createAccMaterial('#f2903c', { spec: 0.5, rough: 0.3 }));
  place(fish2, [0, 0.160, 0], [0, 0, 0], [1.6, 0.85, 0.55]);
  g.add(fish2);
  g.add(place(make(new THREE.ConeGeometry(0.032, 0.05, 4), createAccMaterial('#f2903c', { spec: 0.5 })), [-0.085, 0.160, 0], [0, 0, Math.PI / 2], [1, 1, 0.5]));
  g.add(place(make(new THREE.SphereGeometry(0.008, 8, 6), createAccMaterial('#2a2320', { spec: 0.6 })), [0.055, 0.172, 0.022]));
  // 底砂 + 水草
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * Math.PI * 2;
    g.add(place(make(new THREE.SphereGeometry(0.020, 8, 6), createAccMaterial(i % 2 ? '#c8b48a' : '#9aa4b8', { spec: 0.2, rough: 0.8 })), [Math.sin(a) * 0.11, 0.012, Math.cos(a) * 0.11]));
  }
  for (const s2 of [-1, 1] as const) {
    g.add(make(taperTube([[s2 * 0.07, 0.02, -0.06], [s2 * 0.09, 0.12, -0.07], [s2 * 0.05, 0.22, -0.06]], 0.010, 0.004, 10, 5), createAccMaterial('#4f9a52', { spec: 0.1, rough: 0.8 })));
  }
  // 玻璃高光
  g.add(place(make(new THREE.SphereGeometry(0.030, 14, 10), createAccMaterial('#ffffff', { spec: 1, opacity: 0.5 })), [-0.075, 0.245, 0.10], [0, 0, 0], [1, 1.8, 0.3]));
}

function buildPencilFine(g: THREE.Group, base: THREE.Material, accent: THREE.Material): void {
  // 六棱笔杆
  g.add(place(make(new THREE.CylinderGeometry(0.030, 0.030, 0.40, 6), base), [0, 0.20, 0], [0, 0, 0.10]));
  // 削开的木头
  g.add(place(make(new THREE.ConeGeometry(0.030, 0.075, 6), createAccMaterial('#e8c8a2', { spec: 0.12, rough: 0.8 })), [-0.020, 0.438, 0], [0, 0, 0.10]));
  // 笔芯
  g.add(place(make(new THREE.ConeGeometry(0.011, 0.030, 8), createAccMaterial('#3a3a42', { spec: 0.5, rough: 0.3 })), [-0.023, 0.470, 0], [0, 0, 0.10]));
  // 尾部金属箍 + 橡皮
  g.add(place(make(new THREE.CylinderGeometry(0.032, 0.032, 0.028, 10), createAccMaterial('#c8ccd4', { spec: 0.85, rough: 0.2 })), [0.020, 0.014, 0], [0, 0, 0.10]));
  g.add(place(make(new THREE.CylinderGeometry(0.030, 0.030, 0.030, 10), accent), [0.023, -0.012, 0], [0, 0, 0.10]));
}

// ---------------------------------------------------------------- 对外入口

export type AccSlotKind = 'head' | 'face' | 'neck' | 'back' | 'paw' | 'floor' | 'prop';

export function slotKindOf(slot: string): AccSlotKind {
  if (slot === 'head' || slot === 'face' || slot === 'back' || slot === 'paw' || slot === 'floor' || slot === 'prop') {
    return slot;
  }
  return 'neck';
}

/**
 * 构建一件配饰。返回的 Group 已经在「挂点局部坐标系」里，
 * 引擎只要 add 到 headMount / neckMount / catRoot 即可参与深度遮挡。
 */
export function buildAccessory3D(
  shape: string,
  c1: string,
  c2: string,
  slot: string,
  ctx: Acc3DCtx,
  id = '',
): THREE.Group | null {
  const kind = slotKindOf(slot);
  let g: THREE.Group;
  switch (kind) {
    case 'head':
      g = buildHead(shape, c1, c2, ctx);
      break;
    case 'face':
      g = buildFace(shape, c1, c2, ctx, id);
      break;
    case 'neck':
      g = buildNeck(shape, c1, c2, ctx);
      break;
    case 'back':
      g = buildBack(shape, c1, c2, ctx);
      break;
    case 'paw':
      g = buildPaw(shape, c1, c2);
      break;
    case 'floor':
      g = buildFloor(shape, c1, c2);
      break;
    case 'prop':
      g = buildProp(shape, c1, c2);
      break;
    default:
      return null;
  }
  if (g.children.length === 0) return null;
  // 地面件要露在身体两侧，道具放在猫右手边
  if (kind === 'floor') g.scale.setScalar(1.30);
  if (kind === 'prop') {
    g.position.set(-0.86, 0.0, 0.42);
    g.scale.setScalar(1.30);
  }
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.frustumCulled = false;
  });
  return g;
}
