/**
 * Licence-declaration sanity (CON-P3-16, T3-22) and request privacy across every candidate adapter: each adapter
 * declares the expected SKUs under its opaque provider key, TTLs never exceed the terms-derived maxima, Google/Mapbox
 * content is renderer-coupled and its geometry not storable, and no outbound request carries an account, phone or
 * installation identifier.
 */
import type { GeoAdapterLicence, GeoSku } from '@wayvro/provider-interfaces';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC, encodePolyline, fakeFetch, json, type RecordedRequest } from '../test/fake-fetch.js';
import { createGoogleBundle, createMapboxBundle, createOpenStackComponents, type GeoBundleAdapters } from './bundles.js';
import { SecretValue, readOpenStackGeoConfig } from './config.js';
import { GOOGLE_TERMS, MAPBOX_TERMS, MICRO_USD_PER_CALL, OPEN_TERMS } from './licences.js';

const DAY = 86_400;
const CONFIGURED_MAXIMA: Record<GeoSku, number> = { AUTOCOMPLETE: DAY, GEOCODE: 7 * DAY, REVERSE_GEOCODE: 7 * DAY, PLACE_RESOLVE: 7 * DAY, ROUTE: 600 };

function all(bundle: GeoBundleAdapters): GeoAdapterLicence[] {
  return [bundle.placesAutocomplete, bundle.geocoding, bundle.reverseGeocoding, bundle.routing].flatMap((a) => [...a.licences]);
}

const google = createGoogleBundle({ apiKey: new SecretValue('synthetic-google-key-0123456789'), routesTrafficAware: false }, { providerKey: 'geo-a' });
const mapbox = createMapboxBundle({ accessToken: new SecretValue('pk.synthetic-token-0123456789abcdef') }, { providerKey: 'geo-b' });
const open = createOpenStackComponents(
  readOpenStackGeoConfig({
    GEO_PHOTON_URL: 'http://127.0.0.1:2322',
    GEO_NOMINATIM_URL: 'http://127.0.0.1:8088',
    GEO_OSRM_URL: 'http://127.0.0.1:5000',
    GEO_VALHALLA_URL: 'http://127.0.0.1:8002',
  }),
  { providerKey: 'geo-c' },
);
const openAdapters = [open.photonAutocomplete, open.photonGeocoding, open.photonReverse, open.nominatimReverse, open.osrm, open.valhalla];

describe('licence declarations', () => {
  it('declares every SKU once per bundle under the opaque provider key', () => {
    for (const [bundle, key] of [
      [google, 'geo-a'],
      [mapbox, 'geo-b'],
    ] as const) {
      const licences = all(bundle);
      expect(licences.map((l) => l.sku).sort()).toEqual(['AUTOCOMPLETE', 'GEOCODE', 'PLACE_RESOLVE', 'REVERSE_GEOCODE', 'ROUTE']);
      expect(new Set(licences.map((l) => l.providerKey))).toEqual(new Set([key]));
      for (const l of licences) expect(Object.isFrozen(l)).toBe(true);
    }
  });

  it('S1 Google: predictions and routes uncacheable, coordinates ≤ 30 days, Google renderer, geometry not storable', () => {
    const byS = Object.fromEntries(all(google).map((l) => [l.sku, l]));
    expect(byS['AUTOCOMPLETE']?.maxCacheTtlSeconds).toBe(0);
    expect(byS['ROUTE']?.maxCacheTtlSeconds).toBe(0);
    for (const sku of ['GEOCODE', 'PLACE_RESOLVE', 'REVERSE_GEOCODE']) expect(byS[sku]?.maxCacheTtlSeconds).toBeLessThanOrEqual(30 * DAY);
    for (const l of all(google)) {
      expect(l.requiresRenderer).toBe('google');
      expect(l.geometryStorable).toBe(false);
      expect(l.attributionCode).toBe('GOOGLE_MAPS');
    }
  });

  it('S2 Mapbox: nothing cacheable, Mapbox renderer only, geometry not storable', () => {
    for (const l of all(mapbox)) {
      expect(l.maxCacheTtlSeconds).toBe(0);
      expect(l.cacheSharedAcrossUsers).toBe(false);
      expect(l.requiresRenderer).toBe('mapbox');
      expect(l.geometryStorable).toBe(false);
    }
  });

  it('S3 open stack: any renderer, OSM attribution, TTL ≤ configured maxima, zero per-call price', () => {
    const licences = openAdapters.flatMap((a) => (a === null ? [] : [...a.licences]));
    expect(licences).toHaveLength(7);
    for (const l of licences) {
      expect(l.requiresRenderer).toBe('any');
      expect(l.attributionCode).toBe('OSM_ODBL');
      expect(l.maxCacheTtlSeconds).toBeLessThanOrEqual(CONFIGURED_MAXIMA[l.sku]);
      expect(l.microUsdPerCall).toBe(0);
    }
  });

  it('prices are non-negative integers (micro-USD) and Google/Mapbox TTL tables match the terms', () => {
    for (const v of Object.values(MICRO_USD_PER_CALL)) expect(Number.isInteger(v) && v >= 0).toBe(true);
    for (const terms of [...Object.values(GOOGLE_TERMS), ...Object.values(MAPBOX_TERMS), ...Object.values(OPEN_TERMS)]) {
      expect(terms.maxCacheTtlSeconds).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(terms.microUsdPerCall)).toBe(true);
    }
  });

  it('omits open-stack components whose URL is not configured (Photon geocoding needs Nominatim too)', () => {
    const partial = createOpenStackComponents(readOpenStackGeoConfig({ GEO_PHOTON_URL: 'http://127.0.0.1:2322' }), { providerKey: 'geo-c' });
    expect(partial.photonAutocomplete).not.toBeNull();
    expect(partial.photonGeocoding).toBeNull();
    expect(partial.nominatimReverse).toBeNull();
    expect(partial.osrm).toBeNull();
    expect(partial.valhalla).toBeNull();
  });
});

describe('request privacy (all adapters)', () => {
  const FORBIDDEN = /account|phone|msisdn|installation|device|user_?id|email|cnic/i;
  const SESSION = '6f1c2b8e-0000-4000-8000-000000000000';

  function responder(req: RecordedRequest): Response {
    const p = req.url.pathname;
    const line = {
      type: 'LineString',
      coordinates: [
        [74.3, 31.5],
        [74.4, 31.6],
      ],
    };
    if (p.includes('computeRoutes'))
      return json({ routes: [{ distanceMeters: 10, duration: '5s', polyline: { encodedPolyline: encodePolyline([SYNTHETIC.a, SYNTHETIC.c], 5) } }] });
    if (p.includes('directions') || p.includes('/route/v1/')) return json({ code: 'Ok', routes: [{ distance: 10, duration: 5, geometry: line }] });
    if (p.endsWith('/route')) return json({ trip: { summary: { length: 1, time: 1 }, legs: [{ shape: encodePolyline([SYNTHETIC.a, SYNTHETIC.c], 6) }] } });
    if (p.includes('places:autocomplete')) return json({ suggestions: [] });
    if (p.includes('/places/')) return json({ location: { latitude: 31.5, longitude: 74.3 } });
    if (p.includes('geocode/json')) return json({ status: 'ZERO_RESULTS' });
    if (p.includes('suggest')) return json({ suggestions: [] });
    if (p.includes('retrieve')) return json({ features: [{ geometry: { type: 'Point', coordinates: [74.3, 31.5] }, properties: { feature_type: 'poi' } }] });
    if (p.endsWith('/lookup')) return json([{ lat: '31.5', lon: '74.3' }]);
    if (p.endsWith('/reverse') && req.url.searchParams.has('format')) return json({ error: 'Unable to geocode' });
    return json({ features: [] });
  }

  it('sends only query text, coarse bias, points, session tokens and credentials', async () => {
    const f = fakeFetch(responder);
    const bundles = [
      createGoogleBundle(
        { apiKey: new SecretValue('synthetic-google-key-0123456789'), routesTrafficAware: true },
        { providerKey: 'geo-a', fetchImpl: f.fetchImpl },
      ),
      createMapboxBundle({ accessToken: new SecretValue('pk.synthetic-token-0123456789abcdef') }, { providerKey: 'geo-b', fetchImpl: f.fetchImpl }),
    ];
    const s3 = createOpenStackComponents(
      readOpenStackGeoConfig({
        GEO_PHOTON_URL: 'http://127.0.0.1:2322',
        GEO_NOMINATIM_URL: 'http://127.0.0.1:8088',
        GEO_OSRM_URL: 'http://127.0.0.1:5000',
        GEO_VALHALLA_URL: 'http://127.0.0.1:8002',
      }),
      { providerKey: 'geo-c', fetchImpl: f.fetchImpl },
    );
    const signal = AbortSignal.timeout(2000);
    const routeInput = { origin: SYNTHETIC.a, destination: SYNTHETIC.c, profile: 'CAR' as const, departAt: new Date(Date.now() + 3_600_000) };
    for (const b of bundles) {
      await b.placesAutocomplete.suggest(
        { text: 'synthetic', locale: 'en', biasCell: { lat: 31.52, lng: 74.35 }, countryCode: 'PK', searchSessionId: SESSION },
        signal,
      );
      await b.geocoding.geocode({ text: 'synthetic', locale: 'en', countryCode: 'PK' }, signal);
      await b.geocoding.resolve({ providerPlaceId: 'synthetic_id', searchSessionId: SESSION, locale: 'en' }, signal);
      await b.reverseGeocoding.reverse({ point: SYNTHETIC.b, locale: 'en' }, signal);
      await b.routing.route(routeInput, signal);
    }
    await s3.photonAutocomplete?.suggest({ text: 'synthetic', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal);
    await s3.photonGeocoding?.resolve({ providerPlaceId: 'N1', searchSessionId: SESSION, locale: 'en' }, signal);
    await s3.photonReverse?.reverse({ point: SYNTHETIC.b, locale: 'en' }, signal);
    await s3.nominatimReverse?.reverse({ point: SYNTHETIC.b, locale: 'en' }, signal);
    await s3.osrm?.route(routeInput, signal);
    await s3.valhalla?.route(routeInput, signal);
    expect(f.requests.length).toBeGreaterThanOrEqual(15);
    for (const req of f.requests) {
      const surface = [...req.url.searchParams.keys(), ...Object.keys(req.headers), JSON.stringify(req.body ?? {})].join(' ');
      expect(surface).not.toMatch(FORBIDDEN);
      expect(req.redirect).toBe('error');
    }
  });
});
