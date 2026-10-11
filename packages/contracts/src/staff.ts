/**
 * Staff realm contracts (`/v1/admin/*`; H01, H08, K10, Q39, Q42, W07; staff matrix). Called ONLY by the web-ops BFF:
 * the staff session token never reaches browser JavaScript. WebAuthn option/response objects are standard WebAuthn
 * JSON verified by SimpleWebAuthn on the server; the contract only bounds their outer shape.
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';

const IsoDateTime = z.iso.datetime({ offset: true });
const E = ErrorEnvelopeSchema;

export const STAFF_ROLE_VALUES = [
  'KYC_REVIEWER',
  'KYC_SENIOR_REVIEWER',
  'COMPLIANCE_ADMIN',
  'TRUST_SAFETY_AGENT',
  'SUPPORT_AGENT',
  'STAFF_ADMIN',
  'AUDITOR',
] as const;
const StaffRoleSchema = z.enum(STAFF_ROLE_VALUES);
const CityCodeSchema = z.string().regex(/^[A-Z]{3}$/);

/** WebAuthn options (PublicKeyCredentialCreation/RequestOptionsJSON) passed to the browser unchanged. */
const WebAuthnOptionsSchema = z.record(z.string(), z.unknown());
/** Registration/AuthenticationResponseJSON from the browser (verified server-side; outer shape bounded here). */
const WebAuthnCredentialSchema = z.looseObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{16,1400}$/),
  rawId: z.string().regex(/^[A-Za-z0-9_-]{16,1400}$/),
  type: z.literal('public-key'),
  response: z.record(z.string(), z.unknown()),
});

export const WebAuthnChallengeSchema = z.object({ challengeId: z.uuid(), options: WebAuthnOptionsSchema }).meta({ id: 'WebAuthnChallenge' });
const InvitationTokenSchema = z.string().regex(/^wvi_[A-Za-z0-9_-]{43}$/);

export const EnrolmentOptionsRequestSchema = z.strictObject({ invitationToken: InvitationTokenSchema }).meta({ id: 'EnrolmentOptionsRequest' });
export const EnrolmentRequestSchema = z
  .strictObject({
    challengeId: z.uuid(),
    invitationToken: InvitationTokenSchema,
    credential: WebAuthnCredentialSchema,
    nickname: z.string().trim().min(1).max(60),
  })
  .meta({ id: 'EnrolmentRequest' });
export const EmptyRequestSchema = z.strictObject({}).meta({ id: 'EmptyRequest' });
export const AssertionRequestSchema = z.strictObject({ challengeId: z.uuid(), credential: WebAuthnCredentialSchema }).meta({ id: 'AssertionRequest' });
export const CredentialRegistrationRequestSchema = z
  .strictObject({ challengeId: z.uuid(), credential: WebAuthnCredentialSchema, nickname: z.string().trim().min(1).max(60) })
  .meta({ id: 'CredentialRegistrationRequest' });

/** Issued to the BFF only; it sets an HttpOnly cookie and never forwards the token to the browser. */
export const StaffSessionIssuedSchema = z
  .object({ sessionId: z.uuid(), sessionToken: z.string().regex(/^wvs_[A-Za-z0-9_-]{43}$/), absoluteExpiresAt: IsoDateTime })
  .meta({ id: 'StaffSessionIssued' });

export const StaffMeSchema = z
  .object({
    staff: z.object({ id: z.uuid(), displayName: z.string() }),
    session: z.object({ id: z.uuid(), status: z.enum(['ACTIVE', 'LOCKED']), absoluteExpiresAt: IsoDateTime, stepUpFresh: z.boolean() }),
    roles: z.array(z.object({ assignmentId: z.uuid(), role: StaffRoleSchema, cities: z.array(CityCodeSchema) })),
    /** Server-computed allowed actions for UX only; the API authorises every call. */
    permissions: z.array(z.string()),
    activeCredentials: z.number().int().nonnegative(),
    /** Two registered authenticators are required before privileged operations on real KYC data (ops.kyc-real-evidence). */
    twoAuthenticatorRuleSatisfied: z.boolean(),
    breakGlass: z.object({ id: z.uuid(), expiresAt: IsoDateTime }).nullable(),
    environment: z.enum(['LOCAL', 'TEST', 'STAGING', 'PRODUCTION']),
    /** Banner data for STAFF_ADMIN/AUDITOR (break-glass grants active or awaiting review); null without that permission. */
    pendingBreakGlassReviews: z.number().int().nonnegative().nullable(),
  })
  .meta({ id: 'StaffMe' });
export type StaffMe = z.infer<typeof StaffMeSchema>;

export const CredentialListSchema = z
  .object({
    credentials: z.array(
      z.object({
        id: z.uuid(),
        nickname: z.string(),
        deviceType: z.enum(['singleDevice', 'multiDevice']),
        backedUp: z.boolean(),
        createdAt: IsoDateTime,
        lastUsedAt: IsoDateTime.nullable(),
      }),
    ),
  })
  .meta({ id: 'CredentialList' });
export const IdParamSchema = z.strictObject({ id: z.uuid() });

export const StaffRosterQuerySchema = z.strictObject({ cursor: z.uuid().optional() });
export const StaffRosterSchema = z
  .object({
    staff: z.array(
      z.object({
        id: z.uuid(),
        displayName: z.string(),
        status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED']),
        roles: z.array(
          z.object({ assignmentId: z.uuid(), role: StaffRoleSchema, status: z.enum(['PENDING_APPROVAL', 'ACTIVE']), cities: z.array(CityCodeSchema) }),
        ),
        activeCredentials: z.number().int().nonnegative(),
      }),
    ),
    /** Paginated, max 50 per page; there is no export (Q-15). */
    nextCursor: z.uuid().nullable(),
  })
  .meta({ id: 'StaffRoster' });

export const StaffInvitationRequestSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(80),
    workEmail: z
      .email()
      .max(254)
      .transform((e) => e.toLowerCase()),
  })
  .meta({ id: 'StaffInvitationRequest' });
/** The invitation token is returned once, to be delivered out of band (no e-mail channel in Phase 2, Q-03). */
export const StaffInvitationIssuedSchema = z
  .object({ staffId: z.uuid(), invitationId: z.uuid(), invitationToken: InvitationTokenSchema, expiresAt: IsoDateTime })
  .meta({ id: 'StaffInvitationIssued' });
export const ReEnrolmentRequestedSchema = z.object({ invitationId: z.uuid(), status: z.literal('PENDING_APPROVAL') }).meta({ id: 'ReEnrolmentRequested' });

export const RoleGrantRequestSchema = z
  .strictObject({ staffId: z.uuid(), role: StaffRoleSchema, cityCodes: z.array(CityCodeSchema).max(20).default([]) })
  .meta({ id: 'RoleGrantRequest' });
export const RoleDecisionRequestSchema = z.strictObject({ decision: z.enum(['APPROVE', 'REJECT']) }).meta({ id: 'RoleDecisionRequest' });
export const RoleAssignmentStateSchema = z
  .object({ assignmentId: z.uuid(), status: z.enum(['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'REVOKED']) })
  .meta({ id: 'RoleAssignmentState' });
export const OffboardingResultSchema = z
  .object({
    revokedSessions: z.number().int().nonnegative(),
    revokedCredentials: z.number().int().nonnegative(),
    endedAssignments: z.number().int().nonnegative(),
  })
  .meta({ id: 'OffboardingResult' });

export const BREAK_GLASS_REASON_VALUES = ['SAFETY_EMERGENCY', 'ACTIVE_FRAUD_ATTACK', 'LEGAL_ORDER', 'SYSTEM_RECOVERY'] as const;
export const BreakGlassRequestSchema = z
  .strictObject({
    reasonCode: z.enum(BREAK_GLASS_REASON_VALUES),
    justification: z.string().trim().min(10).max(500),
    durationMinutes: z.number().int().min(5).max(60),
  })
  .meta({ id: 'BreakGlassRequest' });
export const BreakGlassGrantSchema = z
  .object({
    id: z.uuid(),
    staffId: z.uuid(),
    reasonCode: z.enum(BREAK_GLASS_REASON_VALUES),
    status: z.enum(['ACTIVE', 'ENDED', 'EXPIRED', 'REVIEWED']),
    startedAt: IsoDateTime,
    expiresAt: IsoDateTime,
    endedAt: IsoDateTime.nullable(),
    reviewOutcome: z.enum(['JUSTIFIED', 'NOT_JUSTIFIED']).nullable(),
    /** A review is due within 72 h of the start. */
    reviewDueAt: IsoDateTime,
  })
  .meta({ id: 'BreakGlassGrant' });
export const BreakGlassListSchema = z.object({ grants: z.array(BreakGlassGrantSchema) }).meta({ id: 'BreakGlassList' });
export const BreakGlassReviewRequestSchema = z.strictObject({ outcome: z.enum(['JUSTIFIED', 'NOT_JUSTIFIED']) }).meta({ id: 'BreakGlassReviewRequest' });

export const AuditEventQuerySchema = z.strictObject({
  beforeSeq: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .optional(),
  actorType: z.enum(['ACCOUNT', 'STAFF', 'SYSTEM', 'ANONYMOUS']).optional(),
  actorId: z.uuid().optional(),
  action: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{2,63}$/)
    .optional(),
  objectType: z
    .string()
    .regex(/^[a-z][a-z0-9_.]{1,63}$/)
    .optional(),
  objectId: z.uuid().optional(),
});
export const AuditEventListSchema = z
  .object({
    events: z.array(
      z.object({
        seq: z.string(),
        id: z.uuid(),
        occurredAt: IsoDateTime,
        actorType: z.enum(['ACCOUNT', 'STAFF', 'SYSTEM', 'ANONYMOUS']),
        actorId: z.uuid().nullable(),
        action: z.string(),
        objectType: z.string(),
        objectId: z.uuid().nullable(),
        outcome: z.enum(['SUCCESS', 'DENIED', 'FAILURE']),
        reasonCode: z.string().nullable(),
        requestId: z.string().nullable(),
      }),
    ),
    nextBeforeSeq: z.string().nullable(),
  })
  .meta({ id: 'AuditEventList' });
export const SealStatusSchema = z
  .object({
    sealCount: z.number().int().nonnegative(),
    lastSealedSeq: z.string().nullable(),
    lastSealedAt: IsoDateTime.nullable(),
    lastVerification: z
      .object({ verifiedAt: IsoDateTime, ok: z.boolean(), firstBadSealNo: z.string().nullable(), unsealedBelowWatermark: z.number().int() })
      .nullable(),
    /** External anchoring of seal hashes is gate EG-05; until then a database superuser could rewrite and re-seal. */
    externalAnchoring: z.literal('NOT_CONFIGURED_EG_05'),
  })
  .meta({ id: 'SealStatus' });
export const VerificationRequestedSchema = z.object({ jobId: z.uuid() }).meta({ id: 'VerificationRequested' });

export const STAFF_ROUTES = [
  {
    operationId: 'staffEnrolmentOptions',
    method: 'POST',
    path: '/v1/admin/auth/enrolment-options',
    summary: 'WebAuthn registration options for an invitation.',
    auth: 'public',
    request: EnrolmentOptionsRequestSchema,
    responses: { 200: WebAuthnChallengeSchema, 400: E, 401: E, 409: E, 429: E },
  },
  {
    operationId: 'staffEnrol',
    method: 'POST',
    path: '/v1/admin/auth/enrolments',
    summary: 'Complete enrolment with a WebAuthn credential (user verification required).',
    auth: 'public',
    request: EnrolmentRequestSchema,
    responses: { 201: StaffSessionIssuedSchema, 400: E, 401: E, 409: E, 429: E },
  },
  {
    operationId: 'staffLoginOptions',
    method: 'POST',
    path: '/v1/admin/auth/login-options',
    summary: 'WebAuthn authentication options (discoverable credentials).',
    auth: 'public',
    request: EmptyRequestSchema,
    responses: { 200: WebAuthnChallengeSchema, 400: E, 409: E, 429: E },
  },
  {
    operationId: 'staffLogin',
    method: 'POST',
    path: '/v1/admin/auth/sessions',
    summary: 'Sign in with a WebAuthn assertion.',
    auth: 'public',
    request: AssertionRequestSchema,
    responses: { 201: StaffSessionIssuedSchema, 400: E, 401: E, 409: E, 429: E },
  },
  {
    operationId: 'staffStepUpOptions',
    method: 'POST',
    path: '/v1/admin/auth/step-up-options',
    summary: 'WebAuthn options for a step-up of the current session.',
    auth: 'staff',
    request: EmptyRequestSchema,
    responses: { 200: WebAuthnChallengeSchema, 401: E, 409: E },
  },
  {
    operationId: 'staffStepUp',
    method: 'POST',
    path: '/v1/admin/auth/step-ups',
    summary: 'Fresh WebAuthn assertion: privileged actions are allowed for the step-up window.',
    auth: 'staff',
    request: AssertionRequestSchema,
    responses: { 204: null, 400: E, 401: E, 409: E },
  },
  {
    operationId: 'staffUnlockOptions',
    method: 'POST',
    path: '/v1/admin/auth/unlock-options',
    summary: 'WebAuthn options to unlock an idle-locked session.',
    auth: 'staff',
    request: EmptyRequestSchema,
    responses: { 200: WebAuthnChallengeSchema, 401: E, 409: E },
  },
  {
    operationId: 'staffUnlock',
    method: 'POST',
    path: '/v1/admin/auth/unlocks',
    summary: 'Unlock an idle-locked session with a WebAuthn assertion.',
    auth: 'staff',
    request: AssertionRequestSchema,
    responses: { 204: null, 400: E, 401: E, 409: E },
  },
  {
    operationId: 'staffLogout',
    method: 'DELETE',
    path: '/v1/admin/auth/sessions/current',
    summary: 'End the current staff session.',
    auth: 'staff',
    responses: { 204: null, 401: E, 409: E },
  },
  {
    operationId: 'staffMe',
    method: 'GET',
    path: '/v1/admin/me',
    summary: 'The calling staff member, session state, roles, allowed actions and environment.',
    auth: 'staff',
    responses: { 200: StaffMeSchema, 401: E },
  },
  {
    operationId: 'staffCredentials',
    method: 'GET',
    path: '/v1/admin/me/credentials',
    summary: 'Own registered authenticators.',
    auth: 'staff',
    responses: { 200: CredentialListSchema, 401: E },
  },
  {
    operationId: 'staffCredentialOptions',
    method: 'POST',
    path: '/v1/admin/me/credential-options',
    summary: 'WebAuthn options to register an additional authenticator (step-up).',
    auth: 'staff',
    request: EmptyRequestSchema,
    responses: { 200: WebAuthnChallengeSchema, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'staffAddCredential',
    method: 'POST',
    path: '/v1/admin/me/credentials',
    summary: 'Register an additional authenticator (step-up).',
    auth: 'staff',
    request: CredentialRegistrationRequestSchema,
    responses: { 201: null, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'staffRevokeCredential',
    method: 'DELETE',
    path: '/v1/admin/me/credentials/{id}',
    summary: 'Revoke one of the own authenticators (never the last one; step-up).',
    auth: 'staff',
    params: IdParamSchema,
    responses: { 204: null, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'staffRoster',
    method: 'GET',
    path: '/v1/admin/staff',
    summary: 'Paginated staff roster (no export).',
    auth: 'staff',
    query: StaffRosterQuerySchema,
    responses: { 200: StaffRosterSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'staffInvite',
    method: 'POST',
    path: '/v1/admin/staff-invitations',
    summary: 'Invite a staff member (no role; roles are granted separately with maker-checker).',
    auth: 'staff',
    request: StaffInvitationRequestSchema,
    responses: { 201: StaffInvitationIssuedSchema, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'staffApproveReEnrolment',
    method: 'POST',
    path: '/v1/admin/staff-invitations/{id}/approval',
    summary: 'Second STAFF_ADMIN approves a re-enrolment invitation; returns the token once.',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 201: StaffInvitationIssuedSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'staffRequestReEnrolment',
    method: 'POST',
    path: '/v1/admin/staff/{id}/re-enrolments',
    summary: 'Request a re-enrolment invitation for a staff member who lost every authenticator (maker-checker).',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 201: ReEnrolmentRequestedSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'staffOffboard',
    method: 'POST',
    path: '/v1/admin/staff/{id}/offboarding',
    summary: 'Offboard: revoke sessions and credentials, end role assignments.',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 200: OffboardingResultSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'staffGrantRole',
    method: 'POST',
    path: '/v1/admin/role-assignments',
    summary: 'Request a role grant (active immediately only for roles without maker-checker).',
    auth: 'staff',
    request: RoleGrantRequestSchema,
    responses: { 201: RoleAssignmentStateSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'staffDecideRole',
    method: 'POST',
    path: '/v1/admin/role-assignments/{id}/approval',
    summary: 'A different STAFF_ADMIN approves or rejects a pending grant.',
    auth: 'staff',
    params: IdParamSchema,
    request: RoleDecisionRequestSchema,
    responses: { 200: RoleAssignmentStateSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'staffRevokeRole',
    method: 'POST',
    path: '/v1/admin/role-assignments/{id}/revocation',
    summary: 'Revoke a role assignment.',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 200: RoleAssignmentStateSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'breakGlassActivate',
    method: 'POST',
    path: '/v1/admin/break-glass',
    summary: 'Activate a scoped break-glass grant (≤ 60 min, alerted, reviewed within 72 h).',
    auth: 'staff',
    request: BreakGlassRequestSchema,
    responses: { 201: BreakGlassGrantSchema, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'breakGlassEnd',
    method: 'POST',
    path: '/v1/admin/break-glass/{id}/end',
    summary: 'End the own active break-glass grant.',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 200: BreakGlassGrantSchema, 401: E, 404: E, 409: E },
  },
  {
    operationId: 'breakGlassList',
    method: 'GET',
    path: '/v1/admin/break-glass',
    summary: 'Break-glass grants (newest first, max 100) for review.',
    auth: 'staff',
    responses: { 200: BreakGlassListSchema, 401: E, 403: E },
  },
  {
    operationId: 'breakGlassReview',
    method: 'POST',
    path: '/v1/admin/break-glass/{id}/review',
    summary: 'Record the mandatory review of an ended grant (never by its holder).',
    auth: 'staff',
    params: IdParamSchema,
    request: BreakGlassReviewRequestSchema,
    responses: { 200: BreakGlassGrantSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'auditEvents',
    method: 'GET',
    path: '/v1/admin/audit-events',
    summary: 'Audit events (AUDITOR; keyset pagination, max 100 per page, no export).',
    auth: 'staff',
    query: AuditEventQuerySchema,
    responses: { 200: AuditEventListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'auditSealStatus',
    method: 'GET',
    path: '/v1/admin/audit-seals/status',
    summary: 'Seal chain status and the latest verification result.',
    auth: 'staff',
    responses: { 200: SealStatusSchema, 401: E, 403: E },
  },
  {
    operationId: 'auditSealVerify',
    method: 'POST',
    path: '/v1/admin/audit-seals/verifications',
    summary: 'Request a full seal verification (runs in the worker).',
    auth: 'staff',
    request: EmptyRequestSchema,
    responses: { 202: VerificationRequestedSchema, 401: E, 403: E, 409: E },
  },
] as const satisfies readonly RouteContract[];
