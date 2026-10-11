/**
 * P2.7 manual review, decisions, appeals and expiry monitoring (H02, K04, K05, K07, D03, D04, V13, H08, W07, A15;
 * KYC doc §8; staff matrix §4). Every decision is a HUMAN decision with a recorded checklist and reason codes from the
 * code-defined catalogue below; there is no automated approval and no score. Queues and rosters are paginated and
 * scoped; nothing here exports or downloads identity data.
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';

const IsoDateTime = z.iso.datetime({ offset: true });
const IsoDate = z.iso.date();
const E = ErrorEnvelopeSchema;
const Cursor = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

const REVIEW_CASE_KINDS = ['INITIAL_APPLICATION', 'RESUBMISSION', 'APPEAL', 'DOCUMENT_RENEWAL'] as const;
const REVIEW_CASE_STATUSES = ['OPEN', 'CLAIMED', 'ESCALATED', 'DECIDED', 'CANCELLED'] as const;
export const REVIEW_DECISIONS = ['APPROVE', 'NEEDS_INFO', 'REJECT', 'ESCALATE', 'REQUIRE_IN_PERSON'] as const;
export const IDENTITY_MATCH_ASSESSMENTS = ['CONFIRMED_BY_REVIEWER', 'NOT_MATCHING', 'UNCERTAIN_ESCALATE', 'IN_PERSON_REQUIRED'] as const;

/** Code-defined reason catalogue per decision (reviewed via PR; never free text). */
export const REVIEW_REASON_CATALOGUE = {
  APPROVE: ['ALL_CHECKS_CONFIRMED'],
  NEEDS_INFO: [
    'CNIC_IMAGE_UNREADABLE',
    'SELFIE_UNCLEAR',
    'LICENCE_IMAGE_UNREADABLE',
    'LICENCE_EXPIRED',
    'LICENCE_CLASS_MISMATCH',
    'NAME_MISMATCH',
    'CLAIM_CORRECTION_NEEDED',
    'VEHICLE_DOCUMENT_UNREADABLE',
    'DOCUMENT_MISSING',
  ],
  REJECT: [
    'IDENTITY_NOT_MATCHING',
    'DOCUMENT_FORGERY_SUSPECTED',
    'AGE_BELOW_APPROVED_MINIMUM',
    'LICENCE_INVALID',
    'DUPLICATE_IDENTITY_CONFIRMED',
    'VEHICLE_INELIGIBLE',
  ],
  ESCALATE: ['SENIOR_REVIEW_NEEDED', 'DUPLICATE_SIGNAL_REVIEW'],
  REQUIRE_IN_PERSON: ['IN_PERSON_IDENTITY_CHECK', 'ACCESSIBILITY_ALTERNATIVE'],
} as const satisfies Readonly<Record<(typeof REVIEW_DECISIONS)[number], readonly string[]>>;

/** Checklist schema v1 (KYC doc §8). APPROVE needs every item CONFIRMED or NOT_APPLICABLE. */
export const CHECKLIST_ITEMS_V1 = [
  'CNIC_LEGIBLE_AND_MATCHES_CLAIM',
  'IDENTITY_MATCH_ASSESSED_BY_REVIEWER',
  'LICENCE_CLASS_MATCHES_CATEGORY',
  'LICENCE_NAME_AND_EXPIRY_VALID',
  'AGE_MEETS_APPROVED_POLICY_AND_REGULATION',
  'VEHICLE_AND_OWNERSHIP_EVIDENCE',
  'REQUIREMENT_SET_ARTEFACTS',
  'DUPLICATE_SIGNALS_RESOLVED',
] as const;
const ChecklistValue = z.enum(['CONFIRMED', 'NOT_CONFIRMED', 'NOT_APPLICABLE']);
const ChecklistSchema = z.strictObject({
  schemaVersion: z.literal(1),
  items: z.strictObject(
    Object.fromEntries(CHECKLIST_ITEMS_V1.map((i) => [i, ChecklistValue])) as Record<(typeof CHECKLIST_ITEMS_V1)[number], typeof ChecklistValue>,
  ),
});

export const ReviewCaseQuerySchema = z.strictObject({
  status: z.enum(['OPEN', 'CLAIMED', 'ESCALATED']).optional(),
  mine: z.enum(['true', 'false']).optional(),
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
const ReviewCaseSummarySchema = z.object({
  id: z.uuid(),
  kind: z.enum(REVIEW_CASE_KINDS),
  status: z.enum(REVIEW_CASE_STATUSES),
  cityCode: z.string(),
  priority: z.number().int(),
  escalated: z.boolean(),
  inPersonRequired: z.boolean(),
  assignedToMe: z.boolean(),
  openSignals: z.number().int(),
  createdAt: IsoDateTime,
});
export const ReviewCaseListSchema = z.object({ items: z.array(ReviewCaseSummarySchema), nextCursor: Cursor.nullable() }).meta({ id: 'ReviewCaseList' });

export const ReviewCaseDetailSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(REVIEW_CASE_KINDS),
    status: z.enum(REVIEW_CASE_STATUSES),
    version: z.number().int(),
    cityCode: z.string(),
    priority: z.number().int(),
    escalated: z.boolean(),
    inPersonRequired: z.boolean(),
    leaseExpiresAt: IsoDateTime.nullable(),
    application: z.object({
      id: z.uuid(),
      state: z.string(),
      serviceCategories: z.array(z.string()),
      submittedAt: IsoDateTime.nullable(),
      /** The reviewer compares claims with the evidence: name and date of birth are shown; the CNIC only as last 4. */
      claims: z.object({ legalName: z.string().nullable(), cnicLast4: z.string().nullable(), dateOfBirth: IsoDate.nullable() }),
      ageCheck: z.object({
        policyVersion: z.number().int(),
        driverMinimumAge: z.number().int().nullable(),
        outcome: z.enum(['MEETS_MINIMUM', 'BELOW_MINIMUM', 'NO_APPROVED_THRESHOLD', 'NO_CLAIM']),
      }),
    }),
    requirementSet: z.object({ id: z.uuid(), version: z.number().int(), isPlaceholder: z.boolean() }).nullable(),
    documents: z.array(
      z.object({
        id: z.uuid(),
        documentType: z.string(),
        status: z.string(),
        numberLast4: z.string().nullable(),
        licenceClass: z.string().nullable(),
        claimedIssuedOn: IsoDate.nullable(),
        claimedExpiresOn: IsoDate.nullable(),
        vehicleId: z.uuid().nullable(),
      }),
    ),
    vehicles: z.array(
      z.object({
        id: z.uuid(),
        plateDisplay: z.string(),
        make: z.string(),
        model: z.string(),
        modelYear: z.number().int(),
        ownershipType: z.string(),
        relation: z.string(),
      }),
    ),
    /** Metadata only — images are fetched one at a time through the evidence-view flow (reason + step-up). */
    evidence: z.array(
      z.object({
        evidenceId: z.uuid(),
        documentId: z.uuid(),
        kind: z.string(),
        status: z.string(),
        captureSource: z.string(),
        pixelWidth: z.number().int().nullable(),
        pixelHeight: z.number().int().nullable(),
      }),
    ),
    captureChallenge: z.object({ challengeCode: z.string(), status: z.string() }).nullable(),
    duplicateSignals: z.array(z.object({ id: z.uuid(), signal: z.string(), status: z.string(), createdAt: IsoDateTime })),
    decisions: z.array(
      z.object({
        id: z.uuid(),
        decision: z.enum(REVIEW_DECISIONS),
        reasonCodes: z.array(z.string()),
        decidedAt: IsoDateTime,
        decidedByMe: z.boolean(),
        secondApproval: z.enum(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']),
      }),
    ),
    appeal: z.object({ id: z.uuid(), status: z.string(), statement: z.string(), createdAt: IsoDateTime }).nullable(),
  })
  .meta({ id: 'ReviewCaseDetail' });

export const ReviewDecisionRequestSchema = z
  .strictObject({
    expectedVersion: z.number().int().positive(),
    decision: z.enum(REVIEW_DECISIONS),
    reasonCodes: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/))
      .min(1)
      .max(20),
    checklist: ChecklistSchema,
    identityMatch: z.enum(IDENTITY_MATCH_ASSESSMENTS).optional(),
    /** Evidence objects the decision relied on (each must belong to the case's application). */
    evidenceIds: z.array(z.uuid()).max(60),
    /** Every OPEN duplicate signal must be resolved by an APPROVE (CLEARED) — it then needs a second approval. */
    signalResolutions: z
      .array(z.strictObject({ signalId: z.uuid(), outcome: z.enum(['CLEARED', 'CONFIRMED_FRAUD']) }))
      .max(50)
      .optional(),
  })
  .meta({ id: 'ReviewDecisionRequest' });
export const ReviewDecisionResultSchema = z
  .object({ decisionId: z.uuid(), caseStatus: z.enum(REVIEW_CASE_STATUSES), applicationState: z.string(), pendingSecondApproval: z.boolean() })
  .meta({ id: 'ReviewDecisionResult' });
export const SecondApprovalRequestSchema = z.strictObject({ outcome: z.enum(['APPROVED', 'REJECTED']) }).meta({ id: 'SecondApprovalRequest' });

// ── appeals ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const AppealCreateRequestSchema = z
  .strictObject({
    reviewDecisionId: z.uuid().optional(),
    restrictionId: z.uuid().optional(),
    statement: z.string().trim().min(10).max(2000),
  })
  .refine((v) => (v.reviewDecisionId === undefined) !== (v.restrictionId === undefined), { message: 'exactly one of reviewDecisionId or restrictionId' })
  .meta({ id: 'AppealCreateRequest' });
const AppealStatusSchema = z.enum(['SUBMITTED', 'UNDER_REVIEW', 'UPHELD', 'OVERTURNED', 'WITHDRAWN']);
export const AccountAppealSchema = z
  .object({
    id: z.uuid(),
    subject: z.enum(['REVIEW_DECISION', 'RESTRICTION']),
    subjectId: z.uuid(),
    status: AppealStatusSchema,
    outcomeReasonCode: z.string().nullable(),
    createdAt: IsoDateTime,
    decidedAt: IsoDateTime.nullable(),
  })
  .meta({ id: 'AccountAppeal' });
export const AccountAppealListSchema = z.object({ items: z.array(AccountAppealSchema) }).meta({ id: 'AccountAppealList' });

export const AppealQuerySchema = z.strictObject({ cursor: Cursor.optional(), limit: z.coerce.number().int().min(1).max(50).optional() });
export const AdminAppealListSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.uuid(),
        subject: z.enum(['REVIEW_DECISION', 'RESTRICTION']),
        status: AppealStatusSchema,
        cityCode: z.string().nullable(),
        assignedToMe: z.boolean(),
        reviewCaseId: z.uuid().nullable(),
        createdAt: IsoDateTime,
      }),
    ),
    nextCursor: Cursor.nullable(),
  })
  .meta({ id: 'AdminAppealList' });
export const APPEAL_OUTCOME_REASONS = [
  'ORIGINAL_DECISION_CONFIRMED',
  'NEW_EVIDENCE_ACCEPTED',
  'REVIEW_ERROR_CORRECTED',
  'RESTRICTION_NO_LONGER_JUSTIFIED',
] as const;
export const AppealDecisionRequestSchema = z
  .strictObject({ outcome: z.enum(['UPHELD', 'OVERTURNED']), reasonCode: z.enum(APPEAL_OUTCOME_REASONS) })
  .meta({ id: 'AppealDecisionRequest' });
export const AppealDecisionResultSchema = z
  .object({ appealId: z.uuid(), status: z.enum(['UPHELD', 'OVERTURNED']), reviewCaseId: z.uuid().nullable() })
  .meta({ id: 'AppealDecisionResult' });

// ── monitoring ─────────────────────────────────────────────────────────────────────────────────────────────────
export const ExpiryRosterQuerySchema = z.strictObject({
  withinDays: z.coerce.number().int().min(0).max(365).optional(),
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export const ExpiryRosterSchema = z
  .object({
    items: z.array(
      z.object({
        documentId: z.uuid(),
        documentType: z.string(),
        driverProfileId: z.uuid(),
        cityCode: z.string(),
        status: z.string(),
        expiresOn: IsoDate,
        numberLast4: z.string().nullable(),
      }),
    ),
    nextCursor: Cursor.nullable(),
  })
  .meta({ id: 'ExpiryRoster' });
export const EvidenceAccessLogQuerySchema = z.strictObject({
  evidenceId: z.uuid().optional(),
  staffId: z.uuid().optional(),
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const EvidenceAccessLogSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.uuid(),
        evidenceId: z.uuid(),
        staffId: z.uuid(),
        event: z.string(),
        reasonCode: z.string(),
        breakGlass: z.boolean(),
        at: IsoDateTime,
      }),
    ),
    nextCursor: Cursor.nullable(),
  })
  .meta({ id: 'EvidenceAccessLog' });

const IdParam = z.strictObject({ id: z.uuid() });

export const REVIEW_ROUTES = [
  {
    operationId: 'listReviewCases',
    method: 'GET',
    path: '/v1/admin/review-cases',
    summary: 'Review queue (city-scoped, paginated; no export).',
    auth: 'staff',
    query: ReviewCaseQuerySchema,
    responses: { 200: ReviewCaseListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'claimReviewCase',
    method: 'POST',
    path: '/v1/admin/review-cases/{id}/claim',
    summary: 'Claim (or renew) a 30-minute lease on a case.',
    auth: 'staff',
    params: IdParam,
    responses: { 200: ReviewCaseDetailSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'releaseReviewCase',
    method: 'POST',
    path: '/v1/admin/review-cases/{id}/release',
    summary: 'Release a claimed case back to the queue.',
    auth: 'staff',
    params: IdParam,
    responses: { 204: null, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'getReviewCase',
    method: 'GET',
    path: '/v1/admin/review-cases/{id}',
    summary: 'Case detail with masked identifiers (claimed by the caller, or a senior reviewer).',
    auth: 'staff',
    params: IdParam,
    responses: { 200: ReviewCaseDetailSchema, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'decideReviewCase',
    method: 'POST',
    path: '/v1/admin/review-cases/{id}/decisions',
    summary: 'Record a human decision with checklist and reason codes (step-up; approvals with duplicate signals need a second approver).',
    auth: 'staff',
    params: IdParam,
    request: ReviewDecisionRequestSchema,
    responses: { 201: ReviewDecisionResultSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'secondApproveReviewDecision',
    method: 'POST',
    path: '/v1/admin/review-decisions/{id}/second-approvals',
    summary: 'Second approval of an approval by a different senior reviewer (maker-checker).',
    auth: 'staff',
    params: IdParam,
    request: SecondApprovalRequestSchema,
    responses: { 200: ReviewDecisionResultSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'listAdminAppeals',
    method: 'GET',
    path: '/v1/admin/appeals',
    summary: 'Open appeals the caller may decide (paginated; no export).',
    auth: 'staff',
    query: AppealQuerySchema,
    responses: { 200: AdminAppealListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'decideAppeal',
    method: 'POST',
    path: '/v1/admin/appeals/{id}/decisions',
    summary: 'Decide an appeal (step-up; never the original decider or restriction creator).',
    auth: 'staff',
    params: IdParam,
    request: AppealDecisionRequestSchema,
    responses: { 200: AppealDecisionResultSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'getExpiryRoster',
    method: 'GET',
    path: '/v1/admin/compliance/expiry-roster',
    summary: 'Documents expiring within N days or expired (city-scoped, paginated, in-app only — no download).',
    auth: 'staff',
    query: ExpiryRosterQuerySchema,
    responses: { 200: ExpiryRosterSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'getEvidenceAccessLog',
    method: 'GET',
    path: '/v1/admin/evidence-access-log',
    summary: 'Evidence access log for auditors (paginated; ids and codes only).',
    auth: 'staff',
    query: EvidenceAccessLogQuerySchema,
    responses: { 200: EvidenceAccessLogSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'createAppeal',
    method: 'POST',
    path: '/v1/account/appeals',
    summary: 'Appeal a review decision (rejection) or an appealable restriction (works under a restriction).',
    auth: 'session',
    request: AppealCreateRequestSchema,
    responses: { 201: AccountAppealSchema, 400: E, 401: E, 404: E, 409: E },
  },
  {
    operationId: 'listAccountAppeals',
    method: 'GET',
    path: '/v1/account/appeals',
    summary: 'The caller’s appeals and their outcomes.',
    auth: 'session',
    responses: { 200: AccountAppealListSchema, 401: E },
  },
] as const satisfies readonly RouteContract[];
