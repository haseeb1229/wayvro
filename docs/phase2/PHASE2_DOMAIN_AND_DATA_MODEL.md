# PHASE2_DOMAIN_AND_DATA_MODEL — Identity, profiles, capabilities, compliance and vault model (PROPOSED)

**Date:** 2026-10-10 · **Status:** Phase 2 PLAN ONLY — proposal for founder/ChatGPT review. No migration, table or code exists yet. · **Base:** `main` @ `3a1402f`. · **Authority:** `CLAUDE.md` §2–§6, `docs/28_APP_SURFACES_AND_REPO_TOPOLOGY.md`, `docs/18_IDENTITY_AUTH_AND_KYC.md`, `docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md` (canonical driver-capability machine), ADR-004 (drizzle + SQL-first migrations), ADR-010 (local S3 only).

This document defines **what** Phase 2 persists and **which state machines** govern it. Auth/session mechanics are in `docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md`; evidence/file handling in `docs/phase2/PHASE2_KYC_AND_EVIDENCE_VAULT.md`; staff permissions in `docs/phase2/PHASE2_STAFF_AUTHORIZATION_MATRIX.md`; endpoints in `docs/phase2/PHASE2_API_AND_SURFACES.md`.

## 0. Repository truth this model starts from (verified 2026-10-10)

- `packages/db` has exactly one migration, `0000_postgis.sql` (PostGIS extension). `src/schema.ts` is `export {}`. **No product table exists.** Every Phase 2 table is new, so Phase 2 migrations are purely additive (expand-only); no backfill or contract step is needed for Phase 1 data.
- Migration header discipline (`-- compatibility / data-impact / rollback / verification`) is enforced by `migrationHeaderProblems()`; every Phase 2 migration follows it.
- `packages/domain/src/phone.ts` already provides `normalisePakistanMobile()` → E.164 `+923XXXXXXXXX` (Urdu/Arabic-Indic digits, landline and non-PK rejection). Phase 2 reuses it; it does not re-implement normalisation.
- `packages/domain/src/money.ts` (bigint PKR minor units) exists; **Phase 2 stores no money** (dues/fees are Phase 5, G17).
- No ID helper exists (only `randomUUID()` v4 for request ids). Proposal: server-generated **UUIDv7** (RFC 9562) via a small, property-tested helper in `packages/server-runtime` (≈20 lines over `node:crypto`), so primary keys are time-ordered without a dependency. PostgreSQL 17 has no native `uuidv7()`.
- Phase 0 conceptual entities (docs/18 §D, docs/07) are respected; where this plan **merges or splits** a conceptual entity, §9 lists the deviation and why.

## 1. Bounded contexts and PostgreSQL schemas

One PostgreSQL database (modular monolith, ADR-035), **one schema per context**, so grants can isolate the most sensitive data even inside one process.

| Schema | Context (owner module in `apps/api`) | Holds | Raw KYC binary? |
|---|---|---|---|
| `identity` | Identity & Consent | accounts, phones, OTP challenges, devices, sessions, refresh tokens, OIDC identities, consent records, phone-change/recovery requests, deletion requests, account-facing security events | **never** |
| `legal` | Identity & Consent (policy registry) | policy document versions (metadata + content hash, not authoritative text) | never |
| `profile` | Account/Profile/Capability | rider profiles, restrictions + restriction events, appeals | never |
| `catalog` | Catalog (seeded now, owned by Phase 3) | cities, service categories (minimal reference rows) | never |
| `compliance` | Driver & Vehicle Compliance | driver applications, driver profiles, vehicles, affiliations, document types, requirement sets, compliance documents, review cases/decisions, service capabilities, selfie capture challenges, duplicate-signal flags | **never** (metadata + vault references only) |
| `vault` | Evidence Vault | evidence object metadata, wrapped data keys, evidence access log | **never** — bytes live only in object storage, encrypted (see vault doc) |
| `staff` | Administration (staff realm) | staff accounts, WebAuthn credentials, staff sessions, role assignments, invitations, break-glass grants, export requests | never |
| `audit` | Administration & Audit | append-only audit events, seal batches | never (ids + reason codes, no PII values) |
| `platform` | Platform | idempotency records, background jobs | never |

**Database roles (NOLOGIN group roles created by migration; LOGIN roles provisioned per environment):**

| Role | Grants | Used by |
|---|---|---|
| `wayvro_migrator` | owns all schemas | migration runner only |
| `wayvro_api` | DML on `identity, legal, profile, catalog, compliance, staff, platform`; `INSERT` (only) on `audit.audit_events`; **no access to `vault`** | API main pool |
| `wayvro_vault` | DML on `vault.*`; `SELECT` on the few `compliance` columns needed to authorise access (case ownership/assignment) | API vault module pool + worker scan/encrypt job |
| `wayvro_worker` | DML on `platform.jobs`; job-specific grants (expiry projection, retention, seals) | `apps/worker` |
| `wayvro_audit_sealer` | `SELECT` on `audit.audit_events`, `INSERT` on `audit.audit_seals` | worker sealer job |

Rationale: a SQL-injection or authorization defect in any non-vault module cannot read `vault` rows; `UPDATE/DELETE` on audit rows is impossible for application roles (grant **and** trigger). dependency-cruiser gains a rule: only `apps/api/src/modules/vault/**` and the worker vault job may import the vault pool provider. **Risk to verify in P2.1:** role creation in migrations needs `CREATEROLE` on managed PostgreSQL (ADR-028 provider unknown) — fallback is an infra bootstrap script owned outside migrations; integration tests must run **as the restricted roles** to prove the grants, not as the superuser.

## 2. Entity model

### 2.1 Identity & Consent (`identity`, `legal`)

| Table | Key columns (proposed) | Constraints / invariants |
|---|---|---|
| `identity.accounts` | `id uuid pk`, `status` (`ACTIVE`,`DELETION_PENDING`,`DELETED`), `display_name text null` (user-chosen, ≤ 60 chars), `preferred_locale` (`en`,`ur`,`ur-Latn`), `created_at`, `last_active_at`, `deleted_at`, `version int` | exactly one row per human identity; never duplicated to represent roles (V02); `DELETED` rows are pseudonymised tombstones (§7) |
| `identity.account_phones` | `id`, `account_id fk`, `phone_lookup_hash bytea` (HMAC-SHA-256 with a server pepper over the E.164 string), `phone_ciphertext bytea` + `key_id` (AES-256-GCM field encryption), `phone_last4 char(4)` (for masking), `status` (`VERIFIED`,`RELEASED`), `verified_at`, `released_at`, `release_reason` | **partial unique** `(phone_lookup_hash) WHERE status='VERIFIED'` → one account per verified phone (K01); partial unique `(account_id) WHERE status='VERIFIED'` → one active phone per account; released hashes retained per retention policy for recycled-number/fraud checks (S12) |
| `identity.otp_challenges` | `id`, `purpose` (`SIGN_IN`,`STEP_UP`,`PHONE_CHANGE_NEW`,`PHONE_CHANGE_CURRENT`,`ACCOUNT_RECOVERY`,`ACCOUNT_DELETION_WEB`), `phone_lookup_hash`, `code_mac bytea` (HMAC of challenge id + code — the code is never stored), `channel` (`SMS`,`WHATSAPP`), `installation_hash`, `client_ip_prefix_hash`, `status` (`ISSUED`,`DELIVERY_FAILED`,`CONSUMED`,`EXPIRED`,`LOCKED`,`SUPERSEDED`), `attempts`, `max_attempts`, `resend_count`, `next_resend_at`, `expires_at`, `consumed_at`, `provider_message_ref`, `account_id null` (set only server-side, never returned), `created_at` | consumption is a CAS `UPDATE … WHERE status='ISSUED' AND expires_at > now()` → single use under concurrency; short retention (§8) |
| `identity.account_devices` | `id`, `account_id`, `installation_hash` (SHA-256 of the app-generated random installation id — not a hardware identifier), `platform` (`android`,`ios`), `first_verified_at`, `last_seen_at`, `trust_state` (`NEW`,`KNOWN`,`REVOKED`) | unique `(account_id, installation_hash)`; drives new-device detection after sessions expire (S12/K17) |
| `identity.sessions` | `id`, `account_id`, `device_id`, `status` (`ACTIVE`,`REVOKED`,`EXPIRED`), `assurance` (`OTP`,`OIDC`,`OTP_STEP_UP`), `step_up_at`, `access_token_hash`, `access_expires_at`, `idle_expires_at`, `absolute_expires_at`, `created_at`, `last_used_at`, `revoked_at`, `revoke_reason`, `app_version`, `version` | access token stored only as SHA-256; one current access token per session (rotated at refresh) |
| `identity.refresh_tokens` | `id`, `session_id fk`, `token_hash`, `issued_at`, `expires_at`, `used_at`, `successor_id`, `idempotency_ref` | partial unique `(session_id) WHERE used_at IS NULL` → exactly one live refresh token per session (family = session); presenting a used token outside the leeway revokes the session (K09) |
| `identity.oidc_identities` | `id`, `account_id`, `provider` (`GOOGLE`,`APPLE`), `subject text` (immutable `sub`), `email_ciphertext null`, `email_verified_at_link bool`, `is_private_relay bool`, `status` (`LINKED`,`UNLINKED`,`REVOKED`,`CONFLICT_HOLD`), `linked_at`, `unlinked_at` | partial unique `(provider, subject) WHERE status IN ('LINKED','CONFLICT_HOLD')`; partial unique `(account_id, provider) WHERE status='LINKED'`; **email is never a lookup key** (docs/18 §B) |
| `identity.phone_change_requests` | `id`, `account_id`, `kind` (`SELF_SERVICE`,`LOST_PHONE_RECOVERY`), `new_phone_lookup_hash`, `new_phone_ciphertext`, `status` (§3.2), `step_up_session_id`, `cooldown_until`, `decided_by_staff_id null`, timestamps | at most one open request per account (partial unique) |
| `identity.consent_records` | `id`, `account_id`, `policy_key`, `policy_version`, `content_sha256`, `locale`, `action` (`ACCEPTED`,`WITHDRAWN`,`DECLINED`), `surface` (`mobile`,`web-public`), `app_version`, `recorded_at` (server time), `request_id` | **append-only** (no UPDATE/DELETE grant); effective consent = latest row per `(account_id, policy_key)` |
| `identity.security_events` | `id`, `account_id`, `type` (`NEW_DEVICE_SIGN_IN`,`SESSION_REVOKED`,`ALL_SESSIONS_REVOKED`,`REFRESH_REUSE_DETECTED`,`PHONE_CHANGE_STARTED`,`PHONE_CHANGED`,`OIDC_LINKED`,`OIDC_UNLINKED`,`RECOVERY_STARTED`,`DELETION_REQUESTED` …), `device_id`, `coarse_context` (platform, app version — no IP, no location), `created_at`, `notified_via` | account-facing activity list and notification source (A11/K17); not the staff audit log |
| `identity.account_deletion_requests` | `id`, `account_id`, `channel` (`APP`,`WEB`), `status` (§3.9), `grace_until`, `blockers jsonb` (reason codes), `completed_at`, `retention_exceptions jsonb` (category → lawful basis reference) | at most one open request per account |
| `legal.policy_documents` | `policy_key` (`TERMS`,`PRIVACY`,`DRIVER_PARTNER_AGREEMENT`,`BIOMETRIC_KYC_NOTICE`,`COMMUNITY_GUIDELINES`), `version`, `locale`, `content_sha256`, `status` (`PLACEHOLDER_NOT_FOR_PRODUCTION`,`APPROVED`,`RETIRED`), `material_change bool`, `effective_at`, `canonical_url`, `approval_ref null` | populated from the generated manifest of the policy-content package (`PHASE2_API_AND_SURFACES.md` §4); production boot refuses if a required policy is `PLACEHOLDER_NOT_FOR_PRODUCTION` |

### 2.2 Account/Profile/Capability (`profile`, `catalog`)

| Table | Key columns | Constraints / invariants |
|---|---|---|
| `profile.rider_profiles` | `id`, `account_id unique`, `status` (`ACTIVE`,`CLOSED`), `created_at` | created at first sign-in; **profile id ≠ account id** so every query is scoped by profile (role model §8) |
| `profile.restrictions` | `id`, `scope` (`ACCOUNT`,`DRIVER_ROLE`,`VEHICLE`,`SERVICE_CAPABILITY`,`CITY_CATEGORY`), `account_id null`, `driver_profile_id null`, `vehicle_id null`, `service_capability_id null`, `city_code null`, `service_category null`, `reason_code` (catalog in code), `reason_class` (`SAFETY`,`FRAUD`,`LEGAL`,`COMPLIANCE`,`QUALITY`,`SECURITY_HOLD`), `status` (`ACTIVE`,`LIFTED`,`EXPIRED`), `effective_from`, `effective_until null`, `appealable bool`, `evidence_ref null`, `created_by_staff_id null`, `created_by_system text null`, `lifted_by_staff_id null`, `lift_reason_code null`, `version` | **CHECK constraints per scope** (e.g. `scope='VEHICLE'` ⇒ `vehicle_id IS NOT NULL AND account_id IS NULL …`); exactly one creator (staff xor system); effects are derived in code from `(scope, reason_class)`, never stored free-form (V13) |
| `profile.restriction_events` | `id`, `restriction_id`, `event` (`CREATED`,`LIFTED`,`EXPIRED`,`APPEAL_OPENED`,`APPEAL_DECIDED`), `actor`, `reason_code`, `at` | append-only history |
| `profile.appeals` | `id`, `account_id`, `review_decision_id null`, `restriction_id null`, `status` (§3.8), `statement text` (≤ 2,000 chars, PII-classified), `supporting_evidence_ids uuid[]` (vault refs), `assigned_staff_id`, `decided_by_staff_id`, `outcome_reason_code`, timestamps | CHECK exactly one subject; decider ≠ original decider (enforced in service + DB trigger comparing staff ids) |
| `catalog.cities` | `code` (`LHR`), `name_en`, `name_ur`, `status` | **minimal seed** owned by Phase 3 (E08); Phase 3 extends additively (districts, zones) |
| `catalog.service_categories` | `code` (`CAR`,`BIKE`,`RICKSHAW`), `status` (`ENABLED`,`DISABLED_LEGAL_GATE`) | bike/rickshaw seeded `DISABLED_LEGAL_GATE` (FD-02/B15) |

### 2.3 Driver & Vehicle Compliance (`compliance`)

| Table | Key columns | Constraints / invariants |
|---|---|---|
| `compliance.driver_applications` | `id`, `account_id`, `state` (§3.5), `city_code fk`, `requested_categories text[]`, `legal_name_ciphertext`, `cnic_lookup_hash`, `cnic_ciphertext`, `cnic_last4`, `date_of_birth_ciphertext`, `requirement_set_id fk` (pinned at submission), `submitted_at`, `decided_at`, `version` | partial unique `(account_id) WHERE state NOT IN ('VERIFIED','REJECTED_FINAL','WITHDRAWN','EXPIRED_DRAFT')` → one non-terminal application per account; applicant-entered identity fields are **claims** until a reviewer confirms them (no OCR in Phase 2) |
| `compliance.driver_profiles` | `id`, `account_id unique`, `application_id`, `state` (§3.6), `verified_legal_name_ciphertext`, `verified_cnic_lookup_hash`, `activated_at`, `version` | at most one per account (D01/K01); **no gender column** (CL-17 — gender is never collected, inferred or stored in Phase 2) |
| `compliance.vehicles` | `id`, `plate_normalised`, `plate_display`, `registration_no_ciphertext`, `registration_lookup_hash`, `make`, `model`, `model_year`, `colour`, `category` fk, `ownership_type` (`REGISTERED_OWNER`,`OPEN_LETTER_UNTRANSFERRED`,`BANK_HYPOTHECATED`,`COMPANY_OWNED`,`FAMILY_OWNED`,`OTHER_AUTHORISED_USE`) per CL-10, `status` (`PENDING_REVIEW`,`APPROVED`,`REJECTED`,`RETIRED`), `version` | partial unique `(plate_normalised) WHERE status <> 'RETIRED'` → one vehicle record per plate; a second applicant registering the same plate attaches via an affiliation and raises a duplicate signal instead of creating a second vehicle (K07/D26 groundwork) |
| `compliance.vehicle_affiliations` | `id`, `vehicle_id`, `driver_application_id null`, `driver_profile_id null`, `relation` (`OWNER`,`AUTHORISED_USER`,`FLEET_DRIVER` — fleet only Phase 12), `status` (`PENDING`,`APPROVED`,`REJECTED`,`ENDED`), `authorisation_document_id null` | many drivers per vehicle; online exclusivity (D26) is Phase 4 |
| `compliance.document_types` | `code` (e.g. `CNIC`,`DRIVING_LICENCE`,`VEHICLE_REGISTRATION`,`AUTHORISED_USE_LETTER`,`ROUTE_PERMIT_44B`,`VEHICLE_FITNESS_VICS`,`THIRD_PARTY_INSURANCE`,`TOKEN_TAX`,`POLICE_CHARACTER_CERTIFICATE`,`PSCA_QR_PANIC_BUTTON`,`SELFIE_FOR_MANUAL_REVIEW`), `subject` (`DRIVER`,`VEHICLE`,`DRIVER_VEHICLE`), `has_expiry`, `has_number`, `number_format` (validation regex or none), `evidence_kinds[]` (e.g. front/back), `retention_class` | catalogue in DB, changed only through requirement-set governance |
| `compliance.requirement_sets` | `id`, `city_code`, `service_category`, `version`, `status` (§3.11), `effective_from`, `effective_until`, `source_reference` (counsel memo/notification id — **required for `APPROVED`**), `drafted_by`, `approved_by` (≠ drafter), `is_placeholder bool` | partial unique `(city_code, service_category) WHERE status='ACTIVE'`; Phase 2 seeds **placeholder** sets for `LHR/CAR` only, flagged `is_placeholder=true`, which production refuses to activate (EG-03) |
| `compliance.requirement_set_items` | `requirement_set_id`, `document_type_code`, `mandatory`, `min_validity_days_at_submission`, `renewal_lead_days`, `per_district bool` (44B permits), `applies_to_ownership_types[]`, `licence_classes_allowed[]` (R06) | no per-driver override table exists — fleet/admin cannot waive a requirement (R06) |
| `compliance.compliance_documents` | `id`, `document_type_code`, `driver_profile_id null`, `driver_application_id null`, `vehicle_id null`, `district_code null`, `number_ciphertext null`, `number_lookup_hash null`, `number_last4 null`, `licence_class null`, `issued_on null`, `expires_on null` (**reviewer-confirmed**, applicant-claimed values kept separately as `claimed_*`), `issuing_authority null`, `status` (§3.7), `supersedes_id null`, `review_case_id`, `version` | CHECK subject columns match `document_types.subject`; validity evaluated against **server time** (Q23); `number_lookup_hash` feeds duplicate detection (K07) |
| `compliance.document_evidence` | `compliance_document_id`, `evidence_object_id` (vault id), `evidence_kind` (`FRONT`,`BACK`,`PAGE`,`SELFIE`) | link table; vault ids are opaque |
| `compliance.selfie_capture_challenges` | `id`, `application_id`, `instruction_code` (server-random from a fixed list, e.g. `RAISE_RIGHT_HAND_TWO_FINGERS`), `issued_at`, `expires_at` (≤ 5 min), `consumed_by_evidence_id` | anti-replay aid for **manual** review only; never labelled liveness (FD-06) |
| `compliance.review_cases` | `id`, `kind` (`INITIAL_APPLICATION`,`RESUBMISSION`,`DOCUMENT_RENEWAL`,`VEHICLE_ADDITION`,`REVERIFICATION`,`DUPLICATE_SIGNAL`,`APPEAL`,`ACCOUNT_RECOVERY`), `subject refs`, `city_code`, `priority`, `status` (§3.10), `assigned_staff_id`, `lease_expires_at`, `escalated bool`, `version` | claim is CAS on `(status, version)`; city scope drives ABAC |
| `compliance.review_decisions` | `id`, `review_case_id`, `decision` (`APPROVE`,`REJECT`,`NEEDS_INFO`,`ESCALATE`,`REQUIRE_IN_PERSON`), `reason_codes text[]`, `checklist jsonb` (structured, schema-validated: identity match assessment, document authenticity checks, licence class match, expiry confirmations), `identity_match_assessment` (`CONFIRMED_BY_REVIEWER`,`NOT_MATCHING`,`UNCERTAIN_ESCALATE`,`IN_PERSON_REQUIRED`), `evidence_viewed_ids uuid[]`, `decided_by_staff_id`, `second_reviewer_staff_id null`, `decided_at`, `staff_session_assurance` | **append-only**; a decision never edits a previous one; an `APPROVE` requires a step-up-fresh staff session and, where the case is flagged (duplicate signal, in-person override), a second reviewer (maker-checker) |
| `compliance.duplicate_signals` | `id`, `signal` (`CNIC_HASH_MATCH`,`DOCUMENT_NUMBER_MATCH`,`EVIDENCE_HASH_MATCH`,`PLATE_ALREADY_AFFILIATED`,`PHONE_RECENTLY_RELEASED`), `subject refs`, `matched refs`, `status` (`OPEN`,`CLEARED`,`CONFIRMED_FRAUD`), `review_case_id` | signals open a review; **never auto-merge or auto-reject** (K07/S13) |
| `compliance.service_capabilities` | `id`, `driver_profile_id`, `vehicle_id`, `city_code`, `service_category`, `status` (`GRANTED`,`REVOKED`), `granted_by_decision_id`, `granted_at`, `revoked_at` | partial unique `(driver_profile_id, vehicle_id, city_code, service_category) WHERE status='GRANTED'`; a grant is necessary, never sufficient (live checks in §4) |

### 2.4 Evidence vault (`vault`) — summary (detail: vault doc)

`vault.evidence_objects` (opaque id, owner account, application/document refs, `storage_bucket_class`, `storage_key` opaque random, `status`, `byte_size`, `sha256`, `detected_mime`, `wrapped_dek`, `kek_id`, `created_at`, `retention_until`, `legal_hold bool`, `deleted_at`), `vault.evidence_access_log` (append-only: staff id, evidence id, case id, reason code, reason text, purpose, view token id, issued/consumed timestamps, request id). **No table outside `vault` stores a storage key, URL or bytes.**

### 2.5 Staff realm (`staff`) — summary (detail: authorization matrix)

`staff.staff_accounts` (separate id space from `identity.accounts`; work email as contact; `status`; `conflict_phone_lookup_hash null` — the staff member's own consumer phone hash, used to block self-review), `staff.webauthn_credentials`, `staff.invitations` (single-use enrolment token hash, 24 h), `staff.sessions` (separate from consumer sessions), `staff.role_assignments` (role, `city_scope text[]`, `valid_until`, `granted_by`, `approved_by` ≠ granted_by for privileged roles), `staff.break_glass_grants`, `staff.export_requests`.

### 2.6 Audit and platform

- `audit.audit_events`: `id` (UUIDv7), `occurred_at` (server), `actor_type` (`STAFF`,`ACCOUNT`,`SYSTEM`), `actor_id`, `staff_session_id null`, `action` (dotted code, e.g. `compliance.review.decided`), `object_type`, `object_id`, `reason_code null`, `reason_text_ref null` (pointer to a restricted note — no PII values in the audit row), `before_digest`/`after_digest` (hashes or field-level change list of non-PII fields), `request_id`, `outcome` (`ALLOWED`,`DENIED`). Trigger rejects `UPDATE`/`DELETE`; application roles have `INSERT` only (Q39).
- `audit.audit_seals`: `batch_no`, `first_event_id`, `last_event_id`, `merkle_root`, `prev_seal_hash`, `seal_hash`, `sealed_at`. A worker job seals closed batches (no hot-path lock); verification recomputes the chain. Anchoring the latest seal hash outside the database (write-once object storage / founder-held copy) is **DESIGN_NOW_ACTIVATE_LATER** with production storage (EG-05).
- `platform.idempotency_records`: `(actor_scope, idempotency_key)` primary key, `route`, `request_sha256`, `status` (`IN_PROGRESS`,`COMPLETED`), `response_status`, `response_body_ciphertext` (sensitive responses such as token pairs are encrypted), `expires_at` (24 h; 60 s for token responses). Same key + different request hash → `WAYVRO_E_IDEMPOTENCY_CONFLICT`. This completes the Phase 1 `preHandler`, which today validates header shape only.
- `platform.jobs`: `id`, `kind`, `payload jsonb` (ids only), `run_after`, `attempts`, `max_attempts`, `status` (`READY`,`RUNNING`,`SUCCEEDED`,`FAILED`,`DEAD`), `locked_by`, `lease_until`, `last_error_code`; claimed with `FOR UPDATE SKIP LOCKED` (exactly the use ADR-004 reserved for it). Enqueued **in the same transaction** as the domain change. Proposal ADR-042 (no BullMQ dependency in Phase 2).

## 3. State machines

All transitions are server-side, reason-coded where human-initiated, audited (Q39), and applied with optimistic concurrency (`version` CAS) so double-submits and races resolve to exactly one winner; a losing request gets `409 WAYVRO_E_CONFLICT` or the idempotent replay of the winning response.

### 3.1 Account
```
(none) ──OTP verified for unknown phone──▶ ACTIVE  [+ requiredActions: ACCEPT_POLICIES]
ACTIVE ──deletion requested & verified──▶ DELETION_PENDING ──grace elapsed, no blockers──▶ DELETED (pseudonymised tombstone)
DELETION_PENDING ──user cancels within grace──▶ ACTIVE
```
Overlays (not states): restrictions (§5), required actions (`ACCEPT_POLICIES`, `PHONE_STEP_UP`, `RECOVERY_REVIEW`). A security lock is an `ACCOUNT` restriction with `reason_class=SECURITY_HOLD`, not a separate account state — one restriction mechanism, one audit trail.

### 3.2 Phone ownership and change
`account_phones`: `VERIFIED → RELEASED` (reasons: `PHONE_CHANGED`, `RECYCLED_NUMBER_NEW_OWNER`, `ACCOUNT_DELETED`, `STAFF_RECOVERY`).
`phone_change_requests`: `REQUESTED → CURRENT_PHONE_VERIFIED (self-service) | RECOVERY_STEP_UP_PENDING (lost phone) → NEW_PHONE_VERIFIED → COOLDOWN (recovery only, default 72 h, notifications to every active session) → COMPLETED`; exits `CANCELLED` (user or "this wasn't me" from an existing session), `EXPIRED`, `DENIED` (staff, reason-coded). A new phone already `VERIFIED` on another account is refused with a generic conflict — **no merge** (S13).

### 3.3 OTP challenge
`ISSUED → CONSUMED | EXPIRED | LOCKED (attempts exhausted) | SUPERSEDED (newer challenge for same phone+purpose+installation)`; `ISSUED → DELIVERY_FAILED` when every configured channel fails (honest error, never verified). Detail and limits: auth design §2.

### 3.4 Session and refresh family
`ACTIVE → REVOKED (USER_LOGOUT, USER_LOGOUT_ALL, REFRESH_REUSE, PHONE_CHANGED, RECOVERY, RESTRICTION_SECURITY_HOLD, STAFF_LOST_DEVICE, ACCOUNT_DELETED) | EXPIRED (idle/absolute)`. Refresh token: `LIVE → USED (successor issued)`; reuse of a `USED` token outside the leeway ⇒ session `REVOKED(REFRESH_REUSE)` + security event.

### 3.5 Driver application (implements role model §3, application part)
```
DRAFT ──required policies accepted (DRIVER_PARTNER_AGREEMENT, BIOMETRIC_KYC_NOTICE)──▶ CONSENTED
CONSENTED ──first evidence upload slot issued──▶ DOCUMENTS_PENDING
DOCUMENTS_PENDING ──all mandatory items of the pinned requirement set present & AVAILABLE──▶ SUBMITTED
SUBMITTED ──automatic quality/duplicate checks job──▶ AUTO_CHECK_PENDING ──always──▶ MANUAL_REVIEW
MANUAL_REVIEW ──NEEDS_INFO decision──▶ NEEDS_INFO ──applicant resubmits──▶ SUBMITTED
MANUAL_REVIEW ──REJECT──▶ REJECTED ──appeal opened──▶ APPEALED ──appeal decided──▶ MANUAL_REVIEW | REJECTED_FINAL
MANUAL_REVIEW ──APPROVE (identity, documents, licence class, vehicle, Punjab artefacts confirmed)──▶ VERIFIED  ⇒ driver_profile created
DRAFT|CONSENTED|DOCUMENTS_PENDING|NEEDS_INFO ──applicant withdraws──▶ WITHDRAWN
DRAFT|CONSENTED|DOCUMENTS_PENDING ──inactive > N days (proposal 30)──▶ EXPIRED_DRAFT
```
There is **no transition from any automated check to VERIFIED** (K04/K05; docs/12 Phase 2 gate). Phone verification is an account precondition, not an application state (docs/18 §C.6). `WITHDRAWN` and `EXPIRED_DRAFT` are housekeeping terminals proposed as clarification CL-P2-04 (`PHASE2_PLAN.md` §8).

### 3.6 Driver profile (implements role model §3, post-verification part)
```
VERIFIED ──requirement-set prerequisites met (e.g. training/inspection markers recorded by staff where the set requires them) + ≥1 GRANTED service capability──▶ ACTIVE_ELIGIBLE
ACTIVE_ELIGIBLE ──a mandatory document expires (job or lazy evaluation)──▶ EXPIRED ──renewal approved──▶ ACTIVE_ELIGIBLE
ACTIVE_ELIGIBLE ──re-verification due (policy/risk)──▶ REVERIFY_DUE ──pass──▶ ACTIVE_ELIGIBLE | ──fail──▶ DRIVER_ROLE restriction
```
**SUSPENDED is derived, not stored:** a profile is "suspended" exactly when an `ACTIVE` restriction with scope `DRIVER_ROLE` exists (reason-coded, appealable per policy). Permanent ineligibility is a non-expiring `DRIVER_ROLE` restriction whose appeal path is exhausted. This keeps one source of truth for suspension (V13) — deviation D-03 in §9. `ACTIVE_ELIGIBLE` is necessary, never sufficient (§4).

### 3.7 Compliance document
`SUBMITTED → UNDER_REVIEW → VALID | REJECTED`; `VALID → EXPIRED` (server time ≥ `expires_on`); `VALID → SUPERSEDED` (renewal approved). "EXPIRING" (within `renewal_lead_days`) is a **computed** display status, not stored. Reminder delivery (M17) is Phase 5; Phase 2 shows status in-app and in the ops roster.

### 3.8 Appeal
`SUBMITTED → UNDER_REVIEW → UPHELD | OVERTURNED`, `SUBMITTED|UNDER_REVIEW → WITHDRAWN`. Decider ≠ original decision maker / restriction creator. `OVERTURNED` on a rejection returns the application to `MANUAL_REVIEW`; on a restriction it lifts the restriction with `lift_reason_code=APPEAL_OVERTURNED`.

### 3.9 Account deletion
`REQUESTED → GRACE (default proposal 14 days; cancellable) → PROCESSING → COMPLETED`; `REQUESTED|GRACE → BLOCKED (reason codes: LEGAL_HOLD, OPEN_INVESTIGATION, OPEN_APPEAL_DECISION_PENDING; later phases add ACTIVE_TRIP, DRIVER_DUES)` → `GRACE` when unblocked; `CANCELLED`. Detail §7.

### 3.10 Review case
`OPEN → CLAIMED (lease, default 30 min, renewable) → DECIDED | ESCALATED → CLAIMED (senior)`; lease expiry → `OPEN`; `CANCELLED` when the subject is withdrawn/deleted. Claiming requires city scope + not-own-account (conflict) checks.

### 3.11 Requirement set
`DRAFT → PENDING_APPROVAL → APPROVED (effective_from in future) → ACTIVE → RETIRED`; approval by a different `COMPLIANCE_ADMIN` (maker-checker); `APPROVED` requires `source_reference` and, in production, `is_placeholder=false`. Submitted applications keep the set version they were submitted under; re-verification uses the then-active set.

### 3.12 Staff account / session / break-glass
Staff account `INVITED → ACTIVE ↔ SUSPENDED → OFFBOARDED (terminal)`. Staff session `ACTIVE ↔ LOCKED (idle) → REVOKED | EXPIRED`. Break-glass `ACTIVE (≤ 60 min) → ENDED | EXPIRED → REVIEWED`.

## 4. Capability derivation (server-side, pure, per request)

Phase 2 implements the Phase-2-observable subset of the role-model §1 function as a pure module in `apps/api` (not in `packages/domain`, so clients cannot import an "authoritative" evaluator):

```
driverEarningEligibility(now, account, driverProfile, vehicle, city, category, documents, restrictions, capabilityGrant) →
  { eligible: boolean, blockers: ReasonCode[] }       -- blockers are exhaustive and ordered, never just the first failure
  blockers include: ACCOUNT_RESTRICTED, NO_DRIVER_PROFILE, PROFILE_NOT_ACTIVE_ELIGIBLE, DRIVER_ROLE_RESTRICTED,
  VEHICLE_RESTRICTED, CAPABILITY_NOT_GRANTED, CAPABILITY_RESTRICTED, CITY_CATEGORY_RESTRICTED,
  DOCUMENT_MISSING(type), DOCUMENT_EXPIRED(type), DOCUMENT_NOT_VALID(type), REQUIREMENT_SET_PLACEHOLDER (production only),
  SERVICE_CATEGORY_DISABLED_LEGAL_GATE
```
Phase 4 adds `RIDER_TRIP_ACTIVE`, `VEHICLE_ONLINE_UNDER_OTHER_DRIVER` (D26), `OTHER_DRIVER_SESSION` (D27) and calls the same function at go-online/accept/start (K12). Document validity is evaluated **live against server time** at every call; stored states (§3.6/3.7) are projections that can only be *more* restrictive in display, never more permissive in decisions. Property tests (fast-check, already in the workspace) generate arbitrary combinations and assert: no combination with any blocker yields `eligible`; any ACCOUNT restriction blocks; a DRIVER_ROLE restriction never blocks rider capabilities (INV-05 Phase-2 subset, INV-09).

Rider capabilities in Phase 2 are limited to account use (`account.manage`, `driver.apply`, `support/safety entry`); booking capabilities arrive with Phase 3/5 consumers.

## 5. Restriction semantics (V13)

| Scope | Target | Earning effect | Rider effect | Sign-in | Typical reasons | Lifted by |
|---|---|---|---|---|---|---|
| `ACCOUNT` | account | blocked | blocked (booking) | allowed in a **restricted session** that can view reason, appeal, support/safety, data/deletion requests — except `SECURITY_HOLD`, which revokes sessions and requires recovery | confirmed fraud, safety ban, legal hold, suspected takeover | T&S decision (maker-checker for lifting `SAFETY`/`FRAUD`, Phase 6 T24 generalises), appeal overturn, expiry |
| `DRIVER_ROLE` | driver profile | blocked for every vehicle/category | **unaffected** | normal | quality/safety suspension, failed re-verification, document fraud, permanent ineligibility | reviewer/T&S decision, appeal, expiry |
| `VEHICLE` | vehicle | blocked **for that vehicle, for every affiliated driver** (D26 groundwork) | unaffected | normal | fake/expired plate docs, vehicle-level ban | compliance decision |
| `SERVICE_CAPABILITY` | grant | blocked for that driver+vehicle+city+category | unaffected | normal | category-specific issue (e.g. licence class) | compliance decision |
| `CITY_CATEGORY` | driver profile + city + category | blocked in that city/category | unaffected | normal | district/permit coverage gap (R46) | compliance decision |

Expired documents are **not** modelled as restriction rows: they block through live evaluation (§4), so a missed job run can never leave an expired driver eligible. Restrictions are for discretionary or policy actions with an accountable actor.

Escape prevention (CLAUDE.md §3): restrictions attach to account/profile/vehicle ids server-side; mode is client presentation; new sessions on new devices, reinstall, logout/login and mode switch all read the same rows. Active-obligation conflicts (trip, online presence) are Phase 4/5 inputs to the same evaluator (INV-06 tests land there).

Every create/lift: idempotent (`Idempotency-Key`), reason-coded from a closed catalogue, audited, appealable flag explicit, user-facing message from a localisation key mapped to the reason code (no internal notes exposed).

## 6. Consent and policy acceptance

- Policy keys and versions come from the policy-content package manifest (version, locale, `content_sha256`, status). Acceptance stores the exact `content_sha256` shown, locale, surface and app version (A04/R09 proof).
- Required for account use: `TERMS`, `PRIVACY`. Required before `driver_applications.state=CONSENTED`: `DRIVER_PARTNER_AGREEMENT`, `BIOMETRIC_KYC_NOTICE` (K14). `COMMUNITY_GUIDELINES` acceptance becomes required when N02 text exists (counsel, Phase 6) — listed but not required in Phase 2.
- Material change ⇒ new version with `material_change=true` ⇒ `requiredActions` includes re-acceptance; the account remains able to view policies, support/safety, data requests and deletion while re-acceptance is pending.
- Withdrawal: withdrawing `BIOMETRIC_KYC_NOTICE` consent stops further processing of selfie evidence, closes the application with an explanation, and schedules evidence deletion subject to retention exceptions (counsel EG-16); withdrawing `TERMS`/`PRIVACY` is equivalent to stopping use and is routed to deletion. Exact lawful-basis wording is counsel's (EG-02).
- Correction: applicant-claimed identity fields are correctable via `NEEDS_INFO`/resubmission; reviewer-confirmed fields change only through a new review decision (audited), never by a client `PATCH` (mass-assignment control).

## 7. Account deletion and retention (U06; A10/Q24/Q47 baselines)

Pipeline (worker jobs, idempotent, resumable, observable):
1. **Verify**: in-app request from an authenticated session with fresh phone step-up, or web request verified by OTP to the account phone (purpose `ACCOUNT_DELETION_WEB`).
2. **Blockers** (reason-coded, shown to the user): legal hold, open investigation, decision-pending appeal; later phases add active trip/driver obligation and outstanding dues. A blocker defers, never silently cancels.
3. **Grace** (proposal 14 days; founder decision Q-12): cancellable from any session; security event + notification.
4. **Processing**: revoke all sessions; end OIDC links (Apple token revocation call is part of P2.A3 activation); release phone (`RELEASED`, reason `ACCOUNT_DELETED`) keeping only the lookup hash for the counsel-approved fraud-retention period; pseudonymise `accounts` (null display name, keep id); close rider profile; withdraw open applications; schedule KYC evidence deletion per class unless legal hold; keep audit rows (ids only) and append-only consent proof as lawful records per counsel; keep compliance decisions as pseudonymous records for the counsel-approved period (driver vetting history and fraud prevention are the anticipated exceptions — **EXTERNAL** EG-16).
5. **Downstream**: object storage deletion (verified by HEAD 404), job/idempotency records expire naturally; no analytics/warehouse exists yet (Q38 later). Completion audited; user receives completion notice where a channel exists.

Retention durations in Phase 2 are **configuration with placeholder values** marked `NOT_COUNSEL_APPROVED`; production activation of real-data retention requires EG-16 (Q24 counsel matrix). Proposed placeholders: OTP challenges 30 days; ended sessions/refresh tokens 180 days; security events 1 year; consent records life of account + statutory period; rejected/withdrawn KYC evidence 180 days after the appeal window; approved-driver evidence for the relationship + counsel-set period; audit events per counsel (proposal ≥ 5 years); quarantine objects 24 h.

## 8. PII classification and where it may appear

| Class | Examples | Storage | Logs/telemetry | API responses |
|---|---|---|---|---|
| P-SECRET | OTP codes, tokens, peppers, keys | never stored in clear (MAC/hash) | never | tokens only to their owner at issuance |
| P-IDENTITY-EVIDENCE | CNIC/licence images, selfies | object storage, encrypted (vault) | never | never via general APIs; staff view stream only |
| P-IDENTITY-NUMBERS | CNIC, licence, registration numbers, DOB, legal name | field-encrypted + HMAC lookup + last4 | never | masked to owner; full only in staff case view with reason-for-access |
| P-CONTACT | phone, OIDC email | field-encrypted + HMAC lookup + last4 | never (masked `+92 3** ***1234` only in user-facing text, not logs) | masked |
| P-ACCOUNT | display name, locale, device platform | plain | ids only | owner |
| P-OPERATIONAL | states, reason codes, timestamps | plain | yes (no ids beyond pseudonymous ids where needed) | per policy |

Field encryption uses AES-256-GCM via `node:crypto` behind a `FieldCipher`/`KeyProvider` port; local/test key from env (refused in staging/production), production KEK from KMS (EG-05). Founder decision Q-05 confirms this cost/benefit.

## 9. Deliberate deviations from Phase 0 conceptual entities (for review)

| # | Phase 0 concept | Proposal | Why |
|---|---|---|---|
| D-01 | separate `role_restrictions` and `account_restrictions` (docs/07) | one `profile.restrictions` table with `scope` + CHECK constraints | one evaluation path, one audit trail, vehicle/capability/city scopes fit naturally; DB constraints keep scopes well-formed |
| D-02 | `driver_documents`, `vehicle_documents`, `compliance_artefacts`, `permits`, `vehicle_insurance` (docs/07, architecture §2) | one `compliance.compliance_documents` + `document_types` + `requirement_sets` | Punjab artefacts must be configurable per city/category (R06/R46); separate tables would hard-code today's rule set |
| D-03 | `SUSPENDED` as a stored driver state (role model §3) | derived from an active `DRIVER_ROLE` restriction | single source of suspension truth with reason/appeal (V13); canonical semantics unchanged |
| D-04 | `Credential` entity (docs/18 §D) | none for consumers | phone OTP is the only consumer credential (CL-01); staff WebAuthn credentials live in `staff` |
| D-05 | `ModePreference` table (docs/07) | client-only, not persisted server-side | it is never authorisation; persisting it invites misuse |
| D-06 | `verification_cases` + `identity_access_audit` | `review_cases` + `vault.evidence_access_log` | same meaning, scoped to their owning contexts |
| D-07 | BullMQ worker (architecture proposal §1) | PostgreSQL job table with `SKIP LOCKED` (ADR-042 proposal) | jobs enqueue transactionally with domain writes; no new dependency; ADR-004 reserved `SKIP LOCKED` for this |

## 10. Migration sequence (planned — NOT created)

All migrations are reviewed SQL (ADR-004), additive, with the five header fields, applied clean→latest, previous→latest and re-run=0 in CI, and verified by real-type assertions (`format_type`, constraint existence, **grant checks executed as each restricted role**). No PostGIS columns are introduced in Phase 2 (districts/zones geometry is Phase 3), so the drizzle-kit PostGIS defects do not apply.

| # (proposed) | Micro-phase | Content | Rollback / forward-fix |
|---|---|---|---|
| 0001_identity_core | P2.1 | schemas `identity, profile, platform, audit`; group roles + grants; `accounts`, `account_phones`, `otp_challenges`, `account_devices`, `sessions`, `refresh_tokens`, `security_events`, `rider_profiles`, `idempotency_records`, `jobs`, `audit_events` (+ no-update trigger), `audit_seals` | pre-production: drop schemas in reverse (no real data exists before Phase 7); after first real data: forward-fix only |
| 0002_policy_consent | P2.2 | schema `legal`; `policy_documents`; `identity.consent_records` | as above |
| 0003_staff_realm | P2.4 | schema `staff`; staff tables; audit grants for sealer | as above |
| 0004_compliance_core | P2.5 | schemas `catalog, compliance`; cities/categories seed rows (`LHR`; `CAR` enabled, `BIKE`/`RICKSHAW` `DISABLED_LEGAL_GATE`); document types; requirement sets (placeholder `LHR/CAR`); applications, profiles, vehicles, affiliations, compliance documents, duplicate signals, service capabilities; `profile.restrictions`, `restriction_events` | as above |
| 0005_vault | P2.6 | schema `vault` + `wayvro_vault` role grants; `evidence_objects`, `evidence_access_log`; `compliance.document_evidence`, `selfie_capture_challenges` | as above |
| 0006_review_appeals | P2.7 | `review_cases`, `review_decisions`, `profile.appeals`, `staff.export_requests` | as above |
| 0007_recovery_deletion | P2.9 | `phone_change_requests`, `account_deletion_requests` | as above |
| 0008_oidc | P2.10 | `oidc_identities` | as above |

Each table lands in the micro-phase that first **uses** it, so no migration ships unused schema (no dead tables, CLAUDE.md §7). Seeds are reference data only (cities, categories, document types, placeholder requirement set); synthetic accounts/drivers come from a **local-only** CLI that refuses any `WAYVRO_ENV` other than `local`/`test` and never runs in migrations.

**Transaction boundaries:** OTP verify (challenge CAS + account/phone/profile upsert + session + refresh + audit + security event) is one transaction; application submission (state CAS + review case + job enqueue + audit) is one transaction; review decision (decision insert + application/profile/capability/document state changes + audit + job enqueue) is one transaction; vault finalisation (object state + wrapped key + access log) is one transaction after the storage write succeeds, with orphan cleanup for the reverse failure.
