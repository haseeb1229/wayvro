/**
 * P3.3 upfront quotes against real PostgreSQL/PostGIS + Valkey as the restricted API role, MOCK geo doubles (synthetic
 * straight-line routes) and the dev-only synthetic catalog/pricing seed (QT-02..QT-17 except the tamper cases, P-11/P-12/
 * P-13/P-15, CONC-PRICING for quotes, FAULT-GEO through the quote path, LOG-GEO-style canary). Every price is SYNTHETIC
 * ("SYNTHETIC — not a Wayvro price"); no real rate, fee or tax value exists.
 */
import { randomUUID } from 'node:crypto';
import { QuoteGroupSchema, type QuoteGroup } from '@wayvro/contracts';
import { createLogger } from '@wayvro/observability';
import { RateLimiter, awaitRedisReady, createRequestPathRedis } from '@wayvro/server-runtime';
import { captureLogs } from '@wayvro/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogReadModel } from '../src/catalog/catalog-read-model.js';
import { PlaceRefSealer } from '../src/geo/place-ref.js';
import { IdempotencyStore } from '../src/platform/idempotency.js';
import { priceQuote } from '../src/pricing/engine.js';
import { QuoteService } from '../src/pricing/quote.service.js';
import { startGeoApi, type GeoHarness } from './geo-helpers.js';
import { P, S, errorOf, getQuote, postQuote, quoteBody, quoteRows, seedQuotes, startQuoteApi } from './pricing-helpers.js';
import { key, signIn, type SignedIn } from './support.js';

/** The account behind a signed-in session (read as the owner; tests only). */
async function accountOf(s: SignedIn): Promise<string> {
  const r = await g.h.owner.query<{ account_id: string }>(`select account_id from identity.sessions where id = $1`, [s.sessionId]);
  const id = r.rows[0]?.account_id;
  if (!id) throw new Error('session without account');
  return id;
}

let g: GeoHarness & { zoneSetId: string };
let rider: SignedIn;
const log = createLogger({ service: 'api', env: 'test', level: 'fatal' });
const group = (res: { json: () => unknown }): QuoteGroup => QuoteGroupSchema.parse(res.json());
const routeCalls = () => g.doubles.control.calls('ROUTE');
/** A fresh, distinct pair of service-area points per call (route cache keys never collide between tests). */
let offset = 0;
function fresh(): { pickup: { lat: number; lng: number }; dropoff: { lat: number; lng: number } } {
  offset++;
  return { pickup: { lat: 31.43 + offset * 0.002, lng: 74.23 }, dropoff: { lat: 31.6, lng: 74.47 - offset * 0.002 } };
}

beforeAll(async () => {
  // account limits lifted here (QT-12 runs its own harness with the default limits)
  g = await startQuoteApi({
    enableComfort: true,
    env: { RUNTIME_SWITCH_CACHE_SECONDS: '1', QUOTES_PER_MINUTE_ACCOUNT: '10000', QUOTES_PER_DAY_ACCOUNT: '100000' },
  });
  rider = await signIn(g.h);
}, 120_000);
afterAll(async () => {
  await g.h.close();
});

describe('POST /v1/quotes — server-authoritative upfront price (B04/B06/E05)', () => {
  it('prices every ENABLED product from ONE routing call; Σ components = total; money as decimal strings (P-11, P-12, P-15)', async () => {
    const before = routeCalls();
    const res = await postQuote(g.h, rider.accessToken, quoteBody());
    expect(res.statusCode, res.body).toBe(201);
    expect(routeCalls() - before).toBe(1);
    const q = group(res);
    expect(q.options.map((o) => o.productCode)).toEqual(['ECONOMY', 'COMFORT']);
    expect(q.unavailable).toEqual([]);
    expect(q.pickup.snappedTo).toBeNull();
    expect(q.route.source).toMatchObject({ providerKey: 'geo-mock', cacheStatus: 'MISS', attributionCode: 'SYNTHETIC_DATA' });
    expect(q.route.polyline).not.toBeNull();
    for (const o of q.options) {
      const sum = o.components.reduce((s, c) => s + BigInt(c.amount.minor), 0n);
      expect(sum.toString()).toBe(o.total.minor);
      expect(BigInt(o.total.minor) % BigInt(P.roundingStepMinor)).toBe(0n);
      expect(o).toMatchObject({ status: 'PRICED', rateCardVersion: 1, pricingEngineVersion: 'pe-v1', tollPolicy: 'EXCLUDED_DISCLOSED', isSynthetic: true });
      expect(o.components.map((c) => c.kind)).not.toContain('DISCOUNT');
      expect(o.components.find((c) => c.kind === 'TAX')?.basis).toMatchObject({ rateBp: 0, isPlaceholder: true });
      // P-12: expiry is exactly the card TTL after the server creation instant
      expect(new Date(o.expiresAt).getTime() - new Date(q.createdAt).getTime()).toBe(P.quoteTtlSeconds * 1000);
    }
    // the stored components equal a replay of pe-v1 on the stored route numbers (P-05 replay)
    const economy = q.options[0];
    if (!economy) throw new Error('no ECONOMY option');
    const v = P.cards.ECONOMY;
    const replay = priceQuote({
      card: {
        baseMinor: BigInt(v.baseMinor),
        perKmMinor: BigInt(v.perKmMinor),
        perMinMinor: BigInt(v.perMinMinor),
        minimumFareMinor: BigInt(v.minimumFareMinor),
        bookingFeeMinor: BigInt(v.bookingFeeMinor),
        airportPickupFeeMinor: BigInt(v.airportPickupFeeMinor),
        roundingStepMinor: BigInt(P.roundingStepMinor),
        roundingMode: P.roundingMode,
        tollPolicy: P.tollPolicy,
        maxDistanceM: P.maxDistanceM,
        maxDurationS: P.maxDurationS,
      },
      tax: {
        id: P.taxPolicyId,
        version: 1,
        rateBp: 0,
        appliesTo: ['BASE', 'DISTANCE', 'TIME', 'MINIMUM_ADJUSTMENT', 'BOOKING_FEE'],
        inclusive: false,
        roundingMode: 'HALF_EVEN',
        isPlaceholder: true,
      },
      distanceM: q.route.distanceM,
      durationS: q.route.durationS,
      airportPickup: null,
    });
    if (replay.kind !== 'PRICED') throw new Error('replay not priced');
    expect(economy.total.minor).toBe(replay.total.minor.toString());
    expect(economy.components.map((c) => [c.kind, c.amount.minor])).toEqual(replay.components.map((c) => [c.kind, c.amount.minor.toString()]));
    // P-15: no amount ever travels as a JSON number
    expect(res.body).not.toMatch(/"minor":\s*-?\d/);
    expect(res.body).toMatch(/"minor":"\d+"/);
    // P-11: one snapshot, one created_at for the whole group (database)
    const rows = await g.h.owner.query<{ snapshots: number; created: number; synthetic: boolean }>(
      `select count(distinct route_snapshot_id)::int snapshots, count(distinct created_at)::int created, bool_and(is_synthetic) synthetic
         from pricing.quotes where quote_group_id = $1`,
      [q.quoteGroupId],
    );
    expect(rows.rows[0]).toEqual({ snapshots: 1, created: 1, synthetic: true });
  });

  it('QT-02 / P-13: the same key and body replays the byte-identical 201 without a second provider call; QT-03: a changed body is 409', async () => {
    const k = key();
    const body = quoteBody(fresh().pickup, fresh().dropoff);
    const first = await postQuote(g.h, rider.accessToken, body, { key: k });
    expect(first.statusCode, first.body).toBe(201);
    const calls = routeCalls();
    const again = await postQuote(g.h, rider.accessToken, body, { key: k });
    expect(again.statusCode).toBe(201);
    expect(again.body).toBe(first.body);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(routeCalls()).toBe(calls);
    const changed = await postQuote(g.h, rider.accessToken, { ...body, products: ['ECONOMY'] }, { key: k });
    expect(changed.statusCode).toBe(409);
    expect(errorOf(changed)?.code).toBe('WAYVRO_E_IDEMPOTENCY_CONFLICT');
    // detail is part of the canonical request: lite under the same key is a different request
    expect((await postQuote(g.h, rider.accessToken, body, { key: k, detail: 'lite' })).statusCode).toBe(409);
  });

  it('QT-04: the same key used by a different account is an independent quote', async () => {
    const other = await signIn(g.h);
    const k = key();
    const body = quoteBody(fresh().pickup, fresh().dropoff);
    const a = group(await postQuote(g.h, rider.accessToken, body, { key: k }));
    const b = group(await postQuote(g.h, other.accessToken, body, { key: k }));
    expect(b.quoteGroupId).not.toBe(a.quoteGroupId);
  });

  it('detail=lite omits the polyline (create and restore); full restore returns the stored group', async () => {
    const lite = group(await postQuote(g.h, rider.accessToken, quoteBody(fresh().pickup, fresh().dropoff), { detail: 'lite' }));
    expect(lite.route.polyline).toBeNull();
    const restored = group(await getQuote(g.h, rider.accessToken, lite.quoteGroupId));
    expect(restored.route.polyline).not.toBeNull();
    expect(restored.options.map((o) => [o.quoteId, o.total, o.components])).toEqual(lite.options.map((o) => [o.quoteId, o.total, o.components]));
    expect(group(await getQuote(g.h, rider.accessToken, lite.quoteGroupId, 'lite')).route.polyline).toBeNull();
  });

  it('snaps an airport-precinct pickup to the AIRPORT point and adds the synthetic airport fee; a venue pickup snaps to a designated point', async () => {
    const airport = group(await postQuote(g.h, rider.accessToken, quoteBody(S.points.airport, S.points.insideOther)));
    expect(airport.pickup.snappedTo).toMatchObject({
      kind: 'AIRPORT',
      nameEn: S.airportPoint.nameEn,
      point: { lat: S.airportPoint.lat, lng: S.airportPoint.lng },
    });
    const fee = airport.options.find((o) => o.productCode === 'ECONOMY')?.components.find((c) => c.kind === 'AIRPORT_FEE');
    expect(fee).toMatchObject({
      amount: { minor: String(P.cards.ECONOMY.airportPickupFeeMinor) },
      basis: { pickupPointId: airport.pickup.snappedTo?.pickupPointId },
    });
    const venue = group(await postQuote(g.h, rider.accessToken, quoteBody(S.points.restricted, S.points.insideOther)));
    expect(venue.pickup.snappedTo?.kind).toBe('DESIGNATED');
    expect(venue.options[0]?.components.some((c) => c.kind === 'AIRPORT_FEE')).toBe(false);
    // the routing call started at the snapped point (rounded to 4 decimals by the gateway)
    const last = g.doubles.control.inputs('ROUTE').at(-1) as { origin: { lat: number; lng: number } };
    expect(last.origin).toEqual({ lat: Number(venue.pickup.snappedTo?.point.lat.toFixed(4)), lng: Number(venue.pickup.snappedTo?.point.lng.toFixed(4)) });
  });

  it('QT-09: an unknown product is 400; a product that is not ENABLED is listed as unavailable and never priced', async () => {
    const unknown = await postQuote(g.h, rider.accessToken, quoteBody(S.points.inside, S.points.insideOther, { products: ['ECONOMY', 'HOVERCRAFT'] }));
    expect(unknown.statusCode).toBe(400);
    expect(errorOf(unknown)?.details?.reasonCodes).toEqual(['UNKNOWN_PRODUCT']);
    // R28: BIKE/RICKSHAW are DISABLED_LEGAL_GATE in the city — listed as LEGAL_GATE_DISABLED, never priced
    const bike = group(await postQuote(g.h, rider.accessToken, quoteBody(fresh().pickup, fresh().dropoff, { products: ['ECONOMY', 'BIKE', 'RICKSHAW'] })));
    expect(bike.options.map((o) => o.productCode)).toEqual(['ECONOMY']);
    expect(bike.unavailable).toEqual([
      { productCode: 'BIKE', reasonCode: 'LEGAL_GATE_DISABLED', nextOpenAt: null },
      { productCode: 'RICKSHAW', reasonCode: 'LEGAL_GATE_DISABLED', nextOpenAt: null },
    ]);
    const stored = await g.h.owner.query<{ product_code: string }>(`select product_code from pricing.quotes where quote_group_id = $1`, [bike.quoteGroupId]);
    expect(stored.rows.map((r) => r.product_code)).toEqual(['ECONOMY']);
    // only legal-gated products requested: nothing priced, no routing call, 422 with the legal-gate reason
    const calls = routeCalls();
    const onlyGated = await postQuote(g.h, rider.accessToken, quoteBody(fresh().pickup, fresh().dropoff, { products: ['BIKE'] }));
    expect(onlyGated.statusCode).toBe(422);
    expect(errorOf(onlyGated)).toMatchObject({ code: 'WAYVRO_E_SERVICE_AREA', details: { reasonCodes: ['LEGAL_GATE_DISABLED'] } });
    expect(routeCalls()).toBe(calls);
    // a genuine zone failure stays ZONE_NOT_SERVED next to the legal gate
    const outside = await postQuote(g.h, rider.accessToken, quoteBody(S.points.outside, S.points.inside, { products: ['ECONOMY', 'BIKE'] }));
    expect(outside.statusCode).toBe(422);
    expect(errorOf(outside)?.details?.reasonCodes).toEqual(['LEGAL_GATE_DISABLED', 'ZONE_NOT_SERVED']);
  });

  it('QT-10 / zones: a pickup outside the service area, in an exclusion or a cityCode without zones answers 422 SERVICE_AREA (an outcome, replayed)', async () => {
    const calls = routeCalls();
    const k = key();
    const outside = await postQuote(g.h, rider.accessToken, quoteBody(S.points.outside, S.points.inside), { key: k });
    expect(outside.statusCode).toBe(422);
    expect(errorOf(outside)).toMatchObject({ code: 'WAYVRO_E_SERVICE_AREA', details: { reasonCodes: ['ZONE_NOT_SERVED'] } });
    const replay = await postQuote(g.h, rider.accessToken, quoteBody(S.points.outside, S.points.inside), { key: k });
    expect(replay.statusCode).toBe(422);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(errorOf(await postQuote(g.h, rider.accessToken, quoteBody(S.points.excluded, S.points.inside)))?.details?.reasonCodes).toEqual(['ZONE_NOT_SERVED']);
    expect(errorOf(await postQuote(g.h, rider.accessToken, { ...quoteBody(), cityCode: 'KHI' }))?.code).toBe('WAYVRO_E_SERVICE_AREA');
    expect(routeCalls()).toBe(calls);
  });

  it('coordinates: outside Pakistan ⇒ 400 OUTSIDE_COUNTRY; pickup and drop-off closer than 50 m ⇒ 400 SAME_POINT (no provider call)', async () => {
    const calls = routeCalls();
    expect(errorOf(await postQuote(g.h, rider.accessToken, quoteBody({ lat: 10, lng: 74.3 }, S.points.inside)))?.details?.reasonCodes).toEqual([
      'OUTSIDE_COUNTRY',
    ]);
    expect(
      errorOf(await postQuote(g.h, rider.accessToken, quoteBody({ lat: 31.52, lng: 74.35 }, { lat: 31.5202, lng: 74.3501 })))?.details?.reasonCodes,
    ).toEqual(['SAME_POINT']);
    expect(routeCalls()).toBe(calls);
  });

  it('QT-07 / QT-08: tampered, expired and foreign placeRefs are 400 without a provider call; a valid placeRef never changes the price', async () => {
    const sealer = new PlaceRefSealer(g.h.runtime.cipher, 900);
    const claims = { providerKey: 'geo-mock', sku: 'AUTOCOMPLETE' as const, placeId: 'syn-lhr-liberty', cityCode: 'LHR' };
    const pair = fresh();
    const plain = group(await postQuote(g.h, rider.accessToken, quoteBody(pair.pickup, pair.dropoff)));
    const before = { route: routeCalls(), resolve: g.doubles.control.calls('PLACE_RESOLVE') };
    const riderAccount = await accountOf(rider);
    const valid = sealer.seal({ ...claims, accountId: riderAccount });
    const labelled = group(await postQuote(g.h, rider.accessToken, quoteBody({ ...pair.pickup, placeRef: valid }, pair.dropoff)));
    expect(labelled.options.map((o) => [o.total, o.components])).toEqual(plain.options.map((o) => [o.total, o.components]));
    const other = await signIn(g.h);
    const expired = new PlaceRefSealer(g.h.runtime.cipher, 60, () => new Date(Date.now() - 3_600_000)).seal({ ...claims, accountId: riderAccount });
    const cases: Array<[string, string]> = [
      [`${valid.slice(0, -3)}AAA`, 'PLACE_REF_INVALID'],
      [sealer.seal({ ...claims, accountId: await accountOf(other) }), 'PLACE_REF_INVALID'],
      [sealer.seal({ ...claims, accountId: riderAccount, cityCode: 'KHI' }), 'PLACE_REF_INVALID'],
      [expired, 'PLACE_REF_EXPIRED'],
    ];
    for (const [ref, reason] of cases) {
      const res = await postQuote(g.h, rider.accessToken, quoteBody(pair.pickup, { ...pair.dropoff, placeRef: ref }));
      expect(res.statusCode, reason).toBe(400);
      expect(errorOf(res)?.details?.reasonCodes).toEqual([reason]);
    }
    expect(g.doubles.control.calls('PLACE_RESOLVE')).toBe(before.resolve);
    // the labelled quote reused the cached route of the plain one: no provider call at all for the placeRef
    expect(routeCalls()).toBe(before.route);
    // never persisted
    const stored = await g.h.owner.query<{ t: string }>(`select string_agg(q::text, '|') t from pricing.quotes q`);
    expect(stored.rows[0]?.t).not.toContain('pr1.');
  });

  it('QT-11: a route longer than the card maximum is ROUTE_TOO_LONG (unavailable; 422 when nothing remains)', async () => {
    // a synthetic city whose only card allows 100 m (system-seeded, owner path)
    await g.h.owner.query(`insert into catalog.cities (code, name_en, name_ur, status) values ('SYQ', 'Synthetic quote city', 'مصنوعی', 'ENABLED')`);
    await g.h.owner.query(
      `insert into catalog.city_service_products (city_code, product_code, status, legal_basis_ref, is_synthetic) values ('SYQ', 'ECONOMY', 'ENABLED', 'SYNTHETIC_LOCAL_TEST_ONLY', true)`,
    );
    const set = randomUUID();
    await g.h.owner.query(
      `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference) values ($1, 'SYQ', 1, 'DRAFT', true, 'SYNTHETIC test geometry')`,
      [set],
    );
    await g.h.owner.query(
      `insert into catalog.zones (id, zone_set_id, code, kind, name_en, name_ur, geom) values ($1, $2, 'SYQ-AREA', 'SERVICE_AREA', 'S', 'S', ST_Multi(ST_MakeEnvelope(74.2, 31.4, 74.5, 31.65, 4326)))`,
      [randomUUID(), set],
    );
    for (let d = 0; d < 7; d++) {
      await g.h.owner.query(`insert into catalog.service_hours (id, zone_set_id, weekday, opens_local, closes_local) values ($1, $2, $3, '00:00', '00:00')`, [
        randomUUID(),
        set,
        d,
      ]);
    }
    await g.h.owner.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [set]);
    const card = randomUUID();
    await g.h.owner.query(
      `insert into pricing.rate_cards (id, city_code, product_code, version, status, is_synthetic, source_reference) values ($1, 'SYQ', 'ECONOMY', 1, 'DRAFT', true, $2)`,
      [card, P.sourceReference],
    );
    await g.h.owner.query(
      `insert into pricing.rate_card_components (rate_card_id, base_minor, per_km_minor, per_min_minor, minimum_fare_minor, booking_fee_minor, airport_pickup_fee_minor,
                                                 rounding_step_minor, rounding_mode, toll_policy, tax_policy_id, quote_ttl_seconds, max_distance_m, max_duration_s)
       values ($1, 10000, 3500, 500, 25000, 1000, 0, 1000, 'HALF_UP', 'NOT_APPLICABLE', $2, 300, 100, 7200)`,
      [card, P.taxPolicyId],
    );
    await g.h.owner.query(`update pricing.rate_cards set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [card]);
    const res = await postQuote(g.h, rider.accessToken, { ...quoteBody(fresh().pickup, fresh().dropoff), cityCode: 'SYQ' });
    expect(res.statusCode, res.body).toBe(422);
    expect(errorOf(res)?.details?.reasonCodes).toEqual(['ROUTE_TOO_LONG']);
    expect(await g.h.owner.query(`select 1 from pricing.quotes where city_code = 'SYQ'`)).toMatchObject({ rowCount: 0 });
  });

  it('OUTSIDE_SERVICE_HOURS carries the next opening instant; NO_ACTIVE_RATE_CARD when the city product has no card', async () => {
    await g.h.owner.query(`insert into catalog.cities (code, name_en, name_ur, status) values ('SYH', 'Synthetic hours city', 'مصنوعی', 'ENABLED')`);
    await g.h.owner.query(
      `insert into catalog.city_service_products (city_code, product_code, status, legal_basis_ref, is_synthetic) values
         ('SYH', 'ECONOMY', 'ENABLED', 'SYNTHETIC_LOCAL_TEST_ONLY', true), ('SYH', 'COMFORT', 'ENABLED', 'SYNTHETIC_LOCAL_TEST_ONLY', true)`,
    );
    const set = randomUUID();
    await g.h.owner.query(
      `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference) values ($1, 'SYH', 1, 'DRAFT', true, 'SYNTHETIC test geometry')`,
      [set],
    );
    await g.h.owner.query(
      `insert into catalog.zones (id, zone_set_id, code, kind, name_en, name_ur, geom) values ($1, $2, 'SYH-AREA', 'SERVICE_AREA', 'S', 'S', ST_Multi(ST_MakeEnvelope(74.2, 31.4, 74.5, 31.65, 4326)))`,
      [randomUUID(), set],
    );
    // ECONOMY opens only on a weekday three days from today (Asia/Karachi), COMFORT all day
    const closedDay = (Number((await g.h.owner.query<{ d: number }>(`select extract(dow from now() at time zone 'Asia/Karachi')::int d`)).rows[0]?.d) + 3) % 7;
    await g.h.owner.query(
      `insert into catalog.service_hours (id, zone_set_id, product_code, weekday, opens_local, closes_local) values ($1, $2, 'ECONOMY', $3, '10:00', '11:00')`,
      [randomUUID(), set, closedDay],
    );
    for (let d = 0; d < 7; d++) {
      await g.h.owner.query(
        `insert into catalog.service_hours (id, zone_set_id, product_code, weekday, opens_local, closes_local) values ($1, $2, 'COMFORT', $3, '00:00', '00:00')`,
        [randomUUID(), set, d],
      );
    }
    await g.h.owner.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [set]);
    const calls = routeCalls();
    const res = await postQuote(g.h, rider.accessToken, { ...quoteBody(fresh().pickup, fresh().dropoff), cityCode: 'SYH' });
    expect(res.statusCode, res.body).toBe(422);
    const err = errorOf(res);
    expect(err?.details?.reasonCodes?.sort()).toEqual(['NO_ACTIVE_RATE_CARD', 'OUTSIDE_SERVICE_HOURS']);
    expect(new Date(err?.details?.nextOpenAt ?? 0).getTime()).toBeGreaterThan(Date.now() + 86_400_000);
    expect(routeCalls()).toBe(calls);
  });

  it('QT-06: status is computed from server time on restore (EXPIRED); nothing extends expiry', async () => {
    const q = group(await postQuote(g.h, rider.accessToken, quoteBody(fresh().pickup, fresh().dropoff)));
    // a second, already-expired group of the same account written through the database (the TTL floor is 60 s)
    const expiredGroup = randomUUID();
    const source = await g.h.owner.query<{ id: string }>(`select id from pricing.quotes where quote_group_id = $1 and product_code = 'ECONOMY'`, [
      q.quoteGroupId,
    ]);
    const quoteId = randomUUID();
    const c = await g.h.owner.connect();
    await c.query('begin');
    await c.query(
      `insert into pricing.quotes (id, quote_group_id, account_id, city_code, product_code, rate_card_id, rate_card_version, zone_set_id, pricing_engine_version, pickup,
                                   dropoff, pickup_point_id, airport_pickup, distance_m, duration_s, route_snapshot_id, currency, total_minor, toll_policy, is_synthetic,
                                   status, created_at, expires_at, request_hash)
       select $1, $2, account_id, city_code, product_code, rate_card_id, rate_card_version, zone_set_id, pricing_engine_version, pickup, dropoff, pickup_point_id,
              airport_pickup, distance_m, duration_s, route_snapshot_id, currency, total_minor, toll_policy, is_synthetic, 'PRICED', now() - interval '10 minutes',
              now() - interval '5 minutes', request_hash from pricing.quotes where id = $3`,
      [quoteId, expiredGroup, source.rows[0]?.id],
    );
    await c.query(
      `insert into pricing.quote_components (quote_id, seq, kind, amount_minor, basis) select $1, seq, kind, amount_minor, basis from pricing.quote_components where quote_id = $2`,
      [quoteId, source.rows[0]?.id],
    );
    await c.query('commit');
    c.release();
    const restored = group(await getQuote(g.h, rider.accessToken, expiredGroup));
    expect(restored.options.map((o) => o.status)).toEqual(['EXPIRED']);
    expect((await g.h.owner.query(`select status from pricing.quotes where id = $1`, [quoteId])).rows).toEqual([{ status: 'PRICED' }]);
  });

  it('QT-17: a newer group supersedes the older unexpired groups of the same account (rows kept); another account is unaffected', async () => {
    const u = await signIn(g.h);
    const other = await signIn(g.h);
    const a = group(await postQuote(g.h, u.accessToken, quoteBody(fresh().pickup, fresh().dropoff)));
    const o = group(await postQuote(g.h, other.accessToken, quoteBody(fresh().pickup, fresh().dropoff)));
    const b = group(await postQuote(g.h, u.accessToken, quoteBody(fresh().pickup, fresh().dropoff)));
    expect(group(await getQuote(g.h, u.accessToken, a.quoteGroupId)).options.every((x) => x.status === 'SUPERSEDED')).toBe(true);
    expect(group(await getQuote(g.h, u.accessToken, b.quoteGroupId)).options.every((x) => x.status === 'PRICED')).toBe(true);
    expect(group(await getQuote(g.h, other.accessToken, o.quoteGroupId)).options.every((x) => x.status === 'PRICED')).toBe(true);
  });

  it('QT-05 / QT-16: a foreign group is the same 404 as a random id; no session is 401', async () => {
    const q = group(await postQuote(g.h, rider.accessToken, quoteBody(fresh().pickup, fresh().dropoff)));
    const other = await signIn(g.h);
    const foreign = await getQuote(g.h, other.accessToken, q.quoteGroupId);
    const random = await getQuote(g.h, other.accessToken, randomUUID());
    expect(foreign.statusCode).toBe(404);
    expect(random.statusCode).toBe(404);
    expect(errorOf(foreign)?.code).toBe(errorOf(random)?.code);
    expect((await getQuote(g.h, other.accessToken, 'not-a-uuid')).statusCode).toBe(404);
    expect((await getQuote(g.h, null, q.quoteGroupId)).statusCode).toBe(401);
    expect((await postQuote(g.h, null, quoteBody())).statusCode).toBe(401);
  });

  it('CONC-PRICING: two concurrent quotes of one account leave exactly one PRICED group; one key concurrently ⇒ one group', async () => {
    const u = await signIn(g.h);
    const pairs = [fresh(), fresh()];
    const results = await Promise.all(pairs.map((p) => postQuote(g.h, u.accessToken, quoteBody(p.pickup, p.dropoff))));
    expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
    const live = await g.h.owner.query<{ n: number }>(
      `select count(distinct quote_group_id)::int n from pricing.quotes q join identity.sessions s on s.account_id = q.account_id where s.id = $1 and q.status = 'PRICED'`,
      [u.sessionId],
    );
    expect(live.rows[0]?.n).toBe(1);
    const k = key();
    const body = quoteBody(fresh().pickup, fresh().dropoff);
    const same = await Promise.all([postQuote(g.h, u.accessToken, body, { key: k }), postQuote(g.h, u.accessToken, body, { key: k })]);
    expect(same.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(group(same[0] as never).quoteGroupId).toBe(group(same[1] as never).quoteGroupId);
    expect(same.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(1);
  });

  it('runtime switch rider.quotes in its safe state stops new quotes (FEATURE_DISABLED); restore keeps working', async () => {
    const q = group(await postQuote(g.h, rider.accessToken, quoteBody(fresh().pickup, fresh().dropoff)));
    const id = randomUUID();
    await g.h.owner.query(
      `insert into platform.runtime_switches (id, key, scope, city_code, state, reason_code) values ($1, 'rider.quotes', 'ALL', null, 'DISABLED', 'OPS_INCIDENT')`,
      [id],
    );
    await new Promise((r) => setTimeout(r, 1200));
    const calls = routeCalls();
    const stopped = await postQuote(g.h, rider.accessToken, quoteBody(fresh().pickup, fresh().dropoff));
    expect(errorOf(stopped)?.code).toBe('WAYVRO_E_FEATURE_DISABLED');
    expect(routeCalls()).toBe(calls);
    expect((await getQuote(g.h, rider.accessToken, q.quoteGroupId)).statusCode).toBe(200);
    await g.h.owner.query(`update platform.runtime_switches set state = 'ENABLED', version = version + 1 where id = $1`, [id]);
    await new Promise((r) => setTimeout(r, 1200));
    expect((await postQuote(g.h, rider.accessToken, quoteBody(fresh().pickup, fresh().dropoff))).statusCode).toBe(201);
  });
});

describe('QT-12 / RL: default per-account limit and the per-IP-prefix limit (own harness)', () => {
  it('the 21st quote of an account within a minute is 429 QUOTE_RATE_LIMITED with Retry-After (refusals count); the IP prefix has its own limit', async () => {
    const r = await startQuoteApi({ env: { QUOTES_PER_MINUTE_IP_PREFIX: '25' } });
    try {
      const u = await signIn(r.h);
      for (let i = 0; i < 20; i++) {
        // cheap refusals (no provider call) count against the limit like any other request
        expect((await postQuote(r.h, u.accessToken, quoteBody({ lat: 31.52, lng: 74.35 }, { lat: 31.5201, lng: 74.35 }))).statusCode).toBe(400);
      }
      const limited = await postQuote(r.h, u.accessToken, quoteBody());
      expect(limited.statusCode).toBe(429);
      expect(errorOf(limited)).toMatchObject({ code: 'WAYVRO_E_RATE_LIMITED', details: { reasonCodes: ['QUOTE_RATE_LIMITED'] } });
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      // another account from the same IP prefix: 4 more requests fit (20 + 4 + the denied one consumed nothing), then the prefix is full
      const v = await signIn(r.h);
      for (let i = 0; i < 5; i++)
        expect((await postQuote(r.h, v.accessToken, quoteBody({ lat: 31.52, lng: 74.35 }, { lat: 31.5201, lng: 74.35 }))).statusCode).toBe(400);
      expect((await postQuote(r.h, v.accessToken, quoteBody())).statusCode).toBe(429);
    } finally {
      await r.h.close();
    }
  }, 120_000);
});

describe('routing outage (FAULT-GEO through the quote path; E07/T3-13): refused, nothing invented, nothing persisted', () => {
  it.each(['UPSTREAM_5XX', 'CONNECT_ERROR', 'MALFORMED', 'PARTIAL', 'EMPTY', 'TIMEOUT'] as const)(
    '%s ⇒ 503 ROUTING_UNAVAILABLE with zero quote rows; the same key then succeeds for real',
    async (mode) => {
      const before = await quoteRows(g.h);
      const k = key();
      const body = quoteBody(fresh().pickup, fresh().dropoff);
      g.doubles.control.setFault('ROUTE', { mode, times: 1 });
      const refused = await postQuote(g.h, rider.accessToken, body, { key: k });
      expect(refused.statusCode, refused.body).toBe(503);
      expect(errorOf(refused)).toMatchObject({ code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE', details: { reasonCodes: ['ROUTING_UNAVAILABLE'] } });
      expect(refused.body).not.toMatch(/distanceM|durationS|"minor"/);
      expect(await quoteRows(g.h)).toEqual(before);
      g.doubles.control.clearFaults();
      expect((await postQuote(g.h, rider.accessToken, body, { key: k })).statusCode).toBe(201);
    },
    20_000,
  );

  it('an unbound routing port refuses every quote (503) and writes nothing', async () => {
    const u = await startGeoApi({ bind: ['placesAutocomplete', 'geocoding', 'reverseGeocoding'] });
    try {
      await seedQuotes(u.h);
      const s = await signIn(u.h);
      const res = await postQuote(u.h, s.accessToken, quoteBody());
      expect(errorOf(res)).toMatchObject({ code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE', details: { reasonCodes: ['ROUTING_UNAVAILABLE'] } });
      expect(await quoteRows(u.h)).toEqual({ quotes: 0, snapshots: 0, components: 0 });
      expect(u.h.logs.text()).toContain('QUOTE_ROUTING_UNAVAILABLE');
    } finally {
      await u.h.close();
    }
  }, 120_000);
});

describe('service-level fail-closed rules (T3-31; limiter down)', () => {
  const service = (env: 'test' | 'production', limiter: RateLimiter, logger = log) =>
    new QuoteService({
      db: g.h.runtime.db.pool,
      idempotency: new IdempotencyStore(g.h.runtime.db.pool, g.h.runtime.cipher),
      limiter,
      switches: g.switches,
      catalog: new CatalogReadModel(g.h.runtime.db.pool, { PICKUP_SNAP_MAX_METERS: 300 }),
      routing: g.h.runtime.geo.routing,
      placeRefs: new PlaceRefSealer(g.h.runtime.cipher, 900),
      policy: {
        WAYVRO_ENV: env,
        QUOTE_DEADLINE_MS: 3000,
        QUOTES_PER_MINUTE_ACCOUNT: 1000,
        QUOTES_PER_DAY_ACCOUNT: 1000,
        QUOTES_PER_MINUTE_IP_PREFIX: 1000,
        QUOTE_IDEMPOTENCY_TTL_SECONDS: 900,
      },
      log: logger,
    });
  const request = (accountId: string) => ({
    accountId,
    request: quoteBody(fresh().pickup, fresh().dropoff),
    detail: 'full' as const,
    key: key(),
    clientIp: '127.0.0.1',
  });

  it('QT-15 (defence in depth): a production profile refuses to price with synthetic/placeholder configuration — 503 + QUOTE_SYNTHETIC_CONFIG_REFUSED, nothing written', async () => {
    const redis = createRequestPathRedis(process.env['REDIS_URL'] ?? '', 2000);
    // a request-path client has no offline queue: wait until it is connected so only the production rule can refuse
    expect(await awaitRedisReady(redis, 10_000)).toBe(true);
    const logs = captureLogs();
    try {
      const before = await quoteRows(g.h);
      const prod = service(
        'production',
        new RateLimiter(redis, `${g.h.keyPrefix}svc:`),
        createLogger({ service: 'api', env: 'test', level: 'info', destination: logs.stream }),
      );
      await expect(prod.create(request(await accountOf(rider)))).rejects.toMatchObject({
        code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE',
        details: { reasonCodes: ['PRICING_CONFIG_REFUSED'] },
      });
      expect(logs.text()).toContain('QUOTE_SYNTHETIC_CONFIG_REFUSED');
      expect(await quoteRows(g.h)).toEqual(before);
    } finally {
      redis.disconnect();
    }
  });

  it('limiter store unavailable ⇒ 503 before any work (fail closed)', async () => {
    const dead = createRequestPathRedis('redis://127.0.0.1:1', 200);
    try {
      const calls = routeCalls();
      await expect(service('test', new RateLimiter(dead, 'wv:dead:')).create(request(await accountOf(rider)))).rejects.toMatchObject({
        code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE',
        details: { reasonCodes: ['ROUTING_UNAVAILABLE'] },
      });
      expect(routeCalls()).toBe(calls);
    } finally {
      dead.disconnect();
    }
  });
});

describe('LOG-GEO canary through the quote paths (T3-28): no coordinates in logs, error bodies, audit rows or jobs', () => {
  it('sentinel coordinates never leave the request', async () => {
    const lat = 31.5204917;
    const lng = 74.3587123;
    const body = quoteBody({ lat, lng }, { lat: 31.4704917, lng: 74.2787123 });
    const bodies: string[] = [];
    const ok = await postQuote(g.h, rider.accessToken, body);
    expect(ok.statusCode).toBe(201);
    bodies.push((await getQuote(g.h, rider.accessToken, group(ok).quoteGroupId)).body);
    g.doubles.control.setFault('ROUTE', { mode: 'UPSTREAM_5XX', times: 1 });
    bodies.push((await postQuote(g.h, rider.accessToken, quoteBody({ lat: 31.5214917, lng }, { lat: 31.4714917, lng: 74.2787123 }))).body);
    g.doubles.control.clearFaults();
    bodies.push((await postQuote(g.h, rider.accessToken, quoteBody({ lat, lng }, { lat: 31.5205, lng: 74.3587 }))).body);
    bodies.push((await postQuote(g.h, rider.accessToken, { ...body, fare: 1 })).body);
    bodies.push((await postQuote(g.h, rider.accessToken, quoteBody({ lat: 31.7004917, lng }, { lat, lng }))).body);
    const forbidden = ['31.5204', '74.3587', '31.4704', '74.2787', '31.5214', '31.7004', '31.52049', '74.35871'];
    const logText = g.h.logs.text();
    for (const f of forbidden) expect(logText, `log contains ${f}`).not.toContain(f);
    for (const b of bodies.filter((x) => x.includes('"error"'))) for (const f of forbidden) expect(b).not.toContain(f);
    expect(logText).toContain('"route":"/v1/quotes"');
    expect(logText).toContain('QUOTE_SCHEMA_REJECTED');
    const audit = await g.h.owner.query<{ t: string }>(`select coalesce(string_agg(a::text, '|'), '') t from audit.audit_events a`);
    const jobs = await g.h.owner.query<{ t: string }>(`select coalesce(string_agg(j::text, '|'), '') t from platform.jobs j`);
    const outbox = await g.h.owner.query<{ t: string }>(`select coalesce(string_agg(o::text, '|'), '') t from platform.outbox_events o`);
    for (const t of [audit.rows[0]?.t ?? '', jobs.rows[0]?.t ?? '', outbox.rows[0]?.t ?? '']) for (const f of forbidden) expect(t).not.toContain(f);
  });
});
