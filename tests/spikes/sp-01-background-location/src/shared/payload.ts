/**
 * SP-01 upload payload (protocol §5.2, privacy by design). Shared by the spike app (builder + serialiser) and the
 * receiver (strict parser). Latitude/longitude NEVER appear here: the device keeps its position in memory only to
 * compute the bucketed distance from the previous fix (src/client/geo-delta.ts) and transmits metadata only.
 *
 * Changing UPLOAD_POINT_KEYS is a privacy change: test/privacy.test.ts pins the exact list and fails if a
 * coordinate-like field is added anywhere in the payload.
 */

export const UPLOAD_POINT_KEYS = [
  'runId',
  'seq',
  'fixTimeMs',
  'accuracyBucketM',
  'deltaMBucket',
  'mocked',
  'appState',
  'fgsActive',
  'batteryPct',
  'powerSave',
] as const;

export type UploadPointKey = (typeof UPLOAD_POINT_KEYS)[number];

export type AppStateLabel = 'active' | 'background' | 'inactive' | 'unknown';

export type UploadPoint = {
  readonly runId: string;
  readonly seq: number;
  /** OS fix timestamp, device clock (offset-corrected by the receiver, protocol §12). */
  readonly fixTimeMs: number;
  /** Accuracy radius rounded to 5 m; null when the OS reported none. */
  readonly accuracyBucketM: number | null;
  /** Distance from the previous fix rounded to 10 m; null for the first fix of a run. */
  readonly deltaMBucket: number | null;
  readonly mocked: boolean;
  readonly appState: AppStateLabel;
  readonly fgsActive: boolean;
  /** Battery level 0-100 (integer); null when unknown. */
  readonly batteryPct: number | null;
  readonly powerSave: boolean | null;
};

/** Round-trip clock sample (protocol §12): device send time, server time, device receive time. */
export type ClockSample = { readonly t0: number; readonly ts: number; readonly t1: number };

/** Client-side counters attached to each batch (counts only). */
export type ClientStats = {
  readonly bufferDepth: number;
  readonly bufferDrops: number;
  readonly fixesTotal: number;
};

export type UploadBatch = {
  readonly runId: string;
  readonly points: readonly UploadPoint[];
  readonly clock: readonly ClockSample[];
  readonly stats: ClientStats;
};

export const UPLOAD_BATCH_KEYS = ['runId', 'points', 'clock', 'stats'] as const;
const CLOCK_KEYS = ['t0', 'ts', 't1'] as const;
const STATS_KEYS = ['bufferDepth', 'bufferDrops', 'fixesTotal'] as const;
export const MAX_POINTS_PER_BATCH = 60;

/** Any JSON key that looks like a position. Used by the serialiser (fail closed) and by the tests. */
export const COORDINATE_KEY_PATTERN = /^(lat|latitude|lng|lon|long|longitude|coords?|coordinates?|position|geo|location|altitude|heading|speed)$/i;

export function bucket(value: number | null | undefined, step: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value / step) * step;
}

export type UploadPointInput = {
  runId: string;
  seq: number;
  fixTimeMs: number;
  accuracyM: number | null | undefined;
  deltaM: number | null;
  mocked: boolean | undefined;
  appState: AppStateLabel;
  fgsActive: boolean;
  batteryPct: number | null;
  powerSave: boolean | null;
};

/** Builds a point from explicit fields only (never a spread of an OS location object). */
export function buildUploadPoint(input: UploadPointInput): UploadPoint {
  return {
    runId: input.runId,
    seq: input.seq,
    fixTimeMs: Math.round(input.fixTimeMs),
    accuracyBucketM: bucket(input.accuracyM, 5),
    deltaMBucket: bucket(input.deltaM, 10),
    mocked: input.mocked === true,
    appState: input.appState,
    fgsActive: input.fgsActive,
    batteryPct: input.batteryPct === null ? null : Math.max(0, Math.min(100, Math.round(input.batteryPct))),
    powerSave: input.powerSave,
  };
}

function pick<K extends string>(source: Record<string, unknown>, keys: readonly K[]): Record<K, unknown> {
  const out = {} as Record<K, unknown>;
  for (const k of keys) out[k] = source[k];
  return out;
}

function assertNoCoordinateKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoCoordinateKeys(v, `${path}[${String(i)}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (COORDINATE_KEY_PATTERN.test(k)) throw new Error(`SP01_PRIVACY: coordinate-like key "${k}" at ${path}`);
      assertNoCoordinateKeys(v, `${path}.${k}`);
    }
  }
}

/** The ONLY way the app serialises an upload: allow-listed keys are picked, then the result is scanned (fail closed). */
export function serializeUploadBatch(batch: UploadBatch): string {
  const shaped = {
    runId: batch.runId,
    points: batch.points.map((p) => pick(p as unknown as Record<string, unknown>, UPLOAD_POINT_KEYS)),
    clock: batch.clock.map((c) => pick(c as unknown as Record<string, unknown>, CLOCK_KEYS)),
    stats: pick(batch.stats as unknown as Record<string, unknown>, STATS_KEYS),
  };
  assertNoCoordinateKeys(shaped, '$');
  return JSON.stringify(shaped);
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: string; detail: string };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNullableNum = (v: unknown): boolean => v === null || isNum(v);
const isNullableBool = (v: unknown): boolean => v === null || typeof v === 'boolean';
const APP_STATES: readonly string[] = ['active', 'background', 'inactive', 'unknown'];

function exactKeys(obj: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) return k;
  for (const k of allowed) if (!(k in obj)) return `missing:${k}`;
  return null;
}

/** Receiver-side strict parser: any unknown key (for example a coordinate) rejects the whole batch. */
export function parseUploadBatch(body: unknown): ParseResult<UploadBatch> {
  const bad = (code: string, detail: string): ParseResult<UploadBatch> => ({ ok: false, code, detail });
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return bad('PAYLOAD_INVALID', 'body');
  const b = body as Record<string, unknown>;
  const extra = exactKeys(b, UPLOAD_BATCH_KEYS);
  if (extra) return bad('PAYLOAD_FIELD_NOT_ALLOWED', extra);
  if (typeof b['runId'] !== 'string' || !/^[a-z0-9-]{8,64}$/.test(b['runId'])) return bad('PAYLOAD_INVALID', 'runId');
  const runId = b['runId'];
  const points = b['points'];
  const clock = b['clock'];
  const stats = b['stats'];
  if (!Array.isArray(points) || points.length > MAX_POINTS_PER_BATCH) return bad('PAYLOAD_INVALID', 'points');
  if (!Array.isArray(clock) || clock.length > 50) return bad('PAYLOAD_INVALID', 'clock');
  const outPoints: UploadPoint[] = [];
  for (const raw of points) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return bad('PAYLOAD_INVALID', 'point');
    const p = raw as Record<string, unknown>;
    const k = exactKeys(p, UPLOAD_POINT_KEYS);
    if (k) return bad('PAYLOAD_FIELD_NOT_ALLOWED', k);
    if (p['runId'] !== runId) return bad('PAYLOAD_INVALID', 'point.runId');
    if (!isInt(p['seq']) || p['seq'] < 1) return bad('PAYLOAD_INVALID', 'point.seq');
    if (!isNum(p['fixTimeMs'])) return bad('PAYLOAD_INVALID', 'point.fixTimeMs');
    if (!isNullableNum(p['accuracyBucketM']) || !isNullableNum(p['deltaMBucket']) || !isNullableNum(p['batteryPct']))
      return bad('PAYLOAD_INVALID', 'point.numbers');
    if (typeof p['mocked'] !== 'boolean' || typeof p['fgsActive'] !== 'boolean' || !isNullableBool(p['powerSave']))
      return bad('PAYLOAD_INVALID', 'point.flags');
    if (typeof p['appState'] !== 'string' || !APP_STATES.includes(p['appState'])) return bad('PAYLOAD_INVALID', 'point.appState');
    outPoints.push(p as unknown as UploadPoint);
  }
  const outClock: ClockSample[] = [];
  for (const raw of clock) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return bad('PAYLOAD_INVALID', 'clock');
    const c = raw as Record<string, unknown>;
    const k = exactKeys(c, CLOCK_KEYS);
    if (k) return bad('PAYLOAD_FIELD_NOT_ALLOWED', k);
    if (!isNum(c['t0']) || !isNum(c['ts']) || !isNum(c['t1'])) return bad('PAYLOAD_INVALID', 'clock.values');
    outClock.push(c as unknown as ClockSample);
  }
  if (stats === null || typeof stats !== 'object' || Array.isArray(stats)) return bad('PAYLOAD_INVALID', 'stats');
  const s = stats as Record<string, unknown>;
  const sk = exactKeys(s, STATS_KEYS);
  if (sk) return bad('PAYLOAD_FIELD_NOT_ALLOWED', sk);
  if (!isInt(s['bufferDepth']) || !isInt(s['bufferDrops']) || !isInt(s['fixesTotal'])) return bad('PAYLOAD_INVALID', 'stats.values');
  return { ok: true, value: { runId, points: outPoints, clock: outClock, stats: s as unknown as ClientStats } };
}
