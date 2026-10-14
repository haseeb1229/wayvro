/**
 * Consumer geo gateway (Phase 3 P3.2; E06/E07/I11/B02/A06; docs/phase3/PHASE3_ARCHITECTURE.md §5). Every call runs the
 * pipeline in this order:
 *   1 normalise   contract-validated input; NFKC/whitespace/Latin case-fold; ACTIVE landmark alias expansion; points
 *                 range-checked, inside the Pakistan envelope, rounded (reverse 4 dp, bias 2 dp) BEFORE anything else
 *   2 authz       consumer session + account restrictions (route guard); runtime switch of the SKU; city ENABLED; SKU
 *                 bound
 *   3 rate limit  per account AND per client IP prefix (IPv4 /24, IPv6 /56; keyed-hash key; the request IP as Fastify
 *                 derives it under TRUST_PROXY — headers are never parsed here), consumed atomically; limiter
 *                 unavailable ⇒ 503, fail closed
 *   4 cache       provider-namespaced keyed (HMAC) keys; TTL = min(adapter terms, configured maximum)
 *   5–7           budget → quota cool-down → breaker → adapter (timeout, deadline-aware connect retry) — provider-call.ts
 *   8 normalise   validated, formatted (Lahore formatter), provider ids sealed into account-bound placeRefs
 *   9 cache write only when the licence permits
 *  10 meter       hourly usage counters + a span with provider key / SKU / cache status / outcome / latency only
 * Refusals are honest: 400 validation (reason codes), 404 FEATURE_DISABLED (switch), 429, 503 DEPENDENCY_UNAVAILABLE
 * (GEO_PROVIDER_UNAVAILABLE / GEO_BUDGET_EXHAUSTED) — never an invented place, address or coordinate. Stale entries
 * (≤ 2 × TTL) are served only for autocomplete and reverse geocoding when the provider fails, flagged STALE_SERVED.
 */
import { randomUUID } from 'node:crypto';
import type { RuntimeSwitchReader } from '@wayvro/config';
import type { KeyedHasher } from '@wayvro/field-crypto';
import type {
  AutocompleteQuery,
  AutocompleteResult,
  GeoSource,
  ResolvedPlace as ResolvedPlaceResponse,
  ReverseGeocodeQuerySchema,
  ReverseGeocodeResult,
} from '@wayvro/contracts';
import { Coordinates, GeoError } from '@wayvro/domain';
import { WayvroError, recordGeoSpan, type Logger } from '@wayvro/observability';
import type {
  GeoAdapterLicence,
  GeoBundle,
  GeoConfidence,
  GeoLocale,
  GeoSku,
  GeocodingPort,
  PlacesAutocompletePort,
  ReverseGeocodingPort,
} from '@wayvro/provider-interfaces';
import { LimiterUnavailableError, type GeoUsageCounters, type LimitDecision, type RateLimiter, type ValkeyClient as Redis } from '@wayvro/server-runtime';
import { z } from 'zod';
import type { ApiConfig } from '../config.js';
import { ipPrefix } from '../identity/otp-abuse.js';
import { formatAddress } from './address-format.js';
import type { GeoCache } from './cache.js';
import { codePointLength, normaliseQuery, QUERY_MIN_CODE_POINTS } from './normalise.js';
import { PlaceRefError, type PlaceRefClaims, type PlaceRefSealer } from './place-ref.js';
import { newMeter, ProviderRefused, type GeoProviderCaller, type Meter, type ProviderRefusal } from './provider-call.js';
import type { GeoReference } from './reference.js';
import {
  CandidateListSchema,
  HeldGeocodeSchema,
  NullableResolvedPlaceSchema,
  ResolvedPlaceListSchema,
  ResolvedPlaceOutSchema,
  validOrNull,
  type HeldGeocode,
  type ValidCandidate,
  type ValidPlace,
} from './schemas.js';

/** Catalog read seam (P3.1): whether a point lies in the city's ACTIVE service area. @internal exported for unit tests */
export interface ServiceAreaLookup {
  inServiceArea(cityCode: string, point: { readonly lat: number; readonly lng: number }): Promise<boolean>;
}

/** Cross-module seams wired by the composition root (catalog read model, release-controls switch store). */
export interface GeoSeams {
  readonly switches: RuntimeSwitchReader;
  readonly serviceArea: ServiceAreaLookup;
}

export type GeoPolicy = Pick<
  ApiConfig,
  | 'WAYVRO_ENV'
  | 'GEO_AUTOCOMPLETE_TIMEOUT_MS'
  | 'GEO_GEOCODE_TIMEOUT_MS'
  | 'GEO_REVERSE_TIMEOUT_MS'
  | 'GEO_ROUTE_TIMEOUT_MS'
  | 'GEO_CONNECT_RETRIES'
  | 'GEO_RETRY_SLACK_MS'
  | 'GEO_CACHE_MAX_TTL_AUTOCOMPLETE_SECONDS'
  | 'GEO_CACHE_MAX_TTL_GEOCODE_SECONDS'
  | 'GEO_CACHE_MAX_TTL_REVERSE_SECONDS'
  | 'GEO_CACHE_MAX_TTL_ROUTE_SECONDS'
  | 'GEO_PLACE_REF_TTL_SECONDS'
  | 'GEO_AUTOCOMPLETE_PER_MINUTE_ACCOUNT'
  | 'GEO_RESOLVE_PER_MINUTE_ACCOUNT'
  | 'GEO_REVERSE_PER_MINUTE_ACCOUNT'
  | 'GEO_AUTOCOMPLETE_PER_MINUTE_IP_PREFIX'
  | 'GEO_RESOLVE_PER_MINUTE_IP_PREFIX'
  | 'GEO_REVERSE_PER_MINUTE_IP_PREFIX'
  | 'ROUTE_RATIO_OUTLIER_MAX'
  | 'GEO_KEY_PREFIX'
>;

/** Who is asking: the session's account and the client IP Fastify derived (socket peer, or XFF from trusted proxies). */
export interface GeoRequester {
  readonly accountId: string;
  readonly clientIp: string;
}

export interface GeoGatewayDeps {
  readonly bundle: GeoBundle;
  readonly ports: {
    readonly placesAutocomplete: PlacesAutocompletePort | null;
    readonly geocoding: GeocodingPort | null;
    readonly reverseGeocoding: ReverseGeocodingPort | null;
  };
  readonly seams: GeoSeams | null;
  readonly redis: Redis;
  readonly limiter: RateLimiter;
  readonly cache: GeoCache;
  readonly caller: GeoProviderCaller;
  readonly sealer: PlaceRefSealer;
  readonly reference: GeoReference;
  readonly usage: GeoUsageCounters;
  /** Keys the per-IP-prefix limiter buckets (`risk_signals` class, as the OTP IP-prefix limits). */
  readonly hasher: KeyedHasher;
  readonly policy: GeoPolicy;
  readonly log: Logger;
  readonly now?: () => Date;
}

/** Limit family per endpoint: account and IP-prefix ceilings per minute (forward geocode counts as autocomplete). */
type LimitFamily = 'ac' | 'pr' | 'rv';

const SWITCH: Readonly<Record<Exclude<GeoSku, 'ROUTE'>, string>> = {
  AUTOCOMPLETE: 'platform.geo-autocomplete',
  GEOCODE: 'platform.geo-geocode',
  PLACE_RESOLVE: 'platform.geo-geocode',
  REVERSE_GEOCODE: 'platform.geo-reverse',
};
const EMPTY_RESULT_MAX_TTL = 3600;
const MAX_SUGGESTIONS = 5;

const unavailable = (reason: 'GEO_PROVIDER_UNAVAILABLE' | 'GEO_BUDGET_EXHAUSTED'): WayvroError =>
  new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE', { details: { reasonCodes: [reason] } });
const invalid = (reason: string): WayvroError => new WayvroError('WAYVRO_E_VALIDATION', { details: { reasonCodes: [reason] } });

/** Provider refusal → client error (no provider wording, no detail beyond the reason code). */
function refusalError(reason: ProviderRefusal): WayvroError {
  return reason === 'BUDGET_EXHAUSTED' || reason === 'BUDGET_MISSING' ? unavailable('GEO_BUDGET_EXHAUSTED') : unavailable('GEO_PROVIDER_UNAVAILABLE');
}

function outcomeCode(e: unknown): string {
  if (e instanceof ProviderRefused) return e.reason;
  if (e instanceof WayvroError) return e.code.replace('WAYVRO_E_', '');
  return 'INTERNAL';
}

const CachedCandidates = z.object({ candidates: CandidateListSchema });
const CachedPlaces = z.object({ places: ResolvedPlaceListSchema });
const CachedPlace = z.object({ place: ResolvedPlaceOutSchema });
const CachedNullablePlace = z.object({ place: NullableResolvedPlaceSchema });

interface CallContext {
  readonly sku: Exclude<GeoSku, 'ROUTE'>;
  readonly licence: GeoAdapterLicence;
  readonly meter: Meter;
  cacheStatus: 'HIT' | 'MISS' | 'STALE_SERVED' | 'NONE';
}

export class GeoGateway {
  private readonly now: () => Date;
  private unwiredLogged = false;

  constructor(private readonly deps: GeoGatewayDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  // ── consumer operations ──────────────────────────────────────────────────────────────────────────────────────

  async autocomplete(requester: GeoRequester, q: AutocompleteQuery): Promise<AutocompleteResult> {
    const { accountId } = requester;
    const sku = q.mode === 'GEOCODE' ? 'GEOCODE' : 'AUTOCOMPLETE';
    const started = this.now().getTime();
    const timeout = sku === 'GEOCODE' ? this.deps.policy.GEO_GEOCODE_TIMEOUT_MS : this.deps.policy.GEO_AUTOCOMPLETE_TIMEOUT_MS;
    const deadline = started + timeout + this.deps.policy.GEO_RETRY_SLACK_MS;
    // 1 normalise
    const normalised = normaliseQuery(q.q);
    if (codePointLength(normalised) < QUERY_MIN_CODE_POINTS) throw invalid('QUERY_TOO_SHORT');
    if ((q.biasLat === undefined) !== (q.biasLng === undefined)) throw invalid('BIAS_INCOMPLETE');
    const bias = q.biasLat !== undefined && q.biasLng !== undefined ? this.pakistanPoint(q.biasLat, q.biasLng).coarseCell() : null;
    const text = await this.deps.reference.expand(q.cityCode, q.locale, normalised);
    // 2 authz
    const seams = this.requireSeams();
    await this.requireSwitch(seams, sku, q.cityCode);
    await this.requireCity(q.cityCode);
    const licence = this.requireBound(sku);
    const ctx: CallContext = { sku, licence, meter: newMeter(), cacheStatus: 'NONE' };
    const material = { t: text, l: q.locale, b: bias ? `${String(bias.lat)},${String(bias.lng)}` : null };
    if (sku === 'GEOCODE') {
      const port = this.requirePort(this.deps.ports.geocoding);
      if (this.holdSeconds(licence) <= 0) {
        // terms forbid holding geocode results, so a GEOCODE suggestion could not be resolved later (ADR-006 item)
        this.deps.log.warn({ signal: 'GEO_GEOCODE_REF_UNSUPPORTED', providerKey: licence.providerKey }, 'geocode suggestions need a holdable result');
        throw unavailable('GEO_PROVIDER_UNAVAILABLE');
      }
      return this.metered(ctx, started, async () => {
        // 3 rate limit (forward geocoding counts against the autocomplete limits)
        await this.rateLimit('ac', requester);
        const { value, fetchedAt } = await this.cached(ctx, material, CachedPlaces, accountId, deadline, timeout, async (signal) => ({
          places: await port.geocode({ text, locale: q.locale, countryCode: 'PK' }, signal),
        }));
        const suggestions = await this.holdGeocodeResults(value.places, licence, accountId, q.cityCode, q.locale, fetchedAt);
        return { suggestions, source: this.source(licence, fetchedAt, ctx, 'UNKNOWN') };
      });
    }
    const port = this.requirePort(this.deps.ports.placesAutocomplete);
    return this.metered(ctx, started, async () => {
      await this.rateLimit('ac', requester);
      const { value, fetchedAt } = await this.cached(ctx, material, CachedCandidates, accountId, deadline, timeout, async (signal) => ({
        candidates: await port.suggest(
          { text, locale: q.locale, biasCell: bias ? bias.toJSON() : null, countryCode: 'PK', searchSessionId: q.session },
          signal,
        ),
      }));
      return {
        suggestions: this.sealCandidates(value.candidates, licence, accountId, q.cityCode, q.locale),
        source: this.source(licence, fetchedAt, ctx, 'UNKNOWN'),
      };
    });
  }

  async resolvePlace(requester: GeoRequester, placeRef: string, q: { readonly session: string; readonly locale: GeoLocale }): Promise<ResolvedPlaceResponse> {
    const { accountId } = requester;
    const started = this.now().getTime();
    // 1 normalise: authenticity, account binding and expiry of the sealed token (no oracle for foreign tokens)
    let claims: PlaceRefClaims;
    try {
      claims = this.deps.sealer.open(placeRef, accountId);
    } catch (e) {
      if (e instanceof PlaceRefError) {
        this.deps.log.warn({ signal: 'PLACEREF_REJECTED', reason: e.reason }, 'placeRef rejected');
        throw invalid(e.reason);
      }
      throw e;
    }
    const sku: Exclude<GeoSku, 'ROUTE'> = claims.sku === 'GEOCODE' ? 'GEOCODE' : 'PLACE_RESOLVE';
    // 2 authz
    const seams = this.requireSeams();
    await this.requireSwitch(seams, sku, claims.cityCode);
    await this.requireCity(claims.cityCode);
    const licence = this.requireBound(sku);
    if (licence.providerKey !== claims.providerKey) {
      this.deps.log.warn({ signal: 'PLACEREF_REJECTED', reason: 'PLACE_REF_STALE' }, 'placeRef from a provider that is no longer bound');
      throw invalid('PLACE_REF_STALE');
    }
    const ctx: CallContext = { sku, licence, meter: newMeter(), cacheStatus: 'NONE' };
    const port = this.requirePort(this.deps.ports.geocoding);
    return this.metered(ctx, started, async () => {
      // 3 rate limit
      await this.rateLimit('pr', requester);
      if (claims.sku === 'GEOCODE') {
        const held = await this.readHeld(licence, claims.placeId);
        ctx.meter.cacheHits++;
        ctx.cacheStatus = 'HIT';
        return {
          point: held.point,
          primaryText: held.primaryText,
          secondaryText: held.secondaryText,
          districtCode: null,
          inServiceArea: await seams.serviceArea.inServiceArea(claims.cityCode, held.point),
          source: this.source(licence, new Date(held.fetchedAt), ctx, held.confidence),
        };
      }
      const timeout = this.deps.policy.GEO_GEOCODE_TIMEOUT_MS;
      const deadline = started + timeout + this.deps.policy.GEO_RETRY_SLACK_MS;
      // a provider that no longer knows the place rejects the id: PLACE_REF_STALE, the client re-searches
      const resolved = await this.cached(
        ctx,
        { p: claims.placeId, l: q.locale },
        CachedPlace,
        accountId,
        deadline,
        timeout,
        async (signal) => ({ place: await port.resolve({ providerPlaceId: claims.placeId, searchSessionId: q.session, locale: q.locale }, signal) }),
        () => invalid('PLACE_REF_STALE'),
      );
      const place = resolved.value.place;
      const label = formatAddress(place.components, q.locale);
      if (!label) throw unavailable('GEO_PROVIDER_UNAVAILABLE');
      const point = Coordinates.from(place.point).toJSON();
      return {
        point,
        primaryText: label.primaryText,
        secondaryText: label.secondaryText,
        districtCode: null,
        inServiceArea: await seams.serviceArea.inServiceArea(claims.cityCode, point),
        source: this.source(licence, resolved.fetchedAt, ctx, place.confidence),
      };
    });
  }

  async reverse(requester: GeoRequester, q: z.infer<typeof ReverseGeocodeQuerySchema>): Promise<ReverseGeocodeResult> {
    const { accountId } = requester;
    const sku = 'REVERSE_GEOCODE';
    const started = this.now().getTime();
    const timeout = this.deps.policy.GEO_REVERSE_TIMEOUT_MS;
    const deadline = started + timeout + this.deps.policy.GEO_RETRY_SLACK_MS;
    // 1 normalise: the provider and the cache only ever see the 4-decimal point (~11 m)
    const point = this.pakistanPoint(q.lat, q.lng).roundTo(4).toJSON();
    // 2 authz
    const seams = this.requireSeams();
    await this.requireSwitch(seams, sku, q.cityCode);
    await this.requireCity(q.cityCode);
    const licence = this.requireBound(sku);
    const port = this.requirePort(this.deps.ports.reverseGeocoding);
    const ctx: CallContext = { sku, licence, meter: newMeter(), cacheStatus: 'NONE' };
    return this.metered(ctx, started, async () => {
      await this.rateLimit('rv', requester);
      const { value, fetchedAt } = await this.cached(
        ctx,
        { p: `${String(point.lat)},${String(point.lng)}`, l: q.locale },
        CachedNullablePlace,
        accountId,
        deadline,
        timeout,
        async (signal) => ({ place: await port.reverse({ point, locale: q.locale }, signal) }),
      );
      const label = value.place ? formatAddress(value.place.components, q.locale) : null;
      return {
        address: label ? { primaryText: label.primaryText, secondaryText: label.secondaryText, landmarkText: label.landmarkText } : null,
        inServiceArea: await seams.serviceArea.inServiceArea(q.cityCode, point),
        source: this.source(licence, fetchedAt, ctx, value.place?.confidence ?? 'UNKNOWN'),
      };
    });
  }

  // ── pipeline steps ───────────────────────────────────────────────────────────────────────────────────────────

  private pakistanPoint(lat: number, lng: number): Coordinates {
    let c: Coordinates;
    try {
      c = Coordinates.of(lat, lng);
    } catch (e) {
      if (e instanceof GeoError) throw invalid('INVALID_COORDINATES');
      throw e;
    }
    if (!c.inPakistanEnvelope()) throw invalid('OUTSIDE_COUNTRY');
    return c;
  }

  private requireSeams(): GeoSeams {
    if (this.deps.seams) return this.deps.seams;
    if (!this.unwiredLogged) {
      this.unwiredLogged = true;
      this.deps.log.error({ signal: 'GEO_SEAMS_UNWIRED' }, 'geo gateway has no switch reader / service-area lookup wired; refusing geo calls');
    }
    throw unavailable('GEO_PROVIDER_UNAVAILABLE');
  }

  private async requireSwitch(seams: GeoSeams, sku: Exclude<GeoSku, 'ROUTE'>, cityCode: string): Promise<void> {
    if (await seams.switches.isStopped(SWITCH[sku], { cityCode })) throw new WayvroError('WAYVRO_E_FEATURE_DISABLED');
  }

  private async requireCity(cityCode: string): Promise<void> {
    if (!(await this.deps.reference.cityEnabled(cityCode))) throw invalid('CITY_NOT_ENABLED');
  }

  private requireBound(sku: Exclude<GeoSku, 'ROUTE'>): GeoAdapterLicence {
    const licence = this.deps.bundle.licence(sku);
    if (!licence) throw unavailable('GEO_PROVIDER_UNAVAILABLE');
    return licence;
  }

  /** The bundle declares a licence only for bound ports; an unbound port is the same 503 for that SKU. */
  private requirePort<P>(port: P | null): P {
    if (port === null) throw unavailable('GEO_PROVIDER_UNAVAILABLE');
    return port;
  }

  /**
   * Step 3: the account and the IP-prefix rule of the endpoint, consumed atomically (a denied request consumes
   * nothing). The prefix bucket key is an HMAC of the prefix — Valkey never holds an address; an unparsable address
   * shares one bucket (as the quotes limit does).
   */
  private async rateLimit(family: LimitFamily, requester: GeoRequester): Promise<void> {
    const p = this.deps.policy;
    const [perAccount, perPrefix] =
      family === 'ac'
        ? [p.GEO_AUTOCOMPLETE_PER_MINUTE_ACCOUNT, p.GEO_AUTOCOMPLETE_PER_MINUTE_IP_PREFIX]
        : family === 'pr'
          ? [p.GEO_RESOLVE_PER_MINUTE_ACCOUNT, p.GEO_RESOLVE_PER_MINUTE_IP_PREFIX]
          : [p.GEO_REVERSE_PER_MINUTE_ACCOUNT, p.GEO_REVERSE_PER_MINUTE_IP_PREFIX];
    const prefix = ipPrefix(requester.clientIp);
    const prefixKey = prefix ? this.deps.hasher.active('risk_signals', `ip-prefix|${prefix}`).digest.toString('hex') : 'unparsed';
    let d: LimitDecision;
    try {
      d = await this.deps.limiter.consume([
        { key: `geo:${family}:m:${requester.accountId}`, limit: perAccount, windowSeconds: 60 },
        { key: `geo:${family}:ip:m:${prefixKey}`, limit: perPrefix, windowSeconds: 60 },
      ]);
    } catch (e) {
      if (e instanceof LimiterUnavailableError) {
        this.deps.log.error({ signal: 'GEO_LIMITER_UNAVAILABLE' }, 'geo rate limiter unavailable; failing closed');
        throw unavailable('GEO_PROVIDER_UNAVAILABLE');
      }
      throw e;
    }
    if (!d.allowed) {
      this.deps.log.warn({ signal: 'GEO_RATE_LIMITED', limit: family, rule: d.deniedRule === 1 ? 'IP_PREFIX' : 'ACCOUNT' }, 'geo request rate limited');
      throw new WayvroError('WAYVRO_E_RATE_LIMITED', { details: { retryAfterSeconds: d.retryAfterSeconds, reasonCodes: ['GEO_RATE_LIMITED'] } });
    }
  }

  private maxTtl(sku: Exclude<GeoSku, 'ROUTE'>): number {
    const p = this.deps.policy;
    if (sku === 'AUTOCOMPLETE') return p.GEO_CACHE_MAX_TTL_AUTOCOMPLETE_SECONDS;
    if (sku === 'REVERSE_GEOCODE') return p.GEO_CACHE_MAX_TTL_REVERSE_SECONDS;
    return p.GEO_CACHE_MAX_TTL_GEOCODE_SECONDS;
  }

  /**
   * Steps 4–9 for one SKU: fresh cache hit, else provider call (validated by `schema`), else — when allowed — a stale
   * entry; writes successful results back when the licence permits caching.
   */
  private async cached<T extends object>(
    ctx: CallContext,
    material: Readonly<Record<string, string | number | null>>,
    schema: z.ZodType<T>,
    accountId: string,
    deadline: number,
    timeoutMs: number,
    invoke: (signal: AbortSignal) => Promise<unknown>,
    onRejectedInput: () => WayvroError = () => unavailable('GEO_PROVIDER_UNAVAILABLE'),
  ): Promise<{ value: T; fetchedAt: Date }> {
    const { licence } = ctx;
    const meta = { providerKey: licence.providerKey, sku: ctx.sku };
    const ttl = Math.min(licence.maxCacheTtlSeconds, this.maxTtl(ctx.sku));
    // stale entries only for autocomplete and reverse geocoding (§5.3)
    const serveStale = ctx.sku === 'AUTOCOMPLETE' || ctx.sku === 'REVERSE_GEOCODE';
    const key = this.deps.cache.key(licence.providerKey, ctx.sku, material, licence.cacheSharedAcrossUsers ? null : accountId);
    const entry = await this.deps.cache.read(key, schema, ttl, this.now(), meta);
    if (entry?.state === 'FRESH') {
      ctx.meter.cacheHits++;
      ctx.cacheStatus = 'HIT';
      return { value: entry.value, fetchedAt: entry.fetchedAt };
    }
    try {
      const result = await this.deps.caller.call(
        { licence, deadline, timeoutMs, retries: this.deps.policy.GEO_CONNECT_RETRIES, meter: ctx.meter },
        invoke,
        (raw) => validOrNull(schema, raw),
      );
      ctx.cacheStatus = 'MISS';
      if (ttl > 0) {
        const lifetime = isEmpty(result.value) ? Math.min(ttl, EMPTY_RESULT_MAX_TTL) : serveStale ? 2 * ttl : ttl;
        await this.deps.cache.write(key, result.value, result.fetchedAt, lifetime, meta);
      }
      return result;
    } catch (e) {
      if (e instanceof ProviderRefused) {
        if (serveStale && entry?.state === 'STALE' && e.reason !== 'LIMITER_UNAVAILABLE' && e.reason !== 'REJECTED_INPUT') {
          ctx.meter.cacheHits++;
          ctx.cacheStatus = 'STALE_SERVED';
          this.deps.log.warn({ signal: 'GEO_STALE_SERVED', ...meta, refusal: e.reason }, 'provider unavailable; stale geo entry served');
          return { value: entry.value, fetchedAt: entry.fetchedAt };
        }
        throw e.reason === 'REJECTED_INPUT' ? onRejectedInput() : refusalError(e.reason);
      }
      throw e;
    }
  }

  /** Seals up to five formatted suggestions; candidates without any usable label are dropped (never invented). */
  private sealCandidates(
    candidates: readonly ValidCandidate[],
    licence: GeoAdapterLicence,
    accountId: string,
    cityCode: string,
    locale: GeoLocale,
  ): AutocompleteResult['suggestions'] {
    const out: AutocompleteResult['suggestions'] = [];
    for (const c of candidates) {
      if (out.length >= MAX_SUGGESTIONS) break;
      const label = formatAddress(c.components, locale);
      if (!label) continue;
      out.push({
        placeRef: this.deps.sealer.seal({ providerKey: licence.providerKey, sku: 'AUTOCOMPLETE', placeId: c.providerPlaceId, accountId, cityCode }),
        primaryText: label.primaryText,
        secondaryText: label.secondaryText,
        kind: c.kind,
      });
    }
    return out;
  }

  private holdSeconds(licence: GeoAdapterLicence): number {
    return Math.min(licence.maxCacheTtlSeconds, this.deps.policy.GEO_CACHE_MAX_TTL_GEOCODE_SECONDS, this.deps.policy.GEO_PLACE_REF_TTL_SECONDS);
  }

  private heldKey(licence: GeoAdapterLicence, holdId: string): string {
    return `${this.deps.policy.GEO_KEY_PREFIX}${licence.providerKey}:GEOCODE:held:${holdId}`;
  }

  /** GEOCODE results are held per suggestion (≤ placeRef lifetime, within the terms TTL) so the placeRef can resolve. */
  private async holdGeocodeResults(
    places: readonly ValidPlace[],
    licence: GeoAdapterLicence,
    accountId: string,
    cityCode: string,
    locale: GeoLocale,
    fetchedAt: Date,
  ): Promise<AutocompleteResult['suggestions']> {
    const out: AutocompleteResult['suggestions'] = [];
    const seconds = this.holdSeconds(licence);
    for (const p of places) {
      if (out.length >= MAX_SUGGESTIONS) break;
      const label = formatAddress(p.components, locale);
      if (!label) continue;
      const holdId = randomUUID();
      const held: HeldGeocode = {
        point: Coordinates.from(p.point).toJSON(),
        primaryText: label.primaryText,
        secondaryText: label.secondaryText,
        confidence: p.confidence,
        fetchedAt: fetchedAt.toISOString(),
      };
      try {
        await this.deps.redis.set(this.heldKey(licence, holdId), JSON.stringify(held), 'EX', seconds);
      } catch {
        this.deps.log.error({ signal: 'GEO_LIMITER_UNAVAILABLE', providerKey: licence.providerKey, sku: 'GEOCODE' }, 'geocode result could not be held');
        throw unavailable('GEO_PROVIDER_UNAVAILABLE');
      }
      out.push({
        placeRef: this.deps.sealer.seal({ providerKey: licence.providerKey, sku: 'GEOCODE', placeId: holdId, accountId, cityCode }),
        primaryText: label.primaryText,
        secondaryText: label.secondaryText,
        kind: p.kind,
      });
    }
    return out;
  }

  private async readHeld(licence: GeoAdapterLicence, holdId: string): Promise<HeldGeocode> {
    let raw: string | null;
    try {
      raw = await this.deps.redis.get(this.heldKey(licence, holdId));
    } catch {
      this.deps.log.error({ signal: 'GEO_LIMITER_UNAVAILABLE', providerKey: licence.providerKey, sku: 'GEOCODE' }, 'held geocode result unreadable');
      throw unavailable('GEO_PROVIDER_UNAVAILABLE');
    }
    let parsed: HeldGeocode | null = null;
    if (raw !== null) {
      try {
        parsed = validOrNull(HeldGeocodeSchema, JSON.parse(raw));
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
    }
    if (!parsed) throw invalid('PLACE_REF_STALE');
    return parsed;
  }

  private source(licence: GeoAdapterLicence, fetchedAt: Date, ctx: CallContext, confidence: GeoConfidence): GeoSource {
    return {
      providerKey: licence.providerKey,
      fetchedAt: fetchedAt.toISOString(),
      cacheStatus: ctx.cacheStatus === 'NONE' ? 'MISS' : ctx.cacheStatus,
      confidence,
      attributionCode: licence.attributionCode,
      coverageNote: null,
    };
  }

  /** Step 10: hourly counters (best-effort, logged) and one span — on success and on every refusal. */
  private async metered<T>(ctx: CallContext, started: number, work: () => Promise<T>): Promise<T> {
    let outcome = 'OK';
    try {
      return await work();
    } catch (e) {
      outcome = outcomeCode(e);
      throw e;
    } finally {
      const m = ctx.meter;
      try {
        await this.deps.usage.record(
          ctx.licence.providerKey,
          ctx.sku,
          {
            calls: m.calls,
            cache_hits: m.cacheHits,
            errors: m.errors,
            timeouts: m.timeouts,
            budget_refusals: m.budgetRefusals,
            est_cost_micro_usd: m.costMicroUsd,
          },
          this.now(),
        );
      } catch {
        this.deps.log.warn({ signal: 'GEO_USAGE_NOT_RECORDED', providerKey: ctx.licence.providerKey, sku: ctx.sku }, 'geo usage counters not recorded');
      }
      recordGeoSpan(started, {
        providerKey: ctx.licence.providerKey,
        sku: ctx.sku,
        cacheStatus: ctx.cacheStatus,
        outcome,
        latencyMs: this.now().getTime() - started,
      });
    }
  }
}

function isEmpty(value: object): boolean {
  if ('candidates' in value && Array.isArray(value.candidates)) return value.candidates.length === 0;
  if ('places' in value && Array.isArray(value.places)) return value.places.length === 0;
  if ('place' in value) return value.place === null;
  return false;
}
