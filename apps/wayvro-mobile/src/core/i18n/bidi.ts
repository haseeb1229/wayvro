/**
 * Bidirectional-text helpers (P18/A06; UX doc §14). Urdu is right-to-left per component (no global forceRTL), but the
 * values inside its sentences — rupee prices, distances, times, codes and Latin-script addresses — are
 * left-to-right runs, and an Urdu-script place name can appear inside an English or Roman-Urdu sentence. Without
 * isolation the Unicode bidi algorithm lets such a value re-order the punctuation and words around it.
 *
 * - `isolate` wraps a value in FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE (U+2068 … U+2069): the value keeps its own
 *   direction (taken from its first strong letter; digits alone resolve left-to-right) and cannot disturb the sentence.
 * - `contentDirection` gives the writing direction of a standalone text run (an address line) from its first strong
 *   letter, so mixed-script rows set an explicit `writingDirection` instead of inheriting the UI language's.
 *
 * Isolation marks are default-ignorable code points: they are not drawn and screen readers do not speak them. They are
 * built from code points (never typed as invisible characters in source).
 */
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

const range = (from: number, to: number): string => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
/** Hebrew, Arabic (incl. Urdu), Syriac, Thaana, NKo (U+0590–U+08FF) and the presentation forms (U+FB1D–U+FDFF, U+FE70–U+FEFC). */
const RTL_LETTER = new RegExp(`[${range(0x0590, 0x08ff)}${range(0xfb1d, 0xfdff)}${range(0xfe70, 0xfefc)}]`, 'u');
const STRONG_LETTER = /\p{L}/u;

/** Whether `text` contains any right-to-left letter. */
export function hasRtlLetters(text: string): boolean {
  return RTL_LETTER.test(text);
}

/** `value` as a first-strong isolate (an empty value stays empty). */
export function isolate(value: string): string {
  return value === '' ? value : `${FSI}${value}${PDI}`;
}

/**
 * Writing direction of a standalone run from its first strong letter; text without letters (digits, symbols) takes
 * `fallback` — the UI direction — so a row of only numbers still aligns with its neighbours.
 */
export function contentDirection(text: string, fallback: 'ltr' | 'rtl'): 'ltr' | 'rtl' {
  for (const ch of text) {
    if (!STRONG_LETTER.test(ch)) continue;
    return RTL_LETTER.test(ch) ? 'rtl' : 'ltr';
  }
  return fallback;
}
