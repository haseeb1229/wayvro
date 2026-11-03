/**
 * Hourly geo usage counters in Valkey (Phase 3 P3.2; docs/phase3/PHASE3_ARCHITECTURE.md §3.4, §5.2 step 10; threat
 * model T3-08/T3-27). The API's geo gateway increments them per provider call/refusal; the worker's `geo.usage-rollup`
 * job copies the ABSOLUTE values of every completed hour into `geo.provider_usage` (idempotent upsert).
 *
 * One hash per (providerKey, sku, UTC hour): `<prefix>usage:<providerKey>:<sku>:<yyyymmddhh>` with the fields of
 * GEO_USAGE_METRICS, kept 48 h after the last write. Counters carry no user identifier, no text and no coordinate.
 * Valkey errors propagate: the gateway records best-effort (logged), the rollup job fails and is retried.
 */
import type { Redis } from 'ioredis';

/** The Valkey client type of `createRequestPathRedis`, for modules that must not depend on the driver package. */
export type ValkeyClient = Redis;

export const GEO_USAGE_METRICS = ['calls', 'cache_hits', 'errors', 'timeouts', 'budget_refusals', 'est_cost_micro_usd'] as const;
export type GeoUsageMetric = (typeof GEO_USAGE_METRICS)[number];
export type GeoUsageCounts = Readonly<Record<GeoUsageMetric, number>>;

/** Counters outlive their hour by at least 47 h, so a rollup outage shorter than that loses nothing. */
export const GEO_USAGE_KEY_TTL_SECONDS = 48 * 3600;

const PROVIDER_KEY = /^[a-z][a-z0-9-]{1,31}$/;
const SKU = /^[A-Z][A-Z_]{1,31}$/;

/** Start of the UTC hour containing `at`. */
export function hourBucket(at: Date): Date {
  const d = new Date(at.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d;
}

function hourLabel(hour: Date): string {
  return hour.toISOString().slice(0, 13).replace(/[-T]/g, '');
}

function parseHourLabel(label: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(label);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4])));
  return hourLabel(d) === label ? d : null;
}

export interface GeoUsageHour {
  readonly providerKey: string;
  readonly sku: string;
  readonly hour: Date;
  readonly counts: GeoUsageCounts;
}

export class GeoUsageCounters {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wv:geo:',
  ) {}

  key(providerKey: string, sku: string, hour: Date): string {
    if (!PROVIDER_KEY.test(providerKey) || !SKU.test(sku)) throw new RangeError('invalid usage counter dimension');
    return `${this.prefix}usage:${providerKey}:${sku}:${hourLabel(hourBucket(hour))}`;
  }

  /** Adds the given non-negative integer increments to the hour of `at`. */
  async record(providerKey: string, sku: string, increments: Partial<Record<GeoUsageMetric, number>>, at: Date): Promise<void> {
    const key = this.key(providerKey, sku, at);
    const tx = this.redis.multi();
    let fields = 0;
    for (const metric of GEO_USAGE_METRICS) {
      const n = increments[metric] ?? 0;
      if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`invalid increment for ${metric}`);
      if (n > 0) {
        tx.hincrby(key, metric, n);
        fields++;
      }
    }
    if (fields === 0) return;
    tx.expire(key, GEO_USAGE_KEY_TTL_SECONDS);
    const replies = await tx.exec();
    const failed = replies?.find(([e]) => e !== null);
    if (replies === null || failed) throw new Error('geo usage counter update failed', { cause: failed?.[0] ?? undefined });
  }

  /** Whether counters still exist for that hour (the rollup's gap detection). */
  async exists(providerKey: string, sku: string, hour: Date): Promise<boolean> {
    return (await this.redis.exists(this.key(providerKey, sku, hour))) === 1;
  }

  /** Every counter hash of a COMPLETED hour (strictly before the hour of `now`) still present in Valkey. */
  async completedHours(now: Date): Promise<GeoUsageHour[]> {
    const current = hourBucket(now).getTime();
    const out: GeoUsageHour[] = [];
    const pattern = `${this.prefix}usage:*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      for (const key of keys) {
        const parts = key.slice(this.prefix.length + 'usage:'.length).split(':');
        const [providerKey, sku, label] = parts;
        if (parts.length !== 3 || !providerKey || !sku || !label || !PROVIDER_KEY.test(providerKey) || !SKU.test(sku)) continue;
        const hour = parseHourLabel(label);
        if (!hour || hour.getTime() >= current) continue;
        const raw = await this.redis.hgetall(key);
        const counts = Object.fromEntries(
          GEO_USAGE_METRICS.map((m) => {
            const v = Number(raw[m] ?? '0');
            if (!Number.isSafeInteger(v) || v < 0) throw new Error(`corrupted geo usage counter ${m} in ${key}`);
            return [m, v];
          }),
        ) as Record<GeoUsageMetric, number>;
        out.push({ providerKey, sku, hour, counts });
      }
    } while (cursor !== '0');
    return out.sort((a, b) => a.hour.getTime() - b.hour.getTime() || a.providerKey.localeCompare(b.providerKey) || a.sku.localeCompare(b.sku));
  }
}
