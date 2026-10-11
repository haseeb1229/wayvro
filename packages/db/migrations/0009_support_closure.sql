-- wayvro-migration: 0009_support_closure
-- compatibility: additive (expand) — two widened CHECKs: session revoke reason STAFF_ON_BEHALF and the account-facing security event SESSIONS_REVOKED_BY_SUPPORT (Phase-2 closure: the accepted staff matrix's support capabilities). Every existing row satisfies the widened rules; safe with every P2.1–P2.10 application version (none writes the new values)
-- data-impact: none — no data is moved or rewritten. Synthetic data only until the Phase 7 gates
-- rollback: before any real data exists (pre-Phase 7): restore the 0007/0008 CHECKs (only while no row uses a new value). Afterwards: forward-fix only
-- verification: packages/db/test/support-closure.integration.test.ts — clean->latest, every previous->latest, re-run 0, the widened CHECKs accept exactly the new values

SET LOCAL ROLE wayvro_migrator;

ALTER TABLE identity.sessions DROP CONSTRAINT sessions_revoke_reason_check;
ALTER TABLE identity.sessions ADD CONSTRAINT sessions_revoke_reason_check CHECK (
  revoke_reason IN (
    'USER_LOGOUT',
    'USER_LOGOUT_ALL',
    'USER_SESSION_REVOKED',
    'REFRESH_REUSE',
    'PHONE_CHANGED',
    'RECOVERY',
    'RESTRICTION_SECURITY_HOLD',
    'ACCOUNT_DELETED',
    'STAFF_ON_BEHALF'
  )
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
    'DELETION_CANCELLED',
    'SIGN_IN_OIDC',
    'OIDC_LINKED',
    'OIDC_UNLINKED',
    'SESSIONS_REVOKED_BY_SUPPORT'
  )
);

RESET ROLE;
