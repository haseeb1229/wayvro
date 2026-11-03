import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // cli.ts is the process entry (argument parsing, environment, file I/O wiring); its parts are unit-tested directly.
      exclude: ['src/**/*.test.ts', 'src/cli.ts'],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
