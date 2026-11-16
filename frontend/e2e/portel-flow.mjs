// Teste de ponta a ponta do fluxo piloto (dados reais; requer API em :8710 e web em :5710 no modo dev).
// Centro de situação: selecionar Portel no mapa → painel de inteligência → clicar uma detecção real →
// camada de recorrência → histórico (perfil sazonal + comparação de anos) → análise territorial → ficha (+ exportações).
// Uso: npm run e2e   (Chrome local; ajuste CHROME_PATH se necessário)
import { chromium } from 'playwright-core'

const BASE = process.env.WEB_URL ?? 'http://127.0.0.1:5710'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const steps = []
const ok = (name, cond, detail = '') => { steps.push({ name, ok: Boolean(cond), detail }); if (!cond) throw new Error(`Falhou: ${name} ${detail}`) }
const regionId = (page) => page.getByLabel('Selected territory', { exact: true }).getAttribute('data-region-id')

// Localiza na instância MapLibre exposta em modo dev (window.__avMap) um pixel seguro de uma camada
// e devolve a coordenada de tela para um clique real do mouse.
async function findOnMap(page, layer, match) {
  return page.evaluate(({ layer, match }) => {
    const map = window.__avMap
    if (!map) return null
    const rect = map.getCanvas().getBoundingClientRect()
    if (layer === 'det-points') {
      // Detecção visível e não coberta por controles do mapa (cabeçalho, filtros, legenda, relógio)
      const canvas = map.getCanvas()
      for (const f of map.queryRenderedFeatures({ layers: [layer] })) {
        if (f.geometry.type !== 'Point') continue
        const p = map.project(f.geometry.coordinates)
        const x = rect.x + p.x, y = rect.y + p.y
        if (document.elementFromPoint(x, y) === canvas) return { x, y, id: f.properties.id }
      }
      return null
    }
    for (let y = 120; y < rect.height - 120; y += 5) for (let x = 40; x < rect.width - 40; x += 5) {
      const hit = (dx, dy) => map.queryRenderedFeatures([x + dx, y + dy], { layers: [layer] })[0]?.properties.id === match
      if (hit(0, 0) && [[-4, 0], [4, 0], [0, -4], [0, 4]].every(([dx, dy]) => hit(dx, dy)) && !map.queryRenderedFeatures([x, y], { layers: ['det-points'] }).length)
        return { x: rect.x + x, y: rect.y + y }
    }
    return null
  }, { layer, match })
}
const idle = (page) => page.waitForFunction(() => ![...document.querySelectorAll('main [role=status]')].some((e) => /Loading|Updating|Comparing|Measuring/.test(e.textContent)), undefined, { timeout: 180000 })

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
try {
  // 1. Pará → clique real no polígono de Portel
  await page.goto(`${BASE}/?regiao=para`, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('[data-map-state=ready]', { timeout: 60000 })
  await page.waitForFunction(() => Boolean(window.__avMap?.getLayer('mun-fill')), undefined, { timeout: 60000 })
  await page.waitForTimeout(3000)
  ok('mapa ocupa a área principal', await page.locator('.situation-grid canvas.maplibregl-canvas').count() > 0)
  const portel = await findOnMap(page, 'mun-fill', 'portel')
  ok('polígono de Portel localizado no mapa', portel)
  await page.mouse.click(portel.x, portel.y)
  await page.waitForFunction(() => document.querySelector('[aria-label="Selected territory"]')?.dataset.regionId === 'portel', undefined, { timeout: 30000 })
  ok('Portel selecionado pelo clique no mapa', await regionId(page) === 'portel')

  // 2. Atividade recente: horário UTC e painel de inteligência com as quatro dimensões
  await page.waitForSelector('.map-clock strong:has-text("UTC")', { timeout: 120000 })
  ok('horário da observação mais recente (UTC)', /UTC/.test(await page.locator('.map-clock').innerText()))
  ok('aba de alertas aberta por padrão', (await page.locator('[data-tab=attention]').getAttribute('aria-selected')) === 'true')
  await page.getByRole('tab', { name: /Territory/ }).click()
  for (const h of ['Fire activity', 'Meteorological hazard', 'Potential human exposure', 'Potential environmental impact'])
    await page.waitForSelector(`.intel-block h3:has-text("${h}")`, { timeout: 120000 })
  ok('quatro dimensões independentes no painel', true)
  await idle(page)
  ok('produtos VIIRS no painel', (await page.locator('.intel-block :text("NOAA-20")').count()) > 0)

  // 3. Clique numa detecção real: painel de observação com cinco blocos, sem trocar de território
  await page.waitForFunction(() => window.__avMap?.queryRenderedFeatures({ layers: ['det-points'] }).length > 0, undefined, { timeout: 60000 })
  const det = await findOnMap(page, 'det-points')
  ok('detecção renderizada no mapa', det)
  await page.mouse.click(det.x, det.y)
  for (const h of ['A · Observation', 'B · Geographic position', 'C · Historical context', 'D · Environmental context', 'E · Human context', 'F · Investigation actions'])
    await page.waitForSelector(`.intel-block h3:has-text("${h}")`, { timeout: 120000 })
  ok('observação explicada em seis blocos (A–F)', true, det.id)
  ok('território continua Portel após clicar a detecção', await regionId(page) === 'portel')

  // 4. Camadas: ligar a recorrência histórica e conferir a legenda operacional
  await page.getByRole('tab', { name: /Layers/ }).click()
  await page.locator('.layer-item[data-layer=recurrence] input[type=checkbox]').check()
  await page.waitForSelector('.key-more li:has-text("Recurrence, NOAA-20")', { timeout: 120000, state: 'attached' })
  ok('camada de recorrência com legenda', true)

  // 5. Histórico: calendário harmonizado, perfil sazonal e comparação de anos
  await page.getByRole('link', { name: 'Fire history', exact: true }).click()
  await page.waitForSelector('.seasonal-profile', { timeout: 180000 })
  const yearB = page.getByLabel('Year B')
  const years = await yearB.locator('option').allInnerTexts()
  ok('anos disponíveis para comparação', years.length >= 20, `${years[0]}–${years.at(-1)}`)
  await yearB.selectOption(years[0])
  await page.waitForSelector(`.seasonal-key :text("Year B ${years[0]}")`)
  ok('comparação de anos atualizada', true, `ano B = ${years[0]}`)

  // 6. Análise territorial: histórico comparável, ambiente e exposição
  await page.getByRole('link', { name: 'Territory analysis', exact: true }).click()
  await page.waitForSelector('h2:has-text("Is this activity unusual?")', { timeout: 120000 })
  await page.getByText(/Median \(\d+ years\)/).first().waitFor({ timeout: 120000 })
  ok('comparação MODIS com arquivo histórico disponível', true)
  await page.waitForSelector('h2:has-text("What environmental conditions are present?")', { timeout: 60000 })
  await page.waitForSelector('text=14-day precipitation', { timeout: 120000 })
  ok('chuva/temperatura/umidade/vento', true)
  await page.waitForSelector('text=People and infrastructure near detections', { timeout: 120000 })
  ok('pessoas e infraestrutura', true)

  // 7. Ficha de Atenção Territorial
  await page.getByRole('link', { name: 'Open territory report', exact: true }).click()
  for (const q of ['What was detected?', 'When was it observed?', 'Is this activity unusual?', 'What environmental conditions are present?',
    'Which inhabited or protected territories are nearby?', 'What needs further verification?', 'What evidence and limitations support this analysis?']) {
    await page.waitForSelector(`h2:has-text("${q}")`, { timeout: 180000 })
  }
  ok('ficha responde às 7 perguntas', true)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()])
  ok('exportação JSON', (await dl.suggestedFilename()).startsWith('ficha-atencao-territorial_portel'), await dl.suggestedFilename())
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Proximity CSV/ }).click()])
  ok('exportação CSV de proximidade', (await dl2.suggestedFilename()).startsWith('proximidade_portel'), await dl2.suggestedFilename())
  ok('sem erros de página', errors.length === 0, errors.join(' | '))
} catch (e) {
  steps.push({ name: 'erro', ok: false, detail: e.message.split('\n')[0] })
  await page.screenshot({ path: 'e2e-failure.png' }).catch(() => {})
} finally {
  await browser.close()
}
for (const s of steps) console.log(`[${s.ok ? 'ok' : 'FALHA'}] ${s.name}${s.detail ? ` — ${s.detail}` : ''}`)
process.exit(steps.every((s) => s.ok) ? 0 : 1)
