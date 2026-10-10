/**
 * Fastify-level hooks: request ids, idempotency-key shape enforcement and request logging. Registered on the raw
 * Fastify instance so they apply uniformly, independent of Nest controllers.
 */
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKeySchema, MUTATING_METHODS, REQUEST_ID_HEADER } from '@wayvro/contracts';
import { WayvroError, runWithContext, toErrorEnvelope, type Logger } from '@wayvro/observability';
import type { FastifyInstance } from 'fastify';

const MUTATING = new Set<string>(MUTATING_METHODS);

export function registerHttpHooks(fastify: FastifyInstance, log: Logger): void {
  // Correlation: the id is resolved in `genReqId` (see app.ts) and echoed on every response.
  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    // API responses (tokens, account state) must never be stored by intermediaries or clients' HTTP caches.
    void reply.header('cache-control', 'no-store');
    runWithContext({ requestId: request.id }, done);
  });

  /**
   * Idempotency-Key shape: every mutating /v1 route requires a well-formed key. `preHandler` runs only for matched
   * routes, so unknown paths still return 404. Persistent replay/deduplication is done per operation by the
   * IdempotencyStore inside the mutation's transaction (F-03).
   */
  fastify.addHook('preHandler', async (request, reply) => {
    if (!MUTATING.has(request.method) || !request.routeOptions.url?.startsWith('/v1/')) return;
    const key = request.headers[IDEMPOTENCY_KEY_HEADER];
    let failure: WayvroError | undefined;
    if (key === undefined) failure = new WayvroError('WAYVRO_E_IDEMPOTENCY_KEY_REQUIRED');
    else if (!IdempotencyKeySchema.safeParse(key).success) failure = new WayvroError('WAYVRO_E_IDEMPOTENCY_KEY_INVALID');
    if (failure) {
      const { status, body } = toErrorEnvelope(failure, request.id);
      await reply.status(status).send(body);
    }
  });

  // Structured access log without query strings, bodies or headers (they may contain PII).
  fastify.addHook('onResponse', (request, reply, done) => {
    log.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? 'unmatched',
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
    done();
  });
}
