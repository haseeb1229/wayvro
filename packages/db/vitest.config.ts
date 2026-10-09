import { defineConfig } from 'vitest/config';

// Unit tests only. Coverage for this package is measured by the integration run (vitest.integration.config.ts),
// because its code talks to a real PostgreSQL server and cannot be meaningfully covered without one.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
