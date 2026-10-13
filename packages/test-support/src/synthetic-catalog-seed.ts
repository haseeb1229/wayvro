/**
 * Synthetic Lahore catalog seed — DEVELOPMENT/TEST ONLY (ADR-045; docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md §7;
 * FA-12: synthetic zones only, no real boundary import). Never a migration; this package is never part of a deployable
 * artefact (ART-ISO). Local development (`pnpm seed:synthetic`) and the integration tests share this one synthetic
 * truth.
 *
 * Refusals: WAYVRO_ENV must be `local` or `test`; the database host must be a loopback host; the database must not
 * hold any NON-synthetic zone set, eligibility rule, rate card or tax policy; an ACTIVE zone set for LHR other than the
 * seed's own is refused. Idempotent: fixed synthetic UUIDs, one transaction; a re-run converges to the same state.
 *
 * Contents (coarse rectangles around public landmarks, ≤ 3 decimals, no private addresses; source_reference says
 * SYNTHETIC): LHR zone set v-next with one SERVICE_AREA, one EXCLUSION, one PICKUP_RESTRICTED zone with two DESIGNATED
 * points, one AIRPORT_PRECINCT with one AIRPORT point; service hours 06:00–23:00 every day (general rows); ACTIVE
 * synthetic eligibility rules for ECONOMY and COMFORT.
 *
 * City products: ECONOMY → ENABLED (`legal_basis_ref = 'SYNTHETIC_LOCAL_TEST_ONLY'`, `is_synthetic`, no maker — a
 * system-seeded row, which the database admits because ENABLED needs a checker only when a staff maker exists) so local
 * quotes have a product; COMFORT → CONFIGURED (zone + rule prerequisites exist) so the staff maker-checker ENABLE flow
 * can be exercised once a rate-card source exists. The database does NOT require a rate card for ENABLED: until the
 * pricing seed (P3.3) adds synthetic rate cards, quotes for ECONOMY report NO_ACTIVE_RATE_CARD rather than a price.
 * BIKE/RICKSHAW stay DISABLED_LEGAL_GATE (FA-11; the database refuses anything else).
 */
import pg from 'pg';

/** Fixed synthetic identifiers and probe points (public-landmark level, ≤ 3 decimals) shared by tests. */
export const SYNTHETIC_CATALOG = {
  cityCode: 'LHR',
  zoneSetId: '00000000-0000-7000-8000-00000000c510',
  economyRuleId: '00000000-0000-7000-8000-00000000c511',
  comfortRuleId: '00000000-0000-7000-8000-00000000c512',
  sourceReference: 'SYNTHETIC — not real Lahore boundaries',
  legalBasisRef: 'SYNTHETIC_LOCAL_TEST_ONLY',
  /** [minLng, minLat, maxLng, maxLat] of each synthetic zone. */
  rectangles: {
    serviceArea: [74.2, 31.4, 74.5, 31.65],
    exclusion: [74.3, 31.575, 74.32, 31.59],
    pickupRestricted: [74.33, 31.509, 74.338, 31.517],
    airport: [74.398, 31.515, 74.412, 31.527],
  },
  /** Probe points (lat/lng) with their expected classification under the seeded set. */
  points: {
    inside: { lat: 31.52, lng: 74.35 },
    insideOther: { lat: 31.47, lng: 74.27 },
    excluded: { lat: 31.582, lng: 74.31 },
    outside: { lat: 31.7, lng: 74.35 },
    restricted: { lat: 31.512, lng: 74.332 },
    airport: { lat: 31.52, lng: 74.404 },
  },
  designatedPoints: [
    { lat: 31.51, lng: 74.331, nameEn: 'Synthetic gate A' },
    { lat: 31.516, lng: 74.337, nameEn: 'Synthetic gate B' },
  ],
  airportPoint: { lat: 31.52, lng: 74.405, nameEn: 'Synthetic arrivals bay' },
  hours: { opensLocal: '06:00', closesLocal: '23:00' },
} as const;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface SyntheticCatalogSeedOptions {
  /** The value of WAYVRO_ENV; anything but `local`/`test` is refused. */
  readonly env: string | undefined;
  /** Connection URL of a role allowed to seed (the local owner/superuser): writes system-seeded ACTIVE rows. */
  readonly databaseUrl: string;
  /** Receives one line per planned write (what the seed is about to do). */
  readonly log?: (line: string) => void;
}

export interface SyntheticCatalogSeedResult {
  readonly zoneSetId: string;
  readonly zoneSetVersion: number;
  readonly createdZoneSet: boolean;
}

type Rect = readonly [number, number, number, number];
const polygon = ([x0, y0, x1, y1]: Rect): string =>
  JSON.stringify({
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
          [x0, y0],
        ],
      ],
    ],
  });

/** Refuses anything but a loopback database in a local/test environment (before connecting). */
export function assertSyntheticSeedAllowed(env: string | undefined, databaseUrl: string): void {
  if (env !== 'local' && env !== 'test') throw new Error(`synthetic catalog seed refused: WAYVRO_ENV must be local or test (got ${env ?? 'unset'})`);
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error('synthetic catalog seed refused: DATABASE_URL is not a valid URL');
  }
  if (!LOOPBACK_HOSTS.has(host)) throw new Error(`synthetic catalog seed refused: database host ${host} is not a loopback host`);
}

async function nonSyntheticConfiguration(c: pg.ClientBase): Promise<string[]> {
  const found: string[] = [];
  const probe = async (table: string, where: string): Promise<void> => {
    const exists = (await c.query<{ t: string | null }>(`select to_regclass($1)::text t`, [table])).rows[0]?.t;
    if (!exists) return;
    const r = await c.query(`select 1 from ${table} where ${where} limit 1`);
    if (r.rowCount !== 0) found.push(table);
  };
  await probe('catalog.zone_sets', 'not is_synthetic');
  await probe('catalog.vehicle_eligibility_rules', 'not is_synthetic');
  // pricing lands in P3.3 (migration 0012); probed only once the tables exist
  await probe('pricing.rate_cards', 'not is_synthetic');
  await probe('pricing.tax_policies', 'not is_placeholder');
  return found;
}

export async function seedSyntheticCatalog(options: SyntheticCatalogSeedOptions): Promise<SyntheticCatalogSeedResult> {
  assertSyntheticSeedAllowed(options.env, options.databaseUrl);
  const log = options.log ?? (() => undefined);
  const S = SYNTHETIC_CATALOG;
  const client = new pg.Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    await client.query('begin');
    const real = await nonSyntheticConfiguration(client);
    if (real.length > 0) throw new Error(`synthetic catalog seed refused: non-synthetic configuration exists in ${real.join(', ')}`);
    const active = (await client.query<{ id: string }>(`select id from catalog.zone_sets where city_code = $1 and status = 'ACTIVE'`, [S.cityCode])).rows[0];
    if (active && active.id !== S.zoneSetId) throw new Error(`synthetic catalog seed refused: another ACTIVE zone set exists for ${S.cityCode}`);

    let createdZoneSet = false;
    const existing = (await client.query<{ version: number }>(`select version from catalog.zone_sets where id = $1`, [S.zoneSetId])).rows[0];
    let version = existing?.version ?? 0;
    if (!existing) {
      createdZoneSet = true;
      log(
        `zone set ${S.zoneSetId} (${S.cityCode}, synthetic): 4 zones, 3 pickup points, hours ${S.hours.opensLocal}-${S.hours.closesLocal} every day -> ACTIVE`,
      );
      const v = await client.query<{ version: number }>(
        `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference)
         select $1, $2, coalesce(max(version), 0) + 1, 'DRAFT', true, $3 from catalog.zone_sets where city_code = $2 returning version`,
        [S.zoneSetId, S.cityCode, S.sourceReference],
      );
      version = v.rows[0]?.version ?? 0;
      const zones: ReadonlyArray<readonly [string, string, string, string, Rect]> = [
        ['00000000-0000-7000-8000-00000000c520', 'SYN-SERVICE', 'SERVICE_AREA', 'Synthetic service area', S.rectangles.serviceArea],
        ['00000000-0000-7000-8000-00000000c521', 'SYN-EXCLUDED', 'EXCLUSION', 'Synthetic exclusion', S.rectangles.exclusion],
        ['00000000-0000-7000-8000-00000000c522', 'SYN-VENUE', 'PICKUP_RESTRICTED', 'Synthetic venue pickup zone', S.rectangles.pickupRestricted],
        ['00000000-0000-7000-8000-00000000c523', 'SYN-AIRPORT', 'AIRPORT_PRECINCT', 'Synthetic airport precinct', S.rectangles.airport],
      ];
      for (const [id, code, kind, name, rect] of zones) {
        await client.query(
          `insert into catalog.zones (id, zone_set_id, code, kind, name_en, name_ur, geom) values ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_GeomFromGeoJSON($7), 4326))`,
          [id, S.zoneSetId, code, kind, name, `مصنوعی ${code}`, polygon(rect)],
        );
      }
      const points: ReadonlyArray<readonly [string, string, string, { lat: number; lng: number; nameEn: string }]> = [
        ['00000000-0000-7000-8000-00000000c530', 'SYN-VENUE', 'DESIGNATED', S.designatedPoints[0]],
        ['00000000-0000-7000-8000-00000000c531', 'SYN-VENUE', 'DESIGNATED', S.designatedPoints[1]],
        ['00000000-0000-7000-8000-00000000c532', 'SYN-AIRPORT', 'AIRPORT', S.airportPoint],
      ];
      for (const [id, zoneCode, kind, p] of points) {
        await client.query(
          `insert into catalog.pickup_points (id, zone_set_id, zone_code, kind, point, name_en, name_ur, instruction_key, status)
           values ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5::float8, $6::float8), 4326), $7, $8, 'pickup.synthetic.follow_signs', 'ACTIVE')`,
          [id, S.zoneSetId, zoneCode, kind, p.lng, p.lat, p.nameEn, `مصنوعی ${p.nameEn}`],
        );
      }
      for (let weekday = 0; weekday < 7; weekday++) {
        await client.query(
          `insert into catalog.service_hours (id, zone_set_id, product_code, weekday, opens_local, closes_local) values ($1, $2, null, $3, $4::time, $5::time)`,
          [`00000000-0000-7000-8000-00000000c54${String(weekday)}`, S.zoneSetId, weekday, S.hours.opensLocal, S.hours.closesLocal],
        );
      }
      await client.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [S.zoneSetId]);
    }

    const rules: ReadonlyArray<readonly [string, string, number, number | null, boolean, string[]]> = [
      [S.economyRuleId, 'ECONOMY', 15, null, false, []],
      [S.comfortRuleId, 'COMFORT', 8, 4, true, ['SEDAN', 'SUV', 'CROSSOVER', 'MPV']],
    ];
    for (const [id, product, maxAge, minSeats, ac, bodies] of rules) {
      log(`eligibility rule ${id} (${S.cityCode}/${product}, synthetic) -> ACTIVE`);
      await client.query(
        `insert into catalog.vehicle_eligibility_rules (id, city_code, product_code, version, status, is_synthetic, source_reference, max_vehicle_age_years, min_seats,
                                                        ac_required, allowed_body_types, effective_from)
         select $1, $2, $3, coalesce(max(version), 0) + 1, 'ACTIVE', true, 'SYNTHETIC — not a Punjab/Lahore regulatory value', $4, $5, $6, $7, clock_timestamp()
           from catalog.vehicle_eligibility_rules where city_code = $2 and product_code = $3
         on conflict (id) do nothing`,
        [id, S.cityCode, product, maxAge, minSeats, ac, bodies],
      );
    }

    log(`city products ${S.cityCode}: ECONOMY -> ENABLED (synthetic legal basis), COMFORT -> CONFIGURED`);
    await client.query(
      `update catalog.city_service_products set status = 'ENABLED', pending_transition = null, legal_basis_ref = $2, is_synthetic = true, changed_by_staff_id = null,
              approved_by_staff_id = null, reason_code = 'SYNTHETIC_SEED', updated_at = now()
        where city_code = $1 and product_code = 'ECONOMY'`,
      [S.cityCode, S.legalBasisRef],
    );
    await client.query(
      `update catalog.city_service_products set status = 'CONFIGURED', pending_transition = null, legal_basis_ref = null, is_synthetic = true, changed_by_staff_id = null,
              approved_by_staff_id = null, reason_code = 'SYNTHETIC_SEED', updated_at = now()
        where city_code = $1 and product_code = 'COMFORT'`,
      [S.cityCode],
    );
    await client.query('commit');
    return { zoneSetId: S.zoneSetId, zoneSetVersion: version, createdZoneSet };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
}
