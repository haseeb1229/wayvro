/**
 * P3.1 staff catalog administration against real PostgreSQL + PostGIS as the restricted API role (E08/H10/R28;
 * T3-14/T3-15/T3-29/T3-31): zone-set maker-checker (GeoJSON import + validation report, service hours, submit,
 * approve by a DIFFERENT CATALOG_MANAGER, activate/retire, clone-as-rollback), eligibility rules, city-product
 * ENABLE/SUSPEND (fail closed without a rate-card source; full flow with a test RateCardPresence), maker = checker
 * refused by the service (audited) and the database, legal-gate refusals, production refusal of synthetic
 * configuration, and concurrent activations leaving exactly one ACTIVE. Synthetic geometry only.
 */
import { randomUUID } from 'node:crypto';
import { CityProductListSchema, EligibilityRuleSchema, ZoneImportResultSchema, ZoneSetSchema } from '@wayvro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routePolicyOf } from '../src/auth/policy.js';
import { CatalogAdminService, cityProductObjectId, type RateCardPresence } from '../src/catalog/catalog-admin.service.js';
import { CatalogAdminController } from '../src/catalog/catalog.controller.js';
import { IdempotencyStore, type IdempotentResult } from '../src/platform/idempotency.js';
import type { StaffPrincipal } from '../src/staff/staff-session.js';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, key, post, signIn, startApi, type Harness } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let maker: Staff;
let checker: Staff;
let auditor: Staff;
let pricing: Staff;

type Position = [number, number];
const ring = (x0: number, y0: number, x1: number, y1: number): Position[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];
const poly = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'Polygon', coordinates: [ring(x0, y0, x1, y1)] });
const feature = (geometry: unknown, properties: Record<string, unknown> | null) => ({ type: 'Feature', geometry, properties });
const zoneProps = (code: string, kind: string, extra: Record<string, unknown> = {}) => ({
  code,
  kind,
  nameEn: `Synthetic ${code}`,
  nameUr: 'مصنوعی',
  ...extra,
});
const pointProps = (zoneCode: string, kind: string, nameEn: string) => ({ zoneCode, kind, nameEn, nameUr: 'مصنوعی', instructionKey: 'pickup.synthetic.gate' });
const VALID = {
  type: 'FeatureCollection',
  features: [
    feature(poly(74.2, 31.4, 74.5, 31.65), zoneProps('SVC', 'SERVICE_AREA')),
    feature(poly(74.3, 31.575, 74.32, 31.59), zoneProps('EXC', 'EXCLUSION')),
    feature(poly(74.33, 31.509, 74.338, 31.517), zoneProps('VENUE', 'PICKUP_RESTRICTED', { products: ['ECONOMY'] })),
    feature({ type: 'MultiPolygon', coordinates: [[ring(74.398, 31.515, 74.412, 31.527)]] }, zoneProps('AIRPORT', 'AIRPORT_PRECINCT')),
    feature({ type: 'Point', coordinates: [74.331, 31.51] }, pointProps('VENUE', 'DESIGNATED', 'Gate A')),
    feature({ type: 'Point', coordinates: [74.405, 31.52] }, pointProps('AIRPORT', 'AIRPORT', 'Arrivals')),
  ],
};
const HOURS = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ productCode: null, weekday, opensLocal: '06:00', closesLocal: '23:00' })) };
const errorOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string; details?: { reasonCodes?: string[] } } }).error;

const send = (s: Staff, url: string, body: unknown) => h.inject(post(url, body, kit.sb(s)));
const stepped = (s: Staff, url: string, body: unknown) => kit.privileged(s, url, body);

/** Drafts, imports, sets hours, submits and (by the checker) approves a zone set; returns its id. */
async function approvedZoneSet(cityCode = 'LHR', fc: unknown = VALID, synthetic = true): Promise<string> {
  const draft = await send(maker, '/v1/admin/catalog/zone-sets', {
    cityCode,
    sourceReference: 'SYNTHETIC — not real Lahore boundaries',
    isSynthetic: synthetic,
  });
  expect(draft.statusCode, draft.body).toBe(201);
  const id = ZoneSetSchema.parse(draft.json()).id;
  const imported = ZoneImportResultSchema.parse((await send(maker, `/v1/admin/catalog/zone-sets/${id}/zone-imports`, { featureCollection: fc })).json());
  expect(imported.applied, JSON.stringify(imported.issues)).toBe(true);
  expect((await send(maker, `/v1/admin/catalog/zone-sets/${id}/service-hours`, HOURS)).statusCode).toBe(200);
  expect((await send(maker, `/v1/admin/catalog/zone-sets/${id}/submission`, {})).statusCode).toBe(200);
  const approved = await stepped(checker, `/v1/admin/catalog/zone-sets/${id}/approval`, { decision: 'APPROVE', reasonCode: 'GEOMETRY_REVIEWED' });
  expect(approved.statusCode, approved.body).toBe(200);
  return id;
}
async function approvedRule(productCode = 'ECONOMY', cityCode = 'LHR'): Promise<string> {
  const draft = await send(maker, '/v1/admin/catalog/eligibility-rules', {
    cityCode,
    productCode,
    sourceReference: 'SYNTHETIC — not a Punjab/Lahore regulatory value',
    isSynthetic: true,
    minModelYear: null,
    maxVehicleAgeYears: 15,
    minSeats: 4,
    acRequired: false,
    allowedBodyTypes: [],
  });
  expect(draft.statusCode, draft.body).toBe(201);
  const id = EligibilityRuleSchema.parse(draft.json()).id;
  expect((await send(maker, `/v1/admin/catalog/eligibility-rules/${id}/submission`, {})).statusCode).toBe(200);
  expect((await stepped(checker, `/v1/admin/catalog/eligibility-rules/${id}/approval`, { decision: 'APPROVE' })).statusCode).toBe(200);
  return id;
}
const principal = (s: Staff): StaffPrincipal => ({
  staffId: s.staffId,
  sessionId: randomUUID(),
  sessionStatus: 'ACTIVE',
  displayName: 'Synthetic',
  consumerAccountId: null,
  assignments: [],
  permissions: new Set(),
  stepUpAt: new Date(),
  activeCredentials: 1,
  breakGlassId: null,
  absoluteExpiresAt: new Date(Date.now() + 3_600_000),
});
const outcome = (r: IdempotentResult) => r.outcome;
const service = (env: 'test' | 'production', rateCards: RateCardPresence | null) =>
  new CatalogAdminService(
    h.runtime.db.pool,
    new IdempotencyStore(h.runtime.db.pool, h.runtime.cipher),
    { WAYVRO_ENV: env, IDEMPOTENCY_TTL_SECONDS: 3600 },
    rateCards,
  );

beforeAll(async () => {
  h = await startApi({ env: STAFF_ENV });
  kit = staffKit(h);
  const admins = await kit.bootstrapAdmins(2);
  maker = await kit.staffWithRole(admins, 'CATALOG_MANAGER', 'Catalog Maker');
  checker = await kit.staffWithRole(admins, 'CATALOG_MANAGER', 'Catalog Checker');
  auditor = await kit.staffWithRole(admins, 'AUDITOR', 'Catalog Auditor');
  pricing = await kit.staffWithRole(admins, 'PRICING_MANAGER', 'Pricing Viewer');
}, 120_000);
afterAll(async () => {
  await h.close();
});

describe('route policies', () => {
  it('approve/activate/retire/enable/suspend routes require a fresh step-up; drafting routes need the draft permission only', () => {
    const proto = CatalogAdminController.prototype as unknown as Record<string, unknown>;
    const policies = Object.getOwnPropertyNames(proto)
      .filter((n) => n !== 'constructor')
      .map((n) => ({ name: n, policy: routePolicyOf(proto[n]) }));
    const stepUp = policies.filter((p) => p.policy?.kind === 'staff-session' && p.policy.stepUp).map((p) => p.name);
    expect(stepUp.sort()).toEqual(
      ['activateRule', 'activateZoneSet', 'decideEnable', 'decideRule', 'decideZoneSet', 'requestEnable', 'retireRule', 'retireZoneSet', 'suspend'].sort(),
    );
    expect(policies.every((p) => p.policy?.kind === 'staff-session' && p.policy.permission?.startsWith('catalog.'))).toBe(true);
  });
});

describe('zone sets: maker-checker lifecycle (E08)', () => {
  it('draft -> import -> hours -> submit -> approve by a different manager -> activate; immutable after DRAFT; audited; outbox event', async () => {
    const draft = await send(maker, '/v1/admin/catalog/zone-sets', {
      cityCode: 'LHR',
      sourceReference: 'SYNTHETIC — not real Lahore boundaries',
      isSynthetic: true,
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const set = ZoneSetSchema.parse(draft.json());
    expect(set).toMatchObject({ status: 'DRAFT', isSynthetic: true, draftedByStaffId: maker.staffId, zones: [], zoneCount: 0 });
    const imported = ZoneImportResultSchema.parse(
      (await send(maker, `/v1/admin/catalog/zone-sets/${set.id}/zone-imports`, { featureCollection: VALID })).json(),
    );
    expect(imported).toMatchObject({ applied: true, issues: [], zoneCount: 4, pickupPointCount: 2 });
    expect(imported.zoneSet.zones.map((z) => [z.code, z.kind, z.polygonCount, z.products])).toEqual([
      ['AIRPORT', 'AIRPORT_PRECINCT', 1, []],
      ['EXC', 'EXCLUSION', 1, []],
      ['SVC', 'SERVICE_AREA', 1, []],
      ['VENUE', 'PICKUP_RESTRICTED', 1, ['ECONOMY']],
    ]);
    expect(imported.zoneSet.zones.find((z) => z.code === 'SVC')).toMatchObject({
      vertexCount: 5,
      bbox: { minLat: 31.4, minLng: 74.2, maxLat: 31.65, maxLng: 74.5 },
    });
    // GEOM-03 through the import: a GeoJSON Polygon is stored as a one-part MultiPolygon
    expect((await h.owner.query(`select distinct GeometryType(geom) t from catalog.zones where zone_set_id = $1`, [set.id])).rows).toEqual([
      { t: 'MULTIPOLYGON' },
    ]);
    // overlapping windows are refused; then the real hours
    const overlap = await send(maker, `/v1/admin/catalog/zone-sets/${set.id}/service-hours`, {
      hours: [
        { productCode: null, weekday: 1, opensLocal: '06:00', closesLocal: '12:00' },
        { productCode: null, weekday: 1, opensLocal: '11:00', closesLocal: '23:00' },
      ],
    });
    expect(errorOf(overlap)).toMatchObject({ code: 'WAYVRO_E_VALIDATION', details: { reasonCodes: ['SERVICE_HOURS_OVERLAP'] } });
    expect(
      (
        await send(maker, `/v1/admin/catalog/zone-sets/${set.id}/service-hours`, {
          hours: [{ productCode: null, weekday: 1, opensLocal: '06:00', closesLocal: '24:00' }],
        })
      ).statusCode,
    ).toBe(200);
    const withHours = ZoneSetSchema.parse((await send(maker, `/v1/admin/catalog/zone-sets/${set.id}/service-hours`, HOURS)).json());
    expect(withHours.serviceHours).toHaveLength(7);
    expect(withHours.serviceHours[0]).toEqual({ productCode: null, weekday: 0, opensLocal: '06:00', closesLocal: '23:00' });
    expect((await send(maker, `/v1/admin/catalog/zone-sets/${set.id}/submission`, {})).json()).toMatchObject({ status: 'PENDING_APPROVAL' });
    // immutable after DRAFT
    expect((await send(maker, `/v1/admin/catalog/zone-sets/${set.id}/zone-imports`, { featureCollection: VALID })).statusCode).toBe(409);
    expect((await send(maker, `/v1/admin/catalog/zone-sets/${set.id}/service-hours`, HOURS)).statusCode).toBe(409);
    // maker = checker: refused by the service (403, audited)
    const self = await stepped(maker, `/v1/admin/catalog/zone-sets/${set.id}/approval`, { decision: 'APPROVE' });
    expect(errorOf(self)).toMatchObject({ code: 'WAYVRO_E_FORBIDDEN', details: { reasonCodes: ['MAKER_IS_CHECKER'] } });
    expect(
      (
        await h.owner.query(
          `select 1 from audit.audit_events where action = 'STAFF_ACCESS_DENIED' and object_id = $1 and reason_code = 'MAKER_IS_CHECKER' and actor_id = $2`,
          [set.id, maker.staffId],
        )
      ).rowCount,
    ).toBe(1);
    const approved = await stepped(checker, `/v1/admin/catalog/zone-sets/${set.id}/approval`, { decision: 'APPROVE', reasonCode: 'GEOMETRY_REVIEWED' });
    expect(approved.json()).toMatchObject({ status: 'APPROVED', approvedByStaffId: checker.staffId, approvalReasonCode: 'GEOMETRY_REVIEWED' });
    const active = await stepped(maker, `/v1/admin/catalog/zone-sets/${set.id}/activation`, {});
    expect(active.statusCode, active.body).toBe(200);
    expect(active.json()).toMatchObject({ status: 'ACTIVE' });
    expect(
      (await h.owner.query(`select payload from platform.outbox_events where type = 'catalog.zone-set.activated.v1' and aggregate_id = $1`, [set.id])).rows[0]
        ?.payload,
    ).toMatchObject({ cityCode: 'LHR', version: set.version });
    const actions = await h.owner.query<{ action: string }>(
      `select action from audit.audit_events where object_id = $1 and object_type = 'catalog.zone_set' and outcome = 'SUCCESS' order by seq`,
      [set.id],
    );
    expect(actions.rows.map((r) => r.action)).toEqual([
      'ZONE_SET_DRAFTED',
      'ZONE_SET_ZONES_IMPORTED',
      'ZONE_SET_HOURS_REPLACED',
      'ZONE_SET_HOURS_REPLACED',
      'ZONE_SET_SUBMITTED',
      'ZONE_SET_APPROVED',
      'ZONE_SET_ACTIVATED',
    ]);
    // views: AUDITOR and PRICING_MANAGER read; neither drafts
    expect((await h.inject({ method: 'GET', url: `/v1/admin/catalog/zone-sets/${set.id}`, headers: kit.sb(auditor) })).statusCode).toBe(200);
    expect((await h.inject({ method: 'GET', url: '/v1/admin/catalog/zone-sets?cityCode=LHR', headers: kit.sb(pricing) })).statusCode).toBe(200);
    expect((await send(auditor, '/v1/admin/catalog/zone-sets', { cityCode: 'LHR', sourceReference: 'x-src' })).statusCode).toBe(403);
    expect((await send(pricing, '/v1/admin/catalog/zone-sets', { cityCode: 'LHR', sourceReference: 'x-src' })).statusCode).toBe(403);
    // consumers and anonymous callers never reach staff routes
    const consumer = await signIn(h);
    expect((await h.inject({ method: 'GET', url: '/v1/admin/catalog/zone-sets', headers: bearer(consumer.accessToken) })).statusCode).toBe(401);
    expect((await h.inject({ method: 'GET', url: '/v1/admin/catalog/zone-sets' })).statusCode).toBe(401);
  });

  it('rollback: a clone of an earlier version becomes a new DRAFT (supersedes_id) and, once approved and activated, retires the current set', async () => {
    const current = (await h.owner.query<{ id: string }>(`select id from catalog.zone_sets where city_code = 'LHR' and status = 'ACTIVE'`)).rows[0]?.id;
    if (!current) throw new Error('no active set');
    const clone = await send(maker, `/v1/admin/catalog/zone-sets/${current}/clones`, {});
    expect(clone.statusCode, clone.body).toBe(201);
    const c = ZoneSetSchema.parse(clone.json());
    expect(c).toMatchObject({ status: 'DRAFT', supersedesId: current, zoneCount: 4, isSynthetic: true });
    expect(c.pickupPoints).toHaveLength(2);
    expect(c.serviceHours).toHaveLength(7);
    expect((await send(maker, `/v1/admin/catalog/zone-sets/${c.id}/submission`, {})).statusCode).toBe(200);
    expect((await stepped(checker, `/v1/admin/catalog/zone-sets/${c.id}/approval`, { decision: 'APPROVE' })).statusCode).toBe(200);
    expect((await stepped(checker, `/v1/admin/catalog/zone-sets/${c.id}/activation`, {})).json()).toMatchObject({ status: 'ACTIVE' });
    expect((await h.inject({ method: 'GET', url: `/v1/admin/catalog/zone-sets/${current}`, headers: kit.sb(maker) })).json()).toMatchObject({
      status: 'RETIRED',
    });
    // a DRAFT or rejected version cannot be cloned; a rejected version stays REJECTED
    const rejected = await send(maker, '/v1/admin/catalog/zone-sets', { cityCode: 'LHR', sourceReference: 'SYNTHETIC rejected draft', isSynthetic: true });
    const rid = ZoneSetSchema.parse(rejected.json()).id;
    expect((await send(maker, `/v1/admin/catalog/zone-sets/${rid}/clones`, {})).statusCode).toBe(409);
    expect(errorOf(await send(maker, `/v1/admin/catalog/zone-sets/${rid}/submission`, {}))).toMatchObject({
      code: 'WAYVRO_E_CONFLICT',
      details: { reasonCodes: ['NO_SERVICE_AREA'] },
    });
    await send(maker, `/v1/admin/catalog/zone-sets/${rid}/zone-imports`, { featureCollection: VALID });
    await send(maker, `/v1/admin/catalog/zone-sets/${rid}/submission`, {});
    expect((await stepped(checker, `/v1/admin/catalog/zone-sets/${rid}/approval`, { decision: 'REJECT', reasonCode: 'GEOMETRY_WRONG' })).json()).toMatchObject({
      status: 'REJECTED',
      approvedByStaffId: null,
      approvalReasonCode: 'GEOMETRY_WRONG',
    });
    expect((await stepped(checker, `/v1/admin/catalog/zone-sets/${rid}/activation`, {})).statusCode).toBe(409);
  });

  it('activation refuses a set that leaves an ENABLED product without service hours', async () => {
    await h.owner.query(
      `update catalog.city_service_products set status = 'ENABLED', legal_basis_ref = 'SYNTHETIC_LOCAL_TEST_ONLY', is_synthetic = true where city_code = 'LHR' and product_code = 'ECONOMY'`,
    );
    try {
      const draft = await send(maker, '/v1/admin/catalog/zone-sets', { cityCode: 'LHR', sourceReference: 'SYNTHETIC no hours', isSynthetic: true });
      const id = ZoneSetSchema.parse(draft.json()).id;
      await send(maker, `/v1/admin/catalog/zone-sets/${id}/zone-imports`, { featureCollection: VALID });
      await send(maker, `/v1/admin/catalog/zone-sets/${id}/service-hours`, {
        hours: [{ productCode: 'COMFORT', weekday: 1, opensLocal: '06:00', closesLocal: '23:00' }],
      });
      await send(maker, `/v1/admin/catalog/zone-sets/${id}/submission`, {});
      await stepped(checker, `/v1/admin/catalog/zone-sets/${id}/approval`, { decision: 'APPROVE' });
      const refused = await stepped(maker, `/v1/admin/catalog/zone-sets/${id}/activation`, {});
      expect(errorOf(refused)).toMatchObject({ code: 'WAYVRO_E_CONFLICT', details: { reasonCodes: ['ENABLED_PRODUCT_WITHOUT_HOURS'] } });
      expect((await h.owner.query(`select 1 from audit.audit_events where action = 'CATALOG_ACTIVATION_REFUSED' and object_id = $1`, [id])).rowCount).toBe(1);
      // retiring an approved version that will never be used
      expect((await stepped(maker, `/v1/admin/catalog/zone-sets/${id}/retirement`, {})).json()).toMatchObject({ status: 'RETIRED', effectiveUntil: null });
    } finally {
      await h.owner.query(
        `update catalog.city_service_products set status = 'NOT_CONFIGURED', legal_basis_ref = null, is_synthetic = false where city_code = 'LHR' and product_code = 'ECONOMY'`,
      );
    }
  });

  it('CONC: two concurrent activations of different approved versions leave exactly one ACTIVE; concurrent drafts get distinct versions', async () => {
    const [a, b] = [await approvedZoneSet(), await approvedZoneSet()];
    await kit.stepUp(maker);
    const activate = (id: string) => h.inject(post(`/v1/admin/catalog/zone-sets/${id}/activation`, {}, kit.sb(maker)));
    const results = await Promise.all([activate(a), activate(b)]);
    for (const r of results) expect([200, 409], r.body).toContain(r.statusCode);
    expect((await h.owner.query(`select count(*)::int n from catalog.zone_sets where city_code = 'LHR' and status = 'ACTIVE'`)).rows[0]).toEqual({ n: 1 });
    const drafts = await Promise.all(
      [1, 2, 3].map(() => send(maker, '/v1/admin/catalog/zone-sets', { cityCode: 'LHR', sourceReference: 'SYNTHETIC concurrent draft', isSynthetic: true })),
    );
    const versions = drafts.map((d) => ZoneSetSchema.parse(d.json()).version);
    expect(new Set(versions).size).toBe(3);
  });
});

describe('GeoJSON import validation report (T3-29: rejects rather than repairs)', () => {
  let draftId: string;
  beforeAll(async () => {
    draftId = ZoneSetSchema.parse(
      (await send(maker, '/v1/admin/catalog/zone-sets', { cityCode: 'LHR', sourceReference: 'SYNTHETIC validation draft', isSynthetic: true })).json(),
    ).id;
  });
  const importing = async (fc: unknown) => {
    const res = await send(maker, `/v1/admin/catalog/zone-sets/${draftId}/zone-imports`, { featureCollection: fc });
    expect(res.statusCode, res.body).toBe(200);
    return ZoneImportResultSchema.parse(res.json());
  };
  const svc = feature(poly(74.2, 31.4, 74.5, 31.65), zoneProps('SVC', 'SERVICE_AREA'));
  const fc = (...features: unknown[]) => ({ type: 'FeatureCollection', features });

  it('GEOM-05 swapped [lat, lng] is reported as AXIS_ORDER_SWAPPED and nothing is written', async () => {
    const swapped = feature({ type: 'Polygon', coordinates: [ring(31.4, 74.2, 31.65, 74.5)] }, zoneProps('SWAP', 'SERVICE_AREA'));
    const r = await importing(fc(swapped));
    expect(r.applied).toBe(false);
    expect(r.issues).toContainEqual({ featureIndex: 0, code: 'SWAP', issue: 'AXIS_ORDER_SWAPPED', detail: 'coordinates look like [latitude, longitude]' });
    expect(r.zoneCount).toBe(0);
    expect((await h.owner.query(`select count(*)::int n from catalog.zones where zone_set_id = $1`, [draftId])).rows[0]).toEqual({ n: 0 });
    expect(
      (await h.owner.query(`select 1 from audit.audit_events where action = 'ZONE_SET_IMPORT_REJECTED' and object_id = $1`, [draftId])).rowCount,
    ).toBeGreaterThan(0);
  });

  it('reports invalid geometry (PostGIS reason), envelope, SRID, structure, properties, products, codes and pickup-point placement', async () => {
    const r = await importing({
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'EPSG:3857' } },
      features: [
        feature(
          {
            type: 'Polygon',
            coordinates: [
              [
                [74.3, 31.5],
                [74.4, 31.6],
                [74.4, 31.5],
                [74.3, 31.6],
                [74.3, 31.5],
              ],
            ],
          },
          zoneProps('BOWTIE', 'SERVICE_AREA'),
        ),
        feature(poly(67.0, 24.8, 67.1, 24.9), zoneProps('KARACHI', 'SERVICE_AREA')),
        feature(poly(2.3, 48.8, 2.4, 48.9), zoneProps('PARIS', 'SERVICE_AREA')),
        feature(
          {
            type: 'LineString',
            coordinates: [
              [74.3, 31.5],
              [74.4, 31.6],
            ],
          },
          zoneProps('LINE', 'SERVICE_AREA'),
        ),
        feature(
          {
            type: 'Polygon',
            coordinates: [
              [
                [74.3, 31.5, 10],
                [74.4, 31.5, 10],
                [74.4, 31.6, 10],
                [74.3, 31.5, 10],
              ],
            ],
          },
          zoneProps('THREED', 'SERVICE_AREA'),
        ),
        feature(poly(74.3, 31.5, 74.31, 31.51), { code: 'bad code', kind: 'SERVICE_AREA', nameEn: 'x', nameUr: 'x' }),
        feature(poly(74.3, 31.5, 74.31, 31.51), zoneProps('PRODUCTS', 'SERVICE_AREA', { products: ['HELICOPTER'] })),
        svc,
        feature(poly(74.21, 31.41, 74.22, 31.42), zoneProps('SVC', 'EXCLUSION')),
        feature({ type: 'Point', coordinates: [74.45, 31.6] }, pointProps('NOWHERE', 'DESIGNATED', 'Lost')),
        feature({ type: 'Point', coordinates: [74.45, 31.6] }, pointProps('PRODUCTS', 'DESIGNATED', 'Outside')),
        feature({ type: 'Point', coordinates: [74.25, 31.45] }, pointProps('SVC', 'AIRPORT', 'Not an airport')),
        feature(null, null),
        feature(
          {
            type: 'Polygon',
            coordinates: [
              [
                [74.3, 31.5],
                [74.4, 31.5],
                [74.4, 31.6],
              ],
            ],
          },
          zoneProps('OPEN', 'SERVICE_AREA'),
        ),
      ],
    });
    expect(r.applied).toBe(false);
    const by = (issue: string) => r.issues.filter((i) => i.issue === issue).map((i) => i.featureIndex);
    expect(by('SRID_UNSUPPORTED')).toEqual([null]);
    expect(by('GEOMETRY_INVALID')).toEqual([0, 13]);
    expect(r.issues.find((i) => i.featureIndex === 0)?.detail).toMatch(/^Self-intersection/);
    expect(by('OUTSIDE_PAKISTAN_ENVELOPE')).toEqual([2]);
    expect(by('UNSUPPORTED_GEOMETRY')).toEqual([3]);
    expect(by('COORDINATES_INVALID')).toEqual([4]);
    expect(by('PROPERTIES_INVALID')).toEqual([5]);
    expect(by('UNKNOWN_PRODUCT')).toEqual([6]);
    expect(by('DUPLICATE_ZONE_CODE')).toEqual([8]);
    expect(by('PICKUP_POINT_ZONE_UNKNOWN')).toEqual([9, 10]);
    expect(by('AIRPORT_POINT_OUTSIDE_PRECINCT')).toEqual([11]);
    expect(by('FEATURE_INVALID')).toEqual([12]);
    // the Karachi rectangle is inside Pakistan: no envelope issue for it (cities are not enforced by the envelope)
    expect(r.issues.some((i) => i.featureIndex === 1)).toBe(false);
    expect((await h.owner.query(`select count(*)::int n from catalog.zones where zone_set_id = $1`, [draftId])).rows[0]).toEqual({ n: 0 });
  });

  it('a pickup point outside its zone and a collection without a service area are reported', async () => {
    const r = await importing(
      fc(
        feature(poly(74.33, 31.509, 74.338, 31.517), zoneProps('VENUE', 'PICKUP_RESTRICTED')),
        feature({ type: 'Point', coordinates: [74.4, 31.6] }, pointProps('VENUE', 'DESIGNATED', 'Far')),
      ),
    );
    expect(r.issues.map((i) => i.issue).sort()).toEqual(['NO_SERVICE_AREA', 'PICKUP_POINT_OUTSIDE_ZONE']);
    // the request schema itself refuses non-collections and empty collections (400)
    expect((await send(maker, `/v1/admin/catalog/zone-sets/${draftId}/zone-imports`, { featureCollection: { type: 'Feature' } })).statusCode).toBe(400);
    expect(
      (await send(maker, `/v1/admin/catalog/zone-sets/${draftId}/zone-imports`, { featureCollection: { type: 'FeatureCollection', features: [] } })).statusCode,
    ).toBe(400);
  });

  it('more than 20,000 vertices are reported as TOO_MANY_VERTICES (service level: the 64 KiB HTTP body limit stops such bodies earlier)', async () => {
    const n = 20_001;
    const coords: Position[] = Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / (n - 1);
      return [74.35 + 0.01 * Math.cos(a), 31.5 + 0.01 * Math.sin(a)];
    });
    coords[n - 1] = coords[0] as Position;
    const r = outcome(
      await service('test', null).importZones(
        principal(maker),
        draftId,
        { type: 'FeatureCollection', features: [feature({ type: 'Polygon', coordinates: [coords] }, zoneProps('HUGE', 'SERVICE_AREA'))] as never },
        key(),
      ),
    );
    expect(r.kind).toBe('success');
    if (r.kind !== 'success') return;
    expect((r.body as { issues: Array<{ issue: string }> }).issues.map((i) => i.issue)).toEqual(['TOO_MANY_VERTICES', 'NO_SERVICE_AREA']);
  });
});

describe('eligibility rules (H10)', () => {
  it('draft -> submit -> approve by a different manager -> activate -> clone/retire; validation and maker = checker refused', async () => {
    const both = await send(maker, '/v1/admin/catalog/eligibility-rules', {
      cityCode: 'LHR',
      productCode: 'ECONOMY',
      sourceReference: 'SYNTHETIC',
      minModelYear: 2015,
      maxVehicleAgeYears: 10,
      minSeats: null,
      acRequired: false,
      allowedBodyTypes: [],
    });
    expect(both.statusCode).toBe(400);
    expect(
      (
        await send(maker, '/v1/admin/catalog/eligibility-rules', {
          cityCode: 'LHR',
          productCode: 'NOPE',
          sourceReference: 'SYNTHETIC',
          minModelYear: null,
          maxVehicleAgeYears: 10,
          minSeats: null,
          acRequired: false,
          allowedBodyTypes: [],
        })
      ).statusCode,
    ).toBe(400);
    const draft = await send(maker, '/v1/admin/catalog/eligibility-rules', {
      cityCode: 'LHR',
      productCode: 'COMFORT',
      sourceReference: 'SYNTHETIC — not a Punjab/Lahore regulatory value',
      isSynthetic: true,
      minModelYear: null,
      maxVehicleAgeYears: 8,
      minSeats: 4,
      acRequired: true,
      allowedBodyTypes: ['SEDAN', 'SUV'],
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const rule = EligibilityRuleSchema.parse(draft.json());
    expect(rule).toMatchObject({ status: 'DRAFT', version: 1, allowedBodyTypes: ['SEDAN', 'SUV'], draftedByStaffId: maker.staffId });
    await send(maker, `/v1/admin/catalog/eligibility-rules/${rule.id}/submission`, {});
    expect(errorOf(await stepped(maker, `/v1/admin/catalog/eligibility-rules/${rule.id}/approval`, { decision: 'APPROVE' }))).toMatchObject({
      code: 'WAYVRO_E_FORBIDDEN',
      details: { reasonCodes: ['MAKER_IS_CHECKER'] },
    });
    expect((await stepped(checker, `/v1/admin/catalog/eligibility-rules/${rule.id}/approval`, { decision: 'APPROVE' })).json()).toMatchObject({
      status: 'APPROVED',
    });
    expect((await stepped(checker, `/v1/admin/catalog/eligibility-rules/${rule.id}/activation`, {})).json()).toMatchObject({ status: 'ACTIVE' });
    expect(
      (await h.owner.query(`select 1 from platform.outbox_events where type = 'catalog.eligibility-rule.activated.v1' and aggregate_id = $1`, [rule.id]))
        .rowCount,
    ).toBe(1);
    const clone = EligibilityRuleSchema.parse((await send(maker, `/v1/admin/catalog/eligibility-rules/${rule.id}/clones`, {})).json());
    expect(clone).toMatchObject({ status: 'DRAFT', version: 2, supersedesId: rule.id, maxVehicleAgeYears: 8, allowedBodyTypes: ['SEDAN', 'SUV'] });
    expect((await stepped(maker, `/v1/admin/catalog/eligibility-rules/${rule.id}/retirement`, {})).json()).toMatchObject({ status: 'RETIRED' });
    expect((await h.inject({ method: 'GET', url: '/v1/admin/catalog/eligibility-rules?cityCode=LHR', headers: kit.sb(auditor) })).json()).toMatchObject({
      rules: [{ version: 2 }, { version: 1, status: 'RETIRED' }],
    });
  });
});

describe('city products: legal gate and ENABLE maker-checker (R28, T3-15)', () => {
  it('fails closed through the API until a rate-card source is wired; the legal gate refuses BIKE; only ENABLED products can be suspended', async () => {
    const list = CityProductListSchema.parse(
      (await h.inject({ method: 'GET', url: '/v1/admin/catalog/city-products?cityCode=LHR', headers: kit.sb(auditor) })).json(),
    );
    expect(list.products.map((p) => [p.productCode, p.status])).toEqual([
      ['ECONOMY', 'NOT_CONFIGURED'],
      ['COMFORT', 'NOT_CONFIGURED'],
      ['BIKE', 'DISABLED_LEGAL_GATE'],
      ['RICKSHAW', 'DISABLED_LEGAL_GATE'],
    ]);
    const enable = await stepped(maker, '/v1/admin/catalog/city-products/enable-requests', {
      cityCode: 'LHR',
      productCode: 'ECONOMY',
      legalBasisRef: 'COUNSEL-MEMO-SYNTHETIC-1',
      reasonCode: 'LAUNCH_READY',
    });
    expect(errorOf(enable)?.code).toBe('WAYVRO_E_CONFLICT');
    expect(errorOf(enable)?.details?.reasonCodes).toContain('RATE_CARD_CHECK_UNAVAILABLE');
    const bike = await stepped(maker, '/v1/admin/catalog/city-products/enable-requests', {
      cityCode: 'LHR',
      productCode: 'BIKE',
      legalBasisRef: 'COUNSEL-MEMO-SYNTHETIC-1',
      reasonCode: 'LAUNCH_READY',
    });
    expect(errorOf(bike)).toMatchObject({ code: 'WAYVRO_E_CONFLICT', details: { reasonCodes: ['LEGAL_GATE'] } });
    expect(
      (
        await h.owner.query(`select 1 from audit.audit_events where action = 'CATALOG_ACTIVATION_REFUSED' and object_id = $1 and reason_code = 'LEGAL_GATE'`, [
          cityProductObjectId('LHR', 'BIKE'),
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      errorOf(await stepped(maker, '/v1/admin/catalog/city-products/suspensions', { cityCode: 'LHR', productCode: 'ECONOMY', reasonCode: 'SAFETY_INCIDENT' })),
    ).toMatchObject({
      code: 'WAYVRO_E_CONFLICT',
      details: { reasonCodes: ['NOT_ENABLED'] },
    });
    expect(
      errorOf(await stepped(checker, '/v1/admin/catalog/city-products/enable-decisions', { cityCode: 'LHR', productCode: 'ECONOMY', decision: 'APPROVE' })),
    ).toMatchObject({ details: { reasonCodes: ['NO_PENDING_REQUEST'] } });
    expect(
      (
        await stepped(maker, '/v1/admin/catalog/city-products/enable-requests', {
          cityCode: 'XYZ',
          productCode: 'ECONOMY',
          legalBasisRef: 'REF-1',
          reasonCode: 'LAUNCH_READY',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('with a rate-card source: request -> approve by a different manager -> ENABLED -> suspend -> resume (maker-checker again); DB refuses maker = checker', async () => {
    // prerequisites: ACTIVE zone set covering ECONOMY with hours (from the lifecycle tests) + ACTIVE ECONOMY rule
    const rule = await approvedRule('ECONOMY');
    expect((await stepped(maker, `/v1/admin/catalog/eligibility-rules/${rule}/activation`, {})).statusCode).toBe(200);
    const withCards = service('test', { hasActiveRateCard: () => Promise.resolve(true) });
    const missingCards = service('test', { hasActiveRateCard: () => Promise.resolve(false) });
    const req = { cityCode: 'LHR', productCode: 'ECONOMY', legalBasisRef: 'COUNSEL-MEMO-SYNTHETIC-1', reasonCode: 'LAUNCH_READY' };
    expect(outcome(await missingCards.requestEnable(principal(maker), req, key()))).toMatchObject({
      kind: 'error',
      details: { reasonCodes: ['PREREQ_RATE_CARD_MISSING'] },
    });
    const requested = outcome(await withCards.requestEnable(principal(maker), req, key()));
    expect(requested).toMatchObject({ kind: 'success', body: { status: 'CONFIGURED', pendingTransition: 'ENABLE', changedByStaffId: maker.staffId } });
    expect(outcome(await withCards.decideEnable(principal(maker), { cityCode: 'LHR', productCode: 'ECONOMY', decision: 'APPROVE' }, key()))).toMatchObject({
      kind: 'error',
      code: 'WAYVRO_E_FORBIDDEN',
      details: { reasonCodes: ['MAKER_IS_CHECKER'] },
    });
    // the database refuses maker = checker on its own
    await expect(
      h.runtime.db.pool.query(
        `update catalog.city_service_products set status = 'ENABLED', approved_by_staff_id = changed_by_staff_id where city_code = 'LHR' and product_code = 'ECONOMY'`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const enabled = outcome(
      await withCards.decideEnable(principal(checker), { cityCode: 'LHR', productCode: 'ECONOMY', decision: 'APPROVE', reasonCode: 'LAUNCH_APPROVED' }, key()),
    );
    expect(enabled).toMatchObject({
      kind: 'success',
      body: { status: 'ENABLED', approvedByStaffId: checker.staffId, legalBasisRef: 'COUNSEL-MEMO-SYNTHETIC-1' },
    });
    expect(
      (
        await h.owner.query(
          `select payload from platform.outbox_events where type = 'catalog.city-product.changed.v1' and aggregate_id = $1 order by created_at`,
          [cityProductObjectId('LHR', 'ECONOMY')],
        )
      ).rows.map((r: { payload: unknown }) => r.payload),
    ).toEqual([{ cityCode: 'LHR', productCode: 'ECONOMY', status: 'ENABLED' }]);
    // consumers now see ECONOMY
    const consumer = await signIn(h);
    expect((await h.inject({ method: 'GET', url: '/v1/catalog/products?cityCode=LHR', headers: bearer(consumer.accessToken) })).json()).toMatchObject({
      products: [{ productCode: 'ECONOMY' }],
    });
    // suspension: one staff member with step-up (route) and a reason code
    const suspended = await stepped(maker, '/v1/admin/catalog/city-products/suspensions', {
      cityCode: 'LHR',
      productCode: 'ECONOMY',
      reasonCode: 'SAFETY_INCIDENT',
    });
    expect(suspended.json()).toMatchObject({ status: 'SUSPENDED', reasonCode: 'SAFETY_INCIDENT', changedByStaffId: maker.staffId });
    expect((await h.inject({ method: 'GET', url: '/v1/catalog/products?cityCode=LHR', headers: bearer(consumer.accessToken) })).json()).toMatchObject({
      products: [],
    });
    // resuming is maker-checker again (the suspender may approve someone else's resume request)
    expect(outcome(await withCards.requestEnable(principal(checker), req, key()))).toMatchObject({
      kind: 'success',
      body: { status: 'SUSPENDED', pendingTransition: 'ENABLE' },
    });
    expect(outcome(await withCards.decideEnable(principal(checker), { cityCode: 'LHR', productCode: 'ECONOMY', decision: 'APPROVE' }, key()))).toMatchObject({
      kind: 'error',
      code: 'WAYVRO_E_FORBIDDEN',
    });
    expect(outcome(await withCards.decideEnable(principal(maker), { cityCode: 'LHR', productCode: 'ECONOMY', decision: 'APPROVE' }, key()))).toMatchObject({
      kind: 'success',
      body: { status: 'ENABLED' },
    });
    const actions = await h.owner.query<{ action: string }>(`select action from audit.audit_events where object_id = $1 and outcome = 'SUCCESS' order by seq`, [
      cityProductObjectId('LHR', 'ECONOMY'),
    ]);
    expect(actions.rows.map((r) => r.action)).toEqual([
      'CITY_PRODUCT_ENABLE_REQUESTED',
      'CITY_PRODUCT_ENABLED',
      'CITY_PRODUCT_SUSPENDED',
      'CITY_PRODUCT_ENABLE_REQUESTED',
      'CITY_PRODUCT_ENABLED',
    ]);
  });

  it('a rejected ENABLE request clears the pending transition and keeps the state', async () => {
    const rule = await approvedRule('COMFORT');
    await stepped(maker, `/v1/admin/catalog/eligibility-rules/${rule}/activation`, {});
    const withCards = service('test', { hasActiveRateCard: () => Promise.resolve(true) });
    expect(
      outcome(
        await withCards.requestEnable(
          principal(maker),
          { cityCode: 'LHR', productCode: 'COMFORT', legalBasisRef: 'COUNSEL-MEMO-SYNTHETIC-2', reasonCode: 'LAUNCH_READY' },
          key(),
        ),
      ),
    ).toMatchObject({ kind: 'success' });
    const rejected = await stepped(checker, '/v1/admin/catalog/city-products/enable-decisions', {
      cityCode: 'LHR',
      productCode: 'COMFORT',
      decision: 'REJECT',
      reasonCode: 'NOT_READY',
    });
    expect(rejected.json()).toMatchObject({ status: 'CONFIGURED', pendingTransition: null, reasonCode: 'NOT_READY' });
  });
});

describe('production refuses synthetic configuration (T3-31)', () => {
  it('zone-set and rule activation and ENABLE of synthetic configuration are refused with SYNTHETIC_REFUSED_IN_PRODUCTION (audited)', async () => {
    const prod = service('production', { hasActiveRateCard: () => Promise.resolve(true) });
    const set = await approvedZoneSet('LHR', VALID, true);
    expect(outcome(await prod.activateZoneSet(principal(maker), set, key()))).toMatchObject({
      kind: 'error',
      code: 'WAYVRO_E_CONFLICT',
      details: { reasonCodes: ['SYNTHETIC_REFUSED_IN_PRODUCTION'] },
    });
    expect(
      (
        await h.owner.query(
          `select 1 from audit.audit_events where action = 'CATALOG_ACTIVATION_REFUSED' and object_id = $1 and reason_code = 'SYNTHETIC_REFUSED_IN_PRODUCTION'`,
          [set],
        )
      ).rowCount,
    ).toBe(1);
    const rule = await approvedRule('COMFORT');
    expect(outcome(await prod.activateRule(principal(maker), rule, key()))).toMatchObject({ details: { reasonCodes: ['SYNTHETIC_REFUSED_IN_PRODUCTION'] } });
    // a SYNTHETIC* legal reference is refused even for an otherwise complete product (the active configuration is synthetic too)
    const enable = outcome(
      await prod.requestEnable(
        principal(checker),
        { cityCode: 'LHR', productCode: 'COMFORT', legalBasisRef: 'SYNTHETIC_LOCAL_TEST_ONLY', reasonCode: 'LAUNCH_READY' },
        key(),
      ),
    );
    expect(enable).toMatchObject({ kind: 'error', details: { reasonCodes: ['SYNTHETIC_REFUSED_IN_PRODUCTION'] } });
  });
});
