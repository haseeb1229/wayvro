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
] as const satisfies readonly RouteContract[];
