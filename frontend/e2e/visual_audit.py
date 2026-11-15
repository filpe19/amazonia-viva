"""Mission 05: real-browser visual evidence against the existing local servers."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("phase", choices=["before", "after"])
parser.add_argument("--diagnose-map", action="store_true")
args = parser.parse_args()
out = Path(__file__).resolve().parents[2] / "docs" / "mission05" / args.phase
out.mkdir(parents=True, exist_ok=True)
routes = [("current", "/?regiao=para"), ("history", "/historico?regiao=portel"),
          ("territory", "/territorio?regiao=portel"), ("environment", "/ambiente?regiao=portel"),
          ("evidence", "/evidencias?regiao=portel"), ("report", "/ficha/portel?regiao=portel")]
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                                headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    if args.diagnose_map:
        page=browser.new_page(viewport={"width":1440,"height":900})
        page.on("console", lambda m: print("console", m.type, m.text[:600], flush=True) if m.type in ("warning","error") else None)
        page.on("requestfailed", lambda r: print("requestfailed",r.url.split('?')[0],r.failure,flush=True))
        page.goto('http://127.0.0.1:5710/?regiao=para',wait_until='domcontentloaded')
        page.wait_for_timeout(10000)
        print(page.evaluate("""() => {
            const el=document.querySelector('[role=application]');
            let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];
            while(f){let h=f.memoizedState;while(h){const m=h.memoizedState?.current;if(m?.getStyle){window.__qaMap=m;return {ready:m.loaded(),styleLoaded:m.isStyleLoaded(),zoom:m.getZoom(),center:m.getCenter(),bounds:m.getBounds(),padding:m.getPadding(),layers:m.getStyle().layers.map(l=>l.id),source:m.getSource('det')?._data?.features?.length,tiles:m.areTilesLoaded(),canvas:m.getCanvas().getBoundingClientRect().toJSON()}}h=h.next}f=f.return}return 'map not found'}"""),flush=True)
        page.screenshot(path=str(out/'map-diagnostic.png'))
        page.evaluate("window.__qaMap?.resize(); window.__qaMap?.triggerRepaint()")
        page.wait_for_timeout(1500)
        page.screenshot(path=str(out/'map-diagnostic-repaint.png'))
        browser.close()
        raise SystemExit(0)
    for device, width, height in [("desktop", 1440, 900), ("mobile", 390, 844)]:
        context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
        for name, route in routes:
            page = context.new_page()
            errors, failures, console_errors, request_failures = [], [], [], []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: console_errors.append(m.text) if m.type == 'error' else None)
            page.on("requestfailed", lambda r: request_failures.append({"url":r.url.split('?')[0],"failure":r.failure}) if r.failure != 'net::ERR_ABORTED' else None)
            page.on("response", lambda r: failures.append({"status": r.status, "url": r.url.split("?")[0]}) if r.status >= 400 else None)
            page.goto("http://127.0.0.1:5710" + route, wait_until="domcontentloaded", timeout=30000)
            try:
                page.wait_for_load_state("networkidle", timeout=20000)
            except PlaywrightTimeout:
                pass
            if args.phase == 'after':
                try:
                    page.wait_for_function("""() => ![...document.querySelectorAll('main [role=status]')].some(e => /Loading|Gathering|Updating|Calculating/.test(e.textContent))""", timeout=90000)
                except PlaywrightTimeout:
                    pass
            page.wait_for_timeout(2500)
            page.screenshot(path=str(out / f"{device}-{name}.png"))
            page.screenshot(path=str(out / f"{device}-{name}-full.png"), full_page=True)
            metrics = page.evaluate("""() => ({width: innerWidth, document: document.documentElement.scrollWidth,
                main: document.querySelector('main')?.scrollWidth,
                mainWidth: document.querySelector('main')?.clientWidth,
                headings: [...document.querySelectorAll('h1,h2')].map(e => e.textContent),
                canvases: [...document.querySelectorAll('canvas.maplibregl-canvas')].map(e => ({width:e.width,height:e.height})),
                controls: [...document.querySelectorAll('select')].map(e=>({label:e.getAttribute('aria-label'),value:e.value})),
                overflow: [...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+2).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.slice(0,80)}))})""")
            text = page.locator("body").inner_text()
            (out / f"{device}-{name}.txt").write_text(text)
            result = {"device": device, "page": name, "metrics": metrics, "errors": errors, "console_errors":console_errors,"request_failures":request_failures,"http_errors": failures}
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
            page.close()
        context.close()
    browser.close()
(out / "audit.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
