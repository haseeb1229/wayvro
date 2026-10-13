/**
 * Routing for quotes (Phase 3 P3.2 → consumed by the pricing module, P3.3; B03/E07; docs/phase3/PHASE3_ARCHITECTURE.md
 * §5.3, §5.4a, §8; threat model T3-13). A module service, not an HTTP route.
 *
 *  - origin/destination are rounded to 4 decimals — that rounded pair is what the provider receives and what the cache
 *    is keyed on; departures share a 15-minute bucket (server time);
 *  - route cache ≤ 10 minutes (min of adapter terms and GEO_CACHE_MAX_TTL_ROUTE_SECONDS) and NEVER served stale;
 *  - ONE provider attempt, timeout = min(GEO_ROUTE_TIMEOUT_MS, time left before the caller's deadline), no retry;
 *  - unbound port, runtime switch in the safe state, missing wiring, limiter/budget/breaker refusal, timeout or an
 *    invalid answer (e.g. a route without a duration) ⇒ `RoutingUnavailableError` — never an estimated distance or ETA;
 *  - geometry is simplified to ≤ 2,048 encoded bytes; `geometryStorable` repeats the adapter's terms declaration.
 */
import { simplifyPolyline, Coordinates, GeoError } from '@wayvro/domain';
import type { RuntimeSwitchReader } from '@wayvro/config';
import { recordGeoSpan, type Logger } from '@wayvro/observability';
import type { GeoBundle, GeoConfidence, GeoPoint, RoutingPort, RoutingProfile } from '@wayvro/provider-interfaces';
import type { GeoUsageCounters } from '@wayvro/server-runtime';
import { z } from 'zod';
import type { GeoCache } from './cache.js';
import type { GeoPolicy } from './gateway.js';
import { newMeter, ProviderRefused, type GeoProviderCaller, type ProviderRefusal } from './provider-call.js';
import { RouteResultOutSchema, validOrNull } from './schemas.js';

export type RoutingUnavailableReason = 'UNBOUND' | 'UNWIRED' | 'SWITCH_STOPPED' | 'INVALID_POINT' | ProviderRefusal;

export class RoutingUnavailableError extends Error {
  override readonly name = 'RoutingUnavailableError';
  constructor(readonly reason: RoutingUnavailableReason) {
    super(`routing unavailable: ${reason}`);
  }
}

export interface RouteRequest {
  readonly origin: GeoPoint;
  readonly destination: GeoPoint;
  readonly profile: RoutingProfile;
  readonly departAt: Date;
}

export interface RouteOutcome {
  readonly distanceM: number;
  readonly durationS: number;
  /** Simplified (≤ 2,048 encoded bytes), first and last point kept. */
  readonly geometry: readonly GeoPoint[];
  readonly confidence: GeoConfidence;
  readonly source: {
    readonly providerKey: string;
    readonly fetchedAt: Date;
    readonly cacheStatus: 'HIT' | 'MISS';
    readonly attributionCode: string | null;
  };
  /** Whether the provider's terms allow keeping this geometry for the quote retention period. */
  readonly geometryStorable: boolean;
}

const BUCKET_MS = 15 * 60_000;
const CachedRoute = z.object({ route: RouteResultOutSchema });

export interface GeoRoutingDeps {
  readonly bundle: GeoBundle;
  readonly port: RoutingPort | null;
  readonly switches: RuntimeSwitchReader | null;
  readonly cache: GeoCache;
  readonly caller: GeoProviderCaller;
  readonly usage: GeoUsageCounters;
  readonly policy: GeoPolicy;
  readonly log: Logger;
  readonly now?: () => Date;
}

export class GeoRouting {
  private readonly now: () => Date;

  constructor(private readonly deps: GeoRoutingDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** `deadline` = absolute epoch-ms deadline of the caller's request (e.g. the quote deadline). */
  async route(request: RouteRequest, deadline: number): Promise<RouteOutcome> {
    const started = this.now().getTime();
    const licence = this.deps.bundle.licence('ROUTE');
    const port = this.deps.port;
    if (!licence || !port) throw new RoutingUnavailableError('UNBOUND');
    if (!this.deps.switches) throw new RoutingUnavailableError('UNWIRED');
    let origin: GeoPoint;
    let destination: GeoPoint;
    try {
      origin = this.rounded(request.origin);
      destination = this.rounded(request.destination);
    } catch (e) {
      if (e instanceof GeoError) throw new RoutingUnavailableError('INVALID_POINT');
      throw e;
    }
    if (await this.deps.switches.isStopped('platform.geo-routing')) throw new RoutingUnavailableError('SWITCH_STOPPED');

    const meter = newMeter();
    let cacheStatus: 'HIT' | 'MISS' | 'NONE' = 'NONE';
    let outcome = 'OK';
    const meta = { providerKey: licence.providerKey, sku: 'ROUTE' };
    try {
      const departAt = new Date(Math.floor(request.departAt.getTime() / BUCKET_MS) * BUCKET_MS);
      // routes carry no account: a licence that forbids cross-user sharing means no route cache at all
      const ttl = licence.cacheSharedAcrossUsers ? Math.min(licence.maxCacheTtlSeconds, this.deps.policy.GEO_CACHE_MAX_TTL_ROUTE_SECONDS) : 0;
      const key = this.deps.cache.key(licence.providerKey, 'ROUTE', {
        o: `${String(origin.lat)},${String(origin.lng)}`,
        d: `${String(destination.lat)},${String(destination.lng)}`,
        p: request.profile,
        t: departAt.getTime(),
      });
      const hit = await this.deps.cache.read(key, CachedRoute, ttl, this.now(), meta);
      // never stale for a new quote: only an entry inside its TTL is used
      if (hit?.state === 'FRESH') {
        meter.cacheHits++;
        cacheStatus = 'HIT';
        return this.result(hit.value.route, licence, hit.fetchedAt, 'HIT');
      }
      const { value, fetchedAt } = await this.deps.caller.call(
        { licence, deadline, timeoutMs: this.deps.policy.GEO_ROUTE_TIMEOUT_MS, retries: 0, meter },
        async (signal) => ({ route: await port.route({ origin, destination, profile: request.profile, departAt }, signal) }),
        (raw) => validOrNull(CachedRoute, raw),
      );
      cacheStatus = 'MISS';
      await this.deps.cache.write(key, value, fetchedAt, ttl, meta);
      return this.result(value.route, licence, fetchedAt, 'MISS');
    } catch (e) {
      if (e instanceof ProviderRefused) {
        outcome = e.reason;
        throw new RoutingUnavailableError(e.reason);
      }
      outcome = 'INTERNAL';
      throw e;
    } finally {
      try {
        await this.deps.usage.record(
          licence.providerKey,
          'ROUTE',
          {
            calls: meter.calls,
            cache_hits: meter.cacheHits,
            errors: meter.errors,
            timeouts: meter.timeouts,
            budget_refusals: meter.budgetRefusals,
            est_cost_micro_usd: meter.costMicroUsd,
          },
          this.now(),
        );
      } catch {
        this.deps.log.warn({ signal: 'GEO_USAGE_NOT_RECORDED', ...meta }, 'geo usage counters not recorded');
      }
      recordGeoSpan(started, { providerKey: licence.providerKey, sku: 'ROUTE', cacheStatus, outcome, latencyMs: this.now().getTime() - started });
    }
  }

  private rounded(p: GeoPoint): GeoPoint {
    const c = Coordinates.from(p);
    if (!c.inPakistanEnvelope()) throw new GeoError('OUT_OF_RANGE');
    return c.roundTo(4).toJSON();
  }

  private result(
    route: z.infer<typeof RouteResultOutSchema>,
    licence: { providerKey: string; attributionCode: string | null; geometryStorable: boolean },
    fetchedAt: Date,
    cacheStatus: 'HIT' | 'MISS',
  ): RouteOutcome {
    return {
      distanceM: route.distanceM,
      durationS: route.durationS,
      geometry: route.geometry.length >= 2 ? simplifyPolyline(route.geometry) : route.geometry,
      confidence: route.confidence,
      source: { providerKey: licence.providerKey, fetchedAt, cacheStatus, attributionCode: licence.attributionCode },
      geometryStorable: licence.geometryStorable,
    };
  }
}
