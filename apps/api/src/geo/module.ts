/**
 * Geo module composition (Phase 3 P3.2). Called by `composeApi` only. Binds the geo ports of the provider registry
 * after the licence-coherence check (`assertGeoBundle`; a refused bundle logs GEO_LICENCE_BINDING_REFUSED and aborts
 * boot) and builds the consumer gateway, the routing service for the pricing module and the staff service.
 */
import type { FieldCipher, KeyedHasher } from '@wayvro/field-crypto';
import type { Logger } from '@wayvro/observability';
import { ProviderBindingError, assertGeoBundle, type GeoBundle, type ProviderRegistry } from '@wayvro/provider-interfaces';
import { CircuitBreaker, GeoUsageCounters, type RateLimiter, type ValkeyClient as Redis } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { ApiConfig } from '../config.js';
import type { IdempotencyStore } from '../platform/idempotency.js';
import { ValkeyBreakerHints } from './breaker-hints.js';
import { GeoBudgetGuard } from './budgets.js';
import { GeoCache } from './cache.js';
import { GeoAdminService } from './geo-admin.service.js';
import { GeoGateway, type GeoSeams } from './gateway.js';
import { PlaceRefSealer } from './place-ref.js';
import { GeoProviderCaller } from './provider-call.js';
import { GeoReference } from './reference.js';
import { GeoRouting } from './routing.js';

export interface GeoModuleDeps {
  readonly config: ApiConfig;
  readonly log: Logger;
  readonly db: pg.Pool;
  /** Request-path Valkey client (no offline queue, short command timeout) shared with the rate limiter. */
  readonly redis: Redis;
  readonly limiter: RateLimiter;
  readonly cipher: FieldCipher;
  readonly hasher: KeyedHasher;
  readonly idempotency: IdempotencyStore;
  readonly providers: ProviderRegistry;
  /** Catalog read model + runtime switch store; null ⇒ every geo call answers 503 (fail closed). */
  readonly seams: GeoSeams | null;
}

export interface GeoModule {
  readonly gateway: GeoGateway;
  /** For the pricing module (P3.3): `routing.route(request, deadline)`. */
  readonly routing: GeoRouting;
  readonly admin: GeoAdminService;
  readonly bundle: GeoBundle;
}

export function composeGeo(deps: GeoModuleDeps): GeoModule {
  const { config, log, providers } = deps;
  let bundle: GeoBundle;
  try {
    bundle = assertGeoBundle(config.GEO_RENDERER_KIND, providers);
  } catch (e) {
    if (e instanceof ProviderBindingError)
      log.fatal({ signal: 'GEO_LICENCE_BINDING_REFUSED', rendererKind: config.GEO_RENDERER_KIND, err: e }, 'geo bundle refused at boot');
    throw e;
  }
  const prefix = config.GEO_KEY_PREFIX;
  const breaker = new CircuitBreaker(
    {
      minCalls: config.GEO_BREAKER_MIN_CALLS,
      failurePercent: config.GEO_BREAKER_FAILURE_PERCENT,
      windowSeconds: config.GEO_BREAKER_WINDOW_SECONDS,
      consecutiveTimeouts: config.GEO_BREAKER_CONSECUTIVE_TIMEOUTS,
      openSeconds: config.GEO_BREAKER_OPEN_SECONDS,
      halfOpenProbes: config.GEO_BREAKER_HALF_OPEN_PROBES,
    },
    {
      hints: new ValkeyBreakerHints(deps.redis, prefix),
      onTransition: ({ key, to, source }) => {
        const fields = { providerKey: key.providerKey, sku: key.sku, source };
        if (to === 'OPEN') log.error({ signal: 'GEO_BREAKER_OPENED', ...fields }, 'geo circuit breaker opened');
        else if (to === 'HALF_OPEN') log.warn({ signal: 'GEO_BREAKER_HALF_OPEN', ...fields }, 'geo circuit breaker half-open');
        else log.info({ signal: 'GEO_BREAKER_CLOSED', ...fields }, 'geo circuit breaker closed');
      },
      onHintError: (key) => {
        log.warn(
          { signal: 'GEO_BREAKER_HINT_UNAVAILABLE', providerKey: key.providerKey, sku: key.sku },
          'breaker hint store unavailable; local breaker enforces',
        );
      },
    },
  );
  const budgets = new GeoBudgetGuard(deps.db, deps.limiter, deps.redis, config, log);
  const caller = new GeoProviderCaller(budgets, breaker, deps.redis, prefix, log);
  const cache = new GeoCache(deps.redis, deps.hasher, prefix, log);
  const usage = new GeoUsageCounters(deps.redis, prefix);
  const reference = new GeoReference(deps.db);
  const port = <K extends 'placesAutocomplete' | 'geocoding' | 'reverseGeocoding' | 'routing'>(kind: K) => (providers.has(kind) ? providers.get(kind) : null);
  const gateway = new GeoGateway({
    bundle,
    ports: { placesAutocomplete: port('placesAutocomplete'), geocoding: port('geocoding'), reverseGeocoding: port('reverseGeocoding') },
    seams: deps.seams,
    redis: deps.redis,
    limiter: deps.limiter,
    cache,
    caller,
    sealer: new PlaceRefSealer(deps.cipher, config.GEO_PLACE_REF_TTL_SECONDS),
    reference,
    usage,
    policy: config,
    log,
  });
  const routing = new GeoRouting({ bundle, port: port('routing'), switches: deps.seams?.switches ?? null, cache, caller, usage, policy: config, log });
  const admin = new GeoAdminService(deps.db, deps.idempotency, config.IDEMPOTENCY_TTL_SECONDS, budgets, reference);
  return { gateway, routing, admin, bundle };
}
