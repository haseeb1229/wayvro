/**
 * Shared normalisation helpers: payload validation, bounded text, Pakistan-bbox coordinates, polyline decoding and the
 * vendor-neutral address-component mapping. Nothing here invents data: a missing provider field stays `null`, an
 * invalid one makes the whole payload invalid (typed error), and out-of-region list items are dropped, never moved.
 */
import type { AddressComponents, GeoLocale, GeoPoint, PlaceKind } from '@wayvro/provider-interfaces';
import type { z } from 'zod';
import { GeoAdapterError } from './errors.js';
import type { CallContext } from './http.js';

/** Coarse Pakistan bounding box (architecture §5.2 step 1; threat model T3-21). */
export const PAKISTAN_BBOX = { minLat: 23.5, maxLat: 37.2, minLng: 60.8, maxLng: 77.9 } as const;

/** Upper bound on decoded route vertices accepted from any provider (adapters request simplified overviews). */
export const MAX_ROUTE_VERTICES = 10_000;
/** Upper bound on an encoded polyline string. */
export const MAX_POLYLINE_CHARS = 200_000;
/** Upper bound on any single provider string accepted by a schema (longer ⇒ malformed payload). */
export const MAX_PROVIDER_STRING = 2_000;
/** Normalised Wayvro address strings are capped further. */
const MAX_COMPONENT_CHARS = 200;

export function inPakistan(point: GeoPoint): boolean {
  return point.lat >= PAKISTAN_BBOX.minLat && point.lat <= PAKISTAN_BBOX.maxLat && point.lng >= PAKISTAN_BBOX.minLng && point.lng <= PAKISTAN_BBOX.maxLng;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Validates a provider coordinate and rounds it to 6 decimals; `null` when it is not a finite point inside Pakistan. */
export function toPoint(lat: number, lng: number): GeoPoint | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const point = { lat: round(lat, 6), lng: round(lng, 6) };
  return inPakistan(point) ? point : null;
}

/** Coordinates sent to a provider: at most `decimals` places (reverse geocode ≤ 5 dp, privacy rule §10). */
export function formatCoordinate(value: number, decimals: number): string {
  return round(value, decimals).toFixed(decimals);
}

/** Parses a provider decimal string strictly (Nominatim returns coordinates as strings). */
export function parseDecimal(text: string): number {
  return /^-?\d{1,3}(\.\d{1,12})?$/.test(text) ? Number(text) : Number.NaN;
}

/** C0/C1 controls and bidi overrides/isolates (spoofing); other format characters such as ZWNJ (used in Urdu) are kept. */
function isUnsafeCodePoint(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

/**
 * Plain-text cleanup for every provider string shown to users: control/bidi chars removed, whitespace collapsed, capped.
 * @internal exported for unit tests
 */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const replaced = Array.from(value.normalize('NFC'), (ch) => (isUnsafeCodePoint(ch.codePointAt(0) ?? 0) ? ' ' : ch)).join('');
  const cleaned = replaced.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  const codePoints = Array.from(cleaned);
  return codePoints.length > MAX_COMPONENT_CHARS ? codePoints.slice(0, MAX_COMPONENT_CHARS).join('').trimEnd() : cleaned;
}

const ARABIC_RANGES: readonly (readonly [number, number])[] = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];

function hasArabicScript(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ARABIC_RANGES.some(([from, to]) => cp >= from && cp <= to)) return true;
  }
  return false;
}

/**
 * Urdu-script name only when the provider itself returned Arabic-script text for an Urdu request (never transliterated).
 * @internal exported for unit tests
 */
export function urduName(name: string | null, locale: GeoLocale): string | null {
  return locale === 'ur' && name !== null && hasArabicScript(name) ? name : null;
}

const BLOCK_PATTERN = /\b(block|blk|phase|ph|sector)\b/i;

/**
 * Builds the vendor-neutral components from provider-supplied strings. `fineAreas` are ordered fine → coarse
 * (e.g. neighbourhood, sublocality, district): the first one naming a block/phase/sector becomes `block`, the first
 * other one becomes `area`. `society` stays null: no candidate provider exposes a society/scheme field and it is never
 * inferred (the gateway's Lahore formatter and curated landmark aliases own it).
 */
export function buildComponents(input: {
  readonly name: string | null | undefined;
  readonly fineAreas: readonly (string | null | undefined)[];
  readonly city: string | null | undefined;
  readonly locale: GeoLocale;
}): AddressComponents {
  const name = cleanText(input.name);
  let block: string | null = null;
  let area: string | null = null;
  for (const raw of input.fineAreas) {
    const value = cleanText(raw);
    if (value === null || value === name) continue;
    if (block === null && BLOCK_PATTERN.test(value)) block = value;
    else if (area === null && value !== block) area = value;
  }
  return { name, block, society: null, area, city: cleanText(input.city), nameUrdu: urduName(name, input.locale) };
}

/** Classifies a set of vendor type tokens (already lower-cased) using vendor-specific token sets. */
export function classifyKind(
  tokens: readonly string[],
  sets: { readonly landmark: ReadonlySet<string>; readonly address: ReadonlySet<string>; readonly area: ReadonlySet<string> },
): PlaceKind {
  if (tokens.some((t) => sets.landmark.has(t))) return 'LANDMARK';
  if (tokens.some((t) => sets.address.has(t))) return 'ADDRESS';
  if (tokens.some((t) => sets.area.has(t))) return 'AREA';
  return 'OTHER';
}

function invalidInput(ctx: CallContext): GeoAdapterError {
  return new GeoAdapterError(ctx.providerKey, ctx.sku, 'INVALID_INPUT');
}

/** Query text sent to a provider: 1–200 code points after trimming (the gateway validated it already; defence in depth). */
export function requireQueryText(ctx: CallContext, text: string): string {
  const trimmed = text.trim();
  const length = Array.from(trimmed).length;
  if (length < 1 || length > 200) throw invalidInput(ctx);
  return trimmed;
}

/** Search session ids are opaque URL-safe tokens (UUIDs in practice). */
export function requireSessionId(ctx: CallContext, id: string): string {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw invalidInput(ctx);
  return id;
}

/** Points sent to a provider must be finite and inside the Pakistan bbox. */
export function requirePoint(ctx: CallContext, point: GeoPoint): GeoPoint {
  const p = toPoint(point.lat, point.lng);
  if (p === null) throw invalidInput(ctx);
  return p;
}

/** Provider place ids are inserted into a URL path or query: restrict to a safe alphabet. */
export function requirePlaceId(ctx: CallContext, id: string, pattern: RegExp): string {
  if (!pattern.test(id)) throw invalidInput(ctx);
  return id;
}

/** Validates a parsed JSON payload; schema failure ⇒ MALFORMED_RESPONSE (the zod issue list is not attached: it may echo values). */
export function parsePayload<T>(ctx: CallContext, schema: z.ZodType<T>, body: unknown, status: number): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new GeoAdapterError(ctx.providerKey, ctx.sku, 'MALFORMED_RESPONSE', status);
  return result.data;
}

/** Throws MALFORMED_RESPONSE: used when a validated payload still carries an impossible value (e.g. a point outside Pakistan). */
export function malformed(ctx: CallContext, status: number): GeoAdapterError {
  return new GeoAdapterError(ctx.providerKey, ctx.sku, 'MALFORMED_RESPONSE', status);
}

/**
 * Decodes an encoded polyline (Google precision 5, Valhalla precision 6). Returns null for a malformed string so the
 * adapter can throw a typed error.
 */
export function decodePolyline(encoded: string, precision: 5 | 6): GeoPoint[] | null {
  if (encoded.length > MAX_POLYLINE_CHARS) return null;
  const factor = 10 ** precision;
  const points: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (index >= encoded.length || shift > 30) return null;
      const byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === null || dLng === null) return null;
    lat += dLat;
    lng += dLng;
    points.push({ lat: lat / factor, lng: lng / factor });
    if (points.length > MAX_ROUTE_VERTICES) return null;
  }
  return points;
}

/** Validates every vertex (finite, inside Pakistan, rounded to 6 dp) and the vertex count; null when invalid. */
export function validateGeometry(points: readonly GeoPoint[]): GeoPoint[] | null {
  if (points.length < 2 || points.length > MAX_ROUTE_VERTICES) return null;
  const out: GeoPoint[] = [];
  for (const p of points) {
    const v = toPoint(p.lat, p.lng);
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

/**
 * Normalises a provider distance/duration pair. Distance must be a finite number > 0 (integer metres after rounding),
 * duration finite and ≥ 0 (integer seconds). Returns null otherwise: the adapter throws INCOMPLETE_ROUTE.
 */
export function routeNumbers(distanceM: number | null | undefined, durationS: number | null | undefined): { distanceM: number; durationS: number } | null {
  if (distanceM === null || distanceM === undefined || durationS === null || durationS === undefined) return null;
  if (!Number.isFinite(distanceM) || !Number.isFinite(durationS)) return null;
  const d = Math.round(distanceM);
  const t = Math.round(durationS);
  if (d <= 0 || t < 0) return null;
  return { distanceM: d, durationS: t };
}
