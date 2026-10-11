import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ErrorCode } from '@wayvro/contracts';
import { WayvroError, toErrorEnvelope, type Logger } from '@wayvro/observability';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Explicit error mapping (F-04; CLAUDE.md §13). Only these framework conditions map to client errors:
 *   404 (no route)            -> WAYVRO_E_NOT_FOUND
 *   400 (malformed JSON body) -> WAYVRO_E_VALIDATION
 *   413 (body too large)      -> WAYVRO_E_PAYLOAD_TOO_LARGE
 *   415 (content type)        -> WAYVRO_E_UNSUPPORTED_MEDIA_TYPE
 * Every other non-Wayvro error — including any other 4xx HttpException — is a programming error and becomes
 * 500 WAYVRO_E_INTERNAL (logged, redacted). Stack traces, SQL and provider messages never reach the client.
 */
const FRAMEWORK_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: 'WAYVRO_E_VALIDATION',
  404: 'WAYVRO_E_NOT_FOUND',
  413: 'WAYVRO_E_PAYLOAD_TOO_LARGE',
  415: 'WAYVRO_E_UNSUPPORTED_MEDIA_TYPE',
};

// Fastify body/content-type errors reach this filter as Nest HttpExceptions (verified by test/app.test.ts).
function mapError(exception: unknown): unknown {
  if (exception instanceof WayvroError || !(exception instanceof HttpException)) return exception;
  const code = FRAMEWORK_STATUS[exception.getStatus()];
  return code ? new WayvroError(code, { cause: exception }) : exception;
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  constructor(private readonly log: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const { status, body } = toErrorEnvelope(mapError(exception), request.id);
    if (status >= 500) this.log.error({ err: exception, requestId: request.id, route: request.routeOptions.url }, 'request failed');
    const retryAfter = body.error.details?.retryAfterSeconds;
    if (retryAfter !== undefined) void reply.header('retry-after', String(retryAfter));
    void reply.status(status).send(body);
  }
}
