import { defineConfig } from 'vitest/config';

// Unit + integration tests against real PostgreSQL + Valkey (`pnpm infra:up` locally, compose services in CI).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.integration.test.ts'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, functions: 90, branches: 75, statements: 90 },
    },
  },
});
