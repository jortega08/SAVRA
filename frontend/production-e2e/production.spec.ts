import { test, expect } from '@playwright/test'
import './edge'

const origin = 'https://savra.test:8443'

test('imagen real: encuesta HTTPS, confirmación y deduplicación', async ({ page, context }) => {
  const startedAt = Date.now()
  let submissions = 0
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/responses' && request.method() === 'POST') submissions++ })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/encuesta')
  await expect(page).toHaveURL(origin + '/consentimiento')
  await page.getByRole('button', { name: 'Aceptar y comenzar' }).click()
  await expect(page.locator('.survey-form')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Compartir SAVRA' })).toHaveCount(0)
  const consent = (await context.cookies()).find(cookie => cookie.name === 'savra_participation')!
  expect(consent.secure && consent.httpOnly).toBe(true)
  expect(consent.sameSite).toBe('Strict')
  // Leaving before sending discards in-memory answers without creating a row.
  await page.locator('#eligibility').selectOption({ label: 'Sí' })
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await expect(page.getByRole('group', { name: '¿A qué área pertenece tu carrera?' })).toBeVisible()
  await page.getByRole('radio', { name: /^Ciencias naturales, matemáticas y estadística/ }).check()
  await page.getByRole('link', { name: 'Volver al inicio', exact: true }).click()
  await page.getByRole('link', { name: 'Responder encuesta' }).click()
  await page.getByRole('button', { name: 'Aceptar y comenzar' }).click()
  await expect(page.locator('#eligibility')).toHaveValue('')
  await page.locator('#eligibility').selectOption({ label: 'Sí' })
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancelar encuesta' }).click()
  await expect(page).toHaveURL(origin + '/')
  expect((await context.cookies()).some(cookie => cookie.name === 'savra_participation')).toBe(false)
  await page.goto('/encuesta')
  await expect(page).toHaveURL(origin + '/consentimiento')
  await page.getByRole('button', { name: 'Aceptar y comenzar' }).click()
  await page.locator('#eligibility').selectOption({ label: 'Sí' })
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await page.reload()
  await expect(page.locator('#eligibility')).toHaveValue('')
  await expect(page.getByText('Paso 1 de 5')).toBeVisible()
  // Mobile labels wrap naturally; every area can be selected and scrolled into view.
  await page.setViewportSize({ width: 390, height: 844 })
  while (true) {
    for (const select of await page.locator('.question-field select').all()) {
      const key = await select.getAttribute('id')
      const choices = await select.locator('option').evaluateAll(options => options.slice(1).map(option => (option as HTMLOptionElement).value))
      if (['gpa_range', 'failed_courses', 'relocated_for_study', 'transport_mode', 'commute_time', 'weekly_transport_cost', 'mobility_delay', 'preferred_support', 'main_difficulty'].includes(key ?? '')) {
        for (const value of choices) { await select.selectOption(value); await expect(select).toHaveValue(value) }
      }
      await select.selectOption(key === 'eligibility' ? { label: 'Sí' } : ['gpa_range', 'failed_courses'].includes(key ?? '') ? choices.at(-1)! : { index: 1 })
      if (['main_difficulty', 'transport_mode', 'preferred_support'].includes(key ?? '')) {
        const conditional = page.locator(`#${key}_other`)
        await select.selectOption(choices.at(-1)!)
        await expect(conditional).toBeVisible()
        await expect(conditional).toHaveAttribute('maxlength', '300')
        await conditional.fill('Borrador que debe descartarse al cambiar la opción.')
        await select.selectOption({ index: 1 })
        await expect(conditional).toHaveCount(0)
        await select.selectOption(choices.at(-1)!)
        await expect(conditional).toHaveValue('')
        await conditional.fill('Fixture condicional aislada, sin identidad personal.')
      }
    }
    const areas = page.getByRole('radio')
    if (await areas.count()) {
      expect(await areas.count()).toBe(12)
      await expect(page.getByText('Biología, química, física, matemáticas y estadística.', { exact: true })).toBeVisible()
      await expect(page.getByText('Agronomía, zootecnia y Medicina Veterinaria.', { exact: true })).toBeVisible()
      for (const area of await areas.all()) {
        await area.check()
        await expect(area).toBeChecked()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
      await page.evaluate(() => { const bar = document.querySelector('.environment-bar span'); if (bar) bar.textContent = 'VERIFICACIÓN · BASE AISLADA' })
      await page.screenshot({ path: '../.local/areas-v2-audit/areas-mobile.png', fullPage: true, animations: 'disabled', style: '.environment-bar { position: static !important; }' })
    }
    if (await page.getByRole('button', { name: 'Enviar respuestas' }).count()) break
    await page.getByRole('button', { name: 'Siguiente' }).click()
  }
  expect(submissions).toBe(0)
  const requiredOther = page.locator('#main_difficulty_other')
  await requiredOther.fill('')
  await page.getByRole('button', { name: 'Enviar respuestas' }).click()
  expect(await requiredOther.evaluate(input => (input as HTMLTextAreaElement).validity.valueMissing)).toBe(true)
  expect(submissions).toBe(0)
  await requiredOther.fill('Fixture condicional aislada, sin identidad personal.')
  await page.locator('#open_comment').fill('Fixture exclusiva de PostgreSQL desechable; nunca migrar.')
  await page.screenshot({ path: '../.local/areas-v2-audit/conditional-mobile.png', fullPage: true, animations: 'disabled', style: '.environment-bar { position: static !important; }' })
  await page.getByRole('button', { name: 'Enviar respuestas' }).click()
  await expect(page).toHaveURL(origin + '/gracias')
  await expect(page.getByText('Respuesta guardada')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Compartir SAVRA' })).toBeVisible()
  await page.getByRole('button', { name: 'Más opciones' }).click()
  await page.screenshot({ path: '../.local/sharing-audit/thanks-mobile.png', fullPage: true })
  await page.getByRole('link', { name: 'Volver al inicio', exact: true }).first().click()
  await expect(page.getByRole('link', { name: 'Participación completada' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Responder encuesta' })).toHaveCount(0)
  await page.goto('/encuesta')
  await expect(page).toHaveURL(origin + '/gracias')
  await page.reload()
  await expect(page.getByText('Respuesta guardada')).toBeVisible()
  const completed = (await context.cookies()).find(cookie => cookie.name === 'savra_completed')!
  expect(completed.secure && completed.httpOnly).toBe(true)
  const duplicate = await page.evaluate(async () => {
    const version = (await (await fetch('/api/questionnaire')).json()).version
    return (await fetch('/api/participation/start', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepted: true, questionnaire_version: version }) })).status
  })
  expect(duplicate).toBe(409)
  expect(errors).toEqual([])
  expect(submissions).toBe(1)
  console.log(`Flujo automatizado (sin tiempo humano de lectura): ${((Date.now() - startedAt) / 1000).toFixed(1)} segundos.`)
})

test('imagen real: rutas del observatorio, assets y ambos juegos', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const path of ['/observatorio', '/observatorio/academico', '/observatorio/permanencia',
    '/observatorio/institucional', '/observatorio/datos', '/observatorio/metodologia']) {
    expect((await page.goto(path))?.status()).toBe(200)
    await expect(page.locator('main h1').first()).toBeVisible()
  }
  await page.goto('/break')
  await expect(page.getByRole('link', { name: 'SAVRA Reflex' })).toBeVisible()
  await page.getByRole('link', { name: 'SAVRA 2048' }).click()
  const board = page.getByRole('group', { name: 'Tablero de 2048' })
  await expect(board).toBeVisible()
  await board.focus()
  await page.keyboard.press('ArrowDown')
  expect(errors).toEqual([])
})

test('imagen real: rutas privadas, cabeceras, origen y cuerpo limitado', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const privatePaths = ['/.env', '/datos_originales/datos.xlsx', '/api/answers', '/api/imports', '/docs', '/openapi.json', '/assets/missing.js']
    const statuses = await Promise.all(privatePaths.map(async path => (await fetch(path)).status))
    const oversized = await fetch('/api/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(33000) }) })
    const health = await fetch('/api/health')
    return { statuses, oversized: oversized.status,
      csp: health.headers.get('content-security-policy'), cache: health.headers.get('cache-control') }
  })
  expect(result.statuses).toEqual(Array(7).fill(404))
  expect(result.oversized).toBe(413)
  expect(result.csp).toContain("frame-ancestors 'none'")
  expect(result.cache).toBe('no-store')
  const forbidden = await page.request.post('https://127.0.0.1:8443/api/participation/start', {
    headers: { Host: 'savra.test:8443', Origin: 'https://other.test' }, data: {},
  })
  expect(forbidden.status()).toBe(403)
})
