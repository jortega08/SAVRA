import { test, expect } from '@playwright/test'
import { SAVRA_URL, SHARE_DATA, SHARE_INVITATION } from '../src/lib/sharing'
import './edge'

test('desktop keyboard controls copy to the real HTTPS clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.getByRole('button', { name: 'Compartir SAVRA' }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Más opciones' })).toBeFocused()
  await page.keyboard.press('Enter')
  for (const [name, expected] of [['Copiar enlace', SAVRA_URL], ['Copiar invitación', SHARE_INVITATION]]) {
    await page.getByRole('button', { name }).click()
    await expect(page.locator('.share-status')).toContainText('copiad')
    // Windows clipboard normalizes line endings to CRLF.
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard.replace(/\r\n/g, '\n')).toBe(expected)
  }
})

test('crawlers receive metadata and public image bytes over HTTPS without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: true,
    userAgent: 'facebookexternalhit/1.1' })
  try {
    const page = await context.newPage()
    const response = await page.goto('https://127.0.0.1:8443/')
    expect(response?.status()).toBe(200)
    const html = await response!.text()
    expect(html).toContain(`<meta property="og:title" content="${SHARE_DATA.title}"`)
    expect(html).toContain(`<meta property="og:image" content="${SAVRA_URL}/branding/savra-social.png"`)
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"')
    expect(await page.title()).toBe(SHARE_DATA.title)
    const image = await page.request.get('https://127.0.0.1:8443/branding/savra-social.png')
    expect(image.status()).toBe(200)
    expect(image.headers()['content-type']).toBe('image/png')
    const png = await image.body()
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
    for (const name of ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
      const icon = await page.request.get(`https://127.0.0.1:8443/${name}`)
      expect(icon.status(), name).toBe(200)
      expect(icon.headers()['content-type'], name).toMatch(/^image\//)
    }
  } finally { await context.close() }
})

test('shares the invitation, handles cancellation, and offers WhatsApp and copying', async ({ page }, testInfo) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
          Object.assign(window, { sharedData: data })
          throw new DOMException('Cancelled by user', 'AbortError')
        } })
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => {
          Object.assign(window, { copiedText: text })
        } } })
      })
      // Sensitive route state must never appear in a shared invitation.
      await page.goto('/?receipt=private-fixture#private-answer')
      const share = page.getByRole('button', { name: 'Compartir SAVRA' })
      await expect(share).toBeVisible()
      await share.click()
      await expect(share).toBeEnabled()
      expect(await page.evaluate(() => (window as unknown as { sharedData: ShareData }).sharedData)).toEqual(SHARE_DATA)
      await expect(page.getByRole('link', { name: /WhatsApp/ })).toBeHidden()
      await expect(page.locator('.share-status')).toBeEmpty()
      await page.getByRole('button', { name: 'Más opciones' }).click()
      const whatsapp = page.getByRole('link', { name: /WhatsApp/ })
      const link = new URL((await whatsapp.getAttribute('href'))!)
      expect(link.origin).toBe('https://wa.me')
      expect(link.searchParams.get('text')).toBe(SHARE_INVITATION)
      await page.getByRole('button', { name: 'Copiar enlace' }).click()
      await expect(page.locator('.share-status')).toHaveText('Enlace copiado.')
      expect(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toBe(SAVRA_URL)
      await page.getByRole('button', { name: 'Copiar invitación' }).click()
      await expect(page.locator('.share-status')).toHaveText('Invitación copiada.')
      expect(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toBe(SHARE_INVITATION)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `../.local/sharing-audit/${testInfo.project.name}-welcome.png`, fullPage: true })
      expect(errors).toEqual([])
    })

    test('unavailable native sharing and blocked clipboard keep a usable manual invitation', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
      })
      await page.goto('/')
      await page.getByRole('button', { name: 'Compartir SAVRA' }).click()
      await page.getByRole('button', { name: 'Copiar invitación' }).click()
      const text = page.getByLabel('Texto para copiar')
      await expect(text).toHaveValue(SHARE_INVITATION)
      await expect(text).toBeFocused()
      await expect(page.locator('.share-status')).not.toContainText('copiada')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
