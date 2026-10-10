/**
 * Opaque session tokens (K09; docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md §4): 256 random bits, base64url, with a type
 * prefix so an access token can never be used as a refresh token (and secret scanners can recognise them). The database
 * stores only SHA-256(token); raw tokens exist only in the issuing response and on the client.
 */
import { createHash, randomBytes } from 'node:crypto';

export type TokenKind = 'access' | 'refresh';

const PREFIX: Readonly<Record<TokenKind, string>> = { access: 'wva_', refresh: 'wvr_' };
const SHAPE = /^wv([ar])_[A-Za-z0-9_-]{43}$/;

export function newOpaqueToken(kind: TokenKind): string {
  return PREFIX[kind] + randomBytes(32).toString('base64url');
}

/** The token's kind, or `null` when it is not a well-formed Wayvro token. */
export function tokenKind(token: string): TokenKind | null {
  const m = SHAPE.exec(token);
  if (!m) return null;
  return m[1] === 'a' ? 'access' : 'refresh';
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Extracts the token from `Authorization: Bearer <token>`; anything else yields `null`. */
export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const m = /^Bearer ([A-Za-z0-9_-]{4,200})$/.exec(header);
  return m?.[1] ?? null;
}
