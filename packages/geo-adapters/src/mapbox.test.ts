/** S2 Mapbox adapters against HAND-WRITTEN SYNTHETIC payloads shaped like the documented schemas (SOURCES.md). */
import { describe, expect, it } from 'vitest';
import { SYNTHETIC, fakeFetch, json, type Responder } from '../test/fake-fetch.js';
import { SecretValue } from './config.js';
import { GeoAdapterError } from './errors.js';
import { MapboxDirectionsAdapter } from './mapbox/directions.js';
import { MapboxGeocodingAdapter } from './mapbox/geocoding.js';
import { MapboxReverseGeocodingAdapter } from './mapbox/reverse-geocoding.js';
import { MapboxSearchBoxAutocompleteAdapter } from './mapbox/search-box-autocomplete.js';

const accessToken = new SecretValue('pk.synthetic-token-0123456789abcdef');
const SESSION = '6f1c2b8e-0000-4000-8000-000000000000';
const signal = () => AbortSignal.timeout(2000);

function setup<T>(
  make: (o: { providerKey: string; accessToken: SecretValue; fetchImpl: ReturnType<typeof fakeFetch>['fetchImpl'] }) => T,
  responder: Responder,
) {
  const fake = fakeFetch(responder);
  return { adapter: make({ providerKey: 'geo-s2', accessToken, fetchImpl: fake.fetchImpl }), requests: fake.requests };
}

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (error: unknown) => error,
  );
  expect(e).toBeInstanceOf(GeoAdapterError);
  return (e as GeoAdapterError).code;
}

const context = { block: { name: 'Block Q' }, neighborhood: { name: 'Synthetic Town' }, place: { name: 'Lahore' }, country: { name: 'Pakistan' } };
const feature = (lng: number, lat: number, props: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: {
    mapbox_id: 'synthetic.id.1',
    feature_type: 'poi',
    name: 'Synthetic Park',
    context,
    coordinates: { longitude: lng, latitude: lat, accuracy: 'rooftop' },
    ...props,
  },
});

describe('MapboxSearchBoxAutocompleteAdapter', () => {
  const body = {
    suggestions: [
      { name: 'Synthetic Park', mapbox_id: 'synthetic.id.1', feature_type: 'poi', context, place_formatted: 'Lahore' },
      { name: 'Parks', mapbox_id: 'synthetic.cat', feature_type: 'category' },
      { name: 'Synthetic Road 1', mapbox_id: 'synthetic.id.2', feature_type: 'address' },
    ],
    attribution: 'synthetic attribution',
  };

  it('sends query, session token, country, limit, language, proximity and token only', async () => {
    const { adapter, requests } = setup(
      (o) => new MapboxSearchBoxAutocompleteAdapter(o),
      () => json(body),
    );
    const out = await adapter.suggest(
      { text: 'synthetic park', locale: 'en', biasCell: { lat: 31.52, lng: 74.35 }, countryCode: 'PK', searchSessionId: SESSION },
      signal(),
    );
    const url = requests[0]!.url;
    expect(`${url.origin}${url.pathname}`).toBe('https://api.mapbox.com/search/searchbox/v1/suggest');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'synthetic park',
      session_token: SESSION,
      country: 'pk',
      limit: '5',
      language: 'en',
      proximity: '74.35,31.52',
      access_token: accessToken.reveal(),
    });
    expect(out).toEqual([
      {
        providerPlaceId: 'synthetic.id.1',
        components: { name: 'Synthetic Park', block: 'Block Q', society: null, area: 'Synthetic Town', city: 'Lahore', nameUrdu: null },
        kind: 'LANDMARK',
      },
      {
        providerPlaceId: 'synthetic.id.2',
        components: { name: 'Synthetic Road 1', block: null, society: null, area: null, city: null, nameUrdu: null },
        kind: 'ADDRESS',
      },
    ]);
  });

  it('omits language for Urdu script and proximity without a cell', async () => {
    const { adapter, requests } = setup(
      (o) => new MapboxSearchBoxAutocompleteAdapter(o),
      () => json({ suggestions: [] }),
    );
    await adapter.suggest({ text: 'باغ', locale: 'ur', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal());
    expect(requests[0]!.url.searchParams.has('language')).toBe(false);
    expect(requests[0]!.url.searchParams.has('proximity')).toBe(false);
  });

  it('rejects malformed payloads and maps 429/401', async () => {
    const bad = setup(
      (o) => new MapboxSearchBoxAutocompleteAdapter(o),
      () => json({ suggestions: [{ name: 'x', mapbox_id: 'a/b', feature_type: 'poi' }] }),
    );
    expect(await code(bad.adapter.suggest({ text: 'x', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal()))).toBe(
      'MALFORMED_RESPONSE',
    );
    const limited = setup(
      (o) => new MapboxSearchBoxAutocompleteAdapter(o),
      () => json({ message: 'Too Many Requests' }, 429),
    );
    expect(await code(limited.adapter.suggest({ text: 'x', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal()))).toBe(
      'QUOTA',
    );
    const auth = setup(
      (o) => new MapboxSearchBoxAutocompleteAdapter(o),
      () => json({ message: 'Not Authorized - Invalid Token' }, 401),
    );
    expect(await code(auth.adapter.suggest({ text: 'x', locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: SESSION }, signal()))).toBe('AUTH');
  });
});

describe('MapboxGeocodingAdapter', () => {
  it('forward-geocodes as temporary (permanent=false) without autocomplete by default', async () => {
    const { adapter, requests } = setup(
      (o) => new MapboxGeocodingAdapter(o),
      () => json({ type: 'FeatureCollection', features: [feature(74.3, 31.5), feature(-0.1, 51.5)] }),
    );
    const out = await adapter.geocode({ text: 'synthetic park', locale: 'ur-Latn', countryCode: 'PK' }, signal());
    const url = requests[0]!.url;
    expect(`${url.origin}${url.pathname}`).toBe('https://api.mapbox.com/search/geocode/v6/forward');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'synthetic park',
      country: 'pk',
      limit: '5',
      permanent: 'false',
      autocomplete: 'false',
      language: 'en',
      access_token: accessToken.reveal(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ point: { lat: 31.5, lng: 74.3 }, kind: 'LANDMARK', confidence: 'HIGH' });
  });

  it('supports the autocomplete-via-temporary-geocoding benchmark variant', async () => {
    const fake = fakeFetch(() => json({ features: [] }));
    const adapter = new MapboxGeocodingAdapter({ providerKey: 'geo-s2', accessToken, fetchImpl: fake.fetchImpl, forwardAutocomplete: true });
    await adapter.geocode({ text: 'syn', locale: 'en', countryCode: 'PK' }, signal());
    expect(fake.requests[0]!.url.searchParams.get('autocomplete')).toBe('true');
  });

  it('maps accuracy to confidence', async () => {
    const acc = (accuracy: string | undefined) =>
      feature(74.3, 31.5, { coordinates: accuracy === undefined ? undefined : { longitude: 74.3, latitude: 31.5, accuracy } });
    const { adapter } = setup(
      (o) => new MapboxGeocodingAdapter(o),
      () => json({ features: [acc('parcel'), acc('street'), acc('approximate'), acc(undefined)] }),
    );
    const out = await adapter.geocode({ text: 'x', locale: 'en', countryCode: 'PK' }, signal());
    expect(out.map((p) => p.confidence)).toEqual(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
  });

  it('resolves through Search Box retrieve with the same session token', async () => {
    const { adapter, requests } = setup(
      (o) => new MapboxGeocodingAdapter(o),
      () => json({ type: 'FeatureCollection', features: [feature(74.35, 31.55)] }),
    );
    const out = await adapter.resolve({ providerPlaceId: 'synthetic.id.1', searchSessionId: SESSION, locale: 'ur' }, signal());
    const url = requests[0]!.url;
    expect(`${url.origin}${url.pathname}`).toBe('https://api.mapbox.com/search/searchbox/v1/retrieve/synthetic.id.1');
    expect(Object.fromEntries(url.searchParams)).toEqual({ session_token: SESSION, access_token: accessToken.reveal() });
    expect(out.point).toEqual({ lat: 31.55, lng: 74.35 });
  });

  it('maps retrieve failures without inventing a place', async () => {
    const empty = setup(
      (o) => new MapboxGeocodingAdapter(o),
      () => json({ features: [] }),
    );
    expect(await code(empty.adapter.resolve({ providerPlaceId: 'synthetic.id.1', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('NOT_FOUND');
    const gone = setup(
      (o) => new MapboxGeocodingAdapter(o),
      () => json({ message: 'Not Found' }, 404),
    );
    expect(await code(gone.adapter.resolve({ providerPlaceId: 'synthetic.id.1', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('NOT_FOUND');
    const far = setup(
      (o) => new MapboxGeocodingAdapter(o),
      () => json({ features: [feature(-0.1, 51.5)] }),
    );
    expect(await code(far.adapter.resolve({ providerPlaceId: 'synthetic.id.1', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('MALFORMED_RESPONSE');
    const bad = setup(
      (o) => new MapboxGeocodingAdapter(o),
      () => json({ features: [] }),
    );
    expect(await code(bad.adapter.resolve({ providerPlaceId: 'a/b?c', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('INVALID_INPUT');
    const invalid = setup(
      (o) => new MapboxGeocodingAdapter(o),
      () => json({ message: 'bad' }, 422),
    );
    expect(await code(invalid.adapter.resolve({ providerPlaceId: 'synthetic.id.1', searchSessionId: SESSION, locale: 'en' }, signal()))).toBe('CLIENT_ERROR');
  });
});

describe('MapboxReverseGeocodingAdapter', () => {
  it('sends 5-decimal coordinates and returns null for an empty collection', async () => {
    const { adapter, requests } = setup(
      (o) => new MapboxReverseGeocodingAdapter(o),
      () => json({ features: [] }),
    );
    expect(await adapter.reverse({ point: { lat: 31.1234567, lng: 74.7654321 }, locale: 'en' }, signal())).toBeNull();
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({
      longitude: '74.76543',
      latitude: '31.12346',
      country: 'pk',
      limit: '1',
      permanent: 'false',
      language: 'en',
      access_token: accessToken.reveal(),
    });
  });

  it('maps a feature and refuses an out-of-region answer', async () => {
    const ok = setup(
      (o) => new MapboxReverseGeocodingAdapter(o),
      () => json({ features: [feature(74.3, 31.5, { feature_type: 'neighborhood' })] }),
    );
    expect((await ok.adapter.reverse({ point: SYNTHETIC.a, locale: 'en' }, signal()))?.kind).toBe('AREA');
    const far = setup(
      (o) => new MapboxReverseGeocodingAdapter(o),
      () => json({ features: [feature(-0.1, 51.5)] }),
    );
    expect(await code(far.adapter.reverse({ point: SYNTHETIC.a, locale: 'en' }, signal()))).toBe('MALFORMED_RESPONSE');
  });
});

describe('MapboxDirectionsAdapter', () => {
  const input = { origin: SYNTHETIC.a, destination: SYNTHETIC.c, profile: 'CAR' as const, departAt: new Date('2026-10-13T10:00:00Z') };
  const geometry = {
    type: 'LineString',
    coordinates: [
      [74.3, 31.5],
      [74.35, 31.55],
      [74.4, 31.6],
    ],
  };

  it('requests mapbox/driving with a simplified GeoJSON overview', async () => {
    const { adapter, requests } = setup(
      (o) => new MapboxDirectionsAdapter(o),
      () => json({ code: 'Ok', routes: [{ distance: 15234.7, duration: 1200.2, geometry }] }),
    );
    const out = await adapter.route(input, signal());
    const url = requests[0]!.url;
    expect(`${url.origin}${decodeURIComponent(url.pathname)}`).toBe('https://api.mapbox.com/directions/v5/mapbox/driving/74.3,31.5;74.4,31.6');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      alternatives: 'false',
      steps: 'false',
      geometries: 'geojson',
      overview: 'simplified',
      access_token: accessToken.reveal(),
    });
    expect(out).toEqual({ distanceM: 15235, durationS: 1200, geometry: [SYNTHETIC.a, SYNTHETIC.b, SYNTHETIC.c], confidence: 'UNKNOWN' });
  });

  it.each([
    [{ code: 'NoRoute', routes: [] }, 'NO_ROUTE'],
    [{ code: 'NoSegment' }, 'NO_ROUTE'],
    [{ code: 'Ok', routes: [] }, 'NO_ROUTE'],
    [{ code: 'Weird' }, 'PROVIDER_STATUS'],
    [{ code: 'Ok', routes: [{ distance: 10, geometry }] }, 'INCOMPLETE_ROUTE'],
    [{ code: 'Ok', routes: [{ distance: 10, duration: 5 }] }, 'MALFORMED_RESPONSE'],
    [{ routes: [] }, 'MALFORMED_RESPONSE'],
  ])('%j ⇒ %s', async (payload, expected) => {
    const { adapter } = setup(
      (o) => new MapboxDirectionsAdapter(o),
      () => json(payload),
    );
    expect(await code(adapter.route(input, signal()))).toBe(expected);
  });

  it('maps 422 to CLIENT_ERROR and 5xx to SERVER_ERROR', async () => {
    const invalid = setup(
      (o) => new MapboxDirectionsAdapter(o),
      () => json({ code: 'InvalidInput', message: 'x' }, 422),
    );
    expect(await code(invalid.adapter.route(input, signal()))).toBe('CLIENT_ERROR');
    const down = setup(
      (o) => new MapboxDirectionsAdapter(o),
      () => json({}, 502),
    );
    expect(await code(down.adapter.route(input, signal()))).toBe('SERVER_ERROR');
  });
});
