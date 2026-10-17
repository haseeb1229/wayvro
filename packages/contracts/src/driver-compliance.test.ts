import { describe, expect, it } from 'vitest';
import {
  DriverComplianceSchema,
  PRODUCT_ELIGIBILITY_MISSING_ATTRIBUTES,
  PRODUCT_ELIGIBILITY_REASONS,
  PRODUCT_ELIGIBILITY_RESULTS,
  buildOpenApiDocument,
} from './index.js';

const id = (n: number) => `0190f0a0-0000-7000-8000-00000000000${String(n)}`;
const base = {
  profile: { id: id(1), state: 'VERIFIED' as const },
  eligibility: [],
  documents: [],
  restrictions: [],
};
const row = (overrides: Record<string, unknown> = {}) => ({
  vehicleId: id(2),
  productCode: 'ECONOMY',
  result: 'ELIGIBLE',
  reasons: [],
  missingAttributes: [],
  ruleVersion: 1,
  ...overrides,
});

describe('P3.8 DriverCompliance.productEligibility (additive, display only)', () => {
  it('is optional: a Phase-2 response without it stays valid', () => {
    expect(DriverComplianceSchema.safeParse(base).success).toBe(true);
  });

  it('accepts every result with its reasons / missing attributes / rule version', () => {
    const rows = [
      row(),
      row({ productCode: 'COMFORT', result: 'UNKNOWN', missingAttributes: ['seats', 'airConditioned', 'bodyType'] }),
      row({ productCode: 'COMFORT', result: 'NOT_ELIGIBLE', reasons: ['VEHICLE_TOO_OLD', 'AC_REQUIRED'] }),
      row({ productCode: 'BIKE', result: 'NOT_OFFERED', reasons: ['DISABLED_LEGAL_GATE'], ruleVersion: null }),
    ];
    const parsed = DriverComplianceSchema.parse({ ...base, productEligibility: rows });
    expect(parsed.productEligibility?.map((p) => p.result)).toEqual(['ELIGIBLE', 'UNKNOWN', 'NOT_ELIGIBLE', 'NOT_OFFERED']);
    expect([...PRODUCT_ELIGIBILITY_RESULTS].sort()).toEqual(['ELIGIBLE', 'NOT_ELIGIBLE', 'NOT_OFFERED', 'UNKNOWN']);
  });

  it('reasons and missing attributes are open code lists; the known codes all fit them', () => {
    expect(
      DriverComplianceSchema.safeParse({ ...base, productEligibility: [row({ result: 'NOT_ELIGIBLE', reasons: [...PRODUCT_ELIGIBILITY_REASONS] })] }).success,
    ).toBe(true);
    expect(
      DriverComplianceSchema.safeParse({
        ...base,
        productEligibility: [row({ result: 'UNKNOWN', missingAttributes: [...PRODUCT_ELIGIBILITY_MISSING_ATTRIBUTES] })],
      }).success,
    ).toBe(true);
    expect(DriverComplianceSchema.safeParse({ ...base, productEligibility: [row({ reasons: ['A_LATER_REASON'] })] }).success).toBe(true);
  });

  it('refuses malformed rows (unknown result, bad ids/codes, non-integer version)', () => {
    for (const bad of [
      row({ result: 'MAYBE' }),
      row({ vehicleId: 'not-a-uuid' }),
      row({ productCode: 'economy' }),
      row({ reasons: ['lower case'] }),
      row({ ruleVersion: 1.5 }),
      row({ ruleVersion: 0 }),
    ])
      expect(DriverComplianceSchema.safeParse({ ...base, productEligibility: [bad] }).success, JSON.stringify(bad)).toBe(false);
  });

  it('is published in the OpenAPI document as an optional property of DriverCompliance', () => {
    const json = JSON.stringify(buildOpenApiDocument('1.0.0'));
    expect(json).toContain('productEligibility');
    expect(json).toContain('NOT_OFFERED');
  });
});
