import { defineConfig } from 'vitest/config';

// Unit + integration tests against real PostgreSQL + PostGIS (`pnpm infra:up` locally, compose services in CI).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.integration.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/schema.ts', 'src/bin/**'],
      thresholds: { lines: 85, functions: 85, branches: 70, statements: 85 },
    },
  },
});
