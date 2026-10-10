/** Rate limiter against real Valkey: atomicity under concurrency, windows, multi-dimension, boundaries, outage. */
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LimiterUnavailableError, RateLimiter, awaitRedisReady, createRequestPathRedis } from '../src/index.js';

const REDIS_URL = process.env['REDIS_URL'];
if (!REDIS_URL) throw new Error('REDIS_URL is required (start infra with `pnpm infra:up`)');

const redis = createRequestPathRedis(REDIS_URL, 2000);
const prefix = `wv:it:${randomUUID()}:`;
const limiter = new RateLimiter(redis, prefix);
beforeAll(async () => {
  expect(await awaitRedisReady(redis, 5000)).toBe(true);
});
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

describe('RateLimiter (Valkey, atomic Lua)', () => {
  it('admits exactly `limit` of 200 concurrent requests and never overshoots', async () => {
    const rule = { key: 'concurrent', limit: 10, windowSeconds: 60 };
    const decisions = await Promise.all(Array.from({ length: 200 }, () => limiter.consume([rule])));
    expect(decisions.filter((d) => d.allowed)).toHaveLength(10);
    expect(await limiter.count('concurrent')).toBe(10);
  });

  it('is exact at the boundary and reports retry metadata', async () => {
    const rule = { key: 'boundary', limit: 3, windowSeconds: 30 };
    for (let i = 0; i < 3; i++) expect((await limiter.consume([rule])).allowed).toBe(true);
    const denied = await limiter.consume([rule]);
    expect(denied).toMatchObject({ allowed: false, deniedRule: 0 });
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(30);
    expect(await limiter.count('boundary')).toBe(3);
  });

  it('a window expires and admits again', async () => {
    const rule = { key: 'expiry', limit: 1, windowSeconds: 1 };
    expect((await limiter.consume([rule])).allowed).toBe(true);
    expect((await limiter.consume([rule])).allowed).toBe(false);
    await sleep(1150);
    expect((await limiter.consume([rule])).allowed).toBe(true);
  });

  it('multi-dimensional: a denial on any rule consumes nothing on the others', async () => {
    const wide = { key: 'multi:wide', limit: 100, windowSeconds: 60 };
    const narrow = { key: 'multi:narrow', limit: 0, windowSeconds: 60 };
    const d = await limiter.consume([wide, narrow]);
    expect(d).toMatchObject({ allowed: false, deniedRule: 1 });
    expect(await limiter.count('multi:wide')).toBe(0);
    expect((await limiter.consume([wide, { ...narrow, limit: 1 }])).allowed).toBe(true);
    expect(await limiter.count('multi:wide')).toBe(1);
  });

  it('peek never consumes; hit always increments; cost is honoured', async () => {
    const rule = { key: 'peek', limit: 2, windowSeconds: 60 };
    expect((await limiter.peek([rule])).allowed).toBe(true);
    expect(await limiter.count('peek')).toBe(0);
    await limiter.hit([{ ...rule, cost: 5 }]);
    expect(await limiter.count('peek')).toBe(5);
    expect((await limiter.peek([rule])).allowed).toBe(false);
    expect((await limiter.consume([])).allowed).toBe(true);
    await expect(limiter.consume([{ key: 'bad', limit: -1, windowSeconds: 1 }])).rejects.toThrow(RangeError);
  });

  it('an unreachable Valkey fails fast with LimiterUnavailableError (callers fail closed)', async () => {
    const dead = createRequestPathRedis('redis://127.0.0.1:1', 200);
    expect(await awaitRedisReady(dead, 300)).toBe(false);
    const started = Date.now();
    await expect(new RateLimiter(dead).consume([{ key: 'x', limit: 1, windowSeconds: 1 }])).rejects.toBeInstanceOf(LimiterUnavailableError);
    await expect(new RateLimiter(dead).count('x')).rejects.toBeInstanceOf(LimiterUnavailableError);
    expect(Date.now() - started).toBeLessThan(2000);
    dead.disconnect();
  });
});
