/**
 * Recurring job scheduling on the job table: each tick enqueues a due job with a dedupe key, so several worker processes
 * never run the same recurring job concurrently (one open QUEUED/RUNNING job per type and key, ADR-042).
 */
import { enqueueJob, type Queryable } from '@wayvro/server-runtime';

export interface RecurringJob {
  readonly type: string;
  readonly everySeconds: number;
}

export class RecurringScheduler {
  private readonly lastScheduled = new Map<string, number>();

  constructor(
    private readonly db: Queryable,
    private readonly jobs: readonly RecurringJob[],
  ) {}

  /** Enqueues every job whose interval elapsed since this process last scheduled it; returns the types scheduled. */
  async tick(nowMs: number = Date.now()): Promise<string[]> {
    const scheduled: string[] = [];
    for (const job of this.jobs) {
      const last = this.lastScheduled.get(job.type);
      if (last !== undefined && nowMs - last < job.everySeconds * 1000) continue;
      this.lastScheduled.set(job.type, nowMs);
      if ((await enqueueJob(this.db, { type: job.type, maxAttempts: 3, dedupeKey: 'recurring' })) !== null) scheduled.push(job.type);
    }
    return scheduled;
  }
}
