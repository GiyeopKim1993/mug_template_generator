// Unit tests for js/pure.js (DOM-free core).  Run:  node unit_test.js
// Purpose: lock the contracts of every pure function so bug paths
//          (e.g. rotation-dependent texture collapse) are blocked here first.
'use strict';
const fs = require('fs');
const path = require('path');

const pureCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'pure.js'), 'utf8');
const _api = new Function(pureCode + '\nreturn {Pure, buildDxf, buildSvg, wrapDxfSegs, resolveCellSpot, rectsOverlap, markZones, segTransform, wrapSegs, wrapSegsToPts};')();
const Pure = _api.Pure;
const buildDxf = _api.buildDxf;
const buildSvg = _api.buildSvg;
const resolveCellSpot = _api.resolveCellSpot;
const rectsOverlap = _api.rectsOverlap;
const markZones = _api.markZones;
const segTransform = _api.segTransform;
const wrapSegs = _api.wrapSegs;
const wrapSegsToPts = _api.wrapSegsToPts;

let failures = 0, passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; console.log('  ✓ ' + msg); }
  else { failures++; console.log('  ✗ FAIL: ' + msg); }
}
function eq(a, b, msg) {
  ok(Object.is(a, b) || (a !== null && b !== null && Math.abs(a - b) < 1e-9),
     msg + `  (got ${a}, want ${b})`);
}

/* ---------------- textureU: cylinder column mapping ---------------- */
console.log('[textureU]');
const GAP = 11;

// (1) PERIODICITY in th — the rotation bug: rotating ±360°/±720° must not
//     change the mapping at all.  (Broken by JS negative-modulo before fix.)
let periodFail = false;
for (const k of [-2, -1, 1, 2]) {
  for (const base of [0, 45, 90, 165, 180, 270]) {
    for (const ang of [30, 120, 270, 350]) {
      const a = Pure.textureU(ang, base, GAP);
      const b = Pure.textureU(ang, base + 360 * k, GAP);
      const same = (a === null && b === null) ||
                   (a !== null && b !== null && Math.abs(a - b) < 1e-9);
      if (!same) {
        periodFail = true;
        ok(false, `periodicity th=${base}+${360 * k}° ang=${ang} (u=${a} vs ${b})`);
      }
    }
  }
}
ok(!periodFail, 'periodicity: ±360°/±720° rotations reproduce identical u');

// (2) the exact user scenario: two full right-turns (th0 → th0+720)
{
  const th0 = 180, thR = 180 + 720;
  let worst = 0;
  for (let ang = 0; ang <= 359; ang += 7) {
    const a = Pure.textureU(ang, th0, GAP);
    const b = Pure.textureU(ang, thR, GAP);
    if ((a === null) !== (b === null)) { worst = 999; break; }
    if (a !== null) worst = Math.max(worst, Math.abs(a - b));
  }
  ok(worst < 1e-9, `user repro: +2 right turns keep texture intact (maxΔ=${worst})`);
}

// (3) u always in [0,1] or null — negative u collapses columns (stripes)
{
  let bad = [];
  for (const th of [0, 90, 180, 450, 720, 900, -540, -720, 3600 + 45]) {
    for (let ang = -400; ang <= 400; ang += 13) {
      const u = Pure.textureU(ang, th, GAP);
      if (u !== null && (u < 0 || u > 1)) { bad.push([ang, th, +u.toFixed(3)]); break; }
    }
  }
  ok(bad.length === 0, `u ∈ [0,1] for all angles/rotations` + (bad.length ? ' bad=' + JSON.stringify(bad.slice(0,3)) : ''));
}

// (4) seam gap: |ang-th| ≤ GAP → null (white seam under handle), any th
{
  let bad = [];
  for (const th of [0, 180, 900, -720]) {
    for (const off of [-GAP, -GAP + 0.5, 0, GAP - 0.5, GAP]) {
      const u = Pure.textureU(th + off, th, GAP);
      if (u !== null) { bad.push([th, off]); }
    }
  }
  ok(bad.length === 0, `seam gap returns null` + (bad.length ? ' bad=' + JSON.stringify(bad) : ''));
}

// (5) just outside the gap: u ≈ 0 (right edge) and ≈ 1 (left edge)
{
  const uR = Pure.textureU(180 + GAP + 0.01, 180, GAP);
  const uL = Pure.textureU(180 - GAP - 0.01, 180, GAP);
  ok(uR !== null && uR < 0.01, `u just right of gap ≈ 0 (got ${uR})`);
  ok(uL !== null && uL > 0.99, `u just left of gap ≈ 1 (got ${uL})`);
}

// (6) facing point maps to mid-wrap
{
  const u = Pure.textureU(180 + 180, 180, GAP);
  eq(u, 0.5, 'point opposite the seam maps to u=0.5');
}

/* ---------------- zoneSnapX: zone-centre snapping ---------------- */
console.log('[zoneSnapX]');
{
  const W = 205, GS = 2.5;
  eq(Pure.zoneSnapX(W * 0.245, W, GS), 50.225, 'left zone centre snaps exactly');
  eq(Pure.zoneSnapX(W / 2,      W, GS), 102.5,  'centre snaps exactly');
  eq(Pure.zoneSnapX(W * 0.755,  W, GS), 154.775,'right zone centre snaps exactly');
  eq(Pure.zoneSnapX(W * 0.245 + 2.0, W, GS), 50.225, 'within tol snaps back');
  eq(Pure.zoneSnapX(W * 0.245 + 3.0, W, GS), null,   'outside tol → no snap');
  // midpoint between two zone centres is far outside tol → no snap
  const tie = (W * 0.245 + W * 0.5) / 2;
  eq(Pure.zoneSnapX(tie, W, GS), null, 'midpoint between zones → no snap');
}

/* ---------------- depthZ: cylinder depth ---------------- */
console.log('[depthZ]');
{
  const r = 100;
  eq(Pure.depthZ(0, r), r, 'depth at centre = r');
  eq(Pure.depthZ(1, r), 0, 'depth at silhouette = 0');
  eq(Pure.depthZ(-1, r), 0, 'depth at other silhouette = 0');
  ok(Pure.depthZ(0.3, r) === Pure.depthZ(-0.3, r), 'even function');
  let mono = true;
  for (let s = 0; s < 1; s += 0.05) {
    if (Pure.depthZ(s, r) < Pure.depthZ(s + 0.05, r)) mono = false;
  }
  ok(mono, 'monotonically decreasing on [0,1]');
  ok(isNaN(Pure.depthZ(1.5, r)) === false && Pure.depthZ(1.5, r) === 0, 'clamped outside [-1,1]');
}

/* ---------------- buildDxf / buildSvg (R5 machine cut files) ---------------- */
console.log('[buildDxf/buildSvg]');
{
  const wrap={w:205,h:87};
  // no-notch rectangle, landscape copy
  const dxf = buildDxf({copies:[{x:10,y:20,w:205,h:87,or:'h'}], pageW:210, pageH:297, wrap, notch:false});
  ok(dxf.includes('SECTION') && dxf.includes('EOF'), 'dxf has SECTION/EOF');
  ok((dxf.match(/LINE/g)||[]).length===4, 'dxf no-notch = 4 LINE entities');
  ok(!/NaN/.test(dxf), 'dxf has no NaN');
  // notch arcs present when enabled
  const dxfN = buildDxf({copies:[{x:5,y:5,w:205,h:87,or:'h'}], pageW:210, pageH:297, wrap, notch:true});
  ok((dxfN.match(/ARC/g)||[]).length>=4, 'dxf notch yields >=4 ARC entities');
  // svg basics
  const svg = buildSvg({copies:[{x:10,y:20,w:205,h:87,or:'h'}], pageW:210, pageH:297, wrap, notch:false});
  ok(svg.includes('viewBox="0 0 210 297"'), 'svg viewBox matches page');
  ok((svg.match(/<path/g)||[]).length===1, 'svg one path per copy');
  ok(!/NaN|undefined/.test(svg), 'svg has no NaN/undefined');
  // rotated copy (mark-mode cells) stays inside the page box
  const svgV = buildSvg({copies:[{x:15,y:15,w:87,h:205,or:'v'}], pageW:210, pageH:297, wrap, notch:true});
  const dAttr=(svgV.match(/ d="([^"]+)"/)||[])[1]||'';
  const nums=(dAttr.match(/-?\d+\.?\d*/g)||[]).map(Number);
  ok(nums.length>10 && nums.every(v=>Number.isFinite(v) && v>=-1 && v<400),
     'svg rotated path coords stay in mm page range');
  ok(svgV.includes(' A '), 'svg notch emits arcs');
  // per-copy wraps
  const svg2 = buildSvg({copies:[{x:0,y:0,w:87,h:205,or:'v'},{x:95,y:0,w:87,h:205,or:'v'}],
    pageW:210, pageH:297, wrap, notch:false, wraps:[{w:205,h:87},{w:216,h:89}], notches:[false,false]});
  ok((svg2.match(/<path/g)||[]).length===2, 'svg per-copy wraps => 2 paths');
}
/* ---------------- resolveCellSpot (imposed packer, overlap regression) -------- */
{
  const box = {x:25.4, y:25.4, w:159.2, h:246.2};           // brother safe box on A4 (inset 25.4 — 실루엣 제거)
  const zones = markZones('brother', {w:210, h:297});
  const gap = 3, cw = 70, ch = 205;
  // fresh spot at box origin: TL square zone must push it down, never overlap
  const s1 = resolveCellSpot(box, gap, zones, cw, ch, box.x, box.y);
  ok(s1 && s1.pages === 0, 'resolve: first cell lands on same page');
  const r1 = {x:s1.x, y:s1.y, w:cw, h:ch};
  ok(zones.every(z => !rectsOverlap(r1, z)), 'resolve: first cell clears ALL mark zones');
  ok(s1.y > box.y, 'resolve: first cell pushed out of the TL zone');
  // second column stays in row 1 (no zone conflict) and keeps the gap
  const s2 = resolveCellSpot(box, gap, zones, cw, ch, s1.x + cw + gap, s1.y);
  ok(s2 && s2.y === s1.y && s2.x === s1.x + cw + gap, 'resolve: second column in same row');
  ok(s2.x + cw <= box.x + box.w + 0.05, 'resolve: second column inside box');
  // next row: push down past zone again if needed, still page 0 when it fits
  const s3 = resolveCellSpot(box, gap, zones, cw, ch, s2.x + cw + gap, s2.y);
  ok(s3 && s3.pages === 1, 'resolve: row 2 needs a page break (205mm > remaining)');
  const r3 = {x:s3.x, y:s3.y, w:cw, h:ch};
  ok(zones.every(z => !rectsOverlap(r3, z)), 'resolve: post-break cell also zone-clear');
  // impossible cell → null (never loops forever)
  const s4 = resolveCellSpot(box, gap, zones, 400, 400, box.x, box.y);
  ok(s4 === null, 'resolve: oversized cell returns null');
  // brother: zone at EVERY corner — first row must clear the top corners
  const bzones = markZones('brother', {w:210, h:297});
  const bbox = {x:25.4, y:25.4, w:159.2, h:246.2};
  const b1 = resolveCellSpot(bbox, gap, bzones, 87, 205, bbox.x, bbox.y);
  ok(b1 && bzones.every(z => !rectsOverlap({x:b1.x, y:b1.y, w:87, h:205}, z)),
     'resolve: brother cell clears all 4 bullseye zones');
}
/* ---------------- R-2 shared helpers: segTransform / wrapSegsToPts ---------------- */
{
  const eq=(a,b)=> a[0]===b[0] && a[1]===b[1];
  // horizontal: pure translation, never stretched
  const Th = segTransform(10, 20, 205, 'h');
  ok(eq(Th(0,0), [10,20]), 'segT h: origin translates');
  ok(eq(Th(50,70), [60,90]), 'segT h: mid translates 1:1 (no scale)');
  // vertical: true 90° rotation — design-top -> page-left, area preserved
  const Tv = segTransform(10, 20, 205, 'v');
  ok(eq(Tv(0,0), [10,225]), 'segT v: (0,0) -> (x, y+h)');
  ok(eq(Tv(0,205), [215,225]), 'segT v: (0,h) -> (x+h, y+h)  [design left edge sweeps cell bottom]');
  ok(eq(Tv(50,70), [80,175]), 'segT v: (50,70) -> (x0+y, y0+h-x)');
  // never stretched: rectangle area is invariant under both orientations
  const area=(T)=>{ const p=[T(0,0),T(10,0),T(10,5),T(0,5)];
    return Math.abs((p[1][0]-p[0][0])*(p[3][1]-p[0][1]) - (p[1][1]-p[0][1])*(p[3][0]-p[0][0])); };
  ok(area(Th)===50 && area(Tv)===50, 'segT: area invariant (no stretch) h & v');
  // wrapSegsToPts: every segment routed through T (mm->mm) then P (mm->pt)
  const segs = wrapSegs(100, 50, false);
  const T = (x,y)=>[x+1, y+2];
  const P = (x,y)=>[x*2, y*3];
  const pts = wrapSegsToPts(100, 50, false, T, P);
  ok(pts.length === segs.length, 'wrapSegsToPts: one output per input segment');
  ok(pts[0][0]==='M' && pts[0][1]===2 && pts[0][2]===6, 'pts M: T(0,0)=(1,2) -> P=(2,6)');
  ok(pts[1][0]==='L' && pts[1][1]===202 && pts[1][2]===6, 'pts L: T(100,0)=(101,2) -> P=(202,6)');
  ok(pts[2][0]==='L' && pts[2][1]===202 && pts[2][2]===156, 'pts L: T(100,50) -> P=(202,156)');
  const last = pts[pts.length-1];
  ok(last[0]==='L' && last[1]===2 && last[2]===156, 'pts closes at left edge');
  // notched outline: cubic tuples stay 7-long (C,c1x,c1y,c2x,c2y,ex,ey)
  const pn = wrapSegsToPts(100, 50, true, (x,y)=>[x,y], (x,y)=>[x,y]);
  ok(pn.every(sg => (sg[0]==='M'||sg[0]==='L') ? sg.length===3 : (sg[0]==='C' && sg.length===7)),
     'wrapSegsToPts: tuple arity per command');
}

/* ---------------- summary ---------------- */
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

