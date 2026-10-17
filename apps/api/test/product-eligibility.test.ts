/** P3.8 unit: mapping the catalog's per-product vehicle evaluation onto `DriverCompliance.productEligibility`. */
import { DriverComplianceSchema } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { productEligibilityView } from '../src/compliance/product-eligibility.js';

const VEHICLE = '0190f0a0-0000-7000-8000-0000000000e1';
const PROFILE = '0190f0a0-0000-7000-8000-0000000000e2';

const rows: Parameters<typeof productEligibilityView>[1] = [
  { productCode: 'ECONOMY', cityStatus: 'ENABLED', result: { kind: 'ELIGIBLE', ruleVersion: 2 } },
  { productCode: 'COMFORT', cityStatus: 'ENABLED', result: { kind: 'UNKNOWN', missingAttributes: ['seats', 'bodyType'], ruleVersion: 1 } },
  { productCode: 'XL', cityStatus: 'ENABLED', result: { kind: 'NOT_ELIGIBLE', reasons: ['NO_ACTIVE_RULE'], ruleVersion: null } },
  { productCode: 'PLUS', cityStatus: 'ENABLED', result: { kind: 'NOT_ELIGIBLE', reasons: ['VEHICLE_TOO_OLD', 'AC_REQUIRED'], ruleVersion: 4 } },
  { productCode: 'BIKE', cityStatus: 'DISABLED_LEGAL_GATE', result: { kind: 'NOT_ELIGIBLE', reasons: ['VEHICLE_CLASS_MISMATCH'], ruleVersion: null } },
  { productCode: 'LATER', cityStatus: 'CONFIGURED', result: { kind: 'ELIGIBLE', ruleVersion: 1 } },
  { productCode: 'PAUSED', cityStatus: 'SUSPENDED', result: { kind: 'ELIGIBLE', ruleVersion: 1 } },
];

describe('productEligibilityView (display only)', () => {
  const view = productEligibilityView(VEHICLE, rows);

  it('keeps the catalog decision for ENABLED products, with its rule version', () => {
    expect(view.slice(0, 4)).toEqual([
      { vehicleId: VEHICLE, productCode: 'ECONOMY', result: 'ELIGIBLE', reasons: [], missingAttributes: [], ruleVersion: 2 },
      { vehicleId: VEHICLE, productCode: 'COMFORT', result: 'UNKNOWN', reasons: [], missingAttributes: ['seats', 'bodyType'], ruleVersion: 1 },
      { vehicleId: VEHICLE, productCode: 'XL', result: 'NOT_ELIGIBLE', reasons: ['NO_ACTIVE_RULE'], missingAttributes: [], ruleVersion: null },
      { vehicleId: VEHICLE, productCode: 'PLUS', result: 'NOT_ELIGIBLE', reasons: ['VEHICLE_TOO_OLD', 'AC_REQUIRED'], missingAttributes: [], ruleVersion: 4 },
    ]);
  });

  it('a product not ENABLED in the city is NOT_OFFERED whatever the vehicle (legal gate named as such)', () => {
    expect(view.slice(4).map((p) => [p.productCode, p.result, p.reasons, p.ruleVersion])).toEqual([
      ['BIKE', 'NOT_OFFERED', ['DISABLED_LEGAL_GATE'], null],
      ['LATER', 'NOT_OFFERED', ['NOT_ENABLED_IN_CITY'], null],
      ['PAUSED', 'NOT_OFFERED', ['NOT_ENABLED_IN_CITY'], null],
    ]);
  });

  it('every row satisfies the published contract', () => {
    const parsed = DriverComplianceSchema.safeParse({
      profile: { id: PROFILE, state: 'VERIFIED' },
      eligibility: [],
      documents: [],
      restrictions: [],
      productEligibility: view,
    });
    expect(parsed.success).toBe(true);
  });
});
