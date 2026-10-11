/**
 * P2.6 evidence vault through the API against REAL PostgreSQL (restricted roles), Valkey and SeaweedFS (S3):
 * SEC-URL (slot → quarantine-only signed PUT → completion → PROCESSING + job enqueued), SEC-VAULT (no storage key in
 * any response or non-vault table; the API role cannot read vault.*), slot rules (selfie camera-only, challenge only for
 * a selfie, kind must belong to the document type, consent first, foreign ids 404), size mismatch, expiry, discard,
 * per-account slot rate, accessible capture challenges, submission (itemised missing evidence, pinned set), and staff
 * evidence views (permission + step-up + city scope + conflict, one-time token, no-store stream, replay 410, integrity
 * failure, append-only access log). The worker pipeline (scan/sanitise/encrypt) is covered by apps/worker tests; here
 * processed evidence is SIMULATED by sealing synthetic bytes exactly as the worker does. Synthetic data only.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DriverApplicationSchema, EvidenceListSchema, EvidenceUploadSlotSchema, EvidenceUploadStatusSchema, VehicleCreatedSchema } from '@wayvro/contracts';
import { sealEvidence } from '@wayvro/field-crypto';
import { currentDocument } from '@wayvro/legal-content';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, post, signIn, startApi, type Harness, type SignedIn } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let admins: Staff[];
beforeAll(async () => {
  h = await startApi({ env: { ...STAFF_ENV, EVIDENCE_SLOTS_PER_10_MIN: '8' }, vault: true });
  kit = staffKit(h);
  admins = await kit.bootstrapAdmins(2);
}, 120_000);
afterAll(async () => {
  await h.close();
});

const errorOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string; details?: { reasonCodes?: string[] } } }).error;
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();
const syntheticJpeg = (n = 2048) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n - 4)]);

async function applicant(): Promise<{ s: SignedIn; appId: string; docs: Record<string, string> }> {
  const s = await signIn(h);
  for (const k of ['TERMS', 'PRIVACY', 'DRIVER_PARTNER_AGREEMENT', 'BIOMETRIC_KYC_NOTICE'] as const) {
    const d = currentDocument(k, 'en', new Date());
    if (!d) throw new Error(k);
    await h.inject(
      post(
        '/v1/account/consents',
        { policyKey: k, version: d.version, locale: 'en', contentSha256: d.contentSha256, action: 'ACCEPTED' },
        bearer(s.accessToken),
      ),
    );
  }
  await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true }, bearer(s.accessToken)));
  const t = bearer(s.accessToken);
  const app = DriverApplicationSchema.parse(
    (await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['CAR'] }, t))).json(),
  );
  const docs: Record<string, string> = {};
  for (const type of ['SELFIE', 'CNIC']) {
    const res = await h.inject(post(`/v1/driver-onboarding/applications/${app.id}/documents`, { documentType: type }, t));
    docs[type] = res.json<{ documentId: string }>().documentId;
  }
  return { s, appId: app.id, docs };
}
const consent = (a: { s: SignedIn; appId: string }) => h.inject(post(`/v1/driver-onboarding/applications/${a.appId}/consent`, {}, bearer(a.s.accessToken)));
const slot = (a: { s: SignedIn; appId: string }, body: Record<string, unknown>) =>
  h.inject(post(`/v1/driver-onboarding/applications/${a.appId}/evidence-uploads`, body, bearer(a.s.accessToken)));
const quarantineKeyOf = (url: string) => /(q\/[0-9a-f]{32})$/.exec(new URL(url).pathname)?.[1] ?? '';

/** Marks an upload AVAILABLE exactly as the worker would after scanning and sanitising (synthetic bytes). */
async function simulateProcessed(uploadId: string, image: Buffer): Promise<string> {
  const vaultKey = `v/${randomBytes(16).toString('hex')}`;
  const sealed = sealEvidence(h.runtime.cipher, uploadId, image);
  await h.storage?.putObject({ area: 'vault', key: vaultKey, body: sealed.content, contentType: 'application/octet-stream' });
  await h.owner.query(
    `update vault.evidence_objects set status = 'AVAILABLE', uploaded_at = now(), processed_at = now(), source_byte_size = $2, source_sha256 = $3,
            canonical_sha256 = $3, canonical_format = 'JPEG', canonical_byte_size = $2, pixel_width = 640, pixel_height = 480, wrapped_dek = $4,
            content_envelope_version = 1, vault_key = $5 where id = $1`,
    [uploadId, image.length, sha256(image), sealed.wrappedDek, vaultKey],
  );
  return vaultKey;
}

describe('upload slots, quarantine PUT and completion (SEC-URL, SEC-VAULT)', () => {
  it('slot → signed PUT → completion → PROCESSING with an enqueued job; no storage key outside the upload URL', async () => {
    const a = await applicant();
    expect(
      errorOf(await slot(a, { documentId: a.docs['CNIC'], kind: 'CNIC_FRONT', captureSource: 'GALLERY_IMPORT', byteSize: 10, mime: 'image/jpeg' }))?.code,
    ).toBe('WAYVRO_E_CONFLICT'); // DRAFT: consent first
    expect((await consent(a)).statusCode).toBe(200);
    const image = syntheticJpeg();
    const res = await slot(a, { documentId: a.docs['CNIC'], kind: 'CNIC_FRONT', captureSource: 'GALLERY_IMPORT', byteSize: image.length, mime: 'image/jpeg' });
    expect(res.statusCode, res.body).toBe(201);
    const s = EvidenceUploadSlotSchema.parse(res.json());
    expect(s.upload.headers).toEqual({ 'content-type': 'image/jpeg', 'content-length': String(image.length) });
    expect(res.body.replace(s.upload.url.replaceAll('/', '\\/'), '').replace(s.upload.url, '')).not.toMatch(/q\/[0-9a-f]{32}|v\/[0-9a-f]{32}|vault/);
    const state = (await h.inject({ method: 'GET', url: '/v1/driver-onboarding/applications/current', headers: bearer(a.s.accessToken) })).json<{
      state: string;
    }>().state;
    expect(state).toBe('DOCUMENTS_PENDING');
    // nothing to complete before the PUT
    expect(
      errorOf(await h.inject(post(`/v1/driver-onboarding/evidence-uploads/${s.uploadId}/completion`, {}, bearer(a.s.accessToken))))?.details?.reasonCodes,
    ).toEqual(['UPLOAD_NOT_RECEIVED']);
    expect((await fetch(s.upload.url, { method: 'PUT', headers: s.upload.headers, body: image })).status).toBe(200);
    const done = await h.inject(post(`/v1/driver-onboarding/evidence-uploads/${s.uploadId}/completion`, {}, bearer(a.s.accessToken)));
    expect(EvidenceUploadStatusSchema.parse(done.json())).toMatchObject({
      uploadId: s.uploadId,
      status: 'PROCESSING',
      rejectionReason: null,
      captureSource: 'GALLERY_IMPORT',
    });
    const again = await h.inject(post(`/v1/driver-onboarding/evidence-uploads/${s.uploadId}/completion`, {}, bearer(a.s.accessToken)));
    expect(EvidenceUploadStatusSchema.parse(again.json()).status).toBe('PROCESSING');
    const jobs = await h.owner.query(`select payload from platform.jobs where type = 'evidence.process' and payload->>'evidenceId' = $1`, [s.uploadId]);
    expect(jobs.rowCount).toBe(1);
    const list = EvidenceListSchema.parse(
      (await h.inject({ method: 'GET', url: `/v1/driver-onboarding/applications/${a.appId}/evidence`, headers: bearer(a.s.accessToken) })).json(),
    );
    expect(list.items.map((i) => [i.uploadId, i.status])).toEqual([[s.uploadId, 'PROCESSING']]);
    // no storage key in any non-vault table; the API role cannot read the vault
    const leaks = await h.owner.query(
      `select table_schema, table_name, column_name from information_schema.columns where table_schema not in ('vault','pg_catalog','information_schema')
        and (column_name ilike '%storage_key%' or column_name ilike '%quarantine_key%' or column_name ilike '%vault_key%')`,
    );
    expect(leaks.rows).toEqual([]);
  });

  it('selfie = in-app camera only; a challenge only with a selfie; the kind must belong to the document; foreign ids 404', async () => {
    const a = await applicant();
    await consent(a);
    const base = { byteSize: 100, mime: 'image/jpeg' };
    expect(errorOf(await slot(a, { ...base, documentId: a.docs['SELFIE'], kind: 'SELFIE_FOR_MANUAL_REVIEW', captureSource: 'GALLERY_IMPORT' }))?.code).toBe(
      'WAYVRO_E_VALIDATION',
    );
    expect(
      errorOf(await slot(a, { ...base, documentId: a.docs['CNIC'], kind: 'CNIC_FRONT', captureSource: 'IN_APP_CAMERA', challengeId: randomUUID() }))?.code,
    ).toBe('WAYVRO_E_VALIDATION');
    expect(errorOf(await slot(a, { ...base, documentId: a.docs['CNIC'], kind: 'LICENCE_FRONT', captureSource: 'IN_APP_CAMERA' }))?.code).toBe(
      'WAYVRO_E_VALIDATION',
    );
    expect(errorOf(await slot(a, { ...base, documentId: randomUUID(), kind: 'CNIC_FRONT', captureSource: 'IN_APP_CAMERA' }))?.code).toBe('WAYVRO_E_NOT_FOUND');
    expect(errorOf(await slot(a, { ...base, documentId: a.docs['CNIC'], kind: 'CNIC_FRONT', captureSource: 'IN_APP_CAMERA', mime: 'image/gif' }))?.code).toBe(
      'WAYVRO_E_VALIDATION',
    );
    expect(
      errorOf(await slot(a, { ...base, documentId: a.docs['CNIC'], kind: 'CNIC_FRONT', captureSource: 'IN_APP_CAMERA', byteSize: 10_485_761 }))?.code,
    ).toBe('WAYVRO_E_VALIDATION');
    const other = await applicant();
    const foreign = await h.inject(
      post(
        `/v1/driver-onboarding/applications/${a.appId}/evidence-uploads`,
        { ...base, documentId: a.docs['CNIC'], kind: 'CNIC_FRONT', captureSource: 'IN_APP_CAMERA' },
        bearer(other.s.accessToken),
      ),
    );
    expect(errorOf(foreign)?.code).toBe('WAYVRO_E_NOT_FOUND');
    const own = EvidenceUploadSlotSchema.parse(
      (await slot(a, { ...base, documentId: a.docs['SELFIE'], kind: 'SELFIE_FOR_MANUAL_REVIEW', captureSource: 'IN_APP_CAMERA' })).json(),
    );
    expect(errorOf(await h.inject(post(`/v1/driver-onboarding/evidence-uploads/${own.uploadId}/completion`, {}, bearer(other.s.accessToken))))?.code).toBe(
      'WAYVRO_E_NOT_FOUND',
    );
    expect(
      (await h.inject({ method: 'GET', url: `/v1/driver-onboarding/applications/${a.appId}/evidence`, headers: bearer(other.s.accessToken) })).statusCode,
    ).toBe(404);
  });

  it('a size mismatch is REJECTED (TOO_LARGE); an expired slot cannot complete; slots per account are rate limited', async () => {
    const a = await applicant();
    await consent(a);
    const s = EvidenceUploadSlotSchema.parse(
      (await slot(a, { documentId: a.docs['CNIC'], kind: 'CNIC_BACK', captureSource: 'FILE_IMPORT', byteSize: 64, mime: 'image/png' })).json(),
    );
    await h.storage?.putObject({ area: 'quarantine', key: quarantineKeyOf(s.upload.url), body: randomBytes(65), contentType: 'image/png' });
    const done = EvidenceUploadStatusSchema.parse(
      (await h.inject(post(`/v1/driver-onboarding/evidence-uploads/${s.uploadId}/completion`, {}, bearer(a.s.accessToken)))).json(),
    );
    expect(done).toMatchObject({ status: 'REJECTED', rejectionReason: 'TOO_LARGE' });
    const late = EvidenceUploadSlotSchema.parse(
      (await slot(a, { documentId: a.docs['CNIC'], kind: 'CNIC_BACK', captureSource: 'FILE_IMPORT', byteSize: 64, mime: 'image/png' })).json(),
    );
    await h.owner.query(
      `update vault.evidence_objects set created_at = now() - interval '2 hours', slot_expires_at = now() - interval '1 hour' where id = $1`,
      [late.uploadId],
    );
    expect(
      errorOf(await h.inject(post(`/v1/driver-onboarding/evidence-uploads/${late.uploadId}/completion`, {}, bearer(a.s.accessToken))))?.details?.reasonCodes,
    ).toEqual(['UPLOAD_SLOT_EXPIRED']);
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 8; i++)
      codes.push(
        errorOf(await slot(a, { documentId: a.docs['CNIC'], kind: 'CNIC_BACK', captureSource: 'FILE_IMPORT', byteSize: 64, mime: 'image/png' }))?.code,
      );
    expect(codes).toContain('WAYVRO_E_RATE_LIMITED');
  });

  it('discard deletes the stored object; nothing can be discarded once submitted', async () => {
    const a = await applicant();
    await consent(a);
    const image = syntheticJpeg(512);
    const s = EvidenceUploadSlotSchema.parse(
      (await slot(a, { documentId: a.docs['CNIC'], kind: 'CNIC_FRONT', captureSource: 'IN_APP_CAMERA', byteSize: image.length, mime: 'image/jpeg' })).json(),
    );
    await fetch(s.upload.url, { method: 'PUT', headers: s.upload.headers, body: image });
    const key = quarantineKeyOf(s.upload.url);
    expect(await h.storage?.headObject({ area: 'quarantine', key })).not.toBeNull();
    const res = await h.inject({
      method: 'DELETE',
      url: `/v1/driver-onboarding/evidence-uploads/${s.uploadId}`,
      headers: { ...bearer(a.s.accessToken), 'idempotency-key': `idem-${randomBytes(8).toString('hex')}` },
    });
    expect(res.statusCode, res.body).toBe(204);
    expect(await h.storage?.headObject({ area: 'quarantine', key })).toBeNull();
    const list = EvidenceListSchema.parse(
      (await h.inject({ method: 'GET', url: `/v1/driver-onboarding/applications/${a.appId}/evidence`, headers: bearer(a.s.accessToken) })).json(),
    );
    expect(list.items[0]?.status).toBe('DISCARDED');
  });
});

describe('accessible capture challenge (optional; never liveness)', () => {
  it('issue, replace with a different challenge, decline neutrally; a challenge is consumed by a selfie slot', async () => {
    const a = await applicant();
    await consent(a);
    const t = bearer(a.s.accessToken);
    const first = (await h.inject(post(`/v1/driver-onboarding/applications/${a.appId}/capture-challenges`, {}, t))).json<{
      challengeId: string;
      challengeCode: string;
    }>();
    const replaced = (
      await h.inject(post(`/v1/driver-onboarding/applications/${a.appId}/capture-challenges/${first.challengeId}/declines`, { choice: 'REPLACE' }, t))
    ).json<{ status: string; replacement: { challengeId: string; challengeCode: string } }>();
    expect(replaced.status).toBe('REPLACED');
    expect(replaced.replacement.challengeCode).not.toBe(first.challengeCode);
    const used = EvidenceUploadSlotSchema.parse(
      (
        await slot(a, {
          documentId: a.docs['SELFIE'],
          kind: 'SELFIE_FOR_MANUAL_REVIEW',
          captureSource: 'IN_APP_CAMERA',
          byteSize: 100,
          mime: 'image/jpeg',
          challengeId: replaced.replacement.challengeId,
        })
      ).json(),
    );
    const row = await h.owner.query(`select status, used_by_evidence_id from compliance.capture_challenges where id = $1`, [replaced.replacement.challengeId]);
    expect(row.rows[0]).toEqual({ status: 'USED', used_by_evidence_id: used.uploadId });
    expect(
      errorOf(
        await slot(a, {
          documentId: a.docs['SELFIE'],
          kind: 'SELFIE_FOR_MANUAL_REVIEW',
          captureSource: 'IN_APP_CAMERA',
          byteSize: 100,
          mime: 'image/jpeg',
          challengeId: replaced.replacement.challengeId,
        }),
      )?.code,
    ).toBe('WAYVRO_E_CONFLICT');
    const next = (await h.inject(post(`/v1/driver-onboarding/applications/${a.appId}/capture-challenges`, {}, t))).json<{ challengeId: string }>();
    const declined = await h.inject(
      post(`/v1/driver-onboarding/applications/${a.appId}/capture-challenges/${next.challengeId}/declines`, { choice: 'NONE_ACCESSIBLE' }, t),
    );
    expect(declined.json()).toEqual({ status: 'DECLINED_ACCESSIBILITY', replacement: null });
  });
});

describe('submission (itemised, human review next)', () => {
  it('itemises missing documents/evidence, then submits with the pinned set once every mandatory item is ACCEPTED', async () => {
    const a = await applicant();
    await consent(a);
    const t = bearer(a.s.accessToken);
    const version = () =>
      h.inject({ method: 'GET', url: '/v1/driver-onboarding/applications/current', headers: t }).then((r) => r.json<{ version: number }>().version);
    // the first slot moves CONSENTED → DOCUMENTS_PENDING (submission is only possible from there)
    expect(
      (await slot(a, { documentId: a.docs['CNIC'], kind: 'CNIC_FRONT', captureSource: 'IN_APP_CAMERA', byteSize: 100, mime: 'image/jpeg' })).statusCode,
    ).toBe(201);
    const missing = errorOf(await h.inject(post(`/v1/driver-onboarding/applications/${a.appId}/submission`, { expectedVersion: await version() }, t)));
    expect(missing?.code).toBe('WAYVRO_E_CONFLICT');
    expect(missing?.details?.reasonCodes).toEqual(
      expect.arrayContaining(['MISSING_DOCUMENT_DRIVING_LICENCE', 'MISSING_DOCUMENT_VEHICLE_REGISTRATION', 'MISSING_EVIDENCE_CNIC_FRONT']),
    );
    const licence = (
      await h.inject(
        post(
          `/v1/driver-onboarding/applications/${a.appId}/documents`,
          { documentType: 'DRIVING_LICENCE', number: 'LHR-SYN-0001', licenceClass: 'LTV', expiresOn: '2031-01-01' },
          t,
        ),
      )
    ).json<{ documentId: string }>().documentId;
    const v = VehicleCreatedSchema.parse(
      (
        await h.inject(
          post(
            `/v1/driver-onboarding/applications/${a.appId}/vehicles`,
            {
              plate: `LEZ-${randomBytes(2).toString('hex')}`,
              make: 'Synthetic',
              model: 'T',
              modelYear: 2020,
              colour: 'White',
              serviceCategory: 'CAR',
              ownershipType: 'REGISTERED_OWNER',
            },
            t,
          ),
        )
      ).json(),
    );
    const registration = (
      await h.inject(
        post(
          `/v1/driver-onboarding/applications/${a.appId}/documents`,
          { documentType: 'VEHICLE_REGISTRATION', vehicleId: v.vehicleId, number: 'SYN-REG-1' },
          t,
        ),
      )
    ).json<{ documentId: string }>().documentId;
    const needed: Array<[string, string]> = [
      [a.docs['CNIC'] ?? '', 'CNIC_FRONT'],
      [a.docs['CNIC'] ?? '', 'CNIC_BACK'],
      [a.docs['SELFIE'] ?? '', 'SELFIE_FOR_MANUAL_REVIEW'],
      [licence, 'LICENCE_FRONT'],
      [licence, 'LICENCE_BACK'],
      [registration, 'DOCUMENT_PAGE'],
    ];
    const uploads: string[] = [];
    for (const [documentId, kind] of needed) {
      const s = EvidenceUploadSlotSchema.parse((await slot(a, { documentId, kind, captureSource: 'IN_APP_CAMERA', byteSize: 100, mime: 'image/jpeg' })).json());
      uploads.push(s.uploadId);
    }
    for (const id of uploads.slice(0, -1)) await simulateProcessed(id, syntheticJpeg(256));
    const almost = errorOf(await h.inject(post(`/v1/driver-onboarding/applications/${a.appId}/submission`, { expectedVersion: await version() }, t)));
    expect(almost?.details?.reasonCodes).toEqual(['MISSING_EVIDENCE_DOCUMENT_PAGE']);
    await simulateProcessed(uploads.at(-1) ?? '', syntheticJpeg(256));
    const stale = errorOf(await h.inject(post(`/v1/driver-onboarding/applications/${a.appId}/submission`, { expectedVersion: 1 }, t)));
    expect(stale?.code).toBe('WAYVRO_E_CONFLICT');
    const submitted = await h.inject(post(`/v1/driver-onboarding/applications/${a.appId}/submission`, { expectedVersion: await version() }, t));
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(DriverApplicationSchema.parse(submitted.json())).toMatchObject({ state: 'SUBMITTED' });
    const pinned = await h.owner.query(`select requirement_set_id from compliance.driver_applications where id = $1`, [a.appId]);
    expect(pinned.rows[0]?.requirement_set_id).toBe('00000000-0000-7000-8000-00000000c0a0');
    expect(
      errorOf(await slot(a, { documentId: a.docs['CNIC'], kind: 'CNIC_FRONT', captureSource: 'IN_APP_CAMERA', byteSize: 100, mime: 'image/jpeg' }))?.code,
    ).toBe('WAYVRO_E_CONFLICT');
    const res = await h.inject({
      method: 'DELETE',
      url: `/v1/driver-onboarding/evidence-uploads/${uploads[0] ?? ''}`,
      headers: { ...t, 'idempotency-key': `idem-${randomBytes(8).toString('hex')}` },
    });
    expect(errorOf(res)?.code).toBe('WAYVRO_E_CONFLICT');
  });
});

describe('staff evidence views (H02, W07, K11)', () => {
  it('reason + step-up + city scope + no conflict → one-time token → no-store stream once; replay 410; everything logged', async () => {
    const a = await applicant();
    await consent(a);
    const s = EvidenceUploadSlotSchema.parse(
      (await slot(a, { documentId: a.docs['CNIC'], kind: 'CNIC_FRONT', captureSource: 'IN_APP_CAMERA', byteSize: 100, mime: 'image/jpeg' })).json(),
    );
    const image = syntheticJpeg(1024);
    await simulateProcessed(s.uploadId, image);
    const reviewer = await kit.staffWithRole(admins, 'KYC_REVIEWER', 'Reviewer One');
    const auditor = await kit.staffWithRole(admins, 'AUDITOR', 'Auditor One');
    const body = { evidenceId: s.uploadId, reasonCode: 'CASE_REVIEW' };
    // the enrolment assertion counts as a step-up for 5 minutes: age it so the step-up rule is exercised
    await h.owner.query(`update staff.sessions set step_up_at = now() - interval '1 hour' where staff_id = $1`, [reviewer.staffId]);
    expect((await h.inject(post('/v1/admin/evidence-views', body, kit.sb(reviewer)))).statusCode).toBe(403); // no fresh step-up
    expect((await kit.privileged(auditor, '/v1/admin/evidence-views', body)).statusCode).toBe(403); // no permission
    expect((await kit.privileged(reviewer, '/v1/admin/evidence-views', { ...body, reasonCode: 'CURIOSITY' })).statusCode).toBe(400);
    const issued = await kit.privileged(reviewer, '/v1/admin/evidence-views', body);
    expect(issued.statusCode, issued.body).toBe(201);
    const { viewToken } = issued.json<{ viewToken: string; expiresAt: string }>();
    const content = await h.inject({ method: 'GET', url: `/v1/admin/evidence-views/${viewToken}/content`, headers: kit.sb(reviewer) });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toBe('image/jpeg');
    expect(content.headers['cache-control']).toContain('no-store');
    expect(content.headers['content-disposition']).toBe('inline');
    expect(content.rawPayload.equals(image)).toBe(true);
    const replay = await h.inject({ method: 'GET', url: `/v1/admin/evidence-views/${viewToken}/content`, headers: kit.sb(reviewer) });
    expect(replay.statusCode).toBe(410);
    expect((await h.inject({ method: 'GET', url: `/v1/admin/evidence-views/${randomUUID()}/content`, headers: kit.sb(reviewer) })).statusCode).toBe(404);
    const log = await h.owner.query<{ event: string }>(`select event from vault.evidence_access_log where evidence_object_id = $1 order by at, id`, [
      s.uploadId,
    ]);
    expect(log.rows.map((r) => r.event)).toEqual(['VIEW_TOKEN_ISSUED', 'CONTENT_STREAMED', 'TOKEN_REPLAY_REFUSED']);
    const audit = await h.owner.query<{ action: string }>(`select action from audit.audit_events where object_id = $1 and actor_type = 'STAFF' order by seq`, [
      s.uploadId,
    ]);
    expect(audit.rows.map((r) => r.action)).toEqual(['EVIDENCE_VIEW_ISSUED', 'EVIDENCE_CONTENT_VIEWED']);
  });

  it('another city, a conflict of interest, unprocessed evidence and a tampered object are refused', async () => {
    const reviewer = await kit.staffWithRole(admins, 'KYC_REVIEWER', 'Reviewer Two');
    const a = await applicant();
    await consent(a);
    const s = EvidenceUploadSlotSchema.parse(
      (await slot(a, { documentId: a.docs['CNIC'], kind: 'CNIC_FRONT', captureSource: 'IN_APP_CAMERA', byteSize: 100, mime: 'image/jpeg' })).json(),
    );
    expect((await kit.privileged(reviewer, '/v1/admin/evidence-views', { evidenceId: s.uploadId, reasonCode: 'CASE_REVIEW' })).statusCode).toBe(409); // not processed
    const vaultKey = await simulateProcessed(s.uploadId, syntheticJpeg(300));
    // another city (synthetic second city, outside the reviewer's LHR scope)
    await h.owner.query(
      `insert into catalog.cities (code, name_en, name_ur, status) values ('ISB', 'Synthetic City', 'مصنوعی', 'ENABLED') on conflict do nothing`,
    );
    await h.owner.query(`update compliance.driver_applications set city_code = 'ISB' where id = $1`, [a.appId]);
    expect((await kit.privileged(reviewer, '/v1/admin/evidence-views', { evidenceId: s.uploadId, reasonCode: 'CASE_REVIEW' })).statusCode).toBe(403);
    await h.owner.query(`update compliance.driver_applications set city_code = 'LHR' where id = $1`, [a.appId]);
    // conflict of interest: the reviewer's declared consumer account owns the evidence
    const owner = (await h.owner.query<{ account_id: string }>(`select account_id from identity.sessions where id = $1`, [a.s.sessionId])).rows[0]?.account_id;
    await h.owner.query(`update staff.staff_accounts set consumer_account_id = $2 where id = $1`, [reviewer.staffId, owner]);
    expect((await kit.privileged(reviewer, '/v1/admin/evidence-views', { evidenceId: s.uploadId, reasonCode: 'CASE_REVIEW' })).statusCode).toBe(403);
    await h.owner.query(`update staff.staff_accounts set consumer_account_id = null where id = $1`, [reviewer.staffId]);
    const denials = await h.owner.query<{ reason_code: string }>(
      `select reason_code from audit.audit_events where action = 'EVIDENCE_VIEW_DENIED' and object_id = $1 order by seq`,
      [s.uploadId],
    );
    expect(denials.rows.map((r) => r.reason_code)).toEqual(['CITY_SCOPE', 'CONFLICT_OF_INTEREST']);
    // a tampered vault object fails closed (AEAD) and is logged as an integrity failure
    await h.storage?.putObject({ area: 'vault', key: vaultKey, body: randomBytes(400), contentType: 'application/octet-stream' });
    const issued = await kit.privileged(reviewer, '/v1/admin/evidence-views', { evidenceId: s.uploadId, reasonCode: 'CASE_REVIEW' });
    const { viewToken } = issued.json<{ viewToken: string }>();
    expect((await h.inject({ method: 'GET', url: `/v1/admin/evidence-views/${viewToken}/content`, headers: kit.sb(reviewer) })).statusCode).toBe(500);
    const events = await h.owner.query<{ event: string }>(`select event from vault.evidence_access_log where evidence_object_id = $1 order by at, id`, [
      s.uploadId,
    ]);
    expect(events.rows.map((r) => r.event)).toContain('INTEGRITY_FAILURE');
  });
});
