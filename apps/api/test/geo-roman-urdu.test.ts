/**
 * A06 Roman-Urdu-aware search (P3.9): the normaliser turns the spellings people actually type (case, spacing,
 * punctuation, full-width and Arabic presentation forms, invisible characters) into one canonical form, and every
 * synthetic landmark alias of the dev/test seed is stored in that form so alias lookup (exact match) works. The phone
 * never transliterates; aliases live on the server and are used only after staff maker-checker activation.
 * Unit level (no database); the seed itself is covered by packages/db/test/geo-controls.integration.test.ts.
 */
import { createGeoTestDoubles } from '@wayvro/provider-test-doubles';
import { SYNTHETIC_LANDMARK_ALIASES } from '@wayvro/test-support';
import { describe, expect, it } from 'vitest';
import { codePointLength, normaliseQuery } from '../src/geo/normalise.js';

const live = (): AbortSignal => new AbortController().signal;
/** Characters by code point (invisible and presentation-form characters are never typed literally in source). */
const cp = (...points: number[]): string => String.fromCodePoint(...points);
const suggestIds = async (text: string): Promise<string[]> => {
  const d = createGeoTestDoubles();
  const hits = await d.placesAutocomplete.suggest(
    { text, locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: '0192a5b0-0000-7000-8000-000000000009' },
    live(),
  );
  return hits.map((h) => h.providerPlaceId);
};

describe('A06 Roman-Urdu and Urdu query normalisation', () => {
  it('folds the ways a Roman-Urdu query is typed into one canonical form', () => {
    expect(normaliseQuery('Minar-e-Pakistan')).toBe('minar-e-pakistan');
    expect(normaliseQuery('  DATA   Darbar ')).toBe('data darbar');
    expect(normaliseQuery('Badshahi Masjid.')).toBe('badshahi masjid');
    expect(normaliseQuery('kalma chok?')).toBe('kalma chok');
    expect(normaliseQuery('Ｄａｔａ Ｄａｒｂａｒ')).toBe('data darbar');
    expect(normaliseQuery(`model${cp(0xa0)}taun`)).toBe('model taun');
    expect(normaliseQuery(`libarti${cp(0x200b)} market`)).toBe('libarti market');
    expect(normaliseQuery(`${cp(0x202e)}anar kali${cp(0x202c)}`)).toBe('anar kali');
  });

  it('keeps Urdu script as typed (no case), maps presentation forms to letters, keeps ZWNJ and trims Urdu punctuation', () => {
    expect(normaliseQuery('داتا دربار')).toBe('داتا دربار');
    expect(normaliseQuery(cp(0xfea9, 0xfe8d, 0xfe97, 0xfe8e))).toBe('داتا');
    expect(normaliseQuery('مینار پاکستان؟')).toBe('مینار پاکستان');
    expect(normaliseQuery('کلمہ چوک۔')).toBe('کلمہ چوک');
    expect(normaliseQuery(`ریلوے${cp(0x200c)}اسٹیشن`)).toBe(`ریلوے${cp(0x200c)}اسٹیشن`);
    // Roman Urdu and Urdu are never transliterated into each other (that is what reviewed aliases are for).
    expect(normaliseQuery('data darbar')).not.toBe(normaliseQuery('داتا دربار'));
  });
});

describe('A06 synthetic landmark aliases (dev/test seed, PROPOSED only)', () => {
  it('cover Roman Urdu, English and Urdu spellings of every synthetic gazetteer place, with unique ids', () => {
    expect(new Set(SYNTHETIC_LANDMARK_ALIASES.map((a) => a.locale))).toEqual(new Set(['en', 'ur', 'ur-Latn']));
    expect(new Set(SYNTHETIC_LANDMARK_ALIASES.map((a) => a.placeId)).size).toBe(14);
    expect(new Set(SYNTHETIC_LANDMARK_ALIASES.map((a) => a.id)).size).toBe(SYNTHETIC_LANDMARK_ALIASES.length);
    expect(new Set(SYNTHETIC_LANDMARK_ALIASES.map((a) => `${a.locale}|${a.alias}`)).size).toBe(SYNTHETIC_LANDMARK_ALIASES.length);
  });

  it('are stored in the normaliser canonical form (exact-match lookup) within the database length limits', () => {
    for (const a of SYNTHETIC_LANDMARK_ALIASES) {
      expect(normaliseQuery(a.alias), a.alias).toBe(a.alias);
      expect(normaliseQuery(a.canonical), a.canonical).toBe(a.canonical);
      expect(a.alias).not.toBe(a.canonical);
      expect(codePointLength(a.alias)).toBeGreaterThanOrEqual(2);
      expect(codePointLength(a.alias)).toBeLessThanOrEqual(80);
    }
  });

  it('each canonical query finds its synthetic place, and the alias alone finds nothing (the alias is what makes it work)', async () => {
    for (const a of SYNTHETIC_LANDMARK_ALIASES) {
      expect(await suggestIds(a.canonical), a.canonical).toContain(a.placeId);
      expect(await suggestIds(a.alias), a.alias).toEqual([]);
    }
  });
});
