import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import {
  AccountStateSchema,
  ProfileSchema,
  ProfileUpdateRequestSchema,
  SecurityEventListSchema,
  SessionIdParamSchema,
  SessionListSchema,
  SessionRevocationRequestSchema,
  SessionRevocationResultSchema,
  type AccountState,
  type SecurityEventList,
  type SessionList,
} from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { ConsumerSession, principalOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { ACCOUNT_SERVICE, SESSION_SERVICE } from '../tokens.js';
import type { AccountService } from './account.service.js';
import type { SessionService } from './session.service.js';

/** `/v1/account/*` — owner-scoped; foreign ids answer 404 (docs/phase2/PHASE2_API_AND_SURFACES.md §2.2). */
@Controller()
export class AccountController {
  constructor(
    @Inject(ACCOUNT_SERVICE) private readonly accounts: AccountService,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  @Get('/v1/account/state')
  @ConsumerSession({ restrictedOk: true })
  async state(@Req() request: AuthenticatedRequest): Promise<AccountState> {
    return AccountStateSchema.parse(await this.accounts.state(principalOf(request)));
  }

  @Patch('/v1/account/profile')
  @ConsumerSession()
  async updateProfile(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<z.infer<typeof ProfileSchema> | undefined> {
    const input = parse(ProfileUpdateRequestSchema, body);
    return render(reply, await this.accounts.updateProfile(principalOf(request), input, idempotencyKey(request)), ProfileSchema);
  }

  @Get('/v1/account/sessions')
  @ConsumerSession({ restrictedOk: true })
  async listSessions(@Req() request: AuthenticatedRequest): Promise<SessionList> {
    return SessionListSchema.parse(await this.sessions.list(principalOf(request)));
  }

  @Delete('/v1/account/sessions/:sessionId')
  @HttpCode(204)
  @ConsumerSession({ restrictedOk: true })
  async revokeSession(@Param() params: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<undefined> {
    const parsed = SessionIdParamSchema.safeParse(params);
    // A malformed id cannot belong to the caller: same answer as a foreign id.
    if (!parsed.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    return render(reply, await this.sessions.revokeOne(principalOf(request), parsed.data.sessionId, idempotencyKey(request)));
  }

  @Post('/v1/account/session-revocations')
  @HttpCode(200)
  @ConsumerSession({ restrictedOk: true })
  async revokeSessions(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<z.infer<typeof SessionRevocationResultSchema> | undefined> {
    const { scope } = parse(SessionRevocationRequestSchema, body);
    return render(reply, await this.sessions.revokeMany(principalOf(request), scope, idempotencyKey(request)), SessionRevocationResultSchema);
  }

  @Get('/v1/account/security-events')
  @ConsumerSession({ restrictedOk: true })
  async securityEvents(@Req() request: AuthenticatedRequest): Promise<SecurityEventList> {
    return SecurityEventListSchema.parse(await this.accounts.securityEvents(principalOf(request)));
  }
}
