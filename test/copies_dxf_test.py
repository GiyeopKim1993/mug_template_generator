import asyncio, os, sys
from playwright.async_api import async_playwright
from ui_helpers import open_print, close_print

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'shots')
os.makedirs(OUT, exist_ok=True)

async def main():
    errors = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1.5)
        page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        await page.goto('file://' + os.path.abspath(os.path.join(BASE, '..', 'index.html')))
        await page.wait_for_timeout(1200)
        await page.set_input_files('#fileIn', os.path.join(BASE, 'test.jpg'))
        await page.wait_for_timeout(900)

        # ---------- cut mode: 가로 3-up ----------
        await open_print(page)
        await page.click('#orientSeg button[data-v="h"]')
        await page.select_option('#copiesSel', '3')
        await page.wait_for_timeout(300)
        L = await page.evaluate("()=>{const L=currentLayout(); return {or:L.art.or, n:L.nCopies, fits:L.fits, xs:L.copies.map(r=>r.x), ys:L.copies.map(r=>r.y)};}")
        print('cut 가로 x3 layout:', L)
        assert L['or'] == 'h' and L['n'] == 3 and L['fits'], f'가로 3-up must fit: {L}'
        assert abs(L['ys'][1] - L['ys'][0] - 89) < 1e-6 and abs(L['ys'][2] - L['ys'][1] - 89) < 1e-6, 'stacked 87+2 gap'
        cap = await page.text_content('#prevCap')
        assert '3개' in cap, f'preview caption shows count: {cap!r}'
        fit = await page.text_content('#fitInfo')
        assert '3개' in fit, f'fit info shows count: {fit!r}'
        await page.screenshot(path=f'{OUT}/cd-01-cut-h-3up.png', full_page=True)

        # ---------- 세로 clamps copies to 2, disables option 3 ----------
        await open_print(page)
        await page.click('#orientSeg button[data-v="v"]')
        await page.wait_for_timeout(250)
        st = await page.evaluate("()=>({c:state.copies, or:currentLayout().art.or, dis3:document.querySelector('#copiesSel option[value=\"3\"]').disabled})")
        print('after 세로:', st)
        assert st['or'] == 'v' and st['c'] == 2 and st['dis3'] is True, f'세로 clamps to 2 + disables 3: {st}'

        # ---------- 가로 back: option 3 enabled again ----------
        await open_print(page)
        await page.click('#orientSeg button[data-v="h"]')
        en = await page.evaluate("()=>document.querySelector('#copiesSel option[value=\"3\"]').disabled")
        assert en is False, '가로 re-enables 3-up option'

        # ---------- PDF download with 3 copies ----------
        await open_print(page)
        await page.select_option('#copiesSel', '3')
        async with page.expect_download() as dinfo:
            await page.click('#exportBtn')
        dl = await dinfo.value
        pdf_path = os.path.join(OUT, 'multi3.pdf')
        await dl.save_as(pdf_path)
        print('pdf download:', dl.suggested_filename, os.path.getsize(pdf_path), 'bytes')
        assert '-x3' in dl.suggested_filename, f'filename carries x3: {dl.suggested_filename}'

        # ---------- mark mode: forced 세로, disabled buttons, dxf button ----------
        await open_print(page)
        await page.click('#modeSeg button[data-v="mark"]')
        await page.wait_for_timeout(300)
        seg = await page.evaluate("""()=>{
          const bs=[...document.querySelectorAll('#orientSeg button')];
          return {on: bs.find(b=>b.classList.contains('on')).dataset.v,
                  dis: bs.filter(b=>b.disabled).map(b=>b.dataset.v),
                  orient: state.orient,
                  dxfVis: document.querySelector('#pdfFcmBtn').style.display !== 'none',
                  expVis: document.querySelector('#exportBtn').style.display !== 'none',
                  expLab: document.querySelector('#exportBtn').textContent.trim(),
                  n: currentLayout().nCopies, or: currentLayout().art.or,
                  opt3: document.querySelector('#copiesSel option[value=\\"3\\"]').disabled};
        }""")
        print('mark mode segs:', seg)
        assert seg['on'] == 'v' and set(seg['dis']) == {'auto', 'h'}, f'only 세로 selectable: {seg}'
        assert seg['orient'] == 'v' and seg['or'] == 'v' and seg['n'] <= 2, f'mark forced vertical: {seg}'
        assert seg['dxfVis'] is True and seg['expVis'] is True and seg['opt3'] is True, f'pdf·fcm + pdf buttons visible, 3-up blocked: {seg}'
        await page.screenshot(path=f'{OUT}/cd-02-mark-vertical.png', full_page=True)

        # ---------- PDF · FCM download (single): reset copies to 1 first ----------
        await open_print(page)
        await page.select_option('#copiesSel', '1')
        await page.wait_for_timeout(250)
        dls1 = []
        page.on('download', lambda d: dls1.append(d))
        async with page.expect_download() as dinfo:
            await page.click('#pdfFcmBtn')
        await dinfo.value
        await page.wait_for_timeout(1500)      # fcm lands ~400ms after the pdf
        names1 = [d.suggested_filename for d in dls1]
        print('pdf·fcm single:', names1)
        assert any(n.endswith('.pdf') and 'brother' in n for n in names1), f'mark pdf in bundle: {names1}'
        assert any(n.endswith('.fcm') for n in names1), f'fcm in bundle: {names1}'
        assert not any(n.endswith('.dxf') for n in names1), f'no dxf anymore: {names1}'
        assert {n[:-4] for n in names1 if n.endswith('.fcm')} <= {n[:-4] for n in names1 if n.endswith('.pdf')}, f'pdf/fcm share base: {names1}'
        fcm1 = [d for d in dls1 if d.suggested_filename.endswith('.fcm')][0]
        fcm1_path = os.path.join(OUT, 'cut1.fcm')
        await fcm1.save_as(fcm1_path)
        head = open(fcm1_path, 'rb').read(4)
        assert head[:3] == b'FCM' or head == b'#FCM', f'fcm magic: {head!r}'

        # ---------- PDF · FCM download (2-up) ----------
        await open_print(page)
        await page.select_option('#copiesSel', '2')
        await page.wait_for_timeout(250)
        dls2 = []
        page.on('download', lambda d: dls2.append(d))
        async with page.expect_download() as dinfo:
            await page.click('#pdfFcmBtn')
        await dinfo.value
        await page.wait_for_timeout(1500)
        names2 = [d.suggested_filename for d in dls2]
        print('pdf·fcm 2-up:', names2)
        assert any(n.endswith('.pdf') and '-x2' in n for n in names2), f'2-up pdf: {names2}'
        assert any(n.endswith('.fcm') and '-x2' in n for n in names2), f'2-up fcm: {names2}'
        assert not any(n.endswith('.dxf') for n in names2), f'no dxf anymore: {names2}'

        # ---------- PDF · FCM hidden again in cut mode ----------
        await open_print(page)
        await page.click('#modeSeg button[data-v="cut"]')
        dxf_disp = await page.evaluate("()=>document.querySelector('#pdfFcmBtn').style.display")
        assert dxf_disp == 'none', f'dxf hidden in cut mode: {dxf_disp!r}'
        # orientation restored (auto/h selectable again)
        seg2 = await page.evaluate("()=>[...document.querySelectorAll('#orientSeg button')].map(b=>({v:b.dataset.v,d:b.disabled}))")
        assert all(not b['d'] for b in seg2), f'buttons re-enabled: {seg2}'

        # ---------- 3-up PDF really contains 3 artwork bands ----------
        import pypdfium2
        pdf = pypdfium2.PdfDocument(pdf_path)
        p0 = pdf[0]
        img = p0.render(scale=1.6).to_pil()
        w, h = img.size
        def mm_px(mx, my):
            return img.getpixel((int(mx / 210 * w), int(my / 297 * h)))
        centers = [(105, 59.5), (105, 148.5), (105, 237.5)]   # stacked 가로 copies on A4
        px = [mm_px(*c) for c in centers]
        print('pdf pixels at copy centers:', px)
        assert all(p[0] + p[1] + p[2] < 700 for p in px), f'all 3 copies carry artwork: {px}'
        gap = mm_px(105, 104)   # 1mm gap band between copy1/2 (87..105+...) -> between y=103 and y=105
        assert gap[0] + gap[1] + gap[2] > 690, f'gap band stays white: {gap}'

        print('JS errors:', errors)
        assert not errors, errors
        await browser.close()
    print('ALL PASS')

asyncio.run(main())
