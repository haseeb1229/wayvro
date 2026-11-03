import { describe, expect, it } from 'vitest';
import { fakeFetch, json, never } from '../test/fake-fetch.js';
import { GeoAdapterConfigError, GeoAdapterError } from './errors.js';
import { callContext, callJson, statusErrorCode } from './http.js';

const URL_WITH_KEY = new URL('https://provider.invalid/v1/thing?key=SECRET-KEY-VALUE&q=private+query');

function ctxWith(responder: Parameters<typeof fakeFetch>[0], maxResponseBytes = 4096) {
  const fake = fakeFetch(responder);
  return { ctx: callContext({ providerKey: 'geo-test', fetchImpl: fake.fetchImpl, maxResponseBytes }, 'GEOCODE'), requests: fake.requests };
}

async function failure(promise: Promise<unknown>): Promise<GeoAdapterError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GeoAdapterError);
  const typed = error as GeoAdapterError;
  // Provider body, URL, key and query never appear in the message.
  expect(typed.message).not.toMatch(/SECRET|private|echo|provider\.invalid/);
  expect(typed.cause).toBeUndefined();
  return typed;
}

describe('callJson', () => {
  it('returns the parsed body, sends Accept and refuses redirects', async () => {
    const { ctx, requests } = ctxWith(() => json({ ok: true }));
    const res = await callJson(ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000));
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(requests[0]?.redirect).toBe('error');
    expect(requests[0]?.headers['accept']).toBe('application/json');
  });

  it('serialises POST bodies as JSON', async () => {
    const { ctx, requests } = ctxWith(() => json({}));
    await callJson(ctx, { method: 'POST', url: URL_WITH_KEY, body: { a: 1 } }, AbortSignal.timeout(1000));
    expect(requests[0]?.body).toEqual({ a: 1 });
    expect(requests[0]?.headers['content-type']).toBe('application/json');
    await callJson(ctx, { method: 'POST', url: URL_WITH_KEY }, AbortSignal.timeout(1000));
    expect(requests[1]?.body).toEqual({});
  });

  it.each([
    [401, 'AUTH'],
    [403, 'AUTH'],
    [429, 'QUOTA'],
    [400, 'CLIENT_ERROR'],
    [404, 'CLIENT_ERROR'],
    [500, 'SERVER_ERROR'],
    [503, 'SERVER_ERROR'],
  ] as const)('maps HTTP %i to %s without echoing the provider body', async (status, code) => {
    const { ctx } = ctxWith(() => json({ error_message: 'echo of private query SECRET' }, status));
    const error = await failure(callJson(ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000)));
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(status);
  });

  it('passes documented error statuses through to the adapter', async () => {
    const { ctx } = ctxWith(() => json({ code: 'NoRoute' }, 400));
    const res = await callJson(ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000), [400]);
    expect(res).toEqual({ status: 400, body: { code: 'NoRoute' } });
  });

  it('classifies an unexpected 3xx as PROVIDER_STATUS', () => {
    expect(statusErrorCode(304)).toBe('PROVIDER_STATUS');
  });

  it('refuses an oversized body announced by content-length', async () => {
    const { ctx } = ctxWith(() => new Response('{}', { status: 200, headers: { 'content-length': '999999' } }));
    expect((await failure(callJson(ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000)))).code).toBe('OVERSIZED_RESPONSE');
  });

  it('refuses an oversized streamed body without content-length', async () => {
    const big = new TextEncoder().encode(JSON.stringify({ pad: 'x'.repeat(10_000) }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < big.length; i += 1000) controller.enqueue(big.subarray(i, i + 1000));
        controller.close();
      },
    });
    const { ctx } = ctxWith(() => new Response(stream, { status: 200 }));
    expect((await failure(callJson(ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000)))).code).toBe('OVERSIZED_RESPONSE');
  });

  it('reports the status-derived code when an error body is oversized', async () => {
    const { ctx } = ctxWith(() => new Response('x'.repeat(10_000), { status: 503 }));
    expect((await failure(callJson(ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000)))).code).toBe('SERVER_ERROR');
  });

  it('maps invalid JSON and invalid UTF-8 to MALFORMED_RESPONSE', async () => {
    const bad = ctxWith(() => new Response('{"a":', { status: 200 }));
    expect((await failure(callJson(bad.ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000)))).code).toBe('MALFORMED_RESPONSE');
    const utf = ctxWith(() => new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 200 }));
    expect((await failure(callJson(utf.ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000)))).code).toBe('MALFORMED_RESPONSE');
  });

  it('rejects a body stream that yields non-byte chunks', async () => {
    const reader = { read: () => Promise.resolve({ done: false, value: 'not bytes' }), cancel: () => Promise.resolve() };
    const odd = { status: 200, headers: new Headers(), body: { getReader: () => reader } } as unknown as Response;
    const { ctx } = ctxWith(() => odd);
    expect((await failure(callJson(ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000)))).code).toBe('MALFORMED_RESPONSE');
  });

  it('rejects an empty body as malformed (no default object)', async () => {
    const { ctx } = ctxWith(() => new Response(null, { status: 200 }));
    expect((await failure(callJson(ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000)))).code).toBe('MALFORMED_RESPONSE');
  });

  it('maps an AbortSignal timeout to TIMEOUT and a cancellation to ABORTED', async () => {
    const slow = ctxWith(() => never());
    const timedOut = await failure(callJson(slow.ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(20)));
    expect(timedOut.code).toBe('TIMEOUT');
    expect(timedOut.countsAsProviderFailure).toBe(true);
    const controller = new AbortController();
    const pending = callJson(slow.ctx, { method: 'GET', url: URL_WITH_KEY }, controller.signal);
    controller.abort();
    const aborted = await failure(pending);
    expect(aborted.code).toBe('ABORTED');
    expect(aborted.countsAsProviderFailure).toBe(false);
  });

  it('refuses to start when the signal is already aborted', async () => {
    const { ctx, requests } = ctxWith(() => json({}));
    const controller = new AbortController();
    controller.abort();
    expect((await failure(callJson(ctx, { method: 'GET', url: URL_WITH_KEY }, controller.signal))).code).toBe('ABORTED');
    expect(requests).toHaveLength(0);
  });

  it('maps a connect failure to NETWORK and a body read failure to NETWORK', async () => {
    const down = ctxWith(() => Promise.reject(new TypeError('fetch failed https://provider.invalid/?key=SECRET')));
    expect((await failure(callJson(down.ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000)))).code).toBe('NETWORK');
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('reset'));
      },
    });
    const reset = ctxWith(() => new Response(broken, { status: 200 }));
    expect((await failure(callJson(reset.ctx, { method: 'GET', url: URL_WITH_KEY }, AbortSignal.timeout(1000)))).code).toBe('NETWORK');
  });
});

describe('callContext', () => {
  it('validates the opaque provider key and the byte cap', () => {
    expect(() => callContext({ providerKey: 'Google' }, 'ROUTE')).toThrow(GeoAdapterConfigError);
    expect(() => callContext({ providerKey: 'geo-a', maxResponseBytes: 10 }, 'ROUTE')).toThrow(GeoAdapterConfigError);
    expect(callContext({ providerKey: 'geo-a' }, 'ROUTE').maxResponseBytes).toBe(1024 * 1024);
  });
});

describe('GeoAdapterError', () => {
  it('marks Wayvro-caused failures as non-breaker failures', () => {
    for (const code of ['CLIENT_ERROR', 'INVALID_INPUT', 'NOT_FOUND', 'NO_ROUTE'] as const) {
      expect(new GeoAdapterError('geo-a', 'ROUTE', code).countsAsProviderFailure).toBe(false);
    }
    for (const code of ['TIMEOUT', 'NETWORK', 'SERVER_ERROR', 'QUOTA', 'MALFORMED_RESPONSE', 'INCOMPLETE_ROUTE', 'AUTH'] as const) {
      expect(new GeoAdapterError('geo-a', 'ROUTE', code).countsAsProviderFailure).toBe(true);
    }
  });
});

describe('callJson: canonical errors, Retry-After and documented error reasons (fix 2026-10-17)', () => {
  const NOW = new Date('2026-10-17T10:00:00Z');
  function clocked(responder: Parameters<typeof fakeFetch>[0], now: () => Date = () => NOW) {
    const fake = fakeFetch(responder);
    return callContext({ providerKey: 'geo-test', fetchImpl: fake.fetchImpl, maxResponseBytes: 4096, now }, 'GEOCODE');
  }
  const get = (ctx: ReturnType<typeof clocked>, extra: { errorReason?: (body: unknown) => 'AUTH' | 'QUOTA' | null } = {}) =>
    failure(callJson(ctx, { method: 'GET', url: URL_WITH_KEY, ...extra }, AbortSignal.timeout(1000)));

  it.each([
    ['30', 30],
    ['Sat, 17 Oct 2026 10:00:45 GMT', 45],
    ['bogus', undefined],
    ['-1', undefined],
    ['999999', 3600],
  ] as const)('429 with Retry-After %j ⇒ QUOTA, retryAfterSeconds %s (server clock injected)', async (header, expected) => {
    const error = await get(clocked(() => json({ error_message: 'echo SECRET' }, 429, { 'retry-after': header })));
    expect(error.kind).toBe('QUOTA');
    expect(error.retryAfterSeconds).toBe(expected);
    expect(error.message).not.toContain(header);
  });

  it('the HTTP-date is read against the injected clock, not the process clock', async () => {
    const later = await get(
      clocked(
        () => json({}, 429, { 'retry-after': 'Sat, 17 Oct 2026 10:00:45 GMT' }),
        () => new Date('2026-10-17T10:00:40Z'),
      ),
    );
    expect(later.retryAfterSeconds).toBe(5);
  });

  it('defaults to the process clock when none is injected', () => {
    const before = Date.now();
    const at = callContext({ providerKey: 'geo-test' }, 'ROUTE').now().getTime();
    expect(at).toBeGreaterThanOrEqual(before);
  });

  it('Retry-After on a non-quota status is ignored', async () => {
    const error = await get(clocked(() => json({}, 503, { 'retry-after': '30' })));
    expect([error.kind, error.retryAfterSeconds]).toEqual(['UPSTREAM', undefined]);
  });

  it('errorReason refines 4xx only, falls back to the status on null, and sees undefined for a non-JSON body', async () => {
    const seen: unknown[] = [];
    const reason = (body: unknown) => {
      seen.push(body);
      return body !== null && typeof body === 'object' && 'auth' in body ? ('AUTH' as const) : null;
    };
    expect(
      (
        await get(
          clocked(() => json({ auth: true }, 400)),
          { errorReason: reason },
        )
      ).kind,
    ).toBe('AUTH');
    expect(
      (
        await get(
          clocked(() => json({ other: true }, 400)),
          { errorReason: reason },
        )
      ).kind,
    ).toBe('REJECTED_INPUT');
    expect(
      (
        await get(
          clocked(() => new Response('<html>', { status: 400 })),
          { errorReason: reason },
        )
      ).kind,
    ).toBe('REJECTED_INPUT');
    expect(seen.at(-1)).toBeUndefined();
    const count = seen.length;
    expect(
      (
        await get(
          clocked(() => json({ auth: true }, 500)),
          { errorReason: reason },
        )
      ).kind,
    ).toBe('UPSTREAM');
    expect(seen).toHaveLength(count);
  });

  it('a reason that reclassifies to QUOTA picks up Retry-After', async () => {
    const error = await get(
      clocked(() => json({}, 403, { 'retry-after': '12' })),
      { errorReason: () => 'QUOTA' },
    );
    expect([error.code, error.kind, error.retryAfterSeconds]).toEqual(['QUOTA', 'QUOTA', 12]);
  });

  it('an error body that cannot be drained keeps the status classification (reason not consulted)', async () => {
    let consulted = false;
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('reset'));
      },
    });
    const error = await get(
      clocked(() => new Response(broken, { status: 401 })),
      {
        errorReason: () => {
          consulted = true;
          return 'QUOTA';
        },
      },
    );
    expect([error.code, error.kind, consulted]).toEqual(['AUTH', 'AUTH', false]);
  });

  it('NETWORK before a status is CONNECT (retryable once by the gateway); after a status it is UPSTREAM', async () => {
    const down = await get(clocked(() => Promise.reject(new TypeError('fetch failed'))));
    expect([down.code, down.kind]).toEqual(['NETWORK', 'CONNECT']);
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('reset'));
      },
    });
    const reset = await get(clocked(() => new Response(broken, { status: 200 })));
    expect([reset.code, reset.kind]).toEqual(['NETWORK', 'UPSTREAM']);
  });
});
