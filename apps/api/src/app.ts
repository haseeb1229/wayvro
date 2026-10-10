import 'reflect-metadata';
import type { IncomingMessage } from 'node:http';
import helmet from '@fastify/helmet';
import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { resolveRequestId, type Logger } from '@wayvro/observability';
import { HealthController } from './health/health.controller.js';
import { ErrorEnvelopeFilter } from './http/error-filter.js';
import { registerHttpHooks } from './http/hooks.js';
import { READINESS_CHECKS, SERVICE_INFO, type ServiceInfo } from './tokens.js';
import type { ReadinessCheck } from '@wayvro/server-runtime';

export interface AppDependencies {
  readonly info: ServiceInfo;
  readonly readinessChecks: readonly ReadinessCheck[];
  readonly log: Logger;
  readonly trustProxy: boolean;
  /** Test-only seam: extra controllers (e.g. to exercise the idempotency shape before any mutating route exists). */
  readonly extraControllers?: readonly Type[];
}

@Module({})
class ApiModule {
  static register(deps: AppDependencies): DynamicModule {
    return {
      module: ApiModule,
      controllers: [HealthController, ...(deps.extraControllers ?? [])],
      providers: [
        { provide: SERVICE_INFO, useValue: deps.info },
        { provide: READINESS_CHECKS, useValue: deps.readinessChecks },
      ],
    };
  }
}

export async function createApp(deps: AppDependencies): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: 1024 * 1024,
    trustProxy: deps.trustProxy,
    genReqId: (req: IncomingMessage) => resolveRequestId(req.headers['x-request-id']),
    disableRequestLogging: true,
    return503OnClosing: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(ApiModule.register(deps), adapter, { logger: false, bufferLogs: false });
  // API responses are JSON only: the strictest CSP, no framing, no referrer, no MIME sniffing.
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });
  registerHttpHooks(app.getHttpAdapter().getInstance(), deps.log);
  app.useGlobalFilters(new ErrorEnvelopeFilter(deps.log));
  app.enableShutdownHooks();
  await app.init();
  return app;
}
