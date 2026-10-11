import { ErrorEnvelopeSchema, type ErrorCode } from '@wayvro/contracts';

/**
 * The small set of error kinds the UI understands (CLAUDE.md §13). Raw server messages, provider text and stack traces
 * never reach the UI: an ApiError carries only a kind, the stable error code and retry hints, and its `message` is a
 * fixed token that is safe to log.
 *
 * @internal the list is exported for exhaustiveness tests; code uses the UiErrorKind type.
 */
export const UI_ERROR_KINDS = [
  'offline',
  'rate-limited',
  'session-expired',
  'validation',
  'conflict',
  'step-up-required',
  /** The server requires an account action first (policies, age declaration): the account state is re-fetched. */
  'required-action',
  /** A restriction refuses the action (reason codes in `detail.reasonCodes`; localised from the account state). */
  'restricted',
  /** The feature is switched off server-side (release gate); nothing to retry. */
  'feature-disabled',
  'unavailable',
  'unknown',
] as const;
export type UiErrorKind = (typeof UI_ERROR_KINDS)[number];

export interface ApiErrorDetail {
  /** Stable server error code when the server answered with a valid error envelope. */
  readonly code: ErrorCode | null;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  readonly requestId: string | null;
  /** Reason codes of the restriction(s) behind a WAYVRO_E_ACCOUNT_RESTRICTED refusal (never shown raw as an error message). */
  readonly reasonCodes: readonly string[];
  /**
   * true when the outcome is UNKNOWN (no response, timeout, 5xx): the request may or may not have taken effect, so a
   * retry must reuse the same idempotency key. false when the server answered definitively.
   */
  readonly transient: boolean;
}

export class ApiError extends Error {
  readonly kind: UiErrorKind;
  readonly detail: ApiErrorDetail;

  constructor(kind: UiErrorKind, detail: Partial<ApiErrorDetail> = {}) {
    super(`wayvro-api-error:${kind}`);
    this.name = 'ApiError';
    this.kind = kind;
    this.detail = {
      code: detail.code ?? null,
      status: detail.status ?? null,
      retryAfterSeconds: detail.retryAfterSeconds ?? null,
      requestId: detail.requestId ?? null,
      reasonCodes: detail.reasonCodes ?? [],
      transient: detail.transient ?? false,
    };
  }

  get code(): ErrorCode | null {
    return this.detail.code;
  }
}

/** Codes the consumer app handles specifically; any other (additive or staff-only) code falls back to the HTTP status. */
const KIND_BY_CODE: Readonly<Partial<Record<ErrorCode, UiErrorKind>>> = {
  WAYVRO_E_INTERNAL: 'unavailable',
  WAYVRO_E_VALIDATION: 'validation',
  WAYVRO_E_NOT_FOUND: 'conflict',
  WAYVRO_E_DEPENDENCY_UNAVAILABLE: 'unavailable',
  WAYVRO_E_IDEMPOTENCY_KEY_REQUIRED: 'unknown',
  WAYVRO_E_IDEMPOTENCY_KEY_INVALID: 'unknown',
  WAYVRO_E_UNAUTHENTICATED: 'session-expired',
  WAYVRO_E_FORBIDDEN: 'unknown',
  WAYVRO_E_RATE_LIMITED: 'rate-limited',
  WAYVRO_E_IDEMPOTENCY_CONFLICT: 'conflict',
  WAYVRO_E_OTP_INVALID_OR_EXPIRED: 'validation',
  WAYVRO_E_OTP_LOCKED: 'validation',
  WAYVRO_E_STEP_UP_REQUIRED: 'step-up-required',
  WAYVRO_E_PAYLOAD_TOO_LARGE: 'unknown',
  WAYVRO_E_UNSUPPORTED_MEDIA_TYPE: 'unknown',
  WAYVRO_E_CONFLICT: 'conflict',
  WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED: 'required-action',
  WAYVRO_E_AGE_DECLARATION_REQUIRED: 'required-action',
  WAYVRO_E_ACCOUNT_RESTRICTED: 'restricted',
  WAYVRO_E_FEATURE_DISABLED: 'feature-disabled',
  // P2.9: the session is restricted to the dormant-number review; the account state is re-fetched and the gate opens it.
  WAYVRO_E_RECOVERY_REQUIRED: 'required-action',
  // P2.10: generic OIDC outcomes (a 401 here is not an expired session; the app offers the phone instead)
  WAYVRO_E_OIDC_NOT_LINKED: 'validation',
  WAYVRO_E_OIDC_LINK_CONFLICT: 'conflict',
};

function kindForStatus(status: number): UiErrorKind {
  if (status === 401) return 'session-expired';
  if (status === 403) return 'unknown';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate-limited';
  if (status === 400 || status === 422) return 'validation';
  if (status >= 500) return 'unavailable';
  return 'unknown';
}

/** Maps a non-2xx HTTP response (status + parsed JSON body, if any) to an ApiError. */
export function errorFromResponse(status: number, body: unknown): ApiError {
  const parsed = ErrorEnvelopeSchema.safeParse(body);
  const transient = status >= 500;
  if (!parsed.success) return new ApiError(kindForStatus(status), { status, transient });
  const { code, requestId, details } = parsed.data.error;
  return new ApiError(KIND_BY_CODE[code] ?? kindForStatus(status), {
    code,
    status,
    requestId,
    retryAfterSeconds: details?.retryAfterSeconds ?? null,
    reasonCodes: details?.reasonCodes ?? [],
    transient,
  });
}

/** Normalises anything thrown by the API layer; unexpected errors become `unknown` (never their raw message). */
export function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError('unknown');
}
