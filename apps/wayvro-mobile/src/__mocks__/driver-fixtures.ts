import type { DriverApplication, DriverCompliance, EvidenceUploadStatus } from '@wayvro/contracts';
import type { RequirementChecklist } from '../features/driver/api/driver-api';

/** Synthetic Driver/Partner fixtures (no real names, CNICs, plates, photos or documents). */
export const DRIVER_IDS = {
  application: '0190b000-0000-7000-8000-000000000001',
  vehicle: '0190b000-0000-7000-8000-000000000002',
  cnicDoc: '0190b000-0000-7000-8000-000000000003',
  selfieDoc: '0190b000-0000-7000-8000-000000000004',
  licenceDoc: '0190b000-0000-7000-8000-000000000005',
  regDoc: '0190b000-0000-7000-8000-000000000006',
  upload1: '0190b000-0000-7000-8000-000000000007',
  upload2: '0190b000-0000-7000-8000-000000000008',
  decision: '0190b000-0000-7000-8000-000000000009',
  appeal: '0190b000-0000-7000-8000-00000000000a',
  challenge: '0190b000-0000-7000-8000-00000000000b',
  profile: '0190b000-0000-7000-8000-00000000000c',
  restriction: '0190b000-0000-7000-8000-00000000000d',
  renewalDoc: '0190b000-0000-7000-8000-00000000000e',
  requirementSet: '0190b000-0000-7000-8000-00000000000f',
} as const;

export function application(overrides: Partial<DriverApplication> = {}): DriverApplication {
  return {
    id: DRIVER_IDS.application,
    state: 'DOCUMENTS_PENDING',
    version: 4,
    cityCode: 'LHR',
    serviceCategories: ['CAR'],
    claims: { legalNameProvided: true, cnicLast4: '0000', dateOfBirthProvided: true },
    vehicles: [
      {
        id: DRIVER_IDS.vehicle,
        plateDisplay: 'TEST-001',
        make: 'Synthetic',
        model: 'Sedan',
        modelYear: 2020,
        colour: 'White',
        serviceCategory: 'CAR',
        ownershipType: 'REGISTERED_OWNER',
        relation: 'OWNER',
        version: 1,
      },
    ],
    documents: [],
    pendingPolicies: [],
    createdAt: '2026-10-01T09:00:00.000Z',
    submittedAt: null,
    ...overrides,
  };
}

type Doc = DriverApplication['documents'][number];
export function doc(id: string, documentType: string, status: Doc['status'] = 'SUBMITTED'): Doc {
  return { id, documentType, vehicleId: null, districtCode: null, numberLast4: null, licenceClass: null, claimedExpiresOn: null, status };
}

export function checklist(overrides: Partial<RequirementChecklist> = {}): RequirementChecklist {
  const item = (documentType: string, evidenceKinds: string[], mandatory = true, extra: Partial<RequirementChecklist['items'][number]> = {}) => ({
    documentType,
    mandatory,
    subject: 'DRIVER' as const,
    perDistrict: false,
    applicable: true,
    claimed: false,
    evidenceKinds,
    licenceClassesAllowed: [],
    hasNumber: true,
    hasExpiry: true,
    ...extra,
  });
  return {
    requirementSetId: DRIVER_IDS.requirementSet,
    version: 0,
    isPlaceholder: true,
    items: [
      item('CNIC', ['CNIC_FRONT', 'CNIC_BACK']),
      item('SELFIE', ['SELFIE_FOR_MANUAL_REVIEW'], true, { hasNumber: false, hasExpiry: false }),
      item('VEHICLE_REGISTRATION', ['DOCUMENT_PAGE'], true, { subject: 'VEHICLE', hasExpiry: false }),
      item('AUTHORISED_USE_LETTER', ['DOCUMENT_PAGE'], true, { subject: 'DRIVER_VEHICLE', applicable: false, hasNumber: false }),
      item('ROUTE_PERMIT', ['DOCUMENT_PAGE'], false, { subject: 'VEHICLE', perDistrict: true }),
    ],
    ...overrides,
  };
}

export function evidence(
  uploadId: string,
  documentId: string,
  kind: EvidenceUploadStatus['kind'],
  status: EvidenceUploadStatus['status'],
  rejectionReason: EvidenceUploadStatus['rejectionReason'] = null,
): EvidenceUploadStatus {
  return { uploadId, documentId, kind, captureSource: 'IN_APP_CAMERA', status, rejectionReason, createdAt: '2026-10-11T09:00:00.000Z' };
}

export function compliance(overrides: Partial<DriverCompliance> = {}): DriverCompliance {
  return {
    profile: { id: DRIVER_IDS.profile, state: 'VERIFIED' },
    eligibility: [
      {
        vehicleId: DRIVER_IDS.vehicle,
        cityCode: 'LHR',
        serviceCategory: 'CAR',
        eligible: false,
        blockers: [{ code: 'DOCUMENT_EXPIRED', documentType: 'DRIVING_LICENCE' }, { code: 'REQUIREMENT_SET_PLACEHOLDER' }],
      },
    ],
    documents: [
      {
        ...doc(DRIVER_IDS.licenceDoc, 'DRIVING_LICENCE', 'EXPIRED'),
        licenceClass: 'LTV',
        expiresOn: '2026-09-01',
        renewalDue: true,
        renewal: null,
        hasNumber: true,
        hasExpiry: true,
      },
      { ...doc(DRIVER_IDS.regDoc, 'VEHICLE_REGISTRATION', 'VALID'), expiresOn: null, renewalDue: false, renewal: null, hasNumber: true, hasExpiry: false },
      {
        ...doc(DRIVER_IDS.cnicDoc, 'CNIC', 'VALID'),
        expiresOn: '2030-01-01',
        renewalDue: false,
        renewal: { renewalDocumentId: DRIVER_IDS.renewalDoc, status: 'DRAFT', evidenceKinds: ['CNIC_FRONT', 'CNIC_BACK'] },
        hasNumber: true,
        hasExpiry: true,
      },
      { ...doc(DRIVER_IDS.selfieDoc, 'SELFIE', 'SUPERSEDED'), expiresOn: null, renewalDue: false, hasNumber: false, hasExpiry: false },
    ],
    applicationId: DRIVER_IDS.application,
    restrictions: [
      {
        id: DRIVER_IDS.restriction,
        scope: 'DRIVER_ROLE',
        reasonCode: 'SYNTHETIC_REASON',
        reasonClass: 'COMPLIANCE',
        appealable: true,
        effectiveUntil: null,
        affectsRiderUse: false,
      },
    ],
    ...overrides,
  };
}
