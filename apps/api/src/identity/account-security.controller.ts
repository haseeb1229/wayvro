import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  AccountRecoveryReceiptSchema,
  AccountRecoveryRequestSchema,
  ChallengeIdParamSchema,
  CurrentDeletionRequestSchema,
  CurrentPhoneChangeSchema,
  CurrentRecoveryReviewSchema,
  DeletionParamSchema,
  DeletionRequestSchema,
  OtpChallengeSchema,
  PhoneChangeParamSchema,
  PhoneChangeRequestSchema,
  PhoneChangeSchema,
  PhoneChangeStartedSchema,
  PhoneChangeVerificationRequestSchema,
  RecoveryReviewChoiceRequestSchema,
  RecoveryReviewOutcomeSchema,
  StepUpSchema,
  StepUpVerificationRequestSchema,
  WebDeletionOtpRequestSchema,
  WebDeletionReceiptSchema,
  WebDeletionRequestSchema,
} from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ConsumerSession, Public, principalOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { ACCOUNT_SECURITY_SERVICE, DELETION_SERVICE, RECOVERY_REVIEW_SERVICE } from '../tokens.js';
import type { AccountSecurityService } from './account-security.service.js';
import type { DeletionService } from './deletion.service.js';
import type { RecoveryReviewService } from './recovery-review.service.js';

type Reply = FastifyReply;
type Out<S extends z.ZodType> = Promise<z.infer<S> | undefined>;
/** Malformed or foreign ids are indistinguishable from unknown ones (404). */
function idParam<S extends z.ZodType>(schema: S, params: unknown): z.infer<S> {
  const p = schema.safeParse(params);
  if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return p.data;
}

/** P2.9 step-up, phone change, recovery, dormant-number review and deletion (docs/phase2/PHASE2_API_AND_SURFACES.md §2). */
@Controller()
export class AccountSecurityController {
  constructor(
    @Inject(ACCOUNT_SECURITY_SERVICE) private readonly security: AccountSecurityService,
    @Inject(RECOVERY_REVIEW_SERVICE) private readonly reviews: RecoveryReviewService,
    @Inject(DELETION_SERVICE) private readonly deletion: DeletionService,
  ) {}

  @Post('/v1/account/step-ups')
  @HttpCode(202)
  @ConsumerSession({ restrictedOk: true })
  async stepUp(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Out<typeof OtpChallengeSchema> {
    return render(reply, await this.security.requestStepUp(principalOf(req), idempotencyKey(req), req.ip), OtpChallengeSchema);
  }

  @Post('/v1/account/step-ups/:challengeId/verifications')
  @HttpCode(200)
  @ConsumerSession({ restrictedOk: true })
  async verifyStepUp(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Out<typeof StepUpSchema> {
    const { challengeId } = idParam(ChallengeIdParamSchema, params);
    const { code } = parse(StepUpVerificationRequestSchema, body);
    return render(reply, await this.security.verifyStepUp(principalOf(req), challengeId, code, idempotencyKey(req)), StepUpSchema);
  }

  @Post('/v1/account/phone-changes')
  @ConsumerSession()
  async startPhoneChange(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Out<typeof PhoneChangeStartedSchema> {
    const input = parse(PhoneChangeRequestSchema, body);
    return render(reply, await this.security.startPhoneChange(principalOf(req), input, idempotencyKey(req), req.ip), PhoneChangeStartedSchema);
  }

  @Get('/v1/account/phone-changes/current')
  @ConsumerSession({ restrictedOk: true })
  async currentPhoneChange(@Req() req: AuthenticatedRequest): Promise<z.infer<typeof CurrentPhoneChangeSchema>> {
    return CurrentPhoneChangeSchema.parse(await this.security.current(principalOf(req)));
  }

  @Post('/v1/account/phone-changes/:id/verifications')
  @HttpCode(200)
  @ConsumerSession()
  async verifyPhoneChange(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Out<typeof PhoneChangeSchema> {
    const { id } = idParam(PhoneChangeParamSchema, params);
    const input = parse(PhoneChangeVerificationRequestSchema, body);
    return render(reply, await this.security.verifyPhoneChange(principalOf(req), id, input, idempotencyKey(req)), PhoneChangeSchema);
  }

  @Post('/v1/account/phone-changes/:id/cancellation')
  @HttpCode(200)
  @ConsumerSession({ restrictedOk: true })
  async cancelPhoneChange(@Param() params: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Out<typeof PhoneChangeSchema> {
    const { id } = idParam(PhoneChangeParamSchema, params);
    return render(reply, await this.security.cancel(principalOf(req), id, idempotencyKey(req)), PhoneChangeSchema);
  }

  @Post('/v1/account-recoveries')
  @HttpCode(202)
  @ConsumerSession()
  async recover(@Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Out<typeof AccountRecoveryReceiptSchema> {
    const input = parse(AccountRecoveryRequestSchema, body);
    return render(reply, await this.security.recover(principalOf(req), input, idempotencyKey(req)), AccountRecoveryReceiptSchema);
  }

  @Get('/v1/account/recovery-reviews/current')
  @ConsumerSession({ restrictedOk: true, recoveryReviewOk: true })
  async currentReview(@Req() req: AuthenticatedRequest): Promise<z.infer<typeof CurrentRecoveryReviewSchema>> {
    return CurrentRecoveryReviewSchema.parse(await this.reviews.current(principalOf(req)));
  }

  @Post('/v1/account/recovery-reviews/:id/choices')
  @HttpCode(200)
  @ConsumerSession({ restrictedOk: true, recoveryReviewOk: true })
  async chooseReview(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Out<typeof RecoveryReviewOutcomeSchema> {
    const { id } = idParam(PhoneChangeParamSchema, params);
    const { choice } = parse(RecoveryReviewChoiceRequestSchema, body);
    return render(reply, await this.reviews.choose(principalOf(req), id, choice, idempotencyKey(req)), RecoveryReviewOutcomeSchema);
  }

  @Post('/v1/account/deletion-requests')
  @ConsumerSession({ restrictedOk: true })
  async requestDeletion(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Out<typeof DeletionRequestSchema> {
    return render(reply, await this.deletion.request(principalOf(req), idempotencyKey(req)), DeletionRequestSchema);
  }

  @Get('/v1/account/deletion-requests/current')
  @ConsumerSession({ restrictedOk: true })
  async currentDeletion(@Req() req: AuthenticatedRequest): Promise<z.infer<typeof CurrentDeletionRequestSchema>> {
    return CurrentDeletionRequestSchema.parse(await this.deletion.current(principalOf(req)));
  }

  @Post('/v1/account/deletion-requests/:id/cancellation')
  @HttpCode(200)
  @ConsumerSession({ restrictedOk: true })
  async cancelDeletion(
    @Param() params: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Out<typeof DeletionRequestSchema> {
    const { id } = idParam(DeletionParamSchema, params);
    return render(reply, await this.deletion.cancel(principalOf(req), id, idempotencyKey(req)), DeletionRequestSchema);
  }

  @Post('/v1/public/account-deletion-otp-challenges')
  @HttpCode(202)
  @Public()
  async webDeletionOtp(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: Reply): Out<typeof OtpChallengeSchema> {
    const input = parse(WebDeletionOtpRequestSchema, body);
    return render(reply, await this.deletion.webOtp(input, idempotencyKey(req), req.ip), OtpChallengeSchema);
  }

  @Post('/v1/public/account-deletion-requests')
  @HttpCode(202)
  @Public()
  async webDeletionRequest(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: Reply): Out<typeof WebDeletionReceiptSchema> {
    const input = parse(WebDeletionRequestSchema, body);
    return render(reply, await this.deletion.webRequest(input, idempotencyKey(req), req.ip), WebDeletionReceiptSchema);
  }
}
