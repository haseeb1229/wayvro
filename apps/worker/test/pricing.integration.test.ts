/**
 * P3.3 worker jobs against real PostgreSQL as a LOGIN member of wayvro_worker: the `maintenance.purge` quote extension
 * (PRICED past `expires_at` → EXPIRED in bounded batches; quotes + components older than the retention deleted in one
 * transaction — the deferred Σ(components) = total trigger tolerates the vanished parent; unreferenced route snapshots
 * deleted; polylines past their terms-derived TTL removed; a second run is a no-op) and the rate-card activator of
 * `config.scheduled-activation` (applies due cards, retires the previous ACTIVE card, outbox + SYSTEM audit, re-checks
 * every rule at run time and unschedules a refused card; a race against a staff activation has exactly one winner and
 * the loser sees a clean conflict). The staff activation is driven as a wayvro_api member with the API's protocol
 * (advisory lock per city/product + compare-and-set on APPROVED); its HTTP 409 path is in
 * apps/api/test/pricing-admin.integration.test.ts. Synthetic data only (no real rate or tax value).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rateCardActivationLockKey } from '@wayvro/config';
import { runMigrations } from '@wayvro/db';
import { createLogger } from '@wayvro/observability';
import {
  SYNTHETIC_CATALOG,
  captureLogs,
  createRestrictedLogin,
  createTestDatabase,
  seedSyntheticCatalog,
  type RestrictedLogin,
  type TestDatabase,
} from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeOnce } from '../src/maintenance.js';
import { rateCardActivator } from '../src/release/rate-card-activator.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;
const P = SYNTHETIC_CATALOG.pricing;

let database: TestDatabase;
let owner: pg.Pool;
let worker: pg.Pool;
let api: pg.Pool;
const logins: RestrictedLogin[] = [];
const logs = captureLogs();
const log = createLogger({ service: 'worker', env: 'test', level: 'info', destination: logs.stream });
let drafter: string;
let approver: string;
let accountId: string;
const POLICY = { otpChallengeDays: 7, succeededJobDays: 7, applicationDraftExpiryDays: 30, geoUsageDays: 400, quoteRetentionDays: 30, batchSize: 100 };

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  await seedSyntheticCatalog({ env: 'test', databaseUrl: database.url });
  owner = new pg.Pool({ connectionString: database.url, max: 3 });
  for (const [group, assign] of [
    ['wayvro_worker', (p: pg.Pool) => (worker = p)],
    ['wayvro_api', (p: pg.Pool) => (api = p)],
  ] as const) {
    const login = await createRestrictedLogin(adminUrl, database.url, group);
    logins.push(login);
    assign(new pg.Pool({ connectionString: login.url, max: 6 }));
  }
  const staff = async () => {
    const id = randomUUID();
    await owner.query(`insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'Synthetic', $2, 'ACTIVE', now())`, [
      id,
      `p.${randomBytes(4).toString('hex')}@example.org`,
    ]);
    return id;
  };
  drafter = await staff();
  approver = await staff();
  accountId = randomUUID();
  await owner.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [accountId]);
});
afterAll(async () => {
  await Promise.all([owner.end(), worker.end(), api.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

/** One quote (+ its snapshot and three balanced components) written in one transaction; `createdAgo`/`ttl` as SQL intervals. */
async function quote(createdAgo: string, ttl = '300 seconds', polylineExpiresIn: string | null = null): Promise<{ id: string; snapshot: string }> {
  const c = await owner.connect();
  try {
    await c.query('begin');
    const snapshot = randomUUID();
    await c.query(
      `insert into pricing.route_snapshots (id, provider_key, sku, routing_profile, fetched_at, cache_status, confidence, distance_m, duration_s, polyline,
                                            polyline_expires_at, latency_ms, created_at)
       values ($1, 'geo-mock', 'ROUTE', 'CAR', now(), 'MISS', 'LOW', 7351, 1234, 'synthetic_polyline', now() - $2::interval + $3::interval, 9, now() - $2::interval)`,
      [snapshot, createdAgo, polylineExpiresIn],
    );
    const id = randomUUID();
    await c.query(
      `insert into pricing.quotes (id, quote_group_id, account_id, city_code, product_code, rate_card_id, rate_card_version, zone_set_id, pricing_engine_version,
                                   pickup, dropoff, airport_pickup, distance_m, duration_s, route_snapshot_id, currency, total_minor, toll_policy, is_synthetic,
                                   status, created_at, expires_at, request_hash)
       select $1, $2, $3, 'LHR', 'ECONOMY', r.id, r.version, $4, 'pe-v1', ST_GeogFromText('POINT(74.35 31.52)'), ST_GeogFromText('POINT(74.27 31.47)'), false,
              7351, 1234, $5, 'PKR', 47000, 'EXCLUDED_DISCLOSED', true, 'PRICED', now() - $6::interval, now() - $6::interval + $7::interval, $8
         from pricing.rate_cards r where r.city_code = 'LHR' and r.product_code = 'ECONOMY' and r.status = 'ACTIVE'`,
      [id, randomUUID(), accountId, SYNTHETIC_CATALOG.zoneSetId, snapshot, createdAgo, ttl, createHash('sha256').update(id).digest()],
    );
    for (const [seq, kind, amount] of [
      [1, 'BASE', 46011],
      [5, 'BOOKING_FEE', 1000],
      [9, 'ROUNDING', -11],
    ] as const) {
      await c.query(`insert into pricing.quote_components (quote_id, seq, kind, amount_minor) values ($1, $2, $3, $4)`, [id, seq, kind, amount]);
    }
    await c.query('commit');
    return { id, snapshot };
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

describe('maintenance.purge — quote lifecycle (pricing doc §7; data model §5)', () => {
  it('expires, deletes past retention with components, removes unreferenced snapshots and expired polylines; a re-run is a no-op', async () => {
    const live = await quote('0 seconds');
    const expired = await quote('10 minutes');
    const old = await quote('40 days');
    const orphan = randomUUID();
    await owner.query(
      `insert into pricing.route_snapshots (id, provider_key, sku, routing_profile, fetched_at, cache_status, confidence, distance_m, duration_s, latency_ms, created_at)
       values ($1, 'geo-mock', 'ROUTE', 'CAR', now(), 'HIT', 'LOW', 100, 10, 1, now() - interval '40 days')`,
      [orphan],
    );
    const shortTerms = await quote('2 hours', '300 seconds', '1 hour');
    const first = await purgeOnce(worker, POLICY);
    // live is PRICED; expired, shortTerms and old were PRICED past expiry (old is then deleted in the same run)
    expect(first).toMatchObject({ quotesExpired: 3, quotesDeleted: 1, routeSnapshotsDeleted: 2, polylinesRemoved: 1 });
    const status = async (id: string) => (await owner.query<{ status: string }>(`select status from pricing.quotes where id = $1`, [id])).rows[0]?.status;
    expect(await status(live.id)).toBe('PRICED');
    expect(await status(expired.id)).toBe('EXPIRED');
    expect(await status(old.id)).toBeUndefined();
    expect((await owner.query(`select 1 from pricing.quote_components where quote_id = $1`, [old.id])).rowCount).toBe(0);
    expect((await owner.query(`select 1 from pricing.route_snapshots where id = any($1::uuid[])`, [[old.snapshot, orphan]])).rowCount).toBe(0);
    expect((await owner.query(`select polyline from pricing.route_snapshots where id = $1`, [shortTerms.snapshot])).rows).toEqual([{ polyline: null }]);
    expect((await owner.query(`select polyline from pricing.route_snapshots where id = $1`, [live.snapshot])).rows).toEqual([
      { polyline: 'synthetic_polyline' },
    ]);
    expect(await purgeOnce(worker, POLICY)).toMatchObject({ quotesExpired: 0, quotesDeleted: 0, routeSnapshotsDeleted: 0, polylinesRemoved: 0 });
  });

  it('bounded batches: a batch size of 1 deletes one old quote per run', async () => {
    await quote('41 days');
    await quote('42 days');
    expect((await purgeOnce(worker, { ...POLICY, batchSize: 1 })).quotesDeleted).toBe(1);
    expect((await purgeOnce(worker, { ...POLICY, batchSize: 1 })).quotesDeleted).toBe(1);
    expect((await purgeOnce(worker, { ...POLICY, batchSize: 1 })).quotesDeleted).toBe(0);
  });
});

let version = 100;
/** An APPROVED staff card for LHR/COMFORT (values within every CHECK; synthetic), optionally on another tax policy. */
async function approvedCard(tax: string = P.taxPolicyId, synthetic = true): Promise<string> {
  const id = randomUUID();
  version++;
  await owner.query(
    `insert into pricing.rate_cards (id, city_code, product_code, version, status, is_synthetic, source_reference, drafted_by_staff_id)
     values ($1, 'LHR', 'COMFORT', $2, 'DRAFT', $3, 'SYNTHETIC — not a Wayvro price', $4)`,
    [id, version, synthetic, drafter],
  );
  await owner.query(
    `insert into pricing.rate_card_components (rate_card_id, base_minor, per_km_minor, per_min_minor, minimum_fare_minor, booking_fee_minor, airport_pickup_fee_minor,
                                               rounding_step_minor, rounding_mode, toll_policy, tax_policy_id, quote_ttl_seconds, max_distance_m, max_duration_s)
     values ($1, 15000, 5000, 700, 35000, 1000, 20000, 1000, 'HALF_UP', 'EXCLUDED_DISCLOSED', $2, 300, 60000, 7200)`,
    [id, tax],
  );
  await owner.query(`update pricing.rate_cards set status = 'PENDING_APPROVAL' where id = $1`, [id]);
  await owner.query(`update pricing.rate_cards set status = 'APPROVED', approved_by_staff_id = $2, approval_reason_code = 'SYNTHETIC_REVIEWED' where id = $1`, [
    id,
    approver,
  ]);
  return id;
}
/** Schedules a card one second ahead and waits until it is due (the database never accepts a schedule in the past). */
async function scheduledDue(id: string): Promise<void> {
  await owner.query(`update pricing.rate_cards set effective_from = now() + interval '1 second', scheduled = true where id = $1`, [id]);
  await new Promise((r) => setTimeout(r, 1200));
}
const statusOf = async (id: string) =>
  (await owner.query<{ status: string; scheduled: boolean }>(`select status, scheduled from pricing.rate_cards where id = $1`, [id])).rows[0];

describe('config.scheduled-activation — rate cards', () => {
  it('activates a due card: previous ACTIVE retired, outbox event, SYSTEM audit, signal; a second pass does nothing', async () => {
    const id = await approvedCard();
    await scheduledDue(id);
    const activator = rateCardActivator({ pool: worker, env: 'test', log });
    expect(await activator.runDue()).toEqual({ applied: 1, refused: 0 });
    expect(await statusOf(id)).toEqual({ status: 'ACTIVE', scheduled: false });
    expect(await statusOf(P.comfortCardId)).toMatchObject({ status: 'RETIRED' });
    const event = await owner.query<{ payload: Record<string, unknown> }>(
      `select payload from platform.outbox_events where type = 'pricing.rate-card.activated.v1' and aggregate_id = $1`,
      [id],
    );
    expect(event.rows[0]?.payload).toMatchObject({ cityCode: 'LHR', productCode: 'COMFORT', previousRateCardId: P.comfortCardId, scheduled: true });
    expect(
      (await owner.query(`select actor_type, reason_code from audit.audit_events where action = 'RATE_CARD_ACTIVATED' and object_id = $1`, [id])).rows,
    ).toEqual([{ actor_type: 'SYSTEM', reason_code: 'SCHEDULED' }]);
    expect(logs.text()).toContain('RATE_CARD_ACTIVATED');
    expect(await activator.runDue()).toEqual({ applied: 0, refused: 0 });
  });

  it('re-checks every rule at run time: production refuses synthetic/placeholder; a retired tax policy is refused; refused cards are unscheduled and audited', async () => {
    const synthetic = await approvedCard();
    await scheduledDue(synthetic);
    expect(await rateCardActivator({ pool: worker, env: 'production', log }).runDue()).toEqual({ applied: 0, refused: 1 });
    expect(await statusOf(synthetic)).toEqual({ status: 'APPROVED', scheduled: false });
    expect(
      (await owner.query(`select reason_code from audit.audit_events where action = 'RATE_CARD_SCHEDULE_REFUSED' and object_id = $1`, [synthetic])).rows,
    ).toEqual([{ reason_code: 'SYNTHETIC_REFUSED_IN_PRODUCTION' }]);
    const tax = randomUUID();
    await owner.query(
      `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, is_placeholder) values ($1, 'SYNTH-TAX-W', 1, 'APPROVED', 'PK', 0, '{BASE}', false, true)`,
      [tax],
    );
    const onRetired = await approvedCard(tax);
    await scheduledDue(onRetired);
    await owner.query(`update pricing.tax_policies set status = 'RETIRED' where id = $1`, [tax]);
    expect(await rateCardActivator({ pool: worker, env: 'test', log }).runDue()).toEqual({ applied: 0, refused: 1 });
    expect(
      (await owner.query(`select reason_code from audit.audit_events where action = 'RATE_CARD_SCHEDULE_REFUSED' and object_id = $1`, [onRetired])).rows,
    ).toEqual([{ reason_code: 'TAX_POLICY_NOT_APPROVED' }]);
    expect(logs.text()).toContain('RATE_CARD_SCHEDULED_ACTIVATION_REFUSED');
  });

  it('scheduled vs manual activation race: exactly one winner, the loser sees a clean conflict (no APPROVED row left to activate)', async () => {
    const id = await approvedCard();
    await scheduledDue(id);
    /** The API's staff protocol as a wayvro_api member: lock, compare-and-set on APPROVED, retire previous, activate. */
    const manual = async (): Promise<'ACTIVATED' | 'CONFLICT'> => {
      const c = await api.connect();
      try {
        await c.query('begin');
        await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [rateCardActivationLockKey('LHR', 'COMFORT')]);
        const row = await c.query(`select 1 from pricing.rate_cards where id = $1 and status = 'APPROVED' for update`, [id]);
        if (row.rowCount === 0) {
          await c.query('rollback');
          return 'CONFLICT';
        }
        await c.query(
          `update pricing.rate_cards set status = 'RETIRED', effective_until = now() where city_code = 'LHR' and product_code = 'COMFORT' and status = 'ACTIVE'`,
        );
        await c.query(`update pricing.rate_cards set status = 'ACTIVE', effective_from = now(), scheduled = false where id = $1`, [id]);
        await c.query('commit');
        return 'ACTIVATED';
      } finally {
        c.release();
      }
    };
    const [scheduled, staff] = await Promise.all([rateCardActivator({ pool: worker, env: 'test', log }).runDue(), manual()]);
    expect(scheduled.applied + (staff === 'ACTIVATED' ? 1 : 0)).toBe(1);
    expect(await statusOf(id)).toMatchObject({ status: 'ACTIVE' });
    expect(
      (await owner.query(`select count(*)::int n from pricing.rate_cards where city_code = 'LHR' and product_code = 'COMFORT' and status = 'ACTIVE'`)).rows[0],
    ).toEqual({
      n: 1,
    });
  });
});
