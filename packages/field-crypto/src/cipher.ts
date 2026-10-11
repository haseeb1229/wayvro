/**
 * Field cipher and keyed digests over a KeyRing (data model §8). The only entry points application code uses.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { openWithRing, parseEnvelope, sealWithKey, type FieldContext } from './envelope.js';
import type { KeyRing } from './keyring.js';

/** Key classes (P2.1 + later micro-phases, additive). Lookup and MAC keys are independent keys, never derived from encryption keys. */
export const KEY_CLASSES = {
  /** phone numbers (P-CONTACT) */
  contact: 'contact',
  /** deterministic phone lookups (HMAC-SHA-256) */
  phoneLookup: 'phone_lookup',
  /** OTP code MACs */
  otpMac: 'otp_mac',
  /** cached idempotent responses (they may contain tokens) */
  idempotencyResponses: 'idempotency_responses',
  /** transient sealed job payloads (an OTP message in flight) */
  jobSecrets: 'job_secrets',
  /** keyed digests of abuse-control dimensions (client IP prefixes, installations) in rate-limit keys and challenges */
  riskSignals: 'risk_signals',
  /** dates of birth (P-IDENTITY-NUMBERS; only when an approved policy requires one, or a driver applicant's claim) */
  identityDates: 'identity_dates',
  /** CNIC, licence, registration and document numbers, legal names (P-IDENTITY-NUMBERS) */
  identityNumbers: 'identity_numbers',
  /** deterministic CNIC lookups (HMAC; matches are duplicate signals, never rejections) */
  cnicLookup: 'cnic_lookup',
  /** deterministic document-number lookups (HMAC; duplicate signals) */
  documentLookup: 'document_lookup',
  /** key-encryption key wrapping the per-object evidence data keys (ADR-041 §2.4; KMS custody in production, EG-05) */
  evidenceKek: 'evidence_kek',
} as const;
export type KeyClass = (typeof KEY_CLASSES)[keyof typeof KEY_CLASSES];

/** Per-key encryption counters (nonce-safety rotation trigger at 2^30, data model §8.1). */
export type EncryptionCounter = (keyId: string) => void;

export class FieldCipher {
  constructor(
    private readonly ring: KeyRing,
    private readonly countEncryption: EncryptionCounter = () => undefined,
  ) {}

  /** Encrypts with the ACTIVE key of `keyClass`. */
  encrypt(keyClass: KeyClass, plaintext: string | Uint8Array, ctx: FieldContext): Buffer {
    const key = this.ring.active(keyClass);
    const out = sealWithKey(key, typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext, ctx);
    this.countEncryption(key.id);
    return out;
  }

  /** Decrypts with the key named in the envelope (ACTIVE or DECRYPT_ONLY of `keyClass`); fails closed otherwise. */
  decrypt(keyClass: KeyClass, envelope: Uint8Array, ctx: FieldContext): Buffer {
    return openWithRing(this.ring, envelope, ctx, keyClass);
  }

  decryptString(keyClass: KeyClass, envelope: Uint8Array, ctx: FieldContext): string {
    return this.decrypt(keyClass, envelope, ctx).toString('utf8');
  }

  /** The envelope was written with a key other than the class's ACTIVE key (re-encryption candidate). */
  isStale(keyClass: KeyClass, envelope: Uint8Array): boolean {
    return parseEnvelope(envelope).keyId !== this.ring.active(keyClass).id;
  }
}

export interface KeyedDigest {
  readonly version: number;
  readonly digest: Buffer;
}

/** HMAC-SHA-256 with lookup/MAC keys of one class, by version. */
export class KeyedHasher {
  constructor(private readonly ring: KeyRing) {}

  /** Digest under the ACTIVE key (new MACs, primary lookup value). */
  active(keyClass: KeyClass, data: string | Uint8Array): KeyedDigest {
    const key = this.ring.active(keyClass);
    return { version: key.version, digest: createHmac('sha256', key.material).update(data).digest() };
  }

  /** Digest under every live (non-retired) version, newest first — the dual-write/dual-read set during rotation. */
  live(keyClass: KeyClass, data: string | Uint8Array): readonly KeyedDigest[] {
    return this.ring.live(keyClass).map((k) => ({ version: k.version, digest: createHmac('sha256', k.material).update(data).digest() }));
  }

  /** Digest under one exact version, or `undefined` when that version is unknown or RETIRED. */
  at(keyClass: KeyClass, version: number, data: string | Uint8Array): Buffer | undefined {
    const key = this.ring.version(keyClass, version);
    return key ? createHmac('sha256', key.material).update(data).digest() : undefined;
  }

  /** Constant-time verification of a stored MAC; false for unknown/retired versions or length mismatch. */
  verify(keyClass: KeyClass, version: number, data: string | Uint8Array, expected: Uint8Array): boolean {
    const actual = this.at(keyClass, version, data);
    if (!actual || actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}
