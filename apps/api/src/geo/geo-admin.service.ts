/**
 * Staff geo administration (Phase 3 P3.2; I11 cost controls, A06 aliases; docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md
 * §6.2). Maker-checker in the service AND the database (CHECKs + guard triggers of migration 0011):
 *  - provider budgets: DRAFT → PENDING_APPROVAL → APPROVED (a different staff member) | REJECTED → ACTIVE (previous
 *    ACTIVE retired in the same transaction) → RETIRED. The change kind is computed here against the ACTIVE budget; a
 *    DECREASE (the safe direction) may be approved by its drafter with step-up — the database proves the decrease at
 *    draft time and the service re-checks it against the then-ACTIVE budget at activation.
 *  - landmark aliases: PROPOSED → ACTIVE (approver ≠ creator) | RETIRED; ACTIVE → RETIRED.
 * Every mutation is idempotent (Idempotency-Key, staff scope) and audited (ids and codes only).
 */
import { WayvroError } from '@wayvro/observability';
import { appendAudit, sqlState, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type { GeoBudgetDraftRequest } from '@wayvro/contracts';
import type pg from 'pg';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Refusal } from '../platform/idempotency.js';
import type { StaffPrincipal } from '../staff/staff-session.js';
import type { GeoBudgetGuard } from './budgets.js';
import { codePointLength, normaliseQuery } from './normalise.js';
import type { GeoReference } from './reference.js';

interface BudgetRow {
  id: string;
  provider_key: string;
  sku: string;
  version: number;
  status: string;
  daily_calls: number;
  monthly_calls: number;
  monthly_cost_micro_usd: string;
  alert_thresholds_pct: number[];
  change_kind: string;
  drafted_by_staff_id: string;
  approved_by_staff_id: string | null;
  effective_from: Date | null;
  effective_until: Date | null;
  created_at: Date;
}

interface AliasRow {
  id: string;
  city_code: string;
  locale: string;
  alias_normalised: string;
  alias_display: string;
  canonical_query: string;
  source: string;
  status: string;
  created_by_staff_id: string;
  approved_by_staff_id: string | null;
  created_at: Date;
}

const budgetView = (b: BudgetRow) => ({
  id: b.id,
  providerKey: b.provider_key,
  sku: b.sku,
  version: b.version,
  status: b.status,
  dailyCalls: b.daily_calls,
  monthlyCalls: b.monthly_calls,
  monthlyCostMicroUsd: Number(b.monthly_cost_micro_usd),
  alertThresholdsPct: b.alert_thresholds_pct,
  changeKind: b.change_kind,
  draftedByStaffId: b.drafted_by_staff_id,
  approvedByStaffId: b.approved_by_staff_id,
  effectiveFrom: b.effective_from?.toISOString() ?? null,
  effectiveUntil: b.effective_until?.toISOString() ?? null,
  createdAt: b.created_at.toISOString(),
});

const aliasView = (a: AliasRow) => ({
  id: a.id,
  cityCode: a.city_code,
  locale: a.locale,
  aliasDisplay: a.alias_display,
  aliasNormalised: a.alias_normalised,
  canonicalQuery: a.canonical_query,
  source: a.source,
  status: a.status,
  createdByStaffId: a.created_by_staff_id,
  approvedByStaffId: a.approved_by_staff_id,
  createdAt: a.created_at.toISOString(),
});

/** Lower-or-equal on every limit and strictly lower on at least one = the safe direction. */
function isDecrease(next: { dailyCalls: number; monthlyCalls: number; monthlyCostMicroUsd: number }, active: BudgetRow): boolean {
  const cost = Number(active.monthly_cost_micro_usd);
  const notHigher = next.dailyCalls <= active.daily_calls && next.monthlyCalls <= active.monthly_calls && next.monthlyCostMicroUsd <= cost;
  const lower = next.dailyCalls < active.daily_calls || next.monthlyCalls < active.monthly_calls || next.monthlyCostMicroUsd < cost;
  return notHigher && lower;
}

const MAX_USAGE_RANGE_MS = 31 * 86_400_000;

export class GeoAdminService {
  constructor(
    private readonly db: pg.Pool,
    private readonly idempotency: IdempotencyStore,
    private readonly ttlSeconds: number,
    private readonly budgets: GeoBudgetGuard,
    private readonly reference: GeoReference,
  ) {}

  private run(
    staff: StaffPrincipal,
    operation: string,
    key: string,
    payload: unknown,
    work: (tx: pg.PoolClient) => Promise<ReturnType<typeof success> | Refusal>,
  ): Promise<IdempotentResult> {
    return this.idempotency.execute({ scope: `staff:${staff.staffId}`, operation, key, payload, ttlSeconds: this.ttlSeconds }, work);
  }

  private async deny(tx: Queryable, staff: StaffPrincipal, objectType: string, objectId: string, reasonCode: string): Promise<Refusal> {
    await appendAudit(tx, { actor: { type: 'STAFF', id: staff.staffId }, action: 'STAFF_ACCESS_DENIED', objectType, objectId, outcome: 'DENIED', reasonCode });
    return failure('WAYVRO_E_FORBIDDEN');
  }

  private async audit(tx: Queryable, staff: StaffPrincipal, action: string, objectType: string, objectId: string, reasonCode?: string): Promise<void> {
    await appendAudit(tx, {
      actor: { type: 'STAFF', id: staff.staffId },
      action,
      objectType,
      objectId,
      outcome: 'SUCCESS',
      ...(reasonCode ? { reasonCode } : {}),
    });
  }

  // ── provider budgets ──────────────────────────────────────────────────────────────────────────────────────────

  async listBudgets(q: { providerKey?: string | undefined; sku?: string | undefined }): Promise<unknown> {
    const r = await this.db.query<BudgetRow>(
      `select * from geo.provider_budgets where ($1::text is null or provider_key = $1) and ($2::text is null or sku = $2)
        order by provider_key, sku, version desc limit 500`,
      [q.providerKey ?? null, q.sku ?? null],
    );
    return { budgets: r.rows.map(budgetView) };
  }

  draftBudget(staff: StaffPrincipal, input: GeoBudgetDraftRequest, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'geo-budgets.draft', key, input, async (tx) => {
      await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.geo-budget:' || $1 || ':' || $2))`, [input.providerKey, input.sku]);
      const active = (
        await tx.query<BudgetRow>(`select * from geo.provider_budgets where provider_key = $1 and sku = $2 and status = 'ACTIVE' for update`, [
          input.providerKey,
          input.sku,
        ])
      ).rows[0];
      const kind = !active ? 'INITIAL' : isDecrease(input, active) ? 'DECREASE' : 'INCREASE';
      const id = uuidv7();
      await tx.query(
        `insert into geo.provider_budgets (id, provider_key, sku, version, status, daily_calls, monthly_calls, monthly_cost_micro_usd, alert_thresholds_pct, change_kind, drafted_by_staff_id)
         select $1, $2, $3, coalesce(max(version), 0) + 1, 'DRAFT', $4, $5, $6, $7, $8, $9 from geo.provider_budgets where provider_key = $2 and sku = $3`,
        [
          id,
          input.providerKey,
          input.sku,
          input.dailyCalls,
          input.monthlyCalls,
          input.monthlyCostMicroUsd,
          [...new Set(input.alertThresholdsPct ?? [50, 80, 100])].sort((a, b) => a - b),
          kind,
          staff.staffId,
        ],
      );
      await this.audit(tx, staff, 'GEO_BUDGET_DRAFTED', 'geo.provider_budget', id, kind);
      return success(201, budgetView(await this.loadBudget(tx, id)));
    });
  }

  private async loadBudget(q: Queryable, id: string): Promise<BudgetRow> {
    const row = (await q.query<BudgetRow>(`select * from geo.provider_budgets where id = $1`, [id])).rows[0];
    if (!row) throw new Error('geo budget vanished');
    return row;
  }

  private transitionBudget(
    staff: StaffPrincipal,
    id: string,
    operation: string,
    key: string,
    payload: unknown,
    apply: (tx: pg.PoolClient, b: BudgetRow) => Promise<{ action: string; reasonCode?: string } | Refusal>,
  ): Promise<IdempotentResult> {
    return this.run(staff, operation, key, payload, async (tx) => {
      const b = (await tx.query<BudgetRow>(`select * from geo.provider_budgets where id = $1 for update`, [id])).rows[0];
      if (!b) return failure('WAYVRO_E_NOT_FOUND');
      const outcome = await apply(tx, b);
      if ('kind' in outcome) return outcome;
      await this.audit(tx, staff, outcome.action, 'geo.provider_budget', id, outcome.reasonCode);
      return success(200, budgetView(await this.loadBudget(tx, id)));
    });
  }

  submitBudget(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionBudget(staff, id, 'geo-budgets.submit', key, { id }, async (tx, b) => {
      if (b.status !== 'DRAFT') return failure('WAYVRO_E_CONFLICT');
      // only the drafter submits their own draft (a colleague approves it afterwards)
      if (b.drafted_by_staff_id !== staff.staffId) return this.deny(tx, staff, 'geo.provider_budget', id, 'NOT_THE_DRAFTER');
      await tx.query(`update geo.provider_budgets set status = 'PENDING_APPROVAL', version_lock = version_lock + 1 where id = $1`, [id]);
      return { action: 'GEO_BUDGET_SUBMITTED' };
    });
  }

  decideBudget(staff: StaffPrincipal, id: string, decision: 'APPROVE' | 'REJECT', key: string): Promise<IdempotentResult> {
    return this.transitionBudget(staff, id, 'geo-budgets.decide', key, { id, decision }, async (tx, b) => {
      if (b.status !== 'PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      const selfApproval = b.drafted_by_staff_id === staff.staffId;
      // the drafter never decides their own request (Phase-2 maker-checker template); the only exception is APPROVING a
      // DECREASE — the safe direction, still behind a fresh step-up
      if (selfApproval && decision === 'REJECT') return this.deny(tx, staff, 'geo.provider_budget', id, 'MAKER_IS_CHECKER');
      if (decision === 'REJECT') {
        await tx.query(`update geo.provider_budgets set status = 'REJECTED', version_lock = version_lock + 1 where id = $1`, [id]);
        return { action: 'GEO_BUDGET_REJECTED' };
      }
      // maker-checker, except the safe direction (route policy already demanded a fresh step-up)
      if (selfApproval && b.change_kind !== 'DECREASE') return this.deny(tx, staff, 'geo.provider_budget', id, 'MAKER_IS_CHECKER');
      await tx.query(`update geo.provider_budgets set status = 'APPROVED', approved_by_staff_id = $2, version_lock = version_lock + 1 where id = $1`, [
        id,
        staff.staffId,
      ]);
      return { action: 'GEO_BUDGET_APPROVED', ...(selfApproval ? { reasonCode: 'SINGLE_STAFF_DECREASE' } : {}) };
    });
  }

  activateBudget(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionBudget(staff, id, 'geo-budgets.activate', key, { id }, async (tx, b) => {
      if (b.status !== 'APPROVED') return failure('WAYVRO_E_CONFLICT');
      await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.geo-budget:' || $1 || ':' || $2))`, [b.provider_key, b.sku]);
      const active = (
        await tx.query<BudgetRow>(`select * from geo.provider_budgets where provider_key = $1 and sku = $2 and status = 'ACTIVE' for update`, [
          b.provider_key,
          b.sku,
        ])
      ).rows[0];
      // a single-staff DECREASE must still lower the budget in force now (another version may have been activated since)
      const requested = { dailyCalls: b.daily_calls, monthlyCalls: b.monthly_calls, monthlyCostMicroUsd: Number(b.monthly_cost_micro_usd) };
      if (b.change_kind === 'DECREASE' && b.approved_by_staff_id === b.drafted_by_staff_id && (!active || !isDecrease(requested, active))) {
        return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['DECREASE_NO_LONGER_LOWER'] });
      }
      if (active) {
        await tx.query(`update geo.provider_budgets set status = 'RETIRED', effective_until = now(), version_lock = version_lock + 1 where id = $1`, [
          active.id,
        ]);
      }
      await tx.query(`update geo.provider_budgets set status = 'ACTIVE', effective_from = now(), version_lock = version_lock + 1 where id = $1`, [id]);
      this.budgets.invalidate();
      return { action: 'GEO_BUDGET_ACTIVATED' };
    });
  }

  retireBudget(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionBudget(staff, id, 'geo-budgets.retire', key, { id }, async (tx, b) => {
      if (b.status !== 'APPROVED' && b.status !== 'ACTIVE') return failure('WAYVRO_E_CONFLICT');
      await tx.query(`update geo.provider_budgets set status = 'RETIRED', effective_until = now(), version_lock = version_lock + 1 where id = $1`, [id]);
      this.budgets.invalidate();
      return { action: 'GEO_BUDGET_RETIRED' };
    });
  }

  // ── usage ──────────────────────────────────────────────────────────────────────────────────────────────────────

  async usage(q: { from: string; to: string; providerKey?: string | undefined; sku?: string | undefined }): Promise<unknown> {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (!(to.getTime() > from.getTime()) || to.getTime() - from.getTime() > MAX_USAGE_RANGE_MS) {
      throw new WayvroError('WAYVRO_E_VALIDATION', { details: { reasonCodes: ['USAGE_RANGE_INVALID'] } });
    }
    const r = await this.db.query<{
      provider_key: string;
      sku: string;
      hour_bucket: Date;
      calls: string;
      cache_hits: string;
      errors: string;
      timeouts: string;
      budget_refusals: string;
      est_cost_micro_usd: string;
    }>(
      `select provider_key, sku, hour_bucket, calls, cache_hits, errors, timeouts, budget_refusals, est_cost_micro_usd from geo.provider_usage
        where hour_bucket >= $1 and hour_bucket < $2 and ($3::text is null or provider_key = $3) and ($4::text is null or sku = $4)
        order by hour_bucket, provider_key, sku limit 5000`,
      [from, to, q.providerKey ?? null, q.sku ?? null],
    );
    return {
      hours: r.rows.map((u) => ({
        providerKey: u.provider_key,
        sku: u.sku,
        hourBucket: u.hour_bucket.toISOString(),
        calls: Number(u.calls),
        cacheHits: Number(u.cache_hits),
        errors: Number(u.errors),
        timeouts: Number(u.timeouts),
        budgetRefusals: Number(u.budget_refusals),
        estCostMicroUsd: Number(u.est_cost_micro_usd),
      })),
    };
  }

  // ── landmark aliases ─────────────────────────────────────────────────────────────────────────────────────────

  async listAliases(q: { cityCode?: string | undefined; status?: string | undefined }): Promise<unknown> {
    const r = await this.db.query<AliasRow>(
      `select * from geo.landmark_aliases where ($1::text is null or city_code = $1) and ($2::text is null or status = $2) order by city_code, locale, alias_normalised, id limit 1000`,
      [q.cityCode ?? null, q.status ?? null],
    );
    return { aliases: r.rows.map(aliasView) };
  }

  draftAlias(
    staff: StaffPrincipal,
    input: { cityCode: string; locale: string; alias: string; canonicalQuery: string; source: 'FOUNDER' | 'FIELD' },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(staff, 'geo-aliases.draft', key, input, async (tx) => {
      const normalised = normaliseQuery(input.alias);
      const canonical = normaliseQuery(input.canonicalQuery);
      if (codePointLength(normalised) < 2 || codePointLength(canonical) < 2 || normalised === canonical) return failure('WAYVRO_E_VALIDATION');
      const id = uuidv7();
      await tx.query('savepoint draft_alias');
      try {
        await tx.query(
          `insert into geo.landmark_aliases (id, city_code, locale, alias_normalised, alias_display, canonical_query, source, status, created_by_staff_id)
           values ($1, $2, $3, $4, $5, $6, $7, 'PROPOSED', $8)`,
          [id, input.cityCode, input.locale, normalised, input.alias.trim(), canonical, input.source, staff.staffId],
        );
      } catch (e) {
        if (sqlState(e) !== '23503' && sqlState(e) !== '23514') throw e;
        await tx.query('rollback to savepoint draft_alias');
        return failure('WAYVRO_E_VALIDATION');
      }
      await this.audit(tx, staff, 'GEO_ALIAS_PROPOSED', 'geo.landmark_alias', id);
      return success(201, aliasView(await this.loadAlias(tx, id)));
    });
  }

  private async loadAlias(q: Queryable, id: string): Promise<AliasRow> {
    const row = (await q.query<AliasRow>(`select * from geo.landmark_aliases where id = $1`, [id])).rows[0];
    if (!row) throw new Error('alias vanished');
    return row;
  }

  decideAlias(staff: StaffPrincipal, id: string, decision: 'APPROVE' | 'REJECT', key: string): Promise<IdempotentResult> {
    return this.run(staff, 'geo-aliases.decide', key, { id, decision }, async (tx) => {
      const a = (await tx.query<AliasRow>(`select * from geo.landmark_aliases where id = $1 for update`, [id])).rows[0];
      if (!a) return failure('WAYVRO_E_NOT_FOUND');
      if (a.status !== 'PROPOSED') return failure('WAYVRO_E_CONFLICT');
      // the creator never decides their own alias (approve or reject)
      if (a.created_by_staff_id === staff.staffId) return this.deny(tx, staff, 'geo.landmark_alias', id, 'MAKER_IS_CHECKER');
      if (decision === 'REJECT') {
        await tx.query(`update geo.landmark_aliases set status = 'RETIRED' where id = $1`, [id]);
        await this.audit(tx, staff, 'GEO_ALIAS_REJECTED', 'geo.landmark_alias', id);
        return success(200, aliasView(await this.loadAlias(tx, id)));
      }
      await tx.query('savepoint approve_alias');
      try {
        await tx.query(`update geo.landmark_aliases set status = 'ACTIVE', approved_by_staff_id = $2 where id = $1`, [id, staff.staffId]);
      } catch (e) {
        if (sqlState(e) !== '23505') throw e;
        await tx.query('rollback to savepoint approve_alias');
        return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['ALIAS_ALREADY_ACTIVE'] });
      }
      await this.audit(tx, staff, 'GEO_ALIAS_APPROVED', 'geo.landmark_alias', id);
      this.reference.invalidateAliases();
      return success(200, aliasView(await this.loadAlias(tx, id)));
    });
  }

  retireAlias(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'geo-aliases.retire', key, { id }, async (tx) => {
      const a = (await tx.query<AliasRow>(`select * from geo.landmark_aliases where id = $1 for update`, [id])).rows[0];
      if (!a) return failure('WAYVRO_E_NOT_FOUND');
      if (a.status === 'RETIRED') return failure('WAYVRO_E_CONFLICT');
      await tx.query(`update geo.landmark_aliases set status = 'RETIRED' where id = $1`, [id]);
      await this.audit(tx, staff, 'GEO_ALIAS_RETIRED', 'geo.landmark_alias', id);
      this.reference.invalidateAliases();
      return success(200, aliasView(await this.loadAlias(tx, id)));
    });
  }
}
