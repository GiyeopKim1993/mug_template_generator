/* ============================================================
   model-viewer.js — ready-made GLB mug preview (experimental)
   · lazy-loads three.js + GLTFLoader (vendored, offline-safe)
   · applies the CURRENT design canvas as the body texture
   · swap assets/mug.glb with any glTF binary to change model
   ============================================================ */
'use strict';
const $m = (s) => document.querySelector(s);

let THREE = null, GLTFLoaderCls = null;
let renderer = null, scene = null, camera = null, root = null, tex = null;
let raf = 0, dragging = false, px = 0, py = 0;

async function ensureLibs() {
  if (THREE && GLTFLoaderCls) return;
  THREE = await import('three');
  const mod = await import('../vendor/GLTFLoader.js');
  GLTFLoaderCls = mod.GLTFLoader;
}

function fitCamera() {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const s = 1.8 / Math.max(size.x, size.y, size.z, 1e-6);
  root.scale.setScalar(s);
}

function applyDesignTexture() {
  try {
    const src = designCanvas(state.activeDesign);          // flat wrap artwork
    if (!src) return;
    if (tex) tex.dispose();
    // 프리뷰 전용: 디자인을 흰 바탕에 합성 (투명 영역이 검정으로 보이는 것 방지 — 인쇄 경로는 불변)
    const comp = document.createElement('canvas');
    comp.width = src.width; comp.height = src.height;
    const cx = comp.getContext('2d');
    cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, comp.width, comp.height);
    cx.drawImage(src, 0, 0);
    tex = new THREE.CanvasTexture(comp);
    tex.flipY = false;                                     // glTF UV convention
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.uv) return;
      o.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.02 });
    });
  } catch (e) { console.warn('texture apply failed', e); }
}

function animate() {
  raf = requestAnimationFrame(animate);
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function bindOrbit(dom) {
  dom.addEventListener('pointerdown', (e) => { dragging = true; px = e.clientX; py = e.clientY; dom.setPointerCapture(e.pointerId); });
  dom.addEventListener('pointermove', (e) => {
    if (!dragging || !root) return;
    const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
    root.rotation.y += dx * 0.011;
    root.rotation.x = Math.max(-0.9, Math.min(0.9, root.rotation.x + dy * 0.011));
  });
  dom.addEventListener('pointerup', () => { dragging = false; });
  dom.addEventListener('pointercancel', () => { dragging = false; });
  dom.addEventListener('wheel', (e) => {
    if (!camera) return;
    e.preventDefault();
    camera.position.z = Math.max(1.7, Math.min(6.5, camera.position.z + e.deltaY * 0.0022));
  }, { passive: false });
}

async function openModelModal() {
  const modal = document.getElementById('modelModal');
  const slot = document.getElementById('modelSlot');
  if (!modal || !slot) return;
  modal.classList.add('open');
  try {
    await ensureLibs();
    if (!renderer) {
      const w = slot.clientWidth || 640, h = slot.clientHeight || 420;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(w, h, false);
      renderer.setClearColor(0x141a26, 1);
      slot.innerHTML = '';
      slot.appendChild(renderer.domElement);
      bindOrbit(renderer.domElement);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(38, w / h, 0.05, 50);
      camera.position.set(0, 0.15, 3.1);
      scene.add(new THREE.AmbientLight(0xffffff, 1.35));
      const d1 = new THREE.DirectionalLight(0xffffff, 1.5); d1.position.set(3, 5, 4); scene.add(d1);
      const d2 = new THREE.DirectionalLight(0xcfe0ff, 0.5); d2.position.set(-4, 2, -3); scene.add(d2);
      root = new THREE.Group(); scene.add(root);
      const loader = new GLTFLoaderCls();
      loader.load('assets/mug.glb?v=20261005m',
        (g) => {
          root.clear();
          root.add(g.scene);
          fitCamera();
          root.rotation.y = -0.6;
          applyDesignTexture();
        },
        undefined,
        (err) => { console.warn(err); if (window.toast) toast('모델 로드 실패 — assets/mug.glb 확인', 'err'); });
      animate();
    } else {
      const w = slot.clientWidth, h = slot.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      applyDesignTexture();                                 // refresh design on reopen
      animate();
    }
  } catch (e) {
    console.warn(e);
    if (window.toast) toast('3D 모델 뷰어 오류: ' + (e && e.message || e), 'err');
    modal.classList.remove('open');
  }
}
function closeModelModal() {
  const modal = document.getElementById('modelModal');
  if (modal) modal.classList.remove('open');
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}
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
    return { meshes, uv, mapped, hasTex: !!tex, texW: tex && tex.image ? tex.image.width : 0 };
  }
};

function initModelViewer() {
  const b = document.getElementById('modelOpenBtn');
  if (b) b.addEventListener('click', openModelModal);
  const c = document.getElementById('modelClose');
  if (c) c.addEventListener('click', closeModelModal);
  const md = document.getElementById('modelModal');
  if (md) md.addEventListener('click', (e) => { if (e.target === md) closeModelModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModelModal(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initModelViewer);
else initModelViewer();
