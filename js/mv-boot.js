/* mv-boot.js — inject model-viewer (ES module) over http(s) only;
   modules are CORS-blocked on file://, so file:// gets an inline notice instead. */
if (location.protocol !== 'file:') {
  var _mv = document.createElement('script');
  _mv.type = 'module';
  _mv.src = 'js/model-viewer.js?v=20261006c';
  document.body.appendChild(_mv);
} else {
  document.addEventListener('DOMContentLoaded', function () {
    var st = document.getElementById('stage');
    if (st && !document.getElementById('mug3d')) {
      var n = document.createElement('div');
      n.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9fb2d8;font:13px/1.6 system-ui;text-align:center;padding:24px';
      n.textContent = '3D 렌더링은 http(s) 주소로 열었을 때만 동작합니다 (file:// 는 브라우저 모듈 제한)';
      st.appendChild(n);
    }
  });
}
