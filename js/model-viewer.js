/* ============================================================
   model-viewer.js — stage renderer: assets/mug.glb via three.js r162
   (Rewritten 2026-10-05 — recipes ported from mug-editor, MIT)

   Realism (mug-editor pipeline):
     ① bundled CC0 studio HDRI (assets/hdr/studio_small_09_1k.hdr) → PMREM
        environment, env rotation 0.35π, intensity 0.9 (procedural studio
        env kept as offline fallback)
     ② NEUTRAL tone mapping (r162) — keeps saturated artwork from
        flattening the way ACES does
     ③ glaze: procedural roughnessMap (0.5 base blotches) + orange-peel
        normalMap (repeat 4×2, scaled 0.05), MeshPhysicalMaterial
        clearcoat 1 / ccRough 0.07 / ior 1.5; inner + handle get their
        own plain materials (print = body only)
     ④ key light one-shot shadow (autoUpdate off, refreshed on yaw delta)
     ⑤ draw-on-demand + adaptive pixel ratio (EMA budget), DPR cap 1.5

   Print mapping (#1 fix — geometry measured at runtime):
     wrap band x(mm) → u = 1 + (wrap.w/2 − x)/texCirc  (mod 1)
       · band spans w/texCirc of the circumference; texCirc = R·257.6 mm
         where R = cup slim scale (see dispCirc) — the cup model is scaled
         to the design width, so the image keeps its native ratio and the
         design edge (notch) lands on the handle feet (no image stretch)
       · band centre (앞면 중심) lands at local angle 180° (opposite the
         handle); stage default yaw turns it toward the camera
       · canvas y → wall v via measured v(y) fit → artwork stays upright

   app.js hooks: __mvSize() / __mvClamp() / __mvDraw(t), global `mug`.
   ============================================================ */
'use strict';

let THREE = null, GLTFLoaderCls = null, RGBELoaderCls = null;
let renderer = null, scene = null, camera = null, root = null;
let tex = null, bandCanvas = null;
let bodyMat = null, handleMat = null, innerMat = null, glazeMaps = null;
let wallFit = null;                          // v = a + b*y on the straight wall
let glCanvas = null, homeDist = 3.9, glFailed = false, inited = false;
let lastSig = '', lastVer = -1, lastWrapKey = '', dirty = true;
let frameEMA = 16, frameN = 0, prScale = 1;
let yawSinceShadow = 0, lastShadowYaw = 0;
let yawOffset = 2.0908;                     // design front (u=0.5, local 180°) -> camera at th=0 (ray-measured; fit at yaw=0)

const GLB_URL = 'assets/mug.glb?v=20261005m';
const HDR_URL = 'assets/hdr/studio_small_09_1k.hdr?v=1';
const STAGE_BG = 0x12151d;

/* physical scale: body radius 0.8 units == 41 mm (11oz Ø8.2cm) */
const UNITS_PER_MM = 0.8 / 41;
const CIRC_MM = (2 * Math.PI * 0.8) / UNITS_PER_MM;   // ≈257.6 mm

/* 컵 3D 스케일 (요청: 이미지가 아닌 컵 모델을 스케일 — 이미지 비율 불변):
   랩 폭 w가 핸들 발끝(±6.6°)에 닿도록 몸통 원주를 가늘게 줄인다.
   w≥248·하한 0.6 밖에서는 원본 원주 유지(이미지 왜곡 0, 갭은 신실하게). */
const HANDLE_HALF_DEG = 6.6;
function dispCirc(w) {
  const span = 1 - (2 * HANDLE_HALF_DEG) / 360;                 // 0.96333 = art→handle-feet
  const R = Math.max(0.6, Math.min(1, w / (span * CIRC_MM)));   // slim ratio (0.6 … 1)
  return { R, texCirc: R * CIRC_MM };
}
let slim = null, lastSlimR = -1;
function applySlim() {
  if (!slim) return false;
  const R = dispCirc(state && state.wrap ? state.wrap.w : 205).R;
  if (R === lastSlimR) return false;
  slim.scale.set(R, 1, R);           // radius만 스케일(세로 유지 → 실물 비율)
  lastSlimR = R;
  return true;
}

let libsPromise = null, libsFailed = false;
async function ensureLibs() {
  if (THREE && GLTFLoaderCls && RGBELoaderCls) return;
  THREE = await import('three');
  GLTFLoaderCls = (await import('../vendor/GLTFLoader.js')).GLTFLoader;
  RGBELoaderCls = (await import('../vendor/RGBELoader.js')).RGBELoader;
}
function ensureLibsLazy() {
  if (!libsPromise) {
    libsPromise = ensureLibs().catch((e) => {
      console.warn('three.js dynamic import failed', e);
      libsFailed = true;
    });
  }
  return libsPromise;
}

/* ================= ③ procedural glaze maps (mug-editor glazeTextures.ts) === */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const _smooth = (t) => t * t * (3 - 2 * t);
function _valueNoise(cells, rand, SIZE) {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(SIZE * SIZE);
  const scale = cells / SIZE;
  for (let y = 0; y < SIZE; y++) {
    const fy = y * scale, y0 = Math.floor(fy), y1 = (y0 + 1) % cells, ty = _smooth(fy - y0);
    for (let x = 0; x < SIZE; x++) {
      const fx = x * scale, x0 = Math.floor(fx), x1 = (x0 + 1) % cells, tx = _smooth(fx - x0);
      const top = lattice[y0 * cells + x0] + (lattice[y0 * cells + x1] - lattice[y0 * cells + x0]) * tx;
      const bot = lattice[y1 * cells + x0] + (lattice[y1 * cells + x1] - lattice[y1 * cells + x0]) * tx;
      out[y * SIZE + x] = top + (bot - top) * ty;
    }
  }
  return out;
}
function _fbm(cellsPerOctave, rand, SIZE) {
  const out = new Float32Array(SIZE * SIZE);
  let amp = 1, total = 0;
  for (const c of cellsPerOctave) {
    const o = _valueNoise(c, rand, SIZE);
    for (let i = 0; i < out.length; i++) out[i] += o[i] * amp;
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}
const _clamp01 = (v) => Math.min(1, Math.max(0, v));
function createGlazeMaps() {
  const SIZE = 512;
  const rand = mulberry32(0x6d75_6773);
  const mk = (data) => {
    const c = document.createElement('canvas');
    c.width = SIZE; c.height = SIZE;
    c.getContext('2d').putImageData(new ImageData(data, SIZE, SIZE), 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 2);
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const blotches = _fbm([4, 8, 16, 32], rand, SIZE);
  const rd = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = _clamp01(0.5 + (blotches[i] - 0.5) * 0.08 + (rand() - 0.5) * 0.015);
    const b = Math.round(v * 255);
    rd[i * 4] = b; rd[i * 4 + 1] = b; rd[i * 4 + 2] = b; rd[i * 4 + 3] = 255;
  }
  const height = _fbm([12, 24], rand, SIZE);
  const strength = 4;
  const nd = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    const up = ((y - 1 + SIZE) % SIZE) * SIZE, down = ((y + 1) % SIZE) * SIZE, row = y * SIZE;
    for (let x = 0; x < SIZE; x++) {
      const left = (x - 1 + SIZE) % SIZE, right = (x + 1) % SIZE;
      const dx = (height[row + right] - height[row + left]) * strength;
      const dy = (height[down + x] - height[up + x]) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (row + x) * 4;
      nd[i] = Math.round((-dx / len) * 0.5 * 255 + 127.5);
      nd[i + 1] = Math.round((-dy / len) * 0.5 * 255 + 127.5);
      nd[i + 2] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      nd[i + 3] = 255;
    }
  }
  return { roughnessMap: mk(rd), normalMap: mk(nd) };
}

/* ================= ① environment: bundled studio HDRI → PMREM ============= */
function buildStudioEnv() {                 // offline fallback (procedural boxes)
  const s = new THREE.Scene();
  const lightBox = (w, h, hex, intensity, pos, look) => {
    const m = new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide });
    m.color.multiplyScalar(intensity);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(pos[0], pos[1], pos[2]);
    p.lookAt(look[0], look[1], look[2]);
    s.add(p);
  };
  lightBox(7, 4.5, 0xffffff, 6.0, [0, 6, 5], [0, 0.6, 0]);
  lightBox(5, 6, 0xdfe9ff, 2.4, [-6, 3, 1], [0, 1, 0]);
  lightBox(4, 3, 0xfff1dd, 1.8, [6, 3, -2], [0, 1, 0]);
  lightBox(9, 9, 0xffffff, 0.55, [0, -4, 0], [0, 0, 0]);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(20, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x232833, side: THREE.BackSide }));
  s.add(dome);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  return rt.texture;
}
let envKind = 'none';
function loadEnvironment() {
  if (!renderer || !RGBELoaderCls) return;
  try {
    new RGBELoaderCls().load(HDR_URL, (hdr) => {
      if (!renderer) return;
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(renderer);
      const rt = pm.fromEquirectangular(hdr);
      pm.dispose();
      hdr.dispose();
      scene.environment = rt.texture;
      scene.environmentIntensity = 0.9;
      if (scene.environmentRotation) scene.environmentRotation.set(0, Math.PI * 0.35, 0);
      envKind = 'hdri';
      dirty = true;
    }, undefined, () => { envFallback(); });
  } catch (_e) { envFallback(); }
}
function envFallback() {
  if (envKind !== 'none') return;
  scene.environment = buildStudioEnv();
  scene.environmentIntensity = 0.95;
  envKind = 'procedural';
  dirty = true;
}

function ensureInit() {
  if (inited || glFailed) return inited;
  if (libsFailed) { glFailed = true; return false; }
  if (!THREE || !GLTFLoaderCls || !RGBELoaderCls) { ensureLibsLazy(); return false; }
  inited = true;
  try {
    const old = document.getElementById('mug3d');
    if (!old) return false;
    glCanvas = document.createElement('canvas');
    glCanvas.id = 'mug3d';
    old.replaceWith(glCanvas);

    renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: false });
    renderer.setClearColor(STAGE_BG, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;         // ② design stays saturated
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;                       // ④
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;

    scene = new THREE.Scene();
    loadEnvironment();                                       // ① (async, fallback on fail)

    camera = new THREE.PerspectiveCamera(35, 1, 0.05, 60);   // mug-editor fov

    const key = new THREE.DirectionalLight(0xffffff, 1.4);   // ④ mug-editor key
    key.position.set(3, 6, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -2.2; key.shadow.camera.right = 2.2;
    key.shadow.camera.top = 2.2; key.shadow.camera.bottom = -2.2;
    key.shadow.camera.near = 2; key.shadow.camera.far = 14;
    key.shadow.radius = 4;
    key.shadow.bias = -0.0001;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    root = new THREE.Group();
    scene.add(root);

    const loader = new GLTFLoaderCls();
    loader.load(GLB_URL, (g) => {
      root.clear();
      root.add(g.scene);
      slim = g.scene;
      applySlim();                        // 컵 원주 = 디자인 폭 스케일 (fit 전 적용)
      g.scene.traverse((o) => {
        if (o.isMesh) o.userData.printable = classifyPrintable(o);
      });
      wallFit = measureWallFit();             // v(y) on the straight wall (local coords)
      buildMaterials();
      const keepRot = root.rotation.y;        // fit at yaw=0: bbox must not depend on
      root.rotation.y = 0;                    // turntable phase at load time
      root.updateMatrixWorld(true);
      fitHome();
      root.rotation.y = keepRot;
      lastVer = -1; lastWrapKey = '';
      applyDesignTexture();
      renderer.shadowMap.needsUpdate = true;
      lastShadowYaw = mug ? mug.th : 0;
      dirty = true;
    }, undefined, (err) => {
      console.warn('GLB load failed', err);
      if (window.toast) toast('3D 모델 로드 실패 — assets/mug.glb 확인', 'err');
    });
    sizeRenderer();
    dirty = true;
    return true;
  } catch (e) {
    console.warn('3D init failed', e);
    glFailed = true;
    return false;
  }
}

/* Sublimation prints the OUTER body only: handle sits off-axis, inner wall has
   inward-facing normals — both stay plain ceramic (mug-editor material split). */
function classifyPrintable(o) {
  const pos = o.geometry && o.geometry.attributes.position;
  const nrm = o.geometry && o.geometry.attributes.normal;
  if (!pos || !nrm || !pos.count) return true;
  let cx = 0, cz = 0, score = 0, cnt = 0;
  for (let i = 0; i < pos.count; i += 7) {
    const px = pos.getX(i), pz = pos.getZ(i);
    const nx = nrm.getX(i), nz = nrm.getZ(i);
    cx += px; cz += pz;
    const rl = Math.hypot(px, pz) || 1e-6;
    score += (nx * px + nz * pz) / rl;
    cnt++;
  }
  cx /= cnt; cz /= cnt; score /= cnt;
  return Math.hypot(cx, cz) < 0.3 && score > 0.0;
}

/* least-squares v(y) over straight-wall vertices of the printable body */
function measureWallFit() {
  let body = null;
  root.traverse((o) => { if (o.isMesh && o.userData.printable) body = o; });
  if (!body) return null;
  const uv = body.geometry.attributes.uv, pos = body.geometry.attributes.position;
  if (!uv || !pos) return null;
  let n = 0, sy = 0, sv = 0, syy = 0, syv = 0;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    const y = pos.getY(i);
    if (r < 0.78 || r > 0.806 || y < -1.0 || y > 0.95) continue;      // 2-ring wall strip
    const v = uv.getY(i);
    n++; sy += y; sv += v; syy += y * y; syv += y * v;
  }
  if (n < 8) return null;
  const b = (n * syv - sy * sv) / (n * syy - sy * sy);
  const a = (sv - b * sy) / n;
  return { a, b, n };
}
const vAt = (y) => (wallFit ? Math.max(0, Math.min(1, wallFit.a + wallFit.b * y)) : (y + 1) / 2);

function buildMaterials() {
  if (!glazeMaps) glazeMaps = createGlazeMaps();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (!tex) {
    tex = new THREE.CanvasTexture(document.createElement('canvas'));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso;
    tex.flipY = false;                       // y' rows carry v directly
    tex.wrapS = THREE.RepeatWrapping;        // seam (u=0/1) safe
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  const glaze = {
    metalness: 0,
    roughness: 1,                            // absolute values live in the map
    roughnessMap: glazeMaps.roughnessMap,
    normalMap: glazeMaps.normalMap,
    normalScale: new THREE.Vector2(0.05, 0.05),
    clearcoat: 1,
    clearcoatRoughness: 0.07,
    ior: 1.5,
    specularIntensity: 1,
    envMapIntensity: 1,
  };
  bodyMat = new THREE.MeshPhysicalMaterial({ ...glaze, color: 0xf6f3ec, map: tex });
  handleMat = new THREE.MeshPhysicalMaterial({ ...glaze, color: 0xf6f3ec });
  innerMat = new THREE.MeshPhysicalMaterial({
    color: 0xf3eee4, roughness: 0.35, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.1, ior: 1.5, envMapIntensity: 0.7,
  });
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const kind = o.userData.kind ||
      (o.userData.printable === false ? (isInnerMesh(o) ? 'inner' : 'handle') : 'body');
    o.userData.kind = kind;
    o.material = kind === 'body' ? bodyMat : kind === 'inner' ? innerMat : handleMat;
  });
}
function isInnerMesh(o) {
  const nrm = o.geometry && o.geometry.attributes.normal;
  if (!nrm || !nrm.count) return false;
  let score = 0, cnt = 0;
  const pos = o.geometry.attributes.position;
  for (let i = 0; i < nrm.count; i += 7) {
    const px = pos.getX(i), pz = pos.getZ(i);
    const rl = Math.hypot(px, pz) || 1e-6;
    score += (nrm.getX(i) * px + nrm.getZ(i) * pz) / rl;
    cnt++;
  }
  return (score / cnt) < 0;                  // inward-facing wall = cavity
}

function fitHome() {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const s = 1.8 / Math.max(size.x, size.y, size.z, 1e-6);
  root.scale.setScalar(s);
  homeDist = 3.9;
}

/* ============ print mapping: wrap band mm → full-circumference texture ==== */
function applyDesignTexture() {
  try {
    if (!root || !bodyMat) return;
    const dsg = state.designs[state.activeDesign];
    const ver = dsg ? (dsg.ver || 0) : -1;
    const wrapKey = state.wrap.w + 'x' + state.wrap.h;
    if (ver === lastVer && wrapKey === lastWrapKey) return;

    const src = designCanvas(state.activeDesign);  // 노치 포함 — 핸들 노치 체크박스가 3D에도 반영
    if (!src || !wallFit) return;                 // retry once wallFit exists

    // band source: design artwork composited on white (preview-only)
    const Wb = src.width, Hb = src.height;
    lastVer = ver; lastWrapKey = wrapKey;          // consume only on success path
    if (!bandCanvas) bandCanvas = document.createElement('canvas');
    bandCanvas.width = Wb; bandCanvas.height = Hb;
    const bx = bandCanvas.getContext('2d');
    bx.fillStyle = '#ffffff';
    bx.fillRect(0, 0, Wb, Hb);
    bx.drawImage(src, 0, 0);

    const w = state.wrap.w, h = state.wrap.h;
    if (applySlim()) fitHome();          // 원주 스케일이 바뀌면 재중심·재맞춤
    const vTop = vAt((h / 2) * UNITS_PER_MM);
    const vBot = vAt((-h / 2) * UNITS_PER_MM);
    const dv = Math.max(1e-4, vTop - vBot);
    const texCirc = dispCirc(w).texCirc; // 컵 원주(mm) — 이미지 왜곡 없음
    const Wc = Math.round(texCirc * (Wb / w));  // full circumference px
    const Hc = Math.round(Hb / dv);             // v∈[0,1] height px

    if (!tex) buildMaterials();
    const cv = tex.image;
    cv.width = Wc; cv.height = Hc;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, Wc, Hc);                          // gap under handle stays white

    // image CENTRE at u=0.5 (local 180°, opposite handle at the u=0/1 seam);
    // slope +1: screen-u grows L→R and image-left must land on screen-left (probe-verified)
    // 밀착(요청): 컵 원주를 디자인 폭에 맞춰 스케일 → 이미지 비율 100% 유지,
    // 디자인 끝선=노치가 핸들 발끝(±6.6°)에 붙음. 평면·인쇄·내보내기 state.wrap.w 불변.
    const U0 = 0.5 - (w / 2) / texCirc;  // image left edge u (centre fixed at 0.5)
    const e1 = U0 * Wc, e2 = e1 - Wc;
    const d = -(Hc * dv) / Hb;                          // y' = v·Hc, v drops with py
    const f = Hc * vTop;
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    for (const e of [e1, e2]) {
      cx.setTransform(1, 0, 0, d, e, f);   // 이미지 왜곡 없음 (sx=1), 컵이 대신 스케일
      cx.drawImage(bandCanvas, 0, 0);
    }
    cx.setTransform(1, 0, 0, 1, 0, 0);
    tex.needsUpdate = true;
    renderer.shadowMap.needsUpdate = true;
    dirty = true;
  } catch (e) { console.warn('texture apply failed', e); }
}

function sizeRenderer() {
  if (!renderer || !glCanvas) return;
  const host = glCanvas.parentElement;
  const w = Math.max(80, (host && host.clientWidth) || 400);
  const h = Math.max(80, (host && host.clientHeight) || 260);
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(dpr, 1.5) * prScale);   // ⑤ mug-editor DPR cap
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dirty = true;
}

function updatePose() {
  const zoom = Math.max(0.4, Math.min(3.2, mug.zoom));
  const pitch = Math.max(0.02, Math.min(1.2, mug.pitch));
  const roll = Math.max(-0.7, Math.min(0.7, mug.roll));
  const dist = homeDist / zoom;
  const tx = mug.panX * dist * 0.0016, ty = -mug.panY * dist * 0.0016;
  camera.position.set(tx, ty + dist * Math.sin(pitch), dist * Math.cos(pitch));
  camera.up.set(Math.sin(roll), Math.cos(roll), 0);
  camera.lookAt(tx, ty, 0);
  root.rotation.y = mug.th + yawOffset;                  // band centre -> camera at th=0
}

window.__mvDraw = function (t) {
  if (glFailed) return;
  if (!ensureInit()) return;
  const dsg = state.designs[state.activeDesign];
  const ver = dsg ? (dsg.ver || 0) : -1;
  const wrapKey = state.wrap.w + 'x' + state.wrap.h;
  const sig = [mug.th, mug.pitch, mug.roll, mug.zoom, mug.panX, mug.panY].map(v => v.toFixed(4)).join(',');
  if (sig !== lastSig) { lastSig = sig; dirty = true; }
  if (ver !== lastVer || wrapKey !== lastWrapKey) applyDesignTexture();
  if (!dirty) return;
  const t0 = performance.now();
  updatePose();
  yawSinceShadow = Math.abs(mug.th - lastShadowYaw);
  if (yawSinceShadow > 0.6) { renderer.shadowMap.needsUpdate = true; lastShadowYaw = mug.th; }
  renderer.render(scene, camera);
  dirty = false;
  const dt = performance.now() - t0;
  frameEMA += (dt - frameEMA) * 0.08;
  if (++frameN >= 90) {
    frameN = 0;
    if (frameEMA > 26 && prScale > .55) { prScale = Math.max(0.5, prScale - 0.25); sizeRenderer(); }
    else if (frameEMA < 13 && prScale < 1) { prScale = Math.min(1, prScale + 0.25); sizeRenderer(); }
  }
};

window.__mvSize = function () { if (ensureInit()) sizeRenderer(); };
window.__mvClamp = function () { if (!inited) return; dirty = true; };

window.__mv = {
  info() {
    let meshes = 0, uv = 0, mapped = 0, kinds = { body: 0, inner: 0, handle: 0 };
    if (root) root.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        if (o.geometry && o.geometry.attributes && o.geometry.attributes.uv) uv++;
        if (o.material && o.material.map) mapped++;
        if (o.userData.kind) kinds[o.userData.kind] = (kinds[o.userData.kind] || 0) + 1;
      }
    });
    return {
      meshes, uv, mapped, hasTex: !!tex,
      texW: tex && tex.image ? tex.image.width : 0,
      renderer: renderer ? 'webgl' : (glFailed ? 'failed' : 'none'),
      tone: renderer ? renderer.toneMapping : -1,
      toneName: 'neutral',
      env: envKind, kinds,
      wallFit: wallFit ? [ +wallFit.a.toFixed(4), +wallFit.b.toFixed(4) ] : null,
      rot: root ? +root.rotation.y.toFixed(4) : null,
      prScale
    };
  },
  redraw() { dirty = true; },
  /* raycast helper: uv sampled under an NDC point (0,0 = screen centre) */
  rayU(nx, ny) {
    if (!THREE || !camera || !root) return null;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const hits = rc.intersectObjects(root.children, true);
    if (!hits.length) return null;
    const h = hits[0];
    return {
      u: h.uv ? +h.uv.x.toFixed(4) : null,
      v: h.uv ? +h.uv.y.toFixed(4) : null,
      kind: (h.object.userData && h.object.userData.kind) || '?',
      dist: +h.distance.toFixed(3),
      hits: hits.length
    };
  },
  probe() {
    const out = [];
    if (root) root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes) return;
      const uv = o.geometry.attributes.uv;
      let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
      if (uv) for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        if (u < u0) u0 = u; if (u > u1) u1 = u;
        if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      const pos = o.geometry.attributes.position, nrm = o.geometry.attributes.normal;
      let cx = 0, cz = 0, score = 0, cnt = 0;
      if (pos && nrm) for (let i = 0; i < pos.count; i += 7) {
        const px = pos.getX(i), pz = pos.getZ(i), nx = nrm.getX(i), nz = nrm.getZ(i);
        cx += px; cz += pz;
        score += (nx * px + nz * pz) / (Math.hypot(px, pz) || 1e-6);
        cnt++;
      }
      if (cnt) { cx /= cnt; cz /= cnt; score /= cnt; }
      out.push({ name: o.name || '(anon)', count: uv ? uv.count : 0,
                 u: [+u0.toFixed(3), +u1.toFixed(3)], v: [+v0.toFixed(3), +v1.toFixed(3)],
                 map: !!(o.material && o.material.map),
                 off: +Math.hypot(cx, cz).toFixed(3), score: +score.toFixed(3),
                 kind: o.userData.kind, printable: o.userData.printable });
    });
    return out;
  }
};

ensureLibsLazy();
