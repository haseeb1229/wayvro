import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertDataPathOutsideRepo, isPrivateOrLoopbackIPv4 } from '../receiver/paths.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('receiver bind address', () => {
  it('accepts only RFC 1918 private and loopback IPv4 addresses', () => {
    for (const ok of ['192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.254', '127.0.0.1']) assert.equal(isPrivateOrLoopbackIPv4(ok), true, ok);
    for (const bad of ['0.0.0.0', '8.8.8.8', '172.32.0.1', '192.169.1.1', '256.1.1.1', 'localhost', '::1', '192.168.1'])
      assert.equal(isPrivateOrLoopbackIPv4(bad), false, bad);
  });
});

describe('receiver data path', () => {
  it('refuses a data file inside the repository (raw rows must never be committable)', () => {
    assert.throws(() => assertDataPathOutsideRepo(join(HERE, '..', 'results', 'rows.jsonl'), HERE), /inside a Git repository/);
    assert.throws(() => assertDataPathOutsideRepo(join(HERE, '..', '..', '..', '..', 'not-yet-existing', 'x.jsonl'), HERE), /inside a Git repository/);
  });

  it('accepts the system temp / session scratch directory', () => {
    assert.doesNotThrow(() => assertDataPathOutsideRepo(join(tmpdir(), 'sp01-rows.jsonl'), HERE));
  });
});
