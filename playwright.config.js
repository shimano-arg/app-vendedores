// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config E2E contra producción app-vendedores-shimano.
 * Browser: msedge (ya instalado, no requiere `playwright install` que falla por SSL cert corp).
 * Creds del secret gcloud test-user-email + test-user-password (ver tests/e2e/helpers/load_creds.js).
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'tests/e2e/evidencia/_reports', open: 'never' }]],
  use: {
    baseURL: 'https://shimano-arg.github.io/app-vendedores/',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
  outputDir: 'tests/e2e/evidencia/_output',
});
