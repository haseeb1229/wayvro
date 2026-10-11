import { defineConfig } from 'vitest/config';

// Test infrastructure: its database helpers are exercised by every integration suite that uses them.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
