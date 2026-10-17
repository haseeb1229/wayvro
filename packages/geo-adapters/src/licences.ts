/**
 * Licence/terms declarations and planning-time price table (CON-P3-16, threat model T3-22,
 * docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md §6/§7/§8).
 *
 * Every TTL is a terms-derived MAXIMUM; the gateway applies min(declared, configured maximum). Where terms forbid
 * caching or are unknown (NF), the TTL is 0. `geometryStorable` is false for Google and Mapbox until counsel/terms say
 * otherwise (evaluation §8). All prices are ESTIMATES from the vendor price pages as read on 2026-10-12 for planning
 * (first list tier, USD); they are used only for usage metering/budgets and are re-verified at the SP-04 freeze (P3.7).
 */
import type { GeoAdapterLicence, GeoSku } from '@wayvro/provider-interfaces';

export const PRICE_TABLE_DATE = '2026-10-12';

const DAY = 86_400;

/** ESTIMATE micro-USD per call (planning-time list prices, first tier, read 2026-10-12; re-verify at P3.7). */
export const MICRO_USD_PER_CALL = {
  /** Google Autocomplete Requests USD 2.83/1,000. Worst case: every request billed (abandoned session). ESTIMATE. */
  googleAutocompleteRequest: 2_830,
  /** Google Place Details Essentials USD 5/1,000 (closes the autocomplete session). ESTIMATE. */
  googlePlaceDetailsEssentials: 5_000,
  /** Google Geocoding USD 5/1,000 (reverse assumed to bill as Geocoding: SKU naming NF). ESTIMATE. */
  googleGeocoding: 5_000,
  /** Google Compute Routes Essentials USD 5/1,000 (TRAFFIC_UNAWARE). ESTIMATE. */
  googleRoutesEssentials: 5_000,
  /** Google Compute Routes Pro USD 10/1,000 (assumed for TRAFFIC_AWARE: tier mapping NF). ESTIMATE. */
  googleRoutesPro: 10_000,
  /**
   * Mapbox Search Box session, standard pricing USD 11.50/1,000 sessions (preview pricing not assumed). Declared on
   * every /suggest call as a conservative upper bound (an abandoned session is billed too); /retrieve then adds 0.
   * ESTIMATE.
   */
  mapboxSearchBoxSession: 11_500,
  /** Mapbox Geocoding v6 temporary USD 0.75/1,000. ESTIMATE. */
  mapboxTemporaryGeocoding: 750,
  /** Mapbox Directions USD 2.00/1,000. ESTIMATE. */
  mapboxDirections: 2_000,
  /** Self-hosted open stack: no per-call price (infrastructure cost only). */
  selfHosted: 0,
} as const;

export type LicenceTerms = Omit<GeoAdapterLicence, 'providerKey' | 'sku'>;

export function licence(providerKey: string, sku: GeoSku, terms: LicenceTerms): GeoAdapterLicence {
  return Object.freeze({ providerKey, sku, ...terms });
}

/** Attribution codes the client must display for a bound bundle. */
export const ATTRIBUTION = { google: 'GOOGLE_MAPS', mapbox: 'MAPBOX', osm: 'OSM_ODBL' } as const;

/**
 * S1 Google. Predictions: TTL 0 (not cacheable unless terms allow). Coordinates (geocode, place resolve, reverse):
 * ≤ 30 consecutive days temporary cache (Maps Service Specific Terms; evaluation §8). OPEN TERMS ITEM for P3.7: the
 * 30-day permission names latitude/longitude; whether the address components cached next to them are covered must be
 * confirmed at the freeze (the gateway may need to cache the point only). Routes: TTL 0 until the route-caching terms
 * are read at P3.7. Google content requires a Google renderer.
 */
export const GOOGLE_TERMS = {
  AUTOCOMPLETE: {
    requiresRenderer: 'google',
    maxCacheTtlSeconds: 0,
    cacheSharedAcrossUsers: false,
    geometryStorable: false,
    attributionCode: ATTRIBUTION.google,
    microUsdPerCall: MICRO_USD_PER_CALL.googleAutocompleteRequest,
  },
  PLACE_RESOLVE: {
    requiresRenderer: 'google',
    maxCacheTtlSeconds: 30 * DAY,
    cacheSharedAcrossUsers: true,
    geometryStorable: false,
    attributionCode: ATTRIBUTION.google,
    microUsdPerCall: MICRO_USD_PER_CALL.googlePlaceDetailsEssentials,
  },
  GEOCODE: {
    requiresRenderer: 'google',
    maxCacheTtlSeconds: 30 * DAY,
    cacheSharedAcrossUsers: true,
    geometryStorable: false,
    attributionCode: ATTRIBUTION.google,
    microUsdPerCall: MICRO_USD_PER_CALL.googleGeocoding,
  },
  REVERSE_GEOCODE: {
    requiresRenderer: 'google',
    maxCacheTtlSeconds: 30 * DAY,
    cacheSharedAcrossUsers: true,
    geometryStorable: false,
    attributionCode: ATTRIBUTION.google,
    microUsdPerCall: MICRO_USD_PER_CALL.googleGeocoding,
  },
  ROUTE_ESSENTIALS: {
    requiresRenderer: 'google',
    maxCacheTtlSeconds: 0,
    cacheSharedAcrossUsers: false,
    geometryStorable: false,
    attributionCode: ATTRIBUTION.google,
    microUsdPerCall: MICRO_USD_PER_CALL.googleRoutesEssentials,
  },
  ROUTE_PRO: {
    requiresRenderer: 'google',
    maxCacheTtlSeconds: 0,
    cacheSharedAcrossUsers: false,
    geometryStorable: false,
    attributionCode: ATTRIBUTION.google,
    microUsdPerCall: MICRO_USD_PER_CALL.googleRoutesPro,
  },
} as const satisfies Record<string, LicenceTerms>;

/**
 * S2 Mapbox. Temporary geocoding: must not be cached, Mapbox map only (V). Search Box data: "temporary use only" (V)
 * ⇒ TTL 0. Directions map coupling / caching NF ⇒ conservative: TTL 0 and a Mapbox renderer. Pilot/production freeze
 * additionally blocked by FA-19 (Commercial Application License applicability).
 */
const MAPBOX_BASE = {
  requiresRenderer: 'mapbox',
  maxCacheTtlSeconds: 0,
  cacheSharedAcrossUsers: false,
  geometryStorable: false,
  attributionCode: ATTRIBUTION.mapbox,
} as const;
export const MAPBOX_TERMS = {
  AUTOCOMPLETE: { ...MAPBOX_BASE, microUsdPerCall: MICRO_USD_PER_CALL.mapboxSearchBoxSession },
  PLACE_RESOLVE: { ...MAPBOX_BASE, microUsdPerCall: 0 },
  GEOCODE: { ...MAPBOX_BASE, microUsdPerCall: MICRO_USD_PER_CALL.mapboxTemporaryGeocoding },
  REVERSE_GEOCODE: { ...MAPBOX_BASE, microUsdPerCall: MICRO_USD_PER_CALL.mapboxTemporaryGeocoding },
  ROUTE: { ...MAPBOX_BASE, microUsdPerCall: MICRO_USD_PER_CALL.mapboxDirections },
} as const satisfies Record<string, LicenceTerms>;

/**
 * S3 self-hosted open stack (own OSM data, ODbL): no vendor caching restriction ⇒ the configured maxima of
 * architecture §12 (autocomplete 24 h, geocode/resolve/reverse 7 days, route 10 min); any renderer; geometry storable
 * (open-licensed); "© OpenStreetMap" attribution.
 */
const OPEN_BASE = {
  requiresRenderer: 'any',
  cacheSharedAcrossUsers: true,
  geometryStorable: true,
  attributionCode: ATTRIBUTION.osm,
  microUsdPerCall: MICRO_USD_PER_CALL.selfHosted,
} as const;
export const OPEN_TERMS = {
  AUTOCOMPLETE: { ...OPEN_BASE, maxCacheTtlSeconds: DAY },
  PLACE_RESOLVE: { ...OPEN_BASE, maxCacheTtlSeconds: 7 * DAY },
  GEOCODE: { ...OPEN_BASE, maxCacheTtlSeconds: 7 * DAY },
  REVERSE_GEOCODE: { ...OPEN_BASE, maxCacheTtlSeconds: 7 * DAY },
  ROUTE: { ...OPEN_BASE, maxCacheTtlSeconds: 600 },
} as const satisfies Record<string, LicenceTerms>;
