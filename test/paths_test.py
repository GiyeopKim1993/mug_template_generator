"""Multi-path reproduction sweep: every plausible user route that could break the
3D transfer view (notch streaks / hidden content). Each step snapshots the stage
and checks: colored-content fraction, white-streak columns, canvas buffer/CSS ratio."""
import asyncio, os, sys
from playwright.async_api import async_playwright
from PIL import Image
from collections import Counter

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'shots', 'paths')
os.makedirs(OUT, exist_ok=True)
fails = []
flags = []

def classify(p):
    r, g, b = p[:3]
    mx, mn = max(p[:3]), min(p[:3])
    if mx < 45: return 'dark'
    if mx - mn < 16 and mx > 205: return 'white'
    if mx - mn >= 40: return 'content'
    return 'mid'

def analyze(path):
    im = Image.open(path).convert('RGB'); W, H = im.size
    body = im.crop((int(W*.2), int(H*.15), int(W*.8), int(H*.85)))
    bw, bh = body.size
    c = Counter(classify(p) for p in body.getdata()); n = sum(c.values())
    streak = 0
    for x in range(0, bw, 3):
        col = [body.getpixel((x, y)) for y in range(0, bh, 5)]
        if sum(1 for p in col if classify(p) == 'white') > 0.55 * len(col):
            streak += 1
    return 100*c['content']/n, 100*c['white']/n, streak

async def main():
    errors = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(viewport={'width': 1440, 'height': 980}, device_scale_factor=1)
        page.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        await page.goto('file://' + os.path.abspath(os.path.join(BASE, '..', 'index.html')))
        await page.wait_for_timeout(1400)
        # content checks must be rotation-phase-independent: park the turntable
        # facing the design (th=-180deg puts the wrap front to camera; th=0 is the back)
        await page.uncheck('#autoSpin')
        await page.evaluate("mug.th = -Math.PI; mug.spinVel = 0;")
        n = 0
        async def chk3d(label, min_content=2.0, max_streak=99):
            nonlocal n
            n += 1
            # texture fade-in / rotation phase makes a single snapshot racy ->
            # sample 3x and judge the BEST frame (design must be visible at some point)
            best = None
            for k in range(3):
                await page.wait_for_timeout(700)
                fp = f'{OUT}/{n:02d}-{label}{"" if k==0 else "b"+str(k)}.png'
                await page.locator('#stage').screenshot(path=fp)
                got = analyze(fp)
                if best is None or got[0] > best[0]:
                    best = (got[0], got[1], got[2], fp)
            cont, white, streak, fp = best
            ratio = await page.evaluate("""()=>{const c=document.getElementById('mug3d');
                return Math.abs(c.width/c.height - c.clientWidth/c.clientHeight);}""")
            bad = cont < min_content or streak > max_streak or ratio > 0.02
            tag = 'FLAG' if bad else 'ok'
            print(f'[{tag}] {label:26s} content={cont:5.1f}% white={white:4.1f}% streak={streak:2d} ratioΔ={ratio:.3f}')
            if bad:
                flags.append(f'{label}: content={cont} streak={streak} ratio={ratio}')
            return dict(content=cont, white=white, streak=streak, ratio=ratio)
        async def upload(name, settle=1600):
            await page.set_input_files('#fileIn', os.path.join(BASE, name))
            await page.wait_for_timeout(settle)   # wait for the 3D texture fade-in to fully settle
        async def open_print():
            await page.evaluate("document.getElementById('printModal').classList.add('open')")
            await page.wait_for_timeout(80)
        async def close_print():
            await page.evaluate("document.getElementById('printModal').classList.remove('open')")
            await page.wait_for_timeout(80)

        # ---------- P1 upload ----------
        await upload('test.jpg'); await chk3d('upload-default')
        await upload('test.jpg'); await chk3d('upload-2nd-layer')

        # ---------- P2 mouse editor paths ----------
        eb = await page.locator('#editor').bounding_box()
        cx, cy = eb['x']+eb['width']/2, eb['y']+eb['height']/2
        await page.mouse.move(cx, cy); await page.mouse.down()
        await page.mouse.move(cx+70, cy-40, steps=8); await page.mouse.up()
        await chk3d('editor-drag')
        # resize handle
        h = await page.evaluate("handleScreenPos()")
        box = await page.locator('#editor').bounding_box()
        hx, hy = box['x']+h[0], box['y']+h[1]
        await page.mouse.move(hx, hy); await page.mouse.down()
        await page.mouse.move(hx+90, hy+70, steps=8); await page.mouse.up()
        await chk3d('handle-resize')
        # editor wheel zoom
        await page.mouse.move(cx, cy)
        await page.mouse.wheel(0, -500); await page.wait_for_timeout(150)
        await page.mouse.wheel(0, 900); await page.wait_for_timeout(150)
        await chk3d('editor-wheel')
        # hotkey C: open crop, move rect, apply
        await page.keyboard.press('c'); await page.wait_for_timeout(250)
        crop_open = await page.evaluate("!!crop")
        if not crop_open: flags.append('hotkey-c did not open crop')
        await page.mouse.move(cx, cy); await page.mouse.down()
        await page.mouse.move(cx+40, cy+25, steps=6); await page.mouse.up()
        await page.click('#cropApply'); await page.wait_for_timeout(700)
        await chk3d('crop-drag-apply')
        # hotkey F fit, center
        await page.keyboard.press('f'); await page.wait_for_timeout(300)
        await chk3d('hotkey-F-fit')
        await page.click('#centerBtn'); await page.wait_for_timeout(250)
        # hotkey Delete + re-upload
        await page.keyboard.press('Delete'); await page.wait_for_timeout(300)
        await chk3d('hotkey-Del-empty', min_content=0.01)   # empty expected
        await upload('test.jpg')

        # ---------- P3 visibility / bg (white keying removed 2026-10-05) ----------
        await page.click('#layerList li[data-i="0"] button[data-act="eye"]')
        await chk3d('eye-off', min_content=0.01)
        await page.click('#layerList li[data-i="0"] button[data-act="eye"]')
        await page.eval_on_selector('#bgColor', "el=>{el.value='#ffe08a'; el.dispatchEvent(new Event('input'));}")
        await chk3d('bg-warm')
        await page.eval_on_selector('#bgColor', "el=>{el.value='#ffffff'; el.dispatchEvent(new Event('input'));}")

        # ---------- P4 control-bar numeric paths ----------
        async def setnum(id_, v):
            await page.eval_on_selector(id_, f"el=>{{el.value='{v}'; el.dispatchEvent(new Event('input'));}}")
            await page.wait_for_timeout(200)
        await setnum('#cxIn', '205'); await setnum('#cyIn', '44')
        await chk3d('num-X205-offside')
        await setnum('#cxIn', '102.5'); await setnum('#cyIn', '43.5')
        await setnum('#wIn', '600'); await chk3d('num-W600')
        await setnum('#wIn', '80')
        await setnum('#rotIn', '-270'); await chk3d('num-rot-clamp')
        await setnum('#rotIn', '90'); await chk3d('num-rot90')
        await setnum('#rotIn', '0'); await setnum('#wIn', '205')

        # ---------- P5 templates / notch ----------
        await page.select_option('#presetSel', '229x89'); await page.wait_for_timeout(400)
        await chk3d('wrap229')
        await page.select_option('#presetSel', 'custom'); await page.wait_for_timeout(250)
        await page.fill('#cwIn', '150'); await page.fill('#chIn', '60')
        await page.click('#applySize'); await page.wait_for_timeout(500)
        await chk3d('wrap150x60')
        await page.select_option('#presetSel', '205x87'); await page.wait_for_timeout(400)
        await page.uncheck('#notchChk'); await chk3d('notch-off')
        await page.check('#notchChk'); await chk3d('notch-on')

        # ---------- P6 print-modal ops ----------
        await open_print()
        await page.click('#modeSeg button[data-v="mark"]'); await close_print()
        await chk3d('mode-mark')
        await open_print()
        await page.click('#markSeg button[data-v="brother"]'); await close_print()
        await chk3d('machine-brother')
        await open_print()
        await page.click('#modeSeg button[data-v="cut"]')
        await page.evaluate("()=>{state.mirror=false; drawPagePrev(); updateExportUI();}")
        await close_print(); await chk3d('mirror-off')
        await page.evaluate("()=>{state.mirror=true; drawPagePrev(); updateExportUI();}")
        await open_print()
        await page.click('#orientSeg button[data-v="h"]'); await close_print()
        await chk3d('orient-h')
        await open_print()
        await page.click('#orientSeg button[data-v="v"]')
        await page.select_option('#copiesSel', '2'); await close_print()
        await chk3d('copies2')
        await open_print()
        await page.select_option('#copiesSel', '1'); await close_print()

        # ---------- P7 multi-select group ----------
        await upload('test.jpg')
        await page.click('#layerList li[data-i="0"]')
        await page.keyboard.down('Shift')
        await page.click('#layerList li[data-i="1"]')
        await page.keyboard.up('Shift')
        await page.click('#alignSeg button[data-a="l"]')
        await page.click('#alignSeg button[data-a="vc"]')
        await chk3d('group-align')

        # ---------- P8 drafts + batch restore ----------
        await page.click('#draftSaveBtn'); await page.wait_for_timeout(250)
        await page.evaluate("()=>{state.wrap={w:150,h:60}; state.mirror=false; scheduleDraws();}")
        await page.wait_for_timeout(300)
        await page.click('#draftList li:first-child button[data-act="load"]')
        await page.wait_for_timeout(700)
        await chk3d('draft-load')
        await page.click('#draftSaveBtn'); await page.wait_for_timeout(200)
        dl = []
        page.on('download', lambda d: dl.append(d))
        await page.click('#draftExportAll')
        await page.wait_for_selector('#printModal.open')
        await page.wait_for_function("() => !document.getElementById('printModal').classList.contains('busy')", timeout=30000)
        await page.click('#exportBtn')
        for _ in range(40):
            if len(dl) >= 1: break
            await page.wait_for_timeout(250)
        await page.wait_for_timeout(600)
        dnames = [d.suggested_filename for d in dl]
        if len(dl) != 1 or not (dnames[0].endswith('.pdf') and 'imposed' in dnames[0]):
            flags.append(f'batch export got {dnames} (want exactly 1 imposed pdf)')
        await page.click('#printClose'); await page.wait_for_timeout(400)   # modal backdrop tints stage shots -> close first
        await chk3d('batch-restore')

        # ---------- P9 render modal cycles ----------
        sb = await page.locator('#stage').bounding_box()
        sx, sy = sb['x']+sb['width']/2, sb['y']+sb['height']/2
        await page.mouse.click(sx, sy); await page.wait_for_timeout(450)
        if not await page.evaluate("document.getElementById('renderModal').classList.contains('open')"):
            flags.append('render modal did not open')
        r = await page.evaluate("""()=>{const c=document.getElementById('mug3d');
            return Math.abs(c.width/c.height - c.clientWidth/c.clientHeight);}""")
        if r > 0.02: flags.append(f'modal canvas ratio {r}')
        await page.mouse.move(sx, sy); await page.mouse.wheel(0, -300)
        await page.mouse.down(); await page.mouse.move(sx-80, sy-40, steps=6); await page.mouse.up()
        await page.wait_for_timeout(300)
        await page.click('#renderClose'); await page.wait_for_timeout(450)
        await chk3d('modal-cycle')
        # resize while modal open
        await page.mouse.click(sx, sy); await page.wait_for_timeout(400)
        await page.set_viewport_size({'width': 1100, 'height': 800})
        await page.wait_for_timeout(500)
        r2 = await page.evaluate("""()=>{const c=document.getElementById('mug3d');
            return Math.abs(c.width/c.height - c.clientWidth/c.clientHeight);}""")
        if r2 > 0.02: flags.append(f'resize-in-modal ratio {r2}')
        await page.click('#renderClose'); await page.wait_for_timeout(400)

        # ---------- P10 viewport sizes ----------
        await page.set_viewport_size({'width': 1280, 'height': 900}); await chk3d('vp1280')
        await page.set_viewport_size({'width': 960, 'height': 900}); await chk3d('vp960-singlecol')
        await page.set_viewport_size({'width': 1440, 'height': 980}); await page.wait_for_timeout(400)

        # ---------- P11 synthetic images ----------
        from PIL import Image as I
        # panorama: wide with colored bands on white
        pano = I.new('RGB', (6000, 800), (255, 255, 255))
        for i, col in enumerate([(220, 60, 60), (60, 90, 220), (60, 180, 90), (240, 180, 40)]):
            x0 = 300 + i * 1300
            for x in range(x0, x0 + 500):
                for y in range(0, 800, 4):
                    pano.putpixel((x, y), col)
        pano.save(os.path.join(BASE, 'gen-pano.png'))
        tall = I.new('RGB', (700, 4200), (250, 250, 250))
        for y in range(200, 4000, 700):
            for x in range(700):
                for yy in range(y, y+350, 3):
                    if yy < 4200: tall.putpixel((x, yy), (190, 60, 160))
        tall.save(os.path.join(BASE, 'gen-tall.png'))
        alpha = I.new('RGBA', (1200, 900), (0, 0, 0, 0))
        for x in range(150, 1050, 4):
            for y in range(200, 700, 4):
                alpha.putpixel((x, y), (40, 160, 200, 255))
        alpha.save(os.path.join(BASE, 'gen-alpha.png'))
        white = I.new('RGB', (2000, 1400), (255, 255, 255))
        for x in range(700, 1300, 4):
            for y in range(550, 850, 4):
                white.putpixel((x, y), (200, 40, 40))
        white.save(os.path.join(BASE, 'gen-white.png'))
        await upload('gen-pano.png');  await chk3d('img-panorama')
        await upload('gen-tall.png');  await chk3d('img-tall')
        await upload('gen-alpha.png'); await chk3d('img-alpha')
        await upload('gen-white.png')
        wd = await chk3d('img-whitedominant', min_content=0.0)   # opaque white face (spec 2026-10-05)
        if wd['white'] < 8:
            flags.append(f"white-dominant face not rendered: white={wd['white']}")

        # ---------- P14 rotation auto-cover refit (wide image) ----------
        await upload('gen-white.png')
        await page.keyboard.press('f')      # 면에 채우기(cover) — refit premise: covered before rotating
        await page.wait_for_timeout(400)
        w0 = await page.evaluate("state.img.w")
        await page.eval_on_selector('#rotR', "el=>{el.value=90; el.dispatchEvent(new Event('input'));}")
        await page.wait_for_timeout(450)
        r90 = await chk3d('rot90-wide-refit', min_content=0.0)   # white face opaque by spec; geometry checks carry
        w90 = await page.evaluate("state.img.w")
        if w90 <= w0 + 30:
            flags.append(f'rot90 did NOT grow wide image: {w0} -> {w90}')
        if r90['white'] < 8:
            flags.append(f'rot90 wide face missing after refit: white={r90["white"]}')
        await page.eval_on_selector('#rotR', "el=>el.dispatchEvent(new Event('change'))")
        await page.eval_on_selector('#rotR', "el=>{el.value=0; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));}")
        await page.wait_for_timeout(450)
        w_back = await page.evaluate("state.img.w")
        if abs(w_back - w0) > 2:
            flags.append(f'rotate back did NOT restore user size: {w0} -> {w_back}')
        await chk3d('rot-back-restore', min_content=0.0)   # white face opaque by spec; size-restore assert carries
        # small decorative image must NOT be auto-resized
        await page.eval_on_selector('#scaleR', "el=>{el.value=40; el.dispatchEvent(new Event('input'));}")
        await page.wait_for_timeout(300)
        w_small = await page.evaluate("state.img.w")
        await page.eval_on_selector('#rotR', "el=>{el.value=90; el.dispatchEvent(new Event('input'));}")
        await page.wait_for_timeout(400)
        w_after = await page.evaluate("state.img.w")
        if abs(w_after - w_small) > 2:
            flags.append(f'small image was force-resized on rotate: {w_small} -> {w_after}')
        await chk3d('rot90-small-untouched', min_content=0.0)   # white face opaque by spec; size-untouched assert carries
        await page.eval_on_selector('#rotR', "el=>{el.value=0; el.dispatchEvent(new Event('input'));}")

        # ---------- P12 flick momentum ----------
        await upload('test.jpg')
        await page.mouse.move(sx, sy); await page.mouse.down()
        await page.mouse.move(sx+150, sy, steps=4); await page.mouse.up()
        await chk3d('flick-spin', max_streak=99)

        # ---------- P13 hotkey guard in inputs ----------
        await page.click('#cxIn')
        await page.keyboard.press('c')
        opened = await page.evaluate("!!crop")
        if opened:
            flags.append('hotkey C fired while typing in input')
            await page.keyboard.press('Escape')
        await page.click('#editor')

        await browser.close()

    print('\nJS errors:', errors[:5] if errors else 'none')
    if errors: flags.append(f'JS errors: {errors[:3]}')
    print(f'\nsteps={n}  flags={len(flags)}')
    for f in flags: print('  !!', f)
    if not flags and not errors:
        print('ALL PATHS CLEAN — no reproduction')
    sys.exit(1 if flags else 0)

if __name__ == '__main__':
    asyncio.run(main())
