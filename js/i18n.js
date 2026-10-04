/* ============================================================
   i18n.js — simple auto-localization (ko / ja / en)
   · Detect: ?lang= > localStorage.mtLang > navigator.language
   · Scope (v1): static controls — buttons, headings, labels,
     options, short single-node hints. Long help paragraphs and
     runtime toasts stay Korean (documented scope).
   · Mechanism: key = exact Korean string; swap text nodes in
     place, remember originals so switching back is lossless.
   ============================================================ */
(function () {
  'use strict';
  const D = {
    /* ---- header ---- */
    '11oz 머그컵':            { ja: '11oz マグカップ', en: '11oz Mug' },
    '템플릿 메이커':          { ja: 'テンプレートメーカー', en: 'Template Maker' },
    '3D 미리보기 · 인쇄용 PDF · 100% 브라우저 (서버 없음)': { ja: '3Dプレビュー · 印刷用PDF · ブラウザ内完結（サーバー不要）', en: '3D preview · Print-ready PDF · 100% in-browser (no server)' },
    '인쇄 설정':              { ja: '印刷設定', en: 'Print Setup' },
    '사용법 · 인쇄 팁':       { ja: '使い方 · 印刷のコツ', en: 'Help · Print tips' },

    /* ---- tool rail ---- */
    '작업':                   { ja: 'ツール', en: 'Tools' },
    '드래그=이동 · 휠=크기 · 핸들=리사이즈': { ja: 'ドラッグ=移動 · ホイール=サイズ · ハンドル=リサイズ', en: 'Drag=move · Wheel=size · Handles=resize' },
    '업로드':                 { ja: 'アップロード', en: 'Upload' },
    '채우기':                 { ja: 'フィット', en: 'Fill' },
    '가운데':                 { ja: '中央', en: 'Center' },
    '크롭':                   { ja: '切り抜き', en: 'Crop' },
    '삭제':                   { ja: '削除', en: 'Delete' },

    /* ---- template card ---- */
    '템플릿':                 { ja: 'テンプレート', en: 'Template' },
    '205 × 87 mm — 표준 11oz 풀랩 (기본)': { ja: '205 × 87 mm — 標準 11oz フルラップ（既定）', en: '205 × 87 mm — Standard 11oz full wrap (default)' },
    '사용자 지정…':           { ja: 'カスタム…', en: 'Custom…' },
    '핸들 노치':              { ja: 'ハンドルノッチ', en: 'Handle notch' },
    '가로(mm)':               { ja: '幅 (mm)', en: 'Width (mm)' },
    '세로(mm)':               { ja: '高さ (mm)', en: 'Height (mm)' },
    '적용':                   { ja: '適用', en: 'Apply' },

    /* ---- design card ---- */
    '디자인':                 { ja: 'デザイン', en: 'Design' },
    '+ 새':                   { ja: '+ 新規', en: '+ New' },
    '복제':                   { ja: '複製', en: 'Duplicate' },
    '변형':                   { ja: 'トランスフォーム', en: 'Transform' },
    '정렬':                   { ja: '整列', en: 'Align' },
    '취소':                   { ja: 'キャンセル', en: 'Cancel' },
    '크기':                   { ja: 'サイズ', en: 'Size' },
    '회전':                   { ja: '回転', en: 'Rotate' },
    '이미지를 놓아주세요':    { ja: '画像をドロップしてください', en: 'Drop an image here' },

    /* ---- hints under editor ---- */
    '이미지 넣는 법 · 11oz 크기 참고': { ja: '画像の入れ方 · 11oz サイズ参考', en: 'How to add images · 11oz size guide' },
    '11oz 기준':              { ja: '11oz 基準', en: '11oz reference' },
    '높이 약 9.5cm · 지름 약 8.2cm (프린터/press에 따라 ±몇 mm 보정). 실측 재단 크기는 “사용자 지정”으로.':
      { ja: '高さ約9.5cm · 直径約8.2cm（プリンター/プレスにより±数mm）。実測裁断サイズは「カスタム」で。', en: 'Height ≈9.5cm · diameter ≈8.2cm (±few mm by printer/press). Use “Custom” for measured cut size.' },

    /* ---- render card ---- */
    '렌더링':                 { ja: 'レンダリング', en: 'Rendering' },
    '클릭해서 크게 보기':     { ja: 'クリックで拡大', en: 'Click to enlarge' },
    '턴테이블':               { ja: 'ターンテーブル', en: 'Turntable' },
    '3D 모델 보기 (GLB)':     { ja: '3Dモデルを見る (GLB)', en: 'View 3D model (GLB)' },
    '내보내기':                { ja: '書き出し', en: 'Export' },
    '내보내기…':               { ja: '書き出し…', en: 'Export…' },
    '현재 디자인':              { ja: '現在のデザイン', en: 'Current design' },
    '목록 전체':                { ja: 'リスト全体', en: 'Whole list' },
    'PDF 내보내기':             { ja: 'PDFを書き出す', en: 'Export PDF' },
    '합본 PDF 내보내기':        { ja: '合本PDFを書き出す', en: 'Export merged PDF' },
    '범위':                    { ja: '範囲', en: 'Scope' },
    '용지':                    { ja: '用紙', en: 'Paper' },
    '미리보기':                 { ja: 'プレビュー', en: 'Preview' },
    '3D 모델 미리보기':        { ja: '3Dモデルプレビュー', en: '3D model preview' },
    '느리게':                 { ja: 'ゆっくり', en: 'Slow' },
    '보통':                   { ja: '普通', en: 'Medium' },
    '빠르게':                 { ja: '速い', en: 'Fast' },
    '🖱️ 드래그=회전(상하=시점 고도) · Shift/우클릭 드래그=이동 · Ctrl 드래그=기울임 · 휠=줌 · 더블클릭=리셋':
      { ja: '🖱️ ドラッグ=回転（上下=視点高さ） · Shift/右ドラッグ=移動 · Ctrlドラッグ=傾き · ホイール=ズーム · ダブルクリック=リセット', en: '🖱️ Drag=rotate (up/down=view height) · Shift/right-drag=pan · Ctrl-drag=tilt · Wheel=zoom · Double-click=reset' },
    '🖱️ 드래그=회전 · Shift/우클릭=이동 · Ctrl=기울임 · 휠=줌 · 더블클릭=리셋':
      { ja: '🖱️ ドラッグ=回転 · Shift/右=移動 · Ctrl=傾き · ホイール=ズーム · ダブルクリック=リセット', en: '🖱️ Drag=rotate · Shift/right=pan · Ctrl=tilt · Wheel=zoom · Double-click=reset' },

    /* ---- layers ---- */
    '레이어':                 { ja: 'レイヤー', en: 'Layers' },
    '위=화면 위 · 클릭=선택 · Shift+클릭=복수(그룹 정렬) · W=화이트 투명':
      { ja: '上=画面上 · クリック=選択 · Shift+クリック=複数（グループ整列） · W=ホワイト透過', en: 'Top=front · Click=select · Shift+click=multi (group align) · W=white to transparent' },
    '이미지를 업로드하면 여기에 레이어가 생깁니다':
      { ja: '画像をアップロードするとここにレイヤーが表示されます', en: 'Upload images to see layers here' },

    /* ---- output card ---- */
    '출력':                   { ja: '出力', en: 'Output' },
    '100% 실제 크기':         { ja: '100% 実寸', en: '100% actual size' },
    '재단선 포함 · A4 · 옅게 (기본) · 세로 배치 · 1개 · 미러':
      { ja: '裁断線あり · A4 · 淡色（既定） · 縦配置 · 1枚 · ミラー', en: 'Cut lines · A4 · light (default) · portrait · 1-up · mirror' },
    '인쇄 설정…':             { ja: '印刷設定…', en: 'Print setup…' },
    '모드 · 용지 · 마크 · 배치 · 미리보기 · PDF/DXF — 전부 다이얼로그에서':
      { ja: 'モード · 用紙 · マーク · 配置 · プレビュー · PDF/DXF — すべてダイアログで', en: 'Mode · paper · marks · layout · preview · PDF/DXF — all in the dialog' },
    '임시 저장':              { ja: '一時保存', en: 'Stash' },
    '목록에 쌓고 한번에':     { ja: 'リストに貯めて一括処理', en: 'Stack in a list, export at once' },
    '＋ 임시 저장':           { ja: '＋ 一時保存', en: '＋ Stash' },
    '임시 저장 목록':         { ja: '一時保存リスト', en: 'Stash list' },
    '전체 내보내기':          { ja: 'すべて書き出し', en: 'Export all' },
    '닫기 ✕':                 { ja: '閉じる ✕', en: 'Close ✕' },

    /* ---- save / batch panel ---- */
    '💾 저장 패널':           { ja: '💾 保存パネル', en: '💾 Save panel' },
    '일괄 내보내기':          { ja: '一括書き出し', en: 'Batch export' },
    '방식':                   { ja: '方法', en: 'Method' },
    '합본 PDF (한 장에 배치)': { ja: '結合PDF（1ページに配置）', en: 'Combined PDF (one sheet)' },
    '개별 PDF (ZIP)':         { ja: '個別PDF（ZIP）', en: 'Separate PDFs (ZIP)' },
    '등록 마크(기기)':        { ja: 'レジストレーションマーク（機器）', en: 'Registration marks (device)' },
    '실루엣 Type 1':          { ja: 'Silhouette Type 1', en: 'Silhouette Type 1' },
    '브라더 스캔앤컷 DX':      { ja: 'Brother ScanNCut DX', en: 'Brother ScanNCut DX' },
    '용지':                   { ja: '用紙', en: 'Paper' },
    '합본: 임시 저장들을 세로로 재배치한 단일 PDF — 작업별 디자인·미러는 각자 설정 그대로, 마크·용지는 아래 선택':
      { ja: '結合: 一時保存を縦に並べた単一PDF — 作業ごとのデザイン・ミラーは各自の設定、マーク・用紙は下で選択', en: 'Combined: one PDF restacking your stashes — per-job design/mirror kept as-is; pick marks/paper below' },
    '내보내기':               { ja: '書き出し', en: 'Export' },
    '모드 · 용지 · 마크 · 배치 — 미리보기에 바로 반영 · 출력은 100% 실제 크기':
      { ja: 'モード · 用紙 · マーク · 配置 — プレビューに即反映 · 出力は100%実寸', en: 'Mode · paper · marks · layout — live in preview · output at 100% actual size' },

    /* ---- print dialog ---- */
    '인쇄 내용':              { ja: '印刷内容', en: 'Print content' },
    '재단선 포함 · A4 · 옅게 (기본)': { ja: '裁断線あり · A4 · 淡色（既定）', en: 'Cut lines · A4 · light (default)' },
    '출력 모드':              { ja: '出力モード', en: 'Output mode' },
    '재단선 포함':            { ja: '裁断線あり', en: 'With cut lines' },
    '인식 마크만 (실루엣/스캔앤컷)': { ja: '認識マークのみ（Silhouette/ScanNCut）', en: 'Recognition marks only (Silhouette/ScanNCut)' },
    '재단선 색':              { ja: '裁断線の色', en: 'Cut-line color' },
    '아주 옅게':              { ja: 'とても薄く', en: 'Very light' },
    '옅게 (기본)':            { ja: '薄く（既定）', en: 'Light (default)' },
    '기기':                   { ja: '機器', en: 'Device' },
    '실루엣 (Type 1)':        { ja: 'Silhouette（Type 1）', en: 'Silhouette (Type 1)' },
    '마크·DXF 안내':          { ja: 'マーク・DXF の案内', en: 'Marks & DXF guide' },
    '배치':                   { ja: '配置', en: 'Layout' },
    '세로 배치 · 1개 · 미러':  { ja: '縦配置 · 1枚 · ミラー', en: 'Portrait · 1-up · mirror' },
    '자동':                   { ja: '自動', en: 'Auto' },
    '세로':                   { ja: '縦', en: 'Portrait' },
    '가로':                   { ja: '横', en: 'Landscape' },
    '개수':                   { ja: '枚数', en: 'Count' },
    '1개':                    { ja: '1枚', en: '1-up' },
    '2개':                    { ja: '2枚', en: '2-up' },
    '3개':                    { ja: '3枚', en: '3-up' },
    '좌우 반전(미러) 인쇄':   { ja: '左右反転（ミラー）印刷', en: 'Mirror print (flip horizontal)' },
    '배치별 디자인':          { ja: '配置ごとのデザイン', en: 'Design per slot' },
    'A4 · 세로 배치 · 1개 · 재단선 인쇄 · 미러':
      { ja: 'A4 · 縦配置 · 1枚 · 裁断線印刷 · ミラー', en: 'A4 · portrait · 1-up · cut lines · mirror' },
    'PDF 내보내기':           { ja: 'PDF 書き出し', en: 'Export PDF' },
    'DXF 내보내기 (컷 외곽)':  { ja: 'DXF 書き出し（カット外形）', en: 'Export DXF (cut outline)' },
    'A4 세로 배치 · 1개  ·  여백 확인 ✓': { ja: 'A4 縦配置 · 1枚  ·  余白確認 ✓', en: 'A4 portrait · 1-up · margins ✓' },

    /* ---- footer ---- */
    '브라우저 안에서만 동작합니다 — 업로드한 이미지가 어디에도 전송되지 않습니다. ·':
      { ja: 'ブラウザ内でのみ動作 — アップロード画像はどこにも送信されません ·', en: 'Runs entirely in your browser — uploaded images are never sent anywhere ·' },

    /* ---- help modal (headings + short notes only, v1) ---- */
    '기본 사용 흐름':         { ja: '基本の流れ', en: 'Basic workflow' },
    '인쇄 요령':              { ja: '印刷のコツ', en: 'Print tips' },
    '앞면/뒷면 가이드':       { ja: '前面/裏面ガイド', en: 'Front/back guides' },
    '인쇄 설정 다이얼로그':   { ja: '印刷設定ダイアログ', en: 'Print setup dialog' },
    '디자인·레이어':          { ja: 'デザイン·レイヤー', en: 'Design & layers' },
    '작업창·렌더링·임시저장': { ja: '作業窓·レンダリング·一時保存', en: 'Workspace · rendering · stash' },
    '모드 1 — 재단선 포함 (가위/재단기용)': { ja: 'モード1 — 裁断線あり（はさみ/トリマー用）', en: 'Mode 1 — With cut lines (scissors/trimmer)' },
    '모드 2 — 인식 마크만 인쇄 (절취선 없음)': { ja: 'モード2 — 認識マークのみ（裁断線なし）', en: 'Mode 2 — Recognition marks only (no cut lines)' },
    '튜닝 팁':                { ja: '調整のコツ', en: 'Tuning tips' },
    '3D 뷰:':                 { ja: '3Dビュー:', en: '3D view:' },
    '드래그':                 { ja: 'ドラッグ', en: 'Drag' },
    'Shift/우클릭 드래그':     { ja: 'Shift/右ドラッグ', en: 'Shift/right-drag' },
    'Ctrl 드래그':            { ja: 'Ctrlドラッグ', en: 'Ctrl-drag' },
    '휠':                     { ja: 'ホイール', en: 'Wheel' },
    '더블클릭':               { ja: 'ダブルクリック', en: 'Double-click' },
    '단일 ZIP':               { ja: '単一 ZIP', en: 'one ZIP' },
    '저장 패널':              { ja: '保存パネル', en: 'save panel' },
    '한번에 내보내기':        { ja: '一括書き出し', en: 'export all at once' },
    '100% (실제 크기)':       { ja: '100%（実寸）', en: '100% (actual size)' },
    'DXF 내보내기':           { ja: 'DXF 書き出し', en: 'DXF export' },
    '절취선을 인쇄하지 않습니다': { ja: '裁断線は印刷しません', en: 'Cut lines are not printed' },
    '세로만':                 { ja: '縦のみ', en: 'Portrait only' },
    '최대 2개':               { ja: '最大2枚', en: 'max 2-up' },
    '가로 최대 3개 / 세로 최대 2개': { ja: '横 最大3枚 / 縦 最大2枚', en: 'up to 3 across / 2 down' },
    '자동으로 개수를 줄이고 안내': { ja: '枚数を自動削減して案内', en: 'auto-reduces count and notifies' },
    '레시피 없음':            { ja: 'なし', en: 'none' },

    /* ---- R5: unified export list + support ---- */
    '내보내기 목록':          { ja: '書き出しリスト', en: 'Export list' },
    '디자인별 배치 개수 → 최소 용지로 한 번에': { ja: 'デザインごとに枚数指定 → 最少紙数で一括', en: 'Count per design → packed on minimum sheets' },
    '＋ 목록 추가':           { ja: '＋ リストに追加', en: '+ Add to list' },
    '목록':                   { ja: 'リスト', en: 'List' },
    '개':                     { ja: '枚', en: 'up' },
    '실루엣/브라더 컷 파일 포함 (DXF+SVG — ZIP으로 같이 저장)':
      { ja: 'Silhouette/Brother カットファイル同梱（DXF+SVG — ZIPで保存）', en: 'Include Silhouette/Brother cut files (DXF+SVG — saved as ZIP)' },
    '💜 토스로 후원':          { ja: '💜 トスで支援', en: '💜 Donate via Toss' },
    '💛 카카오페이 후원':       { ja: '💛 カカオペイで支援', en: '💛 Donate via KakaoPay' },
    '🔓 후원자 코드':           { ja: '🔓 支援者コード', en: '🔓 Supporter code' }
  };

  const LANGS = ['ko', 'ja', 'en'];
  let lang = 'ko';

  function detect() {
    try {
      const q = new URLSearchParams(location.search).get('lang');
      if (q && LANGS.includes(q)) { localStorage.setItem('mtLang', q); return q; }
      const s = localStorage.getItem('mtLang');
      if (s && LANGS.includes(s)) return s;
    } catch (e) { /* private mode */ }
    const n = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    if (n.startsWith('ko')) return 'ko';
    if (n.startsWith('ja')) return 'ja';
    return 'en';
  }

  const SAFE = /^(BUTTON|H1|H2|H3|H4|SUMMARY|OPTION|LABEL|LEGEND|A|SPAN|TD|TH|LI|DIV|P)$/;

  function translatable(node) {
    const el = node.parentElement;
    if (!el) return null;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CANVAS' || el.isContentEditable) return null;
    const t = node.textContent.trim();
    if (!t || !D[t]) return null;
    if (!SAFE.test(tag)) return null;
    // For generic containers, only swap when the node is the sole text (avoid fragment jigsaw)
    if ((tag === 'DIV' || tag === 'P' || tag === 'SPAN' || tag === 'LI' || tag === 'A') &&
        el.textContent.trim() !== t) return null;
    return { el, orig: node.textContent, want: t };
  }

  function applyOne(node, info) {
    if (lang === 'ko') { node.textContent = info.orig; return; }
    const t = info.orig;
    const idx = t.indexOf(info.want);
    if (idx < 0) return;
    const value = D[info.want][lang];
    if (!value) return;
    node.textContent = t.slice(0, idx) + value + t.slice(idx + info.want.length);
  }

  function scan(root) {
    if (lang === 'ko' && !root.__i18nTouched) {
      // nothing to restore if we never translated; still mark
    }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) { return n.parentElement ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
    });
    let n, guard = 0;
    const nodes = [];
    while ((n = tw.nextNode()) && guard++ < 20000) nodes.push(n);
    for (const node of nodes) {
      const info = translatable(node);
      if (!info) continue;
      if (!info.el.__i18nOrig) info.el.__i18nOrig = new Map();
      const store = info.el.__i18nOrig;
      if (!store.has(node)) store.set(node, info.orig);
      else info.orig = store.get(node);
      applyOne(node, info);
    }
  }

  function apply() {
    lang = detect();
    document.documentElement.lang = lang;
    const titleKey = document.title.replace(/\s*—.*$/, '').trim();
    scan(document.body);
    if (titleKey && D[titleKey]) {
      document.title = lang === 'ko' ? titleKey : (D[titleKey][lang] || titleKey);
    }
    window.__i18n = { lang: lang, apply: apply, dict: D };
  }

  function boot() {
    apply();
    // catch UI built at runtime (layer rows, toasts that match static dict entries)
    let t = null;
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => { try { scan(document.body); } catch (e) {} }, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    // re-apply if the page language changes elsewhere
    window.addEventListener('storage', (e) => { if (e.key === 'mtLang') apply(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
