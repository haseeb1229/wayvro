/**
 * Standard error shape (CLAUDE.md §13). `WayvroError` carries a stable contract code, an HTTP status and a
 * user-safe message; internal causes are logged (redacted) but never serialised to clients.
 */
import type { ErrorCode, ErrorEnvelope } from '@wayvro/contracts';

const DEFAULTS: Readonly<Record<ErrorCode, { status: number; message: string }>> = {
  WAYVRO_E_INTERNAL: { status: 500, message: 'Something went wrong. Please try again.' },
  WAYVRO_E_VALIDATION: { status: 400, message: 'The request is invalid.' },
  WAYVRO_E_NOT_FOUND: { status: 404, message: 'The requested resource was not found.' },
  WAYVRO_E_DEPENDENCY_UNAVAILABLE: { status: 503, message: 'The service is temporarily unavailable.' },
  WAYVRO_E_IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'An Idempotency-Key header is required for this request.' },
  WAYVRO_E_IDEMPOTENCY_KEY_INVALID: { status: 400, message: 'The Idempotency-Key header is malformed.' },
  WAYVRO_E_UNAUTHENTICATED: { status: 401, message: 'Authentication is required.' },
};

export class WayvroError extends Error {
  override readonly name = 'WayvroError';
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    options: { message?: string; cause?: unknown } = {},
  ) {
    super(options.message ?? DEFAULTS[code].message, { cause: options.cause });
    this.status = DEFAULTS[code].status;
  }
}

/** Maps any thrown value to the wire envelope. Unknown errors become WAYVRO_E_INTERNAL with a generic message. */
export function toErrorEnvelope(error: unknown, requestId: string): { status: number; body: ErrorEnvelope } {
  const e = error instanceof WayvroError ? error : new WayvroError('WAYVRO_E_INTERNAL', { cause: error });
  return { status: e.status, body: { error: { code: e.code, message: e.message, requestId } } };
}
