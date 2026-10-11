/**
 * API-CONSENT and API-AGE (server part) against real PostgreSQL/Valkey, as the restricted API role: policy listing and
 * documents, consent bound to the current version's exact hash, re-consent only after a MATERIAL change, append-only
 * evidence, age declaration shaped by the policy mode (DOB only when required, encrypted, never echoed), required
 * actions on sign-in and account state, idempotent replay, owner scoping and log canaries. Synthetic data only.
 */
import {
  AgeDeclarationRecordedSchema,
  AgeEligibilityPolicySchema,
  ConsentRecordedSchema,
  ConsentStatusListSchema,
  PolicyDocumentSchema,
  PolicyListSchema,
  SessionCreatedSchema,
} from '@wayvro/contracts';
import { ENCRYPTED_FIELDS, fieldContext } from '@wayvro/identity-core';
import { currentDocument, policyDocument } from '@wayvro/legal-content';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, codeFor, device, installation, key, post, requestCode, signIn, startApi, syntheticPhone, type Harness } from './support.js';

let h: Harness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => {
  await h.close();
});

const now = new Date();
const doc = (k: 'TERMS' | 'PRIVACY' | 'DRIVER_PARTNER_AGREEMENT' | 'COMMUNITY_GUIDELINES', locale: 'en' | 'ur' = 'en') => {
  const d = currentDocument(k, locale, now);
  if (!d) throw new Error(`${k} has no current version`);
  return d;
};
const consent = (k: Parameters<typeof doc>[0], action = 'ACCEPTED', locale: 'en' | 'ur' = 'en') => {
  const d = doc(k, locale);
  return { policyKey: k, version: d.version, locale, contentSha256: d.contentSha256, action };
};
const state = async (token: string) =>
  (await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(token) })).json<{ requiredActions: string[] }>();

describe('public policy registry (A04/R09/W05)', () => {
  it('lists the current version of every policy with hash, placeholder status and canonical path', async () => {
    const res = await h.inject({ method: 'GET', url: '/v1/legal/policies?locale=ur' });
    expect(res.statusCode).toBe(200);
    const body = PolicyListSchema.parse(res.json());
    expect(body.policies.map((p) => p.policyKey).sort()).toEqual(
      ['AGE_ELIGIBILITY', 'BIOMETRIC_KYC_NOTICE', 'CANCELLATION_REFUND', 'COMMUNITY_GUIDELINES', 'DRIVER_PARTNER_AGREEMENT', 'PRIVACY', 'TERMS'].sort(),
    );
    for (const p of body.policies) {
      expect(p.locale).toBe('ur');
      expect(p.status).toBe('PLACEHOLDER_NOT_FOR_PRODUCTION');
      expect(p.contentSha256).toBe(currentDocument(p.policyKey, 'ur', now)?.contentSha256);
    }
    expect((await h.inject({ method: 'GET', url: '/v1/legal/policies' })).json<{ policies: Array<{ locale: string }> }>().policies[0]?.locale).toBe('en');
    expect((await h.inject({ method: 'GET', url: '/v1/legal/policies?locale=fr' })).statusCode).toBe(400);
    expect((await h.inject({ method: 'GET', url: '/v1/legal/policies?locale=en&extra=1' })).statusCode).toBe(400);
  });

  it('serves one immutable version with its text; unknown keys/versions are 404', async () => {
    const res = await h.inject({ method: 'GET', url: '/v1/legal/policies/PRIVACY/versions/1?locale=en' });
    expect(res.statusCode).toBe(200);
    const body = PolicyDocumentSchema.parse(res.json());
    expect(body.body.sections[0]?.heading).toMatch(/PLACEHOLDER — NOT FOR PRODUCTION/);
    for (const url of ['/v1/legal/policies/PRIVACY/versions/99', '/v1/legal/policies/NOPE/versions/1', '/v1/legal/policies/PRIVACY/versions/0']) {
      expect((await h.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  it('the registry table equals the catalogue (registered at boot, immutable)', async () => {
    const rows = await h.owner.query<{ policy_key: string; version: number; locale: string; sha: string }>(
      `select policy_key, version, locale, encode(content_sha256, 'hex') sha from legal.policy_documents`,
    );
    expect(rows.rowCount).toBe(14);
    for (const r of rows.rows) expect(r.sha).toBe(policyDocument(r.policy_key as 'TERMS', r.version, r.locale as 'en')?.contentSha256);
  });

  it('age policy: placeholder version, affirmation mode, no threshold served', async () => {
    const res = await h.inject({ method: 'GET', url: '/v1/legal/age-eligibility-policy' });
    expect(res.statusCode).toBe(200);
    expect(AgeEligibilityPolicySchema.parse(res.json())).toMatchObject({
      version: 1,
      status: 'PLACEHOLDER_NOT_FOR_PRODUCTION',
      riderDeclarationMode: 'AFFIRM_MINIMUM_AGE',
      riderMinimumAge: null,
    });
  });
});

describe('API-CONSENT', () => {
  it('a new account must accept TERMS + PRIVACY and declare age; required actions clear as evidence is recorded', async () => {
    const phone = syntheticPhone();
    const inst = installation();
    const challengeId = await requestCode(h, phone, inst);
    const created = SessionCreatedSchema.parse(
      (await h.inject(post('/v1/auth/sessions', { challengeId, code: codeFor(h, phone), installationId: inst, device }))).json(),
    );
    expect(created.requiredActions).toEqual(['ACCEPT_POLICIES', 'AGE_DECLARATION']);
    const auth = bearer(created.accessToken);
    const status = ConsentStatusListSchema.parse((await h.inject({ method: 'GET', url: '/v1/account/consents', headers: auth })).json());
    expect(status.policies.map((p) => [p.policyKey, p.acceptanceRequired]).sort()).toEqual(
      [
        ['BIOMETRIC_KYC_NOTICE', true],
        ['DRIVER_PARTNER_AGREEMENT', true],
        ['PRIVACY', true],
        ['TERMS', true],
      ].sort(),
    );
    const t = await h.inject(post('/v1/account/consents', consent('TERMS'), auth));
    expect(t.statusCode).toBe(201);
    expect(ConsentRecordedSchema.parse(t.json()).requiredActions).toEqual(['ACCEPT_POLICIES', 'AGE_DECLARATION']);
    // accepting in Urdu satisfies the same policy version
    const p = await h.inject(post('/v1/account/consents', consent('PRIVACY', 'ACCEPTED', 'ur'), auth));
    expect(ConsentRecordedSchema.parse(p.json()).requiredActions).toEqual(['AGE_DECLARATION']);
    const a = await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true }, auth));
    expect(a.statusCode).toBe(201);
    expect(AgeDeclarationRecordedSchema.parse(a.json())).toMatchObject({ policyVersion: 1, declarationMode: 'AFFIRM_MINIMUM_AGE', requiredActions: [] });
    expect((await state(created.accessToken)).requiredActions).toEqual([]);
    // Signing in again on another device: nothing pending.
    const again = await signIn(h, phone);
    expect((await state(again.accessToken)).requiredActions).toEqual([]);
    // Withdrawing a required policy brings the action back (evidence appended, never rewritten).
    await h.inject(post('/v1/account/consents', consent('TERMS', 'WITHDRAWN'), auth));
    expect((await state(created.accessToken)).requiredActions).toEqual(['ACCEPT_POLICIES']);
    const rows = await h.owner.query<{ action: string; surface: string; app_version: string; session_id: string }>(
      `select action, surface, app_version, session_id from identity.consent_records c join identity.accounts a on a.id = c.account_id where c.policy_key = 'TERMS' order by c.recorded_at, c.id`,
    );
    expect(rows.rows.slice(-2).map((r) => r.action)).toEqual(['ACCEPTED', 'WITHDRAWN']);
    expect(rows.rows.at(-1)).toMatchObject({ surface: 'MOBILE_APP', app_version: device.appVersion, session_id: created.sessionId });
  });

  it('rejects a wrong/unknown hash, a non-current version, unknown fields and disclosure-only policies', async () => {
    const s = await signIn(h);
    const auth = bearer(s.accessToken);
    const wrongHash = await h.inject(post('/v1/account/consents', { ...consent('TERMS'), contentSha256: 'a'.repeat(64) }, auth));
    expect(wrongHash.statusCode).toBe(409);
    expect(wrongHash.json<{ error: { code: string } }>().error.code).toBe('WAYVRO_E_CONFLICT');
    const otherLocaleHash = await h.inject(post('/v1/account/consents', { ...consent('TERMS'), contentSha256: doc('TERMS', 'ur').contentSha256 }, auth));
    expect(otherLocaleHash.statusCode).toBe(409);
    expect((await h.inject(post('/v1/account/consents', { ...consent('TERMS'), version: 2 }, auth))).statusCode).toBe(400);
    expect((await h.inject(post('/v1/account/consents', consent('COMMUNITY_GUIDELINES'), auth))).statusCode).toBe(400);
    expect((await h.inject(post('/v1/account/consents', { ...consent('TERMS'), accountId: s.sessionId }, auth))).statusCode).toBe(400);
    expect((await h.inject(post('/v1/account/consents', { ...consent('TERMS'), action: 'MAYBE' }, auth))).statusCode).toBe(400);
    expect((await h.inject(post('/v1/account/consents', consent('TERMS')))).statusCode).toBe(401);
    expect((await state(s.accessToken)).requiredActions).toContain('ACCEPT_POLICIES');
  });

  it('idempotent: a repeated key replays the same record; same key + different body conflicts', async () => {
    const s = await signIn(h);
    const auth = bearer(s.accessToken);
    const idem = key();
    const first = await h.inject(post('/v1/account/consents', consent('TERMS'), { ...auth, 'idempotency-key': idem }));
    const second = await h.inject(post('/v1/account/consents', consent('TERMS'), { ...auth, 'idempotency-key': idem }));
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    const conflict = await h.inject(post('/v1/account/consents', consent('PRIVACY'), { ...auth, 'idempotency-key': idem }));
    expect(conflict.json<{ error: { code: string } }>().error.code).toBe('WAYVRO_E_IDEMPOTENCY_CONFLICT');
    // concurrent double-tap with different keys records two (append-only) rows and stays consistent
    const [x, y] = await Promise.all([
      h.inject(post('/v1/account/consents', consent('PRIVACY'), auth)),
      h.inject(post('/v1/account/consents', consent('PRIVACY'), auth)),
    ]);
    expect([x.statusCode, y.statusCode]).toEqual([201, 201]);
  });

  it('consent evidence is owner-scoped: another account sees only its own status', async () => {
    const a = await signIn(h);
    const b = await signIn(h);
    await h.inject(post('/v1/account/consents', consent('TERMS'), bearer(a.accessToken)));
    const bStatus = ConsentStatusListSchema.parse((await h.inject({ method: 'GET', url: '/v1/account/consents', headers: bearer(b.accessToken) })).json());
    expect(bStatus.policies.find((p) => p.policyKey === 'TERMS')?.acceptedVersion).toBeNull();
  });
});

describe('API-AGE (server part, A15)', () => {
  it('affirmation mode: DOB is rejected, a stale version conflicts, a second declaration conflicts', async () => {
    const s = await signIn(h);
    const auth = bearer(s.accessToken);
    expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, dateOfBirth: '1990-01-01' }, auth))).statusCode).toBe(400);
    expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 1 }, auth))).statusCode).toBe(400);
    expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: false }, auth))).statusCode).toBe(400);
    expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true, dateOfBirth: '1990-01-01' }, auth))).statusCode).toBe(400);
    expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 7, affirmed: true }, auth))).statusCode).toBe(409);
    expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true }, auth))).statusCode).toBe(201);
    expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true }, auth))).statusCode).toBe(409);
    const stored = await h.owner.query(
      `select affirmed, dob_envelope from identity.age_declarations d join identity.sessions s on s.id = d.session_id where s.id = $1`,
      [s.sessionId],
    );
    expect(stored.rows[0]).toEqual({ affirmed: true, dob_envelope: null });
  });

  it('policy versions are data: a newer DOB-mode version re-requires a declaration, stores the DOB encrypted and never echoes it', async () => {
    const s = await signIn(h);
    const auth = bearer(s.accessToken);
    await h.inject(post('/v1/account/age-declarations', { policyVersion: 1, affirmed: true }, auth));
    expect((await state(s.accessToken)).requiredActions).not.toContain('AGE_DECLARATION');
    // A (synthetic, test-only) DOB-mode placeholder version takes effect: server time decides the current version.
    await h.owner.query(
      `insert into legal.age_eligibility_policies (version, status, rider_declaration_mode, effective_at) values (2, 'PLACEHOLDER_NOT_FOR_PRODUCTION', 'DATE_OF_BIRTH_REQUIRED', now())`,
    );
    try {
      expect((await state(s.accessToken)).requiredActions).toContain('AGE_DECLARATION');
      expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 2, affirmed: true }, auth))).statusCode).toBe(400);
      expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 2, dateOfBirth: '2999-01-01' }, auth))).statusCode).toBe(400);
      expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 2, dateOfBirth: '1990-13-45' }, auth))).statusCode).toBe(400);
      const ok = await h.inject(post('/v1/account/age-declarations', { policyVersion: 2, dateOfBirth: '1991-04-12' }, auth));
      expect(ok.statusCode).toBe(201);
      expect(ok.body).not.toContain('1991');
      const row = (
        await h.owner.query<{ id: string; dob_envelope: Buffer; affirmed: boolean | null }>(
          `select d.id, d.dob_envelope, d.affirmed from identity.age_declarations d where d.policy_version = 2 and d.session_id = $1`,
          [s.sessionId],
        )
      ).rows[0];
      expect(row?.affirmed).toBeNull();
      expect(row?.dob_envelope.toString('latin1')).not.toContain('1991');
      expect(
        h.runtime.cipher.decryptString('identity_dates', row?.dob_envelope ?? Buffer.alloc(0), fieldContext(ENCRYPTED_FIELDS.ageDeclarationDob, row?.id ?? '')),
      ).toBe('1991-04-12');
      expect(h.logs.text()).not.toContain('1991-04-12');
      expect((await state(s.accessToken)).requiredActions).not.toContain('AGE_DECLARATION');
    } finally {
      await h.owner.query(`update legal.age_eligibility_policies set status = 'RETIRED', retired_at = now() where version = 2`);
    }
    // NONE mode requires nothing and accepts no declaration.
    await h.owner.query(
      `insert into legal.age_eligibility_policies (version, status, rider_declaration_mode, effective_at) values (3, 'PLACEHOLDER_NOT_FOR_PRODUCTION', 'NONE', now())`,
    );
    try {
      const fresh = await signIn(h);
      expect((await state(fresh.accessToken)).requiredActions).not.toContain('AGE_DECLARATION');
      expect((await h.inject(post('/v1/account/age-declarations', { policyVersion: 3, affirmed: true }, bearer(fresh.accessToken)))).statusCode).toBe(400);
    } finally {
      await h.owner.query(`update legal.age_eligibility_policies set status = 'RETIRED', retired_at = now() where version = 3`);
    }
  });
});

describe('registry immutability at boot', () => {
  it('a published text edited in place (same key/version/locale, different hash) refuses registration', async () => {
    const { registerPolicyCatalogue, PolicyRegistryError } = await import('../src/legal/policy-registry.js');
    const original = policyDocument('TERMS', 1, 'en');
    if (!original) throw new Error('TERMS v1 missing');
    const tampered = { ...original, contentSha256: 'b'.repeat(64) };
    const log = { warn: () => undefined } as unknown as Parameters<typeof registerPolicyCatalogue>[1];
    await expect(registerPolicyCatalogue(h.owner, log, [tampered])).rejects.toBeInstanceOf(PolicyRegistryError);
    await expect(registerPolicyCatalogue(h.owner, log, [{ ...original, materialChange: !original.materialChange }])).rejects.toThrow(/immutable/);
    // the unchanged catalogue still verifies (idempotent re-registration)
    await expect(registerPolicyCatalogue(h.owner, log, [original])).resolves.toBeUndefined();
  });
});
