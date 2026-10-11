/** Canonical forms for identity and vehicle claims (data model §8.1: plaintext is canonicalised before encryption). */

/** `#####-#######-#` from 13 digits with or without dashes; null when malformed. */
export function canonicalCnic(input: string): string | null {
  const digits = input.replaceAll('-', '');
  if (!/^\d{13}$/.test(digits)) return null;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

/** Upper-case alphanumerics only (`LEA-12-3456` → `LEA123456`); null when outside 2..12 characters. */
export function normalisePlate(input: string): string | null {
  const plate = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return plate.length >= 2 && plate.length <= 12 ? plate : null;
}

/** Upper-case alphanumerics of a document number (lookup canonical form). */
export function canonicalDocumentNumber(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** A plausible date of birth: a real calendar date, not in the future, not before 1900. */
export function plausibleBirthDate(iso: string, now: Date): boolean {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso && t <= now.getTime() && t >= Date.parse('1900-01-01T00:00:00Z');
}
