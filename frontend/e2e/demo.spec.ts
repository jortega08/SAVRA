import type { Page } from '@playwright/test'
import { expect, test } from './isolated'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { SIMULATION_NOTICE, type AnalyticsData, type ChartData } from '../src/lib/api'

const modules = [
  ['panorama', '/observatorio', '/api/overview'],
  ['academico', '/observatorio/academico', '/api/analytics/academic'],
  ['permanencia', '/observatorio/permanencia', '/api/analytics/permanence'],
  ['institucional', '/observatorio/institucional', '/api/analytics/institutional'],
  ['datos', '/observatorio/datos', '/api/analytics/quality'],
  ['metodologia', '/observatorio/metodologia', '/api/analytics/methodology'],
] as const

function checkCounts(chart: ChartData) {
  if (chart.status !== 'ready') {
    expect(chart.data).toEqual([])
    expect(chart.denominator).toBeNull()
    return
  }
  expect(chart.data.every(row => row.count === 0 || row.count >= 5)).toBe(true)
  expect(chart.data.reduce((sum, row) => sum + row.count, 0)).toBe(chart.denominator)
  for (const row of chart.data) {
    const base = (row.row_denominator ?? chart.denominator)!
    expect(row.percentage).toBeCloseTo(100 * row.count / base, 1)
  }
}

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_DEMO !== '1') return
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0) })
  const path = fileURLToPath(new URL(`../../docs/capturas/fase3/${name}.png`, import.meta.url))
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
}

test('seis pantallas con la base sintética y aviso permanente en tres anchos', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const [name, path, endpoint] of modules) {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === endpoint)
      await page.goto(path)
      const data: AnalyticsData = await (await response).json()
      expect(data.status).toBe('ready')
      expect(data.data_mode).toBe('demo')
      expect(data.data_notice).toBe(SIMULATION_NOTICE)
      expect(data.eligible_responses).toBe(2500)
      await expect(page.locator('.demo-banner')).toContainText(SIMULATION_NOTICE)
      await expect(page.getByRole('link', { name: 'Ir a datos reales' })).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Resumen simulado de la selección' }).getByText('Registros sintéticos', { exact: true })).toBeVisible()
      for (const chart of data.charts) {
        checkCounts(chart)
        if (chart.status === 'ready' && await page.locator(`.chart-panel-${chart.key}`).count()) {
          await expect(page.getByTestId(`chart-${chart.key}`).locator('svg')).toBeVisible()
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      expect((await page.locator('.demo-banner').boundingBox())?.y).toBe(0)
      if (width === 1440) await capture(page, name)
    }
  }
  expect(errors).toEqual([])
})

test('movilidad, denominadores, CSV y filtros de la base demo', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/observatorio/academico')
  await page.getByRole('button', { name: 'Movilidad estudiantil' }).click()
  await expect(page.getByTestId('chart-transport_mode').locator('svg')).toBeVisible()
  const endpoint = '/api/analytics/academic'
  const data: AnalyticsData = await page.request.get(endpoint).then(r => r.json())
  expect(data.filters.university).toHaveLength(5)
  expect(data.filters.university).toContain('Otras universidades')
  expect(data.mobility?.charts).toHaveLength(5)
  for (const chart of [...data.mobility!.charts, ...data.mobility!.comparisons]) {
    expect(chart.status).toBe('ready')
    checkCounts(chart)
  }
  for (const chart of data.mobility!.charts) {
    await expect(page.getByTestId(`chart-${chart.key}`).locator('svg')).toBeVisible()
  }
  const comparison = page.getByLabel('Variable de movilidad para comparar')
  await comparison.selectOption('commute_time__dropout_thoughts')
  await expect(page.getByTestId('chart-commute_time__dropout_thoughts').locator('svg')).toBeVisible()
  await capture(page, 'movilidad')

  const transport = page.locator('.chart-panel-transport_mode')
  await transport.getByRole('button', { name: /Ampliar gráfico/ }).click()
  const detail = page.getByRole('dialog')
  await expect(detail.getByRole('table')).toContainText('Datos simulados')
  const downloadStarted = page.waitForEvent('download')
  await detail.getByRole('button', { name: /Descargar CSV simulado/ }).click()
  const download = await downloadStarted
  expect(download.suggestedFilename()).toBe('savra-datos-simulados-transport_mode.csv')
  const csv = await readFile((await download.path())!, 'utf8')
  const lines = csv.trim().split(/\r?\n/)
  expect(lines).toHaveLength(data.mobility!.charts[0].data.length + 1)
  for (const line of lines.slice(1)) {
    expect(line).toContain(SIMULATION_NOTICE)
    expect(line).toContain(',"2500",')
  }
  await page.keyboard.press('Escape')

  const university = data.filters.university[0], semester = data.filters.semester[0]
  await page.getByLabel('Universidad', { exact: true }).selectOption(university)
  const update = page.waitForResponse(r => r.url().includes('university=') && r.url().includes('semester='))
  await page.getByLabel('Semestre', { exact: true }).selectOption(semester)
  const filtered: AnalyticsData = await (await update).json()
  expect(filtered.selected).toEqual({ university, semester })
  expect(filtered.eligible_responses).toBeLessThan(2500)
  expect(filtered.mobility?.charts[0].denominator).toBe(filtered.eligible_responses)
  const originalTime = data.mobility!.comparisons.find(chart => chart.key === 'commute_time__dropout_thoughts')!
  expect(originalTime.grouping_rules).toEqual({})
  expect(filtered.mobility?.comparisons.find(chart => chart.key === originalTime.key)?.denominator).toBeNull()
  const withheld = page.locator(`.chart-panel-${originalTime.key}`)
  await expect(withheld.getByText('Frecuencias reservadas')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Movilidad estudiantil' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.chart-panel-transport_mode .chart-base')).toContainText(String(filtered.eligible_responses))
  for (const chart of [...filtered.mobility!.charts, ...filtered.mobility!.comparisons]) checkCounts(chart)
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByTestId('chart-transport_mode').locator('svg')).toBeVisible()
    await expect(withheld.getByText('Frecuencias reservadas')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  expect(errors).toEqual([])
})

test('la demo bloquea participación y mantiene el aviso fuera del observatorio', async ({ page }) => {
  const chartRequests: string[] = []
  page.on('request', request => { if (request.url().includes('/assets/DistributionChart-')) chartRequests.push(request.url()) })
  for (const path of ['/', '/consentimiento', '/encuesta', '/gracias', '/ruta-inexistente']) {
    await page.goto(path)
    await expect(page.locator('.demo-banner')).toContainText(SIMULATION_NOTICE)
    await expect(page.getByRole('link', { name: 'Responder encuesta' })).toHaveCount(0)
  }
  expect(chartRequests).toEqual([])
  for (const path of ['/api/participation/start', '/api/responses']) {
    expect((await page.request.post(path, { data: {} })).status()).toBe(403)
  }
  for (const path of ['/api/responses', '/api/imports', '/api/admin/generate-demo']) {
    expect((await page.request.get(path)).status()).toBeGreaterThanOrEqual(400)
  }
})
