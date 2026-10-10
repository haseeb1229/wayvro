/**
 * Money in integer minor units (CLAUDE.md §5: authoritative money never uses binary floating point).
 *
 * Only PKR is supported (ISO 4217 exponent 2: 1 PKR = 100 paisa). All arithmetic is exact `bigint`; every operation
 * that can produce a fraction of a minor unit takes an explicit rounding mode, so rounding is defined in exactly one
 * place. Pricing policy (for example cash-friendly rounding to PKR 10) is applied by callers through `roundToStep`;
 * this value object carries no business rules.
 *
 * Single currency by type: `Currency` is the literal 'PKR', so mixing currencies is a compile-time error today. Adding a
 * second currency must add runtime mismatch guards to every binary operation (and tests for them).
 */

export type Currency = 'PKR';
export type RoundingMode = 'HALF_EVEN' | 'HALF_UP' | 'FLOOR' | 'CEILING';

const MINOR_UNITS_PER_MAJOR: Record<Currency, bigint> = { PKR: 100n };
const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

/** Divides `n` by positive `d` and rounds the quotient according to `mode`. */
function divideAndRound(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d <= 0n) throw new MoneyError('divisor must be positive');
  const q = n / d; // truncates toward zero
  const r = n % d; // same sign as n
  if (r === 0n) return q;
  const negative = n < 0n;
  switch (mode) {
    case 'FLOOR':
      return negative ? q - 1n : q;
    case 'CEILING':
      return negative ? q : q + 1n;
    case 'HALF_UP':
    case 'HALF_EVEN': {
      const twiceRemainder = (r < 0n ? -r : r) * 2n;
      const awayFromZero = negative ? q - 1n : q + 1n;
      if (twiceRemainder > d) return awayFromZero;
      if (twiceRemainder < d) return q;
      if (mode === 'HALF_UP') return awayFromZero; // ties away from zero
      return q % 2n === 0n ? q : awayFromZero; // ties to even
    }
  }
}

function toBigInt(value: bigint | number | string, what: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new MoneyError(`${what} must be a safe integer, got ${String(value)}`);
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) throw new MoneyError(`${what} must be an integer string`);
  return BigInt(value);
}

export class Money {
  private constructor(
    readonly currency: Currency,
    readonly minor: bigint,
  ) {}

  /** Creates money from minor units (paisa). Numbers must be safe integers; fractional input is rejected. */
  static ofMinor(minor: bigint | number | string, currency: Currency = 'PKR'): Money {
    return new Money(currency, toBigInt(minor, 'minor units'));
  }

  static zero(currency: Currency = 'PKR'): Money {
    return new Money(currency, 0n);
  }

  /** Parses an exact decimal major-unit string such as "1250", "1250.5" or "-3.75". No exponent, max 2 decimals. */
  static parse(decimal: string, currency: Currency = 'PKR'): Money {
    const m = DECIMAL_PATTERN.exec(decimal.trim());
    if (!m) throw new MoneyError(`not an exact ${currency} amount: "${decimal}"`);
    const [, sign, whole = '0', fraction = ''] = m;
    const minor = BigInt(whole) * MINOR_UNITS_PER_MAJOR[currency] + BigInt(fraction.padEnd(2, '0'));
    return new Money(currency, sign ? -minor : minor);
  }

  add(other: Money): Money {
    return new Money(this.currency, this.minor + other.minor);
  }

  subtract(other: Money): Money {
    return new Money(this.currency, this.minor - other.minor);
  }

  negate(): Money {
    return new Money(this.currency, -this.minor);
  }

  multiplyByInteger(factor: bigint | number): Money {
    return new Money(this.currency, this.minor * toBigInt(factor, 'factor'));
  }

  /** Multiplies by the exact rational numerator/denominator (e.g. a commission of 1250/10000 = 12.5 %). */
  multiplyByRatio(numerator: bigint | number, denominator: bigint | number, mode: RoundingMode): Money {
    const n = toBigInt(numerator, 'numerator');
    const d = toBigInt(denominator, 'denominator');
    if (d === 0n) throw new MoneyError('denominator must not be zero');
    const signedD = d < 0n ? -d : d;
    const signedN = d < 0n ? -n : n;
    return new Money(this.currency, divideAndRound(this.minor * signedN, signedD, mode));
  }

  /** Rounds to a multiple of `stepMinor` (e.g. 1000n paisa = PKR 10). */
  roundToStep(stepMinor: bigint | number, mode: RoundingMode): Money {
    const step = toBigInt(stepMinor, 'step');
    if (step <= 0n) throw new MoneyError('step must be positive');
    return new Money(this.currency, divideAndRound(this.minor, step, mode) * step);
  }

  /**
   * Splits this amount by non-negative integer weights so the parts always sum exactly to the original
   * (largest-remainder method; remaining minor units go to the largest remainders, ties to the lowest index).
   */
  allocate(weights: readonly (bigint | number)[]): Money[] {
    const w = weights.map((x) => toBigInt(x, 'weight'));
    if (w.length === 0) throw new MoneyError('at least one weight is required');
    if (w.some((x) => x < 0n)) throw new MoneyError('weights must be non-negative');
    const total = w.reduce((a, b) => a + b, 0n);
    if (total === 0n) throw new MoneyError('weights must not all be zero');
    const sign = this.minor < 0n ? -1n : 1n;
    const amount = this.minor * sign;
    const parts = w.map((x) => (amount * x) / total);
    const remainders = w.map((x, i) => ({ i, r: (amount * x) % total }));
    let leftover = amount - parts.reduce((a, b) => a + b, 0n);
    remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
    for (const { i } of remainders) {
      if (leftover === 0n) break;
      parts[i] = (parts[i] ?? 0n) + 1n;
      leftover -= 1n;
    }
    return parts.map((p) => new Money(this.currency, p * sign));
  }

  compare(other: Money): -1 | 0 | 1 {
    return this.minor === other.minor ? 0 : this.minor < other.minor ? -1 : 1;
  }

  equals(other: Money): boolean {
    return this.minor === other.minor;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  /** Exact decimal string in major units, always two decimals: "1250.50", "-0.05". */
  toDecimalString(): string {
    const scale = MINOR_UNITS_PER_MAJOR[this.currency];
    const abs = this.minor < 0n ? -this.minor : this.minor;
    const whole = abs / scale;
    const fraction = (abs % scale).toString().padStart(2, '0');
    return `${this.minor < 0n ? '-' : ''}${whole.toString()}.${fraction}`;
  }

  /** JSON-safe representation: minor units as a string so no consumer ever routes money through a float. */
  toJSON(): { currency: Currency; minor: string } {
    return { currency: this.currency, minor: this.minor.toString() };
  }
}
