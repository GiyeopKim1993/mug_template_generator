/* ============================================================
   mockup.js — photoreal mockup (#10): warp the current design onto
   assets/mockup.jpg (CC0 photo — see ATTRIBUTION.txt).

   Geometry: body QUAD below is the front print area (handle excluded),
   in FRACTIONS of the photo. The design is remapped CYLINDRICALLY
   (x → asin → wrap u) so the visible front shows the CENTER of the wrap
   (= face centre, consistent with the 3-zone rule), then shaded with a
   cylinder light band so it sits on the curved surface.

   The quad is white-filled first: the source photo carries pre-existing
   art (skull print) that a real blank mug would not have — the mockup
   must read as a freshly printed blank mug.
   ============================================================ */
'use strict';

const MOCKUP_URL = 'assets/mockup.jpg?v=20261005a';
/* front print area: TL TR BR BL — tuned against assets/mockup.jpg (1920x1080) */
const MOCKUP_QUAD = [[0.5665, 0.404], [0.7165, 0.399], [0.7195, 0.711], [0.5655, 0.717]];

const _mpPhoto = new Image();
let _mpPhotoOk = false, _mpLastVer = -1, _mpDone = false;
_mpPhoto.onload = () => { _mpPhotoOk = true; if (window.__mockupDraw) __mockupDraw(); };
_mpPhoto.onerror = () => { console.warn('mockup photo failed', MOCKUP_URL); };
_mpPhoto.src = MOCKUP_URL;

function _mpWarp(ctx, design, q, W, H) {
  const [TL, TR, BR, BL] = q;
  const dx0 = Math.min(TL[0], TR[0], BR[0], BL[0]) - 4;
  const dy0 = Math.min(TL[1], TR[1], BR[1], BL[1]) - 4;
  const dx1 = Math.max(TL[0], TR[0], BR[0], BL[0]) + 4;
  const dy1 = Math.max(TL[1], TR[1], BR[1], BL[1]) + 4;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(TL[0], TL[1]); ctx.lineTo(TR[0], TR[1]);
  ctx.lineTo(BR[0], BR[1]); ctx.lineTo(BL[0], BL[1]);
  ctx.closePath();
  ctx.clip();
  /* blank-mug base (also covers pre-existing photo art) */
  ctx.fillStyle = '#f6f5f3';
  ctx.fillRect(dx0, dy0, dx1 - dx0, dy1 - dy0);

  const N = 72, DW = design.width, DH = design.height;
  ctx.imageSmoothingQuality = 'high';
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    /* cylindrical remap: screen x=2t-1 → φ=asin → wrap u */
    const p0 = Math.asin(Math.max(-1, Math.min(1, 2 * t0 - 1)));
    const p1 = Math.asin(Math.max(-1, Math.min(1, 2 * t1 - 1)));
    const u0 = 0.5 + p0 / (2 * Math.PI), u1 = 0.5 + p1 / (2 * Math.PI);
    const sx0 = u0 * DW, sw = Math.max(1.5, (u1 - u0) * DW + 1);   // +1px overlap: no seams
    /* destination trapezoid edges at t */
    const tx = TL[0] + (TR[0] - TL[0]) * t0, ty = TL[1] + (TR[1] - TL[1]) * t0;
    const bx = BL[0] + (BR[0] - BL[0]) * t0, by = BL[1] + (BR[1] - BL[1]) * t0;
    const nx = TL[0] + (TR[0] - TL[0]) * t1;
    const px0 = tx, py0 = ty;
    const ax = (nx - tx) / sw, ay = ((TL[1] + (TR[1] - TL[1]) * t1) - ty) / sw;
    const cx = (bx - tx) / DH, cy = (by - ty) / DH;
    ctx.save();
    ctx.transform(ax, ay, cx, cy, px0 - ax * sx0, py0 - ay * sx0);
    ctx.drawImage(design, sx0, 0, sw, DH, sx0, 0, sw, DH);
    ctx.restore();
  }

  /* cylinder shading: edge falloff + gloss band (light from upper-left) */
  const g = ctx.createLinearGradient(TL[0], 0, TR[0], 0);
  g.addColorStop(0.00, 'rgba(0,0,0,0.34)');
  g.addColorStop(0.10, 'rgba(0,0,0,0.12)');
  g.addColorStop(0.30, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.38, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.00)');
  g.addColorStop(0.86, 'rgba(0,0,0,0.16)');
  g.addColorStop(1.00, 'rgba(0,0,0,0.42)');
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = g;
  ctx.fillRect(dx0, dy0, dx1 - dx0, dy1 - dy0);
  /* base contact shadow */
  const gv = ctx.createLinearGradient(0, dy1 - 46, 0, dy1);
  gv.addColorStop(0, 'rgba(0,0,0,0)');
  gv.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = gv;
  ctx.fillRect(dx0, dy1 - 46, dx1 - dx0, 46);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

window.__mockupDraw = function () {
  try {
    const cv = document.getElementById('mockup');
    if (!cv || !_mpPhotoOk) return;
    const host = cv.parentElement;
    const cw = Math.max(120, host.clientWidth || 360);
    const W = Math.round(cw), H = Math.round(cw * _mpPhoto.naturalHeight / _mpPhoto.naturalWidth);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; _mpDone = false; }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(_mpPhoto, 0, 0, W, H);
    const dsg = state.designs[state.activeDesign];
    const ver = dsg ? (dsg.ver || 0) : -1;
    if (ver === _mpLastVer && _mpDone) return;
    const design = designCanvas(state.activeDesign);
    if (!design || !design.width) return;
    _mpLastVer = ver; _mpDone = true;
    const q = MOCKUP_QUAD.map(p => [p[0] * W, p[1] * H]);
    _mpWarp(ctx, design, q, W, H);
  } catch (e) { console.warn('mockup draw failed', e); }
};

window.__mockupInfo = function () {
  const cv = document.getElementById('mockup');
  return { ready: _mpPhotoOk, drawn: _mpDone, w: cv ? cv.width : 0, h: cv ? cv.height : 0 };
};
