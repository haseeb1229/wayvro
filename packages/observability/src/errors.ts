/**
 * Standard error shape (CLAUDE.md §13). `WayvroError` carries a stable contract code, an HTTP status and a
 * user-safe message; internal causes are logged (redacted) but never serialised to clients.
 */
import type { ErrorCode, ErrorDetails, ErrorEnvelope } from '@wayvro/contracts';

const DEFAULTS: Readonly<Record<ErrorCode, { status: number; message: string }>> = {
  WAYVRO_E_INTERNAL: { status: 500, message: 'Something went wrong. Please try again.' },
  WAYVRO_E_VALIDATION: { status: 400, message: 'The request is invalid.' },
  WAYVRO_E_NOT_FOUND: { status: 404, message: 'The requested resource was not found.' },
  WAYVRO_E_DEPENDENCY_UNAVAILABLE: { status: 503, message: 'The service is temporarily unavailable.' },
  WAYVRO_E_IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'An Idempotency-Key header is required for this request.' },
  WAYVRO_E_IDEMPOTENCY_KEY_INVALID: { status: 400, message: 'The Idempotency-Key header is malformed.' },
  WAYVRO_E_UNAUTHENTICATED: { status: 401, message: 'Authentication is required.' },
  WAYVRO_E_FORBIDDEN: { status: 403, message: 'This action is not allowed.' },
  WAYVRO_E_RATE_LIMITED: { status: 429, message: 'Too many requests. Please wait and try again.' },
  WAYVRO_E_IDEMPOTENCY_CONFLICT: { status: 409, message: 'This Idempotency-Key was already used for a different request.' },
  WAYVRO_E_OTP_INVALID_OR_EXPIRED: { status: 401, message: 'The code is invalid or has expired.' },
  WAYVRO_E_OTP_LOCKED: { status: 401, message: 'Too many incorrect attempts. Please request a new code.' },
  WAYVRO_E_STEP_UP_REQUIRED: { status: 403, message: 'Please verify your phone number again to continue.' },
  WAYVRO_E_PAYLOAD_TOO_LARGE: { status: 413, message: 'The request body is too large.' },
  WAYVRO_E_UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'The request content type is not supported.' },
  WAYVRO_E_STAFF_SESSION_LOCKED: { status: 401, message: 'Your session is locked after inactivity. Confirm with your security key to continue.' },
  WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED: { status: 403, message: 'Please review and accept the current policies to continue.' },
  WAYVRO_E_AGE_DECLARATION_REQUIRED: { status: 403, message: 'Please complete the age declaration to continue.' },
  WAYVRO_E_ACCOUNT_RESTRICTED: { status: 403, message: 'Your account is restricted. See the account notice for details and how to appeal.' },
  WAYVRO_E_FEATURE_DISABLED: { status: 404, message: 'This feature is not available.' },
  WAYVRO_E_CONFLICT: { status: 409, message: 'This request conflicts with the current state. Please refresh and try again.' },
  WAYVRO_E_GONE: { status: 410, message: 'This link was already used or has expired.' },
};

export class WayvroError extends Error {
  override readonly name = 'WayvroError';
  readonly status: number;
  readonly details: ErrorDetails | undefined;
  constructor(
    readonly code: ErrorCode,
    options: { message?: string; cause?: unknown; details?: ErrorDetails } = {},
  ) {
    super(options.message ?? DEFAULTS[code].message, { cause: options.cause });
    this.status = DEFAULTS[code].status;
    this.details = options.details;
  }
}

/** Maps any thrown value to the wire envelope. Unknown errors become WAYVRO_E_INTERNAL with a generic message. */
export function toErrorEnvelope(error: unknown, requestId: string): { status: number; body: ErrorEnvelope } {
  const e = error instanceof WayvroError ? error : new WayvroError('WAYVRO_E_INTERNAL', { cause: error });
  return { status: e.status, body: { error: { code: e.code, message: e.message, requestId, ...(e.details ? { details: e.details } : {}) } } };
}
