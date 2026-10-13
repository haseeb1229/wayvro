import { describe, expect, it } from 'vitest';
import { colors, MIN_TOUCH_TARGET } from './tokens';

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

type Color = keyof typeof colors;

/** Every text/background pair the components use (normal text ⇒ AA 4.5:1). */
const TEXT_PAIRS: readonly [Color, Color][] = [
  ['text', 'background'],
  ['textMuted', 'background'],
  ['text', 'surface'],
  ['onPrimary', 'primary'],
  ['primary', 'background'],
  ['danger', 'background'],
  ['danger', 'errorBackground'],
  ['infoText', 'infoBackground'],
  ['warningText', 'warningBackground'],
  ['successText', 'successBackground'],
  ['staleText', 'staleBackground'],
  ['offlineText', 'offlineBackground'],
  ['confidenceHighText', 'confidenceHighBackground'],
  ['confidenceMediumText', 'confidenceMediumBackground'],
  ['confidenceLowText', 'confidenceLowBackground'],
  ['confidenceUnknownText', 'confidenceUnknownBackground'],
  ['priceText', 'background'],
  ['textMuted', 'surface'],
];

/** Non-text indicators (focus ring, map markers, route line) ⇒ WCAG 1.4.11 3:1 against the page. */
const NON_TEXT: readonly Color[] = ['focusRing', 'mapPickup', 'mapDropoff', 'routeLine', 'primary'];

describe('design tokens (WCAG AA)', () => {
  it('the contrast helper matches known reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
  });

  it('every text/background pair meets 4.5:1', () => {
    for (const [fg, bg] of TEXT_PAIRS) expect(contrast(colors[fg], colors[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('every non-text indicator meets 3:1 against the page background', () => {
    for (const c of NON_TEXT) expect(contrast(colors[c], colors.background), c).toBeGreaterThanOrEqual(3);
  });

  it('touch targets are at least 48 dp', () => {
    expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(48);
  });
});
