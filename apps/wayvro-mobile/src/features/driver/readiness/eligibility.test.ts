import { describe, expect, it } from 'vitest';
import { compliance, DRIVER_IDS } from '../../../__mocks__/driver-fixtures';
import { eligibilityModel, eligibilitySummary } from './eligibility';

const OTHER_VEHICLE = '0190b000-0000-7000-8000-0000000000f1';
type Row = NonNullable<ReturnType<typeof compliance>['productEligibility']>[number];
const row = (overrides: Partial<Row>): Row => ({
  vehicleId: DRIVER_IDS.vehicle,
  productCode: 'ECONOMY',
  result: 'ELIGIBLE',
  reasons: [],
  missingAttributes: [],
  ruleVersion: 1,
  ...overrides,
});

describe('/drive/eligibility view model — server results only (display, never authorisation)', () => {
  it('groups the server rows per vehicle (server order kept) with marks, result copy and plain reasons', () => {
    const c = compliance({
      productEligibility: [
        row({}),
        row({ productCode: 'COMFORT', result: 'UNKNOWN', missingAttributes: ['seats', 'airConditioned'] }),
        row({ productCode: 'BIKE', result: 'NOT_OFFERED', reasons: ['DISABLED_LEGAL_GATE'], ruleVersion: null }),
        row({ vehicleId: OTHER_VEHICLE, result: 'NOT_ELIGIBLE', reasons: ['VEHICLE_TOO_OLD', 'SOMETHING_NEW'] }),
      ],
    });
    const model = eligibilityModel(c);
    if (model.kind !== 'vehicles') throw new Error(model.kind);
    expect(model.vehicles.map((v) => [v.vehicleId, v.category, v.cityCode, v.products.map((p) => p.productCode)])).toEqual([
      [DRIVER_IDS.vehicle, 'CAR', 'LHR', ['ECONOMY', 'COMFORT', 'BIKE']],
      // no earning row for this vehicle: its city still comes from the driver's city, its category is unknown
      [OTHER_VEHICLE, null, 'LHR', ['ECONOMY']],
    ]);
    const [economy, comfort, bike] = model.vehicles[0]?.products ?? [];
    expect(economy).toMatchObject({ mark: 'ok', resultKey: 'drive.eligibility.result.ELIGIBLE', reasons: [], missing: [] });
    expect(comfort).toMatchObject({
      mark: 'attention',
      resultKey: 'drive.eligibility.result.UNKNOWN',
      missing: [
        { code: 'seats', key: 'drive.eligibility.missing.seats' },
        { code: 'airConditioned', key: 'drive.eligibility.missing.airConditioned' },
      ],
    });
    expect(bike).toMatchObject({ mark: 'info', reasons: [{ code: 'DISABLED_LEGAL_GATE', key: 'drive.eligibility.reason.DISABLED_LEGAL_GATE' }] });
    expect(model.vehicles[1]?.products[0]).toMatchObject({
      mark: 'blocked',
      reasons: [
        { code: 'VEHICLE_TOO_OLD', key: 'drive.eligibility.reason.VEHICLE_TOO_OLD' },
        { code: 'SOMETHING_NEW', key: null },
      ],
    });
  });

  it('older server without the field ⇒ unavailable (no invented results); no rows ⇒ no vehicle', () => {
    expect(eligibilityModel(compliance())).toEqual({ kind: 'unavailable' });
    expect(eligibilitySummary(compliance())).toEqual({ kind: 'unavailable' });
    expect(eligibilityModel(compliance({ productEligibility: [] }))).toEqual({ kind: 'no-vehicle' });
    expect(eligibilitySummary(compliance({ productEligibility: [] }))).toEqual({ kind: 'no-vehicle' });
  });

  it('without any known city the legal-gate reason is shown by reference, never with a blank city', () => {
    const model = eligibilityModel(
      compliance({
        eligibility: [],
        productEligibility: [row({ productCode: 'BIKE', result: 'NOT_OFFERED', reasons: ['DISABLED_LEGAL_GATE'], ruleVersion: null })],
      }),
    );
    if (model.kind !== 'vehicles') throw new Error(model.kind);
    expect(model.vehicles[0]?.products[0]?.reasons).toEqual([{ code: 'DISABLED_LEGAL_GATE', key: null }]);
  });

  it('summary counts distinct eligible products over all vehicles, then products needing details', () => {
    const rows = [row({}), row({ vehicleId: OTHER_VEHICLE }), row({ productCode: 'COMFORT', result: 'UNKNOWN', missingAttributes: ['seats'] })];
    expect(eligibilitySummary(compliance({ productEligibility: rows }))).toEqual({ kind: 'eligible', count: 1 });
    expect(eligibilitySummary(compliance({ productEligibility: rows.slice(2) }))).toEqual({ kind: 'missing', count: 1 });
    expect(eligibilitySummary(compliance({ productEligibility: [row({ result: 'NOT_OFFERED', reasons: ['NOT_ENABLED_IN_CITY'] })] }))).toEqual({
      kind: 'not-eligible',
    });
  });
});
