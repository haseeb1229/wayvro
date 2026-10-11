/**
 * Manual review (K04/K05/H02/D03/D04/A15; KYC doc §8; staff matrix §4). Every decision is a HUMAN decision recorded with
 * a schema-versioned checklist, reason codes from the code-defined catalogue, the evidence relied on and the decider's
 * staff session. There is no automated edge into VERIFIED (application state machine) and no score.
 *
 * Claims are 30-minute leases (renewable); decisions need the claim, a fresh step-up (route policy) and the
 * decision-specific permission. City scope and the conflict-of-interest rule apply to every case. An APPROVE with open
 * duplicate signals is reserved to a senior reviewer, must clear every signal, and needs a SECOND senior approver
 * (maker-checker, enforced by the database too). Approval creates the driver profile from the reviewer-confirmed claims,
 * validates the documents and grants service capabilities — all in one transaction with the outbox events.
 */
import { REVIEW_REASON_CATALOGUE, type CHECKLIST_ITEMS_V1, type ErrorCode } from '@wayvro/contracts';
import type { FieldCipher } from '@wayvro/field-crypto';
import { ENCRYPTED_FIELDS, fieldContext } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import { appendAudit, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import { canTransition, type ApplicationState } from '../compliance/application-state.js';
import { ageOn } from '../compliance/eligibility.js';
import type { EvidenceSummaryPort } from '../compliance/onboarding.service.js';
import { currentAgePolicy } from '../legal/age-policy.js';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome, type Refusal } from '../platform/idempotency.js';
import { securityEvent } from '../identity/session.service.js';
import { emitEvent } from '../platform/outbox.js';
import type { StaffPermission } from '../staff/roles.js';
import { citiesFor, hasRole, type StaffPrincipal } from '../staff/staff-session.js';

const LEASE_MINUTES = 30;
type Decision = keyof typeof REVIEW_REASON_CATALOGUE;
const DECISION_PERMISSION: Readonly<Record<Decision, StaffPermission>> = {
  APPROVE: 'kyc.decision.approve',
  NEEDS_INFO: 'kyc.decision.needs_info',
  REJECT: 'kyc.decision.reject',
  ESCALATE: 'kyc.case.claim',
  REQUIRE_IN_PERSON: 'kyc.decision.require_in_person',
};

interface CaseRow {
  id: string;
  kind: 'INITIAL_APPLICATION' | 'RESUBMISSION' | 'APPEAL' | 'DOCUMENT_RENEWAL' | 'ACCOUNT_RECOVERY' | 'REVERIFICATION';
  status: 'OPEN' | 'CLAIMED' | 'ESCALATED' | 'DECIDED' | 'CANCELLED';
  driver_application_id: string | null;
  driver_profile_id: string | null;
  compliance_document_id: string | null;
  phone_change_request_id: string | null;
  dormant_number_review_id: string | null;
  appeal_id: string | null;
  city_code: string;
  priority: number;
  assigned_staff_id: string | null;
  lease_expires_at: Date | null;
  escalated: boolean;
  in_person_required: boolean;
  created_at: Date;
  version: number;
}
interface AccountSubject {
  profile_id: string;
  account_id: string;
  application_id: string;
  application_state: ApplicationState;
  requested_by_account_id: string | null;
}
/** Lost-phone recovery: "cancel if this wasn't you" window after the second approval (auth design §6.4). */
const RECOVERY_COOLDOWN_HOURS = 72;
interface RenewalSubject {
  id: string;
  status: string;
  supersedes_id: string;
  document_type_code: string;
  profile_id: string;
  account_id: string;
  application_id: string;
  application_state: ApplicationState;
}
const CASE_COLUMNS = `id, kind, status, driver_application_id, driver_profile_id, compliance_document_id, phone_change_request_id, dormant_number_review_id, appeal_id, city_code, priority, assigned_staff_id, lease_expires_at, escalated,
  in_person_required, created_at, version`;

export interface ReviewPolicy {
  readonly IDEMPOTENCY_TTL_SECONDS: number;
}

export interface DecisionInput {
  readonly expectedVersion: number;
  readonly decision: Decision;
  readonly reasonCodes: readonly string[];
  readonly checklist: {
    readonly schemaVersion: 1;
    readonly items: Readonly<Record<(typeof CHECKLIST_ITEMS_V1)[number], 'CONFIRMED' | 'NOT_CONFIRMED' | 'NOT_APPLICABLE'>>;
  };
  readonly identityMatch?: 'CONFIRMED_BY_REVIEWER' | 'NOT_MATCHING' | 'UNCERTAIN_ESCALATE' | 'IN_PERSON_REQUIRED' | undefined;
  readonly evidenceIds: readonly string[];
  readonly signalResolutions?: ReadonlyArray<{ readonly signalId: string; readonly outcome: 'CLEARED' | 'CONFIRMED_FRAUD' }> | undefined;
}

const toCursor = (priority: number, createdAt: Date, id: string) => Buffer.from(`${String(priority)}|${createdAt.toISOString()}|${id}`).toString('base64url');
function fromCursor(cursor: string | undefined): { priority: number; createdAt: string; id: string } | null {
  if (cursor === undefined) return null;
  const [p, at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!p || !at || !id || !/^[0-9a-f-]{36}$/.test(id) || Number.isNaN(Date.parse(at))) throw new WayvroError('WAYVRO_E_VALIDATION');
  return { priority: Number(p), createdAt: at, id };
}

export class ReviewService {
  constructor(
    private readonly db: pg.Pool,
    private readonly cipher: FieldCipher,
    private readonly idempotency: IdempotencyStore,
    private readonly evidence: EvidenceSummaryPort | null,
    private readonly policy: ReviewPolicy,
  ) {}

  private async deny(q: Queryable, staff: StaffPrincipal, objectId: string, reasonCode: string): Promise<void> {
    await appendAudit(q, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: 'REVIEW_ACCESS_DENIED',
      objectType: 'compliance.review_case',
      objectId,
      outcome: 'DENIED',
      reasonCode,
    });
  }

  /** City scope of the caller for `permission` (null = every city). */
  private inScope(staff: StaffPrincipal, permission: StaffPermission, city: string): boolean {
    const cities = citiesFor(staff, permission);
    return cities === null || cities.has(city);
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

  async list(
    staff: StaffPrincipal,
    query: {
      status?: 'OPEN' | 'CLAIMED' | 'ESCALATED' | undefined;
      mine?: 'true' | 'false' | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    },
  ) {
    const cities = citiesFor(staff, 'kyc.queue.view');
    const limit = query.limit ?? 20;
    const after = fromCursor(query.cursor);
    // escalated cases (incl. approvals awaiting a second approver) are visible to senior reviewers only
    const senior = hasRole(staff, 'KYC_SENIOR_REVIEWER');
    const r = await this.db.query<CaseRow & { open_signals: string }>(
      `select ${CASE_COLUMNS.split(',')
        .map((c) => `c.${c.trim()}`)
        .join(', ')},
              (select count(*) from compliance.duplicate_signals s
                where s.status = 'OPEN' and (s.subject_application_id = c.driver_application_id or s.subject_document_id = c.compliance_document_id
                  or s.subject_document_id in (select d.id from compliance.compliance_documents d where d.driver_application_id = c.driver_application_id and d.status <> 'SUPERSEDED'))) open_signals
         from compliance.review_cases c
        where c.status in ('OPEN', 'CLAIMED', 'ESCALATED')
          and ($1::text[] is null or c.city_code = any($1::text[]))
          and ($2::text is null or c.status = $2)
          and ($3::boolean = false or c.assigned_staff_id = $4)
          and ($5::boolean or c.status <> 'ESCALATED')
          and ($6::int is null or (c.priority, c.created_at, c.id) < ($6::int, $7::timestamptz, $8::uuid))
        order by c.priority desc, c.created_at desc, c.id desc
        limit $9`,
      [
        cities === null ? null : [...cities],
        query.status ?? null,
        query.mine === 'true',
        staff.staffId,
        senior,
        after?.priority ?? null,
        after?.createdAt ?? null,
        after?.id ?? null,
        limit + 1,
      ],
    );
    const rows = r.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      items: rows.map((c) => ({
        id: c.id,
        kind: c.kind,
        status: c.status,
        cityCode: c.city_code,
        priority: c.priority,
        escalated: c.escalated,
        inPersonRequired: c.in_person_required,
        assignedToMe: c.assigned_staff_id === staff.staffId,
        openSignals: Number(c.open_signals),
        createdAt: c.created_at.toISOString(),
      })),
      nextCursor: r.rows.length > limit && last ? toCursor(last.priority, last.created_at, last.id) : null,
    };
  }

  private async loadCase(q: Queryable, id: string, lock = false): Promise<CaseRow | null> {
    const r = await q.query<CaseRow>(`select ${CASE_COLUMNS} from compliance.review_cases where id = $1 ${lock ? 'for no key update' : ''}`, [id]);
    return r.rows[0] ?? null;
  }

  /** The application behind a case: its own, or the verified driver's application for a document renewal. */
  private async applicationOf(q: Queryable, c: CaseRow): Promise<string | null> {
    if (c.driver_application_id !== null) return c.driver_application_id;
    if (c.driver_profile_id === null) return null;
    return (
      (await q.query<{ application_id: string }>(`select application_id from compliance.driver_profiles where id = $1`, [c.driver_profile_id])).rows[0]
        ?.application_id ?? null
    );
  }

  /** Evidence case scoping (CaseClaimPort): a live lease of `staffId` on an open case concerning the application. */
  async holdsLiveClaim(staffId: string, applicationId: string): Promise<boolean> {
    const r = await this.db.query(
      `select 1 from compliance.review_cases c left join compliance.driver_profiles p on p.id = c.driver_profile_id
        where (c.driver_application_id = $1 or p.application_id = $1) and c.status = 'CLAIMED' and c.assigned_staff_id = $2 and c.lease_expires_at > now()`,
      [applicationId, staffId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Duplicate signals that concern a case: those of the application and its live documents, or — for a renewal — those
   * of the renewed document's new number.
   */
  private async caseSignals(q: Queryable, c: CaseRow, applicationId: string, openOnly: boolean) {
    const r = await q.query<{ id: string; signal: string; status: string; created_at: Date }>(
      `select s.id, s.signal, s.status, s.created_at from compliance.duplicate_signals s
        where ($3::boolean = false or s.status = 'OPEN')
          and (case when $2::uuid is not null then s.subject_document_id = $2
                    else (s.subject_application_id = $1 or s.subject_document_id in (
                            select d.id from compliance.compliance_documents d where d.driver_application_id = $1 and d.status <> 'SUPERSEDED')) end)
        order by s.created_at`,
      [applicationId, c.kind === 'DOCUMENT_RENEWAL' ? c.compliance_document_id : null, openOnly],
    );
    return r.rows;
  }

  private async accountOf(q: Queryable, applicationId: string | null): Promise<string | null> {
    if (applicationId === null) return null;
    return (
      (await q.query<{ account_id: string }>(`select account_id from compliance.driver_applications where id = $1`, [applicationId])).rows[0]?.account_id ??
      null
    );
  }

  /** Claim (or renew) the lease. Escalated cases need a senior reviewer. */
  async claim(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'review.claim', key, { id, at: Math.floor(Date.now() / 60_000) }, async (tx) => {
      const c = await this.loadCase(tx, id, true);
      if (!c) return failure('WAYVRO_E_NOT_FOUND');
      if (!this.inScope(staff, 'kyc.case.claim', c.city_code)) {
        await this.deny(tx, staff, id, 'CITY_SCOPE');
        return failure('WAYVRO_E_FORBIDDEN');
      }
      if (staff.consumerAccountId !== null && staff.consumerAccountId === (await this.accountOf(tx, await this.applicationOf(tx, c)))) {
        await this.deny(tx, staff, id, 'CONFLICT_OF_INTEREST');
        return failure('WAYVRO_E_FORBIDDEN');
      }
      const leaseLive = c.status === 'CLAIMED' && c.lease_expires_at !== null && c.lease_expires_at.getTime() > Date.now();
      if (c.status === 'DECIDED' || c.status === 'CANCELLED' || (leaseLive && c.assigned_staff_id !== staff.staffId)) return failure('WAYVRO_E_CONFLICT');
      if (c.status === 'ESCALATED' && !hasRole(staff, 'KYC_SENIOR_REVIEWER')) return failure('WAYVRO_E_FORBIDDEN');
      if (c.status === 'ESCALATED' && (await this.pendingSecondApproval(tx, id)))
        return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['AWAITING_SECOND_APPROVAL'] });
      await tx.query(
        `update compliance.review_cases set status = 'CLAIMED', assigned_staff_id = $2, lease_expires_at = now() + ($3::int * interval '1 minute'), version = version + 1
          where id = $1`,
        [id, staff.staffId, LEASE_MINUTES],
      );
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'REVIEW_CASE_CLAIMED',
        objectType: 'compliance.review_case',
        objectId: id,
        outcome: 'SUCCESS',
      });
      return success(200, await this.detailIn(tx, staff, id));
    });
  }

  async release(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'review.release', key, { id }, async (tx) => {
      const c = await this.loadCase(tx, id, true);
      if (!c) return failure('WAYVRO_E_NOT_FOUND');
      if (c.status !== 'CLAIMED' || c.assigned_staff_id !== staff.staffId) return failure('WAYVRO_E_CONFLICT');
      await tx.query(
        `update compliance.review_cases set status = case when escalated then 'ESCALATED' else 'OPEN' end, assigned_staff_id = null, lease_expires_at = null,
                version = version + 1 where id = $1`,
        [id],
      );
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'REVIEW_CASE_RELEASED',
        objectType: 'compliance.review_case',
        objectId: id,
        outcome: 'SUCCESS',
      });
      return success(204, null);
    });
  }

  private async pendingSecondApproval(q: Queryable, caseId: string): Promise<boolean> {
    const r = await q.query(
      `select 1 from compliance.review_decisions d left join compliance.review_second_approvals s on s.review_decision_id = d.id
        where d.review_case_id = $1 and d.requires_second_approval and s.review_decision_id is null`,
      [caseId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Masked case view: claimed by the caller, or any in-scope case for a senior reviewer. */
  async detail(staff: StaffPrincipal, id: string): Promise<unknown> {
    const c = await this.loadCase(this.db, id);
    if (!c) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    const mine = c.status === 'CLAIMED' && c.assigned_staff_id === staff.staffId;
    if (!this.inScope(staff, 'kyc.case.view_masked', c.city_code) || (!mine && !hasRole(staff, 'KYC_SENIOR_REVIEWER'))) {
      await this.deny(this.db, staff, id, mine ? 'CITY_SCOPE' : 'CASE_NOT_CLAIMED');
      throw new WayvroError('WAYVRO_E_FORBIDDEN');
    }
    await appendAudit(this.db, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: 'REVIEW_CASE_VIEWED',
      objectType: 'compliance.review_case',
      objectId: id,
      outcome: 'SUCCESS',
    });
    return this.detailIn(this.db, staff, id);
  }

  private async recoveryOf(q: Queryable, c: CaseRow): Promise<{ kind: 'LOST_PHONE' | 'DORMANT_NUMBER'; maskedNewPhone: string | null; requestedAt: string }> {
    if (c.phone_change_request_id !== null) {
      const r = (
        await q.query<{ new_phone_last4: string | null; created_at: Date }>(
          `select new_phone_last4, created_at from identity.phone_change_requests where id = $1`,
          [c.phone_change_request_id],
        )
      ).rows[0];
      return {
        kind: 'LOST_PHONE',
        maskedNewPhone: r?.new_phone_last4 ? `+92 3** *** **${r.new_phone_last4.slice(-2)}` : null,
        requestedAt: (r?.created_at ?? c.created_at).toISOString(),
      };
    }
    return { kind: 'DORMANT_NUMBER', maskedNewPhone: null, requestedAt: c.created_at.toISOString() };
  }

  private async riskTriggersOf(q: Queryable, c: CaseRow): Promise<string[]> {
    const r = await q.query<{ reason_code: string }>(
      `select reason_code from profile.restrictions where driver_profile_id = $1 and reason_class = 'RISK_HOLD' and status = 'ACTIVE' order by created_at`,
      [c.driver_profile_id],
    );
    return r.rows.map((x) => x.reason_code);
  }

  private async detailIn(q: Queryable, staff: StaffPrincipal, id: string): Promise<unknown> {
    const c = await this.loadCase(q, id);
    const appId = c ? await this.applicationOf(q, c) : null;
    if (!c || appId === null) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    const app = (
      await q.query<{
        id: string;
        state: string;
        submitted_at: Date | null;
        cnic_last4: string | null;
        legal_name_envelope: Buffer | null;
        date_of_birth_envelope: Buffer | null;
        requirement_set_id: string | null;
      }>(
        `select id, state, submitted_at, cnic_last4, legal_name_envelope, date_of_birth_envelope, requirement_set_id from compliance.driver_applications where id = $1`,
        [appId],
      )
    ).rows[0];
    if (!app) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    const name = app.legal_name_envelope
      ? this.cipher.decryptString('identity_numbers', app.legal_name_envelope, fieldContext(ENCRYPTED_FIELDS.applicationLegalName, appId))
      : null;
    const dob = app.date_of_birth_envelope
      ? this.cipher.decryptString('identity_dates', app.date_of_birth_envelope, fieldContext(ENCRYPTED_FIELDS.applicationDob, appId))
      : null;
    const policy = await currentAgePolicy(q);
    const ageOutcome =
      dob === null
        ? ('NO_CLAIM' as const)
        : policy.driverMinimumAge === null || policy.status !== 'APPROVED'
          ? ('NO_APPROVED_THRESHOLD' as const)
          : ageOn(dob, new Date()) >= policy.driverMinimumAge
            ? ('MEETS_MINIMUM' as const)
            : ('BELOW_MINIMUM' as const);
    const categories = await q.query<{ service_category: string }>(
      `select service_category from compliance.application_service_categories where application_id = $1 order by 1`,
      [appId],
    );
    const set = app.requirement_set_id
      ? (
          await q.query<{ id: string; version: number; is_placeholder: boolean }>(
            `select id, version, is_placeholder from compliance.requirement_sets where id = $1`,
            [app.requirement_set_id],
          )
        ).rows[0]
      : undefined;
    const documents = await q.query<{
      id: string;
      document_type_code: string;
      status: string;
      number_last4: string | null;
      licence_class: string | null;
      issued: string | null;
      expires: string | null;
      vehicle_id: string | null;
    }>(
      `select id, document_type_code, status, number_last4, licence_class, to_char(claimed_issued_on, 'YYYY-MM-DD') issued, to_char(claimed_expires_on, 'YYYY-MM-DD') expires, vehicle_id
         from compliance.compliance_documents where driver_application_id = $1 and status <> 'SUPERSEDED' order by created_at`,
      [appId],
    );
    const vehicles = await q.query<{
      id: string;
      plate_display: string;
      make: string;
      model: string;
      model_year: number;
      ownership_type: string;
      relation: string;
    }>(
      `select v.id, v.plate_display, v.make, v.model, v.model_year, v.ownership_type, va.relation from compliance.vehicle_affiliations va join compliance.vehicles v on v.id = va.vehicle_id
        where va.driver_application_id = $1 and va.status <> 'ENDED' order by va.created_at`,
      [appId],
    );
    const challenge = (
      await q.query<{ challenge_code: string; status: string }>(
        `select challenge_code, status from compliance.capture_challenges where application_id = $1 and status in ('USED', 'DECLINED_ACCESSIBILITY') order by issued_at desc limit 1`,
        [appId],
      )
    ).rows[0];
    const signals = await this.caseSignals(q, c, appId, false);
    const decisions = await q.query<{
      id: string;
      decision: Decision;
      reason_codes: string[];
      decided_at: Date;
      decided_by_staff_id: string;
      requires_second_approval: boolean;
      outcome: string | null;
    }>(
      `select d.id, d.decision, d.reason_codes, d.decided_at, d.decided_by_staff_id, d.requires_second_approval, s.outcome
         from compliance.review_decisions d join compliance.review_cases c on c.id = d.review_case_id
         left join compliance.review_second_approvals s on s.review_decision_id = d.id
        where c.driver_application_id = $1 or c.driver_profile_id in (select p.id from compliance.driver_profiles p where p.application_id = $1)
        order by d.decided_at`,
      [appId],
    );
    const appeal = c.appeal_id
      ? (
          await q.query<{ id: string; status: string; statement_envelope: Buffer; created_at: Date }>(
            `select id, status, statement_envelope, created_at from profile.appeals where id = $1`,
            [c.appeal_id],
          )
        ).rows[0]
      : undefined;
    const evidence = this.evidence ? await this.evidence.evidenceStates(appId) : [];
    return {
      id: c.id,
      kind: c.kind,
      status: c.status,
      version: c.version,
      cityCode: c.city_code,
      priority: c.priority,
      escalated: c.escalated,
      inPersonRequired: c.in_person_required,
      leaseExpiresAt: c.lease_expires_at?.toISOString() ?? null,
      subjectDocumentId: c.compliance_document_id,
      ...(c.kind === 'ACCOUNT_RECOVERY' ? { recovery: await this.recoveryOf(q, c) } : {}),
      ...(c.kind === 'REVERIFICATION' ? { riskTriggers: await this.riskTriggersOf(q, c) } : {}),
      application: {
        id: app.id,
        state: app.state,
        serviceCategories: categories.rows.map((r) => r.service_category),
        submittedAt: app.submitted_at?.toISOString() ?? null,
        claims: { legalName: name, cnicLast4: app.cnic_last4, dateOfBirth: dob },
        ageCheck: { policyVersion: policy.version, driverMinimumAge: policy.status === 'APPROVED' ? policy.driverMinimumAge : null, outcome: ageOutcome },
      },
      requirementSet: set ? { id: set.id, version: set.version, isPlaceholder: set.is_placeholder } : null,
      documents: documents.rows.map((d) => ({
        id: d.id,
        documentType: d.document_type_code,
        status: d.status,
        numberLast4: d.number_last4,
        licenceClass: d.licence_class,
        claimedIssuedOn: d.issued,
        claimedExpiresOn: d.expires,
        vehicleId: d.vehicle_id,
      })),
      vehicles: vehicles.rows.map((v) => ({
        id: v.id,
        plateDisplay: v.plate_display,
        make: v.make,
        model: v.model,
        modelYear: v.model_year,
        ownershipType: v.ownership_type,
        relation: v.relation,
      })),
      evidence: evidence.map((e) => ({
        evidenceId: e.evidenceId,
        documentId: e.documentId,
        kind: e.kind,
        status: e.status,
        captureSource: e.captureSource,
        pixelWidth: e.pixelWidth,
        pixelHeight: e.pixelHeight,
      })),
      captureChallenge: challenge ? { challengeCode: challenge.challenge_code, status: challenge.status } : null,
      duplicateSignals: signals.map((s) => ({ id: s.id, signal: s.signal, status: s.status, createdAt: s.created_at.toISOString() })),
      decisions: decisions.rows.map((d) => ({
        id: d.id,
        decision: d.decision,
        reasonCodes: d.reason_codes,
        decidedAt: d.decided_at.toISOString(),
        decidedByMe: d.decided_by_staff_id === staff.staffId,
        secondApproval: !d.requires_second_approval ? 'NOT_REQUIRED' : d.outcome === null ? 'PENDING' : d.outcome,
      })),
      appeal: appeal
        ? {
            id: appeal.id,
            status: appeal.status,
            statement: this.cipher.decryptString('appeal_statements', appeal.statement_envelope, fieldContext(ENCRYPTED_FIELDS.appealStatement, appeal.id)),
            createdAt: appeal.created_at.toISOString(),
          }
        : null,
    };
  }

  /** Validates a decision request against the catalogue, checklist and evidence; returns a failure code or null. */
  private validate(input: DecisionInput, applicationEvidence: ReadonlySet<string>): ErrorCode | null {
    const catalogue: readonly string[] = REVIEW_REASON_CATALOGUE[input.decision];
    if (!input.reasonCodes.every((r) => catalogue.includes(r))) return 'WAYVRO_E_VALIDATION';
    if (!input.evidenceIds.every((e) => applicationEvidence.has(e))) return 'WAYVRO_E_VALIDATION';
    const values = Object.values(input.checklist.items);
    if (input.decision === 'APPROVE') {
      if (values.includes('NOT_CONFIRMED') || input.identityMatch !== 'CONFIRMED_BY_REVIEWER' || input.evidenceIds.length === 0) return 'WAYVRO_E_VALIDATION';
    }
    if ((input.decision === 'APPROVE' || input.decision === 'REJECT') && input.identityMatch === undefined) return 'WAYVRO_E_VALIDATION';
    if (input.decision !== 'APPROVE' && input.decision !== 'REJECT' && (input.signalResolutions?.length ?? 0) > 0) return 'WAYVRO_E_VALIDATION';
    return null;
  }

  async decide(staff: StaffPrincipal, caseId: string, input: DecisionInput, key: string): Promise<IdempotentResult> {
    const evidence = this.evidence;
    if (evidence === null) throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE');
    return this.run(staff, 'review.decide', key, { caseId, ...input }, async (tx) => {
      const c = await this.loadCase(tx, caseId, true);
      if (!c) return failure('WAYVRO_E_NOT_FOUND');
      if (!staff.permissions.has(DECISION_PERMISSION[input.decision])) {
        await this.deny(tx, staff, caseId, 'DECISION_NOT_PERMITTED');
        return failure('WAYVRO_E_FORBIDDEN');
      }
      if (!this.inScope(staff, 'kyc.case.claim', c.city_code)) {
        await this.deny(tx, staff, caseId, 'CITY_SCOPE');
        return failure('WAYVRO_E_FORBIDDEN');
      }
      const leaseLive = c.status === 'CLAIMED' && c.assigned_staff_id === staff.staffId && (c.lease_expires_at?.getTime() ?? 0) > Date.now();
      if (!leaseLive || c.version !== input.expectedVersion) return failure('WAYVRO_E_CONFLICT');
      if (c.kind === 'DOCUMENT_RENEWAL') return this.decideRenewal(tx, staff, c, input, evidence);
      if (c.kind === 'ACCOUNT_RECOVERY' || c.kind === 'REVERIFICATION') return this.decideDriverAccount(tx, staff, c, input, evidence);
      if (!c.driver_application_id) return failure('WAYVRO_E_NOT_FOUND');
      const app = (
        await tx.query<{
          id: string;
          account_id: string;
          state: ApplicationState;
          legal_name_envelope: Buffer | null;
          date_of_birth_envelope: Buffer | null;
          cnic_envelope: Buffer | null;
        }>(
          `select id, account_id, state, legal_name_envelope, date_of_birth_envelope, cnic_envelope from compliance.driver_applications where id = $1 for no key update`,
          [c.driver_application_id],
        )
      ).rows[0];
      if (!app) return failure('WAYVRO_E_NOT_FOUND');
      if (staff.consumerAccountId !== null && staff.consumerAccountId === app.account_id) {
        await this.deny(tx, staff, caseId, 'CONFLICT_OF_INTEREST');
        return failure('WAYVRO_E_FORBIDDEN');
      }
      if (app.state !== 'MANUAL_REVIEW') return failure('WAYVRO_E_CONFLICT');
      const available = new Set((await evidence.evidenceStates(app.id)).filter((e) => e.status === 'ACCEPTED').map((e) => e.evidenceId));
      const invalid = this.validate(input, available);
      if (invalid) return failure(invalid);
      if (input.decision === 'APPROVE' && (app.legal_name_envelope === null || app.date_of_birth_envelope === null || app.cnic_envelope === null))
        return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['CLAIMS_INCOMPLETE'] });
      const signals = await this.signalGate(tx, staff, c, app.id, input);
      if (signals.kind === 'error') return signals;
      const { requiresSecond, resolutions } = signals;
      const decisionId = await this.recordDecision(tx, staff, caseId, input, requiresSecond);
      if (input.decision === 'REJECT') await this.resolveSignals(tx, staff, resolutions);
      let caseStatus: 'OPEN' | 'ESCALATED' | 'DECIDED' = 'DECIDED';
      let appState: ApplicationState = app.state;
      switch (input.decision) {
        case 'ESCALATE':
        case 'REQUIRE_IN_PERSON':
          caseStatus = await this.requeue(tx, caseId, input.decision);
          break;
        case 'APPROVE':
          if (requiresSecond) caseStatus = await this.requeue(tx, caseId, 'AWAIT_SECOND_APPROVAL');
          else appState = await this.finaliseApproval(tx, staff, c, app, decisionId, resolutions);
          break;
        default: {
          appState = input.decision === 'NEEDS_INFO' ? 'NEEDS_INFO' : 'REJECTED';
          if (!canTransition(app.state, appState, 'REVIEWER')) return failure('WAYVRO_E_CONFLICT');
          await tx.query(`update compliance.driver_applications set state = $2, decided_at = now(), version = version + 1, updated_at = now() where id = $1`, [
            app.id,
            appState,
          ]);
          await this.closeCase(tx, caseId);
        }
      }
      if (input.decision !== 'ESCALATE' && !requiresSecond) {
        await emitEvent(tx, {
          type: 'driver.application.decided.v1',
          aggregateType: 'compliance.driver_application',
          aggregateId: app.id,
          accountId: app.account_id,
          payload: { decision: input.decision, reasonCodes: [...input.reasonCodes] },
        });
      }
      await this.auditDecision(tx, staff, caseId, input.decision);
      return success(201, { decisionId, caseStatus, applicationState: appState, pendingSecondApproval: requiresSecond });
    });
  }

  /**
   * Open duplicate signals of the case (matrix): a KYC reviewer approves only without them; a senior must clear each and
   * a SECOND senior must approve. Resolutions are accepted only for open signals of this case, on APPROVE/REJECT.
   */
  private async signalGate(
    tx: pg.PoolClient,
    staff: StaffPrincipal,
    c: CaseRow,
    applicationId: string,
    input: DecisionInput,
  ): Promise<{ readonly kind: 'gate'; readonly requiresSecond: boolean; readonly resolutions: ReadonlyMap<string, 'CLEARED' | 'CONFIRMED_FRAUD'> } | Refusal> {
    const openSignals = (await this.caseSignals(tx, c, applicationId, true)).map((r) => r.id);
    const resolutions = new Map((input.signalResolutions ?? []).map((r) => [r.signalId, r.outcome]));
    if ([...resolutions.keys()].some((s) => !openSignals.includes(s))) return failure('WAYVRO_E_VALIDATION');
    if (input.decision !== 'APPROVE' || openSignals.length === 0) return { kind: 'gate', requiresSecond: false, resolutions };
    if (!hasRole(staff, 'KYC_SENIOR_REVIEWER') || !openSignals.every((s) => resolutions.get(s) === 'CLEARED')) {
      await this.deny(tx, staff, c.id, 'OPEN_DUPLICATE_SIGNALS');
      return failure('WAYVRO_E_FORBIDDEN');
    }
    return { kind: 'gate', requiresSecond: true, resolutions };
  }

  private async recordDecision(tx: pg.PoolClient, staff: StaffPrincipal, caseId: string, input: DecisionInput, requiresSecond: boolean): Promise<string> {
    const decisionId = uuidv7();
    await tx.query(
      `insert into compliance.review_decisions (id, review_case_id, decision, reason_codes, checklist, checklist_schema_version, identity_match_assessment,
                                                requires_second_approval, decided_by_staff_id, staff_session_id, break_glass_grant_id)
       values ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10)`,
      [
        decisionId,
        caseId,
        input.decision,
        [...input.reasonCodes],
        JSON.stringify(input.checklist.items),
        input.identityMatch ?? null,
        requiresSecond,
        staff.staffId,
        staff.sessionId,
        staff.breakGlassId,
      ],
    );
    for (const e of new Set(input.evidenceIds)) {
      await tx.query(`insert into compliance.review_decision_evidence (review_decision_id, evidence_object_id) values ($1, $2)`, [decisionId, e]);
    }
    return decisionId;
  }

  private async resolveSignals(tx: pg.PoolClient, staff: StaffPrincipal, resolutions: ReadonlyMap<string, 'CLEARED' | 'CONFIRMED_FRAUD'>): Promise<void> {
    for (const [signalId, outcome] of resolutions) {
      await tx.query(`update compliance.duplicate_signals set status = $2, resolved_at = now(), resolved_by_staff_id = $3 where id = $1 and status = 'OPEN'`, [
        signalId,
        outcome,
        staff.staffId,
      ]);
    }
  }

  /** Back to the queue without a final decision: escalated (also while awaiting a second approver) or in-person. */
  private async requeue(tx: pg.PoolClient, caseId: string, why: 'ESCALATE' | 'REQUIRE_IN_PERSON' | 'AWAIT_SECOND_APPROVAL'): Promise<'OPEN' | 'ESCALATED'> {
    if (why === 'REQUIRE_IN_PERSON') {
      await tx.query(
        `update compliance.review_cases set status = 'OPEN', in_person_required = true, assigned_staff_id = null, lease_expires_at = null, version = version + 1 where id = $1`,
        [caseId],
      );
      return 'OPEN';
    }
    await tx.query(
      `update compliance.review_cases set status = 'ESCALATED', escalated = true, assigned_staff_id = null, lease_expires_at = null,
              priority = case when $2 then least(priority + 1, 9) else priority end, version = version + 1 where id = $1`,
      [caseId, why === 'ESCALATE'],
    );
    return 'ESCALATED';
  }

  private async closeCase(tx: pg.PoolClient, caseId: string): Promise<void> {
    await tx.query(
      `update compliance.review_cases set status = 'DECIDED', decided_at = now(), assigned_staff_id = null, lease_expires_at = null, version = version + 1 where id = $1`,
      [caseId],
    );
  }

  private async auditDecision(tx: pg.PoolClient, staff: StaffPrincipal, caseId: string, decision: Decision): Promise<void> {
    await appendAudit(tx, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: staff.breakGlassId ? 'REVIEW_DECISION_RECORDED_BREAK_GLASS' : 'REVIEW_DECISION_RECORDED',
      objectType: 'compliance.review_case',
      objectId: caseId,
      outcome: 'SUCCESS',
      reasonCode: decision,
    });
  }

  /** The renewal document of a DOCUMENT_RENEWAL case with its driver (document and profile locked). */
  private async renewalSubject(tx: pg.PoolClient, c: CaseRow): Promise<RenewalSubject | null> {
    const r = await tx.query<RenewalSubject>(
      `select d.id, d.status, d.supersedes_id, d.document_type_code, p.id profile_id, p.account_id, p.application_id, a.state application_state
         from compliance.compliance_documents d
         join compliance.driver_profiles p on p.id = $2
         join compliance.driver_applications a on a.id = p.application_id
        where d.id = $1 and d.driver_application_id = p.application_id and d.supersedes_id is not null
        for no key update of d, p`,
      [c.compliance_document_id, c.driver_profile_id],
    );
    return r.rows[0] ?? null;
  }

  /**
   * DOCUMENT_RENEWAL (D03/R02–R06): APPROVE makes the renewal VALID with the reviewer-confirmed dates and supersedes the
   * renewed document; NEEDS_INFO and REJECT close the renewal as REJECTED (the driver starts a new one; the renewed
   * document is untouched). The decision must rely on evidence of the renewal itself. The application is not touched.
   */
  private async decideRenewal(tx: pg.PoolClient, staff: StaffPrincipal, c: CaseRow, input: DecisionInput, evidence: EvidenceSummaryPort): Promise<Outcome> {
    const subject = await this.renewalSubject(tx, c);
    if (!subject) return failure('WAYVRO_E_NOT_FOUND');
    if (staff.consumerAccountId !== null && staff.consumerAccountId === subject.account_id) {
      await this.deny(tx, staff, c.id, 'CONFLICT_OF_INTEREST');
      return failure('WAYVRO_E_FORBIDDEN');
    }
    if (subject.status !== 'SUBMITTED') return failure('WAYVRO_E_CONFLICT');
    const accepted = (await evidence.evidenceStates(subject.application_id)).filter((e) => e.status === 'ACCEPTED');
    const invalid = this.validate(input, new Set(accepted.map((e) => e.evidenceId)));
    if (invalid) return failure(invalid);
    const renewalEvidence = new Set(accepted.filter((e) => e.documentId === subject.id).map((e) => e.evidenceId));
    if (input.decision === 'APPROVE' && !input.evidenceIds.some((e) => renewalEvidence.has(e))) return failure('WAYVRO_E_VALIDATION');
    const signals = await this.signalGate(tx, staff, c, subject.application_id, input);
    if (signals.kind === 'error') return signals;
    const { requiresSecond, resolutions } = signals;
    const decisionId = await this.recordDecision(tx, staff, c.id, input, requiresSecond);
    if (input.decision === 'REJECT') await this.resolveSignals(tx, staff, resolutions);
    let caseStatus: 'OPEN' | 'ESCALATED' | 'DECIDED' = 'DECIDED';
    switch (input.decision) {
      case 'ESCALATE':
      case 'REQUIRE_IN_PERSON':
        caseStatus = await this.requeue(tx, c.id, input.decision);
        break;
      case 'APPROVE':
        if (requiresSecond) caseStatus = await this.requeue(tx, c.id, 'AWAIT_SECOND_APPROVAL');
        else await this.finaliseRenewal(tx, staff, c, subject, resolutions);
        break;
      default:
        await tx.query(`update compliance.compliance_documents set status = 'REJECTED', version = version + 1 where id = $1`, [subject.id]);
        await this.closeCase(tx, c.id);
    }
    if (input.decision !== 'ESCALATE' && !requiresSecond) await this.emitRenewalDecided(tx, subject, input.decision, input.reasonCodes);
    await this.auditDecision(tx, staff, c.id, input.decision);
    return success(201, { decisionId, caseStatus, applicationState: subject.application_state, pendingSecondApproval: requiresSecond });
  }

  private async emitRenewalDecided(tx: pg.PoolClient, subject: RenewalSubject, decision: Decision, reasonCodes: readonly string[]): Promise<void> {
    await emitEvent(tx, {
      type: 'driver.document.decided.v1',
      aggregateType: 'compliance.compliance_document',
      aggregateId: subject.id,
      accountId: subject.account_id,
      payload: { decision, documentType: subject.document_type_code, reasonCodes: [...reasonCodes] },
    });
  }

  /**
   * Renewal approved: the new document becomes VALID (claimed dates become confirmed values) and the renewed one
   * SUPERSEDED; a driver held EXPIRED returns to ACTIVE_ELIGIBLE (VERIFIED without a granted capability) once no
   * mandatory document of the pinned requirement set is still expired. Capabilities are untouched.
   */
  private async finaliseRenewal(
    tx: pg.PoolClient,
    staff: StaffPrincipal,
    c: CaseRow,
    subject: RenewalSubject,
    resolutions: ReadonlyMap<string, 'CLEARED' | 'CONFIRMED_FRAUD'>,
  ): Promise<void> {
    await tx.query(`update compliance.compliance_documents set status = 'SUPERSEDED', version = version + 1 where id = $1 and status in ('VALID', 'EXPIRED')`, [
      subject.supersedes_id,
    ]);
    await tx.query(
      `update compliance.compliance_documents set status = 'VALID', issued_on = claimed_issued_on, expires_on = claimed_expires_on, version = version + 1 where id = $1`,
      [subject.id],
    );
    await this.resolveSignals(tx, staff, resolutions);
    await tx.query(
      `update compliance.driver_profiles p
          set state = case when exists (select 1 from compliance.service_capabilities s where s.driver_profile_id = p.id and s.status = 'GRANTED')
                           then 'ACTIVE_ELIGIBLE' else 'VERIFIED' end,
              version = version + 1
        where p.id = $1 and p.state = 'EXPIRED'
          and not exists (
            select 1 from compliance.compliance_documents d
              join compliance.driver_applications a on a.id = d.driver_application_id
              join compliance.requirement_set_items i on i.requirement_set_id = a.requirement_set_id and i.document_type_code = d.document_type_code
             where a.id = p.application_id and d.status = 'EXPIRED' and i.mandatory)`,
      [subject.profile_id],
    );
    await this.closeCase(tx, c.id);
  }

  async secondApproval(staff: StaffPrincipal, decisionId: string, outcome: 'APPROVED' | 'REJECTED', key: string): Promise<IdempotentResult> {
    return this.run(staff, 'review.second-approval', key, { decisionId, outcome }, async (tx) => {
      const d = (
        await tx.query<{ id: string; review_case_id: string; decided_by_staff_id: string; requires_second_approval: boolean; done: boolean }>(
          `select d.id, d.review_case_id, d.decided_by_staff_id, d.requires_second_approval, s.review_decision_id is not null done
             from compliance.review_decisions d left join compliance.review_second_approvals s on s.review_decision_id = d.id where d.id = $1`,
          [decisionId],
        )
      ).rows[0];
      if (!d) return failure('WAYVRO_E_NOT_FOUND');
      if (!d.requires_second_approval || d.done) return failure('WAYVRO_E_CONFLICT');
      const c = await this.loadCase(tx, d.review_case_id, true);
      if (!c) return failure('WAYVRO_E_NOT_FOUND');
      if (d.decided_by_staff_id === staff.staffId || !this.inScope(staff, 'kyc.decision.second_approve', c.city_code)) {
        await this.deny(tx, staff, c.id, d.decided_by_staff_id === staff.staffId ? 'MAKER_CHECKER' : 'CITY_SCOPE');
        return failure('WAYVRO_E_FORBIDDEN');
      }
      // recorded after the per-kind checks (a failure outcome commits) and before the approval takes effect
      const record = async (): Promise<void> => {
        await tx.query(
          `insert into compliance.review_second_approvals (review_decision_id, decided_by_staff_id, approver_staff_id, approver_session_id, outcome) values ($1, $2, $3, $4, $5)`,
          [decisionId, d.decided_by_staff_id, staff.staffId, staff.sessionId, outcome],
        );
      };
      const result =
        c.kind === 'DOCUMENT_RENEWAL'
          ? await this.secondApproveRenewal(tx, staff, c, outcome, record)
          : c.kind === 'ACCOUNT_RECOVERY'
            ? await this.secondApproveRecovery(tx, staff, c, outcome, record)
            : await this.secondApproveApplication(tx, staff, c, decisionId, outcome, record);
      if (result.kind === 'error') return result;
      if (outcome === 'REJECTED') {
        // the approval does not take effect: the case goes back to the queue for a fresh review
        await tx.query(
          `update compliance.review_cases set status = 'OPEN', assigned_staff_id = null, lease_expires_at = null, version = version + 1 where id = $1`,
          [c.id],
        );
      }
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'REVIEW_SECOND_APPROVAL_RECORDED',
        objectType: 'compliance.review_decision',
        objectId: decisionId,
        outcome: 'SUCCESS',
        reasonCode: outcome,
      });
      return success(200, {
        decisionId,
        caseStatus: outcome === 'APPROVED' ? 'DECIDED' : 'OPEN',
        applicationState: result.applicationState,
        pendingSecondApproval: false,
      });
    });
  }

  private async secondApproveApplication(
    tx: pg.PoolClient,
    staff: StaffPrincipal,
    c: CaseRow,
    decisionId: string,
    outcome: 'APPROVED' | 'REJECTED',
    record: () => Promise<void>,
  ): Promise<{ readonly kind: 'ok'; readonly applicationState: ApplicationState } | Refusal> {
    const app = (
      await tx.query<{
        id: string;
        account_id: string;
        state: ApplicationState;
        legal_name_envelope: Buffer | null;
        date_of_birth_envelope: Buffer | null;
        cnic_envelope: Buffer | null;
      }>(
        `select id, account_id, state, legal_name_envelope, date_of_birth_envelope, cnic_envelope from compliance.driver_applications where id = $1 for no key update`,
        [c.driver_application_id],
      )
    ).rows[0];
    if (!app || app.state !== 'MANUAL_REVIEW') return failure('WAYVRO_E_CONFLICT');
    if (staff.consumerAccountId !== null && staff.consumerAccountId === app.account_id) {
      await this.deny(tx, staff, c.id, 'CONFLICT_OF_INTEREST');
      return failure('WAYVRO_E_FORBIDDEN');
    }
    await record();
    if (outcome === 'REJECTED') return { kind: 'ok', applicationState: app.state };
    const open = await this.caseSignals(tx, c, app.id, true);
    const state = await this.finaliseApproval(tx, staff, c, app, decisionId, new Map(open.map((r) => [r.id, 'CLEARED' as const])));
    await emitEvent(tx, {
      type: 'driver.application.decided.v1',
      aggregateType: 'compliance.driver_application',
      aggregateId: app.id,
      accountId: app.account_id,
      payload: { decision: 'APPROVE', reasonCodes: ['ALL_CHECKS_CONFIRMED'] },
    });
    return { kind: 'ok', applicationState: state };
  }

  private async secondApproveRenewal(
    tx: pg.PoolClient,
    staff: StaffPrincipal,
    c: CaseRow,
    outcome: 'APPROVED' | 'REJECTED',
    record: () => Promise<void>,
  ): Promise<{ readonly kind: 'ok'; readonly applicationState: string } | Refusal> {
    const subject = await this.renewalSubject(tx, c);
    if (!subject || subject.status !== 'SUBMITTED') return failure('WAYVRO_E_CONFLICT');
    if (staff.consumerAccountId !== null && staff.consumerAccountId === subject.account_id) {
      await this.deny(tx, staff, c.id, 'CONFLICT_OF_INTEREST');
      return failure('WAYVRO_E_FORBIDDEN');
    }
    await record();
    if (outcome === 'APPROVED') {
      const open = await this.caseSignals(tx, c, subject.application_id, true);
      await this.finaliseRenewal(tx, staff, c, subject, new Map(open.map((r) => [r.id, 'CLEARED' as const])));
      await this.emitRenewalDecided(tx, subject, 'APPROVE', ['ALL_CHECKS_CONFIRMED']);
    }
    return { kind: 'ok', applicationState: subject.application_state };
  }

  /** The driver account behind an ACCOUNT_RECOVERY or REVERIFICATION case (profile locked). */
  private async accountSubject(tx: pg.PoolClient, c: CaseRow): Promise<AccountSubject | null> {
    const r = await tx.query<AccountSubject>(
      `select p.id profile_id, p.account_id, p.application_id, a.state application_state,
              (select pc.requested_by_account_id from identity.phone_change_requests pc where pc.id = $2) requested_by_account_id
         from compliance.driver_profiles p join compliance.driver_applications a on a.id = p.application_id
        where p.id = $1 for no key update of p`,
      [c.driver_profile_id, c.phone_change_request_id],
    );
    return r.rows[0] ?? null;
  }

  /**
   * ACCOUNT_RECOVERY (S12/K17; auth design §6.4): a credential moves only after an in-person identity check
   * (REQUIRE_IN_PERSON first — a fresh guided capture for recovery is not built; EG-10), an APPROVE by a reviewer and a
   * SECOND senior approver; the lost-phone move then waits a 72 h cooldown (worker). REJECT denies the recovery.
   * REVERIFICATION (founder Q-14): APPROVE lifts the temporary RISK_HOLD; REJECT adds an appealable DRIVER_ROLE
   * restriction (REVERIFICATION_FAILED). Neither kind touches the application or other cases; NEEDS_INFO does not apply.
   */
  private async decideDriverAccount(
    tx: pg.PoolClient,
    staff: StaffPrincipal,
    c: CaseRow,
    input: DecisionInput,
    evidence: EvidenceSummaryPort,
  ): Promise<Outcome> {
    const subject = await this.accountSubject(tx, c);
    if (!subject) return failure('WAYVRO_E_NOT_FOUND');
    if (staff.consumerAccountId !== null && (staff.consumerAccountId === subject.account_id || staff.consumerAccountId === subject.requested_by_account_id)) {
      await this.deny(tx, staff, c.id, 'CONFLICT_OF_INTEREST');
      return failure('WAYVRO_E_FORBIDDEN');
    }
    if (input.decision === 'NEEDS_INFO') return failure('WAYVRO_E_VALIDATION');
    const accepted = (await evidence.evidenceStates(subject.application_id)).filter((e) => e.status === 'ACCEPTED');
    const invalid = this.validate(input, new Set(accepted.map((e) => e.evidenceId)));
    if (invalid) return failure(invalid);
    if ((input.signalResolutions?.length ?? 0) > 0) return failure('WAYVRO_E_VALIDATION');
    const recovery = c.kind === 'ACCOUNT_RECOVERY';
    if (recovery && input.decision === 'APPROVE' && !c.in_person_required) return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['IN_PERSON_CHECK_REQUIRED'] });
    const requiresSecond = recovery && input.decision === 'APPROVE';
    const decisionId = await this.recordDecision(tx, staff, c.id, input, requiresSecond);
    let caseStatus: 'OPEN' | 'ESCALATED' | 'DECIDED' = 'DECIDED';
    switch (input.decision) {
      case 'ESCALATE':
      case 'REQUIRE_IN_PERSON':
        caseStatus = await this.requeue(tx, c.id, input.decision);
        break;
      case 'APPROVE':
        if (requiresSecond) caseStatus = await this.requeue(tx, c.id, 'AWAIT_SECOND_APPROVAL');
        else await this.liftRiskHolds(tx, staff, c, subject);
        break;
      default:
        if (recovery) await this.denyRecovery(tx, c, subject);
        else await this.failReverification(tx, staff, c, subject);
    }
    await this.auditDecision(tx, staff, c.id, input.decision);
    return success(201, { decisionId, caseStatus, applicationState: subject.application_state, pendingSecondApproval: requiresSecond });
  }

  private async liftRiskHolds(tx: pg.PoolClient, staff: StaffPrincipal, c: CaseRow, subject: AccountSubject): Promise<void> {
    const lifted = await tx.query<{ id: string }>(
      `update profile.restrictions set status = 'LIFTED', lifted_at = now(), lifted_by_staff_id = $2, lift_reason_code = 'REVERIFIED', version = version + 1
        where driver_profile_id = $1 and reason_class = 'RISK_HOLD' and status = 'ACTIVE' returning id`,
      [subject.profile_id, staff.staffId],
    );
    for (const r of lifted.rows) {
      await tx.query(
        `insert into profile.restriction_events (id, restriction_id, event, actor_staff_id, reason_code) values ($1, $2, 'LIFTED', $3, 'REVERIFIED')`,
        [uuidv7(), r.id, staff.staffId],
      );
      await emitEvent(tx, {
        type: 'restriction.changed.v1',
        aggregateType: 'profile.restriction',
        aggregateId: r.id,
        accountId: subject.account_id,
        payload: { status: 'LIFTED' },
      });
    }
    await this.closeCase(tx, c.id);
  }

  private async failReverification(tx: pg.PoolClient, staff: StaffPrincipal, c: CaseRow, subject: AccountSubject): Promise<void> {
    const id = uuidv7();
    await tx.query(
      `insert into profile.restrictions (id, scope, driver_profile_id, reason_code, reason_class, status, appealable, created_by_staff_id)
       values ($1, 'DRIVER_ROLE', $2, 'REVERIFICATION_FAILED', 'COMPLIANCE', 'ACTIVE', true, $3)`,
      [id, subject.profile_id, staff.staffId],
    );
    await tx.query(
      `insert into profile.restriction_events (id, restriction_id, event, actor_staff_id, reason_code) values ($1, $2, 'CREATED', $3, 'REVERIFICATION_FAILED')`,
      [uuidv7(), id, staff.staffId],
    );
    await emitEvent(tx, {
      type: 'restriction.changed.v1',
      aggregateType: 'profile.restriction',
      aggregateId: id,
      accountId: subject.account_id,
      payload: { status: 'ACTIVE' },
    });
    await this.closeCase(tx, c.id);
  }

  private async denyRecovery(tx: pg.PoolClient, c: CaseRow, subject: AccountSubject): Promise<void> {
    if (c.phone_change_request_id !== null) {
      await tx.query(
        `update identity.phone_change_requests set status = 'DENIED', updated_at = now(), version = version + 1 where id = $1 and status = 'MANUAL_REVIEW'`,
        [c.phone_change_request_id],
      );
    } else {
      await tx.query(
        `update identity.dormant_number_reviews set status = 'DENIED', resolved_at = now(), version = version + 1 where id = $1 and status = 'IN_REVIEW'`,
        [c.dormant_number_review_id],
      );
    }
    await securityEvent(tx, subject.account_id, 'RECOVERY_DENIED', null);
    await emitEvent(tx, {
      type: 'account.recovery.decided.v1',
      aggregateType: 'compliance.review_case',
      aggregateId: c.id,
      accountId: subject.account_id,
      payload: { decision: 'REJECT' },
    });
    await this.closeCase(tx, c.id);
  }

  /** Second senior approval of a recovery: the lost-phone move enters its cooldown; a dormant-number claim resolves. */
  private async secondApproveRecovery(
    tx: pg.PoolClient,
    staff: StaffPrincipal,
    c: CaseRow,
    outcome: 'APPROVED' | 'REJECTED',
    record: () => Promise<void>,
  ): Promise<{ readonly kind: 'ok'; readonly applicationState: string } | Refusal> {
    const subject = await this.accountSubject(tx, c);
    if (!subject) return failure('WAYVRO_E_CONFLICT');
    if (staff.consumerAccountId !== null && (staff.consumerAccountId === subject.account_id || staff.consumerAccountId === subject.requested_by_account_id)) {
      await this.deny(tx, staff, c.id, 'CONFLICT_OF_INTEREST');
      return failure('WAYVRO_E_FORBIDDEN');
    }
    await record();
    if (outcome === 'APPROVED') {
      if (c.phone_change_request_id !== null) {
        const moved = await tx.query(
          `update identity.phone_change_requests set status = 'COOLDOWN', cooldown_until = now() + ($2::int * interval '1 hour'), updated_at = now(), version = version + 1
            where id = $1 and status = 'MANUAL_REVIEW'`,
          [c.phone_change_request_id, RECOVERY_COOLDOWN_HOURS],
        );
        if (moved.rowCount !== 1) return failure('WAYVRO_E_CONFLICT');
        await securityEvent(tx, subject.account_id, 'RECOVERY_APPROVED_COOLDOWN', null);
      } else {
        const resolved = await tx.query(
          `update identity.dormant_number_reviews set status = 'RESOLVED_OWNER', resolved_at = now(), version = version + 1 where id = $1 and status = 'IN_REVIEW'`,
          [c.dormant_number_review_id],
        );
        if (resolved.rowCount !== 1) return failure('WAYVRO_E_CONFLICT');
        await securityEvent(tx, subject.account_id, 'RECOVERY_COMPLETED', null);
      }
      await emitEvent(tx, {
        type: 'account.recovery.decided.v1',
        aggregateType: 'compliance.review_case',
        aggregateId: c.id,
        accountId: subject.account_id,
        payload: { decision: 'APPROVE' },
      });
      await this.closeCase(tx, c.id);
    }
    return { kind: 'ok', applicationState: subject.application_state };
  }

  /**
   * MANUAL_REVIEW → VERIFIED: driver profile from the reviewer-confirmed claims, documents VALID (claimed dates become
   * confirmed values), affiliations ACTIVE, capabilities GRANTED by this decision, signals CLEARED, case DECIDED.
   */
  private async finaliseApproval(
    tx: pg.PoolClient,
    staff: StaffPrincipal,
    c: CaseRow,
    app: {
      id: string;
      account_id: string;
      state: ApplicationState;
      legal_name_envelope: Buffer | null;
      date_of_birth_envelope: Buffer | null;
      cnic_envelope: Buffer | null;
    },
    decisionId: string,
    resolutions: ReadonlyMap<string, 'CLEARED' | 'CONFIRMED_FRAUD'>,
  ): Promise<ApplicationState> {
    if (!canTransition(app.state, 'VERIFIED', 'REVIEWER') || !app.legal_name_envelope || !app.date_of_birth_envelope || !app.cnic_envelope) {
      throw new WayvroError('WAYVRO_E_CONFLICT');
    }
    const name = this.cipher.decryptString('identity_numbers', app.legal_name_envelope, fieldContext(ENCRYPTED_FIELDS.applicationLegalName, app.id));
    const dob = this.cipher.decryptString('identity_dates', app.date_of_birth_envelope, fieldContext(ENCRYPTED_FIELDS.applicationDob, app.id));
    const cnic = this.cipher.decryptString('identity_numbers', app.cnic_envelope, fieldContext(ENCRYPTED_FIELDS.applicationCnic, app.id));
    const profileId = uuidv7();
    const affiliations = await tx.query<{ vehicle_id: string; service_category: string }>(
      `update compliance.vehicle_affiliations va set status = 'ACTIVE' from compliance.vehicles v
        where va.vehicle_id = v.id and va.driver_application_id = $1 and va.status = 'PENDING' returning va.vehicle_id, v.service_category`,
      [app.id],
    );
    const categories = (
      await tx.query<{ service_category: string }>(`select service_category from compliance.application_service_categories where application_id = $1`, [app.id])
    ).rows.map((r) => r.service_category);
    const grants = affiliations.rows.filter((a) => categories.includes(a.service_category));
    await tx.query(
      `insert into compliance.driver_profiles (id, account_id, application_id, state, verified_legal_name_envelope, verified_date_of_birth_envelope)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        profileId,
        app.account_id,
        app.id,
        grants.length > 0 ? 'ACTIVE_ELIGIBLE' : 'VERIFIED',
        this.cipher.encrypt('identity_numbers', name, fieldContext(ENCRYPTED_FIELDS.profileLegalName, profileId)),
        this.cipher.encrypt('identity_dates', dob, fieldContext(ENCRYPTED_FIELDS.profileDob, profileId)),
      ],
    );
    // documents: claimed dates become confirmed values; the CNIC document carries the confirmed CNIC number
    const docs = await tx.query<{ id: string; document_type_code: string; number_envelope: Buffer | null }>(
      `select id, document_type_code, number_envelope from compliance.compliance_documents where driver_application_id = $1 and status in ('SUBMITTED', 'UNDER_REVIEW')`,
      [app.id],
    );
    for (const d of docs.rows) {
      const number =
        d.number_envelope === null && d.document_type_code === 'CNIC'
          ? this.cipher.encrypt('identity_numbers', cnic, fieldContext(ENCRYPTED_FIELDS.documentNumber, d.id))
          : null;
      await tx.query(
        `update compliance.compliance_documents set status = 'VALID', issued_on = claimed_issued_on, expires_on = claimed_expires_on,
                number_envelope = coalesce(number_envelope, $2), number_last4 = coalesce(number_last4, $3), version = version + 1 where id = $1`,
        [d.id, number, number === null ? null : cnic.replaceAll('-', '').slice(-4)],
      );
    }
    for (const g of grants) {
      await tx.query(
        `insert into compliance.service_capabilities (id, driver_profile_id, vehicle_id, city_code, service_category, status, granted_by_decision_id)
         values ($1, $2, $3, $4, $5, 'GRANTED', $6)`,
        [uuidv7(), profileId, g.vehicle_id, c.city_code, g.service_category, decisionId],
      );
    }
    for (const [signalId, outcome] of resolutions) {
      await tx.query(`update compliance.duplicate_signals set status = $2, resolved_at = now(), resolved_by_staff_id = $3 where id = $1 and status = 'OPEN'`, [
        signalId,
        outcome,
        staff.staffId,
      ]);
    }
    await tx.query(
      `update compliance.driver_applications set state = 'VERIFIED', decided_at = now(), version = version + 1, updated_at = now() where id = $1`,
      [app.id],
    );
    await tx.query(
      `update compliance.review_cases set status = 'DECIDED', decided_at = now(), assigned_staff_id = null, lease_expires_at = null, version = version + 1 where id = $1`,
      [c.id],
    );
    await emitEvent(tx, { type: 'driver.approved.v1', aggregateType: 'compliance.driver_profile', aggregateId: profileId, accountId: app.account_id });
    return 'VERIFIED';
  }
}
