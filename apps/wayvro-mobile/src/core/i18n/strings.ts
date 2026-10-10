/**
 * User-facing copy for the app shell (CLAUDE.md §10: no hardcoded copy in components). Urdu strings are placeholder
 * translations pending native review; Roman-Urdu strategy is decided with the design system (Phase 3, Q29/Q30).
 * Every locale must define exactly the same keys: `STRINGS` is typed `Record<Locale, Record<StringKey, string>>`, so a
 * missing or extra key is a compile error.
 */
export type Locale = 'en' | 'ur';

const en = {
  appName: 'Wayvro',
  shellTitle: 'Wayvro is being built',
  shellBody: 'This development build contains the app shell only. Riding and earning features arrive in later phases.',
} as const;

export type StringKey = keyof typeof en;

const STRINGS: Readonly<Record<Locale, Readonly<Record<StringKey, string>>>> = {
  en,
  ur: {
    appName: 'وے ورو',
    shellTitle: 'وے ورو تیار کیا جا رہا ہے',
    shellBody: 'اس ڈیولپمنٹ بلڈ میں صرف ایپ کا ڈھانچہ ہے۔ سفر اور کمائی کی سہولتیں اگلے مراحل میں آئیں گی۔',
  },
};

const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['ur']);

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

export function t(locale: Locale, key: StringKey): string {
  return STRINGS[locale][key];
}
