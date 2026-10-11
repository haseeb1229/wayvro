/**
 * Phase-2 closure against REAL PostgreSQL (restricted roles), Valkey and SeaweedFS:
 * - per-district document claims (R46): the checklist carries the server-authoritative ENABLED districts of the
 *   application's city; a per-district claim needs one of them (disabled or other-city districts refused); a district
 *   never goes on an ordinary document; the claim round-trips; a renewal keeps the original district;
 * - appeal of a rejected document renewal: only the owner, only the latest REJECT, a different KYC senior decides (never
 *   the decider), OVERTURNED gives a fresh human review (no automatic validation), UPHELD keeps it rejected.
 * Synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { currentDocument } from '@wayvro/legal-content';
import {
  DocumentRenewalSchema,
  DriverApplicationSchema,
  DriverComplianceSchema,
  RequirementChecklistSchema,
  VehicleCreatedSchema,
  type DriverCompliance,
} from '@wayvro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewKit, type Ready } from './review-helpers.js';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, post, signIn, startApi, type Harness } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let reviewer: Staff;
let senior: Staff;
let senior2: Staff;
let r: ReturnType<typeof reviewKit>;
beforeAll(async () => {
  h = await startApi({ env: { ...STAFF_ENV, EVIDENCE_SLOTS_PER_10_MIN: '100' }, vault: true });
  kit = staffKit(h);
  r = reviewKit(h, kit);
  const admins = await kit.bootstrapAdmins(2);
  reviewer = await kit.staffWithRole(admins, 'KYC_REVIEWER', 'Closure Reviewer');
  senior = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Closure Senior One');
  senior2 = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Closure Senior Two');
  // a disabled district in the same city and an enabled district of another (not launched) city — synthetic catalogue rows
  await h.owner.query(
    `insert into catalog.cities (code, name_en, name_ur, status) values ('ISB', 'Islamabad', 'اسلام آباد', 'DISABLED') on conflict do nothing`,
  );
  await h.owner.query(
    `insert into catalog.districts (code, city_code, name_en, name_ur, status) values ('LHR-CLOSED', 'LHR', 'Closed District', 'بند ضلع', 'DISABLED'), ('ISB-CAPITAL', 'ISB', 'Capital', 'دارالحکومت', 'ENABLED') on conflict do nothing`,
  );
}, 300_000);
afterAll(async () => {
  await h.close();
});

const errorOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error;
/** A consumer with a DRAFT application in LHR and one car (no documents yet). */
async function draftWithVehicle(): Promise<{ accessToken: string; appId: string; vehicleId: string }> {
  const s = await signIn(h);
  const t = bearer(s.accessToken);
  for (const k of ['TERMS', 'PRIVACY', 'DRIVER_PARTNER_AGREEMENT', 'BIOMETRIC_KYC_NOTICE'] as const) {
    const d = currentDocument(k, 'en', new Date());
    if (!d) throw new Error(k);
    await h.inject(post('/v1/account/consents', { policyKey: k, version: d.version, locale: 'en', contentSha256: d.contentSha256, action: 'ACCEPTED' }, t));
  }
  await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true }, t));
  const app = DriverApplicationSchema.parse(
    (await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['CAR'] }, t))).json(),
  );
  const vehicle = await h.inject(
    post(
      `/v1/driver-onboarding/applications/${app.id}/vehicles`,
      {
        plate: `LE-${randomBytes(3).toString('hex')}`,
        make: 'Synthetic',
        model: 'T',
        modelYear: 2020,
        colour: 'White',
        serviceCategory: 'CAR',
        ownershipType: 'REGISTERED_OWNER',
      },
      t,
    ),
  );
  expect(vehicle.statusCode, vehicle.body).toBe(201);
  return { accessToken: s.accessToken, appId: app.id, vehicleId: VehicleCreatedSchema.parse(vehicle.json()).vehicleId };
}
const compliance = async (a: Ready): Promise<DriverCompliance> =>
  DriverComplianceSchema.parse((await r.get('/v1/driver/compliance', bearer(a.s.accessToken))).json());

describe('per-district document claims (R46)', () => {
  it('districts come from the server; a per-district claim needs an enabled district of the city; ordinary documents take none', async () => {
    const fresh = await draftWithVehicle();
    const checklist = RequirementChecklistSchema.parse(
      (await r.get(`/v1/driver-onboarding/applications/${fresh.appId}/requirements`, bearer(fresh.accessToken))).json(),
    );
    expect(checklist.districts).toEqual([{ code: 'LHR-LAHORE', nameEn: 'Lahore District', nameUr: 'ضلع لاہور' }]);
    expect(checklist.items.find((i) => i.documentType === 'ROUTE_PERMIT')?.perDistrict).toBe(true);
    const claim = (body: Record<string, unknown>) =>
      h.inject(post(`/v1/driver-onboarding/applications/${fresh.appId}/documents`, body, bearer(fresh.accessToken)));
    const permit = { documentType: 'ROUTE_PERMIT', vehicleId: fresh.vehicleId, number: 'RP-SYNTH-1', expiresOn: '2030-01-01' };
    expect(errorOf(await claim(permit))?.code).toBe('WAYVRO_E_VALIDATION'); // district required
    expect(errorOf(await claim({ ...permit, districtCode: 'LHR-CLOSED' }))?.code).toBe('WAYVRO_E_VALIDATION'); // disabled
    expect(errorOf(await claim({ ...permit, districtCode: 'ISB-CAPITAL' }))?.code).toBe('WAYVRO_E_VALIDATION'); // other city
    expect(errorOf(await claim({ documentType: 'SELFIE', districtCode: 'LHR-LAHORE' }))?.code).toBe('WAYVRO_E_VALIDATION'); // not per-district
    expect((await claim({ ...permit, districtCode: 'LHR-LAHORE' })).statusCode).toBe(201);
    const view = DriverApplicationSchema.parse((await r.get('/v1/driver-onboarding/applications/current', bearer(fresh.accessToken))).json());
    expect(view.documents.find((d) => d.documentType === 'ROUTE_PERMIT')?.districtCode).toBe('LHR-LAHORE');
  });

  it('a renewal keeps the district of the document it renews', async () => {
    const d = await r.approvedDriver(reviewer);
    const vehicle = (
      await h.owner.query<{ vehicle_id: string }>(`select vehicle_id from compliance.vehicle_affiliations where driver_application_id = $1`, [d.appId])
    ).rows[0]?.vehicle_id;
    const permit = randomUUID();
    await h.owner.query(
      `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, vehicle_id, district_code, number_last4, status, claimed_expires_on, expires_on)
       values ($1, 'ROUTE_PERMIT', 'VEHICLE', $2, $3, 'LHR-LAHORE', '0001', 'VALID', '2027-01-01', '2027-01-01')`,
      [permit, d.appId, vehicle],
    );
    const started = await h.inject(post(`/v1/driver/documents/${permit}/renewals`, { number: 'RP-SYNTH-2', expiresOn: '2031-01-01' }, bearer(d.s.accessToken)));
    expect(started.statusCode, started.body).toBe(201);
    const renewal = DocumentRenewalSchema.parse(started.json());
    expect(
      (await h.owner.query<{ district_code: string }>(`select district_code from compliance.compliance_documents where id = $1`, [renewal.renewalDocumentId]))
        .rows[0]?.district_code,
    ).toBe('LHR-LAHORE');
    const shown = (await compliance(d)).documents.find((x) => x.id === permit);
    expect(shown).toMatchObject({ districtCode: 'LHR-LAHORE', renewal: { renewalDocumentId: renewal.renewalDocumentId } });
  });
});

describe('appeal of a rejected document renewal', () => {
  async function rejectedRenewal(): Promise<{ d: Ready; renewalId: string; decisionId: string }> {
    const d = await r.approvedDriver(reviewer);
    const cnic = (await compliance(d)).documents.find((x) => x.documentType === 'CNIC');
    const renewal = DocumentRenewalSchema.parse(
      (await h.inject(post(`/v1/driver/documents/${cnic?.id ?? ''}/renewals`, { expiresOn: '2036-01-01' }, bearer(d.s.accessToken)))).json(),
    );
    const ids = [
      await r.acceptedEvidence(d.s.accessToken, d.appId, renewal.renewalDocumentId, 'CNIC_FRONT'),
      await r.acceptedEvidence(d.s.accessToken, d.appId, renewal.renewalDocumentId, 'CNIC_BACK'),
    ];
    expect((await h.inject(post(`/v1/driver/documents/${renewal.renewalDocumentId}/renewal-submission`, {}, bearer(d.s.accessToken)))).statusCode).toBe(200);
    const caseId =
      (
        await h.owner.query<{ id: string }>(`select id from compliance.review_cases where compliance_document_id = $1 and status = 'OPEN'`, [
          renewal.renewalDocumentId,
        ])
      ).rows[0]?.id ?? '';
    const c = await r.claim(reviewer, caseId);
    const res = await r.decide(reviewer, caseId, {
      expectedVersion: c.version,
      decision: 'REJECT',
      reasonCodes: ['DOCUMENT_FORGERY_SUSPECTED'],
      checklist: r.allConfirmed,
      identityMatch: 'NOT_MATCHING',
      evidenceIds: ids,
    });
    expect(res.statusCode, res.body).toBe(201);
    return { d, renewalId: renewal.renewalDocumentId, decisionId: res.json<{ decisionId: string }>().decisionId };
  }
  const appeal = (d: Ready, reviewDecisionId: string) =>
    h.inject(post('/v1/account/appeals', { reviewDecisionId, statement: 'This renewed card is my own synthetic document.' }, bearer(d.s.accessToken)));

  it('the owner appeals; the decider cannot decide; OVERTURNED reopens a fresh human review without validating anything', async () => {
    const { d, renewalId, decisionId } = await rejectedRenewal();
    const before = (await compliance(d)).documents.find((x) => x.documentType === 'CNIC')?.renewal;
    expect(before).toMatchObject({ status: 'REJECTED', appealableDecisionId: decisionId, appealStatus: null });
    const stranger = await r.approvedDriver(reviewer);
    expect((await appeal(stranger, decisionId)).statusCode).toBe(404);
    const created = await appeal(d, decisionId);
    expect(created.statusCode, created.body).toBe(201);
    expect((await appeal(d, decisionId)).statusCode).toBe(409); // one open appeal per decision
    const appealId = created.json<{ id: string }>().id;
    const after = (await compliance(d)).documents.find((x) => x.documentType === 'CNIC')?.renewal;
    expect(after).toMatchObject({ appealableDecisionId: null, appealStatus: 'SUBMITTED' });
    // the original decider (a KYC reviewer, not a senior) can never decide the appeal
    const queue = (await r.get('/v1/admin/appeals', kit.sb(senior))).json<{ items: Array<{ id: string; cityCode: string | null }> }>();
    expect(queue.items.find((i) => i.id === appealId)?.cityCode).toBe('LHR');
    expect(
      (await kit.privileged(reviewer, `/v1/admin/appeals/${appealId}/decisions`, { outcome: 'OVERTURNED', reasonCode: 'REVIEW_ERROR_CORRECTED' })).statusCode,
    ).toBe(403);
    const overturned = await kit.privileged(senior, `/v1/admin/appeals/${appealId}/decisions`, { outcome: 'OVERTURNED', reasonCode: 'REVIEW_ERROR_CORRECTED' });
    expect(overturned.statusCode, overturned.body).toBe(200);
    const reviewCaseId = overturned.json<{ reviewCaseId: string }>().reviewCaseId;
    const fresh = (await h.owner.query<{ kind: string; status: string }>(`select kind, status from compliance.review_cases where id = $1`, [reviewCaseId]))
      .rows[0];
    expect(fresh).toEqual({ kind: 'DOCUMENT_RENEWAL', status: 'OPEN' });
    expect((await h.owner.query<{ status: string }>(`select status from compliance.compliance_documents where id = $1`, [renewalId])).rows[0]?.status).toBe(
      'SUBMITTED',
    );
    expect((await compliance(d)).documents.find((x) => x.documentType === 'CNIC')?.renewal).toMatchObject({ status: 'IN_REVIEW', appealStatus: 'OVERTURNED' });
  });

  it('UPHELD keeps the renewal rejected; a NEEDS_INFO renewal is not appealable', async () => {
    const { d, renewalId, decisionId } = await rejectedRenewal();
    const appealId = (await appeal(d, decisionId)).json<{ id: string }>().id;
    const upheld = await kit.privileged(senior2, `/v1/admin/appeals/${appealId}/decisions`, { outcome: 'UPHELD', reasonCode: 'ORIGINAL_DECISION_CONFIRMED' });
    expect(upheld.statusCode, upheld.body).toBe(200);
    expect((await h.owner.query<{ status: string }>(`select status from compliance.compliance_documents where id = $1`, [renewalId])).rows[0]?.status).toBe(
      'REJECTED',
    );
    expect((await compliance(d)).documents.find((x) => x.documentType === 'CNIC')?.renewal).toMatchObject({
      status: 'REJECTED',
      appealStatus: 'UPHELD',
      appealableDecisionId: null,
    });
    // NEEDS_INFO on another renewal: not a REJECT, so no appeal (the driver starts a new renewal)
    const other = await r.approvedDriver(reviewer);
    const licence = (await compliance(other)).documents.find((x) => x.documentType === 'DRIVING_LICENCE');
    const renewal = DocumentRenewalSchema.parse(
      (
        await h.inject(
          post(`/v1/driver/documents/${licence?.id ?? ''}/renewals`, { licenceClass: 'LTV', expiresOn: '2036-06-30' }, bearer(other.s.accessToken)),
        )
      ).json(),
    );
    const ids = [
      await r.acceptedEvidence(other.s.accessToken, other.appId, renewal.renewalDocumentId, 'LICENCE_FRONT'),
      await r.acceptedEvidence(other.s.accessToken, other.appId, renewal.renewalDocumentId, 'LICENCE_BACK'),
    ];
    await h.inject(post(`/v1/driver/documents/${renewal.renewalDocumentId}/renewal-submission`, {}, bearer(other.s.accessToken)));
    const caseId =
      (
        await h.owner.query<{ id: string }>(`select id from compliance.review_cases where compliance_document_id = $1 and status = 'OPEN'`, [
          renewal.renewalDocumentId,
        ])
      ).rows[0]?.id ?? '';
    const c = await r.claim(reviewer, caseId);
    const info = await r.decide(reviewer, caseId, {
      expectedVersion: c.version,
      decision: 'NEEDS_INFO',
      reasonCodes: ['LICENCE_IMAGE_UNREADABLE'],
      checklist: r.allConfirmed,
      evidenceIds: ids,
    });
    expect(info.statusCode, info.body).toBe(201);
    expect((await compliance(other)).documents.find((x) => x.documentType === 'DRIVING_LICENCE')?.renewal).toMatchObject({
      status: 'REJECTED',
      appealableDecisionId: null,
    });
    expect((await appeal(other, info.json<{ decisionId: string }>().decisionId)).statusCode).toBe(409);
  });
});
