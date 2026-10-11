/**
 * Design tokens (provisional until the Phase 3 design system, Q29/Q30). Components use tokens only, so a visual
 * refresh changes this file and the primitives — never feature logic or the backend. Contrast: text/background pairs
 * here meet WCAG AA for normal text.
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
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const typography = {
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  caption: { fontSize: 14, fontWeight: '400' },
} as const;

/** Minimum touch target (dp) — above the 44/48 dp platform guidance minimums. */
export const MIN_TOUCH_TARGET = 48;
