/**
 * Staff administration (H01, H08, K10; staff matrix §1–§4). Roles are code-defined; grants of privileged roles need a
 * DIFFERENT STAFF_ADMIN's approval (maker-checker, also a database CHECK); self-assignment is impossible. With a single
 * operator, two-person steps BLOCK rather than bypass (EG-20). Offboarding takes effect on the next request. Rosters
 * are paginated; there is no export. Every action is audited with the acting staff member.
 */
import { newOpaqueToken } from '@wayvro/identity-core';
import { appendAudit, sqlState, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import { failure, success, type IdempotencyStore, type IdempotentResult } from '../platform/idempotency.js';
import { invitationTokenHash } from './staff-auth.service.js';
import { CITY_SCOPED_ROLES, MAKER_CHECKER_ROLES, type StaffRole } from './roles.js';
import type { StaffPrincipal } from './staff-session.js';

export interface StaffAdminPolicy {
  readonly IDEMPOTENCY_TTL_SECONDS: number;
  readonly STAFF_INVITATION_TTL_SECONDS: number;
}

const ROSTER_PAGE = 50;

/** Out-of-band invitation token (`wvi_` + 256 random bits); only its SHA-256 is stored. */
function newInvitationToken(): string {
  return `wvi_${newOpaqueToken('access').slice(4)}`;
}

/** Issues an invitation token for an invitation row (status ISSUED, expiry). Returns the raw token once. */
export async function issueInvitation(q: Queryable, invitationId: string, ttlSeconds: number): Promise<{ token: string; expiresAt: Date }> {
  const token = newInvitationToken();
  const r = await q.query<{ expires_at: Date }>(
    `update staff.invitations set status = 'ISSUED', token_hash = $2, issued_at = now(), expires_at = now() + ($3::int * interval '1 second')
      where id = $1 returning expires_at`,
    [invitationId, invitationTokenHash(token), ttlSeconds],
  );
  const expiresAt = r.rows[0]?.expires_at;
  if (!expiresAt) throw new Error('invitation not found');
  return { token, expiresAt };
}

export class StaffAdminService {
  constructor(
    private readonly db: pg.Pool,
    private readonly idempotency: IdempotencyStore,
    private readonly policy: StaffAdminPolicy,
  ) {}

  private run(
    staff: StaffPrincipal,
    operation: string,
    key: string,
    payload: unknown,
    work: (tx: pg.PoolClient) => Promise<ReturnType<typeof success>>,
  ): Promise<IdempotentResult> {
    return this.idempotency.execute({ scope: `staff:${staff.staffId}`, operation, key, payload, ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS }, work);
  }

  async roster(cursor: string | undefined): Promise<unknown> {
    const accounts = await this.db.query<{ id: string; display_name: string; status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED'; credentials: string }>(
      `select a.id, a.display_name, a.status,
              (select count(*) from staff.webauthn_credentials c where c.staff_id = a.id and c.status = 'ACTIVE') credentials
         from staff.staff_accounts a where ($1::uuid is null or a.id > $1) order by a.id limit $2`,
      [cursor ?? null, ROSTER_PAGE + 1],
    );
    const page = accounts.rows.slice(0, ROSTER_PAGE);
    const roles = await this.db.query<{ staff_id: string; id: string; role: StaffRole; status: 'PENDING_APPROVAL' | 'ACTIVE'; cities: string[] | null }>(
      `select ra.staff_id, ra.id, ra.role, ra.status, array_remove(array_agg(c.city_code order by c.city_code), null) cities
         from staff.role_assignments ra left join staff.role_assignment_cities c on c.assignment_id = ra.id
        where ra.staff_id = any($1::uuid[]) and ra.status in ('PENDING_APPROVAL', 'ACTIVE')
        group by ra.staff_id, ra.id, ra.role, ra.status order by ra.role`,
      [page.map((a) => a.id)],
    );
    return {
      staff: page.map((a) => ({
        id: a.id,
        displayName: a.display_name,
        status: a.status,
        roles: roles.rows.filter((r) => r.staff_id === a.id).map((r) => ({ assignmentId: r.id, role: r.role, status: r.status, cities: r.cities ?? [] })),
        activeCredentials: Number(a.credentials),
      })),
      nextCursor: accounts.rows.length > ROSTER_PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async invite(staff: StaffPrincipal, input: { displayName: string; workEmail: string }, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'staff-admin.invite', key, input, async (tx) => {
      const staffId = uuidv7();
      const invitationId = uuidv7();
      await tx.query('savepoint invite');
      try {
        await tx.query(`insert into staff.staff_accounts (id, display_name, work_email, status) values ($1, $2, $3, 'INVITED')`, [
          staffId,
          input.displayName,
          input.workEmail,
        ]);
      } catch (e) {
        if (sqlState(e) !== '23505') throw e;
        await tx.query('rollback to savepoint invite');
        return failure('WAYVRO_E_CONFLICT');
      }
      await tx.query(`insert into staff.invitations (id, staff_id, kind, status, created_by) values ($1, $2, 'ENROLMENT', 'PENDING_APPROVAL', $3)`, [
        invitationId,
        staffId,
        staff.staffId,
      ]);
      const issued = await issueInvitation(tx, invitationId, this.policy.STAFF_INVITATION_TTL_SECONDS);
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'STAFF_INVITED',
        objectType: 'staff.staff_account',
        objectId: staffId,
        outcome: 'SUCCESS',
      });
      return success(201, { staffId, invitationId, invitationToken: issued.token, expiresAt: issued.expiresAt.toISOString() });
    });
  }

  async grantRole(staff: StaffPrincipal, input: { staffId: string; role: StaffRole; cityCodes: readonly string[] }, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'staff-admin.grant-role', key, input, async (tx) => {
      if (input.staffId === staff.staffId) {
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'STAFF_ROLE_GRANT_DENIED',
          objectType: 'staff.staff_account',
          objectId: input.staffId,
          outcome: 'DENIED',
          reasonCode: 'SELF_ASSIGNMENT',
        });
        return failure('WAYVRO_E_FORBIDDEN');
      }
      const target = await tx.query<{ status: string }>(`select status from staff.staff_accounts where id = $1 for update`, [input.staffId]);
      if (!target.rows[0]) return failure('WAYVRO_E_NOT_FOUND');
      if (target.rows[0].status === 'OFFBOARDED') return failure('WAYVRO_E_CONFLICT');
      const scoped = CITY_SCOPED_ROLES.has(input.role);
      if (scoped !== input.cityCodes.length > 0) return failure('WAYVRO_E_VALIDATION');
      const needsApproval = MAKER_CHECKER_ROLES.has(input.role);
      const id = uuidv7();
      await tx.query('savepoint role_grant');
      try {
        await tx.query(
          `insert into staff.role_assignments (id, staff_id, role, status, requested_by, valid_from) values ($1, $2, $3, $4, $5, case when $6 then null else now() end)`,
          [id, input.staffId, input.role, needsApproval ? 'PENDING_APPROVAL' : 'ACTIVE', staff.staffId, needsApproval],
        );
        for (const city of input.cityCodes) await tx.query(`insert into staff.role_assignment_cities (assignment_id, city_code) values ($1, $2)`, [id, city]);
      } catch (e) {
        const state = sqlState(e);
        if (state !== '23505' && state !== '23503') throw e;
        await tx.query('rollback to savepoint role_grant');
        return failure(state === '23505' ? 'WAYVRO_E_CONFLICT' : 'WAYVRO_E_VALIDATION');
      }
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: needsApproval ? 'STAFF_ROLE_REQUESTED' : 'STAFF_ROLE_GRANTED',
        objectType: 'staff.role_assignment',
        objectId: id,
        outcome: 'SUCCESS',
        reasonCode: input.role,
      });
      return success(201, { assignmentId: id, status: needsApproval ? 'PENDING_APPROVAL' : 'ACTIVE' });
    });
  }

  async decideRole(staff: StaffPrincipal, assignmentId: string, decision: 'APPROVE' | 'REJECT', key: string): Promise<IdempotentResult> {
    return this.run(staff, 'staff-admin.decide-role', key, { assignmentId, decision }, async (tx) => {
      const r = await tx.query<{ staff_id: string; requested_by: string | null; status: string; role: StaffRole }>(
        `select staff_id, requested_by, status, role from staff.role_assignments where id = $1 for update`,
        [assignmentId],
      );
      const row = r.rows[0];
      if (!row) return failure('WAYVRO_E_NOT_FOUND');
      if (row.status !== 'PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      // maker-checker: never the requester, never the grantee (database CHECK as the second layer)
      if (row.requested_by === staff.staffId || row.staff_id === staff.staffId) {
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'STAFF_ROLE_DECISION_DENIED',
          objectType: 'staff.role_assignment',
          objectId: assignmentId,
          outcome: 'DENIED',
          reasonCode: 'MAKER_IS_CHECKER',
        });
        return failure('WAYVRO_E_FORBIDDEN');
      }
      const status = decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
      await tx.query(
        `update staff.role_assignments set status = $2, approved_by = $3, decided_at = now(), valid_from = case when $2 = 'ACTIVE' then now() else null end where id = $1`,
        [assignmentId, status, staff.staffId],
      );
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: decision === 'APPROVE' ? 'STAFF_ROLE_APPROVED' : 'STAFF_ROLE_REJECTED',
        objectType: 'staff.role_assignment',
        objectId: assignmentId,
        outcome: 'SUCCESS',
        reasonCode: row.role,
      });
      return success(200, { assignmentId, status });
    });
  }

  async revokeRole(staff: StaffPrincipal, assignmentId: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'staff-admin.revoke-role', key, { assignmentId }, async (tx) => {
      const r = await tx.query<{ status: string; role: string }>(
        `update staff.role_assignments set status = 'REVOKED', revoked_at = now(), revoked_by = $2 where id = $1 and status in ('PENDING_APPROVAL', 'ACTIVE') returning status, role`,
        [assignmentId, staff.staffId],
      );
      if (r.rowCount !== 1) {
        const exists = await tx.query(`select 1 from staff.role_assignments where id = $1`, [assignmentId]);
        return failure(exists.rowCount === 0 ? 'WAYVRO_E_NOT_FOUND' : 'WAYVRO_E_CONFLICT');
      }
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'STAFF_ROLE_REVOKED',
        objectType: 'staff.role_assignment',
        objectId: assignmentId,
        outcome: 'SUCCESS',
        reasonCode: r.rows[0]?.role,
      });
      return success(200, { assignmentId, status: 'REVOKED' });
    });
  }

  /** Offboarding: OFFBOARDED + sessions, credentials and assignments ended in one transaction (next request fails). */
  async offboard(staff: StaffPrincipal, staffId: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'staff-admin.offboard', key, { staffId }, async (tx) => {
      if (staffId === staff.staffId) return failure('WAYVRO_E_FORBIDDEN');
      const r = await tx.query(
        `update staff.staff_accounts set status = 'OFFBOARDED', offboarded_at = now(), version = version + 1 where id = $1 and status <> 'OFFBOARDED'`,
        [staffId],
      );
      if (r.rowCount !== 1) {
        const exists = await tx.query(`select 1 from staff.staff_accounts where id = $1`, [staffId]);
        return failure(exists.rowCount === 0 ? 'WAYVRO_E_NOT_FOUND' : 'WAYVRO_E_CONFLICT');
      }
      const sessions = await tx.query(
        `update staff.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'OFFBOARDED' where staff_id = $1 and status <> 'REVOKED'`,
        [staffId],
      );
      const creds = await tx.query(`update staff.webauthn_credentials set status = 'REVOKED', revoked_at = now() where staff_id = $1 and status = 'ACTIVE'`, [
        staffId,
      ]);
      const roles = await tx.query(
        `update staff.role_assignments set status = 'REVOKED', revoked_at = now(), revoked_by = $2 where staff_id = $1 and status in ('PENDING_APPROVAL', 'ACTIVE')`,
        [staffId, staff.staffId],
      );
      await tx.query(`update staff.invitations set status = 'REVOKED' where staff_id = $1 and status in ('PENDING_APPROVAL', 'ISSUED')`, [staffId]);
      await tx.query(`update staff.break_glass_grants set status = 'ENDED', ended_at = now() where staff_id = $1 and status = 'ACTIVE'`, [staffId]);
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'STAFF_OFFBOARDED',
        objectType: 'staff.staff_account',
        objectId: staffId,
        outcome: 'SUCCESS',
      });
      return success(200, { revokedSessions: sessions.rowCount ?? 0, revokedCredentials: creds.rowCount ?? 0, endedAssignments: roles.rowCount ?? 0 });
    });
  }

  /** Lost every authenticator: a re-enrolment invitation PENDING a second admin's approval (maker-checker). */
  async requestReEnrolment(staff: StaffPrincipal, staffId: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'staff-admin.request-reenrolment', key, { staffId }, async (tx) => {
      if (staffId === staff.staffId) return failure('WAYVRO_E_FORBIDDEN');
      const target = await tx.query<{ status: string }>(`select status from staff.staff_accounts where id = $1`, [staffId]);
      if (!target.rows[0]) return failure('WAYVRO_E_NOT_FOUND');
      if (target.rows[0].status !== 'ACTIVE') return failure('WAYVRO_E_CONFLICT');
      const id = uuidv7();
      await tx.query('savepoint reenrol');
      try {
        await tx.query(`insert into staff.invitations (id, staff_id, kind, status, created_by) values ($1, $2, 'RE_ENROLMENT', 'PENDING_APPROVAL', $3)`, [
          id,
          staffId,
          staff.staffId,
        ]);
      } catch (e) {
        if (sqlState(e) !== '23505') throw e;
        await tx.query('rollback to savepoint reenrol');
        return failure('WAYVRO_E_CONFLICT');
      }
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'STAFF_REENROLMENT_REQUESTED',
        objectType: 'staff.invitation',
        objectId: id,
        outcome: 'SUCCESS',
      });
      return success(201, { invitationId: id, status: 'PENDING_APPROVAL' });
    });
  }

  async approveReEnrolment(staff: StaffPrincipal, invitationId: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'staff-admin.approve-reenrolment', key, { invitationId }, async (tx) => {
      const r = await tx.query<{ staff_id: string; created_by: string | null; status: string; kind: string }>(
        `select staff_id, created_by, status, kind from staff.invitations where id = $1 for update`,
        [invitationId],
      );
      const row = r.rows[0];
      if (row?.kind !== 'RE_ENROLMENT') return failure('WAYVRO_E_NOT_FOUND');
      if (row.status !== 'PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      if (row.created_by === staff.staffId || row.staff_id === staff.staffId) {
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'STAFF_REENROLMENT_DENIED',
          objectType: 'staff.invitation',
          objectId: invitationId,
          outcome: 'DENIED',
          reasonCode: 'MAKER_IS_CHECKER',
        });
        return failure('WAYVRO_E_FORBIDDEN');
      }
      await tx.query(`update staff.invitations set approved_by = $2 where id = $1`, [invitationId, staff.staffId]);
      const issued = await issueInvitation(tx, invitationId, this.policy.STAFF_INVITATION_TTL_SECONDS);
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'STAFF_REENROLMENT_APPROVED',
        objectType: 'staff.invitation',
        objectId: invitationId,
        outcome: 'SUCCESS',
      });
      return success(201, { staffId: row.staff_id, invitationId, invitationToken: issued.token, expiresAt: issued.expiresAt.toISOString() });
    });
  }
}
