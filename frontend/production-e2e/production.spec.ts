import { test, expect } from '@playwright/test'
import { createServer } from 'node:https'
import { request as forward } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const origin = 'https://savra.test:8443'
let edge: ReturnType<typeof createServer>

test.beforeAll(async () => {
  edge = createServer({
    key: readFileSync(join(process.env.SAVRA_E2E_TLS!, 'key.pem')),
    cert: readFileSync(join(process.env.SAVRA_E2E_TLS!, 'cert.pem')),
  }, (incoming, outgoing) => {
    const upstream = forward({ hostname: '127.0.0.1', port: 8083, method: incoming.method, path: incoming.url,
      headers: { ...incoming.headers, 'x-forwarded-proto': 'https' } }, response => {
      outgoing.writeHead(response.statusCode!, response.rawHeaders)
      response.pipe(outgoing)
    })
    upstream.on('error', () => outgoing.writeHead(502).end())
    incoming.pipe(upstream)
  })
  await new Promise<void>((resolve, reject) => edge.once('error', reject).listen(8443, '127.0.0.1', resolve))
})
test.afterAll(async () => { if (edge?.listening) await new Promise<void>(resolve => edge.close(() => resolve())) })

test('imagen real: encuesta HTTPS, confirmación y deduplicación', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/encuesta')
  await expect(page).toHaveURL(origin + '/consentimiento')
  await page.getByRole('button', { name: 'Aceptar y comenzar' }).click()
  await expect(page.locator('.survey-form')).toBeVisible()
  const consent = (await context.cookies()).find(cookie => cookie.name === 'savra_participation')!
  expect(consent.secure && consent.httpOnly).toBe(true)
  expect(consent.sameSite).toBe('Strict')
  while (true) {
    for (const select of await page.locator('.question-field select').all()) {
      await select.selectOption(await select.getAttribute('id') === 'eligibility' ? { label: 'Sí' } : { index: 1 })
    }
    if (await page.getByRole('button', { name: 'Enviar respuestas' }).count()) break
    await page.getByRole('button', { name: 'Siguiente' }).click()
  }
  await page.locator('#open_comment').fill('Fixture exclusiva de PostgreSQL desechable; nunca migrar.')
  await page.getByRole('button', { name: 'Enviar respuestas' }).click()
  await expect(page).toHaveURL(origin + '/gracias')
  await expect(page.getByText('Respuesta guardada')).toBeVisible()
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
