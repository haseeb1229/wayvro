import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  APP_VERSION_HEADER,
  AppConfigSchema,
  AppVersionHeaderSchema,
  AppVersionPolicyActivationRequestSchema,
  AppVersionPolicyDecisionRequestSchema,
  AppVersionPolicyDraftRequestSchema,
  AppVersionPolicyListQuerySchema,
  AppVersionPolicyListSchema,
  AppVersionPolicyPreviewSchema,
  AppVersionPolicyRevisionRequestSchema,
  AppVersionPolicySchema,
  EmptyRequestSchema,
  IdParamSchema,
  RuntimeSwitchChangeListSchema,
  RuntimeSwitchChangeQuerySchema,
  RuntimeSwitchChangeSchema,
  RuntimeSwitchListSchema,
  RuntimeSwitchRestoreDecisionSchema,
  RuntimeSwitchRestoreRequestSchema,
  RuntimeSwitchSafeStateRequestSchema,
  type AppConfig,
} from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { Public, StaffSession, staffOf, type AuthenticatedRequest } from '../../auth/policy.js';
import { idempotencyKey, parse, render } from '../../http/respond.js';
import { RELEASE_SERVICES } from '../../tokens.js';
import { etagMatches, type AppConfigService } from './app-config.service.js';
import { readAppClient } from './enforcement.js';
import type { AppPolicyAdminService } from './policy-admin.service.js';
import type { RuntimeSwitchAdminService } from './switch-admin.service.js';

/** Release-control services (P3.4). */
export interface ReleaseServices {
  readonly appConfig: AppConfigService;
  readonly policies: AppPolicyAdminService;
  readonly switches: RuntimeSwitchAdminService;
  /** HTTP max-age of `GET /v1/app/config` (APP_CONFIG_CACHE_SECONDS). */
  readonly appConfigCacheSeconds: number;
}

type Reply = FastifyReply;
/** Malformed or foreign ids are indistinguishable from unknown ones (404). */
function idOf(params: unknown): string {
  const p = IdParamSchema.safeParse(params);
  if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return p.data.id;
}

/** `GET /v1/app/config` — public, cacheable, rate-limited per IP prefix (ADR-049). */
@Controller()
export class AppConfigController {
  constructor(@Inject(RELEASE_SERVICES) private readonly release: ReleaseServices) {}

  @Get('/v1/app/config')
  @Public()
  async get(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<AppConfig | undefined> {
    const headers = readAppClient(req.headers);
    const version = req.headers[APP_VERSION_HEADER];
    // present-but-malformed compatibility headers are a client bug: 400 (absent headers evaluate as OK)
    if (headers.kind === 'INVALID' || (version !== undefined && !AppVersionHeaderSchema.safeParse(version).success))
      throw new WayvroError('WAYVRO_E_VALIDATION');
    await this.release.appConfig.admit(req.ip);
    const result = await this.release.appConfig.build(headers.kind === 'PRESENT' ? headers.client : null);
    // overrides the API-wide no-store for this route only; stale (last-known) answers are never cached
    void reply.header('cache-control', result.stale ? 'no-store' : `public, max-age=${String(this.release.appConfigCacheSeconds)}`);
    void reply.header('vary', 'x-wayvro-platform, x-wayvro-app-build');
    void reply.header('etag', result.etag);
    if (result.stale) void reply.header('x-wayvro-config-stale', '1');
    const ifNoneMatch = req.headers['if-none-match'];
    if (!result.stale && etagMatches(typeof ifNoneMatch === 'string' ? ifNoneMatch : undefined, result.etag)) {
      void reply.status(304);
      return undefined;
    }
    return AppConfigSchema.parse(result.body);
  }
}

/** `/v1/admin/release/policies*` and `/v1/admin/switches*` — RELEASE_MANAGER (AUDITOR read-only). */
@Controller()
export class ReleaseAdminController {
  constructor(@Inject(RELEASE_SERVICES) private readonly release: ReleaseServices) {}

  @Get('/v1/admin/release/policies')
  @StaffSession({ permission: 'release.view' })
  async list(@Query() query: unknown): Promise<z.infer<typeof AppVersionPolicyListSchema>> {
    return AppVersionPolicyListSchema.parse(await this.release.policies.list(parse(AppVersionPolicyListQuerySchema, query).platform));
  }

  @Post('/v1/admin/release/policies')
  @StaffSession({ permission: 'release.policy.draft', stepUp: true })
  async draft(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof AppVersionPolicySchema> | undefined> {
    const input = parse(AppVersionPolicyDraftRequestSchema, body);
    return render(reply, await this.release.policies.draft(staffOf(req), input, idempotencyKey(req)), AppVersionPolicySchema);
  }

  @Get('/v1/admin/release/policies/:id')
  @StaffSession({ permission: 'release.view' })
  async get(@Param() params: unknown): Promise<z.infer<typeof AppVersionPolicySchema>> {
    const policy = await this.release.policies.get(idOf(params));
    if (!policy) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    return AppVersionPolicySchema.parse(policy);
  }

  @Get('/v1/admin/release/policies/:id/preview')
  @StaffSession({ permission: 'release.view' })
  async preview(@Param() params: unknown): Promise<z.infer<typeof AppVersionPolicyPreviewSchema>> {
    const preview = await this.release.policies.preview(idOf(params));
    if (!preview) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    return AppVersionPolicyPreviewSchema.parse(preview);
  }

  @Post('/v1/admin/release/policies/:id/revision')
  @HttpCode(200)
  @StaffSession({ permission: 'release.policy.draft', stepUp: true })
  async revise(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof AppVersionPolicySchema> | undefined> {
    const id = idOf(params);
    const input = parse(AppVersionPolicyRevisionRequestSchema, body);
    return render(reply, await this.release.policies.revise(staffOf(req), id, input, idempotencyKey(req)), AppVersionPolicySchema);
  }

  @Post('/v1/admin/release/policies/:id/submission')
  @HttpCode(200)
  @StaffSession({ permission: 'release.policy.draft', stepUp: true })
  async submit(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof AppVersionPolicySchema> | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.release.policies.submit(staffOf(req), id, idempotencyKey(req)), AppVersionPolicySchema);
  }

  @Post('/v1/admin/release/policies/:id/approval')
  @HttpCode(200)
  @StaffSession({ permission: 'release.policy.approve', stepUp: true })
  async decide(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof AppVersionPolicySchema> | undefined> {
    const id = idOf(params);
    const { decision } = parse(AppVersionPolicyDecisionRequestSchema, body);
    return render(reply, await this.release.policies.decide(staffOf(req), id, decision, idempotencyKey(req)), AppVersionPolicySchema);
  }

  @Post('/v1/admin/release/policies/:id/activation')
  @HttpCode(200)
  @StaffSession({ permission: 'release.policy.activate', stepUp: true })
  async activate(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof AppVersionPolicySchema> | undefined> {
    const id = idOf(params);
    const request = parse(AppVersionPolicyActivationRequestSchema, body);
    return render(reply, await this.release.policies.activate(staffOf(req), id, request, idempotencyKey(req)), AppVersionPolicySchema);
  }

  @Post('/v1/admin/release/policies/:id/schedule-cancellation')
  @HttpCode(200)
  @StaffSession({ permission: 'release.policy.activate', stepUp: true })
  async cancelSchedule(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof AppVersionPolicySchema> | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.release.policies.cancelSchedule(staffOf(req), id, idempotencyKey(req)), AppVersionPolicySchema);
  }

  @Post('/v1/admin/release/policies/:id/retirement')
  @HttpCode(200)
  @StaffSession({ permission: 'release.policy.activate', stepUp: true })
  async retire(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof AppVersionPolicySchema> | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.release.policies.retire(staffOf(req), id, idempotencyKey(req)), AppVersionPolicySchema);
  }

  @Get('/v1/admin/switches')
  @StaffSession({ permission: 'release.view' })
  async switches(): Promise<z.infer<typeof RuntimeSwitchListSchema>> {
    return RuntimeSwitchListSchema.parse(await this.release.switches.list());
  }

  @Get('/v1/admin/switches/changes')
  @StaffSession({ permission: 'release.view' })
  async changes(@Query() query: unknown): Promise<z.infer<typeof RuntimeSwitchChangeListSchema>> {
    return RuntimeSwitchChangeListSchema.parse(await this.release.switches.changes(parse(RuntimeSwitchChangeQuerySchema, query).cursor));
  }

  @Post('/v1/admin/switches/safe-state-changes')
  @StaffSession({ permission: 'platform.switch.disable', stepUp: true })
  async toSafe(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RuntimeSwitchChangeSchema> | undefined> {
    const input = parse(RuntimeSwitchSafeStateRequestSchema, body);
    return render(reply, await this.release.switches.moveToSafe(staffOf(req), input, idempotencyKey(req)), RuntimeSwitchChangeSchema);
  }

  @Post('/v1/admin/switches/restore-requests')
  @StaffSession({ permission: 'platform.switch.enable_request', stepUp: true })
  async restoreRequest(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RuntimeSwitchChangeSchema> | undefined> {
    const input = parse(RuntimeSwitchRestoreRequestSchema, body);
    return render(reply, await this.release.switches.requestRestore(staffOf(req), input, idempotencyKey(req)), RuntimeSwitchChangeSchema);
  }

  @Post('/v1/admin/switches/restore-requests/:id/approval')
  @HttpCode(200)
  @StaffSession({ permission: 'platform.switch.enable_approve', stepUp: true })
  async decideRestore(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RuntimeSwitchChangeSchema> | undefined> {
    const id = idOf(params);
    const { decision } = parse(RuntimeSwitchRestoreDecisionSchema, body);
    return render(reply, await this.release.switches.decideRestore(staffOf(req), id, decision, idempotencyKey(req)), RuntimeSwitchChangeSchema);
  }
}
