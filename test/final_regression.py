import asyncio, os, sys
from playwright.async_api import async_playwright
from ui_helpers import open_print, close_print
FAILS=[]
def chk(name, cond, extra=''):
    if cond: print('PASS', name, ('| '+str(extra)) if extra else '', flush=True)
    else: FAILS.append(name); print('FAIL', name, ('| '+str(extra)) if extra else '', flush=True)

INJ = """
window.__bbox = (canvas) => {
  const ctx = canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  const d = ctx.getImageData(0,0,W,H).data;
  let x0=1e9,y0=1e9,x1=-1,y1=-1;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const i=(y*W+x)*4, r=d[i],g=d[i+1],b=d[i+2],a=d[i+3];
    if(a>200 && r>180 && g<110 && b>100){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  }
  return x1<0?null:{x0,y0,x1,y1};
};
'ok'
"""
def rect(cx,cy,w,aspect,W,H,rot=0,mirror=False):
    if rot%180==90: hw=(w*aspect)/2; hh=w/2
    else: hw=w/2; hh=(w*aspect)/2
    mx0,mx1,my0,my1 = cx-hw,cx+hw,cy-hh,cy+hh
    if mirror: mx0,mx1 = W-mx1, W-mx0
    return (max(0,mx0),max(0,my0),min(W,mx1),min(H,my1))

async def check_ed(pg, name, r, tol=5):
    e = await pg.evaluate("(r)=>{const a=mm2e(r[0],r[1]),b=mm2e(r[2],r[3]);return {x0:a[0],y0:a[1],x1:b[0],y1:b[1]};}", list(r))
    g = await pg.evaluate("()=>window.__bbox(document.getElementById('editor'))")
    if not g: chk(name, False, 'no magenta'); return
    ok = all(abs(g[k]-e[k])<=tol for k in ('x0','y0','x1','y1'))
    chk(name, ok, f"got={[round(g[k]) for k in ('x0','y0','x1','y1')]} exp={[round(e[k]) for k in ('x0','y0','x1','y1')]}")

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page(viewport={'width':1440,'height':1000}, device_scale_factor=2)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://'+os.path.abspath('../index.html'))
        await pg.wait_for_timeout(700)
        await pg.evaluate(INJ)
        W,H=205,87

        # no-image: template fits canvas exactly with pad
        t = await pg.evaluate("()=>{const a=mm2e(0,0),b=mm2e(205,87);return {x0:a[0],y0:a[1],x1:b[0],y1:b[1],cw:document.getElementById('editor').width,ch:document.getElementById('editor').height};}")
        chk('no-image template inside canvas with margin',
            t['x0']>=0 and t['y0']>=0 and t['x1']<=t['cw'] and t['y1']<=t['ch'] and t['x0']>20 and t['y0']>20, t)

        # portrait image at cover — outline must be FULLY visible (the original bug)
        await pg.evaluate("""async ()=>{
          const c=document.createElement('canvas'); c.width=1000;c.height=1250;
          const x=c.getContext('2d'); x.fillStyle='#ff00cc'; x.fillRect(0,0,1000,1250);
          const blob=await new Promise(r=>c.toBlob(r,'image/png'));
          await loadFile(new File([blob],'t.png',{type:'image/png'}));
        }""")
        await pg.wait_for_timeout(400)
        aspect=1.25
        out = await pg.evaluate("""()=>{
          const im=state.img; const asp=im.bmp.height/im.bmp.width;
          const hw=im.w/2, hh=(im.w*asp)/2;
          const pts=[[im.cx-hw,im.cy-hh],[im.cx+hw,im.cy-hh],[im.cx-hw,im.cy+hh],[im.cx+hw,im.cy+hh]];
          const px=pts.map(p=>mm2e(p[0],p[1]));
          const cw=document.getElementById('editor').width, ch=document.getElementById('editor').height;
          const hp=handleScreenPos(); const hpx=mm2e(hp[0],hp[1]);
          return {inside: px.every(p=>p[0]>=0&&p[1]>=0&&p[0]<=cw&&p[1]<=ch),
                  hpInside: hpx[0]>=0&&hpx[1]>=0&&hpx[0]<=cw&&hpx[1]<=ch,
                  w:im.w, cw, ch, hp:hpx};
        }""")
        chk('portrait cover: full outline visible in canvas', out['inside'], out)
        chk('portrait cover: resize handle visible/reachable', out['hpInside'], out['hp'])

        # slider sweep bboxes (editor + texture)
        for pct in [100, 50, 150, 400, 25]:
            await pg.evaluate("(p)=>{const s=document.getElementById('scaleR'); s.value=String(p); s.dispatchEvent(new Event('input',{bubbles:true}));}", pct)
            await pg.wait_for_timeout(230)
            w = await pg.evaluate('state.img.w')
            r = rect(W/2,H/2,w,aspect,W,H)
            await check_ed(pg, f'slider {pct}%: editor bbox', r)
            texbb = await pg.evaluate("""()=>{const ppm=tex.width/205; const e=window.__bbox(tex); return e&&{x0:e.x0/ppm,y0:e.y0/ppm,x1:(e.x1+1)/ppm,y1:(e.y1+1)/ppm};}""")
            ok = texbb and all(abs(texbb[k]-r[i])<=1.5 for i,k in enumerate(['x0','y0','x1','y1']))
            chk(f'slider {pct}%: texture bbox', ok, f"tex={texbb and {k:round(v,1) for k,v in texbb.items()}} exp={[round(v,1) for v in r]}")
            # outline always inside canvas at every scale
            ins = await pg.evaluate("""()=>{
              const im=state.img; const asp=im.bmp.height/im.bmp.width;
              const a=im.rot*Math.PI/180, ca=Math.abs(Math.cos(a)), sa=Math.abs(Math.sin(a));
              const hw=(im.w*ca+im.w*asp*sa)/2, hh=(im.w*sa+im.w*asp*ca)/2;
              const pts=[[im.cx-hw,im.cy-hh],[im.cx+hw,im.cy-hh],[im.cx-hw,im.cy+hh],[im.cx+hw,im.cy+hh]];
              const px=pts.map(p=>mm2e(p[0],p[1]));
              const cw=document.getElementById('editor').width, ch=document.getElementById('editor').height;
              return px.every(p=>p[0]>=-1&&p[1]>=-1&&p[0]<=cw+1&&p[1]<=ch+1);
            }""")
            chk(f'slider {pct}%: outline inside canvas', ins)

        # rot 90 outline inside
        await pg.evaluate("()=>{const s=document.getElementById('rotR'); s.value='90'; s.dispatchEvent(new Event('input',{bubbles:true}));}")
        await pg.wait_for_timeout(230)
        ins = await pg.evaluate("""()=>{
          const im=state.img; const asp=im.bmp.height/im.bmp.width;
          const a=im.rot*Math.PI/180, ca=Math.abs(Math.cos(a)), sa=Math.abs(Math.sin(a));
          const hw=(im.w*ca+im.w*asp*sa)/2, hh=(im.w*sa+im.w*asp*ca)/2;
          const pts=[[im.cx-hw,im.cy-hh],[im.cx+hw,im.cy-hh],[im.cx-hw,im.cy+hh],[im.cx+hw,im.cy+hh]];
          const px=pts.map(p=>mm2e(p[0],p[1]));
          const cw=document.getElementById('editor').width, ch=document.getElementById('editor').height;
          return px.every(p=>p[0]>=-1&&p[1]>=-1&&p[0]<=cw+1&&p[1]<=ch+1);
        }""")
        chk('rot90: outline inside canvas', ins)

        # handle remains hittable after all that
        box = await pg.locator('#editor').bounding_box()
        hp = await pg.evaluate('()=>handleScreenPos()')
        hpx = await pg.evaluate('(p)=>mm2e(p[0],p[1])', hp)
        el = await pg.evaluate('(p)=>{const e=document.elementFromPoint(p[0],p[1]); return e?(e.id||e.tagName):\"none\";}', [box['x']+hpx[0]/2, box['y']+hpx[1]/2])
        chk('handle hittable after rot/scale', el=='editor', el)

        # template size change still fine
        await close_print(pg)
        await pg.select_option('#presetSel', '197x89')
        await pg.wait_for_timeout(300)
        cx197, cy197, w197 = await pg.evaluate('[state.img.cx, state.img.cy, state.img.w]')
        r197 = rect(cx197, cy197, w197, aspect, 197, 89, rot=90)
        await check_ed(pg, 'setWrap 197 bbox', r197)

        chk('no JS errors', not errs, errs)
        await b.close()
    return len(FAILS)

sys.exit(1 if asyncio.run(main()) else 0)
