/**
 * SYNTHETIC fixture written from the publicly documented schema; not a recorded provider response.
 *
 * Shapes follow the public Google references listed in SOURCES.md (Places API (New) Autocomplete and Place Details,
 * Geocoding API v3, Routes API computeRoutes, and the Google API error model `{error:{code,message,status,details}}`).
 * Every value (ids, names, coordinates, messages) is invented for tests: round Lahore-area numbers, "Synthetic …"
 * names and ids prefixed `synthetic`. The documented-but-unused fields (`matches`, `place`, `queryPrediction`,
 * `viewport`, `plus_code`, `formatted_address`, `languageCode`, …) are present on purpose: the contract tests prove
 * the adapters drop them instead of leaking vendor fields past the port types.
 */
import { SYNTHETIC, encodePolyline } from './fake-fetch.js';

/** Places API (New) `places:autocomplete` response with a place prediction, a query prediction and match offsets. */
export const GOOGLE_AUTOCOMPLETE_RESPONSE = {
  suggestions: [
    {
      placePrediction: {
        place: 'places/synthetic_place_a',
        placeId: 'synthetic_place_a',
        text: { text: 'Synthetic Gate, Synthetic Block C, Lahore, Pakistan', matches: [{ endOffset: 9 }] },
        structuredFormat: {
          mainText: { text: 'Synthetic Gate', matches: [{ endOffset: 9 }] },
          secondaryText: { text: 'Synthetic Block C, Lahore, Pakistan' },
        },
        types: ['point_of_interest', 'establishment'],
        distanceMeters: 1200,
      },
    },
    {
      queryPrediction: {
        text: { text: 'synthetic gate near me', matches: [{ endOffset: 9 }] },
        structuredFormat: { mainText: { text: 'synthetic gate near me' } },
      },
    },
  ],
} as const;

/** Place Details (New) response for the Essentials field mask `id,location,addressComponents,types`. */
export const GOOGLE_PLACE_DETAILS_RESPONSE = {
  id: 'synthetic_place_a',
  types: ['point_of_interest', 'establishment'],
  location: { latitude: 31.52, longitude: 74.33 },
  addressComponents: [
    { longText: 'Synthetic Gate', shortText: 'Synthetic Gate', types: ['point_of_interest', 'establishment'], languageCode: 'en' },
    { longText: 'Synthetic Block C', shortText: 'Synthetic Block C', types: ['sublocality_level_2', 'sublocality', 'political'], languageCode: 'en' },
    { longText: 'Synthetic Colony', shortText: 'Synthetic Colony', types: ['sublocality_level_1', 'sublocality', 'political'], languageCode: 'en' },
    { longText: 'Lahore', shortText: 'Lahore', types: ['locality', 'political'], languageCode: 'en' },
    { longText: 'Punjab', shortText: 'Punjab', types: ['administrative_area_level_1', 'political'], languageCode: 'en' },
    { longText: 'Pakistan', shortText: 'PK', types: ['country', 'political'], languageCode: 'en' },
  ],
} as const;

/** Geocoding API v3 `OK` response (forward and reverse share it), including viewport, plus code and place id. */
export const GOOGLE_GEOCODING_OK_RESPONSE = {
  results: [
    {
      address_components: [
        { long_name: 'Synthetic Road', short_name: 'Synthetic Rd', types: ['route'] },
        { long_name: 'Synthetic Colony', short_name: 'Synthetic Colony', types: ['sublocality_level_1', 'sublocality', 'political'] },
        { long_name: 'Lahore', short_name: 'Lahore', types: ['locality', 'political'] },
        { long_name: 'Pakistan', short_name: 'PK', types: ['country', 'political'] },
      ],
      formatted_address: 'Synthetic Road, Synthetic Colony, Lahore, Pakistan',
      geometry: {
        location: { lat: 31.51, lng: 74.32 },
        location_type: 'GEOMETRIC_CENTER',
        viewport: { northeast: { lat: 31.52, lng: 74.33 }, southwest: { lat: 31.5, lng: 74.31 } },
      },
      place_id: 'synthetic_geocode_place',
      plus_code: { compound_code: 'SYNTHETIC', global_code: 'SYNTHETIC' },
      types: ['route'],
    },
  ],
  status: 'OK',
} as const;

/** Geocoding API v3 non-OK body: `error_message` is documented to accompany non-OK statuses. */
export function googleGeocodingStatus(status: string, errorMessage: string): Record<string, unknown> {
  return { error_message: errorMessage, results: [], status };
}

/** Routes API computeRoutes response for the field mask `routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline`. */
export const GOOGLE_ROUTES_RESPONSE = {
  routes: [{ distanceMeters: 15_234, duration: '1265s', polyline: { encodedPolyline: encodePolyline([SYNTHETIC.a, SYNTHETIC.b, SYNTHETIC.c], 5) } }],
} as const;

/** Google API error model body (Places API (New), Routes API). The message is a test sentinel. */
export function googleApiError(code: number, status: string, message: string): Record<string, unknown> {
  return {
    error: {
      code,
      message,
      status,
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SYNTHETIC_REASON', domain: 'googleapis.com' }],
    },
  };
}

/**
 * Google API error model body with one `google.rpc.ErrorInfo` detail carrying a documented `google.api.ErrorReason`
 * (e.g. an invalid key documented as HTTP 400 INVALID_ARGUMENT + API_KEY_INVALID). The message is a test sentinel.
 */
export function googleApiErrorInfo(
  code: number,
  status: string,
  reason: string,
  message: string,
  domain = 'googleapis.com',
  type = 'type.googleapis.com/google.rpc.ErrorInfo',
): Record<string, unknown> {
  return {
    error: {
      code,
      message,
      status,
      details: [
        { '@type': 'type.googleapis.com/google.rpc.Help', links: [{ description: message, url: 'https://console.invalid/' }] },
        { '@type': type, reason, domain, metadata: { service: 'synthetic.googleapis.com', consumer: message } },
      ],
    },
  };
}

/** Canonical google.rpc status names for the HTTP statuses the contract tests exercise. */
export const GOOGLE_RPC_STATUS: Readonly<Record<number, string>> = {
  400: 'INVALID_ARGUMENT',
  401: 'UNAUTHENTICATED',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  429: 'RESOURCE_EXHAUSTED',
  500: 'INTERNAL',
  503: 'UNAVAILABLE',
};
