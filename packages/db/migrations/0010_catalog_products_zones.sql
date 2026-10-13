-- wayvro-migration: 0010_catalog_products_zones
-- compatibility: additive (expand) — new catalog tables (service products, city products, eligibility rules, zone sets, zones, zone products, service hours, pickup points), two nullable columns + GiST index on catalog.districts, guard functions/triggers; section B: one widened CHECK on staff.role_assignments.role (dropped and re-added as the superset with PRICING_MANAGER, CATALOG_MANAGER, RELEASE_MANAGER; FA-10); section C: three nullable applicant-claim columns on compliance.vehicles (seats, body_type, air_conditioned; DM-OPEN-02 adopted, ADR-051); every existing row satisfies every new constraint; no existing column renamed or retyped; safe with every Phase-2 application version (none reads the new objects or writes the new columns)
-- data-impact: seeds reference data only — four MODELLED service products (ECONOMY, COMFORT, BIKE, RICKSHAW) and four LHR city-product rows (ECONOMY/COMFORT NOT_CONFIGURED, BIKE/RICKSHAW DISABLED_LEGAL_GATE); no zone, rate, eligibility rule or synthetic configuration is seeded (synthetic local/test data comes from the dev-only seed script @wayvro/test-support synthetic-catalog-seed, never a migration); no existing row is rewritten
-- rollback: before any staff-entered configuration exists: DROP the new catalog tables and the catalog guard functions, DROP COLUMN geom/geom_source_reference on catalog.districts, restore the narrower role CHECK only while no PRICING_MANAGER/CATALOG_MANAGER/RELEASE_MANAGER assignment exists, drop the vehicle claim columns only while all of them are NULL. Afterwards: forward-fix only (configuration history is never dropped)
-- verification: packages/db/test/catalog-products-zones.integration.test.ts — clean->latest, every previous->latest (identity-core prefix loop), live-row upgrade from 0009 with row checksums, re-run 0, format_type of every geometry column, ST_IsValid/SRID/empty CHECKs, one ACTIVE per city (zone set) and per city/product (rule), maker-checker CHECKs, guard triggers (immutability, DRAFT-only children, legal gate, pickup point inside its zone), grants as restricted roles

SET LOCAL ROLE wayvro_migrator;

-- ── Section A: catalog ───────────────────────────────────────────────────────────────────────────────────────────

-- Guard functions (plpgsql; ERRCODE insufficient_privilege like legal.age_policy_guard). They run with the privileges
-- of the writing role; every role that may write a guarded table holds the SELECT/UPDATE the guard needs.

-- Product definitions and other migration-owned reference rows change only by a reviewed migration.
CREATE FUNCTION catalog.reference_row_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  RAISE EXCEPTION 'catalog.%: reference rows change only by a reviewed migration (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$fn$;

-- Versioned maker-checker configuration (zone sets, eligibility rules): DELETE rejected; a new version starts as DRAFT
-- (only migration/seed roles may insert another status: system-seeded synthetic rows, like the Phase-2 placeholder
-- requirement set); every column except the lifecycle columns is immutable; allowed transitions only:
-- DRAFT->PENDING_APPROVAL, PENDING_APPROVAL->APPROVED (approver set, never the drafter), PENDING_APPROVAL->REJECTED,
-- APPROVED->ACTIVE (effective_from set), ACTIVE->RETIRED (effective_until set), APPROVED->RETIRED; plus, for members of
-- wayvro_migrator only, DRAFT->ACTIVE of a staff-less synthetic version (the local/test seed script).
CREATE FUNCTION catalog.config_version_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  lifecycle constant text[] := ARRAY['status', 'approved_by_staff_id', 'approval_reason_code', 'effective_from', 'effective_until', 'version_lock'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'catalog.%: configuration versions cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' AND NOT pg_has_role('wayvro_migrator', 'MEMBER') THEN
      RAISE EXCEPTION 'catalog.%: a new version starts as DRAFT', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'DRAFT' AND (NEW.approved_by_staff_id IS NOT NULL OR NEW.effective_from IS NOT NULL OR NEW.effective_until IS NOT NULL) THEN
      RAISE EXCEPTION 'catalog.%: a DRAFT carries no approval or effective dates', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - lifecycle) IS DISTINCT FROM (to_jsonb(OLD) - lifecycle) THEN
    RAISE EXCEPTION 'catalog.%: configuration values are immutable', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.effective_from IS NOT NULL AND NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
    RAISE EXCEPTION 'catalog.%: effective_from is immutable once set', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status NOT IN ('DRAFT', 'PENDING_APPROVAL') AND NEW.approved_by_staff_id IS DISTINCT FROM OLD.approved_by_staff_id THEN
    RAISE EXCEPTION 'catalog.%: the approver is immutable once decided', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = OLD.status THEN
    -- only an optimistic-lock bump of a DRAFT (child edits) keeps the status
    IF OLD.status = 'DRAFT' AND (NEW.approved_by_staff_id, NEW.approval_reason_code, NEW.effective_from, NEW.effective_until)
       IS NOT DISTINCT FROM (OLD.approved_by_staff_id, OLD.approval_reason_code, OLD.effective_from, OLD.effective_until) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'catalog.%: % rows cannot change', TG_TABLE_NAME, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL' AND NEW.approved_by_staff_id IS NULL)
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED' AND NEW.approved_by_staff_id IS NOT NULL
        AND NEW.approved_by_staff_id IS DISTINCT FROM NEW.drafted_by_staff_id)
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'REJECTED' AND NEW.approved_by_staff_id IS NULL)
    OR (OLD.status = 'APPROVED' AND NEW.status = 'ACTIVE' AND NEW.effective_from IS NOT NULL)
    OR (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED' AND NEW.effective_until IS NOT NULL)
    OR (OLD.status = 'APPROVED' AND NEW.status = 'RETIRED')
    -- system-seeded SYNTHETIC configuration (the local/test seed script, never an application role): a staff-less
    -- synthetic draft is activated directly after its children were written
    OR (OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE' AND NEW.is_synthetic AND NEW.drafted_by_staff_id IS NULL AND NEW.approved_by_staff_id IS NULL
        AND NEW.effective_from IS NOT NULL AND pg_has_role('wayvro_migrator', 'MEMBER'))
  ) THEN
    RAISE EXCEPTION 'catalog.%: transition % -> % not allowed', TG_TABLE_NAME, OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;

-- Zones, zone products, service hours and pickup points are part of their zone set's immutable snapshot: they can be
-- written only while the parent set is DRAFT. The parent is read FOR SHARE and the submit transition locks it FOR
-- UPDATE, so a child write cannot race a submit.
CREATE FUNCTION catalog.zone_child_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  zone_ids uuid[];
  set_ids uuid[];
  set_id uuid;
  parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'zone_products' THEN
    IF TG_OP = 'INSERT' THEN
      zone_ids := ARRAY[NEW.zone_id];
    ELSIF TG_OP = 'DELETE' THEN
      zone_ids := ARRAY[OLD.zone_id];
    ELSE
      zone_ids := ARRAY[OLD.zone_id, NEW.zone_id];
    END IF;
    SELECT array_agg(z.zone_set_id) INTO set_ids FROM catalog.zones z WHERE z.id = ANY (zone_ids);
  ELSIF TG_OP = 'INSERT' THEN
    set_ids := ARRAY[NEW.zone_set_id];
  ELSIF TG_OP = 'DELETE' THEN
    set_ids := ARRAY[OLD.zone_set_id];
  ELSE
    set_ids := ARRAY[OLD.zone_set_id, NEW.zone_set_id];
  END IF;
  IF set_ids IS NULL OR cardinality(set_ids) = 0 THEN
    RAISE EXCEPTION 'catalog.%: the parent zone set does not exist', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOREACH set_id IN ARRAY set_ids LOOP
    SELECT s.status INTO parent_status FROM catalog.zone_sets s WHERE s.id = set_id FOR SHARE;
    IF parent_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'catalog.%: the zone set is not a DRAFT (children are immutable)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$fn$;

-- A pickup point lies inside (or on the boundary of) its own zone; AIRPORT points belong to an AIRPORT_PRECINCT.
CREATE FUNCTION catalog.pickup_point_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  zone_kind text;
BEGIN
  SELECT z.kind INTO zone_kind FROM catalog.zones z
   WHERE z.zone_set_id = NEW.zone_set_id AND z.code = NEW.zone_code AND ST_Covers(z.geom, NEW.point);
  IF zone_kind IS NULL THEN
    RAISE EXCEPTION 'catalog.pickup_points: the point is not inside zone %', NEW.zone_code USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'AIRPORT' AND zone_kind <> 'AIRPORT_PRECINCT' THEN
    RAISE EXCEPTION 'catalog.pickup_points: AIRPORT points belong to an AIRPORT_PRECINCT zone' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

-- City products: the vehicle-class legal gate (FD-02/B15, FA-11). While a product's vehicle class is not ENABLED in
-- catalog.service_categories, the city product can only be DISABLED_LEGAL_GATE (it can neither be ENABLED nor leave
-- the gate). Rows are never deleted (history of enablement lives in audit + outbox).
CREATE FUNCTION catalog.city_product_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  class_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'catalog.city_service_products rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.city_code, NEW.product_code) IS DISTINCT FROM (OLD.city_code, OLD.product_code) THEN
    RAISE EXCEPTION 'catalog.city_service_products: the city/product key is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT c.status INTO class_status
    FROM catalog.service_products p JOIN catalog.service_categories c ON c.code = p.vehicle_class
   WHERE p.code = NEW.product_code;
  IF class_status IS DISTINCT FROM 'ENABLED' AND NEW.status <> 'DISABLED_LEGAL_GATE' THEN
    RAISE EXCEPTION 'catalog.city_service_products: % stays DISABLED_LEGAL_GATE while its vehicle class is gated', NEW.product_code
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION catalog.reference_row_guard(), catalog.config_version_guard(), catalog.zone_child_guard(), catalog.pickup_point_guard(),
  catalog.city_product_guard() FROM PUBLIC;

-- Service products (R28): the rider-facing offering. `vehicle_class` is the existing compliance key
-- (catalog.service_categories, never renamed — F-P3-04).
CREATE TABLE catalog.service_products (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
  vehicle_class text NOT NULL REFERENCES catalog.service_categories (code),
  name_key text NOT NULL CHECK (name_key ~ '^product\.[a-z0-9_.-]{1,60}$'),
  description_key text NOT NULL CHECK (description_key ~ '^product\.[a-z0-9_.-]{1,60}$'),
  seats_max smallint NOT NULL CHECK (seats_max BETWEEN 1 AND 12),
  luggage_class text NOT NULL CHECK (luggage_class IN ('NONE', 'SMALL', 'STANDARD', 'LARGE')),
  routing_profile text NOT NULL DEFAULT 'CAR' CHECK (routing_profile IN ('CAR', 'TWO_WHEELER', 'THREE_WHEELER')),
  sort_order smallint NOT NULL UNIQUE CHECK (sort_order BETWEEN 0 AND 1000),
  -- references the future safety configuration (no FK yet)
  safety_profile_code text NULL CHECK (safety_profile_code ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER service_products_reference_guard BEFORE UPDATE OR DELETE ON catalog.service_products FOR EACH ROW EXECUTE FUNCTION catalog.reference_row_guard();
-- modelling values (PROPOSED), not legal facts; display copy comes from the name keys in the client catalogues (B04)
INSERT INTO catalog.service_products (code, vehicle_class, name_key, description_key, seats_max, luggage_class, routing_profile, sort_order) VALUES
  ('ECONOMY', 'CAR', 'product.economy.name', 'product.economy.description', 4, 'STANDARD', 'CAR', 10),
  ('COMFORT', 'CAR', 'product.comfort.name', 'product.comfort.description', 4, 'LARGE', 'CAR', 20),
  ('BIKE', 'BIKE', 'product.bike.name', 'product.bike.description', 1, 'NONE', 'TWO_WHEELER', 30),
  ('RICKSHAW', 'RICKSHAW', 'product.rickshaw.name', 'product.rickshaw.description', 3, 'SMALL', 'THREE_WHEELER', 40);

-- City products: lifecycle NOT_CONFIGURED -> CONFIGURED -> (maker request ENABLE) -> ENABLED (a different staff member
-- approves) <-> SUSPENDED (single staff + step-up; resuming is maker-checker again). `pending_transition` holds a
-- maker's ENABLE request (from CONFIGURED, or from SUSPENDED to resume).
CREATE TABLE catalog.city_service_products (
  city_code text NOT NULL REFERENCES catalog.cities (code),
  product_code text NOT NULL REFERENCES catalog.service_products (code),
  status text NOT NULL CHECK (status IN ('NOT_CONFIGURED', 'CONFIGURED', 'ENABLED', 'SUSPENDED', 'DISABLED_LEGAL_GATE')),
  pending_transition text NULL CHECK (pending_transition IN ('ENABLE')),
  legal_basis_ref text NULL CHECK (char_length(legal_basis_ref) BETWEEN 3 AND 300),
  is_synthetic boolean NOT NULL DEFAULT false,
  changed_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  reason_code text NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1),
  PRIMARY KEY (city_code, product_code),
  -- maker-checker: the approver never made the change
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id IS DISTINCT FROM changed_by_staff_id),
  CHECK (status <> 'ENABLED' OR legal_basis_ref IS NOT NULL),
  -- a staff-made ENABLED state always has a checker (system-seeded synthetic rows have no maker)
  CHECK (changed_by_staff_id IS NULL OR status <> 'ENABLED' OR approved_by_staff_id IS NOT NULL),
  CHECK (pending_transition IS NULL OR status IN ('CONFIGURED', 'SUSPENDED'))
);
CREATE TRIGGER city_service_products_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog.city_service_products
  FOR EACH ROW EXECUTE FUNCTION catalog.city_product_guard();
INSERT INTO catalog.city_service_products (city_code, product_code, status) VALUES
  ('LHR', 'ECONOMY', 'NOT_CONFIGURED'),
  ('LHR', 'COMFORT', 'NOT_CONFIGURED'),
  ('LHR', 'BIKE', 'DISABLED_LEGAL_GATE'),
  ('LHR', 'RICKSHAW', 'DISABLED_LEGAL_GATE');

-- Vehicle eligibility rules (H10/CL-07): versioned per (city, product), maker-checker, one ACTIVE per (city, product).
CREATE TABLE catalog.vehicle_eligibility_rules (
  id uuid PRIMARY KEY,
  city_code text NOT NULL REFERENCES catalog.cities (code),
  product_code text NOT NULL REFERENCES catalog.service_products (code),
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED')),
  is_synthetic boolean NOT NULL,
  source_reference text NOT NULL CHECK (char_length(source_reference) BETWEEN 3 AND 300),
  min_model_year smallint NULL CHECK (min_model_year BETWEEN 1950 AND 2100),
  max_vehicle_age_years smallint NULL CHECK (max_vehicle_age_years BETWEEN 0 AND 60),
  min_seats smallint NULL CHECK (min_seats BETWEEN 1 AND 12),
  ac_required boolean NOT NULL DEFAULT false,
  allowed_body_types text[] NOT NULL DEFAULT '{}'
    CHECK (allowed_body_types <@ ARRAY['HATCHBACK', 'SEDAN', 'SUV', 'CROSSOVER', 'MPV', 'MOTORCYCLE', 'AUTO_RICKSHAW']::text[]),
  -- rollback clone source (a new DRAFT copied from an earlier approved/retired version)
  supersedes_id uuid NULL REFERENCES catalog.vehicle_eligibility_rules (id),
  effective_from timestamptz NULL,
  effective_until timestamptz NULL,
  drafted_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  approval_reason_code text NULL CHECK (approval_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1),
  UNIQUE (city_code, product_code, version),
  FOREIGN KEY (city_code, product_code) REFERENCES catalog.city_service_products (city_code, product_code),
  CHECK (NOT (min_model_year IS NOT NULL AND max_vehicle_age_years IS NOT NULL)),
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id IS DISTINCT FROM drafted_by_staff_id),
  CHECK (drafted_by_staff_id IS NULL OR status IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED') OR approved_by_staff_id IS NOT NULL),
  CHECK ((status = 'ACTIVE') <= (effective_from IS NOT NULL)),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from)
);
CREATE UNIQUE INDEX vehicle_eligibility_rules_one_active ON catalog.vehicle_eligibility_rules (city_code, product_code) WHERE status = 'ACTIVE';
CREATE TRIGGER vehicle_eligibility_rules_version_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog.vehicle_eligibility_rules
  FOR EACH ROW EXECUTE FUNCTION catalog.config_version_guard();

-- Zone sets (E08): versioned, maker-checker, one ACTIVE per city; immutable (with every child) after DRAFT.
CREATE TABLE catalog.zone_sets (
  id uuid PRIMARY KEY,
  city_code text NOT NULL REFERENCES catalog.cities (code),
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED')),
  is_synthetic boolean NOT NULL,
  source_reference text NOT NULL CHECK (char_length(source_reference) BETWEEN 3 AND 300),
  supersedes_id uuid NULL REFERENCES catalog.zone_sets (id),
  effective_from timestamptz NULL,
  effective_until timestamptz NULL,
  drafted_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  approval_reason_code text NULL CHECK (approval_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1),
  UNIQUE (city_code, version),
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id IS DISTINCT FROM drafted_by_staff_id),
  CHECK (drafted_by_staff_id IS NULL OR status IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED') OR approved_by_staff_id IS NOT NULL),
  CHECK ((status = 'ACTIVE') <= (effective_from IS NOT NULL)),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from)
);
CREATE UNIQUE INDEX zone_sets_one_active ON catalog.zone_sets (city_code) WHERE status = 'ACTIVE';
CREATE TRIGGER zone_sets_version_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog.zone_sets FOR EACH ROW EXECUTE FUNCTION catalog.config_version_guard();

-- Zones: hand-written PostGIS DDL (ADR-004). Boundary semantics (ADR-051): a point ON a SERVICE_AREA boundary is
-- served (ST_Covers); a point ON an EXCLUSION boundary is excluded (ST_Intersects) — fail closed.
CREATE TABLE catalog.zones (
  id uuid PRIMARY KEY,
  zone_set_id uuid NOT NULL REFERENCES catalog.zone_sets (id),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{1,31}$'),
  kind text NOT NULL CHECK (kind IN ('SERVICE_AREA', 'EXCLUSION', 'PICKUP_RESTRICTED', 'AIRPORT_PRECINCT')),
  name_en text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 80),
  name_ur text NOT NULL CHECK (char_length(name_ur) BETWEEN 1 AND 80),
  geom geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_SRID(geom) = 4326 AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom) AND ST_NPoints(geom) <= 20000),
  UNIQUE (zone_set_id, code)
);
CREATE INDEX zones_geom ON catalog.zones USING gist (geom);
CREATE TRIGGER zones_child_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog.zones FOR EACH ROW EXECUTE FUNCTION catalog.zone_child_guard();

-- Product applicability of a zone (no rows = the zone applies to every product).
CREATE TABLE catalog.zone_products (
  zone_id uuid NOT NULL REFERENCES catalog.zones (id),
  product_code text NOT NULL REFERENCES catalog.service_products (code),
  PRIMARY KEY (zone_id, product_code)
);
CREATE TRIGGER zone_products_child_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog.zone_products FOR EACH ROW EXECUTE FUNCTION catalog.zone_child_guard();

-- Service hours per zone set (Asia/Karachi local time, UTC+05:00, no DST): a window is [opens, closes); opens = closes
-- means the whole day; overnight windows are two rows; product rows replace the general (product NULL) rows for that
-- product; no applicable row = closed (fail closed).
CREATE TABLE catalog.service_hours (
  id uuid PRIMARY KEY,
  zone_set_id uuid NOT NULL REFERENCES catalog.zone_sets (id),
  product_code text NULL REFERENCES catalog.service_products (code),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_local time NOT NULL,
  closes_local time NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Karachi' CHECK (timezone = 'Asia/Karachi'),
  CHECK (opens_local <= closes_local),
  UNIQUE NULLS NOT DISTINCT (zone_set_id, product_code, weekday, opens_local)
);
CREATE TRIGGER service_hours_child_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog.service_hours FOR EACH ROW EXECUTE FUNCTION catalog.zone_child_guard();

-- Designated/airport/landmark pickup points of one zone of the set (part of the immutable snapshot: a temporary
-- closure is a new zone-set version).
CREATE TABLE catalog.pickup_points (
  id uuid PRIMARY KEY,
  zone_set_id uuid NOT NULL,
  zone_code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('AIRPORT', 'DESIGNATED', 'LANDMARK')),
  point geometry(Point, 4326) NOT NULL CHECK (ST_SRID(point) = 4326 AND NOT ST_IsEmpty(point)),
  name_en text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 80),
  name_ur text NOT NULL CHECK (char_length(name_ur) BETWEEN 1 AND 80),
  instruction_key text NOT NULL CHECK (instruction_key ~ '^pickup\.[a-z0-9_.-]{1,60}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'HIDDEN')),
  FOREIGN KEY (zone_set_id, zone_code) REFERENCES catalog.zones (zone_set_id, code),
  UNIQUE (zone_set_id, zone_code, name_en)
);
CREATE INDEX pickup_points_point ON catalog.pickup_points USING gist (point);
CREATE TRIGGER pickup_points_child_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog.pickup_points FOR EACH ROW EXECUTE FUNCTION catalog.zone_child_guard();
CREATE TRIGGER pickup_points_inside_zone BEFORE INSERT OR UPDATE ON catalog.pickup_points FOR EACH ROW EXECUTE FUNCTION catalog.pickup_point_guard();

-- District geometry (expand; populated only from a founder-approved licensed boundary source — a later pilot item,
-- FA-12; synthetic only in Phase 3). The existing LHR-LAHORE row satisfies both CHECKs (NULL).
ALTER TABLE catalog.districts ADD COLUMN geom geometry(MultiPolygon, 4326) NULL;
ALTER TABLE catalog.districts ADD COLUMN geom_source_reference text NULL;
ALTER TABLE catalog.districts ADD CONSTRAINT districts_geom_source_check CHECK ((geom IS NULL) = (geom_source_reference IS NULL));
ALTER TABLE catalog.districts ADD CONSTRAINT districts_geom_source_reference_check CHECK (char_length(geom_source_reference) BETWEEN 3 AND 300);
ALTER TABLE catalog.districts ADD CONSTRAINT districts_geom_valid_check CHECK (geom IS NULL OR (ST_SRID(geom) = 4326 AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom)));
CREATE INDEX districts_geom ON catalog.districts USING gist (geom);

-- ── Section B: staff roles (REQUIRED; FA-10 APPROVED 2026-10-12) ────────────────────────────────────────────────
-- Widened CHECK (superset of the 7 Phase-2 roles); every existing assignment satisfies it; no data change.
ALTER TABLE staff.role_assignments DROP CONSTRAINT role_assignments_role_check;
ALTER TABLE staff.role_assignments ADD CONSTRAINT role_assignments_role_check CHECK (
  role IN (
    'KYC_REVIEWER',
    'KYC_SENIOR_REVIEWER',
    'COMPLIANCE_ADMIN',
    'TRUST_SAFETY_AGENT',
    'SUPPORT_AGENT',
    'STAFF_ADMIN',
    'AUDITOR',
    'PRICING_MANAGER',
    'CATALOG_MANAGER',
    'RELEASE_MANAGER'
  )
);

-- ── Section C: vehicle attribute claims (DM-OPEN-02 default proposal adopted; ADR-051) ───────────────────────────
-- Applicant CLAIMS (confirmed by a reviewer like the other vehicle fields); NULL = not claimed, which eligibility
-- rules on seats/body type/AC evaluate as UNKNOWN. The compliance module writes them (existing table grants).
ALTER TABLE compliance.vehicles ADD COLUMN seats smallint NULL CHECK (seats BETWEEN 1 AND 12);
ALTER TABLE compliance.vehicles ADD COLUMN body_type text NULL CHECK (body_type IN ('HATCHBACK', 'SEDAN', 'SUV', 'CROSSOVER', 'MPV', 'MOTORCYCLE', 'AUTO_RICKSHAW'));
ALTER TABLE compliance.vehicles ADD COLUMN air_conditioned boolean NULL;

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
GRANT SELECT ON catalog.service_products, catalog.city_service_products, catalog.vehicle_eligibility_rules, catalog.zone_sets, catalog.zones,
  catalog.zone_products, catalog.service_hours, catalog.pickup_points TO wayvro_api;
GRANT INSERT ON catalog.zone_sets, catalog.zones, catalog.zone_products, catalog.service_hours, catalog.pickup_points,
  catalog.vehicle_eligibility_rules TO wayvro_api;
-- draft editing only (the child guard restricts every write to DRAFT parents)
GRANT DELETE ON catalog.zones, catalog.zone_products, catalog.service_hours, catalog.pickup_points TO wayvro_api;
GRANT UPDATE (status, approved_by_staff_id, approval_reason_code, effective_from, effective_until, version_lock) ON catalog.zone_sets,
  catalog.vehicle_eligibility_rules TO wayvro_api;
GRANT UPDATE (status, pending_transition, legal_basis_ref, changed_by_staff_id, approved_by_staff_id, reason_code, updated_at, version_lock)
  ON catalog.city_service_products TO wayvro_api;

-- worker: scheduled activation of approved versions (config.scheduled-activation job; no catalog write otherwise)
GRANT USAGE ON SCHEMA catalog TO wayvro_worker;
GRANT SELECT (id, city_code, status, effective_from, version_lock), UPDATE (status, effective_from, effective_until, version_lock)
  ON catalog.zone_sets TO wayvro_worker;
GRANT SELECT (id, city_code, product_code, status, effective_from, version_lock), UPDATE (status, effective_from, effective_until, version_lock)
  ON catalog.vehicle_eligibility_rules TO wayvro_worker;

RESET ROLE;
