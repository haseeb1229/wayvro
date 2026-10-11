/**
 * P2.7 worker jobs against real PostgreSQL (LOGIN member of wayvro_worker) and real Valkey: intake (SUBMITTED →
 * MANUAL_REVIEW + review case, priority from open signals, idempotent, never a decision), expired review leases back
 * to the queue, document expiry (mandatory document ⇒ profile EXPIRED), restriction expiry ⇒ outbox event, and the
 * outbox relay with its first consumer: account-state hints published on Valkey, deduplicated per event, dead-lettered
 * after the attempt budget. Synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { runMigrations } from '@wayvro/db';
import { createLogger } from '@wayvro/observability';
import { ACCOUNT_HINT_CHANNEL, awaitRedisReady, createRequestPathRedis, type ClaimedJob } from '@wayvro/server-runtime';
import { captureLogs, createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeOnce } from '../src/maintenance.js';
import { accountStateHintConsumer } from '../src/outbox/account-state-hint.js';
import { LocalDispatcher, PgOutboxSource, PgProcessedEventStore } from '../src/outbox/pg-outbox.js';
import { OutboxRelay } from '../src/outbox/relay.js';
import { APPLICATION_INTAKE_JOB, applicationIntakeJob, documentExpiryJob } from '../src/review/review-jobs.js';

const ADMIN_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:26379';
if (!ADMIN_URL) throw new Error('DATABASE_URL is required (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;

let database: TestDatabase;
let owner: pg.Pool;
let worker: pg.Pool;
const logins: RestrictedLogin[] = [];
const logs = captureLogs();
const log = createLogger({ service: 'worker', env: 'test', level: 'info', destination: logs.stream });

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 2 });
  const login = await createRestrictedLogin(adminUrl, database.url, ['wayvro_worker', 'wayvro_audit_sealer']);
  logins.push(login);
  worker = new pg.Pool({ connectionString: login.url, max: 3 });
});
afterAll(async () => {
  await Promise.all([owner.end(), worker.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

const job = (type: string, payload: Record<string, unknown> = {}): ClaimedJob => ({
  id: randomUUID(),
  type,
  payload,
  sealedPayload: null,
  attempts: 1,
  maxAttempts: 8,
  leaseToken: randomUUID(),
});
async function application(state = 'SUBMITTED'): Promise<{ account: string; app: string }> {
  const account = randomUUID();
  const app = randomUUID();
  await owner.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [account]);
  await owner.query(
    `insert into compliance.driver_applications (id, account_id, state, city_code, requirement_set_id, submitted_at) values ($1, $2, $3, 'LHR', '00000000-0000-7000-8000-00000000c0a0', now())`,
    [app, account, state],
  );
  return { account, app };
}

describe('driver-application.intake', () => {
  it('queues a human review case (priority from open signals); idempotent; RESUBMISSION after an earlier case', async () => {
    const a = await application();
    const other = await application('MANUAL_REVIEW');
    await owner.query(
      `insert into compliance.duplicate_signals (id, signal, subject_application_id, matched_application_id, status) values ($1, 'CNIC_HASH_MATCH', $2, $3, 'OPEN')`,
      [randomUUID(), a.app, other.app],
    );
    await applicationIntakeJob(worker).handler(job(APPLICATION_INTAKE_JOB, { applicationId: a.app }));
    await applicationIntakeJob(worker).handler(job(APPLICATION_INTAKE_JOB, { applicationId: a.app }));
    expect((await owner.query<{ state: string }>(`select state from compliance.driver_applications where id = $1`, [a.app])).rows[0]?.state).toBe(
      'MANUAL_REVIEW',
    );
    const cases = await owner.query<{ kind: string; priority: number; status: string }>(
      `select kind, priority, status from compliance.review_cases where driver_application_id = $1`,
      [a.app],
    );
    expect(cases.rows).toEqual([{ kind: 'INITIAL_APPLICATION', priority: 2, status: 'OPEN' }]);
    // nothing automatic ever decides: no decision rows, no VERIFIED
    expect((await owner.query(`select 1 from compliance.review_decisions`)).rowCount).toBe(0);
    await owner.query(`update compliance.review_cases set status = 'DECIDED', decided_at = now() where driver_application_id = $1`, [a.app]);
    await owner.query(`update compliance.driver_applications set state = 'SUBMITTED' where id = $1`, [a.app]);
    await applicationIntakeJob(worker).handler(job(APPLICATION_INTAKE_JOB, { applicationId: a.app }));
    expect(
      (await owner.query<{ kind: string }>(`select kind from compliance.review_cases where driver_application_id = $1 and status = 'OPEN'`, [a.app])).rows[0]
        ?.kind,
    ).toBe('RESUBMISSION');
    await expect(applicationIntakeJob(worker).handler(job(APPLICATION_INTAKE_JOB, {}))).rejects.toThrow(/applicationId/);
  });
});

describe('leases, expiry and restriction events', () => {
  it('expired leases return to the queue; expired mandatory documents expire the profile; restriction expiry emits an event', async () => {
    const a = await application('MANUAL_REVIEW');
    const staff = randomUUID();
    await owner.query(`insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'S', $2, 'ACTIVE', now())`, [
      staff,
      `s-${randomBytes(5).toString('hex')}@example.test`,
    ]);
    const caseId = randomUUID();
    await owner.query(
      `insert into compliance.review_cases (id, kind, driver_application_id, city_code, status, assigned_staff_id, lease_expires_at) values ($1, 'INITIAL_APPLICATION', $2, 'LHR', 'CLAIMED', $3, now() - interval '1 minute')`,
      [caseId, a.app, staff],
    );
    const profile = randomUUID();
    await owner.query(`update compliance.driver_applications set state = 'VERIFIED' where id = $1`, [a.app]);
    await owner.query(
      `insert into compliance.driver_profiles (id, account_id, application_id, state, verified_legal_name_envelope, verified_date_of_birth_envelope) values ($1, $2, $3, 'ACTIVE_ELIGIBLE', $4, $4)`,
      [profile, a.account, a.app, randomBytes(40)],
    );
    const optional = randomUUID();
    const mandatory = randomUUID();
    await owner.query(
      `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, status, expires_on) values ($1, 'POLICE_CHARACTER_CERTIFICATE', 'DRIVER', $2, 'VALID', current_date - 1)`,
      [optional, a.app],
    );
    const restriction = randomUUID();
    await owner.query(
      `insert into profile.restrictions (id, scope, driver_profile_id, reason_code, reason_class, status, appealable, created_by_system, effective_until) values ($1, 'DRIVER_ROLE', $2, 'SYNTHETIC_HOLD', 'RISK_HOLD', 'ACTIVE', true, 'risk.policy', now() + interval '1 second')`,
      [restriction, profile],
    );
    await new Promise((r) => setTimeout(r, 1200));
    const result = await purgeOnce(worker, { otpChallengeDays: 7, succeededJobDays: 7, applicationDraftExpiryDays: 30, batchSize: 1000 });
    expect(result.reviewLeasesExpired).toBeGreaterThanOrEqual(1);
    expect(
      (
        await owner.query<{ status: string; assigned_staff_id: string | null }>(`select status, assigned_staff_id from compliance.review_cases where id = $1`, [
          caseId,
        ])
      ).rows[0],
    ).toEqual({
      status: 'OPEN',
      assigned_staff_id: null,
    });
    expect(
      (await owner.query<{ type: string; account_id: string }>(`select type, account_id from platform.outbox_events where aggregate_id = $1`, [restriction]))
        .rows,
    ).toEqual([{ type: 'restriction.changed.v1', account_id: a.account }]);
    // an OPTIONAL document expiring does not expire the profile; a MANDATORY one does
    await documentExpiryJob(worker, log).handler(job('compliance.document-expiry'));
    expect((await owner.query<{ state: string }>(`select state from compliance.driver_profiles where id = $1`, [profile])).rows[0]?.state).toBe(
      'ACTIVE_ELIGIBLE',
    );
    await owner.query(
      `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, status, expires_on, number_last4) values ($1, 'DRIVING_LICENCE', 'DRIVER', $2, 'VALID', current_date - 1, '1234')`,
      [mandatory, a.app],
    );
    await documentExpiryJob(worker, log).handler(job('compliance.document-expiry'));
    expect((await owner.query<{ status: string }>(`select status from compliance.compliance_documents where id = $1`, [mandatory])).rows[0]?.status).toBe(
      'EXPIRED',
    );
    expect((await owner.query<{ state: string }>(`select state from compliance.driver_profiles where id = $1`, [profile])).rows[0]?.state).toBe('EXPIRED');
  });
});

describe('outbox relay → account-state hints (first consumer)', () => {
  it('publishes each event once on Valkey (redelivery deduplicated), skips account-less events, dead-letters failures', async () => {
    const a = await application('MANUAL_REVIEW');
    const subscriber = createRequestPathRedis(REDIS_URL);
    const publisher = createRequestPathRedis(REDIS_URL);
    const received: string[] = [];
    expect(await awaitRedisReady(subscriber, 5000)).toBe(true);
    expect(await awaitRedisReady(publisher, 5000)).toBe(true);
    await subscriber.subscribe(ACCOUNT_HINT_CHANNEL);
    subscriber.on('message', (_c: string, m: string) => received.push(m));
    try {
      const insert = (accountId: string | null) =>
        owner
          .query<{ id: string }>(
            `insert into platform.outbox_events (id, type, aggregate_type, aggregate_id, account_id, status) values ($1, 'driver.application.decided.v1', 'compliance.driver_application', $2, $3, 'PENDING') returning id`,
            [randomUUID(), a.app, accountId],
          )
          .then((r) => r.rows[0]?.id ?? '');
      const withAccount = await insert(a.account);
      const without = await insert(null);
      const store = new PgProcessedEventStore(worker);
      const relay = new OutboxRelay(new PgOutboxSource(worker), new LocalDispatcher([accountStateHintConsumer(store, publisher)]), {
        batchSize: 100,
        maxAttempts: 3,
      });
      const first = await relay.runOnce();
      expect(first.dispatched).toBeGreaterThanOrEqual(2);
      await new Promise((r) => setTimeout(r, 300));
      expect(received.map((m) => JSON.parse(m) as { accountId: string; eventId: string })).toEqual(
        expect.arrayContaining([{ accountId: a.account, cause: 'driver.application.decided.v1', eventId: withAccount }]),
      );
      expect(received.some((m) => m.includes(without))).toBe(false);
      expect(
        (await owner.query<{ status: string }>(`select status from platform.outbox_events where id = any($1::uuid[])`, [[withAccount, without]])).rows.every(
          (r) => r.status === 'DISPATCHED',
        ),
      ).toBe(true);
      // redelivery (e.g. a second relay picked it up too) is a no-op for the consumer
      await owner.query(`update platform.outbox_events set status = 'PENDING', dispatched_at = null where id = $1`, [withAccount]);
      const count = received.length;
      await relay.runOnce();
      await new Promise((r) => setTimeout(r, 300));
      expect(received.length).toBe(count);
      // a consumer that keeps failing: attempts counted, then DEAD (kept for review, never dropped)
      const failing = await insert(a.account);
      const broken = new OutboxRelay(
        new PgOutboxSource(worker),
        new LocalDispatcher([accountStateHintConsumer(store, { publish: () => Promise.reject(new Error('synthetic outage')) })]),
        { batchSize: 100, maxAttempts: 2 },
      );
      await broken.runOnce();
      expect(
        (await owner.query<{ status: string; attempts: number }>(`select status, attempts from platform.outbox_events where id = $1`, [failing])).rows[0],
      ).toEqual({ status: 'PENDING', attempts: 1 });
      const dead = await broken.runOnce();
      expect(dead.deadLettered).toBe(1);
      expect(
        (await owner.query<{ status: string; last_error_code: string }>(`select status, last_error_code from platform.outbox_events where id = $1`, [failing]))
          .rows[0],
      ).toEqual({
        status: 'DEAD',
        last_error_code: 'PUBLISH_FAILED',
      });
      expect((await owner.query(`select 1 from platform.processed_events where event_id = $1`, [failing])).rowCount).toBe(0);
    } finally {
      subscriber.disconnect();
      publisher.disconnect();
    }
  });
});
