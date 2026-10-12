/**
 * S1 Google adapters against HAND-WRITTEN SYNTHETIC payloads shaped like the documented schemas (SOURCES.md).
 * No captured provider response is used; a real-provider run is `test:live` (NOT RUN without founder keys).
 */
import { describe, expect, it } from 'vitest';
import { SYNTHETIC, encodePolyline, fakeFetch, json } from '../test/fake-fetch.js';
import { SecretValue } from './config.js';
import { GeoAdapterError } from './errors.js';
import { GoogleGeocodingAdapter } from './google/geocoding.js';
import { GooglePlacesAutocompleteAdapter } from './google/places-autocomplete.js';
import { GoogleReverseGeocodingAdapter } from './google/reverse-geocoding.js';
import { GoogleRoutesAdapter, parseDurationSeconds } from './google/routes.js';
import type { Responder } from '../test/fake-fetch.js';

const apiKey = new SecretValue('synthetic-google-key-0123456789');
const SESSION = '6f1c2b8e-0000-4000-8000-000000000000';
const signal = () => AbortSignal.timeout(2000);

function setup<T>(make: (o: { providerKey: string; apiKey: SecretValue; fetchImpl: ReturnType<typeof fakeFetch>['fetchImpl'] }) => T, responder: Responder) {
  const fake = fakeFetch(responder);
  return { adapter: make({ providerKey: 'geo-s1', apiKey, fetchImpl: fake.fetchImpl }), requests: fake.requests };
}

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (error: unknown) => error,
  );
  expect(e).toBeInstanceOf(GeoAdapterError);
  return (e as GeoAdapterError).code;
}

const geocodeResult = (lat: number, lng: number, extra: Record<string, unknown> = {}) => ({
  address_components: [
    { long_name: 'Synthetic Hospital', short_name: 'SH', types: ['point_of_interest', 'establishment'] },
    { long_name: 'Block K', short_name: 'Block K', types: ['sublocality_level_2', 'sublocality', 'political'] },
    { long_name: 'Synthetic Town', short_name: 'ST', types: ['sublocality_level_1', 'sublocality', 'political'] },
    { long_name: 'Lahore', short_name: 'Lahore', types: ['locality', 'political'] },
  ],
  formatted_address: 'Synthetic Hospital, Block K, Synthetic Town, Lahore, Pakistan',
  geometry: { location: { lat, lng }, location_type: 'ROOFTOP' },
  place_id: 'synthetic_place_id_1',
  types: ['hospital', 'point_of_interest', 'establishment'],
  ...extra,
});

describe('GooglePlacesAutocompleteAdapter', () => {
  const body = {
    suggestions: [
      {
        placePrediction: {
          place: 'places/synthetic_a',
          placeId: 'synthetic_a',
          text: { text: 'Synthetic Market, Synthetic Town, Lahore, Pakistan' },
          structuredFormat: { mainText: { text: 'Synthetic Market' }, secondaryText: { text: 'Synthetic Town, Lahore, Pakistan' } },
          types: ['shopping_mall', 'point_of_interest', 'establishment'],
        },
      },
      { queryPrediction: { text: { text: 'ignored' } } },
      { placePrediction: { placeId: 'synthetic_b', text: { text: 'Block H' }, types: ['sublocality_level_2'] } },
    ],
  };

  it('sends only query text, region, language, session token and the coarse bias cell', async () => {
    const { adapter, requests } = setup(
      (o) => new GooglePlacesAutocompleteAdapter(o),
      () => json(body),
    );
    const out = await adapter.suggest(
      { text: ' synthetic mar ', locale: 'ur-Latn', biasCell: { lat: 31.52, lng: 74.35 }, countryCode: 'PK', searchSessionId: SESSION },
      signal(),
    );
    const req = requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.url.toString()).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect(req.headers['x-goog-api-key']).toBe(apiKey.reveal());
    expect(req.headers['x-goog-fieldmask']).toBe(
      'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types',
    );
    expect(req.body).toEqual({
      input: 'synthetic mar',
      includedRegionCodes: ['pk'],
      regionCode: 'pk',
      languageCode: 'en',
      sessionToken: SESSION,
      locationBias: { circle: { center: { latitude: 31.52, longitude: 74.35 }, radius: 10_000 } },
    });
    expect(out).toEqual([
      {
        providerPlaceId: 'synthetic_a',
        components: { name: 'Synthetic Market', block: null, society: null, area: 'Synthetic Town', city: null, nameUrdu: null },
        kind: 'LANDMARK',
      },
      { providerPlaceId: 'synthetic_b', components: { name: 'Block H', block: null, society: null, area: null, city: null, nameUrdu: null }, kind: 'AREA' },
    ]);
  });

  it('omits the bias without a cell, uses ur for Urdu script and keeps provider Urdu names', async () => {
    const urdu = { suggestions: [{ placePrediction: { placeId: 'synthetic_u', structuredFormat: { mainText: { text: 'مصنوعی بازار' } } } }] };
    const { adapter, requests } = setup(
      (o) => new GooglePlacesAutocompleteAdapter(o),
      () => json(urdu),
    );
    const out = await adapter.suggest({ text: 'بازار', locale: 'ur', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal());
    expect(requests[0]?.body).not.toHaveProperty('locationBias');
    expect((requests[0]?.body as { languageCode: string }).languageCode).toBe('ur');
    expect(out[0]?.components.nameUrdu).toBe('مصنوعی بازار');
    expect(out[0]?.kind).toBe('OTHER');
  });

  it('treats an empty response as no suggestions and rejects malformed ids', async () => {
    const empty = setup(
      (o) => new GooglePlacesAutocompleteAdapter(o),
      () => json({}),
    );
    expect(await empty.adapter.suggest({ text: 'zz', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal())).toEqual([]);
    const bad = setup(
      (o) => new GooglePlacesAutocompleteAdapter(o),
      () => json({ suggestions: [{ placePrediction: { placeId: '../x' } }] }),
    );
    expect(await code(bad.adapter.suggest({ text: 'zz', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal()))).toBe(
      'MALFORMED_RESPONSE',
    );
  });

  it('maps quota and auth failures', async () => {
    const quota = setup(
      (o) => new GooglePlacesAutocompleteAdapter(o),
      () => json({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429),
    );
    expect(await code(quota.adapter.suggest({ text: 'zz', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal()))).toBe(
      'QUOTA',
    );
    const denied = setup(
      (o) => new GooglePlacesAutocompleteAdapter(o),
      () => json({ error: { status: 'PERMISSION_DENIED' } }, 403),
    );
    expect(await code(denied.adapter.suggest({ text: 'zz', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal()))).toBe(
      'AUTH',
    );
  });
});

describe('GoogleGeocodingAdapter.geocode', () => {
  it('sends address, country component, region, language and key only', async () => {
    const { adapter, requests } = setup(
      (o) => new GoogleGeocodingAdapter(o),
      () => json({ status: 'OK', results: [geocodeResult(31.5, 74.3)] }),
    );
    const out = await adapter.geocode({ text: 'synthetic hospital', locale: 'en', countryCode: 'PK' }, signal());
    const url = requests[0]!.url;
    expect(`${url.origin}${url.pathname}`).toBe('https://maps.googleapis.com/maps/api/geocode/json');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      address: 'synthetic hospital',
      components: 'country:PK',
      region: 'pk',
      language: 'en',
      key: apiKey.reveal(),
    });
    expect(out).toEqual([
      {
        point: { lat: 31.5, lng: 74.3 },
        components: { name: 'Synthetic Hospital', block: 'Block K', society: null, area: 'Synthetic Town', city: 'Lahore', nameUrdu: null },
        kind: 'LANDMARK',
        confidence: 'HIGH',
      },
    ]);
  });

  it('drops results outside Pakistan and maps confidence', async () => {
    const results = [
      geocodeResult(51.5, -0.1),
      geocodeResult(31.5, 74.3, { geometry: { location: { lat: 31.5, lng: 74.3 }, location_type: 'RANGE_INTERPOLATED' } }),
      geocodeResult(31.5, 74.3, { geometry: { location: { lat: 31.5, lng: 74.3 }, location_type: 'APPROXIMATE' } }),
      geocodeResult(31.5, 74.3, { partial_match: true }),
      geocodeResult(31.5, 74.3, { geometry: { location: { lat: 31.5, lng: 74.3 } } }),
    ];
    const { adapter } = setup(
      (o) => new GoogleGeocodingAdapter(o),
      () => json({ status: 'OK', results }),
    );
    const out = await adapter.geocode({ text: 'x', locale: 'en', countryCode: 'PK' }, signal());
    expect(out.map((p) => p.confidence)).toEqual(['MEDIUM', 'LOW', 'LOW', 'UNKNOWN']);
  });

  it.each([
    ['ZERO_RESULTS', null],
    ['OVER_QUERY_LIMIT', 'QUOTA'],
    ['OVER_DAILY_LIMIT', 'QUOTA'],
    ['REQUEST_DENIED', 'AUTH'],
    ['INVALID_REQUEST', 'CLIENT_ERROR'],
    ['UNKNOWN_ERROR', 'SERVER_ERROR'],
    ['SOMETHING_NEW', 'PROVIDER_STATUS'],
  ])('maps status %s', async (status, expected) => {
    const { adapter } = setup(
      (o) => new GoogleGeocodingAdapter(o),
      () => json({ status, error_message: 'echo SECRET query' }),
    );
    const p = adapter.geocode({ text: 'x', locale: 'en', countryCode: 'PK' }, signal());
    if (expected === null) expect(await p).toEqual([]);
    else expect(await code(p)).toBe(expected);
  });

  it('treats OK without results and wrong types as malformed', async () => {
    const empty = setup(
      (o) => new GoogleGeocodingAdapter(o),
      () => json({ status: 'OK', results: [] }),
    );
    expect(await code(empty.adapter.geocode({ text: 'x', locale: 'en', countryCode: 'PK' }, signal()))).toBe('MALFORMED_RESPONSE');
    const wrong = setup(
      (o) => new GoogleGeocodingAdapter(o),
      () => json({ status: 'OK', results: [{ geometry: { location: { lat: '31', lng: 74 } }, address_components: [] }] }),
    );
    expect(await code(wrong.adapter.geocode({ text: 'x', locale: 'en', countryCode: 'PK' }, signal()))).toBe('MALFORMED_RESPONSE');
  });
});

describe('GoogleGeocodingAdapter.resolve', () => {
  const details = {
    id: 'synthetic_a',
    location: { latitude: 31.55, longitude: 74.35 },
    addressComponents: [
      { longText: 'Synthetic Market', shortText: 'SM', types: ['point_of_interest'] },
      { longText: 'Lahore', types: ['locality'] },
    ],
    types: ['shopping_mall'],
  };

  it('requests the Essentials field mask with the session token (no displayName)', async () => {
    const { adapter, requests } = setup(
      (o) => new GoogleGeocodingAdapter(o),
      () => json(details),
    );
    const out = await adapter.resolve({ providerPlaceId: 'synthetic_a', searchSessionId: SESSION, locale: 'en' }, signal());
    const req = requests[0]!;
    expect(`${req.url.origin}${req.url.pathname}`).toBe('https://places.googleapis.com/v1/places/synthetic_a');
    expect(Object.fromEntries(req.url.searchParams)).toEqual({ languageCode: 'en', regionCode: 'pk', sessionToken: SESSION });
    expect(req.headers['x-goog-fieldmask']).toBe('id,location,addressComponents,types');
    expect(out).toEqual({
      point: { lat: 31.55, lng: 74.35 },
      components: { name: 'Synthetic Market', block: null, society: null, area: null, city: 'Lahore', nameUrdu: null },
      kind: 'LANDMARK',
      confidence: 'UNKNOWN',
    });
  });

  it('refuses unsafe ids before calling, maps 404 to NOT_FOUND and out-of-region to MALFORMED', async () => {
    const guard = setup(
      (o) => new GoogleGeocodingAdapter(o),
      () => json(details),
    );
    expect(await code(guard.adapter.resolve({ providerPlaceId: '../../admin', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('INVALID_INPUT');
    expect(guard.requests).toHaveLength(0);
    const missing = setup(
      (o) => new GoogleGeocodingAdapter(o),
      () => json({ error: {} }, 404),
    );
    expect(await code(missing.adapter.resolve({ providerPlaceId: 'gone', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('NOT_FOUND');
    const far = setup(
      (o) => new GoogleGeocodingAdapter(o),
      () => json({ ...details, location: { latitude: 0, longitude: 0 } }),
    );
    expect(await code(far.adapter.resolve({ providerPlaceId: 'x', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('MALFORMED_RESPONSE');
    const down = setup(
      (o) => new GoogleGeocodingAdapter(o),
      () => json({}, 500),
    );
    expect(await code(down.adapter.resolve({ providerPlaceId: 'x', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('SERVER_ERROR');
  });
});

describe('GoogleReverseGeocodingAdapter', () => {
  it('sends the point with 5 decimals and returns the first result', async () => {
    const { adapter, requests } = setup(
      (o) => new GoogleReverseGeocodingAdapter(o),
      () => json({ status: 'OK', results: [geocodeResult(31.5, 74.3)] }),
    );
    const out = await adapter.reverse({ point: { lat: 31.1234567, lng: 74.7654321 }, locale: 'ur' }, signal());
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({ latlng: '31.12346,74.76543', language: 'ur', key: apiKey.reveal() });
    expect(out?.components.name).toBe('Synthetic Hospital');
  });

  it('returns null on ZERO_RESULTS and throws for an impossible out-of-region answer', async () => {
    const none = setup(
      (o) => new GoogleReverseGeocodingAdapter(o),
      () => json({ status: 'ZERO_RESULTS', results: [] }),
    );
    expect(await none.adapter.reverse({ point: SYNTHETIC.a, locale: 'en' }, signal())).toBeNull();
    const far = setup(
      (o) => new GoogleReverseGeocodingAdapter(o),
      () => json({ status: 'OK', results: [geocodeResult(51.5, -0.1)] }),
    );
    expect(await code(far.adapter.reverse({ point: SYNTHETIC.a, locale: 'en' }, signal()))).toBe('MALFORMED_RESPONSE');
    const outside = setup(
      (o) => new GoogleReverseGeocodingAdapter(o),
      () => json({}),
    );
    expect(await code(outside.adapter.reverse({ point: { lat: 51.5, lng: -0.1 }, locale: 'en' }, signal()))).toBe('INVALID_INPUT');
    expect(outside.requests).toHaveLength(0);
  });
});

describe('GoogleRoutesAdapter', () => {
  const polyline = encodePolyline([SYNTHETIC.a, SYNTHETIC.b, SYNTHETIC.c], 5);
  const departAt = new Date('2026-10-13T10:00:00Z');
  const input = { origin: SYNTHETIC.a, destination: SYNTHETIC.c, profile: 'CAR' as const, departAt };

  it('sends a traffic-unaware DRIVE request without departure time and the minimal field mask', async () => {
    const { adapter, requests } = setup(
      (o) => new GoogleRoutesAdapter({ ...o, trafficAware: false }),
      () => json({ routes: [{ distanceMeters: 15234, duration: '1234.4s', polyline: { encodedPolyline: polyline } }] }),
    );
    const out = await adapter.route(input, signal());
    const req = requests[0]!;
    expect(req.url.toString()).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(req.headers['x-goog-fieldmask']).toBe('routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline');
    expect(req.body).toEqual({
      origin: { location: { latLng: { latitude: 31.5, longitude: 74.3 } } },
      destination: { location: { latLng: { latitude: 31.6, longitude: 74.4 } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      computeAlternativeRoutes: false,
      polylineQuality: 'OVERVIEW',
      polylineEncoding: 'ENCODED_POLYLINE',
      units: 'METRIC',
      languageCode: 'en',
      regionCode: 'pk',
    });
    expect(out).toEqual({ distanceM: 15234, durationS: 1234, geometry: [SYNTHETIC.a, SYNTHETIC.b, SYNTHETIC.c], confidence: 'UNKNOWN' });
    expect(adapter.licences[0]?.microUsdPerCall).toBe(5_000);
  });

  it('adds departureTime only for traffic-aware requests in the future', async () => {
    const ok = () => json({ routes: [{ distanceMeters: 10, duration: '5s', polyline: { encodedPolyline: polyline } }] });
    const future = setup((o) => new GoogleRoutesAdapter({ ...o, trafficAware: true, now: () => new Date('2026-10-13T09:00:00Z') }), ok);
    await future.adapter.route(input, signal());
    expect(future.requests[0]?.body).toMatchObject({ routingPreference: 'TRAFFIC_AWARE', departureTime: '2026-10-13T10:00:00.000Z' });
    expect(future.adapter.licences[0]?.microUsdPerCall).toBe(10_000);
    const past = setup((o) => new GoogleRoutesAdapter({ ...o, trafficAware: true, now: () => new Date('2026-10-13T11:00:00Z') }), ok);
    await past.adapter.route(input, signal());
    expect(past.requests[0]?.body).not.toHaveProperty('departureTime');
  });

  it.each([
    [{}, 'NO_ROUTE'],
    [{ routes: [] }, 'NO_ROUTE'],
    [{ routes: [{ duration: '5s', polyline: { encodedPolyline: 'x' } }] }, 'INCOMPLETE_ROUTE'],
    [{ routes: [{ distanceMeters: 10, polyline: { encodedPolyline: 'x' } }] }, 'INCOMPLETE_ROUTE'],
    [{ routes: [{ distanceMeters: 10, duration: 'five seconds' }] }, 'INCOMPLETE_ROUTE'],
    [{ routes: [{ distanceMeters: 10, duration: '5s' }] }, 'MALFORMED_RESPONSE'],
    [{ routes: [{ distanceMeters: 10, duration: '5s', polyline: { encodedPolyline: '_p~iF~ps|' } }] }, 'MALFORMED_RESPONSE'],
    [{ routes: [{ distanceMeters: 'ten' }] }, 'MALFORMED_RESPONSE'],
  ])('never defaults an incomplete route: %j ⇒ %s', async (payload, expected) => {
    const { adapter } = setup(
      (o) => new GoogleRoutesAdapter({ ...o, trafficAware: false }),
      () => json(payload),
    );
    expect(await code(adapter.route(input, signal()))).toBe(expected);
  });

  it('parses protobuf durations strictly', () => {
    expect(parseDurationSeconds('165s')).toBe(165);
    expect(parseDurationSeconds('12.5s')).toBe(12.5);
    expect(parseDurationSeconds('12')).toBeNull();
    expect(parseDurationSeconds(undefined)).toBeNull();
  });
});
