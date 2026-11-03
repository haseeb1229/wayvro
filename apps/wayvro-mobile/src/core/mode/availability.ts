import type { AccountModes, AccountState } from '@wayvro/contracts';

/**
 * Mode availability of the ONE app (V08; ADR-048; UX doc §4.2). The server's additive `AccountState.modes` decides;
 * while it is optional (one release window) the same values are derived from the existing `driver` and `restrictions`
 * sections. Availability is PRESENTATION ONLY — which mode home may be shown. It never authorises anything: every
 * driver endpoint is re-authorised server-side, and quotes/geo refuse a restricted account themselves.
 */
export type ModeAvailability = AccountModes;
export type AppMode = 'RIDER' | 'DRIVER';
export type ModeHome = '/ride' | '/drive';

const PENDING_APPLICATION: ReadonlySet<string> = new Set([
  'DRAFT',
  'CONSENTED',
  'DOCUMENTS_PENDING',
  'SUBMITTED',
  'AUTO_CHECK_PENDING',
  'MANUAL_REVIEW',
  'NEEDS_INFO',
  'APPEALED',
]);
const REJECTED_APPLICATION: ReadonlySet<string> = new Set(['REJECTED', 'REJECTED_FINAL']);

/** @internal exported for unit tests: the fallback when the server does not send `modes`. */
export function deriveModes(state: Pick<AccountState, 'account' | 'driver' | 'restrictions'>): ModeAvailability {
  const accountRestricted = state.restrictions.some((r) => r.scope === 'ACCOUNT' && r.affectsRiderUse);
  const deletionPending = state.account.status === 'DELETION_PENDING';
  const riderBlockers: ModeAvailability['rider']['blockers'] = [
    ...(accountRestricted ? (['ACCOUNT_RESTRICTED'] as const) : []),
    ...(deletionPending ? (['DELETION_PENDING'] as const) : []),
  ];

  const { driver } = state;
  const entry: ModeAvailability['driver']['entry'] =
    driver.profile !== null ? 'HUB' : driver.onboardingAvailable || driver.application !== null ? 'ONBOARDING' : 'NONE';
  const applicationState = driver.application?.state ?? null;
  const driverBlockers: ModeAvailability['driver']['blockers'] = [
    ...(entry === 'NONE' ? (['ONBOARDING_UNAVAILABLE'] as const) : []),
    ...(driver.profile === null && applicationState !== null && PENDING_APPLICATION.has(applicationState) ? (['APPLICATION_PENDING'] as const) : []),
    ...(driver.profile === null && applicationState !== null && REJECTED_APPLICATION.has(applicationState) ? (['APPLICATION_REJECTED'] as const) : []),
    ...(driver.profile?.state === 'EXPIRED' ? (['DOCUMENTS_EXPIRED'] as const) : []),
    ...(driver.profile?.state === 'REVERIFY_DUE' ? (['PROFILE_REVERIFICATION_DUE'] as const) : []),
    ...(state.restrictions.some((r) => r.scope === 'DRIVER_ROLE') ? (['ROLE_RESTRICTED'] as const) : []),
    ...(accountRestricted ? (['ACCOUNT_RESTRICTED'] as const) : []),
    ...(deletionPending ? (['DELETION_PENDING'] as const) : []),
  ];
  return {
    rider: { available: riderBlockers.length === 0, blockers: riderBlockers },
    // The AREA may be shown whenever an entry exists; blockers explain what is paused inside it.
    driver: { entry, available: entry !== 'NONE', blockers: driverBlockers },
  };
}

export function modeAvailability(state: AccountState): ModeAvailability {
  return state.modes ?? deriveModes(state);
}

/** The Driver/Partner HOME (`/drive`) exists only for a driver profile (entry HUB) the server lets the app show. */
export const driverHomeAvailable = (availability: ModeAvailability): boolean => availability.driver.entry === 'HUB' && availability.driver.available;

export const homeOf = (mode: AppMode): ModeHome => (mode === 'DRIVER' ? '/drive' : '/ride');
