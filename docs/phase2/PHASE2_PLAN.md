# PHASE2_PLAN — Identity, Authentication, Account Security and Controlled Driver/Partner Onboarding (PROPOSED)

> Current repository status (2026-10-11): this document is a historical planning/checkpoint snapshot. Phase 2 later completed P2.1–P2.10 plus closure and merged via PR #4 at merge commit `7da51b0`. For current status use `docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md` and root status docs.

**Date:** 2026-10-10 · **Branch:** `docs/phase-2-planning` (from `main` @ `3a1402f9d530ff1a384082c6a912a91152bfffc8`; first planning commit `e319aef`; founder/ChatGPT planning-closure correction applied the same day) · **Status:** **PLAN PASSED FOUNDER/CHATGPT REVIEW (2026-10-10); reviewed technical closure SHA `47b16831622cefd904c8da30c4b6ed766f7b9252`; requirement baseline 532; Phase 2 scope 55. PHASE 2 IMPLEMENTATION NOT STARTED — P2.1 requires separate explicit founder authorisation after this planning integration. No Phase 2 product code, migration, dependency, provider account, OTP or real identity data exists or was used.** · **Agent:** Claude Code (self-audit, not independent verification).

**Implementation status (2026-10-10):** micro-phase **P2.1** (consumer identity/session core + production test-double isolation) is implemented on branch `phase-2/1-identity-session-core` — **pending founder/ChatGPT review, not merged**. Record: `docs/phase2/PHASE2_P2_1_IMPLEMENTATION_RECORD.md`; decisions ADR-038, ADR-042, ADR-045 (`docs/adr/README.md`). Every P2.1 requirement remains PARTIAL as a whole (later micro-phases and external gates); P2.2+ not started.

## 1. Authority and inputs
Authority order: law/safety obligations and founder decisions → audited repository truth → Phase 1 ADRs (`docs/adr/README.md`) → Phase 0 artefacts and the requirements register (`docs/requirements-register.json`, schema 5.1) → canonical docs. Inputs read: `CLAUDE.md`, `README.md`, `ALL_FILES_INDEX.md`, the full register, docs 05, 07, 10, 12, 14, 15, 18, 22, 27, 28, `docs/phase0/*` (role model, journeys, security/privacy, ADR backlog, launch blockers, gap report, closure handoff, architecture, guardrails, cost/provider matrix, research R2/R4/R5), `docs/phase1/PHASE1_HANDOFF_REPORT.md`, all Phase 1 ADRs, an inventory of every Phase 1 app/package/config/migration/CI file, and the founder/ChatGPT planning-closure correction.

## 2. Repository truth verified before planning (2026-10-10)

| Check | Result |
|---|---|
| `main` (local and `origin`) | `3a1402f9d530ff1a384082c6a912a91152bfffc8` (as expected) |
| Worktree / origin / identity / `gh` | clean; `haseeb1229/wayvro`; `Muhammad Haseeb <abdulhaseeb1229@gmail.com>`; `haseeb1229` |
| Ruleset on `main` | "main — PR + required CI", active |
| Phase 1 product surface | none: only `0000_postgis.sql`; no auth, rate limiting, idempotency store, audit, outbox table, job wiring, mobile navigation/secure storage/HTTP client; web-ops unauthenticated |

## 3. Scope

- Original verification: `phase0.target_phase = 2` = **54 IDs** (P0 49, P1 5: A11, K15, K16, K17, K22), exactly matching the founder list.
- Planning closure: founder/ChatGPT approved the gap **A15** (P0, target phase 2), added through the canonical generator workflow (separate post-Phase-0 additions source `docs/phase0/tools/coverage-map-additions.js`). Register **531 → 532** (P0 217 / P1 209 / P2 89 / P3 17; dispositions NOW 396 / LATER 107 / EXTERNAL_DECISION 26 / OUT_OF_SCOPE 3). **Phase 2 scope = 55 IDs (P0 50, P1 5).** The original 54 entries are byte-identical; no ID deleted or re-prioritised.
- **A15 canonical wording:** "Wayvro must maintain a counsel-approved age and guardian eligibility policy. Consumer signup collects only the minimum age declaration/evidence necessary for that policy; driver/partner eligibility uses verified date-of-birth/licence and applicable regulatory requirements. Under-age/guardian/teen handling must be explicit, reason-coded and privacy-minimised, and future guardian/teen programmes must not require replacing the core identity model." External blocker: counsel/product decision on age thresholds and guardian rules (EG-23).
- Classification (`docs/phase2/PHASE2_EXTERNAL_GATES.md` §3): **21 IMPLEMENTABLE_NOW · 31 NOW + GATED_ACTIVATION · 3 EXTERNAL_GATED (K22, Q44, Q45)**. Traceability: `docs/phase2/PHASE2_REQUIREMENT_MATRIX.md`.

## 4. Document map

| Document | Owns |
|---|---|
| `docs/phase2/PHASE2_PLAN.md` | overview, findings, gaps/clarifications/contradictions, deferrals, founder decisions, closure record, readiness |
| `docs/phase2/PHASE2_REQUIREMENT_MATRIX.md` | per-ID class, micro-phase, surfaces, gates, domain/API/DB/UI/authz/controls/tests (55) |
| `docs/phase2/PHASE2_DOMAIN_AND_DATA_MODEL.md` | identity uniqueness semantics, schemas/roles, entities, state machines, capability derivation, restrictions, consent/age, crypto envelope and rotation, PII classes, deviations, migrations |
| `docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md` | OTP, sessions, step-up, new-device risk policy, recycled SIM/SIM swap/strong-proof recovery, OIDC, test-double isolation, consumer authorization, error codes, telemetry |
| `docs/phase2/PHASE2_KYC_AND_EVIDENCE_VAULT.md` | KYC boundary, onboarding, capture sources, accessible challenge, document matrix, upload pipeline, image sanitisation evaluation, encryption, reviewer access, manual review, dedupe, future provider, DPIA/data-location inputs |
| `docs/phase2/PHASE2_STAFF_AUTHORIZATION_MATRIX.md` | staff realm, WebAuthn, roles/attributes, matrix, reason-for-access, no exports, break-glass, audit |
| `docs/phase2/PHASE2_API_AND_SURFACES.md` | endpoint inventory with security attributes; mobile, web-ops, web-public plans |
| `docs/phase2/PHASE2_SECURITY_AND_ABUSE_MODEL.md` | threats T-01..T-41, fail-closed checklist, residual risks, playbooks |
| `docs/phase2/PHASE2_EXTERNAL_GATES.md` | status vocabulary, EG-01..EG-23, classification, vendor template, activation tracks P2.A1..A9 |
| `docs/phase2/PHASE2_TEST_STRATEGY.md` | layers, families, acceptance evidence for all 55 IDs |
| `docs/phase2/PHASE2_IMPLEMENTATION_SEQUENCE.md` | micro-phases P2.1–P2.10, activation tracks, exit-gate mapping |
| `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md` | ADR-038..045, dependency rules, rejected/deferred packages |
| `docs/phase2/PHASE2_IMPLEMENTATION_PROMPT_PROPOSED.md` | proposed P2.1 prompt (not an authorisation) |

## 5. Decisions (summary)
- **Identity semantics:** one current verified phone ↔ at most one active account, one account ↔ at most one current verified phone (both DB invariants); one-account-per-person is an intent enforced by signals, review and recovery — **never** a database claim; histories never merged.
- **Auth/session:** domain implemented directly (ADR-038 with binding conditions — not "safer", not novel crypto); opaque SHA-256-hashed tokens; 15 min access / 60-day idle / 180-day absolute as configurable defaults; rotating refresh with reuse detection; immediate revocation; realtime on the same session.
- **OTP:** +92 mobile only; CSPRNG code stored as keyed MAC; 5 min / 5 attempts; escalating resend; multi-dimensional limits and spend stop; limiter fail-closed; honest outages; no master/bypass codes; recording sink only in local runners and never EG-01 evidence.
- **F-01:** test doubles physically absent from production artefacts from P2.1 (ADR-045) with CI proof; runtime checks remain defence in depth.
- **Crypto:** versioned AES-256-GCM envelope (version, algorithm, key id, random 96-bit nonce, tag, ciphertext; AAD binds field/row/schema version); key states and non-destructive rotation; HMAC lookups with key versions in side index tables (dual-write → backfill → dual-read → switch → contract).
- **OAuth:** link only from step-up-fresh sessions; `(provider, sub)`; no account creation via OIDC; unknown-device OIDC sessions need phone step-up; no e-mail merges; flags off; externally gated.
- **Recovery:** historical recovery only with strong pre-existing proof (linked OIDC; driver KYC case with maker-checker); rider-only without it ⇒ new clean account, old account `SECURITY_HOLD`.
- **KYC:** guided capture; documents by camera **or** controlled import through one pipeline (source = metadata, never proof); selfie camera-only; optional accessible challenge; human review and in-person path; no OCR/ML/score; automated vendors only as advisory signals after gates.
- **Vault:** quarantine → scan → **mature isolated decode/re-encode** (evaluated first in P2.6) → verify → hash → encrypt → vault; separate DB role; one-time reason-gated staff views.
- **Staff:** WebAuthn-native (two authenticators before real privileged KYC operation), BFF, code-defined roles + ABAC, maker-checker, break-glass, sealed audit; no emergency credentials.
- **Restrictions:** scoped table with FK + CHECK per scope; driver restrictions never block rider use; `RISK_HOLD` for risk-triggered earning holds; expired documents block through live evaluation.
- **Exports:** none in Phase 2; paginated scoped rosters only.
- **Deletion/retention:** app (step-up) and web (OTP) requests, 14-day configurable grace pending counsel, blocker rows, pseudonymisation, evidence deletion unless legal hold, retention placeholders until EG-16.

## 6. Micro-phases
P2.1 identity/session core + test-double isolation → P2.2 policies, consent, age policy, legal pages → P2.3 mobile account slice → P2.4 staff realm + web-ops shell → P2.5 compliance domain, requirement sets, age checks, restrictions → P2.6 vault (image-processing evaluation first) → P2.7 review/appeals/expiry → P2.8 mobile onboarding → P2.9 recovery/SIM safeguards/risk holds/deletion/hardening → P2.10 OIDC (flags off). Activation tracks P2.A1–P2.A9 only when gates clear.

## 7. Repository findings (Phase 1 code)

| # | Finding | Planned handling |
|---|---|---|
| F-01 | Test doubles ship inside the production package `@wayvro/provider-interfaces`; refusal relies on `WAYVRO_ENV` only | **P2.1** (ADR-045): dev-only double package, production-only artefacts, release marker, static rules, CI ART-ISO; runtime refusal kept |
| F-02 | web-ops has no authentication | undeployable until P2.4 |
| F-03 | idempotency `preHandler` validates shape only | P2.1 persistent store |
| F-04 | error filter maps every `HttpException` < 500 to `WAYVRO_E_VALIDATION` | P2.1 explicit mapping |
| F-05 | worker relay/consumer unwired (Knip exception) | job runner P2.1; relay P2.7 with first consumer |
| F-06 | realtime binds `DenyAllAuthenticator` (fail-closed) | P2.1 session authenticator |
| F-07 | CAMERA forbidden in the Android allowlist | P2.8 with founder review; import must add no storage permission |
| F-08 | local DB user owns everything | tests run as restricted roles |
| F-09 | OTel without instrumentations/propagation | acceptable for Phase 2; I07 Phase 4 |

## 8. Gaps, clarifications and contradictions

### 8.1 New requirement — APPROVED and applied
**GAP-P2-01 → A15** (P0, Phase 2), revised wording in §3, added via the generator (`coverage-map-additions.js`, register block `post_phase0_additions`, docs/03 dated block). No hard-coded threshold; no rider DOB unless the approved policy requires it.

### 8.2 Clarifications (interpretation only; IDs/priorities unchanged) — reconciled in the closure pass (Q-10)

| CL | IDs | Clarification |
|---|---|---|
| CL-P2-01 | A02, A05 | E-mail not collected in Phase 2 (deferred, Q-03); "contact edits" = phone change with re-verification |
| CL-P2-02 | K02 | "Redacted extraction" = applicant claims + reviewer confirmation + masked display; no OCR |
| CL-P2-03 | H02, T18 | reviewer conflict-of-interest baseline implemented in Phase 2 |
| CL-P2-04 | D04, K05 | housekeeping terminals `WITHDRAWN`/`EXPIRED_DRAFT`; `SUSPENDED` derived from an active DRIVER_ROLE restriction |
| CL-P2-05 | W07 | **(changed)** "approval-gated bulk exports" = deny-by-default rule; **no export capability in Phase 2**; paginated, authorization-scoped rosters in web-ops; any future export needs permission, reason, maker-checker, expiry, audit, minimisation and a demonstrated need |
| CL-P2-06 | Q06 | Phase 2 covers auth/identity surfaces; fare/driver abuse re-verified in Phase 3/4 |
| CL-P2-07 | R04 | incident linkage completes in Phase 6 |
| CL-P2-08 | R46 | dispatch district check in Phase 4 |
| CL-P2-09 | A04, W05, R09, A15 | production refuses placeholder legal texts and placeholder age policy |
| CL-P2-10 | K11, Q36 | evidence metadata removed **by construction** through decode/re-encode (not a hand-written stripper) |
| CL-P2-11 | H01 | "SSO/MFA" met by WebAuthn-native MFA now; federation later (EG-19) |
| CL-P2-12 | V13, D03 | expiry blocks via live evaluation, not restriction rows |
| CL-P2-13 | K01, D01 | **(new)** phone↔account uniqueness is a DB invariant; person-level uniqueness is not — handled by signals, review, recovery and safe credential movement; no history merges |
| CL-P2-14 | K02, D02 | **(new)** documents: camera or controlled import through one pipeline, source is metadata only; selfie: camera only |
| CL-P2-15 | K03 | **(new)** capture challenge optional, accessible, alternatives available, never sole rejection reason, never "liveness" |
| CL-P2-16 | K17, K18, D27 | **(new)** driver re-verification is risk-triggered (`RISK_HOLD` + `REVERIFICATION` case), not universal on new devices; real selfie re-checks stay DPIA-gated |

### 8.3 Contradictions / deviations

| # | Issue | Resolution |
|---|---|---|
| CON-P2-01 | BullMQ (architecture §1) vs `SKIP LOCKED` (ADR-004) | ADR-042 PostgreSQL jobs |
| CON-P2-02 | docs/07 conceptual entity list vs configurable/V13 physical design | deviations D-01..D-07 (data model §10) |
| CON-P2-03 | ADR-027 Playwright "Phase 3" vs Phase 2 first real web screens | Playwright from P2.2/P2.4 (seasoned stable line chosen then) |
| CON-P2-04 | ADR-037 mail catcher "Phase 2" vs no e-mail in Phase 2 | not added (Q-03 defer) |
| CON-P2-05 | training/inspection marker at `VERIFIED → ACTIVE_ELIGIBLE` vs D20 in Phase 8 | requirement sets may declare staff-recorded markers; placeholder set has none mandatory |
| CON-P2-06 | docs/12 "seed approved synthetic drivers" vs CLAUDE.md §7 "no hardcoded test users" | local-only seed CLI in development tooling through the real review path |
| CON-P2-07 | first plan's wording "exactly one account per human/verified phone" | corrected to the canonical semantics (CL-P2-13) |
| CON-P2-08 | first plan's hand-written image parser as boundary | replaced by mature isolated decode/re-encode evaluation (ADR-041) |
| CON-P2-09 | `CLAUDE.md` §16 "531-ID register" after A15 | count wording updated to 532 with provenance |

## 9. Intentionally deferred
Driver presence/D26/D27 enforcement (Phase 4); any location permission (Phase 3/4); push and push notices (Phase 4); e-mail channel (Q-03); OCR and automated liveness/face-match (P2.A5, optional); NADRA (never without access); money/dues (Phase 5); generalised maker-checker T24 and suspensions H09 (Phase 6); localised onboarding polish K19 and mode navigation V08 (Phase 3); periodic selfie rechecks K18 (Phase 9); privacy centre/export/correction Q46/Q47/A10 beyond U06 (Phase 9); fleet onboarding K23 (Phase 12); guardian/teen programmes (L21, Phase 12, disabled); bulk exports (until a demonstrated need); real-device testing (Phase 3 matrix).

## 10. Founder decisions (final, recorded 2026-10-10)

| Q | Decision |
|---|---|
| Q-01 | **YES** — WebAuthn-native staff authentication now; company SSO federation later |
| Q-02 | **YES** — unknown-device OIDC sessions require phone step-up before account-changing or driver-sensitive actions |
| Q-03 | **DEFER** — e-mail contact channel |
| Q-04 | **Documents:** guided camera capture **plus** controlled gallery/file import, all through the identical pipeline, source recorded as metadata only; **selfie:** camera only |
| Q-05 | **YES** — application-layer field encryption with the versioned envelope, AAD, key states and non-destructive rotation rules (data model §8) |
| Q-06 | **ACCEPT** as configurable defaults: access 15 min, idle 60 days, absolute 180 days |
| Q-07 | **90 days** only as a provisional local/test risk threshold; not a PTA/MNO fact; production tuning gated by EG-22 |
| Q-08 | **Strong-proof-only** historical recovery (linked OIDC; driver KYC case); otherwise a new clean account; old account `SECURITY_HOLD` |
| Q-09 | **APPROVE** revised A15 (applied: register 532) |
| Q-10 | **APPROVE** only after this closure pass reconciles clarifications/deviations — reconciled in §8 (CL-P2-01..16, D-01..D-07, CON-P2-01..09); final acceptance rests with the reviewer |
| Q-11 | **CONDITIONAL** approval of ADR-038..044 direction under the installation-time maturity/security re-check; ADR-045 added |
| Q-12 | **14-day** configurable deletion grace pending counsel |
| Q-13 | **YES** — Expo Router + TanStack Query in P2.3, versions re-checked at install |
| Q-14 | **Risk-triggered** driver re-verification, not universal on new devices |
| Q-15 | **NO** Phase 2 bulk export |

## 11. Closure record (2026-10-10)
Applied: account-identity semantics; F-01 artefact isolation moved into P2.1; versioned crypto envelope and rotation; strong-proof-only rider recovery; A15 via generator (532/55); document capture sources and camera-only selfie; accessible optional challenge; mature isolated image decode/re-encode replacing the hand-written parser; relational-integrity changes (appeal evidence, application categories, review-case and duplicate-signal subjects, decision evidence, role-assignment cities and deletion blockers as FK/junction structures; districts seeded for permit FKs); no Phase 2 export; risk-triggered re-verification; configurable session/dormancy defaults; staff two-authenticator rule without emergency credentials; ADR-038 caveats; conditional dependency approval with installation-time re-checks; recording-sink semantics. Count references updated in `README.md`, `ALL_FILES_INDEX.md`, `CLAUDE.md` §16, `docs/00_README_AND_STATUS.md`, `docs/17_QUICK_START.md`, `prompts/PHASE_0_DISCOVERY_CLAUDE.md` status note and `docs/23_FOUNDER_PROMPT_TRACEABILITY.md` (Prompt 7); historical Phase 0/1 records keep their dated counts.

## 12. Readiness
The plan is internally consistent across the 13 documents (55 IDs mapped to micro-phases, gates, tests and acceptance evidence). **Acceptance (2026-10-10): the Phase 2 plan PASSED founder/ChatGPT review at reviewed technical closure SHA `47b16831622cefd904c8da30c4b6ed766f7b9252`** and is integrated into `main` as planning documentation only. Implementation has not started; P2.1 requires a separate explicit founder authorisation. External gates EG-01..EG-23 remain open; none is claimed resolved.
