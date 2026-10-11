# Wayvro v5 — Complete File Index

This file is a navigation aid. Authority remains: founder decisions -> audited repository truth -> approved ADR/current phase -> canonical v5 docs/register. Historical audit files are context only.

## Root
- `CLAUDE.md` — permanent Claude engineering/repository rules; includes the founder-locked **one public Wayvro app** decision.
- `README.md` — package status, read order, requirement totals and workflow.
- `ALL_FILES_INDEX.md` — this index.
- `V5_FILE_MANIFEST.json` — generated SHA-256 manifest for package integrity.
- `V5_VALIDATION_SUMMARY.json` — generated consistency/audit results.

## Canonical product/engineering docs
- `docs/00_README_AND_STATUS.md` — authority, mission, hard stops and release definitions.
- `docs/01_COMPETITION_AND_STRATEGY.md` — competitor synthesis, positioning and topology evidence.
- `docs/02_PRODUCT_HIERARCHY.md` — one Wayvro app: shared account, Rider mode, Driver/Partner onboarding/mode; staff/web/platform hierarchy.
- `docs/03_FEATURE_INVENTORY.md` — human-readable 532-item A–W requirement catalog (511 v5 + 20 Phase 0 additions + A15 from the Phase 2 planning closure, appended).
- `docs/04_LIFECYCLES_DISPATCH_POOLING.md` — account/driver capability, trip, dispatch, pricing, pooling and women-focused lifecycles.
- `docs/05_TRUST_SAFETY_AND_COMPLIANCE.md` — safety, privacy, fraud, legal/compliance and human response.
- `docs/06_TECH_ARCHITECTURE.md` — proposed stack, one-app modular architecture, monorepo, scaling and research spikes.
- `docs/07_DATA_MONEY_API_CONTRACTS.md` — entities/invariants, money, APIs/events, mobile recovery and compatibility.
- `docs/08_DESIGN_SYSTEM_AND_ACCESSIBILITY.md` — professional UI/UX, accessibility, mode-switch UX and screen maps.
- `docs/09_INFRA_BUDGET_AND_PROVIDERS.md` — low-cost/free-first provider matrix and production caveats.
- `docs/10_SECURITY_TESTING_AND_RELIABILITY.md` — threat model, tests, SLO/DR and code hygiene.
- `docs/11_COMPANY_OPERATIONS_AND_GTM.md` — company/operations/launch/marketing/funding readiness.
- `docs/12_PHASE_PLAN_AND_GATES.md` — 13 macro phases, 0–12.
- `docs/13_CLAUDE_ONLY_ENGINEERING_WORKFLOW.md` — Claude-only build, founder approval and ChatGPT repo-evidence review loop.
- `docs/14_ACCEPTANCE_TRACEABILITY_AND_METRICS.md` — requirement record, acceptance journeys, unified-app cases and KPIs.
- `docs/15_RISKS_AND_FAILURE_MODES.md` — unique `RSK-*` risk register including unified-app risks.
- `docs/16_RESEARCH_AND_DECISIONS.md` — dated sources, ADR backlog and v5 unified-app decision/evidence.
- `docs/17_QUICK_START.md` — exact founder handoff sequence.
- `docs/18_IDENTITY_AUTH_AND_KYC.md` — OTP/OIDC/CNIC/selfie/liveness/session/profile/capability model.
- `docs/19_COMPLETENESS_AUDIT_CHECKLIST.md` — cross-surface omission audit.
- `docs/21_MASTER_COVERAGE_MATRIX.md` — canonical coverage domains.
- `docs/22_LAUNCH_BLOCKERS_AND_EXTERNAL_DEPENDENCIES.md` — real-world blockers code cannot approve.
- `docs/23_FOUNDER_PROMPT_TRACEABILITY.md` — original founder prompts plus later explicit corrections mapped to requirements/docs.
- `docs/25_STARTUP_GOVERNANCE_AND_COMPANY_CONTROLS.md` — company governance/finance/access/vendor/physical operations.
- `docs/26_COMPLETENESS_CLOSURE_PROTOCOL.md` — how newly discovered gaps become canonical before coding.
- `docs/27_ENGINEERING_GUARDRAILS_AND_CHANGE_SAFETY.md` — frontend/backend decoupling, migrations, dead code, CI, releases and rollback.
- `docs/28_APP_SURFACES_AND_REPO_TOPOLOGY.md` — authoritative one-public-app role/profile/mode architecture and repo topology.
- `docs/requirements-register.json` — machine-readable 532-item requirement authority (schema 5.1; every ID carries a `phase0` disposition block; post-Phase-0 additions are listed in `post_phase0_additions`).

## Historical audit context (do not override v5)
- `docs/20_V3_A_TO_Z_GAP_AUDIT.md` — historical v3 omissions/corrections.
- `docs/24_V4_SECOND_PASS_GAP_AUDIT.md` — historical v4 second-pass omissions/corrections.

## Claude prompts
- `prompts/PHASE_0_DISCOVERY_CLAUDE.md` — Phase 0 prompt (executed 2026-10-09; output under `docs/phase0/`).
- `prompts/PHASE_REPORT_HANDOFF_TO_CHATGPT.md` — evidence checklist when returning Claude output for review.

## Phase 0 deliverables (2026-10-09; founder-review closure pass applied the same day)
- `docs/phase0/PHASE0_CLOSURE_HANDOFF.md` — **founder/ChatGPT review closure pass (authoritative where it differs from the original handoff)**: recorded founder decisions FD-01..FD-14, corrections, spike schedule, validation, Git baseline.
- `docs/phase0/PHASE0_HANDOFF_REPORT.md` — original Phase 0 handoff report (inspection, research, changes, risks, blockers), superseded in part by the closure handoff.
- `docs/phase0/PHASE0_GAP_REPORT.md` — new gaps (20 IDs), clarifications CL-01..CL-22, duplicates, contradictions, recorded founder decisions FD-01..FD-14.
- `docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json` / `.csv` — every ID → disposition/domain/phase/surfaces/tests/dependencies/blocker (generated by `docs/phase0/tools/phase0-coverage.js`).
- `docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md` — canonical account/profile/capability/restriction/mode model, state machines, invariants.
- `docs/phase0/PHASE0_JOURNEYS_AND_STATE_MACHINES.md` — journey maps with edge states and remaining state machines.
- `docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md` — bounded contexts, monorepo (canonical tree), dispatch/money design, scaling, SLOs.
- `docs/phase0/PHASE0_ADR_BACKLOG.md` — ADR options/recommendations, spike definitions (all NOT RUN).
- `docs/phase0/PHASE0_SECURITY_PRIVACY.md` — STRIDE, abuse cases, DPIA questions, retention proposal.
- `docs/phase0/PHASE0_COMPETITOR_MATRIX.md` — sourced capability matrix and topology evidence.
- `docs/phase0/PHASE0_COST_PROVIDER_MATRIX.md` — free/paid limits, pilot and scale budgets.
- `docs/phase0/PHASE0_LAUNCH_BLOCKERS.md` — external legal/vendor/store/human prerequisites with owners and gates.
- `docs/phase0/PHASE0_ENGINEERING_GUARDRAILS.md` — exact CI/dead-code/contract/migration/release controls; proposed `CLAUDE.md` edits (not applied).
- `docs/phase0/PHASE0_PHASE1_PROMPT_PROPOSED.md` — proposed Phase 1 prompt (do not execute).
- `docs/phase0/research/R1–R6` — sourced research evidence (competitors, regulation, payments, mobile/store, providers/cost, safety/market).
- `docs/phase0/tools/` — coverage maps + generator (`phase0-coverage.js`), manifest/validation regenerator.

## Phase 1 foundation (2026-10-09; reviewed and integrated into `main` via PR #1, merge commit `eaa1fcb`, 2026-10-10)
- `docs/adr/README.md` — index of Phase 1 ADRs (ADR-004, ADR-005, ADR-005b, ADR-010, ADR-027, ADR-030, ADR-034, ADR-036, ADR-037) with evidence, plus the P2.1 ADRs (ADR-038 consumer auth/session, ADR-042 PostgreSQL jobs, ADR-045 production test-double isolation) — accepted on P2.1 evidence, pending review.
- `docs/operations/developer-setup.md` — clean-machine setup, infrastructure, build/test and Android commands.
- `docs/phase1/PHASE1_HANDOFF_REPORT.md` — Phase 1 handoff (scope, spike verdicts, traceability, verification, NOT RUN items, risks); `docs/phase1/evidence/` — mobile release gate reports.
- `apps/` — deployable skeletons: `api` (NestJS + Fastify), `worker`, `realtime` (Socket.IO), `wayvro-mobile` (the ONE Expo app), `web-public`, `web-ops` (Next.js). No product features.
- `packages/` — `contracts`, `domain`, `config`, `observability`, `provider-interfaces`, `db`, `server-runtime`, `web-security`.
- `infra/docker/` — Compose project `wayvro` (PostGIS, Valkey, SeaweedFS); `infra/ci/android/` — 16 KB/ABI and permission gates.
- `scripts/` — `infra.mjs`, `boot-smoke.mjs`, `android-build.mjs`; `.github/workflows/ci.yml` — CI.
- `tests/spikes/` — disposable SP-AND / SP-03 / SP-05 / ADR-010 evidence harnesses with results (see `tests/spikes/README.md`).

## Phase 2 planning (PLAN PASSED founder/ChatGPT review 2026-10-10; reviewed technical closure `47b1683`) and implementation (P2.1 implemented on branch `phase-2/1-identity-session-core`, pending founder/ChatGPT review, not merged; P2.2+ not started)
- `docs/phase2/PHASE2_PLAN.md` — overview, repository findings, proposed gap/clarifications/contradictions, deferrals, founder questions, readiness; it indexes the other twelve Phase 2 planning documents in `docs/phase2/` (requirement matrix, domain/data model, auth/session, KYC/evidence vault, staff authorization matrix, API/surfaces, security/abuse model, external gates, test strategy, implementation sequence, ADR/dependency proposals, proposed P2.1 prompt).
- `docs/phase2/PHASE2_P2_1_IMPLEMENTATION_RECORD.md` — P2.1 per-ID status (P2.1 portion vs whole requirement), refinements R-01..R-15 of the accepted plan, test-evidence index, residual risks.

## Current baseline
- Product: **Wayvro (WAY-VRO)**.
- Public mobile distribution: **one Wayvro app** with Rider mode and optional approved Driver/Partner profile/mode.
- Proposed requirements: **532** (P0 217 / P1 209 / P2 89 / P3 17): 531 after Phase 0 plus A15 (Phase 2 planning closure, 2026-10-10); dispositions NOW 396 / LATER 107 / EXTERNAL_DECISION 26 / OUT_OF_SCOPE 3.
- Macro phases: **13** (Phase 0 through Phase 12).
- Coding/planning AI: **Claude Code only**.
