import { createDatabase } from '@wayvro/db';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseCheck, redisCheck } from '../src/readiness.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];
if (!DATABASE_URL || !REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required (start infra with `pnpm infra:up`)');

const db = createDatabase(DATABASE_URL, { maxConnections: 2, applicationName: 'wayvro-api-it' });
const redis = redisCheck(REDIS_URL);
const deadRedis = redisCheck('redis://127.0.0.1:1');
afterAll(async () => {
  redis.close();
  deadRedis.close();
  await db.close();
});

describe('readiness probes against real infrastructure', () => {
  it('report ok for the running PostgreSQL and Valkey', async () => {
    expect(await databaseCheck(db).check()).toBe(true);
    expect(await redis.check()).toBe(true);
  });

  it('report failure quickly (bounded) for an unreachable Redis', async () => {
    const started = Date.now();
    expect(await deadRedis.check()).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
