/**
 * Geo cost budgets (Phase 3 P3.2; docs/phase3/PHASE3_ARCHITECTURE.md §5.2 step 5; threat model T3-08/T3-27, §6;
 * BUD-01..05). Every provider attempt first consumes, atomically and all-or-nothing (the Valkey limiter's Lua
 * script), the day and month call counters and the month cost counter (micro-USD from the adapter price table) of its
 * (providerKey, SKU) against the ACTIVE `geo.provider_budgets` row (read through a 60 s in-process cache). Windows are
 * UTC calendar days/months on server time (the OTP budget precedent). By construction, spend per SKU cannot exceed its
 * configured monthly cost while this check fails closed.
 *
 *   local/test, no ACTIVE row   → GEO_LOCAL_DAILY_CALLS_PER_SKU per day (× 31 per month), no cost cap
 *   staging/production, no row  → SKU refused (no default; signal GEO_BUDGET_MISSING)
 *   exhausted                   → BudgetRefusal (503 GEO_BUDGET_EXHAUSTED; signal GEO_BUDGET_EXHAUSTED once per window)
 *   thresholds (50/80/100 % default, per row) → GEO_BUDGET_THRESHOLD once per threshold per window (Valkey SET NX)
 *   limiter unavailable         → LimiterUnavailableError propagates (callers fail closed)
 */
import { isNonProductionLike, type WayvroEnv } from '@wayvro/config';
import type { Logger } from '@wayvro/observability';
import { LimiterUnavailableError, type LimitRule, type Queryable, type RateLimiter, type ValkeyClient as Redis } from '@wayvro/server-runtime';

const DAY = 86_400;
const BUDGET_CACHE_MS = 60_000;

export interface BudgetLimits {
  readonly dailyCalls: number;
  readonly monthlyCalls: number;
  /** null = no cost cap (local/test default only). */
  readonly monthlyCostMicroUsd: number | null;
  readonly thresholdsPct: readonly number[];
  readonly source: 'ACTIVE_ROW' | 'LOCAL_DEFAULT';
}

export class BudgetRefusal extends Error {
  override readonly name = 'BudgetRefusal';
  constructor(readonly reason: 'EXHAUSTED' | 'MISSING') {
    super(`geo budget refusal: ${reason}`);
  }
}

export interface BudgetPolicy {
  readonly WAYVRO_ENV: WayvroEnv;
  readonly GEO_LOCAL_DAILY_CALLS_PER_SKU: number;
  readonly GEO_KEY_PREFIX: string;
}

interface Window {
  readonly kind: 'day' | 'month';
  readonly meter: 'calls' | 'cost';
  readonly rule: LimitRule;
}

export class GeoBudgetGuard {
  private readonly cache = new Map<string, { at: number; limits: BudgetLimits | null }>();
  private readonly signalled = new Set<string>();

  constructor(
    private readonly db: Queryable,
    private readonly limiter: RateLimiter,
    private readonly redis: Redis,
    private readonly policy: BudgetPolicy,
    private readonly log: Logger,
  ) {}

  /** The limits in force for (providerKey, sku), or null when the SKU must be refused (production without a row). */
  async limits(providerKey: string, sku: string, now: Date): Promise<BudgetLimits | null> {
    const id = `${providerKey}:${sku}`;
    const hit = this.cache.get(id);
    if (hit && now.getTime() - hit.at < BUDGET_CACHE_MS) return hit.limits;
    const r = await this.db.query<{ daily_calls: number; monthly_calls: number; monthly_cost_micro_usd: string; alert_thresholds_pct: number[] }>(
      `select daily_calls, monthly_calls, monthly_cost_micro_usd, alert_thresholds_pct from geo.provider_budgets
        where provider_key = $1 and sku = $2 and status = 'ACTIVE'`,
      [providerKey, sku],
    );
    const row = r.rows[0];
    let limits: BudgetLimits | null;
    if (row) {
      limits = {
        dailyCalls: row.daily_calls,
        monthlyCalls: row.monthly_calls,
        monthlyCostMicroUsd: Number(row.monthly_cost_micro_usd),
        thresholdsPct: [...row.alert_thresholds_pct].sort((a, b) => a - b),
        source: 'ACTIVE_ROW',
      };
    } else if (isNonProductionLike(this.policy.WAYVRO_ENV)) {
      const daily = this.policy.GEO_LOCAL_DAILY_CALLS_PER_SKU;
      limits = { dailyCalls: daily, monthlyCalls: daily * 31, monthlyCostMicroUsd: null, thresholdsPct: [50, 80, 100], source: 'LOCAL_DEFAULT' };
    } else {
      limits = null;
    }
    this.cache.set(id, { at: now.getTime(), limits });
    return limits;
  }

  /** Consumes one provider attempt; throws BudgetRefusal or LimiterUnavailableError. */
  async consume(providerKey: string, sku: string, microUsdPerCall: number, now: Date): Promise<void> {
    const limits = await this.limits(providerKey, sku, now);
    if (!limits) {
      this.once(`missing:${providerKey}:${sku}:${now.toISOString().slice(0, 10)}`, () => {
        this.log.error({ signal: 'GEO_BUDGET_MISSING', providerKey, sku }, 'geo alert: no ACTIVE budget for this SKU; refusing provider calls');
      });
      throw new BudgetRefusal('MISSING');
    }
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const windows: Window[] = [
      { kind: 'day', meter: 'calls', rule: { key: `geo:bud:d:${providerKey}:${sku}:${day}`, limit: limits.dailyCalls, windowSeconds: 2 * DAY } },
      { kind: 'month', meter: 'calls', rule: { key: `geo:bud:m:${providerKey}:${sku}:${month}`, limit: limits.monthlyCalls, windowSeconds: 32 * DAY } },
    ];
    if (limits.monthlyCostMicroUsd !== null && microUsdPerCall > 0) {
      windows.push({
        kind: 'month',
        meter: 'cost',
        rule: { key: `geo:bud:c:${providerKey}:${sku}:${month}`, limit: limits.monthlyCostMicroUsd, windowSeconds: 32 * DAY, cost: microUsdPerCall },
      });
    }
    const decision = await this.limiter.consume(windows.map((w) => w.rule));
    if (!decision.allowed) {
      const w = windows[decision.deniedRule ?? 0];
      await this.signalOnce(`exhausted:${w?.rule.key ?? sku}`, () => {
        this.log.error(
          { signal: 'GEO_BUDGET_EXHAUSTED', providerKey, sku, window: w?.kind, meter: w?.meter },
          'geo alert: provider budget exhausted; refusing provider calls',
        );
      });
      throw new BudgetRefusal('EXHAUSTED');
    }
    await this.thresholds(providerKey, sku, windows, limits.thresholdsPct);
  }

  private async thresholds(providerKey: string, sku: string, windows: readonly Window[], thresholdsPct: readonly number[]): Promise<void> {
    const used = await Promise.all(windows.map((w) => this.limiter.count(w.rule.key)));
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      const u = used[i] ?? 0;
      if (!w || w.rule.limit === 0) continue;
      for (const pct of thresholdsPct) {
        if (u * 100 < w.rule.limit * pct) continue;
        await this.signalOnce(`threshold:${w.rule.key}:${String(pct)}`, () => {
          this.log.warn(
            { signal: 'GEO_BUDGET_THRESHOLD', providerKey, sku, percent: pct, window: w.kind, meter: w.meter },
            'geo alert: budget threshold reached',
          );
        });
      }
    }
  }

  /** In-process memo first; then a cluster-wide SET NX so one signal is logged per threshold and window. */
  private async signalOnce(id: string, emit: () => void): Promise<void> {
    if (this.signalled.has(id)) return;
    // the memo only saves round trips (Valkey dedupes); keep it bounded across months of uptime
    if (this.signalled.size > 10_000) this.signalled.clear();
    try {
      const set = await this.redis.set(`${this.policy.GEO_KEY_PREFIX}sig:${id}`, '1', 'EX', 33 * DAY, 'NX');
      this.signalled.add(id);
      if (set === 'OK') emit();
    } catch (e) {
      throw new LimiterUnavailableError('geo budget signal store unavailable', { cause: e });
    }
  }

  private once(id: string, emit: () => void): void {
    if (this.signalled.has(id)) return;
    this.signalled.add(id);
    emit();
  }

  /** Test hook / staff activation: forget cached limits so the next call re-reads the ACTIVE row. */
  invalidate(): void {
    this.cache.clear();
  }
}
