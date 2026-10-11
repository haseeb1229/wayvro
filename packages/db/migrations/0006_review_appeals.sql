-- wayvro-migration: 0006_review_appeals
-- compatibility: additive (expand) — new tables for review cases, decisions (+ evidence relied on, second approvals), appeals (+ appeal evidence), the transactional outbox and processed-event records; one nullable column + NOT VALID CHECK on compliance.service_capabilities (decision that granted it); safe with every P2.1–P2.6 application version
-- data-impact: none — no data is moved or rewritten; tables start empty. Appeal statements are field-encrypted (key class appeal_statements); outbox payloads carry ids and reason codes only. Synthetic data only until the Phase 7 gates
-- rollback: before any real data exists (pre-Phase 7): DROP TABLE profile.appeal_evidence, compliance.review_decision_evidence, compliance.review_second_approvals, compliance.review_decisions, compliance.review_cases, profile.appeals, platform.processed_events, platform.outbox_events; drop the service_capabilities column/constraint. Afterwards: forward-fix only
-- verification: packages/db/test/review-appeals.integration.test.ts — clean->latest, every previous->latest, re-run 0, per-kind subject CHECKs, one open case per application, claim/lease CHECKs, append-only decisions, second approver ≠ decider, appeal subject CHECKs and one open appeal per subject, outbox append rules, grants as restricted roles

SET LOCAL ROLE wayvro_migrator;

-- ── appeals (V13/K05; data model §3.2, §4.8) ────────────────────────────────────────────────────────────────────
-- Created first: review cases of kind APPEAL reference them. The subject decision FK is added after review_decisions.
CREATE TABLE profile.appeals (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  review_decision_id uuid NULL,
  restriction_id uuid NULL REFERENCES profile.restrictions (id),
  status text NOT NULL CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'UPHELD', 'OVERTURNED', 'WITHDRAWN')),
  -- free text from the applicant (PII-classified): AES-256-GCM envelope, key class appeal_statements
  statement_envelope bytea NOT NULL CHECK (octet_length(statement_envelope) > 31),
  assigned_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  decided_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  outcome_reason_code text NULL CHECK (outcome_reason_code IS NULL OR outcome_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- exactly one subject: a review decision or a restriction
  CHECK ((review_decision_id IS NULL) <> (restriction_id IS NULL)),
  CHECK ((status IN ('UPHELD', 'OVERTURNED')) = (decided_by_staff_id IS NOT NULL AND decided_at IS NOT NULL AND outcome_reason_code IS NOT NULL)),
  CHECK (status <> 'UNDER_REVIEW' OR assigned_staff_id IS NOT NULL)
);
CREATE UNIQUE INDEX appeals_one_open_per_decision ON profile.appeals (review_decision_id) WHERE status IN ('SUBMITTED', 'UNDER_REVIEW') AND review_decision_id IS NOT NULL;
CREATE UNIQUE INDEX appeals_one_open_per_restriction ON profile.appeals (restriction_id) WHERE status IN ('SUBMITTED', 'UNDER_REVIEW') AND restriction_id IS NOT NULL;
CREATE INDEX appeals_account ON profile.appeals (account_id, created_at);

CREATE TABLE profile.appeal_evidence (
  appeal_id uuid NOT NULL REFERENCES profile.appeals (id),
  evidence_object_id uuid NOT NULL REFERENCES vault.evidence_objects (id),
  PRIMARY KEY (appeal_id, evidence_object_id)
);

-- ── review cases (K04/K05/H02; data model §3.3, §4.10) ──────────────────────────────────────────────────────────
-- Explicit subject FKs + CHECK per kind. Kinds of later micro-phases (REVERIFICATION, ACCOUNT_RECOVERY, …) are added
-- additively with their subject columns.
CREATE TABLE compliance.review_cases (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('INITIAL_APPLICATION', 'RESUBMISSION', 'APPEAL', 'DOCUMENT_RENEWAL')),
  driver_application_id uuid NULL REFERENCES compliance.driver_applications (id),
  driver_profile_id uuid NULL REFERENCES compliance.driver_profiles (id),
  compliance_document_id uuid NULL REFERENCES compliance.compliance_documents (id),
  appeal_id uuid NULL REFERENCES profile.appeals (id),
  city_code text NOT NULL REFERENCES catalog.cities (code),
  priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 9),
  status text NOT NULL CHECK (status IN ('OPEN', 'CLAIMED', 'ESCALATED', 'DECIDED', 'CANCELLED')),
  assigned_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  lease_expires_at timestamptz NULL,
  escalated boolean NOT NULL DEFAULT false,
  in_person_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (
    (kind IN ('INITIAL_APPLICATION', 'RESUBMISSION') AND driver_application_id IS NOT NULL AND driver_profile_id IS NULL AND compliance_document_id IS NULL AND appeal_id IS NULL)
    OR (kind = 'APPEAL' AND driver_application_id IS NOT NULL AND appeal_id IS NOT NULL AND driver_profile_id IS NULL AND compliance_document_id IS NULL)
    OR (kind = 'DOCUMENT_RENEWAL' AND driver_profile_id IS NOT NULL AND compliance_document_id IS NOT NULL AND driver_application_id IS NULL AND appeal_id IS NULL)
  ),
  -- a claim is a lease held by one staff member
  CHECK ((status = 'CLAIMED') = (assigned_staff_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((status = 'DECIDED') = (decided_at IS NOT NULL))
);
-- INVARIANT: at most one open review case per application (and per renewed document)
CREATE UNIQUE INDEX review_cases_one_open_per_application ON compliance.review_cases (driver_application_id)
  WHERE status IN ('OPEN', 'CLAIMED', 'ESCALATED') AND driver_application_id IS NOT NULL;
CREATE UNIQUE INDEX review_cases_one_open_per_document ON compliance.review_cases (compliance_document_id)
  WHERE status IN ('OPEN', 'CLAIMED', 'ESCALATED') AND compliance_document_id IS NOT NULL;
CREATE INDEX review_cases_queue ON compliance.review_cases (city_code, status, priority DESC, created_at) WHERE status IN ('OPEN', 'CLAIMED', 'ESCALATED');
CREATE INDEX review_cases_leases ON compliance.review_cases (lease_expires_at) WHERE status = 'CLAIMED';

-- Decisions are append-only facts (K04/K05). reason_codes/checklist are scalar assessment values (closure §9).
CREATE TABLE compliance.review_decisions (
  id uuid PRIMARY KEY,
  review_case_id uuid NOT NULL REFERENCES compliance.review_cases (id),
  decision text NOT NULL CHECK (decision IN ('APPROVE', 'NEEDS_INFO', 'REJECT', 'ESCALATE', 'REQUIRE_IN_PERSON')),
  reason_codes text[] NOT NULL CHECK (cardinality(reason_codes) BETWEEN 1 AND 20),
  checklist jsonb NOT NULL,
  checklist_schema_version smallint NOT NULL CHECK (checklist_schema_version >= 1),
  -- a human assessment, never a score (K04)
  identity_match_assessment text NULL CHECK (identity_match_assessment IN ('CONFIRMED_BY_REVIEWER', 'NOT_MATCHING', 'UNCERTAIN_ESCALATE', 'IN_PERSON_REQUIRED')),
  requires_second_approval boolean NOT NULL DEFAULT false,
  decided_by_staff_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  staff_session_id uuid NOT NULL REFERENCES staff.sessions (id),
  break_glass_grant_id uuid NULL REFERENCES staff.break_glass_grants (id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, decided_by_staff_id),
  -- only an approval can wait for a second approver; an approval always carries a human identity assessment
  CHECK (NOT requires_second_approval OR decision = 'APPROVE'),
  CHECK (decision <> 'APPROVE' OR identity_match_assessment = 'CONFIRMED_BY_REVIEWER')
);
CREATE INDEX review_decisions_case ON compliance.review_decisions (review_case_id, decided_at);
CREATE TRIGGER review_decisions_append_only BEFORE UPDATE OR DELETE ON compliance.review_decisions FOR EACH ROW EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER review_decisions_no_truncate BEFORE TRUNCATE ON compliance.review_decisions FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

ALTER TABLE profile.appeals ADD CONSTRAINT appeals_review_decision_fk FOREIGN KEY (review_decision_id) REFERENCES compliance.review_decisions (id);

-- Maker-checker: the second approver is never the decider (composite FK binds the decider to the decision row).
CREATE TABLE compliance.review_second_approvals (
  review_decision_id uuid PRIMARY KEY,
  decided_by_staff_id uuid NOT NULL,
  approver_staff_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  approver_session_id uuid NOT NULL REFERENCES staff.sessions (id),
  outcome text NOT NULL CHECK (outcome IN ('APPROVED', 'REJECTED')),
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (review_decision_id, decided_by_staff_id) REFERENCES compliance.review_decisions (id, decided_by_staff_id),
  CHECK (approver_staff_id <> decided_by_staff_id)
);
CREATE TRIGGER review_second_approvals_append_only BEFORE UPDATE OR DELETE ON compliance.review_second_approvals FOR EACH ROW EXECUTE FUNCTION platform.append_only();

-- Evidence relied on by a decision (junction, not an array; closure §9).
CREATE TABLE compliance.review_decision_evidence (
  review_decision_id uuid NOT NULL REFERENCES compliance.review_decisions (id),
  evidence_object_id uuid NOT NULL REFERENCES vault.evidence_objects (id),
  PRIMARY KEY (review_decision_id, evidence_object_id)
);

-- Capabilities are granted only by a human decision (0004 note). NOT VALID: binds every NEW grant; no row exists yet.
ALTER TABLE compliance.service_capabilities ADD COLUMN granted_by_decision_id uuid NULL REFERENCES compliance.review_decisions (id);
ALTER TABLE compliance.service_capabilities ADD CONSTRAINT service_capabilities_granted_by_decision CHECK (granted_by_decision_id IS NOT NULL) NOT VALID;

-- ── transactional outbox (ADR-004/ADR-042; API doc §3) ──────────────────────────────────────────────────────────
-- Written in the SAME transaction as the state change; payloads carry ids and reason codes only (never PII).
CREATE TABLE platform.outbox_events (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type ~ '^[a-z]+(\.[a-z-]+)+\.v[0-9]+$'),
  aggregate_type text NOT NULL CHECK (aggregate_type ~ '^[a-z][a-z0-9_.]{1,63}$'),
  aggregate_id uuid NOT NULL,
  -- the account the event concerns (state-change hints are routed by it); never shown to anyone else
  account_id uuid NULL REFERENCES identity.accounts (id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('PENDING', 'DISPATCHED', 'DEAD')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text NULL CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz NULL,
  CHECK ((status = 'DISPATCHED') = (dispatched_at IS NOT NULL))
);
CREATE INDEX outbox_events_pending ON platform.outbox_events (created_at) WHERE status = 'PENDING';

-- Idempotent consumption: one row per (consumer, event); a redelivered event is a no-op.
CREATE TABLE platform.processed_events (
  consumer text NOT NULL CHECK (consumer ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON compliance.review_cases, profile.appeals TO wayvro_api;
GRANT SELECT, INSERT ON compliance.review_decisions, compliance.review_second_approvals, compliance.review_decision_evidence, profile.appeal_evidence TO wayvro_api;
GRANT INSERT ON platform.outbox_events TO wayvro_api;
-- the vault module records the submission event in the same transaction as the vault-side effects it owns
GRANT INSERT ON platform.outbox_events TO wayvro_vault;
-- staff evidence views are scoped to claimed review cases (P2.7): the vault module reads case assignment facts only
GRANT SELECT (id, driver_application_id, status, assigned_staff_id, lease_expires_at, kind) ON compliance.review_cases TO wayvro_vault;
GRANT SELECT (id, signal, status, subject_application_id, matched_application_id) ON compliance.duplicate_signals TO wayvro_vault;

-- worker: intake (SUBMITTED → AUTO_CHECK_PENDING → MANUAL_REVIEW + review case), lease expiry, document expiry,
-- outbox relay and processed-event records
GRANT SELECT, INSERT, UPDATE ON compliance.review_cases TO wayvro_worker;
GRANT SELECT (id, account_id, state, city_code, version, updated_at) ON compliance.driver_applications TO wayvro_worker;
GRANT SELECT (id, status, subject_application_id) ON compliance.duplicate_signals TO wayvro_worker;
GRANT SELECT (id, status, expires_on, driver_profile_id, document_type_code, version), UPDATE (status, version) ON compliance.compliance_documents TO wayvro_worker;
GRANT SELECT (id, state, account_id, version), UPDATE (state, version) ON compliance.driver_profiles TO wayvro_worker;
GRANT SELECT, UPDATE ON platform.outbox_events TO wayvro_worker;
GRANT INSERT ON platform.outbox_events TO wayvro_worker;
GRANT SELECT, INSERT ON platform.processed_events TO wayvro_worker;
-- restriction expiry emits restriction.changed.v1 for the affected account; document expiry evaluates the pinned set
GRANT SELECT (account_id, driver_profile_id) ON profile.restrictions TO wayvro_worker;
GRANT SELECT (requirement_set_id) ON compliance.driver_applications TO wayvro_worker;
GRANT SELECT (requirement_set_id, document_type_code, mandatory) ON compliance.requirement_set_items TO wayvro_worker;
GRANT SELECT (id, application_id) ON compliance.driver_profiles TO wayvro_worker;
GRANT SELECT (driver_application_id) ON compliance.compliance_documents TO wayvro_worker;

RESET ROLE;
