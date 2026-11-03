/**
 * Mapbox (S2) shared schemas and mapping (Search Box API, Geocoding v6, Directions v5; SOURCES.md, read 2026-10-13).
 * Mapbox takes the token as the `access_token` query parameter: outbound URLs are never logged or put into errors.
 * S2 cannot be frozen for pilot/production while FA-19 (Commercial Application License applicability) is open.
 */
import type { AddressComponents, GeoConfidence, GeoLocale, GeoPoint, PlaceKind, ResolvedPlace } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import type { SecretValue } from '../config.js';
import type { AdapterOptions } from '../http.js';
import { MAX_PROVIDER_STRING, buildComponents, classifyKind, toPoint } from '../normalise.js';

export interface MapboxAdapterOptions extends AdapterOptions {
  readonly accessToken: SecretValue;
}

export const MAPBOX_BASE = 'https://api.mapbox.com/';

/** Mapbox ids are URL-safe tokens; anything else is refused before it reaches a URL path. */
export const MAPBOX_ID = /^[A-Za-z0-9_.=-]{1,1024}$/;

/**
 * Urdu (`ur`) is not listed in the Geocoding v6 language coverage tables (2026-10-13): no `language` parameter is sent
 * for Urdu-script requests (provider default naming). Roman Urdu is Latin script ⇒ `en`.
 */
export function mapboxLanguage(locale: GeoLocale): string | null {
  return locale === 'ur' ? null : 'en';
}

export const str = z.string().max(MAX_PROVIDER_STRING);
const named = z.object({ name: str });
export const contextSchema = z.object({
  block: named.optional(),
  neighborhood: named.optional(),
  locality: named.optional(),
  district: named.optional(),
  place: named.optional(),
});
export type MapboxContext = z.infer<typeof contextSchema>;

const featureSchema = z.object({
  geometry: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    feature_type: z.string().max(40),
    name: str.optional(),
    context: contextSchema.optional(),
    coordinates: z.object({ longitude: z.number(), latitude: z.number(), accuracy: z.string().max(40).optional() }).optional(),
  }),
});
export type MapboxFeature = z.infer<typeof featureSchema>;

export const featureCollectionSchema = z.object({ features: z.array(featureSchema).max(50) });

const LANDMARK = new Set(['poi']);
const ADDRESS = new Set(['address', 'street', 'secondary_address']);
const AREA = new Set(['block', 'neighborhood', 'locality', 'place', 'city', 'district', 'region', 'postcode', 'country']);

export function mapboxKind(featureType: string): PlaceKind {
  return classifyKind([featureType.toLowerCase()], { landmark: LANDMARK, address: ADDRESS, area: AREA });
}

export function mapboxComponents(name: string | undefined, context: MapboxContext | undefined, locale: GeoLocale): AddressComponents {
  return buildComponents({
    name,
    fineAreas: [context?.block?.name, context?.neighborhood?.name, context?.locality?.name, context?.district?.name],
    city: context?.place?.name,
    locale,
  });
}

/** `coordinates.accuracy` → confidence (absent ⇒ UNKNOWN). */
function mapboxConfidence(accuracy: string | undefined): GeoConfidence {
  switch (accuracy) {
    case 'rooftop':
    case 'parcel':
    case 'point':
      return 'HIGH';
    case 'interpolated':
    case 'intersection':
    case 'street':
      return 'MEDIUM';
    case 'approximate':
      return 'LOW';
    default:
      return 'UNKNOWN';
  }
}

/** GeoJSON `[lng, lat]` → validated point. */
function featurePoint(feature: MapboxFeature): GeoPoint | null {
  const [lng, lat] = feature.geometry.coordinates;
  return toPoint(lat, lng);
}

/** One feature → ResolvedPlace; null when its point is outside Pakistan. */
export function featurePlace(feature: MapboxFeature, locale: GeoLocale): ResolvedPlace | null {
  const point = featurePoint(feature);
  if (point === null) return null;
  return {
    point,
    components: mapboxComponents(feature.properties.name, feature.properties.context, locale),
    kind: mapboxKind(feature.properties.feature_type),
    confidence: mapboxConfidence(feature.properties.coordinates?.accuracy),
  };
}
