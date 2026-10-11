/**
 * Maintenance jobs (P2.1): purge expired idempotency records, OTP challenges past their short retention and old
 * succeeded jobs, in bounded batches; staff-realm housekeeping (P2.4): purge used/expired WebAuthn challenges older
 * than a day, expire unused invitations and break-glass grants past their end (an expiry is an alert event). Retention values are configuration placeholders marked NOT_COUNSEL_APPROVED
 * until the retention matrix exists (EG-16). DEAD jobs are kept for review.
 */
import type { Logger } from '@wayvro/observability';
import { uuidv7, type JobDefinition } from '@wayvro/server-runtime';
import type pg from 'pg';

export const MAINTENANCE_PURGE_JOB = 'maintenance.purge';

export interface RetentionPolicy {
  readonly otpChallengeDays: number;
  readonly succeededJobDays: number;
  readonly applicationDraftExpiryDays: number;
  readonly batchSize: number;
}

/** @internal exported for integration tests; production runs it through the maintenance.purge job. */
export async function purgeOnce(
  pool: pg.Pool,
  policy: RetentionPolicy,
): Promise<{
  idempotency: number;
  challenges: number;
  jobs: number;
  staffChallenges: number;
  invitationsExpired: number;
  breakGlassExpired: readonly string[];
  restrictionsExpired: number;
  draftsExpired: number;
  reviewLeasesExpired: number;
  oidcNonces: number;
}> {
  const idempotency = await pool.query(
    `delete from platform.idempotency_records where ctid in (select ctid from platform.idempotency_records where expires_at <= now() limit $1)`,
    [policy.batchSize],
  );
  const challenges = await pool.query(
    `delete from identity.otp_challenges where ctid in (select ctid from identity.otp_challenges where created_at < now() - ($1::int * interval '1 day') limit $2)`,
    [policy.otpChallengeDays, policy.batchSize],
  );
  // OIDC nonces live 5 minutes; spent or expired rows have no further use after a day (P2.10)
  const oidcNonces = await pool.query(
    `delete from identity.oidc_nonces where id in (select id from identity.oidc_nonces where created_at < now() - interval '1 day' limit $1)`,
    [policy.batchSize],
  );
  const jobs = await pool.query(
    `delete from platform.jobs where ctid in (select ctid from platform.jobs where status = 'SUCCEEDED' and finished_at < now() - ($1::int * interval '1 day') limit $2)`,
    [policy.succeededJobDays, policy.batchSize],
  );
  const staffChallenges = await pool.query(
    `delete from staff.webauthn_challenges where ctid in (select ctid from staff.webauthn_challenges where created_at < now() - interval '1 day' limit $1)`,
    [policy.batchSize],
  );
  const invitations = await pool.query(`update staff.invitations set status = 'EXPIRED' where status = 'ISSUED' and expires_at <= now()`);
  const breakGlass = await pool.query<{ id: string }>(
    `update staff.break_glass_grants set status = 'EXPIRED', ended_at = expires_at where status = 'ACTIVE' and expires_at <= now() returning id`,
  );
  // Restrictions past their end (e.g. auto-expiring RISK_HOLD) become EXPIRED with an append-only event.
  const restrictions = await pool.query<{ id: string }>(
    `update profile.restrictions set status = 'EXPIRED' where status in ('ACTIVE', 'LIFT_PENDING_APPROVAL') and effective_until <= now() returning id`,
  );
  for (const r of restrictions.rows) {
    await pool.query(
      `insert into profile.restriction_events (id, restriction_id, event, actor_system, reason_code) values ($1, $2, 'EXPIRED', 'worker.maintenance', 'EFFECTIVE_UNTIL_REACHED')`,
      [uuidv7(), r.id],
    );
    // outbox: the affected account's apps re-fetch their state (ids and status only)
    await pool.query(
      `insert into platform.outbox_events (id, type, aggregate_type, aggregate_id, account_id, payload, status)
       select $1, 'restriction.changed.v1', 'profile.restriction', r.id, coalesce(r.account_id, p.account_id), '{"status":"EXPIRED"}'::jsonb, 'PENDING'
         from profile.restrictions r left join compliance.driver_profiles p on p.id = r.driver_profile_id where r.id = $2`,
      [uuidv7(), r.id],
    );
  }
  // Review-case leases that lapsed go back to the queue (escalated cases stay with the seniors).
  const leases = await pool.query(
    `update compliance.review_cases set status = case when escalated then 'ESCALATED' else 'OPEN' end, assigned_staff_id = null, lease_expires_at = null,
            version = version + 1
      where status = 'CLAIMED' and lease_expires_at <= now()`,
  );
  const drafts = await pool.query(
    `update compliance.driver_applications set state = 'EXPIRED_DRAFT', updated_at = now(), version = version + 1
      where state in ('DRAFT', 'CONSENTED', 'DOCUMENTS_PENDING') and updated_at < now() - ($1::int * interval '1 day')`,
    [policy.applicationDraftExpiryDays],
  );
  return {
    restrictionsExpired: restrictions.rowCount ?? 0,
    reviewLeasesExpired: leases.rowCount ?? 0,
    draftsExpired: drafts.rowCount ?? 0,
    idempotency: idempotency.rowCount ?? 0,
    challenges: challenges.rowCount ?? 0,
    oidcNonces: oidcNonces.rowCount ?? 0,
    jobs: jobs.rowCount ?? 0,
    staffChallenges: staffChallenges.rowCount ?? 0,
    invitationsExpired: invitations.rowCount ?? 0,
    breakGlassExpired: breakGlass.rows.map((r) => r.id),
  };
}

export function maintenanceJob(pool: pg.Pool, log: Logger, policy: RetentionPolicy): JobDefinition {
  return {
    type: MAINTENANCE_PURGE_JOB,
    async handler() {
      const result = await purgeOnce(pool, policy);
      for (const id of result.breakGlassExpired) log.error({ signal: 'BREAK_GLASS_EXPIRED', breakGlassId: id }, 'security alert: break-glass grant expired');
      log.info({ ...result, breakGlassExpired: result.breakGlassExpired.length }, 'maintenance purge');
    },
  };
}
