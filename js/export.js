/* js/export.js — S4: PDF/DXF/save pipeline (STRUCTURE §3).
   Pure byte/delivery flow; UI buttons stay in app.js and call into here. */
const _imp = {key:null, pages:null, result:null, p:0, timer:0, building:false, queued:false};   // imposed cache: result shared by preview AND export (S3b)

function requestImposedPrev(){
  clearTimeout(_imp.timer);
  _imp.timer=setTimeout(buildImposedPrev, 300);
}
async function buildImposedPrev(){
  if(!drafts.length || state.exportScope!=='list') return;
  if(_imp.building){ _imp.queued=true; return; }          // no concurrent builds (state races)
  if(_imp.key===imposedKey() && _imp.pages){ renderImposedPrev(); return; }
  _imp.building=true;
  const modalEl=document.getElementById('printModal');
  if(modalEl) modalEl.classList.add('busy');
  updateExportUI();
  const key=imposedKey();
  try{
    const result = await computeImposedPages(state.machine, 'a4',
      {mode: state.mode==='cut'?'cut':'mark', orient: state.orient});
    _imp.result=result; _imp.pages=result.pages;
    _imp.p=Math.max(0, Math.min(_imp.p, result.pages.length-1)); _imp.key=key;
  }catch(e){
    console.warn('imposed preview failed', e);
    _imp.key=key; _imp.pages=null; _imp.result=null;    // negative cache — don't loop
    const pc=document.getElementById('prevCap');
    if(pc) pc.textContent='미리보기 오류: '+(e.message||e);
  }finally{
    _imp.building=false;
    if(modalEl) modalEl.classList.remove('busy');
    updateExportUI();
    if(_imp.queued){ _imp.queued=false; setTimeout(buildImposedPrev, 80); }
  }
  if(_imp.key===imposedKey()){ if(_imp.pages) renderImposedPrev(); }
}
/* ---- print raster: RGB -> CMYK + alpha; alpha = source transparency only
   (개정 2026-10-05: CMYK(0,0,0,0) white is valid data — NOT alpha) ---- */
async function deflateZ(u8){
  const st = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(st).arrayBuffer());
}
async function pdfArtRaster(cv){
  const w=cv.width, h=cv.height;
  const px=cv.getContext('2d').getImageData(0,0,w,h).data;
  const cmyk=new Uint8Array(w*h*4), alpha=new Uint8Array(w*h);
  for(let i=0,j=0;i<alpha.length;i++,j+=4){
    const r=px[j], g=px[j+1], b=px[j+2];
    alpha[i] = px[j+3]<16 ? 0 : 255;   // no source data -> alpha; opaque white (CMYK 0,0,0,0) stays 255
    let C=1-r/255, M=1-g/255, Y=1-b/255;
    const K = C<M ? (C<Y?C:Y) : (M<Y?M:Y);
    if(K<1){ C=(C-K)/(1-K); M=(M-K)/(1-K); Y=(Y-K)/(1-K); }
    cmyk[j]=(C*255+0.5)|0; cmyk[j+1]=(M*255+0.5)|0; cmyk[j+2]=(Y*255+0.5)|0; cmyk[j+3]=(K*255+0.5)|0;
  }
  const [cz, az] = await Promise.all([deflateZ(cmyk), deflateZ(alpha)]);
  return {cmykZ:cz, alphaZ:az};
}
function primToOps(prim, ops){
  if(prim.t==='img'){
    const gi = MARK_IMGS[prim.key];
    if(!gi || !gi.complete || !gi.naturalWidth) return;
    ops.push({op:'image', bytes:dataUrlBytes(MARK_DATA[prim.key]),
      w:gi.naturalWidth, h:gi.naturalHeight,
      x:mm2pt(prim.x), y:ptY(prim.y+prim.h),
      wPt:mm2pt(prim.w), hPt:mm2pt(prim.h), oc:'marks'});
    return;
  }
  if(prim.t==='fillrect'){
    ops.push({op:'rect', x:mm2pt(prim.x), y:ptY(prim.y+prim.h), w:mm2pt(prim.w), h:mm2pt(prim.h),
      fill:{r:prim.c[0],g:prim.c[1],b:prim.c[2]}});
  } else if(prim.t==='fillcircle'){
    ops.push({op:'circle', cx:mm2pt(prim.cx), cy:ptY(prim.cy), r:mm2pt(prim.r),
      fill:{r:prim.c[0],g:prim.c[1],b:prim.c[2]}});
  } else if(prim.t==='line'){
    ops.push({op:'path', pts:[['M',mm2pt(prim.x1),ptY(prim.y1)],['L',mm2pt(prim.x2),ptY(prim.y2)]],
      stroke:{r:prim.c[0],g:prim.c[1],b:prim.c[2], w:mm2pt(prim.w)}});
  }
}
/* top-left mm -> pdf pt (bottom-left), page height from current paper */
function ptY(mmTop){ return mm2pt(PAPER[state.paper].h - mmTop); }

function isFramed(){ try{ return window.self !== window.top; }catch(e){ return true; } }
/* sandboxed preview iframes silently BLOCK every <a download> — even direct user
   clicks — so framed contexts get an in-app save panel instead of a lying toast. */
let _spUrl=null;
let _spQueue=[];
function closeSavePanel(){
  document.getElementById('savePanel').classList.remove('open');
  if(_spUrl){ URL.revokeObjectURL(_spUrl); _spUrl=null; }
  if(_spQueue.length){
    const it=_spQueue.shift();
    setTimeout(()=>{
      openSavePanel(URL.createObjectURL(it.blob), it.blob, it.name);
      toast('저장 패널 '+(_spQueue.length+2>0?'다음 파일':'')+' ('+it.name+') — 저장 후 닫으면 이어서 열립니다','ok');
    }, 350);
  }
}
/* 여러 파일을 ZIP 없이 순차 저장: 프레임=패널 순서, 상단=지연 다운로드 */
function saveFilesSequential(items){
  if(!items || !items.length) return;
  if(isFramed()){
    _spQueue = items.slice(1);
    const it=items[0];
    openSavePanel(URL.createObjectURL(it.blob), it.blob, it.name);
    toast('파일 1/'+items.length+' — 저장 후 닫으면 다음이 열립니다','ok');
  }else{
    items.forEach((it,i)=> setTimeout(()=>saveFile(it.blob, it.name, true), i*400));
    toast(items.length+'개 파일을 내려받습니다','ok');
  }
}
function openSavePanel(url, blob, name){
  if(_spUrl && _spUrl!==url) URL.revokeObjectURL(_spUrl);
  _spUrl=url;
  const kind = name.endsWith('.dxf') ? 'dxf' : 'pdf';   // ZIP removed from export flow (R12)
  const body=document.getElementById('spBody');
  body.innerHTML='';
  const nm=document.createElement('div'); nm.className='sp-name'; nm.textContent=name;
  const sub=document.createElement('div'); sub.className='sp-sub';
  sub.textContent=Math.max(1,Math.round(blob.size/1024))+' KB · '+(kind==='dxf'?'DXF 컷 벡터':'PDF (100% 실제 크기)');
  body.appendChild(nm); body.appendChild(sub);
  const urlIn=document.createElement('input'); urlIn.className='sp-url'; urlIn.readOnly=true;
  urlIn.value=location.href;
  urlIn.onclick=()=>{ urlIn.select(); };
  body.appendChild(urlIn);
  setTimeout(()=>{ try{ urlIn.select(); }catch(e){} }, 80);
  { const f=document.createElement('iframe'); f.src=url; f.title='저장 미리보기';
    body.appendChild(f); }
  const hint=document.createElement('div'); hint.className='sp-hint';
  hint.innerHTML = kind==='pdf'
    ? '미리보기가 다운로드를 차단합니다. <b>① 「새 창으로 열기」</b> → 그 창에서 내보내기 <b>② 주소 복사 → 새 탭 붙여넣기</b> <b>③ 미리보기 툴바 💾 / 우클릭 저장</b> <b>④ 버튼을 폴더로 드래그</b>'
    : kind==='dxf'
    ? '<b>① 새 창으로 열기 ② 주소 복사→새 탭</b> ③ 우클릭 저장 ④ 드래그 · DXF는 「내용 복사」→메모장 붙여넣기→.dxf 저장도 됩니다'
    : '<b>① 새 창으로 열기 ② 주소 복사→새 탭</b> ③ 우클릭 저장 ④ 드래그 — 새 창/새 탭이면 내보내기가 바로 저장됩니다';
  body.appendChild(hint);
  const btns=document.createElement('div'); btns.className='sp-btns';
  const mk=(label,fn)=>{ const b=document.createElement('button'); b.className='btn small'; b.textContent=label;
    b.onclick=fn; btns.appendChild(b); return b; };
  mk('🆕 새 창으로 열기', ()=>{
    let w=null;
    try{ w=window.open(location.href, '_blank'); }catch(e){}
    if(!w){
      try{ const a=document.createElement('a'); a.href=location.href; a.target='_blank'; a.rel='noopener';
        document.body.appendChild(a); a.click(); a.remove(); }catch(e){}
      toast('팝업이 차단됐을 수 있어요 — 아래 주소를 복사해 새 탭에 붙여넣으세요','err');
    }else{
      toast('새 창에서 내보내기 → 그대로 저장됩니다','ok');
    }
  });
  const drag=document.createElement('a');
  drag.className='sp-drag'; drag.download=name; drag.href=url;
  drag.textContent='⬇️ 이 버튼을 폴더로 끌어서 저장';
  btns.appendChild(drag);
  mk('🔁 다시 다운로드 시도', ()=>{
    const a=document.createElement('a'); a.href=url; a.download=name;
    document.body.appendChild(a); a.click(); a.remove();
    toast('다시 시도함 — 여전히 안 되면 위 미리보기에서 저장하세요');
  });
  if(kind==='dxf'){
    mk('📋 내용 복사', async ()=>{
      try{ const t=await (await fetch(url)).text();
        await navigator.clipboard.writeText(t);
        toast('DXF 내용이 클립보드에 복사됨 — 메모장에 붙여넣기 후 .dxf로 저장','ok');
      }catch(e){ toast('복사 실패 — 위 미리보기에서 우클릭 저장하세요','err'); }
    });
  }
  mk('🔗 주소 복사 (새 탭용)', async ()=>{
    try{ await navigator.clipboard.writeText(location.href);
      toast('주소 복사됨 — 새 탭에 붙여넣고 내보내기 → 바로 저장됩니다','ok');
    }catch(e){ toast('주소창을 복사하세요 (아래 입력창 클릭 후 Ctrl+C)','err'); }
  });
  mk('닫기', closeSavePanel);
  body.appendChild(btns);
  document.getElementById('savePanel').classList.add('open');
}
function saveFile(blob, name, noTick){
  if(!noTick){ try{ adExportTick(); }catch(e){} }
  const url=URL.createObjectURL(blob);
  if(isFramed()){ openSavePanel(url, blob, name); return true; }   // framed: panel (downloads blocked)
  const aEl=document.createElement('a'); aEl.href=url; aEl.download=name;
  document.body.appendChild(aEl); aEl.click(); aEl.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 8000);
  return false;
}
async function buildPdfBlob(){
  try{
    const L=currentLayout();
    if(!L.fits) throw new Error('layout');
    const pg=L.page;
    const ops=[];
    const uT=Math.min(...L.copies.map(r=>r.y));
    const uB=Math.max(...L.copies.map(r=>r.y+r.h));
    const artCache=new Map();                      // design idx -> {artCv, bytes}
    for(let ci=0; ci<L.copies.length; ci++){       // one image op per placed copy
      const r = L.copies[ci];
      const di = designIdxFor(ci);
      let entry = artCache.get(di);
      if(!entry){
        const artCv = await composePageArt(L, di);
        const jpeg = await new Promise((res,rej)=>{
          artCv.toBlob(b=> b? res(b): rej(new Error('jpeg')), 'image/jpeg', 0.94);
        });
        const rast = await pdfArtRaster(artCv);
        entry = {artCv, bytes:new Uint8Array(await jpeg.arrayBuffer()), ...rast};
        artCache.set(di, entry);
      }
      ops.push({op:'image', bytes:entry.bytes, w:entry.artCv.width, h:entry.artCv.height,
        cmykZ:entry.cmykZ, alphaZ:entry.alphaZ,
        x:mm2pt(r.x), y:ptY(r.y+r.h), wPt:mm2pt(r.w), hPt:mm2pt(r.h)});
    }
    /* centered text helper (approx Helvetica width = 0.55em/char) */
    const ctext = (txt, size, topMm, gray)=>{
      const wEst = txt.length*size*0.55;
      ops.push({op:'text', x:Math.max(mm2pt(5), mm2pt(pg.w/2)-wEst/2), y:ptY(topMm),
        size, gray, text:txt});
    };
    if(state.mode==='cut'){
      const st=CUT_STYLES[state.cutStyle];
      const col={r:st.col[0], g:st.col[1], b:st.col[2]};
      // notched cut outline follows the real template shape — one path per copy
      for(const r of L.copies){
        const T = cutTransform(r);
        const pts = wrapSegs(state.wrap.w, state.wrap.h, state.notch).map(sg=>{
          const P=(i)=>{ const q=T(sg[i],sg[i+1]); return [mm2pt(q[0]), ptY(q[1])]; };
          if(sg[0]==='M'){ const q=P(1); return ['M',q[0],q[1]]; }
          if(sg[0]==='L'){ const q=P(1); return ['L',q[0],q[1]]; }
          const c1=P(1), c2=P(3), e=P(5);
          return ['C',c1[0],c1[1],c2[0],c2[1],e[0],e[1]];
        });
        ops.push({op:'path', pts, closed:true, stroke:{r:col.r, g:col.g, b:col.b, w:st.w}});
      }
      const t1='11oz MUG FULL WRAP   '+state.wrap.w+' x '+state.wrap.h+' mm'+(L.nCopies>1?'   -   '+L.nCopies+' UP':'')+'   -   CUT ALONG THE LINE';
      const t2='print at 100% scale (no fit-to-page)   -   '+ (state.mirror?'MIRRORED for sublimation':'not mirrored');
      const t3='11oz MUG WRAP TEMPLATE - '+pg.name+' - handle cutouts at both short edges';
      ctext(t1, 8, Math.max(4, uT-11.5), 0.42);
      ctext(t2, 6.5, Math.max(4, uT-6.5), 0.55);
      ctext(t3, 6.5, Math.min(pg.h-5, uB+5.5), 0.55);
    } else {
      for(const mk of L.marks) primToOps(mk, ops);   // extracted glyph images -> OCG sub-layer
      const nm = state.machine==='silhouette'?'SILHOUETTE TYPE 1 REGISTRATION MARKS (EXTRACTED)':'BROTHER SCANNCUT REGISTRATION MARKS (EXTRACTED)';
      const t1='11oz MUG WRAP  '+state.wrap.w+' x '+state.wrap.h+' mm'+(L.nCopies>1?'  -  '+L.nCopies+' UP':'')+'   -   '+nm;
      const t2='no cut lines printed - print at 100% scale on '+pg.name+(state.mirror?' - MIRRORED for sublimation':'');
      ctext(t1, 8, Math.min(pg.h-9, uB+7), 0.4);
      ctext(t2, 6.5, Math.min(pg.h-5.5, uB+12), 0.55);
    }
    const pdf = buildPdf(
      [{widthPt:mm2pt(pg.w), heightPt:mm2pt(pg.h), ops}],
      {title:'11oz Mug Wrap Template '+state.wrap.w+'x'+state.wrap.h+'mm'}
    );
    const tag = state.mode==='cut' ? 'cut' : (state.machine==='silhouette'?'silhouette':'brother');
    const name='11oz-mug-'+state.wrap.w+'x'+state.wrap.h+'mm-'+tag+
      (state.paper==='letter'?'-letter':'-a4')+
      (L.nCopies>1?'-x'+L.nCopies:'')+(state.mirror?'-mirror':'')+'.pdf';
    return {pdf, name};
  }catch(err){
    console.error(err);
    throw new Error(err.message==='layout' ? '템플릿이 페이지 영역에 맞지 않습니다 — 배치/크기를 조정하세요' : 'PDF 생성 실패: '+err.message);
  }
}

async function buildImposedPdf(machine, paperKey, opt){
  // S3b: preview and export share ONE computed result (same key => same bytes)
  const fresh = (_imp.result && !_imp.building && _imp.key===imposedKey()) ? _imp.result
              : await computeImposedPages(machine, paperKey, opt);
  const {pages:outPages, cellPages, artMode, orient, pg} = fresh;
  const pdf=buildPdf(outPages, {title:'11oz Mug Wrap Imposed '+drafts.length+' designs'});
  const name = artMode==='cut'
    ? '11oz-mug-imposed-'+drafts.length+'-cut-'+orient+'-'+paperKey+
      (cellPages.length>1?'-x'+cellPages.length+'p':'')+'.pdf'
    : '11oz-mug-imposed-'+drafts.length+'-'+machine+'-'+paperKey+
      (cellPages.length>1?'-x'+cellPages.length+'p':'')+'.pdf';
  // machine cut files matching the imposed cells (per page, 1:1 mm, y-down)
  const enc=new TextEncoder();
  const cutFiles=[];
  cellPages.forEach((cells,pi)=>{
    if(!cells.length) return;
    const copies=cells.map(c=>({x:c.x, y:c.y, w:c.wMm, h:c.hMm, or:c.or||'v'}));
    const wraps=cells.map(c=>c.wrap);
    const notches=cells.map(c=>c.notch);
    const base={copies, pageW:pg.w, pageH:pg.h,
                wrap:cells[0].wrap, notch:cells[0].notch, wraps, notches};
    const tag=(artMode==='cut' ? 'cut-'+orient : machine)+'-p'+(pi+1);
    cutFiles.push({name:'11oz-cut-'+tag+'.dxf', data:enc.encode(buildDxf(base))});
    cutFiles.push({name:'11oz-cut-'+tag+'.svg', data:enc.encode(buildSvg(base))});
    if(state.machine!=='silhouette'){                 // Brother native (.fcm) — open-fcm MIT
      try{ cutFiles.push({name:'11oz-cut-'+tag+'.fcm', data:buildFcm({...base, pageW:pg.w, pageH:pg.h, name:tag})}); }
      catch(e){ console.warn('fcm build failed', e); }
    }
  });
  return {pdf, name, cutFiles, pageCount:cellPages.length, pages:outPages};
}
/* ---- DXF: vector cut outlines for Silhouette Studio / Brother Canvas ---- */

function exportDxf(){
  try{
    const L=currentLayout();
    if(!L.fits) throw new Error('layout');
    const txt = buildDxf({copies:L.copies, pageW:L.page.w, pageH:L.page.h,
                          wrap:state.wrap, notch:state.notch});
    const blob=new Blob([txt], {type:'application/dxf'});
    const tag = state.machine==='silhouette'?'silhouette':'brother';
    const name='11oz-mug-'+state.wrap.w+'x'+state.wrap.h+'mm-'+tag+'-cut'+
      (state.paper==='letter'?'-letter':'-a4')+
      (L.nCopies>1?'-x'+L.nCopies:'')+'.dxf';
    const framed=saveFile(blob, name);
    toast(framed ? '저장 패널: '+name : '저장 완료: '+name,'ok');
  }catch(err){
    console.error(err);
    toast(err.message==='layout' ? '템플릿이 페이지 영역에 맞지 않습니다 — 배치/크기를 조정하세요' : 'DXF 생성 실패: '+err.message,'err');
  }
}
