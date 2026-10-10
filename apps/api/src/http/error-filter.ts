import { Catch, HttpException, NotFoundException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { WayvroError, toErrorEnvelope, type Logger } from '@wayvro/observability';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Maps every error to the contract envelope with a stable code (CLAUDE.md §13). Stack traces, SQL and provider messages
 * never reach the client; unexpected errors are logged (redacted) server-side with the request id.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  constructor(private readonly log: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    let error: unknown = exception;
    if (exception instanceof NotFoundException) error = new WayvroError('WAYVRO_E_NOT_FOUND');
    else if (exception instanceof HttpException && exception.getStatus() < 500) error = new WayvroError('WAYVRO_E_VALIDATION');
    const { status, body } = toErrorEnvelope(error, request.id);
    if (status >= 500) this.log.error({ err: exception, requestId: request.id, route: request.routeOptions.url }, 'unhandled error');
    void reply.status(status).send(body);
  }
}
