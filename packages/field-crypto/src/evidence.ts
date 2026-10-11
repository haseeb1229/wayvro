/**
 * Evidence-object encryption (KYC doc §6, ADR-041 §2.4): a fresh 256-bit data key (DEK) per object seals the canonical
 * bytes in the field-envelope v1 format (AES-256-GCM, random 96-bit nonce, AAD bound to the object id), and the DEK
 * itself is sealed ("wrapped") under the ACTIVE `evidence_kek` key with AAD bound to the same object id. Rotating the
 * KEK re-wraps DEKs only. A content envelope or wrapped DEK copied to another object fails authentication. DEK bytes
 * are zeroed after use (best effort in a garbage-collected runtime).
 */
import { randomBytes } from 'node:crypto';
import type { FieldCipher } from './cipher.js';
import { openWithRing, sealWithKey, type FieldContext } from './envelope.js';
import { KeyRing } from './keyring.js';

export const EVIDENCE_CONTENT_ENVELOPE_VERSION = 1;
const DEK_KEY_ID = 'evidence_dek.v1';

const contentContext = (objectId: string): FieldContext => ({ field: 'vault.evidence_objects.content', rowId: objectId, fieldSchemaVersion: 1 });
const dekContext = (objectId: string): FieldContext => ({ field: 'vault.evidence_objects.wrapped_dek', rowId: objectId, fieldSchemaVersion: 1 });

export interface SealedEvidence {
  readonly wrappedDek: Buffer;
  readonly content: Buffer;
}

export function sealEvidence(cipher: FieldCipher, objectId: string, plaintext: Uint8Array): SealedEvidence {
  const dek = randomBytes(32);
  try {
    const content = sealWithKey({ id: DEK_KEY_ID, keyClass: 'evidence_dek', version: 1, state: 'ACTIVE', material: dek }, plaintext, contentContext(objectId));
    return { wrappedDek: cipher.encrypt('evidence_kek', dek, dekContext(objectId)), content };
  } finally {
    dek.fill(0);
  }
}

/** Throws FieldDecryptionError on any mismatch (wrong object, tampered envelope, unknown or retired KEK). */
export function openEvidence(cipher: FieldCipher, objectId: string, sealed: SealedEvidence): Buffer {
  const dek = cipher.decrypt('evidence_kek', sealed.wrappedDek, dekContext(objectId));
  try {
    const ring = new KeyRing([{ id: DEK_KEY_ID, keyClass: 'evidence_dek', version: 1, state: 'ACTIVE', material: dek }]);
    return openWithRing(ring, sealed.content, contentContext(objectId), 'evidence_dek');
  } finally {
    dek.fill(0);
  }
}
