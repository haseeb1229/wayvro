/**
 * Migration 0005_vault against real PostgreSQL: evidence-object invariants (selfie = in-app camera only, AVAILABLE ⇔
 * every sanitised/encrypted fact present, rejection reasons, opaque key formats), one-time view tokens (≤ 60 s),
 * append-only access log, one live capture challenge per application, the EVIDENCE_HASH_MATCH signal CHECK, and
 * GRANTS executed as LOGIN members: wayvro_api and wayvro_worker cannot touch `vault.*`; wayvro_vault reads only the
 * compliance columns it needs. Throwaway database; synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required for integration tests (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;
const pgCode = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

let database: TestDatabase;
let owner: pg.Pool;
let api: pg.Pool;
let worker: pg.Pool;
let vault: pg.Pool;
const logins: RestrictedLogin[] = [];
async function poolAs(group: string): Promise<pg.Pool> {
  const login = await createRestrictedLogin(adminUrl, database.url, group);
  logins.push(login);
  return new pg.Pool({ connectionString: login.url, max: 2 });
}

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 3 });
  api = await poolAs('wayvro_api');
  worker = await poolAs('wayvro_worker');
  vault = await poolAs('wayvro_vault');
});
afterAll(async () => {
  await Promise.all([owner.end(), api.end(), worker.end(), vault.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

const hex = () => randomBytes(16).toString('hex');
/** account → application → SELFIE + CNIC document claims (as the API would create them). */
async function applicant(): Promise<{ account: string; application: string; selfieDoc: string; cnicDoc: string }> {
  const account = randomUUID();
  const application = randomUUID();
  const selfieDoc = randomUUID();
  const cnicDoc = randomUUID();
  await owner.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [account]);
  await owner.query(`insert into compliance.driver_applications (id, account_id, state, city_code) values ($1, $2, 'DOCUMENTS_PENDING', 'LHR')`, [
    application,
    account,
  ]);
  for (const [id, type] of [
    [selfieDoc, 'SELFIE'],
    [cnicDoc, 'CNIC'],
  ] as const) {
    await owner.query(
      `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, status) values ($1, $2, 'DRIVER', $3, 'SUBMITTED')`,
      [id, type, application],
    );
  }
  return { account, application, selfieDoc, cnicDoc };
}
async function slot(q: pg.Pool, a: { account: string; application: string }, doc: string, kind: string, source = 'IN_APP_CAMERA'): Promise<string> {
  const id = randomUUID();
  await q.query(
    `insert into vault.evidence_objects (id, owner_account_id, driver_application_id, compliance_document_id, kind, capture_source, declared_mime,
                                         declared_byte_size, status, quarantine_key, slot_expires_at)
     values ($1, $2, $3, $4, $5, $6, 'image/jpeg', 1000, 'SLOT_ISSUED', $7, now() + interval '10 minutes')`,
    [id, a.account, a.application, doc, kind, source, `q/${hex()}`],
  );
  return id;
}
async function staffSession(): Promise<{ staff: string; session: string }> {
  const staff = randomUUID();
  const credential = randomUUID();
  const session = randomUUID();
  await owner.query(`insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'S', $2, 'ACTIVE', now())`, [
    staff,
    `s-${hex()}@example.test`,
  ]);
  await owner.query(
    `insert into staff.webauthn_credentials (id, staff_id, credential_id, public_key, sign_count, device_type, backed_up, nickname, status)
     values ($1, $2, $3, $4, 0, 'singleDevice', false, 'k', 'ACTIVE')`,
    [credential, staff, hex(), randomBytes(32)],
  );
  await owner.query(
    `insert into staff.sessions (id, staff_id, credential_id, status, token_hash, absolute_expires_at) values ($1, $2, $3, 'ACTIVE', $4, now() + interval '8 hours')`,
    [session, staff, credential, randomBytes(32)],
  );
  return { staff, session };
}

describe('evidence-object invariants', () => {
  it('a selfie slot accepts only the in-app camera source; documents accept imports', async () => {
    const a = await applicant();
    expect(await pgCode(slot(vault, a, a.selfieDoc, 'SELFIE_FOR_MANUAL_REVIEW', 'GALLERY_IMPORT'))).toBe('23514');
    await slot(vault, a, a.selfieDoc, 'SELFIE_FOR_MANUAL_REVIEW', 'IN_APP_CAMERA');
    await slot(vault, a, a.cnicDoc, 'CNIC_FRONT', 'GALLERY_IMPORT');
    await slot(vault, a, a.cnicDoc, 'CNIC_BACK', 'FILE_IMPORT');
  });

  it('AVAILABLE requires every sanitised/encrypted fact; rejections require a reason; keys are opaque', async () => {
    const a = await applicant();
    const id = await slot(vault, a, a.cnicDoc, 'CNIC_FRONT');
    expect(await pgCode(vault.query(`update vault.evidence_objects set status = 'AVAILABLE' where id = $1`, [id]))).toBe('23514');
    expect(await pgCode(vault.query(`update vault.evidence_objects set status = 'REJECTED_MALWARE', uploaded_at = now() where id = $1`, [id]))).toBe('23514');
    await vault.query(
      `update vault.evidence_objects set status = 'AVAILABLE', uploaded_at = now(), processed_at = now(), source_byte_size = 900, source_sha256 = $2,
              canonical_sha256 = $3, canonical_format = 'JPEG', canonical_byte_size = 800, pixel_width = 1200, pixel_height = 800,
              wrapped_dek = $4, content_envelope_version = 1, vault_key = $5 where id = $1`,
      [id, randomBytes(32), randomBytes(32), randomBytes(60), `v/${hex()}`],
    );
    // a storage key is never a path, URL or anything but the opaque random form
    const bad = randomUUID();
    expect(
      await pgCode(
        vault.query(
          `insert into vault.evidence_objects (id, owner_account_id, driver_application_id, compliance_document_id, kind, capture_source, declared_mime,
                                               declared_byte_size, status, quarantine_key, slot_expires_at)
           values ($1, $2, $3, $4, 'CNIC_BACK', 'IN_APP_CAMERA', 'image/jpeg', 10, 'SLOT_ISSUED', 'https://bucket/q/x', now() + interval '1 minute')`,
          [bad, a.account, a.application, a.cnicDoc],
        ),
      ),
    ).toBe('23514');
    expect(
      await pgCode(
        vault.query(
          `insert into vault.evidence_objects (id, owner_account_id, driver_application_id, compliance_document_id, kind, capture_source, declared_mime,
                                               declared_byte_size, status, quarantine_key, slot_expires_at)
           values ($1, $2, $3, $4, 'CNIC_BACK', 'IN_APP_CAMERA', 'image/gif', 10, 'SLOT_ISSUED', $5, now() + interval '1 minute')`,
          [bad, a.account, a.application, a.cnicDoc, `q/${hex()}`],
        ),
      ),
    ).toBe('23514');
  });
});

describe('staff evidence views', () => {
  it('view tokens live at most 60 s; the access log is append-only even for the owner', async () => {
    const a = await applicant();
    const evidence = await slot(vault, a, a.cnicDoc, 'CNIC_FRONT');
    const s = await staffSession();
    expect(
      await pgCode(
        vault.query(
          `insert into vault.evidence_view_tokens (id, token_sha256, evidence_object_id, staff_account_id, staff_session_id, reason_code, expires_at)
           values ($1, $2, $3, $4, $5, 'CASE_REVIEW', now() + interval '61 seconds')`,
          [randomUUID(), randomBytes(32), evidence, s.staff, s.session],
        ),
      ),
    ).toBe('23514');
    const token = randomUUID();
    await vault.query(
      `insert into vault.evidence_view_tokens (id, token_sha256, evidence_object_id, staff_account_id, staff_session_id, reason_code, expires_at)
       values ($1, $2, $3, $4, $5, 'CASE_REVIEW', now() + interval '60 seconds')`,
      [token, randomBytes(32), evidence, s.staff, s.session],
    );
    const log = randomUUID();
    await vault.query(
      `insert into vault.evidence_access_log (id, evidence_object_id, staff_account_id, staff_session_id, view_token_id, event, reason_code)
       values ($1, $2, $3, $4, $5, 'VIEW_TOKEN_ISSUED', 'CASE_REVIEW')`,
      [log, evidence, s.staff, s.session, token],
    );
    for (const pool of [vault, owner]) {
      expect(await pgCode(pool.query(`update vault.evidence_access_log set reason_code = 'X_Y_Z' where id = $1`, [log]))).not.toBeUndefined();
      expect(await pgCode(pool.query(`delete from vault.evidence_access_log where id = $1`, [log]))).not.toBeUndefined();
    }
    expect(await pgCode(owner.query(`truncate vault.evidence_access_log`))).not.toBeUndefined();
  });
});

describe('capture challenges and evidence signals', () => {
  it('one live challenge per application; USED ⇔ linked evidence', async () => {
    const a = await applicant();
    const issue = () =>
      api.query(
        `insert into compliance.capture_challenges (id, application_id, challenge_code, status, expires_at) values ($1, $2, 'SMILE', 'ISSUED', now() + interval '10 minutes')`,
        [randomUUID(), a.application],
      );
    await issue();
    expect(await pgCode(issue())).toBe('23505');
    const selfie = await slot(vault, a, a.selfieDoc, 'SELFIE_FOR_MANUAL_REVIEW');
    expect(await pgCode(vault.query(`update compliance.capture_challenges set status = 'USED' where application_id = $1`, [a.application]))).toBe('23514');
    await vault.query(`update compliance.capture_challenges set status = 'USED', used_by_evidence_id = $2 where application_id = $1`, [a.application, selfie]);
    await issue();
  });

  it('EVIDENCE_HASH_MATCH needs both evidence objects and both applications, and is recorded once', async () => {
    const a = await applicant();
    const b = await applicant();
    const ea = await slot(vault, a, a.cnicDoc, 'CNIC_FRONT');
    const eb = await slot(vault, b, b.cnicDoc, 'CNIC_FRONT');
    const signal = (subjectEvidence: string, matchedEvidence: string | null) =>
      vault.query(
        `insert into compliance.duplicate_signals (id, signal, subject_application_id, subject_evidence_id, matched_application_id, matched_evidence_id, status)
         values ($1, 'EVIDENCE_HASH_MATCH', $2, $3, $4, $5, 'OPEN')`,
        [randomUUID(), b.application, subjectEvidence, a.application, matchedEvidence],
      );
    expect(await pgCode(signal(eb, null))).toBe('23514');
    expect(await pgCode(signal(eb, eb))).toBe('23514');
    await signal(eb, ea);
    expect(await pgCode(signal(eb, ea))).toBe('23505');
  });
});

describe('grants executed as restricted roles', () => {
  it('wayvro_api and wayvro_worker have no access to vault.*', async () => {
    for (const pool of [api, worker]) {
      for (const table of ['vault.evidence_objects', 'vault.evidence_view_tokens', 'vault.evidence_access_log']) {
        expect(await pgCode(pool.query(`select 1 from ${table} limit 1`)), table).toBe('42501');
      }
    }
  });

  it('wayvro_vault reads only the compliance columns it needs and cannot read identity/staff secrets or alter applications', async () => {
    const a = await applicant();
    expect((await vault.query(`select id, account_id, state, city_code from compliance.driver_applications where id = $1`, [a.application])).rowCount).toBe(1);
    expect(await pgCode(vault.query(`select cnic_envelope from compliance.driver_applications limit 1`))).toBe('42501');
    expect(await pgCode(vault.query(`select number_envelope from compliance.compliance_documents limit 1`))).toBe('42501');
    expect(await pgCode(vault.query(`update compliance.driver_applications set state = 'SUBMITTED'`))).toBe('42501');
    expect(await pgCode(vault.query(`select 1 from identity.account_phones limit 1`))).toBe('42501');
    expect(await pgCode(vault.query(`select 1 from staff.sessions limit 1`))).toBe('42501');
    expect(await pgCode(vault.query(`select 1 from audit.audit_events limit 1`))).toBe('42501');
    expect(await pgCode(vault.query(`delete from vault.evidence_objects`))).toBe('42501');
  });
});
