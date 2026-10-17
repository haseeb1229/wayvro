/** UNIT-CRYPTO / PROP-CRYPTO (docs/phase2/PHASE2_TEST_STRATEGY.md §2) — envelope, key ring, keyed digests, provider. */
import { randomBytes, randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCAL_KEY_SPEC,
  FieldCipher,
  FieldDecryptionError,
  FieldEncryptionError,
  KeyProviderError,
  KeyRing,
  KeyRingError,
  KeyedHasher,
  loadKeyRing,
  localKeyRing,
  openEvidence,
  parseEnvelope,
  sealEvidence,
  type FieldContext,
  type KeyEntry,
  type KeyState,
} from './index.js';

const SEED = 'synthetic-unit-test-seed-0123456789abcdef';
const key = (id: string, state: KeyState): KeyEntry => {
  const [keyClass, v] = id.split('.v');
  return { id, keyClass: keyClass ?? '', version: Number(v), state, material: randomBytes(32) };
};
const ctx = (over: Partial<FieldContext> = {}): FieldContext => ({
  field: 'identity.account_phones.phone_envelope',
  rowId: randomUUID(),
  fieldSchemaVersion: 1,
  ...over,
});
const reason = (fn: () => unknown): string => {
  try {
    fn();
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof FieldDecryptionError ? e.reason : `UNTYPED:${(e as Error).name}`;
  }
};

describe('envelope v1 (AES-256-GCM)', () => {
  const cipher = new FieldCipher(localKeyRing(SEED));

  it('round-trips and lays out version, algorithm, key id, 96-bit nonce, 128-bit tag, ciphertext', () => {
    const c = ctx();
    const env = cipher.encrypt('contact', '+923000000001', c);
    expect(env[0]).toBe(0x01);
    expect(env[1]).toBe(0x01);
    const parsed = parseEnvelope(env);
    expect(parsed.keyId).toBe('contact.v1');
    expect(parsed.nonce).toHaveLength(12);
    expect(parsed.tag).toHaveLength(16);
    expect(parsed.ciphertext).toHaveLength('+923000000001'.length);
    expect(cipher.decryptString('contact', env, c)).toBe('+923000000001');
    expect(env.toString('latin1')).not.toContain('+923000000001');
  });

  it('flipping any single bit of version, algorithm, key id, nonce, tag or ciphertext fails closed (property)', () => {
    const c = ctx();
    const env = cipher.encrypt('contact', '+923000000002', c);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: env.length * 8 - 1 }), (bit) => {
        const tampered = Buffer.from(env);
        tampered[bit >> 3] = (tampered[bit >> 3] ?? 0) ^ (1 << (bit & 7));
        const r = reason(() => cipher.decrypt('contact', tampered, c));
        return r !== 'NO_ERROR' && !r.startsWith('UNTYPED');
      }),
      { numRuns: 2000 },
    );
  });

  it('AAD binds the envelope to its row, column and field-schema version', () => {
    const c = ctx();
    const env = cipher.encrypt('contact', '+923000000003', c);
    expect(reason(() => cipher.decrypt('contact', env, { ...c, rowId: randomUUID() }))).toBe('AUTHENTICATION_FAILED');
    expect(reason(() => cipher.decrypt('contact', env, { ...c, field: 'identity.otp_challenges.phone_envelope' }))).toBe('AUTHENTICATION_FAILED');
    expect(reason(() => cipher.decrypt('contact', env, { ...c, fieldSchemaVersion: 2 }))).toBe('AUTHENTICATION_FAILED');
    expect(reason(() => cipher.decrypt('job_secrets', env, c))).toBe('KEY_CLASS_MISMATCH');
  });

  it('never repeats a nonce across 100,000 encryptions under one key (sanity check, not a proof)', () => {
    const c = ctx();
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) seen.add(parseEnvelope(cipher.encrypt('contact', 'x', c)).nonce.toString('hex'));
    expect(seen.size).toBe(100_000);
  });

  it('malformed or hostile envelopes only ever yield typed errors (fuzz)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 120 }), (bytes) => {
        const r = reason(() => cipher.decrypt('contact', bytes, ctx()));
        return r !== 'NO_ERROR' && !r.startsWith('UNTYPED');
      }),
      { numRuns: 3000 },
    );
    expect(reason(() => cipher.decrypt('contact', Buffer.from([0x02, 0x01, 0x01]), ctx()))).toBe('UNKNOWN_FORMAT');
    expect(reason(() => cipher.decrypt('contact', Buffer.from([0x01, 0x09, 0x01]), ctx()))).toBe('UNKNOWN_ALGORITHM');
    expect(reason(() => cipher.decrypt('contact', Buffer.from([0x01, 0x01, 0x00]), ctx()))).toBe('MALFORMED');
    const unknownKey = Buffer.from(cipher.encrypt('contact', 'x', ctx()));
    unknownKey.write('contact.v9', 3, 'ascii');
    expect(reason(() => cipher.decrypt('contact', unknownKey, ctx()))).toBe('UNKNOWN_KEY');
  });

  it('rejects invalid field contexts before encrypting', () => {
    expect(() => cipher.encrypt('contact', 'x', { ...ctx(), field: 'not a field' })).toThrow(FieldEncryptionError);
    expect(() => cipher.encrypt('contact', 'x', { ...ctx(), rowId: 'row-1' })).toThrow(FieldEncryptionError);
    expect(() => cipher.encrypt('contact', 'x', { ...ctx(), fieldSchemaVersion: 0 })).toThrow(FieldEncryptionError);
  });
});

describe('key states and rotation semantics', () => {
  it('DECRYPT_ONLY still decrypts, RETIRED fails closed, new writes use the ACTIVE key', () => {
    const v1 = key('contact.v1', 'ACTIVE');
    const c = ctx();
    const old = new FieldCipher(new KeyRing([v1])).encrypt('contact', 'value', c);
    const rotating = new FieldCipher(new KeyRing([{ ...v1, state: 'DECRYPT_ONLY' }, key('contact.v2', 'ACTIVE')]));
    expect(rotating.decryptString('contact', old, c)).toBe('value');
    expect(rotating.isStale('contact', old)).toBe(true);
    const fresh = rotating.encrypt('contact', 'value', c);
    expect(parseEnvelope(fresh).keyId).toBe('contact.v2');
    expect(rotating.isStale('contact', fresh)).toBe(false);
    const retired = new FieldCipher(new KeyRing([{ ...v1, state: 'RETIRED' }, key('contact.v2', 'ACTIVE')]));
    expect(reason(() => retired.decrypt('contact', old, c))).toBe('KEY_RETIRED');
  });

  it('a key ring needs exactly one ACTIVE key per class, 256-bit material and consistent ids', () => {
    expect(() => new KeyRing([key('contact.v1', 'DECRYPT_ONLY')])).toThrow(/exactly one ACTIVE/);
    expect(() => new KeyRing([key('contact.v1', 'ACTIVE'), key('contact.v2', 'ACTIVE')])).toThrow(/exactly one ACTIVE/);
    expect(() => new KeyRing([{ ...key('contact.v1', 'ACTIVE'), material: randomBytes(16) }])).toThrow(/256 bits/);
    expect(() => new KeyRing([{ ...key('contact.v1', 'ACTIVE'), version: 2 }])).toThrow(/do not match/);
    expect(() => new KeyRing([key('contact.v1', 'ACTIVE'), key('contact.v1', 'ACTIVE')])).toThrow(KeyRingError);
    expect(() => new KeyRing([{ ...key('contact.v1', 'ACTIVE'), state: 'LOST' as KeyState }])).toThrow(/unknown state/);
    expect(() => new KeyRing([{ ...key('contact.v1', 'ACTIVE'), id: 'Contact-1' }])).toThrow(/invalid key id/);
    expect(() => new KeyRing([key('contact.v1', 'ACTIVE')]).active('phone_lookup')).toThrow(/no ACTIVE key/);
  });
});

describe('keyed digests (lookups and MACs)', () => {
  const ring = new KeyRing([
    key('phone_lookup.v1', 'DECRYPT_ONLY'),
    key('phone_lookup.v2', 'ACTIVE'),
    key('phone_lookup.v3', 'RETIRED'),
    key('otp_mac.v1', 'ACTIVE'),
  ]);
  const h = new KeyedHasher(ring);

  it('is deterministic per key version and independent across versions', () => {
    const a = h.active('phone_lookup', '+923000000001');
    expect(a.version).toBe(2);
    expect(h.active('phone_lookup', '+923000000001').digest.equals(a.digest)).toBe(true);
    const live = h.live('phone_lookup', '+923000000001');
    expect(live.map((d) => d.version)).toEqual([2, 1]);
    expect(live[0]?.digest.equals(live[1]?.digest ?? Buffer.alloc(0))).toBe(false);
    expect(h.at('phone_lookup', 3, 'x')).toBeUndefined();
  });

  it('verifies MACs in constant time and rejects wrong data, versions and lengths', () => {
    const mac = h.active('otp_mac', 'challenge|123456');
    expect(h.verify('otp_mac', mac.version, 'challenge|123456', mac.digest)).toBe(true);
    expect(h.verify('otp_mac', mac.version, 'challenge|123457', mac.digest)).toBe(false);
    expect(h.verify('otp_mac', 7, 'challenge|123456', mac.digest)).toBe(false);
    expect(h.verify('otp_mac', mac.version, 'challenge|123456', mac.digest.subarray(1))).toBe(false);
  });
});

describe('key provider (local/test only; staging/production refuse — EG-05)', () => {
  it.each(['staging', 'production'] as const)('%s has no provider and refuses local material', (env) => {
    expect(() => loadKeyRing(env, {})).toThrow(/no production key provider/);
    expect(() => loadKeyRing(env, { WAYVRO_LOCAL_KEY_SEED: SEED })).toThrow(/refuses local key material/);
  });

  it.each(['local', 'test'] as const)('%s derives deterministic synthetic keys from the seed', (env) => {
    const a = new FieldCipher(loadKeyRing(env, { WAYVRO_LOCAL_KEY_SEED: SEED }));
    const b = new FieldCipher(loadKeyRing(env, { WAYVRO_LOCAL_KEY_SEED: SEED, WAYVRO_LOCAL_KEY_SPEC: DEFAULT_LOCAL_KEY_SPEC }));
    const c = ctx();
    expect(b.decryptString('contact', a.encrypt('contact', 'v', c), c)).toBe('v');
    expect(() => loadKeyRing(env, {})).toThrow(/requires WAYVRO_LOCAL_KEY_SEED/);
    expect(() => loadKeyRing(env, { WAYVRO_LOCAL_KEY_SEED: 'short' })).toThrow(/at least 32/);
  });

  it('Phase 3 key classes (place_refs, geo_cache) are in the default spec; an explicit spec without them has no key (boot fails closed)', () => {
    expect(DEFAULT_LOCAL_KEY_SPEC).toContain('place_refs.v1=ACTIVE');
    expect(DEFAULT_LOCAL_KEY_SPEC).toContain('geo_cache.v1=ACTIVE');
    const full = localKeyRing(SEED);
    expect(full.active('place_refs').id).toBe('place_refs.v1');
    expect(new KeyedHasher(full).active('geo_cache', 'k').digest).toHaveLength(32);
    const explicit = localKeyRing(SEED, 'contact.v1=ACTIVE');
    expect(() => explicit.active('place_refs')).toThrow(KeyRingError);
    expect(() => new KeyedHasher(explicit).active('geo_cache', 'k')).toThrow(KeyRingError);
  });

  it('parses rotation specs and rejects malformed ones', () => {
    const ring = localKeyRing(SEED, 'contact.v1=DECRYPT_ONLY,contact.v2=ACTIVE, phone_lookup.v1=ACTIVE');
    expect(ring.active('contact').id).toBe('contact.v2');
    expect(() => localKeyRing(SEED, 'contact.v1=MAYBE')).toThrow(KeyProviderError);
    expect(() => localKeyRing(SEED, 'contact=ACTIVE')).toThrow(/invalid key id/);
  });
});

describe('evidence objects: per-object DEK wrapped by the evidence KEK (UNIT-CRYPTO, ADR-041 §2.4)', () => {
  const cipher = new FieldCipher(localKeyRing(SEED));
  const image = randomBytes(4096);

  it('round-trips, uses a fresh DEK and nonce per object, and never contains the plaintext', () => {
    const id = randomUUID();
    const a = sealEvidence(cipher, id, image);
    const b = sealEvidence(cipher, id, image);
    expect(openEvidence(cipher, id, a).equals(image)).toBe(true);
    expect(a.content.equals(b.content)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
    expect(a.content.includes(image.subarray(0, 32))).toBe(false);
    expect(parseEnvelope(a.wrappedDek).keyId).toBe('evidence_kek.v1');
    expect(parseEnvelope(a.content).keyId).toBe('evidence_dek.v1');
  });

  it('fails closed when content or the wrapped DEK is moved to another object, swapped or tampered with', () => {
    const id = randomUUID();
    const other = randomUUID();
    const sealed = sealEvidence(cipher, id, image);
    const sealedOther = sealEvidence(cipher, other, image);
    expect(reason(() => openEvidence(cipher, other, sealed))).toBe('AUTHENTICATION_FAILED');
    expect(reason(() => openEvidence(cipher, id, { wrappedDek: sealed.wrappedDek, content: sealedOther.content }))).toBe('AUTHENTICATION_FAILED');
    const flipped = Buffer.from(sealed.content);
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 1;
    expect(reason(() => openEvidence(cipher, id, { ...sealed, content: flipped }))).toBe('AUTHENTICATION_FAILED');
    const otherKek = new FieldCipher(localKeyRing('another-synthetic-seed-0123456789abcdef'));
    expect(reason(() => openEvidence(otherKek, id, sealed))).toBe('AUTHENTICATION_FAILED');
  });

  it('a retired evidence KEK can no longer open evidence (rotation re-wraps DEKs before retiring)', () => {
    const id = randomUUID();
    const sealed = sealEvidence(cipher, id, image);
    const retired = new FieldCipher(localKeyRing(SEED, 'evidence_kek.v1=RETIRED,evidence_kek.v2=ACTIVE'));
    expect(reason(() => openEvidence(retired, id, sealed))).toBe('KEY_RETIRED');
  });
});
