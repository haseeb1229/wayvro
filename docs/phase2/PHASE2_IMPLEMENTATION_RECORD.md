# PHASE2_IMPLEMENTATION_RECORD — Full Phase 2 implementation (P2.1 review fixes, P2.2 – P2.10)

**Branch:** `phase-2/identity-controlled-onboarding` from P2.1 `2666c8ba8627831dd2b40b2a7fa1b18aef65d809` (protected `main` = `8c8e528bf2a975f2fe385fd49ed9de78f29ed530`, unchanged). · **Authorisation:** founder authorised the whole Phase 2 engineering implementation in one run (2026-10-11); micro-phases P2.1–P2.10 are internal checkpoints. · **Status:** Phase-2 engineering implementation complete and passed the closure run; merged into `main` through the Phase 2 pull request with a normal merge commit (the PR records the merge SHA). External activation gates EG-01..EG-23 remain open. Phase 3 has not started. · **Agent:** Claude Code (self-audit, not independent verification). · Synthetic data only; external gates EG-01..EG-23 remain open unless stated otherwise with evidence.

The P2.1 record (`PHASE2_P2_1_IMPLEMENTATION_RECORD.md`) remains the record for P2.1; its §3a lists the review corrections.

## Checkpoint log

| Checkpoint | Commit | Summary |
|---|---|---|
| P2.1-fix | `9cfbc55` | RB-01 per-claim job lease tokens; RB-02 ledger-derived lookup plans + PostgreSQL advisory locks; DH-01/DH-02 deployment hardening (ADR-038, ADR-042) |
| P2.2 | `41dd03a` | policy registry, consent, age-eligibility mechanism, legal pages, Playwright + axe |
| P2.4 + P2.5 | `842c244` | staff realm: WebAuthn, BFF, RBAC/ABAC, maker-checker, offboarding, break-glass, audit viewer (ADR-039); driver/vehicle compliance domain, requirement sets, age-policy data entry, restrictions. Committed together because they share the API composition, contracts index, guard and web-ops shell, which were developed in one pass |
| P2.3 | `b35ad83` | mobile account slice in the ONE app (ADR-043); built in parallel by a delegated agent inside `apps/wayvro-mobile` only, reviewed and gated here |

| CI fixes | `d49a2ae`, `86bd13a` | osv runtime exception (decode-uri-component, expires 2026-12-31); Android job builds the workspace packages the app imports. **CI run 38097638550 on `86bd13a`: all five jobs green** (quality, integration, security, Android, web E2E) |
| P2.6 | `c42c2eb` | evidence vault, upload pipeline, isolated sanitiser, ClamAV, staff evidence views (ADR-041). **CI run 38101743619: all five jobs green** |
| P2.7 | `4dd5a39` | manual review, decisions, second approvals, appeals, expiry monitoring, outbox relay + first consumer, reviewer UI. **CI run 38124807942: all five jobs green** |
| P2.8 | `de2e578` | Driver/Partner onboarding in the ONE app (camera, controlled import, upload queue, checklist, status, compliance view), document renewal end to end, evidence discard crypto-shredding fix. **CI run 38132775729: all five jobs green** |
| P2.9 | `04defa6` | step-up, phone change, "this wasn't me", lost-phone recovery (strong proof only), dormant-number review, driver risk holds + re-verification, account deletion (app + web), incident playbooks |
| CI fixes | `0e3b9a9` | CI run 38137835484 on `04defa6`: ESLint ran out of heap on the runner (lint step heap raised; rules unchanged) and a P2.6 sanitiser test caught a real cleanup race (bounded reaper added) |
| P2.10 | `ffdecb7` | Google/Apple OIDC linking: jose verifier, nonces, linked sign-in with PHONE_STEP_UP, link/unlink, linked-identity recovery, flags ON only in the test environment |

| Closure | (closure commits) | support capabilities of the accepted staff matrix, per-district claims in the app (R46), appeal of a rejected renewal, CAMERA approval recorded, ruleset checks corrected — see "Phase-2 closure" |

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

**Correction (after commit `b35ad83`):** the line above originally said gitleaks/osv were not run locally; the binaries exist at `C:Dev	oolsscanners`. Run against `b35ad83`:
- gitleaks: no leaks (19 commits).
- osv-scanner: **1 new Medium**, GHSA-vcc3-ghjq-m6fr (decode-uri-component 0.2.2 via query-string 7.1.3, pinned by expo-router 57.0.25). It entered with P2.3.
  - It is recorded as a time-boxed **runtime** exception in `osv-scanner.toml` (expires 2026-12-31).
  - The fixed 0.5.0 is ESM-only and incompatible with query-string 7.
  - It is unreachable from external input while no URL scheme or deep link is registered.
  - **Gate:** re-check before deep links are wired.

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

## P2.6 — Evidence vault and upload pipeline (started with the image-processing evaluation)

**IDs:** K11, Q08, K02 (backend), K03 (optional challenge backend), D02, D03, K07 (evidence signals), Q36, Q44 (inventory), Q45 (DPIA input pack). **ADR:** ADR-041 (Step-0 evaluation recorded before any sanitiser code).

| Area | Implementation |
|---|---|
| Step 0 | `sharp` 0.35.5 / libvips 8.18.7 evaluated on synthetic inputs: EXIF/GPS/ICC/XMP and PNG text chunks absent (independent reader); bomb refused by the pixel cap in 2 ms; truncated, disguised, SVG, PDF, WebP, TIFF and AVIF refused; polyglot payload absent; blocked loaders refuse at library level; deterministic; libjpeg-turbo q88 ≤ 2560 px chosen (about 0.6 s vs 12–17 s for mozjpeg on 12 MP). No custom parser |
| Sanitiser | `packages/image-sanitiser` (sharp only), run as ONE hardened container per image: `infra/sanitiser/Dockerfile`, Node 24.20 slim pinned by digest, `npm ci --ignore-scripts` from a committed lockfile, uid 65532. Runner flags: `--network none --read-only --cap-drop ALL no-new-privileges --memory/--cpus/--pids-limit`, tmpfs, `--pull never`, no env/volumes, plus a wall clock. Built by `scripts/sanitiser-image.mjs` from a minimal context. The Docker-CLI runner is refused in staging/production (production hosting is P2.A4) |
| Adapters | `packages/vault-adapters`:<br>• S3 (AWS SDK v3 3.1141.0, `WHEN_REQUIRED` checksums, area-aware, upload presign for quarantine only with content type and length signed, ≤ 300 s);<br>• clamd INSTREAM;<br>• Docker sanitiser runner |
| Scanner | compose service `clamav` 1.4.6 LTS pinned by digest on 127.0.0.1:23310. CI uses the signatures bundled in the image (`WAYVRO_CLAMAV_NO_FRESHCLAM=true`) |
| Migration | `0005_vault`:<br>• role `wayvro_vault`; schema `vault` with `evidence_objects` (status/key/selfie-source/AVAILABLE-facts CHECKs), `evidence_view_tokens` (SHA-256, ≤ 60 s), append-only `evidence_access_log`;<br>• `compliance.capture_challenges` (one live per application);<br>• `duplicate_signals` gains `EVIDENCE_HASH_MATCH` with evidence FKs;<br>• **the API and worker roles have no `vault.*` grant** |
| Crypto | per-object DEK (envelope v1) wrapped by the new key class `evidence_kek`; AAD bound to the object id; KEK rotation re-wraps only |
| API | consumer routes:<br>• evidence-upload slot (consent first; selfie camera-only; challenge only with a selfie; kind must belong to the claimed document; ≤ 40 per application; ≤ 10 slots per account per 10 min);<br>• list, completion (HEAD size check, then a job in the same vault transaction), discard (editable applications only; storage deleted);<br>• capture challenge issue/replace/decline-neutral;<br>• **submission** (itemised `MISSING_DOCUMENT_*` / `MISSING_EVIDENCE_*` / `EVIDENCE_PROCESSING`, pinned requirement set).<br>Staff: `POST /v1/admin/evidence-views` (permission `vault.evidence.view`, step-up, reason catalogue, city scope, conflict-of-interest block) and `GET …/{token}/content` (one-time, session-bound, AEAD + SHA-256 verified, no-store/inline/sandbox headers; replay 410 `WAYVRO_E_GONE`). New flag `ops.kyc-real-evidence` (OFF everywhere; real evidence also needs two authenticators). The vault module owns a separate `wayvro_vault` pool (`DATABASE_VAULT_URL`); dependency-cruiser forbids other modules importing `src/vault/**` |
| Worker | `evidence.process` (scan → isolated sanitise → hash → encrypt → vault → AVAILABLE via CAS, plus `EVIDENCE_HASH_MATCH` for exact replays on other applications; scanner or sanitiser unavailable ⇒ retry, never clean); `evidence.orphans` daily, dry run by default (expired slots, quarantine leftovers older than 24 h, unreferenced vault objects older than 1 h) |
| web-ops BFF | the image content route passes bytes through untouched with no-store/inline/sandbox headers. The reviewer UI and reason-for-access modal arrive with P2.7 |
| Docs | ADR-041 accepted; `docs/phase2/PHASE2_DPIA_INPUT_PACK.md` (Q45 inputs, Q44 data-location inventory — engineering input only) |

**Deviations (recorded for review):**
- **Document link:** evidence links to its document through a FK on `vault.evidence_objects` (exactly one document per object), so the `compliance.document_evidence` junction of the data model is not created.
- **Case scoping:** evidence views are scoped by city and conflict only until review cases exist (case-claim scoping, T&S limited to recovery/duplicate cases, auditor access-log viewer and per-view watermark arrive in P2.7).
- **Submission state:** it stops at `SUBMITTED`; review-case creation and `AUTO_CHECK_PENDING → MANUAL_REVIEW` arrive in P2.7.
- **Upload URL storage:** the upload URL (which embeds the quarantine key) is part of the idempotent slot response and is therefore stored encrypted in `platform.idempotency_records` for replay, for at most the idempotency TTL. It is a 5-minute, single-object, upload-only URL; no other storage key is stored outside `vault`.
- **Lock mode:** onboarding row locks now use `FOR NO KEY UPDATE`. The API transaction and the vault connection touch the same application row (FK key-share check); `FOR UPDATE` made that an undetectable cross-connection deadlock, which the first test run found.

**Evidence:**

| Suite | Result |
|---|---|
| `packages/image-sanitiser/src/sanitise.test.ts` (in-process SEC-FILE) | 14 PASS |
| `packages/vault-adapters/src/protocol.test.ts` (clamd framing/timeouts, frame decoding, outcome mapping, hardened container flags) | 7 PASS |
| `packages/vault-adapters/test/adapters.integration.test.ts` (SeaweedFS, SEC-URL type/length/key/expiry/cap all enforced by the signature, no checksum params; ClamAV EICAR; real container: clean re-encode without metadata, disguised/bomb/truncated refused, timeout kill with no leftover container, missing image/CLI = unavailable) | 8 PASS |
| `packages/field-crypto` evidence DEK tests | 3 new, 18 total PASS |
| `packages/db/test/vault.integration.test.ts` (constraints, append-only log, grants as restricted roles) | 7 PASS |
| `apps/api/test/evidence.integration.test.ts` (slot → PUT → completion → job; SEC-VAULT; slot rules; size mismatch; expiry; rate limit; discard; challenges; submission; staff views incl. step-up, permission, reason catalogue, city scope, conflict, one-time token, 410 replay, integrity failure, access log + audit) | 8 PASS |
| `apps/worker/test/evidence.integration.test.ts` (end to end with real ClamAV, SeaweedFS and the container: AVAILABLE + decrypt + metadata absent; EICAR/PDF/bomb rejected; scanner or sanitiser unavailable ⇒ UPLOADED; hash-match signals; discarded not processed; orphans dry run then delete; SEC-LOG) | 7 PASS |

**Not run / external:**
- production storage, KMS, scanner and sanitiser hosting (P2.A4 / EG-05);
- real KYC evidence (never in Phase 2);
- the DPIA itself (EG-10, prepared inputs only);
- an independent assessment of the sanitiser boundary (EG-17).

## P2.7 — Manual review, decisions, appeals and expiry monitoring

**IDs:** H02, K05, K04 (manual), K07, D03, D04, V13 (appeals), H08 (privileged confirmation), W07 (reason-for-access viewer, paginated scoped rosters — no export), R02–R06/R46 (checklist items), A15 (reviewer DOB/licence check).

| Area | Implementation |
|---|---|
| Migration | `0006_review_appeals`:<br>• `compliance.review_cases` (explicit subject FKs + CHECK per kind; one open case per application; claim ⇔ lease);<br>• append-only `review_decisions` (checklist jsonb + schema version, reason codes, human identity assessment required for APPROVE);<br>• `review_second_approvals` (composite FK binds the decider; approver ≠ decider);<br>• `review_decision_evidence`;<br>• `profile.appeals` (exactly one subject, encrypted statement, one open appeal per subject) + `appeal_evidence`;<br>• `service_capabilities.granted_by_decision_id` (NOT VALID CHECK: every new grant names its decision);<br>• `platform.outbox_events` + `platform.processed_events`;<br>• column-level grants (vault reads only case-assignment facts) |
| Review | queue (city-scoped, cursor-paginated, escalations visible to seniors only), claim = 30-minute renewable lease, release, masked case view. The claims are shown for comparison: name, DOB, CNIC last 4. The case view also shows the age check against the APPROVED policy only, evidence metadata (images only through the view flow), signals, decisions and the appeal statement |
| Decisions | APPROVE / NEEDS_INFO / REJECT / ESCALATE / REQUIRE_IN_PERSON:<br>• rules: claim + step-up + decision-specific permission + code-defined reason catalogue + checklist v1 (APPROVE needs every item CONFIRMED/N.A. and `CONFIRMED_BY_REVIEWER`) + evidence relied on (must be the application's ACCEPTED evidence);<br>• **duplicate signals:** a KYC reviewer cannot approve; a senior must clear every open signal, and a different senior second-approves (DB-enforced);<br>• **APPROVE effects (one transaction):** driver profile from the confirmed claims (re-encrypted under profile field contexts), documents VALID (claimed dates → confirmed), affiliations ACTIVE, capabilities GRANTED by the decision, signals cleared, outbox `driver.application.decided.v1` + `driver.approved.v1`;<br>• NEEDS_INFO → itemised reasons → resubmission → RESUBMISSION case |
| Appeals | `POST/GET /v1/account/appeals` (restricted-ok). Decision appeals are decided by a KYC senior who is neither the original decider nor the second approver; restriction appeals by T&S who is not the creator; conflict-of-interest blocked. OVERTURNED → APPEAL case (fresh human review) or restriction LIFTED (+ event); UPHELD → REJECTED_FINAL |
| Evidence views | case-claim scoping closed (P2.6 deferral): KYC reviewer only on a case they hold, senior in scope, T&S only where an open duplicate signal involves the application; break-glass bypasses but is tagged |
| Monitoring | expiry roster (`compliance.expiry_roster.view`, scoped, masked, paginated, no download); auditor evidence-access log (`audit.evidence_access.view`) |
| Worker | `driver-application.intake`: SUBMITTED → AUTO_CHECK_PENDING → MANUAL_REVIEW + case; signals raise priority only, never a decision. Also:<br>• `compliance.document-expiry` (daily; a mandatory document expiring moves the profile to EXPIRED);<br>• review-lease expiry;<br>• restriction expiry emits `restriction.changed.v1`;<br>• **outbox relay started** with its first consumer `account-state-hint.v1` (idempotent per event, dead-letter after the attempt budget, alerted). This removes the Phase 1 knip production exception |
| Realtime | subscribes to the internal hint channel and emits `account.state-changed.v1` (no data; `resync: fetch-snapshot`) to that account's own sockets, locally per gateway (no duplicate fan-out) |
| web-ops | review queue, case view, reason-for-access dialog. The one-time image is fetched once as a blob and drawn on a canvas with the watermark burned in (no `<img>` URL, no download control; screenshots are stated as not preventable). Also: decision form (catalogue + checklist + identity assessment + evidence relied on + signal outcomes), second approval, appeals, expiry roster, auditor access-log table, permission-scoped navigation |

**Deviations (recorded for review):**
- **Approval with open signals:** this is an APPROVE awaiting a second approver: the case moves to ESCALATED (visible to seniors) rather than a separate status.
- **In-person routing:** REQUIRE_IN_PERSON keeps the case OPEN with `in_person_required` (the operations process is EG-20).
- **Restriction appeals:** a restriction appeal OVERTURNED by T&S lifts even a SAFETY/FRAUD restriction without a further maker-checker step, because the appeal decider is by construction a different person from the creator.
- **Restriction CHECK:** no change to `profile.restrictions` was needed.

**Evidence:**

| Suite | Result |
|---|---|
| `packages/db/test/review-appeals.integration.test.ts` | 7 PASS |
| `apps/api/test/review.integration.test.ts` (queue/claims/leases/scoped evidence views; catalogue/checklist/identity/evidence validation; NEEDS_INFO → resubmission; APPROVE effects + SEC-SELFIE invariant; duplicate signals + maker-checker; decision and restriction appeals; roster; access log) | 7 PASS |
| `apps/api/test/review-rejections.integration.test.ts` (refusal paths, cursors, routing) | 5 PASS |
| AUTHZ-MATRIX | now covers every new admin route × 7 roles; the harness runs with the vault so evidence routes answer for real |
| `apps/worker/test/review.integration.test.ts` (intake, leases, expiry, restriction event, relay → Valkey hint once, redelivery deduplicated, dead letter) | 3 PASS |
| `apps/realtime/test/fanout.integration.test.ts` (hint reaches only that account, exactly once across gateways; malformed dropped) | PASS |
| web-ops Playwright reviewer journey (enrol, scoped nav, claim, masked case, reason dialog → one-time canvas view with watermark, replay 410, NEEDS_INFO decision, case leaves queue; axe) | 4 PASS; whole web E2E 22/22 |

**Not run / external:**
- real reviewers and the in-person centre (EG-20);
- two-reviewer calibration sampling (operations process, proposal only);
- push notifications for decisions (Phase 4; the realtime hint covers connected apps).

## P2.8 — Driver/Partner onboarding in the ONE app, and document renewal

**IDs:** V03, V01, D01–D04 (UI), K02/K03 (capture), K05/K14 (explanations, dispute, correction), Q01 (capture cleanup); renewal end to end for D03/R02–R06 (backend completing P2.7's DOCUMENT_RENEWAL case kind).

The mobile slice was built in parallel by a delegated agent inside `apps/wayvro-mobile/**` and `infra/ci/android/permission-allowlist.json` only, then reviewed and gated here. The renewal backend, the contract additions and the reviewer UI change were built here.

| Area | Implementation |
|---|---|
| Entry and lazy loading | "Earn with Wayvro" only when the server reports `onboardingAvailable`; a verified driver always sees the Driver/Partner entry. Every driver screen is a dynamic import; camera, picker and file-system code lives only under `src/features/driver/` (architecture test). Core reaches the driver module only through a dynamic import in the sign-out wipe |
| Flow | K14 explanation first → DRIVER_PARTNER_AGREEMENT and BIOMETRIC_KYC_NOTICE through the existing policy screen (driver scope) → consent → claims (name, CNIC format check on device only, DOB, vehicle, document claims; `expectedVersion` + intent-based idempotency keys) → checklist (placeholder set labelled) → submission (refusals listed item by item) → status screens for every application state and decision, appeal form, in-person-pending status |
| Capture | camera permission only after the user taps "Allow camera" on the capture screen; selfie front camera only, no import; optional accessible challenge with neutral "I can't do this one" / "None of these work for me"; camera denied → documents through the system Photo Picker (no media permission), selfie → in-person explanation (marked not available yet). Type checked from the first bytes (JPEG/PNG), > 10 MB refused; no on-device re-encode (no image-manipulation dependency) |
| Upload queue | pure state machine, bounded retry/backoff and processing polls; signed URL in memory only (after a restart the item asks the server before requesting a new slot); queue metadata — never bytes or URLs — in secure storage; direct PUT with exactly the signed headers and no auth header; one private cache folder, files deleted on server confirmation, discard, application close/withdrawal, sign-out/expiry and by an orphan sweep at start |
| Compliance view | blockers in plain words, documents with expiry and renewal state, restrictions with appeal where allowed |
| Renewal (backend) | `POST /v1/driver/documents/{documentId}/renewals` creates a NEW document row (`supersedes_id` → the renewed one) for a VALID or EXPIRED expiring document of a verified driver; one open renewal per document; new numbers are indexed and raise DOCUMENT_NUMBER_MATCH signals. Evidence goes through the normal upload slots of the verified application. `POST …/{renewalDocumentId}/renewal-submission` requires every evidence kind ACCEPTED (409 `MISSING_EVIDENCE_<KIND>` / `EVIDENCE_PROCESSING`) and opens a `DOCUMENT_RENEWAL` case. The compliance view attaches the renewal (`DRAFT`/`IN_REVIEW`/`REJECTED` + evidence kinds) to the document it renews |
| Renewal (review) | the case resolves its application through the driver profile; APPROVE must rely on evidence of the renewal itself and makes it VALID with the reviewer-confirmed dates, the renewed document SUPERSEDED, and an EXPIRED profile ACTIVE_ELIGIBLE (VERIFIED without a granted capability) once no mandatory document is still expired. NEEDS_INFO/REJECT close the renewal as REJECTED and leave the renewed document untouched; a new renewal may follow. Duplicate signals on the new number follow the senior + second-approver rule. Outbox `driver.document.decided.v1`. web-ops marks the document under review |
| Evidence views | KYC-reviewer case scoping now asks the review module (`holdsLiveClaim`, every case kind including renewals) instead of a vault-pool query, so no grant change was needed |
| Contracts (additive) | `DocumentRenewalRequest`/`DocumentRenewal`, two routes; `ReviewCaseDetail.subjectDocumentId`; `RequirementChecklist.items[].hasNumber/hasExpiry`; `DriverCompliance.applicationId`, `documents[].hasNumber/hasExpiry/renewal`. The app derives claim fields from these (the only presentational exception: the CNIC number lives in "Your details"); it no longer mirrors the server's document catalogue |
| Copy | about 360 driver strings in en, ur and ur-Latn with identical keys (Urdu pending native review). Tests forbid NADRA, liveness, biometric, KYC, "verified identity", "approved automatically", gender and age-like numbers |
| Dependencies / Android | expo-camera 57.0.6, expo-image-picker 57.0.20, expo-file-system 57.0.7 (declared); barcode scanning compiled out; CAMERA allowlisted (K02/K03/V03), media permissions blocked and forbidden — details and measurements in ADR-043 §P2.8 |

**Fixes and changes to earlier checkpoints (found here):**
- **Evidence discard of an ACCEPTED object returned 500 (P2.6 bug):** the `AVAILABLE ⇔ sealed facts` CHECK made it impossible. A discard now also destroys the wrapped DEK (crypto-shredding), so the object is unreadable even before its storage deletion. Regression test in `renewal.integration.test.ts`.
- **Duplicate signals per case (P2.7 behaviour change):** a case's signals now include DOCUMENT_NUMBER_MATCH signals on the application's live documents (and, for a renewal, on the renewed number), not only application-level signals. An approval with such a signal now needs the senior + second-approver path; before, it was ignored.
- `failure()` is typed as a `Refusal` (subtype of `Outcome`) so helpers can return a refusal or their own result; no behaviour change.

**Deviations / limitations (recorded for review):**
- ~~**Renewal rejections are not appealable**~~ — **closed in the Phase-2 closure** (see "Phase-2 closure" below): a REJECT of a renewal is appealable; NEEDS_INFO still means starting a new renewal.
- **Restriction appeals in the app** are reachable from the Driver/Partner screens only; the rider home still says appeals can't be submitted in this version (accurate there). A rider-side entry is an open item for P2.9 hardening (V13).
- ~~**Per-district documents** cannot be claimed from the app~~ — **closed in the Phase-2 closure**: the checklist carries the server district list.
- **Unused vault grant:** `wayvro_vault` still has SELECT on review-case assignment columns that no code reads any more; to be revoked in migration 0007 (P2.9).
- **CAMERA allowlist change:** **APPROVED by founder/ChatGPT review (Phase-2 closure, 2026-10-11)**; recorded in ADR-043.

**Evidence (local gates on the P2.8 tree):**

| Suite | Result |
|---|---|
| `apps/api/test/renewal.integration.test.ts` (start/validation/one open renewal; evidence required; discard of an ACCEPTED object crypto-shredded; submission → DOCUMENT_RENEWAL case; reviewer evidence view through the claimed renewal case; APPROVE needs renewal evidence, supersedes, lifts EXPIRED; REJECT → restart; duplicate number → senior + second approver) | 4 PASS |
| API integration suite (all files, coverage thresholds) | 17 files, 144 PASS |
| Integration gate (throwaway DB, migrate twice — second run 0 applied, every package's integration suite, boot smoke) | PASS |
| Quality gate (format, build, lint, typecheck, depcruise, knip, syncpack, flags, unit tests, coverage, openapi check, phase0 coverage, manifest) | PASS (openapi check after staging the regenerated spec; manifest after regeneration) |
| Mobile: typecheck, unit tests, ESLint `--max-warnings=0`, Prettier, depcruise, knip | PASS; 28 files, 211 tests (P2.3: 18 files, 124) |
| Android release build (`scripts/android-build.mjs release`, delegated agent) | BUILD SUCCESSFUL; 16 KB PASS, ABIs arm64-v8a + armeabi-v7a, permission gate PASS (CAMERA, INTERNET, AndroidX dynamic receiver). Run before the final field-hint follow-up (JS only, no native change); CI rebuilds it |
| Artifact isolation (`--negative-controls`) | 39/39 PASS |
| Web E2E (web-public + web-ops, `WAYVRO_E2E_OPS=1`) | 22/22 PASS |
| gitleaks (history + staged changes) / osv-scanner | no leaks / no issues (documented exceptions only) |

**Not run / external:**
- **No device or emulator:** camera and permission prompts, the Photo Picker, the PUT upload, file deletion, lazy route loading at runtime, RTL, dynamic type, screen readers — all NOT RUN; no iOS build; no cross-mode regression on a device.
- No end-to-end run of the app against the real API and vault.
- Urdu and Roman-Urdu copy pending native review; real reviewers and the in-person route (EG-20).

## P2.9 — Recovery, phone change, SIM safeguards, risk holds, deletion and hardening

**IDs:** A05, A11 (notices), K08 (SIM-swap heuristics), K17, S12, S13, U06, K11 (evidence deletion), K13 (adversarial suite completion), V07 (full suite), Q06 (playbooks).

Built here: migration 0007, the API, the worker jobs and the docs. Delegated agents built the mobile account-security screens (inside `apps/wayvro-mobile/**` only), plus the web-public deletion page and the web-ops case additions (inside `apps/web-public/**`, `apps/web-ops/**` and `tests/e2e-web/**` only). Both were reviewed and gated here.

| Area | Implementation |
|---|---|
| Migration | `0007_recovery_deletion`:<br>• widened CHECKs: account `DELETION_PENDING`/`DELETED` (tombstone: `deleted_at`, no display name); phone `RELEASED` with reason/time; number erased only for `ACCOUNT_DELETED`; OTP purposes `STEP_UP`/`PHONE_CHANGE_NEW` (bound to a session) and `ACCOUNT_DELETION_WEB`; session `step_up_at` + new revoke reasons; new security event types;<br>• `identity.phone_change_requests` (one open per account; kind binds its proof; numbers erasable only once closed);<br>• `identity.dormant_number_reviews` (one open per session);<br>• `identity.account_deletion_requests` + `deletion_request_blockers` (one open blocker per code) + `deletion_retention_exceptions`;<br>• review-case kinds `ACCOUNT_RECOVERY` (driver profile + exactly one of the two recovery subjects) and `REVERIFICATION` (one open per profile);<br>• least-privilege grants; the vault's unused review-case column grant revoked |
| Step-up | `POST /v1/account/step-ups` → code to the CURRENT phone, bound to the session → 10 minutes. Required for a phone change and for deletion, and accepted for revoke-all from a young session. `AccountState.session.stepUpExpiresAt` |
| Phone change | Stepped-up session → code to the NEW number (session-bound) → old phone RELEASED, new one current, other sessions revoked, security events, outbox. A number current on another account fails with the same generic 409 as any conflict (no merge, nothing recorded). **SIM-swap pattern:** a device first verified within 24 h, on an account that has older devices, waits 24 h (`NEW_DEVICE_COOLDOWN` + `retryAfterSeconds`) |
| "This wasn't me" | `GET /v1/account/phone-changes/current` + cancellation, both restricted-ok, from any session of the account (also for recoveries in cooldown) |
| Lost-phone recovery | Strong proof only, from the new number's session. `DRIVER_KYC` opens a `RECOVERY_DRIVER_KYC` request + `ACCOUNT_RECOVERY` case when the caller is a clean account and the lost number belongs to a driver account. APPROVE needs a prior REQUIRE_IN_PERSON and ALWAYS a second senior approver, then a 72 h COOLDOWN in which the owner can cancel; the worker then moves the number and signs both accounts out everywhere. `LINKED_OIDC` arrives with P2.10. The caller always sees `RECEIVED`. Rider-only accounts cannot be moved (new-account guidance) |
| Dormant-number review (S12) | A sign-in on a dormant account (`ACCOUNT_DORMANCY_RISK_DAYS`, provisional 90) from an unknown installation gets a RESTRICTED session. Every route except the review and sign-out answers `WAYVRO_E_RECOVERY_REQUIRED` and exposes nothing. Dormancy and "unknown installation" persist while the review is open, so a second sign-in cannot bypass it.<br>• **I_AM_NEW:** number RELEASED (`RECYCLED_NUMBER_NEW_OWNER`), old account appealable `SECURITY_HOLD` + every session revoked, a clean new account on the same installation;<br>• **THIS_IS_MY_ACCOUNT:** driver accounts only, through an `ACCOUNT_RECOVERY` case (same in-person + second-approver rules) |
| Risk policy (founder Q-14) | Triggers wired: a driver's phone change (`RISK_PHONE_CHANGED`) and device velocity (≥ 3 new installations in 7 days, `RISK_DEVICE_VELOCITY`). Effect: a system-created, reason-coded, appealable DRIVER_ROLE `RISK_HOLD` (72 h, auto-expiring) + one REVERIFICATION case. Rider mode is unaffected. Reviewer APPROVE lifts the hold; REJECT adds an appealable `REVERIFICATION_FAILED` restriction; NEEDS_INFO does not apply |
| Deletion (U06) | **App:** fresh step-up → `GRACE` (`ACCOUNT_DELETION_GRACE_DAYS`, 14 proposed, pending counsel) or `BLOCKED` with explicit blockers (`LEGAL_HOLD`, `RECOVERY_IN_PROGRESS`, `OPEN_SAFETY_OR_FRAUD_INVESTIGATION`). The account becomes `DELETION_PENDING` (restricted session; cancel within grace). Retention exceptions list what is kept and why (placeholder bases, EG-16).<br>**Web:** `/account-deletion` on web-public → same-origin route handlers → the public API routes. Identical answers whether or not an account exists (no SMS to a number without an account; SUPPRESSED challenge); per-IP limit<br>**Worker `identity.deletion-processing`:** re-evaluates blockers incl. evidence legal holds; due requests: evidence crypto-shredded and deleted from storage (K11), numbers erased, lookups deleted, sessions revoked, open applications/cases/appeals closed, account tombstoned. Registered only with the vault and storage bound |
| Worker `identity.recovery-completion` | Completes due cooldowns (or lapses them when the number is no longer the requester's). Expires stale recoveries and cancels their cases |
| Identity core | Shared OTP verification for every purpose (one code path, purpose + binding checked, generic refusals); phone release / session revocation and deletion blockers/retention shared by the API and the worker; key rotation skips erased envelopes and covers the change-request number |
| Mobile (agent) | Step-up panel (confirm before one retry with a new key); phone change; "this wasn't me" notice; dormant-number review screen (`switchAccount` replaces tokens and wipes local data); lost-phone recovery; deletion screens + `DELETION_PENDING` banner; rider-side restriction appeal (V13, closing the P2.8 open item). Copy tests forbid disclosure wording |
| web-ops (agent) | Case-kind labels; recovery section with the in-person + second-approver note; risk-trigger labels |
| Q06 | `docs/operations/incident-playbooks.md`: OTP pumping, consumer and staff compromise, evidence exposure (U09 counsel-dependent), provider outages, key-rotation emergency, recycled-number takeover. Each playbook marks what is not built or is externally gated. Not rehearsed (Phase 7 drills) |

**Deviations / decisions (recorded for review):**
- **New table `identity.dormant_number_reviews`** (not in the data model): the dormant-number review needs a subject for its state and for the `ACCOUNT_RECOVERY` case. Additive.
- **Recovery answers `RECEIVED` for everyone** instead of `WAYVRO_E_RECOVERY_REQUIRED` for rider-only accounts (API doc §2): this prevents the endpoint from revealing which numbers belong to driver accounts. The new-account guidance is shown to everyone.
- **Recovery approval needs REQUIRE_IN_PERSON first:** a fresh guided capture compared against vault evidence is **not built** (it needs vault support for recovery evidence and the DPIA, EG-10). Until then the in-person identity check is the strong proof. The in-person process itself is EG-20.
- **A recovered number triggers no RISK_HOLD:** the in-person check plus a second approver already re-verified the person.
- **Deletion closes open driver work:** non-terminal applications become WITHDRAWN and open cases CANCELLED (system action on the owner's request). Review decisions and reason codes are kept as retention exceptions.
- **Unused states not created:** the phone-change kinds/states and the deletion `REQUESTED` state that nothing produces were left out (P2.10 adds the OIDC kind additively).
- **Suppression reason `NO_ACCOUNT`** (audit only) for the web deletion path.
- **Not built:** push/SMS security notices (Phase 4 / EG-01). The staff on-behalf session revocation and the support summary were **built in the Phase-2 closure**.

**Evidence (local gates on the P2.9 tree):**

| Suite | Result |
|---|---|
| `packages/db/test/recovery-deletion.integration.test.ts` (widened CHECKs, one open request/review/deletion, erasure rules, per-kind case subjects, grants incl. the revoked vault grant) | 6 PASS; db suite 67 PASS (identity-core inventory/grant assertions updated for 0007) |
| `packages/identity-core/test/account-lifecycle.integration.test.ts` (phone release, session revocation, deletion blockers incl. expired restrictions, retention exceptions) | 4 PASS; identity-core 23 PASS |
| `apps/api/test/account-security.integration.test.ts` (step-up binding; phone change; generic conflict; new-device cooldown; "this wasn't me"; driver RISK_HOLD + REVERIFICATION; DRIVER_KYC recovery with in-person + second senior + cooldown; dormant-number review incl. re-sign-in bypass attempt and I_AM_NEW; dormant driver claim; deletion app/blocked/web) | 11 PASS |
| `apps/api/test/account-security-rejections.integration.test.ts` (purpose/session-bound codes, stale requests, foreign ids, recovery attempt limit and non-clean callers, recovery REJECT and rejected second approval, re-verification REJECT, deletion/review refusals, browser-bound web codes) | 6 PASS |
| API integration suite (all files, coverage thresholds) | 161 PASS (statements 91.2 %, branches 81.0 %) |
| `apps/worker/test/account-jobs.integration.test.ts` (number moved after cooldown, both accounts signed out; lapse; stale expiry; blockers incl. vault legal hold; evidence crypto-shredded + storage deleted; tombstone) | 4 PASS; worker 37 PASS |
| Integration gate (fresh DB, migrate twice — second run 0 applied, every package's integration suite, boot smoke) | PASS |
| Quality gate (format, build, lint, typecheck, depcruise, knip, syncpack, flags, unit tests, coverage, openapi, phase0 coverage, manifest) | PASS |
| Mobile (delegated agent): typecheck, unit tests, ESLint, Prettier, depcruise, knip | PASS; 31 files, 235 tests |
| Artifact isolation (`--negative-controls`) | 39/39 PASS |
| Web E2E (web-public incl. 7 deletion-page tests + web-ops) | 29/29 PASS |
| gitleaks (staged) / osv-scanner | no leaks (one false positive, a synthetic idempotency key in a spec, removed by generating it) / no issues |

**Not run / external:**
- No device or emulator for the new mobile screens. The Android release build was not re-run locally: no native or dependency change; CI builds it.
- The web deletion page's code step, 429 and confirmation have not run against a live API in E2E (covered by the API tests).
- The real SMS channel (EG-01); operator recycling data and SIM-swap signals (EG-22); the in-person identity process (EG-20); retention periods and lawful bases (EG-16); breach steps (U09).
- The playbooks have not been rehearsed (Phase 7).

## P2.10 — Google/Apple OIDC linking (flag-gated)

**IDs:** K15 (Google), K16 (Apple), S13 (link collisions, no merge), A05 (recovery with a linked identity). Production stays EXTERNAL_GATED: EG-06/EG-07, activation P2.A2/P2.A3.

| Area | Implementation |
|---|---|
| Migration | `0008_oidc`:<br>• `identity.oidc_nonces` (SHA-256 only; sign-in nonces bound to an installation, link/recovery nonces to a session; 5 min);<br>• `identity.oidc_identities` (provider + opaque subject only; one LINKED owner per subject, one LINKED identity per account and provider; subject erasable once UNLINKED);<br>• session assurance `OIDC` + `phone_step_up_required`;<br>• phone-change kind `RECOVERY_OIDC_PROOF` with its proof column (cooldown-only states);<br>• OIDC security events;<br>• least-privilege grants |
| Verifier | `jose` 6.2.12 (ADR-040): RS256 only, provider JWKS through the new `OidcKeysPort`, issuer, configured client IDs (`OIDC_*_AUDIENCES`), 60 s skew, token age ≤ 10 min, required claims, and a nonce match (Google raw, Apple SHA-256 hex; constant-time). A nonce is spent by every attempt |
| Sign-in | `POST /v1/auth/oidc-nonces` → `POST /v1/auth/oidc-sessions`. Only for a LINKED identity; never account creation; one generic 401. An installation that never signed in with a phone OTP gets `PHONE_STEP_UP`: the guard answers `WAYVRO_E_STEP_UP_REQUIRED` on every non-restricted route until the session steps up |
| Link / unlink | `POST /v1/account/oidc-nonces` (LINK/RECOVERY), `GET/POST /v1/account/oidc-links`, `DELETE …/{id}`. Fresh phone step-up required. A subject linked elsewhere → generic 409 `WAYVRO_E_OIDC_LINK_CONFLICT`, audited as a T&S signal; one identity per provider and account |
| Recovery | `proof: LINKED_OIDC` + a RECOVERY-nonce token of the new number's session: when the identity is linked to the account that owns the lost number, the request goes straight to the 72 h COOLDOWN with notices, and the worker completes it. An invalid token → 400; any mismatch → `RECEIVED`, nothing opened |
| Worker | recovery completion covers both recovery kinds; deletion unlinks identities and erases their subject; maintenance purges nonces older than a day |
| Flags | `platform.auth-oidc-google` / `platform.auth-oidc-apple`: ON only in the automated `test` environment (local issuer double), OFF in local/staging/production. No key source or client IDs → 503 |
| Test double | `LocalOidcIssuer` (provider-test-doubles, dev-only, MOCK brand): RS256 keys published as JWKS; mints tokens incl. forged-key, wrong-issuer/audience and expired variants |
| Mobile | `PHONE_STEP_UP` now uses the step-up panel (the "not available" screen is gone); error codes mapped (an OIDC 401 is not an expired session); OIDC security events labelled. No native Google/Apple SDK (activation) |

**Deviations / decisions (recorded for review):**
- **No e-mail, relay flag or name stored** (data model §3.1 lists `email_envelope`, `email_verified_at_link`, `is_private_relay`). With the e-mail channel deferred (Q-03) there is no purpose for them. The columns are additive later if a purpose is approved.
- **No `CONFLICT_HOLD`/`REVOKED` identity states:** nothing produces them yet (Apple server-to-server revocation is P2.A3).
- **Flags ON in the `test` environment only**, so the verifier is exercised end to end against the local issuer; the default stays OFF everywhere a person could use it.
- **`PHONE_STEP_UP` scope:** every non-restricted route, not only "account-changing or driver-sensitive" ones — a stricter reading of founder Q-02.

**Not built (stated):** the production JWKS fetch adapter, native SDKs, Apple relay e-mail / S2S notifications / token revocation (P2.A2/P2.A3); real-provider tests (EG-06/EG-07).

**Evidence (local gates on the P2.10 tree):**

| Suite | Result |
|---|---|
| `apps/api/test/oidc.integration.test.ts` (no account creation; step-up to link; PHONE_STEP_UP on an unknown installation incl. guard refusal until stepped up; generic link conflict + audit; one identity per provider; unlink; forged key, wrong issuer/audience, expired, foreign-installation nonce, replay, raw Apple nonce, a failed attempt spends the nonce; linked-identity recovery → COOLDOWN, mismatch → RECEIVED, forged → 400; 503 without a key source) | 5 PASS |
| API integration suite (all files, coverage thresholds) | 166 PASS (statements 91.2 %, branches 81.0 %) |
| `packages/db/test/oidc.integration.test.ts` (nonce bindings, identity uniqueness, subject erasure, OIDC assurance + step-up flag, OIDC-proof recovery kind, grants) | 5 PASS; db suite 73 PASS |
| Worker (`account-jobs`: OIDC-proof recovery completion; deletion unlinks and erases subjects) | 38 PASS |
| `provider-test-doubles` (`LocalOidcIssuer` verified with `jose` against its own JWKS; forged/foreign/time variants) | PASS |
| Integration gate (fresh DB, migrate twice — second run 0 applied, all integration suites, boot smoke) | PASS |
| Quality gate | PASS. format, build, lint, typecheck, depcruise, knip, syncpack and flags in one run; unit tests, coverage, openapi, phase0 coverage and manifest re-run with turbo concurrency 2. Unrelated builds of another project on this machine made two cold-start socket/Nest tests exceed 5 s under full parallelism; both pass alone, and CI is the authority |
| Mobile: typecheck, unit tests, ESLint, Prettier | PASS; 31 files, 235 tests |
| Artifact isolation (`--negative-controls`) | 39/39 PASS. NC2 now lints only the planted probe: the whole-repo lint exhausted the CI runner's heap, CI run 38138514460 |
| Web E2E (web-public + web-ops) | 29/29 PASS |

**Not run / external:** real Google/Apple tokens and keys (EG-06/EG-07); the native SDKs and the production JWKS adapter (P2.A2/P2.A3); device runs.

## Phase-2 closure (founder/ChatGPT review follow-up, 2026-10-11)

The founder/ChatGPT review of `ffdecb7` asked for one bounded closure run before merge. Scope: the accepted staff matrix's support capabilities, per-district claims in the app, appeal of a rejected document renewal, recording the CAMERA approval, an emulator smoke attempt, the ruleset's required checks, then PR and normal merge. Nothing else.

| Area | Implementation |
|---|---|
| Migration | `0009_support_closure` (additive): session revoke reason `STAFF_ON_BEHALF`, security event `SESSIONS_REVOKED_BY_SUPPORT`. Widened CHECKs only; no data moved |
| Support (staff matrix §4) | `SUPPORT_AGENT` (and `TRUST_SAFETY_AGENT`) hold `account.summary.view_masked`, `account.sessions.revoke_on_behalf`, `account.recovery_case.open`.<br>• `POST /v1/admin/account-summaries` — lookup by phone or account id with a mandatory reason (`CUSTOMER_CONTACT_VERIFIED`, `SAFETY_REPORT`, `FRAUD_INVESTIGATION`, `RECOVERY_ASSISTANCE`); privacy-minimised view only: masked phone (`+92 3** *** **NN`), statuses, restrictions, up to 20 sessions with hour-truncated times, device count, whether strong recovery factors exist, recovery/deletion status. No full phone, CNIC, document numbers, evidence, OIDC subject, tokens, IP or location. Every view and failed lookup is audited with the reason; conflict of interest and city scope (via the driver application) are enforced, both audited when denied.<br>• `POST /v1/admin/accounts/{accountId}/session-revocations` — ONE or ALL, fresh staff step-up, reason, idempotency key; `revoke_reason = STAFF_ON_BEHALF` + an account-visible security event + audit.<br>• `POST /v1/admin/account-recoveries/{id}/assistance` — only a driver-KYC recovery in MANUAL_REVIEW or a dormant-number review IN_REVIEW: attaches to the open ACCOUNT_RECOVERY case (priority +1) or opens one; never decides; founder Q-08 (in-person + second approver) is untouched.<br>• No bulk lookup or export. BFF allowlist derives from the contract routes (exactly the three POSTs) |
| web-ops | `/support` (permission-gated, 404 otherwise): lookup with a required reason, masked summary, per-session and all-session sign-out through a modal dialog with reason and WebAuthn step-up, recovery assistance with the "support never decides" note. The typed phone is cleared once the summary loads |
| Per-district claims (R46) | `RequirementChecklist.districts` = ENABLED districts of the application's city (server-authoritative). A per-district item requires one of them (missing, disabled or other-city → 400); any other item carrying a district → 400. The app renders the server list (no hard-coded list), shows the district on documents, compliance and renewal screens; a renewal keeps the original district (the renewal request has no district field) |
| Rejected renewal appeal | `POST /v1/account/appeals` accepts the latest REJECT decision of the caller's own DOCUMENT_RENEWAL case whose renewal is REJECTED. Decided by a KYC senior in the city who is neither the decider nor the second approver. OVERTURNED → the renewal returns to SUBMITTED with a fresh DOCUMENT_RENEWAL case (a human decides again; nothing is validated automatically); UPHELD → stays REJECTED. `DriverCompliance.documents[].renewal` gains `appealableDecisionId` / `appealStatus` (additive); the app offers the appeal only when appealable; web-ops processes it in the existing appeals queue |
| CAMERA | Founder/ChatGPT **APPROVED** the Phase-2 Android CAMERA permission. Release permissions stay exactly `INTERNET`, `${applicationId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, `CAMERA` (ADR-043). No other permission added |
| Ruleset 24837051 | required checks corrected to the five current CI jobs (the stale Integration context removed); other settings unchanged and read back. GitHub truncates check-run names to 100 characters, so the Integration job reports as `Integration (PostgreSQL+PostGIS, Valkey, SeaweedFS, ClamAV, sanitiser container) + migrations + b...` and the ruleset requires that exact reported name (the full 105-character job name can never be satisfied). A future job rename must update the ruleset in the same change |

**Decisions (recorded for review):**
- **T&S also holds the three support permissions**, as in the accepted matrix (§4 columns T&S and SUPPORT).
- **Support assistance on a dormant-number review** attaches/opens the ACCOUNT_RECOVERY case only for reviews already IN_REVIEW; anything else answers 409.
- **Re-claiming a per-district document** in another district: one live claim per document type, vehicle and district. Several districts at once are possible on the server; the app shows the latest claim per type. Multi-district permits wait for the Punjab matrix (EG-03/EG-04).

### Requirement reconciliation (all 55 Phase-2 IDs, after the closure)

| Class | Count | IDs |
|---|---|---|
| ENGINEERING_SATISFIED | 15 | A02, A05, D01, D04, H02, K05, K07, K09, K10, K13, Q01, Q36, V02, V13, W07 |
| PARTIAL_EXTERNAL_GATED | 35 | A03, A04, A11, A15, D02, D03, H01, H08, K02, K03, K04, K06, K08, K11, K14, K15, K16, K17, Q06, Q08, Q39, Q42, R02, R03, R04, R05, R06, R09, R46, S12, S13, U06, V01, V03, W05 |
| PARTIAL_FUTURE_PHASE | 2 | K01 (fleet identities), V07 (earnings/payments/ratings isolation re-checked when those features exist) |
| EXTERNAL_ONLY | 3 | K22 (EG-11), Q44 (EG-12), Q45 (EG-10) |
| NOT_SATISFIED | 0 | — |

Closure items, reconciled explicitly:

| Closure item | IDs | Effect |
|---|---|---|
| Support summary, on-behalf revocation, recovery assistance | A05, A11, K09, K10, H01, W07 | Internal debt closed. A05/K09/K10/W07 stay ENGINEERING_SATISFIED (now also for support); A11 stays PARTIAL (SMS notices, EG-01); H01 stays PARTIAL (staff SSO, EG-19) |
| Per-district claims in the app | R02, R46 | App gap closed; both stay PARTIAL_EXTERNAL_GATED (Punjab matrix and permit details, EG-03/EG-04) |
| Rejected renewal appeal | K05, D04, H02, R02–R06 | K05/D04/H02 stay ENGINEERING_SATISFIED (appeal now covers renewals); R02–R06 stay PARTIAL (EG-03/EG-04) |
| CAMERA approval | K02, V03, V01 | Founder approval recorded; K02/V03 stay PARTIAL (DPIA and reviewer operations, EG-10/EG-20); V01 stays PARTIAL (store identity, EG-18) |

EG-01..EG-23 all remain open. External debt stays deferred, unchanged: production KMS/KEK and key re-wrap, real JWKS adapter and native Google/Apple SDKs, SMS provider, counsel texts, Punjab matrix, DPIA, staff SSO, alert paging, Urdu/Roman-Urdu native review, device and iOS QA, load and penetration tests, push, Phase 3/4 features. The `decode-uri-component` osv exception keeps its existing conditions (expires 2026-12-31; no deep links) and was not extended.

**Evidence (local gates on the closure tree):**

| Suite | Result |
|---|---|
| `apps/api/test/support.integration.test.ts` (privacy-minimised summary incl. raw-key scan, reason audit, 400/404/403; conflict of interest; revoke: step-up required, ONE/ALL, foreign session 404, security event, reviewer 403; assistance attach/open, never decides, claim 403, 409, 404) | 4 PASS |
| `apps/api/test/closure.integration.test.ts` (server district list; district required / disabled / other city / not per-district; round-trip; renewal keeps district; renewal appeal: owner only, one open appeal, decider refused, OVERTURNED → fresh DOCUMENT_RENEWAL case + SUBMITTED, UPHELD stays REJECTED, NEEDS_INFO not appealable) | 4 PASS |
| `packages/db/test/support-closure.integration.test.ts` (previous → latest with live rows, re-run 0, widened CHECKs accept exactly the new values, API-role grants) | 2 PASS |
| Mobile (districts, claim forms, checklist, renewal appeal visibility, new security event label) | typecheck, ESLint, Prettier, knip PASS; 31 files, 246 tests PASS |
| web-ops (`/support`, Playwright `support.spec.ts` with axe: navigation scoped to the permission, BFF method/origin refusals, masked lookup with the phone in no page format, Escape cancels, ONE then ALL revocation with step-up and DB check, recovery hand-off without a decision, auditor 404/403) | 8 PASS |
| `packages/contracts` (support summary subject/reason, ONE/ALL session rule, appeal subject) | 21 PASS; coverage thresholds PASS |
| Quality gate (format, build, lint, typecheck, depcruise, knip normal + production + production strict, syncpack, flags, unit tests, coverage, OpenAPI drift, phase0 coverage, manifest) | PASS |
| Integration gate (fresh DB, migrate — second run 0 applied, every integration suite incl. the three above, boot smoke) | PASS |
| Web E2E (web-public + web-ops, axe) | 37/37 PASS |
| Artifact isolation (`--negative-controls`) | 39/39 PASS |
| gitleaks (staged, per commit) / osv-scanner (lockfile unchanged; existing documented exceptions only) | no leaks / no issues |
| Android dev-client debug APK (`scripts/android-build.mjs debug`, JDK 17.0.20.1, `WAYVRO_DEV_LOCAL_API=1`) | BUILD SUCCESSFUL (package `dev.wayvro.app`; the debug-only manifest adds `SYSTEM_ALERT_WINDOW` for the developer overlay — the release AAB permission gate runs in CI) |
| CI on `d95022b` (run 38152306729) | all five jobs green |

**Android emulator smoke (closure, 2026-10-11).** Disposable AVD in a scratch AVD home (API 35 google_apis x86_64, WHPX; image SHA-1 checked against Google's repository manifest), the dev-client debug APK above, Metro, and the local API runner (recording OTP sink; vault pool through a temporary LOGIN member of `wayvro_vault`, dropped afterwards). Synthetic number only. Emulator, API, Metro and the role were removed after the run.

| Check | Result |
|---|---|
| Install + launch; exactly one Wayvro package (`dev.wayvro.app`) | PASS |
| Local API reached (`10.0.2.2:4000`); synthetic OTP sign-in (code from the local inbox) | PASS. The first send answered 503: the OTP rate limiter's 250 ms Valkey timeout expired under the machine's load and issuance **failed closed** as designed; the retry answered 202 |
| Policy acceptance, age declaration, account home, signed-in devices | PASS |
| Earn entry from rider home; Driver/Partner code lazily loaded | PASS. Metro built separate chunks only on navigation (`DriverHubScreen`, `DocumentsScreen`, `DocumentScreen`, `CaptureScreen`) |
| No CAMERA prompt before capture | PASS. `CAMERA: granted=false` with no prompt through sign-in, account, Earn, explanation, policies, consent, checklist and the selfie claim |
| Explicit CAMERA prompt on the capture screen | PASS. In-app explanation first, then the OS dialog after "Allow camera" |
| Denied path usable | PASS. "Don't allow" → `granted=false (USER_SET)`; the screen explains, offers "Allow camera" again and the in-person note; navigation intact |
| Photo picker needs no media permission | PASS. "Choose a photo" opened the system Photo Picker ("This app can only access the photos you select"); the app holds no READ_MEDIA/STORAGE permission; cancel returns cleanly |
| Per-district item offered (closure R46) | PASS for visibility (Route permit listed and claimable). The district picker itself was **NOT RUN** on the device (it needs a vehicle first); covered by unit and API tests |
| Return to rider mode | PASS ("Back to your account"; the home now shows the Driver/Partner entry) |
| Logout wipes state | PASS. Confirmation dialog → server session `REVOKED / USER_LOGOUT`; SecureStore keeps only the installation id (device identity by design), the session key is gone; Back stays on sign-in |

**NOT RUN on the emulator:** a real camera capture and upload (emulated camera, not exercised), picking an actual photo, the upload queue and file deletion, the sanitiser/worker path, the district picker, RTL/Urdu rendering, TalkBack, dynamic type, low-end physical hardware and iOS.
