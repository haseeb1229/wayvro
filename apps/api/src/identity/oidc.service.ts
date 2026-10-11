/**
 * Google/Apple OIDC as an OPTIONAL linked convenience (P2.10; auth design §7; K15/K16/S13; ADR-040).
 *
 * - Verification with `jose`: the provider's published keys (OidcKeysPort), issuer, audience (configured client IDs),
 *   RS256 only, expiry with ≤ 60 s skew, a token no older than 10 minutes, and a server-issued single-use nonce
 *   (5 minutes; bound to the installation for sign-in, to the session for linking and recovery). Google tokens carry
 *   the nonce itself, Apple tokens its SHA-256 (hex); only the nonce's SHA-256 is stored.
 * - Sign-in only for a LINKED (provider, subject); never account creation. Every failure is the same generic 401.
 *   An installation that has never signed in with a phone OTP gets PHONE_STEP_UP (founder Q-02).
 * - Link and unlink need a fresh phone step-up. A subject linked to another account is a generic conflict (audited).
 *   E-mail is never read, stored, looked up or merged on.
 * - Each provider is behind its flag (`platform.auth-oidc-google` / `-apple`); without keys or client IDs: 503.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isFlagEnabled, type WayvroEnv } from '@wayvro/config';
import { WayvroError } from '@wayvro/observability';
import type { OidcKeysPort, OidcProvider } from '@wayvro/provider-interfaces';
import { appendAudit, sqlState, uuidv7, type Queryable } from '@wayvro/server-runtime';
import { createLocalJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';
import type pg from 'pg';
import type { Principal } from '../auth/policy.js';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Refusal } from '../platform/idempotency.js';
import { stepUpFresh } from './session-gates.js';
import type { OtpAbuseControls } from './otp-abuse.js';
import { installationHash, installationScope } from './otp.service.js';
import { securityEvent, type SessionService } from './session.service.js';

const NONCE_SECONDS = 300;
const ISSUERS: Readonly<Record<OidcProvider, readonly string[]>> = {
  GOOGLE: ['https://accounts.google.com', 'accounts.google.com'],
  APPLE: ['https://appleid.apple.com'],
};
const FLAGS: Readonly<Record<OidcProvider, string>> = { GOOGLE: 'platform.auth-oidc-google', APPLE: 'platform.auth-oidc-apple' };

interface OidcPolicy {
  readonly WAYVRO_ENV: WayvroEnv;
  readonly IDEMPOTENCY_TTL_SECONDS: number;
  readonly IDEMPOTENCY_SESSION_RESPONSE_TTL_SECONDS: number;
  readonly OIDC_GOOGLE_AUDIENCES: readonly string[];
  readonly OIDC_APPLE_AUDIENCES: readonly string[];
}

export interface OidcDependencies {
  readonly db: pg.Pool;
  readonly idempotency: IdempotencyStore;
  readonly abuse: OtpAbuseControls;
  readonly sessions: SessionService;
  /** null when no key source is bound (production until activation): every OIDC route answers 503. */
  readonly keys: OidcKeysPort | null;
  readonly policy: OidcPolicy;
}

type NonceBinding = { readonly purpose: 'SIGN_IN'; readonly installation: Buffer } | { readonly purpose: 'LINK' | 'RECOVERY'; readonly sessionId: string };
const sha256 = (v: string): Buffer => createHash('sha256').update(v, 'utf8').digest();

export class OidcService {
  constructor(private readonly deps: OidcDependencies) {}

  private enabled(provider: OidcProvider): boolean {
    return isFlagEnabled(FLAGS[provider], this.deps.policy.WAYVRO_ENV);
  }

  private audiences(provider: OidcProvider): readonly string[] {
    return provider === 'GOOGLE' ? this.deps.policy.OIDC_GOOGLE_AUDIENCES : this.deps.policy.OIDC_APPLE_AUDIENCES;
  }

  /** Flag OFF ⇒ 404 FEATURE_DISABLED; no key source or client IDs ⇒ 503 (never a silent success). */
  assertAvailable(provider: OidcProvider): OidcKeysPort {
    if (!this.enabled(provider)) throw new WayvroError('WAYVRO_E_FEATURE_DISABLED');
    if (this.deps.keys === null || this.audiences(provider).length === 0) throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE');
    return this.deps.keys;
  }

  private assertAnyEnabled(): void {
    if (!this.enabled('GOOGLE') && !this.enabled('APPLE')) throw new WayvroError('WAYVRO_E_FEATURE_DISABLED');
  }

  // ── nonces ────────────────────────────────────────────────────────────────────────────────────────────────────
  private async issueNonce(tx: pg.PoolClient, binding: NonceBinding) {
    const id = uuidv7();
    const nonce = randomBytes(32).toString('base64url');
    const r = await tx.query<{ expires_at: Date }>(
      `insert into identity.oidc_nonces (id, nonce_sha256, purpose, installation_hash, session_id, expires_at)
       values ($1, $2, $3, $4, $5, now() + ($6::int * interval '1 second')) returning expires_at`,
      [
        id,
        sha256(nonce),
        binding.purpose,
        'installation' in binding ? binding.installation : null,
        'sessionId' in binding ? binding.sessionId : null,
        NONCE_SECONDS,
      ],
    );
    return { nonceId: id, nonce, expiresAt: (r.rows[0]?.expires_at ?? new Date()).toISOString() };
  }

  async signInNonce(installationId: string, key: string): Promise<IdempotentResult> {
    this.assertAnyEnabled();
    const installation = installationHash(installationId);
    return this.deps.idempotency.execute(
      {
        scope: installationScope(installation),
        operation: 'oidc-nonces.sign-in',
        key,
        payload: { installationId },
        ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => success(201, await this.issueNonce(tx, { purpose: 'SIGN_IN', installation })),
    );
  }

  async accountNonce(principal: Principal, purpose: 'LINK' | 'RECOVERY', key: string): Promise<IdempotentResult> {
    this.assertAnyEnabled();
    return this.deps.idempotency.execute(
      {
        scope: `acct:${principal.accountId}`,
        operation: 'oidc-nonces.account',
        key,
        payload: { purpose },
        ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => success(201, await this.issueNonce(tx, { purpose, sessionId: principal.sessionId })),
    );
  }

  // ── verification ─────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Consumes the nonce and verifies the ID token; returns the provider subject, or null for ANY verification failure
   * (the caller turns that into its own generic refusal). Key-source outages throw 503.
   */
  async verify(tx: pg.PoolClient, input: { provider: OidcProvider; idToken: string; nonceId: string }, binding: NonceBinding): Promise<string | null> {
    const keys = this.assertAvailable(input.provider);
    const n = (
      await tx.query<{ nonce_sha256: Buffer; purpose: string; installation_hash: Buffer | null; session_id: string | null; live: boolean }>(
        `select nonce_sha256, purpose, installation_hash, session_id, (consumed_at is null and expires_at > now()) live from identity.oidc_nonces where id = $1 for update`,
        [input.nonceId],
      )
    ).rows[0];
    const bound =
      n !== undefined &&
      n.live &&
      n.purpose === binding.purpose &&
      ('installation' in binding ? n.installation_hash?.equals(binding.installation) === true : n.session_id === binding.sessionId);
    if (!n || !bound) return null;
    // single use: the nonce is spent by this attempt whatever its outcome (a refusal commits; an outage rolls back)
    await tx.query(`update identity.oidc_nonces set consumed_at = now() where id = $1 and consumed_at is null`, [input.nonceId]);
    let keySet;
    try {
      keySet = createLocalJWKSet({ keys: [...(await keys.keySet(input.provider)).keys] as Parameters<typeof createLocalJWKSet>[0]['keys'] });
    } catch (e) {
      throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE', { cause: e });
    }
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(input.idToken, keySet, {
        issuer: [...ISSUERS[input.provider]],
        audience: [...this.audiences(input.provider)],
        algorithms: ['RS256'],
        clockTolerance: 60,
        maxTokenAge: '10 minutes',
        requiredClaims: ['sub', 'nonce', 'iat', 'exp'],
      }));
    } catch (e) {
      if (e instanceof joseErrors.JOSEError) return null;
      throw e;
    }
    const claimed = typeof payload['nonce'] === 'string' ? payload['nonce'] : '';
    const presented = input.provider === 'APPLE' ? (/^[0-9a-f]{64}$/.test(claimed) ? Buffer.from(claimed, 'hex') : Buffer.alloc(0)) : sha256(claimed);
    if (presented.length !== 32 || !timingSafeEqual(presented, n.nonce_sha256)) return null;
    const subject = payload.sub;
    return typeof subject === 'string' && subject.length >= 1 && subject.length <= 255 ? subject : null;
  }

  // ── sign-in (never account creation) ─────────────────────────────────────────────────────────────────────────
  async signIn(
    input: { provider: OidcProvider; idToken: string; nonceId: string; installationId: string; device: { platform: 'ANDROID' | 'IOS'; appVersion: string } },
    key: string,
  ): Promise<IdempotentResult> {
    this.assertAvailable(input.provider);
    const installation = installationHash(input.installationId);
    await this.deps.abuse.admitVerify(installation.toString('hex'));
    return this.deps.idempotency.execute(
      {
        scope: installationScope(installation),
        operation: 'oidc-sessions.create',
        key,
        payload: { provider: input.provider, nonceId: input.nonceId, idTokenSha256: sha256(input.idToken).toString('hex'), device: input.device },
        ttlSeconds: this.deps.policy.IDEMPOTENCY_SESSION_RESPONSE_TTL_SECONDS,
      },
      async (tx) => {
        const subject = await this.verify(tx, input, { purpose: 'SIGN_IN', installation });
        const owner = subject
          ? (
              await tx.query<{ account_id: string }>(
                `select i.account_id from identity.oidc_identities i join identity.accounts a on a.id = i.account_id
                  where i.provider = $1 and i.subject = $2 and i.status = 'LINKED' and a.status in ('ACTIVE', 'DELETION_PENDING')`,
                [input.provider, subject],
              )
            ).rows[0]
          : undefined;
        if (!owner) {
          await appendAudit(tx, {
            actor: { type: 'ANONYMOUS' },
            action: 'OIDC_SIGN_IN',
            objectType: 'identity.oidc_identity',
            outcome: 'FAILURE',
            reasonCode: input.provider,
          });
          return failure('WAYVRO_E_OIDC_NOT_LINKED');
        }
        return success(201, await this.deps.sessions.signInLinked(tx, owner.account_id, { installation, ...input.device }));
      },
    );
  }

  // ── links ────────────────────────────────────────────────────────────────────────────────────────────────────
  async list(principal: Principal): Promise<unknown> {
    const r = await this.deps.db.query<{ id: string; provider: OidcProvider; linked_at: Date }>(
      `select id, provider, linked_at from identity.oidc_identities where account_id = $1 and status = 'LINKED' order by linked_at`,
      [principal.accountId],
    );
    return { links: r.rows.map((x) => ({ id: x.id, provider: x.provider, linkedAt: x.linked_at.toISOString() })) };
  }

  async link(principal: Principal, input: { provider: OidcProvider; idToken: string; nonceId: string }, key: string): Promise<IdempotentResult> {
    this.assertAvailable(input.provider);
    if (!(await stepUpFresh(this.deps.db, principal.sessionId))) throw new WayvroError('WAYVRO_E_STEP_UP_REQUIRED');
    return this.deps.idempotency.execute(
      {
        scope: `acct:${principal.accountId}`,
        operation: 'oidc-links.create',
        key,
        payload: { provider: input.provider, nonceId: input.nonceId },
        ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        const subject = await this.verify(tx, input, { purpose: 'LINK', sessionId: principal.sessionId });
        if (!subject) return failure('WAYVRO_E_VALIDATION');
        const id = uuidv7();
        await tx.query('savepoint oidc_link');
        try {
          await tx.query(`insert into identity.oidc_identities (id, account_id, provider, subject, status) values ($1, $2, $3, $4, 'LINKED')`, [
            id,
            principal.accountId,
            input.provider,
            subject,
          ]);
        } catch (e) {
          if (sqlState(e) !== '23505') throw e;
          await tx.query('rollback to savepoint oidc_link');
          return this.linkConflict(tx, principal, input.provider, subject);
        }
        await securityEvent(tx, principal.accountId, 'OIDC_LINKED', principal.sessionId);
        await appendAudit(tx, {
          actor: { type: 'ACCOUNT', id: principal.accountId },
          action: 'OIDC_LINKED',
          objectType: 'identity.oidc_identity',
          objectId: id,
          outcome: 'SUCCESS',
          reasonCode: input.provider,
        });
        const row = (await tx.query<{ linked_at: Date }>(`select linked_at from identity.oidc_identities where id = $1`, [id])).rows[0];
        return success(201, { id, provider: input.provider, linkedAt: (row?.linked_at ?? new Date()).toISOString() });
      },
    );
  }

  /** The account already links this provider (409 CONFLICT), or the subject belongs to another account (generic, audited). */
  private async linkConflict(tx: Queryable, principal: Principal, provider: OidcProvider, subject: string): Promise<Refusal> {
    const elsewhere = await tx.query(`select 1 from identity.oidc_identities where provider = $1 and subject = $2 and status = 'LINKED' and account_id <> $3`, [
      provider,
      subject,
      principal.accountId,
    ]);
    if ((elsewhere.rowCount ?? 0) === 0) return failure('WAYVRO_E_CONFLICT');
    // S13: never a merge; the attempt is a signal for Trust & Safety review
    await appendAudit(tx, {
      actor: { type: 'ACCOUNT', id: principal.accountId },
      action: 'OIDC_LINK_CONFLICT',
      objectType: 'identity.account',
      objectId: principal.accountId,
      outcome: 'DENIED',
      reasonCode: provider,
    });
    return failure('WAYVRO_E_OIDC_LINK_CONFLICT');
  }

  async unlink(principal: Principal, id: string, key: string): Promise<IdempotentResult> {
    if (!(await stepUpFresh(this.deps.db, principal.sessionId))) throw new WayvroError('WAYVRO_E_STEP_UP_REQUIRED');
    return this.deps.idempotency.execute(
      { scope: `acct:${principal.accountId}`, operation: 'oidc-links.delete', key, payload: { id }, ttlSeconds: this.deps.policy.IDEMPOTENCY_TTL_SECONDS },
      async (tx) => {
        const r = await tx.query(
          `update identity.oidc_identities set status = 'UNLINKED', unlinked_at = now(), version = version + 1 where id = $1 and account_id = $2 and status = 'LINKED'`,
          [id, principal.accountId],
        );
        if (r.rowCount !== 1) return failure('WAYVRO_E_NOT_FOUND');
        await securityEvent(tx, principal.accountId, 'OIDC_UNLINKED', principal.sessionId);
        await appendAudit(tx, {
          actor: { type: 'ACCOUNT', id: principal.accountId },
          action: 'OIDC_UNLINKED',
          objectType: 'identity.oidc_identity',
          objectId: id,
          outcome: 'SUCCESS',
        });
        return success(204, null);
      },
    );
  }

  /**
   * A fresh recovery token of this session: null when the token does not verify; otherwise the LINKED identity it
   * proves (or null inside `identity` when the subject is linked to no account).
   */
  async recoveryProof(
    tx: pg.PoolClient,
    principal: Principal,
    input: { provider: OidcProvider; idToken: string; nonceId: string },
  ): Promise<{ identity: { id: string; accountId: string } | null } | null> {
    const subject = await this.verify(tx, input, { purpose: 'RECOVERY', sessionId: principal.sessionId });
    if (!subject) return null;
    const r = await tx.query<{ id: string; account_id: string }>(
      `select id, account_id from identity.oidc_identities where provider = $1 and subject = $2 and status = 'LINKED'`,
      [input.provider, subject],
    );
    const row = r.rows[0];
    return { identity: row ? { id: row.id, accountId: row.account_id } : null };
  }
}
