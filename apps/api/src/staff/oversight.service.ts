/**
 * Oversight: break-glass grants (H08) and the audit viewer (Q39).
 *
 * Break-glass: reason-coded, ≤ 60 minutes (database CHECK), one active grant per staff member, alert events at start
 * and end (high-severity structured log signal + banner data for STAFF_ADMIN/AUDITOR; SMS/paging later, EG-21), every
 * permissioned action under an active grant is tagged in the audit log, and a review by someone other than the holder
 * is due within 72 h.
 * Audit viewer: bounded, read-only database functions (the API role cannot read the audit tables directly), keyset
 * pagination, no export; seal status shows the latest verification and that external anchoring is EG-05.
 */
import { enqueueJob, appendAudit, uuidv7 } from '@wayvro/server-runtime';
import type { Logger } from '@wayvro/observability';
import type pg from 'pg';
import { failure, success, type IdempotencyStore, type IdempotentResult } from '../platform/idempotency.js';
import type { StaffPrincipal } from './staff-session.js';

const REVIEW_WINDOW_MS = 72 * 3600 * 1000;

interface GrantRow {
  id: string;
  staff_id: string;
  reason_code: string;
  status: string;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  review_outcome: string | null;
}

const grantView = (g: GrantRow) => ({
  id: g.id,
  staffId: g.staff_id,
  reasonCode: g.reason_code,
  status: g.status,
  startedAt: g.started_at.toISOString(),
  expiresAt: g.expires_at.toISOString(),
  endedAt: g.ended_at?.toISOString() ?? null,
  reviewOutcome: g.review_outcome,
  reviewDueAt: new Date(g.started_at.getTime() + REVIEW_WINDOW_MS).toISOString(),
});

export class OversightService {
  constructor(
    private readonly db: pg.Pool,
    private readonly idempotency: IdempotencyStore,
    private readonly log: Logger,
    private readonly ttlSeconds: number,
  ) {}

  async activateBreakGlass(
    staff: StaffPrincipal,
    input: { reasonCode: string; justification: string; durationMinutes: number },
    key: string,
  ): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `staff:${staff.staffId}`, operation: 'break-glass.activate', key, payload: input, ttlSeconds: this.ttlSeconds },
      async (tx) => {
        const id = uuidv7();
        // an expired-but-not-yet-swept grant must not block a new one
        await tx.query(`update staff.break_glass_grants set status = 'EXPIRED' where staff_id = $1 and status = 'ACTIVE' and expires_at <= now()`, [
          staff.staffId,
        ]);
        const r = await tx.query<GrantRow>(
          `insert into staff.break_glass_grants (id, staff_id, session_id, reason_code, justification, status, expires_at)
         select $1, $2, $3, $4, $5, 'ACTIVE', now() + ($6::int * interval '1 minute')
          where not exists (select 1 from staff.break_glass_grants where staff_id = $2 and status = 'ACTIVE')
         returning *`,
          [id, staff.staffId, staff.sessionId, input.reasonCode, input.justification, input.durationMinutes],
        );
        const grant = r.rows[0];
        if (!grant) return failure('WAYVRO_E_CONFLICT');
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'BREAK_GLASS_ACTIVATED',
          objectType: 'staff.break_glass_grant',
          objectId: id,
          outcome: 'SUCCESS',
          reasonCode: input.reasonCode,
        });
        this.log.error(
          {
            signal: 'BREAK_GLASS_ACTIVATED',
            breakGlassId: id,
            staffId: staff.staffId,
            reasonCode: input.reasonCode,
            expiresAt: grant.expires_at.toISOString(),
          },
          'security alert: break-glass activated',
        );
        return success(201, grantView(grant));
      },
    );
  }

  async endBreakGlass(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `staff:${staff.staffId}`, operation: 'break-glass.end', key, payload: { id }, ttlSeconds: this.ttlSeconds },
      async (tx) => {
        const r = await tx.query<GrantRow>(
          `update staff.break_glass_grants set status = 'ENDED', ended_at = now() where id = $1 and staff_id = $2 and status = 'ACTIVE' returning *`,
          [id, staff.staffId],
        );
        const grant = r.rows[0];
        if (!grant) {
          const own = await tx.query(`select 1 from staff.break_glass_grants where id = $1 and staff_id = $2`, [id, staff.staffId]);
          return failure(own.rowCount === 0 ? 'WAYVRO_E_NOT_FOUND' : 'WAYVRO_E_CONFLICT');
        }
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'BREAK_GLASS_ENDED',
          objectType: 'staff.break_glass_grant',
          objectId: id,
          outcome: 'SUCCESS',
        });
        this.log.error({ signal: 'BREAK_GLASS_ENDED', breakGlassId: id, staffId: staff.staffId }, 'security alert: break-glass ended');
        return success(200, grantView(grant));
      },
    );
  }

  async listBreakGlass(): Promise<unknown> {
    const r = await this.db.query<GrantRow>(
      `select id, staff_id, reason_code, case when status = 'ACTIVE' and expires_at <= now() then 'EXPIRED' else status end status, started_at, expires_at, ended_at, review_outcome
         from staff.break_glass_grants order by started_at desc limit 100`,
    );
    return { grants: r.rows.map(grantView) };
  }

  async reviewBreakGlass(staff: StaffPrincipal, id: string, outcome: 'JUSTIFIED' | 'NOT_JUSTIFIED', key: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `staff:${staff.staffId}`, operation: 'break-glass.review', key, payload: { id, outcome }, ttlSeconds: this.ttlSeconds },
      async (tx) => {
        const r = await tx.query<{ staff_id: string; status: string; expired: boolean }>(
          `select staff_id, status, expires_at <= now() expired from staff.break_glass_grants where id = $1 for update`,
          [id],
        );
        const row = r.rows[0];
        if (!row) return failure('WAYVRO_E_NOT_FOUND');
        if (row.staff_id === staff.staffId) {
          await appendAudit(tx, {
            actor: { type: 'STAFF', id: staff.staffId },
            action: 'BREAK_GLASS_REVIEW_DENIED',
            objectType: 'staff.break_glass_grant',
            objectId: id,
            outcome: 'DENIED',
            reasonCode: 'SELF_REVIEW',
          });
          return failure('WAYVRO_E_FORBIDDEN');
        }
        // only finished grants are reviewed
        if (row.status === 'REVIEWED' || (row.status === 'ACTIVE' && !row.expired)) return failure('WAYVRO_E_CONFLICT');
        const u = await tx.query<GrantRow>(
          `update staff.break_glass_grants set status = 'REVIEWED', reviewed_by = $2, reviewed_at = now(), review_outcome = $3, ended_at = coalesce(ended_at, expires_at) where id = $1 returning *`,
          [id, staff.staffId, outcome],
        );
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'BREAK_GLASS_REVIEWED',
          objectType: 'staff.break_glass_grant',
          objectId: id,
          outcome: 'SUCCESS',
          reasonCode: outcome,
        });
        const grant = u.rows[0];
        if (!grant) throw new Error('break-glass review update returned no row');
        return success(200, grantView(grant));
      },
    );
  }

  /** Unreviewed finished grants + active grants (banner for STAFF_ADMIN/AUDITOR). */
  async pendingBreakGlassReviews(): Promise<number> {
    const r = await this.db.query<{ n: string }>(`select count(*) n from staff.break_glass_grants where status <> 'REVIEWED'`);
    return Number(r.rows[0]?.n ?? 0);
  }

  async auditEvents(q: {
    beforeSeq?: string | undefined;
    actorType?: string | undefined;
    actorId?: string | undefined;
    action?: string | undefined;
    objectType?: string | undefined;
    objectId?: string | undefined;
  }): Promise<unknown> {
    const limit = 50;
    const r = await this.db.query<{
      seq: string;
      id: string;
      occurred_at: Date;
      actor_type: string;
      actor_id: string | null;
      action: string;
      object_type: string;
      object_id: string | null;
      outcome: string;
      reason_code: string | null;
      request_id: string | null;
    }>(`select * from audit.list_events($1, $2, $3, $4, $5, $6, $7)`, [
      q.beforeSeq ?? null,
      limit,
      q.actorType ?? null,
      q.actorId ?? null,
      q.action ?? null,
      q.objectType ?? null,
      q.objectId ?? null,
    ]);
    return {
      events: r.rows.map((e) => ({
        seq: e.seq,
        id: e.id,
        occurredAt: e.occurred_at.toISOString(),
        actorType: e.actor_type,
        actorId: e.actor_id,
        action: e.action,
        objectType: e.object_type,
        objectId: e.object_id,
        outcome: e.outcome,
        reasonCode: e.reason_code,
        requestId: e.request_id,
      })),
      nextBeforeSeq: r.rows.length === limit ? (r.rows.at(-1)?.seq ?? null) : null,
    };
  }

  async sealStatus(): Promise<unknown> {
    const r = await this.db.query<{
      seal_count: string;
      last_sealed_seq: string | null;
      last_sealed_at: Date | null;
      last_verified_at: Date | null;
      last_verification_ok: boolean | null;
      first_bad_seal_no: string | null;
      unsealed_below_watermark: number | null;
    }>(`select * from audit.seal_status()`);
    const s = r.rows[0];
    if (!s) throw new Error('audit.seal_status returned no row');
    return {
      sealCount: Number(s.seal_count),
      lastSealedSeq: s.last_sealed_seq,
      lastSealedAt: s.last_sealed_at?.toISOString() ?? null,
      lastVerification:
        s.last_verified_at && s.last_verification_ok !== null
          ? {
              verifiedAt: s.last_verified_at.toISOString(),
              ok: s.last_verification_ok,
              firstBadSealNo: s.first_bad_seal_no,
              unsealedBelowWatermark: s.unsealed_below_watermark ?? 0,
            }
          : null,
      externalAnchoring: 'NOT_CONFIGURED_EG_05',
    };
  }

  async requestVerification(staff: StaffPrincipal, key: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `staff:${staff.staffId}`, operation: 'audit.verify-request', key, payload: {}, ttlSeconds: this.ttlSeconds },
      async (tx) => {
        const jobId = await enqueueJob(tx, { type: 'audit.verify-seals', maxAttempts: 3 });
        if (!jobId) throw new Error('verification job was not enqueued');
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'AUDIT_VERIFICATION_REQUESTED',
          objectType: 'platform.job',
          objectId: jobId,
          outcome: 'SUCCESS',
        });
        return success(202, { jobId });
      },
    );
  }
}
