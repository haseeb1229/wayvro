import { describe, expect, it } from 'vitest';
import { formatPkr, pkrParts } from './money';

const pkr = (minor: string) => ({ currency: 'PKR' as const, minor });

describe('PKR display from {currency, minor} (bigint; no float, no Intl currency)', () => {
  it('"Rs 640", grouping, paisa only when non-zero, Western digits', () => {
    expect(formatPkr(pkr('64000'))).toBe('Rs 640');
    expect(formatPkr(pkr('125000'))).toBe('Rs 1,250');
    expect(formatPkr(pkr('64050'))).toBe('Rs 640.50');
    expect(formatPkr(pkr('64005'))).toBe('Rs 640.05');
    expect(formatPkr(pkr('0'))).toBe('Rs 0');
    expect(formatPkr(pkr('5'))).toBe('Rs 0.05');
    expect(formatPkr(pkr('12500000000'))).toBe('Rs 125,000,000');
  });

  it('negative components (a rounding line) keep their sign', () => {
    expect(formatPkr(pkr('-500'))).toBe('-Rs 5');
    expect(pkrParts(pkr('-150'))).toEqual({ negative: true, rupees: '1', paisa: '50' });
  });

  it('is exact beyond the float-safe range (16 digits) and refuses malformed amounts instead of guessing', () => {
    expect(formatPkr(pkr('9999999999999999'))).toBe('Rs 99,999,999,999,999.99');
    for (const bad of ['', '01', '1.5', '1e3', ' 100', '100 ', '--1', 'NaN', '12345678901234567']) expect(formatPkr(pkr(bad)), bad).toBeNull();
  });
});
