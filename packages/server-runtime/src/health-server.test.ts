import type { AddressInfo } from 'node:net';
import { ErrorEnvelopeSchema, LivenessSchema, ReadinessSchema } from '@wayvro/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createHealthServer, evaluateReadiness, type ReadinessCheck } from './index.js';

const ok = (name: string): ReadinessCheck => ({ name, check: () => Promise.resolve(true) });
const down = (name: string): ReadinessCheck => ({ name, check: () => Promise.resolve(false) });
const servers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function serve(checks: ReadinessCheck[]): Promise<string> {
  const server = createHealthServer({ service: 'worker', version: 'test', checks });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

describe('evaluateReadiness', () => {
  it('is ready only when every probe passes', async () => {
    expect(await evaluateReadiness([ok('database'), ok('redis')])).toEqual({ status: 'ready', checks: { database: 'ok', redis: 'ok' } });
    expect(await evaluateReadiness([ok('database'), down('redis')])).toEqual({ status: 'not_ready', checks: { database: 'ok', redis: 'fail' } });
  });
});

describe('health server', () => {
  it('serves the liveness contract and echoes valid request ids', async () => {
    const res = await fetch(`${await serve([ok('database')])}/v1/health/live`, { headers: { 'x-request-id': 'req-worker01' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('req-worker01');
    expect(LivenessSchema.parse(await res.json()).service).toBe('worker');
  });

  it('returns 200/503 readiness with the contract shape', async () => {
    const good = await fetch(`${await serve([ok('database')])}/v1/health/ready`);
    expect(good.status).toBe(200);
    const bad = await fetch(`${await serve([down('database')])}/v1/health/ready`);
    expect(bad.status).toBe(503);
    expect(ReadinessSchema.parse(await bad.json()).status).toBe('not_ready');
  });

  it('maps a throwing probe to WAYVRO_E_INTERNAL and unknown paths to WAYVRO_E_NOT_FOUND', async () => {
    const base = await serve([{ name: 'database', check: () => Promise.reject(new Error('boom')) }]);
    const broken = await fetch(`${base}/v1/health/ready`);
    expect(broken.status).toBe(500);
    expect(ErrorEnvelopeSchema.parse(await broken.json()).error.code).toBe('WAYVRO_E_INTERNAL');
    const missing = await fetch(`${base}/admin`);
    expect(missing.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await missing.json()).error.code).toBe('WAYVRO_E_NOT_FOUND');
  });
});
