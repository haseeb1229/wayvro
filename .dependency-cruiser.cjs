/**
 * dependency-cruiser rules (ADR-027, GR-01/GR-03). Complements eslint-plugin-boundaries with whole-graph checks:
 * cycles, unresolvable imports, client->server bans (including npm modules), app isolation, mobile mode isolation.
 * Run: pnpm depcruise
 */
const CLIENT_APPS = '^apps/(wayvro-mobile|web-public|web-ops)/';
const SERVER_ONLY_WORKSPACE =
  '^(packages/(db|server-runtime|observability|provider-interfaces|provider-test-doubles|test-support|config|field-crypto|identity-core|vault-adapters|geo-adapters|image-sanitiser)/|node_modules/@wayvro/(db|server-runtime|observability|provider-interfaces|provider-test-doubles|test-support|config|field-crypto|identity-core|vault-adapters|geo-adapters|image-sanitiser)/)';
// Development/test-only workspace packages (ADR-045): never reachable from production source.
const DEV_ONLY_WORKSPACE = '(^packages/(provider-test-doubles|test-support)/|node_modules/@wayvro/(provider-test-doubles|test-support)/)';
const SERVER_ONLY_NPM = 'node_modules/(pg|pg-pool|ioredis|drizzle-orm|fastify|@nestjs/[^/]+|socket\\.io|pino|@opentelemetry/[^/]+|@aws-sdk/[^/]+|sharp)/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', comment: 'Cycles make modules impossible to reason about or extract.', from: {}, to: { circular: true } },
    { name: 'not-to-unresolvable', severity: 'error', comment: 'Every import must resolve.', from: {}, to: { couldNotResolve: true } },
    {
      name: 'no-client-to-server-workspace',
      severity: 'error',
      comment: 'Mobile/web clients never import server-only or database packages (CLAUDE.md §4).',
      from: { path: CLIENT_APPS },
      to: { path: SERVER_ONLY_WORKSPACE },
    },
    {
      name: 'no-client-to-server-npm',
      severity: 'error',
      comment: 'Mobile/web clients never import server runtimes, DB drivers or server telemetry SDKs.',
      from: { path: CLIENT_APPS },
      to: { path: SERVER_ONLY_NPM },
    },
    {
      name: 'no-app-to-app',
      severity: 'error',
      comment: 'Apps are deployables, never libraries.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    { name: 'no-package-to-app', severity: 'error', comment: 'Packages never depend on apps.', from: { path: '^packages/' }, to: { path: '^apps/' } },
    {
      name: 'no-rider-driver-coupling',
      severity: 'error',
      comment: 'One app, isolated modes: Rider and Driver/Partner feature modules never import each other (V06/V11).',
      from: { path: '^apps/wayvro-mobile/src/features/(rider|driver)/' },
      to: { path: '^apps/wayvro-mobile/src/features/(rider|driver)/', pathNot: '^apps/wayvro-mobile/src/features/$1/' },
    },
    {
      name: 'vault-module-boundary',
      severity: 'error',
      comment:
        'ADR-041: only the API app module and composition root wire the evidence vault; no other module imports src/vault/** (the vault owns its own wayvro_vault pool).',
      from: { path: '^apps/api/src/', pathNot: ['^apps/api/src/vault/', '^apps/api/src/(app|composition)\\.ts$'] },
      to: { path: '^apps/api/src/vault/' },
    },
    {
      name: 'geo-adapters-composition-only',
      severity: 'error',
      comment:
        'Phase 3 architecture §4 (E06/ADR-006): API modules depend on the vendor-neutral geo ports; only the API composition root/entry binds real geo adapters, and the worker never calls a geo provider.',
      from: { path: '^apps/(api|worker)/src/', pathNot: '^apps/api/src/(composition|main)\\.ts$' },
      to: { path: '(^packages/geo-adapters/|node_modules/@wayvro/geo-adapters/)' },
    },
    {
      name: 'geo-bench-dev-only',
      severity: 'error',
      comment: 'The SP-04 benchmark harness (tools/geo-bench) is a dev-only tool: no app or package imports it (ADR-045 artefact isolation).',
      from: { path: '^(apps|packages)/' },
      to: { path: '(^tools/geo-bench/|node_modules/@wayvro/geo-bench/)' },
    },
    {
      name: 'pricing-engine-purity',
      severity: 'error',
      comment:
        'P3.3/ADR-013: the pricing engine is pure and deterministic (property P-05): it imports only Money and plain data — never the database, Valkey, crypto, time sources or another module (catalog, geo).',
      from: { path: '^apps/api/src/pricing/engine\\.ts$' },
      to: { pathNot: ['(^packages/domain/|node_modules/@wayvro/domain/)'] },
    },
    {
      name: 'sanitiser-only-in-its-container',
      severity: 'error',
      comment: 'ADR-041: the image decoder runs only inside the isolated sanitiser container; no app or other package imports it.',
      from: { path: '^(apps|packages)/', pathNot: '^packages/image-sanitiser/' },
      to: { path: '(^packages/image-sanitiser/|node_modules/@wayvro/image-sanitiser/)' },
    },
    {
      name: 'no-production-to-test',
      severity: 'error',
      comment: 'Production code never imports test files or test-only directories.',
      from: { path: '^(apps|packages)/[^/]+/src/', pathNot: '\\.test\\.tsx?$' },
      to: { path: '(\\.test\\.tsx?$|^(apps|packages)/[^/]+/test/)' },
    },
    {
      name: 'no-production-to-test-doubles',
      severity: 'error',
      comment: 'ADR-045/F-01: production source never imports the dev-only test-double or test-support packages (deployable artefacts must not contain them).',
      from: { path: '^(apps|packages)/[^/]+/src/', pathNot: ['\\.test\\.tsx?$', '^packages/(provider-test-doubles|test-support)/'] },
      to: { path: DEV_ONLY_WORKSPACE },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Production code must not depend on devDependencies.',
      from: { path: '^(apps|packages)/[^/]+/src/', pathNot: ['\\.test\\.tsx?$'] },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'], pathNot: ['node_modules/@types/'] },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules', '(^|/)dist/'] },
    exclude: { path: ['(^|/)dist-dev/', '(^|/)\\.next/', '(^|/)coverage/', '(^|/)android/', '(^|/)ios/', 'next-env\\.d\\.ts$'] },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      exportsFields: ['exports'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
