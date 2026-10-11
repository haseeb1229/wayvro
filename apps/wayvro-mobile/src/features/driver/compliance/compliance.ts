import type { DriverCompliance } from '@wayvro/contracts';
import type { DriverStringKey } from '../i18n/driver-strings';

/**
 * Verified driver compliance view (P2.8; D03 renewals, R02–R06, V13). Built only from `GET /v1/driver/compliance`:
 * every eligibility blocker in plain words, documents with expiry and renewal state, and Driver/Partner restrictions.
 * Eligibility shown here is the SERVER's evaluation; going online is not part of this version.
 */

type Eligibility = DriverCompliance['eligibility'][number];
type Blocker = Eligibility['blockers'][number];
type ComplianceDocument = DriverCompliance['documents'][number];
type Restriction = DriverCompliance['restrictions'][number];

export interface BlockerView {
  readonly key: DriverStringKey;
  readonly documentType: string | null;
}

interface EligibilityView {
  readonly cityCode: string;
  readonly category: Eligibility['serviceCategory'];
  readonly eligible: boolean;
  readonly blockers: readonly BlockerView[];
}

type RenewalAction = 'start' | 'continue' | 'in-review' | 'none';

export interface DocumentRowView {
  readonly id: string;
  readonly documentType: string;
  readonly statusKey: DriverStringKey;
  readonly expiresOn: string | null;
  readonly renewalDue: boolean;
  readonly renewalStatusKey: DriverStringKey | null;
  readonly renewalDocumentId: string | null;
  readonly action: RenewalAction;
}

export interface RestrictionView {
  readonly id: string;
  readonly key: DriverStringKey;
  readonly scopeKey: DriverStringKey;
  readonly reasonCode: string;
  readonly effectiveUntil: string | null;
  readonly appealable: boolean;
}

export interface ComplianceModel {
  readonly profileStateKey: DriverStringKey;
  readonly applicationId: string | null;
  readonly eligibility: readonly EligibilityView[];
  readonly documents: readonly DocumentRowView[];
  readonly restrictions: readonly RestrictionView[];
}

const blockerView = (b: Blocker): BlockerView => ({
  key: `blocker.${b.code}`,
  documentType: b.documentType ?? null,
});

/** Renewal is offered for documents with an expiry that are VALID or EXPIRED and have no renewal in progress. @internal exported for unit tests */
export function renewalAction(doc: ComplianceDocument): RenewalAction {
  const renewal = doc.renewal ?? null;
  if (renewal !== null) {
    if (renewal.status === 'DRAFT') return 'continue';
    if (renewal.status === 'IN_REVIEW') return 'in-review';
  }
  const renewable = (doc.status === 'VALID' || doc.status === 'EXPIRED') && doc.expiresOn !== null;
  return renewable && (doc.renewalDue || doc.status === 'EXPIRED' || renewal?.status === 'REJECTED') ? 'start' : 'none';
}

const restrictionView = (r: Restriction): RestrictionView => ({
  id: r.id,
  key: `driverRestriction.${r.reasonClass}`,
  scopeKey: `driverRestriction.scope.${r.scope}`,
  reasonCode: r.reasonCode,
  effectiveUntil: r.effectiveUntil,
  appealable: r.appealable,
});

export function complianceModel(compliance: DriverCompliance): ComplianceModel {
  return {
    profileStateKey: `profileState.${compliance.profile.state}`,
    applicationId: compliance.applicationId ?? null,
    eligibility: compliance.eligibility.map((e) => ({
      cityCode: e.cityCode,
      category: e.serviceCategory,
      eligible: e.eligible,
      blockers: e.blockers.map(blockerView),
    })),
    documents: compliance.documents
      .filter((d) => d.status !== 'SUPERSEDED')
      .map((d) => ({
        id: d.id,
        documentType: d.documentType,
        statusKey: `docStatus.${d.status}`,
        expiresOn: d.expiresOn,
        renewalDue: d.renewalDue,
        renewalStatusKey: d.renewal ? (`renewalStatus.${d.renewal.status}` as const) : null,
        renewalDocumentId: d.renewal?.renewalDocumentId ?? null,
        action: renewalAction(d),
      })),
    restrictions: compliance.restrictions.map(restrictionView),
  };
}
