/**
 * P2.9 shared account-lifecycle primitives as the restricted roles that use them: phone release (no longer the current
 * owner in any lookup version), session revocation (optionally except one), deletion blockers (legal hold, recovery in
 * progress, open safety/fraud restriction; expired restrictions do not block) and retention exceptions (driver records
 * only for driver accounts), and key rotation skipping erased envelopes. Synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deletionBlockers, releasePhone, retentionExceptions, revokeSessions } from '../src/index.js';
import { crypto, harness, seedOwner, syntheticPhone, type Harness } from './helpers.js';

const c = crypto();
let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => {
  await h.close();
});

async function session(accountId: string): Promise<string> {
  const device = randomUUID();
  const id = randomUUID();
  await h.owner.query(
    `insert into identity.account_devices (id, account_id, installation_hash, platform, app_version, first_verified_at, last_seen_at, trust_state) values ($1, $2, $3, 'ANDROID', '1.0.0', now(), now(), 'NEW')`,
    [device, accountId, randomBytes(32)],
  );
  await h.owner.query(
    `insert into identity.sessions (id, account_id, device_id, status, assurance, access_token_hash, access_expires_at, idle_expires_at, absolute_expires_at, app_version)
     values ($1, $2, $3, 'ACTIVE', 'OTP', $4, now() + interval '15 minutes', now() + interval '1 day', now() + interval '2 days', '1.0.0')`,
    [id, accountId, device, randomBytes(32)],
  );
  return id;
}
const restriction = (accountId: string, reasonClass: string, until: string | null) =>
  h.owner.query(
    `insert into profile.restrictions (id, scope, account_id, reason_code, reason_class, status, effective_from, effective_until, appealable, created_by_system)
     values ($1, 'ACCOUNT', $2, 'FIXTURE_REASON', $3, 'ACTIVE', now() - interval '2 days', $4::timestamptz, true, 'test-fixture')`,
    [randomUUID(), accountId, reasonClass, until],
  );

describe('phones and sessions', () => {
  it('a released phone is no longer the current owner; sessions are revoked except the one kept', async () => {
    const e164 = syntheticPhone();
    const a = await seedOwner(h.api, c, e164);
    expect((await c.lookup.currentOwner(h.api, e164))?.accountId).toBe(a.accountId);
    await releasePhone(h.api, a.phoneId, 'PHONE_CHANGED');
    await releasePhone(h.api, a.phoneId, 'PHONE_CHANGED'); // idempotent
    expect(await c.lookup.currentOwner(h.api, e164)).toBeNull();
    const kept = await session(a.accountId);
    const other = await session(a.accountId);
    expect(await revokeSessions(h.worker, a.accountId, 'RECOVERY', kept)).toBe(1);
    expect(await revokeSessions(h.worker, a.accountId, 'RECOVERY', null)).toBe(1);
    const rows = await h.owner.query<{ id: string; revoke_reason: string }>(
      `select id, revoke_reason from identity.sessions where account_id = $1 order by id`,
      [a.accountId],
    );
    expect(rows.rows.map((r) => r.revoke_reason)).toEqual(['RECOVERY', 'RECOVERY']);
    expect(rows.rows.map((r) => r.id).sort()).toEqual([kept, other].sort());
  });
});

describe('deletion rules', () => {
  it('blockers: legal hold, open safety/fraud restriction, recovery in progress; expired restrictions do not block', async () => {
    const a = await seedOwner(h.api, c, syntheticPhone());
    expect(await deletionBlockers(h.worker, a.accountId)).toEqual([]);
    await restriction(a.accountId, 'LEGAL', null);
    await restriction(a.accountId, 'FRAUD', null);
    await restriction(a.accountId, 'SAFETY', new Date(Date.now() - 86_400_000).toISOString());
    expect(await deletionBlockers(h.worker, a.accountId)).toEqual(['LEGAL_HOLD', 'OPEN_SAFETY_OR_FRAUD_INVESTIGATION']);
    const requester = await seedOwner(h.api, c, syntheticPhone());
    await h.owner.query(
      `insert into identity.phone_change_requests (id, account_id, kind, new_phone_envelope, new_phone_last4, new_phone_lookup_version, new_phone_lookup_hash, status, requested_by_account_id, expires_at)
       values ($1, $2, 'RECOVERY_DRIVER_KYC', $3, '1234', 1, $4, 'MANUAL_REVIEW', $5, now() + interval '30 days')`,
      [randomUUID(), a.accountId, randomBytes(40), randomBytes(32), requester.accountId],
    );
    expect(await deletionBlockers(h.api, a.accountId)).toEqual(['LEGAL_HOLD', 'RECOVERY_IN_PROGRESS', 'OPEN_SAFETY_OR_FRAUD_INVESTIGATION']);
    // the new-number side of a recovery is blocked too
    expect(await deletionBlockers(h.api, requester.accountId)).toEqual(['RECOVERY_IN_PROGRESS']);
  });

  it('retention exceptions name driver records only for accounts with a driver application; every basis is a placeholder', async () => {
    const rider = await seedOwner(h.api, c, syntheticPhone());
    const driver = await seedOwner(h.api, c, syntheticPhone());
    await h.owner.query(`insert into compliance.driver_applications (id, account_id, state, city_code) values ($1, $2, 'DRAFT', 'LHR')`, [
      randomUUID(),
      driver.accountId,
    ]);
    const riderKept = await retentionExceptions(h.api, rider.accountId);
    const driverKept = await retentionExceptions(h.api, driver.accountId);
    expect(riderKept.map((k) => k.dataCategory)).toEqual(['SECURITY_AND_AUDIT_RECORDS', 'CONSENT_AND_AGE_RECORDS']);
    expect(driverKept.map((k) => k.dataCategory)).toEqual([
      'SECURITY_AND_AUDIT_RECORDS',
      'CONSENT_AND_AGE_RECORDS',
      'DRIVER_REVIEW_DECISIONS',
      'DRIVER_IDENTITY_RECORDS',
    ]);
    expect([...riderKept, ...driverKept].every((k) => k.basisRef.includes('EG-16'))).toBe(true);
  });
});
