/**
 * P3.8 driver readiness against real PostgreSQL + PostGIS as the restricted API role, seeded through the dev-only
 * synthetic catalog seed: `GET /v1/driver/compliance` carries the additive `productEligibility` — per affiliated
 * vehicle × product of the driver's city — computed server-side by the catalog read model (ECONOMY/COMFORT synthetic
 * rules; BIKE/RICKSHAW DISABLED_LEGAL_GATE ⇒ NOT_OFFERED; a CONFIGURED product ⇒ NOT_OFFERED; missing optional claims ⇒
 * UNKNOWN with the attributes the rule needs). Display only: earning eligibility is unchanged by it. Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { AccountStateSchema, DriverApplicationSchema, DriverComplianceSchema, type DriverCompliance } from '@wayvro/contracts';
import { ENCRYPTED_FIELDS, fieldContext } from '@wayvro/identity-core';
import { currentDocument } from '@wayvro/legal-content';
import { SYNTHETIC_CATALOG, seedSyntheticCatalog } from '@wayvro/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, post, signIn, startApi, type Harness } from './support.js';

let h: Harness;
const S = SYNTHETIC_CATALOG;
let ruleVersion: { ECONOMY: number; COMFORT: number };

beforeAll(async () => {
  h = await startApi();
  const url = h.owner.options.connectionString;
  if (!url) throw new Error('owner pool without connection string');
  await seedSyntheticCatalog({ env: 'test', databaseUrl: url });
  const rules = await h.owner.query<{ id: string; version: number }>(`select id, version from catalog.vehicle_eligibility_rules where id = any($1::uuid[])`, [
    [S.economyRuleId, S.comfortRuleId],
  ]);
  const version = (id: string) => rules.rows.find((r) => r.id === id)?.version ?? -1;
  ruleVersion = { ECONOMY: version(S.economyRuleId), COMFORT: version(S.comfortRuleId) };
}, 60_000);
afterAll(async () => {
  await h.close();
});

/** Calendar year in Asia/Karachi (UTC+05:00) — the year the server's age rule uses. */
const karachiYear = (): number => new Date(Date.now() + 5 * 3_600_000).getUTCFullYear();

interface VehicleInput {
  readonly modelYear: number;
  readonly seats?: number;
  readonly bodyType?: string;
  readonly airConditioned?: boolean;
}

/**
 * A consumer with an application and one CAR vehicle, turned into a VERIFIED driver profile. A profile normally comes
 * from a human review decision (P2.7); here a synthetic one is inserted directly (no capability is granted).
 */
async function approvedDriver(vehicle: VehicleInput): Promise<{ auth: Record<string, string>; vehicleId: string }> {
  const s = await signIn(h);
  const auth = bearer(s.accessToken);
  for (const k of ['TERMS', 'PRIVACY', 'DRIVER_PARTNER_AGREEMENT', 'BIOMETRIC_KYC_NOTICE'] as const) {
    const d = currentDocument(k, 'en', new Date());
    if (!d) throw new Error(k);
    const res = await h.inject(
      post('/v1/account/consents', { policyKey: k, version: d.version, locale: 'en', contentSha256: d.contentSha256, action: 'ACCEPTED' }, auth),
    );
    expect(res.statusCode, res.body).toBe(201);
  }
  expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true }, auth))).statusCode).toBe(201);
  const created = await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['CAR'] }, auth));
  expect(created.statusCode, created.body).toBe(201);
  const app = DriverApplicationSchema.parse(created.json());
  const added = await h.inject(
    post(
      `/v1/driver-onboarding/applications/${app.id}/vehicles`,
      {
        plate: `SYN-RDY-${randomUUID().slice(0, 6)}`,
        make: 'Suzuki',
        model: 'Synthetic',
        colour: 'Grey',
        serviceCategory: 'CAR',
        ownershipType: 'REGISTERED_OWNER',
        ...vehicle,
      },
      auth,
    ),
  );
  expect(added.statusCode, added.body).toBe(201);
  const vehicleId = added.json<{ vehicleId: string }>().vehicleId;
  const accountId = AccountStateSchema.parse((await h.inject({ method: 'GET', url: '/v1/account/state', headers: auth })).json()).account.id;
  const profileId = randomUUID();
  const c = h.runtime.cipher;
  await h.owner.query(
    `update compliance.driver_applications set state = 'VERIFIED', requirement_set_id = '00000000-0000-7000-8000-00000000c0a0', submitted_at = now() where id = $1`,
    [app.id],
  );
  await h.owner.query(
    `insert into compliance.driver_profiles (id, account_id, application_id, state, verified_legal_name_envelope, verified_date_of_birth_envelope) values ($1, $2, $3, 'VERIFIED', $4, $5)`,
    [
      profileId,
      accountId,
      app.id,
      c.encrypt('identity_numbers', 'Synthetic Driver', fieldContext(ENCRYPTED_FIELDS.profileLegalName, profileId)),
      c.encrypt('identity_dates', '1990-01-01', fieldContext(ENCRYPTED_FIELDS.profileDob, profileId)),
    ],
  );
  return { auth, vehicleId };
}

async function compliance(auth: Record<string, string>): Promise<DriverCompliance> {
  const res = await h.inject({ method: 'GET', url: '/v1/driver/compliance', headers: auth });
  expect(res.statusCode, res.body).toBe(200);
  return DriverComplianceSchema.parse(res.json());
}
const byProduct = (c: DriverCompliance, vehicleId: string) =>
  Object.fromEntries((c.productEligibility ?? []).filter((p) => p.vehicleId === vehicleId).map((p) => [p.productCode, p]));

describe('GET /v1/driver/compliance — productEligibility (P3.8, display only)', () => {
  it('approved driver with a CAR: ECONOMY per the synthetic rule; COMFORT (CONFIGURED), BIKE and RICKSHAW (legal gate) NOT_OFFERED', async () => {
    const d = await approvedDriver({ modelYear: karachiYear() - 6 });
    const c = await compliance(d.auth);
    const p = byProduct(c, d.vehicleId);
    expect(Object.keys(p).sort()).toEqual(['BIKE', 'COMFORT', 'ECONOMY', 'RICKSHAW']);
    expect(p['ECONOMY']).toEqual({
      vehicleId: d.vehicleId,
      productCode: 'ECONOMY',
      result: 'ELIGIBLE',
      reasons: [],
      missingAttributes: [],
      ruleVersion: ruleVersion.ECONOMY,
    });
    expect(p['COMFORT']).toMatchObject({ result: 'NOT_OFFERED', reasons: ['NOT_ENABLED_IN_CITY'], missingAttributes: [], ruleVersion: null });
    for (const code of ['BIKE', 'RICKSHAW'])
      expect(p[code]).toMatchObject({ result: 'NOT_OFFERED', reasons: ['DISABLED_LEGAL_GATE'], missingAttributes: [], ruleVersion: null });
    // display only: the product result never grants earning eligibility (no capability, placeholder set, …)
    expect(c.eligibility).toEqual([expect.objectContaining({ vehicleId: d.vehicleId, eligible: false })]);
    expect(c.eligibility[0]?.blockers.map((b) => b.code)).toContain('CAPABILITY_NOT_GRANTED');
  });

  it('once COMFORT is ENABLED: a vehicle without seats/body/AC claims is UNKNOWN with exactly the attributes the rule needs', async () => {
    // system-seeded synthetic enablement in this throwaway database (the seed's own path for ECONOMY)
    await h.owner.query(
      `update catalog.city_service_products set status = 'ENABLED', pending_transition = null, legal_basis_ref = $1, is_synthetic = true, reason_code = 'SYNTHETIC_SEED', updated_at = now()
        where city_code = 'LHR' and product_code = 'COMFORT'`,
      [S.legalBasisRef],
    );
    const d = await approvedDriver({ modelYear: karachiYear() - 3 });
    const p = byProduct(await compliance(d.auth), d.vehicleId);
    expect(p['COMFORT']).toEqual({
      vehicleId: d.vehicleId,
      productCode: 'COMFORT',
      result: 'UNKNOWN',
      reasons: [],
      missingAttributes: ['seats', 'airConditioned', 'bodyType'],
      ruleVersion: ruleVersion.COMFORT,
    });
    // ECONOMY needs no claim: still decided
    expect(p['ECONOMY']).toMatchObject({ result: 'ELIGIBLE', missingAttributes: [] });
  });

  it('claims decide COMFORT: matching claims ⇒ ELIGIBLE; an old, small, non-AC hatchback ⇒ NOT_ELIGIBLE with every failing reason', async () => {
    const good = await approvedDriver({ modelYear: karachiYear() - 3, seats: 4, bodyType: 'SEDAN', airConditioned: true });
    expect(byProduct(await compliance(good.auth), good.vehicleId)['COMFORT']).toMatchObject({
      result: 'ELIGIBLE',
      reasons: [],
      ruleVersion: ruleVersion.COMFORT,
    });
    const old = await approvedDriver({ modelYear: karachiYear() - 16, seats: 2, bodyType: 'HATCHBACK', airConditioned: false });
    const p = byProduct(await compliance(old.auth), old.vehicleId);
    expect(p['COMFORT']).toMatchObject({
      result: 'NOT_ELIGIBLE',
      reasons: ['VEHICLE_TOO_OLD', 'SEATS_BELOW_MINIMUM', 'AC_REQUIRED', 'BODY_TYPE_NOT_ALLOWED'],
      missingAttributes: [],
    });
    expect(p['ECONOMY']).toMatchObject({ result: 'NOT_ELIGIBLE', reasons: ['VEHICLE_TOO_OLD'], ruleVersion: ruleVersion.ECONOMY });
    expect(p['BIKE']).toMatchObject({ result: 'NOT_OFFERED', reasons: ['DISABLED_LEGAL_GATE'] });
  });

  it('no driver profile ⇒ 404 (nothing is computed for a rider-only account)', async () => {
    const s = await signIn(h);
    expect((await h.inject({ method: 'GET', url: '/v1/driver/compliance', headers: bearer(s.accessToken) })).statusCode).toBe(404);
  });
});
