// SPIKE-ONLY shared settings and a tiny HMAC token so the gateway can authenticate handshakes.
// The secret below is a fixed local-only spike value, not a credential.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DATABASE_URL = process.env['SP05_DATABASE_URL'] ?? 'postgres://spike:spike-local-only@127.0.0.1:55433/sp05';
export const REDIS_URL = process.env['SP05_REDIS_URL'] ?? 'redis://127.0.0.1:56379';
export const API_PORT = 4100;
export const ENTITY_COUNT = 500;
const SPIKE_SECRET = 'sp05-local-spike-hmac-not-a-secret';

export type TokenClaims = { sub: string; entityId: number; exp: number };

export function signToken(claims: TokenClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const mac = createHmac('sha256', SPIKE_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyToken(token: unknown, nowMs: number): TokenClaims | null {
  if (typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', SPIKE_SECRET).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenClaims;
  return claims.exp > nowMs ? claims : null;
}

export type EntityEvent = { entityId: number; version: number; emittedAt: number };
export type Snapshot = { entityId: number; version: number; state: string };
