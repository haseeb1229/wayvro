#!/usr/bin/env node
/*
 * Builds the isolated image-sanitiser container (ADR-041) as `wayvro-sanitiser:local` from a MINIMAL build context:
 * infra/sanitiser/{Dockerfile,package.json,package-lock.json} + the compiled packages/image-sanitiser/dist (without
 * tests or source maps). The repository root is never sent to the Docker daemon. Prints the image id, which staging
 * would pin by digest (P2.A4); local/test may use the tag.
 *
 *   node scripts/sanitiser-image.mjs            build (requires `pnpm --filter @wayvro/image-sanitiser build` first)
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'packages', 'image-sanitiser', 'dist');
const TAG = 'wayvro-sanitiser:local';

if (!existsSync(join(DIST, 'cli.js'))) {
  process.stderr.write('packages/image-sanitiser/dist/cli.js is missing: run `pnpm --filter @wayvro/image-sanitiser build` first\n');
  process.exit(2);
}
const context = mkdtempSync(join(tmpdir(), 'wayvro-sanitiser-'));
try {
  for (const f of ['Dockerfile', 'package.json', 'package-lock.json']) cpSync(join(ROOT, 'infra', 'sanitiser', f), join(context, f));
  cpSync(DIST, join(context, 'dist'), { recursive: true, filter: (src) => !/\.(test\.js|map|d\.ts)$/.test(src) && !src.endsWith('.d.ts.map') });
  const shipped = readdirSync(join(context, 'dist')).sort();
  const build = spawnSync('docker', ['build', '--pull=false', '-t', TAG, context], { stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
  const id = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', TAG], { encoding: 'utf8' });
  process.stdout.write(`${TAG} ${id.stdout.trim()} (dist: ${shipped.join(', ')})\n`);
} finally {
  rmSync(context, { recursive: true, force: true });
}
