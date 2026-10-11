-- wayvro-migration: 0008_oidc
-- compatibility: additive (expand) — new tables identity.oidc_nonces and identity.oidc_identities; widened CHECKs on identity.sessions (assurance OIDC), identity.security_events (OIDC events) and identity.phone_change_requests (kind RECOVERY_OIDC_PROOF + its proof column); every existing row satisfies the widened rules. Safe with every P2.1–P2.9 application version: none writes the new values
-- data-impact: none — no data is moved or rewritten; tables start empty. Only the provider and the opaque subject identifier of a linked identity are stored: no e-mail, no name, no token (data minimisation; the e-mail channel is deferred, founder Q-03). Synthetic data only until the Phase 7 gates
-- rollback: before any real data exists (pre-Phase 7): drop the phone_change_requests column/constraints and restore the 0007 CHECKs; DROP TABLE identity.oidc_identities, identity.oidc_nonces; restore the 0001/0007 CHECKs (only while no row uses a new value). Afterwards: forward-fix only
-- verification: packages/db/test/oidc.integration.test.ts — clean->latest, every previous->latest, re-run 0, single-use installation/session-bound nonces, one LINKED owner per (provider, subject) and one LINKED identity per (account, provider), the OIDC-proof recovery kind, grants as restricted roles

SET LOCAL ROLE wayvro_migrator;

-- ── sessions: an OIDC sign-in is its own assurance (auth design §7) ─────────────────────────────────────────────
ALTER TABLE identity.sessions DROP CONSTRAINT sessions_assurance_check;
ALTER TABLE identity.sessions ADD CONSTRAINT sessions_assurance_check CHECK (assurance IN ('OTP', 'OIDC'));
-- founder Q-02: an OIDC session on a device unknown to the account must step up on the phone before anything else
ALTER TABLE identity.sessions ADD COLUMN phone_step_up_required boolean NOT NULL DEFAULT false;
ALTER TABLE identity.sessions ADD CONSTRAINT sessions_phone_step_up_check CHECK (NOT phone_step_up_required OR assurance = 'OIDC');

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
    'DELETION_CANCELLED',
    'SIGN_IN_OIDC',
    'OIDC_LINKED',
    'OIDC_UNLINKED'
  )
);

-- ── server-issued single-use nonces (5 min): sign-in nonces are bound to the installation, link/recovery nonces
-- to the requesting session. Only the SHA-256 of the nonce is stored.
CREATE TABLE identity.oidc_nonces (
  id uuid PRIMARY KEY,
  nonce_sha256 bytea NOT NULL UNIQUE CHECK (octet_length(nonce_sha256) = 32),
  purpose text NOT NULL CHECK (purpose IN ('SIGN_IN', 'LINK', 'RECOVERY')),
  installation_hash bytea NULL CHECK (octet_length(installation_hash) = 32),
  session_id uuid NULL REFERENCES identity.sessions (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  CHECK (expires_at > created_at),
  CHECK ((purpose = 'SIGN_IN') = (installation_hash IS NOT NULL)),
  CHECK ((purpose = 'SIGN_IN') = (session_id IS NULL))
);
CREATE INDEX oidc_nonces_created_at ON identity.oidc_nonces (created_at);

-- ── linked identities (K15/K16/S13): provider + opaque subject only; never an e-mail key, never a merge ─────────
CREATE TABLE identity.oidc_identities (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  provider text NOT NULL CHECK (provider IN ('GOOGLE', 'APPLE')),
  -- the provider's opaque subject; erased (NULL) only for an UNLINKED identity of a deleted account
  subject text NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  status text NOT NULL CHECK (status IN ('LINKED', 'UNLINKED')),
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ((status = 'UNLINKED') = (unlinked_at IS NOT NULL)),
  CHECK (subject IS NOT NULL OR status = 'UNLINKED')
);
-- INVARIANT: a provider identity is linked to at most one account; an account links at most one identity per provider
CREATE UNIQUE INDEX oidc_identities_one_owner ON identity.oidc_identities (provider, subject) WHERE status = 'LINKED';
CREATE UNIQUE INDEX oidc_identities_one_per_provider ON identity.oidc_identities (account_id, provider) WHERE status = 'LINKED';

-- ── lost-phone recovery proven by a linked identity (auth design §6.4): straight to the 72 h cooldown ───────────
ALTER TABLE identity.phone_change_requests ADD COLUMN proof_oidc_identity_id uuid NULL REFERENCES identity.oidc_identities (id);
ALTER TABLE identity.phone_change_requests DROP CONSTRAINT phone_change_requests_kind_check;
ALTER TABLE identity.phone_change_requests ADD CONSTRAINT phone_change_requests_kind_check
  CHECK (kind IN ('SELF_SERVICE', 'RECOVERY_DRIVER_KYC', 'RECOVERY_OIDC_PROOF'));
ALTER TABLE identity.phone_change_requests DROP CONSTRAINT phone_change_requests_check1;
ALTER TABLE identity.phone_change_requests ADD CONSTRAINT phone_change_requests_requester_check
  CHECK ((kind IN ('RECOVERY_DRIVER_KYC', 'RECOVERY_OIDC_PROOF')) = (requested_by_account_id IS NOT NULL));
ALTER TABLE identity.phone_change_requests ADD CONSTRAINT phone_change_requests_oidc_proof_check
  CHECK ((kind = 'RECOVERY_OIDC_PROOF') = (proof_oidc_identity_id IS NOT NULL));
ALTER TABLE identity.phone_change_requests ADD CONSTRAINT phone_change_requests_oidc_status_check
  CHECK (kind <> 'RECOVERY_OIDC_PROOF' OR status IN ('COOLDOWN', 'COMPLETED', 'CANCELLED', 'EXPIRED'));

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON identity.oidc_nonces, identity.oidc_identities TO wayvro_api;
-- worker: nonce purge; deletion unlinks the identities of a deleted account; completion reads the proof kind
GRANT SELECT (id, created_at), DELETE ON identity.oidc_nonces TO wayvro_worker;
GRANT SELECT (id, account_id, status, unlinked_at, version), UPDATE (status, unlinked_at, subject, version) ON identity.oidc_identities TO wayvro_worker;

RESET ROLE;
