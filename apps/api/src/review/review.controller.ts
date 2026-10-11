import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  AccountAppealListSchema,
  AccountAppealSchema,
  AdminAppealListSchema,
  AppealCreateRequestSchema,
  AppealDecisionRequestSchema,
  AppealDecisionResultSchema,
  AppealQuerySchema,
  EmptyRequestSchema,
  ExpiryRosterQuerySchema,
  ExpiryRosterSchema,
  IdParamSchema,
  ReviewCaseDetailSchema,
  ReviewCaseListSchema,
  ReviewCaseQuerySchema,
  ReviewDecisionRequestSchema,
  ReviewDecisionResultSchema,
  SecondApprovalRequestSchema,
} from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { ConsumerSession, StaffSession, principalOf, staffOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { REVIEW_SERVICES } from '../tokens.js';
import type { AppealsService } from './appeals.service.js';
import type { MonitoringService } from './monitoring.service.js';
import type { ReviewService } from './review.service.js';

export interface ReviewServices {
  readonly review: ReviewService;
  readonly appeals: AppealsService;
  readonly monitoring: MonitoringService;
}

type Reply = FastifyReply;
function idParam(params: unknown): string {
  const p = IdParamSchema.safeParse(params);
  if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return p.data.id;
}

/** `/v1/admin/review-cases`, `/v1/admin/review-decisions`, `/v1/admin/appeals`, expiry roster (web-ops BFF only). */
@Controller()
export class ReviewController {
  constructor(@Inject(REVIEW_SERVICES) private readonly s: ReviewServices) {}

  @Get('/v1/admin/review-cases')
  @StaffSession({ permission: 'kyc.queue.view' })
  async list(@Query() query: unknown, @Req() req: AuthenticatedRequest): Promise<z.infer<typeof ReviewCaseListSchema>> {
    return ReviewCaseListSchema.parse(await this.s.review.list(staffOf(req), parse(ReviewCaseQuerySchema, query)));
  }

  @Post('/v1/admin/review-cases/:id/claim')
  @HttpCode(200)
  @StaffSession({ permission: 'kyc.case.claim' })
  async claim(@Param() params: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply) {
    parse(EmptyRequestSchema, body ?? {});
    return render(reply, await this.s.review.claim(staffOf(req), idParam(params), idempotencyKey(req)), ReviewCaseDetailSchema);
  }

  @Post('/v1/admin/review-cases/:id/release')
  @StaffSession({ permission: 'kyc.case.claim' })
  async release(@Param() params: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<void> {
    parse(EmptyRequestSchema, body ?? {});
    render(reply, await this.s.review.release(staffOf(req), idParam(params), idempotencyKey(req)));
  }

  @Get('/v1/admin/review-cases/:id')
  @StaffSession({ permission: 'kyc.case.view_masked' })
  async detail(@Param() params: unknown, @Req() req: AuthenticatedRequest): Promise<z.infer<typeof ReviewCaseDetailSchema>> {
    return ReviewCaseDetailSchema.parse(await this.s.review.detail(staffOf(req), idParam(params)));
  }

  @Post('/v1/admin/review-cases/:id/decisions')
  @StaffSession({ permission: 'kyc.case.claim', stepUp: true })
  async decide(@Param() params: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply) {
    const input = parse(ReviewDecisionRequestSchema, body);
    return render(reply, await this.s.review.decide(staffOf(req), idParam(params), input, idempotencyKey(req)), ReviewDecisionResultSchema);
  }

  @Post('/v1/admin/review-decisions/:id/second-approvals')
  @HttpCode(200)
  @StaffSession({ permission: 'kyc.decision.second_approve', stepUp: true })
  async secondApproval(@Param() params: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply) {
    const { outcome } = parse(SecondApprovalRequestSchema, body);
    return render(reply, await this.s.review.secondApproval(staffOf(req), idParam(params), outcome, idempotencyKey(req)), ReviewDecisionResultSchema);
  }

  @Get('/v1/admin/appeals')
  @StaffSession({ permission: 'appeal.view' })
  async appeals(@Query() query: unknown, @Req() req: AuthenticatedRequest): Promise<z.infer<typeof AdminAppealListSchema>> {
    return AdminAppealListSchema.parse(await this.s.appeals.listForStaff(staffOf(req), parse(AppealQuerySchema, query)));
  }

  @Post('/v1/admin/appeals/:id/decisions')
  @HttpCode(200)
  @StaffSession({ permission: 'appeal.decide', stepUp: true })
  async decideAppeal(@Param() params: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply) {
    const input = parse(AppealDecisionRequestSchema, body);
    return render(reply, await this.s.appeals.decide(staffOf(req), idParam(params), input, idempotencyKey(req)), AppealDecisionResultSchema);
  }

  @Get('/v1/admin/compliance/expiry-roster')
  @StaffSession({ permission: 'compliance.expiry_roster.view' })
  async roster(@Query() query: unknown, @Req() req: AuthenticatedRequest): Promise<z.infer<typeof ExpiryRosterSchema>> {
    return ExpiryRosterSchema.parse(await this.s.monitoring.expiryRoster(staffOf(req), parse(ExpiryRosterQuerySchema, query)));
  }
}

/** `/v1/account/appeals` in the ONE app — available under an account restriction (an appeal is how it is challenged). */
@Controller()
export class AccountAppealsController {
  constructor(@Inject(REVIEW_SERVICES) private readonly s: ReviewServices) {}

  @Post('/v1/account/appeals')
  @ConsumerSession({ restrictedOk: true })
  async create(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof AccountAppealSchema> | undefined> {
    const input = parse(AppealCreateRequestSchema, body);
    return render(reply, await this.s.appeals.create(principalOf(req), input, idempotencyKey(req)), AccountAppealSchema);
  }

  @Get('/v1/account/appeals')
  @ConsumerSession({ restrictedOk: true })
  async list(@Req() req: AuthenticatedRequest): Promise<z.infer<typeof AccountAppealListSchema>> {
    return AccountAppealListSchema.parse(await this.s.appeals.listOwn(principalOf(req)));
  }
}
