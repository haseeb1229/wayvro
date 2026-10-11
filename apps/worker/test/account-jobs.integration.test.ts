/**
 * P2.9 account jobs against real PostgreSQL (LOGIN members of wayvro_worker and wayvro_vault) and SeaweedFS (S3):
 * lost-phone recovery completion after the cooldown (number moved, sessions of both accounts revoked; a request whose
 * number is no longer the requester's lapses; stale reviews expire) and account deletion (blockers re-evaluated incl.
 * evidence legal holds; due requests: evidence crypto-shredded and deleted from storage, account pseudonymised,
 * lookups deleted, open work closed). Synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { runMigrations } from '@wayvro/db';
import { FieldCipher, KeyedHasher, localKeyRing } from '@wayvro/field-crypto';
import { ENCRYPTED_FIELDS, PhoneLookup, fieldContext } from '@wayvro/identity-core';
import { createLogger } from '@wayvro/observability';
import type { ClaimedJob } from '@wayvro/server-runtime';
import { captureLogs, createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import { S3ObjectStorage } from '@wayvro/vault-adapters';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DELETION_PROCESSING_JOB, RECOVERY_COMPLETION_JOB, deletionProcessingJob, recoveryCompletionJob } from '../src/identity/account-jobs.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;
const run = randomBytes(5).toString('hex');

let database: TestDatabase;
let owner: pg.Pool;
let worker: pg.Pool;
let vault: pg.Pool;
const logins: RestrictedLogin[] = [];
const logs = captureLogs();
const log = createLogger({ service: 'worker', env: 'test', level: 'info', destination: logs.stream });
const ring = localKeyRing('synthetic-worker-account-seed-0123456789');
const cipher = new FieldCipher(ring);
const lookup = new PhoneLookup(new KeyedHasher(ring));
const storage = new S3ObjectStorage({
  endpoint: process.env['WAYVRO_S3_ENDPOINT'] ?? 'http://127.0.0.1:28333',
  region: 'us-east-1',
  accessKeyId: 'wayvro-local-access',
  secretAccessKey: 'wayvro-local-secret-not-for-production',
  forcePathStyle: true,
  areas: { quarantine: { bucket: 'wayvro-local', prefix: `wk-acct-${run}/quarantine/` }, vault: { bucket: 'wayvro-local', prefix: `wk-acct-${run}/vault/` } },
  maxUploadUrlSeconds: 300,
  requestTimeoutMs: 10000,
});

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 3 });
  for (const [group, assign] of [
    ['wayvro_worker', (p: pg.Pool) => (worker = p)],
    ['wayvro_vault', (p: pg.Pool) => (vault = p)],
  ] as const) {
    const login = await createRestrictedLogin(adminUrl, database.url, group);
    logins.push(login);
    assign(new pg.Pool({ connectionString: login.url, max: 3 }));
  }
});
afterAll(async () => {
  await Promise.all([owner.end(), worker.end(), vault.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

const job = (type: string): ClaimedJob => ({ id: randomUUID(), type, payload: {}, sealedPayload: null, attempts: 1, maxAttempts: 3, leaseToken: randomUUID() });
let n = 0;
const phone = () => `+92399${String(randomBytes(3).readUIntBE(0, 3) % 100000).padStart(5, '0')}${String((n = (n + 1) % 100)).padStart(2, '0')}`;

/** An ACTIVE account with a current verified phone (encrypted + current-owner lookup) and one session. */
async function account(e164 = phone()): Promise<{ id: string; phone: string; session: string }> {
  const id = randomUUID();
  const phoneId = randomUUID();
  const deviceId = randomUUID();
  const session = randomUUID();
  await owner.query(`insert into identity.accounts (id, status, preferred_locale, display_name) values ($1, 'ACTIVE', 'en', 'Synthetic Person')`, [id]);
  await owner.query(
    `insert into identity.account_phones (id, account_id, phone_envelope, phone_last4, status, verified_at) values ($1, $2, $3, $4, 'VERIFIED', now())`,
    [phoneId, id, cipher.encrypt('contact', e164, fieldContext(ENCRYPTED_FIELDS.accountPhone, phoneId)), e164.slice(-4)],
  );
  const client = await owner.connect();
  try {
    await client.query('begin');
    await lookup.writeCurrentOwner(client, phoneId, e164);
    await client.query('commit');
  } finally {
    client.release();
  }
  await owner.query(
    `insert into identity.account_devices (id, account_id, installation_hash, platform, app_version, first_verified_at, last_seen_at, trust_state) values ($1, $2, $3, 'ANDROID', '1.0.0', now(), now(), 'NEW')`,
    [deviceId, id, randomBytes(32)],
  );
  await owner.query(
    `insert into identity.sessions (id, account_id, device_id, status, assurance, access_token_hash, access_expires_at, idle_expires_at, absolute_expires_at, app_version)
     values ($1, $2, $3, 'ACTIVE', 'OTP', $4, now() + interval '15 minutes', now() + interval '1 day', now() + interval '2 days', '1.0.0')`,
    [session, id, deviceId, randomBytes(32)],
  );
  return { id, phone: e164, session };
}
const ownerOf = async (e164: string) => (await lookup.currentOwner(owner, e164))?.accountId ?? null;
const sessionStatus = async (id: string) =>
  (await owner.query<{ status: string; revoke_reason: string | null }>(`select status, revoke_reason from identity.sessions where id = $1`, [id])).rows[0];

async function recovery(target: string, requester: { id: string; phone: string }, status: 'COOLDOWN' | 'MANUAL_REVIEW', past: boolean): Promise<string> {
  const id = randomUUID();
  const digest = lookup.activeDigest(requester.phone);
  await owner.query(
    `insert into identity.phone_change_requests (id, account_id, kind, new_phone_envelope, new_phone_last4, new_phone_lookup_version, new_phone_lookup_hash, status,
                                                 requested_by_account_id, cooldown_until, expires_at, created_at)
     values ($1, $2, 'RECOVERY_DRIVER_KYC', $3, $4, $5, $6, $7, $8, case when $7 = 'COOLDOWN' then now() - interval '1 minute' end,
             case when $9 then now() - interval '1 minute' else now() + interval '30 days' end, now() - interval '31 days')`,
    [
      id,
      target,
      cipher.encrypt('contact', requester.phone, fieldContext(ENCRYPTED_FIELDS.phoneChangePhone, id)),
      requester.phone.slice(-4),
      digest.version,
      digest.digest,
      status,
      requester.id,
      past,
    ],
  );
  return id;
}

describe(RECOVERY_COMPLETION_JOB, () => {
  it('after the cooldown the number moves to the recovered account; both accounts are signed out everywhere', async () => {
    const recovered = await account();
    const requester = await account();
    const lost = recovered.phone;
    const id = await recovery(recovered.id, requester, 'COOLDOWN', false);
    await recoveryCompletionJob({ pool: worker, cipher, lookup, log }).handler(job(RECOVERY_COMPLETION_JOB));
    expect((await owner.query<{ status: string }>(`select status from identity.phone_change_requests where id = $1`, [id])).rows[0]?.status).toBe('COMPLETED');
    expect(await ownerOf(requester.phone)).toBe(recovered.id);
    expect(await ownerOf(lost)).toBeNull();
    expect(await sessionStatus(recovered.session)).toEqual({ status: 'REVOKED', revoke_reason: 'RECOVERY' });
    expect(await sessionStatus(requester.session)).toEqual({ status: 'REVOKED', revoke_reason: 'RECOVERY' });
    const released = await owner.query<{ release_reason: string }>(
      `select release_reason from identity.account_phones where status = 'RELEASED' and account_id = any($1::uuid[])`,
      [[recovered.id, requester.id]],
    );
    expect(released.rows.map((r) => r.release_reason)).toEqual(['RECOVERY_MOVED', 'RECOVERY_MOVED']);
    const events = await owner.query<{ type: string }>(`select type from platform.outbox_events where account_id = any($1::uuid[])`, [
      [recovered.id, requester.id],
    ]);
    expect(events.rows.map((e) => e.type)).toEqual(['account.phone.changed.v1', 'account.phone.changed.v1']);
  });

  it("lapses when the number is no longer the requester's; stale reviews expire", async () => {
    const recovered = await account();
    const requester = await account();
    const id = await recovery(recovered.id, requester, 'COOLDOWN', false);
    // the requester changed number meanwhile
    await owner.query(
      `update identity.phone_lookup_index set is_current_owner = false where account_phone_id in (select id from identity.account_phones where account_id = $1)`,
      [requester.id],
    );
    const stale = await recovery((await account()).id, await account(), 'MANUAL_REVIEW', true);
    await recoveryCompletionJob({ pool: worker, cipher, lookup, log }).handler(job(RECOVERY_COMPLETION_JOB));
    const statuses = await owner.query<{ id: string; status: string }>(`select id, status from identity.phone_change_requests where id = any($1::uuid[])`, [
      [id, stale],
    ]);
    expect(Object.fromEntries(statuses.rows.map((r) => [r.id, r.status]))).toEqual({ [id]: 'EXPIRED', [stale]: 'EXPIRED' });
    expect(await ownerOf(recovered.phone)).toBe(recovered.id);
    expect((await sessionStatus(recovered.session))?.status).toBe('ACTIVE');
  });
});

describe(DELETION_PROCESSING_JOB, () => {
  const deps = () => ({ pool: worker, vault, storage, log });
  async function request(accountId: string, due: boolean): Promise<string> {
    const id = randomUUID();
    await owner.query(`update identity.accounts set status = 'DELETION_PENDING' where id = $1`, [accountId]);
    await owner.query(
      `insert into identity.account_deletion_requests (id, account_id, channel, status, grace_until, created_at) values ($1, $2, 'APP', 'GRACE', now() + case when $3 then interval '-1 minute' else interval '14 days' end, now() - interval '20 days')`,
      [id, accountId, due],
    );
    return id;
  }
  async function evidence(accountId: string, legalHold = false): Promise<{ id: string; key: string }> {
    const app = randomUUID();
    const doc = randomUUID();
    const id = randomUUID();
    const key = `q/${randomBytes(16).toString('hex')}`;
    await owner.query(`insert into compliance.driver_applications (id, account_id, state, city_code) values ($1, $2, 'DOCUMENTS_PENDING', 'LHR')`, [
      app,
      accountId,
    ]);
    await owner.query(
      `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, status) values ($1, 'CNIC', 'DRIVER', $2, 'SUBMITTED')`,
      [doc, app],
    );
    await storage.putObject({ area: 'quarantine', key, body: randomBytes(64), contentType: 'image/jpeg' });
    await owner.query(
      `insert into vault.evidence_objects (id, owner_account_id, driver_application_id, compliance_document_id, kind, capture_source, declared_mime, declared_byte_size,
                                           status, quarantine_key, slot_expires_at, uploaded_at, source_byte_size, legal_hold)
       values ($1, $2, $3, $4, 'CNIC_FRONT', 'GALLERY_IMPORT', 'image/jpeg', 64, 'UPLOADED', $5, now() + interval '10 minutes', now(), 64, $6)`,
      [id, accountId, app, doc, key, legalHold],
    );
    return { id, key };
  }

  it('re-evaluates blockers (restrictions and evidence legal holds) and moves requests between GRACE and BLOCKED', async () => {
    const a = await account();
    const id = await request(a.id, true);
    const restriction = randomUUID();
    await owner.query(
      `insert into profile.restrictions (id, scope, account_id, reason_code, reason_class, status, appealable, created_by_system) values ($1, 'ACCOUNT', $2, 'COURT_ORDER', 'LEGAL', 'ACTIVE', false, 'test-fixture')`,
      [restriction, a.id],
    );
    await deletionProcessingJob(deps()).handler(job(DELETION_PROCESSING_JOB));
    const state = async () =>
      (
        await owner.query<{ status: string; open: string[] | null }>(
          `select r.status, array_agg(b.blocker_code) filter (where b.cleared_at is null) open from identity.account_deletion_requests r
             left join identity.deletion_request_blockers b on b.deletion_request_id = r.id where r.id = $1 group by r.status`,
          [id],
        )
      ).rows[0];
    expect(await state()).toEqual({ status: 'BLOCKED', open: ['LEGAL_HOLD'] });
    await owner.query(`update profile.restrictions set status = 'LIFTED', lifted_at = now(), lift_reason_code = 'ORDER_ENDED' where id = $1`, [restriction]);
    const held = await evidence(a.id, true);
    await deletionProcessingJob(deps()).handler(job(DELETION_PROCESSING_JOB));
    expect(await state()).toEqual({ status: 'BLOCKED', open: ['LEGAL_HOLD'] }); // the vault hold keeps it blocked
    await owner.query(`update vault.evidence_objects set legal_hold = false where id = $1`, [held.id]);
    await deletionProcessingJob(deps()).handler(job(DELETION_PROCESSING_JOB)); // → GRACE (due) …
    await deletionProcessingJob(deps()).handler(job(DELETION_PROCESSING_JOB)); // … → processed
    expect((await state())?.status).toBe('COMPLETED');
  });

  it('a due request erases evidence and pseudonymises the account; a request in grace is untouched', async () => {
    const a = await account();
    const waiting = await account();
    const id = await request(a.id, true);
    const later = await request(waiting.id, false);
    const ev = await evidence(a.id);
    await deletionProcessingJob(deps()).handler(job(DELETION_PROCESSING_JOB));
    expect((await owner.query<{ status: string }>(`select status from identity.account_deletion_requests where id = $1`, [id])).rows[0]?.status).toBe(
      'COMPLETED',
    );
    expect((await owner.query<{ status: string }>(`select status from identity.account_deletion_requests where id = $1`, [later])).rows[0]?.status).toBe(
      'GRACE',
    );
    const acct = (
      await owner.query<{ status: string; display_name: string | null; deleted: boolean }>(
        `select status, display_name, deleted_at is not null deleted from identity.accounts where id = $1`,
        [a.id],
      )
    ).rows[0];
    expect(acct).toEqual({ status: 'DELETED', display_name: null, deleted: true });
    const phones = await owner.query(
      `select 1 from identity.account_phones where account_id = $1 and (phone_envelope is not null or phone_last4 is not null)`,
      [a.id],
    );
    expect(phones.rowCount).toBe(0);
    expect(await ownerOf(a.phone)).toBeNull();
    expect(
      (
        await owner.query(`select 1 from identity.phone_lookup_index l join identity.account_phones p on p.id = l.account_phone_id where p.account_id = $1`, [
          a.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(await sessionStatus(a.session)).toEqual({ status: 'REVOKED', revoke_reason: 'ACCOUNT_DELETED' });
    const evidenceRow = (
      await owner.query<{ status: string; wrapped_dek: Buffer | null }>(`select status, wrapped_dek from vault.evidence_objects where id = $1`, [ev.id])
    ).rows[0];
    expect(evidenceRow).toEqual({ status: 'DISCARDED', wrapped_dek: null });
    expect(await storage.headObject({ area: 'quarantine', key: ev.key })).toBeNull();
    expect((await owner.query<{ state: string }>(`select state from compliance.driver_applications where account_id = $1`, [a.id])).rows[0]?.state).toBe(
      'WITHDRAWN',
    );
    // the number can start a brand-new account later; nothing links it to the tombstone
    expect((await sessionStatus(waiting.session))?.status).toBe('ACTIVE');
  });
});
