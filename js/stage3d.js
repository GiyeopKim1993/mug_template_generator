/* =========================================================================
   3D mug renderer (pure canvas 2D, cylinder texture mapping)
   ========================================================================= */
const stageBox = $('#stage');   // pointer/keyboard host — WebGL #mug3d canvas is mounted by model-viewer.js
const PITCH0 = Math.asin(0.16);            // default camera elevation (ry = r*0.16 look)
const mug = { th: 1.22, pitch:PITCH0, roll:0, zoom:1, panX:0, panY:0,
              auto:true, speed:0.20, drag:false, mode:'rot', lastX:0, lastY:0, spinVel:0 };
let dpr = window.devicePixelRatio||1;

function sizeStage(){
  dpr = window.devicePixelRatio||1;
  if(window.__mvSize) __mvSize();
}
window.addEventListener('resize', ()=>{ sizeStage(); clampView(); layoutEditor(); });

/* ---- view clamp: keep the WHOLE mug (transfer included) inside the canvas.
   Caps zoom to the fit level for the current pitch/roll, clamps pan so the
   mug can never be dragged/cropped off-screen (roll/pitch re-checked too). */
function clampView(){ if(window.__mvClamp) __mvClamp(); }

/* 2D fake-3D painter retired (2026-10-05): stage renders assets/mug.glb via
   model-viewer.js (WebGL). Call name kept so loop3d/turntable stay unchanged. */
function renderMug(t){ if(window.__mvDraw) __mvDraw(t); }

/* turntable + flick momentum + free view (orbit / pan / roll / zoom) */
let lastT = 0;
function loop3d(t){
  const dt = Math.min(0.05, (t-lastT)/1000 || 0); lastT = t;
  if(!mug.drag){
    if(mug.auto) mug.th += dt*mug.speed;                 // turntable
    else if(mug.spinVel !== 0){                          // flick momentum
      mug.th += mug.spinVel*dt;
      mug.spinVel *= Math.exp(-dt*2.1);
      if(Math.abs(mug.spinVel) < 0.005) mug.spinVel = 0;
    }
  }
  renderMug(t);
  requestAnimationFrame(loop3d);
}

let lastMoveT = 0;
stageBox.addEventListener('pointerdown', e=>{
  if(e.target.closest && e.target.closest('.stage-ctrl')) return;   // spin controls keep native clicks (no capture/preventDefault)
  mug._dragDist=0;
  mug.drag = true;
  mug.mode = (e.button === 2 || e.shiftKey) ? 'pan'
           : (e.ctrlKey || e.metaKey) ? 'roll' : 'rot';
  mug.lastX = e.clientX; mug.lastY = e.clientY;
  mug.spinVel = 0; lastMoveT = performance.now();
  stageBox.setPointerCapture(e.pointerId);
  e.preventDefault();
});
stageBox.addEventListener('pointermove', e=>{
  if(!mug.drag) return;
  const now = performance.now();
  const dtm = Math.max(0.008, (now - lastMoveT)/1000); lastMoveT = now;
  const dx = e.clientX - mug.lastX, dy = e.clientY - mug.lastY;
  mug._dragDist=(mug._dragDist||0)+Math.abs(dx)+Math.abs(dy);
  mug.lastX = e.clientX; mug.lastY = e.clientY;
  if(mug.mode === 'pan'){
    mug.panX += dx; mug.panY += dy;
  }else if(mug.mode === 'roll'){
    mug.roll = Math.max(-0.7, Math.min(0.7, mug.roll + dx*0.006));
  }else{
    const dyaw = dx*0.0085;
    mug.th += dyaw;
    mug.pitch = Math.max(0.02, Math.min(0.62, mug.pitch - dy*0.004));   // drag up = raise camera (orbit)
    mug.spinVel = mug.spinVel*0.75 + (dyaw/dtm)*0.25;    // remembered for momentum
  }
  clampView();   // never let the mug (transfer) leave the canvas
});
function endMugDrag(e){
  if(!mug.drag) return;
  mug.drag = false;
  if(mug.mode !== 'rot') mug.spinVel = 0;
  try{ stageBox.releasePointerCapture(e.pointerId); }catch(_){}
}
stageBox.addEventListener('pointerup', endMugDrag);
stageBox.addEventListener('pointercancel', endMugDrag);
stageBox.addEventListener('wheel', e=>{
  e.preventDefault();
  mug.zoom = Math.max(0.4, mug.zoom * Math.exp(-e.deltaY*0.0011));
  clampView();   // zoom is capped at the level where the whole mug still fits
}, {passive:false});
/* ---------- render modal (compact stage -> large view) ---------- */
const renderModal=$('#renderModal');
let _rmTimer=null;
function openRenderModal(){
  if(renderModal.classList.contains('open')) return;
  clearTimeout(_rmTimer); _rmTimer=null;
  $('#renderSlot').appendChild($('#stage'));
  renderModal.classList.add('open');
  sizeStage(); clampView();
}
function closeRenderModal(){
  if(!renderModal.classList.contains('open')) return;
  renderModal.classList.remove('open');
  $('#stageHome').appendChild($('#stage'));
  sizeStage(); clampView();
}
$('#renderClose').addEventListener('click', closeRenderModal);
$('#spClose').addEventListener('click', closeSavePanel);
document.getElementById('savePanel').addEventListener('click', e=>{ if(e.target.id==='savePanel') closeSavePanel(); });
renderModal.addEventListener('click', e=>{ if(e.target===renderModal) closeRenderModal(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closeRenderModal(); closeSavePanel(); } });
stageBox.addEventListener('click', e=>{
  if(e.target.closest && e.target.closest('.stage-ctrl')) return;   // spin controls never open the expand modal
  if(renderModal.classList.contains('open') || _rmTimer) return;
  if((mug._dragDist||0)>6) return;               // drag, not a click
  _rmTimer=setTimeout(()=>{ _rmTimer=null; openRenderModal(); }, 60);
});
stageBox.addEventListener('dblclick', ()=>{ clearTimeout(_rmTimer); _rmTimer=null; });

/* ---------- print settings dialog ---------- */
const printModal=$('#printModal');
state.exportScope='single';
function openPrint(scope){
  if(scope==='list' && drafts.length){ state.exportScope='list'; setSegActive('#scopeSeg','list'); }
  else { state.exportScope='single'; setSegActive('#scopeSeg','single'); }   // rail/⌘P = current design
  syncScopeUI();
  printModal.classList.add('open');
}
function closePrint(){ printModal.classList.remove('open'); }
$('#printOpen').addEventListener('click', openPrint);
$('#printClose').addEventListener('click', closePrint);
printModal.addEventListener('click', e=>{ if(e.target===printModal) closePrint(); });
document.addEventListener('keydown', e=>{
  if((e.ctrlKey||e.metaKey) && (e.key==='p'||e.key==='P')){ e.preventDefault(); openPrint(); }
});
document.addEventListener('keydown', e=>{
  if(e.key==='Escape' && printModal.classList.contains('open')) closePrint();
});
/* Illustrator-ish tool hotkeys: F=fill, C=crop, Del=remove (when not typing) */
document.addEventListener('keydown', e=>{
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  const t=e.target;
  if(t && t.closest && t.closest('input,textarea,select,[contenteditable]')) return;
  if(printModal.classList.contains('open')) return;
  if(e.key==='f'||e.key==='F'){ e.preventDefault(); $('#fitBtn').click(); }
  else if(e.key==='c'||e.key==='C'){ e.preventDefault(); $('#cropBtn').click(); }
  else if(e.key==='Delete'){ if(state.img){ e.preventDefault(); $('#rmBtn').click(); } }
});
stageBox.addEventListener('contextmenu', e=>e.preventDefault());
stageBox.addEventListener('dblclick', ()=>{
  mug.zoom = 1; mug.panX = 0; mug.panY = 0; mug.pitch = PITCH0; mug.roll = 0;
  clampView();
});
$('#autoSpin').addEventListener('change', e=>{ mug.auto = e.target.checked; mug.spinVel = 0; });
$('#spinSpd').addEventListener('change', e=>{ mug.speed = parseFloat(e.target.value); });
