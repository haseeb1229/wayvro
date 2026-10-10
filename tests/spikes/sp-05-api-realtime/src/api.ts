// SPIKE-ONLY NestJS 12 + Fastify API: authoritative state lives in Postgres; after each committed change the API
// publishes a versioned event through @socket.io/redis-emitter (stand-in for the future outbox relay).
import 'reflect-metadata';
import { Body, Controller, Get, Headers, HttpCode, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, UnauthorizedException, type OnModuleDestroy } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Emitter } from '@socket.io/redis-emitter';
import { Redis } from 'ioredis';
import pg from 'pg';
import { API_PORT, DATABASE_URL, ENTITY_COUNT, REDIS_URL, verifyToken, type EntityEvent, type Snapshot } from './shared.js';

@Injectable()
class EntityService implements OnModuleDestroy {
  private readonly pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  private readonly redis = new Redis(REDIS_URL);
  private readonly emitter = new Emitter(this.redis);
  private ticker: NodeJS.Timeout | undefined;
  advanced = 0;

  async snapshot(entityId: number): Promise<Snapshot | null> {
    const r = await this.pool.query<{ version: number; state: string }>('select version, state from spike_entities where id = $1', [entityId]);
    const row = r.rows[0];
    return row ? { entityId, version: row.version, state: row.state } : null;
  }

  async advance(entityId: number): Promise<number> {
    const r = await this.pool.query<{ version: number }>(
      `update spike_entities set version = version + 1, state = 'S' || (version + 1), updated_at = now() where id = $1 returning version`,
      [entityId],
    );
    const version = r.rows[0]?.version;
    if (version === undefined) throw new NotFoundException();
    // Emit only after the write committed (autocommit). Realtime is a delivery channel, never the source of truth.
    const event: EntityEvent = { entityId, version, emittedAt: Date.now() };
    this.emitter.to(`entity:${entityId}`).emit('entity.updated', event);
    this.advanced++;
    return version;
  }

  setTicker(ratePerSecond: number): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
    if (ratePerSecond <= 0) return;
    const perTick = Math.max(1, Math.round(ratePerSecond / 20));
    this.ticker = setInterval(() => {
      for (let i = 0; i < perTick; i++) void this.advance(1 + Math.floor(Math.random() * ENTITY_COUNT)).catch((e: unknown) => console.error('advance failed', e));
    }, 50);
  }

  async onModuleDestroy(): Promise<void> {
    this.setTicker(0);
    await this.pool.end();
    this.redis.disconnect();
  }
}

@Controller()
class EntityController {
  constructor(private readonly entities: EntityService) {}

  @Get('health')
  health(): { status: 'ok'; rssMb: number; advanced: number } {
    return { status: 'ok', rssMb: Math.round(process.memoryUsage().rss / 1048576), advanced: this.entities.advanced };
  }

  @Get('v1/spike/entities/:id/snapshot')
  async snapshot(@Param('id', ParseIntPipe) id: number, @Headers('authorization') auth?: string): Promise<Snapshot> {
    const claims = verifyToken(auth?.replace(/^Bearer /, ''), Date.now());
    if (!claims || claims.entityId !== id) throw new UnauthorizedException();
    const s = await this.entities.snapshot(id);
    if (!s) throw new NotFoundException();
    return s;
  }

  @Post('v1/spike/ticker')
  @HttpCode(204)
  ticker(@Body() body: { ratePerSecond: number }): void {
    this.entities.setTicker(Number(body.ratePerSecond));
  }
}

@Module({ controllers: [EntityController], providers: [EntityService] })
class ApiModule {}

const app = await NestFactory.create<NestFastifyApplication>(ApiModule, new FastifyAdapter(), { logger: ['error', 'warn'] });
app.enableShutdownHooks();
await app.listen(API_PORT, '127.0.0.1');
console.log(`api listening on ${API_PORT}`);
