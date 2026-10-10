/**
 * Key ring (data model §8.2). Each key id is `<class>.v<version>` and has a state:
 *   ACTIVE       — encrypt/MAC/hash new values and decrypt; exactly one per key class;
 *   DECRYPT_ONLY — still decrypts (field keys) or is still written/read (lookup keys) during a rotation;
 *   RETIRED      — never used; any envelope naming it fails closed.
 * Key material comes from a KeyProvider: the local provider (local/test only) or, after EG-05, a KMS-backed provider.
 */
export const KEY_STATES = ['ACTIVE', 'DECRYPT_ONLY', 'RETIRED'] as const;
export type KeyState = (typeof KEY_STATES)[number];

export interface KeyEntry {
  readonly id: string;
  readonly keyClass: string;
  readonly version: number;
  readonly state: KeyState;
  readonly material: Buffer;
}

export class KeyRingError extends Error {
  override readonly name = 'KeyRingError';
}

const KEY_ID = /^([a-z][a-z_]{1,40})\.v([1-9][0-9]{0,4})$/;

export function parseKeyId(id: string): { keyClass: string; version: number } {
  const m = KEY_ID.exec(id);
  if (!m?.[1] || !m[2]) throw new KeyRingError(`invalid key id "${id}" (expected <class>.v<version>)`);
  return { keyClass: m[1], version: Number(m[2]) };
}

export class KeyRing {
  private readonly byId = new Map<string, KeyEntry>();

  constructor(entries: readonly KeyEntry[]) {
    const activeByClass = new Map<string, number>();
    for (const e of entries) {
      const parsed = parseKeyId(e.id);
      if (parsed.keyClass !== e.keyClass || parsed.version !== e.version) throw new KeyRingError(`key ${e.id}: class/version do not match its id`);
      if (e.material.length !== 32) throw new KeyRingError(`key ${e.id}: material must be 256 bits`);
      if (!(KEY_STATES as readonly string[]).includes(e.state)) throw new KeyRingError(`key ${e.id}: unknown state`);
      if (this.byId.has(e.id)) throw new KeyRingError(`duplicate key id ${e.id}`);
      this.byId.set(e.id, e);
      if (e.state === 'ACTIVE') activeByClass.set(e.keyClass, (activeByClass.get(e.keyClass) ?? 0) + 1);
    }
    const classes = new Set(entries.map((e) => e.keyClass));
    for (const c of classes) {
      const n = activeByClass.get(c) ?? 0;
      if (n !== 1) throw new KeyRingError(`key class ${c} must have exactly one ACTIVE key (found ${String(n)})`);
    }
  }

  /** The single ACTIVE key of a class (encrypt, MAC, primary lookup). */
  active(keyClass: string): KeyEntry {
    for (const e of this.byId.values()) if (e.keyClass === keyClass && e.state === 'ACTIVE') return e;
    throw new KeyRingError(`no ACTIVE key for class ${keyClass}`);
  }

  /** Any non-retired key by id, or `undefined` (unknown or RETIRED). */
  usable(id: string): KeyEntry | undefined {
    const e = this.byId.get(id);
    return e && e.state !== 'RETIRED' ? e : undefined;
  }

  /** True when the id exists but is RETIRED (distinguished for alerting, never for decryption). */
  isRetired(id: string): boolean {
    return this.byId.get(id)?.state === 'RETIRED';
  }

  /** Non-retired keys of a class, newest version first (dual-write/dual-read sets during a lookup-key rotation). */
  live(keyClass: string): readonly KeyEntry[] {
    return [...this.byId.values()].filter((e) => e.keyClass === keyClass && e.state !== 'RETIRED').sort((a, b) => b.version - a.version);
  }

  /** Non-retired key of a class at an exact version. */
  version(keyClass: string, version: number): KeyEntry | undefined {
    return this.usable(`${keyClass}.v${String(version)}`);
  }
}
