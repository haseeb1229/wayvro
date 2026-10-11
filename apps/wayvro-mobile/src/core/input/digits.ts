/**
 * Input normalisation shared by the account slice and the Driver/Partner flows: people may type Arabic-Indic (٠-٩)
 * or Extended Arabic-Indic / Urdu (۰-۹) digits; forms work on ASCII digits.
 */
export function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export interface DateParts {
  readonly day: string;
  readonly month: string;
  readonly year: string;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/**
 * A real calendar date typed as day / month / year (any digit script) within [min, max] (ISO `YYYY-MM-DD`, both
 * inclusive). Returns the ISO date or null. A UX check only: the server validates every date on its own clock.
 */
export function parseDateParts(input: DateParts, bounds: { readonly min: string; readonly max: string }): string | null {
  const [d, m, y] = [input.day, input.month, input.year].map((v) => toAsciiDigits(v).trim());
  if (d === undefined || m === undefined || y === undefined) return null;
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return null;
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const iso = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  if (iso < bounds.min || iso > bounds.max) return null;
  return iso;
}

/** Today's date on the device as ISO `YYYY-MM-DD` (form bounds only; never an authoritative time). */
export function deviceTodayIso(now: Date = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}
