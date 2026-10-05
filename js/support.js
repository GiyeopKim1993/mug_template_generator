/* =========================================================================
   support.js — drafts shelf, support page, ad gate, donor redeem (R-3 role).
   Load: after editor-preview.js, before app.js. PDF pipeline lives in export.js.
   ========================================================================= */

$('#exportBtn').addEventListener('click', exportPdf);

$('#draftExportAll').addEventListener('click', ()=>openPrint('list'));
renderDrafts();

function renderDrafts(){
  { const dc=$('#draftCount'); dc.dataset.n=String(drafts.length); dc.textContent = drafts.length ? '('+drafts.length+')' : ''; }
  $('#draftExportAll').disabled = !drafts.length;
  const lb=document.querySelector('#scopeSeg button[data-v="list"]');
  if(lb) lb.disabled=!drafts.length;
  const ul=$('#draftList');
  if(!drafts.length){ ul.innerHTML=''; return; }
  ul.innerHTML = drafts.map((d,i)=>{
    const t=new Date(d.ts);
    const hm=String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0');
    const nlay=d.designs.reduce((a,x)=>a+x.layers.length,0);
    const n=Math.max(1, Math.min(99, d.n||1));
    return `<li data-i="${i}">
      ${d.thumb?`<img src="${d.thumb}" alt="">`:'<span class="nothumb">📄</span>'}
      <div class="meta"><b>${esc(d.name)}</b>
        <span>${d.wrap.w}×${d.wrap.h} · ${d.mode==='cut'?'재단':'마크'} · ${nlay}레이어 · ${hm}</span></div>
      <span class="cnt-wrap"><input class="ncount num" type="number" min="1" max="99" step="1" value="${n}" data-n title="배치 개수 (전체 내보내기 시 이 수만큼 최소 용지에 배치)">개</span>
      <button class="lbtn" data-act="load" title="불러오기">⤴</button>
      <button class="lbtn" data-act="pdf" title="이 항목만 PDF 내보내기">⤓</button>
      <button class="lbtn" data-act="del" title="삭제">✕</button>
    </li>`;
  }).join('');
}
$('#draftList').addEventListener('change', e=>{
  const inp=e.target.closest('.ncount'); if(!inp) return;
  const li=e.target.closest('li'); if(!li || li.dataset.i===undefined) return;
  const d=drafts[+li.dataset.i]; if(!d) return;
  d.n=Math.max(1, Math.min(99, Math.round(+inp.value)||1));
  inp.value=d.n;
  if(state.exportScope==='list') requestImposedPrev();
});
$('#draftList').addEventListener('click', async e=>{
  const li=e.target.closest('li'); if(!li || li.dataset.i===undefined) return;
  const i=+li.dataset.i, d=drafts[i]; if(!d) return;
  if(e.target.closest('.ncount')) return;
  const btnEl=e.target.closest('.lbtn');
  const act=btnEl && btnEl.dataset.act;
  if(act==='del'){ drafts.splice(i,1); renderDrafts(); syncScopeUI(); toast('임시 저장 삭제됨'); return; }
  if(act==='load'){ applyDraft(d); return; }
  if(act==='pdf'){
    applyDraft(d, true);
    const btn=$('#exportBtn'); btn.disabled=true;
    try{
      const {pdf, name} = await buildPdfBlob();
      const framed=saveFile(new Blob([pdf], {type:'application/pdf'}), name);
      toast(framed ? '저장 패널: '+name : '저장 완료: '+name,'ok');
    }catch(err){ console.error(err); toast(err.message||'PDF 생성 실패','err'); }
    finally{ updateExportUI(); }
  }
});
$('#draftSaveBtn').addEventListener('click', ()=>{
  const d=snapshotNow();
  d.n = Math.max(1, Math.min(99, Math.round(+(($('#draftSaveN')||{}).value)||1)));
  drafts.push(d);
  renderDrafts(); syncScopeUI();
  toast('목록에 추가됨 ('+d.n+'개)','ok');
});

$('#dxfBtn').addEventListener('click', exportDxf);
/* fit selected image height to the wrap (template) height — aspect kept */
$('#hfitBtn').addEventListener('click', ()=>{
  const im=state.img;
  if(!im || !im.bmp){ toast('먼저 이미지를 선택하세요','err'); return; }
  const aspect=im.bmp.height/im.bmp.width;
  if(!(aspect>0)) return;
  im.w = Math.round((state.wrap.h / aspect) * 10) / 10;      // height -> wrap.h, no stretch
  if(window.syncControls) syncControls();
  renderLayers(); scheduleDraws();
  toast('높이를 랩 높이('+state.wrap.h+'mm)에 맞췄습니다','ok');
});

/* ---------- 후원 버튼 + 광고 트리거 (R5) ----------
   SUPPORT/AD 설정은 파일 상단 주석 참조. 계정 생성은 직접(설명 참조):
   BMC buymeacoffee.com · 토스 앱 송금→링크로 받기 · 카카오톡 송금 QR · 애드핏/애드센스 가입. */
function renderSupport(){
  const row=document.getElementById('supportRow'); if(!row) return;
  const items=[
    {k:'bmc',   cls:'s-bmc',   label:'☕ Buy Me a Coffee', url:SUPPORT.bmc},
    {k:'toss',  cls:'s-toss',  label:'💜 토스로 후원',      url:SUPPORT.toss},
    {k:'kakao', cls:'s-kakao', label:'💛 카카오페이 후원',   url:SUPPORT.kakao},
    {k:'donor', cls:'s-donor', label:'🔓 후원자 코드',       url:''}
  ];
  row.innerHTML = items.map(it=>{
    const raw=(it.url||'').trim();
    const href = raw ? (/^https?:\/\//i.test(raw) ? raw : 'https://'+raw.replace(/^\/+/, '')) : '';
    return href
      ? '<a class="'+it.cls+'" href="'+href+'" target="_blank" rel="noopener">'+it.label+'</a>'
      : '<button class="'+it.cls+'" data-k="'+it.k+'">'+it.label+'</button>';
  }).join('');
  row.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', async ()=>{
      if(b.dataset.k==='donor'){
        const code=window.prompt('후원자 코드를 입력하세요 (광고 트리거 영구 해제)')||'';
        if(!code.trim()) return;
        const ok=await redeemDonorCode(code);
        toast(ok ? '후원자 확인됨 — 광고 트리거가 해제되었습니다 🎉'
                 : '유효하지 않은 코드입니다 — 발급처에 확인하세요', ok?'ok':'err',
              ok?'donor-ok':'donor-invalid');
        return;
      }
      toast('후원 링크 미설정 — 관리 페이지(Codespace: node admin/server.js)에서 설정하세요','err','support-unset');
    });
  });
}
renderSupport();

/* ---- config version re-arm: 관리 페이지에서 version을 올리면 해제/쿨다운 상태 초기화 ---- */
try{
  const v=String((CFG&&CFG.version)||1);
  if(localStorage.getItem('mtCfgV')!==v){
    Object.keys(localStorage).forEach(k=>{
      if(k.indexOf('mtAdOff.')===0 || k.indexOf('mtAdLast.')===0 || k==='mtAdExp') localStorage.removeItem(k);
    });
    localStorage.setItem('mtCfgV', v);
  }
}catch(e){}

function adGate(){
  if(AD && AD.enabled) return true;
  try{ return new URLSearchParams(location.search).get('ad')==='1'; }catch(e){ return false; }
}
function adMuted(reason){ try{ return localStorage.getItem('mtAdOff.'+reason)==='1'; }catch(e){ return false; } }
function donorOn(){ try{ return localStorage.getItem('mtDonor')==='1'; }catch(e){ return false; } }
function triggerReady(reason){
  if(donorOn()) return false;                       // 후원자 = 트리거 해제 (광고 없음)
  if(adMuted(reason)) return false;                 // 광고 ✕ 로 해제된 트리거
  const t=(CFG.triggers||{})[reason];
  if(!t || t.on===false) return false;              // 관리 페이지에서 꺼둔 트리거
  if(!adGate()) return false;
  return true;
}
let _adHidden=false;
function adShow(reason){
  if(_adHidden) return;
  if(!triggerReady(reason)) return;
  const slot=document.getElementById('adSlot'); if(!slot) return;
  const key='mtAdLast.'+reason;
  const DAY=24*3600*1000;
  try{
    const last=+(localStorage.getItem(key)||0);
    if(Date.now()-last < DAY) return;
    localStorage.setItem(key, String(Date.now()));
  }catch(e){}
  const html=(AD && AD.html||'').trim();
  slot.innerHTML = (html || '<b>이 템플릿이 도움이 되셨다면 ☕ 후원으로 응원해주세요 — 푸터의 후원 버튼을 이용해 주세요!</b>')
    + '<button class="ad-x" title="클릭 시 이 트리거 해제(더 이상 표시 안 함)" aria-label="close">✕</button>';
  slot.hidden=false;
  slot.querySelector('.ad-x').addEventListener('click', ()=>{
    slot.hidden=true;
    // 트리거 해제: 광고를 한 번 보여주고 닫으면 해당 트리거 OFF
    try{ if(CFG.adCloseMutes!==false) localStorage.setItem('mtAdOff.'+reason,'1'); }catch(e){}
    toast('광고 트리거가 해제되었습니다', 'ok');
  });
}
function adExportTick(){
  const t=(CFG.triggers||{}).export||{};
  let n=0;
  try{ n=+(localStorage.getItem('mtAdExp')||0)+1; localStorage.setItem('mtAdExp', String(n)); }catch(e){ n=-1; }
  const every=Math.max(1, t.every||3);
  if(n>0 && n%every===0 && triggerReady('export')) adShow('export');
}
function adCheckDesigns(){
  const t=(CFG.triggers||{}).designs||{};
  const min=t.min||5;
  if((state.designs||[]).length>=min && triggerReady('designs')) adShow('designs');
}
/* ---- 후원자 코드 교환 (광고 트리거 영구 해제) ---- */
async function redeemDonorCode(code){
  const clean=String(code||'').replace(/[^0-9a-zA-Z]/g,'').toUpperCase();
  if(clean.length<8) return false;
  const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean));
  const hex=[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const list=(CFG&&CFG.donorHashes)||[];
  if(list.some(h=>String(h).toLowerCase()===hex)){
    try{ localStorage.setItem('mtDonor','1'); localStorage.setItem('mtDonorAt', String(Date.now())); }catch(e){}
    return true;
  }
  return false;
}

/* ---------- help modal ---------- */
$('#helpBtn').addEventListener('click', ()=>$('#helpModal').classList.add('open'));
$('#helpClose').addEventListener('click', ()=>$('#helpModal').classList.remove('open'));
$('#helpModal').addEventListener('click', e=>{ if(e.target.id==='helpModal') e.target.classList.remove('open'); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape') $('#helpModal').classList.remove('open'); });
