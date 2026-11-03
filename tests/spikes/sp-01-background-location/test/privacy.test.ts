/**
 * Privacy rule (protocol §5.2): no latitude/longitude (or any position-like field) can be serialised in an upload.
 * These tests fail if a coordinate-like field is added to the payload, to the serialiser output, or if position data
 * is read anywhere in the spike outside the single privacy-boundary file.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DeltaTracker, distanceM } from '../src/client/geo-delta.ts';
import {
  buildUploadPoint,
  COORDINATE_KEY_PATTERN,
  parseUploadBatch,
  serializeUploadBatch,
  UPLOAD_POINT_KEYS,
  type UploadPoint,
  type UploadPointInput,
} from '../src/shared/payload.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_KEYS = ['runId', 'seq', 'fixTimeMs', 'accuracyBucketM', 'deltaMBucket', 'mocked', 'appState', 'fgsActive', 'batteryPct', 'powerSave'];
const POSITION_LIKE = /lat|lng|lon|coord|geo|position|altitude|heading|speed|address/i;

// Compile-time guard (tsc -p tsconfig.node.json): adding a coordinate key to UploadPoint breaks the typecheck.
type NoPositionKeys = Extract<keyof UploadPoint, 'latitude' | 'longitude' | 'lat' | 'lng' | 'coords' | 'altitude'>;
const noPositionKeys: [NoPositionKeys] extends [never] ? true : false = true;

const input = (over: Partial<UploadPointInput> = {}): UploadPointInput => ({
  runId: 'run-abcd1234',
  seq: 1,
  fixTimeMs: 1_760_000_000_123.4,
  accuracyM: 7.4,
  deltaM: 14.9,
  mocked: false,
  appState: 'background',
  fgsActive: true,
  batteryPct: 87.6,
  powerSave: false,
  ...over,
});

describe('upload payload privacy', () => {
  it('pins the exact allow-listed point keys', () => {
    assert.equal(noPositionKeys, true);
    assert.deepEqual([...UPLOAD_POINT_KEYS], EXPECTED_KEYS);
  });

  it('has no position-like key in the allow-list', () => {
    for (const k of UPLOAD_POINT_KEYS) {
      assert.equal(COORDINATE_KEY_PATTERN.test(k), false, k);
      assert.equal(POSITION_LIKE.test(k), false, k);
    }
  });

  it('drops coordinates smuggled into the builder input and serialises only allow-listed keys', () => {
    const smuggled = { ...input(), latitude: 31.5204, longitude: 74.3587, coords: { latitude: 31.5, longitude: 74.3 } } as UploadPointInput;
    const point = buildUploadPoint(smuggled);
    assert.deepEqual(Object.keys(point), EXPECTED_KEYS);
    const json = serializeUploadBatch({
      runId: 'run-abcd1234',
      points: [{ ...point, latitude: 31.5 } as UploadPoint],
      clock: [],
      stats: { bufferDepth: 1, bufferDrops: 0, fixesTotal: 1 },
    });
    assert.doesNotMatch(json, /31\.5|74\.3|latitude|longitude|coords/);
    const parsed = JSON.parse(json) as { points: Record<string, unknown>[] };
    assert.deepEqual(Object.keys(parsed.points[0] ?? {}), EXPECTED_KEYS);
  });

  it('buckets accuracy to 5 m and distance to 10 m and clamps battery', () => {
    const p = buildUploadPoint(input({ accuracyM: 7.4, deltaM: 14.9, batteryPct: 101 }));
    assert.equal(p.accuracyBucketM, 5);
    assert.equal(p.deltaMBucket, 10);
    assert.equal(p.batteryPct, 100);
    assert.equal(buildUploadPoint(input({ accuracyM: 7.6, deltaM: 15 })).accuracyBucketM, 10);
    assert.equal(buildUploadPoint(input({ deltaM: null })).deltaMBucket, null);
    assert.equal(buildUploadPoint(input({ accuracyM: undefined })).accuracyBucketM, null);
  });

  it('receiver rejects any batch carrying a position-like or unknown field', () => {
    const good = JSON.parse(
      serializeUploadBatch({
        runId: 'run-abcd1234',
        points: [buildUploadPoint(input())],
        clock: [{ t0: 1, ts: 2, t1: 3 }],
        stats: { bufferDepth: 0, bufferDrops: 0, fixesTotal: 1 },
      }),
    ) as {
      points: Record<string, unknown>[];
    } & Record<string, unknown>;
    assert.equal(parseUploadBatch(good).ok, true);
    const withLat = { ...good, points: [{ ...good.points[0], latitude: 31.5 }] };
    const r1 = parseUploadBatch(withLat);
    assert.equal(r1.ok, false);
    assert.equal(r1.ok ? '' : r1.code, 'PAYLOAD_FIELD_NOT_ALLOWED');
    const r2 = parseUploadBatch({ ...good, location: { lat: 1 } });
    assert.equal(r2.ok ? '' : r2.code, 'PAYLOAD_FIELD_NOT_ALLOWED');
    const r3 = parseUploadBatch({ ...good, clock: [{ t0: 1, ts: 2, t1: 3, lng: 4 }] });
    assert.equal(r3.ok ? '' : r3.code, 'PAYLOAD_FIELD_NOT_ALLOWED');
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'android' || e.name === 'test' ? [] : sourceFiles(p);
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [p] : [];
  });
}

describe('position stays inside the privacy boundary', () => {
  const files = sourceFiles(ROOT).map((f) => ({ rel: relative(ROOT, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));

  it('scans the spike sources', () => {
    assert.ok(files.some((f) => f.rel === 'src/client/engine.ts'));
    assert.ok(files.some((f) => f.rel === 'receiver/server.ts'));
  });

  it('only src/client/geo-delta.ts reads latitude/longitude', () => {
    // Comment lines and the deny-pattern definition itself are not reads of a position.
    const code = (text: string): string => text.replace(/^\s*(\/\/|\*).*$/gm, '').replace(/^.*COORDINATE_KEY_PATTERN = .*$/gm, '');
    const offenders = files.filter((f) => f.rel !== 'src/client/geo-delta.ts' && /\b(latitude|longitude)\b/.test(code(f.text)));
    assert.deepEqual(
      offenders.map((f) => f.rel),
      [],
    );
  });

  it('the engine touches loc.coords only for accuracy and the on-device delta', () => {
    const engine = files.find((f) => f.rel === 'src/client/engine.ts')?.text ?? '';
    const uses = [...engine.matchAll(/[\w.]*coords[\w.]*/g)].map((m) => m[0]).filter((u) => !u.startsWith('//'));
    assert.deepEqual([...new Set(uses)].sort(), ['loc.coords', 'loc.coords.accuracy']);
    assert.match(engine, /s\.delta\.next\(loc\.coords\)/);
  });

  it('app code logs only through log.ts', () => {
    const offenders = files.filter(
      (f) => (f.rel.startsWith('src/client/') || f.rel === 'App.tsx') && f.rel !== 'src/client/log.ts' && /console\./.test(f.text),
    );
    assert.deepEqual(
      offenders.map((f) => f.rel),
      [],
    );
  });
});

describe('on-device distance', () => {
  it('computes haversine distance and returns null for the first fix', () => {
    assert.ok(Math.abs(distanceM({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }) - 111_195) < 10);
    const t = new DeltaTracker();
    assert.equal(t.next({ latitude: 10, longitude: 10 }), null);
    assert.equal(t.next({ latitude: 10, longitude: 10 }), 0);
  });
});
