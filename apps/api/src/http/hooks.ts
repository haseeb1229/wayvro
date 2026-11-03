/**
 * Fastify-level hooks: request ids, release-control enforcement (app-version gate + maintenance), idempotency-key shape
 * enforcement and request logging. Registered on the raw Fastify instance so they apply uniformly, independent of Nest
 * controllers. Order: (1) request id + no-store, (2) release enforcement (onRequest: 426 / 503 before body parsing,
 * idempotency and authorisation; exempt routes always pass), (3) Idempotency-Key shape (preHandler), (4) access log.
 */
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKeySchema, MUTATING_METHODS, REQUEST_ID_HEADER } from '@wayvro/contracts';
import { WayvroError, runWithContext, toErrorEnvelope, type Logger } from '@wayvro/observability';
import type { FastifyInstance } from 'fastify';
import type { ReleaseEnforcement } from '../platform/release/enforcement.js';

const MUTATING = new Set<string>(MUTATING_METHODS);

export function registerHttpHooks(fastify: FastifyInstance, log: Logger, release: ReleaseEnforcement): void {
  // Correlation: the id is resolved in `genReqId` (see app.ts) and echoed on every response.
  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    // API responses (tokens, account state) must never be stored by intermediaries or clients' HTTP caches.
    void reply.header('cache-control', 'no-store');
    runWithContext({ requestId: request.id }, done);
  });

  // Release controls (ADR-049): 426 WAYVRO_E_APP_UPDATE_REQUIRED / 503 WAYVRO_E_MAINTENANCE for non-exempt routes.
  fastify.addHook('onRequest', async (request, reply) => {
    const refusal = await release.refusal(request);
    if (!refusal) return;
    const retryAfter = refusal.details?.retryAfterSeconds;
    if (retryAfter !== undefined) void reply.header('retry-after', String(retryAfter));
    const { status, body } = toErrorEnvelope(refusal, request.id);
    await reply.status(status).send(body);
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

  // Structured access log without query strings, bodies or headers (they may contain PII). `appClient` records how a
  // gated request identified its app build; ABSENT carries the APP_CLIENT_HEADERS_MISSING signal (ADR-049: allowed and
  // counted until the first public release makes the headers mandatory).
  fastify.addHook('onResponse', (request, reply, done) => {
    const appClient = release.clientHeadersOf(request);
    log.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? 'unmatched',
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        ...(appClient === undefined ? {} : { appClient }),
        ...(appClient === 'ABSENT' ? { signal: 'APP_CLIENT_HEADERS_MISSING' } : {}),
      },
      'request completed',
    );
    done();
  });
}
