/**
 * Phase 3 geo contracts (P3.2; B01/B02/E06/E07/I11; docs/phase3/PHASE3_ARCHITECTURE.md §5–§8). All geo reads need a
 * consumer session (no pre-sign-in geo access), are rate-limited and budgeted server-side and carry Wayvro-normalised
 * provenance (`GeoSource`) — never a vendor name, a provider place id or any provider-specific field. Provider ids are
 * sealed into opaque, account-bound, expiring `placeRef` tokens. A provider failure is refused honestly
 * (503 `WAYVRO_E_DEPENDENCY_UNAVAILABLE` with reason codes); no address, place or coordinate is ever invented.
 *
 * Search text and coordinates travel in the query string of these GET routes: the API logs route templates only, OTel
 * drops `url.query` for `/v1/geo/*`, and deployment access logs must omit query strings for `/v1/geo/*` (ARCH-01).
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';
import { LocaleSchema } from './identity.js';

const E = ErrorEnvelopeSchema;
const IsoDateTime = z.iso.datetime({ offset: true });
const CityCode = z.string().regex(/^[A-Z]{3}$/);

export const GEO_SKUS = ['AUTOCOMPLETE', 'GEOCODE', 'REVERSE_GEOCODE', 'PLACE_RESOLVE', 'ROUTE'] as const;
export const GeoSkuSchema = z.enum(GEO_SKUS);
export const GEO_CONFIDENCE_VALUES = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export const GeoConfidenceSchema = z.enum(GEO_CONFIDENCE_VALUES);
/** Opaque provider key (e.g. `geo-a`); the mapping to a vendor exists only in server configuration / ADR-006. */
export const ProviderKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);

/** Wayvro-normalised provenance of a geo result (B03: the client shows confidence and required attribution). */
export const GeoSourceSchema = z
  .object({
    providerKey: ProviderKeySchema,
    /** Server time of the provider call (or of the cached call). */
    fetchedAt: IsoDateTime,
    cacheStatus: z.enum(['HIT', 'MISS', 'STALE_SERVED']),
    confidence: GeoConfidenceSchema,
    /** Licence attribution the client must display, as a code (e.g. `OSM_ODBL`); null = none required. */
    attributionCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,40}$/)
      .nullable(),
    /** e.g. `PARTIAL_COVERAGE`, `LOW_DENSITY_AREA`; null = none. */
    coverageNote: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,40}$/)
      .nullable(),
  })
  .meta({ id: 'GeoSource' });
export type GeoSource = z.infer<typeof GeoSourceSchema>;

/** Sealed, account-bound, expiring reference to a provider place (never a raw provider id). */
export const PlaceRefSchema = z.string().regex(/^pr1\.[A-Za-z0-9_-]{40,512}$/);

/** WGS84 point as sent by clients; the server normalises to 6 decimals and refuses points outside Pakistan (400). */
export const LatLngSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

const Lat = z.coerce.number().min(-90).max(90);
const Lng = z.coerce.number().min(-180).max(180);
/** Per search field; maps to a provider session token where the provider bills per session. */
const SearchSessionId = z.uuid();
const PlaceKind = z.enum(['LANDMARK', 'ADDRESS', 'AREA', 'OTHER']);
const DisplayText = z.string().min(1).max(200);

export const AutocompleteQuerySchema = z.strictObject({
  cityCode: CityCode,
  q: z.string().trim().min(3).max(80),
  locale: LocaleSchema,
  session: SearchSessionId,
  /** Optional bias; the server coarsens it to 2 decimals (~1.1 km cell) before any provider call or cache key. */
  biasLat: Lat.optional(),
  biasLng: Lng.optional(),
  /** `GEOCODE`: "type the full address" forward geocoding when suggestions are degraded (separate SKU meter). */
  mode: z.enum(['SUGGEST', 'GEOCODE']).optional(),
});
export type AutocompleteQuery = z.infer<typeof AutocompleteQuerySchema>;

export const AutocompleteResultSchema = z
  .object({
    suggestions: z.array(z.object({ placeRef: PlaceRefSchema, primaryText: DisplayText, secondaryText: DisplayText.nullable(), kind: PlaceKind })).max(5),
    source: GeoSourceSchema,
  })
  .meta({ id: 'AutocompleteResult' });
export type AutocompleteResult = z.infer<typeof AutocompleteResultSchema>;

export const PlaceRefParamSchema = z.strictObject({ placeRef: PlaceRefSchema });
export const PlaceQuerySchema = z.strictObject({ session: SearchSessionId, locale: LocaleSchema });

export const ResolvedPlaceSchema = z
  .object({
    point: z.object({ lat: z.number(), lng: z.number() }),
    primaryText: DisplayText,
    secondaryText: DisplayText.nullable(),
    /** Only when district geometry exists (none in Phase 3: synthetic boundaries only, FA-12). */
    districtCode: z.string().nullable(),
    /** Server-side check against the city's ACTIVE zone set (information only; quotes re-check). */
    inServiceArea: z.boolean(),
    source: GeoSourceSchema,
  })
  .meta({ id: 'ResolvedPlace' });
export type ResolvedPlace = z.infer<typeof ResolvedPlaceSchema>;

export const ReverseGeocodeQuerySchema = z.strictObject({ cityCode: CityCode, lat: Lat, lng: Lng, locale: LocaleSchema });

export const ReverseGeocodeResultSchema = z
  .object({
    /** null when the provider knows no address here — the client shows "Pinned location"; never an invented label. */
    address: z
      .object({
        primaryText: DisplayText,
        secondaryText: DisplayText.nullable(),
        landmarkText: DisplayText.nullable(),
      })
      .nullable(),
    inServiceArea: z.boolean(),
    source: GeoSourceSchema,
  })
  .meta({ id: 'ReverseGeocodeResult' });
export type ReverseGeocodeResult = z.infer<typeof ReverseGeocodeResultSchema>;

export const GEO_ROUTES = [
  {
    operationId: 'geoAutocomplete',
    method: 'GET',
    path: '/v1/geo/autocomplete',
    summary: 'Place suggestions (max 5) for a search field; `mode=GEOCODE` forward-geocodes typed text. Session, rate limits and budgets apply.',
    auth: 'session',
    query: AutocompleteQuerySchema,
    responses: { 200: AutocompleteResultSchema, 400: E, 401: E, 403: E, 404: E, 426: E, 429: E, 503: E },
  },
  {
    operationId: 'geoResolvePlace',
    method: 'GET',
    path: '/v1/geo/places/{placeRef}',
    summary: 'Resolve a sealed placeRef of the calling account to a point and display text (invalid/foreign/expired refs answer 400).',
    auth: 'session',
    params: PlaceRefParamSchema,
    query: PlaceQuerySchema,
    responses: { 200: ResolvedPlaceSchema, 400: E, 401: E, 403: E, 404: E, 426: E, 429: E, 503: E },
  },
  {
    operationId: 'geoReverse',
    method: 'GET',
    path: '/v1/geo/reverse',
    summary: 'Address for a pinned point (server rounds to 4 decimals before any provider call or cache key).',
    auth: 'session',
    query: ReverseGeocodeQuerySchema,
    responses: { 200: ReverseGeocodeResultSchema, 400: E, 401: E, 403: E, 404: E, 426: E, 429: E, 503: E },
  },
] as const satisfies readonly RouteContract[];
