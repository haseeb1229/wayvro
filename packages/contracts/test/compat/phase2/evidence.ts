// FROZEN Phase-2 consumer contract baseline: main @ b1a1986, packages/contracts/src/evidence.ts (COMPAT-N1,
// docs/phase3/PHASE3_TEST_STRATEGY.md §4.10). TEST-ONLY: outside src/, so never built, exported or imported by production
// code. Copied verbatim and never edited except to fix import paths: it is what a Phase-2 client parses responses with.
/**
 * P2.6 evidence contracts (K02, K03, K11, D02, D03, Q36; KYC doc §2, §4, §7; API doc §2.3–§2.4). The applicant gets an
 * upload SLOT: an opaque id plus a short-lived, single-object, quarantine-only upload URL with the content type and
 * length in its signature. No response ever contains a storage key or URL other than that upload URL, and no route
 * downloads evidence for a consumer. Staff view sanitised evidence through a one-time, 60-second, session-bound view
 * token with a recorded reason (no export, no bulk download). `captureSource` is client-declared metadata only.
 */
import { z } from 'zod';
import { ApplicationIdParamSchema, DriverApplicationSchema } from './compliance.js';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';

const IsoDateTime = z.iso.datetime({ offset: true });
const E = ErrorEnvelopeSchema;
const ReasonCode = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);

export const EVIDENCE_KIND_VALUES = ['CNIC_FRONT', 'CNIC_BACK', 'SELFIE_FOR_MANUAL_REVIEW', 'LICENCE_FRONT', 'LICENCE_BACK', 'DOCUMENT_PAGE'] as const;
export const CAPTURE_SOURCE_VALUES = ['IN_APP_CAMERA', 'GALLERY_IMPORT', 'FILE_IMPORT'] as const;
/** JPEG and PNG only in V1 (HEIC picks are exported as JPEG by the system picker; PDF is not accepted). */
const EVIDENCE_MIME_VALUES = ['image/jpeg', 'image/png'] as const;
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

export const EvidenceUploadRequestSchema = z
  .strictObject({
    /** The claimed compliance document (from `POST …/documents`) the evidence belongs to. */
    documentId: z.uuid(),
    kind: z.enum(EVIDENCE_KIND_VALUES),
    captureSource: z.enum(CAPTURE_SOURCE_VALUES),
    byteSize: z.number().int().min(1).max(EVIDENCE_MAX_BYTES),
    mime: z.enum(EVIDENCE_MIME_VALUES),
    /** Optional accessible capture challenge (selfie only) — an anti-replay aid for manual review, never liveness. */
    challengeId: z.uuid().optional(),
  })
  .meta({ id: 'EvidenceUploadRequest' });

export const EvidenceUploadSlotSchema = z
  .object({
    uploadId: z.uuid(),
    /** PUT the exact bytes with exactly these headers before `expiresAt`; the URL accepts one object of that type/length. */
    upload: z.object({ url: z.url(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()), expiresAt: IsoDateTime }),
    slotExpiresAt: IsoDateTime,
  })
  .meta({ id: 'EvidenceUploadSlot' });

/** User-safe outcome; the internal pipeline states collapse into what the applicant can act on. */
const EVIDENCE_STATUS_VALUES = ['AWAITING_UPLOAD', 'PROCESSING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'DISCARDED'] as const;
const EVIDENCE_REJECTION_VALUES = ['TOO_LARGE', 'UNSUPPORTED_FORMAT', 'UNREADABLE', 'SECURITY_CHECK_FAILED'] as const;

export const EvidenceUploadStatusSchema = z
  .object({
    uploadId: z.uuid(),
    documentId: z.uuid(),
    kind: z.enum(EVIDENCE_KIND_VALUES),
    captureSource: z.enum(CAPTURE_SOURCE_VALUES),
    status: z.enum(EVIDENCE_STATUS_VALUES),
    rejectionReason: z.enum(EVIDENCE_REJECTION_VALUES).nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'EvidenceUploadStatus' });

export const EvidenceListSchema = z.object({ items: z.array(EvidenceUploadStatusSchema) }).meta({ id: 'EvidenceList' });
export const UploadIdParamSchema = z.strictObject({ uploadId: z.uuid() });

export const CAPTURE_CHALLENGE_CODES = ['SMILE', 'NEUTRAL_EXPRESSION', 'TURN_HEAD_LEFT', 'TURN_HEAD_RIGHT', 'LOOK_UP', 'RAISE_EITHER_HAND'] as const;
export const CaptureChallengeSchema = z
  .object({
    challengeId: z.uuid(),
    challengeCode: z.enum(CAPTURE_CHALLENGE_CODES),
    expiresAt: IsoDateTime,
  })
  .meta({ id: 'CaptureChallenge' });
/** "I can't do this one" → REPLACE (a different challenge); "None of these work for me" → NONE_ACCESSIBLE (neutral). */
export const CaptureChallengeDeclineRequestSchema = z
  .strictObject({ choice: z.enum(['REPLACE', 'NONE_ACCESSIBLE']) })
  .meta({ id: 'CaptureChallengeDeclineRequest' });
export const CaptureChallengeDeclineSchema = z
  .object({ status: z.enum(['REPLACED', 'DECLINED_ACCESSIBILITY']), replacement: CaptureChallengeSchema.nullable() })
  .meta({ id: 'CaptureChallengeDecline' });
export const ChallengeParamSchema = z.strictObject({ id: z.uuid(), challengeId: z.uuid() });

export const SubmissionRequestSchema = z.strictObject({ expectedVersion: z.number().int().positive() }).meta({ id: 'ApplicationSubmissionRequest' });

// ── staff (web-ops BFF) ──────────────────────────────────────────────────────────────────────────────────────────
export const EvidenceViewRequestSchema = z
  .strictObject({
    evidenceId: z.uuid(),
    /** Reason for access from the closed catalogue (recorded in the access log and the audit trail). */
    reasonCode: z.enum(['CASE_REVIEW', 'APPEAL_REVIEW', 'QUALITY_CALIBRATION', 'SECURITY_INVESTIGATION']),
  })
  .meta({ id: 'EvidenceViewRequest' });
export const EvidenceViewSchema = z.object({ viewToken: z.uuid(), expiresAt: IsoDateTime, reasonCode: ReasonCode }).meta({ id: 'EvidenceView' });
export const ViewTokenParamSchema = z.strictObject({ token: z.uuid() });

export const EVIDENCE_ROUTES = [
  {
    operationId: 'createEvidenceUpload',
    method: 'POST',
    path: '/v1/driver-onboarding/applications/{id}/evidence-uploads',
    summary: 'Issue an upload slot for one evidence image (quarantine-only presigned PUT, ≤ 5 minutes; selfie = in-app camera only).',
    auth: 'session',
    params: ApplicationIdParamSchema,
    request: EvidenceUploadRequestSchema,
    responses: { 201: EvidenceUploadSlotSchema, 400: E, 401: E, 403: E, 404: E, 409: E, 429: E, 503: E },
  },
  {
    operationId: 'listApplicationEvidence',
    method: 'GET',
    path: '/v1/driver-onboarding/applications/{id}/evidence',
    summary: 'Evidence uploads of the application with user-safe processing outcomes (no storage keys or URLs).',
    auth: 'session',
    params: ApplicationIdParamSchema,
    responses: { 200: EvidenceListSchema, 401: E, 403: E, 404: E, 503: E },
  },
  {
    operationId: 'completeEvidenceUpload',
    method: 'POST',
    path: '/v1/driver-onboarding/evidence-uploads/{uploadId}/completion',
    summary: 'Confirm the upload; the object is then scanned and sanitised before it can be reviewed.',
    auth: 'session',
    params: UploadIdParamSchema,
    responses: { 200: EvidenceUploadStatusSchema, 401: E, 403: E, 404: E, 409: E, 503: E },
  },
  {
    operationId: 'discardEvidenceUpload',
    method: 'DELETE',
    path: '/v1/driver-onboarding/evidence-uploads/{uploadId}',
    summary: 'Discard an upload of an application that is still editable (the stored object is deleted).',
    auth: 'session',
    params: UploadIdParamSchema,
    responses: { 204: null, 401: E, 403: E, 404: E, 409: E, 503: E },
  },
  {
    operationId: 'createCaptureChallenge',
    method: 'POST',
    path: '/v1/driver-onboarding/applications/{id}/capture-challenges',
    summary: 'Optional accessible selfie capture challenge (manual-review aid; never liveness, never required).',
    auth: 'session',
    params: ApplicationIdParamSchema,
    responses: { 201: CaptureChallengeSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'declineCaptureChallenge',
    method: 'POST',
    path: '/v1/driver-onboarding/applications/{id}/capture-challenges/{challengeId}/declines',
    summary: '"I can\'t do this one" (replace) or "None of these work for me" (continue without; shown neutrally to reviewers).',
    auth: 'session',
    params: ChallengeParamSchema,
    request: CaptureChallengeDeclineRequestSchema,
    responses: { 200: CaptureChallengeDeclineSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'submitDriverApplication',
    method: 'POST',
    path: '/v1/driver-onboarding/applications/{id}/submission',
    summary: 'Submit once every mandatory item has accepted evidence; pins the requirement set. Review is always human.',
    auth: 'session',
    params: ApplicationIdParamSchema,
    request: SubmissionRequestSchema,
    responses: { 200: DriverApplicationSchema, 400: E, 401: E, 403: E, 404: E, 409: E, 503: E },
  },
  {
    operationId: 'createEvidenceView',
    method: 'POST',
    path: '/v1/admin/evidence-views',
    summary: 'One-time, 60-second, session-bound evidence view token with a recorded reason (step-up; city scope; no conflict).',
    auth: 'staff',
    request: EvidenceViewRequestSchema,
    responses: { 201: EvidenceViewSchema, 400: E, 401: E, 403: E, 404: E, 409: E, 503: E },
  },
  {
    operationId: 'getEvidenceViewContent',
    method: 'GET',
    path: '/v1/admin/evidence-views/{token}/content',
    summary: 'Stream the decrypted, sanitised image once (no-store, inline). A used or expired token is 410.',
    auth: 'staff',
    params: ViewTokenParamSchema,
    responses: { 200: null, 401: E, 403: E, 404: E, 410: E, 500: E, 503: E },
    binaryResponses: { 200: ['image/jpeg', 'image/png'] },
  },
] as const satisfies readonly RouteContract[];
export type EvidenceUploadStatus = z.infer<typeof EvidenceUploadStatusSchema>;
