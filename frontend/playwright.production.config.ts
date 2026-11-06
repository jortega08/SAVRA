import { defineConfig, devices } from '@playwright/test'

if (!/^[a-f0-9]{24}$/.test(process.env.SAVRA_PRODUCTION_TEST ?? '')) {
  throw new Error('Ejecute scripts/test_production.py; esta suite escribe solo en PostgreSQL desechable')
}
export default defineConfig({
  testDir: './production-e2e', workers: 1, fullyParallel: false, timeout: 60000,
  use: {
    ...devices['Desktop Chrome'], baseURL: 'https://savra.test:8443', ignoreHTTPSErrors: true,
    launchOptions: { args: ['--host-resolver-rules=MAP savra.test 127.0.0.1'] },
  },
  reporter: 'list',
})
