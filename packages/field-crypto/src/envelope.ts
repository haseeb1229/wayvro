/**
 * Versioned field-encryption envelope, format v1 (data model §8.1; founder decision Q-05). Standard primitives from
 * `node:crypto` only — AES-256-GCM with a fresh random 96-bit nonce per encryption and a 128-bit tag. No custom
 * primitive, mode or KDF.
 *
 *   offset 0      format_version  1 byte   0x01
 *   offset 1      algorithm_id    1 byte   0x01 = AES-256-GCM / 96-bit nonce / 128-bit tag
 *   offset 2      key_id_length   1 byte   1..64
 *   offset 3      key_id          n bytes  ASCII "<class>.v<version>"
 *   offset 3+n    nonce           12 bytes crypto.randomBytes(12) for EVERY encryption; never derived, counted or reused
 *   offset 15+n   tag             16 bytes
 *   offset 31+n   ciphertext      rest
 *
 * AAD (authenticated, not stored): "wayvro|env=v1|field=<schema.table.column>|row=<row uuid>|fschema=<n>|key=<key id>",
 * so an envelope copied to another row, column or field-schema version fails authentication. Every failure is a typed
 * FieldDecryptionError: there is no fallback to plaintext, no "try every key" and no partial result.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { parseKeyId, type KeyEntry, type KeyRing } from './keyring.js';

export const ENVELOPE_FORMAT_V1 = 0x01;
export const ALGORITHM_AES_256_GCM = 0x01;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface FieldContext {
  /** `<schema>.<table>.<column>` of the encrypted column. */
  readonly field: string;
  /** Primary key (UUID) of the row that owns the value. */
  readonly rowId: string;
  /** Version of the plaintext's canonical form/semantics for this field. */
  readonly fieldSchemaVersion: number;
}

export type DecryptionFailure =
  'UNKNOWN_FORMAT' | 'UNKNOWN_ALGORITHM' | 'MALFORMED' | 'UNKNOWN_KEY' | 'KEY_RETIRED' | 'KEY_CLASS_MISMATCH' | 'AUTHENTICATION_FAILED';

export class FieldDecryptionError extends Error {
  override readonly name = 'FieldDecryptionError';
  constructor(readonly reason: DecryptionFailure) {
    super(`field decryption failed: ${reason}`);
  }
}

export class FieldEncryptionError extends Error {
  override readonly name = 'FieldEncryptionError';
}

const FIELD = /^[a-z][a-z_]*\.[a-z][a-z_]*\.[a-z][a-z_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function validateContext(ctx: FieldContext): void {
  if (!FIELD.test(ctx.field)) throw new FieldEncryptionError(`invalid field descriptor "${ctx.field}"`);
  if (!UUID.test(ctx.rowId)) throw new FieldEncryptionError('row id must be a lowercase UUID');
  if (!Number.isInteger(ctx.fieldSchemaVersion) || ctx.fieldSchemaVersion < 1 || ctx.fieldSchemaVersion > 255) {
    throw new FieldEncryptionError('field schema version must be 1..255');
  }
}

function associatedData(ctx: FieldContext, keyId: string): Buffer {
  return Buffer.from(`wayvro|env=v1|field=${ctx.field}|row=${ctx.rowId}|fschema=${String(ctx.fieldSchemaVersion)}|key=${keyId}`, 'utf8');
}

export interface ParsedEnvelope {
  readonly keyId: string;
  readonly nonce: Buffer;
  readonly tag: Buffer;
  readonly ciphertext: Buffer;
}

/** Structural parse only (no key, no authentication). Every malformed input yields a typed error. */
export function parseEnvelope(envelope: Uint8Array): ParsedEnvelope {
  const buf = Buffer.from(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  if (buf.length < 3) throw new FieldDecryptionError('MALFORMED');
  if (buf[0] !== ENVELOPE_FORMAT_V1) throw new FieldDecryptionError('UNKNOWN_FORMAT');
  if (buf[1] !== ALGORITHM_AES_256_GCM) throw new FieldDecryptionError('UNKNOWN_ALGORITHM');
  const idLength = buf[2] ?? 0;
  if (idLength < 1 || idLength > 64 || buf.length < 3 + idLength + NONCE_BYTES + TAG_BYTES) throw new FieldDecryptionError('MALFORMED');
  const keyIdBytes = buf.subarray(3, 3 + idLength);
  if (!keyIdBytes.every((b) => b >= 0x21 && b <= 0x7e)) throw new FieldDecryptionError('MALFORMED');
  const keyId = keyIdBytes.toString('ascii');
  try {
    parseKeyId(keyId);
  } catch {
    throw new FieldDecryptionError('MALFORMED');
  }
  const nonceAt = 3 + idLength;
  return {
    keyId,
    nonce: buf.subarray(nonceAt, nonceAt + NONCE_BYTES),
    tag: buf.subarray(nonceAt + NONCE_BYTES, nonceAt + NONCE_BYTES + TAG_BYTES),
    ciphertext: buf.subarray(nonceAt + NONCE_BYTES + TAG_BYTES),
  };
}

export function sealWithKey(key: KeyEntry, plaintext: Uint8Array, ctx: FieldContext): Buffer {
  validateContext(ctx);
  const idBytes = Buffer.from(key.id, 'ascii');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key.material, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(associatedData(ctx, key.id));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([ENVELOPE_FORMAT_V1, ALGORITHM_AES_256_GCM, idBytes.length]), idBytes, nonce, cipher.getAuthTag(), ciphertext]);
}

export function openWithRing(ring: KeyRing, envelope: Uint8Array, ctx: FieldContext, expectedKeyClass: string): Buffer {
  validateContext(ctx);
  const parsed = parseEnvelope(envelope);
  if (parseKeyId(parsed.keyId).keyClass !== expectedKeyClass) throw new FieldDecryptionError('KEY_CLASS_MISMATCH');
  const key = ring.usable(parsed.keyId);
  if (!key) throw new FieldDecryptionError(ring.isRetired(parsed.keyId) ? 'KEY_RETIRED' : 'UNKNOWN_KEY');
  const decipher = createDecipheriv('aes-256-gcm', key.material, parsed.nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(associatedData(ctx, key.id));
  decipher.setAuthTag(parsed.tag);
  try {
    return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
  } catch {
    throw new FieldDecryptionError('AUTHENTICATION_FAILED');
  }
}
