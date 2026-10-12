/**
 * Google (S1) shared schemas and mapping. Provider-specific types never leave this package: everything is mapped to the
 * vendor-neutral port types. Request shapes follow the official references listed in SOURCES.md (read 2026-10-13).
 */
import type { AddressComponents, GeoConfidence, GeoLocale, PlaceKind, ResolvedPlace } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import type { SecretValue } from '../config.js';
import { GeoAdapterError } from '../errors.js';
import type { AdapterOptions, CallContext } from '../http.js';
import { MAX_PROVIDER_STRING, buildComponents, classifyKind, malformed, parsePayload, toPoint } from '../normalise.js';

export interface GoogleAdapterOptions extends AdapterOptions {
  readonly apiKey: SecretValue;
}

export const PLACES_BASE = 'https://places.googleapis.com/v1/';
/** Absolute: a relative 'places:autocomplete' would parse as a URL scheme. */
export const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
export const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
export const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Google place ids are URL-safe base64-like tokens. */
export const GOOGLE_PLACE_ID = /^[A-Za-z0-9_-]{1,512}$/;

/** Roman Urdu has no Google language code: Latin-script requests use English (conservative; SP-04 measures quality). */
export function googleLanguage(locale: GeoLocale): string {
  return locale === 'ur' ? 'ur' : 'en';
}

export const str = z.string().max(MAX_PROVIDER_STRING);
const token = z.string().max(80);
export const tokens = z.array(token).max(50);

/** One address component in either API generation (Geocoding v3 `long_name`, Places (New) `longText`). */
export interface GoogleComponent {
  readonly text: string;
  readonly types: readonly string[];
}

const LANDMARK = new Set([
  'point_of_interest',
  'establishment',
  'premise',
  'airport',
  'park',
  'hospital',
  'university',
  'shopping_mall',
  'transit_station',
  'natural_feature',
  'mosque',
  'school',
  'tourist_attraction',
]);
const ADDRESS = new Set(['street_address', 'route', 'street_number', 'subpremise', 'plus_code', 'intersection']);
const AREA = new Set([
  'neighborhood',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'sublocality_level_3',
  'locality',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'postal_code',
  'colloquial_area',
  'political',
]);

export function googleKind(types: readonly string[]): PlaceKind {
  return classifyKind(
    types.map((t) => t.toLowerCase()),
    { landmark: LANDMARK, address: ADDRESS, area: AREA },
  );
}

function first(components: readonly GoogleComponent[], ...types: string[]): string | null {
  for (const type of types) {
    const hit = components.find((c) => c.types.includes(type));
    if (hit) return hit.text;
  }
  return null;
}

/** Address components → Wayvro components (fine → coarse areas; city from locality, else district). */
export function googleComponents(components: readonly GoogleComponent[], locale: GeoLocale): AddressComponents {
  return buildComponents({
    name: first(components, 'point_of_interest', 'establishment', 'premise', 'natural_feature', 'airport', 'park'),
    fineAreas: [
      first(components, 'neighborhood'),
      first(components, 'sublocality_level_3'),
      first(components, 'sublocality_level_2'),
      first(components, 'sublocality_level_1', 'sublocality'),
    ],
    city: first(components, 'locality', 'administrative_area_level_2'),
    locale,
  });
}

/** Geocoding v3 `geometry.location_type` (+ `partial_match`) → confidence. */
function geocodeConfidence(locationType: string | undefined, partialMatch: boolean | undefined): GeoConfidence {
  let confidence: GeoConfidence;
  switch (locationType) {
    case 'ROOFTOP':
      confidence = 'HIGH';
      break;
    case 'RANGE_INTERPOLATED':
      confidence = 'MEDIUM';
      break;
    case 'GEOMETRIC_CENTER':
    case 'APPROXIMATE':
      confidence = 'LOW';
      break;
    default:
      confidence = 'UNKNOWN';
  }
  return partialMatch === true && confidence !== 'UNKNOWN' ? 'LOW' : confidence;
}

/** Geocoding v3 (forward and reverse share the response shape). */
const geocodingV3Schema = z.object({
  status: z.string().max(40),
  results: z
    .array(
      z.object({
        address_components: z.array(z.object({ long_name: str, short_name: str.optional(), types: tokens })).max(40),
        geometry: z.object({ location: z.object({ lat: z.number(), lng: z.number() }), location_type: z.string().max(40).optional() }),
        types: tokens.optional(),
        partial_match: z.boolean().optional(),
      }),
    )
    .max(50)
    .optional(),
});

type GeocodingV3Result = NonNullable<z.infer<typeof geocodingV3Schema>['results']>[number];

/**
 * Geocoding v3 `status` handling: OK ⇒ results (must be non-empty), ZERO_RESULTS ⇒ [] (honest "no result"); quota,
 * denial, invalid request and unknown errors THROW. `error_message` is never read (it may echo the request).
 */
export function geocodingV3Results(ctx: CallContext, body: unknown, httpStatus: number): readonly GeocodingV3Result[] {
  const payload = parsePayload(ctx, geocodingV3Schema, body, httpStatus);
  switch (payload.status) {
    case 'OK':
      if (payload.results === undefined || payload.results.length === 0) throw malformed(ctx, httpStatus);
      return payload.results;
    case 'ZERO_RESULTS':
      return [];
    case 'OVER_QUERY_LIMIT':
    case 'OVER_DAILY_LIMIT':
      throw new GeoAdapterError(ctx.providerKey, ctx.sku, 'QUOTA', httpStatus);
    case 'REQUEST_DENIED':
      throw new GeoAdapterError(ctx.providerKey, ctx.sku, 'AUTH', httpStatus);
    case 'INVALID_REQUEST':
      throw new GeoAdapterError(ctx.providerKey, ctx.sku, 'CLIENT_ERROR', httpStatus);
    case 'UNKNOWN_ERROR':
      throw new GeoAdapterError(ctx.providerKey, ctx.sku, 'SERVER_ERROR', httpStatus);
    default:
      throw new GeoAdapterError(ctx.providerKey, ctx.sku, 'PROVIDER_STATUS', httpStatus);
  }
}

/** One v3 result → ResolvedPlace; `null` when its coordinate is outside Pakistan (dropped from lists, never moved). */
export function geocodingV3Place(result: GeocodingV3Result, locale: GeoLocale): ResolvedPlace | null {
  const point = toPoint(result.geometry.location.lat, result.geometry.location.lng);
  if (point === null) return null;
  const components = result.address_components.map((c) => ({ text: c.long_name, types: c.types }));
  return {
    point,
    components: googleComponents(components, locale),
    kind: googleKind(result.types ?? []),
    confidence: geocodeConfidence(result.geometry.location_type, result.partial_match),
  };
}
