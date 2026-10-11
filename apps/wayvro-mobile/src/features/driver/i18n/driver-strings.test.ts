import { LOCALES } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { DRIVER_CATALOGUE, driverText, type DriverStringKey } from './driver-strings';

const placeholders = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
const entries = () => LOCALES.flatMap((locale) => Object.entries(DRIVER_CATALOGUE[locale]).map(([key, value]) => ({ locale, key, value })));

describe('Driver/Partner copy catalogue', () => {
  it('en, ur and ur-Latn have exactly the same keys, none empty', () => {
    const keys = Object.keys(DRIVER_CATALOGUE.en).sort();
    expect(Object.keys(DRIVER_CATALOGUE).sort()).toEqual([...LOCALES].sort());
    for (const locale of LOCALES) {
      expect(Object.keys(DRIVER_CATALOGUE[locale]).sort()).toEqual(keys);
      for (const key of keys) expect(DRIVER_CATALOGUE[locale][key as DriverStringKey].trim(), `${locale}:${key}`).not.toBe('');
    }
  });

  it('every translation uses exactly the English {placeholders}', () => {
    for (const { locale, key, value } of entries())
      expect(placeholders(value), `${locale}:${key}`).toEqual(placeholders(DRIVER_CATALOGUE.en[key as DriverStringKey]));
  });

  it('makes no identity-verification, liveness, face-match, government-database or automatic-approval claims', () => {
    const forbidden = [
      /nadra/i,
      /نادرا/,
      /liveness/i,
      /verified identity/i,
      /identity (is |was )?verified/i,
      /biometric/i,
      /\bkyc\b/i,
      /approved automatically/i,
      /automatically approved/i,
      /proves? (who you are|your identity)/i,
      /\bgender\b/i,
    ];
    for (const { locale, key, value } of entries())
      for (const pattern of forbidden) expect(pattern.test(value), `${locale}:${key} ${String(pattern)}`).toBe(false);
  });

  it('mentions face matching only to say it is NOT done', () => {
    for (const { locale, key, value } of entries()) {
      if (!/face[ -]?match/i.test(value)) continue;
      expect(/(no automatic face matching|not used for automatic face matching)/i.test(value), `${locale}:${key}`).toBe(true);
    }
    expect(DRIVER_CATALOGUE.en['explain.decisionBody']).toMatch(/no automated decision and no automatic face matching/);
  });

  it('police and insurance appear only as names of documents, never as an integration claim', () => {
    for (const { locale, key, value } of entries()) {
      if (/police|insurance|پولیس|انشورنس/i.test(value)) expect(key.startsWith('doc.'), `${locale}:${key}`).toBe(true);
    }
  });

  it('contains no age threshold number anywhere', () => {
    for (const { locale, key, value } of entries()) expect(/\b(1[3-9]|2[01])\b/.test(value), `${locale}:${key}`).toBe(false);
  });

  it('labels the selfie as for manual review, retention as not final, and the placeholder requirement set', () => {
    expect(DRIVER_CATALOGUE.en['doc.SELFIE']).toMatch(/manual review/);
    expect(DRIVER_CATALOGUE.en['explain.retentionBody']).toMatch(/not final/);
    expect(DRIVER_CATALOGUE.en['driver.placeholderSet']).toMatch(/not the final legal requirements/);
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(driverText('en', 'driver.reference', { code: 'SYNTHETIC' })).toBe('Reference: SYNTHETIC');
    expect(driverText('ur', 'overview.progress', { done: 1, total: 3 })).toContain('3');
    expect(driverText('en', 'driver.reference')).toContain('{code}');
  });
});
