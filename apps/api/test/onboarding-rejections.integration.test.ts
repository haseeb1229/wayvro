/**
 * P2.5 onboarding rejection paths against real PostgreSQL/Valkey as the restricted API role (D04, K06, R02–R06,
 * SEC-IDOR): every malformed, foreign or out-of-state request is refused with a stable code and changes nothing —
 * unknown/foreign ids answer 404, malformed claims 400, stale versions and closed states 409. Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { DriverApplicationSchema, VehicleCreatedSchema } from '@wayvro/contracts';
import { currentDocument } from '@wayvro/legal-content';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_ENV } from './staff-helpers.js';
import { bearer, post, signIn, startApi, type Harness, type SignedIn } from './support.js';

let h: Harness;
beforeAll(async () => {
  h = await startApi({ env: STAFF_ENV });
}, 60_000);
afterAll(async () => {
  await h.close();
});

const errorCode = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error?.code;
async function readyConsumer(): Promise<SignedIn> {
  const s = await signIn(h);
  for (const k of ['TERMS', 'PRIVACY', 'DRIVER_PARTNER_AGREEMENT', 'BIOMETRIC_KYC_NOTICE'] as const) {
    const d = currentDocument(k, 'en', new Date());
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
  expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true }, bearer(s.accessToken)))).statusCode).toBe(201);
  return s;
}
const get = (url: string, s: SignedIn) => h.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
const vehicle = (plate: string) => ({
  plate,
  make: 'Synthetic',
  model: 'Test',
  modelYear: 2020,
  colour: 'White',
  serviceCategory: 'CAR',
  ownershipType: 'REGISTERED_OWNER',
});

describe('onboarding rejection paths (SEC-IDOR, D04)', () => {
  it('reads without an application or driver profile are 404, never another account’s data', async () => {
    const s = await readyConsumer();
    expect(errorCode(await get('/v1/driver-onboarding/applications/current', s))).toBe('WAYVRO_E_NOT_FOUND');
    expect(errorCode(await get(`/v1/driver-onboarding/applications/${randomUUID()}/requirements`, s))).toBe('WAYVRO_E_NOT_FOUND');
    expect(errorCode(await get('/v1/driver/compliance', s))).toBe('WAYVRO_E_NOT_FOUND');
  });

  it('every mutation on an unknown or foreign application id is 404', async () => {
    const owner = await readyConsumer();
    const other = await readyConsumer();
    const app = DriverApplicationSchema.parse(
      (await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['CAR'] }, bearer(owner.accessToken)))).json(),
    );
    for (const id of [app.id, randomUUID()]) {
      const base = `/v1/driver-onboarding/applications/${id}`;
      const t = bearer(other.accessToken);
      expect(errorCode(await h.inject(post(`${base}/claims`, { expectedVersion: 1, legalName: 'Synthetic Other' }, t)))).toBe('WAYVRO_E_NOT_FOUND');
      expect(errorCode(await h.inject(post(`${base}/consent`, {}, t)))).toBe('WAYVRO_E_NOT_FOUND');
      expect(errorCode(await h.inject(post(`${base}/vehicles`, vehicle('LEZ-01-0001'), t)))).toBe('WAYVRO_E_NOT_FOUND');
      expect(errorCode(await h.inject(post(`${base}/vehicles/${randomUUID()}`, { expectedVersion: 1, colour: 'Red' }, t)))).toBe('WAYVRO_E_NOT_FOUND');
      expect(errorCode(await h.inject(post(`${base}/documents`, { documentType: 'SELFIE' }, t)))).toBe('WAYVRO_E_NOT_FOUND');
      expect(errorCode(await h.inject(post(`${base}/withdrawal`, {}, t)))).toBe('WAYVRO_E_NOT_FOUND');
      expect(errorCode(await get(`${base}/requirements`, other))).toBe('WAYVRO_E_NOT_FOUND');
    }
  });

  it('malformed claims, vehicles and document claims are 400 and leave the application unchanged', async () => {
    const s = await readyConsumer();
    const t = bearer(s.accessToken);
    const app = DriverApplicationSchema.parse(
      (await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['CAR'] }, t))).json(),
    );
    const base = `/v1/driver-onboarding/applications/${app.id}`;
    // claims: CNIC digits, impossible/future birth dates, a category that is not enabled
    expect(errorCode(await h.inject(post(`${base}/claims`, { expectedVersion: app.version, cnic: '35202-12345-1' }, t)))).toBe('WAYVRO_E_VALIDATION');
    expect(errorCode(await h.inject(post(`${base}/claims`, { expectedVersion: app.version, dateOfBirth: '1990-02-30' }, t)))).toBe('WAYVRO_E_VALIDATION');
    expect(errorCode(await h.inject(post(`${base}/claims`, { expectedVersion: app.version, dateOfBirth: '2999-01-01' }, t)))).toBe('WAYVRO_E_VALIDATION');
    expect(errorCode(await h.inject(post(`${base}/claims`, { expectedVersion: app.version, serviceCategories: ['BIKE'] }, t)))).toBe('WAYVRO_E_VALIDATION');
    // vehicles: a plate with no alphanumerics left, a disabled category
    expect(errorCode(await h.inject(post(`${base}/vehicles`, vehicle('--'), t)))).toBe('WAYVRO_E_VALIDATION');
    expect(errorCode(await h.inject(post(`${base}/vehicles`, { ...vehicle('LEZ-02-0002'), serviceCategory: 'BIKE' }, t)))).toBe('WAYVRO_E_VALIDATION');
    // document claims: unknown type, subject/vehicle mismatch, district on a non-district type, unknown district,
    // a number or expiry on a type without one, a number with no alphanumerics, a vehicle that is not affiliated
    const doc = (body: Record<string, unknown>) => h.inject(post(`${base}/documents`, body, t));
    expect(errorCode(await doc({ documentType: 'NOT_A_TYPE' }))).toBe('WAYVRO_E_VALIDATION');
    expect(errorCode(await doc({ documentType: 'VEHICLE_REGISTRATION' }))).toBe('WAYVRO_E_VALIDATION');
    expect(errorCode(await doc({ documentType: 'CNIC', districtCode: 'LHR-LAHORE' }))).toBe('WAYVRO_E_VALIDATION');
    expect(errorCode(await doc({ documentType: 'SELFIE', number: 'AB1234' }))).toBe('WAYVRO_E_VALIDATION');
    expect(errorCode(await doc({ documentType: 'VEHICLE_REGISTRATION', vehicleId: randomUUID() }))).toBe('WAYVRO_E_NOT_FOUND');
    const v = VehicleCreatedSchema.parse((await h.inject(post(`${base}/vehicles`, vehicle('LEZ-03-0003'), t))).json());
    expect(errorCode(await doc({ documentType: 'VEHICLE_REGISTRATION', vehicleId: v.vehicleId, expiresOn: '2030-01-01' }))).toBe('WAYVRO_E_VALIDATION');
    expect(errorCode(await doc({ documentType: 'ROUTE_PERMIT', vehicleId: v.vehicleId, districtCode: 'LHR-NOWHERE' }))).toBe('WAYVRO_E_VALIDATION');
    expect(errorCode(await doc({ documentType: 'DRIVING_LICENCE', number: '-/' }))).toBe('WAYVRO_E_VALIDATION');
    const fresh = DriverApplicationSchema.parse((await get('/v1/driver-onboarding/applications/current', s)).json());
    expect(fresh).toMatchObject({ version: app.version, documents: [], claims: { legalNameProvided: false, cnicLast4: null, dateOfBirthProvided: false } });
  });

  it('stale versions and closed states are 409: consent twice, vehicle edits, a second affiliation, after withdrawal', async () => {
    const s = await readyConsumer();
    const t = bearer(s.accessToken);
    const app = DriverApplicationSchema.parse(
      (await h.inject(post('/v1/driver-onboarding/applications', { cityCode: 'LHR', serviceCategories: ['CAR'] }, t))).json(),
    );
    const base = `/v1/driver-onboarding/applications/${app.id}`;
    expect((await h.inject(post(`${base}/consent`, {}, t))).statusCode).toBe(200);
    expect(errorCode(await h.inject(post(`${base}/consent`, {}, t)))).toBe('WAYVRO_E_CONFLICT');
    const v = VehicleCreatedSchema.parse((await h.inject(post(`${base}/vehicles`, vehicle('LEZ-04-0004'), t))).json());
    // the same plate again on the same application: one affiliation per application and vehicle
    expect(errorCode(await h.inject(post(`${base}/vehicles`, vehicle('LEZ 04 0004'), t)))).toBe('WAYVRO_E_CONFLICT');
    expect(errorCode(await h.inject(post(`${base}/vehicles/${v.vehicleId}`, { expectedVersion: 99, colour: 'Red' }, t)))).toBe('WAYVRO_E_CONFLICT');
    expect((await h.inject(post(`${base}/vehicles/${v.vehicleId}`, { expectedVersion: 1, colour: 'Red' }, t))).statusCode).toBe(200);
    expect((await h.inject(post(`${base}/withdrawal`, {}, t))).statusCode).toBe(200);
    expect(errorCode(await h.inject(post(`${base}/withdrawal`, {}, t)))).toBe('WAYVRO_E_CONFLICT');
    expect(errorCode(await h.inject(post(`${base}/claims`, { expectedVersion: app.version + 2, legalName: 'Synthetic Late' }, t)))).toBe('WAYVRO_E_CONFLICT');
    expect(errorCode(await h.inject(post(`${base}/vehicles`, vehicle('LEZ-05-0005'), t)))).toBe('WAYVRO_E_CONFLICT');
    expect(errorCode(await h.inject(post(`${base}/documents`, { documentType: 'SELFIE' }, t)))).toBe('WAYVRO_E_CONFLICT');
  });
});
