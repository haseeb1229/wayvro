/**
 * TEST-ONLY synthetic capture sheet and deterministic fake adapters (no provider, no field data). Points are round
 * synthetic coordinates around Lahore; names are "Synthetic …".
 */
import type {
  AutocompleteInput,
  GeoPoint,
  GeocodingPort,
  PlaceCandidate,
  PlacesAutocompletePort,
  ResolvedPlace,
  ReverseGeocodingPort,
  RouteInput,
  RouteResult,
  RoutingPort,
} from '@wayvro/provider-interfaces';
import { CAPTURE_COLUMNS, type CaptureColumn, DESK_NA_COLUMNS } from '../src/cases.js';
import type { Component } from '../src/components.js';
import { parseCsv, toCsv } from '../src/csv.js';

function syntheticPoint(i: number): GeoPoint {
  return { lat: 31.4 + i * 0.01, lng: 74.2 + i * 0.01 };
}

function row(values: Partial<Record<CaptureColumn, string>>): string[] {
  return CAPTURE_COLUMNS.map((c) => values[c] ?? '');
}

const POINT_CATS = ['C01', 'C02', 'C03', 'C04', 'C05', 'C08', 'C09', 'C10'] as const;
const ROUTE_CATS = ['C06', 'C07', 'C11', 'C12'] as const;

/** A valid synthetic sheet: `points` POINT cases and `routes` ROUTE legs chaining consecutive points. */
/** Urdu-script word built from code points (synthetic "مصنوعی", i.e. "synthetic"). */
const SYNTHETIC_URDU = String.fromCodePoint(0x0645, 0x0635, 0x0646, 0x0648, 0x0639, 0x06cc);

export function syntheticCsv(
  points = 8,
  routes = 4,
  overrides: Record<number, Partial<Record<CaptureColumn, string>>> = {},
  options: { urdu?: boolean } = {},
): string {
  const rows: string[][] = [[...CAPTURE_COLUMNS]];
  let n = 0;
  for (let i = 0; i < points; i++) {
    n += 1;
    const p = syntheticPoint(i);
    rows.push(
      row({
        case_id: `LHR-SP04-${String(n).padStart(3, '0')}`,
        case_kind: 'POINT',
        category: POINT_CATS[i % POINT_CATS.length] ?? 'C01',
        session_id: 'LHR-SP04-S1',
        date: '2026-10-20',
        time_local: '11:00',
        query_text_en: `Synthetic Place ${i}`,
        query_text_roman_urdu: `Synthetic Jagah ${i}`,
        query_text_urdu: options.urdu === true ? `${SYNTHETIC_URDU} ${i}` : '',
        true_place_name: `Synthetic Place ${i}`,
        true_point_lat_5dp: p.lat.toFixed(5),
        true_point_lng_5dp: p.lng.toFixed(5),
        gps_accuracy_m: '5',
        is_public_place: 'Y',
        pickup_instruction_text: `Synthetic gate ${i}`,
        reverse_geocode_expected_area: `Synthetic Area ${i}`,
        captured_by: 'FOUNDER',
        case_status: 'CAPTURED',
        ...overrides[n],
      }),
    );
  }
  for (let j = 0; j < routes; j++) {
    n += 1;
    rows.push(
      row({
        case_id: `LHR-SP04-${String(n).padStart(3, '0')}`,
        case_kind: 'ROUTE',
        category: ROUTE_CATS[j % ROUTE_CATS.length] ?? 'C06',
        session_id: j === routes - 1 ? 'LHR-SP04-S4' : 'LHR-SP04-S3',
        date: '2026-10-21',
        time_local: '11:30',
        traffic_level: 'MODERATE',
        route_origin_case_id: `LHR-SP04-${String(j + 1).padStart(3, '0')}`,
        route_dest_case_id: `LHR-SP04-${String(j + 2).padStart(3, '0')}`,
        odometer_km: '10.0',
        actual_drive_minutes: '20',
        followed_natural_route: 'Y',
        constraint_observed: 'ONE_WAY',
        captured_by: 'PASSENGER_HELPER',
        case_status: 'CAPTURED',
        ...overrides[n],
      }),
    );
  }
  return toCsv(rows);
}

const offset = (p: GeoPoint, metres: number): GeoPoint => ({ lat: p.lat + metres / 111_195, lng: p.lng });
const components = (name: string) => ({ name, block: null, society: null, area: 'Synthetic Area', city: 'Lahore', nameUrdu: null });

/** Behaviour knobs for the fake bundle. */
export interface FakeBehaviour {
  /** Distance (m) of the "correct" autocomplete/geocode answer from the truth (≤ 50 ⇒ hit). */
  readonly answerOffsetM: number;
  /** Provider route distance as a multiple of the straight-line distance used as D_true in tests. */
  readonly routeDistanceFactor: number;
  /** Provider duration as a multiple of the actual drive time (20 min in the synthetic sheet). */
  readonly routeDurationFactor: number;
}

/** Deterministic fake components for one bundle, keyed by query text → truth. */
export function fakeComponents(
  bundle: 'S1' | 'S2' | 'S3',
  truthByQuery: ReadonlyMap<string, GeoPoint>,
  behaviour: FakeBehaviour,
  odometerM = 10_000,
): Component[] {
  const find = (text: string): GeoPoint | undefined => {
    for (const [q, p] of truthByQuery) if (q.startsWith(text) || text.startsWith(q)) return p;
    return undefined;
  };
  const resolved = new Map<string, GeoPoint>();
  const suggest: PlacesAutocompletePort = {
    suggest(input: AutocompleteInput): Promise<readonly PlaceCandidate[]> {
      const truth = find(input.text);
      if (truth === undefined) return Promise.resolve([]);
      resolved.set(`decoy-${input.text}`, offset(truth, 900));
      resolved.set(`good-${input.text}`, offset(truth, behaviour.answerOffsetM));
      return Promise.resolve([
        { providerPlaceId: `decoy-${input.text}`, components: components('Decoy'), kind: 'LANDMARK' },
        { providerPlaceId: `good-${input.text}`, components: components('Synthetic'), kind: 'LANDMARK' },
      ]);
    },
  };
  const geocoding: GeocodingPort = {
    geocode(input): Promise<readonly ResolvedPlace[]> {
      const truth = find(input.text);
      return Promise.resolve(
        truth === undefined
          ? []
          : [{ point: offset(truth, behaviour.answerOffsetM), components: components('Synthetic'), kind: 'LANDMARK', confidence: 'HIGH' }],
      );
    },
    resolve(input): Promise<ResolvedPlace> {
      const point = resolved.get(input.providerPlaceId);
      if (point === undefined) return Promise.reject(new Error('unknown synthetic id'));
      return Promise.resolve({ point, components: components('Synthetic'), kind: 'LANDMARK', confidence: 'HIGH' });
    },
  };
  const reverse: ReverseGeocodingPort = {
    reverse(): Promise<ResolvedPlace | null> {
      return Promise.resolve({ point: { lat: 31.5, lng: 74.3 }, components: components('Synthetic'), kind: 'AREA', confidence: 'UNKNOWN' });
    },
  };
  const routing: RoutingPort = {
    route(input: RouteInput): Promise<RouteResult> {
      return Promise.resolve({
        distanceM: Math.round(odometerM * behaviour.routeDistanceFactor),
        durationS: Math.round(20 * 60 * behaviour.routeDurationFactor),
        geometry: [input.origin, input.destination],
        confidence: 'UNKNOWN',
      });
    },
  };
  const id = (s: string) => `${bundle}-${s}`;
  return [
    {
      id: id('ac'),
      bundle,
      kind: 'AUTOCOMPLETE',
      mode: 'suggest-resolve',
      suggest,
      resolver: geocoding,
      suggestBucket: null,
      resolveBucket: null,
      sessionBilled: false,
    },
    { id: id('geo'), bundle, kind: 'GEOCODE', adapter: geocoding, bucket: null },
    { id: id('rev'), bundle, kind: 'REVERSE_GEOCODE', adapter: reverse, bucket: null },
    { id: id('route'), bundle, kind: 'ROUTE', adapter: routing, bucket: null },
  ];
}

/** The synthetic sheet as a DESK_OSM sheet: LHR-DESK ids/sessions, captured_by DESK_OSM, field-only columns N/A. */
export function deskCsv(points = 8, routes = 4): string {
  const [header = [], ...rows] = parseCsv(syntheticCsv(points, routes).replaceAll('LHR-SP04-', 'LHR-DESK-'));
  const na = new Set<string>(DESK_NA_COLUMNS);
  return toCsv([header, ...rows.map((r) => r.map((v, i) => (na.has(header[i] ?? '') ? 'N/A' : header[i] === 'captured_by' ? 'DESK_OSM' : v)))]);
}
