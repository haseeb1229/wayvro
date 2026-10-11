/**
 * P2.5 staff compliance contracts (web-ops BFF only): restrictions (V13; maker-checker lifts for SAFETY/FRAUD),
 * requirement sets (K06/R02–R06/R46; maker-checker, placeholders refused in production) and age-policy data entry
 * (A15; counsel-approved values only, maker-checker — no threshold is ever defaulted).
 */
import { z } from 'zod';
import { REASON_CLASS_VALUES, RESTRICTION_SCOPE_VALUES } from './compliance.js';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';
import { IdParamSchema } from './staff.js';

const E = ErrorEnvelopeSchema;
const IsoDateTime = z.iso.datetime({ offset: true });
const ReasonCode = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);
const CityCode = z.string().regex(/^[A-Z]{3}$/);
const CategoryCode = z.enum(['CAR', 'BIKE', 'RICKSHAW']);

export const RestrictionCreateRequestSchema = z
  .strictObject({
    scope: z.enum(RESTRICTION_SCOPE_VALUES),
    accountId: z.uuid().optional(),
    driverProfileId: z.uuid().optional(),
    vehicleId: z.uuid().optional(),
    serviceCapabilityId: z.uuid().optional(),
    cityCode: CityCode.optional(),
    serviceCategory: CategoryCode.optional(),
    reasonCode: ReasonCode,
    // RISK_HOLD is system-created only; SECURITY_HOLD comes from the recovery flows (P2.9)
    reasonClass: z.enum(['SAFETY', 'FRAUD', 'LEGAL', 'COMPLIANCE', 'QUALITY', 'AGE_POLICY']),
    appealable: z.boolean(),
    effectiveUntil: IsoDateTime.optional(),
  })
  .meta({ id: 'RestrictionCreateRequest' });
export const RestrictionLiftRequestSchema = z.strictObject({ reasonCode: ReasonCode }).meta({ id: 'RestrictionLiftRequest' });
export const RestrictionLiftDecisionSchema = z.strictObject({ decision: z.enum(['APPROVE', 'REJECT']) }).meta({ id: 'RestrictionLiftDecision' });
export const RestrictionQuerySchema = z.strictObject({
  accountId: z.uuid().optional(),
  driverProfileId: z.uuid().optional(),
  vehicleId: z.uuid().optional(),
  cursor: z.uuid().optional(),
});
export const RestrictionSchema = z
  .object({
    id: z.uuid(),
    scope: z.enum(RESTRICTION_SCOPE_VALUES),
    accountId: z.uuid().nullable(),
    driverProfileId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    serviceCapabilityId: z.uuid().nullable(),
    cityCode: z.string().nullable(),
    serviceCategory: z.string().nullable(),
    reasonCode: ReasonCode,
    reasonClass: z.enum(REASON_CLASS_VALUES),
    status: z.enum(['ACTIVE', 'LIFT_PENDING_APPROVAL', 'LIFTED', 'EXPIRED']),
    appealable: z.boolean(),
    effectiveFrom: IsoDateTime,
    effectiveUntil: IsoDateTime.nullable(),
    createdByStaff: z.boolean(),
  })
  .meta({ id: 'Restriction' });
export const RestrictionListSchema = z.object({ restrictions: z.array(RestrictionSchema), nextCursor: z.uuid().nullable() }).meta({ id: 'RestrictionList' });

const RequirementItemSchema = z.object({
  documentType: z.string().regex(/^[A-Z][A-Z0-9_]{2,40}$/),
  mandatory: z.boolean(),
  minValidityDaysAtSubmission: z.number().int().min(0).max(3650),
  renewalLeadDays: z.number().int().min(0).max(365),
  appliesToOwnershipTypes: z.array(z.string()).max(6),
  licenceClassesAllowed: z.array(z.string().regex(/^[A-Z0-9-]{1,12}$/)).max(10),
});
export const RequirementSetDraftRequestSchema = z
  .strictObject({
    cityCode: CityCode,
    serviceCategory: CategoryCode,
    /** Mandatory for non-placeholder sets: the legal/regulatory source (counsel memo, notification) — EG-03/EG-04. */
    sourceReference: z.string().trim().min(3).max(300),
    items: z.array(RequirementItemSchema).min(1).max(40),
  })
  .meta({ id: 'RequirementSetDraftRequest' });
export const RequirementSetSchema = z
  .object({
    id: z.uuid(),
    cityCode: CityCode,
    serviceCategory: CategoryCode,
    version: z.number().int(),
    status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED']),
    isPlaceholder: z.boolean(),
    sourceReference: z.string(),
    effectiveFrom: IsoDateTime.nullable(),
    draftedByStaffId: z.uuid().nullable(),
    approvedByStaffId: z.uuid().nullable(),
    items: z.array(RequirementItemSchema),
  })
  .meta({ id: 'RequirementSet' });
export const RequirementSetListSchema = z.object({ sets: z.array(RequirementSetSchema.omit({ items: true })) }).meta({ id: 'RequirementSetList' });
export const DecisionRequestSchema = z.strictObject({ decision: z.enum(['APPROVE', 'REJECT']) }).meta({ id: 'DecisionRequest' });

export const AgePolicyDraftRequestSchema = z
  .strictObject({
    riderDeclarationMode: z.enum(['NONE', 'AFFIRM_MINIMUM_AGE', 'DATE_OF_BIRTH_REQUIRED']),
    riderMinimumAge: z.number().int().min(1).max(120).nullable(),
    driverMinimumAge: z.number().int().min(1).max(120),
    guardianRulesRef: z.string().trim().min(1).max(200).nullable(),
    /** Reference to counsel's approval (EG-23); the values are data entry of that decision, never invented here. */
    approvalRef: z.string().trim().min(1).max(200),
    effectiveAt: IsoDateTime,
  })
  .refine((v) => v.riderDeclarationMode === 'NONE' || v.riderMinimumAge !== null, { message: 'riderMinimumAge is required unless the mode is NONE' })
  .meta({ id: 'AgePolicyDraftRequest' });
export const AgePolicyVersionParamSchema = z.strictObject({ version: z.string().regex(/^[1-9][0-9]{0,5}$/) });
export const AgePolicyAdminSchema = z
  .object({
    version: z.number().int(),
    status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'PLACEHOLDER_NOT_FOR_PRODUCTION', 'APPROVED', 'RETIRED']),
    riderDeclarationMode: z.enum(['NONE', 'AFFIRM_MINIMUM_AGE', 'DATE_OF_BIRTH_REQUIRED']),
    riderMinimumAge: z.number().int().nullable(),
    driverMinimumAge: z.number().int().nullable(),
    approvalRef: z.string().nullable(),
    effectiveAt: IsoDateTime,
    draftedByStaffId: z.uuid().nullable(),
    approvedByStaffId: z.uuid().nullable(),
  })
  .meta({ id: 'AgePolicyAdmin' });
export const AgePolicyListSchema = z.object({ versions: z.array(AgePolicyAdminSchema) }).meta({ id: 'AgePolicyList' });
const EmptyBody = z.strictObject({});

export const COMPLIANCE_ADMIN_ROUTES = [
  {
    operationId: 'listRestrictions',
    method: 'GET',
    path: '/v1/admin/restrictions',
    summary: 'Restrictions of one subject (paginated, scoped; no export).',
    auth: 'staff',
    query: RestrictionQuerySchema,
    responses: { 200: RestrictionListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'createRestriction',
    method: 'POST',
    path: '/v1/admin/restrictions',
    summary: 'Create a reason-coded restriction (scope rules and reason-class permissions enforced).',
    auth: 'staff',
    request: RestrictionCreateRequestSchema,
    responses: { 201: RestrictionSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'liftRestriction',
    method: 'POST',
    path: '/v1/admin/restrictions/{id}/lift',
    summary: 'Lift a restriction (SAFETY/FRAUD lifts need a second approver).',
    auth: 'staff',
    params: IdParamSchema,
    request: RestrictionLiftRequestSchema,
    responses: { 200: RestrictionSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'decideRestrictionLift',
    method: 'POST',
    path: '/v1/admin/restrictions/{id}/lift-approval',
    summary: 'Second approver decides a pending SAFETY/FRAUD lift.',
    auth: 'staff',
    params: IdParamSchema,
    request: RestrictionLiftDecisionSchema,
    responses: { 200: RestrictionSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'listRequirementSets',
    method: 'GET',
    path: '/v1/admin/requirement-sets',
    summary: 'Requirement sets (all versions, newest first).',
    auth: 'staff',
    responses: { 200: RequirementSetListSchema, 401: E, 403: E },
  },
  {
    operationId: 'getRequirementSet',
    method: 'GET',
    path: '/v1/admin/requirement-sets/{id}',
    summary: 'One requirement set with its items.',
    auth: 'staff',
    params: IdParamSchema,
    responses: { 200: RequirementSetSchema, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'draftRequirementSet',
    method: 'POST',
    path: '/v1/admin/requirement-sets',
    summary: 'Draft a new requirement-set version (never a placeholder).',
    auth: 'staff',
    request: RequirementSetDraftRequestSchema,
    responses: { 201: RequirementSetSchema, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'submitRequirementSet',
    method: 'POST',
    path: '/v1/admin/requirement-sets/{id}/submission',
    summary: 'Submit a draft for approval.',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyBody,
    responses: { 200: RequirementSetSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'decideRequirementSet',
    method: 'POST',
    path: '/v1/admin/requirement-sets/{id}/approval',
    summary: 'A different COMPLIANCE_ADMIN approves or rejects (maker-checker).',
    auth: 'staff',
    params: IdParamSchema,
    request: DecisionRequestSchema,
    responses: { 200: RequirementSetSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'activateRequirementSet',
    method: 'POST',
    path: '/v1/admin/requirement-sets/{id}/activation',
    summary: 'Activate an approved set (retires the previous active one; placeholders refused in production).',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyBody,
    responses: { 200: RequirementSetSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'listAgePolicies',
    method: 'GET',
    path: '/v1/admin/age-policies',
    summary: 'Age-eligibility policy versions.',
    auth: 'staff',
    responses: { 200: AgePolicyListSchema, 401: E, 403: E },
  },
  {
    operationId: 'draftAgePolicy',
    method: 'POST',
    path: '/v1/admin/age-policies',
    summary: 'Enter counsel-approved age-policy values (pending a second approver).',
    auth: 'staff',
    request: AgePolicyDraftRequestSchema,
    responses: { 201: AgePolicyAdminSchema, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'decideAgePolicy',
    method: 'POST',
    path: '/v1/admin/age-policies/{version}/approval',
    summary: 'A different COMPLIANCE_ADMIN approves (becomes effective at its date) or rejects (retired).',
    auth: 'staff',
    params: AgePolicyVersionParamSchema,
    request: DecisionRequestSchema,
    responses: { 200: AgePolicyAdminSchema, 401: E, 403: E, 404: E, 409: E },
  },
] as const satisfies readonly RouteContract[];
