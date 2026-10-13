/**
 * Catalog read model (P3.1; E08/H10/R28/B04) — the ONLY way other modules read catalog data (PHASE3_ARCHITECTURE §1:
 * no cross-context SQL). Server-only and authoritative: geometry predicates run in PostGIS against the ACTIVE zone set,
 * decisions come from the pure evaluators (zone-decision, service-hours, vehicle-eligibility), and time is the SERVER
 * instant passed by the caller.
 *
 * Every method takes an optional `Queryable` so a caller can run it inside its own transaction (the quote service
 * prices in one transaction). `resolveForQuote` reads the ACTIVE zone set ONCE and evaluates every predicate against
 * that set's id, so a concurrent activation can never produce a mixed-set decision (ZB-14); zone sets and their
 * children are immutable after DRAFT, so the rows read stay consistent for the whole request.
 */
import type { Queryable } from '@wayvro/server-runtime';
import { isOpen, nextOpening, parseLocalTime, type ServiceHoursRow } from './service-hours.js';
import { evaluateVehicleEligibility, type BodyType, type EligibilityResult, type VehicleFacts } from './vehicle-eligibility.js';
import { decideZones, isServed, type PickupPointCandidate, type PickupPointKind, type ZoneHit, type ZoneKind, type ZoneScope } from './zone-decision.js';

/** @public part of the catalog read API consumed by other modules (pricing P3.3, geo P3.2, driver readiness P3.8) */
export type CityProductStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'ENABLED' | 'SUSPENDED' | 'DISABLED_LEGAL_GATE';
/** @public part of the catalog read API consumed by other modules (pricing P3.3, geo P3.2, driver readiness P3.8) */
export type VehicleClass = 'CAR' | 'BIKE' | 'RICKSHAW';
/** @public part of the catalog read API consumed by other modules (pricing P3.3, geo P3.2, driver readiness P3.8) */
export type LuggageClass = 'NONE' | 'SMALL' | 'STANDARD' | 'LARGE';
/** @public part of the catalog read API consumed by other modules (pricing P3.3, geo P3.2, driver readiness P3.8) */
export type RoutingProfile = 'CAR' | 'TWO_WHEELER' | 'THREE_WHEELER';

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** @public part of the catalog read API consumed by other modules (pricing P3.3, geo P3.2, driver readiness P3.8) */
export interface ProductDisplay {
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly seatsMax: number;
  readonly luggageClass: LuggageClass;
  readonly routingProfile: RoutingProfile;
  readonly vehicleClass: VehicleClass;
  readonly sortOrder: number;
}

/** The designated/airport point the server snapped a restricted pickup to (the request never names one). */
export interface SnappedPickup {
  readonly pickupPointId: string;
  readonly kind: PickupPointKind;
  readonly nameEn: string;
  readonly nameUr: string;
  readonly instructionKey: string;
  readonly point: LatLng;
}

/** @public part of the catalog read API consumed by other modules (pricing P3.3, geo P3.2, driver readiness P3.8) */
export type CandidateDecision =
  | { readonly kind: 'SERVED'; readonly snappedPickup: SnappedPickup | null; readonly airportPickup: boolean }
  | {
      readonly kind: 'UNAVAILABLE';
      readonly reasonCode: 'ZONE_NOT_SERVED' | 'PICKUP_RESTRICTED' | 'OUTSIDE_SERVICE_HOURS';
      /** Only for OUTSIDE_SERVICE_HOURS: the next opening instant (server time; Asia/Karachi schedule); else null. */
      readonly nextOpenAt: Date | null;
    };

/** @public part of the catalog read API consumed by other modules (pricing P3.3, geo P3.2, driver readiness P3.8) */
export interface QuoteCandidate {
  readonly productCode: string;
  readonly display: ProductDisplay;
  /** Always ENABLED (only ENABLED products are candidates); carried so the caller re-checks it in its transaction. */
  readonly cityStatus: CityProductStatus;
  /** The city-product row is system-seeded synthetic configuration (local/test only; production refuses it). */
  readonly isSyntheticCity: boolean;
  readonly decision: CandidateDecision;
}

/**
 * Result of {@link CatalogReadModel.resolveForQuote}.
 *  - `zoneSet`: the ACTIVE zone set every decision used (record its id/version on the quote); null = none ⇒ every
 *    candidate is UNAVAILABLE ZONE_NOT_SERVED.
 *  - `candidates`: ENABLED products ∩ requested (every ENABLED product when `products` is omitted), in sort order.
 *  - `unknownProductCodes`: requested codes that are not service products at all — the API answers 400.
 *  - `notEnabled`: requested, known products that are not ENABLED in the city (`cityStatus` null = no city row) — the
 *    quote lists them as unavailable and never prices them (QT-09, T3-15).
 *  - district codes: only when district geometry exists (none in Phase 3, FA-12) — else null (ZB-16).
 */
export interface QuoteResolution {
  readonly zoneSet: { readonly id: string; readonly version: number; readonly isSynthetic: boolean } | null;
  readonly candidates: readonly QuoteCandidate[];
  readonly unknownProductCodes: readonly string[];
  readonly notEnabled: ReadonlyArray<{ readonly productCode: string; readonly cityStatus: CityProductStatus | null }>;
  readonly pickupDistrictCode: string | null;
  readonly dropoffDistrictCode: string | null;
}

export interface QuoteResolutionInput {
  readonly cityCode: string;
  readonly pickup: LatLng;
  readonly dropoff: LatLng;
  readonly products?: readonly string[] | undefined;
  /** Server time (never a client clock). */
  readonly at: Date;
}

export interface CatalogProductView {
  readonly productCode: string;
  readonly vehicleClass: VehicleClass;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly seatsMax: number;
  readonly luggageClass: LuggageClass;
  readonly sortOrder: number;
}

export interface ProductEligibility {
  readonly productCode: string;
  readonly cityStatus: CityProductStatus;
  readonly result: EligibilityResult;
}

export interface CatalogReadPolicy {
  readonly PICKUP_SNAP_MAX_METERS: number;
}

interface ProductRow {
  code: string;
  vehicle_class: VehicleClass;
  name_key: string;
  description_key: string;
  seats_max: number;
  luggage_class: LuggageClass;
  routing_profile: RoutingProfile;
  sort_order: number;
  status: CityProductStatus | null;
  is_synthetic: boolean | null;
}

const display = (p: ProductRow): ProductDisplay => ({
  nameKey: p.name_key,
  descriptionKey: p.description_key,
  seatsMax: p.seats_max,
  luggageClass: p.luggage_class,
  routingProfile: p.routing_profile,
  vehicleClass: p.vehicle_class,
  sortOrder: p.sort_order,
});

// PostGIS predicates for a zone against a point (geometry, SRID 4326, [lng, lat] order): service areas and restricted
// zones COVER (boundary inclusive); exclusions INTERSECT (boundary counts as excluded — fail closed).
const PREDICATE = (geom: string, point: string) =>
  `case when ${geom}.kind = 'EXCLUSION' then ST_Intersects(${geom}.geom, ${point}) else ST_Covers(${geom}.geom, ${point}) end`;
const PRODUCTS_OF = (zone: string) =>
  `coalesce((select array_agg(zp.product_code order by zp.product_code) from catalog.zone_products zp where zp.zone_id = ${zone}.id), '{}')`;

export class CatalogReadModel {
  constructor(
    private readonly db: Queryable,
    private readonly policy: CatalogReadPolicy,
  ) {}

  private async products(q: Queryable, cityCode: string): Promise<ProductRow[]> {
    const r = await q.query<ProductRow>(
      `select p.code, p.vehicle_class, p.name_key, p.description_key, p.seats_max, p.luggage_class, p.routing_profile, p.sort_order, c.status, c.is_synthetic
         from catalog.service_products p left join catalog.city_service_products c on c.product_code = p.code and c.city_code = $1
        order by p.sort_order`,
      [cityCode],
    );
    return r.rows;
  }

  private async activeZoneSet(q: Queryable, cityCode: string): Promise<{ id: string; version: number; isSynthetic: boolean } | null> {
    const r = await q.query<{ id: string; version: number; is_synthetic: boolean }>(
      `select id, version, is_synthetic from catalog.zone_sets where city_code = $1 and status = 'ACTIVE'`,
      [cityCode],
    );
    const s = r.rows[0];
    return s ? { id: s.id, version: s.version, isSynthetic: s.is_synthetic } : null;
  }

  /** Zones of the set touching either point, with both predicates evaluated (GiST-indexed via ST_Intersects). */
  private async zoneHits(q: Queryable, zoneSetId: string, pickup: LatLng, dropoff: LatLng): Promise<ZoneHit[]> {
    const r = await q.query<{ id: string; code: string; kind: ZoneKind; products: string[]; pickup: boolean; dropoff: boolean }>(
      `with p as (select ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326) g), d as (select ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326) g)
       select z.id, z.code, z.kind, ${PRODUCTS_OF('z')} products, ${PREDICATE('z', 'p.g')} pickup, ${PREDICATE('z', 'd.g')} dropoff
         from catalog.zones z, p, d
        where z.zone_set_id = $1 and (ST_Intersects(z.geom, p.g) or ST_Intersects(z.geom, d.g))
        order by z.code`,
      [zoneSetId, pickup.lng, pickup.lat, dropoff.lng, dropoff.lat],
    );
    return r.rows.map((z) => ({ zoneId: z.id, code: z.code, kind: z.kind, products: z.products, pickup: z.pickup, dropoff: z.dropoff }));
  }

  /** ACTIVE pickup points of the given zones within the snap radius (geodesic metres), nearest first. */
  private async pickupPoints(
    q: Queryable,
    zoneSetId: string,
    zoneIds: readonly string[],
    pickup: LatLng,
  ): Promise<Array<PickupPointCandidate & { readonly point: SnappedPickup }>> {
    const r = await q.query<{
      id: string;
      zone_id: string;
      kind: PickupPointKind;
      name_en: string;
      name_ur: string;
      instruction_key: string;
      lat: number;
      lng: number;
      distance_m: number;
      covering: Array<{ kind: ZoneKind; products: string[] }>;
    }>(
      `with p as (select ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326) g)
       select pp.id, z.id zone_id, pp.kind, pp.name_en, pp.name_ur, pp.instruction_key, ST_Y(pp.point) lat, ST_X(pp.point) lng,
              ST_Distance(pp.point::geography, p.g::geography) distance_m,
              coalesce((select json_agg(json_build_object('kind', c.kind, 'products', ${PRODUCTS_OF('c')}))
                          from catalog.zones c where c.zone_set_id = pp.zone_set_id and ${PREDICATE('c', 'pp.point')}), '[]'::json) covering
         from catalog.pickup_points pp join catalog.zones z on z.zone_set_id = pp.zone_set_id and z.code = pp.zone_code, p
        where pp.zone_set_id = $1 and z.id = any($2::uuid[]) and pp.status = 'ACTIVE' and ST_DWithin(pp.point::geography, p.g::geography, $5::float8)
        order by distance_m, pp.id`,
      [zoneSetId, zoneIds, pickup.lng, pickup.lat, this.policy.PICKUP_SNAP_MAX_METERS],
    );
    return r.rows.map((p) => ({
      id: p.id,
      zoneId: p.zone_id,
      kind: p.kind,
      distanceM: p.distance_m,
      coveringZones: p.covering.map((c): ZoneScope => ({ kind: c.kind, products: c.products })),
      point: { pickupPointId: p.id, kind: p.kind, nameEn: p.name_en, nameUr: p.name_ur, instructionKey: p.instruction_key, point: { lat: p.lat, lng: p.lng } },
    }));
  }

  private async hours(q: Queryable, zoneSetId: string): Promise<ServiceHoursRow[]> {
    const r = await q.query<{ product_code: string | null; weekday: number; opens: string; closes: string }>(
      `select product_code, weekday, opens_local::text opens, closes_local::text closes from catalog.service_hours where zone_set_id = $1`,
      [zoneSetId],
    );
    return r.rows.map((h) => ({ productCode: h.product_code, weekday: h.weekday, opensMs: parseLocalTime(h.opens), closesMs: parseLocalTime(h.closes) }));
  }

  private async districts(q: Queryable, cityCode: string, pickup: LatLng, dropoff: LatLng): Promise<{ pickup: string | null; dropoff: string | null }> {
    const district = (lng: string, lat: string) =>
      `(select code from catalog.districts where city_code = $1 and geom is not null and ST_Covers(geom, ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)) order by code limit 1)`;
    const r = await q.query<{ pickup: string | null; dropoff: string | null }>(`select ${district('$2', '$3')} pickup, ${district('$4', '$5')} dropoff`, [
      cityCode,
      pickup.lng,
      pickup.lat,
      dropoff.lng,
      dropoff.lat,
    ]);
    return { pickup: r.rows[0]?.pickup ?? null, dropoff: r.rows[0]?.dropoff ?? null };
  }

  async resolveForQuote(input: QuoteResolutionInput, q: Queryable = this.db): Promise<QuoteResolution> {
    const all = await this.products(q, input.cityCode);
    const byCode = new Map(all.map((p) => [p.code, p]));
    const requested = input.products === undefined ? null : [...new Set(input.products)];
    const unknownProductCodes = requested === null ? [] : requested.filter((c) => !byCode.has(c));
    const known = requested === null ? all : all.filter((p) => requested.includes(p.code));
    const enabled = known.filter((p) => p.status === 'ENABLED');
    const notEnabled = requested === null ? [] : known.filter((p) => p.status !== 'ENABLED').map((p) => ({ productCode: p.code, cityStatus: p.status }));
    const zoneSet = await this.activeZoneSet(q, input.cityCode);
    const districts = await this.districts(q, input.cityCode, input.pickup, input.dropoff);
    const base = { zoneSet, unknownProductCodes, notEnabled, pickupDistrictCode: districts.pickup, dropoffDistrictCode: districts.dropoff };
    const candidate = (p: ProductRow, decision: CandidateDecision): QuoteCandidate => ({
      productCode: p.code,
      display: display(p),
      cityStatus: 'ENABLED',
      isSyntheticCity: p.is_synthetic === true,
      decision,
    });
    if (!zoneSet || enabled.length === 0) {
      return { ...base, candidates: enabled.map((p) => candidate(p, { kind: 'UNAVAILABLE', reasonCode: 'ZONE_NOT_SERVED', nextOpenAt: null })) };
    }
    const zones = await this.zoneHits(q, zoneSet.id, input.pickup, input.dropoff);
    const restricting = zones.filter((z) => z.pickup && (z.kind === 'PICKUP_RESTRICTED' || z.kind === 'AIRPORT_PRECINCT')).map((z) => z.zoneId);
    const points = restricting.length > 0 ? await this.pickupPoints(q, zoneSet.id, restricting, input.pickup) : [];
    const hours = await this.hours(q, zoneSet.id);
    const candidates = enabled.map((p) => {
      const zone = decideZones(p.code, { zones, pickupPoints: points, snapMaxMeters: this.policy.PICKUP_SNAP_MAX_METERS });
      if (zone.kind !== 'SERVED') return candidate(p, { kind: 'UNAVAILABLE', reasonCode: zone.kind, nextOpenAt: null });
      if (!isOpen(hours, p.code, input.at)) {
        return candidate(p, { kind: 'UNAVAILABLE', reasonCode: 'OUTSIDE_SERVICE_HOURS', nextOpenAt: nextOpening(hours, p.code, input.at) });
      }
      let snapped: SnappedPickup | null = null;
      if (zone.snappedPickup) {
        const chosen = zone.snappedPickup.id;
        const found = points.find((x) => x.id === chosen);
        // the decision only ever picks one of `points`; never report a restricted pickup as served without its point
        if (!found) throw new Error('snapped pickup point missing from the candidate list');
        snapped = found.point;
      }
      return candidate(p, { kind: 'SERVED', snappedPickup: snapped, airportPickup: zone.airportPickup });
    });
    return { ...base, candidates };
  }

  /**
   * Whether ANY ENABLED product of the city is served at the point under the ACTIVE zone set (service area, no
   * exclusion; pickup restrictions and hours are not considered) — used by geo reverse/resolve to label a point.
   */
  async inServiceArea(cityCode: string, point: LatLng, q: Queryable = this.db): Promise<boolean> {
    const zoneSet = await this.activeZoneSet(q, cityCode);
    if (!zoneSet) return false;
    const enabled = (await this.products(q, cityCode)).filter((p) => p.status === 'ENABLED');
    if (enabled.length === 0) return false;
    const zones = (await this.zoneHits(q, zoneSet.id, point, point)).filter((z) => z.pickup);
    return enabled.some((p) => isServed(zones, p.code));
  }

  /**
   * Display data of the given products whatever their city status (product definitions are migration-owned reference
   * rows) — the quote restore shows a stored quote even after its product was suspended.
   */
  async productDisplays(productCodes: readonly string[], q: Queryable = this.db): Promise<ReadonlyMap<string, ProductDisplay>> {
    if (productCodes.length === 0) return new Map();
    const r = await q.query<ProductRow>(
      `select p.code, p.vehicle_class, p.name_key, p.description_key, p.seats_max, p.luggage_class, p.routing_profile, p.sort_order, null status, null is_synthetic
         from catalog.service_products p where p.code = any($1::text[])`,
      [[...productCodes]],
    );
    return new Map(r.rows.map((p) => [p.code, display(p)]));
  }

  /** One pickup point of any zone set (zone sets are immutable after DRAFT): the snapped point of a stored quote. */
  async pickupPoint(id: string, q: Queryable = this.db): Promise<SnappedPickup | null> {
    const r = await q.query<{ id: string; kind: PickupPointKind; name_en: string; name_ur: string; instruction_key: string; lat: number; lng: number }>(
      `select id, kind, name_en, name_ur, instruction_key, ST_Y(point) lat, ST_X(point) lng from catalog.pickup_points where id = $1`,
      [id],
    );
    const p = r.rows[0];
    return p
      ? { pickupPointId: p.id, kind: p.kind, nameEn: p.name_en, nameUr: p.name_ur, instructionKey: p.instruction_key, point: { lat: p.lat, lng: p.lng } }
      : null;
  }

  /** ENABLED products of a city with display data, in sort order (`GET /v1/catalog/products`). */
  async productsForCity(cityCode: string, q: Queryable = this.db): Promise<CatalogProductView[]> {
    return (await this.products(q, cityCode))
      .filter((p) => p.status === 'ENABLED')
      .map((p) => ({
        productCode: p.code,
        vehicleClass: p.vehicle_class,
        nameKey: p.name_key,
        descriptionKey: p.description_key,
        seatsMax: p.seats_max,
        luggageClass: p.luggage_class,
        sortOrder: p.sort_order,
      }));
  }

  /**
   * Eligibility of one vehicle for every product of the city under the product's ACTIVE rule (no rule ⇒
   * NOT_ELIGIBLE NO_ACTIVE_RULE). For the driver readiness view (P3.8 wires it into /v1/driver/compliance).
   */
  async eligibilityForVehicle(vehicle: VehicleFacts, cityCode: string, at: Date, q: Queryable = this.db): Promise<ProductEligibility[]> {
    const r = await q.query<{
      code: string;
      vehicle_class: string;
      status: CityProductStatus;
      id: string | null;
      version: number | null;
      min_model_year: number | null;
      max_vehicle_age_years: number | null;
      min_seats: number | null;
      ac_required: boolean | null;
      allowed_body_types: BodyType[] | null;
    }>(
      `select p.code, p.vehicle_class, c.status, r.id, r.version, r.min_model_year, r.max_vehicle_age_years, r.min_seats, r.ac_required, r.allowed_body_types
         from catalog.service_products p
         join catalog.city_service_products c on c.product_code = p.code and c.city_code = $1
         left join catalog.vehicle_eligibility_rules r on r.city_code = c.city_code and r.product_code = p.code and r.status = 'ACTIVE'
        order by p.sort_order`,
      [cityCode],
    );
    return r.rows.map((row) => ({
      productCode: row.code,
      cityStatus: row.status,
      result: evaluateVehicleEligibility(
        row.id === null || row.version === null
          ? null
          : {
              id: row.id,
              version: row.version,
              vehicleClass: row.vehicle_class,
              minModelYear: row.min_model_year,
              maxVehicleAgeYears: row.max_vehicle_age_years,
              minSeats: row.min_seats,
              acRequired: row.ac_required === true,
              allowedBodyTypes: row.allowed_body_types ?? [],
            },
        vehicle,
        at,
      ),
    }));
  }
}
