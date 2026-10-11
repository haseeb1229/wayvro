/**
 * Dormant-number review (S12/S13; auth design §6.1; founder Q-07/Q-08). A sign-in on a dormant account from an unknown
 * installation gets a RESTRICTED session that reaches only this review (and sign-out). Choices:
 *
 * - I_AM_NEW (always): the dormant account's phone is RELEASED (RECYCLED_NUMBER_NEW_OWNER), the dormant account is put
 *   on an appealable ACCOUNT `SECURITY_HOLD` with every session revoked and is retained under policy, and the caller
 *   continues in a brand-new account for the number. Nothing of the old account is ever shown.
 * - THIS_IS_MY_ACCOUNT (strong proof only): available where the account has a driver profile — an ACCOUNT_RECOVERY
 *   review case (in-person identity check + second senior approver). Linked OIDC proof arrives with P2.10. A
 *   rider-only account without a strong factor cannot be claimed (no support-judgement restoration).
 */
import type { FieldCipher } from '@wayvro/field-crypto';
import { WayvroError } from '@wayvro/observability';
import { appendAudit, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { Principal } from '../auth/policy.js';
import { failure, success, type IdempotencyStore, type IdempotentResult } from '../platform/idempotency.js';
import { releasePhone, revokeSessions } from '@wayvro/identity-core';
import { currentPhone } from './account-security.service.js';
import { createSystemRestriction } from './risk-policy.js';
import { RESTRICTING_REVIEW_STATES } from './session-gates.js';
import { securityEvent, type SessionService } from './session.service.js';

type ReviewStatus = 'PENDING' | 'IN_REVIEW' | 'RESOLVED_OWNER' | 'RESOLVED_NEW_ACCOUNT' | 'DENIED';
interface ReviewRow {
  id: string;
  account_id: string;
  session_id: string;
  status: ReviewStatus;
}

export class RecoveryReviewService {
  constructor(
    private readonly db: pg.Pool,
    private readonly cipher: FieldCipher,
    private readonly idempotency: IdempotencyStore,
    private readonly sessions: SessionService,
    private readonly policy: { readonly IDEMPOTENCY_TTL_SECONDS: number },
  ) {}

  private async hasDriverProfile(q: Queryable, accountId: string): Promise<boolean> {
    return ((await q.query(`select 1 from compliance.driver_profiles where account_id = $1`, [accountId])).rowCount ?? 0) > 0;
  }

  private async view(q: Queryable, r: ReviewRow) {
    const claimable = r.status === 'PENDING' && (await this.hasDriverProfile(q, r.account_id));
    return { id: r.id, status: r.status, choices: claimable ? ['I_AM_NEW', 'THIS_IS_MY_ACCOUNT'] : ['I_AM_NEW'] };
  }

  async current(principal: Principal): Promise<unknown> {
    const r = (
      await this.db.query<ReviewRow>(
        `select id, account_id, session_id, status from identity.dormant_number_reviews where session_id = $1 and status = any($2::text[])`,
        [principal.sessionId, [...RESTRICTING_REVIEW_STATES]],
      )
    ).rows[0];
    return { review: r ? await this.view(this.db, r) : null };
  }

  async choose(principal: Principal, id: string, choice: 'I_AM_NEW' | 'THIS_IS_MY_ACCOUNT', key: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      {
        scope: `sess:${principal.sessionId}`,
        operation: 'recovery-reviews.choose',
        key,
        payload: { id, choice },
        ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        const r = (
          await tx.query<ReviewRow>(
            `select id, account_id, session_id, status from identity.dormant_number_reviews where id = $1 and session_id = $2 for update`,
            [id, principal.sessionId],
          )
        ).rows[0];
        if (!r) return failure('WAYVRO_E_NOT_FOUND');
        if (!(RESTRICTING_REVIEW_STATES as readonly string[]).includes(r.status)) return failure('WAYVRO_E_CONFLICT');
        if (choice === 'THIS_IS_MY_ACCOUNT') {
          if (r.status !== 'PENDING' || !(await this.hasDriverProfile(tx, r.account_id))) return failure('WAYVRO_E_CONFLICT');
          return success(200, { review: await this.claim(tx, r), newAccountSession: null });
        }
        const session = await this.startOver(tx, r);
        const resolved = { ...r, status: 'RESOLVED_NEW_ACCOUNT' as const };
        return success(200, { review: { id: resolved.id, status: resolved.status, choices: [] }, newAccountSession: session });
      },
    );
  }

  /** THIS_IS_MY_ACCOUNT for a driver account: an ACCOUNT_RECOVERY case for a human identity check. */
  private async claim(tx: pg.PoolClient, r: ReviewRow) {
    const target = (
      await tx.query<{ profile_id: string; city_code: string }>(
        `select p.id profile_id, a.city_code from compliance.driver_profiles p join compliance.driver_applications a on a.id = p.application_id where p.account_id = $1`,
        [r.account_id],
      )
    ).rows[0];
    if (!target) throw new WayvroError('WAYVRO_E_CONFLICT');
    await tx.query(`update identity.dormant_number_reviews set status = 'IN_REVIEW', version = version + 1 where id = $1`, [r.id]);
    await tx.query(
      `insert into compliance.review_cases (id, kind, driver_profile_id, dormant_number_review_id, city_code, priority, status) values ($1, 'ACCOUNT_RECOVERY', $2, $3, $4, 3, 'OPEN')`,
      [uuidv7(), target.profile_id, r.id, target.city_code],
    );
    await securityEvent(tx, r.account_id, 'RECOVERY_REQUESTED', r.session_id);
    await appendAudit(tx, {
      actor: { type: 'ACCOUNT', id: r.account_id },
      action: 'DORMANT_NUMBER_CLAIMED',
      objectType: 'identity.dormant_number_review',
      objectId: r.id,
      outcome: 'SUCCESS',
    });
    return this.view(tx, { ...r, status: 'IN_REVIEW' });
  }

  /** I_AM_NEW: release the number, hold the dormant account, start a clean account on this installation. */
  private async startOver(tx: pg.PoolClient, r: ReviewRow) {
    const phone = await currentPhone(tx, this.cipher, r.account_id);
    if (!phone) throw new WayvroError('WAYVRO_E_CONFLICT');
    const device = (
      await tx.query<{ installation_hash: Buffer; platform: 'ANDROID' | 'IOS'; app_version: string; locale: string }>(
        `select d.installation_hash, d.platform, d.app_version, a.preferred_locale locale
           from identity.sessions s join identity.account_devices d on d.id = s.device_id join identity.accounts a on a.id = s.account_id where s.id = $1`,
        [r.session_id],
      )
    ).rows[0];
    if (!device) throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
    await releasePhone(tx, phone.id, 'RECYCLED_NUMBER_NEW_OWNER');
    await createSystemRestriction(tx, {
      scope: 'ACCOUNT',
      subjectId: r.account_id,
      reasonClass: 'SECURITY_HOLD',
      reasonCode: 'RECYCLED_NUMBER_NEW_OWNER',
      system: 'dormant-number-review',
      effectiveHours: null,
      accountId: r.account_id,
    });
    await revokeSessions(tx, r.account_id, 'RESTRICTION_SECURITY_HOLD', null);
    await tx.query(
      `update compliance.review_cases set status = 'CANCELLED', assigned_staff_id = null, lease_expires_at = null, version = version + 1
        where dormant_number_review_id = $1 and status in ('OPEN', 'CLAIMED', 'ESCALATED')`,
      [r.id],
    );
    await securityEvent(tx, r.account_id, 'DORMANT_NUMBER_RELEASED', null);
    const session = await this.sessions.startFreshAccount(tx, phone.e164, device.locale, {
      installation: device.installation_hash,
      platform: device.platform,
      appVersion: device.app_version,
    });
    const newAccount = (await tx.query<{ account_id: string }>(`select account_id from identity.sessions where id = $1`, [session.sessionId])).rows[0];
    await tx.query(
      `update identity.dormant_number_reviews set status = 'RESOLVED_NEW_ACCOUNT', new_account_id = $2, resolved_at = now(), version = version + 1 where id = $1`,
      [r.id, newAccount?.account_id],
    );
    await appendAudit(tx, {
      actor: { type: 'SYSTEM' },
      action: 'DORMANT_NUMBER_RELEASED',
      objectType: 'identity.account',
      objectId: r.account_id,
      outcome: 'SUCCESS',
      reasonCode: 'RECYCLED_NUMBER_NEW_OWNER',
    });
    return session;
  }
}
