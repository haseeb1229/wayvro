/**
 * Quote validity countdown (B06 display; E05 UI). Computed on the SERVER-offset clock (`Date.now() + clock.offsetMs`,
 * from the server's `Date` header) — the device clock alone is never trusted; the server re-validates at use anyway.
 * Screen readers are told only at thresholds: one minute left (polite) and expiry (assertive, once).
 */
export interface CountdownState {
  readonly remainingS: number;
  readonly expired: boolean;
}

export function countdownState(expiresAtIso: string, serverNowMs: number): CountdownState {
  const expiresAt = Date.parse(expiresAtIso);
  if (Number.isNaN(expiresAt)) return { remainingS: 0, expired: true };
  const remainingS = Math.max(0, Math.ceil((expiresAt - serverNowMs) / 1000));
  return { remainingS, expired: remainingS === 0 };
}

/** "4:32" (minutes:seconds, Western digits, LTR run). */
export function countdownText(remainingS: number): string {
  const s = Math.max(0, Math.floor(remainingS));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export type CountdownAnnouncement = 'ONE_MINUTE' | 'EXPIRED';

/**
 * The threshold the countdown is in (null above one minute). The Countdown component announces only when this value
 * CHANGES, so screen readers hear "one minute left" once and "prices have been updated" once — never every second.
 */
export function announcementFor(remainingS: number): CountdownAnnouncement | null {
  if (remainingS <= 0) return 'EXPIRED';
  return remainingS <= 60 ? 'ONE_MINUTE' : null;
}
