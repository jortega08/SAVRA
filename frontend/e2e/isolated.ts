import { test as base, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export const isolatedApi = 'http://localhost:8082'

export async function verifyIsolation() {
  const token = process.env.SAVRA_E2E_TOKEN
  if (!token || !/^[a-f0-9]{32}$/.test(token)) throw new Error('Ejecute scripts/test_isolated.py para crear la base desechable')
  const response = await fetch(`${isolatedApi}/__savra_e2e`, { redirect: 'error' })
  if (!response.ok || await response.text() !== token) throw new Error('El proxy no pertenece a la suite desechable')
}

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL ?? isolatedApi).origin
    await page.route(url => url.origin === origin && !url.pathname.startsWith('/api/'), async route => {
      const path = new URL(route.request().url()).pathname
      const asset = /^\/(assets|branding)\/[\w.-]+$/.test(path)
      if (route.request().method() !== 'GET' || (!asset && !route.request().isNavigationRequest())) {
        await route.abort()
        return
      }
      const file = new URL(`../dist/${asset ? path.slice(1) : 'index.html'}`, import.meta.url)
      await route.fulfill({ path: fileURLToPath(file) })
    })
    await use(page)
  },
})

export { expect }
