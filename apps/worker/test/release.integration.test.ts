/**
 * P3.4 worker jobs against real PostgreSQL as a LOGIN member of wayvro_worker: scheduled activation of app version
 * policies (applies due policies, retires the previous ACTIVE one, re-checks every rule at run time and unschedules a
 * refused policy; races against a staff activation have exactly one winner and the loser sees a clean conflict) and
 * runtime-switch effective_until expiry (returns to the registry default with an EXPIRY change, outbox event, SYSTEM
 * audit). The staff activation is driven as a wayvro_api member with the API's protocol (advisory lock per platform +
 * compare-and-set on APPROVED) — the API's HTTP 409 path is covered in apps/api/test/release-admin.integration.test.ts.
 * Synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { appPolicyActivationLockKey } from '@wayvro/config';
import { runMigrations } from '@wayvro/db';
import { createLogger } from '@wayvro/observability';
import { captureLogs, createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appPolicyActivator } from '../src/release/app-policy-activator.js';
import { runtimeSwitchExpiryActivator } from '../src/release/switch-expiry.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;

let database: TestDatabase;
let owner: pg.Pool;
let worker: pg.Pool;
let api: pg.Pool;
const logins: RestrictedLogin[] = [];
const logs = captureLogs();
const log = createLogger({ service: 'worker', env: 'test', level: 'info', destination: logs.stream });
let drafter: string;
let approver: string;

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 3 });
  for (const [group, assign] of [
    ['wayvro_worker', (p: pg.Pool) => (worker = p)],
    ['wayvro_api', (p: pg.Pool) => (api = p)],
  ] as const) {
    const login = await createRestrictedLogin(adminUrl, database.url, group);
    logins.push(login);
    assign(new pg.Pool({ connectionString: login.url, max: 6 }));
  }
  const staff = async () => {
    const id = randomUUID();
    await owner.query(`insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'Synthetic', $2, 'ACTIVE', now())`, [
      id,
      `w.${randomBytes(4).toString('hex')}@example.org`,
    ]);
    return id;
  };
  drafter = await staff();
  approver = await staff();
});
afterAll(async () => {
  await Promise.all([owner.end(), worker.end(), api.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});
beforeEach(async () => {
  // each test starts with no scheduled or active policy (history stays; the guard allows retirement only)
  await owner.query(`update platform.app_version_policies set scheduled = false, effective_from = null where status = 'APPROVED' and scheduled`);
  await owner.query(`update platform.app_version_policies set status = 'RETIRED', effective_until = now() where status = 'ACTIVE'`);
});

let version = 0;
/** An APPROVED policy, optionally scheduled `offsetSeconds` from now (negative = due). */
async function approvedPolicy(opts: { platform?: 'ANDROID' | 'IOS'; min?: number; scheduledIn?: number; ranges?: string[] } = {}): Promise<string> {
  const id = randomUUID();
  version++;
  await owner.query(
    `insert into platform.app_version_policies (id, platform, version, status, min_supported_build, recommended_build, soft_message_key, hard_message_key, drafted_by_staff_id)
     values ($1, $2, $3, 'DRAFT', $4, $4, 'release.soft.default', 'release.hard.default', $5)`,
    [id, opts.platform ?? 'ANDROID', version, opts.min ?? 0, drafter],
  );
  for (const r of opts.ranges ?? [])
    await owner.query(`insert into platform.app_blocked_builds (policy_id, builds, reason_code) values ($1, $2::int4range, 'SECURITY')`, [id, r]);
  await owner.query(`update platform.app_version_policies set status = 'PENDING_APPROVAL' where id = $1`, [id]);
  await owner.query(`update platform.app_version_policies set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [id, approver]);
  if (opts.scheduledIn !== undefined) {
    await owner.query(`update platform.app_version_policies set scheduled = true, effective_from = now() + ($2::int * interval '1 second') where id = $1`, [
      id,
      opts.scheduledIn,
    ]);
  }
  return id;
}
const statusOf = async (id: string) =>
  (await owner.query<{ status: string; scheduled: boolean }>(`select status, scheduled from platform.app_version_policies where id = $1`, [id])).rows[0];
const activator = (released = { ANDROID: 500, IOS: 500 }) => appPolicyActivator({ pool: worker, env: 'test', released, log });

/** The API's manual activation protocol, run as wayvro_api; returns true when its compare-and-set won. */
async function staffActivation(id: string, platform: 'ANDROID' | 'IOS', hold?: Promise<void>): Promise<boolean> {
  const c = await api.connect();
  try {
    await c.query('begin');
    await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [appPolicyActivationLockKey(platform)]);
    const row = (await c.query<{ status: string }>(`select status from platform.app_version_policies where id = $1 for update`, [id])).rows[0];
    if (row?.status !== 'APPROVED') {
      await c.query('rollback');
      return false;
    }
    await c.query(`update platform.app_version_policies set status = 'RETIRED', effective_until = now() where platform = $1 and status = 'ACTIVE'`, [platform]);
    const won = await c.query(
      `update platform.app_version_policies set status = 'ACTIVE', effective_from = now(), scheduled = false where id = $1 and status = 'APPROVED'`,
      [id],
    );
    if (hold) await hold;
    await c.query('commit');
    return won.rowCount === 1;
  } finally {
    c.release();
  }
}

describe('scheduled app-policy activation', () => {
  it('activates a due policy (retiring the previous ACTIVE), audits as SYSTEM, writes the outbox event; future ones wait', async () => {
    const previous = await approvedPolicy();
    expect(await staffActivation(previous, 'ANDROID')).toBe(true);
    const due = await approvedPolicy({ scheduledIn: -60 });
    const later = await approvedPolicy({ platform: 'IOS', scheduledIn: 3600 });
    expect(await activator().runDue()).toEqual({ applied: 1, refused: 0 });
    expect(await statusOf(due)).toEqual({ status: 'ACTIVE', scheduled: false });
    expect(await statusOf(previous)).toEqual({ status: 'RETIRED', scheduled: false });
    expect(await statusOf(later)).toEqual({ status: 'APPROVED', scheduled: true });
    const audit = await owner.query(
      `select actor_type, outcome, reason_code from audit.audit_events where action = 'APP_POLICY_ACTIVATED' and object_id = $1`,
      [due],
    );
    expect(audit.rows).toEqual([{ actor_type: 'SYSTEM', outcome: 'SUCCESS', reason_code: 'SCHEDULED' }]);
    const event = await owner.query(`select payload from platform.outbox_events where type = 'platform.app-policy.activated.v1' and aggregate_id = $1`, [due]);
    expect(event.rows[0]?.payload).toMatchObject({ platform: 'ANDROID', scheduled: true });
    expect(logs.text()).toContain('APP_POLICY_ACTIVATED');
    // idempotent: nothing is due any more
    expect(await activator().runDue()).toEqual({ applied: 0, refused: 0 });
  });

  it('re-checks the guardrails at run time: a policy no longer within them is unscheduled (stays APPROVED), audited and alerted', async () => {
    const tooHigh = await approvedPolicy({ min: 200, scheduledIn: -5 });
    const coversLatest = await approvedPolicy({ platform: 'IOS', ranges: ['[40,60]'], scheduledIn: -5 });
    expect(await activator({ ANDROID: 150, IOS: 50 }).runDue()).toEqual({ applied: 0, refused: 2 });
    expect(await statusOf(tooHigh)).toEqual({ status: 'APPROVED', scheduled: false });
    expect(await statusOf(coversLatest)).toEqual({ status: 'APPROVED', scheduled: false });
    const audits = await owner.query(
      `select object_id, reason_code, actor_type, outcome from audit.audit_events where action = 'APP_POLICY_SCHEDULE_REFUSED' and object_id = any($1::uuid[]) order by reason_code`,
      [[tooHigh, coversLatest]],
    );
    expect(audits.rows).toEqual([
      { object_id: coversLatest, reason_code: 'BLOCKED_RANGE_COVERS_LATEST_RELEASED', actor_type: 'SYSTEM', outcome: 'FAILURE' },
      { object_id: tooHigh, reason_code: 'MINIMUM_ABOVE_LATEST_RELEASED', actor_type: 'SYSTEM', outcome: 'FAILURE' },
    ]);
    expect(logs.text()).toContain('APP_POLICY_SCHEDULED_ACTIVATION_REFUSED');
  });

  it('never activates a policy older than the ACTIVE one', async () => {
    const older = await approvedPolicy({ scheduledIn: -5 });
    const newer = await approvedPolicy();
    expect(await staffActivation(newer, 'ANDROID')).toBe(true);
    expect(await activator().runDue()).toEqual({ applied: 0, refused: 1 });
    expect(await statusOf(older)).toEqual({ status: 'APPROVED', scheduled: false });
    expect(await statusOf(newer)).toEqual({ status: 'ACTIVE', scheduled: false });
  });

  it('a scheduled activation racing a staff activation of the same policy has exactly one winner; the loser sees a clean conflict', async () => {
    // staff transaction holds the platform lock: the job waits, then finds the policy no longer APPROVED (skipped)
    const held = await approvedPolicy({ scheduledIn: -1 });
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const staffWin = staffActivation(held, 'ANDROID', hold);
    await new Promise((r) => setTimeout(r, 100));
    const job = activator().runDue();
    await new Promise((r) => setTimeout(r, 200));
    release();
    expect(await staffWin).toBe(true);
    expect(await job).toEqual({ applied: 0, refused: 0 });
    expect((await owner.query(`select 1 from audit.audit_events where action = 'APP_POLICY_ACTIVATED' and object_id = $1`, [held])).rowCount).toBe(0);

    // free-running races: always exactly one ACTIVE outcome per policy, never an error
    for (let i = 0; i < 5; i++) {
      const id = await approvedPolicy({ scheduledIn: -1 });
      const [jobResult, staffWon] = await Promise.all([activator().runDue(), staffActivation(id, 'ANDROID')]);
      expect(jobResult.applied + (staffWon ? 1 : 0)).toBe(1);
      expect(await statusOf(id)).toEqual({ status: 'ACTIVE', scheduled: false });
      expect((await owner.query(`select count(*)::int n from platform.app_version_policies where platform = 'ANDROID' and status = 'ACTIVE'`)).rows[0]).toEqual(
        { n: 1 },
      );
    }
  });
});

describe('runtime-switch effective_until expiry', () => {
  const insertSwitch = async (key: string, state: string, untilSeconds: number | null, scope = 'ALL') => {
    const id = randomUUID();
    await api.query(
      `insert into platform.runtime_switches (id, key, scope, state, reason_code, message_key, effective_until, changed_by_staff_id)
       values ($1, $2, $3, $4, 'OPS_INCIDENT', 'maintenance.planned', case when $5::int is null then null else now() + ($5::int * interval '1 second') end, $6)`,
      [id, key, scope, state, untilSeconds, drafter],
    );
    return id;
  };
  const switchOf = async (id: string) =>
    (
      await owner.query<{ state: string; reason_code: string; effective_until: Date | null; changed_by_staff_id: string | null; message_key: string | null }>(
        `select state, reason_code, effective_until, changed_by_staff_id, message_key from platform.runtime_switches where id = $1`,
        [id],
      )
    ).rows[0];

  it('returns an expired safe-state target to its registry default with an EXPIRY change, outbox event and SYSTEM audit', async () => {
    const expired = await insertSwitch('rider.quotes', 'DISABLED', -1);
    const maintenance = await insertSwitch('platform.maintenance', 'ENABLED', -1);
    const future = await insertSwitch('platform.geo-routing', 'DISABLED', 3600);
    const alreadyDefault = await insertSwitch('platform.geo-reverse', 'ENABLED', -1);
    const expiry = runtimeSwitchExpiryActivator({ pool: worker, env: 'test', log });
    expect(await expiry.runDue()).toEqual({ applied: 2, refused: 0 });
    expect(await switchOf(expired)).toEqual({
      state: 'ENABLED',
      reason_code: 'EFFECTIVE_UNTIL_REACHED',
      effective_until: null,
      changed_by_staff_id: null,
      message_key: null,
    });
    expect((await switchOf(maintenance))?.state).toBe('DISABLED');
    expect((await switchOf(future))?.state).toBe('DISABLED');
    expect(await switchOf(alreadyDefault)).toMatchObject({ state: 'ENABLED', effective_until: null, reason_code: 'OPS_INCIDENT' });
    const changes = await owner.query(
      `select switch_key, from_state, to_state, direction, status, requested_by_staff_id from platform.runtime_switch_changes where direction = 'EXPIRY' order by switch_key`,
    );
    expect(changes.rows).toEqual([
      { switch_key: 'platform.maintenance', from_state: 'ENABLED', to_state: 'DISABLED', direction: 'EXPIRY', status: 'APPLIED', requested_by_staff_id: null },
      { switch_key: 'rider.quotes', from_state: 'DISABLED', to_state: 'ENABLED', direction: 'EXPIRY', status: 'APPLIED', requested_by_staff_id: null },
    ]);
    const events = await owner.query(`select payload from platform.outbox_events where type = 'platform.runtime-switch.changed.v1' and aggregate_id = $1`, [
      expired,
    ]);
    expect(events.rows[0]?.payload).toMatchObject({ key: 'rider.quotes', state: 'ENABLED', direction: 'EXPIRY' });
    const audit = await owner.query(`select actor_type from audit.audit_events where action = 'RUNTIME_SWITCH_EXPIRED' and object_id = $1`, [expired]);
    expect(audit.rows).toEqual([{ actor_type: 'SYSTEM' }]);
    expect(logs.text()).toContain('RUNTIME_SWITCH_CHANGED');
    expect(await expiry.runDue()).toEqual({ applied: 0, refused: 0 });
  });

  it('a row whose key left the registry is reported once; its state is never changed by the system', async () => {
    const orphan = await insertSwitch('ops.retired-switch', 'DISABLED', -1);
    const expiry = runtimeSwitchExpiryActivator({ pool: worker, env: 'test', log });
    expect(await expiry.runDue()).toEqual({ applied: 0, refused: 0 });
    expect(await switchOf(orphan)).toMatchObject({ state: 'DISABLED', effective_until: null, reason_code: 'OPS_INCIDENT' });
    expect(logs.text()).toContain('RUNTIME_SWITCH_UNKNOWN_KEY');
    logs.clear();
    expect(await expiry.runDue()).toEqual({ applied: 0, refused: 0 });
    expect(logs.text()).not.toContain('RUNTIME_SWITCH_UNKNOWN_KEY');
  });
});
