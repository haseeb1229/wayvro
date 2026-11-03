import { biasPoint, pointPrecision, type DeviceFix } from '../../../platform/location/fix-policy';
import { INITIAL_LOCATION_STATE, isGrantedPhase, locationReducer, type LocationEvent, type LocationState } from '../../../platform/location/machine';
import { draftReducer, EMPTY_DRAFT, type DraftAction, type RiderDraft } from './draft';

/**
 * One pure reducer for the rider graph's in-memory state, so the privacy rules hold in every transition:
 *  - a device fix is kept only while a PRECISE grant lasts; revocation, a downgrade to approximate or location turned
 *    off discard it together with every place that came from the device location;
 *  - a blocking app-policy state (HARD_UPDATE / MAINTENANCE) discards the whole draft.
 * Coordinates are stored at 5 decimals and never leave memory.
 */
export interface FlowState {
  readonly draft: RiderDraft;
  readonly location: LocationState;
  /** PRECISE fix at 5 decimals — the only device point that may be offered as a pickup (the rider confirms). */
  readonly fix: DeviceFix | null;
  /** Search bias at 2 decimals (≈1.1 km cell) from a precise OR approximate fix; never a pickup. */
  readonly bias: { readonly lat: number; readonly lng: number } | null;
}

export type FlowAction =
  | DraftAction
  | { readonly type: 'LOCATION'; readonly event: LocationEvent }
  /** A device fix (one-shot or pin watch) arrived. */
  | { readonly type: 'FIX_RECEIVED'; readonly fix: DeviceFix }
  | { readonly type: 'RESET' };

export const INITIAL_FLOW: FlowState = { draft: EMPTY_DRAFT, location: INITIAL_LOCATION_STATE, fix: null, bias: null };

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'SET':
    case 'CLEAR':
    case 'DROP_DEVICE_PLACES':
      return { ...state, draft: draftReducer(state.draft, action) };
    case 'LOCATION': {
      const location = locationReducer(state.location, action.event);
      if (!isGrantedPhase(location.phase)) return { location, fix: null, bias: null, draft: draftReducer(state.draft, { type: 'DROP_DEVICE_PLACES' }) };
      // Downgraded to approximate: the precise fix and device-sourced places go; the coarse bias may stay.
      if (location.accuracy !== 'precise') return { ...state, location, fix: null, draft: draftReducer(state.draft, { type: 'DROP_DEVICE_PLACES' }) };
      return { ...state, location };
    }
    case 'FIX_RECEIVED': {
      const location = locationReducer(state.location, { type: 'FIX_RESULT', result: 'ok' });
      if (location.phase !== 'FIX_OK') return { ...state, location };
      const bias = biasPoint(action.fix);
      // An approximate grant never stores a point the app could offer as pickup.
      if (location.accuracy !== 'precise') return { ...state, location, bias };
      return { ...state, location, bias, fix: { ...action.fix, ...pointPrecision(action.fix) } };
    }
    case 'RESET':
      return { ...INITIAL_FLOW, location: state.location };
  }
}
