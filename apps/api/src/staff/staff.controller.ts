import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  AssertionRequestSchema,
  AuditEventListSchema,
  AuditEventQuerySchema,
  BreakGlassGrantSchema,
  BreakGlassListSchema,
  BreakGlassRequestSchema,
  BreakGlassReviewRequestSchema,
  CredentialListSchema,
  CredentialRegistrationRequestSchema,
  EmptyRequestSchema,
  EnrolmentOptionsRequestSchema,
  EnrolmentRequestSchema,
  IdParamSchema,
  OffboardingResultSchema,
  ReEnrolmentRequestedSchema,
  RoleAssignmentStateSchema,
  RoleDecisionRequestSchema,
  RoleGrantRequestSchema,
  SealStatusSchema,
  StaffInvitationIssuedSchema,
  StaffInvitationRequestSchema,
  StaffMeSchema,
  StaffRosterQuerySchema,
  StaffRosterSchema,
  StaffSessionIssuedSchema,
  VerificationRequestedSchema,
  WebAuthnChallengeSchema,
  type StaffMe,
} from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { Public, StaffSession, staffOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { STAFF_ADMIN_SERVICE, STAFF_AUTH_SERVICE, STAFF_OVERSIGHT_SERVICE } from '../tokens.js';
import type { OversightService } from './oversight.service.js';
import type { StaffAdminService } from './staff-admin.service.js';
import type { StaffAuthService } from './staff-auth.service.js';

type Reply = FastifyReply;
const idOf = (params: unknown): string => {
  const p = IdParamSchema.safeParse(params);
  if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return p.data.id;
};

/** `/v1/admin/auth/*` and the caller's own session/credentials (staff realm; called only by the web-ops BFF). */
@Controller()
export class StaffAuthController {
  constructor(
    @Inject(STAFF_AUTH_SERVICE) private readonly auth: StaffAuthService,
    @Inject(STAFF_OVERSIGHT_SERVICE) private readonly oversight: OversightService,
  ) {}

  @Post('/v1/admin/auth/enrolment-options')
  @HttpCode(200)
  @Public()
  async enrolmentOptions(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof WebAuthnChallengeSchema> | undefined> {
    const input = parse(EnrolmentOptionsRequestSchema, body);
    await this.auth.admit(req.ip);
    return render(reply, await this.auth.enrolmentOptions(input.invitationToken, idempotencyKey(req)), WebAuthnChallengeSchema);
  }

  @Post('/v1/admin/auth/enrolments')
  @Public()
  async enrol(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof StaffSessionIssuedSchema> | undefined> {
    const input = parse(EnrolmentRequestSchema, body);
    await this.auth.admit(req.ip);
    return render(reply, await this.auth.enrol(input, idempotencyKey(req)), StaffSessionIssuedSchema);
  }

  @Post('/v1/admin/auth/login-options')
  @HttpCode(200)
  @Public()
  async loginOptions(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof WebAuthnChallengeSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    await this.auth.admit(req.ip);
    return render(reply, await this.auth.loginOptions(idempotencyKey(req)), WebAuthnChallengeSchema);
  }

  @Post('/v1/admin/auth/sessions')
  @Public()
  async login(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof StaffSessionIssuedSchema> | undefined> {
    const input = parse(AssertionRequestSchema, body);
    await this.auth.admit(req.ip);
    return render(reply, await this.auth.login(input, idempotencyKey(req)), StaffSessionIssuedSchema);
  }

  @Post('/v1/admin/auth/step-up-options')
  @HttpCode(200)
  @StaffSession()
  async stepUpOptions(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof WebAuthnChallengeSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    return render(reply, await this.auth.assertionOptions(staffOf(req), 'STEP_UP', idempotencyKey(req)), WebAuthnChallengeSchema);
  }

  @Post('/v1/admin/auth/step-ups')
  @HttpCode(204)
  @StaffSession()
  async stepUp(@Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<undefined> {
    const input = parse(AssertionRequestSchema, body);
    const staff = staffOf(req);
    await this.auth.admit(req.ip, staff.staffId);
    return render(reply, await this.auth.assert(staff, 'STEP_UP', input, idempotencyKey(req)));
  }

  @Post('/v1/admin/auth/unlock-options')
  @HttpCode(200)
  @StaffSession({ allowLocked: true })
  async unlockOptions(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof WebAuthnChallengeSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    return render(reply, await this.auth.assertionOptions(staffOf(req), 'UNLOCK', idempotencyKey(req)), WebAuthnChallengeSchema);
  }

  @Post('/v1/admin/auth/unlocks')
  @HttpCode(204)
  @StaffSession({ allowLocked: true })
  async unlock(@Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<undefined> {
    const input = parse(AssertionRequestSchema, body);
    const staff = staffOf(req);
    await this.auth.admit(req.ip, staff.staffId);
    return render(reply, await this.auth.assert(staff, 'UNLOCK', input, idempotencyKey(req)));
  }

  @Delete('/v1/admin/auth/sessions/current')
  @HttpCode(204)
  @StaffSession({ allowLocked: true })
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<undefined> {
    return render(reply, await this.auth.logout(staffOf(req), idempotencyKey(req)));
  }

  @Get('/v1/admin/me')
  @StaffSession({ allowLocked: true })
  async me(@Req() req: AuthenticatedRequest): Promise<StaffMe> {
    const staff = staffOf(req);
    const pending = staff.permissions.has('breakglass.review') ? await this.oversight.pendingBreakGlassReviews() : null;
    return StaffMeSchema.parse(await this.auth.me(staff, pending));
  }

  @Get('/v1/admin/me/credentials')
  @StaffSession()
  async credentials(@Req() req: AuthenticatedRequest): Promise<z.infer<typeof CredentialListSchema>> {
    return CredentialListSchema.parse(await this.auth.credentials(staffOf(req)));
  }

  @Post('/v1/admin/me/credential-options')
  @HttpCode(200)
  @StaffSession({ stepUp: true })
  async credentialOptions(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof WebAuthnChallengeSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    return render(reply, await this.auth.credentialOptions(staffOf(req), idempotencyKey(req)), WebAuthnChallengeSchema);
  }

  @Post('/v1/admin/me/credentials')
  @StaffSession({ stepUp: true })
  async addCredential(@Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<undefined> {
    const input = parse(CredentialRegistrationRequestSchema, body);
    return render(reply, await this.auth.addCredential(staffOf(req), input, idempotencyKey(req)));
  }

  @Delete('/v1/admin/me/credentials/:id')
  @HttpCode(204)
  @StaffSession({ stepUp: true })
  async revokeCredential(@Param() params: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<undefined> {
    return render(reply, await this.auth.revokeCredential(staffOf(req), idOf(params), idempotencyKey(req)));
  }
}

/** Staff administration (STAFF_ADMIN; step-up on every privileged action; maker-checker on role grants). */
@Controller()
export class StaffAdminController {
  constructor(@Inject(STAFF_ADMIN_SERVICE) private readonly admin: StaffAdminService) {}

  @Get('/v1/admin/staff')
  @StaffSession({ permission: 'staff.view_roster' })
  async roster(@Query() query: unknown): Promise<z.infer<typeof StaffRosterSchema>> {
    const q = parse(StaffRosterQuerySchema, query);
    return StaffRosterSchema.parse(await this.admin.roster(q.cursor));
  }

  @Post('/v1/admin/staff-invitations')
  @StaffSession({ permission: 'staff.invite', stepUp: true })
  async invite(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof StaffInvitationIssuedSchema> | undefined> {
    const input = parse(StaffInvitationRequestSchema, body);
    return render(reply, await this.admin.invite(staffOf(req), input, idempotencyKey(req)), StaffInvitationIssuedSchema);
  }

  @Post('/v1/admin/staff-invitations/:id/approval')
  @StaffSession({ permission: 'staff.reenrolment.approve', stepUp: true })
  async approveReEnrolment(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof StaffInvitationIssuedSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    return render(reply, await this.admin.approveReEnrolment(staffOf(req), idOf(params), idempotencyKey(req)), StaffInvitationIssuedSchema);
  }

  @Post('/v1/admin/staff/:id/re-enrolments')
  @StaffSession({ permission: 'staff.reenrolment.issue', stepUp: true })
  async requestReEnrolment(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof ReEnrolmentRequestedSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    return render(reply, await this.admin.requestReEnrolment(staffOf(req), idOf(params), idempotencyKey(req)), ReEnrolmentRequestedSchema);
  }

  @Post('/v1/admin/staff/:id/offboarding')
  @HttpCode(200)
  @StaffSession({ permission: 'staff.offboard', stepUp: true })
  async offboard(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof OffboardingResultSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    return render(reply, await this.admin.offboard(staffOf(req), idOf(params), idempotencyKey(req)), OffboardingResultSchema);
  }

  @Post('/v1/admin/role-assignments')
  @StaffSession({ permission: 'staff.role.grant', stepUp: true })
  async grant(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RoleAssignmentStateSchema> | undefined> {
    const input = parse(RoleGrantRequestSchema, body);
    return render(reply, await this.admin.grantRole(staffOf(req), input, idempotencyKey(req)), RoleAssignmentStateSchema);
  }

  @Post('/v1/admin/role-assignments/:id/approval')
  @HttpCode(200)
  @StaffSession({ permission: 'staff.role.approve', stepUp: true })
  async decide(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RoleAssignmentStateSchema> | undefined> {
    const input = parse(RoleDecisionRequestSchema, body);
    return render(reply, await this.admin.decideRole(staffOf(req), idOf(params), input.decision, idempotencyKey(req)), RoleAssignmentStateSchema);
  }

  @Post('/v1/admin/role-assignments/:id/revocation')
  @HttpCode(200)
  @StaffSession({ permission: 'staff.role.revoke', stepUp: true })
  async revoke(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RoleAssignmentStateSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    return render(reply, await this.admin.revokeRole(staffOf(req), idOf(params), idempotencyKey(req)), RoleAssignmentStateSchema);
  }
}

/** Break-glass and the audit viewer. */
@Controller()
export class OversightController {
  constructor(@Inject(STAFF_OVERSIGHT_SERVICE) private readonly oversight: OversightService) {}

  @Post('/v1/admin/break-glass')
  @StaffSession({ permission: 'breakglass.activate', stepUp: true })
  async activate(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof BreakGlassGrantSchema> | undefined> {
    const input = parse(BreakGlassRequestSchema, body);
    return render(reply, await this.oversight.activateBreakGlass(staffOf(req), input, idempotencyKey(req)), BreakGlassGrantSchema);
  }

  @Post('/v1/admin/break-glass/:id/end')
  @HttpCode(200)
  @StaffSession()
  async end(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof BreakGlassGrantSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    return render(reply, await this.oversight.endBreakGlass(staffOf(req), idOf(params), idempotencyKey(req)), BreakGlassGrantSchema);
  }

  @Get('/v1/admin/break-glass')
  @StaffSession({ permission: 'breakglass.review' })
  async list(): Promise<z.infer<typeof BreakGlassListSchema>> {
    return BreakGlassListSchema.parse(await this.oversight.listBreakGlass());
  }

  @Post('/v1/admin/break-glass/:id/review')
  @HttpCode(200)
  @StaffSession({ permission: 'breakglass.review', stepUp: true })
  async review(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof BreakGlassGrantSchema> | undefined> {
    const input = parse(BreakGlassReviewRequestSchema, body);
    return render(reply, await this.oversight.reviewBreakGlass(staffOf(req), idOf(params), input.outcome, idempotencyKey(req)), BreakGlassGrantSchema);
  }

  @Get('/v1/admin/audit-events')
  @StaffSession({ permission: 'audit.events.view' })
  async events(@Query() query: unknown): Promise<z.infer<typeof AuditEventListSchema>> {
    return AuditEventListSchema.parse(await this.oversight.auditEvents(parse(AuditEventQuerySchema, query)));
  }

  @Get('/v1/admin/audit-seals/status')
  @StaffSession({ permission: 'audit.seals.verify' })
  async sealStatus(): Promise<z.infer<typeof SealStatusSchema>> {
    return SealStatusSchema.parse(await this.oversight.sealStatus());
  }

  @Post('/v1/admin/audit-seals/verifications')
  @HttpCode(202)
  @StaffSession({ permission: 'audit.seals.verify' })
  async verify(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof VerificationRequestedSchema> | undefined> {
    parse(EmptyRequestSchema, body);
    return render(reply, await this.oversight.requestVerification(staffOf(req), idempotencyKey(req)), VerificationRequestedSchema);
  }
}
