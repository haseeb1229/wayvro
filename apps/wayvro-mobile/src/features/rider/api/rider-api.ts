import {
  AutocompleteResultSchema,
  QuoteGroupSchema,
  ResolvedPlaceSchema,
  ReverseGeocodeResultSchema,
  type AutocompleteResult,
  type Locale,
  type QuoteGroup,
  type ResolvedPlace,
  type ReverseGeocodeResult,
} from '@wayvro/contracts';
import type { ApiSpec } from '../../../core/api/wayvro-client';

/**
 * Rider geo and quote endpoints (P3.5; B01/B02/B03/B04/B06) on the shared authenticated transport: bearer,
 * single-flight refresh, contract validation of every response, version headers and the Lite timing observer all come
 * from the core client. The app never sends a fare, total, distance or duration — the quote request is a strict object
 * and the server prices everything. Search text and coordinates travel only to the Wayvro API.
 */
export interface SessionTransport {
  read<T>(spec: ApiSpec<T>): Promise<T>;
  mutate<T>(intent: string, spec: ApiSpec<T>): Promise<T>;
}

/** Lahore is the only Phase-3 city (FA-11). */
const RIDER_CITY = 'LHR';

export interface AutocompleteArgs {
  readonly q: string;
  readonly locale: Locale;
  /** One uuid per search field (provider session billing). */
  readonly session: string;
  /** Search bias, already rounded to 2 decimals on the device; omitted without a fix. */
  readonly bias: { readonly lat: number; readonly lng: number } | null;
  readonly mode: 'SUGGEST' | 'GEOCODE';
  readonly signal: AbortSignal;
}

export interface QuotePoint {
  readonly lat: number;
  readonly lng: number;
  readonly placeRef?: string;
}

const seg = encodeURIComponent;

export function createRiderApi(t: SessionTransport) {
  return {
    autocomplete: (args: AutocompleteArgs): Promise<AutocompleteResult> =>
      t.read({
        method: 'GET',
        path: '/v1/geo/autocomplete',
        query: {
          cityCode: RIDER_CITY,
          q: args.q,
          locale: args.locale,
          session: args.session,
          ...(args.bias === null ? {} : { biasLat: String(args.bias.lat), biasLng: String(args.bias.lng) }),
          ...(args.mode === 'GEOCODE' ? { mode: 'GEOCODE' } : {}),
        },
        signal: args.signal,
        schema: AutocompleteResultSchema,
      }),

    resolvePlace: (placeRef: string, session: string, locale: Locale): Promise<ResolvedPlace> =>
      t.read({ method: 'GET', path: `/v1/geo/places/${seg(placeRef)}`, query: { session, locale }, schema: ResolvedPlaceSchema }),

    /** `point` is already at 5 decimals; the server rounds further before any provider call or cache key. */
    reverse: (point: { readonly lat: number; readonly lng: number }, locale: Locale): Promise<ReverseGeocodeResult> =>
      t.read({
        method: 'GET',
        path: '/v1/geo/reverse',
        query: { cityCode: RIDER_CITY, lat: String(point.lat), lng: String(point.lng), locale },
        schema: ReverseGeocodeResultSchema,
      }),

    /**
     * One price check. `attempt` names the user action: a retry of an unknown outcome reuses its idempotency key, and
     * "Get new price" starts a NEW attempt (new key) — an expired quote is never silently replaced.
     */
    createQuote: (attempt: string, pickup: QuotePoint, dropoff: QuotePoint, detail: 'lite' | 'full'): Promise<QuoteGroup> =>
      t.mutate(`quote:${attempt}`, {
        method: 'POST',
        path: '/v1/quotes',
        query: { detail },
        body: { cityCode: RIDER_CITY, pickup, dropoff },
        schema: QuoteGroupSchema,
      }),

    quoteGroup: (quoteGroupId: string, detail: 'lite' | 'full'): Promise<QuoteGroup> =>
      t.read({ method: 'GET', path: `/v1/quotes/${seg(quoteGroupId)}`, query: { detail }, schema: QuoteGroupSchema }),
  };
}

export type RiderApi = ReturnType<typeof createRiderApi>;
