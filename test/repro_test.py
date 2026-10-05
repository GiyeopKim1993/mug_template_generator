# -*- coding: utf-8 -*-
"""Reproduce user's 4 render-modal screenshots using their extracted cat image."""
import time, os, pathlib, sys
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = pathlib.Path(__file__).parent.resolve()
URL  = 'http://localhost:8080/index.html'
OUT  = HERE/'shots'/'repro'
OUT.mkdir(parents=True, exist_ok=True)
TODAY = time.strftime('%Y-%m-%d')

def main():
    from pypdfium2 import PdfDocument
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width':1440,'height':900}, device_scale_factor=1)
        errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL, wait_until='networkidle')
        page.wait_for_selector('#editor', timeout=15000)
        page.wait_for_timeout(700)

        def open_modal():
            page.evaluate("openRenderModal()")
            page.wait_for_timeout(250)
        def set_yaw(deg):
            page.evaluate("""(d)=>{
              const b=document.querySelector('#autoSpin');
              if(b.checked){b.checked=false;b.dispatchEvent(new Event('change'));}
              mug.th = d*Math.PI/180; mug.spinVel=0;
            }""", deg)
            page.wait_for_timeout(320)
        def shot(name):
            page.locator('#renderModal').screenshot(path=str(OUT/f'{name}.png'))
            print(f'  shot {name}')
        def upload(p):
            page.set_input_files('#fileIn', str(p)); page.wait_for_timeout(900)

        step = sys.argv[1] if len(sys.argv)>1 else 'all'

        if step in ('all','A'):
            print('[A] default cover')
            upload(HERE/'their-cat.png')
            open_modal()
            for yaw,name in ((0,'A-yaw0'),(90,'A-yaw90'),(180,'A-yaw180'),(-90,'A-yawm90')):
                set_yaw(yaw); shot(name)

        if step in ('all','B'):
            print('[B] moved far left (cx=30)')
            page.evaluate("state.img.cx=30; scheduleDraws();")
            page.wait_for_timeout(400)
            set_yaw(180); shot('B-left-yaw180')
            set_yaw(90);  shot('B-left-yaw90')

        if step in ('all','C'):
            print('[C] wheel-zoomed huge (w=600)')
            page.evaluate("state.img.cx=state.wrap.w/2; state.img.w=600; markW&&markW(); syncControls(); scheduleDraws();")
            page.wait_for_timeout(500)
            for yaw,name in ((0,'C-big-yaw0'),(90,'C-big-yaw90'),(180,'C-big-yaw180')):
                set_yaw(yaw); shot(name)

        if step in ('all','D'):
            print('[D] rotate 90 (auto refit)')
            page.evaluate("state.img.w=205; state.img.cx=state.wrap.w/2; state.img.rot=90; syncControls(); scheduleDraws();")
            page.wait_for_timeout(500)
            for yaw,name in ((0,'D-rot90-yaw0'),(90,'D-rot90-yaw90')):
                set_yaw(yaw); shot(name)

        if step in ('all','E'):
            print('[E] layer visible / hidden (white keying removed — shot name kept for history)')
            page.evaluate("state.img.rot=0; state.img.w=205; syncControls&&syncControls(); scheduleDraws();")
            page.wait_for_timeout(400)
            set_yaw(90); shot('E-noknock')
            page.evaluate("state.img.visible=false; scheduleDraws();")
            page.wait_for_timeout(400)
            shot('E-hidden')
            page.evaluate("state.img.visible=true; scheduleDraws();")

        if step in ('all','F'):
            print('[F] moved right so cat straddles seam (cx=170)')
            page.evaluate("state.img.cx=170; scheduleDraws();")
            page.wait_for_timeout(400)
            for yaw,name in ((0,'F-right-yaw0'),(45,'F-right-yaw45'),(90,'F-right-yaw90')):
                set_yaw(yaw); shot(name)

        if step in ('all','G'):
            print('[G] mid-move WITHOUT waiting (stale texture?) — rapid interactions then screenshot')
            page.evaluate("state.img.cx=102;")
            # fire an edit then IMMEDIATELY screenshot before rAF
            page.evaluate("state.img.cx=60; drawEditor&&drawEditor();")
            shot('G-immediate')
            page.wait_for_timeout(500); shot('G-after-rAF')

        print('JS errors:', errors if errors else 'none')
        browser.close()

if __name__ == '__main__':
    main()
