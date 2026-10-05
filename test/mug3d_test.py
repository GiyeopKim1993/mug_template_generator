import asyncio, os, sys, math
from playwright.async_api import async_playwright

FAILS = []
def chk(name, cond, extra=''):
    if cond: print('PASS', name, ('| ' + str(extra)) if extra else '', flush=True)
    else:
        FAILS.append(name); print('FAIL', name, ('| ' + str(extra)) if extra else '', flush=True)

# GLB stage contract (rewritten 2026-10-05 — the 2D fake-3D painter was retired):
# three.js renders assets/mug.glb into #mug3d (WebGL), design applied to the BODY only,
# ACES + studio env, app.js keeps the same `mug` view state + controls.

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=2)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console:' + m.text) if m.type == 'error' else None)
        await pg.goto('http://localhost:8080/index.html', wait_until='networkidle')
        await pg.wait_for_timeout(1600)
        await pg.locator('#mug3d').scroll_into_view_if_needed()
        await pg.wait_for_timeout(200)

        st = await pg.evaluate('()=>({zoom:mug.zoom,panX:mug.panX,pitch:mug.pitch,roll:mug.roll,auto:mug.auto,speed:mug.speed})')
        chk('defaults', abs(st['zoom']-1) < 1e-9 and st['panX'] == 0
            and abs(st['pitch']-math.asin(0.16)) < 1e-9 and st['auto'] and abs(st['speed']-0.2) < 1e-9, st)

        # ---- GLB loaded: 3 meshes, body printed, handle/inner plain ----
        info = await pg.evaluate('()=>window.__mv.info()')
        chk('glb: 3/3 meshes uv-mapped initially', info['meshes'] == 3 and info['uv'] == 3, info)
        chk('glb: webgl renderer + ACES', info['renderer'] == 'webgl' and info['tone'] == 4, info)

        probe = await pg.evaluate('()=>window.__mv.probe()')
        printable = [x for x in probe if x['printable']]
        plain = [x for x in probe if not x['printable']]
        chk('body printable (exactly 1)', len(printable) == 1, [(x['name'], x['printable'], x['off'], x['score']) for x in probe])
        chk('handle/inner plain ceramic', len(plain) >= 1 and all(not x['map'] for x in plain), [(x['name'], x['map']) for x in plain])
        chk('body carries design map', printable and printable[0]['map'] is True, [(x['name'], x['map']) for x in probe])

        # ---- design texture applied & refreshed on upload ----
        await pg.evaluate("""async ()=>{
          const c=document.createElement('canvas'); c.width=600; c.height=1400;
          const x=c.getContext('2d'); x.fillStyle='#ff00cc'; x.fillRect(0,0,600,1400);
          const blob=await new Promise(r=>c.toBlob(r,'image/png'));
          await loadFile(new File([blob],'t.png',{type:'image/png'}));
        }""")
        await pg.wait_for_timeout(700)
        info2 = await pg.evaluate('()=>window.__mv.info()')
        chk('texture: design applied (texW=1400, mapped>=1)', info2['hasTex'] and info2['texW'] == 1400 and info2['mapped'] >= 1, info2)
        chk('body still the only printable mesh after upload',
            [x for x in (await pg.evaluate('()=>window.__mv.probe()')) if x['printable'] and x['map']] != [],
            None)

        # ---- canvas is WebGL, buffer/CSS ratio sane ----
        cv = await pg.evaluate("""()=>{
          const c=document.getElementById('mug3d');
          return {d2:!!c.getContext('2d'), w:c.width, h:c.height, cw:c.clientWidth, ch:c.clientHeight};}""")
        chk('canvas: WebGL (2d ctx refused)', cv['d2'] is False, cv)
        chk('canvas: buffer/CSS aspect sane', abs((cv['w']/cv['h'])/(cv['cw']/cv['ch']) - 1) < 0.02, cv)

        # ---- turntable advances; spin select maps to speed ----
        await pg.uncheck('#autoSpin'); await pg.wait_for_timeout(80)
        t0 = await pg.evaluate('()=>mug.th')
        await pg.check('#autoSpin'); await pg.wait_for_timeout(500)
        t1 = await pg.evaluate('()=>mug.th')
        chk('turntable spins when auto on', t1 != t0, f'{t0:.3f} -> {t1:.3f}')
        await pg.uncheck('#autoSpin')
        await pg.eval_on_selector('#spinSpd', "el=>{el.value='0.45'; el.dispatchEvent(new Event('change'));}")
        chk('spin speed select wired', abs(await pg.evaluate('()=>mug.speed') - 0.45) < 1e-9)

        # ---- orbit drag + wheel zoom + dblclick reset ----
        await pg.evaluate('()=>{mug.th=0.5; mug.spinVel=0;}')
        box = await pg.locator('#mug3d').bounding_box()
        cx, cy = box['x'] + box['width']/2, box['y'] + box['height']/2
        await pg.mouse.move(cx, cy)
        await pg.mouse.down()
        await pg.mouse.move(cx + 90, cy - 40, steps=8)
        await pg.mouse.up()
        await pg.wait_for_timeout(200)
        moved = await pg.evaluate('()=>({th:mug.th, pitch:mug.pitch})')
        chk('drag orbits (th changed)', abs(moved['th'] - 0.5) > 0.05, moved)
        z0 = await pg.evaluate('()=>mug.zoom')
        await pg.mouse.move(cx, cy)
        await pg.mouse.wheel(0, -400)
        await pg.wait_for_timeout(150)
        z1 = await pg.evaluate('()=>mug.zoom')
        chk('wheel zooms in', z1 > z0, f'{z0:.3f} -> {z1:.3f}')
        await pg.dblclick('#mug3d')
        await pg.wait_for_timeout(150)
        rst = await pg.evaluate('()=>({zoom:mug.zoom, pitch:mug.pitch, roll:mug.roll, pan:mug.panX})')
        chk('dblclick resets view', abs(rst['zoom']-1) < 1e-9 and abs(rst['pitch']-math.asin(0.16)) < 1e-9 and rst['pan'] == 0, rst)

        # ---- click (no drag) opens render modal; ESC closes ----
        await pg.mouse.click(cx, cy)
        await pg.wait_for_timeout(350)
        opened = await pg.evaluate("""()=>({open:document.getElementById('renderModal').classList.contains('open'),
             moved:!!document.querySelector('#renderSlot #stage')})""")
        chk('click opens expand modal (stage moved)', opened['open'] and opened['moved'], opened)
        await pg.keyboard.press('Escape')
        await pg.wait_for_timeout(300)
        closed = await pg.evaluate("()=>!document.getElementById('renderModal').classList.contains('open')")
        chk('ESC closes modal (stage back)', closed)

        # ---- photoreal mockup card (#10) ----
        mock = await pg.evaluate('()=>window.__mockupInfo ? __mockupInfo() : null')
        chk('mockup: photo loaded + drawn', mock and mock['ready'] and mock['drawn'] and mock['w'] > 200, mock)

        chk('no page errors', len(errs) == 0, '; '.join(errs[:3]))
        await pg.screenshot(path='mug3d-final.png', full_page=False)
        await b.close()
    print('=' * 8, 'FAILS:', FAILS, flush=True)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
