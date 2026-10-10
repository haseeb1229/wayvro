import { describe, expect, it } from 'vitest';
import { isRtl, t, type Locale, type StringKey } from './strings';

const LOCALES: Locale[] = ['en', 'ur'];
const KEYS: StringKey[] = ['appName', 'shellTitle', 'shellBody'];

describe('shell localisation', () => {
  it('every locale has non-empty copy for every key (key parity itself is a compile-time guarantee)', () => {
    for (const locale of LOCALES) for (const key of KEYS) expect(t(locale, key).trim()).not.toBe('');
    expect(t('en', 'appName')).toBe('Wayvro');
  });

  it('marks Urdu as right-to-left', () => {
    expect(isRtl('ur')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });
});
