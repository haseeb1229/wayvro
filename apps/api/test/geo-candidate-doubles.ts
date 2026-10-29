/**
 * Candidate-adapter failure double for the gateway tests (fix 2026-10-17). No infrastructure import: usable from unit
 * and integration suites alike.
 */
import { GeoProviderError, type GeoProviderFailure } from '@wayvro/provider-interfaces';

/** Text a candidate adapter error carries in its message; it must never reach a log line or a response. */
export const CANDIDATE_MESSAGE_SENTINEL = 'CANDIDATE-MESSAGE-SENTINEL key=synthetic-key q=synthetic query';

/**
 * Shape of a CANDIDATE adapter failure (`GeoAdapterError` in the server-only @wayvro/geo-adapters, which this app does
 * not depend on): a GeoProviderError subclass with its own name, an adapter-specific code/status and a message the
 * gateway must never read. Test double only (fix 2026-10-17).
 */
export class CandidateAdapterError extends GeoProviderError {
  override readonly name: string = 'GeoAdapterError';
  constructor(
    kind: GeoProviderFailure,
    readonly code: string,
    readonly httpStatus: number | null,
    retryAfterSeconds?: number,
  ) {
    super(kind, retryAfterSeconds);
    this.message = `geo adapter geo-c: ${code} ${CANDIDATE_MESSAGE_SENTINEL}`;
  }
}
