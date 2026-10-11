/*
 * Support-journey seed for the web-ops E2E stack (Phase-2 closure, staff matrix §4). SYNTHETIC data only, written into
 * the throwaway database `wayvro_e2e_ops`:
 *   - a SUPPORT_AGENT (not maker-checker; city-scoped to a synthetic E2E city `ZZE`, so the support journey's recovery
 *     case never appears in the LHR reviewer journey's queue) and an AUDITOR (maker-checker shape), each with an
 *     ENROLMENT invitation the spec redeems with a virtual authenticator;
 *   - a rider-only account owning a synthetic +92 number, with two devices and two ACTIVE OTP sessions;
 *   - a verified driver (city ZZE) whose number was "lost", and an open RECOVERY_DRIVER_KYC request in MANUAL_REVIEW
 *     made from the session of a second account owning the new synthetic number (the proof-bearing recovery that
 *     support may hand to human review, never decide).
 * Phone numbers are stored only as the API stores them: an AES-GCM envelope, last 4 digits and the keyed lookup.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';

const fileUrl = (root, path) => new URL(`file://${join(root, path).replaceAll('\\', '/')}`).href;

const SUPPORT_CITY = 'ZZE';
const RIDER_PHONE = '+923000000417';
const DRIVER_PHONE = '+923000000418';
const NEW_PHONE = '+923000000419';
const PLACEHOLDER_SET = '00000000-0000-7000-8000-00000000c0a0';

export async function seedSupport({ root, pool, adminIds, keySeed }) {
  const { FieldCipher, KeyedHasher, localKeyRing } = await import(fileUrl(root, 'packages/field-crypto/dist/index.js'));
  const { ENCRYPTED_FIELDS, PhoneLookup, fieldContext } = await import(fileUrl(root, 'packages/identity-core/dist/index.js'));
  const { issueInvitation } = await import(fileUrl(root, 'apps/api/dist/staff/staff-admin.service.js'));
  const ring = localKeyRing(keySeed);
  const cipher = new FieldCipher(ring);
  const lookup = new PhoneLookup(new KeyedHasher(ring));
  const enc = (spec, value, rowId) => cipher.encrypt(spec.keyClass, value, fieldContext(spec, rowId));

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`insert into catalog.cities (code, name_en, name_ur, status) values ($1, 'E2E Synthetic City', 'E2E Synthetic City', 'ENABLED')`, [
      SUPPORT_CITY,
    ]);

    const staff = async (displayName, workEmail, role, approvedBy, cities) => {
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
      const assignment = randomUUID();
      await client.query(
        `insert into staff.role_assignments (id, staff_id, role, status, requested_by, approved_by, decided_at, valid_from) values ($1, $2, $3, 'ACTIVE', $4, $5, now(), now())`,
        [assignment, staffId, role, adminIds[0], approvedBy],
      );
      for (const city of cities) await client.query(`insert into staff.role_assignment_cities (assignment_id, city_code) values ($1, $2)`, [assignment, city]);
      return invitation.token;
    };
    const supportInvitation = await staff('E2E Support Agent', 'e2e.support@example.org', 'SUPPORT_AGENT', null, [SUPPORT_CITY]);
    const auditorInvitation = await staff('E2E Auditor', 'e2e.auditor@example.org', 'AUDITOR', adminIds[1], []);

    const account = async (e164) => {
      const accountId = randomUUID();
      const phoneId = randomUUID();
      await client.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [accountId]);
      await client.query(
        `insert into identity.account_phones (id, account_id, phone_envelope, phone_last4, status, verified_at) values ($1, $2, $3, $4, 'VERIFIED', now())`,
        [phoneId, accountId, enc(ENCRYPTED_FIELDS.accountPhone, e164, phoneId), e164.slice(-4)],
      );
      await lookup.writeCurrentOwner(client, phoneId, e164);
      await client.query(`insert into profile.rider_profiles (id, account_id, status) values ($1, $2, 'ACTIVE')`, [randomUUID(), accountId]);
      return accountId;
    };
    const session = async (accountId, platform) => {
      const deviceId = randomUUID();
      await client.query(
        `insert into identity.account_devices (id, account_id, installation_hash, platform, app_version, first_verified_at, last_seen_at, trust_state)
         values ($1, $2, $3, $4, '1.0.0', now(), now(), 'KNOWN')`,
        [deviceId, accountId, randomBytes(32), platform],
      );
      await client.query(
        `insert into identity.sessions (id, account_id, device_id, status, assurance, access_token_hash, access_expires_at, idle_expires_at, absolute_expires_at, app_version)
         values ($1, $2, $3, 'ACTIVE', 'OTP', $4, now() + interval '15 minutes', now() + interval '1 day', now() + interval '30 days', '1.0.0')`,
        [randomUUID(), accountId, deviceId, randomBytes(32)],
      );
    };

    // rider-only account with two signed-in devices
    const riderAccountId = await account(RIDER_PHONE);
    await session(riderAccountId, 'ANDROID');
    await session(riderAccountId, 'IOS');

    // verified driver in ZZE whose number was lost
    const driverAccountId = await account(DRIVER_PHONE);
    const appId = randomUUID();
    await client.query(
      `insert into compliance.driver_applications (id, account_id, state, city_code, requirement_set_id, submitted_at, decided_at)
       values ($1, $2, 'VERIFIED', $3, $4, now() - interval '30 days', now() - interval '29 days')`,
      [appId, driverAccountId, SUPPORT_CITY, PLACEHOLDER_SET],
    );
    const profileId = randomUUID();
    await client.query(
      `insert into compliance.driver_profiles (id, account_id, application_id, state, verified_legal_name_envelope, verified_date_of_birth_envelope, activated_at)
       values ($1, $2, $3, 'ACTIVE_ELIGIBLE', $4, $5, now() - interval '29 days')`,
      [
        profileId,
        driverAccountId,
        appId,
        enc(ENCRYPTED_FIELDS.profileLegalName, 'Synthetic E2E Driver', profileId),
        enc(ENCRYPTED_FIELDS.profileDob, '1988-03-02', profileId),
      ],
    );

    // the recovery is asked from the session of the account that now owns the new number
    const requesterAccountId = await account(NEW_PHONE);
    const recoveryId = randomUUID();
    const digest = lookup.activeDigest(NEW_PHONE);
    await client.query(
      `insert into identity.phone_change_requests (id, account_id, kind, new_phone_envelope, new_phone_last4, new_phone_lookup_version, new_phone_lookup_hash, status,
                                                   requested_by_account_id, expires_at)
       values ($1, $2, 'RECOVERY_DRIVER_KYC', $3, $4, $5, $6, 'MANUAL_REVIEW', $7, now() + interval '14 days')`,
      [
        recoveryId,
        driverAccountId,
        enc(ENCRYPTED_FIELDS.phoneChangePhone, NEW_PHONE, recoveryId),
        NEW_PHONE.slice(-4),
        digest.version,
        digest.digest,
        requesterAccountId,
      ],
    );
    await client.query('commit');
    return { supportInvitation, auditorInvitation, riderPhone: RIDER_PHONE, riderAccountId, driverAccountId, recoveryId };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
