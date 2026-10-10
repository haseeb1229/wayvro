import { Body, Controller, Delete, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  ChallengeIdParamSchema,
  OtpChallengeRequestSchema,
  OtpChallengeSchema,
  OtpResendRequestSchema,
  SessionCreateRequestSchema,
  SessionCreatedSchema,
  SessionTokensSchema,
  TokenRefreshRequestSchema,
  type OtpChallenge,
  type SessionCreated,
  type SessionTokens,
} from '@wayvro/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ConsumerSession, Public, principalOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { OTP_SERVICE, SESSION_SERVICE } from '../tokens.js';
import type { OtpService } from './otp.service.js';
import type { SessionService } from './session.service.js';

/** `/v1/auth/*` (docs/phase2/PHASE2_API_AND_SURFACES.md §2.1). */
@Controller()
export class AuthController {
  constructor(
    @Inject(OTP_SERVICE) private readonly otp: OtpService,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  @Post('/v1/auth/otp-challenges')
  @Public()
  async createOtpChallenge(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OtpChallenge | undefined> {
    const input = parse(OtpChallengeRequestSchema, body);
    return render(reply, await this.otp.request(input, { idempotencyKey: idempotencyKey(request), clientIp: request.ip }), OtpChallengeSchema);
  }

  @Post('/v1/auth/otp-challenges/:challengeId/resends')
  @Public()
  async resendOtpChallenge(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OtpChallenge | undefined> {
    const { challengeId } = parse(ChallengeIdParamSchema, params);
    const { installationId } = parse(OtpResendRequestSchema, body);
    return render(
      reply,
      await this.otp.resend(challengeId, installationId, { idempotencyKey: idempotencyKey(request), clientIp: request.ip }),
      OtpChallengeSchema,
    );
  }

  @Post('/v1/auth/sessions')
  @Public()
  async createSession(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionCreated | undefined> {
    const input = parse(SessionCreateRequestSchema, body);
    return render(reply, await this.sessions.create(input, idempotencyKey(request)), SessionCreatedSchema);
  }

  @Post('/v1/auth/token-refreshes')
  @Public()
  async refreshSession(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionTokens | undefined> {
    const { refreshToken } = parse(TokenRefreshRequestSchema, body);
    return render(reply, await this.sessions.refresh(refreshToken, idempotencyKey(request)), SessionTokensSchema);
  }

  @Delete('/v1/auth/sessions/current')
  @HttpCode(204)
  @ConsumerSession()
  async deleteCurrentSession(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<undefined> {
    return render(reply, await this.sessions.logout(principalOf(request), idempotencyKey(request)));
  }
}
