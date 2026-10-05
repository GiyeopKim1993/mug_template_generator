/* ============================================================
   model-viewer.js — stage renderer: assets/mug.glb via three.js r160
   (Replaces the retired 2D fake-3D painter — 2026-10-05)

   Realistic look (recipe from mug-editor, MIT — adapted for vanilla three):
     ① ACES filmic tone mapping + procedural PMREM studio environment
        (soft key/fill/rim boxes; no external HDR file → offline-safe)
     ② soft shadows, one-shot: shadowMap.autoUpdate=false + needsUpdate on
        load / yaw-delta (catalog style — no ground plane, handle self-shadow)
     ③ glaze: MeshPhysicalMaterial clearcoat
     ④ draw-on-demand + adaptive pixel ratio (frame-time EMA budget)

   app.js integration hooks (all optional):
     __mvSize()  — (re)size renderer to #stage box   (app sizeStage)
     __mvClamp() — keep mug in frame                 (app clampView)
     __mvDraw(t) — per-frame draw; reads global `mug` view state (app loop3d)
   ============================================================ */
'use strict';

let THREE = null, GLTFLoaderCls = null;
let renderer = null, scene = null, camera = null, root = null, tex = null;
let glCanvas = null, homeDist = 3.1, glFailed = false, inited = false;
let lastSig = '', lastVer = -1, dirty = true;
let frameEMA = 16, frameN = 0, prScale = 1;
let yawSinceShadow = 0, lastShadowYaw = 0;

const GLB_URL = 'assets/mug.glb?v=20261005m';
const STAGE_BG = 0x12151d;

let libsPromise = null, libsFailed = false;
async function ensureLibs() {
  if (THREE && GLTFLoaderCls) return;
  THREE = await import('three');
  const mod = await import('../vendor/GLTFLoader.js');
  GLTFLoaderCls = mod.GLTFLoader;
}
function ensureLibsLazy() {                 // started at module load; retried by ensureInit
  if (!libsPromise) {
    libsPromise = ensureLibs().catch((e) => {
      console.warn('three.js dynamic import failed', e);
      libsFailed = true;
    });
  }
  return libsPromise;
}

/* ---- ① procedural studio environment (PMREM from a light-box scene) ---- */
function buildStudioEnv() {
  const s = new THREE.Scene();
  const lightBox = (w, h, hex, intensity, pos, look) => {
    const m = new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide });
    m.color.multiplyScalar(intensity);                       // HDR-ish emission
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(pos[0], pos[1], pos[2]);
    p.lookAt(look[0], look[1], look[2]);
    s.add(p);
  };
  lightBox(7, 4.5, 0xffffff, 6.0, [0, 6, 5], [0, 0.6, 0]);    // key softbox (camera side)
  lightBox(5, 6, 0xdfe9ff, 2.4, [-6, 3, 1], [0, 1, 0]);       // cool fill (left)
  lightBox(4, 3, 0xfff1dd, 1.8, [6, 3, -2], [0, 1, 0]);       // warm rim (right-back)
  lightBox(9, 9, 0xffffff, 0.55, [0, -4, 0], [0, 0, 0]);      // floor bounce
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(20, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x232833, side: THREE.BackSide }));
  s.add(dome);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  return rt.texture;
}

function ensureInit() {
  if (inited || glFailed) return inited;
  if (libsFailed) { glFailed = true; return false; }
  if (!THREE || !GLTFLoaderCls) { ensureLibsLazy(); return false; }   // modules still loading
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;      // ①
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;                       // ②
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;

    scene = new THREE.Scene();
    scene.environment = buildStudioEnv();                    // ①
    scene.environmentIntensity = 0.95;

    camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);

    const key = new THREE.DirectionalLight(0xffffff, 2.1);   // ② key light
    key.position.set(2.6, 4.4, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 4;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.45);
    fill.position.set(-3.5, 1.8, -2);
    scene.add(fill);

    root = new THREE.Group();
    scene.add(root);

    const loader = new GLTFLoaderCls();
    loader.load(GLB_URL, (g) => {
      root.clear();
      root.add(g.scene);
      g.scene.traverse((o) => {
        if (o.isMesh) o.userData.printable = classifyPrintable(o);   // body=print, handle/inner=plain ceramic
      });
      fitHome();
      lastVer = -1;                       // force texture re-apply
      applyDesignTexture();
      renderer.shadowMap.needsUpdate = true;                 // ② one-shot
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
   inward-facing normals — both must stay plain white ceramic. */
function classifyPrintable(o) {
  const pos = o.geometry && o.geometry.attributes.position;
  const nrm = o.geometry && o.geometry.attributes.normal;
  if (!pos || !nrm || !pos.count) return true;
  let cx = 0, cz = 0, score = 0, cnt = 0;
  for (let i = 0; i < pos.count; i += 7) {                 // stride sample — cheap & stable
    const px = pos.getX(i), pz = pos.getZ(i);
    const nx = nrm.getX(i), nz = nrm.getZ(i);
    cx += px; cz += pz;
    const rl = Math.hypot(px, pz) || 1e-6;
    score += (nx * px + nz * pz) / rl;
    cnt++;
  }
  cx /= cnt; cz /= cnt; score /= cnt;
  return Math.hypot(cx, cz) < 0.3 && score > 0.0;          // centered + outward-facing
}

function fitHome() {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const s = 1.8 / Math.max(size.x, size.y, size.z, 1e-6);
  root.scale.setScalar(s);
  homeDist = 3.9;   // catalog framing: whole mug + handle + margin
}

function applyDesignTexture() {
  try {
    const dsg = state.designs[state.activeDesign];
    const ver = dsg ? (dsg.ver || 0) : -1;
    if (ver === lastVer) return;
    lastVer = ver;
    const src = designCanvas(state.activeDesign);            // flat wrap artwork
    if (!src || !root) return;
    if (tex) tex.dispose();
    // preview-only white composite (transparent → white; print path untouched)
    const comp = document.createElement('canvas');
    comp.width = src.width; comp.height = src.height;
    const cx = comp.getContext('2d');
    cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, comp.width, comp.height);
    cx.drawImage(src, 0, 0);
    tex = new THREE.CanvasTexture(comp);
    tex.flipY = false;                                       // glTF UV convention
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes) return;
      const hasUv = !!o.geometry.attributes.uv;
      const printable = o.userData.printable !== false;     // handle/inner stay plain white
      o.castShadow = true; o.receiveShadow = true;
      o.material = new THREE.MeshPhysicalMaterial({         // ③ glaze
        map: (hasUv && printable) ? tex : null,
        color: printable ? 0xffffff : 0xf5f4f2,
        roughness: 0.42, metalness: 0.0,
        clearcoat: 0.7, clearcoatRoughness: 0.16,
        envMapIntensity: 1.1
      });
    });
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
  renderer.setPixelRatio(Math.min(dpr, 2) * prScale);        // ④ adaptive scale
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dirty = true;
}

/* ---- view pose from app.js `mug` state (same semantics as the old painter) ---- */
function updatePose() {
  const zoom = Math.max(0.4, Math.min(3.2, mug.zoom));
  const pitch = Math.max(0.02, Math.min(1.2, mug.pitch));
  const roll = Math.max(-0.7, Math.min(0.7, mug.roll));
  const dist = homeDist / zoom;
  const tx = mug.panX * dist * 0.0016, ty = -mug.panY * dist * 0.0016;
  camera.position.set(tx, ty + dist * Math.sin(pitch), dist * Math.cos(pitch));
  camera.up.set(Math.sin(roll), Math.cos(roll), 0);          // canvas roll
  camera.lookAt(tx, ty, 0);
  root.rotation.y = mug.th;                                  // turntable yaw
}

window.__mvDraw = function (t) {
  if (glFailed) return;
  if (!ensureInit()) return;
  const ver = state.designs[state.activeDesign] ? state.designs[state.activeDesign].ver : -1;
  const sig = [mug.th, mug.pitch, mug.roll, mug.zoom, mug.panX, mug.panY].map(v => v.toFixed(4)).join(',');
  if (sig !== lastSig) { lastSig = sig; dirty = true; }
  if (ver !== lastVer) applyDesignTexture();
  if (!dirty) return;                                        // ④ draw-on-demand
  const t0 = performance.now();
  updatePose();
  // ② shadow refresh only after meaningful yaw change (still "one-shot" cadence)
  yawSinceShadow = Math.abs(mug.th - lastShadowYaw);
  if (yawSinceShadow > 0.6) { renderer.shadowMap.needsUpdate = true; lastShadowYaw = mug.th; }
  renderer.render(scene, camera);
  dirty = false;
  // ④ adaptive pixel ratio (EMA frame budget)
  const dt = performance.now() - t0;
  frameEMA += (dt - frameEMA) * 0.08;
  if (++frameN >= 90) {
    frameN = 0;
    if (frameEMA > 26 && prScale > .55) { prScale = Math.max(0.5, prScale - 0.25); sizeRenderer(); }
    else if (frameEMA < 13 && prScale < 1) { prScale = Math.min(1, prScale + 0.25); sizeRenderer(); }
  }
};

window.__mvSize = function () { if (ensureInit()) sizeRenderer(); };
window.__mvClamp = function () { if (!inited) return; dirty = true; };  // pose clamped in updatePose

window.__mv = {
  info() {
    let meshes = 0, uv = 0, mapped = 0;
    if (root) root.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        if (o.geometry && o.geometry.attributes && o.geometry.attributes.uv) uv++;
        if (o.material && o.material.map) mapped++;
      }
    });
    return {
      meshes, uv, mapped, hasTex: !!tex,
      texW: tex && tex.image ? tex.image.width : 0,
      renderer: renderer ? 'webgl' : (glFailed ? 'failed' : 'none'),
      tone: renderer ? renderer.toneMapping : -1,
      prScale
    };
  },
  redraw() { dirty = true; },
  probe() {                                   // per-mesh UV bounds (tests + diagnostics)
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
                 printable: o.userData.printable });
    });
    return out;
  }
};

ensureLibsLazy();   // kick off immediately — first __mvDraw may race it (safe retry)
