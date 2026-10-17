import { describe, expect, it } from 'vitest';
import { contentDirection, hasRtlLetters, isolate } from './bidi';
import { formatPkr } from './money';
import { t } from './strings';

const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

describe('bidi isolation of values inside sentences (P18/A06 RTL)', () => {
  it('isolates with first-strong isolate marks and leaves an empty value empty', () => {
    expect(isolate('Rs 640')).toBe(`${FSI}Rs 640${PDI}`);
    expect(isolate('')).toBe('');
  });

  it('detects right-to-left letters (Urdu script) but not Latin, digits or symbols', () => {
    expect(hasRtlLetters('مینار پاکستان')).toBe(true);
    expect(hasRtlLetters('Block Y, DHA Phase 3')).toBe(false);
    expect(hasRtlLetters('Rs 1,250 · 4:32')).toBe(false);
  });

  it('every value inserted into an Urdu sentence is isolated: prices, numbers, Latin addresses and Urdu names', () => {
    const price = formatPkr({ currency: 'PKR', minor: '125000' }) ?? '';
    expect(t('ur', 'fare.taxIncluded', { rate: '16', amount: price })).toContain(`${FSI}Rs 1,250${PDI}`);
    expect(t('ur', 'fare.taxIncluded', { rate: '16', amount: price })).toContain(`${FSI}16${PDI}`);
    expect(t('ur', 'rider.quote.from', { place: 'Liberty Market' })).toContain(`${FSI}Liberty Market${PDI}`);
    expect(t('ur', 'error.rateLimited', { seconds: 30 })).toContain(`${FSI}30${PDI}`);
  });

  it('in English and Roman Urdu only right-to-left values are isolated; Latin values and numbers are unchanged', () => {
    expect(t('en', 'error.rateLimited', { seconds: 30 })).toBe('Too many attempts. Try again in 30 seconds.');
    expect(t('ur-Latn', 'rider.quote.from', { place: 'Liberty Market' })).not.toContain(FSI);
    expect(t('en', 'rider.quote.snappedPickup', { name: 'مصنوعی گیٹ' })).toBe(`Pickup point: ${FSI}مصنوعی گیٹ${PDI}`);
    expect(t('ur-Latn', 'home.greeting', { name: 'احمد' })).toContain(`${FSI}احمد${PDI}`);
  });

  it('a standalone address line takes its writing direction from its first letter, digits-only text from the UI', () => {
    expect(contentDirection('Liberty Market', 'rtl')).toBe('ltr');
    expect(contentDirection('بادشاہی مسجد', 'ltr')).toBe('rtl');
    expect(contentDirection('12-B بلاک', 'ltr')).toBe('ltr');
    expect(contentDirection('۱۲ بلاک Y', 'ltr')).toBe('rtl');
    expect(contentDirection('123 · 4', 'rtl')).toBe('rtl');
    expect(contentDirection('', 'ltr')).toBe('ltr');
  });
});
