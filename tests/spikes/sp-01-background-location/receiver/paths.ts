/**
 * Receiver safety rails (protocol §5.4/§15): the receiver binds only to a private LAN (or loopback) IPv4 address and
 * refuses a data file inside the Git repository, so raw rows can never be committed by accident.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export function isPrivateOrLoopbackIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a = -1, b = -1] = o;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Every ancestor (or self) that contains `.git` — a directory in a clone, a file in a worktree. All of them count: a
 * worktree nested inside the main checkout must not accept a path inside the main checkout either.
 */
export function findRepoRoots(start: string): string[] {
  const roots: string[] = [];
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.git'))) roots.push(dir);
    const parent = dirname(dir);
    if (parent === dir) return roots;
    dir = parent;
  }
}

/** Resolves the deepest existing ancestor through realpath so symlinks/junctions cannot smuggle a path into the repo. */
function canonical(path: string): string {
  let probe = resolve(path);
  const tail: string[] = [];
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    tail.unshift(probe.slice(parent.length).replace(/^[\\/]/, ''));
    probe = parent;
  }
  const base = existsSync(probe) ? realpathSync.native(probe) : probe;
  return tail.length ? join(base, ...tail) : base;
}

export function isInside(child: string, parent: string): boolean {
  const norm = (p: string): string => (process.platform === 'win32' ? canonical(p).toLowerCase() : canonical(p));
  const rel = relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function assertDataPathOutsideRepo(dataPath: string, codeDir: string): void {
  for (const root of findRepoRoots(codeDir)) {
    if (isInside(dataPath, root)) {
      throw new Error(`refusing data path inside a Git repository (${root}); use the session scratch directory (protocol §15)`);
    }
  }
}
