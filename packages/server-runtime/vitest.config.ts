import { defineConfig } from 'vitest/config';

// Unit tests only; the coverage gate runs with the integration suite (real PostgreSQL + Valkey).
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
