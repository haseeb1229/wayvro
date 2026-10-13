/**
 * Design tokens (provisional until the Phase 3 design system, Q29/Q30). Components use tokens only, so a visual
 * refresh changes this file and the primitives — never feature logic or the backend. Contrast: every text/background
 * pair here meets WCAG AA for normal text (4.5:1) and every non-text indicator meets 3:1 against the page background;
 * `tokens.test.ts` computes the ratios. Original Wayvro palette — no incumbent colours or layouts.
 */
export const colors = {
  background: '#FFFFFF',
  surface: '#F4F6F8',
  text: '#14213D',
  textMuted: '#4A5468',
  primary: '#0B6E4F',
  onPrimary: '#FFFFFF',
  border: '#C9D0DA',
  danger: '#B42318',
  warningBackground: '#FFF4E5',
  warningText: '#6B3F00',
  infoBackground: '#E8F3EF',
  infoText: '#0A4D38',
  errorBackground: '#FDECEA',
  // P3.5 additions (UX doc §13)
  successBackground: '#E6F4EA',
  successText: '#145C2E',
  staleBackground: '#F1EFE8',
  staleText: '#4D4535',
  offlineBackground: '#ECEFF4',
  offlineText: '#283447',
  confidenceHighBackground: '#E3F1EC',
  confidenceHighText: '#0B5A41',
  confidenceMediumBackground: '#FFF4E5',
  confidenceMediumText: '#6B3F00',
  confidenceLowBackground: '#FDECEA',
  confidenceLowText: '#8A1C12',
  confidenceUnknownBackground: '#EEF0F3',
  confidenceUnknownText: '#3D4657',
  priceText: '#14213D',
  cardBorder: '#C9D0DA',
  focusRing: '#1F5FBF',
  // Map markers and route line (P3.7 renderer; listed now so the text-first screens and the map share one palette)
  mapPickup: '#0B6E4F',
  mapDropoff: '#7A2E8E',
  routeLine: '#1F5FBF',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const radii = { sm: 6, md: 8, lg: 12 } as const;

/** Card elevation: a border plus a subtle shadow (Android elevation 1). */
export const elevation = {
  card: { borderWidth: 1, borderColor: colors.cardBorder, elevation: 1, shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
} as const;

export const typography = {
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  caption: { fontSize: 14, fontWeight: '400' },
  captionStrong: { fontSize: 14, fontWeight: '600' },
  /** Prices (rendered with tabular figures so amounts align in lists). */
  price: { fontSize: 20, fontWeight: '700' },
} as const;

/** Minimum touch target (dp) — above the 44/48 dp platform guidance minimums. */
export const MIN_TOUCH_TARGET = 48;
