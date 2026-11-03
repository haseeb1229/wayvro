/**
 * Gateway provider-call policy against CANDIDATE-ADAPTER doubles (fix 2026-10-17; no infrastructure). The candidate
 * adapters (`@wayvro/geo-adapters`, server-only, not a dependency of this app) throw `GeoAdapterError`, a subclass of
 * the canonical `GeoProviderError` carrying adapter-specific fields; the double below mirrors that shape (subclass,
 * own name, detailed code/status, a message that would leak if it were logged). These tests prove that the gateway
 * classifies such errors by the canonical `kind` only, cools a SKU down for the provider's Retry-After (bounded) or the
 * default, and counts the breaker exactly as the taxonomy says. Real CircuitBreaker; in-memory budget/Valkey doubles.
 */
import { createLogger } from '@wayvro/observability';
import type { GeoAdapterLicence } from '@wayvro/provider-interfaces';
import { CircuitBreaker, type ValkeyClient } from '@wayvro/server-runtime';
import { captureLogs } from '@wayvro/test-support';
import { describe, expect, it } from 'vitest';
import type { GeoBudgetGuard } from '../src/geo/budgets.js';
import { GeoProviderCaller, ProviderRefused, classifyFailure, newMeter, quotaCooldownSeconds } from '../src/geo/provider-call.js';
import { CANDIDATE_MESSAGE_SENTINEL, CandidateAdapterError } from './geo-candidate-doubles.js';

const LICENCE: GeoAdapterLicence = {
  providerKey: 'geo-c',
  sku: 'ROUTE',
  requiresRenderer: 'any',
  maxCacheTtlSeconds: 0,
  cacheSharedAcrossUsers: false,
  geometryStorable: false,
  attributionCode: null,
  microUsdPerCall: 1,
};

class MemoryValkey {
  readonly ttl = new Map<string, number>();
  exists(key: string): Promise<number> {
    return Promise.resolve(this.ttl.has(key) ? 1 : 0);
  }
  set(key: string, _value: string, mode: string, seconds: number): Promise<'OK'> {
    if (mode !== 'EX' || !Number.isInteger(seconds) || seconds < 1) return Promise.reject(new Error('invalid expire'));
    this.ttl.set(key, seconds);
    return Promise.resolve('OK');
  }
}

function harness(breakerOptions: Partial<ConstructorParameters<typeof CircuitBreaker>[0]> = {}) {
  const logs = captureLogs();
  const log = createLogger({ service: 'api', env: 'test', level: 'info', destination: logs.stream });
  const valkey = new MemoryValkey();
  const budgets = { consume: () => Promise.resolve() } as unknown as GeoBudgetGuard;
  const breaker = new CircuitBreaker({
    minCalls: 3,
    failurePercent: 50,
    windowSeconds: 60,
    consecutiveTimeouts: 3,
    openSeconds: 30,
    halfOpenProbes: 1,
    ...breakerOptions,
  });
  const caller = new GeoProviderCaller(budgets, breaker, valkey as unknown as ValkeyClient, 'wv:t:geo:', log);
  const meter = newMeter();
  let invocations = 0;
  const call = (fail: () => Error, retries = 0) =>
    caller
      .call(
        { licence: LICENCE, deadline: Date.now() + 2000, timeoutMs: 500, retries, meter },
        () => {
          invocations++;
          return Promise.reject(fail());
        },
        (raw) => raw,
      )
      .then(
        () => 'OK',
        (e: unknown) => (e instanceof ProviderRefused ? e.reason : 'OTHER'),
      );
  return {
    call,
    valkey,
    meter,
    logs,
    state: () => breaker.state({ providerKey: 'geo-c', sku: 'ROUTE' }),
    invocations: () => invocations,
    cooldownKey: 'wv:t:geo:quota:geo-c:ROUTE',
  };
}

describe('candidate-adapter failures are classified by canonical kind only', () => {
  it.each([
    ['QUOTA', 'QUOTA', 429],
    ['REJECTED_INPUT', 'CLIENT_ERROR', 400],
    ['MALFORMED', 'MALFORMED_RESPONSE', 200],
    ['CONNECT', 'NETWORK', null],
    ['UPSTREAM', 'SERVER_ERROR', 503],
    ['TIMEOUT', 'TIMEOUT', null],
    ['AUTH', 'AUTH', 400],
    ['NO_RESULT', 'NO_ROUTE', 200],
  ] as const)('%s (adapter code %s, HTTP %s)', (kind, code, status) => {
    expect(classifyFailure(new CandidateAdapterError(kind, code, status), false)).toBe(kind);
    // the gateway's own deadline abort still wins
    expect(classifyFailure(new CandidateAdapterError(kind, code, status), true)).toBe('TIMEOUT');
  });
});

describe('quota cool-down length (FG-05): Retry-After when usable, else the default; bounded 1–3600 s', () => {
  it.each([
    [undefined, 60],
    [7, 7],
    [0, 1],
    [0.4, 1],
    [1.2, 2],
    [3600, 3600],
    [99_999, 3600],
    [-5, 60],
    [Number.NaN, 60],
    [Number.POSITIVE_INFINITY, 60],
  ] as const)('retryAfterSeconds %s ⇒ %i s', (advised, seconds) => {
    expect(quotaCooldownSeconds(advised)).toBe(seconds);
  });
});

describe('GeoProviderCaller with candidate-adapter doubles', () => {
  it('QUOTA with Retry-After 7: the SKU cools down for 7 s, the next call never reaches the adapter, the breaker stays closed', async () => {
    const h = harness();
    expect(await h.call(() => new CandidateAdapterError('QUOTA', 'QUOTA', 429, 7))).toBe('PROVIDER_ERROR');
    expect(h.valkey.ttl.get(h.cooldownKey)).toBe(7);
    expect(await h.call(() => new CandidateAdapterError('QUOTA', 'QUOTA', 429, 7))).toBe('QUOTA_COOLDOWN');
    expect(h.invocations()).toBe(1);
    expect(h.state()).toBe('CLOSED');
    expect(h.logs.text()).toContain('GEO_PROVIDER_QUOTA_EXCEEDED');
    expect(h.logs.text()).not.toContain(CANDIDATE_MESSAGE_SENTINEL);
  });

  it.each([
    ['absent', undefined, 60],
    ['huge', 86_400, 3600],
    ['zero', 0, 1],
  ] as const)('QUOTA with Retry-After %s ⇒ cool-down %i s', async (_, advised, seconds) => {
    const h = harness();
    expect(await h.call(() => new CandidateAdapterError('QUOTA', 'QUOTA', 429, advised))).toBe('PROVIDER_ERROR');
    expect(h.valkey.ttl.get(h.cooldownKey)).toBe(seconds);
  });

  it('repeated QUOTA answers (each after its cool-down) never open the breaker', async () => {
    const h = harness();
    for (let i = 0; i < 6; i++) {
      h.valkey.ttl.clear(); // the cool-down elapsed
      expect(await h.call(() => new CandidateAdapterError('QUOTA', 'QUOTA', 429, 1))).toBe('PROVIDER_ERROR');
    }
    expect(h.state()).toBe('CLOSED');
    expect(h.meter.errors).toBe(6);
  });

  it('AUTH (e.g. Google 400 API_KEY_INVALID) counts as a provider failure: not retried, no cool-down, breaker opens', async () => {
    const h = harness();
    for (let i = 0; i < 3; i++) expect(await h.call(() => new CandidateAdapterError('AUTH', 'AUTH', 400), 1)).toBe('PROVIDER_ERROR');
    expect(h.invocations()).toBe(3);
    expect(h.valkey.ttl.size).toBe(0);
    expect(h.state()).toBe('OPEN');
    expect(await h.call(() => new CandidateAdapterError('AUTH', 'AUTH', 400))).toBe('BREAKER_OPEN');
    expect(h.invocations()).toBe(3);
    const lines = h.logs
      .text()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { signal?: string; failure?: string; level?: unknown });
    const auth = lines.filter((l) => l.signal === 'GEO_PROVIDER_ERROR' && l.failure === 'AUTH');
    expect(auth).toHaveLength(3);
    expect(h.logs.text()).not.toContain(CANDIDATE_MESSAGE_SENTINEL);
  });

  it('NO_RESULT (no route / place gone) is the provider answer: own refusal, not retried, no error count, breaker stays closed', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) expect(await h.call(() => new CandidateAdapterError('NO_RESULT', 'NO_ROUTE', 200), 1)).toBe('NO_RESULT');
    expect(h.invocations()).toBe(5);
    expect(h.meter.errors).toBe(0);
    expect(h.state()).toBe('CLOSED');
    expect(h.valkey.ttl.size).toBe(0);
  });

  it('REJECTED_INPUT is neutral and logged as a contract error; MALFORMED and UPSTREAM count; only CONNECT is retried', async () => {
    const neutral = harness();
    for (let i = 0; i < 4; i++) expect(await neutral.call(() => new CandidateAdapterError('REJECTED_INPUT', 'CLIENT_ERROR', 400), 1)).toBe('REJECTED_INPUT');
    expect(neutral.invocations()).toBe(4);
    expect(neutral.state()).toBe('CLOSED');
    expect(neutral.logs.text()).toContain('GEO_ADAPTER_CONTRACT_ERROR');

    const malformed = harness();
    for (let i = 0; i < 3; i++) expect(await malformed.call(() => new CandidateAdapterError('MALFORMED', 'OVERSIZED_RESPONSE', 200), 1)).toBe('PROVIDER_ERROR');
    expect(malformed.invocations()).toBe(3);
    expect(malformed.state()).toBe('OPEN');

    const upstream = harness();
    expect(await upstream.call(() => new CandidateAdapterError('UPSTREAM', 'SERVER_ERROR', 503), 1)).toBe('PROVIDER_ERROR');
    expect(upstream.invocations()).toBe(1);

    const connect = harness({ minCalls: 10 });
    expect(await connect.call(() => new CandidateAdapterError('CONNECT', 'NETWORK', null), 1)).toBe('PROVIDER_ERROR');
    expect(connect.invocations()).toBe(2);
  });

  it('a Retry-After on a non-QUOTA failure never starts a cool-down', async () => {
    const h = harness();
    expect(await h.call(() => new CandidateAdapterError('UPSTREAM', 'SERVER_ERROR', 503, 30))).toBe('PROVIDER_ERROR');
    expect(h.valkey.ttl.size).toBe(0);
  });
});
