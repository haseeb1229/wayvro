import type { AccountState, ConsentRecorded, ConsentRequest, ConsentStatusList, PolicyKey, PolicyList } from '@wayvro/contracts';
import { toApiError } from '../../../core/api/errors';
import { errorView, type UiErrorView } from '../../../core/ui/view-state';

/**
 * Policy acceptance (A04 consent UI, ACCEPT_POLICIES). Shows exactly the policies the SERVER says need acceptance for
 * account use (`requiredFor` ⊇ ACCOUNT and `acceptanceRequired`); driver policies are not shown in P2.3. Each
 * acceptance is bound to the exact version and content hash of the text the user could open.
 */

type PolicySummary = PolicyList['policies'][number];

export interface PolicyItem {
  readonly policyKey: PolicyKey;
  readonly title: string;
  readonly version: number;
  readonly locale: 'en' | 'ur';
  readonly contentSha256: string;
  readonly placeholder: boolean;
  /** Change summary when the user accepted an earlier version (re-acceptance after a material change). */
  readonly changeSummary: string | null;
  /** The text is English although the UI language is not (no matching version in the UI's policy locale). */
  readonly shownInEnglish: boolean;
  readonly accepted: boolean;
}

export interface PolicyAcceptanceModel {
  readonly items: readonly PolicyItem[];
  /** Required policies whose current version is not (yet) in the policy list: acceptance waits for a refetch. */
  readonly syncing: readonly PolicyKey[];
  readonly canAccept: boolean;
}

export interface PolicyAcceptanceInput {
  readonly consents: ConsentStatusList;
  /** Policy list in the UI's policy locale. */
  readonly localized: PolicyList;
  /** English policy list (same object as `localized` when the policy locale is English). */
  readonly english: PolicyList;
  readonly uiIsEnglish: boolean;
  /** Policies accepted during this visit (shown as accepted until the server state catches up). */
  readonly acceptedNow: ReadonlySet<PolicyKey>;
}

const find = (list: PolicyList, key: PolicyKey, version: number): PolicySummary | undefined =>
  list.policies.find((p) => p.policyKey === key && p.version === version);

export function policyAcceptanceModel(input: PolicyAcceptanceInput): PolicyAcceptanceModel {
  const items: PolicyItem[] = [];
  const syncing: PolicyKey[] = [];
  for (const status of input.consents.policies) {
    if (!status.requiredFor.includes('ACCOUNT') || !status.acceptanceRequired) continue;
    const localized = find(input.localized, status.policyKey, status.currentVersion);
    const summary = localized ?? find(input.english, status.policyKey, status.currentVersion);
    if (!summary) {
      syncing.push(status.policyKey);
      continue;
    }
    items.push({
      policyKey: summary.policyKey,
      title: summary.title,
      version: summary.version,
      locale: summary.locale,
      contentSha256: summary.contentSha256,
      placeholder: summary.status === 'PLACEHOLDER_NOT_FOR_PRODUCTION',
      changeSummary: status.acceptedVersion !== null && summary.changeSummary.trim() !== '' ? summary.changeSummary : null,
      shownInEnglish: !input.uiIsEnglish && summary.locale === 'en',
      accepted: input.acceptedNow.has(summary.policyKey),
    });
  }
  return { items, syncing, canAccept: syncing.length === 0 && items.some((i) => !i.accepted) };
}

/** @internal exported for unit tests */
export function consentRequestFor(item: PolicyItem): ConsentRequest {
  return { policyKey: item.policyKey, version: item.version, locale: item.locale, contentSha256: item.contentSha256, action: 'ACCEPTED' };
}

export interface AcceptanceResult {
  readonly accepted: readonly PolicyKey[];
  readonly failure: { readonly policyKey: PolicyKey; readonly error: unknown } | null;
  /** requiredActions from the last successful record (server truth after the acceptances). */
  readonly requiredActions: AccountState['requiredActions'] | null;
}

/** Records ACCEPTED for each pending item in order, stopping at the first failure (each has its own idempotent intent). */
export async function acceptPending(items: readonly PolicyItem[], record: (request: ConsentRequest) => Promise<ConsentRecorded>): Promise<AcceptanceResult> {
  const accepted: PolicyKey[] = [];
  let requiredActions: AccountState['requiredActions'] | null = null;
  for (const item of items) {
    if (item.accepted) continue;
    try {
      const recorded = await record(consentRequestFor(item));
      accepted.push(item.policyKey);
      requiredActions = recorded.requiredActions;
    } catch (error) {
      return { accepted, failure: { policyKey: item.policyKey, error }, requiredActions };
    }
  }
  return { accepted, failure: null, requiredActions };
}

export interface AcceptanceErrorView {
  readonly view: UiErrorView;
  /** Policies/consents must be refetched (a version or hash changed). */
  readonly refetch: boolean;
  readonly partial: boolean;
}

export function acceptanceError(result: AcceptanceResult): AcceptanceErrorView | null {
  if (!result.failure) return null;
  const apiError = toApiError(result.failure.error);
  const partial = result.accepted.length > 0;
  if (apiError.code === 'WAYVRO_E_CONFLICT') return { view: { kind: 'conflict', messageKey: 'policies.changed', action: 'retry' }, refetch: true, partial };
  const base = errorView(apiError);
  return { view: partial && base.kind !== 'session-expired' ? { ...base, messageKey: 'policies.partial' } : base, refetch: false, partial };
}
