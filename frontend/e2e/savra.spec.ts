import { test, expect, isolatedApi } from './isolated'

test('inicio y consentimiento en escritorio, tableta y móvil sin desbordamiento', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 1050 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Soy estudiante' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Explorar resultados' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/inicio-${viewport.width}.png`, fullPage: true })
    await page.getByRole('link', { name: 'Responder encuesta' }).click()
    await expect(page.getByRole('heading', { name: 'Consentimiento informado' })).toBeVisible()
    await page.getByRole('button', { name: 'No acepto' }).click()
    await expect(page).toHaveURL(/\/$/)
  }
})

test('observatorio real, filtros, gráficos ECharts y navegación adaptable', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.goto('/observatorio')
  await expect(page.getByRole('heading', { name: 'Panorama general.' })).toBeVisible()
  await expect(page.locator('.environment-bar')).toHaveCount(0)
  expect((await page.locator('.sidebar').boundingBox())?.y).toBe(0)
  await expect(page.getByText('Respuestas elegibles', { exact: true })).toBeVisible()
  const baseline = await page.request.get('/api/overview').then(r => r.json())
  expect(baseline.status).toBe('ready')
  const visibleCharts = baseline.charts
  for (const chart of baseline.charts) {
    expect(chart.data.every((d: { count: number }) => d.count === 0 || d.count >= 5)).toBe(true)
  }
  for (const chart of visibleCharts) if (chart.status === 'ready') await expect(page.getByTestId(`chart-${chart.key}`).locator('svg')).toBeVisible()
  await expect(page.getByTestId('chart-main_difficulty').locator('svg [fill="#F2412C" i]').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/panorama-1440.png', fullPage: true })
  const options = await page.locator('#filter-university option').count()
  if (options > 1) {
    const update = page.waitForResponse(response => response.url().includes('/api/overview?university='))
    await page.getByLabel('Universidad', { exact: true }).selectOption({ index: 1 })
    const filtered = await update.then(r => r.json())
    expect(filtered.eligible_responses).toBeLessThan(baseline.eligible_responses)
    await expect(page.locator('.metric-strip').getByText(String(filtered.eligible_responses), { exact: true })).toBeVisible()
    expect(filtered.charts.every((c: { status: string; denominator: number | null }) => c.status === 'ready' ? c.denominator === filtered.eligible_responses : c.denominator === null)).toBe(true)
    await page.getByRole('button', { name: 'Limpiar filtros' }).click()
  }
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/observatorio')
    await expect(page.getByText('Respuestas elegibles', { exact: true })).toBeVisible()
    for (const chart of visibleCharts) {
      if (chart.status === 'ready') await expect(page.getByTestId(`chart-${chart.key}`).locator('svg')).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/panorama-${width}.png`, fullPage: true })
  }
  await page.getByRole('button', { name: 'Abrir navegación' }).click()
  await page.getByRole('link', { name: 'Exploración académica' }).click()
  await expect(page.getByRole('heading', { name: 'Exploración académica.' })).toBeVisible()
  expect(errors).toEqual([])
})

test('encuesta completa, persistencia confirmada y envío idempotente en PostgreSQL aislado', async ({ page }) => {
  await page.goto('/gracias')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/encuesta')
  await expect(page).toHaveURL(/consentimiento$/)
  await page.getByRole('button', { name: 'Aceptar y comenzar' }).click()
  await expect(page).toHaveURL(/encuesta$/)
  let body: unknown
  page.on('request', request => { if (request.url().endsWith('/api/responses')) body = request.postDataJSON() })
  while (true) {
    await expect(page.locator('.survey-form')).toBeVisible()
    for (const select of await page.locator('.question-field select').all()) {
      const eligibility = await select.getAttribute('id') === 'eligibility'
      if (eligibility) await select.selectOption({ label: 'Sí' })
      else await select.selectOption({ index: 1 })
    }
    if (await page.getByRole('button', { name: 'Enviar respuestas' }).count()) break
    await page.getByRole('button', { name: 'Siguiente' }).click()
  }
  await page.screenshot({ path: 'test-results/encuesta-final.png', fullPage: true })
  await page.getByRole('button', { name: 'Enviar respuestas' }).click()
  await expect(page.getByText('Respuesta guardada')).toBeVisible()
  await expect(page).toHaveURL(/gracias$/)
  const result = await page.request.post('/api/responses', { data: body, headers: { Origin: isolatedApi } })
  expect(result.status()).toBe(200)
  expect(await result.json()).toEqual({ saved: true })
  await page.reload()
  await expect(page.getByText('Respuesta guardada')).toBeVisible()
})

test('las rutas públicas no ofrecen registros ni importaciones', async ({ request }) => {
  for (const route of ['/api/responses/1', '/api/imports', '/api/answers', '/api/export', '/api/admin']) {
    expect((await request.get(route)).status()).toBe(404)
  }
  const overview = await request.get('/api/overview').then(r => r.json())
  expect(JSON.stringify(overview)).not.toContain('open_comment')
  expect(JSON.stringify(overview)).not.toContain('payload_hash')
})
