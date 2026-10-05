/* js/store.js — S4: state + config + drafts + subscription (STRUCTURE §3).
   Loaded BEFORE app.js/export.js. Top-level code here must never call into
   app.js (function bodies may, at runtime). */
const $ = (s)=>document.querySelector(s);
const DPI = 300;
const state = {
  wrap:{w:205, h:87},
  bg:'#ffffff',
  img:null,          // {bmp, cx, cy, w(mm), rot(deg)}
  mode:'cut',
  machine:'silhouette',
  orient:'auto',
  cutStyle:'light',
  mirror:true,
  paper:'a4',      // 'a4' | 'letter'  (default A4 for every mode)
  notch:true,      // real 11oz template shape: handle cutouts
  copies:1,        // page imposition: 가로(≤3) / 세로(≤2)
  designs:[],      // independent design sheets: [{id,name,layers:[...],ver}]
  activeDesign:0,  // index into designs (the sheet being edited / shown in 3D)
  activeLayer:0,   // index into designs[activeDesign].layers
  copyDesign:[0],  // design index used by each placed copy
  sel:[],          // multi-selected layer indices (group align)
  img:null         // live alias of the ACTIVE layer (kept by syncActive)
};
state.designs.push({id:1, name:'디자인 1', layers:[], ver:0});
let _uidSeq = 1;
let _dsgSeq = 1;
function uid(){ return ++_uidSeq; }
function activeDesign(){ return state.designs[state.activeDesign] || state.designs[0]; }
function activeLayer(){ const d = activeDesign(); return (d && d.layers[state.activeLayer]) || null; }

const MT_CFG_DEFAULT = {
  version:1,
  support:{ toss:'', kakao:'', bmc:'' },
  ad:{ enabled:false, html:'' },
  triggers:{ export:{on:true, every:3}, designs:{on:true, min:5} },
  adCloseMutes:true,
  donorHashes:[]
};
const CFG = (typeof window!=='undefined' && window.MT_CONFIG) ? window.MT_CONFIG : MT_CFG_DEFAULT;
const SUPPORT = CFG.support || MT_CFG_DEFAULT.support;

/* ---- state change subscription (A2 mitigation): views subscribe once ---- */
const _stateSubs = [];
function onStateChange(fn){ _stateSubs.push(fn); }
function notifyState(){ for(const f of _stateSubs){ try{ f(); }catch(e){ console.error(e); } } }

/* ---------- 임시 저장(drafts) + 일괄 내보내기 ---------- */
const drafts=[];
function thumbUrl(){
  try{
    const src=designCanvas(state.activeDesign);
    const c=document.createElement('canvas');
    c.width=64; c.height=Math.max(1, Math.round(64*state.wrap.h/state.wrap.w));
    const x=c.getContext('2d');
    x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);
    x.drawImage(src,0,0,c.width,c.height);
    return c.toDataURL('image/png');
  }catch(_){ return ''; }
}
function snapshotNow(name){
  return { name: name||('임시 '+String(drafts.length+1).padStart(2,'0')),
    ts: Date.now(),
    wrap:{...state.wrap}, mode:state.mode, machine:state.machine, orient:state.orient,
    cutStyle:state.cutStyle, mirror:state.mirror, paper:state.paper, notch:state.notch,
    bg:state.bg, copies:state.copies, copyDesign:[...state.copyDesign],
    activeDesign:state.activeDesign, activeLayer:state.activeLayer, sel:[...state.sel],
    designs: state.designs.map(d=>({id:d.id, name:d.name, ver:0,
      layers:d.layers.map(l=>({...l}))})),
    thumb: thumbUrl() };
}
function applyDraft(d, silent){
  if(!d) return;
  state.wrap={...d.wrap};
  state.mode=d.mode; state.machine=d.machine; state.orient=d.orient;
  state.cutStyle=d.cutStyle; state.mirror=d.mirror; state.paper='a4';   // A4 only (drafts may carry legacy letter)
  state.notch=d.notch; state.bg=d.bg; state.copies=d.copies;
  state.copyDesign=[...(d.copyDesign||[0])];
  state.designs = d.designs.map(x=>({id:x.id, name:x.name, ver:0,
    layers:x.layers.map(l=>({...l}))}));
  state.activeDesign=Math.max(0, Math.min(d.activeDesign, state.designs.length-1));
  state.activeLayer=Math.max(0, Math.min(d.activeLayer, activeDesign().layers.length-1));
  const ds=(d.sel && d.sel.length ? d.sel : [state.activeLayer])
    .filter(i=>activeDesign().layers[i]);
  state.sel = ds.length ? ds : [state.activeLayer];
  _dsgSeq = Math.max(_dsgSeq, ...state.designs.map(x=>parseInt((x.name.match(/\d+/)||['0'])[0])||0));
  cropOff();
  setSegActive('#modeSeg', state.mode); setSegActive('#cutSeg', state.cutStyle);
  setSegActive('#markSeg', state.machine); setSegActive('#orientSeg', state.orient);
  $('#cutOpts').style.display = state.mode==='cut' ? '' : 'none';
  $('#markOpts').style.display = state.mode==='mark' ? '' : 'none';
  $('#notchChk').checked = !!state.notch;
  $('#mirrorChk').checked = !!state.mirror;
  $('#bgColor').value = state.bg;
  $('#copiesSel').value = String(state.copies);
  const pk = state.wrap.w+'x'+state.wrap.h;
  let known=false;
  try{ known=[...$('#presetSel').options].some(o=>o.value===pk); }catch(_){}
  $('#presetSel').value = known ? pk : 'custom';
  $('#customSizeRow').style.display = known ? 'none' : 'flex';
  if(!known){ $('#cwIn').value=state.wrap.w; $('#chIn').value=state.wrap.h; }
  syncActive(); renderDesignSel(); renderLayers(); syncControls();
  scheduleDraws(); updateExportUI(); updateMarkHint();
  notifyState();
  if(!silent) toast('임시 저장을 불러왔습니다','ok');
}
