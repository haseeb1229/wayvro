import type { AccountState, AppConfig, AutocompleteResult, QuoteGroup, QuoteOption } from '@wayvro/contracts';
import { accountState, IDS } from './fixtures';

/** Synthetic Phase-3 fixtures (no real places, people, prices or coordinates of private homes). */
export const P3_IDS = {
  application: '0190a000-0000-7000-8000-0000000000a1',
  profile: '0190a000-0000-7000-8000-0000000000a2',
  restriction: '0190a000-0000-7000-8000-0000000000a3',
  accountRestriction: '0190a000-0000-7000-8000-0000000000a4',
  group: '0190a000-0000-7000-8000-0000000000b1',
  quoteEconomy: '0190a000-0000-7000-8000-0000000000b2',
  quoteComfort: '0190a000-0000-7000-8000-0000000000b3',
  document: '0190a000-0000-7000-8000-0000000000c1',
  otherAccount: '0190a000-0000-7000-8000-0000000000d1',
} as const;

/** SP-08 account matrix A–G plus H (deletion pending) and I (required action pending). */
export const ACCOUNT_KINDS = ['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I', 'N'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

type Restriction = AccountState['restrictions'][number];
const restriction = (scope: Restriction['scope'], id: string, affectsRiderUse: boolean): Restriction => ({
  id,
  scope,
  reasonCode: 'SYNTHETIC_REASON',
  reasonClass: 'COMPLIANCE',
  appealable: true,
  effectiveUntil: null,
  affectsRiderUse,
});

/**
 * A rider-only (onboarding ON) · B approved driver · D driver-role restricted · E account-wide restricted (has a
 * profile) · F pending application · G expired documents (profile REVERIFY_DUE/EXPIRED) · H deletion pending ·
 * I required action pending · N rider-only with onboarding OFF (no driver entry at all).
 */
export function p3Account(kind: AccountKind, withModes = false): AccountState {
  const base = accountState();
  const profile = { id: P3_IDS.profile, state: 'ACTIVE_ELIGIBLE' as const };
  const states: Record<AccountKind, AccountState> = {
    A: { ...base, driver: { application: null, profile: null, onboardingAvailable: true } },
    B: { ...base, driver: { application: { id: P3_IDS.application, state: 'VERIFIED' }, profile, onboardingAvailable: true } },
    D: {
      ...base,
      driver: { application: { id: P3_IDS.application, state: 'VERIFIED' }, profile, onboardingAvailable: true },
      restrictions: [restriction('DRIVER_ROLE', P3_IDS.restriction, false)],
    },
    E: {
      ...base,
      driver: { application: { id: P3_IDS.application, state: 'VERIFIED' }, profile, onboardingAvailable: true },
      restrictions: [restriction('ACCOUNT', P3_IDS.accountRestriction, true)],
    },
    F: { ...base, driver: { application: { id: P3_IDS.application, state: 'MANUAL_REVIEW' }, profile: null, onboardingAvailable: true } },
    G: {
      ...base,
      driver: { application: { id: P3_IDS.application, state: 'VERIFIED' }, profile: { id: P3_IDS.profile, state: 'EXPIRED' }, onboardingAvailable: true },
    },
    H: { ...base, account: { ...base.account, status: 'DELETION_PENDING' }, driver: { application: null, profile: null, onboardingAvailable: true } },
    I: {
      ...base,
      requiredActions: ['ACCEPT_POLICIES'],
      driver: { application: { id: P3_IDS.application, state: 'VERIFIED' }, profile, onboardingAvailable: true },
    },
    N: { ...base, driver: { application: null, profile: null, onboardingAvailable: false } },
  };
  const state = states[kind];
  if (!withModes) return state;
  return {
    ...state,
    modes: { rider: { available: true, blockers: [] }, driver: { entry: state.driver.profile === null ? 'ONBOARDING' : 'HUB', available: true, blockers: [] } },
  };
}

export const ACCOUNT_ID = IDS.account;

export function quoteOption(overrides: Partial<QuoteOption> = {}): QuoteOption {
  return {
    quoteId: P3_IDS.quoteEconomy,
    productCode: 'ECONOMY',
    status: 'PRICED',
    total: { currency: 'PKR', minor: '64000' },
    components: [
      { kind: 'BASE', amount: { currency: 'PKR', minor: '15000' } },
      { kind: 'DISTANCE', amount: { currency: 'PKR', minor: '37000' } },
      { kind: 'TIME', amount: { currency: 'PKR', minor: '11000' } },
      { kind: 'TOLL', amount: { currency: 'PKR', minor: '0' } },
      { kind: 'ROUNDING', amount: { currency: 'PKR', minor: '1000' } },
    ],
    taxIncluded: null,
    tollPolicy: 'EXCLUDED_DISCLOSED',
    expiresAt: '2026-10-13T10:05:00.000Z',
    rateCardVersion: 3,
    pricingEngineVersion: 'pe-v1',
    display: { nameKey: 'product.economy.name', seatsMax: 4, luggageClass: 'SMALL' },
    isSynthetic: true,
    ...overrides,
  };
}

export function quoteGroup(overrides: Partial<QuoteGroup> = {}): QuoteGroup {
  return {
    quoteGroupId: P3_IDS.group,
    createdAt: '2026-10-13T10:00:00.000Z',
    pickup: { snappedTo: null },
    route: {
      distanceM: 7400,
      durationS: 1320,
      polyline: null,
      confidence: 'MEDIUM',
      source: { providerKey: 'geo-a', fetchedAt: '2026-10-13T10:00:00.000Z', cacheStatus: 'MISS', attributionCode: null },
    },
    options: [quoteOption()],
    unavailable: [{ productCode: 'COMFORT', reasonCode: 'ZONE_NOT_SERVED', nextOpenAt: null }],
    ...overrides,
  };
}

/** Server time used with the fixtures above: 4 minutes 32 seconds before the economy option expires. */
export const SERVER_NOW = Date.parse('2026-10-13T10:00:28.000Z');

export function appConfig(client: Partial<AppConfig['client']> = {}, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    serverTime: '2026-10-13T10:00:00.000Z',
    client: { state: 'OK', reasonClass: null, messageKey: null, storeUrlKey: null, recommendedBuild: null, minSupportedBuild: null, ...client },
    maintenance: { active: false, messageKey: null, expectedEnd: null },
    switches: [],
    map: { rendererKind: 'none', styleUrl: null, attributionCodes: [], clientToken: null },
    geo: { autocompleteMinChars: 3, autocompleteDebounceMs: 300, reverseDebounceMs: 600 },
    lite: { autoSuggestAfterSlowRequests: 3, slowRequestMs: 4000 },
    ...overrides,
  };
}

export function autocompleteResult(count: number, cacheStatus: 'HIT' | 'MISS' | 'STALE_SERVED' = 'MISS'): AutocompleteResult {
  return {
    suggestions: Array.from({ length: count }, (_, i) => ({
      placeRef: `pr1.${'a'.repeat(40)}${String(i)}`,
      primaryText: `Synthetic Landmark ${String(i)}`,
      secondaryText: 'Synthetic Area',
      kind: 'LANDMARK' as const,
    })),
    source: { providerKey: 'geo-a', fetchedAt: '2026-10-13T10:00:00.000Z', cacheStatus, confidence: 'HIGH', attributionCode: null, coverageNote: null },
  };
}
