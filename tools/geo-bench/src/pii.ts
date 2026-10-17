/**
 * Conservative personal-data warnings for the capture sheet's free-text fields (SP-04 §4.1 item 10: no names, phone
 * numbers, plates or private addresses). These are WARNINGS for the founder to review, not proof of absence: a clean
 * scan does not certify the sheet. Warnings never echo the matched text (the console may be shared or recorded).
 */

export type PiiKind = 'PHONE_NUMBER' | 'LONG_DIGIT_RUN' | 'CNIC' | 'EMAIL' | 'VEHICLE_PLATE' | 'PRIVATE_ADDRESS_WORD' | 'PERSONAL_NAME_WORD';

const PATTERNS: readonly (readonly [PiiKind, RegExp])[] = [
  ['CNIC', /\b\d{5}-?\d{7}-?\d\b/],
  ['PHONE_NUMBER', /(?:\+?92|\b0)[\s-]?3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/],
  ['LONG_DIGIT_RUN', /\d(?:[\s-]?\d){6,}/],
  ['EMAIL', /[^\s@]+@[^\s@]+\.[^\s@]+/],
  // e.g. "LEA-1234", "LED 123", "ABC 2019": plate-shaped tokens (case ids such as LHR-SP04-001 are excluded below).
  ['VEHICLE_PLATE', /\b[A-Z]{2,4}[- ]?\d{1,4}\b/],
  ['PRIVATE_ADDRESS_WORD', /\b(house|h\s?#|h\.?\s?no|home|residence|ghar|makan|flat\s?no|apartment|my\s+place)\b/i],
  ['PERSONAL_NAME_WORD', /\b(mr|mrs|ms|miss|sahab|sahib|bhai|bhaijan|uncle|aunty|auntie|baji|begum)\b\.?/i],
];

const CASE_ID_TOKEN = /\bLHR-SP04-(?:S\d|\d{3})\b/g;

/** Returns the kinds of personal-data patterns found in one value (empty array = nothing matched). */
export function scanForPii(value: string): PiiKind[] {
  const text = value.replace(CASE_ID_TOKEN, ' ');
  const kinds: PiiKind[] = [];
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(text)) kinds.push(kind);
  }
  // A CNIC is also a long digit run: report the more specific kind only.
  return kinds.includes('CNIC') || kinds.includes('PHONE_NUMBER') ? kinds.filter((k) => k !== 'LONG_DIGIT_RUN') : kinds;
}
