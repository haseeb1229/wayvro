import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Unit coverage covers the outbox/consumer skeletons; database-backed modules are measured by the integration run.
      // main.ts/bin are process entry points, exercised by the CI boot smoke test (scripts/boot-smoke.mjs).
      exclude: [
        'src/main.ts',
        'src/bin/**',
        'src/composition.ts',
        'src/audit-seal.ts',
        'src/maintenance.ts',
        'src/scheduler.ts',
        'src/vault/**',
        'src/review/**',
        'src/identity/**',
        'src/outbox/pg-outbox.ts',
        'src/outbox/account-state-hint.ts',
      ],
      thresholds: { lines: 95, functions: 95, branches: 85, statements: 95 },
    },
  },
});
