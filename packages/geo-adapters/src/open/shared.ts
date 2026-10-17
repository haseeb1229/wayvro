/**
 * S3 self-hosted open stack (OSM data, ODbL) shared schemas and mapping: Photon (GeoJSON) and Nominatim (`jsonv2`).
 * Only self-hosted base URLs are accepted (config.ts refuses the public community servers).
 */
import type { GeoLocale, PlaceKind, ResolvedPlace } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import type { AdapterOptions } from '../http.js';
import { MAX_PROVIDER_STRING, buildComponents, classifyKind, parseDecimal, toPoint } from '../normalise.js';

export interface SelfHostedAdapterOptions extends AdapterOptions {
  /** Validated base URL (see `parseBaseUrl`); endpoint paths are resolved beneath it. */
  readonly baseUrl: URL;
}

const str = z.string().max(MAX_PROVIDER_STRING);
const short = z.string().max(80);

/** Photon only ships `default` plus the languages chosen at import (typically en/de/fr): Urdu script ⇒ server default. */
export function photonLanguage(locale: GeoLocale): string | null {
  return locale === 'ur' ? null : 'en';
}

/** Nominatim `accept-language`: Urdu script ⇒ `ur`, Latin (incl. Roman Urdu) ⇒ `en`. */
export function nominatimLanguage(locale: GeoLocale): string {
  return locale === 'ur' ? 'ur' : 'en';
}

const LANDMARK_KEYS = new Set([
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'healthcare',
  'aeroway',
  'office',
  'historic',
  'railway',
  'public_transport',
  'man_made',
  'craft',
  'building',
]);
const ADDRESS_KEYS = new Set(['highway', 'house', 'street', 'house_number', 'road']);
const AREA_KEYS = new Set(['place', 'boundary', 'locality', 'district', 'city', 'county', 'state', 'country', 'suburb', 'neighbourhood', 'quarter']);

function osmKind(tokens: readonly (string | undefined)[]): PlaceKind {
  const list = tokens.filter((t): t is string => t !== undefined).map((t) => t.toLowerCase());
  return classifyKind(list, { landmark: LANDMARK_KEYS, address: ADDRESS_KEYS, area: AREA_KEYS });
}

const photonFeatureSchema = z.object({
  geometry: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    osm_type: z.enum(['N', 'W', 'R']).optional(),
    osm_id: z.number().int().positive().optional(),
    osm_key: short.optional(),
    osm_value: short.optional(),
    type: short.optional(),
    name: str.optional(),
    street: str.optional(),
    district: str.optional(),
    locality: str.optional(),
    city: str.optional(),
    county: str.optional(),
    countrycode: z.string().max(3).optional(),
  }),
});
export type PhotonFeature = z.infer<typeof photonFeatureSchema>;
export const photonCollectionSchema = z.object({ features: z.array(photonFeatureSchema).max(50) });

/** Photon OSM reference (`N123`), resolvable through Nominatim `/lookup`; null when absent. */
export function photonOsmRef(feature: PhotonFeature): string | null {
  const { osm_type: type, osm_id: id } = feature.properties;
  return type !== undefined && id !== undefined ? `${type}${id}` : null;
}

/** Features whose country code is present and not PK are dropped (the bbox filter is applied as well). */
export function photonInPakistan(feature: PhotonFeature): boolean {
  const cc = feature.properties.countrycode;
  return cc === undefined || cc.toUpperCase() === 'PK';
}

export function photonComponents(feature: PhotonFeature, locale: GeoLocale): ResolvedPlace['components'] {
  const p = feature.properties;
  return buildComponents({ name: p.name ?? p.street, fineAreas: [p.locality, p.district], city: p.city ?? p.county, locale });
}

export function photonKind(feature: PhotonFeature): PlaceKind {
  const p = feature.properties;
  return osmKind([p.osm_key, p.type]);
}

export function photonPlace(feature: PhotonFeature, locale: GeoLocale): ResolvedPlace | null {
  if (!photonInPakistan(feature)) return null;
  const [lng, lat] = feature.geometry.coordinates;
  const point = toPoint(lat, lng);
  if (point === null) return null;
  return { point, components: photonComponents(feature, locale), kind: photonKind(feature), confidence: 'UNKNOWN' };
}

export const nominatimPlaceSchema = z.object({
  lat: z.string().max(32),
  lon: z.string().max(32),
  category: short.optional(),
  type: short.optional(),
  addresstype: short.optional(),
  name: str.optional(),
  address: z
    .record(short, str)
    .refine((record) => Object.keys(record).length <= 60)
    .optional(),
});
export type NominatimPlace = z.infer<typeof nominatimPlaceSchema>;

export function nominatimPlace(place: NominatimPlace, locale: GeoLocale): ResolvedPlace | null {
  const point = toPoint(parseDecimal(place.lat), parseDecimal(place.lon));
  if (point === null) return null;
  const a = place.address ?? {};
  if (a['country_code'] !== undefined && a['country_code'].toLowerCase() !== 'pk') return null;
  return {
    point,
    components: buildComponents({
      name: place.name,
      fineAreas: [a['neighbourhood'], a['residential'], a['quarter'], a['suburb'], a['city_district']],
      city: a['city'] ?? a['town'] ?? a['village'],
      locale,
    }),
    kind: osmKind([place.category, place.addresstype]),
    confidence: 'UNKNOWN',
  };
}
