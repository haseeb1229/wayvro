/**
 * Authenticated-connection infrastructure (TB8 in docs/phase0/PHASE0_SECURITY_PRIVACY.md). A connection is accepted
 * only when an authenticator returns a principal for the handshake; room membership is derived from that principal,
 * never from client-supplied room names.
 *
 * Phase 1 has no identity system, so the only production authenticator is `DenyAllAuthenticator`: every connection is
 * refused (fail closed). Phase 2 binds the session-token verifier here.
 */

export interface RealtimePrincipal {
  /** Opaque, server-issued subject id; never a phone number or other PII. */
  readonly subject: string;
}

interface HandshakeInput {
  readonly auth: unknown;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export interface ConnectionAuthenticator {
  authenticate(handshake: HandshakeInput): Promise<RealtimePrincipal | null>;
}

export class DenyAllAuthenticator implements ConnectionAuthenticator {
  authenticate(): Promise<RealtimePrincipal | null> {
    return Promise.resolve(null);
  }
}

/** Server-side room naming: the only rooms a socket joins are derived from its verified principal. */
export function principalRoom(principal: RealtimePrincipal): string {
  return `principal:${principal.subject}`;
}
