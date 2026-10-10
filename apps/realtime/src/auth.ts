/**
 * Authenticated connections (TB8; SEC-RT; ADR-005b). A connection is accepted only when the authenticator returns a
 * principal for the handshake; room membership is derived from that principal, never from client-supplied room names.
 *
 * P2.1 binds the consumer SESSION authenticator: the handshake carries the access token in `auth.token`, verified
 * against the authoritative session row (same verifier as the API guard). Established connections are re-validated
 * periodically and closed when the access token expires, so a revoked or expired session cannot keep a socket and
 * cannot reconnect. Ride/driver realtime events are not part of P2.1.
 */
import { verifyAccessToken } from '@wayvro/identity-core';
import type { Queryable } from '@wayvro/server-runtime';

export interface RealtimePrincipal {
  /** Opaque, server-issued subject id (the account id); never a phone number or other PII. */
  readonly subject: string;
  readonly sessionId: string;
  /** Access-token expiry; the connection is closed at this instant (the client reconnects with a refreshed token). */
  readonly expiresAt: Date;
}

interface HandshakeInput {
  readonly auth: unknown;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export interface ConnectionAuthenticator {
  authenticate(handshake: HandshakeInput): Promise<RealtimePrincipal | null>;
  /** Re-checks an established connection against authoritative state. */
  isStillValid(principal: RealtimePrincipal): Promise<boolean>;
}

export class SessionAuthenticator implements ConnectionAuthenticator {
  constructor(private readonly db: Queryable) {}

  async authenticate(handshake: HandshakeInput): Promise<RealtimePrincipal | null> {
    const token = (handshake.auth as { token?: unknown } | null)?.token;
    if (typeof token !== 'string') return null;
    const session = await verifyAccessToken(this.db, token);
    return session ? { subject: session.accountId, sessionId: session.sessionId, expiresAt: session.accessExpiresAt } : null;
  }

  async isStillValid(principal: RealtimePrincipal): Promise<boolean> {
    const r = await this.db.query(
      `select 1 from identity.sessions s join identity.accounts a on a.id = s.account_id
        where s.id = $1 and s.status = 'ACTIVE' and a.status = 'ACTIVE' and s.idle_expires_at > now() and s.absolute_expires_at > now()`,
      [principal.sessionId],
    );
    return r.rowCount === 1 && principal.expiresAt.getTime() > Date.now();
  }
}

/** Server-side room naming: the only rooms a socket joins are derived from its verified principal. */
export function principalRoom(principal: Pick<RealtimePrincipal, 'subject'>): string {
  return `principal:${principal.subject}`;
}
