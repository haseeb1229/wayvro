/*
 * Release-controls seed for the web-ops E2E stack (P3.4; A01/Q31/V10). SYNTHETIC staff only, written into the
 * throwaway database `wayvro_e2e_ops`: two DISTINCT RELEASE_MANAGER staff members (maker and checker) and one AUDITOR
 * (read-only release view), each with an ENROLMENT invitation the spec redeems with a virtual authenticator. The role
 * assignments are ACTIVE with a second STAFF_ADMIN as approver (the maker-checker shape of a real grant). No policy or
 * switch row is seeded: the spec creates them through the UI. Requires the RELEASE_MANAGER role CHECK of migration 0010.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const fileUrl = (root, path) => new URL(`file://${join(root, path).replaceAll('\\', '/')}`).href;

export async function seedRelease({ root, pool, adminIds }) {
  const { issueInvitation } = await import(fileUrl(root, 'apps/api/dist/staff/staff-admin.service.js'));
  const client = await pool.connect();
  try {
    await client.query('begin');
    const staff = async (displayName, workEmail, role) => {
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
        `insert into staff.role_assignments (id, staff_id, role, status, requested_by, approved_by, decided_at, valid_from) values ($1, $2, $3, 'ACTIVE', $4, $5, now(), now())`,
        [randomUUID(), staffId, role, adminIds[0], adminIds[1]],
      );
      return invitation.token;
    };
    const makerInvitation = await staff('E2E Release Maker', 'e2e.release.maker@example.org', 'RELEASE_MANAGER');
    const checkerInvitation = await staff('E2E Release Checker', 'e2e.release.checker@example.org', 'RELEASE_MANAGER');
    const auditorInvitation = await staff('E2E Release Auditor', 'e2e.release.auditor@example.org', 'AUDITOR');
    await client.query('commit');
    return { makerInvitation, checkerInvitation, auditorInvitation };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
