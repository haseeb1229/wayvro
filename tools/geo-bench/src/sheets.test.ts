import { describe, expect, it } from 'vitest';
import { validateCapture } from './cases.js';
import { legTruths } from './gpx.js';
import type { RunRecord } from './runner.js';
import { blindSheet, readRatings, readReview, reviewSheet, routeHints } from './sheets.js';
import { syntheticCsv } from '../test/fixtures.js';

const run: RunRecord = {
  version: 1,
  caseListVersion: 'TEST',
  startedAt: '2026-10-13T06:00:00.000Z',
  finishedAt: '2026-10-13T06:01:00.000Z',
  status: 'COMPLETE',
  stoppedBucket: null,
  repeats: 1,
  components: [],
  calls: [],
  autocomplete: [],
  geocode: [],
  reverse: [
    {
      caseId: 'LHR-SP04-001',
      component: 'S1-reverse',
      place: { name: 'Synthetic', block: null, area: 'Area', city: 'Lahore', nameUrdu: null },
      errorCode: null,
    },
    { caseId: 'LHR-SP04-001', component: 'S3-reverse', place: null, errorCode: null },
    { caseId: 'LHR-SP04-001', component: 'S2-reverse', place: null, errorCode: 'TIMEOUT' },
  ],
  routes: [
    { caseId: 'LHR-SP04-003', component: 'S3-osrm', distanceM: 20_000, durationS: 900, geometry: [], errorCode: null },
    { caseId: 'LHR-SP04-003', component: 'S1-routes', distanceM: null, durationS: null, geometry: [], errorCode: 'NO_ROUTE' },
  ],
  budget: {},
};

describe('blind rating sheet', () => {
  it('hides the component behind letters and un-blinds ratings through the key', () => {
    const { csv, key } = blindSheet(run, (items) => [...items].reverse());
    expect(csv).not.toMatch(/S1-reverse|S2-reverse|S3-reverse/);
    expect(key).toEqual({ 'LHR-SP04-001-A': 'S2-reverse', 'LHR-SP04-001-B': 'S3-reverse', 'LHR-SP04-001-C': 'S1-reverse' });
    expect(csv).toContain('NO_ANSWER_ERROR (scored 0)');
    expect(csv).toContain('NO_ADDRESS (scored 0)');
    const filled = csv.replace(
      'LHR-SP04-001-C,LHR-SP04-001,C,Synthetic,,Area,Lahore,,ANSWER,',
      'LHR-SP04-001-C,LHR-SP04-001,C,Synthetic,,Area,Lahore,,ANSWER,2',
    );
    expect(readRatings(filled, key)).toEqual(new Map([['LHR-SP04-001|S1-reverse', 2]]));
  });

  it('rejects malformed ratings and unknown ids', () => {
    const { csv, key } = blindSheet(run, (items) => items);
    expect(() => readRatings(csv.replace('ANSWER,', 'ANSWER,7'), key)).toThrow(/0, 1, 2 or 3/);
    expect(() => readRatings(csv, {})).toThrow(/unknown blind id/);
    expect(() => readRatings('a,b\n', key)).toThrow(/header/);
  });
});

describe('route review list', () => {
  const cases = validateCapture(syntheticCsv(2, 1, { 3: { followed_natural_route: 'N', notes_no_pii: 'closure' } }));
  const truths = legTruths(cases.routes, new Map());

  it('emits hints and pre-fills NOT_APPLICABLE for failed routes', () => {
    const hints = routeHints(run, cases, truths);
    expect(hints.get('LHR-SP04-003|S3-osrm')).toEqual(['CHECK_CONSTRAINT', 'DIVERTED_LEG', 'NO_GPX', 'DISTANCE_ERROR_GT_25PCT']);
    const csv = reviewSheet(run, cases, hints);
    expect(csv.split('\n')[1]).toBe('LHR-SP04-003,S3-osrm,C06,Y,ROUTE,CHECK_CONSTRAINT DIVERTED_LEG NO_GPX DISTANCE_ERROR_GT_25PCT,,,,');
    expect(csv.split('\n')[2]).toBe('LHR-SP04-003,S1-routes,C06,Y,ERROR NO_ROUTE,CHECK_CONSTRAINT DIVERTED_LEG NO_GPX,NOT_APPLICABLE,,,');
  });

  it('parses classifications and enforces the §7.1 fields', () => {
    const header = 'case_id,component,category,constraint_case,route_status,auto_hints,classification,critical_class,cleared,clearing_action';
    const review = readReview(`${header}\nLHR-SP04-003,S3-osrm,C06,Y,ROUTE,,CRITICAL,WRONG_WAY,Y,PROVIDER_FIX_RERUN\nLHR-SP04-004,S3-osrm,C07,Y,ROUTE,,,,,\n`);
    expect(review).toEqual(
      new Map([['LHR-SP04-003|S3-osrm', { classification: 'CRITICAL', criticalClass: 'WRONG_WAY', cleared: true, clearingAction: 'PROVIDER_FIX_RERUN' }]]),
    );
    expect(() => readReview(`${header}\nLHR-SP04-003,S3-osrm,C06,Y,ROUTE,,CRITICAL,,N,\n`)).toThrow(/critical_class/);
    expect(() => readReview(`${header}\nLHR-SP04-003,S3-osrm,C06,Y,ROUTE,,CRITICAL,WRONG_WAY,Y,\n`)).toThrow(/clearing_action/);
    expect(() => readReview(`${header}\nLHR-SP04-003,S3-osrm,C06,Y,ROUTE,,BAD,,,\n`)).toThrow(/route review row 2/);
    expect(() => readReview('x\n')).toThrow(/header/);
  });
});
