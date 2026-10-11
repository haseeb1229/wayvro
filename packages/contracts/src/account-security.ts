/**
 * P2.9 account security contracts (docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md §5–§6; data model §4.1–§4.2, §4.9;
 * A05/K08/K17/S12/S13/U06): consumer step-up, self-service phone change, "this wasn't me" cancellation, lost-phone
 * recovery (strong proof only), the dormant-number review and account deletion (app and web).
 *
 * Responses that could reveal whether another account or phone exists are generic: a phone change to a number that is
 * current on another account is refused with the same 409 as any other conflict; a recovery request and a web
 * deletion request always answer `RECEIVED`.
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';
import { InstallationIdSchema, LocaleSchema, OtpChallengeSchema, SessionCreatedSchema } from './identity.js';

const IsoDateTime = z.iso.datetime({ offset: true });
const Code = z.string().regex(/^\d{6}$/);
const Phone = z.string().min(1).max(40);
const E = ErrorEnvelopeSchema;

// ── step-up (fresh OTP on the CURRENT phone; ≤ 10 minutes) ─────────────────────────────────────────────────────
export const StepUpVerificationRequestSchema = z.strictObject({ code: Code }).meta({ id: 'StepUpVerificationRequest' });
export const StepUpSchema = z.object({ stepUpExpiresAt: IsoDateTime }).meta({ id: 'StepUp' });

// ── phone change and recovery requests ─────────────────────────────────────────────────────────────────────────
/** Kinds and states in use (the OIDC-proof recovery of P2.10 adds its kind and states additively). */
export const PHONE_CHANGE_KINDS = ['SELF_SERVICE', 'RECOVERY_DRIVER_KYC'] as const;
export const PHONE_CHANGE_STATUSES = ['CURRENT_PHONE_VERIFIED', 'MANUAL_REVIEW', 'COOLDOWN', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DENIED'] as const;
export const PhoneChangeRequestSchema = z.strictObject({ newPhone: Phone, locale: LocaleSchema }).meta({ id: 'PhoneChangeRequest' });
export const PhoneChangeSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(PHONE_CHANGE_KINDS),
    status: z.enum(PHONE_CHANGE_STATUSES),
    /** Masked new number (last digits only). */
    maskedNewPhone: z.string().min(1).max(32),
    /** Recovery requests wait this long after approval; any session of the account can cancel meanwhile. */
    cooldownUntil: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'PhoneChange' });
export type PhoneChange = z.infer<typeof PhoneChangeSchema>;
export const PhoneChangeStartedSchema = z.object({ phoneChange: PhoneChangeSchema, challenge: OtpChallengeSchema }).meta({ id: 'PhoneChangeStarted' });
export const PhoneChangeVerificationRequestSchema = z.strictObject({ challengeId: z.uuid(), code: Code }).meta({ id: 'PhoneChangeVerificationRequest' });
export const CurrentPhoneChangeSchema = z.object({ phoneChange: PhoneChangeSchema.nullable() }).meta({ id: 'CurrentPhoneChange' });
export const PhoneChangeParamSchema = z.strictObject({ id: z.uuid() });

/** Lost-phone recovery from the session of the NEW number. LINKED_OIDC arrives with P2.10 (flag off until then). */
export const AccountRecoveryRequestSchema = z
  .strictObject({ proof: z.enum(['LINKED_OIDC', 'DRIVER_KYC']), previousPhone: Phone })
  .meta({ id: 'AccountRecoveryRequest' });
/** Always RECEIVED: the response never reveals whether the previous number belongs to an account or what kind. */
export const AccountRecoveryReceiptSchema = z.object({ status: z.literal('RECEIVED') }).meta({ id: 'AccountRecoveryReceipt' });

// ── dormant-number review (restricted session; S12) ────────────────────────────────────────────────────────────
export const RECOVERY_REVIEW_CHOICES = ['I_AM_NEW', 'THIS_IS_MY_ACCOUNT'] as const;
export const RecoveryReviewSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['PENDING', 'IN_REVIEW', 'RESOLVED_OWNER', 'RESOLVED_NEW_ACCOUNT', 'DENIED']),
    /** The choices the server accepts for this account (THIS_IS_MY_ACCOUNT only where strong proof exists). */
    choices: z.array(z.enum(RECOVERY_REVIEW_CHOICES)),
  })
  .meta({ id: 'RecoveryReview' });
export const CurrentRecoveryReviewSchema = z.object({ review: RecoveryReviewSchema.nullable() }).meta({ id: 'CurrentRecoveryReview' });
export const RecoveryReviewChoiceRequestSchema = z.strictObject({ choice: z.enum(RECOVERY_REVIEW_CHOICES) }).meta({ id: 'RecoveryReviewChoiceRequest' });
/** I_AM_NEW answers with a session for the new clean account; THIS_IS_MY_ACCOUNT answers with the review (IN_REVIEW). */
export const RecoveryReviewOutcomeSchema = z
  .object({ review: RecoveryReviewSchema, newAccountSession: SessionCreatedSchema.nullable() })
  .meta({ id: 'RecoveryReviewOutcome' });

// ── account deletion (U06) ─────────────────────────────────────────────────────────────────────────────────────
export const DELETION_STATUSES = ['GRACE', 'BLOCKED', 'PROCESSING', 'COMPLETED', 'CANCELLED'] as const;
export const DELETION_BLOCKERS = ['LEGAL_HOLD', 'RECOVERY_IN_PROGRESS', 'OPEN_SAFETY_OR_FRAUD_INVESTIGATION'] as const;
export const DeletionRequestSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(DELETION_STATUSES),
    channel: z.enum(['APP', 'WEB']),
    graceUntil: IsoDateTime.nullable(),
    blockers: z.array(z.enum(DELETION_BLOCKERS)),
    /** Data kept after deletion and why (placeholder bases until the retention schedule clears EG-16). */
    retained: z.array(z.object({ dataCategory: z.string(), basisRef: z.string() })),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'DeletionRequest' });
export type DeletionRequest = z.infer<typeof DeletionRequestSchema>;
export const CurrentDeletionRequestSchema = z.object({ deletionRequest: DeletionRequestSchema.nullable() }).meta({ id: 'CurrentDeletionRequest' });
export const DeletionParamSchema = z.strictObject({ id: z.uuid() });

/** Web path (no app needed): an OTP for ACCOUNT_DELETION_WEB, then the request; every answer is generic. */
export const WebDeletionOtpRequestSchema = z
  .strictObject({ phone: Phone, browserId: InstallationIdSchema, locale: LocaleSchema })
  .meta({ id: 'WebDeletionOtpRequest' });
export const WebDeletionRequestSchema = z
  .strictObject({ challengeId: z.uuid(), code: Code, browserId: InstallationIdSchema })
  .meta({ id: 'WebDeletionRequest' });
export const WebDeletionReceiptSchema = z.object({ status: z.literal('RECEIVED') }).meta({ id: 'WebDeletionReceipt' });

export const ACCOUNT_SECURITY_ROUTES = [
  {
    operationId: 'createStepUp',
    method: 'POST',
    path: '/v1/account/step-ups',
    summary: 'Send a code to the current phone to confirm a sensitive action (step-up).',
    auth: 'session',
    responses: { 202: OtpChallengeSchema, 401: E, 403: E, 409: E, 429: E, 503: E },
  },
  {
    operationId: 'verifyStepUp',
    method: 'POST',
    path: '/v1/account/step-ups/{challengeId}/verifications',
    summary: 'Verify the step-up code; the session is stepped up for 10 minutes.',
    auth: 'session',
    params: z.strictObject({ challengeId: z.uuid() }),
    request: StepUpVerificationRequestSchema,
    responses: { 200: StepUpSchema, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'createPhoneChange',
    method: 'POST',
    path: '/v1/account/phone-changes',
    summary: 'Start a phone number change (fresh step-up required; a code goes to the new number).',
    auth: 'session',
    request: PhoneChangeRequestSchema,
    responses: { 201: PhoneChangeStartedSchema, 400: E, 401: E, 403: E, 409: E, 429: E, 503: E },
  },
  {
    operationId: 'verifyPhoneChange',
    method: 'POST',
    path: '/v1/account/phone-changes/{id}/verifications',
    summary: 'Verify the code sent to the new number and complete the change (generic refusal on any conflict).',
    auth: 'session',
    params: PhoneChangeParamSchema,
    request: PhoneChangeVerificationRequestSchema,
    responses: { 200: PhoneChangeSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'getCurrentPhoneChange',
    method: 'GET',
    path: '/v1/account/phone-changes/current',
    summary: 'The open phone change or recovery of the calling account, if any (so any session can cancel it).',
    auth: 'session',
    responses: { 200: CurrentPhoneChangeSchema, 401: E },
  },
  {
    operationId: 'cancelPhoneChange',
    method: 'POST',
    path: '/v1/account/phone-changes/{id}/cancellation',
    summary: '"This wasn\'t me": cancel an open phone change or recovery from any session of the account.',
    auth: 'session',
    params: PhoneChangeParamSchema,
    responses: { 200: PhoneChangeSchema, 401: E, 404: E, 409: E },
  },
  {
    operationId: 'createAccountRecovery',
    method: 'POST',
    path: '/v1/account-recoveries',
    summary: 'Lost-phone recovery of a previous account with strong proof only (always answers RECEIVED).',
    auth: 'session',
    request: AccountRecoveryRequestSchema,
    responses: { 202: AccountRecoveryReceiptSchema, 400: E, 401: E, 404: E, 429: E },
  },
  {
    operationId: 'getCurrentRecoveryReview',
    method: 'GET',
    path: '/v1/account/recovery-reviews/current',
    summary: 'The dormant-number review of a restricted session, if any.',
    auth: 'session',
    responses: { 200: CurrentRecoveryReviewSchema, 401: E },
  },
  {
    operationId: 'chooseRecoveryReview',
    method: 'POST',
    path: '/v1/account/recovery-reviews/{id}/choices',
    summary: 'Answer the dormant-number review: start a new account, or claim the account with strong proof.',
    auth: 'session',
    params: PhoneChangeParamSchema,
    request: RecoveryReviewChoiceRequestSchema,
    responses: { 200: RecoveryReviewOutcomeSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'createDeletionRequest',
    method: 'POST',
    path: '/v1/account/deletion-requests',
    summary: 'Request account deletion (fresh step-up; grace period; blockers listed explicitly).',
    auth: 'session',
    responses: { 201: DeletionRequestSchema, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'getCurrentDeletionRequest',
    method: 'GET',
    path: '/v1/account/deletion-requests/current',
    summary: 'The open deletion request of the calling account, if any.',
    auth: 'session',
    responses: { 200: CurrentDeletionRequestSchema, 401: E },
  },
  {
    operationId: 'cancelDeletionRequest',
    method: 'POST',
    path: '/v1/account/deletion-requests/{id}/cancellation',
    summary: 'Cancel a deletion request within the grace period.',
    auth: 'session',
    params: DeletionParamSchema,
    responses: { 200: DeletionRequestSchema, 401: E, 404: E, 409: E },
  },
  {
    operationId: 'createWebDeletionOtp',
    method: 'POST',
    path: '/v1/public/account-deletion-otp-challenges',
    summary: 'Web deletion path: request a code (identical answer for every syntactically valid number).',
    auth: 'public',
    request: WebDeletionOtpRequestSchema,
    responses: { 202: OtpChallengeSchema, 400: E, 429: E, 503: E },
  },
  {
    operationId: 'createWebDeletionRequest',
    method: 'POST',
    path: '/v1/public/account-deletion-requests',
    summary: 'Web deletion path: verify the code and record the request (always RECEIVED when the code is valid).',
    auth: 'public',
    request: WebDeletionRequestSchema,
    responses: { 202: WebDeletionReceiptSchema, 400: E, 401: E, 429: E },
  },
] as const satisfies readonly RouteContract[];
