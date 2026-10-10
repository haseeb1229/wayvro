/**
 * Shared composition of the API process (ADR-045). The production root (`src/main.ts`) and the local runner
 * (`dev/main.local.ts`, outside `src/` and outside every deployable artefact) both call `composeApi`; they differ only in
 * the provider bindings they pass and in local-only controllers. Nothing in `src/` imports a test double.
 */
import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDatabase } from '@wayvro/db';
import type { Logger } from '@wayvro/observability';
import type { ProviderRegistry } from '@wayvro/provider-interfaces';
import { databaseCheck, redisCheck } from '@wayvro/server-runtime';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';

export interface ApiRuntime {
  readonly app: NestFastifyApplication;
  close(): Promise<void>;
}

export interface ComposeOptions {
  readonly providers: ProviderRegistry;
  /** Local-runner-only controllers (never passed by `src/main.ts`). */
  readonly extraControllers?: readonly Type[];
}

export async function composeApi(config: ApiConfig, log: Logger, options: ComposeOptions): Promise<ApiRuntime> {
  const db = createDatabase(config.DATABASE_URL, { maxConnections: 10, applicationName: 'wayvro-api' });
  const redis = redisCheck(config.REDIS_URL);
  const app = await createApp({
    info: { service: 'api', version: config.WAYVRO_BUILD_VERSION },
    readinessChecks: [databaseCheck(db), redis],
    log,
    trustProxy: config.TRUST_PROXY,
    ...(options.extraControllers ? { extraControllers: options.extraControllers } : {}),
  });
  return {
    app,
    async close() {
      await app.close();
      redis.close();
      await db.close();
    },
  };
}
