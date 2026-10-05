/* ---------- A4 page preview ---------- */
const pv=$('#pagePrev'), pctx=pv.getContext('2d');
function wrapSegsToCtx(ctx, segs, T, s){
  // T: wrap-mm -> page-mm ; s: mm -> px
  const P=(x,y)=>{ const q=T(x,y); return [q[0]*s, q[1]*s]; };
  for(const sg of segs){
    if(sg[0]==='M'){ const q=P(sg[1],sg[2]); ctx.moveTo(q[0],q[1]); }
    else if(sg[0]==='L'){ const q=P(sg[1],sg[2]); ctx.lineTo(q[0],q[1]); }
    else { const a=P(sg[1],sg[2]), b=P(sg[3],sg[4]), c=P(sg[5],sg[6]);
           ctx.bezierCurveTo(a[0],a[1],b[0],b[1],c[0],c[1]); }
  }
}
function cutTransform(a){
  return segTransform(a.x, a.y, a.h, a.or);   // rotated 90° (never stretched) — shared core
}
function drawPagePrev(){
  if(state.exportScope==='list' && drafts.length){
    if(_imp.key===imposedKey()){ if(_imp.pages) renderImposedPrev(); }
    else requestImposedPrev();
    return;
  }
  syncCopies();
  const L=currentLayout();
  const pg=L.page;
  const W=pv.width, H=pv.height, m=6;
  const s=(W-2*m)/pg.w;
  pctx.fillStyle='#3a4152'; pctx.fillRect(0,0,W,H);
  pctx.save();
  pctx.translate(m,m);
  pctx.fillStyle='#fff';
  pctx.fillRect(0,0,pg.w*s,pg.h*s);
  const rects = L.copies;
  // union of all copies (labels / caption anchor)
  const uL=Math.min(...rects.map(r=>r.x)), uR=Math.max(...rects.map(r=>r.x+r.w));
  const uT=Math.min(...rects.map(r=>r.y)), uB=Math.max(...rects.map(r=>r.y+r.h));
  // ---- artwork: each copy (own design possible), vertical = true 90° rotation ----
  rects.forEach((r, ci)=>{
    const src = designCanvas(designIdxFor(ci));
    const ax=r.x*s, ay=r.y*s, aw=r.w*s, ah=r.h*s;
    pctx.save();
    pctx.beginPath(); pctx.rect(ax,ay,aw,ah); pctx.clip();
    pctx.fillStyle='#fff'; pctx.fillRect(ax,ay,aw,ah);
    const flipped = state.mirror;
    if(r.or==='v'){
      pctx.translate(ax, ay+ah); pctx.rotate(-Math.PI/2);
      if(flipped){ pctx.translate(ah,0); pctx.scale(-1,1); }
      pctx.drawImage(src, 0,0, ah, aw);
    } else {
      pctx.translate(ax + (flipped?aw:0), ay);
      if(flipped) pctx.scale(-1,1);
      pctx.drawImage(src, 0,0, aw, ah);
    }
    pctx.restore();
  });
  pctx.fillStyle='rgba(90,96,110,0.9)'; pctx.font=`${6.2}px system-ui`; pctx.textAlign='center';
  if(state.mode==='cut'){
    // cut line follows the notched template outline — one path per copy
    const st=CUT_STYLES[state.cutStyle];
    pctx.strokeStyle='rgb('+st.col.map(v=>Math.round(v*255)).join(',')+')';
    pctx.lineWidth=Math.max(1, st.w*s*0.55);
    for(const r of rects){
      pctx.beginPath();
      wrapSegsToCtx(pctx, wrapSegs(state.wrap.w, state.wrap.h, state.notch), cutTransform(r), s);
      pctx.closePath(); pctx.stroke();
    }
    pctx.fillText(state.wrap.w+' × '+state.wrap.h+' mm · CUT ALONG LINE'
      + (L.nCopies>1 ? '  ×'+L.nCopies : ''), ((uL+uR)/2)*s, uT*s-3);
  } else {
    // registration marks drawn from the EXTRACTED glyph bitmaps
    for(const mk of (L.marks||[])){
      if(mk.t!=='img') continue;
      const gi = MARK_IMGS[mk.key];
      if(gi && gi.complete && gi.naturalWidth){
        pctx.drawImage(gi, mk.x*s, mk.y*s, mk.w*s, mk.h*s);
      } else {
        pctx.fillStyle='#000'; pctx.fillRect(mk.x*s, mk.y*s, mk.w*s, mk.h*s);
      }
    }
    pctx.fillStyle='rgba(90,96,110,0.9)';
    const nm = state.machine==='silhouette'?'SILHOUETTE REG. MARKS':'BROTHER REG. MARKS';
    pctx.fillText(state.wrap.w+' × '+state.wrap.h+' mm · '+nm
      + (L.nCopies>1 ? '  ×'+L.nCopies : ''), ((uL+uR)/2)*s, uB*s+9);
  }
  // when copies use DIFFERENT designs, tag each copy with its design name
  if(state.designs.length>1 && !rects.every((_,i)=>designIdxFor(i)===designIdxFor(0))){
    pctx.save();
    pctx.textAlign='left'; pctx.textBaseline='alphabetic';
    pctx.font=`${6.2}px system-ui`;
    pctx.fillStyle='rgba(60,66,80,0.95)';
    pctx.shadowColor='rgba(255,255,255,0.9)'; pctx.shadowBlur=2;
    rects.forEach((r,ci)=>{
      pctx.fillText(state.designs[designIdxFor(ci)].name, r.x*s+2, r.y*s+8);
    });
    pctx.restore();
  }
  pctx.restore();
  // caption
  $('#prevCap').textContent = pg.name+' · '+(L.art.or==='v'?'세로':'가로')+' 배치 · '+L.nCopies+'개 · '+
    (state.mode==='cut'?'재단선 인쇄':(state.machine==='silhouette'?'실루엣':'스캔앤컷')+' 마크만 인쇄')+
    (state.mirror?' · 미러':'');
}
function updateExportUI(){
  syncCopies();
  const L=currentLayout();
  const ok=L.fits;
  const listScope = state.exportScope==='list' && drafts.length;
  $('#sumContent').textContent =
    (state.mode==='cut' ? '재단선 포함'
      : (state.machine==='silhouette' ? '실루엣' : '브라더')+' 마크만')
    + ' · A4'
    + (state.mode==='cut' ? ' · '+CUT_STYLES[state.cutStyle].label : '');
  $('#sumLayout').textContent =
    (L.art.or==='v' ? '세로' : '가로') + ' 배치 · ' + L.nCopies + '개'
    + (state.mirror ? ' · 미러' : '');
  $('#exportBtn').disabled = listScope ? (!drafts.length || _imp.building) : !ok;
  $('#dxfBtn').style.display = (listScope || state.mode!=='mark') ? 'none' : '';
  $('#dxfBtn').disabled=!ok;
  if(listScope){
    const total = drafts.reduce((s,d)=>s+Math.max(1,Math.min(99,d.n||1)),0);
    $('#fitInfo').textContent = 'A4 합본 · '+drafts.length+'개 작업 × '+total+'매 · 최소 용지로 재배치 · 미리보기에서 쪽 확인 ✓';
    $('#fitInfo').style.color='var(--ok)';
    $('#sumLayout').textContent = '합본 방향 · '+(currentLayout().art.or==='v'?'세로':'가로')+' 전용(각 작업 배치 개수는 목록에서)';
  } else {
    $('#fitInfo').textContent = ok
      ? L.page.name+' '+ (L.art.or==='v'?'세로':'가로') +' 배치 · '+L.nCopies+'개  ·  여백 확인 ✓'
      : (state.mode==='mark' ? '⚠ 인식 마크 영역 확인 — 개수·크기를 줄여주세요'
                             : '⚠ 페이지 범위 초과 — 개수·크기를 줄여주세요');
    $('#fitInfo').style.color = ok? 'var(--ok)':'var(--err)';
  }
  const mini=$('#pdMini');
  if(mini) mini.textContent = $('#sumContent').textContent + ' · ' + $('#sumLayout').textContent;
}

/* =========================================================================
   Export scope (현재 디자인 / 목록 전체) + imposed preview
   ========================================================================= */
function imposedKey(){
  return [drafts.length, drafts.map(d=>Math.max(1,Math.min(99,d.n||1))).join('.'),
          state.mode, state.orient, state.machine, state.notch?1:0].join('|');
}
function syncScopeUI(){
  const hasList = drafts.length>0;
  const listBtn = document.querySelector('#scopeSeg button[data-v=\"list\"]');
  if(listBtn) listBtn.disabled = !hasList;
  if(!hasList && state.exportScope==='list'){ state.exportScope='single'; setSegActive('#scopeSeg','single'); }
  const list = state.exportScope==='list' && hasList;
  // list scope: keep 방향(orientSeg) — hide per-page copies/mirror only
  const copiesRow = document.getElementById('copiesRow');
  if(copiesRow) copiesRow.style.display = list ? 'none' : '';
  const cdRow = document.getElementById('copyDesignRow');
  if(cdRow) cdRow.style.display = list ? 'none' : '';
  const cutRow = document.getElementById('bmCutRow');
  if(cutRow) cutRow.style.display = list ? '' : 'none';
  const sh = document.getElementById('scopeHint');
  if(sh) sh.textContent = list
    ? '임시 저장 '+drafts.length+'건을 A4 최소 용지로 합본 (쪽수는 미리보기)'
    : '한 장 내보내기 (배치·미러 적용)';
  const eb = document.getElementById('exportBtn');
  if(eb) eb.textContent = list ? '합본 PDF 내보내기' : 'PDF 내보내기';
  const nv = document.getElementById('prevNav');
  if(nv) nv.style.display = list ? '' : 'none';
  if(list) requestImposedPrev(); else { _imp.pages=null; _imp.result=null; _imp.key=null; drawPagePrev(); }
  updateExportUI();
}
segBind('#scopeSeg', v=>{ state.exportScope=v; syncScopeUI(); });
function renderImposedPrev(){
  if(!_imp.pages || !_imp.pages.length) return;
  _imp.p=Math.max(0, Math.min(_imp.p, _imp.pages.length-1));
  const info=document.getElementById('prevPgInfo');
  if(info) info.textContent=(_imp.p+1)+' / '+_imp.pages.length;
  const pc=document.getElementById('prevCap');
  if(pc) pc.textContent='합본 미리보기 · '+_imp.pages.length+'쪽 · '+
    (state.mode==='cut' ? '절취선 인쇄' :
      ((state.machine==='silhouette'?'실루엣':'브라더')+' 등록 마크 인쇄'))+
    (state.mode==='mark'?' · 세로 전용':'');
  drawOpsPage(pv, pctx, _imp.pages[_imp.p]);
}
document.getElementById('prevPgPrev').addEventListener('click', ()=>{ _imp.p--; renderImposedPrev(); });
document.getElementById('prevPgNext').addEventListener('click', ()=>{ _imp.p++; renderImposedPrev(); });
/* draw computed PDF ops (pt, y-up) onto the preview canvas */
async function drawOpsPage(cv, cx2, page){
  if(!cv || !page) return;
  const W=cv.width, H=cv.height, s=W/page.widthPt;
  cx2.setTransform(1,0,0,1,0,0);
  cx2.fillStyle='#3a4152'; cx2.fillRect(0,0,W,H);
  cx2.fillStyle='#fff'; cx2.fillRect(0,0,page.widthPt*s, page.heightPt*s);
  for(const op of page.ops){
    if(op.op==='image'){
      try{
        if(!op._bmp) op._bmp = await createImageBitmap(new Blob([op.bytes],{type:'image/jpeg'}));
        cx2.drawImage(op._bmp, op.x*s, H-(op.y+op.hPt)*s, op.wPt*s, op.hPt*s);
      }catch(e){ /* skip broken image */ }
    } else if(op.op==='path'){
      const P=(x,y)=>[x*s, H-y*s];
      cx2.beginPath();
      for(const sg of op.pts){
        if(sg[0]==='M'){ const q=P(sg[1],sg[2]); cx2.moveTo(q[0],q[1]); }
        else if(sg[0]==='L'){ const q=P(sg[1],sg[2]); cx2.lineTo(q[0],q[1]); }
        else { const p1=P(sg[1],sg[2]), p2=P(sg[3],sg[4]), p3=P(sg[5],sg[6]);
               cx2.bezierCurveTo(p1[0],p1[1],p2[0],p2[1],p3[0],p3[1]); }
      }
      if(op.closed) cx2.closePath();
      const st=op.stroke||{r:0,g:0,b:0,w:1};
      cx2.strokeStyle='rgb('+[st.r,st.g,st.b].map(v=>Math.round(v*255)).join(',')+')';
      cx2.lineWidth=Math.max(0.5, st.w*s);
      cx2.lineJoin='round';
      cx2.stroke();
    } else if(op.op==='text'){
      const g=(op.gray!=null?op.gray:0), v=Math.round(g*255);
      cx2.fillStyle='rgb('+v+','+v+','+v+')';
      cx2.font=(op.size*s).toFixed(1)+'px system-ui, sans-serif';
      cx2.textAlign='left'; cx2.textBaseline='alphabetic';
      cx2.fillText(op.text, op.x*s, H-op.y*s);
    }
  }
}
