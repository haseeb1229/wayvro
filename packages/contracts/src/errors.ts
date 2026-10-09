import { z } from 'zod';

/**
 * Stable, client-visible error codes (CLAUDE.md §13). Codes are never renamed or removed while a supported client may
 * receive them; new codes are additive. Messages are user-safe; provider messages and stack traces never appear here.
 */
export const ERROR_CODES = [
  'WAYVRO_E_INTERNAL',
  'WAYVRO_E_VALIDATION',
  'WAYVRO_E_NOT_FOUND',
  'WAYVRO_E_DEPENDENCY_UNAVAILABLE',
  'WAYVRO_E_IDEMPOTENCY_KEY_REQUIRED',
  'WAYVRO_E_IDEMPOTENCY_KEY_INVALID',
  'WAYVRO_E_UNAUTHENTICATED',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string().min(1).max(500),
      requestId: z.string().min(1),
    }),
  })
  .meta({ id: 'ErrorEnvelope', description: 'Standard error body for every non-2xx API response.' });
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
