// Teste de ponta a ponta do fluxo piloto (dados reais; requer API em :8710 e web em :5710).
// selecionar Portel no mapa → observações → histórico → ambiente → Ficha de Atenção Territorial (+ exportação).
// Uso: npm run e2e   (Chrome local; ajuste CHROME_PATH se necessário)
import { chromium } from 'playwright-core'

const BASE = process.env.WEB_URL ?? 'http://127.0.0.1:5710'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const steps = []
const ok = (name, cond, detail = '') => { steps.push({ name, ok: Boolean(cond), detail }); if (!cond) throw new Error(`Falhou: ${name} ${detail}`) }

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
try {
  // 1. Pará e clique em Portel no mapa
  await page.goto(`${BASE}/?regiao=para`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(8000)
  const canvas = page.locator('canvas.maplibregl-canvas')
  ok('mapa carregado', await canvas.count() > 0)
  // Locate the existing MapLibre instance inside React for test-only coordinate inspection.
  // Use its rendered municipal polygon, then make a real browser mouse click.
  await page.waitForSelector('[data-map-state=ready]')
  const point = await page.evaluate(() => {
    const el = document.querySelector('[role=application]')
    let fiber = el[Object.keys(el).find(k => k.startsWith('__reactFiber'))]
    while (fiber) {
      let hook = fiber.memoizedState
      while (hook) {
        const map = hook.memoizedState?.current
        if (map?.getStyle) {
          const rect = map.getCanvas().getBoundingClientRect()
          for (let y = 35; y < rect.height - 70; y += 5) for (let x = 30; x < rect.width - 35; x += 5) {
            const features = map.queryRenderedFeatures([x, y], { layers: ['mun-fill'] })
            if (features[0]?.properties.id === 'portel' && [[-4,0],[4,0],[0,-4],[0,4]].every(([dx,dy]) => map.queryRenderedFeatures([x+dx,y+dy], {layers:['mun-fill']})[0]?.properties.id === 'portel') && !map.queryRenderedFeatures([x, y], { layers: ['det-points'] }).length) return { x: rect.x + x, y: rect.y + y }
          }
        }
        hook = hook.next
      }
      fiber = fiber.return
    }
    return null
  })
  if (point) await page.mouse.click(point.x, point.y)
  await page.waitForFunction(() => document.querySelector('[aria-label="Selected territory"]')?.value === 'portel')
  const selected = await page.getByLabel('Selected territory').inputValue() === 'portel'
  ok('Portel selecionado pelo clique no mapa', selected)

  // 2. Observações recentes com data, hora e sensor
  await page.waitForSelector('text=Observations by satellite', { timeout: 60000 })
  await page.waitForFunction(() => ![...document.querySelectorAll('main [role=status]')].some(e => /Loading|Updating/.test(e.textContent)), { timeout: 120000 })
  const header = await page.locator('.observation-clock').innerText()
  ok('horário da observação mais recente (UTC)', /UTC/.test(header), header.slice(0, 80))
  ok('produtos VIIRS listados', (await page.locator('text=NOAA-20 (VIIRS)').count()) > 0)

  // 3. Análise territorial: histórico comparável e ambiente
  await page.getByRole('link', { name: 'Territory analysis', exact: true }).click()
  await page.waitForSelector('h2:has-text("Is this activity unusual?")', { timeout: 120000 })
  await page.getByText(/Median \(\d+ years\)/).first().waitFor({ timeout: 120000 })
  ok('comparação MODIS com arquivo histórico disponível', true)
  await page.waitForSelector('h2:has-text("What environmental conditions are present?")', { timeout: 60000 })
  ok('chuva/temperatura/umidade/vento', (await page.locator('text=14-day precipitation').count()) > 0)
  await page.waitForSelector('text=People and infrastructure near detections', { timeout: 120000 })
  ok('pessoas e infraestrutura', true)

  // 4. Ficha de Atenção Territorial
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
  steps.push({ name: 'erro', ok: false, detail: e.message })
} finally {
  await browser.close()
}
for (const s of steps) console.log(`[${s.ok ? 'ok' : 'FALHA'}] ${s.name}${s.detail ? ` — ${s.detail}` : ''}`)
process.exit(steps.every((s) => s.ok) ? 0 : 1)
