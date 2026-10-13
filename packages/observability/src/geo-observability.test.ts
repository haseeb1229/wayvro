/** Phase 3 P3.2 geo additions: redaction keys/values (T3-28) and telemetry URL scrubbing + allowlisted span attributes. */
import { api } from '@opentelemetry/sdk-node';
import { describe, expect, it } from 'vitest';
import { REDACTED, geoSpanAttributes, isSensitiveKey, recordGeoSpan, redact, redactString, scrubSpanUrlAttributes, scrubbingExporter } from './index.js';

describe('geo redaction (Phase 3)', () => {
  it.each([
    ['polyline', true],
    ['routePolyline', true],
    ['placeRef', true],
    ['place_ref', true],
    ['placeref', true],
    ['searchText', true],
    ['search_query', true],
    ['pickup', true],
    ['dropoff', true],
    ['pickupPoint', true],
    ['bbox', true],
    ['routeGeometry', true],
    ['providerKey', false],
    ['sku', false],
    ['cacheStatus', false],
    ['outcome', false],
  ])('isSensitiveKey(%s) === %s', (key, expected) => {
    expect(isSensitiveKey(key)).toBe(expected);
  });

  it('scrubs sealed placeRef tokens and coordinate pairs from free text', () => {
    const token = `pr1.${'Ab_-'.repeat(20)}`;
    const s = redactString(`resolve ${token} near 31.5204123, 74.3587456`);
    expect(s).not.toContain(token);
    expect(s).toContain('[REDACTED_PLACE_REF]');
    expect(s).not.toContain('31.5204123');
  });

  it('redacts geo payload keys at any depth', () => {
    const out = redact({ route: { polyline: 'abc', distanceM: 1200 }, pickup: { lat: 31.5, lng: 74.3 }, searchText: 'home' }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(out['route']?.['polyline']).toBe(REDACTED);
    expect(out['route']?.['distanceM']).toBe(1200);
    expect(out['pickup']).toBe(REDACTED);
    expect(out['searchText']).toBe(REDACTED);
  });
});

describe('telemetry URL scrubbing (ARCH-01)', () => {
  it('drops URL attributes of /v1/geo/* server spans and of every CLIENT span; leaves other spans intact', () => {
    const geo: Record<string, unknown> = { 'http.route': '/v1/geo/autocomplete', 'url.full': 'https://api/v1/geo/autocomplete?q=home', 'url.query': 'q=home' };
    expect(scrubSpanUrlAttributes(api.SpanKind.SERVER, geo)).toEqual(['url.full', 'url.query']);
    expect(geo).toEqual({ 'http.route': '/v1/geo/autocomplete' });
    const legacy: Record<string, unknown> = { 'http.target': '/v1/geo/reverse?lat=31.5&lng=74.3', 'http.url': 'http://x/v1/geo/reverse?lat=31.5' };
    scrubSpanUrlAttributes(api.SpanKind.SERVER, legacy);
    expect(legacy).toEqual({});
    const client: Record<string, unknown> = { 'url.full': 'https://maps.example/geocode?key=K&address=home', 'server.address': 'maps.example' };
    expect(scrubSpanUrlAttributes(api.SpanKind.CLIENT, client)).toEqual(['url.full']);
    expect(client).toEqual({ 'server.address': 'maps.example' });
    const other: Record<string, unknown> = { 'http.route': '/v1/account/state', 'url.query': 'x=1' };
    expect(scrubSpanUrlAttributes(api.SpanKind.SERVER, other)).toEqual([]);
    expect(other['url.query']).toBe('x=1');
  });

  it('the wrapping exporter scrubs before delegating', async () => {
    const exported: unknown[] = [];
    let shutDown = false;
    const inner = {
      export(spans: unknown[], cb: (r: { code: number }) => void) {
        exported.push(...spans);
        cb({ code: 0 });
      },
      shutdown: () => {
        shutDown = true;
        return Promise.resolve();
      },
    };
    const wrapped = scrubbingExporter(inner);
    const span = { kind: api.SpanKind.SERVER, attributes: { 'http.route': '/v1/geo/places/:placeRef', 'url.full': 'https://api/v1/geo/places/pr1.x' } };
    let result: unknown;
    wrapped.export([span] as unknown as Parameters<typeof wrapped.export>[0], (r) => {
      result = r;
    });
    expect(result).toEqual({ code: 0 });
    expect(exported).toEqual([{ kind: api.SpanKind.SERVER, attributes: { 'http.route': '/v1/geo/places/:placeRef' } }]);
    await wrapped.forceFlush?.();
    await wrapped.shutdown();
    expect(shutDown).toBe(true);
  });
});

describe('geo gateway span attributes', () => {
  it('carry only provider key, SKU, cache status, outcome and latency — shape-checked', () => {
    expect(geoSpanAttributes({ providerKey: 'geo-a', sku: 'AUTOCOMPLETE', cacheStatus: 'MISS', outcome: 'OK', latencyMs: 12.6 })).toEqual({
      'geo.sku': 'AUTOCOMPLETE',
      'geo.provider_key': 'geo-a',
      'geo.cache_status': 'MISS',
      'geo.outcome': 'OK',
      'geo.latency_ms': 13,
    });
    // a caller can never smuggle text through these fields
    expect(geoSpanAttributes({ providerKey: 'home street 5', sku: 'q=home', cacheStatus: 'NONE', outcome: '31.5204,74.3587', latencyMs: Number.NaN })).toEqual({
      'geo.sku': 'INVALID',
      'geo.provider_key': 'none',
      'geo.cache_status': 'NONE',
      'geo.outcome': 'INVALID',
      'geo.latency_ms': -1,
    });
  });

  it('recording a span without a registered SDK is a safe no-op', () => {
    expect(() => {
      recordGeoSpan(Date.now(), { providerKey: null, sku: 'ROUTE', cacheStatus: 'NONE', outcome: 'BREAKER_OPEN', latencyMs: 0 });
    }).not.toThrow();
  });
});
