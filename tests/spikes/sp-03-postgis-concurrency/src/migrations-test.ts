// SP-03 migration validation: clean DB -> latest, previous schema -> latest, re-run no-op; Drizzle migrator and
// Kysely migrator over the same SQL files. Each scenario uses a freshly created database (dropped afterwards).
import { readdirSync, readFileSync, mkdtempSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import pg from 'pg';
import { DATABASE_URL } from './db.js';

const MIGRATIONS = resolve('drizzle');
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, pass: boolean, detail: string): void => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

async function withFreshDb<T>(name: string, fn: (url: string) => Promise<T>): Promise<T> {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name} template template0`);
  try {
    const url = new URL(DATABASE_URL);
    url.pathname = `/${name}`;
    return await fn(url.toString());
  } finally {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  }
}

/** Copy of the migrations folder truncated to the first `count` journal entries (simulates an older release). */
function truncatedMigrations(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'sp03-mig-'));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

type Facts = { tables: string[]; geogType: string | null; respondedAt: boolean; postgis: string | null; uniqueIdx: number };

async function schemaFacts(client: pg.Client): Promise<Facts> {
  const tables = (
    await client.query<{ t: string }>(
      `select table_name t from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`,
    )
  ).rows.map((r) => r.t);
  const geog = await client.query<{ t: string }>(
    `select format_type(atttypid, atttypmod) t from pg_attribute where attrelid = to_regclass('public.driver_presence') and attname='geog'`,
  );
  const ra = await client.query(`select 1 from information_schema.columns where table_name='offers' and column_name='responded_at'`);
  const pgis = await client.query<{ v: string }>(`select extversion v from pg_extension where extname='postgis'`);
  const ui = await client.query<{ n: string }>(
    `select count(*) n from pg_indexes where indexname in ('assignments_one_active_per_ride','assignments_one_active_per_driver')`,
  );
  return {
    tables,
    geogType: geog.rows[0]?.t ?? null,
    respondedAt: (ra.rowCount ?? 0) > 0,
    postgis: pgis.rows[0]?.v ?? null,
    uniqueIdx: Number(ui.rows[0]?.n ?? 0),
  };
}

async function drizzleScenarios(): Promise<void> {
  await withFreshDb('sp03_mig_clean', async (url) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const t0 = performance.now();
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    const ms = performance.now() - t0;
    const f = await schemaFacts(client);
    record(
      'drizzle: clean -> latest',
      f.postgis !== null && f.geogType === 'geography(Point,4326)' && f.respondedAt && f.uniqueIdx === 2,
      `${ms.toFixed(0)} ms; postgis ${f.postgis}; geog ${f.geogType}; tables ${f.tables.join(',')}`,
    );
    const applied = await client.query<{ n: string }>('select count(*) n from drizzle.__drizzle_migrations');
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    const again = await client.query<{ n: string }>('select count(*) n from drizzle.__drizzle_migrations');
    record(
      'drizzle: re-run is a no-op',
      applied.rows[0]?.n === again.rows[0]?.n && applied.rows[0]?.n === '4',
      `${applied.rows[0]?.n} -> ${again.rows[0]?.n} recorded migrations`,
    );
    await client.end();
  });
  await withFreshDb('sp03_mig_prev', async (url) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    await migrate(drizzle(client), { migrationsFolder: truncatedMigrations(3) });
    const before = await schemaFacts(client);
    // Insert data in the previous schema to prove the expand migration preserves it.
    await client.query(`insert into ride_requests(status) values ('SEARCHING')`);
    await client.query(`insert into offers(ride_id, driver_id, status, expires_at) values (1, 7, 'OFFERED', now() + interval '15 s')`);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    const after = await schemaFacts(client);
    const kept = await client.query<{ n: string }>(`select count(*) n from offers where responded_at is null`);
    record(
      'drizzle: previous schema (3 migrations) -> latest',
      !before.respondedAt && after.respondedAt && kept.rows[0]?.n === '1',
      `responded_at before=${before.respondedAt} after=${after.respondedAt}; pre-existing offer rows preserved=${kept.rows[0]?.n}`,
    );
    await client.end();
  });
}

/** Kysely migrator over the SAME SQL files (statement-breakpoint split), to compare tooling. */
function sqlFileProvider(): MigrationProvider {
  return {
    getMigrations: () => {
      const out: Record<string, Migration> = {};
      for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
        const statements = readFileSync(join(MIGRATIONS, file), 'utf8')
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean);
        out[file.replace(/\.sql$/, '')] = {
          up: async (db) => {
            for (const s of statements) await sql.raw(s).execute(db);
          },
        };
      }
      return Promise.resolve(out);
    },
  };
}

async function kyselyScenarios(): Promise<void> {
  await withFreshDb('sp03_mig_kysely', async (url) => {
    const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1 }) }) });
    const res = await new Migrator({ db, provider: sqlFileProvider() }).migrateToLatest();
    const ok = res.error === undefined && (res.results ?? []).every((r) => r.status === 'Success');
    const res2 = await new Migrator({ db, provider: sqlFileProvider() }).migrateToLatest();
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const f = await schemaFacts(client);
    await client.end();
    record(
      'kysely: clean -> latest (same SQL) + re-run no-op',
      ok && (res2.results ?? []).length === 0 && f.geogType === 'geography(Point,4326)',
      `${res.results?.length ?? 0} applied, re-run applied ${res2.results?.length ?? 0}; geog ${f.geogType}`,
    );
    await db.destroy();
  });
}

await drizzleScenarios();
await kyselyScenarios();
mkdirSync('results', { recursive: true });
writeFileSync('results/migrations.json', JSON.stringify({ at: new Date().toISOString(), checks }, null, 2) + '\n');
const failed = checks.filter((c) => !c.pass);
console.log(failed.length ? `MIGRATIONS: FAIL (${failed.length})` : 'MIGRATIONS: PASS');
process.exitCode = failed.length ? 1 : 0;
