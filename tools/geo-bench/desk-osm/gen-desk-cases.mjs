// DESK — NOT FIELD (LOCAL_SYNTHETIC_BENCHMARK). Generates the DESK_OSM working CSV (git-ignored .local/input/) from the
// named-feature export of export.py. Expected points are OSM feature points (polygon vertex mean, line midpoint); queries
// are the OSM name plus desk-written Roman-Urdu/misspelt aliases (specs.mjs); Urdu only where OSM has name:ur.
// usage: node gen-desk-cases.mjs <lahore-named.geojsonseq> <out.csv> <match-report.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { POINTS, ROUTES } from './specs.mjs';

const [, , input, outCsv, outReport] = process.argv;
const COLUMNS = [
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
];
const NA_COLS = [
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

const features = [];
for (const line of readFileSync(input, 'utf8').split('\n')) {
  const t = line.trim();
  if (t === '') continue;
  const f = JSON.parse(t);
  if (f.properties?.name === undefined && f.properties?.['name:en'] === undefined) continue;
  features.push(f);
}

function rings(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0]);
  return [];
}
function repPoint(geom) {
  if (geom.type === 'Point') return geom.coordinates;
  if (geom.type === 'LineString') return geom.coordinates[Math.floor(geom.coordinates.length / 2)];
  const rs = rings(geom);
  const ring = rs.sort((a, b) => b.length - a.length)[0];
  let x = 0,
    y = 0;
  for (const [lng, lat] of ring) {
    x += lng;
    y += lat;
  }
  return [x / ring.length, y / ring.length];
}
function inside([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function bboxArea(ring) {
  const xs = ring.map((p) => p[0]),
    ys = ring.map((p) => p[1]);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}
const AREA_PLACES = new Set(['suburb', 'neighbourhood', 'quarter', 'city_block', 'borough']);
const areas = features.filter((f) => (AREA_PLACES.has(f.properties.place) || f.properties.landuse === 'residential') && rings(f.geometry).length > 0);
const nameOf = (f) => f.properties['name:en'] ?? f.properties.name;

const TAG_PREF = [
  'amenity',
  'shop',
  'tourism',
  'healthcare',
  'aeroway',
  'railway',
  'historic',
  'leisure',
  'building',
  'place',
  'highway',
  'landuse',
  'boundary',
];
function score(f, spec) {
  const p = f.properties;
  if (spec.tag !== undefined && p[spec.tag[0]] !== spec.tag[1]) return -1;
  let s = 0;
  const i = TAG_PREF.findIndex((k) => p[k] !== undefined);
  s += i === -1 ? 0 : 20 - i;
  if (f.geometry.type !== 'Point') s += 2;
  if (p['name:ur'] !== undefined) s += 1;
  return s;
}

const report = { matched: [], unmatched: [] };
const rows = [COLUMNS];
const keyToId = new Map();
let n = 0;
const id = () => `LHR-DESK-${String(++n).padStart(3, '0')}`;
const fmt = (v) => v.toFixed(5);
for (const spec of POINTS) {
  const candidates = features.filter((f) => spec.re.test(f.properties.name ?? '') || spec.re.test(f.properties['name:en'] ?? ''));
  const best = candidates
    .map((f) => ({ f, s: score(f, spec) }))
    .filter((c) => c.s >= 0)
    .sort((a, b) => b.s - a.s)[0];
  if (best === undefined) {
    report.unmatched.push(spec.key);
    continue;
  }
  const f = best.f;
  const [lng, lat] = repPoint(f.geometry);
  if (!(lat > 31.25 && lat < 31.72 && lng > 74.1 && lng < 74.62)) {
    report.unmatched.push(`${spec.key} (outside bbox)`);
    continue;
  }
  const name = nameOf(f);
  const containing = areas
    .filter((a) => a !== f && rings(a.geometry).some((r) => inside([lng, lat], r)))
    .sort((a, b) => bboxArea(rings(a.geometry)[0]) - bboxArea(rings(b.geometry)[0]))
    .map(nameOf)
    .filter((v) => v !== undefined && v !== name)
    .slice(0, 2);
  const caseId = id();
  keyToId.set(spec.key, caseId);
  const tags = Object.entries(f.properties)
    .filter(([k]) => TAG_PREF.includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .slice(0, 2)
    .join(' ');
  const r = Object.fromEntries(COLUMNS.map((c) => [c, '']));
  Object.assign(r, {
    case_id: caseId,
    case_kind: 'POINT',
    category: spec.cat,
    session_id: 'LHR-DESK-S0',
    query_text_en: spec.en ?? name,
    query_text_roman_urdu: spec.ru,
    query_text_urdu: f.properties['name:ur'] ?? '',
    true_place_name: name,
    true_point_lat_5dp: fmt(lat),
    true_point_lng_5dp: fmt(lng),
    is_public_place: 'Y',
    reverse_geocode_expected_area: [name, ...containing].join('|'),
    notes_no_pii: `DESK_OSM ${f.properties['@type']} ${tags}`.trim(),
    captured_by: 'DESK_OSM',
    case_status: 'CAPTURED',
  });
  for (const c of NA_COLS) r[c] = 'N/A';
  rows.push(COLUMNS.map((c) => r[c]));
  report.matched.push({
    key: spec.key,
    cat: spec.cat,
    caseId,
    osm: `${f.properties['@type']}/${f.properties['@id']}`,
    geom: f.geometry.type,
    urdu: f.properties['name:ur'] !== undefined,
    containing: containing.length,
    candidates: candidates.length,
  });
}
for (const leg of ROUTES) {
  const from = keyToId.get(leg.from),
    to = keyToId.get(leg.to);
  if (from === undefined || to === undefined) {
    report.unmatched.push(`route ${leg.from}->${leg.to}`);
    continue;
  }
  const r = Object.fromEntries(COLUMNS.map((c) => [c, '']));
  Object.assign(r, {
    case_id: id(),
    case_kind: 'ROUTE',
    category: leg.cat,
    session_id: 'LHR-DESK-S0',
    route_origin_case_id: from,
    route_dest_case_id: to,
    constraint_observed: leg.cat === 'C12' ? 'DESK_ONE_WAY_OR_UTURN_AREA' : '',
    notes_no_pii: `DESK_OSM leg ${leg.from}->${leg.to}`,
    captured_by: 'DESK_OSM',
    case_status: 'CAPTURED',
  });
  for (const c of NA_COLS) r[c] = 'N/A';
  rows.push(COLUMNS.map((c) => r[c]));
}
const esc = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
writeFileSync(outCsv, `${rows.map((r) => r.map(esc).join(',')).join('\n')}\n`);
writeFileSync(outReport, JSON.stringify(report, null, 2));
process.stdout.write(
  `points ${report.matched.length}, routes ${rows.length - 1 - report.matched.length}, unmatched ${report.unmatched.length}: ${report.unmatched.join(', ')}\n`,
);
