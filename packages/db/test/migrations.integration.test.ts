/**
 * Integration: real PostgreSQL + PostGIS from `pnpm infra:up` (or the CI service). Each test creates and drops its
 * own throwaway database, so the shared local database is never wiped or reseeded (CLAUDE.md §6).
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateFromEnvironment } from '../src/cli.js';
import { createDatabase, runMigrations } from '../src/index.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required for integration tests (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;

const dbName = `wayvro_it_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName} template template0`);
  await admin.end();
});

afterAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

describe('migrations against real PostgreSQL + PostGIS', () => {
  it('migrate from a clean database installs PostGIS and the identity core', async () => {
    const result = await runMigrations(testUrl);
    expect(result).toEqual({ appliedBefore: 0, appliedAfter: 2 });
    const c = new pg.Client({ connectionString: testUrl });
    await c.connect();
    const ext = await c.query<{ extversion: string }>(`select extversion from pg_extension where extname = 'postgis'`);
    const geo = await c.query<{ d: number }>(
      `select ST_Distance('SRID=4326;POINT(74.3587 31.5204)'::geography, 'SRID=4326;POINT(74.3426 31.5161)'::geography) d`,
    );
    await c.end();
    expect(ext.rows[0]?.extversion).toMatch(/^3\.5\./);
    expect(geo.rows[0]?.d).toBeGreaterThan(1000);
  });

  it('re-running migrations is a no-op', async () => {
    expect(await runMigrations(testUrl)).toEqual({ appliedBefore: 2, appliedAfter: 2 });
  });

  it('migrateFromEnvironment validates config and reports the result', async () => {
    await expect(migrateFromEnvironment({ WAYVRO_ENV: 'test', DATABASE_URL: testUrl })).resolves.toBe('migrations: 0 applied, 2 total (WAYVRO_ENV=test)');
    await expect(migrateFromEnvironment({ WAYVRO_ENV: 'test' })).rejects.toThrow(/DATABASE_URL/);
  });

  it('the built `db:migrate` binary runs end to end', () => {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/bin/migrate.js', import.meta.url))], {
      env: { ...process.env, WAYVRO_ENV: 'test', DATABASE_URL: testUrl },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('migrations: 0 applied, 2 total');
  });

  it('the connection foundation answers readiness pings and reports failure without throwing', async () => {
    const ok = createDatabase(testUrl, { maxConnections: 2, applicationName: 'wayvro-it' });
    expect(await ok.ping(2000)).toBe(true);
    await ok.close();
    const unreachable = createDatabase('postgres://nobody:nothing@127.0.0.1:1/none', { maxConnections: 1, applicationName: 'wayvro-it' });
    expect(await unreachable.ping(2000)).toBe(false);
    await unreachable.close();
  });
});
