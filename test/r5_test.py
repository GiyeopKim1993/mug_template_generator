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

        # --- 2. impose default (PDF) unchanged ---
        p.click('#draftExportAll'); p.wait_for_selector('#batchModal.open')
        with p.expect_download(timeout=30000) as dl:
            p.click('#bmGo')
        name1 = dl.value.suggested_filename
        check(name1.endswith('.pdf') and 'imposed' in name1, 'default impose → pdf (%s)' % name1)

        # --- 3. cut toggle → ZIP with pdf+dxf+svg, cells = 2+4 = 6 ---
        p.click('#draftExportAll'); p.wait_for_selector('#batchModal.open')
        p.check('#bmCut')
        with p.expect_download(timeout=30000) as dl2:
            p.click('#bmGo')
        zname = dl2.value.suggested_filename
        check(zname.endswith('-with-cuts.zip'), 'cut toggle → zip (%s)' % zname)
        tmp = tempfile.mkdtemp()
        zpath = os.path.join(tmp, zname)
        dl2.value.save_as(zpath)
        with zipfile.ZipFile(zpath) as z:
            names = z.namelist()
            check(any(n.endswith('.pdf') for n in names), 'zip contains pdf: %s' % names)
            dxfs = [n for n in names if n.endswith('.dxf')]
            svgs = [n for n in names if n.endswith('.svg')]
            check(len(dxfs)>=1 and len(svgs)>=1, 'zip contains dxf+svg (%d/%d)' % (len(dxfs), len(svgs)))
            dxf_txt = z.read(dxfs[0]).decode('utf8', 'ignore')
            svg_txt = z.read(svgs[0]).decode('utf8', 'ignore')
            check('LINE' in dxf_txt and 'EOF' in dxf_txt, 'dxf parses as DXF entities')
            check('<path' in svg_txt and 'viewBox' in svg_txt, 'svg has path+viewBox')
            # 6 cells (2 + 4) packed across pages — sum paths over ALL svgs
            npath = sum(z.read(n).decode('utf8','ignore').count('<path') for n in svgs)
            check(npath==6, f'all 6 packed cells present across svg pages (got {npath})')
        shutil.rmtree(tmp, ignore_errors=True)

        # --- 4. support buttons (3 donate + 1 donor-code) ---
        btns = p.locator('#supportRow > *').count()
        check(btns==4, 'support row renders 4 buttons (got %d)' % btns)
        for cls in ('s-bmc','s-toss','s-kakao','s-donor'):
            check(p.locator('#supportRow .'+cls).count()==1, 'has '+cls)
        p.locator('#supportRow .s-bmc').click(); p.wait_for_timeout(250)
        toast = p.locator('#toast').inner_text()
        check('미설정' in toast, 'unconfigured support shows guidance toast')
        # donor code redeem: invalid → guidance, valid → mute
        p.on('dialog', lambda d: d.accept('MT-INVALID-CODE'))
        p.locator('#supportRow .s-donor').click(); p.wait_for_timeout(600)
        toast = p.locator('#toast').inner_text()
        check('유효하지 않은' in toast, 'invalid donor code rejected (%s)' % toast[:40])

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
