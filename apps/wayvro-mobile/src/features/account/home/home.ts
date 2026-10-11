import type { AccountState } from '@wayvro/contracts';
import type { StringKey } from '../../../core/i18n/strings';
import { riderRestrictionNotices, type RestrictionNoticeItem } from './restrictions';

/**
 * Account home (A05/A11 UI): a summary built only from the server's account state. The Driver/Partner entry (P2.8, V03)
 * is a presentation hint from the server's `driver` section — the server still decides every onboarding step.
 */
export interface HomeModel {
  readonly greetingKey: Extract<StringKey, 'home.greeting' | 'home.greetingNoName'>;
  readonly name: string | null;
  readonly memberSince: string;
  readonly preferredLocale: AccountState['account']['preferredLocale'];
  readonly restrictions: readonly RestrictionNoticeItem[];
  /** `apply`: offer to start an application; `driver`: open the Driver/Partner area; null: no entry. */
  readonly driverEntry: 'apply' | 'driver' | null;
  /** P2.9: the account is in its deletion grace period (most actions are paused server-side). */
  readonly deletionPending: boolean;
}

/**
 * A verified driver always reaches the Driver/Partner area (compliance, renewals). Otherwise the entry exists only while
 * the server reports onboarding as available.
 * @internal exported for unit tests
 */
export function driverEntry(driver: AccountState['driver']): HomeModel['driverEntry'] {
  if (driver.profile !== null) return 'driver';
  if (!driver.onboardingAvailable) return null;
  return driver.application === null ? 'apply' : 'driver';
}

export function homeModel(state: AccountState): HomeModel {
  const name = state.account.displayName?.trim() ?? '';
  return {
    greetingKey: name === '' ? 'home.greetingNoName' : 'home.greeting',
    name: name === '' ? null : name,
    memberSince: state.account.createdAt,
    preferredLocale: state.account.preferredLocale,
    restrictions: riderRestrictionNotices(state),
    driverEntry: driverEntry(state.driver),
    deletionPending: state.account.status === 'DELETION_PENDING',
  };
}
