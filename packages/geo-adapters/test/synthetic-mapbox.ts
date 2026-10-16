/**
 * SYNTHETIC fixture written from the publicly documented schema; not a recorded provider response.
 *
 * Shapes follow the public Mapbox references listed in SOURCES.md (Search Box API `/suggest` and `/retrieve`,
 * Geocoding v6 `/forward` and `/reverse`, Directions v5, and the documented `{message}` / `{code,message}` error
 * bodies). Every value (ids, names, coordinates, messages) is invented for tests: round Lahore-area numbers,
 * "Synthetic …" names and ids prefixed `synthetic`. Documented-but-unused fields (`full_address`, `place_formatted`,
 * `maki`, `routable_points`, `match_code`, `waypoints`, `legs`, `uuid`, `attribution`, …) are present on purpose: the
 * contract tests prove the adapters drop them instead of leaking vendor fields past the port types.
 */
import { SYNTHETIC } from './fake-fetch.js';

const CONTEXT = {
  country: { name: 'Pakistan', country_code: 'PK', country_code_alpha_3: 'PAK' },
  region: { name: 'Punjab', region_code: 'PB' },
  place: { name: 'Lahore', mapbox_id: 'synthetic.place' },
  locality: { name: 'Synthetic Colony', mapbox_id: 'synthetic.locality' },
  neighborhood: { name: 'Synthetic Block D', mapbox_id: 'synthetic.neighborhood' },
  street: { name: 'Synthetic Road' },
} as const;

/** Search Box `/suggest` response: one POI, one category suggestion (not a place) and the attribution string. */
export const MAPBOX_SUGGEST_RESPONSE = {
  suggestions: [
    {
      name: 'Synthetic Garden',
      mapbox_id: 'synthetic.poi.1',
      feature_type: 'poi',
      address: '1 Synthetic Road',
      full_address: '1 Synthetic Road, Synthetic Block D, Lahore, Pakistan',
      place_formatted: 'Synthetic Block D, Lahore, Pakistan',
      context: CONTEXT,
      language: 'en',
      maki: 'park',
      poi_category: ['park'],
      poi_category_ids: ['park'],
      external_ids: {},
      metadata: {},
    },
    { name: 'Parks', mapbox_id: 'synthetic.category.park', feature_type: 'category', language: 'en' },
  ],
  attribution: 'SYNTHETIC attribution string',
  response_id: 'synthetic-response-id',
} as const;

/** Search Box `/retrieve/{mapbox_id}` response (no `coordinates.accuracy`, routable points present). */
export const MAPBOX_RETRIEVE_RESPONSE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [74.34, 31.53] },
      properties: {
        name: 'Synthetic Garden',
        mapbox_id: 'synthetic.poi.1',
        feature_type: 'poi',
        full_address: '1 Synthetic Road, Synthetic Block D, Lahore, Pakistan',
        place_formatted: 'Synthetic Block D, Lahore, Pakistan',
        context: CONTEXT,
        coordinates: { latitude: 31.53, longitude: 74.34, routable_points: [{ name: 'default', latitude: 31.53, longitude: 74.34 }] },
        language: 'en',
        maki: 'park',
        metadata: {},
      },
    },
  ],
  attribution: 'SYNTHETIC attribution string',
} as const;

/** Geocoding v6 `/forward` and `/reverse` response (FeatureCollection with `match_code`, `bbox`, `attribution`). */
export const MAPBOX_GEOCODING_V6_RESPONSE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'synthetic.address.1',
      geometry: { type: 'Point', coordinates: [74.32, 31.51] },
      properties: {
        mapbox_id: 'synthetic.address.1',
        feature_type: 'address',
        full_address: '7 Synthetic Road, Synthetic Colony, Lahore, Pakistan',
        name: '7 Synthetic Road',
        name_preferred: '7 Synthetic Road',
        place_formatted: 'Synthetic Colony, Lahore, Pakistan',
        context: CONTEXT,
        coordinates: { longitude: 74.32, latitude: 31.51, accuracy: 'interpolated', routable_points: [{ name: 'default', latitude: 31.51, longitude: 74.32 }] },
        bbox: [74.31, 31.5, 74.33, 31.52],
        match_code: { address_number: 'matched', street: 'matched', confidence: 'medium' },
      },
    },
  ],
  attribution: 'SYNTHETIC attribution string',
} as const;

/** Directions v5 `Ok` response with legs, waypoints and uuid (only distance, duration and geometry are consumed). */
export const MAPBOX_DIRECTIONS_RESPONSE = {
  routes: [
    {
      weight_name: 'auto',
      weight: 1400.5,
      duration: 1265.2,
      distance: 15_234.4,
      legs: [{ summary: 'Synthetic Road', weight: 1400.5, duration: 1265.2, distance: 15_234.4, steps: [], via_waypoints: [] }],
      geometry: { type: 'LineString', coordinates: [SYNTHETIC.a, SYNTHETIC.b, SYNTHETIC.c].map((p) => [p.lng, p.lat]) },
    },
  ],
  waypoints: [
    { distance: 1.2, name: 'Synthetic Road', location: [SYNTHETIC.a.lng, SYNTHETIC.a.lat] },
    { distance: 0.8, name: 'Synthetic Avenue', location: [SYNTHETIC.c.lng, SYNTHETIC.c.lat] },
  ],
  code: 'Ok',
  uuid: 'synthetic-uuid',
} as const;

/** Documented Mapbox error body (`message`, plus `code` on Directions). The message is a test sentinel. */
export function mapboxError(message: string, code?: string): Record<string, unknown> {
  return code === undefined ? { message } : { code, message };
}
