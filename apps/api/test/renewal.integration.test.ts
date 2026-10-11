/**
 * P2.8 document renewal (D03/R02–R06) through the API, against REAL PostgreSQL (restricted roles), Valkey and SeaweedFS:
 * a verified driver renews an expiring document as a NEW document row with its own evidence; only a human reviewer's
 * APPROVE on the DOCUMENT_RENEWAL case makes it VALID, supersedes the renewed document and lifts an EXPIRED driver
 * profile; REJECT/NEEDS_INFO leave the renewed document untouched. Evidence views follow the claimed renewal case;
 * duplicate numbers follow the senior + second-approver rule. The worker's expiry step is SIMULATED in the database
 * exactly as apps/worker does it (covered there). Synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { DocumentRenewalSchema, DriverComplianceSchema, type DriverCompliance } from '@wayvro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewKit, type Ready } from './review-helpers.js';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, post, startApi, type Harness } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let reviewer: Staff;
let reviewer2: Staff;
let senior: Staff;
let senior2: Staff;
let r: ReturnType<typeof reviewKit>;
beforeAll(async () => {
  h = await startApi({ env: { ...STAFF_ENV, EVIDENCE_SLOTS_PER_10_MIN: '100' }, vault: true });
  kit = staffKit(h);
  r = reviewKit(h, kit);
  const admins = await kit.bootstrapAdmins(2);
  reviewer = await kit.staffWithRole(admins, 'KYC_REVIEWER', 'Renewal Reviewer One');
  reviewer2 = await kit.staffWithRole(admins, 'KYC_REVIEWER', 'Renewal Reviewer Two');
  senior = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Renewal Senior One');
  senior2 = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Renewal Senior Two');
}, 300_000);
afterAll(async () => {
  await h.close();
});

const compliance = async (a: Ready): Promise<DriverCompliance> =>
  DriverComplianceSchema.parse((await r.get('/v1/driver/compliance', bearer(a.s.accessToken))).json());
const docOf = (view: DriverCompliance, type: string) => {
  const d = view.documents.find((x) => x.documentType === type);
  if (!d) throw new Error(`no ${type}`);
  return d;
};
const start = (a: Ready, documentId: string, body: Record<string, unknown>) =>
  h.inject(post(`/v1/driver/documents/${documentId}/renewals`, body, bearer(a.s.accessToken)));
const submit = (a: Ready, renewalId: string) => h.inject(post(`/v1/driver/documents/${renewalId}/renewal-submission`, {}, bearer(a.s.accessToken)));
const caseOf = async (renewalId: string): Promise<string> =>
  (await h.owner.query<{ id: string }>(`select id from compliance.review_cases where compliance_document_id = $1 and status = 'OPEN'`, [renewalId])).rows[0]
    ?.id ?? '';
const approveBody = (version: number, evidenceIds: string[], signalResolutions?: Array<{ signalId: string; outcome: string }>) => ({
  expectedVersion: version,
  decision: 'APPROVE',
  reasonCodes: ['ALL_CHECKS_CONFIRMED'],
  checklist: r.allConfirmed,
  identityMatch: 'CONFIRMED_BY_REVIEWER',
  evidenceIds,
  ...(signalResolutions ? { signalResolutions } : {}),
});

describe('renewal start and submission (owner side)', () => {
  it('validates the renewed document, keeps one open renewal, requires its evidence and opens a DOCUMENT_RENEWAL case', async () => {
    const a = await r.approvedDriver(reviewer);
    const before = await compliance(a);
    expect(before.applicationId).toBe(a.appId);
    const licence = docOf(before, 'DRIVING_LICENCE');
    expect(licence).toMatchObject({ status: 'VALID', renewal: null, hasNumber: true, hasExpiry: true });
    expect(docOf(before, 'SELFIE')).toMatchObject({ hasNumber: false, hasExpiry: false });
    // a document without expiry cannot be renewed; another account's document is unknown; the new expiry is in the future
    expect((await start(a, docOf(before, 'SELFIE').id, { expiresOn: '2036-01-01' })).statusCode).toBe(409);
    const other = await r.approvedDriver(reviewer);
    expect((await start(other, licence.id, { expiresOn: '2036-01-01' })).statusCode).toBe(404);
    expect((await start(a, licence.id, { expiresOn: '2020-01-01', licenceClass: 'LTV' })).statusCode).toBe(400);
    const started = await start(a, licence.id, { number: `LHR-${randomBytes(3).toString('hex')}`, licenceClass: 'LTV', expiresOn: '2036-06-30' });
    expect(started.statusCode, started.body).toBe(201);
    const renewal = DocumentRenewalSchema.parse(started.json());
    expect(renewal).toMatchObject({ applicationId: a.appId, renews: licence.id, documentType: 'DRIVING_LICENCE', status: 'DRAFT' });
    expect(renewal.evidenceKinds).toEqual(expect.arrayContaining(['LICENCE_FRONT', 'LICENCE_BACK']));
    expect((await start(a, licence.id, { expiresOn: '2036-06-30', licenceClass: 'LTV' })).statusCode).toBe(409); // one open renewal
    // the renewal is attached to the renewed document, not listed as a document of its own
    const during = await compliance(a);
    expect(docOf(during, 'DRIVING_LICENCE')).toMatchObject({
      id: licence.id,
      renewal: { renewalDocumentId: renewal.renewalDocumentId, status: 'DRAFT', evidenceKinds: renewal.evidenceKinds },
    });
    expect(during.documents.filter((d) => d.documentType === 'DRIVING_LICENCE')).toHaveLength(1);
    // submission needs every evidence kind ACCEPTED
    const missing = await submit(a, renewal.renewalDocumentId);
    expect(missing.statusCode).toBe(409);
    expect(missing.json<{ error?: { details?: { reasonCodes?: string[] } } }>().error?.details?.reasonCodes).toEqual(
      expect.arrayContaining(['MISSING_EVIDENCE_LICENCE_FRONT', 'MISSING_EVIDENCE_LICENCE_BACK']),
    );
    await r.acceptedEvidence(a.s.accessToken, a.appId, renewal.renewalDocumentId, 'LICENCE_FRONT');
    // a mistaken upload can still be discarded before submission (open renewal of a verified driver)
    const mistaken = await r.acceptedEvidence(a.s.accessToken, a.appId, renewal.renewalDocumentId, 'LICENCE_BACK');
    const discarded = await h.inject({
      method: 'DELETE',
      url: `/v1/driver-onboarding/evidence-uploads/${mistaken}`,
      headers: { ...bearer(a.s.accessToken), 'idempotency-key': randomUUID() },
    });
    expect(discarded.statusCode, discarded.body).toBe(204);
    // an ACCEPTED object is crypto-shredded on discard (its wrapped DEK is gone)
    expect((await h.owner.query(`select status, wrapped_dek from vault.evidence_objects where id = $1`, [mistaken])).rows).toEqual([
      { status: 'DISCARDED', wrapped_dek: null },
    ]);
    await r.acceptedEvidence(a.s.accessToken, a.appId, renewal.renewalDocumentId, 'LICENCE_BACK');
    // evidence for a VALID document (not a renewal) of a verified driver is refused
    const refused = await h.inject(
      post(
        `/v1/driver-onboarding/applications/${a.appId}/evidence-uploads`,
        { documentId: licence.id, kind: 'LICENCE_FRONT', captureSource: 'IN_APP_CAMERA', byteSize: 256, mime: 'image/jpeg' },
        bearer(a.s.accessToken),
      ),
    );
    expect(refused.statusCode).toBe(409);
    const submitted = await submit(a, renewal.renewalDocumentId);
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(DocumentRenewalSchema.parse(submitted.json()).status).toBe('IN_REVIEW');
    expect((await submit(a, renewal.renewalDocumentId)).statusCode).toBe(409); // already under review
    expect(await caseOf(renewal.renewalDocumentId)).not.toBe('');
    // no more uploads once under review; a foreign renewal id is unknown
    const late = await h.inject(
      post(
        `/v1/driver-onboarding/applications/${a.appId}/evidence-uploads`,
        { documentId: renewal.renewalDocumentId, kind: 'LICENCE_FRONT', captureSource: 'IN_APP_CAMERA', byteSize: 256, mime: 'image/jpeg' },
        bearer(a.s.accessToken),
      ),
    );
    expect(late.statusCode).toBe(409);
    expect((await submit(other, renewal.renewalDocumentId)).statusCode).toBe(404);
    expect(docOf(await compliance(a), 'DRIVING_LICENCE').renewal?.status).toBe('IN_REVIEW');
  });
});

describe('renewal review (D03/R02–R06)', () => {
  it('APPROVE needs the renewal evidence, supersedes the renewed document and lifts an EXPIRED profile', async () => {
    const a = await r.approvedDriver(reviewer);
    const licence = docOf(await compliance(a), 'DRIVING_LICENCE');
    const renewal = DocumentRenewalSchema.parse((await start(a, licence.id, { licenceClass: 'LTV', expiresOn: '2036-06-30' })).json());
    const front = await r.acceptedEvidence(a.s.accessToken, a.appId, renewal.renewalDocumentId, 'LICENCE_FRONT');
    const back = await r.acceptedEvidence(a.s.accessToken, a.appId, renewal.renewalDocumentId, 'LICENCE_BACK');
    expect((await submit(a, renewal.renewalDocumentId)).statusCode).toBe(200);
    // the worker's expiry step: the old licence expired, the mandatory document holds the profile EXPIRED
    await h.owner.query(`update compliance.compliance_documents set status = 'EXPIRED', version = version + 1 where id = $1`, [licence.id]);
    await h.owner.query(`update compliance.driver_profiles set state = 'EXPIRED', version = version + 1 where application_id = $1`, [a.appId]);
    expect((await compliance(a)).profile.state).toBe('EXPIRED');
    const caseId = await caseOf(renewal.renewalDocumentId);
    const queue = (await r.get('/v1/admin/review-cases?status=OPEN', kit.sb(reviewer2))).json<{ items: Array<{ id: string; kind: string }> }>();
    expect(queue.items.find((i) => i.id === caseId)?.kind).toBe('DOCUMENT_RENEWAL');
    const c = await r.claim(reviewer2, caseId);
    expect(c).toMatchObject({ kind: 'DOCUMENT_RENEWAL', subjectDocumentId: renewal.renewalDocumentId, application: { id: a.appId, state: 'VERIFIED' } });
    expect(c.documents.map((d) => d.id)).toEqual(expect.arrayContaining([licence.id, renewal.renewalDocumentId]));
    expect(c.evidence.map((e) => e.evidenceId)).toEqual(expect.arrayContaining([front, back]));
    expect(c.decisions.length).toBeGreaterThan(0); // the initial approval stays visible to the reviewer
    // evidence views follow the claimed renewal case (via the driver profile)
    expect((await kit.privileged(reviewer2, '/v1/admin/evidence-views', { evidenceId: front, reasonCode: 'CASE_REVIEW' })).statusCode).toBe(201);
    expect((await kit.privileged(reviewer, '/v1/admin/evidence-views', { evidenceId: front, reasonCode: 'CASE_REVIEW' })).statusCode).toBe(403);
    // relying only on the old evidence is not enough
    expect((await r.decide(reviewer2, caseId, approveBody(c.version, a.evidenceIds.slice(3, 5)))).statusCode).toBe(400);
    const approved = await r.decide(reviewer2, caseId, approveBody(c.version, [front, back]));
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json()).toMatchObject({ caseStatus: 'DECIDED', applicationState: 'VERIFIED', pendingSecondApproval: false });
    const docs = await h.owner.query<{ id: string; status: string; expires_on: string | null }>(
      `select id, status, to_char(expires_on, 'YYYY-MM-DD') expires_on from compliance.compliance_documents where id = any($1::uuid[]) order by created_at`,
      [[licence.id, renewal.renewalDocumentId]],
    );
    expect(docs.rows).toEqual([
      { id: licence.id, status: 'SUPERSEDED', expires_on: '2031-06-30' },
      { id: renewal.renewalDocumentId, status: 'VALID', expires_on: '2036-06-30' },
    ]);
    const after = await compliance(a);
    expect(after.profile.state).toBe('ACTIVE_ELIGIBLE');
    expect(docOf(after, 'DRIVING_LICENCE')).toMatchObject({ id: renewal.renewalDocumentId, status: 'VALID', expiresOn: '2036-06-30', renewal: null });
    const events = await h.owner.query<{ type: string; account_id: string }>(`select type, account_id from platform.outbox_events where aggregate_id = $1`, [
      renewal.renewalDocumentId,
    ]);
    expect(events.rows).toEqual([{ type: 'driver.document.decided.v1', account_id: a.accountId }]);
    // a renewal case is decided once
    expect((await h.inject(post(`/v1/admin/review-cases/${caseId}/claim`, {}, kit.sb(reviewer2)))).statusCode).toBe(409);
  });

  it('REJECT closes the renewal as REJECTED and leaves the renewed document VALID; a new renewal may follow', async () => {
    const a = await r.approvedDriver(reviewer);
    const cnic = docOf(await compliance(a), 'CNIC');
    const renewal = DocumentRenewalSchema.parse((await start(a, cnic.id, { expiresOn: '2036-01-01' })).json());
    const ids = [
      await r.acceptedEvidence(a.s.accessToken, a.appId, renewal.renewalDocumentId, 'CNIC_FRONT'),
      await r.acceptedEvidence(a.s.accessToken, a.appId, renewal.renewalDocumentId, 'CNIC_BACK'),
    ];
    expect((await submit(a, renewal.renewalDocumentId)).statusCode).toBe(200);
    const caseId = await caseOf(renewal.renewalDocumentId);
    const c = await r.claim(reviewer2, caseId);
    const rejected = await r.decide(reviewer2, caseId, {
      expectedVersion: c.version,
      decision: 'REJECT',
      reasonCodes: ['DOCUMENT_FORGERY_SUSPECTED'],
      checklist: r.allConfirmed,
      identityMatch: 'NOT_MATCHING',
      evidenceIds: ids,
    });
    expect(rejected.statusCode, rejected.body).toBe(201);
    const view = await compliance(a);
    expect(docOf(view, 'CNIC')).toMatchObject({ id: cnic.id, status: 'VALID', renewal: { renewalDocumentId: renewal.renewalDocumentId, status: 'REJECTED' } });
    expect(view.profile.state).toBe('ACTIVE_ELIGIBLE');
    const again = await start(a, cnic.id, { expiresOn: '2036-01-01' });
    expect(again.statusCode, again.body).toBe(201);
    expect(docOf(await compliance(a), 'CNIC').renewal).toMatchObject({
      renewalDocumentId: again.json<{ renewalDocumentId: string }>().renewalDocumentId,
      status: 'DRAFT',
    });
  });

  it('a renewed number matching another account raises a signal: senior clears it and a different senior second-approves', async () => {
    const other = await r.approvedDriver(reviewer);
    const otherNumber = `LHR-${randomBytes(3).toString('hex')}`;
    const otherLicence = docOf(await compliance(other), 'DRIVING_LICENCE');
    const otherRenewal = DocumentRenewalSchema.parse(
      (await start(other, otherLicence.id, { number: otherNumber, licenceClass: 'LTV', expiresOn: '2036-06-30' })).json(),
    );
    const a = await r.approvedDriver(reviewer);
    const licence = docOf(await compliance(a), 'DRIVING_LICENCE');
    const renewal = DocumentRenewalSchema.parse((await start(a, licence.id, { number: otherNumber, licenceClass: 'LTV', expiresOn: '2036-06-30' })).json());
    expect(
      (
        await h.owner.query(`select 1 from compliance.duplicate_signals where subject_document_id = $1 and matched_document_id = $2 and status = 'OPEN'`, [
          renewal.renewalDocumentId,
          otherRenewal.renewalDocumentId,
        ])
      ).rowCount,
    ).toBe(1);
    const ids = [
      await r.acceptedEvidence(a.s.accessToken, a.appId, renewal.renewalDocumentId, 'LICENCE_FRONT'),
      await r.acceptedEvidence(a.s.accessToken, a.appId, renewal.renewalDocumentId, 'LICENCE_BACK'),
    ];
    expect((await submit(a, renewal.renewalDocumentId)).statusCode).toBe(200);
    const caseId = await caseOf(renewal.renewalDocumentId);
    const queue = (await r.get('/v1/admin/review-cases?status=OPEN', kit.sb(reviewer2))).json<{ items: Array<{ id: string; openSignals: number }> }>();
    expect(queue.items.find((i) => i.id === caseId)?.openSignals).toBe(1);
    let c = await r.claim(reviewer2, caseId);
    const signals = c.duplicateSignals.filter((s) => s.status === 'OPEN').map((s) => ({ signalId: s.id, outcome: 'CLEARED' }));
    expect(signals).toHaveLength(1);
    expect((await r.decide(reviewer2, caseId, approveBody(c.version, ids, signals))).statusCode).toBe(403);
    await h.inject(post(`/v1/admin/review-cases/${caseId}/release`, {}, kit.sb(reviewer2)));
    c = await r.claim(senior, caseId);
    const pending = await r.decide(senior, caseId, approveBody(c.version, ids, signals));
    expect(pending.statusCode, pending.body).toBe(201);
    expect(pending.json()).toMatchObject({ pendingSecondApproval: true, caseStatus: 'ESCALATED' });
    expect(docOf(await compliance(a), 'DRIVING_LICENCE').renewal?.status).toBe('IN_REVIEW');
    const decisionId = pending.json<{ decisionId: string }>().decisionId;
    expect((await kit.privileged(senior, `/v1/admin/review-decisions/${decisionId}/second-approvals`, { outcome: 'APPROVED' })).statusCode).toBe(403);
    const second = await kit.privileged(senior2, `/v1/admin/review-decisions/${decisionId}/second-approvals`, { outcome: 'APPROVED' });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ caseStatus: 'DECIDED', applicationState: 'VERIFIED' });
    expect(docOf(await compliance(a), 'DRIVING_LICENCE')).toMatchObject({ id: renewal.renewalDocumentId, status: 'VALID' });
    expect(
      (await h.owner.query(`select 1 from compliance.duplicate_signals where subject_document_id = $1 and status = 'CLEARED'`, [renewal.renewalDocumentId]))
        .rowCount,
    ).toBe(1);
  });
});
