// Read-only verification of the running application. All writes are blocked.
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const origin = 'http://localhost:8080'
const output = new URL('../../docs/capturas/participacion/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const blockedWrites = []
  await context.route('**/*', route => {
    const request = route.request()
    if (request.method() !== 'GET') { blockedWrites.push(request.method()); return route.abort() }
    return new URL(request.url()).origin === origin ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const completed = await page.request.get(origin + '/api/participation/completed')
  expect(completed.status()).toBe(200)
  expect(await completed.json()).toEqual({ completed: false })
  expect(completed.headers()['cache-control']).toBe('no-store')
  expect(completed.headers()['set-cookie']).toBeUndefined()
  await page.goto(origin)
  await expect(page.getByRole('link', { name: 'Responder encuesta' })).toBeVisible()
  await page.screenshot({ path: fileURLToPath(new URL('inicio.png', output)), fullPage: true })
  await page.getByRole('link', { name: 'Responder encuesta' }).click()
  await expect(page.getByRole('heading', { name: 'Consentimiento informado' })).toBeVisible()
  await expect(page.getByText(/cookie propia, HttpOnly, durante 180 días/)).toBeVisible()
  await page.screenshot({ path: fileURLToPath(new URL('consentimiento.png', output)), fullPage: true })
  for (const path of ['/encuesta', '/gracias']) {
    await page.goto(origin + path)
    await expect(page).toHaveURL(origin + (path === '/encuesta' ? '/consentimiento' : '/'))
  }
  for (const [path, title] of [['', 'Panorama general.'], ['/academico', 'Exploración académica.'],
    ['/permanencia', 'Indicadores de permanencia.'], ['/institucional', 'Análisis institucional.'],
    ['/datos', 'Gestión de datos.'], ['/metodologia', 'Metodología y alcance.']]) {
    await page.goto(origin + '/observatorio' + path)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  }
  await page.goto(origin + '/break?juego=2048')
  await expect(page.getByRole('group', { name: 'Tablero de 2048' })).toBeVisible()
  expect(blockedWrites).toEqual([])
  expect(errors).toEqual([])
  const result = { origin, completed: false, modules: 6, savra_2048: true, writes: blockedWrites.length, errors }
  await writeFile(new URL('verificacion.json', output), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { await browser.close() }
