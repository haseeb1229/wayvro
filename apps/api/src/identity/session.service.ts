/**
 * Sessions (K09/A11/K01/S12; docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md §2, §3.2, §4, §6).
 *
 * Verify (`POST /v1/auth/sessions`), one transaction: challenge row lock + CAS ISSUED -> CONSUMED, constant-time MAC
 * check, account lookup-or-create (the partial unique current-owner index makes concurrent first sign-ins for one phone
 * converge: the loser rolls back to a savepoint and signs into the winner's account), device upsert, session + refresh
 * token (SHA-256 at rest), security events and audit. One generic 401 for wrong/expired/consumed/superseded/unknown.
 *
 * Refresh: single-use rotation. The token row is locked; an already USED token is reuse => the session (family) is
 * revoked, unless the SAME Idempotency-Key repeats within the replay leeway — then the stored response is replayed
 * (lost-response case). That leeway is the idempotency record's lifetime and is not broadened anywhere else.
 */
import type { SessionCreateRequest, SessionCreated, SessionList, SessionTokens } from '@wayvro/contracts';
import type { PakistanMobileE164 } from '@wayvro/domain';
import type { FieldCipher, KeyedHasher } from '@wayvro/field-crypto';
import { ENCRYPTED_FIELDS, fieldContext, hashToken, newOpaqueToken, tokenKind, type PhoneLookup } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import { appendAudit, sqlState, uuidv7 } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { Principal } from '../auth/policy.js';
import type { ApiConfig } from '../config.js';
import { requiredActionsFor } from '../legal/consent.service.js';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome } from '../platform/idempotency.js';
import type { OtpAbuseControls } from './otp-abuse.js';
import { installationHash, installationScope } from './otp.service.js';

export interface SessionDependencies {
  readonly db: pg.Pool;
  readonly cipher: FieldCipher;
  readonly hasher: KeyedHasher;
  readonly lookup: PhoneLookup;
  readonly idempotency: IdempotencyStore;
  readonly abuse: OtpAbuseControls;
  readonly policy: ApiConfig;
}

type SecurityEventType =
  | 'SIGN_IN'
  | 'SIGN_IN_NEW_DEVICE'
  | 'DORMANT_ACCOUNT_NEW_INSTALLATION'
  | 'SIGNED_OUT'
  | 'SESSION_REVOKED'
  | 'SESSIONS_REVOKED_ALL'
  | 'SESSIONS_REVOKED_OTHERS'
  | 'REFRESH_TOKEN_REUSE_DETECTED';

export async function securityEvent(
  tx: pg.PoolClient,
  accountId: string,
  type: SecurityEventType | 'PROFILE_UPDATED',
  sessionId: string | null,
  deviceId: string | null = null,
): Promise<void> {
  await tx.query(`insert into identity.security_events (id, account_id, type, session_id, device_id) values ($1, $2, $3, $4, $5)`, [
    uuidv7(),
    accountId,
    type,
    sessionId,
    deviceId,
  ]);
}

const accountScope = (accountId: string): string => `acct:${accountId}`;

export class SessionService {
  constructor(private readonly deps: SessionDependencies) {}

  // ── verify OTP -> session ─────────────────────────────────────────────────────────────────────────────────────
  async create(input: SessionCreateRequest, idempotencyKey: string): Promise<IdempotentResult> {
    const installation = installationHash(input.installationId);
    await this.deps.abuse.admitVerify(installation.toString('hex'));
    return this.deps.idempotency.execute(
      {
        scope: installationScope(installation),
        operation: 'sessions.create',
        key: idempotencyKey,
        payload: input,
        ttlSeconds: this.deps.policy.IDEMPOTENCY_SESSION_RESPONSE_TTL_SECONDS,
      },
      (tx) => this.verifyAndCreate(tx, input, installation),
    );
  }

  private async verifyAndCreate(tx: pg.PoolClient, input: SessionCreateRequest, installation: Buffer): Promise<Outcome> {
    const r = await tx.query<{
      purpose: string;
      status: string;
      installation_hash: Buffer;
      code_mac: Buffer | null;
      mac_key_version: number | null;
      attempts: number;
      max_attempts: number;
      phone_envelope: Buffer;
      phone_lookup_hash: Buffer;
      locale: 'en' | 'ur' | 'ur-Latn';
      expired: boolean;
    }>(
      `select purpose, status, installation_hash, code_mac, mac_key_version, attempts, max_attempts, phone_envelope, phone_lookup_hash, locale,
              expires_at <= now() expired
         from identity.otp_challenges where id = $1 for update`,
      [input.challengeId],
    );
    const c = r.rows[0];
    // Unknown, foreign (other installation) or wrong-purpose challenges: generic, and no attempt is counted.
    if (!c || !c.installation_hash.equals(installation) || c.purpose !== 'SIGN_IN') return failure('WAYVRO_E_OTP_INVALID_OR_EXPIRED');
    if (c.status === 'LOCKED') return failure('WAYVRO_E_OTP_LOCKED');
    if (c.status !== 'ISSUED' || !c.code_mac || c.mac_key_version === null) return failure('WAYVRO_E_OTP_INVALID_OR_EXPIRED');
    if (c.expired) {
      await tx.query(`update identity.otp_challenges set status = 'EXPIRED' where id = $1 and status = 'ISSUED'`, [input.challengeId]);
      return failure('WAYVRO_E_OTP_INVALID_OR_EXPIRED');
    }
    if (!this.deps.hasher.verify('otp_mac', c.mac_key_version, `${input.challengeId}|${input.code}`, c.code_mac)) {
      const attempts = c.attempts + 1;
      const locked = attempts >= c.max_attempts;
      await tx.query(`update identity.otp_challenges set attempts = $2, status = $3 where id = $1 and status = 'ISSUED'`, [
        input.challengeId,
        attempts,
        locked ? 'LOCKED' : 'ISSUED',
      ]);
      await appendAudit(tx, {
        actor: { type: 'ANONYMOUS' },
        action: 'OTP_VERIFICATION',
        objectType: 'identity.otp_challenge',
        objectId: input.challengeId,
        outcome: 'FAILURE',
        reasonCode: locked ? 'OTP_LOCKED' : 'OTP_MISMATCH',
      });
      if (locked) await this.deps.abuse.recordFailedChallenge(c.phone_lookup_hash.toString('hex'));
      return failure(locked ? 'WAYVRO_E_OTP_LOCKED' : 'WAYVRO_E_OTP_INVALID_OR_EXPIRED');
    }
    const consumed = await tx.query(
      `update identity.otp_challenges set status = 'CONSUMED', consumed_at = now() where id = $1 and status = 'ISSUED' and expires_at > now()`,
      [input.challengeId],
    );
    if (consumed.rowCount !== 1) return failure('WAYVRO_E_OTP_INVALID_OR_EXPIRED');
    await appendAudit(tx, {
      actor: { type: 'ANONYMOUS' },
      action: 'OTP_VERIFICATION',
      objectType: 'identity.otp_challenge',
      objectId: input.challengeId,
      outcome: 'SUCCESS',
    });

    const e164 = this.deps.cipher.decryptString(
      'contact',
      c.phone_envelope,
      fieldContext(ENCRYPTED_FIELDS.challengePhone, input.challengeId),
    ) as PakistanMobileE164;
    const { accountId, isNew } = await this.resolveAccount(tx, e164, c.locale);
    const dormant = !isNew && (await this.dormantOnUnknownInstallation(tx, accountId, installation));
    const device = await tx.query<{ id: string; inserted: boolean }>(
      `insert into identity.account_devices (id, account_id, installation_hash, platform, app_version, first_verified_at, last_seen_at, trust_state)
       values ($1, $2, $3, $4, $5, now(), now(), 'NEW')
       on conflict (account_id, installation_hash) do update set platform = excluded.platform, app_version = excluded.app_version, last_seen_at = now(), trust_state = 'KNOWN'
       returning id, (xmax = 0) inserted`,
      [uuidv7(), accountId, installation, input.device.platform, input.device.appVersion],
    );
    const deviceRow = device.rows[0];
    if (!deviceRow) throw new Error('device upsert returned no row');
    const tokens = await this.openSession(tx, accountId, deviceRow.id, input.device.appVersion);
    await tx.query(`update identity.accounts set last_active_at = now() where id = $1`, [accountId]);

    if (dormant) {
      // S12 (P2.1 = signal recording only): the restricted RECOVERY_REVIEW flow arrives in P2.9.
      await securityEvent(tx, accountId, 'DORMANT_ACCOUNT_NEW_INSTALLATION', tokens.sessionId, deviceRow.id);
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: accountId },
        action: 'RECYCLED_NUMBER_SIGNAL',
        objectType: 'identity.account',
        objectId: accountId,
        outcome: 'SUCCESS',
        reasonCode: 'DORMANT_ACCOUNT_NEW_INSTALLATION',
      });
    }
    await securityEvent(tx, accountId, !isNew && deviceRow.inserted ? 'SIGN_IN_NEW_DEVICE' : 'SIGN_IN', tokens.sessionId, deviceRow.id);
    if (isNew)
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: accountId },
        action: 'ACCOUNT_CREATED',
        objectType: 'identity.account',
        objectId: accountId,
        outcome: 'SUCCESS',
      });
    await appendAudit(tx, {
      actor: { type: 'ACCOUNT', id: accountId },
      action: 'SESSION_CREATED',
      objectType: 'identity.session',
      objectId: tokens.sessionId,
      outcome: 'SUCCESS',
    });
    await this.deps.abuse.recordVerified(e164.slice(0, 6));
    const body: SessionCreated = { ...tokens, isNewAccount: isNew, requiredActions: await requiredActionsFor(tx, accountId) };
    return success(201, body);
  }

  /** Current owner of the phone, or a new account; concurrent creators converge on the database's single winner. */
  private async resolveAccount(tx: pg.PoolClient, e164: PakistanMobileE164, locale: string): Promise<{ accountId: string; isNew: boolean }> {
    const owner = await this.deps.lookup.currentOwner(tx, e164);
    if (owner) return { accountId: owner.accountId, isNew: false };
    await tx.query('savepoint new_account');
    try {
      const accountId = uuidv7();
      const phoneId = uuidv7();
      await tx.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', $2)`, [accountId, locale]);
      await tx.query(
        `insert into identity.account_phones (id, account_id, phone_envelope, phone_last4, status, verified_at) values ($1, $2, $3, $4, 'VERIFIED', now())`,
        [phoneId, accountId, this.deps.cipher.encrypt('contact', e164, fieldContext(ENCRYPTED_FIELDS.accountPhone, phoneId)), e164.slice(-4)],
      );
      await this.deps.lookup.writeCurrentOwner(tx, phoneId, e164);
      await tx.query(`insert into profile.rider_profiles (id, account_id, status) values ($1, $2, 'ACTIVE')`, [uuidv7(), accountId]);
      await tx.query('release savepoint new_account');
      return { accountId, isNew: true };
    } catch (e) {
      if (sqlState(e) !== '23505') throw e;
      await tx.query('rollback to savepoint new_account');
      const winner = await this.deps.lookup.currentOwner(tx, e164);
      if (!winner) throw e;
      return { accountId: winner.accountId, isNew: false };
    }
  }

  private async dormantOnUnknownInstallation(tx: pg.PoolClient, accountId: string, installation: Buffer): Promise<boolean> {
    const r = await tx.query<{ dormant: boolean; known: boolean }>(
      `select a.last_active_at < now() - ($2::int * interval '1 day') dormant,
              exists (select 1 from identity.account_devices d where d.account_id = a.id and d.installation_hash = $3) known
         from identity.accounts a where a.id = $1`,
      [accountId, this.deps.policy.ACCOUNT_DORMANCY_RISK_DAYS, installation],
    );
    const row = r.rows[0];
    return row !== undefined && row.dormant && !row.known;
  }

  private async openSession(tx: pg.PoolClient, accountId: string, deviceId: string, appVersion: string): Promise<SessionTokens> {
    const p = this.deps.policy;
    const sessionId = uuidv7();
    const access = newOpaqueToken('access');
    const refresh = newOpaqueToken('refresh');
    const s = await tx.query<{ access_expires_at: Date }>(
      `insert into identity.sessions (id, account_id, device_id, status, assurance, access_token_hash, access_expires_at, idle_expires_at, absolute_expires_at, app_version)
       values ($1, $2, $3, 'ACTIVE', 'OTP', $4, now() + ($5::int * interval '1 second'), now() + ($6::int * interval '1 second'), now() + ($7::int * interval '1 second'), $8)
       returning access_expires_at`,
      [sessionId, accountId, deviceId, hashToken(access), p.SESSION_ACCESS_TTL_SECONDS, p.SESSION_IDLE_TTL_SECONDS, p.SESSION_ABSOLUTE_TTL_SECONDS, appVersion],
    );
    const rt = await tx.query<{ expires_at: Date }>(
      `insert into identity.refresh_tokens (id, session_id, token_hash, issued_at, expires_at)
       select $1, s.id, $3, now(), s.idle_expires_at from identity.sessions s where s.id = $2
       returning expires_at`,
      [uuidv7(), sessionId, hashToken(refresh)],
    );
    return {
      sessionId,
      accessToken: access,
      accessTokenExpiresAt: (s.rows[0]?.access_expires_at ?? new Date(0)).toISOString(),
      refreshToken: refresh,
      refreshTokenExpiresAt: (rt.rows[0]?.expires_at ?? new Date(0)).toISOString(),
    };
  }

  // ── refresh ───────────────────────────────────────────────────────────────────────────────────────────────────
  async refresh(refreshToken: string, idempotencyKey: string): Promise<IdempotentResult> {
    if (tokenKind(refreshToken) !== 'refresh') throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
    const hash = hashToken(refreshToken);
    const located = await this.deps.db.query<{ id: string; session_id: string }>(`select id, session_id from identity.refresh_tokens where token_hash = $1`, [
      hash,
    ]);
    const token = located.rows[0];
    if (!token) throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
    await this.deps.abuse.admitRefresh(token.session_id);
    return this.deps.idempotency.execute(
      {
        scope: `sess:${token.session_id}`,
        operation: 'token-refreshes.create',
        key: idempotencyKey,
        payload: { refreshTokenHash: hash.toString('hex') },
        // The lost-response replay window: a repeat with the same key replays only while the record lives.
        ttlSeconds: this.deps.policy.SESSION_REFRESH_REPLAY_LEEWAY_SECONDS,
      },
      (tx) => this.rotate(tx, token.id),
    );
  }

  private async rotate(tx: pg.PoolClient, refreshTokenId: string): Promise<Outcome> {
    const p = this.deps.policy;
    const r = await tx.query<{ session_id: string; account_id: string; used: boolean; token_expired: boolean; session_live: boolean }>(
      `select rt.session_id, s.account_id, rt.used_at is not null used, rt.expires_at <= now() token_expired,
              (s.status = 'ACTIVE' and a.status = 'ACTIVE' and s.idle_expires_at > now() and s.absolute_expires_at > now()) session_live
         from identity.refresh_tokens rt
         join identity.sessions s on s.id = rt.session_id
         join identity.accounts a on a.id = s.account_id
        where rt.id = $1
        for update of rt, s`,
      [refreshTokenId],
    );
    const row = r.rows[0];
    if (!row || !row.session_live) return failure('WAYVRO_E_UNAUTHENTICATED');
    if (row.used) {
      // Reuse of a rotated token outside the replay window: treat the family as compromised.
      await this.revokeWhere(tx, row.account_id, `id = $2`, [row.session_id], 'REFRESH_REUSE');
      await securityEvent(tx, row.account_id, 'REFRESH_TOKEN_REUSE_DETECTED', row.session_id);
      await appendAudit(tx, {
        actor: { type: 'ANONYMOUS' },
        action: 'REFRESH_TOKEN_REUSE',
        objectType: 'identity.session',
        objectId: row.session_id,
        outcome: 'DENIED',
        reasonCode: 'REFRESH_REUSE',
      });
      return failure('WAYVRO_E_UNAUTHENTICATED');
    }
    if (row.token_expired) return failure('WAYVRO_E_UNAUTHENTICATED');
    const access = newOpaqueToken('access');
    const refresh = newOpaqueToken('refresh');
    const successorId = uuidv7();
    await tx.query(`update identity.refresh_tokens set used_at = now() where id = $1 and used_at is null`, [refreshTokenId]);
    const s = await tx.query<{ access_expires_at: Date; idle_expires_at: Date }>(
      `update identity.sessions
          set access_token_hash = $2,
              access_expires_at = least(now() + ($3::int * interval '1 second'), absolute_expires_at),
              idle_expires_at = least(now() + ($4::int * interval '1 second'), absolute_expires_at),
              last_used_at = now(), version = version + 1
        where id = $1
        returning access_expires_at, idle_expires_at`,
      [row.session_id, hashToken(access), p.SESSION_ACCESS_TTL_SECONDS, p.SESSION_IDLE_TTL_SECONDS],
    );
    const session = s.rows[0];
    if (!session) throw new Error('session update returned no row');
    await tx.query(`insert into identity.refresh_tokens (id, session_id, token_hash, issued_at, expires_at) values ($1, $2, $3, now(), $4)`, [
      successorId,
      row.session_id,
      hashToken(refresh),
      session.idle_expires_at,
    ]);
    await tx.query(`update identity.refresh_tokens set successor_id = $2 where id = $1`, [refreshTokenId, successorId]);
    await tx.query(`update identity.accounts set last_active_at = now() where id = $1 and last_active_at < now() - interval '1 hour'`, [row.account_id]);
    const body: SessionTokens = {
      sessionId: row.session_id,
      accessToken: access,
      accessTokenExpiresAt: session.access_expires_at.toISOString(),
      refreshToken: refresh,
      refreshTokenExpiresAt: session.idle_expires_at.toISOString(),
    };
    return success(200, body);
  }

  // ── sign-out and revocation ───────────────────────────────────────────────────────────────────────────────────
  private async revokeWhere(tx: pg.PoolClient, accountId: string, where: string, params: unknown[], reason: string): Promise<string[]> {
    const r = await tx.query<{ id: string }>(
      `update identity.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = $${String(params.length + 2)}, version = version + 1
        where account_id = $1 and status = 'ACTIVE' and ${where}
        returning id`,
      [accountId, ...params, reason],
    );
    return r.rows.map((x) => x.id);
  }

  async logout(principal: Principal, idempotencyKey: string): Promise<IdempotentResult> {
    return this.deps.idempotency.execute(
      {
        scope: accountScope(principal.accountId),
        operation: 'sessions.current.delete',
        key: idempotencyKey,
        payload: { sessionId: principal.sessionId },
        ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        await this.revokeWhere(tx, principal.accountId, `id = $2`, [principal.sessionId], 'USER_LOGOUT');
        await securityEvent(tx, principal.accountId, 'SIGNED_OUT', principal.sessionId);
        await appendAudit(tx, {
          actor: { type: 'ACCOUNT', id: principal.accountId },
          action: 'SESSION_REVOKED',
          objectType: 'identity.session',
          objectId: principal.sessionId,
          outcome: 'SUCCESS',
          reasonCode: 'USER_LOGOUT',
        });
        return success(204, null);
      },
    );
  }

  /** Revokes one session of the caller's account. Foreign or unknown ids answer 404 without side effects. */
  async revokeOne(principal: Principal, sessionId: string, idempotencyKey: string): Promise<IdempotentResult> {
    return this.deps.idempotency.execute(
      {
        scope: accountScope(principal.accountId),
        operation: 'sessions.delete',
        key: idempotencyKey,
        payload: { sessionId },
        ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        const owned = await tx.query(`select 1 from identity.sessions where id = $1 and account_id = $2`, [sessionId, principal.accountId]);
        if (owned.rowCount === 0) throw new WayvroError('WAYVRO_E_NOT_FOUND');
        const revoked = await this.revokeWhere(tx, principal.accountId, `id = $2`, [sessionId], 'USER_SESSION_REVOKED');
        if (revoked.length > 0) {
          await securityEvent(tx, principal.accountId, 'SESSION_REVOKED', sessionId);
          await appendAudit(tx, {
            actor: { type: 'ACCOUNT', id: principal.accountId },
            action: 'SESSION_REVOKED',
            objectType: 'identity.session',
            objectId: sessionId,
            outcome: 'SUCCESS',
            reasonCode: 'USER_SESSION_REVOKED',
          });
        }
        return success(204, null);
      },
    );
  }

  /**
   * Revoke all sessions or all other sessions. Needs a fresh OTP proof: the calling session was created by OTP within
   * the last 10 minutes, or it is older than 24 hours (design §5; a dedicated step-up flow arrives in P2.9).
   */
  async revokeMany(principal: Principal, scope: 'ALL' | 'ALL_OTHERS', idempotencyKey: string): Promise<IdempotentResult> {
    const s = await this.deps.db.query<{ fresh: boolean; mature: boolean }>(
      `select created_at > now() - interval '10 minutes' fresh, created_at < now() - interval '24 hours' mature from identity.sessions where id = $1`,
      [principal.sessionId],
    );
    const row = s.rows[0];
    if (!row || (!row.fresh && !row.mature)) throw new WayvroError('WAYVRO_E_STEP_UP_REQUIRED');
    return this.deps.idempotency.execute(
      {
        scope: accountScope(principal.accountId),
        operation: 'session-revocations.create',
        key: idempotencyKey,
        payload: { scope },
        ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        const revoked =
          scope === 'ALL'
            ? await this.revokeWhere(tx, principal.accountId, 'true', [], 'USER_LOGOUT_ALL')
            : await this.revokeWhere(tx, principal.accountId, `id <> $2`, [principal.sessionId], 'USER_LOGOUT_ALL');
        await securityEvent(tx, principal.accountId, scope === 'ALL' ? 'SESSIONS_REVOKED_ALL' : 'SESSIONS_REVOKED_OTHERS', principal.sessionId);
        await appendAudit(tx, {
          actor: { type: 'ACCOUNT', id: principal.accountId },
          action: 'SESSIONS_REVOKED',
          objectType: 'identity.account',
          objectId: principal.accountId,
          outcome: 'SUCCESS',
          reasonCode: scope === 'ALL' ? 'USER_LOGOUT_ALL' : 'USER_LOGOUT_OTHERS',
        });
        return success(200, { revokedCount: revoked.length });
      },
    );
  }

  async list(principal: Principal): Promise<SessionList> {
    const r = await this.deps.db.query<{ id: string; platform: 'ANDROID' | 'IOS'; app_version: string; created_at: Date; last_used_at: Date }>(
      `select s.id, d.platform, s.app_version, date_trunc('hour', s.created_at) created_at, date_trunc('hour', s.last_used_at) last_used_at
         from identity.sessions s join identity.account_devices d on d.id = s.device_id
        where s.account_id = $1 and s.status = 'ACTIVE' and s.idle_expires_at > now() and s.absolute_expires_at > now()
        order by s.created_at desc`,
      [principal.accountId],
    );
    return {
      sessions: r.rows.map((x) => ({
        id: x.id,
        current: x.id === principal.sessionId,
        platform: x.platform,
        appVersion: x.app_version,
        createdAt: x.created_at.toISOString(),
        lastUsedAt: x.last_used_at.toISOString(),
      })),
    };
  }
}
