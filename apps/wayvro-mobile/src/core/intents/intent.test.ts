import type { AccountState } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_KINDS, P3_IDS, p3Account } from '../../__mocks__/p3-fixtures';
import { driverHomeAvailable, modeAvailability, type AppMode } from '../mode/availability';
import { INTENT_KINDS, navigationSteps, resolveIntent, type Intent, type IntentContext, type IntentKind } from './intent';

/** One valid sample per allowlisted kind (ids only). */
const SAMPLE: Readonly<Record<IntentKind, Intent>> = {
  OPEN_RIDER_HOME: { kind: 'OPEN_RIDER_HOME' },
  OPEN_QUOTE: { kind: 'OPEN_QUOTE', quoteGroupId: P3_IDS.group },
  OPEN_DRIVER_HOME: { kind: 'OPEN_DRIVER_HOME' },
  OPEN_DRIVER_APPLICATION: { kind: 'OPEN_DRIVER_APPLICATION' },
  OPEN_DRIVER_COMPLIANCE: { kind: 'OPEN_DRIVER_COMPLIANCE' },
  OPEN_DOCUMENT_RENEWAL: { kind: 'OPEN_DOCUMENT_RENEWAL', documentId: P3_IDS.document },
  OPEN_RESTRICTION_APPEAL: { kind: 'OPEN_RESTRICTION_APPEAL', restrictionId: P3_IDS.restriction },
  OPEN_ACCOUNT_SECURITY: { kind: 'OPEN_ACCOUNT_SECURITY' },
  OPEN_LEGAL: { kind: 'OPEN_LEGAL' },
};
const DRIVER_ONLY_TARGETS = ['/earn/compliance', '/earn/renewal'];

const accounts = (): AccountState[] => {
  const base = ACCOUNT_KINDS.flatMap((k) => [p3Account(k), p3Account(k, true)]);
  // Every account also with a pending required action (the gate must never be bypassed).
  return [...base, ...base.map((a) => ({ ...a, requiredActions: ['AGE_DECLARATION' as const] }))];
};

describe('EXH-INTENT: allowlisted intents × accounts (A–I, N; ± server modes; ± required action) × mode × policy × session', () => {
  it('never routes into the driver graph without a driver home, never bypasses the account gate, defers correctly', () => {
    let cases = 0;
    for (const kind of INTENT_KINDS)
      for (const account of accounts())
        for (const mode of ['RIDER', 'DRIVER'] as const)
          for (const appPolicy of ['ok', 'blocked'] as const)
            for (const signedIn of [true, false]) {
              const ctx: IntentContext = { appPolicy, mode, session: signedIn ? { status: 'signed-in', account } : { status: 'signed-out' } };
              const result = resolveIntent(SAMPLE[kind], ctx);
              const label = `${kind} ${mode} ${appPolicy} ${String(signedIn)} ${account.driver.profile?.state ?? 'none'} ${account.requiredActions.join()}`;
              cases += 1;
              if (appPolicy === 'blocked') {
                expect(result, label).toEqual({ kind: 'defer', until: 'APP_POLICY' });
                continue;
              }
              if (!signedIn) {
                expect(result, label).toEqual({ kind: 'defer', until: 'SIGN_IN' });
                continue;
              }
              if (account.requiredActions.length > 0) {
                expect(result, label).toEqual({ kind: 'defer', until: 'REQUIRED_ACTION' });
                continue;
              }
              const driverHome = driverHomeAvailable(modeAvailability(account));
              if (result.kind === 'route') {
                if (result.mode === 'DRIVER') expect(driverHome, label).toBe(true);
                expect(result.home, label).toBe(result.mode === 'DRIVER' ? '/drive' : '/ride');
                expect(result.switched, label).toBe(result.mode !== mode);
                if (result.target !== null && DRIVER_ONLY_TARGETS.includes(result.target.pathname)) expect(driverHome, label).toBe(true);
              } else {
                expect(result.kind, label).toBe('refuse');
              }
              if (!driverHome && ['OPEN_DRIVER_HOME', 'OPEN_DRIVER_COMPLIANCE', 'OPEN_DOCUMENT_RENEWAL'].includes(kind))
                expect(result, label).toEqual({ kind: 'refuse', reason: 'MODE_NOT_AVAILABLE' });
            }
    expect(cases).toBe(INTENT_KINDS.length * accounts().length * 2 * 2 * 2);
  });

  it('routes by kind for an approved driver and a rider-only account', () => {
    const driver = { status: 'signed-in' as const, account: p3Account('B') };
    const rider = { status: 'signed-in' as const, account: p3Account('A') };
    const ctx = (session: IntentContext['session'], mode: AppMode): IntentContext => ({ appPolicy: 'ok', session, mode });
    expect(resolveIntent(SAMPLE.OPEN_DOCUMENT_RENEWAL, ctx(driver, 'RIDER'))).toEqual({
      kind: 'route',
      mode: 'DRIVER',
      home: '/drive',
      target: { pathname: '/earn/renewal', params: { document: P3_IDS.document } },
      switched: true,
    });
    expect(resolveIntent(SAMPLE.OPEN_QUOTE, ctx(driver, 'DRIVER'))).toEqual({
      kind: 'route',
      mode: 'RIDER',
      home: '/ride',
      target: { pathname: '/ride/quote', params: { group: P3_IDS.group } },
      switched: true,
    });
    // Onboarding opens on top of the Rider home; no mode switch without a driver profile.
    expect(resolveIntent(SAMPLE.OPEN_DRIVER_APPLICATION, ctx(rider, 'RIDER'))).toEqual({
      kind: 'route',
      mode: 'RIDER',
      home: '/ride',
      target: { pathname: '/earn' },
      switched: false,
    });
    // Account-wide targets keep the current mode.
    expect(resolveIntent(SAMPLE.OPEN_ACCOUNT_SECURITY, ctx(driver, 'DRIVER'))).toMatchObject({
      mode: 'DRIVER',
      target: { pathname: '/account' },
      switched: false,
    });
    expect(resolveIntent({ kind: 'OPEN_LEGAL', policyKey: 'TERMS', version: '2' }, ctx(rider, 'RIDER'))).toMatchObject({
      target: { pathname: '/legal/TERMS/2' },
    });
    expect(resolveIntent(SAMPLE.OPEN_RESTRICTION_APPEAL, ctx(rider, 'DRIVER'))).toMatchObject({
      mode: 'RIDER',
      target: { pathname: '/account/appeal', params: { restriction: P3_IDS.restriction } },
    });
  });

  it('refuses quotes for an account-wide restricted account and driver intents for accounts without a driver area', () => {
    const ctx = (account: AccountState): IntentContext => ({ appPolicy: 'ok', mode: 'RIDER', session: { status: 'signed-in', account } });
    expect(resolveIntent(SAMPLE.OPEN_QUOTE, ctx(p3Account('E')))).toEqual({ kind: 'refuse', reason: 'ACCOUNT_RESTRICTED' });
    expect(resolveIntent(SAMPLE.OPEN_DRIVER_APPLICATION, ctx(p3Account('N')))).toEqual({ kind: 'refuse', reason: 'MODE_NOT_AVAILABLE' });
  });

  it('payloads are validated strictly: unknown kinds, extra keys, non-uuid ids, routes or roles are refused', () => {
    const ctx: IntentContext = { appPolicy: 'ok', mode: 'RIDER', session: { status: 'signed-in', account: p3Account('B') } };
    expect(resolveIntent({ kind: 'OPEN_ADMIN' }, ctx)).toEqual({ kind: 'refuse', reason: 'INTENT_UNKNOWN' });
    expect(resolveIntent(null, ctx)).toEqual({ kind: 'refuse', reason: 'INTENT_UNKNOWN' });
    expect(resolveIntent('OPEN_RIDER_HOME', ctx)).toEqual({ kind: 'refuse', reason: 'INTENT_UNKNOWN' });
    for (const bad of [
      { kind: 'OPEN_QUOTE', quoteGroupId: 'not-a-uuid' },
      { kind: 'OPEN_QUOTE' },
      { kind: 'OPEN_RIDER_HOME', route: '/drive' },
      { kind: 'OPEN_DRIVER_HOME', mode: 'DRIVER' },
      { kind: 'OPEN_DOCUMENT_RENEWAL', documentId: P3_IDS.document, role: 'ADMIN' },
      { kind: 'OPEN_LEGAL', policyKey: 'TERMS' },
      { kind: 'OPEN_LEGAL', policyKey: 'NOT_A_POLICY', version: '1' },
      { kind: 'OPEN_LEGAL', version: '0' },
    ])
      expect(resolveIntent(bad, ctx), JSON.stringify(bad)).toEqual({ kind: 'refuse', reason: 'INTENT_MALFORMED' });
  });

  it('navigation lands on the mode home first (unless already there), then pushes the target', () => {
    const route = { kind: 'route' as const, mode: 'DRIVER' as const, home: '/drive' as const, target: { pathname: '/earn/compliance' }, switched: true };
    expect(navigationSteps(route, '/ride')).toEqual([
      { op: 'replace', href: '/drive' },
      { op: 'push', target: { pathname: '/earn/compliance' } },
    ]);
    expect(navigationSteps(route, '/drive')).toEqual([{ op: 'push', target: { pathname: '/earn/compliance' } }]);
    expect(navigationSteps({ ...route, target: null }, null)).toEqual([{ op: 'replace', href: '/drive' }]);
  });
});
