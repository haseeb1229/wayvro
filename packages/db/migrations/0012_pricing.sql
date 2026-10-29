-- wayvro-migration: 0012_pricing
-- compatibility: additive (expand) — new schema pricing (tax policies, rate cards + 1:1 components, route snapshots, quotes + components) with guard and constraint-trigger functions; no existing object altered; independent of 0011/0013; safe with every earlier application version (none reads the new objects)
-- data-impact: none — no rate card, tax policy or quote is seeded; synthetic Lahore pricing exists only in local/test databases via the dev-only seed script (@wayvro/test-support synthetic-catalog-seed)
-- rollback: before any staff-entered pricing exists: DROP SCHEMA pricing CASCADE. Afterwards: forward-fix only (rate-card/tax history is configuration evidence and is never dropped)
-- verification: packages/db/test/pricing.integration.test.ts — clean->latest, every previous->latest, live-row upgrade from 0011 with a synthetic catalog, re-run 0, geography typmod via format_type, one ACTIVE card per city/product, maker-checker CHECKs, component immutability after DRAFT, tax policy APPROVED at submit, quote immutability, deferred Σ(components)=total tolerating a purged parent, sign CHECKs, grants as restricted roles, nothing for PUBLIC

SET LOCAL ROLE wayvro_migrator;

CREATE SCHEMA pricing;

-- ── tax policies (pricing doc §3.1; FA-15b: real values are EXTERNAL) ─────────────────────────────────────────────
-- Versioned maker-checker configuration referenced by rate cards. System-seeded rows (the local/test seed script) have
-- no drafter and must be placeholders; a non-placeholder policy names its legal reference.
CREATE TABLE pricing.tax_policies (
  id uuid PRIMARY KEY,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{2,40}$'),
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RETIRED', 'REJECTED')),
  jurisdiction_code text NOT NULL CHECK (jurisdiction_code ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  rate_bp integer NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  applies_to text[] NOT NULL
    CHECK (cardinality(applies_to) >= 1 AND applies_to <@ ARRAY['BASE', 'DISTANCE', 'TIME', 'MINIMUM_ADJUSTMENT', 'BOOKING_FEE', 'AIRPORT_FEE']::text[]),
  -- the minimum-fare top-up replaces part of BASE + DISTANCE + TIME, so it is taxable only together with all three;
  -- otherwise a longer trip could cost less (PROP-QUOTE P-06 counterexample found by CI run 38427719184)
  CONSTRAINT tax_policies_minimum_adjustment_consistent
    CHECK (NOT ('MINIMUM_ADJUSTMENT' = ANY (applies_to)) OR applies_to @> ARRAY['BASE', 'DISTANCE', 'TIME']::text[]),
  inclusive boolean NOT NULL,
  rounding_mode text NOT NULL DEFAULT 'HALF_EVEN' CHECK (rounding_mode IN ('HALF_EVEN', 'HALF_UP', 'FLOOR', 'CEILING')),
  is_placeholder boolean NOT NULL,
  legal_reference text NULL CHECK (char_length(legal_reference) BETWEEN 3 AND 300),
  drafted_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1),
  UNIQUE (code, version),
  CHECK (is_placeholder OR legal_reference IS NOT NULL),
  -- maker-checker: the approver never drafted the policy; staff-drafted APPROVED/RETIRED rows always carry an approver
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id IS DISTINCT FROM drafted_by_staff_id),
  CHECK (drafted_by_staff_id IS NULL OR status IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED') OR approved_by_staff_id IS NOT NULL),
  CHECK (drafted_by_staff_id IS NOT NULL OR is_placeholder)
);

-- No delete; values immutable (a DRAFT is created complete); a new version starts as DRAFT (only migration/seed roles
-- insert another status); transitions DRAFT->PENDING_APPROVAL, PENDING_APPROVAL->APPROVED (approver set, never the
-- drafter), PENDING_APPROVAL->REJECTED, APPROVED->RETIRED (refused while an ACTIVE rate card references the policy).
CREATE FUNCTION pricing.tax_policy_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  lifecycle constant text[] := ARRAY['status', 'approved_by_staff_id', 'version_lock'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pricing.tax_policies: versions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' AND NOT pg_has_role('wayvro_migrator', 'MEMBER') THEN
      RAISE EXCEPTION 'pricing.tax_policies: a new version starts as DRAFT' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'DRAFT' AND NEW.approved_by_staff_id IS NOT NULL THEN
      RAISE EXCEPTION 'pricing.tax_policies: a DRAFT carries no approval' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - lifecycle) IS DISTINCT FROM (to_jsonb(OLD) - lifecycle) THEN
    RAISE EXCEPTION 'pricing.tax_policies: policy values are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.approved_by_staff_id IS DISTINCT FROM OLD.approved_by_staff_id AND NOT (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED') THEN
    RAISE EXCEPTION 'pricing.tax_policies: the approver is set only by the approval' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = OLD.status THEN
    RAISE EXCEPTION 'pricing.tax_policies: % rows cannot change', OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL' AND NEW.approved_by_staff_id IS NULL)
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED' AND NEW.approved_by_staff_id IS NOT NULL
        AND NEW.approved_by_staff_id IS DISTINCT FROM NEW.drafted_by_staff_id)
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'REJECTED' AND NEW.approved_by_staff_id IS NULL)
    OR (OLD.status = 'APPROVED' AND NEW.status = 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'pricing.tax_policies: transition % -> % not allowed', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'RETIRED' AND EXISTS (
    SELECT 1 FROM pricing.rate_card_components c JOIN pricing.rate_cards r ON r.id = c.rate_card_id
     WHERE c.tax_policy_id = NEW.id AND r.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'pricing.tax_policies: a policy referenced by an ACTIVE rate card cannot be retired' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;

-- ── rate cards (pricing doc §2, §9; H06) ─────────────────────────────────────────────────────────────────────────
-- Header per (city, product, version); the immutable values live in pricing.rate_card_components (1:1). One ACTIVE
-- card per (city, product). `scheduled` = activation requested for a future `effective_from` (worker job
-- config.scheduled-activation). `submission_preview` = the default synthetic benchmark preview computed at submission
-- (what the approver sees; audit rows carry codes only); `envelope_override_reason_code` = the maker's explicit reason
-- for values outside the sanity envelope (visible to the approver). System-seeded rows (local/test seed) have no
-- drafter and must be synthetic.
CREATE TABLE pricing.rate_cards (
  id uuid PRIMARY KEY,
  city_code text NOT NULL,
  product_code text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED')),
  is_synthetic boolean NOT NULL,
  source_reference text NOT NULL CHECK (char_length(source_reference) BETWEEN 3 AND 300),
  effective_from timestamptz NULL,
  effective_until timestamptz NULL,
  scheduled boolean NOT NULL DEFAULT false,
  drafted_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  approval_reason_code text NULL CHECK (approval_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  envelope_override_reason_code text NULL CHECK (envelope_override_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  submission_preview jsonb NULL CHECK (submission_preview IS NULL OR (jsonb_typeof(submission_preview) = 'object' AND octet_length(submission_preview::text) <= 65536)),
  -- rollback clone source (a new version cloned from an earlier APPROVED/RETIRED card)
  supersedes_id uuid NULL REFERENCES pricing.rate_cards (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1),
  UNIQUE (city_code, product_code, version),
  FOREIGN KEY (city_code, product_code) REFERENCES catalog.city_service_products (city_code, product_code),
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id IS DISTINCT FROM drafted_by_staff_id),
  CHECK (drafted_by_staff_id IS NULL OR status IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED') OR approved_by_staff_id IS NOT NULL),
  CHECK (drafted_by_staff_id IS NULL OR status NOT IN ('APPROVED', 'ACTIVE') OR approval_reason_code IS NOT NULL),
  CHECK (drafted_by_staff_id IS NOT NULL OR is_synthetic),
  CHECK ((status = 'ACTIVE') <= (effective_from IS NOT NULL)),
  CHECK (NOT scheduled OR (status = 'APPROVED' AND effective_from IS NOT NULL)),
  CHECK (effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until >= effective_from))
);
CREATE UNIQUE INDEX rate_cards_one_active ON pricing.rate_cards (city_code, product_code) WHERE status = 'ACTIVE';
CREATE INDEX rate_cards_scheduled ON pricing.rate_cards (effective_from) WHERE scheduled;

CREATE TABLE pricing.rate_card_components (
  rate_card_id uuid PRIMARY KEY REFERENCES pricing.rate_cards (id),
  base_minor bigint NOT NULL CHECK (base_minor BETWEEN 0 AND 10000000),
  per_km_minor bigint NOT NULL CHECK (per_km_minor BETWEEN 0 AND 10000000),
  per_min_minor bigint NOT NULL CHECK (per_min_minor BETWEEN 0 AND 10000000),
  minimum_fare_minor bigint NOT NULL CHECK (minimum_fare_minor BETWEEN 0 AND 10000000),
  booking_fee_minor bigint NOT NULL CHECK (booking_fee_minor BETWEEN 0 AND 10000000),
  airport_pickup_fee_minor bigint NOT NULL CHECK (airport_pickup_fee_minor BETWEEN 0 AND 10000000),
  rounding_step_minor bigint NOT NULL CHECK (rounding_step_minor BETWEEN 1 AND 10000),
  rounding_mode text NOT NULL CHECK (rounding_mode IN ('HALF_EVEN', 'HALF_UP', 'FLOOR', 'CEILING')),
  toll_policy text NOT NULL CHECK (toll_policy IN ('NOT_APPLICABLE', 'EXCLUDED_DISCLOSED')),
  tax_policy_id uuid NOT NULL REFERENCES pricing.tax_policies (id),
  quote_ttl_seconds integer NOT NULL CHECK (quote_ttl_seconds BETWEEN 60 AND 1800),
  max_distance_m integer NOT NULL CHECK (max_distance_m BETWEEN 100 AND 200000),
  max_duration_s integer NOT NULL CHECK (max_duration_s BETWEEN 60 AND 21600),
  -- rounding never takes a total below the minimum fare (pricing doc §3.6, property P-04)
  CHECK (minimum_fare_minor % rounding_step_minor = 0)
);
CREATE INDEX rate_card_components_tax_policy ON pricing.rate_card_components (tax_policy_id);

-- Rate-card header guard: DELETE rejected; a new version starts as DRAFT (only migration/seed roles insert another
-- status); every column except the lifecycle columns is immutable; allowed transitions only:
-- DRAFT->PENDING_APPROVAL (components present, their tax policy APPROVED; preview/override recorded here only),
-- PENDING_APPROVAL->APPROVED (approver ≠ drafter, approval reason), PENDING_APPROVAL->REJECTED, APPROVED->ACTIVE
-- (effective_from set, never back-dated, not scheduled, tax policy still APPROVED), ACTIVE->RETIRED (effective_until
-- set), APPROVED->RETIRED (not scheduled); without a status change only a DRAFT's optimistic lock or an APPROVED card's
-- schedule (effective_from never in the past) changes; plus, for members of wayvro_migrator only, DRAFT->ACTIVE of a
-- staff-less synthetic card (the local/test seed script).
CREATE FUNCTION pricing.rate_card_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  lifecycle constant text[] := ARRAY['status', 'approved_by_staff_id', 'approval_reason_code', 'effective_from', 'effective_until', 'scheduled',
                                     'version_lock', 'submission_preview', 'envelope_override_reason_code'];
  tax_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pricing.rate_cards: versions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' AND NOT pg_has_role('wayvro_migrator', 'MEMBER') THEN
      RAISE EXCEPTION 'pricing.rate_cards: a new version starts as DRAFT' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'DRAFT' AND (NEW.approved_by_staff_id, NEW.approval_reason_code, NEW.effective_from, NEW.effective_until, NEW.submission_preview,
                                 NEW.envelope_override_reason_code) IS DISTINCT FROM (NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::jsonb, NULL::text)
       OR NEW.scheduled THEN
      RAISE EXCEPTION 'pricing.rate_cards: a DRAFT carries no approval, schedule or submission data' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - lifecycle) IS DISTINCT FROM (to_jsonb(OLD) - lifecycle) THEN
    RAISE EXCEPTION 'pricing.rate_cards: rate-card values are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.submission_preview, NEW.envelope_override_reason_code) IS DISTINCT FROM (OLD.submission_preview, OLD.envelope_override_reason_code)
     AND NOT (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'pricing.rate_cards: the submission preview is recorded only by the submission' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.approved_by_staff_id IS DISTINCT FROM OLD.approved_by_staff_id AND NOT (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED') THEN
    RAISE EXCEPTION 'pricing.rate_cards: the approver is set only by the approval' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.approval_reason_code IS DISTINCT FROM OLD.approval_reason_code AND NOT (OLD.status = 'PENDING_APPROVAL' AND NEW.status IN ('APPROVED', 'REJECTED')) THEN
    RAISE EXCEPTION 'pricing.rate_cards: the approval reason is set only by the decision' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = OLD.status THEN
    IF OLD.status = 'DRAFT' AND (NEW.effective_from, NEW.effective_until, NEW.scheduled) IS NOT DISTINCT FROM (OLD.effective_from, OLD.effective_until, OLD.scheduled) THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'APPROVED' AND NEW.effective_until IS NOT DISTINCT FROM OLD.effective_until THEN
      IF NEW.scheduled AND NEW.effective_from < now() THEN
        RAISE EXCEPTION 'pricing.rate_cards: a schedule is never in the past' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT NEW.scheduled AND NEW.effective_from IS NOT NULL THEN
        RAISE EXCEPTION 'pricing.rate_cards: an unscheduled APPROVED card carries no effective_from' USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'pricing.rate_cards: % rows cannot change', OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL' AND NEW.approved_by_staff_id IS NULL AND NOT NEW.scheduled AND NEW.effective_from IS NULL)
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED' AND NEW.approved_by_staff_id IS NOT NULL
        AND NEW.approved_by_staff_id IS DISTINCT FROM NEW.drafted_by_staff_id AND NEW.approval_reason_code IS NOT NULL)
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'REJECTED' AND NEW.approved_by_staff_id IS NULL)
    OR (OLD.status = 'APPROVED' AND NEW.status = 'ACTIVE' AND NEW.effective_from IS NOT NULL AND NEW.effective_from >= now() AND NOT NEW.scheduled
        AND NEW.effective_until IS NULL)
    OR (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED' AND NEW.effective_until IS NOT NULL AND NEW.effective_from IS NOT DISTINCT FROM OLD.effective_from)
    OR (OLD.status = 'APPROVED' AND NEW.status = 'RETIRED' AND NOT NEW.scheduled AND NEW.effective_from IS NULL)
    -- system-seeded SYNTHETIC configuration (the local/test seed script, never an application role)
    OR (OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE' AND NEW.is_synthetic AND NEW.drafted_by_staff_id IS NULL AND NEW.approved_by_staff_id IS NULL
        AND NEW.effective_from IS NOT NULL AND pg_has_role('wayvro_migrator', 'MEMBER'))
  ) THEN
    RAISE EXCEPTION 'pricing.rate_cards: transition % -> % not allowed', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (OLD.status = 'DRAFT' AND NEW.status IN ('PENDING_APPROVAL', 'ACTIVE')) OR (OLD.status = 'APPROVED' AND NEW.status = 'ACTIVE') THEN
    SELECT t.status INTO tax_status
      FROM pricing.rate_card_components c JOIN pricing.tax_policies t ON t.id = c.tax_policy_id
     WHERE c.rate_card_id = NEW.id FOR SHARE OF t;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pricing.rate_cards: the card has no component values' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF tax_status IS DISTINCT FROM 'APPROVED' THEN
      RAISE EXCEPTION 'pricing.rate_cards: the referenced tax policy is not APPROVED (%)', tax_status USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

-- Component values are part of the card's immutable snapshot: written only while the card is DRAFT. The parent is read
-- FOR SHARE and every status transition locks it FOR UPDATE, so a component write cannot race a submission.
CREATE FUNCTION pricing.rate_card_components_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  card_id uuid;
  parent_status text;
BEGIN
  FOREACH card_id IN ARRAY CASE TG_OP WHEN 'INSERT' THEN ARRAY[NEW.rate_card_id] WHEN 'DELETE' THEN ARRAY[OLD.rate_card_id]
                                       ELSE ARRAY[OLD.rate_card_id, NEW.rate_card_id] END LOOP
    SELECT r.status INTO parent_status FROM pricing.rate_cards r WHERE r.id = card_id FOR SHARE;
    IF parent_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'pricing.rate_card_components: the rate card is not a DRAFT (values are immutable)' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$fn$;

-- ── route snapshots (pricing doc §1; E07: the server route the prices were computed from) ─────────────────────────
-- `polyline` holds only geometry the bound vendor's terms permit storing (NULL otherwise); `polyline_expires_at` is a
-- terms-derived geometry TTL shorter than the quote retention (NULL = none): the purge job nulls the polyline then.
CREATE TABLE pricing.route_snapshots (
  id uuid PRIMARY KEY,
  provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9-]{1,31}$'),
  sku text NOT NULL CHECK (sku = 'ROUTE'),
  routing_profile text NOT NULL CHECK (routing_profile IN ('CAR')),
  fetched_at timestamptz NOT NULL,
  -- never STALE_SERVED for pricing
  cache_status text NOT NULL CHECK (cache_status IN ('HIT', 'MISS')),
  confidence text NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
  attribution_code text NULL CHECK (attribution_code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  distance_m integer NOT NULL CHECK (distance_m > 0),
  duration_s integer NOT NULL CHECK (duration_s >= 0),
  polyline text NULL CHECK (octet_length(polyline) <= 2048),
  polyline_expires_at timestamptz NULL,
  bbox geometry(Polygon, 4326) NULL CHECK (bbox IS NULL OR ST_SRID(bbox) = 4326),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (polyline_expires_at IS NULL OR polyline_expires_at > created_at)
);
CREATE INDEX route_snapshots_created ON pricing.route_snapshots (created_at);
CREATE INDEX route_snapshots_polyline_expiry ON pricing.route_snapshots (polyline_expires_at) WHERE polyline IS NOT NULL AND polyline_expires_at IS NOT NULL;

-- Immutable except `polyline -> NULL` (terms-derived geometry TTL). DELETE is the purge (worker grant only).
CREATE FUNCTION pricing.route_snapshot_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  IF (to_jsonb(NEW) - 'polyline') IS DISTINCT FROM (to_jsonb(OLD) - 'polyline') OR (NEW.polyline IS NOT NULL AND NEW.polyline IS DISTINCT FROM OLD.polyline) THEN
    RAISE EXCEPTION 'pricing.route_snapshots: snapshots are immutable (only the polyline may be removed)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;

-- ── quotes (pricing doc §4, §7; SM-2 Phase-3 subset; own aggregate, CON-P3-09) ────────────────────────────────────
CREATE TABLE pricing.quotes (
  id uuid PRIMARY KEY,
  quote_group_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  city_code text NOT NULL,
  product_code text NOT NULL,
  rate_card_id uuid NOT NULL REFERENCES pricing.rate_cards (id),
  rate_card_version integer NOT NULL CHECK (rate_card_version >= 1),
  zone_set_id uuid NOT NULL REFERENCES catalog.zone_sets (id),
  pricing_engine_version text NOT NULL CHECK (pricing_engine_version ~ '^pe-v[0-9]{1,4}$'),
  pickup geography(Point, 4326) NOT NULL,
  dropoff geography(Point, 4326) NOT NULL,
  pickup_point_id uuid NULL REFERENCES catalog.pickup_points (id),
  airport_pickup boolean NOT NULL,
  pickup_district_code text NULL REFERENCES catalog.districts (code),
  dropoff_district_code text NULL REFERENCES catalog.districts (code),
  distance_m integer NOT NULL CHECK (distance_m > 0),
  duration_s integer NOT NULL CHECK (duration_s >= 0),
  route_snapshot_id uuid NOT NULL REFERENCES pricing.route_snapshots (id),
  currency text NOT NULL CHECK (currency = 'PKR'),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  -- inclusive-tax disclosure (informational, never part of Σ); both or neither
  tax_included_rate_bp integer NULL CHECK (tax_included_rate_bp BETWEEN 0 AND 10000),
  tax_included_minor bigint NULL CHECK (tax_included_minor >= 0),
  toll_policy text NOT NULL CHECK (toll_policy IN ('NOT_APPLICABLE', 'EXCLUDED_DISCLOSED')),
  is_synthetic boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('PRICED', 'EXPIRED', 'SUPERSEDED')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  -- correlation only, no FK: idempotency rows expire long before quotes
  idempotency_record_id uuid NULL,
  UNIQUE (quote_group_id, product_code),
  FOREIGN KEY (city_code, product_code) REFERENCES catalog.city_service_products (city_code, product_code),
  CHECK ((tax_included_rate_bp IS NULL) = (tax_included_minor IS NULL)),
  CHECK (pickup_point_id IS NOT NULL OR NOT airport_pickup)
);
CREATE INDEX quotes_account_recent ON pricing.quotes (account_id, created_at DESC);
CREATE INDEX quotes_priced_expiry ON pricing.quotes (expires_at) WHERE status = 'PRICED';
CREATE INDEX quotes_created ON pricing.quotes (created_at);
CREATE INDEX quotes_route_snapshot ON pricing.quotes (route_snapshot_id);

-- A new quote is PRICED and priced with the ACTIVE card it names (id, version, city, product) inside the city's zone
-- set; afterwards every column is immutable and only status PRICED->EXPIRED or PRICED->SUPERSEDED may change. A quote
-- is deleted only after it expired (retention purge, worker grant only).
CREATE FUNCTION pricing.quote_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PRICED' THEN
      RAISE EXCEPTION 'pricing.quotes: a quote is created PRICED' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- read FOR SHARE: an activation retiring this card waits for the quote transaction (never a quote on a retired card)
    PERFORM 1 FROM pricing.rate_cards r
      WHERE r.id = NEW.rate_card_id AND r.version = NEW.rate_card_version AND r.city_code = NEW.city_code AND r.product_code = NEW.product_code
        AND r.status = 'ACTIVE'
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pricing.quotes: the quote must name the ACTIVE rate card of its city and product' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM catalog.zone_sets z WHERE z.id = NEW.zone_set_id AND z.city_code = NEW.city_code) THEN
      RAISE EXCEPTION 'pricing.quotes: the zone set belongs to another city' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.expires_at > now() THEN
      RAISE EXCEPTION 'pricing.quotes: a live quote cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'pricing.quotes: quotes are immutable (only the status changes)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'PRICED' AND NEW.status IN ('EXPIRED', 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'pricing.quotes: status % -> % not allowed', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TABLE pricing.quote_components (
  quote_id uuid NOT NULL REFERENCES pricing.quotes (id),
  seq smallint NOT NULL CHECK (seq BETWEEN 1 AND 32),
  kind text NOT NULL CHECK (kind IN ('BASE', 'DISTANCE', 'TIME', 'BOOKING_FEE', 'AIRPORT_FEE', 'MINIMUM_ADJUSTMENT', 'TOLL', 'TAX', 'DISCOUNT', 'ROUNDING')),
  amount_minor bigint NOT NULL,
  -- ids and numbers only (never coordinates or personal data)
  basis jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(basis) = 'object' AND octet_length(basis::text) <= 1024),
  PRIMARY KEY (quote_id, seq),
  UNIQUE (quote_id, kind),
  -- only ROUNDING may be negative; DISCOUNT (reserved for Phase 9) is never positive
  CHECK (kind = 'ROUNDING' OR (kind = 'DISCOUNT' AND amount_minor <= 0) OR (kind NOT IN ('ROUNDING', 'DISCOUNT') AND amount_minor >= 0))
);

-- Components are append-only (UPDATE rejected); DELETE is the purge together with the quote (worker grant only).
CREATE FUNCTION pricing.quote_component_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  RAISE EXCEPTION 'pricing.quote_components: components are append-only' USING ERRCODE = 'insufficient_privilege';
END
$fn$;

-- Deferred integrity of a priced quote at COMMIT: ≥ 1 component and Σ amount_minor = total_minor. A quote that no longer
-- exists (purged in the same transaction as its components) is not checked.
CREATE FUNCTION pricing.assert_quote_balanced() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  target uuid;
  total bigint;
  n integer;
  s numeric;
BEGIN
  IF TG_TABLE_NAME = 'quotes' THEN
    target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target := OLD.quote_id;
  ELSE
    target := NEW.quote_id;
  END IF;
  SELECT q.total_minor INTO total FROM pricing.quotes q WHERE q.id = target;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*), coalesce(sum(c.amount_minor), 0) INTO n, s FROM pricing.quote_components c WHERE c.quote_id = target;
  IF n = 0 THEN
    RAISE EXCEPTION 'pricing.quotes: quote % has no components', target USING ERRCODE = 'check_violation';
  END IF;
  IF s <> total THEN
    RAISE EXCEPTION 'pricing.quotes: components of quote % do not sum to its total', target USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION pricing.tax_policy_guard(), pricing.rate_card_guard(), pricing.rate_card_components_guard(), pricing.route_snapshot_guard(),
  pricing.quote_guard(), pricing.quote_component_guard(), pricing.assert_quote_balanced() FROM PUBLIC;

CREATE TRIGGER tax_policies_guard BEFORE INSERT OR UPDATE OR DELETE ON pricing.tax_policies FOR EACH ROW EXECUTE FUNCTION pricing.tax_policy_guard();
CREATE TRIGGER rate_cards_guard BEFORE INSERT OR UPDATE OR DELETE ON pricing.rate_cards FOR EACH ROW EXECUTE FUNCTION pricing.rate_card_guard();
CREATE TRIGGER rate_card_components_guard BEFORE INSERT OR UPDATE OR DELETE ON pricing.rate_card_components
  FOR EACH ROW EXECUTE FUNCTION pricing.rate_card_components_guard();
CREATE TRIGGER route_snapshots_guard BEFORE UPDATE ON pricing.route_snapshots FOR EACH ROW EXECUTE FUNCTION pricing.route_snapshot_guard();
CREATE TRIGGER quotes_guard BEFORE INSERT OR UPDATE OR DELETE ON pricing.quotes FOR EACH ROW EXECUTE FUNCTION pricing.quote_guard();
CREATE TRIGGER quote_components_append_only BEFORE UPDATE ON pricing.quote_components FOR EACH ROW EXECUTE FUNCTION pricing.quote_component_guard();
CREATE CONSTRAINT TRIGGER quotes_balanced AFTER INSERT ON pricing.quotes DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION pricing.assert_quote_balanced();
CREATE CONSTRAINT TRIGGER quote_components_balanced AFTER INSERT OR DELETE ON pricing.quote_components DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION pricing.assert_quote_balanced();
CREATE TRIGGER tax_policies_no_truncate BEFORE TRUNCATE ON pricing.tax_policies FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER rate_cards_no_truncate BEFORE TRUNCATE ON pricing.rate_cards FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER rate_card_components_no_truncate BEFORE TRUNCATE ON pricing.rate_card_components FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER route_snapshots_no_truncate BEFORE TRUNCATE ON pricing.route_snapshots FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER quotes_no_truncate BEFORE TRUNCATE ON pricing.quotes FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER quote_components_no_truncate BEFORE TRUNCATE ON pricing.quote_components FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
-- API: quote creation/restore/supersede, staff pricing administration (component editing = DELETE + INSERT on a DRAFT
-- card, guard-restricted). The API never deletes quotes, snapshots or configuration.
GRANT USAGE ON SCHEMA pricing TO wayvro_api;
GRANT SELECT ON pricing.tax_policies, pricing.rate_cards, pricing.rate_card_components, pricing.route_snapshots, pricing.quotes, pricing.quote_components TO wayvro_api;
GRANT INSERT ON pricing.tax_policies, pricing.rate_cards, pricing.rate_card_components, pricing.route_snapshots, pricing.quotes, pricing.quote_components TO wayvro_api;
GRANT DELETE ON pricing.rate_card_components TO wayvro_api;
GRANT UPDATE (status, approved_by_staff_id, approval_reason_code, effective_from, effective_until, scheduled, version_lock, submission_preview,
              envelope_override_reason_code) ON pricing.rate_cards TO wayvro_api;
GRANT UPDATE (status, approved_by_staff_id, version_lock) ON pricing.tax_policies TO wayvro_api;
GRANT UPDATE (status) ON pricing.quotes TO wayvro_api;

-- Worker: maintenance.purge (expire, retention delete, terms-derived polyline removal) and config.scheduled-activation
-- of rate cards (which re-checks the card's tax policy at run time, so it reads the referencing columns).
GRANT USAGE ON SCHEMA pricing TO wayvro_worker;
GRANT SELECT, DELETE ON pricing.quotes, pricing.quote_components, pricing.route_snapshots TO wayvro_worker;
GRANT UPDATE (status) ON pricing.quotes TO wayvro_worker;
GRANT UPDATE (polyline) ON pricing.route_snapshots TO wayvro_worker;
GRANT SELECT (id, city_code, product_code, version, status, is_synthetic, effective_from, effective_until, scheduled, version_lock),
  UPDATE (status, effective_from, effective_until, scheduled, version_lock) ON pricing.rate_cards TO wayvro_worker;
GRANT SELECT (rate_card_id, tax_policy_id) ON pricing.rate_card_components TO wayvro_worker;
GRANT SELECT (id, status, is_placeholder) ON pricing.tax_policies TO wayvro_worker;
-- row-lock privilege only: the rate-card guard reads the tax policy FOR SHARE at activation (PostgreSQL requires an
-- UPDATE privilege for a locking read); the tax-policy guard refuses every update that is not a lifecycle transition,
-- and the worker performs none
GRANT UPDATE (version_lock) ON pricing.tax_policies TO wayvro_worker;

RESET ROLE;
