/** S3 self-hosted open-stack adapters against HAND-WRITTEN SYNTHETIC payloads (SOURCES.md). */
import { describe, expect, it } from 'vitest';
import { SYNTHETIC, encodePolyline, fakeFetch, json, type Responder } from '../test/fake-fetch.js';
import { parseBaseUrl } from './config.js';
import { GeoAdapterError } from './errors.js';
import { PhotonAutocompleteAdapter } from './open/photon-autocomplete.js';
import { PhotonGeocodingAdapter } from './open/photon-geocoding.js';
import { NominatimReverseGeocodingAdapter, PhotonReverseGeocodingAdapter } from './open/reverse-geocoding.js';
import { OsrmRoutingAdapter, ValhallaRoutingAdapter } from './open/routing.js';

const SESSION = '6f1c2b8e-0000-4000-8000-000000000000';
const photonUrl = parseBaseUrl('GEO_PHOTON_URL', 'http://127.0.0.1:2322');
const nominatimUrl = parseBaseUrl('GEO_NOMINATIM_URL', 'http://127.0.0.1:8088/nominatim');
const signal = () => AbortSignal.timeout(2000);

function fake(responder: Responder) {
  return fakeFetch(responder);
}

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (error: unknown) => error,
  );
  expect(e).toBeInstanceOf(GeoAdapterError);
  return (e as GeoAdapterError).code;
}

const photonFeature = (lng: number, lat: number, props: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: {
    osm_type: 'N',
    osm_id: 1001,
    osm_key: 'amenity',
    osm_value: 'hospital',
    type: 'house',
    name: 'Synthetic Hospital',
    locality: 'Block K',
    district: 'Synthetic Town',
    city: 'Lahore',
    countrycode: 'PK',
    ...props,
  },
});

describe('PhotonAutocompleteAdapter', () => {
  it('queries /api with the Pakistan bbox and bias, dropping unresolvable or foreign features', async () => {
    const f = fake(() =>
      json({
        type: 'FeatureCollection',
        features: [
          photonFeature(74.3, 31.5),
          photonFeature(74.3, 31.5, { osm_type: undefined }),
          photonFeature(74.3, 31.5, { countrycode: 'IN' }),
          photonFeature(-0.1, 51.5),
          photonFeature(74.31, 31.51, { osm_type: 'W', osm_id: 22, osm_key: 'highway', type: 'street', name: 'Synthetic Road' }),
        ],
      }),
    );
    const adapter = new PhotonAutocompleteAdapter({ providerKey: 'geo-s3', baseUrl: photonUrl, fetchImpl: f.fetchImpl });
    const out = await adapter.suggest(
      { text: 'synthetic hos', locale: 'en', biasCell: { lat: 31.52, lng: 74.35 }, countryCode: 'PK', searchSessionId: SESSION },
      signal(),
    );
    const url = f.requests[0]!.url;
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:2322/api');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'synthetic hos',
      limit: '5',
      bbox: '60.8,23.5,77.9,37.2',
      lang: 'en',
      lat: '31.52',
      lon: '74.35',
    });
    expect(out).toEqual([
      {
        providerPlaceId: 'N1001',
        components: { name: 'Synthetic Hospital', block: 'Block K', society: null, area: 'Synthetic Town', city: 'Lahore', nameUrdu: null },
        kind: 'LANDMARK',
      },
      {
        providerPlaceId: 'W22',
        components: { name: 'Synthetic Road', block: 'Block K', society: null, area: 'Synthetic Town', city: 'Lahore', nameUrdu: null },
        kind: 'ADDRESS',
      },
    ]);
  });

  it('omits lang for Urdu script and rejects malformed collections', async () => {
    const f = fake(() => json({ features: [] }));
    const adapter = new PhotonAutocompleteAdapter({ providerKey: 'geo-s3', baseUrl: photonUrl, fetchImpl: f.fetchImpl });
    await adapter.suggest({ text: 'ہسپتال', locale: 'ur', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal());
    expect(f.requests[0]!.url.searchParams.has('lang')).toBe(false);
    expect(f.requests[0]!.url.searchParams.has('lat')).toBe(false);
    const bad = new PhotonAutocompleteAdapter({ providerKey: 'geo-s3', baseUrl: photonUrl, fetchImpl: fake(() => json({ features: 'nope' })).fetchImpl });
    expect(await code(bad.suggest({ text: 'x', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal()))).toBe(
      'MALFORMED_RESPONSE',
    );
  });
});

describe('PhotonGeocodingAdapter', () => {
  const nominatimPlace = {
    place_id: 1,
    osm_type: 'node',
    osm_id: 1001,
    lat: '31.55000',
    lon: '74.35000',
    category: 'amenity',
    type: 'hospital',
    addresstype: 'amenity',
    name: 'Synthetic Hospital',
    address: { amenity: 'Synthetic Hospital', neighbourhood: 'Block K', suburb: 'Synthetic Town', city: 'Lahore', country_code: 'pk' },
  };

  it('geocodes through Photon and resolves OSM references through Nominatim /lookup', async () => {
    const f = fake((req) =>
      req.url.pathname.endsWith('/lookup') ? json([nominatimPlace]) : json({ features: [photonFeature(74.3, 31.5), photonFeature(-0.1, 51.5)] }),
    );
    const adapter = new PhotonGeocodingAdapter({ providerKey: 'geo-s3', baseUrl: photonUrl, nominatimBaseUrl: nominatimUrl, fetchImpl: f.fetchImpl });
    const places = await adapter.geocode({ text: 'synthetic hospital', locale: 'en', countryCode: 'PK' }, signal());
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ point: { lat: 31.5, lng: 74.3 }, kind: 'LANDMARK', confidence: 'UNKNOWN' });
    const resolved = await adapter.resolve({ providerPlaceId: 'N1001', searchSessionId: SESSION, locale: 'ur' }, signal());
    const url = f.requests[1]!.url;
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:8088/nominatim/lookup');
    expect(Object.fromEntries(url.searchParams)).toEqual({ osm_ids: 'N1001', format: 'jsonv2', addressdetails: '1', 'accept-language': 'ur' });
    expect(resolved).toEqual({
      point: { lat: 31.55, lng: 74.35 },
      components: { name: 'Synthetic Hospital', block: 'Block K', society: null, area: 'Synthetic Town', city: 'Lahore', nameUrdu: null },
      kind: 'LANDMARK',
      confidence: 'UNKNOWN',
    });
  });

  it('refuses unsafe references and maps an empty lookup to NOT_FOUND', async () => {
    const f = fake(() => json([]));
    const adapter = new PhotonGeocodingAdapter({ providerKey: 'geo-s3', baseUrl: photonUrl, nominatimBaseUrl: nominatimUrl, fetchImpl: f.fetchImpl });
    expect(await code(adapter.resolve({ providerPlaceId: 'N1,W2', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('INVALID_INPUT');
    expect(await code(adapter.resolve({ providerPlaceId: 'N1001', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('NOT_FOUND');
    const foreign = new PhotonGeocodingAdapter({
      providerKey: 'geo-s3',
      baseUrl: photonUrl,
      nominatimBaseUrl: nominatimUrl,
      fetchImpl: fake(() => json([{ ...nominatimPlace, address: { country_code: 'in' } }])).fetchImpl,
    });
    expect(await code(foreign.resolve({ providerPlaceId: 'N1001', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('MALFORMED_RESPONSE');
  });
});

describe('reverse geocoding', () => {
  it('Photon /reverse: 5-decimal point, null on empty', async () => {
    const f = fake(() => json({ features: [] }));
    const adapter = new PhotonReverseGeocodingAdapter({ providerKey: 'geo-s3', baseUrl: photonUrl, fetchImpl: f.fetchImpl });
    expect(await adapter.reverse({ point: { lat: 31.1234567, lng: 74.7654321 }, locale: 'en' }, signal())).toBeNull();
    expect(Object.fromEntries(f.requests[0]!.url.searchParams)).toEqual({ lat: '31.12346', lon: '74.76543', limit: '1', lang: 'en' });
    const hit = new PhotonReverseGeocodingAdapter({
      providerKey: 'geo-s3',
      baseUrl: photonUrl,
      fetchImpl: fake(() => json({ features: [photonFeature(74.3, 31.5)] })).fetchImpl,
    });
    expect((await hit.reverse({ point: SYNTHETIC.a, locale: 'ur' }, signal()))?.components.name).toBe('Synthetic Hospital');
    const far = new PhotonReverseGeocodingAdapter({
      providerKey: 'geo-s3',
      baseUrl: photonUrl,
      fetchImpl: fake(() => json({ features: [photonFeature(-0.1, 51.5)] })).fetchImpl,
    });
    expect(await code(far.reverse({ point: SYNTHETIC.a, locale: 'en' }, signal()))).toBe('MALFORMED_RESPONSE');
  });

  it('Nominatim /reverse: jsonv2 zoom 18, "Unable to geocode" ⇒ null, other errors throw', async () => {
    const f = fake(() => json({ error: 'Unable to geocode' }));
    const adapter = new NominatimReverseGeocodingAdapter({ providerKey: 'geo-s3', baseUrl: nominatimUrl, fetchImpl: f.fetchImpl });
    expect(await adapter.reverse({ point: SYNTHETIC.a, locale: 'ur-Latn' }, signal())).toBeNull();
    expect(Object.fromEntries(f.requests[0]!.url.searchParams)).toEqual({
      lat: '31.50000',
      lon: '74.30000',
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '18',
      'accept-language': 'en',
    });
    const other = new NominatimReverseGeocodingAdapter({
      providerKey: 'geo-s3',
      baseUrl: nominatimUrl,
      fetchImpl: fake(() => json({ error: 'Internal problem' })).fetchImpl,
    });
    expect(await code(other.reverse({ point: SYNTHETIC.a, locale: 'en' }, signal()))).toBe('PROVIDER_STATUS');
    const place = { lat: '31.5', lon: '74.3', category: 'highway', addresstype: 'road', name: '', address: { road: 'Synthetic Road', town: 'Synthetic' } };
    const ok = new NominatimReverseGeocodingAdapter({ providerKey: 'geo-s3', baseUrl: nominatimUrl, fetchImpl: fake(() => json(place)).fetchImpl });
    expect(await ok.reverse({ point: SYNTHETIC.a, locale: 'en' }, signal())).toEqual({
      point: SYNTHETIC.a,
      components: { name: null, block: null, society: null, area: null, city: 'Synthetic', nameUrdu: null },
      kind: 'ADDRESS',
      confidence: 'UNKNOWN',
    });
    const badLat = new NominatimReverseGeocodingAdapter({
      providerKey: 'geo-s3',
      baseUrl: nominatimUrl,
      fetchImpl: fake(() => json({ ...place, lat: '31.5N' })).fetchImpl,
    });
    expect(await code(badLat.reverse({ point: SYNTHETIC.a, locale: 'en' }, signal()))).toBe('MALFORMED_RESPONSE');
    const tooMany = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`k${i}`, 'v']));
    const huge = new NominatimReverseGeocodingAdapter({
      providerKey: 'geo-s3',
      baseUrl: nominatimUrl,
      fetchImpl: fake(() => json({ ...place, address: tooMany })).fetchImpl,
    });
    expect(await code(huge.reverse({ point: SYNTHETIC.a, locale: 'en' }, signal()))).toBe('MALFORMED_RESPONSE');
  });
});

describe('OsrmRoutingAdapter', () => {
  const osrmUrl = parseBaseUrl('GEO_OSRM_URL', 'http://127.0.0.1:5000');
  const input = { origin: SYNTHETIC.a, destination: SYNTHETIC.c, profile: 'CAR' as const, departAt: new Date('2026-10-13T10:00:00Z') };
  const geometry = {
    type: 'LineString',
    coordinates: [
      [74.3, 31.5],
      [74.35, 31.55],
      [74.4, 31.6],
    ],
  };
  const adapterFor = (responder: Responder) => {
    const f = fake(responder);
    return { adapter: new OsrmRoutingAdapter({ providerKey: 'geo-s3', baseUrl: osrmUrl, fetchImpl: f.fetchImpl }), requests: f.requests };
  };

  it('requests the driving route with a simplified GeoJSON overview', async () => {
    const { adapter, requests } = adapterFor(() => json({ code: 'Ok', routes: [{ distance: 15000.4, duration: 1100.6, geometry }], waypoints: [] }));
    expect(await adapter.route(input, signal())).toEqual({
      distanceM: 15000,
      durationS: 1101,
      geometry: [SYNTHETIC.a, SYNTHETIC.b, SYNTHETIC.c],
      confidence: 'UNKNOWN',
    });
    const url = requests[0]!.url;
    expect(`${url.origin}${decodeURIComponent(url.pathname)}`).toBe('http://127.0.0.1:5000/route/v1/driving/74.3,31.5;74.4,31.6');
    expect(Object.fromEntries(url.searchParams)).toEqual({ alternatives: 'false', steps: 'false', overview: 'simplified', geometries: 'geojson' });
  });

  it.each([
    [400, { code: 'NoRoute', message: 'x' }, 'NO_ROUTE'],
    [400, { code: 'NoSegment' }, 'NO_ROUTE'],
    [400, { code: 'InvalidQuery' }, 'CLIENT_ERROR'],
    [200, { code: 'TooBig' }, 'PROVIDER_STATUS'],
    [200, { code: 'Ok', routes: [] }, 'NO_ROUTE'],
    [200, { code: 'Ok', routes: [{ distance: 0, duration: 0, geometry }] }, 'INCOMPLETE_ROUTE'],
    [
      200,
      {
        code: 'Ok',
        routes: [
          {
            distance: 10,
            duration: 1,
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          },
        ],
      },
      'MALFORMED_RESPONSE',
    ],
    [500, {}, 'SERVER_ERROR'],
  ])('HTTP %i %j ⇒ %s', async (status, payload, expected) => {
    const { adapter } = adapterFor(() => json(payload, status));
    expect(await code(adapter.route(input, signal()))).toBe(expected);
  });
});

describe('ValhallaRoutingAdapter', () => {
  const valhallaUrl = parseBaseUrl('GEO_VALHALLA_URL', 'http://127.0.0.1:8002');
  const input = { origin: SYNTHETIC.a, destination: SYNTHETIC.c, profile: 'CAR' as const, departAt: new Date('2026-10-13T10:00:00Z') };
  const shape = encodePolyline([SYNTHETIC.a, SYNTHETIC.b, SYNTHETIC.c], 6);
  const adapterFor = (responder: Responder) => {
    const f = fake(responder);
    return { adapter: new ValhallaRoutingAdapter({ providerKey: 'geo-s3', baseUrl: valhallaUrl, fetchImpl: f.fetchImpl }), requests: f.requests };
  };

  it('sends the documented GET json form and converts kilometres to metres', async () => {
    const { adapter, requests } = adapterFor(() =>
      json({ trip: { status: 0, units: 'kilometers', summary: { length: 15.2347, time: 1100.4 }, legs: [{ shape }] } }),
    );
    expect(await adapter.route(input, signal())).toEqual({
      distanceM: 15235,
      durationS: 1100,
      geometry: [SYNTHETIC.a, SYNTHETIC.b, SYNTHETIC.c],
      confidence: 'UNKNOWN',
    });
    const url = requests[0]!.url;
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:8002/route');
    expect(JSON.parse(url.searchParams.get('json') ?? '')).toEqual({
      locations: [
        { lat: 31.5, lon: 74.3, type: 'break' },
        { lat: 31.6, lon: 74.4, type: 'break' },
      ],
      costing: 'auto',
      units: 'kilometers',
      directions_type: 'none',
    });
  });

  it.each([
    [400, { error_code: 442, error: 'No path could be found for input', status_code: 400 }, 'NO_ROUTE'],
    [400, { error_code: 171 }, 'NO_ROUTE'],
    [400, { error_code: 154 }, 'CLIENT_ERROR'],
    [400, { message: 'no code' }, 'MALFORMED_RESPONSE'],
    [200, { trip: { units: 'miles', summary: { length: 1, time: 1 }, legs: [{ shape }] } }, 'MALFORMED_RESPONSE'],
    [200, { trip: { units: 'kilometers', summary: { length: 1 }, legs: [{ shape }] } }, 'INCOMPLETE_ROUTE'],
    [200, { trip: { units: 'kilometers', summary: { length: 1, time: 1 }, legs: [{ shape: '_p~iF~ps|' }] } }, 'MALFORMED_RESPONSE'],
    [200, { trip: { summary: { length: 1, time: 1 }, legs: [] } }, 'MALFORMED_RESPONSE'],
    [503, {}, 'SERVER_ERROR'],
  ])('HTTP %i %j ⇒ %s', async (status, payload, expected) => {
    const { adapter } = adapterFor(() => json(payload, status));
    expect(await code(adapter.route(input, signal()))).toBe(expected);
  });
});
