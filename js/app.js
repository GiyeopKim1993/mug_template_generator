/* ---------- registration marks: decode now that drawPagePrev() exists ---------- */
for(const k of Object.keys(MARK_DATA)){
  const im = new Image();
  im.onload = ()=>{ drawPagePrev(); };
  im.src = MARK_DATA[k];
  MARK_IMGS[k] = im;
}

/* ---------- init ---------- */
function init(){
  sizeStage();
  clampView();
  layoutEditor();
  rebuildTexture();
  syncActive();
  renderDesignSel();
  renderLayers();
  syncControls();
  updateMarkHint();
  drawPagePrev();
  updateExportUI();
  requestAnimationFrame(loop3d);
}
init();
