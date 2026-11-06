// Delivery evidence: GET-only against the running real stack. Never submits.
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const output = new URL('../../docs/capturas/fase2/', import.meta.url)
await mkdir(output, { recursive: true })
const modules = [
  ['panorama', '/observatorio', '/api/overview'],
  ['academico', '/observatorio/academico', '/api/analytics/academic'],
  ['permanencia', '/observatorio/permanencia', '/api/analytics/permanence'],
  ['institucional', '/observatorio/institucional', '/api/analytics/institutional'],
  ['datos', '/observatorio/datos', '/api/analytics/quality'],
  ['metodologia', '/observatorio/metodologia', '/api/analytics/methodology']
]
const browser = await chromium.launch()
const evidence = { origin: 'http://localhost:8080', captured_at: new Date().toISOString(), widths: [1440, 820, 390], modules: {} }
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) throw new Error('Solo se permiten lecturas del entorno real')
    return route.continue()
  })
  for (const width of evidence.widths) {
    await page.setViewportSize({ width, height: 1050 })
    for (const [key, path, api] of modules) {
      await page.goto(`${evidence.origin}${path}`)
      await page.locator('.metric-strip').waitFor()
      const response = await page.request.get(`${evidence.origin}${api}`)
      if (!response.ok()) throw new Error(`API falló: ${api}`)
      const data = await response.json()
      if (data.data_mode !== 'real' || data.status !== 'ready') throw new Error('Se requiere el entorno real operativo')
      for (const chart of data.charts) {
        const locator = page.getByTestId(`chart-${chart.key}`)
        if (chart.status === 'ready' && await page.locator(`.chart-panel-${chart.key}`).count()) await locator.locator('svg').waitFor()
      }
      await page.waitForFunction(() => !document.querySelector('.module-content [role="status"]'))
      await page.evaluate(() => document.fonts.ready)
      if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) throw new Error(`Desbordamiento: ${key}/${width}`)
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
      await page.screenshot({ path: fileURLToPath(new URL(`${key}-${width}.png`, output)), fullPage: true })
      if (width === 1440) evidence.modules[key] = {
        status: data.status, eligible_responses: data.eligible_responses,
        charts: data.charts.map(c => ({ key: c.key, status: c.status, denominator: c.denominator, grouped: !!c.grouping_note })),
        filters: data.filters
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  evidence.errors = errors
  await writeFile(new URL('verificacion.json', output), JSON.stringify(evidence, null, 2))
  console.log('18 capturas reales: seis módulos × tres anchos; sin desbordamientos ni errores JS. Solo GET/HEAD.')
  console.log(JSON.stringify(evidence.modules))
} finally { await browser.close() }
