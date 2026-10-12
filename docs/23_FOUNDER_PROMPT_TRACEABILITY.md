# 23 — Founder Prompt Traceability — Source Prompts + Founder Corrections

**Purpose:** Every material instruction in the founder's original mobility-project prompts and later explicit founder corrections is mapped to canonical documentation/requirements. This prevents a junior-developer/AI workflow from losing requirements that were stated conversationally.

## Prompt 1 — Build a real startup / large-scale business product to compete in Pakistan
- **Real business, not demo:** docs 00, 11, 12, 22, 25; R08/R13-R27; T01-T25.
- **Compete with inDrive/Yango in Pakistan:** docs 01, 20, 24; Phase 0 competitor matrix; L/M/N/O/R requirements.
- **Full readiness, not code-only:** release definitions/hard stops in docs 00 and U15.

## Prompt 2 — A-to-Z competitor/product/engineering request
- **Study inDrive, Uber, Careem, Yango, Bykea A-to-Z:** docs 01/16/20/24 and Phase-0 sourced competitor matrix. Competitor behavior is benchmark evidence, not permission to copy proprietary code/design.
- **Nothing merely implied:** requirements register is atomic; U20 forces any new discovery into the canonical register before implementation.
- **Strong frontend and backend:** docs 06/08/10/14; rider/driver/admin microstates and real-device tests are gates.
- **Production-scale architecture but low initial cost:** docs 06/09; modular monolith/managed services first, scale on evidence; free tier is never treated as SLA.
- **Mature stack and provider adapters:** docs 06/09; Phase 0 ADRs must prove current compatibility/licensing/price.
- **GitHub Student Pack/domains:** docs 09 treats benefits as temporary/account-specific and requires production/commercial-term verification.
- **Local development first; paid capacity later:** docs 09/12; local laptop is development only, never production dispatch/safety host.
- **Rider, driver, company/admin/project side:** docs 02 and requirements A-V cover passenger, driver, dispatch, pricing, safety, support, admin, fleet/corporate, delivery, company governance, infra/security and GTM.
- **Ride sharing/pooling with A/B/C/D riders and split cost:** F01-F18 plus G14/E15-E18, pooling state machines in doc 04.
- **Women drivers/passengers and women-only safety:** F08-F14, K21, M05, R35-R37 with consent/legal/supply gates.
- **Additional differentiators:** commute pools, family safety, low-data/web/call booking, choice/negotiated vs fixed pricing, accessible/pet/kids/airport, driver-first earnings and later corporate/delivery/intercity — all gated by evidence.
- **Secure, optimized, non-AI-looking professional product:** docs 08/10; original design system, accessibility, low-end devices, privacy/security/SRE gates.
- **Fast AI-assisted build:** speed comes from bounded phases/subworkpackages, not skipping validation. Claude is sole coding agent; actual evidence beats reports.
- **GitHub owner `haseeb1229`, Claude commit/push/report, ChatGPT next gate:** docs 13; commit/push remains founder-authorized and actual SHA/CI is verified before next scope.

## Prompt 3 — Claude only + explicit identity/auth/KYC
- **Codex removed:** docs 13 and prompt use Claude only.
- **Phone OTP/auth:** A02/A03, K08/K09/K15-K17, S12/S13.
- **CNIC/ID:** D02/D03, K02/K05/K06/K11-K14.
- **Face/selfie/liveness:** K03/K04/K18/K19; no government verification claim from face score.
- **GitHub report review:** docs 13; report alone is insufficient — inspect branch/SHA/diff/CI when repo exists.
- **13 macro phases:** docs 12, Phase 0 through 12.

## Prompt 4 — Recheck because founder is junior; miss no small feature
- Historical v3/v4 audits split broad ideas into atomic requirements; v5 then corrects the public-app topology and adds V01–V14 so the unified app/profile/mode behavior is testable rather than implied.
- **No honest document can promise 'nothing will ever be discovered'.** Instead Phase 0 must show no known unexplained gap, and U20 makes future discoveries visible before coding.
- Claude must produce a requirement-disposition matrix for **every ID**, with NOW/LATER/OUT_OF_SCOPE/EXTERNAL_DECISION, owner, phase, dependencies and tests.

## Founder correction — ONE public Wayvro app, not separate Rider/Driver apps
- **Single public app:** `V01`, docs 00/02/06/28 and root `CLAUDE.md`.
- **One account, multiple profiles/capabilities:** `V02`, `V03`, `V07`, `V13`.
- **Rider <-> Driver/Partner mode switching:** `V04`, `V08`; server state prevents conflict/bypass.
- **Driver permissions/background GPS only when justified:** `V05`, `V06`, `V14`.
- **Unified-app release/performance safety:** `V10–V12`; cross-mode regression, low-end/battery/startup budgets and mode-segmented observability.
- **Industry evidence is mixed, not prescriptive:** inDrive provides a current one-app rider/driver/delivery-partner precedent, while Yango/Bykea/Uber use separate driver distributions. Wayvro intentionally chooses the unified model instead of treating separate apps as a universal best practice.

## Prompt 5 — Phase 0 kickoff instruction (2026-10-09)
- **V5 is the authoritative baseline; V1–V4.1 superseded:** docs/00 authority order; `docs/20`/`docs/24` marked historical; Phase 0 read every file (handoff report §1).
- **Founder-locked decisions (name, ONE public app, one account with Rider + approved Driver/Partner profiles, mode switch never authorisation, separate staff web surfaces, public website/web ecosystem):** V01–V14, ADR-026, `docs/28`, `PHASE0_UNIFIED_APP_ROLE_MODEL.md`; website/web ecosystem made explicit as **W01–W09** (previously only J01 and docs/02 §3 prose).
- **Challenge the blueprint across the listed domains (rider/driver journeys, mode-switch edge cases, maps, dispatch, trips, pricing, payments/Pakistan rails, OTP, CNIC/KYC, liveness, compliance, safety, women-focused, pooling, support, fraud, notifications, offline, mobile lifecycle, privacy, accessibility, low-end Android, iOS, APK/AAB release, website/web booking, ops/admin, business/fleet, company ops, accounting, legal, SRE, backups/DR, deployment/rollback, cost/scaling, provider limits, CI/CD, frontend/backend separation, API compatibility, migration safety, dead code, dependency boundaries, testing, Git/Docker safety, business readiness, failure states):** `PHASE0_GAP_REPORT.md` (20 new IDs, 18 clarifications, 13 duplicates, 12 contradictions), `PHASE0_JOURNEYS_AND_STATE_MACHINES.md`, `PHASE0_SECURITY_PRIVACY.md`, `PHASE0_ENGINEERING_GUARDRAILS.md`, `PHASE0_COST_PROVIDER_MATRIX.md`, `PHASE0_LAUNCH_BLOCKERS.md`.
- **Underspecified/contradictory/misprioritised/unsafe/unrealistic/unavailable-service items:** CL-01..CL-18, CON-01..CON-12, DUP-01..DUP-13, EXTERNAL_DECISION dispositions.
- **Phase 0 only; no Phase 1; no scaffolding; no fake integrations; no weakened safeguards; no Git actions:** no code written; no commits/pushes; spikes NOT RUN; `PHASE0_PHASE1_PROMPT_PROPOSED.md` is a proposal only.
- **Gap reconciliation through the completeness process (ID, traceability, surfaces, impact, dependencies, phase/priority, consistent docs):** register schema 5.1 `phase0` block + coverage artefact + docs/03/00/README/index/15/21/23 updates.
- **Final cross-document consistency pass and detailed handoff report (18 items):** `PHASE0_HANDOFF_REPORT.md`.

## Prompt 6 — Phase 0 founder/ChatGPT review closure pass (2026-10-09)
- **Stale Phase 0 prompt:** `prompts/PHASE_0_DISCOVERY_CLAUDE.md` marked EXECUTED (511 at entry → 531 now; do not rerun).
- **Priority semantics (CON-07):** README/docs/12/docs/14 — P0 gate-critical; P1 mandatory when its release/vertical activates; timing = target phase + release gate. Phase 8 pilot (FD-01) and Phase 9 public Lahore V1 scope (FD-02) recorded; B15–B19, E13, E14, E17, L03, L24 moved Phase 10 → 9.
- **Women-focused eligibility:** CL-17/ADR-009/FD-12 corrected (no algorithmic inference; consent-based counsel-reviewed policy; human review and appeal); docs/00 hard stop, docs/18, security doc, launch blockers.
- **Incorporation:** FD-10/ADR-011 — start now; SMC vs multi-member decided with counsel; no invented nominee.
- **Mobile release/ABI/16 KB and iOS production:** Q49 corrected at source (coverage-map-new.js) and regenerated.
- **Driver offer alerting:** M26/ADR-033 corrected — no full-screen-intent dependency; socket/poll primary; push = wake aid.
- **Android toolchain:** JDK 17 pinned; no hard-coded NDK r28 (CL-22, ADR-036).
- **KYC boundary:** no in-house face/liveness ML (FD-06, CL-19, docs/18).
- **Money:** architecture §6 corrected; no unreviewed principal-vs-agent conclusion (CL-20).
- **Punjab TNC evidence:** incumbent-status reports classified SECONDARY_REPORT / NEEDS_OFFICIAL_RECONCILIATION (CL-21).
- **Phase 1 stack/spike contradiction:** Phase 1 prompt rewritten with early-entry SP-AND/SP-03/SP-05; SP-01/02/04 before Phase 3 freezes; still exactly Phases 0–12.
- **Devices:** staged procurement (FD-13). **Other FDs:** FD-03/04/05/07/08/09/11/14 recorded.
- **CLAUDE.md:** §7 tools, §9 offer-alerting/JDK 17/release rule, §16 Phase 0 authority + validation commands (no duplicate attribution wording).
- **Git/GitHub baseline:** private `haseeb1229/wayvro`, `main`, single documentation commit — see `docs/phase0/PHASE0_CLOSURE_HANDOFF.md`.

## Prompt 7 — Phase 2 planning and founder/ChatGPT planning-closure correction (2026-10-10)
- **Phase 2 plan (plan only):** `docs/phase2/` (13 documents) traces every target-phase-2 ID; no implementation, migration, dependency or provider account.
- **New requirement:** A15 (P0, Phase 2) age and guardian eligibility policy, counsel-gated, no hard-coded threshold — added through `docs/phase0/tools/coverage-map-additions.js` (separate from Phase 0 additions); register 531 → 532; Phase 2 scope 54 → 55.
- **Founder decisions Q-01..Q-15** recorded in `docs/phase2/PHASE2_PLAN.md` §10 (including strong-proof-only historical recovery, camera + controlled import for documents with camera-only selfies, no Phase 2 bulk export, risk-triggered driver re-verification).
- **Corrections:** account/person uniqueness is not a database invariant; test doubles physically absent from production artefacts from P2.1; versioned AEAD envelope and rotation rules; mature isolated image decode/re-encode instead of a hand-written parser; relational integrity for evidence/category/case-subject links; accessible optional selfie capture challenges.

## Prompt 8 — Phase 3 planning kickoff, Android CI repair and resumed planning (2026-10-12)
- **Kickoff rule honoured:** the `main` Android job failed twice, so planning stopped; no branch or commit was made from a repeatedly red `main`.
- **CI repair (workflow only):** exact-key Gradle dependency cache, explicit main-only save with verification, disk evidence, removal of unused runner toolchains; merged via PR #6 (`058fcea`).
- **Phase 3 plan (plan only):** `docs/phase3/` traces all 29 target-phase-3 IDs (P0 17 / P1 11 / P2 1); no implementation, migration, dependency, provider account or freeze. Register unchanged at 532.
- **Founder corrections applied:** one public app; spikes SP-01/SP-02/SP-04 before freezes; no Transistorsoft purchase without SP-01 evidence and approval; `USE_FULL_SCREEN_INTENT` not requested; provider terms re-verified from primary sources; release URL-scheme finding re-verified on a CI-built artefact; no-phone-while-driving rule for field drives.

## Workflow requirements imported from Minhaj where applicable
- Actual repo/worktree/data > verified exact-SHA checkpoint/CI > canonical docs > reports/prompts.
- Inspect branch, HEAD, worktree, remotes, CI and Git identity before changes.
- Explicit reviewed-path staging only; normal commit/non-force push only after founder authorization. No force push, rebase, amend, reset --hard, git clean, stash-as-workflow, `--no-verify`, signing bypass or history rewrite. Preserve unrelated work.
- Founder-only Git attribution; no AI coauthor/tool trailers.
- No unsafe Docker prune/factory reset/unknown-volume deletion; identify ownership and preserve persistent data.
- No fake-green/skipped critical proof. Use real SQL/concurrency/recovery/browser/accessibility/security/privacy/RTL/device evidence appropriate to the phase.
- Accepted green work is not casually reopened; changes require regression evidence and canonical-doc reconciliation.
