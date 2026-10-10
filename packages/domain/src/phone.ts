/**
 * Pakistan mobile number normalisation to E.164 (+92 3XX XXXXXXX).
 *
 * Accepted input shapes (separators: spaces, dashes, dots, parentheses):
 *   03001234567 · 3001234567 · 923001234567 · +923001234567 · 00923001234567 · +92 (0)300-1234567
 * Arabic-Indic (٠-٩) and Urdu/Persian (۰-۹) digits are converted to ASCII, because users may type with an Urdu keyboard.
 *
 * This is syntax normalisation only. It does not prove the number exists, belongs to the user or is reachable;
 * ownership is established by OTP verification (Phase 2). Landlines and non-Pakistani numbers are rejected.
 */

export type PakistanMobileE164 = `+92${string}`;
export type PhoneRejection = 'EMPTY' | 'INVALID_CHARACTERS' | 'NOT_PAKISTAN' | 'NOT_MOBILE' | 'WRONG_LENGTH';
export type PhoneNormalisation = { readonly ok: true; readonly e164: PakistanMobileE164 } | { readonly ok: false; readonly reason: PhoneRejection };

const SEPARATORS = /[\s\-.()]/g; // \s already covers NBSP (U+00A0) and other Unicode spaces
const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const MAX_INPUT_LENGTH = 40;

function toAsciiDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= ARABIC_INDIC_ZERO && cp <= ARABIC_INDIC_ZERO + 9) out += String(cp - ARABIC_INDIC_ZERO);
    else if (cp >= EXTENDED_ARABIC_INDIC_ZERO && cp <= EXTENDED_ARABIC_INDIC_ZERO + 9) out += String(cp - EXTENDED_ARABIC_INDIC_ZERO);
    else out += ch;
  }
  return out;
}

export function normalisePakistanMobile(input: string): PhoneNormalisation {
  if (input.length > MAX_INPUT_LENGTH) return { ok: false, reason: 'WRONG_LENGTH' };
  let s = toAsciiDigits(input).replace(SEPARATORS, '');
  if (s.length === 0) return { ok: false, reason: 'EMPTY' };
  if (!/^\+?\d+$/.test(s)) return { ok: false, reason: 'INVALID_CHARACTERS' };

  // Reduce every accepted international prefix to the national significant number (NSN).
  if (s.startsWith('+')) {
    if (!s.startsWith('+92')) return { ok: false, reason: 'NOT_PAKISTAN' };
    s = s.slice(3);
  } else if (s.startsWith('00')) {
    if (!s.startsWith('0092')) return { ok: false, reason: 'NOT_PAKISTAN' };
    s = s.slice(4);
  } else if (s.startsWith('92') && s.length === 12) {
    s = s.slice(2);
  }
  // "+92 (0)300…" and the domestic trunk prefix "0300…" both carry a leading 0 before the NSN.
  if (s.startsWith('0')) s = s.slice(1);

  if (!s.startsWith('3')) return { ok: false, reason: 'NOT_MOBILE' };
  if (s.length !== 10) return { ok: false, reason: 'WRONG_LENGTH' };
  return { ok: true, e164: `+92${s}` };
}
