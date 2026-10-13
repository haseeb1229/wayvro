/**
 * Phase 3 quote contracts (P3.3; B03/B04/B06/E05/E07; docs/phase3/PHASE3_PRICING_QUOTE_MODEL.md §8). The server is
 * authoritative for every amount: the request is a strict object, so a client-supplied fare, total, distance, duration
 * or component is rejected (400), never read. Money travels as `{currency, minor}` with `minor` a decimal STRING of PKR
 * minor units (never a JSON number). A quote is its own aggregate (PRICED → EXPIRED | SUPERSEDED); "request ride" does
 * not exist in Phase 3. When routing is unavailable the quote is refused (503 ROUTING_UNAVAILABLE) — no estimate, no
 * metered fallback, no invented ETA or distance.
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import { GeoConfidenceSchema, PlaceRefSchema, ProviderKeySchema } from './geo.js';
import type { RouteContract } from './health.js';

const E = ErrorEnvelopeSchema;
const IsoDateTime = z.iso.datetime({ offset: true });
const CityCode = z.string().regex(/^[A-Z]{3}$/);
export const ProductCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,23}$/);

/** PKR amount in minor units as a decimal string (bigint on the server; never a binary float). */
export const MoneyAmountSchema = z.object({ currency: z.literal('PKR'), minor: z.string().regex(/^-?(0|[1-9][0-9]{0,15})$/) }).meta({ id: 'MoneyAmount' });
export type MoneyAmount = z.infer<typeof MoneyAmountSchema>;

export const QUOTE_COMPONENT_KINDS = [
  'BASE',
  'DISTANCE',
  'TIME',
  'BOOKING_FEE',
  'AIRPORT_FEE',
  'MINIMUM_ADJUSTMENT',
  'TOLL',
  'TAX',
  // reserved for Phase 9 promotions; the Phase-3 engine never emits it
  'DISCOUNT',
  'ROUNDING',
] as const;
export const QuoteComponentKindSchema = z.enum(QUOTE_COMPONENT_KINDS);

/** Why a product could not be priced for this request (also the 422 `details.reasonCodes` vocabulary). */
export const QUOTE_UNAVAILABLE_REASONS = ['ZONE_NOT_SERVED', 'PICKUP_RESTRICTED', 'OUTSIDE_SERVICE_HOURS', 'ROUTE_TOO_LONG', 'NO_ACTIVE_RATE_CARD'] as const;
export const QuoteUnavailableReasonSchema = z.enum(QUOTE_UNAVAILABLE_REASONS);

const QuotePointSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Optional label source from search; validated (owner, expiry) and used only for display — never for pricing. */
  placeRef: PlaceRefSchema.optional(),
});

export const QuoteRequestSchema = z
  .strictObject({
    cityCode: CityCode,
    pickup: QuotePointSchema,
    dropoff: QuotePointSchema,
    /** Default: every ENABLED product of the city. */
    products: z.array(ProductCodeSchema).min(1).max(8).optional(),
  })
  .meta({ id: 'QuoteRequest' });
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

/** `lite`: omit the route polyline (Lite mode, L08). */
export const QuoteDetailQuerySchema = z.strictObject({ detail: z.enum(['full', 'lite']).optional() });

export const QuoteComponentSchema = z.object({
  kind: QuoteComponentKindSchema,
  amount: MoneyAmountSchema,
  /** Ids and numbers only (e.g. distanceM, perKmMinor, rateBp, stepMinor); never coordinates or personal data. */
  basis: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
export type QuoteComponent = z.infer<typeof QuoteComponentSchema>;

export const QuoteOptionSchema = z.object({
  quoteId: z.uuid(),
  productCode: ProductCodeSchema,
  /** Computed at read time from server time: PRICED until `expiresAt`, then EXPIRED; SUPERSEDED by a newer group. */
  status: z.enum(['PRICED', 'EXPIRED', 'SUPERSEDED']),
  total: MoneyAmountSchema,
  /** Ordered server components; Σ amount = total (enforced in the database). */
  components: z.array(QuoteComponentSchema).min(1),
  /** Inclusive tax disclosure (informational, not part of Σ); null when tax is exclusive or absent. */
  taxIncluded: z.object({ rateBp: z.number().int().min(0).max(10000), amount: MoneyAmountSchema }).nullable(),
  tollPolicy: z.enum(['NOT_APPLICABLE', 'EXCLUDED_DISCLOSED']),
  expiresAt: IsoDateTime,
  rateCardVersion: z.number().int().positive(),
  pricingEngineVersion: z.string().regex(/^pe-v[0-9]{1,4}$/),
  display: z.object({
    nameKey: z.string().regex(/^product\.[a-z0-9_.-]{1,60}$/),
    seatsMax: z.number().int().min(1).max(12),
    luggageClass: z.enum(['NONE', 'SMALL', 'STANDARD', 'LARGE']),
  }),
  /** Local/test synthetic configuration only; a synthetic option cannot exist in staging/production. */
  isSynthetic: z.boolean(),
});
export type QuoteOption = z.infer<typeof QuoteOptionSchema>;

export const QuoteGroupSchema = z
  .object({
    quoteGroupId: z.uuid(),
    createdAt: IsoDateTime,
    pickup: z.object({
      /** The designated/airport pickup point the server snapped a restricted pickup to (null = the requested point). */
      snappedTo: z
        .object({
          pickupPointId: z.uuid(),
          kind: z.enum(['AIRPORT', 'DESIGNATED', 'LANDMARK']),
          nameEn: z.string().min(1).max(80),
          nameUr: z.string().min(1).max(80),
          instructionKey: z.string().regex(/^pickup\.[a-z0-9_.-]{1,60}$/),
          point: z.object({ lat: z.number(), lng: z.number() }),
        })
        .nullable(),
    }),
    route: z.object({
      distanceM: z.number().int().positive(),
      durationS: z.number().int().nonnegative(),
      /** Encoded, simplified polyline (≤ 2 KB); null when omitted (`detail=lite`) or not storable under provider terms. */
      polyline: z.string().max(2048).nullable(),
      confidence: GeoConfidenceSchema,
      source: z.object({
        providerKey: ProviderKeySchema,
        fetchedAt: IsoDateTime,
        cacheStatus: z.enum(['HIT', 'MISS']),
        attributionCode: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]{1,40}$/)
          .nullable(),
      }),
    }),
    options: z.array(QuoteOptionSchema),
    unavailable: z.array(
      z.object({
        productCode: ProductCodeSchema,
        reasonCode: QuoteUnavailableReasonSchema,
        /** For OUTSIDE_SERVICE_HOURS: the next opening instant (server time, Asia/Karachi schedule). */
        nextOpenAt: IsoDateTime.nullable(),
      }),
    ),
  })
  .meta({ id: 'QuoteGroup' });
export type QuoteGroup = z.infer<typeof QuoteGroupSchema>;

export const QuoteGroupParamSchema = z.strictObject({ quoteGroupId: z.uuid() });

export const QUOTE_ROUTES = [
  {
    operationId: 'createQuote',
    method: 'POST',
    path: '/v1/quotes',
    summary:
      'Server-authoritative upfront price per ENABLED, eligible product for one route (idempotent). 422 SERVICE_AREA when nothing can be priced; 503 ROUTING_UNAVAILABLE instead of any estimate.',
    auth: 'session',
    request: QuoteRequestSchema,
    query: QuoteDetailQuerySchema,
    responses: { 201: QuoteGroupSchema, 400: E, 401: E, 403: E, 404: E, 409: E, 422: E, 426: E, 429: E, 503: E },
  },
  {
    operationId: 'getQuoteGroup',
    method: 'GET',
    path: '/v1/quotes/{quoteGroupId}',
    summary: "Restore one of the calling account's quote groups (status computed on server time); foreign or purged ids answer 404.",
    auth: 'session',
    params: QuoteGroupParamSchema,
    query: QuoteDetailQuerySchema,
    responses: { 200: QuoteGroupSchema, 401: E, 403: E, 404: E, 426: E },
  },
] as const satisfies readonly RouteContract[];

// ── staff (web-ops BFF only): tax policies, rate cards, previews, support quote lookup — maker-checker (P3.3; H06) ──
// Every configuration version is DRAFT → PENDING_APPROVAL → APPROVED (a DIFFERENT PRICING_MANAGER, step-up, approval
// reason) → ACTIVE → RETIRED, or PENDING_APPROVAL → REJECTED; the database refuses maker = checker and edits after DRAFT.
// Production refuses to activate synthetic cards and cards on placeholder tax policies. Rollback = a NEW version cloned
// from an earlier APPROVED/RETIRED card that goes through the full maker-checker path. Amounts are decimal strings of
// PKR minor units (never JSON numbers). The support quote view shows district codes, never coordinates or a polyline.

const ReasonCode = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);
const IdParam = z.strictObject({ id: z.uuid() });
const EmptyBody = z.strictObject({});
const RoundingModeSchema = z.enum(['HALF_EVEN', 'HALF_UP', 'FLOOR', 'CEILING']);
const TollPolicySchema = z.enum(['NOT_APPLICABLE', 'EXCLUDED_DISCLOSED']);
/** A configuration amount: PKR minor units as a decimal string within the database bounds (0..10,000,000). */
const ConfigMinor = z.string().regex(/^(0|[1-9][0-9]{0,7})$/);
export const TAXABLE_COMPONENT_KINDS = ['BASE', 'DISTANCE', 'TIME', 'MINIMUM_ADJUSTMENT', 'BOOKING_FEE', 'AIRPORT_FEE'] as const;
export const PRICING_CONFIG_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED'] as const;
/** Closed list of reasons a support agent records for looking at a quote (audited with every view; T3-33). */
export const QUOTE_ACCESS_REASONS = ['CUSTOMER_CONTACT_VERIFIED', 'FARE_DISPUTE', 'FRAUD_INVESTIGATION', 'SAFETY_REPORT'] as const;
/** Reason codes of pricing refusals (`details.reasonCodes`); ENVELOPE_* codes name a field outside the sanity envelope. */
export const PRICING_REASON_CODES = [
  'MAKER_IS_CHECKER',
  'NOT_DRAFTER',
  'CITY_SCOPE',
  'TAX_POLICY_NOT_APPROVED',
  'TAX_POLICY_IN_USE',
  'SYNTHETIC_REFUSED_IN_PRODUCTION',
  'PLACEHOLDER_TAX_REFUSED_IN_PRODUCTION',
  'NEWER_CARD_ACTIVE',
  'EFFECTIVE_FROM_IN_PAST',
  'NOT_SCHEDULED',
  'ENVELOPE_OVERRIDE_REQUIRED',
  'APPROVAL_REASON_REQUIRED',
  'ROLLBACK_SOURCE_INVALID',
] as const;

export const TaxPolicySchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    version: z.number().int().positive(),
    status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RETIRED', 'REJECTED']),
    jurisdictionCode: z.string(),
    rateBp: z.number().int().min(0).max(10000),
    appliesTo: z.array(z.enum(TAXABLE_COMPONENT_KINDS)),
    inclusive: z.boolean(),
    roundingMode: RoundingModeSchema,
    isPlaceholder: z.boolean(),
    legalReference: z.string().nullable(),
    draftedByStaffId: z.uuid().nullable(),
    approvedByStaffId: z.uuid().nullable(),
    createdAt: IsoDateTime,
    /** ACTIVE rate cards referencing this version (retirement is refused while > 0). */
    activeCardCount: z.number().int().nonnegative(),
  })
  .meta({ id: 'TaxPolicy' });
export const TaxPolicyListSchema = z.object({ taxPolicies: z.array(TaxPolicySchema) }).meta({ id: 'TaxPolicyList' });
export const TaxPolicyDraftRequestSchema = z
  .strictObject({
    code: z.string().regex(/^[A-Z][A-Z0-9_-]{2,40}$/),
    jurisdictionCode: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/),
    rateBp: z.number().int().min(0).max(10000),
    appliesTo: z.array(z.enum(TAXABLE_COMPONENT_KINDS)).min(1).max(TAXABLE_COMPONENT_KINDS.length),
    inclusive: z.boolean(),
    roundingMode: RoundingModeSchema.optional(),
    /** A placeholder (no counsel-approved value, FA-15b) is refused in production; otherwise a legal reference is required. */
    isPlaceholder: z.boolean(),
    legalReference: z.string().trim().min(3).max(300).optional(),
  })
  .refine((v) => v.isPlaceholder || v.legalReference !== undefined, { message: 'a non-placeholder policy needs a legal reference' })
  .refine((v) => new Set(v.appliesTo).size === v.appliesTo.length, { message: 'appliesTo must not repeat' })
  // the minimum-fare top-up stands in for BASE + DISTANCE + TIME, so it is taxed only together with all three (monotonic totals)
  .refine((v) => !v.appliesTo.includes('MINIMUM_ADJUSTMENT') || (['BASE', 'DISTANCE', 'TIME'] as const).every((k) => v.appliesTo.includes(k)), {
    message: 'MINIMUM_ADJUSTMENT is taxable only together with BASE, DISTANCE and TIME',
  })
  .meta({ id: 'TaxPolicyDraftRequest' });
export const PricingDecisionRequestSchema = z
  .strictObject({ decision: z.enum(['APPROVE', 'REJECT']), reasonCode: ReasonCode.optional() })
  .meta({ id: 'PricingDecisionRequest' });

export const RateCardValuesSchema = z
  .strictObject({
    baseMinor: ConfigMinor,
    perKmMinor: ConfigMinor,
    perMinMinor: ConfigMinor,
    /** Must be a multiple of `roundingStepMinor` (the total then never falls below it). */
    minimumFareMinor: ConfigMinor,
    bookingFeeMinor: ConfigMinor,
    airportPickupFeeMinor: ConfigMinor,
    roundingStepMinor: z.string().regex(/^[1-9][0-9]{0,4}$/),
    roundingMode: RoundingModeSchema,
    tollPolicy: TollPolicySchema,
    taxPolicyId: z.uuid(),
    quoteTtlSeconds: z.number().int().min(60).max(1800),
    maxDistanceM: z.number().int().min(100).max(200000),
    maxDurationS: z.number().int().min(60).max(21600),
  })
  .refine((v) => BigInt(v.roundingStepMinor) <= 10000n && BigInt(v.minimumFareMinor) % BigInt(v.roundingStepMinor) === 0n, {
    message: 'minimumFareMinor must be a multiple of roundingStepMinor (at most 10000)',
  })
  .meta({ id: 'RateCardValues' });

const RateCardValuesViewSchema = z.object({
  baseMinor: z.string(),
  perKmMinor: z.string(),
  perMinMinor: z.string(),
  minimumFareMinor: z.string(),
  bookingFeeMinor: z.string(),
  airportPickupFeeMinor: z.string(),
  roundingStepMinor: z.string(),
  roundingMode: RoundingModeSchema,
  tollPolicy: TollPolicySchema,
  taxPolicyId: z.uuid(),
  quoteTtlSeconds: z.number().int(),
  maxDistanceM: z.number().int(),
  maxDurationS: z.number().int(),
});
const RateCardHeader = {
  id: z.uuid(),
  cityCode: CityCode,
  productCode: ProductCodeSchema,
  version: z.number().int().positive(),
  status: z.enum(PRICING_CONFIG_STATUSES),
  isSynthetic: z.boolean(),
  sourceReference: z.string(),
  effectiveFrom: IsoDateTime.nullable(),
  effectiveUntil: IsoDateTime.nullable(),
  /** Activation requested for `effectiveFrom` (server time); the worker activates it, re-checking every rule. */
  scheduled: z.boolean(),
  draftedByStaffId: z.uuid().nullable(),
  approvedByStaffId: z.uuid().nullable(),
  approvalReasonCode: z.string().nullable(),
  /** The maker's explicit reason for values outside the sanity envelope (shown to the approver). */
  envelopeOverrideReasonCode: z.string().nullable(),
  /** Rollback/clone source. */
  supersedesId: z.uuid().nullable(),
  createdAt: IsoDateTime,
  values: RateCardValuesViewSchema.nullable(),
};
export const RateCardSummarySchema = z.object(RateCardHeader).meta({ id: 'RateCardSummary' });
export const RateCardListSchema = z.object({ rateCards: z.array(RateCardSummarySchema) }).meta({ id: 'RateCardList' });
export const RateCardListQuerySchema = z.strictObject({ cityCode: CityCode.optional(), productCode: ProductCodeSchema.optional() });

const PreviewComponentSchema = z.object({ kind: QuoteComponentKindSchema, amount: MoneyAmountSchema, basis: QuoteComponentSchema.shape.basis });
export const PricingPreviewSchema = z
  .object({
    /** DEFAULT_SYNTHETIC_V1 = the code-defined synthetic benchmark tuples (no provider data); CUSTOM = the caller's tuples. */
    benchmarkSet: z.enum(['DEFAULT_SYNTHETIC_V1', 'CUSTOM']),
    cards: z.array(
      z.object({
        rateCardId: z.uuid(),
        cityCode: CityCode,
        productCode: ProductCodeSchema,
        version: z.number().int(),
        status: z.enum(PRICING_CONFIG_STATUSES),
      }),
    ),
    rows: z.array(
      z.object({
        label: z.string(),
        distanceM: z.number().int(),
        durationS: z.number().int(),
        airportPickup: z.boolean(),
        results: z.array(
          z.object({
            rateCardId: z.uuid(),
            outcome: z.enum(['PRICED', 'ROUTE_TOO_LONG']),
            total: MoneyAmountSchema.nullable(),
            components: z.array(PreviewComponentSchema),
            /** total minus the first card's total for the same tuple (null for the first card or when either is not priced). */
            deltaVsFirst: MoneyAmountSchema.nullable(),
          }),
        ),
      }),
    ),
  })
  .meta({ id: 'PricingPreview' });

export const RateCardSchema = z
  .object({
    ...RateCardHeader,
    taxPolicy: z
      .object({
        id: z.uuid(),
        code: z.string(),
        version: z.number().int(),
        status: z.string(),
        rateBp: z.number().int(),
        inclusive: z.boolean(),
        isPlaceholder: z.boolean(),
      })
      .nullable(),
    /** The ACTIVE card of the same (city, product) when it is another card. */
    activeCardId: z.uuid().nullable(),
    /** Fields whose value differs from the ACTIVE card (the approver's diff view). */
    diffVsActive: z.array(z.object({ field: z.string(), active: z.union([z.string(), z.number()]), proposed: z.union([z.string(), z.number()]) })),
    /** Sanity-envelope findings against the configured bounds and the ACTIVE card (codes only). */
    envelopeViolations: z.array(z.string()),
    /** The default synthetic benchmark preview recorded at submission (what the approver saw). */
    submissionPreview: PricingPreviewSchema.nullable(),
  })
  .meta({ id: 'RateCard' });
export const RateCardDraftRequestSchema = z
  .strictObject({
    cityCode: CityCode,
    productCode: ProductCodeSchema,
    /** Where the values come from (FA-15e); synthetic cards say so. */
    sourceReference: z.string().trim().min(3).max(300),
    isSynthetic: z.boolean().optional(),
    values: RateCardValuesSchema,
  })
  .meta({ id: 'RateCardDraftRequest' });
export const RateCardValuesRequestSchema = z.strictObject({ values: RateCardValuesSchema }).meta({ id: 'RateCardValuesRequest' });
export const RateCardSubmissionRequestSchema = z.strictObject({ envelopeOverrideReasonCode: ReasonCode.optional() }).meta({ id: 'RateCardSubmissionRequest' });
/** Activate now, or schedule for `effectiveFrom` (server time; never in the past). */
export const RateCardActivationRequestSchema = z
  .discriminatedUnion('when', [z.strictObject({ when: z.literal('NOW') }), z.strictObject({ when: z.literal('SCHEDULED'), effectiveFrom: IsoDateTime })])
  .meta({ id: 'RateCardActivationRequest' });

const BenchmarkTupleSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  distanceM: z.number().int().min(1).max(200000),
  durationS: z.number().int().min(0).max(21600),
  airportPickup: z.boolean(),
});
export const PricingPreviewRequestSchema = z
  .strictObject({
    rateCardIds: z.array(z.uuid()).min(1).max(3),
    /** Wayvro-derived numbers only (never raw provider responses); omitted = the default synthetic benchmark set. */
    tuples: z.array(BenchmarkTupleSchema).min(1).max(50).optional(),
  })
  .refine((v) => new Set(v.rateCardIds).size === v.rateCardIds.length, { message: 'rateCardIds must not repeat' })
  .meta({ id: 'PricingPreviewRequest' });

export const QuoteLookupRequestSchema = z
  .strictObject({ quoteId: z.uuid().optional(), quoteGroupId: z.uuid().optional(), reasonCode: z.enum(QUOTE_ACCESS_REASONS) })
  .refine((v) => (v.quoteId === undefined) !== (v.quoteGroupId === undefined), { message: 'exactly one of quoteId or quoteGroupId' })
  .meta({ id: 'QuoteLookupRequest' });
/** Support view of one quote group: districts, amounts, components and versions — never coordinates or a polyline. */
export const StaffQuoteViewSchema = z
  .object({
    quoteGroupId: z.uuid(),
    createdAt: IsoDateTime,
    cityCode: CityCode,
    pickupDistrictCode: z.string().nullable(),
    dropoffDistrictCode: z.string().nullable(),
    options: z.array(
      z.object({
        quoteId: z.uuid(),
        productCode: ProductCodeSchema,
        status: z.enum(['PRICED', 'EXPIRED', 'SUPERSEDED']),
        total: MoneyAmountSchema,
        components: z.array(PreviewComponentSchema),
        taxIncluded: z.object({ rateBp: z.number().int(), amount: MoneyAmountSchema }).nullable(),
        tollPolicy: TollPolicySchema,
        rateCardId: z.uuid(),
        rateCardVersion: z.number().int(),
        pricingEngineVersion: z.string(),
        expiresAt: IsoDateTime,
        isSynthetic: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'StaffQuoteView' });

/** POST `/v1/admin/pricing/<resource>/{id}/<action>` returning the resource (200). */
function actionRoute<const O extends string, const P extends `/v1/admin/pricing/${string}`>(
  operationId: O,
  path: P,
  summary: string,
  request: z.ZodType,
  schema: z.ZodType,
) {
  return {
    operationId,
    method: 'POST',
    path,
    summary,
    auth: 'staff',
    params: IdParam,
    request,
    responses: { 200: schema, 400: E, 401: E, 403: E, 404: E, 409: E },
  } as const satisfies RouteContract;
}

export const PRICING_ADMIN_ROUTES = [
  {
    operationId: 'listTaxPolicies',
    method: 'GET',
    path: '/v1/admin/pricing/tax-policies',
    summary: 'Tax policy versions (newest first).',
    auth: 'staff',
    responses: { 200: TaxPolicyListSchema, 401: E, 403: E },
  },
  {
    operationId: 'getTaxPolicy',
    method: 'GET',
    path: '/v1/admin/pricing/tax-policies/{id}',
    summary: 'One tax policy version.',
    auth: 'staff',
    params: IdParam,
    responses: { 200: TaxPolicySchema, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'draftTaxPolicy',
    method: 'POST',
    path: '/v1/admin/pricing/tax-policies',
    summary: 'Draft a new tax policy version (complete at creation; a placeholder unless a legal reference is given).',
    auth: 'staff',
    request: TaxPolicyDraftRequestSchema,
    responses: { 201: TaxPolicySchema, 400: E, 401: E, 403: E, 409: E },
  },
  actionRoute(
    'submitTaxPolicy',
    '/v1/admin/pricing/tax-policies/{id}/submission',
    'The drafter submits a DRAFT tax policy for approval.',
    EmptyBody,
    TaxPolicySchema,
  ),
  actionRoute(
    'decideTaxPolicy',
    '/v1/admin/pricing/tax-policies/{id}/approval',
    'A DIFFERENT pricing manager approves or rejects a pending tax policy (maker-checker; step-up).',
    PricingDecisionRequestSchema,
    TaxPolicySchema,
  ),
  actionRoute(
    'retireTaxPolicy',
    '/v1/admin/pricing/tax-policies/{id}/retirement',
    'Retire an APPROVED tax policy (refused while an ACTIVE rate card references it; step-up).',
    EmptyBody,
    TaxPolicySchema,
  ),
  {
    operationId: 'listRateCards',
    method: 'GET',
    path: '/v1/admin/pricing/rate-cards',
    summary: 'Rate-card versions (newest first), optionally of one city and/or product.',
    auth: 'staff',
    query: RateCardListQuerySchema,
    responses: { 200: RateCardListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'getRateCard',
    method: 'GET',
    path: '/v1/admin/pricing/rate-cards/{id}',
    summary: 'One rate card with its values, tax policy, diff against the ACTIVE card, envelope findings and submission preview.',
    auth: 'staff',
    params: IdParam,
    responses: { 200: RateCardSchema, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'draftRateCard',
    method: 'POST',
    path: '/v1/admin/pricing/rate-cards',
    summary: 'Draft a new rate-card version with every component value.',
    auth: 'staff',
    request: RateCardDraftRequestSchema,
    responses: { 201: RateCardSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  actionRoute(
    'replaceRateCardValues',
    '/v1/admin/pricing/rate-cards/{id}/values',
    'The drafter replaces the component values of a DRAFT card (immutable after submission).',
    RateCardValuesRequestSchema,
    RateCardSchema,
  ),
  {
    operationId: 'cloneRateCard',
    method: 'POST',
    path: '/v1/admin/pricing/rate-cards/{id}/clones',
    summary: 'New DRAFT version copied from an existing card (edit, then submit).',
    auth: 'staff',
    params: IdParam,
    request: EmptyBody,
    responses: { 201: RateCardSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  actionRoute(
    'submitRateCard',
    '/v1/admin/pricing/rate-cards/{id}/submission',
    'The drafter submits a DRAFT card (APPROVED tax policy required; values frozen; the default preview is recorded; values outside the sanity envelope need an override reason).',
    RateCardSubmissionRequestSchema,
    RateCardSchema,
  ),
  actionRoute(
    'decideRateCard',
    '/v1/admin/pricing/rate-cards/{id}/approval',
    'A DIFFERENT pricing manager approves (approval reason required) or rejects a pending card (step-up).',
    PricingDecisionRequestSchema,
    RateCardSchema,
  ),
  actionRoute(
    'activateRateCard',
    '/v1/admin/pricing/rate-cards/{id}/activation',
    'Activate an APPROVED card now (retiring the previous ACTIVE one) or schedule it on server time; production refuses synthetic cards and placeholder tax policies (step-up).',
    RateCardActivationRequestSchema,
    RateCardSchema,
  ),
  actionRoute(
    'cancelRateCardSchedule',
    '/v1/admin/pricing/rate-cards/{id}/schedule-cancellation',
    'Cancel the scheduled activation of an APPROVED card (step-up).',
    EmptyBody,
    RateCardSchema,
  ),
  {
    operationId: 'rollbackRateCard',
    method: 'POST',
    path: '/v1/admin/pricing/rate-cards/{id}/rollbacks',
    summary: 'Request a rollback: a NEW version cloned from an earlier APPROVED or RETIRED card, submitted for maker-checker approval (step-up).',
    auth: 'staff',
    params: IdParam,
    request: EmptyBody,
    responses: { 201: RateCardSchema, 400: E, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'previewPricing',
    method: 'POST',
    path: '/v1/admin/pricing/previews',
    summary: 'Price up to 50 numeric benchmark tuples with up to 3 cards (no provider call, no quote row; audited).',
    auth: 'staff',
    request: PricingPreviewRequestSchema,
    responses: { 200: PricingPreviewSchema, 400: E, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'lookupQuote',
    method: 'POST',
    path: '/v1/admin/pricing/quote-lookups',
    summary: 'Support view of one quote group by quote or group id, with a recorded reason (districts and amounts only; audited).',
    auth: 'staff',
    request: QuoteLookupRequestSchema,
    responses: { 200: StaffQuoteViewSchema, 400: E, 401: E, 403: E, 404: E },
  },
] as const satisfies readonly RouteContract[];
