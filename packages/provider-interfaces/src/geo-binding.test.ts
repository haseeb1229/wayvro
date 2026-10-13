import { describe, expect, it } from 'vitest';
import {
  GeoProviderError,
  ProviderBindingError,
  assertGeoBundle,
  bindProviders,
  type GeoAdapterLicence,
  type GeoRendererKind,
  type GeocodingAdapter,
  type PlacesAutocompleteAdapter,
  type RoutingAdapter,
} from './index.js';

const licence = (over: Partial<GeoAdapterLicence> & Pick<GeoAdapterLicence, 'sku'>): GeoAdapterLicence => ({
  providerKey: 'geo-a',
  requiresRenderer: 'any',
  maxCacheTtlSeconds: 0,
  cacheSharedAcrossUsers: false,
  geometryStorable: false,
  attributionCode: null,
  microUsdPerCall: 0,
  ...over,
});

const autocomplete = (licences: readonly GeoAdapterLicence[]): PlacesAutocompleteAdapter => ({ licences, suggest: () => Promise.resolve([]) });
const geocoding = (licences: readonly GeoAdapterLicence[]): GeocodingAdapter => ({
  licences,
  geocode: () => Promise.resolve([]),
  resolve: () => Promise.reject(new GeoProviderError('UPSTREAM')),
});
const routing = (licences: readonly GeoAdapterLicence[]): RoutingAdapter => ({ licences, route: () => Promise.reject(new GeoProviderError('UPSTREAM')) });

describe('assertGeoBundle (CON-P3-16 / CONFIG-BUNDLE)', () => {
  it('accepts open-licensed (`any`) adapters with every renderer, including the text-first `none`', () => {
    for (const kind of ['none', 'google', 'mapbox', 'maplibre'] as const) {
      const registry = bindProviders('production', {
        placesAutocomplete: autocomplete([licence({ sku: 'AUTOCOMPLETE', attributionCode: 'OSM_ODBL' })]),
        geocoding: geocoding([licence({ sku: 'GEOCODE', maxCacheTtlSeconds: 3600 }), licence({ sku: 'PLACE_RESOLVE' })]),
      });
      const bundle = assertGeoBundle(kind, registry);
      expect(bundle.boundSkus).toEqual(['AUTOCOMPLETE', 'GEOCODE', 'PLACE_RESOLVE']);
      expect(bundle.licence('GEOCODE')?.maxCacheTtlSeconds).toBe(3600);
      expect(bundle.licence('ROUTE')).toBeUndefined();
    }
  });

  it('refuses Google/Mapbox content under any other renderer, and under the text-first `none` (pricing-only use included)', () => {
    const cases: Array<[GeoAdapterLicence['requiresRenderer'], GeoRendererKind, boolean]> = [
      ['google', 'google', true],
      ['google', 'none', false],
      ['google', 'maplibre', false],
      ['google', 'mapbox', false],
      ['mapbox', 'mapbox', true],
      ['mapbox', 'none', false],
      ['mapbox', 'google', false],
    ];
    for (const [requires, renderer, ok] of cases) {
      const registry = bindProviders('production', { routing: routing([licence({ sku: 'ROUTE', requiresRenderer: requires })]) });
      if (ok) expect(assertGeoBundle(renderer, registry).boundSkus).toEqual(['ROUTE']);
      else expect(() => assertGeoBundle(renderer, registry)).toThrow(/licence coupling/);
    }
  });

  it('refuses malformed declarations (negative or fractional TTL or price, invalid provider id or attribution, wrong, duplicate or missing SKU)', () => {
    const bad: Array<[string, () => unknown]> = [
      ['ttl', () => assertGeoBundle('none', bindProviders('test', { routing: routing([licence({ sku: 'ROUTE', maxCacheTtlSeconds: -1 })]) }))],
      ['ttl-frac', () => assertGeoBundle('none', bindProviders('test', { routing: routing([licence({ sku: 'ROUTE', maxCacheTtlSeconds: 1.5 })]) }))],
      ['price', () => assertGeoBundle('none', bindProviders('test', { routing: routing([licence({ sku: 'ROUTE', microUsdPerCall: -5 })]) }))],
      ['key', () => assertGeoBundle('none', bindProviders('test', { routing: routing([licence({ sku: 'ROUTE', providerKey: 'Google' })]) }))],
      ['attr', () => assertGeoBundle('none', bindProviders('test', { routing: routing([licence({ sku: 'ROUTE', attributionCode: '<b>' })]) }))],
      ['sku', () => assertGeoBundle('none', bindProviders('test', { routing: routing([licence({ sku: 'GEOCODE' })]) }))],
      ['dup', () => assertGeoBundle('none', bindProviders('test', { routing: routing([licence({ sku: 'ROUTE' }), licence({ sku: 'ROUTE' })]) }))],
      ['missing', () => assertGeoBundle('none', bindProviders('test', { geocoding: geocoding([licence({ sku: 'GEOCODE' })]) }))],
    ];
    for (const [name, fn] of bad) expect(fn, name).toThrow(ProviderBindingError);
  });

  it('an empty registry is a valid bundle with no geo SKU (every geo route then answers 503)', () => {
    expect(assertGeoBundle('none', bindProviders('production', {})).boundSkus).toEqual([]);
  });

  it('GeoProviderError carries a kind and a provider-neutral message', () => {
    const e = new GeoProviderError('QUOTA', 30);
    expect(e.kind).toBe('QUOTA');
    expect(e.retryAfterSeconds).toBe(30);
    expect(e.message).toBe('geo provider failure: QUOTA');
  });
});
