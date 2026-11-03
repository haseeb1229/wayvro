import { PRODUCT_ELIGIBILITY_MISSING_ATTRIBUTES, PRODUCT_ELIGIBILITY_REASONS, type DriverCompliance } from '@wayvro/contracts';
import type { DriverStringKey } from '../i18n/driver-strings';
import type { RowMark } from './marks';

/**
 * Eligibility per service product `/drive/eligibility` (P3.8; H10 display, K19; UX doc §10.2). Built ONLY from the
 * server's `DriverCompliance.productEligibility` (the catalog rules evaluated server-side): the app never evaluates a
 * rule, and the result is display only — it never enables anything. Unknown (newer) reason or attribute codes are shown
 * by reference, never as a guessed explanation.
 */
type ProductEligibility = NonNullable<DriverCompliance['productEligibility']>[number];
type ProductResult = ProductEligibility['result'];
type Reason = (typeof PRODUCT_ELIGIBILITY_REASONS)[number];
type MissingAttribute = (typeof PRODUCT_ELIGIBILITY_MISSING_ATTRIBUTES)[number];

const isReason = (code: string): code is Reason => (PRODUCT_ELIGIBILITY_REASONS as readonly string[]).includes(code);
const isMissingAttribute = (code: string): code is MissingAttribute => (PRODUCT_ELIGIBILITY_MISSING_ATTRIBUTES as readonly string[]).includes(code);

/** A code with its copy; `key` null ⇒ show the reference code only. */
export interface CodedItem {
  readonly code: string;
  readonly key: DriverStringKey | null;
}

export interface ProductRowView {
  readonly productCode: string;
  readonly result: ProductResult;
  readonly mark: RowMark;
  readonly resultKey: DriverStringKey;
  readonly reasons: readonly CodedItem[];
  readonly missing: readonly CodedItem[];
}

export interface VehicleEligibilityView {
  readonly vehicleId: string;
  /** The vehicle's service category and city from the server's earning-eligibility row, when present. */
  readonly category: DriverCompliance['eligibility'][number]['serviceCategory'] | null;
  readonly cityCode: string | null;
  readonly products: readonly ProductRowView[];
}

type EligibilityModel =
  /** The server did not send per-product eligibility (older server): say so, link to the status page. */
  { readonly kind: 'unavailable' } | { readonly kind: 'no-vehicle' } | { readonly kind: 'vehicles'; readonly vehicles: readonly VehicleEligibilityView[] };

const RESULT_MARK: Readonly<Record<ProductResult, RowMark>> = { ELIGIBLE: 'ok', UNKNOWN: 'attention', NOT_ELIGIBLE: 'blocked', NOT_OFFERED: 'info' };
/** @internal exported for the K19 coverage test */
export const resultKey = (result: ProductResult): DriverStringKey => `drive.eligibility.result.${result}`;
/** Reasons whose copy names the city ({city}); without a known city they are shown by reference. */
const CITY_REASONS: ReadonlySet<string> = new Set<Reason>(['DISABLED_LEGAL_GATE', 'NOT_ENABLED_IN_CITY']);
/** @internal exported for the K19 coverage test */
export const reasonItem = (code: string, cityKnown: boolean): CodedItem => ({
  code,
  key: isReason(code) && (cityKnown || !CITY_REASONS.has(code)) ? `drive.eligibility.reason.${code}` : null,
});
/** @internal exported for the K19 coverage test */
export const missingItem = (code: string): CodedItem => ({ code, key: isMissingAttribute(code) ? `drive.eligibility.missing.${code}` : null });

const productRow = (p: ProductEligibility, cityKnown: boolean): ProductRowView => ({
  productCode: p.productCode,
  result: p.result,
  mark: RESULT_MARK[p.result],
  resultKey: resultKey(p.result),
  reasons: p.reasons.map((code) => reasonItem(code, cityKnown)),
  missing: p.missingAttributes.map(missingItem),
});

export function eligibilityModel(compliance: DriverCompliance): EligibilityModel {
  const rows = compliance.productEligibility;
  if (rows === undefined) return { kind: 'unavailable' };
  const vehicleIds = [...new Set(rows.map((r) => r.vehicleId))];
  if (vehicleIds.length === 0) return { kind: 'no-vehicle' };
  return {
    kind: 'vehicles',
    vehicles: vehicleIds.map((vehicleId) => {
      const earning = compliance.eligibility.find((e) => e.vehicleId === vehicleId);
      // every product row is for the driver's city; any earning row names it
      const cityCode = earning?.cityCode ?? compliance.eligibility[0]?.cityCode ?? null;
      return {
        vehicleId,
        category: earning?.serviceCategory ?? null,
        cityCode,
        products: rows.filter((r) => r.vehicleId === vehicleId).map((p) => productRow(p, cityCode !== null)),
      };
    }),
  };
}

/** The readiness-row summary of the per-product results (counted per product, over every vehicle). */
type EligibilitySummary =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'no-vehicle' }
  | { readonly kind: 'eligible'; readonly count: number }
  | { readonly kind: 'missing'; readonly count: number }
  | { readonly kind: 'not-eligible' };

export function eligibilitySummary(compliance: DriverCompliance): EligibilitySummary {
  const rows = compliance.productEligibility;
  if (rows === undefined) return { kind: 'unavailable' };
  if (rows.length === 0) return { kind: 'no-vehicle' };
  const products = (result: ProductResult) => new Set(rows.filter((r) => r.result === result).map((r) => r.productCode));
  const eligible = products('ELIGIBLE');
  if (eligible.size > 0) return { kind: 'eligible', count: eligible.size };
  const unknown = products('UNKNOWN');
  if (unknown.size > 0) return { kind: 'missing', count: unknown.size };
  return { kind: 'not-eligible' };
}
