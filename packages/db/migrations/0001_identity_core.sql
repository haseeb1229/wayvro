-- wayvro-migration: 0001_identity_core
-- compatibility: additive (expand) — new roles, schemas and tables only; no existing object is altered; safe with every Phase 1 application version (none reads these tables)
-- data-impact: none — no data is moved or rewritten; tables start empty. Holds synthetic data only until the Phase 7 gates (CLAUDE.md §11)
-- rollback: before any real data exists (pre-Phase 7): DROP SCHEMA audit, platform, profile, identity CASCADE in that order, then drop the NOLOGIN roles wayvro_api, wayvro_worker, wayvro_realtime, wayvro_audit_sealer, wayvro_migrator if no other database uses them (roles are cluster-wide). Afterwards: forward-fix only. Requires CREATEROLE for the role block and membership in wayvro_migrator for SET ROLE (managed PostgreSQL: run the role block from an infra bootstrap script instead — docs/adr/ADR-038)
-- verification: packages/db/test/identity-core.integration.test.ts — clean->latest, previous->latest, re-run applies 0, constraint/index/trigger facts, and grant checks executed as LOGIN members of each restricted role

-- Group roles (NOLOGIN; LOGIN roles are provisioned per environment and granted membership). Roles are cluster-wide,
-- so creation is idempotent: throwaway test databases in the same cluster reuse them. Two databases of one cluster
-- migrating at the same moment can both pass the NOT EXISTS check (advisory locks are per database), so a concurrent
-- creation of the same role is accepted; the role's attributes are then asserted below, so nothing is silently trusted.
DO $roles$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['wayvro_migrator', 'wayvro_api', 'wayvro_worker', 'wayvro_realtime', 'wayvro_audit_sealer'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      BEGIN
        EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', r);
      EXCEPTION
        WHEN duplicate_object OR unique_violation THEN
          RAISE NOTICE 'role % was created concurrently by another migration', r;
      END;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN
      RAISE EXCEPTION 'group role % must be NOLOGIN, NOSUPERUSER and NOBYPASSRLS', r;
    END IF;
  END LOOP;
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO wayvro_migrator', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO wayvro_api, wayvro_worker, wayvro_realtime, wayvro_audit_sealer', current_database());
END
$roles$;

-- Every object below is owned by wayvro_migrator, never by an application role (owners can bypass grants/triggers).
SET LOCAL ROLE wayvro_migrator;

CREATE SCHEMA identity;
CREATE SCHEMA profile;
CREATE SCHEMA platform;
CREATE SCHEMA audit;

-- ── identity ────────────────────────────────────────────────────────────────────────────────────────────────────
-- One row per ACCOUNT (not per human): person-level uniqueness is never a database claim (data model §1).
CREATE TABLE identity.accounts (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('ACTIVE')),
  display_name text NULL CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 60),
  preferred_locale text NOT NULL CHECK (preferred_locale IN ('en', 'ur', 'ur-Latn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE TABLE identity.account_phones (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  -- versioned AES-256-GCM envelope (data model §8.1); the plaintext E.164 number is never stored
  phone_envelope bytea NOT NULL CHECK (octet_length(phone_envelope) > 31),
  phone_last4 char(4) NOT NULL CHECK (phone_last4 ~ '^[0-9]{4}$'),
  status text NOT NULL CHECK (status IN ('VERIFIED')),
  verified_at timestamptz NOT NULL
);
-- INVARIANT: one account has at most one CURRENT verified phone.
CREATE UNIQUE INDEX account_phones_one_verified_per_account ON identity.account_phones (account_id) WHERE status = 'VERIFIED';

-- Deterministic HMAC-SHA-256 lookups, one row per live lookup-key version (data model §8.3).
CREATE TABLE identity.phone_lookup_index (
  account_phone_id uuid NOT NULL REFERENCES identity.account_phones (id),
  lookup_key_version smallint NOT NULL CHECK (lookup_key_version > 0),
  lookup_hash bytea NOT NULL CHECK (octet_length(lookup_hash) = 32),
  is_current_owner boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_phone_id, lookup_key_version)
);
-- INVARIANT: one current verified phone belongs to at most one account, within every lookup-key version.
CREATE UNIQUE INDEX phone_lookup_current_owner ON identity.phone_lookup_index (lookup_key_version, lookup_hash) WHERE is_current_owner;

CREATE TABLE identity.otp_challenges (
  id uuid PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('SIGN_IN')),
  phone_lookup_key_version smallint NOT NULL CHECK (phone_lookup_key_version > 0),
  phone_lookup_hash bytea NOT NULL CHECK (octet_length(phone_lookup_hash) = 32),
  -- needed to create the account phone at verification; short retention (purge job)
  phone_envelope bytea NOT NULL CHECK (octet_length(phone_envelope) > 31),
  -- HMAC-SHA-256 over (challenge id, code); the code itself is never stored. NULL only for SUPPRESSED challenges.
  code_mac bytea NULL CHECK (code_mac IS NULL OR octet_length(code_mac) = 32),
  mac_key_version smallint NULL CHECK (mac_key_version IS NULL OR mac_key_version > 0),
  channel text NOT NULL CHECK (channel IN ('SMS')),
  -- message/account locale requested with the challenge (used for the SMS text and a new account's preferred locale)
  locale text NOT NULL CHECK (locale IN ('en', 'ur', 'ur-Latn')),
  installation_hash bytea NOT NULL CHECK (octet_length(installation_hash) = 32),
  client_ip_prefix_hash bytea NULL CHECK (client_ip_prefix_hash IS NULL OR octet_length(client_ip_prefix_hash) = 32),
  status text NOT NULL CHECK (status IN ('ISSUED', 'SUPPRESSED', 'DELIVERY_FAILED', 'CONSUMED', 'EXPIRED', 'LOCKED', 'SUPERSEDED')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts smallint NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  resend_count smallint NOT NULL DEFAULT 0 CHECK (resend_count BETWEEN 0 AND 10),
  next_resend_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  provider_message_ref text NULL CHECK (provider_message_ref IS NULL OR char_length(provider_message_ref) <= 200),
  supersedes_id uuid NULL REFERENCES identity.otp_challenges (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (attempts <= max_attempts),
  CHECK (expires_at > created_at),
  CHECK ((status = 'CONSUMED') = (consumed_at IS NOT NULL)),
  CHECK ((status = 'SUPPRESSED') = (code_mac IS NULL)),
  CHECK ((code_mac IS NULL) = (mac_key_version IS NULL))
);
CREATE INDEX otp_challenges_live ON identity.otp_challenges (phone_lookup_key_version, phone_lookup_hash, purpose, installation_hash) WHERE status = 'ISSUED';
CREATE INDEX otp_challenges_created_at ON identity.otp_challenges (created_at);

CREATE TABLE identity.account_devices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  -- SHA-256 of the app-generated random installation id (not a hardware identifier)
  installation_hash bytea NOT NULL CHECK (octet_length(installation_hash) = 32),
  platform text NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
  app_version text NOT NULL CHECK (char_length(app_version) BETWEEN 1 AND 32),
  first_verified_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  trust_state text NOT NULL CHECK (trust_state IN ('NEW', 'KNOWN')),
  UNIQUE (account_id, installation_hash)
);

CREATE TABLE identity.sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  device_id uuid NOT NULL REFERENCES identity.account_devices (id),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  assurance text NOT NULL CHECK (assurance IN ('OTP')),
  -- SHA-256 of the opaque access token; raw tokens are never stored
  access_token_hash bytea NOT NULL UNIQUE CHECK (octet_length(access_token_hash) = 32),
  access_expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  revoke_reason text NULL CHECK (revoke_reason IN ('USER_LOGOUT', 'USER_LOGOUT_ALL', 'USER_SESSION_REVOKED', 'REFRESH_REUSE')),
  app_version text NOT NULL CHECK (char_length(app_version) BETWEEN 1 AND 32),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)),
  CHECK (access_expires_at <= absolute_expires_at),
  CHECK (idle_expires_at <= absolute_expires_at)
);
CREATE INDEX sessions_account_active ON identity.sessions (account_id) WHERE status = 'ACTIVE';

CREATE TABLE identity.refresh_tokens (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES identity.sessions (id),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  successor_id uuid NULL REFERENCES identity.refresh_tokens (id),
  CHECK (expires_at > issued_at),
  CHECK (successor_id IS NULL OR used_at IS NOT NULL)
);
-- INVARIANT: one live (unused) refresh token per session; the family is the session.
CREATE UNIQUE INDEX refresh_tokens_one_live_per_session ON identity.refresh_tokens (session_id) WHERE used_at IS NULL;

-- Account-facing security activity (A11). Ids and event codes only — no IP address, location or phone number.
CREATE TABLE identity.security_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  type text NOT NULL CHECK (
    type IN (
      'SIGN_IN',
      'SIGN_IN_NEW_DEVICE',
      'DORMANT_ACCOUNT_NEW_INSTALLATION',
      'SIGNED_OUT',
      'SESSION_REVOKED',
      'SESSIONS_REVOKED_ALL',
      'SESSIONS_REVOKED_OTHERS',
      'REFRESH_TOKEN_REUSE_DETECTED',
      'PROFILE_UPDATED'
    )
  ),
  session_id uuid NULL REFERENCES identity.sessions (id),
  device_id uuid NULL REFERENCES identity.account_devices (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_account_time ON identity.security_events (account_id, created_at DESC);

-- ── profile ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE profile.rider_profiles (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES identity.accounts (id),
  status text NOT NULL CHECK (status IN ('ACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id <> account_id)
);

-- ── platform ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Persistent idempotency (F-03). The row is inserted PENDING and completed in the same transaction as the mutation,
-- so a concurrent duplicate blocks on the primary key and then replays the committed response.
CREATE TABLE platform.idempotency_records (
  -- row id bound into the response envelope's AAD (the natural key is composite)
  id uuid NOT NULL UNIQUE,
  actor_scope text NOT NULL CHECK (char_length(actor_scope) BETWEEN 3 AND 100),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  operation text NOT NULL CHECK (operation ~ '^[a-z][a-z0-9.-]{2,63}$'),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  state text NOT NULL CHECK (state IN ('PENDING', 'COMPLETED')),
  response_status smallint NULL CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  -- AES-256-GCM envelope of the response body (key class idempotency_responses), bound to (scope, key) by AAD
  response_envelope bytea NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (actor_scope, idempotency_key),
  CHECK (expires_at > created_at),
  CHECK ((state = 'COMPLETED') = (response_status IS NOT NULL AND response_envelope IS NOT NULL))
);
CREATE INDEX idempotency_records_expiry ON platform.idempotency_records (expires_at);

-- PostgreSQL job queue claimed with FOR UPDATE SKIP LOCKED (ADR-042). `payload` carries ids/codes only;
-- `sealed_payload` is an AEAD envelope for transient secrets (an OTP message) and is purged when the job finishes.
CREATE TABLE platform.jobs (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$'),
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'DEAD')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  sealed_payload bytea NULL,
  dedupe_key text NULL CHECK (dedupe_key IS NULL OR char_length(dedupe_key) BETWEEN 1 AND 200),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts smallint NOT NULL CHECK (max_attempts BETWEEN 1 AND 50),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NULL,
  -- diagnostic only (process-derived ids can collide across containers); never used for fencing
  locked_by text NULL CHECK (locked_by IS NULL OR char_length(locked_by) <= 100),
  -- fencing token: a fresh random uuid per CLAIM; every RUNNING -> terminal/retry transition requires it (ADR-042)
  lease_token uuid NULL,
  last_error_code text NULL CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  CHECK (attempts <= max_attempts),
  CHECK ((status = 'RUNNING') = (lease_expires_at IS NOT NULL AND locked_by IS NOT NULL AND lease_token IS NOT NULL)),
  CHECK ((status IN ('SUCCEEDED', 'DEAD')) = (finished_at IS NOT NULL)),
  CHECK (status IN ('QUEUED', 'RUNNING') OR sealed_payload IS NULL)
);
CREATE INDEX jobs_claimable ON platform.jobs (type, run_after) WHERE status = 'QUEUED';
CREATE INDEX jobs_running_leases ON platform.jobs (lease_expires_at) WHERE status = 'RUNNING';
CREATE INDEX jobs_finished ON platform.jobs (finished_at) WHERE status IN ('SUCCEEDED', 'DEAD');
-- At most one queued/running instance per (type, dedupe key): recurring maintenance jobs are scheduled idempotently.
CREATE UNIQUE INDEX jobs_dedupe_open ON platform.jobs (type, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('QUEUED', 'RUNNING');

-- Resumable key-rotation progress (data model §8.2/§8.3).
CREATE TABLE platform.key_rotations (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('FIELD_REENCRYPTION', 'LOOKUP_BACKFILL')),
  target text NOT NULL CHECK (target ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+$'),
  key_class text NOT NULL CHECK (key_class ~ '^[a-z][a-z_]{1,40}$'),
  from_version smallint NOT NULL CHECK (from_version > 0),
  to_version smallint NOT NULL,
  phase text NOT NULL CHECK (phase IN ('BACKFILL', 'READ_SWITCHED', 'RETIRE_PENDING', 'DONE', 'ABANDONED')),
  cursor_id uuid NULL,
  processed_count bigint NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  rewritten_count bigint NOT NULL DEFAULT 0 CHECK (rewritten_count >= 0),
  skipped_concurrent_count bigint NOT NULL DEFAULT 0 CHECK (skipped_concurrent_count >= 0),
  conflict_count bigint NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CHECK (to_version > from_version),
  CHECK ((phase IN ('DONE', 'ABANDONED')) = (completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX key_rotations_one_open_per_target ON platform.key_rotations (target) WHERE phase NOT IN ('DONE', 'ABANDONED');

-- ── audit ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- Append-only privileged/security audit (Q39). Ids and reason codes only; never PII values, OTPs, tokens or keys.
CREATE TABLE audit.audit_events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (actor_type IN ('ACCOUNT', 'SYSTEM', 'ANONYMOUS')),
  actor_id uuid NULL,
  action text NOT NULL CHECK (action ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  -- intentionally polymorphic (data model §3.6): the log spans every subject type and never blocks a delete via FK
  object_type text NOT NULL CHECK (object_type ~ '^[a-z][a-z0-9_.]{1,63}$'),
  object_id uuid NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILURE')),
  reason_code text NULL CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  request_id text NULL CHECK (request_id IS NULL OR request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  CHECK ((actor_type = 'ACCOUNT') = (actor_id IS NOT NULL))
);

-- Tamper-evidence: SHA-256 Merkle root per sealed range plus a hash chain across seals (sealer job in apps/worker).
-- A database superuser can still rewrite rows and recompute seals; external anchoring is gate EG-05 (documented).
CREATE TABLE audit.audit_seals (
  seal_no bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_seq bigint NOT NULL,
  last_seq bigint NOT NULL,
  leaf_count integer NOT NULL CHECK (leaf_count >= 1),
  merkle_root bytea NOT NULL CHECK (octet_length(merkle_root) = 32),
  prev_seal_hash bytea NULL CHECK (prev_seal_hash IS NULL OR octet_length(prev_seal_hash) = 32),
  seal_hash bytea NOT NULL UNIQUE CHECK (octet_length(seal_hash) = 32),
  algorithm text NOT NULL CHECK (algorithm = 'sha256-merkle-v1'),
  sealed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (last_seq >= first_seq),
  CHECK (leaf_count <= last_seq - first_seq + 1),
  -- sealed ranges never overlap (GiST range ops are built in; no extension needed)
  CONSTRAINT audit_seals_no_overlap EXCLUDE USING gist (int8range(first_seq, last_seq, '[]') WITH &&)
);

CREATE FUNCTION audit.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  RAISE EXCEPTION 'audit.% is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$fn$;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit.audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER audit_seals_append_only BEFORE UPDATE OR DELETE ON audit.audit_seals FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER audit_seals_no_truncate BEFORE TRUNCATE ON audit.audit_seals FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
REVOKE ALL ON FUNCTION audit.reject_mutation() FROM PUBLIC;

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA identity, profile, platform, audit TO wayvro_api;
GRANT SELECT, INSERT, UPDATE ON identity.accounts, identity.otp_challenges, identity.account_devices, identity.sessions, identity.refresh_tokens TO wayvro_api;
GRANT SELECT, INSERT ON identity.account_phones, identity.phone_lookup_index, identity.security_events TO wayvro_api;
GRANT SELECT, INSERT ON profile.rider_profiles TO wayvro_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.idempotency_records TO wayvro_api;
GRANT INSERT ON platform.jobs TO wayvro_api;
-- the phone lookup read/write version sets depend on the latest lookup-key rotation's phase and versions (ADR-038 §lookup)
GRANT SELECT (id, target, phase, from_version, to_version, started_at) ON platform.key_rotations TO wayvro_api;
GRANT INSERT ON audit.audit_events TO wayvro_api;

GRANT USAGE ON SCHEMA identity, platform, audit TO wayvro_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.jobs TO wayvro_worker;
GRANT SELECT, UPDATE, DELETE ON identity.otp_challenges TO wayvro_worker;
GRANT SELECT, DELETE ON platform.idempotency_records TO wayvro_worker;
GRANT SELECT, INSERT, UPDATE ON platform.key_rotations TO wayvro_worker;
GRANT SELECT (id, account_id, phone_envelope, status), UPDATE (phone_envelope) ON identity.account_phones TO wayvro_worker;
GRANT SELECT, INSERT, DELETE ON identity.phone_lookup_index TO wayvro_worker;
GRANT INSERT ON audit.audit_events TO wayvro_worker;

-- Realtime only verifies sessions: column-level SELECT, nothing else.
GRANT USAGE ON SCHEMA identity TO wayvro_realtime;
GRANT SELECT (id, account_id, status, access_token_hash, access_expires_at, idle_expires_at, absolute_expires_at) ON identity.sessions TO wayvro_realtime;
GRANT SELECT (id, status) ON identity.accounts TO wayvro_realtime;

GRANT USAGE ON SCHEMA audit TO wayvro_audit_sealer;
GRANT SELECT ON audit.audit_events TO wayvro_audit_sealer;
GRANT SELECT, INSERT ON audit.audit_seals TO wayvro_audit_sealer;

RESET ROLE;
