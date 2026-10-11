/**
 * Staff bootstrap (staff matrix §1; closure correction §13). Run once by the founder with infrastructure/database
 * access; there is NO static emergency password, shared key, default account or backdoor.
 *
 * - Creates 1–2 STAFF_ADMIN accounts (two are needed for maker-checker from day one; with one, two-person steps block
 *   by design, EG-20) with single-use BOOTSTRAP invitations (24 h default) printed once for out-of-band delivery.
 * - Refuses while any ACTIVE staff member holds an ACTIVE STAFF_ADMIN assignment AND an ACTIVE authenticator — so it
 *   is also the audited recovery path when every admin lost every authenticator, never a way around existing admins.
 * - Writes an audit event per account and a high-severity structured alert.
 */
import { appendAudit, uuidv7, withTransaction } from '@wayvro/server-runtime';
import type { Logger } from '@wayvro/observability';
import type pg from 'pg';
import { issueInvitation } from './staff-admin.service.js';

export class BootstrapRefusedError extends Error {
  override readonly name = 'BootstrapRefusedError';
}

export interface BootstrapAdmin {
  readonly displayName: string;
  readonly workEmail: string;
}

export async function bootstrapStaffAdmins(
  pool: pg.Pool,
  admins: readonly BootstrapAdmin[],
  invitationTtlSeconds: number,
  log: Logger,
): Promise<ReadonlyArray<{ staffId: string; workEmail: string; invitationToken: string; expiresAt: Date }>> {
  if (admins.length < 1 || admins.length > 2) throw new BootstrapRefusedError('bootstrap creates one or two STAFF_ADMIN accounts');
  if (new Set(admins.map((a) => a.workEmail.toLowerCase())).size !== admins.length)
    throw new BootstrapRefusedError('bootstrap admins need distinct work e-mails');
  return withTransaction(pool, async (tx) => {
    // Serialise concurrent bootstrap runs on this database.
    await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.staff.bootstrap'))`);
    const live = await tx.query(
      `select 1 from staff.staff_accounts a
        where a.status = 'ACTIVE'
          and exists (select 1 from staff.role_assignments r where r.staff_id = a.id and r.role = 'STAFF_ADMIN' and r.status = 'ACTIVE')
          and exists (select 1 from staff.webauthn_credentials c where c.staff_id = a.id and c.status = 'ACTIVE')
        limit 1`,
    );
    if (live.rowCount !== 0) throw new BootstrapRefusedError('an active STAFF_ADMIN with an active authenticator exists; use the in-app maker-checker flows');
    const out: Array<{ staffId: string; workEmail: string; invitationToken: string; expiresAt: Date }> = [];
    for (const admin of admins) {
      const staffId = uuidv7();
      const invitationId = uuidv7();
      const email = admin.workEmail.toLowerCase();
      await tx.query(`insert into staff.staff_accounts (id, display_name, work_email, status) values ($1, $2, $3, 'INVITED')`, [
        staffId,
        admin.displayName,
        email,
      ]);
      await tx.query(`insert into staff.invitations (id, staff_id, kind, status) values ($1, $2, 'BOOTSTRAP', 'PENDING_APPROVAL')`, [invitationId, staffId]);
      const issued = await issueInvitation(tx, invitationId, invitationTtlSeconds);
      await tx.query(`insert into staff.role_assignments (id, staff_id, role, status, valid_from) values ($1, $2, 'STAFF_ADMIN', 'ACTIVE', now())`, [
        uuidv7(),
        staffId,
      ]);
      await appendAudit(tx, {
        actor: { type: 'SYSTEM' },
        action: 'STAFF_BOOTSTRAPPED',
        objectType: 'staff.staff_account',
        objectId: staffId,
        outcome: 'SUCCESS',
        reasonCode: 'STAFF_ADMIN',
      });
      log.error({ signal: 'STAFF_BOOTSTRAP', staffId }, 'security alert: staff bootstrap created a STAFF_ADMIN invitation');
      out.push({ staffId, workEmail: email, invitationToken: issued.token, expiresAt: issued.expiresAt });
    }
    return out;
  });
}
