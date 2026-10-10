/**
 * Migration 0002_policy_consent_age against real PostgreSQL: immutable policy registry, age-policy versions that only
 * retire, append-only consent/age evidence bound to the exact text hash and policy mode by composite foreign keys,
 * and grants executed as LOGIN members of the restricted roles. Throwaway database; synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required for integration tests (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;

const pgError = async (p: Promise<unknown>): Promise<{ code?: string; message?: string } | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e as { code?: string; message?: string };
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

const SHA = randomBytes(32);
async function registerDoc(q: pg.Pool, key = 'TERMS', version = 1, locale = 'en', sha = SHA): Promise<void> {
  await q.query(
    `insert into legal.policy_documents (policy_key, version, locale, content_sha256, status, material_change, effective_at, canonical_path)
     values ($1, $2, $3, $4, 'PLACEHOLDER_NOT_FOR_PRODUCTION', true, now(), $5)`,
    [key, version, locale, sha, `/legal/${key.toLowerCase().replace(/_/g, '-')}/v${String(version)}`],
  );
}
async function account(q: pg.Pool): Promise<string> {
  const id = randomUUID();
  await q.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [id]);
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

describe('legal.age_eligibility_policies (A15)', () => {
  it('seeds exactly one placeholder version with NO age threshold and the teen programme disabled', async () => {
    const r = await owner.query(`select * from legal.age_eligibility_policies order by version`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      version: 1,
      status: 'PLACEHOLDER_NOT_FOR_PRODUCTION',
      rider_declaration_mode: 'AFFIRM_MINIMUM_AGE',
      rider_minimum_age: null,
      driver_minimum_age: null,
      approval_ref: null,
      teen_programme_enabled: false,
    });
  });

  it('values are immutable; only a single retirement is allowed; no delete/truncate; constraints guard approval', async () => {
    expect((await pgError(owner.query(`update legal.age_eligibility_policies set rider_minimum_age = 18 where version = 1`)))?.code).toBe('42501');
    expect((await pgError(owner.query(`update legal.age_eligibility_policies set status = 'APPROVED' where version = 1`)))?.code).toBe('42501');
    expect((await pgError(owner.query(`delete from legal.age_eligibility_policies where version = 1`)))?.code).toBe('42501');
    expect((await pgError(owner.query(`truncate legal.age_eligibility_policies cascade`)))?.code).toBe('42501');
    // teen programme stays disabled (L21) and an APPROVED version needs an approval reference and thresholds
    expect(
      (
        await pgError(
          owner.query(
            `insert into legal.age_eligibility_policies (version, status, rider_declaration_mode, teen_programme_enabled, effective_at) values (9, 'PLACEHOLDER_NOT_FOR_PRODUCTION', 'NONE', true, now())`,
          ),
        )
      )?.code,
    ).toBe('23514');
    expect(
      (
        await pgError(
          owner.query(
            `insert into legal.age_eligibility_policies (version, status, rider_declaration_mode, effective_at) values (9, 'APPROVED', 'NONE', now())`,
          ),
        )
      )?.code,
    ).toBe('23514');
    expect(
      (
        await pgError(
          owner.query(
            `insert into legal.age_eligibility_policies (version, status, rider_declaration_mode, driver_minimum_age, approval_ref, effective_at) values (9, 'APPROVED', 'AFFIRM_MINIMUM_AGE', 30, 'ref', now())`,
          ),
        )
      )?.code,
    ).toBe('23514');
    await owner.query(
      `insert into legal.age_eligibility_policies (version, status, rider_declaration_mode, effective_at) values (2, 'PLACEHOLDER_NOT_FOR_PRODUCTION', 'DATE_OF_BIRTH_REQUIRED', now())`,
    );
    await owner.query(`update legal.age_eligibility_policies set status = 'RETIRED', retired_at = now() where version = 2`);
    expect((await pgError(owner.query(`update legal.age_eligibility_policies set status = 'RETIRED', retired_at = now() where version = 2`)))?.code).toBe(
      '42501',
    );
  });
});

describe('legal.policy_documents (immutable registry)', () => {
  it('the API registers documents insert-only; nobody can change or remove one', async () => {
    await registerDoc(api);
    expect((await pgError(registerDoc(api)))?.code).toBe('23505');
    for (const q of [api, owner]) {
      const e = await pgError(q.query(`update legal.policy_documents set material_change = false where policy_key = 'TERMS'`));
      expect(['42501']).toContain(e?.code);
      expect((await pgError(q.query(`delete from legal.policy_documents where policy_key = 'TERMS'`)))?.code).toBe('42501');
    }
    expect((await pgError(owner.query(`truncate legal.policy_documents cascade`)))?.code).toBe('42501');
    // approved rows need an approval reference; placeholders must not carry one
    expect(
      (
        await pgError(
          owner.query(
            `insert into legal.policy_documents (policy_key, version, locale, content_sha256, status, material_change, effective_at, canonical_path) values ('PRIVACY', 1, 'en', $1, 'APPROVED', true, now(), '/legal/privacy/v1')`,
            [randomBytes(32)],
          ),
        )
      )?.code,
    ).toBe('23514');
  });
});

describe('identity.consent_records and identity.age_declarations (append-only evidence)', () => {
  it('a consent is bound by foreign key to the exact (key, version, locale, content hash)', async () => {
    const id = await account(api);
    const insert = (sha: Buffer, version = 1) =>
      api.query(
        `insert into identity.consent_records (id, account_id, policy_key, policy_version, locale, content_sha256, action, surface) values ($1, $2, 'TERMS', $3, 'en', $4, 'ACCEPTED', 'MOBILE_APP')`,
        [randomUUID(), id, version, sha],
      );
    await insert(SHA);
    expect((await pgError(insert(randomBytes(32))))?.code).toBe('23503');
    expect((await pgError(insert(SHA, 2)))?.code).toBe('23503');
    for (const q of [api, owner]) {
      expect((await pgError(q.query(`update identity.consent_records set action = 'WITHDRAWN' where account_id = $1`, [id])))?.code).toBe('42501');
      expect((await pgError(q.query(`delete from identity.consent_records where account_id = $1`, [id])))?.code).toBe('42501');
    }
  });

  it("a declaration's shape is bound to its policy version's mode; one per account and version; no DOB in affirmation mode", async () => {
    const id = await account(api);
    const affirm = (accountId: string, extra = '') =>
      api.query(
        `insert into identity.age_declarations (id, account_id, policy_version, declaration_mode, affirmed${extra ? ', dob_envelope' : ''}) values ($1, $2, 1, 'AFFIRM_MINIMUM_AGE', true${extra ? ', $3' : ''})`,
        extra ? [randomUUID(), accountId, randomBytes(48)] : [randomUUID(), accountId],
      );
    await affirm(id);
    expect((await pgError(affirm(id)))?.code).toBe('23505');
    expect((await pgError(affirm(await account(api), 'dob')))?.code).toBe('23514');
    // version 1 is an AFFIRM policy: a DOB-mode declaration against it violates the (version, mode) foreign key
    expect(
      (
        await pgError(
          api.query(
            `insert into identity.age_declarations (id, account_id, policy_version, declaration_mode, dob_envelope) values ($1, $2, 1, 'DATE_OF_BIRTH_REQUIRED', $3)`,
            [randomUUID(), await account(api), randomBytes(48)],
          ),
        )
      )?.code,
    ).toBe('23503');
    expect((await pgError(api.query(`update identity.age_declarations set affirmed = false where account_id = $1`, [id])))?.code).toBe('42501');
    expect((await pgError(owner.query(`delete from identity.age_declarations where account_id = $1`, [id])))?.code).toBe('42501');
  });
});

describe('grants executed as restricted roles', () => {
  it('wayvro_api: reads age policies but cannot write them; reads/inserts consent evidence only', async () => {
    expect((await api.query(`select version from legal.age_eligibility_policies`)).rowCount).toBeGreaterThan(0);
    expect(
      (
        await pgError(
          api.query(
            `insert into legal.age_eligibility_policies (version, status, rider_declaration_mode, effective_at) values (50, 'PLACEHOLDER_NOT_FOR_PRODUCTION', 'NONE', now())`,
          ),
        )
      )?.code,
    ).toBe('42501');
    expect((await pgError(api.query(`truncate identity.consent_records`)))?.code).toBe('42501');
    expect((await pgError(api.query(`create table legal.x (id int)`)))?.code).toBe('42501');
  });

  it('wayvro_worker and wayvro_realtime have no access to the legal schema or consent evidence', async () => {
    for (const q of [worker, realtime]) {
      expect((await pgError(q.query(`select 1 from legal.policy_documents`)))?.code).toBe('42501');
      expect((await pgError(q.query(`select 1 from legal.age_eligibility_policies`)))?.code).toBe('42501');
      expect((await pgError(q.query(`select 1 from identity.consent_records`)))?.code).toBe('42501');
      expect((await pgError(q.query(`select 1 from identity.age_declarations`)))?.code).toBe('42501');
    }
  });
});
