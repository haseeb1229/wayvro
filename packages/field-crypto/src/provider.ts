/**
 * Key providers (Q08). P2.1 has exactly one: the LOCAL provider, which derives synthetic per-key-id material from a
 * development seed with HKDF-SHA-256 (`node:crypto` hkdfSync, RFC 5869 — a standard KDF, used only so that no key
 * material is committed). It is refused in staging/production. A production provider needs KMS custody of the KEK and
 * wrapped field/lookup/MAC keys, which is external gate EG-05 — so staging/production boot refuses until then.
 */
import { hkdfSync } from 'node:crypto';
import { isNonProductionLike, type WayvroEnv } from '@wayvro/config';
import { KEY_CLASSES } from './cipher.js';
import { KEY_STATES, KeyRing, parseKeyId, type KeyEntry, type KeyState } from './keyring.js';

export class KeyProviderError extends Error {
  override readonly name = 'KeyProviderError';
}

/** Default local spec: version 1 of every P2.1 key class, ACTIVE. */
export const DEFAULT_LOCAL_KEY_SPEC = Object.values(KEY_CLASSES)
  .map((c) => `${c}.v1=ACTIVE`)
  .join(',');

const LOCAL_SALT = Buffer.from('wayvro-local-keyring-v1', 'utf8');
const MIN_SEED_LENGTH = 32;

/** Parses "contact.v1=DECRYPT_ONLY,contact.v2=ACTIVE,…" into (id, state) pairs. */
function parseKeySpec(spec: string): ReadonlyArray<{ id: string; state: KeyState }> {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      const [id, state] = entry.split('=');
      if (!id || !state || !(KEY_STATES as readonly string[]).includes(state)) throw new KeyProviderError(`invalid key spec entry "${entry}"`);
      parseKeyId(id);
      return { id, state: state as KeyState };
    });
}

/** Builds a key ring of synthetic local keys. Never call this outside local/test (see `loadKeyRing`). */
export function localKeyRing(seed: string, spec: string = DEFAULT_LOCAL_KEY_SPEC): KeyRing {
  if (seed.length < MIN_SEED_LENGTH) throw new KeyProviderError(`local key seed must be at least ${String(MIN_SEED_LENGTH)} characters`);
  const entries: KeyEntry[] = parseKeySpec(spec).map(({ id, state }) => {
    const { keyClass, version } = parseKeyId(id);
    const material = Buffer.from(hkdfSync('sha256', Buffer.from(seed, 'utf8'), LOCAL_SALT, Buffer.from(id, 'utf8'), 32));
    return { id, keyClass, version, state, material };
  });
  return new KeyRing(entries);
}

export interface KeySource {
  readonly WAYVRO_LOCAL_KEY_SEED?: string | undefined;
  readonly WAYVRO_LOCAL_KEY_SPEC?: string | undefined;
}

/** Resolves the key ring for an environment; staging/production refuse local material and have no provider yet. */
export function loadKeyRing(env: WayvroEnv, source: KeySource): KeyRing {
  if (!isNonProductionLike(env)) {
    if (source.WAYVRO_LOCAL_KEY_SEED !== undefined) throw new KeyProviderError(`WAYVRO_ENV=${env} refuses local key material (WAYVRO_LOCAL_KEY_SEED)`);
    throw new KeyProviderError(
      `WAYVRO_ENV=${env}: no production key provider is configured — field, lookup and MAC key custody requires a KMS (external gate EG-05)`,
    );
  }
  if (!source.WAYVRO_LOCAL_KEY_SEED) throw new KeyProviderError(`WAYVRO_ENV=${env} requires WAYVRO_LOCAL_KEY_SEED (synthetic local keys)`);
  return localKeyRing(source.WAYVRO_LOCAL_KEY_SEED, source.WAYVRO_LOCAL_KEY_SPEC ?? DEFAULT_LOCAL_KEY_SPEC);
}
