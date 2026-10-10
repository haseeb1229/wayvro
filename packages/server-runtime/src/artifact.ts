/**
 * Release-artefact policy (ADR-045, F-01). `scripts/build-release-artifact.mjs` writes an immutable `build-info.json`
 * (`artifact: "release"`) next to each deployable's `dist/main.js`. Every production composition root calls
 * `enforceArtifactPolicy` right after loading configuration:
 *   - a release artefact refuses `WAYVRO_ENV=local|test`, so a production artefact accidentally configured as local
 *     neither contains test doubles (they are not installed) nor accepts the local environment;
 *   - `staging`/`production` refuse to run from anything but a release artefact (no workspace/dev builds in production).
 * The environment name is therefore never the only boundary: the artefact contents are (scripts/artifact-isolation.mjs).
 */
import { readFileSync } from 'node:fs';
import { isNonProductionLike, type WayvroEnv } from '@wayvro/config';

export interface BuildInfo {
  readonly artifact: 'release';
  readonly app: string;
  readonly commit: string;
  readonly builtAt: string;
}

export class ArtifactPolicyError extends Error {
  override readonly name = 'ArtifactPolicyError';
}

function parseBuildInfo(raw: string): BuildInfo {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    throw new ArtifactPolicyError('build-info.json is not valid JSON', { cause: e });
  }
  const v = value as Partial<Record<keyof BuildInfo, unknown>>;
  if (
    v.artifact !== 'release' ||
    typeof v.app !== 'string' ||
    typeof v.commit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(v.commit) ||
    typeof v.builtAt !== 'string'
  ) {
    throw new ArtifactPolicyError('build-info.json is malformed (expected artifact "release", app, 40-hex commit, builtAt)');
  }
  return { artifact: 'release', app: v.app, commit: v.commit, builtAt: v.builtAt };
}

/** Reads the release marker; `null` when the file does not exist (a workspace/development build). */
export function readBuildInfo(markerFile: URL): BuildInfo | null {
  let raw: string;
  try {
    raw = readFileSync(markerFile, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ArtifactPolicyError('build-info.json could not be read', { cause: e });
  }
  return parseBuildInfo(raw);
}

/**
 * Throws `ArtifactPolicyError` when the artefact kind and the environment do not match. Returns the build info of a
 * release artefact (or `null` for a development build in local/test).
 */
export function enforceArtifactPolicy(markerFile: URL, env: WayvroEnv): BuildInfo | null {
  const info = readBuildInfo(markerFile);
  if (info && isNonProductionLike(env)) {
    throw new ArtifactPolicyError(`release artefact (${info.app} @ ${info.commit.slice(0, 12)}) refuses WAYVRO_ENV=${env}`);
  }
  if (!info && !isNonProductionLike(env)) {
    throw new ArtifactPolicyError(`WAYVRO_ENV=${env} requires a release artefact (build-info.json written by scripts/build-release-artifact.mjs)`);
  }
  return info;
}
