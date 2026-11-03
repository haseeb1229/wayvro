import { GeoAdapterError } from '@wayvro/geo-adapters';
import { describe, expect, it } from 'vitest';
import { componentsFromEnv } from './components.js';
import { nominatimSearchPort, toResolved } from './nominatim-search.js';

const signal = () => AbortSignal.timeout(2000);
const input = { text: 'Synthetic Market', locale: 'en' as const, countryCode: 'PK' as const };
const ok =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('nominatimSearchPort (desk-only fallback)', () => {
  it('maps jsonv2 results, drops points outside Pakistan and sends a self-hosted /search request', async () => {
    const urls: string[] = [];
    const port = nominatimSearchPort('http://127.0.0.1:8088', (url) => {
      urls.push(url);
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { lat: '31.5', lon: '74.3', name: 'Synthetic Market', address: { suburb: 'Synthetic Area', city: 'Lahore' } },
            { lat: '51.5', lon: '-0.1', name: 'Elsewhere' },
          ]),
        ),
      );
    });
    const places = await port.geocode(input, signal());
    expect(places).toEqual([
      {
        point: { lat: 31.5, lng: 74.3 },
        components: { name: 'Synthetic Market', block: null, society: null, area: 'Synthetic Area', city: 'Lahore', nameUrdu: null },
        kind: 'OTHER',
        confidence: 'UNKNOWN',
      },
    ]);
    const url = new URL(urls[0] ?? '');
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('countrycodes')).toBe('pk');
    expect(toResolved({ lat: 'x', lon: '74.3' })).toBeNull();
  });

  it('refuses public servers and throws typed adapter errors for every failure', async () => {
    expect(() => nominatimSearchPort('https://nominatim.openstreetmap.org', ok([]))).toThrow(/public community server/);
    const code = async (port: ReturnType<typeof nominatimSearchPort>, text = input.text) =>
      port.geocode({ ...input, text }, signal()).then(
        () => 'resolved',
        (e: unknown) => (e instanceof GeoAdapterError ? e.code : 'other'),
      );
    const base = 'http://127.0.0.1:8088';
    expect(await code(nominatimSearchPort(base, ok([], 503)))).toBe('SERVER_ERROR');
    expect(await code(nominatimSearchPort(base, ok([], 400)))).toBe('CLIENT_ERROR');
    expect(await code(nominatimSearchPort(base, ok({ not: 'a list' })))).toBe('MALFORMED_RESPONSE');
    expect(await code(nominatimSearchPort(base, () => Promise.resolve(new Response('not json'))))).toBe('MALFORMED_RESPONSE');
    expect(await code(nominatimSearchPort(base, () => Promise.reject(new TypeError('fetch failed'))))).toBe('NETWORK');
    expect(await code(nominatimSearchPort(base, ok([])), '  ')).toBe('INVALID_INPUT');
    const aborted = new AbortController();
    aborted.abort();
    const port = nominatimSearchPort(base, () => Promise.reject(new DOMException('aborted', 'AbortError')));
    expect(await port.geocode(input, aborted.signal).catch((e: unknown) => (e instanceof GeoAdapterError ? e.code : 'other'))).toBe('ABORTED');
    await expect(port.resolve({ providerPlaceId: 'x', searchSessionId: 's', locale: 'en' }, signal())).rejects.toBeInstanceOf(GeoAdapterError);
  });

  it('is wired only on explicit desk opt-in next to Nominatim reverse', () => {
    const fetchFor = () => ok([]);
    const plain = componentsFromEnv({ GEO_NOMINATIM_URL: 'http://127.0.0.1:8088' }, fetchFor).map((c) => c.id);
    expect(plain).toEqual(['S3-nominatim-reverse']);
    const desk = componentsFromEnv({ GEO_NOMINATIM_URL: 'http://127.0.0.1:8088', GEO_BENCH_NOMINATIM_SEARCH: 'desk' }, fetchFor).map((c) => c.id);
    expect(desk).toEqual(['S3-nominatim-reverse', 'S3-nominatim-search-prefix', 'S3-nominatim-search']);
  });
});
