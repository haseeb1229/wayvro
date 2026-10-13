/**
 * Migration 0012_pricing against real PostgreSQL/PostGIS: clean → latest, every previous schema state → latest, re-run
 * as a no-op, a live 0011 database with a synthetic catalog upgrading without touching existing rows; database
 * invariants (TRIG-P3: maker-checker CHECKs, one ACTIVE card per city/product, component immutability after DRAFT, tax
 * policy APPROVED at submission, no back-dating, quote immutability except PRICED→EXPIRED|SUPERSEDED, append-only
 * components, sign CHECKs, deferred Σ(components) = total that tolerates a purged parent) and grants executed as LOGIN
 * members of the restricted roles (GRANT-P3). Throwaway databases; synthetic data only (no real rate or tax value).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRestrictedLogin, createTestDatabase, seedSyntheticCatalog, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';
import { MIGRATION_TAGS, TOTAL_MIGRATIONS, migrateFirst } from './journal.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required for integration tests (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;
/** The schema state just before 0012 (pinned by tag, so later migrations never shift it). */
const BEFORE_0012 = MIGRATION_TAGS.indexOf('0012_pricing');

const pgCode = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

let database: TestDatabase;
let owner: pg.Pool;
let api: pg.Pool;
let worker: pg.Pool;
let realtime: pg.Pool;
let vault: pg.Pool;
const logins: RestrictedLogin[] = [];
async function poolAs(url: string, group: string): Promise<pg.Pool> {
  const login = await createRestrictedLogin(adminUrl, url, group);
  logins.push(login);
  return new pg.Pool({ connectionString: login.url, max: 3 });
}

async function staffAccount(q: pg.Pool): Promise<string> {
  const id = randomUUID();
  await q.query(`insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'Synthetic', $2, 'ACTIVE', now())`, [
    id,
    `s.${randomBytes(4).toString('hex')}@example.org`,
  ]);
  return id;
}

async function account(q: pg.Pool): Promise<string> {
  const id = randomUUID();
  await q.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [id]);
  return id;
}

let zoneSetId: string;
let taxId: string;
let cardSeq = 0;
let taxSeq = 0;

/** An APPROVED (or other status) tax policy inserted by the owner (seed path admits non-DRAFT inserts). */
async function taxPolicy(status: 'DRAFT' | 'APPROVED' = 'APPROVED', drafter: string | null = null): Promise<string> {
  const id = randomUUID();
  taxSeq++;
  await owner.query(
    `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, rounding_mode, is_placeholder, drafted_by_staff_id)
     values ($1, 'SYNTH-TAX-T', $2, $3, 'PK-PB', 0, '{BASE,DISTANCE,TIME}', false, 'HALF_EVEN', true, $4)`,
    [id, taxSeq, status, drafter],
  );
  return id;
}

const COMPONENTS = `insert into pricing.rate_card_components (rate_card_id, base_minor, per_km_minor, per_min_minor, minimum_fare_minor, booking_fee_minor,
  airport_pickup_fee_minor, rounding_step_minor, rounding_mode, toll_policy, tax_policy_id, quote_ttl_seconds, max_distance_m, max_duration_s)
  values ($1, 10000, 3500, 500, 25000, 1000, 20000, 1000, 'HALF_UP', 'EXCLUDED_DISCLOSED', $2, 300, 60000, 7200)`;

/** A DRAFT card (staff-drafted unless `drafter` is null ⇒ synthetic system row) with its components. */
async function draftCard(
  q: pg.Pool,
  drafter: string | null,
  options: { product?: string; tax?: string; synthetic?: boolean; components?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  cardSeq++;
  await q.query(
    `insert into pricing.rate_cards (id, city_code, product_code, version, status, is_synthetic, source_reference, drafted_by_staff_id)
     values ($1, 'LHR', $2, $3, 'DRAFT', $4, 'SYNTHETIC — not a Wayvro price', $5)`,
    [id, options.product ?? 'ECONOMY', cardSeq, options.synthetic ?? drafter === null, drafter],
  );
  if (options.components !== false) await q.query(COMPONENTS, [id, options.tax ?? taxId]);
  return id;
}
const card = (q: pg.Pool, id: string, set: string, params: unknown[] = []) => q.query(`update pricing.rate_cards set ${set} where id = $1`, [id, ...params]);

async function approvedCard(q: pg.Pool, drafter: string, approver: string, product = 'ECONOMY'): Promise<string> {
  const id = await draftCard(q, drafter, { product });
  await card(q, id, `status = 'PENDING_APPROVAL'`);
  await card(q, id, `status = 'APPROVED', approved_by_staff_id = $2, approval_reason_code = 'SYNTHETIC_REVIEWED'`, [approver]);
  return id;
}

/** The single ACTIVE synthetic card used by the quote tests (system-seeded path, owner only). */
let activeCardId: string;
let activeCardVersion: number;

async function snapshot(q: pg.Pool | pg.PoolClient, polyline: string | null = 'synthetic_polyline'): Promise<string> {
  const id = randomUUID();
  await q.query(
    `insert into pricing.route_snapshots (id, provider_key, sku, routing_profile, fetched_at, cache_status, confidence, distance_m, duration_s, polyline, latency_ms)
     values ($1, 'geo-mock', 'ROUTE', 'CAR', now(), 'MISS', 'LOW', 7351, 1234, $2, 12)`,
    [id, polyline],
  );
  return id;
}

const hash = () => createHash('sha256').update(randomUUID()).digest();

/** Inserts a quote (and optionally its components) in the given client's open transaction. */
async function insertQuote(
  q: pg.PoolClient | pg.Pool,
  accountId: string,
  snapshotId: string,
  total: bigint,
  options: { expiresIn?: string; createdAgo?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await q.query(
    `insert into pricing.quotes (id, quote_group_id, account_id, city_code, product_code, rate_card_id, rate_card_version, zone_set_id, pricing_engine_version,
                                 pickup, dropoff, airport_pickup, distance_m, duration_s, route_snapshot_id, currency, total_minor, toll_policy, is_synthetic,
                                 status, created_at, expires_at, request_hash)
     values ($1, $2, $3, 'LHR', 'ECONOMY', $4, $5, $6, 'pe-v1', ST_GeogFromText('POINT(74.35 31.52)'), ST_GeogFromText('POINT(74.27 31.47)'), false,
             7351, 1234, $7, 'PKR', $8, 'EXCLUDED_DISCLOSED', true, 'PRICED', now() - $9::interval, now() - $9::interval + $10::interval, $11)`,
    [
      id,
      randomUUID(),
      accountId,
      activeCardId,
      activeCardVersion,
      zoneSetId,
      snapshotId,
      total.toString(),
      options.createdAgo ?? '0 seconds',
      options.expiresIn ?? '300 seconds',
      hash(),
    ],
  );
  return id;
}
const component = (q: pg.PoolClient | pg.Pool, quoteId: string, seq: number, kind: string, amount: bigint | number) =>
  q.query(`insert into pricing.quote_components (quote_id, seq, kind, amount_minor) values ($1, $2, $3, $4)`, [quoteId, seq, kind, amount.toString()]);

/** A balanced quote (BASE 46011 + BOOKING 1000 + ROUNDING −11 = 47000) committed in one transaction. */
async function balancedQuote(q: pg.Pool, accountId: string, options: { expiresIn?: string; createdAgo?: string } = {}): Promise<string> {
  const c = await q.connect();
  try {
    await c.query('begin');
    const snap = await snapshot(c);
    const id = await insertQuote(c, accountId, snap, 47000n, options);
    await component(c, id, 1, 'BASE', 46011);
    await component(c, id, 5, 'BOOKING_FEE', 1000);
    await component(c, id, 9, 'ROUNDING', -11);
    await c.query('commit');
    return id;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

/** Runs `work` and COMMIT in one transaction on `pool`; returns the SQLSTATE of the first failure (undefined = committed). */
async function commitCode(pool: pg.Pool, work: (c: pg.PoolClient) => Promise<void>): Promise<string | undefined> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    return await pgCode(
      (async () => {
        await work(c);
        await c.query('commit');
      })(),
    );
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 4 });
  api = await poolAs(database.url, 'wayvro_api');
  worker = await poolAs(database.url, 'wayvro_worker');
  realtime = await poolAs(database.url, 'wayvro_realtime');
  vault = await poolAs(database.url, 'wayvro_vault');
  zoneSetId = randomUUID();
  await owner.query(
    `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference) values ($1, 'LHR', 1, 'DRAFT', true, 'SYNTHETIC — not real Lahore boundaries')`,
    [zoneSetId],
  );
  taxId = await taxPolicy();
  // the ACTIVE synthetic card of LHR/ECONOMY for the quote tests (system-seeded: no staff, synthetic, migrator path)
  activeCardId = await draftCard(owner, null);
  await card(owner, activeCardId, `status = 'ACTIVE', effective_from = clock_timestamp()`);
  activeCardVersion = cardSeq;
});
afterAll(async () => {
  await Promise.all([owner.end(), api.end(), worker.end(), realtime.end(), vault.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

describe('0012 upgrade path', () => {
  it('0012 sits between 0011 and 0013 in the journal', () => {
    expect(MIGRATION_TAGS.slice(BEFORE_0012 - 1, BEFORE_0012 + 2)).toEqual(['0011_geo_controls', '0012_pricing', '0013_platform_release_controls']);
  });

  it('every previous schema state upgrades to latest, then re-runs as a no-op', async () => {
    for (let n = 0; n < TOTAL_MIGRATIONS; n++) {
      const previous = await createTestDatabase(adminUrl);
      try {
        if (n > 0) await migrateFirst(previous.url, n);
        expect(await runMigrations(previous.url)).toEqual({ appliedBefore: n, appliedAfter: TOTAL_MIGRATIONS });
        expect(await runMigrations(previous.url)).toEqual({ appliedBefore: TOTAL_MIGRATIONS, appliedAfter: TOTAL_MIGRATIONS });
      } finally {
        await previous.drop();
      }
    }
  }, 300_000);

  it('a live 0011 database with a synthetic catalog upgrades without touching existing rows, and pricing works against it', async () => {
    const previous = await createTestDatabase(adminUrl);
    try {
      await migrateFirst(previous.url, BEFORE_0012);
      const pool = new pg.Pool({ connectionString: previous.url, max: 1 });
      const checksum = async (p: pg.Pool) =>
        (
          await p.query<{ t: string; h: string }>(
            `select 'zone_sets' t, md5(string_agg(z::text, '|' order by z.id)) h from catalog.zone_sets z
             union all select 'zones', md5(string_agg(z::text, '|' order by z.id)) from catalog.zones z
             union all select 'city_service_products', md5(string_agg(c::text, '|' order by c.city_code, c.product_code)) from catalog.city_service_products c
             union all select 'accounts', md5(string_agg(a::text, '|' order by a.id)) from identity.accounts a`,
          )
        ).rows;
      let before: Array<{ t: string; h: string }>;
      try {
        expect((await pool.query(`select to_regclass('pricing.quotes') r`)).rows[0]).toEqual({ r: null });
        // the dev-only seed writes the synthetic catalog and skips pricing while the schema does not exist yet
        await seedSyntheticCatalog({ env: 'test', databaseUrl: previous.url });
        await account(pool);
        before = await checksum(pool);
      } finally {
        await pool.end();
      }
      expect(await runMigrations(previous.url)).toEqual({ appliedBefore: BEFORE_0012, appliedAfter: TOTAL_MIGRATIONS });
      const after = new pg.Pool({ connectionString: previous.url, max: 1 });
      try {
        expect(await checksum(after)).toEqual(before);
        // nothing is seeded by the migration
        for (const t of ['tax_policies', 'rate_cards', 'rate_card_components', 'route_snapshots', 'quotes', 'quote_components']) {
          expect((await after.query(`select count(*)::int n from pricing.${t}`)).rows[0]).toEqual({ n: 0 });
        }
        // re-running the seed converges: synthetic pricing is added against the pre-existing city products
        await seedSyntheticCatalog({ env: 'test', databaseUrl: previous.url });
        expect((await after.query(`select product_code, status, is_synthetic from pricing.rate_cards order by product_code`)).rows).toEqual([
          { product_code: 'COMFORT', status: 'ACTIVE', is_synthetic: true },
          { product_code: 'ECONOMY', status: 'ACTIVE', is_synthetic: true },
        ]);
        expect((await after.query(`select code, status, rate_bp, is_placeholder from pricing.tax_policies`)).rows).toEqual([
          { code: 'SYNTH-TAX-0', status: 'APPROVED', rate_bp: 0, is_placeholder: true },
        ]);
        await seedSyntheticCatalog({ env: 'test', databaseUrl: previous.url });
        expect((await after.query(`select count(*)::int n from pricing.rate_cards`)).rows[0]).toEqual({ n: 2 });
      } finally {
        await after.end();
      }
    } finally {
      await previous.drop();
    }
  });

  it('synthetic seed: the quote TTL and all-day hours options (SP-08 E2E stack) apply to new rows; the TTL is range-checked before connecting', async () => {
    for (const quoteTtlSeconds of [59, 1801, 60.5])
      await expect(seedSyntheticCatalog({ env: 'test', databaseUrl: 'postgres://u:p@127.0.0.1:1/none', quoteTtlSeconds })).rejects.toThrow(/quoteTtlSeconds/);
    const db = await createTestDatabase(adminUrl);
    try {
      await runMigrations(db.url);
      await seedSyntheticCatalog({ env: 'test', databaseUrl: db.url, quoteTtlSeconds: 60, allDayServiceHours: true });
      const pool = new pg.Pool({ connectionString: db.url, max: 1 });
      try {
        const ttl = await pool.query(
          `select distinct c.quote_ttl_seconds t from pricing.rate_card_components c join pricing.rate_cards r on r.id = c.rate_card_id`,
        );
        expect(ttl.rows).toEqual([{ t: 60 }]);
        const hours = await pool.query(`select distinct opens_local::text o, closes_local::text c from catalog.service_hours`);
        expect(hours.rows).toEqual([{ o: '00:00:00', c: '00:00:00' }]);
      } finally {
        await pool.end();
      }
    } finally {
      await db.drop();
    }
  });

  it('PostGIS columns carry the declared typmods', async () => {
    const r = await owner.query<{ c: string; t: string }>(
      `select a.attrelid::regclass::text || '.' || a.attname c, format_type(a.atttypid, a.atttypmod) t from pg_attribute a
        where a.attrelid in ('pricing.quotes'::regclass, 'pricing.route_snapshots'::regclass) and a.attname in ('pickup', 'dropoff', 'bbox') order by 1`,
    );
    expect(r.rows).toEqual([
      { c: 'pricing.quotes.dropoff', t: 'geography(Point,4326)' },
      { c: 'pricing.quotes.pickup', t: 'geography(Point,4326)' },
      { c: 'pricing.route_snapshots.bbox', t: 'geometry(Polygon,4326)' },
    ]);
  });
});

describe('tax policies (TRIG-P3)', () => {
  it('maker-checker: the guard and the CHECK both refuse drafter = approver; a non-placeholder needs a legal reference', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    const id = randomUUID();
    await api.query(
      `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, is_placeholder, drafted_by_staff_id)
       values ($1, 'SYNTH-TAX-MC', 1, 'DRAFT', 'PK', 0, '{BASE}', false, true, $2)`,
      [id, a],
    );
    await api.query(`update pricing.tax_policies set status = 'PENDING_APPROVAL' where id = $1`, [id]);
    expect(await pgCode(api.query(`update pricing.tax_policies set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [id, a]))).toBe('42501');
    // the CHECK alone (owner insert bypasses the DRAFT-only insert rule but not the CHECK)
    expect(
      await pgCode(
        owner.query(
          `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, is_placeholder, drafted_by_staff_id, approved_by_staff_id)
           values ($1, 'SYNTH-TAX-MC', 2, 'APPROVED', 'PK', 0, '{BASE}', false, true, $2, $2)`,
          [randomUUID(), a],
        ),
      ),
    ).toBe('23514');
    await api.query(`update pricing.tax_policies set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [id, b]);
    expect(
      await pgCode(
        api.query(
          `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, is_placeholder, drafted_by_staff_id)
           values ($1, 'SYNTH-TAX-MC', 3, 'DRAFT', 'PK', 0, '{BASE}', false, false, $2)`,
          [randomUUID(), a],
        ),
      ),
    ).toBe('23514');
    // applies_to only names taxable kinds; rate within 0..10000 bp
    expect(
      await pgCode(
        api.query(
          `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, is_placeholder, drafted_by_staff_id)
           values ($1, 'SYNTH-TAX-MC', 4, 'DRAFT', 'PK', 0, '{ROUNDING}', false, true, $2)`,
          [randomUUID(), a],
        ),
      ),
    ).toBe('23514');
    // the minimum top-up is taxable only together with BASE, DISTANCE and TIME (monotonic totals, PROP-QUOTE P-06)
    expect(
      await pgCode(
        api.query(
          `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, is_placeholder, drafted_by_staff_id)
           values ($1, 'SYNTH-TAX-MC', 5, 'DRAFT', 'PK', 0, '{MINIMUM_ADJUSTMENT}', false, true, $2)`,
          [randomUUID(), a],
        ),
      ),
    ).toBe('23514');
    await api.query(
      `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, is_placeholder, drafted_by_staff_id)
       values ($1, 'SYNTH-TAX-MC', 6, 'DRAFT', 'PK', 0, '{BASE,DISTANCE,TIME,MINIMUM_ADJUSTMENT}', false, true, $2)`,
      [randomUUID(), a],
    );
  });

  it('a new policy starts as DRAFT; values are immutable; no delete; REJECTED is terminal', async () => {
    const a = await staffAccount(owner);
    const insert = (status: string, version: number) =>
      api.query(
        `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, is_placeholder, drafted_by_staff_id)
         values ($1, 'SYNTH-TAX-IM', $2, $3, 'PK', 0, '{BASE}', false, true, $4) returning id`,
        [randomUUID(), version, status, a],
      );
    expect(await pgCode(insert('APPROVED', 1))).toBe('42501');
    const id = (await insert('DRAFT', 2)).rows[0]?.id as string;
    expect(await pgCode(api.query(`update pricing.tax_policies set status = 'DRAFT', version_lock = 2 where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(owner.query(`update pricing.tax_policies set rate_bp = 5 where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(owner.query(`delete from pricing.tax_policies where id = $1`, [id]))).toBe('42501');
    await api.query(`update pricing.tax_policies set status = 'PENDING_APPROVAL' where id = $1`, [id]);
    await api.query(`update pricing.tax_policies set status = 'REJECTED' where id = $1`, [id]);
    expect(await pgCode(api.query(`update pricing.tax_policies set status = 'PENDING_APPROVAL' where id = $1`, [id]))).toBe('42501');
  });

  it('retirement is refused while an ACTIVE rate card references the policy', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    const tax = await taxPolicy('APPROVED');
    const id = await draftCard(api, a, { product: 'COMFORT', tax });
    await card(api, id, `status = 'PENDING_APPROVAL'`);
    await card(api, id, `status = 'APPROVED', approved_by_staff_id = $2, approval_reason_code = 'SYNTHETIC_REVIEWED'`, [b]);
    await card(api, id, `status = 'ACTIVE', effective_from = now()`);
    expect(await pgCode(api.query(`update pricing.tax_policies set status = 'RETIRED' where id = $1`, [tax]))).toBe('42501');
    await card(api, id, `status = 'RETIRED', effective_until = now()`);
    await api.query(`update pricing.tax_policies set status = 'RETIRED' where id = $1`, [tax]);
  });
});

describe('rate cards (TRIG-P3)', () => {
  it('a new card starts as DRAFT; maker-checker by guard and CHECK; approval needs a reason code', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    expect(
      await pgCode(
        api.query(
          `insert into pricing.rate_cards (id, city_code, product_code, version, status, is_synthetic, source_reference, drafted_by_staff_id)
           values ($1, 'LHR', 'ECONOMY', 900, 'ACTIVE', false, 'Synthetic test source', $2)`,
          [randomUUID(), a],
        ),
      ),
    ).toBe('42501');
    const id = await draftCard(api, a);
    await card(api, id, `status = 'PENDING_APPROVAL'`);
    expect(await pgCode(card(api, id, `status = 'APPROVED', approved_by_staff_id = $2, approval_reason_code = 'SYNTHETIC_REVIEWED'`, [a]))).toBe('42501');
    expect(await pgCode(card(api, id, `status = 'APPROVED', approved_by_staff_id = $2`, [b]))).toBe('42501');
    expect(
      await pgCode(
        owner.query(
          `insert into pricing.rate_cards (id, city_code, product_code, version, status, is_synthetic, source_reference, drafted_by_staff_id, approved_by_staff_id,
                                           approval_reason_code)
           values ($1, 'LHR', 'ECONOMY', 901, 'APPROVED', false, 'Synthetic test source', $2, $2, 'SYNTHETIC_REVIEWED')`,
          [randomUUID(), a],
        ),
      ),
    ).toBe('23514');
    await card(api, id, `status = 'APPROVED', approved_by_staff_id = $2, approval_reason_code = 'SYNTHETIC_REVIEWED'`, [b]);
    expect(await pgCode(owner.query(`delete from pricing.rate_cards where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(owner.query(`update pricing.rate_cards set source_reference = 'changed source' where id = $1`, [id]))).toBe('42501');
    // a staff-less row must be synthetic
    expect(
      await pgCode(
        owner.query(
          `insert into pricing.rate_cards (id, city_code, product_code, version, status, is_synthetic, source_reference) values ($1, 'LHR', 'ECONOMY', 902, 'DRAFT', false, 'x source')`,
          [randomUUID()],
        ),
      ),
    ).toBe('23514');
  });

  it('components: one row per card, editable only while the card is DRAFT; the rounding step divides the minimum fare', async () => {
    const a = await staffAccount(owner);
    const id = await draftCard(api, a, { components: false });
    expect(
      await pgCode(
        api.query(
          `insert into pricing.rate_card_components (rate_card_id, base_minor, per_km_minor, per_min_minor, minimum_fare_minor, booking_fee_minor, airport_pickup_fee_minor,
                                                     rounding_step_minor, rounding_mode, toll_policy, tax_policy_id, quote_ttl_seconds, max_distance_m, max_duration_s)
           values ($1, 10000, 3500, 500, 25500, 1000, 0, 1000, 'HALF_UP', 'NOT_APPLICABLE', $2, 300, 60000, 7200)`,
          [id, taxId],
        ),
      ),
    ).toBe('23514');
    await api.query(COMPONENTS, [id, taxId]);
    // draft editing = delete + insert
    await api.query(`delete from pricing.rate_card_components where rate_card_id = $1`, [id]);
    await api.query(COMPONENTS, [id, taxId]);
    expect(await pgCode(api.query(COMPONENTS, [id, taxId]))).toBe('23505');
    await card(api, id, `status = 'PENDING_APPROVAL'`);
    expect(await pgCode(owner.query(`update pricing.rate_card_components set base_minor = 1 where rate_card_id = $1`, [id]))).toBe('42501');
    expect(await pgCode(api.query(`delete from pricing.rate_card_components where rate_card_id = $1`, [id]))).toBe('42501');
    // amounts are bounded and non-negative
    const other = await draftCard(api, a, { components: false });
    expect(
      await pgCode(
        api.query(
          `insert into pricing.rate_card_components (rate_card_id, base_minor, per_km_minor, per_min_minor, minimum_fare_minor, booking_fee_minor, airport_pickup_fee_minor,
                                                     rounding_step_minor, rounding_mode, toll_policy, tax_policy_id, quote_ttl_seconds, max_distance_m, max_duration_s)
           values ($1, -1, 3500, 500, 25000, 1000, 0, 1000, 'HALF_UP', 'NOT_APPLICABLE', $2, 300, 60000, 7200)`,
          [other, taxId],
        ),
      ),
    ).toBe('23514');
  });

  it('a card referencing a DRAFT tax policy (or without components) cannot be submitted', async () => {
    const a = await staffAccount(owner);
    const draftTax = await taxPolicy('DRAFT', a);
    const id = await draftCard(api, a, { tax: draftTax });
    expect(await pgCode(card(api, id, `status = 'PENDING_APPROVAL'`))).toBe('42501');
    const empty = await draftCard(api, a, { components: false });
    expect(await pgCode(card(api, empty, `status = 'PENDING_APPROVAL'`))).toBe('42501');
  });

  it('one ACTIVE card per (city, product); activation never back-dated; schedules never in the past; ACTIVE needs effective_from', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    // ECONOMY already has the synthetic ACTIVE card
    const second = await approvedCard(api, a, b);
    expect(await pgCode(card(api, second, `status = 'ACTIVE', effective_from = now()`))).toBe('23505');
    expect(await pgCode(card(api, second, `status = 'ACTIVE', effective_from = now() - interval '1 day'`))).toBe('42501');
    expect(await pgCode(card(api, second, `status = 'ACTIVE'`))).toBe('42501');
    expect(await pgCode(card(api, second, `effective_from = now() - interval '1 hour', scheduled = true`))).toBe('42501');
    await card(api, second, `effective_from = now() + interval '1 hour', scheduled = true`);
    expect(await pgCode(card(api, second, `status = 'RETIRED'`))).toBe('42501');
    await card(api, second, `effective_from = null, scheduled = false`);
    await card(api, second, `status = 'RETIRED'`);
    expect(await pgCode(card(api, second, `status = 'APPROVED'`))).toBe('42501');
    // a DRAFT cannot be scheduled
    const draft = await draftCard(api, a);
    expect(await pgCode(card(api, draft, `effective_from = now() + interval '1 hour', scheduled = true`))).toBe('42501');
    // the seed path (DRAFT -> ACTIVE) is refused for application roles
    const synthetic = await draftCard(api, null);
    expect(await pgCode(card(api, synthetic, `status = 'ACTIVE', effective_from = now()`))).toBe('42501');
  });

  it('CONC-PRICING: two concurrent activations of different APPROVED cards for one (city, product) leave exactly one ACTIVE', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    const [x, y] = [await approvedCard(api, a, b, 'COMFORT'), await approvedCard(api, a, b, 'COMFORT')];
    const results = await Promise.allSettled([x, y].map((id) => card(api, id, `status = 'ACTIVE', effective_from = now()`)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: '23505' });
    expect(
      (await owner.query(`select count(*)::int n from pricing.rate_cards where city_code = 'LHR' and product_code = 'COMFORT' and status = 'ACTIVE'`)).rows[0],
    ).toEqual({ n: 1 });
    // retire it again for the other tests
    await owner.query(`update pricing.rate_cards set status = 'RETIRED', effective_until = now() where product_code = 'COMFORT' and status = 'ACTIVE'`);
  });

  it('submission preview and envelope override are recorded only by the submission', async () => {
    const a = await staffAccount(owner);
    const id = await draftCard(api, a);
    expect(await pgCode(card(api, id, `submission_preview = '{"rows":[]}'`))).toBe('42501');
    await card(api, id, `status = 'PENDING_APPROVAL', submission_preview = '{"rows":[]}', envelope_override_reason_code = 'MARKET_REVIEW'`);
    expect(await pgCode(card(api, id, `submission_preview = '{"rows":[1]}'`))).toBe('42501');
  });
});

describe('quotes (TRIG-P3)', () => {
  it('Σ(components) ≠ total is accepted mid-transaction and rejected at COMMIT; a quote without components is rejected', async () => {
    const acct = await account(owner);
    expect(
      await commitCode(api, async (c) => {
        const snap = await snapshot(c);
        const id = await insertQuote(c, acct, snap, 47000n);
        await component(c, id, 1, 'BASE', 46011);
        // still unbalanced inside the transaction: the statement succeeds
        expect((await c.query(`select sum(amount_minor)::text s from pricing.quote_components where quote_id = $1`, [id])).rows[0]).toEqual({ s: '46011' });
      }),
    ).toBe('23514');
    expect(
      await commitCode(api, async (c) => {
        await insertQuote(c, acct, await snapshot(c), 47000n);
      }),
    ).toBe('23514');
    expect(
      await commitCode(api, async (c) => {
        const id = await insertQuote(c, acct, await snapshot(c), 47000n);
        await component(c, id, 1, 'BASE', 46011);
        await component(c, id, 5, 'BOOKING_FEE', 1000);
        await component(c, id, 9, 'ROUNDING', -11);
      }),
    ).toBeUndefined();
  });

  it('sign CHECKs: only ROUNDING may be negative; DISCOUNT is reserved and never positive; kinds unique per quote', async () => {
    const acct = await account(owner);
    const attempt = (rows: ReadonlyArray<readonly [number, string, number]>, total: bigint) =>
      commitCode(api, async (c) => {
        const id = await insertQuote(c, acct, await snapshot(c), total);
        for (const [seq, kind, amount] of rows) await component(c, id, seq, kind, amount);
      });
    expect(await attempt([[1, 'BASE', -5]], 0n)).toBe('23514');
    expect(await attempt([[1, 'DISCOUNT', 5]], 5n)).toBe('23514');
    expect(
      await attempt(
        [
          [1, 'BASE', 10],
          [2, 'BASE', 10],
        ],
        20n,
      ),
    ).toBe('23505');
    expect(
      await attempt(
        [
          [1, 'BASE', 1000],
          [9, 'ROUNDING', -400],
        ],
        600n,
      ),
    ).toBeUndefined();
    // a quote total is never negative
    expect(await attempt([[9, 'ROUNDING', -1]], -1n)).toBe('23514');
  });

  it('immutable except status PRICED→EXPIRED|SUPERSEDED; components append-only; the quote names the ACTIVE card', async () => {
    const acct = await account(owner);
    const id = await balancedQuote(api, acct);
    expect(await pgCode(owner.query(`update pricing.quotes set total_minor = 1 where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(api.query(`update pricing.quotes set total_minor = 1 where id = $1`, [id]))).toBe('42501');
    await api.query(`update pricing.quotes set status = 'EXPIRED' where id = $1`, [id]);
    expect(await pgCode(api.query(`update pricing.quotes set status = 'PRICED' where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(api.query(`update pricing.quotes set status = 'SUPERSEDED' where id = $1`, [id]))).toBe('42501');
    const other = await balancedQuote(api, acct);
    await api.query(`update pricing.quotes set status = 'SUPERSEDED' where id = $1`, [other]);
    expect(await pgCode(owner.query(`update pricing.quote_components set amount_minor = 0 where quote_id = $1 and seq = 1`, [id]))).toBe('42501');
    // a quote is created PRICED and names the ACTIVE card of its city/product (version included)
    expect(
      await commitCode(api, async (c) => {
        const snap = await snapshot(c);
        await c.query(
          `insert into pricing.quotes (id, quote_group_id, account_id, city_code, product_code, rate_card_id, rate_card_version, zone_set_id, pricing_engine_version,
                                       pickup, dropoff, airport_pickup, distance_m, duration_s, route_snapshot_id, currency, total_minor, toll_policy, is_synthetic,
                                       status, created_at, expires_at, request_hash)
           values ($1, $2, $3, 'LHR', 'ECONOMY', $4, $5, $6, 'pe-v1', ST_GeogFromText('POINT(74.35 31.52)'), ST_GeogFromText('POINT(74.27 31.47)'), false,
                   7351, 1234, $7, 'PKR', 1, 'EXCLUDED_DISCLOSED', true, 'PRICED', now(), now() + interval '5 minutes', $8)`,
          [randomUUID(), randomUUID(), acct, activeCardId, activeCardVersion + 1000, zoneSetId, snap, hash()],
        );
      }),
    ).toBe('42501');
  });

  it('route snapshots are immutable except removing the polyline', async () => {
    const snap = await snapshot(owner);
    expect(await pgCode(owner.query(`update pricing.route_snapshots set distance_m = 1 where id = $1`, [snap]))).toBe('42501');
    expect(await pgCode(worker.query(`update pricing.route_snapshots set polyline = 'other' where id = $1`, [snap]))).toBe('42501');
    await worker.query(`update pricing.route_snapshots set polyline = null where id = $1`, [snap]);
    expect(await pgCode(owner.query(`update pricing.route_snapshots set polyline = 'back' where id = $1`, [snap]))).toBe('42501');
    expect(
      await pgCode(
        owner.query(
          `insert into pricing.route_snapshots (id, provider_key, sku, routing_profile, fetched_at, cache_status, confidence, distance_m, duration_s, latency_ms)
       values ($1, 'geo-mock', 'ROUTE', 'CAR', now(), 'STALE_SERVED', 'LOW', 1, 1, 1)`,
          [randomUUID()],
        ),
      ),
    ).toBe('23514');
  });
});

describe('grants (GRANT-P3, least privilege)', () => {
  it('wayvro_api: inserts quotes, updates only their status, never deletes quotes, snapshots or configuration', async () => {
    const acct = await account(owner);
    const id = await balancedQuote(api, acct);
    expect(await pgCode(api.query(`delete from pricing.quotes where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(api.query(`delete from pricing.quote_components where quote_id = $1`, [id]))).toBe('42501');
    expect(await pgCode(api.query(`delete from pricing.route_snapshots`))).toBe('42501');
    expect(await pgCode(api.query(`update pricing.route_snapshots set polyline = null`))).toBe('42501');
    expect(await pgCode(api.query(`update pricing.quotes set expires_at = now() where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(api.query(`delete from pricing.rate_cards`))).toBe('42501');
    expect(await pgCode(api.query(`delete from pricing.tax_policies`))).toBe('42501');
    expect(await pgCode(api.query(`update pricing.rate_cards set source_reference = 'x'`))).toBe('42501');
    expect(await pgCode(api.query(`update pricing.tax_policies set rate_bp = 1`))).toBe('42501');
  });

  it('wayvro_worker: purges an expired quote with its components in one transaction (the deferred Σ trigger tolerates the vanished parent)', async () => {
    const acct = await account(owner);
    const expired = await balancedQuote(owner, acct, { createdAgo: '40 days', expiresIn: '300 seconds' });
    const live = await balancedQuote(owner, acct);
    const snap = (await owner.query<{ s: string }>(`select route_snapshot_id s from pricing.quotes where id = $1`, [expired])).rows[0]?.s;
    expect(
      await commitCode(worker, async (c) => {
        await c.query(`delete from pricing.quote_components where quote_id = $1`, [expired]);
        await c.query(`delete from pricing.quotes where id = $1`, [expired]);
        await c.query(`delete from pricing.route_snapshots where id = $1`, [snap]);
      }),
    ).toBeUndefined();
    expect((await owner.query(`select 1 from pricing.quotes where id = $1`, [expired])).rowCount).toBe(0);
    // deleting only the components of a quote that remains fails at COMMIT; a live quote cannot be deleted at all
    expect(
      await commitCode(worker, async (c) => {
        await c.query(`delete from pricing.quote_components where quote_id = $1`, [live]);
      }),
    ).toBe('23514');
    expect(
      await commitCode(worker, async (c) => {
        await c.query(`delete from pricing.quote_components where quote_id = $1`, [live]);
        await c.query(`delete from pricing.quotes where id = $1`, [live]);
      }),
    ).toBe('42501');
    await worker.query(`update pricing.quotes set status = 'EXPIRED' where id = $1`, [live]);
  });

  it('wayvro_worker: scheduled-activation columns only; no drafting, approving, value edits or inserts', async () => {
    const [a, b] = [await staffAccount(owner), await staffAccount(owner)];
    const id = await approvedCard(api, a, b, 'COMFORT');
    await card(api, id, `effective_from = now() + interval '1 minute', scheduled = true`);
    await worker.query(
      `update pricing.rate_cards set status = 'ACTIVE', effective_from = now(), scheduled = false, version_lock = version_lock + 1 where id = $1`,
      [id],
    );
    expect(await pgCode(worker.query(`update pricing.rate_cards set approved_by_staff_id = null where id = $1`, [id]))).toBe('42501');
    expect(await pgCode(worker.query(`select source_reference from pricing.rate_cards`))).toBe('42501');
    expect(await pgCode(worker.query(`select * from pricing.rate_card_components`))).toBe('42501');
    expect(
      await pgCode(
        worker.query(
          `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, is_placeholder)
       values ($1, 'SYNTH-W', 1, 'DRAFT', 'PK', 0, '{BASE}', false, true)`,
          [randomUUID()],
        ),
      ),
    ).toBe('42501');
    expect(await pgCode(worker.query(`update pricing.tax_policies set version_lock = version_lock + 1 where id = $1`, [taxId]))).toBe('42501');
    expect(
      await pgCode(
        worker.query(
          `insert into pricing.route_snapshots (id, provider_key, sku, routing_profile, fetched_at, cache_status, confidence, distance_m, duration_s, latency_ms)
       values ($1, 'geo-mock', 'ROUTE', 'CAR', now(), 'MISS', 'LOW', 1, 1, 1)`,
          [randomUUID()],
        ),
      ),
    ).toBe('42501');
    await owner.query(`update pricing.rate_cards set status = 'RETIRED', effective_until = now() where id = $1`, [id]);
  });

  it('wayvro_realtime, wayvro_vault and PUBLIC hold nothing in pricing', async () => {
    for (const pool of [realtime, vault]) {
      expect(await pgCode(pool.query(`select 1 from pricing.quotes limit 1`))).toBe('42501');
      expect(await pgCode(pool.query(`select 1 from pricing.rate_cards limit 1`))).toBe('42501');
    }
    expect((await owner.query(`select 1 from information_schema.role_table_grants where grantee = 'PUBLIC' and table_schema = 'pricing'`)).rowCount).toBe(0);
    const routines = await owner.query<{ acl: string | null }>(
      `select p.proacl::text acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pricing'`,
    );
    expect(routines.rowCount).toBe(7);
    for (const r of routines.rows) expect(r.acl ?? '').not.toMatch(/(^|[{,])=X/);
  });
});
