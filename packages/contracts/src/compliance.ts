/**
 * P2.5 Driver/Partner onboarding and compliance contracts (D01, D04, K06, K07, R02–R06, R46, V03, V13, A15; API doc
 * §2.3–§2.4). Consumer routes live in the ONE app; every capability is derived server-side — no client mode, role or
 * status field is accepted. Applicant identity fields are CLAIMS until a human reviewer confirms them (no OCR).
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';

const IsoDateTime = z.iso.datetime({ offset: true });
const IsoDate = z.iso.date();
const E = ErrorEnvelopeSchema;
const CityCode = z.string().regex(/^[A-Z]{3}$/);
const CategoryCode = z.enum(['CAR', 'BIKE', 'RICKSHAW']);
const DocumentTypeCode = z.string().regex(/^[A-Z][A-Z0-9_]{2,40}$/);
export const OWNERSHIP_TYPES = [
  'REGISTERED_OWNER',
  'OPEN_LETTER_UNTRANSFERRED',
  'BANK_HYPOTHECATED',
  'COMPANY_OWNED',
  'FAMILY_OWNED',
  'OTHER_AUTHORISED_USE',
] as const;

export const APPLICATION_STATE_VALUES = [
  'DRAFT',
  'CONSENTED',
  'DOCUMENTS_PENDING',
  'SUBMITTED',
  'AUTO_CHECK_PENDING',
  'MANUAL_REVIEW',
  'NEEDS_INFO',
  'REJECTED',
  'APPEALED',
  'REJECTED_FINAL',
  'VERIFIED',
  'WITHDRAWN',
  'EXPIRED_DRAFT',
] as const;
const ApplicationStateSchema = z.enum(APPLICATION_STATE_VALUES);
const DriverProfileStateSchema = z.enum(['VERIFIED', 'ACTIVE_ELIGIBLE', 'EXPIRED', 'REVERIFY_DUE']);

export const BLOCKER_CODES = [
  'ACCOUNT_RESTRICTED',
  'ACCOUNT_NOT_ACTIVE',
  'NO_DRIVER_PROFILE',
  'PROFILE_REVERIFICATION_DUE',
  'DRIVER_ROLE_RESTRICTED',
  'NO_VEHICLE',
  'VEHICLE_RESTRICTED',
  'SERVICE_CATEGORY_DISABLED_LEGAL_GATE',
  'CAPABILITY_NOT_GRANTED',
  'CAPABILITY_RESTRICTED',
  'CITY_CATEGORY_RESTRICTED',
  'NO_ACTIVE_REQUIREMENT_SET',
  'REQUIREMENT_SET_PLACEHOLDER',
  'DOCUMENT_MISSING',
  'DOCUMENT_EXPIRED',
  'DOCUMENT_NOT_VALID',
  'LICENCE_CLASS_NOT_ALLOWED',
  'AGE_POLICY_PLACEHOLDER',
  'DRIVER_AGE_BELOW_MINIMUM',
] as const;
const BlockerSchema = z.object({ code: z.enum(BLOCKER_CODES), documentType: DocumentTypeCode.optional() });

export const RESTRICTION_SCOPE_VALUES = ['ACCOUNT', 'DRIVER_ROLE', 'VEHICLE', 'SERVICE_CAPABILITY', 'CITY_CATEGORY'] as const;
export const REASON_CLASS_VALUES = ['SAFETY', 'FRAUD', 'LEGAL', 'COMPLIANCE', 'QUALITY', 'SECURITY_HOLD', 'RISK_HOLD', 'AGE_POLICY'] as const;
const ReasonCode = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);

/** What the account holder sees about a restriction (reason code → localised copy; no internal evidence). */
export const AccountRestrictionSchema = z.object({
  id: z.uuid(),
  scope: z.enum(RESTRICTION_SCOPE_VALUES),
  reasonCode: ReasonCode,
  reasonClass: z.enum(REASON_CLASS_VALUES),
  appealable: z.boolean(),
  effectiveUntil: IsoDateTime.nullable(),
  /** V13: only ACCOUNT-scope restrictions affect passenger use. */
  affectsRiderUse: z.boolean(),
});

/** Additive `driver` + `restrictions` sections of the account state (the mobile app routes on these). */
export const AccountDriverSectionSchema = z.object({
  application: z.object({ id: z.uuid(), state: ApplicationStateSchema }).nullable(),
  profile: z.object({ id: z.uuid(), state: DriverProfileStateSchema }).nullable(),
  /** `driver.onboarding` flag (server-evaluated; presentation hint only). */
  onboardingAvailable: z.boolean(),
});

// ── consumer onboarding ─────────────────────────────────────────────────────────────────────────────────────────
export const ApplicationCreateRequestSchema = z
  .strictObject({ cityCode: CityCode, serviceCategories: z.array(CategoryCode).min(1).max(3) })
  .meta({ id: 'ApplicationCreateRequest' });

/** Claims only; `expectedVersion` is the optimistic-concurrency token (409 CONFLICT when stale). */
export const ApplicationUpdateRequestSchema = z
  .strictObject({
    expectedVersion: z.number().int().positive(),
    legalName: z.string().trim().min(2).max(120).optional(),
    cnic: z
      .string()
      .regex(/^\d{5}-?\d{7}-?\d$/)
      .optional(),
    dateOfBirth: IsoDate.optional(),
    serviceCategories: z.array(CategoryCode).min(1).max(3).optional(),
  })
  .meta({ id: 'ApplicationUpdateRequest' });

export const ApplicationIdParamSchema = z.strictObject({ id: z.uuid() });
export const VehicleParamSchema = z.strictObject({ id: z.uuid(), vehicleId: z.uuid() });

export const VehicleCreateRequestSchema = z
  .strictObject({
    plate: z.string().trim().min(2).max(16),
    make: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(40),
    modelYear: z.number().int().min(1950).max(2100),
    colour: z.string().trim().min(1).max(30),
    serviceCategory: CategoryCode,
    ownershipType: z.enum(OWNERSHIP_TYPES),
    registrationNumber: z.string().trim().min(2).max(40).optional(),
  })
  .meta({ id: 'VehicleCreateRequest' });
export const VehicleUpdateRequestSchema = z
  .strictObject({
    expectedVersion: z.number().int().positive(),
    make: z.string().trim().min(1).max(40).optional(),
    model: z.string().trim().min(1).max(40).optional(),
    modelYear: z.number().int().min(1950).max(2100).optional(),
    colour: z.string().trim().min(1).max(30).optional(),
    ownershipType: z.enum(OWNERSHIP_TYPES).optional(),
  })
  .meta({ id: 'VehicleUpdateRequest' });

export const DocumentClaimRequestSchema = z
  .strictObject({
    documentType: DocumentTypeCode,
    vehicleId: z.uuid().optional(),
    districtCode: z
      .string()
      .regex(/^[A-Z]{3}-[A-Z0-9]{2,12}$/)
      .optional(),
    number: z.string().trim().min(2).max(40).optional(),
    licenceClass: z
      .string()
      .regex(/^[A-Z0-9-]{1,12}$/)
      .optional(),
    issuedOn: IsoDate.optional(),
    expiresOn: IsoDate.optional(),
  })
  .meta({ id: 'DocumentClaimRequest' });

/** P2.8: renewal of a driver's document (claims only; evidence via upload slots; a human reviewer decides). */
export const DocumentParamSchema = z.strictObject({ documentId: z.uuid() });
export const DocumentRenewalRequestSchema = z
  .strictObject({
    number: z.string().trim().min(2).max(40).optional(),
    licenceClass: z
      .string()
      .regex(/^[A-Z0-9-]{1,12}$/)
      .optional(),
    issuedOn: IsoDate.optional(),
    expiresOn: IsoDate,
  })
  .meta({ id: 'DocumentRenewalRequest' });
export const DocumentRenewalSchema = z
  .object({
    renewalDocumentId: z.uuid(),
    applicationId: z.uuid(),
    renews: z.uuid(),
    documentType: DocumentTypeCode,
    evidenceKinds: z.array(z.string()),
    status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED']),
  })
  .meta({ id: 'DocumentRenewal' });

const VehicleViewSchema = z.object({
  id: z.uuid(),
  plateDisplay: z.string(),
  make: z.string(),
  model: z.string(),
  modelYear: z.number().int(),
  colour: z.string(),
  serviceCategory: CategoryCode,
  ownershipType: z.enum(OWNERSHIP_TYPES),
  relation: z.enum(['OWNER', 'AUTHORISED_USER']),
  version: z.number().int(),
});
const DocumentViewSchema = z.object({
  id: z.uuid(),
  documentType: DocumentTypeCode,
  vehicleId: z.uuid().nullable(),
  districtCode: z.string().nullable(),
  numberLast4: z.string().nullable(),
  licenceClass: z.string().nullable(),
  claimedExpiresOn: IsoDate.nullable(),
  status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'VALID', 'REJECTED', 'EXPIRED', 'SUPERSEDED']),
});

export const DriverApplicationSchema = z
  .object({
    id: z.uuid(),
    state: ApplicationStateSchema,
    version: z.number().int(),
    cityCode: CityCode,
    serviceCategories: z.array(CategoryCode),
    /** Claims are never echoed: masked CNIC (last 4) and booleans only. */
    claims: z.object({ legalNameProvided: z.boolean(), cnicLast4: z.string().nullable(), dateOfBirthProvided: z.boolean() }),
    vehicles: z.array(VehicleViewSchema),
    documents: z.array(DocumentViewSchema),
    /** Driver policies (DRIVER_PARTNER_AGREEMENT, BIOMETRIC_KYC_NOTICE) still to be accepted before CONSENTED (K14). */
    pendingPolicies: z.array(z.string()),
    createdAt: IsoDateTime,
    submittedAt: IsoDateTime.nullable(),
    /**
     * P2.7 (additive): the latest effective human decision (reason codes for NEEDS_INFO/REJECT, whether it can be
     * appealed) and whether an in-person verification was requested. Never the reviewer's identity.
     */
    review: z
      .object({
        latestDecision: z
          .object({
            decisionId: z.uuid(),
            decision: z.enum(['APPROVE', 'NEEDS_INFO', 'REJECT', 'REQUIRE_IN_PERSON']),
            reasonCodes: z.array(z.string()),
            decidedAt: IsoDateTime,
            appealable: z.boolean(),
          })
          .nullable(),
        inPersonRequired: z.boolean(),
        openAppealId: z.uuid().nullable(),
      })
      .optional(),
  })
  .meta({ id: 'DriverApplication' });
export type DriverApplication = z.infer<typeof DriverApplicationSchema>;

export const RequirementChecklistSchema = z
  .object({
    requirementSetId: z.uuid(),
    version: z.number().int(),
    /** Placeholder sets are NOT the Punjab legal matrix (EG-03/EG-04) and are labelled as such. */
    isPlaceholder: z.boolean(),
    items: z.array(
      z.object({
        documentType: DocumentTypeCode,
        mandatory: z.boolean(),
        subject: z.enum(['DRIVER', 'VEHICLE', 'DRIVER_VEHICLE']),
        perDistrict: z.boolean(),
        applicable: z.boolean(),
        claimed: z.boolean(),
        evidenceKinds: z.array(z.string()),
        licenceClassesAllowed: z.array(z.string()),
        /** P2.8 (additive): which claim fields the document type has (the server refuses the others). */
        hasNumber: z.boolean(),
        hasExpiry: z.boolean(),
      }),
    ),
    /**
     * Closure (additive): the ENABLED districts of the application's city — the only valid `districtCode` values for a
     * per-district item (server-authoritative; clients never hard-code districts).
     */
    districts: z.array(z.object({ code: z.string(), nameEn: z.string(), nameUr: z.string() })).optional(),
  })
  .meta({ id: 'RequirementChecklist' });

export const DriverComplianceSchema = z
  .object({
    profile: z.object({ id: z.uuid(), state: DriverProfileStateSchema }),
    eligibility: z.array(
      z.object({ vehicleId: z.uuid().nullable(), cityCode: CityCode, serviceCategory: CategoryCode, eligible: z.boolean(), blockers: z.array(BlockerSchema) }),
    ),
    documents: z.array(
      DocumentViewSchema.extend({
        expiresOn: IsoDate.nullable(),
        renewalDue: z.boolean(),
        /** P2.8 (additive): which claim fields the document type has (a renewal offers the same). */
        hasNumber: z.boolean(),
        hasExpiry: z.boolean(),
        /** P2.8 (additive): the renewal in progress for this document, if any, with the evidence kinds it needs. */
        renewal: z
          .object({
            renewalDocumentId: z.uuid(),
            status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED']),
            evidenceKinds: z.array(z.string()),
            /** Closure (additive): the REJECT decision that may be appealed (null when not appealable). */
            appealableDecisionId: z.uuid().nullable().optional(),
            /** Closure (additive): the appeal of that rejection, if one was made. */
            appealStatus: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'UPHELD', 'OVERTURNED', 'WITHDRAWN']).nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    ),
    /** P2.8 (additive): the verified application (evidence upload slots for renewals use it). */
    applicationId: z.uuid().optional(),
    restrictions: z.array(AccountRestrictionSchema),
  })
  .meta({ id: 'DriverCompliance' });
export type DriverCompliance = z.infer<typeof DriverComplianceSchema>;

export const VehicleCreatedSchema = z.object({ vehicleId: z.uuid(), relation: z.enum(['OWNER', 'AUTHORISED_USER']) }).meta({ id: 'VehicleCreated' });
export const DocumentClaimedSchema = z.object({ documentId: z.uuid() }).meta({ id: 'DocumentClaimed' });
const EmptyBody = z.strictObject({});

export const ONBOARDING_ROUTES = [
  {
    operationId: 'createDriverApplication',
    method: 'POST',
    path: '/v1/driver-onboarding/applications',
    summary: 'Start a Driver/Partner application in the same Wayvro app (policies + age declaration first).',
    auth: 'session',
    request: ApplicationCreateRequestSchema,
    responses: { 201: DriverApplicationSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'getCurrentDriverApplication',
    method: 'GET',
    path: '/v1/driver-onboarding/applications/current',
    summary: 'The calling account’s current (latest) application.',
    auth: 'session',
    responses: { 200: DriverApplicationSchema, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'updateDriverApplication',
    method: 'POST',
    path: '/v1/driver-onboarding/applications/{id}/claims',
    summary: 'Update applicant claims (name, CNIC, date of birth, categories) with optimistic concurrency.',
    auth: 'session',
    params: ApplicationIdParamSchema,
    request: ApplicationUpdateRequestSchema,
    responses: { 200: DriverApplicationSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'confirmDriverConsent',
    method: 'POST',
    path: '/v1/driver-onboarding/applications/{id}/consent',
    summary: 'DRAFT → CONSENTED once the Driver/Partner agreement and the KYC notice are accepted.',
    auth: 'session',
    params: ApplicationIdParamSchema,
    request: EmptyBody,
    responses: { 200: DriverApplicationSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'getDriverRequirements',
    method: 'GET',
    path: '/v1/driver-onboarding/applications/{id}/requirements',
    summary: 'Requirement checklist from the active requirement set (placeholder sets are labelled).',
    auth: 'session',
    params: ApplicationIdParamSchema,
    responses: { 200: RequirementChecklistSchema, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'addDriverVehicle',
    method: 'POST',
    path: '/v1/driver-onboarding/applications/{id}/vehicles',
    summary: 'Add a vehicle; a plate already on file becomes an affiliation + duplicate signal, never a rejection.',
    auth: 'session',
    params: ApplicationIdParamSchema,
    request: VehicleCreateRequestSchema,
    responses: { 201: VehicleCreatedSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'updateDriverVehicle',
    method: 'POST',
    path: '/v1/driver-onboarding/applications/{id}/vehicles/{vehicleId}',
    summary: 'Update a vehicle owned through this application (optimistic concurrency).',
    auth: 'session',
    params: VehicleParamSchema,
    request: VehicleUpdateRequestSchema,
    responses: { 200: DriverApplicationSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'claimDriverDocument',
    method: 'POST',
    path: '/v1/driver-onboarding/applications/{id}/documents',
    summary: 'Record document claims (number, class, dates) for a requirement item; evidence follows via upload slots.',
    auth: 'session',
    params: ApplicationIdParamSchema,
    request: DocumentClaimRequestSchema,
    responses: { 201: DocumentClaimedSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'withdrawDriverApplication',
    method: 'POST',
    path: '/v1/driver-onboarding/applications/{id}/withdrawal',
    summary: 'Withdraw an application that is not under review.',
    auth: 'session',
    params: ApplicationIdParamSchema,
    request: EmptyBody,
    responses: { 200: DriverApplicationSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'getDriverCompliance',
    method: 'GET',
    path: '/v1/driver/compliance',
    summary: 'Driver compliance: live earning eligibility with every blocker, documents and renewals, restrictions.',
    auth: 'session',
    responses: { 200: DriverComplianceSchema, 401: E, 404: E },
  },
  {
    operationId: 'startDocumentRenewal',
    method: 'POST',
    path: '/v1/driver/documents/{documentId}/renewals',
    summary: 'Start renewing a VALID or EXPIRED document: new claims (dates/number); evidence follows via upload slots of the application.',
    auth: 'session',
    params: DocumentParamSchema,
    request: DocumentRenewalRequestSchema,
    responses: { 201: DocumentRenewalSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'submitDocumentRenewal',
    method: 'POST',
    path: '/v1/driver/documents/{documentId}/renewal-submission',
    summary: 'Submit a renewal once its evidence is ACCEPTED; a human reviewer decides it (DOCUMENT_RENEWAL case).',
    auth: 'session',
    params: DocumentParamSchema,
    request: EmptyBody,
    responses: { 200: DocumentRenewalSchema, 401: E, 403: E, 404: E, 409: E },
  },
] as const satisfies readonly RouteContract[];
