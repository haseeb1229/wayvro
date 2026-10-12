/**
 * Minimal bounded JSON-over-HTTP client shared by every adapter (Node 24 global `fetch`; no new dependency).
 *
 *  - the caller's AbortSignal is the only deadline (the gateway owns timeouts, architecture §5.4a);
 *  - redirects are refused (`redirect: 'error'`) so a key header or key query parameter never follows a redirect;
 *  - the body is read through a byte cap (threat model T3-21: oversized payload ⇒ typed error, never truncated JSON);
 *  - HTTP status classes map to typed errors; the provider body is drained but never copied into an error;
 *  - no error carries the request URL or an underlying `cause` (URLs may carry keys; causes may echo the URL).
 */
import type { GeoSku } from '@wayvro/provider-interfaces';
import { assertProviderKey } from './config.js';
import { GeoAdapterConfigError, GeoAdapterError, type GeoAdapterErrorCode } from './errors.js';

/** Injectable fetch (tests pass a fake; the SP-04 harness passes a recording wrapper). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Default response cap: 1 MiB (threat model T3-21). */
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

export interface CallContext {
  readonly providerKey: string;
  readonly sku: GeoSku;
  readonly fetchImpl: FetchLike;
  readonly maxResponseBytes: number;
}

/** Options every adapter accepts (the key/URL configuration is adapter-specific). */
export interface AdapterOptions {
  /** Opaque provider key (e.g. `geo-a`); see `assertProviderKey`. */
  readonly providerKey: string;
  readonly fetchImpl?: FetchLike;
  readonly maxResponseBytes?: number;
}

/** Builds the per-SKU call context; validates the opaque provider key and the byte cap. */
export function callContext(options: AdapterOptions, sku: GeoSku): CallContext {
  const max = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isInteger(max) || max < 1024 || max > 8 * 1024 * 1024)
    throw new GeoAdapterConfigError('maxResponseBytes must be an integer between 1 KiB and 8 MiB');
  return { providerKey: assertProviderKey(options.providerKey), sku, fetchImpl: options.fetchImpl ?? ((url, init) => fetch(url, init)), maxResponseBytes: max };
}

export interface JsonRequest {
  readonly method: 'GET' | 'POST';
  readonly url: URL;
  readonly headers?: Readonly<Record<string, string>>;
  /** Serialised as JSON for POST. */
  readonly body?: unknown;
}

export interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
}

function fail(ctx: CallContext, code: GeoAdapterErrorCode, status: number | null = null): GeoAdapterError {
  return new GeoAdapterError(ctx.providerKey, ctx.sku, code, status);
}

/** Maps a failure that happened before/while receiving bytes. */
function transportFailure(ctx: CallContext, signal: AbortSignal, status: number | null): GeoAdapterError {
  if (signal.aborted) {
    const reason: unknown = signal.reason;
    const timedOut = reason instanceof Error && reason.name === 'TimeoutError';
    return fail(ctx, timedOut ? 'TIMEOUT' : 'ABORTED', status);
  }
  return fail(ctx, 'NETWORK', status);
}

/**
 * HTTP status → error code for non-success statuses (adapters may first pass documented statuses through).
 * @internal exported for unit tests
 */
export function statusErrorCode(status: number): GeoAdapterErrorCode {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'QUOTA';
  if (status >= 500) return 'SERVER_ERROR';
  if (status >= 400) return 'CLIENT_ERROR';
  return 'PROVIDER_STATUS';
}

async function readCapped(ctx: CallContext, response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > ctx.maxResponseBytes) {
    throw fail(ctx, 'OVERSIZED_RESPONSE', response.status);
  }
  if (response.body === null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const read = async () => {
    try {
      return await reader.read();
    } catch {
      throw transportFailure(ctx, signal, response.status);
    }
  };
  for (;;) {
    const next = await read();
    if (next.done) break;
    const chunk: unknown = next.value;
    if (!(chunk instanceof Uint8Array)) throw fail(ctx, 'MALFORMED_RESPONSE', response.status);
    total += chunk.byteLength;
    if (total > ctx.maxResponseBytes) {
      const oversized = fail(ctx, 'OVERSIZED_RESPONSE', response.status);
      await reader.cancel().catch(() => {
        throw oversized;
      });
      throw oversized;
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Performs one request and returns the parsed JSON body for 2xx statuses and for `passThroughStatuses` (documented
 * provider statuses whose body carries a machine-readable code, e.g. OSRM `400 {code:"NoRoute"}`). Every other status
 * throws a typed error after draining the body.
 */
export async function callJson(
  ctx: CallContext,
  request: JsonRequest,
  signal: AbortSignal,
  passThroughStatuses: readonly number[] = [],
): Promise<JsonResponse> {
  if (signal.aborted) throw transportFailure(ctx, signal, null);
  const headers: Record<string, string> = { Accept: 'application/json', ...request.headers };
  const init: RequestInit = { method: request.method, headers, signal, redirect: 'error' };
  if (request.method === 'POST') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(request.body ?? {});
  }
  let response: Response;
  try {
    response = await ctx.fetchImpl(request.url.toString(), init);
  } catch {
    throw transportFailure(ctx, signal, null);
  }
  const accepted = (response.status >= 200 && response.status < 300) || passThroughStatuses.includes(response.status);
  const bytes = await readCapped(ctx, response, signal).catch((error: unknown) => {
    // A failure while draining an error body still reports the status-derived error (the more useful signal).
    if (!accepted) throw fail(ctx, statusErrorCode(response.status), response.status);
    throw error;
  });
  if (!accepted) throw fail(ctx, statusErrorCode(response.status), response.status);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw fail(ctx, 'MALFORMED_RESPONSE', response.status);
  }
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    throw fail(ctx, 'MALFORMED_RESPONSE', response.status);
  }
}
