// FROZEN Phase-2 consumer contract baseline: main @ b1a1986, packages/contracts/src/legal.ts (COMPAT-N1,
// docs/phase3/PHASE3_TEST_STRATEGY.md §4.10). TEST-ONLY: outside src/, so never built, exported or imported by production
// code. Copied verbatim and never edited except to fix import paths: it is what a Phase-2 client parses responses with.
/**
 * P2.2 policy, consent and age-declaration contracts (A04, R09, W05, K14 consent infrastructure, A15 mechanism;
 * docs/phase2/PHASE2_API_AND_SURFACES.md §2.2). Policy keys/locales mirror @wayvro/legal-content; clients never
 * hard-code an age threshold — the age policy is served by the API.
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';
import { REQUIRED_ACTIONS } from './identity.js';

export const POLICY_KEYS = [
  'TERMS',
  'PRIVACY',
  'DRIVER_PARTNER_AGREEMENT',
  'BIOMETRIC_KYC_NOTICE',
  'COMMUNITY_GUIDELINES',
  'CANCELLATION_REFUND',
  'AGE_ELIGIBILITY',
] as const;
export const PolicyKeySchema = z.enum(POLICY_KEYS);
export type PolicyKey = z.infer<typeof PolicyKeySchema>;

export const POLICY_LOCALES = ['en', 'ur'] as const;
export const PolicyLocaleSchema = z.enum(POLICY_LOCALES);
const IsoDateTime = z.iso.datetime({ offset: true });
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

export const PolicyQuerySchema = z.strictObject({ locale: PolicyLocaleSchema.default('en') });

const PolicySummarySchema = z
  .object({
    policyKey: PolicyKeySchema,
    version: z.number().int().positive(),
    locale: PolicyLocaleSchema,
    title: z.string().min(1),
    /** `PLACEHOLDER_NOT_FOR_PRODUCTION` texts are not counsel-approved (EG-02) and must be labelled as such. */
    status: z.enum(['PLACEHOLDER_NOT_FOR_PRODUCTION', 'APPROVED']),
    effectiveAt: IsoDateTime,
    materialChange: z.boolean(),
    contentSha256: Sha256Hex,
    /** Path of the canonical public page (W05); the public web origin is configured per surface. */
    canonicalPath: z.string().regex(/^\/legal\/[a-z0-9-]+\/v\d+$/),
    requiredFor: z.array(z.enum(['ACCOUNT', 'DRIVER_APPLICATION'])),
    changeSummary: z.string(),
  })
  .meta({ id: 'PolicySummary' });

export const PolicyListSchema = z.object({ policies: z.array(PolicySummarySchema) }).meta({ id: 'PolicyList' });
export type PolicyList = z.infer<typeof PolicyListSchema>;

export const PolicyDocumentParamSchema = z.strictObject({ policyKey: PolicyKeySchema, version: z.string().regex(/^[1-9][0-9]{0,5}$/) });
export const PolicyDocumentSchema = PolicySummarySchema.extend({
  body: z.object({ title: z.string(), sections: z.array(z.object({ heading: z.string(), paragraphs: z.array(z.string()) })) }),
}).meta({ id: 'PolicyDocument' });
export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;

export const AGE_DECLARATION_MODES = ['NONE', 'AFFIRM_MINIMUM_AGE', 'DATE_OF_BIRTH_REQUIRED'] as const;
export const AgeEligibilityPolicySchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(['PLACEHOLDER_NOT_FOR_PRODUCTION', 'APPROVED']),
    riderDeclarationMode: z.enum(AGE_DECLARATION_MODES),
    /** null while no counsel-approved threshold exists (placeholder policy, EG-23). */
    riderMinimumAge: z.number().int().positive().nullable(),
    effectiveAt: IsoDateTime,
  })
  .meta({ id: 'AgeEligibilityPolicy' });
export type AgeEligibilityPolicy = z.infer<typeof AgeEligibilityPolicySchema>;

// ── account consents ────────────────────────────────────────────────────────────────────────────────────────────
export const CONSENT_ACTIONS = ['ACCEPTED', 'DECLINED', 'WITHDRAWN'] as const;
export const ConsentRequestSchema = z
  .strictObject({
    policyKey: PolicyKeySchema,
    version: z.number().int().positive(),
    locale: PolicyLocaleSchema,
    contentSha256: Sha256Hex,
    action: z.enum(CONSENT_ACTIONS),
  })
  .meta({ id: 'ConsentRequest' });
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;

const RequiredActionsSchema = z.array(z.enum(REQUIRED_ACTIONS));

export const ConsentRecordedSchema = z
  .object({
    id: z.uuid(),
    policyKey: PolicyKeySchema,
    version: z.number().int().positive(),
    locale: PolicyLocaleSchema,
    action: z.enum(CONSENT_ACTIONS),
    recordedAt: IsoDateTime,
    requiredActions: RequiredActionsSchema,
  })
  .meta({ id: 'ConsentRecorded' });
export type ConsentRecorded = z.infer<typeof ConsentRecordedSchema>;

export const ConsentStatusListSchema = z
  .object({
    policies: z.array(
      z.object({
        policyKey: PolicyKeySchema,
        requiredFor: z.array(z.enum(['ACCOUNT', 'DRIVER_APPLICATION'])),
        currentVersion: z.number().int().positive(),
        /** Version of the latest ACCEPTED record still in force (null: never accepted, or withdrawn/declined since). */
        acceptedVersion: z.number().int().positive().nullable(),
        lastAction: z.enum(CONSENT_ACTIONS).nullable(),
        /** true when the current version must be (re-)accepted: never accepted, withdrawn, or a material change since. */
        acceptanceRequired: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'ConsentStatusList' });
export type ConsentStatusList = z.infer<typeof ConsentStatusListSchema>;

// ── age declarations ────────────────────────────────────────────────────────────────────────────────────────────
/** Shape depends on the current policy's mode; a DOB is accepted ONLY when the mode is DATE_OF_BIRTH_REQUIRED. */
export const AgeDeclarationRequestSchema = z
  .strictObject({
    policyVersion: z.number().int().positive(),
    affirmed: z.literal(true).optional(),
    dateOfBirth: z.iso.date().optional(),
  })
  .refine((v) => (v.affirmed === undefined) !== (v.dateOfBirth === undefined), { message: 'exactly one of affirmed or dateOfBirth' })
  .meta({ id: 'AgeDeclarationRequest' });
export type AgeDeclarationRequest = z.infer<typeof AgeDeclarationRequestSchema>;

/** The response never echoes a date of birth. */
export const AgeDeclarationRecordedSchema = z
  .object({
    id: z.uuid(),
    policyVersion: z.number().int().positive(),
    declarationMode: z.enum(['AFFIRM_MINIMUM_AGE', 'DATE_OF_BIRTH_REQUIRED']),
    recordedAt: IsoDateTime,
    requiredActions: RequiredActionsSchema,
  })
  .meta({ id: 'AgeDeclarationRecorded' });
export type AgeDeclarationRecorded = z.infer<typeof AgeDeclarationRecordedSchema>;

const E = ErrorEnvelopeSchema;

export const LEGAL_ROUTES = [
  {
    operationId: 'listPolicies',
    method: 'GET',
    path: '/v1/legal/policies',
    summary: 'Current version of every policy in a locale (version, hash, status, canonical path, change summary).',
    auth: 'public',
    query: PolicyQuerySchema,
    responses: { 200: PolicyListSchema, 400: E },
  },
  {
    operationId: 'getPolicyDocument',
    method: 'GET',
    path: '/v1/legal/policies/{policyKey}/versions/{version}',
    summary: 'One immutable policy version in a locale, including its text.',
    auth: 'public',
    params: PolicyDocumentParamSchema,
    query: PolicyQuerySchema,
    responses: { 200: PolicyDocumentSchema, 400: E, 404: E },
  },
  {
    operationId: 'getAgeEligibilityPolicy',
    method: 'GET',
    path: '/v1/legal/age-eligibility-policy',
    summary: 'The current age-eligibility policy version and the declaration it requires (no threshold is hard-coded in clients).',
    auth: 'public',
    responses: { 200: AgeEligibilityPolicySchema, 503: E },
  },
  {
    operationId: 'listConsents',
    method: 'GET',
    path: '/v1/account/consents',
    summary: 'Acceptance status of every policy that requires acceptance, for the calling account.',
    auth: 'session',
    responses: { 200: ConsentStatusListSchema, 401: E },
  },
  {
    operationId: 'recordConsent',
    method: 'POST',
    path: '/v1/account/consents',
    summary: 'Accept, decline or withdraw the CURRENT version of a policy (bound to its exact content hash).',
    auth: 'session',
    request: ConsentRequestSchema,
    responses: { 201: ConsentRecordedSchema, 400: E, 401: E, 409: E },
  },
  {
    operationId: 'recordAgeDeclaration',
    method: 'POST',
    path: '/v1/account/age-declarations',
    summary: 'Record the age declaration the current age-eligibility policy requires (DOB only if the policy requires it).',
    auth: 'session',
    request: AgeDeclarationRequestSchema,
    responses: { 201: AgeDeclarationRecordedSchema, 400: E, 401: E, 409: E },
  },
] as const satisfies readonly RouteContract[];
