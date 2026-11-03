import { describe, expect, it } from 'vitest';
import { boundRetryAfterSeconds, parseRetryAfter } from './retry-after.js';

// Server clock for the HTTP-date cases (a Saturday). Synthetic values only.
const NOW = new Date('2026-10-17T10:00:00Z');

describe('parseRetryAfter (RFC 9110 §10.2.3; bounded 1–3600 s; server clock)', () => {
  it.each([
    ['120', 120],
    ['  7  ', 7],
    ['0', 1],
    ['1', 1],
    ['3600', 3600],
    ['3601', 3600],
    ['99999999999999999999', 3600],
    ['0000000000000000000000000000000000000000000000000000000000000060', 60],
  ] as const)('delta-seconds %j ⇒ %i', (value, expected) => {
    expect(parseRetryAfter(value, NOW)).toBe(expected);
  });

  it.each([
    ['absent', null],
    ['empty', ''],
    ['blank', '   '],
    ['negative', '-5'],
    ['explicit plus', '+5'],
    ['fraction', '1.5'],
    ['exponent', '1e3'],
    ['hex', '0x10'],
    ['unit suffix', '10s'],
    ['text', 'soon'],
    ['Infinity', 'Infinity'],
    ['NaN', 'NaN'],
    ['two values', '10, 20'],
    ['over 64 characters', '1'.repeat(65)],
    ['lower-case GMT', 'Sat, 17 Oct 2026 10:01:30 gmt'],
    ['non-GMT zone', 'Sat, 17 Oct 2026 10:01:30 +0000'],
    ['ISO 8601', '2026-10-17T10:01:30Z'],
    ['impossible calendar date', 'Fri, 30 Feb 2026 10:00:00 GMT'],
    ['hour 24', 'Sat, 17 Oct 2026 24:00:00 GMT'],
    ['minute 60', 'Sat, 17 Oct 2026 10:60:00 GMT'],
    ['second 61', 'Sat, 17 Oct 2026 10:00:61 GMT'],
    ['unknown month', 'Sat, 17 Okt 2026 10:01:30 GMT'],
    ['single-digit IMF day', 'Sat, 7 Oct 2026 10:01:30 GMT'],
  ] as const)('%s ⇒ undefined (gateway default applies)', (_, value) => {
    expect(parseRetryAfter(value, NOW)).toBeUndefined();
  });

  it('IMF-fixdate is converted against the injected server clock, rounded up and bounded', () => {
    expect(parseRetryAfter('Sat, 17 Oct 2026 10:01:30 GMT', NOW)).toBe(90);
    expect(parseRetryAfter('Sat, 17 Oct 2026 10:00:01 GMT', new Date('2026-10-17T10:00:00.500Z'))).toBe(1);
    expect(parseRetryAfter('Sat, 17 Oct 2026 10:00:00 GMT', new Date('2026-10-17T09:59:58.200Z'))).toBe(2);
    expect(parseRetryAfter('Sun, 18 Oct 2026 10:00:00 GMT', NOW)).toBe(3600);
    // leap second is grammatical (RFC 9110 allows second 60)
    expect(parseRetryAfter('Sat, 17 Oct 2026 10:00:60 GMT', NOW)).toBe(60);
    // the same header under another server clock gives another wait: never a device clock
    expect(parseRetryAfter('Sat, 17 Oct 2026 10:01:30 GMT', new Date('2026-10-17T10:01:00Z'))).toBe(30);
  });

  it('a date that is now or in the past is unusable (clock skew / stale cache ⇒ conservative default)', () => {
    expect(parseRetryAfter('Sat, 17 Oct 2026 10:00:00 GMT', NOW)).toBeUndefined();
    expect(parseRetryAfter('Sat, 17 Oct 2026 09:59:00 GMT', NOW)).toBeUndefined();
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:00 GMT', NOW)).toBeUndefined();
  });

  it('accepts the obsolete RFC 850 and asctime forms (RFC 9110 §5.6.7: recipients MUST)', () => {
    expect(parseRetryAfter('Saturday, 17-Oct-26 10:02:00 GMT', NOW)).toBe(120);
    expect(parseRetryAfter('Sat Oct 17 10:02:00 2026', NOW)).toBe(120);
    expect(parseRetryAfter('Sat Oct  7 10:02:00 2026', NOW)).toBeUndefined(); // padded single-digit day, in the past
    expect(parseRetryAfter('Sat Oct  7 10:02:00 2026', new Date('2026-10-07T10:01:00Z'))).toBe(60);
    // two-digit years more than 50 years ahead belong to the previous century ⇒ far past ⇒ unusable
    expect(parseRetryAfter('Thursday, 17-Oct-99 10:02:00 GMT', NOW)).toBeUndefined();
    expect(parseRetryAfter('Saturday, 17-Oct-26 10:02:00 GMT', new Date('2099-12-31T00:00:00Z'))).toBeUndefined();
  });

  it('a non-finite server clock makes an HTTP-date unusable; delta-seconds needs no clock', () => {
    const broken = new Date(Number.NaN);
    expect(parseRetryAfter('Sat, 17 Oct 2026 10:01:30 GMT', broken)).toBeUndefined();
    expect(parseRetryAfter('30', broken)).toBe(30);
  });
});

describe('boundRetryAfterSeconds', () => {
  it('rounds up, clamps to [1, 3600] and refuses negative or non-finite values', () => {
    expect(boundRetryAfterSeconds(0)).toBe(1);
    expect(boundRetryAfterSeconds(0.2)).toBe(1);
    expect(boundRetryAfterSeconds(1.2)).toBe(2);
    expect(boundRetryAfterSeconds(3599.5)).toBe(3600);
    expect(boundRetryAfterSeconds(1e12)).toBe(3600);
    expect(boundRetryAfterSeconds(-1)).toBeUndefined();
    expect(boundRetryAfterSeconds(Number.NaN)).toBeUndefined();
    expect(boundRetryAfterSeconds(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
