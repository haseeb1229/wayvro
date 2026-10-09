/**
 * dependency-cruiser rules (ADR-027, GR-01/GR-03). Complements eslint-plugin-boundaries with whole-graph checks:
 * cycles, unresolvable imports, client->server bans (including npm modules), app isolation, mobile mode isolation.
 * Run: pnpm depcruise
 */
const CLIENT_APPS = '^apps/(wayvro-mobile|web-public|web-ops)/';
const SERVER_ONLY_WORKSPACE =
  '^(packages/(db|server-runtime|observability|provider-interfaces|config)/|node_modules/@wayvro/(db|server-runtime|observability|provider-interfaces|config)/)';
const SERVER_ONLY_NPM = 'node_modules/(pg|pg-pool|ioredis|drizzle-orm|fastify|@nestjs/[^/]+|socket\\.io|pino|@opentelemetry/[^/]+)/';

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
      name: 'no-production-to-test',
      severity: 'error',
      comment: 'Production code never imports test files or test-only directories.',
      from: { path: '^(apps|packages)/[^/]+/src/', pathNot: '\\.test\\.tsx?$' },
      to: { path: '(\\.test\\.tsx?$|^(apps|packages)/[^/]+/test/)' },
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
    exclude: { path: ['(^|/)\\.next/', '(^|/)coverage/', '(^|/)android/', '(^|/)ios/', 'next-env\\.d\\.ts$'] },
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
