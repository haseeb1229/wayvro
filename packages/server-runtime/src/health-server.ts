/**
 * Minimal health HTTP server for processes without an HTTP framework (the worker). Serves the same contract as the
 * API: `/v1/health/live` and `/v1/health/ready`; everything else is 404 with the standard error envelope.
 */
import { createServer, type Server } from 'node:http';
import { LivenessSchema, ReadinessSchema, REQUEST_ID_HEADER } from '@wayvro/contracts';
import { resolveRequestId, toErrorEnvelope, WayvroError } from '@wayvro/observability';
import { evaluateReadiness, type ReadinessCheck } from './readiness.js';

export interface HealthServerOptions {
  readonly service: string;
  readonly version: string;
  readonly checks: readonly ReadinessCheck[];
}

export function createHealthServer(options: HealthServerOptions): Server {
  return createServer((req, res) => {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, {
        'content-type': 'application/json',
        [REQUEST_ID_HEADER]: requestId,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(JSON.stringify(body));
    };
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/v1/health/live') {
      send(200, LivenessSchema.parse({ status: 'ok', service: options.service, version: options.version, serverTime: new Date().toISOString() }));
      return;
    }
    if (req.method === 'GET' && path === '/v1/health/ready') {
      evaluateReadiness(options.checks).then(
        (r) => {
          send(r.status === 'ready' ? 200 : 503, ReadinessSchema.parse(r));
        },
        (e: unknown) => {
          const { status, body } = toErrorEnvelope(e, requestId);
          send(status, body);
        },
      );
      return;
    }
    const { status, body } = toErrorEnvelope(new WayvroError('WAYVRO_E_NOT_FOUND'), requestId);
    send(status, body);
  });
}
