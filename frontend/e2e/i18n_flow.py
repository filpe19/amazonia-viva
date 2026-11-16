"""Test EN/PT-BR switching, persistence, real map state and unmodified scientific exports."""
import argparse, hashlib, json, time
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base',default='http://127.0.0.1:5710')
args=parser.parse_args()
OUT=Path(__file__).resolve().parents[2]/'docs/i18n';OUT.mkdir(exist_ok=True)
checks=[];errors=[];console=[];http=[];snapshots=[];started=time.time()
CATALOG=json.loads((Path(__file__).resolve().parents[1]/'src/lib/messages.pt-BR.json').read_text())
def check(name,ok,detail=None):
 checks.append({'name':name,'passed':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 assert ok,f'{name}: {detail}'
def settle(page):
 page.wait_for_timeout(350)
 page.wait_for_function("""() => ![...document.querySelectorAll('main [role=status]')].some(e=>/Loading|Gathering|Updating|Calculating|Carregando|Reunindo|Atualizando|Calculando|Consultando/.test(e.textContent))""",timeout=180000)
def language(page,pt):
 page.get_by_role('button',name='Português (Brasil)' if pt else 'English',exact=True).click()
 page.wait_for_function('(locale)=>document.documentElement.lang===locale',arg='pt-BR' if pt else 'en')
def fits(page):return page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector("main").scrollWidth<=document.querySelector("main").clientWidth')
MAP="""() => {const el=document.querySelector('[role=application]');if(!el)return false;let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h){const m=h.memoizedState?.current;if(m?.getStyle){window.__qaMap=m;return true}h=h.next}f=f.return}return false}"""
def capture(page,name):
 page.screenshot(path=str(OUT/(name+'.png')))
 if page.locator('body').evaluate('e=>e.scrollHeight') <= 14000:
  page.screenshot(path=str(OUT/(name+'-full.png')),full_page=True)
 # Existing English keys that still occur as exact leaf copy in the Portuguese UI.
 leaves=page.locator('body').evaluate("""e=>[...e.querySelectorAll('*')].filter(n=>!n.children.length&&!['SCRIPT','STYLE','OPTION'].includes(n.tagName)).map(n=>n.textContent.trim().replace(/\\s+/g,' ')).filter(Boolean)""")
 unchanged=sorted(set(x for x in leaves if x in CATALOG and CATALOG[x]!=x)) if page.locator('html').get_attribute('lang')=='pt-BR' else []
 snapshots.append({'name':name,'width':page.viewport_size['width'],'document_width':page.evaluate('document.documentElement.scrollWidth'),'untranslated_known_labels':unchanged})
 (OUT/(name+'.txt')).write_text(page.locator('body').inner_text())
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 context=browser.new_context(viewport={'width':1440,'height':900},accept_downloads=True)
 page=context.new_page();page.set_default_timeout(60000)
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda m:console.append(m.text) if m.type=='error' else None)
 page.on('response',lambda r:http.append({'status':r.status,'url':r.url.split('?')[0]}) if r.status>=400 else None)
 try:
  page.goto(args.base+'/?regiao=portel',wait_until='networkidle');settle(page)
  page.wait_for_selector('[data-map-state=ready]');page.wait_for_function(MAP)
  check('English default and accessible language selector',page.locator('html').get_attribute('lang')=='en' and page.get_by_role('button',name='English',exact=True).get_attribute('aria-pressed')=='true')
  page.get_by_role('radio',name='7 days',exact=True).click();settle(page)
  page.wait_for_function("window.__qaMap.queryRenderedFeatures({layers:['det-points']}).length>0")
  page.evaluate('window.__beforeMap=window.__qaMap; window.__beforeCanvas=window.__qaMap.getCanvas(); window.__beforeCenter=JSON.stringify(window.__qaMap.getCenter());window.__beforeZoom=window.__qaMap.getZoom()')
  page.locator('.recent-observations button').first.click();page.get_by_text('Coordinates',exact=True).wait_for()
  language(page,True)
  check('Portuguese headings, navigation and map detail',page.get_by_role('heading',name='Últimas observações por satélite').is_visible() and page.get_by_role('link',name='Análise territorial',exact=True).count()==1 and page.get_by_text('Coordenadas',exact=True).count()==1)
  check('Language switch retains the same MapLibre instance, canvas and camera',page.evaluate('window.__beforeMap===window.__qaMap && window.__beforeCanvas===window.__qaMap.getCanvas() && window.__beforeCenter===JSON.stringify(window.__qaMap.getCenter()) && window.__beforeZoom===window.__qaMap.getZoom()'))
  check('Territory and observation period persist on switch',page.get_by_label('Território selecionado').get_attribute('data-region-id')=='portel' and page.get_by_role('radio',name='7 dias',exact=True).get_attribute('aria-checked')=='true')
  check('MapLibre control labels are translated',page.get_by_role('button',name='Ampliar',exact=True).count()==1)
  page.get_by_label('Fechar detalhe da detecção').click()
  page.locator('summary',has_text='Satélites').click();check('Portuguese satellite controls and original IDs',page.get_by_role('checkbox',name='NOAA-20 (VIIRS)',exact=False).is_checked());page.keyboard.press('Escape')
  page.reload(wait_until='networkidle');settle(page)
  check('Language preference survives reload',page.locator('html').get_attribute('lang')=='pt-BR' and page.get_by_role('heading',name='Últimas observações por satélite').count()==1)
  for pt in (False,True):
   language(page,pt)
   for route,name in [('/','current'),('/historico','history'),('/territorio','territory'),('/ambiente','environment'),('/evidencias','evidence'),('/ficha/portel','report')]:
    page.goto(args.base+route+'?regiao=portel',wait_until='networkidle');settle(page)
    capture(page,('pt' if pt else 'en')+'-desktop-'+name)
    check(('PT' if pt else 'EN')+' desktop layout: '+name,fits(page))
    if name=='history':
     page.get_by_role('tab',name='Calendário experimental' if pt else 'Experimental calendar',exact=True).click();settle(page)
     legend=page.locator('.origin-legend').inner_text();check(('PT' if pt else 'EN')+' calendar origins and uncertainty',('Dados observados' if pt else 'Observed data') in legend and ('15,9%' if pt else '15.9%') in page.locator('.conversion-validation').inner_text())
     page.locator('.calendar-cell.convertido_modis').first.click();check(('PT' if pt else 'EN')+' empirical range and monthly number format',page.get_by_text('Faixa empírica P10–P90' if pt else 'Empirical P10–P90 range',exact=True).is_visible())
     for tab,key in [('Registros observados' if pt else 'Observed records','observed'),('Métodos e cobertura' if pt else 'Methods & coverage','methods')]:
      page.get_by_role('tab',name=tab,exact=True).click();settle(page);capture(page,('pt' if pt else 'en')+'-desktop-history-'+key)
      check(('PT' if pt else 'EN')+' history '+key+' charts render',page.locator('.recharts-surface').count()>0)
     page.get_by_role('tab',name='Calendário experimental' if pt else 'Experimental calendar',exact=True).click()
    if name=='report':
     with page.expect_download() as dl:page.get_by_role('button',name='Baixar JSON' if pt else 'Download JSON',exact=True).click()
     path=OUT/('report-pt.json' if pt else 'report-en.json');dl.value.save_as(path)
     if not pt:
      baseline=path.read_bytes();language(page,True)
      with page.expect_download() as dl2:page.get_by_role('button',name='Baixar JSON',exact=True).click()
      path2=OUT/'report-switch-pt.json';dl2.value.save_as(path2);check('Report JSON bytes are identical across language switch',baseline==path2.read_bytes());language(page,False)
  # Same CSV query and original field names in both languages.
  page.goto(args.base+'/?regiao=portel',wait_until='networkidle');settle(page)
  for pt in (False,True):
   language(page,pt)
   with page.expect_download() as dl:page.get_by_role('link',name='Exportar CSV' if pt else 'Export CSV',exact=True).click()
   path=OUT/('recent-pt.csv' if pt else 'recent-en.csv');dl.value.save_as(path)
  en_header=(OUT/'recent-en.csv').read_text().splitlines()[0];pt_header=(OUT/'recent-pt.csv').read_text().splitlines()[0]
  check('Original CSV scientific headers stay unchanged',en_header==pt_header and 'latitude' in en_header and 'longitude' in en_header)
  for pt in (False,True):
   mobile=browser.new_context(viewport={'width':390,'height':844})
   mp=mobile.new_page();mp.set_default_timeout(60000)
   mp.on('pageerror',lambda e:errors.append(str(e)))
   mp.goto(args.base+'/?regiao=portel',wait_until='networkidle');language(mp,pt);settle(mp)
   mp.locator('summary',has_text='Satélites' if pt else 'Satellites').click();check(('PT' if pt else 'EN')+' mobile expanded controls fit',fits(mp));mp.keyboard.press('Escape')
   for route,name in [('/','current'),('/historico','history'),('/territorio','territory'),('/ambiente','environment'),('/evidencias','evidence'),('/ficha/portel','report')]:
    mp.goto(args.base+route+'?regiao=portel',wait_until='networkidle');settle(mp);capture(mp,('pt' if pt else 'en')+'-mobile-'+name)
    check(('PT' if pt else 'EN')+' mobile layout: '+name,fits(mp))
   mp.get_by_role('link',name='Histórico do fogo' if pt else 'Fire history',exact=True).click();settle(mp)
   check(('PT' if pt else 'EN')+' mobile navigation retains territory',mp.get_by_label('Território selecionado' if pt else 'Selected territory').get_attribute('data-region-id')=='portel')
   mobile.close()
  check('No known English labels left in Portuguese snapshots',all(not s['untranslated_known_labels'] for s in snapshots),[s for s in snapshots if s['untranslated_known_labels']])
  check('No JavaScript, console or HTTP errors in real bilingual flows',not errors and not console and not http,{'page':errors,'console':console,'http':http})
  outage=browser.new_context(viewport={'width':390,'height':844})
  outage.add_init_script("localStorage.setItem('amazonia-viva:language','pt-BR')")
  outage.route('**/api/v1/detections?*',lambda r:r.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'code':'upstream_unavailable','message':'The data service could not be reached. Check the connection and retry.','source':'NASA FIRMS'}})))
  op=outage.new_page();op.goto(args.base+'/?regiao=portel',wait_until='domcontentloaded');op.get_by_role('alert').wait_for(timeout=60000)
  check('Portuguese API error and retry are localized',op.get_by_role('button',name='Tentar novamente',exact=True).is_visible() and 'não respondeu' in op.get_by_role('alert').inner_text())
  capture(op,'pt-mobile-source-outage')
  outage.unroute('**/api/v1/detections?*');op.get_by_role('button',name='Tentar novamente',exact=True).click();settle(op)
  op.wait_for_function("Number(document.querySelector('[data-feature-count]')?.dataset.featureCount)>0")
  check('Portuguese retry restores real observations',op.get_by_role('alert').count()==0)
  outage.close()
 except Exception as e:
  checks.append({'name':'Bilingual flow completed','passed':False,'detail':str(e)});print(str(e),flush=True);page.screenshot(path=str(OUT/'failure.png'),full_page=True)
 finally:
  browser.close();(OUT/'results.json').write_text(json.dumps({'duration_seconds':round(time.time()-started,1),'checks':checks,'snapshots':snapshots,'errors':errors,'console':console,'http':http},ensure_ascii=False,indent=2))
raise SystemExit(0 if all(c['passed'] for c in checks) else 1)
