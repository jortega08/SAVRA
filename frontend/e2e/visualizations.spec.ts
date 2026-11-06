import type { Locator } from '@playwright/test'
import { expect, test } from './isolated'
import { readFile } from 'node:fs/promises'
import type { AnalyticsData, ChartData } from '../src/lib/api'
import { SIMULATION_NOTICE } from '../src/lib/api'
import { chartColors } from '../src/components/chartPalette'

function checkMatrix(chart: ChartData) {
  expect(chart.status).toBe('ready')
  expect(chart.data.reduce((sum, d) => sum + d.count, 0)).toBe(chart.denominator)
  for (const row of chart.rows!) {
    const cells = chart.data.filter(d => d.label === row)
    const denominator = cells.reduce((sum, d) => sum + d.count, 0)
    expect(cells).toHaveLength(chart.columns!.length)
    for (const cell of cells) {
      expect(cell.count === 0 || cell.count >= 5).toBe(true)
      expect(cell.row_denominator).toBe(denominator)
      expect(cell.percentage).toBeCloseTo(100 * cell.count / denominator, 1)
    }
  }
}

test('dona, mapas, Likert, puntos y Sankey usan los datos publicables de 2.500 registros', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 1440, height: 1000 })
  const overview: AnalyticsData = await page.request.get('/api/overview').then(r => r.json())
  expect(overview.eligible_responses).toBe(2500)
  const composition = overview.composition!
  const never = overview.charts.find(c => c.key === 'dropout_thoughts')!.data.find(d => d.label === 'Nunca')!
  expect(composition.data.map(d => d.count)).toEqual([never.count, 2500 - never.count])
  await page.goto('/observatorio')
  await expect(page.getByTestId('chart-dropout_thoughts')).toHaveAttribute('data-view', 'donut')
  await expect(page.getByTestId('chart-dropout_thoughts').locator('svg')).toBeVisible()
  await page.locator('.chart-panel-dropout_thoughts').getByRole('button', { name: /Ampliar gráfico/ }).click()
  const overviewDetail = page.getByRole('dialog')
  await overviewDetail.getByText('Pregunta y criterio de cálculo').click()
  await expect(overviewDetail.getByText(/al menos una vez/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('/observatorio/academico')
  const selector = page.getByLabel('Condición para comparar con pensamientos de abandono')
  const academic: AnalyticsData = await page.request.get('/api/analytics/academic').then(r => r.json())
  for (const key of ['motivation', 'economic_difficulty', 'academic_load']) {
    const comparison = `${key}__dropout_thoughts`
    checkMatrix(academic.charts.find(c => c.key === comparison)!)
    await selector.selectOption(comparison)
    const plot = page.getByTestId(`chart-${comparison}`)
    await expect(plot).toHaveAttribute('data-view', 'heatmap')
    await expect(plot.locator('svg')).toContainText('100 %')
  }
  await expect(page.getByTestId('chart-semester__dropout_thoughts')).toHaveAttribute('data-view', 'stack')
  await page.getByRole('button', { name: 'Movilidad estudiantil' }).click()
  const flow = academic.mobility!.flow!
  checkMatrix(flow)
  expect(flow.denominator).toBe(2500)
  await expect(page.getByTestId(`chart-${flow.key}`)).toHaveAttribute('data-view', 'sankey')
  await expect(page.getByTestId(`chart-${flow.key}`).locator('svg')).toContainText('Transporte público')
  await page.goto('/observatorio/permanencia')
  for (const key of ['motivation', 'economic_difficulty', 'academic_load', 'institutional_support']) {
    await expect(page.getByTestId(`chart-${key}`)).toHaveAttribute('data-view', 'likert')
    await expect(page.getByTestId(`chart-${key}`).locator('svg')).toBeVisible()
  }
  await expect(page.locator('.chart-panel-motivation .chart-legend button')).toHaveCount(4)
  await page.goto('/observatorio/institucional')
  const institutional: AnalyticsData = await page.request.get('/api/analytics/institutional').then(r => r.json())
  const points = institutional.institutional_points!
  const matrix = institutional.charts.find(c => c.key === 'university__dropout_thoughts')!
  for (const point of points.data) {
    const rows = matrix.data.filter(d => d.label === point.label)
    expect(point.count).toBe(rows.filter(d => ['Frecuentemente', 'Muy frecuentemente'].includes(d.category!)).reduce((sum, d) => sum + d.count, 0))
    expect(point.row_denominator).toBe(rows[0].row_denominator)
    expect(point.percentage).toBeCloseTo(100 * point.count / point.row_denominator!, 1)
  }
  expect(points.reference?.count).toBe(points.data.reduce((sum, d) => sum + d.count, 0))
  const plot = page.getByTestId(`chart-${points.key}`)
  await expect(plot).toHaveAttribute('data-view', 'dot')
  await expect(plot.locator('svg')).toContainText('n =')
  await expect(page.locator('.chart-reference')).toContainText('Conjunto seleccionado')
  const semester = page.getByLabel('Semestre', { exact: true })
  const request = page.waitForResponse(r => r.url().includes('/api/analytics/institutional?semester='))
  await semester.selectOption(institutional.filters.semester[0])
  const filtered: AnalyticsData = await (await request).json()
  await expect(plot).toHaveAttribute('aria-label', new RegExp(String(filtered.eligible_responses)))
  expect(filtered.institutional_points?.denominator).toBe(filtered.eligible_responses)
  const mark = plot.locator(`path[fill="${chartColors.warmDark}" i]`).first()
  await mark.scrollIntoViewIfNeeded()
  const bounds = (await mark.boundingBox())!
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await page.mouse.move(point.x, point.y)
  await expect(plot.locator('svg')).toContainText('Filtrar por esta universidad')
  const clicked = page.waitForResponse(r => r.url().includes('/api/analytics/institutional?') && r.url().includes('university='))
  await page.mouse.click(point.x, point.y)
  const selected: AnalyticsData = await (await clicked).json()
  expect(institutional.filters.university).toContain(selected.selected.university)
  expect(selected.selected.semester).toBe(filtered.selected.semester)
  expect(selected.institutional_points?.reference).toBeNull()
  expect(errors).toEqual([])
})

test('detalle con teclado, leyenda, movimiento reducido y exportaciones a 390 px', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/observatorio')
  const plot = page.getByTestId('chart-dropout_thoughts')
  await expect(plot).toHaveAttribute('data-motion', 'normal')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(plot).toHaveAttribute('data-motion', 'reducido')
  const panel = page.locator('.chart-panel-dropout_thoughts')
  await expect(panel.getByText('Ver categorías del cuestionario')).toHaveCount(0)
  await expect(panel.getByRole('table')).toHaveCount(0)
  await expect(page.locator('.workspace-header')).not.toContainText(/OBSERVATORIO SAVRA/i)
  const category = panel.getByRole('button', { name: /Resaltar Nunca/ })
  await category.focus()
  await page.keyboard.press('Space')
  await expect(category).toHaveAttribute('aria-pressed', 'true')
  const expand = panel.getByRole('button', { name: /Ampliar gráfico/ })
  await expand.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Pensamientos de abandono' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cerrar gráfico ampliado' })).toBeFocused()
  await dialog.getByText('Pregunta y criterio de cálculo').click()
  await expect(dialog.getByText('Cada segmento usa', { exact: false })).toBeVisible()
  await expect(dialog.getByTestId('expanded-chart-dropout_thoughts').locator('svg')).toBeVisible()
  await expect(dialog.getByRole('table')).toContainText('Datos simulados')
  await expect(dialog.getByRole('table')).toContainText('Rara vez')
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true)
  for (const type of ['SVG', 'PNG']) {
    const started = page.waitForEvent('download')
    await dialog.getByRole('button', { name: `Exportar ${type}` }).click()
    const download = await started
    expect(download.suggestedFilename()).toBe(`savra-simulacion-dropout_thoughts.${type.toLowerCase()}`)
    const bytes = await readFile((await download.path())!)
    if (type === 'SVG') {
      expect(bytes.toString()).toContain(SIMULATION_NOTICE)
      expect(bytes.toString()).toContain('Rara vez')
    } else {
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(bytes.readUInt32BE(16)).toBeGreaterThan(1000)
    }
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(expand).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.goto('/observatorio/academico')
  await expect(page.getByRole('list', { name: 'Clave de columnas' })).toContainText('1 Nunca')
  expect(errors).toEqual([])
})

async function visibleRowOrder(svg: Locator, labels: string[]) {
  return svg.locator('text').evaluateAll((elements, names) => elements
    .filter(element => names.includes(element.textContent ?? ''))
    .sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y)
    .map(element => element.textContent), labels)
}

test('semestre y próxima matrícula ordenan las barras simples por frecuencia y se dibujan sin contorno', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const [path, endpoint, key] of [
    ['/observatorio', '/api/overview', 'semester'],
    ['/observatorio/permanencia', '/api/analytics/permanence', 'enrollment_likelihood'],
  ]) {
    const data: AnalyticsData = await page.request.get(endpoint).then(r => r.json())
    const chart = data.charts.find(item => item.key === key)!
    const sorted = [...chart.data].sort((a, b) => b.count - a.count)
    await page.goto(path)
    const panel = page.locator(`.chart-panel-${key}`)
    const plot = page.getByTestId(`chart-${key}`)
    const svg = plot.locator('svg')
    await expect(svg).toBeVisible()
    const limit = (await plot.evaluate(element => element.clientWidth)) < 505 ? 17 : 25
    const labels = sorted.map(row => row.label.match(new RegExp(`^.{1,${limit}}(?= |$)`))?.[0] ?? row.label)
    await expect.poll(() => visibleRowOrder(svg, labels)).toEqual(labels)
    const marks = svg.locator(`path[fill="${chartColors.tomato}" i]`)
    await expect(marks).toHaveCount(sorted.length)
    await marks.first().hover()
    await expect(svg.locator(`path[fill="${chartColors.tomato}" i][stroke]:not([stroke="none"])`)).toHaveCount(0)
    await panel.getByRole('button', { name: /Ampliar gráfico/ }).click()
    expect(await page.getByRole('dialog').locator('tbody th').allTextContents()).toEqual(sorted.map(row => row.label))
    await page.keyboard.press('Escape')
  }
})

test('el orden por pensamientos frecuentes se conserva en gráfico, tabla y exportaciones', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/observatorio/academico')
  const data: AnalyticsData = await page.request.get('/api/analytics/academic').then(r => r.json())
  const semester = data.charts.find(chart => chart.key === 'semester__dropout_thoughts')!
  const academicOrder = semester.rows!
  const sorted = academicOrder.map(label => {
    const cells = semester.data.filter(d => d.label === label && ['Frecuentemente', 'Muy frecuentemente'].includes(d.category!))
    return { label, rate: cells.reduce((sum, cell) => sum + cell.count, 0) / cells[0].row_denominator! }
  }).sort((a, b) => b.rate - a.rate).map(row => row.label)
  expect(sorted).not.toEqual(academicOrder)
  const panel = page.locator('.chart-panel-semester__dropout_thoughts')
  const plot = page.getByTestId(`chart-${semester.key}`)
  const svg = plot.locator('svg')
  await expect(svg).toBeVisible()
  await expect(panel.getByLabel('Orden del gráfico')).toHaveCount(0)
  await expect.poll(() => visibleRowOrder(svg, academicOrder)).toEqual(sorted)
  const originalSvg = await svg.elementHandle()
  for (const color of [chartColors.silver, chartColors.salmon]) {
    await svg.locator(`path[fill="${color}" i]`).first().hover()
    await expect(svg.locator(`path[fill="${color}" i][stroke]:not([stroke="none"])`)).toHaveCount(0)
  }
  const rowLabels = (region: Locator) => region.locator('tbody th').allTextContents().then(labels => [...new Set(labels)])
  expect(await rowLabels(panel)).toEqual([])
  await panel.getByRole('button', { name: /Ampliar gráfico/ }).click()
  const dialog = page.getByRole('dialog')
  const order = dialog.getByLabel('Orden del gráfico')
  await expect(order).toHaveValue('frequent')
  const expanded = dialog.locator('.echart svg')
  await order.selectOption('default')
  await expect.poll(() => visibleRowOrder(expanded, academicOrder)).toEqual(academicOrder)
  expect(await rowLabels(dialog)).toEqual(academicOrder)
  await order.selectOption('frequent')
  await expect.poll(() => visibleRowOrder(expanded, academicOrder)).toEqual(sorted)
  expect(await rowLabels(dialog)).toEqual(sorted)
  for (const format of ['SVG', 'PNG']) {
    const started = page.waitForEvent('download')
    await dialog.getByRole('button', { name: `Exportar ${format}` }).click()
    const file = await readFile((await (await started).path())!)
    if (format === 'PNG') {
      expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      continue
    }
    const xml = file.toString()
    expect(xml).toContain('Orden · Mayor proporción de pensamientos frecuentes')
    for (const color of ['#34363C', '#81848D', '#C9CBD0', '#F5A092', '#F2412C']) expect(xml).toContain(color)
    const exportedOrder = await page.evaluate(({ xml, names }) => {
      const doc = new DOMParser().parseFromString(xml, 'image/svg+xml')
      return [...doc.querySelectorAll('text')].filter(text => names.includes(text.textContent ?? '')).map(text => text.textContent)
    }, { xml, names: academicOrder })
    expect(exportedOrder).toEqual(sorted)
  }
  await page.keyboard.press('Escape')
  await expect.poll(() => visibleRowOrder(svg, academicOrder)).toEqual(sorted)
  expect(await svg.evaluate((element, original) => element === original, originalSvg)).toBe(true)
  const refresh = page.waitForResponse(r => r.url().includes('/api/analytics/academic?university='))
  await page.getByLabel('Universidad', { exact: true }).selectOption(data.filters.university[0])
  await refresh
  await expect(panel.getByRole('button', { name: 'Resaltar Muy frecuentemente' }).locator('i')).toHaveCSS('background-color', 'rgb(242, 65, 44)')
  await panel.getByRole('button', { name: /Ampliar gráfico/ }).click()
  await expect(order).toHaveValue('frequent')
  expect(errors).toEqual([])
})
