/**
 * Aggregated SP-04 output (Markdown + JSON) — the ONLY harness output that may ever be committed (§8): metrics, flags,
 * ranks, case ids and enumerations. No raw provider content, no coordinates (none at all, so nothing finer than
 * 3 decimals), no founder free text. `assertAggregateSafe` (bench-data guard, threat model T3-32) refuses to write a
 * report containing a 4+-decimal number, a key-shaped string, Arabic-script text or any founder free-text value.
 */
import { PRICE_TABLE_DATE } from '@wayvro/geo-adapters';
import type { CaseSource, ValidationResult } from './cases.js';
import { type DeskSection, renderDeskMarkdown } from './desk.js';
import type { ComponentMetrics, Evidence } from './metrics.js';
import type { RunRecord } from './runner.js';
import type { BundleResult } from './score.js';
import { ASSUMPTIONS, THRESHOLDS, WEIGHTS } from './thresholds.js';

const ARABIC_RANGES: readonly (readonly [number, number])[] = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];

/** @internal exported for unit tests */
export class UnsafeAggregateError extends Error {
  override readonly name = 'UnsafeAggregateError';
}

/** Bench-data guard: throws instead of writing anything that could carry raw data, coordinates, keys or founder text. */
export function assertAggregateSafe(text: string, founderFreeText: readonly string[]): void {
  if (/\d\.\d{4,}/.test(text)) throw new UnsafeAggregateError('aggregate contains a number with 4+ decimals (possible coordinate)');
  if (/AIza[0-9A-Za-z_-]{20,}|\b[ps]k\.[A-Za-z0-9._-]{20,}/.test(text)) throw new UnsafeAggregateError('aggregate contains a key-shaped string');
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ARABIC_RANGES.some(([a, b]) => cp >= a && cp <= b))
      throw new UnsafeAggregateError('aggregate contains Arabic-script text (possible query/provider content)');
  }
  for (const value of founderFreeText) {
    if (value.length >= 6 && text.includes(value)) throw new UnsafeAggregateError('aggregate contains founder free text');
  }
}

/** Rounds every non-integer number to 2 decimals (aggregates never need more). */
function roundDeep<T>(value: T): T {
  if (typeof value === 'number') return (Number.isInteger(value) ? value : Math.round(value * 100) / 100) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => roundDeep(v)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundDeep(v)])) as T;
  return value;
}

export interface AggregateReport {
  readonly title: string;
  readonly caseSource: CaseSource;
  readonly desk: DeskSection | null;
  readonly caseListVersion: string;
  readonly runStatus: string;
  readonly stoppedBucket: string | null;
  readonly runDate: string;
  readonly priceTableDate: string;
  readonly latencyRepeats: number;
  readonly counts: { readonly pointCases: number; readonly routeCases: number };
  readonly thresholds: typeof THRESHOLDS;
  readonly weights: typeof WEIGHTS;
  readonly assumptions: readonly string[];
  readonly notImplemented: readonly string[];
  readonly components: readonly ComponentMetrics[];
  readonly bundles: readonly BundleResult[];
  readonly incompleteBundles: readonly { bundle: string; missing: string[] }[];
  readonly categories: Record<string, Record<string, { n: number; hitsOrMedian: number | null; metric: string }>>;
  readonly evidence: Evidence;
  readonly budget: RunRecord['budget'];
}

function categorySummary(evidence: Evidence): AggregateReport['categories'] {
  const out: AggregateReport['categories'] = {};
  const put = (category: string, key: string, metric: string, n: number, value: number | null) => {
    out[category] = { ...(out[category] ?? {}), [key]: { n, hitsOrMedian: value, metric } };
  };
  const groups = <T extends { category: string; component: string }>(rows: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) map.set(`${r.category}|${r.component}`, [...(map.get(`${r.category}|${r.component}`) ?? []), r]);
    return map;
  };
  for (const [k, rows] of groups(evidence.geocode)) {
    const [cat = '', comp = ''] = k.split('|');
    put(cat, comp, 'geocode top-1 hits', rows.length, rows.filter((r) => r.top1Hit).length);
  }
  for (const [k, rows] of groups(evidence.autocomplete)) {
    const [cat = '', comp = ''] = k.split('|');
    put(cat, comp, 'autocomplete top-5 hits (all languages)', rows.length, rows.filter((r) => r.rank !== null).length);
  }
  for (const [k, rows] of groups(evidence.reverse)) {
    const [cat = '', comp = ''] = k.split('|');
    put(cat, comp, 'reverse useful (score >= 2)', rows.length, rows.filter((r) => (r.usefulness ?? -1) >= 2).length);
  }
  for (const [k, rows] of groups(evidence.routes)) {
    const [cat = '', comp = ''] = k.split('|');
    const errs = rows
      .map((r) => r.distanceErrorPct)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const mid =
      errs.length === 0
        ? null
        : errs.length % 2 === 1
          ? (errs[(errs.length - 1) / 2] as number)
          : ((errs[errs.length / 2 - 1] as number) + (errs[errs.length / 2] as number)) / 2;
    put(cat, comp, 'route distance error median %', rows.length, mid);
  }
  return out;
}

export function buildReport(input: {
  readonly run: RunRecord;
  readonly cases: ValidationResult;
  readonly components: readonly ComponentMetrics[];
  readonly evidence: Evidence;
  readonly bundles: readonly BundleResult[];
  readonly incompleteBundles: readonly { bundle: string; missing: string[] }[];
  /** Present only for a DESK_OSM run. */
  readonly desk?: DeskSection;
}): AggregateReport {
  const desk = input.run.caseSource === 'DESK_OSM';
  return roundDeep({
    title: `${desk ? 'DESK — NOT FIELD · ' : ''}SP-04 Lahore geo benchmark — aggregated metrics (no raw provider content, no coordinates, no founder free text)`,
    caseSource: input.run.caseSource,
    desk: input.desk ?? null,
    caseListVersion: input.run.caseListVersion,
    runStatus: input.run.status,
    stoppedBucket: input.run.stoppedBucket,
    runDate: input.run.startedAt.slice(0, 10),
    priceTableDate: PRICE_TABLE_DATE,
    latencyRepeats: input.run.repeats,
    counts: { pointCases: input.cases.points.length, routeCases: input.cases.routes.length },
    thresholds: THRESHOLDS,
    weights: WEIGHTS,
    assumptions: ASSUMPTIONS,
    notImplemented: [
      'paired tests (§9: McNemar for binary metrics, Wilcoxon signed-rank for paired errors) and the tie rule (evaluation §12.2) are applied in the P3.7 analysis, not by this harness',
      'G1/G2/G3/G5/G6, cost and terms/ops scores are founder/counsel/Claude assessments supplied through --scoring-inputs',
    ],
    components: input.components,
    bundles: input.bundles,
    incompleteBundles: input.incompleteBundles,
    categories: categorySummary(input.evidence),
    evidence: input.evidence,
    budget: input.run.budget,
  });
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)} %`);
const num = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? 'n/a' : `${v.toFixed(1)}${unit}`);

export function renderMarkdown(r: AggregateReport): string {
  const lines: string[] = [];
  lines.push(`# ${r.title}`, '');
  if (r.desk !== null) lines.push(`> **${r.desk.stamp}**`, '');
  lines.push(
    `Case list: ${r.caseListVersion} · run date: ${r.runDate} · run status: **${r.runStatus}**${r.stoppedBucket ? ` (stopped at ${r.stoppedBucket})` : ''} · price table: ${r.priceTableDate} (ESTIMATE) · latency repeats: ${r.latencyRepeats}`,
  );
  lines.push(`POINT cases: ${r.counts.pointCases} · ROUTE cases: ${r.counts.routeCases}`, '');
  lines.push('## Bundles (licence-coherent configurations)', '');
  lines.push(
    '| Bundle | Autocomplete | Geocode | Reverse | Route | Score | Missing weight | G1 | G2 | G3 | G4 | G5 | G6 | Unresolved CRITICAL | Eligibility |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of r.bundles) {
    const c = b.configuration;
    const g = b.gates;
    lines.push(
      `| ${b.bundle} | ${c['AUTOCOMPLETE'] ?? ''} | ${c['GEOCODE'] ?? ''} | ${c['REVERSE_GEOCODE'] ?? ''} | ${c['ROUTE'] ?? ''} | ${num(b.score.total)} | ${b.score.missingWeight} | ${g.G1.status} | ${g.G2.status} | ${g.G3.status} | ${g.G4.status} | ${g.G5.status} | ${g.G6.status} | ${b.unresolvedCritical} | **${b.eligibility}** |`,
    );
  }
  for (const i of r.incompleteBundles) lines.push(`| ${i.bundle} | missing component(s): ${i.missing.join(', ')} | | | | | | | | | | | | | NOT SCORED |`);
  lines.push('');
  for (const b of r.bundles) {
    lines.push(`### ${b.bundle}: ${Object.values(b.configuration).join(' + ')}`, '');
    if (b.reasons.length > 0) lines.push(`Reasons: ${b.reasons.join('; ')}`, '');
    lines.push('| Threshold | Value | Gate | Pass |', '|---|---|---|---|');
    for (const t of b.thresholds)
      lines.push(`| ${t.metric} | ${t.value === null ? 'n/a' : t.value} | ${t.gate} | ${t.pass === null ? 'PENDING' : t.pass ? 'PASS' : 'MISS'} |`);
    lines.push('');
  }
  lines.push('## Components', '');
  lines.push('| Component | Kind | Key metrics | Failure/empty (per SKU) | p95 latency (per SKU) |', '|---|---|---|---|---|');
  for (const c of r.components) {
    const key = c.autocomplete
      ? `top-5 ${pct(c.autocomplete.top5.value)} (n ${c.autocomplete.top5.n}); en ${pct(c.autocomplete.perLanguage.en.value)}, roman-urdu ${pct(c.autocomplete.perLanguage.roman_urdu.value)}, urdu ${pct(c.autocomplete.perLanguage.urdu.value)}; urdu handling ${pct(c.autocomplete.urduHandling.value)}`
      : c.geocode
        ? `top-1 ${pct(c.geocode.top1.value)}, top-3 ${pct(c.geocode.top3.value)} (n ${c.geocode.top1.n}); median top-1 error ${num(c.geocode.medianTop1ErrorM, ' m')}`
        : c.reverse
          ? `useful ${pct(c.reverse.useful.value)} (rated ${c.reverse.useful.n}, unrated ${c.reverse.unrated})`
          : c.route
            ? `distance error median ${num(c.route.distanceErrorMedianPct, ' %')} / p90 ${num(c.route.distanceErrorP90Pct, ' %')} (legs ${c.route.distanceLegs}, flagged ${c.route.flaggedLegs}, odometer-only ${c.route.odometerOnlyLegs}); ETA off-peak abs median ${num(c.route.etaOffPeak.absMedianPct, ' %')} (signed ${num(c.route.etaOffPeak.signedMedianPct, ' %')}, n ${c.route.etaOffPeak.n}); peak abs median ${num(c.route.etaPeak.absMedianPct, ' %')} (n ${c.route.etaPeak.n}); constraint plausibility ${pct(c.route.constraintPlausibility.value)}; unreviewed ${c.route.unreviewed}`
            : '';
    const fail = Object.entries(c.sku)
      .map(([s, v]) => `${s} ${pct(v.failureRate.value)}`)
      .join('; ');
    const lat = Object.entries(c.sku)
      .map(([s, v]) => `${s} ${num(v.latencyP95Ms, ' ms')}`)
      .join('; ');
    lines.push(`| ${c.id} | ${c.kind} | ${key} | ${fail} | ${lat} |`);
  }
  lines.push('', '## CRITICAL route findings (§7.1)', '');
  const critical = r.components.flatMap((c) => c.route?.critical ?? []);
  if (critical.length === 0) lines.push('None recorded in the route review (unreviewed legs are listed per component above).');
  else {
    lines.push('| Case | Component | Class | Cleared | Clearing action |', '|---|---|---|---|---|');
    for (const f of critical) lines.push(`| ${f.caseId} | ${f.component} | ${f.criticalClass} | ${f.cleared ? 'Y' : 'N'} | ${f.clearingAction ?? ''} |`);
  }
  lines.push('', '## Budget (free-allowance hard stop at 80 %)', '', '| Bucket | Used this month | Stop at | Free allowance |', '|---|---|---|---|');
  for (const [bucket, b] of Object.entries(r.budget)) lines.push(`| ${bucket} | ${b.used} | ${b.stopAt} | ${b.allowance} |`);
  lines.push('', '## Assumptions (harness reading of open details)', '', ...r.assumptions.map((a) => `- ${a}`));
  lines.push('', '## Not implemented here', '', ...r.notImplemented.map((a) => `- ${a}`), '');
  if (r.desk !== null) lines.push(...renderDeskMarkdown(r.desk));
  lines.push('The per-case evidence table and per-category summaries are in the JSON file next to this report.', '');
  return lines.join('\n');
}
