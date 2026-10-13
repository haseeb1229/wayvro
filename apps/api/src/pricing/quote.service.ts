/**
 * Upfront quotes (P3.3; B03/B04/B06/E05/E07; docs/phase3/PHASE3_PRICING_QUOTE_MODEL.md §4, §7, §8; threat model
 * T3-03..T3-06, T3-13, T3-16, T3-30, T3-31). The server is authoritative for every amount; `POST /v1/quotes` runs:
 *
 *   1  rate limits (account/min, account/day, IP prefix/min) BEFORE idempotency, so replays count; limiter down ⇒ 503
 *   2  runtime switch `rider.quotes` (safe state ⇒ FEATURE_DISABLED); account restrictions are the route guard's job
 *   3  idempotency (scope acct:<id>, operation quotes.create, canonical body + detail); everything below runs inside
 *      that one transaction, whose `now()` is the single server instant of the request (created_at, hours, expiry)
 *   4  coordinates: 6 decimals, Pakistan envelope (OUTSIDE_COUNTRY), ≥ 50 m apart (SAME_POINT); optional placeRefs are
 *      opened (owner, city, expiry) and discarded — never a provider call, never persisted, never part of the price
 *   5–9 catalog read model (ACTIVE zone set, zones, hours, pickup snap) + ACTIVE rate card with an APPROVED tax
 *      policy per product; staging/production refuse synthetic or placeholder configuration (503 + signal
 *      QUOTE_SYNTHETIC_CONFIG_REFUSED); nothing priceable ⇒ 422 SERVICE_AREA (an error OUTCOME, replayed for the key)
 *  10  ONE routing call (single attempt inside QUOTE_DEADLINE_MS, never retried); failure ⇒ THROW 503
 *      ROUTING_UNAVAILABLE: nothing recorded or persisted, the same key may retry; no estimate is ever invented
 *  11–12 ROUTE_TOO_LONG per card; the pure engine `pe-v1` per product
 *  13  advisory lock per account, older PRICED unexpired groups → SUPERSEDED, route snapshot (polyline only when the
 *      vendor terms permit storing it), quotes + components (deferred Σ check in the database), 201
 *
 * Logs and spans carry codes and counts only — never coordinates, a polyline, a placeRef or an amount.
 */
import { createHash } from 'node:crypto';
import type { QuoteGroup, QuoteRequest } from '@wayvro/contracts';
import { isNonProductionLike, type RuntimeSwitchReader, type WayvroEnv } from '@wayvro/config';
import { Coordinates, encodePolyline } from '@wayvro/domain';
import { recordPricingSpan, WayvroError, type Logger } from '@wayvro/observability';
import { LimiterUnavailableError, uuidv7, type LimitDecision, type Queryable, type RateLimiter } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { CandidateDecision, CatalogReadModel, ProductDisplay, SnappedPickup } from '../catalog/catalog-read-model.js';
import { PlaceRefError, type PlaceRefClaims } from '../geo/place-ref.js';
import { RoutingUnavailableError, type RouteOutcome, type RouteRequest } from '../geo/routing.js';
import { ipPrefix } from '../identity/otp-abuse.js';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome } from '../platform/idempotency.js';
import { PRICING_ENGINE_VERSION, priceQuote, type PricedComponent } from './engine.js';
import { activeCard, priceable, type StoredCard } from './rate-card-store.js';

interface QuotePolicy {
  readonly WAYVRO_ENV: WayvroEnv;
  readonly QUOTE_DEADLINE_MS: number;
  readonly QUOTES_PER_MINUTE_ACCOUNT: number;
  readonly QUOTES_PER_DAY_ACCOUNT: number;
  readonly QUOTES_PER_MINUTE_IP_PREFIX: number;
  readonly QUOTE_IDEMPOTENCY_TTL_SECONDS: number;
}

/** The geo module's routing service (`GeoRouting.route`). */
interface QuoteRouting {
  route(request: RouteRequest, deadline: number): Promise<RouteOutcome>;
}

/** The geo module's placeRef opener (`PlaceRefSealer.open`). */
interface PlaceRefOpener {
  open(token: string, accountId: string): PlaceRefClaims;
}

export interface QuoteServiceDeps {
  readonly db: pg.Pool;
  readonly idempotency: IdempotencyStore;
  readonly limiter: RateLimiter;
  readonly switches: RuntimeSwitchReader;
  readonly catalog: CatalogReadModel;
  readonly routing: QuoteRouting;
  readonly placeRefs: PlaceRefOpener;
  readonly policy: QuotePolicy;
  readonly log: Logger;
}

type UnavailableReason = QuoteGroup['unavailable'][number]['reasonCode'];
interface Unavailable {
  readonly productCode: string;
  readonly reasonCode: UnavailableReason;
  readonly nextOpenAt: string | null;
}
type ServedDecision = Extract<CandidateDecision, { kind: 'SERVED' }>;
interface Priceable {
  readonly productCode: string;
  readonly display: ProductDisplay;
  readonly decision: ServedDecision;
  readonly card: StoredCard & { values: NonNullable<StoredCard['values']>; tax: NonNullable<StoredCard['tax']> };
}

const MIN_SEPARATION_M = 50;
const routingUnavailable = () => new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE', { details: { reasonCodes: ['ROUTING_UNAVAILABLE'] } });

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

const componentView = (c: { kind: string; amountMinor: bigint; basis: Readonly<Record<string, string | number | boolean | null>> }) => ({
  kind: c.kind,
  amount: { currency: 'PKR' as const, minor: c.amountMinor.toString() },
  ...(Object.keys(c.basis).length > 0 ? { basis: c.basis } : {}),
});

const displayView = (d: ProductDisplay) => ({ nameKey: d.nameKey, seatsMax: d.seatsMax, luggageClass: d.luggageClass });

interface StoredQuoteRow {
  id: string;
  quote_group_id: string;
  product_code: string;
  rate_card_version: number;
  pricing_engine_version: string;
  pickup_point_id: string | null;
  total_minor: string;
  tax_included_rate_bp: number | null;
  tax_included_minor: string | null;
  toll_policy: 'NOT_APPLICABLE' | 'EXCLUDED_DISCLOSED';
  is_synthetic: boolean;
  status: 'PRICED' | 'EXPIRED' | 'SUPERSEDED';
  expired: boolean;
  created_at: Date;
  expires_at: Date;
  route_snapshot_id: string;
}
interface SnapshotRow {
  provider_key: string;
  fetched_at: Date;
  cache_status: 'HIT' | 'MISS';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  attribution_code: string | null;
  distance_m: number;
  duration_s: number;
  polyline: string | null;
}

export class QuoteService {
  constructor(private readonly deps: QuoteServiceDeps) {}

  private get productionLike(): boolean {
    return !isNonProductionLike(this.deps.policy.WAYVRO_ENV);
  }

  /** Step 1: every limit checked atomically (a denied request consumes nothing); limiter down ⇒ 503 (fail closed). */
  private async admit(accountId: string, clientIp: string): Promise<void> {
    const p = this.deps.policy;
    const rules = [
      { key: `quote:acct:m:${accountId}`, limit: p.QUOTES_PER_MINUTE_ACCOUNT, windowSeconds: 60 },
      { key: `quote:acct:d:${accountId}`, limit: p.QUOTES_PER_DAY_ACCOUNT, windowSeconds: 86_400 },
      { key: `quote:ip:m:${ipPrefix(clientIp) ?? 'unparsed'}`, limit: p.QUOTES_PER_MINUTE_IP_PREFIX, windowSeconds: 60 },
    ];
    let d: LimitDecision;
    try {
      d = await this.deps.limiter.consume(rules);
    } catch (e) {
      if (e instanceof LimiterUnavailableError) {
        this.deps.log.error({ signal: 'QUOTE_LIMITER_UNAVAILABLE' }, 'quote rate limiter unavailable; failing closed');
        throw routingUnavailable();
      }
      throw e;
    }
    if (!d.allowed) {
      this.deps.log.warn(
        { signal: 'QUOTE_RATE_LIMITED', rule: d.deniedRule === 2 ? 'IP_PREFIX' : d.deniedRule === 1 ? 'ACCOUNT_DAY' : 'ACCOUNT_MINUTE' },
        'quote rate limited',
      );
      throw new WayvroError('WAYVRO_E_RATE_LIMITED', { details: { retryAfterSeconds: d.retryAfterSeconds, reasonCodes: ['QUOTE_RATE_LIMITED'] } });
    }
  }

  async create(input: {
    readonly accountId: string;
    readonly request: QuoteRequest;
    readonly detail: 'full' | 'lite';
    readonly key: string;
    readonly clientIp: string;
  }): Promise<IdempotentResult> {
    const started = Date.now();
    const deadline = started + this.deps.policy.QUOTE_DEADLINE_MS;
    let outcome = 'INTERNAL';
    let productCount = 0;
    try {
      await this.admit(input.accountId, input.clientIp);
      if (await this.deps.switches.isStopped('rider.quotes', { scope: 'RIDER', cityCode: input.request.cityCode })) {
        throw new WayvroError('WAYVRO_E_FEATURE_DISABLED');
      }
      const payload = { request: input.request, detail: input.detail };
      const requestHash = createHash('sha256')
        .update(`quotes.create\n${JSON.stringify(canonical(payload))}`)
        .digest();
      const result = await this.deps.idempotency.execute(
        { scope: `acct:${input.accountId}`, operation: 'quotes.create', key: input.key, payload, ttlSeconds: this.deps.policy.QUOTE_IDEMPOTENCY_TTL_SECONDS },
        async (tx) => {
          const priced = await this.price(tx, input.accountId, input.request, input.detail === 'lite', requestHash, deadline);
          if (priced.kind === 'success') productCount = (priced.body as QuoteGroup).options.length;
          return priced;
        },
      );
      outcome = result.outcome.kind === 'success' ? 'OK' : result.outcome.code.replace(/^WAYVRO_E_/, '');
      if (result.outcome.kind === 'success' && !result.replayed) {
        this.deps.log.info({ signal: 'QUOTE_CREATED', products: productCount, latencyMs: Date.now() - started }, 'quote group created');
      }
      return result;
    } catch (e) {
      if (e instanceof WayvroError) outcome = (e.details?.reasonCodes?.[0] ?? e.code).replace(/^WAYVRO_E_/, '');
      throw e;
    } finally {
      recordPricingSpan(started, { name: 'pricing.quote.create', outcome, productCount, latencyMs: Date.now() - started });
    }
  }

  /** Steps 4–13 inside the idempotency transaction. A thrown error commits nothing; a returned refusal is recorded. */
  private async price(tx: pg.PoolClient, accountId: string, request: QuoteRequest, lite: boolean, requestHash: Buffer, deadline: number): Promise<Outcome> {
    const now = (await tx.query<{ now: Date }>(`select now() now`)).rows[0]?.now;
    if (!now) throw new Error('server time unavailable');
    const pickup = Coordinates.from(request.pickup).roundTo(6);
    const dropoff = Coordinates.from(request.dropoff).roundTo(6);
    if (!pickup.inPakistanEnvelope() || !dropoff.inPakistanEnvelope()) return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['OUTSIDE_COUNTRY'] });
    const apart = (
      await tx.query<{ m: number }>(
        `select ST_Distance(ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography, ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326)::geography) m`,
        [pickup.lng, pickup.lat, dropoff.lng, dropoff.lat],
      )
    ).rows[0]?.m;
    if (apart === undefined || apart < MIN_SEPARATION_M) return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['SAME_POINT'] });
    for (const point of [request.pickup, request.dropoff]) {
      if (point.placeRef === undefined) continue;
      try {
        // the label source is validated and discarded: no provider call, never stored, never priced
        if (this.deps.placeRefs.open(point.placeRef, accountId).cityCode !== request.cityCode) {
          return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['PLACE_REF_INVALID'] });
        }
      } catch (e) {
        if (e instanceof PlaceRefError) return failure('WAYVRO_E_VALIDATION', { reasonCodes: [e.reason] });
        throw e;
      }
    }

    const resolution = await this.deps.catalog.resolveForQuote(
      { cityCode: request.cityCode, pickup: pickup.toJSON(), dropoff: dropoff.toJSON(), products: request.products, at: now },
      tx,
    );
    if (resolution.unknownProductCodes.length > 0) return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['UNKNOWN_PRODUCT'] });
    // products requested but not ENABLED in the city are listed, never priced (QT-09, T3-15)
    const unavailable: Unavailable[] = resolution.notEnabled.map((p) => ({ productCode: p.productCode, reasonCode: 'ZONE_NOT_SERVED', nextOpenAt: null }));
    const candidates: Priceable[] = [];
    for (const c of resolution.candidates) {
      if (c.decision.kind === 'UNAVAILABLE') {
        unavailable.push({ productCode: c.productCode, reasonCode: c.decision.reasonCode, nextOpenAt: c.decision.nextOpenAt?.toISOString() ?? null });
        continue;
      }
      // Phase 3 routes CAR only; BIKE/RICKSHAW can never be ENABLED (database legal gate), so this is fail-closed only
      if (c.display.routingProfile !== 'CAR') {
        unavailable.push({ productCode: c.productCode, reasonCode: 'ZONE_NOT_SERVED', nextOpenAt: null });
        continue;
      }
      const card = await activeCard(tx, request.cityCode, c.productCode);
      if (!card || !priceable(card)) {
        unavailable.push({ productCode: c.productCode, reasonCode: 'NO_ACTIVE_RATE_CARD', nextOpenAt: null });
        continue;
      }
      if (this.productionLike && (card.isSynthetic || card.tax.isPlaceholder || c.isSyntheticCity || resolution.zoneSet?.isSynthetic === true)) {
        this.deps.log.error(
          { signal: 'QUOTE_SYNTHETIC_CONFIG_REFUSED', alert: true, cityCode: request.cityCode, productCode: c.productCode, rateCardId: card.id },
          'refused to price with synthetic or placeholder configuration',
        );
        throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE', { details: { reasonCodes: ['PRICING_CONFIG_REFUSED'] } });
      }
      candidates.push({ productCode: c.productCode, display: c.display, decision: c.decision, card });
    }
    // one route per quote group: the products sharing the first candidate's pickup snap are priced together
    const snap: SnappedPickup | null = candidates[0]?.decision.snappedPickup ?? null;
    const group = candidates.filter((c) => (c.decision.snappedPickup?.pickupPointId ?? null) === (snap?.pickupPointId ?? null));
    for (const c of candidates) {
      if (!group.includes(c)) unavailable.push({ productCode: c.productCode, reasonCode: 'PICKUP_RESTRICTED', nextOpenAt: null });
    }
    if (group.length === 0) return this.serviceArea(request.cityCode, unavailable);

    const route = await this.route({ origin: snap?.point ?? pickup.toJSON(), destination: dropoff.toJSON(), profile: 'CAR', departAt: now }, deadline);
    const engineStarted = Date.now();
    const options: Array<{ c: Priceable; components: readonly PricedComponent[]; totalMinor: bigint; taxIncluded: { rateBp: number; minor: bigint } | null }> =
      [];
    for (const c of group) {
      const result = priceQuote({
        card: c.card.values,
        tax: c.card.tax,
        distanceM: route.distanceM,
        durationS: route.durationS,
        airportPickup: c.decision.airportPickup && snap ? { pickupPointId: snap.pickupPointId } : null,
      });
      if (result.kind === 'ROUTE_TOO_LONG') {
        unavailable.push({ productCode: c.productCode, reasonCode: 'ROUTE_TOO_LONG', nextOpenAt: null });
        continue;
      }
      options.push({
        c,
        components: result.components,
        totalMinor: result.total.minor,
        taxIncluded: result.taxIncluded ? { rateBp: result.taxIncluded.rateBp, minor: result.taxIncluded.amount.minor } : null,
      });
    }
    recordPricingSpan(engineStarted, { name: 'pricing.engine.price', outcome: 'OK', productCount: group.length, latencyMs: Date.now() - engineStarted });
    if (options.length === 0) return this.serviceArea(request.cityCode, unavailable);
    const zoneSetId = resolution.zoneSet?.id;
    if (!zoneSetId) throw new Error('a served product without an ACTIVE zone set');

    // step 13: one live group per account; the cards priced with must still be the ACTIVE ones
    await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.quote:' || $1))`, [accountId]);
    for (const o of options) {
      const fresh = await activeCard(tx, request.cityCode, o.c.productCode, true);
      if (fresh?.id !== o.c.card.id) throw new WayvroError('WAYVRO_E_CONFLICT', { details: { reasonCodes: ['PRICING_CONFIG_CHANGED'] } });
    }
    await tx.query(`update pricing.quotes set status = 'SUPERSEDED' where account_id = $1 and status = 'PRICED' and expires_at > now()`, [accountId]);
    const snapshotId = uuidv7();
    const polyline = route.geometryStorable && route.geometry.length >= 2 ? encodePolyline(route.geometry) : null;
    await tx.query(
      `insert into pricing.route_snapshots (id, provider_key, sku, routing_profile, fetched_at, cache_status, confidence, attribution_code, distance_m, duration_s,
                                            polyline, latency_ms)
       values ($1, $2, 'ROUTE', 'CAR', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        snapshotId,
        route.source.providerKey,
        route.source.fetchedAt,
        route.source.cacheStatus,
        route.confidence,
        route.source.attributionCode,
        route.distanceM,
        route.durationS,
        polyline,
        route.latencyMs,
      ],
    );
    const groupId = uuidv7();
    const created: Array<{ id: string; expiresAt: Date }> = [];
    for (const o of options) {
      const id = uuidv7();
      const r = await tx.query<{ expires_at: Date }>(
        `insert into pricing.quotes (id, quote_group_id, account_id, city_code, product_code, rate_card_id, rate_card_version, zone_set_id, pricing_engine_version,
                                     pickup, dropoff, pickup_point_id, airport_pickup, pickup_district_code, dropoff_district_code, distance_m, duration_s,
                                     route_snapshot_id, currency, total_minor, tax_included_rate_bp, tax_included_minor, toll_policy, is_synthetic, status,
                                     created_at, expires_at, request_hash)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, ST_SetSRID(ST_MakePoint($10::float8, $11::float8), 4326)::geography,
                 ST_SetSRID(ST_MakePoint($12::float8, $13::float8), 4326)::geography, $14, $15, $16, $17, $18, $19, $20, 'PKR', $21, $22, $23, $24, $25,
                 'PRICED', now(), now() + ($26::int * interval '1 second'), $27)
         returning expires_at`,
        [
          id,
          groupId,
          accountId,
          request.cityCode,
          o.c.productCode,
          o.c.card.id,
          o.c.card.version,
          zoneSetId,
          PRICING_ENGINE_VERSION,
          pickup.lng,
          pickup.lat,
          dropoff.lng,
          dropoff.lat,
          snap?.pickupPointId ?? null,
          o.c.decision.airportPickup,
          resolution.pickupDistrictCode,
          resolution.dropoffDistrictCode,
          route.distanceM,
          route.durationS,
          snapshotId,
          o.totalMinor.toString(),
          o.taxIncluded?.rateBp ?? null,
          o.taxIncluded?.minor.toString() ?? null,
          o.c.card.values.tollPolicy,
          o.c.card.isSynthetic,
          o.c.card.values.quoteTtlSeconds,
          requestHash,
        ],
      );
      const expiresAt = r.rows[0]?.expires_at;
      if (!expiresAt) throw new Error('quote insert returned no row');
      for (const comp of o.components) {
        await tx.query(`insert into pricing.quote_components (quote_id, seq, kind, amount_minor, basis) values ($1, $2, $3, $4, $5)`, [
          id,
          comp.seq,
          comp.kind,
          comp.amount.minor.toString(),
          JSON.stringify(comp.basis),
        ]);
      }
      created.push({ id, expiresAt });
    }
    const body: QuoteGroup = {
      quoteGroupId: groupId,
      createdAt: now.toISOString(),
      pickup: { snappedTo: snap },
      route: {
        distanceM: route.distanceM,
        durationS: route.durationS,
        polyline: lite ? null : polyline,
        confidence: route.confidence,
        source: {
          providerKey: route.source.providerKey,
          fetchedAt: route.source.fetchedAt.toISOString(),
          cacheStatus: route.source.cacheStatus,
          attributionCode: route.source.attributionCode,
        },
      },
      options: options.map((o, i) => ({
        quoteId: created[i]?.id ?? '',
        productCode: o.c.productCode,
        status: 'PRICED',
        total: { currency: 'PKR', minor: o.totalMinor.toString() },
        components: o.components.map((c) =>
          componentView({ kind: c.kind, amountMinor: c.amount.minor, basis: c.basis }),
        ) as QuoteGroup['options'][number]['components'],
        taxIncluded: o.taxIncluded ? { rateBp: o.taxIncluded.rateBp, amount: { currency: 'PKR', minor: o.taxIncluded.minor.toString() } } : null,
        tollPolicy: o.c.card.values.tollPolicy,
        expiresAt: (created[i]?.expiresAt ?? now).toISOString(),
        rateCardVersion: o.c.card.version,
        pricingEngineVersion: PRICING_ENGINE_VERSION,
        display: displayView(o.c.display),
        isSynthetic: o.c.card.isSynthetic,
      })),
      unavailable: dedupe(unavailable),
    };
    return success(201, body);
  }

  /** Step 10: one routing attempt inside the overall deadline; any refusal or a late answer ⇒ thrown 503. */
  private async route(request: RouteRequest, deadline: number): Promise<RouteOutcome & { latencyMs: number }> {
    const started = Date.now();
    let route: RouteOutcome;
    try {
      route = await this.deps.routing.route(request, deadline);
    } catch (e) {
      if (e instanceof RoutingUnavailableError) {
        this.deps.log.warn({ signal: 'QUOTE_ROUTING_UNAVAILABLE', reason: e.reason }, 'quote refused: routing unavailable');
        throw routingUnavailable();
      }
      throw e;
    }
    if (Date.now() > deadline) {
      this.deps.log.warn({ signal: 'QUOTE_ROUTING_UNAVAILABLE', reason: 'DEADLINE_EXCEEDED' }, 'quote refused: deadline exceeded');
      throw routingUnavailable();
    }
    return { ...route, latencyMs: Date.now() - started };
  }

  private serviceArea(cityCode: string, unavailable: readonly Unavailable[]): Outcome {
    const reasons = [...new Set(unavailable.map((u) => u.reasonCode))];
    const next = unavailable
      .filter((u) => u.reasonCode === 'OUTSIDE_SERVICE_HOURS' && u.nextOpenAt !== null)
      .map((u) => u.nextOpenAt ?? '')
      .sort()[0];
    this.deps.log.info({ signal: 'QUOTE_SERVICE_AREA_REFUSED', cityCode, reasonCodes: reasons }, 'no product can be quoted');
    return failure('WAYVRO_E_SERVICE_AREA', { reasonCodes: reasons.length > 0 ? reasons : ['ZONE_NOT_SERVED'], ...(next ? { nextOpenAt: next } : {}) });
  }

  /** `GET /v1/quotes/{quoteGroupId}`: owner-only (inside the SQL), status computed on server time; else null (404). */
  async restore(accountId: string, quoteGroupId: string, lite: boolean): Promise<QuoteGroup | null> {
    const q: Queryable = this.deps.db;
    const rows = await q.query<StoredQuoteRow>(
      `select q.id, q.quote_group_id, q.product_code, q.rate_card_version, q.pricing_engine_version, q.pickup_point_id, q.total_minor::text,
              q.tax_included_rate_bp, q.tax_included_minor::text, q.toll_policy, q.is_synthetic, q.status, q.expires_at <= now() expired, q.created_at,
              q.expires_at, q.route_snapshot_id
         from pricing.quotes q where q.quote_group_id = $1 and q.account_id = $2 order by q.id`,
      [quoteGroupId, accountId],
    );
    const first = rows.rows[0];
    if (!first) return null;
    const snapshot = (
      await q.query<SnapshotRow>(
        `select provider_key, fetched_at, cache_status, confidence, attribution_code, distance_m, duration_s, polyline from pricing.route_snapshots where id = $1`,
        [first.route_snapshot_id],
      )
    ).rows[0];
    if (!snapshot) throw new Error('quote route snapshot missing');
    const components = await q.query<{ quote_id: string; kind: string; amount_minor: string; basis: Record<string, string | number | boolean | null> }>(
      `select quote_id, kind, amount_minor::text, basis from pricing.quote_components where quote_id = any($1::uuid[]) order by quote_id, seq`,
      [rows.rows.map((r) => r.id)],
    );
    const displays = await this.deps.catalog.productDisplays(rows.rows.map((r) => r.product_code));
    const snapped = first.pickup_point_id ? await this.deps.catalog.pickupPoint(first.pickup_point_id) : null;
    const options = rows.rows.map((r) => {
      const display = displays.get(r.product_code);
      if (!display) throw new Error('product definition missing');
      return {
        quoteId: r.id,
        productCode: r.product_code,
        status: r.status === 'PRICED' && r.expired ? ('EXPIRED' as const) : r.status,
        total: { currency: 'PKR' as const, minor: r.total_minor },
        components: components.rows
          .filter((c) => c.quote_id === r.id)
          .map((c) => componentView({ kind: c.kind, amountMinor: BigInt(c.amount_minor), basis: c.basis })) as QuoteGroup['options'][number]['components'],
        taxIncluded:
          r.tax_included_rate_bp !== null && r.tax_included_minor !== null
            ? { rateBp: r.tax_included_rate_bp, amount: { currency: 'PKR' as const, minor: r.tax_included_minor } }
            : null,
        tollPolicy: r.toll_policy,
        expiresAt: r.expires_at.toISOString(),
        rateCardVersion: r.rate_card_version,
        pricingEngineVersion: r.pricing_engine_version,
        display: displayView(display),
        isSynthetic: r.is_synthetic,
      };
    });
    return {
      quoteGroupId: first.quote_group_id,
      createdAt: first.created_at.toISOString(),
      pickup: { snappedTo: snapped },
      route: {
        distanceM: snapshot.distance_m,
        durationS: snapshot.duration_s,
        polyline: lite ? null : snapshot.polyline,
        confidence: snapshot.confidence,
        source: {
          providerKey: snapshot.provider_key,
          fetchedAt: snapshot.fetched_at.toISOString(),
          cacheStatus: snapshot.cache_status,
          attributionCode: snapshot.attribution_code,
        },
      },
      options,
      // the refusals of the original request are not stored (no product was priced for them); restore lists none
      unavailable: [],
    };
  }
}

/** One entry per product (the first reason found wins). */
function dedupe(list: readonly Unavailable[]): Unavailable[] {
  const seen = new Set<string>();
  const out: Unavailable[] = [];
  for (const u of list) {
    if (seen.has(u.productCode)) continue;
    seen.add(u.productCode);
    out.push(u);
  }
  return out;
}
