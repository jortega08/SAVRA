import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const origin = 'http://localhost:8082'
const message = 'Desde este navegador ya se registró una participación. Gracias por contribuir a SAVRA.'
type Result = { status: number; body: string; headers: Record<string, string>; cookies: string[]; count?: number }

class Bridge {
  child
  lines: ReturnType<typeof createInterface>
  pending: { resolve: (result: Result) => void; reject: (error: Error) => void }[] = []
  dropReply = false
  constructor(directory: string) {
    if (!/^\/tmp\/savra-participation-qa-[a-f0-9]{24}$/.test(directory)) throw new Error('Ejecute scripts/test_existing.py browser')
    this.child = spawn('docker', ['compose', 'exec', '-T', '-w', directory, '-e', `PYTHONPATH=${directory}`, 'backend', 'python', 'tests/participation_bridge.py'],
      { cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: ['pipe', 'pipe', 'pipe'] })
    this.lines = createInterface({ input: this.child.stdout })
    this.lines.on('line', line => this.pending.shift()?.resolve(JSON.parse(line)))
    this.child.stderr.on('data', chunk => process.stderr.write(chunk))
    this.child.on('exit', code => { for (const pending of this.pending.splice(0)) pending.reject(new Error(`Bridge exited: ${code}`)) })
  }
  next() { return new Promise<Result>((resolve, reject) => this.pending.push({ resolve, reject })) }
  call(request: unknown) {
    const result = this.next()
    this.child.stdin.write(JSON.stringify(request) + '\n')
    return result
  }
  async attach(context: BrowserContext) {
    await context.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin !== origin) { await route.abort(); return }
      if (url.pathname.startsWith('/api/')) {
        const result = await this.call({ method: request.method(), path: url.pathname + url.search,
          headers: { ...await request.allHeaders(), host: url.host }, body: request.postData() })
        if (this.dropReply && url.pathname === '/api/responses' && result.status === 200) {
          this.dropReply = false
          await route.abort('connectionreset')
          return
        }
        const headers = { ...result.headers }
        delete headers['content-length']
        if (result.cookies.length) headers['set-cookie'] = result.cookies.join('\n')
        await route.fulfill({ status: result.status, body: result.body, headers })
        return
      }
      const asset = /^\/(assets|branding)\/[\w.-]+$/.test(url.pathname)
      if (request.method() !== 'GET' || (!asset && !request.isNavigationRequest())) { await route.abort(); return }
      await route.fulfill({ path: fileURLToPath(new URL(`../dist/${asset ? url.pathname.slice(1) : 'index.html'}`, import.meta.url)) })
    })
  }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) { this.lines.close(); return }
    const exit = new Promise<void>(resolve => this.child.once('exit', () => resolve()))
    this.child.stdin.end(JSON.stringify({ op: 'shutdown' }) + '\n')
    await exit
    this.lines.close()
  }
}

const test = base.extend<{}, { bridge: Bridge }>({
  bridge: [async ({}, use) => {
    const bridge = new Bridge(process.env.SAVRA_QA_BACKEND ?? '')
    try { await bridge.next(); await use(bridge) } finally { await bridge.close() }
  }, { scope: 'worker' }],
  context: async ({ context, bridge }, use) => { await bridge.attach(context); await use(context) },
})

async function api(page: Page, path: string, body?: unknown) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch('/api' + path, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: response.status, data: await response.json() }
  }, { path, body })
}

async function fillSurvey(page: Page) {
  await page.goto('/consentimiento')
  await expect(page.getByText(/cookie propia, HttpOnly, durante 180 días/)).toBeVisible()
  await page.getByRole('button', { name: 'Aceptar y comenzar' }).click()
  while (true) {
    await expect(page.locator('.survey-form')).toBeVisible()
    for (const select of await page.locator('.question-field select').all()) {
      if (await select.getAttribute('id') === 'eligibility') await select.selectOption({ label: 'Sí' })
      else await select.selectOption({ index: 1 })
    }
    if (await page.getByRole('button', { name: 'Enviar respuestas' }).count()) break
    await page.getByRole('button', { name: 'Siguiente' }).click()
  }
}

test('primer guardado, bloqueo en servidor, rutas protegidas y acceso a todos los módulos', async ({ page, context, bridge }, testInfo) => {
  const before = (await bridge.call({ op: 'count' })).count!
  await fillSurvey(page)
  await page.getByRole('button', { name: 'Enviar respuestas' }).click()
  await expect(page.getByText(message)).toBeVisible()
  const cookie = (await context.cookies()).find(c => c.name === 'savra_completed')!
  expect(cookie.httpOnly).toBe(true)
  expect(cookie.sameSite).toBe('Strict')
  expect(cookie.secure).toBe(false)
  expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(179 * 86400)
  expect(await page.evaluate(() => document.cookie)).not.toContain('savra_completed')
  await context.clearCookies({ name: 'savra_participation' })
  const questionnaire = (await api(page, '/questionnaire')).data
  expect((await api(page, '/participation/start', { accepted: true, questionnaire_version: questionnaire.version })).status).toBe(409)
  expect((await api(page, '/responses', { questionnaire_version: questionnaire.version, answers: {} })).status).toBe(409)
  for (const path of ['/consentimiento', '/encuesta']) {
    await page.goto(path)
    await expect(page).toHaveURL(/gracias$/)
    await expect(page.getByText(message)).toBeVisible()
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`participacion-${width}.png`), fullPage: true })
  }
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Participación completada' })).toBeVisible()
  for (const [path, title] of [['', 'Panorama general.'], ['/academico', 'Exploración académica.'], ['/permanencia', 'Indicadores de permanencia.'],
    ['/institucional', 'Análisis institucional.'], ['/datos', 'Gestión de datos.'], ['/metodologia', 'Metodología y alcance.']]) {
    await page.goto('/observatorio' + path)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  }
  await page.goto('/break?juego=2048')
  await expect(page.getByRole('group', { name: 'Tablero de 2048' })).toBeVisible()
  expect((await bridge.call({ op: 'count' })).count).toBe(before + 1)
})

test('cerrar y reabrir Chromium conserva la marca; otro perfil puede participar', async ({ bridge }, testInfo) => {
  const profile = testInfo.outputPath('browser-profile')
  let context = await chromium.launchPersistentContext(profile)
  try {
    await bridge.attach(context)
    const page = await context.newPage()
    await fillSurvey(page)
    await page.getByRole('button', { name: 'Enviar respuestas' }).click()
    await expect(page.getByText(message)).toBeVisible()
    await context.clearCookies({ name: 'savra_participation' })
    await context.close()
    context = await chromium.launchPersistentContext(profile)
    await bridge.attach(context)
    const reopened = await context.newPage()
    await reopened.goto(origin)
    await expect(reopened.getByRole('link', { name: 'Participación completada' })).toBeVisible()
    await reopened.getByRole('link', { name: 'Participación completada' }).click()
    await expect(reopened.getByText(/otro perfil del navegador o una ventana privada nueva/)).toBeVisible()
  } finally { await context.close() }
  const otherBrowser = await chromium.launch()
  try {
    const other = await otherBrowser.newContext()
    await bridge.attach(other)
    const page = await other.newPage()
    await page.goto(origin)
    await expect(page.getByRole('link', { name: 'Responder encuesta' })).toBeVisible()
    await fillSurvey(page)
    await page.getByRole('button', { name: 'Enviar respuestas' }).click()
    await expect(page.getByText(message)).toBeVisible()
  } finally { await otherBrowser.close() }
})

test('fallo de guardado y respuesta de red perdida: reintento sin duplicados', async ({ page, context, bridge }) => {
  const before = (await bridge.call({ op: 'count' })).count!
  await fillSurvey(page)
  await bridge.call({ op: 'fail_next' })
  await page.getByRole('button', { name: 'Enviar respuestas' }).click()
  await expect(page.getByRole('alert')).toContainText('almacenamiento')
  expect((await context.cookies()).some(c => c.name === 'savra_completed')).toBe(false)
  expect((await bridge.call({ op: 'count' })).count).toBe(before)
  bridge.dropReply = true
  await page.getByRole('button', { name: 'Enviar respuestas' }).click()
  await expect(page.getByRole('alert')).toContainText('conexión')
  expect((await context.cookies()).some(c => c.name === 'savra_completed')).toBe(false)
  expect((await bridge.call({ op: 'count' })).count).toBe(before + 1)
  await page.getByRole('button', { name: 'Enviar respuestas' }).click()
  await expect(page.getByText(message)).toBeVisible()
  expect((await context.cookies()).some(c => c.name === 'savra_completed')).toBe(true)
  expect((await bridge.call({ op: 'count' })).count).toBe(before + 1)
})

test('cookie ausente, caducada o manipulada y rechazo del consentimiento', async ({ page, context, bridge }) => {
  const before = (await bridge.call({ op: 'count' })).count
  for (const cookie of [undefined, { value: 'f'.repeat(64), expires: Date.now() / 1000 - 1 }, { value: 'manipulada', expires: Date.now() / 1000 + 86400 }]) {
    await context.clearCookies()
    if (cookie) await context.addCookies([{ name: 'savra_completed', domain: 'localhost', path: '/api', httpOnly: true, sameSite: 'Strict', ...cookie }])
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Responder encuesta' })).toBeVisible()
    expect((await api(page, '/participation/completed')).data).toEqual({ completed: false })
  }
  await page.getByRole('link', { name: 'Responder encuesta' }).click()
  await page.getByRole('button', { name: 'No acepto' }).click()
  await expect(page).toHaveURL(origin + '/')
  expect((await context.cookies()).some(c => c.name === 'savra_completed' && c.value !== 'manipulada')).toBe(false)
  expect((await bridge.call({ op: 'count' })).count).toBe(before)
})
