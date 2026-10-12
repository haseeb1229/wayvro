# PHASE3_PLAN — Maps, quotes and core unified Rider/Driver UX (PROPOSED)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — founder/ChatGPT review verdict "TARGETED FIX BEFORE PASS" (2026-10-12) applied in the review-closure correction (§11); decisions recorded in §9; no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

## 1. Authority and inputs
Authority order: law/safety obligations and founder decisions → audited repository truth and CI evidence → ADRs in force (`docs/adr/README.md`) → Phase 0 artefacts and the requirements register (`docs/requirements-register.json`, schema 5.1) → canonical docs. Inputs read: `CLAUDE.md`, `README.md`, `ALL_FILES_INDEX.md`, `docs/00_README_AND_STATUS.md`, `docs/12_PHASE_PLAN_AND_GATES.md`, `docs/23_FOUNDER_PROMPT_TRACEABILITY.md`, `docs/28_APP_SURFACES_AND_REPO_TOPOLOGY.md`, docs 06–09 and 22, every ADR file, `docs/phase0/PHASE0_ADR_BACKLOG.md`, `docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md`, `docs/phase0/PHASE0_COST_PROVIDER_MATRIX.md`, `docs/phase0/PHASE0_SECURITY_PRIVACY.md`, `docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md`, `docs/phase0/PHASE0_JOURNEYS_AND_STATE_MACHINES.md`, the Phase 0 research files R1–R6, `docs/phase1/PHASE1_HANDOFF_REPORT.md`, `docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md` and the other Phase 2 documents, the full source of `apps/wayvro-mobile`, the API/contracts/db/domain/config/provider/observability packages, migrations 0000–0009, the CI workflow and ruleset, and current primary-source vendor terms and pricing (accessed 2026-10-12; `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md`).

## 2. Repository truth verified before planning

| Check | Result |
|---|---|
| Kickoff `main` | `6aed6a455af3e3b406ef2aea7502ea0c3b06389d` (PR #5 merge; tree identical to PR #5 head `157d197`) |
| Kickoff `main` CI | run 38167751474: Quality / Integration / Security / Web E2E PASS; **Android FAIL twice** — attempt 1 `Could not find org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.0` after a stale prefix-restored Gradle cache; attempt 2 both artefacts built and gated, then the runner died with `No space left on device`. Every Android run since Phase 2 had also logged a failed implicit Gradle cache save. Phase-3 planning was stopped per the kickoff rule. |
| CI repair | separate workflow-only PR #6 `fix/android-ci-cache-disk` ("CI: harden Android cache and runner disk usage"): exact-key Gradle dependency cache, explicit main-only save with verification, disk evidence, removal of reproducible native intermediates. Evidence and merge SHA in `docs/phase3/PHASE3_HANDOFF_REPORT.md` §A. |
| Planning base `main` | `058fcea7c9267d4e7861cb9bdaa1bbdba169a997` (PR #6 merge) — all five required checks green on the push run; differs from `6aed6a4` only in `.github/workflows/ci.yml` |
| Worktree / identity / gh | clean; `Muhammad Haseeb <abdulhaseeb1229@gmail.com>`; `haseeb1229`; ruleset 24837051 active with the five required checks |
| Phase 3 product surface | none: no geo/zone/quote/fare/rate-card/app-version code, route, table or dependency; `features/rider/` is a README |

## 3. Scope
- Register-verified: `phase0.target_phase = 3` = **29 IDs** — P0 17 (A01 A06 A07 B01 B02 B03 B04 B06 E05 E06 E07 E08 H06 I11 U04 U05 V05), P1 11 (A08 H10 K19 L08 P18 Q26 Q27 Q31 V08 V10 V11), P2 1 (R28). Register total **532**. No ID is added, removed or re-prioritised by this plan.
- Classes (`docs/phase3/PHASE3_REQUIREMENT_MATRIX.md`): **IMPL 12** (A01 B04 B06 E05 E07 E08 H06 H10 Q31 R28 V08 V10) · **IMPL+FREEZE 11** (A07 B01 B02 B03 E06 L08 Q26 U04 U05 V05 V11 — implementable, but a freeze or exit step needs SP-01/SP-02/SP-04 evidence) · **IMPL+EXT 6** (A06 A08 I11 K19 P18 Q27 — exit needs a native reviewer, devices, provider-console quotas or similar external evidence).
- In scope: route/map provider abstraction and integration, Lahore geocoding/routing accuracy (SP-04), service products / vehicle classes / zone policy, server-authoritative quote, the one-app Rider and Driver/Partner core shells, mode switching and restoration, low-data/low-end UX, version/update/maintenance controls, accessibility and localization, provider cost controls, performance budgets.
- Out of scope: dispatch/offers/presence/assignment (Phase 4), trip lifecycle and cash accounting (Phase 5), payments/ledger, full safety/support operations (Phase 6), launch, bidding/surge (Phase 9/10), pooling, delivery/corporate/fleet.

## 4. Document map

| Document | Owns |
|---|---|
| `docs/phase3/PHASE3_PLAN.md` | overview, repository truth, scope, findings, contradictions, deferrals, founder decisions, readiness |
| `docs/phase3/PHASE3_REQUIREMENT_MATRIX.md` | per-ID class, checkpoint, elements, controls, external items, evidence for all 29 |
| `docs/phase3/PHASE3_ARCHITECTURE.md` | contexts, components, geo gateway, ports, bundles, degradation, runtime controls, observability |
| `docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md` | products vs vehicle classes, lifecycle, zones, eligibility rules, migrations 0010–0013 |
| `docs/phase3/PHASE3_PRICING_QUOTE_MODEL.md` | rate cards, tax/toll/rounding, quote algorithm, contracts, maker-checker, worked synthetic examples |
| `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md` | per-SKU candidates, primary-source terms/pricing, licence-coherent bundles, cost model, scoring |
| `docs/phase3/PHASE3_MOBILE_UX_AND_NAVIGATION.md` | route tree, ModeController, restoration, intent router, Rider/Driver screens, Lite mode, l10n/a11y |
| `docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md` | permission inventory, manifest delta, location state machines, Play policy |
| `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md` | proposed numeric budgets, methods, CI guards |
| `docs/phase3/PHASE3_SECURITY_COST_THREAT_MODEL.md` | trust boundaries, threats T3-01.., fail-closed checklist, cost controls |
| `docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md` | U04 inventory of current and proposed SDKs/providers |
| `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md` | SP-01 device protocol |
| `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md` | SP-02 device protocol |
| `docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md` + `docs/phase3/PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv` | SP-04 50+ case field benchmark and capture sheet |
| `docs/phase3/PHASE3_SP08_CROSS_MODE_E2E.md` | SP-08 Maestro matrix |
| `docs/phase3/PHASE3_TEST_STRATEGY.md` | layers, families, tiers, per-ID acceptance evidence |
| `docs/phase3/PHASE3_IMPLEMENTATION_SEQUENCE.md` | internal checkpoints P3.0–P3.10 of ONE run, stop rules, gate mapping |
| `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` | FA-01..FA-19 with decisions and exact instructions |
| `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md` | ADR register (003, 006, 013, 019, 029, 031, 033, 046–052), dependency candidates |
| `docs/phase3/PHASE3_IMPLEMENTATION_PROMPT_PROPOSED.md` | proposed full-Phase-3 prompt (not an authorisation) |
| `docs/phase3/PHASE3_HANDOFF_REPORT.md` | CI repair evidence + planning handoff |

## 5. Decisions (summary)
- **Geo:** server-side vendor-neutral ports (autocomplete, forward geocode, reverse geocode, routing); the only client-side vendor surface is the map renderer behind `src/platform/maps` (proposed). Results carry Wayvro `GeoSourceMeta` (opaque provider key, SKU, server fetch time, cache status, latency, confidence, attribution); place references are sealed opaque `placeRef` tokens. Map display is never routing truth.
- **Licence coherence:** primary-source terms make Google geo content unusable with a non-Google map and Mapbox geocoding usable only with a Mapbox map (contractual restrictions). ADR-006's hybrid abstraction (FD-04) stays; the SP-04 choice is among **licence-coherent bundles** (S1 Google, S2 Mapbox, S3 open stack, S4 terms-permitted mixes), enforced at boot by an adapter bundle-compatibility check. Cache TTLs are per-adapter and terms-derived (configured values are maxima only).
- **Cost controls:** per (provider, SKU) daily/monthly budgets with 50/80/100 % signals and refusal at 100 %, circuit breakers, Valkey cache with keyed-HMAC keys, rate limits per account/installation/IP prefix, provider-console hard quotas (founder), usage rollups. No invented ETA, distance, address or price under failure — refuse honestly (CL-15 refuse branch; FD-01 has no metered mode).
- **Catalog:** existing `catalog.service_categories` (CAR/BIKE/RICKSHAW) are **vehicle classes** and stay untouched; R28's Economy/Comfort/Bike/Rickshaw become **service products** with a lifecycle MODELLED → CONFIGURED → ENABLED → legal/operational activation; BIKE/RICKSHAW stay non-enabled while their vehicle class is `DISABLED_LEGAL_GATE`. Versioned zone sets (service area, exclusion, pickup-restricted, airport precinct), service hours (Asia/Karachi, server time), pickup points, district geometry (expand), vehicle eligibility rules (H10/CL-07).
- **Quote:** server-authoritative `POST /v1/quotes` (idempotent) → one route snapshot + one priced option per enabled, eligible product; components on `Money` (PKR minor units, bigint, single rounding point, Σ components = total); versioned rate cards and tax policies with maker-checker, rollback by new version, preview; synthetic Lahore configuration only, refused in production; quote is its own aggregate (PRICED → EXPIRED/SUPERSEDED; ACCEPTED arrives additively in Phase 4).
- **Release controls:** public `GET /v1/app/config`, version headers with 426 enforcement, maintenance 503, DB-backed runtime switches (disable = single authorised staff with step-up; enable = maker-checker); OTA stays out (ADR-031 deferred).
- **Mobile:** one binary; `/ride/*` eager, `/drive/*` lazy, `/home` shared hub, existing `earn/*` kept; ModeController with a persisted preference that is never authorisation and an additive server-derived `AccountState.modes`; restoration by server truth; internal intent router with **no externally registered scheme** in release; text-first rider flow first, renderer plugged in only after the bundle freeze; Lite mode in-app; no gesture/animation native modules without SP-02 evidence.
- **Permissions:** Phase 3 may add only ACCESS_COARSE_LOCATION + ACCESS_FINE_LOCATION (when-in-use, foreground-only expo-location) — **approved (FA-02, 2026-10-12)**, requested just in time only when the rider chooses "use current location", approximate allowed, manual search/pin always usable, denial/revocation recovery UI, Driver readiness may only read the permission state; background location, foreground services, notifications and full-screen intents stay out until Phase 4 and SP-01 evidence.
- **Freezes:** ADR-029 and ADR-003 only on SP-01/SP-02 real-device evidence; ADR-006 and ADR-046 together, only on SP-04 field evidence; SP-04 thresholds and performance budgets approved as **pre-measurement** values (FA-07), changeable only through evidence + reviewed ADR update, never tuned after measurement to obtain a PASS; a bundle with an unresolved CRITICAL route invalidity is never frozen (SP-04 §7.1, gate G4). Emulator results never close SP-01/SP-02.

## 6. Repository findings

| # | Finding | Planned handling |
|---|---|---|
| F-P3-01 | The release AAB registers an external URL scheme `exp+wayvro` (VIEW/BROWSABLE). Provenance: `expo-dev-client` 57.0.19 is auto-applied by `expo prebuild` (`@expo/prebuild-config` legacy plugin list) and its `withGeneratedAndroidScheme` (`addGeneratedScheme` default true) appends `exp+<slug>` to the shared main manifest, so it reaches release builds; in release the dev launcher is inactive and the URL is delivered to the app's router. ADR-043 ("no URL scheme") and the `osv-scanner.toml` decode-uri-component exception premise ("no URL scheme, intent filter or universal link is registered") are therefore inaccurate. **Re-verified 2026-10-12 on a CI-built artefact:** the release AAB of PR #6 run 38177849934 (merge ref `5c7b7c3`, app tree identical to `main`), dumped with bundletool 1.18.3, declares `dev.wayvro.app.MainActivity` `exported=true` with an intent filter VIEW + DEFAULT + BROWSABLE + `android:scheme="exp+wayvro"` (the only other BROWSABLE entry is a `<queries>` package-visibility declaration, not a handler). Detail: `docs/phase3/PHASE3_HANDOFF_REPORT.md` §B. | **P3.0 first checkpoint:** variant-conditional removal (release has no generated scheme; debug keeps it because the dev-client launch path uses it), an exported-component/intent-filter release gate, ADR-043 and osv reason corrections. No intentional deep link while the decode-uri-component exception is open; the exception is not extended casually (expires 2026-12-31). |
| F-P3-02 | Android CI depended on a stale prefix-restored Gradle cache and ran at the runner's disk limit. | Fixed before planning by PR #6 (workflow-only). |
| F-P3-03 | No runtime config, kill switch or app-version policy exists; flags are code-only. | P3.4 release controls (A01/Q31/V10). |
| F-P3-04 | "Service category" collision: existing table = vehicle classes; R28 needs products. | New `catalog.service_products`; existing table unchanged. |
| F-P3-05 | No metrics SDK; cost telemetry precedent is the OTP budget (Valkey counters + log signals). | Same pattern + `geo.provider_usage` rollups; metrics stack stays Phase 4 (I07). |
| F-P3-06 | Size headroom: rider download arm64-v8a ≈ 25.65 MB, armeabi-v7a ≈ 24.91 MB vs proposed 30.0/29.0 MB budgets. | Renderer choice is size-constrained; SP-02 measures before and after. |
| F-P3-07 | Release Metro bundles are a single Hermes bundle; `import()` defers evaluation, not download. | "Lazy driver modules" = deferred evaluation; SP-02 measures module evaluation. |
| F-P3-08 | Reanimated/gesture-handler/worklets are excluded from native autolinking. | Phase-3 UX without gesture-driven sheets unless SP-02 evidence + ADR-043 amendment. |
| F-P3-09 | oasdiff gate was deferred "for Phase 3". | Enabled in P3.0. |
| F-P3-10 | minSdk 24 vs R4 suggestion 26–29. | Q31 supported-OS matrix proposal; no native bump inside Phase 3 without evidence. |
| F-P3-11 | `staff.role_assignments.role` has a DB CHECK listing the seven Phase-2 roles. | FA-10 approved dedicated least-privilege roles PRICING_MANAGER, CATALOG_MANAGER, RELEASE_MANAGER: migration 0010 widens the CHECK (expand-safe superset, no data change, tested from every previous prefix); real maker-checker needs distinct humans before exposure. |
| F-P3-12 | `compliance.vehicles` lacks seats/body/AC; H10 rules on those attributes can only evaluate to UNKNOWN today. | Optional additive claim columns proposed (founder scope decision). |
| F-P3-13 | Requirement-set child rows are protected only in the service layer (no guard trigger). | Phase-3 config tables use DB guard triggers. |
| F-P3-14 | The release app accepts only an https API origin outside `__DEV__`; no HTTPS synthetic environment exists. | FA-17 (temporary HTTPS synthetic endpoint or staging) for SP-02 signed-in measurements and SP-01 TC-01 runtime check. |
| F-P3-15 | The repository is private; Actions minutes are finite and the Android job is long. | SP-08 PR tier ≤ 15 min; nightly cadence per FA-16. |

## 7. Gaps, clarifications and contradictions

### 7.1 New requirement
None. Every Phase-3 need maps to an existing register ID; the register stays at 532.

### 7.2 Clarifications (proposed)
- CL-P3-01: R28 "categories" are service products; vehicle classes remain the compliance key.
- CL-P3-02: Quote is its own aggregate (SM-2); no trip/ride row in Phase 3.
- CL-P3-03: Under routing outage the pilot-compatible behaviour is refusal (CL-15 × FD-01).
- CL-P3-04: Driver "suspended" is a DRIVER_ROLE restriction, not a profile state (K19 mapping).
- CL-P3-05: V10 cross-mode harness is scaffolded and run nightly in Phase 3; making it a required PR check is a Phase-4 ruleset change (founder).
- CL-P3-06: Deep-link routing (V08) is built and tested internally; external scheme/app-link registration waits EG-15 and the decode-uri-component gate.

### 7.3 Contradictions resolved

| # | Contradiction | Resolution |
|---|---|---|
| CON-P3-01 | Phase-0 proposal says BullMQ; ADR-042 says PostgreSQL jobs | ADR-042 (in force) |
| CON-P3-02 | "Redis 7"/MinIO wording vs Valkey/SeaweedFS (ADR-037/ADR-010) | ADRs; Valkey is never authoritative |
| CON-P3-03 | Provider preference differs across R5, cost matrix, docs/09 | No preference frozen; SP-04 per bundle (FD-04) |
| CON-P3-04 | Google at pilot exceeds FD-14 envelope | Google modelled both PAYG (≈ USD 450–750) and subscription (Essentials ≈ USD 275–375; Pro-route variants up to ≈ 1,200); every variant exceeds the ≈ USD 0 geo headroom, so Google only with an SP-04 quality need and FA-08; no single pricing model decides affordability |
| CON-P3-05 | SP-02 size budget missing / device naming differs | Numeric proposal in `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md` (FA-07) |
| CON-P3-06 | SP-01 pass criteria differ (backlog vs R4) | Backlog criteria + R4 items 1–4, 6–8, 10–11; item 5 belongs to SP-02 |
| CON-P3-07 | V08 deep links vs "no URL scheme until identifiers clear" | Internal router now; external registration later (CL-P3-06) |
| CON-P3-08 | CL-15 metered mode vs FD-01 fixed pricing | Refuse only |
| CON-P3-09 | Trip aggregate DRAFT→QUOTED vs SM-2 quote aggregate | SM-2 |
| CON-P3-10 | PKR 10 rounding stated as fact vs option needing accounting review | Rate-card field; synthetic only; real value FA-15 before pilot |
| CON-P3-11 | Lite mode in Phase 3 vs ADR-019 PROPOSED | In-app Lite mode, Phase 3 |
| CON-P3-12 | OTA treated as a control vs ADR-031 PROPOSED, no expo-updates | Deferred; no expo-updates in Phase 3 |
| CON-P3-13 | ADR-027 timing for Playwright/Maestro | Playwright already Phase 2; Maestro Phase 3 (ADR-052) |
| CON-P3-14 | Compose with OSRM (Phase 0) vs ADR-037 compose | Optional benchmark-only profile; never the default stack |
| CON-P3-15 | K19 partially delivered in Phase 2 | Phase-3 remainder = state coverage, offline resume, device a11y, native review |
| CON-P3-16 | "Provider per SKU" vs vendor terms coupling geo content to their maps | Licence-coherent bundles; boot-time compatibility check |
| CON-P3-17 | Draft S2 cost applied Mapbox Search Box **request** pricing (25,000 free, USD 1.70/1K) to **session** billing; Mapbox also requires a Commercial Application License for vehicle usage | Corrected in review closure: sessions standard 2,500 free then USD 11.50/1K (preview 500 free then USD 3.00/1K, not assumed); request billing only for /category and /reverse; S2 pilot ≈ USD 38–325 by explicit billing mode; licence applicability EXTERNAL (FA-19), no fee assumed, no pilot/production S2 freeze while open |

## 8. Intentionally deferred
Ride request/accept (Phase 4), presence and background location in the shipped app (Phase 4 after SP-01), push notifications (Phase 4), offer delivery (ADR-033, Phase 4), fare adjustment on actual route and receipts (Phase 5), promotions/discount engine, commission, bidding (Phase 9), surge (Phase 10), metrics stack (I07 Phase 4), OTA (ADR-031, Phase 7 decision), external deep links/app links (after EG-15), iOS physical validation (Phase 7 unless earlier hardware), real zone/district boundaries and real rate cards (before pilot).

## 9. Founder decisions (recorded 2026-10-12 at plan-review closure)

| FA | Decision |
|---|---|
| FA-01 | **APPROVED**, subject to the review-closure correction being merged. |
| FA-02 | **APPROVED** for the Phase-3 implementation branch: release app may declare `android.permission.ACCESS_COARSE_LOCATION` and `android.permission.ACCESS_FINE_LOCATION`; just-in-time request only when the rider chooses "use current location"; approximate allowed; manual search/pin remains usable; denial/revocation recovery UI; Driver readiness may read permission state, Phase 3 never requests background Driver location. Still forbidden in the Phase-3 release app: ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE_LOCATION / location FGS for Driver mode, POST_NOTIFICATIONS (unless separately justified later), USE_FULL_SCREEN_INTENT, microphone, contacts, broad media/storage. SP-01 may use a separate non-release spike build. |
| FA-07 | **APPROVED** as pre-measurement budgets and SP-04 thresholds, plus the route-critical hard gate; changed only through evidence + reviewed ADR update. 30.0 MB arm64-v8a / 29.0 MB armeabi-v7a download stays the initial hard target; if every admissible renderer exceeds it, report evidence and a bounded founder decision before provider/renderer freeze — never a silent raise. |
| FA-08 | **No paid spend pre-approved** (Transistorsoft, paid map tiers each need a specific decision after evidence). |
| FA-09 | Native Urdu / Roman-Urdu **human** review required before Phase-3 exit for the relevant content requirements; AI copy alone never satisfies it. |
| FA-10 | **APPROVED** dedicated least-privilege roles PRICING_MANAGER, CATALOG_MANAGER, RELEASE_MANAGER; COMPLIANCE_ADMIN/STAFF_ADMIN are not overloaded. |
| FA-11 | **APPROVED**: BIKE/RICKSHAW may be MODELLED and stay DISABLED_LEGAL_GATE until written legal/permit/insurance evidence; ECONOMY CONFIGURED/ENABLED only in local/test synthetic configuration; pilot/production activation separately gated. |
| FA-12 | **SYNTHETIC** Lahore zones/boundaries for Phase-3 engineering; no unreviewed real boundary import; real licensed/approved boundaries later. |
| FA-16 | **APPROVED**: PR smoke tier ≤ 15 min; full cross-mode matrix on manual workflow and mandatory at Phase-3 closure; no nightly full-matrix schedule while the repository is private. |
| FA-17 | **APPROVED in principle** for SP-01/SP-02 only: ephemeral vetted HTTPS tunnel or later staging, synthetic data only, nothing committed, minimal exposure, torn down after each session, tunnel terms/security verified first; otherwise signed-in device measurements stay BLOCKED (never weakened TLS). |
| FA-18 | **DEFERRED to Phase 4**; SP-01 TC-22 push-wake portion NOT RUN in Phase 3; no Firebase project now. |
| FA-03/04/05/06 | Remain genuine founder/external actions once the harnesses exist (real devices, low-end device, Lahore field benchmark, evaluation accounts/keys — never committed). |
| FA-19 (new) | Mapbox Commercial Application License (vehicle usage) applicability — EXTERNAL written Mapbox/legal confirmation before any pilot/production S2 freeze. |

The full implementation run does not stop for any decided item; details and steps: `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md`.

## 10. Readiness
- Engineering design: reviewed; targeted fixes applied (§11); remaining proposals marked PROPOSED / OPEN-SPIKE / EXTERNAL.
- Evidence not yet available: SP-01, SP-02, SP-04 (real devices and field drives), provider evaluation accounts, native Urdu review, HTTPS synthetic endpoint.
- Recommendation for the implementation authorisation: one full Phase-3 run per `docs/phase3/PHASE3_IMPLEMENTATION_PROMPT_PROPOSED.md`, with founder evidence tracks (FA-03..FA-06, FA-09, FA-17) started in parallel from P3.2.

## 11. Plan-review closure (2026-10-12)
Verdict "TARGETED FIX BEFORE PASS" on reviewed head `dfb3e41`; architecture, requirement mapping, CI repair, SP-01/SP-02/SP-04/SP-08 structure, server-authoritative quote, one-app model and provider-neutral architecture accepted. Corrections applied:
1. Mapbox Search Box pricing split into **sessions** (standard 2,500 free then USD 11.50/1K; introductory preview 500 free then USD 3.00/1K, not assumed available) and **requests** (/category and /reverse only; standard 25,000 free then USD 1.70/1K; preview 50,000 free then USD 1.00/1K); every S2 estimate names its billing mode (`docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md` §7).
2. Mapbox Commercial Application License for vehicle usage recorded verbatim with access date; applicability EXTERNAL (FA-19); no fee invented; no pilot/production S2 freeze while unresolved; SP-04 evaluation may use a permitted evaluation/free account.
3. Google modelled as PAYG **and** subscription (Starter/Essentials/Pro, combined call pools, overage at PAYG, Navigation SDK in no plan); revised pilot range ≈ USD 275–1,200 depending on plan and route tier.
4. SP-04 route-critical hard gate (wrong-way, private/inaccessible, prohibited/closed, unsafe/impossible manoeuvre, systematic severe defect) added to SP-04 §7.1 and gate G4.
5. Founder decisions recorded (§9); the full run proceeds through checkpoints without routine approvals, but Phase 3 is not declared complete while required real-world evidence (SP-01, SP-02, SP-04, native Urdu review) is missing — affected items are BLOCKED-EXTERNAL / PARTIAL, nothing is guessed or frozen (`docs/phase3/PHASE3_IMPLEMENTATION_SEQUENCE.md` §1.1).
6. F-P3-01 stays the first implementation checkpoint: the expo-dev-client generated `exp+<slug>` scheme (Expo docs, https://docs.expo.dev/versions/latest/sdk/dev-client/ "Configurable properties", accessed 2026-10-12: `addGeneratedScheme` default `true`, "By default, expo-dev-client will register a custom URL scheme to open a project … Set this property to false to disable this scheme"; the `exp+<slug>` value comes from the installed plugin source, `getDefaultScheme.js`) exists only in development builds; release AAB intent filters/schemes verified in CI; intentional deep links stay disabled while the decode-uri-component exception is open; the 2026-12-31 exception is not extended casually; developer dev-client functionality preserved.
7. Provider-terms findings preserved for re-check at the final freeze: Google geo content not in conjunction with a non-Google map, service-specific caching limits; Mapbox temporary-geocoding storage restriction and Mapbox-map-only use, Search Box billing modes not conflated; public Nominatim prohibits autocomplete and is not a production backend. No provider is hard-coded by planning.
