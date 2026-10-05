/* =========================================================================
   editor-ops.js — image loading (button/drag/paste), layer operations,
   rotation & control sync, layer/design selectors, copies & mark hints,
   segment controls. Load: after editor-canvas.js.
   ========================================================================= */

/* ---------- image loading ---------- */
async function loadFile(file){
  if(!file || !file.type.startsWith('image/')){ toast('이미지 파일만 지원합니다','err'); return; }
  try{
    let bmp;
    if(window.createImageBitmap){
      bmp = await createImageBitmap(file, {imageOrientation:'from-image'});
    } else {
      bmp = await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=URL.createObjectURL(file); });
    }
    // downscale huge images to max 4000px
    const MAX=4000;
    if(bmp.width>MAX || bmp.height>MAX){
      const k=MAX/Math.max(bmp.width,bmp.height);
      const c=document.createElement('canvas');
      c.width=Math.round(bmp.width*k); c.height=Math.round(bmp.height*k);
      c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
      if(bmp.close) bmp.close();
      bmp = await createImageBitmap(c);
    }
    const aspect = bmp.height/bmp.width;
    // default: CONTAIN — the WHOLE image must be visible on the mug (cover would
    // slice tall/wide images into unrecognisable bands; F = 면에 채우기 stays cover)
    const containW = Math.min(state.wrap.w, state.wrap.h/aspect);
    const dsg = activeDesign();
    const lyr = {id:uid(), name:'레이어 '+(dsg.layers.length+1), bmp, visible:true,
                 cx:state.wrap.w/2, cy:state.wrap.h/2, w:containW, rot:0, _userW:containW};
    dsg.layers.push(lyr);
    state.activeLayer = dsg.layers.length-1;
    state.sel=[state.activeLayer];
    cropOff();
    syncActive(); renderDesignSel(); renderLayers();
    syncControls(); scheduleDraws();
    toast('레이어가 추가되었습니다 — 드래그로 위치를 잡아보세요','ok');
  }catch(err){ console.error(err); toast('이미지를 불러오지 못했습니다','err'); }
}
$('#fileBtn').addEventListener('click', ()=>$('#fileIn').click());
$('#fileIn').addEventListener('change', e=>{ if(e.target.files[0]) loadFile(e.target.files[0]); e.target.value=''; });
const wrapEl = $('#editorWrap');
['dragenter','dragover'].forEach(ev=>wrapEl.addEventListener(ev, e=>{ e.preventDefault(); wrapEl.classList.add('dragover'); }));
['dragleave','drop'].forEach(ev=>wrapEl.addEventListener(ev, e=>{ e.preventDefault(); if(ev==='dragleave') wrapEl.classList.remove('dragover'); }));
wrapEl.addEventListener('drop', e=>{ wrapEl.classList.remove('dragover'); if(e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
window.addEventListener('dragover', e=>e.preventDefault());
window.addEventListener('drop', e=>e.preventDefault());
window.addEventListener('paste', e=>{
  const items=e.clipboardData&&e.clipboardData.items; if(!items) return;
  for(const it of items){ if(it.type.startsWith('image/')){ loadFile(it.getAsFile()); break; } }
});

$('#fitBtn').addEventListener('click', ()=>{
  if(!state.img) return toast('먼저 이미지를 업로드하세요');
  const rot = Math.abs(state.img.rot%180)>45;
  const W = rot? state.wrap.h : state.wrap.w, H = rot? state.wrap.w : state.wrap.h;
  const aspect = state.img.bmp.height/state.img.bmp.width;
  state.img.w = Math.max(W, H/aspect);
  state.img.cx=state.wrap.w/2; state.img.cy=state.wrap.h/2;
  markW(); syncControls(); scheduleDraws();
});
$('#centerBtn').addEventListener('click', ()=>{
  if(!state.img) return toast('먼저 이미지를 업로드하세요');
  state.img.cx=state.wrap.w/2; state.img.cy=state.wrap.h/2;
  scheduleDraws();
});
function delLayer(i){
  const dsg=activeDesign();
  if(!dsg.layers[i]) return;
  dsg.layers.splice(i,1);
  state.activeLayer = Math.max(0, Math.min(state.activeLayer, dsg.layers.length-1));
  state.sel = state.sel.filter(x=>x!==i).map(x=>x>i?x-1:x);
  cropOff();
  syncActive(); renderLayers(); syncControls(); scheduleDraws();
}
$('#rmBtn').addEventListener('click', ()=>{ if(state.img) delLayer(state.activeLayer); });
$('#bgColor').addEventListener('input', e=>{ state.bg=e.target.value; scheduleDraws(); });

/* ---- rotation: an image that covered the template must KEEP covering it ----
   (rot90 previously left long white gaps beside stretched notch marks).
   The user's own size (_userW) is restored as soon as it covers again. */
function markW(){ if(state.img) state.img._userW = state.img.w; }
function setRot(n){
  const im=state.img; if(!im) return;
  const W=state.wrap.w, H=state.wrap.h;
  const aspect=im.bmp.height/im.bmp.width;
  const fp=(r, w)=>{const a=r*Math.PI/180, ca=Math.abs(Math.cos(a)), sa=Math.abs(Math.sin(a));
    return {bw:w*ca + w*aspect*sa, bh:w*sa + w*aspect*ca};};
  const p=fp(im.rot, im.w);
  const covered = p.bw>=W-1 && p.bh>=H-1 &&
    im.cx-p.bw/2<=1 && im.cx+p.bw/2>=W-1 &&
    im.cy-p.bh/2<=1 && im.cy+p.bh/2>=H-1;   // fully covered BEFORE rotating?
  im.rot=n;
  if(!covered){ syncControls(); scheduleDraws(); return; }   // small/decorative image: leave alone
  const a=n*Math.PI/180, ca=Math.abs(Math.cos(a)), sa=Math.abs(Math.sin(a));
  const wNeed=Math.max(W/(ca+aspect*sa), H/(sa+aspect*ca));
  const uw = (im._userW!=null ? im._userW : im.w);
  const ufp = fp(n, uw);
  const target = (ufp.bw>=W-1 && ufp.bh>=H-1) ? uw : Math.ceil(wNeed*10)/10;
  if(Math.abs(target-im.w) > 0.5){
    im.w = Math.min(target, 4000);
    im._refitTouched = true;
    const q=fp(n, im.w);                       // keep the new footprint over the template
    im.cx = Math.min(Math.max(im.cx, W - q.bw/2), q.bw/2);
    im.cy = Math.min(Math.max(im.cy, H - q.bh/2), q.bh/2);
  }
  syncControls(); scheduleDraws();
}
function rotToastChange(){
  if(state.img && state.img._refitTouched){
    delete state.img._refitTouched;
    toast('회전 후에도 템플릿을 덮도록 크기를 자동 보정했습니다','ok');
  }
}
function checkSliceHint(){
  const im=state.img; if(!im) return;
  const asp=im.bmp.height/im.bmp.width;
  const wide=im.w > state.wrap.w*1.35, tall=(im.w*asp) > state.wrap.h*1.35;
  if(wide||tall){
    if(!im._sliceHint){ im._sliceHint=true;
      toast('이미지가 템플릿보다 커서 일부만 전사됩니다 — 슬라이더/휠로 종이 안에 맞추세요','err'); }
  } else { im._sliceHint=false; }
}
function syncControls(){
  checkSliceHint();
  const im=state.img;
  $('#scaleR').value = im? Math.round(Math.min(400, im.w/state.wrap.w*100)) : 100;
  $('#scaleV').textContent = im? (im.w/state.wrap.w*100).toFixed(0)+'%' : '–';
  $('#rotR').value = im? Math.round(im.rot) : 0;
  $('#rotV').textContent = im? Math.round(im.rot)+'°' : '0°';
  const setIf=(id,v)=>{ const el=$(id); if(document.activeElement!==el) el.value=v; };
  setIf('#cxIn', im? (Math.round(im.cx*10)/10) : '');
  setIf('#cyIn', im? (Math.round(im.cy*10)/10) : '');
  setIf('#wIn',  im? (Math.round(im.w*10)/10) : '');
  setIf('#rotIn', im? Math.round(im.rot) : '');
}
/* control-bar numeric fields (Illustrator-style X/Y/W/°) */
$('#cxIn').addEventListener('input', e=>{
  const v=+e.target.value;
  if(!state.img || e.target.value==='' || !Number.isFinite(v)) return;
  state.img.cx = v; scheduleDraws();
});
$('#cyIn').addEventListener('input', e=>{
  const v=+e.target.value;
  if(!state.img || e.target.value==='' || !Number.isFinite(v)) return;
  state.img.cy = v; scheduleDraws();
});
$('#wIn').addEventListener('input', e=>{
  const v=+e.target.value;
  if(!state.img || e.target.value==='' || !Number.isFinite(v)) return;
  state.img.w = Math.min(600, Math.max(5, v));
  markW(); syncControls(); scheduleDraws();
});
$('#rotIn').addEventListener('input', e=>{
  const v=+e.target.value;
  if(!state.img || e.target.value==='' || !Number.isFinite(v)) return;
  setRot(Math.min(180, Math.max(-180, v)));
});
$('#rotIn').addEventListener('change', rotToastChange);
$('#scaleR').addEventListener('input', e=>{
  if(!state.img) return;
  state.img.w = state.wrap.w * (+e.target.value)/100;
  markW(); syncControls(); scheduleDraws();
});
$('#rotR').addEventListener('input', e=>{
  if(!state.img) return;
  setRot(+e.target.value);
});
$('#rotR').addEventListener('change', rotToastChange);

/* ---------- designs (sheets) & layers ---------- */
function renderDesignSel(){ try{ adCheckDesigns(); }catch(e){}
  const sel=$('#designSel');
  sel.innerHTML = state.designs.map((d,i)=>
    `<option value="${i}" ${i===state.activeDesign?'selected':''}>${esc(d.name)} · ${d.layers.length}레이어</option>`
  ).join('');
}
function switchDesign(i){
  if(i===state.activeDesign || !state.designs[i]) return;
  state.activeDesign=i;
  const dsg=activeDesign();
  state.activeLayer = Math.max(0, Math.min(state.activeLayer, dsg.layers.length-1));
  state.sel=[state.activeLayer];
  cropOff();
  syncActive(); renderDesignSel(); renderLayers(); syncControls(); scheduleDraws();
  notifyState();
}
$('#designSel').addEventListener('change', e=>switchDesign(+e.target.value));
$('#dsgAdd').addEventListener('click', ()=>{
  const id=uid(), name='디자인 '+(++_dsgSeq);
  state.designs.push({id, name, layers:[], ver:0});
  switchDesign(state.designs.length-1);
  renderDesignSel();
  toast('새 디자인을 추가했습니다 — 이미지를 업로드하세요','ok');
});
$('#dsgDup').addEventListener('click', ()=>{
  const src=activeDesign(), id=uid(), name='디자인 '+(++_dsgSeq);
  state.designs.push({id, name, ver:0,
    layers: src.layers.map(l=>({...l, id:uid()}))});
  switchDesign(state.designs.length-1);
  renderDesignSel();
  toast('디자인을 복제했습니다 — 배치에서 두 디자인을 번갈아 쓸 수 있어요','ok');
});
$('#dsgDel').addEventListener('click', ()=>{
  if(state.designs.length<=1) return toast('마지막 디자인은 삭제할 수 없습니다','err');
  const i=state.activeDesign;
  state.designs.splice(i,1);
  clearDesignCache();                       // indexes shifted
  state.copyDesign = state.copyDesign.map(c=> c>=state.designs.length ? 0 : c);
  state.activeDesign = Math.min(i, state.designs.length-1);
  const dsg=activeDesign();
  state.activeLayer = Math.max(0, Math.min(state.activeLayer, dsg.layers.length-1));
  syncActive(); renderDesignSel(); renderLayers(); syncControls(); scheduleDraws();
  toast('디자인을 삭제했습니다','ok');
});
function renderLayers(){
  const dsg=activeDesign(), ul=$('#layerList');
  $('#lyrCount').textContent = dsg.layers.length ? dsg.layers.length+'개' : '—';
  if(!dsg.layers.length){
    ul.innerHTML = '<li style="cursor:default; color:var(--sub)">이미지를 업로드하면 여기에 레이어가 생깁니다</li>';
    return;
  }
  let html='';
  for(let vi=dsg.layers.length-1; vi>=0; vi--){     // top of stack listed first
    const l=dsg.layers[vi];
    html += `<li data-i="${vi}" class="${vi===state.activeLayer?'on':''}${state.sel.includes(vi)?' sel':''}${l.visible?'':' hidden-layer'}">
      <button class="lbtn eye" data-act="eye" title="보이기/숨기기">${l.visible?'👁':'🚫'}</button>
      <span class="lyr-name">${esc(l.name)}</span>
      <button class="lbtn" data-act="up" title="위로 (위에 표시)" ${vi===dsg.layers.length-1?'disabled':''}>▲</button>
      <button class="lbtn" data-act="down" title="아래로 (아래에 표시)" ${vi===0?'disabled':''}>▼</button>
      <button class="lbtn" data-act="del" title="레이어 삭제">✕</button>
    </li>`;
  }
  ul.innerHTML = html;
}
$('#layerList').addEventListener('click', e=>{
  const li=e.target.closest('li'); if(!li || li.dataset.i===undefined) return;
  const i=+li.dataset.i, dsg=activeDesign();
  const btn=e.target.closest('.lbtn');
  if(btn){
    const act=btn.dataset.act;
    if(act==='eye'){ dsg.layers[i].visible=!dsg.layers[i].visible; renderLayers(); scheduleDraws(); return; }
    if(act==='del'){ delLayer(i); return; }
    const j = act==='up' ? i+1 : act==='down' ? i-1 : -1;
    if(j>=0 && j<dsg.layers.length && j!==i){
      const t=dsg.layers[i]; dsg.layers[i]=dsg.layers[j]; dsg.layers[j]=t;
      if(state.activeLayer===i) state.activeLayer=j;
      else if(state.activeLayer===j) state.activeLayer=i;
      if(state.sel.includes(i) || state.sel.includes(j)){
        state.sel = state.sel.map(x=> x===i?j : x===j?i : x);
      }
      syncActive(); renderLayers(); scheduleDraws();
    }
    return;
  }
  const multi = e.shiftKey || e.ctrlKey || e.metaKey;
  if(multi){
    const at=state.sel.indexOf(i);
    if(at>=0) state.sel.splice(at,1); else state.sel.push(i);
    state.activeLayer=i;
  } else {
    state.activeLayer=i; state.sel=[i];
  }
  syncActive(); renderLayers(); syncControls();
});
/* alignment: single layer -> template; multiple selected -> group bbox */
$('#alignSeg').addEventListener('click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  const dsg=activeDesign();
  const tg = (state.sel.length>1 ? state.sel.slice() : [state.activeLayer]).filter(i=>dsg.layers[i]);
  if(!tg.length) return toast('먼저 이미지를 업로드하세요');
  const k=b.dataset.a;
  const boxOf = im=>{
    const aspect=im.bmp.height/im.bmp.width;
    const a=im.rot*Math.PI/180, ca=Math.abs(Math.cos(a)), sa=Math.abs(Math.sin(a));
    return {bw: im.w*ca + im.w*aspect*sa, bh: im.w*sa + im.w*aspect*ca};
  };
  if(tg.length===1){
    const im=dsg.layers[tg[0]], {bw,bh}=boxOf(im);
    const W=state.wrap.w, H=state.wrap.h;
    if(k==='l') im.cx=bw/2;
    else if(k==='hc') im.cx=W/2;
    else if(k==='r') im.cx=W-bw/2;
    else if(k==='t') im.cy=bh/2;
    else if(k==='vc') im.cy=H/2;
    else if(k==='b') im.cy=H-bh/2;
  } else {
    let L=Infinity, R=-Infinity, T=Infinity, B=-Infinity;
    for(const i of tg){ const im=dsg.layers[i], {bw,bh}=boxOf(im);
      L=Math.min(L, im.cx-bw/2); R=Math.max(R, im.cx+bw/2);
      T=Math.min(T, im.cy-bh/2); B=Math.max(B, im.cy+bh/2); }
    for(const i of tg){ const im=dsg.layers[i], {bw,bh}=boxOf(im);
      if(k==='l') im.cx = L + bw/2;
      else if(k==='hc') im.cx = (L+R)/2;
      else if(k==='r') im.cx = R - bw/2;
      else if(k==='t') im.cy = T + bh/2;
      else if(k==='vc') im.cy = (T+B)/2;
      else if(k==='b') im.cy = B - bh/2;
    }
    toast('그룹 '+tg.length+'개 정렬','ok');
  }
  scheduleDraws();
});
function designIdxFor(ci, env){
  const E = env || state;
  const di = E.copyDesign[ci];
  if(di==null || di<0 || di>=E.designs.length) return 0;
  return di;
}
/* S3a: render env for a saved draft — no global state touched */
function draftEnv(d){
  const designs = d.designs;
  return { bg:d.bg, designs, notch:d.notch, wrap:d.wrap, mirror:d.mirror,
           copyDesign:(d.copyDesign && d.copyDesign.length ? d.copyDesign : [0]),
           activeDesign: Math.max(0, Math.min(d.activeDesign||0, designs.length-1)) };
}
let _cdSig='';
function renderCopyDesigns(){
  const row=$('#copyDesignRow');
  const show = state.copies>1 && state.designs.length>1;
  row.style.display = show ? '' : 'none';
  if(!show) return;
  const sig = state.copies+'|'+state.designs.length+'|'+state.copyDesign.join(',');
  if(sig===_cdSig) return;
  _cdSig = sig;
  $('#copyDesignSel').innerHTML = state.copyDesign.map((di,i)=>
    `<span class="inline"><span class="kv">배치${i+1}</span><select class="cdsel" data-i="${i}">`+
    state.designs.map((dd,j)=>`<option value="${j}" ${j===di?'selected':''}>${esc(dd.name)}</option>`).join('')+
    `</select></span>`).join('');
}
$('#copyDesignSel').addEventListener('change', e=>{
  const sel=e.target.closest('select'); if(!sel) return;
  state.copyDesign[+sel.dataset.i]=+sel.value;
  drawPagePrev();
});

/* ---------- size presets ---------- */
$('#presetSel').addEventListener('change', e=>{
  const v=e.target.value;
  if(v==='custom'){ $('#customSizeRow').style.display='flex'; return; }
  $('#customSizeRow').style.display='none';
  const [w,h]=v.split('x').map(Number);
  setWrap(w,h);
});
$('#applySize').addEventListener('click', ()=>{
  const w=parseFloat($('#cwIn').value), h=parseFloat($('#chIn').value);
  if(!(w>=60&&w<=260&&h>=40&&h<=120)) return toast('크기 범위: 가로 60~260, 세로 40~120 mm','err');
  setWrap(w,h);
});
function setWrap(w,h){
  state.wrap={w,h};
  layoutEditor(); rebuildTexture(); drawPagePrev(); updateMarkHint();
}

/* ---------- output mode controls ---------- */
function segBind(sel, cb){
  const root=$(sel);
  root.addEventListener('click', e=>{
    const b=e.target.closest('button'); if(!b||b.disabled) return;
    root.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); cb(b.dataset.v);
  });
}
function setSegActive(sel, v){
  const root=$(sel);
  root.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.v===v));
}
segBind('#modeSeg', v=>{
  state.mode=v;
  state.paper = 'a4';   // A4 only — online Silhouette/ScanNCut mark templates are A4
  // mark modes print VERTICAL only (세로) — hide auto/horizontal choices
  if(v==='mark'){
    if(state.orient!=='v'){ state._orientBefore=state.orient; state.orient='v'; }
    setSegActive('#orientSeg','v');
  }else if(state._orientBefore){
    state.orient=state._orientBefore; state._orientBefore=null;
    setSegActive('#orientSeg', state.orient);
  }
  $('#orientSeg').querySelectorAll('button').forEach(b=>{
    b.disabled = (v==='mark' && b.dataset.v!=='v');
  });
  $('#cutOpts').style.display = v==='cut'?'':'none';
  $('#markOpts').style.display = v==='mark'?'':'none';
  updateMarkHint(); drawPagePrev(); updateExportUI();
});
$('#notchChk').addEventListener('change', e=>{ state.notch=e.target.checked; scheduleDraws(); if(state.exportScope==='list') requestImposedPrev(); });
segBind('#cutSeg', v=>{
  state.cutStyle=v;
  $('#cutSpec').textContent = CUT_STYLES[v].spec;
  drawPagePrev();
});
segBind('#markSeg', v=>{ state.machine=v; updateMarkHint(); drawPagePrev(); updateExportUI(); });
segBind('#orientSeg', v=>{ state.orient=v; drawPagePrev(); updateExportUI(); });
$('#copiesSel').addEventListener('change', e=>{
  state.copies = parseInt(e.target.value,10)||1;
  state._wantCopies = state.copies;
  drawPagePrev(); updateExportUI();
});
/* clamp the copies select to what the current orientation allows (가로≤3 · 세로≤2),
   then auto-fallback to fewer copies when the layout physically cannot fit */
function syncCopies(){
  const maxN = (currentLayout().art.or==='h') ? 3 : 2;
  const want = state.copies;
  if(state.copies > maxN) state.copies = maxN;
  const lc = ()=>computeLayout({wrap:state.wrap, mode:state.mode, machine:state.machine,
                                orient:state.orient, paper:state.paper, copies:state.copies});
  while(state.copies > 1 && !lc().fits) state.copies--;
  if(want > state.copies){
    toast(want+'개 배치가 현재 조건에서 불가 → '+state.copies+'개로 자동 조정 ('+
      (state.mode==='mark' ? '인식 마크 영역 회피 필요' : '페이지 범위 확인')+')', 'err');
    state._wantCopies = state.copies;
  }
  if(state._wantCopies && state._wantCopies > state.copies) state._wantCopies = state.copies;
  $('#copiesSel').value = String(state.copies);
  for(const opt of $('#copiesSel').options) opt.disabled = (+opt.value > maxN);
  while(state.copyDesign.length < state.copies) state.copyDesign.push(0);
  state.copyDesign.length = state.copies;
  renderCopyDesigns();
}
$('#mirrorChk').addEventListener('change', e=>{ state.mirror=e.target.checked; drawPagePrev(); });

function updateMarkHint(){
  const el=$('#markHint');
  if(state.mode!=='mark'){ el.textContent=''; return; }
  if(state.machine==='silhouette'){
    el.innerHTML='배치는 <b>세로만</b> (병렬 최대 2개) · 컷 외곽은 <b>DXF 내보내기</b>로 받으세요.<br>실루엣 <b>Type 1</b> 등록 마크만 인쇄합니다 — 공식 Silhouette Connect 매뉴얼의 도면에서 <b>추출한 마크 이미지</b>를 별도 레이어(OCG)로 배치했습니다 (임의 그리기 아님). 절취선은 인쇄되지 않습니다. 인셋 15.875mm · 길이 20mm, 용지 <b>A4</b> (인터넷의 A4 프린트컷 템플릿과 동일).';
  } else {
    el.innerHTML='배치는 <b>세로만</b> (병렬 최대 2개) · 컷 외곽은 <b>DXF 내보내기</b>로 받으세요.<br>브라더 <b>ScanNCut DX Print to Cut</b>용 네 모서리 인식 마크만 인쇄합니다 — 공식 Brother 매뉴얼 다이어그램에서 <b>추출한 타깃 마크 이미지</b>를 별도 레이어(OCG)로 배치했습니다. 용지 <b>A4</b> 아트보드 기준 (공식 매뉴얼 예시 = A4).';
  }
}

/* ---------- current layout ---------- */
function currentLayout(){
  return computeLayout({wrap:state.wrap, mode:state.mode, machine:state.machine,
                        orient:state.orient, paper:state.paper, copies:state.copies});
}
