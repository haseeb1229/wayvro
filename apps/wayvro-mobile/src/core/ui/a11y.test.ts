import { describe, expect, it } from 'vitest';
import { livePoliteness, spokenPair, spokenSentence, type Announcement } from './a11y';

describe('screen-reader adapters (A08)', () => {
  it('live regions: polite for status, search results, prices and stale notices; assertive for expiry and blocking states', () => {
    const all: Announcement[] = ['status', 'search-results', 'price-update', 'stale', 'expiry', 'blocking', 'announced-elsewhere'];
    expect(all.map(livePoliteness)).toEqual(['polite', 'polite', 'polite', 'polite', 'assertive', 'assertive', 'none']);
  });

  it('spoken sentences drop empty parts, never double a full stop (English or Urdu) and never truncate', () => {
    expect(spokenSentence(['Economy', '4 seats', null, undefined, ' ', '640 rupees'])).toBe('Economy. 4 seats. 640 rupees');
    expect(spokenSentence(['Prices have been updated.', 'Get new price'])).toBe('Prices have been updated. Get new price');
    expect(spokenSentence(['قیمتیں بدل گئی ہیں۔', 'نئی قیمت'])).toBe('قیمتیں بدل گئی ہیں۔ نئی قیمت');
    expect(spokenSentence(['Is this right?', 'Yes'])).toBe('Is this right? Yes');
    expect(spokenSentence([])).toBe('');
    const long = 'x'.repeat(500);
    expect(spokenSentence([long, long])).toBe(`${long}. ${long}`);
  });

  it('a label/value pair reads as one element', () => {
    expect(spokenPair(' Base fare ', '150 rupees')).toBe('Base fare, 150 rupees');
  });
});
