/**
 * BUD-06 / retention: the `geo.usage-rollup` job copies completed hours of the API's Valkey usage counters into
 * `geo.provider_usage` (idempotent re-run, never lowers a recorded hour, current hour untouched), reports
 * GEO_USAGE_GAP when a recorded hour's counters vanished, is registered by the composition with a recurring
 * interval, and `maintenance.purge` deletes rows past GEO_USAGE_RETENTION_DAYS. Real PostgreSQL + Valkey, executed as a
 * LOGIN member of wayvro_worker; synthetic counters only.
 */
import { randomUUID } from 'node:crypto';
import { runMigrations } from '@wayvro/db';
import { createLogger } from '@wayvro/observability';
import { bindProviders } from '@wayvro/provider-interfaces';
import { GeoUsageCounters, awaitRedisReady, createRequestPathRedis } from '@wayvro/server-runtime';
import { captureLogs, createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeWorker } from '../src/composition.js';
import { loadWorkerConfig } from '../src/config.js';
import { GEO_USAGE_ROLLUP_JOB, geoUsageRollupJob, rollupGeoUsage } from '../src/geo/usage-rollup.js';
import { purgeOnce } from '../src/maintenance.js';

const ADMIN_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];
if (!ADMIN_URL || !REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;

let database: TestDatabase;
let owner: pg.Pool;
let worker: pg.Pool;
let login: RestrictedLogin;
const redis = createRequestPathRedis(REDIS_URL, 2000);
const prefix = `wv:it:${randomUUID().slice(0, 8)}:geo:`;
const counters = new GeoUsageCounters(redis, prefix);
const logs = captureLogs();
const log = createLogger({ service: 'worker', env: 'test', level: 'info', destination: logs.stream });

beforeAll(async () => {
  expect(await awaitRedisReady(redis, 5000)).toBe(true);
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 2 });
  login = await createRestrictedLogin(adminUrl, database.url, 'wayvro_worker');
  worker = new pg.Pool({ connectionString: login.url, max: 2 });
});
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
  await Promise.all([owner.end(), worker.end()]);
  await login.drop();
  await database.drop();
});

const rows = async () =>
  (
    await owner.query<{ provider_key: string; sku: string; hour_bucket: Date; calls: string; budget_refusals: string; est_cost_micro_usd: string }>(
      `select provider_key, sku, hour_bucket, calls, budget_refusals, est_cost_micro_usd from geo.provider_usage order by hour_bucket, sku`,
    )
  ).rows.map((r) => ({ ...r, hour_bucket: r.hour_bucket.toISOString() }));

describe('geo.usage-rollup (BUD-06)', () => {
  it('upserts absolute values of completed hours only; a re-run is identical; values are never lowered', async () => {
    const now = new Date();
    const previous = new Date(now.getTime() - 3_600_000);
    const older = new Date(now.getTime() - 5 * 3_600_000);
    await counters.record('geo-mock', 'AUTOCOMPLETE', { calls: 3, est_cost_micro_usd: 3000 }, previous);
    await counters.record('geo-mock', 'AUTOCOMPLETE', { budget_refusals: 2 }, previous);
    await counters.record('geo-mock', 'ROUTE', { calls: 1, timeouts: 1 }, older);
    await counters.record('geo-mock', 'ROUTE', { calls: 9 }, now); // current hour: not rolled up yet
    const first = await rollupGeoUsage(worker, counters, log, now);
    expect(first).toEqual({ hoursUpserted: 2, gaps: 0 });
    const afterFirst = await rows();
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst.find((r) => r.sku === 'AUTOCOMPLETE')).toMatchObject({ calls: '3', budget_refusals: '2', est_cost_micro_usd: '3000' });
    expect(await rollupGeoUsage(worker, counters, log, now)).toEqual({ hoursUpserted: 2, gaps: 0 });
    expect(await rows()).toEqual(afterFirst);
    // a lower counter value (e.g. partial Valkey loss) never rewrites a recorded hour downwards
    await redis.hset(counters.key('geo-mock', 'AUTOCOMPLETE', previous), 'calls', '1');
    await rollupGeoUsage(worker, counters, log, now);
    expect((await rows()).find((r) => r.sku === 'AUTOCOMPLETE')?.calls).toBe('3');
  });

  it('reports GEO_USAGE_GAP when a recorded hour lost its counters, keeping the recorded values', async () => {
    const now = new Date();
    const previous = new Date(now.getTime() - 3_600_000);
    await redis.del(counters.key('geo-mock', 'AUTOCOMPLETE', previous));
    logs.clear();
    const r = await rollupGeoUsage(worker, counters, log, now);
    expect(r.gaps).toBe(1);
    expect(logs.text()).toContain('GEO_USAGE_GAP');
    expect((await rows()).find((x) => x.sku === 'AUTOCOMPLETE')?.calls).toBe('3');
  });

  it('the job definition runs the rollup; the composition registers it only with a counter source', async () => {
    await geoUsageRollupJob(worker, counters, log).handler({
      id: randomUUID(),
      type: GEO_USAGE_ROLLUP_JOB,
      payload: {},
      sealedPayload: null,
      attempts: 1,
      maxAttempts: 1,
      leaseToken: randomUUID(),
    });
    expect(logs.text()).toContain('geo usage rollup');
    const config = loadWorkerConfig({
      WAYVRO_ENV: 'test',
      DATABASE_URL: database.url,
      REDIS_URL,
      WAYVRO_LOCAL_KEY_SEED: 'synthetic-worker-geo-seed-000000000000000',
    });
    expect(config.GEO_USAGE_RETENTION_DAYS).toBe(400);
    const providers = bindProviders('test', {});
    expect(composeWorker(config, worker, log, providers, null, null, counters).runner.types).toContain(GEO_USAGE_ROLLUP_JOB);
    expect(composeWorker(config, worker, log, providers).runner.types).not.toContain(GEO_USAGE_ROLLUP_JOB);
  });

  it('maintenance.purge deletes usage rows past the retention, keeps recent ones', async () => {
    await owner.query(
      `insert into geo.provider_usage (provider_key, sku, hour_bucket, calls) values ('geo-mock', 'GEOCODE', date_trunc('hour', now() - interval '401 days'), 5)`,
    );
    const result = await purgeOnce(worker, { otpChallengeDays: 7, succeededJobDays: 7, applicationDraftExpiryDays: 30, geoUsageDays: 400, batchSize: 100 });
    expect(result.geoUsage).toBe(1);
    expect((await rows()).some((r) => r.sku === 'GEOCODE')).toBe(false);
    expect((await rows()).length).toBeGreaterThan(0);
  });
});
