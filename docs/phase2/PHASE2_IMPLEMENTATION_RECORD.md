# PHASE2_IMPLEMENTATION_RECORD — Full Phase 2 implementation (P2.1 review fixes, P2.2 – P2.10)

**Branch:** `phase-2/identity-controlled-onboarding` from P2.1 `2666c8ba8627831dd2b40b2a7fa1b18aef65d809` (protected `main` = `8c8e528bf2a975f2fe385fd49ed9de78f29ed530`, unchanged). · **Authorisation:** founder authorised the whole Phase 2 engineering implementation in one run (2026-10-11); micro-phases P2.1–P2.10 are internal checkpoints. · **Status:** IN PROGRESS — one living record, updated at every checkpoint; **not merged, no PR**. · **Agent:** Claude Code (self-audit, not independent verification). · Synthetic data only; external gates EG-01..EG-23 remain open unless stated otherwise with evidence.

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
| P2.7 | (this commit) | manual review, decisions, second approvals, appeals, expiry monitoring, outbox relay + first consumer, reviewer UI |

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
