/**
 * Staff WebAuthn ceremonies (ADR-039; SimpleWebAuthn 14 — the protocol is never hand-rolled, ADR-038 condition 2).
 *
 * - Challenges are generated server-side (32 random bytes), stored with purpose/staff/session binding and consumed by a
 *   single-use compare-and-set even when verification then fails (no replay of a challenge).
 * - Registration: discoverable credential (residentKey required), user verification REQUIRED, attestation `none`.
 * - Authentication: user verification REQUIRED; exact RP ID and origin allowlist; the credential must be ACTIVE and
 *   belong to an ACTIVE staff member (for step-up/unlock: to the session's staff member); a signature counter that
 *   does not increase (when non-zero) is treated as a possible cloned authenticator and refused.
 * - Verifiers return `null` on any failure (after auditing it) instead of throwing, so the caller can COMMIT the
 *   challenge consumption and the failure audit and then answer with a generic 401 (a rolled-back failure would leave
 *   the challenge replayable and the attempt unaudited).
 */
import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { appendAudit, uuidv7, type Queryable } from '@wayvro/server-runtime';

export interface WebAuthnConfig {
  readonly STAFF_WEBAUTHN_RP_ID: string;
  readonly STAFF_WEBAUTHN_RP_NAME: string;
  readonly STAFF_WEBAUTHN_ORIGINS: readonly string[];
}

type RegistrationPurpose = 'ENROL' | 'ADD_CREDENTIAL';
type AuthenticationPurpose = 'LOGIN' | 'STEP_UP' | 'UNLOCK';

const CHALLENGE_TTL_SECONDS = 300;

export interface RegisteredCredential {
  readonly credentialId: Buffer;
  readonly publicKey: Buffer;
  readonly counter: number;
  readonly transports: readonly string[];
  readonly deviceType: 'singleDevice' | 'multiDevice';
  readonly backedUp: boolean;
}

interface ChallengeBinding {
  readonly staffId: string | null;
  readonly invitationId?: string;
  readonly sessionId?: string;
}

export class StaffWebAuthn {
  constructor(private readonly cfg: WebAuthnConfig) {}

  private async storeChallenge(
    tx: Queryable,
    purpose: RegistrationPurpose | AuthenticationPurpose,
    binding: ChallengeBinding,
  ): Promise<{ id: string; challenge: Uint8Array<ArrayBuffer> }> {
    const id = uuidv7();
    const challenge = new Uint8Array(randomBytes(32));
    await tx.query(
      `insert into staff.webauthn_challenges (id, purpose, challenge, staff_id, invitation_id, session_id, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + ($7::int * interval '1 second'))`,
      [id, purpose, Buffer.from(challenge), binding.staffId, binding.invitationId ?? null, binding.sessionId ?? null, CHALLENGE_TTL_SECONDS],
    );
    return { id, challenge };
  }

  /** Single-use consumption bound to purpose (+ session/invitation where applicable); null otherwise. */
  private async consumeChallenge(
    tx: Queryable,
    id: string,
    purpose: string,
    binding: { sessionId?: string; invitationId?: string },
  ): Promise<{ challenge: Buffer; staffId: string | null } | null> {
    const r = await tx.query<{ challenge: Buffer; staff_id: string | null }>(
      `update staff.webauthn_challenges set used_at = now()
        where id = $1 and purpose = $2 and used_at is null and expires_at > now()
          and session_id is not distinct from $3 and invitation_id is not distinct from $4
        returning challenge, staff_id`,
      [id, purpose, binding.sessionId ?? null, binding.invitationId ?? null],
    );
    const row = r.rows[0];
    return row ? { challenge: row.challenge, staffId: row.staff_id } : null;
  }

  async registrationOptions(
    tx: Queryable,
    purpose: RegistrationPurpose,
    staff: { id: string; displayName: string; workEmail: string },
    binding: { invitationId?: string; sessionId?: string },
  ): Promise<{ challengeId: string; options: Record<string, unknown> }> {
    const existing = await tx.query<{ credential_id: Buffer; transports: string[] }>(
      `select credential_id, transports from staff.webauthn_credentials where staff_id = $1 and status = 'ACTIVE'`,
      [staff.id],
    );
    const { id, challenge } = await this.storeChallenge(tx, purpose, { staffId: staff.id, ...binding });
    const options = await generateRegistrationOptions({
      rpName: this.cfg.STAFF_WEBAUTHN_RP_NAME,
      rpID: this.cfg.STAFF_WEBAUTHN_RP_ID,
      userName: staff.workEmail,
      userDisplayName: staff.displayName,
      userID: Buffer.from(staff.id.replaceAll('-', ''), 'hex'),
      challenge,
      attestationType: 'none',
      timeout: CHALLENGE_TTL_SECONDS * 1000,
      excludeCredentials: existing.rows.map((c) => ({ id: c.credential_id.toString('base64url'), transports: c.transports })),
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    });
    return { challengeId: id, options: { ...options } };
  }

  async verifyRegistration(
    tx: Queryable,
    purpose: RegistrationPurpose,
    challengeId: string,
    binding: { invitationId?: string; sessionId?: string },
    response: unknown,
  ): Promise<(RegisteredCredential & { staffId: string }) | null> {
    const consumed = await this.consumeChallenge(tx, challengeId, purpose, binding);
    if (!consumed?.staffId) return null;
    const { challenge, staffId } = consumed;
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challenge.toString('base64url'),
        expectedOrigin: [...this.cfg.STAFF_WEBAUTHN_ORIGINS],
        expectedRPID: this.cfg.STAFF_WEBAUTHN_RP_ID,
        requireUserVerification: true,
      });
    } catch {
      await this.auditFailure(tx, staffId, `${purpose}_VERIFICATION_FAILED`);
      return null;
    }
    if (!verified.verified) {
      await this.auditFailure(tx, staffId, `${purpose}_VERIFICATION_FAILED`);
      return null;
    }
    const info = verified.registrationInfo;
    return {
      staffId,
      credentialId: Buffer.from(info.credential.id, 'base64url'),
      publicKey: Buffer.from(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
    };
  }

  async authenticationOptions(
    tx: Queryable,
    purpose: AuthenticationPurpose,
    binding: { staffId?: string; sessionId?: string },
  ): Promise<{ challengeId: string; options: Record<string, unknown> }> {
    // LOGIN uses discoverable credentials (no account enumeration: no identifier is asked for or revealed).
    const allow =
      binding.staffId === undefined
        ? []
        : (
            await tx.query<{ credential_id: Buffer; transports: string[] }>(
              `select credential_id, transports from staff.webauthn_credentials where staff_id = $1 and status = 'ACTIVE'`,
              [binding.staffId],
            )
          ).rows.map((c) => ({ id: c.credential_id.toString('base64url'), transports: c.transports }));
    const { id, challenge } = await this.storeChallenge(tx, purpose, {
      staffId: binding.staffId ?? null,
      ...(binding.sessionId ? { sessionId: binding.sessionId } : {}),
    });
    const options = await generateAuthenticationOptions({
      rpID: this.cfg.STAFF_WEBAUTHN_RP_ID,
      challenge,
      allowCredentials: allow,
      userVerification: 'required',
      timeout: CHALLENGE_TTL_SECONDS * 1000,
    });
    return { challengeId: id, options: { ...options } };
  }

  /** Verifies an assertion; returns the credential row and staff. For STEP_UP/UNLOCK the staff must match. */
  async verifyAuthentication(
    tx: Queryable,
    purpose: AuthenticationPurpose,
    challengeId: string,
    binding: { sessionId?: string; staffId?: string },
    response: { id: string } & Record<string, unknown>,
  ): Promise<{ staffId: string; credentialRowId: string } | null> {
    const consumed = await this.consumeChallenge(tx, challengeId, purpose, binding.sessionId ? { sessionId: binding.sessionId } : {});
    if (!consumed) return null;
    const { challenge } = consumed;
    const cred = await tx.query<{ id: string; staff_id: string; public_key: Buffer; sign_count: string; transports: string[]; credential_id: Buffer }>(
      `select c.id, c.staff_id, c.public_key, c.sign_count, c.transports, c.credential_id
         from staff.webauthn_credentials c join staff.staff_accounts a on a.id = c.staff_id
        where c.credential_id = $1 and c.status = 'ACTIVE' and a.status = 'ACTIVE'`,
      [Buffer.from(response.id, 'base64url')],
    );
    const row = cred.rows[0];
    if (!row || (binding.staffId !== undefined && row.staff_id !== binding.staffId)) {
      if (row) await this.auditFailure(tx, row.staff_id, `${purpose}_WRONG_STAFF`);
      return null;
    }
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge.toString('base64url'),
        expectedOrigin: [...this.cfg.STAFF_WEBAUTHN_ORIGINS],
        expectedRPID: this.cfg.STAFF_WEBAUTHN_RP_ID,
        requireUserVerification: true,
        credential: {
          id: row.credential_id.toString('base64url'),
          publicKey: new Uint8Array(row.public_key),
          counter: Number(row.sign_count),
          transports: row.transports,
        },
      });
    } catch {
      await this.auditFailure(tx, row.staff_id, `${purpose}_VERIFICATION_FAILED`);
      return null;
    }
    const stored = Number(row.sign_count);
    const next = result.authenticationInfo.newCounter;
    if (!result.verified || (next !== 0 || stored !== 0 ? next <= stored : false)) {
      await this.auditFailure(tx, row.staff_id, result.verified ? 'SIGN_COUNTER_NOT_INCREASING' : `${purpose}_VERIFICATION_FAILED`);
      return null;
    }
    await tx.query(`update staff.webauthn_credentials set sign_count = $2, last_used_at = now() where id = $1`, [row.id, next]);
    return { staffId: row.staff_id, credentialRowId: row.id };
  }

  private async auditFailure(tx: Queryable, staffId: string, reasonCode: string): Promise<void> {
    await appendAudit(tx, {
      actor: { type: 'STAFF', id: staffId },
      action: 'STAFF_WEBAUTHN_FAILED',
      objectType: 'staff.staff_account',
      objectId: staffId,
      outcome: 'FAILURE',
      reasonCode,
    });
  }
}
