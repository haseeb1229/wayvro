/**
 * Exact display and entry conversions for staff screens (CLAUDE.md §5). Money travels as decimal STRINGS of minor units
 * (PKR paisa) or as whole micro-USD and is converted with string/BigInt arithmetic only — never through a binary
 * float. Input converters return null for anything malformed (the form then shows a validation message; the API
 * validates again).
 */

const MINOR = /^(-?)(0|[1-9][0-9]*)$/;
const PKR_INPUT = /^(0|[1-9][0-9]{0,7})(?:\.([0-9]{1,2}))?$/;
const USD_INPUT = /^(0|[1-9][0-9]{0,5})(?:\.([0-9]{1,6}))?$/;
const MAX_MICRO_USD = 100_000_000_000n;

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "47000" → "PKR 470.00"; "-11" → "PKR -0.11". A value that is not a minor-unit integer is shown verbatim. */
export function formatPkr(minor: string): string {
  const m = MINOR.exec(minor);
  if (!m) return minor;
  const sign = m[1] ?? '';
  const padded = (m[2] ?? '0').padStart(3, '0');
  return `PKR ${sign}${group(padded.slice(0, -2))}.${padded.slice(-2)}`;
}

/** A signed difference: "+PKR 10.00", "PKR -5.00", "PKR 0.00". */
export function formatPkrDelta(minor: string): string {
  return MINOR.test(minor) && minor !== '0' && !minor.startsWith('-') ? `+${formatPkr(minor)}` : formatPkr(minor);
}

/** "47000" → "470.00" (the editable form of a stored amount). */
export function minorToPkrInput(minor: string): string {
  const m = MINOR.exec(minor);
  if (!m || m[1] === '-') return '';
  const padded = (m[2] ?? '0').padStart(3, '0');
  return `${padded.slice(0, -2).replace(/^0+(?=\d)/, '')}.${padded.slice(-2)}`;
}

/** "470" / "470.5" / "470.50" → "47000"; null when not a non-negative PKR amount with at most two decimals. */
export function pkrToMinor(text: string): string | null {
  const m = PKR_INPUT.exec(text.trim());
  if (!m) return null;
  return (BigInt(m[1] ?? '0') * 100n + BigInt((m[2] ?? '').padEnd(2, '0'))).toString();
}

/** Whole micro-USD → "USD 12.50" (at least two, at most six decimals; trailing zeros beyond two trimmed). */
export function formatMicroUsd(micro: number): string {
  if (!Number.isSafeInteger(micro) || micro < 0) return String(micro);
  const padded = BigInt(micro).toString().padStart(7, '0');
  const fraction = padded.slice(-6).replace(/0+$/, '').padEnd(2, '0');
  return `USD ${group(padded.slice(0, -6))}.${fraction}`;
}

/** "50" / "12.345678" → whole micro-USD (exact; within the contract bound); null when malformed or too large. */
export function usdToMicro(text: string): number | null {
  const m = USD_INPUT.exec(text.trim());
  if (!m) return null;
  const micro = BigInt(m[1] ?? '0') * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'));
  return micro <= MAX_MICRO_USD ? Number(micro) : null;
}

/** Basis points → "5.00%" (integers only). */
export function formatBp(bp: number): string {
  return `${String(Math.trunc(bp / 100))}.${String(bp % 100).padStart(2, '0')}%`;
}

/** A non-negative whole number typed into a form; null otherwise. */
export function wholeNumber(text: string): number | null {
  const v = text.trim();
  return /^(0|[1-9][0-9]{0,11})$/.test(v) ? Number(v) : null;
}
