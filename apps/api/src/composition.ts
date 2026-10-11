/**
 * Shared composition of the API process (ADR-045). The production root (`src/main.ts`) and the local runner
 * (`dev/main.local.ts`, outside `src/` and outside every deployable artefact) both call `composeApi`; they differ only in
 * the provider bindings they pass and in local-only controllers. Nothing in `src/` imports a test double.
 */
import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDatabase, type Database } from '@wayvro/db';
import { FieldCipher, KeyedHasher, loadKeyRing } from '@wayvro/field-crypto';
import { PhoneLookup } from '@wayvro/identity-core';
import type { Logger } from '@wayvro/observability';
import type { ProviderRegistry } from '@wayvro/provider-interfaces';
import { RateLimiter, awaitRedisReady, createRequestPathRedis, databaseCheck, redisCheck } from '@wayvro/server-runtime';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';
import { AccountService } from './identity/account.service.js';
import { OtpAbuseControls } from './identity/otp-abuse.js';
import { OtpService } from './identity/otp.service.js';
import { SessionService } from './identity/session.service.js';
import { ComplianceAdminService } from './compliance/compliance-admin.service.js';
import { OnboardingService } from './compliance/onboarding.service.js';
import { ConsentService } from './legal/consent.service.js';
import { preparePolicyRegistry } from './legal/policy-registry.js';
import { OversightService } from './staff/oversight.service.js';
import { StaffAdminService } from './staff/staff-admin.service.js';
import { StaffAuthService } from './staff/staff-auth.service.js';
import { StaffWebAuthn } from './staff/webauthn.js';
import { IdempotencyStore } from './platform/idempotency.js';
import { AppealsService } from './review/appeals.service.js';
import { MonitoringService } from './review/monitoring.service.js';
import { ReviewService } from './review/review.service.js';
import { EvidenceViewService } from './vault/evidence-view.service.js';
import { EvidenceService, EvidenceSummary } from './vault/evidence.service.js';

export interface ApiRuntime {
  readonly app: NestFastifyApplication;
  readonly db: Database;
  readonly cipher: FieldCipher;
  close(): Promise<void>;
}

export interface ComposeOptions {
  readonly providers: ProviderRegistry;
  /** Local-runner-only controllers (never passed by `src/main.ts`). */
  readonly extraControllers?: readonly Type[];
}

export async function composeApi(config: ApiConfig, log: Logger, options: ComposeOptions): Promise<ApiRuntime> {
  // Staging/production refuse here until a KMS-backed key provider exists (EG-05); local/test use synthetic keys.
  const ring = loadKeyRing(config.WAYVRO_ENV, config);
  const cipher = new FieldCipher(ring);
  const hasher = new KeyedHasher(ring);
  const lookup = new PhoneLookup(hasher);
  const db = createDatabase(config.DATABASE_URL, { maxConnections: 10, applicationName: 'wayvro-api' });
  const redisProbe = redisCheck(config.REDIS_URL);
  const limiterRedis = createRequestPathRedis(config.REDIS_URL);
  if (!(await awaitRedisReady(limiterRedis, 3000))) log.warn('rate limiter not reachable at boot; OTP and session routes fail closed until it is');
  const limiter = new RateLimiter(limiterRedis, config.RATE_LIMIT_KEY_PREFIX);
  const idempotency = new IdempotencyStore(db.pool, cipher);
  const abuse = new OtpAbuseControls(limiter, hasher, config, log);
  const otp = new OtpService({
    db: db.pool,
    cipher,
    hasher,
    lookup,
    idempotency,
    abuse,
    policy: config,
    deliveryAvailable: options.providers.has('otpDelivery'),
  });
  const sessions = new SessionService({ db: db.pool, cipher, hasher, lookup, idempotency, abuse, policy: config });
  // Evidence vault (ADR-041): a SEPARATE pool authenticated as a member of wayvro_vault, handed only to src/vault/**.
  // Without it, or without bound object storage, evidence routes answer 503 DEPENDENCY_UNAVAILABLE.
  const vaultDb =
    config.DATABASE_VAULT_URL !== undefined && options.providers.has('objectStorage')
      ? createDatabase(config.DATABASE_VAULT_URL, { maxConnections: 5, applicationName: 'wayvro-api-vault' })
      : null;
  const evidenceSummary = vaultDb ? new EvidenceSummary(vaultDb.pool) : null;
  const onboarding = new OnboardingService(db.pool, cipher, hasher, idempotency, config, evidenceSummary);
  const evidence = vaultDb
    ? {
        evidence: new EvidenceService(vaultDb.pool, options.providers.get('objectStorage'), onboarding, idempotency, config),
        views: new EvidenceViewService(vaultDb.pool, options.providers.get('objectStorage'), cipher, config.WAYVRO_ENV, log),
      }
    : null;
  const accounts = new AccountService(db.pool, idempotency, config, onboarding.available);
  const consents = new ConsentService(db.pool, cipher, idempotency, config);
  // Registers/verifies the immutable policy registry; production refuses placeholder texts and age policy (CL-P2-09).
  await preparePolicyRegistry(db.pool, config.WAYVRO_ENV, log);
  const app = await createApp({
    info: { service: 'api', version: config.WAYVRO_BUILD_VERSION },
    readinessChecks: [databaseCheck(db), redisProbe],
    log,
    trustProxy: config.TRUST_PROXY,
    identity: { otp, sessions, accounts, consents, legalStore: db.pool, sessionStore: db.pool },
    staff: {
      auth: new StaffAuthService(db.pool, new StaffWebAuthn(config), idempotency, limiter, hasher, config),
      admin: new StaffAdminService(db.pool, idempotency, config),
      oversight: new OversightService(db.pool, idempotency, log, config.IDEMPOTENCY_TTL_SECONDS),
      policy: config,
    },
    compliance: { onboarding, admin: new ComplianceAdminService(db.pool, idempotency, config) },
    evidence,
    review: {
      review: new ReviewService(db.pool, cipher, idempotency, evidenceSummary, config),
      appeals: new AppealsService(db.pool, cipher, idempotency, config.IDEMPOTENCY_TTL_SECONDS),
      monitoring: new MonitoringService(db.pool),
    },
    ...(options.extraControllers ? { extraControllers: options.extraControllers } : {}),
  });
  return {
    app,
    db,
    cipher,
    async close() {
      await app.close();
      redisProbe.close();
      limiterRedis.disconnect();
      await db.close();
      await vaultDb?.close();
    },
  };
}
