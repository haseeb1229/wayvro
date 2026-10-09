import { LivenessSchema } from '@wayvro/contracts';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const body = LivenessSchema.parse({
    status: 'ok',
    service: 'web-ops',
    version: process.env['WAYVRO_BUILD_VERSION'] ?? 'dev',
    serverTime: new Date().toISOString(),
  });
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
