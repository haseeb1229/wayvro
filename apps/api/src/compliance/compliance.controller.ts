import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  AgePolicyAdminSchema,
  AgePolicyDraftRequestSchema,
  AgePolicyListSchema,
  AgePolicyVersionParamSchema,
  ApplicationCreateRequestSchema,
  ApplicationIdParamSchema,
  ApplicationUpdateRequestSchema,
  CaptureChallengeDeclineRequestSchema,
  CaptureChallengeDeclineSchema,
  CaptureChallengeSchema,
  ChallengeParamSchema,
  DecisionRequestSchema,
  DocumentClaimRequestSchema,
  DocumentClaimedSchema,
  DriverApplicationSchema,
  DriverComplianceSchema,
  EmptyRequestSchema,
  IdParamSchema,
  RequirementChecklistSchema,
  RequirementSetDraftRequestSchema,
  RequirementSetListSchema,
  RequirementSetSchema,
  RestrictionCreateRequestSchema,
  RestrictionLiftDecisionSchema,
  RestrictionLiftRequestSchema,
  RestrictionListSchema,
  RestrictionQuerySchema,
  RestrictionSchema,
  SubmissionRequestSchema,
  VehicleCreateRequestSchema,
  VehicleCreatedSchema,
  VehicleParamSchema,
  VehicleUpdateRequestSchema,
  type DriverApplication,
  type DriverCompliance,
} from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { ConsumerSession, StaffSession, principalOf, staffOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { COMPLIANCE_ADMIN_SERVICE, ONBOARDING_SERVICE } from '../tokens.js';
import type { ComplianceAdminService } from './compliance-admin.service.js';
import type { OnboardingService } from './onboarding.service.js';

type Reply = FastifyReply;
/** Malformed or foreign ids are indistinguishable from unknown ones (404). */
function idParam<S extends z.ZodType>(schema: S, params: unknown): z.infer<S> {
  const p = schema.safeParse(params);
  if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return p.data;
}

/** `/v1/driver-onboarding/*` and `/v1/driver/*` — the ONE app's Driver/Partner flow (owner-scoped; V07). */
@Controller()
export class OnboardingController {
  constructor(@Inject(ONBOARDING_SERVICE) private readonly onboarding: OnboardingService) {}

  @Post('/v1/driver-onboarding/applications')
  @ConsumerSession()
  async create(@Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<DriverApplication | undefined> {
    const input = parse(ApplicationCreateRequestSchema, body);
    return render(reply, await this.onboarding.create(principalOf(req), input, idempotencyKey(req)), DriverApplicationSchema);
  }

  @Get('/v1/driver-onboarding/applications/current')
  @ConsumerSession({ restrictedOk: true })
  async current(@Req() req: AuthenticatedRequest): Promise<DriverApplication> {
    return DriverApplicationSchema.parse(await this.onboarding.current(principalOf(req)));
  }

  @Post('/v1/driver-onboarding/applications/:id/claims')
  @HttpCode(200)
  @ConsumerSession()
  async claims(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<DriverApplication | undefined> {
    const { id } = idParam(ApplicationIdParamSchema, params);
    return render(
      reply,
      await this.onboarding.updateClaims(principalOf(req), id, parse(ApplicationUpdateRequestSchema, body), idempotencyKey(req)),
      DriverApplicationSchema,
    );
  }

  @Post('/v1/driver-onboarding/applications/:id/consent')
  @HttpCode(200)
  @ConsumerSession()
  async consent(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<DriverApplication | undefined> {
    const { id } = idParam(ApplicationIdParamSchema, params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.onboarding.confirmConsent(principalOf(req), id, idempotencyKey(req)), DriverApplicationSchema);
  }

  @Get('/v1/driver-onboarding/applications/:id/requirements')
  @ConsumerSession()
  async requirements(@Param() params: unknown, @Req() req: AuthenticatedRequest): Promise<z.infer<typeof RequirementChecklistSchema>> {
    const { id } = idParam(ApplicationIdParamSchema, params);
    return RequirementChecklistSchema.parse(await this.onboarding.requirements(principalOf(req), id));
  }

  @Post('/v1/driver-onboarding/applications/:id/capture-challenges')
  @ConsumerSession()
  async challenge(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof CaptureChallengeSchema> | undefined> {
    const { id } = idParam(ApplicationIdParamSchema, params);
    parse(EmptyRequestSchema, body ?? {});
    return render(reply, await this.onboarding.issueCaptureChallenge(principalOf(req), id, idempotencyKey(req)), CaptureChallengeSchema);
  }

  @Post('/v1/driver-onboarding/applications/:id/capture-challenges/:challengeId/declines')
  @HttpCode(200)
  @ConsumerSession()
  async decline(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof CaptureChallengeDeclineSchema> | undefined> {
    const { id, challengeId } = idParam(ChallengeParamSchema, params);
    const { choice } = parse(CaptureChallengeDeclineRequestSchema, body);
    return render(
      reply,
      await this.onboarding.declineCaptureChallenge(principalOf(req), id, challengeId, choice, idempotencyKey(req)),
      CaptureChallengeDeclineSchema,
    );
  }

  @Post('/v1/driver-onboarding/applications/:id/submission')
  @HttpCode(200)
  @ConsumerSession()
  async submit(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<DriverApplication | undefined> {
    const { id } = idParam(ApplicationIdParamSchema, params);
    const { expectedVersion } = parse(SubmissionRequestSchema, body);
    return render(reply, await this.onboarding.submit(principalOf(req), id, expectedVersion, idempotencyKey(req)), DriverApplicationSchema);
  }

  @Post('/v1/driver-onboarding/applications/:id/vehicles')
  @ConsumerSession()
  async addVehicle(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof VehicleCreatedSchema> | undefined> {
    const { id } = idParam(ApplicationIdParamSchema, params);
    return render(
      reply,
      await this.onboarding.addVehicle(principalOf(req), id, parse(VehicleCreateRequestSchema, body), idempotencyKey(req)),
      VehicleCreatedSchema,
    );
  }

  @Post('/v1/driver-onboarding/applications/:id/vehicles/:vehicleId')
  @HttpCode(200)
  @ConsumerSession()
  async updateVehicle(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<DriverApplication | undefined> {
    const { id, vehicleId } = idParam(VehicleParamSchema, params);
    return render(
      reply,
      await this.onboarding.updateVehicle(principalOf(req), id, vehicleId, parse(VehicleUpdateRequestSchema, body), idempotencyKey(req)),
      DriverApplicationSchema,
    );
  }

  @Post('/v1/driver-onboarding/applications/:id/documents')
  @ConsumerSession()
  async claimDocument(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof DocumentClaimedSchema> | undefined> {
    const { id } = idParam(ApplicationIdParamSchema, params);
    return render(
      reply,
      await this.onboarding.claimDocument(principalOf(req), id, parse(DocumentClaimRequestSchema, body), idempotencyKey(req)),
      DocumentClaimedSchema,
    );
  }

  @Post('/v1/driver-onboarding/applications/:id/withdrawal')
  @HttpCode(200)
  @ConsumerSession({ restrictedOk: true })
  async withdraw(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<DriverApplication | undefined> {
    const { id } = idParam(ApplicationIdParamSchema, params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.onboarding.withdraw(principalOf(req), id, idempotencyKey(req)), DriverApplicationSchema);
  }

  @Get('/v1/driver/compliance')
  @ConsumerSession({ restrictedOk: true })
  async compliance(@Req() req: AuthenticatedRequest): Promise<DriverCompliance> {
    return DriverComplianceSchema.parse(await this.onboarding.driverCompliance(principalOf(req)));
  }
}

/** Staff: restrictions, requirement sets, age-policy data (maker-checker; step-up on every change). */
@Controller()
export class ComplianceAdminController {
  constructor(@Inject(COMPLIANCE_ADMIN_SERVICE) private readonly admin: ComplianceAdminService) {}

  @Get('/v1/admin/restrictions')
  @StaffSession({ permission: 'restriction.view' })
  async listRestrictions(@Query() query: unknown, @Req() req: AuthenticatedRequest): Promise<z.infer<typeof RestrictionListSchema>> {
    return RestrictionListSchema.parse(await this.admin.listRestrictions(staffOf(req), parse(RestrictionQuerySchema, query)));
  }

  @Post('/v1/admin/restrictions')
  @StaffSession({ permission: 'restriction.create', stepUp: true })
  async createRestriction(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RestrictionSchema> | undefined> {
    return render(reply, await this.admin.createRestriction(staffOf(req), parse(RestrictionCreateRequestSchema, body), idempotencyKey(req)), RestrictionSchema);
  }

  @Post('/v1/admin/restrictions/:id/lift')
  @HttpCode(200)
  @StaffSession({ permission: 'restriction.lift', stepUp: true })
  async lift(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RestrictionSchema> | undefined> {
    const { id } = idParam(IdParamSchema, params);
    const { reasonCode } = parse(RestrictionLiftRequestSchema, body);
    return render(reply, await this.admin.liftRestriction(staffOf(req), id, reasonCode, idempotencyKey(req)), RestrictionSchema);
  }

  @Post('/v1/admin/restrictions/:id/lift-approval')
  @HttpCode(200)
  @StaffSession({ permission: 'restriction.lift', stepUp: true })
  async decideLift(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RestrictionSchema> | undefined> {
    const { id } = idParam(IdParamSchema, params);
    const { decision } = parse(RestrictionLiftDecisionSchema, body);
    return render(reply, await this.admin.decideLift(staffOf(req), id, decision, idempotencyKey(req)), RestrictionSchema);
  }

  @Get('/v1/admin/requirement-sets')
  @StaffSession({ permission: 'compliance.requirement_set.view' })
  async listSets(): Promise<z.infer<typeof RequirementSetListSchema>> {
    return RequirementSetListSchema.parse(await this.admin.listSets());
  }

  @Get('/v1/admin/requirement-sets/:id')
  @StaffSession({ permission: 'compliance.requirement_set.view' })
  async getSet(@Param() params: unknown): Promise<z.infer<typeof RequirementSetSchema>> {
    const set = await this.admin.getSet(idParam(IdParamSchema, params).id);
    if (!set) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    return RequirementSetSchema.parse(set);
  }

  @Post('/v1/admin/requirement-sets')
  @StaffSession({ permission: 'compliance.requirement_set.draft', stepUp: true })
  async draftSet(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RequirementSetSchema> | undefined> {
    return render(reply, await this.admin.draftSet(staffOf(req), parse(RequirementSetDraftRequestSchema, body), idempotencyKey(req)), RequirementSetSchema);
  }

  @Post('/v1/admin/requirement-sets/:id/submission')
  @HttpCode(200)
  @StaffSession({ permission: 'compliance.requirement_set.draft', stepUp: true })
  async submitSet(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RequirementSetSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    return render(reply, await this.admin.submitSet(staffOf(req), idParam(IdParamSchema, params).id, idempotencyKey(req)), RequirementSetSchema);
  }

  @Post('/v1/admin/requirement-sets/:id/approval')
  @HttpCode(200)
  @StaffSession({ permission: 'compliance.requirement_set.approve', stepUp: true })
  async decideSet(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RequirementSetSchema> | undefined> {
    const { decision } = parse(DecisionRequestSchema, body);
    return render(reply, await this.admin.decideSet(staffOf(req), idParam(IdParamSchema, params).id, decision, idempotencyKey(req)), RequirementSetSchema);
  }

  @Post('/v1/admin/requirement-sets/:id/activation')
  @HttpCode(200)
  @StaffSession({ permission: 'compliance.requirement_set.approve', stepUp: true })
  async activateSet(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RequirementSetSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    return render(reply, await this.admin.activateSet(staffOf(req), idParam(IdParamSchema, params).id, idempotencyKey(req)), RequirementSetSchema);
  }

  @Get('/v1/admin/age-policies')
  @StaffSession({ permission: 'legal.age_policy.draft' })
  async listAgePolicies(): Promise<z.infer<typeof AgePolicyListSchema>> {
    return AgePolicyListSchema.parse(await this.admin.listAgePolicies());
  }

  @Post('/v1/admin/age-policies')
  @StaffSession({ permission: 'legal.age_policy.draft', stepUp: true })
  async draftAgePolicy(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof AgePolicyAdminSchema> | undefined> {
    return render(reply, await this.admin.draftAgePolicy(staffOf(req), parse(AgePolicyDraftRequestSchema, body), idempotencyKey(req)), AgePolicyAdminSchema);
  }

  @Post('/v1/admin/age-policies/:version/approval')
  @HttpCode(200)
  @StaffSession({ permission: 'legal.age_policy.approve', stepUp: true })
  async decideAgePolicy(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof AgePolicyAdminSchema> | undefined> {
    const { version } = idParam(AgePolicyVersionParamSchema, params);
    const { decision } = parse(DecisionRequestSchema, body);
    return render(reply, await this.admin.decideAgePolicy(staffOf(req), Number(version), decision, idempotencyKey(req)), AgePolicyAdminSchema);
  }
}
