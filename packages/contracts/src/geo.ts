/**
 * Phase 3 geo contracts (P3.2; B01/B02/E06/E07/I11; docs/phase3/PHASE3_ARCHITECTURE.md §5–§8). All geo reads need a
 * consumer session (no pre-sign-in geo access), are rate-limited and budgeted server-side and carry Wayvro-normalised
 * provenance (`GeoSource`) — never a vendor name, a provider place id or any provider-specific field. Provider ids are
 * sealed into opaque, account-bound, expiring `placeRef` tokens. A provider failure is refused honestly
 * (503 `WAYVRO_E_DEPENDENCY_UNAVAILABLE` with reason codes); no address, place or coordinate is ever invented.
 *
 * Search text and coordinates travel in the query string of these GET routes: the API logs route templates only, OTel
 * drops `url.query` for `/v1/geo/*`, and deployment access logs must omit query strings for `/v1/geo/*` (ARCH-01).
 */
import { z } from 'zod';
import { DecisionRequestSchema } from './compliance-admin.js';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';
import { LocaleSchema } from './identity.js';
import { EmptyRequestSchema, IdParamSchema } from './staff.js';

const E = ErrorEnvelopeSchema;
const IsoDateTime = z.iso.datetime({ offset: true });
const CityCode = z.string().regex(/^[A-Z]{3}$/);

export const GEO_SKUS = ['AUTOCOMPLETE', 'GEOCODE', 'REVERSE_GEOCODE', 'PLACE_RESOLVE', 'ROUTE'] as const;
export const GeoSkuSchema = z.enum(GEO_SKUS);
export const GEO_CONFIDENCE_VALUES = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export const GeoConfidenceSchema = z.enum(GEO_CONFIDENCE_VALUES);
/** Opaque provider key (e.g. `geo-a`); the mapping to a vendor exists only in server configuration / ADR-006. */
export const ProviderKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);

/** Wayvro-normalised provenance of a geo result (B03: the client shows confidence and required attribution). */
export const GeoSourceSchema = z
  .object({
    providerKey: ProviderKeySchema,
    /** Server time of the provider call (or of the cached call). */
    fetchedAt: IsoDateTime,
    cacheStatus: z.enum(['HIT', 'MISS', 'STALE_SERVED']),
    confidence: GeoConfidenceSchema,
    /** Licence attribution the client must display, as a code (e.g. `OSM_ODBL`); null = none required. */
    attributionCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,40}$/)
      .nullable(),
    /** e.g. `PARTIAL_COVERAGE`, `LOW_DENSITY_AREA`; null = none. */
    coverageNote: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,40}$/)
      .nullable(),
  })
  .meta({ id: 'GeoSource' });
export type GeoSource = z.infer<typeof GeoSourceSchema>;

/** Sealed, account-bound, expiring reference to a provider place (never a raw provider id). */
export const PlaceRefSchema = z.string().regex(/^pr1\.[A-Za-z0-9_-]{40,512}$/);

/** WGS84 point as sent by clients; the server normalises to 6 decimals and refuses points outside Pakistan (400). */
export const LatLngSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

const Lat = z.coerce.number().min(-90).max(90);
const Lng = z.coerce.number().min(-180).max(180);
/** Per search field; maps to a provider session token where the provider bills per session. */
const SearchSessionId = z.uuid();
const PlaceKind = z.enum(['LANDMARK', 'ADDRESS', 'AREA', 'OTHER']);
const DisplayText = z.string().min(1).max(200);

export const AutocompleteQuerySchema = z.strictObject({
  cityCode: CityCode,
  q: z.string().trim().min(3).max(80),
  locale: LocaleSchema,
  session: SearchSessionId,
  /** Optional bias; the server coarsens it to 2 decimals (~1.1 km cell) before any provider call or cache key. */
  biasLat: Lat.optional(),
  biasLng: Lng.optional(),
  /** `GEOCODE`: "type the full address" forward geocoding when suggestions are degraded (separate SKU meter). */
  mode: z.enum(['SUGGEST', 'GEOCODE']).optional(),
});
export type AutocompleteQuery = z.infer<typeof AutocompleteQuerySchema>;

export const AutocompleteResultSchema = z
  .object({
    suggestions: z.array(z.object({ placeRef: PlaceRefSchema, primaryText: DisplayText, secondaryText: DisplayText.nullable(), kind: PlaceKind })).max(5),
    source: GeoSourceSchema,
  })
  .meta({ id: 'AutocompleteResult' });
export type AutocompleteResult = z.infer<typeof AutocompleteResultSchema>;

export const PlaceRefParamSchema = z.strictObject({ placeRef: PlaceRefSchema });
export const PlaceQuerySchema = z.strictObject({ session: SearchSessionId, locale: LocaleSchema });

export const ResolvedPlaceSchema = z
  .object({
    point: z.object({ lat: z.number(), lng: z.number() }),
    primaryText: DisplayText,
    secondaryText: DisplayText.nullable(),
    /** Only when district geometry exists (none in Phase 3: synthetic boundaries only, FA-12). */
    districtCode: z.string().nullable(),
    /** Server-side check against the city's ACTIVE zone set (information only; quotes re-check). */
    inServiceArea: z.boolean(),
    source: GeoSourceSchema,
  })
  .meta({ id: 'ResolvedPlace' });
export type ResolvedPlace = z.infer<typeof ResolvedPlaceSchema>;

export const ReverseGeocodeQuerySchema = z.strictObject({ cityCode: CityCode, lat: Lat, lng: Lng, locale: LocaleSchema });

export const ReverseGeocodeResultSchema = z
  .object({
    /** null when the provider knows no address here — the client shows "Pinned location"; never an invented label. */
    address: z
      .object({
        primaryText: DisplayText,
        secondaryText: DisplayText.nullable(),
        landmarkText: DisplayText.nullable(),
      })
      .nullable(),
    inServiceArea: z.boolean(),
    source: GeoSourceSchema,
  })
  .meta({ id: 'ReverseGeocodeResult' });
export type ReverseGeocodeResult = z.infer<typeof ReverseGeocodeResultSchema>;

export const GEO_ROUTES = [
  {
    operationId: 'geoAutocomplete',
    method: 'GET',
    path: '/v1/geo/autocomplete',
    summary: 'Place suggestions (max 5) for a search field; `mode=GEOCODE` forward-geocodes typed text. Session, rate limits and budgets apply.',
    auth: 'session',
    query: AutocompleteQuerySchema,
    responses: { 200: AutocompleteResultSchema, 400: E, 401: E, 403: E, 404: E, 426: E, 429: E, 503: E },
  },
  {
    operationId: 'geoResolvePlace',
    method: 'GET',
    path: '/v1/geo/places/{placeRef}',
    summary: 'Resolve a sealed placeRef of the calling account to a point and display text (invalid/foreign/expired refs answer 400).',
    auth: 'session',
    params: PlaceRefParamSchema,
    query: PlaceQuerySchema,
    responses: { 200: ResolvedPlaceSchema, 400: E, 401: E, 403: E, 404: E, 426: E, 429: E, 503: E },
  },
  {
    operationId: 'geoReverse',
    method: 'GET',
    path: '/v1/geo/reverse',
    summary: 'Address for a pinned point (server rounds to 4 decimals before any provider call or cache key).',
    auth: 'session',
    query: ReverseGeocodeQuerySchema,
    responses: { 200: ReverseGeocodeResultSchema, 400: E, 401: E, 403: E, 404: E, 426: E, 429: E, 503: E },
  },
] as const satisfies readonly RouteContract[];

// ── staff (web-ops BFF only): provider budgets, hourly usage, landmark aliases ────────────────────────────────────
// Budgets are maker-checker (a different staff member approves) except a DECREASE of the ACTIVE budget, which one
// authorised staff member may approve with step-up (the safe direction; the database proves the decrease). Aliases are
// Wayvro-curated search spellings (never provider data) that become ACTIVE only through a different approver.

export const GEO_BUDGET_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED'] as const;
export const GEO_BUDGET_THRESHOLDS = [10, 25, 50, 75, 80, 90, 100] as const;

export const GeoBudgetSchema = z
  .object({
    id: z.uuid(),
    providerKey: ProviderKeySchema,
    sku: GeoSkuSchema,
    version: z.number().int().positive(),
    status: z.enum(GEO_BUDGET_STATUSES),
    dailyCalls: z.number().int().nonnegative(),
    monthlyCalls: z.number().int().nonnegative(),
    monthlyCostMicroUsd: z.number().int().nonnegative(),
    alertThresholdsPct: z.array(z.number().int()),
    /** Computed by the server against the ACTIVE budget at draft time. */
    changeKind: z.enum(['INITIAL', 'INCREASE', 'DECREASE']),
    draftedByStaffId: z.uuid(),
    approvedByStaffId: z.uuid().nullable(),
    effectiveFrom: IsoDateTime.nullable(),
    effectiveUntil: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'GeoBudget' });
export type GeoBudget = z.infer<typeof GeoBudgetSchema>;
export const GeoBudgetListSchema = z.object({ budgets: z.array(GeoBudgetSchema) }).meta({ id: 'GeoBudgetList' });
export const GeoBudgetQuerySchema = z.strictObject({ providerKey: ProviderKeySchema.optional(), sku: GeoSkuSchema.optional() });

export const GeoBudgetDraftRequestSchema = z
  .strictObject({
    providerKey: ProviderKeySchema,
    sku: GeoSkuSchema,
    dailyCalls: z.number().int().min(0).max(10_000_000),
    monthlyCalls: z.number().int().min(0).max(300_000_000),
    monthlyCostMicroUsd: z.number().int().min(0).max(100_000_000_000),
    alertThresholdsPct: z.array(z.literal(GEO_BUDGET_THRESHOLDS)).min(1).max(7).optional(),
  })
  .refine((b) => b.dailyCalls <= b.monthlyCalls, { message: 'dailyCalls must not exceed monthlyCalls', path: ['dailyCalls'] })
  .meta({ id: 'GeoBudgetDraftRequest' });
export type GeoBudgetDraftRequest = z.infer<typeof GeoBudgetDraftRequestSchema>;

export const GeoUsageQuerySchema = z.strictObject({
  from: IsoDateTime,
  to: IsoDateTime,
  providerKey: ProviderKeySchema.optional(),
  sku: GeoSkuSchema.optional(),
});
export const GeoUsageSchema = z
  .object({
    hours: z.array(
      z.object({
        providerKey: ProviderKeySchema,
        sku: GeoSkuSchema,
        hourBucket: IsoDateTime,
        calls: z.number().int().nonnegative(),
        cacheHits: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
        timeouts: z.number().int().nonnegative(),
        budgetRefusals: z.number().int().nonnegative(),
        estCostMicroUsd: z.number().int().nonnegative(),
      }),
    ),
  })
  .meta({ id: 'GeoUsage' });
export type GeoUsage = z.infer<typeof GeoUsageSchema>;

const ALIAS_STATUSES = ['PROPOSED', 'ACTIVE', 'RETIRED'] as const;
export const LandmarkAliasSchema = z
  .object({
    id: z.uuid(),
    cityCode: CityCode,
    locale: LocaleSchema,
    aliasDisplay: z.string(),
    aliasNormalised: z.string(),
    canonicalQuery: z.string(),
    source: z.enum(['FOUNDER', 'FIELD']),
    status: z.enum(ALIAS_STATUSES),
    createdByStaffId: z.uuid(),
    approvedByStaffId: z.uuid().nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'LandmarkAlias' });
export type LandmarkAlias = z.infer<typeof LandmarkAliasSchema>;
export const LandmarkAliasListSchema = z.object({ aliases: z.array(LandmarkAliasSchema) }).meta({ id: 'LandmarkAliasList' });
export const LandmarkAliasQuerySchema = z.strictObject({ cityCode: CityCode.optional(), status: z.enum(ALIAS_STATUSES).optional() });
export const LandmarkAliasDraftRequestSchema = z
  .strictObject({
    cityCode: CityCode,
    locale: LocaleSchema,
    /** As typed by riders (e.g. a Roman-Urdu spelling); normalised by the server like every search query. */
    alias: z.string().trim().min(2).max(80),
    /** What the alias expands to before the provider call (Wayvro-curated text, never provider data). */
    canonicalQuery: z.string().trim().min(2).max(120),
    source: z.enum(['FOUNDER', 'FIELD']),
  })
  .meta({ id: 'LandmarkAliasDraftRequest' });

export const GEO_ADMIN_ROUTES = [
  {
    operationId: 'listGeoBudgets',
    method: 'GET',
    path: '/v1/admin/geo/budgets',
    summary: 'Provider budgets (every version, newest first; optional provider/SKU filter).',
    auth: 'staff',
    query: GeoBudgetQuerySchema,
    responses: { 200: GeoBudgetListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'draftGeoBudget',
    method: 'POST',
    path: '/v1/admin/geo/budgets',
    summary: 'Draft a budget version (INITIAL / INCREASE / DECREASE is computed against the ACTIVE budget).',
    auth: 'staff',
    request: GeoBudgetDraftRequestSchema,
    responses: { 201: GeoBudgetSchema, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'submitGeoBudget',
    method: 'POST',
    path: '/v1/admin/geo/budgets/{id}/submission',
    summary: 'Submit a draft budget for approval.',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 200: GeoBudgetSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'decideGeoBudget',
    method: 'POST',
    path: '/v1/admin/geo/budgets/{id}/approval',
    summary: 'Approve or reject a pending budget (a different staff member; a DECREASE may be approved by its drafter).',
    auth: 'staff',
    params: IdParamSchema,
    request: DecisionRequestSchema,
    responses: { 200: GeoBudgetSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'activateGeoBudget',
    method: 'POST',
    path: '/v1/admin/geo/budgets/{id}/activation',
    summary: 'Activate an approved budget (retires the previous ACTIVE one of the same provider/SKU).',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 200: GeoBudgetSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'retireGeoBudget',
    method: 'POST',
    path: '/v1/admin/geo/budgets/{id}/retirement',
    summary: 'Retire an approved or active budget (staging/production then refuse that SKU until a new one is active).',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 200: GeoBudgetSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'getGeoUsage',
    method: 'GET',
    path: '/v1/admin/geo/usage',
    summary: 'Hourly provider usage rollups (aggregates only; at most 31 days per request).',
    auth: 'staff',
    query: GeoUsageQuerySchema,
    responses: { 200: GeoUsageSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'listLandmarkAliases',
    method: 'GET',
    path: '/v1/admin/geo/landmark-aliases',
    summary: 'Landmark aliases (optional city/status filter).',
    auth: 'staff',
    query: LandmarkAliasQuerySchema,
    responses: { 200: LandmarkAliasListSchema, 400: E, 401: E, 403: E },
  },
  {
    operationId: 'draftLandmarkAlias',
    method: 'POST',
    path: '/v1/admin/geo/landmark-aliases',
    summary: 'Propose a landmark alias (Wayvro-curated spelling expanded to a canonical query).',
    auth: 'staff',
    request: LandmarkAliasDraftRequestSchema,
    responses: { 201: LandmarkAliasSchema, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'decideLandmarkAlias',
    method: 'POST',
    path: '/v1/admin/geo/landmark-aliases/{id}/approval',
    summary: 'A different staff member approves (ACTIVE) or rejects (RETIRED) a proposed alias.',
    auth: 'staff',
    params: IdParamSchema,
    request: DecisionRequestSchema,
    responses: { 200: LandmarkAliasSchema, 401: E, 403: E, 404: E, 409: E },
  },
  {
    operationId: 'retireLandmarkAlias',
    method: 'POST',
    path: '/v1/admin/geo/landmark-aliases/{id}/retirement',
    summary: 'Retire an alias (it stops expanding searches within the alias cache lifetime).',
    auth: 'staff',
    params: IdParamSchema,
    request: EmptyRequestSchema,
    responses: { 200: LandmarkAliasSchema, 401: E, 403: E, 404: E, 409: E },
  },
] as const satisfies readonly RouteContract[];
