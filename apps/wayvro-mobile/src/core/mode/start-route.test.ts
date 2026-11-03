import type { AccountState } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_ID, ACCOUNT_KINDS, P3_IDS, p3Account } from '../../__mocks__/p3-fixtures';
import { routeForRequiredActions } from '../account/account-route';
import type { ClientPolicyView } from '../release/client-policy';
import type { SessionState } from '../session/session-manager';
import { modeAvailability } from './availability';
import type { LastQuote, ModePreference } from './persisted';
import { LAST_QUOTE_MAX_AGE_MS, resolveEntry, resolveStartRoute, restorableQuote, type StartRoute } from './start-route';

const NOW = Date.parse('2026-10-13T10:00:00.000Z');

const POLICIES: readonly ClientPolicyView[] = [
  { kind: 'ok' },
  { kind: 'soft-update', bannerVisible: true },
  { kind: 'hard-update', reasonClass: 'SECURITY', storeUrlKey: null },
  { kind: 'maintenance', messageKey: null, expectedEnd: null },
];
const SESSIONS: readonly SessionState[] = [{ status: 'loading' }, { status: 'signed-out', reason: 'none' }, { status: 'signed-in', sessionId: P3_IDS.group }];
const ACCOUNTS: readonly (AccountState | null)[] = [null, ...ACCOUNT_KINDS.flatMap((k) => [p3Account(k), p3Account(k, true)])];
const pref = (mode: 'RIDER' | 'DRIVER', accountId: string): ModePreference => ({ v: 1, accountId, mode, savedAt: NOW - 1000 });
const PREFERENCES: readonly (ModePreference | null)[] = [null, pref('RIDER', ACCOUNT_ID), pref('DRIVER', ACCOUNT_ID), pref('DRIVER', P3_IDS.otherAccount)];
const quote = (ageMs: number): LastQuote => ({ v: 1, quoteGroupId: P3_IDS.group, expiresAt: '2026-10-13T10:05:00.000Z', savedAt: NOW - ageMs });
const LAST_QUOTES: readonly (LastQuote | null)[] = [null, quote(10 * 60_000), quote(LAST_QUOTE_MAX_AGE_MS), quote(LAST_QUOTE_MAX_AGE_MS + 1), quote(-60_000)];

/** Independent oracle of the precedence in UX doc §6 (written separately from the implementation). */
function expected(
  policy: ClientPolicyView,
  session: SessionState,
  account: AccountState | null,
  preference: ModePreference | null,
  last: LastQuote | null,
): StartRoute {
  if (policy.kind === 'hard-update' || policy.kind === 'maintenance') return { kind: 'blocked' };
  if (session.status === 'loading') return { kind: 'loading' };
  if (session.status === 'signed-out') return { kind: 'sign-in' };
  if (account === null) return { kind: 'loading' };
  if (account.requiredActions.length > 0) return { kind: 'required-action', href: routeForRequiredActions(account.requiredActions, '/ride') };
  const availability = modeAvailability(account);
  const driver =
    preference?.mode === 'DRIVER' && preference.accountId === account.account.id && availability.driver.entry === 'HUB' && availability.driver.available;
  if (driver) return { kind: 'home', mode: 'DRIVER', href: '/drive', restoreQuoteGroupId: null };
  const age = last === null ? null : NOW - last.savedAt;
  return { kind: 'home', mode: 'RIDER', href: '/ride', restoreQuoteGroupId: age !== null && age >= 0 && age < LAST_QUOTE_MAX_AGE_MS ? P3_IDS.group : null };
}

describe('EXH-RESTORE: restoration precedence (exhaustive)', () => {
  it('every policy × session × account (A–I, N; with/without server modes) × preference × last-quote combination', () => {
    let cases = 0;
    for (const policy of POLICIES)
      for (const session of SESSIONS)
        for (const account of ACCOUNTS)
          for (const preference of PREFERENCES)
            for (const last of LAST_QUOTES) {
              const actual = resolveStartRoute(policy, session, account, preference, last, NOW);
              expect(actual, JSON.stringify({ policy: policy.kind, session: session.status, preference, last })).toEqual(
                expected(policy, session, account, preference, last),
              );
              // Invariants that must hold whatever the oracle says.
              if (actual.kind === 'home' && actual.mode === 'DRIVER') {
                expect(account?.driver.profile).not.toBeNull();
                expect(actual.restoreQuoteGroupId).toBeNull();
              }
              if (actual.kind === 'home') expect(account?.requiredActions).toEqual([]);
              cases += 1;
            }
    expect(cases).toBe(POLICIES.length * SESSIONS.length * ACCOUNTS.length * PREFERENCES.length * LAST_QUOTES.length);
  });

  it('a DRIVER preference never opens the driver home for a rider-only, pending, or other account', () => {
    for (const kind of ['A', 'F', 'H', 'N'] as const)
      expect(resolveEntry(modeAvailability(p3Account(kind)), pref('DRIVER', ACCOUNT_ID), ACCOUNT_ID)).toBe('RIDER');
    expect(resolveEntry(modeAvailability(p3Account('B')), pref('DRIVER', P3_IDS.otherAccount), ACCOUNT_ID)).toBe('RIDER');
    expect(resolveEntry(modeAvailability(p3Account('B')), pref('DRIVER', ACCOUNT_ID), ACCOUNT_ID)).toBe('DRIVER');
    expect(resolveEntry(modeAvailability(p3Account('B')), null, ACCOUNT_ID)).toBe('RIDER');
  });

  it('the last quote record is offered only while younger than 30 minutes (and never from the future)', () => {
    expect(restorableQuote(quote(0), NOW)).toBe(P3_IDS.group);
    expect(restorableQuote(quote(LAST_QUOTE_MAX_AGE_MS - 1), NOW)).toBe(P3_IDS.group);
    expect(restorableQuote(quote(LAST_QUOTE_MAX_AGE_MS), NOW)).toBeNull();
    expect(restorableQuote(quote(-1), NOW)).toBeNull();
    expect(restorableQuote(null, NOW)).toBeNull();
  });
});
