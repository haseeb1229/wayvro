/** Geo usage counters against real Valkey: hourly hashes, TTL, completed-hour scan, validation and corruption. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GEO_USAGE_KEY_TTL_SECONDS, GeoUsageCounters, awaitRedisReady, createRequestPathRedis, hourBucket } from '../src/index.js';

const REDIS_URL = process.env['REDIS_URL'];
if (!REDIS_URL) throw new Error('REDIS_URL is required (start infra with `pnpm infra:up`)');

const redis = createRequestPathRedis(REDIS_URL, 2000);
const prefix = `wv:it:${randomUUID()}:`;
const counters = new GeoUsageCounters(redis, prefix);
beforeAll(async () => {
  expect(await awaitRedisReady(redis, 5000)).toBe(true);
});
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

describe('GeoUsageCounters (Valkey)', () => {
  it('truncates to the UTC hour', () => {
    expect(hourBucket(new Date('2026-10-13T05:59:59.999Z')).toISOString()).toBe('2026-10-13T05:00:00.000Z');
  });

  it('accumulates per (provider, sku, hour), keeps keys 48 h and lists completed hours only', async () => {
    const h1 = new Date('2026-10-13T04:10:00Z');
    const h2 = new Date('2026-10-13T05:20:00Z');
    await counters.record('geo-a', 'AUTOCOMPLETE', { calls: 1, est_cost_micro_usd: 2830 }, h1);
    await counters.record('geo-a', 'AUTOCOMPLETE', { calls: 1, cache_hits: 1 }, h1);
    await counters.record('geo-a', 'ROUTE', { calls: 1, timeouts: 1, errors: 1 }, h1);
    await counters.record('geo-a', 'AUTOCOMPLETE', { budget_refusals: 1 }, h2);
    await counters.record('geo-a', 'AUTOCOMPLETE', {}, h2); // no-op
    const ttl = await redis.ttl(counters.key('geo-a', 'AUTOCOMPLETE', h1));
    expect(ttl).toBeGreaterThan(GEO_USAGE_KEY_TTL_SECONDS - 60);
    expect(await counters.exists('geo-a', 'ROUTE', h1)).toBe(true);
    expect(await counters.exists('geo-b', 'ROUTE', h1)).toBe(false);

    const completed = await counters.completedHours(new Date('2026-10-13T05:30:00Z'));
    expect(completed).toEqual([
      {
        providerKey: 'geo-a',
        sku: 'AUTOCOMPLETE',
        hour: new Date('2026-10-13T04:00:00Z'),
        counts: { calls: 2, cache_hits: 1, errors: 0, timeouts: 0, budget_refusals: 0, est_cost_micro_usd: 2830 },
      },
      {
        providerKey: 'geo-a',
        sku: 'ROUTE',
        hour: new Date('2026-10-13T04:00:00Z'),
        counts: { calls: 1, cache_hits: 0, errors: 1, timeouts: 1, budget_refusals: 0, est_cost_micro_usd: 0 },
      },
    ]);
    expect((await counters.completedHours(new Date('2026-10-13T06:00:00Z'))).map((h) => h.hour.toISOString())).toContain('2026-10-13T05:00:00.000Z');
  });

  it('refuses invalid dimensions and increments, skips foreign keys and fails loudly on corrupted values', async () => {
    await expect(counters.record('Geo A', 'ROUTE', { calls: 1 }, new Date())).rejects.toThrow(RangeError);
    await expect(counters.record('geo-a', 'ROUTE', { calls: -1 }, new Date())).rejects.toThrow(RangeError);
    await expect(counters.record('geo-a', 'ROUTE', { calls: 1.5 }, new Date())).rejects.toThrow(RangeError);
    await redis.set(`${prefix}usage:not-a-usage-key`, '1');
    await redis.hset(`${prefix}usage:geo-c:ROUTE:2026130199`, 'calls', '1'); // impossible hour label
    const before = await counters.completedHours(new Date('2026-10-14T00:00:00Z'));
    expect(before.every((h) => h.providerKey !== 'geo-c')).toBe(true);
    await redis.hset(counters.key('geo-d', 'ROUTE', new Date('2026-10-12T01:00:00Z')), 'calls', 'x');
    await expect(counters.completedHours(new Date('2026-10-14T00:00:00Z'))).rejects.toThrow(/corrupted/);
  });
});
