/**
 * Staff compliance administration (P2.5): restrictions (V13), requirement sets (K06/R02–R06/R46) and age-policy data
 * entry (A15). Maker-checker everywhere the matrix requires it (service rule AND database CHECK); ABAC: city scope for
 * driver-side subjects, compliance-only reason classes for KYC senior reviewers, ACCOUNT scope only for T&S, and
 * no action on the staff member's own consumer account. Every action is audited; every restriction change is also an
 * append-only restriction event.
 */
import type { WayvroEnv } from '@wayvro/config';
import { WayvroError } from '@wayvro/observability';
import { appendAudit, sqlState, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import { failure, success, type IdempotencyStore, type IdempotentResult } from '../platform/idempotency.js';
import { COMPLIANCE_REASON_CLASSES } from '../staff/roles.js';
import { citiesFor, hasRole, type StaffPrincipal } from '../staff/staff-session.js';
import { toRestriction, type RestrictionRow } from './restrictions.js';

export interface ComplianceAdminPolicy {
  readonly WAYVRO_ENV: WayvroEnv;
  readonly IDEMPOTENCY_TTL_SECONDS: number;
}

export interface RestrictionInput {
  readonly scope: 'ACCOUNT' | 'DRIVER_ROLE' | 'VEHICLE' | 'SERVICE_CAPABILITY' | 'CITY_CATEGORY';
  readonly accountId?: string | undefined;
  readonly driverProfileId?: string | undefined;
  readonly vehicleId?: string | undefined;
  readonly serviceCapabilityId?: string | undefined;
  readonly cityCode?: string | undefined;
  readonly serviceCategory?: string | undefined;
  readonly reasonCode: string;
  readonly reasonClass: 'SAFETY' | 'FRAUD' | 'LEGAL' | 'COMPLIANCE' | 'QUALITY' | 'AGE_POLICY';
  readonly appealable: boolean;
  readonly effectiveUntil?: string | undefined;
}

const restrictionView = (r: RestrictionRow) => ({
  id: r.id,
  scope: r.scope,
  accountId: r.accountId,
  driverProfileId: r.driverProfileId,
  vehicleId: r.vehicleId,
  serviceCapabilityId: r.serviceCapabilityId,
  cityCode: r.cityCode,
  serviceCategory: r.serviceCategory,
  reasonCode: r.reasonCode,
  reasonClass: r.reasonClass,
  status: r.status,
  appealable: r.appealable,
  effectiveFrom: r.effectiveFrom.toISOString(),
  effectiveUntil: r.effectiveUntil?.toISOString() ?? null,
  createdByStaff: r.createdByStaff,
});

interface SetRow {
  id: string;
  city_code: string;
  service_category: string;
  version: number;
  status: string;
  is_placeholder: boolean;
  source_reference: string;
  effective_from: Date | null;
  drafted_by_staff_id: string | null;
  approved_by_staff_id: string | null;
}

interface AgeRow {
  version: number;
  status: string;
  rider_declaration_mode: string;
  rider_minimum_age: number | null;
  driver_minimum_age: number | null;
  approval_ref: string | null;
  effective_at: Date;
  drafted_by_staff_id: string | null;
  approved_by_staff_id: string | null;
}
const ageView = (a: AgeRow) => ({
  version: a.version,
  status: a.status,
  riderDeclarationMode: a.rider_declaration_mode,
  riderMinimumAge: a.rider_minimum_age,
  driverMinimumAge: a.driver_minimum_age,
  approvalRef: a.approval_ref,
  effectiveAt: a.effective_at.toISOString(),
  draftedByStaffId: a.drafted_by_staff_id,
  approvedByStaffId: a.approved_by_staff_id,
});

export class ComplianceAdminService {
  constructor(
    private readonly db: pg.Pool,
    private readonly idempotency: IdempotencyStore,
    private readonly policy: ComplianceAdminPolicy,
  ) {}

  private run(
    staff: StaffPrincipal,
    operation: string,
    key: string,
    payload: unknown,
    work: (tx: pg.PoolClient) => Promise<ReturnType<typeof success>>,
  ): Promise<IdempotentResult> {
    return this.idempotency.execute({ scope: `staff:${staff.staffId}`, operation, key, payload, ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS }, work);
  }

  private async deny(
    tx: Queryable,
    staff: StaffPrincipal,
    objectType: string,
    objectId: string | null,
    reasonCode: string,
  ): Promise<ReturnType<typeof failure>> {
    await appendAudit(tx, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: 'STAFF_ACCESS_DENIED',
      objectType,
      objectId: objectId ?? undefined,
      outcome: 'DENIED',
      reasonCode,
    });
    return failure('WAYVRO_E_FORBIDDEN');
  }

  /** Account and city of a restriction subject (404 when the subject does not exist). */
  private async subjectOf(tx: Queryable, input: RestrictionInput): Promise<{ accountId: string; cityCode: string | null } | null> {
    if (input.scope === 'ACCOUNT') {
      const r = await tx.query(`select 1 from identity.accounts where id = $1`, [input.accountId]);
      return r.rowCount === 1 && input.accountId ? { accountId: input.accountId, cityCode: null } : null;
    }
    if (input.scope === 'DRIVER_ROLE' || input.scope === 'CITY_CATEGORY') {
      const r = await tx.query<{ account_id: string; city_code: string }>(
        `select p.account_id, a.city_code from compliance.driver_profiles p join compliance.driver_applications a on a.id = p.application_id where p.id = $1`,
        [input.driverProfileId],
      );
      const row = r.rows[0];
      return row ? { accountId: row.account_id, cityCode: input.scope === 'CITY_CATEGORY' ? (input.cityCode ?? null) : row.city_code } : null;
    }
    if (input.scope === 'SERVICE_CAPABILITY') {
      const r = await tx.query<{ account_id: string; city_code: string }>(
        `select p.account_id, c.city_code from compliance.service_capabilities c join compliance.driver_profiles p on p.id = c.driver_profile_id where c.id = $1`,
        [input.serviceCapabilityId],
      );
      const row = r.rows[0];
      return row ? { accountId: row.account_id, cityCode: row.city_code } : null;
    }
    const r = await tx.query<{ account_id: string; city_code: string }>(
      `select coalesce(a.account_id, p.account_id) account_id, coalesce(a.city_code, pa.city_code) city_code
         from compliance.vehicle_affiliations va
         left join compliance.driver_applications a on a.id = va.driver_application_id
         left join compliance.driver_profiles p on p.id = va.driver_profile_id
         left join compliance.driver_applications pa on pa.id = p.application_id
        where va.vehicle_id = $1 order by va.created_at limit 1`,
      [input.vehicleId],
    );
    const row = r.rows[0];
    return row ? { accountId: row.account_id, cityCode: row.city_code } : null;
  }

  async createRestriction(staff: StaffPrincipal, input: RestrictionInput, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'restrictions.create', key, input, async (tx) => {
      if (input.scope === 'ACCOUNT' && !staff.permissions.has('restriction.create_account'))
        return this.deny(tx, staff, 'profile.restriction', null, 'ACCOUNT_SCOPE_NOT_PERMITTED');
      if (!hasRole(staff, 'TRUST_SAFETY_AGENT') && !COMPLIANCE_REASON_CLASSES.has(input.reasonClass))
        return this.deny(tx, staff, 'profile.restriction', null, 'REASON_CLASS_NOT_PERMITTED');
      const subject = await this.subjectOf(tx, input);
      if (!subject) return failure('WAYVRO_E_NOT_FOUND');
      if (staff.consumerAccountId !== null && subject.accountId === staff.consumerAccountId)
        return this.deny(tx, staff, 'profile.restriction', null, 'SELF_OR_CONFLICT');
      const cities = citiesFor(staff, 'restriction.create');
      if (cities !== null && subject.cityCode !== null && !cities.has(subject.cityCode))
        return this.deny(tx, staff, 'profile.restriction', null, 'OUT_OF_CITY_SCOPE');
      const id = uuidv7();
      await tx.query('savepoint restriction');
      try {
        await tx.query(
          `insert into profile.restrictions (id, scope, account_id, driver_profile_id, vehicle_id, service_capability_id, city_code, service_category, reason_code, reason_class,
                                             status, effective_until, appealable, created_by_staff_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', $11, $12, $13)`,
          [
            id,
            input.scope,
            input.accountId ?? null,
            input.driverProfileId ?? null,
            input.vehicleId ?? null,
            input.serviceCapabilityId ?? null,
            input.cityCode ?? null,
            input.serviceCategory ?? null,
            input.reasonCode,
            input.reasonClass,
            input.effectiveUntil ?? null,
            input.appealable,
            staff.staffId,
          ],
        );
      } catch (e) {
        if (sqlState(e) !== '23514' && sqlState(e) !== '23503') throw e;
        await tx.query('rollback to savepoint restriction');
        return failure('WAYVRO_E_VALIDATION');
      }
      await tx.query(`insert into profile.restriction_events (id, restriction_id, event, actor_staff_id, reason_code) values ($1, $2, 'CREATED', $3, $4)`, [
        uuidv7(),
        id,
        staff.staffId,
        input.reasonCode,
      ]);
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'RESTRICTION_CREATED',
        objectType: 'profile.restriction',
        objectId: id,
        outcome: 'SUCCESS',
        reasonCode: input.reasonCode,
      });
      return success(201, restrictionView(await this.loadRestriction(tx, id)));
    });
  }

  private async loadRestriction(q: Queryable, id: string): Promise<RestrictionRow> {
    const r = await q.query(`select * from profile.restrictions where id = $1`, [id]);
    const row = r.rows[0] as Parameters<typeof toRestriction>[0] | undefined;
    if (!row) throw new Error('restriction vanished');
    return toRestriction(row);
  }

  /** SAFETY/FRAUD lifts become LIFT_PENDING_APPROVAL (a different T&S agent approves); others lift immediately. */
  async liftRestriction(staff: StaffPrincipal, id: string, reasonCode: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'restrictions.lift', key, { id, reasonCode }, async (tx) => {
      const row = (
        await tx.query<{ status: string; reason_class: string; account_id: string | null }>(
          `select status, reason_class, account_id from profile.restrictions where id = $1 for update`,
          [id],
        )
      ).rows[0];
      if (!row) return failure('WAYVRO_E_NOT_FOUND');
      if (row.status !== 'ACTIVE') return failure('WAYVRO_E_CONFLICT');
      if (!hasRole(staff, 'TRUST_SAFETY_AGENT') && !COMPLIANCE_REASON_CLASSES.has(row.reason_class))
        return this.deny(tx, staff, 'profile.restriction', id, 'REASON_CLASS_NOT_PERMITTED');
      if (row.reason_class === 'SECURITY_HOLD' || row.reason_class === 'RISK_HOLD') return failure('WAYVRO_E_CONFLICT');
      const makerChecker = row.reason_class === 'SAFETY' || row.reason_class === 'FRAUD';
      if (makerChecker) {
        await tx.query(
          `update profile.restrictions set status = 'LIFT_PENDING_APPROVAL', lift_requested_by_staff_id = $2, lift_reason_code = null, version = version + 1 where id = $1`,
          [id, staff.staffId],
        );
        await tx.query(
          `insert into profile.restriction_events (id, restriction_id, event, actor_staff_id, reason_code) values ($1, $2, 'LIFT_REQUESTED', $3, $4)`,
          [uuidv7(), id, staff.staffId, reasonCode],
        );
      } else {
        await tx.query(
          `update profile.restrictions set status = 'LIFTED', lifted_by_staff_id = $2, lift_reason_code = $3, lifted_at = now(), version = version + 1 where id = $1`,
          [id, staff.staffId, reasonCode],
        );
        await tx.query(`insert into profile.restriction_events (id, restriction_id, event, actor_staff_id, reason_code) values ($1, $2, 'LIFTED', $3, $4)`, [
          uuidv7(),
          id,
          staff.staffId,
          reasonCode,
        ]);
      }
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: makerChecker ? 'RESTRICTION_LIFT_REQUESTED' : 'RESTRICTION_LIFTED',
        objectType: 'profile.restriction',
        objectId: id,
        outcome: 'SUCCESS',
        reasonCode,
      });
      return success(200, restrictionView(await this.loadRestriction(tx, id)));
    });
  }

  async decideLift(staff: StaffPrincipal, id: string, decision: 'APPROVE' | 'REJECT', key: string): Promise<IdempotentResult> {
    return this.run(staff, 'restrictions.decide-lift', key, { id, decision }, async (tx) => {
      const row = (
        await tx.query<{ status: string; lift_requested_by_staff_id: string | null; reason_code: string }>(
          `select status, lift_requested_by_staff_id, reason_code from profile.restrictions where id = $1 for update`,
          [id],
        )
      ).rows[0];
      if (!row) return failure('WAYVRO_E_NOT_FOUND');
      if (row.status !== 'LIFT_PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      if (!hasRole(staff, 'TRUST_SAFETY_AGENT') || row.lift_requested_by_staff_id === staff.staffId)
        return this.deny(tx, staff, 'profile.restriction', id, 'MAKER_IS_CHECKER');
      if (decision === 'APPROVE') {
        await tx.query(
          `update profile.restrictions set status = 'LIFTED', lifted_by_staff_id = $2, lift_reason_code = 'LIFT_APPROVED', lifted_at = now(), version = version + 1 where id = $1`,
          [id, staff.staffId],
        );
      } else {
        await tx.query(`update profile.restrictions set status = 'ACTIVE', lift_requested_by_staff_id = null, version = version + 1 where id = $1`, [id]);
      }
      await tx.query(`insert into profile.restriction_events (id, restriction_id, event, actor_staff_id, reason_code) values ($1, $2, $3, $4, $5)`, [
        uuidv7(),
        id,
        decision === 'APPROVE' ? 'LIFTED' : 'LIFT_REJECTED',
        staff.staffId,
        decision === 'APPROVE' ? 'LIFT_APPROVED' : 'LIFT_REJECTED',
      ]);
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: decision === 'APPROVE' ? 'RESTRICTION_LIFTED' : 'RESTRICTION_LIFT_REJECTED',
        objectType: 'profile.restriction',
        objectId: id,
        outcome: 'SUCCESS',
        reasonCode: row.reason_code,
      });
      return success(200, restrictionView(await this.loadRestriction(tx, id)));
    });
  }

  async listRestrictions(
    staff: StaffPrincipal,
    q: { accountId?: string | undefined; driverProfileId?: string | undefined; vehicleId?: string | undefined; cursor?: string | undefined },
  ): Promise<unknown> {
    // One subject at a time (no bulk listing; W07): exactly one filter is required.
    const filters = [q.accountId, q.driverProfileId, q.vehicleId].filter((f) => f !== undefined);
    if (filters.length !== 1) throw new WayvroError('WAYVRO_E_VALIDATION');
    const r = await this.db.query(
      `select * from profile.restrictions
        where ($1::uuid is null or account_id = $1) and ($2::uuid is null or driver_profile_id = $2) and ($3::uuid is null or vehicle_id = $3)
          and ($4::uuid is null or id > $4)
        order by id limit 51`,
      [q.accountId ?? null, q.driverProfileId ?? null, q.vehicleId ?? null, q.cursor ?? null],
    );
    const rows = (r.rows as Array<Parameters<typeof toRestriction>[0]>).map(toRestriction);
    await appendAudit(this.db, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: 'RESTRICTIONS_VIEWED',
      objectType: q.accountId ? 'identity.account' : q.driverProfileId ? 'compliance.driver_profile' : 'compliance.vehicle',
      objectId: q.accountId ?? q.driverProfileId ?? q.vehicleId,
      outcome: 'SUCCESS',
    });
    return { restrictions: rows.slice(0, 50).map(restrictionView), nextCursor: rows.length > 50 ? (rows[49]?.id ?? null) : null };
  }

  // ── requirement sets ──────────────────────────────────────────────────────────────────────────────────────────
  private async setView(q: Queryable, id: string): Promise<unknown> {
    const s = (await q.query<SetRow>(`select * from compliance.requirement_sets where id = $1`, [id])).rows[0];
    if (!s) return null;
    const items = await q.query<{
      document_type_code: string;
      mandatory: boolean;
      min_validity_days_at_submission: number;
      renewal_lead_days: number;
      applies_to_ownership_types: string[];
      licence_classes_allowed: string[];
    }>(`select * from compliance.requirement_set_items where requirement_set_id = $1 order by document_type_code`, [id]);
    return {
      ...this.setSummary(s),
      items: items.rows.map((i) => ({
        documentType: i.document_type_code,
        mandatory: i.mandatory,
        minValidityDaysAtSubmission: i.min_validity_days_at_submission,
        renewalLeadDays: i.renewal_lead_days,
        appliesToOwnershipTypes: i.applies_to_ownership_types,
        licenceClassesAllowed: i.licence_classes_allowed,
      })),
    };
  }

  private setSummary(s: SetRow) {
    return {
      id: s.id,
      cityCode: s.city_code,
      serviceCategory: s.service_category,
      version: s.version,
      status: s.status,
      isPlaceholder: s.is_placeholder,
      sourceReference: s.source_reference,
      effectiveFrom: s.effective_from?.toISOString() ?? null,
      draftedByStaffId: s.drafted_by_staff_id,
      approvedByStaffId: s.approved_by_staff_id,
    };
  }

  async listSets(): Promise<unknown> {
    const r = await this.db.query<SetRow>(`select * from compliance.requirement_sets order by city_code, service_category, version desc`);
    return { sets: r.rows.map((s) => this.setSummary(s)) };
  }

  async getSet(id: string): Promise<unknown> {
    return this.setView(this.db, id);
  }

  async draftSet(
    staff: StaffPrincipal,
    input: {
      cityCode: string;
      serviceCategory: string;
      sourceReference: string;
      items: ReadonlyArray<{
        documentType: string;
        mandatory: boolean;
        minValidityDaysAtSubmission: number;
        renewalLeadDays: number;
        appliesToOwnershipTypes: readonly string[];
        licenceClassesAllowed: readonly string[];
      }>;
    },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(staff, 'requirement-sets.draft', key, input, async (tx) => {
      if (new Set(input.items.map((i) => i.documentType)).size !== input.items.length) return failure('WAYVRO_E_VALIDATION');
      const id = uuidv7();
      await tx.query('savepoint draft_set');
      try {
        await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.requirement-set:' || $1 || ':' || $2))`, [input.cityCode, input.serviceCategory]);
        await tx.query(
          `insert into compliance.requirement_sets (id, city_code, service_category, version, status, is_placeholder, source_reference, drafted_by_staff_id)
           select $1, $2, $3, coalesce(max(version), 0) + 1, 'DRAFT', false, $4, $5 from compliance.requirement_sets where city_code = $2 and service_category = $3`,
          [id, input.cityCode, input.serviceCategory, input.sourceReference, staff.staffId],
        );
        for (const i of input.items) {
          await tx.query(
            `insert into compliance.requirement_set_items (requirement_set_id, document_type_code, mandatory, min_validity_days_at_submission, renewal_lead_days, applies_to_ownership_types, licence_classes_allowed)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [id, i.documentType, i.mandatory, i.minValidityDaysAtSubmission, i.renewalLeadDays, i.appliesToOwnershipTypes, i.licenceClassesAllowed],
          );
        }
      } catch (e) {
        if (sqlState(e) !== '23503') throw e;
        await tx.query('rollback to savepoint draft_set');
        return failure('WAYVRO_E_VALIDATION');
      }
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'REQUIREMENT_SET_DRAFTED',
        objectType: 'compliance.requirement_set',
        objectId: id,
        outcome: 'SUCCESS',
      });
      return success(201, await this.setView(tx, id));
    });
  }

  private async transitionSet(
    staff: StaffPrincipal,
    id: string,
    operation: string,
    key: string,
    payload: unknown,
    apply: (tx: pg.PoolClient, s: SetRow) => Promise<string | ReturnType<typeof failure>>,
  ): Promise<IdempotentResult> {
    return this.run(staff, operation, key, payload, async (tx) => {
      const s = (await tx.query<SetRow>(`select * from compliance.requirement_sets where id = $1 for update`, [id])).rows[0];
      if (!s) return failure('WAYVRO_E_NOT_FOUND');
      const outcome = await apply(tx, s);
      if (typeof outcome !== 'string') return outcome;
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: outcome,
        objectType: 'compliance.requirement_set',
        objectId: id,
        outcome: 'SUCCESS',
      });
      return success(200, await this.setView(tx, id));
    });
  }

  submitSet(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionSet(staff, id, 'requirement-sets.submit', key, { id }, async (tx, s) => {
      if (s.status !== 'DRAFT') return failure('WAYVRO_E_CONFLICT');
      await tx.query(`update compliance.requirement_sets set status = 'PENDING_APPROVAL', version_lock = version_lock + 1 where id = $1`, [id]);
      return 'REQUIREMENT_SET_SUBMITTED';
    });
  }

  decideSet(staff: StaffPrincipal, id: string, decision: 'APPROVE' | 'REJECT', key: string): Promise<IdempotentResult> {
    return this.transitionSet(staff, id, 'requirement-sets.decide', key, { id, decision }, async (tx, s) => {
      if (s.status !== 'PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      if (s.drafted_by_staff_id === staff.staffId) return this.deny(tx, staff, 'compliance.requirement_set', id, 'MAKER_IS_CHECKER');
      await tx.query(
        `update compliance.requirement_sets set status = $2, approved_by_staff_id = case when $2 = 'APPROVED' then $3::uuid else null end, version_lock = version_lock + 1 where id = $1`,
        [id, decision === 'APPROVE' ? 'APPROVED' : 'RETIRED', staff.staffId],
      );
      return decision === 'APPROVE' ? 'REQUIREMENT_SET_APPROVED' : 'REQUIREMENT_SET_REJECTED';
    });
  }

  /** APPROVED → ACTIVE (retiring the previous active set); production never activates a placeholder. */
  activateSet(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionSet(staff, id, 'requirement-sets.activate', key, { id }, async (tx, s) => {
      if (s.status !== 'APPROVED') return failure('WAYVRO_E_CONFLICT');
      if (s.is_placeholder && this.policy.WAYVRO_ENV === 'production') return failure('WAYVRO_E_CONFLICT');
      await tx.query(
        `update compliance.requirement_sets set status = 'RETIRED', effective_until = now(), version_lock = version_lock + 1 where city_code = $1 and service_category = $2 and status = 'ACTIVE'`,
        [s.city_code, s.service_category],
      );
      await tx.query(`update compliance.requirement_sets set status = 'ACTIVE', effective_from = now(), version_lock = version_lock + 1 where id = $1`, [id]);
      return 'REQUIREMENT_SET_ACTIVATED';
    });
  }

  // ── age-policy data entry (A15; values from counsel's decision, EG-23) ──────────────────────────────────────────
  async listAgePolicies(): Promise<unknown> {
    const r = await this.db.query<AgeRow>(`select * from legal.age_eligibility_policies order by version desc`);
    return { versions: r.rows.map(ageView) };
  }

  async draftAgePolicy(
    staff: StaffPrincipal,
    input: {
      riderDeclarationMode: string;
      riderMinimumAge: number | null;
      driverMinimumAge: number;
      guardianRulesRef: string | null;
      approvalRef: string;
      effectiveAt: string;
    },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(staff, 'age-policies.draft', key, input, async (tx) => {
      await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.age-policy'))`);
      const r = await tx.query<AgeRow>(
        `insert into legal.age_eligibility_policies (version, status, rider_declaration_mode, rider_minimum_age, driver_minimum_age, guardian_rules_ref, approval_ref, effective_at, drafted_by_staff_id)
         select coalesce(max(version), 0) + 1, 'PENDING_APPROVAL', $1, $2, $3, $4, $5, $6, $7 from legal.age_eligibility_policies
         returning *`,
        [
          input.riderDeclarationMode,
          input.riderMinimumAge,
          input.driverMinimumAge,
          input.guardianRulesRef,
          input.approvalRef,
          input.effectiveAt,
          staff.staffId,
        ],
      );
      const row = r.rows[0];
      if (!row) throw new Error('age policy insert returned no row');
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'AGE_POLICY_DRAFTED',
        objectType: 'legal.age_eligibility_policy',
        outcome: 'SUCCESS',
        reasonCode: `VERSION_${String(row.version)}`,
      });
      return success(201, ageView(row));
    });
  }

  async decideAgePolicy(staff: StaffPrincipal, version: number, decision: 'APPROVE' | 'REJECT', key: string): Promise<IdempotentResult> {
    return this.run(staff, 'age-policies.decide', key, { version, decision }, async (tx) => {
      const row = (await tx.query<AgeRow>(`select * from legal.age_eligibility_policies where version = $1 for update`, [version])).rows[0];
      if (!row) return failure('WAYVRO_E_NOT_FOUND');
      if (row.status !== 'PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      if (row.drafted_by_staff_id === staff.staffId) return this.deny(tx, staff, 'legal.age_eligibility_policy', null, 'MAKER_IS_CHECKER');
      const r = await tx.query<AgeRow>(
        decision === 'APPROVE'
          ? `update legal.age_eligibility_policies set status = 'APPROVED', approved_by_staff_id = $2 where version = $1 returning *`
          : `update legal.age_eligibility_policies set status = 'RETIRED', retired_at = now() where version = $1 and $2::uuid is not null returning *`,
        [version, staff.staffId],
      );
      const updated = r.rows[0];
      if (!updated) throw new Error('age policy update returned no row');
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: decision === 'APPROVE' ? 'AGE_POLICY_APPROVED' : 'AGE_POLICY_REJECTED',
        objectType: 'legal.age_eligibility_policy',
        outcome: 'SUCCESS',
        reasonCode: `VERSION_${String(version)}`,
      });
      return success(200, ageView(updated));
    });
  }
}
