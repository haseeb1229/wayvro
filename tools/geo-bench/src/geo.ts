/**
 * Distance helpers exactly as SP-04 §6 defines them: haversine with mean Earth radius R = 6,371,008.8 m.
 */
import type { GeoPoint } from '@wayvro/provider-interfaces';

/** @internal exported for unit tests */
export const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

/** d = 2R · asin( sqrt( sin²(Δφ/2) + cos phi1 · cos phi2 · sin²(Δλ/2) ) ). */
export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const phi1 = a.lat * RAD;
  const phi2 = b.lat * RAD;
  const dPhi = (b.lat - a.lat) * RAD;
  const dLambda = (b.lng - a.lng) * RAD;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Sum of haversine segment lengths. */
export function pathLengthM(points: readonly GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1] as GeoPoint, points[i] as GeoPoint);
  return total;
}

/** Distance from p to segment ab (local equirectangular projection; accurate at the 30 m scale used here). */
function pointToSegmentM(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const k = Math.cos(p.lat * RAD) * EARTH_RADIUS_M * RAD;
  const kLat = EARTH_RADIUS_M * RAD;
  const ax = (a.lng - p.lng) * k;
  const ay = (a.lat - p.lat) * kLat;
  const bx = (b.lng - p.lng) * k;
  const by = (b.lat - p.lat) * kLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Share (0–1) of `route` vertices within `toleranceM` of the `track` polyline (SP-04 corridor overlap, informational). */
export function corridorOverlap(route: readonly GeoPoint[], track: readonly GeoPoint[], toleranceM = 30): number | null {
  if (route.length === 0 || track.length < 2) return null;
  let inside = 0;
  for (const v of route) {
    for (let i = 1; i < track.length; i++) {
      if (pointToSegmentM(v, track[i - 1] as GeoPoint, track[i] as GeoPoint) <= toleranceM) {
        inside++;
        break;
      }
    }
  }
  return inside / route.length;
}

/** Linear-interpolated percentile (p in 0–100) of a non-empty list; null for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (rank - lo);
}
