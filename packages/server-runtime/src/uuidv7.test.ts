import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { uuidv7, uuidv7Timestamp } from './uuidv7.js';

const SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7 (RFC 9562)', () => {
  it('has version 7, variant 0b10 and encodes the millisecond timestamp (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffff_ffff_ffff }), fc.uint8Array({ minLength: 10, maxLength: 10 }), (ms, rnd) => {
        const id = uuidv7(ms, rnd);
        return SHAPE.test(id) && uuidv7Timestamp(id) === ms;
      }),
    );
  });

  it('sorts by time across milliseconds (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffff_ffff_fffe }), fc.integer({ min: 1, max: 1000 }), (ms, delta) => {
        const later = Math.min(ms + delta, 0xffff_ffff_ffff);
        return uuidv7(ms) < uuidv7(later);
      }),
    );
  });

  it('is unique in practice and rejects out-of-range input', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(ids.size).toBe(10_000);
    expect(() => uuidv7(-1)).toThrow(RangeError);
    expect(() => uuidv7(2 ** 48)).toThrow(RangeError);
    expect(() => uuidv7(1, new Uint8Array(4))).toThrow(RangeError);
  });
});
