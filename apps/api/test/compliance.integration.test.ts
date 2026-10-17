/**
 * P2.5 against real PostgreSQL/Valkey as the restricted API role: onboarding gates (policies, age declaration,
 * account restriction), one open application per account, encrypted claims with masked views, duplicate SIGNALS
 * (CNIC, plate, document number — never rejections), vehicles and document claims, withdrawal, requirement checklist
 * (placeholder labelled), SEC-IDOR/SEC-MA, and V13 restrictions: ACCOUNT blocks consumer routes but keeps the
 * restricted-session set, DRIVER_ROLE never affects rider use, KYC seniors only apply compliance reasons, ACCOUNT scope
 * is T&S-only, SAFETY/FRAUD lifts need a different approver. Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { AccountStateSchema, DriverApplicationSchema, DriverComplianceSchema, RequirementChecklistSchema } from '@wayvro/contracts';
import { ENCRYPTED_FIELDS, fieldContext } from '@wayvro/identity-core';
import { currentDocument } from '@wayvro/legal-content';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, post, signIn, startApi, type Harness, type SignedIn } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let admins: Staff[];
beforeAll(async () => {
  h = await startApi({ env: STAFF_ENV });
  kit = staffKit(h);
  admins = await kit.bootstrapAdmins(2);
}, 60_000);
afterAll(async () => {
  await h.close();
});

const code = (res: { json: () => unknown }) => (res.json() as { error?: { code: string; details?: Record<string, unknown> } }).error;
const accept = async (s: SignedIn, keys: string[]) => {
  for (const k of keys) {
    const d = currentDocument(k as 'TERMS', 'en', new Date());
    if (!d) throw new Error(k);
    const res = await h.inject(
      post(
        '/v1/account/consents',
        { policyKey: k, version: d.version, locale: 'en', contentSha256: d.contentSha256, action: 'ACCEPTED' },
        bearer(s.accessToken),
      ),
    );
    expect(res.statusCode, res.body).toBe(201);
  }
};
/** A consumer who completed account policies + age declaration (and optionally the driver policies). */
async function readyConsumer(driverPolicies = true): Promise<SignedIn> {
  const s = await signIn(h);
  await accept(s, ['TERMS', 'PRIVACY', ...(driverPolicies ? ['DRIVER_PARTNER_AGREEMENT', 'BIOMETRIC_KYC_NOTICE'] : [])]);
  expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true }, bearer(s.accessToken)))).statusCode).toBe(201);
  return s;
}
const createApp = async (s: SignedIn) => {
  const res = await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['CAR'] }, bearer(s.accessToken)));
  expect(res.statusCode, res.body).toBe(201);
  return DriverApplicationSchema.parse(res.json());
};

describe('onboarding gates and the application lifecycle (D04/K14/V03)', () => {
  it('policies, then the age declaration, then one open application per account; disabled categories refused', async () => {
    const s = await signIn(h);
    const body = { cityCode: 'LHR', serviceCategories: ['CAR'] };
    expect(code(await h.inject(post('/v1/driver-onboarding/applications', body, bearer(s.accessToken))))?.code).toBe('WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED');
    await accept(s, ['TERMS', 'PRIVACY']);
    const age = code(await h.inject(post('/v1/driver-onboarding/applications', body, bearer(s.accessToken))));
    expect(age).toMatchObject({ code: 'WAYVRO_E_AGE_DECLARATION_REQUIRED', details: { requiredActions: ['AGE_DECLARATION'] } });
    await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true }, bearer(s.accessToken)));
    expect(
      (await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['BIKE'] }, bearer(s.accessToken)))).statusCode,
    ).toBe(400);
    const app = await createApp(s);
    expect(app).toMatchObject({ state: 'DRAFT', serviceCategories: ['CAR'], pendingPolicies: ['BIOMETRIC_KYC_NOTICE', 'DRIVER_PARTNER_AGREEMENT'].sort() });
    expect(code(await h.inject(post('/v1/driver-onboarding/applications', body, bearer(s.accessToken))))?.code).toBe('WAYVRO_E_CONFLICT');
    // driver consent: refused until both driver policies are accepted (K14), then DRAFT -> CONSENTED
    const early = code(await h.inject(post(`/v1/driver-onboarding/applications/${app.id}/consent`, {}, bearer(s.accessToken))));
    expect(early?.code).toBe('WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED');
    await accept(s, ['DRIVER_PARTNER_AGREEMENT', 'BIOMETRIC_KYC_NOTICE']);
    const consented = await h.inject(post(`/v1/driver-onboarding/applications/${app.id}/consent`, {}, bearer(s.accessToken)));
    expect(DriverApplicationSchema.parse(consented.json())).toMatchObject({ state: 'CONSENTED', pendingPolicies: [] });
    // rider use is unaffected: account state still has no restriction and shows the application
    const state = AccountStateSchema.parse((await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(s.accessToken) })).json());
    expect(state.driver).toMatchObject({ application: { id: app.id, state: 'CONSENTED' }, profile: null, onboardingAvailable: true });
    // withdraw, then a new application is possible
    expect(
      DriverApplicationSchema.parse((await h.inject(post(`/v1/driver-onboarding/applications/${app.id}/withdrawal`, {}, bearer(s.accessToken)))).json()).state,
    ).toBe('WITHDRAWN');
    expect((await createApp(s)).state).toBe('DRAFT');
  });

  it('claims are encrypted, masked in views, versioned (stale = 409) and CNIC matches across accounts become signals', async () => {
    const a = await readyConsumer();
    const b = await readyConsumer();
    const appA = await createApp(a);
    const appB = await createApp(b);
    const res = await h.inject(
      post(
        `/v1/driver-onboarding/applications/${appA.id}/claims`,
        { expectedVersion: appA.version, legalName: 'Synthetic Person A', cnic: '35202-1234567-1', dateOfBirth: '1990-01-01' },
        bearer(a.accessToken),
      ),
    );
    const view = DriverApplicationSchema.parse(res.json());
    expect(view.claims).toEqual({ legalNameProvided: true, cnicLast4: '5671', dateOfBirthProvided: true });
    expect(res.body).not.toContain('1234567');
    expect(
      (await h.inject(post(`/v1/driver-onboarding/applications/${appA.id}/claims`, { expectedVersion: appA.version, legalName: 'X Y' }, bearer(a.accessToken))))
        .statusCode,
    ).toBe(409);
    const row = (await h.owner.query<{ cnic_envelope: Buffer }>(`select cnic_envelope from compliance.driver_applications where id = $1`, [appA.id])).rows[0];
    expect(row?.cnic_envelope.toString('latin1')).not.toContain('1234567');
    expect(
      h.runtime.cipher.decryptString('identity_numbers', row?.cnic_envelope ?? Buffer.alloc(0), fieldContext(ENCRYPTED_FIELDS.applicationCnic, appA.id)),
    ).toBe('35202-1234567-1');
    // the same CNIC on another account: a duplicate SIGNAL, never a rejection or merge
    const dup = await h.inject(
      post(`/v1/driver-onboarding/applications/${appB.id}/claims`, { expectedVersion: appB.version, cnic: '3520212345671' }, bearer(b.accessToken)),
    );
    expect(dup.statusCode).toBe(200);
    const signals = await h.owner.query(
      `select 1 from compliance.duplicate_signals where signal = 'CNIC_HASH_MATCH' and subject_application_id = $1 and matched_application_id = $2`,
      [appB.id, appA.id],
    );
    expect(signals.rowCount).toBe(1);
    expect(h.logs.text()).not.toContain('1234567');
    expect(
      (await h.inject(post(`/v1/driver-onboarding/applications/${appB.id}/claims`, { expectedVersion: 99, cnic: '123' }, bearer(b.accessToken)))).statusCode,
    ).toBe(400);
  });

  it('vehicle attribute claims (Phase 3, DM-OPEN-02): optional seats/body type/AC are stored, echoed and updatable; closed lists enforced', async () => {
    const s = await readyConsumer();
    const app = await createApp(s);
    const base = { make: 'Suzuki', model: 'Cultus', modelYear: 2021, colour: 'Grey', serviceCategory: 'CAR', ownershipType: 'REGISTERED_OWNER' };
    const claimed = await h.inject(
      post(
        `/v1/driver-onboarding/applications/${app.id}/vehicles`,
        { ...base, plate: 'SYN-CLM-1', seats: 4, bodyType: 'HATCHBACK', airConditioned: true },
        bearer(s.accessToken),
      ),
    );
    expect(claimed.statusCode, claimed.body).toBe(201);
    const plain = await h.inject(post(`/v1/driver-onboarding/applications/${app.id}/vehicles`, { ...base, plate: 'SYN-CLM-2' }, bearer(s.accessToken)));
    expect(plain.statusCode, plain.body).toBe(201);
    expect(
      (
        await h.inject(
          post(`/v1/driver-onboarding/applications/${app.id}/vehicles`, { ...base, plate: 'SYN-CLM-3', bodyType: 'LIMOUSINE' }, bearer(s.accessToken)),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await h.inject(post(`/v1/driver-onboarding/applications/${app.id}/vehicles`, { ...base, plate: 'SYN-CLM-4', seats: 0 }, bearer(s.accessToken))))
        .statusCode,
    ).toBe(400);
    const id = claimed.json<{ vehicleId: string }>().vehicleId;
    const updated = await h.inject(
      post(`/v1/driver-onboarding/applications/${app.id}/vehicles/${id}`, { expectedVersion: 1, seats: 5, airConditioned: false }, bearer(s.accessToken)),
    );
    expect(updated.statusCode, updated.body).toBe(200);
    const view = DriverApplicationSchema.parse(updated.json());
    expect(view.vehicles.map((v) => ({ plate: v.plateDisplay, seats: v.seats, bodyType: v.bodyType, airConditioned: v.airConditioned }))).toEqual([
      { plate: 'SYN-CLM-1', seats: 5, bodyType: 'HATCHBACK', airConditioned: false },
      { plate: 'SYN-CLM-2', seats: null, bodyType: null, airConditioned: null },
    ]);
  });

  it('vehicles: a known plate becomes an affiliation + signal; only the owning application edits; documents follow subject rules', async () => {
    const a = await readyConsumer();
    const b = await readyConsumer();
    const appA = await createApp(a);
    const appB = await createApp(b);
    const v = {
      plate: 'LEA-12-3456',
      make: 'Toyota',
      model: 'Corolla',
      modelYear: 2019,
      colour: 'White',
      serviceCategory: 'CAR',
      ownershipType: 'REGISTERED_OWNER',
      registrationNumber: 'REG-998877',
    };
    const first = await h.inject(post(`/v1/driver-onboarding/applications/${appA.id}/vehicles`, v, bearer(a.accessToken)));
    expect(first.json()).toMatchObject({ relation: 'OWNER' });
    const vehicleId = first.json<{ vehicleId: string }>().vehicleId;
    const second = await h.inject(post(`/v1/driver-onboarding/applications/${appB.id}/vehicles`, { ...v, plate: 'lea 123456' }, bearer(b.accessToken)));
    expect(second.json()).toMatchObject({ relation: 'AUTHORISED_USER', vehicleId });
    expect(
      (await h.owner.query(`select 1 from compliance.duplicate_signals where signal = 'PLATE_ALREADY_AFFILIATED' and subject_application_id = $1`, [appB.id]))
        .rowCount,
    ).toBe(1);
    expect((await h.owner.query(`select 1 from compliance.vehicles where plate_normalised = 'LEA123456'`)).rowCount).toBe(1);
    // only the owning application may edit; B (authorised user) gets 404
    expect(
      (
        await h.inject(
          post(`/v1/driver-onboarding/applications/${appB.id}/vehicles/${vehicleId}`, { expectedVersion: 1, colour: 'Red' }, bearer(b.accessToken)),
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await h.inject(
          post(`/v1/driver-onboarding/applications/${appA.id}/vehicles/${vehicleId}`, { expectedVersion: 1, colour: 'Silver' }, bearer(a.accessToken)),
        )
      ).statusCode,
    ).toBe(200);
    // documents: driver doc, vehicle doc needs the vehicle, per-district permit needs a district of the city
    expect(
      (
        await h.inject(
          post(
            `/v1/driver-onboarding/applications/${appA.id}/documents`,
            { documentType: 'DRIVING_LICENCE', number: 'LHR-55443', licenceClass: 'LTV', expiresOn: '2029-01-01' },
            bearer(a.accessToken),
          ),
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await h.inject(
          post(`/v1/driver-onboarding/applications/${appA.id}/documents`, { documentType: 'VEHICLE_REGISTRATION', number: 'X1' }, bearer(a.accessToken)),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await h.inject(
          post(`/v1/driver-onboarding/applications/${appA.id}/documents`, { documentType: 'ROUTE_PERMIT', vehicleId, number: 'RP-1' }, bearer(a.accessToken)),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await h.inject(
          post(
            `/v1/driver-onboarding/applications/${appA.id}/documents`,
            { documentType: 'ROUTE_PERMIT', vehicleId, districtCode: 'LHR-LAHORE', number: 'RP-1', expiresOn: '2027-01-01' },
            bearer(a.accessToken),
          ),
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (await h.inject(post(`/v1/driver-onboarding/applications/${appA.id}/documents`, { documentType: 'NOPE_TYPE' }, bearer(a.accessToken)))).statusCode,
    ).toBe(400);
    // the same licence number on another account: DOCUMENT_NUMBER_MATCH signal
    expect(
      (
        await h.inject(
          post(
            `/v1/driver-onboarding/applications/${appB.id}/documents`,
            { documentType: 'DRIVING_LICENCE', number: 'lhr 55443', licenceClass: 'LTV' },
            bearer(b.accessToken),
          ),
        )
      ).statusCode,
    ).toBe(201);
    expect((await h.owner.query(`select 1 from compliance.duplicate_signals where signal = 'DOCUMENT_NUMBER_MATCH'`)).rowCount).toBe(1);
    const view = DriverApplicationSchema.parse(
      (await h.inject({ method: 'GET', url: '/v1/driver-onboarding/applications/current', headers: bearer(a.accessToken) })).json(),
    );
    expect(view.documents.map((d) => d.documentType).sort()).toEqual(['DRIVING_LICENCE', 'ROUTE_PERMIT']);
    expect(view.documents.find((d) => d.documentType === 'DRIVING_LICENCE')?.numberLast4).toBe('5443');
    const checklist = RequirementChecklistSchema.parse(
      (await h.inject({ method: 'GET', url: `/v1/driver-onboarding/applications/${appA.id}/requirements`, headers: bearer(a.accessToken) })).json(),
    );
    expect(checklist.isPlaceholder).toBe(true);
    expect(checklist.items.find((i) => i.documentType === 'DRIVING_LICENCE')).toMatchObject({ mandatory: true, claimed: true, licenceClassesAllowed: ['LTV'] });
    expect(checklist.items.find((i) => i.documentType === 'AUTHORISED_USE_LETTER')).toMatchObject({ applicable: false });
  });

  it('SEC-IDOR / SEC-MA: foreign or malformed ids are 404 everywhere; server-owned fields are rejected', async () => {
    const a = await readyConsumer();
    const b = await readyConsumer();
    const appA = await createApp(a);
    const other = bearer(b.accessToken);
    for (const [url, body] of [
      [`/v1/driver-onboarding/applications/${appA.id}/claims`, { expectedVersion: 1, legalName: 'Stolen Name' }],
      [`/v1/driver-onboarding/applications/${appA.id}/consent`, {}],
      [
        `/v1/driver-onboarding/applications/${appA.id}/vehicles`,
        { plate: 'ABC123', make: 'm', model: 'm', modelYear: 2020, colour: 'c', serviceCategory: 'CAR', ownershipType: 'REGISTERED_OWNER' },
      ],
      [`/v1/driver-onboarding/applications/${appA.id}/documents`, { documentType: 'CNIC' }],
      [`/v1/driver-onboarding/applications/${appA.id}/withdrawal`, {}],
      ['/v1/driver-onboarding/applications/not-a-uuid/withdrawal', {}],
    ] as const) {
      expect((await h.inject(post(url, body, other))).statusCode, url).toBe(404);
    }
    expect((await h.inject({ method: 'GET', url: `/v1/driver-onboarding/applications/${appA.id}/requirements`, headers: other })).statusCode).toBe(404);
    for (const extra of [{ state: 'VERIFIED' }, { accountId: randomUUID() }, { cnicVerified: true }]) {
      expect(
        (await h.inject(post(`/v1/driver-onboarding/applications/${appA.id}/claims`, { expectedVersion: 1, ...extra }, bearer(a.accessToken)))).statusCode,
      ).toBe(400);
    }
    expect(
      (await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['CAR'], state: 'VERIFIED' }, other))).statusCode,
    ).toBe(400);
    expect((await h.inject({ method: 'GET', url: '/v1/driver/compliance', headers: other })).statusCode).toBe(404);
  });
});

describe('restrictions (V13) — staff creation rules, restricted sessions, maker-checker lifts', () => {
  it('ACCOUNT restriction: T&S only, blocks onboarding and profile edits, keeps the restricted-session routes; SAFETY lift needs a second agent', async () => {
    const senior = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Senior One');
    const ts1 = await kit.staffWithRole(admins, 'TRUST_SAFETY_AGENT', 'TS One');
    const ts2 = await kit.staffWithRole(admins, 'TRUST_SAFETY_AGENT', 'TS Two');
    const s = await readyConsumer();
    const accountId = AccountStateSchema.parse((await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(s.accessToken) })).json()).account.id;
    const body = { scope: 'ACCOUNT', accountId, reasonCode: 'SAFETY_INVESTIGATION', reasonClass: 'SAFETY', appealable: true };
    expect((await kit.privileged(senior, '/v1/admin/restrictions', body)).statusCode).toBe(403);
    expect((await kit.privileged(senior, '/v1/admin/restrictions', { ...body, reasonClass: 'COMPLIANCE' })).statusCode).toBe(403);
    const created = await kit.privileged(ts1, '/v1/admin/restrictions', body);
    expect(created.statusCode, created.body).toBe(201);
    const restrictionId = created.json<{ id: string }>().id;
    // consumer view: restricted session
    const auth = bearer(s.accessToken);
    const blocked = code(await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['CAR'] }, auth)));
    expect(blocked).toMatchObject({ code: 'WAYVRO_E_ACCOUNT_RESTRICTED', details: { reasonCodes: ['SAFETY_INVESTIGATION'] } });
    expect(
      (
        await h.inject({
          method: 'PATCH',
          url: '/v1/account/profile',
          payload: { displayName: 'X' },
          headers: { ...auth, 'idempotency-key': `idem-${randomUUID()}` },
        })
      ).statusCode,
    ).toBe(403);
    const state = AccountStateSchema.parse((await h.inject({ method: 'GET', url: '/v1/account/state', headers: auth })).json());
    expect(state.restrictions).toEqual([
      expect.objectContaining({ id: restrictionId, scope: 'ACCOUNT', reasonCode: 'SAFETY_INVESTIGATION', affectsRiderUse: true, appealable: true }),
    ]);
    for (const url of ['/v1/account/sessions', '/v1/account/security-events', '/v1/account/consents'])
      expect((await h.inject({ method: 'GET', url, headers: auth })).statusCode, url).toBe(200);
    // SAFETY lift: pending until a DIFFERENT T&S agent approves
    const lift = await kit.privileged(ts1, `/v1/admin/restrictions/${restrictionId}/lift`, { reasonCode: 'INVESTIGATION_CLOSED' });
    expect(lift.json<{ status: string }>().status).toBe('LIFT_PENDING_APPROVAL');
    expect((await kit.privileged(ts1, `/v1/admin/restrictions/${restrictionId}/lift-approval`, { decision: 'APPROVE' })).statusCode).toBe(403);
    // still restricted while pending
    expect((await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['CAR'] }, auth))).statusCode).toBe(403);
    const approved = await kit.privileged(ts2, `/v1/admin/restrictions/${restrictionId}/lift-approval`, { decision: 'APPROVE' });
    expect(approved.json<{ status: string }>().status).toBe('LIFTED');
    expect((await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['CAR'] }, auth))).statusCode).toBe(201);
    const events = await h.owner.query<{ event: string }>(`select event from profile.restriction_events where restriction_id = $1 order by at`, [
      restrictionId,
    ]);
    expect(events.rows.map((e) => e.event)).toEqual(['CREATED', 'LIFT_REQUESTED', 'LIFTED']);
    const listed = await h.inject({ method: 'GET', url: `/v1/admin/restrictions?accountId=${accountId}`, headers: kit.sb(ts2) });
    expect(listed.json<{ restrictions: unknown[] }>().restrictions).toHaveLength(1);
    expect((await h.inject({ method: 'GET', url: '/v1/admin/restrictions', headers: kit.sb(ts2) })).statusCode).toBe(400);
  });

  it('DRIVER_ROLE restriction (incl. RISK_HOLD) blocks earning only — rider routes and state stay normal (V13/INV-09)', async () => {
    const senior = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Senior Two');
    const s = await readyConsumer();
    const app = await createApp(s);
    const accountId = AccountStateSchema.parse((await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(s.accessToken) })).json()).account.id;
    // A driver profile normally comes from a human review decision (P2.7); here a synthetic one is inserted directly.
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
    const res = await kit.privileged(senior, '/v1/admin/restrictions', {
      scope: 'DRIVER_ROLE',
      driverProfileId: profileId,
      reasonCode: 'DOCUMENT_QUALITY',
      reasonClass: 'QUALITY',
      appealable: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    const auth = bearer(s.accessToken);
    const state = AccountStateSchema.parse((await h.inject({ method: 'GET', url: '/v1/account/state', headers: auth })).json());
    expect(state.driver.profile).toEqual({ id: profileId, state: 'VERIFIED' });
    expect(state.restrictions).toEqual([expect.objectContaining({ scope: 'DRIVER_ROLE', affectsRiderUse: false })]);
    // rider-side routes are unaffected
    expect(
      (
        await h.inject({
          method: 'PATCH',
          url: '/v1/account/profile',
          payload: { displayName: 'Still Rider' },
          headers: { ...auth, 'idempotency-key': `idem-${randomUUID()}` },
        })
      ).statusCode,
    ).toBe(200);
    const compliance = DriverComplianceSchema.parse((await h.inject({ method: 'GET', url: '/v1/driver/compliance', headers: auth })).json());
    expect(compliance.restrictions).toHaveLength(1);
    // RISK_HOLD is system-only (staff contract refuses it; the database refuses staff-created holds)
    expect(
      (
        await kit.privileged(senior, '/v1/admin/restrictions', {
          scope: 'DRIVER_ROLE',
          driverProfileId: profileId,
          reasonCode: 'X_HOLD',
          reasonClass: 'RISK_HOLD',
          appealable: true,
        })
      ).statusCode,
    ).toBe(400);
    await expect(
      h.owner.query(
        `insert into profile.restrictions (id, scope, driver_profile_id, reason_code, reason_class, status, appealable, created_by_staff_id) values ($1, 'DRIVER_ROLE', $2, 'X_HOLD', 'RISK_HOLD', 'ACTIVE', true, $3)`,
        [randomUUID(), profileId, senior.staffId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    // a vehicle-less profile shows the blockers live (no capability yet)
    expect(compliance.eligibility).toEqual([]);
  });
});
