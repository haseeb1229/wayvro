import type { DriverStringKey } from '../i18n/driver-strings';

/**
 * Status marks of the Driver/Partner readiness and eligibility rows (UX doc §10.1, §15). A mark is always shown as a
 * text glyph WITH a full text label; the glyph is decorative (hidden from screen readers) — never colour or glyph alone.
 */
export type RowMark = 'ok' | 'attention' | 'blocked' | 'info';

const MARK_GLYPH: Readonly<Record<RowMark, string>> = { ok: '✓', attention: '!', blocked: '✕', info: 'i' };
export const markGlyph = (mark: RowMark): string => MARK_GLYPH[mark];

const MARK_KEY: Readonly<Record<RowMark, DriverStringKey>> = {
  ok: 'drive.mark.ok',
  attention: 'drive.mark.attention',
  blocked: 'drive.mark.blocked',
  info: 'drive.mark.info',
};
export const markKey = (mark: RowMark): DriverStringKey => MARK_KEY[mark];
