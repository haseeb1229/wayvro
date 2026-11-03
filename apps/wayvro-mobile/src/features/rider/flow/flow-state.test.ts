import { describe, expect, it } from 'vitest';
import type { PermissionSnapshot } from '../../../platform/location/machine';
import { addRecent, draftReducer, EMPTY_DRAFT, MAX_RECENTS, quoteInput, quotePoint, type DraftPlace } from './draft';
import { flowReducer, INITIAL_FLOW, type FlowState } from './flow-state';

const place = (patch: Partial<DraftPlace> = {}): DraftPlace => ({
  primary: 'Synthetic Landmark',
  secondary: 'Synthetic Area',
  point: { lat: 31.52041, lng: 74.35875 },
  placeRef: null,
  source: 'search',
  inServiceArea: true,
  ...patch,
});
const snap = (status: PermissionSnapshot['status'], accuracy: PermissionSnapshot['accuracy'] = null): PermissionSnapshot => ({
  status,
  canAskAgain: true,
  accuracy,
  servicesEnabled: true,
});
const DEVICE_FIX = { lat: 31.5204123, lng: 74.3587456, accuracyM: 15, timestamp: 1 };

describe('rider draft (memory only)', () => {
  it('sets/clears ends; a quote needs both; placeRef travels only for search places', () => {
    const one = draftReducer(EMPTY_DRAFT, { type: 'SET', field: 'pickup', place: place() });
    expect(quoteInput(one)).toBeNull();
    const both = draftReducer(one, { type: 'SET', field: 'dropoff', place: place({ placeRef: `pr1.${'b'.repeat(40)}` }) });
    expect(quoteInput(both)).not.toBeNull();
    expect(quotePoint(place())).toEqual({ lat: 31.52041, lng: 74.35875 });
    expect(quotePoint(place({ placeRef: `pr1.${'b'.repeat(40)}` }))).toEqual({ lat: 31.52041, lng: 74.35875, placeRef: `pr1.${'b'.repeat(40)}` });
    expect(draftReducer(both, { type: 'CLEAR', field: 'pickup' }).pickup).toBeNull();
  });

  it('recents: search places only, newest first, de-duplicated, at most 10', () => {
    let recents: readonly DraftPlace[] = [];
    for (let i = 0; i < 12; i += 1) recents = addRecent(recents, place({ primary: `P${String(i)}` }));
    expect(recents).toHaveLength(MAX_RECENTS);
    expect(recents[0]?.primary).toBe('P11');
    recents = addRecent(recents, place({ primary: 'P5' }));
    expect(recents.filter((p) => p.primary === 'P5')).toHaveLength(1);
    expect(addRecent([], place({ source: 'current-location' }))).toEqual([]);
  });
});

describe('rider flow reducer — privacy rules on every transition', () => {
  const granted = (accuracy: 'precise' | 'approximate'): FlowState =>
    flowReducer(INITIAL_FLOW, { type: 'LOCATION', event: { type: 'STATUS', snapshot: snap('granted', accuracy) } });

  it('a PRECISE fix is kept at 5 decimals and gives a 2-decimal search bias', () => {
    const s = flowReducer(granted('precise'), { type: 'FIX_RECEIVED', fix: DEVICE_FIX });
    expect(s.location.phase).toBe('FIX_OK');
    expect(s.fix).toMatchObject({ lat: 31.52041, lng: 74.35875 });
    expect(s.bias).toEqual({ lat: 31.52, lng: 74.36 });
  });

  it('an APPROXIMATE fix only biases search — no point the app could offer as pickup', () => {
    const s = flowReducer(granted('approximate'), { type: 'FIX_RECEIVED', fix: DEVICE_FIX });
    expect(s.fix).toBeNull();
    expect(s.bias).toEqual({ lat: 31.52, lng: 74.36 });
  });

  it('revocation discards the fix, the bias and every device-sourced place (search places stay)', () => {
    let s = flowReducer(granted('precise'), { type: 'FIX_RECEIVED', fix: DEVICE_FIX });
    s = flowReducer(s, { type: 'SET', field: 'pickup', place: place({ source: 'current-location' }) });
    s = flowReducer(s, { type: 'SET', field: 'dropoff', place: place() });
    const revoked = flowReducer(s, { type: 'LOCATION', event: { type: 'STATUS', snapshot: snap('denied') } });
    expect(revoked.location.phase).toBe('REVOKED');
    expect(revoked.fix).toBeNull();
    expect(revoked.bias).toBeNull();
    expect(revoked.draft.pickup).toBeNull();
    expect(revoked.draft.dropoff).not.toBeNull();
  });

  it('a downgrade to approximate drops the precise fix and device places but may keep the coarse bias', () => {
    let s = flowReducer(granted('precise'), { type: 'FIX_RECEIVED', fix: DEVICE_FIX });
    s = flowReducer(s, { type: 'SET', field: 'pickup', place: place({ source: 'current-location' }) });
    const down = flowReducer(s, { type: 'LOCATION', event: { type: 'STATUS', snapshot: snap('granted', 'approximate') } });
    expect(down.fix).toBeNull();
    expect(down.draft.pickup).toBeNull();
    expect(down.bias).toEqual({ lat: 31.52, lng: 74.36 });
  });

  it('a blocking app policy (RESET) discards the whole draft and fix but keeps the permission state', () => {
    let s = flowReducer(granted('precise'), { type: 'FIX_RECEIVED', fix: DEVICE_FIX });
    s = flowReducer(s, { type: 'SET', field: 'dropoff', place: place() });
    const reset = flowReducer(s, { type: 'RESET' });
    expect(reset.draft).toEqual(EMPTY_DRAFT);
    expect(reset.fix).toBeNull();
    expect(reset.location).toBe(s.location);
  });

  it('a fix arriving without a grant is ignored', () => {
    const s = flowReducer(INITIAL_FLOW, { type: 'FIX_RECEIVED', fix: DEVICE_FIX });
    expect(s.fix).toBeNull();
    expect(s.bias).toBeNull();
  });
});
