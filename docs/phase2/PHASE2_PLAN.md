# PHASE2_PLAN — Identity, Authentication, Account Security and Controlled Driver/Partner Onboarding (PROPOSED)

**Date:** 2026-10-10 · **Branch:** `docs/phase-2-planning` (from `main` @ `3a1402f9d530ff1a384082c6a912a91152bfffc8`) · **Status:** **PLAN ONLY — awaiting founder/ChatGPT review. No Phase 2 product code, migration, dependency, provider account, OTP, or real identity data exists or was used.** · **Agent:** Claude Code (self-audit, not independent verification).

## 1. Authority and inputs

Authority order applied: current law/safety obligations and founder decisions → audited repository truth (`main` @ `3a1402f`) → Phase 1 ADRs (`docs/adr/README.md`) → Phase 0 artefacts and the 531-ID register (`docs/requirements-register.json`, schema 5.1) → canonical docs. Read for this plan: `CLAUDE.md`, `README.md`, `ALL_FILES_INDEX.md`, the full register, docs 05, 07, 10, 12, 14, 15, 18, 22, 27, 28, `docs/phase0/*` (role model, journeys/state machines, security/privacy, ADR backlog, launch blockers, gap report, closure handoff, architecture, guardrails, cost/provider matrix, research R2/R4/R5 identity/KYC/storage sections), `docs/phase1/PHASE1_HANDOFF_REPORT.md`, all nine Phase 1 ADRs, and an inventory of every Phase 1 app/package/config/migration/CI file.

## 2. Repository truth verified before planning (2026-10-10)

| Check | Result |
|---|---|
| Local branch / HEAD before branching | `main` / `3a1402f9d530ff1a384082c6a912a91152bfffc8` |
| `origin/main` after fetch | `3a1402f9d530ff1a384082c6a912a91152bfffc8` (matches expected) |
| Worktree | clean (no tracked changes; `.env` and `build-logs/` are gitignored) |
| Origin | `https://github.com/haseeb1229/wayvro.git` |
| Git identity | `Muhammad Haseeb <abdulhaseeb1229@gmail.com>` |
| `gh` auth | `haseeb1229`, scopes `repo, workflow, read:org, gist` |
| Ruleset on `main` | id 24837051 "main — PR + required CI", enforcement `active` |
| Phase 1 product surface | none: no product tables (only `0000_postgis.sql`), no auth/guards, no rate limiting, no idempotency store, no audit, no outbox table, no job runner wiring, no mobile navigation/secure storage/HTTP client, web-ops unauthenticated |

## 3. Scope — verified from the register

`phase0.target_phase = 2`: **54 IDs, P0 = 49, P1 = 5** (A11, K15, K16, K17, K22) — identical to the founder prompt's list (0 missing, 0 extra):
A02, A03, A04, A05, A11, D01, D02, D03, D04, H01, H02, H08, K01–K11, K13–K17, K22, Q01, Q06, Q08, Q36, Q39, Q42, Q44, Q45, R02–R06, R09, R46, S12, S13, U06, V01, V02, V03, V07, V13, W05, W07.
Classification (`docs/phase2/PHASE2_EXTERNAL_GATES.md` §3): **21 IMPLEMENTABLE_NOW · 30 NOW + GATED_ACTIVATION · 3 EXTERNAL_GATED (K22, Q44, Q45)**; automated liveness/face-match, staff SSO federation, e-mail contact, external audit anchoring, SMS Retriever and Apple server-to-server handling are DESIGN_NOW_ACTIVATE_LATER components. Full traceability: `docs/phase2/PHASE2_REQUIREMENT_MATRIX.md`.

## 4. Document map (no duplication: each topic has one home)

| Document | Owns |
|---|---|
| `docs/phase2/PHASE2_PLAN.md` | this overview, findings, gaps/clarifications/contradictions, deferrals, founder questions, readiness |
| `docs/phase2/PHASE2_REQUIREMENT_MATRIX.md` | per-ID class, micro-phase, surfaces, gates, domain/API/DB/UI/authz/controls/tests |
| `docs/phase2/PHASE2_DOMAIN_AND_DATA_MODEL.md` | entities, schemas/roles, state machines, capability derivation, restriction semantics, consent, deletion/retention, PII classes, migration sequence |
| `docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md` | OTP, sessions/tokens, step-up, recycled SIM/SIM swap/recovery, OIDC linking, consumer authorization, mock hardening, error codes, telemetry |
| `docs/phase2/PHASE2_KYC_AND_EVIDENCE_VAULT.md` | V1 KYC boundary, onboarding flow, configurable document matrix, upload pipeline, encryption/keys, reviewer access, manual review, dedupe, future provider design, DPIA/data-location inputs |
| `docs/phase2/PHASE2_STAFF_AUTHORIZATION_MATRIX.md` | staff realm, WebAuthn, roles/attributes, authorization matrix, reason-for-access, exports, break-glass, audit |
| `docs/phase2/PHASE2_API_AND_SURFACES.md` | endpoint/contract inventory with auth/idempotency/rate-limit/audit/PII/enumeration per operation; mobile, web-ops, web-public plans |
| `docs/phase2/PHASE2_SECURITY_AND_ABUSE_MODEL.md` | Phase 2 threat register T-01..T-39 with prevention/detection/recovery/tests; fail-closed checklist; residual risks; playbooks |
| `docs/phase2/PHASE2_EXTERNAL_GATES.md` | status vocabulary, gate register EG-01..EG-23, classification of all 54 IDs, vendor evaluation template, activation tracks |
| `docs/phase2/PHASE2_TEST_STRATEGY.md` | layers, adversarial families, acceptance evidence for all 54 IDs, reporting rules |
| `docs/phase2/PHASE2_IMPLEMENTATION_SEQUENCE.md` | micro-phases P2.1–P2.10, activation tracks, Phase 2 exit gate mapping |
| `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md` | ADR-038..044 proposals, dependency evaluations, rejected/deferred packages |
| `docs/phase2/PHASE2_IMPLEMENTATION_PROMPT_PROPOSED.md` | proposed prompt for P2.1 (not an authorisation) |

## 5. Decisions proposed (summary)

- **Identity model:** one `identity.accounts` row per human (unique verified phone), `rider_profiles` created at first sign-in, optional `driver_applications` → `driver_profiles`, vehicles with affiliations, service-capability grants, one scoped `restrictions` table (ACCOUNT / DRIVER_ROLE / VEHICLE / SERVICE_CAPABILITY / CITY_CATEGORY), separate `staff` realm. Mode is presentation only; a pure server-side evaluator returns exhaustive blockers.
- **Auth/session:** no auth framework (ADR-038); phone OTP only consumer credential; opaque SHA-256-hashed tokens, 15-min access, rotating single-use refresh with family reuse detection and a 30-s idempotent leeway; immediate revocation; realtime authenticated with the same session.
- **OTP:** +92 mobile only; 6-digit CSPRNG code stored as HMAC; 5-min TTL; 5 attempts; escalating resend cooldown; per-phone/installation/IP/prefix/ASN limits; global spend stop; silent drop; fail closed if the limiter store is down; honest outage errors; no master OTP; local recording sink only in local/test.
- **OAuth:** Google/Apple linking only from a phone-verified, step-up-fresh session; `(provider, sub)` key; nonce; `jose` verification; email never a lookup/merge key; no account creation via OIDC; no merges; production gated (EG-06/07).
- **KYC:** guided capture, manual/human review and in-person path as the V1 baseline; no OCR, no face/liveness ML, no score; selfie capture challenge as an anti-replay aid; automated vendors only as advisory signals after DPIA/DPA (P2.A5).
- **Evidence vault:** metadata in `vault` schema reachable only by a separate DB role; presigned PUT to quarantine only; container validation + metadata stripping + ClamAV; per-object envelope encryption; reviewers view via one-time, session-bound, reason-gated stream; access log; retention/legal hold/orphan cleanup.
- **Staff:** WebAuthn-native MFA (two authenticators), BFF with `__Host-` cookies, code-defined roles + ABAC attributes (city, claimed case, conflict, not-original-decider, maker-checker, fresh step-up), break-glass ≤ 60 min with alert and review, INSERT-only audit with sealed batches.
- **Restrictions:** discretionary actions are restriction rows; expired documents block through live evaluation; driver suspension never blocks rider use; everything reason-coded, audited, appeal-aware, idempotent.
- **Deletion/retention:** in-app (step-up) and web (OTP) requests; grace period; reason-coded blockers; pseudonymisation; evidence deletion unless legal hold; retention durations as `NOT_COUNSEL_APPROVED` configuration until EG-16.

## 6. Micro-phase sequence (detail: implementation sequence doc)

P2.1 identity & session core → P2.2 policy/consent + legal pages → P2.3 mobile account slice → P2.4 staff realm + web-ops shell → P2.5 compliance domain + requirement sets + restrictions → P2.6 evidence vault → P2.7 manual review/appeals/expiry → P2.8 mobile Driver/Partner onboarding → P2.9 recovery/SIM safeguards/deletion/hardening → P2.10 OIDC linking (flags off). External activation tracks P2.A1–P2.A8 run only when their gates clear.

## 7. Repository findings (Phase 1 code, relevant to Phase 2)

| # | Finding (verified in code) | Impact | Planned handling |
|---|---|---|---|
| F-01 | Mock-provider refusal (`bindProviders`) depends solely on `WAYVRO_ENV`; a deployment mis-set to `local`/`test` would bind recording mocks and skip staging/production config rules | production mock activation risk (T-29) | P2.1: staging/production schemas require real adapter config; test-OTP route absent outside local/test; BOOT-NEG tests. Phase 7: immutable release build marker |
| F-02 | `apps/web-ops` has no authentication (its own page warns it must not be deployed) | any deployment would expose an ops surface | remains undeployable until P2.4; P2.4 exit includes the authenticated shell |
| F-03 | API idempotency `preHandler` validates header shape only; no store or replay | duplicate side effects on retry | P2.1 persistent idempotency store |
| F-04 | API error filter maps every `HttpException` < 500 to `WAYVRO_E_VALIDATION` | 401/403/409/429 semantics lost | P2.1 explicit `WayvroError` mapping + new codes |
| F-05 | Worker outbox relay and idempotent consumer are unwired (explained Knip production exception) | — | P2.1 wires the PostgreSQL job runner; outbox relay wired in P2.7 when its first consumer exists, removing the exception |
| F-06 | Realtime binds `DenyAllAuthenticator` | fail-closed today (correct) | P2.1 session-token authenticator |
| F-07 | Android permission allowlist forbids CAMERA | KYC capture needs it | P2.8 change with founder review (allowlist rule) |
| F-08 | Local compose PostgreSQL user is the database owner | grant tests would pass vacuously | Phase 2 integration tests run as the restricted roles |
| F-09 | OpenTelemetry SDK starts with no instrumentations and no trace propagation | audit correlation relies on request ids only | acceptable for Phase 2; I07 (Phase 4) |

## 8. Proposed gaps, clarifications and contradictions (no register change made)

### 8.1 Proposed new requirement (needs founder/ChatGPT approval before the register changes)

| Proposal | Why existing IDs do not cover it | Proposed ID / priority / phase | Dependencies | Tests |
|---|---|---|---|---|
| **GAP-P2-01 — Minimum-age eligibility for Wayvro accounts.** Account creation requires an age attestation against a counsel-set minimum age; reports or evidence of an under-age account holder lead to a reason-coded ACCOUNT restriction with appeal; driver applicants must meet the licence-derived and counsel-set minimum age (checked by the reviewer against the CNIC date of birth); no age is inferred from images | Only L21 (P3, Phase 12) mentions minors, and only to disable a teen programme; the role model lists "under-age" as an AccountRestriction example but no requirement defines the rule, the attestation, the threshold or the handling; store age-rating and terms depend on it | next free A-family id (A01–A14 are taken; proposal **A15**, assigned only through the generator sources after approval) · **P0** · target phase **2** · external blocker "Counsel-approved minimum-age policy" (EG-23) | A04, R09, V13, K14 | unit (attestation required), api-e2e (restriction path), legal-review |

### 8.2 Clarifications (interpretation only; IDs/priorities unchanged — approval requested)

| CL | IDs | Clarification |
|---|---|---|
| CL-P2-01 | A02, A05 | E-mail is not collected in Phase 2; as a future contact/receipt channel it is DESIGN_NOW_ACTIVATE_LATER (needs transactional e-mail, Q41). "Contact edits" in Phase 2 = phone change with re-verification. |
| CL-P2-02 | K02 | "Redacted extraction" in Phase 2 = applicant-typed claims, reviewer confirmation and masked display; no OCR/extraction service (FD-06). |
| CL-P2-03 | H02, T18 | Reviewer conflict-of-interest baseline (no review of own/declared-related accounts) is implemented in Phase 2 because reviewers exist from Phase 2; T18's broader programme stays Phase 6. |
| CL-P2-04 | D04, K05 (role model §3) | Housekeeping terminals `WITHDRAWN` and `EXPIRED_DRAFT` are added to the application machine; `SUSPENDED` is derived from an active DRIVER_ROLE restriction rather than stored. Canonical semantics unchanged. |
| CL-P2-05 | W07 | "Approval-gated bulk exports" = deny-by-default plus a maker-checker export workflow with one ops export type (expiry roster) in Phase 2. |
| CL-P2-06 | Q06 | Phase 2 satisfies Q06 for authentication/identity surfaces; fare/driver-abuse limits are re-verified when those surfaces ship (Phase 3/4, with E09). |
| CL-P2-07 | R04 | Insurance evidence/coverage modelling is Phase 2; "claims contact linked to incidents" completes with incidents (Phase 6; N15 Phase 9). |
| CL-P2-08 | R46 | Artefact modelling and revalidation logic are Phase 2; the dispatch district-coverage check uses them in Phase 4 (K12/E08). |
| CL-P2-09 | A04, W05, R09 | Production boot refuses placeholder legal texts for required policies; placeholders are allowed only in local/test/staging and are visibly marked. |
| CL-P2-10 | K11, Q36 | KYC uploads have embedded metadata (EXIF/GPS etc.) removed before vault storage. |
| CL-P2-11 | H01 | The "SSO/MFA" clause is met in Phase 2 by WebAuthn-native staff MFA; SSO federation with a company IdP is an activation (EG-19). |
| CL-P2-12 | V13, D03 | Document expiry blocks earning through live evaluation at every check, not through system-created restriction rows. |

### 8.3 Contradictions / deviations found

| # | Where | Issue | Proposed resolution |
|---|---|---|---|
| CON-P2-01 | Phase 0 architecture §1 (BullMQ worker) vs ADR-004 (`SKIP LOCKED` reserved for job claiming) | two queue designs | ADR-042: PostgreSQL job table; BullMQ not added |
| CON-P2-02 | docs/07 entity list (separate role/account restriction tables; separate document tables; `mode_preferences`) vs the configurable/V13 needs | conceptual list vs physical design | deviations D-01..D-07 (data model §9); docs/18 §D says conceptual entities are chosen by ADR |
| CON-P2-03 | ADR-027 "Playwright/Maestro start in Phase 3" vs Phase 2 shipping the first real web screens | timing | Playwright moves to P2.2/P2.4 (founder Q-11); Maestro stays Phase 3 |
| CON-P2-04 | ADR-037 "mail catcher when staff notifications (Phase 2) need it" vs this plan's out-of-band staff invitations | no e-mail in Phase 2 | Mailpit not added (no consumer); revisit with CL-P2-01 |
| CON-P2-05 | Phase 0 docs place `ServiceCapability` grant at `VERIFIED → ACTIVE_ELIGIBLE` "training/inspection complete", but training (D20) is Phase 8 | dependency inversion | requirement sets may declare staff-recorded prerequisite markers; for the placeholder set none are mandatory; D20 adds content later |
| CON-P2-06 | `docs/12` Phase 2 gate "seed approved synthetic drivers" vs CLAUDE.md §7 "no hardcoded test users" | apparent conflict | seeds created only by a local-only CLI through the real review path, refusing non-local environments; nothing seeded by migrations |

## 9. Intentionally deferred (with owner phase)

Driver go-online/presence/D26/D27 enforcement (Phase 4); background location and any location permission (Phase 3/4); push tokens and push security notices (Phase 4, S11); e-mail channel (CL-P2-01); OCR and automated liveness/face-match (P2.A5, optional); NADRA (never without access); dues/money (Phase 5); generalised maker-checker framework T24 and suspensions H09 (Phase 6); full localised onboarding UX polish K19 and mode-switch navigation V08 (Phase 3); periodic selfie rechecks K18 (Phase 9); privacy centre/export/correction workflows Q46/Q47/A10 beyond the U06 baseline (Phase 9); fleet-managed onboarding K23 (Phase 12); Semgrep/oasdiff/SBOM gates (oasdiff at Phase 2 exit; others per ADR-027); real-device testing (Phase 3 matrix).

## 10. Founder decisions required

| Q | Decision | Recommendation |
|---|---|---|
| Q-01 | Staff authentication: WebAuthn-native now, SSO federation later? | Yes |
| Q-02 | OIDC sign-in on a device unknown to the account requires a phone OTP step-up before account-changing or driver-scoped actions? | Yes |
| Q-03 | E-mail contact channel: defer (CL-P2-01) or build now with a local mail catcher? | Defer |
| Q-04 | Document capture source: camera-only (recommended for replay resistance) or also gallery import for documents (accessibility/older phones)? Selfie always camera-only. | Camera-only in V1, revisit with field evidence |
| Q-05 | Application-layer field encryption for phone, CNIC, licence/registration numbers, legal name, DOB, OIDC e-mail (HMAC lookup + AES-GCM)? | Yes |
| Q-06 | Consumer session lifetimes (access 15 min; idle 60 days; absolute 180 days)? | Accept as defaults, tune with data |
| Q-07 | Dormancy threshold for the recycled-number recovery review (90 days)? | 90 days until operator data (EG-22) |
| Q-08 | Rider recovery without OIDC or KYC evidence: staff-assisted limited recovery, or "new account only"? | Staff-assisted with strict proof; otherwise new account |
| Q-09 | Approve GAP-P2-01 (minimum age) into the register as P0, Phase 2? | Approve |
| Q-10 | Approve clarifications CL-P2-01..12 and deviations D-01..D-07 / CON-P2 resolutions? | Approve |
| Q-11 | Approve ADR-038..044 and the dependency set (incl. Playwright 1.63.x for web E2E in Phase 2)? | Approve |
| Q-12 | Account-deletion grace period (14 days)? | 14 days pending counsel |
| Q-13 | Mobile navigation/data layer now: `expo-router` + `@tanstack/react-query` in P2.3? | Yes (avoids rewriting in Phase 3) |
| Q-14 | Driver accounts signing in on a new device: require manual selfie re-check before earning (enforced from Phase 4)? | Yes |
| Q-15 | W07 exports: ship the expiry-roster export with maker-checker, or no export type in Phase 2? | Ship the single export |

## 11. Readiness

The plan is internally consistent across the 13 documents (54 IDs mapped to micro-phases, gates, tests and acceptance evidence) and is **ready for implementation-plan external review**. It is **not** ready for implementation until the founder answers §10 — Q-05, Q-06, Q-10 and Q-11 block P2.1; Q-13 blocks P2.3; Q-01 blocks P2.4; the rest block their own micro-phases — and authorises P2.1 explicitly. External gates EG-01..EG-23 remain open; none is claimed resolved.
