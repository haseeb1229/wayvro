/**
 * GPX track reading for SP-04 D_true (§6: GPX track length after dropping points with accuracy > 25 m).
 *
 * GPX 1.1 has no standard accuracy element; loggers write it in extensions. Conservative reading: a track point is
 * dropped when it carries a child element whose local name contains "accuracy" (e.g. `<acc:accuracy>`,
 * `<horizontalAccuracy>`) with a value above 25 m. Points without such an element are kept (the founder's logger
 * shows accuracy live; §4.4 retakes POINT fixes above 10 m). One GPX file per ROUTE leg is expected.
 */
import type { GeoPoint } from '@wayvro/provider-interfaces';
import type { RouteCase } from './cases.js';
import { pathLengthM } from './geo.js';

/** @internal exported for unit tests */
export const GPX_MAX_ACCURACY_M = 25;
const TRKPT = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
const ATTR = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`);
const ACCURACY = /<(?:[\w-]+:)?[\w-]*accuracy[\w-]*\b[^>]*>\s*([\d.]+)\s*</i;

export interface GpxTrack {
  readonly points: readonly GeoPoint[];
  readonly dropped: number;
}

export function parseGpx(xml: string): GpxTrack {
  const points: GeoPoint[] = [];
  let dropped = 0;
  for (const m of xml.matchAll(TRKPT)) {
    const attrs = m[1] ?? '';
    const lat = Number(ATTR('lat').exec(attrs)?.[1]);
    const lng = Number(ATTR('lon').exec(attrs)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      dropped++;
      continue;
    }
    const accuracy = ACCURACY.exec(m[2] ?? '')?.[1];
    if (accuracy !== undefined && Number(accuracy) > GPX_MAX_ACCURACY_M) {
      dropped++;
      continue;
    }
    points.push({ lat, lng });
  }
  return { points, dropped };
}

/** @internal exported for unit tests */
export function gpxLengthM(track: GpxTrack): number | null {
  return track.points.length < 2 ? null : pathLengthM(track.points);
}

/** GPX vs odometer tolerance (§6): beyond it the leg is flagged and reported separately. */
const GPX_ODOMETER_TOLERANCE = 0.05;

export interface LegTruth {
  readonly distanceM: number;
  readonly source: 'GPX' | 'ODOMETER';
  /** GPX vs odometer differ by more than 5 % (§6): excluded from the gating distance metric, reported separately. */
  readonly flagged: boolean;
  readonly track: readonly GeoPoint[] | null;
}

/** D_true per ROUTE case: GPX length when a track is supplied (cross-checked with the odometer), else the odometer. */
export function legTruths(routes: readonly RouteCase[], tracks: ReadonlyMap<string, GpxTrack>): Map<string, LegTruth> {
  const out = new Map<string, LegTruth>();
  for (const leg of routes) {
    const odometerM = leg.odometerKm * 1000;
    const track = tracks.get(leg.id);
    const gpxM = track === undefined ? null : gpxLengthM(track);
    if (track !== undefined && gpxM !== null) {
      out.set(leg.id, { distanceM: gpxM, source: 'GPX', flagged: Math.abs(gpxM - odometerM) / odometerM > GPX_ODOMETER_TOLERANCE, track: track.points });
    } else {
      out.set(leg.id, { distanceM: odometerM, source: 'ODOMETER', flagged: false, track: null });
    }
  }
  return out;
}
