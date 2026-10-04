import asyncio, os, sys
from playwright.async_api import async_playwright
FAILS=[]
def chk(name, cond, extra=''):
    if cond: print('PASS', name, ('| '+str(extra)) if extra else '', flush=True)
    else: FAILS.append(name); print('FAIL', name, ('| '+str(extra)) if extra else '', flush=True)

SAMPLE = """
([r]) => {
  // sample the TEXTURE (pure artwork source for editor/3D/PDF — no UI overlays)
  const ctx = tex;
  const g = ctx.getContext('2d');
  const [mx0,my0,mx1,my1] = r;
  const M = 8; // mm margin (outline/labels live only in editor; notch radius 7mm)
  const cxT = state.wrap.w/2, cyT = state.wrap.h/2;
  const ppm = tex.width/state.wrap.w;
  let tot=0, bad=0, badpts=[];
  for(let mx=mx0+M; mx<=mx1-M; mx+=2.5){
    for(let my=my0+M; my<=my1-M; my+=2.5){
      if(Math.abs(mx-cxT)<2 || Math.abs(my-cyT)<2) continue;
      const px=Math.round(mx*ppm), py=Math.round(my*ppm);
      const d = g.getImageData(px,py,1,1).data;
      tot++;
      const isMag = d[3]>200 && d[0]>180 && d[1]<110 && d[2]>100;
      if(!isMag){ bad++; if(badpts.length<6) badpts.push([mx,my,[d[0],d[1],d[2],d[3]]]); }
    }
  }
  return {tot, bad, badpts};
}
"""
def rect(cx,cy,w,aspect,W,H,rot=0):
    if rot%180==90: hw=(w*aspect)/2; hh=w/2
    else: hw=w/2; hh=(w*aspect)/2
    return (max(0,cx-hw),max(0,cy-hh),min(W,cx+hw),min(H,cy+hh))

async def load_magenta(pg, W, Hh):
    await pg.evaluate("""async ([W,Hh])=>{
      if(state.img && state.img.bmp && state.img.bmp.close) {}
      const c=document.createElement('canvas'); c.width=W;c.height=Hh;
      const x=c.getContext('2d'); x.fillStyle='#ff00cc'; x.fillRect(0,0,W,Hh);
      const blob=await new Promise(r=>c.toBlob(r,'image/png'));
      await loadFile(new File([blob],'t.png',{type:'image/png'}));
    }""", [W,Hh])
    await pg.wait_for_timeout(400)

async def set_scale(pg, pct):
    await pg.evaluate("(p)=>{const s=document.getElementById('scaleR'); s.value=String(p); s.dispatchEvent(new Event('input',{bubbles:true}));}", pct)
    await pg.wait_for_timeout(230)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page(viewport={'width':1440,'height':1000}, device_scale_factor=2)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://'+os.path.abspath('../index.html'))
        await pg.wait_for_timeout(700)
        W,H = 205,87
        for (iw,ih,label) in [(1000,600,'landscape 0.60'), (1000,1250,'portrait 1.25'), (174,410,'phone 2.356')]:
            aspect = ih/iw
            await load_magenta(pg, iw, ih)
            # cover default
            for pct in [None, 50, 150, 400, 25]:
                if pct is None:
                    w = await pg.evaluate('state.img.w')
                    tag='cover'
                else:
                    await set_scale(pg, pct)
                    w = await pg.evaluate('state.img.w')
                    tag=f'{pct}%'
                r = rect(W/2,H/2,w,aspect,W,H)
                res = await pg.evaluate(SAMPLE, [list(r), aspect])
                frac = res['bad']/max(res['tot'],1)
                chk(f'{label} {tag}: interior all magenta', res['tot']>30 and frac<0.012,
                    f"bad={res['bad']}/{res['tot']} pts={res['badpts']}")
            # rotation 90 at cover
            await pg.evaluate("()=>{const s=document.getElementById('rotR'); s.value='90'; s.dispatchEvent(new Event('input',{bubbles:true}));}")
            await pg.wait_for_timeout(230)
            w = await pg.evaluate('state.img.w')
            r = rect(W/2,H/2,w,aspect,W,H,rot=90)
            res = await pg.evaluate(SAMPLE, [list(r), aspect])
            frac = res['bad']/max(res['tot'],1)
            chk(f'{label} rot90: interior all magenta', res['tot']>30 and frac<0.012,
                f"bad={res['bad']}/{res['tot']} pts={res['badpts']}")
            # reset rot
            await pg.evaluate("()=>{const s=document.getElementById('rotR'); s.value='0'; s.dispatchEvent(new Event('input',{bubbles:true}));}")
            await pg.wait_for_timeout(200)
        chk('no JS errors', not errs, errs)
        await b.close()
    return len(FAILS)
sys.exit(1 if asyncio.run(main()) else 0)
