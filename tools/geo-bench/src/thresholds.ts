/**
 * FIXED pre-measurement values (FA-07, APPROVED 2026-10-12): thresholds and floors/targets of
 * docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md §7 and the weights of
 * docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md §12.2. They change only through evidence + a reviewed ADR update —
 * NEVER after seeing measurements. A unit test pins every value.
 *
 * Harness reading where the documents leave a detail open (reported in every output under `assumptions`):
 *  - A1 the 12 accuracy points for "geocode top-1/top-3" are split 6 + 6;
 *  - A2 Urdu-script handling (coverage, 3 points) has no floor/target in §7: normalised linearly 0 % → 100 %;
 *  - A3 the "empty/failure rate" coverage score (5 points) is the mean of the per-SKU failure-rate scores;
 *  - A4 the latency score (10 points) is the mean over the SKUs that have a budget (autocomplete, reverse, route);
 *       geocode/place-resolve latency is reported but not scored (no budget in §7);
 *  - A5 constraint plausibility counts NONE as 1 and MINOR/CRITICAL as 0 (CRITICAL is additionally the hard gate).
 */
import type { GeoSku } from '@wayvro/provider-interfaces';

export interface NormalisedThreshold {
  /** Gating value (≥ for rates, ≤ for errors), or null when the metric is scored only. */
  readonly gate: number | null;
  readonly floor: number;
  readonly target: number;
}

export const THRESHOLDS = Object.freeze({
  geocodeTop1: { gate: 0.8, floor: 0.5, target: 0.9 },
  geocodeTop3: { gate: 0.9, floor: 0.6, target: 0.97 },
  reverseUseful: { gate: 0.8, floor: 0.4, target: 0.9 },
  /** Route distance error, percent: median gate 10 (p90 gate below), scoring floor 25 → target 3. */
  routeDistanceMedianPct: { gate: 10, floor: 25, target: 3 },
  routeDistanceP90GatePct: 20,
  /** ETA error vs off-peak drive, absolute median percent (peak informational). */
  etaOffPeakAbsMedianPct: { gate: 20, floor: 40, target: 8 },
  autocompleteTop5: { gate: 0.85, floor: 0.5, target: 0.95 },
  /** Minor suboptimal routes are scored, not gated; CRITICAL is the separate hard gate (§7.1). */
  constraintPlausibility: { gate: null, floor: 0.5, target: 1 },
  /** Failure/empty rate per SKU. */
  failureRate: { gate: 0.05, floor: 0.2, target: 0.01 },
  /** Urdu-script handling (assumption A2). */
  urduHandling: { gate: null, floor: 0, target: 1 },
} satisfies Record<string, NormalisedThreshold | number>);

/** Latency budgets (ms) from PHASE3_PERFORMANCE_BUDGETS via SP-04 §7: gate ≤ budget, floor 2× → target 0.5×. */
export const LATENCY_BUDGET_MS: Readonly<Partial<Record<GeoSku, number>>> = Object.freeze({ AUTOCOMPLETE: 450, REVERSE_GEOCODE: 500, ROUTE: 800 });

export function latencyThreshold(budget: number): NormalisedThreshold {
  return { gate: budget, floor: budget * 2, target: budget * 0.5 };
}

/** §12.2 weights (PROPOSED there, applied as the FA-07-approved rubric). */
export const WEIGHTS = Object.freeze({
  geocodeTop1: 6,
  geocodeTop3: 6,
  autocompleteTop5: 10,
  routeDistance: 8,
  etaOffPeak: 8,
  constraintPlausibility: 2,
  reverseUseful: 12,
  failureRate: 5,
  urduHandling: 3,
  costPilot: 12,
  costScale: 8,
  latency: 10,
  termsOps: 10,
});

export const ASSUMPTIONS = Object.freeze([
  'A1 geocode top-1/top-3 accuracy weight (12) split 6 + 6',
  'A2 Urdu-script handling normalised 0 % → 100 % (no floor/target in §7)',
  'A3 failure-rate coverage score = mean of per-SKU failure-rate scores',
  'A4 latency score = mean over SKUs with a budget (autocomplete 450 ms, reverse 500 ms, route 800 ms); harness latency from the run location is indicative',
  'A5 constraint plausibility: NONE = 1, MINOR/CRITICAL = 0',
  'A6 peak legs = ROUTE cases in the --peak-sessions sessions (default LHR-SP04-S4, the protocol peak session)',
  'A7 forward geocode uses the primary query (English, else Roman Urdu, else Urdu); autocomplete uses every language variant',
  'A8 a null/failed reverse answer is scored usefulness 0 without a founder rating',
  'A9 D_true = GPX length when a GPX file is supplied (legs with GPX vs odometer > 5 % are flagged and excluded from gating), else the odometer',
]);

/** 100 × clamp((value − floor) / (target − floor), 0, 1) — works for descending metrics (floor > target) too. */
export function normalise(value: number, t: { readonly floor: number; readonly target: number }): number {
  const raw = (value - t.floor) / (t.target - t.floor);
  return 100 * Math.min(1, Math.max(0, raw));
}
