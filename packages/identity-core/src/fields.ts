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
  /** ISO-8601 calendar date (YYYY-MM-DD). */
  ageDeclarationDob: { field: 'identity.age_declarations.dob_envelope', fieldSchemaVersion: 1, keyClass: 'identity_dates' },
  /** Driver/Partner applicant CLAIMS (P2.5) and reviewer-confirmed profile values (P2.7). */
  applicationLegalName: { field: 'compliance.driver_applications.legal_name_envelope', fieldSchemaVersion: 1, keyClass: 'identity_numbers' },
  /** canonical #####-#######-# */
  applicationCnic: { field: 'compliance.driver_applications.cnic_envelope', fieldSchemaVersion: 1, keyClass: 'identity_numbers' },
  applicationDob: { field: 'compliance.driver_applications.date_of_birth_envelope', fieldSchemaVersion: 1, keyClass: 'identity_dates' },
  profileLegalName: { field: 'compliance.driver_profiles.verified_legal_name_envelope', fieldSchemaVersion: 1, keyClass: 'identity_numbers' },
  profileDob: { field: 'compliance.driver_profiles.verified_date_of_birth_envelope', fieldSchemaVersion: 1, keyClass: 'identity_dates' },
  vehicleRegistrationNo: { field: 'compliance.vehicles.registration_no_envelope', fieldSchemaVersion: 1, keyClass: 'identity_numbers' },
  documentNumber: { field: 'compliance.compliance_documents.number_envelope', fieldSchemaVersion: 1, keyClass: 'identity_numbers' },
  /** appellant's free-text statement (P2.7) */
  appealStatement: { field: 'profile.appeals.statement_envelope', fieldSchemaVersion: 1, keyClass: 'appeal_statements' },
} as const;

export type EncryptedField = (typeof ENCRYPTED_FIELDS)[keyof typeof ENCRYPTED_FIELDS];

export function fieldContext(spec: EncryptedField, rowId: string): FieldContext {
  return { field: spec.field, rowId, fieldSchemaVersion: spec.fieldSchemaVersion };
}

/** The rotation target name of the phone lookup index (platform.key_rotations.target). */
export const PHONE_LOOKUP_TARGET = 'identity.phone_lookup_index.lookup_hash';
