import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  ErrorEnvelopeSchema,
  IdempotencyKeySchema,
  LivenessSchema,
  RealtimeEventEnvelopeSchema,
  ReadinessSchema,
  RequestIdSchema,
  SessionHelloSchema,
  buildOpenApiDocument,
} from './index.js';

describe('health contract', () => {
  it('accepts valid bodies and rejects drift', () => {
    expect(LivenessSchema.safeParse({ status: 'ok', service: 'api', version: 'dev', serverTime: new Date().toISOString() }).success).toBe(true);
    expect(LivenessSchema.safeParse({ status: 'up', service: 'api', version: 'dev', serverTime: 'yesterday' }).success).toBe(false);
    expect(ReadinessSchema.safeParse({ status: 'not_ready', checks: { database: 'fail', redis: 'ok' } }).success).toBe(true);
    expect(ReadinessSchema.safeParse({ status: 'ready', checks: { database: 'degraded' } }).success).toBe(false);
  });
});

describe('error envelope', () => {
  it('only allows registered codes', () => {
    expect(ErrorEnvelopeSchema.safeParse({ error: { code: 'WAYVRO_E_NOT_FOUND', message: 'Not found', requestId: 'req-12345678' } }).success).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse({ error: { code: 'E_RANDOM', message: 'x', requestId: 'r' } }).success).toBe(false);
  });
});

describe('header shapes', () => {
  it('validates request ids and idempotency keys', () => {
    expect(RequestIdSchema.safeParse('01J9ZK3A7Q2M').success).toBe(true);
    expect(RequestIdSchema.safeParse('bad id with spaces').success).toBe(false);
    expect(RequestIdSchema.safeParse('x'.repeat(65)).success).toBe(false);
    expect(IdempotencyKeySchema.safeParse('7b0c2f1e-5d8a-4c1b-9e7d-3a2b1c0d9e8f').success).toBe(true);
    expect(IdempotencyKeySchema.safeParse('short').success).toBe(false);
  });
});

describe('realtime recovery contract', () => {
  it('describes the hello and versioned event envelopes', () => {
    expect(
      SessionHelloSchema.safeParse({ type: 'session.hello', protocolVersion: 1, serverTime: new Date().toISOString(), resync: 'fetch-snapshot' }).success,
    ).toBe(true);
    expect(
      RealtimeEventEnvelopeSchema.safeParse({
        type: 'platform.heartbeat.v1',
        aggregate: { kind: 'session', id: 's1' },
        version: 3,
        emittedAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
    expect(RealtimeEventEnvelopeSchema.safeParse({ type: 'NoVersion', aggregate: { kind: 'x', id: '1' }, version: -1, emittedAt: 'now' }).success).toBe(false);
  });
});

describe('OpenAPI generation', () => {
  it('emits every registered route with its response schemas', () => {
    const doc = buildOpenApiDocument('1.0.0') as {
      openapi: string;
      paths: Record<string, Record<string, { operationId: string; responses: Record<string, unknown> }>>;
    };
    expect(doc.openapi).toBe('3.1.0');
    for (const route of API_ROUTES) {
      const op = doc.paths[route.path]?.[route.method.toLowerCase()];
      expect(op?.operationId).toBe(route.operationId);
      expect(Object.keys(op?.responses ?? {}).sort()).toEqual(Object.keys(route.responses).sort());
    }
  });

  it('requires an Idempotency-Key on mutating routes and merges methods on one path', () => {
    const doc = buildOpenApiDocument('1.0.0', [
      ...API_ROUTES,
      {
        operationId: 'postProbe',
        method: 'POST',
        path: '/v1/health/live',
        summary: 'test-only route',
        responses: { 201: LivenessSchema, 400: ErrorEnvelopeSchema },
      },
    ]) as {
      paths: Record<string, Record<string, { parameters: Array<{ name: string; required: boolean }>; responses: Record<string, { description: string }> }>>;
    };
    const path = doc.paths['/v1/health/live'];
    expect(Object.keys(path ?? {}).sort()).toEqual(['get', 'post']);
    expect(path?.['post']?.parameters).toContainEqual(expect.objectContaining({ name: 'idempotency-key', required: true }));
    expect(path?.['get']?.parameters.some((p) => p.name === 'idempotency-key')).toBe(false);
    expect(path?.['post']?.responses['400']?.description).toBe('Error');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildOpenApiDocument('1.0.0'))).toBe(JSON.stringify(buildOpenApiDocument('1.0.0')));
  });
});
