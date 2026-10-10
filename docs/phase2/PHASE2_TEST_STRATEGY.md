# PHASE2_TEST_STRATEGY — Test layers, adversarial families and acceptance evidence for all 55 IDs (PROPOSED)

**Date:** 2026-10-10 (planning closure correction applied the same day) · **Status:** Phase 2 PLAN ONLY — **no test described here has been written or run.** Device E2E was **not** performed during planning and is not claimed. · **Baseline (Phase 1, verified):** Vitest 5.0.3 unit/property tests with fast-check 4.10.2; integration suites against real PostgreSQL 17.5/PostGIS 3.5.2 and Valkey 9.1.2 via `docker compose -p wayvro`; coverage thresholds per package; `scripts/boot-smoke.mjs`; no Playwright/Maestro yet.

## 1. Layers

| Layer | Tooling | Phase 2 scope | CI job |
|---|---|---|---|
| Unit + property | Vitest + fast-check | state machines, eligibility evaluator, restriction effects, OTP logic, token hashing, limiter maths, envelope/lookup crypto and rotation logic, policy hash validation, age-policy modes, reason-code catalogues | quality |
| Contract | Zod + OpenAPI drift; response validation in integration tests; `oasdiff` baseline at Phase 2 exit | all new routes | quality |
| Migration | existing pattern | clean→latest, previous→latest, re-run=0; constraints, FKs, CHECKs, triggers; **grants executed as each restricted role** | integration |
| API integration | Vitest against real PG + Valkey + SeaweedFS + ClamAV + the isolated image sanitiser | every route incl. negative paths; jobs in-process against the real DB | integration |
| Authorization matrix | table-driven | all admin routes × roles × attributes; consumer owner/profile scoping | integration |
| Concurrency/idempotency | barrier harness (SP-03 template) | OTP verifies, first sign-ins, refreshes, submissions, decisions, claims, restrictions, rotation vs concurrent update | integration |
| Security/adversarial (K13) | families §2 | T-01..T-41 | integration |
| Artefact isolation | new `artifact-isolation` CI step | production artefacts of api/worker/realtime | new step (P2.1) |
| Redaction/logging | log capture + canary scans | every flow | integration |
| Boot negatives | `scripts/boot-smoke.mjs` extensions | fail-closed checklist | integration |
| Web E2E | Playwright + axe on a **seasoned, supported stable line chosen at implementation** | web-public legal/deletion pages; web-ops login/enrol/lock/reason modal/decisions | new `e2e-web` job |
| Mobile | Vitest (pure logic) + component tests for view-state adapters | session manager, refresh single-flight, idempotency persistence, view states, i18n completeness, camera/picker import boundary | quality |
| Mobile E2E / real device | Maestro (Phase 3, SP-08) | **NOT in Phase 2** — reported `NOT RUN`; Android AAB + permission gate still run | android |
| Load (targeted) | small scripted harness | OTP abuse volume; limiter correctness | manual/nightly, reported |

Mocks and fakes exist only in `@wayvro/provider-test-doubles` (dev-only) and the local runner; vault tests use the real local storage, scanner and sanitiser; mocked providers never count as integration evidence (activation tracks carry real-provider tests).

## 2. Families (each numbered -01..-n in code)

| Family | Cases (representative) |
|---|---|
| SEC-OTP / PROP-OTP / CONC-OTP | non-PK rejected before send; every limit; silent-drop shape = success shape; spend stop; limiter down ⇒ 503 and no send; 5 wrong codes ⇒ LOCKED; phone cooldown; code never in logs/DB/responses; arbitrary interleavings never yield two consumptions; 50 concurrent correct verifies ⇒ one session; concurrent first sign-ins ⇒ one account |
| SEC-ENUM | identical shape/status/work for existing vs absent accounts on OTP, OIDC sign-in, phone change, recovery, web deletion (statistical timing tolerance, no microsecond claim) |
| SEC-AUTH | no password endpoint; staff assertion throttling |
| SEC-SESS / CONC-SESS / API-SESS | rotation; reuse ⇒ revoke + event; leeway replay only with the same idempotency key; concurrent refresh ⇒ one successor; revoked/expired rejected next request; logout current/all/others; foreign session ⇒ 404; fixation |
| SEC-RT | handshake without/with expired/revoked token rejected; rooms server-derived |
| SEC-S12 | dormant + new installation ⇒ restricted `RECOVERY_REVIEW` with no history; "I'm new" ⇒ old phone released, old account `SECURITY_HOLD`, new account; "This is my account" unavailable without strong proof; threshold read from configuration (no constant) |
| SEC-K17 | self-service change needs fresh step-up; target number current elsewhere ⇒ generic refusal, no merge; 72 h cooldown with "not me" cancel; notices; SIM-swap cooldown |
| **SEC-RECOVERY** | rider-only account without linked OIDC: no endpoint, staff role or support action can move its phone or restore history; driver KYC recovery requires a staff case + second approver + cooldown; OIDC-proof recovery (from P2.10) requires fresh re-auth of the same `(provider, sub)`; support role cannot decide any recovery case; every credential movement audited |
| SEC-OIDC | bad signature, wrong `aud`/`iss`, expired, future `iat`, missing/replayed nonce, unknown `kid` (bounded refresh), `alg` confusion rejected; link needs step-up; `(provider, sub)` conflict ⇒ 409 + audit; e-mail collision ignored; not-linked sign-in generic; unknown-device OIDC session gets `PHONE_STEP_UP` before sensitive actions |
| SEC-S13 | no merge endpoint; credential movement only through strong-proof, maker-checker, cooldown recovery case; histories never merged |
| SEC-IDOR / SEC-MA | generated per route: foreign ids ⇒ 404 without side effects; unknown/server-owned fields rejected |
| SEC-V07 | rider-scoped endpoints never return driver data for the same account; driver endpoints require a driver profile; staff without scope ⇒ 403 + audit |
| SEC-V13 | DRIVER_ROLE (incl. `RISK_HOLD`) never blocks rider capabilities; ACCOUNT ⇒ restricted session; VEHICLE blocks every affiliated driver for that vehicle only; restrictions survive logout/login, new installation and mode-header tampering |
| SEC-VAULT / SEC-URL | no storage key/URL in any response except the upload presign; presign rejects other keys, expired URLs, wrong type/length; evidence view needs claimed case + reason + step-up; one-time token replay ⇒ 410; vault tables unreadable by `wayvro_api`; access-log row per view |
| **SEC-FILE** (revised) | unsupported/disguised formats (SVG, HEIC, WebP, TIFF, PDF-as-JPEG) rejected before decoding; decompression bombs stopped by pixel/byte caps; truncated/corrupt rejected; polyglot inputs yield clean re-encoded output without the payload; EXIF/GPS/XMP/ICC/text metadata absent from output (independent reader); sanitiser crash/timeout/OOM ⇒ never clean; sanitiser has no network/secrets (container config test); EICAR ⇒ `REJECTED_MALWARE`; output re-decodes within bounds; `capture_source` stored but never used in decisions |
| SEC-K07 / SEC-D01 | CNIC lookup match across accounts ⇒ signal + review (no auto-decision, no rejection, no merge); evidence hash match ⇒ signal; same plate ⇒ affiliation + signal; second non-terminal application for one account ⇒ DB rejects; **no test asserts person-level uniqueness as a DB property** |
| **SEC-SELFIE** (revised) | selfie slots refuse non-camera `capture_source`; no liveness-success wording anywhere (catalogue scan); challenges are optional, drawn from the accessible set, "can't do this" yields an alternative, "none work" continues without penalty; a declined/absent challenge never auto-rejects; mismatch is shown to the reviewer; no automated actor reaches `VERIFIED` (property) |
| SEC-REV | city scope, conflict, not-original-decider, second approval with open duplicate signal, evidence-view volume alert |
| AUTHZ-MATRIX | all admin routes × {roles, none, offboarded, consumer token, stale step-up, wrong city, self subject, original decider, single-authenticator account in real-evidence mode}; denials audited; route completeness |
| SEC-STAFF | WebAuthn origin/RP-ID mismatch and missing UV rejected; cookie flags; BFF Origin check; idle lock; offboarded token fails; bootstrap CLI refuses when an active admin exists and no static emergency credential exists |
| SEC-BG | > 60 min refused; alerts at start/end; tagged actions; review recorded |
| SEC-AUDIT / PROP-AUDIT | UPDATE/DELETE/TRUNCATE fail; random tamper detected by seal verification; denied attempts audited |
| **SEC-EXPORT** (revised) | route inventory proves **no export/download endpoint** for identity/KYC data; rosters paginated with hard caps and scope filters; no "export all" parameter accepted |
| API-CONSENT | wrong/unknown `contentSha256` rejected; production refuses placeholders; re-consent after material change; append-only |
| **API-AGE** | declaration shape follows the active policy mode; DOB rejected when the mode does not require it; `AGE_DECLARATION` required action appears/clears correctly; production refuses the placeholder policy; driver approval blocked when reviewer-confirmed DOB fails the policy; `AGE_POLICY` restriction is reason-coded and appealable; no threshold constant in client or server code (static check) |
| SEC-DEL | step-up/OTP required; grace cancellation; blockers as rows; processing revokes sessions, releases phone, pseudonymises, deletes evidence (HEAD 404) unless legal hold, keeps audit; web endpoint non-enumerating |
| SEC-LOG | canary CNIC/phone/OTP/token/presigned URL/ID token/envelope never appear in logs, traces, error bodies, audit rows or metric labels |
| **UNIT-CRYPTO / PROP-CRYPTO** | envelope round-trip; bit flips in every field fail; envelope moved to another row/column/schema version fails (AAD); nonce uniqueness sanity over 10⁵ encryptions; `DECRYPT_ONLY` decrypts, `RETIRED` fails; malformed envelopes ⇒ typed errors only (fuzz); rotation job crash/restart converges; concurrent user update during re-encryption preserved; lookup dual-read finds records under both versions; per-version uniqueness holds during backfill; local keys refused outside local/test |
| **ART-ISO** | for api/worker/realtime production artefacts: test-double package absent; no mock brand/class names/specifier in files; dynamic import fails `ERR_MODULE_NOT_FOUND`; artefact with `WAYVRO_ENV=local` refuses (release marker); no test-OTP route in the artefact's route manifest; dependency-cruiser `no-production-to-test-doubles` violation fixture fails lint (negative control) |
| BOOT-NEG | staging/production: mock binding refused; missing adapter config refused; local keys refused; placeholder required policy/age policy refused (production) |
| CONC-* | submission vs decision; double claim; double decision; restriction create twice; lift vs overturn; consent double-tap; key rotation vs update |
| PROP-ELIG / PROP-SM | any blocker ⇒ not eligible; ACCOUNT blocks; DRIVER_ROLE never blocks rider (INV-09); live expiry beats stored projection; placeholders block in production; only listed transitions accepted; terminals absorbing |

## 3. Acceptance evidence per requirement (55)

| ID | Evidence at Phase 2 exit | Remains external / later |
|---|---|---|
| A02 | normalisation property tests; SEC-ENUM; non-PK rejection; mobile phone-entry view states; no e-mail credential route | — |
| A03 | SEC-OTP, PROP-OTP, CONC-OTP; outage via sink failure injection; installation limits | real delivery (P2.A1, EG-01); the sink is never evidence |
| A04 | API-CONSENT; legal pages (Playwright); mobile consent tests | counsel texts (EG-02) |
| A05 | profile allowlist (SEC-MA); SEC-K17; restricted-session behaviour | — |
| A11 | session list/revoke/revoke-all; security events | SMS notices (EG-01); push (Phase 4) |
| **A15** | API-AGE; reviewer DOB/licence check on driver approval; placeholder policy refused in production; no rider DOB collected in `AFFIRM_MINIMUM_AGE`/`NONE` modes | counsel thresholds and guardian rules (EG-23, P2.A9) |
| D01 | SEC-D01, SEC-K07; one profile per account (DB) | real applicants (EG-10/EG-20) |
| D02 | upload pipeline integration (camera and import sources); SEC-FILE, SEC-URL, SEC-VAULT; per-type decisions | approved categories (EG-03); production storage (EG-05) |
| D03 | expiry job + live evaluation; access log; consent before first slot | M17 reminders (Phase 5) |
| D04 | PROP-SM; decision/appeal api-e2e | — |
| H01 | AUTHZ-MATRIX; SEC-STAFF; maker-checker grants; no runtime role creation | SSO federation (EG-19) |
| H02 | queue/claim/decision/appeal/roster api-e2e; SEC-REV; Playwright reviewer journey | real reviewers (EG-20) |
| H08 | step-up on every privileged route; confirmations; SEC-BG; server-side reason enforcement | alert channel (EG-21) |
| K01 | per-phone/per-account uniqueness (DB + CONC-OTP); token-type separation; lifecycle tests; documentation that person uniqueness is signal-based | fleet principals (Phase 12) |
| K02 | slot → AVAILABLE pipeline for both sources; claims vs confirmed; masked display; consent before capture | DPIA (EG-10) before real CNIC |
| K03 | SEC-SELFIE; camera-denied/challenge-inaccessible alternatives | automated liveness (optional, EG-08/10/11) |
| K04 | no score field; assessment required for approval; appeal routing; no gender field (schema scan) | automated comparison (optional) |
| K05 | PROP-SM; append-only decisions; NEEDS_INFO itemisation; resubmission; appeal | — |
| K06 | requirement-set maker-checker; licence-class rule; placeholder refusal | approved matrix (EG-03) |
| K07 | SEC-K07; no merge endpoint | — |
| K08 | OTP families; SIM-swap cooldown; outage; recovery | vendor caps (EG-01); SIM data (EG-22) |
| K09 | SEC-SESS/CONC-SESS/API-SESS; hashed tokens (DB assertion) | — |
| K10 | SEC-STAFF; step-up freshness; offboarding; backup-authenticator recovery | production access controls (Phase 7) |
| K11 | SEC-VAULT/URL/FILE; UNIT/PROP-CRYPTO; orphan and retention jobs; SEC-LOG | production storage/KMS (EG-05); retention (EG-16) |
| K13 | all families green with a case→threat index | independent test (EG-17) |
| K14 | explanation/manual option/dispute/correction paths; consent versioning; placeholder marking | counsel texts (EG-02) |
| K15 | SEC-OIDC with local synthetic keys; flags off by default | real Google (EG-06) |
| K16 | SEC-OIDC Apple variants; revocation states | real Apple, S2S, revocation (EG-07) |
| K17 | SEC-K17, SEC-RECOVERY; high-risk reauth gates | SMS notices (EG-01) |
| K22 | vendor evaluation template | founder decisions + DPAs (EG-11) — not satisfiable by Claude |
| Q01 | secure-store-only writes; no AsyncStorage dependency (rule); logout wipes; no tokens in logs | real-device keystore checks (Phase 3) |
| Q06 | OTP/ENUM/limiter tests; playbooks committed | fare/driver abuse (Phase 3/4); vendor caps (EG-01) |
| Q08 | key-responsibility table; UNIT/PROP-CRYPTO; local keys refused outside local/test | KMS (EG-05) |
| Q36 | SEC-LOG canaries; redaction unit tests | — |
| Q39 | SEC-AUDIT/PROP-AUDIT; audit coverage incl. denials | external anchoring (EG-05) |
| Q42 | short sessions, idle lock, step-up, offboarding tests | device/network controls; drill (Phase 7) |
| Q44 | data-location inventory delivered | counsel (EG-12) — not satisfiable by Claude |
| Q45 | DPIA input pack delivered | qualified DPIA (EG-10) — not satisfiable by Claude |
| R02 | per-district permit type (FK to districts); evaluator blocker; checklist item | legal applicability (EG-04); dispatch use (Phase 4) |
| R03 | fitness type; expired/failed ⇒ blocker | EG-04; go-online use (Phase 4) |
| R04 | insurance type per vehicle/category; blocker | EG-04; incident link (Phase 6) |
| R05 | ownership types; authorised-use letter rule; token tax | EG-03 |
| R06 | licence-class allowlist; no override route (route inventory) | EG-04; N28 (Phase 8) |
| R09 | separate policy keys; change log; re-consent | EG-02 |
| R46 | configurable artefact types; placeholder set; per-district permits; blockers | EG-03/04; district dispatch check (Phase 4) |
| S12 | SEC-S12, SEC-RECOVERY | EG-22 |
| S13 | SEC-S13 + SEC-OIDC collisions | production OIDC (EG-06/07) |
| U06 | SEC-DEL; web deletion page E2E; retention configuration marked NOT_COUNSEL_APPROVED | EG-16, EG-02, EG-18 |
| V01 | no second-app path (existing manifest check); onboarding inside the one app; AAB + permission gate with CAMERA justified and no storage permission | store identity (EG-18) |
| V02 | SEC-V07 + guard tests: client mode/role ignored | — |
| V03 | rider capabilities intact during pending/rejected application and DRIVER_ROLE restriction | EG-10/EG-20; mobile E2E (Phase 3) |
| V07 | SEC-V07 + SEC-IDOR | later data classes |
| V13 | SEC-V13 + PROP-ELIG + restriction maker-checker/appeal | Phase 4/6 consumers |
| W05 | versioned dated pages, change log, placeholder banner + noindex; immutability | EG-02/EG-15 |
| W07 | Playwright + axe shell checks; SEC-EXPORT (no export route; paginated scoped rosters); AUTHZ-MATRIX | production network controls (Phase 7) |

## 4. Reporting rules (CLAUDE.md §8, Q48)
Every command reported as `PASSED / FAILED / SKIPPED(reason+gate) / NOT RUN / BLOCKED` with exact SHA and CI URL. Planning-time status: **all Phase 2 tests NOT RUN** (none exist). Coverage thresholds for new modules start at Phase 1 levels; no exclusions added to pass.
