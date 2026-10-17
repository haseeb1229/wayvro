/**
 * `Retry-After` (RFC 9110 §10.2.3) → a bounded provider-advised wait in whole seconds, or `undefined` when the header is
 * absent or unusable (the gateway then applies its default quota cool-down).
 *
 *  - delta-seconds (`1*DIGIT`) is clock-independent and trusted: `0` → the lower bound, huge values → the upper bound;
 *  - HTTP-date in all three RFC 9110 §5.6.7 forms (IMF-fixdate, obsolete RFC 850, asctime) is converted against the
 *    injected SERVER clock (never a device clock); a date that is not in the future is treated as unusable (it can only
 *    come from clock skew or a stale cache, so the conservative default applies);
 *  - anything else — signs, fractions, units, junk, impossible calendar values, a value over 64 characters, a
 *    non-finite clock — is malformed ⇒ `undefined`;
 *  - the result is clamped to [RETRY_AFTER_MIN_SECONDS, RETRY_AFTER_MAX_SECONDS]; the gateway's cool-down applies the
 *    same bounds again (apps/api/src/geo/provider-call.ts), so a bad value can never mean "no cool-down" or "forever".
 *
 * The header value is never copied into an error or a log.
 */

const RETRY_AFTER_MIN_SECONDS = 1;
const RETRY_AFTER_MAX_SECONDS = 3600;
const MAX_HEADER_CHARS = 64;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH = MONTHS.join('|');
const DAY_SHORT = 'Mon|Tue|Wed|Thu|Fri|Sat|Sun';
const DAY_LONG = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';
const TIME = '(\\d{2}):(\\d{2}):(\\d{2})';

const IMF_FIXDATE = new RegExp(`^(?:${DAY_SHORT}), (\\d{2}) (${MONTH}) (\\d{4}) ${TIME} GMT$`);
const RFC850_DATE = new RegExp(`^(?:${DAY_LONG}), (\\d{2})-(${MONTH})-(\\d{2}) ${TIME} GMT$`);
const ASCTIME_DATE = new RegExp(`^(?:${DAY_SHORT}) (${MONTH}) ( \\d|\\d{2}) ${TIME} (\\d{4})$`);

/** Clamps a non-negative finite number of seconds to the documented bounds; anything else ⇒ undefined. */
export function boundRetryAfterSeconds(seconds: number): number | undefined {
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(RETRY_AFTER_MAX_SECONDS, Math.max(RETRY_AFTER_MIN_SECONDS, Math.ceil(seconds)));
}

interface DateParts {
  readonly year: number;
  readonly month: string;
  readonly day: string;
  readonly hh: string;
  readonly mm: string;
  readonly ss: string;
}

/** Epoch ms of a validated calendar timestamp (UTC), or null for an impossible date/time. */
function epochOf(p: DateParts): number | null {
  const month = MONTHS.indexOf(p.month as (typeof MONTHS)[number]);
  const day = Number(p.day.trim());
  const [hh, mm, ss] = [Number(p.hh), Number(p.mm), Number(p.ss)];
  // RFC 9110 allows second 60 (leap second); hours/minutes are range-checked, the calendar date by round trip
  if (hh > 23 || mm > 59 || ss > 60) return null;
  const midnight = Date.UTC(p.year, month, day);
  const check = new Date(midnight);
  if (check.getUTCFullYear() !== p.year || check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
  return midnight + ((hh * 60 + mm) * 60 + ss) * 1000;
}

/** RFC 850 two-digit year: more than 50 years in the future ⇒ the most recent past year with those digits. */
function rfc850Year(yy: number, now: Date): number {
  const nowYear = now.getUTCFullYear();
  const year = Math.floor(nowYear / 100) * 100 + yy;
  return year > nowYear + 50 ? year - 100 : year;
}

/** Epoch ms of an HTTP-date in any of the three RFC 9110 forms, or null. */
function parseHttpDate(value: string, now: Date): number | null {
  let m = IMF_FIXDATE.exec(value);
  if (m) return epochOf({ day: m[1] ?? '', month: m[2] ?? '', year: Number(m[3]), hh: m[4] ?? '', mm: m[5] ?? '', ss: m[6] ?? '' });
  m = RFC850_DATE.exec(value);
  if (m) return epochOf({ day: m[1] ?? '', month: m[2] ?? '', year: rfc850Year(Number(m[3]), now), hh: m[4] ?? '', mm: m[5] ?? '', ss: m[6] ?? '' });
  m = ASCTIME_DATE.exec(value);
  if (m) return epochOf({ month: m[1] ?? '', day: m[2] ?? '', hh: m[3] ?? '', mm: m[4] ?? '', ss: m[5] ?? '', year: Number(m[6]) });
  return null;
}

/**
 * Parses a `Retry-After` header value against the server clock `now`.
 * Used by `callJson` on QUOTA failures (adapters never call it directly).
 */
export function parseRetryAfter(value: string | null, now: Date): number | undefined {
  if (value === null) return undefined;
  const v = value.trim();
  if (v.length === 0 || v.length > MAX_HEADER_CHARS) return undefined;
  if (/^\d+$/.test(v)) return boundRetryAfterSeconds(Number(v));
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return undefined;
  const at = parseHttpDate(v, now);
  if (at === null) return undefined;
  const delta = (at - nowMs) / 1000;
  return delta > 0 ? boundRetryAfterSeconds(delta) : undefined;
}
