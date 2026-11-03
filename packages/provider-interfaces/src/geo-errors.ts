/**
 * Typed geo adapter failures (Phase 3 P3.2; docs/phase3/PHASE3_ARCHITECTURE.md §5.2 step 7, §5.4). Adapters THROW on
 * infrastructure failure; this class lets them say which kind of failure it was so the gateway can apply the right
 * policy without parsing vendor messages:
 *
 *   CONNECT         no connection was established (the only kind the gateway may retry, once, inside the deadline)
 *   TIMEOUT         the adapter's own timeout fired (the gateway's deadline abort is classified by the gateway itself)
 *   UPSTREAM        the provider answered 5xx or the transport failed after connecting
 *   QUOTA           the provider refused for quota/rate reasons (429-equivalent): the SKU cools down, the breaker is
 *                   not tripped by quota alone (FAULT-GEO FG-05)
 *   MALFORMED       the response failed the adapter's schema validation (counted as a provider failure)
 *   REJECTED_INPUT  the provider rejected our already validated request (4xx): not a health signal, logged as
 *                   GEO_ADAPTER_CONTRACT_ERROR for investigation
 *   AUTH            the provider refused the credential or the account/project configuration (invalid, restricted or
 *                   suspended key, API or billing disabled): counted as a provider failure, never retried, needs an
 *                   operator (added 2026-10-17 for the candidate adapters; additive)
 *   NO_RESULT       a healthy provider answer that has no result for a call that must return one (a place id from the
 *                   provider's own autocomplete no longer resolves; no drivable route between the points): NOT a
 *                   provider failure, never retried, nothing cached (added 2026-10-17; additive). Calls whose port
 *                   contract allows "no result" return `[]` / `null` instead of throwing this.
 *
 * The message must be a fixed, provider-neutral text: never the request URL, query text, coordinates or the
 * provider's own error body (they may echo the query or carry keys — threat model T3-20/T3-28).
 */
export type GeoProviderFailure = 'CONNECT' | 'TIMEOUT' | 'UPSTREAM' | 'QUOTA' | 'MALFORMED' | 'REJECTED_INPUT' | 'AUTH' | 'NO_RESULT';

export class GeoProviderError extends Error {
  /** `string` so adapter subclasses may name themselves; `instanceof GeoProviderError` is the classification test. */
  override readonly name: string = 'GeoProviderError';
  constructor(
    readonly kind: GeoProviderFailure,
    /** Provider-advised wait before retrying (QUOTA), in seconds. Consumers bound it before use. */
    readonly retryAfterSeconds?: number,
    options?: ErrorOptions,
  ) {
    super(`geo provider failure: ${kind}`, options);
  }
}
