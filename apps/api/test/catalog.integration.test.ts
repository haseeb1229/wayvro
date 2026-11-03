/**
 * P3.1 catalog read side against real PostgreSQL + PostGIS as the restricted API role, seeded through the dev-only
 * synthetic seed (one synthetic truth with local development): `GET /v1/catalog/products` (ENABLED only; BIKE/RICKSHAW
 * never), and the cross-context read model — ZB-01..14/16 through `resolveForQuote`, service hours from server time
 * (OUTSIDE_SERVICE_HOURS + next opening), unknown/not-enabled products, `inServiceArea`, `eligibilityForVehicle`.
 * Custom geometry (holes, multipolygons, shared edges, product scopes, district geometry) lives in synthetic E2E cities
 * so the seeded LHR set stays intact. Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { CatalogProductListSchema } from '@wayvro/contracts';
import type { Queryable } from '@wayvro/server-runtime';
import { SYNTHETIC_CATALOG, seedSyntheticCatalog } from '@wayvro/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogReadModel, type QuoteResolution } from '../src/catalog/catalog-read-model.js';
import { bearer, signIn, startApi, type Harness } from './support.js';

let h: Harness;
let model: CatalogReadModel;
const S = SYNTHETIC_CATALOG;
/** Monday 12 October 2026, 12:00 PKT (inside the seeded 06:00–23:00 hours). */
const NOON = new Date('2026-10-12T07:00:00.000Z');
const LHR = (
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number } = S.points.insideOther,
  extra: Partial<{ products: string[]; at: Date }> = {},
) => model.resolveForQuote({ cityCode: 'LHR', pickup, dropoff, at: extra.at ?? NOON, ...(extra.products ? { products: extra.products } : {}) });
const decision = (r: QuoteResolution, product = 'ECONOMY') => r.candidates.find((c) => c.productCode === product)?.decision;

const rect = (x0: number, y0: number, x1: number, y1: number) =>
  `(${String(x0)} ${String(y0)}, ${String(x1)} ${String(y0)}, ${String(x1)} ${String(y1)}, ${String(x0)} ${String(y1)}, ${String(x0)} ${String(y0)})`;

interface ZoneSpec {
  readonly code: string;
  readonly kind: string;
  readonly wkt: string;
  readonly products?: readonly string[];
}
/** A synthetic E2E city with ENABLED ECONOMY + COMFORT (system-seeded, synthetic legal basis). */
async function city(code: string): Promise<void> {
  await h.owner.query(`insert into catalog.cities (code, name_en, name_ur, status) values ($1, 'Synthetic E2E city', 'مصنوعی', 'ENABLED')`, [code]);
  await h.owner.query(
    `insert into catalog.city_service_products (city_code, product_code, status, legal_basis_ref, is_synthetic) values
       ($1, 'ECONOMY', 'ENABLED', 'SYNTHETIC_LOCAL_TEST_ONLY', true), ($1, 'COMFORT', 'ENABLED', 'SYNTHETIC_LOCAL_TEST_ONLY', true), ($1, 'BIKE', 'DISABLED_LEGAL_GATE', null, false)`,
    [code],
  );
}
/** Writes and activates a staff-less synthetic zone set (the seed path) with all-day hours; returns its id. */
async function activeSet(cityCode: string, zones: readonly ZoneSpec[], activate = true): Promise<string> {
  const id = randomUUID();
  await h.owner.query(
    `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference)
     values ($1, $2, (select coalesce(max(version), 0) + 1 from catalog.zone_sets where city_code = $2), 'DRAFT', true, 'SYNTHETIC test geometry')`,
    [id, cityCode],
  );
  for (const z of zones) {
    const zoneId = randomUUID();
    await h.owner.query(
      `insert into catalog.zones (id, zone_set_id, code, kind, name_en, name_ur, geom) values ($1, $2, $3, $4, 'S', 'S', ST_GeomFromText($5, 4326))`,
      [zoneId, id, z.code, z.kind, z.wkt],
    );
    for (const p of z.products ?? []) await h.owner.query(`insert into catalog.zone_products (zone_id, product_code) values ($1, $2)`, [zoneId, p]);
  }
  for (let d = 0; d < 7; d++) {
    await h.owner.query(`insert into catalog.service_hours (id, zone_set_id, weekday, opens_local, closes_local) values ($1, $2, $3, '00:00', '00:00')`, [
      randomUUID(),
      id,
      d,
    ]);
  }
  if (activate) {
    await h.owner.query(`update catalog.zone_sets set status = 'RETIRED', effective_until = clock_timestamp() where city_code = $1 and status = 'ACTIVE'`, [
      cityCode,
    ]);
    await h.owner.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [id]);
  }
  return id;
}

beforeAll(async () => {
  h = await startApi();
  const url = h.owner.options.connectionString;
  if (!url) throw new Error('owner pool without connection string');
  await seedSyntheticCatalog({ env: 'test', databaseUrl: url });
  // the read model runs on the API's own pool: a LOGIN member of wayvro_api (grants proven, never the owner)
  model = new CatalogReadModel(h.runtime.db.pool, { PICKUP_SNAP_MAX_METERS: 300 });
}, 60_000);
afterAll(async () => {
  await h.close();
});

describe('GET /v1/catalog/products (consumer, session)', () => {
  it('lists only ENABLED products with display data; BIKE/RICKSHAW and CONFIGURED COMFORT never appear', async () => {
    expect((await h.inject({ method: 'GET', url: '/v1/catalog/products?cityCode=LHR' })).statusCode).toBe(401);
    const s = await signIn(h);
    const res = await h.inject({ method: 'GET', url: '/v1/catalog/products?cityCode=LHR', headers: bearer(s.accessToken) });
    expect(res.statusCode, res.body).toBe(200);
    expect(CatalogProductListSchema.parse(res.json())).toEqual({
      cityCode: 'LHR',
      products: [
        {
          productCode: 'ECONOMY',
          vehicleClass: 'CAR',
          nameKey: 'product.economy.name',
          descriptionKey: 'product.economy.description',
          seatsMax: 4,
          luggageClass: 'STANDARD',
          sortOrder: 10,
        },
      ],
    });
    // strict query: no client time/zone or unknown parameter is accepted (HRS-10 at the catalog surface)
    for (const q of ['', '?cityCode=lhr', '?cityCode=LHR&at=2026-10-12T00:00:00Z', '?cityCode=LHR&timezone=UTC']) {
      expect((await h.inject({ method: 'GET', url: `/v1/catalog/products${q}`, headers: bearer(s.accessToken) })).statusCode, q).toBe(400);
    }
    const unknown = await h.inject({ method: 'GET', url: '/v1/catalog/products?cityCode=XYZ', headers: bearer(s.accessToken) });
    expect(unknown.json()).toEqual({ cityCode: 'XYZ', products: [] });
  });
});

describe('ZONE-BOUNDARY through resolveForQuote (real PostGIS, synthetic LHR set)', () => {
  it('ZB-01 strictly inside is SERVED; ZB-02 on the service-area boundary (vertex and edge) is SERVED; ZB-03 1e-7° outside is not', async () => {
    const [x0, y0, , y1] = S.rectangles.serviceArea;
    const inside = await LHR(S.points.inside);
    expect(inside.zoneSet).toEqual({ id: S.zoneSetId, version: 1, isSynthetic: true });
    expect(decision(inside)).toEqual({ kind: 'SERVED', snappedPickup: null, airportPickup: false });
    expect(decision(await LHR({ lat: y0, lng: x0 }))?.kind).toBe('SERVED');
    expect(decision(await LHR({ lat: (y0 + y1) / 2, lng: x0 }))?.kind).toBe('SERVED');
    expect(decision(await LHR({ lat: (y0 + y1) / 2, lng: x0 - 1e-7 }))).toEqual({ kind: 'UNAVAILABLE', reasonCode: 'ZONE_NOT_SERVED', nextOpenAt: null });
    expect(decision(await LHR(S.points.inside, S.points.outside))?.kind).toBe('UNAVAILABLE');
  });

  it('ZB-07 inside an exclusion is ZONE_NOT_SERVED (exclusion wins, either end); ZB-08 on the exclusion boundary is excluded', async () => {
    expect(decision(await LHR(S.points.excluded))).toMatchObject({ kind: 'UNAVAILABLE', reasonCode: 'ZONE_NOT_SERVED' });
    expect(decision(await LHR(S.points.inside, S.points.excluded))).toMatchObject({ reasonCode: 'ZONE_NOT_SERVED' });
    const [x0, y0, , y1] = S.rectangles.exclusion;
    expect(decision(await LHR({ lat: (y0 + y1) / 2, lng: x0 }))).toMatchObject({ reasonCode: 'ZONE_NOT_SERVED' });
    expect(decision(await LHR({ lat: (y0 + y1) / 2, lng: x0 - 1e-5 }))?.kind).toBe('SERVED');
  });

  it('ZB-09 a pickup in a PICKUP_RESTRICTED zone snaps to the nearest designated point within 300 m, else PICKUP_RESTRICTED', async () => {
    const snapped = decision(await LHR(S.points.restricted));
    expect(snapped).toMatchObject({ kind: 'SERVED', airportPickup: false, snappedPickup: { kind: 'DESIGNATED', nameEn: 'Synthetic gate A' } });
    if (snapped?.kind !== 'SERVED' || !snapped.snappedPickup) throw new Error('not snapped');
    expect(snapped.snappedPickup.point).toEqual({ lat: S.designatedPoints[0].lat, lng: S.designatedPoints[0].lng });
    const [, , x1, y1] = S.rectangles.pickupRestricted;
    expect(decision(await LHR({ lat: y1 - 0.0075, lng: x1 - 0.0005 }))).toEqual({ kind: 'UNAVAILABLE', reasonCode: 'PICKUP_RESTRICTED', nextOpenAt: null });
  });

  it('ZB-10 an airport-precinct pickup snaps to the AIRPORT point and is flagged airportPickup; ZB-11 a drop-off inside a restricted zone is allowed', async () => {
    expect(decision(await LHR(S.points.airport))).toMatchObject({ kind: 'SERVED', airportPickup: true, snappedPickup: { kind: 'AIRPORT' } });
    expect(decision(await LHR(S.points.inside, S.points.restricted))).toEqual({ kind: 'SERVED', snappedPickup: null, airportPickup: false });
    expect(decision(await LHR(S.points.inside, S.points.airport))).toEqual({ kind: 'SERVED', snappedPickup: null, airportPickup: false });
  });

  it('service hours come from SERVER time in Asia/Karachi: 02:00 PKT is OUTSIDE_SERVICE_HOURS with the next opening at 06:00 PKT', async () => {
    const night = await LHR(S.points.inside, S.points.insideOther, { at: new Date('2026-10-11T21:00:00.000Z') });
    expect(decision(night)).toEqual({ kind: 'UNAVAILABLE', reasonCode: 'OUTSIDE_SERVICE_HOURS', nextOpenAt: new Date('2026-10-12T01:00:00.000Z') });
    // zone refusals win over hours
    expect(decision(await LHR(S.points.outside, S.points.insideOther, { at: new Date('2026-10-11T21:00:00.000Z') }))).toMatchObject({
      reasonCode: 'ZONE_NOT_SERVED',
    });
  });

  it('requested products: unknown codes are reported (API 400), known non-ENABLED products are listed as not enabled, never priced (QT-09)', async () => {
    const r = await LHR(S.points.inside, S.points.insideOther, { products: ['ECONOMY', 'BIKE', 'COMFORT', 'NOPE', 'ECONOMY'] });
    expect(r.unknownProductCodes).toEqual(['NOPE']);
    expect(r.notEnabled).toEqual([
      { productCode: 'COMFORT', cityStatus: 'CONFIGURED' },
      { productCode: 'BIKE', cityStatus: 'DISABLED_LEGAL_GATE' },
    ]);
    expect(r.candidates.map((c) => c.productCode)).toEqual(['ECONOMY']);
    expect(r.candidates[0]).toMatchObject({
      cityStatus: 'ENABLED',
      isSyntheticCity: true,
      display: { nameKey: 'product.economy.name', seatsMax: 4, luggageClass: 'STANDARD', routingProfile: 'CAR', vehicleClass: 'CAR', sortOrder: 10 },
    });
    // ZB-16: no district geometry exists in LHR (FA-12) — district codes are null
    expect([r.pickupDistrictCode, r.dropoffDistrictCode]).toEqual([null, null]);
  });

  it('inServiceArea answers for ENABLED products under the ACTIVE set; productsForCity lists ENABLED only', async () => {
    expect(await model.inServiceArea('LHR', S.points.inside)).toBe(true);
    expect(await model.inServiceArea('LHR', S.points.excluded)).toBe(false);
    expect(await model.inServiceArea('LHR', S.points.outside)).toBe(false);
    expect(await model.inServiceArea('XYZ', S.points.inside)).toBe(false);
    expect((await model.productsForCity('LHR')).map((p) => p.productCode)).toEqual(['ECONOMY']);
  });

  it('eligibilityForVehicle evaluates the ACTIVE synthetic rules (H10); BIKE has no rule (fail closed)', async () => {
    const at = new Date('2026-10-13T10:00:00.000Z');
    const results = await model.eligibilityForVehicle(
      { serviceCategory: 'CAR', modelYear: 2020, seats: 4, bodyType: 'SEDAN', airConditioned: true },
      'LHR',
      at,
    );
    expect(results.map((r) => [r.productCode, r.cityStatus, r.result.kind])).toEqual([
      ['ECONOMY', 'ENABLED', 'ELIGIBLE'],
      ['COMFORT', 'CONFIGURED', 'ELIGIBLE'],
      ['BIKE', 'DISABLED_LEGAL_GATE', 'NOT_ELIGIBLE'],
      ['RICKSHAW', 'DISABLED_LEGAL_GATE', 'NOT_ELIGIBLE'],
    ]);
    const unknown = await model.eligibilityForVehicle(
      { serviceCategory: 'CAR', modelYear: 2020, seats: null, bodyType: null, airConditioned: null },
      'LHR',
      at,
    );
    expect(unknown.find((r) => r.productCode === 'COMFORT')?.result).toMatchObject({
      kind: 'UNKNOWN',
      missingAttributes: ['seats', 'airConditioned', 'bodyType'],
    });
    expect(unknown.find((r) => r.productCode === 'ECONOMY')?.result.kind).toBe('ELIGIBLE');
  });
});

describe('ZONE-BOUNDARY with custom synthetic geometry (E2E cities)', () => {
  it('ZB-04 hole, ZB-05 second MultiPolygon component, ZB-06 shared edge served once, ZB-12 product scope, ZB-13 non-ACTIVE sets ignored, ZB-16 district geometry', async () => {
    await city('ZZQ');
    await activeSet('ZZQ', [
      {
        code: 'ZA',
        kind: 'SERVICE_AREA',
        wkt: `MULTIPOLYGON((${rect(74.0, 31.0, 74.1, 31.1)}, ${rect(74.04, 31.04, 74.06, 31.06)}), (${rect(74.2, 31.0, 74.3, 31.1)}))`,
      },
      { code: 'ZB', kind: 'SERVICE_AREA', wkt: `MULTIPOLYGON((${rect(74.1, 31.0, 74.15, 31.1)}))` },
      { code: 'ZC', kind: 'SERVICE_AREA', wkt: `MULTIPOLYGON((${rect(74.4, 31.0, 74.5, 31.1)}))`, products: ['COMFORT'] },
    ]);
    // a DRAFT set covering another area is ignored (ZB-13)
    await activeSet('ZZQ', [{ code: 'ZD', kind: 'SERVICE_AREA', wkt: `MULTIPOLYGON((${rect(74.6, 31.0, 74.7, 31.1)}))` }], false);
    const q = (lng: number, lat: number, products?: string[]) =>
      model.resolveForQuote({ cityCode: 'ZZQ', pickup: { lat, lng }, dropoff: { lat: 31.02, lng: 74.02 }, at: NOON, ...(products ? { products } : {}) });
    expect(decision(await q(74.05, 31.05))).toMatchObject({ reasonCode: 'ZONE_NOT_SERVED' });
    expect(decision(await q(74.05, 31.04))?.kind).toBe('SERVED'); // on the hole's boundary = covered
    expect(decision(await q(74.25, 31.05))?.kind).toBe('SERVED');
    const shared = await q(74.1, 31.05);
    expect(shared.candidates.map((c) => [c.productCode, c.decision.kind])).toEqual([
      ['ECONOMY', 'SERVED'],
      ['COMFORT', 'SERVED'],
    ]);
    // ZB-12: zone C serves COMFORT only — ECONOMY is unavailable there, COMFORT unaffected (drop-off in A serves both)
    const scoped = await q(74.45, 31.05);
    expect(decision(scoped, 'ECONOMY')).toMatchObject({ reasonCode: 'ZONE_NOT_SERVED' });
    expect(decision(scoped, 'COMFORT')?.kind).toBe('SERVED');
    expect(decision(await q(74.65, 31.05))).toMatchObject({ reasonCode: 'ZONE_NOT_SERVED' });
    // ZB-16 with district geometry present (synthetic, staff-less owner write — the API role holds no write on districts)
    await h.owner.query(
      `insert into catalog.districts (code, city_code, name_en, name_ur, status, geom, geom_source_reference)
       values ('ZZQ-SYN', 'ZZQ', 'Synthetic district', 'مصنوعی', 'ENABLED', ST_GeomFromText($1, 4326), 'SYNTHETIC — not a real district')`,
      [`MULTIPOLYGON((${rect(74.0, 31.0, 74.12, 31.1)}))`],
    );
    const withDistrict = await q(74.02, 31.03);
    expect([withDistrict.pickupDistrictCode, withDistrict.dropoffDistrictCode]).toEqual(['ZZQ-SYN', 'ZZQ-SYN']);
    expect((await q(74.25, 31.05)).pickupDistrictCode).toBeNull();
  });

  it('no ACTIVE zone set: every ENABLED product is ZONE_NOT_SERVED (fail closed)', async () => {
    await city('ZZN');
    const r = await model.resolveForQuote({ cityCode: 'ZZN', pickup: S.points.inside, dropoff: S.points.insideOther, at: NOON });
    expect(r.zoneSet).toBeNull();
    expect(r.candidates.map((c) => c.decision)).toEqual([
      { kind: 'UNAVAILABLE', reasonCode: 'ZONE_NOT_SERVED', nextOpenAt: null },
      { kind: 'UNAVAILABLE', reasonCode: 'ZONE_NOT_SERVED', nextOpenAt: null },
    ]);
  });

  it('ZB-14 an activation committed while a request resolves never mixes sets: the request keeps the set it read first', async () => {
    await city('ZZA');
    const first = await activeSet('ZZA', [{ code: 'OLD', kind: 'SERVICE_AREA', wkt: `MULTIPOLYGON((${rect(74.0, 31.0, 74.1, 31.1)}))` }]);
    let activated: string | null = null;
    // a Queryable that commits a new ACTIVE set (covering a different area) right after the zone-set read
    const racing: Queryable = {
      query: (async (text: string, values?: unknown[]) => {
        const result = await h.runtime.db.pool.query(text, values);
        if (activated === null && text.includes('from catalog.zone_sets where city_code')) {
          activated = await activeSet('ZZA', [{ code: 'NEW', kind: 'SERVICE_AREA', wkt: `MULTIPOLYGON((${rect(74.5, 31.0, 74.6, 31.1)}))` }]);
        }
        return result;
      }) as Queryable['query'],
    };
    const r = await model.resolveForQuote({ cityCode: 'ZZA', pickup: { lat: 31.05, lng: 74.05 }, dropoff: { lat: 31.06, lng: 74.06 }, at: NOON }, racing);
    expect(activated).not.toBeNull();
    expect(r.zoneSet?.id).toBe(first);
    expect(decision(r)?.kind).toBe('SERVED');
    // the next request sees only the new set
    const after = await model.resolveForQuote({ cityCode: 'ZZA', pickup: { lat: 31.05, lng: 74.05 }, dropoff: { lat: 31.06, lng: 74.06 }, at: NOON });
    expect(after.zoneSet?.id).toBe(activated);
    expect(decision(after)).toMatchObject({ reasonCode: 'ZONE_NOT_SERVED' });
  });
});
