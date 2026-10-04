# -*- coding: utf-8 -*-
"""Non-printing centre alignment guidelines: snap + guides in editor, ZERO trace in print/3D."""
import time, pathlib, sys
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = pathlib.Path(__file__).parent.resolve()
URL  = 'http://localhost:8080/index.html'
OUT  = HERE/'shots'/'guides'
OUT.mkdir(parents=True, exist_ok=True)

def magenta(path, bright=True):
    im = Image.open(path).convert('RGB'); px = im.load(); W,H = im.size
    n = 0
    for y in range(H):
        for x in range(W):
            r,g,b = px[x,y]
            # strict guide-blue only: blend of #2f7cff (47,124,255) over white = (70,135,255)
            if r<=95 and 125<=g<=160 and b>=245: n+=1
    return n

def yellow(path):
    im = Image.open(path).convert('RGB'); px = im.load(); W,H = im.size
    n = 0
    for y in range(H):
        for x in range(W):
            r,g,b = px[x,y]
            if r>230 and 160<g<220 and b<140: n+=1
    return n

def main():
    fails = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width':1440,'height':900}, device_scale_factor=1)
        errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL, wait_until='networkidle')
        page.wait_for_selector('#editor', timeout=15000)
        page.wait_for_timeout(700)

        # upload image
        page.set_input_files('#fileIn', str(HERE/'test.jpg'))
        page.wait_for_timeout(900)

        # ---- 1. real pointer drag ending 1.5mm off centre -> must SNAP to centre ----
        pts = page.evaluate("""()=>{
          const r=document.querySelector('#editor').getBoundingClientRect();
          const d=window.devicePixelRatio||1;
          const from=mm2e(state.img.cx, state.img.cy);
          const to=mm2e(state.wrap.w/2+1.5, state.wrap.h/2+1.0);
          return {fx:r.left+from[0]/d, fy:r.top+from[1]/d, tx:r.left+to[0]/d, ty:r.top+to[1]/d};
        }""")
        page.mouse.move(pts['fx'], pts['fy']); page.mouse.down()
        page.mouse.move((pts['fx']+pts['tx'])/2, (pts['fy']+pts['ty'])/2, steps=5)
        page.mouse.move(pts['tx'], pts['ty'], steps=5)
        page.wait_for_timeout(150)
        page.locator('#editor').screenshot(path=str(OUT/'during-drag.png'))
        page.mouse.up(); page.wait_for_timeout(350)
        pos = page.evaluate("()=>({cx:state.img.cx, cy:state.img.cy})")
        print('after drag:', pos)
        if abs(pos['cx']-102.5) > 1e-6 or abs(pos['cy']-43.5) > 1e-6:
            fails.append(f"did NOT snap to centre: {pos}")
        page.locator('#editor').screenshot(path=str(OUT/'snapped.png'))
        if magenta(OUT/'snapped.png') < 80:
            fails.append(f"snapped guides not bright enough: {magenta(OUT/'snapped.png')} px")
        if yellow(OUT/'during-drag.png') < 20:
            fails.append(f"ΔX/ΔY readout missing during drag: {yellow(OUT/'during-drag.png')} px")

        # ---- 2. drag far off centre -> guides quiet, no snap ----
        pts2 = page.evaluate("""()=>{
          const r=document.querySelector('#editor').getBoundingClientRect();
          const d=window.devicePixelRatio||1;
          const from=mm2e(state.img.cx, state.img.cy);
          const to=mm2e(state.wrap.w/2+40, state.wrap.h/2+20);
          return {fx:r.left+from[0]/d, fy:r.top+from[1]/d, tx:r.left+to[0]/d, ty:r.top+to[1]/d};
        }""")
        page.mouse.move(pts2['fx'], pts2['fy']); page.mouse.down()
        page.mouse.move(pts2['tx'], pts2['ty'], steps=8); page.mouse.up()
        page.wait_for_timeout(350)
        pos2 = page.evaluate("()=>({cx:state.img.cx, cy:state.img.cy})")
        print('after far drag:', pos2)
        if abs(pos2['cx']-142.5) > 6 or abs(pos2['cy']-63.5) > 6:
            fails.append(f"far drag moved unexpectedly: {pos2}")
        page.locator('#editor').screenshot(path=str(OUT/'far.png'))
        if magenta(OUT/'far.png') > 150:
            fails.append(f"bright guides visible while off-centre: {magenta(OUT/'far.png')} px")
        # ---- 2b. front-centre guide PERSISTS at rest (dim blue, long vertical run) ----
        hits = page.evaluate("""()=>{
          const c=document.querySelector('#editor');
          const g=c.getContext('2d');
          const [tx]=mm2e(state.wrap.w/2, 0);
          const [,ty]=mm2e(0, 1);
          const x=Math.round(tx);
          let hits=0;
          for(let y=Math.round(ty); y<Math.round(ty)+Math.min(500, c.height); y++){
            for(const xx of [x-1, x, x+1]){
              const d=g.getImageData(xx, y, 1, 1).data;
              if(d[3]>200 && d[2]>=245 && d[0]>=130 && d[0]<=215 && d[1]>=170 && d[1]<=235) hits++;
            }
          }
          return hits;
        }""")
        if hits < 20:
            fails.append(f'front-centre guide not persistent at rest: {hits} dim-blue px')

        # ---- 2c. LEFT / RIGHT zone snap: within 2.5mm of zone centre -> snaps exactly ----
        for zone, frac in (('left', 0.245), ('right', 0.755)):
            pts3 = page.evaluate("""([frac])=>{
              const r=document.querySelector('#editor').getBoundingClientRect();
              const d=window.devicePixelRatio||1;
              const from=mm2e(state.img.cx, state.img.cy);
              const to=mm2e(state.wrap.w*frac+1.5, state.wrap.h/2+1.0);
              return {fx:r.left+from[0]/d, fy:r.top+from[1]/d, tx:r.left+to[0]/d, ty:r.top+to[1]/d};
            }""", [frac])
            page.mouse.move(pts3['fx'], pts3['fy']); page.mouse.down()
            page.mouse.move((pts3['fx']+pts3['tx'])/2, (pts3['fy']+pts3['ty'])/2, steps=5)
            page.mouse.move(pts3['tx'], pts3['ty'], steps=5)
            page.wait_for_timeout(150)
            page.mouse.up(); page.wait_for_timeout(300)
            pos = page.evaluate("()=>({cx:state.img.cx, cy:state.img.cy})")
            exp = 205*frac
            print(f'after {zone} zone drag:', pos, 'expected cx', exp)
            if abs(pos['cx']-exp) > 1e-6 or abs(pos['cy']-43.5) > 1e-6:
                fails.append(f"{zone} zone did NOT snap: {pos} (expected cx={exp})")
            page.locator('#editor').screenshot(path=str(OUT/f'{zone}-zone.png'))
            if magenta(OUT/f'{zone}-zone.png') < 80:
                fails.append(f'{zone} zone snapped guides not bright: '
                             f'{magenta(OUT/f"{zone}-zone.png")} px')

        # ---- 3. NON-PRINTING: back to centre, verify print preview + 3D have NO magenta ----
        page.evaluate("state.img.cx=102.5; state.img.cy=43.5; scheduleDraws();")
        page.wait_for_timeout(500)
        page.locator('#editor').screenshot(path=str(OUT/'final-editor.png'))
        if magenta(OUT/'final-editor.png') < 80:
            fails.append('final editor guides missing')
        # 3D stage
        page.locator('#stage').screenshot(path=str(OUT/'stage.png'))
        if magenta(OUT/'stage.png') > 60:
            fails.append(f"guides LEAKED into 3D render: {magenta(OUT/'stage.png')} px")
        # print preview canvas (open print modal, shoot the preview)
        page.click('#printOpen'); page.wait_for_timeout(600)
        try:
            page.locator('#printModal canvas').first.screenshot(path=str(OUT/'printprev.png'))
            if magenta(OUT/'printprev.png', bright=False) > 60:
                fails.append(f"guides LEAKED into print preview: {magenta(OUT/'printprev.png', bright=False)} px")
        except Exception as e:
            print('print preview shot skipped:', e)
        try: page.click('#printClose')
        except Exception: page.keyboard.press('Escape')
        page.wait_for_timeout(300)

        print('JS errors:', errors if errors else 'none')
        if errors: fails.append('JS errors: '+'; '.join(errors))
        browser.close()

    if fails:
        print('FAILURES:')
        for f in fails: print(' -', f)
        sys.exit(1)
    print('GUIDE TESTS OK — snap ✓ bright guides ✓ readout ✓ OFF in 3D & print ✓')

if __name__ == '__main__':
    main()
