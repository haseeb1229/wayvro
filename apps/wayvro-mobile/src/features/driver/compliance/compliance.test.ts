import { BLOCKER_CODES, REASON_CLASS_VALUES, RESTRICTION_SCOPE_VALUES } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { compliance, doc, DRIVER_IDS } from '../../../__mocks__/driver-fixtures';
import { DRIVER_CATALOGUE } from '../i18n/driver-strings';
import { complianceModel, renewalAction, renewalAppeal } from './compliance';

type ComplianceDoc = Parameters<typeof renewalAction>[0];
const row = (overrides: Partial<ComplianceDoc>): ComplianceDoc => ({
  ...doc(DRIVER_IDS.licenceDoc, 'DRIVING_LICENCE', 'VALID'),
  expiresOn: '2027-01-01',
  renewalDue: false,
  renewal: null,
  hasNumber: true,
  hasExpiry: true,
  ...overrides,
});

describe('driver compliance view', () => {
  it('shows every blocker in plain words (with the document), documents and restrictions; superseded documents are hidden', () => {
    const model = complianceModel(compliance());
    expect(model.profileStateKey).toBe('profileState.VERIFIED');
    expect(model.applicationId).toBe(DRIVER_IDS.application);
    expect(model.eligibility).toEqual([
      {
        cityCode: 'LHR',
        category: 'CAR',
        eligible: false,
        blockers: [
          { key: 'blocker.DOCUMENT_EXPIRED', documentType: 'DRIVING_LICENCE' },
          { key: 'blocker.REQUIREMENT_SET_PLACEHOLDER', documentType: null },
        ],
      },
    ]);
    expect(model.documents.map((d) => [d.documentType, d.action])).toEqual([
      ['DRIVING_LICENCE', 'start'],
      ['VEHICLE_REGISTRATION', 'none'],
      ['CNIC', 'continue'],
    ]);
    expect(model.documents[2]).toMatchObject({ renewalStatusKey: 'renewalStatus.DRAFT', renewalDocumentId: DRIVER_IDS.renewalDoc });
    expect(model.restrictions).toEqual([
      {
        id: DRIVER_IDS.restriction,
        key: 'driverRestriction.COMPLIANCE',
        scopeKey: 'driverRestriction.scope.DRIVER_ROLE',
        reasonCode: 'SYNTHETIC_REASON',
        effectiveUntil: null,
        appealable: true,
      },
    ]);
  });

  it('renewal adapter: due/expired documents with an expiry can renew; drafts continue; reviews wait; a refused renewal can restart', () => {
    expect(renewalAction(row({ renewalDue: true }))).toBe('start');
    expect(renewalAction(row({ status: 'EXPIRED' }))).toBe('start');
    expect(renewalAction(row({}))).toBe('none');
    expect(renewalAction(row({ renewalDue: true, expiresOn: null }))).toBe('none');
    expect(renewalAction(row({ renewalDue: true, status: 'UNDER_REVIEW' }))).toBe('none');
    expect(
      renewalAction(row({ renewal: { renewalDocumentId: DRIVER_IDS.renewalDoc, status: 'DRAFT', evidenceKinds: ['LICENCE_FRONT', 'LICENCE_BACK'] } })),
    ).toBe('continue');
    expect(
      renewalAction(row({ renewal: { renewalDocumentId: DRIVER_IDS.renewalDoc, status: 'IN_REVIEW', evidenceKinds: ['LICENCE_FRONT', 'LICENCE_BACK'] } })),
    ).toBe('in-review');
    expect(
      renewalAction(row({ renewal: { renewalDocumentId: DRIVER_IDS.renewalDoc, status: 'REJECTED', evidenceKinds: ['LICENCE_FRONT', 'LICENCE_BACK'] } })),
    ).toBe('start');
  });

  it('rejected renewal appeal: offered only for a server-named appealable decision with no appeal yet; each status in plain words', () => {
    const rejected = { renewalDocumentId: DRIVER_IDS.renewalDoc, status: 'REJECTED' as const, evidenceKinds: ['LICENCE_FRONT'] };
    expect(renewalAppeal(null)).toEqual({ kind: 'none' });
    expect(renewalAppeal(undefined)).toEqual({ kind: 'none' });
    // Older servers (field absent) and non-appealable rejections offer no appeal.
    expect(renewalAppeal(rejected)).toEqual({ kind: 'none' });
    expect(renewalAppeal({ ...rejected, appealableDecisionId: null, appealStatus: null })).toEqual({ kind: 'none' });
    expect(renewalAppeal({ ...rejected, appealableDecisionId: DRIVER_IDS.decision, appealStatus: null })).toEqual({
      kind: 'can-appeal',
      decisionId: DRIVER_IDS.decision,
    });
    expect(renewalAppeal({ ...rejected, appealableDecisionId: DRIVER_IDS.decision })).toEqual({ kind: 'can-appeal', decisionId: DRIVER_IDS.decision });
    // Only a REJECTED renewal can be appealed.
    for (const status of ['DRAFT', 'IN_REVIEW', 'APPROVED'] as const)
      expect(renewalAppeal({ ...rejected, status, appealableDecisionId: DRIVER_IDS.decision, appealStatus: null }), status).toEqual({ kind: 'none' });
    // An appeal already made is shown instead of a second offer; OVERTURNED comes back with the renewal in review.
    for (const appealStatus of ['SUBMITTED', 'UNDER_REVIEW', 'UPHELD', 'WITHDRAWN'] as const)
      expect(renewalAppeal({ ...rejected, appealableDecisionId: DRIVER_IDS.decision, appealStatus })).toEqual({
        kind: 'status',
        status: appealStatus,
        key: `renewalAppeal.status.${appealStatus}`,
      });
    expect(renewalAppeal({ ...rejected, status: 'IN_REVIEW', appealableDecisionId: null, appealStatus: 'OVERTURNED' })).toEqual({
      kind: 'status',
      status: 'OVERTURNED',
      key: 'renewalAppeal.status.OVERTURNED',
    });
    expect(DRIVER_CATALOGUE.en['renewalAppeal.status.OVERTURNED']).toMatch(/review this renewal again/);
  });

  it('a rejected renewal stays restartable while its appeal is offered or pending', () => {
    const renewal = { renewalDocumentId: DRIVER_IDS.renewalDoc, status: 'REJECTED' as const, evidenceKinds: [], appealableDecisionId: DRIVER_IDS.decision };
    expect(renewalAction(row({ renewalDue: true, renewal: { ...renewal, appealStatus: null } }))).toBe('start');
    expect(renewalAction(row({ renewalDue: true, renewal: { ...renewal, appealStatus: 'SUBMITTED' } }))).toBe('start');
  });

  it('document rows carry the district and the renewal appeal', () => {
    const model = complianceModel(
      compliance({
        documents: [
          row({
            documentType: 'ROUTE_PERMIT',
            districtCode: 'LHR-SYN01',
            status: 'VALID',
            renewalDue: true,
            renewal: {
              renewalDocumentId: DRIVER_IDS.renewalDoc,
              status: 'REJECTED',
              evidenceKinds: [],
              appealableDecisionId: DRIVER_IDS.decision,
              appealStatus: null,
            },
          }),
        ],
      }),
    );
    expect(model.documents[0]).toMatchObject({
      districtCode: 'LHR-SYN01',
      action: 'start',
      renewalStatusKey: 'renewalStatus.REJECTED',
      appeal: { kind: 'can-appeal', decisionId: DRIVER_IDS.decision },
    });
    expect(complianceModel(compliance()).documents.map((d) => d.districtCode)).toEqual([null, null, null]);
  });

  it('every blocker, restriction class/scope and profile state has copy', () => {
    for (const code of BLOCKER_CODES) expect(DRIVER_CATALOGUE.en[`blocker.${code}`]).toBeTruthy();
    for (const cls of REASON_CLASS_VALUES) expect(DRIVER_CATALOGUE.en[`driverRestriction.${cls}`]).toBeTruthy();
    for (const scope of RESTRICTION_SCOPE_VALUES) expect(DRIVER_CATALOGUE.en[`driverRestriction.scope.${scope}`]).toBeTruthy();
  });
});
