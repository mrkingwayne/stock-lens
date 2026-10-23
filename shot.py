import sys
from playwright.sync_api import sync_playwright
base=sys.argv[1]; ts=sys.argv[2:]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
    for t in ts:
        for n,w,m in [("desktop",1440,False),("mobile",390,True)]:
            pg=b.new_page(viewport={"width":w,"height":900},device_scale_factor=2 if m else 1,is_mobile=m,has_touch=m)
            errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
            pg.goto(f"{base}#{t}"); pg.wait_for_selector("#chart canvas",timeout=40000); pg.wait_for_timeout(1500)
            pg.screenshot(path=f"shot_{t}_{n}.png",full_page=True); print(t,n,"errors:",errs, pg.inner_text(".sc")[:120].replace("\n"," "))
    b.close()
