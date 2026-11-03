import { describe, expect, it } from 'vitest';
import {
  canRetryFix,
  fixUsableAsPickup,
  INITIAL_LOCATION_STATE,
  isGrantedPhase,
  locationReducer,
  phaseOf,
  snapshotFromPermission,
  type LocationEvent,
  type LocationPhase,
  type LocationState,
  type PermissionSnapshot,
} from './machine';

const snap = (status: PermissionSnapshot['status'], patch: Partial<PermissionSnapshot> = {}): PermissionSnapshot => ({
  status,
  canAskAgain: true,
  accuracy: status === 'granted' ? 'precise' : null,
  servicesEnabled: true,
  ...patch,
});
const PRECISE = snap('granted');
const APPROX = snap('granted', { accuracy: 'approximate' });
const UNDETERMINED = snap('undetermined');
const DENIED = snap('denied');
const BLOCKED = snap('denied', { canAskAgain: false });
const OFF = snap('granted', { servicesEnabled: false });

const run = (events: readonly LocationEvent[], from: LocationState = INITIAL_LOCATION_STATE): LocationState => events.reduce(locationReducer, from);
const at = (phase: LocationPhase, patch: Partial<LocationState> = {}): LocationState => ({ ...INITIAL_LOCATION_STATE, phase, ...patch });

describe('UNIT-LOCPERM status mapping (no prompt)', () => {
  it('maps the expo-location response: coarse/reduced ⇒ approximate; undetermined; denied; blocked', () => {
    expect(snapshotFromPermission({ status: 'granted', canAskAgain: true, android: { accuracy: 'fine' } }, true)).toEqual(PRECISE);
    expect(snapshotFromPermission({ status: 'granted', canAskAgain: true, android: { accuracy: 'coarse' } }, true)).toEqual(APPROX);
    expect(snapshotFromPermission({ status: 'granted', canAskAgain: true, ios: { accuracy: 'reduced' } }, true)).toEqual(APPROX);
    expect(snapshotFromPermission({ status: 'undetermined', canAskAgain: true }, true)).toEqual(UNDETERMINED);
    expect(snapshotFromPermission({ status: 'denied', canAskAgain: false }, true)).toEqual(BLOCKED);
    expect(snapshotFromPermission({ status: 'something-new', canAskAgain: true }, false)).toEqual({ ...DENIED, servicesEnabled: false });
  });

  it('resting phases: services off wins; then granted precise/approximate, not determined, denied, blocked', () => {
    expect(phaseOf(PRECISE)).toBe('GRANTED_PRECISE');
    expect(phaseOf(APPROX)).toBe('GRANTED_APPROXIMATE');
    expect(phaseOf(UNDETERMINED)).toBe('NOT_DETERMINED');
    expect(phaseOf(DENIED)).toBe('DENIED_CAN_ASK');
    expect(phaseOf(BLOCKED)).toBe('BLOCKED');
    expect(phaseOf(OFF)).toBe('SERVICES_OFF');
    expect(phaseOf(snap('undetermined', { canAskAgain: false }))).toBe('BLOCKED');
  });

  it('UNKNOWN → status read on mount reaches every resting state without any prompt', () => {
    for (const s of [PRECISE, APPROX, UNDETERMINED, DENIED, BLOCKED, OFF]) expect(run([{ type: 'STATUS', snapshot: s }]).phase).toBe(phaseOf(s));
    expect(run([{ type: 'TAP_USE_CURRENT' }]).phase).toBe('UNKNOWN');
  });
});

describe('UNIT-LOCPERM request flow (rationale first, one OS dialog, never looped)', () => {
  it('NOT_DETERMINED → tap → RATIONALE → Continue → REQUESTING → grant ⇒ FIXING (attempt 1)', () => {
    const s = run([{ type: 'STATUS', snapshot: UNDETERMINED }, { type: 'TAP_USE_CURRENT' }]);
    expect(s).toMatchObject({ phase: 'RATIONALE', returnTo: 'NOT_DETERMINED' });
    const requesting = locationReducer(s, { type: 'RATIONALE_CONTINUE' });
    expect(requesting).toMatchObject({ phase: 'REQUESTING', rationaleShown: true });
    expect(locationReducer(requesting, { type: 'REQUEST_RESULT', snapshot: PRECISE })).toMatchObject({ phase: 'FIXING', accuracy: 'precise', fixAttempts: 1 });
    expect(locationReducer(requesting, { type: 'REQUEST_RESULT', snapshot: APPROX })).toMatchObject({ phase: 'FIXING', accuracy: 'approximate' });
    expect(locationReducer(requesting, { type: 'REQUEST_RESULT', snapshot: DENIED }).phase).toBe('DENIED_CAN_ASK');
    expect(locationReducer(requesting, { type: 'REQUEST_RESULT', snapshot: BLOCKED }).phase).toBe('BLOCKED');
  });

  it('RATIONALE → Not now returns to the previous state without any OS dialog', () => {
    const s = run([{ type: 'STATUS', snapshot: UNDETERMINED }, { type: 'TAP_USE_CURRENT' }, { type: 'RATIONALE_NOT_NOW' }]);
    expect(s).toMatchObject({ phase: 'NOT_DETERMINED', rationaleShown: true });
    // A never-asked user sees the rationale again on the next tap.
    expect(locationReducer(s, { type: 'TAP_USE_CURRENT' }).phase).toBe('RATIONALE');
  });

  it('DENIED_CAN_ASK shows the rationale again at most once per session, then asks directly', () => {
    const denied = run([{ type: 'STATUS', snapshot: DENIED }]);
    const first = locationReducer(denied, { type: 'TAP_USE_CURRENT' });
    expect(first.phase).toBe('RATIONALE');
    const second = run([{ type: 'RATIONALE_CONTINUE' }, { type: 'REQUEST_RESULT', snapshot: DENIED }, { type: 'TAP_USE_CURRENT' }], first);
    expect(second.phase).toBe('REQUESTING');
  });

  it('BLOCKED and SERVICES_OFF never open the OS dialog (Settings link instead)', () => {
    expect(run([{ type: 'STATUS', snapshot: BLOCKED }, { type: 'TAP_USE_CURRENT' }]).phase).toBe('BLOCKED');
    expect(run([{ type: 'STATUS', snapshot: OFF }, { type: 'TAP_USE_CURRENT' }]).phase).toBe('SERVICES_OFF');
    expect(run([{ type: 'STATUS', snapshot: OFF }, { type: 'TAP_USE_PRECISE' }]).phase).toBe('SERVICES_OFF');
  });

  it('a foreground re-check while the OS dialog is up does not cancel the request', () => {
    const requesting = at('REQUESTING');
    expect(locationReducer(requesting, { type: 'STATUS', snapshot: UNDETERMINED }).phase).toBe('REQUESTING');
    expect(locationReducer(at('RATIONALE'), { type: 'STATUS', snapshot: UNDETERMINED }).phase).toBe('RATIONALE');
  });

  it('ignores events that do not belong to the current state', () => {
    for (const phase of ['UNKNOWN', 'NOT_DETERMINED', 'GRANTED_PRECISE', 'BLOCKED'] as const) {
      expect(locationReducer(at(phase), { type: 'RATIONALE_CONTINUE' }).phase).toBe(phase);
      expect(locationReducer(at(phase), { type: 'REQUEST_RESULT', snapshot: PRECISE }).phase).toBe(phase);
      expect(locationReducer(at(phase), { type: 'RETRY_FIX' }).phase).toBe(phase);
    }
    expect(locationReducer(at('NOT_DETERMINED'), { type: 'FIX_RESULT', result: 'timeout' }).phase).toBe('NOT_DETERMINED');
  });
});

describe('UNIT-LOCPERM fixes, approximate handling, revocation', () => {
  it('one attempt per tap plus exactly one manual retry', () => {
    const granted = run([{ type: 'STATUS', snapshot: PRECISE }]);
    const fixing = locationReducer(granted, { type: 'TAP_USE_CURRENT' });
    expect(fixing).toMatchObject({ phase: 'FIXING', fixAttempts: 1 });
    const timeout = locationReducer(fixing, { type: 'FIX_RESULT', result: 'timeout' });
    expect(timeout.phase).toBe('FIX_TIMEOUT');
    expect(canRetryFix(timeout)).toBe(true);
    const retry = locationReducer(timeout, { type: 'RETRY_FIX' });
    expect(retry).toMatchObject({ phase: 'FIXING', fixAttempts: 2 });
    const unavailable = locationReducer(retry, { type: 'FIX_RESULT', result: 'unavailable' });
    expect(unavailable.phase).toBe('FIX_UNAVAILABLE');
    expect(canRetryFix(unavailable)).toBe(false);
    expect(locationReducer(unavailable, { type: 'RETRY_FIX' }).phase).toBe('FIX_UNAVAILABLE');
    // A NEW tap starts a new attempt cycle.
    expect(locationReducer(unavailable, { type: 'TAP_USE_CURRENT' })).toMatchObject({ phase: 'FIXING', fixAttempts: 1 });
  });

  it('only a PRECISE fix may be offered as pickup; an approximate one never', () => {
    const precise = run([{ type: 'STATUS', snapshot: PRECISE }, { type: 'TAP_USE_CURRENT' }, { type: 'FIX_RESULT', result: 'ok' }]);
    expect(precise.phase).toBe('FIX_OK');
    expect(fixUsableAsPickup(precise)).toBe(true);
    const approx = run([{ type: 'STATUS', snapshot: APPROX }, { type: 'TAP_USE_CURRENT' }, { type: 'FIX_RESULT', result: 'ok' }]);
    expect(approx).toMatchObject({ phase: 'FIX_OK', accuracy: 'approximate' });
    expect(fixUsableAsPickup(approx)).toBe(false);
  });

  it('GRANTED_APPROXIMATE → "Use precise location" re-requests (no rationale loop)', () => {
    const approx = run([{ type: 'STATUS', snapshot: APPROX }]);
    expect(locationReducer(approx, { type: 'TAP_USE_PRECISE' }).phase).toBe('REQUESTING');
    expect(locationReducer(run([{ type: 'STATUS', snapshot: PRECISE }]), { type: 'TAP_USE_PRECISE' }).phase).toBe('GRANTED_PRECISE');
  });

  it('a pin-screen watch update delivers a fix while a grant is resting', () => {
    expect(locationReducer(run([{ type: 'STATUS', snapshot: PRECISE }]), { type: 'FIX_RESULT', result: 'ok' }).phase).toBe('FIX_OK');
  });

  it('revocation found on foreground ⇒ REVOKED (silent fallback), then the next tap follows canAskAgain', () => {
    for (const phase of ['GRANTED_PRECISE', 'FIXING', 'FIX_OK', 'FIX_TIMEOUT'] as const) {
      const revoked = locationReducer(at(phase, { accuracy: 'precise' }), { type: 'STATUS', snapshot: DENIED });
      expect(revoked).toMatchObject({ phase: 'REVOKED', accuracy: null, fixAttempts: 0 });
      expect(isGrantedPhase(revoked.phase)).toBe(false);
      expect(locationReducer(revoked, { type: 'TAP_USE_CURRENT' }).phase).toBe('RATIONALE');
    }
    const revokedBlocked = locationReducer(at('FIX_OK', { accuracy: 'precise' }), { type: 'STATUS', snapshot: BLOCKED });
    expect(locationReducer(revokedBlocked, { type: 'TAP_USE_CURRENT' }).phase).toBe('BLOCKED');
    const shownBefore = locationReducer(at('FIX_OK', { accuracy: 'precise', rationaleShown: true }), { type: 'STATUS', snapshot: DENIED });
    expect(locationReducer(shownBefore, { type: 'TAP_USE_CURRENT' }).phase).toBe('REQUESTING');
  });

  it('precise → approximate downgrade in Settings ⇒ GRANTED_APPROXIMATE (earlier fix discarded by the flow)', () => {
    const fixed = run([{ type: 'STATUS', snapshot: PRECISE }, { type: 'TAP_USE_CURRENT' }, { type: 'FIX_RESULT', result: 'ok' }]);
    expect(locationReducer(fixed, { type: 'STATUS', snapshot: APPROX })).toMatchObject({ phase: 'GRANTED_APPROXIMATE', accuracy: 'approximate' });
    expect(locationReducer(fixed, { type: 'STATUS', snapshot: PRECISE }).phase).toBe('FIX_OK');
  });

  it('device location turned off ⇒ SERVICES_OFF from any state; turned on again ⇒ re-read', () => {
    for (const phase of ['GRANTED_PRECISE', 'FIX_OK', 'NOT_DETERMINED', 'DENIED_CAN_ASK'] as const)
      expect(locationReducer(at(phase, { accuracy: 'precise' }), { type: 'STATUS', snapshot: OFF }).phase).toBe('SERVICES_OFF');
    expect(locationReducer(at('SERVICES_OFF'), { type: 'STATUS', snapshot: PRECISE }).phase).toBe('GRANTED_PRECISE');
  });
});
