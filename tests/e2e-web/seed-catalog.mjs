/*
 * Catalog-journey seed for the web-ops E2E stack (Phase 3, P3.1). SYNTHETIC data only, written into the throwaway
 * database `wayvro_e2e_ops`: two DISTINCT CATALOG_MANAGER staff (maker and checker; FA-10 — maker-checker needs two
 * human identities), each with an ACTIVE assignment (requested by the first bootstrap admin, approved by the second,
 * the maker-checker grant shape) and an ENROLMENT invitation the spec redeems with a virtual authenticator.
 * No catalog configuration is seeded: the spec drafts, approves and activates everything through the UI.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const fileUrl = (root, path) => new URL(`file://${join(root, path).replaceAll('\\', '/')}`).href;

export async function seedCatalog({ root, pool, adminIds }) {
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
    const maker = await manager('E2E Catalog Maker', 'e2e.catalog.maker@example.org');
    const checker = await manager('E2E Catalog Checker', 'e2e.catalog.checker@example.org');
    await client.query('commit');
    return { makerInvitation: maker.invitation, makerId: maker.staffId, checkerInvitation: checker.invitation, checkerId: checker.staffId };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
