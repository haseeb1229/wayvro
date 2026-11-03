/**
 * Phase 3 release-control contracts (P3.4; A01/Q31/V10; docs/phase3/PHASE3_ARCHITECTURE.md §9; ADR-049). The public,
 * cacheable `GET /v1/app/config` tells an installed app whether it may continue (OK / SOFT_UPDATE / HARD_UPDATE /
 * MAINTENANCE), which presentation-relevant runtime switches are in their safe state, the map-renderer descriptor of
 * the licence-coherent geo bundle (`rendererKind: none` until the P3.7 freeze) and client tuning values. It carries no
 * per-user data and no secret. The version headers it reads are compatibility hints only (ADR-049): the server stays
 * authoritative for every business rule and enforces 426/503 itself.
 *
 * Staff release-control contracts (version policies, runtime switches, maintenance) follow the consumer section.
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import { AppPlatformSchema } from './headers.js';
import type { RouteContract } from './health.js';
import { EmptyRequestSchema, IdParamSchema } from './staff.js';

const E = ErrorEnvelopeSchema;
const IsoDateTime = z.iso.datetime({ offset: true });
const MessageKey = z.string().regex(/^[a-z][a-zA-Z0-9_.-]{2,80}$/);

export const CLIENT_POLICY_STATES = ['OK', 'SOFT_UPDATE', 'HARD_UPDATE', 'MAINTENANCE'] as const;
export const MAP_RENDERER_KINDS = ['none', 'google', 'mapbox', 'maplibre'] as const;
/** Runtime switch key pattern (code registry; the database cannot invent keys). */
export const RuntimeSwitchKeySchema = z.string().regex(/^(rider|driver|ops|platform)\.[a-z0-9]+(-[a-z0-9]+)*$/);

export const AppConfigSchema = z
  .object({
    serverTime: IsoDateTime,
    client: z.object({
      state: z.enum(CLIENT_POLICY_STATES),
      /** Why a HARD_UPDATE is required (from the matched blocked range or the minimum build); null otherwise. */
      reasonClass: z.enum(['SECURITY', 'DATA_CORRUPTION', 'CONTRACT_BREAK', 'MINIMUM_BUILD']).nullable(),
      messageKey: MessageKey.nullable(),
      /** Store link key (store ids are undecided, EG-15); null = "update from the store where you installed Wayvro". */
      storeUrlKey: z
        .string()
        .regex(/^[a-z][a-z0-9_.-]{2,40}$/)
        .nullable(),
      recommendedBuild: z.number().int().nonnegative().nullable(),
      minSupportedBuild: z.number().int().nonnegative().nullable(),
    }),
    maintenance: z.object({ active: z.boolean(), messageKey: MessageKey.nullable(), expectedEnd: IsoDateTime.nullable() }),
    /** Presentation-relevant switches only (never a security decision; the server enforces every switch itself). */
    switches: z.array(z.object({ key: RuntimeSwitchKeySchema, state: z.enum(['ENABLED', 'DISABLED']), messageKey: MessageKey.nullable() })),
    map: z.object({
      rendererKind: z.enum(MAP_RENDERER_KINDS),
      styleUrl: z.url().nullable(),
      attributionCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/)),
      /** Restricted, rotatable client token only if the chosen renderer needs one (P3.7); never a server key. */
      clientToken: z.string().min(1).max(512).nullable(),
    }),
    geo: z.object({
      autocompleteMinChars: z.number().int().min(1).max(10),
      autocompleteDebounceMs: z.number().int().min(0).max(5000),
      reverseDebounceMs: z.number().int().min(0).max(5000),
    }),
    lite: z.object({ autoSuggestAfterSlowRequests: z.number().int().min(1).max(20), slowRequestMs: z.number().int().min(500).max(30000) }),
  })
  .meta({ id: 'AppConfig' });
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const APP_CONFIG_ROUTES = [
  {
    operationId: 'getAppConfig',
    method: 'GET',
    path: '/v1/app/config',
    summary:
      'Public, cacheable app configuration: version/update state for the calling build (from the x-wayvro-* headers), maintenance, presentation switches, map descriptor, client tuning.',
    auth: 'public',
    // 304: `If-None-Match` matched the ETag (body unchanged apart from serverTime; clients keep their cached copy)
    responses: { 200: AppConfigSchema, 304: null, 400: E, 429: E, 503: E },
  },
] as const satisfies readonly RouteContract[];

// ── staff release controls (P3.4; web-ops BFF only; RELEASE_MANAGER, read-only AUDITOR) ──────────────────────────────
// Version policies: maker-checker (a different staff member approves; database CHECK + service), guardrails against
// bricking installs (T3-25), activation now or scheduled on server time. Runtime switches: moving TO the safe state is
// one authorised staff member with step-up; moving away from it is maker-checker. Maintenance is the switch
// `platform.maintenance` (safe state ENABLED = maintenance in progress).

const ReasonCode = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);
const CityCode = z.string().regex(/^[A-Z]{3}$/);
const Build = z.number().int().min(0).max(999_999_999);
const StoreUrlKey = z.string().regex(/^[a-z][a-z0-9_.-]{2,40}$/);

export const APP_POLICY_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED'] as const;
export const BLOCKED_BUILD_REASON_CODES = ['SECURITY', 'DATA_CORRUPTION', 'CONTRACT_BREAK'] as const;
export const SWITCH_STATES = ['ENABLED', 'DISABLED'] as const;
export const SWITCH_SCOPES = ['ALL', 'RIDER', 'DRIVER'] as const;
export const SWITCH_CHANGE_DIRECTIONS = ['TO_SAFE', 'FROM_SAFE', 'EXPIRY'] as const;
export const SWITCH_CHANGE_STATUSES = ['APPLIED', 'PENDING_APPROVAL', 'REJECTED'] as const;

/** An inclusive build range (`fromBuild`..`toBuild`) blocked for a reason shown to the user as a class. */
const BlockedBuildRangeRequestSchema = z.strictObject({ fromBuild: Build, toBuild: Build, reasonCode: z.enum(BLOCKED_BUILD_REASON_CODES) });
const policyValues = {
  minSupportedBuild: Build,
  recommendedBuild: Build,
  storeUrlKey: StoreUrlKey.nullable(),
  softMessageKey: MessageKey,
  hardMessageKey: MessageKey,
  blockedRanges: z.array(BlockedBuildRangeRequestSchema).max(20),
};
export const AppVersionPolicyDraftRequestSchema = z.strictObject({ platform: AppPlatformSchema, ...policyValues }).meta({ id: 'AppVersionPolicyDraftRequest' });
/** Replaces the values (and blocked ranges) of a DRAFT; only its drafter may revise it. */
export const AppVersionPolicyRevisionRequestSchema = z.strictObject(policyValues).meta({ id: 'AppVersionPolicyRevisionRequest' });
export const AppVersionPolicyDecisionRequestSchema = z
  .strictObject({ decision: z.enum(['APPROVE', 'REJECT']) })
  .meta({ id: 'AppVersionPolicyDecisionRequest' });
/** Activate now, or schedule for `effectiveFrom` (server time; never in the past). */
export const AppVersionPolicyActivationRequestSchema = z
  .discriminatedUnion('when', [z.strictObject({ when: z.literal('NOW') }), z.strictObject({ when: z.literal('SCHEDULED'), effectiveFrom: IsoDateTime })])
  .meta({ id: 'AppVersionPolicyActivationRequest' });
export const AppVersionPolicyListQuerySchema = z.strictObject({ platform: AppPlatformSchema.optional() });

export const AppVersionPolicySchema = z
  .object({
    id: z.uuid(),
    platform: AppPlatformSchema,
    version: z.number().int().positive(),
    status: z.enum(APP_POLICY_STATUSES),
    minSupportedBuild: Build,
    recommendedBuild: Build,
    storeUrlKey: StoreUrlKey.nullable(),
    softMessageKey: MessageKey,
    hardMessageKey: MessageKey,
    blockedRanges: z.array(z.object({ fromBuild: Build, toBuild: Build, reasonCode: z.enum(BLOCKED_BUILD_REASON_CODES) })),
    effectiveFrom: IsoDateTime.nullable(),
    effectiveUntil: IsoDateTime.nullable(),
    scheduled: z.boolean(),
    draftedByStaffId: z.uuid(),
    approvedByStaffId: z.uuid().nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'AppVersionPolicy' });
export const AppVersionPolicyListSchema = z.object({ policies: z.array(AppVersionPolicySchema) }).meta({ id: 'AppVersionPolicyList' });

/**
 * Dry-run preview before submit/approve/activate: the guardrail verdict and the installed base it would touch. Builds
 * are NOT recorded by Phase-2 sessions (only the app version string), so the preview reports active sessions per
 * recorded app version and says so (`buildsRecorded: false`) instead of an invented affected-install count.
 */
export const AppVersionPolicyPreviewSchema = z
  .object({
    policyId: z.uuid(),
    platform: AppPlatformSchema,
    latestReleasedBuild: Build,
    /** Guardrail problem codes (empty = the policy passes every guardrail now). */
    guardrailProblems: z.array(ReasonCode),
    buildsRecorded: z.boolean(),
    activeSessionsByAppVersion: z.array(z.object({ appVersion: z.string().min(1).max(32), activeSessions: z.number().int().nonnegative() })),
  })
  .meta({ id: 'AppVersionPolicyPreview' });

const SwitchRowSchema = z.object({
  scope: z.enum(SWITCH_SCOPES),
  cityCode: CityCode.nullable(),
  state: z.enum(SWITCH_STATES),
  reasonCode: ReasonCode,
  messageKey: MessageKey.nullable(),
  expectedEnd: IsoDateTime.nullable(),
  effectiveUntil: IsoDateTime.nullable(),
  /** null = the system (effective_until expiry). */
  changedByStaffId: z.uuid().nullable(),
  approvedByStaffId: z.uuid().nullable(),
  updatedAt: IsoDateTime,
});
export const RuntimeSwitchChangeSchema = z
  .object({
    id: z.uuid(),
    key: RuntimeSwitchKeySchema,
    scope: z.enum(SWITCH_SCOPES),
    cityCode: CityCode.nullable(),
    fromState: z.enum(SWITCH_STATES),
    toState: z.enum(SWITCH_STATES),
    direction: z.enum(SWITCH_CHANGE_DIRECTIONS),
    status: z.enum(SWITCH_CHANGE_STATUSES),
    requestedByStaffId: z.uuid().nullable(),
    approvedByStaffId: z.uuid().nullable(),
    reasonCode: ReasonCode,
    messageKey: MessageKey.nullable(),
    expectedEnd: IsoDateTime.nullable(),
    effectiveUntil: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
    decidedAt: IsoDateTime.nullable(),
  })
  .meta({ id: 'RuntimeSwitchChange' });
export const RuntimeSwitchListSchema = z
  .object({
    switches: z.array(
      z.object({
        key: RuntimeSwitchKeySchema,
        purpose: z.string().min(1),
        safeState: z.enum(SWITCH_STATES),
        allowedScopes: z.array(z.enum(SWITCH_SCOPES)),
        clientVisible: z.boolean(),
        /** State when no ALL-scope row exists (code registry, this environment). */
        defaultState: z.enum(SWITCH_STATES),
        /** State of the ALL-scope, city-less target (row or default); narrower rows can only stop more. */
        baseState: z.enum(SWITCH_STATES),
        rows: z.array(SwitchRowSchema),
      }),
    ),
    pendingRequests: z.array(RuntimeSwitchChangeSchema),
  })
  .meta({ id: 'RuntimeSwitchList' });
export const RuntimeSwitchChangeListSchema = z
  .object({ changes: z.array(RuntimeSwitchChangeSchema), nextCursor: z.uuid().nullable() })
  .meta({ id: 'RuntimeSwitchChangeList' });
export const RuntimeSwitchChangeQuerySchema = z.strictObject({ cursor: z.uuid().optional() });
/** Moves a switch target to its SAFE state now (one authorised staff member with step-up). */
export const RuntimeSwitchSafeStateRequestSchema = z
  .strictObject({
    key: RuntimeSwitchKeySchema,
    scope: z.enum(SWITCH_SCOPES),
    cityCode: CityCode.optional(),
    reasonCode: ReasonCode,
    /** Shown to apps (e.g. the maintenance message key). */
    messageKey: MessageKey.optional(),
    /** Maintenance: expected end (drives Retry-After); informational, never ends anything by itself. */
    expectedEnd: IsoDateTime.optional(),
    /** Optional automatic return to the registry default at this instant (worker expiry job). */
    effectiveUntil: IsoDateTime.optional(),
  })
  .meta({ id: 'RuntimeSwitchSafeStateRequest' });
/** Requests the move AWAY from the safe state; a different staff member approves (maker-checker). */
export const RuntimeSwitchRestoreRequestSchema = z
  .strictObject({ key: RuntimeSwitchKeySchema, scope: z.enum(SWITCH_SCOPES), cityCode: CityCode.optional(), reasonCode: ReasonCode })
  .meta({ id: 'RuntimeSwitchRestoreRequest' });
export const RuntimeSwitchRestoreDecisionSchema = z.strictObject({ decision: z.enum(['APPROVE', 'REJECT']) }).meta({ id: 'RuntimeSwitchRestoreDecision' });

export const RELEASE_ADMIN_ROUTES = [
  {
    operationId: 'listAppVersionPolicies',
    method: 'GET',
    path: '/v1/admin/release/policies',
    summary: 'App version policies (newest first), optionally for one platform.',
    auth: 'staff',
    query: AppVersionPolicyListQuerySchema,
    responses: { 200: AppVersionPolicyListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'createAppVersionPolicyDraft',
    method: 'POST',
    path: '/v1/admin/release/policies',
    summary: 'Draft a version policy (minimum/recommended build, message and store keys, blocked build ranges). Step-up.',
    auth: 'staff',
    request: AppVersionPolicyDraftRequestSchema,
    responses: { 201: AppVersionPolicySchema, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'getAppVersionPolicy',
    method: 'GET',
    path: '/v1/admin/release/policies/{id}',
    summary: 'One version policy with its blocked build ranges.',
    auth: 'staff',
    params: IdParamSchema,
    responses: { 200: AppVersionPolicySchema, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'reviseAppVersionPolicyDraft',
    method: 'POST',
    path: '/v1/admin/release/policies/{id}/revision',
    summary: 'Replace the values and blocked ranges of a DRAFT (its drafter only). Step-up.',
    auth: 'staff',
    params: IdParamSchema,
    request: AppVersionPolicyRevisionRequestSchema,
    responses: { 200: AppVersionPolicySchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'submitAppVersionPolicy',
    method: 'POST',
    path: '/v1/admin/release/policies/{id}/submission',
    summary: 'Submit a DRAFT for approval (guardrails checked; details.reasonCodes on refusal). Step-up.',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 200: AppVersionPolicySchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'decideAppVersionPolicy',
    method: 'POST',
    path: '/v1/admin/release/policies/{id}/approval',
    summary: 'Approve or reject a submitted policy (never its drafter; guardrails re-checked). Step-up.',
    auth: 'staff',
    params: IdParamSchema,
    request: AppVersionPolicyDecisionRequestSchema,
    responses: { 200: AppVersionPolicySchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'activateAppVersionPolicy',
    method: 'POST',
    path: '/v1/admin/release/policies/{id}/activation',
    summary: 'Activate an APPROVED policy now (retiring the previous ACTIVE one) or schedule it on server time. Step-up.',
    auth: 'staff',
    params: IdParamSchema,
    request: AppVersionPolicyActivationRequestSchema,
    responses: { 200: AppVersionPolicySchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'cancelAppVersionPolicySchedule',
    method: 'POST',
    path: '/v1/admin/release/policies/{id}/schedule-cancellation',
    summary: 'Cancel the scheduled activation of an APPROVED policy. Step-up.',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 200: AppVersionPolicySchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'retireAppVersionPolicy',
    method: 'POST',
    path: '/v1/admin/release/policies/{id}/retirement',
    summary: 'Retire an ACTIVE or APPROVED policy (no ACTIVE policy = no update enforcement). Step-up.',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 200: AppVersionPolicySchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'previewAppVersionPolicy',
    method: 'GET',
    path: '/v1/admin/release/policies/{id}/preview',
    summary: 'Dry run: guardrail verdict and active sessions per recorded app version on the policy platform.',
    auth: 'staff',
    params: IdParamSchema,
    responses: { 200: AppVersionPolicyPreviewSchema, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'listRuntimeSwitches',
    method: 'GET',
    path: '/v1/admin/switches',
    summary: 'Every registered runtime switch with its rows, registry default and pending restore requests.',
    auth: 'staff',
    responses: { 200: RuntimeSwitchListSchema, 401: E, 403: E },
  },
  {
    operationId: 'listRuntimeSwitchChanges',
    method: 'GET',
    path: '/v1/admin/switches/changes',
    summary: 'Runtime switch change history (newest first, keyset pagination).',
    auth: 'staff',
    query: RuntimeSwitchChangeQuerySchema,
    responses: { 200: RuntimeSwitchChangeListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'createRuntimeSwitchSafeStateChange',
    method: 'POST',
    path: '/v1/admin/switches/safe-state-changes',
    summary: 'Move a switch target to its SAFE state now (e.g. stop quotes, start maintenance). Step-up; audited; alert signal.',
    auth: 'staff',
    request: RuntimeSwitchSafeStateRequestSchema,
    responses: { 201: RuntimeSwitchChangeSchema, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'createRuntimeSwitchRestoreRequest',
    method: 'POST',
    path: '/v1/admin/switches/restore-requests',
    summary: 'Request moving a switch target away from its SAFE state (needs a different approver). Step-up.',
    auth: 'staff',
    request: RuntimeSwitchRestoreRequestSchema,
    responses: { 201: RuntimeSwitchChangeSchema, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'decideRuntimeSwitchRestoreRequest',
    method: 'POST',
    path: '/v1/admin/switches/restore-requests/{id}/approval',
    summary: 'Approve (apply) or reject a restore request (never its requester). Step-up.',
    auth: 'staff',
    params: IdParamSchema,
    request: RuntimeSwitchRestoreDecisionSchema,
    responses: { 200: RuntimeSwitchChangeSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
] as const satisfies readonly RouteContract[];
