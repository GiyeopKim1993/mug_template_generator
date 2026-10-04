// Extract pure modules from index.html and run unit tests
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'js', 'pure.js'), 'utf8'); // markers moved out of index.html

function extract(startMark, endMark) {
  const re = new RegExp('/\\*' + startMark + '\\*/([\\s\\S]*?)\\/\\*' + endMark + '\\*/');
  const m = html.match(re);
  if (!m) throw new Error('marker not found: ' + startMark);
  return m[1];
}
const pdfCode = extract('__PDF_START__', '__PDF_END__');
const mathCode = extract('__MATH_START__', '__MATH_END__');

const factory = new Function(pdfCode + '\n' + mathCode + `
  return { buildPdf, computeLayout, markPrims, safeBox, clearance, markZones,
           CUT_STYLES, mm2pt, A4, PAPER, SIL, BRO, wrapSegs, notchGeom,
           wrapDxfSegs, buildDxf };
`);
const M = factory();

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.log('  ✗ FAIL: ' + msg); }
}

/* ---------- layout tests ---------- */
console.log('[layout]');
const presets = [
  { w: 205, h: 87 }, { w: 216, h: 89 }, { w: 229, h: 89 }, { w: 197, h: 89 }
];
for (const wrap of presets) {
  for (const mode of ['cut', 'silhouette', 'brother']) {
    const machine = mode === 'cut' ? 'silhouette' : mode;
    const L = M.computeLayout({ wrap, mode, machine, orient: 'auto' });
    ok(L.fits, `${wrap.w}x${wrap.h} ${mode} fits (orient=${L.art.or}, art=${L.art.w.toFixed(1)}x${L.art.h.toFixed(1)} @ ${L.art.x.toFixed(1)},${L.art.y.toFixed(1)})`);
  }
}
// orientation: 205 wide must be vertical
const L1 = M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'cut', orient: 'auto' });
ok(L1.art.or === 'v', '205mm wrap auto-orients vertical on cut mode');
ok(Math.abs(L1.art.w - 87) < 1e-9 && Math.abs(L1.art.h - 205) < 1e-9, 'vertical art is 87x205');
// horizontal works for narrow wrap
const L2 = M.computeLayout({ wrap: { w: 170, h: 87 }, mode: 'cut', orient: 'auto' });
ok(L2.art.or === 'h', '170mm wrap auto-orients horizontal');
// forced invalid orientation -> not fits
const L3 = M.computeLayout({ wrap: { w: 229, h: 89 }, mode: 'cut', orient: 'h' });
ok(!L3.fits, '229mm horizontal is rejected');
// ridiculous size rejected in mark mode
// mark modes now use the REAL rule: dodge the registration-mark zones + 5mm
// printer margin (the old safe-box rule was stricter than the machines need).
// 260x110 centred on A4 clears all three Silhouette corner marks -> printable.
const L4 = M.computeLayout({ wrap: { w: 260, h: 110 }, mode: 'silhouette', orient: 'auto' });
ok(L4.fits, '260x110 silhouette fits (mark-avoidance rule)');
// ...but art that actually overlaps a mark zone is still rejected
const Lz = M.computeLayout({ wrap: { w: 240, h: 140 }, mode: 'silhouette', orient: 'v' });
ok(!Lz.fits, '240x140 vertical overlaps Silhouette mark zones -> rejected');
// Letter + Silhouette 2-up: BL/TR brackets diagonally block the pair -> impossible
const Llet2 = M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'silhouette',
                                paper: 'letter', orient: 'v', copies: 2 });
ok(!Llet2.fits && Llet2.nCopies === 2, 'silhouette Letter 2-up rejected (fallback basis)');
const Llet2b = M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'brother', machine: 'brother',
                                 paper: 'letter', orient: 'v', copies: 2 });
ok(Llet2b.fits, 'brother Letter 2-up fits');
// centered placement is on-page
for (const mode of ['cut', 'silhouette', 'brother']) {
  const L = M.computeLayout({ wrap: { w: 205, h: 87 }, mode, machine: mode === 'cut' ? 'silhouette' : mode, orient: 'auto' });
  ok(L.art.x >= 0 && L.art.y >= 0 && L.art.x + L.art.w <= M.A4.w + 1e-9 && L.art.y + L.art.h <= M.A4.h + 1e-9,
    `${mode}: art fully on A4 page`);
}
// mark geometry — marks are EXTRACTED IMAGE prims (not drawn vectors)
console.log('[mark geometry]');
const sil = M.markPrims('silhouette');
ok(sil.length === 3, 'silhouette: 3 image prims (got ' + sil.length + ')');
ok(sil.every(p => p.t === 'img'), 'silhouette marks are image prims');
ok(sil[0].key === 'SIL_SQ' && sil[0].x === M.SIL.inset && sil[0].y === M.SIL.inset,
  'silhouette TL square image at 15.875 inset');
ok(Math.abs(sil[0].w - 20 * M.SIL.sqRatio) < 1e-9, 'silhouette square side = 0.3007 * 20mm');
ok(sil[1].key === 'SIL_L_TR' && sil[1].w === 20 && sil[2].key === 'SIL_L_BL',
  'silhouette TR/BL bracket images 20mm');
const bro = M.markPrims('brother');
ok(bro.length === 4 && bro.every(p => p.t === 'img' && p.key === 'BRO'),
  'brother: 4 extracted glyph images (got ' + bro.length + ')');
ok(Math.abs((bro[0].x + bro[0].w / 2) - 25.4) < 1e-9 && Math.abs((bro[0].y + bro[0].h / 2) - 25.4) < 1e-9,
  'brother TL glyph center at 25.4,25.4');
ok(Math.abs(bro[0].w / bro[0].h - 0.9048) < 1e-3, 'brother glyph aspect from official figure (0.9048)');

// paper: mark modes default letter in the app; math honors explicit paper
console.log('[paper]');
const Llet = M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'silhouette', paper: 'letter', orient: 'auto' });
ok(Llet.fits, '205x87 silhouette fits on US Letter');
ok(Math.abs(Llet.page.w - 215.9) < 1e-9 && Math.abs(Llet.page.h - 279.4) < 1e-9, 'letter page dims');
const Ls = M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'silhouette', paper: 'letter', orient: 'auto' });
ok(Ls.marks.length === 3 && Ls.marks[1].x + Ls.marks[1].w <= 215.9, 'letter marks inside letter width');
const Lb = M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'brother', paper: 'letter', orient: 'auto' });
ok(Lb.fits, '205x87 brother fits on US Letter');
const Ldef = M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'cut', orient: 'auto' });
ok(Math.abs(Ldef.page.h - 297) < 1e-9, 'default paper is A4');

// multi-copy imposition: 가로 ≤ 3 stacked, 세로 ≤ 2 side by side
console.log('[copies]');
const Lh3 = M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'cut', orient: 'h', copies: 3 });
ok(Lh3.fits && Lh3.nCopies === 3 && Lh3.copies.length === 3, 'cut 가로 x3 fits A4 (stacked)');
ok(Lh3.copies.every((r, i) => r.or === 'h' && Math.abs(r.x - Lh3.copies[0].x) < 1e-9
   && (i === 0 || r.y - Lh3.copies[i-1].y === 89)), '가로 copies stacked with 2mm gap');
ok(Lh3.copies.every(r => r.x >= 1 && r.y >= 1 && r.x + r.w <= 209 && r.y + r.h <= 296),
   '가로 x3 all copies on page');
const Lv2 = M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'cut', orient: 'v', copies: 2 });
ok(Lv2.fits && Lv2.nCopies === 2, 'cut 세로 x2 fits A4 (side by side)');
ok(Math.abs(Lv2.copies[1].x - Lv2.copies[0].x - 89) < 1e-9 && Math.abs(Lv2.copies[1].y - Lv2.copies[0].y) < 1e-9,
   '세로 copies side by side with 2mm gap');
ok(M.computeLayout({ wrap: { w: 170, h: 87 }, mode: 'cut', orient: 'h', copies: 9 }).nCopies === 3,
   '가로 capped at 3 copies');
ok(M.computeLayout({ wrap: { w: 170, h: 87 }, mode: 'cut', orient: 'v', copies: 9 }).nCopies === 2,
   '세로 capped at 2 copies');
ok(!M.computeLayout({ wrap: { w: 229, h: 89 }, mode: 'cut', orient: 'h', copies: 3 }).fits,
   '229mm 가로 rejected even with copies');
// mark modes: vertical ONLY, up to 2 parallel
ok(M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'silhouette', orient: 'h' }).art.or === 'v',
   'silhouette ignores 가로 — forced vertical');
ok(M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'brother', machine: 'brother',
                     orient: 'h' }).art.or === 'v',
   'brother ignores 가로 — forced vertical');
ok(M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'silhouette', orient: 'v', copies: 2 }).fits,
   'silhouette 2-up vertical fits A4 (mark zones clear)');
ok(M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'brother', machine: 'brother',
                     orient: 'v', copies: 2 }).fits,
   'brother 2-up vertical fits A4 (mark zones clear)');
ok(M.computeLayout({ wrap: { w: 205, h: 87 }, mode: 'silhouette', orient: 'v', copies: 4 }).nCopies === 2,
   'mark copies capped at 2');

// notch geometry (real 11oz shape)
console.log('[notch]');
const ng = M.notchGeom(205, 87);
ok(Math.abs(ng.r - 0.08 * 87) < 1e-9 && Math.abs(ng.y1 - 0.2 * 87) < 1e-9 && Math.abs(ng.y2 - 0.8 * 87) < 1e-9,
  'notch: r=8%h, centers at 20%/80%');
const segs = M.wrapSegs(205, 87, true);
const nC = segs.filter(s => s[0] === 'C').length;
ok(nC === 8, 'notched outline has 4 bites x 2 cubics = 8 C segments (got ' + nC + ')');
const segsOff = M.wrapSegs(205, 87, false);
ok(segsOff.length === 4 && segsOff.every(s => s[0] === 'M' || s[0] === 'L'), 'plain rect outline without notch');
// closed path starts at 0,0 and last point returns to left edge top region
ok(segs[0][0] === 'M' && segs[0][1] === 0, 'outline starts at 0,0');
// cut styles
ok(M.CUT_STYLES.light.w === 0.15 && M.CUT_STYLES.light.spec.includes('0.15pt'), 'cut style light = 0.15pt');
ok(M.CUT_STYLES.faint.w === 0.12 && M.CUT_STYLES.mid.w === 0.18, 'cut widths faint/mid = 0.12/0.18pt');
ok([M.CUT_STYLES.faint, M.CUT_STYLES.light, M.CUT_STYLES.mid]
   .every(st => st.col && st.col.length === 3 && st.col[0] > 0.75 && st.col[2] >= st.col[0]),
   'cut colours = near-white pale cyan (barely visible)');
ok(M.mm2pt(25.4) === 72, 'mm2pt(25.4) = 72');

// DXF vector cut outline
console.log('[dxf]');
const dsegs = M.wrapDxfSegs(205, 87, true);
ok(dsegs.length === 12, 'dxf outline = 8 LINE + 4 ARC (got ' + dsegs.length + ')');
let chainOK = true;
for (let i = 1; i < dsegs.length; i++) {
  const a = dsegs[i-1], b = dsegs[i];
  if (Math.abs(a.x1-b.x0) > 1e-9 || Math.abs(a.y1-b.y0) > 1e-9) chainOK = false;
}
ok(chainOK, 'dxf chain is continuous');
ok(dsegs.filter(x => x.t === 'A').every(a =>
   Math.abs(Math.hypot(a.x0-a.cx, a.y0-a.cy) - a.r) < 1e-9 &&
   Math.abs(Math.hypot(a.x1-a.cx, a.y1-a.cy) - a.r) < 1e-9 &&
   Math.abs(Math.hypot(a.xm-a.cx, a.ym-a.cy) - a.r) < 1e-9),
   'arc endpoints + midpoint lie on the notch radius');
// flattened DXF chain must match wrapSegs bezier chain (same physical outline)
const wpts = [];
for (const sg of M.wrapSegs(205, 87, true)) {
  if (sg[0] === 'C') wpts.push([sg[5], sg[6]]);
  else wpts.push([sg[1], sg[2]]);
}
const fpts = [[dsegs[0].x0, dsegs[0].y0]];
for (const sg of dsegs) {
  if (sg.t === 'A') { fpts.push([sg.xm, sg.ym]); fpts.push([sg.x1, sg.y1]); }
  else fpts.push([sg.x1, sg.y1]);
}
if (fpts.length && Math.abs(fpts[fpts.length-1][0]-fpts[0][0]) < 1e-9) fpts.pop();
ok(fpts.length === wpts.length && fpts.every((p,i) =>
   Math.abs(p[0]-wpts[i][0]) < 1e-9 && Math.abs(p[1]-wpts[i][1]) < 1e-9),
   'DXF arc outline matches bezier template outline point-for-point');
const dxfTxt = M.buildDxf({ copies: Lv2.copies, pageW: 210, pageH: 297,
                            wrap: { w: 205, h: 87 }, notch: true });
ok(dxfTxt.includes('AC1009') && dxfTxt.trim().endsWith('EOF'), 'dxf R12 header + EOF');
const lineN = (dxfTxt.match(/\r\nLINE\r\n/g) || []).length;
const arcN  = (dxfTxt.match(/\r\nARC\r\n/g) || []).length;
ok(lineN === 8 * Lv2.nCopies && arcN === 4 * Lv2.nCopies,
   'dxf entity counts for 2 copies (' + lineN + ' LINE / ' + arcN + ' ARC)');
ok(dxfTxt.includes('\r\n40\r\n6.96'), 'arc radius = 0.08 x 87 = 6.96mm');
const ys = [...dxfTxt.matchAll(/\r\n2[01]\r\n(-?[\d.]+)/g)].map(m => parseFloat(m[1]));
ok(ys.every(y => y >= -1e-6 && y <= 297 + 1e-6), 'dxf Y coords within page (Y-up mm)');
const d4 = M.buildDxf({ copies: [{ x: 0, y: 0, w: 205, h: 87, or: 'h' }],
                        pageW: 210, pageH: 297, wrap: { w: 205, h: 87 }, notch: false });
ok((d4.match(/\r\nLINE\r\n/g) || []).length === 4 && !d4.includes('\r\nARC\r\n'),
   'dxf plain rectangle when notch off');

/* ---------- PDF build test ---------- */
console.log('[pdf]');
const jpeg = new Uint8Array(fs.readFileSync(path.join(__dirname, 'test.jpg')));
// parse jpeg dimensions
function jpegSize(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    i += 2 + len;
  }
  throw new Error('no size');
}
const jsz = jpegSize(jpeg);
const mm2pt = M.mm2pt;
const ptY = (mmTop) => mm2pt(297 - mmTop);
const ops = [];
ops.push({ op: 'image', bytes: jpeg, w: jsz.w, h: jsz.h, x: mm2pt(61.5), y: ptY(46 + 205), wPt: mm2pt(87), hPt: mm2pt(205) });
ops.push({ op: 'rect', x: mm2pt(61.5), y: ptY(46 + 205), w: mm2pt(87), h: mm2pt(205), stroke: { r: 0.65, g: 0.65, b: 0.65, w: 0.3 } });
ops.push({ op: 'circle', cx: mm2pt(25.4), cy: ptY(25.4), r: mm2pt(5), fill: { r: 0, g: 0, b: 0 } });
ops.push({ op: 'path', pts: [['M', mm2pt(10), ptY(10)], ['L', mm2pt(50), ptY(10)]], stroke: { r: 1, g: 1, b: 1, w: 0.5 }, });
ops.push({ op: 'path', pts: [['M', mm2pt(10), ptY(20)], ['L', mm2pt(50), ptY(20)]], stroke: { r: 0, g: 0, b: 0, w: 0.5 }, fill: { r: 1, g: 1, b: 1, alpha: 0.5 } });
ops.push({ op: 'text', x: mm2pt(105) - 60, y: ptY(30), size: 8, gray: 0.4, text: 'CUT ALONG THE LINE (test) %' });
const pdf = M.buildPdf([{ widthPt: mm2pt(210), heightPt: mm2pt(297), ops }], { title: 'test' });
fs.writeFileSync(path.join(__dirname, 'out-test.pdf'), pdf);
ok(pdf.length > 1000, 'pdf bytes = ' + pdf.length);
const head = new TextDecoder('latin1').decode(pdf.slice(0, 8));
ok(head.startsWith('%PDF-1.4'), 'header ok: ' + head.trim());
const tail = new TextDecoder('latin1').decode(pdf.slice(-8));
ok(tail.includes('%%EOF'), 'eof ok');
// basic internal checks
const asTxt = new TextDecoder('latin1').decode(pdf);
ok(asTxt.includes('/DCTDecode'), 'jpeg xobject present');
// OCG sub-layer for marks
const ocOps = [{ op: 'image', bytes: jpeg, w: jsz.w, h: jsz.h, x: mm2pt(16), y: ptY(16 + 6), wPt: mm2pt(6), hPt: mm2pt(6), oc: 'marks' }];
const pdf2 = M.buildPdf([{ widthPt: mm2pt(210), heightPt: mm2pt(297), ops: ocOps }], {});
const t2 = new TextDecoder('latin1').decode(pdf2);
ok(t2.includes('/OCProperties') && t2.includes('/Type /OCG'), 'mark layer creates OCG');
ok(t2.includes('/OC /marks BDC') && t2.includes('EMC'), 'mark ops wrapped in BDC/EMC');
ok(t2.includes('/OC <<'), 'page resources expose /OC dict');
ok(asTxt.includes('/ExtGState'), 'alpha extgstate present');
ok(asTxt.includes('/Helvetica'), 'font present');

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures ? 1 : 0);
