import type { ReverseGeocodeResult } from '@wayvro/contracts';
import { canRetryFix, fixUsableAsPickup, type LocationState } from '../../../platform/location/machine';

/**
 * Text-first pin screen (B01 until the P3.7 renderer; UX doc §8.3; permission doc §4.2). A precise current-location fix
 * is reverse-geocoded and offered as "Is this your pickup?" — the rider still confirms. An approximate grant only
 * biases search: the rider is asked to choose the exact pickup and the approximate point is never offered as one.
 */
export type ReverseState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'done'; readonly result: ReverseGeocodeResult }
  /** Offline / degraded / switch off: the point stays usable as "Pinned location" without an address. */
  | { readonly kind: 'failed' };

export type PinView =
  | { readonly kind: 'start' }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'locating' }
  | { readonly kind: 'approximate'; readonly canAskPrecise: boolean }
  | { readonly kind: 'resolving' }
  | {
      readonly kind: 'confirm';
      readonly primary: string | null;
      readonly secondary: string | null;
      /** The server's information-only zone check said "not served here" (the quote re-checks). */
      readonly outsideArea: boolean;
      /** The address lookup failed: the point is offered as "Pinned location". */
      readonly addressUnavailable: boolean;
    }
  | { readonly kind: 'fix-failed'; readonly canRetry: boolean }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'services-off' };

export function pinView(location: LocationState, reverse: ReverseState): PinView {
  switch (location.phase) {
    case 'UNKNOWN':
    case 'NOT_DETERMINED':
    case 'DENIED_CAN_ASK':
    case 'REVOKED':
      return { kind: 'start' };
    case 'RATIONALE':
    case 'REQUESTING':
      return { kind: 'waiting' };
    case 'BLOCKED':
      return { kind: 'blocked' };
    case 'SERVICES_OFF':
      return { kind: 'services-off' };
    case 'FIXING':
      return { kind: 'locating' };
    case 'FIX_TIMEOUT':
    case 'FIX_UNAVAILABLE':
      return { kind: 'fix-failed', canRetry: canRetryFix(location) };
    case 'GRANTED_PRECISE':
    case 'GRANTED_APPROXIMATE':
    case 'FIX_OK': {
      if (location.accuracy === 'approximate') return { kind: 'approximate', canAskPrecise: location.lastSnapshot?.canAskAgain ?? true };
      if (!fixUsableAsPickup(location)) return { kind: 'start' };
      switch (reverse.kind) {
        case 'idle':
        case 'loading':
          return { kind: 'resolving' };
        case 'failed':
          return { kind: 'confirm', primary: null, secondary: null, outsideArea: false, addressUnavailable: true };
        case 'done': {
          const address = reverse.result.address;
          return {
            kind: 'confirm',
            primary: address === null ? null : (address.landmarkText ?? address.primaryText),
            secondary: address === null ? null : address.landmarkText === null ? address.secondaryText : address.primaryText,
            outsideArea: !reverse.result.inServiceArea,
            addressUnavailable: false,
          };
        }
      }
    }
  }
}
