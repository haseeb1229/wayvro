import { z } from 'zod';

/**
 * Stable, client-visible error codes (CLAUDE.md §13). Codes are never renamed or removed while a supported client may
 * receive them; new codes are additive. Messages are user-safe; provider messages and stack traces never appear here.
 * Identity errors are deliberately generic (no account-existence, OTP-truth or database-state disclosure).
 */
export const ERROR_CODES = [
  'WAYVRO_E_INTERNAL',
  'WAYVRO_E_VALIDATION',
  'WAYVRO_E_NOT_FOUND',
  'WAYVRO_E_DEPENDENCY_UNAVAILABLE',
  'WAYVRO_E_IDEMPOTENCY_KEY_REQUIRED',
  'WAYVRO_E_IDEMPOTENCY_KEY_INVALID',
  'WAYVRO_E_UNAUTHENTICATED',
  // P2.1 (additive)
  'WAYVRO_E_FORBIDDEN',
  'WAYVRO_E_RATE_LIMITED',
  'WAYVRO_E_IDEMPOTENCY_CONFLICT',
  'WAYVRO_E_OTP_INVALID_OR_EXPIRED',
  'WAYVRO_E_OTP_LOCKED',
  'WAYVRO_E_STEP_UP_REQUIRED',
  'WAYVRO_E_PAYLOAD_TOO_LARGE',
  'WAYVRO_E_UNSUPPORTED_MEDIA_TYPE',
  // P2.2 (additive)
  'WAYVRO_E_CONFLICT',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Optional machine-readable hints (additive in P2.1). */
export const ErrorDetailsSchema = z.object({
  retryAfterSeconds: z.number().int().positive().optional(),
});
export type ErrorDetails = z.infer<typeof ErrorDetailsSchema>;

export const ErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string().min(1).max(500),
      requestId: z.string().min(1),
      details: ErrorDetailsSchema.optional(),
    }),
  })
  .meta({ id: 'ErrorEnvelope', description: 'Standard error body for every non-2xx API response.' });
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
