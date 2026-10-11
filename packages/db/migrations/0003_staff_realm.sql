-- wayvro-migration: 0003_staff_realm
-- compatibility: additive (expand) — new schemas `staff` and `catalog` (cities only; districts/categories follow in 0004), new tables, and two widened CHECK constraints on audit.audit_events (actor type STAFF); every existing row satisfies the widened checks; safe with every P2.1/P2.2 application version
-- data-impact: seeds one reference row catalog.cities('LHR'). No staff account exists until the bootstrap CLI runs (no default account, no stored credential). Synthetic data only until the Phase 7 gates
-- rollback: before any real data exists (pre-Phase 7): DROP SCHEMA staff CASCADE; DROP SCHEMA catalog CASCADE; restore the two audit CHECK constraints (only possible while no STAFF audit rows exist). Afterwards: forward-fix only
-- verification: packages/db/test/staff-realm.integration.test.ts — clean->latest, every previous->latest, re-run 0, constraints (maker != checker, break-glass <= 60 min, one live session token, credential uniqueness), append-only access reasons, grants as restricted roles

SET LOCAL ROLE wayvro_migrator;

-- ── catalog (minimal; owned by Phase 3, extended additively) ──────────────────────────────────────────────────────
CREATE SCHEMA catalog;
CREATE TABLE catalog.cities (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name_en text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 80),
  name_ur text NOT NULL CHECK (char_length(name_ur) BETWEEN 1 AND 80),
  status text NOT NULL CHECK (status IN ('ENABLED', 'DISABLED'))
);
INSERT INTO catalog.cities (code, name_en, name_ur, status) VALUES ('LHR', 'Lahore', 'لاہور', 'ENABLED');

-- ── audit: staff actors (additive widening) ─────────────────────────────────────────────────────────────────────
ALTER TABLE audit.audit_events DROP CONSTRAINT audit_events_actor_type_check;
ALTER TABLE audit.audit_events ADD CONSTRAINT audit_events_actor_type_check CHECK (actor_type IN ('ACCOUNT', 'STAFF', 'SYSTEM', 'ANONYMOUS'));
ALTER TABLE audit.audit_events DROP CONSTRAINT audit_events_check;
ALTER TABLE audit.audit_events ADD CONSTRAINT audit_events_actor_id_check CHECK ((actor_type IN ('ACCOUNT', 'STAFF')) = (actor_id IS NOT NULL));

-- ── staff realm (separate identity space; never a consumer mode) ─────────────────────────────────────────────────
CREATE SCHEMA staff;

CREATE TABLE staff.staff_accounts (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  -- work contact (not a credential, never a lookup for authentication)
  work_email text NOT NULL CHECK (work_email = lower(work_email) AND work_email ~ '^[^@\s]{1,64}@[^@\s]{1,190}$'),
  status text NOT NULL CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED')),
  -- the staff member's own consumer account (self-review / conflict-of-interest block, CL-P2-03); optional declaration
  consumer_account_id uuid NULL REFERENCES identity.accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NULL,
  offboarded_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ((status = 'OFFBOARDED') = (offboarded_at IS NOT NULL)),
  CHECK (status = 'INVITED' OR activated_at IS NOT NULL OR status = 'OFFBOARDED')
);
CREATE UNIQUE INDEX staff_accounts_email_live ON staff.staff_accounts (work_email) WHERE status <> 'OFFBOARDED';

-- WebAuthn credentials (user verification required at registration and assertion; discoverable credentials).
CREATE TABLE staff.webauthn_credentials (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  credential_id bytea NOT NULL UNIQUE CHECK (octet_length(credential_id) BETWEEN 16 AND 1023),
  public_key bytea NOT NULL CHECK (octet_length(public_key) BETWEEN 16 AND 4096),
  sign_count bigint NOT NULL CHECK (sign_count >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  device_type text NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up boolean NOT NULL,
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 60),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE INDEX webauthn_credentials_staff ON staff.webauthn_credentials (staff_id) WHERE status = 'ACTIVE';

-- Single-use enrolment invitations (out-of-band token; only its SHA-256 is stored). Re-enrolment needs a second admin.
CREATE TABLE staff.invitations (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  kind text NOT NULL CHECK (kind IN ('ENROLMENT', 'RE_ENROLMENT', 'BOOTSTRAP')),
  status text NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'ISSUED', 'USED', 'REVOKED', 'EXPIRED')),
  token_hash bytea NULL UNIQUE CHECK (token_hash IS NULL OR octet_length(token_hash) = 32),
  created_by uuid NULL REFERENCES staff.staff_accounts (id),
  approved_by uuid NULL REFERENCES staff.staff_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz NULL,
  expires_at timestamptz NULL,
  used_at timestamptz NULL,
  CHECK ((status IN ('ISSUED', 'USED', 'EXPIRED')) <= (token_hash IS NOT NULL AND expires_at IS NOT NULL)),
  CHECK ((status = 'USED') = (used_at IS NOT NULL)),
  -- BOOTSTRAP invitations come only from the infrastructure CLI (no creating staff member)
  CHECK ((kind = 'BOOTSTRAP') = (created_by IS NULL)),
  -- maker-checker: an approver is never the requester or the invitee
  CHECK (approved_by IS NULL OR (approved_by <> created_by AND approved_by <> staff_id))
);
CREATE UNIQUE INDEX invitations_one_open_per_staff ON staff.invitations (staff_id) WHERE status IN ('PENDING_APPROVAL', 'ISSUED');

-- Server-side WebAuthn challenges (single use, short-lived).
CREATE TABLE staff.webauthn_challenges (
  id uuid PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('ENROL', 'LOGIN', 'STEP_UP', 'UNLOCK', 'ADD_CREDENTIAL')),
  challenge bytea NOT NULL CHECK (octet_length(challenge) = 32),
  staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  invitation_id uuid NULL REFERENCES staff.invitations (id),
  session_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  CHECK (expires_at > created_at),
  CHECK ((purpose = 'ENROL') = (invitation_id IS NOT NULL)),
  CHECK ((purpose IN ('STEP_UP', 'UNLOCK', 'ADD_CREDENTIAL')) = (session_id IS NOT NULL))
);
CREATE INDEX webauthn_challenges_created ON staff.webauthn_challenges (created_at);

-- Staff sessions: opaque token held only by the web-ops BFF (HttpOnly cookie); SHA-256 at rest.
CREATE TABLE staff.sessions (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  credential_id uuid NOT NULL REFERENCES staff.webauthn_credentials (id),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'LOCKED', 'REVOKED')),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  step_up_at timestamptz NULL,
  revoked_at timestamptz NULL,
  revoke_reason text NULL CHECK (revoke_reason IN ('STAFF_LOGOUT', 'OFFBOARDED', 'ADMIN_REVOKED', 'CREDENTIAL_REVOKED', 'SUSPENDED')),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)),
  CHECK (absolute_expires_at > created_at)
);
CREATE INDEX staff_sessions_live ON staff.sessions (staff_id) WHERE status <> 'REVOKED';
ALTER TABLE staff.webauthn_challenges ADD CONSTRAINT webauthn_challenges_session_fk FOREIGN KEY (session_id) REFERENCES staff.sessions (id);

-- Role assignments: roles and permissions are CODE-defined (no runtime role creation); the database stores
-- assignments only. Maker-checker: a different STAFF_ADMIN approves (never the grantee or the requester).
CREATE TABLE staff.role_assignments (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  role text NOT NULL CHECK (role IN ('KYC_REVIEWER', 'KYC_SENIOR_REVIEWER', 'COMPLIANCE_ADMIN', 'TRUST_SAFETY_AGENT', 'SUPPORT_AGENT', 'STAFF_ADMIN', 'AUDITOR')),
  status text NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'REVOKED')),
  -- NULL only for the bootstrap STAFF_ADMIN created by the infrastructure CLI
  requested_by uuid NULL REFERENCES staff.staff_accounts (id),
  approved_by uuid NULL REFERENCES staff.staff_accounts (id),
  decided_at timestamptz NULL,
  valid_from timestamptz NULL,
  valid_until timestamptz NULL,
  revoked_by uuid NULL REFERENCES staff.staff_accounts (id),
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requested_by IS NULL OR requested_by <> staff_id),
  CHECK (approved_by IS NULL OR (approved_by <> staff_id AND approved_by IS DISTINCT FROM requested_by)),
  CHECK ((status = 'ACTIVE') <= (valid_from IS NOT NULL)),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL)),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);
CREATE UNIQUE INDEX role_assignments_one_live ON staff.role_assignments (staff_id, role) WHERE status IN ('PENDING_APPROVAL', 'ACTIVE');

-- City scope of an assignment (junction with a real FK, replaces a text[] scope).
CREATE TABLE staff.role_assignment_cities (
  assignment_id uuid NOT NULL REFERENCES staff.role_assignments (id),
  city_code text NOT NULL REFERENCES catalog.cities (code),
  PRIMARY KEY (assignment_id, city_code)
);

-- Break-glass: scoped, reason-coded, <= 60 minutes, alerted at start/end, mandatory review within 72 h.
CREATE TABLE staff.break_glass_grants (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  session_id uuid NOT NULL REFERENCES staff.sessions (id),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  justification text NOT NULL CHECK (char_length(justification) BETWEEN 10 AND 500),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'ENDED', 'EXPIRED', 'REVIEWED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz NULL,
  reviewed_by uuid NULL REFERENCES staff.staff_accounts (id),
  reviewed_at timestamptz NULL,
  review_outcome text NULL CHECK (review_outcome IN ('JUSTIFIED', 'NOT_JUSTIFIED')),
  CHECK (expires_at > started_at AND expires_at <= started_at + interval '60 minutes'),
  CHECK ((status = 'REVIEWED') = (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND review_outcome IS NOT NULL)),
  CHECK (reviewed_by IS NULL OR reviewed_by <> staff_id)
);
CREATE UNIQUE INDEX break_glass_one_active ON staff.break_glass_grants (staff_id) WHERE status = 'ACTIVE';

-- Reason-for-access records (W07): the free-text justification stays here, never in the audit log (codes only).
CREATE TABLE staff.access_reasons (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  session_id uuid NOT NULL REFERENCES staff.sessions (id),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  reason_text text NULL CHECK (reason_text IS NULL OR char_length(reason_text) BETWEEN 5 AND 500),
  audit_event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER access_reasons_append_only BEFORE UPDATE OR DELETE ON staff.access_reasons FOR EACH ROW EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER access_reasons_no_truncate BEFORE TRUNCATE ON staff.access_reasons FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA staff, catalog TO wayvro_api;
GRANT SELECT ON catalog.cities TO wayvro_api;
GRANT SELECT, INSERT, UPDATE ON staff.staff_accounts, staff.webauthn_credentials, staff.invitations, staff.webauthn_challenges, staff.sessions,
  staff.role_assignments, staff.break_glass_grants TO wayvro_api;
GRANT SELECT, INSERT ON staff.role_assignment_cities, staff.access_reasons TO wayvro_api;
-- ── audit viewer (AUDITOR, Q39) ─────────────────────────────────────────────────────────────────────────────────
-- The API role still cannot SELECT/UPDATE/DELETE audit tables directly. The viewer reads through bounded,
-- read-only SECURITY DEFINER functions (max 100 rows per call, keyset pagination); seal-verification results are
-- recorded by the sealer job and read the same way.
CREATE TABLE audit.seal_verifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  verified_at timestamptz NOT NULL DEFAULT now(),
  seals_checked integer NOT NULL CHECK (seals_checked >= 0),
  ok boolean NOT NULL,
  first_bad_seal_no bigint NULL,
  unsealed_below_watermark integer NOT NULL CHECK (unsealed_below_watermark >= 0),
  CHECK (ok = (first_bad_seal_no IS NULL AND unsealed_below_watermark = 0))
);
CREATE TRIGGER seal_verifications_append_only BEFORE UPDATE OR DELETE ON audit.seal_verifications FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER seal_verifications_no_truncate BEFORE TRUNCATE ON audit.seal_verifications FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
GRANT SELECT, INSERT ON audit.seal_verifications TO wayvro_audit_sealer;

CREATE FUNCTION audit.list_events(p_before_seq bigint, p_limit integer, p_actor_type text, p_actor_id uuid, p_action text, p_object_type text, p_object_id uuid)
  RETURNS TABLE (seq bigint, id uuid, occurred_at timestamptz, actor_type text, actor_id uuid, action text, object_type text, object_id uuid, outcome text, reason_code text, request_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $fn$
    SELECT e.seq, e.id, e.occurred_at, e.actor_type, e.actor_id, e.action, e.object_type, e.object_id, e.outcome, e.reason_code, e.request_id
      FROM audit.audit_events e
     WHERE (p_before_seq IS NULL OR e.seq < p_before_seq)
       AND (p_actor_type IS NULL OR e.actor_type = p_actor_type)
       AND (p_actor_id IS NULL OR e.actor_id = p_actor_id)
       AND (p_action IS NULL OR e.action = p_action)
       AND (p_object_type IS NULL OR e.object_type = p_object_type)
       AND (p_object_id IS NULL OR e.object_id = p_object_id)
     ORDER BY e.seq DESC
     LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
  $fn$;

CREATE FUNCTION audit.seal_status()
  RETURNS TABLE (seal_count bigint, last_sealed_seq bigint, last_sealed_at timestamptz, last_verified_at timestamptz, last_verification_ok boolean, first_bad_seal_no bigint, unsealed_below_watermark integer)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $fn$
    SELECT (SELECT count(*) FROM audit.audit_seals),
           (SELECT max(last_seq) FROM audit.audit_seals),
           (SELECT max(sealed_at) FROM audit.audit_seals),
           v.verified_at, v.ok, v.first_bad_seal_no, v.unsealed_below_watermark
      FROM (SELECT 1) one
      LEFT JOIN LATERAL (SELECT * FROM audit.seal_verifications ORDER BY id DESC LIMIT 1) v ON true
  $fn$;
REVOKE ALL ON FUNCTION audit.list_events(bigint, integer, text, uuid, text, text, uuid), audit.seal_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.list_events(bigint, integer, text, uuid, text, text, uuid), audit.seal_status() TO wayvro_api;

-- worker housekeeping: expire challenges/invitations/break-glass grants and purge used challenges
GRANT USAGE ON SCHEMA staff TO wayvro_worker;
GRANT SELECT, DELETE ON staff.webauthn_challenges TO wayvro_worker;
GRANT SELECT (id, status, expires_at), UPDATE (status) ON staff.invitations TO wayvro_worker;
GRANT SELECT (id, staff_id, status, expires_at), UPDATE (status, ended_at) ON staff.break_glass_grants TO wayvro_worker;

RESET ROLE;
