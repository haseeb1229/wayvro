import type { AccountState } from '@wayvro/contracts';
import type { StringKey } from '../../../core/i18n/strings';
import { modeAvailability } from '../../../core/mode/availability';
import type { LocationPhase } from '../../../platform/location/machine';
import type { DraftPlace } from '../flow/draft';

/**
 * Rider home view model (V08/B01/B02; UX doc §8.1). Built only from the server's account state, the presentation
 * switches of GET /v1/app/config, the in-memory draft and the location state. It decides what to SHOW; the server
 * refuses quotes/geo for a restricted account itself. There is no "request ride" action in Phase 3 (booking is off).
 */
type Restriction = AccountState['restrictions'][number];

type WhereTo =
  | { readonly enabled: true }
  | {
      readonly enabled: false;
      readonly reasonKey: StringKey;
      readonly action: { readonly kind: 'appeal'; readonly restrictionId: string } | { readonly kind: 'cancel-deletion' } | { readonly kind: 'none' };
    };

type PickupLine =
  | { readonly kind: 'place'; readonly place: DraftPlace }
  /** Location denied/blocked/off: search and the pin row still work; no nagging re-prompt. */
  | { readonly kind: 'search-or-pin' }
  | { readonly kind: 'set' };

export interface RiderHomeModel {
  readonly name: string | null;
  readonly whereTo: WhereTo;
  readonly pickup: PickupLine;
  /** "Use current location" is offered (never while the OS answer is BLOCKED or device location is off). */
  readonly offerCurrentLocation: boolean;
  readonly locationHintKey: Extract<StringKey, 'rider.location.blocked' | 'rider.location.servicesOff'> | null;
  readonly restrictions: readonly { readonly id: string; readonly messageKey: `restriction.class.${Restriction['reasonClass']}` & StringKey }[];
  readonly deletionPending: boolean;
  readonly chipKeys: readonly StringKey[];
  readonly showModeSwitch: boolean;
  readonly geoDegraded: boolean;
}

export interface RiderHomeInput {
  readonly account: AccountState;
  /** `rider.quotes` switch in its safe (DISABLED) state — display only; the server enforces it. */
  readonly quotesSwitchedOff: boolean;
  /** Autocomplete/geocode switches DISABLED: "address search is limited right now". */
  readonly geoDegraded: boolean;
  readonly pickup: DraftPlace | null;
  readonly locationPhase: LocationPhase;
}

const IN_REVIEW: ReadonlySet<string> = new Set(['SUBMITTED', 'AUTO_CHECK_PENDING', 'MANUAL_REVIEW', 'APPEALED']);
const UNFINISHED: ReadonlySet<string> = new Set(['DRAFT', 'CONSENTED', 'DOCUMENTS_PENDING']);

/** Driver/Partner application status as a small chip on the rider home (presentation hint only). @internal exported for tests */
export function applicationChip(driver: AccountState['driver']): StringKey | null {
  if (driver.profile !== null || driver.application === null) return null;
  const state = driver.application.state;
  if (IN_REVIEW.has(state)) return 'rider.chip.inReview';
  if (state === 'NEEDS_INFO') return 'rider.chip.needsInfo';
  if (UNFINISHED.has(state)) return 'rider.chip.unfinished';
  return null;
}

function whereTo(input: RiderHomeInput): WhereTo {
  const riderRestriction = input.account.restrictions.find((r) => r.affectsRiderUse);
  if (riderRestriction !== undefined) {
    const appealable = input.account.restrictions.find((r) => r.affectsRiderUse && r.appealable);
    return {
      enabled: false,
      reasonKey: 'rider.home.disabledRestricted',
      action: appealable === undefined ? { kind: 'none' } : { kind: 'appeal', restrictionId: appealable.id },
    };
  }
  if (input.account.account.status === 'DELETION_PENDING')
    return { enabled: false, reasonKey: 'rider.home.disabledDeletion', action: { kind: 'cancel-deletion' } };
  if (input.quotesSwitchedOff) return { enabled: false, reasonKey: 'rider.home.disabledSwitch', action: { kind: 'none' } };
  return { enabled: true };
}

export function riderHomeModel(input: RiderHomeInput): RiderHomeModel {
  const { account, locationPhase } = input;
  const name = account.account.displayName?.trim() ?? '';
  const blocked = locationPhase === 'BLOCKED';
  const servicesOff = locationPhase === 'SERVICES_OFF';
  const denied = blocked || servicesOff || locationPhase === 'DENIED_CAN_ASK' || locationPhase === 'REVOKED';
  const chip = applicationChip(account.driver);
  return {
    name: name === '' ? null : name,
    whereTo: whereTo(input),
    pickup: input.pickup !== null ? { kind: 'place', place: input.pickup } : denied ? { kind: 'search-or-pin' } : { kind: 'set' },
    offerCurrentLocation: !blocked && !servicesOff && locationPhase !== 'UNKNOWN',
    locationHintKey: blocked ? 'rider.location.blocked' : servicesOff ? 'rider.location.servicesOff' : null,
    restrictions: account.restrictions.filter((r) => r.affectsRiderUse).map((r) => ({ id: r.id, messageKey: `restriction.class.${r.reasonClass}` as const })),
    deletionPending: account.account.status === 'DELETION_PENDING',
    chipKeys: chip === null ? [] : [chip],
    showModeSwitch: modeAvailability(account).driver.entry !== 'NONE',
    geoDegraded: input.geoDegraded,
  };
}
