import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { LivenessSchema, SessionHelloSchema } from '@wayvro/contracts';
import { createLogger } from '@wayvro/observability';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createRealtimeApp } from '../src/app.js';
import { principalRoom, type ConnectionAuthenticator, type RealtimePrincipal } from '../src/auth.js';
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

/** Test-only authenticator: accepts exactly one synthetic token; validity is switchable. */
function tokenAuthenticator(opts: { expiresInMs?: number; valid?: () => boolean } = {}): ConnectionAuthenticator {
  return {
    authenticate: (h) =>
      Promise.resolve(
        (h.auth as { token?: string }).token === 'synthetic-valid-token'
          ? ({
              subject: 'synthetic-subject-1',
              sessionId: 'synthetic-session-1',
              expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 60_000)),
            } satisfies RealtimePrincipal)
          : null,
      ),
    isStillValid: () => Promise.resolve(opts.valid ? opts.valid() : true),
  };
}

const apps: NestFastifyApplication[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  for (const a of apps.splice(0)) await a.close();
});

async function start(authenticator: ConnectionAuthenticator, revalidateIntervalMs = 60_000): Promise<string> {
  const app = await createRealtimeApp({
    info: { service: 'realtime', version: 'test' },
    authenticator,
    readinessChecks: [],
    log,
    redisUrl: undefined,
    revalidateIntervalMs,
  });
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

const disconnected = (socket: Socket) => new Promise<string>((resolve) => socket.on('disconnect', resolve));

describe('realtime gateway', () => {
  it('accepts an authenticated connection and instructs the client to resync from a snapshot', async () => {
    const result = await connect(await start(tokenAuthenticator()), 'synthetic-valid-token');
    expect(SessionHelloSchema.parse(result.hello).resync).toBe('fetch-snapshot');
  });

  it('refuses missing/unknown tokens and fails closed when the authenticator throws', async () => {
    const url = await start(tokenAuthenticator());
    expect((await connect(url)).error).toBe('WAYVRO_E_UNAUTHENTICATED');
    expect((await connect(url, 'forged')).error).toBe('WAYVRO_E_UNAUTHENTICATED');
    const throwing: ConnectionAuthenticator = { authenticate: () => Promise.reject(new Error('verifier down')), isStillValid: () => Promise.resolve(true) };
    expect((await connect(await start(throwing), 'synthetic-valid-token')).error).toBe('WAYVRO_E_UNAUTHENTICATED');
  });

  it('closes the connection when the access token expires', async () => {
    const { socket } = await connect(await start(tokenAuthenticator({ expiresInMs: 300 })), 'synthetic-valid-token');
    expect(await disconnected(socket)).toBe('io server disconnect');
  });

  it('closes the connection when re-validation fails or errors', async () => {
    let valid = true;
    const { socket } = await connect(await start(tokenAuthenticator({ valid: () => valid }), 100), 'synthetic-valid-token');
    valid = false;
    expect(await disconnected(socket)).toBe('io server disconnect');
    const erroring: ConnectionAuthenticator = { ...tokenAuthenticator(), isStillValid: () => Promise.reject(new Error('db down')) };
    const second = await connect(await start(erroring, 100), 'synthetic-valid-token');
    expect(await disconnected(second.socket)).toBe('io server disconnect');
  });

  it('serves the health contract over HTTP with security headers', async () => {
    const base = await start(tokenAuthenticator());
    const live = await fetch(`${base}/v1/health/live`);
    expect(LivenessSchema.parse(await live.json()).service).toBe('realtime');
    expect(live.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await fetch(`${base}/v1/health/ready`)).status).toBe(200);
  });

  it('derives rooms only from the verified principal', () => {
    expect(principalRoom({ subject: 'abc' })).toBe('principal:abc');
  });

  it('requires DATABASE_URL and REDIS_URL in its configuration', () => {
    expect(() => loadRealtimeConfig({ WAYVRO_ENV: 'local' })).toThrow(/DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/);
    const c = loadRealtimeConfig({ WAYVRO_ENV: 'local', DATABASE_URL: 'postgres://a:b@127.0.0.1:25432/w', REDIS_URL: 'redis://127.0.0.1:26379' });
    expect(c.PORT).toBe(4001);
    expect(c.REALTIME_SESSION_REVALIDATE_MS).toBe(60_000);
  });
});
