# 12 — Gated Phase Plan (Milestones, Not Artificial One-Week Deadlines)

Build **vertical slices**. Each phase has a PLAN-only step, founder/ChatGPT plan review, authorization, Claude-only bounded implementation and self-audit, review of actual GitHub diff/CI evidence by ChatGPT where accessible, fixes, integration tests, scope review and founder-approved commit/push. External qualified human safety/security/legal verification is required before live operation. Reuse previous-phase contracts; do not rewrite accepted history. Durations depend on evidence, not arbitrary prompt counts.

## Phase 0 — A-to-Z research, founder validation, technical spikes and documentation freeze
- Re-audit the full v5 register against current inDrive/Yango/Bykea plus Uber/Careem global benchmarks and Pakistan-specific offline/low-data/payment/regulatory needs; classify every ID NOW/LATER/OUT-OF-SCOPE/EXTERNAL-DECISION.
- Inventory current Lahore/Punjab TNC licensing, route permit, fitness, insurance, token tax, privacy/biometric, PSP/Raast, telecom messaging, app-store and vendor terms using primary sources and qualified human follow-up.
- Interview target riders/drivers, document full inventory and competitive wedge. *(Phase 0 note: interviews are founder-run — EXTERNAL_DECISION J07; Claude cannot perform field research.)*
- ADR tradeoffs: mobile maps, auth/OTP, navigation, PostGIS+ORM, realtime and vendor cost.
- Threat model and core state machines + money invariants.
- Architecture technical spikes, including unified-app Rider/Driver mode isolation, just-in-time/background driver location, low-end device performance and atomic assignment.
- Canonical PRD, competitor matrix, traceability and acceptance test plan.
**Gate:** every v5 requirement ID has disposition, owner/domain, target phase and acceptance approach; competitor coverage matrix has no unexplained gap; all fundamental legal/financial/safety/vendor/architecture unknowns are either resolved or explicitly EXTERNAL-DECISION with a launch blocker. No implementation begins from an older v1/v2/v3/v4 prompt. Explicitly trace the founder source prompts plus later founder corrections using docs/23 and apply docs/26 completeness closure.
**Phase 0 execution record (2026-10-09):** deliverables under `docs/phase0/`; all 531 IDs dispositioned; technical spikes SP-01..SP-08 defined but **NOT RUN** (plan-only; founder authorisation FD-13); founder decisions FD-01..FD-14 open; freeze recommendation in `docs/phase0/PHASE0_HANDOFF_REPORT.md`.

## Phase 1 — Safe monorepo, reproducible local environment and architecture validation
- **Early entry (closure pass, FD-13):** bounded spikes SP-AND (Expo/Android build with JDK 17 + 16 KB check), SP-03 (PostGIS + concurrent assignment) and SP-05 (API framework + realtime) record results in ADRs **before** significant scaffold/business-code coupling; failures trigger documented fallbacks. SP-01/SP-02 (background location, rider startup on real devices) and SP-04 (Lahore maps field test) complete before the Phase 3 freezes. Proposed prompt: `docs/phase0/PHASE0_PHASE1_PROMPT_PROPOSED.md`.
- Toolchains verified, workspace bootstrapped, repo CI, Docker PostGIS/Redis/MinIO mocks, lint/strict types, secret rules, ADR and requirements linking.
- Minimal shared contracts and developer documentation; synthetic data only.
**Gate:** clean clone reproducibility, security scan, no secrets, tests, full local boot, no premature business features.
**Phase 1 execution record (2026-10-09; passed founder/ChatGPT review; integrated into `main` on 2026-10-10 via PR #1, merge commit `eaa1fcb`; Phase 2 had not started at that time — see the Phase 2 execution record below):** SP-03 correctness PASS (ADR-004: drizzle-orm + SQL-first migrations; CAS + partial unique indexes); SP-05 correctness/recovery PASS, 2k-herd latency target not met on the dev laptop with a Phase 4 re-test gate (ADR-005 NestJS 12 + Fastify; ADR-005b Socket.IO + Redis adapter); SP-AND PASS through the executed fallback (pnpm hoisted linker after an isolated-linker Windows path-length FAIL; ADR-036, ADR-034). Local infrastructure uses Valkey and SeaweedFS instead of the earlier Redis/MinIO wording (ADR-037, ADR-010). Index: `docs/adr/README.md`.

## Phase 2 — Identity and controlled driver onboarding
- One Wayvro account: +92 phone OTP, session protection, consent and recovery; optional Google/Apple OIDC with safe linking; optional in-app Driver/Partner profile application with CNIC front/back, live selfie/liveness and face-to-ID comparison with human fallback, licence/registration/insurance/permit review, status and appeals. Refer to docs/18 and V01–V14.
- No production KYC vendor or government ID verification is assumed; legal/privacy review and accurate vendor/provider gating required. **V1 boundary (FD-06):** no in-house face-recognition/liveness ML; pilot uses guided capture + human/manual review; automated liveness/face-to-ID only via a vetted provider after DPIA/DPA.
- Document and face data isolated in secure vault; no raw biometric stored in routine profiles/logs.
- Seed approved synthetic drivers; admin authorization matrix and audit.
**Gate:** valid/replay-resistant OTP/session + account-linking tests, driver cannot become ACTIVE on face score alone, spoofed/replayed selfie rejected or escalated, reviewer evidence+appeals, no cross-user access, identity document vault isolation and expiry blocks proven.
**Phase 2 execution record (2026-10-11; P2.1–P2.10 plus the closure run passed founder/ChatGPT review and were merged into `main` via PR #4, merge commit `7da51b0`):** identity/session core, consent and age-declaration mechanism, staff realm, compliance domain, evidence vault, manual review and appeals, Driver/Partner onboarding and document renewal in the one app, recovery and deletion, Google/Apple linking behind flags. The V1 boundary (FD-06) held: no in-house face recognition or liveness; manual review only. External gates EG-01..EG-23 remain open (`docs/phase2/PHASE2_EXTERNAL_GATES.md`); not production-ready. Record: `docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md`. Phase 3 has not started.

## Phase 3 — Maps, quotes and core rider/driver UX
- Map route/provider integration, Lahore geocoding accuracy, vehicle classes/zone policy, server-authoritative quote.
- Unified Wayvro app core screens for Rider and Driver/Partner modes, shared account/profile switching, and standardized mobile state handling.
- **Open prerequisites (as of 2026-10-11):** SP-01 (real-device background location, permissions, OEM behaviour, driver online state and offer delivery), SP-02 (rider cold start, startup size and performance on representative low-end real hardware) and SP-04 (50-route/address Lahore maps, geocoding and routing field benchmark with founder field drives) remain **OPEN / NOT RUN** and must complete before the Phase 3 mobile-architecture and map-provider freezes; SP-08 (cross-mode E2E regression harness) belongs to Phase 3/4. The Phase 2 Android emulator smoke does **not** satisfy SP-01 or SP-02, which need real devices (`docs/phase0/PHASE0_ADR_BACKLOG.md`).
**Gate:** route/ETA confidence, price snapshot, provider bill controls, unified-app mode-switch/navigation correctness and representative device tests; SP-01, SP-02 and SP-04 results recorded on real devices/field drives before the mobile architecture and map provider are frozen.

## Phase 4 — Dispatch + realtime vertical slice
- Presence, candidate queries, offer leases, atomic assignment, websocket/reconnect/notification delivery and cancellation.
**Gate:** concurrency tests; no double booking; stale location tested; replay and offline recovery.

## Phase 5 — Trip start-to-end and cash accounting
- PIN, driver arrived, start, live route, complete, cancellation/no-show, base cash handling, ledger/receipts/reconciliation.
**Gate:** valid states and zero unbalanced money ledger; provider failure and exact amount tests.

## Phase 6 — Trust/safety/support/operations
- SOS/incident queues, trusted contacts, staff coverage, support tickets, driver safety and suspension, lost items, manual audits.
**Gate:** incident drills pass; no false safety claims; legally compliant driver vehicle/insurance states.

## Phase 7 — Private staging/beta hardening
- End-to-end real device and poor-network QA, accessibility, backup restore, external penetration/security assessment planning/execution as appropriate to exposure, load proof, canary and rollback, operator training.
- Company access/offboarding, finance-close, vendor renewal, business-continuity and release go/no-go controls from T/U requirements are rehearsed before real users.
**Gate:** closed pilot readiness signed by founder, legal/compliance and operations owners; support humans arranged.

## Phase 8 — Controlled Lahore real-ride pilot
- **Founder-approved scope (FD-01, 2026-10-09):** limited Lahore zone, **car only, fixed/upfront pricing, cash only**; consented invited riders, vetted drivers, legally compliant rides, cash reconciliation, live support, transparent incident reporting.
**Gate:** measured user value + financial integrity + safety/reliability under controlled operation.

## Phase 9 — Public Lahore V1
- **Founder-approved scope (FD-02, 2026-10-09)**, each capability feature-flagged and category/zone controlled:
  - car; **bike and/or rickshaw only where a written legal/permit/insurance position permits activation** (B15 — never advertised while blocked);
  - upfront pricing plus **controlled mutual fare bidding/counter-offer** (B16, B17, E13, L03);
  - **multi-stop** (B18, E14) and **scheduled rides** (B19, E17, L24);
  - public website and web booking (J01, L09, W01–W09);
  - full safety/support stack (Phase 6 capabilities at public scale);
  - **cash plus at least one production-approved, contracted regulated digital-payment path** (G10, O02–O06 as contracted).
- App store and legal publication, full support policies, sufficient driver density, city pricing, marketing and field operations.
**Gate:** KPI thresholds approved from pilot evidence; finance and safety go/no-go; written legal position for every activated vehicle category; contracted digital-payment rail live.

## Phase 10 — Advanced pricing and marketplace refinements
- Dynamic/surge pricing with caps (E12), destination mode (M03), back-to-back queue (M06), navigation route preferences (S21), richer payment flows, route improvements and fair-pricing refinements, plus any vehicle category whose legal gate was not met for Phase 9.
- *Phase 0 closure (CON-07 resolved):* the priority definition was corrected (P1 = mandatory when its assigned release/vertical activates; timing is controlled by target phase + release gate) and the Phase 9 capability IDs above moved from Phase 10 to Phase 9 with their dependencies.
**Gate:** distinct policy/service/vehicle class testing and production rollback.

## Phase 11 — Pooling and women's mobility verticals
- Bounded 2–4 rider route/seat matching, pool-specific consent and settlement; women driver preference and, after counsel/operational approval, women-only rides/pools.
**Gate:** no mixed-mode leaks, capacity overbooking, unconsented route deviations, inappropriate disclosure or safety response gaps.

## Phase 12 — Delivery/intercity/corporate/fleet, then multi-city
- Each product separately priced, permissioned, insured, ledger-backed and field-supported.
- Multi-city deployment by zone with local compliance, physical operations and scale testing.
**Gate:** geography-specific regulatory readiness, contribution margin and proven capacity.

## Critical dependencies
**Exactly 13 main phases are defined: Phase 0 through Phase 12 inclusive.** Each phase may be split into as many small milestone prompts as needed; these are not extra top-level phases. No live launch before Phase 6/7 gates and legal sign-offs. Phase 10/11/12 are in the **feature vision**, not a promise of day-one availability. No phase is complete if only code passes and real-world business requirements fail.

## Definition of Done per phase
- Canonical scoped plan and ADR accepted.
- API/types/data migrations documented, security and privacy tests included.
- Unit/integration/e2e/real-device/load tests as relevant; CI passes exact reviewed SHA.
- Claude self-audit + founder/ChatGPT inspection of actual changed files, run commands, negative scenarios, docs, and release blockers where accessible; independent qualified human reviews for high-stakes live releases.
- All defects either fixed/reverified or logged with owner + explicit acceptance that they do not violate gate.
- Founder authorizes reviewed stage/commit/push; no AI co-author trailers.
- Complete report with branch, base SHA, final SHA, coverage, migration/backups, risks, next phase entry criteria.
