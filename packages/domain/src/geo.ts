/**
 * Geographic value objects (Phase 3 P3.2; E06/B03; docs/phase3/PHASE3_ARCHITECTURE.md §3.1). Pure and I/O-free, so
 * both the API and the mobile app may use them; no business rule lives here (zones, service areas and pricing stay in
 * server-only modules).
 *
 *  - `Coordinates`: WGS84 point, finite and in range, normalised to 6 decimals (~0.1 m). `roundTo(n)` produces the
 *    coarser points the geo gateway uses for cache keys and provider requests (4 decimals ≈ 11 m, 2 decimals ≈ 1.1 km).
 *  - `inPakistanEnvelope`: the coarse national bounding box (lat 23.5–37.2, lng 60.8–77.9) — a plausibility gate, not a
 *    border; service areas are decided by the catalog's zone sets.
 *  - polyline codec: the widely documented "encoded polyline" format at precision 5, implemented in-house (no
 *    dependency). The decoder is bounded (maximum input length, value width and point count) and every malformed input
 *    raises a typed `GeoError`; it never loops on hostile input. `simplifyPolyline` keeps the first and last point and
 *    bounds the encoded size (default 2,048 bytes) for storage and responses.
 */

export type GeoErrorReason = 'NOT_FINITE' | 'OUT_OF_RANGE' | 'INVALID_PRECISION' | 'POLYLINE_MALFORMED' | 'POLYLINE_TOO_LONG';

export class GeoError extends Error {
  override readonly name = 'GeoError';
  constructor(
    readonly reason: GeoErrorReason,
    message: string = reason,
  ) {
    super(message);
  }
}

export interface LatLngLike {
  readonly lat: number;
  readonly lng: number;
}

const MAX_DECIMALS = 6;

/** Rounds half away from zero to `decimals` (0..6); never returns -0. */
export function roundCoordinate(value: number, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS)
    throw new GeoError('INVALID_PRECISION', `decimals must be 0..${String(MAX_DECIMALS)}`);
  if (!Number.isFinite(value)) throw new GeoError('NOT_FINITE');
  const factor = 10 ** decimals;
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** The coarse Pakistan envelope (inclusive). */
export const PAKISTAN_ENVELOPE = Object.freeze({ minLat: 23.5, maxLat: 37.2, minLng: 60.8, maxLng: 77.9 });

export function inPakistanEnvelope(point: LatLngLike): boolean {
  return (
    point.lat >= PAKISTAN_ENVELOPE.minLat &&
    point.lat <= PAKISTAN_ENVELOPE.maxLat &&
    point.lng >= PAKISTAN_ENVELOPE.minLng &&
    point.lng <= PAKISTAN_ENVELOPE.maxLng
  );
}

/** A validated WGS84 point (≤ 6 decimals). */
export class Coordinates implements LatLngLike {
  private constructor(
    readonly lat: number,
    readonly lng: number,
  ) {}

  /** Validates (finite, lat −90..90, lng −180..180) and normalises to 6 decimals. */
  static of(lat: number, lng: number): Coordinates {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new GeoError('NOT_FINITE', 'coordinates must be finite numbers');
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new GeoError('OUT_OF_RANGE', 'coordinates out of the WGS84 range');
    return new Coordinates(roundCoordinate(lat, MAX_DECIMALS), roundCoordinate(lng, MAX_DECIMALS));
  }

  static from(point: LatLngLike): Coordinates {
    return Coordinates.of(point.lat, point.lng);
  }

  /** The same point rounded to `decimals` (0..6). */
  roundTo(decimals: number): Coordinates {
    return new Coordinates(roundCoordinate(this.lat, decimals), roundCoordinate(this.lng, decimals));
  }

  /** The ~1.1 km cell (2 decimals) used for autocomplete bias and coarse analytics. */
  coarseCell(): Coordinates {
    return this.roundTo(2);
  }

  inPakistanEnvelope(): boolean {
    return inPakistanEnvelope(this);
  }

  equals(other: LatLngLike): boolean {
    return this.lat === other.lat && this.lng === other.lng;
  }

  toJSON(): { lat: number; lng: number } {
    return { lat: this.lat, lng: this.lng };
  }
}

// ── encoded polyline (precision 5) ─────────────────────────────────────────────────────────────────────────────────

const POLYLINE_PRECISION = 5;
const POLYLINE_FACTOR = 10 ** POLYLINE_PRECISION;
/** Default decoder bound: far above any simplified route (≤ 2,048 bytes), small enough to bound CPU and memory. */
export const POLYLINE_MAX_DECODE_LENGTH = 16_384;
/** A single coordinate delta never needs more than 7 five-bit chunks (|value| < 2^34 covers every valid delta). */
const MAX_CHUNKS_PER_VALUE = 7;
/** Default simplification bound for stored/returned geometry (threat model T3-21). */
export const POLYLINE_MAX_ENCODED_BYTES = 2048;
/** Inputs larger than this are refused instead of simplified (bounded CPU). */
export const POLYLINE_MAX_INPUT_POINTS = 100_000;

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/** Encodes points (each validated) at precision 5. An empty list encodes to the empty string. */
export function encodePolyline(points: readonly LatLngLike[]): string {
  let prevLat = 0;
  let prevLng = 0;
  let out = '';
  for (const p of points) {
    const c = Coordinates.from(p);
    const lat = Math.round(c.lat * POLYLINE_FACTOR);
    const lng = Math.round(c.lng * POLYLINE_FACTOR);
    out += encodeSigned(lat - prevLat) + encodeSigned(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

/**
 * Decodes an encoded polyline. Throws `GeoError` (`POLYLINE_TOO_LONG` above `maxLength` characters,
 * `POLYLINE_MALFORMED` for characters outside the alphabet, a truncated value, an over-wide value, a dangling latitude
 * or a decoded point outside the WGS84 range). Runs in O(length) and never hangs.
 */
export function decodePolyline(encoded: string, maxLength: number = POLYLINE_MAX_DECODE_LENGTH): Array<{ lat: number; lng: number }> {
  if (encoded.length > maxLength) throw new GeoError('POLYLINE_TOO_LONG');
  const values: number[] = [];
  let index = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let chunks = 0;
    let terminated = false;
    while (index < encoded.length) {
      const code = encoded.charCodeAt(index++) - 63;
      if (code < 0 || code > 63) throw new GeoError('POLYLINE_MALFORMED', 'character outside the polyline alphabet');
      if (++chunks > MAX_CHUNKS_PER_VALUE) throw new GeoError('POLYLINE_MALFORMED', 'value too wide');
      result += (code & 0x1f) * 2 ** shift;
      shift += 5;
      if (code < 0x20) {
        terminated = true;
        break;
      }
    }
    if (!terminated) throw new GeoError('POLYLINE_MALFORMED', 'truncated value');
    values.push(result % 2 === 1 ? -(Math.floor(result / 2) + 1) : result / 2);
  }
  if (values.length % 2 !== 0) throw new GeoError('POLYLINE_MALFORMED', 'dangling latitude');
  const points: Array<{ lat: number; lng: number }> = [];
  let lat = 0;
  let lng = 0;
  for (let i = 0; i < values.length; i += 2) {
    lat += values[i] ?? 0;
    lng += values[i + 1] ?? 0;
    const p = { lat: lat / POLYLINE_FACTOR, lng: lng / POLYLINE_FACTOR };
    if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) throw new GeoError('POLYLINE_MALFORMED', 'decoded point out of range');
    points.push(p);
  }
  return points;
}

/** Perpendicular distance of `p` from segment a–b in a local planar approximation (degrees, longitude scaled). */
function segmentDistance(p: LatLngLike, a: LatLngLike, b: LatLngLike): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const ax = a.lng * k;
  const bx = b.lng * k;
  const px = p.lng * k;
  const dx = bx - ax;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (p.lat - a.lat) * dy) / len2));
  const cx = ax + t * dx - px;
  const cy = a.lat + t * dy - p.lat;
  return Math.sqrt(cx * cx + cy * cy);
}

/** Iterative Douglas–Peucker (no recursion depth risk); first and last point are always kept. */
function douglasPeucker(points: readonly LatLngLike[], tolerance: number): LatLngLike[] {
  const n = points.length;
  if (n <= 2) return [...points];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() ?? [0, 0];
    const a = points[start];
    const b = points[end];
    if (!a || !b || end - start < 2) continue;
    let maxDistance = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      if (!p) continue;
      const d = segmentDistance(p, a, b);
      if (d > maxDistance) {
        maxDistance = d;
        maxIndex = i;
      }
    }
    if (maxIndex > 0 && maxDistance > tolerance) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Simplifies a route so its encoded form fits `maxEncodedBytes` (the encoding is ASCII, one byte per character).
 * Keeps the first and last point; increases the tolerance geometrically until the result fits (at worst only the two
 * endpoints remain). Inputs above POLYLINE_MAX_INPUT_POINTS are refused (`POLYLINE_TOO_LONG`).
 */
export function simplifyPolyline(points: readonly LatLngLike[], maxEncodedBytes: number = POLYLINE_MAX_ENCODED_BYTES): Array<{ lat: number; lng: number }> {
  if (points.length > POLYLINE_MAX_INPUT_POINTS) throw new GeoError('POLYLINE_TOO_LONG');
  if (!Number.isInteger(maxEncodedBytes) || maxEncodedBytes < 32) throw new GeoError('INVALID_PRECISION', 'maxEncodedBytes must be an integer ≥ 32');
  const normalised = points.map((p) => Coordinates.from(p).roundTo(POLYLINE_PRECISION).toJSON());
  let candidate: LatLngLike[] = normalised;
  // 1e-6° ≈ 0.1 m; doubling 40 times exceeds the globe, so the loop always ends with at most the two endpoints.
  for (let tolerance = 1e-6, i = 0; encodePolyline(candidate).length > maxEncodedBytes && i < 40; tolerance *= 2, i++) {
    candidate = douglasPeucker(normalised, tolerance);
  }
  if (encodePolyline(candidate).length > maxEncodedBytes) {
    const first = normalised[0];
    const last = normalised[normalised.length - 1];
    candidate = first && last ? [first, last] : [];
  }
  return candidate.map((p) => ({ lat: p.lat, lng: p.lng }));
}
