/**
 * Geo cost controls and staff geo administration (Phase 3 P3.2; I11; BUDGET BUD-01..04, BUD-08; maker-checker with the
 * single-staff DECREASE exception; landmark aliases A06) against real PostgreSQL + Valkey with the synthetic doubles
 * (terms TTL 0 here, so every request reaches the "provider" and consumes budget). CATALOG_MANAGER is granted through
 * the real staff API (migration 0010 widened the role CHECK for the FA-10 roles).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { AutocompleteResultSchema, GeoBudgetListSchema, GeoBudgetSchema, GeoUsageSchema, LandmarkAliasSchema } from '@wayvro/contracts';
import { GeoUsageCounters, awaitRedisReady, createRequestPathRedis } from '@wayvro/server-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoutingUnavailableError } from '../src/geo/routing.js';
import { autocompleteUrl, geoGet, reasonCodes, reverseUrl, startGeoApi, type GeoHarness } from './geo-helpers.js';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { key, post, signIn, type SignedIn } from './support.js';

interface LogLine {
  signal?: string;
  sku?: string;
  percent?: number;
  window?: string;
  meter?: string;
}
const signals = (text: string): LogLine[] =>
  text
    .split('\n')
    .filter((l) => l.includes('"signal"'))
    .map((l) => JSON.parse(l) as LogLine);

let g: GeoHarness;
let kit: ReturnType<typeof staffKit>;
let m1: Staff;
let m2: Staff;
let auditor: Staff;
let user: SignedIn;
beforeAll(async () => {
  g = await startGeoApi({
    env: {
      ...STAFF_ENV,
      GEO_LOCAL_DAILY_CALLS_PER_SKU: '10',
      GEO_AUTOCOMPLETE_PER_MINUTE_ACCOUNT: '10000',
      GEO_REVERSE_PER_MINUTE_ACCOUNT: '10000',
      GEO_RESOLVE_PER_MINUTE_ACCOUNT: '10000',
    },
    doubleOptions: { ttlSeconds: { AUTOCOMPLETE: 0, GEOCODE: 600, REVERSE_GEOCODE: 0, PLACE_RESOLVE: 0, ROUTE: 0 }, microUsdPerCall: 1000 },
  });
  kit = staffKit(g.h);
  const admins = await kit.bootstrapAdmins(2);
  m1 = await kit.staffWithRole(admins, 'CATALOG_MANAGER', 'Catalog One');
  m2 = await kit.staffWithRole(admins, 'CATALOG_MANAGER', 'Catalog Two');
  auditor = await kit.staffWithRole(admins, 'AUDITOR', 'Auditor One');
  user = await signIn(g.h);
}, 180_000);
afterAll(async () => {
  await g.h.close();
});

const staffGet = (s: Staff, url: string) => g.h.inject({ method: 'GET', url, headers: kit.sb(s) });
const auditActions = async (objectId: string): Promise<string[]> =>
  (
    await g.h.owner.query<{ a: string }>(`select action || coalesce(':' || reason_code, '') a from audit.audit_events where object_id = $1 order by seq`, [
      objectId,
    ])
  ).rows.map((r) => r.a);

describe('landmark aliases through the staff API (A06)', () => {
  it('propose → approve by a DIFFERENT staff member → expands searches; retire stops it; the proposer cannot approve', async () => {
    const draft = await kit.privileged(m1, '/v1/admin/geo/landmark-aliases', {
      cityCode: 'LHR',
      locale: 'en',
      alias: '  LIBARTI ',
      canonicalQuery: 'Liberty Market',
      source: 'FIELD',
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const alias = LandmarkAliasSchema.parse(draft.json());
    expect(alias).toMatchObject({ aliasNormalised: 'libarti', canonicalQuery: 'liberty market', status: 'PROPOSED', createdByStaffId: m1.staffId });
    expect((await kit.privileged(m1, `/v1/admin/geo/landmark-aliases/${alias.id}/approval`, { decision: 'REJECT' })).statusCode).toBe(403);
    const self = await kit.privileged(m1, `/v1/admin/geo/landmark-aliases/${alias.id}/approval`, { decision: 'APPROVE' });
    expect(self.statusCode).toBe(403);
    const ok = await kit.privileged(m2, `/v1/admin/geo/landmark-aliases/${alias.id}/approval`, { decision: 'APPROVE' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(LandmarkAliasSchema.parse(ok.json())).toMatchObject({ status: 'ACTIVE', approvedByStaffId: m2.staffId });
    const found = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl('Libarti'), user.accessToken)).json());
    expect(found.suggestions[0]?.primaryText).toBe('Liberty Market');
    expect((g.doubles.control.inputs('AUTOCOMPLETE').at(-1) as { text: string }).text).toBe('liberty market');
    expect((await kit.privileged(m2, `/v1/admin/geo/landmark-aliases/${alias.id}/retirement`, {})).statusCode).toBe(200);
    const after = AutocompleteResultSchema.parse((await geoGet(g.h, autocompleteUrl('Libarti'), user.accessToken)).json());
    expect(after.suggestions).toEqual([]);
    const list = await staffGet(auditor, '/v1/admin/geo/landmark-aliases?cityCode=LHR');
    expect(list.statusCode).toBe(200);
    expect(await auditActions(alias.id)).toEqual([
      'GEO_ALIAS_PROPOSED',
      'STAFF_ACCESS_DENIED:MAKER_IS_CHECKER',
      'STAFF_ACCESS_DENIED:MAKER_IS_CHECKER',
      'GEO_ALIAS_APPROVED',
      'GEO_ALIAS_RETIRED',
    ]);
    // AUDITOR may read but not propose
    expect(
      (
        await kit.privileged(auditor, '/v1/admin/geo/landmark-aliases', {
          cityCode: 'LHR',
          locale: 'en',
          alias: 'abc',
          canonicalQuery: 'liberty',
          source: 'FIELD',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('BUD-01..04: Valkey budgets in front of every provider call', () => {
  let budgetRefusals = 0;

  it('BUD-01/BUD-02: thresholds signal once per window; at 100 % the SKU is refused (503 GEO_BUDGET_EXHAUSTED) with no provider call', async () => {
    const used0 = g.doubles.control.calls('AUTOCOMPLETE');
    g.h.logs.clear();
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      const res = await geoGet(g.h, autocompleteUrl(`budget${String(i)}x`), user.accessToken);
      if (res.statusCode === 200) ok++;
      else {
        expect(res.statusCode).toBe(503);
        expect(reasonCodes(res)).toEqual(['GEO_BUDGET_EXHAUSTED']);
      }
    }
    expect(ok).toBe(10 - used0);
    expect(g.doubles.control.calls('AUTOCOMPLETE')).toBe(10);
    const s = signals(g.h.logs.text()).filter((l) => l.sku === 'AUTOCOMPLETE');
    const thresholds = s.filter((l) => l.signal === 'GEO_BUDGET_THRESHOLD' && l.window === 'day').map((l) => l.percent);
    // thresholds already crossed before this test (by the alias test's calls) were signalled then
    expect(thresholds.length).toBe(new Set(thresholds).size);
    expect(thresholds).toContain(100);
    expect(s.filter((l) => l.signal === 'GEO_BUDGET_EXHAUSTED')).toHaveLength(1);
    expect(s.filter((l) => l.signal === 'GEO_BUDGET_THRESHOLD' && l.window === 'month')).toEqual([]);
  });

  it('BUD-02: an exhausted ROUTE budget refuses quotes routing (never an estimate)', async () => {
    let lat = 31.4;
    const route = () => {
      lat += 0.005;
      return g.h.runtime.geo.routing.route(
        { origin: { lat, lng: 74.3 }, destination: { lat: 31.6, lng: 74.4 }, profile: 'CAR', departAt: new Date() },
        Date.now() + 3000,
      );
    };
    for (let i = 0; i < 10; i++) await route();
    await expect(route()).rejects.toMatchObject({ name: 'RoutingUnavailableError', reason: 'BUDGET_EXHAUSTED' });
    await expect(route()).rejects.toBeInstanceOf(RoutingUnavailableError);
    expect(g.doubles.control.calls('ROUTE')).toBe(10);
  });

  it('BUD-03: 100 concurrent calls at budget − 1 ⇒ exactly one provider call', async () => {
    for (let i = 0; i < 9; i++) expect((await geoGet(g.h, reverseUrl(31.51, 74.341), user.accessToken)).statusCode).toBe(200);
    const before = g.doubles.control.calls('REVERSE_GEOCODE');
    const results = await Promise.all(Array.from({ length: 100 }, () => geoGet(g.h, reverseUrl(31.51, 74.341), user.accessToken)));
    expect(g.doubles.control.calls('REVERSE_GEOCODE') - before).toBe(1);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    // every other request is refused 503; under heavy machine load a Valkey command can exceed the 250 ms request-path
    // timeout, and that request then fails CLOSED (GEO_PROVIDER_UNAVAILABLE) — never a second provider call
    const refused = results.filter((r) => r.statusCode === 503);
    expect(refused).toHaveLength(99);
    budgetRefusals = refused.filter((r) => reasonCodes(r)[0] === 'GEO_BUDGET_EXHAUSTED').length;
    expect(budgetRefusals).toBeGreaterThan(0);
    expect(refused.every((r) => ['GEO_BUDGET_EXHAUSTED', 'GEO_PROVIDER_UNAVAILABLE'].includes(reasonCodes(r)[0] ?? ''))).toBe(true);
  });

  it('BUD-04: day/month windows are UTC calendar keys on server time; refusals and calls are metered per hour', async () => {
    const redis = createRequestPathRedis(process.env['REDIS_URL'] ?? '', 2000);
    try {
      expect(await awaitRedisReady(redis, 5000)).toBe(true);
      const day = new Date().toISOString().slice(0, 10);
      expect(await redis.get(`${g.h.keyPrefix}geo:bud:d:geo-mock:REVERSE_GEOCODE:${day}`)).toBe('10');
      expect(await redis.get(`${g.h.keyPrefix}geo:bud:m:geo-mock:REVERSE_GEOCODE:${day.slice(0, 7)}`)).toBe('10');
      // the local/test default has no cost cap: no cost counter exists for it
      expect(await redis.exists(`${g.h.keyPrefix}geo:bud:c:geo-mock:REVERSE_GEOCODE:${day.slice(0, 7)}`)).toBe(0);
      const usage = new GeoUsageCounters(redis, `${g.h.keyPrefix}geo:`);
      // the current and the previous hour (the suite may straddle an hour boundary)
      const hours = await Promise.all([new Date(), new Date(Date.now() - 3_600_000)].map((at) => redis.hgetall(usage.key('geo-mock', 'REVERSE_GEOCODE', at))));
      const sum = (field: string) => hours.reduce((n, h) => n + Number(h[field] ?? '0'), 0);
      expect(sum('calls')).toBe(10);
      expect(sum('budget_refusals')).toBe(budgetRefusals);
      expect(sum('est_cost_micro_usd')).toBe(10 * 1000);
    } finally {
      redis.disconnect();
    }
  });
});

describe('BUD-08: budget changes are maker-checker, step-up and audited', () => {
  let initial: string;

  it('draft (INITIAL) → submit → the drafter cannot approve → a different manager approves → activate; the cost cap applies at once', async () => {
    const draft = await kit.privileged(m1, '/v1/admin/geo/budgets', {
      providerKey: 'geo-mock',
      sku: 'GEOCODE',
      dailyCalls: 100,
      monthlyCalls: 1000,
      monthlyCostMicroUsd: 3000,
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const b = GeoBudgetSchema.parse(draft.json());
    expect(b).toMatchObject({ status: 'DRAFT', changeKind: 'INITIAL', version: 1, alertThresholdsPct: [50, 80, 100], draftedByStaffId: m1.staffId });
    initial = b.id;
    expect((await kit.privileged(m1, `/v1/admin/geo/budgets/${b.id}/submission`, {})).statusCode).toBe(200);
    const self = await kit.privileged(m1, `/v1/admin/geo/budgets/${b.id}/approval`, { decision: 'APPROVE' });
    expect(self.statusCode).toBe(403);
    const approved = await kit.privileged(m2, `/v1/admin/geo/budgets/${b.id}/approval`, { decision: 'APPROVE' });
    expect(GeoBudgetSchema.parse(approved.json())).toMatchObject({ status: 'APPROVED', approvedByStaffId: m2.staffId });
    const active = await kit.privileged(m2, `/v1/admin/geo/budgets/${b.id}/activation`, {});
    expect(GeoBudgetSchema.parse(active.json()).status).toBe('ACTIVE');
    expect(await auditActions(b.id)).toEqual([
      'GEO_BUDGET_DRAFTED:INITIAL',
      'GEO_BUDGET_SUBMITTED',
      'STAFF_ACCESS_DENIED:MAKER_IS_CHECKER',
      'GEO_BUDGET_APPROVED',
      'GEO_BUDGET_ACTIVATED',
    ]);
    // 3 000 micro-USD at 1 000 per call: the fourth forward geocode is refused although calls remain
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push(
        (await geoGet(g.h, autocompleteUrl(`cost${String(i)}${randomBytes(2).toString('hex')}`, { mode: 'GEOCODE' }), user.accessToken)).statusCode,
      );
    expect(statuses).toEqual([200, 200, 200, 503]);
  });

  it('a DECREASE may be approved by its drafter (with step-up); an INCREASE may not', async () => {
    const dec = GeoBudgetSchema.parse(
      (
        await kit.privileged(m1, '/v1/admin/geo/budgets', {
          providerKey: 'geo-mock',
          sku: 'GEOCODE',
          dailyCalls: 50,
          monthlyCalls: 1000,
          monthlyCostMicroUsd: 3000,
        })
      ).json(),
    );
    expect(dec).toMatchObject({ changeKind: 'DECREASE', version: 2 });
    await kit.privileged(m1, `/v1/admin/geo/budgets/${dec.id}/submission`, {});
    const self = await kit.privileged(m1, `/v1/admin/geo/budgets/${dec.id}/approval`, { decision: 'APPROVE' });
    expect(self.statusCode, self.body).toBe(200);
    expect(GeoBudgetSchema.parse(self.json())).toMatchObject({ status: 'APPROVED', approvedByStaffId: m1.staffId });
    expect(GeoBudgetSchema.parse((await kit.privileged(m1, `/v1/admin/geo/budgets/${dec.id}/activation`, {})).json()).status).toBe('ACTIVE');
    expect(await auditActions(dec.id)).toContain('GEO_BUDGET_APPROVED:SINGLE_STAFF_DECREASE');
    const list = GeoBudgetListSchema.parse((await staffGet(auditor, '/v1/admin/geo/budgets?sku=GEOCODE')).json());
    expect(list.budgets.find((x) => x.id === initial)?.status).toBe('RETIRED');

    const inc = GeoBudgetSchema.parse(
      (
        await kit.privileged(m1, '/v1/admin/geo/budgets', {
          providerKey: 'geo-mock',
          sku: 'GEOCODE',
          dailyCalls: 500,
          monthlyCalls: 1000,
          monthlyCostMicroUsd: 3000,
        })
      ).json(),
    );
    expect(inc.changeKind).toBe('INCREASE');
    // only the drafter submits; the drafter never decides their own increase (approve or reject)
    expect((await kit.privileged(m2, `/v1/admin/geo/budgets/${inc.id}/submission`, {})).statusCode).toBe(403);
    await kit.privileged(m1, `/v1/admin/geo/budgets/${inc.id}/submission`, {});
    expect((await kit.privileged(m1, `/v1/admin/geo/budgets/${inc.id}/approval`, { decision: 'APPROVE' })).statusCode).toBe(403);
    expect((await kit.privileged(m1, `/v1/admin/geo/budgets/${inc.id}/approval`, { decision: 'REJECT' })).statusCode).toBe(403);
    const rejected = await kit.privileged(m2, `/v1/admin/geo/budgets/${inc.id}/approval`, { decision: 'REJECT' });
    expect(GeoBudgetSchema.parse(rejected.json()).status).toBe('REJECTED');
    expect((await kit.privileged(m2, `/v1/admin/geo/budgets/${inc.id}/activation`, {})).statusCode).toBe(409);
  });

  it('mutations are idempotent per key; AUDITOR reads but cannot draft; invalid bodies are 400; retire returns the SKU to its default', async () => {
    await kit.stepUp(m1);
    const k = key();
    const body = { providerKey: 'geo-mock', sku: 'PLACE_RESOLVE', dailyCalls: 10, monthlyCalls: 100, monthlyCostMicroUsd: 0, alertThresholdsPct: [80, 50] };
    const first = await g.h.inject(post('/v1/admin/geo/budgets', body, { ...kit.sb(m1), 'idempotency-key': k }));
    const replay = await g.h.inject(post('/v1/admin/geo/budgets', body, { ...kit.sb(m1), 'idempotency-key': k }));
    expect(first.statusCode).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(GeoBudgetSchema.parse(first.json()).alertThresholdsPct).toEqual([50, 80]);
    expect((await kit.privileged(auditor, '/v1/admin/geo/budgets', body)).statusCode).toBe(403);
    for (const bad of [
      { ...body, dailyCalls: 200, monthlyCalls: 100 },
      { ...body, alertThresholdsPct: [33] },
      { ...body, providerKey: 'Google' },
      { ...body, extra: 1 },
    ]) {
      expect((await kit.privileged(m1, '/v1/admin/geo/budgets', bad)).statusCode).toBe(400);
    }
    const active = GeoBudgetListSchema.parse((await staffGet(auditor, '/v1/admin/geo/budgets?sku=GEOCODE')).json()).budgets.find((b) => b.status === 'ACTIVE');
    expect(active).toBeDefined();
    expect(GeoBudgetSchema.parse((await kit.privileged(m2, `/v1/admin/geo/budgets/${active?.id ?? randomUUID()}/retirement`, {})).json()).status).toBe(
      'RETIRED',
    );
    expect((await kit.privileged(m2, `/v1/admin/geo/budgets/${randomUUID()}/retirement`, {})).statusCode).toBe(404);
    expect((await kit.privileged(m2, '/v1/admin/geo/budgets/not-a-uuid/retirement', {})).statusCode).toBe(404);
  });

  it('hourly usage view: aggregates only, bounded range', async () => {
    await g.h.owner.query(
      `insert into geo.provider_usage (provider_key, sku, hour_bucket, calls, cache_hits, errors, timeouts, budget_refusals, est_cost_micro_usd)
       values ('geo-mock', 'ROUTE', '2026-10-12T05:00:00Z', 7, 2, 1, 1, 0, 7000)`,
    );
    const res = await staffGet(auditor, '/v1/admin/geo/usage?from=2026-10-12T00:00:00Z&to=2026-10-13T00:00:00Z');
    expect(res.statusCode, res.body).toBe(200);
    expect(GeoUsageSchema.parse(res.json()).hours).toEqual([
      {
        providerKey: 'geo-mock',
        sku: 'ROUTE',
        hourBucket: '2026-10-12T05:00:00.000Z',
        calls: 7,
        cacheHits: 2,
        errors: 1,
        timeouts: 1,
        budgetRefusals: 0,
        estCostMicroUsd: 7000,
      },
    ]);
    const tooLong = await staffGet(auditor, '/v1/admin/geo/usage?from=2026-08-01T00:00:00Z&to=2026-10-13T00:00:00Z');
    expect(tooLong.statusCode).toBe(400);
    expect(reasonCodes(tooLong)).toEqual(['USAGE_RANGE_INVALID']);
    expect((await g.h.inject({ method: 'GET', url: '/v1/admin/geo/usage?from=2026-10-12T00:00:00Z&to=2026-10-13T00:00:00Z' })).statusCode).toBe(401);
  });
});
