/**
 * Phase 3 staff request contracts: the cross-field rules (`refine`) each accept a valid body and refuse the invalid
 * one, so a malformed configuration is a 400 at the edge before any service logic (catalog eligibility rules, geo
 * budgets, tax policies, rate-card values, pricing previews, support quote lookups).
 */
import { describe, expect, it } from 'vitest';
import { EligibilityRuleDraftRequestSchema } from './catalog.js';
import { GeoBudgetDraftRequestSchema } from './geo.js';
import { PricingPreviewRequestSchema, QuoteLookupRequestSchema, RateCardValuesSchema, TaxPolicyDraftRequestSchema } from './pricing.js';

const UUID_A = '0192f3c4-0000-7000-8000-00000000000a';
const UUID_B = '0192f3c4-0000-7000-8000-00000000000b';

describe('catalog eligibility rule draft', () => {
  const rule = {
    cityCode: 'LHR',
    productCode: 'COMFORT',
    sourceReference: 'SYNTHETIC — test rule',
    minModelYear: 2015,
    maxVehicleAgeYears: null,
    minSeats: 4,
    acRequired: true,
    allowedBodyTypes: ['SEDAN', 'SUV'],
  };
  it('accepts a rule with one age criterion and distinct body types', () => {
    expect(EligibilityRuleDraftRequestSchema.safeParse(rule).success).toBe(true);
  });
  it('refuses both age criteria at once and repeated body types', () => {
    expect(EligibilityRuleDraftRequestSchema.safeParse({ ...rule, maxVehicleAgeYears: 10 }).success).toBe(false);
    expect(EligibilityRuleDraftRequestSchema.safeParse({ ...rule, allowedBodyTypes: ['SEDAN', 'SEDAN'] }).success).toBe(false);
  });
});

describe('geo budget draft', () => {
  const budget = { providerKey: 'geo-mock', sku: 'ROUTE', dailyCalls: 100, monthlyCalls: 1000, monthlyCostMicroUsd: 0 };
  it('accepts daily ≤ monthly and refuses daily > monthly', () => {
    expect(GeoBudgetDraftRequestSchema.safeParse(budget).success).toBe(true);
    expect(GeoBudgetDraftRequestSchema.safeParse({ ...budget, dailyCalls: 1001 }).success).toBe(false);
  });
});

describe('pricing staff requests', () => {
  const tax = { code: 'SYNTH-TAX-0', jurisdictionCode: 'PK-PB', rateBp: 0, appliesTo: ['BASE', 'DISTANCE'], inclusive: false, isPlaceholder: true };
  it('tax policy: a placeholder needs no legal reference; a real one does; appliesTo must not repeat', () => {
    expect(TaxPolicyDraftRequestSchema.safeParse(tax).success).toBe(true);
    expect(TaxPolicyDraftRequestSchema.safeParse({ ...tax, isPlaceholder: false }).success).toBe(false);
    expect(TaxPolicyDraftRequestSchema.safeParse({ ...tax, isPlaceholder: false, legalReference: 'counsel memo 1' }).success).toBe(true);
    expect(TaxPolicyDraftRequestSchema.safeParse({ ...tax, appliesTo: ['BASE', 'BASE'] }).success).toBe(false);
    // the minimum top-up is taxable only together with BASE, DISTANCE and TIME (monotonic totals)
    expect(TaxPolicyDraftRequestSchema.safeParse({ ...tax, appliesTo: ['MINIMUM_ADJUSTMENT'] }).success).toBe(false);
    expect(TaxPolicyDraftRequestSchema.safeParse({ ...tax, appliesTo: ['BASE', 'DISTANCE', 'TIME', 'MINIMUM_ADJUSTMENT'] }).success).toBe(true);
  });

  const values = {
    baseMinor: '10000',
    perKmMinor: '3500',
    perMinMinor: '500',
    minimumFareMinor: '25000',
    bookingFeeMinor: '1000',
    airportPickupFeeMinor: '20000',
    roundingStepMinor: '1000',
    roundingMode: 'HALF_UP',
    tollPolicy: 'EXCLUDED_DISCLOSED',
    taxPolicyId: UUID_A,
    quoteTtlSeconds: 300,
    maxDistanceM: 60000,
    maxDurationS: 7200,
  };
  it('rate-card values: the minimum fare must be a multiple of a rounding step ≤ 10000', () => {
    expect(RateCardValuesSchema.safeParse(values).success).toBe(true);
    expect(RateCardValuesSchema.safeParse({ ...values, minimumFareMinor: '25500' }).success).toBe(false);
    expect(RateCardValuesSchema.safeParse({ ...values, roundingStepMinor: '20000', minimumFareMinor: '20000' }).success).toBe(false);
  });

  it('preview: distinct rate cards only', () => {
    expect(PricingPreviewRequestSchema.safeParse({ rateCardIds: [UUID_A, UUID_B] }).success).toBe(true);
    expect(PricingPreviewRequestSchema.safeParse({ rateCardIds: [UUID_A, UUID_A] }).success).toBe(false);
  });

  it('support quote lookup: exactly one of quoteId / quoteGroupId, with a closed access reason', () => {
    expect(QuoteLookupRequestSchema.safeParse({ quoteId: UUID_A, reasonCode: 'FARE_DISPUTE' }).success).toBe(true);
    expect(QuoteLookupRequestSchema.safeParse({ quoteGroupId: UUID_A, reasonCode: 'FARE_DISPUTE' }).success).toBe(true);
    expect(QuoteLookupRequestSchema.safeParse({ quoteId: UUID_A, quoteGroupId: UUID_B, reasonCode: 'FARE_DISPUTE' }).success).toBe(false);
    expect(QuoteLookupRequestSchema.safeParse({ reasonCode: 'FARE_DISPUTE' }).success).toBe(false);
    expect(QuoteLookupRequestSchema.safeParse({ quoteId: UUID_A, reasonCode: 'CURIOSITY' }).success).toBe(false);
  });
});
