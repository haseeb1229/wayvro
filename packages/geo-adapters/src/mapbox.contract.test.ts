/**
 * S2 Mapbox — ACCOUNT-FREE contract tests (no provider account, no real token, no network). Every payload is a
 * hand-written SYNTHETIC fixture shaped like the publicly documented schema (test/synthetic-mapbox.ts); these tests
 * prove the adapters' request construction, token handling, parsing, error mapping, timeout behaviour, licence/cost
 * declarations and port boundary against those shapes. They do NOT prove real-provider conformance (FA-06), and S2
 * stays unfreezable while FA-19 is open.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  BODY_SENTINEL,
  FAKE_MAPBOX_TOKEN,
  FIXED_NOW,
  HTTP_ERROR_STATUSES,
  MALFORMED_BODIES,
  QUERY_SENTINEL,
  RETRY_AFTER_CASES,
  SESSION,
  bind,
  canonicalFailureOf,
  connectFailure,
  expectNoLeak,
  expectedHttpCode,
  expectedHttpKind,
  failureOf,
  quotaResponse,
  stallingBody,
  type ContractOp,
} from '../test/contract-harness.js';
import { SYNTHETIC, fakeFetch, json, never } from '../test/fake-fetch.js';
import {
  MAPBOX_DIRECTIONS_RESPONSE,
  MAPBOX_GEOCODING_V6_RESPONSE,
  MAPBOX_RETRIEVE_RESPONSE,
  MAPBOX_SUGGEST_RESPONSE,
  mapboxError,
} from '../test/synthetic-mapbox.js';
import { SecretValue } from './config.js';
import type { FetchLike } from './http.js';
import { MICRO_USD_PER_CALL } from './licences.js';
import { MapboxDirectionsAdapter } from './mapbox/directions.js';
import { MapboxGeocodingAdapter } from './mapbox/geocoding.js';
import { MapboxReverseGeocodingAdapter } from './mapbox/reverse-geocoding.js';
import { MapboxSearchBoxAutocompleteAdapter } from './mapbox/search-box-autocomplete.js';

const accessToken = new SecretValue(FAKE_MAPBOX_TOKEN);
const opts = (fetchImpl: FetchLike, now?: () => Date) => ({ providerKey: 'geo-s2', accessToken, fetchImpl, ...(now ? { now } : {}) });
const routeInput = { origin: SYNTHETIC.a, destination: SYNTHETIC.c, profile: 'CAR' as const, departAt: new Date('2026-10-16T10:00:00Z') };

const OPS = {
  suggest: {
    name: 'Search Box /suggest',
    sku: 'AUTOCOMPLETE',
    make: (f, now?: () => Date) => {
      const a = new MapboxSearchBoxAutocompleteAdapter(opts(f, now));
      return {
        licences: a.licences,
        call: (s) => a.suggest({ text: QUERY_SENTINEL, locale: 'en', biasCell: { lat: 31.52, lng: 74.35 }, countryCode: 'PK', searchSessionId: SESSION }, s),
      };
    },
    ok: () => json(MAPBOX_SUGGEST_RESPONSE),
    http404: 'CLIENT_ERROR',
  },
  retrieve: {
    name: 'Search Box /retrieve',
    sku: 'PLACE_RESOLVE',
    make: (f, now?: () => Date) => {
      const a = new MapboxGeocodingAdapter(opts(f, now));
      return { licences: a.licences, call: (s) => a.resolve({ providerPlaceId: 'synthetic.poi.1', searchSessionId: SESSION, locale: 'en' }, s) };
    },
    ok: () => json(MAPBOX_RETRIEVE_RESPONSE),
    http404: 'NOT_FOUND',
  },
  geocode: {
    name: 'Geocoding v6 /forward',
    sku: 'GEOCODE',
    make: (f, now?: () => Date) => {
      const a = new MapboxGeocodingAdapter(opts(f, now));
      return { licences: a.licences, call: (s) => a.geocode({ text: QUERY_SENTINEL, locale: 'en', countryCode: 'PK' }, s) };
    },
    ok: () => json(MAPBOX_GEOCODING_V6_RESPONSE),
    http404: 'CLIENT_ERROR',
  },
  reverse: {
    name: 'Geocoding v6 /reverse',
    sku: 'REVERSE_GEOCODE',
    make: (f, now?: () => Date) => {
      const a = new MapboxReverseGeocodingAdapter(opts(f, now));
      return { licences: a.licences, call: (s) => a.reverse({ point: SYNTHETIC.b, locale: 'en' }, s) };
    },
    ok: () => json(MAPBOX_GEOCODING_V6_RESPONSE),
    http404: 'CLIENT_ERROR',
  },
  directions: {
    name: 'Directions v5',
    sku: 'ROUTE',
    make: (f, now?: () => Date) => {
      const a = new MapboxDirectionsAdapter(opts(f, now));
      return { licences: a.licences, call: (s) => a.route(routeInput, s) };
    },
    ok: () => json(MAPBOX_DIRECTIONS_RESPONSE),
    http404: 'CLIENT_ERROR',
  },
} satisfies Record<string, ContractOp>;
const ALL: readonly ContractOp[] = Object.values(OPS);
const SECRETS = [FAKE_MAPBOX_TOKEN, QUERY_SENTINEL, BODY_SENTINEL];
const signal = () => AbortSignal.timeout(2000);

describe('S2 Mapbox contract: request construction and token handling', () => {
  it.each(ALL.map((op) => [op.name, op] as const))('%s: the token travels only as the access_token parameter, exactly once', async (_, op) => {
    const { bound, requests } = bind(op, () => op.ok());
    await bound.call(signal());
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.method).toBe('GET');
    expect(req.url.origin).toBe('https://api.mapbox.com');
    expect(req.url.searchParams.getAll('access_token')).toEqual([FAKE_MAPBOX_TOKEN]);
    expect(decodeURIComponent(req.url.pathname)).not.toContain(FAKE_MAPBOX_TOKEN);
    expect(Object.values(req.headers).join(' ')).not.toContain(FAKE_MAPBOX_TOKEN);
    expect(req.body).toBeUndefined();
    expect(req.headers['accept']).toBe('application/json');
    expect(req.redirect).toBe('error');
  });

  it('/suggest and /retrieve carry the SAME session_token (one billing session); geocoding and directions carry none', async () => {
    const f = fakeFetch((req) => (req.url.pathname.endsWith('/suggest') ? json(MAPBOX_SUGGEST_RESPONSE) : json(MAPBOX_RETRIEVE_RESPONSE)));
    const suggest = new MapboxSearchBoxAutocompleteAdapter(opts(f.fetchImpl));
    const retrieve = new MapboxGeocodingAdapter(opts(f.fetchImpl));
    const [candidate] = await suggest.suggest(
      { text: 'synthetic garden', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION },
      signal(),
    );
    await retrieve.resolve({ providerPlaceId: candidate!.providerPlaceId, searchSessionId: SESSION, locale: 'en' }, signal());
    expect(f.requests[0]?.url.searchParams.get('session_token')).toBe(SESSION);
    expect(f.requests[1]?.url.searchParams.get('session_token')).toBe(SESSION);
    expect(f.requests[1]?.url.pathname).toBe('/search/searchbox/v1/retrieve/synthetic.poi.1');
    for (const op of [OPS.geocode, OPS.reverse, OPS.directions]) {
      const { bound, requests } = bind(op, () => op.ok());
      await bound.call(signal());
      expect(requests[0]?.url.searchParams.has('session_token')).toBe(false);
    }
  });

  it('refuses a malformed session token before any provider call', async () => {
    const f = fakeFetch(() => json({}));
    const suggest = new MapboxSearchBoxAutocompleteAdapter(opts(f.fetchImpl));
    const retrieve = new MapboxGeocodingAdapter(opts(f.fetchImpl));
    for (const bad of ['', 'short', 'has space in it', 'x'.repeat(65), 'a&access_token=other']) {
      expect((await failureOf(suggest.suggest({ text: 'x', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: bad }, signal()))).code).toBe(
        'INVALID_INPUT',
      );
      expect((await failureOf(retrieve.resolve({ providerPlaceId: 'synthetic.poi.1', searchSessionId: bad, locale: 'en' }, signal()))).code).toBe(
        'INVALID_INPUT',
      );
    }
    expect(f.requests).toHaveLength(0);
  });
});

describe('S2 Mapbox contract: parsing documented shapes into port types only', () => {
  const components = { name: 'Synthetic Garden', block: 'Synthetic Block D', society: null, area: 'Synthetic Colony', city: 'Lahore', nameUrdu: null };

  it('/suggest: category suggestions dropped, attribution and vendor fields never leak', async () => {
    const { bound } = bind(OPS.suggest, () => OPS.suggest.ok());
    const out = (await bound.call(signal())) as readonly object[];
    expect(out).toEqual([{ providerPlaceId: 'synthetic.poi.1', components, kind: 'LANDMARK' }]);
    for (const c of out) expect(Object.keys(c).sort()).toEqual(['components', 'kind', 'providerPlaceId']);
    expect(JSON.stringify(out)).not.toMatch(/attribution|full_address|maki|response_id/);
  });

  it('/retrieve: GeoJSON point, context components; no accuracy ⇒ confidence UNKNOWN (never invented)', async () => {
    const { bound } = bind(OPS.retrieve, () => OPS.retrieve.ok());
    expect(await bound.call(signal())).toEqual({ point: { lat: 31.53, lng: 74.34 }, components, kind: 'LANDMARK', confidence: 'UNKNOWN' });
  });

  it.each([OPS.geocode, OPS.reverse].map((op) => [op.name, op] as const))(
    '%s: accuracy ⇒ confidence; match_code, bbox and routable points dropped',
    async (_, op) => {
      const { bound } = bind(op, () => op.ok());
      const raw = await bound.call(signal());
      const place = (Array.isArray(raw) ? raw[0] : raw) as object;
      expect(place).toEqual({
        point: { lat: 31.51, lng: 74.32 },
        components: { ...components, name: '7 Synthetic Road' },
        kind: 'ADDRESS',
        confidence: 'MEDIUM',
      });
      expect(JSON.stringify(raw)).not.toMatch(/match_code|bbox|routable_points|mapbox_id/);
    },
  );

  it('Directions v5: integer metres/seconds and the overview geometry only (legs, waypoints, uuid dropped)', async () => {
    const { bound } = bind(OPS.directions, () => OPS.directions.ok());
    expect(await bound.call(signal())).toEqual({
      distanceM: 15_234,
      durationS: 1265,
      geometry: [SYNTHETIC.a, SYNTHETIC.b, SYNTHETIC.c],
      confidence: 'UNKNOWN',
    });
  });
});

describe('S2 Mapbox contract: error mapping to stable codes without leaking the token, query or provider body', () => {
  const cases = ALL.flatMap((op) => HTTP_ERROR_STATUSES.map((status) => [op.name, status, op] as const));

  it.each(cases)('%s: HTTP %i with a documented {message} body ⇒ stable code', async (_, status, op) => {
    const echo = `${BODY_SENTINEL} access_token=${FAKE_MAPBOX_TOKEN} q=${QUERY_SENTINEL}`;
    const body = op === OPS.directions ? mapboxError(echo, status === 404 ? 'ProfileNotFound' : 'InvalidInput') : mapboxError(echo);
    const { bound } = bind(op, () => json(body, status));
    const error = await failureOf(bound.call(signal()));
    const expected = expectedHttpCode(op, status);
    expect(error.code).toBe(expected);
    expect(error.httpStatus).toBe(status);
    expect(error.sku).toBe(op.sku);
    expect(error.providerKey).toBe('geo-s2');
    expect(error.countsAsProviderFailure).toBe(!['CLIENT_ERROR', 'NOT_FOUND'].includes(expected));
    expectNoLeak(error, SECRETS);
  });

  it('HTTP 422 (documented for Geocoding v6 and Directions invalid input) ⇒ CLIENT_ERROR, not a breaker failure', async () => {
    for (const op of [OPS.geocode, OPS.reverse, OPS.directions]) {
      const { bound } = bind(op, () => json(mapboxError(BODY_SENTINEL, 'InvalidInput'), 422));
      const error = await failureOf(bound.call(signal()));
      expect(error.code).toBe('CLIENT_ERROR');
      expect(error.countsAsProviderFailure).toBe(false);
    }
  });

  it.each(ALL.flatMap((op) => MALFORMED_BODIES.map(([label, body]) => [op.name, label, op, body] as const)))(
    '%s: HTTP 200 with %s ⇒ MALFORMED_RESPONSE',
    async (_, __, op, body) => {
      const { bound } = bind(op, body);
      const error = await failureOf(bound.call(signal()));
      expect(error.code).toBe('MALFORMED_RESPONSE');
      expect(error.countsAsProviderFailure).toBe(true);
      expectNoLeak(error, SECRETS);
    },
  );
});

describe('S2 Mapbox contract: timeouts, cancellation and transport failures', () => {
  it.each(ALL.map((op) => [op.name, op] as const))('%s: no response before the caller deadline ⇒ TIMEOUT', async (_, op) => {
    const { bound } = bind(op, () => never());
    const error = await failureOf(bound.call(AbortSignal.timeout(25)));
    expect(error.code).toBe('TIMEOUT');
    expect(error.countsAsProviderFailure).toBe(true);
    expectNoLeak(error, SECRETS);
  });

  it.each(ALL.map((op) => [op.name, op] as const))('%s: headers arrive but the body stalls past the deadline ⇒ TIMEOUT', async (_, op) => {
    const deadline = AbortSignal.timeout(25);
    const { bound } = bind(op, () => stallingBody(deadline));
    const error = await failureOf(bound.call(deadline));
    expect(error.code).toBe('TIMEOUT');
    expect(error.httpStatus).toBe(200);
  });

  it.each(ALL.map((op) => [op.name, op] as const))('%s: caller cancellation ⇒ ABORTED (not a breaker failure)', async (_, op) => {
    const { bound } = bind(op, () => never());
    const controller = new AbortController();
    const pending = bound.call(controller.signal);
    controller.abort();
    const error = await failureOf(pending);
    expect(error.code).toBe('ABORTED');
    expect(error.countsAsProviderFailure).toBe(false);
  });

  it.each(ALL.map((op) => [op.name, op] as const))('%s: a connect failure echoing the tokenised URL ⇒ NETWORK, URL not copied', async (_, op) => {
    const { bound } = bind(op, connectFailure);
    const error = await failureOf(bound.call(signal()));
    expect(error.code).toBe('NETWORK');
    expect(error.httpStatus).toBeNull();
    expectNoLeak(error, [...SECRETS, 'api.mapbox.com']);
  });
});

describe('S2 Mapbox contract: cache-policy and cost-accounting hooks', () => {
  it('declares TTL 0 and no cross-user sharing for every SKU; every Geocoding v6 call is temporary (permanent=false)', async () => {
    const f = fakeFetch((req) => (req.url.pathname.includes('/geocode/v6/') ? json(MAPBOX_GEOCODING_V6_RESPONSE) : json({})));
    const decl = [
      ...OPS.suggest.make(f.fetchImpl).licences,
      ...OPS.retrieve.make(f.fetchImpl).licences,
      ...OPS.reverse.make(f.fetchImpl).licences,
      ...OPS.directions.make(f.fetchImpl).licences,
    ].map((l) => [l.sku, l.maxCacheTtlSeconds, l.cacheSharedAcrossUsers]);
    expect(decl).toEqual([
      ['AUTOCOMPLETE', 0, false],
      ['GEOCODE', 0, false],
      ['PLACE_RESOLVE', 0, false],
      ['REVERSE_GEOCODE', 0, false],
      ['ROUTE', 0, false],
    ]);
    await OPS.geocode.make(f.fetchImpl).call(signal());
    await OPS.reverse.make(f.fetchImpl).call(signal());
    await new MapboxGeocodingAdapter({ ...opts(f.fetchImpl), forwardAutocomplete: true }).geocode({ text: 'syn', locale: 'en', countryCode: 'PK' }, signal());
    expect(f.requests.map((r) => r.url.searchParams.get('permanent'))).toEqual(['false', 'false', 'false']);
  });

  it('declares the planning-time ESTIMATE price per SKU used by the gateway meter (session billed on /suggest, /retrieve 0)', () => {
    const f = fakeFetch(() => json({}));
    const price = (op: ContractOp) => op.make(f.fetchImpl).licences.find((l) => l.sku === op.sku)?.microUsdPerCall;
    expect(price(OPS.suggest)).toBe(MICRO_USD_PER_CALL.mapboxSearchBoxSession);
    expect(price(OPS.retrieve)).toBe(0);
    expect(price(OPS.geocode)).toBe(MICRO_USD_PER_CALL.mapboxTemporaryGeocoding);
    expect(price(OPS.reverse)).toBe(MICRO_USD_PER_CALL.mapboxTemporaryGeocoding);
    expect(price(OPS.directions)).toBe(MICRO_USD_PER_CALL.mapboxDirections);
  });

  it.each(ALL.map((op) => [op.name, op] as const))('%s: the adapter holds no cache of its own (TTL is enforced only by the gateway)', async (_, op) => {
    const { bound, requests } = bind(op, () => op.ok());
    await bound.call(signal());
    await bound.call(signal());
    expect(requests).toHaveLength(2);
  });
});

describe('S2 Mapbox contract: no logging or telemetry from the adapter layer', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
  let spies: MockInstance[] = [];
  beforeEach(() => {
    spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
  });
  afterEach(() => {
    for (const s of spies) s.mockRestore();
  });

  it('success, HTTP error, malformed body and timeout paths write nothing to the console', async () => {
    for (const op of ALL) {
      await bind(op, () => op.ok()).bound.call(signal());
      await bind(op, () => json(mapboxError(BODY_SENTINEL), 401))
        .bound.call(signal())
        .catch(() => undefined);
      await bind(op, () => new Response('{', { status: 200 }))
        .bound.call(signal())
        .catch(() => undefined);
      await bind(op, () => never())
        .bound.call(AbortSignal.timeout(10))
        .catch(() => undefined);
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe('S2 Mapbox contract: canonical provider-interface taxonomy at the port boundary (fix 2026-10-17)', () => {
  const echo = `${BODY_SENTINEL} access_token=${FAKE_MAPBOX_TOKEN} q=${QUERY_SENTINEL}`;
  const fixedClock = () => FIXED_NOW;

  it.each(ALL.flatMap((op) => HTTP_ERROR_STATUSES.map((status) => [op.name, status, op] as const)))(
    '%s: HTTP %i is a canonical GeoProviderError of the expected kind',
    async (_, status, op) => {
      const { bound } = bind(op, () => json(mapboxError(echo), status));
      const error = await canonicalFailureOf(bound.call(signal()));
      expect(error.kind).toBe(expectedHttpKind(op, status));
      expect(error.retryAfterSeconds).toBeUndefined();
      expectNoLeak(error, SECRETS);
    },
  );

  it.each(ALL.flatMap((op) => RETRY_AFTER_CASES.map(([label, header, expected]) => [op.name, label, op, header, expected] as const)))(
    '%s: 429 with Retry-After %s ⇒ QUOTA with the bounded server-clock wait',
    async (_, __, op, header, expected) => {
      const { bound } = bind(op, () => quotaResponse(mapboxError(echo), header), fixedClock);
      const error = await canonicalFailureOf(bound.call(signal()));
      expect(error.kind).toBe('QUOTA');
      expect(error.retryAfterSeconds).toBe(expected);
      expectNoLeak(error, SECRETS);
    },
  );

  it.each(ALL.map((op) => [op.name, op] as const))('%s: Retry-After on a 503 is not a quota wait (UPSTREAM, none carried)', async (_, op) => {
    const { bound } = bind(op, () => json(mapboxError(echo), 503, { 'retry-after': '30' }));
    const error = await canonicalFailureOf(bound.call(signal()));
    expect(error.kind).toBe('UPSTREAM');
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it.each(ALL.map((op) => [op.name, op] as const))(
    '%s: 422 is REJECTED_INPUT; no vendor body reason is read (a Google-style bad-key body stays status-classified)',
    async (_, op) => {
      expect((await canonicalFailureOf(bind(op, () => json(mapboxError(echo), 422)).bound.call(signal()))).kind).toBe('REJECTED_INPUT');
      const googleish = { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }] } };
      expect((await canonicalFailureOf(bind(op, () => json(googleish, 400)).bound.call(signal()))).kind).toBe('REJECTED_INPUT');
    },
  );

  it('no route and a vanished place are NO_RESULT (not provider failures); an incomplete route is MALFORMED', async () => {
    for (const body of [mapboxError(echo, 'NoRoute'), { code: 'NoSegment', routes: [] }, { code: 'Ok', routes: [] }]) {
      expect((await canonicalFailureOf(bind(OPS.directions, () => json(body)).bound.call(signal()))).kind).toBe('NO_RESULT');
    }
    const gone = await canonicalFailureOf(bind(OPS.retrieve, () => json(mapboxError(echo), 404)).bound.call(signal()));
    expect([gone.code, gone.kind]).toEqual(['NOT_FOUND', 'NO_RESULT']);
    const empty = await canonicalFailureOf(bind(OPS.retrieve, () => json({ type: 'FeatureCollection', features: [] })).bound.call(signal()));
    expect([empty.code, empty.kind]).toEqual(['NOT_FOUND', 'NO_RESULT']);
    const incomplete = await canonicalFailureOf(bind(OPS.directions, () => json({ code: 'Ok', routes: [{ duration: 10 }] })).bound.call(signal()));
    expect([incomplete.code, incomplete.kind]).toEqual(['INCOMPLETE_ROUTE', 'MALFORMED']);
  });

  it.each(ALL.map((op) => [op.name, op] as const))(
    '%s: malformed ⇒ MALFORMED; deadline, cancellation and a stalled body ⇒ TIMEOUT; connect failure ⇒ CONNECT',
    async (_, op) => {
      for (const [, body] of MALFORMED_BODIES) expect((await canonicalFailureOf(bind(op, body).bound.call(signal()))).kind).toBe('MALFORMED');
      expect((await canonicalFailureOf(bind(op, () => never()).bound.call(AbortSignal.timeout(25)))).kind).toBe('TIMEOUT');
      const controller = new AbortController();
      const pending = bind(op, () => never()).bound.call(controller.signal);
      controller.abort();
      expect((await canonicalFailureOf(pending)).kind).toBe('TIMEOUT');
      const down = await canonicalFailureOf(bind(op, connectFailure).bound.call(signal()));
      expect(down.kind).toBe('CONNECT');
      expectNoLeak(down, [...SECRETS, 'api.mapbox.com']);
      const deadline = AbortSignal.timeout(25);
      expect((await canonicalFailureOf(bind(op, () => stallingBody(deadline)).bound.call(deadline))).kind).toBe('TIMEOUT');
    },
  );
});
