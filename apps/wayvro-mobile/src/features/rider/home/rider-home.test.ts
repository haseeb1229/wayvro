import { describe, expect, it } from 'vitest';
import { p3Account, P3_IDS } from '../../../__mocks__/p3-fixtures';
import type { LocationPhase } from '../../../platform/location/machine';
import type { DraftPlace } from '../flow/draft';
import { applicationChip, riderHomeModel, type RiderHomeInput } from './rider-home';

const input = (patch: Partial<RiderHomeInput> = {}): RiderHomeInput => ({
  account: p3Account('A'),
  quotesSwitchedOff: false,
  geoDegraded: false,
  pickup: null,
  locationPhase: 'NOT_DETERMINED',
  ...patch,
});

describe('rider home model (V08; booking stays off)', () => {
  it('Where to is enabled for an ordinary rider; disabled with a reason for restriction, deletion or the quotes switch', () => {
    expect(riderHomeModel(input()).whereTo).toEqual({ enabled: true });
    expect(riderHomeModel(input({ account: p3Account('E') })).whereTo).toEqual({
      enabled: false,
      reasonKey: 'rider.home.disabledRestricted',
      action: { kind: 'appeal', restrictionId: P3_IDS.accountRestriction },
    });
    expect(riderHomeModel(input({ account: p3Account('H') })).whereTo).toEqual({
      enabled: false,
      reasonKey: 'rider.home.disabledDeletion',
      action: { kind: 'cancel-deletion' },
    });
    expect(riderHomeModel(input({ quotesSwitchedOff: true })).whereTo).toEqual({
      enabled: false,
      reasonKey: 'rider.home.disabledSwitch',
      action: { kind: 'none' },
    });
    // A Driver/Partner-only restriction never affects rider use (V13).
    expect(riderHomeModel(input({ account: p3Account('D') })).whereTo).toEqual({ enabled: true });
  });

  it('pickup line and location offers follow the location state without nagging', () => {
    const place: DraftPlace = {
      primary: 'Synthetic Landmark',
      secondary: null,
      point: { lat: 31.5, lng: 74.3 },
      placeRef: null,
      source: 'search',
      inServiceArea: true,
    };
    expect(riderHomeModel(input({ pickup: place })).pickup).toEqual({ kind: 'place', place });
    const cases: [LocationPhase, string, boolean, string | null][] = [
      ['UNKNOWN', 'set', false, null],
      ['NOT_DETERMINED', 'set', true, null],
      ['GRANTED_PRECISE', 'set', true, null],
      ['GRANTED_APPROXIMATE', 'set', true, null],
      ['DENIED_CAN_ASK', 'search-or-pin', true, null],
      ['REVOKED', 'search-or-pin', true, null],
      ['BLOCKED', 'search-or-pin', false, 'rider.location.blocked'],
      ['SERVICES_OFF', 'search-or-pin', false, 'rider.location.servicesOff'],
    ];
    for (const [phase, pickup, offer, hint] of cases) {
      const model = riderHomeModel(input({ locationPhase: phase }));
      expect([model.pickup.kind, model.offerCurrentLocation, model.locationHintKey], phase).toEqual([pickup, offer, hint]);
    }
  });

  it('shows the Rider | Driver/Partner switch only when a driver entry exists', () => {
    expect(riderHomeModel(input({ account: p3Account('N') })).showModeSwitch).toBe(false);
    for (const kind of ['A', 'B', 'F', 'G'] as const) expect(riderHomeModel(input({ account: p3Account(kind) })).showModeSwitch, kind).toBe(true);
  });

  it('application status chips; restriction notices only for rider-affecting restrictions; degraded geo banner', () => {
    expect(applicationChip(p3Account('F').driver)).toBe('rider.chip.inReview');
    const needsInfo = p3Account('F');
    expect(applicationChip({ ...needsInfo.driver, application: { id: P3_IDS.application, state: 'NEEDS_INFO' } })).toBe('rider.chip.needsInfo');
    expect(applicationChip({ ...needsInfo.driver, application: { id: P3_IDS.application, state: 'DRAFT' } })).toBe('rider.chip.unfinished');
    expect(applicationChip({ ...needsInfo.driver, application: { id: P3_IDS.application, state: 'REJECTED_FINAL' } })).toBeNull();
    expect(applicationChip(p3Account('B').driver)).toBeNull();
    expect(riderHomeModel(input({ account: p3Account('D') })).restrictions).toEqual([]);
    expect(riderHomeModel(input({ account: p3Account('E') })).restrictions).toEqual([
      { id: P3_IDS.accountRestriction, messageKey: 'restriction.class.COMPLIANCE' },
    ]);
    expect(riderHomeModel(input({ geoDegraded: true })).geoDegraded).toBe(true);
    expect(riderHomeModel(input({ account: p3Account('H') })).deletionPending).toBe(true);
  });
});
