/**
 * Local-data safety: the harness raw-data folder is git-ignored (verified with `git check-ignore`, GITIGNORE-HARNESS),
 * tracked locations are refused, and the recording fetch never writes the request URL (it may carry a key).
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_ROOT, PACKAGE_ROOT, assertPrivateLocation, gitIgnoreStatus, recordingFetch } from './local.js';

describe('git-ignore of local benchmark data', () => {
  it('ignores everything under tools/geo-bench/.local/', () => {
    expect(gitIgnoreStatus(join(LOCAL_ROOT, 'runs', 'x', 'raw', 's1-000001.json'))).toBe('IGNORED');
    expect(gitIgnoreStatus(join(LOCAL_ROOT, 'usage-ledger.json'))).toBe('IGNORED');
    expect(gitIgnoreStatus(join(LOCAL_ROOT, 'input', 'working.csv'))).toBe('IGNORED');
  });

  it('does not ignore tracked source and refuses it as a data location', () => {
    expect(gitIgnoreStatus(join(PACKAGE_ROOT, 'src', 'cli.ts'))).toBe('NOT_IGNORED');
    expect(() => {
      assertPrivateLocation(join(PACKAGE_ROOT, 'runs'), 'the run folder');
    }).toThrow(/NOT git-ignored/);
    expect(() => {
      assertPrivateLocation(join(LOCAL_ROOT, 'runs'), 'the run folder');
    }).not.toThrow();
  });

  it('allows locations outside the repository', () => {
    const outside = mkdtempSync(join(tmpdir(), 'geo-bench-outside-'));
    expect(gitIgnoreStatus(outside)).toBe('OUTSIDE_REPOSITORY');
    expect(() => {
      assertPrivateLocation(outside, 'the working CSV');
    }).not.toThrow();
  });
});

describe('recordingFetch', () => {
  it('writes status and body only — never the URL or headers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'geo-bench-raw-'));
    const fetchImpl = recordingFetch(dir, 's9', () => Promise.resolve(new Response('{"synthetic":true}', { status: 200 })));
    const res = await fetchImpl('https://provider.invalid/v1/x?key=SECRET-KEY&q=query', { headers: { 'X-Goog-Api-Key': 'SECRET-KEY' } });
    expect(await res.json()).toEqual({ synthetic: true });
    const files = readdirSync(dir);
    expect(files).toEqual(['s9-000001.json']);
    const stored = readFileSync(join(dir, files[0]!), 'utf8');
    expect(JSON.parse(stored)).toEqual({ status: 200, body: '{"synthetic":true}' });
    expect(stored).not.toContain('SECRET');
    expect(stored).not.toContain('provider.invalid');
  });
});
