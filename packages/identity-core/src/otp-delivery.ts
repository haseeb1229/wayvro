/**
 * OTP delivery job (`otp.deliver`, ADR-042). The API generates the code, stores only its MAC and enqueues this job in
 * the same transaction; the destination and code travel in the job's sealed payload (AES-256-GCM, key class
 * `job_secrets`, AAD bound to the job id), which the runner purges when the job finishes.
 *
 * Idempotent: a challenge that is no longer ISSUED, has expired or already carries a provider reference is skipped.
 * At-least-once residual: a crash between the provider call and the reference update can re-send the same code once.
 * After the last attempt the challenge becomes DELIVERY_FAILED (honest outage; never "verified without OTP").
 * The real SMS/WhatsApp adapter is external gate EG-01; local runners bind the recording sink, which is never evidence.
 */
import type { FieldCipher } from '@wayvro/field-crypto';
import type { OtpDeliveryPort } from '@wayvro/provider-interfaces';
import { JobError, type ClaimedJob, type JobDefinition, type Queryable } from '@wayvro/server-runtime';
import { ENCRYPTED_FIELDS, fieldContext } from './fields.js';
import { OTP_LOCALES, renderOtpMessage, type OtpLocale } from './otp-messages.js';

export const OTP_DELIVER_JOB = 'otp.deliver';

export interface OtpDeliverySecret {
  readonly to: `+92${string}`;
  readonly code: string;
  readonly locale: OtpLocale;
  readonly ttlMinutes: number;
}

/** Seals the delivery secret for a job whose id the caller has already chosen (the AAD binds to it). */
export function sealOtpDelivery(cipher: FieldCipher, jobId: string, secret: OtpDeliverySecret): Buffer {
  return cipher.encrypt('job_secrets', JSON.stringify(secret), fieldContext(ENCRYPTED_FIELDS.jobSecret, jobId));
}

function openOtpDelivery(cipher: FieldCipher, job: ClaimedJob): OtpDeliverySecret {
  if (!job.sealedPayload) throw new JobError('SEALED_PAYLOAD_MISSING');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cipher.decryptString('job_secrets', job.sealedPayload, fieldContext(ENCRYPTED_FIELDS.jobSecret, job.id)));
  } catch (e) {
    throw new JobError('SEALED_PAYLOAD_INVALID', { cause: e });
  }
  const s = parsed as Partial<OtpDeliverySecret>;
  if (
    typeof s.to !== 'string' ||
    !/^\+923\d{9}$/.test(s.to) ||
    typeof s.code !== 'string' ||
    !(OTP_LOCALES as readonly unknown[]).includes(s.locale) ||
    typeof s.ttlMinutes !== 'number'
  ) {
    throw new JobError('SEALED_PAYLOAD_INVALID');
  }
  return s as OtpDeliverySecret;
}

export function otpDeliveryJob(deps: { readonly db: Queryable; readonly cipher: FieldCipher; readonly port: OtpDeliveryPort }): JobDefinition {
  const challengeIdOf = (job: ClaimedJob): string => {
    const id = job.payload['challengeId'];
    if (typeof id !== 'string') throw new JobError('PAYLOAD_INVALID');
    return id;
  };
  return {
    type: OTP_DELIVER_JOB,
    async handler(job) {
      const challengeId = challengeIdOf(job);
      const current = await deps.db.query<{ deliverable: boolean }>(
        `select status = 'ISSUED' and expires_at > now() and provider_message_ref is null deliverable from identity.otp_challenges where id = $1`,
        [challengeId],
      );
      if (current.rows[0]?.deliverable !== true) return;
      const secret = openOtpDelivery(deps.cipher, job);
      let providerMessageId: string;
      try {
        ({ providerMessageId } = await deps.port.send({
          to: secret.to,
          message: renderOtpMessage(secret.locale, secret.code, secret.ttlMinutes),
          channel: 'sms',
        }));
      } catch (e) {
        throw new JobError('PROVIDER_SEND_FAILED', { cause: e });
      }
      await deps.db.query(`update identity.otp_challenges set provider_message_ref = $2 where id = $1 and status = 'ISSUED'`, [
        challengeId,
        providerMessageId.slice(0, 200),
      ]);
    },
    async onDead(job) {
      await deps.db.query(`update identity.otp_challenges set status = 'DELIVERY_FAILED' where id = $1 and status = 'ISSUED'`, [challengeIdOf(job)]);
    },
  };
}
