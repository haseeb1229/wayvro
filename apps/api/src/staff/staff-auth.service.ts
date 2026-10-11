/**
 * Staff authentication (K10/Q42/H01): invitation enrolment, WebAuthn sign-in, step-up, idle unlock, logout, own
 * authenticators. No password, no TOTP, no emergency credential exists (staff matrix §1–§2). Assertion attempts are
 * throttled per client IP and per staff member (Valkey; the limiter fails closed). Every outcome is audited.
 */
import { createHash } from 'node:crypto';
import type { WayvroEnv } from '@wayvro/config';
import type { StaffMe } from '@wayvro/contracts';
import type { KeyedHasher } from '@wayvro/field-crypto';
import { WayvroError } from '@wayvro/observability';
import { LimiterUnavailableError, appendAudit, uuidv7, type RateLimiter } from '@wayvro/server-runtime';
import type pg from 'pg';
import { failure, success, type IdempotencyStore, type IdempotentResult } from '../platform/idempotency.js';
import { openStaffSession, stepUpFresh, type StaffPrincipal, type StaffSessionPolicy } from './staff-session.js';
import type { StaffWebAuthn } from './webauthn.js';

export interface StaffAuthPolicy extends StaffSessionPolicy {
  readonly IDEMPOTENCY_TTL_SECONDS: number;
  readonly WAYVRO_ENV: WayvroEnv;
  readonly STAFF_ASSERTIONS_PER_IP_PER_10_MIN: number;
  readonly STAFF_ASSERTIONS_PER_STAFF_PER_10_MIN: number;
}

/** SHA-256 of an out-of-band invitation token (only the hash is stored). */
export function invitationTokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export class StaffAuthService {
  constructor(
    private readonly db: pg.Pool,
    private readonly webauthn: StaffWebAuthn,
    private readonly idempotency: IdempotencyStore,
    private readonly limiter: RateLimiter,
    private readonly hasher: KeyedHasher,
    private readonly policy: StaffAuthPolicy,
  ) {}

  /** Per-IP throttle on every unauthenticated ceremony step (generic 429; limiter down ⇒ fail closed 503). */
  async admit(clientIp: string, staffId?: string): Promise<void> {
    const ipKey = this.hasher.active('risk_signals', `ip:${clientIp}`).digest.toString('hex');
    const rules = [{ key: `staff:assert:ip:${ipKey}`, limit: this.policy.STAFF_ASSERTIONS_PER_IP_PER_10_MIN, windowSeconds: 600 }];
    if (staffId) rules.push({ key: `staff:assert:staff:${staffId}`, limit: this.policy.STAFF_ASSERTIONS_PER_STAFF_PER_10_MIN, windowSeconds: 600 });
    let decision;
    try {
      decision = await this.limiter.consume(rules);
    } catch (e) {
      if (e instanceof LimiterUnavailableError) throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE', { cause: e });
      throw e;
    }
    if (!decision.allowed) throw new WayvroError('WAYVRO_E_RATE_LIMITED', { details: { retryAfterSeconds: Math.max(1, decision.retryAfterSeconds) } });
  }

  private async openInvitation(
    q: pg.PoolClient | pg.Pool,
    token: string,
  ): Promise<{ id: string; kind: string; staffId: string; displayName: string; workEmail: string } | null> {
    const r = await q.query<{ id: string; kind: string; staff_id: string; display_name: string; work_email: string }>(
      `select i.id, i.kind, i.staff_id, a.display_name, a.work_email
         from staff.invitations i join staff.staff_accounts a on a.id = i.staff_id
        where i.token_hash = $1 and i.status = 'ISSUED' and i.expires_at > now() and a.status in ('INVITED', 'ACTIVE')`,
      [invitationTokenHash(token)],
    );
    const row = r.rows[0];
    return row ? { id: row.id, kind: row.kind, staffId: row.staff_id, displayName: row.display_name, workEmail: row.work_email } : null;
  }

  async enrolmentOptions(invitationToken: string, key: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      {
        scope: `inv:${invitationTokenHash(invitationToken).toString('hex').slice(0, 32)}`,
        operation: 'staff-auth.enrolment-options',
        key,
        payload: { invitationToken },
        ttlSeconds: 300,
      },
      async (tx) => {
        const inv = await this.openInvitation(tx, invitationToken);
        if (!inv) return failure('WAYVRO_E_UNAUTHENTICATED');
        const opts = await this.webauthn.registrationOptions(
          tx,
          'ENROL',
          { id: inv.staffId, displayName: inv.displayName, workEmail: inv.workEmail },
          { invitationId: inv.id },
        );
        return success(200, opts);
      },
    );
  }

  async enrol(
    input: { challengeId: string; invitationToken: string; credential: Record<string, unknown>; nickname: string },
    key: string,
  ): Promise<IdempotentResult> {
    return this.idempotency.execute(
      {
        scope: `inv:${invitationTokenHash(input.invitationToken).toString('hex').slice(0, 32)}`,
        operation: 'staff-auth.enrol',
        key,
        payload: input,
        ttlSeconds: 300,
      },
      async (tx) => {
        const inv = await this.openInvitation(tx, input.invitationToken);
        if (!inv) return failure('WAYVRO_E_UNAUTHENTICATED');
        const cred = await this.webauthn.verifyRegistration(tx, 'ENROL', input.challengeId, { invitationId: inv.id }, input.credential);
        if (cred?.staffId !== inv.staffId) return failure('WAYVRO_E_UNAUTHENTICATED');
        if (inv.kind === 'RE_ENROLMENT') {
          // The lost authenticators (and any session opened with them) are revoked when the replacement is enrolled.
          await tx.query(
            `update staff.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'CREDENTIAL_REVOKED' where staff_id = $1 and status <> 'REVOKED'`,
            [inv.staffId],
          );
          await tx.query(`update staff.webauthn_credentials set status = 'REVOKED', revoked_at = now() where staff_id = $1 and status = 'ACTIVE'`, [
            inv.staffId,
          ]);
        }
        const credentialRowId = uuidv7();
        await tx.query(
          `insert into staff.webauthn_credentials (id, staff_id, credential_id, public_key, sign_count, transports, device_type, backed_up, nickname, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')`,
          [credentialRowId, inv.staffId, cred.credentialId, cred.publicKey, cred.counter, cred.transports, cred.deviceType, cred.backedUp, input.nickname],
        );
        await tx.query(`update staff.invitations set status = 'USED', used_at = now() where id = $1 and status = 'ISSUED'`, [inv.id]);
        await tx.query(
          `update staff.staff_accounts set status = 'ACTIVE', activated_at = coalesce(activated_at, now()), version = version + 1 where id = $1 and status = 'INVITED'`,
          [inv.staffId],
        );
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: inv.staffId },
          action: 'STAFF_ENROLLED',
          objectType: 'staff.webauthn_credential',
          objectId: credentialRowId,
          outcome: 'SUCCESS',
        });
        const session = await openStaffSession(tx, inv.staffId, credentialRowId, this.policy);
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: inv.staffId },
          action: 'STAFF_SESSION_CREATED',
          objectType: 'staff.session',
          objectId: session.sessionId,
          outcome: 'SUCCESS',
          reasonCode: 'ENROLMENT',
        });
        return success(201, { sessionId: session.sessionId, sessionToken: session.token, absoluteExpiresAt: session.absoluteExpiresAt.toISOString() });
      },
    );
  }

  async loginOptions(key: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `anon:${key.slice(0, 32)}`, operation: 'staff-auth.login-options', key, payload: {}, ttlSeconds: 300 },
      async (tx) => success(200, await this.webauthn.authenticationOptions(tx, 'LOGIN', {})),
    );
  }

  async login(input: { challengeId: string; credential: { id: string } & Record<string, unknown> }, key: string): Promise<IdempotentResult> {
    return this.idempotency.execute({ scope: `chal:${input.challengeId}`, operation: 'staff-auth.login', key, payload: input, ttlSeconds: 300 }, async (tx) => {
      const v = await this.webauthn.verifyAuthentication(tx, 'LOGIN', input.challengeId, {}, input.credential);
      if (!v) return failure('WAYVRO_E_UNAUTHENTICATED');
      const session = await openStaffSession(tx, v.staffId, v.credentialRowId, this.policy);
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: v.staffId },
        action: 'STAFF_SESSION_CREATED',
        objectType: 'staff.session',
        objectId: session.sessionId,
        outcome: 'SUCCESS',
        reasonCode: 'WEBAUTHN_LOGIN',
      });
      return success(201, { sessionId: session.sessionId, sessionToken: session.token, absoluteExpiresAt: session.absoluteExpiresAt.toISOString() });
    });
  }

  /** Options bound to the current session for STEP_UP / UNLOCK. */
  async assertionOptions(staff: StaffPrincipal, purpose: 'STEP_UP' | 'UNLOCK', key: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      {
        scope: `staff:${staff.staffId}`,
        operation: `staff-auth.${purpose.toLowerCase().replace('_', '-')}-options`,
        key,
        payload: { sessionId: staff.sessionId },
        ttlSeconds: 300,
      },
      async (tx) => success(200, await this.webauthn.authenticationOptions(tx, purpose, { staffId: staff.staffId, sessionId: staff.sessionId })),
    );
  }

  /** Step-up: fresh assertion by the session's own staff member; unlock additionally reactivates a LOCKED session. */
  async assert(
    staff: StaffPrincipal,
    purpose: 'STEP_UP' | 'UNLOCK',
    input: { challengeId: string; credential: { id: string } & Record<string, unknown> },
    key: string,
  ): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `staff:${staff.staffId}`, operation: `staff-auth.${purpose.toLowerCase().replace('_', '-')}`, key, payload: input, ttlSeconds: 300 },
      async (tx) => {
        const v = await this.webauthn.verifyAuthentication(
          tx,
          purpose,
          input.challengeId,
          { sessionId: staff.sessionId, staffId: staff.staffId },
          input.credential,
        );
        if (!v) return failure('WAYVRO_E_UNAUTHENTICATED');
        const next = purpose === 'UNLOCK' ? `status = 'ACTIVE', last_activity_at = now(),` : '';
        const r = await tx.query(`update staff.sessions set ${next} step_up_at = now() where id = $1 and status <> 'REVOKED' and absolute_expires_at > now()`, [
          staff.sessionId,
        ]);
        if (r.rowCount !== 1) return failure('WAYVRO_E_UNAUTHENTICATED');
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: purpose === 'UNLOCK' ? 'STAFF_SESSION_UNLOCKED' : 'STAFF_STEP_UP',
          objectType: 'staff.session',
          objectId: staff.sessionId,
          outcome: 'SUCCESS',
        });
        return success(204, null);
      },
    );
  }

  async logout(staff: StaffPrincipal, key: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `staff:${staff.staffId}`, operation: 'staff-auth.logout', key, payload: { sessionId: staff.sessionId }, ttlSeconds: 300 },
      async (tx) => {
        await tx.query(
          `update staff.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'STAFF_LOGOUT' where id = $1 and status <> 'REVOKED'`,
          [staff.sessionId],
        );
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'STAFF_SESSION_ENDED',
          objectType: 'staff.session',
          objectId: staff.sessionId,
          outcome: 'SUCCESS',
          reasonCode: 'STAFF_LOGOUT',
        });
        return success(204, null);
      },
    );
  }

  async me(staff: StaffPrincipal, pendingBreakGlassReviews: number | null): Promise<StaffMe> {
    const bg = staff.breakGlassId
      ? (await this.db.query<{ expires_at: Date }>(`select expires_at from staff.break_glass_grants where id = $1`, [staff.breakGlassId])).rows[0]
      : undefined;
    const env = this.policy.WAYVRO_ENV;
    return {
      staff: { id: staff.staffId, displayName: staff.displayName },
      session: {
        id: staff.sessionId,
        status: staff.sessionStatus,
        absoluteExpiresAt: staff.absoluteExpiresAt.toISOString(),
        stepUpFresh: await stepUpFresh(this.db, staff, this.policy),
      },
      roles: staff.assignments.map((a) => ({ assignmentId: a.id, role: a.role, cities: [...a.cities] })),
      permissions: [...staff.permissions].sort(),
      activeCredentials: staff.activeCredentials,
      twoAuthenticatorRuleSatisfied: staff.activeCredentials >= 2,
      breakGlass: staff.breakGlassId && bg ? { id: staff.breakGlassId, expiresAt: bg.expires_at.toISOString() } : null,
      environment: env === 'local' ? 'LOCAL' : env === 'test' ? 'TEST' : env === 'staging' ? 'STAGING' : 'PRODUCTION',
      pendingBreakGlassReviews,
    };
  }

  async credentials(staff: StaffPrincipal): Promise<unknown> {
    const r = await this.db.query<{
      id: string;
      nickname: string;
      device_type: 'singleDevice' | 'multiDevice';
      backed_up: boolean;
      created_at: Date;
      last_used_at: Date | null;
    }>(
      `select id, nickname, device_type, backed_up, created_at, last_used_at from staff.webauthn_credentials where staff_id = $1 and status = 'ACTIVE' order by created_at`,
      [staff.staffId],
    );
    return {
      credentials: r.rows.map((c) => ({
        id: c.id,
        nickname: c.nickname,
        deviceType: c.device_type,
        backedUp: c.backed_up,
        createdAt: c.created_at.toISOString(),
        lastUsedAt: c.last_used_at?.toISOString() ?? null,
      })),
    };
  }

  async credentialOptions(staff: StaffPrincipal, key: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `staff:${staff.staffId}`, operation: 'staff-auth.credential-options', key, payload: {}, ttlSeconds: 300 },
      async (tx) => {
        const me = (
          await tx.query<{ display_name: string; work_email: string }>(`select display_name, work_email from staff.staff_accounts where id = $1`, [
            staff.staffId,
          ])
        ).rows[0];
        if (!me) return failure('WAYVRO_E_UNAUTHENTICATED');
        return success(
          200,
          await this.webauthn.registrationOptions(
            tx,
            'ADD_CREDENTIAL',
            { id: staff.staffId, displayName: me.display_name, workEmail: me.work_email },
            { sessionId: staff.sessionId },
          ),
        );
      },
    );
  }

  async addCredential(
    staff: StaffPrincipal,
    input: { challengeId: string; credential: Record<string, unknown>; nickname: string },
    key: string,
  ): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `staff:${staff.staffId}`, operation: 'staff-auth.add-credential', key, payload: input, ttlSeconds: 300 },
      async (tx) => {
        const cred = await this.webauthn.verifyRegistration(tx, 'ADD_CREDENTIAL', input.challengeId, { sessionId: staff.sessionId }, input.credential);
        if (cred?.staffId !== staff.staffId) return failure('WAYVRO_E_UNAUTHENTICATED');
        const id = uuidv7();
        await tx.query(
          `insert into staff.webauthn_credentials (id, staff_id, credential_id, public_key, sign_count, transports, device_type, backed_up, nickname, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')`,
          [id, staff.staffId, cred.credentialId, cred.publicKey, cred.counter, cred.transports, cred.deviceType, cred.backedUp, input.nickname],
        );
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'STAFF_CREDENTIAL_ADDED',
          objectType: 'staff.webauthn_credential',
          objectId: id,
          outcome: 'SUCCESS',
        });
        return success(201, null);
      },
    );
  }

  /** Revokes one own authenticator; the last one can never be removed (no lock-out, no password fallback). */
  async revokeCredential(staff: StaffPrincipal, credentialRowId: string, key: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `staff:${staff.staffId}`, operation: 'staff-auth.revoke-credential', key, payload: { credentialRowId }, ttlSeconds: 300 },
      async (tx) => {
        const rows = await tx.query<{ id: string }>(`select id from staff.webauthn_credentials where staff_id = $1 and status = 'ACTIVE' for update`, [
          staff.staffId,
        ]);
        if (!rows.rows.some((r) => r.id === credentialRowId)) return failure('WAYVRO_E_NOT_FOUND');
        if (rows.rows.length < 2) return failure('WAYVRO_E_CONFLICT');
        await tx.query(`update staff.webauthn_credentials set status = 'REVOKED', revoked_at = now() where id = $1`, [credentialRowId]);
        // Sessions opened with that authenticator end with it.
        await tx.query(
          `update staff.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'CREDENTIAL_REVOKED' where credential_id = $1 and status <> 'REVOKED' and id <> $2`,
          [credentialRowId, staff.sessionId],
        );
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'STAFF_CREDENTIAL_REVOKED',
          objectType: 'staff.webauthn_credential',
          objectId: credentialRowId,
          outcome: 'SUCCESS',
        });
        return success(204, null);
      },
    );
  }
}
