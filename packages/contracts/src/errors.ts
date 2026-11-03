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
  // P2.4 (additive)
  'WAYVRO_E_STAFF_SESSION_LOCKED',
  // P2.5 (additive)
  'WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED',
  'WAYVRO_E_AGE_DECLARATION_REQUIRED',
  'WAYVRO_E_ACCOUNT_RESTRICTED',
  'WAYVRO_E_FEATURE_DISABLED',
  // P2.6 (additive): a one-time resource (evidence view token) that was already used or has expired
  'WAYVRO_E_GONE',
  // P2.9 (additive): the session must complete the dormant-number review (or recovery) before anything else
  'WAYVRO_E_RECOVERY_REQUIRED',
  // P2.10 (additive): generic OIDC outcomes (never reveal which account an identity belongs to)
  'WAYVRO_E_OIDC_NOT_LINKED',
  'WAYVRO_E_OIDC_LINK_CONFLICT',
  // Phase 3 (additive): no product can be quoted for this pickup/drop-off/time (details.reasonCodes say why: ZONE_NOT_SERVED,
  // PICKUP_RESTRICTED, OUTSIDE_SERVICE_HOURS, ROUTE_TOO_LONG, NO_ACTIVE_RATE_CARD)
  'WAYVRO_E_SERVICE_AREA',
  // Phase 3 (additive): the calling app build is below the supported minimum or in a blocked range (HTTP 426)
  'WAYVRO_E_APP_UPDATE_REQUIRED',
  // Phase 3 (additive): planned maintenance; staff routes stay available (HTTP 503)
  'WAYVRO_E_MAINTENANCE',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Optional machine-readable hints (additive in P2.1). */
export const ErrorDetailsSchema = z.object({
  retryAfterSeconds: z.number().int().positive().optional(),
  /** P2.5: actions the client must complete first (ACCEPT_POLICIES, AGE_DECLARATION, ...). */
  requiredActions: z.array(z.string()).optional(),
  /** P2.5: reason codes of the restriction(s) that caused the refusal (localised by the client). */
  reasonCodes: z.array(z.string()).optional(),
  /** Phase 3 (additive): with SERVICE_AREA / OUTSIDE_SERVICE_HOURS — the next opening instant on server time. */
  nextOpenAt: z.iso.datetime({ offset: true }).optional(),
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
