import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  OidcAccountNonceRequestSchema,
  OidcLinkListSchema,
  OidcLinkParamSchema,
  OidcLinkSchema,
  OidcNonceSchema,
  OidcProofSchema,
  OidcSessionRequestSchema,
  OidcSignInNonceRequestSchema,
  SessionCreatedSchema,
} from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ConsumerSession, Public, principalOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { OIDC_SERVICE } from '../tokens.js';
import type { OidcService } from './oidc.service.js';

type Reply = FastifyReply;
type Out<S extends z.ZodType> = Promise<z.infer<S> | undefined>;

/** P2.10 Google/Apple OIDC linking (docs/phase2/PHASE2_API_AND_SURFACES.md §2; flag-gated per provider). */
@Controller()
export class OidcController {
  constructor(@Inject(OIDC_SERVICE) private readonly oidc: OidcService) {}

  @Post('/v1/auth/oidc-nonces')
  @Public()
  async signInNonce(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: Reply): Out<typeof OidcNonceSchema> {
    const { installationId } = parse(OidcSignInNonceRequestSchema, body);
    return render(reply, await this.oidc.signInNonce(installationId, idempotencyKey(req)), OidcNonceSchema);
  }

  @Post('/v1/auth/oidc-sessions')
  @Public()
  async signIn(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: Reply): Out<typeof SessionCreatedSchema> {
    const input = parse(OidcSessionRequestSchema, body);
    return render(reply, await this.oidc.signIn(input, idempotencyKey(req)), SessionCreatedSchema);
  }

  @Post('/v1/account/oidc-nonces')
  @ConsumerSession()
  async accountNonce(@Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Out<typeof OidcNonceSchema> {
    const { purpose } = parse(OidcAccountNonceRequestSchema, body);
    return render(reply, await this.oidc.accountNonce(principalOf(req), purpose, idempotencyKey(req)), OidcNonceSchema);
  }

  @Get('/v1/account/oidc-links')
  @ConsumerSession({ restrictedOk: true })
  async list(@Req() req: AuthenticatedRequest): Promise<z.infer<typeof OidcLinkListSchema>> {
    return OidcLinkListSchema.parse(await this.oidc.list(principalOf(req)));
  }

  @Post('/v1/account/oidc-links')
  @ConsumerSession()
  async link(@Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Out<typeof OidcLinkSchema> {
    const input = parse(OidcProofSchema, body);
    return render(reply, await this.oidc.link(principalOf(req), input, idempotencyKey(req)), OidcLinkSchema);
  }

  @Delete('/v1/account/oidc-links/:id')
  @HttpCode(204)
  @ConsumerSession({ restrictedOk: true })
  async unlink(@Param() params: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<undefined> {
    const p = OidcLinkParamSchema.safeParse(params);
    if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    return render(reply, await this.oidc.unlink(principalOf(req), p.data.id, idempotencyKey(req)));
  }
}
