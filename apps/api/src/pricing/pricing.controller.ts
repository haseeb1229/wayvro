/**
 * Pricing routes (P3.3). Consumer: `POST /v1/quotes` (session, Idempotency-Key, strict body — a client fare, total,
 * distance, duration or component is a 400, never read) and `GET /v1/quotes/{quoteGroupId}` (owner only; foreign and
 * unknown ids are the same 404). Staff `/v1/admin/pricing/*` use the `pricing.*` permissions (PRICING_MANAGER; AUDITOR
 * reads); approvals, activation and rollback need a fresh step-up; every mutation needs an Idempotency-Key.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  EmptyRequestSchema,
  IdParamSchema,
  PricingDecisionRequestSchema,
  PricingPreviewRequestSchema,
  PricingPreviewSchema,
  QuoteDetailQuerySchema,
  QuoteGroupParamSchema,
  QuoteGroupSchema,
  QuoteLookupRequestSchema,
  QuoteRequestSchema,
  RateCardActivationRequestSchema,
  RateCardDraftRequestSchema,
  RateCardListQuerySchema,
  RateCardListSchema,
  RateCardSchema,
  RateCardSubmissionRequestSchema,
  RateCardValuesRequestSchema,
  StaffQuoteViewSchema,
  TaxPolicyDraftRequestSchema,
  TaxPolicyListSchema,
  TaxPolicySchema,
  type QuoteGroup,
} from '@wayvro/contracts';
import { WayvroError, type Logger } from '@wayvro/observability';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { ConsumerSession, StaffSession, principalOf, staffOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { PRICING_SERVICES } from '../tokens.js';
import type { PricingAdminService } from './pricing-admin.service.js';
import type { QuoteService } from './quote.service.js';

type Reply = FastifyReply;

/** The pricing module's services handed to the controllers. */
export interface PricingServices {
  readonly quotes: QuoteService;
  readonly admin: PricingAdminService;
  readonly log: Logger;
}

/** Malformed ids are indistinguishable from unknown ones (404). */
function idOf(params: unknown): string {
  const p = IdParamSchema.safeParse(params);
  if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return p.data.id;
}
function found<T>(value: unknown, schema: z.ZodType<T>): T {
  if (value === null) throw new WayvroError('WAYVRO_E_NOT_FOUND');
  return schema.parse(value);
}

@Controller()
export class QuoteController {
  constructor(@Inject(PRICING_SERVICES) private readonly pricing: PricingServices) {}

  @Post('/v1/quotes')
  @ConsumerSession()
  async create(
    @Body() body: unknown,
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<QuoteGroup | undefined> {
    const principal = principalOf(req);
    const request = QuoteRequestSchema.safeParse(body);
    if (!request.success) {
      // T3-03: counted per request (no body, no field values are logged)
      this.pricing.log.warn({ signal: 'QUOTE_SCHEMA_REJECTED' }, 'quote request rejected by the strict schema');
      throw new WayvroError('WAYVRO_E_VALIDATION');
    }
    const { detail } = parse(QuoteDetailQuerySchema, query);
    const result = await this.pricing.quotes.create({
      accountId: principal.accountId,
      request: request.data,
      detail: detail ?? 'full',
      key: idempotencyKey(req),
      clientIp: req.ip,
    });
    return render(reply, result, QuoteGroupSchema);
  }

  @Get('/v1/quotes/:quoteGroupId')
  @ConsumerSession()
  async restore(@Param() params: unknown, @Query() query: unknown, @Req() req: AuthenticatedRequest): Promise<QuoteGroup> {
    const p = QuoteGroupParamSchema.safeParse(params);
    if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    const { detail } = parse(QuoteDetailQuerySchema, query);
    return found(await this.pricing.quotes.restore(principalOf(req).accountId, p.data.quoteGroupId, detail === 'lite'), QuoteGroupSchema);
  }
}

@Controller()
export class PricingAdminController {
  constructor(@Inject(PRICING_SERVICES) private readonly pricing: PricingServices) {}

  // ── tax policies ──
  @Get('/v1/admin/pricing/tax-policies')
  @StaffSession({ permission: 'pricing.view' })
  async listTaxPolicies(): Promise<z.infer<typeof TaxPolicyListSchema>> {
    return TaxPolicyListSchema.parse(await this.pricing.admin.listTaxPolicies());
  }

  @Get('/v1/admin/pricing/tax-policies/:id')
  @StaffSession({ permission: 'pricing.view' })
  async getTaxPolicy(@Param() params: unknown): Promise<z.infer<typeof TaxPolicySchema>> {
    return found(await this.pricing.admin.getTaxPolicy(idOf(params)), TaxPolicySchema);
  }

  @Post('/v1/admin/pricing/tax-policies')
  @StaffSession({ permission: 'pricing.tax_policy.draft' })
  async draftTaxPolicy(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof TaxPolicySchema> | undefined> {
    return render(reply, await this.pricing.admin.draftTaxPolicy(staffOf(req), parse(TaxPolicyDraftRequestSchema, body), idempotencyKey(req)), TaxPolicySchema);
  }

  @Post('/v1/admin/pricing/tax-policies/:id/submission')
  @HttpCode(200)
  @StaffSession({ permission: 'pricing.tax_policy.draft' })
  async submitTaxPolicy(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof TaxPolicySchema> | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.pricing.admin.submitTaxPolicy(staffOf(req), id, idempotencyKey(req)), TaxPolicySchema);
  }

  @Post('/v1/admin/pricing/tax-policies/:id/approval')
  @HttpCode(200)
  @StaffSession({ permission: 'pricing.tax_policy.approve', stepUp: true })
  async decideTaxPolicy(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof TaxPolicySchema> | undefined> {
    const id = idOf(params);
    const { decision, reasonCode } = parse(PricingDecisionRequestSchema, body);
    return render(reply, await this.pricing.admin.decideTaxPolicy(staffOf(req), id, decision, reasonCode, idempotencyKey(req)), TaxPolicySchema);
  }

  @Post('/v1/admin/pricing/tax-policies/:id/retirement')
  @HttpCode(200)
  @StaffSession({ permission: 'pricing.tax_policy.approve', stepUp: true })
  async retireTaxPolicy(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof TaxPolicySchema> | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.pricing.admin.retireTaxPolicy(staffOf(req), id, idempotencyKey(req)), TaxPolicySchema);
  }

  // ── rate cards ──
  @Get('/v1/admin/pricing/rate-cards')
  @StaffSession({ permission: 'pricing.view' })
  async listRateCards(@Query() query: unknown): Promise<z.infer<typeof RateCardListSchema>> {
    const { cityCode, productCode } = parse(RateCardListQuerySchema, query);
    return RateCardListSchema.parse(await this.pricing.admin.listRateCards(cityCode, productCode));
  }

  @Get('/v1/admin/pricing/rate-cards/:id')
  @StaffSession({ permission: 'pricing.view' })
  async getRateCard(@Param() params: unknown): Promise<z.infer<typeof RateCardSchema>> {
    return found(await this.pricing.admin.getRateCard(idOf(params)), RateCardSchema);
  }

  @Post('/v1/admin/pricing/rate-cards')
  @StaffSession({ permission: 'pricing.rate_card.draft' })
  async draftRateCard(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RateCardSchema> | undefined> {
    return render(reply, await this.pricing.admin.draftRateCard(staffOf(req), parse(RateCardDraftRequestSchema, body), idempotencyKey(req)), RateCardSchema);
  }

  @Post('/v1/admin/pricing/rate-cards/:id/values')
  @HttpCode(200)
  @StaffSession({ permission: 'pricing.rate_card.draft' })
  async replaceValues(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RateCardSchema> | undefined> {
    const id = idOf(params);
    const { values } = parse(RateCardValuesRequestSchema, body);
    return render(reply, await this.pricing.admin.replaceValues(staffOf(req), id, values, idempotencyKey(req)), RateCardSchema);
  }

  @Post('/v1/admin/pricing/rate-cards/:id/clones')
  @StaffSession({ permission: 'pricing.rate_card.draft' })
  async cloneRateCard(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RateCardSchema> | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.pricing.admin.cloneRateCard(staffOf(req), id, idempotencyKey(req)), RateCardSchema);
  }

  @Post('/v1/admin/pricing/rate-cards/:id/submission')
  @HttpCode(200)
  @StaffSession({ permission: 'pricing.rate_card.submit' })
  async submitRateCard(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RateCardSchema> | undefined> {
    const id = idOf(params);
    const { envelopeOverrideReasonCode } = parse(RateCardSubmissionRequestSchema, body);
    return render(reply, await this.pricing.admin.submitRateCard(staffOf(req), id, envelopeOverrideReasonCode, idempotencyKey(req)), RateCardSchema);
  }

  @Post('/v1/admin/pricing/rate-cards/:id/approval')
  @HttpCode(200)
  @StaffSession({ permission: 'pricing.rate_card.approve', stepUp: true })
  async decideRateCard(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RateCardSchema> | undefined> {
    const id = idOf(params);
    const { decision, reasonCode } = parse(PricingDecisionRequestSchema, body);
    return render(reply, await this.pricing.admin.decideRateCard(staffOf(req), id, decision, reasonCode, idempotencyKey(req)), RateCardSchema);
  }

  @Post('/v1/admin/pricing/rate-cards/:id/activation')
  @HttpCode(200)
  @StaffSession({ permission: 'pricing.rate_card.activate', stepUp: true })
  async activateRateCard(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RateCardSchema> | undefined> {
    const id = idOf(params);
    const request = parse(RateCardActivationRequestSchema, body);
    return render(reply, await this.pricing.admin.activateRateCard(staffOf(req), id, request, idempotencyKey(req)), RateCardSchema);
  }

  @Post('/v1/admin/pricing/rate-cards/:id/schedule-cancellation')
  @HttpCode(200)
  @StaffSession({ permission: 'pricing.rate_card.activate', stepUp: true })
  async cancelSchedule(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RateCardSchema> | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.pricing.admin.cancelSchedule(staffOf(req), id, idempotencyKey(req)), RateCardSchema);
  }

  @Post('/v1/admin/pricing/rate-cards/:id/rollbacks')
  @StaffSession({ permission: 'pricing.rate_card.rollback', stepUp: true })
  async rollbackRateCard(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<z.infer<typeof RateCardSchema> | undefined> {
    const id = idOf(params);
    parse(EmptyRequestSchema, body);
    return render(reply, await this.pricing.admin.rollbackRateCard(staffOf(req), id, idempotencyKey(req)), RateCardSchema);
  }

  // ── previews and support lookup (reads with a recorded purpose; audited, nothing else persisted) ──
  @Post('/v1/admin/pricing/previews')
  @HttpCode(200)
  @StaffSession({ permission: 'pricing.preview' })
  async preview(@Body() body: unknown, @Req() req: AuthenticatedRequest): Promise<z.infer<typeof PricingPreviewSchema>> {
    return found(await this.pricing.admin.preview(staffOf(req), parse(PricingPreviewRequestSchema, body)), PricingPreviewSchema);
  }

  @Post('/v1/admin/pricing/quote-lookups')
  @HttpCode(200)
  @StaffSession({ permission: 'pricing.quote.view' })
  async lookupQuote(@Body() body: unknown, @Req() req: AuthenticatedRequest): Promise<z.infer<typeof StaffQuoteViewSchema>> {
    return found(await this.pricing.admin.lookupQuote(staffOf(req), parse(QuoteLookupRequestSchema, body)), StaffQuoteViewSchema);
  }
}
