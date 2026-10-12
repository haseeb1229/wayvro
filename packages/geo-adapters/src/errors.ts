/**
 * Typed adapter failure (geo-ports contract: infrastructure failure THROWS; "no result" is an empty array or null).
 *
 * The message is built ONLY from Wayvro-side facts (opaque provider key, SKU, code, HTTP status). Provider error
 * bodies, request URLs (some carry the key as a query parameter) and the user's query are never included: provider
 * bodies may echo the request (threat model T3-20/T3-21).
 */
import type { GeoSku } from '@wayvro/provider-interfaces';

export type GeoAdapterErrorCode =
  /** The caller's AbortSignal fired with a TimeoutError. */
  | 'TIMEOUT'
  /** The caller's AbortSignal fired for another reason (request cancelled). */
  | 'ABORTED'
  /** Connect/DNS/TLS/reset before an HTTP status was received. */
  | 'NETWORK'
  /** 401/403: key/token missing, invalid, restricted or the account is suspended. */
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

/** Codes that must NOT count as provider failures for the circuit breaker (architecture §5.4): caused by Wayvro input. */
const NON_BREAKER_CODES: ReadonlySet<GeoAdapterErrorCode> = new Set(['CLIENT_ERROR', 'INVALID_INPUT', 'NOT_FOUND', 'NO_ROUTE', 'ABORTED']);

export class GeoAdapterError extends Error {
  override readonly name = 'GeoAdapterError';
  readonly providerKey: string;
  readonly sku: GeoSku;
  readonly code: GeoAdapterErrorCode;
  readonly httpStatus: number | null;

  constructor(providerKey: string, sku: GeoSku, code: GeoAdapterErrorCode, httpStatus: number | null = null, options?: { cause?: unknown }) {
    super(`geo adapter ${providerKey} ${sku}: ${code}${httpStatus === null ? '' : ` (HTTP ${httpStatus})`}`, options);
    this.providerKey = providerKey;
    this.sku = sku;
    this.code = code;
    this.httpStatus = httpStatus;
  }

  /** Whether the gateway's circuit breaker counts this failure (timeouts, 5xx, 429, network and schema failures do). */
  get countsAsProviderFailure(): boolean {
    return !NON_BREAKER_CODES.has(this.code);
  }
}

/** Thrown by configuration loaders. Never contains the value of a secret. */
export class GeoAdapterConfigError extends Error {
  override readonly name = 'GeoAdapterConfigError';
}
