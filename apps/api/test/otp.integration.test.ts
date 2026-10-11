/**
 * SEC-OTP, PROP-OTP, CONC-OTP and SEC-ENUM against real PostgreSQL + Valkey, API connected as the restricted
 * `wayvro_api` role. Delivery uses the recording sink (never EG-01 evidence).
 */
import { ErrorEnvelopeSchema, OtpChallengeSchema, SessionCreatedSchema } from '@wayvro/contracts';
import { race } from '@wayvro/test-support';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, codeFor, device, installation, key, post, requestCode, signIn, startApi, syntheticPhone, type Harness } from './support.js';

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

const otpBody = (phone: string, installationId: string) => ({ phone, purpose: 'SIGN_IN', installationId, locale: 'en' });
const verify = (challengeId: string, code: string, installationId: string, headers: Record<string, string> = {}) =>
  h.inject(post('/v1/auth/sessions', { challengeId, code, installationId, device }, headers));
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
const challengeRow = async (id: string) =>
  (
    await h.owner.query<{ status: string; attempts: number; code_mac: Buffer | null }>(
      `select status, attempts, code_mac from identity.otp_challenges where id = $1`,
      [id],
    )
  ).rows[0];

describe('SEC-OTP: issuance', () => {
  it('SEC-OTP-01 rejects non-Pakistani, landline and malformed numbers with VALIDATION before any send', async () => {
    const before = h.sink.sent.length;
    for (const phone of ['+14155550100', '042 35761234', '0300-123', 'not a phone', '+92 3OO 1234567']) {
      const res = await h.inject(post('/v1/auth/otp-challenges', otpBody(phone, installation())));
      expect(res.statusCode, phone).toBe(400);
      expect(ErrorEnvelopeSchema.parse(res.json()).error.code).toBe('WAYVRO_E_VALIDATION');
    }
    await h.deliver();
    expect(h.sink.sent.length).toBe(before);
  });

  it('SEC-OTP-02 issues a random 6-digit code; only its MAC is stored; never in the database, jobs, audit or logs', async () => {
    const phone = syntheticPhone();
    const inst = installation();
    const res = await h.inject(post('/v1/auth/otp-challenges', otpBody(phone, inst)));
    expect(res.statusCode).toBe(202);
    const body = OtpChallengeSchema.parse(res.json());
    expect(body.maskedDestination).toBe(`+92 3** *** **${phone.slice(-2)}`);
    expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(240_000);
    await h.deliver();
    const code = codeFor(h, phone);
    expect(code).toMatch(/^\d{6}$/);
    const row = await challengeRow(body.challengeId);
    expect(row?.code_mac).toHaveLength(32);
    const dump = await h.owner.query<{ t: string }>(
      `select string_agg(t, '|') t from (
         select row_to_json(c)::text t from identity.otp_challenges c
         union all select row_to_json(j)::text from platform.jobs j
         union all select row_to_json(a)::text from audit.audit_events a) x`,
    );
    for (const secret of [code, phone, phone.slice(3), inst]) expect(dump.rows[0]?.t ?? '').not.toContain(secret);
    expect(h.logs.text()).not.toContain(code);
    expect(h.logs.text()).not.toContain(phone.slice(3));
  });

  it('SEC-OTP-03 no master/universal code: codes of independent challenges are independent and random (sanity)', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 20; i++) {
      const phone = syntheticPhone();
      await requestCode(h, phone, installation());
      codes.push(codeFor(h, phone));
    }
    expect(new Set(codes).size).toBeGreaterThanOrEqual(19);
  });
});

describe('SEC-OTP / PROP-OTP: verification', () => {
  it('SEC-OTP-04 five wrong codes lock the challenge; the right code is then refused', async () => {
    const phone = syntheticPhone();
    const inst = installation();
    const id = await requestCode(h, phone, inst);
    const code = codeFor(h, phone);
    for (let i = 1; i <= 4; i++) expect((await verify(id, wrong(code), inst)).json()).toMatchObject({ error: { code: 'WAYVRO_E_OTP_INVALID_OR_EXPIRED' } });
    expect((await verify(id, wrong(code), inst)).json()).toMatchObject({ error: { code: 'WAYVRO_E_OTP_LOCKED' } });
    const res = await verify(id, code, inst);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'WAYVRO_E_OTP_LOCKED' } });
    expect(await challengeRow(id)).toMatchObject({ status: 'LOCKED', attempts: 5 });
  });

  it('SEC-OTP-05 expired, consumed, superseded and foreign-installation challenges all answer one generic 401', async () => {
    const phone = syntheticPhone();
    const inst = installation();
    const expired = await requestCode(h, phone, inst);
    const expiredCode = codeFor(h, phone);
    await h.owner.query(
      `update identity.otp_challenges set created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second' where id = $1`,
      [expired],
    );
    expect((await verify(expired, expiredCode, inst)).json()).toMatchObject({ error: { code: 'WAYVRO_E_OTP_INVALID_OR_EXPIRED' } });
    expect((await challengeRow(expired))?.status).toBe('EXPIRED');

    const first = await requestCode(h, phone, inst);
    const firstCode = codeFor(h, phone);
    const second = await requestCode(h, phone, inst);
    const secondCode = codeFor(h, phone);
    expect((await challengeRow(first))?.status).toBe('SUPERSEDED');
    expect((await verify(first, firstCode, inst)).json()).toMatchObject({ error: { code: 'WAYVRO_E_OTP_INVALID_OR_EXPIRED' } });
    // Another installation cannot use (or burn attempts on) someone else's challenge.
    expect((await verify(second, secondCode, installation())).json()).toMatchObject({ error: { code: 'WAYVRO_E_OTP_INVALID_OR_EXPIRED' } });
    expect((await challengeRow(second))?.attempts).toBe(0);
    expect((await verify(second, secondCode, inst)).statusCode).toBe(201);
    // Replay of a consumed code with a new Idempotency-Key.
    expect((await verify(second, secondCode, inst)).json()).toMatchObject({ error: { code: 'WAYVRO_E_OTP_INVALID_OR_EXPIRED' } });
    expect((await verify('0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b', '123456', inst)).json()).toMatchObject({ error: { code: 'WAYVRO_E_OTP_INVALID_OR_EXPIRED' } });
  });

  it('PROP-OTP-01 any sequence of wrong/right attempts yields at most one session, only if the right code comes before the lock (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), async (attempts) => {
        const phone = syntheticPhone();
        const inst = installation();
        const id = await requestCode(h, phone, inst);
        const code = codeFor(h, phone);
        let sessions = 0;
        let wrongs = 0;
        let expectedSuccess = false;
        for (const right of attempts) {
          if (!expectedSuccess && right && wrongs < 5) expectedSuccess = true;
          if (!right && !expectedSuccess) wrongs++;
          const res = await verify(id, right ? code : wrong(code), inst);
          if (res.statusCode === 201) sessions++;
        }
        return sessions === (expectedSuccess ? 1 : 0);
      }),
      { numRuns: 12 },
    );
  });
});

describe('SEC-OTP: resend', () => {
  it('SEC-OTP-06 resend honours the escalating cooldown and the resend cap, and supersedes the previous code', async () => {
    const phone = syntheticPhone();
    const inst = installation();
    const id = await requestCode(h, phone, inst);
    const early = await h.inject(post(`/v1/auth/otp-challenges/${id}/resends`, { installationId: inst }));
    expect(early.statusCode).toBe(429);
    expect(Number(early.headers['retry-after'])).toBeGreaterThan(0);
    let current = id;
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      await h.owner.query(`update identity.otp_challenges set next_resend_at = now() - interval '1 second' where id = $1`, [current]);
      const res = await h.inject(post(`/v1/auth/otp-challenges/${current}/resends`, { installationId: inst }));
      expect(res.statusCode).toBe(202);
      const next = OtpChallengeSchema.parse(res.json());
      waits.push(Math.round((Date.parse(next.resendAvailableAt) - Date.now()) / 1000));
      expect((await challengeRow(current))?.status).toBe('SUPERSEDED');
      current = next.challengeId;
    }
    expect(waits[0]).toBeGreaterThan(100);
    expect(waits[1]).toBeGreaterThan(250);
    await h.owner.query(`update identity.otp_challenges set next_resend_at = now() - interval '1 second' where id = $1`, [current]);
    const capped = await h.inject(post(`/v1/auth/otp-challenges/${current}/resends`, { installationId: inst }));
    expect(capped.statusCode).toBe(429);
    // Foreign installation or unknown challenge: the same generic error.
    const foreign = await h.inject(post(`/v1/auth/otp-challenges/${current}/resends`, { installationId: installation() }));
    const unknown = await h.inject(post(`/v1/auth/otp-challenges/0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b/resends`, { installationId: inst }));
    expect(foreign.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(foreign.json().error.code).toBe(unknown.json().error.code);
  });
});

describe('CONC-OTP', () => {
  it('CONC-OTP-01 50 concurrent correct verifications of one challenge create exactly one session', async () => {
    const phone = syntheticPhone();
    const inst = installation();
    const id = await requestCode(h, phone, inst);
    const code = codeFor(h, phone);
    const results = await race(50, () => Promise.resolve(() => verify(id, code, inst)));
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.statusCode : 0));
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 401)).toHaveLength(49);
    const sessions = await h.owner.query(
      `select count(*)::int n from identity.sessions s join identity.account_phones p on p.account_id = s.account_id where p.phone_last4 = $1 and s.created_at > now() - interval '1 minute'`,
      [phone.slice(-4)],
    );
    expect(sessions.rows[0]?.n).toBe(1);
  });

  it('CONC-OTP-02 concurrent FIRST sign-ins for one new phone from 10 installations converge on exactly one account', async () => {
    const phone = syntheticPhone();
    const prepared: Array<{ inst: string; id: string; code: string }> = [];
    for (let i = 0; i < 10; i++) {
      const inst = installation();
      const id = await requestCode(h, phone, inst);
      prepared.push({ inst, id, code: codeFor(h, phone) });
    }
    const results = await race(10, (i) => {
      const p = prepared[i];
      if (!p) throw new Error('prep');
      return Promise.resolve(() => verify(p.id, p.code, p.inst));
    });
    const ok = results.flatMap((r) => (r.status === 'fulfilled' && r.value.statusCode === 201 ? [SessionCreatedSchema.parse(r.value.json())] : []));
    expect(ok).toHaveLength(10);
    expect(ok.filter((s) => s.isNewAccount)).toHaveLength(1);
    const accounts = new Set<string>();
    for (const s of ok) accounts.add((await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(s.accessToken) })).json().account.id as string);
    expect(accounts.size).toBe(1);
    const owners = await h.owner.query(
      `select count(*)::int n from identity.phone_lookup_index l join identity.account_phones p on p.id = l.account_phone_id where l.is_current_owner and p.account_id = $1`,
      [[...accounts][0]],
    );
    expect(owners.rows[0]?.n).toBe(1);
  });

  it('CONC-OTP-03 the same Idempotency-Key repeated concurrently yields one session and identical replays', async () => {
    const phone = syntheticPhone();
    const inst = installation();
    const id = await requestCode(h, phone, inst);
    const code = codeFor(h, phone);
    const sameKey = key();
    const results = await race(10, () => Promise.resolve(() => verify(id, code, inst, { 'idempotency-key': sameKey })));
    const bodies = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    expect(bodies.every((b) => b?.statusCode === 201)).toBe(true);
    expect(new Set(bodies.map((b) => b?.json().sessionId as string)).size).toBe(1);
    expect(bodies.filter((b) => b?.headers['idempotent-replayed'] === 'true')).toHaveLength(9);
  });
});

describe('SEC-ENUM', () => {
  it('SEC-ENUM-01 existing and absent accounts get identical OTP responses (status, keys, headers, masked shape)', async () => {
    const existing = await signIn(h);
    const absent = syntheticPhone();
    const a = await h.inject(post('/v1/auth/otp-challenges', otpBody(existing.phone, installation())));
    const b = await h.inject(post('/v1/auth/otp-challenges', otpBody(absent, installation())));
    expect(a.statusCode).toBe(b.statusCode);
    expect(Object.keys(a.json<object>()).sort()).toEqual(Object.keys(b.json<object>()).sort());
    expect(Object.keys(a.headers).sort()).toEqual(Object.keys(b.headers).sort());
    expect((a.json().maskedDestination as string).replace(/\d{2}$/, '')).toBe((b.json().maskedDestination as string).replace(/\d{2}$/, ''));
  });

  it('SEC-ENUM-02 a wrong code answers identically for an existing and a new account', async () => {
    const existing = await signIn(h);
    const instA = installation();
    const idA = await requestCode(h, existing.phone, instA);
    const instB = installation();
    const newPhone = syntheticPhone();
    const idB = await requestCode(h, newPhone, instB);
    const a = await verify(idA, wrong(codeFor(h, existing.phone)), instA);
    const b = await verify(idB, wrong(codeFor(h, newPhone)), instB);
    expect(a.statusCode).toBe(b.statusCode);
    expect({ ...a.json().error, requestId: '' }).toEqual({ ...b.json().error, requestId: '' });
  });

  it('SEC-ENUM-03 coarse timing: existing vs absent numbers do not differ grossly (no microsecond claim)', async () => {
    const existing = await signIn(h);
    const time = async (phone: string) => {
      const t = performance.now();
      await h.inject(post('/v1/auth/otp-challenges', otpBody(phone, installation())));
      return performance.now() - t;
    };
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 8; i++) {
      a.push(await time(existing.phone));
      b.push(await time(syntheticPhone()));
    }
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? 0;
    expect(Math.abs(median(a) - median(b))).toBeLessThan(100);
  });
});
