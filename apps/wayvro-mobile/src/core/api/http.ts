import { IDEMPOTENCY_KEY_HEADER, REQUEST_ID_HEADER } from '@wayvro/contracts';
import type { ZodType } from 'zod';
import { ApiError, errorFromResponse } from './errors';
import { backoffDelayMs, MAX_RETRY_AFTER_SECONDS } from './retry';

/**
 * Low-level HTTP transport for the Wayvro API (P2.3): request ids, bearer token, idempotency key, timeout via
 * AbortController, bounded jittered retries ONLY where a retry cannot duplicate an effect, response validation against
 * the contract schema and error mapping. Nothing here logs request or response bodies.
 */

export interface ServerClock {
  /** Device-clock offset to the server's `Date` header (ms); UX countdowns only — the server enforces every deadline. */
  offsetMs: number;
}

export interface HttpDeps {
  readonly baseUrl: string;
  readonly fetchFn: typeof fetch;
  readonly newRequestId: () => string;
  readonly clock: ServerClock;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestSpec<T> {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly accessToken?: string;
  /** Contract schema of the success body; `null` for 204 responses. */
  readonly schema: ZodType<T> | null;
  /**
   * `idempotent`: up to MAX_ATTEMPTS for unknown outcomes (network error/timeout) and for 503 with a short Retry-After.
   * Allowed only for requests that carry an idempotency key (mutations) or are safe reads.
   */
  readonly retry?: 'none' | 'idempotent';
}

export interface HttpResult<T> {
  readonly status: number;
  readonly data: T;
  readonly replayed: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function buildUrl(baseUrl: string, path: string, query?: Readonly<Record<string, string>>): string {
  const entries = query ? Object.entries(query) : [];
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `${baseUrl}${path}${qs === '' ? '' : `?${qs}`}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A non-JSON body (proxy page, truncated response) is never shown; the status decides the error kind.
    return undefined;
  }
}

function recordServerTime(deps: HttpDeps, response: Response): void {
  const header = response.headers.get('date');
  const serverMs = header === null ? Number.NaN : Date.parse(header);
  if (!Number.isNaN(serverMs)) deps.clock.offsetMs = serverMs - (deps.now ?? Date.now)();
}

async function attempt<T>(deps: HttpDeps, spec: RequestSpec<T>, requestId: string): Promise<HttpResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json', [REQUEST_ID_HEADER]: requestId };
  if (spec.body !== undefined) headers['content-type'] = 'application/json';
  if (spec.idempotencyKey !== undefined) headers[IDEMPOTENCY_KEY_HEADER] = spec.idempotencyKey;
  if (spec.accessToken !== undefined) headers['authorization'] = `Bearer ${spec.accessToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await deps.fetchFn(buildUrl(deps.baseUrl, spec.path, spec.query), {
      method: spec.method,
      headers,
      ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
      signal: controller.signal,
    });
  } catch {
    // Network failure or timeout: the request may or may not have reached the server (unknown outcome).
    throw new ApiError('offline', { transient: true });
  } finally {
    clearTimeout(timer);
  }

  recordServerTime(deps, response);
  const body = await readJson(response);
  if (!response.ok) throw errorFromResponse(response.status, body);

  const replayed = response.headers.get('idempotent-replayed') === 'true';
  if (spec.schema === null) return { status: response.status, data: undefined as T, replayed };
  const parsed = spec.schema.safeParse(body);
  // A 2xx body that violates the contract is never trusted or partially used.
  if (!parsed.success) throw new ApiError('unknown', { status: response.status, requestId });
  return { status: response.status, data: parsed.data, replayed };
}

function retryable(error: ApiError): boolean {
  if (error.kind === 'offline') return true;
  // 503 is retried only when the server says when (bounded); other 5xx surface to the user/query layer.
  return error.detail.status === 503 && error.detail.retryAfterSeconds !== null && error.detail.retryAfterSeconds <= MAX_RETRY_AFTER_SECONDS;
}

/** Sends one logical request (one request id across its attempts). Throws ApiError. */
export async function send<T>(deps: HttpDeps, spec: RequestSpec<T>): Promise<HttpResult<T>> {
  const mutating = spec.method !== 'GET';
  if (spec.retry === 'idempotent' && mutating && spec.idempotencyKey === undefined) {
    throw new Error('http: a retried mutation needs an idempotency key');
  }
  const maxAttempts = spec.retry === 'idempotent' ? MAX_ATTEMPTS : 1;
  const requestId = deps.newRequestId();
  for (let n = 1; ; n += 1) {
    try {
      return await attempt(deps, spec, requestId);
    } catch (error) {
      if (!(error instanceof ApiError) || n >= maxAttempts || !retryable(error)) throw error;
      await (deps.sleep ?? defaultSleep)(backoffDelayMs(n, error.detail.retryAfterSeconds, deps.random ?? Math.random));
    }
  }
}
