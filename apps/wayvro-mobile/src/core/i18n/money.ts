import type { MoneyAmount } from '@wayvro/contracts';

/**
 * PKR display (B04/B06 display; UX doc §14). Amounts come from the server as `{currency: 'PKR', minor}` with `minor` a
 * decimal STRING of paisa; they are formatted here with bigint arithmetic — never a binary float, never recomputed, and
 * not through `Intl` currency formatting (Hermes `Intl` behaviour is unverified, ADR-043). "Rs 640", "Rs 1,250",
 * Western digits in every locale, paisa only when non-zero. Thousands grouping (vs lakh grouping 1,25,000) and the
 * Urdu wording are PENDING native review (FA-09).
 */
const PAISA_PER_RUPEE = BigInt(100);
const MINOR_PATTERN = /^-?(0|[1-9][0-9]{0,15})$/;

export interface PkrParts {
  readonly negative: boolean;
  /** Whole rupees, grouped ("1,250"). */
  readonly rupees: string;
  /** Two-digit paisa, or null when zero. */
  readonly paisa: string | null;
}

function group(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits.charAt(i);
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ',';
  }
  return out;
}

/** @returns null when the amount is not a valid PKR minor-unit string (the caller then shows no price, never a guess). */
export function pkrParts(amount: MoneyAmount): PkrParts | null {
  if (!MINOR_PATTERN.test(amount.minor)) return null;
  const minor = BigInt(amount.minor);
  const negative = minor < BigInt(0);
  const abs = negative ? -minor : minor;
  const paisa = abs % PAISA_PER_RUPEE;
  return {
    negative,
    rupees: group((abs / PAISA_PER_RUPEE).toString()),
    paisa: paisa === BigInt(0) ? null : paisa.toString().padStart(2, '0'),
  };
}

/** "Rs 640", "Rs 1,250.50", "-Rs 5" (a negative rounding line). */
export function formatPkr(amount: MoneyAmount): string | null {
  const parts = pkrParts(amount);
  if (parts === null) return null;
  return `${parts.negative ? '-' : ''}Rs ${parts.rupees}${parts.paisa === null ? '' : `.${parts.paisa}`}`;
}
