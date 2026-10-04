"""v3 workbench rework: big work window + right rail (layers / compact render window),
render modal, multi-select group align, white(W) knockout, crop, temp-save drafts + batch export."""
import asyncio, os, sys
from playwright.async_api import async_playwright
from ui_helpers import open_print, close_print

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'shots')
os.makedirs(OUT, exist_ok=True)
fails = []

def chk(name, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f' | {info}' if info != '' else ''))
    if not ok:
        fails.append(name)

async def main():
    errors = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1.5)
        page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        downloads = []
        page.on('download', lambda d: downloads.append(d))

        await page.goto('file://' + os.path.abspath(os.path.join(BASE, '..', 'index.html')))
        await page.wait_for_timeout(1500)

        # ---------- 1. layout: big work window left, rail (render+layers) right ----------
        work = await page.locator('#colWork').bounding_box()
        rail = await page.locator('#colRail').bounding_box()
        stage = await page.locator('#stage').bounding_box()
        lyr = await page.locator('#layerList').bounding_box()
        chk('big work window on the left', work['width'] > 700 and work['x'] < rail['x'],
            f"w={work['width']:.0f} rail_x={rail['x']:.0f}")
        chk('rail on the right (>=340px)', rail['width'] >= 340, f"w={rail['width']:.0f}")
        chk('render window compact & top-right',
            170 <= stage['height'] <= 235 and stage['x'] >= rail['x'] - 2 and stage['y'] < lyr['y'],
            f"stage {stage['width']:.0f}x{stage['height']:.0f} @y={stage['y']:.0f}")
        chk('layers card inside rail below stage', lyr['x'] >= rail['x'] - 2 and lyr['y'] > stage['y'],
            f"lyr=({lyr['x']:.0f},{lyr['y']:.0f})")

        # ---------- 2. render modal: click opens big, close returns, dblclick cancels ----------
        cx, cy = stage['x'] + stage['width'] / 2, stage['y'] + stage['height'] / 2
        await page.mouse.click(cx, cy)
        await page.wait_for_timeout(400)
        open1 = await page.evaluate("document.getElementById('renderModal').classList.contains('open')")
        in_slot = await page.evaluate("!!document.querySelector('#renderSlot #stage')")
        mstage = await page.locator('#renderSlot #stage').bounding_box() if in_slot else None
        mh = mstage['height'] if mstage else 0
        chk('stage click opens render modal', open1 and in_slot and mstage and mh >= 390, f'h={mh:.0f}')
        await page.screenshot(path=f'{OUT}/render-modal.png')
        await page.click('#renderClose')
        await page.wait_for_timeout(300)
        back = await page.evaluate("!document.getElementById('renderModal').classList.contains('open') && !!document.querySelector('#stageHome #stage')")
        chk('close returns stage to compact window', back)
        # dblclick must NOT open (it resets the view)
        sb = await page.locator('#stage').bounding_box()
        await page.mouse.dblclick(sb['x'] + sb['width'] / 2, sb['y'] + sb['height'] / 2)
        await page.wait_for_timeout(400)
        open2 = await page.evaluate("document.getElementById('renderModal').classList.contains('open')")
        chk('double-click does not open modal', not open2)

        # ---------- 3. multi-select -> group align ----------
        await page.set_input_files('#fileIn', os.path.join(BASE, 'test.jpg'))
        await page.wait_for_timeout(900)
        await page.set_input_files('#fileIn', os.path.join(BASE, 'test.jpg'))
        await page.wait_for_timeout(900)
        n = await page.evaluate("activeDesign().layers.length")
        chk('two layers uploaded', n == 2, f'n={n}')
        await close_print(page)
        await page.click('#layerList li[data-i="0"]')
        await page.keyboard.down('Shift')
        await page.click('#layerList li[data-i="1"]')
        await page.keyboard.up('Shift')
        sel = await page.evaluate('[...state.sel].sort()')
        chk('shift-click multi-selects', sorted(sel) == [0, 1], f'sel={sel}')
        # give them different geometry, then group-align left
        await page.evaluate("""() => {
          const L = activeDesign().layers;
          L[0].cx = 60; L[0].cy = 30;
          L[1].cx = 150; L[1].cy = 60;
        }""")
        await page.click('#alignSeg button[data-a="l"]')
        await page.wait_for_timeout(300)
        lefts = await page.evaluate("""() => activeDesign().layers.map(im => {
          const aspect = im.bmp.height/im.bmp.width;
          const a = im.rot*Math.PI/180, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
          const bw = im.w*ca + im.w*aspect*sa;
          return im.cx - bw/2;
        })""")
        chk('group align-left: equal left edges', abs(lefts[0] - lefts[1]) < 0.6, f'{lefts}')
        # single-select falls back to template align
        await page.click('#layerList li[data-i="0"]')
        await page.click('#alignSeg button[data-a="l"]')
        await page.wait_for_timeout(200)
        one = await page.evaluate("""() => {
          const im = state.img, aspect = im.bmp.height/im.bmp.width;
          const a = im.rot*Math.PI/180, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
          return im.cx - (im.w*ca + im.w*aspect*sa)/2;
        }""")
        chk('single align-left hits template edge', abs(one) < 0.6, f'L={one:.2f}')

        # ---------- 4. white (W) knockout: default ON, unit check, toggle ----------
        ko = await page.evaluate("""() => {
          const c = document.createElement('canvas'); c.width = 2; c.height = 1;
          const x = c.getContext('2d');
          x.fillStyle = '#ffffff'; x.fillRect(0,0,1,1);
          x.fillStyle = '#e05050'; x.fillRect(1,0,1,1);
          const k = knockCanvas(c).getContext('2d').getImageData(0,0,2,1).data;
          return {white: k[3], red: k[3+4],
                  defOn: state.designs[state.activeDesign].layers[0].ko !== false};
        }""")
        chk('knockout: white -> alpha 0, color kept', ko['white'] == 0 and ko['red'] == 255, f'{ko}')
        chk('knockout default ON for layers', ko['defOn'])
        on0 = await page.evaluate("""() => {
          const row = [...document.querySelectorAll('#layerList li')].find(li => li.dataset.i === '0');
          return row && row.querySelector('.lbtn.ko').classList.contains('on');
        }""")
        chk('W button shows ON by default', on0)
        await close_print(page)
        await page.click('#layerList li[data-i="0"] .lbtn.ko')
        on1 = await page.evaluate("state.designs[state.activeDesign].layers[0].ko === false")
        await page.click('#layerList li[data-i="0"] .lbtn.ko')
        on2 = await page.evaluate("state.designs[state.activeDesign].layers[0].ko !== false")
        chk('W toggle turns off and back on', on1 and on2, f'on1={on1} on2={on2}')

        # ---------- 5. crop ----------
        before = await page.evaluate("({w: state.img.bmp.width, sw: state.img.w})")
        await close_print(page)
        await page.click('#cropBtn')
        vis = await page.evaluate("document.getElementById('cropBar').classList.contains('show')")
        chk('crop bar appears', vis)
        await page.evaluate(f"crop = {{px: 0, py: 0, pw: Math.round({before['w']}*0.6), ph: state.img.bmp.height}}")
        await page.click('#cropApply')
        await page.wait_for_timeout(600)
        after = await page.evaluate("({w: state.img.bmp.width, sw: state.img.w, bar: document.getElementById('cropBar').classList.contains('show')})")
        chk('crop applies: bitmap width ~60%', abs(after['w'] - before['w'] * 0.6) <= 2 and not after['bar'],
            f"{before['w']} -> {after['w']}")
        chk('crop scales display width proportionally', after['sw'] < before['sw'] * 0.7,
            f"{before['sw']:.1f} -> {after['sw']:.1f}")

        # ---------- 6. temp saves -> list -> batch export ----------
        await close_print(page)
        await page.click('#draftSaveBtn')
        await page.wait_for_timeout(200)
        await page.click('#draftSaveBtn')
        await page.wait_for_timeout(300)
        cnt = await page.evaluate("document.getElementById('draftCount').textContent")
        items = await page.evaluate("document.querySelectorAll('#draftList li').length")
        chk('temp saves stack in the list', cnt == '(2)' and items == 2, f'cnt={cnt} items={items}')
        en = await page.evaluate("!document.getElementById('draftExportAll').disabled")
        chk('batch export enabled with list', en)
        await page.click('#draftExportAll')
        await page.wait_for_selector('#printModal.open')
        rows = await page.evaluate("[document.querySelector('#scopeSeg button.on').dataset.v, document.getElementById('bmCutRow')!==null]")
        chk('export dialog opens with scope=list + cut row', rows == ['list', True], f'{rows}')
        await page.wait_for_function("() => !document.getElementById('printModal').classList.contains('busy')", timeout=30000)
        await page.click('#exportBtn')
        # list export = ONE imposed PDF (zip removed)
        for _ in range(60):
            if len(downloads) >= 1:
                break
            await page.wait_for_timeout(250)
        names = [d.suggested_filename for d in downloads]
        chk('list export downloads one imposed PDF (no zip)',
            len(downloads) >= 1 and 'imposed' in names[0] and names[0].endswith('.pdf'), f'{names}')
        await page.wait_for_function("() => !document.getElementById('printModal').classList.contains('busy')", timeout=30000)
        restored = await page.evaluate("state.wrap.w")   # 원본 복원
        chk('state restored after batch export', restored == 205, f'w={restored}')
        await page.click('#printClose')
        await page.wait_for_timeout(250)
        # per-item delete
        await page.click('#draftList li:first-child button[data-act="del"]')
        await page.wait_for_timeout(200)
        items2 = await page.evaluate("document.querySelectorAll('#draftList li').length")
        chk('delete removes one draft', items2 == 1, f'items={items2}')

        # ---------- print settings dialog (Illustrator-style) ----------
        await page.click('#printOpen')
        await page.wait_for_timeout(300)
        pm_open = await page.evaluate("document.getElementById('printModal').classList.contains('open')")
        exp_vis = await page.locator('#exportBtn').is_visible()
        prev_vis = await page.locator('#pagePrev').is_visible()
        copies_vis = await page.locator('#copiesSel').is_visible()
        chk('rail button opens print dialog with preview+export',
            pm_open and exp_vis and prev_vis and copies_vis,
            f'open={pm_open} exp={exp_vis} prev={prev_vis} copies={copies_vis}')
        await page.screenshot(path=f'{OUT}/print-dialog.png')
        await page.click('#printClose')
        await page.wait_for_timeout(200)
        pm_closed = await page.evaluate("!document.getElementById('printModal').classList.contains('open')")
        await page.keyboard.press('Control+p')
        await page.wait_for_timeout(250)
        pm2 = await page.evaluate("document.getElementById('printModal').classList.contains('open')")
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(200)
        pm3 = await page.evaluate("document.getElementById('printModal').classList.contains('open')")
        chk('print dialog closes; Ctrl+P opens, Escape closes',
            pm_closed and pm2 and not pm3, f'{pm_closed},{pm2},{pm3}')
        cb = await page.evaluate("()=>({x:!!document.getElementById('cxIn'), r:!!document.getElementById('rotIn'), t:document.getElementById('pdMini').textContent.slice(0,3)})")
        chk('control bar + rail summary present', cb['x'] and cb['r'] and len(cb['t'])>2, f'{cb}')
        await page.screenshot(path=f'{OUT}/workbench.png')
        await browser.close()

    chk('no JS errors', not errors, '; '.join(errors[:3]))
    print('\n' + ('ALL PASS' if not fails else f'FAILURES: {fails}'))
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    asyncio.run(main())
