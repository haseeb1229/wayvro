/**
 * Zone policy (E08, T3-14; docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md §3) — pure, server-only, authoritative.
 * The geometry predicates are evaluated by PostGIS (catalog-read-model.ts); this module decides from those facts:
 *
 *  - a point is SERVED for a product iff it is covered by ≥ 1 SERVICE_AREA zone applicable to the product and lies in
 *    NO EXCLUSION zone applicable to the product (exclusion always wins; boundaries: on a service-area boundary =
 *    covered, on an exclusion boundary = excluded — fail closed; ADR-051);
 *  - pickup AND drop-off must both be served, else ZONE_NOT_SERVED;
 *  - PICKUP_RESTRICTED and AIRPORT_PRECINCT restrict the PICKUP only (a drop-off inside them is allowed): the server
 *    snaps the pickup to the nearest ACTIVE pickup point of the restricting zone(s) within the snap radius — AIRPORT
 *    points only when an airport precinct applies, otherwise any point of the restricted zone — and the snapped point
 *    must itself be served for the product; no such point ⇒ PICKUP_RESTRICTED. The request never names a pickup point.
 *  - zone applicability: a zone without product rows applies to every product.
 */
export type ZoneKind = 'SERVICE_AREA' | 'EXCLUSION' | 'PICKUP_RESTRICTED' | 'AIRPORT_PRECINCT';
export type PickupPointKind = 'AIRPORT' | 'DESIGNATED' | 'LANDMARK';

/** A zone's applicability and kind (no geometry). */
export interface ZoneScope {
  readonly kind: ZoneKind;
  /** Products the zone applies to; empty = every product. */
  readonly products: readonly string[];
}

/** A zone of the active set touching the pickup and/or drop-off (PostGIS predicates already evaluated). */
export interface ZoneHit extends ZoneScope {
  readonly zoneId: string;
  readonly code: string;
  readonly pickup: boolean;
  readonly dropoff: boolean;
}

/** An ACTIVE pickup point of a zone that contains the pickup, within the snap radius. */
export interface PickupPointCandidate {
  readonly id: string;
  readonly zoneId: string;
  readonly kind: PickupPointKind;
  readonly distanceM: number;
  /** The zones of the same set that cover (exclusions: intersect) the point itself. */
  readonly coveringZones: readonly ZoneScope[];
}

export type ZoneDecision =
  | { readonly kind: 'SERVED'; readonly snappedPickup: PickupPointCandidate | null; readonly airportPickup: boolean }
  | { readonly kind: 'ZONE_NOT_SERVED' }
  | { readonly kind: 'PICKUP_RESTRICTED' };

const appliesTo = (zone: ZoneScope, productCode: string): boolean => zone.products.length === 0 || zone.products.includes(productCode);

/** Served = in a SERVICE_AREA and in no EXCLUSION (both applicable to the product). */
export function isServed(zones: readonly ZoneScope[], productCode: string): boolean {
  const applicable = zones.filter((z) => appliesTo(z, productCode));
  return applicable.some((z) => z.kind === 'SERVICE_AREA') && !applicable.some((z) => z.kind === 'EXCLUSION');
}

const RESTRICTING: ReadonlySet<ZoneKind> = new Set<ZoneKind>(['PICKUP_RESTRICTED', 'AIRPORT_PRECINCT']);

export function decideZones(
  productCode: string,
  input: { readonly zones: readonly ZoneHit[]; readonly pickupPoints: readonly PickupPointCandidate[]; readonly snapMaxMeters: number },
): ZoneDecision {
  const atPickup = input.zones.filter((z) => z.pickup);
  const atDropoff = input.zones.filter((z) => z.dropoff);
  if (!isServed(atPickup, productCode) || !isServed(atDropoff, productCode)) return { kind: 'ZONE_NOT_SERVED' };
  const restricting = atPickup.filter((z) => RESTRICTING.has(z.kind) && appliesTo(z, productCode));
  if (restricting.length === 0) return { kind: 'SERVED', snappedPickup: null, airportPickup: false };
  const airportZones = new Set(restricting.filter((z) => z.kind === 'AIRPORT_PRECINCT').map((z) => z.zoneId));
  const zoneIds = airportZones.size > 0 ? airportZones : new Set(restricting.map((z) => z.zoneId));
  const snapped = input.pickupPoints
    .filter(
      (p) =>
        zoneIds.has(p.zoneId) &&
        (airportZones.size === 0 || p.kind === 'AIRPORT') &&
        Number.isFinite(p.distanceM) &&
        p.distanceM <= input.snapMaxMeters &&
        isServed(p.coveringZones, productCode),
    )
    .sort((a, b) => a.distanceM - b.distanceM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (!snapped) return { kind: 'PICKUP_RESTRICTED' };
  return { kind: 'SERVED', snappedPickup: snapped, airportPickup: airportZones.size > 0 };
}
