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
import type { RuntimeSwitchReader } from '@wayvro/config';
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
import type { GeoSeams } from './geo/gateway.js';
import { composeGeo, type GeoModule } from './geo/module.js';
import { PlaceRefSealer } from './geo/place-ref.js';
import { OnboardingService } from './compliance/onboarding.service.js';
import { ConsentService } from './legal/consent.service.js';
import { preparePolicyRegistry } from './legal/policy-registry.js';
import { OversightService } from './staff/oversight.service.js';
import { SupportService } from './support/support.service.js';
import { StaffAdminService } from './staff/staff-admin.service.js';
import { StaffAuthService } from './staff/staff-auth.service.js';
import { StaffWebAuthn } from './staff/webauthn.js';
import { IdempotencyStore } from './platform/idempotency.js';
import { AppConfigService } from './platform/release/app-config.service.js';
import { ReleaseEnforcement } from './platform/release/enforcement.js';
import { AppPolicyAdminService } from './platform/release/policy-admin.service.js';
import { ReleaseStateCache } from './platform/release/state.js';
import { RuntimeSwitchAdminService } from './platform/release/switch-admin.service.js';
import { RuntimeSwitchStore } from './platform/release/switches.js';
import { PricingAdminService } from './pricing/pricing-admin.service.js';
import { QuoteService } from './pricing/quote.service.js';
import { PgRateCardPresence } from './pricing/rate-card-store.js';
import { AppealsService } from './review/appeals.service.js';
import { MonitoringService } from './review/monitoring.service.js';
import { ReviewService } from './review/review.service.js';
import { EvidenceViewService } from './vault/evidence-view.service.js';
import { EvidenceService, EvidenceSummary } from './vault/evidence.service.js';

export interface ApiRuntime {
  readonly app: NestFastifyApplication;
  readonly db: Database;
  readonly cipher: FieldCipher;
  /** Runtime kill switches (P3.4): the read side other server modules honour (cached, registry defaults). */
  readonly switches: RuntimeSwitchReader;
  /** Geo module (P3.2); `geo.routing` is the routing service the pricing module (P3.3) consumes. */
  readonly geo: GeoModule;
  close(): Promise<void>;
}

export interface ComposeOptions {
  readonly providers: ProviderRegistry;
  /** Local-runner-only controllers (never passed by `src/main.ts`). */
  readonly extraControllers?: readonly Type[];
  /**
   * Test-only override of the geo gateway's runtime-switch reader and service-area lookup (integration tests inject
   * controllable implementations). Production roots never pass it: `composeApi` wires the release-controls switch store
   * and `CatalogReadModel.inServiceArea`.
   */
  readonly geoSeams?: GeoSeams;
}

export async function composeApi(config: ApiConfig, log: Logger, options: ComposeOptions): Promise<ApiRuntime> {
  // Staging/production refuse here until a KMS-backed key provider exists (EG-05); local/test use synthetic keys.
  const ring = loadKeyRing(config.WAYVRO_ENV, config);
  // P3.2: placeRef sealing and keyed geo cache keys need their key classes — an explicit key spec without them fails here
  ring.active('place_refs');
  ring.active('geo_cache');
  const cipher = new FieldCipher(ring);
  const hasher = new KeyedHasher(ring);
  const lookup = new PhoneLookup(hasher);
  const db = createDatabase(config.DATABASE_URL, { maxConnections: 10, applicationName: 'wayvro-api' });
  const redisProbe = redisCheck(config.REDIS_URL);
  const limiterRedis = createRequestPathRedis(config.REDIS_URL);
  if (!(await awaitRedisReady(limiterRedis, 3000))) log.warn('rate limiter not reachable at boot; OTP and session routes fail closed until it is');
  const limiter = new RateLimiter(limiterRedis, config.RATE_LIMIT_KEY_PREFIX);
  const idempotency = new IdempotencyStore(db.pool, cipher);
  // Release controls (P3.4; ADR-049): one cached read side for policies + switches, shared by the 426/503 hook, app
  // config and every module that honours a runtime switch (store unreachable at boot = registry defaults, item 16).
  const releaseState = new ReleaseStateCache(db.pool, { ttlMs: config.RUNTIME_SWITCH_CACHE_SECONDS * 1000, log });
  const switches = new RuntimeSwitchStore(releaseState, config.WAYVRO_ENV);
  const invalidateRelease = () => {
    releaseState.invalidate();
  };
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
  // Phase 3 catalog (P3.1). ENABLE needs an ACTIVE rate card (with an APPROVED tax policy), read from the pricing
  // tables (P3.3).
  const catalog = {
    readModel: new CatalogReadModel(db.pool, config),
    admin: new CatalogAdminService(db.pool, idempotency, config, new PgRateCardPresence(db.pool)),
  };
  // P3.8: the driver compliance view reads per-product vehicle eligibility through the catalog module's read model
  // (display only; no catalog SQL in compliance).
  const onboarding = new OnboardingService(db.pool, cipher, hasher, idempotency, config, evidenceSummary, {
    eligibilityForVehicle: (vehicle, cityCode, at) => catalog.readModel.eligibilityForVehicle(vehicle, cityCode, at),
  });
  const review = new ReviewService(db.pool, cipher, idempotency, evidenceSummary, config);
  const evidence = vaultDb
    ? {
        evidence: new EvidenceService(vaultDb.pool, options.providers.get('objectStorage'), onboarding, idempotency, config),
        views: new EvidenceViewService(vaultDb.pool, options.providers.get('objectStorage'), cipher, config.WAYVRO_ENV, log, review),
      }
    : null;
  const accounts = new AccountService(db.pool, idempotency, config, onboarding.available);
  const consents = new ConsentService(db.pool, cipher, idempotency, config);
  // Registers/verifies the immutable policy registry; production refuses placeholder texts and age policy (CL-P2-09).
  await preparePolicyRegistry(db.pool, config.WAYVRO_ENV, log);
  // Geo gateway (P3.2): licence-coherent bundle check at boot; unbound geo ports answer 503 for their SKU.
  const geo = composeGeo({
    config,
    log,
    db: db.pool,
    redis: limiterRedis,
    limiter,
    cipher,
    hasher,
    idempotency,
    providers: options.providers,
    seams: options.geoSeams ?? {
      switches,
      serviceArea: { inServiceArea: (cityCode: string, point: { lat: number; lng: number }) => catalog.readModel.inServiceArea(cityCode, point) },
    },
  });
  // Pricing (P3.3): quotes price with the catalog read model + ONE geo routing call; placeRefs are opened (never
  // resolved) with the same key class the gateway seals them with.
  const pricing = {
    quotes: new QuoteService({
      db: db.pool,
      idempotency,
      limiter,
      switches,
      catalog: catalog.readModel,
      routing: geo.routing,
      placeRefs: new PlaceRefSealer(cipher, config.GEO_PLACE_REF_TTL_SECONDS),
      policy: config,
      log,
    }),
    admin: new PricingAdminService(db.pool, idempotency, config, log),
    log,
  };
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
    release: {
      enforcement: new ReleaseEnforcement(releaseState, switches),
      appConfig: new AppConfigService(releaseState, switches, limiter, config, log),
      policies: new AppPolicyAdminService(db.pool, idempotency, config, log, invalidateRelease),
      switches: new RuntimeSwitchAdminService(db.pool, idempotency, config, log, invalidateRelease),
      appConfigCacheSeconds: config.APP_CONFIG_CACHE_SECONDS,
    },
    review: {
      review,
      appeals: new AppealsService(db.pool, cipher, idempotency, config.IDEMPOTENCY_TTL_SECONDS),
      monitoring: new MonitoringService(db.pool),
    },
    catalog,
    geo: { gateway: geo.gateway, admin: geo.admin },
    pricing,
    ...(options.extraControllers ? { extraControllers: options.extraControllers } : {}),
  });
  return {
    app,
    db,
    cipher,
    switches,
    geo,
    async close() {
      await app.close();
      redisProbe.close();
      limiterRedis.disconnect();
      await db.close();
      await vaultDb?.close();
    },
  };
}
