import type { AccountState } from '@wayvro/contracts';
import { routeForRequiredActions, type AccountRoute } from '../account/account-route';
import type { ClientPolicyView } from '../release/client-policy';
import type { SessionState } from '../session/session-manager';
import { driverHomeAvailable, homeOf, modeAvailability, type AppMode, type ModeAvailability, type ModeHome } from './availability';
import type { LastQuote, ModePreference } from './persisted';

/**
 * Restoration (V08; ADR-048; UX doc §6). One pure function decides where the app starts on cold start, after process
 * death, after sign-in and after an intent, so every path converges on the same answer for the same server truth:
 *  1. app policy (HARD_UPDATE / MAINTENANCE block everything below),
 *  2. session (signed out ⇒ sign-in),
 *  3. required actions (AccountGate pins them),
 *  4. server account state ⇒ mode availability,
 *  5. (Phase 4/5 extension point: an active driver job / rider trip outranks the preference — no code in Phase 3),
 *  6. the stored mode preference when that mode is available (DRIVER only with a driver profile, entry HUB),
 *     otherwise Rider home,
 *  7. the last quote group (rider home only, ≤ 30 min old) — the server's owner-only GET then decides what is shown.
 */

/** A stored quote group is offered for restoration only while it is younger than this. */
export const LAST_QUOTE_MAX_AGE_MS = 30 * 60 * 1000;

/** Step 6: the mode home for this account. The preference is a hint: it never grants a mode the server does not offer. */
export function resolveEntry(availability: ModeAvailability, preference: ModePreference | null, accountId: string): AppMode {
  const preferred = preference !== null && preference.accountId === accountId ? preference.mode : 'RIDER';
  return preferred === 'DRIVER' && driverHomeAvailable(availability) ? 'DRIVER' : 'RIDER';
}

export type StartRoute =
  | { readonly kind: 'blocked' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'sign-in' }
  | { readonly kind: 'required-action'; readonly href: AccountRoute }
  | { readonly kind: 'home'; readonly mode: AppMode; readonly href: ModeHome; readonly restoreQuoteGroupId: string | null };

export function restorableQuote(lastQuote: LastQuote | null, now: number): string | null {
  if (lastQuote === null) return null;
  const age = now - lastQuote.savedAt;
  return age >= 0 && age < LAST_QUOTE_MAX_AGE_MS ? lastQuote.quoteGroupId : null;
}

export function resolveStartRoute(
  appPolicy: ClientPolicyView,
  session: SessionState,
  account: AccountState | null,
  preference: ModePreference | null,
  lastQuote: LastQuote | null,
  now: number,
): StartRoute {
  if (appPolicy.kind === 'hard-update' || appPolicy.kind === 'maintenance') return { kind: 'blocked' };
  if (session.status === 'loading') return { kind: 'loading' };
  if (session.status === 'signed-out') return { kind: 'sign-in' };
  if (account === null) return { kind: 'loading' };
  if (account.requiredActions.length > 0) return { kind: 'required-action', href: routeForRequiredActions(account.requiredActions, '/ride') };
  const mode = resolveEntry(modeAvailability(account), preference, account.account.id);
  return { kind: 'home', mode, href: homeOf(mode), restoreQuoteGroupId: mode === 'RIDER' ? restorableQuote(lastQuote, now) : null };
}
