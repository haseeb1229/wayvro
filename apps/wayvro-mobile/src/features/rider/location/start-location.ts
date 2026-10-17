import { locationReducer, type LocationEvent, type LocationState } from '../../../platform/location/machine';

/**
 * Where a "Use current location" tap leads (A07 just-in-time): to the in-app rationale when the OS has not been asked
 * (or was denied and the rationale was not shown again this session), otherwise straight to the text-first pin screen,
 * which shows the fix, the address lookup or the recovery state. Pure apart from the injected dispatch.
 */
export function startCurrentLocation(location: LocationState, dispatch: (event: LocationEvent) => void): '/ride/location' | '/ride/pin' {
  const next = locationReducer(location, { type: 'TAP_USE_CURRENT' });
  dispatch({ type: 'TAP_USE_CURRENT' });
  return next.phase === 'RATIONALE' ? '/ride/location' : '/ride/pin';
}
