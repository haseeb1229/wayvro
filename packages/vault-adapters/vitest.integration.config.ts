import { defineConfig } from 'vitest/config';

// Unit + integration tests against the real local services (`pnpm infra:up`: SeaweedFS, ClamAV) and the sanitiser
// container image (`node scripts/sanitiser-image.mjs`). The CI integration job provides all three.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.integration.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
});
