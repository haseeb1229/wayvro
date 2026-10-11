import { Body, Controller, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  AccountSummaryRequestSchema,
  AccountSupportSummarySchema,
  RecoveryAssistanceRequestSchema,
  RecoveryAssistanceSchema,
  SupportSessionRevocationRequestSchema,
  SupportSessionRevocationResultSchema,
} from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { StaffSession, staffOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { SUPPORT_SERVICE } from '../tokens.js';
import type { SupportService } from './support.service.js';

type Reply = FastifyReply;
const AccountParam = z.strictObject({ accountId: z.uuid() });
const RecoveryParam = z.strictObject({ id: z.uuid() });
/** Malformed or foreign ids are indistinguishable from unknown ones (404). */
function idParam<S extends z.ZodType>(schema: S, params: unknown): z.infer<S> {
  const p = schema.safeParse(params);
  if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return p.data;
}

/** Support / Trust & Safety account tools (Phase-2 closure; staff matrix §4). No list, search or export route. */
@Controller()
export class SupportController {
  constructor(@Inject(SUPPORT_SERVICE) private readonly support: SupportService) {}

  @Post('/v1/admin/account-summaries')
  @HttpCode(200)
  @StaffSession({ permission: 'account.summary.view_masked' })
  async summary(@Body() body: unknown, @Req() req: AuthenticatedRequest): Promise<z.infer<typeof AccountSupportSummarySchema>> {
    return AccountSupportSummarySchema.parse(await this.support.summary(staffOf(req), parse(AccountSummaryRequestSchema, body)));
  }

  @Post('/v1/admin/accounts/:accountId/session-revocations')
  @HttpCode(200)
  @StaffSession({ permission: 'account.sessions.revoke_on_behalf', stepUp: true })
  async revoke(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof SupportSessionRevocationResultSchema> | undefined> {
    const { accountId } = idParam(AccountParam, params);
    const input = parse(SupportSessionRevocationRequestSchema, body);
    return render(reply, await this.support.revokeSessions(staffOf(req), accountId, input, idempotencyKey(req)), SupportSessionRevocationResultSchema);
  }

  @Post('/v1/admin/account-recoveries/:id/assistance')
  @HttpCode(200)
  @StaffSession({ permission: 'account.recovery_case.open' })
  async assist(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RecoveryAssistanceSchema> | undefined> {
    const { id } = idParam(RecoveryParam, params);
    const input = parse(RecoveryAssistanceRequestSchema, body);
    return render(reply, await this.support.assistRecovery(staffOf(req), id, input, idempotencyKey(req)), RecoveryAssistanceSchema);
  }
}
