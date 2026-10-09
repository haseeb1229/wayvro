import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKeySchema, MUTATING_METHODS, REQUEST_ID_HEADER, RequestIdSchema } from './headers.js';
import { HEALTH_ROUTES, type RouteContract } from './health.js';

export const API_ROUTES: readonly RouteContract[] = [...HEALTH_ROUTES];

type JsonObject = Record<string, unknown>;

/** Builds the OpenAPI 3.1 document from the Zod route registry (the registry, not this file, is the source of truth). */
export function buildOpenApiDocument(version: string, routes: readonly RouteContract[] = API_ROUTES): JsonObject {
  const paths: Record<string, JsonObject> = {};
  for (const route of routes) {
    const responses: JsonObject = {};
    for (const [status, schema] of Object.entries(route.responses)) {
      responses[status] = {
        description: Number(status) < 400 ? 'Success' : 'Error',
        headers: { [REQUEST_ID_HEADER]: { schema: z.toJSONSchema(RequestIdSchema) } },
        content: { 'application/json': { schema: z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw' }) } },
      };
    }
    const parameters: JsonObject[] = [{ name: REQUEST_ID_HEADER, in: 'header', required: false, schema: z.toJSONSchema(RequestIdSchema) }];
    if ((MUTATING_METHODS as readonly string[]).includes(route.method)) {
      parameters.push({ name: IDEMPOTENCY_KEY_HEADER, in: 'header', required: true, schema: z.toJSONSchema(IdempotencyKeySchema) });
    }
    paths[route.path] = {
      ...paths[route.path],
      [route.method.toLowerCase()]: { operationId: route.operationId, summary: route.summary, parameters, responses },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Wayvro API', version, description: 'Generated from packages/contracts. Do not edit by hand.' },
    paths,
    components: { schemas: { ErrorEnvelope: z.toJSONSchema(ErrorEnvelopeSchema) } },
  };
}
