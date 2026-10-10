# PHASE2_TEST_STRATEGY — Test layers, adversarial families and acceptance evidence for all 54 IDs (PROPOSED)

**Date:** 2026-10-10 · **Status:** Phase 2 PLAN ONLY — **no test described here has been written or run.** Device E2E was **not** performed during planning and is not claimed. · **Baseline (Phase 1, verified):** Vitest 5.0.3 unit/property tests with fast-check 4.10.2; integration suites against real PostgreSQL 17.5/PostGIS 3.5.2 and Valkey 9.1.2 via `docker compose -p wayvro` (no testcontainers); coverage thresholds per package; `scripts/boot-smoke.mjs`; no Playwright/Maestro yet.

## 1. Layers and where they run

| Layer | Tooling | Phase 2 scope | CI job |
|---|---|---|---|
| Unit + property | Vitest + fast-check | state-machine tables, eligibility evaluator, restriction effects, OTP MAC/expiry logic, token hashing, limiter maths, container validator/metadata stripper, field cipher, policy-hash validation, reason-code catalogues | quality |
| Contract | Zod schemas + OpenAPI drift; response validation in integration tests | every new route; error envelope `details`; `oasdiff` baseline at Phase 2 exit | quality |
| Migration | existing migration test pattern | clean→latest, previous→latest, re-run=0; constraint/trigger/grant assertions **executed as each restricted role** | integration |
| API integration | Vitest against real PG + Valkey + SeaweedFS + ClamAV | every route incl. negative paths; jobs run in-process against the real DB | integration |
| Authorization matrix | table-driven integration suite | all `/v1/admin/*` routes × roles × attributes; consumer owner/profile scoping for all consumer routes | integration |
| Concurrency/idempotency | barrier harness (template: SP-03) | concurrent OTP verifies, first sign-ins, refreshes, submissions, decisions, claims, restriction create/lift, idempotent replays | integration |
| Security/adversarial (K13) | Vitest families §2 | all T-01..T-38 threats | integration |
| Redaction/logging | log-capture + canary scans | every flow | integration |
| Boot negatives | `scripts/boot-smoke.mjs` extensions | fail-closed checklist (security doc §3) | integration |
| Web E2E | **Playwright** (proposed for P2.4 — first real screens; ADR-027 deferred it to then) + axe | web-ops login/enrol, idle lock, reason modal, decision step-up, keyboard paths; web-public legal + deletion pages | new `e2e-web` job |
| Mobile | Vitest for pure logic (exists); component tests for view-state adapters | session manager, refresh single-flight, idempotency-key persistence, view-state mapping, i18n key completeness, "no camera import outside onboarding" rule | quality |
| Mobile E2E / real device | Maestro (Phase 3, SP-08) | **NOT in Phase 2 scope** — reported `NOT RUN` with the Phase 3 gate; Android release AAB build + permission gate still run in CI | android |
| Load (targeted) | small k6-style scripts or Vitest load harness | OTP request path under abuse volume; limiter correctness under concurrency | manual/nightly, reported |

Mocks: only the existing recording mocks (`RecordingOtpDelivery`, etc.) and a local JWKS fixture server for OIDC — **local/test only**; production refuses them (BOOT-NEG). Storage and scanning use the real local services (SeaweedFS, ClamAV), not in-memory doubles, for every vault test. Mocked providers never count as evidence of real integration (activation tracks P2.A1–A5 carry their own real-provider tests).

## 2. Adversarial and specialised test families (K13 and friends)

| Family | Cases (representative; each family numbered -01..-n in code) |
|---|---|
| SEC-OTP | non-PK/landline/international rejected before send; per-phone, per-installation, per-IP, per-prefix limits; silent-drop shape equals success shape; budget hard stop; Valkey down ⇒ 503, no send; 6-digit uniformity (statistical sanity); wrong code ×5 ⇒ LOCKED; phone lockout after 5 failed challenges; code never in logs/responses/DB |
| PROP-OTP | arbitrary interleavings of request/resend/verify never yield two CONSUMED outcomes or a session from an expired/locked challenge |
| CONC-OTP | 50 concurrent verifies with the correct code ⇒ exactly one session; concurrent first sign-in from two installations ⇒ one account |
| SEC-ENUM | OTP request/verify, OIDC sign-in, phone change, recovery, web deletion: identical status/body shape for existing vs non-existing accounts; timing-path parity (same DB/Valkey operations; statistical check with tolerance, not a microsecond claim) |
| SEC-AUTH | no password endpoint exists; staff assertion brute-force throttled |
| SEC-SESS / CONC-SESS / API-SESS | refresh rotation; reuse ⇒ session revoked + security event; leeway replay only with same idempotency key; concurrent refresh ⇒ one successor; revoked/expired/idle sessions rejected on next request; logout current/all/others; foreign session id ⇒ 404; fixation (pre-auth ids never become session ids) |
| SEC-RT | realtime handshake without/with expired/revoked token rejected; rooms derived from session only |
| SEC-S12 | dormant account + new installation ⇒ restricted RECOVERY_REVIEW session exposing no history; "I'm new" ⇒ old phone RELEASED + old account SECURITY_HOLD + new account; "This is my account" without proof ⇒ no access |
| SEC-K17 | phone change requires fresh step-up; new number owned by another account ⇒ generic refusal, no merge; lost-phone recovery cooldown 72 h with "not me" cancellation; notices emitted; SIM-swap heuristic cooldown on sensitive changes |
| SEC-OIDC | bad signature, wrong `aud`/`iss`, expired, future `iat`, missing/replayed nonce, unknown `kid` (bounded JWKS refresh), `alg` confusion (`none`, HS256 with public key) rejected; link requires fresh step-up; `(provider, sub)` on another account ⇒ 409 + audit; email collision ignored; not-linked sign-in ⇒ generic 401; unlink allowed with step-up |
| SEC-S13 | no merge endpoint exists; recovery case moving a phone/link requires proof of both principals + maker-checker + cooldown |
| SEC-IDOR | generated: for every consumer route with an id parameter, another account's id ⇒ 404 and no side effect |
| SEC-MA | for every PATCH/POST: unknown fields rejected; attempts to set `state`, `status`, verified fields, `accountId`, roles ⇒ 400 and unchanged row |
| SEC-V07 | same account: rider-scoped endpoints never return driver documents/profile data; driver compliance endpoint requires a driver profile; staff without scope ⇒ 403 + audit |
| SEC-V13 | DRIVER_ROLE restriction ⇒ rider capabilities intact, earning blockers present; ACCOUNT restriction ⇒ restricted session; VEHICLE restriction blocks every affiliated driver for that vehicle only; restrictions survive logout/login, new installation, "mode" header tampering |
| SEC-VAULT / SEC-URL | no API response contains a storage key/URL except the upload presign; presigned PUT rejects other keys, expired URLs, wrong content type/length; evidence view requires claimed case + reason + step-up; one-time token replay ⇒ 410; token bound to staff session; vault tables unreadable by `wayvro_api` role; access log row per view |
| SEC-FILE | wrong magic bytes, polyglot (JPEG+ZIP), trailing data, oversized dimensions, truncated segments, CRC-broken PNG ⇒ rejected; EXIF/GPS removed (assert absent after processing); EICAR ⇒ REJECTED_MALWARE; scanner down ⇒ stays UPLOADED, never AVAILABLE |
| SEC-K07 / SEC-D01 | same CNIC hash on two accounts ⇒ signal + review, no auto-decision; same evidence bytes ⇒ signal; same plate ⇒ affiliation + signal; second non-terminal application for one account ⇒ rejected by DB |
| SEC-SELFIE | selfie evidence kind and all copy never contain liveness wording (catalogue scan); challenge expired/mismatched ⇒ reviewer sees "challenge not satisfied" and cannot approve without escalation; no automated actor reaches VERIFIED (property test) |
| SEC-REV | reviewer cannot claim cases outside city scope, on own/declared related account, or decide an appeal of own decision; approval with an open duplicate signal needs a second reviewer; evidence-view volume alert fires |
| AUTHZ-MATRIX | all admin routes × {each role, none, offboarded, consumer token, stale step-up, wrong city, self subject, original decider} ⇒ exact expected status; every denial audited; route-completeness check |
| SEC-STAFF | WebAuthn origin/RP-ID mismatch rejected; UV-less assertion rejected; cookie flags `__Host-`, HttpOnly, Secure, SameSite=Strict; Origin check on BFF mutations; idle lock after 15 min; offboarded staff token fails on next request |
| SEC-BG | break-glass > 60 min refused; alert event at start/end; actions tagged; review recorded |
| SEC-AUDIT / PROP-AUDIT | UPDATE/DELETE/TRUNCATE on audit rows fail for app roles and via trigger; seal verification detects any modified/removed row (property: random tamper ⇒ detected); denied privileged attempts are audited |
| SEC-EXPORT | no list endpoint exceeds page cap; export requires maker-checker; export output contains no names/numbers/images; download expires |
| API-CONSENT | wrong/unknown `contentSha256` rejected; placeholder policy acceptance allowed in local/test, production boot refuses placeholders; re-consent required after material change; consent rows append-only |
| SEC-DEL | deletion requires fresh step-up (app) or OTP (web); grace cancellation from another session; blockers reported; processing revokes sessions, releases phone, pseudonymises account, deletes evidence objects (HEAD 404), keeps audit; legal hold blocks evidence deletion; web endpoint non-enumerating |
| SEC-LOG | canary CNIC/phone/OTP/token/presigned URL/ID token values pushed through every flow never appear in captured logs, traces, error envelopes, audit rows or metrics labels |
| UNIT-CRYPTO | AES-GCM round-trip, tamper ⇒ failure, key-id rotation/re-wrap, HMAC lookup stability, local keys refused outside local/test |
| BOOT-NEG | staging/production config: mock provider ⇒ refuse; missing OTP adapter config ⇒ refuse; test OTP route ⇒ 404; local key/pepper ⇒ refuse; placeholder required policy (production) ⇒ refuse |
| CONC-* | submission vs reviewer decision; two reviewers claiming one case; two decisions on one case; restriction create twice with same key; lift vs appeal overturn; consent double-tap |
| PROP-ELIG | eligibility evaluator: any blocker ⇒ not eligible; ACCOUNT restriction ⇒ blocked; DRIVER_ROLE restriction never blocks rider capabilities (INV-09); expired document blocks regardless of stored projection; placeholder set blocks in production mode |
| PROP-SM | each state machine: only listed transitions accepted; illegal transitions ⇒ `WAYVRO_E_INVALID_STATE_TRANSITION`; terminal states absorbing |

## 3. Acceptance evidence for every Phase 2 requirement

Evidence = the named tests passing in CI on the exact reviewed SHA **plus** any listed artefact. "Gated" items show what is provable in Phase 2 and what remains external.

| ID | Acceptance evidence at Phase 2 exit | Remains external / later |
|---|---|---|
| A02 | normalisation property tests (reuse existing `phone.ts` suite + new cases); SEC-ENUM; SEC-OTP non-PK rejection; mobile phone-entry view-state tests; CL-01 respected (no e-mail credential endpoint exists) | — |
| A03 | SEC-OTP, PROP-OTP, CONC-OTP, outage behaviour with sink failure injection; installation limits | real-provider delivery test (P2.A1, EG-01) |
| A04 | API-CONSENT; web-public legal pages render versions/dates/change log (Playwright); mobile consent screens tests | counsel texts (EG-02) |
| A05 | profile PATCH allowlist (SEC-MA); SEC-K17 phone change/recovery/lockout; restricted-session behaviour | — |
| A11 | API-SESS list/revoke/revoke-all; security-events list; notices emitted as events (SMS delivery after EG-01) | push notices (Phase 4) |
| D01 | SEC-D01, SEC-K07; one profile per account (DB); application flow api-e2e | real applicants after EG-10/EG-20 |
| D02 | upload lifecycle integration (SeaweedFS + ClamAV); SEC-FILE, SEC-URL, SEC-VAULT; reviewer decision api-e2e per document type | approved categories (EG-03), production storage (EG-05) |
| D03 | expiry job + live evaluation tests (PROP-ELIG); evidence access log tests; consent capture before first capture slot | M17 reminders (Phase 5) |
| D04 | PROP-SM for application/profile; decision/appeal api-e2e; status shown via account/state | — |
| H01 | AUTHZ-MATRIX; SEC-STAFF; role grant maker-checker; code-defined roles (no runtime role creation endpoint) | SSO federation (EG-19) |
| H02 | queue/claim/decision/appeal/expiry-roster api-e2e; SEC-REV; Playwright reviewer journey | real reviewers (EG-20) |
| H08 | step-up enforcement tests on every privileged route; confirmation dialogs (Playwright); SEC-BG; reason-for-access enforced server-side | alert delivery channel (EG-21) |
| K01 | account uniqueness per verified phone (DB + CONC-OTP); staff/consumer token separation tests; lifecycle state tests | fleet principals (Phase 12) |
| K02 | capture slot → AVAILABLE pipeline; claims vs confirmed separation; masked display tests; consent-before-capture | DPIA (EG-10) before any real CNIC |
| K03 | SEC-SELFIE (no liveness wording, challenge binding, no automated approval); camera-denied manual path api/view-state tests | automated liveness (EG-08/10/11, optional) |
| K04 | decision schema has no score field; identity-match assessment required for APPROVE; appeal routing; no gender field (schema scan test) | automated comparison (EG-09/10/11, optional) |
| K05 | PROP-SM; append-only decisions; NEEDS_INFO itemisation; resubmission; appeal to different reviewer | — |
| K06 | requirement-set maker-checker tests; licence-class rule; placeholder refusal in production mode | approved matrix (EG-03) |
| K07 | SEC-K07; no merge endpoint; duplicate signals open review cases | — |
| K08 | SEC-OTP/PROP-OTP/CONC-OTP; SIM-swap heuristic cooldown tests; outage tests; recovery tests | vendor caps & delivery (EG-01); SIM data (EG-22) |
| K09 | SEC-SESS/CONC-SESS/API-SESS; tokens stored hashed (DB assertion); lost-device flows | — |
| K10 | SEC-STAFF; step-up freshness; offboarding test; recovery via backup authenticator | production access controls (Phase 7) |
| K11 | SEC-VAULT/SEC-URL/SEC-FILE; UNIT-CRYPTO; orphan-cleanup and retention job tests; SEC-LOG for evidence identifiers | production storage/KMS (EG-05), counsel retention (EG-16) |
| K13 | all §2 families green; family index document listing case → threat mapping | independent pen test (EG-17, Phase 7) |
| K14 | onboarding explanation/manual option/dispute/correction screens and API paths; consent versioning; placeholder marking | counsel texts (EG-02) |
| K15 | SEC-OIDC with locally generated keys and JWKS fixture; flag OFF by default test | real Google integration (EG-06) |
| K16 | SEC-OIDC Apple variants (relay email flag, first-auth name optional); revocation state transitions | real Apple integration, S2S endpoint, token revocation (EG-07) |
| K17 | SEC-K17; multi-device session list; high-risk reauth gates | SMS delivery of notices (EG-01) |
| K22 | vendor evaluation template exists (`PHASE2_EXTERNAL_GATES.md` §4) | founder decisions + DPAs (EG-11) — **not satisfiable by Claude** |
| Q01 | mobile unit tests: tokens written only through the secure-store adapter; no AsyncStorage dependency (dependency-cruiser/knip rule); logout wipes; no tokens in mobile logs | real-device keychain/keystore behaviour (Phase 3 device matrix) |
| Q06 | SEC-OTP/SEC-ENUM/limiter concurrency tests; playbooks committed under `docs/operations/` | fare/driver abuse surfaces (Phase 3/4); vendor caps (EG-01) |
| Q08 | key-responsibility table (vault doc §5) reviewed; UNIT-CRYPTO; local KEK refused in staging/production | KMS choice (EG-05) |
| Q36 | SEC-LOG canary suite across all flows; redaction unit tests for new keys/patterns | — |
| Q39 | SEC-AUDIT/PROP-AUDIT; audit coverage test (every privileged route emits exactly one audit event incl. denials) | external anchoring (EG-05) |
| Q42 | short sessions, idle lock, step-up, offboarding tests | device/network controls with hosting; ops drill (Phase 7) |
| Q44 | data-location inventory for Phase 2 data classes delivered | counsel review (EG-12) — **not satisfiable by Claude** |
| Q45 | DPIA input pack delivered | qualified DPIA (EG-10) — **not satisfiable by Claude** |
| R02 | route-permit document type with district scope; per-district evaluator blocker; reviewer checklist item | legal applicability (EG-04); dispatch use (Phase 4) |
| R03 | fitness document type; expired/failed ⇒ evaluator blocker (PROP-ELIG) | source/process confirmation (EG-04); go-online use (Phase 4) |
| R04 | insurance document type per vehicle/category; evaluator blocker | requirements (EG-04); incident link (Phase 6) |
| R05 | ownership types incl. open-letter/hypothecated/company/family; authorised-use letter required by set; token tax type | matrix (EG-03) |
| R06 | licence-class allowlist per set; no per-driver waiver path (route-inventory test proves no override endpoint) | training/background specifics (EG-04; N28 Phase 8) |
| R09 | separate policy keys incl. COMMUNITY_GUIDELINES and DRIVER_PARTNER_AGREEMENT; change log page; re-consent flow | counsel texts (EG-02) |
| R46 | all Punjab artefact document types configurable; placeholder set; per-district permits; evaluator blockers | official rules (EG-03/04); dispatch district check (Phase 4) |
| S12 | SEC-S12 | operator recycling data (EG-22) |
| S13 | SEC-S13 + SEC-OIDC collision cases | production OIDC (EG-06/07) |
| U06 | SEC-DEL; web-public deletion page E2E; retention configuration marked NOT_COUNSEL_APPROVED | counsel retention (EG-16), texts (EG-02), store disclosure (EG-18) |
| V01 | no second app path (existing manifest check); onboarding inside `apps/wayvro-mobile`; Android AAB build + permission gate (CAMERA allowlisted with justification) | store identity (EG-18) |
| V02 | SEC-V07 + guard tests: client-sent mode/role headers ignored; capabilities from server only | — |
| V03 | api-e2e: rider capabilities intact during pending/rejected application and DRIVER_ROLE restriction | real onboarding (EG-10/EG-20); mobile E2E (Phase 3) |
| V07 | SEC-V07 + SEC-IDOR suites | later data classes (Phases 4–6) |
| V13 | SEC-V13 + PROP-ELIG + restriction maker-checker/appeal api-e2e | Phase 4/6 consumers |
| W05 | Playwright: versioned dated pages, change log, placeholder banner + noindex; immutability test (published version content hash never changes) | counsel texts + domain (EG-02/EG-15) |
| W07 | Playwright + axe: keyboard navigation, banners, idle lock, reason modal; SEC-EXPORT; AUTHZ-MATRIX proves no client-side authorization dependence | production network controls (Phase 7) |

## 4. Reporting rules (CLAUDE.md §8, Q48)

Each micro-phase report lists every command with `PASSED / FAILED / SKIPPED(reason+gate) / NOT RUN / BLOCKED`, the exact SHA and CI run URL. Planning-time status: **all Phase 2 tests NOT RUN** (none exist). Coverage thresholds for new modules start at the Phase 1 levels for their package type (domain-like pure modules 95/95/85/95; api integration 90/90/80/90); no exclusions are added to pass.
