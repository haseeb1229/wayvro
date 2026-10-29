/**
 * Geo result cache in Valkey (Phase 3 P3.2; docs/phase3/PHASE3_ARCHITECTURE.md §5.2 steps 4/9, §5.3; threat model
 * T3-10/T3-12; CS-01..07). Never authoritative.
 *
 *   key   = <prefix><providerKey>:<sku>:v1:<HMAC-SHA-256(geo_cache key, canonical normalised parameters)>
 *           provider-namespaced (no cross-provider bleed); keyed, so a dump or MONITOR reveals no search text or
 *           location; the account id is part of the material when the licence forbids cross-user sharing
 *   value = {"v":1,"f":<fetchedAt ISO>,"d":<normalised result>} — written only by the gateway after validation,
 *           never from client or staff input; validated again on read (an invalid entry is deleted, treated as a miss
 *           and signalled GEO_CACHE_ENTRY_INVALID)
 *   TTL   = the caller's effective TTL (min of adapter terms and configured maximum; 0 = never written); when
 *           stale-serving is allowed the entry lives 2 × TTL and reads report FRESH (≤ TTL) or STALE (≤ 2 × TTL)
 * A Valkey read error is a MISS (logged): the following budget step needs Valkey too and fails closed, so a cache
 * outage can never open an unmetered path. A write error is logged and the response is still returned.
 */
import type { KeyedHasher } from '@wayvro/field-crypto';
import type { Logger } from '@wayvro/observability';
import type { ValkeyClient as Redis } from '@wayvro/server-runtime';
import { z } from 'zod';

export interface CacheRead<T> {
  readonly state: 'FRESH' | 'STALE';
  readonly fetchedAt: Date;
  readonly value: T;
}

const Envelope = z.strictObject({ v: z.literal(1), f: z.iso.datetime({ offset: true }), d: z.unknown() });

export class GeoCache {
  constructor(
    private readonly redis: Redis,
    private readonly hasher: KeyedHasher,
    private readonly prefix: string,
    private readonly log: Logger,
  ) {}

  /** Deterministic keyed key for normalised parameters (`account` set when results must not be shared). */
  key(providerKey: string, sku: string, material: Readonly<Record<string, string | number | null>>, account: string | null = null): string {
    const canonical = JSON.stringify(
      Object.keys(material)
        .sort()
        .map((k) => [k, material[k] ?? null]),
    );
    const digest = this.hasher.active('geo_cache', `${providerKey}|${sku}|${account ?? '*'}|${canonical}`).digest.toString('hex');
    return `${this.prefix}${providerKey}:${sku}:v1:${digest}`;
  }

  async read<T>(key: string, schema: z.ZodType<T>, ttlSeconds: number, now: Date, meta: { providerKey: string; sku: string }): Promise<CacheRead<T> | null> {
    if (ttlSeconds <= 0) return null;
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch {
      this.log.warn({ signal: 'GEO_CACHE_UNAVAILABLE', ...meta }, 'geo cache read failed; treated as a miss');
      return null;
    }
    if (raw === null) return null;
    const entry = this.parse(raw, schema);
    if (!entry) {
      this.log.warn({ signal: 'GEO_CACHE_ENTRY_INVALID', ...meta }, 'invalid geo cache entry discarded');
      await this.redis.del(key).catch(() => {
        this.log.warn({ signal: 'GEO_CACHE_UNAVAILABLE', ...meta }, 'invalid geo cache entry could not be deleted');
      });
      return null;
    }
    const age = (now.getTime() - entry.fetchedAt.getTime()) / 1000;
    if (age < 0 || age > 2 * ttlSeconds) return null;
    return { state: age <= ttlSeconds ? 'FRESH' : 'STALE', fetchedAt: entry.fetchedAt, value: entry.value };
  }

  private parse<T>(raw: string, schema: z.ZodType<T>): { fetchedAt: Date; value: T } | null {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
    const env = Envelope.safeParse(json);
    if (!env.success) return null;
    const value = schema.safeParse(env.data.d);
    return value.success ? { fetchedAt: new Date(env.data.f), value: value.data } : null;
  }

  /** Stores a validated result; `lifetimeSeconds` is the Valkey TTL (TTL, or 2 × TTL when stale-serving is allowed). */
  async write(key: string, value: unknown, fetchedAt: Date, lifetimeSeconds: number, meta: { providerKey: string; sku: string }): Promise<void> {
    if (lifetimeSeconds <= 0) return;
    try {
      await this.redis.set(key, JSON.stringify({ v: 1, f: fetchedAt.toISOString(), d: value }), 'EX', lifetimeSeconds);
    } catch {
      this.log.warn({ signal: 'GEO_CACHE_UNAVAILABLE', ...meta }, 'geo cache write failed; response returned uncached');
    }
  }
}
