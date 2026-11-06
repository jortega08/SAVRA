// Browser evidence from the sole real application, with writes blocked.
import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const origin = 'http://localhost:8080'
const output = new URL('../../docs/capturas/consolidacion/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const request = route.request()
    return request.method() === 'GET' && new URL(request.url()).origin === origin ? route.continue() : route.abort()
  })

  for (const path of ['/', '/consentimiento', '/encuesta', '/gracias', '/break', '/observatorio',
    ...['academico', 'permanencia', 'institucional', 'datos', 'metodologia'].map(module => '/observatorio/' + module)]) {
    expect((await page.request.get(origin + path)).status(), path).toBe(200)
  }
  expect(await (await page.request.get(origin + '/api/health')).json()).toEqual({ status: 'ok' })
  expect((await (await page.request.get(origin + '/api/meta')).json()).data_mode).toBe('real')
  for (const path of ['/demo', '/api/demo', '/api/admin/generate-demo', '/api/responses/1']) {
    expect((await page.request.get(origin + path)).status(), path).toBe(404)
  }

  async function goto(path) {
    await page.goto(origin + path)
    await page.locator('.metric-strip').waitFor()
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true)
  }

  function capture(name, locator) {
    return locator.screenshot({ path: fileURLToPath(new URL(name + '.png', output)), animations: 'disabled' })
  }

  async function openCatalog(panel) {
    await panel.getByRole('button', { name: /^(Ampliar gráfico|Ver detalle):/ }).click()
    const detail = page.getByRole('dialog')
    await detail.getByText('Ver categorías del cuestionario').click()
    return detail
  }

  async function closeDetail() {
    await page.getByRole('button', { name: 'Cerrar gráfico ampliado' }).click()
  }

  await goto('/observatorio')
  const donut = page.getByTestId('chart-dropout_thoughts')
  await expect(donut).toHaveAttribute('data-view', 'donut')
  await donut.locator('svg').waitFor()
  await capture('01-panorama', page.locator('.observatory-main'))
  const donutPanel = page.locator('.chart-panel-dropout_thoughts')
  await capture('02-dona-categorias', await openCatalog(donutPanel))
  await closeDetail()

  await goto('/observatorio/permanencia')
  const economy = page.locator('.chart-panel-economic_difficulty')
  await expect(economy.getByTestId('chart-economic_difficulty')).toHaveAttribute('data-view', 'likert')
  const economyDetail = await openCatalog(economy)
  await expect(economyDetail.getByRole('table')).toBeVisible()
  await capture('03-likert-y-cero', economyDetail)
  await closeDetail()
  const enrollment = page.locator('.chart-panel-enrollment_likelihood')
  await enrollment.getByTestId('chart-enrollment_likelihood').locator('svg').waitFor()
  await capture('04-barras-matricula', await openCatalog(enrollment))
  await closeDetail()

  await goto('/observatorio/academico')
  await page.getByLabel('Condición para comparar con pensamientos de abandono').selectOption('academic_load__dropout_thoughts')
  const heat = page.locator('.chart-panel-academic_load__dropout_thoughts')
  await heat.getByTestId('chart-academic_load__dropout_thoughts').locator('svg').waitFor()
  await capture('05-mapa-de-calor', heat)

  await goto('/observatorio/institucional')
  const reserved = page.locator('.chart-panel-university__dropout_thoughts')
  await capture('06-cruce-reservado', await openCatalog(reserved))
  await closeDetail()

  await page.setViewportSize({ width: 390, height: 844 })
  await goto('/observatorio')
  await page.getByRole('button', { name: 'Ampliar gráfico: Pensamientos de abandono' }).click()
  const dialog = page.getByRole('dialog', { name: 'Pensamientos de abandono' })
  await dialog.getByTestId('expanded-chart-dropout_thoughts').locator('svg').waitFor()
  await capture('07-dona-ampliada-movil', dialog)
  expect(errors).toEqual([])
  console.log('8080 verificado, siete capturas reales, ninguna escritura.')
} finally {
  await browser.close()
}
