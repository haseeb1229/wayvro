/**
 * Bundle scoring and eligibility (evaluation doc §12; benchmark doc §7 and §7.1). For every licence-coherent bundle
 * configuration (one component per SKU family inside the same bundle) the harness applies the FIXED thresholds,
 * computes the weighted score and decides eligibility. Order of precedence:
 *   1. any unresolved CRITICAL route finding ⇒ INELIGIBLE, whatever the score (§7.1 hard gate; no acceptance route);
 *   2. any gate input G1/G2/G3/G5/G6 = FAIL (S2: G1 fails while FA-19 has no written answer) ⇒ INELIGIBLE;
 *   3. anything missing (review, ratings, gate inputs, metrics, incomplete run) ⇒ PENDING;
 *   4. a missed quantitative threshold ⇒ SHORTFALL_NEEDS_FOUNDER_ACCEPTANCE (founder-signed acceptance route, §7);
 *   5. otherwise ELIGIBLE.
 */
import type { GeoSku } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import type { ComponentMetrics, Rate } from './metrics.js';
import { LATENCY_BUDGET_MS, THRESHOLDS, WEIGHTS, latencyThreshold, normalise } from './thresholds.js';

const gateStatus = z.enum(['PASS', 'FAIL', 'PENDING']);
const score100 = z.number().min(0).max(100).nullable();

/** Founder/Claude-assessed inputs that the field run cannot measure (G1–G3, G5, G6; cost; terms/ops). Enumerations and numbers only. */
export const scoringInputsSchema = z
  .object({
    bundles: z.partialRecord(
      z.enum(['S1', 'S2', 'S3']),
      z
        .object({
          G1: gateStatus,
          G2: gateStatus,
          G3: gateStatus,
          G5: gateStatus,
          G6: gateStatus,
          costPilotScore: score100,
          costScaleScore: score100,
          termsOpsScore: score100,
          fa19WrittenConfirmation: z.boolean().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type ScoringInputs = z.infer<typeof scoringInputsSchema>;

type GateName = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';
type GateStatus = 'PASS' | 'FAIL' | 'PENDING' | 'SHORTFALL';
type Eligibility = 'ELIGIBLE' | 'SHORTFALL_NEEDS_FOUNDER_ACCEPTANCE' | 'PENDING' | 'INELIGIBLE';

interface ThresholdCheck {
  readonly metric: string;
  readonly value: number | null;
  readonly gate: string;
  readonly pass: boolean | null;
}

interface ScoreItem {
  readonly key: keyof typeof WEIGHTS;
  readonly weight: number;
  readonly score: number | null;
}

export interface BundleResult {
  readonly bundle: string;
  readonly configuration: Readonly<Record<string, string>>;
  readonly thresholds: readonly ThresholdCheck[];
  readonly score: { readonly total: number; readonly missingWeight: number; readonly items: readonly ScoreItem[] };
  readonly gates: Readonly<Record<GateName, { readonly status: GateStatus; readonly reason: string | null }>>;
  readonly unresolvedCritical: number;
  readonly eligibility: Eligibility;
  readonly reasons: readonly string[];
}

const KINDS = ['AUTOCOMPLETE', 'GEOCODE', 'REVERSE_GEOCODE', 'ROUTE'] as const;

function atLeast(metric: string, r: Rate | undefined, gate: number): ThresholdCheck {
  const value = r?.value ?? null;
  return { metric, value, gate: `>= ${gate}`, pass: value === null ? null : value >= gate };
}

function atMost(metric: string, value: number | null | undefined, gate: number): ThresholdCheck {
  const v = value ?? null;
  return { metric, value: v, gate: `<= ${gate}`, pass: v === null ? null : v <= gate };
}

function scoreOf(value: number | null | undefined, t: { floor: number; target: number }): number | null {
  return value === null || value === undefined ? null : normalise(value, t);
}

function mean(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0) / values.length;
}

/** Scores one configuration. `runComplete` = the run was not stopped by the budget guard. */
function scoreConfiguration(
  bundle: string,
  parts: Readonly<Record<(typeof KINDS)[number], ComponentMetrics>>,
  inputs: ScoringInputs['bundles'][keyof ScoringInputs['bundles']] | undefined,
  runComplete: boolean,
): BundleResult {
  const ac = parts.AUTOCOMPLETE.autocomplete;
  const geo = parts.GEOCODE.geocode;
  const rev = parts.REVERSE_GEOCODE.reverse;
  const route = parts.ROUTE.route;
  const T = THRESHOLDS;

  const thresholds: ThresholdCheck[] = [
    atLeast('geocode_top1_within_50m', geo?.top1, T.geocodeTop1.gate),
    atLeast('geocode_top3_within_50m', geo?.top3, T.geocodeTop3.gate),
    atLeast('reverse_useful_rate', rev?.useful, T.reverseUseful.gate),
    atMost('route_distance_error_median_pct', route?.distanceErrorMedianPct, T.routeDistanceMedianPct.gate),
    atMost('route_distance_error_p90_pct', route?.distanceErrorP90Pct, T.routeDistanceP90GatePct),
    atMost('eta_offpeak_abs_median_pct', route?.etaOffPeak.absMedianPct, T.etaOffPeakAbsMedianPct.gate),
    atLeast('autocomplete_top5_overall', ac?.top5, T.autocompleteTop5.gate),
  ];
  const latencyScores: (number | null)[] = [];
  for (const [kind, sku] of [
    ['AUTOCOMPLETE', 'AUTOCOMPLETE'],
    ['REVERSE_GEOCODE', 'REVERSE_GEOCODE'],
    ['ROUTE', 'ROUTE'],
  ] as const) {
    const budget = LATENCY_BUDGET_MS[sku] as number;
    const p95 = parts[kind].sku[sku]?.latencyP95Ms ?? null;
    thresholds.push(atMost(`latency_p95_ms_${sku}`, p95, budget));
    latencyScores.push(scoreOf(p95, latencyThreshold(budget)));
  }
  const failureScores: (number | null)[] = [];
  for (const kind of KINDS) {
    for (const [sku, stats] of Object.entries(parts[kind].sku) as [GeoSku, NonNullable<ComponentMetrics['sku'][GeoSku]>][]) {
      thresholds.push(atMost(`failure_rate_${sku}_${parts[kind].id}`, stats.failureRate.value, T.failureRate.gate));
      failureScores.push(scoreOf(stats.failureRate.value, T.failureRate));
    }
  }

  const items: ScoreItem[] = [
    { key: 'geocodeTop1', weight: WEIGHTS.geocodeTop1, score: scoreOf(geo?.top1.value, T.geocodeTop1) },
    { key: 'geocodeTop3', weight: WEIGHTS.geocodeTop3, score: scoreOf(geo?.top3.value, T.geocodeTop3) },
    { key: 'autocompleteTop5', weight: WEIGHTS.autocompleteTop5, score: scoreOf(ac?.top5.value, T.autocompleteTop5) },
    { key: 'routeDistance', weight: WEIGHTS.routeDistance, score: scoreOf(route?.distanceErrorMedianPct, T.routeDistanceMedianPct) },
    { key: 'etaOffPeak', weight: WEIGHTS.etaOffPeak, score: scoreOf(route?.etaOffPeak.absMedianPct, T.etaOffPeakAbsMedianPct) },
    { key: 'constraintPlausibility', weight: WEIGHTS.constraintPlausibility, score: scoreOf(route?.constraintPlausibility.value, T.constraintPlausibility) },
    { key: 'reverseUseful', weight: WEIGHTS.reverseUseful, score: scoreOf(rev?.useful.value, T.reverseUseful) },
    { key: 'failureRate', weight: WEIGHTS.failureRate, score: mean(failureScores) },
    { key: 'urduHandling', weight: WEIGHTS.urduHandling, score: scoreOf(ac?.urduHandling.value, T.urduHandling) },
    { key: 'costPilot', weight: WEIGHTS.costPilot, score: inputs?.costPilotScore ?? null },
    { key: 'costScale', weight: WEIGHTS.costScale, score: inputs?.costScaleScore ?? null },
    { key: 'latency', weight: WEIGHTS.latency, score: mean(latencyScores) },
    { key: 'termsOps', weight: WEIGHTS.termsOps, score: inputs?.termsOpsScore ?? null },
  ];
  const total = items.reduce((sum, i) => sum + (i.score === null ? 0 : (i.weight * i.score) / 100), 0);
  const missingWeight = items.reduce((sum, i) => sum + (i.score === null ? i.weight : 0), 0);

  const unresolvedCritical = route?.unresolvedCritical ?? 0;
  const incomplete = !runComplete || (route?.unreviewed ?? 1) > 0 || (rev?.unrated ?? 1) > 0 || thresholds.some((t) => t.pass === null);
  const g4: { status: GateStatus; reason: string | null } =
    unresolvedCritical > 0
      ? { status: 'FAIL', reason: `${unresolvedCritical} unresolved CRITICAL route finding(s)` }
      : incomplete
        ? { status: 'PENDING', reason: 'route review, blind ratings, a metric or the run is incomplete' }
        : thresholds.some((t) => t.pass === false)
          ? { status: 'SHORTFALL', reason: 'quantitative threshold(s) missed' }
          : { status: 'PASS', reason: null };
  const input = (g: 'G1' | 'G2' | 'G3' | 'G5' | 'G6'): { status: GateStatus; reason: string | null } =>
    inputs === undefined ? { status: 'PENDING', reason: 'no scoring input' } : { status: inputs[g], reason: null };
  let g1 = input('G1');
  if (bundle === 'S2' && inputs?.fa19WrittenConfirmation !== true) {
    g1 = { status: 'FAIL', reason: 'FA-19 open: no written Mapbox Commercial Application License answer — no pilot/production S2 freeze' };
  }
  const gates: Record<GateName, { status: GateStatus; reason: string | null }> = {
    G1: g1,
    G2: input('G2'),
    G3: input('G3'),
    G4: g4,
    G5: input('G5'),
    G6: input('G6'),
  };

  const reasons: string[] = [];
  let eligibility: Eligibility;
  const failed = (Object.entries(gates) as [GateName, { status: GateStatus }][]).filter(([, g]) => g.status === 'FAIL').map(([n]) => n);
  if (unresolvedCritical > 0) {
    eligibility = 'INELIGIBLE';
    reasons.push('UNRESOLVED_CRITICAL_ROUTE (hard gate §7.1; a high score never offsets it)');
    if (failed.length > 1) reasons.push(`also failed: ${failed.filter((g) => g !== 'G4').join(', ')}`);
  } else if (failed.length > 0) {
    eligibility = 'INELIGIBLE';
    reasons.push(`failed gate(s): ${failed.join(', ')}`);
  } else if (Object.values(gates).some((g) => g.status === 'PENDING') || missingWeight > 0) {
    eligibility = 'PENDING';
    reasons.push('missing evidence or inputs (see gates and score.missingWeight)');
  } else if (gates.G4.status === 'SHORTFALL') {
    eligibility = 'SHORTFALL_NEEDS_FOUNDER_ACCEPTANCE';
    reasons.push('quantitative threshold(s) missed: selectable only with a founder-signed acceptance and named mitigations (§7)');
  } else {
    eligibility = 'ELIGIBLE';
  }

  return {
    bundle,
    configuration: Object.fromEntries(KINDS.map((k) => [k, parts[k].id])),
    thresholds,
    score: { total, missingWeight, items },
    gates,
    unresolvedCritical,
    eligibility,
    reasons,
  };
}

/** Every licence-coherent configuration: one component per SKU family, all from the same bundle. */
export function scoreBundles(
  components: readonly ComponentMetrics[],
  inputs: ScoringInputs | null,
  runComplete: boolean,
): { results: BundleResult[]; incomplete: { bundle: string; missing: string[] }[] } {
  const results: BundleResult[] = [];
  const incomplete: { bundle: string; missing: string[] }[] = [];
  for (const bundle of ['S1', 'S2', 'S3'] as const) {
    const byKind = KINDS.map((k) => components.filter((c) => c.bundle === bundle && c.kind === k));
    if (byKind.every((l) => l.length === 0)) continue;
    const missing = KINDS.filter((_, i) => (byKind[i] ?? []).length === 0);
    if (missing.length > 0) {
      incomplete.push({ bundle, missing });
      continue;
    }
    const [acs, geos, revs, routes] = byKind as [ComponentMetrics[], ComponentMetrics[], ComponentMetrics[], ComponentMetrics[]];
    for (const a of acs)
      for (const g of geos)
        for (const r of revs)
          for (const rt of routes) {
            results.push(scoreConfiguration(bundle, { AUTOCOMPLETE: a, GEOCODE: g, REVERSE_GEOCODE: r, ROUTE: rt }, inputs?.bundles[bundle], runComplete));
          }
  }
  return { results, incomplete };
}
