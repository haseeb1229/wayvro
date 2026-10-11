/**
 * SEC-SESS, CONC-SESS, API-SESS, SEC-IDOR, SEC-MA, idempotency (F-03), S12 signal recording, SEC-LOG canaries and
 * V02/V07 scoping — real PostgreSQL + Valkey, API as the restricted `wayvro_api` role.
 */
import { createHash } from 'node:crypto';
import { AccountStateSchema, SecurityEventListSchema, SessionListSchema, SessionTokensSchema } from '@wayvro/contracts';
import { race } from '@wayvro/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, codeFor, device, installation, key, post, requestCode, signIn, startApi, syntheticPhone, type Harness, type SignedIn } from './support.js';

let h: Harness;
beforeAll(async () => {
  h = await startApi({
    env: {
      OTP_PHONE_SENDS_PER_HOUR: '1000',
      OTP_PHONE_SENDS_PER_DAY: '1000',
      OTP_INSTALLATION_SENDS_PER_DAY: '1000',
      OTP_VERIFY_ATTEMPTS_PER_INSTALLATION_HOUR: '1000',
    },
  });
});
afterAll(async () => {
  await h.close();
});

const get = (url: string, token: string) => h.inject({ method: 'GET', url, headers: bearer(token) });
const refresh = (refreshToken: string, idempotencyKey: string = key()) =>
  h.inject({ method: 'POST', url: '/v1/auth/token-refreshes', payload: { refreshToken }, headers: { 'idempotency-key': idempotencyKey } });
const sessionStatus = async (id: string) =>
  (await h.owner.query<{ status: string; revoke_reason: string | null }>(`select status, revoke_reason from identity.sessions where id = $1`, [id])).rows[0];

describe('SEC-SESS: tokens and rotation', () => {
  it('SEC-SESS-01 tokens are opaque 256-bit values; only SHA-256 hashes are stored', async () => {
    const s = await signIn(h);
    expect(s.accessToken).toMatch(/^wva_[A-Za-z0-9_-]{43}$/);
    expect(s.refreshToken).toMatch(/^wvr_[A-Za-z0-9_-]{43}$/);
    const sha = (t: string) => createHash('sha256').update(t).digest();
    const row = await h.owner.query(`select 1 from identity.sessions where id = $1 and access_token_hash = $2`, [s.sessionId, sha(s.accessToken)]);
    expect(row.rowCount).toBe(1);
    expect((await h.owner.query(`select 1 from identity.refresh_tokens where token_hash = $1`, [sha(s.refreshToken)])).rowCount).toBe(1);
    const dump = await h.owner.query<{ t: string }>(
      `select string_agg(t, '|') t from (select row_to_json(s)::text t from identity.sessions s union all select row_to_json(r)::text from identity.refresh_tokens r
        union all select encode(response_envelope, 'escape') from platform.idempotency_records where response_envelope is not null) x`,
    );
    expect(dump.rows[0]?.t).not.toContain(s.accessToken.slice(4));
    expect(dump.rows[0]?.t).not.toContain(s.refreshToken.slice(4));
  });

  it('SEC-SESS-02 refresh rotates both tokens; the old access token stops working immediately', async () => {
    const s = await signIn(h);
    const res = await refresh(s.refreshToken);
    expect(res.statusCode).toBe(200);
    const next = SessionTokensSchema.parse(res.json());
    expect(next.sessionId).toBe(s.sessionId);
    expect(next.refreshToken).not.toBe(s.refreshToken);
    expect((await get('/v1/account/state', s.accessToken)).statusCode).toBe(401);
    expect((await get('/v1/account/state', next.accessToken)).statusCode).toBe(200);
  });

  it('SEC-SESS-03 reuse of a rotated refresh token revokes the session family and records the event', async () => {
    const s = await signIn(h);
    const next = SessionTokensSchema.parse((await refresh(s.refreshToken)).json());
    const reuse = await refresh(s.refreshToken);
    expect(reuse.statusCode).toBe(401);
    expect(await sessionStatus(s.sessionId)).toEqual({ status: 'REVOKED', revoke_reason: 'REFRESH_REUSE' });
    expect((await get('/v1/account/state', next.accessToken)).statusCode).toBe(401);
    expect((await refresh(next.refreshToken)).statusCode).toBe(401);
    const audit = await h.owner.query(`select 1 from audit.audit_events where action = 'REFRESH_TOKEN_REUSE' and object_id = $1`, [s.sessionId]);
    expect(audit.rowCount).toBe(1);
  });

  it('SEC-SESS-04 lost response: the same refresh token + SAME Idempotency-Key replays within the leeway', async () => {
    const s = await signIn(h);
    const k = key();
    const first = await refresh(s.refreshToken, k);
    const again = await refresh(s.refreshToken, k);
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.json()).toEqual(first.json());
    expect((await sessionStatus(s.sessionId))?.status).toBe('ACTIVE');
    // A different key is reuse, not a replay.
    expect((await refresh(s.refreshToken, key())).statusCode).toBe(401);
    expect((await sessionStatus(s.sessionId))?.status).toBe('REVOKED');
  });

  it('SEC-SESS-05 tampered, cross-type and unknown tokens are rejected', async () => {
    const s = await signIn(h);
    expect((await get('/v1/account/state', s.refreshToken)).statusCode).toBe(401);
    expect((await refresh(s.accessToken)).statusCode).toBe(401);
    expect((await get('/v1/account/state', s.accessToken.slice(0, -1) + (s.accessToken.endsWith('A') ? 'B' : 'A'))).statusCode).toBe(401);
    expect((await refresh('wvr_' + 'x'.repeat(43))).statusCode).toBe(401);
    expect((await refresh('garbage')).statusCode).toBe(401);
  });

  it('SEC-SESS-06 expired access tokens, idle-expired and absolutely expired sessions are rejected (server time)', async () => {
    const a = await signIn(h);
    await h.owner.query(`update identity.sessions set access_expires_at = now() - interval '1 second' where id = $1`, [a.sessionId]);
    expect((await get('/v1/account/state', a.accessToken)).statusCode).toBe(401);
    expect((await refresh(a.refreshToken)).statusCode).toBe(200);
    const b = await signIn(h);
    await h.owner.query(
      `update identity.sessions set created_at = now() - interval '200 days', access_expires_at = now() - interval '2 days', idle_expires_at = now() - interval '1 day', absolute_expires_at = now() - interval '1 second' where id = $1`,
      [b.sessionId],
    );
    expect((await refresh(b.refreshToken)).statusCode).toBe(401);
  });

  it('SEC-SESS-07 the replay window is the configured leeway: after it, the same key is reuse', async () => {
    const short = await startApi({ env: { SESSION_REFRESH_REPLAY_LEEWAY_SECONDS: '1' } });
    try {
      const s = await signIn(short);
      const k = key();
      expect(
        (await short.inject({ method: 'POST', url: '/v1/auth/token-refreshes', payload: { refreshToken: s.refreshToken }, headers: { 'idempotency-key': k } }))
          .statusCode,
      ).toBe(200);
      await new Promise((r) => setTimeout(r, 1300));
      const late = await short.inject({
        method: 'POST',
        url: '/v1/auth/token-refreshes',
        payload: { refreshToken: s.refreshToken },
        headers: { 'idempotency-key': k },
      });
      expect(late.statusCode).toBe(401);
      expect((await short.owner.query<{ status: string }>(`select status from identity.sessions where id = $1`, [s.sessionId])).rows[0]?.status).toBe(
        'REVOKED',
      );
    } finally {
      await short.close();
    }
  });

  it('SEC-SESS-08 no fixation: a challenge id is never a credential and failed verification mints nothing', async () => {
    const phone = syntheticPhone();
    const inst = installation();
    const challengeId = await requestCode(h, phone, inst);
    expect((await get('/v1/account/state', challengeId)).statusCode).toBe(401);
    const failed = await h.inject(
      post('/v1/auth/sessions', { challengeId, code: '000000' === codeFor(h, phone) ? '000001' : '000000', installationId: inst, device }),
    );
    expect(failed.statusCode).toBe(401);
    expect(failed.json()).not.toHaveProperty('accessToken');
  });
});

describe('CONC-SESS', () => {
  it('CONC-SESS-01 concurrent refreshes with the same key rotate once and replay the same tokens', async () => {
    const s = await signIn(h);
    const k = key();
    const results = await race(8, () => Promise.resolve(() => refresh(s.refreshToken, k)));
    const ok = results.flatMap((r) => (r.status === 'fulfilled' && r.value.statusCode === 200 ? [r.value.json().refreshToken as string] : []));
    expect(ok).toHaveLength(8);
    expect(new Set(ok).size).toBe(1);
    const successors = await h.owner.query(`select count(*)::int n from identity.refresh_tokens where session_id = $1`, [s.sessionId]);
    expect(successors.rows[0]?.n).toBe(2);
  });

  it('CONC-SESS-02 concurrent refreshes with different keys: exactly one successor, the rest is reuse and revokes', async () => {
    const s = await signIn(h);
    const results = await race(6, () => Promise.resolve(() => refresh(s.refreshToken)));
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.statusCode : 0));
    expect(statuses.filter((x) => x === 200)).toHaveLength(1);
    expect(statuses.filter((x) => x === 401)).toHaveLength(5);
    expect((await h.owner.query(`select count(*)::int n from identity.refresh_tokens where session_id = $1`, [s.sessionId])).rows[0]?.n).toBe(2);
    expect((await sessionStatus(s.sessionId))?.status).toBe('REVOKED');
  });
});

describe('API-SESS: sign-out, revocation, lists', () => {
  async function twoSessions(): Promise<[SignedIn, SignedIn]> {
    const a = await signIn(h);
    const b = await signIn(h, a.phone);
    return [a, b];
  }

  it('API-SESS-01 logout current revokes only the calling session; its refresh token dies too', async () => {
    const [a, b] = await twoSessions();
    const res = await h.inject({ method: 'DELETE', url: '/v1/auth/sessions/current', headers: { ...bearer(a.accessToken), 'idempotency-key': key() } });
    expect(res.statusCode).toBe(204);
    expect((await get('/v1/account/state', a.accessToken)).statusCode).toBe(401);
    expect((await refresh(a.refreshToken)).statusCode).toBe(401);
    expect((await get('/v1/account/state', b.accessToken)).statusCode).toBe(200);
  });

  it('API-SESS-02 session list: owner-scoped, current flag, no IP/location, hour-truncated timestamps', async () => {
    const [a, b] = await twoSessions();
    const list = SessionListSchema.parse((await get('/v1/account/sessions', a.accessToken)).json());
    expect(list.sessions.map((x) => x.id).sort()).toEqual([a.sessionId, b.sessionId].sort());
    expect(list.sessions.find((x) => x.id === a.sessionId)?.current).toBe(true);
    for (const x of list.sessions) {
      expect(Object.keys(x).sort()).toEqual(['appVersion', 'createdAt', 'current', 'id', 'lastUsedAt', 'platform']);
      expect(x.createdAt).toMatch(/T\d{2}:00:00\.000Z$/);
    }
  });

  it('API-SESS-03 revoke all others keeps the caller; revoke all includes it', async () => {
    const [a, b] = await twoSessions();
    const others = await h.inject({
      method: 'POST',
      url: '/v1/account/session-revocations',
      payload: { scope: 'ALL_OTHERS' },
      headers: { ...bearer(a.accessToken), 'idempotency-key': key() },
    });
    expect(others.json()).toEqual({ revokedCount: 1 });
    expect((await get('/v1/account/state', b.accessToken)).statusCode).toBe(401);
    expect((await get('/v1/account/state', a.accessToken)).statusCode).toBe(200);
    const all = await h.inject({
      method: 'POST',
      url: '/v1/account/session-revocations',
      payload: { scope: 'ALL' },
      headers: { ...bearer(a.accessToken), 'idempotency-key': key() },
    });
    expect(all.json()).toEqual({ revokedCount: 1 });
    expect((await get('/v1/account/state', a.accessToken)).statusCode).toBe(401);
  });

  it('API-SESS-04 revoke-all needs a fresh OTP proof unless the session is older than 24 h', async () => {
    const [a] = await twoSessions();
    await h.owner.query(`update identity.sessions set created_at = now() - interval '2 hours' where id = $1`, [a.sessionId]);
    const res = await h.inject({
      method: 'POST',
      url: '/v1/account/session-revocations',
      payload: { scope: 'ALL_OTHERS' },
      headers: { ...bearer(a.accessToken), 'idempotency-key': key() },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'WAYVRO_E_STEP_UP_REQUIRED' } });
    await h.owner.query(`update identity.sessions set created_at = now() - interval '25 hours' where id = $1`, [a.sessionId]);
    expect(
      (
        await h.inject({
          method: 'POST',
          url: '/v1/account/session-revocations',
          payload: { scope: 'ALL_OTHERS' },
          headers: { ...bearer(a.accessToken), 'idempotency-key': key() },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('API-SESS-05 security activity lists sign-ins and revocations without PII', async () => {
    const [a, b] = await twoSessions();
    await h.inject({ method: 'DELETE', url: `/v1/account/sessions/${b.sessionId}`, headers: { ...bearer(a.accessToken), 'idempotency-key': key() } });
    const events = SecurityEventListSchema.parse((await get('/v1/account/security-events', a.accessToken)).json());
    expect(events.events.map((e) => e.type)).toEqual(expect.arrayContaining(['SIGN_IN', 'SIGN_IN_NEW_DEVICE', 'SESSION_REVOKED']));
    expect(JSON.stringify(events)).not.toContain(a.phone.slice(3));
  });
});

describe('SEC-IDOR / SEC-MA / V02 / V07', () => {
  it('SEC-IDOR-01 foreign, unknown and malformed session ids answer 404 without side effects', async () => {
    const a = await signIn(h);
    const victim = await signIn(h);
    for (const id of [victim.sessionId, '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b', 'not-a-uuid']) {
      const res = await h.inject({ method: 'DELETE', url: `/v1/account/sessions/${id}`, headers: { ...bearer(a.accessToken), 'idempotency-key': key() } });
      expect(res.statusCode, id).toBe(404);
    }
    expect((await get('/v1/account/state', victim.accessToken)).statusCode).toBe(200);
    expect(SessionListSchema.parse((await get('/v1/account/sessions', a.accessToken)).json()).sessions.map((x) => x.id)).toEqual([a.sessionId]);
  });

  it('SEC-MA-01 server-owned or unknown fields are rejected on every mutating route', async () => {
    const a = await signIn(h);
    const auth = (extra: Record<string, string> = {}) => ({ ...bearer(a.accessToken), 'idempotency-key': key(), ...extra });
    for (const payload of [
      { displayName: 'x', status: 'SUSPENDED' },
      { preferredLocale: 'en', accountId: a.sessionId },
      { displayName: 'x', role: 'ADMIN' },
      { riderProfile: {} },
      {},
    ]) {
      expect((await h.inject({ method: 'PATCH', url: '/v1/account/profile', payload, headers: auth() })).statusCode).toBe(400);
    }
    expect(
      (await h.inject(post('/v1/auth/otp-challenges', { phone: a.phone, purpose: 'SIGN_IN', installationId: installation(), locale: 'en', accountId: 'x' })))
        .statusCode,
    ).toBe(400);
    expect(
      (await h.inject({ method: 'POST', url: '/v1/account/session-revocations', payload: { scope: 'ALL', accountId: 'x' }, headers: auth() })).statusCode,
    ).toBe(400);
    expect(
      (
        await h.inject({
          method: 'POST',
          url: '/v1/auth/token-refreshes',
          payload: { refreshToken: a.refreshToken, sessionId: a.sessionId },
          headers: { 'idempotency-key': key() },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('V02-01 profile updates change only allowlisted fields; client mode/role headers never authorise', async () => {
    const a = await signIn(h);
    const res = await h.inject({
      method: 'PATCH',
      url: '/v1/account/profile',
      payload: { displayName: '  Synthetic Rider ', preferredLocale: 'ur-Latn' },
      headers: { ...bearer(a.accessToken), 'idempotency-key': key() },
    });
    expect(res.json()).toEqual({ displayName: 'Synthetic Rider', preferredLocale: 'ur-Latn' });
    const state = AccountStateSchema.parse(
      (
        await h.inject({ method: 'GET', url: '/v1/account/state', headers: { ...bearer(a.accessToken), 'x-wayvro-mode': 'driver', 'x-role': 'DRIVER' } })
      ).json(),
    );
    expect(state.account).toMatchObject({ displayName: 'Synthetic Rider', preferredLocale: 'ur-Latn' });
    expect(state.riderProfile.id).not.toBe(state.account.id);
    // P2.5 added the server-truth driver section and in-force restrictions additively (never capabilities, V02)
    expect(Object.keys(state).sort()).toEqual(['account', 'driver', 'requiredActions', 'restrictions', 'riderProfile', 'session']);
    expect((await h.inject({ method: 'GET', url: '/v1/account/state', headers: { 'x-wayvro-mode': 'driver' } })).statusCode).toBe(401);
  });
});

describe('idempotency (F-03)', () => {
  it('IDEM-01 same key + same request replays (one SMS); same key + different request is a conflict', async () => {
    const phone = syntheticPhone();
    const inst = installation();
    const k = key();
    const body = { phone, purpose: 'SIGN_IN', installationId: inst, locale: 'en' };
    const first = await h.inject({ method: 'POST', url: '/v1/auth/otp-challenges', payload: body, headers: { 'idempotency-key': k } });
    const again = await h.inject({ method: 'POST', url: '/v1/auth/otp-challenges', payload: body, headers: { 'idempotency-key': k } });
    expect(again.json()).toEqual(first.json());
    expect(again.headers['idempotent-replayed']).toBe('true');
    await h.deliver();
    expect(h.sink.messagesFor(phone, 10)).toHaveLength(1);
    const conflict = await h.inject({ method: 'POST', url: '/v1/auth/otp-challenges', payload: { ...body, locale: 'ur' }, headers: { 'idempotency-key': k } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'WAYVRO_E_IDEMPOTENCY_CONFLICT' } });
  });

  it('IDEM-02 a replayed error keeps its code but carries the new request id; responses are stored encrypted', async () => {
    const phone = syntheticPhone();
    const inst = installation();
    const id = await requestCode(h, phone, inst);
    const k = key();
    const payload = { challengeId: id, code: '999999' === codeFor(h, phone) ? '999998' : '999999', installationId: inst, device };
    const a = await h.inject({ method: 'POST', url: '/v1/auth/sessions', payload, headers: { 'idempotency-key': k, 'x-request-id': 'req-first-0001' } });
    const b = await h.inject({ method: 'POST', url: '/v1/auth/sessions', payload, headers: { 'idempotency-key': k, 'x-request-id': 'req-second-002' } });
    expect(a.json().error.code).toBe(b.json().error.code);
    expect(b.json().error.requestId).toBe('req-second-002');
    // The replayed failure did not count a second attempt.
    expect((await h.owner.query<{ attempts: number }>(`select attempts from identity.otp_challenges where id = $1`, [id])).rows[0]?.attempts).toBe(1);
    const stored = await h.owner.query<{ e: Buffer }>(`select response_envelope e from platform.idempotency_records where idempotency_key = $1`, [k]);
    expect(stored.rows[0]?.e[0]).toBe(0x01);
    expect(stored.rows[0]?.e.toString('latin1')).not.toContain('WAYVRO_E_');
  });
});

describe('S12 signal recording and audit', () => {
  it('S12-01 a dormant account signing in from an unknown installation records a risk signal and is review-restricted (P2.9)', async () => {
    const a = await signIn(h);
    await h.owner.query(
      `update identity.accounts set last_active_at = now() - interval '120 days' where id = (select account_id from identity.sessions where id = $1)`,
      [a.sessionId],
    );
    const b = await signIn(h, a.phone);
    // the new session is restricted to the dormant-number review (P2.9; account-security tests cover the flow)
    expect((await get('/v1/account/security-events', b.accessToken)).statusCode).toBe(403);
    const types = await h.owner.query<{ type: string }>(
      `select type from identity.security_events where account_id = (select account_id from identity.sessions where id = $1)`,
      [b.sessionId],
    );
    expect(types.rows.map((e) => e.type)).toContain('DORMANT_ACCOUNT_NEW_INSTALLATION');
    expect((await h.owner.query(`select 1 from audit.audit_events where action = 'RECYCLED_NUMBER_SIGNAL'`)).rowCount).toBeGreaterThanOrEqual(1);
    // A known installation does not raise it.
    await h.owner.query(
      `update identity.accounts set last_active_at = now() - interval '120 days' where id = (select account_id from identity.sessions where id = $1)`,
      [a.sessionId],
    );
    const before = (await h.owner.query(`select 1 from identity.security_events where type = 'DORMANT_ACCOUNT_NEW_INSTALLATION'`)).rowCount;
    await signIn(h, a.phone, a.installationId);
    expect((await h.owner.query(`select 1 from identity.security_events where type = 'DORMANT_ACCOUNT_NEW_INSTALLATION'`)).rowCount).toBe(before);
  });

  it('SEC-AUDIT-01 security-relevant transitions are audited with ids and codes only', async () => {
    const a = await signIn(h);
    const rows = await h.owner.query<{ action: string }>(`select distinct action from audit.audit_events`);
    expect(rows.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['OTP_CHALLENGE_ISSUED', 'OTP_VERIFICATION', 'ACCOUNT_CREATED', 'SESSION_CREATED']));
    const dump = await h.owner.query<{ t: string }>(`select string_agg(row_to_json(a)::text, '|') t from audit.audit_events a`);
    for (const secret of [a.phone, a.phone.slice(3), a.accessToken, a.refreshToken, a.installationId]) expect(dump.rows[0]?.t).not.toContain(secret);
  });
});

describe('SEC-LOG canaries', () => {
  it('SEC-LOG-01 synthetic phone, code, tokens and installation ids never reach logs or error bodies', async () => {
    h.logs.clear();
    const phone = syntheticPhone();
    const inst = installation();
    const id = await requestCode(h, phone, inst);
    const code = codeFor(h, phone);
    const bad = await h.inject(post('/v1/auth/sessions', { challengeId: id, code: code === '111111' ? '111112' : '111111', installationId: inst, device }));
    const ok = await h.inject(post('/v1/auth/sessions', { challengeId: id, code, installationId: inst, device }));
    const tokens = ok.json<{ accessToken: string; refreshToken: string }>();
    await refresh(tokens.refreshToken);
    await refresh(tokens.refreshToken);
    await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer('wva_' + 'Z'.repeat(43)) });
    const everything = h.logs.text() + bad.body;
    for (const canary of [phone, phone.slice(3), `0${phone.slice(3)}`, code, tokens.accessToken, tokens.refreshToken, inst])
      expect(everything).not.toContain(canary);
  });
});
