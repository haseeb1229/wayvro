import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // test/compat: COMPAT-N1 against the frozen Phase-2 contract copy (test-only; outside the build and the coverage scope)
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/generate-openapi.ts'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
});
