/**
 * Quote/pricing integration helpers: a harness with the synthetic geo doubles (MOCK, straight-line routes), the
 * dev-only synthetic catalog + pricing seed (one synthetic truth with local development) and — so results never depend
 * on the wall-clock hour of the test run — an ACTIVE copy of the seeded LHR zone set with all-day service hours.
 * Synthetic data only (public-landmark-level probe points, synthetic rate cards "SYNTHETIC — not a Wayvro price").
 */
import { randomUUID } from 'node:crypto';
import { SYNTHETIC_CATALOG, seedSyntheticCatalog } from '@wayvro/test-support';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { startGeoApi, type GeoHarness, type GeoHarnessOptions } from './geo-helpers.js';
import { bearer, key, type Harness } from './support.js';

export const S = SYNTHETIC_CATALOG;
export const P = SYNTHETIC_CATALOG.pricing;

/** Seeds the synthetic catalog + pricing and replaces the LHR zone set by an all-day copy (same zones and points). */
export async function seedQuotes(h: Harness, options: { enableComfort?: boolean } = {}): Promise<{ zoneSetId: string }> {
  const url = h.owner.options.connectionString;
  if (!url) throw new Error('owner pool without connection string');
  await seedSyntheticCatalog({ env: 'test', databaseUrl: url });
  const id = randomUUID();
  await h.owner.query(
    `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference)
     values ($1, 'LHR', (select max(version) + 1 from catalog.zone_sets where city_code = 'LHR'), 'DRAFT', true, 'SYNTHETIC — all-day test hours')`,
    [id],
  );
  await h.owner.query(
    `insert into catalog.zones (id, zone_set_id, code, kind, name_en, name_ur, geom) select gen_random_uuid(), $1, code, kind, name_en, name_ur, geom
       from catalog.zones where zone_set_id = $2`,
    [id, S.zoneSetId],
  );
  await h.owner.query(
    `insert into catalog.pickup_points (id, zone_set_id, zone_code, kind, point, name_en, name_ur, instruction_key, status)
     select gen_random_uuid(), $1, zone_code, kind, point, name_en, name_ur, instruction_key, status from catalog.pickup_points where zone_set_id = $2`,
    [id, S.zoneSetId],
  );
  for (let d = 0; d < 7; d++) {
    await h.owner.query(`insert into catalog.service_hours (id, zone_set_id, weekday, opens_local, closes_local) values ($1, $2, $3, '00:00', '00:00')`, [
      randomUUID(),
      id,
      d,
    ]);
  }
  await h.owner.query(`update catalog.zone_sets set status = 'RETIRED', effective_until = clock_timestamp() where id = $1`, [S.zoneSetId]);
  await h.owner.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [id]);
  if (options.enableComfort) {
    await h.owner.query(
      `update catalog.city_service_products set status = 'ENABLED', legal_basis_ref = $1, is_synthetic = true, reason_code = 'SYNTHETIC_SEED', updated_at = now()
        where city_code = 'LHR' and product_code = 'COMFORT'`,
      [S.legalBasisRef],
    );
  }
  return { zoneSetId: id };
}

/** Quote API harness: geo doubles + seams; the IP-prefix limit is lifted (every injected request shares 127.0.0.1). */
export async function startQuoteApi(options: GeoHarnessOptions & { enableComfort?: boolean } = {}): Promise<GeoHarness & { zoneSetId: string }> {
  const g = await startGeoApi({ ...options, env: { QUOTES_PER_MINUTE_IP_PREFIX: '100000', ...options.env } });
  const { zoneSetId } = await seedQuotes(g.h, { enableComfort: options.enableComfort ?? false });
  return { ...g, zoneSetId };
}

export interface Point {
  readonly lat: number;
  readonly lng: number;
  readonly placeRef?: string;
}

export const quoteBody = (pickup: Point = S.points.inside, dropoff: Point = S.points.insideOther, extra: Record<string, unknown> = {}) => ({
  cityCode: 'LHR',
  pickup,
  dropoff,
  ...extra,
});

export function postQuote(
  h: Harness,
  token: string | null,
  body: unknown,
  options: { key?: string; detail?: 'full' | 'lite'; headers?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  const request: InjectOptions = {
    method: 'POST',
    url: `/v1/quotes${options.detail ? `?detail=${options.detail}` : ''}`,
    payload: body as NonNullable<InjectOptions['payload']>,
    headers: { 'idempotency-key': options.key ?? key(), ...(token ? bearer(token) : {}), ...options.headers },
  };
  return h.inject(request);
}

export const getQuote = (h: Harness, token: string | null, id: string, detail?: 'lite' | 'full') =>
  h.inject({ method: 'GET', url: `/v1/quotes/${id}${detail ? `?detail=${detail}` : ''}`, headers: token ? bearer(token) : {} });

export const errorOf = (res: LightMyRequestResponse) =>
  res.json<{ error?: { code: string; details?: { reasonCodes?: string[]; retryAfterSeconds?: number; nextOpenAt?: string } } }>().error;

/** Row counts of the pricing tables a quote writes (zero-write assertions). */
export async function quoteRows(h: Harness): Promise<{ quotes: number; snapshots: number; components: number }> {
  const r = await h.owner.query<{ quotes: number; snapshots: number; components: number }>(
    `select (select count(*)::int from pricing.quotes) quotes, (select count(*)::int from pricing.route_snapshots) snapshots,
            (select count(*)::int from pricing.quote_components) components`,
  );
  const row = r.rows[0];
  if (!row) throw new Error('count query returned no row');
  return row;
}
