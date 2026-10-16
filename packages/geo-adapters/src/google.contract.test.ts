/**
 * S1 Google — ACCOUNT-FREE contract tests (no provider account, no real key, no network). Every payload is a
 * hand-written SYNTHETIC fixture shaped like the publicly documented schema (test/synthetic-google.ts); these tests
 * prove the adapters' request construction, key handling, parsing, error mapping, timeout behaviour, licence/cost
 * declarations and port boundary against those shapes. They do NOT prove real-provider conformance (FA-06).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  BODY_SENTINEL,
  FAKE_GOOGLE_KEY,
  HTTP_ERROR_STATUSES,
  MALFORMED_BODIES,
  QUERY_SENTINEL,
  SESSION,
  bind,
  connectFailure,
  expectNoLeak,
  expectedHttpCode,
  failureOf,
  stallingBody,
  type ContractOp,
} from '../test/contract-harness.js';
import { SYNTHETIC, fakeFetch, json, never } from '../test/fake-fetch.js';
import {
  GOOGLE_AUTOCOMPLETE_RESPONSE,
  GOOGLE_GEOCODING_OK_RESPONSE,
  GOOGLE_PLACE_DETAILS_RESPONSE,
  GOOGLE_ROUTES_RESPONSE,
  GOOGLE_RPC_STATUS,
  googleApiError,
  googleGeocodingStatus,
} from '../test/synthetic-google.js';
import { SecretValue } from './config.js';
import { GoogleGeocodingAdapter } from './google/geocoding.js';
import { GooglePlacesAutocompleteAdapter } from './google/places-autocomplete.js';
import { GoogleReverseGeocodingAdapter } from './google/reverse-geocoding.js';
import { GoogleRoutesAdapter } from './google/routes.js';
import type { FetchLike } from './http.js';
import { MICRO_USD_PER_CALL } from './licences.js';

const apiKey = new SecretValue(FAKE_GOOGLE_KEY);
const opts = (fetchImpl: FetchLike) => ({ providerKey: 'geo-s1', apiKey, fetchImpl });
const routeInput = { origin: SYNTHETIC.a, destination: SYNTHETIC.c, profile: 'CAR' as const, departAt: new Date('2026-10-16T10:00:00Z') };

const OPS = {
  autocomplete: {
    name: 'Places Autocomplete (New)',
    sku: 'AUTOCOMPLETE',
    make: (f) => {
      const a = new GooglePlacesAutocompleteAdapter(opts(f));
      return {
        licences: a.licences,
        call: (s) => a.suggest({ text: QUERY_SENTINEL, locale: 'en', biasCell: { lat: 31.52, lng: 74.35 }, countryCode: 'PK', searchSessionId: SESSION }, s),
      };
    },
    ok: () => json(GOOGLE_AUTOCOMPLETE_RESPONSE),
    http404: 'CLIENT_ERROR',
  },
  resolve: {
    name: 'Place Details (New)',
    sku: 'PLACE_RESOLVE',
    make: (f) => {
      const a = new GoogleGeocodingAdapter(opts(f));
      return { licences: a.licences, call: (s) => a.resolve({ providerPlaceId: 'synthetic_place_a', searchSessionId: SESSION, locale: 'en' }, s) };
    },
    ok: () => json(GOOGLE_PLACE_DETAILS_RESPONSE),
    http404: 'NOT_FOUND',
  },
  geocode: {
    name: 'Geocoding v3 forward',
    sku: 'GEOCODE',
    make: (f) => {
      const a = new GoogleGeocodingAdapter(opts(f));
      return { licences: a.licences, call: (s) => a.geocode({ text: QUERY_SENTINEL, locale: 'en', countryCode: 'PK' }, s) };
    },
    ok: () => json(GOOGLE_GEOCODING_OK_RESPONSE),
    http404: 'CLIENT_ERROR',
  },
  reverse: {
    name: 'Geocoding v3 reverse',
    sku: 'REVERSE_GEOCODE',
    make: (f) => {
      const a = new GoogleReverseGeocodingAdapter(opts(f));
      return { licences: a.licences, call: (s) => a.reverse({ point: SYNTHETIC.b, locale: 'en' }, s) };
    },
    ok: () => json(GOOGLE_GEOCODING_OK_RESPONSE),
    http404: 'CLIENT_ERROR',
  },
  route: {
    name: 'Routes computeRoutes',
    sku: 'ROUTE',
    make: (f) => {
      const a = new GoogleRoutesAdapter({ ...opts(f), trafficAware: false });
      return { licences: a.licences, call: (s) => a.route(routeInput, s) };
    },
    ok: () => json(GOOGLE_ROUTES_RESPONSE),
    http404: 'CLIENT_ERROR',
  },
} satisfies Record<string, ContractOp>;
const ALL: readonly ContractOp[] = Object.values(OPS);
/** Operations that authenticate with the `X-Goog-Api-Key` header (Places (New), Routes) vs the v3 `key` parameter. */
const HEADER_AUTH = new Set<ContractOp>([OPS.autocomplete, OPS.resolve, OPS.route]);
const SECRETS = [FAKE_GOOGLE_KEY, QUERY_SENTINEL, BODY_SENTINEL];
const signal = () => AbortSignal.timeout(2000);

describe('S1 Google contract: request construction and key handling', () => {
  it.each(ALL.map((op) => [op.name, op] as const))('%s: the key travels only through its documented channel, exactly once', async (_, op) => {
    const { bound, requests } = bind(op, () => op.ok());
    await bound.call(signal());
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    const body = JSON.stringify(req.body ?? {});
    expect(body).not.toContain(FAKE_GOOGLE_KEY);
    expect(req.headers['accept']).toBe('application/json');
    expect(req.redirect).toBe('error');
    if (HEADER_AUTH.has(op)) {
      expect(req.headers['x-goog-api-key']).toBe(FAKE_GOOGLE_KEY);
      expect(req.url.toString()).not.toContain(FAKE_GOOGLE_KEY);
    } else {
      expect(req.url.searchParams.getAll('key')).toEqual([FAKE_GOOGLE_KEY]);
      expect(Object.values(req.headers).join(' ')).not.toContain(FAKE_GOOGLE_KEY);
    }
  });

  it('field masks are explicit and minimal on every Places (New) / Routes call: no wildcard, no Pro-tier displayName', async () => {
    for (const op of HEADER_AUTH) {
      const { bound, requests } = bind(op, () => op.ok());
      await bound.call(signal());
      const mask = requests[0]?.headers['x-goog-fieldmask'] ?? '';
      expect(mask.length).toBeGreaterThan(0);
      for (const field of mask.split(',')) {
        expect(field).not.toContain('*');
        expect(field).not.toMatch(/displayName/);
      }
    }
    const { bound, requests } = bind(OPS.geocode, () => OPS.geocode.ok());
    await bound.call(signal());
    expect(requests[0]?.headers).not.toHaveProperty('x-goog-fieldmask');
  });

  it('autocomplete and Place Details carry the SAME session token (one billing session); geocoding and routes carry none', async () => {
    const f = fakeFetch((req) => (req.url.pathname.endsWith(':autocomplete') ? json(GOOGLE_AUTOCOMPLETE_RESPONSE) : OPS.resolve.ok()));
    const auto = new GooglePlacesAutocompleteAdapter(opts(f.fetchImpl));
    const details = new GoogleGeocodingAdapter(opts(f.fetchImpl));
    const [candidate] = await auto.suggest({ text: 'synthetic gate', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal());
    await details.resolve({ providerPlaceId: candidate!.providerPlaceId, searchSessionId: SESSION, locale: 'en' }, signal());
    expect((f.requests[0]?.body as { sessionToken: string }).sessionToken).toBe(SESSION);
    expect(f.requests[1]?.url.searchParams.get('sessionToken')).toBe(SESSION);
    expect(f.requests[1]?.url.pathname).toBe('/v1/places/synthetic_place_a');
    for (const op of [OPS.geocode, OPS.reverse, OPS.route]) {
      const { bound, requests } = bind(op, () => op.ok());
      await bound.call(signal());
      const surface = `${requests[0]?.url.toString() ?? ''} ${JSON.stringify(requests[0]?.body ?? {})}`;
      expect(surface).not.toMatch(/session/i);
    }
  });

  it('refuses a malformed session token before any provider call (no unbilled-session guesswork)', async () => {
    const f = fakeFetch(() => json({}));
    const auto = new GooglePlacesAutocompleteAdapter(opts(f.fetchImpl));
    const details = new GoogleGeocodingAdapter(opts(f.fetchImpl));
    for (const bad of ['', 'short', 'has space in it', 'x'.repeat(65), '../../etc']) {
      expect((await failureOf(auto.suggest({ text: 'x', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: bad }, signal()))).code).toBe(
        'INVALID_INPUT',
      );
      expect((await failureOf(details.resolve({ providerPlaceId: 'synthetic_place_a', searchSessionId: bad, locale: 'en' }, signal()))).code).toBe(
        'INVALID_INPUT',
      );
    }
    expect(f.requests).toHaveLength(0);
  });
});

describe('S1 Google contract: parsing documented shapes into port types only', () => {
  it('autocomplete: place predictions only (query predictions dropped), vendor fields never leak', async () => {
    const { bound } = bind(OPS.autocomplete, () => OPS.autocomplete.ok());
    const out = (await bound.call(signal())) as readonly object[];
    expect(out).toEqual([
      {
        providerPlaceId: 'synthetic_place_a',
        components: { name: 'Synthetic Gate', block: 'Synthetic Block C', society: null, area: null, city: null, nameUrdu: null },
        kind: 'LANDMARK',
      },
    ]);
    for (const c of out) expect(Object.keys(c).sort()).toEqual(['components', 'kind', 'providerPlaceId']);
  });

  it('Place Details: point, components and kind from the Essentials fields; confidence UNKNOWN (never invented)', async () => {
    const { bound } = bind(OPS.resolve, () => OPS.resolve.ok());
    const out = await bound.call(signal());
    expect(out).toEqual({
      point: { lat: 31.52, lng: 74.33 },
      components: { name: 'Synthetic Gate', block: 'Synthetic Block C', society: null, area: 'Synthetic Colony', city: 'Lahore', nameUrdu: null },
      kind: 'LANDMARK',
      confidence: 'UNKNOWN',
    });
  });

  it.each([OPS.geocode, OPS.reverse].map((op) => [op.name, op] as const))(
    '%s: viewport, plus code, place id and formatted address are dropped',
    async (_, op) => {
      const { bound } = bind(op, () => op.ok());
      const raw = await bound.call(signal());
      const place = (Array.isArray(raw) ? raw[0] : raw) as object;
      expect(place).toEqual({
        point: { lat: 31.51, lng: 74.32 },
        components: { name: null, block: null, society: null, area: 'Synthetic Colony', city: 'Lahore', nameUrdu: null },
        kind: 'ADDRESS',
        confidence: 'LOW',
      });
      expect(JSON.stringify(raw)).not.toMatch(/synthetic_geocode_place|viewport|plus_code|formatted_address/);
    },
  );

  it('computeRoutes: integer metres/seconds and the decoded overview only', async () => {
    const { bound } = bind(OPS.route, () => OPS.route.ok());
    expect(await bound.call(signal())).toEqual({
      distanceM: 15_234,
      durationS: 1265,
      geometry: [SYNTHETIC.a, SYNTHETIC.b, SYNTHETIC.c],
      confidence: 'UNKNOWN',
    });
  });
});

describe('S1 Google contract: error mapping to stable codes without leaking the key, query or provider body', () => {
  const cases = ALL.flatMap((op) => HTTP_ERROR_STATUSES.map((status) => [op.name, status, op] as const));

  it.each(cases)('%s: HTTP %i with a Google error-model body ⇒ stable code', async (_, status, op) => {
    const echo = `${BODY_SENTINEL} key=${FAKE_GOOGLE_KEY} q=${QUERY_SENTINEL}`;
    const { bound } = bind(op, () => json(googleApiError(status, GOOGLE_RPC_STATUS[status] ?? 'UNKNOWN', echo), status));
    const error = await failureOf(bound.call(signal()));
    const expected = expectedHttpCode(op, status);
    expect(error.code).toBe(expected);
    expect(error.httpStatus).toBe(status);
    expect(error.sku).toBe(op.sku);
    expect(error.providerKey).toBe('geo-s1');
    expect(error.countsAsProviderFailure).toBe(!['CLIENT_ERROR', 'NOT_FOUND'].includes(expected));
    expectNoLeak(error, SECRETS);
  });

  it.each(
    [OPS.geocode, OPS.reverse].flatMap((op) =>
      (
        [
          ['OVER_QUERY_LIMIT', 'QUOTA'],
          ['OVER_DAILY_LIMIT', 'QUOTA'],
          ['REQUEST_DENIED', 'AUTH'],
          ['INVALID_REQUEST', 'CLIENT_ERROR'],
          ['UNKNOWN_ERROR', 'SERVER_ERROR'],
        ] as const
      ).map(([status, code]) => [op.name, status, code, op] as const),
    ),
  )('%s: HTTP 200 status %s ⇒ %s, error_message never read', async (_, status, code, op) => {
    const { bound } = bind(op, () => json(googleGeocodingStatus(status, `${BODY_SENTINEL} ${FAKE_GOOGLE_KEY} ${QUERY_SENTINEL}`)));
    const error = await failureOf(bound.call(signal()));
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(200);
    expectNoLeak(error, SECRETS);
  });

  it('reverse ZERO_RESULTS is an honest null, never an invented address', async () => {
    const { bound } = bind(OPS.reverse, () => json(googleGeocodingStatus('ZERO_RESULTS', BODY_SENTINEL)));
    expect(await bound.call(signal())).toBeNull();
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

describe('S1 Google contract: timeouts, cancellation and transport failures', () => {
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

  it.each(ALL.map((op) => [op.name, op] as const))('%s: a connect failure echoing the keyed URL ⇒ NETWORK, URL not copied', async (_, op) => {
    const { bound } = bind(op, connectFailure);
    const error = await failureOf(bound.call(signal()));
    expect(error.code).toBe('NETWORK');
    expect(error.httpStatus).toBeNull();
    expectNoLeak(error, [...SECRETS, 'googleapis.com']);
  });
});

describe('S1 Google contract: cache-policy and cost-accounting hooks', () => {
  it('declares terms-derived TTLs: predictions and routes (both tiers) TTL 0, coordinates ≤ 30 days', () => {
    const f = fakeFetch(() => json({}));
    const decl = [
      ...OPS.autocomplete.make(f.fetchImpl).licences,
      ...OPS.resolve.make(f.fetchImpl).licences,
      ...OPS.reverse.make(f.fetchImpl).licences,
      ...new GoogleRoutesAdapter({ ...opts(f.fetchImpl), trafficAware: false }).licences,
      ...new GoogleRoutesAdapter({ ...opts(f.fetchImpl), trafficAware: true }).licences,
    ].map((l) => [l.sku, l.maxCacheTtlSeconds, l.cacheSharedAcrossUsers]);
    expect(decl).toEqual([
      ['AUTOCOMPLETE', 0, false],
      ['GEOCODE', 30 * 86_400, true],
      ['PLACE_RESOLVE', 30 * 86_400, true],
      ['REVERSE_GEOCODE', 30 * 86_400, true],
      ['ROUTE', 0, false],
      ['ROUTE', 0, false],
    ]);
  });

  it('declares the planning-time ESTIMATE price per SKU used by the gateway meter (micro-USD per call)', () => {
    const f = fakeFetch(() => json({}));
    const price = (op: ContractOp) => op.make(f.fetchImpl).licences.find((l) => l.sku === op.sku)?.microUsdPerCall;
    expect(price(OPS.autocomplete)).toBe(MICRO_USD_PER_CALL.googleAutocompleteRequest);
    expect(price(OPS.resolve)).toBe(MICRO_USD_PER_CALL.googlePlaceDetailsEssentials);
    expect(price(OPS.geocode)).toBe(MICRO_USD_PER_CALL.googleGeocoding);
    expect(price(OPS.reverse)).toBe(MICRO_USD_PER_CALL.googleGeocoding);
    expect(price(OPS.route)).toBe(MICRO_USD_PER_CALL.googleRoutesEssentials);
    expect(new GoogleRoutesAdapter({ ...opts(f.fetchImpl), trafficAware: true }).licences[0]?.microUsdPerCall).toBe(MICRO_USD_PER_CALL.googleRoutesPro);
  });

  it.each(ALL.map((op) => [op.name, op] as const))('%s: the adapter holds no cache of its own (TTL is enforced only by the gateway)', async (_, op) => {
    const { bound, requests } = bind(op, () => op.ok());
    await bound.call(signal());
    await bound.call(signal());
    expect(requests).toHaveLength(2);
  });
});

describe('S1 Google contract: no logging or telemetry from the adapter layer', () => {
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
      await bind(op, () => json(googleApiError(403, 'PERMISSION_DENIED', BODY_SENTINEL), 403))
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
