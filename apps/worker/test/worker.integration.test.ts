/**
 * SEC-AUDIT / PROP-AUDIT (seals detect tampering and late rows), maintenance purge, recurring scheduling and the
 * worker composition — real PostgreSQL, executed as a LOGIN member of wayvro_worker + wayvro_audit_sealer.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { runMigrations } from '@wayvro/db';
import { createLogger } from '@wayvro/observability';
import { bindProviders } from '@wayvro/provider-interfaces';
import { appendAudit, enqueueJob } from '@wayvro/server-runtime';
import { captureLogs, createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import fc from 'fast-check';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIT_SEAL_JOB, AUDIT_VERIFY_JOB, auditJobs, merkleRoot, sealNextBatch, verifySeals } from '../src/audit-seal.js';
import { composeWorker } from '../src/composition.js';
import { loadWorkerConfig } from '../src/config.js';
import { maintenanceJob, purgeOnce } from '../src/maintenance.js';
import { RecurringScheduler } from '../src/scheduler.js';

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

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 2 });
  const workerLogin = await createRestrictedLogin(adminUrl, database.url, ['wayvro_worker', 'wayvro_audit_sealer']);
  const apiLogin = await createRestrictedLogin(adminUrl, database.url, 'wayvro_api');
  logins.push(workerLogin, apiLogin);
  worker = new pg.Pool({ connectionString: workerLogin.url, max: 4 });
  api = new pg.Pool({ connectionString: apiLogin.url, max: 2 });
});
afterAll(async () => {
  await Promise.all([owner.end(), worker.end(), api.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

const audit = (n: number) =>
  Promise.all(
    Array.from({ length: n }, () =>
      appendAudit(api, { actor: { type: 'SYSTEM' }, action: 'SEAL_PROBE', objectType: 'platform.probe', objectId: randomUUID(), outcome: 'SUCCESS' }),
    ),
  );

describe('audit seals', () => {
  it('SEC-AUDIT-02 seals batches into a hash chain and verifies cleanly', async () => {
    await audit(7);
    const first = await sealNextBatch(worker, { lagSeconds: 0, maxRows: 4 });
    const second = await sealNextBatch(worker, { lagSeconds: 0, maxRows: 4 });
    expect(first?.leafCount).toBe(4);
    expect(second?.leafCount).toBe(3);
    expect(await sealNextBatch(worker, { lagSeconds: 0, maxRows: 4 })).toBeNull();
    expect(await verifySeals(worker)).toEqual({ sealsVerified: 2, failures: [], unsealedBelowWatermark: 0 });
    const verify = auditJobs(worker, log, { lagSeconds: 0, maxRows: 4 }).find((j) => j.type === AUDIT_VERIFY_JOB);
    await verify?.handler({
      id: randomUUID(),
      type: AUDIT_VERIFY_JOB,
      payload: {},
      sealedPayload: null,
      attempts: 1,
      maxAttempts: 1,
      leaseToken: randomUUID(),
    });
    expect(logs.text()).toContain('audit seals verified');
    // the result is recorded append-only for the AUDITOR viewer (audit.seal_status())
    const recorded = await owner.query<{ ok: boolean; seals_checked: number }>(
      `select ok, seals_checked from audit.seal_verifications order by id desc limit 1`,
    );
    expect(recorded.rows[0]).toEqual({ ok: true, seals_checked: 2 });
  });

  it('PROP-AUDIT-04 a rewritten seal (privileged actor bypassing the trigger) breaks the hash chain', async () => {
    await audit(2);
    await sealNextBatch(worker, { lagSeconds: 0, maxRows: 100 });
    const last = await owner.query<{ seal_no: string; prev_seal_hash: Buffer }>(
      `select seal_no, prev_seal_hash from audit.audit_seals order by seal_no desc limit 1`,
    );
    const sealNo = last.rows[0]?.seal_no;
    await owner.query('alter table audit.audit_seals disable trigger audit_seals_append_only');
    try {
      await owner.query(`update audit.audit_seals set prev_seal_hash = $2 where seal_no = $1`, [sealNo, randomBytes(32)]);
      const reasons = (await verifySeals(worker)).failures.filter((f) => f.sealNo === sealNo).map((f) => f.reason);
      expect(reasons).toEqual(expect.arrayContaining(['CHAIN_BROKEN', 'SEAL_HASH_MISMATCH']));
    } finally {
      await owner.query(`update audit.audit_seals set prev_seal_hash = $2 where seal_no = $1`, [sealNo, last.rows[0]?.prev_seal_hash]);
      await owner.query('alter table audit.audit_seals enable trigger audit_seals_append_only');
    }
    expect((await verifySeals(worker)).failures).toEqual([]);
  });

  it('SEC-AUDIT-03 respects the lag: very recent rows are not sealed yet', async () => {
    await audit(2);
    expect(await sealNextBatch(worker, { lagSeconds: 3600, maxRows: 100 })).toBeNull();
    expect(await sealNextBatch(worker, { lagSeconds: 0, maxRows: 100 })).toMatchObject({ leafCount: 2 });
  });

  it('PROP-AUDIT-01 any modification of a sealed row (by a privileged actor bypassing the trigger) is detected', async () => {
    await audit(3);
    await sealNextBatch(worker, { lagSeconds: 0, maxRows: 100 });
    const rows = await owner.query<{ seq: string }>(`select seq from audit.audit_events order by seq`);
    const fields = ['outcome', 'reason_code', 'action'] as const;
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: rows.rows.length - 1 }), fc.constantFrom(...fields), async (index, field) => {
        const seq = rows.rows[index]?.seq;
        const value = field === 'outcome' ? 'DENIED' : field === 'reason_code' ? 'TAMPERED' : 'TAMPERED_ACTION';
        const original = await owner.query<Record<string, string | null>>(`select ${field} v from audit.audit_events where seq = $1`, [seq]);
        await owner.query('alter table audit.audit_events disable trigger audit_events_append_only');
        try {
          await owner.query(`update audit.audit_events set ${field} = $2 where seq = $1`, [seq, value]);
          const report = await verifySeals(worker);
          const restored = original.rows[0]?.['v'] ?? null;
          await owner.query(`update audit.audit_events set ${field} = $2 where seq = $1`, [seq, restored]);
          return original.rows[0]?.['v'] === value || report.failures.some((f) => f.reason === 'ROOT_MISMATCH');
        } finally {
          await owner.query('alter table audit.audit_events enable trigger audit_events_append_only');
        }
      }),
      { numRuns: 15 },
    );
    expect((await verifySeals(worker)).failures).toEqual([]);
  });

  it('PROP-AUDIT-02 deleted sealed rows and forged seal chains are detected; the job raises an alert', async () => {
    await audit(2);
    await sealNextBatch(worker, { lagSeconds: 0, maxRows: 100 });
    const victim = await owner.query<{ seq: string }>(`select max(seq) seq from audit.audit_events`);
    await owner.query('alter table audit.audit_events disable trigger audit_events_append_only');
    await owner.query(`delete from audit.audit_events where seq = $1`, [victim.rows[0]?.seq]);
    await owner.query('alter table audit.audit_events enable trigger audit_events_append_only');
    const report = await verifySeals(worker);
    expect(report.failures.map((f) => f.reason)).toContain('LEAF_COUNT_MISMATCH');
    const verify = auditJobs(worker, log, { lagSeconds: 0, maxRows: 100 }).find((j) => j.type === AUDIT_VERIFY_JOB);
    await verify?.handler({
      id: randomUUID(),
      type: AUDIT_VERIFY_JOB,
      payload: {},
      sealedPayload: null,
      attempts: 1,
      maxAttempts: 1,
      leaseToken: randomUUID(),
    });
    expect(logs.text()).toContain('AUDIT_SEAL_VERIFICATION_FAILED');
    // Forging the chain requires writing seals, which the sealer role can append but never alter.
    await expect(worker.query(`update audit.audit_seals set seal_hash = $1`, [randomBytes(32)])).rejects.toThrow(/permission denied|append-only/);
  });

  it('PROP-AUDIT-03 the Merkle root depends on every leaf and on order (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.uint8Array({ minLength: 32, maxLength: 32 }), { minLength: 2, maxLength: 20 }), fc.nat(), (raw, pick) => {
        const leaves = raw.map((r) => Buffer.from(r));
        if (new Set(leaves.map((l) => l.toString('hex'))).size !== leaves.length) return true;
        const root = merkleRoot(leaves);
        const changed = leaves.map((l) => Buffer.from(l));
        const target = changed[pick % changed.length];
        if (target) target[0] = (target[0] ?? 0) ^ 0xff;
        const swapped = [...leaves.slice(1), ...leaves.slice(0, 1)];
        return !merkleRoot(changed).equals(root) && !merkleRoot(swapped).equals(root);
      }),
    );
    expect(() => merkleRoot([])).toThrow(/empty/);
  });

  it('the seal job drains in bounded batches', async () => {
    await audit(5);
    const seal = auditJobs(worker, log, { lagSeconds: 0, maxRows: 2 }).find((j) => j.type === AUDIT_SEAL_JOB);
    await seal?.handler({ id: randomUUID(), type: AUDIT_SEAL_JOB, payload: {}, sealedPayload: null, attempts: 1, maxAttempts: 1, leaseToken: randomUUID() });
    expect(
      (
        await worker.query(
          `select 1 from audit.audit_events e where not exists (select 1 from audit.audit_seals s where e.seq between s.first_seq and s.last_seq)`,
        )
      ).rowCount,
    ).toBe(0);
  });
});

describe('maintenance, scheduling and composition', () => {
  it('purges expired idempotency records, old challenges and old succeeded jobs only', async () => {
    await owner.query(
      `insert into platform.idempotency_records (id, actor_scope, idempotency_key, operation, request_hash, state, response_status, response_envelope, created_at, expires_at)
       values ($1, 'acct:x', 'expired-key-000000001', 'probe.op', $2, 'COMPLETED', 200, $3, now() - interval '2 days', now() - interval '1 day'),
              ($4, 'acct:x', 'live-key-0000000000001', 'probe.op', $2, 'COMPLETED', 200, $3, now(), now() + interval '1 day')`,
      [randomUUID(), randomBytes(32), randomBytes(40), randomUUID()],
    );
    await owner.query(
      `insert into platform.jobs (id, type, status, max_attempts, finished_at) values ($1, 'probe.old', 'SUCCEEDED', 1, now() - interval '30 days'), ($2, 'probe.new', 'SUCCEEDED', 1, now()), ($3, 'probe.dead', 'DEAD', 1, now() - interval '30 days')`,
      [randomUUID(), randomUUID(), randomUUID()],
    );
    const result = await purgeOnce(worker, { otpChallengeDays: 7, succeededJobDays: 7, applicationDraftExpiryDays: 30, batchSize: 100 });
    expect(result).toMatchObject({ idempotency: 1, jobs: 1, staffChallenges: 0, invitationsExpired: 0, breakGlassExpired: [] });
    expect((await owner.query(`select 1 from platform.jobs where type in ('probe.new', 'probe.dead')`)).rowCount).toBe(2);
    await maintenanceJob(worker, log, { otpChallengeDays: 7, succeededJobDays: 7, applicationDraftExpiryDays: 30, batchSize: 100 }).handler({
      id: randomUUID(),
      type: 'maintenance.purge',
      payload: {},
      sealedPayload: null,
      attempts: 1,
      maxAttempts: 1,
      leaseToken: randomUUID(),
    });
    expect(logs.text()).toContain('maintenance purge');
  });

  it('recurring jobs are scheduled once per interval and never twice while open', async () => {
    const a = new RecurringScheduler(worker, [{ type: 'probe.recurring', everySeconds: 60 }]);
    const b = new RecurringScheduler(worker, [{ type: 'probe.recurring', everySeconds: 60 }]);
    expect(await a.tick(1_000_000)).toEqual(['probe.recurring']);
    expect(await b.tick(1_000_000)).toEqual([]);
    expect(await a.tick(1_030_000)).toEqual([]);
    await enqueueJob(worker, { type: 'probe.other', maxAttempts: 1 });
    expect((await owner.query(`select 1 from platform.jobs where type = 'probe.recurring' and status = 'QUEUED'`)).rowCount).toBe(1);
  });

  it('composition registers no OTP delivery without a real adapter and refuses production key material', () => {
    const base = { DATABASE_URL: database.url, REDIS_URL: 'redis://127.0.0.1:26379' };
    const local = loadWorkerConfig({ ...base, WAYVRO_ENV: 'test', WAYVRO_LOCAL_KEY_SEED: 'synthetic-worker-seed-0000000000000000' });
    const { runner } = composeWorker(local, worker, log, bindProviders('test', {}));
    expect(runner.types).toEqual([
      'audit.seal',
      'audit.verify-seals',
      'maintenance.purge',
      'crypto.key-rotation',
      'driver-application.intake',
      'compliance.document-expiry',
      'identity.recovery-completion',
      'config.scheduled-activation',
    ]);
    // When a delivery adapter is bound (a real one after EG-01), the worker also claims otp.deliver jobs.
    const withAdapter = composeWorker(local, worker, log, bindProviders('test', { otpDelivery: { send: () => Promise.resolve({ providerMessageId: 'x' }) } }));
    expect(withAdapter.runner.types).toContain('otp.deliver');
    const prod = loadWorkerConfig({
      WAYVRO_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@db.example/w?sslmode=verify-full',
      REDIS_URL: 'rediss://cache.example:6380',
    });
    expect(() => composeWorker(prod, worker, log, bindProviders('production', {}))).toThrow(/no production key provider/);
  });
});
