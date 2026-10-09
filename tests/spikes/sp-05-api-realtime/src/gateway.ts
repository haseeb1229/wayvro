// SPIKE-ONLY realtime gateway: NestJS 12 + Fastify + @nestjs/platform-socket.io with the Socket.IO Redis adapter so
// any number of gateway processes deliver events published by the API's redis-emitter. Usage: node dist/gateway.js <port>
import 'reflect-metadata';
import { Controller, Get, Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { WebSocketGateway, WebSocketServer, type OnGatewayInit } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions, Socket } from 'socket.io';
import { REDIS_URL, verifyToken } from './shared.js';

const PORT = Number(process.argv[2] ?? 4101);

class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | undefined;
  constructor(app: INestApplicationContext) {
    super(app);
  }
  async connect(): Promise<void> {
    const pub = new Redis(REDIS_URL);
    const sub = pub.duplicate();
    await Promise.all([new Promise((r) => pub.once('ready', r)), new Promise((r) => sub.once('ready', r))]);
    this.adapterConstructor = createAdapter(pub, sub);
  }
  override createIOServer(port: number, options?: ServerOptions): Server {
    // Nest passes a partial options object; socket.io's ServerOptions type marks every field required.
    const tuned = { ...options, transports: ['websocket'], pingInterval: 10000, pingTimeout: 5000 } as ServerOptions;
    const server = super.createIOServer(port, tuned) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}

@WebSocketGateway()
class EntityGateway implements OnGatewayInit {
  @WebSocketServer() server!: Server;

  afterInit(server: Server): void {
    // Authenticate the handshake before the connection is accepted (fail closed).
    server.use((socket: Socket, next) => {
      const claims = verifyToken((socket.handshake.auth as { token?: unknown }).token, Date.now());
      if (!claims) return next(new Error('unauthorized'));
      socket.data = { sub: claims.sub, entityId: claims.entityId };
      void socket.join(`entity:${claims.entityId}`);
      next();
    });
  }
}

@Controller()
class HealthController {
  @Get('health')
  health(): { status: 'ok'; rssMb: number; port: number } {
    return { status: 'ok', rssMb: Math.round(process.memoryUsage().rss / 1048576), port: PORT };
  }
}

@Module({ controllers: [HealthController], providers: [EntityGateway] })
class GatewayModule {}

const app = await NestFactory.create<NestFastifyApplication>(GatewayModule, new FastifyAdapter(), { logger: ['error', 'warn'] });
const adapter = new RedisIoAdapter(app);
await adapter.connect();
app.useWebSocketAdapter(adapter);
await app.listen(PORT, '127.0.0.1');
console.log(`gateway listening on ${PORT}`);
