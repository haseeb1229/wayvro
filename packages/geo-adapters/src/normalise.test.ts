import { describe, expect, it } from 'vitest';
import { encodePolyline } from '../test/fake-fetch.js';
import { GeoAdapterError } from './errors.js';
import { callContext } from './http.js';
import {
  buildComponents,
  cleanText,
  decodePolyline,
  formatCoordinate,
  parseDecimal,
  requirePlaceId,
  requirePoint,
  requireQueryText,
  requireSessionId,
  routeNumbers,
  toPoint,
  urduName,
  validateGeometry,
} from './normalise.js';

const ctx = callContext({ providerKey: 'geo-test' }, 'GEOCODE');
const NUL = String.fromCodePoint(0);
const RLO = String.fromCodePoint(0x202e);
const ZWNJ = String.fromCodePoint(0x200c);
const LF = String.fromCodePoint(0x0a);

describe('cleanText', () => {
  it('strips control and bidi-override characters, collapses whitespace and keeps ZWNJ', () => {
    expect(cleanText(`  Liberty${NUL} ${RLO}Market${LF} `)).toBe('Liberty Market');
    expect(cleanText(`ab${ZWNJ}cd`)).toBe(`ab${ZWNJ}cd`);
    expect(cleanText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });

  it('caps length and maps empty input to null', () => {
    expect(Array.from(cleanText('x'.repeat(500)) ?? '').length).toBe(200);
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(undefined)).toBeNull();
    expect(cleanText(null)).toBeNull();
  });
});

describe('components', () => {
  it('detects block/phase strings and never invents a society', () => {
    const c = buildComponents({ name: 'Synthetic Market', fineAreas: ['Block Q', 'Synthetic Town', 'Other Area'], city: 'Lahore', locale: 'en' });
    expect(c).toEqual({ name: 'Synthetic Market', block: 'Block Q', society: null, area: 'Synthetic Town', city: 'Lahore', nameUrdu: null });
  });

  it('skips duplicates of the name and empty values', () => {
    const c = buildComponents({ name: 'Same', fineAreas: [null, 'Same', undefined, ''], city: null, locale: 'en' });
    expect(c.area).toBeNull();
    expect(c.block).toBeNull();
  });

  it('sets nameUrdu only for Arabic-script names on Urdu requests', () => {
    expect(urduName('مارکیٹ', 'ur')).toBe('مارکیٹ');
    expect(urduName('Market', 'ur')).toBeNull();
    expect(urduName('مارکیٹ', 'en')).toBeNull();
    expect(urduName(null, 'ur')).toBeNull();
  });
});

describe('coordinates', () => {
  it('accepts finite points inside Pakistan and rounds to 6 dp', () => {
    expect(toPoint(31.123456789, 74.987654321)).toEqual({ lat: 31.123457, lng: 74.987654 });
    expect(toPoint(51.5, -0.1)).toBeNull();
    expect(toPoint(Number.NaN, 74)).toBeNull();
    expect(formatCoordinate(31.1234567, 5)).toBe('31.12346');
  });

  it('parses provider decimal strings strictly', () => {
    expect(parseDecimal('31.5')).toBe(31.5);
    expect(parseDecimal('-1')).toBe(-1);
    expect(Number.isNaN(parseDecimal('31.5abc'))).toBe(true);
    expect(Number.isNaN(parseDecimal('1e3'))).toBe(true);
  });
});

describe('polylines and geometry', () => {
  const pts = [
    { lat: 31.5, lng: 74.3 },
    { lat: 31.51234, lng: 74.31234 },
    { lat: 31.6, lng: 74.4 },
  ];

  it('decodes precision 5 and 6 round-trips', () => {
    expect(decodePolyline(encodePolyline(pts, 5), 5)).toEqual(pts);
    expect(decodePolyline(encodePolyline(pts, 6), 6)).toEqual(pts);
    expect(decodePolyline('', 5)).toEqual([]);
  });

  it('rejects malformed polylines', () => {
    expect(decodePolyline('_p~iF~ps|', 5)).toBeNull(); // truncated pair
    expect(decodePolyline('\u0001\u0002', 5)).toBeNull(); // out-of-alphabet bytes
    expect(decodePolyline('x'.repeat(300_000), 5)).toBeNull();
  });

  it('validates geometry vertex count and region', () => {
    expect(validateGeometry(pts)).toEqual(pts);
    expect(validateGeometry([pts[0]!])).toBeNull();
    expect(validateGeometry([pts[0]!, { lat: 0, lng: 0 }])).toBeNull();
  });
});

describe('routeNumbers', () => {
  it('requires a positive distance and a non-negative duration', () => {
    expect(routeNumbers(1234.6, 99.5)).toEqual({ distanceM: 1235, durationS: 100 });
    expect(routeNumbers(10, 0)).toEqual({ distanceM: 10, durationS: 0 });
    expect(routeNumbers(undefined, 10)).toBeNull();
    expect(routeNumbers(10, null)).toBeNull();
    expect(routeNumbers(0, 10)).toBeNull();
    expect(routeNumbers(10, -1)).toBeNull();
    expect(routeNumbers(Number.POSITIVE_INFINITY, 1)).toBeNull();
  });
});

describe('request input guards', () => {
  const invalid = (fn: () => unknown) => {
    expect(fn).toThrow(GeoAdapterError);
    try {
      fn();
    } catch (error) {
      expect((error as GeoAdapterError).code).toBe('INVALID_INPUT');
    }
  };

  it('guards query text, session ids, points and place ids', () => {
    expect(requireQueryText(ctx, '  liberty  ')).toBe('liberty');
    invalid(() => requireQueryText(ctx, '   '));
    invalid(() => requireQueryText(ctx, 'x'.repeat(201)));
    expect(requireSessionId(ctx, '6f1c2b8e-0000-4000-8000-000000000000')).toBe('6f1c2b8e-0000-4000-8000-000000000000');
    invalid(() => requireSessionId(ctx, 'short'));
    invalid(() => requirePoint(ctx, { lat: 0, lng: 0 }));
    invalid(() => requirePlaceId(ctx, '../admin', /^[A-Za-z0-9_-]+$/));
  });
});
