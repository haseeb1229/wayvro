#!/usr/bin/env node
/*
 * ART-ISO — production test-double isolation evidence (ADR-045, F-01; docs/phase2/PHASE2_TEST_STRATEGY.md §2).
 * Node built-ins only. It performs its own clean, uncached build of the three apps first.
 *
 *   node scripts/artifact-isolation.mjs [--negative-controls] [--keep]
 *
 * For each deployable server app (api, worker, realtime) it builds the real release artefact
 * (scripts/build-release-artifact.mjs) in a fresh directory OUTSIDE the repository and inspects that artefact — not
 * the source tree:
 *   01 the dev-only packages (@wayvro/provider-test-doubles, @wayvro/test-support) are not installed anywhere in it;
 *   02 it ships only dist/ + production node_modules (no src/, test/, dev/, dist-dev/, coverage/);
 *   03 no file contains a double package specifier, double class name, local-runner or local-route marker, and the
 *      test-double brand key occurs only in the production refusal guard of @wayvro/provider-interfaces;
 *   04 dynamic import / require resolution of the dev-only packages and of a devDependency fails with
 *      ERR_MODULE_NOT_FOUND / MODULE_NOT_FOUND from inside the artefact, while a real production dependency resolves
 *      (positive control, so the probe is meaningful);
 *   05 the release marker is present and well-formed;
 *   06 booting the artefact with WAYVRO_ENV=local and WAYVRO_ENV=test is refused by the release marker;
 *   07 (api, worker) booting with a production-like configuration is refused (no production key provider while
 *      EG-05 is open; realtime holds no keys and is not part of this check);
 *   08 (api) the artefact's route table, recorded by the artefact's own compiled app while it registers routes,
 *      contains exactly the published contract routes and no local/test route.
 * --negative-controls additionally proves that dependency-cruiser, ESLint and Knip (production, strict) reject a
 * production import of the test doubles (a temporary probe file is created and always removed; CI only needs a clean
 * checkout, locally the working tree is restored in `finally`).
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, SERVER_APPS, buildReleaseArtifact, cleanBuild } from './build-release-artifact.mjs';

const args = new Set(process.argv.slice(2));
const OUT = join(tmpdir(), `wayvro-artifacts-${randomUUID().slice(0, 8)}`);
const DEV_ONLY_PACKAGES = ['@wayvro/provider-test-doubles', '@wayvro/test-support'];
const FORBIDDEN_STRINGS = [
  ...DEV_ONLY_PACKAGES,
  'RecordingOtpDelivery',
  'InMemoryObjectStorage',
  'RecordingPushNotification',
  'createTestDoubleBindings',
  'main.local',
  '/__local/',
];
const BRAND_KEY = 'wayvro.provider.mock';
const BRAND_ALLOWED = 'node_modules/@wayvro/provider-interfaces/dist/brand.js';
const ALLOWED_TOP_LEVEL = new Set(['dist', 'node_modules', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']);
const TEXT_FILE = /\.(c|m)?js$|\.json$|\.ts$|\.map$|\.ya?ml$|\.txt$|\.md$/;
const LOCAL_ENV = {
  DATABASE_URL: 'postgres://wayvro:wayvro-local-only@127.0.0.1:25432/wayvro',
  REDIS_URL: 'redis://127.0.0.1:26379',
  WAYVRO_LOCAL_KEY_SEED: 'wayvro-local-synthetic-key-seed-not-for-production',
};
const PRODUCTION_LIKE_ENV = {
  WAYVRO_ENV: 'production',
  DATABASE_URL: 'postgres://wayvro:unused@db.invalid.example/wayvro?sslmode=verify-full',
  REDIS_URL: 'rediss://cache.invalid.example:6380',
  // a production-shaped staff WebAuthn relying party, so the refusal under test (no key provider) is the one reached
  STAFF_WEBAUTHN_RP_ID: 'ops.wayvro.invalid',
  STAFF_WEBAUTHN_ORIGINS: 'https://ops.wayvro.invalid',
};

const results = [];
function record(id, app, pass, detail = '') {
  results.push({ id, app, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ART-ISO-${id} [${app}]${detail ? ` — ${detail}` : ''}`);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function node(cwd, nodeArgs, env, timeoutMs = 20000) {
  // A minimal environment: nothing from the developer shell (e.g. a stray WAYVRO_ENV) leaks into the probe.
  const base = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: tmpdir(), TMP: tmpdir() };
  return spawnSync(process.execPath, nodeArgs, { cwd, env: { ...base, ...env }, encoding: 'utf8', timeout: timeoutMs });
}

function resolutionProbe(dir, specifier) {
  const r = node(
    dir,
    [
      '--input-type=module',
      '-e',
      `try { await import(${JSON.stringify(specifier)}); console.log('RESOLVED'); } catch (e) { console.log(e.code ?? e.message); }`,
    ],
    {},
  );
  const required = node(
    dir,
    [
      '-e',
      `const { createRequire } = require('node:module'); try { createRequire(${JSON.stringify(pathToFileURL(join(dir, 'dist', 'main.js')).href)}).resolve(${JSON.stringify(specifier)}); console.log('RESOLVED'); } catch (e) { console.log(e.code ?? e.message); }`,
    ],
    {},
  );
  return { esm: r.stdout.trim(), cjs: required.stdout.trim() };
}

function inspectArtifact(app, dir) {
  // 01 dev-only packages absent (top level and in pnpm's virtual store).
  const present = DEV_ONLY_PACKAGES.filter((p) => existsSync(join(dir, 'node_modules', p)));
  const store = join(dir, 'node_modules', '.pnpm');
  const inStore = existsSync(store) ? readdirSync(store).filter((d) => /provider-test-doubles|test-support/.test(d)) : [];
  record('01', app, present.length === 0 && inStore.length === 0, present.concat(inStore).join(', ') || 'dev-only packages not installed');

  // 02 artefact layout.
  const top = readdirSync(dir).filter((e) => !ALLOWED_TOP_LEVEL.has(e));
  record(
    '02',
    app,
    top.length === 0 && existsSync(join(dir, 'dist', 'main.js')),
    top.length ? `unexpected: ${top.join(', ')}` : 'dist/ + production node_modules only',
  );

  // 03 content scan of every text file.
  const hits = [];
  const brandFiles = [];
  let scanned = 0;
  for (const file of walk(dir)) {
    if (!TEXT_FILE.test(file) || statSync(file).size > 8 * 1024 * 1024) continue;
    scanned++;
    const text = readFileSync(file, 'utf8');
    const rel = relative(dir, file).split('\\').join('/');
    for (const s of FORBIDDEN_STRINGS) if (text.includes(s)) hits.push(`${rel}: ${s}`);
    if (text.includes(BRAND_KEY)) brandFiles.push(rel);
  }
  record('03', app, hits.length === 0, hits.length ? hits.slice(0, 10).join('; ') : `${scanned} text files scanned, no double specifier/class/local marker`);
  const brandOk = brandFiles.every((f) => f === BRAND_ALLOWED);
  record('03b', app, brandOk, brandOk ? `brand key only in the refusal guard (${brandFiles.length} file)` : `brand key found in ${brandFiles.join(', ')}`);

  // 04 resolution from inside the artefact.
  const positive = { api: '@nestjs/core', worker: 'pg', realtime: 'socket.io' }[app];
  const control = resolutionProbe(dir, positive);
  record('04a', app, control.esm === 'RESOLVED' && control.cjs === 'RESOLVED', `positive control ${positive}: esm=${control.esm} require=${control.cjs}`);
  for (const spec of [...DEV_ONLY_PACKAGES, 'vitest']) {
    const r = resolutionProbe(dir, spec);
    record('04b', app, r.esm === 'ERR_MODULE_NOT_FOUND' && r.cjs === 'MODULE_NOT_FOUND', `${spec}: esm=${r.esm} require=${r.cjs}`);
  }

  // 05 release marker.
  const markerFile = join(dir, 'dist', 'build-info.json');
  const info = existsSync(markerFile) ? JSON.parse(readFileSync(markerFile, 'utf8')) : null;
  record(
    '05',
    app,
    info?.artifact === 'release' && info?.app === app && /^[0-9a-f]{40}$/.test(info?.commit ?? ''),
    info ? `${info.app} @ ${info.commit}` : 'missing',
  );

  // 06 local/test refused by the marker, before any connection is attempted.
  for (const env of ['local', 'test']) {
    const r = node(dir, ['dist/main.js'], { ...LOCAL_ENV, WAYVRO_ENV: env, PORT: '4199', HEALTH_PORT: '4199' });
    const out = `${r.stdout}${r.stderr}`;
    record('06', app, r.status !== 0 && /release artefact .* refuses WAYVRO_ENV=/.test(out), `WAYVRO_ENV=${env}: exit ${r.status ?? r.signal}`);
  }

  // 07 production-like configuration refused (no production key provider while EG-05 is open).
  if (app !== 'realtime') {
    const r = node(dir, ['dist/main.js'], { ...PRODUCTION_LIKE_ENV, PORT: '4199', HEALTH_PORT: '4199' });
    const out = `${r.stdout}${r.stderr}`;
    record(
      '07',
      app,
      r.status !== 0 && /no production key provider/.test(out),
      `exit ${r.status ?? r.signal}: ${(/KeyProviderError[^\n]*/.exec(out) ?? ['no refusal message'])[0].slice(0, 140)}`,
    );
  }

  // 08 route table of the artefact's own compiled app (api).
  if (app === 'api') {
    const probe = join(OUT, 'route-probe.mjs');
    writeFileSync(probe, ROUTE_PROBE);
    const r = node(dir, [probe, pathToFileURL(dir).href], {});
    const lastLine = r.stdout.trim().split('\n').pop() ?? '';
    const parsed = lastLine.startsWith('{') ? JSON.parse(lastLine) : null;
    const pass = parsed !== null && parsed.extra.length === 0 && parsed.missing.length === 0 && parsed.local.length === 0;
    record(
      '08',
      app,
      pass,
      parsed
        ? `${parsed.served.length} routes; extra=${parsed.extra.join(',') || '-'} missing=${parsed.missing.join(',') || '-'} local=${parsed.local.join(',') || '-'}`
        : `probe failed: ${(r.stderr || r.stdout).slice(-300)}`,
    );
  }
}

/**
 * Runs inside the artefact's module graph: builds the artefact's compiled app (its production createApp, with inert
 * service objects — no connection is opened) and prints the route manifest the app recorded while registering routes.
 */
const ROUTE_PROBE = `
const base = process.argv[2].endsWith('/') ? process.argv[2] : process.argv[2] + '/';
const { createApp, routeManifest } = await import(new URL('dist/app.js', base));
const { API_ROUTES } = await import(new URL('node_modules/@wayvro/contracts/dist/index.js', base));
const silent = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silent; } };
const app = await createApp({
  info: { service: 'api', version: 'artifact-probe' },
  readinessChecks: [],
  log: silent,
  trustProxy: false,
  identity: { otp: {}, sessions: {}, accounts: {}, consents: {}, legalStore: {}, sessionStore: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) } },
  staff: { auth: {}, admin: {}, oversight: {}, policy: {} },
  compliance: { onboarding: {}, admin: {} },
  evidence: null,
});
const served = [...routeManifest(app)];
const expected = new Set(API_ROUTES.map((r) => r.method + ' ' + r.path.replace(/\\{(\\w+)\\}/g, ':$1')));
await app.close();
console.log(JSON.stringify({ served, extra: served.filter((r) => !expected.has(r)), missing: [...expected].filter((r) => !served.includes(r)), local: served.filter((r) => /__local|test-only/.test(r)) }));
process.exit(0);
`;

function negativeControls() {
  const probe = join(ROOT, 'apps', 'api', 'src', '__artifact_isolation_probe.ts');
  writeFileSync(probe, "import { createTestDoubleBindings } from '@wayvro/provider-test-doubles';\nexport const probe = createTestDoubleBindings;\n");
  try {
    const shell = process.platform === 'win32';
    const dc = spawnSync('pnpm', ['run', 'depcruise'], { cwd: ROOT, encoding: 'utf8', shell });
    record(
      'NC1',
      'api',
      dc.status !== 0 && /no-production-to-test-doubles/.test(dc.stdout + dc.stderr),
      'dependency-cruiser rejects a production import of the doubles',
    );
    const lint = spawnSync('pnpm', ['run', 'lint'], { cwd: ROOT, encoding: 'utf8', shell });
    record('NC2', 'api', lint.status !== 0 && /provider-test-doubles/.test(lint.stdout + lint.stderr), 'ESLint rejects a production import of the doubles');
    // Knip production + strict: only `dependencies` count for production code, so a dev-only package is "unlisted".
    // The probe must be reachable from a production entry, so it is imported from the API composition for this check.
    const composition = join(ROOT, 'apps', 'api', 'src', 'composition.ts');
    const original = readFileSync(composition, 'utf8');
    writeFileSync(
      composition,
      `import { probe as __isolationProbe } from './__artifact_isolation_probe.js';
void __isolationProbe;
${original}`,
    );
    try {
      const knip = spawnSync('pnpm', ['run', 'knip'], { cwd: ROOT, encoding: 'utf8', shell });
      record(
        'NC3',
        'api',
        knip.status !== 0 && /provider-test-doubles/.test(knip.stdout + knip.stderr),
        'Knip (production, strict) rejects a production import of the doubles',
      );
    } finally {
      writeFileSync(composition, original);
    }
  } finally {
    rmSync(probe, { force: true });
  }
}

try {
  cleanBuild(SERVER_APPS);
  for (const app of SERVER_APPS) {
    const dir = join(OUT, app);
    buildReleaseArtifact(app, dir);
    inspectArtifact(app, dir);
  }
  if (args.has('--negative-controls')) negativeControls();
} finally {
  if (!args.has('--keep')) rmSync(OUT, { recursive: true, force: true });
  else console.log(`artefacts kept in ${OUT}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nARTIFACT ISOLATION: ${failed.length ? 'FAIL' : 'PASS'} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
