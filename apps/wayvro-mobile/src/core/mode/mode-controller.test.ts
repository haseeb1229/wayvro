import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../__mocks__/memory-store';
import { ACCOUNT_ID, ACCOUNT_KINDS, P3_IDS, p3Account } from '../../__mocks__/p3-fixtures';
import { STORAGE_KEYS } from '../session/key-value-store';
import { modeAvailability } from './availability';
import { driveGuard, ModeController, planSwitch } from './mode-controller';

describe('mode switch plan (UX doc §4.3/§4.4) — decided on fresh server state, never granting', () => {
  it('Rider → Driver: HUB ⇒ replace /drive (+ persist), onboarding ⇒ push /earn (preference stays), none ⇒ stay with a notice', () => {
    const plans = Object.fromEntries(ACCOUNT_KINDS.map((k) => [k, planSwitch('DRIVER', modeAvailability(p3Account(k)))]));
    expect(plans['A']).toEqual({ kind: 'push', href: '/earn' });
    expect(plans['F']).toEqual({ kind: 'push', href: '/earn' });
    expect(plans['H']).toEqual({ kind: 'push', href: '/earn' });
    for (const k of ['B', 'D', 'E', 'G', 'I'] as const) expect(plans[k]).toEqual({ kind: 'replace', href: '/drive', persist: 'DRIVER' });
    expect(plans['N']).toEqual({ kind: 'stay', notice: 'DRIVER_AREA_UNAVAILABLE' });
  });

  it('Driver → Rider is allowed unless the server says Rider mode is unavailable', () => {
    expect(planSwitch('RIDER', modeAvailability(p3Account('B')))).toEqual({ kind: 'replace', href: '/ride', persist: 'RIDER' });
    expect(planSwitch('RIDER', modeAvailability(p3Account('D')))).toEqual({ kind: 'replace', href: '/ride', persist: 'RIDER' });
    expect(planSwitch('RIDER', modeAvailability(p3Account('E')))).toEqual({ kind: 'stay', notice: 'RIDER_UNAVAILABLE' });
  });

  it('a server `modes` without a driver home refuses even if the local derivation would allow it', () => {
    const state = {
      ...p3Account('B'),
      modes: { rider: { available: true, blockers: [] }, driver: { entry: 'HUB' as const, available: false, blockers: ['ROLE_RESTRICTED' as const] } },
    };
    expect(planSwitch('DRIVER', modeAvailability(state))).toEqual({ kind: 'stay', notice: 'DRIVER_AREA_UNAVAILABLE' });
    expect(driveGuard(modeAvailability(state))).toEqual({ allowed: false, notice: 'DRIVER_AREA_UNAVAILABLE' });
  });

  it('the /drive guard allows exactly the accounts with a driver home', () => {
    const allowed = ACCOUNT_KINDS.filter((k) => driveGuard(modeAvailability(p3Account(k))).allowed);
    expect(allowed).toEqual(['B', 'D', 'E', 'G', 'I']);
  });
});

describe('ModeController (preference hint, last quote record, notices)', () => {
  it('persists the preference bound to the account id and restores it on the next start', async () => {
    const store = new MemoryStore();
    const modes = new ModeController(store, () => 42);
    await modes.load();
    expect(modes.getState()).toMatchObject({ loaded: true, preference: null, lastQuote: null });
    await modes.setPreference(ACCOUNT_ID, 'DRIVER');
    const restarted = new ModeController(store);
    await restarted.load();
    expect(restarted.getState().preference).toEqual({ v: 1, accountId: ACCOUNT_ID, mode: 'DRIVER', savedAt: 42 });
  });

  it('stores only the quote-group id and server expiry — no coordinates, prices or addresses', async () => {
    const store = new MemoryStore();
    const modes = new ModeController(store, () => 7);
    await modes.rememberQuote(P3_IDS.group, '2026-10-13T10:05:00.000Z');
    expect(JSON.parse(store.data.get(STORAGE_KEYS.lastQuoteGroup) ?? 'null')).toEqual({
      v: 1,
      quoteGroupId: P3_IDS.group,
      expiresAt: '2026-10-13T10:05:00.000Z',
      savedAt: 7,
    });
    await modes.forgetQuote();
    expect(store.data.has(STORAGE_KEYS.lastQuoteGroup)).toBe(false);
    expect(modes.getState().lastQuote).toBeNull();
  });

  it('sign-out wipe removes the preference and the last quote record (memory first, then storage)', async () => {
    const store = new MemoryStore();
    const modes = new ModeController(store);
    await modes.setPreference(ACCOUNT_ID, 'DRIVER');
    await modes.rememberQuote(P3_IDS.group, '2026-10-13T10:05:00.000Z');
    modes.setNotice('OPENED_DRIVER_AREA');
    await modes.wipe();
    expect(modes.getState()).toMatchObject({ preference: null, lastQuote: null, notice: null });
    expect(store.data.has(STORAGE_KEYS.modePreference)).toBe(false);
    expect(store.data.has(STORAGE_KEYS.lastQuoteGroup)).toBe(false);
  });

  it('corrupt or foreign-shaped records are ignored (fail closed to Rider home, no restore)', async () => {
    const store = new MemoryStore();
    store.data.set(STORAGE_KEYS.modePreference, JSON.stringify({ v: 1, accountId: 'not-a-uuid', mode: 'DRIVER', savedAt: 1 }));
    store.data.set(STORAGE_KEYS.lastQuoteGroup, '{broken');
    const modes = new ModeController(store);
    await modes.load();
    expect(modes.getState()).toMatchObject({ preference: null, lastQuote: null });
  });

  it('notifies subscribers on every change', async () => {
    const modes = new ModeController(new MemoryStore());
    let calls = 0;
    const unsubscribe = modes.subscribe(() => {
      calls += 1;
    });
    modes.setNotice('LINK_UNAVAILABLE');
    await modes.setPreference(ACCOUNT_ID, 'RIDER');
    unsubscribe();
    modes.setNotice(null);
    expect(calls).toBe(2);
  });
});
