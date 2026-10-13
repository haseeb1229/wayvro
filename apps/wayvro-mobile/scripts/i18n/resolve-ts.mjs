/*
 * Node resolve hook for the i18n review tools (`pnpm --filter @wayvro/wayvro-mobile i18n:export` / `i18n:import-review`).
 * DEVELOPMENT TOOL ONLY. Node runs the TypeScript sources directly (built-in type stripping); the app's modules use
 * extension-less relative imports (Metro/TypeScript "bundler" resolution), so this hook maps `./x` to `./x.ts` when
 * that file exists. Loaded with `node --import` so it is active before the entry script is linked.
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier) && context.parentURL !== undefined) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
