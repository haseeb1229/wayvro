/**
 * PRIVACY BOUNDARY (protocol §5.2). This is the ONLY spike file allowed to read a position (test/privacy.test.ts
 * enforces it). The previous fix is held in memory inside one tracker instance per run, used solely to compute the
 * distance to the next fix, and never exported, logged, persisted or transmitted. Only the distance leaves this file.
 */
type LatLng = { readonly latitude: number; readonly longitude: number };

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class DeltaTracker {
  private previous: LatLng | null = null;

  /** Distance from the previous fix of this run (null for the first fix). The new fix replaces the old one. */
  next(coords: LatLng): number | null {
    const current: LatLng = { latitude: coords.latitude, longitude: coords.longitude };
    const d = this.previous === null ? null : distanceM(this.previous, current);
    this.previous = current;
    return d;
  }

  reset(): void {
    this.previous = null;
  }
}
