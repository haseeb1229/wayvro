# PHASE 0 HANDOFF REPORT — Wayvro v5 discovery / re-audit

**Date:** 2026-10-09 · **Agent:** Claude Code (sole planning agent; self-audit is not independent verification) · **Mode:** PLAN ONLY — no application code, no provider accounts, no Git repository created, no commits, no pushes · **Audience:** founder (`haseeb1229`) and ChatGPT reviewer per `prompts/PHASE_REPORT_HANDOFF_TO_CHATGPT.md`.

> **Superseded in part (2026-10-09):** the founder/ChatGPT review closure pass recorded FD-01..FD-14, corrected priority semantics, moved the Phase-9 capability IDs, and corrected M26, Q49, G17, KYC, gender-eligibility, entity-form and TNC-evidence wording. Where this report differs, **`PHASE0_CLOSURE_HANDOFF.md` is authoritative**; this report is retained as the record of the original Phase 0 pass.

**One-line status:** Phase 0 is complete as a *proposal*. Every one of 531 requirement IDs has a disposition, domain, target phase, surfaces, test families, dependencies and external-blocker flag; 20 gaps became requirements; 12 contradictions were resolved or escalated; 14 founder decisions are open. Technical spikes are defined but **NOT RUN**. I recommend the documents are **safe to freeze for Phase 1 only after FD-01..FD-14 are answered** (§16–§18).

---

## 1. Everything inspected

| Item | Result |
|---|---|
| Workspace | `C:\Dev\Wayvro`, 40 files on arrival (36 in manifest + `V5_FILE_MANIFEST.json` + 3 unlisted root duplicates). Original tree snapshotted to the session scratchpad (`baseline-v5-original/`) before any change. |
| Manifest integrity | `V5_FILE_MANIFEST.json`: 36/36 files SHA-256 and byte-length match (Node script; Python absent on machine). |
| Root duplicates | `28_APP_SURFACES_AND_REPO_TOPOLOGY.md`, `PHASE_0_DISCOVERY_CLAUDE.md`, `requirements-register.json` at repo root were byte-identical to `docs/28`, `prompts/PHASE_0_DISCOVERY_CLAUDE.md`, `docs/requirements-register.json` (SHA-256 `388e49…`, `e45c92…`, `687982…`). Removed at the end of Phase 0 (DUP-01) — see §6/§13. |
| Governance | `CLAUDE.md` (17 sections) read in full; `README.md`; `ALL_FILES_INDEX.md`; `V5_VALIDATION_SUMMARY.json`; `V5_FILE_MANIFEST.json`. |
| Canonical docs | All 29 files `docs/00`–`docs/28` read completely, including historical `docs/20` and `docs/24`. |
| Register | `docs/requirements-register.json`: 511 items, 22 families (A14 B25 C15 D25 E19 F18 G16 H19 I20 J12 K24 L28 M25 N30 O24 P20 Q48 R45 S25 T25 U20 V14); every item had `owner/spec/release_gate/implementation_evidence = null`, `acceptance_tests = []`, `state = PROPOSED`. Cross-checked against `docs/03`: 511 rows, 0 title/priority mismatches, 0 numbering gaps, unique IDs. |
| Prompts | `prompts/PHASE_0_DISCOVERY_CLAUDE.md` (13 deliverables, mandatory work A–J), `prompts/PHASE_REPORT_HANDOFF_TO_CHATGPT.md`. |
| Git | **No repository** (`fatal: not a git repository`). Global identity present: `Muhammad Haseeb <abdulhaseeb1229@gmail.com>`; `gh` authenticated as `haseeb1229`. No remotes, no CI. |
| Local toolchain | Windows 11 Pro; i5-1145G7, 15.7 GB RAM, ~487 GB free; Node v24.20.0, npm 11.19.0, **no pnpm**, **no Python**, OpenJDK 25.0.3, Flutter 3.44.2 (stable), Android SDK at `C:\Dev\AndroidSdk` (platform-tools, build-tools, ndk, cmdline-tools), adb present (no devices attached), Docker Desktop 29.8.1 installed but **daemon not running** (WSL distro `docker-desktop` stopped), gh 2.102.0. |

## 2. Research and validation performed

Six sourced research streams (web search/fetch via subagents, observed 2026-10-09; every claim carries a URL/date and `reported`/`UNVERIFIED` labels), filed verbatim as evidence under `docs/phase0/research/`:
- **R1 competitors** — inDrive/Yango/Bykea/Uber/Careem/others; topology verified (inDrive one app + driver mode; Yango Pro and Bykea Partner separate).
- **R2 regulation** — Punjab TNC licence (reported s.72-H; incumbent-first-licensee press report = SECONDARY_REPORT / NEEDS_OFFICIAL_RECONCILIATION), Section 44B district permits (Jul 2026, status unclear), police character certificate (May 2026), PSCA QR panic button (Jul 2026), TNC Safety & Security Protocols (19-Feb-2026, scanned PDF, **unread**), PDP Bill unenacted, PECA 2025, PTA SMS mask rules, NADRA Nishan Pakistan, SECP/PRA/FBR leads, insurance, emergency services.
- **R3 payments** — SBP PSO/PSP/EMI boundaries, Raast P2M, JazzCash/Easypaisa APIs and fees, PSP table (Safepay/PayFast/Alfalah/HBL/XPay/NayaPay…), payouts, tax leads, fraud norms, per-trip cost model.
- **R4 mobile/store** — Play background-location/FGS/16 KB/target-SDK/2027 deadlines, Apple rules, Expo SDK 57/RN 0.86 state, expo-location limits, Transistorsoft, Flutter 3.47 comparison, PK device landscape (Infinix/Tecno/Vivo/Xiaomi/Samsung; Android 11–16), push/SMS APIs, integrity; on-device spike plan.
- **R5 providers/cost** — Neon/Supabase/Hetzner/DO/Fly/Oracle/R2/maps/OTP/KYC/email/observability/EAS/CI/domains/status; two-tier budget.
- **R6 safety/market** — women's mobility players, pooling history, driver economics and fuel shocks, rider market, safety operations (Yango–PSCA), incident patterns, operational benchmarks, "Wayvro" brand collision scan, intercity/delivery/COD tax.
Research limitations: Google Play pages and bykea.com did not render for the agents; Yango PK pages partly stale; sbp.org.pk/easypaisa/gopayfast blocked fetches; commission rates are unofficial; the TNC protocols PDF has no text layer; no WHOIS run for wayvro.com/.pk.

Validation performed on the pack itself: manifest hash check; register↔inventory cross-check; requirement-count scan across all docs; cross-document state-machine comparison (found four variants → CON-01); trip/settlement contradiction (CON-02); monorepo tree mismatch (CON-03); priority-vs-phase conflict (CON-07); file-reference existence check (new generator); phase heading check (exactly 0–12); risk-ID uniqueness.

## 3. Issues, inconsistencies, risks, duplicates and gaps discovered

Full detail in `docs/phase0/PHASE0_GAP_REPORT.md`. Summary:
- **13 gaps → 20 new IDs** (GAP-01..13): supply preview privacy (B26); vehicle single-active-driver invariant (D26); single driver session (D27); driver dues policy (G17); driver offer alerting on OEM-killed apps (M26); release artefact/no-APK-on-web policy (Q49); Punjab compliance artefacts incl. police certificate/PSCA QR/44B district permits (R46); FOSPAH harassment-governance kit (R47); post-trip contact lockdown (N31); fuel-indexed fare revisions (E20); telecom-outage continuity (S26); **public website/web ecosystem family W01–W09** (the founder's instruction named the website explicitly; the pack had one requirement, J01).
- **18 clarifications** (CL-01..18) fixing interpretation without changing IDs/priorities (e.g. phone-only login; cash rounding at quote; UTC storage; open-letter vehicles; dated store deadlines).
- **13 duplicates** mapped to canonical owners (DUP-01..13); none deleted except the three root file copies.
- **12 contradictions** (CON-01..12): 7 resolved in docs, 3 escalated to founder (CON-07 P1-in-Phase-10, CON-08 spike authorisation, CON-09 founder-run interviews), 2 resolved by precedence rule (CLAUDE.md §14 over harness attribution; Phase 0 artefacts over docs/16 ADR list).
- **8 new risks** RSK-033..040 added to `docs/15`.
- **Priority counts after additions:** P0 216 (+10), P1 209 (+10), P2 89, P3 17 — no existing ID re-prioritised.

## 4. New requirements proposed/added
B26, D26, D27, E20, G17, M26, N31, Q49, R46, R47, S26, W01, W02, W03, W04, W05, W06, W07, W08, W09 — each with priority, title, source, disposition, domain, phase, surfaces, test families, dependencies and blocker (register `phase0` block; `PHASE0_REQUIREMENT_COVERAGE.json`; `docs/03` "Phase 0 additions"). State remains `PROPOSED` pending founder review.

## 5. Existing requirements whose interpretation needed clarification
A02, A12, A13, E03, G04, H08/Q39, H10/R28, M23, Q23, R05, N04, M10, Q44, T25, B16/E07, U16, K21/F09, E08 (CL-01..CL-18 in the gap report). Priority/phase conflicts escalated rather than changed: B15–B19, E12–E14, L03, M03, M06, E17, L24, S21 (CON-07 → FD-02).

## 6. Files created, modified, renamed, removed (and why)

**Created (docs/phase0/):** `PHASE0_HANDOFF_REPORT.md` (this), `PHASE0_GAP_REPORT.md`, `PHASE0_REQUIREMENT_COVERAGE.json`, `PHASE0_REQUIREMENT_COVERAGE.csv` (generated), `PHASE0_UNIFIED_APP_ROLE_MODEL.md`, `PHASE0_JOURNEYS_AND_STATE_MACHINES.md`, `PHASE0_ARCHITECTURE_PROPOSAL.md`, `PHASE0_ADR_BACKLOG.md`, `PHASE0_SECURITY_PRIVACY.md`, `PHASE0_COMPETITOR_MATRIX.md`, `PHASE0_COST_PROVIDER_MATRIX.md`, `PHASE0_LAUNCH_BLOCKERS.md`, `PHASE0_ENGINEERING_GUARDRAILS.md`, `PHASE0_PHASE1_PROMPT_PROPOSED.md`, `research/R1…R6_*_2026-10-09.md` (6 evidence files), `tools/coverage-map-1.js`, `tools/coverage-map-2.js`, `tools/coverage-map-3.js`, `tools/coverage-map-new.js` (disposition source data), `tools/phase0-coverage.js` (validates + generates coverage, applies register/inventory changes idempotently, `--check` mode for CI), `tools/regen-manifest.js` (regenerates manifest + validation summary with consistency checks). Rationale: Phase 0 deliverables 2–12; reproducible generated artefacts (CLAUDE.md §12/§16).

**Modified:** `docs/requirements-register.json` (schema 5.0 → 5.1; +20 items; `phase0` block on all 531; `phase0` package metadata — **no ID removed/renamed/re-prioritised**), `docs/03_FEATURE_INVENTORY.md` (appended Phase 0 additions section), `README.md` (status, counts, read order), `ALL_FILES_INDEX.md` (counts, Phase 0 section), `docs/00` (count + Phase 0 status note), `docs/01` (pointer to competitor matrix), `docs/02` (W-family pointer), `docs/04` (CON-01/CON-02 fixes), `docs/05` (CON-11 date, pipeline pointer, R46), `docs/06` (CON-03 note), `docs/09` (cost-matrix pointer, Firebase/Twilio correction), `docs/12` (Phase 0 record, J07 note, CON-07 note), `docs/15` (RSK-033..040), `docs/16` (Phase 0 ADR/research update), `docs/17` (count), `docs/18` (canonical state-machine pointer), `docs/21` (two coverage rows), `docs/22` (pointer), `docs/23` (Prompt 5 traceability), `docs/28` (simultaneous-use proposal note), `V5_FILE_MANIFEST.json` and `V5_VALIDATION_SUMMARY.json` (regenerated by `tools/regen-manifest.js`).

**Removed:** root `28_APP_SURFACES_AND_REPO_TOPOLOGY.md`, `PHASE_0_DISCOVERY_CLAUDE.md`, `requirements-register.json` — byte-identical duplicates of canonical files, unlisted in the manifest, which would have become stale conflicting copies after the register changed (R40, Phase 0 prompt §J). Originals preserved in the scratchpad snapshot; founder confirmation requested as FD-11.

**Not modified:** `CLAUDE.md` (four edits proposed in `PHASE0_ENGINEERING_GUARDRAILS.md` §9, not applied), `prompts/*`, `docs/07/08/10/11/13/14/19/20/24/25/26/27` (consistent as-is or historical).

## 7. Architecture and technology decisions (proposals; see ADR backlog)
Modular monolith: `apps/api` (NestJS+Fastify proposed), `apps/worker` (BullMQ), **`apps/realtime` as a separate Socket.IO gateway process**, `apps/wayvro-mobile` (RN + Expo dev builds, SDK 57 line, lazy-loaded driver modules), `apps/web-public` + `apps/web-ops` (Next.js), Postgres 17 + PostGIS 3.5, Redis 7, S3-compatible storage (R2), transactional outbox, Zod contracts → OpenAPI, Drizzle + raw SQL for PostGIS/locking (benchmark pending), pnpm + Turborepo + Node 24 LTS, Hetzner Singapore VPS + managed Postgres for pilot, OpenTofu/Ansible IaC. Canonical role model, state machines and 14 invariants defined. SLO proposals and scaling triggers recorded.

## 8. Alternatives considered and rejected
Two store apps (founder-locked; inDrive proves unified viability); Flutter (fallback only — deferred components are its sole decisive advantage); microservices/Kubernetes/Kafka (scale theatre); BaaS (Supabase/Firebase) as backend (invariants/adapters need server control; free tiers pause); serverless API (sockets/leases/FGS streams); rider wallet/stored value (SBP e-money boundary); separate Lite app (contradicts one app); Twilio for OTP ($0.47/segment); Oracle Always Free for dispatch; Vercel Hobby/MapTiler/Stadia free tiers (non-commercial); MinIO for new local deployments (upstream reportedly archived); simultaneous rider-booking while online as driver (rejected for Phases 1–9).

## 9. External providers considered and trade-offs
Maps: Google (quality, ≈$360/mo pilot) vs Mapbox (≈$0 pilot, ≈$950 at scale) vs open stack (≈$0, Lahore POI quality unknown) → hybrid behind adapter after SP-04. OTP: local PK gateway (≈Rs 4.8/OTP, needs company + mask) + WhatsApp auth (≈$0.015) vs Firebase (paid, PK price unverified) vs Twilio (rejected). KYC: manual review first; Shufti/Didit/Sumsub/Veriff optional; NADRA only via Nishan Pakistan eligibility. Payments: Safepay/PayFast one-integration vs direct JazzCash/Easypaisa + bank Raast; cards' fixed fee ≈6 % of a Rs 500 trip. Hosting: Hetzner SIN/EU vs DO vs Fly vs Railway/Render paid; DB: Neon Launch vs Supabase Pro vs DO. Storage: R2 vs B2. Background location: expo-location vs Transistorsoft ($399). Full matrix: `PHASE0_COST_PROVIDER_MATRIX.md`.

## 10. Unresolved external decisions (legal, regulatory, payment, identity, mapping, other)
Listed with owners/gates in `PHASE0_LAUNCH_BLOCKERS.md`: TNC licence + unread safety protocols; 44B permit instrument/enforcement/fees/motorcycle scope; police-certificate agreement terms; PSCA standard and MoU; commercial registration/token tax; bike-taxi legality; PRA 5 % base and FBR s.6A/153 applicability; driver contractor documentation; SBP opinion that driver ledger is a receivable; PSP/payout contracts; SMS mask; NADRA eligibility; biometric DPIA; PDP enactment watch; PECA/SMPRA scope; recording law; women-only policy; insurance/takaful; store org accounts/D-U-N-S; test devices; staffing; penetration test; field interviews; brand/trademark/domain clearance.

## 11. Risks (security, privacy, safety, financial, operational, scalability, reliability)
Top: supply shrinkage under 44B (RSK-033); unknown licence conditions (RSK-034); OEM background kills → missed offers/stale tracking (RSK-035); fake apps/pre-payment scams (RSK-036); PDP localisation (RSK-037); internet shutdowns (RSK-038); card fee economics (RSK-039); store deadlines (RSK-040); plus existing RSK-001..032 (supply, documents, incidents, PSP leakage, double assignment, stale tracking, maps accuracy, women-focused supply, free hosting, OTP pumping, CNIC leaks, biometric spoofing, account-link hijack, provincial rules, incentive wars, provider cost, release regressions, staff abuse, IP, claims, staffing, AI-code bugs, store rejection, price shocks, chargebacks, unified-app leakage/battery/blast-radius/mode-escape/bloat). Threat model and abuse cases: `PHASE0_SECURITY_PRIVACY.md`.

## 12. Validation commands/checks and exact outcomes

| Command | Outcome |
|---|---|
| `node mf.js C:/Dev/Wayvro` (manifest verifier, scratchpad) | `checked 36 bad 0`; `UNLISTED` ×3 (root duplicates) |
| `sha256sum` of root duplicates vs canonical | identical pairs (`388e49…`, `e45c92…`, `687982…`) |
| register structure/cross-check script | `count 511`; families as §1; `inv rows 511 dups 0 mismatches 0`; priorities `{P0:206,P1:199,P2:89,P3:17}`; `unique 511`; no numbering gaps |
| `node docs/phase0/tools/phase0-coverage.js` (dry run) | `coverage: 531 rows`; `{"NOW":395,"LATER":107,"EXTERNAL_DECISION":26,"OUT_OF_SCOPE":3} {"P0":216,"P1":209,"P2":89,"P3":17}` |
| `node docs/phase0/tools/phase0-coverage.js --apply --check` | `register: 20 new items added; total 531; phase0 block stamped on all items` · `inventory: appended 20 new IDs to docs/03` · `check: OK (531 IDs consistent across register, inventory and coverage)` |
| `node docs/phase0/tools/regen-manifest.js` (first run, before this report existed) | `manifest: 61 files; summary status: FAIL` — single problem: missing reference `docs/phase0/PHASE0_HANDOFF_REPORT.md` (expected; file written afterwards). Re-run results after this report are given in the chat handoff and reflected in `V5_VALIDATION_SUMMARY.json`. |
| `git status` | `fatal: not a git repository` |
| `docker info` | daemon not reachable (Docker Desktop stopped) — recorded; not started |
| Spikes SP-01..SP-08 | **NOT RUN** (plan-only; no devices; no authorisation) |
| Tests/CI | **NOT RUN** — no code exists |

## 13. Assumptions made
1. Phase 0 is plan-only (docs/17) and spikes need separate founder authorisation (CON-08).
2. Deliverables belong under `docs/phase0/`; generated artefacts have committed generator sources.
3. Adding a `phase0` block and bumping the register schema to 5.1 is an additive, authorised Phase 0 change (prompt §A/§J); IDs/priorities untouched.
4. Removing byte-identical root duplicates is within "repair one canonical model" (prompt §J); reversible from the snapshot; flagged as FD-11.
5. Research subagent output is evidence, not truth — labels preserved; counsel/accountant verification required.
6. FX ~PKR 280/USD; cost figures are estimates.
7. "P1" semantics unchanged; CON-07 is for the founder.
8. CLAUDE.md §14 overrides harness attribution reminders (no commits occurred anyway).
9. The founder's local Flutter install does not change the RN/Expo recommendation (ADR-003) but is recorded as the fallback path.

## 14. Git status
No repository exists in `C:\Dev\Wayvro`. Branch/HEAD/remotes: none. Working tree: not applicable (plain folder). Global Git identity: `Muhammad Haseeb <abdulhaseeb1229@gmail.com>`; `gh` logged in as `haseeb1229`. **I did not run `git init`** (not authorised by the Phase 0 prompt).

## 15. Commits / pushes
**None.** Nothing was committed or pushed; no remote exists.

## 16. Blockers requiring founder decision (FD-01..FD-14; detail in gap report §7)
FD-01 pilot scope (car/fixed/cash) · **FD-02 Phase 9 service mix vs P1 items in Phase 10** · FD-03 Singapore hosting with localisation path · FD-04 maps budget + SP-04 field drives · FD-05 OTP strategy · FD-06 manual KYC at pilot + DPIA · FD-07 cash-only pilot, one PSP in Phase 9 · FD-08 Transistorsoft budget if needed · FD-09 RN/Expo confirmation · **FD-10 start incorporation now (entity form SMC vs multi-member decided with counsel — see closure handoff)** · FD-11 accept duplicate removal · FD-12 women-focused model · **FD-13 authorise spikes + procure test devices** · FD-14 pilot infra budget.

## 17. Ready for external/founder review?
**Yes — as a proposal.** Internal consistency checks pass (see `V5_VALIDATION_SUMMARY.json`); every ID is dispositioned; founder instructions are traced (docs/23 Prompt 5). **Not** ready to freeze unconditionally: FD-02 changes phase assignments, FD-13 determines whether the mobile-stack ADRs can close before Phase 3, and the unread TNC protocols (B2) could change Phase 2 compliance scope. No claim of completeness, legal clearance or production readiness is made.

## 18. Exact recommended next step
1. Founder sends this report + `docs/phase0/` to ChatGPT for review (`prompts/PHASE_REPORT_HANDOFF_TO_CHATGPT.md`), answers FD-01..FD-14, and asks counsel to read the 19-Feb-2026 TNC Safety & Security Protocols and confirm 44B status.
2. In parallel (non-code): start SECP incorporation (FD-10; SMC vs multi-member form decided with counsel — see closure handoff), stage device procurement (FD-13: borrowed/available devices + emulators first, representative devices before real-device gates), and run the authorised spikes on the schedule in `PHASE0_ADR_BACKLOG.md` §E.
3. Only then issue the Phase 1 prompt based on `PHASE0_PHASE1_PROMPT_PROPOSED.md` (monorepo + local environment + CI skeleton; no product features), beginning with founder-authorised `git init` on `main` under the founder's identity.

Claude stops here and waits for founder review and approval.
