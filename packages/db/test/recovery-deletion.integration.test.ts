/**
 * Migration 0007_recovery_deletion against real PostgreSQL: widened identity CHECKs (deleted accounts, released and
 * erased phones, session-bound OTP purposes), one open phone change / dormant review / deletion request per subject,
 * erasure only of closed requests, per-kind subjects of ACCOUNT_RECOVERY and REVERIFICATION cases, and GRANTS executed
 * as LOGIN members of the restricted roles (incl. the revoked vault column grant). Synthetic data only.
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

const envelope = () => randomBytes(40);
async function account(): Promise<{ account: string; session: string; phone: string }> {
  const id = randomUUID();
  const deviceId = randomUUID();
  const session = randomUUID();
  const phone = randomUUID();
  await owner.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [id]);
  await owner.query(
    `insert into identity.account_phones (id, account_id, phone_envelope, phone_last4, status, verified_at) values ($1, $2, $3, '1234', 'VERIFIED', now())`,
    [phone, id, envelope()],
  );
  await owner.query(
    `insert into identity.account_devices (id, account_id, installation_hash, platform, app_version, first_verified_at, last_seen_at, trust_state) values ($1, $2, $3, 'ANDROID', '1.0.0', now(), now(), 'NEW')`,
    [deviceId, id, randomBytes(32)],
  );
  await owner.query(
    `insert into identity.sessions (id, account_id, device_id, status, assurance, access_token_hash, access_expires_at, idle_expires_at, absolute_expires_at, app_version)
     values ($1, $2, $3, 'ACTIVE', 'OTP', $4, now() + interval '15 minutes', now() + interval '1 day', now() + interval '2 days', '1.0.0')`,
    [session, id, deviceId, randomBytes(32)],
  );
  return { account: id, session, phone };
}
const changeRequest = (accountId: string, kind: string, extra: { step?: string | null; by?: string | null; status?: string } = {}) =>
  owner.query(
    `insert into identity.phone_change_requests (id, account_id, kind, new_phone_envelope, new_phone_last4, new_phone_lookup_version, new_phone_lookup_hash, status,
                                                 step_up_session_id, requested_by_account_id, expires_at)
     values ($1, $2, $3, $4, '5678', 1, $5, $6, $7, $8, now() + interval '15 minutes') returning id`,
    [
      randomUUID(),
      accountId,
      kind,
      envelope(),
      randomBytes(32),
      extra.status ?? (kind === 'SELF_SERVICE' ? 'CURRENT_PHONE_VERIFIED' : 'MANUAL_REVIEW'),
      extra.step ?? null,
      extra.by ?? null,
    ],
  );

describe('identity CHECKs (0007)', () => {
  it('a deleted account is a tombstone; a phone is erased only when released for an account deletion', async () => {
    const a = await account();
    expect(await pgCode(owner.query(`update identity.accounts set status = 'DELETED' where id = $1`, [a.account]))).toBe('23514'); // needs deleted_at
    expect(
      await pgCode(owner.query(`update identity.accounts set status = 'DELETED', deleted_at = now(), display_name = 'X' where id = $1`, [a.account])),
    ).toBe('23514');
    await owner.query(`update identity.accounts set status = 'DELETION_PENDING' where id = $1`, [a.account]);
    expect(await pgCode(owner.query(`update identity.account_phones set status = 'RELEASED' where id = $1`, [a.phone]))).toBe('23514'); // needs reason + time
    expect(await pgCode(owner.query(`update identity.account_phones set phone_envelope = null, phone_last4 = null where id = $1`, [a.phone]))).toBe('23514');
    await owner.query(`update identity.account_phones set status = 'RELEASED', released_at = now(), release_reason = 'PHONE_CHANGED' where id = $1`, [a.phone]);
    expect(await pgCode(owner.query(`update identity.account_phones set phone_envelope = null, phone_last4 = null where id = $1`, [a.phone]))).toBe('23514');
    expect(
      await pgCode(owner.query(`update identity.account_phones set release_reason = 'ACCOUNT_DELETED', phone_envelope = null where id = $1`, [a.phone])),
    ).toBe('23514'); // both together
    await owner.query(`update identity.account_phones set release_reason = 'ACCOUNT_DELETED', phone_envelope = null, phone_last4 = null where id = $1`, [
      a.phone,
    ]);
    await owner.query(`update identity.accounts set status = 'DELETED', deleted_at = now() where id = $1`, [a.account]);
  });

  it('step-up and new-number codes are bound to a session; sign-in and web-deletion codes are not', async () => {
    const a = await account();
    const challenge = (purpose: string, session: string | null) =>
      owner.query(
        `insert into identity.otp_challenges (id, purpose, phone_lookup_key_version, phone_lookup_hash, phone_envelope, code_mac, mac_key_version, channel, locale, installation_hash,
                                              status, max_attempts, next_resend_at, expires_at, session_id)
         values ($1, $2, 1, $3, $4, $5, 1, 'SMS', 'en', $6, 'ISSUED', 5, now(), now() + interval '5 minutes', $7)`,
        [randomUUID(), purpose, randomBytes(32), envelope(), randomBytes(32), randomBytes(32), session],
      );
    expect(await pgCode(challenge('STEP_UP', null))).toBe('23514');
    expect(await pgCode(challenge('SIGN_IN', a.session))).toBe('23514');
    expect(await pgCode(challenge('UNKNOWN', null))).toBe('23514');
    await challenge('STEP_UP', a.session);
    await challenge('PHONE_CHANGE_NEW', a.session);
    await challenge('ACCOUNT_DELETION_WEB', null);
    expect(
      await pgCode(owner.query(`update identity.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'BOGUS' where id = $1`, [a.session])),
    ).toBe('23514');
    await owner.query(`update identity.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'PHONE_CHANGED' where id = $1`, [a.session]);
  });
});

describe('requests (0007)', () => {
  it('one open phone change or recovery per account; kinds bind their proof; numbers are erased only when closed', async () => {
    const a = await account();
    const requester = await account();
    expect(await pgCode(changeRequest(a.account, 'SELF_SERVICE'))).toBe('23514'); // needs the stepped-up session
    expect(await pgCode(changeRequest(a.account, 'RECOVERY_DRIVER_KYC'))).toBe('23514'); // needs the requester
    expect(await pgCode(changeRequest(a.account, 'RECOVERY_DRIVER_KYC', { by: a.account }))).toBe('23514'); // never itself
    expect(await pgCode(changeRequest(a.account, 'SELF_SERVICE', { step: a.session, status: 'MANUAL_REVIEW' }))).toBe('23514');
    const open = (await changeRequest(a.account, 'SELF_SERVICE', { step: a.session })).rows[0] as { id: string };
    expect(await pgCode(changeRequest(a.account, 'RECOVERY_DRIVER_KYC', { by: requester.account }))).toBe('23505');
    const erase = `update identity.phone_change_requests set new_phone_envelope = null, new_phone_last4 = null, new_phone_lookup_version = null, new_phone_lookup_hash = null where id = $1`;
    expect(await pgCode(owner.query(erase, [open.id]))).toBe('23514');
    await owner.query(`update identity.phone_change_requests set status = 'CANCELLED' where id = $1`, [open.id]);
    await owner.query(erase, [open.id]);
    expect(await pgCode(owner.query(`update identity.phone_change_requests set status = 'COOLDOWN' where id = $1`, [open.id]))).toBe('23514');
  });

  it('one open dormant review per session and one open deletion request per account; one open blocker per code', async () => {
    const a = await account();
    const review = () =>
      owner.query(`insert into identity.dormant_number_reviews (id, account_id, session_id, status) values ($1, $2, $3, 'PENDING') returning id`, [
        randomUUID(),
        a.account,
        a.session,
      ]);
    const r = (await review()).rows[0] as { id: string };
    expect(await pgCode(review())).toBe('23505');
    expect(
      await pgCode(owner.query(`update identity.dormant_number_reviews set status = 'RESOLVED_NEW_ACCOUNT', resolved_at = now() where id = $1`, [r.id])),
    ).toBe('23514');
    const deletion = () =>
      owner.query(
        `insert into identity.account_deletion_requests (id, account_id, channel, status, grace_until) values ($1, $2, 'APP', 'GRACE', now() + interval '14 days') returning id`,
        [randomUUID(), a.account],
      );
    const d = (await deletion()).rows[0] as { id: string };
    expect(await pgCode(deletion())).toBe('23505');
    const blocker = () =>
      owner.query(`insert into identity.deletion_request_blockers (id, deletion_request_id, blocker_code) values ($1, $2, 'LEGAL_HOLD')`, [randomUUID(), d.id]);
    await blocker();
    expect(await pgCode(blocker())).toBe('23505');
    expect(await pgCode(owner.query(`update identity.account_deletion_requests set status = 'COMPLETED' where id = $1`, [d.id]))).toBe('23514'); // completed_at
  });

  it('ACCOUNT_RECOVERY needs a driver profile and exactly one recovery subject; one open REVERIFICATION per profile', async () => {
    const a = await account();
    const requester = await account();
    const app = randomUUID();
    const profile = randomUUID();
    await owner.query(
      `insert into compliance.driver_applications (id, account_id, state, city_code, requirement_set_id, submitted_at) values ($1, $2, 'VERIFIED', 'LHR', '00000000-0000-7000-8000-00000000c0a0', now())`,
      [app, a.account],
    );
    await owner.query(
      `insert into compliance.driver_profiles (id, account_id, application_id, state, verified_legal_name_envelope, verified_date_of_birth_envelope) values ($1, $2, $3, 'VERIFIED', $4, $4)`,
      [profile, a.account, app, envelope()],
    );
    const pcr = ((await changeRequest(a.account, 'RECOVERY_DRIVER_KYC', { by: requester.account })).rows[0] as { id: string }).id;
    const review = (
      (
        await owner.query(`insert into identity.dormant_number_reviews (id, account_id, session_id, status) values ($1, $2, $3, 'IN_REVIEW') returning id`, [
          randomUUID(),
          a.account,
          a.session,
        ])
      ).rows[0] as { id: string }
    ).id;
    const kase = (kind: string, cols: { profile?: string | null; pcr?: string | null; review?: string | null }) =>
      owner.query(
        `insert into compliance.review_cases (id, kind, driver_profile_id, phone_change_request_id, dormant_number_review_id, city_code, status) values ($1, $2, $3, $4, $5, 'LHR', 'OPEN')`,
        [randomUUID(), kind, cols.profile ?? null, cols.pcr ?? null, cols.review ?? null],
      );
    expect(await pgCode(kase('ACCOUNT_RECOVERY', { pcr }))).toBe('23514'); // no profile
    expect(await pgCode(kase('ACCOUNT_RECOVERY', { profile, pcr, review }))).toBe('23514'); // both subjects
    expect(await pgCode(kase('ACCOUNT_RECOVERY', { profile }))).toBe('23514'); // neither
    expect(await pgCode(kase('REVERIFICATION', { profile, pcr }))).toBe('23514');
    await kase('ACCOUNT_RECOVERY', { profile, pcr });
    expect(await pgCode(kase('ACCOUNT_RECOVERY', { profile, pcr }))).toBe('23505');
    await kase('ACCOUNT_RECOVERY', { profile, review });
    await kase('REVERIFICATION', { profile });
    expect(await pgCode(kase('REVERIFICATION', { profile }))).toBe('23505');
  });
});

describe('grants executed as restricted roles (0007)', () => {
  it('the API releases phones but never rewrites numbers; the worker pseudonymises; the vault no longer reads review cases', async () => {
    const a = await account();
    await api.query(`update identity.account_phones set status = 'RELEASED', released_at = now(), release_reason = 'PHONE_CHANGED' where id = $1`, [a.phone]);
    expect(await pgCode(api.query(`update identity.account_phones set phone_envelope = null where id = $1`, [a.phone]))).toBe('42501');
    expect(await pgCode(api.query(`delete from identity.phone_lookup_index`))).toBe('42501');
    expect(await pgCode(api.query(`update identity.deletion_retention_exceptions set basis_ref = 'x'`))).toBe('42501');
    await worker.query(`update identity.accounts set status = 'DELETION_PENDING', version = version + 1 where id = $1`, [a.account]);
    expect(await pgCode(worker.query(`update identity.accounts set preferred_locale = 'ur' where id = $1`, [a.account]))).toBe('42501');
    expect(
      await pgCode(
        worker.query(`insert into identity.dormant_number_reviews (id, account_id, session_id, status) values ($1, $2, $3, 'PENDING')`, [
          randomUUID(),
          a.account,
          a.session,
        ]),
      ),
    ).toBe('42501');
    expect(
      await pgCode(
        worker.query(`insert into identity.deletion_retention_exceptions (deletion_request_id, data_category, basis_ref) values ($1, 'X_Y', 'abc')`, [
          randomUUID(),
        ]),
      ),
    ).toBe('42501');
    expect(await pgCode(vault.query(`select id from compliance.review_cases limit 1`))).toBe('42501');
  });
});
