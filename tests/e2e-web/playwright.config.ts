/**
 * Web E2E (Playwright 1.62.1 + axe, ADR-044/CON-P2-03): runs against PRODUCTION builds of the web surfaces
 * (`pnpm build` first). Chromium only in Phase 2; the CI job installs the pinned browser revision.
 * - web-public: static legal pages (no infrastructure needed).
 * - web-ops (WAYVRO_E2E_OPS=1): needs PostgreSQL + Valkey (`pnpm infra:up`) and `pnpm build:local`; ops-stack.mjs
 *   creates a throwaway database, bootstraps staff invitations and runs the API local runner + web-ops.
 */
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const CI = process.env['CI'] !== undefined;
const OPS = process.env['WAYVRO_E2E_OPS'] === '1';
const OPS_PORT = process.env['WAYVRO_E2E_OPS_PORT'] ?? '3310';

const servers: NonNullable<PlaywrightTestConfig['webServer']> = [
  {
    command: 'pnpm --filter @wayvro/web-public start',
    url: 'http://127.0.0.1:3210/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NODE_ENV: 'production' },
  },
];
if (OPS) {
  servers.push({
    command: 'node ops-stack.mjs',
    url: `http://127.0.0.1:${OPS_PORT}/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { WAYVRO_E2E_OPS_PORT: OPS_PORT },
  });
}

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: 0,
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: '../../build-logs/playwright-report' }]] : 'list',
  outputDir: '../../build-logs/playwright-results',
  use: { trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  projects: [
    { name: 'web-public', testMatch: 'web-public/**/*.spec.ts', use: { baseURL: 'http://127.0.0.1:3210' } },
    ...(OPS ? [{ name: 'web-ops', testMatch: 'web-ops/**/*.spec.ts', fullyParallel: false, use: { baseURL: `http://localhost:${OPS_PORT}` } }] : []),
  ],
  webServer: servers,
});
