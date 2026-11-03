import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerError,
  DEFAULT_BREAKER_OPTIONS,
  type BreakerAdmission,
  type BreakerHintStore,
  type BreakerKey,
  type BreakerOutcome,
  type BreakerTransition,
} from './circuit-breaker.js';

const A: BreakerKey = { providerKey: 'geo-a', sku: 'AUTOCOMPLETE' };
const B: BreakerKey = { providerKey: 'geo-a', sku: 'ROUTE' };

function harness(hints?: BreakerHintStore) {
  let t = 1_800_000_000_000;
  const transitions: BreakerTransition[] = [];
  const hintErrors: unknown[] = [];
  const breaker = new CircuitBreaker(DEFAULT_BREAKER_OPTIONS, {
    now: () => t,
    ...(hints ? { hints } : {}),
    hintCacheMs: 0,
    onTransition: (x) => transitions.push(x),
    onHintError: (_k, e) => hintErrors.push(e),
  });
  return {
    breaker,
    transitions,
    hintErrors,
    advance: (ms: number) => {
      t += ms;
    },
    now: () => t,
  };
}

async function call(b: CircuitBreaker, key: BreakerKey, outcome: BreakerOutcome): Promise<boolean> {
  const a = await b.admit(key);
  if (!a.allowed) return false;
  a.complete(outcome);
  return true;
}

describe('circuit breaker (BRK-01..05)', () => {
  it('validates its options', () => {
    expect(() => new CircuitBreaker({ ...DEFAULT_BREAKER_OPTIONS, minCalls: 0 })).toThrow(CircuitBreakerError);
    expect(() => new CircuitBreaker({ ...DEFAULT_BREAKER_OPTIONS, failurePercent: 101 })).toThrow(CircuitBreakerError);
  });

  it('BRK-01 opens at >= 50 % failures over >= 20 calls; 19 failing calls stay CLOSED (minimum volume)', async () => {
    const h = harness();
    for (let i = 0; i < 19; i++) expect(await call(h.breaker, A, 'FAILURE')).toBe(true);
    expect(h.breaker.state(A)).toBe('CLOSED');
    expect(await call(h.breaker, A, 'FAILURE')).toBe(true);
    expect(h.breaker.state(A)).toBe('OPEN');
    expect(h.transitions).toEqual([{ key: A, from: 'CLOSED', to: 'OPEN', source: 'local' }]);
  });

  it('BRK-01 a healthy majority keeps it CLOSED; failures older than the window no longer count', async () => {
    const h = harness();
    for (let i = 0; i < 11; i++) await call(h.breaker, A, 'SUCCESS');
    for (let i = 0; i < 9; i++) await call(h.breaker, A, 'FAILURE');
    expect(h.breaker.state(A)).toBe('CLOSED'); // 9/20 = 45 %
    h.advance(61_000);
    for (let i = 0; i < 19; i++) await call(h.breaker, A, 'FAILURE');
    expect(h.breaker.state(A)).toBe('CLOSED'); // the earlier 20 calls left the window: 19 calls < minimum volume
  });

  it('BRK-02 five consecutive timeouts open regardless of volume; any other outcome resets the streak', async () => {
    const h = harness();
    for (let i = 0; i < 4; i++) await call(h.breaker, A, 'TIMEOUT');
    await call(h.breaker, A, 'FAILURE');
    for (let i = 0; i < 4; i++) await call(h.breaker, A, 'TIMEOUT');
    expect(h.breaker.state(A)).toBe('CLOSED');
    await call(h.breaker, A, 'TIMEOUT');
    expect(h.breaker.state(A)).toBe('OPEN');
  });

  it('BRK-03 OPEN refuses for 30 s with zero adapter invocations, then goes HALF_OPEN', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) await call(h.breaker, A, 'TIMEOUT');
    let adapterCalls = 0;
    for (let s = 0; s < 30; s++) {
      const a = await h.breaker.admit(A);
      if (a.allowed) {
        adapterCalls++;
        a.complete('SUCCESS');
      } else expect(a.retryAfterMs).toBe(30_000 - s * 1000);
      h.advance(1000);
    }
    expect(adapterCalls).toBe(0);
    expect(h.breaker.state(A)).toBe('HALF_OPEN');
  });

  it('BRK-04 HALF_OPEN admits 3 probes; all succeed => CLOSED; any failure re-opens', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) await call(h.breaker, A, 'TIMEOUT');
    h.advance(30_000);
    const probes = await Promise.all([h.breaker.admit(A), h.breaker.admit(A), h.breaker.admit(A), h.breaker.admit(A)]);
    expect(probes.map((p) => p.allowed)).toEqual([true, true, true, false]);
    for (const p of probes) if (p.allowed) p.complete('SUCCESS');
    expect(h.breaker.state(A)).toBe('CLOSED');

    for (let i = 0; i < 5; i++) await call(h.breaker, A, 'TIMEOUT');
    h.advance(30_000);
    const first = await h.breaker.admit(A);
    const second = await h.breaker.admit(A);
    if (!first.allowed || !second.allowed) throw new Error('probes expected');
    first.complete('SUCCESS');
    second.complete('FAILURE');
    expect(h.breaker.state(A)).toBe('OPEN');
    expect(h.transitions.map((t) => t.to)).toEqual(['OPEN', 'HALF_OPEN', 'CLOSED', 'OPEN', 'HALF_OPEN', 'OPEN']);
  });

  it('BRK-05 isolation per (provider, sku); NEUTRAL outcomes are not counted', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) await call(h.breaker, A, 'TIMEOUT');
    expect(h.breaker.state(A)).toBe('OPEN');
    expect(h.breaker.state(B)).toBe('CLOSED');
    expect(await call(h.breaker, B, 'SUCCESS')).toBe(true);
    for (let i = 0; i < 40; i++) await call(h.breaker, B, 'NEUTRAL');
    expect(h.breaker.state(B)).toBe('CLOSED');
  });

  it('BRK-05 the Valkey hint opens other processes quickly, and an unavailable hint store never blocks the local breaker', async () => {
    let shared: number | null = null;
    const store: BreakerHintStore = {
      readOpenUntil: () => Promise.resolve(shared),
      writeOpenUntil: (_k, until) => {
        shared = until;
        return Promise.resolve();
      },
    };
    const p1 = harness(store);
    const p2 = harness(store);
    for (let i = 0; i < 5; i++) await call(p1.breaker, A, 'TIMEOUT');
    await Promise.resolve();
    expect(shared).toBe(p1.now() + 30_000);
    const refused = await p2.breaker.admit(A);
    expect(refused.allowed).toBe(false);
    expect(p2.transitions).toEqual([{ key: A, from: 'CLOSED', to: 'OPEN', source: 'hint' }]);

    const broken: BreakerHintStore = {
      readOpenUntil: () => Promise.reject(new Error('valkey down')),
      writeOpenUntil: () => Promise.reject(new Error('valkey down')),
    };
    const p3 = harness(broken);
    expect(await call(p3.breaker, A, 'SUCCESS')).toBe(true);
    for (let i = 0; i < 5; i++) await call(p3.breaker, A, 'TIMEOUT');
    await new Promise((r) => setTimeout(r, 0));
    expect(p3.breaker.state(A)).toBe('OPEN');
    expect((await p3.breaker.admit(A)).allowed).toBe(false);
    expect(p3.hintErrors.length).toBeGreaterThan(0);
  });

  it('ignores a second completion and outcomes from an earlier state period', async () => {
    const h = harness();
    const slow = await h.breaker.admit(A);
    if (!slow.allowed) throw new Error('allowed expected');
    for (let i = 0; i < 5; i++) await call(h.breaker, A, 'TIMEOUT');
    h.advance(30_000);
    expect(h.breaker.state(A)).toBe('HALF_OPEN');
    slow.complete('FAILURE'); // admitted while CLOSED: must not re-open the half-open circuit
    slow.complete('FAILURE');
    expect(h.breaker.state(A)).toBe('HALF_OPEN');
  });
});

describe('PROP-BREAKER', () => {
  type Step = { kind: 'call'; key: 0 | 1; outcome: BreakerOutcome; hold: boolean } | { kind: 'tick'; ms: number } | { kind: 'release' };
  const step: fc.Arbitrary<Step> = fc.oneof(
    {
      weight: 6,
      arbitrary: fc.record({
        kind: fc.constant('call' as const),
        key: fc.constantFrom(0 as const, 1 as const),
        outcome: fc.constantFrom<BreakerOutcome>('SUCCESS', 'FAILURE', 'TIMEOUT', 'NEUTRAL'),
        hold: fc.boolean(),
      }),
    },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('tick' as const), ms: fc.integer({ min: 0, max: 40_000 }) }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('release' as const) }) },
  );

  it('never lets a call through while OPEN, admits at most 3 concurrent probes in HALF_OPEN, and isolates keys', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 300 }), async (steps) => {
        const h = harness();
        const keys = [A, B];
        const held: Array<{ key: number; admission: Extract<BreakerAdmission, { allowed: true }>; outcome: BreakerOutcome }> = [];
        for (const s of steps) {
          if (s.kind === 'tick') h.advance(s.ms);
          else if (s.kind === 'release') {
            const r = held.shift();
            r?.admission.complete(r.outcome);
          } else {
            const key = keys[s.key] ?? A;
            const before = h.breaker.state(key);
            const other = h.breaker.state(keys[1 - s.key] ?? B);
            const a = await h.breaker.admit(key);
            if (before === 'OPEN') expect(a.allowed).toBe(false);
            if (a.allowed) {
              if (s.hold) held.push({ key: s.key, admission: a, outcome: s.outcome });
              else a.complete(s.outcome);
            }
            expect(h.breaker.state(keys[1 - s.key] ?? B)).toBe(other); // isolation
          }
          for (let k = 0; k < keys.length; k++) {
            const key = keys[k] ?? A;
            if (h.breaker.state(key) === 'HALF_OPEN') expect(held.filter((x) => x.key === k && x.admission.probe).length).toBeLessThanOrEqual(3);
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});
