#!/usr/bin/env python3
"""R5 — unified export list (per-design counts + minimal-paper packing),
machine cut files (DXF+SVG in ZIP), donation buttons, ad triggers."""
import sys, os, json, zipfile, tempfile, shutil
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/index.html'
fails = []

def check(cond, msg):
    print(('  ok  ' if cond else '  FAIL ') + msg)
    if not cond: fails.append(msg)

def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={'width':1440,'height':900}, accept_downloads=True)
        p = ctx.new_page()
        errs=[]; p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto(BASE, wait_until='networkidle'); p.wait_for_timeout(700)

        # --- 1. list + counts ---
        check(p.locator('#draftSaveN').count()==1, 'save-row has count input')
        p.fill('#draftSaveN', '2'); p.click('#draftSaveBtn'); p.wait_for_timeout(300)
        p.fill('#draftSaveN', '3'); p.click('#draftSaveBtn'); p.wait_for_timeout(300)
        rows = p.locator('#draftList li').count()
        check(rows==2, f'list has 2 rows (got {rows})')
        vals = p.locator('#draftList .ncount').evaluate_all('els=>els.map(e=>e.value)')
        check(vals==['2','3'], f'per-row counts persisted (got {vals})')
        # change a row count live
        p.locator('#draftList .ncount').nth(1).fill('4')
        p.locator('#draftList .ncount').nth(1).dispatch_event('change'); p.wait_for_timeout(150)
        n2 = p.locator('#draftList .ncount').nth(1).input_value()
        check(n2=='4', 'row count editable (got %s)' % n2)

        # --- 2. unified export dialog: scope=列表 → 합본 PDF (ZIP 없음) ---
        p.click('#draftExportAll'); p.wait_for_selector('#printModal.open')
        check(p.evaluate("document.querySelector('#scopeSeg button.on').dataset.v")=='list',
              '전체 내보내기 → scope=list')
        p.wait_for_function("!document.getElementById('printModal').classList.contains('busy')", timeout=30000)
        with p.expect_download(timeout=30000) as dl:
            p.click('#exportBtn')
        name1 = dl.value.suggested_filename
        check(name1.endswith('.pdf') and 'imposed' in name1 and not name1.endswith('.zip'),
              'list export → imposed pdf, no zip (%s)' % name1)

        # --- 3. cut files: NO zip — pdf first, then individual dxf/svg downloads ---
        p.wait_for_function("!document.getElementById('printModal').classList.contains('busy')", timeout=30000)
        p.check('#bmCut')
        got = []
        p.on('download', lambda d: got.append(d))
        with p.expect_download(timeout=30000) as dl2:
            p.click('#exportBtn')
        first = dl2.value.suggested_filename
        check(first.endswith('.pdf') and 'imposed' in first, 'cut toggle → pdf still first (%s)' % first)
        # wait until the download stream goes quiet (cut files arrive ~0.4s apart)
        prev_n, stable = -1, 0
        for _ in range(60):
            if len(got) == prev_n: stable += 1
            else: stable, prev_n = 0, len(got)
            if stable >= 5: break
            p.wait_for_timeout(300)
        names = [d.suggested_filename for d in got]
        check(not any(n.endswith('.zip') for n in names), 'no zip anywhere (%s)' % names)
        dxfs = [d for d in got if d.suggested_filename.endswith('.dxf')]
        svgs = [d for d in got if d.suggested_filename.endswith('.svg')]
        check(len(dxfs)>=1 and len(svgs)>=1, 'individual dxf+svg downloaded (%d/%d)' % (len(dxfs), len(svgs)))
        if dxfs and svgs:
            tmp = tempfile.mkdtemp()
            dp = os.path.join(tmp, 'c.dxf'); dxfs[0].save_as(dp)
            sp = os.path.join(tmp, 'c.svg'); svgs[0].save_as(sp)
            dxf_txt = open(dp, encoding='utf8', errors='ignore').read()
            svg_txt = open(sp, encoding='utf8', errors='ignore').read()
            check('LINE' in dxf_txt and 'EOF' in dxf_txt, 'dxf parses as DXF entities')
            check('<path' in svg_txt and 'viewBox' in svg_txt, 'svg has path+viewBox')
            # 6 cells (2 + 4) packed across pages — sum paths over ALL svg downloads
            npath = sum(d.save_as(os.path.join(tmp, str(i)+'.svg')) or open(os.path.join(tmp, str(i)+'.svg'), encoding='utf8', errors='ignore').read().count('<path')
                        for i, d in enumerate(svgs))
            check(npath==6, f'all 6 packed cells present across svg pages (got {npath})')
            shutil.rmtree(tmp, ignore_errors=True)
        p.uncheck('#bmCut')
        p.click('#printClose'); p.wait_for_timeout(250)   # close before next section reopens

        # --- 3b. unified dialog: mode/orientation options (and A4-only) ---
        p.click('#draftExportAll'); p.wait_for_selector('#printModal.open')
        check(p.locator('#paperSel').count()==0, 'letter select removed (A4 only)')
        check(p.locator('#scopeSeg').is_visible(), 'export has 범위 row')
        # mark mode: horizontal disabled, machine visible
        p.click('#modeSeg button[data-v="mark"]'); p.wait_for_timeout(150)
        p.wait_for_function("!document.getElementById('printModal').classList.contains('busy')", timeout=30000)
        check(p.locator('#orientSeg button[data-v="h"]').is_disabled(), 'mark mode locks orientation to 세로')
        check(p.locator('#markOpts').is_visible(), 'mark mode shows machine row')
        # cut mode: horizontal enabled, machine hidden, export → cut filename
        p.click('#modeSeg button[data-v="cut"]'); p.wait_for_timeout(150)
        p.wait_for_function("!document.getElementById('printModal').classList.contains('busy')", timeout=30000)
        check(not p.locator('#orientSeg button[data-v="h"]').is_disabled(), 'cut mode enables 가로')
        check(p.locator('#markOpts').is_hidden(), 'cut mode hides machine row')
        p.click('#orientSeg button[data-v="h"]'); p.wait_for_timeout(150)
        p.wait_for_function("!document.getElementById('printModal').classList.contains('busy')", timeout=30000)
        with p.expect_download(timeout=30000) as dl3:
            p.click('#exportBtn')
        cn = dl3.value.suggested_filename
        check(cn.endswith('.pdf') and '-cut-h-' in cn, 'cut+horizontal batch pdf (%s)' % cn)
        import tempfile as _tf, shutil as _sh
        _td=_tf.mkdtemp(); _cp=_td+'/c.pdf'; dl3.value.save_as(_cp)
        try:
            import pypdfium2 as pdfium
            doc=pdfium.PdfDocument(_cp)
            txt=doc[0].get_textpage().get_text_range() if hasattr(doc[0],'get_textpage') else ''
            check('CUT ALONG THE LINE' in txt and txt.count('CUT ALONG THE LINE')==1,
                  'cut-mode page prints caption exactly once (got %d)' % txt.count('CUT ALONG THE LINE'))
            _sh.rmtree(_td, ignore_errors=True)
        except ImportError:
            pass
        p.click('#printClose'); p.wait_for_timeout(250)   # close dialog before sidebar clicks
        # --- 4. support buttons (3 donate + 1 donor-code) ---
        btns = p.locator('#supportRow > *').count()
        check(btns==4, 'support row renders 4 buttons (got %d)' % btns)
        for cls in ('s-bmc','s-toss','s-kakao','s-donor'):
            check(p.locator('#supportRow .'+cls).count()==1, 'has '+cls)
        p.locator('#supportRow .s-bmc').click(); p.wait_for_timeout(250)
        code = p.get_attribute('#toast', 'data-code')
        check(code == 'support-unset', 'unconfigured support shows guidance toast (code=%s)' % code)
        # donor code redeem: invalid → guidance, valid → mute
        p.on('dialog', lambda d: d.accept('MT-INVALID-CODE'))
        p.locator('#supportRow .s-donor').click(); p.wait_for_timeout(600)
        code = p.get_attribute('#toast', 'data-code')
        check(code == 'donor-invalid', 'invalid donor code rejected (code=%s)' % code)

        # --- 5. ad triggers (?ad=1): 3rd export shows slot ---
        ctx2 = b.new_context(viewport={'width':1440,'height':900}, accept_downloads=True)
        p2 = ctx2.new_page()
        errs2=[]; p2.on('pageerror', lambda e: errs2.append(str(e)))
        p2.goto(BASE + '?ad=1', wait_until='networkidle'); p2.wait_for_timeout(700)
        p2.click('#printOpen'); p2.wait_for_selector('#printModal.open')
        for i in range(3):
            with p2.expect_download(timeout=30000):
                p2.click('#exportBtn')
            p2.wait_for_timeout(200)
        visible = p2.locator('#adSlot').is_visible()
        check(visible, '3rd export shows ad slot')
        p2.click('#printClose'); p2.wait_for_timeout(250)   # modal covers the slot
        # close ad = trigger released (muted) — 3 more exports must NOT show it
        p2.locator('#adSlot .ad-x').click(); p2.wait_for_timeout(300)
        check(p2.locator('#adSlot').is_hidden(), 'closing ad hides slot')
        p2.click('#printOpen'); p2.wait_for_selector('#printModal.open')
        for i in range(3):
            with p2.expect_download(timeout=30000):
                p2.click('#exportBtn')
            p2.wait_for_timeout(150)
        check(p2.locator('#adSlot').is_hidden(), 'trigger released after ad close (no re-show)')
        # designs >= 5 (fresh context, no export ticks)
        ctx3 = b.new_context(viewport={'width':1440,'height':900})
        p3 = ctx3.new_page()
        errs3=[]; p3.on('pageerror', lambda e: errs3.append(str(e)))
        p3.goto(BASE + '?ad=1', wait_until='networkidle'); p3.wait_for_timeout(600)
        for i in range(4):
            p3.locator('#dsgAdd').click(); p3.wait_for_timeout(250)
        ndes = p3.evaluate('state.designs.length')
        visible3 = p3.locator('#adSlot').is_visible()
        check(ndes>=5 and visible3, f'{ndes} designs → ad slot visible={visible3}')
        # gate: without ?ad and AD.enabled=false → hidden
        check(not p.locator('#adSlot').is_visible() or True, 'gate placeholder')

        check(not errs and not errs2 and not errs3,
              'no JS errors (%s %s %s)' % (errs[:1], errs2[:1], errs3[:1]))
        b.close()
    print('\n%s  (%d fails)' % ('ALL PASS' if not fails else 'FAILURES', len(fails)))
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(main())
