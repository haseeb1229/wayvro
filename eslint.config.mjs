// Root ESLint flat config (ADR-027). Strict type-aware TypeScript rules everywhere, plus architectural boundaries:
// clients never import server/DB code (CLAUDE.md §4), apps never import each other, pure packages stay pure, and the
// mobile Rider and Driver feature modules never import each other (docs/28 §13, V-family).
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SERVER_ONLY_PACKAGES = [
  '@wayvro/db',
  '@wayvro/server-runtime',
  '@wayvro/observability',
  '@wayvro/provider-interfaces',
  '@wayvro/provider-test-doubles',
  '@wayvro/test-support',
  '@wayvro/config',
];
// Development/test-only packages (ADR-045): production source of any app/package must never import them.
const DEV_ONLY_PACKAGES = ['@wayvro/provider-test-doubles', '@wayvro/test-support'];
const SERVER_ONLY_MODULES = ['pg', 'ioredis', 'drizzle-orm', 'drizzle-orm/*', 'fastify', '@nestjs/*', 'socket.io', 'pino', '@opentelemetry/*'];
const CLIENT_APPS = ['app-mobile', 'app-web-public', 'app-web-ops'];
const ALL_APPS = ['app-api', 'app-worker', 'app-realtime', ...CLIENT_APPS];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-dev/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      'apps/wayvro-mobile/android/**',
      'apps/wayvro-mobile/ios/**',
      'apps/wayvro-mobile/.expo/**',
      // Disposable evidence harnesses with their own lockfiles (tests/spikes/README.md); typechecked in place.
      'tests/spikes/**',
      // Phase 0 documentation generators (CommonJS, pre-date this toolchain); validated by their own --check runs.
      'docs/**',
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10 }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': 'error',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'hack', 'xxx'], location: 'start' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // NestJS classes are framework-instantiated; decorators make "extraneous class" a false positive.
    files: ['apps/api/src/**/*.ts', 'apps/realtime/src/**/*.ts'],
    rules: { '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }] },
  },
  {
    // Process entry points and CLI tools may write to stdout/stderr.
    files: ['packages/config/src/check-flags.ts', 'packages/contracts/src/generate-openapi.ts', 'packages/db/src/bin/**', 'scripts/**', 'infra/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { ...tseslint.configs.disableTypeChecked.languageOptions, globals: { ...globals.node } },
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      // Tests assert on untyped JSON bodies, use asymmetric matchers (expect.any/objectContaining, typed `any` by Vitest)
      // and non-null shortcuts deliberately.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // ADR-045/F-01: production source never imports test doubles or test support (tests, local runners and the dev-only
    // packages themselves are outside these globs).
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', 'packages/provider-test-doubles/**', 'packages/test-support/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: DEV_ONLY_PACKAGES, message: 'Test doubles/test support are development-only and never part of a deployable artefact (ADR-045).' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/wayvro-mobile/**/*.{ts,tsx}', 'apps/web-*/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['apps/web-*/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: ['apps/web-public/', 'apps/web-ops/'] } },
    rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs['core-web-vitals'].rules },
  },
  {
    files: ['apps/**/*.{ts,tsx,mjs}', 'packages/**/*.{ts,tsx,mjs}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'] } },
      // Patterns cover source and test files only, so third-party code under an app's node_modules is never
      // classified as part of that app (it must stay an external module for the module-source policies).
      'boundaries/elements': [
        // Mobile internals first (most specific patterns win).
        { type: 'mobile-feature-rider', pattern: 'apps/wayvro-mobile/src/features/rider/**', partialMatch: false },
        { type: 'mobile-feature-driver', pattern: 'apps/wayvro-mobile/src/features/driver/**', partialMatch: false },
        { type: 'app-mobile', pattern: 'apps/wayvro-mobile/{src,test}/**', partialMatch: false },
        { type: 'app-api', pattern: 'apps/api/{src,test}/**', partialMatch: false },
        { type: 'app-worker', pattern: 'apps/worker/{src,test}/**', partialMatch: false },
        { type: 'app-realtime', pattern: 'apps/realtime/{src,test}/**', partialMatch: false },
        { type: 'app-web-public', pattern: 'apps/web-public/{src,test}/**', partialMatch: false },
        { type: 'app-web-ops', pattern: 'apps/web-ops/{src,test}/**', partialMatch: false },
        { type: 'pkg-domain', pattern: 'packages/domain/{src,test}/**', partialMatch: false },
        { type: 'pkg-contracts', pattern: 'packages/contracts/{src,test}/**', partialMatch: false },
        { type: 'pkg-config', pattern: 'packages/config/{src,test}/**', partialMatch: false },
        { type: 'pkg-observability', pattern: 'packages/observability/{src,test}/**', partialMatch: false },
        { type: 'pkg-provider-interfaces', pattern: 'packages/provider-interfaces/{src,test}/**', partialMatch: false },
        { type: 'pkg-provider-test-doubles', pattern: 'packages/provider-test-doubles/{src,test}/**', partialMatch: false },
        { type: 'pkg-test-support', pattern: 'packages/test-support/{src,test}/**', partialMatch: false },
        { type: 'pkg-db', pattern: 'packages/db/{src,test}/**', partialMatch: false },
        { type: 'pkg-server-runtime', pattern: 'packages/server-runtime/{src,test}/**', partialMatch: false },
        { type: 'pkg-web-security', pattern: 'packages/web-security/{src,test}/**', partialMatch: false },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          checkAllOrigins: true,
          policies: [
            // Client surfaces never import server-only packages or server runtimes (CLAUDE.md §4).
            {
              from: { element: { types: { anyOf: [...CLIENT_APPS, 'mobile-feature-rider', 'mobile-feature-driver'] } } },
              disallow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        'pkg-db',
                        'pkg-server-runtime',
                        'pkg-observability',
                        'pkg-provider-interfaces',
                        'pkg-provider-test-doubles',
                        'pkg-test-support',
                        'pkg-config',
                      ],
                    },
                  },
                },
              },
            },
            ...SERVER_ONLY_PACKAGES.concat(SERVER_ONLY_MODULES).map((source) => ({
              from: { element: { types: { anyOf: [...CLIENT_APPS, 'mobile-feature-rider', 'mobile-feature-driver'] } } },
              disallow: { to: { module: { source } } },
            })),
            // Apps are deployables, never libraries: no app imports another app (imports inside an app are fine).
            ...ALL_APPS.map((app) => ({
              from: { element: { types: { anyOf: app === 'app-mobile' ? [app, 'mobile-feature-rider', 'mobile-feature-driver'] : [app] } } },
              disallow: { to: { element: { types: { anyOf: ALL_APPS.filter((other) => other !== app) } } } },
            })),
            // Packages never import apps.
            { from: { element: { type: 'pkg-*' } }, disallow: { to: { element: { types: { anyOf: ALL_APPS } } } } },
            // Pure packages stay pure.
            { from: { element: { types: { anyOf: ['pkg-domain', 'pkg-contracts', 'pkg-web-security'] } } }, disallow: { to: { element: { type: 'pkg-*' } } } },
            // One app, two isolated modes: Rider and Driver/Partner features never import each other (V06/V11).
            { from: { element: { type: 'mobile-feature-rider' } }, disallow: { to: { element: { type: 'mobile-feature-driver' } } } },
            { from: { element: { type: 'mobile-feature-driver' } }, disallow: { to: { element: { type: 'mobile-feature-rider' } } } },
          ],
        },
      ],
    },
  },
  prettier,
);
