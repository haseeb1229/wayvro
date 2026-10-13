/**
 * Staff administration of app version policies (A01/Q31; ADR-049; T3-25). Maker-checker (service rule AND database
 * CHECK): the drafter alone edits and submits; a DIFFERENT staff member approves; activation (now or scheduled on
 * server time) is a separate permission. Guardrails against bricking installs (`appPolicyGuardrailProblems`) are
 * checked at submit, approval and activation — and again by the worker at scheduled activation. Every change is
 * audited; activation also writes `platform.app-policy.activated.v1` to the outbox and an APP_POLICY_ACTIVATED signal.
 *
 * Activation protocol (shared with the worker's scheduled activation): transaction-scoped advisory lock per platform,
 * then a compare-and-set on `status = 'APPROVED'`; the loser of a race sees a non-APPROVED row and answers 409.
 */
import {
  appPolicyActivationLockKey,
  appPolicyGuardrailProblems,
  releasedBuildsOf,
  type AppPlatform,
  type BlockedBuildRange,
  type BlockedBuildReason,
  type GuardrailProblem,
  type WayvroEnv,
} from '@wayvro/config';
import type { Logger } from '@wayvro/observability';
import { appendAudit, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome, type Refusal } from '../idempotency.js';
import { emitEvent } from '../outbox.js';
import type { StaffPrincipal } from '../../staff/staff-session.js';

export interface PolicyAdminPolicy {
  readonly WAYVRO_ENV: WayvroEnv;
  readonly IDEMPOTENCY_TTL_SECONDS: number;
  readonly APP_LATEST_RELEASED_BUILD_ANDROID: number;
  readonly APP_LATEST_RELEASED_BUILD_IOS: number;
}

export interface PolicyValues {
  readonly minSupportedBuild: number;
  readonly recommendedBuild: number;
  readonly storeUrlKey: string | null;
  readonly softMessageKey: string;
  readonly hardMessageKey: string;
  readonly blockedRanges: readonly BlockedBuildRange[];
}

export type ActivationRequest = { readonly when: 'NOW' } | { readonly when: 'SCHEDULED'; readonly effectiveFrom: string };

interface PolicyRow {
  id: string;
  platform: AppPlatform;
  version: number;
  status: string;
  min_supported_build: number;
  recommended_build: number;
  store_url_key: string | null;
  soft_message_key: string;
  hard_message_key: string;
  effective_from: Date | null;
  effective_until: Date | null;
  scheduled: boolean;
  drafted_by_staff_id: string;
  approved_by_staff_id: string | null;
  created_at: Date;
}

const OBJECT = 'platform.app_version_policy';
/** Structural problems refused already at draft/revision (the release guardrails are checked from submit on). */
const STRUCTURAL: ReadonlySet<GuardrailProblem> = new Set<GuardrailProblem>(['RECOMMENDED_BELOW_MINIMUM', 'BLOCKED_RANGE_INVALID', 'BLOCKED_RANGES_OVERLAP']);

async function rangesOf(q: Queryable, ids: readonly string[]): Promise<Map<string, BlockedBuildRange[]>> {
  const out = new Map<string, BlockedBuildRange[]>();
  if (ids.length === 0) return out;
  const r = await q.query<{ policy_id: string; lower: number; upper: number; reason_code: BlockedBuildReason }>(
    `select policy_id, lower(builds) lower, upper(builds) upper, reason_code from platform.app_blocked_builds where policy_id = any($1::uuid[]) order by lower(builds)`,
    [ids],
  );
  for (const row of r.rows) {
    const list = out.get(row.policy_id) ?? [];
    list.push({ fromBuild: row.lower, toBuild: row.upper - 1, reasonCode: row.reason_code });
    out.set(row.policy_id, list);
  }
  return out;
}

const view = (p: PolicyRow, ranges: readonly BlockedBuildRange[]) => ({
  id: p.id,
  platform: p.platform,
  version: p.version,
  status: p.status,
  minSupportedBuild: p.min_supported_build,
  recommendedBuild: p.recommended_build,
  storeUrlKey: p.store_url_key,
  softMessageKey: p.soft_message_key,
  hardMessageKey: p.hard_message_key,
  blockedRanges: ranges,
  effectiveFrom: p.effective_from?.toISOString() ?? null,
  effectiveUntil: p.effective_until?.toISOString() ?? null,
  scheduled: p.scheduled,
  draftedByStaffId: p.drafted_by_staff_id,
  approvedByStaffId: p.approved_by_staff_id,
  createdAt: p.created_at.toISOString(),
});

export class AppPolicyAdminService {
  constructor(
    private readonly db: pg.Pool,
    private readonly idempotency: IdempotencyStore,
    private readonly policy: PolicyAdminPolicy,
    private readonly log: Logger,
    /** Called after a committed change that alters the ACTIVE state (local cache invalidation). */
    private readonly onActiveChange: () => void,
  ) {}

  private run(
    staff: StaffPrincipal,
    operation: string,
    key: string,
    payload: unknown,
    work: (tx: pg.PoolClient) => Promise<Outcome>,
  ): Promise<IdempotentResult> {
    return this.idempotency.execute({ scope: `staff:${staff.staffId}`, operation, key, payload, ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS }, work);
  }

  private async deny(tx: Queryable, staff: StaffPrincipal, objectId: string, reasonCode: string): Promise<Refusal> {
    await appendAudit(tx, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: 'STAFF_ACCESS_DENIED',
      objectType: OBJECT,
      objectId,
      outcome: 'DENIED',
      reasonCode,
    });
    return failure('WAYVRO_E_FORBIDDEN');
  }

  private audit(tx: Queryable, staff: StaffPrincipal, action: string, objectId: string, reasonCode?: string): Promise<string> {
    return appendAudit(tx, { actor: { type: 'STAFF', id: staff.staffId }, action, objectType: OBJECT, objectId, outcome: 'SUCCESS', reasonCode });
  }

  private problems(platform: AppPlatform, values: PolicyValues): GuardrailProblem[] {
    return appPolicyGuardrailProblems({ platform, ...values }, releasedBuildsOf(this.policy), this.policy.WAYVRO_ENV);
  }

  private async load(q: Queryable, id: string, lock = false): Promise<PolicyRow | undefined> {
    return (await q.query<PolicyRow>(`select * from platform.app_version_policies where id = $1${lock ? ' for update' : ''}`, [id])).rows[0];
  }

  private async render(q: Queryable, id: string) {
    const row = await this.load(q, id);
    if (!row) throw new Error('app version policy vanished');
    return view(row, (await rangesOf(q, [id])).get(id) ?? []);
  }

  private async valuesOf(q: Queryable, row: PolicyRow): Promise<PolicyValues> {
    return {
      minSupportedBuild: row.min_supported_build,
      recommendedBuild: row.recommended_build,
      storeUrlKey: row.store_url_key,
      softMessageKey: row.soft_message_key,
      hardMessageKey: row.hard_message_key,
      blockedRanges: (await rangesOf(q, [row.id])).get(row.id) ?? [],
    };
  }

  private async writeRanges(tx: pg.PoolClient, id: string, ranges: readonly BlockedBuildRange[]): Promise<void> {
    for (const r of ranges) {
      await tx.query(`insert into platform.app_blocked_builds (policy_id, builds, reason_code) values ($1, int4range($2, $3, '[]'), $4)`, [
        id,
        r.fromBuild,
        r.toBuild,
        r.reasonCode,
      ]);
    }
  }

  async list(platform?: AppPlatform): Promise<unknown> {
    const r = await this.db.query<PolicyRow>(
      `select * from platform.app_version_policies where ($1::text is null or platform = $1) order by platform, version desc limit 200`,
      [platform ?? null],
    );
    const ranges = await rangesOf(
      this.db,
      r.rows.map((p) => p.id),
    );
    return { policies: r.rows.map((p) => view(p, ranges.get(p.id) ?? [])) };
  }

  async get(id: string): Promise<unknown> {
    const row = await this.load(this.db, id);
    return row ? view(row, (await rangesOf(this.db, [id])).get(id) ?? []) : null;
  }

  /** Dry run: guardrail verdict + active sessions per recorded app version (builds are not recorded in Phase 2). */
  async preview(id: string): Promise<unknown> {
    const row = await this.load(this.db, id);
    if (!row) return null;
    const sessions = await this.db.query<{ app_version: string; n: string }>(
      `select s.app_version, count(*) n from identity.sessions s join identity.account_devices d on d.id = s.device_id
        where s.status = 'ACTIVE' and s.idle_expires_at > now() and s.absolute_expires_at > now() and d.platform = $1
        group by s.app_version order by count(*) desc, s.app_version limit 50`,
      [row.platform],
    );
    return {
      policyId: row.id,
      platform: row.platform,
      latestReleasedBuild: releasedBuildsOf(this.policy)[row.platform],
      guardrailProblems: this.problems(row.platform, await this.valuesOf(this.db, row)),
      buildsRecorded: false,
      activeSessionsByAppVersion: sessions.rows.map((s) => ({ appVersion: s.app_version, activeSessions: Number(s.n) })),
    };
  }

  draft(staff: StaffPrincipal, input: PolicyValues & { readonly platform: AppPlatform }, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'release-policies.draft', key, input, async (tx) => {
      const structural = this.problems(input.platform, input).filter((p) => STRUCTURAL.has(p));
      if (structural.length > 0) return failure('WAYVRO_E_VALIDATION', { reasonCodes: structural });
      const id = uuidv7();
      await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.app-policy-version:' || $1))`, [input.platform]);
      await tx.query(
        `insert into platform.app_version_policies (id, platform, version, status, min_supported_build, recommended_build, store_url_key, soft_message_key, hard_message_key, drafted_by_staff_id)
         select $1, $2, coalesce(max(version), 0) + 1, 'DRAFT', $3, $4, $5, $6, $7, $8 from platform.app_version_policies where platform = $2`,
        [id, input.platform, input.minSupportedBuild, input.recommendedBuild, input.storeUrlKey, input.softMessageKey, input.hardMessageKey, staff.staffId],
      );
      await this.writeRanges(tx, id, input.blockedRanges);
      await this.audit(tx, staff, 'APP_POLICY_DRAFTED', id);
      return success(201, await this.render(tx, id));
    });
  }

  revise(staff: StaffPrincipal, id: string, input: PolicyValues, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'release-policies.revise', key, { id, ...input }, async (tx) => {
      const row = await this.load(tx, id, true);
      if (!row) return failure('WAYVRO_E_NOT_FOUND');
      if (row.status !== 'DRAFT') return failure('WAYVRO_E_CONFLICT');
      if (row.drafted_by_staff_id !== staff.staffId) return this.deny(tx, staff, id, 'NOT_DRAFTER');
      const structural = this.problems(row.platform, input).filter((p) => STRUCTURAL.has(p));
      if (structural.length > 0) return failure('WAYVRO_E_VALIDATION', { reasonCodes: structural });
      await tx.query(
        `update platform.app_version_policies set min_supported_build = $2, recommended_build = $3, store_url_key = $4, soft_message_key = $5, hard_message_key = $6,
                version_lock = version_lock + 1 where id = $1`,
        [id, input.minSupportedBuild, input.recommendedBuild, input.storeUrlKey, input.softMessageKey, input.hardMessageKey],
      );
      await tx.query(`delete from platform.app_blocked_builds where policy_id = $1`, [id]);
      await this.writeRanges(tx, id, input.blockedRanges);
      await this.audit(tx, staff, 'APP_POLICY_REVISED', id);
      return success(200, await this.render(tx, id));
    });
  }

  submit(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'release-policies.submit', key, { id }, async (tx) => {
      const row = await this.load(tx, id, true);
      if (!row) return failure('WAYVRO_E_NOT_FOUND');
      if (row.status !== 'DRAFT') return failure('WAYVRO_E_CONFLICT');
      if (row.drafted_by_staff_id !== staff.staffId) return this.deny(tx, staff, id, 'NOT_DRAFTER');
      const problems = this.problems(row.platform, await this.valuesOf(tx, row));
      if (problems.length > 0) return failure('WAYVRO_E_VALIDATION', { reasonCodes: problems });
      await tx.query(`update platform.app_version_policies set status = 'PENDING_APPROVAL', version_lock = version_lock + 1 where id = $1`, [id]);
      await this.audit(tx, staff, 'APP_POLICY_SUBMITTED', id);
      return success(200, await this.render(tx, id));
    });
  }

  decide(staff: StaffPrincipal, id: string, decision: 'APPROVE' | 'REJECT', key: string): Promise<IdempotentResult> {
    return this.run(staff, 'release-policies.decide', key, { id, decision }, async (tx) => {
      const row = await this.load(tx, id, true);
      if (!row) return failure('WAYVRO_E_NOT_FOUND');
      if (row.status !== 'PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      if (row.drafted_by_staff_id === staff.staffId) return this.deny(tx, staff, id, 'MAKER_IS_CHECKER');
      if (decision === 'APPROVE') {
        const problems = this.problems(row.platform, await this.valuesOf(tx, row));
        if (problems.length > 0) return failure('WAYVRO_E_VALIDATION', { reasonCodes: problems });
        await tx.query(
          `update platform.app_version_policies set status = 'APPROVED', approved_by_staff_id = $2, version_lock = version_lock + 1 where id = $1`,
          [id, staff.staffId],
        );
      } else {
        await tx.query(`update platform.app_version_policies set status = 'REJECTED', version_lock = version_lock + 1 where id = $1`, [id]);
      }
      await this.audit(tx, staff, decision === 'APPROVE' ? 'APP_POLICY_APPROVED' : 'APP_POLICY_REJECTED', id);
      return success(200, await this.render(tx, id));
    });
  }

  /** Runs `work` on the policy under the platform's activation lock (the platform never changes, so it is read first). */
  private async locked(tx: pg.PoolClient, id: string, work: (row: PolicyRow) => Promise<Outcome>): Promise<Outcome> {
    const platform = (await tx.query<{ platform: AppPlatform }>(`select platform from platform.app_version_policies where id = $1`, [id])).rows[0]?.platform;
    if (!platform) return failure('WAYVRO_E_NOT_FOUND');
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [appPolicyActivationLockKey(platform)]);
    const row = await this.load(tx, id, true);
    if (!row) return failure('WAYVRO_E_NOT_FOUND');
    return work(row);
  }

  activate(staff: StaffPrincipal, id: string, request: ActivationRequest, key: string): Promise<IdempotentResult> {
    let activated = false;
    const result = this.run(staff, 'release-policies.activate', key, { id, ...request }, (tx) =>
      this.locked(tx, id, async (row) => {
        if (row.status !== 'APPROVED') return failure('WAYVRO_E_CONFLICT');
        const problems = this.problems(row.platform, await this.valuesOf(tx, row));
        if (problems.length > 0) return failure('WAYVRO_E_VALIDATION', { reasonCodes: problems });
        if (request.when === 'SCHEDULED') {
          const future = (await tx.query<{ ok: boolean }>(`select $1::timestamptz >= now() ok`, [request.effectiveFrom])).rows[0]?.ok;
          if (!future) return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['EFFECTIVE_FROM_IN_PAST'] });
          await tx.query(`update platform.app_version_policies set effective_from = $2, scheduled = true, version_lock = version_lock + 1 where id = $1`, [
            id,
            request.effectiveFrom,
          ]);
          await this.audit(tx, staff, 'APP_POLICY_SCHEDULED', id);
          return success(200, await this.render(tx, id));
        }
        const newer = await tx.query(`select 1 from platform.app_version_policies where platform = $1 and status = 'ACTIVE' and version > $2`, [
          row.platform,
          row.version,
        ]);
        if (newer.rowCount !== 0) return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['NEWER_POLICY_ACTIVE'] });
        await tx.query(
          `update platform.app_version_policies set status = 'RETIRED', effective_until = now(), version_lock = version_lock + 1 where platform = $1 and status = 'ACTIVE'`,
          [row.platform],
        );
        await tx.query(
          `update platform.app_version_policies set status = 'ACTIVE', effective_from = now(), scheduled = false, version_lock = version_lock + 1 where id = $1 and status = 'APPROVED'`,
          [id],
        );
        await emitEvent(tx, {
          type: 'platform.app-policy.activated.v1',
          aggregateType: OBJECT,
          aggregateId: id,
          accountId: null,
          payload: { platform: row.platform, version: row.version, scheduled: false },
        });
        await this.audit(tx, staff, 'APP_POLICY_ACTIVATED', id);
        activated = true;
        return success(200, await this.render(tx, id));
      }),
    );
    return result.then((r) => {
      if (activated && !r.replayed) {
        this.onActiveChange();
        this.log.info({ signal: 'APP_POLICY_ACTIVATED', policyId: id, actor: 'STAFF', scheduled: false }, 'app version policy activated');
      }
      return r;
    });
  }

  cancelSchedule(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'release-policies.cancel-schedule', key, { id }, (tx) =>
      this.locked(tx, id, async (row) => {
        if (row.status !== 'APPROVED' || !row.scheduled) return failure('WAYVRO_E_CONFLICT');
        await tx.query(`update platform.app_version_policies set effective_from = null, scheduled = false, version_lock = version_lock + 1 where id = $1`, [
          id,
        ]);
        await this.audit(tx, staff, 'APP_POLICY_SCHEDULE_CANCELLED', id);
        return success(200, await this.render(tx, id));
      }),
    );
  }

  /** ACTIVE → RETIRED (no ACTIVE policy = no update enforcement) or APPROVED → RETIRED (never activated). */
  retire(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    let wasActive = false;
    return this.run(staff, 'release-policies.retire', key, { id }, (tx) =>
      this.locked(tx, id, async (row) => {
        if (row.status === 'ACTIVE') {
          wasActive = true;
          await tx.query(
            `update platform.app_version_policies set status = 'RETIRED', effective_until = now(), version_lock = version_lock + 1 where id = $1`,
            [id],
          );
        } else if (row.status === 'APPROVED') {
          await tx.query(
            `update platform.app_version_policies set status = 'RETIRED', scheduled = false, effective_from = null, version_lock = version_lock + 1 where id = $1`,
            [id],
          );
        } else {
          return failure('WAYVRO_E_CONFLICT');
        }
        await this.audit(tx, staff, 'APP_POLICY_RETIRED', id);
        return success(200, await this.render(tx, id));
      }),
    ).then((r) => {
      if (wasActive && !r.replayed) this.onActiveChange();
      return r;
    });
  }
}
