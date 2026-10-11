/**
 * P2.10 OIDC linking through the API against REAL PostgreSQL and Valkey, with ID tokens signed by the LOCAL issuer
 * double (never evidence for EG-06/EG-07): sign-in only for a LINKED identity (never account creation, one generic
 * 401), PHONE_STEP_UP for an installation without a phone OTP (founder Q-02), link/unlink behind a fresh phone
 * step-up, generic link conflicts (S13, no merge), adversarial tokens (forged key, wrong issuer/audience, expired,
 * replayed or foreign nonce, Apple hashed nonce), the linked-identity lost-phone recovery straight into its cooldown,
 * and 503 without a key source. Synthetic data only.
 */
import { createHash, randomUUID } from 'node:crypto';
import { LocalOidcIssuer } from '@wayvro/provider-test-doubles';
import { SessionCreatedSchema } from '@wayvro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, codeFor, device, installation, post, signIn, startApi, type Harness, type SignedIn } from './support.js';

const GOOGLE_AUD = 'wayvro-test.apps.example';
const APPLE_AUD = 'com.wayvro.test';
let h: Harness;
let issuer: LocalOidcIssuer;
beforeAll(async () => {
  issuer = await LocalOidcIssuer.create();
  h = await startApi({ oidc: issuer, env: { OIDC_GOOGLE_AUDIENCES: GOOGLE_AUD, OIDC_APPLE_AUDIENCES: APPLE_AUD } });
}, 120_000);
afterAll(async () => {
  await h.close();
});

const errorOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error;
const accountOf = async (sessionId: string) =>
  (await h.owner.query<{ account_id: string }>(`select account_id from identity.sessions where id = $1`, [sessionId])).rows[0]?.account_id ?? '';
const subject = () => `sub-${randomUUID()}`;

async function stepUp(s: Pick<SignedIn, 'phone' | 'accessToken'>): Promise<void> {
  const res = await h.inject(post('/v1/account/step-ups', {}, bearer(s.accessToken)));
  await h.deliver();
  const ok = await h.inject(
    post(`/v1/account/step-ups/${res.json<{ challengeId: string }>().challengeId}/verifications`, { code: codeFor(h, s.phone) }, bearer(s.accessToken)),
  );
  expect(ok.statusCode, ok.body).toBe(200);
}
async function accountNonce(s: SignedIn, purpose: 'LINK' | 'RECOVERY'): Promise<{ nonceId: string; nonce: string }> {
  const res = await h.inject(post('/v1/account/oidc-nonces', { purpose }, bearer(s.accessToken)));
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}
async function signInNonce(installationId: string): Promise<{ nonceId: string; nonce: string }> {
  const res = await h.inject(post('/v1/auth/oidc-nonces', { installationId }));
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}
const appleNonce = (raw: string) => createHash('sha256').update(raw).digest('hex');
async function link(s: SignedIn, sub: string, provider: 'GOOGLE' | 'APPLE' = 'GOOGLE') {
  const n = await accountNonce(s, 'LINK');
  const idToken = await issuer.mint({
    provider,
    subject: sub,
    audience: provider === 'GOOGLE' ? GOOGLE_AUD : APPLE_AUD,
    nonce: provider === 'APPLE' ? appleNonce(n.nonce) : n.nonce,
  });
  return h.inject(post('/v1/account/oidc-links', { provider, idToken, nonceId: n.nonceId }, bearer(s.accessToken)));
}
async function oidcSignIn(sub: string, installationId: string, overrides: Partial<Parameters<LocalOidcIssuer['mint']>[0]> = {}, nonceFor?: string) {
  const n = await signInNonce(nonceFor ?? installationId);
  const idToken = await issuer.mint({ provider: 'GOOGLE', subject: sub, audience: GOOGLE_AUD, nonce: n.nonce, ...overrides });
  return h.inject(post('/v1/auth/oidc-sessions', { provider: 'GOOGLE', idToken, nonceId: n.nonceId, installationId, device }));
}

describe('sign-in and linking (K15/K16/S13)', () => {
  it('an unlinked identity never creates an account; linking needs a step-up; an unknown installation must step up on the phone', async () => {
    const before = (await h.owner.query(`select count(*) n from identity.accounts`)).rows[0] as { n: string };
    const sub = subject();
    const notLinked = await oidcSignIn(sub, installation());
    expect(notLinked.statusCode).toBe(401);
    expect(errorOf(notLinked)?.code).toBe('WAYVRO_E_OIDC_NOT_LINKED');
    expect((await h.owner.query(`select count(*) n from identity.accounts`)).rows[0]).toEqual(before);

    const s = await signIn(h);
    expect(errorOf(await link(s, sub))?.code).toBe('WAYVRO_E_STEP_UP_REQUIRED');
    await stepUp(s);
    const linked = await link(s, sub);
    expect(linked.statusCode, linked.body).toBe(201);
    expect((await h.inject({ method: 'GET', url: '/v1/account/oidc-links', headers: bearer(s.accessToken) })).json<{ links: unknown[] }>().links).toHaveLength(
      1,
    );

    // the installation that signed in with the phone OTP is known: no phone step-up
    const known = SessionCreatedSchema.parse((await oidcSignIn(sub, s.installationId)).json());
    expect(known.requiredActions).not.toContain('PHONE_STEP_UP');
    expect(await accountOf(known.sessionId)).toBe(await accountOf(s.sessionId));
    // a new installation: PHONE_STEP_UP, restricted until the phone step-up
    const fresh = await oidcSignIn(sub, installation());
    expect(fresh.statusCode, fresh.body).toBe(201);
    const created = SessionCreatedSchema.parse(fresh.json());
    expect(created.requiredActions[0]).toBe('PHONE_STEP_UP');
    const state = await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(created.accessToken) });
    expect(state.json<{ requiredActions: string[]; session: { id: string } }>().requiredActions).toContain('PHONE_STEP_UP');
    const patch = () =>
      h.inject({
        method: 'PATCH',
        url: '/v1/account/profile',
        payload: { displayName: 'Synthetic' },
        headers: { ...bearer(created.accessToken), 'idempotency-key': `idem-${randomUUID()}` },
      });
    expect(errorOf(await patch())?.code).toBe('WAYVRO_E_STEP_UP_REQUIRED');
    await stepUp({ phone: s.phone, accessToken: created.accessToken });
    expect((await patch()).statusCode).toBe(200);
    const assurance = (await h.owner.query<{ assurance: string }>(`select assurance from identity.sessions where id = $1`, [created.sessionId])).rows[0];
    expect(assurance?.assurance).toBe('OIDC');
  });

  it('a subject linked elsewhere is a generic conflict; one identity per provider; unlink stops sign-in', async () => {
    const a = await signIn(h);
    const b = await signIn(h);
    const sub = subject();
    await stepUp(a);
    expect((await link(a, sub)).statusCode).toBe(201);
    await stepUp(b);
    const conflict = await link(b, sub);
    expect(conflict.statusCode).toBe(409);
    expect(errorOf(conflict)?.code).toBe('WAYVRO_E_OIDC_LINK_CONFLICT');
    expect((await h.owner.query(`select 1 from audit.audit_events where action = 'OIDC_LINK_CONFLICT'`)).rowCount).toBeGreaterThanOrEqual(1);
    expect(errorOf(await link(a, subject()))?.code).toBe('WAYVRO_E_CONFLICT'); // one Google identity per account
    expect((await link(a, subject(), 'APPLE')).statusCode).toBe(201); // Apple carries the hashed nonce
    const id = (await h.inject({ method: 'GET', url: '/v1/account/oidc-links', headers: bearer(a.accessToken) }))
      .json<{ links: Array<{ id: string; provider: string }> }>()
      .links.find((l) => l.provider === 'GOOGLE')?.id;
    const unlink = await h.inject({
      method: 'DELETE',
      url: `/v1/account/oidc-links/${id ?? ''}`,
      headers: { ...bearer(a.accessToken), 'idempotency-key': `idem-${randomUUID()}` },
    });
    expect(unlink.statusCode).toBe(204);
    expect((await oidcSignIn(sub, a.installationId)).statusCode).toBe(401);
    expect(
      (
        await h.inject({
          method: 'DELETE',
          url: `/v1/account/oidc-links/${randomUUID()}`,
          headers: { ...bearer(a.accessToken), 'idempotency-key': `idem-${randomUUID()}` },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('adversarial tokens (K13)', () => {
  it('forged key, wrong issuer or audience, expired, foreign or replayed nonce, raw Apple nonce: all the same generic 401', async () => {
    const s = await signIn(h);
    const sub = subject();
    await stepUp(s);
    expect((await link(s, sub)).statusCode).toBe(201);
    const inst = s.installationId;
    for (const overrides of [
      { unpublishedKey: true },
      { issuer: 'https://accounts.example.invalid' },
      { audience: 'someone-else.apps.example' },
      { issuedAtSeconds: Math.floor(Date.now() / 1000) - 3600, expiresInSeconds: 600 },
    ]) {
      const res = await oidcSignIn(sub, inst, overrides);
      expect(errorOf(res)?.code, JSON.stringify(overrides)).toBe('WAYVRO_E_OIDC_NOT_LINKED');
    }
    // a nonce issued to another installation
    expect((await oidcSignIn(sub, inst, {}, installation())).statusCode).toBe(401);
    // replay: the same nonce and token twice (different idempotency keys)
    const n = await signInNonce(inst);
    const idToken = await issuer.mint({ provider: 'GOOGLE', subject: sub, audience: GOOGLE_AUD, nonce: n.nonce });
    const body = { provider: 'GOOGLE', idToken, nonceId: n.nonceId, installationId: inst, device };
    expect((await h.inject(post('/v1/auth/oidc-sessions', body))).statusCode).toBe(201);
    expect((await h.inject(post('/v1/auth/oidc-sessions', body))).statusCode).toBe(401);
    // Apple: the token must carry the SHA-256 of the nonce, not the nonce itself
    const apple = subject();
    expect((await link(s, apple, 'APPLE')).statusCode).toBe(201);
    const an = await signInNonce(inst);
    const raw = await issuer.mint({ provider: 'APPLE', subject: apple, audience: APPLE_AUD, nonce: an.nonce });
    expect(
      (await h.inject(post('/v1/auth/oidc-sessions', { provider: 'APPLE', idToken: raw, nonceId: an.nonceId, installationId: inst, device }))).statusCode,
    ).toBe(401);
    // a failed attempt spends the nonce
    const spent = await signInNonce(inst);
    const bad = await issuer.mint({ provider: 'GOOGLE', subject: sub, audience: 'someone-else.apps.example', nonce: spent.nonce });
    const good = await issuer.mint({ provider: 'GOOGLE', subject: sub, audience: GOOGLE_AUD, nonce: spent.nonce });
    expect(
      (await h.inject(post('/v1/auth/oidc-sessions', { provider: 'GOOGLE', idToken: bad, nonceId: spent.nonceId, installationId: inst, device }))).statusCode,
    ).toBe(401);
    expect(
      (await h.inject(post('/v1/auth/oidc-sessions', { provider: 'GOOGLE', idToken: good, nonceId: spent.nonceId, installationId: inst, device }))).statusCode,
    ).toBe(401);
    expect(JSON.stringify(h.logs.text())).not.toContain(good.split('.')[2] ?? 'x');
  });
});

describe('lost-phone recovery with a linked identity (auth design §6.4)', () => {
  it('a valid proof for the account owning the previous number goes straight to the cooldown; mismatches stay RECEIVED', async () => {
    const owner = await signIn(h);
    const sub = subject();
    await stepUp(owner);
    expect((await link(owner, sub)).statusCode).toBe(201);
    const caller = await signIn(h);
    const other = await signIn(h);
    const recover = async (previousPhone: string, tokenSubject: string) => {
      const n = await accountNonce(caller, 'RECOVERY');
      const idToken = await issuer.mint({ provider: 'GOOGLE', subject: tokenSubject, audience: GOOGLE_AUD, nonce: n.nonce });
      return h.inject(
        post(
          '/v1/account-recoveries',
          { proof: 'LINKED_OIDC', previousPhone, oidc: { provider: 'GOOGLE', idToken, nonceId: n.nonceId } },
          bearer(caller.accessToken),
        ),
      );
    };
    // the proof names a different account than the previous number: RECEIVED, nothing opened
    expect((await recover(other.phone, sub)).json()).toEqual({ status: 'RECEIVED' });
    expect((await h.owner.query(`select 1 from identity.phone_change_requests where account_id = $1`, [await accountOf(other.sessionId)])).rowCount).toBe(0);
    // an invalid token is the caller's own error
    const n = await accountNonce(caller, 'RECOVERY');
    const forged = await issuer.mint({ provider: 'GOOGLE', subject: sub, audience: GOOGLE_AUD, nonce: n.nonce, unpublishedKey: true });
    expect(
      (
        await h.inject(
          post(
            '/v1/account-recoveries',
            { proof: 'LINKED_OIDC', previousPhone: owner.phone, oidc: { provider: 'GOOGLE', idToken: forged, nonceId: n.nonceId } },
            bearer(caller.accessToken),
          ),
        )
      ).statusCode,
    ).toBe(400);
    const ok = await recover(owner.phone, sub);
    expect(ok.statusCode, ok.body).toBe(202);
    const request = (
      await h.owner.query<{ kind: string; status: string; hours: number }>(
        `select kind, status, extract(epoch from cooldown_until - now()) / 3600 hours from identity.phone_change_requests where account_id = $1`,
        [await accountOf(owner.sessionId)],
      )
    ).rows[0];
    expect(request).toMatchObject({ kind: 'RECOVERY_OIDC_PROOF', status: 'COOLDOWN' });
    expect(Number(request?.hours)).toBeGreaterThan(71);
    const seen = (await h.inject({ method: 'GET', url: '/v1/account/phone-changes/current', headers: bearer(owner.accessToken) })).json<{
      phoneChange: { kind: string };
    }>();
    expect(seen.phoneChange.kind).toBe('RECOVERY_OIDC_PROOF'); // "cancel if this wasn't you"
  });
});

describe('availability', () => {
  it('without a key source every OIDC route answers 503 (never a fake success)', async () => {
    const bare = await startApi({ env: { OIDC_GOOGLE_AUDIENCES: GOOGLE_AUD } });
    try {
      const res = await bare.inject(
        post('/v1/auth/oidc-sessions', { provider: 'GOOGLE', idToken: 'a.b.c', nonceId: randomUUID(), installationId: installation(), device }),
      );
      expect(res.statusCode).toBe(503);
    } finally {
      await bare.close();
    }
  });
});
