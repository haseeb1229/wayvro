/**
 * Consumer step-up, phone change, "this wasn't me" and lost-phone recovery (A05/K08/K17/S12/S13; auth design §5–§6;
 * data model §4.2).
 *
 * - Step-up: a fresh OTP on the CURRENT phone, bound to the requesting session; valid for 10 minutes. Required for a
 *   phone change, deletion and revoke-all from a young session.
 * - Self-service phone change: stepped-up session → OTP to the new number (bound to the session) → the old phone is
 *   RELEASED, the new one becomes current, every other session is revoked, the driver risk policy runs. A new number
 *   that is current on another account is refused with the same generic 409 as any other conflict; nothing is merged.
 *   A session on a device first verified within 24 h (on an account that has older devices) waits 24 h (SIM-swap
 *   pattern; auth design §6.2).
 * - Lost-phone recovery: strong proof only. DRIVER_KYC opens a RECOVERY_DRIVER_KYC request on the account that owned
 *   the lost number plus an ACCOUNT_RECOVERY review case (in-person identity check + second senior approver + 72 h
 *   cooldown, completed by the worker). LINKED_OIDC arrives with P2.10. The caller ALWAYS gets `RECEIVED`.
 * - Any session of the account can see and cancel an open change or recovery ("this wasn't me").
 */
import { maskPakistanMobile, normalisePakistanMobile, type PakistanMobileE164 } from '@wayvro/domain';
import type { FieldCipher, KeyedHasher } from '@wayvro/field-crypto';
import { ENCRYPTED_FIELDS, fieldContext, releasePhone, revokeSessions, type PhoneLookup } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import { LimiterUnavailableError, appendAudit, sqlState, uuidv7, type Queryable, type RateLimiter } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { Principal } from '../auth/policy.js';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome } from '../platform/idempotency.js';
import { emitEvent } from '../platform/outbox.js';
import type { OtpAbuseControls } from './otp-abuse.js';
import { consumeChallenge } from './otp-verify.js';
import type { OtpService } from './otp.service.js';
import { applyDriverRiskHold } from './risk-policy.js';
import { securityEvent } from './session.service.js';

const STEP_UP_SECONDS = 600;
const NEW_DEVICE_COOLDOWN_HOURS = 24;
const PHONE_CHANGE_TTL_MINUTES = 15;
const RECOVERY_REQUEST_TTL_DAYS = 30;
const RECOVERY_ATTEMPTS_PER_DAY = 3;

interface AccountSecurityPolicy {
  readonly IDEMPOTENCY_TTL_SECONDS: number;
}

export interface AccountSecurityDependencies {
  readonly db: pg.Pool;
  readonly cipher: FieldCipher;
  readonly hasher: KeyedHasher;
  readonly lookup: PhoneLookup;
  readonly idempotency: IdempotencyStore;
  readonly abuse: OtpAbuseControls;
  readonly otp: OtpService;
  readonly limiter: RateLimiter;
  readonly policy: AccountSecurityPolicy;
}

interface RequestRow {
  id: string;
  account_id: string;
  kind: 'SELF_SERVICE' | 'RECOVERY_DRIVER_KYC';
  status: 'CURRENT_PHONE_VERIFIED' | 'MANUAL_REVIEW' | 'COOLDOWN' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'DENIED';
  new_phone_envelope: Buffer | null;
  new_phone_last4: string | null;
  step_up_session_id: string | null;
  cooldown_until: Date | null;
  expires_at: Date;
  created_at: Date;
}
const REQUEST_COLUMNS = 'id, account_id, kind, status, new_phone_envelope, new_phone_last4, step_up_session_id, cooldown_until, expires_at, created_at';
const OPEN = ['CURRENT_PHONE_VERIFIED', 'MANUAL_REVIEW', 'COOLDOWN'];

function phoneChangeView(r: RequestRow) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    // same mask as maskPakistanMobile (only the last two digits)
    maskedNewPhone: r.new_phone_last4 ? `+92 3** *** **${r.new_phone_last4.slice(-2)}` : '—',
    cooldownUntil: r.cooldown_until?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  };
}

/** True when the session completed a step-up within the last 10 minutes (database time). */
export async function stepUpFresh(q: Queryable, sessionId: string): Promise<boolean> {
  const r = await q.query(`select 1 from identity.sessions where id = $1 and step_up_at > now() - ($2::int * interval '1 second')`, [
    sessionId,
    STEP_UP_SECONDS,
  ]);
  return (r.rowCount ?? 0) > 0;
}

/** The account's current verified phone (E.164) and its row id. */
export async function currentPhone(q: Queryable, cipher: FieldCipher, accountId: string): Promise<{ id: string; e164: PakistanMobileE164 } | null> {
  const row = (
    await q.query<{ id: string; phone_envelope: Buffer }>(
      `select id, phone_envelope from identity.account_phones where account_id = $1 and status = 'VERIFIED'`,
      [accountId],
    )
  ).rows[0];
  if (!row) return null;
  return { id: row.id, e164: cipher.decryptString('contact', row.phone_envelope, fieldContext(ENCRYPTED_FIELDS.accountPhone, row.id)) as PakistanMobileE164 };
}

export class AccountSecurityService {
  constructor(private readonly deps: AccountSecurityDependencies) {}

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

  private async deviceOf(q: Queryable, sessionId: string): Promise<{ installation_hash: Buffer; young_on_older_account: boolean; wait_seconds: number }> {
    const r = await q.query<{ installation_hash: Buffer; young_on_older_account: boolean; wait_seconds: number }>(
      `select d.installation_hash,
              (d.first_verified_at > now() - ($2::int * interval '1 hour')
                and exists (select 1 from identity.account_devices o where o.account_id = d.account_id and o.id <> d.id and o.first_verified_at < d.first_verified_at)) young_on_older_account,
              greatest(0, ceil(extract(epoch from d.first_verified_at + ($2::int * interval '1 hour') - now())))::int wait_seconds
         from identity.sessions s join identity.account_devices d on d.id = s.device_id where s.id = $1`,
      [sessionId, NEW_DEVICE_COOLDOWN_HOURS],
    );
    const row = r.rows[0];
    if (!row) throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
    return row;
  }

  // ── step-up ─────────────────────────────────────────────────────────────────────────────────────────────────
  async requestStepUp(principal: Principal, key: string, clientIp: string): Promise<IdempotentResult> {
    return this.run(principal, 'step-ups.create', key, {}, async (tx) => {
      const phone = await currentPhone(tx, this.deps.cipher, principal.accountId);
      if (!phone) return failure('WAYVRO_E_CONFLICT');
      const device = await this.deviceOf(tx, principal.sessionId);
      const locale = (
        await tx.query<{ preferred_locale: 'en' | 'ur' | 'ur-Latn' }>(`select preferred_locale from identity.accounts where id = $1`, [principal.accountId])
      ).rows[0]?.preferred_locale;
      const challenge = await this.deps.otp.issueFor(
        tx,
        { purpose: 'STEP_UP', sessionId: principal.sessionId, e164: phone.e164, locale: locale ?? 'en', installation: device.installation_hash, send: true },
        clientIp,
      );
      return success(202, challenge);
    });
  }

  async verifyStepUp(principal: Principal, challengeId: string, code: string, key: string): Promise<IdempotentResult> {
    await this.deps.abuse.admitVerify(`sess:${principal.sessionId}`);
    return this.run(principal, 'step-ups.verify', key, { challengeId }, async (tx) => {
      const c = await consumeChallenge(tx, this.deps, { challengeId, code, purpose: 'STEP_UP', binding: { sessionId: principal.sessionId } });
      if (c.kind === 'error') return c;
      const r = await tx.query<{ until: Date }>(
        `update identity.sessions set step_up_at = now(), version = version + 1 where id = $1 returning now() + ($2::int * interval '1 second') until`,
        [principal.sessionId, STEP_UP_SECONDS],
      );
      await securityEvent(tx, principal.accountId, 'STEP_UP_VERIFIED', principal.sessionId);
      return success(200, { stepUpExpiresAt: (r.rows[0]?.until ?? new Date()).toISOString() });
    });
  }

  // ── self-service phone change ──────────────────────────────────────────────────────────────────────────────
  async startPhoneChange(
    principal: Principal,
    input: { newPhone: string; locale: 'en' | 'ur' | 'ur-Latn' },
    key: string,
    clientIp: string,
  ): Promise<IdempotentResult> {
    const n = normalisePakistanMobile(input.newPhone);
    if (!n.ok) throw new WayvroError('WAYVRO_E_VALIDATION');
    const e164 = n.e164;
    if (!(await stepUpFresh(this.deps.db, principal.sessionId))) throw new WayvroError('WAYVRO_E_STEP_UP_REQUIRED');
    const device = await this.deviceOf(this.deps.db, principal.sessionId);
    if (device.young_on_older_account) {
      throw new WayvroError('WAYVRO_E_CONFLICT', { details: { reasonCodes: ['NEW_DEVICE_COOLDOWN'], retryAfterSeconds: Math.max(1, device.wait_seconds) } });
    }
    return this.run(principal, 'phone-changes.create', key, { newPhone: e164, locale: input.locale }, async (tx) => {
      const current = await currentPhone(tx, this.deps.cipher, principal.accountId);
      if (!current) return failure('WAYVRO_E_CONFLICT');
      if (current.e164 === e164) return failure('WAYVRO_E_VALIDATION');
      // a stale self-service request of this account no longer blocks a new one
      await tx.query(
        `update identity.phone_change_requests set status = 'EXPIRED', updated_at = now(), version = version + 1
          where account_id = $1 and kind = 'SELF_SERVICE' and status = 'CURRENT_PHONE_VERIFIED' and expires_at <= now()`,
        [principal.accountId],
      );
      const id = uuidv7();
      const lookup = this.deps.lookup.activeDigest(e164);
      await tx.query('savepoint phone_change');
      try {
        await tx.query(
          `insert into identity.phone_change_requests (id, account_id, kind, new_phone_envelope, new_phone_last4, new_phone_lookup_version, new_phone_lookup_hash,
                                                       status, step_up_session_id, expires_at)
           values ($1, $2, 'SELF_SERVICE', $3, $4, $5, $6, 'CURRENT_PHONE_VERIFIED', $7, now() + ($8::int * interval '1 minute'))`,
          [
            id,
            principal.accountId,
            this.deps.cipher.encrypt('contact', e164, fieldContext(ENCRYPTED_FIELDS.phoneChangePhone, id)),
            e164.slice(-4),
            lookup.version,
            lookup.digest,
            principal.sessionId,
            PHONE_CHANGE_TTL_MINUTES,
          ],
        );
      } catch (e) {
        if (sqlState(e) !== '23505') throw e;
        await tx.query('rollback to savepoint phone_change');
        return failure('WAYVRO_E_CONFLICT');
      }
      // The code always goes out (or is suppressed by the send limits) — never depending on who owns the number.
      const challenge = await this.deps.otp.issueFor(
        tx,
        { purpose: 'PHONE_CHANGE_NEW', sessionId: principal.sessionId, e164, locale: input.locale, installation: device.installation_hash, send: true },
        clientIp,
      );
      await securityEvent(tx, principal.accountId, 'PHONE_CHANGE_REQUESTED', principal.sessionId);
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'PHONE_CHANGE_REQUESTED',
        objectType: 'identity.phone_change_request',
        objectId: id,
        outcome: 'SUCCESS',
      });
      const row = await this.load(tx, id);
      return success(201, { phoneChange: phoneChangeView(row), challenge: { ...challenge, maskedDestination: maskPakistanMobile(e164) } });
    });
  }

  async verifyPhoneChange(principal: Principal, id: string, input: { challengeId: string; code: string }, key: string): Promise<IdempotentResult> {
    await this.deps.abuse.admitVerify(`sess:${principal.sessionId}`);
    return this.run(principal, 'phone-changes.verify', key, { id, challengeId: input.challengeId }, async (tx) => {
      const r = (
        await tx.query<RequestRow>(`select ${REQUEST_COLUMNS} from identity.phone_change_requests where id = $1 and account_id = $2 for update`, [
          id,
          principal.accountId,
        ])
      ).rows[0];
      if (!r || r.kind !== 'SELF_SERVICE') return failure('WAYVRO_E_NOT_FOUND');
      if (
        r.status !== 'CURRENT_PHONE_VERIFIED' ||
        r.step_up_session_id !== principal.sessionId ||
        r.expires_at.getTime() <= Date.now() ||
        !r.new_phone_envelope
      )
        return failure('WAYVRO_E_CONFLICT');
      const c = await consumeChallenge(tx, this.deps, {
        challengeId: input.challengeId,
        code: input.code,
        purpose: 'PHONE_CHANGE_NEW',
        binding: { sessionId: principal.sessionId },
      });
      if (c.kind === 'error') return c;
      const e164 = this.deps.cipher.decryptString('contact', r.new_phone_envelope, fieldContext(ENCRYPTED_FIELDS.phoneChangePhone, r.id)) as PakistanMobileE164;
      if (c.e164 !== e164) return failure('WAYVRO_E_OTP_INVALID_OR_EXPIRED');
      const current = await currentPhone(tx, this.deps.cipher, principal.accountId);
      if (!current) return failure('WAYVRO_E_CONFLICT');
      await releasePhone(tx, current.id, 'PHONE_CHANGED');
      const phoneId = uuidv7();
      await tx.query(
        `insert into identity.account_phones (id, account_id, phone_envelope, phone_last4, status, verified_at) values ($1, $2, $3, $4, 'VERIFIED', now())`,
        [phoneId, principal.accountId, this.deps.cipher.encrypt('contact', e164, fieldContext(ENCRYPTED_FIELDS.accountPhone, phoneId)), e164.slice(-4)],
      );
      // The partial unique current-owner index refuses a number that is current on another account: generic 409,
      // no merge and no disclosure (the whole transaction rolls back, nothing is recorded).
      try {
        await this.deps.lookup.writeCurrentOwner(tx, phoneId, e164);
      } catch (e) {
        if (sqlState(e) !== '23505') throw e;
        throw new WayvroError('WAYVRO_E_CONFLICT');
      }
      await tx.query(
        `update identity.phone_change_requests set status = 'COMPLETED', completed_at = now(), updated_at = now(), version = version + 1 where id = $1`,
        [r.id],
      );
      await revokeSessions(tx, principal.accountId, 'PHONE_CHANGED', principal.sessionId);
      await securityEvent(tx, principal.accountId, 'PHONE_CHANGED', principal.sessionId);
      await applyDriverRiskHold(tx, principal.accountId, 'PHONE_CHANGED');
      await emitEvent(tx, {
        type: 'account.phone.changed.v1',
        aggregateType: 'identity.account',
        aggregateId: principal.accountId,
        accountId: principal.accountId,
      });
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'PHONE_CHANGED',
        objectType: 'identity.phone_change_request',
        objectId: r.id,
        outcome: 'SUCCESS',
      });
      return success(200, phoneChangeView(await this.load(tx, r.id)));
    });
  }

  private async load(q: Queryable, id: string): Promise<RequestRow> {
    const row = (await q.query<RequestRow>(`select ${REQUEST_COLUMNS} from identity.phone_change_requests where id = $1`, [id])).rows[0];
    if (!row) throw new Error('phone change request vanished');
    return row;
  }

  async current(principal: Principal): Promise<unknown> {
    const r = await this.deps.db.query<RequestRow>(
      `select ${REQUEST_COLUMNS} from identity.phone_change_requests where account_id = $1 and status = any($2::text[]) and (status <> 'CURRENT_PHONE_VERIFIED' or expires_at > now())`,
      [principal.accountId, OPEN],
    );
    const row = r.rows[0];
    return { phoneChange: row ? phoneChangeView(row) : null };
  }

  /** "This wasn't me" (any session of the account, restricted sessions included). */
  async cancel(principal: Principal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(principal, 'phone-changes.cancel', key, { id }, async (tx) => {
      const r = (
        await tx.query<RequestRow>(`select ${REQUEST_COLUMNS} from identity.phone_change_requests where id = $1 and account_id = $2 for update`, [
          id,
          principal.accountId,
        ])
      ).rows[0];
      if (!r) return failure('WAYVRO_E_NOT_FOUND');
      if (!OPEN.includes(r.status)) return failure('WAYVRO_E_CONFLICT');
      await tx.query(`update identity.phone_change_requests set status = 'CANCELLED', updated_at = now(), version = version + 1 where id = $1`, [r.id]);
      await tx.query(
        `update compliance.review_cases set status = 'CANCELLED', assigned_staff_id = null, lease_expires_at = null, version = version + 1
          where phone_change_request_id = $1 and status in ('OPEN', 'CLAIMED', 'ESCALATED')`,
        [r.id],
      );
      await securityEvent(tx, principal.accountId, 'PHONE_CHANGE_CANCELLED', principal.sessionId);
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: r.kind === 'SELF_SERVICE' ? 'PHONE_CHANGE_CANCELLED' : 'RECOVERY_CANCELLED_BY_OWNER',
        objectType: 'identity.phone_change_request',
        objectId: r.id,
        outcome: 'SUCCESS',
      });
      return success(200, phoneChangeView(await this.load(tx, r.id)));
    });
  }

  // ── lost-phone recovery (strong proof only) ────────────────────────────────────────────────────────────────
  async recover(principal: Principal, input: { proof: 'LINKED_OIDC' | 'DRIVER_KYC'; previousPhone: string }, key: string): Promise<IdempotentResult> {
    const n = normalisePakistanMobile(input.previousPhone);
    if (!n.ok) throw new WayvroError('WAYVRO_E_VALIDATION');
    // P2.10 adds the linked-OIDC proof; until then that path does not exist.
    if (input.proof === 'LINKED_OIDC') throw new WayvroError('WAYVRO_E_FEATURE_DISABLED');
    await this.admitRecovery(principal.accountId);
    const previous = n.e164;
    return this.run(principal, 'account-recoveries.create', key, { proof: input.proof, previousPhone: previous }, async (tx) => {
      const outcome = await this.openDriverRecovery(tx, principal.accountId, previous);
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'ACCOUNT_RECOVERY_REQUESTED',
        objectType: 'identity.account',
        objectId: principal.accountId,
        outcome: outcome === 'OPENED' ? 'SUCCESS' : 'DENIED',
        reasonCode: outcome,
      });
      return success(202, { status: 'RECEIVED' });
    });
  }

  private async admitRecovery(accountId: string): Promise<void> {
    let decision;
    try {
      decision = await this.deps.limiter.consume([{ key: `recovery:acct:${accountId}`, limit: RECOVERY_ATTEMPTS_PER_DAY, windowSeconds: 86_400 }]);
    } catch (e) {
      if (e instanceof LimiterUnavailableError) throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE', { cause: e });
      throw e;
    }
    if (!decision.allowed) throw new WayvroError('WAYVRO_E_RATE_LIMITED', { details: { retryAfterSeconds: Math.max(1, decision.retryAfterSeconds) } });
  }

  /**
   * Opens the recovery when every condition holds; otherwise records why (audit only — the caller always sees
   * RECEIVED): the caller is a clean new-number account (no driver application of its own), the previous number is
   * current on another ACTIVE account that has a driver profile, and that account has no open change or recovery.
   */
  private async openDriverRecovery(
    tx: pg.PoolClient,
    callerId: string,
    previous: PakistanMobileE164,
  ): Promise<'OPENED' | 'CALLER_NOT_CLEAN' | 'NO_DRIVER_ACCOUNT' | 'ALREADY_OPEN'> {
    const caller = await currentPhone(tx, this.deps.cipher, callerId);
    const own = await tx.query(`select 1 from compliance.driver_applications where account_id = $1`, [callerId]);
    if (!caller || (own.rowCount ?? 0) > 0) return 'CALLER_NOT_CLEAN';
    const owner = await this.deps.lookup.currentOwner(tx, previous);
    if (!owner || owner.accountId === callerId) return 'NO_DRIVER_ACCOUNT';
    const target = (
      await tx.query<{ profile_id: string; city_code: string }>(
        `select p.id profile_id, a.city_code from identity.accounts acc
           join compliance.driver_profiles p on p.account_id = acc.id
           join compliance.driver_applications a on a.id = p.application_id
          where acc.id = $1 and acc.status = 'ACTIVE'`,
        [owner.accountId],
      )
    ).rows[0];
    if (!target) return 'NO_DRIVER_ACCOUNT';
    const id = uuidv7();
    const lookup = this.deps.lookup.activeDigest(caller.e164);
    await tx.query('savepoint recovery');
    try {
      await tx.query(
        `insert into identity.phone_change_requests (id, account_id, kind, new_phone_envelope, new_phone_last4, new_phone_lookup_version, new_phone_lookup_hash,
                                                     status, requested_by_account_id, expires_at)
         values ($1, $2, 'RECOVERY_DRIVER_KYC', $3, $4, $5, $6, 'MANUAL_REVIEW', $7, now() + ($8::int * interval '1 day'))`,
        [
          id,
          owner.accountId,
          this.deps.cipher.encrypt('contact', caller.e164, fieldContext(ENCRYPTED_FIELDS.phoneChangePhone, id)),
          caller.e164.slice(-4),
          lookup.version,
          lookup.digest,
          callerId,
          RECOVERY_REQUEST_TTL_DAYS,
        ],
      );
    } catch (e) {
      if (sqlState(e) !== '23505') throw e;
      await tx.query('rollback to savepoint recovery');
      return 'ALREADY_OPEN';
    }
    await tx.query(
      `insert into compliance.review_cases (id, kind, driver_profile_id, phone_change_request_id, city_code, priority, status) values ($1, 'ACCOUNT_RECOVERY', $2, $3, $4, 3, 'OPEN')`,
      [uuidv7(), target.profile_id, id, target.city_code],
    );
    // every session of the account that owned the number sees it and can cancel ("this wasn't me")
    await securityEvent(tx, owner.accountId, 'RECOVERY_REQUESTED', null);
    await emitEvent(tx, { type: 'account.recovery.requested.v1', aggregateType: 'identity.phone_change_request', aggregateId: id, accountId: owner.accountId });
    return 'OPENED';
  }
}
