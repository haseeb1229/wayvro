import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';

/** The single Phase 1 HTTP contract: service health (liveness + readiness). */
export const LivenessSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string().min(1),
    version: z.string().min(1),
    serverTime: z.iso.datetime(),
  })
  .meta({ id: 'Liveness' });
export type Liveness = z.infer<typeof LivenessSchema>;

const DependencyStatusSchema = z.enum(['ok', 'fail']);
export const ReadinessSchema = z
  .object({
    status: z.enum(['ready', 'not_ready']),
    checks: z.record(z.string(), DependencyStatusSchema),
  })
  .meta({ id: 'Readiness' });
export type Readiness = z.infer<typeof ReadinessSchema>;

export interface RouteContract {
  readonly operationId: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: `/v1/${string}`;
  readonly summary: string;
  readonly responses: Readonly<Record<number, z.ZodType>>;
}

export const HEALTH_ROUTES = [
  {
    operationId: 'getLiveness',
    method: 'GET',
    path: '/v1/health/live',
    summary: 'Process is running (no dependency checks).',
    responses: { 200: LivenessSchema, 500: ErrorEnvelopeSchema },
  },
  {
    operationId: 'getReadiness',
    method: 'GET',
    path: '/v1/health/ready',
    summary: 'Process can serve traffic: required dependencies respond.',
    responses: { 200: ReadinessSchema, 503: ReadinessSchema },
  },
] as const satisfies readonly RouteContract[];
