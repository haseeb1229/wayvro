/**
 * SP-01 analysis (protocol §12) over the receiver's JSON-Lines rows. Pure function: rows in, aggregate out. The
 * output contains counts, percentages, latencies, detection times and reason codes only — no coordinates (none exist),
 * no device serials, no IP addresses.
 */
import { estimateOffsetMs, msToS, nearestRank, round } from '../src/shared/stats.ts';
import type { Row } from './rows.ts';

/** Protocol §11 capture-sheet columns, in order (capture-sheet-header.csv must match; test/aggregate.test.ts checks). */
export const CAPTURE_SHEET_COLUMNS = [
  'run_id',
  'date',
  'start_server_time',
  'duration_min',
  'oem_class',
  'model_class',
  'android_release',
  'api_level',
  'oem_build',
  'low_ram',
  'ram_total_gb',
  'candidate',
  'spike_commit',
  'config',
  'case_id',
  'interval_s',
  'expected_points',
  'received_points',
  'completeness_pct',
  'gaps_gt_2x',
  'longest_gap_s',
  'buffer_drops',
  'duplicates_stored',
  'delivery_latency_p50_s',
  'delivery_latency_p95_s',
  'process_deaths',
  'fgs_present_end',
  'offers_emitted',
  'offers_live',
  'offers_polled',
  'offers_recovered',
  'offers_lost',
  'offer_latency_p50_s',
  'offer_latency_p95_s',
  'reconnect_snapshot_p95_s',
  'detect_s',
  'forced_offline_reason',
  'battery_start_pct',
  'battery_end_pct',
  'drain_pct_per_h',
  'batterystats_mah',
  'result',
  'notes',
] as const;
export type SheetColumn = (typeof CAPTURE_SHEET_COLUMNS)[number];

/** Host marks (typed by the lead with `admin mark <label>`) after which a reconnect + snapshot is expected. */
export const RECONNECT_MARKS = ['net-on', 'wifi-on', 'airplane-off'] as const;
/** Host marks/actions whose detection time is measured (protocol §12 "Detection times"). */
export const DETECTION_MARKS = [
  'revoke-all',
  'revoke-while-in-use',
  'revoke-bg',
  'approx',
  'location-off',
  'swipe',
  'am-kill',
  'force-stop',
  'reboot',
  'crash-js',
  'crash-native',
  'net-off',
  'wifi-off',
  'airplane-on',
] as const;
const DETECTION_ADMIN_ACTIONS = ['restrict', 'force-offline'] as const;
const CLIENT_SIGNAL_TYPES = ['PERMISSION_REVOKED', 'PERMISSION_DOWNGRADED', 'PROVIDER_DISABLED', 'FORCED_OFFLINE_APPLIED', 'FGS_STOPPED'];
const SILENT_DEATH_LOOKBACK_MS = 180_000;

export type AggregateParams = {
  readonly runId: string | 'latest';
  readonly caseId: string;
  readonly intervalS: number;
  readonly windowMin: number;
  /** 'online' = the run's first server ONLINE transition; otherwise server epoch ms. */
  readonly windowStart: 'online' | number;
  readonly graceMin: number;
};

type PointRow = Extract<Row, { k: 'point' }>;
type PresenceRow = Extract<Row, { k: 'presence' }>;

export type DetectionResult = {
  readonly action: string;
  readonly atServerTime: string;
  readonly serverStaleS: number | null;
  readonly serverOfflineS: number | null;
  readonly offlineReason: string | null;
  readonly clientSignalS: number | null;
  readonly clientSignalType: string | null;
  readonly detectS: number | null;
};

export type Aggregate = {
  readonly kind: 'sp01-aggregate';
  readonly schemaVersion: 1;
  readonly caseId: string;
  readonly runId: string;
  readonly window: { readonly start: string; readonly end: string; readonly minutes: number; readonly graceMin: number };
  readonly clock: { readonly offsetMs: number | null; readonly samples: number; readonly corrected: boolean };
  readonly points: {
    readonly intervalS: number;
    readonly expected: number;
    readonly receivedUnique: number;
    readonly completenessPct: number | null;
    readonly gapsGt2x: number;
    readonly gapTotalS: number;
    readonly longestGapS: number;
    readonly deliveryLatencyP50S: number | null;
    readonly deliveryLatencyP95S: number | null;
    readonly bufferDrops: number;
    readonly duplicatesReceived: number;
    readonly duplicatesStored: number;
    readonly rejectedAfterOffline: number;
    readonly mockedPoints: number;
    readonly pointsWithoutFgs: number;
    readonly appState: Readonly<Record<string, number>>;
    readonly accuracyBucketP50M: number | null;
    readonly accuracyBucketP95M: number | null;
    readonly batteryFromPoints: { readonly startPct: number | null; readonly endPct: number | null; readonly pctPerHour: number | null };
  };
  readonly offers: {
    readonly emitted: number;
    readonly live: number;
    readonly polled: number;
    readonly recovered: number;
    readonly late: number;
    readonly unacked: number;
    readonly lost: number;
    readonly latencyP50S: number | null;
    readonly latencyP95S: number | null;
    readonly byChannelLatencyP95S: Readonly<Record<string, number | null>>;
  };
  readonly reconnect: { readonly samples: number; readonly snapshotP50S: number | null; readonly snapshotP95S: number | null; readonly unrecovered: number };
  readonly detections: readonly DetectionResult[];
  /** TC-16/TC-17: user-confirmed stop (client OFFLINE_REQUESTED) → server OFFLINE and → client FGS_STOPPED. */
  readonly userStops: readonly {
    readonly reason: string | null;
    readonly requestedAt: string;
    readonly serverOfflineS: number | null;
    readonly serverReason: string | null;
    readonly fgsStoppedS: number | null;
  }[];
  readonly silentDeaths: readonly { readonly offlineAt: string; readonly sinceLastFixStaleS: number | null; readonly sinceLastFixOfflineS: number | null }[];
  readonly presence: { readonly transitions: number; readonly offlineReasons: Readonly<Record<string, number>>; readonly finalState: string | null };
  readonly clientEvents: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
  readonly sheetRow: Readonly<Partial<Record<SheetColumn, string>>>;
};

const iso = (ms: number): string => new Date(ms).toISOString();
const inc = (rec: Record<string, number>, key: string): void => {
  rec[key] = (rec[key] ?? 0) + 1;
};

function pickRun(rows: readonly Row[], runId: string | 'latest'): string {
  if (runId !== 'latest') return runId;
  const onlines = rows.filter((r): r is PresenceRow => r.k === 'presence' && r.to === 'ONLINE' && r.runId !== null);
  const last = onlines.at(-1);
  if (!last?.runId) throw new Error('no run went ONLINE in this data file; pass --run <runId>');
  return last.runId;
}

export function aggregate(rows: readonly Row[], params: AggregateParams): Aggregate {
  if (!(params.intervalS > 0) || !(params.windowMin > 0) || params.graceMin < 0) throw new Error('invalid interval/window/grace');
  const warnings: string[] = [];
  const runId = pickRun(rows, params.runId);
  const intervalMs = params.intervalS * 1000;
  const presenceRows = rows.filter((r): r is PresenceRow => r.k === 'presence' && r.runId === runId);

  let windowStartMs: number;
  if (params.windowStart === 'online') {
    const firstOnline = presenceRows.find((r) => r.to === 'ONLINE');
    if (!firstOnline) throw new Error(`run ${runId} never went ONLINE; pass --window-start <server ms|ISO>`);
    windowStartMs = firstOnline.ms;
  } else {
    windowStartMs = params.windowStart;
  }
  const windowMs = params.windowMin * 60_000;
  const windowEndMs = windowStartMs + windowMs;
  const graceEndMs = windowEndMs + params.graceMin * 60_000;
  const inWindow = (ms: number): boolean => ms >= windowStartMs && ms < windowEndMs;

  // Clock offset: the run's own samples; fall back to every sample in the file (same device, same session).
  const runSamples = rows.filter((r): r is Extract<Row, { k: 'clock' }> => r.k === 'clock' && r.runId === runId);
  const samples = runSamples.length > 0 ? runSamples : rows.filter((r): r is Extract<Row, { k: 'clock' }> => r.k === 'clock');
  const offset = estimateOffsetMs(samples);
  if (offset === null) warnings.push('no clock samples: device times are NOT offset-corrected');
  if (runSamples.length === 0 && samples.length > 0) warnings.push('run has no own clock samples; used every sample in the file');
  const correct = (deviceMs: number): number => deviceMs + (offset ?? 0);

  // Points.
  const pointRows = rows.filter((r): r is PointRow => r.k === 'point' && r.runId === runId);
  const storedRows = pointRows.filter((r) => r.outcome === 'stored');
  const storedBySeq = new Map<number, PointRow[]>();
  for (const r of storedRows) storedBySeq.set(r.seq, [...(storedBySeq.get(r.seq) ?? []), r]);
  const duplicatesStored = [...storedBySeq.values()].filter((v) => v.length > 1).reduce((n, v) => n + v.length - 1, 0);
  const firstStored = [...storedBySeq.values()].map((v) => v[0]).filter((v): v is PointRow => v !== undefined);
  const windowPoints = firstStored
    .filter((r) => inWindow(correct(r.fixTimeMs)) && r.ms <= graceEndMs)
    .sort((a, b) => correct(a.fixTimeMs) - correct(b.fixTimeMs));
  const expected = Math.floor(windowMs / intervalMs);
  const receivedUnique = windowPoints.length;
  const completenessPct = expected > 0 ? round((receivedUnique / expected) * 100, 2) : null;
  if (completenessPct !== null && completenessPct > 100) warnings.push('completeness > 100 %: check the interval, the window or the device clock');

  const times = [windowStartMs, ...windowPoints.map((r) => correct(r.fixTimeMs)), windowEndMs];
  let gapsGt2x = 0;
  let gapTotalMs = 0;
  let longestGapMs = 0;
  for (let i = 1; i < times.length; i += 1) {
    const d = (times[i] ?? 0) - (times[i - 1] ?? 0);
    if (d > 2 * intervalMs) {
      gapsGt2x += 1;
      gapTotalMs += d;
    }
    longestGapMs = Math.max(longestGapMs, d);
  }
  const latencies = windowPoints.map((r) => r.ms - correct(r.fixTimeMs));
  const statsRows = rows.filter((r): r is Extract<Row, { k: 'stats' }> => r.k === 'stats' && r.runId === runId);
  const bufferDrops = statsRows.reduce((m, r) => Math.max(m, r.bufferDrops), 0);
  const appState: Record<string, number> = {};
  for (const r of windowPoints) inc(appState, r.appState);
  const accuracies = windowPoints.map((r) => r.accuracyBucketM).filter((v): v is number => v !== null);
  const battery = windowPoints.map((r) => r.batteryPct).filter((v): v is number => v !== null);
  const firstBattery = battery[0] ?? null;
  const lastBattery = battery.at(-1) ?? null;
  const spanH = windowPoints.length > 1 ? (correct(windowPoints.at(-1)?.fixTimeMs ?? 0) - correct(windowPoints[0]?.fixTimeMs ?? 0)) / 3_600_000 : 0;
  const mockedPoints = windowPoints.filter((r) => r.mocked).length;
  if (mockedPoints > 0) warnings.push(`${String(mockedPoints)} points carried the OS mock-location flag`);

  // Offers.
  const emits = rows.filter((r): r is Extract<Row, { k: 'offer_emit' }> => r.k === 'offer_emit' && r.runId === runId && inWindow(r.ms));
  const acks = rows.filter((r): r is Extract<Row, { k: 'offer_ack' }> => r.k === 'offer_ack' && r.runId === runId && r.first);
  const ackById = new Map(acks.map((a) => [a.offerId, a]));
  let live = 0;
  let polled = 0;
  let recovered = 0;
  let late = 0;
  let unacked = 0;
  const offerLatency: number[] = [];
  const byChannel: Record<string, number[]> = { socket: [], poll: [], snapshot: [] };
  for (const e of emits) {
    const a = ackById.get(e.offerId);
    if (!a) {
      unacked += 1;
      continue;
    }
    const recv = correct(a.clientRecvDeviceMs);
    if (recv > e.expiresMs) {
      late += 1;
      continue;
    }
    if (a.channel === 'socket') live += 1;
    else if (a.channel === 'poll') polled += 1;
    else recovered += 1;
    const lat = Math.max(0, recv - e.ms);
    offerLatency.push(lat);
    byChannel[a.channel]?.push(lat);
  }

  // Reconnect + snapshot after gateway restarts and network returns.
  const hosts = rows.filter((r): r is Extract<Row, { k: 'host' }> => r.k === 'host');
  const runStartMs = presenceRows[0]?.ms ?? windowStartMs;
  const runEndMs = Math.max(graceEndMs, presenceRows.at(-1)?.ms ?? 0);
  const inRun = (ms: number): boolean => ms >= runStartMs && ms <= runEndMs;
  const reconnectTriggers = hosts.filter(
    (h) => inRun(h.ms) && (h.action === 'restart-gateway' || (h.action === 'mark' && (RECONNECT_MARKS as readonly string[]).includes(h.label ?? ''))),
  );
  const reconnectSnaps = rows.filter((r): r is Extract<Row, { k: 'snapshot' }> => r.k === 'snapshot' && r.via === 'reconnect');
  const reconnectDurations: number[] = [];
  let unrecovered = 0;
  reconnectTriggers.forEach((h, i) => {
    const nextTrigger = reconnectTriggers[i + 1]?.ms ?? Number.POSITIVE_INFINITY;
    const snap = reconnectSnaps.find((s) => s.ms >= h.ms && s.ms < nextTrigger);
    if (snap) reconnectDurations.push(snap.ms - h.ms);
    else unrecovered += 1;
  });

  // Detection times.
  const detectionActions = hosts.filter(
    (h) =>
      inRun(h.ms) &&
      ((h.action === 'mark' && (DETECTION_MARKS as readonly string[]).includes(h.label ?? '')) ||
        (DETECTION_ADMIN_ACTIONS as readonly string[]).includes(h.action)),
  );
  const clientEvents = rows.filter((r): r is Extract<Row, { k: 'client_event' }> => r.k === 'client_event');
  const detections: DetectionResult[] = detectionActions.map((h, i) => {
    const until = detectionActions[i + 1]?.ms ?? Number.POSITIVE_INFINITY;
    const stale = presenceRows.find((p) => p.ms >= h.ms && p.ms < until && p.to === 'STALE');
    const off = presenceRows.find((p) => p.ms >= h.ms && p.ms < until && p.to === 'OFFLINE');
    const signal = clientEvents.find((c) => CLIENT_SIGNAL_TYPES.includes(c.type) && correct(c.deviceMs) >= h.ms && c.ms < until);
    const staleS = stale ? stale.ms - h.ms : null;
    const offS = off ? off.ms - h.ms : null;
    const sigS = signal ? correct(signal.deviceMs) - h.ms : null;
    const candidates = [staleS, offS, sigS].filter((v): v is number => v !== null);
    return {
      action: h.action === 'mark' ? `mark:${h.label ?? ''}` : h.action,
      atServerTime: iso(h.ms),
      serverStaleS: msToS(staleS),
      serverOfflineS: msToS(offS),
      offlineReason: off?.reason ?? null,
      clientSignalS: msToS(sigS),
      clientSignalType: signal ? `${signal.type}${signal.code ? `:${signal.code}` : ''}` : null,
      detectS: msToS(candidates.length ? Math.min(...candidates) : null),
    };
  });

  // User-confirmed stops. Corrected device times carry ± half a round trip of error, so the server OFFLINE is searched
  // from 2 s before the corrected request time and a small negative delta is reported as measured, not hidden.
  const runEvents = clientEvents.filter((c) => c.runId === runId);
  const userStops = runEvents
    .filter((c) => c.type === 'OFFLINE_REQUESTED')
    .map((req) => {
      const at = correct(req.deviceMs);
      const off = presenceRows.find((p) => p.to === 'OFFLINE' && p.ms >= at - 2_000);
      const stopped = runEvents.find((c) => c.type === 'FGS_STOPPED' && correct(c.deviceMs) >= at);
      return {
        reason: req.code ?? null,
        requestedAt: iso(at),
        serverOfflineS: off ? msToS(off.ms - at) : null,
        serverReason: off?.reason ?? null,
        fgsStoppedS: stopped ? msToS(correct(stopped.deviceMs) - at) : null,
      };
    });

  // Silent deaths: TRACKING_LOST with no host action shortly before it.
  const silentDeaths = presenceRows
    .filter((p) => p.to === 'OFFLINE' && p.reason === 'TRACKING_LOST')
    .filter((p) => !detectionActions.some((h) => h.ms <= p.ms && h.ms >= p.ms - SILENT_DEATH_LOOKBACK_MS))
    .map((p) => {
      const lastFix = firstStored
        .map((r) => correct(r.fixTimeMs))
        .filter((t) => t <= p.ms)
        .reduce((m, t) => Math.max(m, t), Number.NEGATIVE_INFINITY);
      const stale = [...presenceRows].reverse().find((q) => q.to === 'STALE' && q.ms <= p.ms);
      const hasFix = Number.isFinite(lastFix);
      return {
        offlineAt: iso(p.ms),
        sinceLastFixStaleS: hasFix && stale ? msToS(stale.ms - lastFix) : null,
        sinceLastFixOfflineS: hasFix ? msToS(p.ms - lastFix) : null,
      };
    });

  const offlineReasons: Record<string, number> = {};
  for (const p of presenceRows) if (p.to === 'OFFLINE') inc(offlineReasons, p.reason);
  const clientEventCounts: Record<string, number> = {};
  for (const c of clientEvents) if (c.runId === undefined || c.runId === runId) inc(clientEventCounts, c.type);
  const firstDetect = detections.find((d) => d.detectS !== null);
  const forcedReason = presenceRows.find((p) => p.to === 'OFFLINE' && p.reason !== 'USER_OFFLINE' && p.reason !== 'SIGNED_OUT')?.reason ?? null;

  const p50Lat = msToS(nearestRank(latencies, 50));
  const p95Lat = msToS(nearestRank(latencies, 95));
  const offerP50 = msToS(nearestRank(offerLatency, 50));
  const offerP95 = msToS(nearestRank(offerLatency, 95));
  const reconnectP95 = msToS(nearestRank(reconnectDurations, 95));
  const str = (v: number | null): string => (v === null ? '' : String(v));

  const sheetRow: Partial<Record<SheetColumn, string>> = {
    run_id: runId,
    date: iso(windowStartMs).slice(0, 10),
    start_server_time: iso(windowStartMs),
    duration_min: String(params.windowMin),
    case_id: params.caseId,
    interval_s: String(params.intervalS),
    expected_points: String(expected),
    received_points: String(receivedUnique),
    completeness_pct: str(completenessPct),
    gaps_gt_2x: String(gapsGt2x),
    longest_gap_s: str(msToS(longestGapMs)),
    buffer_drops: String(bufferDrops),
    duplicates_stored: String(duplicatesStored),
    delivery_latency_p50_s: str(p50Lat),
    delivery_latency_p95_s: str(p95Lat),
    offers_emitted: String(emits.length),
    offers_live: String(live),
    offers_polled: String(polled),
    offers_recovered: String(recovered),
    offers_lost: String(late + unacked),
    offer_latency_p50_s: str(offerP50),
    offer_latency_p95_s: str(offerP95),
    reconnect_snapshot_p95_s: str(reconnectP95),
    detect_s: str(firstDetect?.detectS ?? null),
    forced_offline_reason: forcedReason ?? '',
  };

  const channelP95: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(byChannel)) channelP95[k] = msToS(nearestRank(v, 95));

  return {
    kind: 'sp01-aggregate',
    schemaVersion: 1,
    caseId: params.caseId,
    runId,
    window: { start: iso(windowStartMs), end: iso(windowEndMs), minutes: params.windowMin, graceMin: params.graceMin },
    clock: { offsetMs: offset, samples: samples.length, corrected: offset !== null },
    points: {
      intervalS: params.intervalS,
      expected,
      receivedUnique,
      completenessPct,
      gapsGt2x,
      gapTotalS: msToS(gapTotalMs) ?? 0,
      longestGapS: msToS(longestGapMs) ?? 0,
      deliveryLatencyP50S: p50Lat,
      deliveryLatencyP95S: p95Lat,
      bufferDrops,
      duplicatesReceived: pointRows.filter((r) => r.outcome === 'duplicate').length,
      duplicatesStored,
      rejectedAfterOffline: pointRows.filter((r) => r.outcome === 'rejected_after_offline').length,
      mockedPoints,
      pointsWithoutFgs: windowPoints.filter((r) => !r.fgsActive).length,
      appState,
      accuracyBucketP50M: nearestRank(accuracies, 50),
      accuracyBucketP95M: nearestRank(accuracies, 95),
      batteryFromPoints: {
        startPct: firstBattery,
        endPct: lastBattery,
        pctPerHour: firstBattery !== null && lastBattery !== null && spanH > 0.25 ? round((firstBattery - lastBattery) / spanH, 2) : null,
      },
    },
    offers: {
      emitted: emits.length,
      live,
      polled,
      recovered,
      late,
      unacked,
      lost: late + unacked,
      latencyP50S: offerP50,
      latencyP95S: offerP95,
      byChannelLatencyP95S: channelP95,
    },
    reconnect: {
      samples: reconnectDurations.length,
      snapshotP50S: msToS(nearestRank(reconnectDurations, 50)),
      snapshotP95S: reconnectP95,
      unrecovered,
    },
    detections,
    userStops,
    silentDeaths,
    presence: { transitions: presenceRows.length, offlineReasons, finalState: presenceRows.at(-1)?.to ?? null },
    clientEvents: clientEventCounts,
    warnings,
    sheetRow,
  };
}

const csvCell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function sheetRowCsv(row: Readonly<Partial<Record<SheetColumn, string>>>): string {
  return CAPTURE_SHEET_COLUMNS.map((c) => csvCell(row[c] ?? '')).join(',');
}

const cell = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v));

export function toMarkdown(a: Aggregate): string {
  const lines: string[] = [];
  lines.push(`# SP-01 aggregate — ${a.caseId} — run ${a.runId}`);
  lines.push('');
  lines.push('Aggregates only (protocol §15): no coordinates were transmitted or stored; no device identifiers.');
  lines.push('');
  lines.push(
    `Window ${a.window.start} → ${a.window.end} (${String(a.window.minutes)} min, +${String(a.window.graceMin)} min grace). Clock offset ${cell(a.clock.offsetMs)} ms from ${String(a.clock.samples)} samples.`,
  );
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  const p = a.points;
  const rowsOut: [string, unknown][] = [
    ['interval (s)', p.intervalS],
    ['expected points', p.expected],
    ['received unique points', p.receivedUnique],
    ['completeness (%)', p.completenessPct],
    ['gaps > 2× interval', p.gapsGt2x],
    ['total gap time (s)', p.gapTotalS],
    ['longest gap (s)', p.longestGapS],
    ['delivery latency p50 / p95 (s)', `${cell(p.deliveryLatencyP50S)} / ${cell(p.deliveryLatencyP95S)}`],
    ['buffer drops', p.bufferDrops],
    ['duplicates received / stored', `${String(p.duplicatesReceived)} / ${String(p.duplicatesStored)}`],
    ['points rejected after server OFFLINE', p.rejectedAfterOffline],
    ['points without FGS flag', p.pointsWithoutFgs],
    ['mock-flagged points', p.mockedPoints],
    [
      'app state at fix',
      Object.entries(p.appState)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', '),
    ],
    ['accuracy bucket p50 / p95 (m)', `${cell(p.accuracyBucketP50M)} / ${cell(p.accuracyBucketP95M)}`],
    [
      'battery from points start → end (%/h, informational)',
      `${cell(p.batteryFromPoints.startPct)} → ${cell(p.batteryFromPoints.endPct)} (${cell(p.batteryFromPoints.pctPerHour)})`,
    ],
    ['offers emitted', a.offers.emitted],
    ['offers live (socket) / polled / recovered (snapshot)', `${String(a.offers.live)} / ${String(a.offers.polled)} / ${String(a.offers.recovered)}`],
    ['offers lost (late / never acked)', `${String(a.offers.lost)} (${String(a.offers.late)} / ${String(a.offers.unacked)})`],
    ['offer latency p50 / p95 (s)', `${cell(a.offers.latencyP50S)} / ${cell(a.offers.latencyP95S)}`],
    [
      'reconnect + snapshot p50 / p95 (s), samples, unrecovered',
      `${cell(a.reconnect.snapshotP50S)} / ${cell(a.reconnect.snapshotP95S)}, ${String(a.reconnect.samples)}, ${String(a.reconnect.unrecovered)}`,
    ],
    ['presence transitions / final state', `${String(a.presence.transitions)} / ${cell(a.presence.finalState)}`],
    [
      'offline reasons',
      Object.entries(a.presence.offlineReasons)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', '),
    ],
    [
      'client events',
      Object.entries(a.clientEvents)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', '),
    ],
  ];
  for (const [k, v] of rowsOut) lines.push(`| ${k} | ${cell(v)} |`);
  if (a.detections.length) {
    lines.push(
      '',
      '## Detection times (from host action, server clock)',
      '',
      '| Action | At | STALE (s) | OFFLINE (s) | Reason | Client signal (s) | Signal | detect_s |',
      '|---|---|---|---|---|---|---|---|',
    );
    for (const d of a.detections)
      lines.push(
        `| ${d.action} | ${d.atServerTime} | ${cell(d.serverStaleS)} | ${cell(d.serverOfflineS)} | ${cell(d.offlineReason)} | ${cell(d.clientSignalS)} | ${cell(d.clientSignalType)} | ${cell(d.detectS)} |`,
      );
  }
  if (a.userStops.length) {
    lines.push(
      '',
      '## User-confirmed stops (Go offline / Rider switch / Sign out)',
      '',
      '| Reason | Requested at | → server OFFLINE (s) | Server reason | → FGS stopped (s) |',
      '|---|---|---|---|---|',
    );
    for (const u of a.userStops)
      lines.push(`| ${cell(u.reason)} | ${u.requestedAt} | ${cell(u.serverOfflineS)} | ${cell(u.serverReason)} | ${cell(u.fgsStoppedS)} |`);
  }
  if (a.silentDeaths.length) {
    lines.push(
      '',
      '## Silent tracking loss (no host action in the previous 180 s)',
      '',
      '| OFFLINE at | last fix → STALE (s) | last fix → OFFLINE (s) |',
      '|---|---|---|',
    );
    for (const s of a.silentDeaths) lines.push(`| ${s.offlineAt} | ${cell(s.sinceLastFixStaleS)} | ${cell(s.sinceLastFixOfflineS)} |`);
  }
  if (a.warnings.length) lines.push('', '## Warnings', '', ...a.warnings.map((w) => `- ${w}`));
  lines.push(
    '',
    '## Capture-sheet row (receiver-derived columns; the lead fills device, battery and verdict columns)',
    '',
    '```csv',
    CAPTURE_SHEET_COLUMNS.join(','),
    sheetRowCsv(a.sheetRow),
    '```',
    '',
  );
  return lines.join('\n');
}
