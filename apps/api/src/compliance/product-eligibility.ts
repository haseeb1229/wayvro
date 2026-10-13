/**
 * Per-product vehicle eligibility for the driver readiness view (P3.8; H10 display, K19; UX doc §10.1–§10.2).
 * DISPLAY ONLY — never an authorisation: earning eligibility stays `evaluateEarningEligibility`, and dispatch
 * eligibility is Phase 4. The catalog module owns the rules and their evaluation; this module reads them only through
 * the port below, injected by composition (PHASE3_ARCHITECTURE §1: no cross-context SQL), and maps the result onto the
 * additive `DriverCompliance.productEligibility` contract.
 */
import type { DriverCompliance, PRODUCT_ELIGIBILITY_MISSING_ATTRIBUTES, PRODUCT_ELIGIBILITY_REASONS, VEHICLE_BODY_TYPES } from '@wayvro/contracts';

type ContractReason = (typeof PRODUCT_ELIGIBILITY_REASONS)[number];
/** Reasons a catalog RULE can give; the city-status reasons are added here. A catalog reason outside the contract list fails to compile at the composition seam. */
type RuleReason = Exclude<ContractReason, 'DISABLED_LEGAL_GATE' | 'NOT_ENABLED_IN_CITY'>;
type MissingAttribute = (typeof PRODUCT_ELIGIBILITY_MISSING_ATTRIBUTES)[number];

/** The vehicle facts a rule reads: server-stored values (applicant claims stay null until made). */
interface VehicleRuleFacts {
  readonly serviceCategory: string;
  readonly modelYear: number;
  readonly seats: number | null;
  readonly bodyType: (typeof VEHICLE_BODY_TYPES)[number] | null;
  readonly airConditioned: boolean | null;
}

/** One product's evaluation as the catalog read model returns it (structural: the catalog's own types satisfy it). */
interface CatalogProductEligibility {
  readonly productCode: string;
  readonly cityStatus: string;
  readonly result:
    | { readonly kind: 'ELIGIBLE'; readonly ruleVersion: number }
    | { readonly kind: 'NOT_ELIGIBLE'; readonly reasons: readonly RuleReason[]; readonly ruleVersion: number | null }
    | { readonly kind: 'UNKNOWN'; readonly missingAttributes: readonly MissingAttribute[]; readonly ruleVersion: number };
}

/** Implemented by the catalog module (`CatalogReadModel.eligibilityForVehicle`); `at` is server time. */
export interface ProductEligibilityPort {
  eligibilityForVehicle(vehicle: VehicleRuleFacts, cityCode: string, at: Date): Promise<readonly CatalogProductEligibility[]>;
}

type ProductEligibilityView = NonNullable<DriverCompliance['productEligibility']>[number];

/**
 * Maps one vehicle's catalog evaluation onto the contract. A product that is not ENABLED in the city is NOT_OFFERED
 * whatever the vehicle (DISABLED_LEGAL_GATE stays visible as such; every other status is "not enabled yet").
 */
export function productEligibilityView(vehicleId: string, products: readonly CatalogProductEligibility[]): ProductEligibilityView[] {
  return products.map((p): ProductEligibilityView => {
    const base = { vehicleId, productCode: p.productCode };
    if (p.cityStatus !== 'ENABLED') {
      const reason: ContractReason = p.cityStatus === 'DISABLED_LEGAL_GATE' ? 'DISABLED_LEGAL_GATE' : 'NOT_ENABLED_IN_CITY';
      return { ...base, result: 'NOT_OFFERED', reasons: [reason], missingAttributes: [], ruleVersion: null };
    }
    const r = p.result;
    switch (r.kind) {
      case 'ELIGIBLE':
        return { ...base, result: 'ELIGIBLE', reasons: [], missingAttributes: [], ruleVersion: r.ruleVersion };
      case 'NOT_ELIGIBLE':
        return { ...base, result: 'NOT_ELIGIBLE', reasons: [...r.reasons], missingAttributes: [], ruleVersion: r.ruleVersion };
      case 'UNKNOWN':
        return { ...base, result: 'UNKNOWN', reasons: [], missingAttributes: [...r.missingAttributes], ruleVersion: r.ruleVersion };
    }
  });
}
