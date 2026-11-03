import { GeoProviderError, type GeoProviderFailure } from '@wayvro/provider-interfaces';
import { describe, expect, it } from 'vitest';
import { fakeFetch, json } from '../test/fake-fetch.js';
import { createGoogleBundle, createMapboxBundle } from './bundles.js';
import { SecretValue } from './config.js';
import { GeoAdapterError, toGeoProviderFailure, type GeoAdapterErrorCode } from './errors.js';

/**
 * The adapter → canonical taxonomy table, written out independently of the implementation (the implementation is a
 * `Record`, so a new adapter code without a mapping does not compile; this table catches a WRONG mapping).
 */
const EXPECTED: readonly (readonly [GeoAdapterErrorCode, number | null, GeoProviderFailure])[] = [
  ['TIMEOUT', null, 'TIMEOUT'],
  ['TIMEOUT', 200, 'TIMEOUT'],
  ['ABORTED', null, 'TIMEOUT'],
  ['NETWORK', null, 'CONNECT'],
  ['NETWORK', 200, 'UPSTREAM'],
  ['AUTH', 401, 'AUTH'],
  ['AUTH', 400, 'AUTH'],
  ['QUOTA', 429, 'QUOTA'],
  ['QUOTA', 200, 'QUOTA'],
  ['CLIENT_ERROR', 400, 'REJECTED_INPUT'],
  ['INVALID_INPUT', null, 'REJECTED_INPUT'],
  ['SERVER_ERROR', 503, 'UPSTREAM'],
  ['PROVIDER_STATUS', 200, 'UPSTREAM'],
  ['MALFORMED_RESPONSE', 200, 'MALFORMED'],
  ['OVERSIZED_RESPONSE', 200, 'MALFORMED'],
  ['INCOMPLETE_ROUTE', 200, 'MALFORMED'],
  ['NO_ROUTE', 200, 'NO_RESULT'],
  ['NOT_FOUND', 404, 'NO_RESULT'],
];

describe('GeoAdapterError is the canonical GeoProviderError (translation boundary, fix 2026-10-17)', () => {
  it.each(EXPECTED)('%s (HTTP %s) ⇒ kind %s', (code, status, kind) => {
    expect(toGeoProviderFailure(code, status)).toBe(kind);
    const error = new GeoAdapterError('geo-a', 'ROUTE', code, status);
    expect(error).toBeInstanceOf(GeoProviderError);
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe(kind);
    expect(error.code).toBe(code);
    expect(error.name).toBe('GeoAdapterError');
  });

  it('keeps the Wayvro-side message (opaque key, SKU, code, status) and a stack that matches it', () => {
    const error = new GeoAdapterError('geo-a', 'GEOCODE', 'SERVER_ERROR', 503);
    expect(error.message).toBe('geo adapter geo-a GEOCODE: SERVER_ERROR (HTTP 503)');
    expect(String(error)).toBe('GeoAdapterError: geo adapter geo-a GEOCODE: SERVER_ERROR (HTTP 503)');
    expect(error.stack?.split('\n')[0]).toBe('GeoAdapterError: geo adapter geo-a GEOCODE: SERVER_ERROR (HTTP 503)');
    expect(new GeoAdapterError('geo-a', 'ROUTE', 'NETWORK').message).toBe('geo adapter geo-a ROUTE: NETWORK');
  });

  it('carries a bounded Retry-After only on QUOTA', () => {
    expect(new GeoAdapterError('geo-a', 'ROUTE', 'QUOTA', 429, { retryAfterSeconds: 30 }).retryAfterSeconds).toBe(30);
    expect(new GeoAdapterError('geo-a', 'ROUTE', 'QUOTA', 429, { retryAfterSeconds: 0 }).retryAfterSeconds).toBe(1);
    expect(new GeoAdapterError('geo-a', 'ROUTE', 'QUOTA', 429, { retryAfterSeconds: 10_000 }).retryAfterSeconds).toBe(3600);
    expect(new GeoAdapterError('geo-a', 'ROUTE', 'QUOTA', 429, { retryAfterSeconds: -3 }).retryAfterSeconds).toBeUndefined();
    expect(new GeoAdapterError('geo-a', 'ROUTE', 'QUOTA', 429, { retryAfterSeconds: Number.NaN }).retryAfterSeconds).toBeUndefined();
    expect(new GeoAdapterError('geo-a', 'ROUTE', 'QUOTA', 429).retryAfterSeconds).toBeUndefined();
    expect(new GeoAdapterError('geo-a', 'ROUTE', 'SERVER_ERROR', 503, { retryAfterSeconds: 30 }).retryAfterSeconds).toBeUndefined();
    expect(new GeoAdapterError('geo-a', 'ROUTE', 'AUTH', 403, { retryAfterSeconds: 30 }).retryAfterSeconds).toBeUndefined();
  });

  it('passes an explicit cause through (dev-only SP-04 harness) and has none by default', () => {
    const cause = new Error('underlying');
    expect(new GeoAdapterError('geo-a', 'GEOCODE', 'NETWORK', null, { cause }).cause).toBe(cause);
    expect(new GeoAdapterError('geo-a', 'GEOCODE', 'NETWORK').cause).toBeUndefined();
    expect('cause' in new GeoAdapterError('geo-a', 'GEOCODE', 'NETWORK')).toBe(false);
  });
});

describe('bundle factories pass the injected server clock to every adapter (HTTP-date Retry-After)', () => {
  it('a 429 HTTP-date is measured against the bundle clock, for S1 and S2 alike', async () => {
    const now = () => new Date('2026-10-17T10:00:00Z');
    const fake = fakeFetch(() => json({}, 429, { 'retry-after': 'Sat, 17 Oct 2026 10:00:20 GMT' }));
    const s1 = createGoogleBundle(
      { apiKey: new SecretValue('synthetic-google-key-0123456789'), routesTrafficAware: false },
      { providerKey: 'geo-a', fetchImpl: fake.fetchImpl, now },
    );
    const s2 = createMapboxBundle(
      { accessToken: new SecretValue('pk.synthetic-token-0123456789abcdef') },
      { providerKey: 'geo-b', fetchImpl: fake.fetchImpl, now },
    );
    const route = {
      origin: { lat: 31.5, lng: 74.3 },
      destination: { lat: 31.6, lng: 74.4 },
      profile: 'CAR' as const,
      departAt: new Date('2026-10-17T10:15:00Z'),
    };
    for (const bundle of [s1, s2]) {
      const error = await bundle.routing.route(route, AbortSignal.timeout(2000)).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(GeoProviderError);
      expect((error as GeoProviderError).kind).toBe('QUOTA');
      expect((error as GeoProviderError).retryAfterSeconds).toBe(20);
    }
  });
});
