import { devices } from '@playwright/test'
import { expect, test, isolatedApi } from './isolated'
import { readFileSync } from 'node:fs'
import { request as forward } from 'node:http'
import { createServer } from 'node:https'
import { join } from 'node:path'

const origin = 'https://savra.test:8443'
const tlsLoopback = 'https://127.0.0.1:8443'
const host = new URL(origin).host
const start = '/api/participation/start'
const marker = 'Comentario exclusivo del stack de prueba fase 4'
let edge: ReturnType<typeof createServer> | undefined

test.use({
  ...devices['Pixel 7'],
  baseURL: origin,
  ignoreHTTPSErrors: true,
  launchOptions: { args: ['--host-resolver-rules=MAP savra.test 127.0.0.1'] },
})

test.beforeAll(async () => {
  const meta = await fetch(`${isolatedApi}/api/meta`).then(response => response.json())
  expect(meta).toEqual({ data_mode: 'real', public_origin: origin })
  edge = createServer({
    key: readFileSync(join(process.env.SAVRA_E2E_TLS!, 'key.pem')),
    cert: readFileSync(join(process.env.SAVRA_E2E_TLS!, 'cert.pem')),
  }, (incoming, outgoing) => {
    const upstream = forward({
      hostname: '127.0.0.1', port: 8082, method: incoming.method, path: incoming.url,
      headers: { ...incoming.headers, 'x-forwarded-proto': 'https' },
    }, response => {
      outgoing.writeHead(response.statusCode!, response.rawHeaders)
      response.pipe(outgoing)
    })
    upstream.on('error', () => outgoing.writeHead(502).end())
    incoming.pipe(upstream)
  })
  await new Promise<void>((resolve, reject) => edge!.once('error', reject).listen(8443, '127.0.0.1', resolve))
})

test.afterAll(async () => {
  if (edge?.listening) await new Promise<void>(resolve => edge!.close(() => resolve()))
})

test('móvil HTTPS: rechazar, consentir, guardar y confirmar en PostgreSQL aislado', async ({ page, context }) => {
  await page.goto('/gracias')
  await expect(page).toHaveURL(origin + '/')
  await expect(page.getByText('Respuesta guardada')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Soy estudiante' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Abrir demostración técnica' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Responder encuesta' }).click()
  await expect(page).toHaveURL(origin + '/consentimiento')
  const decline = page.waitForResponse(origin + start)
  await page.getByRole('button', { name: 'No acepto' }).click()
  expect(await (await decline).json()).toEqual({ accepted: false })
  await expect(page).toHaveURL(origin + '/')
  expect(await context.cookies()).toEqual([])

  await page.goto('/encuesta')
  await expect(page).toHaveURL(origin + '/consentimiento')
  const accept = page.waitForResponse(origin + start)
  await page.getByRole('button', { name: 'Aceptar y comenzar' }).click()
  const consent = await accept
  expect(consent.ok()).toBe(true)
  expect(await consent.request().headerValue('origin')).toBe(origin)
  const cookie = await consent.headerValue('set-cookie')
  expect(cookie).toMatch(/;\s*Secure\b/i)
  expect(cookie).toMatch(/;\s*HttpOnly\b/i)
  expect(cookie).toMatch(/;\s*SameSite=strict\b/i)
  expect(cookie).not.toMatch(/;\s*Domain=/i)
  await expect(page).toHaveURL(origin + '/encuesta')
  await expect(page.locator('.survey-form')).toBeVisible()
  expect(await page.evaluate(async () => (await (await fetch('/api/participation/status')).json()).saved)).toBe(false)

  while (true) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const select of await page.locator('.question-field select').all()) {
      await select.selectOption(await select.getAttribute('id') === 'eligibility' ? { label: 'Sí' } : { index: 1 })
    }
    if (await page.getByRole('button', { name: 'Enviar respuestas' }).count()) break
    await page.getByRole('button', { name: 'Siguiente' }).click()
  }
  await page.locator('#open_comment').fill(marker)
  await page.route(origin + '/api/responses', route => route.fulfill({ status: 503 }), { times: 1 })
  await page.getByRole('button', { name: 'Enviar respuestas' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(origin + '/encuesta')
  await expect(page.getByText('Respuesta guardada')).toHaveCount(0)

  const submission = page.waitForResponse(origin + '/api/responses')
  await page.getByRole('button', { name: 'Enviar respuestas' }).click()
  expect(await (await submission).json()).toEqual({ saved: true })
  await expect(page).toHaveURL(origin + '/gracias')
  await expect(page.getByText('Respuesta guardada')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Respuesta guardada')).toBeVisible()
})

test('proxy HTTPS: orígenes, rutas privadas, límites y agregados', async ({ request }) => {
  const headers = { Host: host, Origin: origin }
  for (const changes of [
    { Origin: 'null' },
    { Origin: 'https://other.test', 'X-Forwarded-Host': host },
    { Host: 'other.test', 'X-Forwarded-Host': host },
  ]) {
    expect((await request.post(tlsLoopback + start, { headers: { ...headers, ...changes }, data: {} })).status()).toBe(403)
  }
  expect((await request.post(tlsLoopback + start, { headers: { Host: host }, data: {} })).status()).toBe(403)
  const preflight = await request.fetch(tlsLoopback + start, {
    method: 'OPTIONS', headers: { ...headers, Origin: 'https://other.test', 'Access-Control-Request-Method': 'POST' },
  })
  expect(preflight.headers()['access-control-allow-origin']).toBeUndefined()

  for (const path of ['/api/responses/1', '/api/answers', '/api/admin', '/api/imports', '/api/export', '/api/docs',
    '/api/responses/', '/docs', '/openapi.json', '/.env', '/data/datos.xlsx', '/datos_originales/datos.xlsx']) {
    const response = await request.get(tlsLoopback + path, { headers, maxRedirects: 0 })
    expect(response.status(), path).toBe(404)
    expect(response.headers().location).toBeUndefined()
  }
  for (const path of ['/api/overview', '/api/analytics/quality', '/api/analytics/academic']) {
    const response = await request.get(tlsLoopback + path, { headers })
    expect(response.ok()).toBe(true)
    expect(await response.text()).not.toMatch(new RegExp(`${marker}|open_comment|response_id|fingerprint|payload_hash`))
  }
  const oversized = await request.post(tlsLoopback + '/api/responses', { headers, data: { extra: 'x'.repeat(33000) } })
  expect(oversized.status()).toBe(413)
  const flood = await Promise.all(Array.from({ length: 145 }, () =>
    request.post(tlsLoopback + start, { headers: { Host: host }, data: {} })))
  expect(flood.some(response => response.status() === 429)).toBe(true)
})
