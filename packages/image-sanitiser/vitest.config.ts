import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // cli.ts is the container entry point (stdin/stdout/exit codes); it is exercised through the real container by
      // apps/worker/test/vault.integration.test.ts (SEC-FILE), where in-process coverage cannot be collected.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/cli.ts'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
