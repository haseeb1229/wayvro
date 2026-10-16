/**
 * DESK_OSM analysis — LOCAL_SYNTHETIC_BENCHMARK (desk/open-data cases derived from an OpenStreetMap extract, NOT field
 * ground truth). It never closes FA-05/SP-04 and never freezes ADR-006/ADR-046: the expected points come from the same
 * OSM data an open-stack bundle is built from, so accuracy numbers are circular for S3 (they test plumbing, ranking and
 * route sanity, not real-world accuracy).
 *
 * What it adds to the field metrics (which stay PENDING where field data is required):
 *  - route sanity per leg exactly as the API applies it (T3-06, `apps/api/src/geo/routing.ts`): a distance shorter than
 *    the geodesic lower bound of the great-circle distance (+1 m) is physically impossible; longer than
 *    ROUTE_RATIO_OUTLIER_MAX (default 3.0) × great-circle ⇒ ratio outlier (LOW confidence). Values mirrored from
 *    `packages/domain` (`geodesicLowerBoundMeters` = mean-radius haversine × 6,335,439 / 6,371,008.8);
 *  - an automated desk route review (CRITICAL only for a physically impossible distance; MINOR for a ratio outlier;
 *    NONE otherwise; ERROR rows NOT_APPLICABLE) that feeds the unchanged §7.1 hard gate in `score`;
 *  - reverse-geocode expected-area string match (desk automation, NOT the §5.5 blind usefulness rating);
 *  - cold (first) vs warm (repeated identical request) latency, and per-component failure profiles with the
 *    circuit-breaker classification of each adapter error code (degraded-run evidence).
 * Every output is numbers, flags, enumerations and case ids — no coordinates, no names, no provider text.
 */
import { GeoAdapterError, type GeoAdapterErrorCode } from '@wayvro/geo-adapters';
import type { GeoPoint } from '@wayvro/provider-interfaces';
import type { ValidationResult } from './cases.js';
import { toCsv } from './csv.js';
import { haversineM, percentile } from './geo.js';
import type { RunRecord } from './runner.js';
import { REVIEW_COLUMNS } from './sheets.js';

export const DESK_STAMP =
  'DESK — NOT FIELD · LOCAL_SYNTHETIC_BENCHMARK (desk/open-data OSM cases; expected points come from OSM itself, so S3 accuracy is circular) · does not close FA-05/SP-04 · no ADR-006/ADR-046 freeze';

/** packages/domain geodesicLowerBoundMeters: the mean-radius great circle scaled to the minimum (polar) radius. */
const LOWER_BOUND_FACTOR = 6_335_439 / 6_371_008.8;
/** Providers report whole metres (apps/api routing.ts SHORTER_TOLERANCE_M). */
const SHORTER_TOLERANCE_M = 1;
/** apps/api config ROUTE_RATIO_OUTLIER_MAX default. */
const ROUTE_RATIO_OUTLIER_MAX = 3;

type SanityFlag = 'SHORTER_THAN_GREAT_CIRCLE' | 'ROUTE_RATIO_OUTLIER' | 'NO_DURATION';

/** T3-06 route sanity of one answered route. */
/** @internal exported for unit tests */
export function routeSanity(distanceM: number, durationS: number | null, origin: GeoPoint, destination: GeoPoint): SanityFlag[] {
  const flags: SanityFlag[] = [];
  const greatCircle = haversineM(origin, destination);
  if (distanceM + SHORTER_TOLERANCE_M < greatCircle * LOWER_BOUND_FACTOR) flags.push('SHORTER_THAN_GREAT_CIRCLE');
  if (greatCircle > 0 && distanceM > ROUTE_RATIO_OUTLIER_MAX * greatCircle) flags.push('ROUTE_RATIO_OUTLIER');
  if (durationS === null) flags.push('NO_DURATION');
  return flags;
}

interface DeskRouteRow {
  readonly caseId: string;
  readonly category: string;
  readonly component: string;
  readonly status: string;
  readonly distanceKm: number | null;
  readonly greatCircleKm: number;
  readonly ratio: number | null;
  readonly etaMin: number | null;
  readonly flags: readonly SanityFlag[];
}

/** One row per (ROUTE case, routing component) of the run. */
export function deskRouteRows(cases: ValidationResult, run: RunRecord): DeskRouteRow[] {
  const points = new Map(cases.points.map((p) => [p.id, p]));
  const legs = new Map(cases.routes.map((r) => [r.id, r]));
  const rows: DeskRouteRow[] = [];
  for (const r of run.routes) {
    const leg = legs.get(r.caseId);
    const origin = leg === undefined ? undefined : points.get(leg.originId);
    const dest = leg === undefined ? undefined : points.get(leg.destId);
    if (leg === undefined || origin === undefined || dest === undefined) continue;
    const greatCircle = haversineM(origin.truth, dest.truth);
    const distanceM = r.errorCode === null ? r.distanceM : null;
    const durationS = r.errorCode === null ? r.durationS : null;
    rows.push({
      caseId: r.caseId,
      category: leg.category,
      component: r.component,
      status: r.errorCode === null ? 'ROUTE' : `ERROR ${r.errorCode}`,
      distanceKm: distanceM === null ? null : distanceM / 1000,
      greatCircleKm: greatCircle / 1000,
      ratio: distanceM !== null && greatCircle > 0 ? distanceM / greatCircle : null,
      etaMin: distanceM !== null && durationS !== null ? durationS / 60 : null,
      flags: distanceM === null ? [] : routeSanity(distanceM, durationS, origin.truth, dest.truth),
    });
  }
  return rows;
}

/**
 * Automated desk route review in the `route-review.csv` format read by `score` (so the unchanged §7.1 hard gate runs on
 * it). It is NOT the field review: CRITICAL only where the distance is physically impossible (UNSAFE_OR_IMPOSSIBLE);
 * a ratio outlier is MINOR; a provider error is NOT_APPLICABLE; anything else NONE. A reviewer may overwrite rows
 * (e.g. a desk wrong-way finding) before scoring.
 */
export function deskReviewSheet(rows: readonly DeskRouteRow[]): string {
  const out: string[][] = [[...REVIEW_COLUMNS]];
  for (const r of rows) {
    const critical = r.flags.includes('SHORTER_THAN_GREAT_CIRCLE');
    const classification = r.status !== 'ROUTE' ? 'NOT_APPLICABLE' : critical ? 'CRITICAL' : r.flags.includes('ROUTE_RATIO_OUTLIER') ? 'MINOR' : 'NONE';
    out.push([
      r.caseId,
      r.component,
      r.category,
      ['C06', 'C07', 'C11', 'C12'].includes(r.category) ? 'Y' : 'N',
      r.status,
      ['DESK_AUTO', ...r.flags].join(' '),
      classification,
      critical ? 'UNSAFE_OR_IMPOSSIBLE' : '',
      critical ? 'N' : '',
      '',
    ]);
  }
  return toCsv(out);
}

const fold = (s: string) => s.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();

/** Desk reverse check: any `|`-separated expected string contained in the answer's name/block/area/city. */
/** @internal exported for unit tests */
export function areaMatches(expected: string, place: RunRecord['reverse'][number]['place']): boolean {
  if (place === null) return false;
  const answer = fold([place.name, place.block, place.area, place.city].filter((v): v is string => v !== null).join(' | '));
  return expected
    .split('|')
    .map(fold)
    .some((e) => e.length > 0 && answer.includes(e));
}

interface LatencyCell {
  readonly n: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
}

interface FailureProfile {
  readonly component: string;
  readonly calls: number;
  readonly errors: Readonly<Record<string, number>>;
  readonly breakerCountable: number;
  readonly maxConsecutiveBreakerCountable: number;
  /** Seconds after the run start (rounded): the degraded window as the harness saw it. */
  readonly firstErrorAtS: number | null;
  readonly lastErrorAtS: number | null;
  readonly okAfterLastError: number;
}

export interface DeskSection {
  readonly stamp: string;
  readonly routes: {
    readonly component: string;
    readonly legs: number;
    readonly answered: number;
    readonly errors: Readonly<Record<string, number>>;
    readonly ratioMedian: number | null;
    readonly ratioP90: number | null;
    readonly ratioMax: number | null;
    readonly withEta: number;
    readonly shorterThanGreatCircle: number;
    readonly ratioOutliers: number;
  }[];
  readonly routeRows: readonly DeskRouteRow[];
  readonly reverseAreaMatch: { readonly component: string; readonly n: number; readonly matched: number; readonly noAnswer: number; readonly errors: number }[];
  readonly latency: { readonly component: string; readonly sku: string; readonly cold: LatencyCell; readonly warm: LatencyCell }[];
  readonly failures: readonly FailureProfile[];
}

function cell(values: readonly number[]): LatencyCell {
  return { n: values.length, p50Ms: percentile(values, 50), p95Ms: percentile(values, 95) };
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/** Whether the gateway breaker counts this adapter code (the adapter's own classification, architecture §5.4). */
function breakerCounts(code: string): boolean {
  return new GeoAdapterError('geo-bench', 'ROUTE', code as GeoAdapterErrorCode).countsAsProviderFailure;
}

export function deskSection(cases: ValidationResult, run: RunRecord): DeskSection {
  const routeRows = deskRouteRows(cases, run);
  const routeComponents = [...new Set(routeRows.map((r) => r.component))].sort();
  const routes = routeComponents.map((component) => {
    const rows = routeRows.filter((r) => r.component === component);
    const ratios = rows.map((r) => r.ratio).filter((v): v is number => v !== null);
    return {
      component,
      legs: rows.length,
      answered: rows.filter((r) => r.status === 'ROUTE').length,
      errors: countBy(rows.filter((r) => r.status !== 'ROUTE').map((r) => r.status.replace('ERROR ', ''))),
      ratioMedian: percentile(ratios, 50),
      ratioP90: percentile(ratios, 90),
      ratioMax: ratios.length === 0 ? null : Math.max(...ratios),
      withEta: rows.filter((r) => r.etaMin !== null).length,
      shorterThanGreatCircle: rows.filter((r) => r.flags.includes('SHORTER_THAN_GREAT_CIRCLE')).length,
      ratioOutliers: rows.filter((r) => r.flags.includes('ROUTE_RATIO_OUTLIER')).length,
    };
  });

  const expected = new Map(cases.points.map((p) => [p.id, p.expectedArea]));
  const reverseComponents = [...new Set(run.reverse.map((r) => r.component))].sort();
  const reverseAreaMatch = reverseComponents.map((component) => {
    const recs = run.reverse.filter((r) => r.component === component);
    return {
      component,
      n: recs.length,
      matched: recs.filter((r) => r.errorCode === null && areaMatches(expected.get(r.caseId) ?? '', r.place)).length,
      noAnswer: recs.filter((r) => r.errorCode === null && r.place === null).length,
      errors: recs.filter((r) => r.errorCode !== null).length,
    };
  });

  const latency: DeskSection['latency'] = [];
  const keys = [...new Set(run.calls.filter((c) => c.repeat !== null).map((c) => `${c.component}|${c.sku}`))].sort();
  for (const key of keys) {
    const [component = '', sku = ''] = key.split('|');
    const answered = run.calls.filter((c) => c.component === component && c.sku === sku && c.repeat !== null && c.outcome !== 'ERROR');
    latency.push({
      component,
      sku,
      cold: cell(answered.filter((c) => c.repeat === 0).map((c) => c.latencyMs)),
      warm: cell(answered.filter((c) => (c.repeat ?? 0) > 0).map((c) => c.latencyMs)),
    });
  }

  const failures: FailureProfile[] = [...new Set(run.calls.map((c) => c.component))].sort().map((component) => {
    const calls = run.calls.filter((c) => c.component === component).sort((a, b) => a.atMs - b.atMs);
    const errors = calls.filter((c) => c.outcome === 'ERROR');
    let streak = 0;
    let maxStreak = 0;
    for (const c of calls) {
      streak = c.outcome === 'ERROR' && c.errorCode !== null && breakerCounts(c.errorCode) ? streak + 1 : 0;
      maxStreak = Math.max(maxStreak, streak);
    }
    const last = errors.at(-1);
    return {
      component,
      calls: calls.length,
      errors: countBy(errors.map((c) => c.errorCode ?? 'UNKNOWN')),
      breakerCountable: errors.filter((c) => c.errorCode !== null && breakerCounts(c.errorCode)).length,
      maxConsecutiveBreakerCountable: maxStreak,
      firstErrorAtS: errors[0] === undefined ? null : Math.round(errors[0].atMs / 1000),
      lastErrorAtS: last === undefined ? null : Math.round(last.atMs / 1000),
      okAfterLastError: last === undefined ? 0 : calls.filter((c) => c.atMs > last.atMs && c.outcome !== 'ERROR').length,
    };
  });

  return { stamp: DESK_STAMP, routes, routeRows, reverseAreaMatch, latency, failures };
}

const n1 = (v: number | null) => (v === null ? 'n/a' : v.toFixed(2));
const ms = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v)} ms`);

/** Markdown for the desk section (appended to the aggregate report). */
export function renderDeskMarkdown(d: DeskSection): string[] {
  const lines: string[] = ['## DESK — NOT FIELD: desk/open-data analysis', '', `> ${d.stamp}`, ''];
  lines.push('### Route sanity (T3-06) per routing component', '');
  lines.push('| Component | Legs | Answered | Errors | Ratio median | Ratio p90 | Ratio max | With ETA | Shorter than great circle | Ratio > 3.0 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of d.routes) {
    const errors = Object.entries(r.errors)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    lines.push(
      `| ${r.component} | ${r.legs} | ${r.answered} | ${errors === '' ? '0' : errors} | ${n1(r.ratioMedian)} | ${n1(r.ratioP90)} | ${n1(r.ratioMax)} | ${r.withEta} | ${r.shorterThanGreatCircle} | ${r.ratioOutliers} |`,
    );
  }
  lines.push('', '### Reverse geocode — expected-area string match (desk automation, not the §5.5 blind rating)', '');
  lines.push('| Component | Points | Matched | No address | Errors |', '|---|---|---|---|---|');
  for (const r of d.reverseAreaMatch) lines.push(`| ${r.component} | ${r.n} | ${r.matched} | ${r.noAnswer} | ${r.errors} |`);
  lines.push('', '### Latency: first (cold) vs repeated identical request (warm)', '');
  lines.push('| Component | SKU | Cold n | Cold p50 | Cold p95 | Warm n | Warm p50 | Warm p95 |', '|---|---|---|---|---|---|---|---|');
  for (const l of d.latency)
    lines.push(
      `| ${l.component} | ${l.sku} | ${l.cold.n} | ${ms(l.cold.p50Ms)} | ${ms(l.cold.p95Ms)} | ${l.warm.n} | ${ms(l.warm.p50Ms)} | ${ms(l.warm.p95Ms)} |`,
    );
  lines.push('', '### Failure profile (breaker classification from the adapter error code)', '');
  lines.push('| Component | Calls | Errors | Breaker-countable | Max consecutive countable | First error (s) | Last error (s) | OK after last error |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const f of d.failures) {
    const errors = Object.entries(f.errors)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    lines.push(
      `| ${f.component} | ${f.calls} | ${errors === '' ? '0' : errors} | ${f.breakerCountable} | ${f.maxConsecutiveBreakerCountable} | ${f.firstErrorAtS ?? 'n/a'} | ${f.lastErrorAtS ?? 'n/a'} | ${f.okAfterLastError} |`,
    );
  }
  lines.push('');
  return lines;
}
