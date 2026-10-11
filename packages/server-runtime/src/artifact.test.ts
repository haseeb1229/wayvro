import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ArtifactPolicyError, enforceArtifactPolicy, readBuildInfo } from './artifact.js';

const RELEASE = { artifact: 'release', app: 'api', commit: 'a'.repeat(40), builtAt: '2026-10-10T00:00:00.000Z' };

function marker(content: string | null): URL {
  const dir = mkdtempSync(join(tmpdir(), 'wayvro-artifact-'));
  const file = join(dir, 'build-info.json');
  if (content !== null) writeFileSync(file, content);
  return pathToFileURL(file);
}

describe('release artefact policy (ADR-045)', () => {
  it.each(['local', 'test'] as const)('a release artefact refuses WAYVRO_ENV=%s', (env) => {
    expect(() => enforceArtifactPolicy(marker(JSON.stringify(RELEASE)), env)).toThrow(/release artefact .* refuses WAYVRO_ENV/);
  });

  it.each(['staging', 'production'] as const)('a release artefact runs in %s', (env) => {
    expect(enforceArtifactPolicy(marker(JSON.stringify(RELEASE)), env)).toEqual(RELEASE);
  });

  it.each(['staging', 'production'] as const)('a development build refuses %s', (env) => {
    expect(() => enforceArtifactPolicy(marker(null), env)).toThrow(/requires a release artefact/);
  });

  it.each(['local', 'test'] as const)('a development build runs in %s', (env) => {
    expect(enforceArtifactPolicy(marker(null), env)).toBeNull();
  });

  it('rejects malformed or unreadable markers instead of ignoring them', () => {
    expect(() => readBuildInfo(marker('{not json'))).toThrow(ArtifactPolicyError);
    expect(() => readBuildInfo(marker(JSON.stringify({ ...RELEASE, artifact: 'debug' })))).toThrow(/malformed/);
    expect(() => readBuildInfo(marker(JSON.stringify({ ...RELEASE, commit: 'short' })))).toThrow(/malformed/);
    expect(() => readBuildInfo(pathToFileURL(tmpdir()))).toThrow(/could not be read/);
  });
});
