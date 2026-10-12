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
