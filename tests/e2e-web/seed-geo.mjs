/*
 * Geo-administration seed for the web-ops E2E stack (Phase 3, P3.2). SYNTHETIC data only, written into the throwaway
 * database `wayvro_e2e_ops`: two DISTINCT CATALOG_MANAGER staff (maker and checker for budgets and aliases; separate
 * from the catalog journey's managers so the specs never share a session) with ACTIVE assignments (requested by the
 * first bootstrap admin, approved by the second) and ENROLMENT invitations, plus three hourly usage rollups of the
 * synthetic provider key `geo-e2e` in the last hours (aggregates only, the shape the gateway writes). No budget or
 * alias is seeded: the spec drafts, approves and activates them through the UI.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const fileUrl = (root, path) => new URL(`file://${join(root, path).replaceAll('\\', '/')}`).href;

export async function seedGeo({ root, pool, adminIds }) {
  const { issueInvitation } = await import(fileUrl(root, 'apps/api/dist/staff/staff-admin.service.js'));
  const client = await pool.connect();
  try {
    await client.query('begin');
    const manager = async (displayName, workEmail) => {
      const staffId = randomUUID();
      const invitationId = randomUUID();
      await client.query(`insert into staff.staff_accounts (id, display_name, work_email, status) values ($1, $2, $3, 'INVITED')`, [
        staffId,
        displayName,
        workEmail,
      ]);
      await client.query(`insert into staff.invitations (id, staff_id, kind, status, created_by) values ($1, $2, 'ENROLMENT', 'PENDING_APPROVAL', $3)`, [
        invitationId,
        staffId,
        adminIds[0],
      ]);
      const invitation = await issueInvitation(client, invitationId, 3600);
      await client.query(
        `insert into staff.role_assignments (id, staff_id, role, status, requested_by, approved_by, decided_at, valid_from) values ($1, $2, 'CATALOG_MANAGER', 'ACTIVE', $3, $4, now(), now())`,
        [randomUUID(), staffId, adminIds[0], adminIds[1]],
      );
      return { staffId, invitation: invitation.token };
    };
    const maker = await manager('E2E Geo Maker', 'e2e.geo.maker@example.org');
    const checker = await manager('E2E Geo Checker', 'e2e.geo.checker@example.org');
    // whole UTC hours (the table CHECK), independent of the session time zone
    for (const [hoursAgo, calls, hits] of [
      [1, 42, 17],
      [2, 30, 12],
      [3, 25, 9],
    ]) {
      await client.query(
        `insert into geo.provider_usage (provider_key, sku, hour_bucket, calls, cache_hits, errors, timeouts, budget_refusals, est_cost_micro_usd)
         values ('geo-e2e', 'AUTOCOMPLETE', (date_trunc('hour', now() at time zone 'UTC') - make_interval(hours => $1)) at time zone 'UTC', $2, $3, 1, 0, 0, $4)`,
        [hoursAgo, calls, hits, calls * 2830],
      );
    }
    await client.query('commit');
    return { makerInvitation: maker.invitation, makerId: maker.staffId, checkerInvitation: checker.invitation, checkerId: checker.staffId };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
