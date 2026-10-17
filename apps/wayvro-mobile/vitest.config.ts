import { defineConfig } from 'vitest/config';

// Pure-logic unit tests only (no React Native renderer), including the dev-only i18n review tools under scripts/.
// Component/E2E tests (Maestro) start with real screens in Phase 3.
export default defineConfig({ test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] } });
