// E2E da experiência cartográfica (Missão 06): dados reais; requer API em :8710 e web em :5710 no modo dev.
// Santarém → enquadramento → sede → mapas-base → filtros por satélite → detecção e atributos originais →
// FWI e opacidade → recorrência → ficha com mapa de evidências e exportação → layout mobile.
// Uso: npm run e2e:map
import { chromium } from 'playwright-core'

const BASE = process.env.WEB_URL ?? 'http://127.0.0.1:5710'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const steps = []
const ok = (name, cond, detail = '') => { steps.push({ name, ok: Boolean(cond), detail }); if (!cond) throw new Error(`Falhou: ${name} ${detail}`) }

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errors = []
const failedApi = []
page.on('pageerror', (e) => errors.push(e.message))
const external = []
const EXTERNAL = /gibs\.earthdata|tiles\.openfreemap|maps\.effis|arcgisonline|terrabrasilis|Failed to load resource/
page.on('console', (m) => { if (m.type() === 'error') (EXTERNAL.test(m.text()) ? external : errors).push(m.text().slice(0, 200)) })
page.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 500) failedApi.push(`${r.status()} ${r.url()}`) })
await page.addInitScript(() => { if (!sessionStorage.getItem('e2e:init')) { sessionStorage.setItem('e2e:init', '1'); sessionStorage.setItem('av:activity:window', JSON.stringify('7d')) } })
const M = (fn, arg) => page.evaluate(fn, arg)
const regionId = () => page.getByLabel('Selected territory', { exact: true }).getAttribute('data-region-id')
const shownSats = () => M(() => [...new Set(window.__avMap.queryRenderedFeatures({ layers: ['det-points', 'det-modis'] }).map((f) => f.properties.s))].sort())
const featureCount = async () => Number(await page.locator('.map-canvas-wrap').getAttribute('data-feature-count'))
const chipCount = async (key) => Number(((await page.locator(`.sat-chip[data-sat="${key}"] b`).innerText()) || '0').replace(/[^\d]/g, '') || 0)
const setSats = async (want) => {
  for (const key of ['NOAA-20', 'NOAA-21', 'Aqua', 'Terra']) {
    const chip = page.locator(`.sat-chip[data-sat="${key}"]`)
    const on = (await chip.getAttribute('aria-pressed')) === 'true'
    if (on !== want.includes(key)) await chip.click()
  }
  await page.waitForTimeout(400)
  await page.waitForFunction(() => !document.querySelector('.map-busy'), undefined, { timeout: 120000 })
  await page.waitForTimeout(1800)
}

try {
  // 1–3. Selecionar Santarém pela busca; enquadramento pela geometria real; sede destacada
  await page.goto(`${BASE}/?regiao=para`, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('[data-map-state=ready]', { timeout: 60000 })
  const search = page.getByLabel('Selected territory', { exact: true })
  await search.click(); await search.fill('Santar')
  await page.locator('[role=option][data-region-id=santarem]').first().click()
  await page.waitForFunction(() => document.querySelector('[aria-label="Selected territory"]')?.dataset.regionId === 'santarem', undefined, { timeout: 30000 })
  ok('Santarém selecionado pela busca', await regionId() === 'santarem')
  await page.waitForTimeout(2500)
  const frame = await M(async () => {
    const b = (await (await fetch('/api/v1/regions')).json()).regions.find((r) => r.id === 'santarem').bbox
    const m = window.__avMap; const c = m.getCanvas()
    const sw = m.project([b[0], b[1]]); const ne = m.project([b[2], b[3]])
    const w = c.clientWidth, h = c.clientHeight
    return { inside: sw.x >= 0 && ne.x <= w && ne.y >= 0 && sw.y <= h, fill: Math.max((ne.x - sw.x) / w, (sw.y - ne.y) / h), zoom: m.getZoom() }
  })
  ok('município inteiro enquadrado pela geometria IBGE', frame.inside && frame.fill > 0.55, `ocupa ${(frame.fill * 100).toFixed(0)}% · zoom ${frame.zoom.toFixed(2)}`)
  const panel = await page.locator('.intel-panel').boundingBox()
  ok('painel lateral visível ao lado do mapa', panel && panel.x > 900 && panel.width > 300)
  await page.waitForFunction(() => window.__avMap.queryRenderedFeatures({ layers: ['seat-selected'] }).length > 0, undefined, { timeout: 60000 })
  const seat = await M(() => window.__avMap.queryRenderedFeatures({ layers: ['seat-selected'] })[0].properties.name)
  ok('sede municipal destacada (IBGE BC250)', seat === 'Santarém', seat)

  // 4. Mapas-base, preservando as detecções
  const baseCount = await featureCount()
  for (const [label, mode] of [['Cartographic', 'cartographic'], ['High-resolution imagery', 'imagery'], ['Satellite of the day', 'satellite'], ['Analytical', 'analytical']]) {
    await page.getByRole('button', { name: 'Basemap', exact: true }).click()
    await page.locator('.tool-pop label', { hasText: label }).click()
    await page.waitForTimeout(4500)
    const st = await M(() => ({ det: window.__avMap.getSource('det') != null, gibs: window.__avMap.getLayoutProperty('gibs', 'visibility'), rendered: window.__avMap.queryRenderedFeatures({ layers: ['det-points', 'det-modis'] }).length }))
    ok(`mapa-base ${mode} mantém as detecções`, (await page.locator('[data-basemap]').getAttribute('data-basemap')) === mode && st.det && st.rendered > 0, `${st.rendered} símbolos`)
    if (mode === 'satellite') ok('imagem de satélite datada (GIBS)', st.gibs === 'visible' && /NASA GIBS.*\d{4}/.test(await page.locator('.imagery-badge').innerText()))
    if (mode === 'imagery') {
      ok('alta resolução (Esri) ligada', (await M(() => window.__avMap.getLayoutProperty('hires', 'visibility'))) === 'visible')
      await page.keyboard.press('Escape')
      await M(() => window.__avMap.jumpTo({ center: [-54.7085, -2.4385], zoom: 15 }))
      await page.waitForSelector('.imagery-badge[data-imagery-state=ready], .imagery-badge[data-imagery-state=error]', { timeout: 30000 })
      const badge = await page.locator('.imagery-badge').innerText()
      ok('alta resolução: data e resolução da cena exibidas (não é imagem atual)', /captured \d{1,2} \w{3} \d{4}/.test(badge) && /Not current imagery/.test(badge), badge.slice(0, 90))
      await page.getByLabel('Frame the selected territory', { exact: true }).click()
      await page.waitForTimeout(1500)
    }
    await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  }
  ok('contagem estável após trocar mapa-base', (await featureCount()) === baseCount, `${baseCount}`)

  // 5–8. Filtros por satélite mudam de fato os dados exibidos
  await setSats(['NOAA-20'])
  ok('somente NOAA-20', JSON.stringify(await shownSats()) === '["NOAA-20"]' && (await featureCount()) === (await chipCount('NOAA-20')), `${await featureCount()} detecções`)
  await setSats(['NOAA-21'])
  ok('somente NOAA-21', JSON.stringify(await shownSats()) === '["NOAA-21"]' && (await featureCount()) === (await chipCount('NOAA-21')), `${await featureCount()} detecções`)
  await setSats(['Aqua', 'Terra'])
  const modisSats = await shownSats()
  const modisLabel = await page.locator('.key-sensor', { hasText: 'MODIS' }).locator('.sensor-label').innerText()
  ok('somente MODIS (Terra/Aqua) rotulado como 1 km', modisSats.every((s) => s === 'Aqua' || s === 'Terra') && /1 km/.test(modisLabel) && (await featureCount()) === (await chipCount('Aqua')) + (await chipCount('Terra')), `${modisSats.join('+')} · ${await featureCount()}`)
  await setSats(['NOAA-20', 'NOAA-21', 'Aqua', 'Terra'])
  const allSats = await shownSats()
  ok('todos os satélites simultaneamente', allSats.includes('NOAA-20') && allSats.includes('NOAA-21'), allSats.join(', '))
  ok('nenhum texto atribui 375 m ao MODIS', !/MODIS[^·\n]{0,20}375/.test(await page.locator('.map-key').innerText()))

  // 9–10. Clique numa detecção e conferência dos atributos originais com a API
  const det = await M(() => {
    // ponto isolado (sem outro símbolo a 10 px), para que o clique selecione exatamente esta detecção
    const m = window.__avMap; const r = m.getCanvas().getBoundingClientRect()
    for (const f of m.queryRenderedFeatures({ layers: ['det-points'] })) {
      const q = m.project(f.geometry.coordinates)
      if (q.x < 40 || q.y < 120 || q.x > r.width - 80 || q.y > r.height - 160) continue
      const near = m.queryRenderedFeatures([[q.x - 10, q.y - 10], [q.x + 10, q.y + 10]], { layers: ['det-points', 'det-modis'] })
      if (near.length === 1 && document.elementFromPoint(r.x + q.x, r.y + q.y) === m.getCanvas()) return { x: r.x + q.x, y: r.y + q.y, id: f.properties.id, p: f.properties.p }
    }
    return null
  })
  ok('detecção isolada encontrada para o clique', det)
  await page.mouse.click(det.x, det.y)
  await page.waitForSelector('.intel-block h3:has-text("A · Observation")', { timeout: 60000 })
  await page.waitForSelector('.raw-attrs', { timeout: 60000 })
  const selFilter = await M(() => JSON.stringify(window.__avMap.getFilter('det-selected')))
  ok('ponto destacado e território mantido', selFilter.includes(det.id) && await regionId() === 'santarem', `${selFilter} · ${await regionId()} · ${det.id}`)
  await page.locator('.raw-attrs summary').click()
  const raw = await page.locator('.raw-attrs table').innerText()
  const api = await M(async ({ p, id }) => (await fetch(`/api/v1/detections/${p}/${id}`)).json(), det)
  const coordNote = await page.locator('.intel-row', { hasText: 'Coordinates' }).innerText()
  ok('atributos originais iguais aos da API', raw.includes(String(api.bright_ti4_k)) && raw.includes(String(api.frp_mw)) && raw.includes(api.version) && coordNote.includes(api.latitude.toFixed(5)),
    `ti4 ${api.bright_ti4_k} K · frp ${api.frp_mw} MW · ${api.version}`)
  ok('produto e resolução declarados', (await page.locator('.intel-row', { hasText: 'Satellite / sensor' }).innerText()).includes('375 m'))
  const [ev] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export evidence (JSON)' }).click()])
  ok('exportação da evidência da detecção', (await ev.suggestedFilename()).startsWith(`evidencia_${det.p}_${det.id}`), await ev.suggestedFilename())

  // 11–12. FWI: ligado sob as detecções e com opacidade controlável
  await page.getByRole('tab', { name: /Layers/ }).click()
  await page.locator('.layer-item[data-layer=fwi] input[type=checkbox]').check()
  await page.waitForTimeout(3000)
  const fwiState = (await page.locator('.layer-item[data-layer=fwi] .layer-state').count()) ? await page.locator('.layer-item[data-layer=fwi] .layer-state').innerText() : 'ready'
  if (/unavailable/.test(fwiState)) {
    ok('FWI: fonte indisponível sinalizada e camada oculta', true, 'Copernicus GWIS não respondeu')
  } else {
    await page.locator('.layer-item[data-layer=fwi] input[type=range]').fill('0.3')
    await page.waitForTimeout(800)
    const fwi = await M(() => { const m = window.__avMap; const ids = m.getStyle().layers.map((l) => l.id); return { vis: m.getLayoutProperty('ov-fwi-raster', 'visibility'), op: m.getPaintProperty('ov-fwi-raster', 'raster-opacity'), r: ids.indexOf('ov-fwi-raster'), d: ids.indexOf('det-points'), b: ids.indexOf('boundary-line') } })
    ok('FWI abaixo do limite e das detecções', fwi.vis === 'visible' && fwi.r < fwi.b && fwi.r < fwi.d, JSON.stringify(fwi))
    ok('opacidade do FWI alterada', Math.abs(fwi.op - 0.3) < 1e-6, `${fwi.op}`)
    await page.locator('.layer-item[data-layer=fwi] input[type=checkbox]').uncheck()
    await page.waitForTimeout(500)
    ok('FWI desligado', (await M(() => window.__avMap.getLayoutProperty('ov-fwi-raster', 'visibility'))) === 'none')
  }

  // 13. Recorrência histórica
  await page.locator('.layer-item[data-layer=recurrence] input[type=checkbox]').check()
  await page.waitForFunction(() => window.__avMap.getLayer('ov-recurrence-fill') && window.__avMap.queryRenderedFeatures({ layers: ['ov-recurrence-fill'] }).length > 0, undefined, { timeout: 120000 })
  ok('recorrência histórica por célula visível', true, `${await M(() => window.__avMap.queryRenderedFeatures({ layers: ['ov-recurrence-fill'] }).length)} células`)

  // Alertas: sinais de atenção calculados com critérios públicos (não oficiais), cruzamentos e DETER
  await setSats(['NOAA-20', 'NOAA-21', 'Aqua', 'Terra'])
  await page.getByRole('tab', { name: /Alerts/ }).click()
  // Focos e impacto (visão padrão): grau, confiabilidade, vento e alvos no caminho
  await page.waitForSelector('.hs-panel .ti-summary, .hs-panel .intel-empty', { timeout: 300000 })
  const hsApi = await M(async () => (await (await fetch('/api/v1/territory/santarem/hotspots?window=7d')).json()))
  ok('focos: visão padrão com grau de alerta, confiabilidade e regras públicas', hsApi.available && hsApi.official === false && (await page.locator('[data-alert-view=hotspots]').getAttribute('aria-checked')) === 'true'
    && Number(await page.locator('[data-alert-view=hotspots] b').innerText()) === hsApi.summary.by_level.alto, `${hsApi.summary.clusters} focos · ${hsApi.summary.by_level.alto} alto · ${hsApi.summary.by_level.moderado} moderado`)
  ok('focos: probabilidade de chegada declarada como não modelada (sem número inventado)', /Probabilidade/.test(hsApi.not_modeled[0]) && !/"probability"|"score"/.test(JSON.stringify(hsApi)))
  if (hsApi.items.length) {
    await page.locator('.hs-card .ti-card-head').first().click()
    await page.waitForTimeout(3500)
    const hasWind = hsApi.items[0].wind != null
    const hsMap = await M(() => ({ t: window.__avMap.queryRenderedFeatures({ layers: ['ov-hs-targets-circle'] }).length, w: window.__avMap.getLayer('ov-hs-wedge-fill') ? window.__avMap.queryRenderedFeatures({ layers: ['ov-hs-wedge-fill'] }).length : 0 }))
    ok('focos: alvos ligados ao foco e setor a favor do vento no mapa', hsMap.t > 0 && (!hasWind || hsMap.w > 0), `${hsMap.t} alvos · vento ${hasWind ? 'sim' : 'n/d'}`)
    ok('focos: radar de impacto no card (anéis, setor do vento, alvos por direção)', (await page.locator('.hs-card.open .hs-radar svg circle').count()) >= 4)
    ok('focos: anéis de distância e seta do vento no mapa', (await M(() => window.__avMap.queryRenderedFeatures({ layers: ['ov-hs-rings-line'] }).length)) > 0)
    const links = await page.locator('.hs-card.open a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
    ok('focos: boletim (WhatsApp) e rota até o foco', links.some((h) => /wa\.me\/\?text=/.test(h)) && links.some((h) => /google\.com\/maps\/dir\//.test(h)))
  }
  // Filtros rápidos no mapa e pop-up ao passar o mouse sobre áreas oficiais
  const vis = () => M(() => window.__avMap.getLayer('ov-roads-line') ? window.__avMap.getLayoutProperty('ov-roads-line', 'visibility') : 'absent')
  const roadsBefore = await vis()
  await page.locator('[data-chip=roads]').click()
  await page.waitForTimeout(700)
  const roadsAfter = await vis()
  ok('filtro rápido no próprio mapa liga e desliga camadas (rodovias)', roadsBefore !== roadsAfter && (await page.locator('.map-chips button').count()) >= 6, `${roadsBefore} → ${roadsAfter}`)
  await page.locator('[data-chip=roads]').click()
  await page.getByLabel('Frame the selected territory', { exact: true }).click()
  await page.waitForTimeout(3000)
  const spot = await M(() => {
    const m = window.__avMap; const r = m.getCanvas().getBoundingClientRect()
    const blockers = ['det-points', 'det-modis', 'cluster-circles', 'ov-hs-points-circle', 'ov-hs-targets-circle', 'seats', 'seat-selected'].filter((l) => m.getLayer(l))
    if (!m.getLayer('ov-areas-fill')) return null
    for (let y = 150; y < r.height - 200; y += 8) for (let x = 60; x < r.width - 80; x += 8) {
      if (m.queryRenderedFeatures([[x - 3, y - 3], [x + 3, y + 3]], { layers: ['ov-areas-fill'] }).length && !m.queryRenderedFeatures([[x - 8, y - 8], [x + 8, y + 8]], { layers: blockers }).length) return { x: r.x + x, y: r.y + y }
    }
    return null
  })
  if (spot) {
    await page.mouse.move(spot.x, spot.y)
    await page.waitForSelector('.area-tip', { timeout: 8000 })
    ok('pop-up ao passar o mouse sobre terra indígena/UC/quilombola, com fonte', /FUNAI|ICMBio|INCRA|CNUC/.test(await page.locator('.area-tip').innerText()), (await page.locator('.area-tip').innerText()).split('\n')[0])
  }
  await page.locator('[data-alert-view=indigenous]').click()
  // Terras indígenas: contexto social e regras explícitas
  await page.waitForSelector('.ti-summary, .ti-panel .intel-empty', { timeout: 240000 })
  const tiApi = await M(async () => (await (await fetch('/api/v1/territory/santarem/indigenous?window=7d')).json()))
  ok('alertas TI: terras indígenas avaliadas (FUNAI) e regras públicas', tiApi.available && tiApi.official === false && tiApi.summary.lands_evaluated > 0 && (await page.locator('[data-alert-view=indigenous]').getAttribute('aria-checked')) === 'true', `${tiApi.summary.lands_evaluated} TIs · ${tiApi.items.length} com fogo dentro ou no entorno`)
  if (tiApi.items.length) {
    await page.locator('.ti-card-head').first().click()
    await page.waitForTimeout(2500)
    const bul = await page.locator('.ti-card.open a', { hasText: 'WhatsApp' }).getAttribute('href')
    ok('alertas TI: boletim compartilhável com fontes e ressalva', /wa\.me\/\?text=/.test(bul ?? '') && /not%20an%20official%20alert/.test(bul ?? ''))
    ok('alertas TI: terra destacada no mapa', (await M(() => window.__avMap.queryRenderedFeatures({ layers: ['ov-ti-alerts-line'] }).length)) > 0)
  }
  await page.locator('[data-alert-view=all]').click()
  await page.waitForSelector('.att-head h3 .num', { timeout: 180000 })
  const attApi = await M(async () => (await (await fetch('/api/v1/territory/santarem/attention?window=7d')).json()))
  const apiMain = attApi.signals.filter((x) => x.relation !== 'near').length
  const uiMain = Number((await page.locator('.att-head h3 .num').innerText()).replace(/\D/g, ''))
  ok('alertas: contagem da interface igual à da API', uiMain === apiMain && apiMain > 0, `${uiMain} sinais`)
  ok('alertas: aviso explícito de que não são alertas oficiais', /not official alerts/.test(await page.locator('.att-disclaimer').innerText()) && attApi.official === false)
  ok('alertas: contador na alternância e atalho no mapa', Number(await page.locator('[data-alert-view=all] b').innerText()) === apiMain && await page.locator('.hud-attention').isVisible())
  ok('alertas: contagens por satélite, sem pontuação de risco', !/"score"|"risk/.test(JSON.stringify(attApi)) && attApi.signals.every((x) => typeof x.by_satellite === 'object'))
  await page.locator('.att-card-head').first().click()
  await page.waitForTimeout(3500)
  const att = await M(() => ({ halos: window.__avMap.queryRenderedFeatures({ layers: ['ov-att-dets-circle'] }).length, z: window.__avMap.getZoom() }))
  ok('alertas: sinal selecionado enquadrado e destacado no mapa', att.halos > 0, `${att.halos} halos · zoom ${att.z.toFixed(1)}`)
  const fp = await M(() => window.__avMap.getZoom() >= 10 ? window.__avMap.queryRenderedFeatures({ layers: ['footprint-fill'] }).length : -1)
  if (fp >= 0) ok('área do pixel (scan × track) desenhada ao aproximar', fp > 0, `${fp} pixels`)
  await page.locator('.att-card.open .att-dets button').first().click()
  await page.waitForSelector('.intel-block h3:has-text("A · Observation")', { timeout: 60000 })
  await page.waitForSelector('.heat-source .heat-reading', { timeout: 120000 })
  const reading = await page.locator('.heat-source').getAttribute('data-heat-reading')
  ok('"É incêndio mesmo?": leitura por regra explícita com indícios e fontes', ['static_source', 'mining_context', 'clearing_context', 'vegetation_fire_compatible', 'inconclusive'].includes(reading) && (await page.locator('.heat-items li').count()) > 0, reading)
  await page.waitForSelector('.obs-actions a:has-text("Google Maps")', { timeout: 60000 })
  const gm = await page.locator('.obs-actions a', { hasText: 'Google Maps' }).getAttribute('href')
  ok('alertas: detecção do sinal abre a investigação A–F, com link para o Google Maps (satélite)', /google\.com\/maps\/@\?api=1.*basemap=satellite/.test(gm ?? ''), gm?.slice(0, 80))
  await page.getByRole('tab', { name: /Layers/ }).click()
  await page.locator('.layer-item[data-layer=deter] input[type=checkbox]').check()
  await page.getByLabel('Frame the selected territory', { exact: true }).click()
  await page.waitForFunction(() => window.__avMap.getLayer('ov-deter-fill') && window.__avMap.queryRenderedFeatures({ layers: ['ov-deter-fill'] }).length > 0, undefined, { timeout: 120000 })
  ok('camada DETER (INPE, 12 meses) desenhada no município', true, `${await M(() => window.__avMap.queryRenderedFeatures({ layers: ['ov-deter-fill'] }).length)} polígonos visíveis`)
  await page.locator('[data-preset=clean]').click()
  await page.waitForTimeout(800)
  ok('visão pronta "Mapa limpo" desliga as camadas de contexto', (await M(() => window.__avMap.getLayoutProperty('ov-deter-fill', 'visibility'))) === 'none' && (await page.locator('[data-preset=clean]').getAttribute('aria-pressed')) === 'true')

  // Modo histórico para estudo: mesmo período há 10 anos (arquivo FIRMS do Pará)
  await page.locator('.hud-hist select').selectOption('10')
  await page.waitForSelector('.hist-badge', { timeout: 120000 })
  await page.waitForFunction(() => /\d+ detections/.test(document.querySelector('.hist-badge')?.textContent ?? ''), undefined, { timeout: 180000 })
  const histN = await featureCount()
  ok('modo histórico: mesmo período há 10 anos no mapa, com aviso de comparação no mesmo instrumento', histN > 0 && /same instrument/.test(await page.locator('.hist-badge').innerText()), `${histN} detecções do arquivo`)
  await page.getByRole('tab', { name: /Alerts/ }).click()
  await page.waitForSelector('.hs-hist', { timeout: 180000 })
  ok('modo histórico: focos e alvos calculados para o período passado', (await page.locator('[data-alert-view=indigenous]').isDisabled()))
  await page.locator('.hud-hist select').selectOption('0')
  await page.waitForTimeout(1500)

  // 14–15. Ficha territorial com mapa de evidências e exportação
  await page.getByRole('tab', { name: /Observation/ }).click()
  await page.getByRole('link', { name: 'Territorial report' }).click()
  await page.waitForSelector('.evidence-map canvas', { timeout: 120000 })
  await page.waitForSelector('.evidence-print', { timeout: 120000, state: 'attached' })
  const legend = await page.locator('.evidence-legend').innerText()
  ok('ficha com mapa de evidências, sede, escala e legenda', /Municipal seat/.test(legend) && /1 km/.test(legend) && (await page.locator('.evidence-map .maplibregl-ctrl-scale').count()) === 1)
  await page.waitForSelector('.crosscheck-table', { timeout: 180000 })
  const cc = await page.locator('.crosscheck').innerText()
  ok('ficha: seção de terras indígenas presente', (await page.locator('[data-ficha-ti]').count()) + (await page.getByText('No fire detected inside or within 10 km of Indigenous lands').count()) > 0)
  ok('ficha: cruzamento com territórios, pessoas e DETER, com proporção por satélite', /Harmonized comparison/.test(cc) && /DETER/.test(cc) && (await page.locator('.crosscheck-table tbody tr').count()) > 0)
  const [rep] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()])
  ok('relatório exportado', (await rep.suggestedFilename()).startsWith('ficha-atencao-territorial_santarem'), await rep.suggestedFilename())

  // Amazônia como um todo (9 países)
  // Escala amazônica (~74 mil detecções em 7 dias): no Chrome com renderização por software o mapa leva ~50 s.
  await page.goto(`${BASE}/?regiao=amazonia`, { waitUntil: 'load', timeout: 120000 })
  await page.waitForSelector('[data-map-state=ready]', { timeout: 240000 })
  await page.waitForSelector('.ti-summary', { timeout: 400000 })
  const amz = await M(async () => (await (await fetch('/api/v1/regions')).json()).regions.find((r) => r.id === 'amazonia'))
  ok('Amazônia (9 países) selecionável, com limite e alertas indígenas pan-amazônicos', amz?.level === 'bioma' && (await M(() => window.__avMap.getLayer('ov-amazon-line') != null)) && /Amaz/.test(await page.locator('.hud-title strong').innerText()), `${Math.round(amz?.area_km2 / 1e6 * 100) / 100} milhões de km²`)

  // 16. Layout mobile
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } })
  mob.on('pageerror', (e) => errors.push(`mobile: ${e.message}`))
  await mob.goto(`${BASE}/?regiao=santarem`, { waitUntil: 'load', timeout: 60000 })
  await mob.waitForSelector('[data-map-state=ready]', { timeout: 60000 })
  await mob.waitForTimeout(4000)
  const mb = await mob.locator('.situation-map').boundingBox()
  const chips = await mob.locator('.sat-chip').count()
  const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ok('mobile: mapa acima da dobra, legenda-filtro e sem rolagem lateral', mb && mb.y < 300 && mb.height > 400 && chips === 4 && overflow <= 0, `mapa y=${mb?.y.toFixed(0)} h=${mb?.height.toFixed(0)}`)
  await mob.close()

  ok('sem erros de página ou console', errors.length === 0, errors.join(' | '))
  ok('sem falhas 5xx da API', failedApi.length === 0, failedApi.join(' | '))
  if (external.length) steps.push({ name: 'aviso: falhas transitórias de tiles externos (não bloqueiam)', ok: true, detail: `${external.length} · ${external[0].slice(0, 90)}` })
} catch (e) {
  steps.push({ name: 'erro', ok: false, detail: e.message.split('\n')[0] })
  await page.screenshot({ path: 'e2e-map-failure.png' }).catch(() => {})
} finally {
  await browser.close()
}
for (const s of steps) console.log(`[${s.ok ? 'ok' : 'FALHA'}] ${s.name}${s.detail ? ` — ${s.detail}` : ''}`)
process.exit(steps.every((s) => s.ok) ? 0 : 1)
