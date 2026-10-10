/**
 * OTP delivery job (recording sink — never EG-01 evidence) and authoritative session verification as the restricted
 * realtime role (SEC-RT/K09 primitives).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createLogger } from '@wayvro/observability';
import { RecordingOtpDelivery } from '@wayvro/provider-test-doubles';
import { JobRunner, enqueueJob, uuidv7 } from '@wayvro/server-runtime';
import { captureLogs } from '@wayvro/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ENCRYPTED_FIELDS,
  OTP_DELIVER_JOB,
  fieldContext,
  hashToken,
  keyRotationJob,
  newOpaqueToken,
  otpDeliveryJob,
  sealOtpDelivery,
  verifyAccessToken,
} from '../src/index.js';
import { crypto, harness, seedOwner, syntheticPhone, type Harness } from './helpers.js';

const logs = captureLogs();
const log = createLogger({ service: 'worker', env: 'test', level: 'info', destination: logs.stream });
const c = crypto();
let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => {
  await h.close();
});

async function challenge(status = 'ISSUED', expiresIn = '5 minutes'): Promise<{ challengeId: string; phone: `+92${string}` }> {
  const challengeId = uuidv7();
  const phone = syntheticPhone();
  const d = c.lookup.activeDigest(phone);
  await h.api.query(
    `insert into identity.otp_challenges (id, purpose, phone_lookup_key_version, phone_lookup_hash, phone_envelope, code_mac, mac_key_version, channel, locale, installation_hash, status, max_attempts, next_resend_at, expires_at)
     values ($1, 'SIGN_IN', $2, $3, $4, $5, 1, 'SMS', 'en', $6, $7, 5, now(), now() + $8::interval)`,
    [
      challengeId,
      d.version,
      d.digest,
      c.cipher.encrypt('contact', phone, fieldContext(ENCRYPTED_FIELDS.challengePhone, challengeId)),
      randomBytes(32),
      randomBytes(32),
      status,
      expiresIn,
    ],
  );
  return { challengeId, phone };
}

async function enqueueDelivery(challengeId: string, phone: `+92${string}`, code = '482913'): Promise<string> {
  const jobId = uuidv7();
  await enqueueJob(h.api, {
    id: jobId,
    type: OTP_DELIVER_JOB,
    payload: { challengeId },
    sealedPayload: sealOtpDelivery(c.cipher, jobId, { to: phone, code, locale: 'en', ttlMinutes: 5 }),
    maxAttempts: 2,
  });
  return jobId;
}

describe('otp.deliver job', () => {
  it('delivers once through the bound port, records the provider reference and purges the sealed payload', async () => {
    const sink = new RecordingOtpDelivery();
    const { challengeId, phone } = await challenge();
    const jobId = await enqueueDelivery(challengeId, phone);
    const runner = new JobRunner(h.worker, [otpDeliveryJob({ db: h.worker, cipher: c.cipher, port: sink })], {
      workerId: 'otp',
      leaseMs: 30000,
      batchSize: 10,
      log,
    });
    await runner.runOnce();
    expect(sink.messagesFor(phone)).toHaveLength(1);
    expect(sink.messagesFor(phone)[0]?.message).toContain('482913');
    const row = (await h.owner.query(`select provider_message_ref from identity.otp_challenges where id = $1`, [challengeId])).rows[0];
    expect(row.provider_message_ref).toMatch(/^local-recording-/);
    const job = (await h.owner.query(`select status, sealed_payload from platform.jobs where id = $1`, [jobId])).rows[0];
    expect(job).toEqual({ status: 'SUCCEEDED', sealed_payload: null });
    // A redelivered job for an already delivered challenge is a no-op.
    await enqueueDelivery(challengeId, phone);
    await runner.runOnce();
    expect(sink.messagesFor(phone)).toHaveLength(1);
    expect(logs.text()).not.toContain('482913');
    expect(logs.text()).not.toContain(phone);
  });

  it('skips superseded or expired challenges', async () => {
    const sink = new RecordingOtpDelivery();
    const superseded = await challenge('SUPERSEDED');
    const expired = await challenge('ISSUED', '1 millisecond');
    await enqueueDelivery(superseded.challengeId, superseded.phone);
    await enqueueDelivery(expired.challengeId, expired.phone);
    await new Promise((r) => setTimeout(r, 20));
    await new JobRunner(h.worker, [otpDeliveryJob({ db: h.worker, cipher: c.cipher, port: sink })], {
      workerId: 'otp2',
      leaseMs: 30000,
      batchSize: 10,
      log,
    }).runOnce();
    expect(sink.sent).toHaveLength(0);
  });

  it('an outage exhausts bounded retries, then marks the challenge DELIVERY_FAILED (never verified without a code)', async () => {
    const sink = new RecordingOtpDelivery();
    sink.failNext(5);
    const { challengeId, phone } = await challenge();
    await enqueueDelivery(challengeId, phone);
    const runner = new JobRunner(h.worker, [otpDeliveryJob({ db: h.worker, cipher: c.cipher, port: sink })], {
      workerId: 'otp3',
      leaseMs: 30000,
      batchSize: 10,
      log,
      random: () => 0,
    });
    await runner.runOnce();
    await runner.runOnce();
    const status = (await h.owner.query(`select status from identity.otp_challenges where id = $1`, [challengeId])).rows[0];
    expect(status.status).toBe('DELIVERY_FAILED');
    const job = (await h.owner.query(`select status, last_error_code from platform.jobs where payload->>'challengeId' = $1`, [challengeId])).rows[0];
    expect(job).toEqual({ status: 'DEAD', last_error_code: 'PROVIDER_SEND_FAILED' });
  });

  it('a sealed payload moved to another job fails authentication (AAD binds the job id)', async () => {
    const sink = new RecordingOtpDelivery();
    const { challengeId, phone } = await challenge();
    const otherJobId = uuidv7();
    await enqueueJob(h.api, {
      type: OTP_DELIVER_JOB,
      payload: { challengeId },
      sealedPayload: sealOtpDelivery(c.cipher, otherJobId, { to: phone, code: '111111', locale: 'ur', ttlMinutes: 5 }),
      maxAttempts: 1,
    });
    await new JobRunner(h.worker, [otpDeliveryJob({ db: h.worker, cipher: c.cipher, port: sink })], {
      workerId: 'otp4',
      leaseMs: 30000,
      batchSize: 10,
      log,
    }).runOnce();
    expect(sink.sent).toHaveLength(0);
    const job = (await h.owner.query(`select status, last_error_code from platform.jobs where payload->>'challengeId' = $1`, [challengeId])).rows[0];
    expect(job).toEqual({ status: 'DEAD', last_error_code: 'SEALED_PAYLOAD_INVALID' });
  });
});

describe('job input validation (fail closed with stable codes)', () => {
  const job = (over: Partial<{ id: string; type: string; payload: Record<string, unknown>; sealedPayload: Buffer | null }>) => ({
    id: uuidv7(),
    type: OTP_DELIVER_JOB,
    payload: {},
    sealedPayload: null,
    attempts: 1,
    maxAttempts: 1,
    ...over,
  });
  it('rejects missing ids, missing/invalid sealed payloads and malformed secrets', async () => {
    const handler = otpDeliveryJob({ db: h.worker, cipher: c.cipher, port: new RecordingOtpDelivery() });
    await expect(handler.handler(job({}))).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
    const { challengeId } = await challenge();
    await expect(handler.handler(job({ payload: { challengeId } }))).rejects.toMatchObject({ code: 'SEALED_PAYLOAD_MISSING' });
    const id = uuidv7();
    const notASecret = c.cipher.encrypt('job_secrets', JSON.stringify({ to: '+15550100', code: 'x' }), fieldContext(ENCRYPTED_FIELDS.jobSecret, id));
    await expect(handler.handler(job({ id, payload: { challengeId }, sealedPayload: notASecret }))).rejects.toMatchObject({ code: 'SEALED_PAYLOAD_INVALID' });
    const notJson = c.cipher.encrypt('job_secrets', 'not json', fieldContext(ENCRYPTED_FIELDS.jobSecret, id));
    await expect(handler.handler(job({ id, payload: { challengeId }, sealedPayload: notJson }))).rejects.toMatchObject({ code: 'SEALED_PAYLOAD_INVALID' });
  });

  it('a key-rotation job without a rotation id fails', async () => {
    const rotation = keyRotationJob({ db: h.worker, ring: c.ring, cipher: c.cipher, hasher: c.hasher, log, batchSize: 1 });
    await expect(rotation.handler(job({ type: 'crypto.key-rotation' }))).rejects.toThrow(/rotationId/);
    await expect(rotation.handler(job({ payload: { rotationId: randomUUID() } }))).rejects.toThrow(/not found/);
  });
});

describe('session verification (as the realtime role)', () => {
  async function session(over: { status?: string; accessIn?: string; idleIn?: string; absoluteIn?: string } = {}): Promise<string> {
    const { accountId } = await seedOwner(h.api, c, syntheticPhone());
    const deviceId = randomUUID();
    await h.api.query(
      `insert into identity.account_devices (id, account_id, installation_hash, platform, app_version, first_verified_at, last_seen_at, trust_state) values ($1, $2, $3, 'ANDROID', '1.0.0', now(), now(), 'NEW')`,
      [deviceId, accountId, randomBytes(32)],
    );
    const token = newOpaqueToken('access');
    const revoked = over.status === 'REVOKED';
    await h.api.query(
      `insert into identity.sessions (id, account_id, device_id, status, assurance, access_token_hash, access_expires_at, idle_expires_at, absolute_expires_at, app_version, revoked_at, revoke_reason)
       values ($1, $2, $3, $4, 'OTP', $5, now() + $6::interval, now() + $7::interval, now() + $8::interval, '1.0.0', $9, $10)`,
      [
        randomUUID(),
        accountId,
        deviceId,
        over.status ?? 'ACTIVE',
        hashToken(token),
        over.accessIn ?? '15 minutes',
        over.idleIn ?? '60 days',
        over.absoluteIn ?? '180 days',
        revoked ? new Date() : null,
        revoked ? 'USER_LOGOUT' : null,
      ],
    );
    return token;
  }

  it('accepts a live session and rejects revoked, expired, idle-expired, refresh and malformed tokens', async () => {
    expect(await verifyAccessToken(h.realtime, await session())).toMatchObject({ accountId: expect.any(String), sessionId: expect.any(String) });
    expect(await verifyAccessToken(h.realtime, await session({ status: 'REVOKED' }))).toBeNull();
    expect(await verifyAccessToken(h.realtime, await session({ accessIn: '-1 second' }))).toBeNull();
    expect(await verifyAccessToken(h.realtime, await session({ idleIn: '-1 second', accessIn: '-2 seconds' }))).toBeNull();
    expect(await verifyAccessToken(h.realtime, newOpaqueToken('access'))).toBeNull();
    expect(await verifyAccessToken(h.realtime, newOpaqueToken('refresh'))).toBeNull();
    expect(await verifyAccessToken(h.realtime, 'not-a-token')).toBeNull();
  });
});
