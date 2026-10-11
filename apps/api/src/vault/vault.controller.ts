import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  ApplicationIdParamSchema,
  EmptyRequestSchema,
  EvidenceAccessLogQuerySchema,
  EvidenceAccessLogSchema,
  EvidenceListSchema,
  EvidenceUploadRequestSchema,
  EvidenceUploadSlotSchema,
  EvidenceUploadStatusSchema,
  EvidenceViewRequestSchema,
  EvidenceViewSchema,
  UploadIdParamSchema,
  ViewTokenParamSchema,
} from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { ConsumerSession, StaffSession, principalOf, staffOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { EVIDENCE_SERVICES } from '../tokens.js';
import type { EvidenceViewService } from './evidence-view.service.js';
import type { EvidenceService } from './evidence.service.js';

/** Bound only when the vault database role and object storage are configured (otherwise every route answers 503). */
export interface EvidenceServices {
  readonly evidence: EvidenceService;
  readonly views: EvidenceViewService;
}

type Reply = FastifyReply;
/** Malformed or foreign ids are indistinguishable from unknown ones (404). */
function idParam<S extends z.ZodType>(schema: S, params: unknown): z.infer<S> {
  const p = schema.safeParse(params);
  if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return p.data;
}
function configured(services: EvidenceServices | null): EvidenceServices {
  if (!services) throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE');
  return services;
}

/** Applicant evidence routes of the ONE app (owner-scoped; storage keys never leave the vault module). */
@Controller()
export class EvidenceController {
  constructor(@Inject(EVIDENCE_SERVICES) private readonly services: EvidenceServices | null) {}

  @Post('/v1/driver-onboarding/applications/:id/evidence-uploads')
  @ConsumerSession()
  async slot(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof EvidenceUploadSlotSchema> | undefined> {
    const { id } = idParam(ApplicationIdParamSchema, params);
    const input = parse(EvidenceUploadRequestSchema, body);
    return render(reply, await configured(this.services).evidence.issueSlot(principalOf(req), id, input, idempotencyKey(req)), EvidenceUploadSlotSchema);
  }

  @Get('/v1/driver-onboarding/applications/:id/evidence')
  @ConsumerSession()
  async list(@Param() params: unknown, @Req() req: AuthenticatedRequest): Promise<z.infer<typeof EvidenceListSchema>> {
    const { id } = idParam(ApplicationIdParamSchema, params);
    return EvidenceListSchema.parse(await configured(this.services).evidence.list(principalOf(req), id));
  }

  @Post('/v1/driver-onboarding/evidence-uploads/:uploadId/completion')
  @HttpCode(200)
  @ConsumerSession()
  async complete(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof EvidenceUploadStatusSchema> | undefined> {
    const { uploadId } = idParam(UploadIdParamSchema, params);
    parse(EmptyRequestSchema, body ?? {});
    return render(reply, await configured(this.services).evidence.complete(principalOf(req), uploadId, idempotencyKey(req)), EvidenceUploadStatusSchema);
  }

  @Delete('/v1/driver-onboarding/evidence-uploads/:uploadId')
  @ConsumerSession()
  async discard(@Param() params: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<void> {
    const { uploadId } = idParam(UploadIdParamSchema, params);
    render(reply, await configured(this.services).evidence.discard(principalOf(req), uploadId, idempotencyKey(req)));
  }
}

/** Staff evidence views through the web-ops BFF: one-time, session-bound, reasoned, logged; never a download. */
@Controller()
export class EvidenceViewController {
  constructor(@Inject(EVIDENCE_SERVICES) private readonly services: EvidenceServices | null) {}

  @Post('/v1/admin/evidence-views')
  @StaffSession({ permission: 'vault.evidence.view', stepUp: true })
  async issue(@Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<z.infer<typeof EvidenceViewSchema>> {
    const input = parse(EvidenceViewRequestSchema, body);
    const view = await configured(this.services).views.issue(staffOf(req), input);
    void reply.status(201);
    return EvidenceViewSchema.parse(view);
  }

  @Get('/v1/admin/evidence-access-log')
  @StaffSession({ permission: 'audit.evidence_access.view' })
  async accessLog(@Query() query: unknown): Promise<z.infer<typeof EvidenceAccessLogSchema>> {
    return EvidenceAccessLogSchema.parse(await configured(this.services).views.accessLog(parse(EvidenceAccessLogQuerySchema, query)));
  }

  @Get('/v1/admin/evidence-views/:token/content')
  @StaffSession({ permission: 'vault.evidence.view' })
  async content(@Param() params: unknown, @Req() req: AuthenticatedRequest, @Res() reply: Reply): Promise<void> {
    const { token } = idParam(ViewTokenParamSchema, params);
    const image = await configured(this.services).views.content(staffOf(req), token);
    await reply
      .status(200)
      .header('content-type', image.contentType)
      .header('cache-control', 'no-store, max-age=0')
      .header('pragma', 'no-cache')
      .header('content-disposition', 'inline')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(image.bytes);
  }
}
