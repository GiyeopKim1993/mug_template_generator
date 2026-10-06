/* ============================================================
   mockup.js — photoreal mockup (#10): warp the current design onto
   the user-picked real photo (assets/mockup_user.jpg).

   Geometry: body QUAD below is the front print area (handle excluded),
   in FRACTIONS of the photo. The design is remapped CYLINDRICALLY
   (x → asin → wrap u) so the visible front shows the CENTER of the wrap
   (= face centre, consistent with the 3-zone rule).

   Realism pipeline ("고품질 실제 같은 합성"):
     ① white-fill the quad (clean blank base, covers any pre-existing art)
     ② cylindrical strip warp (no stretch; perspective via 4-corner quad)
     ③ soft cylinder light band (shape cue, reduced — photo lighting leads)
     ④ PHOTO-LUMINANCE MULTIPLY: the quad's original photo pixels are
        multiplied back over the artwork at partial alpha, so the print
        inherits the real shot's shading, highlights and warm cast
     ⑤ base contact shadow
     ⑥ FEATHERED quad edge (destination-in soft mask) — no sticker outline
   ============================================================ */
'use strict';

const MOCKUP_URL = 'assets/mockup_user.jpg?v=20261005a';
/* front print area: TL TR BR BL — PIL-measured on assets/mockup_user.jpg
   (2048x2048, 512-space edge profile x4): left silhouette 150→0.2930,
   body/handle junction ~287→0.5606, rim 174→0.3398, base 405→0.7910 */
const MOCKUP_QUAD = [[0.2930, 0.3398], [0.5606, 0.3398], [0.5606, 0.7910], [0.2930, 0.7910]];

const _mpPhoto = new Image();
let _mpPhotoOk = false, _mpLastVer = -1, _mpDone = false;
_mpPhoto.onload = () => { _mpPhotoOk = true; if (window.__mockupDraw) __mockupDraw(); };
_mpPhoto.onerror = () => { console.warn('mockup photo failed', MOCKUP_URL); };
_mpPhoto.src = MOCKUP_URL;

function _mpWarp(ctx, design, q, W, H) {
  const [TL, TR, BR, BL] = q;
  const pad = 8;
  const dx0 = Math.max(0, Math.floor(Math.min(TL[0], TR[0], BR[0], BL[0]) - pad));
  const dy0 = Math.max(0, Math.floor(Math.min(TL[1], TR[1], BR[1], BL[1]) - pad));
  const dx1 = Math.min(W, Math.ceil(Math.max(TL[0], TR[0], BR[0], BL[0]) + pad));
  const dy1 = Math.min(H, Math.ceil(Math.max(TL[1], TR[1], BR[1], BL[1]) + pad));
  const bw = dx1 - dx0, bh = dy1 - dy0;

  /* capture the photo's own pixels under the quad BEFORE covering —
     used later for the lighting multiply (best realism lever) */
  let photoTile = null;
  try { photoTile = ctx.getImageData(dx0, dy0, bw, bh); } catch (_e) { photoTile = null; }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(TL[0], TL[1]); ctx.lineTo(TR[0], TR[1]);
  ctx.lineTo(BR[0], BR[1]); ctx.lineTo(BL[0], BL[1]);
  ctx.closePath();
  ctx.clip();
  /* blank-mug base (also covers pre-existing photo art) */
  ctx.fillStyle = '#f6f5f3';
  ctx.fillRect(dx0, dy0, bw, bh);

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

  /* soft cylinder light band (shape cue only — the photo multiply below
     carries the real lighting; amplitudes reduced to avoid double shading) */
  const g = ctx.createLinearGradient(TL[0], 0, TR[0], 0);
  g.addColorStop(0.00, 'rgba(0,0,0,0.24)');
  g.addColorStop(0.10, 'rgba(0,0,0,0.08)');
  g.addColorStop(0.30, 'rgba(255,255,255,0.07)');
  g.addColorStop(0.38, 'rgba(255,255,255,0.15)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.00)');
  g.addColorStop(0.86, 'rgba(0,0,0,0.11)');
  g.addColorStop(1.00, 'rgba(0,0,0,0.30)');
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = g;
  ctx.fillRect(dx0, dy0, bw, bh);
  ctx.globalCompositeOperation = 'source-over';

  /* PHOTO-LUMINANCE MULTIPLY — print picks up the shot's real shading */
  if (photoTile) {
    try {
      const tmp = document.createElement('canvas');
      tmp.width = bw; tmp.height = bh;
      const tc = tmp.getContext('2d');
      tc.putImageData(photoTile, 0, 0);
      tc.globalCompositeOperation = 'multiply';
      tc.drawImage(ctx.canvas, dx0, dy0, bw, bh, 0, 0, bw, bh);
      tc.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.75;                 // 75% photo lighting, 25% flat art
      ctx.drawImage(tmp, 0, 0);
      ctx.globalAlpha = 1;
    } catch (_e) { /* tainted canvas (file://) — skip, warp alone still correct */ }
  }

  /* base contact shadow */
  const gv = ctx.createLinearGradient(0, dy1 - 46, 0, dy1);
  gv.addColorStop(0, 'rgba(0,0,0,0)');
  gv.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = gv;
  ctx.fillRect(dx0, dy1 - 46, bw, 46);
  ctx.restore();

  /* FEATHERED EDGE — soften the quad boundary so it never reads as a sticker */
  try {
    const m = document.createElement('canvas');
    m.width = W; m.height = H;
    const mc = m.getContext('2d');
    mc.fillStyle = '#fff'; mc.fillRect(0, 0, W, H);       // keep photo everywhere
    mc.beginPath();
    mc.moveTo(TL[0], TL[1]); mc.lineTo(TR[0], TR[1]);
    mc.lineTo(BR[0], BR[1]); mc.lineTo(BL[0], BL[1]);
    mc.closePath();
    mc.save();
    mc.clip();
    mc.globalCompositeOperation = 'destination-out';
    mc.fillRect(dx0, dy0, bw, bh);                        // punch hole = quad region
    mc.globalCompositeOperation = 'source-over';
    mc.filter = 'blur(2.5px)';
    mc.fillStyle = '#fff';
    mc.fill();                                            // blurred polygon back in
    mc.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(m, 0, 0);
    ctx.restore();
  } catch (_e) { /* no canvas filter — hard edge, same as before */ }
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
    const design = designCanvas(state.activeDesign, true);  // noNotch: 3D와 동일 — 노치 구멍 미노출
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
