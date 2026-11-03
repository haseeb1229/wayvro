// Desk wrong-way / private-access review of OSRM routes against the OSM extract the router was built from.
// usage: node oneway-check.mjs <restrictions.jsonl> <desk.csv> <osrm base url> <out.json>
// For every ROUTE leg: OSRM /route with annotations=nodes (OSM node ids along the route); each consecutive node pair
// is checked against one-way ways (oneway=yes/1/true/-1, junction=roundabout|circular unless oneway=no) and
// access=private/no ways (unless motor_vehicle/motorcar/vehicle=yes|destination). Local self-hosted OSRM only.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , opl, csvPath, base, out] = process.argv;
if (!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(base)) throw new Error('local OSRM only');
const forbidden = new Map(); // "a>b" -> way id (travel a->b is against the one-way)
const privateEdge = new Map(); // "a>b" both directions -> way id
let oneways = 0,
  privates = 0;
for (const line of readFileSync(opl, 'utf8').split(/\r?\n/)) {
  if (line.trim() === '') continue;
  const w = JSON.parse(line);
  const id = String(w.id);
  const tags = w.tags;
  const nodes = w.nodes.map(String);
  if (tags.highway === undefined) continue;
  const ow = tags.oneway;
  const roundabout = tags.junction === 'roundabout' || tags.junction === 'circular';
  const forward = ow === 'yes' || ow === '1' || ow === 'true' || (roundabout && ow !== 'no' && ow !== '-1');
  const backward = ow === '-1' || ow === 'reverse';
  if (forward || backward) oneways++;
  const motorOk = ['yes', 'destination', 'permissive', 'designated'].includes(tags.motor_vehicle ?? tags.motorcar ?? tags.vehicle ?? '');
  const isPrivate = (tags.access === 'private' || tags.access === 'no') && !motorOk;
  if (isPrivate) privates++;
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1],
      b = nodes[i];
    if (forward) forbidden.set(`${b}>${a}`, id);
    if (backward) forbidden.set(`${a}>${b}`, id);
    if (isPrivate) {
      privateEdge.set(`${a}>${b}`, id);
      privateEdge.set(`${b}>${a}`, id);
    }
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [],
    f = '',
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(f);
      f = '';
    } else if (c === '\n') {
      row.push(f.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      f = '';
    } else f += c;
  }
  if (f !== '' || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows;
}
const [header, ...rows] = parseCsv(readFileSync(csvPath, 'utf8'));
const col = (r, name) => r[header.indexOf(name)];
const pts = new Map(
  rows.filter((r) => col(r, 'case_kind') === 'POINT').map((r) => [col(r, 'case_id'), [col(r, 'true_point_lng_5dp'), col(r, 'true_point_lat_5dp')]]),
);
const result = { oneWayWays: oneways, privateWays: privates, legs: [] };
for (const r of rows.filter((x) => col(x, 'case_kind') === 'ROUTE')) {
  const o = pts.get(col(r, 'route_origin_case_id')),
    d = pts.get(col(r, 'route_dest_case_id'));
  const url = `${base.replace(/\/$/, '')}/route/v1/driving/${o.join(',')};${d.join(',')}?overview=false&annotations=nodes&alternatives=false&steps=false`;
  const res = await fetch(url);
  const body = await res.json();
  if (body.code !== 'Ok') {
    result.legs.push({ caseId: col(r, 'case_id'), status: body.code });
    continue;
  }
  const nodes = body.routes[0].legs.flatMap((l) => l.annotation.nodes.map(String));
  const wrong = new Set(),
    priv = new Set(),
    positions = [];
  for (let i = 1; i < nodes.length; i++) {
    const k = `${nodes[i - 1]}>${nodes[i]}`;
    if (forbidden.has(k)) wrong.add(forbidden.get(k));
    // private segments at the very start/end are destination access (OSRM car profile allows them there)
    if (privateEdge.has(k) && i > 3 && i < nodes.length - 3) {
      priv.add(privateEdge.get(k));
      positions.push(Math.round((100 * i) / nodes.length));
    }
  }
  result.legs.push({
    caseId: col(r, 'case_id'),
    status: 'Ok',
    nodePairs: nodes.length - 1,
    wrongWayWays: wrong.size,
    privateMidRouteWays: priv.size,
    privateWayIds: [...priv],
    privatePositionPct: positions.length === 0 ? null : [Math.min(...positions), Math.max(...positions)],
    wrongWayIds: [...wrong],
  });
}
writeFileSync(out, JSON.stringify(result, null, 2));
const summary = {
  oneWayWays: oneways,
  privateWays: privates,
  legs: result.legs.length,
  wrongWayLegs: result.legs.filter((l) => l.wrongWayWays > 0).length,
  privateLegs: result.legs.filter((l) => l.privateMidRouteWays > 0).length,
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
