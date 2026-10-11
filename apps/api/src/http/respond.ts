/**
 * Shared controller plumbing: strict request parsing and idempotent-outcome rendering. Errors are always rendered by
 * the global filter with the CURRENT request id (a replayed error never leaks the original request's id).
 */
import { IDEMPOTENCY_KEY_HEADER } from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { IdempotentResult } from '../platform/idempotency.js';

/** Parses with the contract schema; any mismatch (unknown/server-owned fields, bad shapes) is 400 VALIDATION. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new WayvroError('WAYVRO_E_VALIDATION');
  return r.data;
}

/** The Idempotency-Key header (shape already enforced for every mutating /v1 route by the preHandler hook). */
export function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers[IDEMPOTENCY_KEY_HEADER];
  if (typeof key !== 'string') throw new WayvroError('WAYVRO_E_IDEMPOTENCY_KEY_REQUIRED');
  return key;
}

/** Applies an idempotent outcome to the reply: success status/body, or the replayable error through the filter. */
export function render<T>(reply: FastifyReply, result: IdempotentResult, schema?: z.ZodType<T>): T | undefined {
  if (result.replayed) void reply.header('idempotent-replayed', 'true');
  const { outcome } = result;
  if (outcome.kind === 'error') throw new WayvroError(outcome.code, outcome.details ? { details: outcome.details } : {});
  void reply.status(outcome.status);
  return schema ? schema.parse(outcome.body) : undefined;
}
