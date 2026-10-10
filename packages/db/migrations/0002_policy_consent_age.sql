-- wayvro-migration: 0002_policy_consent_age
-- compatibility: additive (expand) — new schema `legal`, four new tables, one generic append-only trigger function; no existing object is altered; safe with every P2.1 application version (none reads these tables)
-- data-impact: seeds exactly one reference row: age-eligibility policy version 1, status PLACEHOLDER_NOT_FOR_PRODUCTION, with NO age threshold (A15/EG-23 — thresholds are never invented). Policy document rows are registered by the API at boot from @wayvro/legal-content (immutable, verified). Synthetic data only until the Phase 7 gates
-- rollback: before any real data exists (pre-Phase 7): DROP TABLE identity.age_declarations, identity.consent_records; DROP SCHEMA legal CASCADE; DROP FUNCTION platform.append_only(). Afterwards: forward-fix only (consent/age records are legal evidence and must never be dropped)
-- verification: packages/db/test/policy-consent-age.integration.test.ts — clean->latest, previous->latest, re-run applies 0, immutability/append-only triggers, composite-FK hash/mode binding, grants executed as LOGIN members of the restricted roles

SET LOCAL ROLE wayvro_migrator;

CREATE SCHEMA legal;

-- Generic append-only guard for evidence tables (policy registry, consent and age records). Table owners and
-- application roles alike are rejected; a database superuser can still bypass it (documented, ADR-038).
CREATE FUNCTION platform.append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  RAISE EXCEPTION '%.% is append-only (% rejected)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$fn$;
REVOKE ALL ON FUNCTION platform.append_only() FROM PUBLIC;

-- ── legal ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- Immutable policy registry (A04/R09/W05). One row per (policy, version, locale), registered from the policy-content
-- package; a newer effective version supersedes an older one (there is no in-place status change).
CREATE TABLE legal.policy_documents (
  policy_key text NOT NULL CHECK (policy_key ~ '^[A-Z][A-Z_]{2,40}$'),
  version integer NOT NULL CHECK (version >= 1),
  locale text NOT NULL CHECK (locale IN ('en', 'ur')),
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  status text NOT NULL CHECK (status IN ('PLACEHOLDER_NOT_FOR_PRODUCTION', 'APPROVED')),
  material_change boolean NOT NULL,
  effective_at timestamptz NOT NULL,
  canonical_path text NOT NULL CHECK (canonical_path ~ '^/legal/[a-z0-9-]{2,60}/v[0-9]{1,6}$'),
  approval_ref text NULL CHECK (approval_ref IS NULL OR char_length(approval_ref) BETWEEN 1 AND 200),
  registered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_key, version, locale),
  -- consent records reference (key, version, locale, hash) so the database itself binds a consent to the exact text
  UNIQUE (policy_key, version, locale, content_sha256),
  CHECK ((status = 'APPROVED') = (approval_ref IS NOT NULL))
);
CREATE TRIGGER policy_documents_immutable BEFORE UPDATE OR DELETE ON legal.policy_documents FOR EACH ROW EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER policy_documents_no_truncate BEFORE TRUNCATE ON legal.policy_documents FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

-- Age/guardian eligibility policy versions (A15). Values are POLICY DATA entered from counsel's decision through
-- maker-checker (P2.5); no threshold exists in code. The teen programme (L21) stays disabled at the schema level.
CREATE TABLE legal.age_eligibility_policies (
  version integer PRIMARY KEY CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('PLACEHOLDER_NOT_FOR_PRODUCTION', 'APPROVED', 'RETIRED')),
  rider_declaration_mode text NOT NULL CHECK (rider_declaration_mode IN ('NONE', 'AFFIRM_MINIMUM_AGE', 'DATE_OF_BIRTH_REQUIRED')),
  rider_minimum_age smallint NULL CHECK (rider_minimum_age IS NULL OR rider_minimum_age BETWEEN 1 AND 120),
  driver_minimum_age smallint NULL CHECK (driver_minimum_age IS NULL OR driver_minimum_age BETWEEN 1 AND 120),
  guardian_rules_ref text NULL CHECK (guardian_rules_ref IS NULL OR char_length(guardian_rules_ref) BETWEEN 1 AND 200),
  teen_programme_enabled boolean NOT NULL DEFAULT false CHECK (NOT teen_programme_enabled),
  approval_ref text NULL CHECK (approval_ref IS NULL OR char_length(approval_ref) BETWEEN 1 AND 200),
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz NULL,
  -- age declarations reference (version, mode) so a declaration's shape is bound to its policy's mode
  UNIQUE (version, rider_declaration_mode),
  CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL)),
  CHECK (status <> 'PLACEHOLDER_NOT_FOR_PRODUCTION' OR approval_ref IS NULL),
  CHECK (
    status <> 'APPROVED'
    OR (approval_ref IS NOT NULL AND driver_minimum_age IS NOT NULL AND (rider_declaration_mode = 'NONE' OR rider_minimum_age IS NOT NULL))
  )
);

-- Only retirement may change a version (status -> RETIRED, retired_at set); values never change in place.
CREATE FUNCTION legal.age_policy_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'legal.age_eligibility_policies rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'RETIRED' OR NEW.status <> 'RETIRED'
     OR (NEW.version, NEW.rider_declaration_mode, NEW.rider_minimum_age, NEW.driver_minimum_age, NEW.guardian_rules_ref,
         NEW.teen_programme_enabled, NEW.approval_ref, NEW.effective_at, NEW.created_at)
        IS DISTINCT FROM
        (OLD.version, OLD.rider_declaration_mode, OLD.rider_minimum_age, OLD.driver_minimum_age, OLD.guardian_rules_ref,
         OLD.teen_programme_enabled, OLD.approval_ref, OLD.effective_at, OLD.created_at) THEN
    RAISE EXCEPTION 'legal.age_eligibility_policies: a version is immutable except for retirement' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION legal.age_policy_guard() FROM PUBLIC;
CREATE TRIGGER age_policies_guard BEFORE UPDATE OR DELETE ON legal.age_eligibility_policies FOR EACH ROW EXECUTE FUNCTION legal.age_policy_guard();
CREATE TRIGGER age_policies_no_truncate BEFORE TRUNCATE ON legal.age_eligibility_policies FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

-- Placeholder policy for local/test/staging only: minimum-age AFFIRMATION, no threshold, no rider DOB. Production
-- refuses a placeholder current policy at boot (CL-P2-09); counsel's values arrive as a new APPROVED version (P2.A9).
INSERT INTO legal.age_eligibility_policies (version, status, rider_declaration_mode, effective_at)
VALUES (1, 'PLACEHOLDER_NOT_FOR_PRODUCTION', 'AFFIRM_MINIMUM_AGE', '2026-10-10T00:00:00Z');

-- ── identity: consent and age-declaration evidence (append-only) ─────────────────────────────────────────────────
CREATE TABLE identity.consent_records (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  policy_key text NOT NULL,
  policy_version integer NOT NULL,
  locale text NOT NULL,
  content_sha256 bytea NOT NULL,
  action text NOT NULL CHECK (action IN ('ACCEPTED', 'DECLINED', 'WITHDRAWN')),
  surface text NOT NULL CHECK (surface IN ('MOBILE_APP', 'WEB_PUBLIC')),
  session_id uuid NULL REFERENCES identity.sessions (id),
  app_version text NULL CHECK (app_version IS NULL OR char_length(app_version) BETWEEN 1 AND 32),
  request_id text NULL CHECK (request_id IS NULL OR request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  -- the exact registered text (key, version, locale AND content hash) — a consent to unknown wording cannot exist
  FOREIGN KEY (policy_key, policy_version, locale, content_sha256) REFERENCES legal.policy_documents (policy_key, version, locale, content_sha256)
);
CREATE INDEX consent_records_account_policy ON identity.consent_records (account_id, policy_key, recorded_at DESC, id DESC);
CREATE TRIGGER consent_records_append_only BEFORE UPDATE OR DELETE ON identity.consent_records FOR EACH ROW EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER consent_records_no_truncate BEFORE TRUNCATE ON identity.consent_records FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

CREATE TABLE identity.age_declarations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts (id),
  policy_version integer NOT NULL,
  declaration_mode text NOT NULL CHECK (declaration_mode IN ('AFFIRM_MINIMUM_AGE', 'DATE_OF_BIRTH_REQUIRED')),
  affirmed boolean NULL,
  -- versioned AES-256-GCM envelope (key class identity_dates) — present ONLY when the policy mode requires a DOB
  dob_envelope bytea NULL CHECK (dob_envelope IS NULL OR octet_length(dob_envelope) > 31),
  session_id uuid NULL REFERENCES identity.sessions (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  -- one declaration per account per policy version
  UNIQUE (account_id, policy_version),
  -- the declaration's mode must be the policy version's mode
  FOREIGN KEY (policy_version, declaration_mode) REFERENCES legal.age_eligibility_policies (version, rider_declaration_mode),
  CHECK (
    (declaration_mode = 'AFFIRM_MINIMUM_AGE' AND affirmed IS NOT NULL AND dob_envelope IS NULL)
    OR (declaration_mode = 'DATE_OF_BIRTH_REQUIRED' AND dob_envelope IS NOT NULL AND affirmed IS NULL)
  )
);
CREATE TRIGGER age_declarations_append_only BEFORE UPDATE OR DELETE ON identity.age_declarations FOR EACH ROW EXECUTE FUNCTION platform.append_only();
CREATE TRIGGER age_declarations_no_truncate BEFORE TRUNCATE ON identity.age_declarations FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA legal TO wayvro_api;
-- the API registers the policy-content catalogue at boot (insert-only; the trigger forbids any change afterwards)
GRANT SELECT, INSERT ON legal.policy_documents TO wayvro_api;
-- age-policy versions are read by the API; data entry (maker-checker) arrives with the staff realm (P2.5)
GRANT SELECT ON legal.age_eligibility_policies TO wayvro_api;
GRANT SELECT, INSERT ON identity.consent_records, identity.age_declarations TO wayvro_api;

RESET ROLE;
