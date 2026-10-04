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

        # ---- batch modal: impose PDF (machine picker) then per-draft ZIP ----
        for _ in range(2):
            p.click('#draftSaveBtn'); p.wait_for_timeout(250)
        p.click('#draftExportAll')
        p.wait_for_selector('#batchModal.open')
        p.click('#bmMachSeg button[data-v="brother"]')
        with p.expect_download() as di2:
            p.click('#bmGo')
        n2 = di2.value.suggested_filename
        print('impose download:', n2)
        if not (n2.endswith('.pdf') and 'imposed' in n2 and 'brother' in n2):
            fails.append('bad impose filename: '+n2)
        with open(di2.value.path(),'rb') as f:
            if f.read(5) != b'%PDF-': fails.append('impose file is not a PDF')
        p.click('#draftExportAll'); p.wait_for_selector('#batchModal.open')
        p.click('#bmModeSeg button[data-v="single"]')
        with p.expect_download() as di3:
            p.click('#bmGo')
        n3 = di3.value.suggested_filename
        print('zip download:', n3)
        if not n3.endswith('.zip'):
            fails.append('bad zip filename: '+n3)
        import zipfile as _zf
        with _zf.ZipFile(di3.value.path()) as z:
            nmz = z.namelist()
            if z.testzip() is not None or not any(x.endswith('-s1.pdf') for x in nmz):
                fails.append(f'zip contents bad: {nmz}')
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
        # framed batch: MODAL opens first — impose (default) -> panel with imposed PDF
        for _ in range(3):
            body.locator('#draftSaveBtn').click(); p.wait_for_timeout(200)
        body.locator('#draftExportAll').click()
        body.locator('#batchModal.open').wait_for(timeout=6000)
        if not body.locator('#bmMachRow').is_visible():
            fails.append('impose mode should show machine picker')
        body.locator('#bmGo').click(); p.wait_for_timeout(5000)
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
        # then single (ZIP) mode -> panel with zip
        body.locator('#draftExportAll').click()
        body.locator('#batchModal.open').wait_for(timeout=6000)
        body.locator('#bmModeSeg button[data-v="single"]').click()
        if body.locator('#bmMachRow').is_visible():
            fails.append('machine row should hide in single mode')
        body.locator('#bmGo').click(); p.wait_for_timeout(5000)
        nm2 = body.locator('#savePanel .sp-name').inner_text() if body.locator('#savePanel.open').count() else ''
        if not nm2.endswith('.zip'):
            fails.append(f'batch panel should show a zip, got: {nm2}')
        print('framed zip panel name:', nm2)
        if dls: fails.append(f'framed context unexpectedly downloaded: {dls}')
        ctx.close()

        print('JS errors:', errs if errs else 'none')
        if errs: fails.append('JS errors: '+'; '.join(errs))
        b.close()

    if fails:
        print('FAILURES:')
        for f in fails: print(' -', f)
        sys.exit(1)
    print('SAVE PANEL TESTS OK — top-level direct download ✓ framed panel ✓ zip batch ✓')

if __name__ == '__main__':
    main()
