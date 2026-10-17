/**
 * Geo gateway end to end (Phase 3 P3.2) against real PostgreSQL + Valkey with the synthetic MOCK geo doubles:
 * session/authz, placeRef sealing (UNIT-PLACEREF via HTTP), FAULT-GEO FG-01..10, CACHE-STALE CS-01..07, RL (geo),
 * BRK through the gateway, BUD-05 (Valkey down ⇒ fail closed), BUD-07 (switch), the routing service for pricing and the
 * LOG-GEO canary. Synthetic data only: a fixed gazetteer of public-landmark-level places, sentinel coordinates.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { AutocompleteResultSchema, ResolvedPlaceSchema, ReverseGeocodeResultSchema } from '@wayvro/contracts';
import { FieldCipher, KeyedHasher, localKeyRing } from '@wayvro/field-crypto';
import { WayvroError, createLogger } from '@wayvro/observability';
import { assertGeoBundle, bindProviders } from '@wayvro/provider-interfaces';
import { CircuitBreaker, GeoUsageCounters, RateLimiter, awaitRedisReady, createRequestPathRedis } from '@wayvro/server-runtime';
import { captureLogs } from '@wayvro/test-support';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadApiConfig } from '../src/config.js';
import { ValkeyBreakerHints } from '../src/geo/breaker-hints.js';
import { GeoBudgetGuard } from '../src/geo/budgets.js';
import { GeoCache } from '../src/geo/cache.js';
import { GeoGateway } from '../src/geo/gateway.js';
import { PlaceRefSealer } from '../src/geo/place-ref.js';
import { GeoProviderCaller } from '../src/geo/provider-call.js';
import { GeoReference } from '../src/geo/reference.js';
import { GeoRouting, RoutingUnavailableError } from '../src/geo/routing.js';
import {
  SESSION,
  TestServiceArea,
  TestSwitches,
  autocompleteUrl,
  geoGet,
  placeUrl,
  reasonCodes,
  reverseUrl,
  startGeoApi,
  type GeoHarness,
} from './geo-helpers.js';
import { signIn, type SignedIn } from './support.js';

const REDIS_URL = process.env['REDIS_URL'] ?? '';
const SEED = 'synthetic-api-integration-seed-0000000000'; // the harness key seed (support.ts)
const FAST = {
  GEO_AUTOCOMPLETE_TIMEOUT_MS: '300',
  GEO_GEOCODE_TIMEOUT_MS: '300',
  GEO_REVERSE_TIMEOUT_MS: '300',
  GEO_ROUTE_TIMEOUT_MS: '300',
  GEO_RETRY_SLACK_MS: '400',
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A connected Valkey client for assertions (request-path clients have no offline queue). */
async function valkey(): Promise<ReturnType<typeof createRequestPathRedis>> {
  const redis = createRequestPathRedis(REDIS_URL, 2000);
  if (!(await awaitRedisReady(redis, 5000))) throw new Error('valkey not reachable');
  return redis;
}
const codeOf = (res: LightMyRequestResponse): string | undefined => res.json<{ error?: { code: string } }>().error?.code;
const unique = (): string => `q${randomBytes(4).toString('hex')}`;

let g: GeoHarness;
let user: SignedIn;
beforeAll(async () => {
  // breaker effectively off in this harness (it is exercised in its own harness below)
  g = await startGeoApi({ env: { ...FAST, GEO_BREAKER_MIN_CALLS: '1000', GEO_BREAKER_CONSECUTIVE_TIMEOUTS: '100' } });
  user = await signIn(g.h);
}, 120_000);
afterAll(async () => {
  await g.h.close();
});

describe('session and authz', () => {
  it('no session ⇒ 401 on every geo route (no pre-sign-in geo)', async () => {
    for (const url of [autocompleteUrl('liberty'), reverseUrl(31.51, 74.341), placeUrl(`pr1.${'A'.repeat(60)}`)]) {
      const res = await geoGet(g.h, url, null);
      expect(res.statusCode, url).toBe(401);
    }
    expect(g.doubles.control.calls('AUTOCOMPLETE')).toBe(0);
  });

  it('strict input: unknown fields, short queries, half a bias, disabled city and points outside Pakistan are 400', async () => {
    await g.h.owner.query(`insert into catalog.cities (code, name_en, name_ur, status) values ('KHI', 'Karachi', 'کراچی', 'DISABLED') on conflict do nothing`);
    const cases: Array<[string, string | null]> = [
      [`${autocompleteUrl('liberty')}&fare=100`, null],
      // query length bounds (3..80 after trimming): empty, blank and over-long queries never reach the provider
      [autocompleteUrl(''), null],
      [autocompleteUrl('     '), null],
      [autocompleteUrl('l'.repeat(81)), null],
      // no paging/batch parameters exist (strict query objects)
      [`${autocompleteUrl('liberty')}&page=2`, null],
      [`${autocompleteUrl('liberty')}&limit=50`, null],
      [`${reverseUrl(31.51, 74.341)}&limit=5`, null],
      [autocompleteUrl('!!a'), 'QUERY_TOO_SHORT'],
      [autocompleteUrl('liberty', { biasLat: '31.5' }), 'BIAS_INCOMPLETE'],
      [autocompleteUrl('liberty', { cityCode: 'KHI' }), 'CITY_NOT_ENABLED'],
      [autocompleteUrl('liberty', { biasLat: '51.5', biasLng: '-0.12' }), 'OUTSIDE_COUNTRY'],
      [reverseUrl(51.5, -0.12), 'OUTSIDE_COUNTRY'],
    ];
    for (const [url, reason] of cases) {
      const res = await geoGet(g.h, url, user.accessToken);
      expect(res.statusCode, url).toBe(400);
      expect(codeOf(res)).toBe('WAYVRO_E_VALIDATION');
      if (reason) expect(reasonCodes(res)).toEqual([reason]);
    }
    expect(g.doubles.control.calls('AUTOCOMPLETE') + g.doubles.control.calls('REVERSE_GEOCODE')).toBe(0);
  });

  it('BUD-07: a SKU switch in its safe state refuses immediately with zero provider calls', async () => {
    g.switches.stopped.add('platform.geo-autocomplete');
    g.switches.stopped.add('platform.geo-reverse');
    try {
      const before = g.doubles.control.calls('AUTOCOMPLETE');
      const ac = await geoGet(g.h, autocompleteUrl(unique()), user.accessToken);
      expect(ac.statusCode).toBe(404);
      expect(codeOf(ac)).toBe('WAYVRO_E_FEATURE_DISABLED');
      expect((await geoGet(g.h, reverseUrl(31.51, 74.341), user.accessToken)).statusCode).toBe(404);
      expect(g.doubles.control.calls('AUTOCOMPLETE')).toBe(before);
    } finally {
      g.switches.stopped.clear();
    }
  });
});

describe('autocomplete, placeRef and resolve', () => {
  it('suggestions (≤ 5) with sealed placeRefs and provenance; the identical query is a cache HIT; no-store', async () => {
    const res = await geoGet(g.h, autocompleteUrl('lahore'), user.accessToken);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = AutocompleteResultSchema.parse(res.json());
    expect(body.suggestions).toHaveLength(5);
    expect(body.source).toMatchObject({ providerKey: 'geo-mock', cacheStatus: 'MISS', attributionCode: 'SYNTHETIC_DATA', confidence: 'UNKNOWN' });
    expect(res.body).not.toContain('syn-lhr-');
    const calls = g.doubles.control.calls('AUTOCOMPLETE');
    const again = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl('  LAHORE '), user.accessToken)).json());
    expect(again.source.cacheStatus).toBe('HIT');
    expect(again.source.fetchedAt).toBe(body.source.fetchedAt);
    expect(g.doubles.control.calls('AUTOCOMPLETE')).toBe(calls);
    // cached candidates are re-sealed per response (fresh tokens)
    expect(again.suggestions[0]?.placeRef).not.toBe(body.suggestions[0]?.placeRef);
    // result cap: the synthetic provider answers 8 candidates for this query; the gateway returns 5
    const raw = await g.doubles.placesAutocomplete.suggest(
      { text: 'lahore', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION },
      new AbortController().signal,
    );
    expect(raw).toHaveLength(8);
    expect(Object.keys(body).sort()).toEqual(['source', 'suggestions']);
  });

  it('resolve: point, landmark-first label, service-area flag; the provider sees the place id, never the account', async () => {
    const ac = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl('liberty'), user.accessToken)).json());
    const ref = ac.suggestions[0]?.placeRef ?? '';
    const res = await geoGet(g.h, placeUrl(ref), user.accessToken);
    expect(res.statusCode, res.body).toBe(200);
    const place = ResolvedPlaceSchema.parse(res.json());
    expect(place).toMatchObject({ point: { lat: 31.51, lng: 74.341 }, primaryText: 'Liberty Market', districtCode: null, inServiceArea: true });
    const input = g.doubles.control.inputs('PLACE_RESOLVE').at(-1);
    expect(input).toEqual({ providerPlaceId: 'syn-lhr-001', searchSessionId: SESSION, locale: 'en' });
    expect(JSON.stringify(g.doubles.control.inputs('AUTOCOMPLETE'))).not.toContain(user.sessionId);
  });

  it('tampered, foreign, expired, stale and malformed placeRefs are 400 with typed reasons and no provider call', async () => {
    const ac = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl('emporium'), user.accessToken)).json());
    const ref = ac.suggestions[0]?.placeRef ?? '';
    const other = await signIn(g.h);
    const raw = Buffer.from(ref.slice(4), 'base64url');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0x01;
    const cipher = new FieldCipher(localKeyRing(SEED));
    const accountId = await accountOf(user);
    const expired = new PlaceRefSealer(cipher, 60, () => new Date(Date.now() - 3_600_000)).seal({
      providerKey: 'geo-mock',
      sku: 'AUTOCOMPLETE',
      placeId: 'syn-lhr-008',
      accountId,
      cityCode: 'LHR',
    });
    const stale = new PlaceRefSealer(cipher, 900).seal({ providerKey: 'geo-old', sku: 'AUTOCOMPLETE', placeId: 'syn-lhr-008', accountId, cityCode: 'LHR' });
    const before = g.doubles.control.calls('PLACE_RESOLVE');
    const cases: Array<[string, string, string]> = [
      [`pr1.${raw.toString('base64url')}`, user.accessToken, 'PLACE_REF_INVALID'],
      [ref, other.accessToken, 'PLACE_REF_INVALID'],
      [expired, user.accessToken, 'PLACE_REF_EXPIRED'],
      [stale, user.accessToken, 'PLACE_REF_STALE'],
      ['not-a-place-ref', user.accessToken, 'PLACE_REF_INVALID'],
    ];
    for (const [token, bearerToken, reason] of cases) {
      const res = await geoGet(g.h, placeUrl(token), bearerToken);
      expect(res.statusCode, reason).toBe(400);
      expect(reasonCodes(res)).toEqual([reason]);
    }
    expect(g.doubles.control.calls('PLACE_RESOLVE')).toBe(before);
    expect(g.h.logs.text()).toContain('PLACEREF_REJECTED');
    // an over-long path parameter is refused by the router with the standard envelope — the path is never echoed
    const long = `pr1.${'B'.repeat(700)}`;
    const tooLong = await geoGet(g.h, placeUrl(long), user.accessToken);
    expect(tooLong.statusCode).toBe(400);
    expect(codeOf(tooLong)).toBe('WAYVRO_E_VALIDATION');
    expect(tooLong.body).not.toContain('BBBB');
    expect(tooLong.headers['x-request-id']).toBeDefined();
  });

  it('GEOCODE mode ("type the full address"): held results resolve without another provider call', async () => {
    const res = await geoGet(g.h, autocompleteUrl('model town', { mode: 'GEOCODE' }), user.accessToken);
    expect(res.statusCode, res.body).toBe(200);
    const body = AutocompleteResultSchema.parse(res.json());
    expect(body.suggestions[0]?.primaryText).toBe('Model Town');
    const resolves = g.doubles.control.calls('PLACE_RESOLVE');
    const place = ResolvedPlaceSchema.parse((await geoGet(g.h, placeUrl(body.suggestions[0]?.placeRef ?? ''), user.accessToken)).json());
    expect(place).toMatchObject({ point: { lat: 31.483, lng: 74.326 }, primaryText: 'Model Town', inServiceArea: true });
    expect(g.doubles.control.calls('PLACE_RESOLVE')).toBe(resolves);
  });

  it('A06: an ACTIVE landmark alias expands before the provider call; a proposed one does not', async () => {
    const staffId = randomUUID();
    const approver = randomUUID();
    for (const id of [staffId, approver]) {
      await g.h.owner.query(`insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'S', $2, 'ACTIVE', now())`, [
        id,
        `s-${id.slice(0, 8)}@example.org`,
      ]);
    }
    const alias = (normalised: string, canonical: string) =>
      g.h.owner.query<{ id: string }>(
        `insert into geo.landmark_aliases (id, city_code, locale, alias_normalised, alias_display, canonical_query, source, status, created_by_staff_id)
         values ($1, 'LHR', 'ur', $2, $2, $3, 'FOUNDER', 'PROPOSED', $4) returning id`,
        [randomUUID(), normalised, canonical, staffId],
      );
    const active = (await alias('qaddafi ground', 'Gaddafi Stadium')).rows[0]?.id;
    await g.h.owner.query(`update geo.landmark_aliases set status = 'ACTIVE', approved_by_staff_id = $2 where id = $1`, [active, approver]);
    await alias('libarti', 'liberty market'); // stays PROPOSED
    const before = g.doubles.control.inputs('AUTOCOMPLETE').length;
    const expanded = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl('Qaddafi  Ground', { locale: 'ur' }), user.accessToken)).json());
    expect(expanded.suggestions[0]?.primaryText).toBe('Gaddafi Stadium');
    const proposed = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl('libarti', { locale: 'ur' }), user.accessToken)).json());
    expect(proposed.suggestions).toEqual([]);
    const sent = (g.doubles.control.inputs('AUTOCOMPLETE').slice(before) as Array<{ text: string }>).map((s) => s.text);
    expect(sent).toEqual(['gaddafi stadium', 'libarti']);
  });
});

async function accountOf(s: SignedIn): Promise<string> {
  const r = await g.h.owner.query<{ account_id: string }>(`select account_id from identity.sessions where id = $1`, [s.sessionId]);
  const id = r.rows[0]?.account_id;
  if (!id) throw new Error('session not found');
  return id;
}

describe('reverse geocoding', () => {
  it('rounds to 4 decimals for the provider and the cache key (CS-04): 3 m apart share an entry, 30 m apart do not', async () => {
    const first = await geoGet(g.h, reverseUrl(31.5100213, 74.3410217), user.accessToken);
    expect(first.statusCode, first.body).toBe(200);
    const body = ReverseGeocodeResultSchema.parse(first.json());
    expect(body).toMatchObject({
      address: { primaryText: 'Liberty Market', landmarkText: 'Liberty Market' },
      inServiceArea: true,
      source: { cacheStatus: 'MISS' },
    });
    // result cap: exactly one formatted address (an object, never a list), nothing else
    expect(Object.keys(first.json<Record<string, unknown>>()).sort()).toEqual(['address', 'inServiceArea', 'source']);
    expect(Array.isArray(body.address)).toBe(false);
    expect(g.doubles.control.inputs('REVERSE_GEOCODE').at(-1)).toEqual({ point: { lat: 31.51, lng: 74.341 }, locale: 'en' });
    expect(g.serviceArea.calls.at(-1)).toEqual({ cityCode: 'LHR', lat: 31.51, lng: 74.341 });
    const near = ReverseGeocodeResultSchema.parse((await geoGet(g.h, reverseUrl(31.5100412, 74.3410391), user.accessToken)).json());
    expect(near.source.cacheStatus).toBe('HIT');
    const far = ReverseGeocodeResultSchema.parse((await geoGet(g.h, reverseUrl(31.5103, 74.341), user.accessToken)).json());
    expect(far.source.cacheStatus).toBe('MISS');
  });

  it('no address ⇒ address null (never invented); a Pakistan point outside the synthetic service area ⇒ inServiceArea false', async () => {
    const res = ReverseGeocodeResultSchema.parse((await geoGet(g.h, reverseUrl(24.86, 67.01), user.accessToken)).json());
    expect(res.address).toBeNull();
    expect(res.inServiceArea).toBe(false);
  });

  it('CS-07: the autocomplete key uses the 2-decimal bias cell; fine coordinates never reach the provider', async () => {
    const q = 'packages';
    const a = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl(q, { biasLat: '31.47123', biasLng: '74.35678' }), user.accessToken)).json());
    expect(a.source.cacheStatus).toBe('MISS');
    expect((g.doubles.control.inputs('AUTOCOMPLETE').at(-1) as { biasCell: unknown }).biasCell).toEqual({ lat: 31.47, lng: 74.36 });
    const b = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl(q, { biasLat: '31.46987', biasLng: '74.36321' }), user.accessToken)).json());
    expect(b.source.cacheStatus).toBe('HIT');
  });
});

describe('FAULT-GEO through the gateway', () => {
  let u: SignedIn;
  beforeAll(async () => {
    u = await signIn(g.h);
  });

  async function faulted(mode: Parameters<GeoHarness['doubles']['control']['setFault']>[1], url = autocompleteUrl(unique())) {
    g.doubles.control.setFault('AUTOCOMPLETE', mode);
    const before = g.doubles.control.calls('AUTOCOMPLETE');
    const started = Date.now();
    const res = await geoGet(g.h, url, u.accessToken);
    g.doubles.control.clearFaults();
    return { res, calls: g.doubles.control.calls('AUTOCOMPLETE') - before, ms: Date.now() - started };
  }

  it('FG-02: a connect error is retried once inside the deadline; 5xx is never retried', async () => {
    const once = await faulted({ mode: 'CONNECT_ERROR', times: 1 }, autocompleteUrl('anarkali'));
    expect(once.res.statusCode, once.res.body).toBe(200);
    expect(once.calls).toBe(2);
    const always = await faulted({ mode: 'CONNECT_ERROR' });
    expect(always.res.statusCode).toBe(503);
    expect(always.calls).toBe(2);
    expect(reasonCodes(always.res)).toEqual(['GEO_PROVIDER_UNAVAILABLE']);
    const fivexx = await faulted({ mode: 'UPSTREAM_5XX' });
    expect(fivexx.res.statusCode).toBe(503);
    expect(fivexx.calls).toBe(1);
  });

  it('FG-01/FG-04: timeouts and slow drips end at the SKU timeout (total time, not idle time); never retried', async () => {
    for (const mode of [{ mode: 'TIMEOUT' as const }, { mode: 'SLOW_DRIP' as const, delayMs: 5000 }]) {
      const r = await faulted(mode);
      expect(r.res.statusCode).toBe(503);
      expect(r.calls).toBe(1);
      expect(r.ms).toBeLessThan(3000); // deadline 700 ms (+ machine load), far below the 5 s drip and 60 s hang
    }
    expect(g.h.logs.text()).toContain('GEO_PROVIDER_TIMEOUT');
  });

  it('FG-03: a malformed payload is a provider failure; nothing partial is returned', async () => {
    const r = await faulted({ mode: 'MALFORMED' }, autocompleteUrl('liberty market'));
    expect(r.res.statusCode).toBe(503);
    expect(g.h.logs.text()).toContain('GEO_PROVIDER_SCHEMA_FAIL');
  });

  it('FG-05: a provider quota answer cools the SKU down (no provider call) without tripping the breaker', async () => {
    g.doubles.control.setFault('REVERSE_GEOCODE', { mode: 'QUOTA', retryAfterSeconds: 1 });
    const before = g.doubles.control.calls('REVERSE_GEOCODE');
    expect((await geoGet(g.h, reverseUrl(31.588, 74.31), u.accessToken)).statusCode).toBe(503);
    g.doubles.control.clearFaults();
    const cooled = await geoGet(g.h, reverseUrl(31.593, 74.309), u.accessToken);
    expect(cooled.statusCode).toBe(503);
    expect(g.doubles.control.calls('REVERSE_GEOCODE') - before).toBe(1);
    expect(g.h.logs.text()).toContain('GEO_PROVIDER_QUOTA_EXCEEDED');
    expect(g.h.logs.text()).not.toContain('GEO_BREAKER_OPENED');
    await sleep(1200);
    expect((await geoGet(g.h, reverseUrl(31.593, 74.309), u.accessToken)).statusCode).toBe(200);
  });

  it('FG-06/FG-07: partial and empty results are returned as they are — never padded or invented', async () => {
    const partial = await faulted({ mode: 'PARTIAL' }, autocompleteUrl('gulberg'));
    expect(AutocompleteResultSchema.parse(partial.res.json()).suggestions).toHaveLength(1);
    const empty = await faulted({ mode: 'EMPTY' }, autocompleteUrl('nowhere synthetic'));
    expect(AutocompleteResultSchema.parse(empty.res.json()).suggestions).toEqual([]);
    g.doubles.control.setFault('REVERSE_GEOCODE', { mode: 'PARTIAL' });
    const rev = ReverseGeocodeResultSchema.parse((await geoGet(g.h, reverseUrl(31.567, 74.31), u.accessToken)).json());
    g.doubles.control.clearFaults();
    expect(rev.address).toEqual({ primaryText: 'Anarkali Bazaar', secondaryText: null, landmarkText: 'Anarkali Bazaar' });
  });

  it('FG-08: an adapter error echoing the query is mapped to a stable code; the text is never logged or returned', async () => {
    const canary = `echo${randomBytes(6).toString('hex')}`;
    const r = await faulted({ mode: 'ECHO_QUERY' }, autocompleteUrl(canary));
    expect(r.res.statusCode).toBe(503);
    expect(r.res.body).not.toContain(canary);
    expect(g.h.logs.text()).not.toContain(canary);
  });
});

describe('RL (geo parts)', () => {
  it('RL: autocomplete 60/min, reverse 30/min and resolve 30/min per account ⇒ 429 GEO_RATE_LIMITED with retry-after', async () => {
    const u = await signIn(g.h);
    for (let i = 0; i < 60; i++) expect((await geoGet(g.h, autocompleteUrl('liberty'), u.accessToken)).statusCode).toBe(200);
    const limited = await geoGet(g.h, autocompleteUrl('liberty'), u.accessToken);
    expect(limited.statusCode).toBe(429);
    expect(reasonCodes(limited)).toEqual(['GEO_RATE_LIMITED']);
    expect(limited.json<{ error: { details: { retryAfterSeconds: number } } }>().error.details.retryAfterSeconds).toBeGreaterThan(0);
    // GEOCODE mode counts against the same autocomplete limit
    expect((await geoGet(g.h, autocompleteUrl('liberty', { mode: 'GEOCODE' }), u.accessToken)).statusCode).toBe(429);
    for (let i = 0; i < 30; i++) expect((await geoGet(g.h, reverseUrl(31.51, 74.341), u.accessToken)).statusCode).toBe(200);
    expect((await geoGet(g.h, reverseUrl(31.51, 74.341), u.accessToken)).statusCode).toBe(429);
    const v = await signIn(g.h);
    const ref = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl('liberty'), v.accessToken)).json()).suggestions[0]?.placeRef ?? '';
    for (let i = 0; i < 30; i++) expect((await geoGet(g.h, placeUrl(ref), v.accessToken)).statusCode).toBe(200);
    expect((await geoGet(g.h, placeUrl(ref), v.accessToken)).statusCode).toBe(429);
  });
});

describe('RL-IP: per-IP-prefix ceilings (IPv4 /24, IPv6 /56; own harnesses with low ceilings)', () => {
  let r: GeoHarness;
  beforeAll(async () => {
    // TRUST_PROXY stays at its default (false): the socket peer is the client IP
    r = await startGeoApi({
      env: { GEO_AUTOCOMPLETE_PER_MINUTE_IP_PREFIX: '5', GEO_RESOLVE_PER_MINUTE_IP_PREFIX: '3', GEO_REVERSE_PER_MINUTE_IP_PREFIX: '3' },
    });
  }, 120_000);
  afterAll(async () => {
    await r.h.close();
  });
  const from = (h: GeoHarness['h'], url: string, token: string, ip: string, headers: Record<string, string> = {}) =>
    h.inject({ method: 'GET', url, remoteAddress: ip, headers: { authorization: `Bearer ${token}`, ...headers } });

  it('autocomplete: two addresses of one /24 share the ceiling across accounts (429 + retryAfterSeconds); another /24 still succeeds', async () => {
    const [u, v] = [await signIn(r.h), await signIn(r.h)];
    for (let i = 0; i < 3; i++) expect((await from(r.h, autocompleteUrl('liberty'), u.accessToken, '203.0.113.10')).statusCode).toBe(200);
    for (let i = 0; i < 2; i++) expect((await from(r.h, autocompleteUrl('liberty'), v.accessToken, '203.0.113.200')).statusCode).toBe(200);
    // v has used 2 of its 60 per-account calls: the prefix ceiling (5) is what refuses
    const limited = await from(r.h, autocompleteUrl('liberty'), v.accessToken, '203.0.113.77');
    expect(limited.statusCode).toBe(429);
    expect(codeOf(limited)).toBe('WAYVRO_E_RATE_LIMITED');
    expect(reasonCodes(limited)).toEqual(['GEO_RATE_LIMITED']);
    expect(limited.json<{ error: { details: { retryAfterSeconds: number } } }>().error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.h.logs.text()).toMatch(/"signal":"GEO_RATE_LIMITED"[^\n]*"rule":"IP_PREFIX"/);
    // forward geocoding counts against the same ceiling
    expect((await from(r.h, autocompleteUrl('liberty', { mode: 'GEOCODE' }), u.accessToken, '203.0.113.5')).statusCode).toBe(429);
    expect((await from(r.h, autocompleteUrl('liberty'), u.accessToken, '198.51.100.7')).statusCode).toBe(200);
    expect((await from(r.h, autocompleteUrl('liberty'), v.accessToken, '198.51.100.8')).statusCode).toBe(200);
    // the separate reverse ceiling of the full prefix is untouched
    expect((await from(r.h, reverseUrl(31.51, 74.341), u.accessToken, '203.0.113.10')).statusCode).toBe(200);
  });

  it('reverse geocoding: IPv6 addresses of one /56 share the ceiling; the next /56 does not (IPv4-mapped IPv6 = its IPv4 /24)', async () => {
    const u = await signIn(r.h);
    for (const ip of ['2001:db8:abcd:1200::1', '2001:db8:abcd:12ff:ffff::2', '2001:db8:abcd:1234:5678:9abc:def0:1']) {
      expect((await from(r.h, reverseUrl(31.51, 74.341), u.accessToken, ip)).statusCode, ip).toBe(200);
    }
    expect((await from(r.h, reverseUrl(31.51, 74.341), u.accessToken, '2001:db8:abcd:12aa::9')).statusCode).toBe(429);
    expect((await from(r.h, reverseUrl(31.51, 74.341), u.accessToken, '2001:db8:abcd:1300::1')).statusCode).toBe(200);
    for (let i = 0; i < 3; i++) expect((await from(r.h, reverseUrl(31.51, 74.341), u.accessToken, '192.0.2.40')).statusCode).toBe(200);
    expect((await from(r.h, reverseUrl(31.51, 74.341), u.accessToken, '::ffff:192.0.2.41')).statusCode).toBe(429);
  });

  it('place resolution has its own ceiling per prefix', async () => {
    const u = await signIn(r.h);
    const ref =
      AutocompleteResultSchema.parse((await from(r.h, autocompleteUrl('liberty'), u.accessToken, '100.64.20.1')).json()).suggestions[0]?.placeRef ?? '';
    for (let i = 0; i < 3; i++) expect((await from(r.h, placeUrl(ref), u.accessToken, '100.64.20.2')).statusCode).toBe(200);
    expect((await from(r.h, placeUrl(ref), u.accessToken, '100.64.20.3')).statusCode).toBe(429);
    expect((await from(r.h, placeUrl(ref), u.accessToken, '100.64.21.3')).statusCode).toBe(200);
  });

  it('TRUST_PROXY off: a spoofed X-Forwarded-For neither escapes the peer prefix nor charges another prefix', async () => {
    const u = await signIn(r.h);
    for (const xff of ['198.18.0.1', '198.18.1.1', '198.18.2.1']) {
      expect((await from(r.h, reverseUrl(31.52, 74.35), u.accessToken, '100.70.0.150', { 'x-forwarded-for': xff })).statusCode).toBe(200);
    }
    expect((await from(r.h, reverseUrl(31.52, 74.35), u.accessToken, '100.70.0.151', { 'x-forwarded-for': '198.18.3.1' })).statusCode).toBe(429);
    // claiming the exhausted prefix from elsewhere does not deny the real (other) peer prefix either
    expect((await from(r.h, reverseUrl(31.52, 74.35), u.accessToken, '198.18.0.1', { 'x-forwarded-for': '100.70.0.150' })).statusCode).toBe(200);
  });

  it('privacy: limiter keys hold a keyed hash of the prefix — no address or prefix text in Valkey', async () => {
    const redis = await valkey();
    try {
      const keys = await redis.keys(`${r.h.keyPrefix}*`);
      const ipKeys = keys.filter((k) => k.includes(':ip:m:'));
      expect(ipKeys.length).toBeGreaterThan(0);
      for (const k of ipKeys) expect(k).toMatch(/:geo:(ac|pr|rv):ip:m:[0-9a-f]{64}$/);
      expect(keys.join('\n')).not.toMatch(/203\.0\.113|198\.51\.100|198\.18\.|192\.0\.2|100\.64|100\.70|2001:|ip-prefix/);
    } finally {
      redis.disconnect();
    }
  });

  it('TRUST_PROXY with a listed proxy: the client IP is the X-Forwarded-For hop Fastify derives — only from that proxy', async () => {
    const t = await startGeoApi({ env: { TRUST_PROXY: '10.9.9.9', GEO_REVERSE_PER_MINUTE_IP_PREFIX: '2' } });
    try {
      const u = await signIn(t.h);
      for (let i = 0; i < 2; i++) {
        expect((await from(t.h, reverseUrl(31.51, 74.341), u.accessToken, '10.9.9.9', { 'x-forwarded-for': '203.0.113.9' })).statusCode).toBe(200);
      }
      expect((await from(t.h, reverseUrl(31.51, 74.341), u.accessToken, '10.9.9.9', { 'x-forwarded-for': '203.0.113.99' })).statusCode).toBe(429);
      // a different client behind the same proxy is a different prefix
      expect((await from(t.h, reverseUrl(31.51, 74.341), u.accessToken, '10.9.9.9', { 'x-forwarded-for': '198.51.100.9' })).statusCode).toBe(200);
      // an untrusted peer sending a header is keyed by its own /24 (the claimed 198.51.100.9 has 1 of its 2 calls left)
      for (const ip of ['192.0.2.77', '192.0.2.78']) {
        expect((await from(t.h, reverseUrl(31.51, 74.341), u.accessToken, ip, { 'x-forwarded-for': '198.51.100.9' })).statusCode).toBe(200);
      }
      expect((await from(t.h, reverseUrl(31.51, 74.341), u.accessToken, '192.0.2.79', { 'x-forwarded-for': '198.51.100.9' })).statusCode).toBe(429);
      expect((await from(t.h, reverseUrl(31.51, 74.341), u.accessToken, '10.9.9.9', { 'x-forwarded-for': '198.51.100.9' })).statusCode).toBe(200);
    } finally {
      await t.h.close();
    }
  }, 120_000);
});

describe('routing service for quotes (B03/E07)', () => {
  const origin = { lat: 31.5100217, lng: 74.3410391 };
  const destination = { lat: 31.5220123, lng: 74.4040456 };

  it('CS-01: rounded 4-decimal points reach the provider; the same bucket is a HIT; result carries provenance', async () => {
    const departAt = new Date();
    const first = await g.h.runtime.geo.routing.route({ origin, destination, profile: 'CAR', departAt }, Date.now() + 3000);
    expect(first.source).toMatchObject({ providerKey: 'geo-mock', cacheStatus: 'MISS', attributionCode: 'SYNTHETIC_DATA' });
    expect(first.distanceM).toBeGreaterThan(0);
    expect(first.geometryStorable).toBe(true);
    expect(first.geometry[0]).toEqual({ lat: 31.51, lng: 74.341 });
    const sent = g.doubles.control.inputs('ROUTE').at(-1) as { origin: unknown; destination: unknown; departAt: Date };
    expect(sent.origin).toEqual({ lat: 31.51, lng: 74.341 });
    expect(sent.destination).toEqual({ lat: 31.522, lng: 74.404 });
    expect(sent.departAt.getTime() % (15 * 60_000)).toBe(0);
    const again = await g.h.runtime.geo.routing.route({ origin: { lat: 31.51003, lng: 74.34098 }, destination, profile: 'CAR', departAt }, Date.now() + 3000);
    expect(again.source.cacheStatus).toBe('HIT');
    expect(again.distanceM).toBe(first.distanceM);
  });

  it('FG-01/FG-02/FG-06: timeout, connect error (single attempt) and a route without duration are refused — never estimated', async () => {
    const route = (o: { lat: number; lng: number }) =>
      g.h.runtime.geo.routing.route({ origin: o, destination, profile: 'CAR', departAt: new Date() }, Date.now() + 3000);
    const cases: Array<[Parameters<GeoHarness['doubles']['control']['setFault']>[1], string]> = [
      [{ mode: 'TIMEOUT' }, 'TIMEOUT'],
      [{ mode: 'CONNECT_ERROR' }, 'PROVIDER_ERROR'],
      [{ mode: 'PARTIAL' }, 'PROVIDER_ERROR'],
      [{ mode: 'MALFORMED' }, 'PROVIDER_ERROR'],
    ];
    let lat = 31.45;
    for (const [fault, reason] of cases) {
      g.doubles.control.setFault('ROUTE', fault);
      const before = g.doubles.control.calls('ROUTE');
      lat += 0.01;
      await expect(route({ lat, lng: 74.3 })).rejects.toMatchObject({ name: 'RoutingUnavailableError', reason });
      expect(g.doubles.control.calls('ROUTE') - before).toBe(1);
    }
    g.doubles.control.clearFaults();
    // the deadline bounds the single attempt
    await expect(
      g.h.runtime.geo.routing.route({ origin, destination: { lat: 31.6, lng: 74.3 }, profile: 'CAR', departAt: new Date() }, Date.now() - 1),
    ).rejects.toMatchObject({
      reason: 'DEADLINE',
    });
    await expect(
      g.h.runtime.geo.routing.route({ origin: { lat: 51.5, lng: -0.1 }, destination, profile: 'CAR', departAt: new Date() }, Date.now() + 3000),
    ).rejects.toMatchObject({
      reason: 'INVALID_POINT',
    });
    g.switches.stopped.add('platform.geo-routing');
    await expect(route({ lat: 31.6, lng: 74.31 })).rejects.toMatchObject({ reason: 'SWITCH_STOPPED' });
    g.switches.stopped.clear();
  });

  it('CS-02: a route entry older than its TTL is never used for a new quote, even when the provider then fails', async () => {
    let clock = Date.now();
    const config = loadApiConfig({ WAYVRO_ENV: 'test', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x', REDIS_URL, WAYVRO_LOCAL_KEY_SEED: SEED });
    const redis = await valkey();
    const prefix = `${g.h.keyPrefix}cs2:`;
    const log = createLogger({ service: 'api', env: 'test', level: 'fatal' });
    const limiter = new RateLimiter(redis, prefix);
    const now = () => new Date(clock);
    const budgets = new GeoBudgetGuard(g.h.owner, limiter, redis, { ...config, GEO_KEY_PREFIX: prefix }, log);
    const caller = new GeoProviderCaller(budgets, new CircuitBreaker(), redis, prefix, log, now);
    const cache = new GeoCache(redis, new KeyedHasher(localKeyRing(SEED)), prefix, log);
    const routing = new GeoRouting({
      bundle: assertGeoBundle('none', bindProviders('test', { routing: g.doubles.routing })),
      port: g.doubles.routing,
      switches: new TestSwitches(),
      cache,
      caller,
      usage: new GeoUsageCounters(redis, prefix),
      policy: { ...config, GEO_KEY_PREFIX: prefix },
      log,
      now,
    });
    try {
      const departAt = new Date(clock);
      const req = { origin: { lat: 31.47, lng: 74.27 }, destination: { lat: 31.48, lng: 74.28 }, profile: 'CAR' as const, departAt };
      expect((await routing.route(req, clock + 3000)).source.cacheStatus).toBe('MISS');
      clock += 600_000;
      expect((await routing.route(req, clock + 3000)).source.cacheStatus).toBe('HIT');
      clock += 1;
      g.doubles.control.setFault('ROUTE', { mode: 'UPSTREAM_5XX' });
      await expect(routing.route(req, clock + 3000)).rejects.toBeInstanceOf(RoutingUnavailableError);
    } finally {
      g.doubles.control.clearFaults();
      redis.disconnect();
    }
  });
});

describe('BUD-05: Valkey unavailable ⇒ geo fails closed', () => {
  it('rate limiter (account + IP-prefix rules) / budget store down ⇒ 503 on every geo read and zero provider calls; signal logged', async () => {
    const logs = captureLogs();
    const log = createLogger({ service: 'api', env: 'test', level: 'info', destination: logs.stream });
    const dead = createRequestPathRedis('redis://127.0.0.1:1', 200);
    const config = loadApiConfig({
      WAYVRO_ENV: 'test',
      DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
      REDIS_URL: 'redis://127.0.0.1:1',
      WAYVRO_LOCAL_KEY_SEED: SEED,
    });
    const limiter = new RateLimiter(dead, 'wv:dead:');
    const budgets = new GeoBudgetGuard(g.h.owner, limiter, dead, config, log);
    const ring = localKeyRing(SEED);
    const doubles = g.doubles;
    const bundle = assertGeoBundle(
      'none',
      bindProviders('test', { placesAutocomplete: doubles.placesAutocomplete, geocoding: doubles.geocoding, reverseGeocoding: doubles.reverseGeocoding }),
    );
    const sealer = new PlaceRefSealer(new FieldCipher(ring), 900);
    const gateway = new GeoGateway({
      bundle,
      ports: { placesAutocomplete: doubles.placesAutocomplete, geocoding: doubles.geocoding, reverseGeocoding: doubles.reverseGeocoding },
      seams: { switches: new TestSwitches(), serviceArea: new TestServiceArea() },
      redis: dead,
      limiter,
      cache: new GeoCache(dead, new KeyedHasher(ring), 'wv:dead:', log),
      caller: new GeoProviderCaller(budgets, new CircuitBreaker(), dead, 'wv:dead:', log),
      sealer,
      reference: new GeoReference(g.h.owner),
      usage: new GeoUsageCounters(dead, 'wv:dead:'),
      hasher: new KeyedHasher(ring),
      policy: config,
      log,
    });
    const providerCalls = () => (['AUTOCOMPLETE', 'GEOCODE', 'PLACE_RESOLVE', 'REVERSE_GEOCODE'] as const).reduce((n, s) => n + doubles.control.calls(s), 0);
    const before = providerCalls();
    const requester = { accountId: randomUUID(), clientIp: '203.0.113.20' };
    const placeRef = sealer.seal({ providerKey: 'geo-mock', sku: 'AUTOCOMPLETE', placeId: 'syn-lhr-001', accountId: requester.accountId, cityCode: 'LHR' });
    const refusal = { code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE', details: { reasonCodes: ['GEO_PROVIDER_UNAVAILABLE'] } };
    try {
      const query = { cityCode: 'LHR', q: 'liberty', locale: 'en' as const, session: SESSION };
      await expect(gateway.autocomplete(requester, query)).rejects.toMatchObject(refusal);
      await expect(gateway.autocomplete(requester, { ...query, mode: 'GEOCODE' })).rejects.toMatchObject(refusal);
      await expect(gateway.resolvePlace(requester, placeRef, { session: SESSION, locale: 'en' })).rejects.toMatchObject(refusal);
      const e = await gateway.reverse(requester, { cityCode: 'LHR', lat: 31.51, lng: 74.341, locale: 'en' }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(WayvroError);
      expect(e).toMatchObject(refusal);
      expect(providerCalls()).toBe(before);
      expect(logs.text()).toContain('GEO_LIMITER_UNAVAILABLE');
    } finally {
      dead.disconnect();
    }
  });
});

describe('LOG-GEO canary (T3-28)', () => {
  it('search text, sentinel coordinates and placeRefs never reach logs, error bodies, audit rows, jobs, usage rows or Valkey keys', async () => {
    const canary = `canary${randomBytes(6).toString('hex')}`;
    const lat = '31.5204917';
    const lng = '74.3587123';
    const u = await signIn(g.h);
    const bodies: string[] = [];
    const call = async (url: string) => {
      const res = await geoGet(g.h, url, u.accessToken);
      bodies.push(res.body);
      return res;
    };
    await call(autocompleteUrl(canary, { biasLat: lat, biasLng: lng }));
    await call(autocompleteUrl(`${canary} gulberg`, { mode: 'GEOCODE' }));
    await call(reverseUrl(Number(lat), Number(lng)));
    const ok = AutocompleteResultSchema.parse((await call(autocompleteUrl('liberty', { biasLat: lat, biasLng: lng }))).json());
    const ref = ok.suggestions[0]?.placeRef ?? '';
    await call(placeUrl(ref));
    await call(placeUrl(`${ref.slice(0, -2)}xx`));
    for (const mode of ['ECHO_QUERY', 'TIMEOUT', 'UPSTREAM_5XX'] as const) {
      g.doubles.control.setFault('ALL', { mode });
      await call(autocompleteUrl(`${canary}${mode.toLowerCase()}`, { biasLat: lat, biasLng: lng }));
      await call(reverseUrl(Number(lat) + 0.001, Number(lng)));
    }
    g.doubles.control.clearFaults();
    await g.h.runtime.geo.routing
      .route(
        { origin: { lat: Number(lat), lng: Number(lng) }, destination: { lat: 31.5304917, lng: 74.3687123 }, profile: 'CAR', departAt: new Date() },
        Date.now() + 3000,
      )
      .catch(() => undefined);

    const logText = g.h.logs.text();
    const forbidden = [canary, lat, lng, '31.5204', '74.3587', 'pr1.', 'syn-lhr-'];
    for (const f of forbidden) expect(logText, `log contains ${f}`).not.toContain(f);
    for (const b of bodies.filter((x) => x.includes('"error"'))) for (const f of forbidden) expect(b).not.toContain(f);
    expect(logText).toContain('"route":"/v1/geo/autocomplete"');
    expect(logText).toContain('"route":"/v1/geo/places/:placeRef"');
    expect(logText).not.toContain('?q=');
    const audit = await g.h.owner.query<{ t: string }>(`select string_agg(a::text, '|') t from audit.audit_events a`);
    const jobs = await g.h.owner.query<{ t: string }>(`select coalesce(string_agg(j::text, '|'), '') t from platform.jobs j`);
    const usage = await g.h.owner.query<{ t: string }>(`select coalesce(string_agg(u::text, '|'), '') t from geo.provider_usage u`);
    for (const t of [audit.rows[0]?.t ?? '', jobs.rows[0]?.t ?? '', usage.rows[0]?.t ?? '']) for (const f of forbidden) expect(t).not.toContain(f);
    const redis = await valkey();
    try {
      const keys = await redis.keys(`${g.h.keyPrefix}*`);
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) for (const f of [canary, lat, lng, '31.52', 'liberty']) expect(k).not.toContain(f);
    } finally {
      redis.disconnect();
    }
  });
});

describe('separate harnesses: stale entries, TTL 0, breaker, unbound and unwired', () => {
  let s: GeoHarness;
  let su: SignedIn;
  beforeAll(async () => {
    s = await startGeoApi({
      env: { ...FAST, GEO_BREAKER_CONSECUTIVE_TIMEOUTS: '3', GEO_BREAKER_OPEN_SECONDS: '5' },
      doubleOptions: { ttlSeconds: { AUTOCOMPLETE: 1, REVERSE_GEOCODE: 0 } },
      bind: ['placesAutocomplete', 'geocoding', 'reverseGeocoding'],
    });
    su = await signIn(s.h);
  }, 120_000);
  afterAll(async () => {
    await s.h.close();
  });

  it('CS-03: provider down, entry ≤ 2 × TTL ⇒ STALE_SERVED; older ⇒ refused (no stale beyond 2 × TTL)', async () => {
    expect(AutocompleteResultSchema.parse((await geoGet(s.h, autocompleteUrl('anarkali'), su.accessToken)).json()).source.cacheStatus).toBe('MISS');
    await sleep(1300);
    s.doubles.control.setFault('AUTOCOMPLETE', { mode: 'UPSTREAM_5XX' });
    const stale = await geoGet(s.h, autocompleteUrl('anarkali'), su.accessToken);
    expect(stale.statusCode, stale.body).toBe(200);
    expect(AutocompleteResultSchema.parse(stale.json()).source.cacheStatus).toBe('STALE_SERVED');
    await sleep(1000);
    expect((await geoGet(s.h, autocompleteUrl('anarkali'), su.accessToken)).statusCode).toBe(503);
    s.doubles.control.clearFaults();
  });

  it('CS-05/CS-06: a terms TTL of 0 is never written to Valkey; a flushed cache only produces misses', async () => {
    const before = s.doubles.control.calls('REVERSE_GEOCODE');
    for (let i = 0; i < 2; i++)
      expect(ReverseGeocodeResultSchema.parse((await geoGet(s.h, reverseUrl(31.51, 74.341), su.accessToken)).json()).source.cacheStatus).toBe('MISS');
    expect(s.doubles.control.calls('REVERSE_GEOCODE') - before).toBe(2);
    expect(AutocompleteResultSchema.parse((await geoGet(s.h, autocompleteUrl('emporium mall'), su.accessToken)).json()).source.cacheStatus).toBe('MISS');
    const redis = await valkey();
    try {
      expect(await redis.keys(`${s.h.keyPrefix}geo:geo-mock:REVERSE_GEOCODE:*`)).toEqual([]);
      const cached = await redis.keys(`${s.h.keyPrefix}geo:geo-mock:AUTOCOMPLETE:v1:*`);
      expect(cached.length).toBeGreaterThan(0);
      const entry = JSON.parse((await redis.get(cached[0] ?? '')) ?? '{}') as { f?: string };
      expect(entry.f).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      await redis.del(...cached);
    } finally {
      redis.disconnect();
    }
    expect(AutocompleteResultSchema.parse((await geoGet(s.h, autocompleteUrl('emporium mall'), su.accessToken)).json()).source.cacheStatus).toBe('MISS');
  });

  it('BRK through the gateway: consecutive timeouts open the breaker; OPEN refuses with zero adapter calls; the hint is shared', async () => {
    s.doubles.control.setFault('GEOCODE', { mode: 'TIMEOUT' });
    for (let i = 0; i < 3; i++) expect((await geoGet(s.h, autocompleteUrl(unique(), { mode: 'GEOCODE' }), su.accessToken)).statusCode).toBe(503);
    s.doubles.control.clearFaults();
    const before = s.doubles.control.calls('GEOCODE');
    const refused = await geoGet(s.h, autocompleteUrl('model town', { mode: 'GEOCODE' }), su.accessToken);
    expect(refused.statusCode).toBe(503);
    expect(reasonCodes(refused)).toEqual(['GEO_PROVIDER_UNAVAILABLE']);
    expect(s.doubles.control.calls('GEOCODE')).toBe(before);
    expect(s.h.logs.text()).toContain('GEO_BREAKER_OPENED');
    const redis = await valkey();
    try {
      expect(Number(await redis.get(`${s.h.keyPrefix}geo:breaker:geo-mock:GEOCODE`))).toBeGreaterThan(Date.now());
    } finally {
      redis.disconnect();
    }
    // other SKUs are unaffected (isolation)
    expect((await geoGet(s.h, autocompleteUrl('emporium'), su.accessToken)).statusCode).toBe(200);
  });

  it('FG-09: an unbound routing port refuses the route (never an estimate)', async () => {
    await expect(
      s.h.runtime.geo.routing.route(
        { origin: { lat: 31.5, lng: 74.3 }, destination: { lat: 31.6, lng: 74.4 }, profile: 'CAR', departAt: new Date() },
        Date.now() + 3000,
      ),
    ).rejects.toMatchObject({
      reason: 'UNBOUND',
    });
  });

  it('without a test override, composeApi wires the release-controls switch store and the catalog service-area lookup', async () => {
    const w = await startGeoApi({ seams: false });
    try {
      const u = await signIn(w.h);
      const res = await geoGet(w.h, autocompleteUrl('liberty'), u.accessToken);
      expect(res.statusCode).toBe(200);
      expect(w.doubles.control.calls('AUTOCOMPLETE')).toBe(1);
      expect(w.h.logs.text()).not.toContain('GEO_SEAMS_UNWIRED');
      // the real catalog lookup answers from PostGIS: this throwaway database has no ACTIVE zone set, so nothing is served
      const reverse = await geoGet(w.h, reverseUrl(31.51, 74.341), u.accessToken);
      expect(reverse.statusCode).toBe(200);
      expect(reverse.json<{ inServiceArea: boolean }>().inServiceArea).toBe(false);
      await expect(
        w.h.runtime.geo.routing.route(
          { origin: { lat: 31.5, lng: 74.3 }, destination: { lat: 31.6, lng: 74.4 }, profile: 'CAR', departAt: new Date() },
          Date.now() + 3000,
        ),
      ).resolves.toMatchObject({ source: { cacheStatus: 'MISS' } });
    } finally {
      await w.h.close();
    }
  });
});

describe('cache and budget edge cases', () => {
  it('an invalid cache entry is discarded as a miss (GEO_CACHE_ENTRY_INVALID); a corrupted breaker hint is ignored', async () => {
    const redis = await valkey();
    try {
      const log = createLogger({ service: 'api', env: 'test', level: 'fatal' });
      const cache = new GeoCache(redis, new KeyedHasher(localKeyRing(SEED)), `${g.h.keyPrefix}geo:`, log);
      const u = await signIn(g.h);
      for (const garbage of ['not json', JSON.stringify({ v: 1, f: new Date().toISOString(), d: { candidates: [{ bad: 1 }] } })]) {
        const text = `edge${randomBytes(3).toString('hex')}`;
        await redis.set(cache.key('geo-mock', 'AUTOCOMPLETE', { t: text, l: 'en', b: null }), garbage, 'EX', 60);
        const res = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl(text), u.accessToken)).json());
        expect(res.source.cacheStatus).toBe('MISS');
      }
      expect(g.h.logs.text()).toContain('GEO_CACHE_ENTRY_INVALID');
      const hints = new ValkeyBreakerHints(redis, `${g.h.keyPrefix}geo:`);
      await redis.set(`${g.h.keyPrefix}geo:breaker:geo-mock:EDGE`, 'not-a-number', 'EX', 60);
      expect(await hints.readOpenUntil({ providerKey: 'geo-mock', sku: 'EDGE' })).toBeNull();
    } finally {
      redis.disconnect();
    }
  });

  it('staging/production without an ACTIVE budget row refuse the SKU (GEO_BUDGET_MISSING), never a default', async () => {
    const redis = await valkey();
    const logs = captureLogs();
    const log = createLogger({ service: 'api', env: 'test', level: 'info', destination: logs.stream });
    try {
      const policy = { WAYVRO_ENV: 'production' as const, GEO_LOCAL_DAILY_CALLS_PER_SKU: 5000, GEO_KEY_PREFIX: `${g.h.keyPrefix}geo:` };
      const guard = new GeoBudgetGuard(g.h.owner, new RateLimiter(redis, `${g.h.keyPrefix}prod:`), redis, policy, log);
      await expect(guard.consume('geo-mock', 'ROUTE', 1000, new Date())).rejects.toMatchObject({ name: 'BudgetRefusal', reason: 'MISSING' });
      await expect(guard.consume('geo-mock', 'ROUTE', 1000, new Date())).rejects.toMatchObject({ reason: 'MISSING' });
      expect(logs.text().split('GEO_BUDGET_MISSING').length - 1).toBe(1);
    } finally {
      redis.disconnect();
    }
  });
});
