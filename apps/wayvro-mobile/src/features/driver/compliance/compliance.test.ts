import { BLOCKER_CODES, REASON_CLASS_VALUES, RESTRICTION_SCOPE_VALUES } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { compliance, doc, DRIVER_IDS } from '../../../__mocks__/driver-fixtures';
import { DRIVER_CATALOGUE } from '../i18n/driver-strings';
import { complianceModel, renewalAction } from './compliance';

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

  it('renewal adapter: due/expired documents with an expiry can renew; drafts continue; reviews wait; a refused renewal restarts (no appeal)', () => {
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

  it('every blocker, restriction class/scope and profile state has copy', () => {
    for (const code of BLOCKER_CODES) expect(DRIVER_CATALOGUE.en[`blocker.${code}`]).toBeTruthy();
    for (const cls of REASON_CLASS_VALUES) expect(DRIVER_CATALOGUE.en[`driverRestriction.${cls}`]).toBeTruthy();
    for (const scope of RESTRICTION_SCOPE_VALUES) expect(DRIVER_CATALOGUE.en[`driverRestriction.scope.${scope}`]).toBeTruthy();
  });
});
