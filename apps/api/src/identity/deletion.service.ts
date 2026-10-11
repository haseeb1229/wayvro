/**
 * Account deletion (U06; data model §4.9). In the app: a fresh step-up, then a request in GRACE (configurable days,
 * pending counsel) — or BLOCKED with explicit blocker rows — and the account becomes DELETION_PENDING: its sessions
 * keep working but only on restricted-ok routes, so the owner can cancel. On the web: an OTP to the number
 * (ACCOUNT_DELETION_WEB, generic answers, stricter limits) records the same request; whether the number belongs to an
 * account is never revealed. The worker re-evaluates blockers and processes due requests (pseudonymisation,
 * evidence erasure). Retention exceptions name what is kept and why (placeholder bases until EG-16).
 */
import { normalisePakistanMobile } from '@wayvro/domain';
import type { FieldCipher, KeyedHasher } from '@wayvro/field-crypto';
import { deletionBlockers, retentionExceptions, type PhoneLookup } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import { LimiterUnavailableError, appendAudit, sqlState, uuidv7, type Queryable, type RateLimiter } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { Principal } from '../auth/policy.js';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome } from '../platform/idempotency.js';
import { emitEvent } from '../platform/outbox.js';
import { stepUpFresh } from './session-gates.js';
import type { OtpAbuseControls } from './otp-abuse.js';
import { consumeChallenge } from './otp-verify.js';
import { installationHash, type OtpService } from './otp.service.js';
import { securityEvent } from './session.service.js';

const WEB_REQUESTS_PER_IP_HOUR = 5;

interface DeletionPolicy {
  readonly IDEMPOTENCY_TTL_SECONDS: number;
  readonly ACCOUNT_DELETION_GRACE_DAYS: number;
}

export interface DeletionDependencies {
  readonly db: pg.Pool;
  readonly cipher: FieldCipher;
  readonly hasher: KeyedHasher;
  readonly lookup: PhoneLookup;
  readonly idempotency: IdempotencyStore;
  readonly abuse: OtpAbuseControls;
  readonly otp: OtpService;
  readonly limiter: RateLimiter;
  readonly policy: DeletionPolicy;
}

interface DeletionRow {
  id: string;
  status: 'GRACE' | 'BLOCKED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
  channel: 'APP' | 'WEB';
  grace_until: Date;
  created_at: Date;
}

export class DeletionService {
  constructor(private readonly deps: DeletionDependencies) {}

  private async view(q: Queryable, r: DeletionRow) {
    const blockers = await q.query<{ blocker_code: string }>(
      `select blocker_code from identity.deletion_request_blockers where deletion_request_id = $1 and cleared_at is null order by blocker_code`,
      [r.id],
    );
    const kept = await q.query<{ data_category: string; basis_ref: string }>(
      `select data_category, basis_ref from identity.deletion_retention_exceptions where deletion_request_id = $1 order by data_category`,
      [r.id],
    );
    return {
      id: r.id,
      status: r.status,
      channel: r.channel,
      graceUntil: r.status === 'GRACE' || r.status === 'BLOCKED' ? r.grace_until.toISOString() : null,
      blockers: blockers.rows.map((b) => b.blocker_code),
      retained: kept.rows.map((k) => ({ dataCategory: k.data_category, basisRef: k.basis_ref })),
      createdAt: r.created_at.toISOString(),
    };
  }

  /** Records a request for an ACTIVE account inside the caller's transaction; null when one is already open. */
  private async open(tx: pg.PoolClient, accountId: string, channel: 'APP' | 'WEB', sessionId: string | null): Promise<DeletionRow | null> {
    const id = uuidv7();
    const blockers = await deletionBlockers(tx, accountId);
    const status = blockers.length > 0 ? 'BLOCKED' : 'GRACE';
    await tx.query('savepoint deletion');
    try {
      await tx.query(
        `insert into identity.account_deletion_requests (id, account_id, channel, status, grace_until) values ($1, $2, $3, $4, now() + ($5::int * interval '1 day'))`,
        [id, accountId, channel, status, this.deps.policy.ACCOUNT_DELETION_GRACE_DAYS],
      );
    } catch (e) {
      if (sqlState(e) !== '23505') throw e;
      await tx.query('rollback to savepoint deletion');
      return null;
    }
    for (const b of blockers) {
      await tx.query(`insert into identity.deletion_request_blockers (id, deletion_request_id, blocker_code) values ($1, $2, $3)`, [uuidv7(), id, b]);
    }
    for (const k of await retentionExceptions(tx, accountId)) {
      await tx.query(`insert into identity.deletion_retention_exceptions (deletion_request_id, data_category, basis_ref) values ($1, $2, $3)`, [
        id,
        k.dataCategory,
        k.basisRef,
      ]);
    }
    await tx.query(`update identity.accounts set status = 'DELETION_PENDING', version = version + 1 where id = $1 and status = 'ACTIVE'`, [accountId]);
    await securityEvent(tx, accountId, 'DELETION_REQUESTED', sessionId);
    await emitEvent(tx, {
      type: 'account.deletion.changed.v1',
      aggregateType: 'identity.account_deletion_request',
      aggregateId: id,
      accountId,
      payload: { status },
    });
    await appendAudit(tx, {
      actor: { type: 'ACCOUNT', id: accountId },
      action: 'ACCOUNT_DELETION_REQUESTED',
      objectType: 'identity.account_deletion_request',
      objectId: id,
      outcome: 'SUCCESS',
      reasonCode: channel,
    });
    return (
      (await tx.query<DeletionRow>(`select id, status, channel, grace_until, created_at from identity.account_deletion_requests where id = $1`, [id]))
        .rows[0] ?? null
    );
  }

  private run(
    principal: Principal,
    operation: string,
    key: string,
    payload: unknown,
    work: (tx: pg.PoolClient) => Promise<Outcome>,
  ): Promise<IdempotentResult> {
    return this.deps.idempotency.execute(
      { scope: `acct:${principal.accountId}`, operation, key, payload, ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS },
      work,
    );
  }

  async request(principal: Principal, key: string): Promise<IdempotentResult> {
    if (!(await stepUpFresh(this.deps.db, principal.sessionId))) throw new WayvroError('WAYVRO_E_STEP_UP_REQUIRED');
    return this.run(principal, 'deletion-requests.create', key, {}, async (tx) => {
      const row = await this.open(tx, principal.accountId, 'APP', principal.sessionId);
      if (!row) return failure('WAYVRO_E_CONFLICT');
      return success(201, await this.view(tx, row));
    });
  }

  async current(principal: Principal): Promise<unknown> {
    const r = (
      await this.deps.db.query<DeletionRow>(
        `select id, status, channel, grace_until, created_at from identity.account_deletion_requests where account_id = $1 and status in ('GRACE', 'BLOCKED', 'PROCESSING')`,
        [principal.accountId],
      )
    ).rows[0];
    return { deletionRequest: r ? await this.view(this.deps.db, r) : null };
  }

  async cancel(principal: Principal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(principal, 'deletion-requests.cancel', key, { id }, async (tx) => {
      const r = (
        await tx.query<DeletionRow>(
          `select id, status, channel, grace_until, created_at from identity.account_deletion_requests where id = $1 and account_id = $2 for update`,
          [id, principal.accountId],
        )
      ).rows[0];
      if (!r) return failure('WAYVRO_E_NOT_FOUND');
      if (r.status !== 'GRACE' && r.status !== 'BLOCKED') return failure('WAYVRO_E_CONFLICT');
      await tx.query(
        `update identity.account_deletion_requests set status = 'CANCELLED', cancelled_at = now(), updated_at = now(), version = version + 1 where id = $1`,
        [r.id],
      );
      await tx.query(`update identity.deletion_request_blockers set cleared_at = now() where deletion_request_id = $1 and cleared_at is null`, [r.id]);
      await tx.query(`update identity.accounts set status = 'ACTIVE', version = version + 1 where id = $1 and status = 'DELETION_PENDING'`, [
        principal.accountId,
      ]);
      await securityEvent(tx, principal.accountId, 'DELETION_CANCELLED', principal.sessionId);
      await emitEvent(tx, {
        type: 'account.deletion.changed.v1',
        aggregateType: 'identity.account_deletion_request',
        aggregateId: r.id,
        accountId: principal.accountId,
        payload: { status: 'CANCELLED' },
      });
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'ACCOUNT_DELETION_CANCELLED',
        objectType: 'identity.account_deletion_request',
        objectId: r.id,
        outcome: 'SUCCESS',
      });
      return success(200, await this.view(tx, { ...r, status: 'CANCELLED' }));
    });
  }

  // ── web path (no app needed) ─────────────────────────────────────────────────────────────────────────────
  private async admitWeb(clientIp: string): Promise<void> {
    const ipKey = this.deps.hasher.active('risk_signals', `ip:${clientIp}`).digest.toString('hex');
    let decision;
    try {
      decision = await this.deps.limiter.consume([{ key: `deletion-web:ip:${ipKey}`, limit: WEB_REQUESTS_PER_IP_HOUR, windowSeconds: 3600 }]);
    } catch (e) {
      if (e instanceof LimiterUnavailableError) throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE', { cause: e });
      throw e;
    }
    if (!decision.allowed) throw new WayvroError('WAYVRO_E_RATE_LIMITED', { details: { retryAfterSeconds: Math.max(1, decision.retryAfterSeconds) } });
  }

  /** Identical 202 for every syntactically valid number; a code is sent only when the number is current on an account. */
  async webOtp(input: { phone: string; browserId: string; locale: 'en' | 'ur' | 'ur-Latn' }, key: string, clientIp: string): Promise<IdempotentResult> {
    const n = normalisePakistanMobile(input.phone);
    if (!n.ok) throw new WayvroError('WAYVRO_E_VALIDATION');
    await this.admitWeb(clientIp);
    const installation = installationHash(input.browserId);
    return this.deps.idempotency.execute(
      {
        scope: `inst:${installation.toString('hex')}`,
        operation: 'deletion-web.otp',
        key,
        payload: { phone: n.e164, browserId: input.browserId, locale: input.locale },
        ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        const owner = await this.deps.lookup.currentOwner(tx, n.e164);
        const challenge = await this.deps.otp.issueFor(
          tx,
          { purpose: 'ACCOUNT_DELETION_WEB', sessionId: null, e164: n.e164, locale: input.locale, installation, send: owner !== null },
          clientIp,
        );
        return success(202, challenge);
      },
    );
  }

  /** Always RECEIVED once the code is valid; a request is recorded only for an ACTIVE account without an open one. */
  async webRequest(input: { challengeId: string; code: string; browserId: string }, key: string, clientIp: string): Promise<IdempotentResult> {
    await this.admitWeb(clientIp);
    const installation = installationHash(input.browserId);
    await this.deps.abuse.admitVerify(installation.toString('hex'));
    return this.deps.idempotency.execute(
      {
        scope: `inst:${installation.toString('hex')}`,
        operation: 'deletion-web.request',
        key,
        payload: { challengeId: input.challengeId, browserId: input.browserId },
        ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        const c = await consumeChallenge(tx, this.deps, {
          challengeId: input.challengeId,
          code: input.code,
          purpose: 'ACCOUNT_DELETION_WEB',
          binding: { installation },
        });
        if (c.kind === 'error') return c;
        const owner = await this.deps.lookup.currentOwner(tx, c.e164);
        const active = owner
          ? ((await tx.query(`select 1 from identity.accounts where id = $1 and status = 'ACTIVE'`, [owner.accountId])).rowCount ?? 0) > 0
          : false;
        if (owner && active) await this.open(tx, owner.accountId, 'WEB', null);
        return success(202, { status: 'RECEIVED' });
      },
    );
  }
}
