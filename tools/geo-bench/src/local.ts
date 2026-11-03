/**
 * Local-only data handling (SP-04 §8; threat model T3-32): raw provider responses, the run record, the blind key and
 * the working CSV live only in git-ignored or out-of-repository locations. Paths inside the repository that git does
 * NOT ignore are refused, so a raw file can never be staged by accident.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '@wayvro/geo-adapters';

/** The package directory (`tools/geo-bench`), resolved from this module (src/ or dist/). */
/** @internal exported for unit tests */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** `tools/geo-bench/.local/` — git-ignored (root .gitignore). */
export const LOCAL_ROOT = join(PACKAGE_ROOT, '.local');

/** @internal exported for unit tests */
export type IgnoreStatus = 'IGNORED' | 'NOT_IGNORED' | 'OUTSIDE_REPOSITORY';

/**
 * Asks git whether `path` is ignored (`git check-ignore`: 0 ignored, 1 not ignored, 128 e.g. outside the repository).
 * A tracked file is reported NOT_IGNORED even inside an ignored folder (no `--no-index`).
 */
/** @internal exported for unit tests */
export function gitIgnoreStatus(path: string): IgnoreStatus {
  const repo = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: PACKAGE_ROOT, encoding: 'utf8' });
  if (repo.status !== 0) throw new Error('git is required to verify that local benchmark data is git-ignored');
  const top = resolve(repo.stdout.trim());
  const rel = relative(top, resolve(path));
  if (rel.startsWith('..') || isAbsolute(rel)) return 'OUTSIDE_REPOSITORY';
  const result = spawnSync('git', ['check-ignore', '-q', rel === '' ? '.' : rel], { cwd: top, encoding: 'utf8' });
  if (result.status === 0) return 'IGNORED';
  if (result.status === 1) return 'NOT_IGNORED';
  throw new Error('git check-ignore failed');
}

/** Refuses a location that git would track (raw/working data must never be committable). */
export function assertPrivateLocation(path: string, what: string): void {
  if (gitIgnoreStatus(path) === 'NOT_IGNORED') {
    throw new Error(`${what} is inside the repository and NOT git-ignored: move it outside the repository or under tools/geo-bench/.local/`);
  }
}

/**
 * Wraps fetch and writes every provider response (status + body) to `rawDir`. The request URL and headers are NOT
 * written (they carry keys). Files stay local; delete them after the analysis and within 30 days (§5.7).
 */
export function recordingFetch(rawDir: string, label: string, base: FetchLike = (url, init) => fetch(url, init)): FetchLike {
  mkdirSync(rawDir, { recursive: true });
  let seq = 0;
  return async (url, init) => {
    const response = await base(url, init);
    const copy = response.clone();
    seq += 1;
    const body = await copy.text();
    writeFileSync(
      join(rawDir, `${label}-${String(seq).padStart(6, '0')}.json`),
      JSON.stringify({ status: response.status, body: body.length > 2_000_000 ? '[TRUNCATED > 2 MB]' : body }),
    );
    return response;
  };
}
