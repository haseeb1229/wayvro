import { LOCALES } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { CATALOGUE, dateLocaleTag, formatDate, formatDateTime, isRtl, PENDING_REVIEW_LOCALES, policyLocaleFor, t, type StringKey } from './strings';

const placeholders = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
const allEntries = () => LOCALES.flatMap((locale) => Object.entries(CATALOGUE[locale]).map(([key, value]) => ({ locale, key, value })));

describe('i18n catalogue', () => {
  it('covers exactly the contract locales en, ur and ur-Latn', () => {
    expect(Object.keys(CATALOGUE).sort()).toEqual([...LOCALES].sort());
  });

  it('every locale has every key, no extra key and no empty value', () => {
    const keys = Object.keys(CATALOGUE.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(CATALOGUE[locale]).sort()).toEqual(keys);
      for (const key of keys) expect(CATALOGUE[locale][key as StringKey].trim(), `${locale}:${key}`).not.toBe('');
    }
  });

  it('every translation uses exactly the same {placeholders} as English', () => {
    for (const { locale, key, value } of allEntries()) expect(placeholders(value), `${locale}:${key}`).toEqual(placeholders(CATALOGUE.en[key as StringKey]));
  });

  it('makes no identity-verification, liveness, government-database or emergency-service claims', () => {
    const forbidden = [/nadra/i, /نادرا/, /liveness/i, /verified identity/i, /identity (is )?verified/i, /biometric/i, /police/i, /\bkyc\b/i, /insurance/i];
    for (const { locale, key, value } of allEntries())
      for (const pattern of forbidden) expect(pattern.test(value), `${locale}:${key} ${String(pattern)}`).toBe(false);
  });

  it('contains no hard-coded age threshold: age copy has no digits, and no value states a typical age limit', () => {
    for (const { locale, key, value } of allEntries()) {
      if (key.startsWith('age.')) expect(/[0-9٠-٩۰-۹]/.test(value), `${locale}:${key}`).toBe(false);
      expect(/\b(1[3-9]|2[01])\b/.test(value), `${locale}:${key}`).toBe(false);
    }
    expect(placeholders(CATALOGUE.en['age.affirmWithAge'])).toEqual(['minimumAge']);
  });

  it('labels placeholder legal texts with the same notice as the public web', () => {
    expect(t('en', 'common.placeholderNotice')).toBe('PLACEHOLDER — NOT FOR PRODUCTION — pending counsel approval');
  });

  it('interpolates parameters and leaves unknown placeholders visible', () => {
    expect(t('en', 'error.rateLimited', { seconds: 30 })).toBe('Too many attempts. Try again in 30 seconds.');
    expect(t('ur', 'otp.body', { destination: '+92 3** *** **01' })).toContain('+92 3** *** **01');
    expect(t('en', 'otp.body')).toContain('{destination}');
  });

  it('marks Urdu right-to-left and Roman Urdu left-to-right; non-English copy is pending native review', () => {
    expect(isRtl('ur')).toBe(true);
    expect(isRtl('ur-Latn')).toBe(false);
    expect(isRtl('en')).toBe(false);
    expect([...PENDING_REVIEW_LOCALES].sort()).toEqual(['ur', 'ur-Latn']);
  });

  it('formats server timestamps for display and never throws on malformed input', () => {
    expect(formatDate('2026-10-01T09:00:00.000Z', 'en')).toMatch(/2026/);
    expect(formatDateTime('2026-10-01T09:00:00.000Z', 'ur')).not.toBe('');
    expect(formatDate('not-a-date', 'en')).toBe('not-a-date');
  });

  it('maps UI locales to policy text locales and date formats', () => {
    expect(policyLocaleFor('ur')).toBe('ur');
    expect(policyLocaleFor('ur-Latn')).toBe('en');
    expect(policyLocaleFor('en')).toBe('en');
    expect(dateLocaleTag('ur')).toBe('ur-PK');
    expect(dateLocaleTag('ur-Latn')).toBe('en-PK');
  });
});
