import asyncio, os, sys, math
from playwright.async_api import async_playwright
FAILS=[]
def chk(name, cond, extra=''):
    if cond: print('PASS', name, ('| '+str(extra)) if extra else '', flush=True)
    else: FAILS.append(name); print('FAIL', name, ('| '+str(extra)) if extra else '', flush=True)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page(viewport={'width':1440,'height':1000}, device_scale_factor=2)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://'+os.path.abspath('../index.html'))
        await pg.wait_for_timeout(800)
        await pg.locator('#mug3d').scroll_into_view_if_needed()
        await pg.wait_for_timeout(200)

        st = await pg.evaluate('()=>({zoom:mug.zoom,panX:mug.panX,pitch:mug.pitch,roll:mug.roll,auto:mug.auto,speed:mug.speed})')
        chk('defaults', abs(st['zoom']-1)<1e-9 and st['panX']==0 and abs(st['pitch']-math.asin(0.16))<1e-9 and st['auto'] and abs(st['speed']-0.2)<1e-9, st)

        # ---- upload solid magenta (portrait cover) for arc test ----
        await pg.evaluate("""async ()=>{
          const c=document.createElement('canvas'); c.width=600; c.height=1400;
          const x=c.getContext('2d'); x.fillStyle='#ff00cc'; x.fillRect(0,0,600,1400);
          const blob=await new Promise(r=>c.toBlob(r,'image/png'));
          await loadFile(new File([blob],'t.png',{type:'image/png'}));
        }""")
        await pg.wait_for_timeout(500)
        # freeze turntable, handle at back so front columns are clean
        await pg.uncheck('#autoSpin')
        await pg.evaluate('()=>{ mug.th = Math.PI; }')
        await pg.wait_for_timeout(250)

        # ---- BAND ARC: band top edge must dip toward viewer at centre (wrapped transfer) ----
        arc = await pg.evaluate("""()=>{
          const ctx = document.getElementById('mug3d');
          const W=ctx.width, H=ctx.height;
          const g = ctx.getContext('2d');
          const d = g.getImageData(0,0,W,H).data;
          const isMag = i => d[i+3]>200 && d[i]>180 && d[i+1]<110 && d[i+2]>100;
          const topAt = x0=>{
            for(let y=0;y<H;y++){ if(isMag((y*W+x0)*4)) return y; }
            return -1;
          };
          // find mug centre column = magenta column midpoint
          let lx=-1, rx=-1;
          for(let x=0;x<W;x++){ if(topAt(x)>=0){ if(lx<0)lx=x; rx=x; } }
          const cx = Math.round((lx+rx)/2);
          const r  = (rx-lx)/2;
          const yc = topAt(cx);
          const ye = topAt(Math.round(cx - 0.6*r));
          const ye2= topAt(Math.round(cx + 0.6*r));
          return {lx,rx,cx,r,yc,ye,ye2};
        }""")
        if arc['r'] < 40: chk('arc: mug drawn big enough', False, arc)
        else:
            d = arc['yc'] - min(arc['ye'], arc['ye2'])
            # expected ~ r*sin(pitch)*(1-0.8) = 0.032r
            exp = 0.032*arc['r']
            # row-quantised dip: tolerate +-1px, keep proportional floor
            chk('band top edge arcs down at centre (transfer wraps cylinder)',
                d >= 1 and (d+1) >= 0.4*exp, f"d={d} exp≈{exp:.1f} {arc}")

        # ---- orbit drag (yaw) ----
        box = await pg.locator('#mug3d').bounding_box()
        cxp, cyp = box['x']+box['width']/2, box['y']+box['height']/2
        th0 = await pg.evaluate('mug.th')
        await pg.mouse.move(cxp, cyp); await pg.mouse.down()
        await pg.mouse.move(cxp-90, cyp, steps=8)
        await pg.mouse.up(); await pg.wait_for_timeout(120)
        th1 = await pg.evaluate('mug.th')
        chk('drag = yaw rotation', th1 != th0, f'{th0:.3f}->{th1:.3f}')

        # ---- vertical drag adjusts pitch (clamped) ----
        p0 = await pg.evaluate('mug.pitch')
        await pg.mouse.move(cxp, cyp); await pg.mouse.down()
        await pg.mouse.move(cxp, cyp-150, steps=8)
        await pg.mouse.up(); await pg.wait_for_timeout(120)
        p1 = await pg.evaluate('mug.pitch')
        chk('vertical drag = camera elevation', p1 > p0 and p1 <= 0.62, f'{p0:.3f}->{p1:.3f}')

        # ---- shift+drag = pan ----
        await pg.evaluate('()=>{mug.th=Math.PI; mug.panX=0; mug.panY=0;}')
        await pg.keyboard.down('Shift')
        await pg.mouse.move(cxp, cyp); await pg.mouse.down()
        await pg.mouse.move(cxp+70, cyp+40, steps=6)
        await pg.mouse.up()
        await pg.keyboard.up('Shift')
        await pg.wait_for_timeout(120)
        pv = await pg.evaluate('()=>({x:mug.panX,y:mug.panY,th:mug.th})')
        # y-pan is fit-clamped tighter now that the render stage is compact (190/210px)
        chk('shift+drag = pan (yaw untouched)', pv['x']>30 and pv['y']>10 and abs(pv['th']-math.pi)<1e-9, pv)

        # ---- right-button drag = pan ----
        await pg.evaluate('()=>{mug.panX=0; mug.panY=0;}')
        await pg.mouse.move(cxp, cyp); await pg.mouse.down(button='right')
        await pg.mouse.move(cxp-50, cyp-30, steps=6)
        await pg.mouse.up(button='right')
        await pg.wait_for_timeout(120)
        pv = await pg.evaluate('()=>({x:mug.panX,y:mug.panY})')
        chk('right-drag = pan', pv['x']<-20 and pv['y']<-10, pv)

        # ---- ctrl+drag = roll ----
        await pg.evaluate('()=>{mug.roll=0;}')
        await pg.keyboard.down('Control')
        await pg.mouse.move(cxp, cyp); await pg.mouse.down()
        await pg.mouse.move(cxp+80, cyp, steps=6)
        await pg.mouse.up()
        await pg.keyboard.up('Control')
        await pg.wait_for_timeout(120)
        rl = await pg.evaluate('mug.roll')
        chk('ctrl+drag = roll', rl > 0.1, rl)

        # ---- wheel = zoom, clamped (fit-view: reset first so roll isn't capping) ----
        await pg.dblclick('#mug3d')
        await pg.wait_for_timeout(80)
        await pg.mouse.move(cxp, cyp)
        z0 = await pg.evaluate('mug.zoom')
        await pg.mouse.wheel(0, -240)
        await pg.wait_for_timeout(80)
        z1 = await pg.evaluate('mug.zoom')
        await pg.mouse.wheel(0, 5000)
        await pg.wait_for_timeout(80)
        zmin = await pg.evaluate('mug.zoom')
        chk('wheel zoom in/out + clamp', z1 > z0 and zmin >= 0.4, f'{z0:.3f}->{z1:.3f}->{zmin:.3f}')

        # ---- fit clamp: runaway zoom/pan never leave the mug off-canvas ----
        z = await pg.evaluate("""()=>{
          mug.zoom=9; mug.panX=9999; mug.panY=-9999; mug.roll=0.7; clampView();
          const b=viewBounds(), d=devicePixelRatio||1, W=stage.width, H=stage.height;
          const cr=Math.cos(Math.abs(mug.roll)), sr=Math.sin(Math.abs(mug.roll));
          const bw=b.w0*cr+b.h0*sr, bh=b.w0*sr+b.h0*cr;
          const fits = bw*mug.zoom <= W-20 && bh*mug.zoom <= H-20;
          return {zoom:mug.zoom, px:mug.panX, py:mug.panY, fits};
        }""")
        chk('fit clamp caps zoom+pan (mug stays fully visible)',
            z['zoom'] < 3.2 and z['fits'] and abs(z['px']) < 5000 and abs(z['py']) < 5000, z)
        await pg.evaluate('()=>{mug.roll=0; clampView();}')

        # ---- dblclick = reset ----
        await pg.dblclick('#mug3d')
        await pg.wait_for_timeout(100)
        st = await pg.evaluate('()=>({zoom:mug.zoom,panX:mug.panX,panY:mug.panY,pitch:mug.pitch,roll:mug.roll})')
        chk('dblclick resets view',
            abs(st['zoom']-1)<1e-9 and st['panX']==0 and st['panY']==0
            and abs(st['pitch']-math.asin(0.16))<1e-9 and abs(st['roll'])<1e-9, st)

        # ---- turntable: auto spin + speed ----
        await pg.check('#autoSpin')
        th0 = await pg.evaluate('mug.th')
        await pg.wait_for_timeout(500)
        th1 = await pg.evaluate('mug.th')
        d_slow = (th1-th0) % (2*math.pi)
        await pg.select_option('#spinSpd', '0.45')
        await pg.wait_for_timeout(50)
        th0 = await pg.evaluate('mug.th')
        await pg.wait_for_timeout(500)
        th1 = await pg.evaluate('mug.th')
        d_fast = (th1-th0) % (2*math.pi)
        spd = await pg.evaluate('mug.speed')
        chk('turntable spins', 0.05 < d_slow < 0.30, f'delta={d_slow:.3f} (≈0.20*0.5)')
        chk('turntable speed select', abs(spd-0.45)<1e-9 and d_fast > d_slow*1.5, f'speed={spd} fastDelta={d_fast:.3f} vs {d_slow:.3f}')

        # ---- flick momentum (turntable off) ----
        await pg.uncheck('#autoSpin')
        await pg.evaluate('()=>{mug.th=Math.PI; mug.spinVel=0;}')
        await pg.wait_for_timeout(80)
        await pg.mouse.move(cxp, cyp); await pg.mouse.down()
        for i in range(6):
            await pg.mouse.move(cxp - 25*(i+1), cyp, steps=1)
        await pg.mouse.up()
        await pg.wait_for_timeout(50)
        sv = await pg.evaluate('mug.spinVel')
        thA = await pg.evaluate('mug.th')
        await pg.wait_for_timeout(600)
        thB = await pg.evaluate('mug.th')
        svB = await pg.evaluate('mug.spinVel')
        chk('flick momentum continues spin after release', sv != 0 and abs(thB-thA) > 0.05,
            f'sv0={sv:.3f} dth={(thB-thA):.3f} svEnd={svB:.3f}')

        chk('no JS errors', not errs, errs)
        await pg.screenshot(path='mug3d-final.png', full_page=False)
        await b.close()
    return len(FAILS)

sys.exit(1 if asyncio.run(main()) else 0)
