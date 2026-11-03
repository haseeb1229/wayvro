/**
 * P2.1 consumer identity contracts (docs/phase2/PHASE2_API_AND_SURFACES.md §2.1–§2.2). Request bodies are strict:
 * server-owned fields (account ids, roles, modes, KYC state, assurance) cannot be supplied by clients.
 */
import { z } from 'zod';
import { AccountDriverSectionSchema, AccountRestrictionSchema } from './compliance.js';

export const LOCALES = ['en', 'ur', 'ur-Latn'] as const;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;

/** App-generated random installation id (never a hardware identifier). */
export const InstallationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const IsoDateTime = z.iso.datetime({ offset: true });

// ── OTP ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const OtpChallengeRequestSchema = z
  .strictObject({
    phone: z.string().min(1).max(40),
    purpose: z.literal('SIGN_IN'),
    installationId: InstallationIdSchema,
    locale: LocaleSchema,
  })
  .meta({ id: 'OtpChallengeRequest' });
export type OtpChallengeRequest = z.infer<typeof OtpChallengeRequestSchema>;

/** Identical for every syntactically valid +92 mobile number, whether or not a code was actually sent. */
export const OtpChallengeSchema = z
  .object({
    challengeId: z.uuid(),
    expiresAt: IsoDateTime,
    resendAvailableAt: IsoDateTime,
    channel: z.literal('SMS'),
    maskedDestination: z.string().min(1).max(32),
  })
  .meta({ id: 'OtpChallenge' });
export type OtpChallenge = z.infer<typeof OtpChallengeSchema>;

export const OtpResendRequestSchema = z.strictObject({ installationId: InstallationIdSchema }).meta({ id: 'OtpResendRequest' });
export const ChallengeIdParamSchema = z.strictObject({ challengeId: z.uuid() });

// ── sessions ────────────────────────────────────────────────────────────────────────────────────────────────────
export const DEVICE_PLATFORMS = ['ANDROID', 'IOS'] as const;
const AppVersionSchema = z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/);

export const SessionCreateRequestSchema = z
  .strictObject({
    challengeId: z.uuid(),
    code: z.string().regex(/^\d{6}$/),
    installationId: InstallationIdSchema,
    device: z.strictObject({ platform: z.enum(DEVICE_PLATFORMS), appVersion: AppVersionSchema }),
  })
  .meta({ id: 'SessionCreateRequest' });
export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>;

/** Planned required actions; P2.1 emits none (policies/age declaration arrive in P2.2, recovery review in P2.9). */
export const REQUIRED_ACTIONS = ['ACCEPT_POLICIES', 'AGE_DECLARATION', 'PHONE_STEP_UP', 'RECOVERY_REVIEW'] as const;
const RequiredActionSchema = z.enum(REQUIRED_ACTIONS);

export const SessionTokensSchema = z
  .object({
    sessionId: z.uuid(),
    accessToken: z.string().min(1),
    accessTokenExpiresAt: IsoDateTime,
    refreshToken: z.string().min(1),
    refreshTokenExpiresAt: IsoDateTime,
  })
  .meta({ id: 'SessionTokens' });
export type SessionTokens = z.infer<typeof SessionTokensSchema>;

export const SessionCreatedSchema = SessionTokensSchema.extend({
  isNewAccount: z.boolean(),
  requiredActions: z.array(RequiredActionSchema),
}).meta({ id: 'SessionCreated' });
export type SessionCreated = z.infer<typeof SessionCreatedSchema>;

export const TokenRefreshRequestSchema = z.strictObject({ refreshToken: z.string().min(1).max(200) }).meta({ id: 'TokenRefreshRequest' });

// ── unified-app modes (Phase 3, ADR-048) ─────────────────────────────────────────────────────────────────────────
export const RIDER_MODE_BLOCKERS = ['ACCOUNT_RESTRICTED', 'DELETION_PENDING'] as const;
export const DRIVER_MODE_BLOCKERS = [
  'ONBOARDING_UNAVAILABLE',
  'APPLICATION_PENDING',
  'APPLICATION_REJECTED',
  'DOCUMENTS_EXPIRED',
  'PROFILE_REVERIFICATION_DUE',
  'ROLE_RESTRICTED',
  'ACCOUNT_RESTRICTED',
  'DELETION_PENDING',
] as const;
export const AccountModesSchema = z.object({
  rider: z.object({ available: z.boolean(), blockers: z.array(z.enum(RIDER_MODE_BLOCKERS)) }),
  driver: z.object({
    /** HUB: a driver profile exists (any state); ONBOARDING: no profile, onboarding available or an application exists. */
    entry: z.enum(['NONE', 'ONBOARDING', 'HUB']),
    /** May the Driver/Partner AREA be shown — not "may earn" (going online does not exist in Phase 3). */
    available: z.boolean(),
    blockers: z.array(z.enum(DRIVER_MODE_BLOCKERS)),
  }),
});
export type AccountModes = z.infer<typeof AccountModesSchema>;

// ── account ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Display names: 1..60 characters after trimming; no control characters and no bidi overrides (spoofing).
const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[^\p{Cc}‪-‮⁦-⁩]+$/u);

export const AccountStateSchema = z
  .object({
    account: z.object({
      id: z.uuid(),
      /** P2.9 (additive): DELETION_PENDING during the deletion grace period (the session is restricted). */
      status: z.enum(['ACTIVE', 'DELETION_PENDING']),
      displayName: z.string().nullable(),
      preferredLocale: LocaleSchema,
      createdAt: IsoDateTime,
    }),
    session: z.object({
      id: z.uuid(),
      assurance: z.literal('OTP'),
      accessTokenExpiresAt: IsoDateTime,
      /** P2.9 (additive): until when this session counts as stepped up (null = not stepped up). */
      stepUpExpiresAt: IsoDateTime.nullable().optional(),
    }),
    riderProfile: z.object({ id: z.uuid(), status: z.literal('ACTIVE') }),
    requiredActions: z.array(RequiredActionSchema),
    /** P2.5 (additive): Driver/Partner application/profile summary — server truth for routing, never a capability. */
    driver: AccountDriverSectionSchema,
    /** P2.5 (additive): restrictions affecting this account, its driver profile or its vehicles (V13). */
    restrictions: z.array(AccountRestrictionSchema),
    /**
     * Phase 3 (additive, optional for one release window; V08/ADR-048): server-derived mode availability for the ONE app.
     * Presentation only — it explains which mode home the app may show; it never authorises anything (every driver
     * route re-checks capability server-side). Clients without it derive the same values from `driver` and
     * `restrictions`.
     */
    modes: AccountModesSchema.optional(),
  })
  .meta({ id: 'AccountState' });
export type AccountState = z.infer<typeof AccountStateSchema>;

export const ProfileUpdateRequestSchema = z
  .strictObject({ displayName: DisplayNameSchema.nullable().optional(), preferredLocale: LocaleSchema.optional() })
  .refine((v) => v.displayName !== undefined || v.preferredLocale !== undefined, { message: 'at least one field is required' })
  .meta({ id: 'ProfileUpdateRequest' });
export type ProfileUpdateRequest = z.infer<typeof ProfileUpdateRequestSchema>;

export const ProfileSchema = z.object({ displayName: z.string().nullable(), preferredLocale: LocaleSchema }).meta({ id: 'Profile' });

/** Session list entries carry no IP address and no location; timestamps are truncated to the hour. */
export const SessionListSchema = z
  .object({
    sessions: z.array(
      z.object({
        id: z.uuid(),
        current: z.boolean(),
        platform: z.enum(DEVICE_PLATFORMS),
        appVersion: z.string(),
        createdAt: IsoDateTime,
        lastUsedAt: IsoDateTime,
      }),
    ),
  })
  .meta({ id: 'SessionList' });
export type SessionList = z.infer<typeof SessionListSchema>;

export const SessionIdParamSchema = z.strictObject({ sessionId: z.uuid() });

export const SessionRevocationRequestSchema = z.strictObject({ scope: z.enum(['ALL', 'ALL_OTHERS']) }).meta({ id: 'SessionRevocationRequest' });
export const SessionRevocationResultSchema = z.object({ revokedCount: z.number().int().nonnegative() }).meta({ id: 'SessionRevocationResult' });

export const SECURITY_EVENT_TYPES = [
  'SIGN_IN',
  'SIGN_IN_NEW_DEVICE',
  'DORMANT_ACCOUNT_NEW_INSTALLATION',
  'SIGNED_OUT',
  'SESSION_REVOKED',
  'SESSIONS_REVOKED_ALL',
  'SESSIONS_REVOKED_OTHERS',
  'REFRESH_TOKEN_REUSE_DETECTED',
  'PROFILE_UPDATED',
  // P2.9 (additive)
  'STEP_UP_VERIFIED',
  'PHONE_CHANGE_REQUESTED',
  'PHONE_CHANGED',
  'PHONE_CHANGE_CANCELLED',
  'RECOVERY_REQUESTED',
  'RECOVERY_APPROVED_COOLDOWN',
  'RECOVERY_COMPLETED',
  'RECOVERY_DENIED',
  'DORMANT_NUMBER_RELEASED',
  'DELETION_REQUESTED',
  'DELETION_CANCELLED',
  // P2.10 (additive)
  'SIGN_IN_OIDC',
  'OIDC_LINKED',
  'OIDC_UNLINKED',
  // Phase-2 closure (additive): support revoked sessions on the account's behalf
  'SESSIONS_REVOKED_BY_SUPPORT',
] as const;
export const SecurityEventListSchema = z
  .object({ events: z.array(z.object({ id: z.uuid(), type: z.enum(SECURITY_EVENT_TYPES), occurredAt: IsoDateTime })) })
  .meta({ id: 'SecurityEventList' });
export type SecurityEventList = z.infer<typeof SecurityEventListSchema>;
