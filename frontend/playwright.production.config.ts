import { defineConfig, devices } from '@playwright/test'

if (!/^[a-f0-9]{24}$/.test(process.env.SAVRA_PRODUCTION_TEST ?? '')) {
  throw new Error('Ejecute scripts/test_production.py; esta suite escribe solo en PostgreSQL desechable')
}
export default defineConfig({
  testDir: './production-e2e', workers: 1, fullyParallel: false, timeout: 60000,
  use: {
    ...devices['Desktop Chrome'], baseURL: 'https://savra.test:8443', ignoreHTTPSErrors: true, reducedMotion: 'reduce',
    launchOptions: { args: ['--host-resolver-rules=MAP savra.test 127.0.0.1'] },
  },
  projects: [
    { name: 'production', testIgnore: 'sharing.spec.ts' },
    { name: 'sharing-desktop', testMatch: 'sharing.spec.ts' },
    { name: 'sharing-android', testMatch: 'sharing.spec.ts', grep: /shares the invitation|unavailable native/,
      use: { ...devices['Pixel 7'] } },
    { name: 'sharing-iphone', testMatch: 'sharing.spec.ts', grep: /shares the invitation|unavailable native/,
      use: { ...devices['iPhone 13'], browserName: 'webkit', launchOptions: {}, baseURL: 'https://127.0.0.1:8443' } },
  ],
  reporter: 'list',
})
