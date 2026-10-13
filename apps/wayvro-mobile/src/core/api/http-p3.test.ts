import { describe, expect, it } from 'vitest';
import { errorBody, jsonResponse } from '../../__mocks__/fixtures';
import { ApiError, errorFromResponse, UI_ERROR_KINDS } from './errors';
import { isRequestCancelled, RequestCancelledError, send, type HttpDeps, type HttpObservation } from './http';

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

/** A fetch that never answers until its signal aborts (timeouts and caller cancellation). */
const hanging = (_url: string, init: RequestInit): Promise<Response> =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });

describe('P3.5 transport additions', () => {
  it('sends the app-compatibility headers on every request, including unauthenticated ones', async () => {
    const d = deps(() => Promise.resolve(jsonResponse(204, undefined)), {
      appHeaders: { 'x-wayvro-platform': 'ANDROID', 'x-wayvro-app-version': '0.0.0', 'x-wayvro-app-build': '1' },
    });
    await send(d, { method: 'GET', path: '/v1/app/config', schema: null });
    await send(d, { method: 'POST', path: '/v1/x', body: {}, idempotencyKey: 'k'.repeat(32), accessToken: 'tok', schema: null });
    expect(d.calls).toHaveLength(2);
    for (const [, init] of d.calls)
      expect(headersOf(init)).toMatchObject({ 'x-wayvro-platform': 'ANDROID', 'x-wayvro-app-version': '0.0.0', 'x-wayvro-app-build': '1' });
  });

  it('a caller abort rejects with RequestCancelledError, is never retried and is observed as "cancelled"', async () => {
    const observed: HttpObservation['outcome'][] = [];
    const controller = new AbortController();
    const d = deps(hanging, { observe: (o) => observed.push(o.outcome) });
    const pending = send(d, { method: 'GET', path: '/v1/geo/autocomplete', signal: controller.signal, retry: 'idempotent', schema: null });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(isRequestCancelled(error)).toBe(true);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(d.calls).toHaveLength(1);
    expect(observed).toEqual(['cancelled']);
    // An already-aborted signal never reaches the network.
    await expect(send(d, { method: 'GET', path: '/v1/x', signal: controller.signal, schema: null })).rejects.toBeInstanceOf(RequestCancelledError);
    expect(d.calls).toHaveLength(1);
  });

  it('observes timing and outcome only: response (with the mapped error), network failure and timeout', async () => {
    const observed: { outcome: string; kind: string | null }[] = [];
    const observe = (o: HttpObservation) => observed.push({ outcome: o.outcome, kind: o.error?.kind ?? null });
    await send(
      deps(() => Promise.resolve(jsonResponse(204, undefined)), { observe }),
      { method: 'GET', path: '/v1/a', schema: null },
    );
    await send(
      deps(() => Promise.resolve(jsonResponse(426, errorBody('WAYVRO_E_APP_UPDATE_REQUIRED'))), { observe }),
      { method: 'GET', path: '/v1/b', schema: null },
    ).catch(() => undefined);
    await send(
      deps(() => Promise.reject(new Error('dns')), { observe }),
      { method: 'GET', path: '/v1/c', schema: null },
    ).catch(() => undefined);
    await send(deps(hanging, { observe, timeoutMs: 5 }), { method: 'GET', path: '/v1/d', schema: null }).catch(() => undefined);
    expect(observed).toEqual([
      { outcome: 'response', kind: null },
      { outcome: 'response', kind: 'update-required' },
      { outcome: 'network', kind: 'offline' },
      { outcome: 'timeout', kind: 'offline' },
    ]);
  });

  it('measures the duration of each attempt with the injected clock', async () => {
    let now = 0;
    const durations: number[] = [];
    const d = deps(
      () => {
        now += 4500;
        return Promise.resolve(jsonResponse(204, undefined));
      },
      { now: () => now, observe: (o) => durations.push(o.durationMs) },
    );
    await send(d, { method: 'GET', path: '/v1/a', schema: null });
    expect(durations).toEqual([4500]);
  });
});

describe('P3.5 error kinds (WAYVRO_E_SERVICE_AREA / APP_UPDATE_REQUIRED / MAINTENANCE)', () => {
  it('declares the three new UI kinds', () => {
    expect(UI_ERROR_KINDS).toEqual(expect.arrayContaining(['service-area', 'update-required', 'maintenance']));
  });

  it('maps 422 SERVICE_AREA with its reason codes and next opening instant', () => {
    const area = errorFromResponse(422, {
      error: {
        code: 'WAYVRO_E_SERVICE_AREA',
        message: 'server text',
        requestId: 'req_synthetic_1',
        details: { reasonCodes: ['OUTSIDE_SERVICE_HOURS'], nextOpenAt: '2026-10-14T01:00:00.000Z' },
      },
    });
    expect(area.kind).toBe('service-area');
    expect(area.detail.reasonCodes).toEqual(['OUTSIDE_SERVICE_HOURS']);
    expect(area.detail.nextOpenAt).toBe('2026-10-14T01:00:00.000Z');
    expect(area.message).not.toMatch(/server text/);
    expect(errorFromResponse(422, errorBody('WAYVRO_E_VALIDATION')).detail.nextOpenAt).toBeNull();
  });

  it('maps 426 (also without a valid envelope) to update-required and 503 MAINTENANCE to maintenance', () => {
    expect(errorFromResponse(426, errorBody('WAYVRO_E_APP_UPDATE_REQUIRED')).kind).toBe('update-required');
    expect(errorFromResponse(426, '<html>proxy</html>').kind).toBe('update-required');
    expect(errorFromResponse(503, errorBody('WAYVRO_E_MAINTENANCE', { retryAfterSeconds: 2 })).kind).toBe('maintenance');
    expect(errorFromResponse(503, errorBody('WAYVRO_E_DEPENDENCY_UNAVAILABLE')).kind).toBe('unavailable');
  });

  it('never auto-retries planned maintenance (the app-policy gate owns that schedule)', async () => {
    const d = deps(() => Promise.resolve(jsonResponse(503, errorBody('WAYVRO_E_MAINTENANCE', { retryAfterSeconds: 2 }))));
    await send(d, { method: 'GET', path: '/v1/x', retry: 'idempotent', schema: null }).catch(() => undefined);
    expect(d.calls).toHaveLength(1);
  });
});
