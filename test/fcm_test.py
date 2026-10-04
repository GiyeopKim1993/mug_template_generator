#!/usr/bin/env python3
"""FCM export test: Brother cut list export must emit .fcm alongside .dxf/.svg.
The generated .fcm is cross-validated with the independent svg2fcm (MPL-2.0) parser.
Run from repo root: python3 test/fcm_test.py"""
import os, sys, glob, subprocess, tempfile
from playwright.sync_api import sync_playwright

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'uploads')
SVG2FCM_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor')
flags = []

def main():
    if not os.path.isdir(SVG2FCM_SRC):
        print('SKIP: svg2fcm reference parser not present at', SVG2FCM_SRC); return 0
    tmp = tempfile.mkdtemp(prefix='fcmtest_')
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page(viewport={'width': 1400, 'height': 900})
        errs = []
        p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto('http://localhost:8080/index.html')
        p.wait_for_timeout(600)
        p.set_input_files('#fileIn', os.path.join(BASE, 'cat1.png'))
        p.wait_for_timeout(1500)
        # one draft, brother + cut mode
        p.evaluate("()=>{document.getElementById('draftSaveN').value='1';}")
        p.click('#draftSaveBtn'); p.wait_for_timeout(300)
        p.evaluate("()=>{state.machine='brother'; state.mode='cut'; state.orient='h'; updateExportUI&&updateExportUI();}")
        p.wait_for_timeout(300)
        dl = []
        p.on('download', lambda d: dl.append(d))
        p.click('#printOpen'); p.wait_for_selector('#printModal.open')
        p.click('#scopeSeg button[data-v=list]'); p.wait_for_timeout(2500)
        cut = p.locator('#bmCut')
        if cut.count() and not cut.is_checked():
            cut.check()
        p.wait_for_function("()=>!document.getElementById('printModal').classList.contains('busy')", timeout=40000)
        p.click('#exportBtn')
        # quiet-stream: wait until no new file for 5 consecutive polls
        prev, quiet = -1, 0
        for _ in range(120):
            p.wait_for_timeout(300)
            if len(dl) == prev:
                quiet += 1
                if quiet >= 5 and len(dl) > 0: break
            else:
                quiet, prev = 0, len(dl)
        p.wait_for_timeout(800)
        for d in dl:
            d.save_as(os.path.join(tmp, d.suggested_filename))
        b.close()
    if errs: flags.append('JS errors: %s' % errs[:3])
    names = sorted(os.path.basename(x) for x in glob.glob(tmp + '/*'))
    print('downloads:', names)
    fcm = [x for x in names if x.endswith('.fcm')]
    dxf = [x for x in names if x.endswith('.dxf')]
    svg = [x for x in names if x.endswith('.svg')]
    if not fcm: flags.append('no .fcm file in cut export (got %s)' % names)
    if not dxf: flags.append('no .dxf (got %s)' % names)
    if not svg: flags.append('no .svg (got %s)' % names)
    # cross-validate with svg2fcm
    if fcm:
        fp = os.path.join(tmp, fcm[0])
        code = r'''
import sys, json, dataclasses
sys.path.insert(0, %r)
from svg2fcm.fcm.parser import parse_fcm
f = parse_fcm(open(sys.argv[1], "rb").read())
h, c = f.header, f.cut_data
assert h.variant in ("FCM", "#FCM"), h.variant
assert h.version == "0100", h.version
assert c.file_type in ("Cut", 16), c.file_type   # svg2fcm keeps raw enum
assert (c.cut_width, c.cut_height) == (21000, 29700), (c.cut_width, c.cut_height)
assert len(f.pieces) >= 1, "no pieces"
tot_paths = 0; tot_segs = 0; bad = 0
for pid, pc in f.pieces:
    assert pc.width > 0 and pc.height > 0
    cx, cy = pc.transform[4], pc.transform[5]
    for pa in pc.paths:
        tot_paths += 1
        pts = [(pa.shape.start.x + cx, pa.shape.start.y + cy)]
        for ol in pa.shape.outlines:
            for s in ol.segments:
                tot_segs += 1
                e = s.end
                pts.append((e.x + cx, e.y + cy))
        for (x, y) in pts:
            if not (-500 <= x <= 21500 and -500 <= y <= 30200): bad += 1
assert tot_paths >= 1 and tot_segs >= 4, (tot_paths, tot_segs)
assert bad == 0, "out-of-page points: %%d" %% bad
print("svg2fcm OK pieces=%%d paths=%%d segs=%%d" %% (len(f.pieces), tot_paths, tot_segs))
''' % SVG2FCM_SRC
        r = subprocess.run([sys.executable, '-c', code, fp], capture_output=True, text=True)
        print(r.stdout.strip() or r.stderr.strip()[-400:])
        if r.returncode != 0: flags.append('svg2fcm validation failed: ' + (r.stderr or r.stdout)[-300:])

    if flags:
        print('FAILURES:', flags); return 1
    print('FCM TEST OK — .fcm exported, cross-parsed by svg2fcm, geometry in page bounds')
    return 0

if __name__ == '__main__':
    sys.exit(main())
