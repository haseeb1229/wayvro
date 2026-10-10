/**
 * PostgreSQL job runner (ADR-042; ADR-004 reserves FOR UPDATE SKIP LOCKED for job claiming).
 *
 * - Transactional enqueue: `enqueueJob` runs on the caller's transaction, so a job exists iff the state change commits.
 * - Claim: SKIP LOCKED batch claim that marks RUNNING with a lease and increments `attempts` (at-least-once).
 * - Crash recovery: RUNNING jobs whose lease expired are returned to QUEUED by the next pass of any worker.
 * - Completion is fenced by `locked_by`, so a slow worker whose lease was taken over cannot overwrite the new owner.
 * - Bounded retries with full-jitter exponential backoff; after `max_attempts` the job is DEAD (kept for review, alert).
 * - Handlers must be idempotent; errors are stored as stable codes only (never raw messages, which may carry PII).
 * - Sealed payloads (transient secrets) are purged when a job finishes, succeeded or dead.
 */
import type pg from 'pg';
import type { Logger } from '@wayvro/observability';
import type { Queryable } from './sql.js';
import { uuidv7 } from './uuidv7.js';

export interface EnqueueJob {
  readonly type: string;
  readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sealedPayload?: Buffer;
  /** Id chosen by the caller when the sealed payload's AAD must bind to it. */
  readonly id?: string;
  readonly maxAttempts: number;
  readonly runAfter?: Date;
  /** At most one QUEUED/RUNNING job per (type, dedupeKey). */
  readonly dedupeKey?: string;
}

/** Inserts a job on `q` (use the caller's transaction). Returns the id, or `null` if an open job has the dedupe key. */
export async function enqueueJob(q: Queryable, job: EnqueueJob): Promise<string | null> {
  const id = job.id ?? uuidv7();
  // ON CONFLICT with an arbiter index needs SELECT on its columns, so it is used only for dedupe-keyed (recurring)
  // jobs; plain enqueues stay INSERT-only, which is all the API role is granted.
  const conflict =
    job.dedupeKey === undefined ? '' : `on conflict (type, dedupe_key) where dedupe_key is not null and status in ('QUEUED', 'RUNNING') do nothing`;
  const r = await q.query(
    `insert into platform.jobs (id, type, status, payload, sealed_payload, max_attempts, run_after, dedupe_key)
     values ($1, $2, 'QUEUED', $3, $4, $5, coalesce($6, now()), $7) ${conflict}`,
    [id, job.type, JSON.stringify(job.payload ?? {}), job.sealedPayload ?? null, job.maxAttempts, job.runAfter ?? null, job.dedupeKey ?? null],
  );
  return r.rowCount === 1 ? id : null;
}

export interface ClaimedJob {
  readonly id: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sealedPayload: Buffer | null;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/** A handler failure with a stable, PII-free code (stored in `last_error_code`). */
export class JobError extends Error {
  override readonly name = 'JobError';
  constructor(
    readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

export interface JobDefinition {
  readonly type: string;
  readonly handler: (job: ClaimedJob) => Promise<void>;
  /** Called once when the job is moved to DEAD (e.g. to mark the domain object as failed). */
  readonly onDead?: (job: ClaimedJob) => Promise<void>;
}

export interface JobRunnerOptions {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly batchSize: number;
  readonly log: Logger;
  readonly random?: () => number;
}

export interface RunResult {
  readonly reclaimed: number;
  readonly claimed: number;
  readonly succeeded: number;
  readonly retried: number;
  readonly dead: number;
}

/** Bounded exponential backoff with full jitter (no retry storms, CLAUDE.md §13). */
export function backoffDelayMs(consecutiveFailures: number, random: () => number = Math.random, baseMs = 250, capMs = 30000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.min(consecutiveFailures, 16));
  return Math.floor(random() * ceiling);
}

const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export class JobRunner {
  private readonly definitions = new Map<string, JobDefinition>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    private readonly pool: pg.Pool,
    definitions: readonly JobDefinition[],
    private readonly options: JobRunnerOptions,
  ) {
    for (const d of definitions) {
      if (this.definitions.has(d.type)) throw new Error(`duplicate job handler for ${d.type}`);
      this.definitions.set(d.type, d);
    }
  }

  get types(): readonly string[] {
    return [...this.definitions.keys()];
  }

  /** One pass: reclaim expired leases, claim a batch of runnable jobs of the registered types, run them. */
  async runOnce(): Promise<RunResult> {
    const reclaimed = await this.pool.query(
      `update platform.jobs set status = 'QUEUED', lease_expires_at = null, locked_by = null, updated_at = now()
        where status = 'RUNNING' and lease_expires_at < now()`,
    );
    if (this.definitions.size === 0) return { reclaimed: reclaimed.rowCount ?? 0, claimed: 0, succeeded: 0, retried: 0, dead: 0 };
    const claimed = await this.pool.query<{
      id: string;
      type: string;
      payload: Record<string, unknown>;
      sealed_payload: Buffer | null;
      attempts: number;
      max_attempts: number;
    }>(
      `with next as (
         select id from platform.jobs
          where status = 'QUEUED' and run_after <= now() and type = any($1::text[])
          order by run_after
          limit $2
          for update skip locked)
       update platform.jobs j
          set status = 'RUNNING', attempts = j.attempts + 1, lease_expires_at = now() + ($3::int * interval '1 millisecond'),
              locked_by = $4, updated_at = now()
         from next where j.id = next.id
       returning j.id, j.type, j.payload, j.sealed_payload, j.attempts, j.max_attempts`,
      [this.types, this.options.batchSize, this.options.leaseMs, this.options.workerId],
    );
    let succeeded = 0;
    let retried = 0;
    let dead = 0;
    for (const row of claimed.rows) {
      const job: ClaimedJob = {
        id: row.id,
        type: row.type,
        payload: row.payload,
        sealedPayload: row.sealed_payload,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
      };
      const outcome = await this.execute(job);
      if (outcome === 'succeeded') succeeded++;
      else if (outcome === 'retried') retried++;
      else dead++;
    }
    return { reclaimed: reclaimed.rowCount ?? 0, claimed: claimed.rowCount ?? 0, succeeded, retried, dead };
  }

  private async execute(job: ClaimedJob): Promise<'succeeded' | 'retried' | 'dead'> {
    const definition = this.definitions.get(job.type);
    if (!definition) throw new Error(`claimed job of unregistered type ${job.type}`);
    try {
      await definition.handler(job);
      await this.pool.query(
        `update platform.jobs set status = 'SUCCEEDED', finished_at = now(), lease_expires_at = null, locked_by = null,
                sealed_payload = null, last_error_code = null, updated_at = now()
          where id = $1 and status = 'RUNNING' and locked_by = $2`,
        [job.id, this.options.workerId],
      );
      return 'succeeded';
    } catch (e) {
      const code = e instanceof JobError && CODE.test(e.code) ? e.code : 'UNEXPECTED_ERROR';
      if (job.attempts >= job.maxAttempts) {
        const moved = await this.pool.query(
          `update platform.jobs set status = 'DEAD', finished_at = now(), lease_expires_at = null, locked_by = null,
                  sealed_payload = null, last_error_code = $3, updated_at = now()
            where id = $1 and status = 'RUNNING' and locked_by = $2`,
          [job.id, this.options.workerId, code],
        );
        this.options.log.error({ jobId: job.id, jobType: job.type, attempts: job.attempts, errorCode: code, err: e }, 'job dead-lettered');
        if (moved.rowCount === 1 && definition.onDead) await definition.onDead(job);
        return 'dead';
      }
      const delay = backoffDelayMs(job.attempts, this.options.random);
      await this.pool.query(
        `update platform.jobs set status = 'QUEUED', run_after = now() + ($3::int * interval '1 millisecond'), lease_expires_at = null,
                locked_by = null, last_error_code = $4, updated_at = now()
          where id = $1 and status = 'RUNNING' and locked_by = $2`,
        [job.id, this.options.workerId, delay, code],
      );
      this.options.log.warn({ jobId: job.id, jobType: job.type, attempts: job.attempts, errorCode: code, retryInMs: delay }, 'job failed; retry scheduled');
      return 'retried';
    }
  }

  /** Polls every `intervalMs`; one pass at a time. A pass failure (e.g. database down) is logged and retried. */
  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.runOnce()
        .catch((e: unknown) => {
          this.options.log.error({ err: e }, 'job runner pass failed');
        })
        .finally(() => {
          this.running = undefined;
        });
    }, intervalMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
