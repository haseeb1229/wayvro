-- wayvro-migration: 0005_vault
-- compatibility: additive (expand) — new NOLOGIN role wayvro_vault, new schema `vault`, new table compliance.capture_challenges, two nullable columns + rebuilt signal CHECKs/unique index on compliance.duplicate_signals (every existing row satisfies the widened rules); safe with every P2.1–P2.5 application version (none reads these objects)
-- data-impact: none — no data is moved or rewritten; tables start empty. Evidence BYTES never enter the database (object storage only, envelope-encrypted); rows hold opaque storage keys, hashes and wrapped data keys. Synthetic data only until the Phase 7 gates
-- rollback: before any real data exists (pre-Phase 7): DROP SCHEMA vault CASCADE; DROP TABLE compliance.capture_challenges; drop the two duplicate_signals columns and restore the 0004 CHECKs + unique index; drop role wayvro_vault if no other database uses it. Afterwards: forward-fix only (evidence objects in storage must be reconciled with their rows first)
-- verification: packages/db/test/vault.integration.test.ts — clean->latest, every previous->latest, re-run 0, status/key/selfie-source CHECKs, append-only access log, one-time view-token CHECKs, EVIDENCE_HASH_MATCH CHECK, and grants as restricted roles (wayvro_api and wayvro_worker have NO privilege on vault.*)

-- Evidence-vault group role (data model §2): DML on vault.* plus the minimal compliance columns needed to authorise.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wayvro_vault') THEN
    BEGIN
      CREATE ROLE wayvro_vault NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    EXCEPTION
      WHEN duplicate_object OR unique_violation THEN
        RAISE NOTICE 'role wayvro_vault was created concurrently by another migration';
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wayvro_vault' AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'group role wayvro_vault must be NOLOGIN, NOSUPERUSER and NOBYPASSRLS';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO wayvro_vault', current_database());
END
$roles$;

SET LOCAL ROLE wayvro_migrator;

-- ── compliance: optional, accessible selfie capture challenge (KYC doc §2.2; never "liveness") ─────────────────────
CREATE TABLE compliance.capture_challenges (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES compliance.driver_applications (id),
  challenge_code text NOT NULL CHECK (challenge_code IN ('SMILE', 'NEUTRAL_EXPRESSION', 'TURN_HEAD_LEFT', 'TURN_HEAD_RIGHT', 'LOOK_UP', 'RAISE_EITHER_HAND')),
  status text NOT NULL CHECK (status IN ('ISSUED', 'USED', 'REPLACED', 'DECLINED_ACCESSIBILITY', 'EXPIRED')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_by_evidence_id uuid NULL,
  CHECK (expires_at > issued_at),
  CHECK ((status = 'USED') = (used_by_evidence_id IS NOT NULL))
);
-- at most one live challenge per application (a replacement retires the previous one first)
CREATE UNIQUE INDEX capture_challenges_one_live ON compliance.capture_challenges (application_id) WHERE status = 'ISSUED';

-- ── vault ──────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA vault;

-- One row per evidence object. `capture_source` is CLIENT-DECLARED metadata, never proof of authenticity; the selfie
-- kind accepts only the in-app camera source (a UX/integrity aid, not a security proof — KYC doc §2.1).
CREATE TABLE vault.evidence_objects (
  id uuid PRIMARY KEY,
  owner_account_id uuid NOT NULL REFERENCES identity.accounts (id),
  driver_application_id uuid NOT NULL REFERENCES compliance.driver_applications (id),
  compliance_document_id uuid NOT NULL REFERENCES compliance.compliance_documents (id),
  kind text NOT NULL CHECK (kind IN ('CNIC_FRONT', 'CNIC_BACK', 'SELFIE_FOR_MANUAL_REVIEW', 'LICENCE_FRONT', 'LICENCE_BACK', 'DOCUMENT_PAGE')),
  capture_source text NOT NULL CHECK (capture_source IN ('IN_APP_CAMERA', 'GALLERY_IMPORT', 'FILE_IMPORT')),
  declared_mime text NOT NULL CHECK (declared_mime IN ('image/jpeg', 'image/png')),
  declared_byte_size integer NOT NULL CHECK (declared_byte_size BETWEEN 1 AND 10485760),
  status text NOT NULL CHECK (status IN ('SLOT_ISSUED', 'UPLOADED', 'AVAILABLE', 'REJECTED_FORMAT', 'REJECTED_MALWARE', 'REJECTED_LIMITS', 'EXPIRED', 'DISCARDED')),
  rejection_reason text NULL CHECK (rejection_reason IN ('UNSUPPORTED_FORMAT', 'UNREADABLE', 'TOO_LARGE', 'LIMITS', 'MALWARE')),
  -- opaque 128-bit random storage keys; never returned by any API and never stored outside `vault`
  quarantine_key text NOT NULL UNIQUE CHECK (quarantine_key ~ '^q/[0-9a-f]{32}$'),
  vault_key text NULL UNIQUE CHECK (vault_key ~ '^v/[0-9a-f]{32}$'),
  slot_expires_at timestamptz NOT NULL,
  source_byte_size integer NULL CHECK (source_byte_size BETWEEN 1 AND 10485760),
  source_sha256 bytea NULL CHECK (octet_length(source_sha256) = 32),
  canonical_sha256 bytea NULL CHECK (octet_length(canonical_sha256) = 32),
  canonical_format text NULL CHECK (canonical_format IN ('JPEG', 'PNG')),
  canonical_byte_size integer NULL CHECK (canonical_byte_size > 0),
  pixel_width integer NULL CHECK (pixel_width BETWEEN 1 AND 2560),
  pixel_height integer NULL CHECK (pixel_height BETWEEN 1 AND 2560),
  -- per-object 256-bit DEK wrapped by the evidence KEK (field envelope v1); the content envelope format version
  wrapped_dek bytea NULL CHECK (octet_length(wrapped_dek) > 31),
  content_envelope_version smallint NULL CHECK (content_envelope_version = 1),
  -- retention placeholder (EG-16) and legal hold (deletion blockers, P2.9)
  retention_until timestamptz NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz NULL,
  processed_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (kind <> 'SELFIE_FOR_MANUAL_REVIEW' OR capture_source = 'IN_APP_CAMERA'),
  CHECK (slot_expires_at > created_at),
  -- AVAILABLE ⇔ the sanitised, encrypted object and all of its facts exist
  CHECK (
    (status = 'AVAILABLE') = (vault_key IS NOT NULL AND wrapped_dek IS NOT NULL AND canonical_sha256 IS NOT NULL AND canonical_format IS NOT NULL
      AND canonical_byte_size IS NOT NULL AND pixel_width IS NOT NULL AND pixel_height IS NOT NULL AND content_envelope_version IS NOT NULL)
  ),
  CHECK ((status IN ('REJECTED_FORMAT', 'REJECTED_MALWARE', 'REJECTED_LIMITS')) = (rejection_reason IS NOT NULL)),
  CHECK (status IN ('SLOT_ISSUED', 'EXPIRED') OR uploaded_at IS NOT NULL OR status = 'DISCARDED'),
  CHECK (status NOT IN ('AVAILABLE', 'REJECTED_FORMAT', 'REJECTED_MALWARE', 'REJECTED_LIMITS') OR processed_at IS NOT NULL),
  CHECK (status <> 'AVAILABLE' OR (source_sha256 IS NOT NULL AND source_byte_size IS NOT NULL))
);
CREATE INDEX evidence_objects_application ON vault.evidence_objects (driver_application_id);
CREATE INDEX evidence_objects_document ON vault.evidence_objects (compliance_document_id);
CREATE INDEX evidence_objects_open_slots ON vault.evidence_objects (slot_expires_at) WHERE status = 'SLOT_ISSUED';
CREATE INDEX evidence_objects_source_hash ON vault.evidence_objects (source_sha256) WHERE source_sha256 IS NOT NULL;
CREATE INDEX evidence_objects_canonical_hash ON vault.evidence_objects (canonical_sha256) WHERE canonical_sha256 IS NOT NULL;

ALTER TABLE compliance.capture_challenges ADD CONSTRAINT capture_challenges_used_by_evidence_fk
  FOREIGN KEY (used_by_evidence_id) REFERENCES vault.evidence_objects (id);

-- One-time staff evidence views (H02/W07/K11): token stored as SHA-256 only, bound to the staff session, ≤ 60 s.
CREATE TABLE vault.evidence_view_tokens (
  id uuid PRIMARY KEY,
  token_sha256 bytea NOT NULL UNIQUE CHECK (octet_length(token_sha256) = 32),
  evidence_object_id uuid NOT NULL REFERENCES vault.evidence_objects (id),
  staff_account_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  staff_session_id uuid NOT NULL REFERENCES staff.sessions (id),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '60 seconds'),
  CHECK (used_at IS NULL OR used_at >= created_at)
);

-- Append-only record of every evidence view (and refused attempt); never updated or deleted, even by the owner.
CREATE TABLE vault.evidence_access_log (
  id uuid PRIMARY KEY,
  evidence_object_id uuid NOT NULL REFERENCES vault.evidence_objects (id),
  staff_account_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  staff_session_id uuid NOT NULL REFERENCES staff.sessions (id),
  view_token_id uuid NULL REFERENCES vault.evidence_view_tokens (id),
  event text NOT NULL CHECK (event IN ('VIEW_TOKEN_ISSUED', 'CONTENT_STREAMED', 'TOKEN_REPLAY_REFUSED', 'INTEGRITY_FAILURE')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  break_glass_grant_id uuid NULL REFERENCES staff.break_glass_grants (id),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_access_log_object ON vault.evidence_access_log (evidence_object_id, at);
CREATE INDEX evidence_access_log_staff ON vault.evidence_access_log (staff_account_id, at);
CREATE TRIGGER evidence_access_log_append_only BEFORE UPDATE OR DELETE ON vault.evidence_access_log FOR EACH ROW EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER evidence_access_log_no_truncate BEFORE TRUNCATE ON vault.evidence_access_log FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

-- ── compliance: exact-replay evidence signal (AB-04; a SIGNAL for human review, never a rejection) ───────────────
ALTER TABLE compliance.duplicate_signals ADD COLUMN subject_evidence_id uuid NULL REFERENCES vault.evidence_objects (id);
ALTER TABLE compliance.duplicate_signals ADD COLUMN matched_evidence_id uuid NULL REFERENCES vault.evidence_objects (id);
ALTER TABLE compliance.duplicate_signals DROP CONSTRAINT duplicate_signals_signal_check;
ALTER TABLE compliance.duplicate_signals ADD CONSTRAINT duplicate_signals_signal_check
  CHECK (signal IN ('CNIC_HASH_MATCH', 'DOCUMENT_NUMBER_MATCH', 'PLATE_ALREADY_AFFILIATED', 'EVIDENCE_HASH_MATCH'));
ALTER TABLE compliance.duplicate_signals DROP CONSTRAINT duplicate_signals_check1;
ALTER TABLE compliance.duplicate_signals ADD CONSTRAINT duplicate_signals_subjects_check CHECK (
  (signal = 'CNIC_HASH_MATCH' AND subject_application_id IS NOT NULL AND (matched_application_id IS NOT NULL OR matched_profile_id IS NOT NULL)
    AND subject_document_id IS NULL AND subject_vehicle_id IS NULL AND matched_document_id IS NULL
    AND subject_evidence_id IS NULL AND matched_evidence_id IS NULL)
  OR (signal = 'DOCUMENT_NUMBER_MATCH' AND subject_document_id IS NOT NULL AND matched_document_id IS NOT NULL AND subject_vehicle_id IS NULL
    AND subject_evidence_id IS NULL AND matched_evidence_id IS NULL)
  OR (signal = 'PLATE_ALREADY_AFFILIATED' AND subject_application_id IS NOT NULL AND subject_vehicle_id IS NOT NULL AND matched_account_id IS NOT NULL
    AND subject_document_id IS NULL AND matched_document_id IS NULL AND subject_evidence_id IS NULL AND matched_evidence_id IS NULL)
  OR (signal = 'EVIDENCE_HASH_MATCH' AND subject_application_id IS NOT NULL AND subject_evidence_id IS NOT NULL AND matched_evidence_id IS NOT NULL
    AND matched_application_id IS NOT NULL AND subject_evidence_id <> matched_evidence_id
    AND subject_document_id IS NULL AND matched_document_id IS NULL AND subject_vehicle_id IS NULL)
);
DROP INDEX compliance.duplicate_signals_once;
CREATE UNIQUE INDEX duplicate_signals_once ON compliance.duplicate_signals (signal, subject_application_id, subject_document_id, subject_vehicle_id,
  subject_evidence_id, matched_application_id, matched_profile_id, matched_document_id, matched_account_id, matched_evidence_id) NULLS NOT DISTINCT;

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
-- API (wayvro_api): capture challenges only. NO privilege on schema `vault` (a defect outside the vault module cannot
-- read evidence metadata, keys or wrapped DEKs).
GRANT SELECT, INSERT, UPDATE ON compliance.capture_challenges TO wayvro_api;

-- Vault (wayvro_vault): the vault module of the API and the evidence jobs of the worker connect as members.
GRANT USAGE ON SCHEMA vault, compliance, platform, audit TO wayvro_vault;
GRANT SELECT, INSERT, UPDATE ON vault.evidence_objects, vault.evidence_view_tokens TO wayvro_vault;
GRANT SELECT, INSERT ON vault.evidence_access_log TO wayvro_vault;
GRANT SELECT (id, account_id, state, city_code) ON compliance.driver_applications TO wayvro_vault;
GRANT SELECT (id, driver_application_id, document_type_code, status) ON compliance.compliance_documents TO wayvro_vault;
GRANT SELECT (code, evidence_kinds) ON compliance.document_types TO wayvro_vault;
GRANT SELECT (id, application_id, status, expires_at), UPDATE (status, used_by_evidence_id) ON compliance.capture_challenges TO wayvro_vault;
GRANT INSERT ON compliance.duplicate_signals TO wayvro_vault;
-- transactional enqueue of evidence jobs (INSERT-only, like the API) and audit rows
GRANT INSERT ON platform.jobs TO wayvro_vault;
GRANT INSERT ON audit.audit_events TO wayvro_vault;

RESET ROLE;
