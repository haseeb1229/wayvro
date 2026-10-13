# Architecture Decision Records

ADRs record decisions with evidence. Numbering follows `docs/phase0/PHASE0_ADR_BACKLOG.md`; that backlog remains the list of **open** decisions, and the files here record decisions taken since Phase 0. An ADR here supersedes the matching backlog row once the founder approves the phase that created it. Until then an ADR is **ACCEPTED on evidence — pending founder/ChatGPT review**.

**Phase 1 status (2026-10-10):** Phase 1 passed founder/ChatGPT review and was merged into `main` (PR #1, merge commit `eaa1fcb`), so the Phase 1 ADRs below are in force and supersede their Phase 0 backlog rows. The open items they record (for example the ADR-005b Phase 4 re-test gate) remain open.

**Phase 2 status (2026-10-11):** Phase 2 (P2.1–P2.10 plus the closure run) passed founder/ChatGPT review and was merged into `main` (PR #4, merge commit `7da51b0`), so the Phase 2 ADRs below are in force and supersede their Phase 0 backlog rows. Their externally gated or unverified clauses stay open: ADR-038 independent security assessment (EG-17) before real users; ADR-040 production OIDC keys and SDKs (EG-06/EG-07); ADR-041 production storage and KMS (EG-05); ADR-043 physical-device and iOS runs.

Every ADR states: status, context, alternatives, evidence (commands, versions, measurements, environment), decision, consequences and reversal path. A failed spike is recorded as FAIL together with the fallback that was executed — history is never rewritten to make a first choice look successful.

## Phase 1 decisions (2026-10-09)

| ADR | Title | Status |
|---|---|---|
| [ADR-004](ADR-004-query-layer-and-migrations.md) | Query layer, migration tooling and assignment locking (SP-03) | ACCEPTED on evidence — SP-03 correctness PASS |
| [ADR-005](ADR-005-api-framework.md) | HTTP API framework (SP-05) | ACCEPTED on evidence |
| [ADR-005b](ADR-005b-realtime-transport.md) | Realtime transport and recovery model (SP-05) | ACCEPTED on evidence — recovery PASS; 2k-herd latency target not met on the dev laptop, re-test gate at Phase 4 |
| [ADR-010](ADR-010-object-storage-local-s3.md) | Local S3-compatible development server (production storage still PROPOSED) | ACCEPTED (local only) |
| [ADR-027](ADR-027-ci-quality-and-dead-code-tooling.md) | CI, dead-code, boundary and security tooling | ACCEPTED on evidence |
| [ADR-030](ADR-030-web-framework-and-version-maturity.md) | Web framework version line (Next.js 16.3.8) and framework-maturity policy | ACCEPTED — founder review correction 2026-10-10 |
| [ADR-034](ADR-034-monorepo-tooling-and-runtime.md) | Monorepo tooling and runtime | ACCEPTED on evidence |
| [ADR-036](ADR-036-android-build-toolchain.md) | Android build toolchain (SP-AND) | ACCEPTED on evidence — SP-AND PASS via the executed fallback (pnpm hoisted layout after an isolated-layout Windows FAIL) |
| [ADR-037](ADR-037-local-development-infrastructure.md) | Local development infrastructure (Docker Compose) | ACCEPTED |

## Phase 2 micro-phase P2.1 decisions (2026-10-10) — in force (reviewed; merged with Phase 2 via PR #4, `7da51b0`)

| ADR | Title | Status |
|---|---|---|
| [ADR-038](ADR-038-consumer-auth-session.md) | Consumer authentication and session domain implemented directly | ACCEPTED on P2.1 evidence — independent assessment EG-17 still required before real users |
| [ADR-042](ADR-042-postgresql-jobs.md) | Background jobs on PostgreSQL (`SKIP LOCKED`), not BullMQ | ACCEPTED on P2.1 evidence |
| [ADR-045](ADR-045-production-test-double-isolation.md) | Production test-double isolation (F-01) | ACCEPTED on P2.1 evidence — ART-ISO 39/39 |

## Phase 2 full-branch decisions (2026-10-11) — in force (reviewed; merged via PR #4, `7da51b0`)

| ADR | Title | Status |
|---|---|---|
| [ADR-039](ADR-039-staff-webauthn-bff.md) | Staff authentication: WebAuthn-native, BFF-held session, code-defined RBAC + ABAC | ACCEPTED on P2.4 evidence |
| [ADR-044](ADR-044-policy-content-package.md) | Policy content as a versioned, immutable workspace package (+ Playwright/axe web E2E) | ACCEPTED on P2.2 evidence |
| [ADR-041](ADR-041-evidence-vault-and-image-sanitiser.md) | Evidence vault: storage client, encryption, malware scanning, isolated image sanitiser (sharp/libvips, one container per image) | ACCEPTED on P2.6 evidence — production hosting P2.A4/EG-05 |
| [ADR-043](ADR-043-mobile-platform-additions.md) | Mobile platform additions for the ONE Wayvro app (P2.3 account slice, P2.8 capture) | ACCEPTED on P2.3/P2.8 build evidence — physical-device runs NOT RUN; CAMERA allowlist APPROVED (founder/ChatGPT, Phase-2 closure) |
| [ADR-040](ADR-040-oidc-verification-with-jose.md) | OIDC ID-token verification with `jose` (Google/Apple linking; never account creation) | ACCEPTED on P2.10 evidence — production EXTERNAL_GATED (EG-06/EG-07) |
| [ADR-047](ADR-047-geo-gateway.md) | Geo gateway: cache, quotas, cost controls, circuit breakers, privacy (Phase 3 P3.2) | ACCEPTED on P3.2 evidence for the tested mechanisms — values are configuration; real provider bundle/terms/prices ADR-006 + SP-04 (EXTERNAL); key custody EG-05 |

## Phase 3 decisions (branch `phase-3/maps-quotes-unified-ux`) — pending founder/ChatGPT review

| ADR | Title | Status |
|---|---|---|
| [ADR-051](ADR-051-service-products-zones-lifecycle.md) | Service products vs vehicle classes, zone sets and the activation lifecycle | ACCEPTED-ON-EVIDENCE (P3.1, local) — real boundaries, eligibility values, legal activation and the rate-card prerequisite source open |
| [ADR-013](ADR-013-pricing-quote-domain.md) | Pricing and quote domain: upfront fixed quotes, rate cards, tax policy, maker-checker configuration | ACCEPTED-ON-EVIDENCE (P3.3, local) — every rate/fee/tax/rounding/TTL value EXTERNAL (FA-15); synthetic values only |

ADR-038 and ADR-042 were corrected on this branch after the P2.1 review (lookup-rotation locking; per-claim lease tokens).

ADR-040 (OIDC/`jose`) was accepted in P2.10 for the server-side verifier; production use stays externally gated.

## Phase 3 implementation decisions (P3.5, 2026-10-13) — on the Phase-3 branch, not yet reviewed or merged

| ADR | Title | Status |
|---|---|---|
| [ADR-048](ADR-048-unified-app-mode-navigation.md) | Unified-app mode, navigation, restoration and intent routing | ACCEPTED on P3.5 unit evidence (EXH-RESTORE, EXH-INTENT) — SP-08/SP-02 device evidence NOT RUN |
| [ADR-019](ADR-019-lite-mode.md) | Lite mode (in-app; auto-suggest from request timing, `detail=lite`) | ACCEPTED on P3.5 unit evidence — PB-12a data budget NOT RUN |
| [ADR-043](ADR-043-mobile-platform-additions.md) (P3.5 addendum) | expo-location 57.0.20, foreground-only (FA-02 APPROVED: COARSE + FINE only) | prebuild manifest verified; release-AAB gates and device behaviour NOT RUN |

**Phase 3 planning (2026-10-12, PROPOSED — no ADR file written):** the planning pack proposes ADR-046 … ADR-052 and the evidence each backlog ADR (ADR-003, -006, -013, -019, -029, -031, -033) needs before acceptance (`docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md`). Finding F-P3-01: the release AAB registers the `exp+wayvro` URL scheme through the auto-applied `expo-dev-client` config plugin, so ADR-043's "no URL scheme" statement and the decode-uri-component exception premise are inaccurate; the correction is planned as the first Phase 3 implementation checkpoint (`docs/phase3/PHASE3_PLAN.md` §6).

Founder-locked decisions that are not repeated here: ADR-001 (name), ADR-026 (one public Wayvro app), ADR-035 (modular monolith baseline) — see the Phase 0 backlog.

## Phase 3 implementation decisions (2026-10-13) — PROPOSED until the Phase 3 review

| ADR | Title | Status |
|---|---|---|
| [ADR-049](ADR-049-app-version-maintenance-runtime-switches.md) | App version policy, maintenance and runtime kill switches (maker-checker, guardrails, 426/503 enforcement, documented fail-open) | PROPOSED — implemented in P3.4; SECURITY expedited path NOT IMPLEMENTED |
| [ADR-050](ADR-050-phase3-performance-budgets.md) | Phase 3 performance budgets (FA-07 values binding; CI size gate; PASS only when measured in the budget's own environment) | ACCEPTED for the values; evidence PARTIAL — PB-04/PB-05 measured PASS in CI on `4347289`; device and staging budgets NOT MEASURED |
| ADR-046 (renderer) / ADR-006 (geo per SKU) | Map renderer and geo provider freeze | **NOT WRITTEN — BLOCKED-EXTERNAL**: no SP-04 field data (FA-05), no provider accounts (FA-06), no SP-02 device (FA-04), FA-19 open; no renderer or provider is installed or bound |
| [ADR-052](ADR-052-mobile-e2e-tooling.md) | Mobile E2E tooling (Maestro 2.11.0 on an emulator), E2E build variant, release-purity/size/SDK-INV/BUNDLE-SECRETS gates, SP-02 fully-drawn marker + instrumented build | PROPOSED — PR tier run locally on an API 35 emulator only (EMULATOR evidence); CI runs and full matrix NOT RUN |
