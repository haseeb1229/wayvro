/**
 * Candidate-adapter failure taxonomy through the real gateway (fix 2026-10-17) against real PostgreSQL + Valkey (own
 * throwaway database and Valkey namespace via startApi). The synthetic MOCK doubles answer success; thin wrappers
 * with the same licences throw `CandidateAdapterError` (the shape of the server-only GeoAdapterError) on demand:
 *  - QUOTA + Retry-After 7 ⇒ the real Valkey cool-down key expires after ≈ 7 s (not the 60 s default) and the next
 *    request never reaches the provider;
 *  - NO_RESULT on place resolution ⇒ 400 PLACE_REF_STALE (the client re-searches), not a 503;
 *  - NO_RESULT on routing ⇒ RoutingUnavailableError('NO_RESULT') — never an estimated distance or ETA;
 *  - the candidate's message never reaches a log line or a response.
 * Synthetic data only.
 */
import { AutocompleteResultSchema } from '@wayvro/contracts';
import type { GeocodingAdapter, ReverseGeocodingAdapter, RoutingAdapter } from '@wayvro/provider-interfaces';
import { createGeoTestDoubles } from '@wayvro/provider-test-doubles';
import { awaitRedisReady, createRequestPathRedis } from '@wayvro/server-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoutingUnavailableError } from '../src/geo/routing.js';
import { CANDIDATE_MESSAGE_SENTINEL, CandidateAdapterError } from './geo-candidate-doubles.js';
import { autocompleteUrl, geoGet, placeUrl, reasonCodes, reverseUrl, startGeoApi, type GeoHarness } from './geo-helpers.js';
import { signIn, type SignedIn } from './support.js';

const REDIS_URL = process.env['REDIS_URL'] ?? '';

const d = createGeoTestDoubles();
const faults: { resolve: (() => Error) | null; reverse: (() => Error) | null; route: (() => Error) | null } = { resolve: null, reverse: null, route: null };
const calls = { reverse: 0 };
const geocoding: GeocodingAdapter = {
  licences: d.geocoding.licences,
  geocode: (input, signal) => d.geocoding.geocode(input, signal),
  resolve: (input, signal) => (faults.resolve ? Promise.reject(faults.resolve()) : d.geocoding.resolve(input, signal)),
};
const reverseGeocoding: ReverseGeocodingAdapter = {
  licences: d.reverseGeocoding.licences,
  reverse: (input, signal) => {
    calls.reverse++;
    return faults.reverse ? Promise.reject(faults.reverse()) : d.reverseGeocoding.reverse(input, signal);
  },
};
const routing: RoutingAdapter = {
  licences: d.routing.licences,
  route: (input, signal) => (faults.route ? Promise.reject(faults.route()) : d.routing.route(input, signal)),
};

let g: GeoHarness;
let user: SignedIn;
beforeAll(async () => {
  g = await startGeoApi({ bind: [], providers: { placesAutocomplete: d.placesAutocomplete, geocoding, reverseGeocoding, routing } });
  user = await signIn(g.h);
}, 120_000);
afterAll(async () => {
  await g.h.close();
});

describe('candidate-adapter failures through the gateway (canonical taxonomy)', () => {
  it('QUOTA with Retry-After 7: the Valkey cool-down honours 7 s (not the 60 s default); the next request is not sent', async () => {
    const providerKey = d.reverseGeocoding.licences[0]?.providerKey ?? '';
    faults.reverse = () => new CandidateAdapterError('QUOTA', 'QUOTA', 429, 7);
    const first = await geoGet(g.h, reverseUrl(31.588, 74.31), user.accessToken);
    expect(first.statusCode).toBe(503);
    expect(reasonCodes(first)).toEqual(['GEO_PROVIDER_UNAVAILABLE']);
    faults.reverse = null;
    const redis = createRequestPathRedis(REDIS_URL, 2000);
    try {
      expect(await awaitRedisReady(redis, 5000)).toBe(true);
      const ttl = await redis.ttl(`${g.h.keyPrefix}geo:quota:${providerKey}:REVERSE_GEOCODE`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(7);
    } finally {
      redis.disconnect();
    }
    const before = calls.reverse;
    expect((await geoGet(g.h, reverseUrl(31.593, 74.309), user.accessToken)).statusCode).toBe(503);
    expect(calls.reverse).toBe(before);
    expect(g.h.logs.text()).toContain('GEO_PROVIDER_QUOTA_COOLDOWN');
    expect(g.h.logs.text()).not.toContain('GEO_BREAKER_OPENED');
  });

  it('NO_RESULT on place resolution ⇒ 400 PLACE_REF_STALE (re-search), never a 503 or an invented place', async () => {
    const ac = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl('liberty'), user.accessToken)).json());
    const ref = ac.suggestions[0]?.placeRef ?? '';
    faults.resolve = () => new CandidateAdapterError('NO_RESULT', 'NOT_FOUND', 404);
    try {
      const res = await geoGet(g.h, placeUrl(ref), user.accessToken);
      expect(res.statusCode, res.body).toBe(400);
      expect(reasonCodes(res)).toEqual(['PLACE_REF_STALE']);
      expect(res.body).not.toContain('CANDIDATE');
    } finally {
      faults.resolve = null;
    }
  });

  it('NO_RESULT on routing ⇒ RoutingUnavailableError NO_RESULT; AUTH ⇒ PROVIDER_ERROR; never an estimated route', async () => {
    const request = { origin: { lat: 31.51, lng: 74.34 }, destination: { lat: 31.53, lng: 74.4 }, profile: 'CAR' as const, departAt: new Date() };
    try {
      faults.route = () => new CandidateAdapterError('NO_RESULT', 'NO_ROUTE', 200);
      await expect(g.h.runtime.geo.routing.route(request, Date.now() + 3000)).rejects.toMatchObject({ name: 'RoutingUnavailableError', reason: 'NO_RESULT' });
      faults.route = () => new CandidateAdapterError('AUTH', 'AUTH', 400);
      const auth = g.h.runtime.geo.routing.route({ ...request, destination: { lat: 31.54, lng: 74.41 } }, Date.now() + 3000);
      await expect(auth).rejects.toBeInstanceOf(RoutingUnavailableError);
      await expect(auth).rejects.toMatchObject({ reason: 'PROVIDER_ERROR' });
    } finally {
      faults.route = null;
    }
    expect(g.h.logs.text()).not.toContain(CANDIDATE_MESSAGE_SENTINEL);
  });
});
