import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalisePakistanMobile } from './phone.js';

const E164 = /^\+923\d{9}$/;
const nsn = fc.stringMatching(/^3\d{9}$/);

describe('normalisePakistanMobile', () => {
  it.each([
    ['03001234567'],
    ['3001234567'],
    ['923001234567'],
    ['+923001234567'],
    ['00923001234567'],
    ['+92 300 1234567'],
    ['+92 (0)300-1234567'],
    ['0300-123.4567'],
    ['۰۳۰۰۱۲۳۴۵۶۷'], // Urdu/Persian digits
    ['٠٣٠٠١٢٣٤٥٦٧'], // Arabic-Indic digits
  ])('normalises %s to +923001234567', (input) => {
    expect(normalisePakistanMobile(input)).toEqual({ ok: true, e164: '+923001234567' });
  });

  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['0300-123456a', 'INVALID_CHARACTERS'],
    ['+1 415 555 0100', 'NOT_PAKISTAN'],
    ['0044 20 7946 0000', 'NOT_PAKISTAN'],
    ['042 35761234', 'NOT_MOBILE'], // Lahore landline
    ['+92 42 35761234', 'NOT_MOBILE'],
    ['0300123456', 'WRONG_LENGTH'],
    ['030012345678', 'WRONG_LENGTH'],
    ['0'.repeat(41), 'WRONG_LENGTH'],
  ])('rejects %s with %s', (input, reason) => {
    expect(normalisePakistanMobile(input)).toEqual({ ok: false, reason });
  });

  it('maps every accepted format of the same number to the same E.164 value (property)', () => {
    fc.assert(
      fc.property(nsn, (n) => {
        const expected = { ok: true, e164: `+92${n}` };
        for (const form of [`0${n}`, n, `92${n}`, `+92${n}`, `0092${n}`, `+92 (0)${n.slice(0, 3)}-${n.slice(3)}`]) {
          expect(normalisePakistanMobile(form)).toEqual(expected);
        }
      }),
    );
  });

  it('is idempotent and only ever emits +923XXXXXXXXX (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (s) => {
        const r = normalisePakistanMobile(s);
        if (!r.ok) return true;
        return E164.test(r.e164) && normalisePakistanMobile(r.e164).ok && (normalisePakistanMobile(r.e164) as { e164: string }).e164 === r.e164;
      }),
    );
  });

  it('never throws on arbitrary unicode input (property)', () => {
    fc.assert(fc.property(fc.string({ unit: 'grapheme', maxLength: 60 }), (s) => typeof normalisePakistanMobile(s).ok === 'boolean'));
  });
});
