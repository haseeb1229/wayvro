import { describe, expect, it } from 'vitest';
import { compliance, DRIVER_IDS } from '../../../__mocks__/driver-fixtures';
import { p3Account } from '../../../__mocks__/p3-fixtures';
import { DRIVER_CATALOGUE } from '../i18n/driver-strings';
import { markGlyph, markKey } from './marks';
import { readinessModel } from './readiness';

type ProductRow = NonNullable<ReturnType<typeof compliance>['productEligibility']>[number];
const product = (productCode: string, result: ProductRow['result']): ProductRow => ({
  vehicleId: DRIVER_IDS.vehicle,
  productCode,
  result,
  reasons: result === 'NOT_OFFERED' ? ['DISABLED_LEGAL_GATE'] : result === 'NOT_ELIGIBLE' ? ['VEHICLE_TOO_OLD'] : [],
  missingAttributes: result === 'UNKNOWN' ? ['seats'] : [],
  ruleVersion: result === 'NOT_OFFERED' ? null : 1,
});

describe('Driver/Partner readiness shell (/drive) — server data only, no "Go online"', () => {
  it('lists profile, documents, eligibility, restrictions and location (read-only) in that order', () => {
    const model = readinessModel(p3Account('B'), compliance(), 'not-yet');
    expect(model.rows.map((r) => r.id)).toEqual(['profile', 'documents', 'eligibility', 'restrictions', 'location']);
    expect(model.partial).toBe(false);
    expect(model.accountRestricted).toBe(false);
  });

  it('expired documents block and link to the renewal of the first expired document; due ones need attention', () => {
    const expired = readinessModel(p3Account('G'), compliance(), 'allowed').rows.find((r) => r.id === 'documents');
    expect(expired).toMatchObject({
      mark: 'blocked',
      key: 'drive.row.documentsExpired',
      count: 1,
      target: { kind: 'renewal', documentId: DRIVER_IDS.licenceDoc },
    });
    const base = compliance();
    const due = compliance({
      documents: base.documents.map((d) => (d.id === DRIVER_IDS.licenceDoc ? { ...d, status: 'VALID' as const, renewalDue: true } : d)),
    });
    expect(readinessModel(p3Account('B'), due, 'allowed').rows.find((r) => r.id === 'documents')).toMatchObject({
      mark: 'attention',
      key: 'drive.row.documentsDue',
      count: 1,
    });
    const valid = compliance({ documents: base.documents.filter((d) => d.id !== DRIVER_IDS.licenceDoc) });
    expect(readinessModel(p3Account('B'), valid, 'allowed').rows.find((r) => r.id === 'documents')).toMatchObject({
      mark: 'ok',
      key: 'drive.row.documentsValid',
      target: { kind: 'compliance' },
    });
  });

  it('profile state comes from the server (compliance, else the account state); restrictions link to health', () => {
    expect(readinessModel(p3Account('B'), compliance(), 'allowed').rows[0]).toMatchObject({ mark: 'ok', stateKey: 'profileState.VERIFIED' });
    expect(readinessModel(p3Account('G'), null, 'allowed').rows[0]).toMatchObject({ mark: 'attention', stateKey: 'profileState.EXPIRED' });
    const restricted = readinessModel(p3Account('D'), compliance({ restrictions: [p3Account('D').restrictions[0]!] }), 'allowed');
    // K19 "suspended" = a DRIVER_ROLE restriction: earning paused
    expect(restricted.rows.find((r) => r.id === 'restrictions')).toMatchObject({
      mark: 'blocked',
      key: 'drive.row.earningPaused',
      count: 1,
      target: { kind: 'route', pathname: '/drive/health' },
    });
    expect(restricted.earningPaused).toBe(true);
    const vehicleOnly = compliance({ restrictions: [{ ...p3Account('D').restrictions[0]!, scope: 'VEHICLE' }] });
    expect(readinessModel(p3Account('B'), vehicleOnly, 'allowed').rows.find((r) => r.id === 'restrictions')).toMatchObject({
      mark: 'blocked',
      key: 'drive.row.restricted',
      count: 1,
    });
    expect(readinessModel(p3Account('B'), vehicleOnly, 'allowed').earningPaused).toBe(false);
    expect(readinessModel(p3Account('B'), compliance({ restrictions: [] }), 'allowed').rows.find((r) => r.id === 'restrictions')).toMatchObject({
      mark: 'ok',
      key: 'drive.row.noRestrictions',
    });
  });

  it('partial: without compliance the documents row says it could not load (nothing guessed); restrictions fall back to the account', () => {
    const model = readinessModel(p3Account('D'), null, 'unknown');
    expect(model.partial).toBe(true);
    expect(model.rows.find((r) => r.id === 'documents')).toMatchObject({ mark: 'info', key: 'drive.row.unavailable' });
    expect(model.rows.find((r) => r.id === 'restrictions')).toMatchObject({ count: 1 });
  });

  it('location is informational: allowed vs "asked when driving opens" — never a request', () => {
    expect(readinessModel(p3Account('B'), compliance(), 'allowed').rows.at(-1)).toMatchObject({
      key: 'drive.row.locationAllowed',
      target: { kind: 'route', pathname: '/drive/location' },
    });
    expect(readinessModel(p3Account('B'), compliance(), 'not-yet').rows.at(-1)).toMatchObject({ key: 'drive.row.locationLater' });
  });

  it('an account-wide restriction is called out (rider use is affected then)', () => {
    expect(readinessModel(p3Account('E'), compliance(), 'allowed').accountRestricted).toBe(true);
  });

  it('P3.8 eligibility row summarises the SERVER per-product results (never evaluated on the device)', () => {
    const row = (c: ReturnType<typeof compliance> | null) => readinessModel(p3Account('B'), c, 'allowed').rows.find((r) => r.id === 'eligibility');
    const target = { kind: 'route', pathname: '/drive/eligibility' };
    expect(row(compliance({ productEligibility: [product('ECONOMY', 'ELIGIBLE'), product('COMFORT', 'UNKNOWN'), product('BIKE', 'NOT_OFFERED')] }))).toEqual({
      id: 'eligibility',
      mark: 'ok',
      key: 'drive.row.eligibleProducts',
      count: 1,
      stateKey: null,
      target,
    });
    expect(row(compliance({ productEligibility: [product('COMFORT', 'UNKNOWN'), product('BIKE', 'NOT_OFFERED')] }))).toMatchObject({
      mark: 'attention',
      key: 'drive.row.eligibilityMissing',
      count: 1,
    });
    expect(row(compliance({ productEligibility: [product('ECONOMY', 'NOT_ELIGIBLE'), product('BIKE', 'NOT_OFFERED')] }))).toMatchObject({
      mark: 'blocked',
      key: 'drive.row.notEligible',
    });
    expect(row(compliance({ productEligibility: [] }))).toMatchObject({ mark: 'attention', key: 'drive.row.noVehicle' });
    // partial: compliance loaded without the field (older server), or not loaded at all — documents still shown
    expect(row(compliance())).toMatchObject({ mark: 'info', key: 'drive.row.eligibilityUnavailable' });
    expect(row(null)).toMatchObject({ mark: 'info', key: 'drive.row.eligibilityUnavailable' });
    expect(readinessModel(p3Account('B'), compliance(), 'allowed').rows.find((r) => r.id === 'documents')?.key).toBe('drive.row.documentsExpired');
  });

  it('headline: "ready for when driving opens" only when every row is decided and fine; never claims readiness while unknown', () => {
    const fine = compliance({
      restrictions: [],
      documents: compliance().documents.filter((d) => d.status === 'VALID' && !d.renewalDue),
      productEligibility: [product('ECONOMY', 'ELIGIBLE')],
    });
    expect(readinessModel(p3Account('B'), fine, 'not-yet').headline).toBe('ready');
    expect(readinessModel(p3Account('B'), { ...fine, productEligibility: undefined }, 'not-yet').headline).toBe('unknown');
    expect(readinessModel(p3Account('B'), null, 'not-yet').headline).toBe('unknown');
    expect(readinessModel(p3Account('B'), compliance(), 'not-yet').headline).toBe('attention');
    expect(readinessModel(p3Account('E'), { ...fine, restrictions: p3Account('E').restrictions }, 'not-yet').headline).toBe('attention');
  });

  it('status marks have text labels (never colour or glyph alone), and the copy promises no driving date', () => {
    for (const mark of ['ok', 'attention', 'blocked', 'info'] as const) {
      expect(DRIVER_CATALOGUE.en[markKey(mark)].length).toBeGreaterThan(2);
      expect(markGlyph(mark)).not.toBe('');
    }
    for (const locale of ['en', 'ur', 'ur-Latn'] as const)
      for (const [key, value] of Object.entries(DRIVER_CATALOGUE[locale]))
        if (key.startsWith('drive.')) expect(/\b20[2-9][0-9]\b|go online now/i.test(value), `${locale}:${key}`).toBe(false);
  });
});
