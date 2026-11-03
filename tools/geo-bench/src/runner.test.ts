import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GeoAdapterError } from '@wayvro/geo-adapters';
import type { GeoPoint, PlacesAutocompletePort } from '@wayvro/provider-interfaces';
import { describe, expect, it } from 'vitest';
import { BudgetGuard, BudgetStopError, FREE_ALLOWANCE_PER_MONTH, stopLimit } from './budget.js';
import { validateCapture } from './cases.js';
import type { Component } from './components.js';
import { nextDeparture, planUsage, planViolations, prefixesOf, runBenchmark } from './runner.js';
import { fakeComponents, syntheticCsv } from '../test/fixtures.js';

const NOW = new Date('2026-10-13T06:00:00Z');
const cases = validateCapture(syntheticCsv(4, 2));
const truthByQuery = new Map<string, GeoPoint>(cases.points.flatMap((p) => Object.values(p.queries).map((q) => [q, p.truth] as [string, GeoPoint])));
const good = { answerOffsetM: 10, routeDistanceFactor: 1.02, routeDurationFactor: 1.1 };

function tick(): () => number {
  let t = 0;
  return () => (t += 7);
}

describe('budget guard', () => {
  it('stops at 80 % of the free allowance and records nothing for a refused reservation', () => {
    const guard = new BudgetGuard(null, NOW, { 'mapbox:searchbox-sessions': stopLimit('mapbox:searchbox-sessions') - 2 });
    guard.reserve('mapbox:searchbox-sessions', 2);
    expect(() => {
      guard.reserve('mapbox:searchbox-sessions', 1);
    }).toThrow(BudgetStopError);
    expect(guard.usedUnits('mapbox:searchbox-sessions')).toBe(2000);
    expect(stopLimit('mapbox:searchbox-sessions')).toBe(FREE_ALLOWANCE_PER_MONTH['mapbox:searchbox-sessions'] * 0.8);
    guard.reserve('mapbox:directions', 0);
  });

  it('persists usage per month in a ledger and refuses a malformed ledger', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geo-bench-ledger-'));
    const ledger = join(dir, 'usage-ledger.json');
    const first = new BudgetGuard(ledger, NOW);
    first.reserve('google:geocoding', 7);
    first.save();
    const second = new BudgetGuard(ledger, NOW);
    expect(second.usedUnits('google:geocoding')).toBe(7);
    expect(new BudgetGuard(ledger, new Date('2026-11-01T00:00:00Z')).usedUnits('google:geocoding')).toBe(0);
    expect(JSON.parse(readFileSync(ledger, 'utf8'))).toMatchObject({ '2026-10': { 'google:geocoding': 7 } });
    writeFileSync(ledger, '{"bad":1}');
    expect(() => new BudgetGuard(ledger, NOW)).toThrow(/malformed/);
  });
});

describe('planning', () => {
  it('computes prefixes, an upper-bound plan and refuses a plan above the stop limit', () => {
    expect(prefixesOf('Synthetic')).toEqual([3, 5, 8]);
    expect(prefixesOf('abcde')).toEqual([3]);
    const google: Component[] = fakeComponents('S1', truthByQuery, good).map((c) =>
      c.kind === 'AUTOCOMPLETE' && c.mode === 'suggest-resolve'
        ? { ...c, suggestBucket: 'google:autocomplete-requests', resolveBucket: 'google:place-details-essentials' }
        : c.kind === 'AUTOCOMPLETE'
          ? c
          : { ...c, bucket: c.kind === 'ROUTE' ? 'google:routes-essentials' : 'google:geocoding' },
    );
    const plan = planUsage(cases.points, cases.routes, google, 3);
    // 4 points × 2 languages × (3 prefixes + 3 repeats) suggests; 5 resolves each; geocode + reverse 4 × 3 each; routes 2 × 3.
    expect(Object.fromEntries(plan)).toEqual({
      'google:autocomplete-requests': 48,
      'google:place-details-essentials': 40,
      'google:geocoding': 24,
      'google:routes-essentials': 6,
    });
    expect(planViolations(plan, new BudgetGuard(null, NOW))).toEqual([]);
    const nearlyFull = new BudgetGuard(null, NOW, { 'google:geocoding': stopLimit('google:geocoding') - 10 });
    expect(planViolations(plan, nearlyFull)).toEqual([{ bucket: 'google:geocoding', planned: 24, used: stopLimit('google:geocoding') - 10, stopAt: 8000 }]);
  });

  it('plans Search Box sessions conservatively', () => {
    const mapbox = fakeComponents('S2', truthByQuery, good).map((c) =>
      c.kind === 'AUTOCOMPLETE' && c.mode === 'suggest-resolve' ? { ...c, suggestBucket: 'mapbox:searchbox-sessions' as const, sessionBilled: true } : c,
    );
    expect(planUsage(cases.points, [], mapbox, 3).get('mapbox:searchbox-sessions')).toBe(4 * 2 * 5);
  });

  it('departs on the next same weekday at the same Asia/Karachi local time', () => {
    // 2026-10-21 is a Wednesday; 11:30 PKT = 06:30 UTC.
    expect(nextDeparture('2026-10-21', '11:30', NOW).toISOString()).toBe('2026-10-14T06:30:00.000Z');
    expect(nextDeparture('2026-10-20', '05:00', NOW).toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });
});

describe('runBenchmark', () => {
  it('runs every component with identical inputs and records calls, ranks inputs and routes', async () => {
    const guard = new BudgetGuard(null, NOW);
    const run = await runBenchmark(cases.points, cases.routes, fakeComponents('S3', truthByQuery, good), {
      caseListVersion: 'TEST',
      repeats: 2,
      concurrency: 3,
      guard,
      now: () => NOW,
      clock: tick(),
      newSessionId: () => '6f1c2b8e-0000-4000-8000-000000000000',
    });
    expect(run.status).toBe('COMPLETE');
    expect(run.autocomplete).toHaveLength(8);
    expect(run.geocode).toHaveLength(4);
    expect(run.reverse).toHaveLength(4);
    expect(run.routes).toHaveLength(2);
    const ac = run.autocomplete[0]!;
    expect(ac.prefixes.map((p) => p.prefixLength)).toEqual([3, 5, 8, null]);
    expect(ac.resolved).toHaveLength(2);
    expect(run.calls.filter((c) => c.sku === 'ROUTE')).toHaveLength(4);
    expect(run.calls.every((c) => Number.isInteger(c.latencyMs) && c.latencyMs > 0)).toBe(true);
  });

  it('records typed adapter failures as observations and stops at the budget hard stop', async () => {
    const failing: PlacesAutocompletePort = { suggest: () => Promise.reject(new GeoAdapterError('geo-x', 'AUTOCOMPLETE', 'QUOTA', 429)) };
    const comps = fakeComponents('S1', truthByQuery, good).map((c) =>
      c.kind === 'AUTOCOMPLETE' && c.mode === 'suggest-resolve' ? { ...c, suggest: failing, suggestBucket: 'google:autocomplete-requests' as const } : c,
    );
    const guard = new BudgetGuard(null, NOW, { 'google:autocomplete-requests': stopLimit('google:autocomplete-requests') - 5 });
    const run = await runBenchmark(cases.points, cases.routes, comps, {
      caseListVersion: 'TEST',
      repeats: 1,
      concurrency: 1,
      guard,
      now: () => NOW,
      clock: tick(),
    });
    expect(run.status).toBe('BUDGET_STOPPED');
    expect(run.stoppedBucket).toBe('google:autocomplete-requests');
    const acCalls = run.calls.filter((c) => c.sku === 'AUTOCOMPLETE');
    expect(acCalls).toHaveLength(5);
    expect(acCalls.every((c) => c.outcome === 'ERROR' && c.errorCode === 'QUOTA')).toBe(true);
    expect(guard.usedUnits('google:autocomplete-requests')).toBe(stopLimit('google:autocomplete-requests'));
  });

  it('rethrows programming errors instead of hiding them', async () => {
    const broken: PlacesAutocompletePort = { suggest: () => Promise.reject(new TypeError('bug')) };
    const comps = fakeComponents('S1', truthByQuery, good).map((c) =>
      c.kind === 'AUTOCOMPLETE' && c.mode === 'suggest-resolve' ? { ...c, suggest: broken } : c,
    );
    await expect(
      runBenchmark(cases.points, [], comps, { caseListVersion: 'TEST', repeats: 1, concurrency: 1, guard: new BudgetGuard(null, NOW) }),
    ).rejects.toThrow('bug');
  });
});
