# PHASE2_DOMAIN_AND_DATA_MODEL — Identity, profiles, capabilities, compliance and vault model (PROPOSED)

**Date:** 2026-10-10 (planning closure correction applied the same day) · **Status:** Phase 2 PLAN ONLY — proposal for founder/ChatGPT review. No migration, table or code exists yet. · **Base:** `main` @ `3a1402f`. · **Authority:** `CLAUDE.md` §2–§6, `docs/28_APP_SURFACES_AND_REPO_TOPOLOGY.md`, `docs/18_IDENTITY_AUTH_AND_KYC.md`, `docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md` (canonical driver-capability machine), ADR-004 (drizzle + SQL-first migrations), ADR-010 (local S3 only).

This document defines **what** Phase 2 persists and **which state machines** govern it. Auth/session mechanics: `docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md`; evidence/file handling: `docs/phase2/PHASE2_KYC_AND_EVIDENCE_VAULT.md`; staff permissions: `docs/phase2/PHASE2_STAFF_AUTHORIZATION_MATRIX.md`; endpoints: `docs/phase2/PHASE2_API_AND_SURFACES.md`.

## 0. Repository truth this model starts from (verified 2026-10-10)

- `packages/db` has exactly one migration, `0000_postgis.sql` (PostGIS extension). `src/schema.ts` is `export {}`. **No product table exists**, so Phase 2 migrations are purely additive (expand-only); no backfill or contract step is needed for Phase 1 data.
- Migration header discipline (`-- compatibility / data-impact / rollback / verification`) is enforced by `migrationHeaderProblems()`; every Phase 2 migration follows it.
- `packages/domain/src/phone.ts` already provides `normalisePakistanMobile()` → E.164 `+923XXXXXXXXX`. Phase 2 reuses it.
- `packages/domain/src/money.ts` exists; **Phase 2 stores no money** (dues are Phase 5, G17).
- No ID helper exists. Proposal: server-generated **UUIDv7** (RFC 9562) via a small, property-tested helper in `packages/server-runtime`. Ids are generated before insert, which the field-encryption AAD needs (§8).
- Phase 0 conceptual entities (docs/18 §D, docs/07) are respected; deliberate deviations are listed in §10.

## 1. Identity uniqueness semantics (canonical — closure correction §1)

| Statement | Enforced by | Status |
|---|---|---|
| One **current verified phone** belongs to **at most one** active Wayvro account | partial unique index on the current-owner phone lookup (§2.1, `identity.phone_lookup_index`) | **database invariant** |
| One Wayvro account has **at most one** current verified phone (Phase 2 model) | partial unique index `(account_id) WHERE status='VERIFIED'` on `identity.account_phones` | **database invariant** |
| One account has at most one rider profile and at most one driver profile; at most one non-terminal driver application | unique / partial unique indexes | **database invariants** |
| Wayvro **intends** one canonical identity account per person | product policy, duplicate signals, review and recovery | **intent, not an invariant** |
| A human may temporarily hold duplicate accounts created with different phone numbers | — | **expected and tolerated** until detected |
| Human-person uniqueness | **never claimed** as a database property | signals (CNIC/document/evidence/plate hashes, released-phone history), review cases, recovery, restrictions |

Consequences: duplicate-person cases are handled through `compliance.duplicate_signals`, review/recovery cases and **safe credential movement** (phone or OIDC link moved between existing accounts only through an audited, maker-checker, cooldown-protected recovery case). **Histories are never merged**, silently or otherwise. "Unique driver identity" (D01) means: one driver profile per account plus duplicate-identity signals and human review — not a database guarantee that one person cannot apply twice.

## 2. Bounded contexts, PostgreSQL schemas and roles

One PostgreSQL database (modular monolith, ADR-035), **one schema per context**.

| Schema | Context (owner module in `apps/api`) | Holds | Raw KYC binary? |
|---|---|---|---|
| `identity` | Identity & Consent | accounts, phones and lookup index, OTP challenges, devices, sessions, refresh tokens, OIDC identities, consent records, age declarations, phone-change/recovery requests, deletion requests, account-facing security events | never |
| `legal` | Identity & Consent (policy registry) | policy document versions; age-eligibility policy versions | never |
| `profile` | Account/Profile/Capability | rider profiles, restrictions + events, appeals + appeal evidence links | never |
| `catalog` | Catalog (minimal seed now, owned by Phase 3) | cities, districts, service categories | never |
| `compliance` | Driver & Vehicle Compliance | applications (+ requested categories), driver profiles, vehicles, affiliations, document types, requirement sets, compliance documents, review cases/decisions, duplicate signals, service capabilities, capture challenges | never (metadata + vault ids) |
| `vault` | Evidence Vault | evidence object metadata, wrapped data keys, evidence access log | never — bytes only in object storage, encrypted |
| `staff` | Administration (staff realm) | staff accounts, WebAuthn credentials, staff sessions, role assignments (+ city scope), invitations, break-glass grants | never |
| `audit` | Administration & Audit | append-only audit events, seal batches | never |
| `platform` | Platform | idempotency records, background jobs, key-rotation progress | never |

**Database roles (NOLOGIN group roles created by migration; LOGIN roles provisioned per environment):** `wayvro_migrator` (owns schemas), `wayvro_api` (DML on all application schemas except `vault`; `INSERT` only on `audit.audit_events`), `wayvro_vault` (DML on `vault.*` + minimal `SELECT` on `compliance` columns needed to authorise access), `wayvro_worker` (job table + job-specific grants), `wayvro_audit_sealer` (`SELECT` audit events, `INSERT` seals). A defect in a non-vault module cannot read `vault` rows; application roles cannot update/delete audit rows (grant **and** trigger). Cross-schema foreign keys into `vault.evidence_objects` (e.g. appeal evidence) are allowed: PostgreSQL runs referential checks with the table owner's privileges, so `wayvro_api` gains no read access to vault rows. **Verify in P2.1:** role creation needs `CREATEROLE` on managed PostgreSQL (ADR-028 provider unknown) — fallback is an infra bootstrap script; integration tests run **as the restricted roles**.

## 3. Entity model

### 3.1 Identity & Consent (`identity`, `legal`)

| Table | Key columns (proposed) | Constraints / invariants |
|---|---|---|
| `identity.accounts` | `id uuid pk`, `status` (`ACTIVE`,`DELETION_PENDING`,`DELETED`), `display_name text null` (≤ 60 chars), `preferred_locale` (`en`,`ur`,`ur-Latn`), `created_at`, `last_active_at`, `deleted_at`, `version` | one row per **account** (not per human — §1); never duplicated to represent roles (V02); `DELETED` rows are pseudonymised tombstones |
| `identity.account_phones` | `id`, `account_id fk`, `phone_envelope bytea` (versioned AEAD envelope, §8), `phone_last4 char(4)`, `status` (`VERIFIED`,`RELEASED`), `verified_at`, `released_at`, `release_reason` | partial unique `(account_id) WHERE status='VERIFIED'` |
| `identity.phone_lookup_index` | `account_phone_id fk`, `lookup_key_version smallint`, `lookup_hash bytea` (HMAC-SHA-256), `is_current_owner bool` | **partial unique `(lookup_key_version, lookup_hash) WHERE is_current_owner`** → one active account per current verified phone, **per lookup-key version**; one row per live key version during rotation (§8.3); released phones keep `is_current_owner=false` rows for recycled-number checks within the retention period |
| `identity.otp_challenges` | `id`, `purpose` (`SIGN_IN`,`STEP_UP`,`PHONE_CHANGE_NEW`,`PHONE_CHANGE_CURRENT`,`ACCOUNT_RECOVERY`,`ACCOUNT_DELETION_WEB`), `phone_lookup_key_version`, `phone_lookup_hash`, `code_mac bytea` (HMAC over challenge id + code; code never stored), `mac_key_version`, `channel`, `installation_hash`, `client_ip_prefix_hash`, `status` (`ISSUED`,`DELIVERY_FAILED`,`CONSUMED`,`EXPIRED`,`LOCKED`,`SUPERSEDED`), `attempts`, `max_attempts`, `resend_count`, `next_resend_at`, `expires_at`, `consumed_at`, `provider_message_ref`, `created_at` | consumption is CAS `ISSUED → CONSUMED WHERE expires_at > now()`; short retention |
| `identity.account_devices` | `id`, `account_id fk`, `installation_hash`, `platform`, `first_verified_at`, `last_seen_at`, `trust_state` (`NEW`,`KNOWN`,`REVOKED`) | unique `(account_id, installation_hash)`; installation id is app-generated random, not a hardware identifier |
| `identity.sessions` | `id`, `account_id fk`, `device_id fk`, `status`, `assurance` (`OTP`,`OIDC`,`OTP_STEP_UP`), `step_up_at`, `access_token_hash`, `access_expires_at`, `idle_expires_at`, `absolute_expires_at`, `created_at`, `last_used_at`, `revoked_at`, `revoke_reason`, `app_version`, `version` | access token stored only as SHA-256 |
| `identity.refresh_tokens` | `id`, `session_id fk`, `token_hash`, `issued_at`, `expires_at`, `used_at`, `successor_id fk null` | partial unique `(session_id) WHERE used_at IS NULL` → one live refresh token per session (family = session) |
| `identity.oidc_identities` | `id`, `account_id fk`, `provider` (`GOOGLE`,`APPLE`), `subject text`, `email_envelope bytea null`, `email_verified_at_link bool`, `is_private_relay bool`, `status` (`LINKED`,`UNLINKED`,`REVOKED`,`CONFLICT_HOLD`), `linked_at`, `unlinked_at` | partial unique `(provider, subject) WHERE status IN ('LINKED','CONFLICT_HOLD')`; partial unique `(account_id, provider) WHERE status='LINKED'`; email never a lookup key |
| **as built (P2.10, migration 0008)** | `identity.oidc_identities` stores only `provider`, `subject` (erased once UNLINKED for a deleted account), `status` (`LINKED`,`UNLINKED`), timestamps — no e-mail/relay/name (no approved purpose, Q-03); `identity.oidc_nonces` holds SHA-256 single-use nonces bound to an installation (sign-in) or a session (link/recovery) | same uniqueness rules |
| `identity.phone_change_requests` | `id`, `account_id fk`, `kind` (`SELF_SERVICE`,`RECOVERY_OIDC_PROOF`,`RECOVERY_DRIVER_KYC`), `new_phone_envelope`, `new_phone_lookup_version`, `new_phone_lookup_hash`, `status` (§4.2), `step_up_session_id fk null`, `cooldown_until`, `review_case_id fk null`, timestamps | at most one open request per account; recovery kinds name the **strong proof** used (§4.2) |
| `identity.dormant_number_reviews` (added in P2.9, migration 0007) | `id`, `account_id fk`, `session_id fk`, `status` (`PENDING`,`IN_REVIEW`,`RESOLVED_OWNER`,`RESOLVED_NEW_ACCOUNT`,`DENIED`), `new_account_id fk null`, timestamps | one open review per session; subject of an `ACCOUNT_RECOVERY` case for a dormant-number claim (§4.2, auth design §6.1) |
| `identity.age_declarations` | `id`, `account_id fk`, `policy_version fk → legal.age_eligibility_policies`, `declaration_mode`, `affirmed bool null`, `dob_envelope bytea null` (only when the approved policy's mode requires DOB), `recorded_at` | append-only; **no rider DOB unless the policy requires it** (A15) |
| `identity.consent_records` | `id`, `account_id fk`, `policy_key`, `policy_version`, `content_sha256`, `locale`, `action` (`ACCEPTED`,`WITHDRAWN`,`DECLINED`), `surface`, `app_version`, `recorded_at`, `request_id`; FK `(policy_key, policy_version, locale)` → `legal.policy_documents` | append-only |
| `identity.security_events` | `id`, `account_id fk`, `type`, `device_id fk null`, `coarse_context`, `created_at`, `notified_via` | account-facing activity list (A11/K17) |
| `identity.account_deletion_requests` | `id`, `account_id fk`, `channel` (`APP`,`WEB`), `status` (§4.9), `grace_until`, `completed_at` | at most one open request per account |
| `identity.deletion_request_blockers` | `deletion_request_id fk`, `blocker_code`, `detected_at`, `cleared_at` | one row per blocker (no JSON list) |
| `identity.deletion_retention_exceptions` | `deletion_request_id fk`, `data_category`, `basis_ref` | lawful-basis references per retained category |
| `legal.policy_documents` | pk `(policy_key, version, locale)`, `content_sha256`, `status` (`PLACEHOLDER_NOT_FOR_PRODUCTION`,`APPROVED`,`RETIRED`), `material_change`, `effective_at`, `canonical_url`, `approval_ref` | seeded from the policy-content manifest; production refuses required placeholders |
| `legal.age_eligibility_policies` | `version pk`, `status` (`PLACEHOLDER_NOT_FOR_PRODUCTION`,`APPROVED`,`RETIRED`), `rider_declaration_mode` (`NONE`,`AFFIRM_MINIMUM_AGE`,`DATE_OF_BIRTH_REQUIRED`), `rider_minimum_age null`, `driver_minimum_age null`, `guardian_rules_ref null`, `teen_programme_enabled bool default false` (L21 stays disabled), `approval_ref null`, `effective_at` | **no threshold hard-coded in code**; values are policy data; production refuses a placeholder policy (A15, EG-23) |

### 3.2 Account/Profile/Capability (`profile`, `catalog`)

| Table | Key columns | Constraints / invariants |
|---|---|---|
| `profile.rider_profiles` | `id`, `account_id unique fk`, `status`, `created_at` | profile id ≠ account id (queries scoped by profile) |
| `profile.restrictions` | `id`, `scope` (`ACCOUNT`,`DRIVER_ROLE`,`VEHICLE`,`SERVICE_CAPABILITY`,`CITY_CATEGORY`), `account_id fk null`, `driver_profile_id fk null`, `vehicle_id fk null`, `service_capability_id fk null`, `city_code fk null`, `service_category fk null`, `reason_code`, `reason_class` (`SAFETY`,`FRAUD`,`LEGAL`,`COMPLIANCE`,`QUALITY`,`SECURITY_HOLD`,`RISK_HOLD`,`AGE_POLICY`), `status`, `effective_from`, `effective_until null`, `appealable`, `evidence_ref null`, `created_by_staff_id fk null`, `created_by_system text null`, `lifted_by_staff_id fk null`, `lift_reason_code null`, `version` | **FK per subject column + CHECK per scope** (exactly the scope's subject columns non-null); exactly one creator (staff xor system); effects derived in code from `(scope, reason_class)` |
| `profile.restriction_events` | `id`, `restriction_id fk`, `event`, `actor_staff_id fk null`, `actor_system null`, `reason_code`, `at` | append-only |
| `profile.appeals` | `id`, `account_id fk`, `review_decision_id fk null`, `restriction_id fk null`, `status` (§4.8), `statement text` (≤ 2,000 chars, PII-classified), `assigned_staff_id fk null`, `decided_by_staff_id fk null`, `outcome_reason_code`, timestamps | CHECK exactly one subject; decider ≠ original decider (service + trigger) |
| `profile.appeal_evidence` | `appeal_id fk`, `evidence_object_id fk → vault.evidence_objects`, pk `(appeal_id, evidence_object_id)` | **junction replaces the earlier `uuid[]` proposal** |
| `catalog.cities` | `code pk` (`LHR`), `name_en`, `name_ur`, `status` | minimal seed, Phase 3 extends additively |
| `catalog.districts` | `code pk`, `city_code fk`, `name_en`, `name_ur`, `status` | minimal seed (Lahore district) so per-district permits (R46/44B) have a real FK; Phase 3 adds geometry (E08/CL-18) |
| `catalog.service_categories` | `code pk` (`CAR`,`BIKE`,`RICKSHAW`), `status` (`ENABLED`,`DISABLED_LEGAL_GATE`) | bike/rickshaw `DISABLED_LEGAL_GATE` (FD-02/B15) |

### 3.3 Driver & Vehicle Compliance (`compliance`)

| Table | Key columns | Constraints / invariants |
|---|---|---|
| `compliance.driver_applications` | `id`, `account_id fk`, `state` (§4.5), `city_code fk`, `legal_name_envelope`, `cnic_envelope`, `cnic_last4`, `date_of_birth_envelope`, `requirement_set_id fk` (pinned at submission), `submitted_at`, `decided_at`, `version` | partial unique `(account_id) WHERE state` non-terminal; applicant fields are **claims** until a reviewer confirms them (no OCR) |
| `compliance.application_service_categories` | `application_id fk`, `service_category fk`, pk `(application_id, service_category)` | **junction replaces `text[]`**; DB rejects unknown categories |
| `compliance.cnic_lookup_index` | `subject_application_id fk null`, `subject_profile_id fk null`, `lookup_key_version`, `lookup_hash` | CHECK exactly one subject; **non-unique** index — matches create duplicate signals, never rejections (§1) |
| `compliance.driver_profiles` | `id`, `account_id unique fk`, `application_id fk`, `state` (§4.6), `verified_legal_name_envelope`, `verified_date_of_birth_envelope`, `activated_at`, `version` | at most one per account; **no gender column** (CL-17) |
| `compliance.vehicles` | `id`, `plate_normalised`, `plate_display`, `registration_no_envelope`, `make`, `model`, `model_year`, `colour`, `category fk`, `ownership_type` (`REGISTERED_OWNER`,`OPEN_LETTER_UNTRANSFERRED`,`BANK_HYPOTHECATED`,`COMPANY_OWNED`,`FAMILY_OWNED`,`OTHER_AUTHORISED_USE` — CL-10), `status`, `version` | partial unique `(plate_normalised) WHERE status <> 'RETIRED'` → one vehicle record per plate; second applicant ⇒ affiliation + signal |
| `compliance.vehicle_affiliations` | `id`, `vehicle_id fk`, `driver_application_id fk null`, `driver_profile_id fk null`, `relation` (`OWNER`,`AUTHORISED_USER`; `FLEET_DRIVER` reserved for Phase 12), `status`, `authorisation_document_id fk null` | CHECK exactly one of application/profile |
| `compliance.document_types` | `code pk`, `subject` (`DRIVER`,`VEHICLE`,`DRIVER_VEHICLE`), `has_expiry`, `has_number`, `number_format`, `evidence_kinds text[]` (scalar enum list — arrays kept only for scalar configuration), `retention_class` | catalogue changed only via requirement-set governance |
| `compliance.requirement_sets` | `id`, `city_code fk`, `service_category fk`, `version`, `status` (§4.11), `effective_from`, `effective_until`, `source_reference`, `drafted_by fk`, `approved_by fk` (≠ drafter), `is_placeholder` | partial unique `(city_code, service_category) WHERE status='ACTIVE'`; placeholder `LHR/CAR v0` refused in production |
| `compliance.requirement_set_items` | `requirement_set_id fk`, `document_type_code fk`, `mandatory`, `min_validity_days_at_submission`, `renewal_lead_days`, `per_district`, `applies_to_ownership_types text[]`, `licence_classes_allowed text[]` | scalar configuration arrays only; no per-driver override table exists (R06) |
| `compliance.compliance_documents` | `id`, `document_type_code fk`, `driver_profile_id fk null`, `driver_application_id fk null`, `vehicle_id fk null`, `district_code fk null`, `number_envelope null`, `number_last4 null`, `licence_class null`, claimed `claimed_issued_on/claimed_expires_on`, reviewer-confirmed `issued_on/expires_on`, `issuing_authority`, `status` (§4.7), `supersedes_id fk null`, `version` | CHECK subject columns match the type's subject; validity on **server time** |
| `compliance.document_number_lookup_index` | `compliance_document_id fk`, `lookup_key_version`, `lookup_hash` | non-unique; feeds duplicate signals |
| `compliance.document_evidence` | `compliance_document_id fk`, `evidence_object_id fk`, `evidence_kind`, pk `(compliance_document_id, evidence_object_id)` | junction |
| `compliance.capture_challenges` | `id`, `application_id fk`, `challenge_code` (from an accessible set, §KYC doc 2.2), `issued_at`, `expires_at`, `status` (`ISSUED`,`USED`,`DECLINED_ACCESSIBILITY`,`EXPIRED`), `used_by_evidence_id fk null` | **optional** anti-replay aid for manual review only |
| `compliance.review_cases` | `id`, `kind` (`INITIAL_APPLICATION`,`RESUBMISSION`,`DOCUMENT_RENEWAL`,`VEHICLE_ADDITION`,`REVERIFICATION`,`DUPLICATE_SIGNAL`,`APPEAL`,`ACCOUNT_RECOVERY`), **explicit subject FKs** `driver_application_id`, `driver_profile_id`, `compliance_document_id`, `vehicle_id`, `appeal_id`, `duplicate_signal_id`, `phone_change_request_id` (all nullable), `city_code fk`, `priority`, `status`, `assigned_staff_id fk`, `lease_expires_at`, `escalated`, `version` | **CHECK per `kind`** requires exactly the subject columns that kind uses (e.g. `DOCUMENT_RENEWAL` ⇒ `compliance_document_id` and `driver_profile_id` non-null, others null) |
| `compliance.review_decisions` | `id`, `review_case_id fk`, `decision`, `reason_codes text[]` (scalar codes from the code-defined catalogue; CHECK non-empty), `checklist jsonb` (schema-versioned assessment values, not relationships) + `checklist_schema_version`, `identity_match_assessment`, `decided_by_staff_id fk`, `second_reviewer_staff_id fk null`, `decided_at`, `staff_session_id fk` | append-only |
| `compliance.review_decision_evidence` | `review_decision_id fk`, `evidence_object_id fk`, pk | junction for "evidence relied on" (replaces `uuid[]`) |
| `compliance.duplicate_signals` | `id`, `signal` (`CNIC_HASH_MATCH`,`DOCUMENT_NUMBER_MATCH`,`EVIDENCE_HASH_MATCH`,`PLATE_ALREADY_AFFILIATED`,`PHONE_RECENTLY_RELEASED`), explicit `subject_application_id/subject_profile_id/subject_document_id/subject_evidence_id/subject_vehicle_id` and `matched_application_id/matched_profile_id/matched_document_id/matched_evidence_id/matched_account_id` (nullable FKs), `status` (`OPEN`,`CLEARED`,`CONFIRMED_FRAUD`) | **CHECK per `signal`** on which subject/matched columns are set; never auto-merge or auto-reject |
| `compliance.service_capabilities` | `id`, `driver_profile_id fk`, `vehicle_id fk`, `city_code fk`, `service_category fk`, `status`, `granted_by_decision_id fk`, `granted_at`, `revoked_at` | partial unique on the grant tuple `WHERE status='GRANTED'`; necessary, never sufficient |

### 3.4 Evidence vault (`vault`) — summary (detail: vault doc)
`vault.evidence_objects` (opaque id, owner account fk, `kind`, `capture_source` (`IN_APP_CAMERA`,`GALLERY_IMPORT`,`FILE_IMPORT` — client-declared metadata, **never proof of authenticity**), storage bucket class, opaque `storage_key`, `status`, `source_byte_size`, `source_sha256`, `canonical_sha256`, `canonical_format`, `pixel_width/height`, wrapped data key + `kek_id`, `retention_until`, `legal_hold`, timestamps) and `vault.evidence_access_log` (append-only). No table outside `vault` stores a storage key, URL or bytes.

### 3.5 Staff realm (`staff`)
`staff.staff_accounts` (separate id space; work email contact; status; `conflict_phone_lookup_version/hash` — the staff member's own consumer phone, to block self-review), `staff.webauthn_credentials`, `staff.invitations`, `staff.sessions`, `staff.role_assignments` (role, validity, granter, approver), **`staff.role_assignment_cities`** (`assignment_id fk`, `city_code fk` — junction replacing a `text[]` scope), `staff.break_glass_grants`. **No export-request table in Phase 2** (closure correction §10).

### 3.6 Audit and platform
- `audit.audit_events` — append-only; `object_type/object_id` are **intentionally polymorphic** because the log must outlive and span every subject type and must never block a delete via FK; it carries ids and reason codes only, no PII values. Trigger rejects `UPDATE`/`DELETE`/`TRUNCATE`.
- `audit.audit_seals` — Merkle root + hash chain per sealed batch (worker job).
- `platform.idempotency_records` — `(actor_scope, idempotency_key)` pk, route, request hash, status, response status, `response_envelope` (encrypted for sensitive responses), expiry.
- `platform.jobs` — `FOR UPDATE SKIP LOCKED` job table (ADR-042); payload jsonb carries ids only (transient, not a relationship store).
- `platform.key_rotations` — per key class: `from_version`, `to_version`, phase (`DUAL_WRITE`,`BACKFILL`,`READ_SWITCHED`,`RETIRE_PENDING`,`DONE`), cursor, counts (§8.3).

## 4. State machines

All transitions are server-side, reason-coded where human-initiated, audited (Q39) and applied with optimistic concurrency (`version` CAS) so races resolve to exactly one winner; a loser gets `409 WAYVRO_E_CONFLICT` or the idempotent replay of the winning response.

### 4.1 Account
```
(none) ──OTP verified for a phone with no current owner──▶ ACTIVE  [+ requiredActions per policy: ACCEPT_POLICIES, AGE_DECLARATION]
ACTIVE ──deletion requested & verified──▶ DELETION_PENDING ──grace elapsed, no blockers──▶ DELETED (pseudonymised tombstone)
DELETION_PENDING ──user cancels within grace──▶ ACTIVE
```
Overlays: restrictions (§5) and required actions (`ACCEPT_POLICIES`, `AGE_DECLARATION`, `PHONE_STEP_UP`, `RECOVERY_REVIEW`). A security lock is an `ACCOUNT` restriction with `reason_class=SECURITY_HOLD`.

### 4.2 Phone ownership, change and recovery
`account_phones`: `VERIFIED → RELEASED` (`PHONE_CHANGED`, `RECYCLED_NUMBER_NEW_OWNER`, `ACCOUNT_DELETED`, `RECOVERY_MOVED`).
`phone_change_requests`:
- `SELF_SERVICE`: `REQUESTED → CURRENT_PHONE_VERIFIED → NEW_PHONE_VERIFIED → COMPLETED`.
- `RECOVERY_OIDC_PROOF` (lost phone; account has a previously linked OIDC identity): `REQUESTED → STRONG_PROOF_VERIFIED → NEW_PHONE_VERIFIED → COOLDOWN (72 h, notices to every old session) → COMPLETED`.
- `RECOVERY_DRIVER_KYC` (lost phone; account has a driver profile with vault evidence): `REQUESTED → NEW_PHONE_VERIFIED → MANUAL_REVIEW (ACCOUNT_RECOVERY case, maker-checker) → COOLDOWN → COMPLETED | DENIED`.
- Exits: `CANCELLED` (user, or "this wasn't me" from any existing session), `EXPIRED`, `DENIED`.
**No recovery kind exists for a rider-only account without a pre-existing strong factor** — that person starts a new clean account; the old account is placed on `SECURITY_HOLD` and retained under policy (closure correction §4). A new phone already current on another account ⇒ generic refusal; no merge.

### 4.3 OTP challenge
`ISSUED → CONSUMED | EXPIRED | LOCKED | SUPERSEDED`; `ISSUED → DELIVERY_FAILED` when every channel fails (honest error, never verified).

### 4.4 Session and refresh family
`ACTIVE → REVOKED (USER_LOGOUT, USER_LOGOUT_ALL, REFRESH_REUSE, PHONE_CHANGED, RECOVERY, RESTRICTION_SECURITY_HOLD, STAFF_LOST_DEVICE, ACCOUNT_DELETED) | EXPIRED`. Refresh token `LIVE → USED`; reuse outside the leeway revokes the session.

### 4.5 Driver application (role model §3, application part)
```
DRAFT ──required policies accepted (DRIVER_PARTNER_AGREEMENT, BIOMETRIC_KYC_NOTICE)──▶ CONSENTED
CONSENTED ──first evidence upload slot issued──▶ DOCUMENTS_PENDING
DOCUMENTS_PENDING ──all mandatory items of the pinned requirement set AVAILABLE──▶ SUBMITTED
SUBMITTED ──automatic quality/duplicate checks job──▶ AUTO_CHECK_PENDING ──always──▶ MANUAL_REVIEW
MANUAL_REVIEW ──NEEDS_INFO──▶ NEEDS_INFO ──applicant resubmits──▶ SUBMITTED
MANUAL_REVIEW ──REJECT──▶ REJECTED ──appeal opened──▶ APPEALED ──appeal decided──▶ MANUAL_REVIEW | REJECTED_FINAL
MANUAL_REVIEW ──APPROVE (identity, documents, licence class, vehicle, Punjab artefacts, age policy confirmed)──▶ VERIFIED ⇒ driver_profile created
DRAFT|CONSENTED|DOCUMENTS_PENDING|NEEDS_INFO ──applicant withdraws──▶ WITHDRAWN
DRAFT|CONSENTED|DOCUMENTS_PENDING ──inactive > N days (config, proposal 30)──▶ EXPIRED_DRAFT
```
No automated edge into `VERIFIED` (K04/K05; docs/12 gate). `WITHDRAWN`/`EXPIRED_DRAFT` are housekeeping terminals (CL-P2-04).

### 4.6 Driver profile (role model §3, post-verification part)
```
VERIFIED ──requirement-set prerequisites met + ≥1 GRANTED service capability──▶ ACTIVE_ELIGIBLE
ACTIVE_ELIGIBLE ──mandatory document expires──▶ EXPIRED ──renewal approved──▶ ACTIVE_ELIGIBLE
ACTIVE_ELIGIBLE ──risk-triggered or policy re-verification──▶ REVERIFY_DUE ──pass──▶ ACTIVE_ELIGIBLE | ──fail──▶ DRIVER_ROLE restriction
```
**SUSPENDED is derived** from an active `DRIVER_ROLE` restriction (D-03). Re-verification is **risk-triggered or policy-scheduled, never a universal device-change rule** (closure correction §11); a temporary earning hold while risk is assessed is a `DRIVER_ROLE` restriction with `reason_class=RISK_HOLD` (system-created, reason-coded, appealable, auto-expiring). Real selfie re-checks remain subject to the DPIA gate (EG-10).

### 4.7 Compliance document
`SUBMITTED → UNDER_REVIEW → VALID | REJECTED`; `VALID → EXPIRED` (server time); `VALID → SUPERSEDED`. "EXPIRING" is computed for display only.

### 4.8 Appeal
`SUBMITTED → UNDER_REVIEW → UPHELD | OVERTURNED`; `SUBMITTED|UNDER_REVIEW → WITHDRAWN`. Decider ≠ original decider.

### 4.9 Account deletion
`REQUESTED → GRACE (14 days, configurable, pending counsel) → PROCESSING → COMPLETED`; `REQUESTED|GRACE → BLOCKED` (blocker rows) `→ GRACE` when cleared; `CANCELLED`.

### 4.10 Review case
`OPEN → CLAIMED (lease 30 min, renewable) → DECIDED | ESCALATED → CLAIMED (senior)`; lease expiry → `OPEN`; `CANCELLED` when the subject is withdrawn/deleted.

### 4.11 Requirement set
`DRAFT → PENDING_APPROVAL → APPROVED → ACTIVE → RETIRED`; approval by a different `COMPLIANCE_ADMIN`; production requires `is_placeholder=false` and a `source_reference`.

### 4.12 Staff account / session / break-glass
`INVITED → ACTIVE ↔ SUSPENDED → OFFBOARDED`; staff session `ACTIVE ↔ LOCKED → REVOKED | EXPIRED`; break-glass `ACTIVE (≤ 60 min) → ENDED | EXPIRED → REVIEWED`.

### 4.13 Age eligibility (A15)
Policy version `PLACEHOLDER_NOT_FOR_PRODUCTION → APPROVED → RETIRED`. Account: `requiredActions: AGE_DECLARATION` when the active policy's rider mode is not `NONE` and no declaration exists for the current policy version. Driver: the reviewer confirms DOB from the CNIC and the licence; the evaluator compares against the policy's `driver_minimum_age` and regulatory requirements. Under-age reports or evidence ⇒ reason-coded `ACCOUNT` restriction `reason_class=AGE_POLICY`, appealable, privacy-minimised (no inference from images). Guardian/teen programmes (L21) remain disabled; they would add new relationship tables (e.g. guardian links) **without changing `identity.accounts`**.

## 5. Capability derivation (server-side, pure, per request)

```
driverEarningEligibility(now, account, driverProfile, vehicle, city, category, documents, restrictions, capabilityGrant, agePolicy) →
  { eligible: boolean, blockers: ReasonCode[] }   -- exhaustive and ordered
  blockers: ACCOUNT_RESTRICTED, NO_DRIVER_PROFILE, PROFILE_NOT_ACTIVE_ELIGIBLE, DRIVER_ROLE_RESTRICTED (incl. RISK_HOLD),
  VEHICLE_RESTRICTED, CAPABILITY_NOT_GRANTED, CAPABILITY_RESTRICTED, CITY_CATEGORY_RESTRICTED,
  DOCUMENT_MISSING(type), DOCUMENT_EXPIRED(type), DOCUMENT_NOT_VALID(type), REQUIREMENT_SET_PLACEHOLDER (production),
  AGE_POLICY_PLACEHOLDER (production), SERVICE_CATEGORY_DISABLED_LEGAL_GATE
```
Implemented in `apps/api` (not `packages/domain`, so clients cannot import an "authoritative" evaluator). Phase 4 adds `RIDER_TRIP_ACTIVE`, `VEHICLE_ONLINE_UNDER_OTHER_DRIVER` (D26), `OTHER_DRIVER_SESSION` (D27) and calls it at go-online/accept/start (K12). Document validity is evaluated **live** at every call. Property tests: any blocker ⇒ not eligible; any `ACCOUNT` restriction blocks; a `DRIVER_ROLE` restriction never blocks rider capabilities (INV-05 Phase-2 subset, INV-09).

## 6. Restriction semantics (V13)

| Scope | Target | Earning | Rider | Sign-in | Typical reasons | Lifted by |
|---|---|---|---|---|---|---|
| `ACCOUNT` | account | blocked | blocked | restricted session (reason, appeal, support/safety, data/deletion) — except `SECURITY_HOLD`, which revokes sessions and requires recovery | fraud, safety ban, legal hold, suspected takeover, age policy | T&S decision (maker-checker for `SAFETY`/`FRAUD` lifts), appeal, expiry |
| `DRIVER_ROLE` | driver profile | blocked for every vehicle/category | **unaffected** | normal | suspension, failed re-verification, document fraud, `RISK_HOLD` | reviewer/T&S, appeal, expiry |
| `VEHICLE` | vehicle | blocked for that vehicle for every affiliated driver | unaffected | normal | fake/expired plate docs, vehicle ban | compliance decision |
| `SERVICE_CAPABILITY` | grant | blocked for that grant | unaffected | normal | category-specific issue | compliance decision |
| `CITY_CATEGORY` | profile + city + category | blocked there | unaffected | normal | district/permit coverage gap (R46) | compliance decision |

Expired documents block through live evaluation, not restriction rows (CL-P2-12). Restrictions attach to server ids; mode switch, logout/login, reinstall and new devices read the same rows. Every create/lift is idempotent, reason-coded from a closed catalogue, audited, explicit about appealability, and shown to the user via localisation keys only.

## 7. Consent, policy acceptance and age declaration

- Policy keys/versions come from the policy-content manifest; acceptance stores the exact `content_sha256`, locale, surface and app version (A04/R09).
- Required for account use: `TERMS`, `PRIVACY`; before `CONSENTED`: `DRIVER_PARTNER_AGREEMENT`, `BIOMETRIC_KYC_NOTICE` (K14). `COMMUNITY_GUIDELINES` becomes required when its text exists (N02).
- Material change ⇒ re-acceptance required action; policies, support/safety, data requests and deletion stay reachable meanwhile.
- Age declaration (A15): collected only in the form the approved policy requires (`NONE`, a minimum-age affirmation, or DOB if and only if required); stored append-only against the policy version; placeholder policy used only in local/test/staging.
- Withdrawal and correction: as in §4/§KYC doc; reviewer-confirmed fields change only through new review decisions.

## 8. Field encryption and lookup cryptography (closure correction §3; founder Q-05 approved)

Only standard primitives from `node:crypto` are used: AES-256-GCM (AEAD), HMAC-SHA-256, SHA-256, `randomBytes`, `timingSafeEqual`. No custom primitive, mode or KDF is invented.

### 8.1 Envelope format v1 (stored as `bytea`)

| Offset | Field | Size | Notes |
|---|---|---|---|
| 0 | `format_version` | 1 byte | `0x01` |
| 1 | `algorithm_id` | 1 byte | `0x01` = AES-256-GCM, 96-bit nonce, 128-bit tag |
| 2 | `key_id_length` | 1 byte | 1–64 |
| 3 | `key_id` | n bytes | ASCII, e.g. `contact.v3` (key class + version) |
| 3+n | `nonce` | 12 bytes | **fresh from `crypto.randomBytes(12)` for every encryption**; never derived, counted or reused |
| 15+n | `tag` | 16 bytes | GCM authentication tag |
| 31+n | `ciphertext` | rest | |

**AAD (authenticated, not stored):** UTF-8 of `wayvro|env=v1|field=<schema>.<table>.<column>|row=<row uuid>|fschema=<field schema version>|key=<key_id>` — binds the ciphertext to its field, row and schema version; copying an envelope to another row or column fails authentication. Plaintext is canonicalised before encryption (E.164 for phones, `#####-#######-#` for CNIC, ISO-8601 for dates).

**Nonce safety:** random 96-bit nonces are safe far below 2³² encryptions per key; each key id has an encryption counter metric and a rotation trigger at 2³⁰ encryptions or the scheduled interval (proposal 12 months), whichever comes first — pilot volume is orders of magnitude lower.

### 8.2 Key hierarchy and rotation
- **Field data keys** (one per key class: `contact`, `identity_numbers`, `identity_dates`, `oidc_contact`, `idempotency_responses`) are 256-bit keys wrapped by a **KEK** held in KMS (EG-05). Local/test: keys from env, refused in staging/production.
- Key states per key id: `ACTIVE` (encrypt + decrypt; exactly one per class), `DECRYPT_ONLY`, `RETIRED` (no use; kept archived only while backups that contain it are within retention).
- **Field-key rotation** (expand → migrate → switch → contract): (1) add new key as `ACTIVE`, old → `DECRYPT_ONLY` — new writes use the new key, reads decrypt with the key named in the envelope; (2) resumable, idempotent, rate-limited re-encryption job walks rows whose envelope `key_id ≠` active, decrypts and re-encrypts with a CAS on the old envelope bytes (a concurrent user update wins and is simply skipped), progress in `platform.key_rotations`; (3) verification pass counts zero remaining old-key envelopes; (4) old key → `RETIRED`. No all-at-once rewrite, no downtime.
- **KEK rotation** re-wraps field data keys and per-object evidence DEKs only (no data rewrite).
- **Failure behaviour:** unknown `format_version`/`algorithm_id`, malformed length, unknown or `RETIRED` key id, or tag failure ⇒ typed `FieldDecryptionError` ⇒ the request fails with `500 WAYVRO_E_INTERNAL` (no partial record, never a fallback to ciphertext/plaintext, never "try every key"), a security event and alert; encryption failure aborts the transaction.

### 8.3 Deterministic lookups (HMAC-SHA-256)
- Lookup values (`phone`, `cnic`, document numbers, released phones, staff conflict phone) are `HMAC-SHA-256(lookup_key[v], canonical value)`, stored with `lookup_key_version`. Lookup keys are independent 256-bit keys (never derived from encryption keys), held like field keys.
- Lookups live in **side index tables** (`identity.phone_lookup_index`, `compliance.cnic_lookup_index`, `compliance.document_number_lookup_index`) with one row **per live key version**, so uniqueness (phone current-owner) is enforced by the database within every version.
- **Rotation without a destructive cut-over:** (1) **dual-write** — every new/changed value writes rows for all live versions; (2) **backfill** — a resumable job decrypts the stored envelope and inserts the new-version row for existing records (unique-violation ⇒ data conflict surfaced to ops, never silently skipped); (3) **dual-read** — lookups query `(version, hash) IN ((v_old, h_old), (v_new, h_new))` until the backfill completes; (4) **switch** — reads use the new version only; (5) **contract** — delete old-version rows, retire the old lookup key. At every step the old version still answers lookups, so a failed rotation is abandoned by stopping the job.

### 8.4 Tests (UNIT-CRYPTO / PROP-CRYPTO)
Round-trip; flip any bit of version/alg/key-id/nonce/tag/ciphertext ⇒ failure; move an envelope to another row/column/field-schema version ⇒ failure (AAD); 10⁵ encryptions under one key ⇒ no repeated nonce (property sanity check, not a proof); decrypt with `DECRYPT_ONLY` succeeds, with `RETIRED` fails; rotation job crash at any batch ⇒ restart converges; concurrent update during re-encryption ⇒ user write preserved; lookup dual-read finds records under either version; uniqueness holds within each version during backfill; envelope parser fuzz ⇒ only typed errors; local keys refused outside local/test.

## 9. PII classification

| Class | Examples | Storage | Logs/telemetry | API responses |
|---|---|---|---|---|
| P-SECRET | OTP codes, tokens, keys, peppers | never in clear (MAC/hash) | never | tokens only to their owner at issuance |
| P-IDENTITY-EVIDENCE | CNIC/licence images, selfies | object storage, encrypted (vault) | never | staff view stream only |
| P-IDENTITY-NUMBERS | CNIC, licence, registration numbers, DOB, legal name | envelope + lookup index + last4 | never | masked to owner; full only in staff case view with reason |
| P-CONTACT | phone, OIDC email | envelope + lookup index + last4 | never | masked |
| P-ACCOUNT | display name, locale, platform | plain | ids only | owner |
| P-OPERATIONAL | states, reason codes, timestamps | plain | yes | per policy |

## 10. Deliberate deviations from Phase 0 conceptual entities

| # | Phase 0 concept | Proposal | Why |
|---|---|---|---|
| D-01 | separate `role_restrictions` / `account_restrictions` | one `profile.restrictions` with `scope`, FK per subject + CHECK | one evaluation path and audit trail |
| D-02 | `driver_documents`, `vehicle_documents`, `compliance_artefacts`, `permits`, `vehicle_insurance` | one `compliance_documents` + `document_types` + `requirement_sets` | Punjab artefacts must be configurable (R06/R46) |
| D-03 | stored `SUSPENDED` state | derived from an active `DRIVER_ROLE` restriction | single source of suspension truth (V13) |
| D-04 | consumer `Credential` entity | none for consumers | phone OTP is the only consumer credential (CL-01) |
| D-05 | `mode_preferences` table | client-only | never authorisation |
| D-06 | `verification_cases`, `identity_access_audit` | `review_cases` (explicit subject FKs), `vault.evidence_access_log` | scoped to owning contexts |
| D-07 | BullMQ worker | PostgreSQL job table (ADR-042) | transactional enqueue, no new dependency |

Relational-integrity rule (closure correction §9): relationships between entities are foreign keys or junction tables; arrays/JSON hold only scalar configuration or assessment values (document evidence kinds, ownership-type lists, licence classes, reason codes from the code catalogue, checklist answers, transient job payloads). The audit log's polymorphic object reference is the one intentional exception (§3.6).

## 11. Migration sequence (planned — NOT created)

All migrations are reviewed SQL (ADR-004), additive, with the five header fields, applied clean→latest, previous→latest and re-run=0 in CI, and verified by real-type, constraint and **grant checks executed as each restricted role**. No PostGIS column is introduced in Phase 2.

| # (proposed) | Micro-phase | Content | Rollback / forward-fix |
|---|---|---|---|
| 0001_identity_core | P2.1 | schemas `identity, profile, platform, audit`; roles/grants; accounts, account_phones, phone_lookup_index, otp_challenges, account_devices, sessions, refresh_tokens, security_events, rider_profiles, idempotency_records, jobs, key_rotations, audit_events (+ trigger), audit_seals | before Phase 7 no real data exists: drop in reverse; afterwards forward-fix only |
| 0002_policy_consent_age | P2.2 | schema `legal`; policy_documents, age_eligibility_policies (placeholder row); consent_records, age_declarations | as above |
| 0003_staff_realm | P2.4 | schema `staff`; staff tables incl. role_assignment_cities; sealer grants | as above |
| 0004_compliance_core | P2.5 | schemas `catalog, compliance`; cities, districts, categories seeds; document types; placeholder requirement set; applications + application_service_categories; cnic_lookup_index; profiles; vehicles; affiliations; compliance documents + document_number_lookup_index; duplicate_signals; service capabilities; restrictions + events | as above |
| 0005_vault | P2.6 | schema `vault` + role; evidence_objects, evidence_access_log; document_evidence; capture_challenges | as above |
| 0006_review_appeals | P2.7 | review_cases, review_decisions, review_decision_evidence, appeals, appeal_evidence | as above |
| 0007_recovery_deletion | P2.9 | phone_change_requests, account_deletion_requests, deletion_request_blockers, deletion_retention_exceptions | as above |
| 0008_oidc | P2.10 | oidc_identities | as above |

Each table lands in the micro-phase that first uses it (no unused schema). Seeds are reference data only; synthetic accounts/drivers come from a local-only CLI that refuses any `WAYVRO_ENV` other than `local`/`test` and exists only in the non-deployable development tooling (§auth design 8).

**Transaction boundaries:** OTP verify (challenge CAS + account/phone/lookup/profile + session + refresh + audit + security event); application submission (state CAS + review case + job + audit); review decision (decision + evidence links + state changes + grants + audit + jobs); vault finalisation (object state + wrapped key + access log after the storage write, with orphan cleanup for the reverse failure); key-rotation batches (per-row CAS).
