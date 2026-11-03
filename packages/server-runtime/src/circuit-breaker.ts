/**
 * In-house circuit breaker (Phase 3 P3.2; docs/phase3/PHASE3_ARCHITECTURE.md §5.4; ADR-047 — no new dependency).
 *
 * One breaker state per (providerKey, sku), per process:
 *   CLOSED     calls flow; outcomes are counted in a sliding window of one-second buckets. The breaker OPENS when
 *              failures reach `failurePercent` % of at least `minCalls` calls inside the window, OR after
 *              `consecutiveTimeouts` timeouts in a row (regardless of volume).
 *   OPEN       every call is refused without reaching the provider until `openMs` has elapsed.
 *   HALF_OPEN  at most `halfOpenProbes` probe calls are admitted; when all of them succeed the breaker CLOSES, any
 *              failure re-OPENS it. Further calls are refused while the probes are in flight.
 *
 * Outcomes: SUCCESS, FAILURE (5xx, connect error, malformed payload…), TIMEOUT (a failure that also feeds the
 * consecutive-timeout rule) and NEUTRAL (the provider answered but the call says nothing about its health — e.g. a 4xx
 * caused by our own validated input, or a provider quota answer — it is not counted in the window).
 *
 * The clock is injected. An optional hint store (Valkey key `wv:geo:breaker:<pk>:<sku>` in the API) shares an
 * OPEN-until instant so that other processes open quickly; it is a HINT only: reading or writing it may fail and the
 * process-local breaker keeps enforcing on its own. Hint failures are reported through `onHintError`, transitions
 * through `onTransition` (the caller turns them into log signals).
 */

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type BreakerOutcome = 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'NEUTRAL';

export interface BreakerKey {
  readonly providerKey: string;
  readonly sku: string;
}

export interface CircuitBreakerOptions {
  readonly minCalls: number;
  readonly failurePercent: number;
  readonly windowSeconds: number;
  readonly consecutiveTimeouts: number;
  readonly openSeconds: number;
  readonly halfOpenProbes: number;
}

export const DEFAULT_BREAKER_OPTIONS: CircuitBreakerOptions = Object.freeze({
  minCalls: 20,
  failurePercent: 50,
  windowSeconds: 60,
  consecutiveTimeouts: 5,
  openSeconds: 30,
  halfOpenProbes: 3,
});

export interface BreakerTransition {
  readonly key: BreakerKey;
  readonly from: BreakerState;
  readonly to: BreakerState;
  /** `local` = decided by this process; `hint` = adopted from the shared hint written by another process. */
  readonly source: 'local' | 'hint';
}

/** Shared OPEN-until hint (epoch milliseconds). Implementations may throw; the breaker never depends on them. */
export interface BreakerHintStore {
  readOpenUntil(key: BreakerKey): Promise<number | null>;
  writeOpenUntil(key: BreakerKey, openUntilMs: number): Promise<void>;
}

export interface CircuitBreakerDeps {
  readonly now?: () => number;
  readonly hints?: BreakerHintStore;
  /** How long a hint read is reused before Valkey is asked again (bounds the extra round trips). */
  readonly hintCacheMs?: number;
  readonly onTransition?: (t: BreakerTransition) => void;
  readonly onHintError?: (key: BreakerKey, error: unknown) => void;
}

export type BreakerAdmission =
  { readonly allowed: true; readonly probe: boolean; complete(outcome: BreakerOutcome): void } | { readonly allowed: false; readonly retryAfterMs: number };

interface Bucket {
  second: number;
  calls: number;
  failures: number;
}

interface Circuit {
  state: BreakerState;
  generation: number;
  buckets: Bucket[];
  consecutiveTimeouts: number;
  openUntil: number;
  probesIssued: number;
  probesSucceeded: number;
  hintCheckedAt: number;
  hintOpenUntil: number | null;
}

export class CircuitBreakerError extends Error {
  override readonly name = 'CircuitBreakerError';
}

function validate(o: CircuitBreakerOptions): void {
  const ints: Array<[string, number, number, number]> = [
    ['minCalls', o.minCalls, 1, 1_000_000],
    ['failurePercent', o.failurePercent, 1, 100],
    ['windowSeconds', o.windowSeconds, 1, 3600],
    ['consecutiveTimeouts', o.consecutiveTimeouts, 1, 10_000],
    ['openSeconds', o.openSeconds, 1, 86_400],
    ['halfOpenProbes', o.halfOpenProbes, 1, 1000],
  ];
  for (const [name, value, min, max] of ints) {
    if (!Number.isInteger(value) || value < min || value > max) throw new CircuitBreakerError(`${name} must be an integer ${String(min)}..${String(max)}`);
  }
}

export class CircuitBreaker {
  private readonly circuits = new Map<string, Circuit>();
  private readonly now: () => number;
  private readonly hintCacheMs: number;

  constructor(
    private readonly options: CircuitBreakerOptions = DEFAULT_BREAKER_OPTIONS,
    private readonly deps: CircuitBreakerDeps = {},
  ) {
    validate(options);
    this.now = deps.now ?? Date.now;
    this.hintCacheMs = deps.hintCacheMs ?? 1000;
  }

  /** Current state (lazily moving OPEN → HALF_OPEN once the open period has elapsed). */
  state(key: BreakerKey): BreakerState {
    const c = this.circuit(key);
    this.advance(key, c, this.now());
    return c.state;
  }

  /**
   * Asks to make one provider call. A refused admission never reaches the provider; an allowed one MUST be completed
   * exactly once with its outcome (a second completion is ignored).
   */
  async admit(key: BreakerKey): Promise<BreakerAdmission> {
    const c = this.circuit(key);
    await this.consultHint(key, c);
    const now = this.now();
    this.advance(key, c, now);
    if (c.state === 'OPEN') return { allowed: false, retryAfterMs: Math.max(0, c.openUntil - now) };
    if (c.state === 'HALF_OPEN') {
      if (c.probesIssued >= this.options.halfOpenProbes) return { allowed: false, retryAfterMs: 1000 };
      c.probesIssued++;
      return this.permit(key, c, true);
    }
    return this.permit(key, c, false);
  }

  private permit(key: BreakerKey, c: Circuit, probe: boolean): BreakerAdmission {
    const generation = c.generation;
    let done = false;
    return {
      allowed: true,
      probe,
      complete: (outcome) => {
        if (done) return;
        done = true;
        // An outcome that arrives after the circuit changed state belongs to an earlier period: it is not counted.
        if (c.generation !== generation) return;
        this.record(key, c, outcome, probe);
      },
    };
  }

  private record(key: BreakerKey, c: Circuit, outcome: BreakerOutcome, probe: boolean): void {
    const now = this.now();
    if (probe && c.state === 'HALF_OPEN') {
      if (outcome === 'FAILURE' || outcome === 'TIMEOUT') {
        this.open(key, c, now, 'local');
        return;
      }
      c.probesSucceeded++;
      if (c.probesSucceeded >= this.options.halfOpenProbes) this.transition(key, c, 'CLOSED', 'local');
      return;
    }
    if (c.state !== 'CLOSED' || outcome === 'NEUTRAL') return;
    const bucket = this.bucket(c, now);
    bucket.calls++;
    if (outcome === 'FAILURE' || outcome === 'TIMEOUT') bucket.failures++;
    c.consecutiveTimeouts = outcome === 'TIMEOUT' ? c.consecutiveTimeouts + 1 : 0;
    const { calls, failures } = this.totals(c, now);
    const ratioTripped = calls >= this.options.minCalls && failures * 100 >= this.options.failurePercent * calls;
    if (ratioTripped || c.consecutiveTimeouts >= this.options.consecutiveTimeouts) this.open(key, c, now, 'local');
  }

  private open(key: BreakerKey, c: Circuit, now: number, source: 'local' | 'hint', until: number = now + this.options.openSeconds * 1000): void {
    c.openUntil = until;
    this.transition(key, c, 'OPEN', source);
    if (source === 'local' && this.deps.hints) {
      this.deps.hints.writeOpenUntil(key, until).catch((e: unknown) => {
        this.deps.onHintError?.(key, e);
      });
    }
  }

  private transition(key: BreakerKey, c: Circuit, to: BreakerState, source: 'local' | 'hint'): void {
    const from = c.state;
    c.state = to;
    c.generation++;
    c.probesIssued = 0;
    c.probesSucceeded = 0;
    if (to !== 'OPEN') c.openUntil = 0;
    if (to === 'CLOSED') {
      c.buckets = [];
      c.consecutiveTimeouts = 0;
    }
    if (from !== to) this.deps.onTransition?.({ key, from, to, source });
  }

  private advance(key: BreakerKey, c: Circuit, now: number): void {
    if (c.state === 'OPEN' && now >= c.openUntil) this.transition(key, c, 'HALF_OPEN', 'local');
  }

  /** Adopts another process's OPEN decision (CLOSED circuits only); hint failures never block a call. */
  private async consultHint(key: BreakerKey, c: Circuit): Promise<void> {
    const hints = this.deps.hints;
    if (!hints || c.state !== 'CLOSED') return;
    const now = this.now();
    if (now - c.hintCheckedAt >= this.hintCacheMs) {
      c.hintCheckedAt = now;
      try {
        c.hintOpenUntil = await hints.readOpenUntil(key);
      } catch (e) {
        c.hintOpenUntil = null;
        this.deps.onHintError?.(key, e);
      }
    }
    this.adoptHint(key, c);
  }

  /** Separate step: the circuit may have changed state while the hint was being read. */
  private adoptHint(key: BreakerKey, c: Circuit): void {
    const until = c.hintOpenUntil;
    const now = this.now();
    if (c.state === 'CLOSED' && until !== null && until > now) this.open(key, c, now, 'hint', until);
  }

  private bucket(c: Circuit, now: number): Bucket {
    const second = Math.floor(now / 1000);
    const last = c.buckets[c.buckets.length - 1];
    if (last?.second === second) return last;
    const fresh = { second, calls: 0, failures: 0 };
    c.buckets.push(fresh);
    this.prune(c, now);
    return fresh;
  }

  private prune(c: Circuit, now: number): void {
    const oldest = Math.floor(now / 1000) - this.options.windowSeconds + 1;
    while (c.buckets.length > 0 && (c.buckets[0]?.second ?? oldest) < oldest) c.buckets.shift();
  }

  private totals(c: Circuit, now: number): { calls: number; failures: number } {
    this.prune(c, now);
    let calls = 0;
    let failures = 0;
    for (const b of c.buckets) {
      calls += b.calls;
      failures += b.failures;
    }
    return { calls, failures };
  }

  private circuit(key: BreakerKey): Circuit {
    const id = `${key.providerKey}\u0000${key.sku}`;
    let c = this.circuits.get(id);
    if (!c) {
      c = {
        state: 'CLOSED',
        generation: 0,
        buckets: [],
        consecutiveTimeouts: 0,
        openUntil: 0,
        probesIssued: 0,
        probesSucceeded: 0,
        hintCheckedAt: Number.NEGATIVE_INFINITY,
        hintOpenUntil: null,
      };
      this.circuits.set(id, c);
    }
    return c;
  }
}
