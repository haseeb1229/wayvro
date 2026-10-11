import 'reflect-metadata';
import type { IncomingMessage } from 'node:http';
import helmet from '@fastify/helmet';
import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { resolveRequestId, type Logger } from '@wayvro/observability';
import type { Queryable, ReadinessCheck } from '@wayvro/server-runtime';
import { PolicyGuard, assertRoutePolicies } from './auth/policy.js';
import type { ComplianceAdminService } from './compliance/compliance-admin.service.js';
import { ComplianceAdminController, OnboardingController } from './compliance/compliance.controller.js';
import type { OnboardingService } from './compliance/onboarding.service.js';
import { HealthController } from './health/health.controller.js';
import { ErrorEnvelopeFilter } from './http/error-filter.js';
import { registerHttpHooks } from './http/hooks.js';
import type { AccountService } from './identity/account.service.js';
import { AccountController } from './identity/account.controller.js';
import { AuthController } from './identity/auth.controller.js';
import type { OtpService } from './identity/otp.service.js';
import type { SessionService } from './identity/session.service.js';
import type { ConsentService } from './legal/consent.service.js';
import { LegalController } from './legal/legal.controller.js';
import type { OversightService } from './staff/oversight.service.js';
import type { StaffAdminService } from './staff/staff-admin.service.js';
import type { StaffAuthService } from './staff/staff-auth.service.js';
import type { StaffSessionPolicy } from './staff/staff-session.js';
import { OversightController, StaffAdminController, StaffAuthController } from './staff/staff.controller.js';
import { AccountAppealsController, ReviewController, type ReviewServices } from './review/review.controller.js';
import { EvidenceController, EvidenceViewController, type EvidenceServices } from './vault/vault.controller.js';
import {
  ACCOUNT_SERVICE,
  COMPLIANCE_ADMIN_SERVICE,
  CONSENT_SERVICE,
  EVIDENCE_SERVICES,
  REVIEW_SERVICES,
  LEGAL_DB,
  ONBOARDING_SERVICE,
  OTP_SERVICE,
  READINESS_CHECKS,
  SERVICE_INFO,
  SESSION_SERVICE,
  STAFF_ADMIN_SERVICE,
  STAFF_AUTH_SERVICE,
  STAFF_OVERSIGHT_SERVICE,
  type ServiceInfo,
} from './tokens.js';

/** Driver/Partner compliance services (P2.5). */
interface ComplianceServices {
  readonly onboarding: OnboardingService;
  readonly admin: ComplianceAdminService;
}

/** Staff realm services (P2.4); separate from the consumer identity services. */
interface StaffServices {
  readonly auth: StaffAuthService;
  readonly admin: StaffAdminService;
  readonly oversight: OversightService;
  readonly policy: StaffSessionPolicy;
}

interface IdentityServices {
  readonly otp: OtpService;
  readonly sessions: SessionService;
  readonly accounts: AccountService;
  readonly consents: ConsentService;
  /** Connection used for read-only policy-registry queries (current age-eligibility policy). */
  readonly legalStore: Queryable;
  /** Connection used by the policy guard to verify bearer access tokens against the session table. */
  readonly sessionStore: Queryable;
}

export interface AppDependencies {
  readonly info: ServiceInfo;
  readonly readinessChecks: readonly ReadinessCheck[];
  readonly log: Logger;
  /** false, true (local/test only) or the trusted proxy addresses/CIDRs (config TRUST_PROXY). */
  readonly trustProxy: boolean | readonly string[];
  readonly identity: IdentityServices;
  readonly staff: StaffServices;
  readonly compliance: ComplianceServices;
  /** Evidence vault (P2.6); null when the vault database role or object storage is not configured (routes answer 503). */
  readonly evidence: EvidenceServices | null;
  /** Manual review, appeals and monitoring (P2.7). */
  readonly review: ReviewServices;
  /** Local-runner/test-only controllers (never passed by the production root). Subject to the same policy rules. */
  readonly extraControllers?: readonly Type[];
}

const manifests = new WeakMap<NestFastifyApplication, readonly string[]>();

/**
 * "METHOD /path" of every route the app serves (HEAD auto-routes excluded), recorded as routes are registered.
 * @public consumed by scripts/artifact-isolation.mjs to read the route table of the release artefact.
 */
export function routeManifest(app: NestFastifyApplication): readonly string[] {
  return manifests.get(app) ?? [];
}

/**
 * The controllers of the deployable API. Every handler must declare a route policy (default deny).
 * @internal exported for the route-policy completeness test.
 */
export const API_CONTROLLERS: readonly Type[] = [
  HealthController,
  AuthController,
  AccountController,
  LegalController,
  StaffAuthController,
  StaffAdminController,
  OversightController,
  OnboardingController,
  ComplianceAdminController,
  EvidenceController,
  EvidenceViewController,
  ReviewController,
  AccountAppealsController,
];

@Module({})
class ApiModule {
  static register(deps: AppDependencies, controllers: readonly Type[]): DynamicModule {
    return {
      module: ApiModule,
      controllers: [...controllers],
      providers: [
        { provide: SERVICE_INFO, useValue: deps.info },
        { provide: READINESS_CHECKS, useValue: deps.readinessChecks },
        { provide: OTP_SERVICE, useValue: deps.identity.otp },
        { provide: SESSION_SERVICE, useValue: deps.identity.sessions },
        { provide: ACCOUNT_SERVICE, useValue: deps.identity.accounts },
        { provide: CONSENT_SERVICE, useValue: deps.identity.consents },
        { provide: LEGAL_DB, useValue: deps.identity.legalStore },
        { provide: STAFF_AUTH_SERVICE, useValue: deps.staff.auth },
        { provide: STAFF_ADMIN_SERVICE, useValue: deps.staff.admin },
        { provide: STAFF_OVERSIGHT_SERVICE, useValue: deps.staff.oversight },
        { provide: ONBOARDING_SERVICE, useValue: deps.compliance.onboarding },
        { provide: COMPLIANCE_ADMIN_SERVICE, useValue: deps.compliance.admin },
        { provide: EVIDENCE_SERVICES, useValue: deps.evidence },
        { provide: REVIEW_SERVICES, useValue: deps.review },
        { provide: APP_GUARD, useValue: new PolicyGuard(deps.identity.sessionStore, deps.staff.policy) },
      ],
    };
  }
}

export async function createApp(deps: AppDependencies): Promise<NestFastifyApplication> {
  const controllers = [...API_CONTROLLERS, ...(deps.extraControllers ?? [])];
  // Default deny, enforced before the process accepts traffic: a route without a policy aborts boot.
  assertRoutePolicies(controllers);
  const adapter = new FastifyAdapter({
    bodyLimit: 64 * 1024,
    trustProxy: typeof deps.trustProxy === 'boolean' ? deps.trustProxy : [...deps.trustProxy],
    genReqId: (req: IncomingMessage) => resolveRequestId(req.headers['x-request-id']),
    disableRequestLogging: true,
    return503OnClosing: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(ApiModule.register(deps, controllers), adapter, { logger: false, bufferLogs: false });
  // API responses are JSON only: the strictest CSP, no framing, no referrer, no MIME sniffing.
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });
  const routes: string[] = [];
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) if (method !== 'HEAD') routes.push(`${method} ${route.url}`);
    });
  manifests.set(app, routes);
  registerHttpHooks(app.getHttpAdapter().getInstance(), deps.log);
  app.useGlobalFilters(new ErrorEnvelopeFilter(deps.log));
  app.enableShutdownHooks();
  await app.init();
  return app;
}
