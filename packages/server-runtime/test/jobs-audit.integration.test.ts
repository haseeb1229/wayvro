/**
 * Job runner and audit write path against real PostgreSQL, executed as the restricted roles (api enqueues, worker
 * claims): SKIP LOCKED exactly-once claiming across concurrent runners, bounded retry -> DEAD with sealed-payload purge,
 * lease-expiry crash recovery, completion fencing, dedupe keys; append-only audit writes.
 */
import { randomUUID } from 'node:crypto';
import { runMigrations } from '@wayvro/db';
import { createLogger, runWithContext } from '@wayvro/observability';
import { captureLogs, createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditEventError, JobError, JobRunner, appendAudit, enqueueJob, withTransaction, type ClaimedJob } from '../src/index.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;

let database: TestDatabase;
let owner: pg.Pool;
let api: pg.Pool;
let worker: pg.Pool;
const logins: RestrictedLogin[] = [];
const logs = captureLogs();
const log = createLogger({ service: 'worker', env: 'test', level: 'info', destination: logs.stream });

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 2 });
  const apiLogin = await createRestrictedLogin(adminUrl, database.url, 'wayvro_api');
  const workerLogin = await createRestrictedLogin(adminUrl, database.url, 'wayvro_worker');
  logins.push(apiLogin, workerLogin);
  api = new pg.Pool({ connectionString: apiLogin.url, max: 4 });
  worker = new pg.Pool({ connectionString: workerLogin.url, max: 12 });
});

afterAll(async () => {
  await Promise.all([api.end(), worker.end(), owner.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

const status = async (id: string) =>
  (
    await owner.query<{ status: string; attempts: number; sealed: boolean; last_error_code: string | null }>(
      `select status, attempts, sealed_payload is not null sealed, last_error_code from platform.jobs where id = $1`,
      [id],
    )
  ).rows[0];

describe('job runner (FOR UPDATE SKIP LOCKED)', () => {
  it('concurrent runners process every job exactly once', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) ids.push((await enqueueJob(api, { type: 'test.exactly-once', payload: { n: i }, maxAttempts: 3 })) ?? '');
    const seen: string[] = [];
    const handler = (job: ClaimedJob) => {
      seen.push(job.id);
      return Promise.resolve();
    };
    const runners = Array.from(
      { length: 6 },
      (_, i) => new JobRunner(worker, [{ type: 'test.exactly-once', handler }], { workerId: `w${String(i)}`, leaseMs: 30000, batchSize: 5, log }),
    );
    for (let round = 0; round < 4; round++) await Promise.all(runners.map((r) => r.runOnce()));
    expect(seen.sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(60);
  });

  it('retries with backoff, then moves to DEAD with a stable error code, purges the sealed payload and calls onDead', async () => {
    const id = (await enqueueJob(api, { type: 'test.flaky', sealedPayload: Buffer.from('sealed-secret'), maxAttempts: 2 })) ?? '';
    let deadCalls = 0;
    const runner = new JobRunner(
      worker,
      [
        {
          type: 'test.flaky',
          handler: () => Promise.reject(new JobError('PROVIDER_REJECTED')),
          onDead: () => {
            deadCalls++;
            return Promise.resolve();
          },
        },
      ],
      { workerId: 'flaky', leaseMs: 30000, batchSize: 5, log, random: () => 0 },
    );
    expect(await runner.runOnce()).toMatchObject({ claimed: 1, retried: 1 });
    expect(await status(id)).toMatchObject({ status: 'QUEUED', attempts: 1, sealed: true, last_error_code: 'PROVIDER_REJECTED' });
    expect(await runner.runOnce()).toMatchObject({ claimed: 1, dead: 1 });
    expect(await status(id)).toMatchObject({ status: 'DEAD', attempts: 2, sealed: false, last_error_code: 'PROVIDER_REJECTED' });
    expect(deadCalls).toBe(1);
    expect(logs.text()).not.toContain('sealed-secret');
  });

  it('unexpected errors are stored as UNEXPECTED_ERROR (never the raw message)', async () => {
    const id = (await enqueueJob(api, { type: 'test.throws', maxAttempts: 1 })) ?? '';
    const runner = new JobRunner(worker, [{ type: 'test.throws', handler: () => Promise.reject(new Error('lookup failed for +923000000009')) }], {
      workerId: 'throws',
      leaseMs: 30000,
      batchSize: 5,
      log,
    });
    await runner.runOnce();
    expect(await status(id)).toMatchObject({ status: 'DEAD', last_error_code: 'UNEXPECTED_ERROR' });
    expect(logs.text()).not.toContain('+923000000009');
  });

  it('recovers jobs whose worker crashed (expired lease) and fences the stale worker', async () => {
    const id = (await enqueueJob(api, { type: 'test.crash', maxAttempts: 3 })) ?? '';
    // Simulate a worker that claimed the job and died: RUNNING with an already-expired lease.
    await worker.query(
      `update platform.jobs set status = 'RUNNING', attempts = 1, lease_expires_at = now() - interval '1 second', locked_by = 'dead-worker' where id = $1`,
      [id],
    );
    let runs = 0;
    const runner = new JobRunner(
      worker,
      [
        {
          type: 'test.crash',
          handler: () => {
            runs++;
            return Promise.resolve();
          },
        },
      ],
      { workerId: 'rescuer', leaseMs: 30000, batchSize: 5, log },
    );
    expect(await runner.runOnce()).toMatchObject({ reclaimed: 1, claimed: 1, succeeded: 1 });
    expect(runs).toBe(1);
    expect(await status(id)).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
    // The dead worker coming back cannot overwrite the outcome (completion is fenced by locked_by).
    const stale = await worker.query(`update platform.jobs set status = 'QUEUED' where id = $1 and status = 'RUNNING' and locked_by = 'dead-worker'`, [id]);
    expect(stale.rowCount).toBe(0);
  });

  it('dedupe keys allow one open job per (type, key) and only claim registered types', async () => {
    // Recurring jobs are scheduled by the worker; the API role is INSERT-only and cannot use the dedupe path.
    await expect(enqueueJob(api, { type: 'test.recurring', maxAttempts: 1, dedupeKey: 'singleton' })).rejects.toThrow(/permission denied/);
    expect(await enqueueJob(worker, { type: 'test.recurring', maxAttempts: 1, dedupeKey: 'singleton' })).not.toBeNull();
    expect(await enqueueJob(worker, { type: 'test.recurring', maxAttempts: 1, dedupeKey: 'singleton' })).toBeNull();
    const idle = new JobRunner(worker, [], { workerId: 'idle', leaseMs: 1000, batchSize: 5, log });
    expect(await idle.runOnce()).toMatchObject({ claimed: 0 });
    expect(
      () =>
        new JobRunner(
          worker,
          [
            { type: 'a.b', handler: () => Promise.resolve() },
            { type: 'a.b', handler: () => Promise.resolve() },
          ],
          { workerId: 'x', leaseMs: 1, batchSize: 1, log },
        ),
    ).toThrow(/duplicate/);
  });

  it('start/stop polls without overlapping passes', async () => {
    let n = 0;
    await enqueueJob(api, { type: 'test.poll', maxAttempts: 1 });
    const runner = new JobRunner(
      worker,
      [
        {
          type: 'test.poll',
          handler: () => {
            n++;
            return Promise.resolve();
          },
        },
      ],
      { workerId: 'poller', leaseMs: 30000, batchSize: 5, log },
    );
    runner.start(20);
    runner.start(20);
    await new Promise((r) => setTimeout(r, 300));
    await runner.stop();
    expect(n).toBe(1);
  });
});

describe('append-only audit write path', () => {
  it('writes ids and codes with the request id, inside the caller transaction', async () => {
    const accountId = randomUUID();
    const id = await runWithContext({ requestId: 'req-audit-0001' }, () =>
      withTransaction(api, (tx) =>
        appendAudit(tx, {
          actor: { type: 'ACCOUNT', id: accountId },
          action: 'SESSION_CREATED',
          objectType: 'identity.session',
          objectId: randomUUID(),
          outcome: 'SUCCESS',
        }),
      ),
    );
    const row = (await owner.query(`select actor_type, actor_id, action, request_id, outcome from audit.audit_events where id = $1`, [id])).rows[0];
    expect(row).toEqual({ actor_type: 'ACCOUNT', actor_id: accountId, action: 'SESSION_CREATED', request_id: 'req-audit-0001', outcome: 'SUCCESS' });
    // The writer role cannot read, change or remove audit rows.
    await expect(api.query(`select * from audit.audit_events`)).rejects.toThrow(/permission denied/);
    await expect(api.query(`delete from audit.audit_events where id = $1`, [id])).rejects.toThrow(/permission denied/);
  });

  it('rolls back with the transaction and rejects malformed codes before touching the database', async () => {
    const objectId = randomUUID();
    await expect(
      withTransaction(api, async (tx) => {
        await appendAudit(tx, { actor: { type: 'SYSTEM' }, action: 'PROBE_ROLLED_BACK', objectType: 'platform.probe', objectId, outcome: 'SUCCESS' });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect((await owner.query(`select 1 from audit.audit_events where object_id = $1`, [objectId])).rowCount).toBe(0);
    await expect(appendAudit(api, { actor: { type: 'ANONYMOUS' }, action: 'lower', objectType: 'x.y', outcome: 'SUCCESS' })).rejects.toBeInstanceOf(
      AuditEventError,
    );
    await expect(appendAudit(api, { actor: { type: 'ANONYMOUS' }, action: 'OK_ACTION', objectType: 'Bad Type', outcome: 'SUCCESS' })).rejects.toBeInstanceOf(
      AuditEventError,
    );
    await expect(
      appendAudit(api, { actor: { type: 'ANONYMOUS' }, action: 'OK_ACTION', objectType: 'x.y', outcome: 'SUCCESS', reasonCode: 'bad' }),
    ).rejects.toBeInstanceOf(AuditEventError);
  });
});
