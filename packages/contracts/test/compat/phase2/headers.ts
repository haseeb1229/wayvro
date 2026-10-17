// FROZEN Phase-2 consumer contract baseline: main @ b1a1986, packages/contracts/src/headers.ts (COMPAT-N1,
// docs/phase3/PHASE3_TEST_STRATEGY.md §4.10). TEST-ONLY: outside src/, so never built, exported or imported by production
// code. Copied verbatim and never edited except to fix import paths: it is what a Phase-2 client parses responses with.
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
