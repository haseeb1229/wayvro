/**
 * Scheduled activation of APPROVED app version policies whose `effective_from` (server time) has passed (A01/Q31;
 * ADR-049). Same protocol as the staff activation in the API: advisory lock per platform, compare-and-set on
 * `status = 'APPROVED' AND scheduled`, then — at run time — every activation rule again: the T3-25 guardrails with the
 * configured latest released builds, and "never older than the ACTIVE policy". A refused policy is unscheduled (it
 * stays APPROVED for staff to fix or retire), audited as SYSTEM and raised as an error signal, so it is not retried
 * every minute. A successful activation retires the previous ACTIVE policy, is audited as SYSTEM and writes
 * `platform.app-policy.activated.v1` to the outbox.
 */
import {
  appPolicyActivationLockKey,
  appPolicyGuardrailProblems,
  type AppPlatform,
  type BlockedBuildReason,
  type ReleasedBuilds,
  type WayvroEnv,
} from '@wayvro/config';
import type { Logger } from '@wayvro/observability';
import { appendAudit, uuidv7, withTransaction } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { ActivationOutcome, ScheduledActivator } from './activation.js';

const OBJECT = 'platform.app_version_policy';
const BATCH = 50;

interface DueRow {
  id: string;
  platform: AppPlatform;
  version: number;
  min_supported_build: number;
  recommended_build: number;
  store_url_key: string | null;
}

export function appPolicyActivator(deps: {
  readonly pool: pg.Pool;
  readonly env: WayvroEnv;
  readonly released: ReleasedBuilds;
  readonly log: Logger;
}): ScheduledActivator {
  /** One policy in its own transaction: 'APPLIED' | 'REFUSED' | 'SKIPPED' (no longer due — e.g. a staff activation won). */
  const activateOne = (id: string, platform: AppPlatform): Promise<'APPLIED' | 'REFUSED' | 'SKIPPED'> =>
    withTransaction(deps.pool, async (tx) => {
      await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [appPolicyActivationLockKey(platform)]);
      const row = (
        await tx.query<DueRow>(
          `select id, platform, version, min_supported_build, recommended_build, store_url_key from platform.app_version_policies
            where id = $1 and status = 'APPROVED' and scheduled and effective_from <= now() for update`,
          [id],
        )
      ).rows[0];
      if (!row) return 'SKIPPED';
      const ranges = await tx.query<{ lower: number; upper: number; reason_code: BlockedBuildReason }>(
        `select lower(builds) lower, upper(builds) upper, reason_code from platform.app_blocked_builds where policy_id = $1`,
        [id],
      );
      const problems: string[] = appPolicyGuardrailProblems(
        {
          platform,
          minSupportedBuild: row.min_supported_build,
          recommendedBuild: row.recommended_build,
          storeUrlKey: row.store_url_key,
          blockedRanges: ranges.rows.map((r) => ({ fromBuild: r.lower, toBuild: r.upper - 1, reasonCode: r.reason_code })),
        },
        deps.released,
        deps.env,
      );
      const newer = await tx.query(`select 1 from platform.app_version_policies where platform = $1 and status = 'ACTIVE' and version > $2`, [
        platform,
        row.version,
      ]);
      if (newer.rowCount !== 0) problems.push('NEWER_POLICY_ACTIVE');
      if (problems.length > 0) {
        await tx.query(`update platform.app_version_policies set scheduled = false, effective_from = null, version_lock = version_lock + 1 where id = $1`, [
          id,
        ]);
        await appendAudit(tx, {
          actor: { type: 'SYSTEM' },
          action: 'APP_POLICY_SCHEDULE_REFUSED',
          objectType: OBJECT,
          objectId: id,
          outcome: 'FAILURE',
          reasonCode: problems[0],
        });
        deps.log.error({ signal: 'APP_POLICY_SCHEDULED_ACTIVATION_REFUSED', policyId: id, platform, problems }, 'scheduled app policy activation refused');
        return 'REFUSED';
      }
      await tx.query(
        `update platform.app_version_policies set status = 'RETIRED', effective_until = now(), version_lock = version_lock + 1 where platform = $1 and status = 'ACTIVE'`,
        [platform],
      );
      await tx.query(
        `update platform.app_version_policies set status = 'ACTIVE', effective_from = now(), scheduled = false, version_lock = version_lock + 1 where id = $1 and status = 'APPROVED'`,
        [id],
      );
      await tx.query(
        `insert into platform.outbox_events (id, type, aggregate_type, aggregate_id, account_id, payload, status) values ($1, 'platform.app-policy.activated.v1', $2, $3, null, $4, 'PENDING')`,
        [uuidv7(), OBJECT, id, JSON.stringify({ platform, version: row.version, scheduled: true })],
      );
      await appendAudit(tx, {
        actor: { type: 'SYSTEM' },
        action: 'APP_POLICY_ACTIVATED',
        objectType: OBJECT,
        objectId: id,
        outcome: 'SUCCESS',
        reasonCode: 'SCHEDULED',
      });
      deps.log.info({ signal: 'APP_POLICY_ACTIVATED', policyId: id, platform, actor: 'SYSTEM', scheduled: true }, 'app version policy activated');
      return 'APPLIED';
    });

  return {
    kind: 'app-policy',
    async runDue(): Promise<ActivationOutcome> {
      const due = await deps.pool.query<{ id: string; platform: AppPlatform }>(
        `select id, platform from platform.app_version_policies where scheduled and status = 'APPROVED' and effective_from <= now() order by effective_from, id limit $1`,
        [BATCH],
      );
      let applied = 0;
      let refused = 0;
      for (const d of due.rows) {
        const result = await activateOne(d.id, d.platform);
        if (result === 'APPLIED') applied++;
        if (result === 'REFUSED') refused++;
      }
      return { applied, refused };
    },
  };
}
