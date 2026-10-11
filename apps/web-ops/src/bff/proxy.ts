/**
 * web-ops BFF (staff matrix §1): the browser talks only to web-ops; this server-side proxy holds the staff session
 * token in an `__Host-` HttpOnly, Secure, SameSite=Strict cookie and forwards it to the API as a bearer. The token is
 * never readable by browser JavaScript and the API stays closed to cross-origin callers.
 *
 * - Allowlist: only the `/v1/admin/*` method+path pairs declared in the contract registry are forwarded; anything
 *   else is 404 here. There is no generic open proxy.
 * - Mutations require a same-origin `Origin` header (CSRF defence on top of SameSite=Strict).
 * - Session-issuing responses (enrolment, login) are rewritten: the token goes into the cookie, the browser receives
 *   only the session id and expiry. Logout clears the cookie.
 */
import { API_ROUTES } from '@wayvro/contracts';

export const SESSION_COOKIE = '__Host-wv_staff';
const TOKEN = /^wvs_[A-Za-z0-9_-]{43}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_-]{16,128}$/;
const SESSION_ISSUING = new Set(['POST /v1/admin/auth/enrolments', 'POST /v1/admin/auth/sessions']);

export interface BffConfig {
  /** Internal API base URL (server-side only), e.g. http://127.0.0.1:4000. */
  readonly apiUrl: string;
  /** Public origin of web-ops (Origin check), e.g. http://localhost:3310. */
  readonly publicOrigin: string;
}

export function bffConfig(env: Readonly<Record<string, string | undefined>> = process.env): BffConfig {
  return {
    apiUrl: env['WAYVRO_API_INTERNAL_URL'] ?? 'http://127.0.0.1:4000',
    publicOrigin: env['WAYVRO_OPS_PUBLIC_ORIGIN'] ?? 'http://localhost:3310',
  };
}

const ROUTES = API_ROUTES.filter((r) => r.path.startsWith('/v1/admin/')).map((r) => ({
  method: r.method,
  path: r.path,
  // path parameters are uuids or small integers (age-policy versions)
  pattern: new RegExp(`^${r.path.replace(/\{\w+\}/g, '(?:[0-9a-f-]{36}|[1-9][0-9]{0,5})')}$`),
}));

/** The declared admin route matching `method` + `/v1/admin/<rest>`, or undefined. */
function matchRoute(method: string, rest: string): { method: string; path: string } | undefined {
  const path = `/v1/admin/${rest}`;
  return ROUTES.find((r) => r.method === method && r.pattern.test(path));
}

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const token = value.join('=');
      return TOKEN.test(token) ? token : null;
    }
  }
  return null;
}

function sessionCookie(token: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${String(maxAge)}`;
}
const CLEAR_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
}
const notFound = () => json(404, { error: { code: 'WAYVRO_E_NOT_FOUND', message: 'The requested resource was not found.', requestId: 'bff' } });

/** Handles one browser request to `/bff/<rest>`. */
export async function forward(request: Request, rest: string, cfg: BffConfig = bffConfig()): Promise<Response> {
  const method = request.method.toUpperCase();
  const route = matchRoute(method, rest);
  if (!route) return notFound();
  if (method !== 'GET' && request.headers.get('origin') !== cfg.publicOrigin) {
    return json(403, { error: { code: 'WAYVRO_E_FORBIDDEN', message: 'This action is not allowed.', requestId: 'bff' } });
  }
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = readSessionToken(request.headers.get('cookie'));
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (method !== 'GET') {
    const key = request.headers.get('idempotency-key');
    headers['idempotency-key'] = key && IDEMPOTENCY.test(key) ? key : crypto.randomUUID();
  }
  let body: string | undefined;
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
    body = await request.text();
    headers['content-type'] = 'application/json';
  }
  const url = new URL(request.url);
  const upstream = await fetch(`${cfg.apiUrl}/v1/admin/${rest}${url.search}`, { method, headers, ...(body !== undefined ? { body } : {}), cache: 'no-store' });
  const upstreamType = upstream.headers.get('content-type') ?? '';
  if (upstream.status === 200 && /^image\/(jpeg|png)$/.test(upstreamType)) {
    // One-time evidence view (H02/W07): bytes pass through untouched, never cached, shown inline, never re-interpreted.
    return new Response(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        'content-type': upstreamType,
        'cache-control': 'no-store, max-age=0',
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  }
  const text = await upstream.text();
  const key = `${method} ${route.path}`;
  if (SESSION_ISSUING.has(key) && upstream.status === 201) {
    const issued = JSON.parse(text) as { sessionId: string; sessionToken: string; absoluteExpiresAt: string };
    return json(
      201,
      { sessionId: issued.sessionId, absoluteExpiresAt: issued.absoluteExpiresAt },
      { 'set-cookie': sessionCookie(issued.sessionToken, issued.absoluteExpiresAt) },
    );
  }
  const extra: Record<string, string> = {};
  if (key === 'DELETE /v1/admin/auth/sessions/current' || upstream.status === 401) {
    // A dead session (revoked/offboarded/expired) clears the cookie; a LOCKED one keeps it for the unlock ceremony.
    const locked = text.includes('WAYVRO_E_STAFF_SESSION_LOCKED');
    if (!locked) extra['set-cookie'] = CLEAR_COOKIE;
  }
  return new Response(upstream.status === 204 ? null : text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store', ...extra },
  });
}
