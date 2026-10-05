/* =========================================================================
   editor-canvas.js — 2D editor surface: layout, paint, hit-test, drag,
   crop, context menu, scheduled draw queue (store subscription entry).
   Load: after stage3d.js.
   ========================================================================= */
const ed = $('#editor'), ectx = ed.getContext('2d');
let edBox = {ox:0, oy:0, s:1};   // mm -> px scale, origin
let resizeHit = null, dragImg = null;
let edLock = false;              // freeze the view-fit while dragging/resizing

function layoutEditor(){
  if(edLock){ drawEditor(); return; }   // stable mm<->px mapping during a pointer drag
  const wrapEl = $('#editorWrap');
  const W = wrapEl.clientWidth;
  const H = Math.max(160, Math.min(520, W * state.wrap.h / state.wrap.w + 46));
  ed.style.height = H+'px';
  ed.width = Math.round(W*dpr); ed.height = Math.round(H*dpr);
  ed.style.width = W+'px';
  const pad = 26;
  // Fit BOTH the template and the whole image (outline + resize handle):
  // 크기 확대/축소·이동을 해도 미리보기가 캔버스 경계에 잘리지 않는다.
  let bx0=0, by0=0, bx1=state.wrap.w, by1=state.wrap.h;
  const im = state.img;
  if(im){
    const asp = im.bmp.height/im.bmp.width;
    const a = im.rot*Math.PI/180, ca=Math.abs(Math.cos(a)), sa=Math.abs(Math.sin(a));
    const hw = (im.w*ca + im.w*asp*sa)/2, hh = (im.w*sa + im.w*asp*ca)/2;
    bx0=Math.min(bx0, im.cx-hw); by0=Math.min(by0, im.cy-hh);
    bx1=Math.max(bx1, im.cx+hw); by1=Math.max(by1, im.cy+hh);
  }
  const s = Math.max(0.02, Math.min((W-pad*2)/(bx1-bx0), (H-pad*2)/(by1-by0))) * dpr;
  edBox.s = s;
  edBox.ox = (W*dpr)/2 - (bx0+bx1)*0.5*s;
  edBox.oy = (H*dpr)/2 - (by0+by1)*0.5*s;
  drawEditor();
}
function mm2e(x,y){ return [edBox.ox + x*edBox.s, edBox.oy + y*edBox.s]; }

function drawEditor(){
  const W=ed.width, H=ed.height;
  ectx.clearRect(0,0,W,H);
  // wrap
  const [x0,y0] = mm2e(0,0);
  const wpx = state.wrap.w*edBox.s, hpx = state.wrap.h*edBox.s;
  ectx.save();
  ectx.fillStyle='#11141b'; ectx.fillRect(x0-6*dpr,y0-6*dpr,wpx+12*dpr,hpx+12*dpr);
  ectx.restore();
  // white paper underlay so notch bites read as unprinted paper
  ectx.fillStyle='#ffffff'; ectx.fillRect(x0,y0,wpx,hpx);
  // artwork in LOCAL mm coords (translate fixes the old on-screen offset)
  ectx.save();
  ectx.beginPath(); ectx.rect(x0,y0,wpx,hpx); ectx.clip();
  ectx.translate(x0, y0);
  drawArtwork(ectx, wpx, hpx, edBox.s, false);
  // punches cut through the whole canvas — refill the bites with paper white
  ectx.globalCompositeOperation='destination-over';
  ectx.fillStyle='#ffffff'; ectx.fillRect(0,0,wpx,hpx);
  ectx.globalCompositeOperation='source-over';
  ectx.restore();
  // notched outline = real template shape (follows the handle cutouts)
  ectx.save();
  ectx.beginPath();
  const segs = wrapSegs(state.wrap.w, state.wrap.h, state.notch);
  for(const sg of segs){
    if(sg[0]==='M'){ const q=mm2e(sg[1],sg[2]); ectx.moveTo(q[0],q[1]); }
    else if(sg[0]==='L'){ const q=mm2e(sg[1],sg[2]); ectx.lineTo(q[0],q[1]); }
    else { const q1=mm2e(sg[1],sg[2]), q2=mm2e(sg[3],sg[4]), q3=mm2e(sg[5],sg[6]);
           ectx.bezierCurveTo(q1[0],q1[1],q2[0],q2[1],q3[0],q3[1]); }
  }
  ectx.closePath();
  ectx.strokeStyle='rgba(91,140,255,0.9)'; ectx.lineWidth=1.5*dpr;
  ectx.stroke();
  ectx.restore();
  // ---- front-face zone guides: LEFT box · CENTRE line · RIGHT box (editor-only,
  // ---- never prints/PDF/3D). Was a white-on-white cross — invisible on paper.
  ectx.save();
  ectx.beginPath(); ectx.rect(x0,y0,wpx,hpx); ectx.clip();
  const ZA = 'rgba(47,124,255,0.65)';            // zone blue (0.65 → outside the strict 'bright snap' probe)
  ectx.strokeStyle = ZA; ectx.lineWidth = 1.3*dpr;
  ectx.setLineDash([7*dpr,5*dpr]);
  ectx.beginPath();                               // centre axis + horizontal axis
  ectx.moveTo(x0+wpx/2, y0); ectx.lineTo(x0+wpx/2, y0+hpx);
  ectx.moveTo(x0, y0+hpx/2); ectx.lineTo(x0+wpx, y0+hpx/2);
  ectx.stroke();
  ectx.setLineDash([6*dpr,4*dpr]);                // LEFT / RIGHT zone boxes
  ectx.lineWidth = 1.2*dpr;
  const zy0 = y0+hpx*0.13, zy1 = y0+hpx*0.87;
  ectx.strokeRect(x0+wpx*0.07, zy0, wpx*0.35, zy1-zy0);
  ectx.strokeRect(x0+wpx*0.58, zy0, wpx*0.35, zy1-zy0);
  ectx.setLineDash([9*dpr,6*dpr]);                // zone-centre verticals — ALWAYS on
  ectx.strokeStyle = 'rgba(47,124,255,0.55)'; ectx.lineWidth = 1.4*dpr;
  ectx.beginPath();
  ectx.moveTo(x0+wpx*0.245, zy0); ectx.lineTo(x0+wpx*0.245, zy1);
  ectx.moveTo(x0+wpx*0.755, zy0); ectx.lineTo(x0+wpx*0.755, zy1);
  ectx.stroke();
  ectx.strokeStyle = ZA;
  ectx.setLineDash([]);
  ectx.font = `700 ${9.5*dpr}px system-ui`;
  ectx.textAlign='center'; ectx.textBaseline='middle';
  ectx.fillStyle='rgba(20,64,170,0.95)';
  ectx.fillText('왼쪽',   x0+wpx*0.245, y0+hpx/2 - 9*dpr);
  ectx.fillText('오른쪽', x0+wpx*0.755, y0+hpx/2 - 9*dpr);
  ectx.fillStyle='rgba(20,64,170,1)';
  ectx.fillText('앞면 중심', x0+wpx/2, y0+10*dpr);
  ectx.restore();
  // handle/seam labels ON both short edges (matches the 3D handle position)
  ectx.save();
  ectx.fillStyle='rgba(255,255,255,0.92)'; ectx.font=`600 ${9.5*dpr}px system-ui`;
  ectx.textAlign='center'; ectx.textBaseline='middle';
  ectx.shadowColor='rgba(0,0,0,0.8)'; ectx.shadowBlur=3*dpr;
  const htxt = state.notch ? '핸들 · 이음매 (노치)' : '핸들 · 이음매';
  ectx.translate(x0+11*dpr, y0+hpx/2); ectx.rotate(-Math.PI/2);
  ectx.fillText(htxt, 0, 0);
  ectx.restore();
  ectx.save();
  ectx.fillStyle='rgba(255,255,255,0.92)'; ectx.font=`600 ${9.5*dpr}px system-ui`;
  ectx.textAlign='center'; ectx.textBaseline='middle';
  ectx.shadowColor='rgba(0,0,0,0.8)'; ectx.shadowBlur=3*dpr;
  ectx.translate(x0+wpx-11*dpr, y0+hpx/2); ectx.rotate(-Math.PI/2);
  ectx.fillText(htxt, 0, 0);
  ectx.restore();
  // dims
  ectx.fillStyle='rgba(154,164,184,0.9)'; ectx.font=`${10.5*dpr}px system-ui`;
  ectx.textAlign='center';
  ectx.fillText(state.wrap.w+' × '+state.wrap.h+' mm', x0+wpx/2, Math.min(H-4*dpr, y0+hpx+16*dpr));

  // empty-state hint
  if(!state.img){
    ectx.fillStyle='rgba(154,164,184,0.85)';
    ectx.font=`${12*dpr}px system-ui`;
    ectx.textAlign='center';
    ectx.fillText('이미지를 업로드하거나 이 영역에 끌어다 놓으세요',
      x0+wpx/2, y0+hpx/2-4*dpr);
    ectx.font=`${10.5*dpr}px system-ui`;
    ectx.fillStyle='rgba(154,164,184,0.55)';
    ectx.fillText('Ctrl+V 붙여넣기 가능', x0+wpx/2, y0+hpx/2+16*dpr);
  }
  // image outline + handle
  const im = state.img;
  if(im){
    const ow0=im.bmp.width, oh0=im.bmp.height;
    const aspect = im.bmp.height/im.bmp.width;
    const iw = im.w*edBox.s, ih = im.w*aspect*edBox.s;
    const [ix,iy] = mm2e(im.cx, im.cy);
    ectx.save();
    ectx.translate(ix,iy); ectx.rotate(im.rot*Math.PI/180);
    ectx.strokeStyle='rgba(61,214,195,0.95)'; ectx.lineWidth=1.4*dpr;
    ectx.strokeRect(-iw/2, -ih/2, iw, ih);
    // resize handle (bottom-right)
    const hx=iw/2, hy=ih/2;
    ectx.beginPath(); ectx.arc(hx,hy, 6.5*dpr, 0, Math.PI*2);
    ectx.fillStyle='#3dd6c3'; ectx.fill();
    ectx.strokeStyle='#0c3b35'; ectx.lineWidth=1.4*dpr; ectx.stroke();
    if(crop){
      const cw=crop.pw*iw/ow0, ch=crop.ph*ih/oh0;
      const cx0=(crop.px/ow0-0.5)*iw, cy0=(crop.py/oh0-0.5)*ih;
      ectx.fillStyle='rgba(6,9,14,0.55)';
      ectx.beginPath();
      ectx.rect(-iw/2,-ih/2,iw,ih);
      ectx.rect(cx0, cy0, cw, ch);
      ectx.fill('evenodd');
      ectx.strokeStyle='#ffd166'; ectx.lineWidth=1.6*dpr;
      ectx.strokeRect(cx0, cy0, cw, ch);
      for(const [hx2,hy2] of [[cx0,cy0],[cx0+cw,cy0+ch]]){
        ectx.beginPath(); ectx.arc(hx2,hy2,5.5*dpr,0,Math.PI*2);
        ectx.fillStyle='#ffd166'; ectx.fill();
        ectx.strokeStyle='#3a2f0c'; ectx.lineWidth=1.2*dpr; ectx.stroke();
      }
    }
    ectx.restore();
  }

  // ---- non-printing alignment guides (editor canvas only; never in print/PDF/3D) ----
  if(im && !crop){
    const TW=state.wrap.w, THg=state.wrap.h;
    const [tx,ty]=mm2e(TW/2, THg/2);
    const [ixg,iyg]=mm2e(im.cx, im.cy);
    const onX=Math.abs(im.cx-TW/2)<=0.01, onY=Math.abs(im.cy-THg/2)<=0.01;
    const dragging=!!dragImg;
    const ZL=TW*0.245, ZR=TW*0.755;            // LEFT / RIGHT zone centres (match the boxes)
    let snapX=null, snapLbl=null;
    if(onX){ snapX=TW/2; snapLbl='앞면 정렬 ✓'; }
    else if(Math.abs(im.cx-ZL)<=0.01){ snapX=ZL; snapLbl='왼쪽 정렬 ✓'; }
    else if(Math.abs(im.cx-ZR)<=0.01){ snapX=ZR; snapLbl='오른쪽 정렬 ✓'; }
    ectx.save();
    ectx.beginPath(); ectx.rect(x0,y0,wpx,hpx); ectx.clip();
    // image-centre crosshair (teal)
    ectx.strokeStyle='rgba(61,214,195,0.95)'; ectx.lineWidth=1.3*dpr;
    ectx.beginPath();
    ectx.moveTo(ixg-8*dpr,iyg); ectx.lineTo(ixg+8*dpr,iyg);
    ectx.moveTo(ixg,iyg-8*dpr); ectx.lineTo(ixg,iyg+8*dpr);
    ectx.stroke();
    ectx.beginPath(); ectx.arc(ixg,iyg,3*dpr,0,Math.PI*2);
    ectx.strokeStyle='rgba(61,214,195,0.95)'; ectx.lineWidth=1.2*dpr; ectx.stroke();
    // FRONT-FACE centre guide — ALWAYS visible (dim), bright when the image snaps to it.
    // anchored to the template's own 핸들·이음매 edge marks: front centre = midpoint between them
    ectx.setLineDash([7*dpr,5*dpr]);
    ectx.lineWidth = onX? 1.6*dpr : 1.2*dpr;
    ectx.strokeStyle = onX? 'rgba(47,124,255,0.95)' : 'rgba(47,124,255,0.38)';
    ectx.beginPath(); ectx.moveTo(tx,y0); ectx.lineTo(tx,y0+hpx); ectx.stroke();
    if(!onX){
      ectx.font=`700 ${9*dpr}px system-ui`; ectx.textAlign='center'; ectx.textBaseline='bottom';
      ectx.fillStyle='rgba(143,180,255,0.95)';
      ectx.fillText('앞면 중심', tx, y0+hpx-4*dpr);
      ectx.textBaseline='alphabetic';
    }
    // LEFT/RIGHT snap guides — dim at rest, bright while snapped to that zone
    for(const [zx,act] of [[ZL, snapX===ZL],[ZR, snapX===ZR]]){
      const [xpx]=mm2e(zx,0);
      ectx.lineWidth = act? 1.6*dpr : 1.2*dpr;
      ectx.strokeStyle = act? 'rgba(47,124,255,0.95)' : 'rgba(47,124,255,0.38)';
      ectx.beginPath(); ectx.moveTo(xpx,y0); ectx.lineTo(xpx,y0+hpx); ectx.stroke();
    }
    if(onY || dragging){
      ectx.setLineDash([7*dpr,5*dpr]);
      ectx.lineWidth = onY? 1.6*dpr : 1.2*dpr;
      ectx.strokeStyle = onY? 'rgba(47,124,255,0.95)' : 'rgba(47,124,255,0.30)';
      ectx.beginPath(); ectx.moveTo(x0,ty); ectx.lineTo(x0+wpx,ty); ectx.stroke();
    }
    ectx.setLineDash([]);
    if(snapX!=null && onY){
      const lbl=snapLbl;
      ectx.font=`600 ${10*dpr}px system-ui`; ectx.textAlign='center'; ectx.textBaseline='middle';
      const tw=ectx.measureText(lbl).width;
      const bx=mm2e(snapX,0)[0], by=y0+13*dpr;
      ectx.fillStyle='rgba(12,15,22,0.85)';
      ectx.fillRect(bx-tw/2-7*dpr, by-9*dpr, tw+14*dpr, 18*dpr);
      ectx.fillStyle='#8fb4ff'; ectx.fillText(lbl, bx, by);
    }
    // back face (handle axis) — derived from the template's own '핸들 · 이음매' edge marks
    ectx.setLineDash([5*dpr,7*dpr]);
    ectx.lineWidth=1.2*dpr;
    ectx.strokeStyle='rgba(47,124,255,0.42)';
    ectx.beginPath(); ectx.moveTo(x0,y0); ectx.lineTo(x0,y0+hpx); ectx.stroke();
    ectx.beginPath(); ectx.moveTo(x0+wpx,y0); ectx.lineTo(x0+wpx,y0+hpx); ectx.stroke();
    ectx.setLineDash([]);
    ectx.font=`700 ${9*dpr}px system-ui`; ectx.textBaseline='top';
    ectx.fillStyle='rgba(143,180,255,0.95)';
    ectx.textAlign='left';  ectx.fillText('뒷면·핸들', x0+4*dpr, y0+4*dpr);
    ectx.textAlign='right'; ectx.fillText('뒷면·핸들', x0+wpx-4*dpr, y0+4*dpr);
    ectx.textAlign='left'; ectx.textBaseline='alphabetic';
    if(dragging){                       // live offset readout while dragging
      const dx=im.cx-TW/2, dy=im.cy-THg/2;
      const txt=`ΔX ${(dx>=0?'+':'')+dx.toFixed(1)} · ΔY ${(dy>=0?'+':'')+dy.toFixed(1)} mm`;
      ectx.font=`${10.5*dpr}px system-ui`; ectx.textAlign='left'; ectx.textBaseline='middle';
      const tw2=ectx.measureText(txt).width;
      const bx2=ixg+12*dpr, by2=iyg+22*dpr;
      ectx.fillStyle='rgba(12,15,22,0.85)';
      ectx.fillRect(bx2, by2-9*dpr, tw2+12*dpr, 18*dpr);
      ectx.fillStyle='#ffd166'; ectx.fillText(txt, bx2+6*dpr, by2);
    }
    ectx.restore();
  }
}

function e2mm(px,py){ return [(px-edBox.ox)/edBox.s, (py-edBox.oy)/edBox.s]; }
function layerHit(im,mx,my,pad){
  if(!im || !im.bmp) return false;
  pad = pad||0;
  const aspect=im.bmp.height/im.bmp.width;
  const a=(im.rot)*Math.PI/180, ca=Math.cos(-a), sa=Math.sin(-a);
  const dx=mx-im.cx, dy=my-im.cy;
  const lx=dx*ca-dy*sa, ly=dx*sa+dy*ca;
  const hw=im.w/2, hh=(im.w*aspect)/2;
  return Math.abs(lx)<=hw+pad && Math.abs(ly)<=hh+pad;
}
function imgHit(mx,my){ return layerHit(state.img, mx, my); }
/* topmost visible layer under (mm) point — array end = front */
function pickTopLayer(mx,my){
  const dsg=activeDesign(); if(!dsg) return -1;
  for(let i=dsg.layers.length-1; i>=0; i--){
    const L=dsg.layers[i];
    if(!L.visible || !L.bmp) continue;
    if(layerHit(L,mx,my)) return i;
  }
  return -1;
}
function focusLayer(i){
  if(i<0 || i===state.activeLayer) return;
  state.activeLayer=i; state.sel=[i];
  syncActive(); renderLayers(); syncControls();
  scheduleDraws();   // canvas selection handles/outline must follow focus (was stale → "click does nothing")
}
function handleScreenPos(){
  const im=state.img; if(!im) return null;
  const aspect=im.bmp.height/im.bmp.width;
  const a=im.rot*Math.PI/180;
  const lx=im.w/2, ly=(im.w*aspect)/2;
  const gx=im.cx + lx*Math.cos(a)-ly*Math.sin(a);
  const gy=im.cy + lx*Math.sin(a)+ly*Math.cos(a);
  return [gx,gy];
}

ed.addEventListener('pointerdown', e=>{
  const rect=ed.getBoundingClientRect();
  const px=(e.clientX-rect.left)*dpr, py=(e.clientY-rect.top)*dpr;
  const [mx,my]=e2mm(px,py);
  if(crop){
    const hit=cropHit(px,py);
    if(hit && hit.h!=='out'){
      const g=cropGeom();
      cropDrag={h:hit.h, st:{...crop},
        nx0:(hit.lx/g.iw+0.5)*g.ow, ny0:(hit.ly/g.ih+0.5)*g.oh};
      edLock=true; ed.setPointerCapture(e.pointerId);
    }
    return;
  }
  if(state.img){
    const hp=handleScreenPos();
    const hpx=mm2e(hp[0],hp[1]);
    if(Math.hypot(px-hpx[0], py-hpx[1]) < 12*dpr){
      resizeHit={startW:state.img.w, startD:Math.hypot(mx-state.img.cx,my-state.img.cy)};
      edLock=true;
      ed.setPointerCapture(e.pointerId); return;
    }
  }
  const pick = pickTopLayer(mx,my);            // click focuses FRONT-most image (works with no active layer too)
  if(pick>=0) focusLayer(pick);
  if(state.img && imgHit(mx,my)){
    dragImg={dx:mx-state.img.cx, dy:my-state.img.cy};
    edLock=true;
    ed.setPointerCapture(e.pointerId); return;
  }
});
/* ---- right-click: z-order context menu ---- */
function hideCtx(){ const m=document.getElementById('ctxMenu'); if(m) m.hidden=true; }
ed.addEventListener('contextmenu', e=>{
  e.preventDefault();
  const m=document.getElementById('ctxMenu'); if(!m) return;
  const rect=ed.getBoundingClientRect();
  const [mx,my]=e2mm((e.clientX-rect.left)*dpr,(e.clientY-rect.top)*dpr);
  let pick=pickTopLayer(mx,my);
  if(pick<0){                                     // near-miss tolerance (3mm) so the menu reliably appears
    const dsg=activeDesign();
    for(let i=(dsg?dsg.layers.length:0)-1; i>=0; i--){
      const L=dsg.layers[i];
      if(L && L.visible && L.bmp && layerHit(L,mx,my,3)){ pick=i; break; }
    }
  }
  if(pick<0){ hideCtx(); return; }
  focusLayer(pick);
  // reflect no-op actions instead of silently doing nothing (bottom-most layer)
  const canMove = pick>0;
  const bBack=m.querySelector('[data-act="back"]'), bTop=m.querySelector('[data-act="toback"]');
  if(bBack) bBack.disabled=!canMove;
  if(bTop) bTop.disabled=!canMove;
  m.hidden=false;
  const mw=m.offsetWidth||170, mh=m.offsetHeight||80;
  m.style.left=Math.min(e.clientX, innerWidth-mw-8)+'px';
  m.style.top=Math.min(e.clientY, innerHeight-mh-8)+'px';
  e.stopPropagation();
});
document.addEventListener('click', hideCtx);
document.addEventListener('pointerdown', (e)=>{ if(e.target && e.target.closest && e.target.closest('#ctxMenu')) return; hideCtx(); }, true);
document.addEventListener('keydown', e=>{ if(e.key==='Escape') hideCtx(); });
document.getElementById('ctxMenu').addEventListener('click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  const dsg=activeDesign(); const i=state.activeLayer;
  const L=dsg && dsg.layers[i]; if(!L) return;
  if(b.dataset.act==='back' && i>0){                 // one step toward the back
    dsg.layers[i]=dsg.layers[i-1]; dsg.layers[i-1]=L;
    if(state.activeLayer===i) state.activeLayer=i-1;
    state.sel=state.sel.map(x=> x===i ? i-1 : x);
  } else if(b.dataset.act==='toback' && i>0){        // all the way to the back
    dsg.layers.splice(i,1); dsg.layers.unshift(L);
    const oldSel=state.sel;
    state.activeLayer = 0;
    state.sel=Array.from(new Set(oldSel.map(x=> x===i ? 0 : (x>i ? x : x+1))));
  } else { hideCtx(); return; }
  renderLayers(); scheduleDraws(); syncControls(); hideCtx();
});
ed.addEventListener('pointermove', e=>{
  const rect=ed.getBoundingClientRect();
  const px=(e.clientX-rect.left)*dpr, py=(e.clientY-rect.top)*dpr;
  const [mx,my]=e2mm(px,py);
  if(crop){
    const g=cropGeom();
    const hit=cropHit(px,py);
    ed.style.cursor = (hit && (hit.h==='tl'||hit.h==='br')) ? 'nwse-resize'
      : (hit && hit.h==='in' ? 'move' : 'crosshair');
    if(!cropDrag || !g) return;
    const nx=(hit.lx/g.iw+0.5)*g.ow, ny=(hit.ly/g.ih+0.5)*g.oh;
    const MIN=24;
    if(cropDrag.h==='in'){
      const w=cropDrag.st.pw, h=cropDrag.st.ph;
      crop.px=cmin(cropDrag.st.px+(nx-cropDrag.nx0), 0, g.ow-w);
      crop.py=cmin(cropDrag.st.py+(ny-cropDrag.ny0), 0, g.oh-h);
    } else if(cropDrag.h==='tl'){
      const RX=cropDrag.st.px+cropDrag.st.pw, RY=cropDrag.st.py+cropDrag.st.ph;
      crop.px=cmin(nx, 0, RX-MIN);
      crop.py=cmin(ny, 0, RY-MIN);
      crop.pw=RX-crop.px; crop.ph=RY-crop.py;
    } else {
      crop.pw=cmin(nx, cropDrag.st.px+MIN, g.ow-cropDrag.st.px)-cropDrag.st.px;
      crop.ph=cmin(ny, cropDrag.st.py+MIN, g.oh-cropDrag.st.py)-cropDrag.st.py;
    }
    drawEditor(); return;
  }
  if(resizeHit){
    const d=Math.hypot(mx-state.img.cx, my-state.img.cy);
    if(resizeHit.startD>1) state.img.w = Math.max(5, resizeHit.startW * d/resizeHit.startD);
    syncControls(); scheduleDraws(); return;
  }
  if(dragImg){
    state.img.cx=mx-dragImg.dx; state.img.cy=my-dragImg.dy;
    // non-printing guides: gentle snap to LEFT / CENTRE / RIGHT zone centres within 2.5mm
    const GS=2.5;
    const zx = Pure.zoneSnapX(state.img.cx, state.wrap.w, GS);
    if(zx!=null) state.img.cx=zx;
    if(Math.abs(state.img.cy-state.wrap.h/2)<=GS) state.img.cy=state.wrap.h/2;
    scheduleDraws(); return;
  }
  // cursor
  if(state.img){
    const hp=handleScreenPos(); const hpx=mm2e(hp[0],hp[1]);
    ed.style.cursor = Math.hypot(px-hpx[0],py-hpx[1])<12*dpr ? 'nwse-resize' : (imgHit(mx,my)?'move':'default');
  } else ed.style.cursor='default';
});
function endDrag(){
  const was = resizeHit || dragImg || cropDrag;
  if(resizeHit && state.img) markW();
  resizeHit=null; dragImg=null; cropDrag=null;
  if(was){ edLock=false; layoutEditor(); }   // refit so outline/handle stay visible
}
ed.addEventListener('pointerup', endDrag);
ed.addEventListener('pointercancel', endDrag);
ed.addEventListener('wheel', e=>{
  if(crop) return;
  if(!state.img) return;
  e.preventDefault();
  const f = Math.exp(-e.deltaY*0.0011);
  state.img.w = Math.min(600, Math.max(5, state.img.w*f));
  markW(); syncControls(); scheduleDraws();
},{passive:false});

/* ---- image crop (image-space rect, rotation aware) ---- */
let crop=null, cropDrag=null;
function cmin(v,a,b){ return v<a?a:(v>b?b:v); }
function cropOff(){ crop=null; cropDrag=null;
  const b=$('#cropBar'); if(b) b.classList.remove('show'); }
function cropGeom(){
  const im=state.img; if(!im || !crop) return null;
  const ow=im.bmp.width, oh=im.bmp.height;
  const aspect=oh/ow;
  const iw=im.w*edBox.s, ih=im.w*aspect*edBox.s;
  const a=im.rot*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  const [ix,iy]=mm2e(im.cx, im.cy);
  return {ow, oh, iw, ih, ix, iy, c, s,
    x0:(crop.px/ow-0.5)*iw, y0:(crop.py/oh-0.5)*ih,
    x1:((crop.px+crop.pw)/ow-0.5)*iw, y1:((crop.py+crop.ph)/oh-0.5)*ih};
}
function cropHit(px,py){
  const g=cropGeom(); if(!g) return null;
  const dx=px-g.ix, dy=py-g.iy;
  const lx=g.c*dx + g.s*dy, ly=-g.s*dx + g.c*dy;
  if(Math.hypot(lx-g.x0, ly-g.y0)<14*dpr) return {h:'tl', lx, ly};
  if(Math.hypot(lx-g.x1, ly-g.y1)<14*dpr) return {h:'br', lx, ly};
  if(lx>=g.x0 && lx<=g.x1 && ly>=g.y0 && ly<=g.y1) return {h:'in', lx, ly};
  return {h:'out', lx, ly};
}
$('#cropBtn').addEventListener('click', ()=>{
  const im=state.img; if(!im) return toast('먼저 이미지를 업로드하세요');
  if(crop){ cropOff(); drawEditor(); return; }
  crop={px:0, py:0, pw:im.bmp.width, ph:im.bmp.height};
  $('#cropBar').classList.add('show');
  ed.style.cursor='crosshair';
  drawEditor();
});
$('#cropCancel').addEventListener('click', ()=>{ cropOff(); drawEditor(); });
$('#cropApply').addEventListener('click', async ()=>{
  const im=state.img; if(!im || !crop) return;
  const ow=im.bmp.width, oh=im.bmp.height;
  const {px,py,pw,ph}=crop;
  try{
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(pw)); c.height=Math.max(1,Math.round(ph));
    c.getContext('2d').drawImage(im.bmp, px,py,pw,ph, 0,0,c.width,c.height);
    const nb=await createImageBitmap(c);
    const rcx=(px+pw/2-ow/2)/ow*im.w;
    const rcy=(py+ph/2-oh/2)/oh*(im.w*oh/ow);
    const a=im.rot*Math.PI/180, ca=Math.cos(a), sa=Math.sin(a);
    im.cx += rcx*ca - rcy*sa;
    im.cy += rcx*sa + rcy*ca;
    im.w = im.w*pw/ow;
    im._userW = im.w;
    im.bmp=nb;
    cropOff(); syncControls(); scheduleDraws();
    toast('크롭 적용됨 ('+Math.round(pw)+'×'+Math.round(ph)+'px)','ok');
  }catch(err){ console.error(err); toast('크롭 실패: '+err.message,'err'); }
});

let drawQueued=false;
function scheduleDraws(){
  if(drawQueued) return; drawQueued=true;
  requestAnimationFrame(()=>{ drawQueued=false; layoutEditor(); rebuildTexture(); drawPagePrev();
    if(window.__mockupDraw) __mockupDraw(); });   // photoreal mockup (#10) follows design ver
}
onStateChange(scheduleDraws);          // store -> view subscription (S4)
