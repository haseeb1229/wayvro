import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { SecretValue, assertProviderKey, parseBaseUrl, readGoogleGeoConfig, readMapboxGeoConfig, readOpenStackGeoConfig } from './config.js';
import { GeoAdapterConfigError } from './errors.js';

// Synthetic, format-shaped placeholders (not real credentials).
const GOOGLE_KEY = 'synthetic-google-key-0123456789';
const MAPBOX_TOKEN = 'pk.synthetic-token-0123456789abcdef';

describe('SecretValue', () => {
  it('never renders its value', () => {
    const secret = new SecretValue('top-secret-value');
    expect(String(secret)).toBe('[REDACTED]');
    expect(`value=${String(secret)}`).toBe('value=[REDACTED]');
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
    expect(inspect({ secret })).not.toContain('top-secret-value');
    expect(secret.reveal()).toBe('top-secret-value');
  });
});

describe('readGoogleGeoConfig', () => {
  it('is null without a key (S1 not configured)', () => {
    expect(readGoogleGeoConfig({})).toBeNull();
    expect(readGoogleGeoConfig({ GEO_GOOGLE_API_KEY: '   ' })).toBeNull();
  });

  it('reads the key and the traffic flag', () => {
    const config = readGoogleGeoConfig({ GEO_GOOGLE_API_KEY: GOOGLE_KEY, GEO_GOOGLE_ROUTES_TRAFFIC_AWARE: 'true' });
    expect(config?.apiKey.reveal()).toBe(GOOGLE_KEY);
    expect(config?.routesTrafficAware).toBe(true);
    expect(readGoogleGeoConfig({ GEO_GOOGLE_API_KEY: GOOGLE_KEY })?.routesTrafficAware).toBe(false);
  });

  it('refuses malformed values without echoing them', () => {
    expect(() => readGoogleGeoConfig({ GEO_GOOGLE_API_KEY: 'bad key with spaces' })).toThrow(/GEO_GOOGLE_API_KEY has an invalid format$/);
    expect(() => readGoogleGeoConfig({ GEO_GOOGLE_API_KEY: GOOGLE_KEY, GEO_GOOGLE_ROUTES_TRAFFIC_AWARE: 'yes' })).toThrow(GeoAdapterConfigError);
  });
});

describe('readMapboxGeoConfig', () => {
  it('is null without a token and validates the token format', () => {
    expect(readMapboxGeoConfig({})).toBeNull();
    expect(readMapboxGeoConfig({ GEO_MAPBOX_ACCESS_TOKEN: MAPBOX_TOKEN })?.accessToken.reveal()).toBe(MAPBOX_TOKEN);
    let message = '';
    try {
      readMapboxGeoConfig({ GEO_MAPBOX_ACCESS_TOKEN: 'tk.not-a-mapbox-token-format' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('GEO_MAPBOX_ACCESS_TOKEN has an invalid format');
  });
});

describe('readOpenStackGeoConfig / parseBaseUrl', () => {
  it('returns null components when unset and normalises a trailing slash', () => {
    expect(readOpenStackGeoConfig({})).toEqual({ photonUrl: null, nominatimUrl: null, osrmUrl: null, valhallaUrl: null });
    const config = readOpenStackGeoConfig({ GEO_PHOTON_URL: 'http://127.0.0.1:2322', GEO_OSRM_URL: 'https://osrm.example.org/base' });
    expect(config.photonUrl?.toString()).toBe('http://127.0.0.1:2322/');
    expect(config.osrmUrl?.toString()).toBe('https://osrm.example.org/base/');
  });

  it.each(['http://localhost:8080', 'http://[::1]:8080', 'http://10.0.0.5', 'http://172.20.1.1', 'http://192.168.1.10', 'https://geo.example.org'])(
    'accepts %s',
    (value) => {
      expect(parseBaseUrl('GEO_X', value)).toBeInstanceOf(URL);
    },
  );

  it.each([
    ['http://geo.example.org', /must use https/],
    ['http://172.32.0.1', /must use https/],
    ['ftp://10.0.0.1', /must use https/],
    ['https://user:pw@geo.example.org', /credentials/],
    ['https://geo.example.org/?key=1', /query or fragment/],
    ['https://nominatim.openstreetmap.org', /public community server/],
    ['https://photon.komoot.io', /public community server/],
    ['https://router.project-osrm.org', /public community server/],
    ['not a url', /not a valid URL/],
  ])('refuses %s', (value, message) => {
    expect(() => parseBaseUrl('GEO_X', value)).toThrow(message);
  });
});

describe('assertProviderKey', () => {
  it('accepts opaque keys only', () => {
    expect(assertProviderKey('geo-a')).toBe('geo-a');
    expect(() => assertProviderKey('Google Maps')).toThrow(GeoAdapterConfigError);
  });
});
