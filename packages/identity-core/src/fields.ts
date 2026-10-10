/**
 * Encrypted columns of the identity core and their AAD descriptors (data model §8.1). The field-schema version changes
 * only if the canonical plaintext form of a column changes.
 */
import type { FieldContext } from '@wayvro/field-crypto';

export const ENCRYPTED_FIELDS = {
  accountPhone: { field: 'identity.account_phones.phone_envelope', fieldSchemaVersion: 1, keyClass: 'contact' },
  challengePhone: { field: 'identity.otp_challenges.phone_envelope', fieldSchemaVersion: 1, keyClass: 'contact' },
  jobSecret: { field: 'platform.jobs.sealed_payload', fieldSchemaVersion: 1, keyClass: 'job_secrets' },
  idempotencyResponse: { field: 'platform.idempotency_records.response_envelope', fieldSchemaVersion: 1, keyClass: 'idempotency_responses' },
} as const;

export type EncryptedField = (typeof ENCRYPTED_FIELDS)[keyof typeof ENCRYPTED_FIELDS];

export function fieldContext(spec: EncryptedField, rowId: string): FieldContext {
  return { field: spec.field, rowId, fieldSchemaVersion: spec.fieldSchemaVersion };
}

/** The rotation target name of the phone lookup index (platform.key_rotations.target). */
export const PHONE_LOOKUP_TARGET = 'identity.phone_lookup_index.lookup_hash';
