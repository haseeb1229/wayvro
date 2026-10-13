/**
 * Migration 0011_geo_controls against real PostgreSQL: clean -> latest, every previous schema state -> latest, re-run
 * as a no-op; hour-bucket CHECK; one ACTIVE budget per (provider, SKU); maker-checker with the single-staff DECREASE
 * exception (proven against the ACTIVE row by the guard trigger); budget and alias guard triggers (immutability,
 * transitions, no delete); alias approver ≠ creator; grants executed as LOGIN members of wayvro_api / wayvro_worker /
 * wayvro_realtime; nothing for PUBLIC. Throwaway databases; synthetic data only.
 */
import { randomUUID } from 'node:crypto';
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

async function staff(): Promise<string> {
  const id = randomUUID();
  await owner.query(`insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'Synthetic', $2, 'ACTIVE', now())`, [
    id,
    `s-${id.slice(0, 8)}@example.org`,
  ]);
  return id;
}

interface BudgetValues {
  daily?: number;
  monthly?: number;
  cost?: number;
  kind?: 'INITIAL' | 'INCREASE' | 'DECREASE';
  thresholds?: number[];
}

let versionCounter = 0;
function insertBudget(pool: pg.Pool, pk: string, drafter: string, v: BudgetValues = {}): Promise<pg.QueryResult> {
  versionCounter++;
  return pool.query(
    `insert into geo.provider_budgets (id, provider_key, sku, version, status, daily_calls, monthly_calls, monthly_cost_micro_usd, alert_thresholds_pct, change_kind, drafted_by_staff_id)
     values ($1, $2, 'ROUTE', $3, 'DRAFT', $4, $5, $6, $7, $8, $9)`,
    [randomUUID(), pk, versionCounter, v.daily ?? 100, v.monthly ?? 1000, v.cost ?? 5_000_000, v.thresholds ?? [50, 80, 100], v.kind ?? 'INITIAL', drafter],
  );
}

async function activeBudget(pk: string, drafter: string, approver: string, v: BudgetValues = {}): Promise<string> {
  await insertBudget(api, pk, drafter, v);
  const id = (await owner.query<{ id: string }>(`select id from geo.provider_budgets where provider_key = $1 and version = $2`, [pk, versionCounter])).rows[0]
    ?.id;
  if (!id) throw new Error('budget missing');
  await api.query(`update geo.provider_budgets set status = 'PENDING_APPROVAL' where id = $1`, [id]);
  await api.query(`update geo.provider_budgets set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [id, approver]);
  await api.query(
    `update geo.provider_budgets set status = 'RETIRED', effective_until = now() where provider_key = $1 and sku = 'ROUTE' and status = 'ACTIVE'`,
    [pk],
  );
  await api.query(`update geo.provider_budgets set status = 'ACTIVE', effective_from = now() where id = $1`, [id]);
  return id;
}

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 3 });
  const apiLogin = await createRestrictedLogin(adminUrl, database.url, 'wayvro_api');
  const workerLogin = await createRestrictedLogin(adminUrl, database.url, 'wayvro_worker');
  const realtimeLogin = await createRestrictedLogin(adminUrl, database.url, 'wayvro_realtime');
  logins.push(apiLogin, workerLogin, realtimeLogin);
  api = new pg.Pool({ connectionString: apiLogin.url, max: 3 });
  worker = new pg.Pool({ connectionString: workerLogin.url, max: 2 });
  realtime = new pg.Pool({ connectionString: realtimeLogin.url, max: 1 });
});
afterAll(async () => {
  await Promise.all([owner.end(), api.end(), worker.end(), realtime.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

describe('0011 geo controls: migration lifecycle', () => {
  it('clean -> latest applied everything; re-running is a no-op', async () => {
    expect(await runMigrations(database.url)).toEqual({ appliedBefore: TOTAL_MIGRATIONS, appliedAfter: TOTAL_MIGRATIONS });
    const tables = await owner.query<{ t: string }>(`select table_name t from information_schema.tables where table_schema = 'geo' order by 1`);
    expect(tables.rows.map((r) => r.t)).toEqual(['landmark_aliases', 'provider_budgets', 'provider_usage']);
  });

  // Every previous supported schema state (after migrations 0..n-1) upgrades to latest, then re-runs as a no-op.
  for (let n = 1; n < TOTAL_MIGRATIONS; n++) {
    it(`previous (${MIGRATION_TAGS[n - 1] ?? '?'}) -> latest`, async () => {
      const previous = await createTestDatabase(adminUrl);
      try {
        await migrateFirst(previous.url, n);
        expect(await runMigrations(previous.url)).toEqual({ appliedBefore: n, appliedAfter: TOTAL_MIGRATIONS });
        expect(await runMigrations(previous.url)).toEqual({ appliedBefore: TOTAL_MIGRATIONS, appliedAfter: TOTAL_MIGRATIONS });
      } finally {
        await previous.drop();
      }
    });
  }

  it('every geo object is owned by wayvro_migrator and nothing is granted to PUBLIC', async () => {
    const owners = await owner.query<{ owner: string }>(
      `select distinct pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'geo'`,
    );
    expect(owners.rows.map((r) => r.owner)).toEqual(['wayvro_migrator']);
    expect((await owner.query(`select 1 from information_schema.role_table_grants where grantee = 'PUBLIC' and table_schema = 'geo'`)).rowCount).toBe(0);
    const fnPublic = await owner.query<{ p: string; ok: boolean }>(
      `select p.proname p, has_function_privilege('public', p.oid, 'execute') ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'geo'`,
    );
    expect(fnPublic.rows.map((r) => r.p).sort()).toEqual(['config_version_guard', 'landmark_alias_guard']);
    expect(fnPublic.rows.every((r) => !r.ok)).toBe(true);
  });
});

describe('0011 geo controls: provider budgets', () => {
  it('one ACTIVE budget per (provider, SKU); daily <= monthly and value ranges are enforced', async () => {
    const [maker, checker] = [await staff(), await staff()];
    await activeBudget('geo-one', maker, checker);
    // a second ACTIVE row without retiring the first hits the partial unique index
    await insertBudget(api, 'geo-one', maker, { kind: 'INCREASE', daily: 200 });
    const id = (await owner.query<{ id: string }>(`select id from geo.provider_budgets where provider_key = 'geo-one' and status = 'DRAFT'`)).rows[0]?.id;
    await api.query(`update geo.provider_budgets set status = 'PENDING_APPROVAL' where id = $1`, [id]);
    await api.query(`update geo.provider_budgets set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [id, checker]);
    expect(await pgCode(api.query(`update geo.provider_budgets set status = 'ACTIVE', effective_from = now() where id = $1`, [id]))).toBe('23505');
    expect(await pgCode(insertBudget(api, 'geo-one', maker, { daily: 2000, monthly: 1000 }))).toBe('23514');
    expect(await pgCode(insertBudget(api, 'geo-one', maker, { daily: -1 }))).toBe('23514');
    expect(await pgCode(insertBudget(api, 'geo-one', maker, { thresholds: [50, 60] }))).toBe('23514');
    expect(await pgCode(insertBudget(api, 'Geo One', maker))).toBe('23514');
  });

  it('maker-checker: the drafter cannot approve an INITIAL/INCREASE budget', async () => {
    const maker = await staff();
    await insertBudget(api, 'geo-two', maker);
    const id = (await owner.query<{ id: string }>(`select id from geo.provider_budgets where provider_key = 'geo-two'`)).rows[0]?.id;
    await api.query(`update geo.provider_budgets set status = 'PENDING_APPROVAL' where id = $1`, [id]);
    expect(await pgCode(api.query(`update geo.provider_budgets set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [id, maker]))).toBe('23514');
  });

  it('DECREASE: single-staff approval is allowed only for a real decrease of the ACTIVE budget', async () => {
    const [maker, checker] = [await staff(), await staff()];
    // no ACTIVE budget yet: nothing to decrease
    expect(await pgCode(insertBudget(api, 'geo-three', maker, { kind: 'DECREASE', daily: 10 }))).toBe('23514');
    await activeBudget('geo-three', maker, checker, { daily: 100, monthly: 1000, cost: 5_000_000 });
    // equal or higher on any dimension is not the safe direction
    expect(await pgCode(insertBudget(api, 'geo-three', maker, { kind: 'DECREASE', daily: 100, monthly: 1000, cost: 5_000_000 }))).toBe('23514');
    expect(await pgCode(insertBudget(api, 'geo-three', maker, { kind: 'DECREASE', daily: 50, monthly: 2000 }))).toBe('23514');
    await insertBudget(api, 'geo-three', maker, { kind: 'DECREASE', daily: 50, monthly: 1000, cost: 5_000_000 });
    const id = (await owner.query<{ id: string }>(`select id from geo.provider_budgets where provider_key = 'geo-three' and status = 'DRAFT'`)).rows[0]?.id;
    await api.query(`update geo.provider_budgets set status = 'PENDING_APPROVAL' where id = $1`, [id]);
    await api.query(`update geo.provider_budgets set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [id, maker]);
    await api.query(`update geo.provider_budgets set status = 'RETIRED', effective_until = now() where provider_key = 'geo-three' and status = 'ACTIVE'`);
    await api.query(`update geo.provider_budgets set status = 'ACTIVE', effective_from = now() where id = $1`, [id]);
    const active = await owner.query<{ daily_calls: number }>(
      `select daily_calls from geo.provider_budgets where provider_key = 'geo-three' and status = 'ACTIVE'`,
    );
    expect(active.rows).toEqual([{ daily_calls: 50 }]);
  });

  it('guard: values immutable, only the allowed transitions, no delete, no pre-approved insert', async () => {
    const [maker, checker] = [await staff(), await staff()];
    const id = await activeBudget('geo-four', maker, checker);
    expect(await pgCode(owner.query(`update geo.provider_budgets set daily_calls = 1 where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(owner.query(`update geo.provider_budgets set status = 'DRAFT' where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(owner.query(`update geo.provider_budgets set approved_by_staff_id = $2 where id = $1`, [id, maker]))).toBe('42501');
    expect(await pgCode(owner.query(`delete from geo.provider_budgets where id = $1`, [id]))).toBe('42501');
    expect(
      await pgCode(
        owner.query(
          `insert into geo.provider_budgets (id, provider_key, sku, version, status, daily_calls, monthly_calls, monthly_cost_micro_usd, change_kind, drafted_by_staff_id, approved_by_staff_id, effective_from)
           values ($1, 'geo-four', 'GEOCODE', 1, 'ACTIVE', 1, 1, 1, 'INITIAL', $2, $3, now())`,
          [randomUUID(), maker, checker],
        ),
      ),
    ).toBe('42501');
    await insertBudget(api, 'geo-four', maker, { kind: 'INCREASE', daily: 500 });
    const draft = (await owner.query<{ id: string }>(`select id from geo.provider_budgets where provider_key = 'geo-four' and status = 'DRAFT'`)).rows[0]?.id;
    expect(await pgCode(api.query(`update geo.provider_budgets set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [draft, checker]))).toBe(
      '42501',
    );
    await api.query(`update geo.provider_budgets set status = 'PENDING_APPROVAL' where id = $1`, [draft]);
    await api.query(`update geo.provider_budgets set status = 'REJECTED' where id = $1`, [draft]);
    expect(await pgCode(api.query(`update geo.provider_budgets set status = 'PENDING_APPROVAL' where id = $1`, [draft]))).toBe('42501');
    await api.query(`update geo.provider_budgets set status = 'RETIRED', effective_until = now() where id = $1`, [id]);
    expect(await pgCode(api.query(`update geo.provider_budgets set status = 'ACTIVE' where id = $1`, [id]))).toBe('42501');
  });
});

describe('0011 geo controls: usage and aliases', () => {
  it('hour buckets must be whole UTC hours; usage counters are non-negative', async () => {
    expect(
      await pgCode(worker.query(`insert into geo.provider_usage (provider_key, sku, hour_bucket, calls) values ('geo-a', 'ROUTE', '2026-10-13T05:30:00Z', 1)`)),
    ).toBe('23514');
    expect(
      await pgCode(
        worker.query(`insert into geo.provider_usage (provider_key, sku, hour_bucket, calls) values ('geo-a', 'ROUTE', '2026-10-13T05:00:00Z', -1)`),
      ),
    ).toBe('23514');
    // a whole UTC hour is accepted regardless of the session time zone (+05:30 here)
    const c = await worker.connect();
    try {
      await c.query(`set time zone 'Asia/Kolkata'`);
      await c.query(`insert into geo.provider_usage (provider_key, sku, hour_bucket, calls) values ('geo-a', 'ROUTE', '2026-10-13T05:00:00Z', 3)`);
    } finally {
      c.release();
    }
    await worker.query(
      `insert into geo.provider_usage (provider_key, sku, hour_bucket, calls) values ('geo-a', 'ROUTE', '2026-10-13T05:00:00Z', 4)
       on conflict (provider_key, sku, hour_bucket) do update set calls = excluded.calls, updated_at = now()`,
    );
    expect((await worker.query(`select calls from geo.provider_usage where provider_key = 'geo-a'`)).rows).toEqual([{ calls: '4' }]);
    await worker.query(`delete from geo.provider_usage where provider_key = 'geo-a'`);
  });

  it('aliases: approver ≠ creator, one ACTIVE per (city, locale, alias), content immutable, no delete', async () => {
    const [maker, checker] = [await staff(), await staff()];
    const insert = (alias: string) => {
      const id = randomUUID();
      return api
        .query(
          `insert into geo.landmark_aliases (id, city_code, locale, alias_normalised, alias_display, canonical_query, source, status, created_by_staff_id)
           values ($1, 'LHR', 'ur-Latn', $2, $2, 'liberty market', 'FOUNDER', 'PROPOSED', $3)`,
          [id, alias, maker],
        )
        .then(() => id);
    };
    const a = await insert('libarti');
    expect(await pgCode(api.query(`update geo.landmark_aliases set status = 'ACTIVE', approved_by_staff_id = $2 where id = $1`, [a, maker]))).toBe('23514');
    expect(await pgCode(api.query(`update geo.landmark_aliases set status = 'ACTIVE' where id = $1`, [a]))).toBe('42501');
    await api.query(`update geo.landmark_aliases set status = 'ACTIVE', approved_by_staff_id = $2 where id = $1`, [a, checker]);
    const b = await insert('libarti');
    expect(await pgCode(api.query(`update geo.landmark_aliases set status = 'ACTIVE', approved_by_staff_id = $2 where id = $1`, [b, checker]))).toBe('23505');
    expect(await pgCode(owner.query(`update geo.landmark_aliases set canonical_query = 'elsewhere' where id = $1`, [a]))).toBe('42501');
    expect(await pgCode(owner.query(`delete from geo.landmark_aliases where id = $1`, [a]))).toBe('42501');
    expect(
      await pgCode(
        api.query(
          `insert into geo.landmark_aliases (id, city_code, locale, alias_normalised, alias_display, canonical_query, source, status, created_by_staff_id, approved_by_staff_id)
           values ($1, 'LHR', 'en', 'x-alias', 'x', 'liberty market', 'FIELD', 'ACTIVE', $2, $3)`,
          [randomUUID(), maker, checker],
        ),
      ),
    ).toBe('42501');
    expect(
      await pgCode(
        api.query(
          `insert into geo.landmark_aliases (id, city_code, locale, alias_normalised, alias_display, canonical_query, source, status, created_by_staff_id)
           values ($1, 'LHR', 'fr', 'abc', 'abc', 'liberty market', 'FIELD', 'PROPOSED', $2)`,
          [randomUUID(), maker],
        ),
      ),
    ).toBe('23514');
    await api.query(`update geo.landmark_aliases set status = 'RETIRED' where id = $1`, [a]);
    await api.query(`update geo.landmark_aliases set status = 'RETIRED' where id = $1`, [b]);
  });
});

describe('0011 geo controls: grants (as restricted LOGIN roles)', () => {
  it('wayvro_api reads all, writes budgets/aliases only through column grants, never usage', async () => {
    expect((await api.query(`select count(*) from geo.provider_usage`)).rowCount).toBe(1);
    expect(await pgCode(api.query(`insert into geo.provider_usage (provider_key, sku, hour_bucket) values ('geo-a', 'ROUTE', '2026-10-13T06:00:00Z')`))).toBe(
      '42501',
    );
    expect(await pgCode(api.query(`update geo.provider_budgets set daily_calls = 1`))).toBe('42501');
    expect(await pgCode(api.query(`delete from geo.provider_budgets`))).toBe('42501');
    expect(await pgCode(api.query(`update geo.landmark_aliases set canonical_query = 'x'`))).toBe('42501');
  });

  it('wayvro_worker touches usage only; wayvro_realtime has no geo access', async () => {
    expect(await pgCode(worker.query(`select 1 from geo.provider_budgets`))).toBe('42501');
    expect(await pgCode(worker.query(`select 1 from geo.landmark_aliases`))).toBe('42501');
    expect(await pgCode(realtime.query(`select 1 from geo.provider_usage`))).toBe('42501');
    expect(await pgCode(realtime.query(`select 1 from geo.provider_budgets`))).toBe('42501');
  });
});
