/**
 * SEC-RT against real PostgreSQL: the realtime authenticator connects as a LOGIN member of `wayvro_realtime`
 * (column-level SELECT only). Valid sessions connect; revoked/expired/refresh tokens are refused; revoking an open
 * session disconnects it and its reconnect is refused; rooms derive only from the verified account.
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { runMigrations } from '@wayvro/db';
import { hashToken, newOpaqueToken } from '@wayvro/identity-core';
import { createLogger } from '@wayvro/observability';
import { captureLogs, createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRealtimeApp } from '../src/app.js';
import { SessionAuthenticator, principalRoom } from '../src/auth.js';
import { RealtimeGateway } from '../src/gateway.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;

let database: TestDatabase;
let writer: pg.Pool;
let realtimeDb: pg.Pool;
let app: NestFastifyApplication;
let url: string;
const logins: RestrictedLogin[] = [];
const sockets: Socket[] = [];
const logs = captureLogs();

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  const apiLogin = await createRestrictedLogin(adminUrl, database.url, 'wayvro_api');
  const rtLogin = await createRestrictedLogin(adminUrl, database.url, 'wayvro_realtime');
  logins.push(apiLogin, rtLogin);
  writer = new pg.Pool({ connectionString: apiLogin.url, max: 2 });
  realtimeDb = new pg.Pool({ connectionString: rtLogin.url, max: 2 });
  app = await createRealtimeApp({
    info: { service: 'realtime', version: 'test' },
    authenticator: new SessionAuthenticator(realtimeDb),
    readinessChecks: [],
    log: createLogger({ service: 'realtime', env: 'test', level: 'info', destination: logs.stream }),
    redisUrl: undefined,
    revalidateIntervalMs: 150,
  });
  await app.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${String((app.getHttpServer().address() as AddressInfo).port)}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  await app.close();
  await Promise.all([writer.end(), realtimeDb.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

async function session(over: { accessIn?: string } = {}): Promise<{ accountId: string; sessionId: string; access: string; refresh: string }> {
  const accountId = randomUUID();
  const deviceId = randomUUID();
  const sessionId = randomUUID();
  const access = newOpaqueToken('access');
  const refresh = newOpaqueToken('refresh');
  await writer.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [accountId]);
  await writer.query(
    `insert into identity.account_devices (id, account_id, installation_hash, platform, app_version, first_verified_at, last_seen_at, trust_state) values ($1, $2, $3, 'IOS', '1.0.0', now(), now(), 'NEW')`,
    [deviceId, accountId, randomBytes(32)],
  );
  await writer.query(
    `insert into identity.sessions (id, account_id, device_id, status, assurance, access_token_hash, access_expires_at, idle_expires_at, absolute_expires_at, app_version)
     values ($1, $2, $3, 'ACTIVE', 'OTP', $4, now() + $5::interval, now() + interval '60 days', now() + interval '180 days', '1.0.0')`,
    [sessionId, accountId, deviceId, hashToken(access), over.accessIn ?? '15 minutes'],
  );
  await writer.query(
    `insert into identity.refresh_tokens (id, session_id, token_hash, issued_at, expires_at) values ($1, $2, $3, now(), now() + interval '60 days')`,
    [randomUUID(), sessionId, hashToken(refresh)],
  );
  return { accountId, sessionId, access, refresh };
}

function connect(token: unknown): Promise<{ socket: Socket; hello?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const socket = io(url, { transports: ['websocket'], reconnection: false, forceNew: true, auth: { token } });
    sockets.push(socket);
    socket.on('session.hello', (hello: unknown) => {
      resolve({ socket, hello });
    });
    socket.on('connect_error', (e) => {
      resolve({ socket, error: e.message });
    });
  });
}

describe('SEC-RT: session-authenticated realtime', () => {
  it('SEC-RT-01 a live session connects; refresh, unknown, malformed and missing tokens are refused', async () => {
    const s = await session();
    expect((await connect(s.access)).hello).toBeDefined();
    for (const bad of [s.refresh, newOpaqueToken('access'), 'garbage', 42, undefined]) expect((await connect(bad)).error).toBe('WAYVRO_E_UNAUTHENTICATED');
  });

  it('SEC-RT-02 an expired access token and a revoked session cannot connect', async () => {
    const expired = await session({ accessIn: '-1 second' });
    expect((await connect(expired.access)).error).toBe('WAYVRO_E_UNAUTHENTICATED');
    const revoked = await session();
    await writer.query(`update identity.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'USER_LOGOUT' where id = $1`, [revoked.sessionId]);
    expect((await connect(revoked.access)).error).toBe('WAYVRO_E_UNAUTHENTICATED');
  });

  it('SEC-RT-03 revoking an open session disconnects it and the reconnect is refused', async () => {
    const s = await session();
    const { socket } = await connect(s.access);
    const closed = new Promise<string>((resolve) => socket.on('disconnect', resolve));
    await writer.query(`update identity.sessions set status = 'REVOKED', revoked_at = now(), revoke_reason = 'USER_LOGOUT_ALL' where id = $1`, [s.sessionId]);
    expect(await closed).toBe('io server disconnect');
    expect((await connect(s.access)).error).toBe('WAYVRO_E_UNAUTHENTICATED');
  });

  it('SEC-RT-04 rooms derive from the verified account; client-chosen rooms are never joined', async () => {
    const a = await session();
    const b = await session();
    const { socket: sa } = await connect(a.access);
    const { socket: sb } = await connect(b.access);
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    sa.on('platform.probe.v1', (m: unknown) => receivedA.push(m));
    sb.on('platform.probe.v1', (m: unknown) => receivedB.push(m));
    // A client asking to join someone else's room has no effect (no such handler exists).
    sb.emit('join', principalRoom({ subject: a.accountId }));
    await new Promise((r) => setTimeout(r, 100));
    app
      .get(RealtimeGateway)
      .server.to(principalRoom({ subject: a.accountId }))
      .emit('platform.probe.v1', { version: 1 });
    await new Promise((r) => setTimeout(r, 200));
    expect(receivedA).toEqual([{ version: 1 }]);
    expect(receivedB).toEqual([]);
  });

  it('SEC-RT-05 the realtime role cannot read beyond session verification columns', async () => {
    await expect(realtimeDb.query(`select app_version from identity.sessions`)).rejects.toThrow(/permission denied/);
    await expect(realtimeDb.query(`select * from identity.refresh_tokens`)).rejects.toThrow(/permission denied/);
  });
});
