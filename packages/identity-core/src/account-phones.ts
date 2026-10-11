/**
 * Phone release and session revocation shared by the API (phone change, dormant-number review) and the worker
 * (recovery completion, deletion) — data model §4.2, §4.4.
 */
import type { Queryable } from '@wayvro/server-runtime';

export type PhoneReleaseReason = 'PHONE_CHANGED' | 'RECYCLED_NUMBER_NEW_OWNER' | 'RECOVERY_MOVED' | 'ACCOUNT_DELETED';
export type SessionRevokeReason = 'PHONE_CHANGED' | 'RECOVERY' | 'RESTRICTION_SECURITY_HOLD' | 'ACCOUNT_DELETED';

/** A verified phone is released: it stops being the current owner of the number in every lookup version. */
export async function releasePhone(q: Queryable, phoneId: string, reason: PhoneReleaseReason): Promise<void> {
  await q.query(`update identity.account_phones set status = 'RELEASED', released_at = now(), release_reason = $2 where id = $1 and status = 'VERIFIED'`, [
    phoneId,
    reason,
  ]);
  await q.query(`update identity.phone_lookup_index set is_current_owner = false where account_phone_id = $1 and is_current_owner`, [phoneId]);
}

/** Revokes every ACTIVE session of the account (optionally except one); returns how many. */
export async function revokeSessions(q: Queryable, accountId: string, reason: SessionRevokeReason, exceptSessionId: string | null): Promise<number> {
  const r = await q.query(
    `update identity.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = $2, version = version + 1
      where account_id = $1 and status = 'ACTIVE' and ($3::uuid is null or id <> $3)`,
    [accountId, reason, exceptSessionId],
  );
  return r.rowCount ?? 0;
}
