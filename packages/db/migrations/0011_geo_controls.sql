-- wayvro-migration: 0011_geo_controls
-- compatibility: additive (expand) — new schema `geo`: provider budgets (maker-checker with the single-staff DECREASE exception, guard trigger), hourly provider usage rollups and Wayvro-curated landmark aliases (approver ≠ creator, guard trigger); no existing object is altered; independent of 0010/0012; safe with every Phase-2 application version (none reads the new objects)
-- data-impact: none seeded — local/test budgets come from GEO_LOCAL_DAILY_CALLS_PER_SKU; staging/production require an ACTIVE budget row (absent ⇒ that SKU is refused). Usage rows hold aggregate counters only (no account, text or coordinate). Aliases are founder/field text, never provider data
-- rollback: before any budget or alias is entered: DROP SCHEMA geo CASCADE. Afterwards: forward-fix only (configuration history is never dropped)
-- verification: packages/db/test/geo-controls.integration.test.ts — clean->latest, every previous->latest, re-run 0, hour-bucket CHECK, one ACTIVE budget per (provider, SKU), maker-checker + DECREASE rule, guard triggers (immutability, transitions, no delete), alias approver ≠ creator, grants as wayvro_api / wayvro_worker, nothing for PUBLIC

SET LOCAL ROLE wayvro_migrator;

CREATE SCHEMA geo;

-- ── provider budgets (cost controls; docs/phase3/PHASE3_SECURITY_COST_THREAT_MODEL.md §6) ──────────────────────────
CREATE TABLE geo.provider_budgets (
  id uuid PRIMARY KEY,
  provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9-]{1,31}$'),
  sku text NOT NULL CHECK (sku IN ('AUTOCOMPLETE', 'GEOCODE', 'REVERSE_GEOCODE', 'PLACE_RESOLVE', 'ROUTE')),
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED')),
  daily_calls integer NOT NULL CHECK (daily_calls BETWEEN 0 AND 10000000),
  monthly_calls integer NOT NULL CHECK (monthly_calls BETWEEN 0 AND 300000000),
  monthly_cost_micro_usd bigint NOT NULL CHECK (monthly_cost_micro_usd BETWEEN 0 AND 100000000000),
  alert_thresholds_pct smallint[] NOT NULL DEFAULT '{50,80,100}'
    CHECK (alert_thresholds_pct <@ ARRAY[10, 25, 50, 75, 80, 90, 100]::smallint[] AND cardinality(alert_thresholds_pct) BETWEEN 1 AND 7),
  change_kind text NOT NULL CHECK (change_kind IN ('INITIAL', 'INCREASE', 'DECREASE')),
  drafted_by_staff_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  effective_from timestamptz NULL,
  effective_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1),
  UNIQUE (provider_key, sku, version),
  CHECK (daily_calls <= monthly_calls),
  -- maker-checker: the approver never drafted the budget, except in the safe direction (a DECREASE may be approved by
  -- the single authorised staff member who drafted it, with step-up); the guard trigger proves the decrease
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id IS DISTINCT FROM drafted_by_staff_id OR change_kind = 'DECREASE'),
  CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED') OR approved_by_staff_id IS NOT NULL),
  CHECK (status NOT IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED') OR approved_by_staff_id IS NULL),
  CHECK ((status = 'ACTIVE') <= (effective_from IS NOT NULL)),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from)
);
CREATE UNIQUE INDEX provider_budgets_one_active ON geo.provider_budgets (provider_key, sku) WHERE status = 'ACTIVE';

-- Values are immutable; the only transitions are DRAFT -> PENDING_APPROVAL -> APPROVED (approver set) | REJECTED,
-- APPROVED -> ACTIVE (effective_from set) | RETIRED, ACTIVE -> RETIRED (effective_until set). No delete. A DECREASE row
-- must, when inserted, be at or below every limit of the then-ACTIVE row of its (provider, SKU) and strictly below at
-- least one (otherwise it is not the safe direction and must go through maker-checker as an INCREASE).
CREATE FUNCTION geo.config_version_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  active_row geo.provider_budgets%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'geo.provider_budgets rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.approved_by_staff_id IS NOT NULL OR NEW.effective_from IS NOT NULL OR NEW.effective_until IS NOT NULL THEN
      RAISE EXCEPTION 'geo.provider_budgets: a budget starts as an unapproved DRAFT' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.change_kind = 'DECREASE' THEN
      SELECT * INTO active_row FROM geo.provider_budgets
       WHERE provider_key = NEW.provider_key AND sku = NEW.sku AND status = 'ACTIVE' FOR SHARE;
      IF NOT FOUND
         OR NEW.daily_calls > active_row.daily_calls
         OR NEW.monthly_calls > active_row.monthly_calls
         OR NEW.monthly_cost_micro_usd > active_row.monthly_cost_micro_usd
         OR (NEW.daily_calls = active_row.daily_calls AND NEW.monthly_calls = active_row.monthly_calls
             AND NEW.monthly_cost_micro_usd = active_row.monthly_cost_micro_usd) THEN
        RAISE EXCEPTION 'geo.provider_budgets: a DECREASE must lower the ACTIVE budget' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.provider_key, NEW.sku, NEW.version, NEW.daily_calls, NEW.monthly_calls, NEW.monthly_cost_micro_usd,
      NEW.alert_thresholds_pct, NEW.change_kind, NEW.drafted_by_staff_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.provider_key, OLD.sku, OLD.version, OLD.daily_calls, OLD.monthly_calls, OLD.monthly_cost_micro_usd,
      OLD.alert_thresholds_pct, OLD.change_kind, OLD.drafted_by_staff_id, OLD.created_at) THEN
    RAISE EXCEPTION 'geo.provider_budgets: budget values are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL' AND NEW.approved_by_staff_id IS NULL)
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED' AND NEW.approved_by_staff_id IS NOT NULL)
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'REJECTED' AND NEW.approved_by_staff_id IS NULL)
    OR (OLD.status = 'APPROVED' AND NEW.status = 'ACTIVE' AND NEW.effective_from IS NOT NULL
        AND NEW.approved_by_staff_id IS NOT DISTINCT FROM OLD.approved_by_staff_id)
    OR (OLD.status IN ('APPROVED', 'ACTIVE') AND NEW.status = 'RETIRED' AND NEW.effective_until IS NOT NULL
        AND NEW.approved_by_staff_id IS NOT DISTINCT FROM OLD.approved_by_staff_id
        AND NEW.effective_from IS NOT DISTINCT FROM OLD.effective_from)
  ) THEN
    RAISE EXCEPTION 'geo.provider_budgets: transition % -> % not allowed', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION geo.config_version_guard() FROM PUBLIC;
CREATE TRIGGER provider_budgets_guard BEFORE INSERT OR UPDATE OR DELETE ON geo.provider_budgets FOR EACH ROW EXECUTE FUNCTION geo.config_version_guard();

-- ── hourly provider usage (aggregates only; 400-day retention by the worker purge) ────────────────────────────────
CREATE TABLE geo.provider_usage (
  provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9-]{1,31}$'),
  sku text NOT NULL CHECK (sku IN ('AUTOCOMPLETE', 'GEOCODE', 'REVERSE_GEOCODE', 'PLACE_RESOLVE', 'ROUTE')),
  -- whole UTC hours (immutable form: independent of the session time zone)
  hour_bucket timestamptz NOT NULL CHECK (date_trunc('hour', hour_bucket AT TIME ZONE 'UTC') = hour_bucket AT TIME ZONE 'UTC'),
  calls bigint NOT NULL DEFAULT 0 CHECK (calls >= 0),
  cache_hits bigint NOT NULL DEFAULT 0 CHECK (cache_hits >= 0),
  errors bigint NOT NULL DEFAULT 0 CHECK (errors >= 0),
  timeouts bigint NOT NULL DEFAULT 0 CHECK (timeouts >= 0),
  budget_refusals bigint NOT NULL DEFAULT 0 CHECK (budget_refusals >= 0),
  est_cost_micro_usd bigint NOT NULL DEFAULT 0 CHECK (est_cost_micro_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_key, sku, hour_bucket)
);
CREATE INDEX provider_usage_hour ON geo.provider_usage (hour_bucket);

-- ── landmark aliases (Wayvro-curated search spellings; never provider-derived content) ───────────────────────────
CREATE TABLE geo.landmark_aliases (
  id uuid PRIMARY KEY,
  city_code text NOT NULL REFERENCES catalog.cities (code),
  locale text NOT NULL CHECK (locale IN ('en', 'ur', 'ur-Latn')),
  alias_normalised text NOT NULL CHECK (char_length(alias_normalised) BETWEEN 2 AND 80),
  alias_display text NOT NULL CHECK (char_length(alias_display) BETWEEN 1 AND 80),
  canonical_query text NOT NULL CHECK (char_length(canonical_query) BETWEEN 2 AND 120),
  source text NOT NULL CHECK (source IN ('FOUNDER', 'FIELD')),
  status text NOT NULL CHECK (status IN ('PROPOSED', 'ACTIVE', 'RETIRED')),
  created_by_staff_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- maker-checker: an alias becomes ACTIVE only through a different staff member
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id <> created_by_staff_id),
  CHECK (status <> 'ACTIVE' OR approved_by_staff_id IS NOT NULL)
);
CREATE UNIQUE INDEX landmark_aliases_one_active ON geo.landmark_aliases (city_code, locale, alias_normalised) WHERE status = 'ACTIVE';

-- Content is immutable; PROPOSED -> ACTIVE (approver set) | RETIRED, ACTIVE -> RETIRED. No delete.
CREATE FUNCTION geo.landmark_alias_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'geo.landmark_aliases rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PROPOSED' OR NEW.approved_by_staff_id IS NOT NULL THEN
      RAISE EXCEPTION 'geo.landmark_aliases: an alias starts as an unapproved proposal' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.city_code, NEW.locale, NEW.alias_normalised, NEW.alias_display, NEW.canonical_query, NEW.source,
      NEW.created_by_staff_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.city_code, OLD.locale, OLD.alias_normalised, OLD.alias_display, OLD.canonical_query, OLD.source,
      OLD.created_by_staff_id, OLD.created_at) THEN
    RAISE EXCEPTION 'geo.landmark_aliases: alias content is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
       (OLD.status = 'PROPOSED' AND NEW.status = 'ACTIVE' AND NEW.approved_by_staff_id IS NOT NULL)
    OR (OLD.status = 'PROPOSED' AND NEW.status = 'RETIRED' AND NEW.approved_by_staff_id IS NULL)
    OR (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED' AND NEW.approved_by_staff_id IS NOT DISTINCT FROM OLD.approved_by_staff_id)
  ) THEN
    RAISE EXCEPTION 'geo.landmark_aliases: transition % -> % not allowed', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION geo.landmark_alias_guard() FROM PUBLIC;
CREATE TRIGGER landmark_aliases_guard BEFORE INSERT OR UPDATE OR DELETE ON geo.landmark_aliases FOR EACH ROW EXECUTE FUNCTION geo.landmark_alias_guard();

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA geo TO wayvro_api;
GRANT SELECT ON geo.provider_budgets, geo.provider_usage, geo.landmark_aliases TO wayvro_api;
GRANT INSERT ON geo.provider_budgets, geo.landmark_aliases TO wayvro_api;
GRANT UPDATE (status, approved_by_staff_id, effective_from, effective_until, version_lock) ON geo.provider_budgets TO wayvro_api;
GRANT UPDATE (status, approved_by_staff_id) ON geo.landmark_aliases TO wayvro_api;

-- worker: hourly rollup upserts (absolute values) and retention deletes; nothing else in geo
GRANT USAGE ON SCHEMA geo TO wayvro_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON geo.provider_usage TO wayvro_worker;

RESET ROLE;
