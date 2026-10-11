import type { AccountState } from '@wayvro/contracts';
import type { StringKey } from '../../../core/i18n/strings';
import { riderRestrictionNotices, type RestrictionNoticeItem } from './restrictions';

/** Account home (A05/A11 UI): a summary built only from the server's account state (driver fields are not used in P2.3). */
export interface HomeModel {
  readonly greetingKey: Extract<StringKey, 'home.greeting' | 'home.greetingNoName'>;
  readonly name: string | null;
  readonly memberSince: string;
  readonly preferredLocale: AccountState['account']['preferredLocale'];
  readonly restrictions: readonly RestrictionNoticeItem[];
}

export function homeModel(state: AccountState): HomeModel {
  const name = state.account.displayName?.trim() ?? '';
  return {
    greetingKey: name === '' ? 'home.greetingNoName' : 'home.greeting',
    name: name === '' ? null : name,
    memberSince: state.account.createdAt,
    preferredLocale: state.account.preferredLocale,
    restrictions: riderRestrictionNotices(state),
  };
}
