import { AccountStateSchema } from '@wayvro/contracts';
import { describe, expect, it, vi } from 'vitest';
import { accountState, errorBody, jsonResponse } from '../../__mocks__/fixtures';
import { ApiError, errorFromResponse } from './errors';
import { send, type HttpDeps } from './http';
import { backoffDelayMs } from './retry';

type FetchArgs = [string, RequestInit];

function deps(fetchFn: (url: string, init: RequestInit) => Promise<Response>, extra: Partial<HttpDeps> = {}): HttpDeps & { calls: FetchArgs[] } {
  const calls: FetchArgs[] = [];
  return {
    baseUrl: 'https://api.example.test',
    fetchFn: ((url: string, init: RequestInit) => {
      calls.push([url, init]);
      return fetchFn(url, init);
    }) as typeof fetch,
    newRequestId: () => 'req_synthetic_0001',
    clock: { offsetMs: 0 },
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    calls,
    ...extra,
  };
}

const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe('http send', () => {
  it('injects request id, bearer token, idempotency key and JSON content type', async () => {
    const d = deps(() => Promise.resolve(jsonResponse(200, accountState())));
    await send(d, { method: 'POST', path: '/v1/x', body: { a: 1 }, idempotencyKey: 'k'.repeat(32), accessToken: 'tok', schema: AccountStateSchema });
    const [url, init] = d.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/x');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(headersOf(init)).toMatchObject({
      'x-request-id': 'req_synthetic_0001',
      authorization: 'Bearer tok',
      'idempotency-key': 'k'.repeat(32),
      'content-type': 'application/json',
      accept: 'application/json',
    });
  });

  it('sends no body or content type for GET/DELETE and encodes query strings', async () => {
    const d = deps(() => Promise.resolve(jsonResponse(204, undefined)));
    await send(d, { method: 'DELETE', path: '/v1/y', query: { locale: 'ur', q: 'a b' }, schema: null });
    const [url, init] = d.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/y?locale=ur&q=a%20b');
    expect(init.body).toBeUndefined();
    expect(headersOf(init)['content-type']).toBeUndefined();
    expect(headersOf(init)['authorization']).toBeUndefined();
  });

  it('validates success bodies against the contract schema and refuses violations', async () => {
    const d = deps(() => Promise.resolve(jsonResponse(200, { account: { id: 'not-a-uuid' } })));
    const error = await send(d, { method: 'GET', path: '/v1/account/state', schema: AccountStateSchema }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('unknown');
    expect((error as ApiError).message).toBe('wayvro-api-error:unknown');
  });

  it('reports idempotent replays', async () => {
    const d = deps(() => Promise.resolve(jsonResponse(200, accountState(), { 'idempotent-replayed': 'true' })));
    const result = await send(d, { method: 'GET', path: '/v1/account/state', schema: AccountStateSchema });
    expect(result.replayed).toBe(true);
  });

  it('maps error envelopes to UI kinds without exposing the server message', () => {
    const cases: [number, string, string][] = [
      [429, 'WAYVRO_E_RATE_LIMITED', 'rate-limited'],
      [401, 'WAYVRO_E_UNAUTHENTICATED', 'session-expired'],
      [400, 'WAYVRO_E_VALIDATION', 'validation'],
      [409, 'WAYVRO_E_CONFLICT', 'conflict'],
      [409, 'WAYVRO_E_IDEMPOTENCY_CONFLICT', 'conflict'],
      [403, 'WAYVRO_E_STEP_UP_REQUIRED', 'step-up-required'],
      [503, 'WAYVRO_E_DEPENDENCY_UNAVAILABLE', 'unavailable'],
      [500, 'WAYVRO_E_INTERNAL', 'unavailable'],
      [403, 'WAYVRO_E_FORBIDDEN', 'unknown'],
      [403, 'WAYVRO_E_ACCOUNT_RESTRICTED', 'restricted'],
      [403, 'WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED', 'required-action'],
      [403, 'WAYVRO_E_AGE_DECLARATION_REQUIRED', 'required-action'],
      [404, 'WAYVRO_E_FEATURE_DISABLED', 'feature-disabled'],
      // P2.10: an OIDC 401 is not an expired session (the user is offered the phone instead)
      [401, 'WAYVRO_E_OIDC_NOT_LINKED', 'validation'],
      [409, 'WAYVRO_E_OIDC_LINK_CONFLICT', 'conflict'],
    ];
    for (const [status, code, kind] of cases) {
      const error = errorFromResponse(status, errorBody(code, { retryAfterSeconds: 7 }));
      expect(error.kind, code).toBe(kind);
      expect(error.code).toBe(code);
      expect(error.detail.retryAfterSeconds).toBe(7);
      expect(error.message).not.toContain('server text');
    }
  });

  it('carries restriction reason codes for localisation, never as the message', () => {
    const error = errorFromResponse(403, {
      error: { code: 'WAYVRO_E_ACCOUNT_RESTRICTED', message: 'raw', requestId: 'req_synthetic_1', details: { reasonCodes: ['SYNTHETIC_REASON'] } },
    });
    expect(error.kind).toBe('restricted');
    expect(error.detail.reasonCodes).toEqual(['SYNTHETIC_REASON']);
    expect(error.message).toBe('wayvro-api-error:restricted');
  });

  it('falls back to the HTTP status for non-envelope bodies and unknown codes', () => {
    expect(errorFromResponse(502, '<html>bad gateway</html>').kind).toBe('unavailable');
    expect(errorFromResponse(502, undefined).detail.transient).toBe(true);
    expect(errorFromResponse(429, null).kind).toBe('rate-limited');
    expect(errorFromResponse(401, errorBody('WAYVRO_E_SOMETHING_NEW')).kind).toBe('session-expired');
    expect(errorFromResponse(418, {}).kind).toBe('unknown');
  });

  it('turns network failures into a transient offline error', async () => {
    const d = deps(() => Promise.reject(new TypeError('Network request failed')));
    const error = (await send(d, { method: 'GET', path: '/v1/x', schema: null }).catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('offline');
    expect(error.detail.transient).toBe(true);
  });

  it('aborts a request that exceeds the timeout', async () => {
    vi.useFakeTimers();
    try {
      const d = deps(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
        { timeoutMs: 1000 },
      );
      const pending = send(d, { method: 'GET', path: '/v1/slow', schema: null }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1001);
      const error = (await pending) as ApiError;
      expect(error.kind).toBe('offline');
      expect(d.calls[0]![1].signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries an idempotent request with the same key and request id after a lost response, bounded', async () => {
    let n = 0;
    const d = deps(() => {
      n += 1;
      return n < 3 ? Promise.reject(new TypeError('lost')) : Promise.resolve(jsonResponse(200, accountState()));
    });
    await send(d, { method: 'POST', path: '/v1/x', body: {}, idempotencyKey: 'K'.repeat(20), retry: 'idempotent', schema: AccountStateSchema });
    expect(d.calls).toHaveLength(3);
    expect(new Set(d.calls.map(([, init]) => headersOf(init)['idempotency-key']))).toEqual(new Set(['K'.repeat(20)]));
    expect(new Set(d.calls.map(([, init]) => headersOf(init)['x-request-id'])).size).toBe(1);

    const always = deps(() => Promise.reject(new TypeError('down')));
    await expect(
      send(always, { method: 'POST', path: '/v1/x', body: {}, idempotencyKey: 'K'.repeat(20), retry: 'idempotent', schema: null }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(always.calls).toHaveLength(3);
  });

  it('never retries non-idempotent requests, 4xx answers or 503 without a short Retry-After', async () => {
    const once = deps(() => Promise.reject(new TypeError('lost')));
    await send(once, { method: 'POST', path: '/v1/x', body: {}, schema: null }).catch(() => undefined);
    expect(once.calls).toHaveLength(1);

    const rateLimited = deps(() => Promise.resolve(jsonResponse(429, errorBody('WAYVRO_E_RATE_LIMITED', { retryAfterSeconds: 1 }))));
    await send(rateLimited, { method: 'POST', path: '/v1/x', body: {}, idempotencyKey: 'K'.repeat(20), retry: 'idempotent', schema: null }).catch(
      () => undefined,
    );
    expect(rateLimited.calls).toHaveLength(1);

    const longWait = deps(() => Promise.resolve(jsonResponse(503, errorBody('WAYVRO_E_DEPENDENCY_UNAVAILABLE', { retryAfterSeconds: 120 }))));
    await send(longWait, { method: 'GET', path: '/v1/x', retry: 'idempotent', schema: null }).catch(() => undefined);
    expect(longWait.calls).toHaveLength(1);

    const shortWait = deps(() => Promise.resolve(jsonResponse(503, errorBody('WAYVRO_E_DEPENDENCY_UNAVAILABLE', { retryAfterSeconds: 2 }))));
    await send(shortWait, { method: 'GET', path: '/v1/x', retry: 'idempotent', schema: null }).catch(() => undefined);
    expect(shortWait.calls).toHaveLength(3);
  });

  it('refuses to retry a mutation that has no idempotency key', async () => {
    const d = deps(() => Promise.resolve(jsonResponse(200, {})));
    await expect(send(d, { method: 'POST', path: '/v1/x', body: {}, retry: 'idempotent', schema: null })).rejects.toThrow('idempotency key');
    expect(d.calls).toHaveLength(0);
  });

  it('records the server clock offset from the Date header', async () => {
    const d = deps(() => Promise.resolve(jsonResponse(200, accountState(), { date: 'Sun, 11 Oct 2026 10:00:30 GMT' })), {
      now: () => Date.parse('2026-10-11T10:00:00Z'),
    });
    await send(d, { method: 'GET', path: '/v1/account/state', schema: AccountStateSchema });
    expect(d.clock.offsetMs).toBe(30_000);
  });
});

describe('backoff', () => {
  it('uses Retry-After when given (capped) and capped full-jitter exponential backoff otherwise', () => {
    expect(backoffDelayMs(1, 3, () => 0.9)).toBe(3000);
    expect(backoffDelayMs(1, 600, () => 0.9)).toBe(10_000);
    expect(backoffDelayMs(1, null, () => 0.999)).toBeLessThan(500);
    expect(backoffDelayMs(10, null, () => 0.999)).toBeLessThan(8000);
    expect(backoffDelayMs(3, null, () => 0)).toBe(0);
  });
});
