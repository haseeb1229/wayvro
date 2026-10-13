import { GeoProviderError, ProviderBindingError, assertGeoBundle, bindProviders, isMockProvider } from '@wayvro/provider-interfaces';
import { describe, expect, it } from 'vitest';
import { GEO_MOCK_PROVIDER_KEY, SYNTHETIC_GAZETTEER, createGeoTestDoubles, straightLineRoute } from './geo.js';

const live = (): AbortSignal => new AbortController().signal;
const session = '0192a5b0-0000-7000-8000-000000000001';
const input = (text: string) => ({ text, locale: 'en' as const, biasCell: null, countryCode: 'PK' as const, searchSessionId: session });

describe('synthetic geo doubles (local/test only)', () => {
  it('are MOCK-branded and refused outside local/test, with licence declarations that pass the bundle check', () => {
    const d = createGeoTestDoubles();
    for (const port of [d.placesAutocomplete, d.geocoding, d.reverseGeocoding, d.routing]) expect(isMockProvider(port)).toBe(true);
    const bindings = { placesAutocomplete: d.placesAutocomplete, geocoding: d.geocoding, reverseGeocoding: d.reverseGeocoding, routing: d.routing };
    expect(() => bindProviders('staging', bindings)).toThrow(ProviderBindingError);
    expect(() => bindProviders('production', bindings)).toThrow(ProviderBindingError);
    const bundle = assertGeoBundle('none', bindProviders('test', bindings));
    expect(bundle.boundSkus).toHaveLength(5);
    expect(bundle.licence('ROUTE')).toMatchObject({ providerKey: GEO_MOCK_PROVIDER_KEY, requiresRenderer: 'any', attributionCode: 'SYNTHETIC_DATA' });
  });

  it('keeps the gazetteer coarse (≤ 3 decimals) and inside Lahore', () => {
    for (const p of SYNTHETIC_GAZETTEER) {
      expect(Math.round(p.point.lat * 1000) / 1000).toBe(p.point.lat);
      expect(Math.round(p.point.lng * 1000) / 1000).toBe(p.point.lng);
      expect(p.point.lat).toBeGreaterThan(31.3);
      expect(p.point.lat).toBeLessThan(31.7);
    }
  });

  it('suggests, geocodes, resolves and reverse-geocodes deterministically (Roman Urdu and Urdu spellings)', async () => {
    const d = createGeoTestDoubles({ ttlSeconds: { AUTOCOMPLETE: 0 } });
    expect(d.placesAutocomplete.licences[0]?.maxCacheTtlSeconds).toBe(0);
    const s = await d.placesAutocomplete.suggest(input('badshahi masjid'), live());
    expect(s.map((x) => x.providerPlaceId)).toEqual(['syn-lhr-002']);
    expect((await d.placesAutocomplete.suggest(input('بادشاہی'), live())).map((x) => x.providerPlaceId)).toEqual(['syn-lhr-002']);
    expect(await d.placesAutocomplete.suggest(input('libarti'), live())).toEqual([]); // aliases are the gateway's job
    expect((await d.geocoding.geocode({ text: 'gulberg', locale: 'en', countryCode: 'PK' }, live())).length).toBeGreaterThan(1);
    const r = await d.geocoding.resolve({ providerPlaceId: 'syn-lhr-006', searchSessionId: session, locale: 'en' }, live());
    expect(r.point).toEqual({ lat: 31.522, lng: 74.404 });
    await expect(d.geocoding.resolve({ providerPlaceId: 'nope', searchSessionId: session, locale: 'en' }, live())).rejects.toMatchObject({
      kind: 'REJECTED_INPUT',
    });
    const near = await d.reverseGeocoding.reverse({ point: { lat: 31.5101, lng: 74.3411 }, locale: 'en' }, live());
    expect(near?.components.name).toBe('Liberty Market');
    expect(await d.reverseGeocoding.reverse({ point: { lat: 24.86, lng: 67.0 }, locale: 'en' }, live())).toBeNull();
    expect(d.control.calls('AUTOCOMPLETE')).toBe(3);
    expect(d.control.inputs('PLACE_RESOLVE')).toHaveLength(2);
  });

  it('routes along a straight line × 1.3 at 25 km/h (synthetic)', async () => {
    const d = createGeoTestDoubles();
    const r = await d.routing.route(
      { origin: { lat: 31.51, lng: 74.341 }, destination: { lat: 31.522, lng: 74.404 }, profile: 'CAR', departAt: new Date() },
      live(),
    );
    expect(r.distanceM).toBeGreaterThan(6000);
    expect(r.distanceM).toBeLessThan(9000);
    expect(r.durationS).toBe(Math.round(r.distanceM / (25_000 / 3600)));
    expect(r.geometry).toHaveLength(3);
    expect(straightLineRoute({ origin: { lat: 31.5, lng: 74.3 }, destination: { lat: 31.5, lng: 74.3 }, profile: 'CAR', departAt: new Date() }).distanceM).toBe(
      1,
    );
  });

  it('injects every FAULT-GEO mode, per SKU and for a limited number of calls', async () => {
    const d = createGeoTestDoubles();
    const routeInput = { origin: { lat: 31.51, lng: 74.341 }, destination: { lat: 31.522, lng: 74.404 }, profile: 'CAR' as const, departAt: new Date() };
    d.control.setFault('ROUTE', { mode: 'UPSTREAM_5XX', times: 1 });
    await expect(d.routing.route(routeInput, live())).rejects.toMatchObject({ kind: 'UPSTREAM' });
    await expect(d.routing.route(routeInput, live())).resolves.toMatchObject({ confidence: 'LOW' });
    d.control.setFault('ROUTE', { mode: 'PARTIAL' });
    expect(Number.isNaN((await d.routing.route(routeInput, live())).durationS)).toBe(true);
    d.control.setFault('ROUTE', { mode: 'MALFORMED' });
    expect((await d.routing.route(routeInput, live())).distanceM).toBeLessThan(0);
    d.control.setFault('ROUTE', { mode: 'EMPTY' });
    await expect(d.routing.route(routeInput, live())).rejects.toBeInstanceOf(GeoProviderError);

    d.control.setFault('ALL', { mode: 'CONNECT_ERROR' });
    await expect(d.placesAutocomplete.suggest(input('liberty'), live())).rejects.toMatchObject({ kind: 'CONNECT' });
    d.control.setFault('AUTOCOMPLETE', { mode: 'QUOTA', retryAfterSeconds: 42 });
    await expect(d.placesAutocomplete.suggest(input('liberty'), live())).rejects.toMatchObject({ kind: 'QUOTA', retryAfterSeconds: 42 });
    d.control.setFault('AUTOCOMPLETE', { mode: 'ECHO_QUERY' });
    await expect(d.placesAutocomplete.suggest(input('canary-text'), live())).rejects.toThrow(/canary-text/);
    d.control.setFault('AUTOCOMPLETE', { mode: 'REJECTED_INPUT' });
    await expect(d.placesAutocomplete.suggest(input('liberty'), live())).rejects.toMatchObject({ kind: 'REJECTED_INPUT' });
    d.control.setFault('AUTOCOMPLETE', { mode: 'PARTIAL' });
    expect(await d.placesAutocomplete.suggest(input('gulberg'), live())).toHaveLength(1);
    d.control.setFault('AUTOCOMPLETE', { mode: 'MALFORMED' });
    expect((await d.placesAutocomplete.suggest(input('liberty'), live()))[0]?.providerPlaceId).toBe('');
    d.control.setFault('REVERSE_GEOCODE', { mode: 'PARTIAL' });
    expect((await d.reverseGeocoding.reverse({ point: { lat: 31.51, lng: 74.341 }, locale: 'en' }, live()))?.components.area).toBeNull();
    d.control.setFault('REVERSE_GEOCODE', { mode: 'MALFORMED' });
    expect((await d.reverseGeocoding.reverse({ point: { lat: 31.51, lng: 74.341 }, locale: 'en' }, live()))?.point.lat).toBe(-95);
    d.control.setFault('GEOCODE', { mode: 'MALFORMED' });
    expect(Number.isNaN((await d.geocoding.geocode({ text: 'liberty', locale: 'en', countryCode: 'PK' }, live()))[0]?.point.lng)).toBe(true);
    d.control.setFault('GEOCODE', { mode: 'EMPTY' });
    expect(await d.geocoding.geocode({ text: 'liberty', locale: 'en', countryCode: 'PK' }, live())).toEqual([]);
    d.control.setFault('PLACE_RESOLVE', { mode: 'MALFORMED' });
    expect((await d.geocoding.resolve({ providerPlaceId: 'syn-lhr-001', searchSessionId: session, locale: 'en' }, live())).point.lat).toBe(48.85);
    d.control.setFault('REVERSE_GEOCODE', { mode: 'EMPTY' });
    expect(await d.reverseGeocoding.reverse({ point: { lat: 31.51, lng: 74.341 }, locale: 'en' }, live())).toBeNull();
    d.control.reset();
    expect(d.control.calls('AUTOCOMPLETE')).toBe(0);
  });

  it('TIMEOUT waits for the caller to abort; SLOW_DRIP completes late unless aborted', async () => {
    const d = createGeoTestDoubles();
    d.control.setFault('AUTOCOMPLETE', { mode: 'TIMEOUT' });
    await expect(d.placesAutocomplete.suggest(input('liberty'), AbortSignal.timeout(30))).rejects.toMatchObject({ name: 'AbortError' });
    d.control.setFault('AUTOCOMPLETE', { mode: 'SLOW_DRIP', delayMs: 20 });
    expect((await d.placesAutocomplete.suggest(input('liberty'), live())).length).toBeGreaterThan(0);
    d.control.setFault('AUTOCOMPLETE', { mode: 'SLOW_DRIP', delayMs: 5000 });
    await expect(d.placesAutocomplete.suggest(input('liberty'), AbortSignal.timeout(30))).rejects.toMatchObject({ name: 'AbortError' });
    const aborted = new AbortController();
    aborted.abort();
    await expect(d.placesAutocomplete.suggest(input('liberty'), aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
