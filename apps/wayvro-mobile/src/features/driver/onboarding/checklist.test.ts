import { describe, expect, it } from 'vitest';
import { application, checklist, doc, DRIVER_IDS, evidence } from '../../../__mocks__/driver-fixtures';
import { createUploadItem, reduceUpload, type UploadItem } from '../upload/upload-queue';
import { checklistModel, currentDocument, evidenceDisplay, missingItems } from './checklist';
import { districtName, districtOptions } from './districts';
import { documentNameKey, KNOWN_DOCUMENT_TYPES } from './document-names';
import { DRIVER_CATALOGUE } from '../i18n/driver-strings';

function localItem(state: 'queued' | 'failed', documentId: string = DRIVER_IDS.cnicDoc): UploadItem {
  const created = createUploadItem(
    {
      id: 'local_item_000001',
      applicationId: DRIVER_IDS.application,
      documentId,
      kind: 'CNIC_FRONT',
      source: 'IN_APP_CAMERA',
      challengeId: null,
      fileName: 'synthetic_file_01.jpg',
      byteSize: 100,
      mime: 'image/jpeg',
    },
    [],
  );
  if (!created.ok) throw new Error(created.reason);
  return state === 'failed' ? reduceUpload(created.item, { type: 'definitive-error', reason: 'conflict' }, 0, () => 0) : created.item;
}

describe('requirement checklist', () => {
  it('shows applicable items (required first), hides not-applicable ones and labels placeholder sets', () => {
    const model = checklistModel(checklist(), application(), [], []);
    expect(model.placeholder).toBe(true);
    expect(model.items.map((i) => i.documentType)).toEqual(['CNIC', 'SELFIE', 'VEHICLE_REGISTRATION', 'ROUTE_PERMIT']);
    expect(model.notApplicable).toEqual(['AUTHORISED_USE_LETTER']);
    // Per-district item while the server lists no district: honestly not claimable yet.
    expect(model.items.find((i) => i.documentType === 'ROUTE_PERMIT')).toMatchObject({
      perDistrict: true,
      districts: [],
      claimable: false,
      status: 'no-district',
      mandatory: false,
    });
    expect(model).toMatchObject({ readyMandatory: 0, totalMandatory: 3, canSubmit: false });
  });

  it('tracks each item from not started → details saved → ready, and allows submission when every required item is ready', () => {
    const app = application({
      documents: [doc(DRIVER_IDS.cnicDoc, 'CNIC'), doc(DRIVER_IDS.selfieDoc, 'SELFIE'), doc(DRIVER_IDS.regDoc, 'VEHICLE_REGISTRATION')],
    });
    const partial = checklistModel(checklist(), app, [evidence(DRIVER_IDS.upload1, DRIVER_IDS.cnicDoc, 'CNIC_FRONT', 'ACCEPTED')], []);
    expect(partial.items[0]?.status).toBe('in-progress');
    expect(partial.items[1]?.status).toBe('details-saved');
    const server = [
      evidence(DRIVER_IDS.upload1, DRIVER_IDS.cnicDoc, 'CNIC_FRONT', 'ACCEPTED'),
      evidence(DRIVER_IDS.upload2, DRIVER_IDS.cnicDoc, 'CNIC_BACK', 'ACCEPTED'),
      evidence(DRIVER_IDS.appeal, DRIVER_IDS.selfieDoc, 'SELFIE_FOR_MANUAL_REVIEW', 'ACCEPTED'),
      evidence(DRIVER_IDS.challenge, DRIVER_IDS.regDoc, 'DOCUMENT_PAGE', 'ACCEPTED'),
    ];
    const ready = checklistModel(checklist(), app, server, []);
    expect(ready).toMatchObject({ readyMandatory: 3, totalMandatory: 3, canSubmit: true, uploadsInFlight: false });
    // A photo still uploading blocks the submit button (the server would refuse with EVIDENCE_PROCESSING).
    expect(checklistModel(checklist(), app, server, [localItem('queued')])).toMatchObject({ uploadsInFlight: true, canSubmit: false });
  });

  it('evidence of a superseded claim does not count; rejected photos need action', () => {
    const app = application({ documents: [doc(DRIVER_IDS.licenceDoc, 'CNIC', 'SUPERSEDED'), doc(DRIVER_IDS.cnicDoc, 'CNIC')] });
    expect(currentDocument(app, 'CNIC')?.id).toBe(DRIVER_IDS.cnicDoc);
    const model = checklistModel(
      checklist(),
      app,
      [
        evidence(DRIVER_IDS.upload1, DRIVER_IDS.licenceDoc, 'CNIC_FRONT', 'ACCEPTED'),
        evidence(DRIVER_IDS.upload2, DRIVER_IDS.cnicDoc, 'CNIC_BACK', 'REJECTED', 'UNREADABLE'),
      ],
      [],
    );
    expect(model.items[0]?.evidence).toEqual([
      { kind: 'CNIC_FRONT', display: { state: 'none' } },
      { kind: 'CNIC_BACK', display: { state: 'rejected', uploadId: DRIVER_IDS.upload2, rejection: 'UNREADABLE' } },
    ]);
    expect(model.items[0]?.status).toBe('action-needed');
  });

  it('an in-flight local upload wins over older server outcomes; a failed one can be retried while its file exists', () => {
    const server = [evidence(DRIVER_IDS.upload1, DRIVER_IDS.cnicDoc, 'CNIC_FRONT', 'REJECTED', 'TOO_LARGE')];
    expect(evidenceDisplay(DRIVER_IDS.cnicDoc, 'CNIC_FRONT', server, [localItem('queued')])).toEqual({ state: 'queued', localId: 'local_item_000001' });
    expect(evidenceDisplay(DRIVER_IDS.cnicDoc, 'CNIC_FRONT', server, [localItem('failed')])).toEqual({
      state: 'failed',
      localId: 'local_item_000001',
      failure: 'conflict',
      canRetry: true,
    });
    expect(evidenceDisplay(null, 'CNIC_FRONT', server, [])).toEqual({ state: 'none' });
    expect(evidenceDisplay(DRIVER_IDS.cnicDoc, 'CNIC_FRONT', [evidence(DRIVER_IDS.upload1, DRIVER_IDS.cnicDoc, 'CNIC_FRONT', 'EXPIRED')], [])).toEqual({
      state: 'none',
    });
  });
});

describe('per-district items (R46)', () => {
  const districts = [
    { code: 'LHR-SYN01', nameEn: 'Synthetic North', nameUr: 'مصنوعی شمال' },
    { code: 'LHR-SYN02', nameEn: 'Synthetic South', nameUr: 'مصنوعی جنوب' },
  ];

  it('offers only the server-listed districts, and only on per-district items', () => {
    const model = checklistModel(checklist({ districts }), application(), [], []);
    const permit = model.items.find((i) => i.documentType === 'ROUTE_PERMIT');
    expect(permit).toMatchObject({ perDistrict: true, districts, claimable: true, status: 'not-started' });
    for (const item of model.items.filter((i) => i.documentType !== 'ROUTE_PERMIT')) {
      expect(item, item.documentType).toMatchObject({ perDistrict: false, districts: [], claimable: true });
    }
  });

  it('an existing per-district claim keeps its status even when no district is listed now', () => {
    const app = application({ documents: [{ ...doc(DRIVER_IDS.regDoc, 'ROUTE_PERMIT'), districtCode: 'LHR-SYN01' }] });
    const permit = checklistModel(checklist({ districts: [] }), app, [], []).items.find((i) => i.documentType === 'ROUTE_PERMIT');
    expect(permit).toMatchObject({ claimable: false, status: 'details-saved' });
    expect(permit?.document?.districtCode).toBe('LHR-SYN01');
  });

  it('district names: Urdu script in the Urdu UI, English otherwise, the code as fallback', () => {
    expect(districtName('en', 'LHR-SYN01', districts)).toBe('Synthetic North');
    expect(districtName('ur-Latn', 'LHR-SYN01', districts)).toBe('Synthetic North');
    expect(districtName('ur', 'LHR-SYN01', districts)).toBe('مصنوعی شمال');
    expect(districtName('ur', 'LHR-UNLISTED', districts)).toBe('LHR-UNLISTED');
    expect(districtName('en', 'LHR-SYN01', [])).toBe('LHR-SYN01');
    expect(districtName('en', 'LHR-SYN03', [{ code: 'LHR-SYN03', nameEn: ' ', nameUr: '' }])).toBe('LHR-SYN03');
    expect(districtOptions('ur', districts)).toEqual([
      { value: 'LHR-SYN01', label: 'مصنوعی شمال' },
      { value: 'LHR-SYN02', label: 'مصنوعی جنوب' },
    ]);
    expect(districtOptions('en', [])).toEqual([]);
  });
});

describe('submission refusals', () => {
  it('maps itemised reason codes to readable items', () => {
    expect(
      missingItems([
        'MISSING_DOCUMENT_CNIC',
        'MISSING_EVIDENCE_SELFIE_FOR_MANUAL_REVIEW',
        'EVIDENCE_PROCESSING',
        'NO_ACTIVE_REQUIREMENT_SET',
        'MISSING_EVIDENCE_HOLOGRAM',
        'ODD',
      ]),
    ).toEqual([
      { kind: 'document', documentType: 'CNIC' },
      { kind: 'evidence', evidenceKind: 'SELFIE_FOR_MANUAL_REVIEW' },
      { kind: 'processing' },
      { kind: 'no-requirement-set' },
      { kind: 'unknown', code: 'MISSING_EVIDENCE_HOLOGRAM' },
      { kind: 'unknown', code: 'ODD' },
    ]);
  });
});

describe('document display names', () => {
  it('every known type has a display name; unknown (future) codes have none and show their code', () => {
    for (const type of KNOWN_DOCUMENT_TYPES) {
      const key = documentNameKey(type);
      expect(key, type).not.toBeNull();
      if (key) expect(DRIVER_CATALOGUE.en[key]).toBeTruthy();
    }
    expect(documentNameKey('FUTURE_DOCUMENT')).toBeNull();
    expect(documentNameKey('constructor')).toBeNull();
  });
});

describe('checklist items carry server-derived claim fields', () => {
  it('uses hasNumber/hasExpiry and the allowed licence classes of each item', () => {
    const model = checklistModel(
      checklist({
        items: [{ ...checklist().items[0]!, documentType: 'DRIVING_LICENCE', licenceClassesAllowed: ['LTV'] }, { ...checklist().items[1]! }],
      }),
      application(),
      [],
      [],
    );
    expect(model.items.map((i) => i.hints)).toEqual([
      { number: true, licenceClass: true, issuedOn: true, expiresOn: true },
      { number: false, licenceClass: false, issuedOn: false, expiresOn: false },
    ]);
  });
});
