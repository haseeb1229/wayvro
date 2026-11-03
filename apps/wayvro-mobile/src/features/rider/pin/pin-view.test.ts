import { describe, expect, it } from 'vitest';
import { INITIAL_LOCATION_STATE, type LocationPhase, type LocationState } from '../../../platform/location/machine';
import { startCurrentLocation } from '../location/start-location';
import { pinView, type ReverseState } from './pin-view';

const at = (phase: LocationPhase, accuracy: LocationState['accuracy'] = null, patch: Partial<LocationState> = {}): LocationState => ({
  ...INITIAL_LOCATION_STATE,
  phase,
  accuracy,
  ...patch,
});
const source = {
  providerKey: 'geo-a',
  fetchedAt: '2026-10-13T10:00:00.000Z',
  cacheStatus: 'MISS' as const,
  confidence: 'HIGH' as const,
  attributionCode: null,
  coverageNote: null,
};
const done = (address: { primaryText: string; secondaryText: string | null; landmarkText: string | null } | null, inServiceArea = true): ReverseState => ({
  kind: 'done',
  result: { address, inServiceArea, source },
});

describe('text-first pin view (B01 until P3.7)', () => {
  it('a precise fix is offered as "Is this your pickup?" — landmark first, "Pinned location" when no address', () => {
    const fixed = at('FIX_OK', 'precise');
    expect(pinView(fixed, { kind: 'loading' })).toEqual({ kind: 'resolving' });
    expect(pinView(fixed, done({ primaryText: '12 Synthetic Road', secondaryText: 'Synthetic Area', landmarkText: 'Synthetic Park' }))).toEqual({
      kind: 'confirm',
      primary: 'Synthetic Park',
      secondary: '12 Synthetic Road',
      outsideArea: false,
      addressUnavailable: false,
    });
    expect(pinView(fixed, done({ primaryText: '12 Synthetic Road', secondaryText: 'Synthetic Area', landmarkText: null }))).toMatchObject({
      primary: '12 Synthetic Road',
      secondary: 'Synthetic Area',
    });
    expect(pinView(fixed, done(null, false))).toEqual({ kind: 'confirm', primary: null, secondary: null, outsideArea: true, addressUnavailable: false });
    expect(pinView(fixed, { kind: 'failed' })).toEqual({ kind: 'confirm', primary: null, secondary: null, outsideArea: false, addressUnavailable: true });
  });

  it('an approximate grant is never offered as a pickup', () => {
    for (const phase of ['GRANTED_APPROXIMATE', 'FIX_OK'] as const) expect(pinView(at(phase, 'approximate'), done(null)).kind).toBe('approximate');
    expect(
      pinView(at('FIX_OK', 'approximate', { lastSnapshot: { status: 'granted', canAskAgain: false, accuracy: 'approximate', servicesEnabled: true } }), {
        kind: 'idle',
      }),
    ).toEqual({
      kind: 'approximate',
      canAskPrecise: false,
    });
  });

  it('every other state has its own view (start, waiting, locating, fix-failed with one retry, blocked, services off)', () => {
    expect(pinView(at('NOT_DETERMINED'), { kind: 'idle' }).kind).toBe('start');
    expect(pinView(at('GRANTED_PRECISE', 'precise'), { kind: 'idle' }).kind).toBe('start');
    expect(pinView(at('REQUESTING'), { kind: 'idle' }).kind).toBe('waiting');
    expect(pinView(at('FIXING', 'precise'), { kind: 'idle' }).kind).toBe('locating');
    expect(pinView(at('FIX_TIMEOUT', 'precise', { fixAttempts: 1 }), { kind: 'idle' })).toEqual({ kind: 'fix-failed', canRetry: true });
    expect(pinView(at('FIX_UNAVAILABLE', 'precise', { fixAttempts: 2 }), { kind: 'idle' })).toEqual({ kind: 'fix-failed', canRetry: false });
    expect(pinView(at('BLOCKED'), { kind: 'idle' }).kind).toBe('blocked');
    expect(pinView(at('SERVICES_OFF'), { kind: 'idle' }).kind).toBe('services-off');
    expect(pinView(at('REVOKED'), { kind: 'idle' }).kind).toBe('start');
  });

  it('"Use current location" opens the rationale first when the OS has not been asked, otherwise the pin screen', () => {
    const events: string[] = [];
    const dispatch = (e: { type: string }) => events.push(e.type);
    expect(startCurrentLocation(at('NOT_DETERMINED'), dispatch)).toBe('/ride/location');
    expect(startCurrentLocation(at('GRANTED_PRECISE', 'precise'), dispatch)).toBe('/ride/pin');
    expect(startCurrentLocation(at('BLOCKED'), dispatch)).toBe('/ride/pin');
    expect(events).toEqual(['TAP_USE_CURRENT', 'TAP_USE_CURRENT', 'TAP_USE_CURRENT']);
  });
});
