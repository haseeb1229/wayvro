import 'reflect-metadata';
import helmet from '@fastify/helmet';
import { Module, type DynamicModule, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Logger } from '@wayvro/observability';
import type { ReadinessCheck } from '@wayvro/server-runtime';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { ConnectionAuthenticator } from './auth.js';
import { RealtimeGateway } from './gateway.js';
import { RealtimeHealthController } from './health.controller.js';
import { CONNECTION_AUTHENTICATOR, LOGGER, READINESS_CHECKS, REVALIDATE_INTERVAL_MS, SERVICE_INFO } from './tokens.js';

/** Socket.IO tuning from SP-05 (ADR-005b): websocket only, faster dead-peer detection, small frames, no CORS. */
const SOCKET_OPTIONS: Partial<ServerOptions> = {
  transports: ['websocket'],
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 64 * 1024,
  serveClient: false,
};

/** Socket.IO adapter with optional Redis fan-out so any number of gateway processes can share rooms. */
class WayvroIoAdapter extends IoAdapter {
  private pub: Redis | undefined;
  private sub: Redis | undefined;
  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string | undefined,
  ) {
    super(app);
  }

  async connectRedis(): Promise<void> {
    if (!this.redisUrl) return;
    this.pub = new Redis(this.redisUrl, { maxRetriesPerRequest: 3 });
    this.sub = this.pub.duplicate();
    await Promise.all([this.pub.ping(), this.sub.ping()]);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    // Nest passes a partial options object although socket.io types every field as required (SP-05 finding).
    const server: Server = super.createIOServer(port, { ...options, ...SOCKET_OPTIONS } as ServerOptions);
    if (this.pub && this.sub) server.adapter(createAdapter(this.pub, this.sub));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    this.pub?.disconnect();
    this.sub?.disconnect();
  }
}

export interface RealtimeDependencies {
  readonly info: { service: string; version: string };
  readonly authenticator: ConnectionAuthenticator;
  readonly readinessChecks: readonly ReadinessCheck[];
  readonly log: Logger;
  /** Required in every deployed environment; omitted only by single-process unit tests. */
  readonly redisUrl: string | undefined;
  /** Interval at which established connections re-validate their session. */
  readonly revalidateIntervalMs: number;
}

@Module({})
class RealtimeModule {
  static register(deps: RealtimeDependencies): DynamicModule {
    return {
      module: RealtimeModule,
      controllers: [RealtimeHealthController],
      providers: [
        RealtimeGateway,
        { provide: CONNECTION_AUTHENTICATOR, useValue: deps.authenticator },
        { provide: LOGGER, useValue: deps.log },
        { provide: READINESS_CHECKS, useValue: deps.readinessChecks },
        { provide: REVALIDATE_INTERVAL_MS, useValue: deps.revalidateIntervalMs },
        { provide: SERVICE_INFO, useValue: deps.info },
      ],
    };
  }
}

export async function createRealtimeApp(deps: RealtimeDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(RealtimeModule.register(deps), new FastifyAdapter({ bodyLimit: 16 * 1024 }), { logger: false });
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    referrerPolicy: { policy: 'no-referrer' },
  });
  const adapter = new WayvroIoAdapter(app, deps.redisUrl);
  await adapter.connectRedis();
  app.useWebSocketAdapter(adapter);
  app.enableShutdownHooks();
  await app.init();
  return app;
}
