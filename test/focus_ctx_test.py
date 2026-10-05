import asyncio, os, sys
from playwright.async_api import async_playwright

FAILS = []
def chk(name, cond, extra=''):
    if cond: print('PASS', name, ('| '+str(extra)) if extra else '', flush=True)
    else:
        FAILS.append(name); print('FAIL', name, ('| '+str(extra)) if extra else '', flush=True)

# two stacked layers: A (magenta, big) then B (blue, smaller, right half)
ADD = """async (col)=>{
  const c=document.createElement('canvas'); c.width=800; c.height=600;
  const x=c.getContext('2d'); x.fillStyle=col; x.fillRect(0,0,800,600);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));
  await loadFile(new File([blob],'t.png',{type:'image/png'}));
  return {n:activeDesign().layers.length, act:state.activeLayer};
}"""
SPY = """()=>{
  window.__sched=0;
  const o=window.scheduleDraws;
  if(typeof o==='function'){ window.scheduleDraws=function(){ window.__sched++; return o.apply(this,arguments); }; }
  return typeof o==='function';
}"""
GET = "()=>({act:state.activeLayer, img:state.img===activeLayer(), n:activeDesign().layers.length, sel:[...state.sel]})"

async def mmOf(pg, mmx, mmy):
    # mm -> client coords (uses live edBox mapping)
    return await pg.evaluate("""([mx,my])=>{
      const r=document.getElementById('editor').getBoundingClientRect();
      const px = mx*edBox.s + edBox.ox, py = my*edBox.s + edBox.oy;   // device px
      return {x:r.left + px/dpr, y:r.top + py/dpr};
    }""", [mmx, mmy])

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page(viewport={'width':1500,'height':1000}, device_scale_factor=2)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://'+os.path.abspath('../index.html'))
        await pg.wait_for_timeout(600)

        print('add A:', await pg.evaluate(ADD, '#ff00cc'), flush=True)
        print('add B:', await pg.evaluate(ADD, '#0044ff'), flush=True)
        # after 2nd add: active = B (top). Move B to the RIGHT so left part shows only A
        await pg.evaluate("()=>{const L=activeDesign().layers[1]; L.cx += L.w*0.55; scheduleDraws();}")
        await pg.wait_for_timeout(150)

        spy = await pg.evaluate(SPY)
        chk('spy-installed', spy)

        # ---- #6a: active=B(top, right). click LEFT part (only A visible) -> focus A ----
        await pg.evaluate("()=>{state.activeLayer=1; state.sel=[1]; syncActive(); renderLayers(); scheduleDraws();}")
        await pg.wait_for_timeout(100)
        before = await pg.evaluate(GET)
        p = await mmOf(pg, 70, 44)   # inside A, left of B
        s0 = await pg.evaluate("()=>window.__sched")
        await pg.mouse.click(p['x'], p['y'])
        await pg.wait_for_timeout(250)
        after = await pg.evaluate(GET)
        s1 = await pg.evaluate("()=>window.__sched")
        chk('f6-focus-switches-to-A', after['act'] == 0, f"before={before['act']} after={after['act']}")
        chk('f6-canvas-redraw-on-focus', s1 > s0, f"sched {s0}->{s1}")

        # ---- #6b: click right part (B visible, front-most) -> focus B ----
        s0 = await pg.evaluate("()=>window.__sched")
        p = await mmOf(pg, 166, 44)   # inside B (front-most)
        await pg.mouse.click(p['x'], p['y'])
        await pg.wait_for_timeout(250)
        after = await pg.evaluate(GET)
        s1 = await pg.evaluate("()=>window.__sched")
        chk('f6-focus-switches-to-B', after['act'] == 1, f"act={after['act']}")
        chk('f6-canvas-redraw-on-focus-2', s1 > s0, f"sched {s0}->{s1}")

        # ---- #7a: right-click on image B (top layer, index 1) -> ctx menu visible ----
        p = await mmOf(pg, 166, 44)
        await pg.mouse.click(p['x'], p['y'], button='right')
        await pg.wait_for_timeout(250)
        st = await pg.evaluate("""()=>{
          const m=document.getElementById('ctxMenu');
          if(!m) return {exists:false};
          const r=m.getBoundingClientRect();
          return {exists:true, hidden:m.hidden, vis:r.width>0&&r.height>0, x:r.x, y:r.y,
                  focus:state.activeLayer};
        }""")
        chk('f7-menu-opens', st.get('exists') and not st.get('hidden') and st.get('vis'), f"{st}")

        # ---- #7b: menu action "뒤로 보내기" actually reorders ----
        if st.get('exists') and not st.get('hidden'):
            order0 = await pg.evaluate("()=>activeDesign().layers.map((l,i)=>i)")
            act0 = await pg.evaluate("()=>state.activeLayer")
            await pg.click('#ctxMenu button[data-act="back"]')
            await pg.wait_for_timeout(200)
            r = await pg.evaluate("()=>({act:state.activeLayer, hidden:document.getElementById('ctxMenu').hidden})")
            chk('f7-back-reorders', r['act'] == act0 - 1 and act0 > 0, f"act {act0}->{r['act']}")
            chk('f7-menu-closes-after-action', r['hidden'])
        else:
            chk('f7-back-reorders', False, 'menu never opened')

        # ---- #7d: right-click bottom layer -> 'back' disabled (visible no-op) ----
        await pg.evaluate("()=>{document.getElementById('ctxMenu').hidden=true;}")
        p = await mmOf(pg, 166, 44)   # after reorder, B sits at index 0 (back-most) at x=166
        await pg.mouse.click(p['x'], p['y'], button='right')
        await pg.wait_for_timeout(200)
        d = await pg.evaluate("()=>({open:!document.getElementById('ctxMenu').hidden, dis:document.getElementById('ctxMenu').querySelector('button').disabled})")
        chk('f7-back-disabled-at-bottom', d['open'] and d['dis'], f"{d}")
        await pg.keyboard.press('Escape')

        # ---- #7c: right-click on EMPTY area -> no menu ----
        await pg.evaluate("()=>{document.getElementById('ctxMenu').hidden=true;}")
        p = await mmOf(pg, 103, 95)   # below template, no layers
        await pg.mouse.click(p['x'], p['y'], button='right')
        await pg.wait_for_timeout(200)
        hid = await pg.evaluate("()=>document.getElementById('ctxMenu').hidden")
        chk('f7-no-menu-on-empty', hid is True)

        chk('no-page-errors', len(errs) == 0, '; '.join(errs[:3]))
        await b.close()
    print('=' * 8, 'FAILS:', FAILS, flush=True)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
