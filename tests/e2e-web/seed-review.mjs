/*
 * Reviewer-journey seed for the web-ops E2E stack (P2.7). SYNTHETIC data only, written into the throwaway database
 * `wayvro_e2e_ops`:
 *   - a KYC_REVIEWER (LHR) whose assignment has the maker-checker shape (requested by admin one, approved by admin two)
 *     and an ENROLMENT invitation the spec redeems with a virtual authenticator;
 *   - one Driver/Partner application in MANUAL_REVIEW with encrypted claims, document claims, one OPEN review case and
 *     an AVAILABLE evidence object — a generated, labelled synthetic JPEG sealed exactly as the worker seals it and stored
 *     in the local SeaweedFS vault area under a per-run prefix.
 * The vault pool of the API runner authenticates as a LOGIN member of wayvro_vault (created here, local only).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const fileUrl = (root, path) => new URL(`file://${join(root, path).replaceAll('\\', '/')}`).href;

export async function seedReview({ root, pool, adminIds, keySeed, s3 }) {
  const require = createRequire(join(root, 'package.json'));
  const sharp = require('sharp');
  const { FieldCipher, localKeyRing, sealEvidence } = await import(fileUrl(root, 'packages/field-crypto/dist/index.js'));
  const { ENCRYPTED_FIELDS, fieldContext } = await import(fileUrl(root, 'packages/identity-core/dist/index.js'));
  const { issueInvitation } = await import(fileUrl(root, 'apps/api/dist/staff/staff-admin.service.js'));
  const { S3ObjectStorage } = await import(fileUrl(root, 'packages/vault-adapters/dist/index.js'));
  const cipher = new FieldCipher(localKeyRing(keySeed));
  const storage = new S3ObjectStorage({ ...s3, maxUploadUrlSeconds: 300, requestTimeoutMs: 10000 });

  const client = await pool.connect();
  try {
    await client.query('begin');
    // reviewer + invitation
    const reviewerId = randomUUID();
    const invitationId = randomUUID();
    await client.query(
      `insert into staff.staff_accounts (id, display_name, work_email, status) values ($1, 'E2E Reviewer', 'e2e.reviewer@example.org', 'INVITED')`,
      [reviewerId],
    );
    await client.query(`insert into staff.invitations (id, staff_id, kind, status, created_by) values ($1, $2, 'ENROLMENT', 'PENDING_APPROVAL', $3)`, [
      invitationId,
      reviewerId,
      adminIds[0],
    ]);
    const invitation = await issueInvitation(client, invitationId, 3600);
    const assignment = randomUUID();
    await client.query(
      `insert into staff.role_assignments (id, staff_id, role, status, requested_by, approved_by, decided_at, valid_from) values ($1, $2, 'KYC_REVIEWER', 'ACTIVE', $3, $4, now(), now())`,
      [assignment, reviewerId, adminIds[0], adminIds[1]],
    );
    await client.query(`insert into staff.role_assignment_cities (assignment_id, city_code) values ($1, 'LHR')`, [assignment]);

    // applicant + application in MANUAL_REVIEW
    const accountId = randomUUID();
    const appId = randomUUID();
    await client.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [accountId]);
    const enc = (spec, value, rowId) => cipher.encrypt(spec.keyClass, value, fieldContext(spec, rowId));
    await client.query(
      `insert into compliance.driver_applications (id, account_id, state, city_code, legal_name_envelope, cnic_envelope, cnic_last4, date_of_birth_envelope, requirement_set_id, submitted_at)
       values ($1, $2, 'MANUAL_REVIEW', 'LHR', $3, $4, '0001', $5, '00000000-0000-7000-8000-00000000c0a0', now())`,
      [
        appId,
        accountId,
        enc(ENCRYPTED_FIELDS.applicationLegalName, 'Synthetic E2E Applicant', appId),
        enc(ENCRYPTED_FIELDS.applicationCnic, '35202-0000000-1', appId),
        enc(ENCRYPTED_FIELDS.applicationDob, '1990-05-17', appId),
      ],
    );
    await client.query(`insert into compliance.application_service_categories (application_id, service_category) values ($1, 'CAR')`, [appId]);
    const cnicDoc = randomUUID();
    await client.query(
      `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, status) values ($1, 'CNIC', 'DRIVER', $2, 'SUBMITTED')`,
      [cnicDoc, appId],
    );

    // one AVAILABLE evidence object: a generated synthetic JPEG, sealed as the worker seals it
    const image = await sharp({ create: { width: 480, height: 300, channels: 3, background: { r: 230, g: 225, b: 200 } } })
      .composite([
        {
          input: Buffer.from('<svg width="480" height="300"><text x="20" y="160" font-size="26" fill="#333">SYNTHETIC — NOT A REAL DOCUMENT</text></svg>'),
          top: 0,
          left: 0,
        },
      ])
      .jpeg({ quality: 80 })
      .toBuffer();
    const evidenceId = randomUUID();
    const sealed = sealEvidence(cipher, evidenceId, image);
    const vaultKey = `v/${randomBytes(16).toString('hex')}`;
    await storage.putObject({ area: 'vault', key: vaultKey, body: sealed.content, contentType: 'application/octet-stream' });
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update(image).digest();
    await client.query(
      `insert into vault.evidence_objects (id, owner_account_id, driver_application_id, compliance_document_id, kind, capture_source, declared_mime, declared_byte_size, status,
                                           quarantine_key, vault_key, slot_expires_at, uploaded_at, processed_at, source_byte_size, source_sha256, canonical_sha256, canonical_format,
                                           canonical_byte_size, pixel_width, pixel_height, wrapped_dek, content_envelope_version, created_at)
       values ($1, $2, $3, $4, 'CNIC_FRONT', 'IN_APP_CAMERA', 'image/jpeg', $5, 'AVAILABLE', $6, $7, now() + interval '10 minutes', now(), now(), $5, $8, $8, 'JPEG', $5, 480, 300, $9, 1, now() - interval '1 minute')`,
      [evidenceId, accountId, appId, cnicDoc, image.length, `q/${randomBytes(16).toString('hex')}`, vaultKey, sha, sealed.wrappedDek],
    );
    const caseId = randomUUID();
    await client.query(
      `insert into compliance.review_cases (id, kind, driver_application_id, city_code, status) values ($1, 'INITIAL_APPLICATION', $2, 'LHR', 'OPEN')`,
      [caseId, appId],
    );
    await client.query('commit');
    return { reviewerInvitation: invitation.token, caseId, evidenceId };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
