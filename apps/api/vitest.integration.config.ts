import { defineConfig } from 'vitest/config';

// Unit + integration tests against real PostgreSQL + Valkey (`pnpm infra:up` locally, compose services in CI).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    // beforeAll creates and migrates a throwaway database per suite; under parallel suites that exceeds the 10 s default
    hookTimeout: 120000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts is the process composition root, exercised by the CI boot smoke test (scripts/boot-smoke.mjs).
      exclude: ['src/main.ts'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
});
