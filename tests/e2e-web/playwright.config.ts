/**
 * Web E2E (Playwright 1.62.1 + axe, ADR-027/CON-P2-03): runs against PRODUCTION builds of the web surfaces
 * (`pnpm build` first). Chromium only in Phase 2; the CI job installs the pinned browser revision.
 */
import { defineConfig, devices } from '@playwright/test';

const CI = process.env['CI'] !== undefined;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: 0,
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: '../../build-logs/playwright-report' }]] : 'list',
  outputDir: '../../build-logs/playwright-results',
  use: { trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  projects: [{ name: 'web-public', testMatch: 'web-public/**/*.spec.ts', use: { baseURL: 'http://127.0.0.1:3210' } }],
  webServer: [
    {
      command: 'pnpm --filter @wayvro/web-public start',
      url: 'http://127.0.0.1:3210/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NODE_ENV: 'production' },
    },
  ],
});
