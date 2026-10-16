# Wayvro — Founder Planning Pack — Claude-Only v5

**Date:** 2026-10-09  
**Product:** `Wayvro` (pronounced **WAY-VRO**)  
**Owner:** founder; intended GitHub owner `haseeb1229`  
**Status (2026-10-16):** **Phase 0 complete** (dispositioned; founder-review closure 2026-10-09, `docs/phase0/PHASE0_CLOSURE_HANDOFF.md`) — **Phase 1 complete and merged** (PR #1, merge commit `eaa1fcb`, 2026-10-10) — **Phase 2 plan complete** (reviewed 2026-10-10, `docs/phase2/PHASE2_PLAN.md`) — **Phase 2 engineering P2.1–P2.10 plus closure complete and merged via PR #4, merge commit `7da51b0` (2026-10-11)**: identity and sessions, consent, staff realm, and controlled Driver/Partner onboarding with manual KYC review in the one app (`docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md`). External gates **EG-01..EG-23 remain open**; **not production-ready**; **Phase 3 engineering run (P3.0–P3.10) is at closure on branch `phase-3/maps-quotes-unified-ux` and open for review as a pull request — not merged and not complete**: catalog/zones, geo gateway, server-authoritative quotes, release controls, the unified-app Rider/Driver shell, localisation/accessibility and mobile E2E tooling exist with synthetic data only. Repository-owned engineering closure is **PASS** on `4bf4803` (all required checks, the 4-shard Mobile E2E 14/14 and the full matrix green in CI); of the 29 Phase 3 IDs, 8 are ENGINEERING_SATISFIED, 21 PARTIAL_EXTERNAL_GATED and 0 BLOCKED; macro Phase 3 is **EXTERNAL BLOCKED**: SP-01/SP-02/SP-04 real-world evidence and the FA-09 native review are missing, so no provider, renderer or background-location freeze exists (`docs/phase3/PHASE3_IMPLEMENTATION_RECORD.md`); no dispatch, trip or payment slice exists; the plan was reviewed and merged via PR #7 (`b1a1986`); the Android CI cache/disk repair merged via PR #6 (`058fcea`). Requirements **532**, Phase 2 scope **55**; decisions in `docs/adr/README.md`

`Wayvro` is founder-locked as the product name unless the founder explicitly changes it. This does **not** imply SECP/company-name availability, IPO Pakistan trademark clearance, domain/app-store/social-handle availability, or legal freedom to use; those remain Phase-0/external validation items.

## What v5 corrects
v5 supersedes v4.1. The previous v4.1 package incorrectly made separate Rider and Driver store apps the default. That is now removed.

**Founder-locked public mobile decision:** Wayvro will use **one public mobile app**. Every normal account can use Rider mode. A user may apply for a Driver/Partner profile inside the same account and, once approved, switch between Rider and Driver/Partner modes without installing a second Wayvro app. Server-side capability/authorization — not the visual mode switch — controls access.

This design has a real industry precedent: current inDrive distribution supports rider, driver and delivery-partner use in one app. Other competitors such as Yango/Bykea/Uber use separate driver apps; therefore app topology is a product/engineering decision rather than an industry rule. Wayvro intentionally chooses the unified-app model and adds explicit permission, security, regression, performance and mode-isolation controls to make it production-safe.

v5 also preserves the earlier A-to-Z baseline: identity/KYC, OTP/OAuth, rides, dispatch, pricing, payments, support, safety, pooling, women-focused mobility, delivery/intercity/corporate/fleet expansion, infra/SRE, company governance, Punjab launch blockers and Claude-only engineering workflow.

## Non-negotiable ambition
- Build a professional, expandable Pakistani mobility marketplace capable of competing on product quality with inDrive/Yango/Bykea and learning from Uber/Careem patterns without copying proprietary code/design.
- One polished public Wayvro mobile app with Rider and Driver/Partner modes, plus separately secured staff/business web surfaces where appropriate.
- Production-grade backend, dispatch, location, money, audit, trust/safety and operations — not a demo backend hidden behind attractive UI.
- Free/low-cost development where sensible, but no architecture that depends on hobby-tier reliability forever.
- Document the full feature universe, build in gated vertical slices, and activate risky capabilities only after their own legal/safety/operational gates pass.

## Read order
0. `CLAUDE.md` — permanent Claude/repository rules
1. `docs/00_README_AND_STATUS.md`
2. `docs/01_COMPETITION_AND_STRATEGY.md`
3. `docs/02_PRODUCT_HIERARCHY.md`
4. `docs/03_FEATURE_INVENTORY.md`
5. `docs/04_LIFECYCLES_DISPATCH_POOLING.md`
6. `docs/05_TRUST_SAFETY_AND_COMPLIANCE.md`
7. `docs/06_TECH_ARCHITECTURE.md`
8. `docs/07_DATA_MONEY_API_CONTRACTS.md`
9. `docs/08_DESIGN_SYSTEM_AND_ACCESSIBILITY.md`
10. `docs/09_INFRA_BUDGET_AND_PROVIDERS.md`
11. `docs/10_SECURITY_TESTING_AND_RELIABILITY.md`
12. `docs/11_COMPANY_OPERATIONS_AND_GTM.md`
13. `docs/12_PHASE_PLAN_AND_GATES.md`
14. `docs/13_CLAUDE_ONLY_ENGINEERING_WORKFLOW.md`
15. `docs/14_ACCEPTANCE_TRACEABILITY_AND_METRICS.md`
16. `docs/15_RISKS_AND_FAILURE_MODES.md`
17. `docs/16_RESEARCH_AND_DECISIONS.md`
18. `docs/17_QUICK_START.md`
19. `docs/18_IDENTITY_AUTH_AND_KYC.md`
20. `docs/19_COMPLETENESS_AUDIT_CHECKLIST.md`
21. `docs/20_V3_A_TO_Z_GAP_AUDIT.md` — historical audit context only
22. `docs/21_MASTER_COVERAGE_MATRIX.md`
23. `docs/22_LAUNCH_BLOCKERS_AND_EXTERNAL_DEPENDENCIES.md`
24. `docs/23_FOUNDER_PROMPT_TRACEABILITY.md`
25. `docs/24_V4_SECOND_PASS_GAP_AUDIT.md` — historical audit context only
26. `docs/25_STARTUP_GOVERNANCE_AND_COMPANY_CONTROLS.md`
27. `docs/26_COMPLETENESS_CLOSURE_PROTOCOL.md`
28. `docs/27_ENGINEERING_GUARDRAILS_AND_CHANGE_SAFETY.md`
29. `docs/28_APP_SURFACES_AND_REPO_TOPOLOGY.md` — current unified-app topology
30. `docs/requirements-register.json` — machine-readable requirements authority until Phase 0 freeze
31. `prompts/PHASE_0_DISCOVERY_CLAUDE.md`
32. `prompts/PHASE_REPORT_HANDOFF_TO_CHATGPT.md`
33. `docs/phase0/PHASE0_CLOSURE_HANDOFF.md` — founder-review closure (authoritative where it differs), then `docs/phase0/PHASE0_HANDOFF_REPORT.md` — original Phase 0 output index; then `PHASE0_GAP_REPORT.md`, `PHASE0_REQUIREMENT_COVERAGE.json/csv`, `PHASE0_UNIFIED_APP_ROLE_MODEL.md`, `PHASE0_JOURNEYS_AND_STATE_MACHINES.md`, `PHASE0_ARCHITECTURE_PROPOSAL.md`, `PHASE0_ADR_BACKLOG.md`, `PHASE0_SECURITY_PRIVACY.md`, `PHASE0_COMPETITOR_MATRIX.md`, `PHASE0_COST_PROVIDER_MATRIX.md`, `PHASE0_LAUNCH_BLOCKERS.md`, `PHASE0_ENGINEERING_GUARDRAILS.md`, `PHASE0_PHASE1_PROMPT_PROPOSED.md`, `research/R1–R6`

## Current baseline totals (after Phase 0, 2026-10-09; A15 added in the Phase 2 planning closure, 2026-10-10)
- **Main phases:** 13, numbered Phase 0 through Phase 12.
- **Proposed atomic requirements:** **532** (511 v5 baseline + 20 Phase 0 additions: B26, D26, D27, E20, G17, M26, N31, Q49, R46, R47, S26, W01–W09 + 1 Phase 2 planning-closure addition: A15).
- **P0:** 217
- **P1:** 209
- **P2:** 89
- **P3:** 17
- Dispositions: NOW 396 · LATER 107 · EXTERNAL_DECISION 26 · OUT_OF_SCOPE 3 (Phase 0: NOW 395 before A15; `docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json`; register schema 5.1 carries a `phase0` block per ID).
- New v5 IDs `V01–V14` make the unified-app/account-role model explicit rather than leaving it as prose; Phase 0 adds D26/D27/M26 to harden it.

All requirements remain **proposed** until Phase 0 assigns disposition, owner/domain, target phase, dependencies, acceptance tests and external blockers.

## Priority codes (canonical since the Phase 0 founder-review closure, 2026-10-09)
- **P0:** Critical platform, safety, security, financial or compliance requirement that must be satisfied before the relevant pilot/release gate.
- **P1:** Committed production requirement that is mandatory when its assigned release/vertical activates. P1 does **not** automatically mean Phase 9; a P1 item in a later vertical (for example pooling, women-focused services, corporate or fleet) is mandatory when that vertical launches.
- **P2:** Advanced/differentiating capability; do not expose prematurely.
- **P3:** Later/optional expansion capability; architecture-aware but not an immediate implementation commitment.

**Timing is controlled by target phase + release gate, not by priority alone.** Each ID's target phase lives in its `phase0` block in `docs/requirements-register.json` (and in `docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json`).

## Workflow
Only Claude Code plans/implements/self-audits repository changes. The founder sends Claude's report and commit/CI evidence to ChatGPT for independent review of the actual repository state when accessible. Qualified humans remain mandatory for launch-sensitive legal, accounting, privacy/biometric, transport, insurance and safety decisions.

## Operating truth
- Current audited repository state + approved founder decisions outrank stale historical notes.
- Architecture/provider choices in this pack are proposals until Phase 0 validates them with current versions, terms, coverage, cost and technical spikes.
- Never claim guaranteed success, zero cost, zero bugs, “safest”, or verified superiority without evidence.
- A large requirement count is not the goal. The goal is **no known material requirement silently left implicit at freeze time**, plus a process that catches future gaps.
