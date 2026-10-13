import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Coordinates,
  GeoError,
  POLYLINE_MAX_ENCODED_BYTES,
  decodePolyline,
  encodePolyline,
  inPakistanEnvelope,
  roundCoordinate,
  simplifyPolyline,
} from './geo.js';

// PR tier: 500 runs per property (docs/phase3/PHASE3_TEST_STRATEGY.md §4.2)
const NUM_RUNS = 500;
const lat = fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true });
const lng = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });
const point = fc.record({ lat, lng });
// Lahore-scale synthetic routes (dense points, realistic deltas)
const lahorePoint = fc.record({ lat: fc.double({ min: 31.3, max: 31.7, noNaN: true }), lng: fc.double({ min: 74.1, max: 74.5, noNaN: true }) });

const reason = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof GeoError ? e.reason : `not a GeoError: ${String(e)}`;
  }
};

describe('Coordinates', () => {
  it('validates range and finiteness with typed reasons', () => {
    expect(reason(() => Coordinates.of(Number.NaN, 74))).toBe('NOT_FINITE');
    expect(reason(() => Coordinates.of(31, Number.POSITIVE_INFINITY))).toBe('NOT_FINITE');
    expect(reason(() => Coordinates.of(90.0001, 74))).toBe('OUT_OF_RANGE');
    expect(reason(() => Coordinates.of(31, -180.5))).toBe('OUT_OF_RANGE');
    expect(Coordinates.of(-90, 180).toJSON()).toEqual({ lat: -90, lng: 180 });
  });

  it('normalises to 6 decimals and rounds half away from zero without -0', () => {
    expect(Coordinates.of(31.52049999999, 74.3587123456).toJSON()).toEqual({ lat: 31.5205, lng: 74.358712 });
    expect(roundCoordinate(-0.00004, 4)).toBe(0);
    expect(Object.is(roundCoordinate(-0.00004, 4), -0)).toBe(false);
    expect(roundCoordinate(-31.55555, 4)).toBe(-31.5556);
    expect(Coordinates.of(31.51234, 74.35678).roundTo(4).toJSON()).toEqual({ lat: 31.5123, lng: 74.3568 });
    expect(Coordinates.of(31.51234, 74.35678).coarseCell().toJSON()).toEqual({ lat: 31.51, lng: 74.36 });
    expect(reason(() => roundCoordinate(1, 7))).toBe('INVALID_PRECISION');
  });

  it('applies the coarse Pakistan envelope inclusively', () => {
    expect(inPakistanEnvelope({ lat: 31.52, lng: 74.35 })).toBe(true);
    expect(inPakistanEnvelope({ lat: 23.5, lng: 60.8 })).toBe(true);
    expect(inPakistanEnvelope({ lat: 37.2, lng: 77.9 })).toBe(true);
    expect(Coordinates.of(51.5, -0.12).inPakistanEnvelope()).toBe(false);
    expect(inPakistanEnvelope({ lat: 23.49, lng: 70 })).toBe(false);
  });

  it('rounding is idempotent and stays within half a unit of the cell (property)', () => {
    fc.assert(
      fc.property(point, fc.integer({ min: 0, max: 6 }), (p, d) => {
        const c = Coordinates.from(p);
        const r = c.roundTo(d);
        expect(r.roundTo(d).equals(r)).toBe(true);
        expect(Math.abs(r.lat - c.lat)).toBeLessThanOrEqual(0.5 / 10 ** d + 1e-9);
        expect(Math.abs(r.lng - c.lng)).toBeLessThanOrEqual(0.5 / 10 ** d + 1e-9);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('PROP-POLYLINE', () => {
  it('encodes the documented reference example', () => {
    const pts = [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ];
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(pts);
    expect(encodePolyline([])).toBe('');
    expect(decodePolyline('')).toEqual([]);
  });

  it('decode(encode(xs)) is within 1e-5 degrees per coordinate', () => {
    fc.assert(
      fc.property(fc.array(point, { maxLength: 60 }), (xs) => {
        const back = decodePolyline(encodePolyline(xs), Number.MAX_SAFE_INTEGER);
        expect(back).toHaveLength(xs.length);
        back.forEach((p, i) => {
          const x = xs[i];
          if (!x) throw new Error('index');
          expect(Math.abs(p.lat - x.lat)).toBeLessThanOrEqual(1e-5);
          expect(Math.abs(p.lng - x.lng)).toBeLessThanOrEqual(1e-5);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('simplification keeps first/last and bounds the encoded size', () => {
    fc.assert(
      fc.property(fc.array(lahorePoint, { minLength: 2, maxLength: 1500 }), fc.constantFrom(64, 512, POLYLINE_MAX_ENCODED_BYTES), (xs, max) => {
        const s = simplifyPolyline(xs, max);
        expect(encodePolyline(s).length).toBeLessThanOrEqual(max);
        const first = xs[0];
        const last = xs[xs.length - 1];
        if (!first || !last) throw new Error('index');
        expect(s[0]).toEqual(Coordinates.from(first).roundTo(5).toJSON());
        expect(s[s.length - 1]).toEqual(Coordinates.from(last).roundTo(5).toJSON());
      }),
      { numRuns: Math.max(50, Math.floor(NUM_RUNS / 5)) },
    );
  });

  it('malformed input throws a typed error and never hangs (bounded length)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (s) => {
        try {
          const pts = decodePolyline(s);
          expect(Array.isArray(pts)).toBe(true);
        } catch (e) {
          expect(e).toBeInstanceOf(GeoError);
        }
      }),
      { numRuns: NUM_RUNS },
    );
    expect(reason(() => decodePolyline('_p~iF'))).toBe('POLYLINE_MALFORMED'); // dangling latitude
    expect(reason(() => decodePolyline('_p~i'))).toBe('POLYLINE_MALFORMED'); // truncated value
    expect(reason(() => decodePolyline('ab cd'))).toBe('POLYLINE_MALFORMED'); // outside the alphabet
    expect(reason(() => decodePolyline('~~~~~~~~~~?'))).toBe('POLYLINE_MALFORMED'); // over-wide value
    expect(reason(() => decodePolyline('?'.repeat(20_000)))).toBe('POLYLINE_TOO_LONG');
    expect(reason(() => simplifyPolyline(Array.from({ length: 100_001 }, () => ({ lat: 31.5, lng: 74.3 }))))).toBe('POLYLINE_TOO_LONG');
  });
});
