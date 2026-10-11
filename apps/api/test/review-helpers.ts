/**
 * Shared P2.7 review fixtures (synthetic): a consumer with a complete, SUBMITTED application whose evidence is sealed
 * exactly as the worker seals it, and the worker intake step simulated in the database.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CHECKLIST_ITEMS_V1, DriverApplicationSchema, EvidenceUploadSlotSchema, ReviewCaseDetailSchema, VehicleCreatedSchema } from '@wayvro/contracts';
import { sealEvidence } from '@wayvro/field-crypto';
import { currentDocument } from '@wayvro/legal-content';
import { expect } from 'vitest';
import type { Staff, staffKit } from './staff-helpers.js';
import { bearer, post, signIn, type Harness, type SignedIn } from './support.js';

export interface Ready {
  s: SignedIn;
  appId: string;
  accountId: string;
  evidenceIds: string[];
  cnic: string;
}

export function reviewKit(h: Harness, kit: ReturnType<typeof staffKit>) {
  const get = (url: string, headers: Record<string, string>) => h.inject({ method: 'GET', url, headers });
  const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();
  const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(252)]);
  const allConfirmed = { schemaVersion: 1, items: Object.fromEntries(CHECKLIST_ITEMS_V1.map((i) => [i, 'CONFIRMED'])) };

  /** A consumer with a complete, submitted application (evidence processed as the worker would). */
  async function submittedApplication(opts: { cnic?: string; plate?: string } = {}): Promise<Ready> {
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
    const cnic = opts.cnic ?? `35202-${String(randomBytes(4).readUInt32BE(0) % 10_000_000).padStart(7, '0')}-1`;
    await h.inject(
      post(
        `/v1/driver-onboarding/applications/${app.id}/claims`,
        { expectedVersion: app.version, legalName: 'Synthetic Applicant', cnic, dateOfBirth: '1990-05-17' },
        t,
      ),
    );
    await h.inject(post(`/v1/driver-onboarding/applications/${app.id}/consent`, {}, t));
    const claim = async (body: Record<string, unknown>) =>
      (await h.inject(post(`/v1/driver-onboarding/applications/${app.id}/documents`, body, t))).json<{ documentId: string }>().documentId;
    const cnicDoc = await claim({ documentType: 'CNIC', expiresOn: '2032-01-01' });
    const selfie = await claim({ documentType: 'SELFIE' });
    const licence = await claim({
      documentType: 'DRIVING_LICENCE',
      number: `LHR-${randomBytes(3).toString('hex')}`,
      licenceClass: 'LTV',
      expiresOn: '2031-06-30',
    });
    const v = VehicleCreatedSchema.parse(
      (
        await h.inject(
          post(
            `/v1/driver-onboarding/applications/${app.id}/vehicles`,
            {
              plate: opts.plate ?? `LE-${randomBytes(3).toString('hex')}`,
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
    const registration = await claim({ documentType: 'VEHICLE_REGISTRATION', vehicleId: v.vehicleId, number: `REG-${randomBytes(3).toString('hex')}` });
    const evidenceIds: string[] = [];
    for (const [documentId, kind] of [
      [cnicDoc, 'CNIC_FRONT'],
      [cnicDoc, 'CNIC_BACK'],
      [selfie, 'SELFIE_FOR_MANUAL_REVIEW'],
      [licence, 'LICENCE_FRONT'],
      [licence, 'LICENCE_BACK'],
      [registration, 'DOCUMENT_PAGE'],
    ] as const) {
      const slot = EvidenceUploadSlotSchema.parse(
        (
          await h.inject(
            post(
              `/v1/driver-onboarding/applications/${app.id}/evidence-uploads`,
              { documentId, kind, captureSource: 'IN_APP_CAMERA', byteSize: 256, mime: 'image/jpeg' },
              t,
            ),
          )
        ).json(),
      );
      const image = jpeg();
      const sealed = sealEvidence(h.runtime.cipher, slot.uploadId, image);
      const vaultKey = `v/${randomBytes(16).toString('hex')}`;
      await h.storage?.putObject({ area: 'vault', key: vaultKey, body: sealed.content, contentType: 'application/octet-stream' });
      await h.owner.query(
        `update vault.evidence_objects set status = 'AVAILABLE', uploaded_at = now(), processed_at = now(), source_byte_size = 256, source_sha256 = $2, canonical_sha256 = $2,
                canonical_format = 'JPEG', canonical_byte_size = 256, pixel_width = 640, pixel_height = 480, wrapped_dek = $3, content_envelope_version = 1, vault_key = $4 where id = $1`,
        [slot.uploadId, sha256(image), sealed.wrappedDek, vaultKey],
      );
      evidenceIds.push(slot.uploadId);
    }
    const version = (await get('/v1/driver-onboarding/applications/current', t)).json<{ version: number }>().version;
    const submitted = await h.inject(post(`/v1/driver-onboarding/applications/${app.id}/submission`, { expectedVersion: version }, t));
    expect(submitted.statusCode, submitted.body).toBe(200);
    const accountId =
      (await h.owner.query<{ account_id: string }>(`select account_id from compliance.driver_applications where id = $1`, [app.id])).rows[0]?.account_id ?? '';
    return { s, appId: app.id, accountId, evidenceIds, cnic };
  }

  /** What the worker's `driver-application.intake` does (apps/worker/src/review/review-jobs.ts). */
  async function intake(appId: string): Promise<string> {
    const earlier = await h.owner.query(`select 1 from compliance.review_cases where driver_application_id = $1`, [appId]);
    const signals = await h.owner.query(`select 1 from compliance.duplicate_signals where subject_application_id = $1 and status = 'OPEN'`, [appId]);
    const id = randomUUID();
    await h.owner.query(`update compliance.driver_applications set state = 'MANUAL_REVIEW', version = version + 2 where id = $1 and state = 'SUBMITTED'`, [
      appId,
    ]);
    await h.owner.query(
      `insert into compliance.review_cases (id, kind, driver_application_id, city_code, priority, status) values ($1, $2, $3, 'LHR', $4, 'OPEN')`,
      [id, (earlier.rowCount ?? 0) > 0 ? 'RESUBMISSION' : 'INITIAL_APPLICATION', appId, Math.min(9, 2 * (signals.rowCount ?? 0))],
    );
    return id;
  }
  const claim = async (s: Staff, caseId: string) => {
    const res = await h.inject(post(`/v1/admin/review-cases/${caseId}/claim`, {}, kit.sb(s)));
    expect(res.statusCode, res.body).toBe(200);
    return ReviewCaseDetailSchema.parse(res.json());
  };
  const decide = (s: Staff, caseId: string, body: Record<string, unknown>) => kit.privileged(s, `/v1/admin/review-cases/${caseId}/decisions`, body);

  return { get, allConfirmed, submittedApplication, intake, claim, decide };
}
