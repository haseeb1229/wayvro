import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  AgeDeclarationRecordedSchema,
  AgeDeclarationRequestSchema,
  AgeEligibilityPolicySchema,
  ConsentRecordedSchema,
  ConsentRequestSchema,
  ConsentStatusListSchema,
  PolicyDocumentParamSchema,
  PolicyDocumentSchema,
  PolicyListSchema,
  PolicyQuerySchema,
  type AgeEligibilityPolicy,
  type ConsentStatusList,
  type PolicyDocument,
  type PolicyList,
} from '@wayvro/contracts';
import { POLICY_KEYS, currentDocument, policyDocument, type PublishedPolicyDocument } from '@wayvro/legal-content';
import { WayvroError } from '@wayvro/observability';
import type { Queryable } from '@wayvro/server-runtime';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { ConsumerSession, Public, principalOf, type AuthenticatedRequest } from '../auth/policy.js';
import { idempotencyKey, parse, render } from '../http/respond.js';
import { CONSENT_SERVICE, LEGAL_DB } from '../tokens.js';
import { currentAgePolicy } from './age-policy.js';
import type { ConsentService } from './consent.service.js';

const summary = (d: PublishedPolicyDocument) => ({
  policyKey: d.key,
  version: d.version,
  locale: d.locale,
  title: d.body.title,
  status: d.status,
  effectiveAt: d.effectiveAt,
  materialChange: d.materialChange,
  contentSha256: d.contentSha256,
  canonicalPath: d.canonicalPath,
  requiredFor: [...d.requiredFor],
  changeSummary: d.changeSummary,
});

/** `/v1/legal/*` (public, read-only) and the account's consent/age-declaration routes (A04, R09, W05, A15). */
@Controller()
export class LegalController {
  constructor(
    @Inject(CONSENT_SERVICE) private readonly consents: ConsentService,
    @Inject(LEGAL_DB) private readonly db: Queryable,
  ) {}

  @Get('/v1/legal/policies')
  @Public()
  listPolicies(@Query() query: unknown): PolicyList {
    const { locale } = parse(PolicyQuerySchema, query);
    const now = new Date();
    const policies = POLICY_KEYS.flatMap((key) => {
      const d = currentDocument(key, locale, now);
      return d ? [summary(d)] : [];
    });
    return PolicyListSchema.parse({ policies });
  }

  @Get('/v1/legal/policies/:policyKey/versions/:version')
  @Public()
  getPolicy(@Param() params: unknown, @Query() query: unknown): PolicyDocument {
    const p = PolicyDocumentParamSchema.safeParse(params);
    if (!p.success) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    const { locale } = parse(PolicyQuerySchema, query);
    const d = policyDocument(p.data.policyKey, Number(p.data.version), locale);
    // Not yet effective versions are not served (server time decides).
    if (!d || Date.parse(d.effectiveAt) > Date.now()) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    return PolicyDocumentSchema.parse({ ...summary(d), body: d.body });
  }

  @Get('/v1/legal/age-eligibility-policy')
  @Public()
  async agePolicy(): Promise<AgeEligibilityPolicy> {
    const a = await currentAgePolicy(this.db);
    return AgeEligibilityPolicySchema.parse({
      version: a.version,
      status: a.status,
      riderDeclarationMode: a.riderDeclarationMode,
      riderMinimumAge: a.riderMinimumAge,
      effectiveAt: a.effectiveAt.toISOString(),
    });
  }

  @Get('/v1/account/consents')
  @ConsumerSession()
  async listConsents(@Req() request: AuthenticatedRequest): Promise<ConsentStatusList> {
    return ConsentStatusListSchema.parse(await this.consents.status(principalOf(request)));
  }

  @Post('/v1/account/consents')
  @ConsumerSession()
  async recordConsent(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<z.infer<typeof ConsentRecordedSchema> | undefined> {
    const input = parse(ConsentRequestSchema, body);
    return render(reply, await this.consents.record(principalOf(request), input, idempotencyKey(request)), ConsentRecordedSchema);
  }

  @Post('/v1/account/age-declarations')
  @ConsumerSession()
  async declareAge(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<z.infer<typeof AgeDeclarationRecordedSchema> | undefined> {
    const input = parse(AgeDeclarationRequestSchema, body);
    return render(reply, await this.consents.declareAge(principalOf(request), input, idempotencyKey(request)), AgeDeclarationRecordedSchema);
  }
}
