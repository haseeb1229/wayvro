/**
 * OTP challenge issuance and resend (A02/A03/K08; docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md §3.1/§3.3).
 *
 * - +92 mobile numbers only (syntax); anything else is 400 VALIDATION, which never depends on account existence.
 * - Codes: `crypto.randomInt` (CSPRNG), 6 digits; only HMAC-SHA-256(otp_mac key, challengeId|code) is stored.
 * - The response is IDENTICAL for every syntactically valid number — including silent drops caused by per-phone limits,
 *   which create a SUPPRESSED challenge (no code, cannot be verified) so the database work stays equivalent.
 * - Sending happens in the `otp.deliver` job enqueued in the same transaction (sealed destination + code).
 * - No master code, no bypass number, no tester numbers in any environment.
 */
import { createHash, randomInt } from 'node:crypto';
import type { OtpChallenge, OtpChallengeRequest } from '@wayvro/contracts';
import { maskPakistanMobile, normalisePakistanMobile, type PakistanMobileE164 } from '@wayvro/domain';
import type { FieldCipher, KeyedHasher } from '@wayvro/field-crypto';
import { ENCRYPTED_FIELDS, OTP_DELIVER_JOB, fieldContext, sealOtpDelivery, type OtpLocale, type PhoneLookup } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import { appendAudit, enqueueJob, uuidv7 } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { ApiConfig } from '../config.js';
import { failure, success, type IdempotencyStore, type IdempotentResult } from '../platform/idempotency.js';
import type { OtpAbuseControls, SendDecision } from './otp-abuse.js';

export interface OtpDependencies {
  readonly db: pg.Pool;
  readonly cipher: FieldCipher;
  readonly hasher: KeyedHasher;
  readonly lookup: PhoneLookup;
  readonly idempotency: IdempotencyStore;
  readonly abuse: OtpAbuseControls;
  readonly policy: ApiConfig;
  /** False when no OTP delivery adapter is bound anywhere (production until EG-01): every request answers 503. */
  readonly deliveryAvailable: boolean;
}

export interface RequestContext {
  readonly idempotencyKey: string;
  readonly clientIp: string;
}

/** SHA-256 of the app-generated installation id (stored; never the raw id). */
export function installationHash(installationId: string): Buffer {
  return createHash('sha256').update(installationId, 'utf8').digest();
}

export const installationScope = (hash: Buffer): string => `inst:${hash.toString('hex')}`;

function normalise(phone: string): PakistanMobileE164 {
  const n = normalisePakistanMobile(phone);
  if (!n.ok) throw new WayvroError('WAYVRO_E_VALIDATION');
  return n.e164;
}

interface IssueInput {
  readonly e164: PakistanMobileE164;
  readonly locale: OtpLocale;
  readonly installation: Buffer;
  readonly resendCount: number;
  readonly supersedes: string | null;
  readonly decision: SendDecision;
}

export class OtpService {
  constructor(private readonly deps: OtpDependencies) {}

  private requireDelivery(): void {
    if (!this.deps.deliveryAvailable) throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE');
  }

  private sendContext(e164: PakistanMobileE164, installation: Buffer, clientIp: string) {
    return {
      phoneKey: this.deps.lookup.activeDigest(e164).digest.toString('hex'),
      installationKey: installation.toString('hex'),
      clientIp,
      operatorPrefix: e164.slice(0, 6),
    };
  }

  async request(input: OtpChallengeRequest, ctx: RequestContext): Promise<IdempotentResult> {
    const e164 = normalise(input.phone);
    this.requireDelivery();
    const installation = installationHash(input.installationId);
    return this.deps.idempotency.execute(
      {
        scope: installationScope(installation),
        operation: 'otp-challenges.create',
        key: ctx.idempotencyKey,
        payload: input,
        ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        const decision = await this.deps.abuse.admitSend(this.sendContext(e164, installation, ctx.clientIp));
        return success(202, await this.issue(tx, { e164, locale: input.locale, installation, resendCount: 0, supersedes: null, decision }));
      },
    );
  }

  async resend(challengeId: string, installationId: string, ctx: RequestContext): Promise<IdempotentResult> {
    this.requireDelivery();
    const installation = installationHash(installationId);
    return this.deps.idempotency.execute(
      {
        scope: installationScope(installation),
        operation: 'otp-challenges.resend',
        key: ctx.idempotencyKey,
        payload: { challengeId, installationId },
        ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        const r = await tx.query<{
          purpose: string;
          status: string;
          installation_hash: Buffer;
          phone_envelope: Buffer;
          locale: OtpLocale;
          resend_count: number;
          expired: boolean;
          resend_wait: number;
          ttl_left: number;
        }>(
          `select purpose, status, installation_hash, phone_envelope, locale, resend_count, expires_at <= now() expired,
                  greatest(0, ceil(extract(epoch from next_resend_at - now())))::int resend_wait,
                  greatest(1, ceil(extract(epoch from expires_at - now())))::int ttl_left
             from identity.otp_challenges where id = $1 for update`,
          [challengeId],
        );
        const row = r.rows[0];
        if (
          !row ||
          !row.installation_hash.equals(installation) ||
          row.purpose !== 'SIGN_IN' ||
          !['ISSUED', 'SUPPRESSED', 'DELIVERY_FAILED'].includes(row.status) ||
          row.expired
        ) {
          return failure('WAYVRO_E_OTP_INVALID_OR_EXPIRED');
        }
        if (row.resend_count >= this.deps.policy.OTP_MAX_RESENDS) return failure('WAYVRO_E_RATE_LIMITED', { retryAfterSeconds: row.ttl_left });
        if (row.resend_wait > 0) return failure('WAYVRO_E_RATE_LIMITED', { retryAfterSeconds: row.resend_wait });
        const e164 = this.deps.cipher.decryptString(
          'contact',
          row.phone_envelope,
          fieldContext(ENCRYPTED_FIELDS.challengePhone, challengeId),
        ) as PakistanMobileE164;
        const decision = await this.deps.abuse.admitSend(this.sendContext(e164, installation, ctx.clientIp));
        await tx.query(`update identity.otp_challenges set status = 'SUPERSEDED' where id = $1 and status in ('ISSUED', 'DELIVERY_FAILED')`, [challengeId]);
        return success(
          202,
          await this.issue(tx, { e164, locale: row.locale, installation, resendCount: row.resend_count + 1, supersedes: challengeId, decision }),
        );
      },
    );
  }

  private async issue(tx: pg.PoolClient, input: IssueInput): Promise<OtpChallenge> {
    const p = this.deps.policy;
    const id = uuidv7();
    const lookup = this.deps.lookup.activeDigest(input.e164);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const mac = input.decision.send ? this.deps.hasher.active('otp_mac', `${id}|${code}`) : null;
    const cooldowns = p.OTP_RESEND_COOLDOWNS_SECONDS;
    const cooldown = cooldowns[Math.min(input.resendCount, cooldowns.length - 1)] ?? 60;
    // A new code supersedes every still-live code for the same phone, purpose and installation.
    await tx.query(
      `update identity.otp_challenges set status = 'SUPERSEDED'
        where phone_lookup_key_version = $1 and phone_lookup_hash = $2 and purpose = 'SIGN_IN' and installation_hash = $3 and status = 'ISSUED'`,
      [lookup.version, lookup.digest, input.installation],
    );
    const inserted = await tx.query<{ expires_at: Date; next_resend_at: Date }>(
      `insert into identity.otp_challenges (id, purpose, phone_lookup_key_version, phone_lookup_hash, phone_envelope, code_mac, mac_key_version, channel, locale,
                                            installation_hash, status, max_attempts, resend_count, next_resend_at, expires_at, supersedes_id)
       values ($1, 'SIGN_IN', $2, $3, $4, $5, $6, 'SMS', $7, $8, $9, $10, $11, now() + ($12::int * interval '1 second'), now() + ($13::int * interval '1 second'), $14)
       returning expires_at, next_resend_at`,
      [
        id,
        lookup.version,
        lookup.digest,
        this.deps.cipher.encrypt('contact', input.e164, fieldContext(ENCRYPTED_FIELDS.challengePhone, id)),
        mac?.digest ?? null,
        mac?.version ?? null,
        input.locale,
        input.installation,
        input.decision.send ? 'ISSUED' : 'SUPPRESSED',
        p.OTP_MAX_ATTEMPTS,
        input.resendCount,
        cooldown,
        p.OTP_TTL_SECONDS,
        input.supersedes,
      ],
    );
    if (input.decision.send) {
      const jobId = uuidv7();
      await enqueueJob(tx, {
        id: jobId,
        type: OTP_DELIVER_JOB,
        payload: { challengeId: id },
        sealedPayload: sealOtpDelivery(this.deps.cipher, jobId, { to: input.e164, code, locale: input.locale, ttlMinutes: Math.ceil(p.OTP_TTL_SECONDS / 60) }),
        maxAttempts: 3,
      });
    }
    await appendAudit(tx, {
      actor: { type: 'ANONYMOUS' },
      action: input.decision.send ? 'OTP_CHALLENGE_ISSUED' : 'OTP_CHALLENGE_SUPPRESSED',
      objectType: 'identity.otp_challenge',
      objectId: id,
      outcome: 'SUCCESS',
      reasonCode: input.decision.send ? (input.supersedes ? 'RESEND' : undefined) : input.decision.reason,
    });
    const row = inserted.rows[0];
    if (!row) throw new Error('challenge insert returned no row');
    return {
      challengeId: id,
      expiresAt: row.expires_at.toISOString(),
      resendAvailableAt: row.next_resend_at.toISOString(),
      channel: 'SMS',
      maskedDestination: maskPakistanMobile(input.e164),
    };
  }
}
