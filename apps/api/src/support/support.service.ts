/**
 * Support capabilities of the accepted staff matrix (Phase-2 closure; matrix §3–§4; W07/H08/K17/A11):
 *
 * - Masked account summary (`account.summary.view_masked`, SUPPORT_AGENT and TRUST_SAFETY_AGENT) by phone or account id,
 *   always with a reason from the closed list, audited. It shows only support-relevant, privacy-minimised facts: no full
 *   phone, CNIC, document number, evidence, OIDC subject, token, IP or location — and no trip/financial history.
 * - Session revocation on the account's behalf (`account.sessions.revoke_on_behalf`; fresh staff step-up on the route):
 *   one session or all; reason audited; the account sees SESSIONS_REVOKED_BY_SUPPORT. No token is ever shown and no
 *   phone or credential moves.
 * - Recovery assistance (`account.recovery_case.open`): for an EXISTING proof-bearing recovery (a driver-KYC lost-phone
 *   request in MANUAL_REVIEW, or a dormant-number claim IN_REVIEW) it opens the ACCOUNT_RECOVERY review case if none is
 *   open, otherwise raises its priority. It never decides, never creates proof and never moves a credential (founder
 *   Q-08); the in-person check, a KYC senior decision and a second approver remain required.
 *
 * ABAC: never on the staff member's own consumer account; city-scoped roles see a driver account only in their cities
 * (rider-only accounts carry no city attribute). Every denial is audited. No bulk or export route exists.
 */
import { normalisePakistanMobile } from '@wayvro/domain';
import type { PhoneLookup } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import { appendAudit, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import { requiredActionsFor } from '../legal/consent.service.js';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome } from '../platform/idempotency.js';
import { emitEvent } from '../platform/outbox.js';
import type { StaffPermission } from '../staff/roles.js';
import { citiesFor, type StaffPrincipal } from '../staff/staff-session.js';

const SESSION_LIST_LIMIT = 20;

interface SupportPolicy {
  readonly IDEMPOTENCY_TTL_SECONDS: number;
}

export class SupportService {
  constructor(
    private readonly db: pg.Pool,
    private readonly lookup: PhoneLookup,
    private readonly idempotency: IdempotencyStore,
    private readonly policy: SupportPolicy,
  ) {}

  private async deny(q: Queryable, staff: StaffPrincipal, objectId: string, reasonCode: string): Promise<false> {
    await appendAudit(q, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: 'SUPPORT_ACCESS_DENIED',
      objectType: 'identity.account',
      objectId,
      outcome: 'DENIED',
      reasonCode,
    });
    return false;
  }

  /**
   * Conflict of interest and city scope for one account. A denial is audited and reported as `false`, so the caller
   * answers 403 with a COMMITTED audit row (a thrown error would roll the audit back inside a transaction).
   */
  private async authorize(
    q: Queryable,
    staff: StaffPrincipal,
    permission: StaffPermission,
    accountId: string,
    related: string | null = null,
  ): Promise<boolean> {
    if (staff.consumerAccountId !== null && (staff.consumerAccountId === accountId || staff.consumerAccountId === related))
      return this.deny(q, staff, accountId, 'CONFLICT_OF_INTEREST');
    const cities = citiesFor(staff, permission);
    if (cities === null) return true;
    const city = (
      await q.query<{ city_code: string }>(`select city_code from compliance.driver_applications where account_id = $1 order by created_at desc limit 1`, [
        accountId,
      ])
    ).rows[0]?.city_code;
    if (city !== undefined && !cities.has(city)) return this.deny(q, staff, accountId, 'CITY_SCOPE');
    return true;
  }

  async summary(staff: StaffPrincipal, input: { phone?: string | undefined; accountId?: string | undefined; reasonCode: string }): Promise<unknown> {
    let accountId = input.accountId;
    if (input.phone !== undefined) {
      const n = normalisePakistanMobile(input.phone);
      if (!n.ok) throw new WayvroError('WAYVRO_E_VALIDATION');
      accountId = (await this.lookup.currentOwner(this.db, n.e164))?.accountId;
    }
    const account = accountId
      ? (
          await this.db.query<{ id: string; status: 'ACTIVE' | 'DELETION_PENDING' | 'DELETED'; created_on: string; rider: boolean }>(
            `select a.id, a.status, to_char(a.created_at, 'YYYY-MM-DD') created_on, exists (select 1 from profile.rider_profiles r where r.account_id = a.id) rider
               from identity.accounts a where a.id = $1`,
            [accountId],
          )
        ).rows[0]
      : undefined;
    if (!account) {
      await appendAudit(this.db, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'SUPPORT_ACCOUNT_LOOKUP',
        objectType: 'identity.account',
        outcome: 'FAILURE',
        reasonCode: input.reasonCode,
      });
      throw new WayvroError('WAYVRO_E_NOT_FOUND');
    }
    if (!(await this.authorize(this.db, staff, 'account.summary.view_masked', account.id))) throw new WayvroError('WAYVRO_E_FORBIDDEN');
    const q = this.db;
    const phone = (
      await q.query<{ phone_last4: string | null }>(`select phone_last4 from identity.account_phones where account_id = $1 and status = 'VERIFIED'`, [
        account.id,
      ])
    ).rows[0];
    const driver = (
      await q.query<{ app_state: string | null; profile_state: string | null; city_code: string | null }>(
        `select a.state app_state, p.state profile_state, a.city_code
           from compliance.driver_applications a left join compliance.driver_profiles p on p.application_id = a.id
          where a.account_id = $1 order by a.created_at desc limit 1`,
        [account.id],
      )
    ).rows[0];
    const restrictions = await q.query<{ scope: string; reason_class: string; reason_code: string; status: string }>(
      `select r.scope, r.reason_class, r.reason_code, r.status from profile.restrictions r
         left join compliance.driver_profiles p on p.id = r.driver_profile_id
        where (r.account_id = $1 or p.account_id = $1) and r.status in ('ACTIVE', 'LIFT_PENDING_APPROVAL')
        order by r.created_at`,
      [account.id],
    );
    const sessions = await q.query<{ id: string; platform: 'ANDROID' | 'IOS'; assurance: 'OTP' | 'OIDC'; created_at: Date; last_used_at: Date }>(
      `select s.id, d.platform, s.assurance, date_trunc('hour', s.created_at) created_at, date_trunc('hour', s.last_used_at) last_used_at
         from identity.sessions s join identity.account_devices d on d.id = s.device_id
        where s.account_id = $1 and s.status = 'ACTIVE' and s.idle_expires_at > now() and s.absolute_expires_at > now()
        order by s.created_at desc limit $2`,
      [account.id, SESSION_LIST_LIMIT],
    );
    const facts = (
      await q.query<{ devices: string; oidc: boolean; kyc: boolean }>(
        `select (select count(*) from identity.account_devices where account_id = $1) devices,
                exists (select 1 from identity.oidc_identities where account_id = $1 and status = 'LINKED') oidc,
                exists (select 1 from compliance.driver_profiles where account_id = $1) kyc`,
        [account.id],
      )
    ).rows[0];
    const recovery = await this.openRecovery(q, account.id);
    const deletion = (
      await q.query<{ status: string }>(
        `select status from identity.account_deletion_requests where account_id = $1 and status in ('GRACE', 'BLOCKED', 'PROCESSING')`,
        [account.id],
      )
    ).rows[0];
    await appendAudit(q, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: staff.breakGlassId ? 'SUPPORT_ACCOUNT_SUMMARY_VIEWED_BREAK_GLASS' : 'SUPPORT_ACCOUNT_SUMMARY_VIEWED',
      objectType: 'identity.account',
      objectId: account.id,
      outcome: 'SUCCESS',
      reasonCode: input.reasonCode,
    });
    return {
      accountId: account.id,
      status: account.status,
      maskedPhone: phone?.phone_last4 ? `+92 3** *** **${phone.phone_last4.slice(-2)}` : null,
      createdOn: account.created_on,
      riderProfile: account.rider,
      driver: { applicationState: driver?.app_state ?? null, profileState: driver?.profile_state ?? null, cityCode: driver?.city_code ?? null },
      restrictions: restrictions.rows.map((r) => ({ scope: r.scope, reasonClass: r.reason_class, reasonCode: r.reason_code, status: r.status })),
      sessions: sessions.rows.map((s) => ({
        id: s.id,
        platform: s.platform,
        assurance: s.assurance,
        createdAt: s.created_at.toISOString(),
        lastUsedAt: s.last_used_at.toISOString(),
      })),
      deviceCount: Number(facts?.devices ?? 0),
      strongRecoveryFactors: { linkedOidc: facts?.oidc ?? false, driverKyc: facts?.kyc ?? false },
      recovery,
      deletion: deletion ? { status: deletion.status } : null,
      requiredActions: account.status === 'DELETED' ? [] : await requiredActionsFor(q, account.id),
    };
  }

  /** The account's open recovery-related request, if any (phone change / lost phone / dormant-number claim). */
  private async openRecovery(q: Queryable, accountId: string) {
    const change = (
      await q.query<{ id: string; kind: string; status: string }>(
        `select id, kind, status from identity.phone_change_requests
          where account_id = $1 and status in ('CURRENT_PHONE_VERIFIED', 'MANUAL_REVIEW', 'COOLDOWN') order by created_at desc limit 1`,
        [accountId],
      )
    ).rows[0];
    if (change) {
      const kind = change.kind === 'SELF_SERVICE' ? 'PHONE_CHANGE' : change.kind === 'RECOVERY_OIDC_PROOF' ? 'LOST_PHONE_OIDC' : 'LOST_PHONE_DRIVER_KYC';
      return { id: change.id, kind, status: change.status };
    }
    const review = (
      await q.query<{ id: string; status: string }>(
        `select id, status from identity.dormant_number_reviews where account_id = $1 and status in ('PENDING', 'IN_REVIEW') order by created_at desc limit 1`,
        [accountId],
      )
    ).rows[0];
    return review ? { id: review.id, kind: 'DORMANT_NUMBER' as const, status: review.status } : null;
  }

  private run(
    staff: StaffPrincipal,
    operation: string,
    key: string,
    payload: unknown,
    work: (tx: pg.PoolClient) => Promise<Outcome>,
  ): Promise<IdempotentResult> {
    return this.idempotency.execute({ scope: `staff:${staff.staffId}`, operation, key, payload, ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS }, work);
  }

  /** One or all ACTIVE sessions of the account; foreign session ids are 404 (nothing revoked). */
  async revokeSessions(
    staff: StaffPrincipal,
    accountId: string,
    input: { scope: 'ALL' | 'ONE'; sessionId?: string | undefined; reasonCode: string },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(staff, 'support.session-revocations', key, { accountId, ...input }, async (tx) => {
      const exists = await tx.query(`select 1 from identity.accounts where id = $1`, [accountId]);
      if ((exists.rowCount ?? 0) === 0) return failure('WAYVRO_E_NOT_FOUND');
      if (!(await this.authorize(tx, staff, 'account.sessions.revoke_on_behalf', accountId))) return failure('WAYVRO_E_FORBIDDEN');
      if (input.scope === 'ONE') {
        const owned = await tx.query(`select 1 from identity.sessions where id = $1 and account_id = $2`, [input.sessionId, accountId]);
        if ((owned.rowCount ?? 0) === 0) return failure('WAYVRO_E_NOT_FOUND');
      }
      const r = await tx.query(
        `update identity.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'STAFF_ON_BEHALF', version = version + 1
          where account_id = $1 and status = 'ACTIVE' and ($2::uuid is null or id = $2)`,
        [accountId, input.scope === 'ONE' ? input.sessionId : null],
      );
      const revoked = r.rowCount ?? 0;
      if (revoked > 0) {
        await tx.query(`insert into identity.security_events (id, account_id, type) values ($1, $2, 'SESSIONS_REVOKED_BY_SUPPORT')`, [uuidv7(), accountId]);
      }
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: staff.breakGlassId ? 'SUPPORT_SESSIONS_REVOKED_BREAK_GLASS' : 'SUPPORT_SESSIONS_REVOKED',
        objectType: 'identity.account',
        objectId: accountId,
        outcome: 'SUCCESS',
        reasonCode: input.reasonCode,
      });
      return success(200, { revokedCount: revoked });
    });
  }

  /** Opens (or attaches to) the ACCOUNT_RECOVERY review of an existing proof-bearing recovery; never decides it. */
  async assistRecovery(staff: StaffPrincipal, recoveryId: string, input: { reasonCode: string }, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'support.recovery-assistance', key, { recoveryId, ...input }, async (tx) => {
      const request = (
        await tx.query<{ account_id: string; requested_by_account_id: string | null; kind: string; status: string }>(
          `select account_id, requested_by_account_id, kind, status from identity.phone_change_requests where id = $1 for no key update`,
          [recoveryId],
        )
      ).rows[0];
      const review = request
        ? undefined
        : (
            await tx.query<{ account_id: string; status: string }>(
              `select account_id, status from identity.dormant_number_reviews where id = $1 for no key update`,
              [recoveryId],
            )
          ).rows[0];
      if (!request && !review) return failure('WAYVRO_E_NOT_FOUND');
      const accountId = request?.account_id ?? review?.account_id ?? '';
      if (!(await this.authorize(tx, staff, 'account.recovery_case.open', accountId, request?.requested_by_account_id ?? null)))
        return failure('WAYVRO_E_FORBIDDEN');
      // only proof-bearing recoveries awaiting a HUMAN review can be assisted
      const reviewable = request ? request.kind === 'RECOVERY_DRIVER_KYC' && request.status === 'MANUAL_REVIEW' : review?.status === 'IN_REVIEW';
      if (!reviewable) return failure('WAYVRO_E_CONFLICT');
      const subjectColumn = request ? 'phone_change_request_id' : 'dormant_number_review_id';
      const existing = (
        await tx.query<{ id: string; priority: number }>(
          `update compliance.review_cases set priority = least(priority + 1, 9), version = version + 1
            where ${subjectColumn} = $1 and status in ('OPEN', 'CLAIMED', 'ESCALATED') returning id, priority`,
          [recoveryId],
        )
      ).rows[0];
      let caseId = existing?.id;
      let priority = existing?.priority ?? 0;
      if (!caseId) {
        const target = (
          await tx.query<{ profile_id: string; city_code: string }>(
            `select p.id profile_id, a.city_code from compliance.driver_profiles p join compliance.driver_applications a on a.id = p.application_id where p.account_id = $1`,
            [accountId],
          )
        ).rows[0];
        if (!target) return failure('WAYVRO_E_CONFLICT');
        caseId = uuidv7();
        priority = 4;
        await tx.query(
          `insert into compliance.review_cases (id, kind, driver_profile_id, ${subjectColumn}, city_code, priority, status) values ($1, 'ACCOUNT_RECOVERY', $2, $3, $4, $5, 'OPEN')`,
          [caseId, target.profile_id, recoveryId, target.city_code, priority],
        );
      }
      await emitEvent(tx, { type: 'account.recovery.requested.v1', aggregateType: 'compliance.review_case', aggregateId: caseId, accountId });
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'SUPPORT_RECOVERY_ASSISTED',
        objectType: 'compliance.review_case',
        objectId: caseId,
        outcome: 'SUCCESS',
        reasonCode: input.reasonCode,
      });
      return success(200, { reviewCaseId: caseId, opened: existing === undefined, priority });
    });
  }
}
