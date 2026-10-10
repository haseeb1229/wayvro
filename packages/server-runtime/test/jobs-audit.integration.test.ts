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
    const deadToken = randomUUID();
    await worker.query(
      `update platform.jobs set status = 'RUNNING', attempts = 1, lease_expires_at = now() - interval '1 second', locked_by = 'dead-worker',
              lease_token = $2 where id = $1`,
      [id, deadToken],
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
    // The dead worker coming back cannot overwrite the outcome (completion is fenced by its claim's lease token).
    const stale = await worker.query(`update platform.jobs set status = 'QUEUED' where id = $1 and status = 'RUNNING' and lease_token = $2`, [id, deadToken]);
    expect(stale.rowCount).toBe(0);
  });

  /**
   * Distributed fencing (P2.1 review blocker): two runners deliberately share one workerId, as two containers with the
   * same PID would. Runner A claims with a short lease and stalls inside its handler; the lease expires; runner B
   * reclaims and re-claims (fresh token). Whatever A does afterwards must update zero rows and must not be reported as
   * success/retry/dead, while B's claim stays authoritative.
   */
  describe('lease-token fencing with a shared workerId', () => {
    const SHARED = 'worker-1';
    const leaseOf = async (id: string) =>
      (
        await owner.query<{ status: string; lease_token: string | null; attempts: number }>(
          `select status, lease_token, attempts from platform.jobs where id = $1`,
          [id],
        )
      ).rows[0];

    async function staleScenario(type: string, staleBehaviour: 'succeed' | 'fail', maxAttempts: number, newOwnerFinishesFirst: boolean) {
      const id = (await enqueueJob(api, { type, maxAttempts })) ?? '';
      let releaseA: () => void = () => undefined;
      const aGate = new Promise<void>((r) => (releaseA = r));
      let releaseB: () => void = () => undefined;
      const bGate = new Promise<void>((r) => (releaseB = r));
      let aStarted: () => void = () => undefined;
      const aRunning = new Promise<void>((r) => (aStarted = r));
      let bStarted: () => void = () => undefined;
      const bRunning = new Promise<void>((r) => (bStarted = r));
      const tokens: string[] = [];
      let deadCalls = 0;
      const a = new JobRunner(
        worker,
        [
          {
            type,
            handler: async (job) => {
              tokens.push(job.leaseToken);
              aStarted();
              await aGate;
              if (staleBehaviour === 'fail') throw new JobError('PROVIDER_REJECTED');
            },
            onDead: () => {
              deadCalls++;
              return Promise.resolve();
            },
          },
        ],
        { workerId: SHARED, leaseMs: 150, batchSize: 1, log, random: () => 0 },
      );
      const b = new JobRunner(
        worker,
        [
          {
            type,
            handler: async (job) => {
              tokens.push(job.leaseToken);
              bStarted();
              await bGate;
            },
          },
        ],
        { workerId: SHARED, leaseMs: 30000, batchSize: 1, log },
      );
      const aPass = a.runOnce();
      await aRunning;
      await new Promise((r) => setTimeout(r, 400)); // A's lease expires while A is stalled
      const bPass = b.runOnce();
      await bRunning;
      const [tokenA, tokenB] = tokens;
      expect(tokenA).toBeDefined();
      expect(tokenB).toBeDefined();
      expect(tokenA).not.toBe(tokenB);
      expect(await leaseOf(id)).toMatchObject({ status: 'RUNNING', lease_token: tokenB, attempts: 2 });
      if (newOwnerFinishesFirst) {
        releaseB();
        expect(await bPass).toMatchObject({ reclaimed: 1, claimed: 1, succeeded: 1, stale: 0 });
        releaseA();
        expect(await aPass).toMatchObject({ claimed: 1, succeeded: 0, retried: 0, dead: 0, stale: 1 });
        expect(await leaseOf(id)).toMatchObject({ status: 'SUCCEEDED', lease_token: null });
      } else {
        // The stale worker finishes while the new owner is still running: the new owner's claim must survive intact.
        releaseA();
        expect(await aPass).toMatchObject({ claimed: 1, succeeded: 0, retried: 0, dead: 0, stale: 1 });
        expect(await leaseOf(id)).toMatchObject({ status: 'RUNNING', lease_token: tokenB, attempts: 2 });
        releaseB();
        expect(await bPass).toMatchObject({ succeeded: 1, stale: 0 });
        expect(await leaseOf(id)).toMatchObject({ status: 'SUCCEEDED' });
      }
      expect(deadCalls).toBe(0);
    }

    it('stale success is rejected after the new owner completed', async () => {
      await staleScenario('test.fence-success-late', 'succeed', 3, true);
    });
    it('stale success is rejected while the new owner is still running', async () => {
      await staleScenario('test.fence-success-early', 'succeed', 3, false);
    });
    it('stale retry is rejected (attempts left)', async () => {
      await staleScenario('test.fence-retry', 'fail', 5, false);
    });
    it('stale dead-letter is rejected and onDead is not called (no attempts left for the stale claim)', async () => {
      // A's claim is made the last allowed attempt (2/2), so A's failure takes the dead-letter path.
      const type = 'test.fence-dead';
      const id = (await enqueueJob(api, { type, maxAttempts: 2 })) ?? '';
      await owner.query(`update platform.jobs set attempts = 1 where id = $1`, [id]); // A's claim becomes attempt 2/2
      let releaseA: () => void = () => undefined;
      const aGate = new Promise<void>((r) => (releaseA = r));
      let aStarted: () => void = () => undefined;
      const aRunning = new Promise<void>((r) => (aStarted = r));
      let deadCalls = 0;
      const a = new JobRunner(
        worker,
        [
          {
            type,
            handler: async () => {
              aStarted();
              await aGate;
              throw new JobError('PROVIDER_REJECTED');
            },
            onDead: () => {
              deadCalls++;
              return Promise.resolve();
            },
          },
        ],
        { workerId: SHARED, leaseMs: 150, batchSize: 1, log },
      );
      const aPass = a.runOnce();
      await aRunning;
      await new Promise((r) => setTimeout(r, 400));
      // Another claim with the SAME workerId takes over (reclaim, then a fresh token) and is still RUNNING.
      await worker.query(
        `update platform.jobs set status = 'QUEUED', lease_expires_at = null, locked_by = null, lease_token = null where id = $1 and lease_expires_at < now()`,
        [id],
      );
      const newToken = randomUUID();
      await worker.query(
        `update platform.jobs set status = 'RUNNING', lease_expires_at = now() + interval '1 minute', locked_by = $2, lease_token = $3 where id = $1`,
        [id, SHARED, newToken],
      );
      releaseA();
      expect(await aPass).toMatchObject({ claimed: 1, dead: 0, stale: 1 });
      expect(deadCalls).toBe(0);
      expect(await leaseOf(id)).toMatchObject({ status: 'RUNNING', lease_token: newToken });
    });

    it('every claim gets a fresh token and the schema rejects RUNNING without one', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push((await enqueueJob(api, { type: 'test.fence-tokens', maxAttempts: 1 })) ?? '');
      const seen = new Set<string>();
      const r = new JobRunner(
        worker,
        [
          {
            type: 'test.fence-tokens',
            handler: (job) => {
              seen.add(job.leaseToken);
              return Promise.resolve();
            },
          },
        ],
        { workerId: SHARED, leaseMs: 30000, batchSize: 5, log },
      );
      expect(await r.runOnce()).toMatchObject({ claimed: 5, succeeded: 5 });
      expect(seen.size).toBe(5);
      const probe = (await enqueueJob(api, { type: 'test.fence-check', maxAttempts: 1 })) ?? '';
      await expect(
        owner.query(`update platform.jobs set status = 'RUNNING', lease_expires_at = now() + interval '1 minute', locked_by = 'x' where id = $1`, [probe]),
      ).rejects.toThrow(/check constraint/);
    });
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
