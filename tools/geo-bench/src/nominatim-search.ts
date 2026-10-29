/**
 * DESK-ONLY fallback: forward search against a SELF-HOSTED Nominatim `/search` (jsonv2), used by the open-stack desk
 * benchmark only when Photon (the S3 autocomplete/forward candidate) is not available. It is NOT an autocomplete
 * engine and NOT a candidate adapter: `packages/geo-adapters` has no Nominatim forward adapter (Photon covers that SKU),
 * so results from this port are labelled `S3-nominatim-search*` and never stand in for Photon in any score. The URL
 * goes through the same self-hosted-only validation as every S3 adapter (`parseBaseUrl`: public servers refused).
 * Failures throw the adapters' typed `GeoAdapterError` so the harness records them exactly like adapter failures.
 */
import { type FetchLike, GeoAdapterError, PAKISTAN_BBOX, inPakistan, parseBaseUrl } from '@wayvro/geo-adapters';
import type { GeoLocale, GeocodingPort, ResolvedPlace } from '@wayvro/provider-interfaces';
import { z } from 'zod';

const PROVIDER_KEY = 'geo-bench-s3-nominatim-search';
const placeSchema = z.object({
  lat: z.string().max(32),
  lon: z.string().max(32),
  name: z.string().max(400).optional(),
  address: z.record(z.string().max(80), z.string().max(400)).optional(),
});
const listSchema = z.array(placeSchema).max(10);

function fail(
  code: 'TIMEOUT' | 'ABORTED' | 'NETWORK' | 'SERVER_ERROR' | 'CLIENT_ERROR' | 'MALFORMED_RESPONSE' | 'INVALID_INPUT',
  status: number | null = null,
): never {
  throw new GeoAdapterError(PROVIDER_KEY, 'GEOCODE', code, status);
}

/** @internal exported for unit tests */
export function toResolved(place: z.infer<typeof placeSchema>): ResolvedPlace | null {
  const lat = Number(place.lat);
  const lng = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inPakistan({ lat, lng })) return null;
  const a = place.address ?? {};
  const pick = (...keys: string[]) => keys.map((k) => a[k]).find((v) => v !== undefined && v !== '') ?? null;
  return {
    point: { lat, lng },
    components: {
      name: place.name !== undefined && place.name !== '' ? place.name : null,
      block: null,
      society: null,
      area: pick('neighbourhood', 'residential', 'quarter', 'suburb', 'city_district'),
      city: pick('city', 'town', 'village'),
      nameUrdu: null,
    },
    kind: 'OTHER',
    confidence: 'UNKNOWN',
  };
}

export function nominatimSearchPort(baseUrl: string, fetchImpl: FetchLike): GeocodingPort {
  const base = parseBaseUrl('GEO_NOMINATIM_URL', baseUrl);
  return {
    async geocode(input: { readonly text: string; readonly locale: GeoLocale; readonly countryCode: 'PK' }, signal: AbortSignal) {
      if (input.text.trim() === '') fail('INVALID_INPUT');
      const url = new URL('search', base);
      url.searchParams.set('q', input.text);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', '5');
      url.searchParams.set('countrycodes', 'pk');
      url.searchParams.set('viewbox', `${PAKISTAN_BBOX.minLng},${PAKISTAN_BBOX.maxLat},${PAKISTAN_BBOX.maxLng},${PAKISTAN_BBOX.minLat}`);
      url.searchParams.set('accept-language', input.locale === 'ur' ? 'ur' : 'en');
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), { method: 'GET', signal });
      } catch (error) {
        if (signal.aborted) fail(signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED');
        throw new GeoAdapterError(PROVIDER_KEY, 'GEOCODE', 'NETWORK', null, { cause: error });
      }
      if (response.status >= 500) fail('SERVER_ERROR', response.status);
      if (response.status !== 200) fail('CLIENT_ERROR', response.status);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        fail('MALFORMED_RESPONSE', response.status);
      }
      const parsed = listSchema.safeParse(body);
      if (!parsed.success) fail('MALFORMED_RESPONSE', response.status);
      return parsed.data.map(toResolved).filter((p): p is ResolvedPlace => p !== null);
    },
    resolve(): Promise<ResolvedPlace> {
      // Search results carry their points: there is nothing to resolve (the harness uses geocode-points mode).
      return Promise.reject(new GeoAdapterError(PROVIDER_KEY, 'PLACE_RESOLVE', 'INVALID_INPUT'));
    },
  };
}
