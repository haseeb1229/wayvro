/**
 * Integration-test database helpers (DEVELOPMENT/TEST ONLY, ADR-045; never in a deployable artefact).
 * Every suite works on its own throwaway database, so the shared local database is never wiped or reseeded
 * (CLAUDE.md §6), and authorization is proven by connecting as LOGIN members of the restricted group roles created by
 * the migrations (F-08) — never by the owner/superuser.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';

export interface TestDatabase {
  readonly name: string;
  readonly url: string;
  drop(): Promise<void>;
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

async function adminQuery(adminUrl: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/** Creates an empty database (from template0) next to the admin connection's database. */
export async function createTestDatabase(adminUrl: string, prefix = 'wayvro_it'): Promise<TestDatabase> {
  const name = `${prefix}_${randomBytes(6).toString('hex')}`;
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(name)) throw new Error(`invalid test database name ${name}`);
  await adminQuery(adminUrl, `create database ${name} template template0`);
  return {
    name,
    url: withDatabase(adminUrl, name),
    drop: () => adminQuery(adminUrl, `drop database if exists ${name} with (force)`),
  };
}

export interface RestrictedLogin {
  readonly role: string;
  readonly url: string;
  drop(): Promise<void>;
}

/**
 * Creates a throwaway LOGIN role that is a member of `groupRole` (e.g. `wayvro_api`, or several group roles) and returns a connection URL for
 * `databaseUrl` that authenticates as it. Roles are cluster-wide, so callers must `drop()` it after closing their pools.
 */
export async function createRestrictedLogin(adminUrl: string, databaseUrl: string, groupRole: string | readonly string[]): Promise<RestrictedLogin> {
  const groups = typeof groupRole === 'string' ? [groupRole] : groupRole;
  if (groups.length === 0 || !groups.every((g) => /^wayvro_[a-z_]+$/.test(g))) throw new Error(`unexpected group roles ${groups.join(',')}`);
  const role = `it_${(groups[0] ?? '').replace(/^wayvro_/, '')}_${randomBytes(5).toString('hex')}`;
  const password = randomBytes(18).toString('hex');
  await adminQuery(adminUrl, `create role ${role} login inherit nosuperuser nocreatedb nocreaterole password '${password}' in role ${groups.join(', ')}`);
  const u = new URL(databaseUrl);
  u.username = role;
  u.password = password;
  return {
    role,
    url: u.toString(),
    drop: () => adminQuery(adminUrl, `drop role if exists ${role}`),
  };
}
