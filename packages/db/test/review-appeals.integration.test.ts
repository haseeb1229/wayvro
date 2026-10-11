/**
 * Migration 0006_review_appeals against real PostgreSQL: per-kind subject CHECKs, one open case per application,
 * claim = lease CHECK, append-only decisions, approvals need a human identity assessment, second approver ≠ decider
 * (composite FK + CHECK), appeals (exactly one subject, one open appeal per subject), capabilities need the granting
 * decision, outbox status rules, and GRANTS executed as LOGIN members of the restricted roles. Synthetic data only.
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
let vault: pg.Pool;
const logins: RestrictedLogin[] = [];
async function poolAs(group: string | string[]): Promise<pg.Pool> {
  const login = await createRestrictedLogin(adminUrl, database.url, group);
  logins.push(login);
  return new pg.Pool({ connectionString: login.url, max: 2 });
}

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 3 });
  api = await poolAs('wayvro_api');
  worker = await poolAs('wayvro_worker');
  vault = await poolAs('wayvro_vault');
});
afterAll(async () => {
  await Promise.all([owner.end(), api.end(), worker.end(), vault.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

async function application(): Promise<{ account: string; app: string }> {
  const account = randomUUID();
  const app = randomUUID();
  await owner.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [account]);
  await owner.query(
    `insert into compliance.driver_applications (id, account_id, state, city_code, requirement_set_id, submitted_at) values ($1, $2, 'MANUAL_REVIEW', 'LHR', '00000000-0000-7000-8000-00000000c0a0', now())`,
    [app, account],
  );
  return { account, app };
}
async function staffSession(): Promise<{ staff: string; session: string }> {
  const staff = randomUUID();
  const credential = randomUUID();
  const session = randomUUID();
  await owner.query(`insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'S', $2, 'ACTIVE', now())`, [
    staff,
    `s-${randomBytes(6).toString('hex')}@example.test`,
  ]);
  await owner.query(
    `insert into staff.webauthn_credentials (id, staff_id, credential_id, public_key, sign_count, device_type, backed_up, nickname, status) values ($1, $2, $3, $4, 0, 'singleDevice', false, 'k', 'ACTIVE')`,
    [credential, staff, randomBytes(16).toString('hex'), randomBytes(32)],
  );
  await owner.query(
    `insert into staff.sessions (id, staff_id, credential_id, status, token_hash, absolute_expires_at) values ($1, $2, $3, 'ACTIVE', $4, now() + interval '8 hours')`,
    [session, staff, credential, randomBytes(32)],
  );
  return { staff, session };
}
const openCase = (app: string, kind = 'INITIAL_APPLICATION') =>
  api.query(`insert into compliance.review_cases (id, kind, driver_application_id, city_code, status) values ($1, $2, $3, 'LHR', 'OPEN') returning id`, [
    randomUUID(),
    kind,
    app,
  ]);

describe('review cases', () => {
  it('one open case per application; per-kind subjects; a claim is a lease', async () => {
    const a = await application();
    const c = (await openCase(a.app)).rows[0] as { id: string };
    expect(await pgCode(openCase(a.app))).toBe('23505');
    expect(await pgCode(openCase(a.app, 'DOCUMENT_RENEWAL'))).toBe('23514');
    expect(await pgCode(openCase(a.app, 'APPEAL'))).toBe('23514'); // an APPEAL case needs its appeal
    const s = await staffSession();
    expect(await pgCode(api.query(`update compliance.review_cases set status = 'CLAIMED', assigned_staff_id = $2 where id = $1`, [c.id, s.staff]))).toBe(
      '23514',
    );
    await api.query(
      `update compliance.review_cases set status = 'CLAIMED', assigned_staff_id = $2, lease_expires_at = now() + interval '30 minutes' where id = $1`,
      [c.id, s.staff],
    );
    expect(await pgCode(api.query(`update compliance.review_cases set status = 'DECIDED' where id = $1`, [c.id]))).toBe('23514');
  });

  it('decisions are append-only; an approval needs a confirmed identity assessment; the second approver is never the decider', async () => {
    const a = await application();
    const c = (await openCase(a.app)).rows[0] as { id: string };
    const s = await staffSession();
    const decision = (id: string, kind: string, identity: string | null, second = false) =>
      api.query(
        `insert into compliance.review_decisions (id, review_case_id, decision, reason_codes, checklist, checklist_schema_version, identity_match_assessment,
                                                  requires_second_approval, decided_by_staff_id, staff_session_id)
         values ($1, $2, $3, $4, '{}'::jsonb, 1, $5, $6, $7, $8)`,
        [id, c.id, kind, ['ALL_CHECKS_CONFIRMED'], identity, second, s.staff, s.session],
      );
    expect(await pgCode(decision(randomUUID(), 'APPROVE', 'UNCERTAIN_ESCALATE'))).toBe('23514');
    expect(await pgCode(decision(randomUUID(), 'REJECT', null, true))).toBe('23514');
    expect(
      await pgCode(
        api.query(
          `insert into compliance.review_decisions (id, review_case_id, decision, reason_codes, checklist, checklist_schema_version, decided_by_staff_id, staff_session_id) values ($1, $2, 'NEEDS_INFO', '{}', '{}'::jsonb, 1, $3, $4)`,
          [randomUUID(), c.id, s.staff, s.session],
        ),
      ),
    ).toBe('23514');
    const id = randomUUID();
    await decision(id, 'APPROVE', 'CONFIRMED_BY_REVIEWER', true);
    for (const pool of [api, owner]) {
      expect(await pgCode(pool.query(`update compliance.review_decisions set decision = 'REJECT' where id = $1`, [id]))).not.toBeUndefined();
      expect(await pgCode(pool.query(`delete from compliance.review_decisions where id = $1`, [id]))).not.toBeUndefined();
    }
    const second = (approver: string, session: string) =>
      api.query(
        `insert into compliance.review_second_approvals (review_decision_id, decided_by_staff_id, approver_staff_id, approver_session_id, outcome) values ($1, $2, $3, $4, 'APPROVED')`,
        [id, s.staff, approver, session],
      );
    expect(await pgCode(second(s.staff, s.session))).toBe('23514');
    const other = await staffSession();
    // lying about the decider is caught by the composite FK
    expect(
      await pgCode(
        api.query(
          `insert into compliance.review_second_approvals (review_decision_id, decided_by_staff_id, approver_staff_id, approver_session_id, outcome) values ($1, $2, $3, $4, 'APPROVED')`,
          [id, other.staff, s.staff, s.session],
        ),
      ),
    ).toBe('23503');
    await second(other.staff, other.session);
  });

  it('a capability needs the decision that granted it', async () => {
    const a = await application();
    const profile = randomUUID();
    const vehicle = randomUUID();
    await owner.query(
      `insert into compliance.driver_profiles (id, account_id, application_id, state, verified_legal_name_envelope, verified_date_of_birth_envelope) values ($1, $2, $3, 'VERIFIED', $4, $4)`,
      [profile, a.account, a.app, randomBytes(40)],
    );
    await owner.query(
      `insert into compliance.vehicles (id, plate_normalised, plate_display, make, model, model_year, colour, service_category, ownership_type, status) values ($1, $2, $2, 'M', 'X', 2020, 'W', 'CAR', 'REGISTERED_OWNER', 'ACTIVE')`,
      [vehicle, `P${randomBytes(4).toString('hex').toUpperCase()}`],
    );
    expect(
      await pgCode(
        api.query(
          `insert into compliance.service_capabilities (id, driver_profile_id, vehicle_id, city_code, service_category, status) values ($1, $2, $3, 'LHR', 'CAR', 'GRANTED')`,
          [randomUUID(), profile, vehicle],
        ),
      ),
    ).toBe('23514');
  });
});

describe('appeals and outbox', () => {
  it('appeals have exactly one subject and at most one open appeal per subject', async () => {
    const a = await application();
    const s = await staffSession();
    const restriction = randomUUID();
    await owner.query(
      `insert into profile.restrictions (id, scope, account_id, reason_code, reason_class, status, appealable, created_by_staff_id) values ($1, 'ACCOUNT', $2, 'SYNTHETIC_REASON', 'SAFETY', 'ACTIVE', true, $3)`,
      [restriction, a.account, s.staff],
    );
    const appeal = (subject: { restriction?: string }) =>
      api.query(`insert into profile.appeals (id, account_id, restriction_id, status, statement_envelope) values ($1, $2, $3, 'SUBMITTED', $4)`, [
        randomUUID(),
        a.account,
        subject.restriction ?? null,
        randomBytes(40),
      ]);
    expect(await pgCode(appeal({}))).toBe('23514');
    await appeal({ restriction });
    expect(await pgCode(appeal({ restriction }))).toBe('23505');
  });

  it('outbox: DISPATCHED ⇔ dispatched_at; processed events are unique per consumer', async () => {
    const id = randomUUID();
    await api.query(
      `insert into platform.outbox_events (id, type, aggregate_type, aggregate_id, status) values ($1, 'driver.approved.v1', 'compliance.driver_profile', $2, 'PENDING')`,
      [id, randomUUID()],
    );
    expect(await pgCode(worker.query(`update platform.outbox_events set status = 'DISPATCHED' where id = $1`, [id]))).toBe('23514');
    await worker.query(`update platform.outbox_events set status = 'DISPATCHED', dispatched_at = now() where id = $1`, [id]);
    expect(
      await pgCode(
        api.query(`insert into platform.outbox_events (id, type, aggregate_type, aggregate_id, status) values ($1, 'Not A Type', 'x.y', $2, 'PENDING')`, [
          randomUUID(),
          randomUUID(),
        ]),
      ),
    ).toBe('23514');
    await worker.query(`insert into platform.processed_events (consumer, event_id) values ('account-state-hint.v1', $1)`, [id]);
    expect(await pgCode(worker.query(`insert into platform.processed_events (consumer, event_id) values ('account-state-hint.v1', $1)`, [id]))).toBe('23505');
  });
});

describe('grants executed as restricted roles', () => {
  it('the API cannot change decisions or read the outbox; the vault reads only case-assignment facts', async () => {
    expect(await pgCode(api.query(`update compliance.review_decisions set reason_codes = '{}'`))).toBe('42501');
    expect(await pgCode(api.query(`select 1 from platform.outbox_events`))).toBe('42501');
    expect(await pgCode(api.query(`select 1 from platform.processed_events`))).toBe('42501');
    expect((await vault.query(`select id, status, assigned_staff_id, lease_expires_at from compliance.review_cases limit 1`)).rowCount).toBeGreaterThanOrEqual(
      0,
    );
    expect(await pgCode(vault.query(`select priority from compliance.review_cases limit 1`))).toBe('42501');
    expect(await pgCode(vault.query(`update compliance.review_cases set status = 'OPEN'`))).toBe('42501');
    expect(await pgCode(worker.query(`select statement_envelope from profile.appeals limit 1`))).toBe('42501');
    expect(await pgCode(worker.query(`insert into compliance.review_decisions (id) values ($1)`, [randomUUID()]))).toBe('42501');
  });
});
