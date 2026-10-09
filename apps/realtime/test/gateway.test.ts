import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { LivenessSchema, SessionHelloSchema } from '@wayvro/contracts';
import { createLogger } from '@wayvro/observability';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createRealtimeApp } from '../src/app.js';
import { DenyAllAuthenticator, principalRoom, type ConnectionAuthenticator } from '../src/auth.js';
import { loadRealtimeConfig } from '../src/config.js';

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
/** Test-only authenticator: accepts exactly one synthetic token. */
const tokenAuthenticator: ConnectionAuthenticator = {
  authenticate: (h) => Promise.resolve((h.auth as { token?: string }).token === 'synthetic-valid-token' ? { subject: 'synthetic-subject-1' } : null),
};

const apps: NestFastifyApplication[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  for (const a of apps.splice(0)) await a.close();
});

async function start(authenticator: ConnectionAuthenticator): Promise<string> {
  const app = await createRealtimeApp({ info: { service: 'realtime', version: 'test' }, authenticator, readinessChecks: [], log, redisUrl: undefined });
  apps.push(app);
  await app.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${String((app.getHttpServer().address() as AddressInfo).port)}`;
}

function connect(url: string, token?: string): Promise<{ socket: Socket; hello?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const socket = io(url, { transports: ['websocket'], reconnection: false, forceNew: true, ...(token ? { auth: { token } } : {}) });
    sockets.push(socket);
    socket.on('session.hello', (hello: unknown) => {
      resolve({ socket, hello });
    });
    socket.on('connect_error', (e) => {
      resolve({ socket, error: e.message });
    });
  });
}

describe('realtime gateway', () => {
  it('Phase 1 default (deny-all) refuses every connection', async () => {
    const result = await connect(await start(new DenyAllAuthenticator()), 'anything');
    expect(result.error).toBe('WAYVRO_E_UNAUTHENTICATED');
  });

  it('accepts an authenticated connection and instructs the client to resync from a snapshot', async () => {
    const result = await connect(await start(tokenAuthenticator), 'synthetic-valid-token');
    expect(SessionHelloSchema.parse(result.hello).resync).toBe('fetch-snapshot');
  });

  it('refuses unknown tokens and fails closed when the authenticator throws', async () => {
    expect((await connect(await start(tokenAuthenticator), 'forged')).error).toBe('WAYVRO_E_UNAUTHENTICATED');
    const throwing: ConnectionAuthenticator = { authenticate: () => Promise.reject(new Error('verifier down')) };
    expect((await connect(await start(throwing), 'synthetic-valid-token')).error).toBe('WAYVRO_E_UNAUTHENTICATED');
  });

  it('serves the health contract over HTTP with security headers', async () => {
    const base = await start(new DenyAllAuthenticator());
    const live = await fetch(`${base}/v1/health/live`);
    expect(LivenessSchema.parse(await live.json()).service).toBe('realtime');
    expect(live.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await fetch(`${base}/v1/health/ready`)).status).toBe(200);
  });

  it('derives rooms only from the verified principal', () => {
    expect(principalRoom({ subject: 'abc' })).toBe('principal:abc');
  });

  it('requires REDIS_URL in its configuration', () => {
    expect(() => loadRealtimeConfig({ WAYVRO_ENV: 'local' })).toThrow(/REDIS_URL/);
    expect(loadRealtimeConfig({ WAYVRO_ENV: 'local', REDIS_URL: 'redis://127.0.0.1:26379' }).PORT).toBe(4001);
  });
});
