/**
 * @wayvro/geo-adapters — SERVER-ONLY candidate geo adapters (Phase 3 P3.2; E06; ADR-006 OPEN-SPIKE).
 * Importable only by the API composition root (dependency-cruiser `geo-adapters-composition-only`) and the dev-only
 * SP-04 harness (`tools/geo-bench`). No composition root binds any of these adapters before the P3.7 freeze.
 */
export {
  createGoogleBundle,
  createMapboxBundle,
  createOpenStackComponents,
  type BundleFactoryOptions,
  type GeoBundleAdapters,
  type OpenStackComponents,
} from './bundles.js';
export {
  SecretValue,
  parseBaseUrl,
  readGoogleGeoConfig,
  readMapboxGeoConfig,
  readOpenStackGeoConfig,
  type GeoEnv,
  type GoogleGeoConfig,
  type MapboxGeoConfig,
  type OpenStackGeoConfig,
} from './config.js';
export { GeoAdapterConfigError, GeoAdapterError, type GeoAdapterErrorCode } from './errors.js';
export { GoogleGeocodingAdapter } from './google/geocoding.js';
export { GooglePlacesAutocompleteAdapter } from './google/places-autocomplete.js';
export { GoogleReverseGeocodingAdapter } from './google/reverse-geocoding.js';
export { GoogleRoutesAdapter, type GoogleRoutesOptions } from './google/routes.js';
export type { GoogleAdapterOptions } from './google/shared.js';
export { DEFAULT_MAX_RESPONSE_BYTES, type AdapterOptions, type FetchLike } from './http.js';
export { ATTRIBUTION, GOOGLE_TERMS, MAPBOX_TERMS, MICRO_USD_PER_CALL, OPEN_TERMS, PRICE_TABLE_DATE } from './licences.js';
export { MapboxDirectionsAdapter } from './mapbox/directions.js';
export { MapboxGeocodingAdapter, type MapboxGeocodingOptions } from './mapbox/geocoding.js';
export { MapboxReverseGeocodingAdapter } from './mapbox/reverse-geocoding.js';
export { MapboxSearchBoxAutocompleteAdapter } from './mapbox/search-box-autocomplete.js';
export type { MapboxAdapterOptions } from './mapbox/shared.js';
export { PAKISTAN_BBOX, inPakistan } from './normalise.js';
export { PhotonAutocompleteAdapter } from './open/photon-autocomplete.js';
export { PhotonGeocodingAdapter, type PhotonGeocodingOptions } from './open/photon-geocoding.js';
export { NominatimReverseGeocodingAdapter, PhotonReverseGeocodingAdapter } from './open/reverse-geocoding.js';
export { OsrmRoutingAdapter, ValhallaRoutingAdapter } from './open/routing.js';
export type { SelfHostedAdapterOptions } from './open/shared.js';
