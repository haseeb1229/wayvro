import type { AccountState } from '@wayvro/contracts';
import type { StringKey } from '../../../core/i18n/strings';

/**
 * Restriction messaging (V13, P2.3 scope): only restrictions the SERVER marks `affectsRiderUse` are shown here; driver,
 * vehicle and capability restrictions belong to the Driver/Partner flows (P2.8). Copy is chosen by the enumerated
 * reason class; the free-form reason code is shown only as a reference for support, never as the explanation.
 */
type Restriction = AccountState['restrictions'][number];

export interface RestrictionNoticeItem {
  readonly id: string;
  readonly messageKey: `restriction.class.${Restriction['reasonClass']}` & StringKey;
  readonly reasonCode: string;
  readonly effectiveUntil: string | null;
  readonly appealable: boolean;
}

export function riderRestrictionNotices(state: Pick<AccountState, 'restrictions'>): readonly RestrictionNoticeItem[] {
  return state.restrictions
    .filter((r) => r.affectsRiderUse)
    .map((r) => ({
      id: r.id,
      messageKey: `restriction.class.${r.reasonClass}`,
      reasonCode: r.reasonCode,
      effectiveUntil: r.effectiveUntil,
      appealable: r.appealable,
    }));
}
