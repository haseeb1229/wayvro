/**
 * Migration 0001_identity_core against real PostgreSQL: clean -> latest, previous -> latest, re-run = 0, structural
 * invariants (DB-enforced uniqueness, append-only audit) and GRANTS EXECUTED AS LOGIN MEMBERS OF EACH RESTRICTED ROLE
 * (F-08: the owner/superuser never proves authorization). Throwaway databases only.
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

const bytes = (n: number): Buffer => randomBytes(n);
/** Every application schema created by the migrations (grows additively with later micro-phases). */
const APP_SCHEMAS = ['identity', 'profile', 'platform', 'audit', 'legal', 'staff', 'catalog', 'compliance', 'vault'] as const;
const APP_SCHEMAS_SQL = APP_SCHEMAS.map((s) => `'${s}'`).join(',');
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
const logins: RestrictedLogin[] = [];
const pools: pg.Pool[] = [];
async function poolAs(group: string): Promise<pg.Pool> {
  const login = await createRestrictedLogin(adminUrl, database.url, group);
  logins.push(login);
  const pool = new pg.Pool({ connectionString: login.url, max: 2 });
  pools.push(pool);
  return pool;
}

async function seedAccount(client: pg.Pool | pg.PoolClient): Promise<{ accountId: string; phoneId: string; hash: Buffer }> {
  const accountId = randomUUID();
  const phoneId = randomUUID();
  const hash = bytes(32);
  await client.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [accountId]);
  await client.query(
    `insert into identity.account_phones (id, account_id, phone_envelope, phone_last4, status, verified_at) values ($1, $2, $3, '0001', 'VERIFIED', now())`,
    [phoneId, accountId, bytes(48)],
  );
  await client.query(`insert into identity.phone_lookup_index (account_phone_id, lookup_key_version, lookup_hash, is_current_owner) values ($1, 1, $2, true)`, [
    phoneId,
    hash,
  ]);
  return { accountId, phoneId, hash };
}

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  owner = new pg.Pool({ connectionString: database.url, max: 4 });
});

afterAll(async () => {
  for (const p of pools) await p.end();
  await owner.end();
  for (const l of logins) await l.drop();
  await database.drop();
});

describe('migration lifecycle (every migration)', () => {
  it('clean -> latest applies every migration', async () => {
    expect(await runMigrations(database.url)).toEqual({ appliedBefore: 0, appliedAfter: TOTAL_MIGRATIONS });
  });

  it('re-running is a no-op', async () => {
    expect(await runMigrations(database.url)).toEqual({ appliedBefore: TOTAL_MIGRATIONS, appliedAfter: TOTAL_MIGRATIONS });
  });

  // Every previous supported schema state (after migrations 0..n-1) upgrades to latest, then re-runs as a no-op.
  for (let n = 1; n < TOTAL_MIGRATIONS; n++) {
    it(`previous (${MIGRATION_TAGS[n - 1] ?? '?'}) -> latest applies exactly the remaining ${String(TOTAL_MIGRATIONS - n)}`, async () => {
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

  it('creates NOLOGIN group roles and makes wayvro_migrator (never an app role) the owner of every object', async () => {
    const roles = await owner.query<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean }>(
      `select rolname, rolcanlogin, rolsuper from pg_roles where rolname like 'wayvro\\_%' and rolname in ('wayvro_migrator','wayvro_api','wayvro_worker','wayvro_realtime','wayvro_audit_sealer') order by 1`,
    );
    expect(roles.rows).toHaveLength(5);
    expect(roles.rows.every((r) => !r.rolcanlogin && !r.rolsuper)).toBe(true);
    const owners = await owner.query<{ owner: string }>(
      `select distinct pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in (${APP_SCHEMAS_SQL}) and c.relkind in ('r','i','S')`,
    );
    expect(owners.rows.map((r) => r.owner)).toEqual(['wayvro_migrator']);
    const schemaOwners = await owner.query<{ nspname: string; owner: string }>(
      `select nspname, pg_get_userbyid(nspowner) owner from pg_namespace where nspname in (${APP_SCHEMAS_SQL}) order by 1`,
    );
    expect(schemaOwners.rows.map((r) => r.nspname)).toEqual([...APP_SCHEMAS].sort());
    expect(new Set(schemaOwners.rows.map((r) => r.owner))).toEqual(new Set(['wayvro_migrator']));
    const publicGrants = await owner.query(
      `select 1 from information_schema.role_table_grants where grantee = 'PUBLIC' and table_schema in (${APP_SCHEMAS_SQL})`,
    );
    const functionOwners = await owner.query<{ owner: string }>(
      `select distinct pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in (${APP_SCHEMAS_SQL})`,
    );
    expect(functionOwners.rows.map((r) => r.owner)).toEqual(['wayvro_migrator']);
    expect(publicGrants.rowCount).toBe(0);
  });

  it('schema inventory: exactly the tables of the applied migrations (no table ahead of its micro-phase)', async () => {
    const tables = await owner.query<{ t: string }>(
      `select table_schema || '.' || table_name t from information_schema.tables where table_schema in ('identity','profile','platform','audit','legal','compliance','vault','staff','catalog') order by 1`,
    );
    expect(tables.rows.map((r) => r.t)).toEqual([
      'audit.audit_events',
      'audit.audit_seals',
      'audit.seal_verifications',
      'catalog.cities',
      'catalog.districts',
      'catalog.service_categories',
      'compliance.application_service_categories',
      'compliance.capture_challenges',
      'compliance.cnic_lookup_index',
      'compliance.compliance_documents',
      'compliance.document_number_lookup_index',
      'compliance.document_types',
      'compliance.driver_applications',
      'compliance.driver_profiles',
      'compliance.duplicate_signals',
      'compliance.requirement_set_items',
      'compliance.requirement_sets',
      'compliance.review_cases',
      'compliance.review_decision_evidence',
      'compliance.review_decisions',
      'compliance.review_second_approvals',
      'compliance.service_capabilities',
      'compliance.vehicle_affiliations',
      'compliance.vehicles',
      'identity.account_devices',
      'identity.account_phones',
      'identity.accounts',
      'identity.age_declarations',
      'identity.consent_records',
      'identity.otp_challenges',
      'identity.phone_lookup_index',
      'identity.refresh_tokens',
      'identity.security_events',
      'identity.sessions',
      'legal.age_eligibility_policies',
      'legal.policy_documents',
      'platform.idempotency_records',
      'platform.jobs',
      'platform.key_rotations',
      'platform.outbox_events',
      'platform.processed_events',
      'profile.appeal_evidence',
      'profile.appeals',
      'profile.restriction_events',
      'profile.restrictions',
      'profile.rider_profiles',
      'staff.access_reasons',
      'staff.break_glass_grants',
      'staff.invitations',
      'staff.role_assignment_cities',
      'staff.role_assignments',
      'staff.sessions',
      'staff.staff_accounts',
      'staff.webauthn_challenges',
      'staff.webauthn_credentials',
      'vault.evidence_access_log',
      'vault.evidence_objects',
      'vault.evidence_view_tokens',
    ]);
  });
});

describe('database-enforced identity invariants', () => {
  it('one CURRENT verified phone belongs to at most one account (per lookup-key version)', async () => {
    const first = await seedAccount(owner);
    const otherAccount = randomUUID();
    const otherPhone = randomUUID();
    await owner.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'ur')`, [otherAccount]);
    await owner.query(
      `insert into identity.account_phones (id, account_id, phone_envelope, phone_last4, status, verified_at) values ($1, $2, $3, '0001', 'VERIFIED', now())`,
      [otherPhone, otherAccount, bytes(48)],
    );
    const dup = owner.query(
      `insert into identity.phone_lookup_index (account_phone_id, lookup_key_version, lookup_hash, is_current_owner) values ($1, 1, $2, true)`,
      [otherPhone, first.hash],
    );
    expect(await pgCode(dup)).toBe('23505');
    // The same hash under a different lookup-key version is a different index space (rotation dual-write).
    await owner.query(
      `insert into identity.phone_lookup_index (account_phone_id, lookup_key_version, lookup_hash, is_current_owner) values ($1, 2, $2, true)`,
      [otherPhone, first.hash],
    );
    // Non-current rows (released numbers, later phases) never collide.
    await owner.query(
      `insert into identity.phone_lookup_index (account_phone_id, lookup_key_version, lookup_hash, is_current_owner) values ($1, 3, $2, false)`,
      [otherPhone, first.hash],
    );
  });

  it('one account has at most one CURRENT verified phone', async () => {
    const { accountId } = await seedAccount(owner);
    const second = owner.query(
      `insert into identity.account_phones (id, account_id, phone_envelope, phone_last4, status, verified_at) values ($1, $2, $3, '0002', 'VERIFIED', now())`,
      [randomUUID(), accountId, bytes(48)],
    );
    expect(await pgCode(second)).toBe('23505');
  });

  it('a person is NOT a database identity: two accounts with different phones are accepted', async () => {
    await seedAccount(owner);
    await seedAccount(owner);
  });

  it('one rider profile per account; one live refresh token per session; challenge state consistency', async () => {
    const { accountId } = await seedAccount(owner);
    await owner.query(`insert into profile.rider_profiles (id, account_id, status) values ($1, $2, 'ACTIVE')`, [randomUUID(), accountId]);
    expect(await pgCode(owner.query(`insert into profile.rider_profiles (id, account_id, status) values ($1, $2, 'ACTIVE')`, [randomUUID(), accountId]))).toBe(
      '23505',
    );
    const deviceId = randomUUID();
    await owner.query(
      `insert into identity.account_devices (id, account_id, installation_hash, platform, app_version, first_verified_at, last_seen_at, trust_state) values ($1, $2, $3, 'ANDROID', '1.0.0', now(), now(), 'NEW')`,
      [deviceId, accountId, bytes(32)],
    );
    const sessionId = randomUUID();
    await owner.query(
      `insert into identity.sessions (id, account_id, device_id, status, assurance, access_token_hash, access_expires_at, idle_expires_at, absolute_expires_at, app_version)
       values ($1, $2, $3, 'ACTIVE', 'OTP', $4, now() + interval '15 minutes', now() + interval '60 days', now() + interval '180 days', '1.0.0')`,
      [sessionId, accountId, deviceId, bytes(32)],
    );
    const live = (id: string) =>
      owner.query(
        `insert into identity.refresh_tokens (id, session_id, token_hash, issued_at, expires_at) values ($1, $2, $3, now(), now() + interval '60 days')`,
        [id, sessionId, bytes(32)],
      );
    await live(randomUUID());
    expect(await pgCode(live(randomUUID()))).toBe('23505');
    // A revoked session must carry its reason.
    expect(await pgCode(owner.query(`update identity.sessions set status = 'REVOKED', revoked_at = now() where id = $1`, [sessionId]))).toBe('23514');
    // A suppressed challenge never has a code MAC; an issued one always has one.
    const challenge = (status: string, mac: Buffer | null) =>
      owner.query(
        `insert into identity.otp_challenges (id, purpose, phone_lookup_key_version, phone_lookup_hash, phone_envelope, code_mac, mac_key_version, channel, locale, installation_hash, status, max_attempts, next_resend_at, expires_at)
         values ($1, 'SIGN_IN', 1, $2, $3, $4, $5, 'SMS', 'en', $6, $7, 5, now(), now() + interval '5 minutes')`,
        [randomUUID(), bytes(32), bytes(48), mac, mac ? 1 : null, bytes(32), status],
      );
    expect(await pgCode(challenge('ISSUED', null))).toBe('23514');
    expect(await pgCode(challenge('SUPPRESSED', bytes(32)))).toBe('23514');
    await challenge('ISSUED', bytes(32));
    await challenge('SUPPRESSED', null);
  });
});

describe('append-only audit (database level, even for the owner)', () => {
  it('rejects UPDATE, DELETE and TRUNCATE of audit events and seals', async () => {
    await owner.query(
      `insert into audit.audit_events (id, actor_type, action, object_type, outcome) values ($1, 'SYSTEM', 'MIGRATION_PROBE', 'platform.probe', 'SUCCESS')`,
      [randomUUID()],
    );
    for (const sql of [`update audit.audit_events set outcome = 'FAILURE'`, `delete from audit.audit_events`, `truncate audit.audit_events`]) {
      await expect(owner.query(sql)).rejects.toThrow(/append-only/);
    }
    await owner.query(
      `insert into audit.audit_seals (first_seq, last_seq, leaf_count, merkle_root, seal_hash, algorithm) values (1, 1, 1, $1, $2, 'sha256-merkle-v1')`,
      [bytes(32), bytes(32)],
    );
    // Overlapping sealed ranges are impossible.
    expect(
      await pgCode(
        owner.query(
          `insert into audit.audit_seals (first_seq, last_seq, leaf_count, merkle_root, seal_hash, algorithm) values (1, 2, 1, $1, $2, 'sha256-merkle-v1')`,
          [bytes(32), bytes(32)],
        ),
      ),
    ).toBe('23P01');
    for (const sql of [`update audit.audit_seals set leaf_count = 1`, `delete from audit.audit_seals`, `truncate audit.audit_seals`]) {
      await expect(owner.query(sql)).rejects.toThrow(/append-only/);
    }
  });
});

describe('grants executed as LOGIN members of each restricted role', () => {
  it('wayvro_api: identity writes allowed; audit insert-only; jobs enqueue-only; no deletes, truncates or DDL', async () => {
    const api = await poolAs('wayvro_api');
    const seeded = await seedAccount(api);
    await api.query(`update identity.accounts set display_name = 'Synthetic' where id = $1`, [seeded.accountId]);
    await api.query(
      `insert into audit.audit_events (id, actor_type, actor_id, action, object_type, object_id, outcome) values ($1, 'ACCOUNT', $2, 'GRANT_PROBE', 'identity.account', $2, 'SUCCESS')`,
      [randomUUID(), seeded.accountId],
    );
    await api.query(`insert into platform.jobs (id, type, status, max_attempts) values ($1, 'otp.deliver', 'QUEUED', 3)`, [randomUUID()]);
    await api.query(`select target, phase from platform.key_rotations`);
    const denied = [
      `select * from audit.audit_events`,
      `update audit.audit_events set outcome = 'FAILURE'`,
      `delete from audit.audit_events`,
      `insert into audit.audit_seals (first_seq, last_seq, leaf_count, merkle_root, seal_hash, algorithm) values (900, 900, 1, '\\x00', '\\x00', 'sha256-merkle-v1')`,
      `select * from platform.jobs`,
      `delete from identity.accounts`,
      `update identity.account_phones set status = 'VERIFIED'`,
      `delete from identity.sessions`,
      `truncate identity.sessions`,
      `select * from platform.key_rotations`,
      `create table identity.attacker_table (x int)`,
    ];
    for (const sql of denied) expect(await pgCode(api.query(sql)), sql).toBe('42501');
  });

  it('wayvro_worker: jobs and rotation tables; envelope column only on account phones; no session access', async () => {
    const worker = await poolAs('wayvro_worker');
    const seeded = await seedAccount(owner);
    await worker.query(`update identity.account_phones set phone_envelope = $1 where id = $2`, [bytes(48), seeded.phoneId]);
    const claimed = await worker.query(`select id from platform.jobs where status = 'QUEUED' order by run_after limit 5 for update skip locked`);
    expect(claimed.rowCount).toBeGreaterThanOrEqual(1);
    await worker.query(
      `insert into audit.audit_events (id, actor_type, action, object_type, outcome) values ($1, 'SYSTEM', 'GRANT_PROBE', 'platform.job', 'SUCCESS')`,
      [randomUUID()],
    );
    const denied = [
      `update identity.account_phones set account_id = account_id`,
      `select phone_last4 from identity.account_phones`,
      `select * from identity.sessions`,
      `select * from identity.refresh_tokens`,
      `update identity.accounts set display_name = 'x'`,
      `select * from audit.audit_events`,
    ];
    for (const sql of denied) expect(await pgCode(worker.query(sql)), sql).toBe('42501');
  });

  it('wayvro_realtime: column-level SELECT for session verification only', async () => {
    const realtime = await poolAs('wayvro_realtime');
    await realtime.query(
      `select s.id, s.account_id, s.status, s.access_expires_at, s.idle_expires_at, s.absolute_expires_at, a.status
         from identity.sessions s join identity.accounts a on a.id = s.account_id where s.access_token_hash = $1`,
      [bytes(32)],
    );
    const denied = [
      `select app_version from identity.sessions`,
      `select * from identity.refresh_tokens`,
      `select display_name from identity.accounts`,
      `select * from identity.account_phones`,
      `update identity.sessions set status = 'REVOKED'`,
      `select * from platform.jobs`,
    ];
    for (const sql of denied) expect(await pgCode(realtime.query(sql)), sql).toBe('42501');
  });

  it('wayvro_audit_sealer: reads events and appends seals only', async () => {
    const sealer = await poolAs('wayvro_audit_sealer');
    await sealer.query(`select seq, id from audit.audit_events order by seq limit 1`);
    await sealer.query(
      `insert into audit.audit_seals (first_seq, last_seq, leaf_count, merkle_root, seal_hash, algorithm) values (500, 500, 1, $1, $2, 'sha256-merkle-v1')`,
      [bytes(32), bytes(32)],
    );
    const denied = [
      `insert into audit.audit_events (id, actor_type, action, object_type, outcome) values ('${randomUUID()}', 'SYSTEM', 'FORGED', 'x.y', 'SUCCESS')`,
      `delete from audit.audit_seals`,
      `update audit.audit_seals set leaf_count = 1`,
      `select * from identity.accounts`,
    ];
    for (const sql of denied) expect(await pgCode(sealer.query(sql)), sql).toBe('42501');
  });
});
