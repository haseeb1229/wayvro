import { describe, expect, it } from 'vitest';
import type { BundleId } from './components.js';
import { componentsFromEnv } from './components.js';

// Synthetic, format-shaped placeholders (not credentials); no request is made by building components.
const ENV = {
  GEO_GOOGLE_API_KEY: 'synthetic-google-key-0123456789',
  GEO_GOOGLE_ROUTES_TRAFFIC_AWARE: 'true',
  GEO_MAPBOX_ACCESS_TOKEN: 'pk.synthetic-token-0123456789abcdef',
  GEO_PHOTON_URL: 'http://127.0.0.1:2322',
  GEO_NOMINATIM_URL: 'http://127.0.0.1:8088',
  GEO_OSRM_URL: 'http://127.0.0.1:5000',
  GEO_VALHALLA_URL: 'http://127.0.0.1:8002',
};

describe('componentsFromEnv', () => {
  it('enables exactly the candidates whose keys/URLs are present, with billing buckets', () => {
    const bundlesAskedFor: BundleId[] = [];
    const components = componentsFromEnv(ENV, (bundle) => {
      bundlesAskedFor.push(bundle);
      return () => Promise.reject(new Error('no network in this test'));
    });
    expect(components.map((c) => c.id)).toEqual([
      'S1-places',
      'S1-geocoding',
      'S1-reverse',
      'S1-routes',
      'S2-searchbox',
      'S2-geocoding-autocomplete',
      'S2-geocoding',
      'S2-reverse',
      'S2-directions',
      'S3-photon',
      'S3-photon-geocoding',
      'S3-photon-reverse',
      'S3-nominatim-reverse',
      'S3-osrm',
      'S3-valhalla',
    ]);
    expect(new Set(bundlesAskedFor)).toEqual(new Set(['S1', 'S2', 'S3']));
    const route = components.find((c) => c.id === 'S1-routes');
    expect(route?.kind === 'ROUTE' ? route.bucket : null).toBe('google:routes-pro');
    const searchBox = components.find((c) => c.id === 'S2-searchbox');
    expect(searchBox?.kind === 'AUTOCOMPLETE' && searchBox.mode === 'suggest-resolve' ? searchBox.sessionBilled : null).toBe(true);
    expect(
      components
        .filter((c) => c.bundle === 'S3')
        .every((c) => (c.kind === 'AUTOCOMPLETE' && c.mode === 'suggest-resolve' ? c.suggestBucket : 'bucket' in c ? c.bucket : null) === null),
    ).toBe(true);
  });

  it('builds nothing without configuration, uses Essentials routes by default and skips Photon autocomplete without Nominatim', () => {
    expect(componentsFromEnv({}, () => () => Promise.reject(new Error('unused')))).toEqual([]);
    const partial = componentsFromEnv(
      { GEO_GOOGLE_API_KEY: ENV.GEO_GOOGLE_API_KEY, GEO_PHOTON_URL: ENV.GEO_PHOTON_URL },
      () => () => Promise.reject(new Error('unused')),
    );
    expect(partial.map((c) => c.id)).toEqual(['S1-places', 'S1-geocoding', 'S1-reverse', 'S1-routes', 'S3-photon-reverse']);
    const route = partial.find((c) => c.id === 'S1-routes');
    expect(route?.kind === 'ROUTE' ? route.bucket : null).toBe('google:routes-essentials');
  });

  it('refuses public community servers', () => {
    expect(() => componentsFromEnv({ GEO_NOMINATIM_URL: 'https://nominatim.openstreetmap.org' }, () => () => Promise.reject(new Error('unused')))).toThrow(
      /public community server/,
    );
  });
});
