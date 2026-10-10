import { defineConfig } from 'vitest/config';

// Unit + integration tests against real PostgreSQL (`pnpm infra:up` locally, compose services in CI).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts and bin/ are process entry points, exercised by the CI boot smoke test (scripts/boot-smoke.mjs).
      exclude: ['src/main.ts', 'src/bin/**'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
});
