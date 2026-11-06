import { defineConfig, devices } from '@playwright/test'
import { isolatedApi } from './e2e/isolated'

export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30000,
  globalSetup: './e2e/verify-isolated.ts',
  use: { baseURL: isolatedApi, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: [['list'], ['html', { open: 'never' }]]
})
