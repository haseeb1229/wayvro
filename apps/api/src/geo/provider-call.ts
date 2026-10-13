/**
 * One metered, guarded provider call (Phase 3 P3.2; docs/phase3/PHASE3_ARCHITECTURE.md §5.2 steps 5–7, §5.4, §5.4a):
 * budget → quota cool-down → circuit breaker → adapter under a TOTAL-time timeout bounded by the request deadline.
 *
 *  - The timeout aborts the adapter's signal AND stops waiting (a slow-drip or signal-ignoring adapter cannot hold the
 *    request past its deadline; a late result is discarded).
 *  - Retry: only after a CONNECT failure, only when `retries` allows it and the remaining deadline still covers a full
 *    SKU timeout; never after a timeout, 5xx, quota or malformed answer. Each attempt consumes budget (spend is
 *    bounded per attempt, not per request).
 *  - Breaker accounting: timeout / connect / 5xx / malformed = failure; provider quota (429-equivalent) and rejection of
 *    our own validated input = NEUTRAL (quota opens a per-SKU cool-down instead; FG-05).
 *  - Errors are classified by type only: an adapter message (which may echo the query) is never logged or returned.
 */
import { GeoProviderError, type GeoAdapterLicence, type GeoProviderFailure } from '@wayvro/provider-interfaces';
import type { Logger } from '@wayvro/observability';
import { LimiterUnavailableError, type CircuitBreaker, type ValkeyClient as Redis } from '@wayvro/server-runtime';
import { BudgetRefusal, type GeoBudgetGuard } from './budgets.js';

export type ProviderRefusal =
  | 'BUDGET_EXHAUSTED'
  | 'BUDGET_MISSING'
  | 'BREAKER_OPEN'
  | 'QUOTA_COOLDOWN'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'REJECTED_INPUT'
  | 'DEADLINE'
  | 'LIMITER_UNAVAILABLE';

export class ProviderRefused extends Error {
  override readonly name = 'ProviderRefused';
  constructor(
    readonly reason: ProviderRefusal,
    options: { cause?: unknown } = {},
  ) {
    super(`geo provider call refused: ${reason}`, options);
  }
}

/** Per-request usage tally (feeds the hourly counters; never carries text, coordinates or identities). */
export interface Meter {
  calls: number;
  cacheHits: number;
  errors: number;
  timeouts: number;
  budgetRefusals: number;
  costMicroUsd: number;
}

export const newMeter = (): Meter => ({ calls: 0, cacheHits: 0, errors: 0, timeouts: 0, budgetRefusals: 0, costMicroUsd: 0 });

export interface CallOptions {
  readonly licence: GeoAdapterLicence;
  /** Absolute deadline (epoch ms) of the whole request. */
  readonly deadline: number;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly meter: Meter;
}

const CONNECT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

function errorCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const own = (e as { code?: unknown }).code;
  if (typeof own === 'string') return own;
  const cause = (e as { cause?: unknown }).cause;
  return typeof cause === 'object' && cause !== null && typeof (cause as { code?: unknown }).code === 'string' ? (cause as { code: string }).code : undefined;
}

/** @internal exported for unit tests. */
export function classifyFailure(e: unknown, abortedByUs: boolean): GeoProviderFailure {
  if (abortedByUs) return 'TIMEOUT';
  if (e instanceof GeoProviderError) return e.kind;
  if (e instanceof Error && e.name === 'AbortError') return 'TIMEOUT';
  const code = errorCode(e);
  return code !== undefined && CONNECT_CODES.has(code) ? 'CONNECT' : 'UPSTREAM';
}

/** Resolves/rejects with `work`, or rejects as soon as `signal` aborts (the late outcome is discarded). */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new Error('deadline exceeded'));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error('adapter rejected with a non-error value'));
      },
    );
  });
}

export class GeoProviderCaller {
  private timeoutMinute = -1;
  private timeoutsThisMinute = 0;

  constructor(
    private readonly budgets: GeoBudgetGuard,
    private readonly breaker: CircuitBreaker,
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async call<T>(
    opts: CallOptions,
    invoke: (signal: AbortSignal) => Promise<unknown>,
    validate: (raw: unknown) => T | null,
  ): Promise<{ value: T; fetchedAt: Date }> {
    const { licence, meter } = opts;
    const meta = { providerKey: licence.providerKey, sku: licence.sku };
    for (let attempt = 0; ; attempt++) {
      const remaining = opts.deadline - this.now().getTime();
      if (remaining <= 0) throw new ProviderRefused('DEADLINE');
      try {
        await this.budgets.consume(licence.providerKey, licence.sku, licence.microUsdPerCall, this.now());
      } catch (e) {
        if (e instanceof BudgetRefusal) {
          meter.budgetRefusals++;
          throw new ProviderRefused(e.reason === 'MISSING' ? 'BUDGET_MISSING' : 'BUDGET_EXHAUSTED');
        }
        if (e instanceof LimiterUnavailableError) throw new ProviderRefused('LIMITER_UNAVAILABLE');
        throw e;
      }
      if (await this.coolingDown(licence)) {
        this.log.warn({ signal: 'GEO_PROVIDER_QUOTA_COOLDOWN', ...meta }, 'geo SKU cooling down after a provider quota answer');
        throw new ProviderRefused('QUOTA_COOLDOWN');
      }
      const admission = await this.breaker.admit(meta);
      if (!admission.allowed) throw new ProviderRefused('BREAKER_OPEN');

      meter.calls++;
      meter.costMicroUsd += licence.microUsdPerCall;
      const fetchedAt = this.now();
      const controller = new AbortController();
      const timer = setTimeout(
        () => {
          controller.abort();
        },
        Math.min(opts.timeoutMs, remaining),
      );
      let failure: GeoProviderFailure;
      try {
        const value = validate(await untilAborted(invoke(controller.signal), controller.signal));
        if (value !== null) {
          admission.complete('SUCCESS');
          return { value, fetchedAt };
        }
        failure = 'MALFORMED';
      } catch (e) {
        failure = classifyFailure(e, controller.signal.aborted);
        if (failure === 'QUOTA') await this.coolDown(licence, e instanceof GeoProviderError ? e.retryAfterSeconds : undefined);
      } finally {
        clearTimeout(timer);
      }
      this.recordFailure(failure, meta, meter, (outcome) => {
        admission.complete(outcome);
      });
      if (failure === 'CONNECT' && attempt < opts.retries && opts.deadline - this.now().getTime() >= opts.timeoutMs) continue;
      throw new ProviderRefused(failure === 'TIMEOUT' ? 'TIMEOUT' : failure === 'REJECTED_INPUT' ? 'REJECTED_INPUT' : 'PROVIDER_ERROR');
    }
  }

  private recordFailure(
    failure: GeoProviderFailure,
    meta: { providerKey: string; sku: string },
    meter: Meter,
    complete: (o: 'FAILURE' | 'TIMEOUT' | 'NEUTRAL') => void,
  ): void {
    switch (failure) {
      case 'TIMEOUT':
        meter.timeouts++;
        complete('TIMEOUT');
        this.timeoutSignal(meta);
        return;
      case 'QUOTA':
        meter.errors++;
        complete('NEUTRAL');
        this.log.warn({ signal: 'GEO_PROVIDER_QUOTA_EXCEEDED', ...meta }, 'geo provider refused for quota; SKU cooling down');
        return;
      case 'REJECTED_INPUT':
        meter.errors++;
        complete('NEUTRAL');
        this.log.error({ signal: 'GEO_ADAPTER_CONTRACT_ERROR', ...meta }, 'geo provider rejected a validated request');
        return;
      case 'MALFORMED':
        meter.errors++;
        complete('FAILURE');
        this.log.error({ signal: 'GEO_PROVIDER_SCHEMA_FAIL', ...meta }, 'geo provider response failed validation');
        return;
      default:
        meter.errors++;
        complete('FAILURE');
        this.log.warn({ signal: 'GEO_PROVIDER_ERROR', failure, ...meta }, 'geo provider call failed');
    }
  }

  /** GEO_PROVIDER_TIMEOUT: every one of the first 10 per minute, then 1 in 10. */
  private timeoutSignal(meta: { providerKey: string; sku: string }): void {
    const minute = Math.floor(this.now().getTime() / 60_000);
    if (minute !== this.timeoutMinute) {
      this.timeoutMinute = minute;
      this.timeoutsThisMinute = 0;
    }
    this.timeoutsThisMinute++;
    if (this.timeoutsThisMinute <= 10 || this.timeoutsThisMinute % 10 === 0) {
      this.log.warn({ signal: 'GEO_PROVIDER_TIMEOUT', ...meta, countThisMinute: this.timeoutsThisMinute }, 'geo provider call timed out');
    }
  }

  private cooldownKey(l: GeoAdapterLicence): string {
    return `${this.prefix}quota:${l.providerKey}:${l.sku}`;
  }

  private async coolingDown(l: GeoAdapterLicence): Promise<boolean> {
    try {
      return (await this.redis.exists(this.cooldownKey(l))) === 1;
    } catch (e) {
      throw new ProviderRefused('LIMITER_UNAVAILABLE', { cause: e });
    }
  }

  private async coolDown(l: GeoAdapterLicence, retryAfterSeconds: number | undefined): Promise<void> {
    const seconds = Math.min(3600, Math.max(1, Math.round(retryAfterSeconds ?? 60)));
    try {
      await this.redis.set(this.cooldownKey(l), '1', 'EX', seconds);
    } catch {
      this.log.warn({ signal: 'GEO_CACHE_UNAVAILABLE', providerKey: l.providerKey, sku: l.sku }, 'quota cool-down could not be recorded');
    }
  }
}
