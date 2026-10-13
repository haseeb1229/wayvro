/**
 * Screen-reader adapters (A08; UX doc §15). Pure functions, unit-tested, used by the primitives and view adapters, so
 * every spoken label and announcement rule lives in one place instead of being improvised per screen.
 *
 * Live regions (Android TalkBack honours `accessibilityLiveRegion`; iOS announcements use `announceForAccessibility`):
 *   polite    — ordinary status text, the search-results count, price updates and "updated / couldn't refresh" stale
 *               notices: announced after the current utterance, once per change;
 *   assertive — a quote that has just expired and a blocking policy state (update required, maintenance): announced
 *               immediately, once (the text does not change while it is shown, so it is not repeated);
 *   none      — text whose announcement is made elsewhere (e.g. the countdown already announced the expiry), so the
 *               same sentence is never read twice.
 */
export type Announcement = 'status' | 'search-results' | 'price-update' | 'stale' | 'expiry' | 'blocking' | 'announced-elsewhere';

export type LivePoliteness = 'polite' | 'assertive' | 'none';

const POLITENESS: Readonly<Record<Announcement, LivePoliteness>> = {
  status: 'polite',
  'search-results': 'polite',
  'price-update': 'polite',
  stale: 'polite',
  expiry: 'assertive',
  blocking: 'assertive',
  'announced-elsewhere': 'none',
};

export function livePoliteness(announcement: Announcement): LivePoliteness {
  return POLITENESS[announcement];
}

/** Sentence-final punctuation in English/Roman Urdu and Urdu (U+06D4 full stop, U+061F question mark). */
const SENTENCE_END = /[.!?۔؟]$/u;

/**
 * Joins label parts into one spoken sentence sequence ("Economy. 4 seats. 640 rupees"): empty parts are dropped, and a
 * part that already ends a sentence is not given a second full stop. Nothing is truncated.
 */
export function spokenSentence(parts: readonly (string | null | undefined)[]): string {
  const present = parts.map((p) => (p ?? '').trim()).filter((p) => p !== '');
  return present.reduce((out, part, i) => (i === 0 ? part : `${out}${SENTENCE_END.test(out) ? ' ' : '. '}${part}`), '');
}

/** A "label, value" pair read as one element (a fare row: "Base fare, 100 rupees"). */
export function spokenPair(label: string, value: string): string {
  return `${label.trim()}, ${value.trim()}`;
}
