/**
 * Migration 0009_support_closure against real PostgreSQL: the previous schema (with live rows) upgrades to latest and
 * re-runs as a no-op; the widened CHECKs accept exactly the new values (session revoke reason STAFF_ON_BEHALF, security
 * event SESSIONS_REVOKED_BY_SUPPORT) and still refuse unknown ones; executed as the LOGIN member of wayvro_api, which
 * writes both rows the support on-behalf revocation writes. Throwaway databases; synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';
import { MIGRATION_TAGS, TOTAL_MIGRATIONS, migrateFirst } from './journal.js';

/** The schema state just before 0009 (pinned by tag, so later migrations never shift it). */
const BEFORE_0009 = MIGRATION_TAGS.indexOf('0009_support_closure');

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
let login: RestrictedLogin;

/** account → device → ACTIVE OTP session (as the API would create them). */
async function session(pool: pg.Pool): Promise<{ account: string; session: string }> {
  const account = randomUUID();
  const device = randomUUID();
  const id = randomUUID();
  await pool.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [account]);
  await pool.query(
    `insert into identity.account_devices (id, account_id, installation_hash, platform, app_version, first_verified_at, last_seen_at, trust_state) values ($1, $2, $3, 'ANDROID', '1.0.0', now(), now(), 'NEW')`,
    [device, account, randomBytes(32)],
  );
  await pool.query(
    `insert into identity.sessions (id, account_id, device_id, status, assurance, access_token_hash, access_expires_at, idle_expires_at, absolute_expires_at, app_version)
     values ($1, $2, $3, 'ACTIVE', 'OTP', $4, now() + interval '15 minutes', now() + interval '1 day', now() + interval '2 days', '1.0.0')`,
    [id, account, device, randomBytes(32)],
  );
  return { account, session: id };
}

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 3 });
  login = await createRestrictedLogin(adminUrl, database.url, 'wayvro_api');
  api = new pg.Pool({ connectionString: login.url, max: 2 });
});
afterAll(async () => {
  await Promise.all([owner.end(), api.end()]);
  await login.drop();
  await database.drop();
});

describe('0009 support closure', () => {
  it('the previous schema with live rows upgrades to latest, then re-runs as a no-op', async () => {
    const previous = await createTestDatabase(adminUrl);
    try {
      await migrateFirst(previous.url, BEFORE_0009);
      const pool = new pg.Pool({ connectionString: previous.url, max: 1 });
      let s: { account: string; session: string };
      try {
        s = await session(pool);
        await pool.query(`update identity.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'USER_LOGOUT' where id = $1`, [s.session]);
        expect(await pgCode(pool.query(`update identity.sessions set revoke_reason = 'STAFF_ON_BEHALF' where id = $1`, [s.session]))).toBe('23514');
      } finally {
        await pool.end();
      }
      expect(await runMigrations(previous.url)).toEqual({ appliedBefore: BEFORE_0009, appliedAfter: TOTAL_MIGRATIONS });
      expect(await runMigrations(previous.url)).toEqual({ appliedBefore: TOTAL_MIGRATIONS, appliedAfter: TOTAL_MIGRATIONS });
      const after = new pg.Pool({ connectionString: previous.url, max: 1 });
      try {
        expect(
          (await after.query<{ revoke_reason: string }>(`select revoke_reason from identity.sessions where id = $1`, [s.session])).rows[0]?.revoke_reason,
        ).toBe('USER_LOGOUT');
      } finally {
        await after.end();
      }
    } finally {
      await previous.drop();
    }
  });

  it('the API role revokes on behalf (STAFF_ON_BEHALF) and records SESSIONS_REVOKED_BY_SUPPORT; unknown values stay refused', async () => {
    const s = await session(owner);
    await api.query(`update identity.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'STAFF_ON_BEHALF' where id = $1`, [s.session]);
    await api.query(`insert into identity.security_events (id, account_id, type) values ($1, $2, 'SESSIONS_REVOKED_BY_SUPPORT')`, [randomUUID(), s.account]);
    expect(
      (await owner.query(`select 1 from identity.security_events where account_id = $1 and type = 'SESSIONS_REVOKED_BY_SUPPORT'`, [s.account])).rowCount,
    ).toBe(1);
    const other = await session(owner);
    expect(
      await pgCode(
        api.query(`update identity.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'STAFF_BULK' where id = $1`, [other.session]),
      ),
    ).toBe('23514');
    expect(
      await pgCode(api.query(`insert into identity.security_events (id, account_id, type) values ($1, $2, 'SUPPORT_EXPORT')`, [randomUUID(), other.account])),
    ).toBe('23514');
    // the support capability writes no deletes: the API still cannot remove a session or a security event
    expect(await pgCode(api.query(`delete from identity.sessions where id = $1`, [other.session]))).toBe('42501');
    expect(await pgCode(api.query(`delete from identity.security_events where account_id = $1`, [s.account]))).toBe('42501');
  });
});
