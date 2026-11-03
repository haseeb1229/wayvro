import { defineConfig } from 'vitest/config';

// The manual full tier runs every property at WAYVRO_PROPERTY_RUNS=50000 (mobile-full.yml): give each test time in
// proportion. At the PR default (500 runs) this is vitest's usual 5 s, so the PR tier is unchanged.
const PROPERTY_RUNS = Number(process.env['WAYVRO_PROPERTY_RUNS'] ?? '500');
const testTimeout = Math.max(5_000, PROPERTY_RUNS * 3);

// Unit tests (no infrastructure). The coverage gate runs in vitest.integration.config.ts, where readiness probes are
// exercised against real PostgreSQL + Valkey.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], exclude: ['test/**/*.integration.test.ts'], testTimeout } });
