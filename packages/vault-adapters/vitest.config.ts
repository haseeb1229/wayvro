import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // s3.ts and docker-runner.ts talk to real services: covered by test/adapters.integration.test.ts
      // (SeaweedFS, ClamAV, the sanitiser container) in the integration job, not by these protocol tests.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/s3.ts', 'src/docker-runner.ts'],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
