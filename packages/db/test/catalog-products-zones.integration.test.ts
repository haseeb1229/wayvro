/**
 * Migration 0010_catalog_products_zones against real PostgreSQL + PostGIS (P3.1; MIG-P3, GEOM-01..07, TRIG-P3,
 * GRANT-P3 catalog cases): live-row upgrade from 0009 with row checksums, hand-written geometry typmods, geometry
 * CHECKs, maker-checker CHECKs, guard triggers (immutability, DRAFT-only children, legal gate, pickup point inside its
 * zone), the widened staff-role CHECK, vehicle claim columns, grants executed as LOGIN members of the restricted roles,
 * and the dev-only synthetic seed. Throwaway databases; synthetic data only (the raw trigger cases use a synthetic
 * E2E city `ZZT` so they never touch LHR).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SYNTHETIC_CATALOG,
  assertSyntheticSeedAllowed,
  createRestrictedLogin,
  createTestDatabase,
  seedSyntheticCatalog,
  type RestrictedLogin,
  type TestDatabase,
} from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, migrationHeaderProblems, runMigrations } from '../src/index.js';
import { MIGRATION_TAGS, TOTAL_MIGRATIONS, migrateFirst } from './journal.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required for integration tests (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;
const TAG = '0010_catalog_products_zones';
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
const logins: RestrictedLogin[] = [];
async function poolAs(group: string): Promise<pg.Pool> {
  const login = await createRestrictedLogin(adminUrl, database.url, group);
  logins.push(login);
  return new pg.Pool({ connectionString: login.url, max: 2 });
}

const CITY = 'ZZT';
const rect = (x0: number, y0: number, x1: number, y1: number): string =>
  `MULTIPOLYGON(((${String(x0)} ${String(y0)}, ${String(x1)} ${String(y0)}, ${String(x1)} ${String(y1)}, ${String(x0)} ${String(y1)}, ${String(x0)} ${String(y0)})))`;
async function staff(): Promise<string> {
  const id = randomUUID();
  await owner.query(`insert into staff.staff_accounts (id, display_name, work_email, status) values ($1, 'Synthetic staff', $2, 'INVITED')`, [
    id,
    `s.${id.slice(0, 8)}@example.org`,
  ]);
  return id;
}
/** A DRAFT zone set in the synthetic city, written by `pool` (default: the API role). */
async function draftSet(pool: pg.Pool = api, drafter: string | null = null, synthetic = false): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference, drafted_by_staff_id)
     values ($1, $2, (select coalesce(max(version), 0) + 1 from catalog.zone_sets where city_code = $2), 'DRAFT', $3, 'SYNTHETIC test geometry', $4)`,
    [id, CITY, synthetic, drafter],
  );
  return id;
}
/** SQLSTATE of `sql` with one guard trigger disabled, inside an owner transaction that is always rolled back (proves a CHECK alone). */
async function checkWithoutGuard(table: string, trigger: string, sql: string, values: unknown[]): Promise<string | undefined> {
  const c = await owner.connect();
  try {
    await c.query('begin');
    await c.query(`alter table ${table} disable trigger ${trigger}`);
    return await pgCode(c.query(sql, values));
  } finally {
    await c.query('rollback');
    c.release();
  }
}
const zone = (pool: pg.Pool, setId: string, code: string, kind: string, wkt: string, srid = 4326) =>
  pool.query(
    `insert into catalog.zones (id, zone_set_id, code, kind, name_en, name_ur, geom) values ($1, $2, $3, $4, 'Synthetic', 'مصنوعی', ST_GeomFromText($5, $6))`,
    [randomUUID(), setId, code, kind, wkt, srid],
  );

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 4 });
  api = await poolAs('wayvro_api');
  worker = await poolAs('wayvro_worker');
  realtime = await poolAs('wayvro_realtime');
  await owner.query(`insert into catalog.cities (code, name_en, name_ur, status) values ($1, 'Synthetic test city', 'مصنوعی', 'ENABLED')`, [CITY]);
  await owner.query(
    `insert into catalog.city_service_products (city_code, product_code, status) values ($1, 'ECONOMY', 'NOT_CONFIGURED'), ($1, 'BIKE', 'DISABLED_LEGAL_GATE')`,
    [CITY],
  );
});
afterAll(async () => {
  await Promise.all([owner.end(), api.end(), worker.end(), realtime.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

describe('MIG-P3: 0010 lifecycle', () => {
  it('carries the five header lines and the hand-written geometry typmods (ADR-004 format_type)', async () => {
    expect(migrationHeaderProblems().filter((p) => p.startsWith(TAG))).toEqual([]);
    const sql = readFileSync(join(MIGRATIONS_FOLDER, `${TAG}.sql`), 'utf8');
    expect(sql).toContain('SET LOCAL ROLE wayvro_migrator;');
    const statements = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
      .split(';');
    expect(statements.filter((s) => /^\s*GRANT\b/i.test(s) && /\bPUBLIC\b/i.test(s))).toEqual([]);
    const types = await owner.query<{ col: string; t: string }>(
      `select attrelid::regclass::text || '.' || attname col, format_type(atttypid, atttypmod) t from pg_attribute
        where attrelid in ('catalog.zones'::regclass, 'catalog.pickup_points'::regclass, 'catalog.districts'::regclass) and attname in ('geom', 'point') order by 1`,
    );
    expect(types.rows).toEqual([
      { col: 'catalog.districts.geom', t: 'geometry(MultiPolygon,4326)' },
      { col: 'catalog.pickup_points.point', t: 'geometry(Point,4326)' },
      { col: 'catalog.zones.geom', t: 'geometry(MultiPolygon,4326)' },
    ]);
    const gist = await owner.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'catalog' and indexdef ilike '%using gist%' order by 1`,
    );
    expect(gist.rows.map((r) => r.indexname)).toEqual(['districts_geom', 'pickup_points_point', 'zones_geom']);
  });

  it('seeds four modelled products and the LHR city products; BIKE/RICKSHAW stay behind the legal gate (FA-11)', async () => {
    const products = await owner.query(
      `select code, vehicle_class, seats_max, luggage_class, routing_profile, sort_order from catalog.service_products order by sort_order`,
    );
    expect(products.rows).toEqual([
      { code: 'ECONOMY', vehicle_class: 'CAR', seats_max: 4, luggage_class: 'STANDARD', routing_profile: 'CAR', sort_order: 10 },
      { code: 'COMFORT', vehicle_class: 'CAR', seats_max: 4, luggage_class: 'LARGE', routing_profile: 'CAR', sort_order: 20 },
      { code: 'BIKE', vehicle_class: 'BIKE', seats_max: 1, luggage_class: 'NONE', routing_profile: 'TWO_WHEELER', sort_order: 30 },
      { code: 'RICKSHAW', vehicle_class: 'RICKSHAW', seats_max: 3, luggage_class: 'SMALL', routing_profile: 'THREE_WHEELER', sort_order: 40 },
    ]);
    const city = await owner.query(
      `select product_code, status, legal_basis_ref, is_synthetic from catalog.city_service_products where city_code = 'LHR' order by product_code`,
    );
    expect(city.rows).toEqual([
      { product_code: 'BIKE', status: 'DISABLED_LEGAL_GATE', legal_basis_ref: null, is_synthetic: false },
      { product_code: 'COMFORT', status: 'NOT_CONFIGURED', legal_basis_ref: null, is_synthetic: false },
      { product_code: 'ECONOMY', status: 'NOT_CONFIGURED', legal_basis_ref: null, is_synthetic: false },
      { product_code: 'RICKSHAW', status: 'DISABLED_LEGAL_GATE', legal_basis_ref: null, is_synthetic: false },
    ]);
    // no zone, rule or synthetic configuration comes from a migration
    for (const t of ['catalog.zone_sets', 'catalog.vehicle_eligibility_rules', 'catalog.zones', 'catalog.service_hours', 'catalog.pickup_points']) {
      expect((await owner.query(`select 1 from ${t} where ${t.endsWith('zone_sets') || t.endsWith('rules') ? `city_code = 'LHR'` : 'true'}`)).rowCount, t).toBe(
        0,
      );
    }
  });

  it('live-row upgrade: a 0009 database with Phase-2 rows referencing CAR/LHR-LAHORE migrates without touching them; re-run applies 0', async () => {
    const n = MIGRATION_TAGS.indexOf(TAG);
    expect(n).toBeGreaterThan(0);
    const previous = await createTestDatabase(adminUrl);
    try {
      await migrateFirst(previous.url, n);
      const pool = new pg.Pool({ connectionString: previous.url, max: 1 });
      const checksum = async (p: pg.Pool) =>
        (
          await p.query<{ t: string; sum: string }>(
            `select 'applications' t, md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) sum from compliance.driver_applications a
             union all select 'categories', md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.application_id), '')) from compliance.application_service_categories c
             union all select 'vehicles', md5(coalesce(string_agg((to_jsonb(v) - 'seats' - 'body_type' - 'air_conditioned')::text, '|' order by v.id), '')) from compliance.vehicles v
             union all select 'documents', md5(coalesce(string_agg(to_jsonb(d)::text, '|' order by d.id), '')) from compliance.compliance_documents d
             union all select 'sets', md5(coalesce(string_agg(to_jsonb(s)::text, '|' order by s.id), '')) from compliance.requirement_sets s
             union all select 'roles', md5(coalesce(string_agg(to_jsonb(r)::text, '|' order by r.id), '')) from staff.role_assignments r
             union all select 'districts', md5(coalesce(string_agg((to_jsonb(d) - 'geom' - 'geom_source_reference')::text, '|' order by d.code), '')) from catalog.districts d
             union all select 'categories_ref', md5(coalesce(string_agg(to_jsonb(k)::text, '|' order by k.code), '')) from catalog.service_categories k
             order by 1`,
          )
        ).rows;
      let before: Array<{ t: string; sum: string }>;
      const vehicle = randomUUID();
      try {
        const accountId = randomUUID();
        const app = randomUUID();
        const staffId = randomUUID();
        await pool.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [accountId]);
        await pool.query(`insert into compliance.driver_applications (id, account_id, state, city_code) values ($1, $2, 'DRAFT', 'LHR')`, [app, accountId]);
        await pool.query(`insert into compliance.application_service_categories (application_id, service_category) values ($1, 'CAR')`, [app]);
        await pool.query(
          `insert into compliance.vehicles (id, plate_normalised, plate_display, make, model, model_year, colour, service_category, ownership_type, status)
           values ($1, 'SYN123', 'SYN-123', 'Synthetic', 'Model', 2018, 'White', 'CAR', 'REGISTERED_OWNER', 'ACTIVE')`,
          [vehicle],
        );
        await pool.query(
          `insert into compliance.vehicle_affiliations (id, vehicle_id, driver_application_id, relation, status) values ($1, $2, $3, 'OWNER', 'PENDING')`,
          [randomUUID(), vehicle, app],
        );
        await pool.query(
          `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, vehicle_id, district_code, status)
           values ($1, 'ROUTE_PERMIT', 'VEHICLE', $2, $3, 'LHR-LAHORE', 'SUBMITTED')`,
          [randomUUID(), app, vehicle],
        );
        await pool.query(
          `insert into staff.staff_accounts (id, display_name, work_email, status) values ($1, 'Synthetic', 'synthetic.upgrade@example.org', 'INVITED')`,
          [staffId],
        );
        await pool.query(`insert into staff.role_assignments (id, staff_id, role, status, valid_from) values ($1, $2, 'COMPLIANCE_ADMIN', 'ACTIVE', now())`, [
          randomUUID(),
          staffId,
        ]);
        // the narrower Phase-2 CHECK still refuses the new roles before 0010
        expect(
          await pgCode(
            pool.query(`insert into staff.role_assignments (id, staff_id, role, status) values ($1, $2, 'CATALOG_MANAGER', 'PENDING_APPROVAL')`, [
              randomUUID(),
              staffId,
            ]),
          ),
        ).toBe('23514');
        before = await checksum(pool);
      } finally {
        await pool.end();
      }
      expect(await runMigrations(previous.url)).toEqual({ appliedBefore: n, appliedAfter: TOTAL_MIGRATIONS });
      expect(await runMigrations(previous.url)).toEqual({ appliedBefore: TOTAL_MIGRATIONS, appliedAfter: TOTAL_MIGRATIONS });
      const after = new pg.Pool({ connectionString: previous.url, max: 1 });
      try {
        expect(await checksum(after)).toEqual(before);
        // FKs from compliance still resolve; new columns start NULL (claims not made)
        const joined = await after.query(
          `select v.seats, v.body_type, v.air_conditioned, k.status, d.geom from compliance.vehicles v
             join catalog.service_categories k on k.code = v.service_category
             join compliance.compliance_documents doc on doc.vehicle_id = v.id join catalog.districts d on d.code = doc.district_code where v.id = $1`,
          [vehicle],
        );
        expect(joined.rows).toEqual([{ seats: null, body_type: null, air_conditioned: null, status: 'ENABLED', geom: null }]);
      } finally {
        await after.end();
      }
    } finally {
      await previous.drop();
    }
  });
});

describe('GEOM: zone geometry CHECKs and typmods (real PostGIS)', () => {
  it('GEOM-01 a self-intersecting (bow-tie) polygon is refused by ST_IsValid', async () => {
    const set = await draftSet();
    expect(await pgCode(zone(api, set, 'BOWTIE', 'SERVICE_AREA', 'MULTIPOLYGON(((74.3 31.5, 74.4 31.6, 74.4 31.5, 74.3 31.6, 74.3 31.5)))'))).toBe('23514');
  });

  it('GEOM-02 SRID 3857 is refused by the typmod', async () => {
    const set = await draftSet();
    expect(await pgCode(zone(api, set, 'MERC', 'SERVICE_AREA', rect(8_270_000, 3_700_000, 8_280_000, 3_710_000), 3857))).toBe('22023');
  });

  it('GEOM-03 the MultiPolygon typmod: a Point is refused, a plain Polygon is stored as MULTIPOLYGON (PostGIS 3.5 promotes; the import wraps with ST_Multi)', async () => {
    const set = await draftSet();
    expect(await pgCode(zone(api, set, 'POINTY', 'SERVICE_AREA', 'POINT(74.3 31.5)'))).toBe('22023');
    await zone(api, set, 'PLAIN', 'SERVICE_AREA', 'POLYGON((74.3 31.5, 74.4 31.5, 74.4 31.6, 74.3 31.6, 74.3 31.5))');
    await api.query(
      `insert into catalog.zones (id, zone_set_id, code, kind, name_en, name_ur, geom)
       values ($1, $2, 'WRAPPED', 'SERVICE_AREA', 'S', 'S', ST_Multi(ST_GeomFromText('POLYGON((74.3 31.5, 74.4 31.5, 74.4 31.6, 74.3 31.6, 74.3 31.5))', 4326)))`,
      [randomUUID(), set],
    );
    expect((await owner.query(`select GeometryType(geom) t from catalog.zones where zone_set_id = $1 order by code`, [set])).rows).toEqual([
      { t: 'MULTIPOLYGON' },
      { t: 'MULTIPOLYGON' },
    ]);
  });

  it('GEOM-04 an empty MultiPolygon is refused; more than 20,000 vertices are refused', async () => {
    const set = await draftSet();
    expect(await pgCode(zone(api, set, 'EMPTY', 'SERVICE_AREA', 'MULTIPOLYGON EMPTY'))).toBe('23514');
    const big = await pgCode(
      api.query(
        `insert into catalog.zones (id, zone_set_id, code, kind, name_en, name_ur, geom)
         values ($1, $2, 'HUGE', 'SERVICE_AREA', 'S', 'S', ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(74.35, 31.5), 4326), 0.01, 5000)))`,
        [randomUUID(), set],
      ),
    );
    expect(big).toBe('23514');
  });

  it('GEOM-06 axis order: ST_MakePoint(lng, lat) lands inside an asymmetric zone, the swapped point does not', async () => {
    const set = await draftSet();
    await zone(api, set, 'ASYM', 'SERVICE_AREA', rect(74.3, 31.5, 74.4, 31.52));
    const r = await owner.query<{ right: boolean; swapped: boolean }>(
      `select ST_Covers(geom, ST_SetSRID(ST_MakePoint(74.35, 31.51), 4326)) right, ST_Covers(geom, ST_SetSRID(ST_MakePoint(31.51, 74.35), 4326)) swapped
         from catalog.zones where zone_set_id = $1`,
      [set],
    );
    expect(r.rows).toEqual([{ right: true, swapped: false }]);
  });

  it('GEOM-07 a geography(Point) cast back to geometry gives the same decision as the pure geometry query', async () => {
    const set = await draftSet();
    await zone(api, set, 'CAST', 'SERVICE_AREA', rect(74.3, 31.5, 74.4, 31.6));
    const probes: Array<[number, number]> = [
      [74.35, 31.55],
      [74.3, 31.55],
      [74.35, 31.6],
      [74.29999, 31.55],
      [74.45, 31.55],
    ];
    for (const [lng, lat] of probes) {
      const r = await owner.query<{ g: boolean; geo: boolean }>(
        `select ST_Covers(geom, ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)) g,
                ST_Covers(geom, (ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography)::geometry) geo
           from catalog.zones where zone_set_id = $1`,
        [set, lng, lat],
      );
      expect(r.rows[0]?.geo, `${String(lng)},${String(lat)}`).toBe(r.rows[0]?.g);
    }
  });
});

describe('TRIG-P3: maker-checker CHECKs and guard triggers', () => {
  it('an API-inserted version starts as DRAFT without approval data; DELETE of a version is refused', async () => {
    const drafter = await staff();
    expect(
      await pgCode(
        api.query(
          `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference, drafted_by_staff_id, approved_by_staff_id, effective_from)
           values ($1, $2, 900, 'ACTIVE', false, 'x-src', $3, $4, now())`,
          [randomUUID(), CITY, drafter, await staff()],
        ),
      ),
    ).toBe('42501');
    const set = await draftSet(api, drafter);
    expect(await pgCode(owner.query(`delete from catalog.zone_sets where id = $1`, [set]))).toBe('42501');
  });

  it('drafter = approver is refused (CHECK and guard); the lifecycle allows only the documented transitions', async () => {
    const drafter = await staff();
    const checker = await staff();
    const set = await draftSet(api, drafter);
    // DRAFT -> APPROVED skips the submission
    expect(await pgCode(api.query(`update catalog.zone_sets set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [set, checker]))).toBe('42501');
    await api.query(`update catalog.zone_sets set status = 'PENDING_APPROVAL' where id = $1`, [set]);
    // the guard refuses maker = checker and an approval without approver ...
    expect(await pgCode(api.query(`update catalog.zone_sets set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [set, drafter]))).toBe('42501');
    expect(await pgCode(api.query(`update catalog.zone_sets set status = 'APPROVED' where id = $1`, [set]))).toBe('42501');
    // ... and so do the CHECKs on their own (trigger disabled inside a rolled-back owner transaction)
    expect(
      await checkWithoutGuard(
        'catalog.zone_sets',
        'zone_sets_version_guard',
        `update catalog.zone_sets set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`,
        [set, drafter],
      ),
    ).toBe('23514');
    expect(
      await checkWithoutGuard('catalog.zone_sets', 'zone_sets_version_guard', `update catalog.zone_sets set status = 'APPROVED' where id = $1`, [set]),
    ).toBe('23514');
    await api.query(`update catalog.zone_sets set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [set, checker]);
    // APPROVED -> ACTIVE needs effective_from; the approver cannot change afterwards
    expect(await pgCode(api.query(`update catalog.zone_sets set status = 'ACTIVE' where id = $1`, [set]))).toBe('42501');
    expect(await checkWithoutGuard('catalog.zone_sets', 'zone_sets_version_guard', `update catalog.zone_sets set status = 'ACTIVE' where id = $1`, [set])).toBe(
      '23514',
    );
    expect(await pgCode(api.query(`update catalog.zone_sets set approved_by_staff_id = $2 where id = $1`, [set, await staff()]))).toBe('42501');
    await api.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [set]);
    expect(await pgCode(api.query(`update catalog.zone_sets set status = 'PENDING_APPROVAL' where id = $1`, [set]))).toBe('42501');
    // value columns are immutable (the owner too; the API holds no grant on them at all)
    expect(await pgCode(owner.query(`update catalog.zone_sets set source_reference = 'changed' where id = $1`, [set]))).toBe('42501');
    // only the seed/migration roles may activate a staff-less synthetic DRAFT directly; staff drafts never
    const staffDraft = await draftSet(owner, drafter, true);
    expect(await pgCode(owner.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [staffDraft]))).toBe(
      '42501',
    );
    const systemDraft = await draftSet(api, null, true);
    expect(await pgCode(api.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [systemDraft]))).toBe(
      '42501',
    );
  });

  it('one ACTIVE zone set per city; activation retires through ACTIVE -> RETIRED with effective_until', async () => {
    const drafter = await staff();
    const checker = await staff();
    const activate = async (): Promise<string> => {
      const set = await draftSet(api, drafter);
      await api.query(`update catalog.zone_sets set status = 'PENDING_APPROVAL' where id = $1`, [set]);
      await api.query(`update catalog.zone_sets set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [set, checker]);
      return set;
    };
    const current = (await owner.query<{ id: string }>(`select id from catalog.zone_sets where city_code = $1 and status = 'ACTIVE'`, [CITY])).rows[0]?.id;
    if (current) await api.query(`update catalog.zone_sets set status = 'RETIRED', effective_until = clock_timestamp() where id = $1`, [current]);
    const a = await activate();
    const b = await activate();
    await api.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [a]);
    expect(await pgCode(api.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [b]))).toBe('23505');
    expect(await pgCode(api.query(`update catalog.zone_sets set status = 'RETIRED' where id = $1`, [a]))).toBe('42501');
    await api.query(`update catalog.zone_sets set status = 'RETIRED', effective_until = clock_timestamp() where id = $1`, [a]);
    await api.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [b]);
  });

  it('children (zones, products, hours, pickup points) are writable only under a DRAFT parent; geometry is frozen after APPROVED', async () => {
    const drafter = await staff();
    const set = await draftSet(api, drafter);
    const zoneId = randomUUID();
    await api.query(
      `insert into catalog.zones (id, zone_set_id, code, kind, name_en, name_ur, geom) values ($1, $2, 'VENUE', 'PICKUP_RESTRICTED', 'V', 'V', ST_GeomFromText($3, 4326))`,
      [zoneId, set, rect(74.33, 31.509, 74.338, 31.517)],
    );
    await zone(api, set, 'AREA', 'SERVICE_AREA', rect(74.2, 31.4, 74.5, 31.65));
    await api.query(`insert into catalog.zone_products (zone_id, product_code) values ($1, 'ECONOMY')`, [zoneId]);
    await api.query(
      `insert into catalog.service_hours (id, zone_set_id, product_code, weekday, opens_local, closes_local) values ($1, $2, null, 1, '06:00', '23:00')`,
      [randomUUID(), set],
    );
    const point = (code: string, kind: string, lng: number, lat: number, name: string) =>
      api.query(
        `insert into catalog.pickup_points (id, zone_set_id, zone_code, kind, point, name_en, name_ur, instruction_key, status)
         values ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5::float8, $6::float8), 4326), $7, $7, 'pickup.synthetic.gate', 'ACTIVE')`,
        [randomUUID(), set, code, kind, lng, lat, name],
      );
    await point('VENUE', 'DESIGNATED', 74.331, 31.51, 'Gate A');
    // a pickup point outside its zone, and an AIRPORT point outside an airport precinct, are refused
    expect(await pgCode(point('VENUE', 'DESIGNATED', 74.4, 31.51, 'Far gate'))).toBe('23514');
    expect(await pgCode(point('VENUE', 'AIRPORT', 74.332, 31.511, 'Not an airport'))).toBe('23514');
    // service hours: opens <= closes; one window start per (set, product, weekday) incl. the general row (NULLS NOT DISTINCT)
    expect(
      await pgCode(
        api.query(`insert into catalog.service_hours (id, zone_set_id, weekday, opens_local, closes_local) values ($1, $2, 2, '23:00', '06:00')`, [
          randomUUID(),
          set,
        ]),
      ),
    ).toBe('23514');
    expect(
      await pgCode(
        api.query(`insert into catalog.service_hours (id, zone_set_id, weekday, opens_local, closes_local) values ($1, $2, 1, '06:00', '22:00')`, [
          randomUUID(),
          set,
        ]),
      ),
    ).toBe('23505');
    await api.query(`update catalog.zone_sets set status = 'PENDING_APPROVAL' where id = $1`, [set]);
    expect(await pgCode(zone(api, set, 'LATE', 'SERVICE_AREA', rect(74.3, 31.5, 74.4, 31.6)))).toBe('42501');
    expect(await pgCode(api.query(`delete from catalog.zone_products where zone_id = $1`, [zoneId]))).toBe('42501');
    expect(await pgCode(api.query(`delete from catalog.service_hours where zone_set_id = $1`, [set]))).toBe('42501');
    expect(await pgCode(api.query(`delete from catalog.pickup_points where zone_set_id = $1`, [set]))).toBe('42501');
    await api.query(`update catalog.zone_sets set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [set, await staff()]);
    // even the owner cannot move geometry of an approved set
    expect(await pgCode(owner.query(`update catalog.zones set geom = ST_GeomFromText($2, 4326) where id = $1`, [zoneId, rect(74.0, 31.0, 74.1, 31.1)]))).toBe(
      '42501',
    );
  });

  it('eligibility rules: one ACTIVE per (city, product), maker-checker, at most one age criterion, closed body-type list', async () => {
    const drafter = await staff();
    const rule = async (extra = ''): Promise<string> => {
      const id = randomUUID();
      await api.query(
        `insert into catalog.vehicle_eligibility_rules (id, city_code, product_code, version, status, is_synthetic, source_reference, max_vehicle_age_years, drafted_by_staff_id ${extra ? ', allowed_body_types' : ''})
         values ($1, $2, 'ECONOMY', (select coalesce(max(version), 0) + 1 from catalog.vehicle_eligibility_rules where city_code = $2), 'DRAFT', false, 'SYNTHETIC test rule', 10, $3 ${extra ? `, ${extra}` : ''})`,
        [id, CITY, drafter],
      );
      return id;
    };
    expect(await pgCode(rule(`ARRAY['LIMOUSINE']`))).toBe('23514');
    expect(
      await pgCode(
        api.query(
          `insert into catalog.vehicle_eligibility_rules (id, city_code, product_code, version, status, is_synthetic, source_reference, min_model_year, max_vehicle_age_years)
           values ($1, $2, 'ECONOMY', 99, 'DRAFT', false, 'SYNTHETIC', 2015, 10)`,
          [randomUUID(), CITY],
        ),
      ),
    ).toBe('23514');
    // a rule needs the (city, product) row
    expect(
      await pgCode(
        api.query(
          `insert into catalog.vehicle_eligibility_rules (id, city_code, product_code, version, status, is_synthetic, source_reference) values ($1, $2, 'COMFORT', 1, 'DRAFT', false, 'SYNTHETIC')`,
          [randomUUID(), CITY],
        ),
      ),
    ).toBe('23503');
    const approve = async (id: string) => {
      await api.query(`update catalog.vehicle_eligibility_rules set status = 'PENDING_APPROVAL' where id = $1`, [id]);
      expect(
        await pgCode(api.query(`update catalog.vehicle_eligibility_rules set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [id, drafter])),
      ).toBe('42501');
      expect(
        await checkWithoutGuard(
          'catalog.vehicle_eligibility_rules',
          'vehicle_eligibility_rules_version_guard',
          `update catalog.vehicle_eligibility_rules set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`,
          [id, drafter],
        ),
      ).toBe('23514');
      await api.query(`update catalog.vehicle_eligibility_rules set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [id, await staff()]);
    };
    const a = await rule();
    const b = await rule();
    await approve(a);
    await approve(b);
    await api.query(`update catalog.vehicle_eligibility_rules set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [a]);
    expect(
      await pgCode(api.query(`update catalog.vehicle_eligibility_rules set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [b])),
    ).toBe('23505');
    expect(await pgCode(owner.query(`update catalog.vehicle_eligibility_rules set max_vehicle_age_years = 30 where id = $1`, [a]))).toBe('42501');
  });

  it('city products: ENABLED needs a legal basis and an ENABLED vehicle class; the gate cannot be left while gated; rows are never deleted', async () => {
    // BIKE is DISABLED_LEGAL_GATE: neither ENABLED (even with a legal basis) nor any other state while its class is gated
    expect(
      await pgCode(
        owner.query(
          `update catalog.city_service_products set status = 'ENABLED', legal_basis_ref = 'COUNSEL-REF-1' where city_code = $1 and product_code = 'BIKE'`,
          [CITY],
        ),
      ),
    ).toBe('42501');
    expect(
      await pgCode(owner.query(`update catalog.city_service_products set status = 'CONFIGURED' where city_code = $1 and product_code = 'BIKE'`, [CITY])),
    ).toBe('42501');
    expect(
      await pgCode(
        owner.query(`insert into catalog.city_service_products (city_code, product_code, status) values ($1, 'RICKSHAW', 'NOT_CONFIGURED')`, [CITY]),
      ),
    ).toBe('42501');
    // ENABLED without legal_basis_ref
    expect(
      await pgCode(api.query(`update catalog.city_service_products set status = 'ENABLED' where city_code = $1 and product_code = 'ECONOMY'`, [CITY])),
    ).toBe('23514');
    // a staff maker needs a different checker for ENABLED
    const maker = await staff();
    expect(
      await pgCode(
        api.query(
          `update catalog.city_service_products set status = 'ENABLED', legal_basis_ref = 'COUNSEL-REF-1', changed_by_staff_id = $2 where city_code = $1 and product_code = 'ECONOMY'`,
          [CITY, maker],
        ),
      ),
    ).toBe('23514');
    expect(
      await pgCode(
        api.query(
          `update catalog.city_service_products set status = 'ENABLED', legal_basis_ref = 'COUNSEL-REF-1', changed_by_staff_id = $2, approved_by_staff_id = $2 where city_code = $1 and product_code = 'ECONOMY'`,
          [CITY, maker],
        ),
      ),
    ).toBe('23514');
    // a pending ENABLE request only from CONFIGURED/SUSPENDED
    expect(
      await pgCode(
        api.query(`update catalog.city_service_products set pending_transition = 'ENABLE' where city_code = $1 and product_code = 'ECONOMY'`, [CITY]),
      ),
    ).toBe('23514');
    await api.query(
      `update catalog.city_service_products set status = 'ENABLED', legal_basis_ref = 'COUNSEL-REF-1', changed_by_staff_id = $2, approved_by_staff_id = $3 where city_code = $1 and product_code = 'ECONOMY'`,
      [CITY, maker, await staff()],
    );
    expect(await pgCode(owner.query(`delete from catalog.city_service_products where city_code = $1 and product_code = 'ECONOMY'`, [CITY]))).toBe('42501');
    // service products are reference rows (migration-only)
    expect(await pgCode(owner.query(`update catalog.service_products set seats_max = 7 where code = 'ECONOMY'`))).toBe('42501');
    expect(await pgCode(owner.query(`delete from catalog.service_products where code = 'RICKSHAW'`))).toBe('42501');
  });

  it('section B: the widened role CHECK accepts the FA-10 roles and still refuses unknown roles', async () => {
    const s = await staff();
    for (const role of ['PRICING_MANAGER', 'CATALOG_MANAGER', 'RELEASE_MANAGER']) {
      await api.query(`insert into staff.role_assignments (id, staff_id, role, status) values ($1, $2, $3, 'PENDING_APPROVAL')`, [randomUUID(), s, role]);
    }
    expect(
      await pgCode(
        api.query(`insert into staff.role_assignments (id, staff_id, role, status) values ($1, $2, 'SUPERUSER', 'PENDING_APPROVAL')`, [randomUUID(), s]),
      ),
    ).toBe('23514');
  });

  it('section C: vehicle claim columns are nullable with closed CHECKs; districts.geom needs a source reference', async () => {
    const insert = (seats: number | null, body: string | null) =>
      api.query(
        `insert into compliance.vehicles (id, plate_normalised, plate_display, make, model, model_year, colour, service_category, ownership_type, status, seats, body_type, air_conditioned)
         values ($1, $2, $2, 'm', 'm', 2020, 'c', 'CAR', 'REGISTERED_OWNER', 'ACTIVE', $3, $4, true)`,
        [randomUUID(), `CLM${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, '')}`, seats, body],
      );
    await insert(4, 'SEDAN');
    await insert(null, null);
    expect(await pgCode(insert(13, 'SEDAN'))).toBe('23514');
    expect(await pgCode(insert(4, 'LIMOUSINE'))).toBe('23514');
    expect(
      await pgCode(owner.query(`update catalog.districts set geom = ST_GeomFromText($1, 4326) where code = 'LHR-LAHORE'`, [rect(74.2, 31.4, 74.5, 31.65)])),
    ).toBe('23514');
  });
});

describe('GRANT-P3: executed as LOGIN members of the restricted roles', () => {
  it('wayvro_api reads every catalog table but cannot change products, district geometry, configuration values or delete versions', async () => {
    for (const t of [
      'service_products',
      'city_service_products',
      'vehicle_eligibility_rules',
      'zone_sets',
      'zones',
      'zone_products',
      'service_hours',
      'pickup_points',
      'districts',
    ]) {
      await api.query(`select * from catalog.${t} limit 1`);
    }
    expect(await pgCode(api.query(`update catalog.service_products set sort_order = 11 where code = 'ECONOMY'`))).toBe('42501');
    expect(
      await pgCode(
        api.query(
          `insert into catalog.service_products (code, vehicle_class, name_key, description_key, seats_max, luggage_class, sort_order) values ('XL', 'CAR', 'product.xl', 'product.xl', 6, 'LARGE', 50)`,
        ),
      ),
    ).toBe('42501');
    expect(
      await pgCode(
        api.query(`update catalog.districts set geom = ST_GeomFromText($1, 4326), geom_source_reference = 'x' where code = 'LHR-LAHORE'`, [
          rect(74.2, 31.4, 74.5, 31.65),
        ]),
      ),
    ).toBe('42501');
    const set = await draftSet(api, await staff());
    expect(await pgCode(api.query(`delete from catalog.zone_sets where id = $1`, [set]))).toBe('42501');
    expect(await pgCode(api.query(`update catalog.zone_sets set source_reference = 'changed' where id = $1`, [set]))).toBe('42501');
    expect(await pgCode(api.query(`update catalog.city_service_products set is_synthetic = true where city_code = $1`, [CITY]))).toBe('42501');
    expect(
      await pgCode(api.query(`insert into catalog.city_service_products (city_code, product_code, status) values ($1, 'COMFORT', 'NOT_CONFIGURED')`, [CITY])),
    ).toBe('42501');
  });

  it('wayvro_worker only activates/retires approved versions; it cannot write zones; realtime has no catalog access; PUBLIC has nothing', async () => {
    const set = await draftSet(api, await staff());
    expect(await pgCode(zone(worker, set, 'WORKER', 'SERVICE_AREA', rect(74.3, 31.5, 74.4, 31.6)))).toBe('42501');
    expect(await pgCode(worker.query(`select source_reference from catalog.zone_sets limit 1`))).toBe('42501');
    expect((await worker.query(`select id, status from catalog.zone_sets where id = $1`, [set])).rowCount).toBe(1);
    expect(await pgCode(realtime.query(`select 1 from catalog.zone_sets limit 1`))).toBe('42501');
    const publicGrants = await owner.query(`select 1 from information_schema.role_table_grants where grantee = 'PUBLIC' and table_schema = 'catalog'`);
    expect(publicGrants.rowCount).toBe(0);
    const fnPublic = await owner.query<{ f: string }>(
      `select p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'catalog' and has_function_privilege('public', p.oid, 'execute') order by 1`,
    );
    expect(fnPublic.rows).toEqual([]);
    for (const role of ['wayvro_realtime', 'wayvro_vault', 'wayvro_audit_sealer']) {
      const r = await owner.query<{ n: number }>(
        `select count(*)::int n from information_schema.role_table_grants where grantee = $1 and table_schema = 'catalog' and privilege_type <> 'SELECT'`,
        [role],
      );
      expect(r.rows[0]?.n, role).toBe(0);
    }
  });
});

describe('synthetic seed (dev-only, ADR-045)', () => {
  it('refuses outside local/test and against a non-loopback host, before connecting', () => {
    expect(() => {
      assertSyntheticSeedAllowed('production', 'postgres://u:p@127.0.0.1:5432/db');
    }).toThrow(/WAYVRO_ENV/);
    expect(() => {
      assertSyntheticSeedAllowed('staging', 'postgres://u:p@127.0.0.1:5432/db');
    }).toThrow(/WAYVRO_ENV/);
    expect(() => {
      assertSyntheticSeedAllowed('local', 'postgres://u:p@db.example.org:5432/db');
    }).toThrow(/loopback/);
    expect(() => {
      assertSyntheticSeedAllowed('test', 'postgres://u:p@127.0.0.1:5432/db');
    }).not.toThrow();
  });

  it('writes the synthetic LHR configuration idempotently and refuses once non-synthetic configuration exists', async () => {
    const db = await createTestDatabase(adminUrl);
    try {
      await runMigrations(db.url);
      const lines: string[] = [];
      const first = await seedSyntheticCatalog({ env: 'test', databaseUrl: db.url, log: (l) => lines.push(l) });
      expect(first).toEqual({ zoneSetId: SYNTHETIC_CATALOG.zoneSetId, zoneSetVersion: 1, createdZoneSet: true });
      expect(lines.length).toBeGreaterThan(0);
      const second = await seedSyntheticCatalog({ env: 'test', databaseUrl: db.url });
      expect(second).toEqual({ zoneSetId: SYNTHETIC_CATALOG.zoneSetId, zoneSetVersion: 1, createdZoneSet: false });
      const pool = new pg.Pool({ connectionString: db.url, max: 1 });
      try {
        const set = await pool.query(`select status, is_synthetic, source_reference, drafted_by_staff_id from catalog.zone_sets`);
        expect(set.rows).toEqual([{ status: 'ACTIVE', is_synthetic: true, source_reference: SYNTHETIC_CATALOG.sourceReference, drafted_by_staff_id: null }]);
        const kinds = await pool.query(`select kind, count(*)::int n from catalog.zones group by kind order by kind`);
        expect(kinds.rows).toEqual([
          { kind: 'AIRPORT_PRECINCT', n: 1 },
          { kind: 'EXCLUSION', n: 1 },
          { kind: 'PICKUP_RESTRICTED', n: 1 },
          { kind: 'SERVICE_AREA', n: 1 },
        ]);
        // ≤ 3 decimals everywhere (public-landmark level, no private address precision)
        const precise = await pool.query(
          `select 1 from (select (ST_DumpPoints(geom)).geom p from catalog.zones union all select point from catalog.pickup_points) x
            where round(ST_X(p)::numeric, 3) <> ST_X(p)::numeric or round(ST_Y(p)::numeric, 3) <> ST_Y(p)::numeric`,
        );
        expect(precise.rowCount).toBe(0);
        expect((await pool.query(`select count(*)::int n from catalog.service_hours`)).rows[0]).toEqual({ n: 7 });
        const products = await pool.query(
          `select product_code, status, legal_basis_ref, is_synthetic from catalog.city_service_products where city_code = 'LHR' order by product_code`,
        );
        expect(products.rows).toEqual([
          { product_code: 'BIKE', status: 'DISABLED_LEGAL_GATE', legal_basis_ref: null, is_synthetic: false },
          { product_code: 'COMFORT', status: 'CONFIGURED', legal_basis_ref: null, is_synthetic: true },
          { product_code: 'ECONOMY', status: 'ENABLED', legal_basis_ref: SYNTHETIC_CATALOG.legalBasisRef, is_synthetic: true },
          { product_code: 'RICKSHAW', status: 'DISABLED_LEGAL_GATE', legal_basis_ref: null, is_synthetic: false },
        ]);
        const rules = await pool.query(`select product_code, status, is_synthetic from catalog.vehicle_eligibility_rules order by product_code`);
        expect(rules.rows).toEqual([
          { product_code: 'COMFORT', status: 'ACTIVE', is_synthetic: true },
          { product_code: 'ECONOMY', status: 'ACTIVE', is_synthetic: true },
        ]);
        await pool.query(
          `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference) values ($1, 'LHR', 2, 'DRAFT', false, 'licensed boundary source')`,
          [randomUUID()],
        );
      } finally {
        await pool.end();
      }
      await expect(seedSyntheticCatalog({ env: 'test', databaseUrl: db.url })).rejects.toThrow(/non-synthetic configuration/);
    } finally {
      await db.drop();
    }
  });
});
