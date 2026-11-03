/**
 * Phase 3 catalog contracts (P3.1; R28/B04/E08/H10; docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md). Terminology
 * (F-P3-04): a SERVICE PRODUCT (`productCode`: ECONOMY, COMFORT, BIKE, RICKSHAW) is the rider-facing offering; a VEHICLE
 * CLASS (`serviceCategory`: CAR, BIKE, RICKSHAW — the existing `catalog.service_categories`) is the compliance key. UI copy
 * never calls a product a "category". Consumers only ever see ENABLED products, with display data and no prices.
 *
 * Staff catalog contracts (zone sets, eligibility rules, product enablement — maker-checker) are added to this module
 * by P3.1 below the consumer section.
 */
import { z } from 'zod';
import { VEHICLE_BODY_TYPES } from './compliance.js';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';
import { ProductCodeSchema } from './pricing.js';

const E = ErrorEnvelopeSchema;
const CityCode = z.string().regex(/^[A-Z]{3}$/);

export const LUGGAGE_CLASSES = ['NONE', 'SMALL', 'STANDARD', 'LARGE'] as const;

export const CatalogProductsQuerySchema = z.strictObject({ cityCode: CityCode });

export const CatalogProductListSchema = z
  .object({
    cityCode: CityCode,
    products: z.array(
      z.object({
        productCode: ProductCodeSchema,
        vehicleClass: z.enum(['CAR', 'BIKE', 'RICKSHAW']),
        nameKey: z.string().regex(/^product\.[a-z0-9_.-]{1,60}$/),
        descriptionKey: z.string().regex(/^product\.[a-z0-9_.-]{1,60}$/),
        seatsMax: z.number().int().min(1).max(12),
        luggageClass: z.enum(LUGGAGE_CLASSES),
        sortOrder: z.number().int().min(0).max(1000),
      }),
    ),
  })
  .meta({ id: 'CatalogProductList' });
export type CatalogProductList = z.infer<typeof CatalogProductListSchema>;

// ── staff (web-ops BFF only): zone sets, eligibility rules, city-product enablement — maker-checker (P3.1) ──────────
// Every configuration version is DRAFT → PENDING_APPROVAL → APPROVED (a DIFFERENT staff member) → ACTIVE → RETIRED, or
// PENDING_APPROVAL → REJECTED; the database refuses maker = checker and edits after DRAFT. Production refuses to
// activate synthetic configuration. Refusals carry `details.reasonCodes` (closed catalogue below).

const IsoDateTime = z.iso.datetime({ offset: true });
const ReasonCode = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);
const SourceReference = z.string().trim().min(3).max(300);
const VehicleClass = z.enum(['CAR', 'BIKE', 'RICKSHAW']);

export const CONFIG_VERSION_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED'] as const;
const ConfigVersionStatus = z.enum(CONFIG_VERSION_STATUSES);
export const CITY_PRODUCT_STATUSES = ['NOT_CONFIGURED', 'CONFIGURED', 'ENABLED', 'SUSPENDED', 'DISABLED_LEGAL_GATE'] as const;
export const ZONE_KINDS = ['SERVICE_AREA', 'EXCLUSION', 'PICKUP_RESTRICTED', 'AIRPORT_PRECINCT'] as const;
export const PICKUP_POINT_KINDS = ['AIRPORT', 'DESIGNATED', 'LANDMARK'] as const;

/**
 * Reason codes of catalog refusals and of GeoJSON validation-report issues (`details.reasonCodes` / `issues[].issue`).
 * PREREQ_* name the missing ENABLE prerequisite; RATE_CARD_CHECK_UNAVAILABLE means no rate-card source is wired
 * (fail closed until pricing exists).
 */
export const CATALOG_REASON_CODES = [
  'MAKER_IS_CHECKER',
  'SYNTHETIC_REFUSED_IN_PRODUCTION',
  'LEGAL_GATE',
  'LEGAL_BASIS_REQUIRED',
  'PREREQ_ZONE_SET_MISSING',
  'PREREQ_ZONE_SET_NOT_COVERING',
  'PREREQ_SERVICE_HOURS_MISSING',
  'PREREQ_ELIGIBILITY_RULE_MISSING',
  'PREREQ_RATE_CARD_MISSING',
  'RATE_CARD_CHECK_UNAVAILABLE',
  'NO_SERVICE_AREA',
  'SERVICE_HOURS_OVERLAP',
  'ENABLED_PRODUCT_WITHOUT_HOURS',
  'NO_PENDING_REQUEST',
  'NOT_ENABLED',
] as const;
export const ZONE_IMPORT_ISSUES = [
  'FEATURE_INVALID',
  'UNSUPPORTED_GEOMETRY',
  'COORDINATES_INVALID',
  'SRID_UNSUPPORTED',
  'AXIS_ORDER_SWAPPED',
  'OUTSIDE_PAKISTAN_ENVELOPE',
  'TOO_MANY_VERTICES',
  'GEOMETRY_INVALID',
  'GEOMETRY_EMPTY',
  'PROPERTIES_INVALID',
  'DUPLICATE_ZONE_CODE',
  'UNKNOWN_PRODUCT',
  'PICKUP_POINT_ZONE_UNKNOWN',
  'PICKUP_POINT_OUTSIDE_ZONE',
  'AIRPORT_POINT_OUTSIDE_PRECINCT',
  'DUPLICATE_PICKUP_POINT',
  'NO_SERVICE_AREA',
] as const;

export const CatalogCityQuerySchema = z.strictObject({ cityCode: CityCode.optional() });
export const CatalogDecisionRequestSchema = z
  .strictObject({ decision: z.enum(['APPROVE', 'REJECT']), reasonCode: ReasonCode.optional() })
  .meta({ id: 'CatalogDecisionRequest' });

/** `HH:MM` local time (Asia/Karachi); closes may be `24:00`. */
const OpensLocal = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const ClosesLocal = z.string().regex(/^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/);
const ServiceHoursRowSchema = z.strictObject({
  /** null = every product without rows of its own; product rows replace the general rows for that product. */
  productCode: ProductCodeSchema.nullable(),
  /** 0 = Sunday … 6 = Saturday. */
  weekday: z.number().int().min(0).max(6),
  /** `[opensLocal, closesLocal)`; equal values mean the whole day; overnight = two rows. */
  opensLocal: OpensLocal,
  closesLocal: ClosesLocal,
});

const Bbox = z.object({ minLat: z.number(), minLng: z.number(), maxLat: z.number(), maxLng: z.number() });
export const ZoneSetSummarySchema = z
  .object({
    id: z.uuid(),
    cityCode: CityCode,
    version: z.number().int(),
    status: ConfigVersionStatus,
    isSynthetic: z.boolean(),
    sourceReference: z.string(),
    supersedesId: z.uuid().nullable(),
    effectiveFrom: IsoDateTime.nullable(),
    effectiveUntil: IsoDateTime.nullable(),
    draftedByStaffId: z.uuid().nullable(),
    approvedByStaffId: z.uuid().nullable(),
    approvalReasonCode: z.string().nullable(),
    createdAt: IsoDateTime,
    zoneCount: z.number().int(),
  })
  .meta({ id: 'ZoneSetSummary' });
/** Geometry is summarised (no map preview until the renderer freeze): polygon/vertex counts, area, bounding box. */
export const ZoneSetSchema = ZoneSetSummarySchema.extend({
  zones: z.array(
    z.object({
      code: z.string(),
      kind: z.enum(ZONE_KINDS),
      nameEn: z.string(),
      nameUr: z.string(),
      /** Empty = applies to every product. */
      products: z.array(z.string()),
      polygonCount: z.number().int(),
      vertexCount: z.number().int(),
      areaKm2: z.number(),
      bbox: Bbox,
    }),
  ),
  pickupPoints: z.array(
    z.object({
      id: z.uuid(),
      zoneCode: z.string(),
      kind: z.enum(PICKUP_POINT_KINDS),
      nameEn: z.string(),
      nameUr: z.string(),
      instructionKey: z.string(),
      status: z.enum(['ACTIVE', 'HIDDEN']),
      lat: z.number(),
      lng: z.number(),
    }),
  ),
  serviceHours: z.array(z.object({ productCode: z.string().nullable(), weekday: z.number().int(), opensLocal: z.string(), closesLocal: z.string() })),
}).meta({ id: 'ZoneSet' });
export const ZoneSetListSchema = z.object({ zoneSets: z.array(ZoneSetSummarySchema) }).meta({ id: 'ZoneSetList' });
export const ZoneSetDraftRequestSchema = z
  .strictObject({
    cityCode: CityCode,
    /** Where the geometry comes from (licensed source, field survey, or the synthetic engineering label). */
    sourceReference: SourceReference,
    /** true = engineering/test configuration; production refuses to activate it. */
    isSynthetic: z.boolean().optional(),
  })
  .meta({ id: 'ZoneSetDraftRequest' });

const GeoJsonFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: z.object({ type: z.string(), coordinates: z.unknown() }).nullable(),
  properties: z.record(z.string(), z.unknown()).nullable(),
});
/**
 * RFC 7946 FeatureCollection (WGS84, [lng, lat] order). Polygon/MultiPolygon features are zones with properties
 * `{code, kind, nameEn, nameUr, products?}`; Point features are pickup points with properties
 * `{zoneCode, kind, nameEn, nameUr, instructionKey, status?}`. The import REPLACES the draft's zones and pickup points
 * when every feature is valid, and writes nothing otherwise (rejects rather than repairs: no ST_MakeValid).
 */
export const ZoneImportRequestSchema = z
  .strictObject({
    featureCollection: z.object({
      type: z.literal('FeatureCollection'),
      crs: z.unknown().optional(),
      features: z.array(GeoJsonFeatureSchema).min(1).max(200),
    }),
  })
  .meta({ id: 'ZoneImportRequest' });
export const ZoneImportResultSchema = z
  .object({
    applied: z.boolean(),
    issues: z.array(
      z.object({
        /** null = an issue of the whole collection. */
        featureIndex: z.number().int().nullable(),
        code: z.string().nullable(),
        issue: z.enum(ZONE_IMPORT_ISSUES),
        /** PostGIS validity reason (geometry facts only), when available. */
        detail: z.string().nullable(),
      }),
    ),
    zoneCount: z.number().int(),
    pickupPointCount: z.number().int(),
    zoneSet: ZoneSetSchema,
  })
  .meta({ id: 'ZoneImportResult' });
export const ServiceHoursReplaceRequestSchema = z.strictObject({ hours: z.array(ServiceHoursRowSchema).max(200) }).meta({ id: 'ServiceHoursReplaceRequest' });

export const EligibilityRuleSchema = z
  .object({
    id: z.uuid(),
    cityCode: CityCode,
    productCode: ProductCodeSchema,
    version: z.number().int(),
    status: ConfigVersionStatus,
    isSynthetic: z.boolean(),
    sourceReference: z.string(),
    minModelYear: z.number().int().nullable(),
    maxVehicleAgeYears: z.number().int().nullable(),
    minSeats: z.number().int().nullable(),
    acRequired: z.boolean(),
    allowedBodyTypes: z.array(z.enum(VEHICLE_BODY_TYPES)),
    supersedesId: z.uuid().nullable(),
    effectiveFrom: IsoDateTime.nullable(),
    effectiveUntil: IsoDateTime.nullable(),
    draftedByStaffId: z.uuid().nullable(),
    approvedByStaffId: z.uuid().nullable(),
    approvalReasonCode: z.string().nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'EligibilityRule' });
export const EligibilityRuleListSchema = z.object({ rules: z.array(EligibilityRuleSchema) }).meta({ id: 'EligibilityRuleList' });
export const EligibilityRuleDraftRequestSchema = z
  .strictObject({
    cityCode: CityCode,
    productCode: ProductCodeSchema,
    /** The regulatory/policy source of the values (EG-03); synthetic rules say so. */
    sourceReference: SourceReference,
    isSynthetic: z.boolean().optional(),
    /** At most one of minModelYear / maxVehicleAgeYears. */
    minModelYear: z.number().int().min(1950).max(2100).nullable(),
    maxVehicleAgeYears: z.number().int().min(0).max(60).nullable(),
    minSeats: z.number().int().min(1).max(12).nullable(),
    acRequired: z.boolean(),
    /** Empty = any body type. */
    allowedBodyTypes: z.array(z.enum(VEHICLE_BODY_TYPES)).max(VEHICLE_BODY_TYPES.length),
  })
  .refine((v) => v.minModelYear === null || v.maxVehicleAgeYears === null, { message: 'at most one of minModelYear and maxVehicleAgeYears' })
  .refine((v) => new Set(v.allowedBodyTypes).size === v.allowedBodyTypes.length, { message: 'allowedBodyTypes must not repeat' })
  .meta({ id: 'EligibilityRuleDraftRequest' });

export const CityProductSchema = z
  .object({
    cityCode: CityCode,
    productCode: ProductCodeSchema,
    vehicleClass: VehicleClass,
    nameKey: z.string(),
    seatsMax: z.number().int(),
    luggageClass: z.enum(LUGGAGE_CLASSES),
    sortOrder: z.number().int(),
    status: z.enum(CITY_PRODUCT_STATUSES),
    /** A maker's ENABLE request awaiting a different approver (from CONFIGURED, or to resume from SUSPENDED). */
    pendingTransition: z.literal('ENABLE').nullable(),
    legalBasisRef: z.string().nullable(),
    isSynthetic: z.boolean(),
    changedByStaffId: z.uuid().nullable(),
    approvedByStaffId: z.uuid().nullable(),
    reasonCode: z.string().nullable(),
    updatedAt: IsoDateTime,
  })
  .meta({ id: 'CityProduct' });
export const CityProductListSchema = z.object({ products: z.array(CityProductSchema) }).meta({ id: 'CityProductList' });
const CityProductKey = { cityCode: CityCode, productCode: ProductCodeSchema };
export const CityProductEnableRequestSchema = z
  .strictObject({
    ...CityProductKey,
    /** Pointer to the founder/counsel/regulator evidence that permits operating the product (never inferred). */
    legalBasisRef: z.string().trim().min(3).max(300),
    reasonCode: ReasonCode,
  })
  .meta({ id: 'CityProductEnableRequest' });
export const CityProductEnableDecisionSchema = z
  .strictObject({ ...CityProductKey, decision: z.enum(['APPROVE', 'REJECT']), reasonCode: ReasonCode.optional() })
  .meta({ id: 'CityProductEnableDecision' });
export const CityProductSuspendRequestSchema = z.strictObject({ ...CityProductKey, reasonCode: ReasonCode }).meta({ id: 'CityProductSuspendRequest' });

const IdParam = z.strictObject({ id: z.uuid() });
const EmptyBody = z.strictObject({});

/** One maker-checker lifecycle (zone sets or eligibility rules) under `/v1/admin/catalog/<resource>`. */
function lifecycleRoutes<const P extends string>(resource: P, noun: string, idPrefix: string, schema: z.ZodType, draftRequest: z.ZodType) {
  return [
    {
      operationId: `submit${idPrefix}`,
      method: 'POST',
      path: `/v1/admin/catalog/${resource}/{id}/submission` as const,
      summary: `Submit a DRAFT ${noun} for approval (checks run; the draft becomes immutable).`,
      auth: 'staff',
      params: IdParam,
      request: EmptyBody,
      responses: { 200: schema, 400: E, 401: E, 403: E, 404: E, 409: E },
    },
    {
      operationId: `decide${idPrefix}`,
      method: 'POST',
      path: `/v1/admin/catalog/${resource}/{id}/approval` as const,
      summary: `A DIFFERENT staff member approves or rejects a pending ${noun} (maker-checker; step-up).`,
      auth: 'staff',
      params: IdParam,
      request: CatalogDecisionRequestSchema,
      responses: { 200: schema, 400: E, 401: E, 403: E, 404: E, 409: E },
    },
    {
      operationId: `activate${idPrefix}`,
      method: 'POST',
      path: `/v1/admin/catalog/${resource}/{id}/activation` as const,
      summary: `Activate an APPROVED ${noun} (retires the previous ACTIVE one; production refuses synthetic; step-up).`,
      auth: 'staff',
      params: IdParam,
      request: EmptyBody,
      responses: { 200: schema, 400: E, 401: E, 403: E, 404: E, 409: E },
    },
    {
      operationId: `retire${idPrefix}`,
      method: 'POST',
      path: `/v1/admin/catalog/${resource}/{id}/retirement` as const,
      summary: `Retire an ACTIVE or APPROVED ${noun} (fails closed: nothing replaces it; step-up).`,
      auth: 'staff',
      params: IdParam,
      request: EmptyBody,
      responses: { 200: schema, 400: E, 401: E, 403: E, 404: E, 409: E },
    },
    {
      operationId: `clone${idPrefix}`,
      method: 'POST',
      path: `/v1/admin/catalog/${resource}/{id}/clones` as const,
      summary: `New DRAFT copied from an approved, active or retired ${noun} (rollback = approve and activate the clone).`,
      auth: 'staff',
      params: IdParam,
      request: EmptyBody,
      responses: { 201: schema, 400: E, 401: E, 403: E, 404: E, 409: E },
    },
    {
      operationId: `draft${idPrefix}`,
      method: 'POST',
      path: `/v1/admin/catalog/${resource}` as const,
      summary: `Draft a new ${noun} version.`,
      auth: 'staff',
      request: draftRequest,
      responses: { 201: schema, 400: E, 401: E, 403: E, 409: E },
    },
  ] as const satisfies readonly RouteContract[];
}

export const CATALOG_ROUTES = [
  {
    operationId: 'listCatalogProducts',
    method: 'GET',
    path: '/v1/catalog/products',
    summary: 'ENABLED service products of a city with display attributes (no prices; quotes price them).',
    auth: 'session',
    query: CatalogProductsQuerySchema,
    responses: { 200: CatalogProductListSchema, 400: E, 401: E, 403: E, 426: E },
  },
  // staff
  {
    operationId: 'listZoneSets',
    method: 'GET',
    path: '/v1/admin/catalog/zone-sets',
    summary: 'Zone-set versions (newest first), optionally of one city.',
    auth: 'staff',
    query: CatalogCityQuerySchema,
    responses: { 200: ZoneSetListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'getZoneSet',
    method: 'GET',
    path: '/v1/admin/catalog/zone-sets/{id}',
    summary: 'One zone set: geometry summary per zone, pickup points and service hours.',
    auth: 'staff',
    params: IdParam,
    responses: { 200: ZoneSetSchema, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'importZoneSetZones',
    method: 'POST',
    path: '/v1/admin/catalog/zone-sets/{id}/zone-imports',
    summary: 'Validate a GeoJSON FeatureCollection and, when every feature is valid, replace the DRAFT zones and pickup points.',
    auth: 'staff',
    params: IdParam,
    request: ZoneImportRequestSchema,
    responses: { 200: ZoneImportResultSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'replaceZoneSetServiceHours',
    method: 'POST',
    path: '/v1/admin/catalog/zone-sets/{id}/service-hours',
    summary: 'Replace the service hours of a DRAFT zone set (Asia/Karachi; overlapping windows refused).',
    auth: 'staff',
    params: IdParam,
    request: ServiceHoursReplaceRequestSchema,
    responses: { 200: ZoneSetSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  ...lifecycleRoutes('zone-sets', 'zone set', 'ZoneSet', ZoneSetSchema, ZoneSetDraftRequestSchema),
  {
    operationId: 'listEligibilityRules',
    method: 'GET',
    path: '/v1/admin/catalog/eligibility-rules',
    summary: 'Vehicle eligibility rule versions (newest first), optionally of one city.',
    auth: 'staff',
    query: CatalogCityQuerySchema,
    responses: { 200: EligibilityRuleListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'getEligibilityRule',
    method: 'GET',
    path: '/v1/admin/catalog/eligibility-rules/{id}',
    summary: 'One vehicle eligibility rule version.',
    auth: 'staff',
    params: IdParam,
    responses: { 200: EligibilityRuleSchema, 401: E, 403: E, 404: E },
  },
  ...lifecycleRoutes('eligibility-rules', 'eligibility rule', 'EligibilityRule', EligibilityRuleSchema, EligibilityRuleDraftRequestSchema),
  {
    operationId: 'listCityProducts',
    method: 'GET',
    path: '/v1/admin/catalog/city-products',
    summary: 'Every service product with its lifecycle state per city.',
    auth: 'staff',
    query: CatalogCityQuerySchema,
    responses: { 200: CityProductListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'requestCityProductEnable',
    method: 'POST',
    path: '/v1/admin/catalog/city-products/enable-requests',
    summary: 'Maker requests ENABLE (or resume from SUSPENDED) after the prerequisites are verified (step-up).',
    auth: 'staff',
    request: CityProductEnableRequestSchema,
    responses: { 200: CityProductSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'decideCityProductEnable',
    method: 'POST',
    path: '/v1/admin/catalog/city-products/enable-decisions',
    summary: 'A DIFFERENT staff member approves or rejects a pending ENABLE (legal gate and prerequisites re-checked; step-up).',
    auth: 'staff',
    request: CityProductEnableDecisionSchema,
    responses: { 200: CityProductSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'suspendCityProduct',
    method: 'POST',
    path: '/v1/admin/catalog/city-products/suspensions',
    summary: 'Suspend an ENABLED city product (safe direction: one staff member with step-up and a reason code).',
    auth: 'staff',
    request: CityProductSuspendRequestSchema,
    responses: { 200: CityProductSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
] as const satisfies readonly RouteContract[];
