/*
 * SP-08 account fixtures A–G (+ APPLICANT) for the mobile E2E stack (docs/phase3/PHASE3_SP08_CROSS_MODE_E2E.md §4).
 * SYNTHETIC data only, written into the throwaway database of tests/e2e-mobile/mobile-stack.mjs.
 *
 * No fixture endpoint, no new route, no in-app bypass. Each account is created exactly the way a real user creates one:
 * the public OTP sign-in (POST /v1/auth/otp-challenges, the code read from the local-runner-only /__local/otp-inbox,
 * POST /v1/auth/sessions), then the public consent + age-declaration endpoints. The Driver/Partner states the app
 * cannot reach on its own (a reviewer's approval, an expired document, staff restrictions) are written with SQL in the
 * shapes the review service and the worker write them (apps/api/src/review/review.service.ts approve path;
 * apps/api/test/renewal.integration.test.ts expiry simulation), exactly as the web-ops E2E seeds do.
 *
 * Simplification (recorded in tests/e2e-mobile/README.md): approved drivers carry no service_capabilities rows — a grant
 * must reference a staff review decision (granted_by_decision_id), whose staff-session/WebAuthn chain the mobile stack
 * does not create. Phase-3 Driver/Partner screens read the profile, documents and restrictions only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';

const fileUrl = (root, path) => new URL(`file://${join(root, path).replaceAll('\\', '/')}`).href;
const DEVICE = { platform: 'ANDROID', appVersion: '0.0.0' };
const RIDER_POLICIES = ['TERMS', 'PRIVACY'];
const DRIVER_POLICIES = ['DRIVER_PARTNER_AGREEMENT', 'BIOMETRIC_KYC_NOTICE'];
const REQUIREMENT_SET = '00000000-0000-7000-8000-00000000c0a0';
const CREATOR = 'e2e-mobile-seed';

/** +92 399 XXXXXXX (synthetic, never delivered; the recording sink keeps it in memory). */
export function syntheticPhone(used) {
  for (;;) {
    const phone = `+92399${String(randomBytes(4).readUInt32BE(0) % 10_000_000).padStart(7, '0')}`;
    if (!used.has(phone)) {
      used.add(phone);
      return phone;
    }
  }
}

/** The local form a person types into the app (0399…); the app normalises it like any other number. */
export const localForm = (e164) => `0${e164.slice(3)}`;

function api(baseUrl) {
  const call = async (method, path, body, token) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, json: text === '' ? null : JSON.parse(text) };
  };
  return { post: (path, body, token) => call('POST', path, body, token), get: (path, token) => call('GET', path, undefined, token) };
}

/** Newest OTP for `phone` recorded after `since` (the recording sink is fed by the in-process otp.deliver job). */
async function codeFor(baseUrl, phone, since) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const res = await fetch(`${baseUrl}/__local/otp-inbox?phone=${encodeURIComponent(phone)}`);
    if (res.ok) {
      const { messages } = await res.json();
      const fresh = messages.filter((m) => Date.parse(m.recordedAt) >= since).sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
      const code = /\b(\d{6})\b/.exec(fresh[0]?.message ?? '')?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('seed: no OTP was recorded for a seeded phone within 10 s');
}

async function signUp(baseUrl, phone) {
  const http = api(baseUrl);
  const installationId = `inst-e2e-seed-${randomBytes(8).toString('hex')}`;
  const since = Date.now() - 1000;
  const challenge = await http.post('/v1/auth/otp-challenges', { phone, purpose: 'SIGN_IN', installationId, locale: 'en' });
  if (challenge.status !== 202) throw new Error(`seed: OTP challenge failed with ${String(challenge.status)}`);
  const code = await codeFor(baseUrl, phone, since);
  const session = await http.post('/v1/auth/sessions', { challengeId: challenge.json.challengeId, code, installationId, device: DEVICE });
  if (session.status !== 201) throw new Error(`seed: sign-in failed with ${String(session.status)}`);
  return session.json.accessToken;
}

async function acceptPolicies(root, baseUrl, token, keys) {
  const { currentDocument } = await import(fileUrl(root, 'packages/legal-content/dist/index.js'));
  const http = api(baseUrl);
  for (const policyKey of keys) {
    const d = currentDocument(policyKey, 'en', new Date());
    if (!d) throw new Error(`seed: no current ${policyKey} document`);
    const r = await http.post(
      '/v1/account/consents',
      { policyKey, version: d.version, locale: 'en', contentSha256: d.contentSha256, action: 'ACCEPTED' },
      token,
    );
    if (r.status >= 300) throw new Error(`seed: consent ${policyKey} failed with ${String(r.status)}`);
  }
  const age = await http.post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true }, token);
  if (age.status >= 300) throw new Error(`seed: age declaration failed with ${String(age.status)}`);
  const me = await http.get('/v1/account/state', token);
  if (me.status !== 200 || me.json.requiredActions.length !== 0)
    throw new Error(`seed: account still has required actions (${JSON.stringify(me.json?.requiredActions)})`);
  return me.json.account.id;
}

/** Driver/Partner rows for one account, in the shapes the review service's approve path writes. */
async function driverRows(client, cipher, fields, accountId, shape) {
  const { ENCRYPTED_FIELDS, fieldContext } = fields;
  const enc = (spec, value, rowId) => cipher.encrypt(spec.keyClass, value, fieldContext(spec, rowId));
  const appId = randomUUID();
  const verified = shape.application === 'VERIFIED';
  await client.query(
    `insert into compliance.driver_applications (id, account_id, state, city_code, legal_name_envelope, cnic_envelope, cnic_last4, date_of_birth_envelope,
                                                requirement_set_id, submitted_at, decided_at)
     values ($1, $2, $3, 'LHR', $4, $5, '0001', $6, $7, now() - interval '3 days', $8)`,
    [
      appId,
      accountId,
      shape.application,
      enc(ENCRYPTED_FIELDS.applicationLegalName, 'Synthetic E2E Driver', appId),
      enc(ENCRYPTED_FIELDS.applicationCnic, '35202-0000000-1', appId),
      enc(ENCRYPTED_FIELDS.applicationDob, '1990-05-17', appId),
      REQUIREMENT_SET,
      verified ? new Date(Date.now() - 2 * 86_400_000) : null,
    ],
  );
  await client.query(`insert into compliance.application_service_categories (application_id, service_category) values ($1, 'CAR')`, [appId]);
  const vehicleId = randomUUID();
  const plate = `E2E${randomBytes(3).toString('hex').toUpperCase()}`;
  await client.query(
    `insert into compliance.vehicles (id, plate_normalised, plate_display, make, model, model_year, colour, service_category, ownership_type, status, seats, body_type, air_conditioned)
     values ($1, $2, $3, 'Synthetic', 'Sedan', 2020, 'White', 'CAR', 'REGISTERED_OWNER', 'ACTIVE', 4, 'SEDAN', true)`,
    [vehicleId, plate, plate],
  );
  await client.query(`insert into compliance.vehicle_affiliations (id, vehicle_id, driver_application_id, relation, status) values ($1, $2, $3, 'OWNER', $4)`, [
    randomUUID(),
    vehicleId,
    appId,
    verified ? 'ACTIVE' : 'PENDING',
  ]);
  let profileId = null;
  if (verified) {
    profileId = randomUUID();
    await client.query(
      `insert into compliance.driver_profiles (id, account_id, application_id, state, verified_legal_name_envelope, verified_date_of_birth_envelope, activated_at)
       values ($1, $2, $3, $4, $5, $6, now() - interval '2 days')`,
      [
        profileId,
        accountId,
        appId,
        shape.profile,
        enc(ENCRYPTED_FIELDS.profileLegalName, 'Synthetic E2E Driver', profileId),
        enc(ENCRYPTED_FIELDS.profileDob, '1990-05-17', profileId),
      ],
    );
  }
  const docStatus = verified ? 'VALID' : 'SUBMITTED';
  const doc = async (type, subject, extra) => {
    const id = randomUUID();
    const number = extra.number === undefined ? null : enc(ENCRYPTED_FIELDS.documentNumber, extra.number, id);
    const expires = extra.expiresOn ?? null;
    await client.query(
      `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, vehicle_id, number_envelope, number_last4, licence_class,
                                                    claimed_issued_on, claimed_expires_on, issued_on, expires_on, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, '2022-01-01', $9, $10, $11, $12)`,
      [
        id,
        type,
        subject,
        subject === 'VEHICLE' ? null : appId,
        subject === 'DRIVER' ? null : vehicleId,
        number,
        extra.number === undefined ? null : extra.number.replaceAll(/[^0-9A-Z]/g, '').slice(-4),
        extra.licenceClass ?? null,
        expires,
        verified ? '2022-01-01' : null,
        verified ? expires : null,
        extra.status ?? docStatus,
      ],
    );
    return id;
  };
  await doc('CNIC', 'DRIVER', { number: '35202-0000000-1', expiresOn: '2031-12-31' });
  await doc('SELFIE', 'DRIVER', {});
  await doc('DRIVING_LICENCE', 'DRIVER', {
    number: `LHR-${randomBytes(3).toString('hex').toUpperCase()}`,
    licenceClass: 'LTV',
    expiresOn: shape.licenceExpired ? '2026-01-31' : '2030-06-30',
    ...(shape.licenceExpired ? { status: 'EXPIRED' } : {}),
  });
  await doc('VEHICLE_REGISTRATION', 'VEHICLE', { number: `REG-${randomBytes(3).toString('hex').toUpperCase()}` });
  if (shape.application === 'MANUAL_REVIEW') {
    await client.query(
      `insert into compliance.review_cases (id, kind, driver_application_id, city_code, status) values ($1, 'INITIAL_APPLICATION', $2, 'LHR', 'OPEN')`,
      [randomUUID(), appId],
    );
  }
  return { appId, profileId };
}

async function restriction(client, target) {
  await client.query(
    `insert into profile.restrictions (id, scope, account_id, driver_profile_id, reason_code, reason_class, status, appealable, created_by_system)
     values ($1, $2, $3, $4, $5, $6, 'ACTIVE', true, $7)`,
    [randomUUID(), target.scope, target.accountId ?? null, target.profileId ?? null, target.reasonCode, target.reasonClass, CREATOR],
  );
}

/**
 * Creates the accounts and returns { key: { phone, localPhone, accountId } }. `phones` (a Set) keeps numbers unique.
 * Shapes follow SP-08 §4: A rider-only; B approved driver; C approved driver (switching flows); D driver-role
 * restriction; E account-wide restriction with a driver profile; F application in MANUAL_REVIEW; G expired document;
 * APPLICANT rider-only (onboarding flows #18/#19, so A stays an applicant-free rider).
 */
export async function seedAccounts({ root, pool, baseUrl, keySeed }) {
  const { FieldCipher, localKeyRing } = await import(fileUrl(root, 'packages/field-crypto/dist/index.js'));
  const fields = await import(fileUrl(root, 'packages/identity-core/dist/index.js'));
  const cipher = new FieldCipher(localKeyRing(keySeed));
  const used = new Set();
  const shapes = {
    A: { driver: null },
    APPLICANT: { driver: null },
    B: { driver: { application: 'VERIFIED', profile: 'ACTIVE_ELIGIBLE' } },
    C: { driver: { application: 'VERIFIED', profile: 'ACTIVE_ELIGIBLE' } },
    D: {
      driver: { application: 'VERIFIED', profile: 'ACTIVE_ELIGIBLE' },
      restriction: { scope: 'DRIVER_ROLE', reasonCode: 'E2E_QUALITY_REVIEW', reasonClass: 'QUALITY' },
    },
    E: {
      driver: { application: 'VERIFIED', profile: 'ACTIVE_ELIGIBLE' },
      restriction: { scope: 'ACCOUNT', reasonCode: 'E2E_SAFETY_REVIEW', reasonClass: 'SAFETY' },
    },
    F: { driver: { application: 'MANUAL_REVIEW' } },
    G: { driver: { application: 'VERIFIED', profile: 'EXPIRED', licenceExpired: true } },
  };
  const out = {};
  for (const [key, shape] of Object.entries(shapes)) {
    const phone = syntheticPhone(used);
    const token = await signUp(baseUrl, phone);
    const accountId = await acceptPolicies(root, baseUrl, token, shape.driver ? [...RIDER_POLICIES, ...DRIVER_POLICIES] : RIDER_POLICIES);
    let profileId = null;
    if (shape.driver) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        ({ profileId } = await driverRows(client, cipher, fields, accountId, shape.driver));
        if (shape.restriction) {
          await restriction(client, { ...shape.restriction, ...(shape.restriction.scope === 'ACCOUNT' ? { accountId } : { profileId }) });
        }
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    }
    // Server truth check: the account state the app will read matches the intended shape.
    const state = await api(baseUrl).get('/v1/account/state', token);
    if (state.status !== 200) throw new Error(`seed: account ${key} state read failed with ${String(state.status)}`);
    const driver = state.json.driver;
    const expected = { application: shape.driver?.application ?? null, profile: shape.driver?.profile ?? null };
    const actual = { application: driver.application?.state ?? null, profile: driver.profile?.state ?? null };
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      throw new Error(`seed: account ${key} reads ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    const restrictions = state.json.restrictions.map((r) => `${r.scope}:${r.reasonClass}:${r.affectsRiderUse ? 'rider-blocked' : 'rider-ok'}`);
    out[key] = { phone, localPhone: localForm(phone), accountId, driver: actual, restrictions, profileId };
  }
  return out;
}
