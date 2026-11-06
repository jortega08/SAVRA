import { test, expect } from './isolated'

const modules = [
  ['academico', 'Exploración académica.', 'academic'],
  ['permanencia', 'Indicadores de permanencia.', 'permanence'],
  ['institucional', 'Análisis institucional.', 'institutional'],
  ['datos', 'Gestión de datos.', 'quality'],
  ['metodologia', 'Metodología y alcance.', 'methodology']
] as const

test('los seis módulos, gráficos y tablas funcionan en escritorio, tableta y móvil', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const [path, title, endpoint] of modules) {
      const response = page.waitForResponse(r => r.url().includes(`/api/analytics/${endpoint}?`))
      await page.goto(`/observatorio/${path}`)
      const data = await response.then(r => r.json())
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await expect(page.locator('.environment-bar')).toHaveCount(0)
      if (path === 'metodologia') await expect(page.getByText(/El observatorio presenta datos reales/)).toBeVisible()
      await expect(page.locator('.metric-strip')).toBeVisible()
      expect(data.status).toBe('ready')
      for (const chart of data.charts) {
        const panel = page.locator(`.chart-panel-${chart.key}`)
        if (!await panel.count()) continue // Academic selector exposes one dimension at a time.
        if (chart.status === 'ready') {
          await expect(page.getByTestId(`chart-${chart.key}`).locator('svg')).toBeVisible()
          await expect(panel.getByRole('table')).toHaveCount(0)
          await panel.getByRole('button', { name: /Ampliar gráfico/ }).click()
          await expect(page.getByRole('dialog').getByRole('table')).toBeVisible()
          await page.keyboard.press('Escape')
          expect(chart.data.every((d: { count: number }) => d.count === 0 || d.count >= 5)).toBe(true)
        } else {
          await expect(panel.locator('.chart-state')).toHaveText(/Datos protegidos|Sin cobertura compatible|Aún faltan respuestas|Disponible sin filtros/)
          expect(chart.data).toEqual([])
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0) })
      await page.screenshot({ path: `test-results/fase2-${path}-${width}.png`, fullPage: true })
    }
  }
  expect(errors).toEqual([])
})

test('las seis condiciones académicas y los grupos de semestre son navegables', async ({ page }) => {
  await page.goto('/observatorio/academico')
  const select = page.getByLabel('Condición para comparar con pensamientos de abandono')
  await expect(select).toBeVisible()
  expect(await select.locator('option').count()).toBe(6)
  const options = await select.locator('option').evaluateAll(options => options.map(o => ({ value: (o as HTMLOptionElement).value, text: o.textContent! })))
  for (const option of options) {
    await select.selectOption(option.value)
    await expect(page.getByRole('heading', { level: 2, name: option.text, exact: true })).toBeVisible()
    await page.locator(`.chart-panel-${option.value}`).getByRole('button', { name: /Ampliar gráfico|Ver detalle/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('Pregunta y criterio de cálculo').click()
    await expect(dialog.getByText(/Cada porcentaje usa las respuestas conjuntas/)).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await expect(page.locator('.chart-panel-semester__dropout_thoughts')).toBeVisible()
})

test('el observatorio explica la ausencia de movilidad y excluye la demo pública', async ({ page }) => {
  await page.goto('/observatorio/academico')
  await expect(page.getByRole('link', { name: 'Abrir demostración técnica' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Movilidad estudiantil' }).click()
  await expect(page.getByText('Todavía no se han recopilado datos de movilidad en este entorno.')).toBeVisible()
  await expect(page.locator('.echart')).toHaveCount(0)
  await expect(page.locator('.demo-banner')).toHaveCount(0)
})

test('filtros compartidos, actualización y restablecimiento en todos los módulos', async ({ page }) => {
  await page.goto('/observatorio')
  await expect(page.locator('.metric-strip')).toBeVisible()
  const data = await page.request.get('/api/overview').then(r => r.json())
  const key = data.filters.university.length ? 'university' : 'semester'
  const label = key === 'university' ? 'Universidad' : 'Semestre'
  expect(data.filters[key].length).toBeGreaterThan(0)
  const value = data.filters[key][0]
  await page.getByLabel(label, { exact: true }).selectOption(value)
  await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toBeVisible()
  for (const [path, title, endpoint] of modules) {
    const response = page.waitForResponse(r => r.url().includes(`/api/analytics/${endpoint}?`) && r.url().includes(`${key}=`))
    await page.locator('nav').getByRole('link', { name: title.replace('.', '') }).click()
    const current = await response.then(r => r.json())
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    expect(current.selected[key]).toBe(value)
    expect(current.eligible_responses).toBeLessThanOrEqual(data.eligible_responses)
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(value)
    expect(new URL(page.url()).searchParams.get(key === 'university' ? 'universidad' : 'semestre')).toBe(value)
  }
  const refreshed = page.waitForResponse(r => r.url().includes('/api/analytics/methodology?'))
  await page.getByRole('button', { name: 'Actualizar resultados' }).click()
  expect((await refreshed).status()).toBe(200)
  await expect(page.getByRole('button', { name: 'Actualizar resultados' })).toBeEnabled()
  await page.getByRole('button', { name: 'Limpiar filtros' }).click()
  await expect(page.getByLabel(label, { exact: true })).toHaveValue('')
  await expect(page.locator('.metric-strip').getByText(String(data.eligible_responses), { exact: true })).toBeVisible()
  if (data.filters.semester.length) {
    const semester = data.filters.semester[0]
    const response = page.waitForResponse(r => r.url().includes('/api/analytics/methodology?') && r.url().includes('semester='))
    await page.getByLabel('Semestre', { exact: true }).selectOption(semester)
    const selected = await response.then(r => r.json())
    expect(selected.selected.semester).toBe(semester)
    expect(selected.eligible_responses).toBeGreaterThanOrEqual(5)
    await expect(page.getByLabel('Universidad', { exact: true })).toBeEnabled()
    if (data.filters.university.length) {
      const combined = page.waitForResponse(r => r.url().includes('/api/analytics/methodology?') && r.url().includes('university=') && r.url().includes('semester='))
      await page.getByLabel('Universidad', { exact: true }).selectOption(data.filters.university[0])
      const intersection = await combined.then(r => r.json())
      expect(intersection.selected).toEqual({ university: data.filters.university[0], semester })
      expect(['ready', 'empty']).toContain(intersection.status)
      if (intersection.status === 'ready') expect(intersection.eligible_responses).toBeGreaterThanOrEqual(5)
    }
  }
})

test('errores, vacíos y variables ausentes conservan una pantalla utilizable', async ({ page }) => {
  await page.route('**/api/analytics/academic?*', route => route.fulfill({ status: 503, json: { detail: 'Almacenamiento temporalmente no disponible' } }))
  await page.goto('/observatorio/academico')
  await expect(page.getByRole('alert')).toContainText('Almacenamiento temporalmente no disponible')
  await page.unroute('**/api/analytics/academic?*')
  await page.getByRole('button', { name: 'Volver a intentar' }).click()
  await expect(page.locator('.metric-strip')).toBeVisible()
  const actual = await page.request.get('/api/analytics/academic').then(r => r.json())
  await page.route('**/api/analytics/academic?*', route => route.fulfill({ json: { ...actual, status: 'empty', charts: [], eligible_responses: 0, message: 'Sin respuestas para esta selección.' } }))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Aún no hay resultados' })).toBeVisible()
  await page.unroute('**/api/analytics/academic?*')
  await page.route('**/api/analytics/academic?*', route => route.fulfill({ json: { ...actual, charts: actual.charts.map((c: object) => ({ ...c, status: 'unavailable', data: [], denominator: null, message: 'No hay una variable compatible.' })) } }))
  await page.reload()
  await expect(page.locator('.chart-state').filter({ hasText: 'Sin cobertura compatible' })).toHaveCount(2)
  await expect(page.getByLabel('Condición para comparar con pensamientos de abandono')).toBeVisible()
})

test('matriz publicable renderiza un mapa de calor y sus frecuencias accesibles', async ({ page }) => {
  // Isolated rendering fixture. It is never inserted into a database or deployed.
  const actual = await page.request.get('/api/analytics/academic').then(r => r.json())
  const matrix = { ...actual.charts[0], status: 'ready', denominator: 20, missing: 0, coverage_percentage: 100, message: null, rows: ['3 - Moderadamente motivado', '4 - Bastante motivado'], columns: ['Nunca', 'Rara vez'], data: ['3 - Moderadamente motivado', '4 - Bastante motivado'].flatMap(label => ['Nunca', 'Rara vez'].map(category => ({ label, category, count: 5, row_denominator: 10, percentage: 50 }))) }
  await page.route('**/api/analytics/academic?*', route => route.fulfill({ json: { ...actual, eligible_responses: 20, charts: [matrix] } }))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/observatorio/academico')
    await expect(page.getByTestId(`chart-${matrix.key}`)).toHaveAttribute('data-view', 'heatmap')
    await expect(page.getByTestId(`chart-${matrix.key}`).locator('svg')).toBeVisible()
    await page.getByRole('button', { name: /Ampliar gráfico/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('table')).toContainText('Base del grupo')
    await expect(dialog.getByRole('cell', { name: '50 %', exact: true })).toHaveCount(4)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('la transparencia pública no ofrece operaciones ni respuestas individuales', async ({ page }) => {
  await page.goto('/observatorio/datos')
  await expect(page.getByRole('heading', { name: 'Cobertura por pregunta' })).toBeVisible()
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Importar|Eliminar|Descargar|Modificar/ })).toHaveCount(0)
  await page.getByText('Fuentes, versiones y validación').click()
  await expect(page.getByRole('heading', { name: 'Procedencia' })).toBeVisible()
  for (const [, , module] of modules) {
    const data = await page.request.get(`/api/analytics/${module}`).then(r => r.json())
    for (const field of ['open_comment', 'response_id', 'fingerprint', 'payload_hash', 'import_batch_id']) expect(JSON.stringify(data)).not.toContain(field)
  }
})

test('las primeras participaciones muestran un catálogo y se actualizan sin recargar', async ({ page }) => {
  const ready = await page.request.get('/api/overview').then(r => r.json())
  let current = {
    ...ready, status: 'insufficient', eligible_responses: null, universities: null, composition: undefined,
    charts: ready.charts.map((chart: object) => ({ ...chart, status: 'insufficient', denominator: null, data: [] })),
  }
  await page.route('**/api/overview?*', route => route.fulfill({ json: current }))
  await page.clock.install()
  await page.goto('/observatorio')
  await expect(page.getByText('1–4', { exact: true })).toBeVisible()
  const panel = page.locator('.chart-panel-dropout_thoughts')
  await panel.getByRole('button', { name: /Ver detalle/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Ver categorías del cuestionario').click()
  await expect(dialog.getByRole('list', { name: 'Opciones originales' })).toContainText('Muy frecuentemente')
  await expect(dialog.locator('.echart')).toHaveCount(0)
  current = ready
  await page.clock.fastForward(60_000)
  await expect(page.getByTestId('chart-dropout_thoughts').locator('svg')).toBeVisible()
})
