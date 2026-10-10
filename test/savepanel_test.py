# -*- coding: utf-8 -*-
"""Export in framed (sandboxed preview) vs top-level:
   framed -> save panel (downloads are silently blocked in sandbox),
   top-level -> direct download, no panel."""
import sys, pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent.resolve()
URL  = 'http://localhost:8080/index.html'
HOST = 'http://localhost:8080/test/sim-host.html'

def main():
    fails = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()

        # ---- top-level: direct download, NO panel ----
        ctx = b.new_context(viewport={'width':1400,'height':900}, accept_downloads=True)
        p = ctx.new_page(); errs=[]
        p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto(URL, wait_until='networkidle'); p.wait_for_timeout(800)
        with p.expect_download() as di:
            p.click('#printOpen'); p.wait_for_timeout(300); p.click('#exportBtn')
        dl = di.value
        print('top-level download:', dl.suggested_filename)
        if not dl.suggested_filename.endswith('.pdf'):
            fails.append('top-level export did not produce a pdf: '+dl.suggested_filename)
        panel = p.evaluate("document.getElementById('savePanel').classList.contains('open')")
        if panel: fails.append('top-level should NOT open save panel')
        p.click('#printClose'); p.wait_for_timeout(400)

        # ---- unified export: scope=list impose PDF (machine picker), NO zip mode ----
        for _ in range(2):
            p.click('#draftSaveBtn'); p.wait_for_timeout(250)
        p.click('#draftExportAll')
        p.wait_for_selector('#printModal.open')
        if p.locator('#paperSel').count() != 0:
            fails.append('letter select should be gone (A4 only)')
        p.click('#modeSeg button[data-v="mark"]')
        p.wait_for_function("!document.getElementById('printModal').classList.contains('busy')", timeout=30000)
        with p.expect_download() as di2:
            p.click('#exportBtn')
        n2 = di2.value.suggested_filename
        print('impose download:', n2)
        if not (n2.endswith('.pdf') and 'imposed' in n2 and 'brother' in n2):
            fails.append('bad impose filename: '+n2)
        if n2.endswith('.zip'):
            fails.append('zip must be gone from export: '+n2)
        with open(di2.value.path(),'rb') as f:
            if f.read(5) != b'%PDF-': fails.append('impose file is not a PDF')
        ctx.close()

        # ---- framed (sandbox preview): save panel instead of silent failure ----
        ctx = b.new_context(viewport={'width':1400,'height':900}, accept_downloads=True)
        p = ctx.new_page()
        p.on('pageerror', lambda e: errs.append(str(e)))
        dls = []
        p.on('download', lambda d: dls.append(d.suggested_filename))
        p.goto(HOST, wait_until='networkidle'); p.wait_for_selector('iframe#pv'); p.wait_for_timeout(900)
        fr = p.frame_locator('#pv')
        fr.locator('#printOpen').click(); p.wait_for_timeout(400)
        fr.locator('#exportBtn').click(); p.wait_for_timeout(2500)
        body = p.frame_locator('#pv')
        if not body.locator('#savePanel.open').is_visible():
            fails.append('framed export did not open save panel')
        # panel content: preview iframe + url field + buttons
        n_if = body.locator('#savePanel iframe').count()
        n_btn = body.locator('#savePanel .sp-btns button').count()
        if n_if < 1: fails.append('save panel missing preview iframe')
        if n_btn < 2: fails.append(f'save panel buttons too few: {n_btn}')
        # close via button
        body.locator('#spClose').click(); p.wait_for_timeout(300)
        if body.locator('#savePanel.open').count() != 0:
            fails.append('save panel did not close')
        # close print modal so sidebar is reachable again
        body.locator('#printClose').click(); p.wait_for_timeout(400)
        # framed list export: unified dialog (scope=list) -> panel with imposed PDF
        for _ in range(3):
            body.locator('#draftSaveBtn').click(); p.wait_for_timeout(200)
        body.locator('#draftExportAll').click()
        body.locator('#printModal.open').wait_for(timeout=6000)
        if body.locator('#bmCutRow').count() < 1:
            fails.append('list scope should show cut-file row')
        if body.locator('#paperSel').count() != 0:
            fails.append('letter select should be gone (A4 only)')
        for _ in range(100):
            if body.locator('#printModal.busy').count() == 0: break
            p.wait_for_timeout(300)
        body.locator('#exportBtn').click(); p.wait_for_timeout(5000)
        if not body.locator('#savePanel.open').is_visible():
            fails.append('framed impose did not open save panel')
        nm = body.locator('#savePanel .sp-name').inner_text() if body.locator('#savePanel.open').count() else ''
        if not (nm.endswith('.pdf') and 'imposed' in nm):
            fails.append(f'impose panel should show imposed pdf, got: {nm}')
        print('framed impose panel name:', nm)
        # panel v2: url field on top + 새 창 button + drag link
        if body.locator('#savePanel .sp-url').count() < 1:
            fails.append('save panel missing url field')
        if body.locator('#savePanel .sp-drag').count() < 1:
            fails.append('save panel missing drag link')
        body.locator('#spClose').click(); p.wait_for_timeout(300)
        # then scope=-single -> panel with a plain PDF (zip removed entirely)
        body.locator('#printClose').click(); p.wait_for_timeout(300)
        body.locator('#printOpen').click()
        body.locator('#printModal.open').wait_for(timeout=6000)
        body.locator('#scopeSeg button[data-v="single"]').click()
        if body.locator('#bmCutRow').is_visible():
            fails.append('cut-file row should hide in single scope')
        body.locator('#exportBtn').click(); p.wait_for_timeout(4000)
        nm2 = body.locator('#savePanel .sp-name').inner_text() if body.locator('#savePanel.open').count() else ''
        if not nm2.endswith('.pdf'):
            fails.append(f'single panel should show a pdf (no zip), got: {nm2}')
        print('framed single panel name:', nm2)
        if dls: fails.append(f'framed context unexpectedly downloaded: {dls}')
        ctx.close()

        print('JS errors:', errs if errs else 'none')
        if errs: fails.append('JS errors: '+'; '.join(errs))
        b.close()

    if fails:
        print('FAILURES:')
        for f in fails: print(' -', f)
        sys.exit(1)
    print('SAVE PANEL TESTS OK — top-level direct download ✓ framed panel ✓ list impose (no zip) ✓')

if __name__ == '__main__':
    main()
