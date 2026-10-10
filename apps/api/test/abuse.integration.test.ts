/**
 * SEC-OTP abuse controls and fail-closed behaviour (K08/Q06/T-01): silent drops, per-installation and failed-challenge
 * limits, spend budget, limiter outage, missing delivery adapter, provider outage. Each scenario gets its own harness
 * (own database and rate-limit namespace) so limits are exercised deterministically.
 */
import { OtpChallengeSchema } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { codeFor, device, installation, post, requestCode, startApi, syntheticPhone, type Harness } from './support.js';

const otpBody = (phone: string, installationId: string) => ({ phone, purpose: 'SIGN_IN', installationId, locale: 'ur' });
async function withApi(options: Parameters<typeof startApi>[0], fn: (h: Harness) => Promise<void>): Promise<void> {
  const h = await startApi(options);
  try {
    await fn(h);
  } finally {
    await h.close();
  }
}

describe('SEC-OTP abuse controls', () => {
  it('SEC-OTP-07 per-phone limit: further requests get the identical 202 shape but are silently dropped and unverifiable', async () => {
    await withApi({ env: { OTP_PHONE_SENDS_PER_HOUR: '2' } }, async (h) => {
      const phone = syntheticPhone();
      const shapes: string[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await h.inject(post('/v1/auth/otp-challenges', otpBody(phone, installation())));
        expect(res.statusCode).toBe(202);
        shapes.push(Object.keys(OtpChallengeSchema.parse(res.json())).sort().join(','));
      }
      expect(new Set(shapes).size).toBe(1);
      await h.deliver();
      expect(h.sink.messagesFor(phone, 10)).toHaveLength(2);
      const suppressed = await h.owner.query<{ id: string; installation_hash: Buffer }>(
        `select id, installation_hash from identity.otp_challenges where status = 'SUPPRESSED'`,
      );
      expect(suppressed.rowCount).toBe(2);
      const audit = await h.owner.query(`select 1 from audit.audit_events where action = 'OTP_CHALLENGE_SUPPRESSED' and reason_code = 'PHONE_SEND_LIMIT'`);
      expect(audit.rowCount).toBe(2);
    });
  });

  it('SEC-OTP-08 per-installation daily limit answers 429 with Retry-After', async () => {
    await withApi({ env: { OTP_INSTALLATION_SENDS_PER_DAY: '2' } }, async (h) => {
      const inst = installation();
      for (let i = 0; i < 2; i++) expect((await h.inject(post('/v1/auth/otp-challenges', otpBody(syntheticPhone(), inst)))).statusCode).toBe(202);
      const res = await h.inject(post('/v1/auth/otp-challenges', otpBody(syntheticPhone(), inst)));
      expect(res.statusCode).toBe(429);
      expect(res.json()).toMatchObject({ error: { code: 'WAYVRO_E_RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) } } });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  it('SEC-OTP-15 verification attempts per installation are rate limited (429), on top of the per-challenge lock', async () => {
    await withApi({ env: { OTP_VERIFY_ATTEMPTS_PER_INSTALLATION_HOUR: '3' } }, async (h) => {
      const inst = installation();
      const attempt = () =>
        h.inject(post('/v1/auth/sessions', { challengeId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b', code: '123456', installationId: inst, device }));
      for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
      const limited = await attempt();
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ error: { code: 'WAYVRO_E_RATE_LIMITED' } });
    });
  });

  it('SEC-OTP-09 a phone whose challenges keep getting locked enters a silent cooldown', async () => {
    await withApi({ env: { OTP_PHONE_FAILED_CHALLENGES_PER_DAY: '2' } }, async (h) => {
      const phone = syntheticPhone();
      for (let round = 0; round < 2; round++) {
        const inst = installation();
        const id = await requestCode(h, phone, inst);
        const code = codeFor(h, phone);
        const bad = String((Number(code) + 7) % 1_000_000).padStart(6, '0');
        for (let i = 0; i < 5; i++) await h.inject(post('/v1/auth/sessions', { challengeId: id, code: bad, installationId: inst, device }));
      }
      const sentBefore = h.sink.messagesFor(phone, 50).length;
      const res = await h.inject(post('/v1/auth/otp-challenges', otpBody(phone, installation())));
      expect(res.statusCode).toBe(202);
      await h.deliver();
      expect(h.sink.messagesFor(phone, 50)).toHaveLength(sentBefore);
      expect((await h.owner.query(`select 1 from audit.audit_events where reason_code = 'PHONE_COOLDOWN'`)).rowCount).toBe(1);
    });
  });

  it('SEC-OTP-10 the global send budget stops new sends with 503 (never verification without a code)', async () => {
    await withApi({ env: { OTP_DAILY_SEND_BUDGET: '2' } }, async (h) => {
      for (let i = 0; i < 2; i++) expect((await h.inject(post('/v1/auth/otp-challenges', otpBody(syntheticPhone(), installation())))).statusCode).toBe(202);
      const res = await h.inject(post('/v1/auth/otp-challenges', otpBody(syntheticPhone(), installation())));
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: { code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE' } });
      expect(h.logs.text()).toContain('OTP_BUDGET_EXHAUSTED');
      expect(h.logs.text()).toContain('OTP_BUDGET_THRESHOLD');
    });
  });

  it('SEC-OTP-11 operator-prefix conversion monitor alerts and applies friction', async () => {
    await withApi(
      {
        env: {
          OTP_PREFIX_MONITOR_MIN_SENDS: '3',
          OTP_PREFIX_MIN_CONVERSION_PERCENT: '50',
          OTP_PREFIX_ELEVATED_SENDS_PER_MINUTE: '1',
          OTP_PHONE_SENDS_PER_HOUR: '100',
        },
      },
      async (h) => {
        for (let i = 0; i < 3; i++) await h.inject(post('/v1/auth/otp-challenges', otpBody(syntheticPhone(), installation())));
        const shapes = [];
        for (let i = 0; i < 3; i++) shapes.push((await h.inject(post('/v1/auth/otp-challenges', otpBody(syntheticPhone(), installation())))).statusCode);
        expect(shapes).toEqual([202, 202, 202]);
        expect(h.logs.text()).toContain('OTP_PREFIX_LOW_CONVERSION');
        expect((await h.owner.query(`select 1 from audit.audit_events where reason_code = 'PREFIX_FRICTION'`)).rowCount).toBeGreaterThanOrEqual(1);
      },
    );
  });
});

describe('fail-closed behaviour', () => {
  it('SEC-OTP-12 limiter (Valkey) outage: no challenge, no SMS, honest 503; verification also fails closed', async () => {
    await withApi({ env: { REDIS_URL: 'redis://127.0.0.1:1' } }, async (h) => {
      const res = await h.inject(post('/v1/auth/otp-challenges', otpBody(syntheticPhone(), installation())));
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: { code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE' } });
      await h.deliver();
      expect(h.sink.sent).toHaveLength(0);
      expect((await h.owner.query(`select 1 from identity.otp_challenges`)).rowCount).toBe(0);
      const verify = await h.inject(
        post('/v1/auth/sessions', { challengeId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b', code: '123456', installationId: installation(), device }),
      );
      expect(verify.statusCode).toBe(503);
      expect((await h.inject({ method: 'GET', url: '/v1/health/ready' })).statusCode).toBe(503);
    });
  });

  it('SEC-OTP-13 no OTP delivery adapter bound (production-like composition): 503 for every number', async () => {
    await withApi({ otpDelivery: false }, async (h) => {
      const res = await h.inject(post('/v1/auth/otp-challenges', otpBody(syntheticPhone(), installation())));
      expect(res.statusCode).toBe(503);
      expect((await h.owner.query(`select 1 from identity.otp_challenges`)).rowCount).toBe(0);
    });
  });

  it('SEC-OTP-14 provider outage: bounded retries, DELIVERY_FAILED, the code never verifies, resend is possible', async () => {
    await withApi({}, async (h) => {
      h.sink.failNext(10);
      const phone = syntheticPhone();
      const inst = installation();
      const res = await h.inject(post('/v1/auth/otp-challenges', otpBody(phone, inst)));
      const { challengeId } = OtpChallengeSchema.parse(res.json());
      for (let i = 0; i < 3; i++) {
        await h.owner.query(`update platform.jobs set run_after = now() where status = 'QUEUED'`);
        await h.deliver();
      }
      expect((await h.owner.query<{ status: string }>(`select status from identity.otp_challenges where id = $1`, [challengeId])).rows[0]?.status).toBe(
        'DELIVERY_FAILED',
      );
      const verify = await h.inject(post('/v1/auth/sessions', { challengeId, code: '000000', installationId: inst, device }));
      expect(verify.json()).toMatchObject({ error: { code: 'WAYVRO_E_OTP_INVALID_OR_EXPIRED' } });
      h.sink.failNext(0);
      await h.owner.query(`update identity.otp_challenges set next_resend_at = now() where id = $1`, [challengeId]);
      expect((await h.inject(post(`/v1/auth/otp-challenges/${challengeId}/resends`, { installationId: inst }))).statusCode).toBe(202);
      await h.deliver();
      expect(h.sink.messagesFor(phone)).toHaveLength(1);
      expect(h.sink.messagesFor(phone)[0]?.message).toContain('Wayvro');
    });
  });
});
