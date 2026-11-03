import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { estimateOffsetMs, median, nearestRank } from '../src/shared/stats.ts';
import { aggregate, CAPTURE_SHEET_COLUMNS, sheetRowCsv, toMarkdown } from '../receiver/aggregate-core.ts';
import type { Row } from '../receiver/rows.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const T0 = 1_760_000_000_000;
/** Device clock is 3 s behind the server: corrected = device + 3000. */
const OFFSET = 3_000;
const dev = (serverMs: number): number => serverMs - OFFSET;

function point(runId: string, seq: number, fixServerMs: number, recvMs: number, outcome: 'stored' | 'duplicate' = 'stored'): Row {
  return {
    k: 'point',
    ms: recvMs,
    runId,
    seq,
    fixTimeMs: dev(fixServerMs),
    accuracyBucketM: seq % 2 === 0 ? 5 : 10,
    deltaMBucket: 0,
    mocked: false,
    appState: 'background',
    fgsActive: true,
    batteryPct: 90 - Math.floor(seq / 240),
    powerSave: false,
    outcome,
  };
}
const clockSample = (runId: string, atServer: number): Row => ({
  k: 'clock',
  ms: atServer,
  runId,
  t0: dev(atServer) - 50,
  ts: atServer,
  t1: dev(atServer) + 50,
});

describe('statistics', () => {
  it('nearest-rank percentiles', () => {
    assert.equal(nearestRank([], 95), null);
    assert.equal(nearestRank([5], 50), 5);
    assert.equal(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
    assert.equal(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
    assert.equal(nearestRank([10, 1, 3, 2], 25), 1);
    assert.throws(() => nearestRank([1], 0));
  });

  it('median and round-trip offset estimation', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(estimateOffsetMs([{ t0: 1000, ts: 4100, t1: 1200 }]), 3000);
    // One slow round trip does not move the median.
    assert.equal(
      estimateOffsetMs([
        { t0: 0, ts: 3050, t1: 100 },
        { t0: 0, ts: 3050, t1: 100 },
        { t0: 0, ts: 9000, t1: 5000 },
      ]),
      3000,
    );
    assert.equal(estimateOffsetMs([]), null);
  });
});

describe('60-min aggregate (completeness, gaps, latency, offers)', () => {
  const runId = 'run-aaaa1111';
  const rows: Row[] = [
    { k: 'session', ms: T0 - 10_000, event: 'start' },
    { k: 'presence', ms: T0, runId, from: 'OFFLINE', to: 'ONLINE', reason: 'GO_ONLINE' },
    clockSample(runId, T0 + 1_000),
    clockSample(runId, T0 + 1_800_000),
  ];
  // 720 expected fixes at 5 s; seq 101..112 missing (a 65 s hole); every 20th point arrives 6 s late, the rest 1 s.
  for (let i = 1; i <= 720; i += 1) {
    if (i >= 101 && i <= 112) continue;
    const fix = T0 + 2_500 + 5_000 * (i - 1);
    rows.push(point(runId, i, fix, fix + (i % 20 === 0 ? 6_000 : 1_000)));
  }
  rows.push(point(runId, 5, T0 + 22_500, T0 + 400_000, 'duplicate'));
  // In the window but received after window end + 5 min grace: does not count.
  rows.push(point(runId, 999, T0 + 3_599_000, T0 + 3_600_000 + 301_000));
  rows.push({ k: 'stats', ms: T0 + 10_000, runId, bufferDepth: 5, bufferDrops: 0, fixesTotal: 5 });
  rows.push({ k: 'stats', ms: T0 + 900_000, runId, bufferDepth: 0, bufferDrops: 2, fixesTotal: 180 });
  for (let k = 0; k < 30; k += 1) {
    const emit = T0 + 60_000 + k * 120_000;
    const offerId = `of-k${String(k)}`;
    rows.push({ k: 'offer_emit', ms: emit, runId, offerId, expiresMs: emit + 20_000, socketConnected: true });
    const ack = (channel: 'socket' | 'poll' | 'snapshot', latencyMs: number): void => {
      rows.push({ k: 'offer_ack', ms: emit + latencyMs + 100, runId, offerId, channel, clientRecvDeviceMs: dev(emit + latencyMs), first: true });
    };
    if (k < 25) ack('socket', 500);
    else if (k === 25) ack('poll', 8_000);
    else if (k === 26) ack('snapshot', 15_000);
    else if (k === 27) ack('socket', 25_000);
  }
  rows.push({ k: 'presence', ms: T0 + 3_600_000 + 1_000, runId, from: 'ONLINE', to: 'OFFLINE', reason: 'USER_OFFLINE' });

  const a = aggregate(rows, { runId: 'latest', caseId: 'TC-03', intervalS: 5, windowMin: 60, windowStart: 'online', graceMin: 5 });

  it('picks the run, the window and the clock offset', () => {
    assert.equal(a.runId, runId);
    assert.equal(a.window.start, new Date(T0).toISOString());
    assert.equal(a.clock.offsetMs, OFFSET);
    assert.deepEqual(a.warnings, []);
  });

  it('computes offset-corrected completeness over the 60-min window', () => {
    assert.equal(a.points.expected, 720);
    assert.equal(a.points.receivedUnique, 708);
    assert.equal(a.points.completenessPct, 98.33);
  });

  it('finds gaps > 2x interval and the longest gap', () => {
    assert.equal(a.points.gapsGt2x, 1);
    assert.equal(a.points.longestGapS, 65);
    assert.equal(a.points.gapTotalS, 65);
  });

  it('reports nearest-rank delivery latency, drops and duplicates', () => {
    assert.equal(a.points.deliveryLatencyP50S, 1);
    assert.equal(a.points.deliveryLatencyP95S, 6);
    assert.equal(a.points.bufferDrops, 2);
    assert.equal(a.points.duplicatesReceived, 1);
    assert.equal(a.points.duplicatesStored, 0);
  });

  it('classifies offers by channel within validity and computes latency', () => {
    assert.equal(a.offers.emitted, 30);
    assert.equal(a.offers.live, 25);
    assert.equal(a.offers.polled, 1);
    assert.equal(a.offers.recovered, 1);
    assert.equal(a.offers.late, 1);
    assert.equal(a.offers.unacked, 2);
    assert.equal(a.offers.lost, 3);
    assert.equal(a.offers.latencyP50S, 0.5);
    assert.equal(a.offers.latencyP95S, 8);
  });

  it('fills the capture-sheet row and renders Markdown without coordinates', () => {
    assert.equal(a.sheetRow.completeness_pct, '98.33');
    assert.equal(a.sheetRow.offers_lost, '3');
    assert.equal(a.sheetRow.case_id, 'TC-03');
    const md = toMarkdown(a);
    assert.match(md, /completeness \(%\) \| 98\.33/);
    assert.doesNotMatch(md, /latitude|longitude/i);
    assert.equal(sheetRowCsv(a.sheetRow).split(',').length, CAPTURE_SHEET_COLUMNS.length);
  });
});

describe('detections, reconnects and silent deaths', () => {
  const b = 'run-bbbb2222';
  const c = 'run-cccc3333';
  const T1 = T0 + 1_000_000;
  const rows: Row[] = [
    { k: 'presence', ms: T0, runId: b, from: 'OFFLINE', to: 'ONLINE', reason: 'GO_ONLINE' },
    clockSample(b, T0 + 500),
    { k: 'host', ms: T0 + 100_000, action: 'restart-gateway', label: '3000' },
    { k: 'snapshot', ms: T0 + 103_500, via: 'reconnect', runId: b },
    { k: 'host', ms: T0 + 200_000, action: 'mark', label: 'wifi-off' },
    { k: 'presence', ms: T0 + 221_000, runId: b, from: 'ONLINE', to: 'STALE', reason: 'LIVENESS_LOST' },
    { k: 'host', ms: T0 + 260_000, action: 'mark', label: 'wifi-on' },
    { k: 'presence', ms: T0 + 262_000, runId: b, from: 'STALE', to: 'ONLINE', reason: 'LIVENESS_RESUMED' },
    { k: 'snapshot', ms: T0 + 264_200, via: 'reconnect', runId: b },
    { k: 'host', ms: T0 + 400_000, action: 'restrict' },
    { k: 'presence', ms: T0 + 400_000, runId: b, from: 'ONLINE', to: 'OFFLINE', reason: 'RESTRICTED' },
    { k: 'client_event', ms: T0 + 402_000, type: 'FORCED_OFFLINE_APPLIED', deviceMs: dev(T0 + 401_500), code: 'RESTRICTED:PRESENCE', runId: b },
    { k: 'presence', ms: T1, runId: c, from: 'OFFLINE', to: 'ONLINE', reason: 'GO_ONLINE' },
    clockSample(c, T1 + 500),
    point(c, 1, T1 + 45_000, T1 + 46_000),
    point(c, 2, T1 + 50_000, T1 + 51_000),
    { k: 'presence', ms: T1 + 70_500, runId: c, from: 'ONLINE', to: 'STALE', reason: 'LIVENESS_LOST' },
    { k: 'presence', ms: T1 + 170_500, runId: c, from: 'STALE', to: 'OFFLINE', reason: 'TRACKING_LOST' },
  ];

  it('measures reconnect + snapshot after gateway restart and network return', () => {
    const a = aggregate(rows, { runId: b, caseId: 'TC-06', intervalS: 5, windowMin: 10, windowStart: 'online', graceMin: 5 });
    assert.equal(a.reconnect.samples, 2);
    assert.equal(a.reconnect.snapshotP95S, 4.2);
    assert.equal(a.reconnect.unrecovered, 0);
  });

  it('measures detection from host actions (server STALE/OFFLINE, client signal)', () => {
    const a = aggregate(rows, { runId: b, caseId: 'TC-18', intervalS: 5, windowMin: 10, windowStart: 'online', graceMin: 5 });
    const wifiOff = a.detections.find((d) => d.action === 'mark:wifi-off');
    assert.equal(wifiOff?.serverStaleS, 21);
    assert.equal(wifiOff?.serverOfflineS, null);
    assert.equal(wifiOff?.detectS, 21);
    const restrict = a.detections.find((d) => d.action === 'restrict');
    assert.equal(restrict?.serverOfflineS, 0);
    assert.equal(restrict?.offlineReason, 'RESTRICTED');
    assert.equal(restrict?.clientSignalS, 1.5);
    assert.equal(restrict?.clientSignalType, 'FORCED_OFFLINE_APPLIED:RESTRICTED:PRESENCE');
    assert.equal(restrict?.detectS, 0);
    assert.equal(a.sheetRow.forced_offline_reason, 'RESTRICTED');
  });

  it('reports silent tracking loss relative to the last fix', () => {
    const a = aggregate(rows, { runId: c, caseId: 'TC-07', intervalS: 5, windowMin: 5, windowStart: 'online', graceMin: 5 });
    assert.deepEqual(a.silentDeaths, [{ offlineAt: new Date(T1 + 170_500).toISOString(), sinceLastFixStaleS: 20.5, sinceLastFixOfflineS: 120.5 }]);
    assert.equal(a.presence.offlineReasons['TRACKING_LOST'], 1);
  });

  it('times user-confirmed stops (TC-16/TC-17) from the client request', () => {
    const d = 'run-dddd4444';
    const T2 = T0 + 2_000_000;
    const stopRows: Row[] = [
      { k: 'presence', ms: T2, runId: d, from: 'OFFLINE', to: 'ONLINE', reason: 'GO_ONLINE' },
      clockSample(d, T2 + 500),
      { k: 'client_event', ms: T2 + 60_300, type: 'OFFLINE_REQUESTED', deviceMs: dev(T2 + 60_000), code: 'USER_OFFLINE', runId: d },
      { k: 'client_event', ms: T2 + 61_300, type: 'FGS_STOPPED', deviceMs: dev(T2 + 60_400), code: 'USER_OFFLINE', runId: d },
      { k: 'presence', ms: T2 + 61_200, runId: d, from: 'ONLINE', to: 'OFFLINE', reason: 'USER_OFFLINE' },
    ];
    const a = aggregate(stopRows, { runId: d, caseId: 'TC-16', intervalS: 5, windowMin: 5, windowStart: 'online', graceMin: 5 });
    assert.deepEqual(a.userStops, [
      { reason: 'USER_OFFLINE', requestedAt: new Date(T2 + 60_000).toISOString(), serverOfflineS: 1.2, serverReason: 'USER_OFFLINE', fgsStoppedS: 0.4 },
    ]);
    assert.match(toMarkdown(a), /User-confirmed stops/);
  });

  it('refuses a run that never went online', () => {
    assert.throws(() => aggregate(rows, { runId: 'run-none0000', caseId: 'TC-01', intervalS: 5, windowMin: 5, windowStart: 'online', graceMin: 5 }));
  });
});

describe('capture sheet header file', () => {
  it('matches the protocol §11 columns used by the aggregator', () => {
    const header = readFileSync(join(HERE, '..', 'capture-sheet-header.csv'), 'utf8').trim();
    assert.equal(header, CAPTURE_SHEET_COLUMNS.join(','));
  });
});
