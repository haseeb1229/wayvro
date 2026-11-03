/**
 * Staff pricing administration (P3.3; H06/E05/B06; docs/phase3/PHASE3_PRICING_QUOTE_MODEL.md §9–§11; threat model T3-23,
 * T3-31, T3-33). Maker-checker on every configuration change — enforced by this service AND by the database (CHECK
 * approver ≠ drafter, guard triggers for immutability, DRAFT-only component values, APPROVED tax policy at submission,
 * no back-dating):
 *
 *  - tax policies: draft (complete) → submit (drafter) → approve/reject by a DIFFERENT pricing manager (step-up) →
 *    retire (refused while an ACTIVE card references the policy);
 *  - rate cards: draft (or clone) → edit values while DRAFT (drafter) → submit (drafter; APPROVED tax policy; the
 *    default synthetic preview is recorded on the card; values outside the sanity envelope need an explicit override
 *    reason) → approve (DIFFERENT pricing manager, approval reason, step-up) / reject → activate now (previous ACTIVE →
 *    RETIRED in the same transaction; outbox pricing.rate-card.activated.v1) or schedule (the worker activates it,
 *    re-checking every rule); production refuses synthetic cards and placeholder tax policies;
 *  - rollback = a NEW version cloned from an earlier APPROVED/RETIRED card, submitted for the full maker-checker path;
 *  - previews: numeric benchmark tuples priced by the pure engine (no provider call, no quote row; audited);
 *  - support quote lookup: reason-gated, district codes and amounts only (never coordinates or a polyline), audited.
 *
 * Break-glass grants no pricing permission and is never a shortcut: the maker-checker rules hold for every principal.
 * Activation is serialised per (city, product) with the advisory lock shared with the worker's scheduled activation.
 */
import { isNonProductionLike, rateCardActivationLockKey, type WayvroEnv } from '@wayvro/config';
import type { RateCardValuesSchema, TaxPolicyDraftRequestSchema } from '@wayvro/contracts';
import type { Logger } from '@wayvro/observability';
import { appendAudit, sqlState, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { z } from 'zod';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome, type Refusal } from '../platform/idempotency.js';
import { emitEvent } from '../platform/outbox.js';
import { citiesFor, type StaffPrincipal } from '../staff/staff-session.js';
import type { StaffPermission } from '../staff/roles.js';
import { DEFAULT_BENCHMARK_TUPLES, previewCards, type BenchmarkTuple, type PreviewCard } from './preview.js';
import { cardsById, type StoredCard } from './rate-card-store.js';

export interface PricingAdminPolicy {
  readonly WAYVRO_ENV: WayvroEnv;
  readonly IDEMPOTENCY_TTL_SECONDS: number;
  readonly PRICING_ENVELOPE_MAX_CHANGE_PERCENT: number;
}

type TaxDraft = z.infer<typeof TaxPolicyDraftRequestSchema>;
type CardValuesInput = z.infer<typeof RateCardValuesSchema>;
export type RateCardActivation = { readonly when: 'NOW' } | { readonly when: 'SCHEDULED'; readonly effectiveFrom: string };
type Work = (tx: pg.PoolClient) => Promise<Outcome>;

const TAX_OBJECT = 'pricing.tax_policy';
const CARD_OBJECT = 'pricing.rate_card';
const QUOTE_OBJECT = 'pricing.quote_group';

/**
 * Sanity envelope (T3-23, PROPOSED placeholder bounds in PKR minor units — not prices, not FA-15 values): a submitted
 * amount outside [min, max] or more than PRICING_ENVELOPE_MAX_CHANGE_PERCENT away from the ACTIVE card needs an
 * explicit override reason code that the approver sees.
 */
type EnvelopeField = 'baseMinor' | 'perKmMinor' | 'perMinMinor' | 'minimumFareMinor' | 'bookingFeeMinor' | 'airportPickupFeeMinor';
const ENVELOPE: ReadonlyArray<{ readonly field: EnvelopeField; readonly code: string; readonly max: bigint }> = [
  { field: 'baseMinor', code: 'BASE', max: 100_000n },
  { field: 'perKmMinor', code: 'PER_KM', max: 50_000n },
  { field: 'perMinMinor', code: 'PER_MIN', max: 10_000n },
  { field: 'minimumFareMinor', code: 'MINIMUM_FARE', max: 500_000n },
  { field: 'bookingFeeMinor', code: 'BOOKING_FEE', max: 50_000n },
  { field: 'airportPickupFeeMinor', code: 'AIRPORT_FEE', max: 100_000n },
];

interface TaxRow {
  id: string;
  code: string;
  version: number;
  status: string;
  jurisdiction_code: string;
  rate_bp: number;
  applies_to: string[];
  inclusive: boolean;
  rounding_mode: string;
  is_placeholder: boolean;
  legal_reference: string | null;
  drafted_by_staff_id: string | null;
  approved_by_staff_id: string | null;
  created_at: Date;
  active_cards: number;
}
const TAX_SELECT = `select t.*, (select count(*)::int from pricing.rate_card_components c join pricing.rate_cards r on r.id = c.rate_card_id
                                  where c.tax_policy_id = t.id and r.status = 'ACTIVE') active_cards
  from pricing.tax_policies t`;
const taxView = (t: TaxRow) => ({
  id: t.id,
  code: t.code,
  version: t.version,
  status: t.status,
  jurisdictionCode: t.jurisdiction_code,
  rateBp: t.rate_bp,
  appliesTo: t.applies_to,
  inclusive: t.inclusive,
  roundingMode: t.rounding_mode,
  isPlaceholder: t.is_placeholder,
  legalReference: t.legal_reference,
  draftedByStaffId: t.drafted_by_staff_id,
  approvedByStaffId: t.approved_by_staff_id,
  createdAt: t.created_at.toISOString(),
  activeCardCount: t.active_cards,
});

interface CardRow {
  id: string;
  city_code: string;
  product_code: string;
  version: number;
  status: string;
  is_synthetic: boolean;
  source_reference: string;
  effective_from: Date | null;
  effective_until: Date | null;
  scheduled: boolean;
  drafted_by_staff_id: string | null;
  approved_by_staff_id: string | null;
  approval_reason_code: string | null;
  envelope_override_reason_code: string | null;
  supersedes_id: string | null;
  created_at: Date;
  submission_preview: unknown;
  base_minor: string | null;
  per_km_minor: string | null;
  per_min_minor: string | null;
  minimum_fare_minor: string | null;
  booking_fee_minor: string | null;
  airport_pickup_fee_minor: string | null;
  rounding_step_minor: string | null;
  rounding_mode: string | null;
  toll_policy: string | null;
  tax_policy_id: string | null;
  quote_ttl_seconds: number | null;
  max_distance_m: number | null;
  max_duration_s: number | null;
}
const CARD_SELECT = `select r.id, r.city_code, r.product_code, r.version, r.status, r.is_synthetic, r.source_reference, r.effective_from, r.effective_until,
       r.scheduled, r.drafted_by_staff_id, r.approved_by_staff_id, r.approval_reason_code, r.envelope_override_reason_code, r.supersedes_id, r.created_at,
       r.submission_preview, c.base_minor::text, c.per_km_minor::text, c.per_min_minor::text, c.minimum_fare_minor::text, c.booking_fee_minor::text,
       c.airport_pickup_fee_minor::text, c.rounding_step_minor::text, c.rounding_mode, c.toll_policy, c.tax_policy_id, c.quote_ttl_seconds, c.max_distance_m,
       c.max_duration_s
  from pricing.rate_cards r left join pricing.rate_card_components c on c.rate_card_id = r.id`;

type CardValuesView = {
  baseMinor: string;
  perKmMinor: string;
  perMinMinor: string;
  minimumFareMinor: string;
  bookingFeeMinor: string;
  airportPickupFeeMinor: string;
  roundingStepMinor: string;
  roundingMode: string;
  tollPolicy: string;
  taxPolicyId: string;
  quoteTtlSeconds: number;
  maxDistanceM: number;
  maxDurationS: number;
};
function valuesOf(r: CardRow): CardValuesView | null {
  if (
    r.base_minor === null ||
    r.per_km_minor === null ||
    r.per_min_minor === null ||
    r.minimum_fare_minor === null ||
    r.booking_fee_minor === null ||
    r.airport_pickup_fee_minor === null ||
    r.rounding_step_minor === null ||
    r.rounding_mode === null ||
    r.toll_policy === null ||
    r.tax_policy_id === null ||
    r.quote_ttl_seconds === null ||
    r.max_distance_m === null ||
    r.max_duration_s === null
  ) {
    return null;
  }
  return {
    baseMinor: r.base_minor,
    perKmMinor: r.per_km_minor,
    perMinMinor: r.per_min_minor,
    minimumFareMinor: r.minimum_fare_minor,
    bookingFeeMinor: r.booking_fee_minor,
    airportPickupFeeMinor: r.airport_pickup_fee_minor,
    roundingStepMinor: r.rounding_step_minor,
    roundingMode: r.rounding_mode,
    tollPolicy: r.toll_policy,
    taxPolicyId: r.tax_policy_id,
    quoteTtlSeconds: r.quote_ttl_seconds,
    maxDistanceM: r.max_distance_m,
    maxDurationS: r.max_duration_s,
  };
}
const iso = (d: Date | null): string | null => d?.toISOString() ?? null;
const cardSummary = (r: CardRow) => ({
  id: r.id,
  cityCode: r.city_code,
  productCode: r.product_code,
  version: r.version,
  status: r.status,
  isSynthetic: r.is_synthetic,
  sourceReference: r.source_reference,
  effectiveFrom: iso(r.effective_from),
  effectiveUntil: iso(r.effective_until),
  scheduled: r.scheduled,
  draftedByStaffId: r.drafted_by_staff_id,
  approvedByStaffId: r.approved_by_staff_id,
  approvalReasonCode: r.approval_reason_code,
  envelopeOverrideReasonCode: r.envelope_override_reason_code,
  supersedesId: r.supersedes_id,
  createdAt: r.created_at.toISOString(),
  values: valuesOf(r),
});

/** Envelope findings of `proposed` against the bounds and (when present) the ACTIVE card's values. */
function envelopeViolations(proposed: CardValuesView, active: CardValuesView | null, maxChangePercent: number): string[] {
  const out: string[] = [];
  for (const e of ENVELOPE) {
    const value = BigInt(proposed[e.field]);
    if (value > e.max) out.push(`ENVELOPE_${e.code}_OUT_OF_BOUNDS`);
    if (active === null) continue;
    const before = BigInt(active[e.field]);
    const change = value > before ? value - before : before - value;
    if (change * 100n > BigInt(maxChangePercent) * before) out.push(`ENVELOPE_${e.code}_CHANGE_EXCEEDED`);
  }
  return out;
}

function diff(proposed: CardValuesView, active: CardValuesView): Array<{ field: string; active: string | number; proposed: string | number }> {
  return (Object.keys(proposed) as Array<keyof CardValuesView>)
    .filter((k) => proposed[k] !== active[k])
    .map((k) => ({ field: k, active: active[k], proposed: proposed[k] }));
}

/** A card the preview can price (values + tax policy present; any status). */
function previewable(c: StoredCard): PreviewCard {
  if (c.values === null || c.tax === null) throw new Error(`rate card ${c.id} has no component values`);
  return { id: c.id, cityCode: c.cityCode, productCode: c.productCode, version: c.version, status: c.status, values: c.values, tax: c.tax };
}

export class PricingAdminService {
  constructor(
    private readonly db: pg.Pool,
    private readonly idempotency: IdempotencyStore,
    private readonly policy: PricingAdminPolicy,
    private readonly log: Logger,
  ) {}

  private get production(): boolean {
    return !isNonProductionLike(this.policy.WAYVRO_ENV);
  }

  private run(staff: StaffPrincipal, operation: string, key: string, payload: unknown, work: Work): Promise<IdempotentResult> {
    return this.idempotency.execute({ scope: `staff:${staff.staffId}`, operation, key, payload, ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS }, work);
  }

  /** Maker-checker / scope denial: audited (DENIED) and answered 403 with the reason code. */
  private async deny(tx: Queryable, staff: StaffPrincipal, objectType: string, objectId: string | undefined, reasonCode: string): Promise<Refusal> {
    await appendAudit(tx, { actor: { type: 'STAFF', id: staff.staffId }, action: 'STAFF_ACCESS_DENIED', objectType, objectId, outcome: 'DENIED', reasonCode });
    return failure('WAYVRO_E_FORBIDDEN', { reasonCodes: [reasonCode] });
  }

  /** A rule refusal: audited (FAILURE) and answered 409 with the reason codes. */
  private async refuse(
    tx: Queryable,
    staff: StaffPrincipal,
    action: string,
    objectType: string,
    objectId: string,
    reasons: readonly string[],
  ): Promise<Refusal> {
    await appendAudit(tx, { actor: { type: 'STAFF', id: staff.staffId }, action, objectType, objectId, outcome: 'FAILURE', reasonCode: reasons[0] });
    return failure('WAYVRO_E_CONFLICT', { reasonCodes: [...reasons] });
  }

  private async audit(tx: Queryable, staff: StaffPrincipal, action: string, objectType: string, objectId: string, reasonCode?: string | null): Promise<void> {
    await appendAudit(tx, {
      actor: { type: 'STAFF', id: staff.staffId },
      action,
      objectType,
      objectId,
      outcome: 'SUCCESS',
      ...(reasonCode ? { reasonCode } : {}),
    });
  }

  /** City ABAC: `citiesFor` is null for roles that are not city-scoped (PRICING_MANAGER today). */
  private inScope(staff: StaffPrincipal, permission: StaffPermission, cityCode: string): boolean {
    const cities = citiesFor(staff, permission);
    return cities === null || cities.has(cityCode);
  }

  // ── tax policies ───────────────────────────────────────────────────────────────────────────────────────────────
  private async taxRow(q: Queryable, id: string, lock = false): Promise<TaxRow | undefined> {
    if (lock) await q.query(`select 1 from pricing.tax_policies where id = $1 for update`, [id]);
    return (await q.query<TaxRow>(`${TAX_SELECT} where t.id = $1`, [id])).rows[0];
  }

  async listTaxPolicies(): Promise<unknown> {
    const r = await this.db.query<TaxRow>(`${TAX_SELECT} order by t.code, t.version desc limit 200`);
    return { taxPolicies: r.rows.map(taxView) };
  }

  async getTaxPolicy(id: string): Promise<unknown> {
    const t = await this.taxRow(this.db, id);
    return t ? taxView(t) : null;
  }

  draftTaxPolicy(staff: StaffPrincipal, input: TaxDraft, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'pricing.tax-policies.draft', key, input, async (tx) => {
      const id = uuidv7();
      await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.tax-policy:' || $1))`, [input.code]);
      await tx.query(
        `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, rounding_mode, is_placeholder, legal_reference,
                                           drafted_by_staff_id)
         select $1, $2, coalesce(max(version), 0) + 1, 'DRAFT', $3, $4, $5, $6, $7, $8, $9, $10 from pricing.tax_policies where code = $2`,
        [
          id,
          input.code,
          input.jurisdictionCode,
          input.rateBp,
          [...input.appliesTo],
          input.inclusive,
          input.roundingMode ?? 'HALF_EVEN',
          input.isPlaceholder,
          input.legalReference ?? null,
          staff.staffId,
        ],
      );
      await this.audit(tx, staff, 'TAX_POLICY_DRAFTED', TAX_OBJECT, id);
      return success(201, taxView((await this.taxRow(tx, id)) ?? this.vanished()));
    });
  }

  private vanished(): never {
    throw new Error('pricing configuration row vanished inside its transaction');
  }

  private transitionTax(
    staff: StaffPrincipal,
    id: string,
    operation: string,
    key: string,
    payload: unknown,
    apply: (tx: pg.PoolClient, t: TaxRow) => Promise<{ action: string; reasonCode?: string | undefined } | Refusal>,
  ): Promise<IdempotentResult> {
    return this.run(staff, operation, key, payload, async (tx) => {
      const t = await this.taxRow(tx, id, true);
      if (!t) return failure('WAYVRO_E_NOT_FOUND');
      const outcome = await apply(tx, t);
      if ('kind' in outcome) return outcome;
      await this.audit(tx, staff, outcome.action, TAX_OBJECT, id, outcome.reasonCode);
      return success(200, taxView((await this.taxRow(tx, id)) ?? this.vanished()));
    });
  }

  submitTaxPolicy(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionTax(staff, id, 'pricing.tax-policies.submit', key, { id }, async (tx, t) => {
      if (t.status !== 'DRAFT') return failure('WAYVRO_E_CONFLICT');
      if (t.drafted_by_staff_id !== staff.staffId) return this.deny(tx, staff, TAX_OBJECT, id, 'NOT_DRAFTER');
      await tx.query(`update pricing.tax_policies set status = 'PENDING_APPROVAL', version_lock = version_lock + 1 where id = $1`, [id]);
      return { action: 'TAX_POLICY_SUBMITTED' };
    });
  }

  decideTaxPolicy(staff: StaffPrincipal, id: string, decision: 'APPROVE' | 'REJECT', reasonCode: string | undefined, key: string): Promise<IdempotentResult> {
    return this.transitionTax(staff, id, 'pricing.tax-policies.decide', key, { id, decision, reasonCode }, async (tx, t) => {
      if (t.status !== 'PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      if (t.drafted_by_staff_id === staff.staffId) return this.deny(tx, staff, TAX_OBJECT, id, 'MAKER_IS_CHECKER');
      if (decision === 'APPROVE') {
        await tx.query(`update pricing.tax_policies set status = 'APPROVED', approved_by_staff_id = $2, version_lock = version_lock + 1 where id = $1`, [
          id,
          staff.staffId,
        ]);
      } else {
        await tx.query(`update pricing.tax_policies set status = 'REJECTED', version_lock = version_lock + 1 where id = $1`, [id]);
      }
      return { action: decision === 'APPROVE' ? 'TAX_POLICY_APPROVED' : 'TAX_POLICY_REJECTED', reasonCode };
    });
  }

  retireTaxPolicy(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionTax(staff, id, 'pricing.tax-policies.retire', key, { id }, async (tx, t) => {
      if (t.status !== 'APPROVED') return failure('WAYVRO_E_CONFLICT');
      if (t.active_cards > 0) return this.refuse(tx, staff, 'TAX_POLICY_RETIREMENT_REFUSED', TAX_OBJECT, id, ['TAX_POLICY_IN_USE']);
      await tx.query(`update pricing.tax_policies set status = 'RETIRED', version_lock = version_lock + 1 where id = $1`, [id]);
      return { action: 'TAX_POLICY_RETIRED' };
    });
  }

  // ── rate cards ─────────────────────────────────────────────────────────────────────────────────────────────────
  private async cardRow(q: Queryable, id: string, lock = false): Promise<CardRow | undefined> {
    if (lock) await q.query(`select 1 from pricing.rate_cards where id = $1 for update`, [id]);
    return (await q.query<CardRow>(`${CARD_SELECT} where r.id = $1`, [id])).rows[0];
  }

  private async activeRow(q: Queryable, cityCode: string, productCode: string): Promise<CardRow | undefined> {
    return (await q.query<CardRow>(`${CARD_SELECT} where r.city_code = $1 and r.product_code = $2 and r.status = 'ACTIVE'`, [cityCode, productCode])).rows[0];
  }

  /** The full staff view: values, tax policy, diff and envelope findings against the ACTIVE card, submission preview. */
  private async cardView(q: Queryable, id: string): Promise<unknown> {
    const r = await this.cardRow(q, id);
    if (!r) return null;
    const values = valuesOf(r);
    const active = await this.activeRow(q, r.city_code, r.product_code);
    const activeValues = active && active.id !== r.id ? valuesOf(active) : null;
    const tax = values
      ? (
          await q.query<{ id: string; code: string; version: number; status: string; rate_bp: number; inclusive: boolean; is_placeholder: boolean }>(
            `select id, code, version, status, rate_bp, inclusive, is_placeholder from pricing.tax_policies where id = $1`,
            [values.taxPolicyId],
          )
        ).rows[0]
      : undefined;
    return {
      ...cardSummary(r),
      taxPolicy: tax
        ? {
            id: tax.id,
            code: tax.code,
            version: tax.version,
            status: tax.status,
            rateBp: tax.rate_bp,
            inclusive: tax.inclusive,
            isPlaceholder: tax.is_placeholder,
          }
        : null,
      activeCardId: active && active.id !== r.id ? active.id : null,
      diffVsActive: values && activeValues ? diff(values, activeValues) : [],
      envelopeViolations: values ? envelopeViolations(values, activeValues, this.policy.PRICING_ENVELOPE_MAX_CHANGE_PERCENT) : [],
      submissionPreview: r.submission_preview ?? null,
    };
  }

  async listRateCards(cityCode: string | undefined, productCode: string | undefined): Promise<unknown> {
    const r = await this.db.query<CardRow>(
      `${CARD_SELECT} where ($1::text is null or r.city_code = $1) and ($2::text is null or r.product_code = $2)
        order by r.city_code, r.product_code, r.version desc limit 200`,
      [cityCode ?? null, productCode ?? null],
    );
    return { rateCards: r.rows.map(cardSummary) };
  }

  getRateCard(id: string): Promise<unknown> {
    return this.cardView(this.db, id);
  }

  /** Writes the components of a DRAFT card (savepoint: an unknown tax policy or a violated CHECK is a validation error). */
  private async writeValues(tx: pg.PoolClient, id: string, v: CardValuesInput): Promise<Refusal | null> {
    await tx.query('savepoint card_values');
    try {
      await tx.query(
        `insert into pricing.rate_card_components (rate_card_id, base_minor, per_km_minor, per_min_minor, minimum_fare_minor, booking_fee_minor, airport_pickup_fee_minor,
                                                   rounding_step_minor, rounding_mode, toll_policy, tax_policy_id, quote_ttl_seconds, max_distance_m, max_duration_s)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          id,
          v.baseMinor,
          v.perKmMinor,
          v.perMinMinor,
          v.minimumFareMinor,
          v.bookingFeeMinor,
          v.airportPickupFeeMinor,
          v.roundingStepMinor,
          v.roundingMode,
          v.tollPolicy,
          v.taxPolicyId,
          v.quoteTtlSeconds,
          v.maxDistanceM,
          v.maxDurationS,
        ],
      );
      await tx.query('release savepoint card_values');
      return null;
    } catch (e) {
      const state = sqlState(e);
      if (state !== '23503' && state !== '23514') throw e;
      await tx.query('rollback to savepoint card_values');
      return failure('WAYVRO_E_VALIDATION');
    }
  }

  draftRateCard(
    staff: StaffPrincipal,
    input: { cityCode: string; productCode: string; sourceReference: string; isSynthetic?: boolean | undefined; values: CardValuesInput },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(staff, 'pricing.rate-cards.draft', key, input, async (tx) => {
      if (!this.inScope(staff, 'pricing.rate_card.draft', input.cityCode)) return this.deny(tx, staff, CARD_OBJECT, undefined, 'CITY_SCOPE');
      const id = uuidv7();
      await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.rate-card:' || $1 || ':' || $2))`, [input.cityCode, input.productCode]);
      await tx.query('savepoint draft_card');
      try {
        await tx.query(
          `insert into pricing.rate_cards (id, city_code, product_code, version, status, is_synthetic, source_reference, drafted_by_staff_id)
           select $1, $2, $3, coalesce(max(version), 0) + 1, 'DRAFT', $4, $5, $6 from pricing.rate_cards where city_code = $2 and product_code = $3`,
          [id, input.cityCode, input.productCode, input.isSynthetic ?? false, input.sourceReference, staff.staffId],
        );
      } catch (e) {
        if (sqlState(e) !== '23503') throw e;
        await tx.query('rollback to savepoint draft_card');
        return failure('WAYVRO_E_NOT_FOUND');
      }
      const refused = await this.writeValues(tx, id, input.values);
      if (refused) return refused;
      await this.audit(tx, staff, 'RATE_CARD_DRAFTED', CARD_OBJECT, id);
      return success(201, await this.cardView(tx, id));
    });
  }

  replaceValues(staff: StaffPrincipal, id: string, values: CardValuesInput, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'pricing.rate-cards.values', key, { id, values }, async (tx) => {
      const r = await this.cardRow(tx, id, true);
      if (!r) return failure('WAYVRO_E_NOT_FOUND');
      if (r.status !== 'DRAFT') return failure('WAYVRO_E_CONFLICT');
      if (r.drafted_by_staff_id !== staff.staffId) return this.deny(tx, staff, CARD_OBJECT, id, 'NOT_DRAFTER');
      await tx.query(`delete from pricing.rate_card_components where rate_card_id = $1`, [id]);
      const refused = await this.writeValues(tx, id, values);
      if (refused) return refused;
      await tx.query(`update pricing.rate_cards set version_lock = version_lock + 1 where id = $1`, [id]);
      await this.audit(tx, staff, 'RATE_CARD_VALUES_REPLACED', CARD_OBJECT, id);
      return success(200, await this.cardView(tx, id));
    });
  }

  /** New DRAFT (next version) copied from `source`, with `supersedes_id` = source. */
  private async cloneInto(tx: pg.PoolClient, staff: StaffPrincipal, source: CardRow): Promise<string> {
    const id = uuidv7();
    await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.rate-card:' || $1 || ':' || $2))`, [source.city_code, source.product_code]);
    await tx.query(
      `insert into pricing.rate_cards (id, city_code, product_code, version, status, is_synthetic, source_reference, supersedes_id, drafted_by_staff_id)
       select $1, s.city_code, s.product_code,
              (select max(v.version) + 1 from pricing.rate_cards v where v.city_code = s.city_code and v.product_code = s.product_code),
              'DRAFT', s.is_synthetic, s.source_reference, s.id, $3
         from pricing.rate_cards s where s.id = $2`,
      [id, source.id, staff.staffId],
    );
    await tx.query(
      `insert into pricing.rate_card_components (rate_card_id, base_minor, per_km_minor, per_min_minor, minimum_fare_minor, booking_fee_minor, airport_pickup_fee_minor,
                                                 rounding_step_minor, rounding_mode, toll_policy, tax_policy_id, quote_ttl_seconds, max_distance_m, max_duration_s)
       select $1, base_minor, per_km_minor, per_min_minor, minimum_fare_minor, booking_fee_minor, airport_pickup_fee_minor, rounding_step_minor, rounding_mode,
              toll_policy, tax_policy_id, quote_ttl_seconds, max_distance_m, max_duration_s
         from pricing.rate_card_components where rate_card_id = $2`,
      [id, source.id],
    );
    return id;
  }

  cloneRateCard(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'pricing.rate-cards.clone', key, { id }, async (tx) => {
      const source = await this.cardRow(tx, id);
      if (!source) return failure('WAYVRO_E_NOT_FOUND');
      if (!this.inScope(staff, 'pricing.rate_card.draft', source.city_code)) return this.deny(tx, staff, CARD_OBJECT, id, 'CITY_SCOPE');
      if (valuesOf(source) === null) return failure('WAYVRO_E_CONFLICT');
      const clone = await this.cloneInto(tx, staff, source);
      await this.audit(tx, staff, 'RATE_CARD_CLONED', CARD_OBJECT, clone);
      return success(201, await this.cardView(tx, clone));
    });
  }

  /** The default synthetic preview of `card`, with the ACTIVE card first (so each row shows the change). */
  private async submissionPreview(tx: Queryable, card: CardRow): Promise<unknown> {
    const active = await this.activeRow(tx, card.city_code, card.product_code);
    const ids = active && active.id !== card.id ? [active.id, card.id] : [card.id];
    return previewCards((await cardsById(tx, ids)).map(previewable), DEFAULT_BENCHMARK_TUPLES, 'DEFAULT_SYNTHETIC_V1');
  }

  /** DRAFT → PENDING_APPROVAL with the recorded preview (shared by submit and rollback). */
  private async submitLocked(
    tx: pg.PoolClient,
    staff: StaffPrincipal,
    r: CardRow,
    overrideReasonCode: string | null,
    rollback: boolean,
  ): Promise<Refusal | null> {
    const values = valuesOf(r);
    if (!values) return failure('WAYVRO_E_CONFLICT');
    const tax = (await tx.query<{ status: string }>(`select status from pricing.tax_policies where id = $1 for share`, [values.taxPolicyId])).rows[0];
    if (tax?.status !== 'APPROVED') return this.refuse(tx, staff, 'RATE_CARD_SUBMISSION_REFUSED', CARD_OBJECT, r.id, ['TAX_POLICY_NOT_APPROVED']);
    const active = await this.activeRow(tx, r.city_code, r.product_code);
    const violations = envelopeViolations(values, active ? valuesOf(active) : null, this.policy.PRICING_ENVELOPE_MAX_CHANGE_PERCENT);
    // a rollback restores earlier approved values: its envelope findings carry the ROLLBACK reason for the approver
    const override = violations.length === 0 ? null : (overrideReasonCode ?? (rollback ? 'ROLLBACK' : null));
    if (violations.length > 0 && override === null) {
      return this.refuse(tx, staff, 'RATE_CARD_SUBMISSION_REFUSED', CARD_OBJECT, r.id, ['ENVELOPE_OVERRIDE_REQUIRED', ...violations]);
    }
    const preview = await this.submissionPreview(tx, r);
    await tx.query(
      `update pricing.rate_cards set status = 'PENDING_APPROVAL', submission_preview = $2, envelope_override_reason_code = $3, version_lock = version_lock + 1
        where id = $1`,
      [r.id, JSON.stringify(preview), override],
    );
    await this.audit(tx, staff, 'RATE_CARD_PREVIEWED', CARD_OBJECT, r.id, 'DEFAULT_SYNTHETIC_V1');
    await this.audit(tx, staff, 'RATE_CARD_SUBMITTED', CARD_OBJECT, r.id, override);
    return null;
  }

  submitRateCard(staff: StaffPrincipal, id: string, overrideReasonCode: string | undefined, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'pricing.rate-cards.submit', key, { id, overrideReasonCode }, async (tx) => {
      const r = await this.cardRow(tx, id, true);
      if (!r) return failure('WAYVRO_E_NOT_FOUND');
      if (r.status !== 'DRAFT') return failure('WAYVRO_E_CONFLICT');
      if (r.drafted_by_staff_id !== staff.staffId) return this.deny(tx, staff, CARD_OBJECT, id, 'NOT_DRAFTER');
      const refused = await this.submitLocked(tx, staff, r, overrideReasonCode ?? null, false);
      if (refused) return refused;
      return success(200, await this.cardView(tx, id));
    });
  }

  decideRateCard(staff: StaffPrincipal, id: string, decision: 'APPROVE' | 'REJECT', reasonCode: string | undefined, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'pricing.rate-cards.decide', key, { id, decision, reasonCode }, async (tx) => {
      const r = await this.cardRow(tx, id, true);
      if (!r) return failure('WAYVRO_E_NOT_FOUND');
      if (r.status !== 'PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      if (!this.inScope(staff, 'pricing.rate_card.approve', r.city_code)) return this.deny(tx, staff, CARD_OBJECT, id, 'CITY_SCOPE');
      if (r.drafted_by_staff_id === staff.staffId) return this.deny(tx, staff, CARD_OBJECT, id, 'MAKER_IS_CHECKER');
      if (decision === 'APPROVE') {
        if (reasonCode === undefined) return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['APPROVAL_REASON_REQUIRED'] });
        await tx.query(
          `update pricing.rate_cards set status = 'APPROVED', approved_by_staff_id = $2, approval_reason_code = $3, version_lock = version_lock + 1 where id = $1`,
          [id, staff.staffId, reasonCode],
        );
      } else {
        await tx.query(`update pricing.rate_cards set status = 'REJECTED', approval_reason_code = $2, version_lock = version_lock + 1 where id = $1`, [
          id,
          reasonCode ?? null,
        ]);
      }
      await this.audit(tx, staff, decision === 'APPROVE' ? 'RATE_CARD_APPROVED' : 'RATE_CARD_REJECTED', CARD_OBJECT, id, reasonCode);
      return success(200, await this.cardView(tx, id));
    });
  }

  /** Runs `work` on the card under its (city, product) activation lock (the key columns never change, so they are read first). */
  private async locked(tx: pg.PoolClient, id: string, work: (r: CardRow) => Promise<Outcome>): Promise<Outcome> {
    const k = (await tx.query<{ city_code: string; product_code: string }>(`select city_code, product_code from pricing.rate_cards where id = $1`, [id]))
      .rows[0];
    if (!k) return failure('WAYVRO_E_NOT_FOUND');
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [rateCardActivationLockKey(k.city_code, k.product_code)]);
    const r = await this.cardRow(tx, id, true);
    if (!r) return failure('WAYVRO_E_NOT_FOUND');
    return work(r);
  }

  /** Every activation rule (also re-checked by the worker at scheduled activation). */
  private async activationProblems(tx: Queryable, r: CardRow): Promise<string[]> {
    const problems: string[] = [];
    const values = valuesOf(r);
    const tax = values
      ? (
          await tx.query<{ status: string; is_placeholder: boolean }>(`select status, is_placeholder from pricing.tax_policies where id = $1`, [
            values.taxPolicyId,
          ])
        ).rows[0]
      : undefined;
    if (tax?.status !== 'APPROVED') problems.push('TAX_POLICY_NOT_APPROVED');
    if (this.production && r.is_synthetic) problems.push('SYNTHETIC_REFUSED_IN_PRODUCTION');
    if (this.production && tax?.is_placeholder !== false) problems.push('PLACEHOLDER_TAX_REFUSED_IN_PRODUCTION');
    const newer = await tx.query(`select 1 from pricing.rate_cards where city_code = $1 and product_code = $2 and status = 'ACTIVE' and version > $3`, [
      r.city_code,
      r.product_code,
      r.version,
    ]);
    if (newer.rowCount !== 0) problems.push('NEWER_CARD_ACTIVE');
    return problems;
  }

  activateRateCard(staff: StaffPrincipal, id: string, request: RateCardActivation, key: string): Promise<IdempotentResult> {
    let activated: { cityCode: string; productCode: string; version: number } | null = null;
    return this.run(staff, 'pricing.rate-cards.activate', key, { id, ...request }, (tx) =>
      this.locked(tx, id, async (r) => {
        if (r.status !== 'APPROVED') return failure('WAYVRO_E_CONFLICT');
        const problems = await this.activationProblems(tx, r);
        if (problems.length > 0) return this.refuse(tx, staff, 'RATE_CARD_ACTIVATION_REFUSED', CARD_OBJECT, id, problems);
        if (request.when === 'SCHEDULED') {
          const future = (await tx.query<{ ok: boolean }>(`select $1::timestamptz >= now() ok`, [request.effectiveFrom])).rows[0]?.ok;
          if (!future) return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['EFFECTIVE_FROM_IN_PAST'] });
          await tx.query(`update pricing.rate_cards set effective_from = $2, scheduled = true, version_lock = version_lock + 1 where id = $1`, [
            id,
            request.effectiveFrom,
          ]);
          await this.audit(tx, staff, 'RATE_CARD_SCHEDULED', CARD_OBJECT, id);
          return success(200, await this.cardView(tx, id));
        }
        const previous = await tx.query<{ id: string }>(
          `update pricing.rate_cards set status = 'RETIRED', effective_until = clock_timestamp(), version_lock = version_lock + 1
            where city_code = $1 and product_code = $2 and status = 'ACTIVE' returning id`,
          [r.city_code, r.product_code],
        );
        for (const p of previous.rows) await this.audit(tx, staff, 'RATE_CARD_RETIRED', CARD_OBJECT, p.id, 'SUPERSEDED_BY_ACTIVATION');
        await tx.query(
          `update pricing.rate_cards set status = 'ACTIVE', effective_from = clock_timestamp(), scheduled = false, version_lock = version_lock + 1 where id = $1`,
          [id],
        );
        await emitEvent(tx, {
          type: 'pricing.rate-card.activated.v1',
          aggregateType: CARD_OBJECT,
          aggregateId: id,
          accountId: null,
          payload: {
            cityCode: r.city_code,
            productCode: r.product_code,
            version: r.version,
            previousRateCardId: previous.rows[0]?.id ?? null,
            scheduled: false,
          },
        });
        await this.audit(tx, staff, 'RATE_CARD_ACTIVATED', CARD_OBJECT, id);
        activated = { cityCode: r.city_code, productCode: r.product_code, version: r.version };
        return success(200, await this.cardView(tx, id));
      }),
    ).then((result) => {
      if (activated && !result.replayed) {
        this.log.info({ signal: 'RATE_CARD_ACTIVATED', rateCardId: id, ...activated, actor: 'STAFF', scheduled: false }, 'rate card activated');
      }
      return result;
    });
  }

  cancelSchedule(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'pricing.rate-cards.cancel-schedule', key, { id }, (tx) =>
      this.locked(tx, id, async (r) => {
        if (r.status !== 'APPROVED' || !r.scheduled) return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['NOT_SCHEDULED'] });
        await tx.query(`update pricing.rate_cards set effective_from = null, scheduled = false, version_lock = version_lock + 1 where id = $1`, [id]);
        await this.audit(tx, staff, 'RATE_CARD_SCHEDULE_CANCELLED', CARD_OBJECT, id);
        return success(200, await this.cardView(tx, id));
      }),
    );
  }

  /** Rollback: a NEW version cloned from an earlier APPROVED/RETIRED card, submitted at once (the checker approves it). */
  rollbackRateCard(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'pricing.rate-cards.rollback', key, { id }, async (tx) => {
      const source = await this.cardRow(tx, id);
      if (!source) return failure('WAYVRO_E_NOT_FOUND');
      if (!this.inScope(staff, 'pricing.rate_card.rollback', source.city_code)) return this.deny(tx, staff, CARD_OBJECT, id, 'CITY_SCOPE');
      if ((source.status !== 'APPROVED' && source.status !== 'RETIRED') || valuesOf(source) === null) {
        return this.refuse(tx, staff, 'RATE_CARD_ROLLBACK_REFUSED', CARD_OBJECT, id, ['ROLLBACK_SOURCE_INVALID']);
      }
      const clone = await this.cloneInto(tx, staff, source);
      await this.audit(tx, staff, 'RATE_CARD_ROLLBACK_REQUESTED', CARD_OBJECT, clone);
      const row = await this.cardRow(tx, clone, true);
      if (!row) this.vanished();
      const refused = await this.submitLocked(tx, staff, row, null, true);
      if (refused) return refused;
      return success(201, await this.cardView(tx, clone));
    });
  }

  // ── previews (no provider call, no quote row; audited) ─────────────────────────────────────────────────────────
  async preview(staff: StaffPrincipal, input: { rateCardIds: readonly string[]; tuples?: readonly BenchmarkTuple[] | undefined }): Promise<unknown> {
    const cards = await cardsById(this.db, input.rateCardIds);
    if (cards.length !== input.rateCardIds.length) return null;
    const body = previewCards(cards.map(previewable), input.tuples ?? DEFAULT_BENCHMARK_TUPLES, input.tuples ? 'CUSTOM' : 'DEFAULT_SYNTHETIC_V1');
    for (const id of input.rateCardIds)
      await this.audit(this.db, staff, 'RATE_CARD_PREVIEWED', CARD_OBJECT, id, input.tuples ? 'CUSTOM' : 'DEFAULT_SYNTHETIC_V1');
    return body;
  }

  // ── support quote lookup (T3-33): reason-gated, city-scoped, districts and amounts only, audited ─────────────────
  async lookupQuote(staff: StaffPrincipal, input: { quoteId?: string | undefined; quoteGroupId?: string | undefined; reasonCode: string }): Promise<unknown> {
    const group = (
      await this.db.query<{ quote_group_id: string; city_code: string }>(
        `select quote_group_id, city_code from pricing.quotes where ($1::uuid is not null and id = $1) or ($2::uuid is not null and quote_group_id = $2) limit 1`,
        [input.quoteId ?? null, input.quoteGroupId ?? null],
      )
    ).rows[0];
    if (!group || !this.inScope(staff, 'pricing.quote.view', group.city_code)) {
      await appendAudit(this.db, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'QUOTE_LOOKUP_NOT_FOUND',
        objectType: QUOTE_OBJECT,
        outcome: 'FAILURE',
        reasonCode: input.reasonCode,
      });
      return null;
    }
    const quotes = await this.db.query<{
      id: string;
      created_at: Date;
      product_code: string;
      status: 'PRICED' | 'EXPIRED' | 'SUPERSEDED';
      expired: boolean;
      total_minor: string;
      tax_included_rate_bp: number | null;
      tax_included_minor: string | null;
      toll_policy: string;
      rate_card_id: string;
      rate_card_version: number;
      pricing_engine_version: string;
      expires_at: Date;
      is_synthetic: boolean;
      pickup_district_code: string | null;
      dropoff_district_code: string | null;
    }>(
      `select id, created_at, product_code, status, expires_at <= now() expired, total_minor::text, tax_included_rate_bp, tax_included_minor::text, toll_policy,
              rate_card_id, rate_card_version, pricing_engine_version, expires_at, is_synthetic, pickup_district_code, dropoff_district_code
         from pricing.quotes where quote_group_id = $1 order by id`,
      [group.quote_group_id],
    );
    const components = await this.db.query<{ quote_id: string; kind: string; amount_minor: string; basis: Record<string, string | number | boolean | null> }>(
      `select quote_id, kind, amount_minor::text, basis from pricing.quote_components where quote_id = any($1::uuid[]) order by quote_id, seq`,
      [quotes.rows.map((q) => q.id)],
    );
    await appendAudit(this.db, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: staff.breakGlassId ? 'QUOTE_VIEWED_BY_STAFF_BREAK_GLASS' : 'QUOTE_VIEWED_BY_STAFF',
      objectType: QUOTE_OBJECT,
      objectId: group.quote_group_id,
      outcome: 'SUCCESS',
      reasonCode: input.reasonCode,
    });
    const first = quotes.rows[0];
    if (!first) return null;
    return {
      quoteGroupId: group.quote_group_id,
      createdAt: first.created_at.toISOString(),
      cityCode: group.city_code,
      pickupDistrictCode: first.pickup_district_code,
      dropoffDistrictCode: first.dropoff_district_code,
      options: quotes.rows.map((q) => ({
        quoteId: q.id,
        productCode: q.product_code,
        status: q.status === 'PRICED' && q.expired ? 'EXPIRED' : q.status,
        total: { currency: 'PKR', minor: q.total_minor },
        components: components.rows
          .filter((c) => c.quote_id === q.id)
          .map((c) => ({ kind: c.kind, amount: { currency: 'PKR', minor: c.amount_minor }, ...(Object.keys(c.basis).length > 0 ? { basis: c.basis } : {}) })),
        taxIncluded:
          q.tax_included_rate_bp !== null && q.tax_included_minor !== null
            ? { rateBp: q.tax_included_rate_bp, amount: { currency: 'PKR', minor: q.tax_included_minor } }
            : null,
        tollPolicy: q.toll_policy,
        rateCardId: q.rate_card_id,
        rateCardVersion: q.rate_card_version,
        pricingEngineVersion: q.pricing_engine_version,
        expiresAt: q.expires_at.toISOString(),
        isSynthetic: q.is_synthetic,
      })),
    };
  }
}
