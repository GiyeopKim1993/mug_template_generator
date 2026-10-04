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
        page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type in ('error',) else None)
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        await page.goto('file://' + os.path.abspath(os.path.join(BASE, '..', 'index.html')))
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f'{OUT}/01-initial.png', full_page=True)

        # upload test image
        await page.set_input_files('#fileIn', os.path.join(BASE, 'test.jpg'))
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f'{OUT}/02-image-uploaded.png', full_page=True)

        # notch punches (real template shape) + editor offset fix (local coords)
        edcheck = await page.evaluate("""() => {
          const c = document.createElement('canvas');
          c.width = 400; c.height = Math.round(400*state.wrap.h/state.wrap.w);
          const ctx = c.getContext('2d');
          ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
          drawArtwork(ctx, c.width, c.height, c.width/state.wrap.w, false);
          const g=(x,y)=>{const d=ctx.getImageData(x,y,1,1).data; return [d[0],d[1],d[2],d[3]];};
          return {
            notchL: g(2, Math.round(0.2*c.height)),      // left notch bite -> white
            notchR: g(c.width-3, Math.round(0.8*c.height)),
            center: g(Math.round(c.width/2), Math.round(c.height/2)),
            plain:  g(Math.round(c.width/2), Math.round(0.2*c.height))
          };
        }""")
        print('notch check:', edcheck)
        assert edcheck['notchL'][3] == 0, f'left notch should be punched transparent: {edcheck["notchL"]}'
        assert edcheck['notchR'][3] == 0, f'right notch should be punched transparent: {edcheck["notchR"]}'
        assert edcheck['center'][3] == 255, f'center should be opaque artwork: {edcheck["center"]}'
        assert edcheck['plain'][3] == 255, f'between notches stays opaque: {edcheck["plain"]}'
        assert not (edcheck['center'][0] == edcheck['center'][1] == edcheck['center'][2] == 255), \
            f'center should not be plain white: {edcheck["center"]}'

        # drag image on editor canvas
        box = await page.locator('#editor').bounding_box()
        cx, cy = box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.5
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        await page.mouse.move(cx + 60, cy + 30, steps=8)
        await page.mouse.up()
        # scale slider
        await page.fill('#scaleR', '150') if False else None
        await page.eval_on_selector('#scaleR', "el => { el.value = 150; el.dispatchEvent(new Event('input')); }")
        await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT}/03-moved-scaled.png', full_page=True)

        # export cut-mode PDF
        async with page.expect_download() as dl:
            await open_print(page)
            await page.click('#exportBtn')
        d = await dl.value
        cut_path = os.path.join(BASE, 'out-cut.pdf')
        await d.save_as(cut_path)
        print('downloaded:', d.suggested_filename, os.path.getsize(cut_path), 'bytes')

        # switch to mark mode (silhouette)
        await open_print(page)
        await page.click('#modeSeg button[data-v="mark"]')
        await page.wait_for_timeout(500)
        await page.screenshot(path=f'{OUT}/04-silhouette-mode.png', full_page=True)
        async with page.expect_download() as dl2:
            await page.click('#exportBtn')
        d2 = await dl2.value
        sil_path = os.path.join(BASE, 'out-silhouette.pdf')
        await d2.save_as(sil_path)
        print('downloaded:', d2.suggested_filename, os.path.getsize(sil_path), 'bytes')

        # brother mode
        await open_print(page)
        await page.click('#markSeg button[data-v="brother"]')
        await page.wait_for_timeout(500)
        await page.screenshot(path=f'{OUT}/05-brother-mode.png', full_page=True)
        async with page.expect_download() as dl3:
            await page.click('#exportBtn')
        d3 = await dl3.value
        bro_path = os.path.join(BASE, 'out-brother.pdf')
        await d3.save_as(bro_path)
        print('downloaded:', d3.suggested_filename, os.path.getsize(bro_path), 'bytes')

        # mark mode must default to A4 (online A4 mark templates)
        paper_val = await page.eval_on_selector('#paperSel', 'el => el.value')
        cap = await page.eval_on_selector('#prevCap', 'el => el.textContent')
        assert paper_val == 'a4', f'mark mode default paper should be a4, got {paper_val}'
        assert cap.startswith('A4'), f'caption should show A4: {cap}'
        # Letter must remain selectable
        await open_print(page)
        await page.select_option('#paperSel', 'letter')
        await page.wait_for_timeout(300)
        capL = await page.eval_on_selector('#prevCap', 'el => el.textContent')
        assert 'US Letter' in capL, f'letter selection should show US Letter: {capL}'
        await page.select_option('#paperSel', 'a4')
        await page.wait_for_timeout(300)
        print('paper default (mark) = A4, letter selectable OK')

        # forced vertical placement: preview must show ROTATED artwork (not stretched):
        # top edge of art = design top row: notch bites at 20%/80% of design height
        await page.select_option('#orientSel', 'v') if False else None
        await open_print(page)
        await page.click('#orientSeg button[data-v="v"]')
        await page.wait_for_timeout(400)
        rotcheck = await page.evaluate("""() => {
          const L = currentLayout();
          const pv = document.getElementById('pagePrev');
          const ctx = pv.getContext('2d');
          const m = 6, s = (pv.width-2*m)/L.page.w;
          const g = (px,py)=>{const d=ctx.getImageData(Math.round(px),Math.round(py),1,1).data; return [d[0],d[1],d[2]];};
          const ax = m + L.art.x*s, ay = m + L.art.y*s, aw = L.art.w*s, ah = L.art.h*s;
          // portrait: wrap's short edges (with handle notches) lie on page TOP & BOTTOM
          return {
            or: L.art.or, fit: L.fits,
            topNotch:    g(ax + 0.2*L.wrap.h*s, ay+2),
            bottomNotch: g(ax + 0.8*L.wrap.h*s, ay+ah-2),
            ctr:         g(ax+aw/2, ay+ah/2)
          };
        }""")
        print('rotation check:', rotcheck)
        assert rotcheck['or'] == 'v', 'orientation should be vertical'
        assert rotcheck['fit'], 'layout should fit'
        for k in ('topNotch', 'bottomNotch'):
            v = rotcheck[k]
            assert v[0] > 245 and v[1] > 245 and v[2] > 245, f'{k} (handle cutout) should be white: {v}'
        c = rotcheck['ctr']
        assert not (c[0] > 245 and c[1] > 245 and c[2] > 245), f'art center should be artwork: {c}'
        # notch toggle must really punch the texture (content-independent alpha check:
        # preview pixels depend on artwork under the bite, which can be white too)
        async def tex_alpha():
            return await page.evaluate("""() => {
              const ppm = tex.width/state.wrap.w;
              const px = Math.max(1, Math.round(state.wrap.w*ppm)-1);
              const py = Math.round(0.2*state.wrap.h*ppm);
              const d = tex.getContext('2d').getImageData(px, py, 1, 1).data;
              return d[3];
            }""")
        alpha_on = await tex_alpha()
        await close_print(page)
        await page.uncheck('#notchChk')
        await page.wait_for_timeout(350)
        top2 = await page.evaluate("""() => {
          const L = currentLayout(); const pv = document.getElementById('pagePrev');
          const ctx = pv.getContext('2d'); const m=6, s=(pv.width-2*m)/L.page.w;
          const d = ctx.getImageData(Math.round(m + L.art.x*s + 0.2*L.wrap.h*s), Math.round(m+L.art.y*s+2), 1, 1).data;
          return [d[0],d[1],d[2]];
        }""")
        alpha_off = await tex_alpha()
        await page.check('#notchChk')
        await page.wait_for_timeout(350)
        print('notch toggle: tex alpha ON=', alpha_on, 'OFF=', alpha_off, '| preview ON=', rotcheck['topNotch'], 'OFF=', top2)
        assert alpha_on == 0, f'notch ON must punch texture transparent: {alpha_on}'
        assert alpha_off == 255, f'notch OFF must be opaque artwork: {alpha_off}'
        await page.screenshot(path=f'{OUT}/10-vertical-notch.png', full_page=True)

        # preset change to 229, back to cut
        await close_print(page)
        await page.select_option('#presetSel', '229x89')
        await open_print(page)
        await page.click('#modeSeg button[data-v="cut"]')
        await page.wait_for_timeout(600)
        await page.screenshot(path=f'{OUT}/06-preset229-cut.png', full_page=True)

        # help modal
        await close_print(page)
        await page.click('#helpBtn')
        await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/07-help.png', full_page=False)
        await page.click('#helpClose')

        # rotate 3D mug by drag
        st = await page.locator('#mug3d').bounding_box()
        mx, my = st['x'] + st['width'] / 2, st['y'] + st['height'] / 2
        await page.mouse.move(mx, my)
        await page.mouse.down()
        await page.mouse.move(mx - 180, my, steps=14)
        await page.mouse.up()
        await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/08-mug-rotated.png', full_page=False)

        # mirror correctness check with asymmetric image
        await page.set_input_files('#fileIn', os.path.join(BASE, 'test-asym.jpg'))
        await page.wait_for_timeout(900)
        await page.keyboard.press('f')      # 면에 채우기(cover) — mirror check samples wrap edges
        await page.wait_for_timeout(400)
        mirror = await page.evaluate("""() => {
          const mk = (m)=>{
            const c=document.createElement('canvas'); c.width=100; c.height=40;
            const ctx=c.getContext('2d');
            drawArtwork(ctx, 100, 40, 100/state.wrap.w, m);
            return ctx.getImageData(0,0,100,40).data;
          };
          const px=(d,x,y)=>{const i=(y*100+x)*4; return [d[i],d[i+1],d[i+2]];};
          const a=mk(false), b=mk(true);
          return {unL:px(a,4,20), unR:px(a,96,20), mL:px(b,4,20), mR:px(b,96,20)};
        }""")
        print('mirror check:', mirror)
        unL, unR, mL, mR = mirror['unL'], mirror['unR'], mirror['mL'], mirror['mR']
        assert unL[1] > 120 and unL[0] < 100, f'unmirrored left should be green: {unL}'
        assert unR[2] > 150 and unR[1] < 90, f'unmirrored right should be purple: {unR}'
        assert mL[2] > 150, f'mirrored LEFT should be purple: {mL}'
        assert mR[1] > 120 and mR[0] < 100, f'mirrored RIGHT should be green: {mR}'
        print('mirror: PASS (left<->right swapped when mirror on)')
        await page.screenshot(path=f'{OUT}/09-asym-mirror.png', full_page=True)

        await browser.close()

    print('JS errors:', errors if errors else 'none')
    return 1 if errors else 0

sys.exit(asyncio.run(main()))
