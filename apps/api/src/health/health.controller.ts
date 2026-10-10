import { Controller, Get, Inject, Res } from '@nestjs/common';
import { HEALTH_ROUTES, LivenessSchema, ReadinessSchema, type Liveness, type Readiness } from '@wayvro/contracts';
import type { FastifyReply } from 'fastify';
import { evaluateReadiness } from '@wayvro/server-runtime';
import { READINESS_CHECKS, SERVICE_INFO, type ServiceInfo } from '../tokens.js';
import type { ReadinessCheck } from '@wayvro/server-runtime';

const [LIVE, READY] = HEALTH_ROUTES;

@Controller()
export class HealthController {
  constructor(
    @Inject(SERVICE_INFO) private readonly info: ServiceInfo,
    @Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[],
  ) {}

  @Get(LIVE.path)
  live(): Liveness {
    // Responses are parsed with the contract schema so the implementation cannot drift from the published contract.
    return LivenessSchema.parse({ status: 'ok', service: this.info.service, version: this.info.version, serverTime: new Date().toISOString() });
  }

  @Get(READY.path)
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<Readiness> {
    const result = await evaluateReadiness(this.checks);
    void reply.status(result.status === 'ready' ? 200 : 503);
    return ReadinessSchema.parse(result);
  }
}
