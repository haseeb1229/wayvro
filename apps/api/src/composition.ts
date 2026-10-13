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
import { CatalogAdminService } from './catalog/catalog-admin.service.js';
import { CatalogReadModel } from './catalog/catalog-read-model.js';
import type { ApiConfig } from './config.js';
import { AccountSecurityService } from './identity/account-security.service.js';
import { AccountService } from './identity/account.service.js';
import { DeletionService } from './identity/deletion.service.js';
import { OtpAbuseControls } from './identity/otp-abuse.js';
import { OidcService } from './identity/oidc.service.js';
import { OtpService } from './identity/otp.service.js';
import { RecoveryReviewService } from './identity/recovery-review.service.js';
import { SessionService } from './identity/session.service.js';
import { ComplianceAdminService } from './compliance/compliance-admin.service.js';
import { OnboardingService } from './compliance/onboarding.service.js';
import { ConsentService } from './legal/consent.service.js';
import { preparePolicyRegistry } from './legal/policy-registry.js';
import { OversightService } from './staff/oversight.service.js';
import { SupportService } from './support/support.service.js';
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
  // OIDC (P2.10): flag-gated per provider; without a bound key source (production until P2.A2/P2.A3) every route answers 503
  const oidc = new OidcService({
    db: db.pool,
    idempotency,
    abuse,
    sessions,
    keys: options.providers.has('oidcKeys') ? options.providers.get('oidcKeys') : null,
    policy: config,
  });
  const security = new AccountSecurityService({ db: db.pool, cipher, hasher, lookup, idempotency, abuse, otp, limiter, oidc, policy: config });
  const recoveryReviews = new RecoveryReviewService(db.pool, cipher, idempotency, sessions, config);
  const deletion = new DeletionService({ db: db.pool, cipher, hasher, lookup, idempotency, abuse, otp, limiter, policy: config });
  // Evidence vault (ADR-041): a SEPARATE pool authenticated as a member of wayvro_vault, handed only to src/vault/**.
  // Without it, or without bound object storage, evidence routes answer 503 DEPENDENCY_UNAVAILABLE.
  const vaultDb =
    config.DATABASE_VAULT_URL !== undefined && options.providers.has('objectStorage')
      ? createDatabase(config.DATABASE_VAULT_URL, { maxConnections: 5, applicationName: 'wayvro-api-vault' })
      : null;
  const evidenceSummary = vaultDb ? new EvidenceSummary(vaultDb.pool) : null;
  const onboarding = new OnboardingService(db.pool, cipher, hasher, idempotency, config, evidenceSummary);
  const review = new ReviewService(db.pool, cipher, idempotency, evidenceSummary, config);
  const evidence = vaultDb
    ? {
        evidence: new EvidenceService(vaultDb.pool, options.providers.get('objectStorage'), onboarding, idempotency, config),
        views: new EvidenceViewService(vaultDb.pool, options.providers.get('objectStorage'), cipher, config.WAYVRO_ENV, log, review),
      }
    : null;
  const accounts = new AccountService(db.pool, idempotency, config, onboarding.available);
  const consents = new ConsentService(db.pool, cipher, idempotency, config);
  // Phase 3 catalog (P3.1). ENABLE needs an ACTIVE rate card; no rate-card source exists until the pricing module (P3.3)
  // wires one here, so the admin service is built with `null` and refuses every ENABLE (RATE_CARD_CHECK_UNAVAILABLE).
  const catalog = { readModel: new CatalogReadModel(db.pool, config), admin: new CatalogAdminService(db.pool, idempotency, config, null) };
  // Registers/verifies the immutable policy registry; production refuses placeholder texts and age policy (CL-P2-09).
  await preparePolicyRegistry(db.pool, config.WAYVRO_ENV, log);
  const app = await createApp({
    info: { service: 'api', version: config.WAYVRO_BUILD_VERSION },
    readinessChecks: [databaseCheck(db), redisProbe],
    log,
    trustProxy: config.TRUST_PROXY,
    identity: { otp, sessions, accounts, consents, security, recoveryReviews, deletion, oidc, legalStore: db.pool, sessionStore: db.pool },
    staff: {
      auth: new StaffAuthService(db.pool, new StaffWebAuthn(config), idempotency, limiter, hasher, config),
      admin: new StaffAdminService(db.pool, idempotency, config),
      oversight: new OversightService(db.pool, idempotency, log, config.IDEMPOTENCY_TTL_SECONDS),
      policy: config,
    },
    compliance: { onboarding, admin: new ComplianceAdminService(db.pool, idempotency, config) },
    evidence,
    support: new SupportService(db.pool, lookup, idempotency, config),
    review: {
      review,
      appeals: new AppealsService(db.pool, cipher, idempotency, config.IDEMPOTENCY_TTL_SECONDS),
      monitoring: new MonitoringService(db.pool),
    },
    catalog,
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
