import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Money, MoneyError, type RoundingMode } from './money.js';

const MODES: RoundingMode[] = ['HALF_EVEN', 'HALF_UP', 'FLOOR', 'CEILING'];
const minor = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
const money = minor.map((m) => Money.ofMinor(m));

describe('Money construction and formatting', () => {
  it('parses exact decimal strings into paisa', () => {
    expect(Money.parse('1250').minor).toBe(125000n);
    expect(Money.parse('1250.5').minor).toBe(125050n);
    expect(Money.parse('-3.75').minor).toBe(-375n);
    expect(Money.parse(' 0.05 ').minor).toBe(5n);
  });

  it('rejects inexact, exponent and malformed input instead of guessing', () => {
    for (const bad of ['1.234', '1e3', '', '12,50', 'PKR 10', '.5', '1.', 'NaN']) {
      expect(() => Money.parse(bad)).toThrow(MoneyError);
    }
  });

  it('rejects non-integer and unsafe numbers', () => {
    expect(() => Money.ofMinor(1.5)).toThrow(MoneyError);
    expect(() => Money.ofMinor(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(() => Money.ofMinor('12.5')).toThrow(MoneyError);
  });

  it('formats with exactly two decimals and serialises minor units as a string', () => {
    expect(Money.ofMinor(125050n).toDecimalString()).toBe('1250.50');
    expect(Money.ofMinor(-5n).toDecimalString()).toBe('-0.05');
    expect(Money.ofMinor(42n).toJSON()).toEqual({ currency: 'PKR', minor: '42' });
  });

  it('round-trips decimal formatting and parsing (property)', () => {
    fc.assert(fc.property(money, (m) => Money.parse(m.toDecimalString()).equals(m)));
  });
});

describe('Money arithmetic', () => {
  it('add/subtract are exact inverses and addition is commutative (property)', () => {
    fc.assert(
      fc.property(money, money, (a, b) => {
        expect(a.add(b).subtract(b).equals(a)).toBe(true);
        expect(a.add(b).equals(b.add(a))).toBe(true);
      }),
    );
  });

  it('negate and compare are consistent (property)', () => {
    fc.assert(fc.property(money, money, (a, b) => a.compare(b) === -b.compare(a) && a.negate().negate().equals(a)));
  });

  it('applies each rounding mode correctly at ties and non-ties', () => {
    const r = (m: bigint, n: bigint, d: bigint, mode: RoundingMode): bigint => Money.ofMinor(m).multiplyByRatio(n, d, mode).minor;
    // 25 * 1/10 = 2.5
    expect([r(25n, 1n, 10n, 'HALF_EVEN'), r(25n, 1n, 10n, 'HALF_UP'), r(25n, 1n, 10n, 'FLOOR'), r(25n, 1n, 10n, 'CEILING')]).toEqual([2n, 3n, 2n, 3n]);
    // 35 * 1/10 = 3.5 -> half-even rounds to 4
    expect(r(35n, 1n, 10n, 'HALF_EVEN')).toBe(4n);
    // -25 * 1/10 = -2.5
    expect([r(-25n, 1n, 10n, 'HALF_EVEN'), r(-25n, 1n, 10n, 'HALF_UP'), r(-25n, 1n, 10n, 'FLOOR'), r(-25n, 1n, 10n, 'CEILING')]).toEqual([-2n, -3n, -3n, -2n]);
    // 26 * 1/10 = 2.6 -> nearest is 3 for both half modes
    expect(r(26n, 1n, 10n, 'HALF_EVEN')).toBe(3n);
    // negative denominator flips sign exactly
    expect(r(100n, 1n, -4n, 'HALF_EVEN')).toBe(-25n);
  });

  it('multiplyByRatio stays within one minor unit of the exact rational result (property)', () => {
    fc.assert(
      fc.property(minor, fc.bigInt({ min: -10000n, max: 10000n }), fc.bigInt({ min: 1n, max: 10000n }), fc.constantFrom(...MODES), (m, n, d, mode) => {
        const result = Money.ofMinor(m).multiplyByRatio(n, d, mode).minor;
        const error = result * d - m * n; // scaled error
        return (error < 0n ? -error : error) < d;
      }),
    );
  });

  it('is deterministic: identical inputs always give identical outputs (property)', () => {
    fc.assert(
      fc.property(minor, fc.bigInt({ min: 1n, max: 999n }), fc.constantFrom(...MODES), (m, n, mode) =>
        Money.ofMinor(m)
          .multiplyByRatio(n, 1000n, mode)
          .equals(Money.ofMinor(m).multiplyByRatio(n, 1000n, mode)),
      ),
    );
  });

  it('rounds to cash-friendly steps without drift', () => {
    expect(Money.parse('1234.56').roundToStep(1000n, 'HALF_UP').toDecimalString()).toBe('1230.00');
    expect(Money.parse('1235.00').roundToStep(1000n, 'HALF_UP').toDecimalString()).toBe('1240.00');
    expect(Money.parse('1235.00').roundToStep(1000n, 'HALF_EVEN').toDecimalString()).toBe('1240.00');
    expect(Money.parse('1225.00').roundToStep(1000n, 'HALF_EVEN').toDecimalString()).toBe('1220.00');
    expect(() => Money.zero().roundToStep(0n, 'FLOOR')).toThrow(MoneyError);
  });

  it('rejects a zero denominator', () => {
    expect(() => Money.zero().multiplyByRatio(1n, 0n, 'FLOOR')).toThrow(MoneyError);
  });

  it('multiplies by integers exactly and reports sign/zero', () => {
    expect(Money.ofMinor('250').multiplyByInteger(3).minor).toBe(750n);
    expect(Money.ofMinor(250n).multiplyByInteger(-2n).isNegative()).toBe(true);
    expect(Money.zero().isZero()).toBe(true);
    expect(Money.ofMinor(1).isZero()).toBe(false);
    expect(Money.ofMinor(1).isNegative()).toBe(false);
    expect(() => Money.ofMinor(1).multiplyByInteger(0.5)).toThrow(MoneyError);
  });
});

describe('Money allocation', () => {
  it('splits 100.00 three ways without losing a paisa', () => {
    const parts = Money.parse('100').allocate([1, 1, 1]);
    expect(parts.map((p) => p.toDecimalString())).toEqual(['33.34', '33.33', '33.33']);
  });

  it('always sums exactly to the original and each part is within one minor unit of its share (property)', () => {
    fc.assert(
      fc.property(
        minor,
        fc.array(fc.bigInt({ min: 0n, max: 1000n }), { minLength: 1, maxLength: 8 }).filter((w) => w.some((x) => x > 0n)),
        (m, w) => {
          const parts = Money.ofMinor(m).allocate(w);
          const total = w.reduce((a, b) => a + b, 0n);
          const sum = parts.reduce((a, p) => a + p.minor, 0n);
          const fair = parts.every((p, i) => {
            const exactScaled = m * (w[i] ?? 0n);
            const diff = p.minor * total - exactScaled;
            return (diff < 0n ? -diff : diff) < total;
          });
          return sum === m && fair && parts.length === w.length;
        },
      ),
    );
  });

  it('rejects empty, negative and all-zero weights', () => {
    expect(() => Money.parse('1').allocate([])).toThrow(MoneyError);
    expect(() => Money.parse('1').allocate([1, -1])).toThrow(MoneyError);
    expect(() => Money.parse('1').allocate([0, 0])).toThrow(MoneyError);
  });
});
