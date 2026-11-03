import { describe, expect, it } from 'vitest';
import { GeoAdapterError } from '@wayvro/geo-adapters';
import { BudgetGuard } from './budget.js';
import { DESK_NA_COLUMNS, validateCapture } from './cases.js';
import { parseCsv } from './csv.js';
import { DESK_STAMP, areaMatches, deskReviewSheet, deskRouteRows, deskSection, routeSanity } from './desk.js';
import { haversineM } from './geo.js';
import { legTruths } from './gpx.js';
import { computeMetrics } from './metrics.js';
import { assertAggregateSafe, buildReport, renderMarkdown } from './report.js';
import { runBenchmark } from './runner.js';
import { scoreBundles } from './score.js';
import { readReview } from './sheets.js';
import { deskCsv, fakeComponents, syntheticCsv } from '../test/fixtures.js';

const NOW = new Date('2026-10-13T06:00:00.000Z');
const tick = () => {
  let t = 0;
  return () => (t += 7);
};

describe('DESK_OSM case source', () => {
  it('accepts a desk sheet only in desk mode, with field-only values null (never invented)', () => {
    const desk = validateCapture(deskCsv(8, 4), { source: 'DESK_OSM' });
    expect(desk.errors).toEqual([]);
    expect(desk.source).toBe('DESK_OSM');
    expect(desk.points).toHaveLength(8);
    expect(desk.routes[0]).toMatchObject({
      originId: 'LHR-DESK-001',
      date: null,
      timeLocal: null,
      trafficLevel: null,
      odometerKm: null,
      actualMinutes: null,
      followedNaturalRoute: null,
      gpxFileRef: null,
    });
    // A desk leg has no drive, so no D_true.
    expect(legTruths(desk.routes, new Map()).size).toBe(0);
  });

  it('never mixes sources: a desk sheet fails field validation and a field sheet fails desk validation', () => {
    const asField = validateCapture(deskCsv(2, 1));
    expect(asField.errors.some((e) => e.field === 'case_id')).toBe(true);
    expect(asField.errors.some((e) => e.field === 'captured_by')).toBe(true);
    const asDesk = validateCapture(syntheticCsv(2, 1), { source: 'DESK_OSM' });
    expect(asDesk.errors.some((e) => e.field === 'case_id')).toBe(true);
    expect(asDesk.errors.some((e) => e.field === 'captured_by' && /DESK_OSM/.test(e.message))).toBe(true);
  });

  it('requires N/A in every field-only column of a desk sheet', () => {
    const rows = parseCsv(deskCsv(2, 1));
    const header = rows[0] ?? [];
    for (const column of DESK_NA_COLUMNS) {
      const i = header.indexOf(column);
      const changed = rows.map((r, n) => (n === 1 ? r.map((v, j) => (j === i ? '5' : v)) : r));
      const result = validateCapture(changed.map((r) => r.join(',')).join('\n'), { source: 'DESK_OSM' });
      expect(result.errors.some((e) => e.field === column && /N\/A/.test(e.message))).toBe(true);
    }
  });
});

describe('route sanity (T3-06)', () => {
  const a = { lat: 31.5, lng: 74.3 };
  const b = { lat: 31.51, lng: 74.3 };
  const gc = haversineM(a, b);
  it('flags a physically impossible distance, a ratio outlier and a missing duration', () => {
    expect(routeSanity(gc * 1.3, 300, a, b)).toEqual([]);
    expect(routeSanity(gc * 0.9, 300, a, b)).toEqual(['SHORTER_THAN_GREAT_CIRCLE']);
    // Within the geodesic lower bound (≈ 0.56 % below the mean-radius distance) and the 1 m tolerance: not flagged.
    expect(routeSanity(gc * 0.997, 300, a, b)).toEqual([]);
    expect(routeSanity(gc * 3.2, null, a, b)).toEqual(['ROUTE_RATIO_OUTLIER', 'NO_DURATION']);
  });
});

describe('areaMatches', () => {
  it('matches any |-separated expected string, case- and width-insensitively', () => {
    const place = { name: 'Some Market', block: null, area: 'Gulberg III', city: 'Lahore', nameUrdu: null };
    expect(areaMatches('gulberg|Model Town', place)).toBe(true);
    expect(areaMatches('Model Town', place)).toBe(false);
    expect(areaMatches(' | ', place)).toBe(false);
    expect(areaMatches('Gulberg', null)).toBe(false);
  });
});

describe('desk run → review → score (hard gate unchanged)', () => {
  it('runs desk cases, writes an automated review that the §7.1 hard gate consumes, and keeps the aggregate safe', async () => {
    const cases = validateCapture(deskCsv(8, 4), { source: 'DESK_OSM' });
    const truthByQuery = new Map(cases.points.map((p) => [p.queries.en ?? '', p.truth]));
    // The fake route distance is fixed (10 km × factor); the synthetic legs are ≈ 1.46 km apart.
    const impossible = fakeComponents('S3', truthByQuery, { answerOffsetM: 10, routeDistanceFactor: 0.1, routeDurationFactor: 1 });
    const run = await runBenchmark(cases.points, cases.routes, impossible, {
      caseSource: 'DESK_OSM',
      caseListVersion: 'TEST-DESK',
      repeats: 2,
      concurrency: 2,
      guard: new BudgetGuard(null, NOW),
      now: () => NOW,
      clock: tick(),
    });
    expect(run.caseSource).toBe('DESK_OSM');
    expect(run.calls.every((c) => c.caseId.startsWith('LHR-DESK-') && c.atMs >= 0)).toBe(true);
    expect(run.calls.filter((c) => c.sku === 'ROUTE').map((c) => c.repeat)).toEqual(expect.arrayContaining([0, 1]));

    const rows = deskRouteRows(cases, run);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.flags.includes('SHORTER_THAN_GREAT_CIRCLE'))).toBe(true);
    const review = readReview(deskReviewSheet(rows));
    expect([...review.values()].every((e) => e.classification === 'CRITICAL' && e.criticalClass === 'UNSAFE_OR_IMPOSSIBLE' && !e.cleared)).toBe(true);

    const { components, evidence } = computeMetrics({
      cases,
      run,
      ratings: new Map(),
      review,
      truths: legTruths(cases.routes, new Map()),
      peakSessions: new Set(),
    });
    const route = components.find((c) => c.kind === 'ROUTE')?.route;
    expect(route?.unresolvedCritical).toBe(4);
    expect(route?.distanceLegs).toBe(0);
    const { results } = scoreBundles(components, null, run.status === 'COMPLETE');
    expect(results[0]?.eligibility).toBe('INELIGIBLE');
    expect(results[0]?.gates.G4.status).toBe('FAIL');

    const desk = deskSection(cases, run);
    expect(desk.routes[0]).toMatchObject({ legs: 4, answered: 4, shorterThanGreatCircle: 4, withEta: 4 });
    expect(desk.latency.find((l) => l.sku === 'ROUTE')).toMatchObject({ cold: { n: 4 }, warm: { n: 4 } });
    expect(desk.failures.every((f) => f.breakerCountable === 0)).toBe(true);
    const report = buildReport({ run, cases, components, evidence, bundles: results, incompleteBundles: [], desk });
    const md = renderMarkdown(report);
    expect(report.title.startsWith('DESK — NOT FIELD')).toBe(true);
    expect(md).toContain(DESK_STAMP);
    expect(() => {
      assertAggregateSafe(JSON.stringify(report), cases.freeTextValues);
    }).not.toThrow();
    expect(() => {
      assertAggregateSafe(md, cases.freeTextValues);
    }).not.toThrow();
  });

  it('classifies degraded calls with the adapter breaker rule and records recovery', async () => {
    const cases = validateCapture(deskCsv(4, 3), { source: 'DESK_OSM' });
    const truthByQuery = new Map(cases.points.map((p) => [p.queries.en ?? '', p.truth]));
    let n = 0;
    const comps = fakeComponents('S3', truthByQuery, { answerOffsetM: 10, routeDistanceFactor: 0.2, routeDurationFactor: 1 }).map((c) =>
      c.kind === 'ROUTE'
        ? {
            ...c,
            adapter: {
              route: (input: Parameters<typeof c.adapter.route>[0], signal: AbortSignal) =>
                (n += 1) <= 2 ? Promise.reject(new GeoAdapterError('geo-x', 'ROUTE', 'NETWORK')) : c.adapter.route(input, signal),
            },
          }
        : c,
    );
    const run = await runBenchmark(cases.points, cases.routes, comps, {
      caseSource: 'DESK_OSM',
      caseListVersion: 'TEST-DESK',
      repeats: 1,
      concurrency: 1,
      guard: new BudgetGuard(null, NOW),
      now: () => NOW,
      clock: tick(),
    });
    const desk = deskSection(cases, run);
    const failure = desk.failures.find((f) => f.component === 'S3-route');
    expect(failure).toMatchObject({ errors: { NETWORK: 2 }, breakerCountable: 2, maxConsecutiveBreakerCountable: 2, okAfterLastError: 1 });
    expect(desk.routes[0]?.errors).toEqual({ NETWORK: 2 });
    const review = readReview(deskReviewSheet(deskRouteRows(cases, run)));
    expect([...review.values()].filter((e) => e.classification === 'NOT_APPLICABLE')).toHaveLength(2);
  });
});
