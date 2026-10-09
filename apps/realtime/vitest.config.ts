import { defineConfig } from 'vitest/config';

// Single-process tests (no Redis). The coverage gate runs in vitest.integration.config.ts with Redis fan-out.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], exclude: ['test/**/*.integration.test.ts'] } });
