import { z } from 'zod';
import { ErrorCodeSchema, ErrorEnvelopeSchema } from './errors.js';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKeySchema, MUTATING_METHODS, REQUEST_ID_HEADER, RequestIdSchema } from './headers.js';
import { HEALTH_ROUTES, type RouteContract } from './health.js';
import { ACCOUNT_SECURITY_ROUTES } from './account-security.js';
import { APP_CONFIG_ROUTES } from './app-config.js';
import { CATALOG_ROUTES } from './catalog.js';
import { COMPLIANCE_ADMIN_ROUTES } from './compliance-admin.js';
import { ONBOARDING_ROUTES } from './compliance.js';
import { EVIDENCE_ROUTES } from './evidence.js';
import { GEO_ROUTES } from './geo.js';
import { REVIEW_ROUTES } from './review.js';
import { LEGAL_ROUTES } from './legal.js';
import { OIDC_ROUTES } from './oidc.js';
import { QUOTE_ROUTES } from './pricing.js';
import { IDENTITY_ROUTES } from './routes.js';
import { STAFF_ROUTES, StaffRoleSchema } from './staff.js';
import { SUPPORT_ROUTES } from './support.js';

export const API_ROUTES: readonly RouteContract[] = [
  ...HEALTH_ROUTES,
  ...IDENTITY_ROUTES,
  ...ACCOUNT_SECURITY_ROUTES,
  ...OIDC_ROUTES,
  ...LEGAL_ROUTES,
  ...STAFF_ROUTES,
  ...ONBOARDING_ROUTES,
  ...COMPLIANCE_ADMIN_ROUTES,
  ...EVIDENCE_ROUTES,
  ...REVIEW_ROUTES,
  ...SUPPORT_ROUTES,
  // Phase 3
  ...APP_CONFIG_ROUTES,
  ...CATALOG_ROUTES,
  ...GEO_ROUTES,
  ...QUOTE_ROUTES,
];

const SECURITY: Readonly<Record<RouteContract['auth'], readonly JsonObject[]>> = { public: [], session: [{ sessionBearer: [] }], staff: [{ staffBearer: [] }] };

type JsonObject = Record<string, unknown>;

/**
 * Enums that are EXTENSIBLE vocabularies by contract are documented as `x-extensible-enum` instead of a closed `enum`,
 * so that the oasdiff gate (F-P3-09) treats a new value as the additive change it is. Every other enum stays closed and
 * still fails the gate when a value is added to a response. Applied to RESPONSE schemas only — request enums stay closed
 * because the server validates them strictly. This list is reviewed like any contract change:
 *  - error codes (errors.ts): new codes are additive and every client falls back to the HTTP status for an unknown code;
 *  - staff roles (staff.ts): code-defined roles grow additively (H01); the only consumer is web-ops, deployed from the
 *    same commit as the API, which renders role codes as text.
 */
const EXTENSIBLE_ENUMS: ReadonlySet<unknown> = new Set<unknown>([ErrorCodeSchema, StaffRoleSchema]);
const markExtensibleEnums = (ctx: { zodSchema: unknown; jsonSchema: JsonObject }): void => {
  if (!EXTENSIBLE_ENUMS.has(ctx.zodSchema)) return;
  const { enum: values, ...rest } = ctx.jsonSchema;
  for (const key of Object.keys(ctx.jsonSchema)) Reflect.deleteProperty(ctx.jsonSchema, key);
  Object.assign(ctx.jsonSchema, rest, { 'x-extensible-enum': values });
};

const jsonSchema = (schema: z.ZodType, io: 'input' | 'output'): JsonObject =>
  // responses only: request enums stay closed (the server validates them strictly)
  z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw', io, ...(io === 'output' ? { override: markExtensibleEnums } : {}) });

const binaryContent = (mediaTypes: readonly string[] | undefined): JsonObject =>
  mediaTypes ? { content: Object.fromEntries(mediaTypes.map((m) => [m, { schema: { type: 'string', contentMediaType: m } }])) } : {};

/** Builds the OpenAPI 3.1 document from the Zod route registry (the registry, not this file, is the source of truth). */
export function buildOpenApiDocument(version: string, routes: readonly RouteContract[] = API_ROUTES): JsonObject {
  const paths: Record<string, JsonObject> = {};
  for (const route of routes) {
    const responses: JsonObject = {};
    for (const [status, schema] of Object.entries(route.responses)) {
      responses[status] = {
        description: Number(status) < 400 ? 'Success' : 'Error',
        headers: { [REQUEST_ID_HEADER]: { schema: z.toJSONSchema(RequestIdSchema) } },
        ...(schema ? { content: { 'application/json': { schema: jsonSchema(schema, 'output') } } } : {}),
        ...binaryContent(route.binaryResponses?.[Number(status)]),
      };
    }
    const parameters: JsonObject[] = [{ name: REQUEST_ID_HEADER, in: 'header', required: false, schema: z.toJSONSchema(RequestIdSchema) }];
    if ((MUTATING_METHODS as readonly string[]).includes(route.method)) {
      parameters.push({ name: IDEMPOTENCY_KEY_HEADER, in: 'header', required: true, schema: z.toJSONSchema(IdempotencyKeySchema) });
    }
    if (route.params) {
      for (const [name, schema] of Object.entries(route.params.shape)) {
        parameters.push({ name, in: 'path', required: true, schema: jsonSchema(schema as z.ZodType, 'input') });
      }
    }
    if (route.query) {
      for (const [name, schema] of Object.entries(route.query.shape)) {
        const field = schema as z.ZodType;
        parameters.push({ name, in: 'query', required: !field.safeParse(undefined).success, schema: jsonSchema(field, 'input') });
      }
    }
    paths[route.path] = {
      ...paths[route.path],
      [route.method.toLowerCase()]: {
        operationId: route.operationId,
        summary: route.summary,
        security: SECURITY[route.auth],
        parameters,
        ...(route.request ? { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(route.request, 'input') } } } } : {}),
        responses,
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Wayvro API', version, description: 'Generated from packages/contracts. Do not edit by hand.' },
    paths,
    components: {
      schemas: { ErrorEnvelope: z.toJSONSchema(ErrorEnvelopeSchema, { override: markExtensibleEnums }) },
      securitySchemes: {
        sessionBearer: { type: 'http', scheme: 'bearer', description: 'Opaque consumer access token (15-minute default lifetime; not a JWT).' },
        staffBearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'Opaque staff session token held by the web-ops BFF (never by browser JavaScript); separate realm.',
        },
      },
    },
  };
}
