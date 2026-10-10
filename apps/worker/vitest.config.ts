import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts is the process composition root, exercised by the CI boot smoke test (scripts/boot-smoke.mjs).
      exclude: ['src/main.ts'],
      thresholds: { lines: 95, functions: 95, branches: 85, statements: 95 },
    },
  },
});
