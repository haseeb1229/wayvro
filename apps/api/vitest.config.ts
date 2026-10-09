import { defineConfig } from 'vitest/config';

// Unit tests (no infrastructure). The coverage gate runs in vitest.integration.config.ts, where readiness probes are
// exercised against real PostgreSQL + Valkey.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], exclude: ['test/**/*.integration.test.ts'] } });
