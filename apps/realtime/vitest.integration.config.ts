import { defineConfig } from 'vitest/config';

// Unit + integration tests against real Valkey (`pnpm infra:up` locally, compose services in CI).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts is the process composition root, exercised by the CI boot smoke test (scripts/boot-smoke.mjs).
      exclude: ['src/main.ts'],
      thresholds: { lines: 90, functions: 90, branches: 75, statements: 90 },
    },
  },
});
