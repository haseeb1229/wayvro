/**
 * End-to-end scoring on a synthetic sheet with fake adapters: FIXED thresholds, the §7.1 hard gate overriding a high
 * score, PENDING states, the S2 FA-19 rule, and the aggregate guard (no coordinates, no founder text).
 */
import type { GeoPoint } from '@wayvro/provider-interfaces';
import { describe, expect, it } from 'vitest';
import { BudgetGuard } from './budget.js';
import { validateCapture } from './cases.js';
import type { Component } from './components.js';
import { legTruths } from './gpx.js';
import { computeMetrics } from './metrics.js';
import { UnsafeAggregateError, assertAggregateSafe, buildReport, renderMarkdown } from './report.js';
import { runBenchmark } from './runner.js';
import { type ScoringInputs, scoreBundles } from './score.js';
import { type ReviewEntry, blindSheet, readRatings } from './sheets.js';
import { ASSUMPTIONS, THRESHOLDS, WEIGHTS, normalise } from './thresholds.js';
import { type FakeBehaviour, fakeComponents, syntheticCsv } from '../test/fixtures.js';

const NOW = new Date('2026-10-13T06:00:00Z');
const cases = validateCapture(syntheticCsv(8, 4, {}, { urdu: true }));
const truthByQuery = new Map<string, GeoPoint>(cases.points.flatMap((p) => Object.values(p.queries).map((q) => [q, p.truth] as [string, GeoPoint])));
const truths = legTruths(cases.routes, new Map());
const GOOD: FakeBehaviour = { answerOffsetM: 10, routeDistanceFactor: 1.02, routeDurationFactor: 1.05 };
const PASS_INPUTS = { G1: 'PASS', G2: 'PASS', G3: 'PASS', G5: 'PASS', G6: 'PASS', costPilotScore: 100, costScaleScore: 100, termsOpsScore: 100 } as const;

const NONE = (): ReviewEntry => ({ classification: 'NONE', criticalClass: null, cleared: false, clearingAction: null });

async function evaluate(
  components: Component[],
  opts: { review?: (caseId: string, component: string) => ReviewEntry | undefined; rate?: number; inputs?: ScoringInputs | null },
) {
  let t = 0;
  const run = await runBenchmark(cases.points, cases.routes, components, {
    caseListVersion: 'LHR-SP04-CASES-TEST',
    repeats: 1,
    concurrency: 1,
    guard: new BudgetGuard(null, NOW),
    now: () => NOW,
    clock: () => (t += 50),
  });
  const sheet = blindSheet(run, (items) => items);
  const filled = sheet.csv
    .trimEnd()
    .split('\n')
    .map((line, i) => (i === 0 ? line : `${line}${String(opts.rate ?? 3)}`))
    .join('\n');
  const ratings = readRatings(filled, sheet.key);
  const review = new Map<string, ReviewEntry>();
  for (const r of run.routes) {
    const entry = (opts.review ?? NONE)(r.caseId, r.component);
    if (entry !== undefined) review.set(`${r.caseId}|${r.component}`, entry);
  }
  const { components: metrics, evidence } = computeMetrics({ cases, run, ratings, review, truths, peakSessions: new Set(['LHR-SP04-S4']) });
  const scored = scoreBundles(
    metrics,
    opts.inputs === undefined ? { bundles: { S1: PASS_INPUTS, S2: PASS_INPUTS, S3: PASS_INPUTS } } : opts.inputs,
    run.status === 'COMPLETE',
  );
  return { run, metrics, evidence, ...scored };
}

describe('fixed pre-measurement values (FA-07)', () => {
  it('pins every threshold, floor/target and weight', () => {
    expect(THRESHOLDS).toEqual({
      geocodeTop1: { gate: 0.8, floor: 0.5, target: 0.9 },
      geocodeTop3: { gate: 0.9, floor: 0.6, target: 0.97 },
      reverseUseful: { gate: 0.8, floor: 0.4, target: 0.9 },
      routeDistanceMedianPct: { gate: 10, floor: 25, target: 3 },
      routeDistanceP90GatePct: 20,
      etaOffPeakAbsMedianPct: { gate: 20, floor: 40, target: 8 },
      autocompleteTop5: { gate: 0.85, floor: 0.5, target: 0.95 },
      constraintPlausibility: { gate: null, floor: 0.5, target: 1 },
      failureRate: { gate: 0.05, floor: 0.2, target: 0.01 },
      urduHandling: { gate: null, floor: 0, target: 1 },
    });
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(
      WEIGHTS.geocodeTop1 + WEIGHTS.geocodeTop3 + WEIGHTS.autocompleteTop5 + WEIGHTS.routeDistance + WEIGHTS.etaOffPeak + WEIGHTS.constraintPlausibility,
    ).toBe(40);
    expect(WEIGHTS.reverseUseful + WEIGHTS.failureRate + WEIGHTS.urduHandling).toBe(20);
    expect(Object.isFrozen(THRESHOLDS) && Object.isFrozen(WEIGHTS) && Object.isFrozen(ASSUMPTIONS)).toBe(true);
  });

  it('normalises ascending and descending metrics', () => {
    expect(normalise(0.9, THRESHOLDS.geocodeTop1)).toBe(100);
    expect(normalise(0.7, THRESHOLDS.geocodeTop1)).toBeCloseTo(50);
    expect(normalise(0.4, THRESHOLDS.geocodeTop1)).toBe(0);
    expect(normalise(3, THRESHOLDS.routeDistanceMedianPct)).toBe(100);
    expect(normalise(14, THRESHOLDS.routeDistanceMedianPct)).toBeCloseTo(50);
    expect(normalise(30, THRESHOLDS.routeDistanceMedianPct)).toBe(0);
  });
});

describe('threshold application and eligibility', () => {
  it('a bundle meeting every threshold with complete inputs is ELIGIBLE', async () => {
    const { results, metrics } = await evaluate(fakeComponents('S3', truthByQuery, GOOD), {});
    expect(results).toHaveLength(1);
    const b = results[0]!;
    expect(b.thresholds.every((t) => t.pass === true)).toBe(true);
    expect(b.eligibility).toBe('ELIGIBLE');
    expect(b.score.missingWeight).toBe(0);
    expect(b.score.total).toBeGreaterThan(80);
    const route = metrics.find((m) => m.kind === 'ROUTE')?.route;
    expect(route?.distanceErrorMedianPct).toBeCloseTo(2);
    expect(route?.etaOffPeak.n).toBe(3);
    expect(route?.etaPeak.n).toBe(1);
  });

  it('a missed quantitative threshold yields SHORTFALL_NEEDS_FOUNDER_ACCEPTANCE', async () => {
    const { results } = await evaluate(fakeComponents('S3', truthByQuery, { ...GOOD, answerOffsetM: 120 }), {});
    const b = results[0]!;
    expect(b.thresholds.find((t) => t.metric === 'geocode_top1_within_50m')).toMatchObject({ value: 0, pass: false });
    expect(b.thresholds.find((t) => t.metric === 'autocomplete_top5_overall')?.pass).toBe(false);
    expect(b.gates.G4.status).toBe('SHORTFALL');
    expect(b.eligibility).toBe('SHORTFALL_NEEDS_FOUNDER_ACCEPTANCE');
  });

  it('an unresolved CRITICAL route finding makes a high-scoring bundle INELIGIBLE (hard gate)', async () => {
    const critical: ReviewEntry = { classification: 'CRITICAL', criticalClass: 'WRONG_WAY', cleared: false, clearingAction: null };
    const { results } = await evaluate(fakeComponents('S3', truthByQuery, GOOD), {
      review: (caseId) => (caseId === 'LHR-SP04-010' ? critical : { classification: 'NONE', criticalClass: null, cleared: false, clearingAction: null }),
    });
    const b = results[0]!;
    expect(b.score.total).toBeGreaterThan(80);
    expect(b.unresolvedCritical).toBe(1);
    expect(b.gates.G4.status).toBe('FAIL');
    expect(b.eligibility).toBe('INELIGIBLE');
    expect(b.reasons[0]).toMatch(/UNRESOLVED_CRITICAL_ROUTE/);
  });

  it('a CRITICAL finding cleared with a §7.1 clearing action no longer blocks', async () => {
    const cleared: ReviewEntry = { classification: 'CRITICAL', criticalClass: 'WRONG_WAY', cleared: true, clearingAction: 'GROUND_TRUTH_CORRECTED' };
    const { results } = await evaluate(fakeComponents('S3', truthByQuery, GOOD), {
      review: (caseId) => (caseId === 'LHR-SP04-010' ? cleared : { classification: 'NONE', criticalClass: null, cleared: false, clearingAction: null }),
    });
    expect(results[0]?.unresolvedCritical).toBe(0);
    expect(results[0]?.eligibility).not.toBe('INELIGIBLE');
  });

  it('missing review, ratings or scoring inputs keep the bundle PENDING', async () => {
    const unreviewed = await evaluate(fakeComponents('S3', truthByQuery, GOOD), { review: () => undefined });
    expect(unreviewed.results[0]?.gates.G4.status).toBe('PENDING');
    expect(unreviewed.results[0]?.eligibility).toBe('PENDING');
    const noInputs = await evaluate(fakeComponents('S3', truthByQuery, GOOD), { inputs: null });
    expect(noInputs.results[0]?.eligibility).toBe('PENDING');
    expect(noInputs.results[0]?.score.missingWeight).toBe(WEIGHTS.costPilot + WEIGHTS.costScale + WEIGHTS.termsOps);
  });

  it('S2 cannot pass G1 while FA-19 has no written answer; a FAIL gate input makes a bundle INELIGIBLE', async () => {
    const s2 = await evaluate(fakeComponents('S2', truthByQuery, GOOD), {});
    expect(s2.results[0]?.gates.G1.status).toBe('FAIL');
    expect(s2.results[0]?.eligibility).toBe('INELIGIBLE');
    const s2ok = await evaluate(fakeComponents('S2', truthByQuery, GOOD), { inputs: { bundles: { S2: { ...PASS_INPUTS, fa19WrittenConfirmation: true } } } });
    expect(s2ok.results[0]?.eligibility).toBe('ELIGIBLE');
    const g2 = await evaluate(fakeComponents('S1', truthByQuery, GOOD), { inputs: { bundles: { S1: { ...PASS_INPUTS, G2: 'FAIL' } } } });
    expect(g2.results[0]?.eligibility).toBe('INELIGIBLE');
  });

  it('enumerates configurations inside a bundle and reports bundles with a missing SKU as not scored', async () => {
    const s3 = fakeComponents('S3', truthByQuery, GOOD);
    const extraRoute = { ...(s3.find((c) => c.kind === 'ROUTE') as Component), id: 'S3-route-b' } as Component;
    const partial = fakeComponents('S1', truthByQuery, GOOD).filter((c) => c.kind !== 'ROUTE');
    const { results, incomplete } = await evaluate([...s3, extraRoute, ...partial], {});
    expect(results.map((r) => r.configuration['ROUTE'])).toEqual(['S3-route', 'S3-route-b']);
    expect(incomplete).toEqual([{ bundle: 'S1', missing: ['ROUTE'] }]);
  });
});

describe('aggregate report and bench-data guard', () => {
  it('contains no coordinates or founder text and passes the guard', async () => {
    const { run, metrics, evidence, results, incomplete } = await evaluate(fakeComponents('S3', truthByQuery, GOOD), {});
    const report = buildReport({ run, cases, components: metrics, evidence, bundles: results, incompleteBundles: incomplete });
    const json = JSON.stringify(report);
    const md = renderMarkdown(report);
    expect(() => {
      assertAggregateSafe(json, cases.freeTextValues);
    }).not.toThrow();
    expect(() => {
      assertAggregateSafe(md, cases.freeTextValues);
    }).not.toThrow();
    for (const p of cases.points) {
      expect(json).not.toContain(p.truth.lat.toFixed(3));
      expect(json).not.toContain('Synthetic Place');
    }
    expect(md).toContain('ELIGIBLE');
    expect(report.assumptions).toEqual(ASSUMPTIONS);
  });

  it.each([
    ['{"lat":31.52345}', /4\+ decimals/],
    ['token pk.abcdefghijklmnopqrstuvwxyz0123', /key-shaped/],
    ['AIzaSyAbcdefghijklmnopqrstuvwxyz12345', /key-shaped/],
    [`name ${String.fromCodePoint(0x0645, 0x0627)}`, /Arabic-script/],
    ['note: Synthetic gate 3', /founder free text/],
  ])('refuses %s', (text, message) => {
    expect(() => {
      assertAggregateSafe(text, ['Synthetic gate 3']);
    }).toThrow(UnsafeAggregateError);
    expect(() => {
      assertAggregateSafe(text, ['Synthetic gate 3']);
    }).toThrow(message);
  });
});
