/**
 * Migration 0013_platform_release_controls against real PostgreSQL: every previous schema state (with live rows)
 * upgrades to latest and re-runs as a no-op; database invariants (one ACTIVE version policy per platform, maker-checker
 * CHECKs, status transitions and value immutability, DRAFT-only non-overlapping blocked build ranges, the FROM_SAFE
 * maker-checker CHECK, append-only switch history) and grants executed as LOGIN members of the restricted roles.
 * Throwaway databases; synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';
import { MIGRATION_TAGS, TOTAL_MIGRATIONS, migrateFirst } from './journal.js';

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
async function poolAs(url: string, group: string): Promise<pg.Pool> {
  const login = await createRestrictedLogin(adminUrl, url, group);
  logins.push(login);
  return new pg.Pool({ connectionString: login.url, max: 2 });
}

/** An ACTIVE synthetic staff account (FK target of drafter/approver/changer columns). */
async function staffAccount(q: pg.Pool): Promise<string> {
  const id = randomUUID();
  await q.query(`insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'Synthetic', $2, 'ACTIVE', now())`, [
    id,
    `s.${randomBytes(4).toString('hex')}@example.org`,
  ]);
  return id;
}

let platformCounter = 0;
async function draftPolicy(q: pg.Pool, drafter: string, platform: 'ANDROID' | 'IOS' = 'ANDROID'): Promise<string> {
  const id = randomUUID();
  platformCounter++;
  await q.query(
    `insert into platform.app_version_policies (id, platform, version, status, min_supported_build, recommended_build, soft_message_key, hard_message_key, drafted_by_staff_id)
     values ($1, $2, $3, 'DRAFT', 10, 20, 'release.soft.default', 'release.hard.default', $4)`,
    [id, platform, platformCounter, drafter],
  );
  return id;
}
const setStatus = (q: pg.Pool, id: string, sql: string, params: unknown[] = []) =>
  q.query(`update platform.app_version_policies set ${sql} where id = $1`, [id, ...params]);
async function approved(q: pg.Pool, drafter: string, approver: string, platform: 'ANDROID' | 'IOS' = 'ANDROID'): Promise<string> {
  const id = await draftPolicy(q, drafter, platform);
  await setStatus(q, id, `status = 'PENDING_APPROVAL'`);
  await setStatus(q, id, `status = 'APPROVED', approved_by_staff_id = $2`, [approver]);
  return id;
}

const switchRow = (
  q: pg.Pool,
  values: { key?: string; scope?: string; city?: string | null; state?: string; changer?: string | null; approver?: string | null },
) =>
  q.query(
    `insert into platform.runtime_switches (id, key, scope, city_code, state, reason_code, changed_by_staff_id, approved_by_staff_id) values ($1, $2, $3, $4, $5, 'OPS_INCIDENT', $6, $7)`,
    [
      randomUUID(),
      values.key ?? 'rider.quotes',
      values.scope ?? 'ALL',
      values.city ?? null,
      values.state ?? 'DISABLED',
      values.changer ?? null,
      values.approver ?? null,
    ],
  );

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 3 });
  api = await poolAs(database.url, 'wayvro_api');
  worker = await poolAs(database.url, 'wayvro_worker');
  realtime = await poolAs(database.url, 'wayvro_realtime');
});
afterAll(async () => {
  await Promise.all([owner.end(), api.end(), worker.end(), realtime.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

describe('0013 upgrade path', () => {
  it('0013 is the latest migration in this tree', () => {
    expect(MIGRATION_TAGS[TOTAL_MIGRATIONS - 1]).toBe('0013_platform_release_controls');
  });

  it('every previous schema state upgrades to latest, then re-runs as a no-op', async () => {
    for (let n = 0; n < TOTAL_MIGRATIONS; n++) {
      const previous = await createTestDatabase(adminUrl);
      try {
        if (n > 0) await migrateFirst(previous.url, n);
        expect(await runMigrations(previous.url)).toEqual({ appliedBefore: n, appliedAfter: TOTAL_MIGRATIONS });
        expect(await runMigrations(previous.url)).toEqual({ appliedBefore: TOTAL_MIGRATIONS, appliedAfter: TOTAL_MIGRATIONS });
      } finally {
        await previous.drop();
      }
    }
  }, 300_000);

  it('a live previous database (staff, sessions, jobs, outbox) upgrades without touching existing rows', async () => {
    const previous = await createTestDatabase(adminUrl);
    try {
      await migrateFirst(previous.url, TOTAL_MIGRATIONS - 1);
      const pool = new pg.Pool({ connectionString: previous.url, max: 1 });
      let staffId: string;
      const accountId = randomUUID();
      const eventId = randomUUID();
      try {
        staffId = await staffAccount(pool);
        await pool.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [accountId]);
        await pool.query(
          `insert into platform.outbox_events (id, type, aggregate_type, aggregate_id, account_id, status) values ($1, 'restriction.changed.v1', 'profile.restriction', $2, $3, 'PENDING')`,
          [eventId, randomUUID(), accountId],
        );
        expect((await pool.query(`select to_regclass('platform.app_version_policies') r`)).rows[0]).toEqual({ r: null });
      } finally {
        await pool.end();
      }
      expect(await runMigrations(previous.url)).toEqual({ appliedBefore: TOTAL_MIGRATIONS - 1, appliedAfter: TOTAL_MIGRATIONS });
      const after = new pg.Pool({ connectionString: previous.url, max: 1 });
      try {
        expect((await after.query(`select status from staff.staff_accounts where id = $1`, [staffId])).rows).toEqual([{ status: 'ACTIVE' }]);
        expect((await after.query(`select status, type from platform.outbox_events where id = $1`, [eventId])).rows).toEqual([
          { status: 'PENDING', type: 'restriction.changed.v1' },
        ]);
        // nothing is seeded: no policy (state OK) and no switch row (registry defaults)
        expect((await after.query(`select count(*)::int n from platform.app_version_policies`)).rows[0]).toEqual({ n: 0 });
        expect((await after.query(`select count(*)::int n from platform.runtime_switches`)).rows[0]).toEqual({ n: 0 });
        // a policy can be drafted against the pre-existing staff row
        await after.query(
          `insert into platform.app_version_policies (id, platform, version, status, min_supported_build, recommended_build, soft_message_key, hard_message_key, drafted_by_staff_id)
           values ($1, 'IOS', 1, 'DRAFT', 0, 0, 'release.soft.default', 'release.hard.default', $2)`,
          [randomUUID(), staffId],
        );
      } finally {
        await after.end();
      }
    } finally {
      await previous.drop();
    }
  });
});

describe('app version policies', () => {
  it('one ACTIVE policy per platform; ACTIVE needs effective_from; the approver is never the drafter', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    const first = await approved(api, a, b, 'IOS');
    await setStatus(api, first, `status = 'ACTIVE', effective_from = now()`);
    const second = await approved(api, a, b, 'IOS');
    expect(await pgCode(setStatus(api, second, `status = 'ACTIVE', effective_from = now()`))).toBe('23505');
    // retire first, then the second may become ACTIVE
    await setStatus(api, first, `status = 'RETIRED', effective_until = now()`);
    await setStatus(api, second, `status = 'ACTIVE', effective_from = now()`);
    // the guard refuses ACTIVE without effective_from (before the CHECK would)
    expect(await pgCode(setStatus(api, await approved(api, a, b, 'IOS'), `status = 'ACTIVE'`))).toBe('42501');
    const self = await draftPolicy(api, a);
    await setStatus(api, self, `status = 'PENDING_APPROVAL'`);
    expect(await pgCode(setStatus(api, self, `status = 'APPROVED', approved_by_staff_id = $2`, [a]))).toBe('23514');
    expect(await pgCode(setStatus(api, self, `status = 'APPROVED'`))).toBe('42501');
  });

  it('recommended >= minimum and message/store keys are shape-checked', async () => {
    const a = await staffAccount(owner);
    const insert = (min: number, rec: number, store: string | null, soft = 'release.soft.default') =>
      api.query(
        `insert into platform.app_version_policies (id, platform, version, status, min_supported_build, recommended_build, store_url_key, soft_message_key, hard_message_key, drafted_by_staff_id)
         values ($1, 'ANDROID', $2, 'DRAFT', $3, $4, $5, $6, 'release.hard.default', $7)`,
        [randomUUID(), 1000 + platformCounter++, min, rec, store, soft, a],
      );
    expect(await pgCode(insert(10, 9, null))).toBe('23514');
    expect(await pgCode(insert(-1, 9, null))).toBe('23514');
    expect(await pgCode(insert(1, 2, 'https://example.org/app'))).toBe('23514');
    expect(await pgCode(insert(1, 2, null, 'Free text message'))).toBe('23514');
    await insert(1, 2, 'store.android');
  });

  it('guard: no delete, values immutable after submission, only the allowed transitions, schedule only while APPROVED', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    const id = await draftPolicy(api, a);
    await setStatus(api, id, `min_supported_build = 11, recommended_build = 21`);
    expect(await pgCode(setStatus(api, id, `status = 'ACTIVE', effective_from = now()`))).toBe('42501');
    expect(await pgCode(setStatus(api, id, `effective_from = now() + interval '1 day'`))).toBe('42501');
    await setStatus(api, id, `status = 'PENDING_APPROVAL'`);
    expect(await pgCode(setStatus(api, id, `min_supported_build = 12`))).toBe('42501');
    expect(await pgCode(setStatus(api, id, `status = 'DRAFT'`))).toBe('42501');
    await setStatus(api, id, `status = 'APPROVED', approved_by_staff_id = $2`, [b]);
    await setStatus(api, id, `effective_from = now() + interval '1 hour', scheduled = true`);
    await setStatus(api, id, `effective_from = null, scheduled = false`);
    expect(await pgCode(setStatus(api, id, `scheduled = true`))).toBe('23514');
    expect(await pgCode(setStatus(api, id, `approved_by_staff_id = $2`, [a]))).toBe('42501');
    await setStatus(api, id, `status = 'ACTIVE', effective_from = now()`);
    expect(await pgCode(setStatus(api, id, `effective_from = now() - interval '1 day'`))).toBe('42501');
    expect(await pgCode(setStatus(api, id, `status = 'APPROVED'`))).toBe('42501');
    expect(await pgCode(setStatus(api, id, `status = 'RETIRED'`))).toBe('42501');
    await setStatus(api, id, `status = 'RETIRED', effective_until = now()`);
    expect(await pgCode(setStatus(api, id, `status = 'ACTIVE'`))).toBe('42501');
    expect(await pgCode(owner.query(`delete from platform.app_version_policies where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(owner.query(`truncate platform.app_version_policies cascade`))).toBe('42501');
    const rejected = await draftPolicy(api, a);
    await setStatus(api, rejected, `status = 'PENDING_APPROVAL'`);
    await setStatus(api, rejected, `status = 'REJECTED'`);
    expect(await pgCode(setStatus(api, rejected, `status = 'PENDING_APPROVAL'`))).toBe('42501');
  });

  it('blocked ranges: bounded, non-overlapping per policy (guard trigger), DRAFT-only, reason-coded', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    const id = await draftPolicy(api, a);
    const add = (range: string, reason = 'SECURITY', policy = id) =>
      api.query(`insert into platform.app_blocked_builds (policy_id, builds, reason_code) values ($1, $2::int4range, $3)`, [policy, range, reason]);
    await add('[100,110]');
    expect(await pgCode(add('[105,120]'))).toBe('23P01');
    expect(await pgCode(add('[110,110]', 'DATA_CORRUPTION'))).toBe('23P01');
    await add('[111,111]', 'DATA_CORRUPTION');
    expect(await pgCode(add('[500,)'))).toBe('23514');
    expect(await pgCode(add('(,5]'))).toBe('23514');
    expect(await pgCode(add('[7,7)'))).toBe('23514');
    expect(await pgCode(add('[200,210]', 'BECAUSE'))).toBe('23514');
    // the same range in ANOTHER policy is fine
    await add('[100,110]', 'SECURITY', await draftPolicy(api, a));
    // edit = delete + insert while DRAFT
    await api.query(`delete from platform.app_blocked_builds where policy_id = $1 and builds = '[111,111]'::int4range`, [id]);
    await add('[111,115]', 'CONTRACT_BREAK');
    await setStatus(api, id, `status = 'PENDING_APPROVAL'`);
    expect(await pgCode(add('[300,301]'))).toBe('42501');
    expect(await pgCode(api.query(`delete from platform.app_blocked_builds where policy_id = $1`, [id]))).toBe('42501');
    await setStatus(api, id, `status = 'APPROVED', approved_by_staff_id = $2`, [b]);
    expect(await pgCode(add('[300,301]'))).toBe('42501');
    const ranges = await owner.query(`select builds::text, reason_code from platform.app_blocked_builds where policy_id = $1 order by builds`, [id]);
    expect(ranges.rows).toEqual([
      { builds: '[100,111)', reason_code: 'SECURITY' },
      { builds: '[111,116)', reason_code: 'CONTRACT_BREAK' },
    ]);
  });
});

describe('runtime switches', () => {
  it('one row per (key, scope, city) with NULL city as a value; key shape, scope and city FK checked', async () => {
    const a = await staffAccount(owner);
    await switchRow(api, { key: 'platform.geo-routing', changer: a });
    expect(await pgCode(switchRow(api, { key: 'platform.geo-routing', changer: a }))).toBe('23505');
    await switchRow(api, { key: 'platform.geo-routing', city: 'LHR', changer: a });
    await switchRow(api, { key: 'platform.geo-routing', scope: 'RIDER', changer: a });
    expect(await pgCode(switchRow(api, { key: 'platform.geo-routing', city: 'XXX', scope: 'DRIVER', changer: a }))).toBe('23503');
    expect(await pgCode(switchRow(api, { key: 'Platform.Bad', changer: a }))).toBe('23514');
    expect(await pgCode(switchRow(api, { key: 'admin.anything', changer: a }))).toBe('23514');
    expect(await pgCode(switchRow(api, { key: 'rider.x', scope: 'STAFF', changer: a }))).toBe('23514');
    expect(await pgCode(switchRow(api, { key: 'rider.y', changer: a, approver: a }))).toBe('23514');
  });

  const change = (
    q: pg.Pool,
    v: { direction: string; status: string; requester: string | null; approver?: string | null; from?: string; to?: string; decided?: boolean; key?: string },
  ) =>
    q.query(
      `insert into platform.runtime_switch_changes (id, switch_key, scope, from_state, to_state, direction, status, requested_by_staff_id, approved_by_staff_id, reason_code, decided_at)
       values ($1, $2, 'ALL', $3, $4, $5, $6, $7, $8, 'OPS_INCIDENT', case when $9 then now() end) returning id`,
      [
        randomUUID(),
        v.key ?? 'rider.quotes',
        v.from ?? 'DISABLED',
        v.to ?? 'ENABLED',
        v.direction,
        v.status,
        v.requester,
        v.approver ?? null,
        v.decided ?? v.status !== 'PENDING_APPROVAL',
      ],
    );

  it('FROM_SAFE is applied only with an approver different from the requester (database CHECK)', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    expect(await pgCode(change(api, { direction: 'FROM_SAFE', status: 'APPLIED', requester: a }))).toBe('23514');
    expect(await pgCode(change(api, { direction: 'FROM_SAFE', status: 'APPLIED', requester: a, approver: a }))).toBe('23514');
    await change(api, { direction: 'FROM_SAFE', status: 'APPLIED', requester: a, approver: b, key: 'platform.geo-reverse' });
    // TO_SAFE: single staff member, applied immediately, never "approved"
    await change(api, { direction: 'TO_SAFE', status: 'APPLIED', requester: a, from: 'ENABLED', to: 'DISABLED' });
    expect(await pgCode(change(api, { direction: 'TO_SAFE', status: 'PENDING_APPROVAL', requester: a, from: 'ENABLED', to: 'DISABLED' }))).toBe('23514');
    expect(await pgCode(change(api, { direction: 'TO_SAFE', status: 'APPLIED', requester: a, approver: b, from: 'ENABLED', to: 'DISABLED' }))).toBe('23514');
    // EXPIRY: system only (no staff requester)
    expect(await pgCode(change(api, { direction: 'EXPIRY', status: 'APPLIED', requester: a }))).toBe('23514');
    await change(worker, { direction: 'EXPIRY', status: 'APPLIED', requester: null });
    expect(await pgCode(change(api, { direction: 'TO_SAFE', status: 'APPLIED', requester: null, from: 'ENABLED', to: 'DISABLED' }))).toBe('23514');
    // no-op changes and undecided terminal rows are refused
    expect(await pgCode(change(api, { direction: 'TO_SAFE', status: 'APPLIED', requester: a, from: 'DISABLED', to: 'DISABLED' }))).toBe('23514');
    expect(await pgCode(change(api, { direction: 'FROM_SAFE', status: 'PENDING_APPROVAL', requester: a, decided: true }))).toBe('23514');
  });

  it('one pending request per target; history is append-only except the decision of a pending row', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    const pending = (await change(api, { direction: 'FROM_SAFE', status: 'PENDING_APPROVAL', requester: a, key: 'platform.geo-geocode' })).rows[0] as {
      id: string;
    };
    expect(await pgCode(change(api, { direction: 'FROM_SAFE', status: 'PENDING_APPROVAL', requester: b, key: 'platform.geo-geocode' }))).toBe('23505');
    expect(
      await pgCode(
        api.query(`update platform.runtime_switch_changes set status = 'APPLIED', approved_by_staff_id = $2, decided_at = now() where id = $1`, [
          pending.id,
          a,
        ]),
      ),
    ).toBe('23514');
    await api.query(`update platform.runtime_switch_changes set status = 'APPLIED', approved_by_staff_id = $2, decided_at = now() where id = $1`, [
      pending.id,
      b,
    ]);
    expect(
      await pgCode(api.query(`update platform.runtime_switch_changes set status = 'REJECTED', approved_by_staff_id = null where id = $1`, [pending.id])),
    ).toBe('42501');
    expect(await pgCode(owner.query(`update platform.runtime_switch_changes set reason_code = 'REWRITTEN' where id = $1`, [pending.id]))).toBe('42501');
    expect(await pgCode(owner.query(`delete from platform.runtime_switch_changes where id = $1`, [pending.id]))).toBe('42501');
    expect(await pgCode(owner.query(`truncate platform.runtime_switch_changes`))).toBe('42501');
    // after the decision a new request for the same target may be filed; a rejected request records no approver
    const next = (await change(api, { direction: 'FROM_SAFE', status: 'PENDING_APPROVAL', requester: a, key: 'platform.geo-geocode' })).rows[0] as {
      id: string;
    };
    expect(
      await pgCode(
        api.query(`update platform.runtime_switch_changes set status = 'REJECTED', approved_by_staff_id = $2, decided_at = now() where id = $1`, [next.id, b]),
      ),
    ).toBe('23514');
    await api.query(`update platform.runtime_switch_changes set status = 'REJECTED', decided_at = now() where id = $1`, [next.id]);
  });
});

describe('grants (least privilege)', () => {
  it('wayvro_api: reads all four tables, writes the allowed columns only, never deletes policies, switches or history', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    const id = await approved(api, a, b);
    expect(await pgCode(api.query(`update platform.app_version_policies set created_at = now() where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(api.query(`update platform.app_version_policies set drafted_by_staff_id = $2 where id = $1`, [id, b]))).toBe('42501');
    await switchRow(api, { key: 'platform.geo-autocomplete', changer: a });
    expect(await pgCode(api.query(`update platform.runtime_switches set key = 'rider.quotes' where key = 'platform.geo-autocomplete'`))).toBe('42501');
    expect(await pgCode(api.query(`delete from platform.runtime_switches`))).toBe('42501');
    expect(await pgCode(api.query(`update platform.runtime_switch_changes set reason_code = 'X_Y_Z'`))).toBe('42501');
  });

  it('wayvro_worker: activates and expires but cannot draft, approve, edit values or write ranges', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    const id = await approved(api, a, b, 'IOS');
    await owner.query(`update platform.app_version_policies set status = 'RETIRED', effective_until = now() where platform = 'IOS' and status = 'ACTIVE'`);
    await worker.query(`update platform.app_version_policies set status = 'ACTIVE', effective_from = now(), version_lock = version_lock + 1 where id = $1`, [
      id,
    ]);
    expect(await pgCode(worker.query(`update platform.app_version_policies set min_supported_build = 0 where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(worker.query(`update platform.app_version_policies set approved_by_staff_id = $2 where id = $1`, [id, a]))).toBe('42501');
    expect(await pgCode(draftPolicy(worker, a))).toBe('42501');
    expect(await pgCode(worker.query(`insert into platform.app_blocked_builds (policy_id, builds, reason_code) values ($1, '[1,2]', 'SECURITY')`, [id]))).toBe(
      '42501',
    );
    expect(await pgCode(switchRow(worker, { key: 'ops.anything' }))).toBe('42501');
    await switchRow(api, { key: 'driver.anything', changer: a });
    await worker.query(
      `update platform.runtime_switches set state = 'ENABLED', reason_code = 'EFFECTIVE_UNTIL_REACHED', changed_by_staff_id = null, effective_until = null, updated_at = now(), version = version + 1 where key = 'driver.anything'`,
    );
    expect(await pgCode(worker.query(`update platform.runtime_switch_changes set status = 'APPLIED'`))).toBe('42501');
  });

  it('wayvro_realtime and PUBLIC hold nothing on the new tables', async () => {
    for (const table of ['app_version_policies', 'app_blocked_builds', 'runtime_switches', 'runtime_switch_changes']) {
      expect(await pgCode(realtime.query(`select 1 from platform.${table} limit 1`))).toBe('42501');
      const publicGrants = await owner.query(
        `select privilege_type from information_schema.role_table_grants where table_schema = 'platform' and table_name = $1 and grantee = 'PUBLIC'`,
        [table],
      );
      expect(publicGrants.rowCount).toBe(0);
    }
    const fnGrants = await owner.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'platform' and p.proname in ('app_version_policy_guard','app_blocked_builds_guard','runtime_switch_change_guard')
          and has_function_privilege('public', p.oid, 'EXECUTE')`,
    );
    expect(fnGrants.rowCount).toBe(0);
  });
});
