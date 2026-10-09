import 'reflect-metadata';
import { Writable } from 'node:stream';
import { Controller, HttpCode, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions } from 'fastify';
import { API_ROUTES, ErrorEnvelopeSchema, LivenessSchema, ReadinessSchema } from '@wayvro/contracts';
import { createLogger } from '@wayvro/observability';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { ReadinessCheck } from '@wayvro/server-runtime';

@Controller()
class ProbeMutationController {
  @Post('/v1/test-only/mutation')
  @HttpCode(201)
  create(): { created: true } {
    return { created: true };
  }
}

const logLines: string[] = [];
const sink = new Writable({
  write(chunk: Buffer, _e, cb) {
    logLines.push(chunk.toString());
    cb();
  },
});
const log = createLogger({ service: 'api', env: 'test', level: 'info', destination: sink });
const check = (name: string, ok: boolean): ReadinessCheck => ({ name, check: () => Promise.resolve(ok) });

let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function boot(checks: ReadinessCheck[] = [check('database', true), check('redis', true)], withProbe = false): Promise<NestFastifyApplication> {
  app = await createApp({
    info: { service: 'api', version: 'test' },
    readinessChecks: checks,
    log,
    trustProxy: false,
    ...(withProbe ? { extraControllers: [ProbeMutationController] } : {}),
  });
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
const inject = (a: NestFastifyApplication, opts: InjectOptions) => a.getHttpAdapter().getInstance().inject(opts);

describe('health contract', () => {
  it('liveness returns the contract shape', async () => {
    const res = await inject(await boot(), { method: 'GET', url: '/v1/health/live' });
    expect(res.statusCode).toBe(200);
    expect(LivenessSchema.parse(res.json()).service).toBe('api');
  });

  it('readiness is 200 when every dependency responds', async () => {
    const res = await inject(await boot(), { method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(ReadinessSchema.parse(res.json())).toEqual({ status: 'ready', checks: { database: 'ok', redis: 'ok' } });
  });

  it('readiness is 503 and names the failing dependency', async () => {
    const res = await inject(await boot([check('database', false), check('redis', true)]), { method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(ReadinessSchema.parse(res.json())).toEqual({ status: 'not_ready', checks: { database: 'fail', redis: 'ok' } });
  });

  it('serves exactly the /v1 routes published in packages/contracts (no drift)', async () => {
    const printed = (await boot()).getHttpAdapter().getInstance().printRoutes({ commonPrefix: false });
    const served = new Set<string>();
    for (const m of printed.matchAll(/(\/v1\/[^\s(]+)\s*\(([^)]+)\)/g)) {
      for (const method of (m[2] ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x !== 'HEAD'))
        served.add(`${method} ${m[1] ?? ''}`);
    }
    expect([...served].sort()).toEqual(API_ROUTES.map((r) => `${r.method} ${r.path}`).sort());
  });
});

describe('request ids', () => {
  it('echoes a well-formed caller id and replaces junk', async () => {
    const a = await boot();
    const ok = await inject(a, { method: 'GET', url: '/v1/health/live', headers: { 'x-request-id': 'req-abcdef12' } });
    expect(ok.headers['x-request-id']).toBe('req-abcdef12');
    const junk = await inject(a, { method: 'GET', url: '/v1/health/live', headers: { 'x-request-id': '<script>alert(1)</script>' } });
    expect(junk.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('writes a redacted access log line carrying the request id', async () => {
    logLines.length = 0;
    await inject(await boot(), { method: 'GET', url: '/v1/health/live?phone=03001234567', headers: { 'x-request-id': 'req-logcheck1' } });
    const line = logLines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l['msg'] === 'request completed');
    expect(line).toMatchObject({ requestId: 'req-logcheck1', route: '/v1/health/live', status: 200 });
    expect(logLines.join('')).not.toContain('03001234567');
  });
});

describe('baseline security', () => {
  it('sends strict security headers', async () => {
    const res = await inject(await boot(), { method: 'GET', url: '/v1/health/live' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns the error envelope for unknown routes without leaking internals', async () => {
    const res = await inject(await boot(), { method: 'GET', url: '/v1/does-not-exist', headers: { 'x-request-id': 'req-notfound1' } });
    expect(res.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.parse(res.json())).toEqual({ error: { code: 'WAYVRO_E_NOT_FOUND', message: expect.any(String), requestId: 'req-notfound1' } });
  });

  it('maps unexpected failures to WAYVRO_E_INTERNAL', async () => {
    const throwing: ReadinessCheck = { name: 'database', check: () => Promise.reject(new Error('password=hunter2 at pg.js:1')) };
    const res = await inject(await boot([throwing]), { method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: 'WAYVRO_E_INTERNAL' } });
    expect(res.body).not.toContain('hunter2');
  });
});

describe('Idempotency-Key shape on mutating /v1 routes', () => {
  it('requires the header', async () => {
    const res = await inject(await boot(undefined, true), { method: 'POST', url: '/v1/test-only/mutation' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'WAYVRO_E_IDEMPOTENCY_KEY_REQUIRED' } });
  });

  it('rejects a malformed key', async () => {
    const res = await inject(await boot(undefined, true), { method: 'POST', url: '/v1/test-only/mutation', headers: { 'idempotency-key': 'short' } });
    expect(res.json()).toMatchObject({ error: { code: 'WAYVRO_E_IDEMPOTENCY_KEY_INVALID' } });
  });

  it('lets a well-formed key through', async () => {
    const res = await inject(await boot(undefined, true), {
      method: 'POST',
      url: '/v1/test-only/mutation',
      // Synthetic, well-formed Idempotency-Key header value — not a credential (inline secret-scan allow below).
      headers: { 'idempotency-key': 'synthetic-idempotency-key-0001' }, // gitleaks:allow
    });
    expect(res.statusCode).toBe(201);
  });

  it('does not turn unknown mutating paths into 400s', async () => {
    const res = await inject(await boot(), { method: 'POST', url: '/v1/nothing-here' });
    expect(res.statusCode).toBe(404);
  });
});
