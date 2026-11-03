import { describe, expect, it } from 'vitest';
import { ACCOUNT_KINDS, p3Account } from '../../__mocks__/p3-fixtures';
import { deriveModes, driverHomeAvailable, homeOf, modeAvailability } from './availability';

describe('mode availability (server `modes`, else the fallback derivation)', () => {
  it('uses the server-sent `modes` when present (it never re-derives over server truth)', () => {
    const state = {
      ...p3Account('A'),
      modes: { rider: { available: false, blockers: ['ACCOUNT_RESTRICTED' as const] }, driver: { entry: 'HUB' as const, available: true, blockers: [] } },
    };
    expect(modeAvailability(state)).toBe(state.modes);
  });

  it('derives entry NONE / ONBOARDING / HUB from the driver section', () => {
    expect(deriveModes(p3Account('N')).driver).toEqual({ entry: 'NONE', available: false, blockers: ['ONBOARDING_UNAVAILABLE'] });
    expect(deriveModes(p3Account('A')).driver).toEqual({ entry: 'ONBOARDING', available: true, blockers: [] });
    expect(deriveModes(p3Account('F')).driver).toEqual({ entry: 'ONBOARDING', available: true, blockers: ['APPLICATION_PENDING'] });
    expect(deriveModes(p3Account('B')).driver).toEqual({ entry: 'HUB', available: true, blockers: [] });
    // An application without onboarding being available still has an entry (the existing status view).
    const closed = p3Account('F');
    expect(deriveModes({ ...closed, driver: { ...closed.driver, onboardingAvailable: false } }).driver.entry).toBe('ONBOARDING');
  });

  it('explains (never authorises) with blockers: role restriction, expired profile, account restriction, deletion', () => {
    expect(deriveModes(p3Account('D')).driver.blockers).toEqual(['ROLE_RESTRICTED']);
    expect(deriveModes(p3Account('D')).rider).toEqual({ available: true, blockers: [] });
    expect(deriveModes(p3Account('G')).driver.blockers).toEqual(['DOCUMENTS_EXPIRED']);
    expect(deriveModes(p3Account('E')).rider).toEqual({ available: false, blockers: ['ACCOUNT_RESTRICTED'] });
    expect(deriveModes(p3Account('E')).driver.blockers).toEqual(['ACCOUNT_RESTRICTED']);
    expect(deriveModes(p3Account('H')).rider).toEqual({ available: false, blockers: ['DELETION_PENDING'] });
    const rejected = p3Account('F');
    expect(
      deriveModes({ ...rejected, driver: { ...rejected.driver, application: { id: rejected.driver.application?.id ?? '', state: 'REJECTED' } } }).driver
        .blockers,
    ).toEqual(['APPLICATION_REJECTED']);
    const reverify = p3Account('B');
    expect(
      deriveModes({ ...reverify, driver: { ...reverify.driver, profile: { id: reverify.driver.profile?.id ?? '', state: 'REVERIFY_DUE' } } }).driver.blockers,
    ).toEqual(['PROFILE_REVERIFICATION_DUE']);
  });

  it('a driver HOME exists only with a driver profile (entry HUB) the server lets the app show', () => {
    const homes = Object.fromEntries(ACCOUNT_KINDS.map((k) => [k, driverHomeAvailable(modeAvailability(p3Account(k)))]));
    expect(homes).toEqual({ A: false, B: true, D: true, E: true, F: false, G: true, H: false, I: true, N: false });
    expect(homeOf('RIDER')).toBe('/ride');
    expect(homeOf('DRIVER')).toBe('/drive');
  });
});
