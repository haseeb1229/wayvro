# PHASE 0 — CLAUDE CODE OPUS — A-to-Z DISCOVERY / RE-AUDIT ONLY

> **STATUS: EXECUTED on 2026-10-09 — historical record, do not re-run.** Phase 0 started from **511** requirements (the original v5 baseline); the post-Phase-0 register (`docs/requirements-register.json`, schema 5.1) held **531** requirements (532 after the Phase 2 planning closure added A15 on 2026-10-10), and the founder-review closure pass was applied on 2026-10-09 (`docs/phase0/PHASE0_CLOSURE_HANDOFF.md`). Outputs live under `docs/phase0/`. A future agent must **not** rerun Phase 0 unless the founder explicitly asks; the next work is defined by the founder-approved Phase 1 prompt. The text below is preserved as issued.

You are the sole coding/planning agent for this repository. **Do not implement the product yet. Do not commit or push until the founder authorizes after ChatGPT review.**

## Authority and read order
1. Inspect actual repository state first: branch, HEAD, worktree, remotes, Git identity, CI and existing files. Repository truth outranks stale reports.
2. Read root `CLAUDE.md`, `README.md`, every Markdown document under `docs/` (including historical audit context), and all of `docs/requirements-register.json`. Do not skim. Current v5 authority rules in the root/status/index documents override historical context.
3. Treat v5 as a **discovery proposal to challenge**, not guaranteed complete or legally approved. Historical v3/v4 audit docs may explain how gaps were found but cannot override current v5/founder decisions.
4. Canonical product name is **Wayvro (WAY-VRO)** and is founder-locked. Do not rename/rebrand unless explicitly instructed. Trademark/company/domain/store/social clearance remains unresolved evidence.
5. **Founder-locked public app topology:** ONE public Wayvro mobile app with Rider mode plus optional approved Driver/Partner profile/mode inside the same account. Do not create separate Rider and Driver store apps. Security relies on server-side capabilities/authorization, not the visible mode switch.

## Mission
Produce a Phase-0 freeze proposal for Wayvro: a Lahore/Pakistan-first, production-scale mobility marketplace intended to compete on product quality with inDrive/Yango/Bykea while learning from Uber/Careem patterns without copying proprietary design/code. The founder is a junior developer using Claude Code, so hidden assumptions and vibe-coded shortcuts must be converted into explicit requirements, ADRs, tests and gates.

## Mandatory work
A. **Requirement disposition:** For every register ID (511 at Phase 0 entry; 531 after Phase 0 — see status note above), assign `NOW`, `LATER`, `OUT_OF_SCOPE`, or `EXTERNAL_DECISION`; assign domain owner, target macro phase, dependencies, affected surfaces and acceptance-test families. Never silently delete an ID.

A2. **Founder-prompt traceability:** Verify `docs/23_FOUNDER_PROMPT_TRACEABILITY.md` line-by-line against the founder source prompts and current correction. If an instruction is not represented by canonical IDs/docs, add it before freeze.

B. **Fresh competitor/current-market challenge:** Re-research official/current capabilities of inDrive, Yango Pakistan, Bykea and useful Uber/Careem benchmarks plus Pakistan/Punjab transport/payments/store requirements. Distinguish Pakistan availability from international benchmark. Specifically verify app-topology evidence: inDrive unified rider/driver/delivery-partner app vs competitors using separate driver distributions; do not infer that competitor topology automatically dictates Wayvro architecture.

C. **End-to-end journey maps:** shared account; Rider mode; Driver/Partner application; mode switching; approved driver online/offline; women-focused rider/driver flows; negotiated and fixed pricing; scheduled; low-data; call-center/guest booking; safety incident; cash/digital payment; support/refund; pooling; corporate/fleet; delivery/intercity future. Include denied permission, offline, cancellation, retry, appeal, suspension, expired documents, crash/restart and cross-mode conflict states.

D. **State machines/invariants:** account/profile/capability/restriction; OTP/session/recovery; KYC/document/vehicle eligibility; driver online; quote; bid/offers; assignment; ride lifecycle; scheduled ride; pool membership; payment/ledger/refund/payout; incident; support; document expiry; and unified-app mode switching. Prove no double assignment/charge, no illegal go-online, no unbalanced ledger and no mode-switch bypass of an active obligation.

E. **Architecture ADRs/spikes:** React Native/Expo production feasibility for a single multi-role app (background GPS, lazy initialization, permissions, deep links, camera/KYC, push, navigation, app size/battery); PostGIS/ORM/locking; realtime; location freshness; Lahore maps/navigation; OTP/fallback; Pakistan payments; secure KYC media; device attestation; SLO/RPO/RTO/IaC. Disposable technical spikes may answer architecture questions but must not become premature feature implementation.

F. **Free-first/cost model:** Separate dev/staging from production. Record provider free quota, commercial-use restrictions, sleeping/SLA limits, data/region concerns, estimated breakpoints and migration path. Free tier is not a reliability strategy.

G. **Security/privacy:** STRIDE + abuse cases for unified mobile client, Rider mode, Driver/Partner mode/background worker, staff/admin, KYC, payments, realtime, precise location, pooling and provider webhooks. Include biometric DPIA questions, secrets/PII rules, app attestation, supply-chain/build provenance, staff access and retention.

H. **Operations/legal blockers:** TNC/transport approvals, route permits, vehicle fitness, insurance/takaful, token tax where applicable, PSP/Raast, support/safety staffing, claims, store approvals, corporate/tax/accounting prerequisites. Mark external blockers explicitly; Claude is not legal/accounting approval.

H2. **Startup/company controls:** disposition T01–T25 and show how IP ownership, cap table/governance, people/access/offboarding, finance close/tax calendar, runway, vendors/renewals, physical operations and continuity enter phase gates.

I. **Design system/product quality:** original professional design, not AI-template/copy; low-end/low-data; English/Urdu/Roman Urdu strategy; accessibility; loading/empty/error/offline/retry/permission/microstates. Separate view/presentation from domain/business rules so later visual redesign does not break backend.

I2. **Engineering guardrail audit:** Validate root `CLAUDE.md` and docs/27 against the proposed stack. Propose exact CI, dead-code, dependency-cycle, contract compatibility, migration, security, release, feature-flag cleanup and rollback checks. Do not weaken safeguards for speed.

I3. **Unified app architecture validation:** Treat docs/28 and V01–V14 as the current founder decision. Validate how one public app safely supports Rider and Driver/Partner profiles/modes: server authorization, permissions, background location, data isolation, active-trip conflicts, crash/restart recovery, cross-mode regression, performance, store disclosure and release blast radius. You may propose internal module improvements, but **do not split Wayvro into separate public Rider/Driver apps unless the founder explicitly reopens that decision.**

J. **Traceability:** Build/repair one canonical requirement/ADR/phase/evidence model. No duplicate conflicting roadmaps.

## Engineering safety rules
- No force push/rebase/amend/reset-hard/git-clean/signing-bypass/history rewrite unless a separately reviewed exceptional recovery authorizes it.
- Preserve unrelated work; stage reviewed paths only; no AI co-author/tool attribution.
- No destructive Docker prune/reset or unknown-volume deletion.
- No real CNIC/selfie/payment secrets/API keys in docs/prompts/fixtures/commits.
- Never claim NADRA/police/insurance/payment/emergency integration without real authorization and tested integration.
- Never trust client-side price, role, KYC, payment, trip or mode state.
- Do not choose microservices/Kubernetes/Kafka for scale theatre; evolve modular boundaries on measured need.
- Do not promise 24/7 support/safety until staffed.

## Deliverables for founder/ChatGPT review
1. Exact repo preflight: branch/HEAD/worktree/remotes/Git identity/CI.
2. `PHASE0_GAP_REPORT.md` — new gaps, duplicates, contradictions and dispositions.
3. `PHASE0_REQUIREMENT_COVERAGE.csv/json` — every requirement mapped to disposition/domain/phase/tests/dependencies.
4. `PHASE0_COMPETITOR_MATRIX.md` — current sourced capability vs benchmark vs Wayvro decision.
5. `PHASE0_ADR_BACKLOG.md` — options/tradeoffs/spikes/results/recommendations.
6. `PHASE0_ARCHITECTURE_PROPOSAL.md` — modular context/monorepo/scaling proposal.
7. `PHASE0_UNIFIED_APP_ROLE_MODEL.md` — account/profile/capability/restriction/mode model, permission lifecycle and active-state conflicts.
8. `PHASE0_SECURITY_PRIVACY.md` — threat model, biometric/privacy and abuse controls.
9. `PHASE0_COST_PROVIDER_MATRIX.md` — free/paid limits and production transition.
10. `PHASE0_LAUNCH_BLOCKERS.md` — external legal/vendor/human prerequisites.
11. `PHASE0_ENGINEERING_GUARDRAILS.md` — exact CI/compatibility/migration/dead-code/release controls and any justified edits to `CLAUDE.md`.
12. Proposed Phase-1 bounded implementation prompt — **do not execute it**.
13. Final report: exact files changed, commands/spikes/tests run, outcomes, unverified assumptions, costs, blockers and recommendation whether docs are safe to freeze.

Stop after reporting. Wait for founder/ChatGPT review.
