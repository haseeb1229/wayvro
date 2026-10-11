-- wayvro-migration: 0004_compliance_core
-- compatibility: additive (expand) — new schema `compliance`, new catalog/profile tables, two additive columns + two widened CHECKs on legal.age_eligibility_policies (maker-checker data entry), a replaced guard function on that table; every existing row satisfies the new rules; safe with every P2.1–P2.4 application version
-- data-impact: seeds reference data only: Lahore district, three service categories (bike/rickshaw DISABLED_LEGAL_GATE), document types and ONE placeholder requirement set LHR/CAR v0 (is_placeholder, source "PHASE0_LAUNCH_BLOCKERS B2–B7, unconfirmed" — NOT Punjab law; EG-03/EG-04). No age threshold is seeded. Synthetic data only until the Phase 7 gates
-- rollback: before any real data exists (pre-Phase 7): DROP SCHEMA compliance CASCADE; DROP TABLE profile.restriction_events, profile.restrictions; DROP TABLE catalog.districts, catalog.service_categories; restore the 0002 age-policy guard and CHECKs. Afterwards: forward-fix only
-- verification: packages/db/test/compliance-core.integration.test.ts — clean->latest, every previous->latest, re-run 0, per-scope/per-signal/per-subject CHECKs, one non-terminal application per account, one live vehicle per plate, maker-checker CHECKs, grants as restricted roles

SET LOCAL ROLE wayvro_migrator;

-- ── catalog additions (Phase 3 extends additively; geometry later) ───────────────────────────────────────────────
CREATE TABLE catalog.districts (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{3}-[A-Z0-9]{2,12}$'),
  city_code text NOT NULL REFERENCES catalog.cities (code),
  name_en text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 80),
  name_ur text NOT NULL CHECK (char_length(name_ur) BETWEEN 1 AND 80),
  status text NOT NULL CHECK (status IN ('ENABLED', 'DISABLED'))
);
INSERT INTO catalog.districts (code, city_code, name_en, name_ur, status) VALUES ('LHR-LAHORE', 'LHR', 'Lahore District', 'ضلع لاہور', 'ENABLED');

CREATE TABLE catalog.service_categories (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{2,20}$'),
  status text NOT NULL CHECK (status IN ('ENABLED', 'DISABLED_LEGAL_GATE'))
);
-- bike and rickshaw stay disabled behind the legal gate (FD-02/B15)
INSERT INTO catalog.service_categories (code, status) VALUES ('CAR', 'ENABLED'), ('BIKE', 'DISABLED_LEGAL_GATE'), ('RICKSHAW', 'DISABLED_LEGAL_GATE');

-- ── legal: maker-checker data entry of age-policy versions (A15) ────────────────────────────────────────────────
ALTER TABLE legal.age_eligibility_policies ADD COLUMN drafted_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id);
ALTER TABLE legal.age_eligibility_policies ADD COLUMN approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id);
ALTER TABLE legal.age_eligibility_policies DROP CONSTRAINT age_eligibility_policies_status_check;
ALTER TABLE legal.age_eligibility_policies ADD CONSTRAINT age_eligibility_policies_status_check
  CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'PLACEHOLDER_NOT_FOR_PRODUCTION', 'APPROVED', 'RETIRED'));
ALTER TABLE legal.age_eligibility_policies ADD CONSTRAINT age_eligibility_policies_maker_checker
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id IS DISTINCT FROM drafted_by_staff_id);
ALTER TABLE legal.age_eligibility_policies ADD CONSTRAINT age_eligibility_policies_staff_approval
  CHECK (drafted_by_staff_id IS NULL OR status IN ('DRAFT', 'PENDING_APPROVAL', 'RETIRED') OR approved_by_staff_id IS NOT NULL);

-- Values are immutable once entered; the only transitions are DRAFT -> PENDING_APPROVAL -> APPROVED (approver set,
-- different person) and {PLACEHOLDER, APPROVED, DRAFT, PENDING} -> RETIRED. No delete.
CREATE OR REPLACE FUNCTION legal.age_policy_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'legal.age_eligibility_policies rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.version, NEW.rider_declaration_mode, NEW.rider_minimum_age, NEW.driver_minimum_age, NEW.guardian_rules_ref,
      NEW.teen_programme_enabled, NEW.approval_ref, NEW.effective_at, NEW.created_at, NEW.drafted_by_staff_id)
     IS DISTINCT FROM
     (OLD.version, OLD.rider_declaration_mode, OLD.rider_minimum_age, OLD.driver_minimum_age, OLD.guardian_rules_ref,
      OLD.teen_programme_enabled, OLD.approval_ref, OLD.effective_at, OLD.created_at, OLD.drafted_by_staff_id) THEN
    RAISE EXCEPTION 'legal.age_eligibility_policies: policy values are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL' AND NEW.approved_by_staff_id IS NULL)
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED' AND NEW.approved_by_staff_id IS NOT NULL)
    OR (OLD.status <> 'RETIRED' AND NEW.status = 'RETIRED' AND NEW.approved_by_staff_id IS NOT DISTINCT FROM OLD.approved_by_staff_id)
  ) THEN
    RAISE EXCEPTION 'legal.age_eligibility_policies: transition % -> % not allowed', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;

-- ── compliance ──────────────────────────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA compliance;

-- Document catalogue (changed only through requirement-set governance). `evidence_kinds` is scalar configuration.
CREATE TABLE compliance.document_types (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  subject text NOT NULL CHECK (subject IN ('DRIVER', 'VEHICLE', 'DRIVER_VEHICLE')),
  has_expiry boolean NOT NULL,
  has_number boolean NOT NULL,
  per_district boolean NOT NULL DEFAULT false,
  evidence_kinds text[] NOT NULL CHECK (cardinality(evidence_kinds) BETWEEN 1 AND 4),
  retention_class text NOT NULL CHECK (retention_class IN ('IDENTITY_EVIDENCE', 'VEHICLE_EVIDENCE')),
  name_en text NOT NULL,
  UNIQUE (code, subject),
  CHECK (NOT per_district OR subject = 'VEHICLE')
);
INSERT INTO compliance.document_types (code, subject, has_expiry, has_number, per_district, evidence_kinds, retention_class, name_en) VALUES
  ('CNIC', 'DRIVER', true, true, false, ARRAY['CNIC_FRONT', 'CNIC_BACK'], 'IDENTITY_EVIDENCE', 'Computerised National Identity Card'),
  ('SELFIE', 'DRIVER', false, false, false, ARRAY['SELFIE_FOR_MANUAL_REVIEW'], 'IDENTITY_EVIDENCE', 'Selfie for manual review'),
  ('DRIVING_LICENCE', 'DRIVER', true, true, false, ARRAY['LICENCE_FRONT', 'LICENCE_BACK'], 'IDENTITY_EVIDENCE', 'Driving licence'),
  ('POLICE_CHARACTER_CERTIFICATE', 'DRIVER', true, true, false, ARRAY['DOCUMENT_PAGE'], 'IDENTITY_EVIDENCE', 'Police character certificate'),
  ('VEHICLE_REGISTRATION', 'VEHICLE', false, true, false, ARRAY['DOCUMENT_PAGE'], 'VEHICLE_EVIDENCE', 'Vehicle registration'),
  ('ROUTE_PERMIT', 'VEHICLE', true, true, true, ARRAY['DOCUMENT_PAGE'], 'VEHICLE_EVIDENCE', 'Route permit (per district)'),
  ('FITNESS_CERTIFICATE', 'VEHICLE', true, true, false, ARRAY['DOCUMENT_PAGE'], 'VEHICLE_EVIDENCE', 'Vehicle fitness certificate'),
  ('THIRD_PARTY_INSURANCE', 'VEHICLE', true, true, false, ARRAY['DOCUMENT_PAGE'], 'VEHICLE_EVIDENCE', 'Third-party insurance'),
  ('TOKEN_TAX', 'VEHICLE', true, false, false, ARRAY['DOCUMENT_PAGE'], 'VEHICLE_EVIDENCE', 'Token tax'),
  ('PANIC_BUTTON_REGISTRATION', 'VEHICLE', false, true, false, ARRAY['DOCUMENT_PAGE'], 'VEHICLE_EVIDENCE', 'Panic-button device registration'),
  ('AUTHORISED_USE_LETTER', 'DRIVER_VEHICLE', true, false, false, ARRAY['DOCUMENT_PAGE'], 'VEHICLE_EVIDENCE', 'Owner authorisation to use the vehicle');

-- Requirement sets: configurable per city x category x ownership type (K06/R02–R06/R46). No per-driver override exists.
CREATE TABLE compliance.requirement_sets (
  id uuid PRIMARY KEY,
  city_code text NOT NULL REFERENCES catalog.cities (code),
  service_category text NOT NULL REFERENCES catalog.service_categories (code),
  version integer NOT NULL CHECK (version >= 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED')),
  is_placeholder boolean NOT NULL,
  source_reference text NOT NULL CHECK (char_length(source_reference) BETWEEN 3 AND 300),
  effective_from timestamptz NULL,
  effective_until timestamptz NULL,
  drafted_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1),
  UNIQUE (city_code, service_category, version),
  -- maker-checker: the approver never drafted the set
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id IS DISTINCT FROM drafted_by_staff_id),
  -- a staff-drafted set is approved by staff before it can be APPROVED/ACTIVE (the seeded placeholder has no drafter)
  CHECK (drafted_by_staff_id IS NULL OR status IN ('DRAFT', 'PENDING_APPROVAL', 'RETIRED') OR approved_by_staff_id IS NOT NULL),
  CHECK ((status = 'ACTIVE') <= (effective_from IS NOT NULL))
);
CREATE UNIQUE INDEX requirement_sets_one_active ON compliance.requirement_sets (city_code, service_category) WHERE status = 'ACTIVE';

CREATE TABLE compliance.requirement_set_items (
  requirement_set_id uuid NOT NULL REFERENCES compliance.requirement_sets (id),
  document_type_code text NOT NULL REFERENCES compliance.document_types (code),
  mandatory boolean NOT NULL,
  min_validity_days_at_submission integer NOT NULL DEFAULT 0 CHECK (min_validity_days_at_submission BETWEEN 0 AND 3650),
  renewal_lead_days integer NOT NULL DEFAULT 30 CHECK (renewal_lead_days BETWEEN 0 AND 365),
  applies_to_ownership_types text[] NOT NULL DEFAULT '{}',
  licence_classes_allowed text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (requirement_set_id, document_type_code)
);

-- Placeholder LHR/CAR v0 — NOT Punjab law: identity + licence + registration mandatory (needed for any manual review);
-- the Punjab artefacts (route permit per district, fitness, insurance, token tax, police certificate, panic button)
-- are listed as OPTIONAL items until the approved matrix exists (EG-03/EG-04, P2.A8). Production refuses placeholders.
INSERT INTO compliance.requirement_sets (id, city_code, service_category, version, status, is_placeholder, source_reference, effective_from)
VALUES ('00000000-0000-7000-8000-00000000c0a0', 'LHR', 'CAR', 0, 'ACTIVE', true, 'PHASE0_LAUNCH_BLOCKERS B2–B7, unconfirmed placeholder — not legal advice', '2026-10-10T00:00:00Z');
INSERT INTO compliance.requirement_set_items (requirement_set_id, document_type_code, mandatory, min_validity_days_at_submission, applies_to_ownership_types, licence_classes_allowed) VALUES
  ('00000000-0000-7000-8000-00000000c0a0', 'CNIC', true, 30, '{}', '{}'),
  ('00000000-0000-7000-8000-00000000c0a0', 'SELFIE', true, 0, '{}', '{}'),
  ('00000000-0000-7000-8000-00000000c0a0', 'DRIVING_LICENCE', true, 30, '{}', ARRAY['LTV']),
  ('00000000-0000-7000-8000-00000000c0a0', 'VEHICLE_REGISTRATION', true, 0, '{}', '{}'),
  ('00000000-0000-7000-8000-00000000c0a0', 'AUTHORISED_USE_LETTER', true, 0, ARRAY['OPEN_LETTER_UNTRANSFERRED', 'BANK_HYPOTHECATED', 'COMPANY_OWNED', 'FAMILY_OWNED', 'OTHER_AUTHORISED_USE'], '{}'),
  ('00000000-0000-7000-8000-00000000c0a0', 'ROUTE_PERMIT', false, 0, '{}', '{}'),
  ('00000000-0000-7000-8000-00000000c0a0', 'FITNESS_CERTIFICATE', false, 0, '{}', '{}'),
  ('00000000-0000-7000-8000-00000000c0a0', 'THIRD_PARTY_INSURANCE', false, 0, '{}', '{}'),
  ('00000000-0000-7000-8000-00000000c0a0', 'TOKEN_TAX', false, 0, '{}', '{}'),
  ('00000000-0000-7000-8000-00000000c0a0', 'POLICE_CHARACTER_CERTIFICATE', false, 0, '{}', '{}'),
  ('00000000-0000-7000-8000-00000000c0a0', 'PANIC_BUTTON_REGISTRATION', false, 0, '{}', '{}');

-- Driver/Partner applications (D04/K05 state machine; applicant fields are CLAIMS until a reviewer confirms them).
CREATE TABLE compliance.driver_applications (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  state text NOT NULL CHECK (state IN ('DRAFT', 'CONSENTED', 'DOCUMENTS_PENDING', 'SUBMITTED', 'AUTO_CHECK_PENDING', 'MANUAL_REVIEW', 'NEEDS_INFO',
    'REJECTED', 'APPEALED', 'REJECTED_FINAL', 'VERIFIED', 'WITHDRAWN', 'EXPIRED_DRAFT')),
  city_code text NOT NULL REFERENCES catalog.cities (code),
  -- AES-256-GCM envelopes (key classes identity_numbers / identity_dates / contact); last4 for masked display
  legal_name_envelope bytea NULL CHECK (legal_name_envelope IS NULL OR octet_length(legal_name_envelope) > 31),
  cnic_envelope bytea NULL CHECK (cnic_envelope IS NULL OR octet_length(cnic_envelope) > 31),
  cnic_last4 char(4) NULL CHECK (cnic_last4 IS NULL OR cnic_last4 ~ '^[0-9]{4}$'),
  date_of_birth_envelope bytea NULL CHECK (date_of_birth_envelope IS NULL OR octet_length(date_of_birth_envelope) > 31),
  requirement_set_id uuid NULL REFERENCES compliance.requirement_sets (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz NULL,
  decided_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ((cnic_envelope IS NULL) = (cnic_last4 IS NULL)),
  -- the requirement set is pinned at submission
  CHECK (state IN ('DRAFT', 'CONSENTED', 'DOCUMENTS_PENDING', 'WITHDRAWN', 'EXPIRED_DRAFT') OR (requirement_set_id IS NOT NULL AND submitted_at IS NOT NULL))
);
-- INVARIANT: at most one non-terminal application per account (DB-enforced; person-level uniqueness is NOT, §1).
CREATE UNIQUE INDEX driver_applications_one_open ON compliance.driver_applications (account_id)
  WHERE state NOT IN ('REJECTED_FINAL', 'VERIFIED', 'WITHDRAWN', 'EXPIRED_DRAFT');

CREATE TABLE compliance.application_service_categories (
  application_id uuid NOT NULL REFERENCES compliance.driver_applications (id),
  service_category text NOT NULL REFERENCES catalog.service_categories (code),
  PRIMARY KEY (application_id, service_category)
);

CREATE TABLE compliance.driver_profiles (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES identity.accounts (id),
  application_id uuid NOT NULL UNIQUE REFERENCES compliance.driver_applications (id),
  state text NOT NULL CHECK (state IN ('VERIFIED', 'ACTIVE_ELIGIBLE', 'EXPIRED', 'REVERIFY_DUE')),
  verified_legal_name_envelope bytea NOT NULL CHECK (octet_length(verified_legal_name_envelope) > 31),
  verified_date_of_birth_envelope bytea NOT NULL CHECK (octet_length(verified_date_of_birth_envelope) > 31),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- no gender column anywhere (CL-17); the profile id is never the account id
  CHECK (id <> account_id)
);

-- Versioned CNIC lookup (HMAC, key class cnic_lookup). NON-unique: a match is a duplicate SIGNAL, never a rejection.
CREATE TABLE compliance.cnic_lookup_index (
  id uuid PRIMARY KEY,
  subject_application_id uuid NULL REFERENCES compliance.driver_applications (id),
  subject_profile_id uuid NULL REFERENCES compliance.driver_profiles (id),
  lookup_key_version smallint NOT NULL CHECK (lookup_key_version > 0),
  lookup_hash bytea NOT NULL CHECK (octet_length(lookup_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((subject_application_id IS NULL) <> (subject_profile_id IS NULL))
);
CREATE INDEX cnic_lookup_hash ON compliance.cnic_lookup_index (lookup_key_version, lookup_hash);
CREATE UNIQUE INDEX cnic_lookup_one_per_application ON compliance.cnic_lookup_index (subject_application_id, lookup_key_version) WHERE subject_application_id IS NOT NULL;

CREATE TABLE compliance.vehicles (
  id uuid PRIMARY KEY,
  plate_normalised text NOT NULL CHECK (plate_normalised ~ '^[A-Z0-9]{2,12}$'),
  plate_display text NOT NULL CHECK (char_length(plate_display) BETWEEN 2 AND 16),
  registration_no_envelope bytea NULL CHECK (registration_no_envelope IS NULL OR octet_length(registration_no_envelope) > 31),
  make text NOT NULL CHECK (char_length(make) BETWEEN 1 AND 40),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 40),
  model_year smallint NOT NULL CHECK (model_year BETWEEN 1950 AND 2100),
  colour text NOT NULL CHECK (char_length(colour) BETWEEN 1 AND 30),
  service_category text NOT NULL REFERENCES catalog.service_categories (code),
  ownership_type text NOT NULL CHECK (ownership_type IN ('REGISTERED_OWNER', 'OPEN_LETTER_UNTRANSFERRED', 'BANK_HYPOTHECATED', 'COMPANY_OWNED', 'FAMILY_OWNED', 'OTHER_AUTHORISED_USE')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);
-- INVARIANT: one live vehicle record per plate; a second applicant becomes an affiliation + signal, never a duplicate.
CREATE UNIQUE INDEX vehicles_one_live_plate ON compliance.vehicles (plate_normalised) WHERE status <> 'RETIRED';

-- Compliance documents (D02/D03/R02–R06/R46): one table for driver, vehicle and per-district artefacts.
CREATE TABLE compliance.compliance_documents (
  id uuid PRIMARY KEY,
  document_type_code text NOT NULL,
  subject text NOT NULL,
  driver_application_id uuid NULL REFERENCES compliance.driver_applications (id),
  driver_profile_id uuid NULL REFERENCES compliance.driver_profiles (id),
  vehicle_id uuid NULL REFERENCES compliance.vehicles (id),
  district_code text NULL REFERENCES catalog.districts (code),
  number_envelope bytea NULL CHECK (number_envelope IS NULL OR octet_length(number_envelope) > 31),
  number_last4 text NULL CHECK (number_last4 IS NULL OR number_last4 ~ '^[A-Z0-9]{1,4}$'),
  licence_class text NULL CHECK (licence_class IS NULL OR licence_class ~ '^[A-Z0-9-]{1,12}$'),
  claimed_issued_on date NULL,
  claimed_expires_on date NULL,
  issued_on date NULL,
  expires_on date NULL,
  issuing_authority text NULL CHECK (issuing_authority IS NULL OR char_length(issuing_authority) BETWEEN 1 AND 120),
  status text NOT NULL CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'VALID', 'REJECTED', 'EXPIRED', 'SUPERSEDED')),
  supersedes_id uuid NULL REFERENCES compliance.compliance_documents (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- the subject columns must match the type's subject (composite FK binds subject to the type)
  FOREIGN KEY (document_type_code, subject) REFERENCES compliance.document_types (code, subject),
  CHECK ((driver_application_id IS NULL) <> (driver_profile_id IS NULL) OR subject = 'VEHICLE'),
  CHECK (
    (subject = 'DRIVER' AND vehicle_id IS NULL AND (driver_application_id IS NOT NULL OR driver_profile_id IS NOT NULL))
    OR (subject = 'VEHICLE' AND vehicle_id IS NOT NULL)
    OR (subject = 'DRIVER_VEHICLE' AND vehicle_id IS NOT NULL AND (driver_application_id IS NOT NULL OR driver_profile_id IS NOT NULL))
  ),
  CHECK (status <> 'VALID' OR issued_on IS NOT NULL OR expires_on IS NOT NULL OR number_envelope IS NOT NULL OR document_type_code IN ('SELFIE', 'TOKEN_TAX', 'AUTHORISED_USE_LETTER'))
);
CREATE INDEX compliance_documents_application ON compliance.compliance_documents (driver_application_id);
CREATE INDEX compliance_documents_profile ON compliance.compliance_documents (driver_profile_id);
CREATE INDEX compliance_documents_vehicle ON compliance.compliance_documents (vehicle_id);
CREATE INDEX compliance_documents_expiry ON compliance.compliance_documents (expires_on) WHERE status = 'VALID';

CREATE TABLE compliance.vehicle_affiliations (
  id uuid PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES compliance.vehicles (id),
  driver_application_id uuid NULL REFERENCES compliance.driver_applications (id),
  driver_profile_id uuid NULL REFERENCES compliance.driver_profiles (id),
  relation text NOT NULL CHECK (relation IN ('OWNER', 'AUTHORISED_USER')),
  status text NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'ENDED')),
  authorisation_document_id uuid NULL REFERENCES compliance.compliance_documents (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((driver_application_id IS NULL) <> (driver_profile_id IS NULL))
);
CREATE UNIQUE INDEX vehicle_affiliations_one_per_application ON compliance.vehicle_affiliations (vehicle_id, driver_application_id) WHERE driver_application_id IS NOT NULL AND status <> 'ENDED';

CREATE TABLE compliance.document_number_lookup_index (
  compliance_document_id uuid NOT NULL REFERENCES compliance.compliance_documents (id),
  lookup_key_version smallint NOT NULL CHECK (lookup_key_version > 0),
  lookup_hash bytea NOT NULL CHECK (octet_length(lookup_hash) = 32),
  PRIMARY KEY (compliance_document_id, lookup_key_version)
);
CREATE INDEX document_number_lookup_hash ON compliance.document_number_lookup_index (lookup_key_version, lookup_hash);

-- Duplicate/synthetic-identity signals (K07/D01): explicit subject/matched FKs, CHECK per signal, never auto-decisions.
CREATE TABLE compliance.duplicate_signals (
  id uuid PRIMARY KEY,
  signal text NOT NULL CHECK (signal IN ('CNIC_HASH_MATCH', 'DOCUMENT_NUMBER_MATCH', 'PLATE_ALREADY_AFFILIATED')),
  subject_application_id uuid NULL REFERENCES compliance.driver_applications (id),
  subject_document_id uuid NULL REFERENCES compliance.compliance_documents (id),
  subject_vehicle_id uuid NULL REFERENCES compliance.vehicles (id),
  matched_application_id uuid NULL REFERENCES compliance.driver_applications (id),
  matched_profile_id uuid NULL REFERENCES compliance.driver_profiles (id),
  matched_document_id uuid NULL REFERENCES compliance.compliance_documents (id),
  matched_account_id uuid NULL REFERENCES identity.accounts (id),
  status text NOT NULL CHECK (status IN ('OPEN', 'CLEARED', 'CONFIRMED_FRAUD')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  resolved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  CHECK ((status = 'OPEN') = (resolved_at IS NULL)),
  CHECK (
    (signal = 'CNIC_HASH_MATCH' AND subject_application_id IS NOT NULL AND (matched_application_id IS NOT NULL OR matched_profile_id IS NOT NULL)
      AND subject_document_id IS NULL AND subject_vehicle_id IS NULL AND matched_document_id IS NULL)
    OR (signal = 'DOCUMENT_NUMBER_MATCH' AND subject_document_id IS NOT NULL AND matched_document_id IS NOT NULL AND subject_vehicle_id IS NULL)
    OR (signal = 'PLATE_ALREADY_AFFILIATED' AND subject_application_id IS NOT NULL AND subject_vehicle_id IS NOT NULL AND matched_account_id IS NOT NULL
      AND subject_document_id IS NULL AND matched_document_id IS NULL)
  )
);
CREATE INDEX duplicate_signals_open ON compliance.duplicate_signals (subject_application_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX duplicate_signals_once ON compliance.duplicate_signals (signal, subject_application_id, subject_document_id, subject_vehicle_id,
  matched_application_id, matched_profile_id, matched_document_id, matched_account_id) NULLS NOT DISTINCT;

-- Service capabilities: necessary, never sufficient (the evaluator decides). Granted only by a human review
-- decision (decision FK added with review decisions, migration 0006).
CREATE TABLE compliance.service_capabilities (
  id uuid PRIMARY KEY,
  driver_profile_id uuid NOT NULL REFERENCES compliance.driver_profiles (id),
  vehicle_id uuid NOT NULL REFERENCES compliance.vehicles (id),
  city_code text NOT NULL REFERENCES catalog.cities (code),
  service_category text NOT NULL REFERENCES catalog.service_categories (code),
  status text NOT NULL CHECK (status IN ('GRANTED', 'REVOKED')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX service_capabilities_one_grant ON compliance.service_capabilities (driver_profile_id, vehicle_id, city_code, service_category) WHERE status = 'GRANTED';

-- ── profile: restrictions (V13; one table, FK per subject + CHECK per scope; effects derived in code) ────────────
CREATE TABLE profile.restrictions (
  id uuid PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('ACCOUNT', 'DRIVER_ROLE', 'VEHICLE', 'SERVICE_CAPABILITY', 'CITY_CATEGORY')),
  account_id uuid NULL REFERENCES identity.accounts (id),
  driver_profile_id uuid NULL REFERENCES compliance.driver_profiles (id),
  vehicle_id uuid NULL REFERENCES compliance.vehicles (id),
  service_capability_id uuid NULL REFERENCES compliance.service_capabilities (id),
  city_code text NULL REFERENCES catalog.cities (code),
  service_category text NULL REFERENCES catalog.service_categories (code),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  reason_class text NOT NULL CHECK (reason_class IN ('SAFETY', 'FRAUD', 'LEGAL', 'COMPLIANCE', 'QUALITY', 'SECURITY_HOLD', 'RISK_HOLD', 'AGE_POLICY')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'LIFT_PENDING_APPROVAL', 'LIFTED', 'EXPIRED')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz NULL,
  appealable boolean NOT NULL,
  created_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  created_by_system text NULL CHECK (created_by_system IS NULL OR created_by_system ~ '^[a-z][a-z0-9.-]{2,63}$'),
  lift_requested_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  lifted_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  lift_reason_code text NULL CHECK (lift_reason_code IS NULL OR lift_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  lifted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- exactly the scope's subject columns are set
  CHECK (
    (scope = 'ACCOUNT' AND account_id IS NOT NULL AND driver_profile_id IS NULL AND vehicle_id IS NULL AND service_capability_id IS NULL AND city_code IS NULL AND service_category IS NULL)
    OR (scope = 'DRIVER_ROLE' AND driver_profile_id IS NOT NULL AND account_id IS NULL AND vehicle_id IS NULL AND service_capability_id IS NULL AND city_code IS NULL AND service_category IS NULL)
    OR (scope = 'VEHICLE' AND vehicle_id IS NOT NULL AND account_id IS NULL AND driver_profile_id IS NULL AND service_capability_id IS NULL AND city_code IS NULL AND service_category IS NULL)
    OR (scope = 'SERVICE_CAPABILITY' AND service_capability_id IS NOT NULL AND account_id IS NULL AND driver_profile_id IS NULL AND vehicle_id IS NULL AND city_code IS NULL AND service_category IS NULL)
    OR (scope = 'CITY_CATEGORY' AND driver_profile_id IS NOT NULL AND city_code IS NOT NULL AND service_category IS NOT NULL AND account_id IS NULL AND vehicle_id IS NULL AND service_capability_id IS NULL)
  ),
  -- exactly one creator: a staff member xor a named system process
  CHECK ((created_by_staff_id IS NULL) <> (created_by_system IS NULL)),
  -- driver-only classes never target the whole account; account-wide classes never target driver subjects
  CHECK (reason_class <> 'RISK_HOLD' OR scope = 'DRIVER_ROLE'),
  CHECK (reason_class NOT IN ('SECURITY_HOLD', 'AGE_POLICY') OR scope = 'ACCOUNT'),
  -- risk holds are system-created and auto-expiring (auth design §5)
  CHECK (reason_class <> 'RISK_HOLD' OR (created_by_system IS NOT NULL AND effective_until IS NOT NULL)),
  CHECK ((status = 'LIFTED') = (lifted_at IS NOT NULL AND lift_reason_code IS NOT NULL)),
  -- maker-checker on lifts: the approver is never the requester
  CHECK (lifted_by_staff_id IS NULL OR lifted_by_staff_id IS DISTINCT FROM lift_requested_by_staff_id OR reason_class NOT IN ('SAFETY', 'FRAUD')),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX restrictions_account ON profile.restrictions (account_id) WHERE status IN ('ACTIVE', 'LIFT_PENDING_APPROVAL');
CREATE INDEX restrictions_driver ON profile.restrictions (driver_profile_id) WHERE status IN ('ACTIVE', 'LIFT_PENDING_APPROVAL');
CREATE INDEX restrictions_vehicle ON profile.restrictions (vehicle_id) WHERE status IN ('ACTIVE', 'LIFT_PENDING_APPROVAL');

CREATE TABLE profile.restriction_events (
  id uuid PRIMARY KEY,
  restriction_id uuid NOT NULL REFERENCES profile.restrictions (id),
  event text NOT NULL CHECK (event IN ('CREATED', 'LIFT_REQUESTED', 'LIFTED', 'LIFT_REJECTED', 'EXPIRED')),
  actor_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  actor_system text NULL CHECK (actor_system IS NULL OR actor_system ~ '^[a-z][a-z0-9.-]{2,63}$'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  at timestamptz NOT NULL DEFAULT now(),
  CHECK ((actor_staff_id IS NULL) <> (actor_system IS NULL))
);
CREATE TRIGGER restriction_events_append_only BEFORE UPDATE OR DELETE ON profile.restriction_events FOR EACH ROW EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER restriction_events_no_truncate BEFORE TRUNCATE ON profile.restriction_events FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA compliance TO wayvro_api;
GRANT SELECT ON catalog.districts, catalog.service_categories, compliance.document_types TO wayvro_api;
GRANT SELECT, INSERT, UPDATE ON legal.age_eligibility_policies TO wayvro_api;
GRANT SELECT, INSERT, UPDATE ON compliance.requirement_sets, compliance.driver_applications, compliance.driver_profiles, compliance.vehicles,
  compliance.compliance_documents, compliance.vehicle_affiliations, compliance.duplicate_signals, compliance.service_capabilities,
  profile.restrictions TO wayvro_api;
GRANT SELECT, INSERT, DELETE ON compliance.requirement_set_items, compliance.application_service_categories TO wayvro_api;
-- a claim can change before submission: its lookup row is replaced in place (one row per application/document and key version)
GRANT SELECT, INSERT, UPDATE ON compliance.cnic_lookup_index, compliance.document_number_lookup_index TO wayvro_api;
GRANT SELECT, INSERT ON profile.restriction_events TO wayvro_api;

-- worker: restriction expiry (RISK_HOLD auto-expiry) and draft-application expiry
GRANT USAGE ON SCHEMA compliance, profile TO wayvro_worker;
GRANT SELECT (id, status, effective_until), UPDATE (status) ON profile.restrictions TO wayvro_worker;
GRANT INSERT ON profile.restriction_events TO wayvro_worker;
GRANT SELECT (id, state, updated_at, version), UPDATE (state, updated_at, version) ON compliance.driver_applications TO wayvro_worker;

RESET ROLE;
