import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  CatalogCityQuerySchema,
  CatalogDecisionRequestSchema,
  CatalogProductListSchema,
  CatalogProductsQuerySchema,
  CityProductEnableDecisionSchema,
  CityProductEnableRequestSchema,
  CityProductListSchema,
  CityProductSchema,
  CityProductSuspendRequestSchema,
  EligibilityRuleDraftRequestSchema,
  EligibilityRuleListSchema,
  EligibilityRuleSchema,
  EmptyRequestSchema,
  IdParamSchema,
  ServiceHoursReplaceRequestSchema,
  ZoneImportRequestSchema,
  ZoneImportResultSchema,
  ZoneSetDraftRequestSchema,
  ZoneSetListSchema,
  ZoneSetSchema,
  type CatalogProductList,
} from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { ConsumerSession, StaffSession, staffOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { CATALOG_SERVICES } from '../tokens.js';
import type { CatalogAdminService } from './catalog-admin.service.js';
import type { CatalogReadModel } from './catalog-read-model.js';

type Reply = FastifyReply;

/** The catalog module's services handed to the controllers (and, via the read model, to other modules). */
export interface CatalogServices {
  readonly readModel: CatalogReadModel;
  readonly admin: CatalogAdminService;
}

/** Malformed ids are indistinguishable from unknown ones (404). */
function id(params: unknown): string {
  const p = IdParamSchema.safeParse(params);
  if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return p.data.id;
}
function found<T>(value: unknown, schema: z.ZodType<T>): T {
  if (value === null) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return schema.parse(value);
}

/** `GET /v1/catalog/products` — the ONE app's product list (ENABLED only, display data, no prices). */
@Controller()
export class CatalogController {
  constructor(@Inject(CATALOG_SERVICES) private readonly catalog: CatalogServices) {}

  @Get('/v1/catalog/products')
  @ConsumerSession()
  async products(@Query() query: unknown): Promise<CatalogProductList> {
    const { cityCode } = parse(CatalogProductsQuerySchema, query);
    return CatalogProductListSchema.parse({ cityCode, products: await this.catalog.readModel.productsForCity(cityCode) });
  }
}

/** Staff: zone sets, eligibility rules and city-product enablement (maker-checker; step-up on approve/activate/suspend). */
@Controller()
export class CatalogAdminController {
  constructor(@Inject(CATALOG_SERVICES) private readonly catalog: CatalogServices) {}

  // ── zone sets ──
  @Get('/v1/admin/catalog/zone-sets')
  @StaffSession({ permission: 'catalog.view' })
  async listZoneSets(@Query() query: unknown): Promise<z.infer<typeof ZoneSetListSchema>> {
    return ZoneSetListSchema.parse(await this.catalog.admin.listZoneSets(parse(CatalogCityQuerySchema, query).cityCode));
  }

  @Get('/v1/admin/catalog/zone-sets/:id')
  @StaffSession({ permission: 'catalog.view' })
  async getZoneSet(@Param() params: unknown): Promise<z.infer<typeof ZoneSetSchema>> {
    return found(await this.catalog.admin.getZoneSet(id(params)), ZoneSetSchema);
  }

  @Post('/v1/admin/catalog/zone-sets')
  @StaffSession({ permission: 'catalog.zone_set.draft' })
  async draftZoneSet(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof ZoneSetSchema> | undefined> {
    return render(reply, await this.catalog.admin.draftZoneSet(staffOf(req), parse(ZoneSetDraftRequestSchema, body), idempotencyKey(req)), ZoneSetSchema);
  }

  @Post('/v1/admin/catalog/zone-sets/:id/zone-imports')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.zone_set.draft' })
  async importZones(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof ZoneImportResultSchema> | undefined> {
    const zoneSetId = id(params);
    const { featureCollection } = parse(ZoneImportRequestSchema, body);
    return render(reply, await this.catalog.admin.importZones(staffOf(req), zoneSetId, featureCollection, idempotencyKey(req)), ZoneImportResultSchema);
  }

  @Post('/v1/admin/catalog/zone-sets/:id/service-hours')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.zone_set.draft' })
  async replaceHours(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof ZoneSetSchema> | undefined> {
    const zoneSetId = id(params);
    const { hours } = parse(ServiceHoursReplaceRequestSchema, body);
    return render(reply, await this.catalog.admin.replaceServiceHours(staffOf(req), zoneSetId, hours, idempotencyKey(req)), ZoneSetSchema);
  }

  @Post('/v1/admin/catalog/zone-sets/:id/submission')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.zone_set.draft' })
  async submitZoneSet(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof ZoneSetSchema> | undefined> {
    const zoneSetId = id(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.catalog.admin.submitZoneSet(staffOf(req), zoneSetId, idempotencyKey(req)), ZoneSetSchema);
  }

  @Post('/v1/admin/catalog/zone-sets/:id/approval')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.zone_set.approve', stepUp: true })
  async decideZoneSet(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof ZoneSetSchema> | undefined> {
    const zoneSetId = id(params);
    const { decision, reasonCode } = parse(CatalogDecisionRequestSchema, body);
    return render(reply, await this.catalog.admin.decideZoneSet(staffOf(req), zoneSetId, decision, reasonCode, idempotencyKey(req)), ZoneSetSchema);
  }

  @Post('/v1/admin/catalog/zone-sets/:id/activation')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.zone_set.activate', stepUp: true })
  async activateZoneSet(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof ZoneSetSchema> | undefined> {
    const zoneSetId = id(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.catalog.admin.activateZoneSet(staffOf(req), zoneSetId, idempotencyKey(req)), ZoneSetSchema);
  }

  @Post('/v1/admin/catalog/zone-sets/:id/retirement')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.zone_set.activate', stepUp: true })
  async retireZoneSet(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof ZoneSetSchema> | undefined> {
    const zoneSetId = id(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.catalog.admin.retireZoneSet(staffOf(req), zoneSetId, idempotencyKey(req)), ZoneSetSchema);
  }

  @Post('/v1/admin/catalog/zone-sets/:id/clones')
  @StaffSession({ permission: 'catalog.zone_set.draft' })
  async cloneZoneSet(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof ZoneSetSchema> | undefined> {
    const zoneSetId = id(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.catalog.admin.cloneZoneSet(staffOf(req), zoneSetId, idempotencyKey(req)), ZoneSetSchema);
  }

  // ── eligibility rules ──
  @Get('/v1/admin/catalog/eligibility-rules')
  @StaffSession({ permission: 'catalog.view' })
  async listRules(@Query() query: unknown): Promise<z.infer<typeof EligibilityRuleListSchema>> {
    return EligibilityRuleListSchema.parse(await this.catalog.admin.listRules(parse(CatalogCityQuerySchema, query).cityCode));
  }

  @Get('/v1/admin/catalog/eligibility-rules/:id')
  @StaffSession({ permission: 'catalog.view' })
  async getRule(@Param() params: unknown): Promise<z.infer<typeof EligibilityRuleSchema>> {
    return found(await this.catalog.admin.getRule(id(params)), EligibilityRuleSchema);
  }

  @Post('/v1/admin/catalog/eligibility-rules')
  @StaffSession({ permission: 'catalog.eligibility_rule.draft' })
  async draftRule(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof EligibilityRuleSchema> | undefined> {
    return render(
      reply,
      await this.catalog.admin.draftRule(staffOf(req), parse(EligibilityRuleDraftRequestSchema, body), idempotencyKey(req)),
      EligibilityRuleSchema,
    );
  }

  @Post('/v1/admin/catalog/eligibility-rules/:id/submission')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.eligibility_rule.draft' })
  async submitRule(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof EligibilityRuleSchema> | undefined> {
    const ruleId = id(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.catalog.admin.submitRule(staffOf(req), ruleId, idempotencyKey(req)), EligibilityRuleSchema);
  }

  @Post('/v1/admin/catalog/eligibility-rules/:id/approval')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.eligibility_rule.approve', stepUp: true })
  async decideRule(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof EligibilityRuleSchema> | undefined> {
    const ruleId = id(params);
    const { decision, reasonCode } = parse(CatalogDecisionRequestSchema, body);
    return render(reply, await this.catalog.admin.decideRule(staffOf(req), ruleId, decision, reasonCode, idempotencyKey(req)), EligibilityRuleSchema);
  }

  @Post('/v1/admin/catalog/eligibility-rules/:id/activation')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.eligibility_rule.activate', stepUp: true })
  async activateRule(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof EligibilityRuleSchema> | undefined> {
    const ruleId = id(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.catalog.admin.activateRule(staffOf(req), ruleId, idempotencyKey(req)), EligibilityRuleSchema);
  }

  @Post('/v1/admin/catalog/eligibility-rules/:id/retirement')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.eligibility_rule.activate', stepUp: true })
  async retireRule(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof EligibilityRuleSchema> | undefined> {
    const ruleId = id(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.catalog.admin.retireRule(staffOf(req), ruleId, idempotencyKey(req)), EligibilityRuleSchema);
  }

  @Post('/v1/admin/catalog/eligibility-rules/:id/clones')
  @StaffSession({ permission: 'catalog.eligibility_rule.draft' })
  async cloneRule(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof EligibilityRuleSchema> | undefined> {
    const ruleId = id(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.catalog.admin.cloneRule(staffOf(req), ruleId, idempotencyKey(req)), EligibilityRuleSchema);
  }

  // ── city products ──
  @Get('/v1/admin/catalog/city-products')
  @StaffSession({ permission: 'catalog.view' })
  async listCityProducts(@Query() query: unknown): Promise<z.infer<typeof CityProductListSchema>> {
    return CityProductListSchema.parse(await this.catalog.admin.listCityProducts(parse(CatalogCityQuerySchema, query).cityCode));
  }

  @Post('/v1/admin/catalog/city-products/enable-requests')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.product.enable_request', stepUp: true })
  async requestEnable(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof CityProductSchema> | undefined> {
    return render(
      reply,
      await this.catalog.admin.requestEnable(staffOf(req), parse(CityProductEnableRequestSchema, body), idempotencyKey(req)),
      CityProductSchema,
    );
  }

  @Post('/v1/admin/catalog/city-products/enable-decisions')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.product.enable_approve', stepUp: true })
  async decideEnable(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof CityProductSchema> | undefined> {
    return render(
      reply,
      await this.catalog.admin.decideEnable(staffOf(req), parse(CityProductEnableDecisionSchema, body), idempotencyKey(req)),
      CityProductSchema,
    );
  }

  @Post('/v1/admin/catalog/city-products/suspensions')
  @HttpCode(200)
  @StaffSession({ permission: 'catalog.product.suspend', stepUp: true })
  async suspend(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof CityProductSchema> | undefined> {
    return render(reply, await this.catalog.admin.suspend(staffOf(req), parse(CityProductSuspendRequestSchema, body), idempotencyKey(req)), CityProductSchema);
  }
}
