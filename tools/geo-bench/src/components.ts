/**
 * Benchmark components: one per (bundle, SKU family, variant). Every component calls the SAME adapters and
 * normalisation the API would use (SP-04 §5.3), so the benchmark measures what production would see. Components are
 * built from the environment (keys/URLs present ⇒ candidate enabled); tests inject fakes.
 */
import {
  type FetchLike,
  createGoogleBundle,
  createMapboxBundle,
  createOpenStackComponents,
  readGoogleGeoConfig,
  readMapboxGeoConfig,
  readOpenStackGeoConfig,
  type GeoEnv,
} from '@wayvro/geo-adapters';
import type { GeocodingPort, PlacesAutocompletePort, ReverseGeocodingPort, RoutingPort } from '@wayvro/provider-interfaces';
import type { BudgetBucket } from './budget.js';

export type BundleId = 'S1' | 'S2' | 'S3';

interface Base {
  /** Stable label, e.g. `S1-places`. Local and aggregated output use it; it is a vendor label for the evaluation only. */
  readonly id: string;
  readonly bundle: BundleId;
}

/** Autocomplete measured as suggest + resolve of each top-5 suggestion (the API flow). */
interface SuggestResolveComponent extends Base {
  readonly kind: 'AUTOCOMPLETE';
  readonly mode: 'suggest-resolve';
  readonly suggest: PlacesAutocompletePort;
  readonly resolver: GeocodingPort;
  /** Bucket of each suggest call; `sessionBilled` ⇒ only the first suggest of a session is counted (Mapbox Search Box). */
  readonly suggestBucket: BudgetBucket | null;
  readonly resolveBucket: BudgetBucket | null;
  readonly sessionBilled: boolean;
}

/** Autocomplete measured through forward geocoding with points in the answer (S2 temporary-geocoding variant). */
interface GeocodePointsComponent extends Base {
  readonly kind: 'AUTOCOMPLETE';
  readonly mode: 'geocode-points';
  readonly geocoder: GeocodingPort;
  readonly bucket: BudgetBucket | null;
}

interface GeocodeComponent extends Base {
  readonly kind: 'GEOCODE';
  readonly adapter: GeocodingPort;
  readonly bucket: BudgetBucket | null;
}

interface ReverseComponent extends Base {
  readonly kind: 'REVERSE_GEOCODE';
  readonly adapter: ReverseGeocodingPort;
  readonly bucket: BudgetBucket | null;
}

interface RouteComponent extends Base {
  readonly kind: 'ROUTE';
  readonly adapter: RoutingPort;
  readonly bucket: BudgetBucket | null;
}

type AutocompleteComponent = SuggestResolveComponent | GeocodePointsComponent;
export type Component = AutocompleteComponent | GeocodeComponent | ReverseComponent | RouteComponent;

/** Wraps fetch per bundle (the harness passes a recording wrapper that keeps raw bodies local). */
export type FetchFactory = (bundle: BundleId) => FetchLike;

/** Builds every component whose credentials/URLs are present. Throws a configuration error (never echoing values). */
export function componentsFromEnv(env: GeoEnv, fetchFor: FetchFactory): Component[] {
  const out: Component[] = [];
  const google = readGoogleGeoConfig(env);
  if (google !== null) {
    const b = createGoogleBundle(google, { providerKey: 'geo-bench-s1', fetchImpl: fetchFor('S1') });
    out.push(
      {
        id: 'S1-places',
        bundle: 'S1',
        kind: 'AUTOCOMPLETE',
        mode: 'suggest-resolve',
        suggest: b.placesAutocomplete,
        resolver: b.geocoding,
        suggestBucket: 'google:autocomplete-requests',
        resolveBucket: 'google:place-details-essentials',
        sessionBilled: false,
      },
      { id: 'S1-geocoding', bundle: 'S1', kind: 'GEOCODE', adapter: b.geocoding, bucket: 'google:geocoding' },
      { id: 'S1-reverse', bundle: 'S1', kind: 'REVERSE_GEOCODE', adapter: b.reverseGeocoding, bucket: 'google:geocoding' },
      {
        id: 'S1-routes',
        bundle: 'S1',
        kind: 'ROUTE',
        adapter: b.routing,
        bucket: google.routesTrafficAware ? 'google:routes-pro' : 'google:routes-essentials',
      },
    );
  }
  const mapbox = readMapboxGeoConfig(env);
  if (mapbox !== null) {
    const b = createMapboxBundle(mapbox, { providerKey: 'geo-bench-s2', fetchImpl: fetchFor('S2') });
    const variant = createMapboxBundle(mapbox, { providerKey: 'geo-bench-s2', fetchImpl: fetchFor('S2'), forwardAutocomplete: true });
    out.push(
      {
        id: 'S2-searchbox',
        bundle: 'S2',
        kind: 'AUTOCOMPLETE',
        mode: 'suggest-resolve',
        suggest: b.placesAutocomplete,
        resolver: b.geocoding,
        suggestBucket: 'mapbox:searchbox-sessions',
        resolveBucket: 'mapbox:searchbox-sessions',
        sessionBilled: true,
      },
      {
        id: 'S2-geocoding-autocomplete',
        bundle: 'S2',
        kind: 'AUTOCOMPLETE',
        mode: 'geocode-points',
        geocoder: variant.geocoding,
        bucket: 'mapbox:temporary-geocoding',
      },
      { id: 'S2-geocoding', bundle: 'S2', kind: 'GEOCODE', adapter: b.geocoding, bucket: 'mapbox:temporary-geocoding' },
      { id: 'S2-reverse', bundle: 'S2', kind: 'REVERSE_GEOCODE', adapter: b.reverseGeocoding, bucket: 'mapbox:temporary-geocoding' },
      { id: 'S2-directions', bundle: 'S2', kind: 'ROUTE', adapter: b.routing, bucket: 'mapbox:directions' },
    );
  }
  const open = createOpenStackComponents(readOpenStackGeoConfig(env), { providerKey: 'geo-bench-s3', fetchImpl: fetchFor('S3') });
  if (open.photonAutocomplete !== null && open.photonGeocoding !== null) {
    out.push({
      id: 'S3-photon',
      bundle: 'S3',
      kind: 'AUTOCOMPLETE',
      mode: 'suggest-resolve',
      suggest: open.photonAutocomplete,
      resolver: open.photonGeocoding,
      suggestBucket: null,
      resolveBucket: null,
      sessionBilled: false,
    });
  }
  if (open.photonGeocoding !== null) out.push({ id: 'S3-photon-geocoding', bundle: 'S3', kind: 'GEOCODE', adapter: open.photonGeocoding, bucket: null });
  if (open.photonReverse !== null) out.push({ id: 'S3-photon-reverse', bundle: 'S3', kind: 'REVERSE_GEOCODE', adapter: open.photonReverse, bucket: null });
  if (open.nominatimReverse !== null)
    out.push({ id: 'S3-nominatim-reverse', bundle: 'S3', kind: 'REVERSE_GEOCODE', adapter: open.nominatimReverse, bucket: null });
  if (open.osrm !== null) out.push({ id: 'S3-osrm', bundle: 'S3', kind: 'ROUTE', adapter: open.osrm, bucket: null });
  if (open.valhalla !== null) out.push({ id: 'S3-valhalla', bundle: 'S3', kind: 'ROUTE', adapter: open.valhalla, bucket: null });
  return out;
}
