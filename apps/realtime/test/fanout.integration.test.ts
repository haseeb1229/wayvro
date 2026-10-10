import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger } from '@wayvro/observability';
import { redisCheck } from '@wayvro/server-runtime';
import { io, type Socket } from 'socket.io-client';
import { afterAll, describe, expect, it } from 'vitest';
import { createRealtimeApp } from '../src/app.js';
import { principalRoom, type ConnectionAuthenticator } from '../src/auth.js';
import { RealtimeGateway } from '../src/gateway.js';

const REDIS_URL = process.env['REDIS_URL'];
if (!REDIS_URL) throw new Error('REDIS_URL is required (start infra with `pnpm infra:up`)');

const log = createLogger({
  service: 'realtime',
  env: 'test',
  level: 'silent',
  destination: new Writable({
    write: (_c, _e, cb) => {
      cb();
    },
  }),
});
const auth: ConnectionAuthenticator = {
  authenticate: (h) =>
    Promise.resolve({ subject: String((h.auth as { subject?: string }).subject), sessionId: 'synthetic-session', expiresAt: new Date(Date.now() + 60_000) }),
  isStillValid: () => Promise.resolve(true),
};
const probe = redisCheck(REDIS_URL);
const apps: NestFastifyApplication[] = [];
const sockets: Socket[] = [];
afterAll(async () => {
  sockets.forEach((s) => s.close());
  for (const a of apps) await a.close();
  probe.close();
});

async function gateway(): Promise<{ app: NestFastifyApplication; url: string }> {
  const app = await createRealtimeApp({
    info: { service: 'realtime', version: 'test' },
    authenticator: auth,
    readinessChecks: [probe],
    log,
    redisUrl: REDIS_URL,
    revalidateIntervalMs: 60_000,
  });
  apps.push(app);
  await app.listen(0, '127.0.0.1');
  return { app, url: `http://127.0.0.1:${String((app.getHttpServer().address() as AddressInfo).port)}` };
}

describe('horizontal fan-out through the Redis adapter (Valkey)', () => {
  it('an event emitted on gateway A reaches a client connected to gateway B', async () => {
    const a = await gateway();
    const b = await gateway();
    const subject = `synthetic-${String(Date.now())}`;
    const client = io(b.url, { transports: ['websocket'], reconnection: false, forceNew: true, auth: { subject } });
    sockets.push(client);
    await new Promise<void>((resolve) => {
      client.on('session.hello', () => {
        resolve();
      });
    });
    const received = new Promise<unknown>((resolve) => client.on('platform.probe.v1', resolve));
    a.app.get(RealtimeGateway).server.to(principalRoom({ subject })).emit('platform.probe.v1', { version: 1 });
    expect(await received).toEqual({ version: 1 });
    expect((await fetch(`${a.url}/v1/health/ready`)).status).toBe(200);
  });
});
