/**
 * Vendor-neutral geo ports (Phase 3 P3.2; E06/E07; docs/phase3/PHASE3_ARCHITECTURE.md §6; ADR-006 hybrid abstraction
 * FD-04). The API's geo gateway is the only caller; adapters live in the server-only `@wayvro/geo-adapters` package
 * (one per vendor and SKU, bound by the composition root) and deterministic MOCK-branded doubles live in the dev-only
 * `@wayvro/provider-test-doubles`. No type here is provider-specific: provider place ids never leave the server (the
 * gateway seals them into `placeRef` tokens) and results carry Wayvro provenance only.
 *
 * Contract for every adapter:
 *  - infrastructure failure (timeout, connect error, 5xx, provider quota/429, malformed payload) THROWS — the gateway
 *    counts it for the circuit breaker and refuses honestly; "no result" is an empty array or `null`, never a
 *    fabricated place, address, distance or duration;
 *  - the provider receives only Wayvro's server request (query text, coarse bias, points) — never an account id, phone
 *    number or installation id;
 *  - each adapter declares its licence terms (`licence`) so the composition can refuse incompatible bundles at boot
 *    (CON-P3-16: e.g. Google geo content only with a Google map, Mapbox geocoding only with a Mapbox map) and so caching
 *    never exceeds the terms-derived TTL.
 */

export type GeoSku = 'AUTOCOMPLETE' | 'GEOCODE' | 'REVERSE_GEOCODE' | 'PLACE_RESOLVE' | 'ROUTE';
export type GeoConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type GeoLocale = 'en' | 'ur' | 'ur-Latn';
/** Map renderer family a geo bundle is bound to (`none` = text-first UI, no renderer). */
export type GeoRendererKind = 'none' | 'google' | 'mapbox' | 'maplibre';

/** WGS84 point; callers pass at most 6 decimals (the gateway rounds further where privacy or caching requires). */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** Normalised address components (Lahore formatter input). Any field may be missing; nothing is ever invented. */
export interface AddressComponents {
  /** Place or landmark name (e.g. a market, hospital, park). */
  readonly name: string | null;
  /** Block / sector / phase (e.g. "Block H", "Phase 5"). */
  readonly block: string | null;
  /** Society / scheme / housing estate. */
  readonly society: string | null;
  /** Area / neighbourhood / town. */
  readonly area: string | null;
  readonly city: string | null;
  /** Urdu-script name only when the PROVIDER supplied it (never machine-transliterated). */
  readonly nameUrdu: string | null;
}

export type PlaceKind = 'LANDMARK' | 'ADDRESS' | 'AREA' | 'OTHER';

export interface PlaceCandidate {
  /** Provider place id: NEVER leaves the server; the gateway seals it into a placeRef. */
  readonly providerPlaceId: string;
  readonly components: AddressComponents;
  readonly kind: PlaceKind;
}

export interface ResolvedPlace {
  readonly point: GeoPoint;
  readonly components: AddressComponents;
  readonly kind: PlaceKind;
  readonly confidence: GeoConfidence;
}

export interface AutocompleteInput {
  readonly text: string;
  readonly locale: GeoLocale;
  /** Already coarsened to 2 decimals by the gateway (or null). */
  readonly biasCell: GeoPoint | null;
  readonly countryCode: 'PK';
  /** Mapped to a provider session token where the provider bills per session. */
  readonly searchSessionId: string;
}

export interface PlacesAutocompletePort {
  suggest(input: AutocompleteInput, signal: AbortSignal): Promise<readonly PlaceCandidate[]>;
}

export interface GeocodingPort {
  /** Forward geocoding of typed text ("type the full address" fallback). */
  geocode(input: { readonly text: string; readonly locale: GeoLocale; readonly countryCode: 'PK' }, signal: AbortSignal): Promise<readonly ResolvedPlace[]>;
  /** Resolves a provider place id obtained from this provider's own autocomplete. */
  resolve(
    input: { readonly providerPlaceId: string; readonly searchSessionId: string; readonly locale: GeoLocale },
    signal: AbortSignal,
  ): Promise<ResolvedPlace>;
}

export interface ReverseGeocodingPort {
  /** `null` when the provider knows no address for the point. */
  reverse(input: { readonly point: GeoPoint; readonly locale: GeoLocale }, signal: AbortSignal): Promise<ResolvedPlace | null>;
}

/** CAR only in Phase 3; TWO_WHEELER / THREE_WHEELER arrive only when such a product can be ENABLED (legal gate). */
export type RoutingProfile = 'CAR';

export interface RouteInput {
  readonly origin: GeoPoint;
  readonly destination: GeoPoint;
  readonly profile: RoutingProfile;
  /** Start of the 15-minute departure bucket (server time). */
  readonly departAt: Date;
}

export interface RouteResult {
  /** Integer metres; > 0. */
  readonly distanceM: number;
  /** Integer seconds (traffic-aware only if the SKU is); ≥ 0. A route without a duration must THROW, never default. */
  readonly durationS: number;
  readonly geometry: readonly GeoPoint[];
  readonly confidence: GeoConfidence;
}

/** No distance/ETA matrix in Phase 3 (dispatch is Phase 4). */
export interface RoutingPort {
  route(input: RouteInput, signal: AbortSignal): Promise<RouteResult>;
}

/** Licence/terms declaration of one adapter for one SKU, validated at boot (CON-P3-16, threat model T3-22). */
export interface GeoAdapterLicence {
  /** Opaque key (e.g. `geo-a`); the vendor mapping lives only in configuration and ADR-006. */
  readonly providerKey: string;
  readonly sku: GeoSku;
  /** Renderer family this content may be displayed with (`any` = terms allow any map, e.g. self-hosted open data). */
  readonly requiresRenderer: 'google' | 'mapbox' | 'any';
  /** Terms-derived maximum cache lifetime for results of this SKU; 0 = must not cache. */
  readonly maxCacheTtlSeconds: number;
  /** Whether a cached result may be served to a different account. */
  readonly cacheSharedAcrossUsers: boolean;
  /** Whether route geometry may be stored for the quote retention period (pricing.route_snapshots.polyline). */
  readonly geometryStorable: boolean;
  /** Attribution the client must display (e.g. `OSM_ODBL`), or null. */
  readonly attributionCode: string | null;
  /** Estimated price per call for budget accounting (micro-USD); verified against the vendor price page at the freeze. */
  readonly microUsdPerCall: number;
}

/** Every geo adapter (and geo test double) exposes its licence declarations next to the port methods. */
export interface GeoAdapter {
  readonly licences: readonly GeoAdapterLicence[];
}

export type PlacesAutocompleteAdapter = PlacesAutocompletePort & GeoAdapter;
export type GeocodingAdapter = GeocodingPort & GeoAdapter;
export type ReverseGeocodingAdapter = ReverseGeocodingPort & GeoAdapter;
export type RoutingAdapter = RoutingPort & GeoAdapter;
