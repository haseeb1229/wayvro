/**
 * Read side of the pricing configuration (P3.3; pricing doc §2–§3): rate-card headers joined with their immutable
 * component values and tax policy, converted to the pure engine's input types. Amounts come from PostgreSQL `bigint`
 * columns as strings and become `bigint` — never a binary float. Also the catalog's `RateCardPresence` (ENABLE
 * prerequisite: an ACTIVE card whose tax policy is APPROVED).
 */
import type { RoundingMode } from '@wayvro/domain';
import type { Queryable } from '@wayvro/server-runtime';
import type { RateCardPresence } from '../catalog/catalog-admin.service.js';
import type { RateCardValues, TaxableKind, TaxPolicyValues } from './engine.js';

type ConfigStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'RETIRED' | 'REJECTED';
type TaxStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'RETIRED' | 'REJECTED';

export interface StoredTaxPolicy extends TaxPolicyValues {
  readonly code: string;
  readonly status: TaxStatus;
}

/** One rate card with its values (null while a DRAFT has none) and its tax policy. */
export interface StoredCard {
  readonly id: string;
  readonly cityCode: string;
  readonly productCode: string;
  readonly version: number;
  readonly status: ConfigStatus;
  readonly isSynthetic: boolean;
  readonly draftedByStaffId: string | null;
  readonly values: (RateCardValues & { readonly taxPolicyId: string; readonly quoteTtlSeconds: number }) | null;
  readonly tax: StoredTaxPolicy | null;
}

interface CardJoinRow {
  id: string;
  city_code: string;
  product_code: string;
  version: number;
  status: ConfigStatus;
  is_synthetic: boolean;
  drafted_by_staff_id: string | null;
  base_minor: string | null;
  per_km_minor: string | null;
  per_min_minor: string | null;
  minimum_fare_minor: string | null;
  booking_fee_minor: string | null;
  airport_pickup_fee_minor: string | null;
  rounding_step_minor: string | null;
  rounding_mode: RoundingMode | null;
  toll_policy: 'NOT_APPLICABLE' | 'EXCLUDED_DISCLOSED' | null;
  tax_policy_id: string | null;
  quote_ttl_seconds: number | null;
  max_distance_m: number | null;
  max_duration_s: number | null;
  tax_code: string | null;
  tax_version: number | null;
  tax_status: TaxStatus | null;
  rate_bp: number | null;
  applies_to: TaxableKind[] | null;
  inclusive: boolean | null;
  tax_rounding_mode: RoundingMode | null;
  is_placeholder: boolean | null;
}

const CARD_SELECT = `select r.id, r.city_code, r.product_code, r.version, r.status, r.is_synthetic, r.drafted_by_staff_id,
       c.base_minor::text, c.per_km_minor::text, c.per_min_minor::text, c.minimum_fare_minor::text, c.booking_fee_minor::text,
       c.airport_pickup_fee_minor::text, c.rounding_step_minor::text, c.rounding_mode, c.toll_policy, c.tax_policy_id, c.quote_ttl_seconds,
       c.max_distance_m, c.max_duration_s, t.code tax_code, t.version tax_version, t.status tax_status, t.rate_bp, t.applies_to, t.inclusive,
       t.rounding_mode tax_rounding_mode, t.is_placeholder
  from pricing.rate_cards r
  left join pricing.rate_card_components c on c.rate_card_id = r.id
  left join pricing.tax_policies t on t.id = c.tax_policy_id`;

function toCard(r: CardJoinRow): StoredCard {
  const values =
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
      ? null
      : {
          baseMinor: BigInt(r.base_minor),
          perKmMinor: BigInt(r.per_km_minor),
          perMinMinor: BigInt(r.per_min_minor),
          minimumFareMinor: BigInt(r.minimum_fare_minor),
          bookingFeeMinor: BigInt(r.booking_fee_minor),
          airportPickupFeeMinor: BigInt(r.airport_pickup_fee_minor),
          roundingStepMinor: BigInt(r.rounding_step_minor),
          roundingMode: r.rounding_mode,
          tollPolicy: r.toll_policy,
          maxDistanceM: r.max_distance_m,
          maxDurationS: r.max_duration_s,
          taxPolicyId: r.tax_policy_id,
          quoteTtlSeconds: r.quote_ttl_seconds,
        };
  const tax =
    r.tax_policy_id === null ||
    r.tax_code === null ||
    r.tax_version === null ||
    r.tax_status === null ||
    r.rate_bp === null ||
    r.applies_to === null ||
    r.inclusive === null ||
    r.tax_rounding_mode === null ||
    r.is_placeholder === null
      ? null
      : {
          id: r.tax_policy_id,
          code: r.tax_code,
          version: r.tax_version,
          status: r.tax_status,
          rateBp: r.rate_bp,
          appliesTo: r.applies_to,
          inclusive: r.inclusive,
          roundingMode: r.tax_rounding_mode,
          isPlaceholder: r.is_placeholder,
        };
  return {
    id: r.id,
    cityCode: r.city_code,
    productCode: r.product_code,
    version: r.version,
    status: r.status,
    isSynthetic: r.is_synthetic,
    draftedByStaffId: r.drafted_by_staff_id,
    values,
    tax,
  };
}

/** Cards by id, in the order of `ids` (unknown ids are absent). */
export async function cardsById(q: Queryable, ids: readonly string[]): Promise<StoredCard[]> {
  if (ids.length === 0) return [];
  const r = await q.query<CardJoinRow>(`${CARD_SELECT} where r.id = any($1::uuid[])`, [[...ids]]);
  const byId = new Map(r.rows.map((row) => [row.id, toCard(row)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** The ACTIVE card of (city, product); `lock` reads the header FOR SHARE (an activation retiring it then waits). */
export async function activeCard(q: Queryable, cityCode: string, productCode: string, lock = false): Promise<StoredCard | null> {
  const r = await q.query<CardJoinRow>(
    `${CARD_SELECT} where r.city_code = $1 and r.product_code = $2 and r.status = 'ACTIVE'${lock ? ' for share of r' : ''}`,
    [cityCode, productCode],
  );
  const row = r.rows[0];
  return row ? toCard(row) : null;
}

/** A card can price: values present and its tax policy APPROVED. */
export const priceable = (c: StoredCard): c is StoredCard & { values: NonNullable<StoredCard['values']>; tax: StoredTaxPolicy } =>
  c.values !== null && c.tax !== null && c.tax.status === 'APPROVED';

/** The catalog's ENABLE prerequisite, read from the pricing tables (wired in the composition root). */
export class PgRateCardPresence implements RateCardPresence {
  constructor(private readonly db: Queryable) {}

  async hasActiveRateCard(cityCode: string, productCode: string, q: Queryable = this.db): Promise<boolean> {
    const card = await activeCard(q, cityCode, productCode);
    return card !== null && priceable(card);
  }
}
