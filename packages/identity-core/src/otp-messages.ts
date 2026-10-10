/**
 * OTP message text per locale (content, not business logic — CLAUDE.md §10). Urdu and Roman-Urdu wording is a draft
 * PENDING NATIVE-SPEAKER REVIEW and, like every user-facing SMS text, needs the vendor/PTA template approval of EG-01
 * before any real send. The code is never logged.
 */
export const OTP_LOCALES = ['en', 'ur', 'ur-Latn'] as const;
export type OtpLocale = (typeof OTP_LOCALES)[number];

const TEMPLATES: Readonly<Record<OtpLocale, string>> = {
  en: 'Your Wayvro code is {code}. It expires in {minutes} minutes. Never share this code with anyone.',
  ur: 'آپ کا Wayvro کوڈ {code} ہے۔ یہ {minutes} منٹ میں ختم ہو جائے گا۔ یہ کوڈ کسی کو نہ بتائیں۔',
  'ur-Latn': 'Aap ka Wayvro code {code} hai. Yeh {minutes} minute mein khatam ho jayega. Yeh code kisi ko na batayein.',
};

export function renderOtpMessage(locale: OtpLocale, code: string, minutes: number): string {
  if (!/^\d{6}$/.test(code)) throw new RangeError('OTP code must be six digits');
  return TEMPLATES[locale].replace('{code}', code).replace('{minutes}', String(minutes));
}
