# PHASE2_IMPLEMENTATION_RECORD — Full Phase 2 implementation (P2.1 review fixes, P2.2 – P2.10)

**Branch:** `phase-2/identity-controlled-onboarding` from P2.1 `2666c8ba8627831dd2b40b2a7fa1b18aef65d809` (protected `main` = `8c8e528bf2a975f2fe385fd49ed9de78f29ed530`, unchanged). · **Authorisation:** founder authorised the whole Phase 2 engineering implementation in one run (2026-10-11); micro-phases P2.1–P2.10 are internal checkpoints. · **Status:** IN PROGRESS — one living record, updated at every checkpoint; **not merged, no PR**. · **Agent:** Claude Code (self-audit, not independent verification). · Synthetic data only; external gates EG-01..EG-23 remain open unless stated otherwise with evidence.

The P2.1 record (`PHASE2_P2_1_IMPLEMENTATION_RECORD.md`) remains the record for P2.1; its §3a lists the review corrections.

## Checkpoint log

| Checkpoint | Commit | Summary |
|---|---|---|
| P2.1-fix | `9cfbc55` | RB-01 per-claim job lease tokens; RB-02 ledger-derived lookup plans + PostgreSQL advisory locks; DH-01/DH-02 deployment hardening (ADR-038, ADR-042) |
| P2.2 | `41dd03a` | policy registry, consent, age-eligibility mechanism, legal pages, Playwright + axe |
| P2.4 + P2.5 | (first of two checkpoint commits) | staff realm: WebAuthn, BFF, RBAC/ABAC, maker-checker, offboarding, break-glass, audit viewer (ADR-039); driver/vehicle compliance domain, requirement sets, age-policy data entry, restrictions. Committed together because they share the API composition, contracts index, guard and web-ops shell, which were developed in one pass |
| P2.3 | (second checkpoint commit) | mobile account slice in the ONE app (ADR-043); built in parallel by a delegated agent inside `apps/wayvro-mobile` only, reviewed and gated here |

Intermediate checkpoint commits are not individually CI-verified. CI runs on the pushed HEAD.

## P2.2 — Policy versions, consent, age eligibility and public legal pages

**IDs:** A04, R09, W05, K14 (consent infrastructure), A15 (mechanism). **ADR:** ADR-044.

| Area | Implementation |
|---|---|
| Content | `packages/legal-content`: 7 policies × `en`/`ur`, version 1 each, `PLACEHOLDER_NOT_FOR_PRODUCTION`, effective 2026-10-10T00:00Z; hash lock; `requiredFor` = TERMS/PRIVACY → `ACCOUNT`, DRIVER_PARTNER_AGREEMENT/BIOMETRIC_KYC_NOTICE → `DRIVER_APPLICATION` |
| Migration | `0002_policy_consent_age`: schema `legal`; `legal.policy_documents` (immutable), `legal.age_eligibility_policies` (retire-only; placeholder v1 seeded, no threshold, teen programme CHECK-disabled), `identity.consent_records` + `identity.age_declarations` (append-only; composite FKs bind hash and mode); generic `platform.append_only()` trigger function |
| API | `GET /v1/legal/policies?locale=`, `GET /v1/legal/policies/{policyKey}/versions/{version}`, `GET /v1/legal/age-eligibility-policy` (public); `GET/POST /v1/account/consents`, `POST /v1/account/age-declarations` (session, idempotent, audited `CONSENT_RECORDED` / `AGE_DECLARATION_RECORDED`). New error code `WAYVRO_E_CONFLICT` (409: stale version or hash mismatch; age declaration twice) |
| Required actions | computed on server time at sign-in and in account state: `ACCEPT_POLICIES` (never accepted, withdrawn/declined, or a MATERIAL change since the accepted version) and `AGE_DECLARATION` (mode ≠ NONE and no declaration for the current version) |
| Boot | registry registered + verified (drift ⇒ refuse); `WAYVRO_ENV=production` refuses placeholder texts and a placeholder age policy |
| Web | `apps/web-public`: `/legal`, `/legal/<slug>`, `/legal/<slug>/v<N>`, `/legal/changelog`, `?lang=ur` (RTL), placeholder banner + `noindex`, content fingerprint, nonce CSP |
| Hardening | ESLint + dependency-cruiser now classify `@wayvro/field-crypto` and `@wayvro/identity-core` as server-only (clients could previously import them); `@wayvro/legal-content` is a pure package |

**Evidence:** `packages/legal-content/src/index.test.ts` (6); `packages/db/test/policy-consent-age.integration.test.ts` (7) + generic lifecycle tests for every migration prefix; `apps/api/test/legal.integration.test.ts` (11: API-CONSENT, API-AGE server part, registry immutability), `apps/api/test/policy-registry.test.ts` (3, BOOT-NEG placeholders); `tests/e2e-web/web-public/legal.spec.ts` (11, Playwright + axe WCAG 2.1 A/AA: no serious/critical violations).

**Requirement status after P2.2** (whole-requirement view; final classification in the handoff):
- A04 — consent/versioning/time engineering done; mobile consent UI P2.3; counsel texts EG-02 ⇒ PARTIAL_EXTERNAL_GATED.
- R09 — separate versioned policies, change log, re-consent on material change done; counsel texts EG-02 ⇒ PARTIAL_EXTERNAL_GATED.
- W05 — canonical dated versioned pages + change log + placeholder banner done; domain/store links EG-15/EG-18, counsel texts EG-02 ⇒ PARTIAL_EXTERNAL_GATED.
- K14 — consent infrastructure done; applicant explanations/dispute/correction UI in P2.8 ⇒ PARTIAL (in progress).
- A15 — policy versions, declaration modes, DOB only when required, production refusal done; driver age evaluation + `AGE_POLICY` restriction P2.5; reviewer DOB check P2.7; thresholds EG-23 ⇒ PARTIAL (in progress).

**Residual / notes:** placeholder Urdu pending native review; Roman-Urdu readers get English pages; an under-age declaration (DOB below an approved minimum, or "I do not meet the minimum") is handled with the restriction model in P2.5 — until then only `affirmed: true` is accepted in affirmation mode.

## P2.4 — Staff realm, web-ops authorization and audit console

**IDs:** H01, H08, K10, Q39 (viewer + verification visibility), Q42 (app part), W07 (shell, banner, idle lock), K01 (staff realm). **ADR:** ADR-039.

| Area | Implementation |
|---|---|
| Migration | `0003_staff_realm`: schemas `staff` + `catalog` (cities, LHR seed); staff accounts, WebAuthn credentials, invitations (hash only), challenges, sessions, role assignments (+ city junction), break-glass grants, append-only access reasons; audit actor type `STAFF`; `audit.seal_verifications`; bounded viewer functions `audit.list_events`/`audit.seal_status` |
| API | 29 `/v1/admin/*` routes (`packages/contracts/src/staff.ts`): WebAuthn enrolment/login/step-up/unlock/logout, me, own credentials, roster, invitations, re-enrolment (maker-checker), offboarding, role grant/approve/revoke, break-glass activate/end/list/review, audit events/seal status/verification request |
| Guard | `@StaffSession({ permission, stepUp, allowLocked })`; per-request session + assignment resolution; denials audited; break-glass actions tagged |
| CLI | `apps/api/src/bin/staff-bootstrap.ts` (no stored credential; refuses while an active admin with a key exists) |
| Worker | housekeeping (challenge purge, invitation/break-glass expiry + alert); seal verification recorded |
| web-ops | BFF (`/bff/*` allowlisted to `STAFF_ROUTES`, Origin check, `__Host-` cookie), pages: login, enrol, overview, staff, audit, break-glass, security keys; environment banner; idle lock overlay; confirmations; step-up retry |
| CI | `e2e-web` job now starts infrastructure and runs the web-ops project (`WAYVRO_E2E_OPS=1`) |

**Evidence:** API integration 13 (SEC-STAFF incl. origin/RP/UV/replay/counter negatives, realm separation, idle lock, step-up audit, maker-checker, offboarding next-request failure, re-enrolment, SEC-BG, audit viewer, AUTHZ-MATRIX over every permissioned admin route × 7 roles + completeness + no-export route check); DB 7 (constraints and grants as restricted roles); web-ops Playwright 7 (virtual authenticator, cookie flags, BFF allowlist/Origin, axe).

**Status after P2.4:** H01 PARTIAL_EXTERNAL_GATED (SSO EG-19); H08 in progress (privileged KYC/restriction actions arrive P2.5/P2.7; alert channel EG-21); K10 engineering done for P2.4 scope (production access controls Phase 7); Q39 viewer done (external anchor EG-05); Q42 app part done (device/network controls external); W07 shell done (reason-for-access modal + rosters with the first PII views, P2.5/P2.7).

**Local evidence note:** port 3310 on this machine is held by an unrelated project's container (`minhaj-clamav`, not touched); local boot smoke and web-ops E2E ran on 3311 via `WAYVRO_OPS_PORT` / `WAYVRO_E2E_OPS_PORT`; CI uses 3310.

## P2.5 — Driver/vehicle compliance domain, requirement sets, age checks and restrictions

**IDs:** D01, D04, K06, K07, R02–R06, R46, V03, V13, V02/K01 (driver profile), A15 (driver age evaluation, `AGE_POLICY` restriction class).

| Area | Implementation |
|---|---|
| Migration | `0004_compliance_core`: `catalog.districts` (LHR-LAHORE), `catalog.service_categories` (CAR enabled; BIKE/RICKSHAW `DISABLED_LEGAL_GATE`); schema `compliance`: document types (11), requirement sets + items (placeholder **LHR/CAR v0**, `is_placeholder`, source "PHASE0_LAUNCH_BLOCKERS B2–B7, unconfirmed" — identity/licence/registration mandatory, Punjab artefacts OPTIONAL until EG-03/04), applications (+ category junction; one non-terminal per account), CNIC lookup index (non-unique, signals only), driver profiles (no gender column), vehicles (one live per plate), affiliations, compliance documents (subject bound by composite FK + CHECK), document-number lookup index, duplicate signals (CHECK per signal, `NULLS NOT DISTINCT` once-only), service capabilities; `profile.restrictions` (FK per subject + CHECK per scope, exactly one creator, `RISK_HOLD` system-only + auto-expiring + DRIVER_ROLE-only, `SECURITY_HOLD`/`AGE_POLICY` ACCOUNT-only, maker-checker lift CHECK) + append-only `restriction_events`; age-policy maker-checker columns + revised guard (DRAFT → PENDING_APPROVAL → APPROVED, values immutable) |
| Domain | `application-state.ts` (listed transitions only; only REVIEWER reaches VERIFIED; terminals absorbing), `eligibility.ts` (pure, live, exhaustive blockers; DRIVER-side restrictions never block rider use), `restrictions.ts` |
| Consumer API | `/v1/driver-onboarding/applications` (+ `/current`, `/{id}/claims`, `/consent`, `/requirements`, `/vehicles`, `/vehicles/{vehicleId}`, `/documents`, `/withdrawal`), `/v1/driver/compliance`; account state gains `driver` and `restrictions` sections; gates: `driver.onboarding` flag (ON local/test, OFF staging/production), policies, age declaration, no ACCOUNT restriction |
| Restricted sessions | consumer routes declare `restrictedOk`; with an in-force ACCOUNT restriction every other consumer route answers `403 WAYVRO_E_ACCOUNT_RESTRICTED` (+ reason codes) |
| Staff API | restrictions (list one subject / create / lift / lift-approval), requirement sets (list/get/draft/submit/approve/activate), age-policy data entry (list/draft/approve); new permissions in `roles.ts`; ABAC: city scope for driver-side subjects, KYC seniors only COMPLIANCE/QUALITY, ACCOUNT scope T&S-only, self/conflict refusal |
| Worker | restriction expiry (+ `EXPIRED` event), stale draft applications → `EXPIRED_DRAFT` (30 days, configurable) |
| web-ops | `/compliance` (requirement sets, age-policy data entry), `/restrictions` (one subject at a time); BFF allowlist now covers every declared `/v1/admin/*` route |

**Deviations (recorded for review):** consumer mutations use `POST …/claims` and `POST …/vehicles/{vehicleId}` with an `expectedVersion` body field instead of `PATCH` + `If-Match` (one idempotent mutation style across the API); document *claims* (number/class/dates) are recorded before evidence (evidence slots arrive with the vault, P2.6); CNIC/document lookup keys are written under the ACTIVE key and matched across live versions — a rotation engine for these non-unique, signal-only indexes is not built in Phase 2 (residual, documented).

**Evidence:** `apps/api/test/compliance-domain.test.ts` (10: PROP-SM, PROP-ELIG), `apps/api/test/compliance.integration.test.ts` (6: gates, lifecycle, encrypted claims, CNIC/plate/document signals, SEC-IDOR, SEC-MA, SEC-V13 incl. ACCOUNT restricted session and DRIVER_ROLE rider isolation, maker-checker lifts), `apps/api/test/compliance-admin.integration.test.ts` (2: requirement-set and age-policy maker-checker), AUTHZ-MATRIX now covers the new admin routes, `packages/db/test/compliance-core.integration.test.ts` (7).

**Status after P2.5:** D01/K07 signals + review hand-off ready (review in P2.7); D04/K06/R02–R06/R46 engineering for configuration and evaluation done, legal matrix EG-03/EG-04 open; V13 done for create/lift/effects (appeals P2.7); A15 driver evaluation in the evaluator (reviewer DOB confirmation P2.7; thresholds EG-23).

**Gate fixes made while closing P2.4/P2.5 (same checkpoint):**
- `loadConfig` now takes service-specific environment rules, so the staff-WebAuthn and trust-proxy production checks are reported together with the shared rules. Previously a schema refinement hid them, which surfaced as a boot-smoke failure.
- The boot smoke and artifact isolation supply a production-shaped synthetic WebAuthn relying party (`ops.wayvro.invalid`). The artefact route probe passes the new staff/compliance service slots.
- The P2.1 account-state key assertion now includes the additive `driver` and `restrictions` sections.
- New `apps/api/test/onboarding-rejections.integration.test.ts` (4 tests) covers every onboarding 400/404/409 path; API integration coverage was below threshold (89.8% statements / 78.3% branches) before it.
- The API integration hook timeout was raised to 120 s: per-suite throwaway databases now run five migrations, and under parallel suites setup exceeded the 10 s default.
- knip findings resolved: test-only exports are tagged `@internal`, unused ones un-exported, and `pg` declared for the E2E specs.

**Local gates for this checkpoint (Windows developer machine):**

| Gate | Result |
|---|---|
| Quality (format, build, lint, typecheck, depcruise, knip ×3, syncpack, flags, unit tests, coverage, phase0 coverage + manifest) | **PASS** |
| `openapi:check` | PASS once the regenerated document is staged (it diffs against the index) |
| Integration (clean migrate + re-run = 0 applied, all integration suites with coverage thresholds) | **PASS** |
| Boot smoke | **PASS** 27/27 (web-ops on 3311) |
| Artifact isolation | **PASS** 36/36 |
| Web E2E (Playwright + axe; web-public 11, web-ops 7) | **PASS** 18/18 |

gitleaks and osv-scanner were **NOT RUN locally** (no binaries on this machine); CI runs both.

## P2.3 — Mobile account slice in the ONE Wayvro app

**IDs:** Q01, A02, A03, A05, A04/K09 (consent UI), A15 (age declaration UI), A11 (security activity), V13 (rider-facing restriction notice). **ADR:** ADR-043.

| Area | Implementation |
|---|---|
| Structure | `src/app/` holds 14 thin expo-router route files. Screens are in `src/features/account/*`, with pure adapters next to them. The typed client `src/core/api/wayvro-client.ts` validates every response with the contract schemas |
| Session | `core/session`:<br>• `secure-token-store.ts` is the only expo-secure-store user;<br>• single-flight refresh, with the refresh idempotency key persisted before sending and reused after a restart;<br>• new tokens persisted before waiters are released;<br>• a refresh 401 means the session has expired;<br>• sign-out/expiry wipes tokens, intents, query cache and the sign-in flow, and keeps the installation id |
| HTTP | request ids, idempotency keys, bearer, 15 s timeout. Retries happen only for unknown outcomes with the same key (≤ 3) or a 503 asking for ≤ 10 s. Errors map to fixed UI kinds and server text is never shown |
| Routing by server truth | `core/account/account-route.ts` (pure) + `AccountGate`. Account state is re-fetched at start and on foreground. Priority: recovery/phone step-up, then policies, then age declaration. A `restricted` or `required-action` error from any call re-fetches the state |
| Screens | phone, OTP (autofill, server-clock resend countdown, invalid/locked/expired), policy acceptance (full text, placeholder label, exact hash, "policy changed" and partial-save handling), age declaration (form follows the server mode, no DOB in AFFIRM mode, no invented number), home (rider-affecting restriction notices, chosen by reason class), profile, devices (confirmations, step-up explanation), security activity, legal pages |
| i18n | en / ur / ur-Latn, 149 identical keys. Urdu is RTL. Urdu and Roman Urdu are marked "pending native review". Tests forbid NADRA, liveness, biometric, KYC, police and insurance claims and any age number |

**Evidence:**
- **Tests:** 18 mobile test files with 124 tests, all PASS. The architecture test enforces:
  - no AsyncStorage;
  - only one secure-store importer;
  - no `requireAuthentication`;
  - no `console`;
  - thin routes;
  - no location/camera/notification modules;
  - rider/driver isolation.
- **Bug caught by the tests:** a sign-out during a refresh could restore the old tokens. Fixed; the regression tests were confirmed to fail without the fix.
- **Static checks:** typecheck, ESLint, Prettier, dependency-cruiser and knip all PASS.
- **Android release build:** PASS. 16 KB alignment, ABIs (arm64-v8a + armeabi-v7a) and permission allowlist (unchanged) all PASS. AAB 31,683,900 bytes; download size ≈ 21.6–22.5 MB per ABI.
- **Debug APK:** built.

**Not run:**
- the slice against the live local API: unit tests use mocked fetch, which is not end-to-end evidence;
- component/renderer tests;
- any emulator or device run: no AVD or device on this machine, so startup time, Hermes behaviour and the runtime effect of the worklets/reanimated/gesture-handler autolinking exclusion are unverified (ADR-043 "Not verified").

**Deviations:**
- Test helpers live in `src/__mocks__/` (knip treats them as test files).
- Phone pre-check rules are duplicated client-side; `@wayvro/domain` is not a mobile dependency yet.
- Restriction copy is chosen by the enumerated reason class, and the free-form reason code is shown only as a reference.
- Appeals are shown as "not available in this app version" until P2.7/P2.8.

**Status after P2.3:**
- **Q01:** token storage done; device evidence NOT RUN.
- **A02/A03/A05/A11:** client side done; OTP delivery is EG-01.
- **A04/K09/A15:** client side done; texts are EG-02 and thresholds EG-23.
- **V13:** rider notice done; appeal UI comes with P2.7/P2.8.
