/**
 * `geo.usage-rollup` (Phase 3 P3.2; docs/phase3/PHASE3_ARCHITECTURE.md §3.4; BUD-06). Recurring every 15 minutes: for
 * every COMPLETED hour whose counters are still in Valkey (kept 48 h), upsert the ABSOLUTE counter values into
 * `geo.provider_usage` (aggregates only — no account, text or coordinate). Re-running is idempotent: the same counters
 * produce the same row, and a persisted value is never lowered (`greatest`), so a partial Valkey loss cannot rewrite a
 * recorded hour downwards. No provider is ever called by a job.
 *
 * Gap detection: an hour already persisted within the last 46 h must still have its counters (they live ≥ 47 h after
 * the hour); if they vanished (Valkey flush/restart) the hour is reported once per run as `GEO_USAGE_GAP` and its
 * persisted values are kept as recorded.
 */
import type { Logger } from '@wayvro/observability';
import { hourBucket, type GeoUsageCounters, type JobDefinition, type Queryable } from '@wayvro/server-runtime';

export const GEO_USAGE_ROLLUP_JOB = 'geo.usage-rollup';
const GAP_LOOKBACK_MS = 46 * 3_600_000;

export interface RollupResult {
  readonly hoursUpserted: number;
  readonly gaps: number;
}

/** @internal exported for integration tests; production runs it through the recurring job. */
export async function rollupGeoUsage(db: Queryable, counters: GeoUsageCounters, log: Logger, now: Date = new Date()): Promise<RollupResult> {
  const hours = await counters.completedHours(now);
  for (const h of hours) {
    const c = h.counts;
    await db.query(
      `insert into geo.provider_usage (provider_key, sku, hour_bucket, calls, cache_hits, errors, timeouts, budget_refusals, est_cost_micro_usd, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       on conflict (provider_key, sku, hour_bucket) do update set
         calls = greatest(geo.provider_usage.calls, excluded.calls),
         cache_hits = greatest(geo.provider_usage.cache_hits, excluded.cache_hits),
         errors = greatest(geo.provider_usage.errors, excluded.errors),
         timeouts = greatest(geo.provider_usage.timeouts, excluded.timeouts),
         budget_refusals = greatest(geo.provider_usage.budget_refusals, excluded.budget_refusals),
         est_cost_micro_usd = greatest(geo.provider_usage.est_cost_micro_usd, excluded.est_cost_micro_usd),
         updated_at = now()`,
      [h.providerKey, h.sku, h.hour, c.calls, c.cache_hits, c.errors, c.timeouts, c.budget_refusals, c.est_cost_micro_usd],
    );
  }
  const recent = await db.query<{ provider_key: string; sku: string; hour_bucket: Date }>(
    `select provider_key, sku, hour_bucket from geo.provider_usage where hour_bucket >= $1 and hour_bucket < $2 order by hour_bucket`,
    [new Date(now.getTime() - GAP_LOOKBACK_MS), hourBucket(now)],
  );
  let gaps = 0;
  for (const r of recent.rows) {
    if (await counters.exists(r.provider_key, r.sku, r.hour_bucket)) continue;
    gaps++;
    log.warn(
      { signal: 'GEO_USAGE_GAP', providerKey: r.provider_key, sku: r.sku, hourBucket: r.hour_bucket.toISOString() },
      'geo usage counters missing for a recorded hour; persisted values kept',
    );
  }
  return { hoursUpserted: hours.length, gaps };
}

export function geoUsageRollupJob(db: Queryable, counters: GeoUsageCounters, log: Logger): JobDefinition {
  return {
    type: GEO_USAGE_ROLLUP_JOB,
    async handler() {
      const result = await rollupGeoUsage(db, counters, log);
      log.info({ ...result }, 'geo usage rollup');
    },
  };
}
