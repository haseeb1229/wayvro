/**
 * API unit tests without infrastructure: health contract, request ids, security headers, explicit error mapping
 * (F-04), Idempotency-Key shape, default-deny route policies (route-policy completeness) and the published route table.
 */
import 'reflect-metadata';
import { BadRequestException, Controller, ForbiddenException, Get, HttpCode, Post, type Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions } from 'fastify';
import { API_ROUTES, ErrorEnvelopeSchema, LivenessSchema, ReadinessSchema } from '@wayvro/contracts';
import { createLogger } from '@wayvro/observability';
import type { ReadinessCheck } from '@wayvro/server-runtime';
import { captureLogs } from '@wayvro/test-support';
import { afterEach, describe, expect, it } from 'vitest';
import { API_CONTROLLERS, createApp, routeManifest } from '../src/app.js';

type AppDependencies = Parameters<typeof createApp>[0];
type IdentityServices = AppDependencies['identity'];
import { ConsumerSession, Public, routePolicyProblems } from '../src/auth/policy.js';
import { ReleaseEnforcement } from '../src/platform/release/enforcement.js';
import { ReleaseStateCache } from '../src/platform/release/state.js';
import { RuntimeSwitchStore } from '../src/platform/release/switches.js';

@Controller()
class ProbeController {
  @Post('/v1/test-only/mutation')
  @HttpCode(201)
  @Public()
  create(): { created: true } {
    return { created: true };
  }

  @Get('/v1/test-only/bad-request')
  @Public()
  badRequest(): never {
    throw new BadRequestException('framework 400 with internals');
  }

  @Get('/v1/test-only/forbidden')
  @Public()
  forbidden(): never {
    throw new ForbiddenException('framework 403');
  }

  @Get('/v1/test-only/protected')
  @ConsumerSession()
  protected(): { ok: true } {
    return { ok: true };
  }
}

@Controller()
class UndeclaredPolicyController {
  @Get('/v1/test-only/undeclared')
  open(): string {
    return 'should never be reachable';
  }
}

const logs = captureLogs();
const log = createLogger({ service: 'api', env: 'test', level: 'info', destination: logs.stream });
const check = (name: string, ok: boolean): ReadinessCheck => ({ name, check: () => Promise.resolve(ok) });
// Identity handlers are never reached in these unit tests (integration tests cover them against real infrastructure).
const identity: IdentityServices = {
  otp: {} as IdentityServices['otp'],
  sessions: {} as IdentityServices['sessions'],
  accounts: {} as IdentityServices['accounts'],
  consents: {} as IdentityServices['consents'],
  security: {} as IdentityServices['security'],
  recoveryReviews: {} as IdentityServices['recoveryReviews'],
  deletion: {} as IdentityServices['deletion'],
  oidc: {} as IdentityServices['oidc'],
  legalStore: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) } as unknown as IdentityServices['legalStore'],
  // No session row ever matches: every bearer token is unknown.
  sessionStore: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) } as unknown as IdentityServices['sessionStore'],
};

const staff: AppDependencies['staff'] = {
  auth: {} as AppDependencies['staff']['auth'],
  admin: {} as AppDependencies['staff']['admin'],
  oversight: {} as AppDependencies['staff']['oversight'],
  policy: { STAFF_SESSION_IDLE_SECONDS: 900, STAFF_SESSION_ABSOLUTE_SECONDS: 28800, STAFF_STEP_UP_SECONDS: 300 },
};

const compliance: AppDependencies['compliance'] = {
  onboarding: {} as AppDependencies['compliance']['onboarding'],
  admin: {} as AppDependencies['compliance']['admin'],
};

// Release controls: an empty store (no ACTIVE policy, registry defaults) — the gate lets every request through.
const releaseState = new ReleaseStateCache({ query: () => Promise.resolve({ rows: [], rowCount: 0 }) } as unknown as IdentityServices['legalStore'], {
  ttlMs: 10_000,
  log,
});
const release: AppDependencies['release'] = {
  enforcement: new ReleaseEnforcement(releaseState, new RuntimeSwitchStore(releaseState, 'test')),
  appConfig: {} as AppDependencies['release']['appConfig'],
  policies: {} as AppDependencies['release']['policies'],
  switches: {} as AppDependencies['release']['switches'],
  appConfigCacheSeconds: 60,
};

let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function boot(checks: ReadinessCheck[] = [check('database', true), check('redis', true)], extra: Type[] = []): Promise<NestFastifyApplication> {
  app = await createApp({
    info: { service: 'api', version: 'test' },
    readinessChecks: checks,
    log,
    trustProxy: false,
    identity,
    staff,
    compliance,
    evidence: null,
    review: {} as never,
    catalog: {} as never,
    support: {} as never,
    release,
    geo: {} as never,
    pricing: {} as never,
    extraControllers: extra,
  });
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
const inject = (a: NestFastifyApplication, opts: InjectOptions) => a.getHttpAdapter().getInstance().inject(opts);
const KEY = { 'idempotency-key': 'synthetic-idempotency-key-0001' }; // gitleaks:allow (synthetic header value, not a credential)

describe('health contract', () => {
  it('liveness returns the contract shape', async () => {
    const res = await inject(await boot(), { method: 'GET', url: '/v1/health/live' });
    expect(res.statusCode).toBe(200);
    expect(LivenessSchema.parse(res.json()).service).toBe('api');
  });

  it('readiness is 200 when every dependency responds and 503 naming the failing one', async () => {
    expect(ReadinessSchema.parse((await inject(await boot(), { method: 'GET', url: '/v1/health/ready' })).json())).toEqual({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok' },
    });
    await app?.close();
    const res = await inject(await boot([check('database', false), check('redis', true)]), { method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(ReadinessSchema.parse(res.json())).toEqual({ status: 'not_ready', checks: { database: 'fail', redis: 'ok' } });
  });

  it('serves exactly the /v1 routes published in packages/contracts (no drift, no local/test route)', async () => {
    const served = [...routeManifest(await boot())].sort();
    expect(served).toEqual(API_ROUTES.map((r) => `${r.method} ${r.path.replace(/\{(\w+)\}/g, ':$1')}`).sort());
    expect(served.some((r) => /__local|test-only/.test(r))).toBe(false);
  });
});

describe('default-deny route policies (route-policy completeness)', () => {
  it('every handler of the deployable controllers declares a policy', () => {
    expect(routePolicyProblems(API_CONTROLLERS)).toEqual([]);
  });

  it('a controller with an undeclared route aborts boot', async () => {
    expect(routePolicyProblems([UndeclaredPolicyController])).toEqual(['UndeclaredPolicyController.open has no route policy']);
    await expect(boot(undefined, [UndeclaredPolicyController])).rejects.toThrow(/default-deny/);
  });

  it('a consumer route without a valid bearer token is 401 (client mode/role headers are ignored)', async () => {
    const a = await boot(undefined, [ProbeController]);
    for (const headers of [
      {},
      { authorization: 'Bearer wva_' + 'A'.repeat(43) },
      { authorization: 'Basic abc' },
      { 'x-wayvro-mode': 'driver', 'x-role': 'admin' },
    ]) {
      const res = await inject(a, { method: 'GET', url: '/v1/test-only/protected', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: 'WAYVRO_E_UNAUTHENTICATED' } });
    }
  });
});

describe('request ids and logging', () => {
  it('echoes a well-formed caller id and replaces junk', async () => {
    const a = await boot();
    expect((await inject(a, { method: 'GET', url: '/v1/health/live', headers: { 'x-request-id': 'req-abcdef12' } })).headers['x-request-id']).toBe(
      'req-abcdef12',
    );
    expect(
      (await inject(a, { method: 'GET', url: '/v1/health/live', headers: { 'x-request-id': '<script>alert(1)</script>' } })).headers['x-request-id'],
    ).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('writes a redacted access log line carrying the request id', async () => {
    logs.clear();
    await inject(await boot(), { method: 'GET', url: '/v1/health/live?phone=03001234567', headers: { 'x-request-id': 'req-logcheck1' } });
    const line = logs
      .text()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l['msg'] === 'request completed');
    expect(line).toMatchObject({ requestId: 'req-logcheck1', route: '/v1/health/live', status: 200 });
    expect(logs.text()).not.toContain('03001234567');
  });
});

describe('baseline security headers', () => {
  it('sends strict security headers and no-store on every response', async () => {
    const res = await inject(await boot(), { method: 'GET', url: '/v1/health/live' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('explicit error mapping (F-04)', () => {
  it('unknown routes -> 404 NOT_FOUND', async () => {
    const res = await inject(await boot(), { method: 'GET', url: '/v1/does-not-exist', headers: { 'x-request-id': 'req-notfound1' } });
    expect(res.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.parse(res.json())).toEqual({ error: { code: 'WAYVRO_E_NOT_FOUND', message: expect.any(String), requestId: 'req-notfound1' } });
  });

  it('malformed JSON -> 400 VALIDATION; wrong content type -> 415; oversized body -> 413', async () => {
    const a = await boot(undefined, [ProbeController]);
    const bad = await inject(a, {
      method: 'POST',
      url: '/v1/test-only/mutation',
      headers: { ...KEY, 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'WAYVRO_E_VALIDATION' } });
    const type = await inject(a, { method: 'POST', url: '/v1/test-only/mutation', headers: { ...KEY, 'content-type': 'application/xml' }, payload: '<a/>' });
    expect(type.statusCode).toBe(415);
    expect(type.json()).toMatchObject({ error: { code: 'WAYVRO_E_UNSUPPORTED_MEDIA_TYPE' } });
    const big = await inject(a, {
      method: 'POST',
      url: '/v1/test-only/mutation',
      headers: { ...KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 'y'.repeat(70 * 1024) }),
    });
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ error: { code: 'WAYVRO_E_PAYLOAD_TOO_LARGE' } });
  });

  it('any other framework 4xx is a programming error: 500 INTERNAL, never a blanket VALIDATION', async () => {
    const a = await boot(undefined, [ProbeController]);
    const forbidden = await inject(a, { method: 'GET', url: '/v1/test-only/forbidden' });
    expect(forbidden.statusCode).toBe(500);
    expect(forbidden.json()).toMatchObject({ error: { code: 'WAYVRO_E_INTERNAL' } });
    const badRequest = await inject(a, { method: 'GET', url: '/v1/test-only/bad-request' });
    expect(badRequest.statusCode).toBe(400);
    expect(badRequest.body).not.toContain('internals');
  });

  it('unexpected failures -> 500 INTERNAL without leaking internals', async () => {
    const throwing: ReadinessCheck = { name: 'database', check: () => Promise.reject(new Error('password=hunter2 at pg.js:1')) };
    const res = await inject(await boot([throwing]), { method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: 'WAYVRO_E_INTERNAL' } });
    expect(res.body).not.toContain('hunter2');
  });
});

describe('Idempotency-Key shape on mutating /v1 routes', () => {
  it('requires a well-formed header and lets one through', async () => {
    const a = await boot(undefined, [ProbeController]);
    expect((await inject(a, { method: 'POST', url: '/v1/test-only/mutation' })).json()).toMatchObject({ error: { code: 'WAYVRO_E_IDEMPOTENCY_KEY_REQUIRED' } });
    expect((await inject(a, { method: 'POST', url: '/v1/test-only/mutation', headers: { 'idempotency-key': 'short' } })).json()).toMatchObject({
      error: { code: 'WAYVRO_E_IDEMPOTENCY_KEY_INVALID' },
    });
    expect((await inject(a, { method: 'POST', url: '/v1/test-only/mutation', headers: KEY })).statusCode).toBe(201);
    expect((await inject(a, { method: 'POST', url: '/v1/nothing-here' })).statusCode).toBe(404);
  });
});
