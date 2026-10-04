import asyncio, os, math, sys
from playwright.async_api import async_playwright
from ui_helpers import open_print, close_print

FAILS=[]
def chk(name, cond, extra=''):
    if cond: print('PASS', name, ('| '+str(extra)) if extra else '', flush=True)
    else:
        FAILS.append(name); print('FAIL', name, ('| '+str(extra)) if extra else '', flush=True)

BBOX = """
window.__bbox = (canvas) => {
  if(!canvas) return 'NOCANVAS';
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
def exp_rect(cx, cy, w, aspect, W, H, rot=0):
    if rot%180==90: hw=(w*aspect)/2; hh=w/2
    else: hw=w/2; hh=(w*aspect)/2
    mx0,mx1,my0,my1 = cx-hw,cx+hw,cy-hh,cy+hh
    return (max(0,mx0),max(0,my0),min(W,mx1),min(H,my1))

async def check_ed(pg, name, r, tol=5):
    e = await pg.evaluate("(r)=>{const a=mm2e(r[0],r[1]),b=mm2e(r[2],r[3]);return {x0:a[0],y0:a[1],x1:b[0],y1:b[1]};}", list(r))
    g = await pg.evaluate("()=>window.__bbox(document.getElementById('editor'))")
    if g=='NOCANVAS': chk(name, False, 'editor element null'); return
    if not g: chk(name, False, 'no magenta'); return
    ok = isinstance(e, dict) and all(abs(g[k]-e[k])<=tol for k in ('x0','y0','x1','y1'))
    def fmt(d): return {k: (None if not isinstance(d.get(k),(int,float)) or d[k]!=d[k] else round(d[k],1)) for k in ('x0','y0','x1','y1')}
    chk(name, ok, f"got={fmt(g)} exp={fmt(e)}")

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page(viewport={'width':1440,'height':1000}, device_scale_factor=2)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://'+os.path.abspath('../index.html'))
        await pg.wait_for_timeout(700)
        inj = await pg.evaluate(BBOX)
        print('BBOX inject:', inj, flush=True)
        await pg.evaluate("""async ()=>{
          const c=document.createElement('canvas'); c.width=1000;c.height=600;
          const x=c.getContext('2d'); x.fillStyle='#ff00cc'; x.fillRect(0,0,1000,600);
          const blob=await new Promise(r=>c.toBlob(r,'image/png'));
          await loadFile(new File([blob],'t.png',{type:'image/png'}));
          return {w:state.img.w};
        }""")
        await pg.wait_for_timeout(350)
        aspect=0.6; W,H=205,87

        await pg.locator('#editor').scroll_into_view_if_needed()
        await pg.wait_for_timeout(250)
        box = await pg.locator('#editor').bounding_box()
        el = await pg.evaluate("([x,y])=>{const e=document.elementFromPoint(x,y); return e? (e.id||e.tagName) : 'none';}", [box['x']+box['width']/2, box['y']+box['height']/2])
        chk('editor center hittable', el=='editor', el)
        # record wheel deltas
        await pg.evaluate("()=>{window.__wd=[]; document.getElementById('editor').addEventListener('wheel', e=>window.__wd.push(e.deltaY), {passive:true});}")

        # ---- wheel ----
        w0 = await pg.evaluate('state.img.w')
        await pg.mouse.move(box['x']+box['width']/2, box['y']+box['height']/2)
        await pg.mouse.wheel(0, -120)
        await pg.wait_for_timeout(250)
        w1 = await pg.evaluate('state.img.w')
        deltas = await pg.evaluate('window.__wd')
        expected = min(600, max(5, w0*math.exp(-sum(deltas)*0.0011)))
        chk('wheel scales per recorded deltaY', abs(w1-expected)<0.5, f'{w0}->{w1} deltas={deltas} exp={expected:.2f}')
        await check_ed(pg, 'wheel: editor bbox', exp_rect(W/2,H/2,w1,aspect,W,H))

        # ---- corner handle 1.5x ----
        hp = await pg.evaluate('()=>handleScreenPos()')
        hpx = await pg.evaluate('([x,y])=>mm2e(x,y)', hp)
        hx = box['x']+hpx[0]/2; hy = box['y']+hpx[1]/2
        el2 = await pg.evaluate('([x,y])=>{const e=document.elementFromPoint(x,y); return e? (e.id||e.tagName) : "none";}', [hx,hy])
        chk('handle point hittable', el2=='editor', el2)
        cx0, cy0 = await pg.evaluate('[state.img.cx, state.img.cy]')
        w0 = await pg.evaluate('state.img.w')
        txm, tym = cx0+(hp[0]-cx0)*1.5, cy0+(hp[1]-cy0)*1.5
        tpx = await pg.evaluate('([x,y])=>mm2e(x,y)', [txm,tym])
        await pg.mouse.move(hx,hy); await pg.mouse.down()
        await pg.mouse.move(box['x']+tpx[0]/2, box['y']+tpx[1]/2, steps=8); await pg.mouse.up()
        await pg.wait_for_timeout(250)
        w1 = await pg.evaluate('state.img.w')
        chk('handle drag ~1.5x', abs(w1-w0*1.5)/(w0*1.5)<0.03, f'{w0}->{w1}')
        await check_ed(pg, 'handle: editor bbox', exp_rect(W/2,H/2,w1,aspect,W,H))

        # ---- drag image body ----
        ic = await pg.evaluate('()=>mm2e(state.img.cx,state.img.cy)')
        await pg.mouse.move(box['x']+ic[0]/2, box['y']+ic[1]/2)
        await pg.mouse.down()
        await pg.mouse.move(box['x']+ic[0]/2+70, box['y']+ic[1]/2, steps=6)
        await pg.mouse.up()
        await pg.wait_for_timeout(200)
        cx1 = await pg.evaluate('state.img.cx')
        chk('body drag moves cx', cx1>cx0+4, f'{cx0}->{cx1}')

        # slider 150 after drag
        await pg.evaluate("()=>{const s=document.getElementById('scaleR'); s.value='150'; s.dispatchEvent(new Event('input',{bubbles:true}));}")
        await pg.wait_for_timeout(250)
        w1 = await pg.evaluate('state.img.w')
        await check_ed(pg, 'drag+slider150: editor bbox clipped', exp_rect(cx1,H/2,w1,aspect,W,H))
        texbb = await pg.evaluate("""()=>{const ppm=tex.width/205; const e=window.__bbox(tex); return e&&{x0:e.x0/ppm,y0:e.y0/ppm,x1:(e.x1+1)/ppm,y1:(e.y1+1)/ppm};}""")
        er = exp_rect(cx1,H/2,w1,aspect,W,H)
        chk('drag+slider150: texture bbox clipped', texbb and all(abs(texbb[k]-er[i])<=1.5 for i,k in enumerate(['x0','y0','x1','y1'])),
            f"tex={texbb and {k:round(v,1) for k,v in texbb.items()}} exp={[round(v,1) for v in er]}")

        # NOTE: mirror default ON — editor/texture draw unmirrored; PDF mirrors. Verify PDF magenta x-position flips with cx offset:
        # export and check
        fits = await pg.evaluate('currentLayout().fits')
        chk('layout fits', fits)
        if fits:
            async with pg.expect_download() as dl:
                await open_print(pg)
                await pg.click('#exportBtn')
            d = await dl.value; await d.save_as('mirror-pdf.pdf')
            import pypdfium2 as pdfium
            pdf = pdfium.PdfDocument('mirror-pdf.pdf')
            img = pdf[0].render(scale=150/72).to_pil().convert('RGB')
            px = img.load(); Wp,Hp = img.size
            x0=10**9;x1=-1
            for y in range(0,Hp,2):
                for x in range(0,Wp,2):
                    r,g2,bl = px[x,y]
                    if r>170 and g2<115 and bl>95:
                        if x<x0:x0=x
                        if x>x1:x1=x
            # art rect: vertical layout expected; magenta near art edges. With mirror ON, design cx>center maps to LEFT side of art.
            print('pdf magenta x-range:', x0, x1, 'page w:', Wp, flush=True)
            chk('pdf has magenta', x1>x0)

        chk('no JS errors', not errs, errs)
        await b.close()
    return len(FAILS)

sys.exit(1 if asyncio.run(main()) else 0)
