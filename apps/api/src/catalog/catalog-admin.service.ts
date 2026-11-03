/**
 * Staff catalog administration (P3.1; E08/H10/R28; T3-14/T3-15/T3-29/T3-31). Maker-checker on every configuration
 * change — enforced by this service AND by the database (CHECK approver ≠ maker, guard triggers for immutability and
 * the vehicle-class legal gate):
 *
 *  - zone sets: DRAFT (GeoJSON import with a validation report, service hours) → submit → approve/reject by a DIFFERENT
 *    staff member → activate (retires the previous ACTIVE; production refuses synthetic; outbox
 *    catalog.zone-set.activated.v1) → retire; rollback = a new DRAFT cloned from an earlier version (`supersedes_id`);
 *  - eligibility rules: the same lifecycle per (city, product);
 *  - city products: ENABLE is requested by a maker after the prerequisites are verified (ACTIVE zone set covering the
 *    product with hours + ACTIVE eligibility rule + ACTIVE rate card) and approved by a different staff member
 *    (legal_basis_ref required; production refuses SYNTHETIC* references and synthetic configuration); SUSPEND is the
 *    safe direction (one staff member, step-up at the route, reason code); resuming is maker-checker again.
 *
 * Version numbers are allocated under an advisory lock; activation is serialised per city (zone sets) or per
 * (city, product) (rules) so concurrent activations leave exactly one ACTIVE. Every transition is audited (ids and
 * reason codes only) and rider/driver-visible changes emit outbox events (ids and codes only).
 */
import { createHash } from 'node:crypto';
import type { CATALOG_REASON_CODES, ZONE_IMPORT_ISSUES } from '@wayvro/contracts';
import type { WayvroEnv } from '@wayvro/config';
import { appendAudit, sqlState, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import { z } from 'zod';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome, type Refusal } from '../platform/idempotency.js';
import { emitEvent } from '../platform/outbox.js';
import type { StaffPrincipal } from '../staff/staff-session.js';
import { applicableRows, overlappingWindows, parseLocalTime, type ServiceHoursRow } from './service-hours.js';

export interface CatalogAdminPolicy {
  readonly WAYVRO_ENV: WayvroEnv;
  readonly IDEMPOTENCY_TTL_SECONDS: number;
}

/**
 * Whether an ACTIVE rate card exists for (city, product). Implemented by the pricing module (P3.3) and wired in the
 * composition root. Until it is wired the catalog is constructed with `null`, and every ENABLE request/approval is
 * refused with RATE_CARD_CHECK_UNAVAILABLE — fail closed; there is deliberately no default implementation.
 * @public consumed by the pricing module's composition wiring
 */
export interface RateCardPresence {
  hasActiveRateCard(cityCode: string, productCode: string, q?: Queryable): Promise<boolean>;
}

type CatalogReasonCode = (typeof CATALOG_REASON_CODES)[number];
type ImportIssueCode = (typeof ZONE_IMPORT_ISSUES)[number];
type ConfigStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'RETIRED' | 'REJECTED';
type Work = (tx: pg.PoolClient) => Promise<Outcome>;

/** Pakistan envelope (PHASE3_ARCHITECTURE §5.2; coarse pre-filter): every imported coordinate must lie inside it. */
const PAKISTAN = { minLat: 23.5, maxLat: 37.2, minLng: 60.8, maxLng: 77.9 } as const;
const MAX_VERTICES = 20_000;
const ACCEPTED_CRS = new Set(['urn:ogc:def:crs:OGC:1.3:CRS84', 'urn:ogc:def:crs:OGC::CRS84', 'EPSG:4326', 'urn:ogc:def:crs:EPSG::4326']);

/**
 * Audit/outbox object id of a city product (its key is (city, product), the audit/outbox columns are uuid): a
 * deterministic RFC 9562 version-8 UUID derived from the key, so every event of one city product shares one id.
 * @internal exported for the catalog tests (audit/outbox lookups)
 */
export function cityProductObjectId(cityCode: string, productCode: string): string {
  const h = createHash('sha256').update(`catalog.city_service_product:${cityCode}:${productCode}`).digest('hex');
  const variant = ((parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ── row shapes and views ──────────────────────────────────────────────────────────────────────────────────────────
interface ZoneSetRow {
  id: string;
  city_code: string;
  version: number;
  status: ConfigStatus;
  is_synthetic: boolean;
  source_reference: string;
  supersedes_id: string | null;
  effective_from: Date | null;
  effective_until: Date | null;
  drafted_by_staff_id: string | null;
  approved_by_staff_id: string | null;
  approval_reason_code: string | null;
  created_at: Date;
  zone_count: number;
}
interface RuleRow {
  id: string;
  city_code: string;
  product_code: string;
  version: number;
  status: ConfigStatus;
  is_synthetic: boolean;
  source_reference: string;
  min_model_year: number | null;
  max_vehicle_age_years: number | null;
  min_seats: number | null;
  ac_required: boolean;
  allowed_body_types: string[];
  supersedes_id: string | null;
  effective_from: Date | null;
  effective_until: Date | null;
  drafted_by_staff_id: string | null;
  approved_by_staff_id: string | null;
  approval_reason_code: string | null;
  created_at: Date;
}
interface CityProductRow {
  city_code: string;
  product_code: string;
  vehicle_class: string;
  class_status: string;
  name_key: string;
  seats_max: number;
  luggage_class: string;
  sort_order: number;
  status: string;
  pending_transition: string | null;
  legal_basis_ref: string | null;
  is_synthetic: boolean;
  changed_by_staff_id: string | null;
  approved_by_staff_id: string | null;
  reason_code: string | null;
  updated_at: Date;
}

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;
const zoneSetSummary = (s: ZoneSetRow) => ({
  id: s.id,
  cityCode: s.city_code,
  version: s.version,
  status: s.status,
  isSynthetic: s.is_synthetic,
  sourceReference: s.source_reference,
  supersedesId: s.supersedes_id,
  effectiveFrom: iso(s.effective_from),
  effectiveUntil: iso(s.effective_until),
  draftedByStaffId: s.drafted_by_staff_id,
  approvedByStaffId: s.approved_by_staff_id,
  approvalReasonCode: s.approval_reason_code,
  createdAt: s.created_at.toISOString(),
  zoneCount: s.zone_count,
});
const ruleView = (r: RuleRow) => ({
  id: r.id,
  cityCode: r.city_code,
  productCode: r.product_code,
  version: r.version,
  status: r.status,
  isSynthetic: r.is_synthetic,
  sourceReference: r.source_reference,
  minModelYear: r.min_model_year,
  maxVehicleAgeYears: r.max_vehicle_age_years,
  minSeats: r.min_seats,
  acRequired: r.ac_required,
  allowedBodyTypes: r.allowed_body_types,
  supersedesId: r.supersedes_id,
  effectiveFrom: iso(r.effective_from),
  effectiveUntil: iso(r.effective_until),
  draftedByStaffId: r.drafted_by_staff_id,
  approvedByStaffId: r.approved_by_staff_id,
  approvalReasonCode: r.approval_reason_code,
  createdAt: r.created_at.toISOString(),
});
const cityProductView = (c: CityProductRow) => ({
  cityCode: c.city_code,
  productCode: c.product_code,
  vehicleClass: c.vehicle_class,
  nameKey: c.name_key,
  seatsMax: c.seats_max,
  luggageClass: c.luggage_class,
  sortOrder: c.sort_order,
  status: c.status,
  pendingTransition: c.pending_transition,
  legalBasisRef: c.legal_basis_ref,
  isSynthetic: c.is_synthetic,
  changedByStaffId: c.changed_by_staff_id,
  approvedByStaffId: c.approved_by_staff_id,
  reasonCode: c.reason_code,
  updatedAt: c.updated_at.toISOString(),
});

const ZONE_SET_SELECT = `select s.*, (select count(*)::int from catalog.zones z where z.zone_set_id = s.id) zone_count from catalog.zone_sets s`;
const CITY_PRODUCT_SELECT = `select c.*, p.vehicle_class, p.name_key, p.seats_max, p.luggage_class, p.sort_order, k.status class_status
  from catalog.city_service_products c join catalog.service_products p on p.code = c.product_code join catalog.service_categories k on k.code = p.vehicle_class`;

// ── GeoJSON import validation (rejects rather than repairs: no ST_MakeValid, CLAUDE.md §5) ──────────────────────────
const ZonePropertiesSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_-]{1,31}$/),
  kind: z.enum(['SERVICE_AREA', 'EXCLUSION', 'PICKUP_RESTRICTED', 'AIRPORT_PRECINCT']),
  nameEn: z.string().trim().min(1).max(80),
  nameUr: z.string().trim().min(1).max(80),
  products: z
    .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,23}$/))
    .max(8)
    .optional(),
});
const PointPropertiesSchema = z.strictObject({
  zoneCode: z.string().regex(/^[A-Z][A-Z0-9_-]{1,31}$/),
  kind: z.enum(['AIRPORT', 'DESIGNATED', 'LANDMARK']),
  nameEn: z.string().trim().min(1).max(80),
  nameUr: z.string().trim().min(1).max(80),
  instructionKey: z.string().regex(/^pickup\.[a-z0-9_.-]{1,60}$/),
  status: z.enum(['ACTIVE', 'HIDDEN']).optional(),
});

export interface GeoJsonFeatureCollection {
  readonly type: 'FeatureCollection';
  readonly crs?: unknown;
  readonly features: ReadonlyArray<{
    readonly type: 'Feature';
    readonly geometry: { readonly type: string; readonly coordinates?: unknown } | null;
    readonly properties: Readonly<Record<string, unknown>> | null;
  }>;
}

interface ImportIssue {
  featureIndex: number | null;
  code: string | null;
  issue: ImportIssueCode;
  detail: string | null;
}
interface ValidZone {
  index: number;
  props: z.infer<typeof ZonePropertiesSchema>;
  geojson: string;
}
interface ValidPoint {
  index: number;
  props: z.infer<typeof PointPropertiesSchema>;
  geojson: string;
}

type Position = readonly [number, number];
const isPosition = (p: unknown): p is Position =>
  Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const rings = (polygon: unknown): Position[] | null => {
  if (!Array.isArray(polygon)) return null;
  const out: Position[] = [];
  for (const ring of polygon) {
    if (!Array.isArray(ring) || !ring.every(isPosition)) return null;
    out.push(...ring);
  }
  return out;
};
/** Every position of a Point/Polygon/MultiPolygon, or null when the structure is malformed. */
function positionsOf(type: string, coordinates: unknown): Position[] | null {
  if (type === 'Point') return isPosition(coordinates) ? [coordinates] : null;
  if (type === 'Polygon') return rings(coordinates);
  if (type === 'MultiPolygon') {
    if (!Array.isArray(coordinates)) return null;
    const out: Position[] = [];
    for (const polygon of coordinates) {
      const r = rings(polygon);
      if (r === null) return null;
      out.push(...r);
    }
    return out;
  }
  return null;
}
const inPakistan = (lng: number, lat: number): boolean => lat >= PAKISTAN.minLat && lat <= PAKISTAN.maxLat && lng >= PAKISTAN.minLng && lng <= PAKISTAN.maxLng;

function crsAccepted(crs: unknown): boolean {
  if (crs === undefined) return true;
  if (typeof crs !== 'object' || crs === null) return false;
  const c = crs as { type?: unknown; properties?: { name?: unknown } | null };
  return c.type === 'name' && typeof c.properties?.name === 'string' && ACCEPTED_CRS.has(c.properties.name);
}

export class CatalogAdminService {
  constructor(
    private readonly db: pg.Pool,
    private readonly idempotency: IdempotencyStore,
    private readonly policy: CatalogAdminPolicy,
    private readonly rateCards: RateCardPresence | null,
  ) {}

  private run(staff: StaffPrincipal, operation: string, key: string, payload: unknown, work: Work): Promise<IdempotentResult> {
    return this.idempotency.execute({ scope: `staff:${staff.staffId}`, operation, key, payload, ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS }, work);
  }

  private get production(): boolean {
    return this.policy.WAYVRO_ENV === 'production';
  }

  /** Maker-checker denial: audited (DENIED) and answered 403 with the reason code. */
  private async deny(tx: Queryable, staff: StaffPrincipal, objectType: string, objectId: string, reasonCode: CatalogReasonCode): Promise<Refusal> {
    await appendAudit(tx, { actor: { type: 'STAFF', id: staff.staffId }, action: 'STAFF_ACCESS_DENIED', objectType, objectId, outcome: 'DENIED', reasonCode });
    return failure('WAYVRO_E_FORBIDDEN', { reasonCodes: [reasonCode] });
  }

  /** An activation/enablement refusal: audited (CATALOG_ACTIVATION_REFUSED, T3-15) and answered 409 with reason codes. */
  private async refuse(tx: Queryable, staff: StaffPrincipal, objectType: string, objectId: string, reasons: readonly CatalogReasonCode[]): Promise<Refusal> {
    await appendAudit(tx, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: 'CATALOG_ACTIVATION_REFUSED',
      objectType,
      objectId,
      outcome: 'FAILURE',
      reasonCode: reasons[0],
    });
    return failure('WAYVRO_E_CONFLICT', { reasonCodes: [...reasons] });
  }

  private async audit(tx: Queryable, staff: StaffPrincipal, action: string, objectType: string, objectId: string, reasonCode?: string): Promise<void> {
    await appendAudit(tx, {
      actor: { type: 'STAFF', id: staff.staffId },
      action,
      objectType,
      objectId,
      outcome: 'SUCCESS',
      ...(reasonCode ? { reasonCode } : {}),
    });
  }

  // ── zone sets ────────────────────────────────────────────────────────────────────────────────────────────────
  private async zoneSetRow(q: Queryable, id: string, lock: '' | 'for update' = ''): Promise<ZoneSetRow | undefined> {
    if (lock === '') return (await q.query<ZoneSetRow>(`${ZONE_SET_SELECT} where s.id = $1`, [id])).rows[0];
    const locked = (await q.query<{ id: string }>(`select id from catalog.zone_sets where id = $1 for update`, [id])).rows[0];
    return locked ? (await q.query<ZoneSetRow>(`${ZONE_SET_SELECT} where s.id = $1`, [id])).rows[0] : undefined;
  }

  private async zoneSetView(q: Queryable, id: string): Promise<unknown> {
    const s = await this.zoneSetRow(q, id);
    if (!s) return null;
    const zones = await q.query<{
      code: string;
      kind: string;
      name_en: string;
      name_ur: string;
      products: string[];
      polygons: number;
      vertices: number;
      area_km2: number;
      min_lat: number;
      min_lng: number;
      max_lat: number;
      max_lng: number;
    }>(
      `select z.code, z.kind, z.name_en, z.name_ur,
              coalesce((select array_agg(zp.product_code order by zp.product_code) from catalog.zone_products zp where zp.zone_id = z.id), '{}') products,
              ST_NumGeometries(z.geom) polygons, ST_NPoints(z.geom) vertices, ST_Area(z.geom::geography) / 1e6 area_km2,
              round(ST_YMin(z.geom)::numeric, 6)::float8 min_lat, round(ST_XMin(z.geom)::numeric, 6)::float8 min_lng,
              round(ST_YMax(z.geom)::numeric, 6)::float8 max_lat, round(ST_XMax(z.geom)::numeric, 6)::float8 max_lng
         from catalog.zones z where z.zone_set_id = $1 order by z.code`,
      [id],
    );
    const points = await q.query<{
      id: string;
      zone_code: string;
      kind: string;
      name_en: string;
      name_ur: string;
      instruction_key: string;
      status: string;
      lat: number;
      lng: number;
    }>(
      `select id, zone_code, kind, name_en, name_ur, instruction_key, status, ST_Y(point) lat, ST_X(point) lng
         from catalog.pickup_points where zone_set_id = $1 order by zone_code, name_en`,
      [id],
    );
    const hours = await q.query<{ product_code: string | null; weekday: number; opens: string; closes: string }>(
      `select product_code, weekday, to_char(opens_local, 'HH24:MI') opens, to_char(closes_local, 'HH24:MI') closes
         from catalog.service_hours where zone_set_id = $1 order by product_code nulls first, weekday, opens_local`,
      [id],
    );
    return {
      ...zoneSetSummary(s),
      zones: zones.rows.map((z) => ({
        code: z.code,
        kind: z.kind,
        nameEn: z.name_en,
        nameUr: z.name_ur,
        products: z.products,
        polygonCount: z.polygons,
        vertexCount: z.vertices,
        areaKm2: Math.round(z.area_km2 * 1000) / 1000,
        bbox: { minLat: z.min_lat, minLng: z.min_lng, maxLat: z.max_lat, maxLng: z.max_lng },
      })),
      pickupPoints: points.rows.map((p) => ({
        id: p.id,
        zoneCode: p.zone_code,
        kind: p.kind,
        nameEn: p.name_en,
        nameUr: p.name_ur,
        instructionKey: p.instruction_key,
        status: p.status,
        lat: p.lat,
        lng: p.lng,
      })),
      serviceHours: hours.rows.map((h) => ({ productCode: h.product_code, weekday: h.weekday, opensLocal: h.opens, closesLocal: h.closes })),
    };
  }

  async listZoneSets(cityCode: string | undefined): Promise<unknown> {
    const r = await this.db.query<ZoneSetRow>(
      `${ZONE_SET_SELECT} where ($1::text is null or s.city_code = $1) order by s.city_code, s.version desc limit 200`,
      [cityCode ?? null],
    );
    return { zoneSets: r.rows.map(zoneSetSummary) };
  }

  getZoneSet(id: string): Promise<unknown> {
    return this.zoneSetView(this.db, id);
  }

  draftZoneSet(
    staff: StaffPrincipal,
    input: { cityCode: string; sourceReference: string; isSynthetic?: boolean | undefined },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(staff, 'catalog.zone-sets.draft', key, input, async (tx) => {
      const id = uuidv7();
      await tx.query('savepoint draft_zone_set');
      try {
        await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.zone-set:' || $1))`, [input.cityCode]);
        await tx.query(
          `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference, drafted_by_staff_id)
           select $1, $2, coalesce(max(version), 0) + 1, 'DRAFT', $3, $4, $5 from catalog.zone_sets where city_code = $2`,
          [id, input.cityCode, input.isSynthetic ?? false, input.sourceReference, staff.staffId],
        );
      } catch (e) {
        if (sqlState(e) !== '23503') throw e;
        await tx.query('rollback to savepoint draft_zone_set');
        return failure('WAYVRO_E_VALIDATION');
      }
      await this.audit(tx, staff, 'ZONE_SET_DRAFTED', 'catalog.zone_set', id);
      return success(201, await this.zoneSetView(tx, id));
    });
  }

  /** Locks a zone set for a DRAFT edit; 404 / 409 otherwise. */
  private async lockDraft(tx: Queryable, id: string): Promise<ZoneSetRow | Refusal> {
    const s = await this.zoneSetRow(tx, id, 'for update');
    if (!s) return failure('WAYVRO_E_NOT_FOUND');
    if (s.status !== 'DRAFT') return failure('WAYVRO_E_CONFLICT');
    return s;
  }

  /** Runs a geometry statement in a savepoint; a PostGIS parse error becomes `null` (reported, never repaired). */
  private async geometryQuery<R extends pg.QueryResultRow>(tx: Queryable, sql: string, values: unknown[]): Promise<R | null> {
    await tx.query('savepoint geometry_check');
    try {
      const row = (await tx.query<R>(sql, values)).rows[0] ?? null;
      await tx.query('release savepoint geometry_check');
      return row;
    } catch (e) {
      const state = sqlState(e);
      // XX000 internal_error / 22023 invalid_parameter_value / 22P02 invalid_text_representation: PostGIS refused the GeoJSON
      if (state !== 'XX000' && state !== '22023' && state !== '22P02') throw e;
      await tx.query('rollback to savepoint geometry_check');
      return null;
    }
  }

  private async validateImport(tx: Queryable, fc: GeoJsonFeatureCollection): Promise<{ issues: ImportIssue[]; zones: ValidZone[]; points: ValidPoint[] }> {
    const issues: ImportIssue[] = [];
    const issue = (featureIndex: number | null, code: string | null, kind: ImportIssueCode, detail: string | null = null) =>
      issues.push({ featureIndex, code, issue: kind, detail });
    if (!crsAccepted(fc.crs)) issue(null, null, 'SRID_UNSUPPORTED', 'only WGS84 (EPSG:4326 / CRS84) is accepted');
    const knownProducts = new Set((await tx.query<{ code: string }>(`select code from catalog.service_products`)).rows.map((r) => r.code));
    const zones: ValidZone[] = [];
    const points: ValidPoint[] = [];
    for (const [index, feature] of fc.features.entries()) {
      const geometry = feature.geometry;
      if (geometry === null) {
        issue(index, null, 'FEATURE_INVALID', 'feature has no geometry');
        continue;
      }
      const isPoint = geometry.type === 'Point';
      if (!isPoint && geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
        issue(index, null, 'UNSUPPORTED_GEOMETRY', geometry.type.slice(0, 40));
        continue;
      }
      const props = (isPoint ? PointPropertiesSchema : ZonePropertiesSchema).safeParse(feature.properties ?? {});
      const code = props.success ? ('code' in props.data ? props.data.code : props.data.zoneCode) : null;
      if (!props.success)
        issue(
          index,
          null,
          'PROPERTIES_INVALID',
          props.error.issues
            .map((i) => i.path.join('.') || 'properties')
            .join(', ')
            .slice(0, 200),
        );
      const positions = positionsOf(geometry.type, geometry.coordinates);
      if (positions === null) {
        issue(index, code, 'COORDINATES_INVALID', 'positions must be [longitude, latitude] pairs of finite numbers');
        continue;
      }
      if (positions.length > MAX_VERTICES) {
        issue(index, code, 'TOO_MANY_VERTICES', `${String(positions.length)} > ${String(MAX_VERTICES)}`);
        continue;
      }
      if (!positions.every(([lng, lat]) => inPakistan(lng, lat))) {
        const swapped = positions.length > 0 && positions.every(([a, b]) => inPakistan(b, a));
        issue(index, code, swapped ? 'AXIS_ORDER_SWAPPED' : 'OUTSIDE_PAKISTAN_ENVELOPE', swapped ? 'coordinates look like [latitude, longitude]' : null);
        continue;
      }
      const geojson = JSON.stringify({ type: geometry.type, coordinates: geometry.coordinates });
      const check = await this.geometryQuery<{ valid: boolean; reason: string; empty: boolean }>(
        tx,
        `select ST_IsValid(g) valid, ST_IsValidReason(g) reason, ST_IsEmpty(g) empty from (select ST_GeomFromGeoJSON($1) g) x`,
        [geojson],
      );
      if (check === null) {
        issue(index, code, 'GEOMETRY_INVALID', 'the geometry could not be parsed (e.g. an unclosed ring)');
        continue;
      }
      if (check.empty) {
        issue(index, code, 'GEOMETRY_EMPTY');
        continue;
      }
      if (!check.valid) {
        issue(index, code, 'GEOMETRY_INVALID', check.reason.slice(0, 200));
        continue;
      }
      if (!props.success) continue;
      if ('code' in props.data) {
        const unknown = (props.data.products ?? []).filter((p) => !knownProducts.has(p));
        if (unknown.length > 0) {
          issue(index, props.data.code, 'UNKNOWN_PRODUCT', unknown.join(',').slice(0, 200));
          continue;
        }
        zones.push({ index, props: props.data, geojson });
      } else {
        points.push({ index, props: props.data, geojson });
      }
    }
    const seen = new Set<string>();
    for (const z of zones) {
      if (seen.has(z.props.code)) issue(z.index, z.props.code, 'DUPLICATE_ZONE_CODE');
      seen.add(z.props.code);
    }
    if (!zones.some((z) => z.props.kind === 'SERVICE_AREA')) issue(null, null, 'NO_SERVICE_AREA');
    // the first feature of a code is authoritative (duplicates are already reported)
    const zoneByCode = new Map<string, ValidZone>();
    for (const z of zones) if (!zoneByCode.has(z.props.code)) zoneByCode.set(z.props.code, z);
    const pointNames = new Set<string>();
    for (const p of points) {
      const zone = zoneByCode.get(p.props.zoneCode);
      const nameKey = `${p.props.zoneCode}|${p.props.nameEn}`;
      if (pointNames.has(nameKey)) issue(p.index, p.props.zoneCode, 'DUPLICATE_PICKUP_POINT');
      pointNames.add(nameKey);
      if (!zone) {
        issue(p.index, p.props.zoneCode, 'PICKUP_POINT_ZONE_UNKNOWN');
        continue;
      }
      if (p.props.kind === 'AIRPORT' && zone.props.kind !== 'AIRPORT_PRECINCT') issue(p.index, p.props.zoneCode, 'AIRPORT_POINT_OUTSIDE_PRECINCT');
      const inside = await this.geometryQuery<{ inside: boolean }>(tx, `select ST_Covers(ST_GeomFromGeoJSON($1), ST_GeomFromGeoJSON($2)) inside`, [
        zone.geojson,
        p.geojson,
      ]);
      if (inside?.inside !== true) issue(p.index, p.props.zoneCode, 'PICKUP_POINT_OUTSIDE_ZONE');
    }
    return { issues, zones, points };
  }

  importZones(staff: StaffPrincipal, id: string, featureCollection: GeoJsonFeatureCollection, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'catalog.zone-sets.import', key, { id, featureCollection }, async (tx) => {
      const draft = await this.lockDraft(tx, id);
      if ('kind' in draft) return draft;
      const { issues, zones, points } = await this.validateImport(tx, featureCollection);
      const counts = async () =>
        (
          await tx.query<{ zones: number; points: number }>(
            `select (select count(*)::int from catalog.zones where zone_set_id = $1) zones, (select count(*)::int from catalog.pickup_points where zone_set_id = $1) points`,
            [id],
          )
        ).rows[0] ?? { zones: 0, points: 0 };
      if (issues.length > 0) {
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'ZONE_SET_IMPORT_REJECTED',
          objectType: 'catalog.zone_set',
          objectId: id,
          outcome: 'FAILURE',
          reasonCode: issues[0]?.issue,
        });
        const c = await counts();
        return success(200, { applied: false, issues, zoneCount: c.zones, pickupPointCount: c.points, zoneSet: await this.zoneSetView(tx, id) });
      }
      await tx.query(`delete from catalog.pickup_points where zone_set_id = $1`, [id]);
      await tx.query(`delete from catalog.zone_products where zone_id in (select z.id from catalog.zones z where z.zone_set_id = $1)`, [id]);
      await tx.query(`delete from catalog.zones where zone_set_id = $1`, [id]);
      for (const z of zones) {
        const zoneId = uuidv7();
        // A plain Polygon is stored as a one-part MultiPolygon (typmod MultiPolygon,4326; GEOM-03).
        await tx.query(
          `insert into catalog.zones (id, zone_set_id, code, kind, name_en, name_ur, geom) values ($1, $2, $3, $4, $5, $6, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)))`,
          [zoneId, id, z.props.code, z.props.kind, z.props.nameEn, z.props.nameUr, z.geojson],
        );
        for (const product of new Set(z.props.products ?? [])) {
          await tx.query(`insert into catalog.zone_products (zone_id, product_code) values ($1, $2)`, [zoneId, product]);
        }
      }
      for (const p of points) {
        await tx.query(
          `insert into catalog.pickup_points (id, zone_set_id, zone_code, kind, point, name_en, name_ur, instruction_key, status)
           values ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), $6, $7, $8, $9)`,
          [uuidv7(), id, p.props.zoneCode, p.props.kind, p.geojson, p.props.nameEn, p.props.nameUr, p.props.instructionKey, p.props.status ?? 'ACTIVE'],
        );
      }
      await tx.query(`update catalog.zone_sets set version_lock = version_lock + 1 where id = $1`, [id]);
      await this.audit(tx, staff, 'ZONE_SET_ZONES_IMPORTED', 'catalog.zone_set', id);
      const c = await counts();
      return success(200, { applied: true, issues: [], zoneCount: c.zones, pickupPointCount: c.points, zoneSet: await this.zoneSetView(tx, id) });
    });
  }

  replaceServiceHours(
    staff: StaffPrincipal,
    id: string,
    hours: ReadonlyArray<{ productCode: string | null; weekday: number; opensLocal: string; closesLocal: string }>,
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(staff, 'catalog.zone-sets.hours', key, { id, hours }, async (tx) => {
      const draft = await this.lockDraft(tx, id);
      if ('kind' in draft) return draft;
      const rows: ServiceHoursRow[] = hours.map((h) => ({
        productCode: h.productCode,
        weekday: h.weekday,
        opensMs: parseLocalTime(h.opensLocal),
        closesMs: parseLocalTime(h.closesLocal),
      }));
      if (rows.some((r) => r.opensMs > r.closesMs)) return failure('WAYVRO_E_VALIDATION');
      if (overlappingWindows(rows).length > 0) return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['SERVICE_HOURS_OVERLAP'] });
      await tx.query(`delete from catalog.service_hours where zone_set_id = $1`, [id]);
      await tx.query('savepoint hours');
      try {
        for (const h of hours) {
          await tx.query(
            `insert into catalog.service_hours (id, zone_set_id, product_code, weekday, opens_local, closes_local) values ($1, $2, $3, $4, $5::time, $6::time)`,
            [uuidv7(), id, h.productCode, h.weekday, h.opensLocal, h.closesLocal],
          );
        }
      } catch (e) {
        const state = sqlState(e);
        if (state !== '23503' && state !== '23505' && state !== '23514') throw e;
        await tx.query('rollback to savepoint hours');
        return failure('WAYVRO_E_VALIDATION');
      }
      await tx.query(`update catalog.zone_sets set version_lock = version_lock + 1 where id = $1`, [id]);
      await this.audit(tx, staff, 'ZONE_SET_HOURS_REPLACED', 'catalog.zone_set', id);
      return success(200, await this.zoneSetView(tx, id));
    });
  }

  private async zoneSetHours(q: Queryable, zoneSetId: string): Promise<ServiceHoursRow[]> {
    const r = await q.query<{ product_code: string | null; weekday: number; opens: string; closes: string }>(
      `select product_code, weekday, opens_local::text opens, closes_local::text closes from catalog.service_hours where zone_set_id = $1`,
      [zoneSetId],
    );
    return r.rows.map((h) => ({ productCode: h.product_code, weekday: h.weekday, opensMs: parseLocalTime(h.opens), closesMs: parseLocalTime(h.closes) }));
  }

  /** Shared transition shell: idempotent, row locked (and the city activation lock taken first when asked), audited. */
  private transitionZoneSet(
    staff: StaffPrincipal,
    id: string,
    operation: string,
    key: string,
    payload: unknown,
    apply: (tx: pg.PoolClient, s: ZoneSetRow) => Promise<string | Refusal>,
    cityLock = false,
  ): Promise<IdempotentResult> {
    return this.run(staff, operation, key, payload, async (tx) => {
      if (cityLock) {
        const city = (await tx.query<{ city_code: string }>(`select city_code from catalog.zone_sets where id = $1`, [id])).rows[0];
        if (!city) return failure('WAYVRO_E_NOT_FOUND');
        await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.zone-set.activate:' || $1))`, [city.city_code]);
      }
      const s = await this.zoneSetRow(tx, id, 'for update');
      if (!s) return failure('WAYVRO_E_NOT_FOUND');
      const outcome = await apply(tx, s);
      if (typeof outcome !== 'string') return outcome;
      await this.audit(tx, staff, outcome, 'catalog.zone_set', id);
      return success(200, await this.zoneSetView(tx, id));
    });
  }

  submitZoneSet(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionZoneSet(staff, id, 'catalog.zone-sets.submit', key, { id }, async (tx, s) => {
      if (s.status !== 'DRAFT') return failure('WAYVRO_E_CONFLICT');
      const sa = await tx.query(`select 1 from catalog.zones where zone_set_id = $1 and kind = 'SERVICE_AREA' limit 1`, [id]);
      if (sa.rowCount === 0) return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['NO_SERVICE_AREA'] });
      if (overlappingWindows(await this.zoneSetHours(tx, id)).length > 0) return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['SERVICE_HOURS_OVERLAP'] });
      await tx.query(`update catalog.zone_sets set status = 'PENDING_APPROVAL', version_lock = version_lock + 1 where id = $1`, [id]);
      return 'ZONE_SET_SUBMITTED';
    });
  }

  decideZoneSet(staff: StaffPrincipal, id: string, decision: 'APPROVE' | 'REJECT', reasonCode: string | undefined, key: string): Promise<IdempotentResult> {
    return this.transitionZoneSet(staff, id, 'catalog.zone-sets.decide', key, { id, decision, reasonCode }, async (tx, s) => {
      if (s.status !== 'PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      if (s.drafted_by_staff_id === staff.staffId) return this.deny(tx, staff, 'catalog.zone_set', id, 'MAKER_IS_CHECKER');
      await tx.query(
        `update catalog.zone_sets set status = $2, approved_by_staff_id = case when $2 = 'APPROVED' then $3::uuid end, approval_reason_code = $4,
                version_lock = version_lock + 1 where id = $1`,
        [id, decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', staff.staffId, reasonCode ?? null],
      );
      return decision === 'APPROVE' ? 'ZONE_SET_APPROVED' : 'ZONE_SET_REJECTED';
    });
  }

  activateZoneSet(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionZoneSet(
      staff,
      id,
      'catalog.zone-sets.activate',
      key,
      { id },
      async (tx, s) => {
        if (s.status !== 'APPROVED') return failure('WAYVRO_E_CONFLICT');
        if (s.is_synthetic && this.production) return this.refuse(tx, staff, 'catalog.zone_set', id, ['SYNTHETIC_REFUSED_IN_PRODUCTION']);
        // an ENABLED product must keep service hours under the new set (fail closed would silently stop it)
        const enabled = await tx.query<{ product_code: string }>(
          `select product_code from catalog.city_service_products where city_code = $1 and status = 'ENABLED'`,
          [s.city_code],
        );
        const hours = await this.zoneSetHours(tx, id);
        if (enabled.rows.some((p) => applicableRows(hours, p.product_code).length === 0)) {
          return this.refuse(tx, staff, 'catalog.zone_set', id, ['ENABLED_PRODUCT_WITHOUT_HOURS']);
        }
        const previous = await tx.query<{ id: string }>(
          `update catalog.zone_sets set status = 'RETIRED', effective_until = clock_timestamp(), version_lock = version_lock + 1
            where city_code = $1 and status = 'ACTIVE' returning id`,
          [s.city_code],
        );
        await tx.query(`update catalog.zone_sets set status = 'ACTIVE', effective_from = clock_timestamp(), version_lock = version_lock + 1 where id = $1`, [
          id,
        ]);
        await emitEvent(tx, {
          type: 'catalog.zone-set.activated.v1',
          aggregateType: 'catalog.zone_set',
          aggregateId: id,
          accountId: null,
          payload: { cityCode: s.city_code, version: s.version, previousZoneSetId: previous.rows[0]?.id ?? null },
        });
        return 'ZONE_SET_ACTIVATED';
      },
      true,
    );
  }

  retireZoneSet(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionZoneSet(
      staff,
      id,
      'catalog.zone-sets.retire',
      key,
      { id },
      async (tx, s) => {
        if (s.status !== 'ACTIVE' && s.status !== 'APPROVED') return failure('WAYVRO_E_CONFLICT');
        await tx.query(
          `update catalog.zone_sets set status = 'RETIRED', effective_until = case when status = 'ACTIVE' then clock_timestamp() end, version_lock = version_lock + 1
            where id = $1`,
          [id],
        );
        if (s.status === 'ACTIVE') {
          await emitEvent(tx, {
            type: 'catalog.zone-set.retired.v1',
            aggregateType: 'catalog.zone_set',
            aggregateId: id,
            accountId: null,
            payload: { cityCode: s.city_code, version: s.version },
          });
        }
        return 'ZONE_SET_RETIRED';
      },
      true,
    );
  }

  /** New DRAFT copied (zones, product scopes, hours, pickup points) from an approved/active/retired version. */
  cloneZoneSet(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'catalog.zone-sets.clone', key, { id }, async (tx) => {
      const source = await this.zoneSetRow(tx, id);
      if (!source) return failure('WAYVRO_E_NOT_FOUND');
      if (source.status !== 'APPROVED' && source.status !== 'ACTIVE' && source.status !== 'RETIRED') return failure('WAYVRO_E_CONFLICT');
      const clone = uuidv7();
      await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.zone-set:' || $1))`, [source.city_code]);
      await tx.query(
        `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference, supersedes_id, drafted_by_staff_id)
         select $1, $2, coalesce(max(version), 0) + 1, 'DRAFT', $3, $4, $5, $6 from catalog.zone_sets where city_code = $2`,
        [clone, source.city_code, source.is_synthetic, source.source_reference, id, staff.staffId],
      );
      const zones = await tx.query<{ id: string }>(`select id from catalog.zones where zone_set_id = $1 order by code`, [id]);
      for (const z of zones.rows) {
        const zoneId = uuidv7();
        await tx.query(
          `insert into catalog.zones (id, zone_set_id, code, kind, name_en, name_ur, geom) select $1, $2, code, kind, name_en, name_ur, geom from catalog.zones where id = $3`,
          [zoneId, clone, z.id],
        );
        await tx.query(`insert into catalog.zone_products (zone_id, product_code) select $1, product_code from catalog.zone_products where zone_id = $2`, [
          zoneId,
          z.id,
        ]);
      }
      const hours = await tx.query<{ id: string }>(`select id from catalog.service_hours where zone_set_id = $1`, [id]);
      for (const h of hours.rows) {
        await tx.query(
          `insert into catalog.service_hours (id, zone_set_id, product_code, weekday, opens_local, closes_local, timezone)
           select $1, $2, product_code, weekday, opens_local, closes_local, timezone from catalog.service_hours where id = $3`,
          [uuidv7(), clone, h.id],
        );
      }
      const points = await tx.query<{ id: string }>(`select id from catalog.pickup_points where zone_set_id = $1`, [id]);
      for (const p of points.rows) {
        await tx.query(
          `insert into catalog.pickup_points (id, zone_set_id, zone_code, kind, point, name_en, name_ur, instruction_key, status)
           select $1, $2, zone_code, kind, point, name_en, name_ur, instruction_key, status from catalog.pickup_points where id = $3`,
          [uuidv7(), clone, p.id],
        );
      }
      await this.audit(tx, staff, 'ZONE_SET_CLONED', 'catalog.zone_set', clone);
      return success(201, await this.zoneSetView(tx, clone));
    });
  }

  // ── eligibility rules ──────────────────────────────────────────────────────────────────────────────────────────
  private async ruleRow(q: Queryable, id: string, lock: '' | 'for update' = ''): Promise<RuleRow | undefined> {
    return (await q.query<RuleRow>(`select * from catalog.vehicle_eligibility_rules where id = $1 ${lock}`, [id])).rows[0];
  }

  async listRules(cityCode: string | undefined): Promise<unknown> {
    const r = await this.db.query<RuleRow>(
      `select * from catalog.vehicle_eligibility_rules where ($1::text is null or city_code = $1) order by city_code, product_code, version desc limit 200`,
      [cityCode ?? null],
    );
    return { rules: r.rows.map(ruleView) };
  }

  async getRule(id: string): Promise<unknown> {
    const r = await this.ruleRow(this.db, id);
    return r ? ruleView(r) : null;
  }

  draftRule(
    staff: StaffPrincipal,
    input: {
      cityCode: string;
      productCode: string;
      sourceReference: string;
      isSynthetic?: boolean | undefined;
      minModelYear: number | null;
      maxVehicleAgeYears: number | null;
      minSeats: number | null;
      acRequired: boolean;
      allowedBodyTypes: readonly string[];
    },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(staff, 'catalog.eligibility-rules.draft', key, input, async (tx) => {
      const id = uuidv7();
      await tx.query('savepoint draft_rule');
      try {
        await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.eligibility-rule:' || $1 || ':' || $2))`, [input.cityCode, input.productCode]);
        await tx.query(
          `insert into catalog.vehicle_eligibility_rules (id, city_code, product_code, version, status, is_synthetic, source_reference, min_model_year,
                                                          max_vehicle_age_years, min_seats, ac_required, allowed_body_types, drafted_by_staff_id)
           select $1, $2, $3, coalesce(max(version), 0) + 1, 'DRAFT', $4, $5, $6, $7, $8, $9, $10, $11
             from catalog.vehicle_eligibility_rules where city_code = $2 and product_code = $3`,
          [
            id,
            input.cityCode,
            input.productCode,
            input.isSynthetic ?? false,
            input.sourceReference,
            input.minModelYear,
            input.maxVehicleAgeYears,
            input.minSeats,
            input.acRequired,
            [...input.allowedBodyTypes],
            staff.staffId,
          ],
        );
      } catch (e) {
        const state = sqlState(e);
        if (state !== '23503' && state !== '23514') throw e;
        await tx.query('rollback to savepoint draft_rule');
        return failure('WAYVRO_E_VALIDATION');
      }
      await this.audit(tx, staff, 'ELIGIBILITY_RULE_DRAFTED', 'catalog.vehicle_eligibility_rule', id);
      const row = await this.ruleRow(tx, id);
      if (!row) throw new Error('eligibility rule vanished');
      return success(201, ruleView(row));
    });
  }

  private transitionRule(
    staff: StaffPrincipal,
    id: string,
    operation: string,
    key: string,
    payload: unknown,
    apply: (tx: pg.PoolClient, r: RuleRow) => Promise<string | Refusal>,
    productLock = false,
  ): Promise<IdempotentResult> {
    return this.run(staff, operation, key, payload, async (tx) => {
      if (productLock) {
        const k = (
          await tx.query<{ city_code: string; product_code: string }>(`select city_code, product_code from catalog.vehicle_eligibility_rules where id = $1`, [
            id,
          ])
        ).rows[0];
        if (!k) return failure('WAYVRO_E_NOT_FOUND');
        await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.eligibility-rule.activate:' || $1 || ':' || $2))`, [k.city_code, k.product_code]);
      }
      const r = await this.ruleRow(tx, id, 'for update');
      if (!r) return failure('WAYVRO_E_NOT_FOUND');
      const outcome = await apply(tx, r);
      if (typeof outcome !== 'string') return outcome;
      await this.audit(tx, staff, outcome, 'catalog.vehicle_eligibility_rule', id);
      const fresh = await this.ruleRow(tx, id);
      if (!fresh) throw new Error('eligibility rule vanished');
      return success(200, ruleView(fresh));
    });
  }

  submitRule(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionRule(staff, id, 'catalog.eligibility-rules.submit', key, { id }, async (tx, r) => {
      if (r.status !== 'DRAFT') return failure('WAYVRO_E_CONFLICT');
      await tx.query(`update catalog.vehicle_eligibility_rules set status = 'PENDING_APPROVAL', version_lock = version_lock + 1 where id = $1`, [id]);
      return 'ELIGIBILITY_RULE_SUBMITTED';
    });
  }

  decideRule(staff: StaffPrincipal, id: string, decision: 'APPROVE' | 'REJECT', reasonCode: string | undefined, key: string): Promise<IdempotentResult> {
    return this.transitionRule(staff, id, 'catalog.eligibility-rules.decide', key, { id, decision, reasonCode }, async (tx, r) => {
      if (r.status !== 'PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      if (r.drafted_by_staff_id === staff.staffId) return this.deny(tx, staff, 'catalog.vehicle_eligibility_rule', id, 'MAKER_IS_CHECKER');
      await tx.query(
        `update catalog.vehicle_eligibility_rules set status = $2, approved_by_staff_id = case when $2 = 'APPROVED' then $3::uuid end, approval_reason_code = $4,
                version_lock = version_lock + 1 where id = $1`,
        [id, decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', staff.staffId, reasonCode ?? null],
      );
      return decision === 'APPROVE' ? 'ELIGIBILITY_RULE_APPROVED' : 'ELIGIBILITY_RULE_REJECTED';
    });
  }

  activateRule(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionRule(
      staff,
      id,
      'catalog.eligibility-rules.activate',
      key,
      { id },
      async (tx, r) => {
        if (r.status !== 'APPROVED') return failure('WAYVRO_E_CONFLICT');
        if (r.is_synthetic && this.production) return this.refuse(tx, staff, 'catalog.vehicle_eligibility_rule', id, ['SYNTHETIC_REFUSED_IN_PRODUCTION']);
        const previous = await tx.query<{ id: string }>(
          `update catalog.vehicle_eligibility_rules set status = 'RETIRED', effective_until = clock_timestamp(), version_lock = version_lock + 1
            where city_code = $1 and product_code = $2 and status = 'ACTIVE' returning id`,
          [r.city_code, r.product_code],
        );
        await tx.query(
          `update catalog.vehicle_eligibility_rules set status = 'ACTIVE', effective_from = clock_timestamp(), version_lock = version_lock + 1 where id = $1`,
          [id],
        );
        await emitEvent(tx, {
          type: 'catalog.eligibility-rule.activated.v1',
          aggregateType: 'catalog.vehicle_eligibility_rule',
          aggregateId: id,
          accountId: null,
          payload: { cityCode: r.city_code, productCode: r.product_code, version: r.version, previousRuleId: previous.rows[0]?.id ?? null },
        });
        return 'ELIGIBILITY_RULE_ACTIVATED';
      },
      true,
    );
  }

  retireRule(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.transitionRule(
      staff,
      id,
      'catalog.eligibility-rules.retire',
      key,
      { id },
      async (tx, r) => {
        if (r.status !== 'ACTIVE' && r.status !== 'APPROVED') return failure('WAYVRO_E_CONFLICT');
        await tx.query(
          `update catalog.vehicle_eligibility_rules set status = 'RETIRED', effective_until = case when status = 'ACTIVE' then clock_timestamp() end,
                  version_lock = version_lock + 1 where id = $1`,
          [id],
        );
        if (r.status === 'ACTIVE') {
          await emitEvent(tx, {
            type: 'catalog.eligibility-rule.retired.v1',
            aggregateType: 'catalog.vehicle_eligibility_rule',
            aggregateId: id,
            accountId: null,
            payload: { cityCode: r.city_code, productCode: r.product_code, version: r.version },
          });
        }
        return 'ELIGIBILITY_RULE_RETIRED';
      },
      true,
    );
  }

  cloneRule(staff: StaffPrincipal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'catalog.eligibility-rules.clone', key, { id }, async (tx) => {
      const source = await this.ruleRow(tx, id);
      if (!source) return failure('WAYVRO_E_NOT_FOUND');
      if (source.status !== 'APPROVED' && source.status !== 'ACTIVE' && source.status !== 'RETIRED') return failure('WAYVRO_E_CONFLICT');
      const clone = uuidv7();
      await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.eligibility-rule:' || $1 || ':' || $2))`, [source.city_code, source.product_code]);
      await tx.query(
        `insert into catalog.vehicle_eligibility_rules (id, city_code, product_code, version, status, is_synthetic, source_reference, min_model_year,
                                                        max_vehicle_age_years, min_seats, ac_required, allowed_body_types, supersedes_id, drafted_by_staff_id)
         select $1, s.city_code, s.product_code, (select max(version) + 1 from catalog.vehicle_eligibility_rules v where v.city_code = s.city_code and v.product_code = s.product_code),
                'DRAFT', s.is_synthetic, s.source_reference, s.min_model_year, s.max_vehicle_age_years, s.min_seats, s.ac_required, s.allowed_body_types, s.id, $3
           from catalog.vehicle_eligibility_rules s where s.id = $2`,
        [clone, id, staff.staffId],
      );
      await this.audit(tx, staff, 'ELIGIBILITY_RULE_CLONED', 'catalog.vehicle_eligibility_rule', clone);
      const row = await this.ruleRow(tx, clone);
      if (!row) throw new Error('eligibility rule vanished');
      return success(201, ruleView(row));
    });
  }

  // ── city products ──────────────────────────────────────────────────────────────────────────────────────────────
  async listCityProducts(cityCode: string | undefined): Promise<unknown> {
    const r = await this.db.query<CityProductRow>(`${CITY_PRODUCT_SELECT} where ($1::text is null or c.city_code = $1) order by c.city_code, p.sort_order`, [
      cityCode ?? null,
    ]);
    return { products: r.rows.map(cityProductView) };
  }

  private async cityProduct(q: Queryable, cityCode: string, productCode: string, lock: boolean): Promise<CityProductRow | undefined> {
    if (lock) {
      const locked = await q.query(`select 1 from catalog.city_service_products where city_code = $1 and product_code = $2 for update`, [
        cityCode,
        productCode,
      ]);
      if (locked.rowCount === 0) return undefined;
    }
    return (await q.query<CityProductRow>(`${CITY_PRODUCT_SELECT} where c.city_code = $1 and c.product_code = $2`, [cityCode, productCode])).rows[0];
  }

  /**
   * ENABLE prerequisites (re-verified at request AND approval; the quote re-checks live): an ACTIVE zone set with a
   * SERVICE_AREA zone and service hours applicable to the product, an ACTIVE eligibility rule and an ACTIVE rate card.
   * Production additionally refuses synthetic legal references and synthetic configuration.
   */
  private async enablePrerequisites(q: Queryable, c: CityProductRow, legalBasisRef: string | null): Promise<CatalogReasonCode[]> {
    const reasons: CatalogReasonCode[] = [];
    if (c.class_status !== 'ENABLED' || c.status === 'DISABLED_LEGAL_GATE') return ['LEGAL_GATE'];
    if (legalBasisRef === null) reasons.push('LEGAL_BASIS_REQUIRED');
    const zoneSet = (
      await q.query<{ id: string; is_synthetic: boolean }>(`select id, is_synthetic from catalog.zone_sets where city_code = $1 and status = 'ACTIVE'`, [
        c.city_code,
      ])
    ).rows[0];
    let synthetic = c.is_synthetic || (legalBasisRef !== null && /^SYNTHETIC/i.test(legalBasisRef));
    if (!zoneSet) reasons.push('PREREQ_ZONE_SET_MISSING');
    else {
      synthetic ||= zoneSet.is_synthetic;
      const covering = await q.query(
        `select 1 from catalog.zones z where z.zone_set_id = $1 and z.kind = 'SERVICE_AREA'
            and (not exists (select 1 from catalog.zone_products zp where zp.zone_id = z.id)
                 or exists (select 1 from catalog.zone_products zp where zp.zone_id = z.id and zp.product_code = $2)) limit 1`,
        [zoneSet.id, c.product_code],
      );
      if (covering.rowCount === 0) reasons.push('PREREQ_ZONE_SET_NOT_COVERING');
      if (applicableRows(await this.zoneSetHours(q, zoneSet.id), c.product_code).length === 0) reasons.push('PREREQ_SERVICE_HOURS_MISSING');
    }
    const rule = (
      await q.query<{ is_synthetic: boolean }>(
        `select is_synthetic from catalog.vehicle_eligibility_rules where city_code = $1 and product_code = $2 and status = 'ACTIVE'`,
        [c.city_code, c.product_code],
      )
    ).rows[0];
    if (!rule) reasons.push('PREREQ_ELIGIBILITY_RULE_MISSING');
    else synthetic ||= rule.is_synthetic;
    if (this.rateCards === null) reasons.push('RATE_CARD_CHECK_UNAVAILABLE');
    else if (!(await this.rateCards.hasActiveRateCard(c.city_code, c.product_code, q))) reasons.push('PREREQ_RATE_CARD_MISSING');
    if (synthetic && this.production) reasons.push('SYNTHETIC_REFUSED_IN_PRODUCTION');
    return reasons;
  }

  requestEnable(
    staff: StaffPrincipal,
    input: { cityCode: string; productCode: string; legalBasisRef: string; reasonCode: string },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(staff, 'catalog.city-products.enable-request', key, input, async (tx) => {
      const c = await this.cityProduct(tx, input.cityCode, input.productCode, true);
      if (!c) return failure('WAYVRO_E_NOT_FOUND');
      const objectId = cityProductObjectId(c.city_code, c.product_code);
      if (c.pending_transition !== null || c.status === 'ENABLED') return failure('WAYVRO_E_CONFLICT');
      const reasons = await this.enablePrerequisites(tx, c, input.legalBasisRef);
      if (reasons.length > 0) return this.refuse(tx, staff, 'catalog.city_service_product', objectId, reasons);
      await tx.query(
        `update catalog.city_service_products
            set status = case when status = 'NOT_CONFIGURED' then 'CONFIGURED' else status end, pending_transition = 'ENABLE', legal_basis_ref = $3,
                changed_by_staff_id = $4, approved_by_staff_id = null, reason_code = $5, updated_at = now(), version_lock = version_lock + 1
          where city_code = $1 and product_code = $2`,
        [c.city_code, c.product_code, input.legalBasisRef, staff.staffId, input.reasonCode],
      );
      await this.audit(tx, staff, 'CITY_PRODUCT_ENABLE_REQUESTED', 'catalog.city_service_product', objectId, input.reasonCode);
      return success(200, cityProductView((await this.cityProduct(tx, c.city_code, c.product_code, false)) ?? c));
    });
  }

  decideEnable(
    staff: StaffPrincipal,
    input: { cityCode: string; productCode: string; decision: 'APPROVE' | 'REJECT'; reasonCode?: string | undefined },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(staff, 'catalog.city-products.enable-decision', key, input, async (tx) => {
      const c = await this.cityProduct(tx, input.cityCode, input.productCode, true);
      if (!c) return failure('WAYVRO_E_NOT_FOUND');
      const objectId = cityProductObjectId(c.city_code, c.product_code);
      if (c.pending_transition !== 'ENABLE') return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['NO_PENDING_REQUEST'] });
      if (c.changed_by_staff_id === staff.staffId) return this.deny(tx, staff, 'catalog.city_service_product', objectId, 'MAKER_IS_CHECKER');
      if (input.decision === 'REJECT') {
        await tx.query(
          `update catalog.city_service_products set pending_transition = null, reason_code = $3, updated_at = now(), version_lock = version_lock + 1
            where city_code = $1 and product_code = $2`,
          [c.city_code, c.product_code, input.reasonCode ?? 'ENABLE_REJECTED'],
        );
        await this.audit(tx, staff, 'CITY_PRODUCT_ENABLE_REJECTED', 'catalog.city_service_product', objectId, input.reasonCode);
        return success(200, cityProductView((await this.cityProduct(tx, c.city_code, c.product_code, false)) ?? c));
      }
      const reasons = await this.enablePrerequisites(tx, c, c.legal_basis_ref);
      if (reasons.length > 0) return this.refuse(tx, staff, 'catalog.city_service_product', objectId, reasons);
      await tx.query('savepoint enable');
      try {
        await tx.query(
          `update catalog.city_service_products set status = 'ENABLED', pending_transition = null, approved_by_staff_id = $3, updated_at = now(),
                  version_lock = version_lock + 1 where city_code = $1 and product_code = $2`,
          [c.city_code, c.product_code, staff.staffId],
        );
      } catch (e) {
        // the database legal gate (catalog.city_product_guard) is the last line of defence
        if (sqlState(e) !== '42501') throw e;
        await tx.query('rollback to savepoint enable');
        return this.refuse(tx, staff, 'catalog.city_service_product', objectId, ['LEGAL_GATE']);
      }
      await emitEvent(tx, {
        type: 'catalog.city-product.changed.v1',
        aggregateType: 'catalog.city_service_product',
        aggregateId: objectId,
        accountId: null,
        payload: { cityCode: c.city_code, productCode: c.product_code, status: 'ENABLED' },
      });
      await this.audit(tx, staff, 'CITY_PRODUCT_ENABLED', 'catalog.city_service_product', objectId, input.reasonCode);
      return success(200, cityProductView((await this.cityProduct(tx, c.city_code, c.product_code, false)) ?? c));
    });
  }

  suspend(staff: StaffPrincipal, input: { cityCode: string; productCode: string; reasonCode: string }, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'catalog.city-products.suspend', key, input, async (tx) => {
      const c = await this.cityProduct(tx, input.cityCode, input.productCode, true);
      if (!c) return failure('WAYVRO_E_NOT_FOUND');
      if (c.status !== 'ENABLED') return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['NOT_ENABLED'] });
      const objectId = cityProductObjectId(c.city_code, c.product_code);
      await tx.query(
        `update catalog.city_service_products set status = 'SUSPENDED', pending_transition = null, changed_by_staff_id = $3, approved_by_staff_id = null,
                reason_code = $4, updated_at = now(), version_lock = version_lock + 1 where city_code = $1 and product_code = $2`,
        [c.city_code, c.product_code, staff.staffId, input.reasonCode],
      );
      await emitEvent(tx, {
        type: 'catalog.city-product.changed.v1',
        aggregateType: 'catalog.city_service_product',
        aggregateId: objectId,
        accountId: null,
        payload: { cityCode: c.city_code, productCode: c.product_code, status: 'SUSPENDED' },
      });
      await this.audit(tx, staff, 'CITY_PRODUCT_SUSPENDED', 'catalog.city_service_product', objectId, input.reasonCode);
      return success(200, cityProductView((await this.cityProduct(tx, c.city_code, c.product_code, false)) ?? c));
    });
  }
}
