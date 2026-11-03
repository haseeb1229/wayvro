/**
 * Typed adapter failure (geo-ports contract: infrastructure failure THROWS; "no result" is an empty array or null).
 *
 * TRANSLATION BOUNDARY (2026-10-17). `GeoAdapterError` IS a canonical `GeoProviderError` from
 * `@wayvro/provider-interfaces`: its detailed adapter `code` is translated, once, at construction, by the total table
 * `toGeoProviderFailure` below into the canonical `kind` the API gateway classifies on (`classifyFailure` reads only
 * `GeoProviderError.kind` / `retryAfterSeconds`). Every adapter failure therefore reaches the gateway as a canonical
 * error without a wrapper that a new adapter method could forget. The detailed `code`, `httpStatus` and
 * `countsAsProviderFailure` stay for tests and the dev-only SP-04 harness (benchmark error accounting); they are NOT
 * the gateway's breaker policy — the gateway owns that from `kind` (provider-call.ts).
 *
 * The message is built ONLY from Wayvro-side facts (opaque provider key, SKU, code, HTTP status). Provider error
 * bodies, request URLs (some carry the key as a query parameter), header values and the user's query are never
 * included: provider bodies may echo the request (threat model T3-20/T3-21).
 */
import { GeoProviderError, type GeoProviderFailure, type GeoSku } from '@wayvro/provider-interfaces';
import { boundRetryAfterSeconds } from './retry-after.js';

export type GeoAdapterErrorCode =
  /** The caller's AbortSignal fired with a TimeoutError. */
  | 'TIMEOUT'
  /** The caller's AbortSignal fired for another reason (request cancelled). */
  | 'ABORTED'
  /** Connect/DNS/TLS/reset before an HTTP status was received. */
  | 'NETWORK'
  /** 401/403 (or a documented provider reason): key/token missing, invalid, restricted, API/billing disabled, account suspended. */
  | 'AUTH'
  /** 429 or a provider-declared quota/rate status. */
  | 'QUOTA'
  /** Another 4xx: Wayvro sent a request the provider rejected (contract error, investigated, not a breaker failure). */
  | 'CLIENT_ERROR'
  /** 5xx or a provider-declared transient server status. */
  | 'SERVER_ERROR'
  /** A provider status that is neither success, empty, quota nor a documented client error. */
  | 'PROVIDER_STATUS'
  /** The payload failed schema validation (shape, types, bounds, coordinates outside the service region). */
  | 'MALFORMED_RESPONSE'
  /** The payload exceeded the adapter's byte cap. */
  | 'OVERSIZED_RESPONSE'
  /** The provider found no drivable route between the points. */
  | 'NO_ROUTE'
  /** A route lacked a positive distance or a duration: never defaulted. */
  | 'INCOMPLETE_ROUTE'
  /** A place id obtained from this provider's own autocomplete no longer resolves. */
  | 'NOT_FOUND'
  /** The adapter refused a request before calling the provider (invalid id or input). */
  | 'INVALID_INPUT';

/**
 * Adapter code → canonical failure kind (NETWORK is resolved by `toGeoProviderFailure` from the HTTP status).
 * A `Record` over every code: adding a code without a canonical mapping does not compile.
 */
const CANONICAL: Readonly<Record<Exclude<GeoAdapterErrorCode, 'NETWORK'>, GeoProviderFailure>> = {
  // ABORTED only happens when the caller's signal fires; the gateway's own deadline abort is classified TIMEOUT by the
  // gateway first (abortedByUs), and an AbortError has always been TIMEOUT there — the same reading here.
  TIMEOUT: 'TIMEOUT',
  ABORTED: 'TIMEOUT',
  AUTH: 'AUTH',
  QUOTA: 'QUOTA',
  CLIENT_ERROR: 'REJECTED_INPUT',
  INVALID_INPUT: 'REJECTED_INPUT',
  SERVER_ERROR: 'UPSTREAM',
  PROVIDER_STATUS: 'UPSTREAM',
  MALFORMED_RESPONSE: 'MALFORMED',
  OVERSIZED_RESPONSE: 'MALFORMED',
  INCOMPLETE_ROUTE: 'MALFORMED',
  NO_ROUTE: 'NO_RESULT',
  NOT_FOUND: 'NO_RESULT',
};

/**
 * THE translation from adapter codes to the canonical provider-interface taxonomy. NETWORK before any HTTP status is
 * CONNECT (the gateway's single bounded retry); after a status (body read failed) it is UPSTREAM (never retried).
 * @internal exported for unit tests
 */
export function toGeoProviderFailure(code: GeoAdapterErrorCode, httpStatus: number | null): GeoProviderFailure {
  if (code === 'NETWORK') return httpStatus === null ? 'CONNECT' : 'UPSTREAM';
  return CANONICAL[code];
}

/** Codes that must NOT count as provider failures for SP-04 benchmark accounting: caused by Wayvro input or cancellation. */
const NON_BREAKER_CODES: ReadonlySet<GeoAdapterErrorCode> = new Set(['CLIENT_ERROR', 'INVALID_INPUT', 'NOT_FOUND', 'NO_ROUTE', 'ABORTED']);

export class GeoAdapterError extends GeoProviderError {
  override readonly name: string = 'GeoAdapterError';
  readonly providerKey: string;
  readonly sku: GeoSku;
  readonly code: GeoAdapterErrorCode;
  readonly httpStatus: number | null;

  constructor(
    providerKey: string,
    sku: GeoSku,
    code: GeoAdapterErrorCode,
    httpStatus: number | null = null,
    /** `retryAfterSeconds`: provider-advised wait, kept only on QUOTA and bounded (see retry-after.ts). */
    options: { readonly cause?: unknown; readonly retryAfterSeconds?: number } = {},
  ) {
    const kind = toGeoProviderFailure(code, httpStatus);
    const retryAfter = kind === 'QUOTA' && options.retryAfterSeconds !== undefined ? boundRetryAfterSeconds(options.retryAfterSeconds) : undefined;
    super(kind, retryAfter, 'cause' in options ? { cause: options.cause } : undefined);
    this.message = `geo adapter ${providerKey} ${sku}: ${code}${httpStatus === null ? '' : ` (HTTP ${httpStatus})`}`;
    this.providerKey = providerKey;
    this.sku = sku;
    this.code = code;
    this.httpStatus = httpStatus;
  }

  /**
   * Whether the failure is provider-side for the SP-04 harness's error accounting (timeouts, 5xx, 429, network and
   * schema failures are). The gateway does not read this: its breaker policy comes from the canonical `kind`.
   */
  get countsAsProviderFailure(): boolean {
    return !NON_BREAKER_CODES.has(this.code);
  }
}

/** Thrown by configuration loaders. Never contains the value of a secret. */
export class GeoAdapterConfigError extends Error {
  override readonly name = 'GeoAdapterConfigError';
}
