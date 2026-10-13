/**
 * Geo routes (Phase 3 P3.2). Consumer reads `/v1/geo/*` need a consumer session and are refused for restricted
 * accounts (no `restrictedOk`); responses are `Cache-Control: no-store` (global hook) and the access log records the
 * route template only (no query string, no placeRef). Staff routes `/v1/admin/geo/*` use the `geo.*` permissions;
 * every mutation needs a fresh step-up and an Idempotency-Key.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  AutocompleteQuerySchema,
  AutocompleteResultSchema,
  DecisionRequestSchema,
  EmptyRequestSchema,
  GeoBudgetDraftRequestSchema,
  GeoBudgetListSchema,
  GeoBudgetQuerySchema,
  GeoBudgetSchema,
  GeoUsageQuerySchema,
  GeoUsageSchema,
  IdParamSchema,
  LandmarkAliasDraftRequestSchema,
  LandmarkAliasListSchema,
  LandmarkAliasQuerySchema,
  LandmarkAliasSchema,
  PlaceQuerySchema,
  PlaceRefParamSchema,
  ResolvedPlaceSchema,
  ReverseGeocodeQuerySchema,
  ReverseGeocodeResultSchema,
  type AutocompleteResult,
  type GeoBudget,
  type GeoUsage,
  type LandmarkAlias,
  type ResolvedPlace,
  type ReverseGeocodeResult,
} from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { ConsumerSession, StaffSession, principalOf, staffOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { GEO_ADMIN_SERVICE, GEO_GATEWAY } from '../tokens.js';
import type { GeoAdminService } from './geo-admin.service.js';
import type { GeoGateway } from './gateway.js';

type Reply = FastifyReply;

/** Malformed or foreign ids are indistinguishable from unknown ones (404). */
function idOf(params: unknown): string {
  const p = IdParamSchema.safeParse(params);
  if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return p.data.id;
}

@Controller()
export class GeoController {
  constructor(@Inject(GEO_GATEWAY) private readonly gateway: GeoGateway) {}

  @Get('/v1/geo/autocomplete')
  @ConsumerSession()
  async autocomplete(@Query() query: unknown, @Req() req: AuthenticatedRequest): Promise<AutocompleteResult> {
    return AutocompleteResultSchema.parse(await this.gateway.autocomplete(principalOf(req).accountId, parse(AutocompleteQuerySchema, query)));
  }

  @Get('/v1/geo/places/:placeRef')
  @ConsumerSession()
  async resolve(@Param() params: unknown, @Query() query: unknown, @Req() req: AuthenticatedRequest): Promise<ResolvedPlace> {
    const p = PlaceRefParamSchema.safeParse(params);
    if (!p.success) throw new WayvroError('WAYVRO_E_VALIDATION', { details: { reasonCodes: ['PLACE_REF_INVALID'] } });
    return ResolvedPlaceSchema.parse(await this.gateway.resolvePlace(principalOf(req).accountId, p.data.placeRef, parse(PlaceQuerySchema, query)));
  }

  @Get('/v1/geo/reverse')
  @ConsumerSession()
  async reverse(@Query() query: unknown, @Req() req: AuthenticatedRequest): Promise<ReverseGeocodeResult> {
    return ReverseGeocodeResultSchema.parse(await this.gateway.reverse(principalOf(req).accountId, parse(ReverseGeocodeQuerySchema, query)));
  }
}

@Controller()
export class GeoAdminController {
  constructor(@Inject(GEO_ADMIN_SERVICE) private readonly admin: GeoAdminService) {}

  @Get('/v1/admin/geo/budgets')
  @StaffSession({ permission: 'geo.usage.view' })
  async listBudgets(@Query() query: unknown): Promise<z.infer<typeof GeoBudgetListSchema>> {
    return GeoBudgetListSchema.parse(await this.admin.listBudgets(parse(GeoBudgetQuerySchema, query)));
  }

  @Post('/v1/admin/geo/budgets')
  @StaffSession({ permission: 'geo.budget.draft', stepUp: true })
  async draftBudget(@Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<GeoBudget | undefined> {
    return render(reply, await this.admin.draftBudget(staffOf(req), parse(GeoBudgetDraftRequestSchema, body), idempotencyKey(req)), GeoBudgetSchema);
  }

  @Post('/v1/admin/geo/budgets/:id/submission')
  @HttpCode(200)
  @StaffSession({ permission: 'geo.budget.draft', stepUp: true })
  async submitBudget(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<GeoBudget | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.admin.submitBudget(staffOf(req), id, idempotencyKey(req)), GeoBudgetSchema);
  }

  @Post('/v1/admin/geo/budgets/:id/approval')
  @HttpCode(200)
  @StaffSession({ permission: 'geo.budget.approve', stepUp: true })
  async decideBudget(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<GeoBudget | undefined> {
    const id = idOf(params);
    const { decision } = parse(DecisionRequestSchema, body);
    return render(reply, await this.admin.decideBudget(staffOf(req), id, decision, idempotencyKey(req)), GeoBudgetSchema);
  }

  @Post('/v1/admin/geo/budgets/:id/activation')
  @HttpCode(200)
  @StaffSession({ permission: 'geo.budget.approve', stepUp: true })
  async activateBudget(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<GeoBudget | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.admin.activateBudget(staffOf(req), id, idempotencyKey(req)), GeoBudgetSchema);
  }

  @Post('/v1/admin/geo/budgets/:id/retirement')
  @HttpCode(200)
  @StaffSession({ permission: 'geo.budget.approve', stepUp: true })
  async retireBudget(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<GeoBudget | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.admin.retireBudget(staffOf(req), id, idempotencyKey(req)), GeoBudgetSchema);
  }

  @Get('/v1/admin/geo/usage')
  @StaffSession({ permission: 'geo.usage.view' })
  async usage(@Query() query: unknown): Promise<GeoUsage> {
    return GeoUsageSchema.parse(await this.admin.usage(parse(GeoUsageQuerySchema, query)));
  }

  @Get('/v1/admin/geo/landmark-aliases')
  @StaffSession({ permission: 'geo.usage.view' })
  async listAliases(@Query() query: unknown): Promise<z.infer<typeof LandmarkAliasListSchema>> {
    return LandmarkAliasListSchema.parse(await this.admin.listAliases(parse(LandmarkAliasQuerySchema, query)));
  }

  @Post('/v1/admin/geo/landmark-aliases')
  @StaffSession({ permission: 'geo.alias.draft', stepUp: true })
  async draftAlias(@Body() body: unknown, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: Reply): Promise<LandmarkAlias | undefined> {
    return render(reply, await this.admin.draftAlias(staffOf(req), parse(LandmarkAliasDraftRequestSchema, body), idempotencyKey(req)), LandmarkAliasSchema);
  }

  @Post('/v1/admin/geo/landmark-aliases/:id/approval')
  @HttpCode(200)
  @StaffSession({ permission: 'geo.alias.approve', stepUp: true })
  async decideAlias(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<LandmarkAlias | undefined> {
    const id = idOf(params);
    const { decision } = parse(DecisionRequestSchema, body);
    return render(reply, await this.admin.decideAlias(staffOf(req), id, decision, idempotencyKey(req)), LandmarkAliasSchema);
  }

  @Post('/v1/admin/geo/landmark-aliases/:id/retirement')
  @HttpCode(200)
  @StaffSession({ permission: 'geo.alias.approve', stepUp: true })
  async retireAlias(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<LandmarkAlias | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.admin.retireAlias(staffOf(req), id, idempotencyKey(req)), LandmarkAliasSchema);
  }
}
