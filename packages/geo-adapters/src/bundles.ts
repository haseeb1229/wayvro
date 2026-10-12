/**
 * Licence-coherent candidate bundles (CON-P3-16; evaluation doc §6.2) assembled from validated configuration. These
 * factories are used by the dev-only SP-04 harness; NO composition root binds them in Phase 3 until the ADR-006 freeze.
 * Every adapter of a bundle shares one opaque provider key.
 */
import type { GeocodingAdapter, PlacesAutocompleteAdapter, ReverseGeocodingAdapter, RoutingAdapter } from '@wayvro/provider-interfaces';
import type { GoogleGeoConfig, MapboxGeoConfig, OpenStackGeoConfig } from './config.js';
import type { FetchLike } from './http.js';
import { GoogleGeocodingAdapter } from './google/geocoding.js';
import { GooglePlacesAutocompleteAdapter } from './google/places-autocomplete.js';
import { GoogleReverseGeocodingAdapter } from './google/reverse-geocoding.js';
import { GoogleRoutesAdapter } from './google/routes.js';
import { MapboxDirectionsAdapter } from './mapbox/directions.js';
import { MapboxGeocodingAdapter } from './mapbox/geocoding.js';
import { MapboxReverseGeocodingAdapter } from './mapbox/reverse-geocoding.js';
import { MapboxSearchBoxAutocompleteAdapter } from './mapbox/search-box-autocomplete.js';
import { PhotonAutocompleteAdapter } from './open/photon-autocomplete.js';
import { PhotonGeocodingAdapter } from './open/photon-geocoding.js';
import { NominatimReverseGeocodingAdapter, PhotonReverseGeocodingAdapter } from './open/reverse-geocoding.js';
import { OsrmRoutingAdapter, ValhallaRoutingAdapter } from './open/routing.js';

export interface BundleFactoryOptions {
  readonly providerKey: string;
  readonly fetchImpl?: FetchLike;
}

export interface GeoBundleAdapters {
  readonly placesAutocomplete: PlacesAutocompleteAdapter;
  readonly geocoding: GeocodingAdapter;
  readonly reverseGeocoding: ReverseGeocodingAdapter;
  readonly routing: RoutingAdapter;
}

function base(options: BundleFactoryOptions): { providerKey: string; fetchImpl?: FetchLike } {
  return options.fetchImpl === undefined ? { providerKey: options.providerKey } : { providerKey: options.providerKey, fetchImpl: options.fetchImpl };
}

/** S1 Google: Places Autocomplete + Place Details, Geocoding (forward + reverse), Routes. Requires a Google renderer. */
export function createGoogleBundle(config: GoogleGeoConfig, options: BundleFactoryOptions): GeoBundleAdapters {
  const common = { ...base(options), apiKey: config.apiKey };
  return {
    placesAutocomplete: new GooglePlacesAutocompleteAdapter(common),
    geocoding: new GoogleGeocodingAdapter(common),
    reverseGeocoding: new GoogleReverseGeocodingAdapter(common),
    routing: new GoogleRoutesAdapter({ ...common, trafficAware: config.routesTrafficAware }),
  };
}

/** S2 Mapbox: Search Box suggest/retrieve, Geocoding v6 temporary (forward + reverse), Directions. Requires a Mapbox renderer. */
export function createMapboxBundle(config: MapboxGeoConfig, options: BundleFactoryOptions & { readonly forwardAutocomplete?: boolean }): GeoBundleAdapters {
  const common = { ...base(options), accessToken: config.accessToken };
  return {
    placesAutocomplete: new MapboxSearchBoxAutocompleteAdapter(common),
    geocoding: new MapboxGeocodingAdapter({ ...common, forwardAutocomplete: options.forwardAutocomplete === true }),
    reverseGeocoding: new MapboxReverseGeocodingAdapter(common),
    routing: new MapboxDirectionsAdapter(common),
  };
}

/** S3 components, each present only when its self-hosted URL is configured (SP-04 compares the alternatives). */
export interface OpenStackComponents {
  readonly photonAutocomplete: PlacesAutocompleteAdapter | null;
  /** Needs both Photon (forward) and Nominatim (`/lookup` for place resolution). */
  readonly photonGeocoding: GeocodingAdapter | null;
  readonly photonReverse: ReverseGeocodingAdapter | null;
  readonly nominatimReverse: ReverseGeocodingAdapter | null;
  readonly osrm: RoutingAdapter | null;
  readonly valhalla: RoutingAdapter | null;
}

export function createOpenStackComponents(config: OpenStackGeoConfig, options: BundleFactoryOptions): OpenStackComponents {
  const common = base(options);
  const { photonUrl, nominatimUrl, osrmUrl, valhallaUrl } = config;
  return {
    photonAutocomplete: photonUrl === null ? null : new PhotonAutocompleteAdapter({ ...common, baseUrl: photonUrl }),
    photonGeocoding:
      photonUrl === null || nominatimUrl === null ? null : new PhotonGeocodingAdapter({ ...common, baseUrl: photonUrl, nominatimBaseUrl: nominatimUrl }),
    photonReverse: photonUrl === null ? null : new PhotonReverseGeocodingAdapter({ ...common, baseUrl: photonUrl }),
    nominatimReverse: nominatimUrl === null ? null : new NominatimReverseGeocodingAdapter({ ...common, baseUrl: nominatimUrl }),
    osrm: osrmUrl === null ? null : new OsrmRoutingAdapter({ ...common, baseUrl: osrmUrl }),
    valhalla: valhallaUrl === null ? null : new ValhallaRoutingAdapter({ ...common, baseUrl: valhallaUrl }),
  };
}
