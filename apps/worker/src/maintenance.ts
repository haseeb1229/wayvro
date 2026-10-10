/**
 * Maintenance jobs (P2.1): purge expired idempotency records, OTP challenges past their short retention and old
 * succeeded jobs, in bounded batches. Retention values are configuration placeholders marked NOT_COUNSEL_APPROVED
 * until the retention matrix exists (EG-16). DEAD jobs are kept for review.
 */
import type { Logger } from '@wayvro/observability';
import type { JobDefinition } from '@wayvro/server-runtime';
import type pg from 'pg';

export const MAINTENANCE_PURGE_JOB = 'maintenance.purge';

export interface RetentionPolicy {
  readonly otpChallengeDays: number;
  readonly succeededJobDays: number;
  readonly batchSize: number;
}

/** @internal exported for integration tests; production runs it through the maintenance.purge job. */
export async function purgeOnce(pool: pg.Pool, policy: RetentionPolicy): Promise<{ idempotency: number; challenges: number; jobs: number }> {
  const idempotency = await pool.query(
    `delete from platform.idempotency_records where ctid in (select ctid from platform.idempotency_records where expires_at <= now() limit $1)`,
    [policy.batchSize],
  );
  const challenges = await pool.query(
    `delete from identity.otp_challenges where ctid in (select ctid from identity.otp_challenges where created_at < now() - ($1::int * interval '1 day') limit $2)`,
    [policy.otpChallengeDays, policy.batchSize],
  );
  const jobs = await pool.query(
    `delete from platform.jobs where ctid in (select ctid from platform.jobs where status = 'SUCCEEDED' and finished_at < now() - ($1::int * interval '1 day') limit $2)`,
    [policy.succeededJobDays, policy.batchSize],
  );
  return { idempotency: idempotency.rowCount ?? 0, challenges: challenges.rowCount ?? 0, jobs: jobs.rowCount ?? 0 };
}

export function maintenanceJob(pool: pg.Pool, log: Logger, policy: RetentionPolicy): JobDefinition {
  return {
    type: MAINTENANCE_PURGE_JOB,
    async handler() {
      log.info(await purgeOnce(pool, policy), 'maintenance purge');
    },
  };
}
