/**
 * Phase-2 closure: SUPPORT capabilities of the accepted staff matrix (`docs/phase2/PHASE2_STAFF_AUTHORIZATION_MATRIX.md`
 * §3–§4): a masked account summary with a recorded reason, consumer session revocation on the account's behalf (fresh
 * staff step-up), and recovery assistance that opens or attaches a HUMAN review for an existing proof-bearing recovery
 * request — never a decision, never credential movement (founder Q-08). No bulk export exists.
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';

const IsoDateTime = z.iso.datetime({ offset: true });
const E = ErrorEnvelopeSchema;

/** Why the account is being looked at (closed list; audited with every access). */
export const SUPPORT_ACCESS_REASONS = ['CUSTOMER_CONTACT_VERIFIED', 'SAFETY_REPORT', 'FRAUD_INVESTIGATION', 'RECOVERY_ASSISTANCE'] as const;
const ReasonSchema = z.enum(SUPPORT_ACCESS_REASONS);

export const AccountSummaryRequestSchema = z
  .strictObject({ phone: z.string().min(1).max(40).optional(), accountId: z.uuid().optional(), reasonCode: ReasonSchema })
  .refine((v) => (v.phone === undefined) !== (v.accountId === undefined), { message: 'exactly one of phone or accountId' })
  .meta({ id: 'AccountSummaryRequest' });

/** Privacy-minimised: no full phone, CNIC, document numbers, evidence, OIDC subject, token, IP or location. */
export const AccountSupportSummarySchema = z
  .object({
    accountId: z.uuid(),
    status: z.enum(['ACTIVE', 'DELETION_PENDING', 'DELETED']),
    maskedPhone: z.string().nullable(),
    createdOn: z.iso.date(),
    riderProfile: z.boolean(),
    driver: z.object({ applicationState: z.string().nullable(), profileState: z.string().nullable(), cityCode: z.string().nullable() }),
    restrictions: z.array(z.object({ scope: z.string(), reasonClass: z.string(), reasonCode: z.string(), status: z.string() })),
    sessions: z.array(
      z.object({ id: z.uuid(), platform: z.enum(['ANDROID', 'IOS']), assurance: z.enum(['OTP', 'OIDC']), createdAt: IsoDateTime, lastUsedAt: IsoDateTime }),
    ),
    deviceCount: z.number().int().nonnegative(),
    strongRecoveryFactors: z.object({ linkedOidc: z.boolean(), driverKyc: z.boolean() }),
    recovery: z
      .object({ id: z.uuid(), kind: z.enum(['LOST_PHONE_DRIVER_KYC', 'LOST_PHONE_OIDC', 'PHONE_CHANGE', 'DORMANT_NUMBER']), status: z.string() })
      .nullable(),
    deletion: z.object({ status: z.string() }).nullable(),
    requiredActions: z.array(z.string()),
  })
  .meta({ id: 'AccountSupportSummary' });
export type AccountSupportSummary = z.infer<typeof AccountSupportSummarySchema>;

export const SupportSessionRevocationRequestSchema = z
  .strictObject({ scope: z.enum(['ALL', 'ONE']), sessionId: z.uuid().optional(), reasonCode: ReasonSchema })
  .refine((v) => (v.scope === 'ONE') === (v.sessionId !== undefined), { message: 'sessionId is required for ONE and only for it' })
  .meta({ id: 'SupportSessionRevocationRequest' });
export const SupportSessionRevocationResultSchema = z.object({ revokedCount: z.number().int().nonnegative() }).meta({ id: 'SupportSessionRevocationResult' });

export const RecoveryAssistanceRequestSchema = z.strictObject({ reasonCode: ReasonSchema }).meta({ id: 'RecoveryAssistanceRequest' });
export const RecoveryAssistanceSchema = z
  .object({ reviewCaseId: z.uuid(), opened: z.boolean(), priority: z.number().int() })
  .meta({ id: 'RecoveryAssistance' });

const AccountParam = z.strictObject({ accountId: z.uuid() });
const RecoveryParam = z.strictObject({ id: z.uuid() });

export const SUPPORT_ROUTES = [
  {
    operationId: 'viewAccountSummary',
    method: 'POST',
    path: '/v1/admin/account-summaries',
    summary: 'Masked account summary for support/Trust & Safety, by phone or account id, with a recorded reason.',
    auth: 'staff',
    request: AccountSummaryRequestSchema,
    responses: { 200: AccountSupportSummarySchema, 400: E, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'revokeSessionsOnBehalf',
    method: 'POST',
    path: '/v1/admin/accounts/{accountId}/session-revocations',
    summary: "Revoke one or all of an account's sessions on its behalf (fresh staff step-up; reason recorded).",
    auth: 'staff',
    params: AccountParam,
    request: SupportSessionRevocationRequestSchema,
    responses: { 200: SupportSessionRevocationResultSchema, 400: E, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'assistRecovery',
    method: 'POST',
    path: '/v1/admin/account-recoveries/{id}/assistance',
    summary: 'Open or attach the human review of an existing proof-bearing recovery request (never decides it).',
    auth: 'staff',
    params: RecoveryParam,
    request: RecoveryAssistanceRequestSchema,
    responses: { 200: RecoveryAssistanceSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
] as const satisfies readonly RouteContract[];
