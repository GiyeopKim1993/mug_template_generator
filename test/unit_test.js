// Unit tests for js/pure.js (DOM-free core).  Run:  node unit_test.js
// Purpose: lock the contracts of every pure function so bug paths
//          (e.g. rotation-dependent texture collapse) are blocked here first.
'use strict';
const fs = require('fs');
const path = require('path');

const pureCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'pure.js'), 'utf8');
const _api = new Function(pureCode + '\nreturn {Pure, buildDxf, buildSvg, wrapDxfSegs};')();
const Pure = _api.Pure;
const buildDxf = _api.buildDxf;
const buildSvg = _api.buildSvg;

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
/* ---------------- summary ---------------- */
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

