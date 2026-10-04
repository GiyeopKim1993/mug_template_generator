"""Design sheets + layers + per-copy design mapping + 3D fit-clamp + mark fallback."""
import asyncio, os, math
from playwright.async_api import async_playwright
from ui_helpers import open_print, close_print
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'shots')
os.makedirs(OUT, exist_ok=True)

RED = os.path.join(OUT, 'fix-red.png')
BLUE = os.path.join(OUT, 'fix-blue.png')
Image.new('RGB', (60, 40), (216, 32, 32)).save(RED)
Image.new('RGB', (60, 40), (32, 48, 216)).save(BLUE)

async def main():
    errors = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(viewport={'width': 1500, 'height': 1100}, device_scale_factor=1.5)
        page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        await page.goto('file://' + os.path.abspath(os.path.join(BASE, '..', 'index.html')))
        await page.wait_for_timeout(1300)

        # ---- 1. upload -> single layer in 디자인 1 ----
        await page.set_input_files('#fileIn', RED)
        await page.wait_for_timeout(700)
        st = await page.evaluate("""()=>({
            designs: state.designs.length,
            d0layers: state.designs[0].layers.length,
            active: state.activeDesign, la: state.activeLayer,
            imgIsLayer: state.img === state.designs[0].layers[0],
            rows: document.querySelectorAll('#layerList li').length,
            sel: document.querySelector('#designSel').value })""")
        print('after upload:', st)
        assert st == {'designs': 1, 'd0layers': 1, 'active': 0, 'la': 0,
                      'imgIsLayer': True, 'rows': 1, 'sel': '0'}, st

        # ---- 2. new design sheet -> independent layer stack ----
        await close_print(page)
        await page.click('#dsgAdd')
        await page.wait_for_timeout(300)
        await page.set_input_files('#fileIn', BLUE)
        await page.wait_for_timeout(700)
        st = await page.evaluate("""()=>({
            designs: state.designs.length, active: state.activeDesign,
            d0: state.designs[0].layers.length, d1: state.designs[1].layers.length,
            imgIsD1: state.img === state.designs[1].layers[0],
            names: state.designs.map(d=>d.name) })""")
        print('design2:', st)
        assert st['designs'] == 2 and st['active'] == 1 and st['d0'] == 1 and st['d1'] == 1 \
            and st['imgIsD1'], st

        # ---- 3. alignment (bbox-based vs template) ----
        await page.evaluate("()=>{ const im=state.img; im.w=40; im.cx=50; im.cy=30; im.rot=0; scheduleDraws(); }")
        await page.wait_for_timeout(200)
        await close_print(page)
        await page.click('#alignSeg button[data-a="l"]')
        l = await page.evaluate("()=>state.img.cx")
        assert abs(l - 20) < 1e-6, f'left align cx=20 got {l}'
        await page.click('#alignSeg button[data-a="r"]')
        r = await page.evaluate("()=>state.img.cx")
        assert abs(r - (205 - 20)) < 1e-6, f'right align cx=185 got {r}'
        await page.click('#alignSeg button[data-a="vc"]')
        v = await page.evaluate("()=>state.img.cy")
        assert abs(v - 43.5) < 1e-6, f'vertical centre cy=43.5 got {v}'
        await page.click('#alignSeg button[data-a="b"]')
        b = await page.evaluate("()=>state.img.cy")
        asp = 40 / 60
        assert abs(b - (87 - 40 * asp / 2)) < 1e-6, f'bottom align got {b}'
        # rotated bbox: rot 90 -> bbox swaps
        await page.evaluate("()=>{ const im=state.img; im.rot=90; im.cx=100; im.cy=40; }")
        await page.click('#alignSeg button[data-a="l"]')
        lr = await page.evaluate("()=>state.img.cx")
        # bbox w after 90deg = w*aspect = 26.667 -> cx = 13.333
        assert abs(lr - 40 * asp / 2) < 1e-6, f'rotated left align got {lr}'
        print('alignment OK')

        # ---- 4. layer visibility toggles texture ----
        await page.evaluate("()=>{ state.img.rot=0; state.img.cx=102.5; state.img.cy=43.5; scheduleDraws(); }")
        await page.wait_for_timeout(250)
        px_vis = await page.evaluate("""()=>{ const c=tex.getContext('2d');
            return [...c.getImageData(700, 298, 1, 1).data]; }""")
        await close_print(page)
        await page.click('#layerList li[data-i="0"] button[data-act="eye"]')
        await page.wait_for_timeout(300)
        px_hid = await page.evaluate("""()=>{ const c=tex.getContext('2d');
            return [...c.getImageData(700, 298, 1, 1).data]; }""")
        print('visible px', px_vis, '-> hidden px', px_hid)
        assert px_vis[2] > 150 and px_vis[0] < 120, f'blue visible: {px_vis}'
        assert px_hid[0] > 240 and px_hid[1] > 240 and px_hid[2] > 240, f'hidden shows bg: {px_hid}'
        await page.click('#layerList li[data-i="0"] button[data-act="eye"]')  # back on

        # ---- 5. back to design 1, add 2nd layer, reorder with ▲ ----
        await close_print(page)
        await page.select_option('#designSel', '0')
        await page.wait_for_timeout(300)
        await page.set_input_files('#fileIn', BLUE)
        await page.wait_for_timeout(700)
        order0 = await page.evaluate("()=>state.designs[0].layers.map(l=>l.name)")
        assert len(order0) == 2, order0
        # display is reversed: bottom layer (data-i=0) has ▲ -> moves to top
        await page.click('#layerList li[data-i="0"] button[data-act="up"]')
        await page.wait_for_timeout(250)
        order1 = await page.evaluate("()=>state.designs[0].layers.map(l=>l.name)")
        print('order', order0, '->', order1)
        assert order1 == [order0[1], order0[0]], (order0, order1)
        # active layer followed the swap
        act = await page.evaluate("()=>({la:state.activeLayer, imgName:state.img.name})")
        print('after swap active:', act)

        # ---- 6. delete a layer via ✕ ----
        n0 = await page.evaluate("()=>state.designs[0].layers.length")
        await close_print(page)
        await page.click('#layerList li[data-i="0"] button[data-act="del"]')
        await page.wait_for_timeout(250)
        n1 = await page.evaluate("()=>state.designs[0].layers.length")
        assert n1 == n0 - 1, (n0, n1)
        await page.click('#rmBtn')
        await page.wait_for_timeout(250)
        n2 = await page.evaluate("()=>state.designs[0].layers.length")
        assert n2 == n1 - 1 and await page.evaluate("()=>state.img") is None, (n1, n2)
        # design 1 now empty; design 2 still has its blue layer
        cnt = await page.evaluate("()=>[state.designs[0].layers.length, state.designs[1].layers.length]")
        assert cnt == [0, 1], cnt

        # ---- 7. per-copy design mapping: copy1=design1(red), copy2=design2(blue) ----
        await page.set_input_files('#fileIn', RED)   # restore a layer in design 1
        await page.wait_for_timeout(700)
        await open_print(page)
        await page.click('#orientSeg button[data-v="h"]')
        await page.select_option('#copiesSel', '2')
        await page.wait_for_timeout(300)
        row = await page.evaluate("()=>document.querySelector('#copyDesignRow').style.display")
        assert row == '', f'copyDesignRow visible when copies>1 & designs>1: {row!r}'
        sels = await page.query_selector_all('#copyDesignSel select')
        assert len(sels) == 2, f'2 mapping selects, got {len(sels)}'
        await sels[1].select_option('1')            # 배치2 -> 디자인 2 (blue)
        await page.wait_for_timeout(300)
        cd = await page.evaluate("()=>state.copyDesign.slice()")
        assert cd == [0, 1], cd
        # preview pixel check: copy1 red, copy2 blue
        prev = await page.evaluate("""()=>{
          const c=document.getElementById('pagePrev'), g=c.getContext('2d');
          const W=c.width, H=c.height, m=6, s=(W-2*m)/210;
          const g_at=(mmx,mmy)=>[...g.getImageData(m+mmx*s, m+mmy*s, 1, 1).data];
          return {c1:g_at(105,104), c2:g_at(105,193)};   // 가로 2-up centres on A4
        }""")
        print('preview centres:', prev)
        assert prev['c1'][0] > 140 and prev['c1'][2] < 130, f'copy1 red: {prev["c1"]}'
        assert prev['c2'][2] > 140 and prev['c2'][0] < 130, f'copy2 blue: {prev["c2"]}'

        # ---- 8. export PDF with different design per copy ----
        async with page.expect_download() as dinfo:
            await open_print(page)
            await page.click('#exportBtn')
        dl = await dinfo.value
        pdf_path = os.path.join(OUT, 'diff-designs.pdf')
        await dl.save_as(pdf_path)
        print('pdf:', dl.suggested_filename, os.path.getsize(pdf_path))
        import pypdfium2
        pdf = pypdfium2.PdfDocument(pdf_path)
        img = pdf[0].render(scale=1.6).to_pil()
        w, h = img.size
        def at(mm, mmy):
            return img.getpixel((int(mm / 210 * w), int(mmy / 297 * h)))
        p1, p2 = at(105, 104), at(105, 193)
        print('pdf pixels:', p1, p2)
        assert p1[0] > 140 and p1[2] < 130, f'pdf copy1 red: {p1}'
        assert p2[2] > 140 and p2[0] < 130, f'pdf copy2 blue: {p2}'

        # ---- 9. mark mode: 229x89 2-up impossible -> auto fallback to 1 ----
        await open_print(page)
        await page.click('#modeSeg button[data-v="mark"]')
        await close_print(page)
        await page.select_option('#presetSel', '229x89')
        await page.wait_for_timeout(300)
        await open_print(page)
        await page.select_option('#copiesSel', '2')
        await page.wait_for_timeout(400)
        fb = await page.evaluate("()=>({c:state.copies, v:document.querySelector('#copiesSel').value, fits:currentLayout().fits})")
        print('mark 229 2-up fallback:', fb)
        assert fb['c'] == 1 and fb['v'] == '1' and fb['fits'] is True, fb
        cap = await page.text_content('#prevCap')
        assert '1개' in cap, cap

        # ---- 10. mark 205x87 2-up still works on A4 ----
        await close_print(page)
        await page.select_option('#presetSel', '205x87')
        await open_print(page)
        await page.select_option('#copiesSel', '2')
        await page.wait_for_timeout(350)
        ok2 = await page.evaluate("()=>({c:state.copies, fits:currentLayout().fits})")
        assert ok2['c'] == 2 and ok2['fits'] is True, ok2

        # ---- 11. design delete clamps mapping + no JS errors ----
        await open_print(page)
        await page.click('#modeSeg button[data-v="cut"]')
        await close_print(page)
        await page.click('#dsgDel')
        await page.wait_for_timeout(300)
        after = await page.evaluate("()=>({n:state.designs.length, cd:state.copyDesign.slice(), a:state.activeDesign})")
        print('after design delete:', after)
        assert after['n'] == 1 and all(c == 0 for c in after['cd']) and after['a'] == 0, after

        await page.screenshot(path=f'{OUT}/layer-final.png', full_page=True)
        print('JS errors:', errors)
        assert not errors, errors
        await browser.close()
    print('ALL PASS')

asyncio.run(main())
