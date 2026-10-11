-- wayvro-migration: 0007_recovery_deletion
-- compatibility: additive (expand) — widened CHECKs on identity.accounts/account_phones/otp_challenges/sessions/security_events and compliance.review_cases (every existing row satisfies the widened rules); nullable columns on those tables (phone envelope/last-4 become nullable only for deleted accounts); new tables for phone change/recovery requests, dormant-number reviews and account deletion (+ blockers, retention exceptions); one REVOKE of a column grant no P2.8 code reads. Safe with every P2.1–P2.8 application version: none writes the new states, and P2.8 no longer reads the revoked columns from the vault pool
-- data-impact: none — no data is moved or rewritten; new tables start empty. New phone numbers in change requests are field-encrypted (key class contact) with HMAC lookups only. Synthetic data only until the Phase 7 gates
-- rollback: before any real data exists (pre-Phase 7): DROP TABLE identity.deletion_retention_exceptions, identity.deletion_request_blockers, identity.account_deletion_requests; drop the review_cases columns/constraints and restore the 0006 CHECKs; DROP TABLE identity.dormant_number_reviews, identity.phone_change_requests; drop the added columns and restore the 0001 CHECKs (only while no row uses a new state); re-grant the vault column SELECT. Afterwards: forward-fix only
-- verification: packages/db/test/recovery-deletion.integration.test.ts — clean->latest, every previous->latest, re-run 0, widened CHECKs, one open phone change/review/deletion per account, per-kind case subjects, deleted-phone rules, grants as restricted roles (incl. the revoked vault column grant)

SET LOCAL ROLE wayvro_migrator;

-- ── accounts: deletion lifecycle (data model §4.1, §4.9) ──────────────────────────────────────────────────────
ALTER TABLE identity.accounts DROP CONSTRAINT accounts_status_check;
ALTER TABLE identity.accounts ADD CONSTRAINT accounts_status_check CHECK (status IN ('ACTIVE', 'DELETION_PENDING', 'DELETED'));
ALTER TABLE identity.accounts ADD COLUMN deleted_at timestamptz NULL;
ALTER TABLE identity.accounts ADD CONSTRAINT accounts_deleted_at_check CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL));
-- a deleted account is a pseudonymised tombstone: no display name
ALTER TABLE identity.accounts ADD CONSTRAINT accounts_deleted_no_name_check CHECK (status <> 'DELETED' OR display_name IS NULL);

-- ── phones: VERIFIED → RELEASED (data model §4.2) ──────────────────────────────────────────────────────────────
ALTER TABLE identity.account_phones DROP CONSTRAINT account_phones_status_check;
ALTER TABLE identity.account_phones ADD CONSTRAINT account_phones_status_check CHECK (status IN ('VERIFIED', 'RELEASED'));
ALTER TABLE identity.account_phones
  ADD COLUMN released_at timestamptz NULL,
  ADD COLUMN release_reason text NULL CHECK (release_reason IN ('PHONE_CHANGED', 'RECYCLED_NUMBER_NEW_OWNER', 'ACCOUNT_DELETED', 'RECOVERY_MOVED'));
ALTER TABLE identity.account_phones ADD CONSTRAINT account_phones_release_check
  CHECK ((status = 'RELEASED') = (released_at IS NOT NULL AND release_reason IS NOT NULL));
-- only a deleted account's released phones lose the number itself (envelope and last 4 together)
ALTER TABLE identity.account_phones ALTER COLUMN phone_envelope DROP NOT NULL, ALTER COLUMN phone_last4 DROP NOT NULL;
ALTER TABLE identity.account_phones ADD CONSTRAINT account_phones_erased_check CHECK ((phone_envelope IS NULL) = (phone_last4 IS NULL));
ALTER TABLE identity.account_phones ADD CONSTRAINT account_phones_erased_only_deleted_check
  CHECK (phone_envelope IS NOT NULL OR (status = 'RELEASED' AND release_reason = 'ACCOUNT_DELETED'));

-- ── OTP purposes: step-up and the new number of a phone change are bound to the requesting session ────────────
ALTER TABLE identity.otp_challenges DROP CONSTRAINT otp_challenges_purpose_check;
ALTER TABLE identity.otp_challenges ADD CONSTRAINT otp_challenges_purpose_check
  CHECK (purpose IN ('SIGN_IN', 'STEP_UP', 'PHONE_CHANGE_NEW', 'ACCOUNT_DELETION_WEB'));
ALTER TABLE identity.otp_challenges ADD COLUMN session_id uuid NULL REFERENCES identity.sessions (id);
ALTER TABLE identity.otp_challenges ADD CONSTRAINT otp_challenges_session_binding_check
  CHECK ((purpose IN ('STEP_UP', 'PHONE_CHANGE_NEW')) = (session_id IS NOT NULL));

-- ── sessions: step-up time and the new revocation reasons ─────────────────────────────────────────────────────
ALTER TABLE identity.sessions ADD COLUMN step_up_at timestamptz NULL;
ALTER TABLE identity.sessions DROP CONSTRAINT sessions_revoke_reason_check;
ALTER TABLE identity.sessions ADD CONSTRAINT sessions_revoke_reason_check CHECK (
  revoke_reason IN ('USER_LOGOUT', 'USER_LOGOUT_ALL', 'USER_SESSION_REVOKED', 'REFRESH_REUSE', 'PHONE_CHANGED', 'RECOVERY', 'RESTRICTION_SECURITY_HOLD', 'ACCOUNT_DELETED')
);

ALTER TABLE identity.security_events DROP CONSTRAINT security_events_type_check;
ALTER TABLE identity.security_events ADD CONSTRAINT security_events_type_check CHECK (
  type IN (
    'SIGN_IN',
    'SIGN_IN_NEW_DEVICE',
    'DORMANT_ACCOUNT_NEW_INSTALLATION',
    'SIGNED_OUT',
    'SESSION_REVOKED',
    'SESSIONS_REVOKED_ALL',
    'SESSIONS_REVOKED_OTHERS',
    'REFRESH_TOKEN_REUSE_DETECTED',
    'PROFILE_UPDATED',
    'STEP_UP_VERIFIED',
    'PHONE_CHANGE_REQUESTED',
    'PHONE_CHANGED',
    'PHONE_CHANGE_CANCELLED',
    'RECOVERY_REQUESTED',
    'RECOVERY_APPROVED_COOLDOWN',
    'RECOVERY_COMPLETED',
    'RECOVERY_DENIED',
    'DORMANT_NUMBER_RELEASED',
    'DELETION_REQUESTED',
    'DELETION_CANCELLED'
  )
);

-- ── phone change and lost-phone recovery requests (data model §4.2; auth design §6) ───────────────────────────
-- SELF_SERVICE: a stepped-up session of the account (current phone proven) → OTP to the new number → COMPLETED.
-- RECOVERY_DRIVER_KYC: asked from the session of the NEW number's account (requested_by_account_id) for the account
-- that owned the lost number; manual review with an in-person check + second approver → 72 h COOLDOWN → COMPLETED.
CREATE TABLE identity.phone_change_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  kind text NOT NULL CHECK (kind IN ('SELF_SERVICE', 'RECOVERY_DRIVER_KYC')),
  -- versioned AES-256-GCM envelope (key class contact); the plaintext number is never stored. Erased (all four
  -- together) only on a closed request when an account it names is deleted
  new_phone_envelope bytea NULL CHECK (octet_length(new_phone_envelope) > 31),
  new_phone_last4 char(4) NULL CHECK (new_phone_last4 ~ '^[0-9]{4}$'),
  new_phone_lookup_version smallint NULL CHECK (new_phone_lookup_version > 0),
  new_phone_lookup_hash bytea NULL CHECK (octet_length(new_phone_lookup_hash) = 32),
  status text NOT NULL CHECK (status IN ('CURRENT_PHONE_VERIFIED', 'MANUAL_REVIEW', 'COOLDOWN', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DENIED')),
  step_up_session_id uuid NULL REFERENCES identity.sessions (id),
  requested_by_account_id uuid NULL REFERENCES identity.accounts (id),
  cooldown_until timestamptz NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ((kind = 'SELF_SERVICE') = (step_up_session_id IS NOT NULL)),
  CHECK ((kind = 'RECOVERY_DRIVER_KYC') = (requested_by_account_id IS NOT NULL)),
  CHECK (requested_by_account_id IS DISTINCT FROM account_id),
  CHECK (kind <> 'SELF_SERVICE' OR status IN ('CURRENT_PHONE_VERIFIED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DENIED')),
  CHECK (kind <> 'RECOVERY_DRIVER_KYC' OR status IN ('MANUAL_REVIEW', 'COOLDOWN', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DENIED')),
  CHECK (status <> 'COOLDOWN' OR cooldown_until IS NOT NULL),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK (expires_at > created_at),
  CHECK ((new_phone_envelope IS NULL) = (new_phone_last4 IS NULL) AND (new_phone_envelope IS NULL) = (new_phone_lookup_hash IS NULL)
    AND (new_phone_lookup_hash IS NULL) = (new_phone_lookup_version IS NULL)),
  CHECK (new_phone_envelope IS NOT NULL OR status IN ('COMPLETED', 'CANCELLED', 'EXPIRED', 'DENIED'))
);
-- INVARIANT: at most one open phone change or recovery per account
CREATE UNIQUE INDEX phone_change_requests_one_open ON identity.phone_change_requests (account_id)
  WHERE status IN ('CURRENT_PHONE_VERIFIED', 'MANUAL_REVIEW', 'COOLDOWN');
CREATE INDEX phone_change_requests_cooldown ON identity.phone_change_requests (cooldown_until) WHERE status = 'COOLDOWN';

-- ── dormant-number review (S12; auth design §6.1): a restricted session on a dormant account from an unknown
-- installation answers "I'm new" (new clean account, old account SECURITY_HOLD) or "this is my account" (strong
-- proof only: a driver identity check in person; linked OIDC from P2.10)
CREATE TABLE identity.dormant_number_reviews (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  session_id uuid NOT NULL REFERENCES identity.sessions (id),
  status text NOT NULL CHECK (status IN ('PENDING', 'IN_REVIEW', 'RESOLVED_OWNER', 'RESOLVED_NEW_ACCOUNT', 'DENIED')),
  new_account_id uuid NULL REFERENCES identity.accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ((status IN ('RESOLVED_OWNER', 'RESOLVED_NEW_ACCOUNT', 'DENIED')) = (resolved_at IS NOT NULL)),
  CHECK ((status = 'RESOLVED_NEW_ACCOUNT') = (new_account_id IS NOT NULL)),
  CHECK (new_account_id IS DISTINCT FROM account_id)
);
CREATE UNIQUE INDEX dormant_number_reviews_one_open_per_session ON identity.dormant_number_reviews (session_id) WHERE status IN ('PENDING', 'IN_REVIEW');

-- ── account deletion (U06; data model §4.9): GRACE (14 days, configurable, pending counsel) → PROCESSING →
-- COMPLETED; BLOCKED while a blocker row is open; CANCELLED by the owner during GRACE/BLOCKED
CREATE TABLE identity.account_deletion_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  channel text NOT NULL CHECK (channel IN ('APP', 'WEB')),
  status text NOT NULL CHECK (status IN ('GRACE', 'BLOCKED', 'PROCESSING', 'COMPLETED', 'CANCELLED')),
  grace_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (grace_until > created_at),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);
-- INVARIANT: at most one open deletion request per account
CREATE UNIQUE INDEX account_deletion_requests_one_open ON identity.account_deletion_requests (account_id)
  WHERE status IN ('GRACE', 'BLOCKED', 'PROCESSING');
CREATE INDEX account_deletion_requests_due ON identity.account_deletion_requests (grace_until) WHERE status IN ('GRACE', 'BLOCKED');

-- one row per blocker occurrence (no JSON list); at most one OPEN row per code
CREATE TABLE identity.deletion_request_blockers (
  id uuid PRIMARY KEY,
  deletion_request_id uuid NOT NULL REFERENCES identity.account_deletion_requests (id),
  blocker_code text NOT NULL CHECK (blocker_code IN ('LEGAL_HOLD', 'RECOVERY_IN_PROGRESS', 'OPEN_SAFETY_OR_FRAUD_INVESTIGATION')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz NULL,
  CHECK (cleared_at IS NULL OR cleared_at >= detected_at)
);
CREATE UNIQUE INDEX deletion_request_blockers_one_open ON identity.deletion_request_blockers (deletion_request_id, blocker_code) WHERE cleared_at IS NULL;

-- lawful-basis references per retained data category (placeholders until the retention schedule clears EG-16)
CREATE TABLE identity.deletion_retention_exceptions (
  deletion_request_id uuid NOT NULL REFERENCES identity.account_deletion_requests (id),
  data_category text NOT NULL CHECK (data_category ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  basis_ref text NOT NULL CHECK (char_length(basis_ref) BETWEEN 3 AND 200),
  PRIMARY KEY (deletion_request_id, data_category)
);

-- ── review cases: ACCOUNT_RECOVERY and REVERIFICATION (data model §3.3) ───────────────────────────────────────
ALTER TABLE compliance.review_cases
  ADD COLUMN phone_change_request_id uuid NULL REFERENCES identity.phone_change_requests (id),
  ADD COLUMN dormant_number_review_id uuid NULL REFERENCES identity.dormant_number_reviews (id);
ALTER TABLE compliance.review_cases DROP CONSTRAINT review_cases_kind_check;
ALTER TABLE compliance.review_cases ADD CONSTRAINT review_cases_kind_check
  CHECK (kind IN ('INITIAL_APPLICATION', 'RESUBMISSION', 'APPEAL', 'DOCUMENT_RENEWAL', 'ACCOUNT_RECOVERY', 'REVERIFICATION'));
ALTER TABLE compliance.review_cases DROP CONSTRAINT review_cases_check;
ALTER TABLE compliance.review_cases ADD CONSTRAINT review_cases_subject_check CHECK (
  (kind IN ('INITIAL_APPLICATION', 'RESUBMISSION') AND driver_application_id IS NOT NULL AND driver_profile_id IS NULL AND compliance_document_id IS NULL AND appeal_id IS NULL
    AND phone_change_request_id IS NULL AND dormant_number_review_id IS NULL)
  OR (kind = 'APPEAL' AND driver_application_id IS NOT NULL AND appeal_id IS NOT NULL AND driver_profile_id IS NULL AND compliance_document_id IS NULL
    AND phone_change_request_id IS NULL AND dormant_number_review_id IS NULL)
  OR (kind = 'DOCUMENT_RENEWAL' AND driver_profile_id IS NOT NULL AND compliance_document_id IS NOT NULL AND driver_application_id IS NULL AND appeal_id IS NULL
    AND phone_change_request_id IS NULL AND dormant_number_review_id IS NULL)
  -- recovery of a driver account: exactly one of the lost-phone request or the dormant-number review
  OR (kind = 'ACCOUNT_RECOVERY' AND driver_profile_id IS NOT NULL AND driver_application_id IS NULL AND compliance_document_id IS NULL AND appeal_id IS NULL
    AND ((phone_change_request_id IS NULL) <> (dormant_number_review_id IS NULL)))
  OR (kind = 'REVERIFICATION' AND driver_profile_id IS NOT NULL AND driver_application_id IS NULL AND compliance_document_id IS NULL AND appeal_id IS NULL
    AND phone_change_request_id IS NULL AND dormant_number_review_id IS NULL)
);
CREATE UNIQUE INDEX review_cases_one_open_per_phone_change ON compliance.review_cases (phone_change_request_id)
  WHERE status IN ('OPEN', 'CLAIMED', 'ESCALATED') AND phone_change_request_id IS NOT NULL;
CREATE UNIQUE INDEX review_cases_one_open_per_dormant_review ON compliance.review_cases (dormant_number_review_id)
  WHERE status IN ('OPEN', 'CLAIMED', 'ESCALATED') AND dormant_number_review_id IS NOT NULL;
CREATE UNIQUE INDEX review_cases_one_open_reverification ON compliance.review_cases (driver_profile_id)
  WHERE status IN ('OPEN', 'CLAIMED', 'ESCALATED') AND kind = 'REVERIFICATION';

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
-- API: phone release on change/recovery/dormant review, and the new request tables
GRANT UPDATE (status, released_at, release_reason) ON identity.account_phones TO wayvro_api;
GRANT UPDATE (is_current_owner) ON identity.phone_lookup_index TO wayvro_api;
GRANT SELECT, INSERT, UPDATE ON identity.phone_change_requests, identity.dormant_number_reviews, identity.account_deletion_requests,
  identity.deletion_request_blockers TO wayvro_api;
GRANT SELECT, INSERT ON identity.deletion_retention_exceptions TO wayvro_api;

-- worker: recovery completion after the cooldown, deletion processing (pseudonymisation) and blocker re-evaluation
GRANT SELECT, UPDATE ON identity.phone_change_requests TO wayvro_worker;
GRANT SELECT, UPDATE ON identity.account_deletion_requests TO wayvro_worker;
GRANT SELECT, INSERT, UPDATE ON identity.deletion_request_blockers TO wayvro_worker;
GRANT SELECT (id, status, display_name, deleted_at, version), UPDATE (status, display_name, deleted_at, version) ON identity.accounts TO wayvro_worker;
GRANT SELECT (phone_last4, released_at, release_reason, verified_at), INSERT, UPDATE (status, released_at, release_reason, phone_last4) ON identity.account_phones TO wayvro_worker;
GRANT UPDATE (is_current_owner) ON identity.phone_lookup_index TO wayvro_worker;
GRANT SELECT (id, account_id, status, version), UPDATE (status, revoked_at, revoke_reason, version) ON identity.sessions TO wayvro_worker;
GRANT INSERT ON identity.security_events TO wayvro_worker;
GRANT SELECT (id, account_id, status, version), UPDATE (status, version) ON profile.appeals TO wayvro_worker;
GRANT SELECT (scope, reason_class) ON profile.restrictions TO wayvro_worker;

-- vault: P2.8 moved evidence case scoping to the review module; the vault pool no longer reads review cases
REVOKE SELECT (id, driver_application_id, status, assigned_staff_id, lease_expires_at, kind) ON compliance.review_cases FROM wayvro_vault;

RESET ROLE;
