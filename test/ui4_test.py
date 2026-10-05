#!/usr/bin/env python3
"""UI-4 acceptance: narrow layer order, click=frontmost focus, context menu z-order, height-fit.
Run from repo root: python3 test/ui4_test.py"""
import os, sys
from playwright.sync_api import sync_playwright

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'uploads')
flags = []

def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page(viewport={'width': 1400, 'height': 900})
        errs = []
        p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto('http://localhost:8080/index.html')
        p.wait_for_timeout(600)
        p.set_input_files('#fileIn', os.path.join(BASE, 'cat1.png'))
        p.wait_for_timeout(1300)
        p.click('#addDesignBtn') if p.locator('#addDesignBtn').count() else None
        p.wait_for_timeout(300)
        p.set_input_files('#fileIn', os.path.join(BASE, 'cat2.png'))
        p.wait_for_timeout(1300)

        # (1) two layers exist, front = last index
        n = p.evaluate("()=>activeDesign().layers.length")
        if n < 2: flags.append('need >=2 layers, got %d' % n)

        # (2) click center of canvas focuses FRONT-most layer
        p.evaluate("()=>{state.activeLayer=0; state.sel=[0]; syncActive&&syncActive();}")
        ed = p.locator('#editor').bounding_box()
        p.mouse.click(ed['x'] + ed['width']/2, ed['y'] + ed['height']/2)
        p.wait_for_timeout(300)
        act = p.evaluate("()=>state.activeLayer")
        if act != n - 1:
            flags.append('click focus: want frontmost %d, got %s' % (n-1, act))

        # (3) context menu: right-click -> 맨 뒤로 보내기 moves front layer to back
        p.mouse.click(ed['x'] + ed['width']/2, ed['y'] + ed['height']/2)  # refocus front
        p.wait_for_timeout(200)
        p.mouse.click(ed['x'] + ed['width']/2, ed['y'] + ed['height']/2, button='right')
        p.wait_for_timeout(250)
        if p.locator('#ctxMenu').is_hidden():
            flags.append('context menu did not open')
        else:
            p.click('#ctxMenu button[data-act=toback]')
            p.wait_for_timeout(300)
            ids = p.evaluate("()=>({order:activeDesign().layers.map(l=>l.id), act:state.activeLayer})")
            if ids['act'] != 0:
                flags.append('toback: active should be 0, got %s' % ids['act'])
            if p.locator('#ctxMenu').is_hidden() is not True:
                flags.append('context menu should close after action')
        # restore: front layer to front again for later checks
        p.mouse.click(ed['x'] + ed['width']/2, ed['y'] + ed['height']/2, button='right')
        p.wait_for_timeout(200)
        if p.locator('#ctxMenu').is_visible():
            p.click('#ctxMenu button[data-act=toback]')  # current front -> back (swaps again? active=0 => no-op)
            p.wait_for_timeout(200)

        # (3b) #1 UI spec (README L13): vertical tool rail LEFT of the canvas +
        #      transform control bar directly ABOVE the canvas (Illustrator style)
        geo = p.evaluate("""()=>{
          const g=id=>{const r=document.getElementById(id).getBoundingClientRect();
            return {x:r.x, y:r.y, r:r.right, b:r.bottom, w:r.width, h:r.height};};
          const railIds=['fileBtn','fitBtn','centerBtn','cropBtn','rmBtn','bgColor'];
          return {canvas:g('editor'),
                  rail: railIds.map(id=>{const e=document.getElementById(id); if(!e) return null;
                      const r=e.getBoundingClientRect(); return {id, x:r.x, y:r.y, w:r.width, h:r.height};}),
                  ctrlItems:['cxIn','cyIn','wIn','rotIn'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();
                      return {id, y:r.y, b:r.bottom, x:r.x};}),
                  align:g('alignSeg'),
                  alignN: document.querySelectorAll('#alignSeg button').length};}""")
        if any(r is None for r in geo['rail']):
            flags.append('rail: missing tool %s' % geo['rail'])
        else:
            cv = geo['canvas']
            for r in geo['rail']:
                if r['x'] >= cv['x']:
                    flags.append('rail %s not LEFT of canvas (%.0f>=%.0f)' % (r['id'], r['x'], cv['x']))
            ys = [r['y'] for r in geo['rail']]
            if ys != sorted(ys):
                flags.append('rail not vertically stacked: %s' % ys)
            if max(r['w'] for r in geo['rail']) > 80:
                flags.append('rail items too wide (not a compact column): %s' % [r['w'] for r in geo['rail']])
        if max(i['b'] for i in geo['ctrlItems']) >= geo['canvas']['y']:
            flags.append('transform inputs not above canvas')
        if geo['align']['b'] >= geo['canvas']['y'] or geo['align']['x'] <= max(i['x'] for i in geo['ctrlItems']):
            flags.append('align seg not in the top control bar')
        if geo['alignN'] != 6:
            flags.append('align needs 6 buttons, got %d' % geo['alignN'])

        # (4) height-fit: selected layer height == wrap.h (w*aspect)
        p.evaluate("()=>{const d=activeDesign(); state.activeLayer=d.layers.length-1; state.sel=[state.activeLayer]; syncActive&&syncActive();}")
        p.click('#hfitBtn')
        p.wait_for_timeout(300)
        fit = p.evaluate("""()=>{const im=state.img; const asp=im.bmp.height/im.bmp.width;
            return {h: Math.round(im.w*asp*10)/10, want: state.wrap.h};}""")
        if abs(fit['h'] - fit['want']) > 0.3:
            flags.append('hfit: height %.2f != wrap %.2f' % (fit['h'], fit['want']))

        # (5) narrow: layersCard above renderCard (CSS order)
        p.set_viewport_size({'width': 900, 'height': 900})
        p.wait_for_timeout(400)
        order = p.evaluate("""()=>({l:getComputedStyle(document.getElementById('layersCard')).order,
            r:getComputedStyle(document.getElementById('renderCard')).order})""")
        if not (int(order['l']) < int(order['r'])):
            flags.append('narrow order: layers %s not above render %s' % (order['l'], order['r']))
        b.close()
    if errs: flags.append('JS errors: %s' % errs[:3])
    if flags:
        print('FAILURES:', flags); return 1
    print('UI4 OK — frontmost focus ✓ context z-menu ✓ #1 layout(rail/ctrlbar) ✓ height-fit ✓ narrow order ✓')
    return 0

if __name__ == '__main__':
    sys.exit(main())
