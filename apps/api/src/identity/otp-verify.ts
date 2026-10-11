/**
 * One OTP verification for every purpose (A02/K08; auth design §3.2): challenge row lock + CAS ISSUED → CONSUMED,
 * constant-time MAC check, attempts and lock-out, audit. The challenge must match the expected purpose AND its binding
 * (the installation for sign-in and web deletion, the requesting session for step-up and the new number of a phone
 * change); anything else is the same generic refusal, and no attempt is counted for a foreign or wrong-purpose id.
 */
import type { PakistanMobileE164 } from '@wayvro/domain';
import type { FieldCipher, KeyedHasher } from '@wayvro/field-crypto';
import { ENCRYPTED_FIELDS, fieldContext } from '@wayvro/identity-core';
import { appendAudit } from '@wayvro/server-runtime';
import type pg from 'pg';
import { failure, type Refusal } from '../platform/idempotency.js';
import type { OtpAbuseControls } from './otp-abuse.js';

export type OtpPurpose = 'SIGN_IN' | 'STEP_UP' | 'PHONE_CHANGE_NEW' | 'ACCOUNT_DELETION_WEB';

export interface ConsumeInput {
  readonly challengeId: string;
  readonly code: string;
  readonly purpose: OtpPurpose;
  /** Installation binding (SIGN_IN, ACCOUNT_DELETION_WEB) or session binding (STEP_UP, PHONE_CHANGE_NEW). */
  readonly binding: { readonly installation: Buffer } | { readonly sessionId: string };
}

export interface Consumed {
  readonly kind: 'consumed';
  readonly e164: PakistanMobileE164;
  readonly locale: 'en' | 'ur' | 'ur-Latn';
}

export async function consumeChallenge(
  tx: pg.PoolClient,
  deps: { readonly cipher: FieldCipher; readonly hasher: KeyedHasher; readonly abuse: OtpAbuseControls },
  input: ConsumeInput,
): Promise<Consumed | Refusal> {
  const r = await tx.query<{
    purpose: string;
    status: string;
    installation_hash: Buffer;
    session_id: string | null;
    code_mac: Buffer | null;
    mac_key_version: number | null;
    attempts: number;
    max_attempts: number;
    phone_envelope: Buffer;
    phone_lookup_hash: Buffer;
    locale: 'en' | 'ur' | 'ur-Latn';
    expired: boolean;
  }>(
    `select purpose, status, installation_hash, session_id, code_mac, mac_key_version, attempts, max_attempts, phone_envelope, phone_lookup_hash, locale,
            expires_at <= now() expired
       from identity.otp_challenges where id = $1 for update`,
    [input.challengeId],
  );
  const c = r.rows[0];
  const bound =
    c !== undefined && ('installation' in input.binding ? c.installation_hash.equals(input.binding.installation) : c.session_id === input.binding.sessionId);
  // Unknown, foreign (other installation/session) or wrong-purpose challenges: generic, and no attempt is counted.
  if (!c || !bound || c.purpose !== input.purpose) return failure('WAYVRO_E_OTP_INVALID_OR_EXPIRED');
  if (c.status === 'LOCKED') return failure('WAYVRO_E_OTP_LOCKED');
  if (c.status !== 'ISSUED' || !c.code_mac || c.mac_key_version === null) return failure('WAYVRO_E_OTP_INVALID_OR_EXPIRED');
  if (c.expired) {
    await tx.query(`update identity.otp_challenges set status = 'EXPIRED' where id = $1 and status = 'ISSUED'`, [input.challengeId]);
    return failure('WAYVRO_E_OTP_INVALID_OR_EXPIRED');
  }
  if (!deps.hasher.verify('otp_mac', c.mac_key_version, `${input.challengeId}|${input.code}`, c.code_mac)) {
    const attempts = c.attempts + 1;
    const locked = attempts >= c.max_attempts;
    await tx.query(`update identity.otp_challenges set attempts = $2, status = $3 where id = $1 and status = 'ISSUED'`, [
      input.challengeId,
      attempts,
      locked ? 'LOCKED' : 'ISSUED',
    ]);
    await appendAudit(tx, {
      actor: { type: 'ANONYMOUS' },
      action: 'OTP_VERIFICATION',
      objectType: 'identity.otp_challenge',
      objectId: input.challengeId,
      outcome: 'FAILURE',
      reasonCode: locked ? 'OTP_LOCKED' : 'OTP_MISMATCH',
    });
    if (locked) await deps.abuse.recordFailedChallenge(c.phone_lookup_hash.toString('hex'));
    return failure(locked ? 'WAYVRO_E_OTP_LOCKED' : 'WAYVRO_E_OTP_INVALID_OR_EXPIRED');
  }
  const consumed = await tx.query(
    `update identity.otp_challenges set status = 'CONSUMED', consumed_at = now() where id = $1 and status = 'ISSUED' and expires_at > now()`,
    [input.challengeId],
  );
  if (consumed.rowCount !== 1) return failure('WAYVRO_E_OTP_INVALID_OR_EXPIRED');
  await appendAudit(tx, {
    actor: { type: 'ANONYMOUS' },
    action: 'OTP_VERIFICATION',
    objectType: 'identity.otp_challenge',
    objectId: input.challengeId,
    outcome: 'SUCCESS',
    reasonCode: input.purpose === 'SIGN_IN' ? undefined : input.purpose,
  });
  const e164 = deps.cipher.decryptString('contact', c.phone_envelope, fieldContext(ENCRYPTED_FIELDS.challengePhone, input.challengeId)) as PakistanMobileE164;
  return { kind: 'consumed', e164, locale: c.locale };
}
