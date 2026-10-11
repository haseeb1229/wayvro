/**
 * Appeals (V13, K05; data model §4.8; staff matrix `kyc.appeal.decide` / `restriction.appeal.decide`). An applicant may
 * appeal a REJECT decision or an appealable restriction — also while the account is restricted (restricted-ok route).
 * The statement is PII-classified free text, stored as an AES-256-GCM envelope (key class appeal_statements).
 *
 * Decision appeals are decided by a KYC senior reviewer, restriction appeals by Trust & Safety — never by the original
 * decider (or second approver) of the decision, nor by the restriction's creator, and never with a conflict of
 * interest. OVERTURNED reopens human review (new APPEAL case) or lifts the restriction; UPHELD makes a rejection final.
 */
import type { FieldCipher } from '@wayvro/field-crypto';
import { ENCRYPTED_FIELDS, fieldContext } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import { appendAudit, sqlState, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import { canTransition, type ApplicationState } from '../compliance/application-state.js';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome } from '../platform/idempotency.js';
import { emitEvent } from '../platform/outbox.js';
import { citiesFor, hasRole, type StaffPrincipal } from '../staff/staff-session.js';

interface Principal {
  readonly accountId: string;
}

interface AppealRow {
  id: string;
  account_id: string;
  review_decision_id: string | null;
  restriction_id: string | null;
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'UPHELD' | 'OVERTURNED' | 'WITHDRAWN';
  outcome_reason_code: string | null;
  created_at: Date;
  decided_at: Date | null;
}
const COLUMNS = 'id, account_id, review_decision_id, restriction_id, status, outcome_reason_code, created_at, decided_at';

const accountView = (a: AppealRow) => ({
  id: a.id,
  subject: a.review_decision_id ? ('REVIEW_DECISION' as const) : ('RESTRICTION' as const),
  subjectId: a.review_decision_id ?? a.restriction_id ?? '',
  status: a.status,
  outcomeReasonCode: a.outcome_reason_code,
  createdAt: a.created_at.toISOString(),
  decidedAt: a.decided_at?.toISOString() ?? null,
});

export class AppealsService {
  constructor(
    private readonly db: pg.Pool,
    private readonly cipher: FieldCipher,
    private readonly idempotency: IdempotencyStore,
    private readonly ttlSeconds: number,
  ) {}

  private runAs(scope: string, operation: string, key: string, payload: unknown, work: (tx: pg.PoolClient) => Promise<Outcome>): Promise<IdempotentResult> {
    return this.idempotency.execute({ scope, operation, key, payload, ttlSeconds: this.ttlSeconds }, work);
  }

  async create(
    principal: Principal,
    input: { reviewDecisionId?: string | undefined; restrictionId?: string | undefined; statement: string },
    key: string,
  ): Promise<IdempotentResult> {
    return this.runAs(`acct:${principal.accountId}`, 'appeal.create', key, input, async (tx) => {
      let applicationId: string | null = null;
      if (input.reviewDecisionId !== undefined) {
        const d = (
          await tx.query<{ decision: string; application_id: string; state: ApplicationState }>(
            `select d.decision, a.id application_id, a.state from compliance.review_decisions d
               join compliance.review_cases c on c.id = d.review_case_id join compliance.driver_applications a on a.id = c.driver_application_id
              where d.id = $1 and a.account_id = $2 for no key update of a`,
            [input.reviewDecisionId, principal.accountId],
          )
        ).rows[0];
        if (!d) return failure('WAYVRO_E_NOT_FOUND');
        if (d.decision !== 'REJECT' || !canTransition(d.state, 'APPEALED', 'APPLICANT')) return failure('WAYVRO_E_CONFLICT');
        applicationId = d.application_id;
      } else {
        const r = (
          await tx.query<{ appealable: boolean; status: string }>(
            `select r.appealable, r.status from profile.restrictions r left join compliance.driver_profiles p on p.id = r.driver_profile_id
              where r.id = $1 and coalesce(r.account_id, p.account_id) = $2`,
            [input.restrictionId, principal.accountId],
          )
        ).rows[0];
        if (!r) return failure('WAYVRO_E_NOT_FOUND');
        if (!r.appealable || r.status !== 'ACTIVE') return failure('WAYVRO_E_CONFLICT');
      }
      const id = uuidv7();
      await tx.query('savepoint new_appeal');
      try {
        await tx.query(
          `insert into profile.appeals (id, account_id, review_decision_id, restriction_id, status, statement_envelope) values ($1, $2, $3, $4, 'SUBMITTED', $5)`,
          [
            id,
            principal.accountId,
            input.reviewDecisionId ?? null,
            input.restrictionId ?? null,
            this.cipher.encrypt('appeal_statements', input.statement, fieldContext(ENCRYPTED_FIELDS.appealStatement, id)),
          ],
        );
      } catch (e) {
        if (sqlState(e) !== '23505') throw e;
        await tx.query('rollback to savepoint new_appeal');
        return failure('WAYVRO_E_CONFLICT');
      }
      if (applicationId !== null) {
        await tx.query(`update compliance.driver_applications set state = 'APPEALED', version = version + 1, updated_at = now() where id = $1`, [
          applicationId,
        ]);
      }
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'APPEAL_SUBMITTED',
        objectType: 'profile.appeal',
        objectId: id,
        outcome: 'SUCCESS',
      });
      const row = (await tx.query<AppealRow>(`select ${COLUMNS} from profile.appeals where id = $1`, [id])).rows[0];
      if (!row) throw new Error('appeal vanished');
      return success(201, accountView(row));
    });
  }

  async listOwn(principal: Principal): Promise<{ items: ReturnType<typeof accountView>[] }> {
    const r = await this.db.query<AppealRow>(`select ${COLUMNS} from profile.appeals where account_id = $1 order by created_at desc limit 50`, [
      principal.accountId,
    ]);
    return { items: r.rows.map(accountView) };
  }

  /** Open appeals the caller may decide: decision appeals (senior reviewers, city scope) and restriction appeals (T&S). */
  async listForStaff(staff: StaffPrincipal, query: { cursor?: string | undefined; limit?: number | undefined }) {
    const limit = query.limit ?? 20;
    const before = query.cursor === undefined ? null : Buffer.from(query.cursor, 'base64url').toString('utf8');
    if (before !== null && Number.isNaN(Date.parse(before))) throw new WayvroError('WAYVRO_E_VALIDATION');
    const seniorCities = hasRole(staff, 'KYC_SENIOR_REVIEWER') ? citiesFor(staff, 'appeal.decide') : new Set<string>();
    const trustAndSafety = hasRole(staff, 'TRUST_SAFETY_AGENT');
    const r = await this.db.query<{
      id: string;
      review_decision_id: string | null;
      status: string;
      city_code: string | null;
      assigned_staff_id: string | null;
      case_id: string | null;
      created_at: Date;
    }>(
      `select ap.id, ap.review_decision_id, ap.status, a.city_code, ap.assigned_staff_id,
              (select c2.id from compliance.review_cases c2 where c2.appeal_id = ap.id order by c2.created_at desc limit 1) case_id, ap.created_at
         from profile.appeals ap
         left join compliance.review_decisions d on d.id = ap.review_decision_id
         left join compliance.review_cases c on c.id = d.review_case_id
         left join compliance.driver_applications a on a.id = c.driver_application_id
        where ap.status in ('SUBMITTED', 'UNDER_REVIEW')
          and ((ap.review_decision_id is not null and $1::boolean and ($2::text[] is null or a.city_code = any($2::text[])))
               or (ap.restriction_id is not null and $3::boolean))
          and ($4::timestamptz is null or ap.created_at < $4::timestamptz)
        order by ap.created_at desc limit $5`,
      [hasRole(staff, 'KYC_SENIOR_REVIEWER'), seniorCities === null ? null : [...seniorCities], trustAndSafety, before, limit + 1],
    );
    const rows = r.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      items: rows.map((a) => ({
        id: a.id,
        subject: a.review_decision_id ? ('REVIEW_DECISION' as const) : ('RESTRICTION' as const),
        status: a.status,
        cityCode: a.city_code,
        assignedToMe: a.assigned_staff_id === staff.staffId,
        reviewCaseId: a.case_id,
        createdAt: a.created_at.toISOString(),
      })),
      nextCursor: r.rows.length > limit && last ? Buffer.from(last.created_at.toISOString()).toString('base64url') : null,
    };
  }

  private async deny(q: Queryable, staff: StaffPrincipal, appealId: string, reasonCode: string): Promise<Outcome> {
    await appendAudit(q, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: 'APPEAL_ACCESS_DENIED',
      objectType: 'profile.appeal',
      objectId: appealId,
      outcome: 'DENIED',
      reasonCode,
    });
    return failure('WAYVRO_E_FORBIDDEN');
  }

  async decide(
    staff: StaffPrincipal,
    appealId: string,
    input: { outcome: 'UPHELD' | 'OVERTURNED'; reasonCode: string },
    key: string,
  ): Promise<IdempotentResult> {
    return this.runAs(`staff:${staff.staffId}`, 'appeal.decide', key, { appealId, ...input }, async (tx) => {
      const appeal = (await tx.query<AppealRow>(`select ${COLUMNS} from profile.appeals where id = $1 for no key update`, [appealId])).rows[0];
      if (!appeal) return failure('WAYVRO_E_NOT_FOUND');
      if (appeal.status !== 'SUBMITTED' && appeal.status !== 'UNDER_REVIEW') return failure('WAYVRO_E_CONFLICT');
      if (staff.consumerAccountId !== null && staff.consumerAccountId === appeal.account_id) return this.deny(tx, staff, appealId, 'CONFLICT_OF_INTEREST');
      let reviewCaseId: string | null = null;
      if (appeal.review_decision_id !== null) {
        const d = (
          await tx.query<{ decided_by_staff_id: string; second_approver: string | null; application_id: string; city_code: string; state: ApplicationState }>(
            `select d.decided_by_staff_id, s.approver_staff_id second_approver, a.id application_id, a.city_code, a.state
               from compliance.review_decisions d join compliance.review_cases c on c.id = d.review_case_id
               join compliance.driver_applications a on a.id = c.driver_application_id
               left join compliance.review_second_approvals s on s.review_decision_id = d.id
              where d.id = $1 for no key update of a`,
            [appeal.review_decision_id],
          )
        ).rows[0];
        if (!d) return failure('WAYVRO_E_NOT_FOUND');
        const cities = citiesFor(staff, 'appeal.decide');
        if (!hasRole(staff, 'KYC_SENIOR_REVIEWER') || (cities !== null && !cities.has(d.city_code))) return this.deny(tx, staff, appealId, 'NOT_PERMITTED');
        if (d.decided_by_staff_id === staff.staffId || d.second_approver === staff.staffId) return this.deny(tx, staff, appealId, 'ORIGINAL_DECIDER');
        const next: ApplicationState = input.outcome === 'UPHELD' ? 'REJECTED_FINAL' : 'MANUAL_REVIEW';
        if (!canTransition(d.state, next, 'REVIEWER')) return failure('WAYVRO_E_CONFLICT');
        await tx.query(`update compliance.driver_applications set state = $2, version = version + 1, updated_at = now() where id = $1`, [
          d.application_id,
          next,
        ]);
        if (input.outcome === 'OVERTURNED') {
          reviewCaseId = uuidv7();
          await tx.query(
            `insert into compliance.review_cases (id, kind, driver_application_id, appeal_id, city_code, priority, status) values ($1, 'APPEAL', $2, $3, $4, 5, 'OPEN')`,
            [reviewCaseId, d.application_id, appealId, d.city_code],
          );
        }
      } else {
        const r = (
          await tx.query<{ id: string; created_by_staff_id: string | null; status: string; account_id: string | null; profile_account: string | null }>(
            `select r.id, r.created_by_staff_id, r.status, r.account_id, p.account_id profile_account from profile.restrictions r
               left join compliance.driver_profiles p on p.id = r.driver_profile_id where r.id = $1 for no key update of r`,
            [appeal.restriction_id],
          )
        ).rows[0];
        if (!r) return failure('WAYVRO_E_NOT_FOUND');
        if (!hasRole(staff, 'TRUST_SAFETY_AGENT')) return this.deny(tx, staff, appealId, 'NOT_PERMITTED');
        if (r.created_by_staff_id === staff.staffId) return this.deny(tx, staff, appealId, 'RESTRICTION_CREATOR');
        if (input.outcome === 'OVERTURNED' && r.status === 'ACTIVE') {
          await tx.query(
            `update profile.restrictions set status = 'LIFTED', lifted_by_staff_id = $2, lift_reason_code = 'APPEAL_OVERTURNED', lifted_at = now(), version = version + 1 where id = $1`,
            [r.id, staff.staffId],
          );
          await tx.query(
            `insert into profile.restriction_events (id, restriction_id, event, actor_staff_id, reason_code) values ($1, $2, 'LIFTED', $3, 'APPEAL_OVERTURNED')`,
            [uuidv7(), r.id, staff.staffId],
          );
          await emitEvent(tx, {
            type: 'restriction.changed.v1',
            aggregateType: 'profile.restriction',
            aggregateId: r.id,
            accountId: r.account_id ?? r.profile_account,
            payload: { status: 'LIFTED' },
          });
        }
      }
      await tx.query(
        `update profile.appeals set status = $2, assigned_staff_id = $3, decided_by_staff_id = $3, outcome_reason_code = $4, decided_at = now(), version = version + 1 where id = $1`,
        [appealId, input.outcome, staff.staffId, input.reasonCode],
      );
      await emitEvent(tx, {
        type: 'appeal.decided.v1',
        aggregateType: 'profile.appeal',
        aggregateId: appealId,
        accountId: appeal.account_id,
        payload: { outcome: input.outcome },
      });
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'APPEAL_DECIDED',
        objectType: 'profile.appeal',
        objectId: appealId,
        outcome: 'SUCCESS',
        reasonCode: input.outcome,
      });
      return success(200, { appealId, status: input.outcome, reviewCaseId });
    });
  }
}
