/**
 * Authoritative session verification shared by the API guard and the realtime handshake (K09, SEC-RT). Every call reads
 * the session row (DB is the source of truth; no cache in P2.1), so a revoked or expired session stops authorising the
 * next request or reconnect immediately. Server (database) time decides expiry. The query touches only the columns the
 * realtime role is granted.
 */
import type { Queryable } from '@wayvro/server-runtime';
import { hashToken, tokenKind } from './tokens.js';

export interface VerifiedSession {
  readonly sessionId: string;
  readonly accountId: string;
  readonly accessExpiresAt: Date;
  /** DELETION_PENDING sessions keep working during the grace period, restricted to the restricted-ok routes (P2.9). */
  readonly accountStatus: 'ACTIVE' | 'DELETION_PENDING';
}

export async function verifyAccessToken(q: Queryable, token: string): Promise<VerifiedSession | null> {
  if (tokenKind(token) !== 'access') return null;
  const r = await q.query<{ id: string; account_id: string; access_expires_at: Date; account_status: 'ACTIVE' | 'DELETION_PENDING' }>(
    `select s.id, s.account_id, s.access_expires_at, a.status account_status
       from identity.sessions s
       join identity.accounts a on a.id = s.account_id
      where s.access_token_hash = $1
        and s.status = 'ACTIVE'
        and a.status in ('ACTIVE', 'DELETION_PENDING')
        and s.access_expires_at > now()
        and s.idle_expires_at > now()
        and s.absolute_expires_at > now()`,
    [hashToken(token)],
  );
  const row = r.rows[0];
  return row ? { sessionId: row.id, accountId: row.account_id, accessExpiresAt: row.access_expires_at, accountStatus: row.account_status } : null;
}
