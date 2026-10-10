#!/usr/bin/env node
/*
 * Builds the deployable release artefact of one server app (ADR-045). Node built-ins only.
 *
 *   node scripts/build-release-artifact.mjs <api|worker|realtime> <empty output directory outside the repository>
 *
 * The builder first deletes every workspace `dist/` and rebuilds the app with its dependencies through Turborepo with
 * `--force` (no cache restore), because `tsc` never deletes outputs of removed sources (P2.1 found a stale compiled test
 * double this way). The artefact is `pnpm deploy --prod` of the app (verified with pnpm 12.10.1 and the hoisted
 * linker in P2.1): production dependencies only, workspace packages injected as their published `files` (`dist/`),
 * no devDependencies — so the dev-only `@wayvro/provider-test-doubles` and `@wayvro/test-support` are never installed.
 * The app's own `files` field ships `dist/` only (no `src/`, `test/`, `dev/` or `dist-dev/`). Finally an immutable
 * `dist/build-info.json` release marker is written; boot refuses WAYVRO_ENV=local|test when it is present. The artefact
 * `package.json` keeps runtime metadata only (no scripts or devDependencies that reference development tooling).
 * Phase 7 container images must be built from exactly this directory.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER_APPS = ['api', 'worker', 'realtime'];

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', ...options });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status}):\n${(r.stdout ?? '') + (r.stderr ?? '')}`);
  return r.stdout.trim();
}

/** True when `dir` is inside the repository: Node would then resolve hoisted root node_modules from the artefact. */
export function isInsideRepository(dir) {
  const rel = relative(ROOT, resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Deletes every workspace `dist/` and rebuilds the given apps and their workspace dependencies without cache. */
export function cleanBuild(apps) {
  for (const group of ['apps', 'packages']) {
    for (const name of readdirSync(join(ROOT, group))) rmSync(join(ROOT, group, name, 'dist'), { recursive: true, force: true });
  }
  run('pnpm', ['exec', 'turbo', 'run', 'build', '--force', ...apps.map((a) => `--filter=@wayvro/${a}...`)]);
}

export function buildReleaseArtifact(app, outDir) {
  if (!SERVER_APPS.includes(app)) throw new Error(`unknown app "${app}" (expected ${SERVER_APPS.join(', ')})`);
  if (isInsideRepository(outDir)) throw new Error(`output directory must be outside the repository: ${outDir}`);
  if (existsSync(outDir) && readdirSync(outDir).length > 0) throw new Error(`output directory must be empty: ${outDir}`);
  if (!existsSync(join(ROOT, 'apps', app, 'dist', 'main.js'))) throw new Error(`apps/${app}/dist/main.js is missing — run \`pnpm build\` first`);
  mkdirSync(dirname(outDir), { recursive: true });
  const quote = (s) => (process.platform === 'win32' ? `"${s}"` : s);
  run('pnpm', ['--filter', `@wayvro/${app}`, 'deploy', '--prod', '--frozen-lockfile', quote(outDir)]);
  const commit = run('git', ['rev-parse', 'HEAD'], { shell: false });
  const pkgFile = join(outDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  const runtimePkg = { name: pkg.name, version: pkg.version, private: true, type: pkg.type, dependencies: pkg.dependencies };
  writeFileSync(pkgFile, JSON.stringify(runtimePkg, null, 2) + '\n');
  const marker = join(outDir, 'dist', 'build-info.json');
  writeFileSync(marker, JSON.stringify({ artifact: 'release', app, commit, builtAt: new Date().toISOString() }, null, 2) + '\n');
  chmodSync(marker, 0o444);
  return { app, dir: outDir, commit, marker };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [app, out] = process.argv.slice(2);
  if (!app || !out) {
    console.error('usage: node scripts/build-release-artifact.mjs <api|worker|realtime> <empty output directory outside the repository>');
    process.exit(2);
  }
  cleanBuild([app]);
  const result = buildReleaseArtifact(app, resolve(out));
  console.log(`release artefact: ${result.app} @ ${result.commit} -> ${result.dir}`);
}
