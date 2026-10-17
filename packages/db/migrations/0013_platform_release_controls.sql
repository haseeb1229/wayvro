-- wayvro-migration: 0013_platform_release_controls
-- compatibility: additive (expand) — four new tables in the existing `platform` schema (app version policies + blocked build ranges, runtime switches + their change history) with guard functions; no existing object altered; safe with every earlier application version (none reads the new objects)
-- data-impact: none seeded — absence of an ACTIVE version policy means client state OK (no update enforcement; ADR-049 deliberate fail-open) and absence of a switch row means the code-registry default for the environment
-- rollback: before any staff-entered policy or switch change exists: DROP TABLE platform.runtime_switch_changes, platform.runtime_switches, platform.app_blocked_builds, platform.app_version_policies; DROP FUNCTION platform.app_version_policy_guard(), platform.app_blocked_builds_guard(), platform.runtime_switch_change_guard(). Afterwards: forward-fix only (release-control history is configuration evidence and is never dropped)
-- verification: packages/db/test/release-controls.integration.test.ts — clean->latest, every previous->latest, live-row upgrade, re-run 0, one ACTIVE policy per platform, maker-checker CHECKs, blocked-range overlap rejection and DRAFT-only ranges, FROM_SAFE maker-checker CHECK, guard triggers, grants as wayvro_api / wayvro_worker, PUBLIC none

SET LOCAL ROLE wayvro_migrator;

-- ── app version policies (A01/Q31; ADR-049) ─────────────────────────────────────────────────────────────────────
-- One ACTIVE policy per platform. Maker-checker: a different staff member approves (service rule AND CHECK).
-- `scheduled` = activation requested for a future `effective_from` (worker job config.scheduled-activation).
CREATE TABLE platform.app_version_policies (
  id uuid PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED')),
  min_supported_build integer NOT NULL CHECK (min_supported_build >= 0),
  recommended_build integer NOT NULL,
  -- store ids are undecided (EG-15): a key the app maps to its store link, never a URL
  store_url_key text NULL CHECK (store_url_key ~ '^[a-z][a-z0-9_.-]{2,40}$'),
  soft_message_key text NOT NULL CHECK (soft_message_key ~ '^[a-z][a-zA-Z0-9_.-]{2,80}$'),
  hard_message_key text NOT NULL CHECK (hard_message_key ~ '^[a-z][a-zA-Z0-9_.-]{2,80}$'),
  effective_from timestamptz NULL,
  effective_until timestamptz NULL,
  scheduled boolean NOT NULL DEFAULT false,
  drafted_by_staff_id uuid NOT NULL REFERENCES staff.staff_accounts (id),
  approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1),
  UNIQUE (platform, version),
  CHECK (recommended_build >= min_supported_build),
  -- maker-checker: the approver never drafted the policy; APPROVED/ACTIVE/RETIRED always carry an approver
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id <> drafted_by_staff_id),
  CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED') OR approved_by_staff_id IS NOT NULL),
  CHECK ((status = 'ACTIVE') <= (effective_from IS NOT NULL)),
  CHECK (NOT scheduled OR (status = 'APPROVED' AND effective_from IS NOT NULL)),
  CHECK (effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until >= effective_from))
);
CREATE UNIQUE INDEX app_version_policies_one_active ON platform.app_version_policies (platform) WHERE status = 'ACTIVE';
CREATE INDEX app_version_policies_scheduled ON platform.app_version_policies (effective_from) WHERE scheduled;

-- No delete; id/platform/version/drafter/created_at never change; values change only while DRAFT; allowed status
-- transitions only: DRAFT -> PENDING_APPROVAL (no approver), PENDING_APPROVAL -> APPROVED (approver set) or REJECTED,
-- APPROVED -> ACTIVE (effective_from set, not scheduled), ACTIVE -> RETIRED (effective_until set), APPROVED -> RETIRED.
-- Without a status change only a DRAFT's values or an APPROVED policy's schedule (effective_from/scheduled) change.
CREATE FUNCTION platform.app_version_policy_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'platform.app_version_policies rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.id, NEW.platform, NEW.version, NEW.drafted_by_staff_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.platform, OLD.version, OLD.drafted_by_staff_id, OLD.created_at) THEN
    RAISE EXCEPTION 'platform.app_version_policies: identity columns are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'DRAFT'
     AND (NEW.min_supported_build, NEW.recommended_build, NEW.store_url_key, NEW.soft_message_key, NEW.hard_message_key)
         IS DISTINCT FROM (OLD.min_supported_build, OLD.recommended_build, OLD.store_url_key, OLD.soft_message_key, OLD.hard_message_key) THEN
    RAISE EXCEPTION 'platform.app_version_policies: policy values are immutable after submission' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.approved_by_staff_id IS DISTINCT FROM OLD.approved_by_staff_id
     AND NOT (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED') THEN
    RAISE EXCEPTION 'platform.app_version_policies: the approver is set only by the approval' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = OLD.status THEN
    IF OLD.status = 'APPROVED' THEN
      IF NEW.effective_until IS DISTINCT FROM OLD.effective_until THEN
        RAISE EXCEPTION 'platform.app_version_policies: an APPROVED policy changes only its schedule' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF (NEW.effective_from, NEW.effective_until, NEW.scheduled) IS DISTINCT FROM (OLD.effective_from, OLD.effective_until, OLD.scheduled) THEN
      RAISE EXCEPTION 'platform.app_version_policies: % policies cannot be rescheduled', OLD.status USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL' AND NEW.approved_by_staff_id IS NULL)
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED' AND NEW.approved_by_staff_id IS NOT NULL)
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'REJECTED' AND NEW.approved_by_staff_id IS NULL)
    OR (OLD.status = 'APPROVED' AND NEW.status = 'ACTIVE' AND NEW.effective_from IS NOT NULL AND NOT NEW.scheduled AND NEW.effective_until IS NULL)
    OR (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED' AND NEW.effective_until IS NOT NULL AND NEW.effective_from IS NOT DISTINCT FROM OLD.effective_from)
    OR (OLD.status = 'APPROVED' AND NEW.status = 'RETIRED' AND NOT NEW.scheduled)
  ) THEN
    RAISE EXCEPTION 'platform.app_version_policies: transition % -> % not allowed', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION platform.app_version_policy_guard() FROM PUBLIC;
CREATE TRIGGER app_version_policies_guard BEFORE UPDATE OR DELETE ON platform.app_version_policies FOR EACH ROW EXECUTE FUNCTION platform.app_version_policy_guard();
CREATE TRIGGER app_version_policies_no_truncate BEFORE TRUNCATE ON platform.app_version_policies FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

-- Blocked build ranges of a policy, each with its reason. Bounded ranges only; no overlap within a policy (checked by
-- the guard trigger — no btree_gist extension, DM-OPEN-03); writable only while the policy is DRAFT.
CREATE TABLE platform.app_blocked_builds (
  policy_id uuid NOT NULL REFERENCES platform.app_version_policies (id),
  builds int4range NOT NULL CHECK (NOT isempty(builds) AND NOT lower_inf(builds) AND NOT upper_inf(builds) AND lower(builds) >= 0),
  reason_code text NOT NULL CHECK (reason_code IN ('SECURITY', 'DATA_CORRUPTION', 'CONTRACT_BREAK')),
  PRIMARY KEY (policy_id, builds)
);

-- The parent row is locked FOR UPDATE (the submit transition locks it too), so concurrent range writes and a submit
-- serialise and the overlap check always sees committed siblings.
CREATE FUNCTION platform.app_blocked_builds_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM platform.app_version_policies
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.policy_id ELSE NEW.policy_id END FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'platform.app_blocked_builds: ranges change only while the policy is DRAFT' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.policy_id <> OLD.policy_id THEN
    RAISE EXCEPTION 'platform.app_blocked_builds: a range cannot move to another policy' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1 FROM platform.app_blocked_builds b
     WHERE b.policy_id = NEW.policy_id AND b.builds && NEW.builds AND (TG_OP = 'INSERT' OR b.builds <> OLD.builds)
  ) THEN
    RAISE EXCEPTION 'platform.app_blocked_builds: ranges of one policy must not overlap' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION platform.app_blocked_builds_guard() FROM PUBLIC;
CREATE TRIGGER app_blocked_builds_guard BEFORE INSERT OR UPDATE OR DELETE ON platform.app_blocked_builds FOR EACH ROW EXECUTE FUNCTION platform.app_blocked_builds_guard();
CREATE TRIGGER app_blocked_builds_no_truncate BEFORE TRUNCATE ON platform.app_blocked_builds FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

-- ── runtime switches (A01/V10/I11; ADR-049) ─────────────────────────────────────────────────────────────────────
-- Current state per (key, scope, city); keys are validated against the code registry by the service (the database
-- cannot see code). No row = registry default. A NULL changer means the system (effective_until expiry job).
CREATE TABLE platform.runtime_switches (
  id uuid PRIMARY KEY,
  key text NOT NULL CHECK (key ~ '^(rider|driver|ops|platform)\.[a-z0-9]+(-[a-z0-9]+)*$'),
  scope text NOT NULL CHECK (scope IN ('ALL', 'RIDER', 'DRIVER')),
  city_code text NULL REFERENCES catalog.cities (code),
  state text NOT NULL CHECK (state IN ('ENABLED', 'DISABLED')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  message_key text NULL CHECK (message_key ~ '^[a-z][a-zA-Z0-9_.-]{2,80}$'),
  expected_end timestamptz NULL,
  effective_until timestamptz NULL,
  changed_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT runtime_switches_target UNIQUE NULLS NOT DISTINCT (key, scope, city_code),
  CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id IS DISTINCT FROM changed_by_staff_id)
);
CREATE INDEX runtime_switches_expiring ON platform.runtime_switches (effective_until) WHERE effective_until IS NOT NULL;

-- Append-only history incl. pending restore requests. TO_SAFE = one authorised staff member (applied at once);
-- FROM_SAFE = maker-checker (applied only with an approver who is not the requester); EXPIRY = the system returned the
-- switch to its registry default at the effective_until set by the TO_SAFE change (pre-authorised; no staff actor).
CREATE TABLE platform.runtime_switch_changes (
  id uuid PRIMARY KEY,
  switch_key text NOT NULL CHECK (switch_key ~ '^(rider|driver|ops|platform)\.[a-z0-9]+(-[a-z0-9]+)*$'),
  scope text NOT NULL CHECK (scope IN ('ALL', 'RIDER', 'DRIVER')),
  city_code text NULL REFERENCES catalog.cities (code),
  from_state text NOT NULL CHECK (from_state IN ('ENABLED', 'DISABLED')),
  to_state text NOT NULL CHECK (to_state IN ('ENABLED', 'DISABLED')),
  direction text NOT NULL CHECK (direction IN ('TO_SAFE', 'FROM_SAFE', 'EXPIRY')),
  status text NOT NULL CHECK (status IN ('APPLIED', 'PENDING_APPROVAL', 'REJECTED')),
  requested_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  approved_by_staff_id uuid NULL REFERENCES staff.staff_accounts (id),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  message_key text NULL CHECK (message_key ~ '^[a-z][a-zA-Z0-9_.-]{2,80}$'),
  expected_end timestamptz NULL,
  effective_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL,
  CHECK (from_state <> to_state),
  -- maker-checker for moving away from the safe state, enforced by the database
  CHECK (direction <> 'FROM_SAFE' OR status <> 'APPLIED' OR (approved_by_staff_id IS NOT NULL AND approved_by_staff_id <> requested_by_staff_id)),
  CHECK ((requested_by_staff_id IS NULL) = (direction = 'EXPIRY')),
  CHECK (direction = 'FROM_SAFE' OR (status = 'APPLIED' AND approved_by_staff_id IS NULL)),
  CHECK ((status = 'PENDING_APPROVAL') = (decided_at IS NULL)),
  CHECK (status <> 'REJECTED' OR approved_by_staff_id IS NULL)
);
CREATE UNIQUE INDEX runtime_switch_changes_one_pending ON platform.runtime_switch_changes (switch_key, scope, city_code) NULLS NOT DISTINCT
  WHERE status = 'PENDING_APPROVAL';
CREATE INDEX runtime_switch_changes_recent ON platform.runtime_switch_changes (created_at DESC, id DESC);

-- Append-only except the decision of a PENDING_APPROVAL row (status, approver, decided_at).
CREATE FUNCTION platform.runtime_switch_change_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'platform.runtime_switch_changes rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'PENDING_APPROVAL' OR NEW.status NOT IN ('APPLIED', 'REJECTED') THEN
    RAISE EXCEPTION 'platform.runtime_switch_changes: only a pending request can be decided' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.id, NEW.switch_key, NEW.scope, NEW.city_code, NEW.from_state, NEW.to_state, NEW.direction, NEW.requested_by_staff_id,
      NEW.reason_code, NEW.message_key, NEW.expected_end, NEW.effective_until, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.switch_key, OLD.scope, OLD.city_code, OLD.from_state, OLD.to_state, OLD.direction, OLD.requested_by_staff_id,
      OLD.reason_code, OLD.message_key, OLD.expected_end, OLD.effective_until, OLD.created_at) THEN
    RAISE EXCEPTION 'platform.runtime_switch_changes: history is append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION platform.runtime_switch_change_guard() FROM PUBLIC;
CREATE TRIGGER runtime_switch_changes_guard BEFORE UPDATE OR DELETE ON platform.runtime_switch_changes FOR EACH ROW EXECUTE FUNCTION platform.runtime_switch_change_guard();
CREATE TRIGGER runtime_switch_changes_no_truncate BEFORE TRUNCATE ON platform.runtime_switch_changes FOR EACH STATEMENT EXECUTE FUNCTION platform.append_only();

-- ── grants (least privilege; nothing granted to PUBLIC) ────────────────────────────────────────────────────────
-- API: staff release controls (draft/edit/submit/decide/activate/schedule/retire; switch changes) and the read side
-- of app config + enforcement hooks. Draft range editing = DELETE + INSERT (guard: DRAFT parents only).
GRANT SELECT, INSERT ON platform.app_version_policies, platform.app_blocked_builds, platform.runtime_switches, platform.runtime_switch_changes TO wayvro_api;
GRANT UPDATE (status, min_supported_build, recommended_build, store_url_key, soft_message_key, hard_message_key, approved_by_staff_id,
              effective_from, effective_until, scheduled, version_lock) ON platform.app_version_policies TO wayvro_api;
GRANT DELETE ON platform.app_blocked_builds TO wayvro_api;
GRANT UPDATE (state, reason_code, message_key, expected_end, effective_until, changed_by_staff_id, approved_by_staff_id, updated_at, version)
  ON platform.runtime_switches TO wayvro_api;
GRANT UPDATE (status, approved_by_staff_id, decided_at) ON platform.runtime_switch_changes TO wayvro_api;

-- Worker: scheduled activation (re-checks the guardrails, so it reads the ranges) and effective_until expiry
-- (returns the switch to its registry default and appends an EXPIRY change).
GRANT SELECT ON platform.app_version_policies, platform.app_blocked_builds TO wayvro_worker;
GRANT UPDATE (status, effective_from, effective_until, scheduled, version_lock) ON platform.app_version_policies TO wayvro_worker;
GRANT SELECT ON platform.runtime_switches TO wayvro_worker;
GRANT UPDATE (state, reason_code, message_key, expected_end, effective_until, changed_by_staff_id, approved_by_staff_id, updated_at, version)
  ON platform.runtime_switches TO wayvro_worker;
GRANT SELECT, INSERT ON platform.runtime_switch_changes TO wayvro_worker;

RESET ROLE;
