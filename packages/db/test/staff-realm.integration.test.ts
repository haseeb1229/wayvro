/**
 * Migration 0003_staff_realm against real PostgreSQL: database-level guards of the staff realm (maker != checker,
 * break-glass ≤ 60 min, single live token per session, credential uniqueness, append-only access reasons, STAFF audit
 * actors) and grants executed as LOGIN members of the restricted roles — including that the API role reads audit data
 * only through the bounded viewer functions. Throwaway database; synthetic data only.
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
let realtime: pg.Pool;
const logins: RestrictedLogin[] = [];
async function poolAs(group: string): Promise<pg.Pool> {
  const login = await createRestrictedLogin(adminUrl, database.url, group);
  logins.push(login);
  return new pg.Pool({ connectionString: login.url, max: 2 });
}

async function staff(q: pg.Pool, status = 'ACTIVE'): Promise<string> {
  const id = randomUUID();
  await q.query(
    `insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'S', $2, $3, case when $3 = 'INVITED' then null else now() end)`,
    [id, `s.${id.slice(0, 8)}@example.org`, status],
  );
  return id;
}
async function credential(q: pg.Pool, staffId: string): Promise<string> {
  const id = randomUUID();
  await q.query(
    `insert into staff.webauthn_credentials (id, staff_id, credential_id, public_key, sign_count, device_type, backed_up, nickname, status) values ($1, $2, $3, $4, 0, 'singleDevice', false, 'k', 'ACTIVE')`,
    [id, staffId, randomBytes(32), randomBytes(77)],
  );
  return id;
}
async function session(q: pg.Pool, staffId: string, credId: string): Promise<string> {
  const id = randomUUID();
  await q.query(
    `insert into staff.sessions (id, staff_id, credential_id, status, token_hash, absolute_expires_at) values ($1, $2, $3, 'ACTIVE', $4, now() + interval '8 hours')`,
    [id, staffId, credId, randomBytes(32)],
  );
  return id;
}

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 3 });
  api = await poolAs('wayvro_api');
  worker = await poolAs('wayvro_worker');
  realtime = await poolAs('wayvro_realtime');
});

afterAll(async () => {
  await Promise.all([owner.end(), api.end(), worker.end(), realtime.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

describe('staff realm invariants (database level)', () => {
  it('maker-checker: approver differs from requester and grantee; requester never the grantee; one live assignment per role', async () => {
    const [a, b, c] = [await staff(api), await staff(api), await staff(api)];
    const ins = (id: string, grantee: string, requester: string | null, approver: string | null, status = 'PENDING_APPROVAL') =>
      api.query(
        `insert into staff.role_assignments (id, staff_id, role, status, requested_by, approved_by, valid_from) values ($1, $2, 'AUDITOR', $3, $4, $5, case when $3 = 'ACTIVE' then now() end)`,
        [id, grantee, status, requester, approver],
      );
    expect(await pgCode(ins(randomUUID(), a, a, null))).toBe('23514');
    expect(await pgCode(ins(randomUUID(), a, b, b, 'ACTIVE'))).toBe('23514');
    expect(await pgCode(ins(randomUUID(), a, b, a, 'ACTIVE'))).toBe('23514');
    await ins(randomUUID(), a, b, c, 'ACTIVE');
    expect(await pgCode(ins(randomUUID(), a, c, null))).toBe('23505');
  });

  it('break-glass grants are capped at 60 minutes, one active per staff member, never reviewed by the holder', async () => {
    const s = await staff(api);
    const sess = await session(api, s, await credential(api, s));
    const grant = (minutes: number) =>
      api.query(
        `insert into staff.break_glass_grants (id, staff_id, session_id, reason_code, justification, status, expires_at) values ($1, $2, $3, 'SYSTEM_RECOVERY', 'a sufficiently long justification', 'ACTIVE', now() + ($4::int * interval '1 minute'))`,
        [randomUUID(), s, sess, minutes],
      );
    expect(await pgCode(grant(61))).toBe('23514');
    await grant(60);
    expect(await pgCode(grant(10))).toBe('23505');
    expect(
      await pgCode(
        api.query(
          `update staff.break_glass_grants set status = 'REVIEWED', reviewed_by = staff_id, reviewed_at = now(), review_outcome = 'JUSTIFIED' where staff_id = $1`,
          [s],
        ),
      ),
    ).toBe('23514');
  });

  it('credentials and session tokens are unique; access reasons are append-only; audit accepts STAFF actors only with an id', async () => {
    const s = await staff(api);
    const cred = randomBytes(32);
    const insert = () =>
      api.query(
        `insert into staff.webauthn_credentials (id, staff_id, credential_id, public_key, sign_count, device_type, backed_up, nickname, status) values ($1, $2, $3, $4, 0, 'singleDevice', false, 'k', 'ACTIVE')`,
        [randomUUID(), s, cred, randomBytes(77)],
      );
    await insert();
    expect(await pgCode(insert())).toBe('23505');
    const sess = await session(api, s, await credential(api, s));
    await api.query(`insert into staff.access_reasons (id, staff_id, session_id, reason_code, audit_event_id) values ($1, $2, $3, 'CASE_REVIEW', $4)`, [
      randomUUID(),
      s,
      sess,
      randomUUID(),
    ]);
    expect(await pgCode(api.query(`update staff.access_reasons set reason_code = 'OTHER' where staff_id = $1`, [s]))).toBe('42501');
    expect(await pgCode(owner.query(`delete from staff.access_reasons where staff_id = $1`, [s]))).toBe('42501');
    expect(
      await pgCode(
        api.query(`insert into audit.audit_events (id, actor_type, action, object_type, outcome) values ($1, 'STAFF', 'X_PROBE', 'staff.probe', 'SUCCESS')`, [
          randomUUID(),
        ]),
      ),
    ).toBe('23514');
    await api.query(
      `insert into audit.audit_events (id, actor_type, actor_id, action, object_type, outcome) values ($1, 'STAFF', $2, 'X_PROBE', 'staff.probe', 'SUCCESS')`,
      [randomUUID(), s],
    );
  });

  it('only the seeded city exists and assignment cities need a real city', async () => {
    expect((await owner.query(`select code from catalog.cities`)).rows).toEqual([{ code: 'LHR' }]);
    const [a, b, c] = [await staff(api), await staff(api), await staff(api)];
    const id = randomUUID();
    await api.query(
      `insert into staff.role_assignments (id, staff_id, role, status, requested_by, approved_by, valid_from) values ($1, $2, 'KYC_REVIEWER', 'ACTIVE', $3, $4, now())`,
      [id, a, b, c],
    );
    expect(await pgCode(api.query(`insert into staff.role_assignment_cities (assignment_id, city_code) values ($1, 'KHI')`, [id]))).toBe('23503');
  });
});

describe('grants executed as restricted roles', () => {
  it('wayvro_api: no direct audit reads; bounded viewer functions only (max 100 rows)', async () => {
    expect(await pgCode(api.query(`select * from audit.audit_events`))).toBe('42501');
    expect(await pgCode(api.query(`select * from audit.seal_verifications`))).toBe('42501');
    for (let i = 0; i < 120; i++) {
      await api.query(
        `insert into audit.audit_events (id, actor_type, action, object_type, outcome) values ($1, 'SYSTEM', 'BULK_PROBE', 'platform.probe', 'SUCCESS')`,
        [randomUUID()],
      );
    }
    const page = await api.query(`select * from audit.list_events(null, 100000, null, null, 'BULK_PROBE', null, null)`);
    expect(page.rowCount).toBe(100);
    expect((await api.query(`select * from audit.seal_status()`)).rowCount).toBe(1);
    expect(await pgCode(api.query(`delete from staff.staff_accounts`))).toBe('42501');
  });

  it('wayvro_worker: housekeeping columns only; wayvro_realtime: no staff access', async () => {
    expect(await pgCode(worker.query(`select work_email from staff.staff_accounts`))).toBe('42501');
    expect(await pgCode(worker.query(`select justification from staff.break_glass_grants`))).toBe('42501');
    await worker.query(`update staff.break_glass_grants set status = 'EXPIRED', ended_at = expires_at where status = 'ACTIVE' and expires_at <= now()`);
    expect(await pgCode(realtime.query(`select 1 from staff.sessions`))).toBe('42501');
  });

  it('wayvro_audit_sealer records verification results append-only', async () => {
    const sealer = await poolAs('wayvro_audit_sealer');
    try {
      await sealer.query(`insert into audit.seal_verifications (seals_checked, ok, first_bad_seal_no, unsealed_below_watermark) values (0, true, null, 0)`);
      expect(
        await pgCode(
          sealer.query(`insert into audit.seal_verifications (seals_checked, ok, first_bad_seal_no, unsealed_below_watermark) values (1, true, 1, 0)`),
        ),
      ).toBe('23514');
      expect(await pgCode(owner.query(`update audit.seal_verifications set ok = false`))).toBe('42501');
    } finally {
      await sealer.end();
    }
  });
});
