/**
 * Migration 0004_compliance_core against real PostgreSQL: reference seeds (placeholder set, disabled categories),
 * database invariants (one non-terminal application per account, one live vehicle per plate, CHECK per restriction
 * scope / duplicate signal / document subject, system-only RISK_HOLD, maker-checker on sets/lifts/age policies) and
 * grants executed as LOGIN members of the restricted roles. Throwaway database; synthetic data only.
 */
import { randomUUID } from 'node:crypto';
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
const logins: RestrictedLogin[] = [];
async function poolAs(group: string): Promise<pg.Pool> {
  const login = await createRestrictedLogin(adminUrl, database.url, group);
  logins.push(login);
  return new pg.Pool({ connectionString: login.url, max: 2 });
}
const account = async (): Promise<string> => {
  const id = randomUUID();
  await api.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [id]);
  return id;
};
const application = async (accountId: string, state = 'DRAFT'): Promise<string> => {
  const id = randomUUID();
  await api.query(`insert into compliance.driver_applications (id, account_id, state, city_code) values ($1, $2, $3, 'LHR')`, [id, accountId, state]);
  return id;
};

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 3 });
  api = await poolAs('wayvro_api');
  worker = await poolAs('wayvro_worker');
});
afterAll(async () => {
  await Promise.all([owner.end(), api.end(), worker.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

describe('reference seeds', () => {
  it('one ACTIVE placeholder LHR/CAR set (not Punjab law), bike/rickshaw behind the legal gate, Lahore district', async () => {
    const sets = await owner.query(`select city_code, service_category, version, status, is_placeholder from compliance.requirement_sets`);
    expect(sets.rows).toEqual([{ city_code: 'LHR', service_category: 'CAR', version: 0, status: 'ACTIVE', is_placeholder: true }]);
    const cats = await owner.query(`select code, status from catalog.service_categories order by code`);
    expect(cats.rows).toEqual([
      { code: 'BIKE', status: 'DISABLED_LEGAL_GATE' },
      { code: 'CAR', status: 'ENABLED' },
      { code: 'RICKSHAW', status: 'DISABLED_LEGAL_GATE' },
    ]);
    expect((await owner.query(`select code from catalog.districts`)).rows).toEqual([{ code: 'LHR-LAHORE' }]);
    // no gender column anywhere (CL-17)
    expect(
      (
        await owner.query(
          `select 1 from information_schema.columns where table_schema in ('identity','profile','legal','staff','catalog','compliance','platform','audit') and (column_name ilike '%gender%' or column_name ~* '(^|_)sex($|_)')`,
        )
      ).rowCount,
    ).toBe(0);
  });
});

describe('database invariants', () => {
  it('one non-terminal application per account; terminal ones do not block a new application', async () => {
    const a = await account();
    await application(a);
    expect(await pgCode(application(a))).toBe('23505');
    const b = await account();
    await application(b, 'WITHDRAWN');
    await application(b);
    // submitted states need the pinned set
    expect(await pgCode(application(await account(), 'SUBMITTED'))).toBe('23514');
  });

  it('one live vehicle per plate; affiliations reference exactly one of application/profile', async () => {
    const insert = (plate: string, status = 'ACTIVE') =>
      api.query(
        `insert into compliance.vehicles (id, plate_normalised, plate_display, make, model, model_year, colour, service_category, ownership_type, status) values ($1, $2, $2, 'm', 'm', 2020, 'c', 'CAR', 'REGISTERED_OWNER', $3)`,
        [randomUUID(), plate, status],
      );
    await insert('LEA1');
    expect(await pgCode(insert('LEA1'))).toBe('23505');
    await insert('LEA1', 'RETIRED');
    const v = (await api.query<{ id: string }>(`select id from compliance.vehicles where plate_normalised = 'LEA1' and status = 'ACTIVE'`)).rows[0]?.id;
    expect(
      await pgCode(
        api.query(`insert into compliance.vehicle_affiliations (id, vehicle_id, relation, status) values ($1, $2, 'OWNER', 'PENDING')`, [randomUUID(), v]),
      ),
    ).toBe('23514');
  });

  it('documents must match their type subject; signals and restrictions have CHECKs per kind', async () => {
    const app = await application(await account());
    expect(
      await pgCode(
        api.query(
          `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, status) values ($1, 'ROUTE_PERMIT', 'DRIVER', $2, 'SUBMITTED')`,
          [randomUUID(), app],
        ),
      ),
    ).toBe('23503');
    expect(
      await pgCode(
        api.query(
          `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, status) values ($1, 'ROUTE_PERMIT', 'VEHICLE', $2, 'SUBMITTED')`,
          [randomUUID(), app],
        ),
      ),
    ).toBe('23514');
    expect(
      await pgCode(
        api.query(`insert into compliance.duplicate_signals (id, signal, subject_application_id, status) values ($1, 'CNIC_HASH_MATCH', $2, 'OPEN')`, [
          randomUUID(),
          app,
        ]),
      ),
    ).toBe('23514');
    const acc = await account();
    const r = (scope: string, cls: string, by: 'staff' | 'system', until: string | null = null) =>
      api.query(
        `insert into profile.restrictions (id, scope, account_id, reason_code, reason_class, status, appealable, created_by_system, effective_until)
         values ($1, $2, $3, 'X_CODE', $4, 'ACTIVE', true, $5, $6)`,
        [randomUUID(), scope, acc, cls, by === 'system' ? 'risk.policy' : null, until],
      );
    expect(await pgCode(r('ACCOUNT', 'FRAUD', 'staff'))).toBe('23514'); // no creator
    expect(await pgCode(r('DRIVER_ROLE', 'COMPLIANCE', 'system'))).toBe('23514'); // scope subject mismatch
    expect(await pgCode(r('ACCOUNT', 'RISK_HOLD', 'system', new Date(Date.now() + 3600_000).toISOString()))).toBe('23514'); // RISK_HOLD only on DRIVER_ROLE
    await r('ACCOUNT', 'SECURITY_HOLD', 'system');
  });

  it('maker-checker on requirement sets and age policies; age-policy values stay immutable', async () => {
    const staffId = randomUUID();
    await owner.query(
      `insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'S', 's@example.org', 'ACTIVE', now())`,
      [staffId],
    );
    expect(
      await pgCode(
        api.query(
          `insert into compliance.requirement_sets (id, city_code, service_category, version, status, is_placeholder, source_reference, drafted_by_staff_id, approved_by_staff_id) values ($1, 'LHR', 'CAR', 7, 'APPROVED', false, 'ref', $2, $2)`,
          [randomUUID(), staffId],
        ),
      ),
    ).toBe('23514');
    expect(
      await pgCode(
        api.query(
          `insert into legal.age_eligibility_policies (version, status, rider_declaration_mode, rider_minimum_age, driver_minimum_age, approval_ref, effective_at, drafted_by_staff_id, approved_by_staff_id) values (5, 'APPROVED', 'NONE', null, 30, 'ref', now(), $1, $1)`,
          [staffId],
        ),
      ),
    ).toBe('23514');
    await api.query(
      `insert into legal.age_eligibility_policies (version, status, rider_declaration_mode, driver_minimum_age, approval_ref, effective_at, drafted_by_staff_id) values (6, 'PENDING_APPROVAL', 'NONE', 30, 'ref', now(), $1)`,
      [staffId],
    );
    expect(await pgCode(api.query(`update legal.age_eligibility_policies set driver_minimum_age = 1 where version = 6`))).toBe('42501');
    expect(await pgCode(api.query(`update legal.age_eligibility_policies set status = 'APPROVED' where version = 6`))).toBe('42501');
  });
});

describe('grants executed as restricted roles', () => {
  it('wayvro_api: compliance DML but no deletes of evidence-bearing rows; restriction events append-only', async () => {
    expect(await pgCode(api.query(`delete from compliance.driver_applications`))).toBe('42501');
    expect(await pgCode(api.query(`delete from profile.restrictions`))).toBe('42501');
    expect(
      await pgCode(
        api.query(
          `insert into compliance.document_types (code, subject, has_expiry, has_number, evidence_kinds, retention_class, name_en) values ('X_TYPE', 'DRIVER', false, false, ARRAY['A'], 'IDENTITY_EVIDENCE', 'x')`,
        ),
      ),
    ).toBe('42501');
    expect(await pgCode(api.query(`update profile.restriction_events set reason_code = 'Y_CODE'`))).toBe('42501');
  });

  it('wayvro_worker: only expiry columns of restrictions and applications', async () => {
    expect(await pgCode(worker.query(`select reason_code from profile.restrictions`))).toBe('42501');
    expect(await pgCode(worker.query(`select cnic_envelope from compliance.driver_applications`))).toBe('42501');
    await worker.query(
      `update compliance.driver_applications set state = 'EXPIRED_DRAFT', updated_at = now(), version = version + 1 where state = 'DRAFT' and updated_at < now() - interval '30 days'`,
    );
    await worker.query(`update profile.restrictions set status = 'EXPIRED' where status = 'ACTIVE' and effective_until <= now()`);
    expect(await pgCode(worker.query(`select 1 from compliance.cnic_lookup_index`))).toBe('42501');
  });
});
