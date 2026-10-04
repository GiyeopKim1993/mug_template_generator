'use strict';
/*__PDF_START__*/
/* =========================================================================
   Minimal dependency-free PDF 1.4 writer (DOM-free, pure).
   Input pages: { widthPt, heightPt, ops:[ ... ] }
   ops:
     {op:'image', bytes:Uint8Array, w:px, h:px, x, y, wPt, hPt}          // y = bottom in pt
     {op:'path', pts:[[x,y],...], closed:bool, stroke:{r,g,b,w,alpha?}, fill:{r,g,b,alpha?}}
     {op:'rect', x,y,w,h, stroke:{...}, fill:{...}}
     {op:'circle', cx,cy,r, stroke:{...}, fill:{...}}
     {op:'text', x,y,size, text:string, gray:0..1, alpha?}
   Colors are 0..1. All coordinates in PDF points, origin bottom-left.
   ========================================================================= */
function __pdfLatin1(str){
  const a = new Uint8Array(str.length);
  for(let i=0;i<str.length;i++){ a[i] = str.charCodeAt(i) & 0xff; }
  return a;
}
function __pdfEsc(s){
  let out='';
  for(let i=0;i<s.length;i++){
    const c = s.charCodeAt(i);
    let ch = s[i];
    if(ch==='('||ch===')'||ch==='\\') out += '\\'+ch;
    else if(c>126) out += '?';
    else out += ch;
  }
  return out;
}
function __num(v){
  // compact number formatting
  let s = (Math.round(v*1000)/1000).toString();
  return s;
}
function __circlePath(cx,cy,r){
  const k = 0.5522847498307936 * r;
  return [
    ['M', cx+r, cy],
    ['C', cx+r, cy+k, cx+k, cy+r, cx, cy+r],
    ['C', cx-k, cy+r, cx-r, cy+k, cx-r, cy],
    ['C', cx-r, cy-k, cx-k, cy-r, cx, cy-r],
    ['C', cx+k, cy-r, cx+r, cy-k, cx+r, cy]
  ];
}
function __pathData(pts, closed){
  let d='';
  for(const seg of pts){
    if(seg[0]==='M') d += __num(seg[1])+' '+__num(seg[2])+' m ';
    else if(seg[0]==='L') d += __num(seg[1])+' '+__num(seg[2])+' l ';
    else if(seg[0]==='C') d += __num(seg[1])+' '+__num(seg[2])+' '+__num(seg[3])+' '+__num(seg[4])+' '+__num(seg[5])+' '+__num(seg[6])+' c ';
  }
  if(closed) d += 'h ';
  return d;
}
function __paint(paint, pathStr, content, gsFor){
  let s='';
  if(paint.alpha!=null && paint.alpha<1) s += gsFor(paint.alpha)+' ';
  if(paint.fill){
    s += __num(paint.fill.r)+' '+__num(paint.fill.g)+' '+__num(paint.fill.b)+' rg '+pathStr;
    if(paint.stroke) s += 'B\n'; else s += 'f\n';
  } else if(paint.stroke){
    s += __num(paint.stroke.r)+' '+__num(paint.stroke.g)+' '+__num(paint.stroke.b)+' RG '+
         __num(paint.stroke.w)+' w '+pathStr+'S\n';
  }
  content.push(s);
}
function buildPdf(pages, meta){
  meta = meta || {};
  /* ---- collect resources ---- */
  const images = [];             // {bytes,w,h}
  const alphaMap = new Map();    // alpha -> id
  let fontUsed = false;
  const seenJpeg = new Map();
  for(const p of pages){
    for(const op of p.ops){
      if(op.op==='image'){
        const key = op.bytes.length+':'+op.w+':'+op.h;
        if(seenJpeg.has(key)) op._imgIdx = seenJpeg.get(key);
        else { op._imgIdx = images.length; seenJpeg.set(key, op._imgIdx);
               images.push({bytes:op.bytes, w:op.w, h:op.h, cmykZ:op.cmykZ, alphaZ:op.alphaZ}); }
      }
      if(op.op==='text') fontUsed = true;
      for(const pn of ['stroke','fill']){
        const pa = op[pn];
        if(pa && pa.alpha!=null && pa.alpha<1 && !alphaMap.has(pa.alpha)) alphaMap.set(pa.alpha,0);
      }
      if(op.op==='text' && op.alpha!=null && op.alpha<1 && !alphaMap.has(op.alpha)) alphaMap.set(op.alpha,0);
    }
  }
  /* ---- object ids ---- */
  const ids = { catalog:1, pages:2 };
  let next = 3;
  ids.font = fontUsed ? next++ : 0;
  ids.page = []; ids.content = [];
  for(let i=0;i<pages.length;i++){ ids.page.push(next++); ids.content.push(next++); }
  ids.images = images.map(()=>next++);
  ids.smasks = images.map(im => (im.cmykZ && im.alphaZ) ? next++ : 0);
  ids.gsa = [];
  let gi=1;
  for(const a of alphaMap.keys()){ alphaMap.set(a, gi); ids.gsa.push({alpha:a, id:next++}); gi++; }
  ids.info = next++;
  const ocNames = [...new Set(pages.flatMap(p=>p.ops.map(o=>o.oc).filter(Boolean)))];
  ids.ocs = {};
  for(const nm of ocNames){ ids.ocs[nm] = next++; }
  const objCount = next-1;

  /* ---- object bodies (functions, evaluated in id order) ---- */
  const objData = {};  // id -> Uint8Array | string
  objData[ids.catalog] = ocNames.length
    ? '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs ['+ocNames.map(nm=>ids.ocs[nm]+' 0 R').join(' ')+
      '] /D << /ON ['+ocNames.map(nm=>ids.ocs[nm]+' 0 R').join(' ')+'] /OFF [] /Order [] /BaseState /ON >> >> >>'
    : '<< /Type /Catalog /Pages 2 0 R >>';
  objData[ids.pages] = '<< /Type /Pages /Count '+pages.length+' /Kids ['+
    ids.page.map(id=>id+' 0 R').join(' ')+'] >>';
  if(fontUsed) objData[ids.font] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objData[ids.info] = '<< /Producer ('+__pdfEsc(meta.producer||'Mug Template Maker')+') /Title ('+
    __pdfEsc(meta.title||'Mug Wrap Template')+') >>';

  for(let pi=0; pi<pages.length; pi++){
    const p = pages[pi];
    /* content stream */
    const content = [];
    const gsFor = (alpha)=>{
      const name = 'GS'+alphaMap.get(alpha);
      return '/'+name+' gs';
    };
    for(const op of p.ops){
      if(op.oc) content.push('/OC /'+op.oc+' BDC\n');
      if(op.op==='image'){
        content.push('q '+__num(op.wPt)+' 0 0 '+__num(op.hPt)+' '+__num(op.x)+' '+__num(op.y)+
          ' cm /Im'+op._imgIdx+' Do Q\n');
      } else if(op.op==='rect'){
        const pts = [['M',op.x,op.y],['L',op.x+op.w,op.y],['L',op.x+op.w,op.y+op.h],['L',op.x,op.y+op.h]];
        __paint(op, __pathData(pts,true), content, gsFor);
      } else if(op.op==='circle'){
        __paint(op, __pathData(__circlePath(op.cx,op.cy,op.r),true), content, gsFor);
      } else if(op.op==='path'){
        __paint(op, __pathData(op.pts, !!op.closed), content, gsFor);
      } else if(op.op==='text'){
        let s='';
        if(op.alpha!=null && op.alpha<1) s += gsFor(op.alpha)+' ';
        const g = (op.gray!=null? op.gray:0);
        s += 'BT /F1 '+__num(op.size)+' Tf '+__num(g)+' g 1 0 0 1 '+__num(op.x)+' '+__num(op.y)+
             ' Tm ('+__pdfEsc(op.text)+') Tj ET\n';
        content.push(s);
      }
      if(op.oc) content.push('EMC\n');
    }
    const contentStr = content.join('');
    objData[ids.content[pi]] = {stream: contentStr};
    /* page dict */
    const res = ['<< /ProcSet [/PDF /ImageC /Text]'];
    if(images.length){
      res.push('/XObject << '+images.map((im,i)=>'/Im'+i+' '+ids.images[i]+' 0 R').join(' ')+' >>');
    }
    if(fontUsed) res.push('/Font << /F1 '+ids.font+' 0 R >>');
    if(alphaMap.size){
      res.push('/ExtGState << '+ids.gsa.map(g=>'/GS'+alphaMap.get(g.alpha)+' '+g.id+' 0 R').join(' ')+' >>');
    }
    if(ocNames.length){
      res.push('/OC << '+ocNames.map(nm=>'/'+nm+' '+ids.ocs[nm]+' 0 R').join(' ')+' >>');
    }
    res.push('>>');
    objData[ids.page[pi]] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+__num(p.widthPt)+' '+__num(p.heightPt)+
      '] /Resources '+res.join(' ')+' /Contents '+ids.content[pi]+' 0 R >>';
  }
  images.forEach((im,i)=>{
    if(im.cmykZ && im.alphaZ){                    // CMYK + SMask alpha (white/empty = no ink)
      objData[ids.smasks[i]] = {streamBytes: im.alphaZ,
        dict: '<< /Type /XObject /Subtype /Image /Width '+im.w+' /Height '+im.h+
              ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length '+im.alphaZ.length+' >>'};
      objData[ids.images[i]] = {streamBytes: im.cmykZ,
        dict: '<< /Type /XObject /Subtype /Image /Width '+im.w+' /Height '+im.h+
              ' /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode /SMask '+ids.smasks[i]+' 0 R /Length '+im.cmykZ.length+' >>'};
    } else {
      objData[ids.images[i]] = {streamBytes: im.bytes,
        dict: '<< /Type /XObject /Subtype /Image /Width '+im.w+' /Height '+im.h+
              ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+im.bytes.length+' >>'};
    }
  });
  ids.gsa.forEach(g=>{
    objData[g.id] = '<< /Type /ExtGState /ca '+__num(g.alpha)+' /CA '+__num(g.alpha)+' >>';
  });
  for(const nm of ocNames){
    objData[ids.ocs[nm]] = '<< /Type /OCG /Name ('+__pdfEsc(nm==='marks' ? 'Recognition marks' : nm)+') >>';
  }

  /* ---- serialize ---- */
  const chunks = [];
  let offset = 0;
  function push(d){
    if(typeof d==='string') d = __pdfLatin1(d);
    chunks.push(d); offset += d.length;
  }
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25,0xE2,0xE3,0xCF,0xD3,0x0A]));
  const xrefOffsets = new Array(objCount+1).fill(0);
  for(let id=1; id<=objCount; id++){
    xrefOffsets[id] = offset;
    const data = objData[id];
    push(id+' 0 obj\n');
    if(typeof data === 'string'){ push(data); push('\nendobj\n'); }
    else if(data.stream!=null){
      push(data.dict || ('<< /Length '+data.stream.length+' >>'));
      push('\nstream\n'); push(data.stream); push('\nendstream\nendobj\n');
    } else {
      push(data.dict);
      push('\nstream\n'); push(data.streamBytes); push('\nendstream\nendobj\n');
    }
  }
  const xrefPos = offset;
  let xref = 'xref\n0 '+(objCount+1)+'\n';
  xref += '0000000000 65535 f \n';
  for(let id=1; id<=objCount; id++){
    xref += String(xrefOffsets[id]).padStart(10,'0')+' 00000 n \n';
  }
  push(xref);
  push('trailer\n<< /Size '+(objCount+1)+' /Root 1 0 R /Info '+ids.info+' 0 R >>\nstartxref\n'+xrefPos+'\n%%EOF\n');
  /* concat */
  let total = 0; for(const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for(const c of chunks){ out.set(c, pos); pos += c.length; }
  return out;
}
/*__PDF_END__*/

/*__MATH_START__*/
/* =========================================================================
   Pure layout math — A4 page layout for mug wrap templates.
   Coordinates in mm, origin TOP-LEFT (canvas-like). Conversion to PDF
   bottom-left happens in the exporter.
   ========================================================================= */
const PAPER = {
  a4:    { w:210,   h:297,   name:'A4' },
  letter:{ w:215.9, h:279.4, name:'US Letter' }   // optional; default = A4 (online A4 mark templates)
};
const A4 = PAPER.a4;
const SIL = { inset:15.875, len:20, th:0.99, sqRatio:0.3007 };  // Studio defaults: Length 0.787in, Thickness 0.039in; sqRatio from official figure
const BRO = { inset:25.4, gw:11.0, gh:12.157 };   // glyph box (w/h = 152/168 from official figure)
const PRN = { m:7 };                                     // printer safety margin (cut mode)

function mm2pt(mm){ return mm * 72 / 25.4; }

function safeBox(mode, machine, paper){
  const pg = paper || PAPER.a4;
  if(mode==='cut') return {x:PRN.m, y:PRN.m, w:pg.w-2*PRN.m, h:pg.h-2*PRN.m};
  if(mode==='mark' && machine==='silhouette')
    return {x:SIL.inset, y:SIL.inset, w:pg.w-2*SIL.inset, h:pg.h-2*SIL.inset};
  return {x:BRO.inset, y:BRO.inset, w:pg.w-2*BRO.inset, h:pg.h-2*BRO.inset};
}
function clearance(mode, machine){
  if(mode==='cut') return 1;
  if(machine==='silhouette') return 3;
  return BRO.gh/2 + 2;    // glyph half-height + 2mm
}

/* Generate marks for mark mode (mm, top-left origin).
   Each mark is an IMAGE prim — the glyph bitmap was extracted from the official
   manuals (Silhouette Connect p.9 Type-1 figure / Brother ScanNCut Link diagram)
   and is embedded as a sub-layer in the PDF. Nothing is hand-drawn. */
function markPrims(machine, paper){
  const pg = paper || PAPER.a4;
  const out = [];
  if(machine==='silhouette'){
    const {inset:I, len:L} = SIL;
    const sq = L * SIL.sqRatio;                       // square side (figure: 43/143 of L)
    out.push({t:'img', key:'SIL_SQ',  x:I,       y:I,       w:sq, h:sq});
    out.push({t:'img', key:'SIL_L_TR', x:pg.w-I-L, y:I,       w:L,  h:L});
    out.push({t:'img', key:'SIL_L_BL', x:I,       y:pg.h-I-L, w:L,  h:L});
    return out;
  }
  // brother: 4 extracted bullseye target glyphs, centers at safe-box corners
  const {inset:I, gw, gh} = BRO;
  const corners = [
    [I, I], [pg.w-I, I], [I, pg.h-I], [pg.w-I, pg.h-I]
  ];
  for(const [cx,cy] of corners){
    out.push({t:'img', key:'BRO', x:cx-gw/2, y:cy-gh/2, w:gw, h:gh});
  }
  return out;
}

/* Forbidden zones around marks (mm, top-left origin). Artwork must not touch them. */
function markZones(machine, paper){
  const pg = paper || PAPER.a4;
  if(machine==='silhouette'){
    const {inset:I, len:L} = SIL, c = 3, sq = L*SIL.sqRatio;
    return [
      {x:I-c, y:I-c, w:sq+2*c, h:sq+2*c},                                 // TL square
      {x:pg.w-I-L-c, y:I-c, w:L+2*c, h:L+2*c},                            // TR bracket
      {x:I-c, y:pg.h-I-L-c, w:L+2*c, h:L+2*c}                             // BL bracket
    ];
  }
  const {inset:I, gw, gh} = BRO, c = 2;
  return [
    {x:I-gw/2-c, y:I-gh/2-c, w:gw+2*c, h:gh+2*c},
    {x:pg.w-I-gw/2-c, y:I-gh/2-c, w:gw+2*c, h:gh+2*c},
    {x:I-gw/2-c, y:pg.h-I-gh/2-c, w:gw+2*c, h:gh+2*c},
    {x:pg.w-I-gw/2-c, y:pg.h-I-gh/2-c, w:gw+2*c, h:gh+2*c}
  ];
}
function rectsOverlap(a,b){
  return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}

/* Shelf-pack the NEXT cell (cw×ch mm) starting from (startX,startY), dodging
   forbidden mark zones. Returns {x,y,pages}: x,y = placement (page top-left
   coords) and pages = how many page-breaks must happen BEFORE placing there
   (0/1). Returns null when the cell cannot fit even on a fresh page.
   Horizontal shelf wrap happens first, then zones push the row down, then
   the page breaks — repeat until stable. Pure & unit-tested. */
function resolveCellSpot(box, gap, zones, cw, ch, startX, startY){
  let x = startX, y = startY, pages = 0;
  const zs = zones || [];
  const maxCols = Math.max(1, Math.floor((box.w + gap) / (cw + gap)));
  const rowW = maxCols * cw + (maxCols - 1) * gap;   // full row footprint (mm)
  for(let guard=0; guard<40; guard++){
    if(x + cw > box.x + box.w + 0.05){ x = box.x; y += ch + gap; continue; }
    // validate zone clearance for the WHOLE row when the row starts —
    // keeps side-by-side cells aligned instead of staggering them
    if(Math.abs(x - box.x) < 1e-6){
      const r = {x, y, w:Math.min(rowW, box.w), h:ch};
      const z = zs.find(zz => rectsOverlap(r, zz));
      if(z){ y = z.y + z.h + 0.5; continue; }
    }
    if(y + ch > box.y + box.h + 0.05){                // vertical overflow
      if(pages > 0) return null;                      // fresh page already tried
      x = box.x; y = box.y; pages++; continue;
    }
    return {x, y, pages};
  }
  return null;
}

/* Resolve orientation + placement. Returns full layout or {error}. */
function computeLayout(args){
  const wrap = args.wrap;                 // {w,h} mm
  const mode = args.mode;                 // 'cut' | 'mark'
  const machine = args.machine || 'silhouette';
  let orientPref = args.orient || 'auto'; // 'auto'|'v'|'h'
  const copiesPref = Math.max(1, Math.min(9, parseInt(args.copies,10)||1));
  const paper = (args.paper && args.paper.w) ? args.paper
              : (typeof args.paper === 'string' && PAPER[args.paper]) ? PAPER[args.paper]
              : PAPER.a4;
  // Silhouette / ScanNCut print-to-cut layouts are VERTICAL only
  if(mode !== 'cut') orientPref = 'v';
  const box = safeBox(mode, machine, paper);
  const cl = clearance(mode, machine);
  const avail = { w: box.w - 2*cl, h: box.h - 2*cl };
  const zones = (mode!=='cut') ? markZones(machine, paper) : [];

  function place(or){
    const w = or==='v' ? wrap.h : wrap.w;
    const h = or==='v' ? wrap.w : wrap.h;
    return {x: box.x + (box.w - w)/2, y: box.y + (box.h - h)/2, w, h, or};
  }
  const insideBox = (L)=> L.w<=avail.w+1e-9 && L.h<=avail.h+1e-9;
  const zoneClear = (L)=> zones.every(z=>!rectsOverlap(L,z));
  const fit = (L)=> insideBox(L) && zoneClear(L);
  const prefOr = (wrap.w<=wrap.h) ? 'v'
      : (wrap.w <= avail.w ? 'h' : 'v');

  let art=null;
  if(orientPref==='auto'){
    const order = [prefOr, prefOr==='h'?'v':'h'];
    for(const o of order){ const L=place(o); if(fit(L)){ art=L; break; } }
    if(!art) art = place(order[0]);
  } else {
    art = place(orientPref);
  }

  /* ---- multi-copy imposition: 가로 최대 3개(세로 스택), 세로 최대 2개(가로 병렬) ---- */
  const COPY_GAP = 2;                                   // mm between copies (room to cut)
  const maxN = (art.or==='h') ? 3 : 2;
  const n = Math.min(copiesPref, maxN);
  const copies = [];
  if(n === 1) copies.push(art);
  else if(art.or === 'h'){
    const total = n*art.h + (n-1)*COPY_GAP;
    const y0 = box.y + (box.h - total)/2;
    for(let i=0;i<n;i++) copies.push({x:art.x, y:y0 + i*(art.h+COPY_GAP), w:art.w, h:art.h, or:'h'});
  } else {
    const total = n*art.w + (n-1)*COPY_GAP;
    const x0 = box.x + (box.w - total)/2;
    for(let i=0;i<n;i++) copies.push({x:x0 + i*(art.w+COPY_GAP), y:art.y, w:art.w, h:art.h, or:'v'});
  }

  const EDGE = 1;                                      // cut mode: page-edge keep-out (mm)
  const EDGE_M = 5;                                    // mark mode: printer margin (mm)
  const inPage = (r, e)=> r.x>=e-1e-9 && r.y>=e-1e-9
                    && r.x+r.w <= paper.w-e+1e-9 && r.y+r.h <= paper.h-e+1e-9;
  // mark modes only need to dodge the actual registration-mark zones
  // (real machines scan the corners — the rest of the sheet is free)
  const fits = copies.every(r =>
    mode==='cut' ? inPage(r, EDGE) : (zoneClear(r) && inPage(r, EDGE_M)));

  const res = {
    art: copies[0], copies, nCopies: n, fits, mode, machine,
    safe: box,
    page: paper,
    wrap: {w:wrap.w, h:wrap.h},
    errors: []
  };
  if(!fits){
    res.errors.push('템플릿이 '+
      (mode==='cut' ? '인쇄 가능 영역' : (machine==='silhouette' ? '실루엣 인식 마크 안전 영역' : '스캔앤컷 인식 마크 안전 영역'))+
      '에 맞지 않습니다 — 배치를 바꾸거나 템플릿 크기를 줄여주세요.');
  }
  if(mode!=='cut'){
    res.marks = markPrims(machine, paper);
  }
  return res;
}

/* ---- real 11oz wrap shape: rectangle + 4 semicircular handle notches ----
   Measured from real templates (Ainayar shrink-wrap 11oz, 15oz cutout sheets):
   notch radius = 0.08 * H, centers at y = 0.20H and 0.80H on BOTH short edges
   (x=0 and x=W), i.e. the two edges that meet at the handle. */
function notchGeom(w, h){
  return { r: 0.08*h, y1: 0.20*h, y2: 0.80*h };
}
/* Outline path segments in wrap mm coords (top-left origin, clockwise).
   Format: [['M',x,y],['L',x,y],['C',x1,y1,x2,y2,x,y],...] for canvas+PDF. */
function wrapSegs(w, h, notch){
  const segs = [['M',0,0],['L',w,0]];
  if(notch === false){
    segs.push(['L',w,h],['L',0,h]);
    return segs;
  }
  const {r,y1,y2} = notchGeom(w,h);
  const k = 0.5522847498307936 * r;
  // right edge, top -> bottom, bites bulge LEFT (into the wrap)
  segs.push(['L',w,y1-r]);
  segs.push(['C',w-k,y1-r, w-r,y1-k, w-r,y1]);
  segs.push(['C',w-r,y1+k, w-k,y1+r, w,y1+r]);
  segs.push(['L',w,y2-r]);
  segs.push(['C',w-k,y2-r, w-r,y2-k, w-r,y2]);
  segs.push(['C',w-r,y2+k, w-k,y2+r, w,y2+r]);
  segs.push(['L',w,h],['L',0,h]);
  // left edge, bottom -> top, bites bulge RIGHT (into the wrap)
  segs.push(['L',0,y2+r]);
  segs.push(['C',k,y2+r, r,y2+k, r,y2]);
  segs.push(['C',r,y2-k, k,y2-r, 0,y2-r]);
  segs.push(['L',0,y1+r]);
  segs.push(['C',k,y1+r, r,y1+k, r,y1]);
  segs.push(['C',r,y1-k, k,y1-r, 0,y1-r]);
  return segs;
}

/* Vector cut outline for DXF: exact LINE + ARC entities (same geometry as
   wrapSegs: rectangle + 4 semicircular handle notches). Wrap mm coords, y-down. */
function wrapDxfSegs(w, h, notch){
  const segs = [];
  if(notch === false){
    segs.push({t:'L',x0:0,y0:0,x1:w,y1:0}, {t:'L',x0:w,y0:0,x1:w,y1:h},
              {t:'L',x0:w,y0:h,x1:0,y1:h}, {t:'L',x0:0,y0:h,x1:0,y1:0});
    return segs;
  }
  const {r,y1,y2} = notchGeom(w,h);
  segs.push({t:'L',x0:0,y0:0,x1:w,y1:0});
  segs.push({t:'L',x0:w,y0:0,x1:w,y1:y1-r});
  segs.push({t:'A',cx:w,cy:y1,r:r, x0:w,y0:y1-r, xm:w-r,ym:y1, x1:w,y1:y1+r});
  segs.push({t:'L',x0:w,y0:y1+r,x1:w,y1:y2-r});
  segs.push({t:'A',cx:w,cy:y2,r:r, x0:w,y0:y2-r, xm:w-r,ym:y2, x1:w,y1:y2+r});
  segs.push({t:'L',x0:w,y0:y2+r,x1:w,y1:h});
  segs.push({t:'L',x0:w,y0:h,x1:0,y1:h});
  segs.push({t:'L',x0:0,y0:h,x1:0,y1:y2+r});
  segs.push({t:'A',cx:0,cy:y2,r:r, x0:0,y0:y2+r, xm:r,ym:y2, x1:0,y1:y2-r});
  segs.push({t:'L',x0:0,y0:y2-r,x1:0,y1:y1+r});
  segs.push({t:'A',cx:0,cy:y1,r:r, x0:0,y0:y1+r, xm:r,ym:y1, x1:0,y1:y1-r});
  segs.push({t:'L',x0:0,y0:y1-r,x1:0,y1:0});
  return segs;
}
/* DXF (R12 / AC1009) text with the cut outlines of every placed copy.
   Units = mm, origin = page top-left, Y flipped to Y-up so the file overlays
   the printed page 1:1 when imported into Silhouette Studio / Canvas Workspace. */
function buildDxf(args){
  const copies = args.copies, pgH = args.pageH;
  const wrap = args.wrap, notch = args.notch;
  const num = (v)=> String(Math.round(v*1e4)/1e4);
  const out = [];
  const put = (c,v)=>{ out.push(String(c), String(v)); };
  put(0,'SECTION'); put(2,'HEADER');
  put(9,'$ACADVER'); put(1,'AC1009');
  put(9,'$INSUNITS'); put(70,'4');      // millimetres (ignored by old readers)
  put(0,'ENDSEC');
  put(0,'SECTION'); put(2,'ENTITIES');
  for(let i=0; i<copies.length; i++){
    const r = copies[i];
    const wr = (args.wraps && args.wraps[i]) || wrap;
    const nt = (args.notches && args.notches[i] !== undefined) ? args.notches[i] : notch;
    const src = wrapDxfSegs(wr.w, wr.h, nt);
    const T = (r.or==='v')
      ? (x,y)=>[r.x + y, r.y + r.h - x]      // true 90° rotation, never stretched
      : (x,y)=>[r.x + x, r.y + y];
    for(const sg of src){
      if(sg.t==='L'){
        const a=T(sg.x0,sg.y0), b=T(sg.x1,sg.y1);
        put(0,'LINE'); put(8,'0');
        put(10,num(a[0])); put(20,num(pgH-a[1])); put(30,'0');
        put(11,num(b[0])); put(21,num(pgH-b[1])); put(31,'0');
      } else {
        const c=T(sg.cx,sg.cy), p0=T(sg.x0,sg.y0), pm=T(sg.xm,sg.ym), p1=T(sg.x1,sg.y1);
        const ang = (p)=>Math.atan2(pgH-p[1], p[0]);          // Y-up angle
        const norm = (x)=>((x%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
        let a0=ang(p0), a1=ang(p1); const am=ang(pm);
        if(norm(am-a0) > norm(a1-a0)+1e-9){ const t=a0; a0=a1; a1=t; }  // CCW must pass mid
        put(0,'ARC'); put(8,'0');
        put(10,num(c[0])); put(20,num(pgH-c[1])); put(30,'0');
        put(40,num(sg.r));
        put(50,num(a0*180/Math.PI)); put(51,num(a1*180/Math.PI));
      }
    }
  }
  put(0,'ENDSEC'); put(0,'EOF');
  return out.join('\r\n') + '\r\n';
}
/* SVG cut outlines (mm, top-left origin, y-down) — imports cleanly into
   Brother CanvasWorkspace (SVG) and Silhouette Studio. Same inputs as buildDxf. */
function buildSvg(args){
  const copies = args.copies;
  const wrap = args.wrap, notch = args.notch;
  const n3 = (v)=> String(Math.round(v*1e4)/1e4);
  const parts = [];
  const normA = (a)=> ((a % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
  for(let i=0; i<copies.length; i++){
    const r = copies[i];
    const wr = (args.wraps && args.wraps[i]) || wrap;
    const nt = (args.notches && args.notches[i] !== undefined) ? args.notches[i] : notch;
    const src = wrapDxfSegs(wr.w, wr.h, nt);
    const T = (r.or==='v')
      ? (x,y)=>[r.x + y, r.y + r.h - x]      // same true-90° rotation as DXF/PDF
      : (x,y)=>[r.x + x, r.y + y];
    let d = '';
    for(const sg of src){
      if(sg.t==='L'){
        const a=T(sg.x0,sg.y0), b=T(sg.x1,sg.y1);
        d += (d? ' L ':'M ') + n3(a[0]) + ' ' + n3(a[1]) + ' L ' + n3(b[0]) + ' ' + n3(b[1]);
      } else {
        const c=T(sg.cx,sg.cy), p0=T(sg.x0,sg.y0), pm=T(sg.xm,sg.ym), p1=T(sg.x1,sg.y1);
        const ang=(p)=>Math.atan2(p[1]-c[1], p[0]-c[0]);
        let a0=ang(p0), am=ang(pm), a1=ang(p1);
        const ccw = normA(a1-a0);
        let delta = (normA(am-a0) <= ccw + 1e-9) ? ccw : ccw - 2*Math.PI;
        const sweep = delta > 0 ? 1 : 0;
        const large = Math.abs(delta) > Math.PI ? 1 : 0;
        d += ' L ' + n3(p0[0]) + ' ' + n3(p0[1]) +
             ' A ' + n3(sg.r) + ' ' + n3(sg.r) + ' 0 ' + large + ' ' + sweep +
             ' ' + n3(p1[0]) + ' ' + n3(p1[1]);
      }
    }
    if(d) parts.push('<path d="' + d.trim() + '"/>');
  }
  const pw = args.pageW || 210, ph = args.pageH || 297;
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + n3(pw) + 'mm" height="' + n3(ph) + 'mm" ' +
    'viewBox="0 0 ' + n3(pw) + ' ' + n3(ph) + '">\n' +
    '<g fill="none" stroke="#000000" stroke-width="0.15">\n' + parts.join('\n') +
    '\n</g>\n</svg>\n';
}

/* Cut line appearance presets — ultra-thin + PALE CYAN (non-repro style):
   a colour that barely shows on paper regardless of density. */
const CUT_STYLES = {
  faint: {label:'아주 옅게', gray:0.94, w:0.12, col:[0.918,0.973,0.980], spec:'0.12pt · 페일 시안'},
  light: {label:'옅게 (기본)', gray:0.90, w:0.15, col:[0.867,0.953,0.965], spec:'0.15pt · 페일 시안'},
  mid:   {label:'보통', gray:0.84, w:0.18, col:[0.800,0.925,0.941], spec:'0.18pt · 페일 시안'}
};
/*__MATH_END__*/

/* ================= Pure: DOM-free core (unit-tested in test/unit_test.js) ============ */
const Pure = (function(){
  'use strict';
  // texture column u-mapping. NOTE: formula ported1:1 from the original inline
  // closure — the unit test locks its contract (see test/unit_test.js).
  // JS % keeps the sign of the dividend — ((x)+540)%360 goes NEGATIVE once
  // th exceeds ~540° (about 1.5 right-turns), producing negative u for whole
  // column ranges → clamped sampling → stripes + image collapse (user repro:
  // two right turns hide the cat; turning left stays clean because th<0 is
  // handled by the positive part of the range).  wrapDeg is the fix: a true
  // mathematical modulo, period-360 invariant in BOTH arguments.
  function wrapDeg(x){ return ((x % 360) + 360) % 360; }        // → [0,360)
  function textureU(angDeg, thDeg, gapDeg){
    const span = 360 - 2*gapDeg;
    const d = wrapDeg(angDeg - thDeg + 180) - 180;              // → (-180,180]
    if(Math.abs(d) <= gapDeg) return null;                      // seam gap (under handle)
    return wrapDeg(d - gapDeg) / span;                          // → [0,1)
  }
  // nearest zone-centre snap: 0.245 / 0.5 / 0.755 of wrap width, tol in mm.
  // Exact tie behaviour preserved from the original loop (strict < keeps the
  // earlier candidate). Returns snapped value or null when nothing in range.
  function zoneSnapX(cx, wrapW, tol){
    const zcs = [wrapW*0.245, wrapW/2, wrapW*0.755];
    let bt = zcs[0], bd = Math.abs(cx - zcs[0]);
    for(const t of zcs){ const d = Math.abs(cx - t); if(d < bd){ bd = d; bt = t; } }
    return bd <= tol ? bt : null;
  }
  // cylinder depth at screen-fraction s in [-1,1] (0 = centre, ±1 = silhouette)
  function depthZ(s, r){
    return r*Math.sqrt(Math.max(0, 1 - s*s));
  }
  return { wrapDeg, textureU, zoneSnapX, depthZ };
})();
