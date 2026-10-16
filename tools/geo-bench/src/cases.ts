/**
 * Capture-sheet validation (docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md §2 and
 * docs/phase3/PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv). The header must equal the template exactly. Errors block a run;
 * warnings are shown to the founder. Messages name the row, case id and field — never the field's content.
 */
import type { GeoPoint } from '@wayvro/provider-interfaces';
import { inPakistan } from '@wayvro/geo-adapters';
import { parseCsv } from './csv.js';
import { scanForPii } from './pii.js';

/** Template columns, in order (PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv). */
/** @internal exported for unit tests */
export const CAPTURE_COLUMNS = [
  'case_id',
  'case_kind',
  'category',
  'session_id',
  'date',
  'time_local',
  'traffic_level',
  'query_text_en',
  'query_text_roman_urdu',
  'query_text_urdu',
  'true_place_name',
  'true_point_lat_5dp',
  'true_point_lng_5dp',
  'gps_accuracy_m',
  'is_public_place',
  'pickup_instruction_text',
  'reverse_geocode_expected_area',
  'route_origin_case_id',
  'route_dest_case_id',
  'odometer_km',
  'actual_drive_minutes',
  'followed_natural_route',
  'constraint_observed',
  'gpx_file_ref',
  'photo_ref_local',
  'notes_no_pii',
  'captured_by',
  'case_status',
] as const;
/** @internal exported for unit tests */
export type CaptureColumn = (typeof CAPTURE_COLUMNS)[number];

/** Free-text columns scanned for personal data (and never copied into aggregated output). */
const FREE_TEXT_COLUMNS: readonly CaptureColumn[] = [
  'query_text_en',
  'query_text_roman_urdu',
  'query_text_urdu',
  'true_place_name',
  'pickup_instruction_text',
  'reverse_geocode_expected_area',
  'constraint_observed',
  'gpx_file_ref',
  'photo_ref_local',
  'notes_no_pii',
];

export type Category = 'C01' | 'C02' | 'C03' | 'C04' | 'C05' | 'C06' | 'C07' | 'C08' | 'C09' | 'C10' | 'C11' | 'C12';
/** Categories whose primary kind is POINT (§2.2); a ROUTE leg may carry any category. */
const POINT_CATEGORIES: ReadonlySet<string> = new Set(['C01', 'C02', 'C03', 'C04', 'C05', 'C08', 'C09', 'C10']);
/** Categories whose ROUTE cases are judged for constraint plausibility (§6). */
export const CONSTRAINT_CATEGORIES: ReadonlySet<string> = new Set(['C06', 'C07', 'C11', 'C12']);
const MIN_PER_CATEGORY: Readonly<Record<Category, number>> = { C01: 5, C02: 5, C03: 5, C04: 4, C05: 4, C06: 3, C07: 4, C08: 4, C09: 5, C10: 4, C11: 3, C12: 4 };

export type QueryLanguage = 'en' | 'roman_urdu' | 'urdu';
type TrafficLevel = 'FREE' | 'MODERATE' | 'HEAVY' | 'STOP_GO';

/**
 * Where the cases come from. FIELD = the founder's SP-04 capture (the only source that can ever close FA-05/SP-04).
 * DESK_OSM = desk/open-data cases derived from an OpenStreetMap extract (LOCAL_SYNTHETIC_BENCHMARK only): ids
 * `LHR-DESK-NNN`, sessions `LHR-DESK-Sn`, `captured_by` = DESK_OSM and every field-only column literally `N/A` — no
 * GPS accuracy, drive time, odometer, traffic, GPX, photo or founder text is ever invented. The two sources never mix:
 * a desk row fails a FIELD validation and a field row fails a DESK_OSM validation.
 */
export type CaseSource = 'FIELD' | 'DESK_OSM';

/** Columns that only a field capture can fill; a DESK_OSM row must carry exactly `N/A` in each. */
/** @internal exported for unit tests */
export const DESK_NA_COLUMNS: readonly CaptureColumn[] = [
  'date',
  'time_local',
  'traffic_level',
  'gps_accuracy_m',
  'pickup_instruction_text',
  'odometer_km',
  'actual_drive_minutes',
  'followed_natural_route',
  'gpx_file_ref',
  'photo_ref_local',
];
const NA = 'N/A';

export interface PointCase {
  readonly id: string;
  readonly category: Category;
  readonly sessionId: string;
  readonly queries: Readonly<Partial<Record<QueryLanguage, string>>>;
  readonly truth: GeoPoint;
  /** What a useful reverse-geocode answer must mention (local only; never copied into aggregates). */
  readonly expectedArea: string;
}

/** Field-only values are null for DESK_OSM cases (never invented). */
export interface RouteCase {
  readonly id: string;
  readonly category: Category;
  readonly sessionId: string;
  readonly date: string | null;
  readonly timeLocal: string | null;
  readonly trafficLevel: TrafficLevel | null;
  readonly originId: string;
  readonly destId: string;
  readonly odometerKm: number | null;
  readonly actualMinutes: number | null;
  readonly followedNaturalRoute: boolean | null;
  /** Founder's constraint code (local only; never copied into aggregates). */
  readonly constraintObserved: string | null;
  readonly gpxFileRef: string | null;
}

interface Finding {
  readonly row: number;
  readonly caseId: string;
  readonly field: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly source: CaseSource;
  readonly points: readonly PointCase[];
  readonly routes: readonly RouteCase[];
  readonly errors: readonly Finding[];
  readonly warnings: readonly Finding[];
  /** Every non-empty free-text value (used only by the aggregate guard to prove none leaks into committed output). */
  readonly freeTextValues: readonly string[];
}

const IDS: Readonly<Record<CaseSource, { readonly caseId: RegExp; readonly session: RegExp; readonly caseHint: string; readonly sessionHint: string }>> = {
  FIELD: { caseId: /^LHR-SP04-\d{3}$/, session: /^LHR-SP04-S\d$/, caseHint: 'LHR-SP04-NNN', sessionHint: 'LHR-SP04-Sn' },
  DESK_OSM: { caseId: /^LHR-DESK-\d{3}$/, session: /^LHR-DESK-S\d$/, caseHint: 'LHR-DESK-NNN', sessionHint: 'LHR-DESK-Sn' },
};
const TRAFFIC: ReadonlySet<string> = new Set(['FREE', 'MODERATE', 'HEAVY', 'STOP_GO']);

function validDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

function decimal(value: string): number | null {
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : null;
}

/**
 * Validates the founder's working CSV (default, FIELD) or a desk sheet (`source: 'DESK_OSM'`). Never throws for
 * content problems: they are returned as findings.
 */
export function validateCapture(text: string, options: { readonly source?: CaseSource } = {}): ValidationResult {
  const source = options.source ?? 'FIELD';
  const desk = source === 'DESK_OSM';
  const ids = IDS[source];
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const freeTextValues: string[] = [];
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch {
    return {
      source,
      points: [],
      routes: [],
      errors: [{ row: 0, caseId: '-', field: '-', message: 'the file is not valid CSV (unterminated quote)' }],
      warnings,
      freeTextValues,
    };
  }
  const header = rows[0] ?? [];
  if (header.length !== CAPTURE_COLUMNS.length || header.some((h, i) => h.trim() !== CAPTURE_COLUMNS[i])) {
    return {
      source,
      points: [],
      routes: [],
      errors: [{ row: 1, caseId: '-', field: '-', message: 'header does not match PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv exactly' }],
      warnings,
      freeTextValues,
    };
  }

  type Row = Record<CaptureColumn, string> & { readonly rowNumber: number };
  const records: Row[] = [];
  rows.slice(1).forEach((fields, index) => {
    const rowNumber = index + 2;
    if (fields.every((f) => f.trim() === '')) return;
    if (fields.length !== CAPTURE_COLUMNS.length) {
      errors.push({ row: rowNumber, caseId: '-', field: '-', message: `expected ${CAPTURE_COLUMNS.length} fields, found ${fields.length}` });
      return;
    }
    const record = Object.fromEntries(CAPTURE_COLUMNS.map((c, i) => [c, (fields[i] ?? '').trim()])) as Record<CaptureColumn, string>;
    records.push({ ...record, rowNumber });
  });

  const seen = new Set<string>();
  const pointRows = new Map<string, Row>();
  const captured: Row[] = [];
  for (const r of records) {
    const id = r.case_id;
    const err = (field: string, message: string) => errors.push({ row: r.rowNumber, caseId: id || '-', field, message });
    const warn = (field: string, message: string) => warnings.push({ row: r.rowNumber, caseId: id || '-', field, message });
    // The template's synthetic rows carry upper-case EXAMPLE markers (case-sensitive: "for example" in a note is fine).
    if (Object.values(r).some((v) => typeof v === 'string' && /EXAMPLE/.test(v))) {
      err('-', 'EXAMPLE row present: the template rows are synthetic and must be deleted before use');
      continue;
    }
    if (!ids.caseId.test(id)) err('case_id', `must be ${ids.caseHint}`);
    else if (seen.has(id)) {
      err('case_id', 'duplicate case id');
      continue;
    }
    seen.add(id);
    for (const column of FREE_TEXT_COLUMNS) {
      const value = r[column];
      if (value === '') continue;
      freeTextValues.push(value);
      const kinds = scanForPii(value);
      if (kinds.length > 0) warn(column, `possible personal data (${kinds.join(', ')}) — review and remove before running`);
    }
    if (desk) {
      if (r.captured_by !== 'DESK_OSM') err('captured_by', 'a desk sheet accepts only DESK_OSM cases (field captures are validated without --desk)');
      for (const column of DESK_NA_COLUMNS) if (r[column] !== NA) err(column, 'field-only value: must be N/A in a desk sheet (never invented)');
    } else if (r.captured_by !== 'FOUNDER' && r.captured_by !== 'PASSENGER_HELPER') err('captured_by', 'must be FOUNDER or PASSENGER_HELPER');
    if (r.case_status === 'DISCARDED') {
      if (r.notes_no_pii === '') warn('notes_no_pii', 'DISCARDED case without a reason');
      continue;
    }
    if (r.case_status !== 'CAPTURED') {
      err('case_status', 'must be CAPTURED or DISCARDED');
      continue;
    }
    if (!/^C(0[1-9]|1[0-2])$/.test(r.category)) err('category', 'must be C01…C12');
    if (!ids.session.test(r.session_id)) err('session_id', `must be ${ids.sessionHint}`);
    if (!desk && !validDate(r.date)) err('date', 'must be a valid YYYY-MM-DD date');
    if (!desk && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time_local)) err('time_local', 'must be HH:MM (Asia/Karachi)');
    if (r.case_kind === 'POINT') {
      if (!POINT_CATEGORIES.has(r.category)) err('category', 'not a POINT category (C06/C07/C11/C12 are ROUTE categories)');
      if (r.is_public_place !== 'Y') err('is_public_place', 'must be Y: a non-public place is invalid and must be deleted');
      if (r.true_place_name === '') err('true_place_name', 'required for POINT cases');
      if (r.reverse_geocode_expected_area === '') err('reverse_geocode_expected_area', 'required for POINT cases');
      if (!desk && r.pickup_instruction_text === '') warn('pickup_instruction_text', 'missing pickup instruction');
      if (r.query_text_en === '' && r.query_text_roman_urdu === '' && r.query_text_urdu === '') err('query_text_en', 'at least one query text is required');
      const lat = decimal(r.true_point_lat_5dp);
      const lng = decimal(r.true_point_lng_5dp);
      if (lat === null || lng === null) err('true_point_lat_5dp', 'coordinates are required decimal numbers');
      else {
        if (!inPakistan({ lat, lng })) err('true_point_lat_5dp', 'coordinates are outside Pakistan');
        if (!/\.\d{5}$/.test(r.true_point_lat_5dp) || !/\.\d{5}$/.test(r.true_point_lng_5dp))
          warn('true_point_lat_5dp', 'coordinates should carry exactly 5 decimals');
      }
      // A desk point has no GPS fix (gps_accuracy_m = N/A, checked above).
      if (!desk) {
        const accuracy = decimal(r.gps_accuracy_m);
        if (accuracy === null || accuracy < 0) err('gps_accuracy_m', 'required non-negative number');
        else if (accuracy > 10) err('gps_accuracy_m', 'accuracy above 10 m: retake the point (§4.4)');
      }
      pointRows.set(id, r);
    } else if (r.case_kind === 'ROUTE' && desk) {
      if (r.route_origin_case_id === '' || r.route_dest_case_id === '') err('route_origin_case_id', 'origin and destination POINT case ids are required');
    } else if (r.case_kind === 'ROUTE') {
      if (!TRAFFIC.has(r.traffic_level)) err('traffic_level', 'must be FREE, MODERATE, HEAVY or STOP_GO');
      const odometer = decimal(r.odometer_km);
      if (odometer === null || odometer <= 0) err('odometer_km', 'required positive number');
      const minutes = decimal(r.actual_drive_minutes);
      if (minutes === null || minutes <= 0) err('actual_drive_minutes', 'required positive number');
      if (r.followed_natural_route !== 'Y' && r.followed_natural_route !== 'N') err('followed_natural_route', 'must be Y or N');
      if (r.followed_natural_route === 'N' && r.notes_no_pii === '') warn('notes_no_pii', 'diverted leg without a note');
      if (CONSTRAINT_CATEGORIES.has(r.category) && r.constraint_observed === '')
        warn('constraint_observed', 'constraint category without an observed constraint');
      if (r.route_origin_case_id === '' || r.route_dest_case_id === '') err('route_origin_case_id', 'origin and destination POINT case ids are required');
    } else {
      err('case_kind', 'must be POINT or ROUTE');
    }
    captured.push(r);
  }

  const points: PointCase[] = [];
  const routes: RouteCase[] = [];
  for (const r of captured) {
    if (r.case_kind === 'POINT') {
      const queries: Partial<Record<QueryLanguage, string>> = {};
      if (r.query_text_en !== '') queries.en = r.query_text_en;
      if (r.query_text_roman_urdu !== '') queries.roman_urdu = r.query_text_roman_urdu;
      if (r.query_text_urdu !== '') queries.urdu = r.query_text_urdu;
      points.push({
        id: r.case_id,
        category: r.category as Category,
        sessionId: r.session_id,
        queries,
        truth: { lat: Number(r.true_point_lat_5dp), lng: Number(r.true_point_lng_5dp) },
        expectedArea: r.reverse_geocode_expected_area,
      });
    } else if (r.case_kind === 'ROUTE') {
      for (const [field, ref] of [
        ['route_origin_case_id', r.route_origin_case_id],
        ['route_dest_case_id', r.route_dest_case_id],
      ] as const) {
        if (ref !== '' && !pointRows.has(ref))
          errors.push({ row: r.rowNumber, caseId: r.case_id, field, message: 'must reference a CAPTURED POINT case in this sheet' });
      }
      routes.push({
        id: r.case_id,
        category: r.category as Category,
        sessionId: r.session_id,
        date: desk ? null : r.date,
        timeLocal: desk ? null : r.time_local,
        trafficLevel: desk ? null : (r.traffic_level as TrafficLevel),
        originId: r.route_origin_case_id,
        destId: r.route_dest_case_id,
        odometerKm: desk ? null : Number(r.odometer_km),
        actualMinutes: desk ? null : Number(r.actual_drive_minutes),
        followedNaturalRoute: desk ? null : r.followed_natural_route === 'Y',
        constraintObserved: r.constraint_observed === '' ? null : r.constraint_observed,
        gpxFileRef: desk || r.gpx_file_ref === '' ? null : r.gpx_file_ref,
      });
    }
  }
  minimumWarnings(points, routes, warnings);
  return { source, points, routes, errors, warnings, freeTextValues };
}

/** §2.2/§2.3 completeness minimums: reported as warnings (the founder decides whether to capture more). */
function minimumWarnings(points: readonly PointCase[], routes: readonly RouteCase[], warnings: Finding[]): void {
  const warn = (message: string) => warnings.push({ row: 0, caseId: '-', field: '-', message });
  const total = points.length + routes.length;
  if (total < 50) warn(`only ${total} captured cases: SP-04 requires at least 50 (§2.2)`);
  const count = (cat: string) =>
    POINT_CATEGORIES.has(cat) ? points.filter((p) => p.category === cat).length : routes.filter((r) => r.category === cat).length;
  for (const [cat, min] of Object.entries(MIN_PER_CATEGORY)) {
    const n = count(cat);
    if (n < min) warn(`${cat}: ${n} case(s), minimum ${min} (§2.2)`);
  }
  if (routes.length < 20) warn(`${routes.length} ROUTE legs: minimum 20 (§2.3)`);
  const roman = points.filter((p) => p.queries.roman_urdu !== undefined).length;
  if (roman < 35) warn(`${roman} POINT cases with a Roman-Urdu query: minimum 35 (§2.3)`);
  const urdu = points.filter((p) => p.queries.urdu !== undefined).length;
  if (urdu < 20) warn(`${urdu} POINT cases with an Urdu-script query: minimum 20 (§2.3)`);
}
