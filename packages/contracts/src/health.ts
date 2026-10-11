import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';

/** Service health (liveness + readiness). */
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
  /** OpenAPI-style path; parameters as `{name}`. */
  readonly path: `/v1/${string}`;
  readonly summary: string;
  /**
   * `public`: no credential; `session`: `Authorization: Bearer <access token>` of an active consumer session;
   * `staff`: `Authorization: Bearer <staff session token>` forwarded by the web-ops BFF (separate realm).
   */
  readonly auth: 'public' | 'session' | 'staff';
  readonly request?: z.ZodType;
  readonly params?: z.ZodObject;
  /** Query-string parameters (all optional unless the schema says otherwise). */
  readonly query?: z.ZodObject;
  /** Response schema per status; `null` means the status has no body (204) or a binary body (`binaryResponses`). */
  readonly responses: Readonly<Record<number, z.ZodType | null>>;
  /** Statuses whose body is binary, with the possible media types (e.g. a streamed evidence image). */
  readonly binaryResponses?: Readonly<Record<number, readonly string[]>>;
}

export const HEALTH_ROUTES = [
  {
    operationId: 'getLiveness',
    method: 'GET',
    path: '/v1/health/live',
    summary: 'Process is running (no dependency checks).',
    auth: 'public',
    responses: { 200: LivenessSchema, 500: ErrorEnvelopeSchema },
  },
  {
    operationId: 'getReadiness',
    method: 'GET',
    path: '/v1/health/ready',
    summary: 'Process can serve traffic: required dependencies respond.',
    auth: 'public',
    responses: { 200: ReadinessSchema, 503: ReadinessSchema },
  },
] as const satisfies readonly RouteContract[];
