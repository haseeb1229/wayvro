import { defineConfig } from 'vitest/config';

// Pure-logic unit tests only (no React Native renderer). Component/E2E tests (Maestro) start with real screens in Phase 3.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
