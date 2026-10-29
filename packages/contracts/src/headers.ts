import { z } from 'zod';

/** Correlation id echoed on every response; accepted from callers only when it matches this shape. */
export const REQUEST_ID_HEADER = 'x-request-id';
export const RequestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/**
 * Every mutating `/v1` endpoint requires an `Idempotency-Key` (docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md §4).
 * Phase 1 defines and enforces the shape only; replay storage arrives with the first mutating endpoint.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * Phase 3 (A01/Q31; ADR-049): app-client compatibility headers. They are compatibility HINTS, never authorisation or
 * pricing inputs: the server uses them only to evaluate the app version policy (426 `WAYVRO_E_APP_UPDATE_REQUIRED`) and
 * to shape `GET /v1/app/config`. Requests without them (web surfaces, older builds) are allowed.
 */
export const APP_PLATFORM_HEADER = 'x-wayvro-platform';
export const APP_VERSION_HEADER = 'x-wayvro-app-version';
export const APP_BUILD_HEADER = 'x-wayvro-app-build';
export const AppPlatformSchema = z.enum(['ANDROID', 'IOS']);
export const AppVersionHeaderSchema = z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/);
/** Monotonic native build number of the installed binary (Android versionCode / iOS CFBundleVersion). */
export const AppBuildHeaderSchema = z.string().regex(/^[0-9]{1,9}$/);
