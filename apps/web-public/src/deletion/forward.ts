/**
 * Server-side forwarding of the public web deletion path (U06) to the API's public routes. The browser talks only to
 * web-public (same origin); this module validates the request with the contract schema, forwards it with an
 * `Idempotency-Key`, and passes back only the status and the contract-validated JSON body. Anything the contract does
 * not declare (unknown status, invalid body, network failure, timeout) becomes a generic 503: the page never shows a
 * provider or server message and never claims a success it did not receive.
 *
 * Only the two operations below are forwarded; there is no generic proxy. Configuration is server-side only.
 */
import { ACCOUNT_SECURITY_ROUTES, type ErrorCode, type RouteContract } from '@wayvro/contracts';

export type PublicDeletionOperation = 'createWebDeletionOtp' | 'createWebDeletionRequest';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
/** Comma-separated IPv4/IPv6 addresses as written by a reverse proxy; anything else is not forwarded. */
const FORWARDED_FOR = /^[0-9A-Fa-f.:, ]{1,512}$/;
const MAX_BODY_BYTES = 4096;
const UPSTREAM_TIMEOUT_MS = 10_000;

function routeFor(operationId: PublicDeletionOperation): RouteContract {
  const route: RouteContract | undefined = ACCOUNT_SECURITY_ROUTES.find((r) => r.operationId === operationId);
  if (!route?.request) throw new Error(`contract route ${operationId} with a request schema is missing`);
  return route;
}
const ROUTES: Readonly<Record<PublicDeletionOperation, RouteContract>> = {
  createWebDeletionOtp: routeFor('createWebDeletionOtp'),
  createWebDeletionRequest: routeFor('createWebDeletionRequest'),
};

/** Internal API base URL (server-side only), same variable and default as the web-ops BFF. */
const apiBaseUrl = (): string => process.env['WAYVRO_API_INTERNAL_URL'] ?? 'http://127.0.0.1:4000';

/** fetch() network failures surface as TypeError, AbortSignal.timeout() as a TimeoutError DOMException. */
const isTransportFailure = (e: unknown): boolean => e instanceof TypeError || (e instanceof DOMException && e.name === 'TimeoutError');

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  WAYVRO_E_FORBIDDEN: 'This action is not allowed.',
  WAYVRO_E_UNSUPPORTED_MEDIA_TYPE: 'The request must be JSON.',
  WAYVRO_E_PAYLOAD_TOO_LARGE: 'The request is too large.',
  WAYVRO_E_VALIDATION: 'The request is not valid.',
  WAYVRO_E_DEPENDENCY_UNAVAILABLE: 'The service is temporarily unavailable.',
};

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
function refuse(status: number, code: ErrorCode): Response {
  return json(status, { error: { code, message: MESSAGES[code] ?? 'The request failed.', requestId: 'web-public' } });
}
const unavailable = (): Response => refuse(503, 'WAYVRO_E_DEPENDENCY_UNAVAILABLE');

/** Parses JSON text; text that is not JSON yields `undefined` (which every request/response schema refuses). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    if (e instanceof SyntaxError) return undefined;
    throw e;
  }
}

/** Reads at most MAX_BODY_BYTES; `null` when the body is larger. */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES ? null : text;
}

/** Handles one browser POST for `operationId`. */
export async function forwardPublicDeletion(request: Request, operationId: PublicDeletionOperation): Promise<Response> {
  const route = ROUTES[operationId];
  // Browser requests from another site are refused (the endpoint carries no credential; this stops other sites from
  // using visitors' browsers to request codes). JSON-only also forces a CORS preflight that is never answered.
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return refuse(403, 'WAYVRO_E_FORBIDDEN');
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return refuse(415, 'WAYVRO_E_UNSUPPORTED_MEDIA_TYPE');
  const text = await readBody(request);
  if (text === null) return refuse(413, 'WAYVRO_E_PAYLOAD_TOO_LARGE');
  const parsed = route.request?.safeParse(parseJson(text));
  if (!parsed?.success) return refuse(400, 'WAYVRO_E_VALIDATION');

  const key = request.headers.get('idempotency-key');
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    'idempotency-key': key !== null && IDEMPOTENCY_KEY.test(key) ? key : crypto.randomUUID(),
  };
  // The API decides whether to believe this (its TRUST_PROXY allowlist); it is only meaningful behind a trusted edge.
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor !== null && FORWARDED_FOR.test(forwardedFor)) headers['x-forwarded-for'] = forwardedFor;

  let status: number;
  let upstreamText: string;
  try {
    const upstream = await fetch(`${apiBaseUrl()}${route.path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    status = upstream.status;
    upstreamText = await upstream.text();
  } catch (e) {
    // Network failure or timeout: the request may or may not have reached the API; the visitor retries (new key).
    if (isTransportFailure(e)) return unavailable();
    throw e;
  }
  const schema = route.responses[status];
  if (!schema) return unavailable();
  const validated = schema.safeParse(parseJson(upstreamText));
  return validated.success ? json(status, validated.data) : unavailable();
}
