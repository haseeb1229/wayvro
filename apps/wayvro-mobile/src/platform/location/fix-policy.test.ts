import { describe, expect, it } from 'vitest';
import { acceptLastKnown, biasPoint, ONE_SHOT_FIX, oneShotFix, PIN_WATCH, pointPrecision, type DeviceFix } from './fix-policy';

const NOW = 1_000_000;
const fix = (patch: Partial<DeviceFix> = {}): DeviceFix => ({ lat: 31.5204123, lng: 74.3587456, accuracyM: 20, timestamp: NOW - 5_000, ...patch });

describe('UNIT-LOCPERM fix parameters (permission doc §4.4)', () => {
  it('one-shot: last known accepted only if ≤ 30 s old and ≤ 100 m; balanced current position with a 10 s timeout', () => {
    expect(ONE_SHOT_FIX).toEqual({ lastKnownMaxAgeMs: 30_000, lastKnownMaxAccuracyM: 100, timeoutMs: 10_000 });
    expect(acceptLastKnown(fix(), NOW)).toBe(true);
    expect(acceptLastKnown(fix({ timestamp: NOW - 30_000 }), NOW)).toBe(true);
    expect(acceptLastKnown(fix({ timestamp: NOW - 30_001 }), NOW)).toBe(false);
    expect(acceptLastKnown(fix({ accuracyM: 101 }), NOW)).toBe(false);
    expect(acceptLastKnown(fix({ accuracyM: null }), NOW)).toBe(false);
    expect(acceptLastKnown(fix({ timestamp: NOW + 1 }), NOW)).toBe(false);
    expect(acceptLastKnown(null, NOW)).toBe(false);
  });

  it('pin watch: ≥ 5 s and ≥ 10 m', () => {
    expect(PIN_WATCH).toEqual({ timeIntervalMs: 5_000, distanceIntervalM: 10 });
  });

  it('uses a fresh last-known fix without asking for a new one', async () => {
    let currentCalls = 0;
    const outcome = await oneShotFix({
      lastKnown: () => Promise.resolve(fix()),
      current: () => {
        currentCalls += 1;
        return Promise.resolve(fix());
      },
      now: () => NOW,
      delay: () => new Promise(() => undefined),
    });
    expect(outcome).toEqual({ kind: 'ok', fix: fix() });
    expect(currentCalls).toBe(0);
  });

  it('falls back to the current position; the app-side timeout bounds a position that never arrives', async () => {
    const fresh = fix({ timestamp: NOW });
    expect(
      await oneShotFix({
        lastKnown: () => Promise.resolve(null),
        current: () => Promise.resolve(fresh),
        now: () => NOW,
        delay: () => new Promise(() => undefined),
      }),
    ).toEqual({
      kind: 'ok',
      fix: fresh,
    });
    let delayed = 0;
    const timedOut = await oneShotFix({
      lastKnown: () => Promise.reject(new Error('no provider')),
      current: () => new Promise(() => undefined),
      now: () => NOW,
      delay: (ms) => {
        delayed = ms;
        return Promise.resolve();
      },
    });
    expect(timedOut).toEqual({ kind: 'timeout' });
    expect(delayed).toBe(10_000);
    expect(
      await oneShotFix({
        lastKnown: () => Promise.resolve(null),
        current: () => Promise.reject(new Error('off')),
        now: () => NOW,
        delay: () => new Promise(() => undefined),
      }),
    ).toEqual({
      kind: 'unavailable',
    });
  });

  it('precision: search bias at 2 decimals (≈1.1 km), points at 5 decimals (≈1 m)', () => {
    expect(biasPoint(fix())).toEqual({ lat: 31.52, lng: 74.36 });
    expect(pointPrecision(fix())).toEqual({ lat: 31.52041, lng: 74.35875 });
  });
});
