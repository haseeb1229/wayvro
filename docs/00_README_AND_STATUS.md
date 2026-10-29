# 00 — Authority, Product Intent, Definitions

## Authority order
1. Applicable law, verified safety obligations, qualified legal/accounting/privacy advice, binding vendor/store restrictions and customer/data safety.
2. Explicit founder decisions and approved ADRs.
3. Audited current repository branch/commit + CI/runtime evidence.
4. Approved current phase specification, tests and requirement traceability.
5. This discovery pack and historical audit notes.

Historical v3/v4 audit files remain evidence of how gaps were found; they are **not** allowed to override a newer founder decision or current v5 canonical docs.

## Product identity
- Canonical product/brand name: **Wayvro**.
- Pronunciation: **WAY-VRO**.
- Founder-locked for current product/repository planning; Claude must not rename/rebrand without explicit founder instruction.
- This name lock does not prove company-name/trademark/domain/store/social availability.

## Mission
Build Wayvro as a high-quality Pakistan-first mobility marketplace, beginning with a controlled Lahore launch and designed to expand across vehicle classes and service verticals without becoming a fragile prototype.

The product must combine strong consumer UX with serious dispatch, location, money, safety, support, fraud, compliance and operations systems. Attractive screens do not compensate for weak backend integrity; backend sophistication does not compensate for poor rider/driver UX.

## Founder-locked public mobile architecture
Wayvro uses **one public mobile app**.

Inside that app:
- **Rider mode** handles passenger journeys and related services.
- The same account may create/apply for a **Driver/Partner profile**.
- After verification/approval, the user may switch to **Driver/Partner mode** and later switch back to Rider mode.
- Future partner earning capabilities (for example delivery/courier where approved) should extend the partner capability model rather than force a second public Wayvro app unless a later founder-approved ADR changes this decision.

The visual mode switch is not a security boundary. Server-side account, profile, KYC/compliance, vehicle/service eligibility and restriction state remain authoritative. See `docs/28_APP_SURFACES_AND_REPO_TOPOLOGY.md` and requirements `V01–V14`.

## Release definitions
- **Documentation complete:** every known domain is indexed; every canonical requirement has disposition/owner/phase/test family or a clearly tagged external decision.
- **Development ready:** core architecture, account/role model, contracts, local environment and first vertical slice are approved with no unresolved foundational contradiction.
- **Internal demo:** synthetic/test accounts only; no public real paid riders or unverified drivers.
- **Controlled pilot:** verified drivers, screened pilot riders, functioning support/safety response, compliant payments/settlement, required insurance/regulatory evidence and tested rollback.
- **Public city launch:** proven incident operations, enough supply density, compliant store/vendor/legal setup, monitored reliability, backups/recovery and rollback readiness.
- **Scale expansion:** economics, reliability and operational capacity justify more zones/cities/services.

## Hard stops
- No real trip with an unapproved/ineligible driver or vehicle.
- No real-money stored-value/customer wallet business without appropriate regulated partner/legal basis.
- No storage of raw card PAN/CVV by Wayvro unless a qualified PCI-compliant architecture and provider arrangement explicitly requires/allows it; default is tokenized PSP handling.
- No fake NADRA/police/insurance/emergency/payment integrations or labels.
- No blanket mandatory passenger CNIC/biometric collection without verified purpose, necessity, consent/legal basis, retention controls and accessible fallback.
- No automated face score alone authorizes a driver.
- Never algorithmically infer gender from face, selfie, name, CNIC number, photograph or any other proxy. Women-focused eligibility uses only an explicit, consent-based, privacy-minimised, counsel-reviewed policy with qualified human review, fallback and appeal; an attribute explicitly present on an authoritative document may be checked only for that counsel-approved purpose, and identity evidence is never shown to riders or drivers.
- No public launch from a developer laptop/home internet.
- No claiming 24/7 support/safety response until staffing/coverage actually exists.
- No production use of unsupported hobby/free tiers where sleeping, rate limits, SLA/terms or data rules make real rides unsafe.

## Initial accountability
The founder owns product decisions initially, but production launch requires qualified outside help where needed: transport/legal, privacy/biometrics, tax/accounting, insurance, payments, security testing and real-world safety operations.

## Geographic assumption
Lahore/Punjab is the initial operating context for research and controlled launch planning. Multi-city architecture should avoid hardcoding Lahore into domain rules, but actual launch must obey city/province-specific rules.

## v5 authority note
v5 supersedes v4.1. The incorrect separate Rider/Driver-app default is removed. The existing A-to-Z baseline remains, and `V01–V14` explicitly define the founder-approved unified public app and its security/permission/release consequences. Current requirement total is **532** across 13 macro phases (0–12): 531 after the Phase 0 pass of 2026-10-09 (511 v5 + 20 Phase 0 additions; see `docs/phase0/PHASE0_GAP_REPORT.md`) plus A15 added in the Phase 2 planning closure of 2026-10-10 (`docs/phase2/PHASE2_PLAN.md` §8). Phase 0 challenged the pack and recorded dispositions for every ID; “v5” is not a claim of final completeness or legal approval, and Phase 0 output remains a proposal until founder/ChatGPT review.

## Phase 0 status note (2026-10-09)
Phase 0 deliverables live under `docs/phase0/` and are indexed in `ALL_FILES_INDEX.md`. Canonical resolutions made in Phase 0: one driver-capability state machine (`PHASE0_UNIFIED_APP_ROLE_MODEL.md` §3), trip status separated from settlement status (§10), one monorepo tree (`PHASE0_ARCHITECTURE_PROPOSAL.md` §3), current launch blockers (`PHASE0_LAUNCH_BLOCKERS.md`). Founder decisions FD-01..FD-14 were recorded in the founder-review closure pass of 2026-10-09 (`docs/phase0/PHASE0_CLOSURE_HANDOFF.md`); they remain subject to their external gates. Priority codes were redefined (README): timing is controlled by target phase + release gate, not priority alone. No product implementation has started.

## Phase 1 status note (2026-10-09)
The Phase 1 foundation (spikes SP-AND/SP-03/SP-05, monorepo tooling, package and app skeletons, local infrastructure, CI) passed founder/ChatGPT review (reviewed head `7e7a32a`) and was integrated into `main` on 2026-10-10 through https://github.com/haseeb1229/wayvro/pull/1 with the merge commit `eaa1fcb4aa037f4e704b7fa3a3941d27604f2b7f`. Phase 2 planning passed review on 2026-10-10. Decisions and evidence: `docs/adr/README.md`; setup: `docs/operations/developer-setup.md`.

## Current status (2026-10-11, after Phase 2)
The Phase 2 engineering implementation (P2.1 – P2.10 plus the closure run: identity and controlled Driver/Partner onboarding in the ONE app, manual KYC review — no custom face recognition or liveness) passed founder/ChatGPT review and is merged into `main` through https://github.com/haseeb1229/wayvro/pull/4 with the normal merge commit `7da51b048e21e28ca19be32a5ecce73787825397` — `docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md`. Requirements **532**; Phase 2 scope **55**. External activation gates EG-01..EG-23 remain open; this is not production readiness. **Phase 3 has not started**; no ride, quote, maps, dispatch, payment or other business slice exists. Before the Phase 3 freezes: SP-01 (real-device background location, permissions, OEM behaviour, driver online state and offer delivery), SP-02 (rider cold start, startup size and performance on representative low-end real hardware) and SP-04 (50-route/address Lahore maps, geocoding and routing field benchmark with founder field drives) remain **OPEN / NOT RUN** and must complete before the Phase 3 mobile-architecture and map-provider freezes; SP-08 (cross-mode E2E regression harness) belongs to Phase 3/4. The Phase 2 Android emulator smoke does **not** satisfy SP-01 or SP-02, which need real devices (`docs/phase0/PHASE0_ADR_BACKLOG.md`).

## Phase 3 implementation status (2026-10-18)
The founder-authorised full Phase 3 run (P3.0–P3.10) is at closure on branch `phase-3/maps-quotes-unified-ux` and is open for review as a pull request; it is **not merged and not complete**. Built with synthetic data only: catalog products, zone sets, hours and eligibility (migration 0010); geo gateway with cost controls and circuit breaker (0011); server-authoritative quotes and maker-checker pricing (0012); app version policy, maintenance and runtime switches (0013); the unified-app Rider/Driver shell with foreground-only rider location (COARSE + FINE); localisation and accessibility hardening (no string natively REVIEWED); and Maestro E2E tooling with new Android release gates. Requirement reconciliation: 8 ENGINEERING_SATISFIED, 21 PARTIAL_EXTERNAL_GATED, 0 BLOCKED. SP-01, SP-02 and SP-04 remain **NOT RUN** (real devices and Lahore field data are founder actions FA-03/04/05; FA-06 provider accounts only where the SP-04 comparison of proprietary candidates needs them), FA-09 native review is open, and no provider, renderer or background-location freeze has been made — `docs/phase3/PHASE3_IMPLEMENTATION_RECORD.md`. **Closure correction (2026-10-14):** the repository-owned gaps (sharded SP-08 PR tier, load harness + FAULT-GEO soak, COMPAT-N1, geo IP-prefix and route-ratio controls, R28 reason, quote purge at deletion, network inventory) are implemented and pass locally; their CI evidence was blocked until hotfix PR #9 merged and GitHub Actions was restored. **Closure CI (2026-10-15/16):** PR #9 merged (`c2d8ac7`); on `4bf4803` the push and PR CI runs, the 4-shard Mobile E2E (14/14 PASS) and the full matrix (API 29 / API 35 / API 35 low-RAM, 50k properties, load + FAULT-GEO soak, network inventory) are green. **Repository-owned engineering closure: PASS. Macro Phase 3: EXTERNAL BLOCKED** (SP-01, SP-02, SP-04, FA-09). PR #8 stays open for review; Phase 4 has not started. **Laptop-only evidence sweep (2026-10-17):** SP-01 emulator TC set, SP-02 constrained-AVD measurements, a self-hosted open-stack desk benchmark (OSRM + Nominatim, Lahore OSM clip), account-free provider contract tests, emulator accessibility walks and an automated Urdu/Roman-Urdu pre-review — all classified supplementary in `docs/phase3/evidence/laptop/`; they closed no SP-01/SP-02/SP-04/FA-09 gate, and one Urdu bidi defect (phone hint) and one copy defect found on the emulator were fixed. **Targeted correction (2026-10-17/18):** geo adapter errors map onto the gateway taxonomy with bounded Retry-After; the release manifest no longer declares expo-location's LocationTaskService (CI gate); an expired access token is refreshed before the first call of a cold start; a reported Urdu masked-number reversal was withdrawn (pixel crops show it in order); the full matrix is green on the final code `af5d8e2` (run 39045502501). Making Mobile E2E a required check was refused by the session permission policy and remains a founder action. **Current gate categories (2026-10-27):** Phase-3 close blockers FA-03/SP-01 (real OEM Android), FA-04/SP-02 (reference low-end Android), FA-05/SP-04 (Lahore field ground truth and provider benchmark) and FA-09 (native Urdu/Roman-Urdu review); conditional dependencies that do not block exit on their own: FA-17 (HTTPS path for the signed-in SP-01/SP-02 subsets, which otherwise stay BLOCKED; TLS is never weakened), FA-06 (provider evaluation accounts, only if proprietary candidates are compared) and FA-19 (Mapbox licence clarification, only if S2 remains a finalist; blocks an S2 freeze); future release gates FA-13 (iPhone/VoiceOver), FA-14 (physical TalkBack, recommended before pilot) and EG-18 (store listing/Data safety). Latest CI on the documentation head `09b7672`: PR run 39063230948 all success including the four Mobile E2E shards (14/14 PASS); push run 39063226015 all success with the shards SKIPPED (no mobile-affecting change). The repository is private again (the PUBLIC period during closure CI is historical); PR #8 is open and unmerged; Phase 4 has not started.

## Phase 3 planning note (2026-10-12)
The first Phase 3 planning attempt stopped because the `main` Android CI job failed twice (stale prefix-restored Gradle cache; runner disk exhaustion). A workflow-only repair merged through https://github.com/haseeb1229/wayvro/pull/6 (merge commit `058fcea`) and `main` returned to green on all five required checks. The macro Phase 3 plan (maps, quotes and core unified Rider/Driver UX; 29 IDs) passed founder/ChatGPT review with targeted fixes (Mapbox Search Box pricing, Mapbox commercial-licence gate, Google subscription model, SP-04 route-critical gate, founder decisions FA-01..FA-19) and is integrated through the Phase 3 planning PR from `docs/phase-3-planning` (`docs/phase3/PHASE3_PLAN.md`). **Phase 3 implementation has not started**; SP-01, SP-02 and SP-04 remain **OPEN / NOT RUN** and no provider or mobile-architecture freeze has been made.
