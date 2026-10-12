# PHASE3_ADR_AND_DEPENDENCY_PROPOSALS — Decisions and dependencies for Phase 3 (PROPOSED — nothing installed)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — founder/ChatGPT plan review recorded 2026-10-12 (FA decisions in `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` §1a; NEW FA-19 Mapbox licence gate); no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

**No ADR file is created by this planning pack.** Each ADR below is written as a new file under `docs/adr/` (and indexed in `docs/adr/README.md`) at the checkpoint named in §1, with the evidence available at that time; until then the Phase 0 backlog rows in `docs/phase0/PHASE0_ADR_BACKLOG.md` and the existing ADR files stay authoritative. Package versions below are **planning-time candidates** read on 2026-10-12 (web research summarised in `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md`); they are re-checked at install under the installation rule in §4.

**Status legend (Phase 3 plan vocabulary — the only status words used in this pack):** FOUNDER-LOCKED = direction approved by the founder in Phase 0, parameters open (the Phase 0 backlog's founder-approved, gated rows; still subject to the named spike/evidence) · PROPOSED = recommendation awaiting approval · OPEN-SPIKE = decided only by a spike result · EXTERNAL = needs counsel/vendor/founder business input · ACCEPTED-ON-EVIDENCE = the state an ADR file reaches when written with evidence (none in this pack).

## 1. ADR register for Phase 3

| ADR | Title | Status now | Evidence needed | File written at | Reversal path |
|---|---|---|---|---|---|
| ADR-003 | Mobile stack freeze (RN + Expo dev builds) | FOUNDER-LOCKED direction (FD-09) + OPEN-SPIKE | SP-01 + SP-02 results on real devices | P3.6 | Flutter fallback evaluation (documented, not pre-built) |
| ADR-006 | Maps/geo provider per licence-coherent bundle | FOUNDER-LOCKED abstraction (FD-04) + OPEN-SPIKE (choice) + EXTERNAL (licence reading) | SP-04 metrics, cost per 1,000 quotes, terms review | P3.7 | swap adapter bundle behind ports; cache namespaced per provider |
| ADR-013 | Pricing and quote domain | FOUNDER-LOCKED scope (FD-01/FD-02) + PROPOSED model + EXTERNAL values | property/concurrency tests; founder/accountant values later | P3.3 | quotes are versioned snapshots; new engine version, old quotes unchanged |
| ADR-019 | Lite mode (in-app) | PROPOSED | SP-02 data-budget measurements | P3.5 | remove toggle; standard mode remains |
| ADR-029 | Background-location SDK | OPEN-SPIKE (+ FD-08 cost gate) | SP-01 candidate A results; candidate B only if A fails | P3.6 | swap behind the future driver location module (Phase 4) |
| ADR-031 | OTA JS updates | PROPOSED, **deferred** (no expo-updates in Phase 3) | none in Phase 3 | not written in Phase 3 (Phase 7 decision); ADR-049 records the compatibility constraint | n/a |
| ADR-033 | Driver offer wake/alert strategy | FOUNDER-LOCKED direction, unchanged; parameters OPEN-SPIKE | SP-01 measures socket/poll delivery with push disabled | measurements recorded in the ADR-029 file at P3.6; ADR-033 file written in Phase 4 with the implementation | n/a in Phase 3 |
| ADR-046 (new) | Map rendering client architecture | PROPOSED + OPEN-SPIKE (renderer) | SP-04 bundle choice + SP-02 size/memory/jank | P3.7 | renderer behind `src/platform/maps/` interface; Lite/text-first fallback always present |
| ADR-047 (new) | Geo gateway: cache, quotas, cost controls, circuit breakers, privacy | PROPOSED | integration tests with real Valkey; COST-BUDGET, BRK, CACHE-KEY, SEC-LOG | P3.2 | gateway stages are independent middleware; values are config |
| ADR-048 (new) | Unified-app mode, navigation, restoration and intent routing | PROPOSED | unit tests + SP-08 PR-tier Maestro | P3.5 | additive `AccountState.modes`; ModePreference is a hint and can be dropped |
| ADR-049 (new) | App version, update, maintenance and runtime switches | PROPOSED | SEC-VERSION, SEC-SWITCH, migration tests | P3.4 | policies/switches are rows; disabling enforcement = no ACTIVE policy |
| ADR-050 (new) | Phase 3 performance budgets | PROPOSED; budget values APPROVED pre-measurement (FA-07, 2026-10-12) | SP-02 baseline + post-map measurement on the reference device | P3.6 (baseline), updated P3.7 and P3.10 | budgets change only with explicit evidence, founder approval and a reviewed ADR update — never tuned after seeing measurements; the 30.0 MB / 29.0 MB download target is never silently raised |
| ADR-051 (new) | Service products vs vehicle classes, zone sets and activation lifecycle | PROPOSED | migration tests (clean + every prefix), SEC-ZONE, SEC-CATALOG | P3.1 | expand-only tables; vehicle classes untouched |
| ADR-052 (new) | Mobile E2E tooling (Maestro on emulator) | PROPOSED | SP-08 PR-tier runtime ≤ 15 min | P3.5 | flows are YAML; replaceable by Detox/Appium without app changes |

**Amendments to existing ADR files (in force) planned in Phase 3:**
- ADR-043 — P3.0 correction: the release AAB registers the expo-dev-client `exp+wayvro` scheme (F-P3-01, verified on the 2026-10-11 local release AAB; re-verification on the post-repair CI artefact recorded in `docs/phase3/PHASE3_PLAN.md`); the fix keeps the generated `exp+<slug>` scheme in development builds only (documented `addGeneratedScheme` option applied variant-conditionally; dev-client functionality preserved) and the "no URL scheme" premise is corrected together with the `osv-scanner.toml` runtime-exception reason (the 2026-12-31 expiry is not extended casually; intentional deep links stay disabled while that exception is open), and the new intent-filter gate (CI verifies release AAB intent filters/schemes) is recorded. A second amendment is needed only if reanimated/gesture-handler are re-added (F-P3-08) or a map renderer changes the native-module set (ADR-046 cross-reference).
- ADR-027 — P3.0: oasdiff contract-break gate enabled against the Phase 2 OpenAPI baseline (F-P3-09); Maestro reference to ADR-052.
- ADR-045 — P3.2: geo synthetic doubles join the ART-ISO checks (no new decision, scope extension).
- ADR-004, ADR-042 — applied, not changed (hand-written PostGIS SQL; usage rollups/purge as PostgreSQL jobs).

## 2. ADR proposals in detail

### ADR-003 — Mobile stack freeze
- **Context:** FD-09 approved RN + Expo development builds as primary direction, frozen only after SP-01 and SP-02 pass. Phase 1–2 built on Expo SDK 57.0.27 / RN 0.86.3 / React 19.2.3 (ADR-043). Phase 3 adds location, a map renderer and two mode graphs.
- **Options:** (a) freeze RN + Expo dev builds; (b) RN bare; (c) Flutter fallback.
- **Proposed decision:** freeze (a) if SP-01 (≥ 95 % location points over 60 min screen-off on ≥ 3 OEM classes, no BG/FGS prompt in the rider path, revocation ≤ 30 s, deterministic crash/kill recovery) and SP-02 (budgets in ADR-050) pass. If SP-01 fails with candidate A, try candidate B (ADR-029, FD-08) before any stack change.
- **Evidence:** `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md`, `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md` results.
- **Consequences:** a freeze forbids Expo/RN line changes in Phase 3 (ADR-030); a FAIL is recorded as FAIL with the fallback executed, never forced green.
- **Reversal:** Flutter evaluation is a separate founder-authorised phase; domain/contracts are client-independent (`packages/contracts`).

### ADR-006 — Maps/geo provider (licence-coherent bundles)
- **Context:** FD-04 approved a hybrid provider abstraction with the provider chosen per SKU after SP-04. Planning research (accessed 2026-10-12; sources and CONTRACTUAL/TECHNICAL classification in `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md` §6.1) found **licence coupling** (CON-P3-16): Google Maps Platform terms forbid using Google geo content (geocoding, routes, places) with or near a non-Google map (CONTRACTUAL); Mapbox geocoding responses may only be used with a Mapbox map and temporary results may not be cached (CONTRACTUAL); OSM-based data requires attribution and ODbL share-alike for derivative databases (CONTRACTUAL licence). None of these is enforced by the APIs (no TECHNICAL barrier), so compliance rests on Wayvro's own binding rules. A free per-SKU mix is therefore not generally permitted.
- **Options (bundles):**
  - **S1 Google:** a Google renderer on **both** platforms — react-native-maps with the Google provider (Google Maps SDK on Android and iOS); expo-maps is not an S1 renderer on iOS because it renders Apple Maps there (TECHNICAL SDK limitation that would breach the CONTRACTUAL Google-map-only rule) — + Google Places/Geocoding/Routes. Native mobile map display listed at no charge; geo SKUs 10,000 free per SKU/month then paid — exceeds the FD-14 envelope at pilot volume (CON-P3-04).
  - **S2 Mapbox:** @rnmapbox/maps + Mapbox Search/Geocoding/Directions. Free allowances cover pilot volume; temporary geocodes uncacheable; telemetry opt-out mandatory; MAU billing; Search Box billing modes (sessions vs requests; introductory preview vs standard pricing) must not be conflated. **Commercial licence gate (FA-19, EXTERNAL):** Mapbox's pricing page (https://www.mapbox.com/pricing, Licensing section, accessed 2026-10-12, no page date) states a "Commercial Application License for vehicle, B2B, and internal business applications" is required "for vehicle usage (including ground, aerial, manned and unmanned vehicles)" and for "applications primarily intended for use within vehicles or use in any vehicle system or component thereof", consisting of "an annual subscription and, where applicable, a per-user or seat-based component". Whether this applies to Wayvro Rider/Driver use is not decided here and no fee is assumed; written Mapbox sales/legal clarification is required before public pay-as-you-go pricing is treated as S2's complete production cost, and **no pilot/production S2 freeze while FA-19 is unresolved** (SP-04 evaluation may still use a permitted evaluation/free account under its terms).
  - **S3 Open stack:** MapLibre renderer + OpenFreeMap (no SLA) or self-hosted Protomaps tiles + OSRM/Valhalla routing + self-hosted Photon/Nominatim geocoding. Infrastructure cost only; Lahore quality unknown (SP-04 measures).
  - **S4 Terms-permitted mixes only:** e.g. MapLibre/open tiles + open routing + a geocoder whose terms allow any map (TomTom/HERE terms not yet verified). Google/Mapbox geo content is excluded from S4 unless counsel or the vendor confirms otherwise.
- **Proposed decision:** keep the vendor-neutral ports (`placesAutocomplete`, `geocoding`, `reverseGeocoding`, `routing`, `mapStyle` descriptor); score SP-04 per SKU but **choose only among licence-coherent bundles**; record the chosen bundle and per-adapter terms-derived cache TTLs (Google route caching TTL 0 until the route-caching terms are read at P3.7); storing Google/Mapbox route geometry in the 30-day quote route snapshot is a COUNSEL/terms item — the snapshot keeps Wayvro-derived distance/duration and only open-licensed or provider-permitted geometry, otherwise the geometry follows the terms-derived TTL; pricing-only use of a vendor's route alongside a different renderer is treated as not allowed unless confirmed; boot-time bundle compatibility check (threat model T3-22).
- **Evidence:** SP-04 thresholds (FA-07 APPROVED 2026-10-12 as pre-measurement values) including the **route-critical hard gate** — an unresolved CRITICAL route invalidity (wrong-way on a one-way, private/inaccessible segment used as normal routing, prohibited/closed passage, unsafe/impossible manoeuvre, systematic severe defect) makes a bundle ineligible for freeze, clearable only by ground-truth correction, evidence-backed provider/config/map-data correction plus re-run, or a founder-signed product mitigation proving the route is never presented/used; cost per 1,000 quotes at pilot volume within FD-14; terms extracts with access dates; founder + counsel licence reading (EXTERNAL, EG-11); FA-19 written Mapbox confirmation if S2 is a candidate; any paid tier only with a specific FA-08 decision (none pre-approved).
- **Consequences:** if no bundle passes thresholds within budget, the freeze stays OPEN and quotes run on the best bundle only in non-production environments; production activation waits.
- **Reversal:** adapter bundle swap behind ports; caches are namespaced by provider so a switch never serves the previous vendor's content.

### ADR-013 — Pricing and quote domain
- **Context:** FD-01 (fixed/upfront pilot), FD-02 (bidding Phase 9). CON-P3-09: Quote is its own aggregate (SM-2), not a trip state. CON-P3-10: PKR 10 rounding is an option needing accounting review.
- **Options:** quote inside a trip aggregate vs separate Quote aggregate; components stored vs recomputed on read; float vs bigint money.
- **Proposed decision:** separate `pricing` schema; Quote aggregate PRICED → EXPIRED | SUPERSEDED (ACCEPTED added additively in Phase 4); components persisted with Σ components = total enforced by a deferred constraint trigger; all money via `Money` (bigint minor units), HALF_EVEN for distance/time, rate-card `rounding_step_minor` + `rounding_mode` with a ROUNDING component; rate cards and tax policies maker-checker with rollback by new version; synthetic config only (production refuses synthetic activation); `pricing_engine_version` recorded on each quote.
- **Evidence:** PROP-QUOTE determinism and invariants, CONC-QUOTE-IDEM, migration tests, SEC-RATECARD.
- **Consequences:** commission, tax rates, toll and rounding values remain EXTERNAL (FA-15, Phase 8).
- **Reversal:** new engine version; historical quotes are immutable snapshots.

### ADR-019 — Lite mode
- **Context:** L08; a second app contradicts ADR-026 (CON-P3-11).
- **Options:** in-app Lite mode; separate Lite app; web-only booking.
- **Proposed decision:** in-app Lite mode — no map tiles, text-first route summary, `?detail=lite` omits the polyline, no auto-refresh, stale indicators; auto-suggested from request-timing heuristics (no NetInfo) or toggled manually.
- **Evidence:** SP-02 data budget (Lite ≤ 150 KB per standard quote flow — ADR-050).
- **Consequences:** every map screen needs a text-first equivalent (also an accessibility benefit).
- **Reversal:** remove the toggle; standard mode unaffected.

### ADR-029 — Background-location SDK
- **Context:** FD-08: commercial SDK only if the free path is insufficient. Phase 3 ships no background location; SP-01 runs outside the release app.
- **Options:** A expo-location + expo-task-manager foreground service (free; Expo SDK 57 bundled versions); B Transistorsoft react-native-background-geolocation (5.8.0 on 2026-10-12; free in debug builds, licence required for release builds; Starter USD 399 one-time, 1 app key + 1 year updates); C native module written in-house (rejected unless A and B fail — maintenance burden).
- **Proposed decision:** run SP-01 with A (in the separate non-release spike build); B only on A's documented failure and a specific founder spend decision (FA-08; no paid spend is pre-approved).
- **Evidence:** SP-01 protocol results per OEM class.
- **Consequences:** the chosen SDK is integrated in Phase 4 behind a driver location module; permissions (BACKGROUND/FGS location) are added only then, with a new FA-02-style approval.
- **Reversal:** module boundary in the app; server ingestion contract is SDK-independent.

### ADR-031 — OTA JS updates (deferred)
- **Context:** CON-P3-12; `updates.enabled=false`; node-forge exception in `osv-scanner.toml` relies on EAS Update signing being disabled.
- **Proposed decision:** no expo-updates in Phase 3. ADR-049 keeps version policy compatible with a later OTA layer (JS-only, signed, staged, never native or permission changes).
- **Reversal/consequence:** decision in Phase 7; adding OTA later requires re-checking the node-forge exception.

### ADR-033 — Driver offer wake/alert strategy
- **Context:** founder-approved direction (M26): while online, the location foreground service hosts the realtime socket/poll/recovery path as the primary offer channel; push is a wake aid only; `USE_FULL_SCREEN_INTENT` not requested by default.
- **Proposed decision:** unchanged. SP-01 measures delivery latency and recovery with push disabled; values recorded in the ADR-029 file; no Phase 3 implementation.

### ADR-046 (new) — Map rendering client architecture
- **Context:** the only client-side vendor surface is the renderer. Size headroom ≈ 4.3 MB to the 30 MB budget (F-P3-06); reanimated/gesture-handler excluded (F-P3-08); renderer choice is bound to the ADR-006 bundle.
- **Options (planning-time facts, re-verify):**
  - `@maplibre/maplibre-react-native` 11.5.0 (2026-10-04; MIT; New Architecture only from v11; peers RN ≥ 0.80, Expo ≥ 54; config plugin; **not** in the Expo SDK 57 bundled-module list, so maturity is judged under ADR-030 — v11 line GA since 2026-04 with follow-up patches);
  - `react-native-maps` 1.27.2 (the version Expo SDK 57 pins; MIT; Google Maps SDK on Android — needs Google Play services and an API key; S1 only, and S1 requires its Google provider on iOS too);
  - `expo-maps` ~57.0.4 (Expo first-party; Google Maps on Android, Apple Maps on iOS — therefore an S1 renderer on Android only; maturity/stability status to verify at P3.7);
  - `@rnmapbox/maps` 10.3.7 (MIT wrapper over the Mapbox Maps SDK v11; access token; telemetry opt-out mandatory; S2 only).
- **Proposed decision:** a renderer-neutral `src/platform/maps/` interface (camera, marker, polyline, pin-drag events, attribution slot) with style/tile URL and any token from `GET /v1/app/config`; renderer chosen at P3.7 from the ADR-006 bundle and SP-02 measurements (download size delta, memory p90, jank); Lite/text-first rendering always available; no gesture-driven bottom sheets.
- **Evidence:** bundletool size delta per ABI, dumpsys memory, gfxinfo jank on the reference device; network capture for telemetry (U04).
- **Consequences:** renderer telemetry and data collection documented in `docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md`; attribution displayed as required.
- **Reversal:** swap renderer behind the interface; screens never import the vendor package directly (architecture test).

### ADR-047 (new) — Geo gateway
- **Context:** E06/E07/I11; no geo port exists; Valkey has never been a data cache; no metrics SDK (F-P3-05).
- **Options:** client-side provider SDKs (rejected: keys on device, no quotas, privacy); server gateway with in-house stages (proposed); third-party API gateway product (rejected: extra operated service).
- **Proposed decision:** server-only provider calls; pipeline normalise → limits (account/installation/IP prefix) → Valkey cache (keyed, provider-namespaced, terms-derived TTL ≤ configured maxima) → budget (daily/monthly calls + micro-USD cost; 50/80/100 % signals; refuse at 100 %) → circuit breaker per (provider, sku) (open at ≥ 50 % failures over ≥ 20 calls in 60 s or 5 consecutive timeouts; 30 s open; 3 half-open probes) → adapter with timeout (autocomplete 1.5 s, geocode 2.0 s, reverse 2.0 s, directions 2.5 s) inside a request deadline: `POST /v1/quotes` has an overall server deadline (`QUOTE_DEADLINE_MS` 3,000 ms) and its routing call is a single attempt with timeout min(2.5 s, remaining deadline), never retried; geo reads (autocomplete, geocode/place resolve, reverse) have a deadline of SKU timeout + 500 ms and allow at most one retry, on a connect error only and only if the remaining deadline ≥ the SKU timeout (deadline-aware retry); the p99 ≤ 1.5 s quote budget (ADR-050) applies to successful cache-miss quotes with that single routing attempt, while deadline refusals are counted in a separate refusal-rate budget — all values PROPOSED → normalise with `GeoSourceMeta` → cache write → usage meter (hourly rollup to `geo.provider_usage`). Opaque AEAD-sealed `placeRef`. Cache keys derived from coordinates or search text are **HMAC-SHA-256 digests** (keyed), so Valkey contents and `MONITOR` output reveal neither locations nor queries. Fail closed when the limiter/budget store is down. Circuit breaker implemented in `packages/server-runtime` (no new dependency).
- **Evidence:** integration tests against real Valkey/PostgreSQL; COST-BUDGET, BRK, CACHE-KEY, SEC-PLACEREF, SEC-LOG, CONFIG-BUNDLE.
- **Consequences:** geo availability depends on budgets by design; degraded UX copy for each refusal.
- **Reversal:** stages are config-driven; a metrics stack (I07, Phase 4) can replace log signals without changing the gateway contract.

### ADR-048 (new) — Unified-app mode, navigation, restoration and intent routing
- **Context:** V08, V05, V11, INV-05/06/07; CON-P3-07 (no external scheme until EG-15).
- **Options:** separate root navigators per mode vs route groups in one stack; client-held role flags vs server-derived modes.
- **Proposed decision:** rider routes under the URL segment `/ride/*` (eager) and driver routes under `/drive/*` (lazy evaluation), each a plain directory inside the existing `(session)` group with its own thin layout; `/home` stays the shared account hub; existing `earn/*` retained; ModePreference persisted as a hint; server-derived additive `AccountState.modes`; restore precedence (required actions → server account state → permitted preference else Rider home → pending quote restore); `router.replace` on mode switch; pure `resolveIntent` with an allowlist; no externally registered scheme in release.
- **Evidence:** unit tests of restore precedence and intent resolution; SP-08 PR-tier flows; SP-02 "0 driver modules evaluated at rider startup".
- **Reversal:** additive contract fields; preference can be removed without data migration.

### ADR-049 (new) — App version, update, maintenance and runtime switches
- **Context:** A01, Q31, V10; F-P3-03 (FLAG_REGISTRY is code-only, no kill switch).
- **Options:** store-only update prompts; client-only remote config; server-stored policies with enforcement (proposed).
- **Proposed decision:** `platform.app_version_policies` and `platform.runtime_switches` (maker-checker; DISABLE fast path with step-up and audit; switches can only reduce capability); `GET /v1/app/config` public and cacheable; 426 `WAYVRO_E_APP_UPDATE_REQUIRED` with exempt routes (config, legal, support, account deletion); 503 `WAYVRO_E_MAINTENANCE`; guardrails against bricking (min ≤ latest released build via a released-build registry, dry-run preview, SECURITY expedited path auto-reverting without checker confirmation in 24 h); decision on missing-header behaviour; compatibility with a later OTA layer (ADR-031).
- **Evidence:** SEC-VERSION, SEC-SWITCH, migration tests, mobile state tests (OK/SOFT/HARD/MAINTENANCE).
- **Reversal:** no ACTIVE policy = no enforcement; switch rows retired.

### ADR-050 (new) — Phase 3 performance budgets
- **Context:** Q26, Q27, V11; CON-P3-05.
- **Proposed decision:** the budgets in `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md` (cold start p50 ≤ 2.5 s / p90 ≤ 4.0 s signed in; download ≤ 30.0 MB arm64-v8a, ≤ 29.0 MB armeabi-v7a; Hermes bundle ≤ 4.5 MB; memory and jank limits; server p95/p99; data per flow) on the Transsion-class reference device; no budget reported PASS until measured.
- **Evidence:** SP-02 baseline (Phase 2 app, before maps) and post-renderer measurements.
- **Reversal/changes:** only with founder approval and an ADR update.

### ADR-051 (new) — Service products vs vehicle classes, zone sets and activation lifecycle
- **Context:** F-P3-04: `catalog.service_categories` (CAR/BIKE/RICKSHAW) are vehicle classes referenced by compliance; R28 products are rider-facing.
- **Options:** rename/extend `service_categories` (rejected — compliance FKs, CLAUDE.md §4 no silent renames); new `catalog.service_products` referencing it (proposed).
- **Proposed decision:** expand-only migration 0010: `service_products`, `city_service_products` (MODELLED → CONFIGURED → ENABLED with legal-gate trigger), `vehicle_eligibility_rules`, versioned maker-checker `zone_sets` + `zones` (MultiPolygon 4326, ST_IsValid/SRID checks, GiST) + `service_hours` + `pickup_points`, nullable `catalog.districts.geom`; boundary semantics (`ST_Covers`, exclusion precedence) recorded here.
- **Evidence:** migration tests from clean DB and every previous prefix, restricted-role grant tests, SEC-ZONE, SEC-CATALOG.
- **Reversal:** forward-fix; new objects dropped only if no data was written.

### ADR-052 (new) — Mobile E2E tooling
- **Context:** CON-P3-13; vitest covers pure logic (31 files/246 tests at Phase 2); no component tests; ADR-027 named Maestro for Phase 3.
- **Options:** Maestro (YAML flows, black-box, emulator/device); Detox (grey-box, Jest-based — overlaps vitest); Appium (heavier).
- **Proposed decision:** Maestro CLI (cli-2.11.0 on 2026-09-29, Apache-2.0) as an external, checksum-verified dev/CI binary; Android emulator in CI via a pinned emulator-runner action (reactivecircus/android-emulator-runner v2.38.0 on 2026-07-05 — verify at adoption); a **new short-named CI job (e.g. "Mobile E2E")** in the existing workflow that builds its own x86_64 E2E variant (release-mode JS bundle, cleartext only to the emulator loopback) — this variant never replaces or contaminates the gated release AAB, proven by a release-purity gate; making the job a required check is a ruleset 24837051 change (founder action; keep the check name short because required-check contexts are truncated at 100 characters); the full matrix runs from a **new manual (`workflow_dispatch`) workflow** (FA-16 APPROVED 2026-10-12: mandatory at Phase-3 final closure; no nightly/scheduled run while the repository is private, a schedule only later after observing Actions-minute cost); PR tier ≤ 15 min; no jest/React Native Testing Library; property tests keep using the already-installed fast-check 4.10.2 pin.
- **Evidence:** measured PR-tier runtime; flakiness rate over 10 runs.
- **Reversal:** flows are declarative; the app gains only `testID`s.

## 3. Dependency candidates (none installed now)

Maturity column applies ADR-030 (`docs/adr/ADR-030-web-framework-and-version-maturity.md`): latest patch of a seasoned stable line, no prerelease, Expo-bundled modules take the SDK-pinned version.

| Package / tool | Purpose | Candidate version (2026-10-12) | Licence | Runtime / bundle cost | Maturity (ADR-030) | Alternatives | Decision status | Checkpoint |
|---|---|---|---|---|---|---|---|---|
| expo-location | rider foreground location; driver readiness state | ~57.0.20 (Expo SDK 57 pinned — verify at install) | MIT | native module; size measured in SP-02; config plugin foreground-only (adds COARSE + FINE only when background/FGS options stay off) | SDK-pinned | react-native-geolocation-service; Transistorsoft (background only) | PROPOSED; FA-02 APPROVED 2026-10-12 (foreground COARSE + FINE only) | P3.5 |
| expo-task-manager | SP-01 candidate A background task | Expo SDK 57 bundled version — verify at install | MIT | **spike build only**, not the release app | SDK-pinned | Transistorsoft | OPEN-SPIKE (spike only) | P3.6 |
| @maplibre/maplibre-react-native | renderer candidate (S3/S4) | 11.5.0 | MIT | native MapLibre (size unknown — measure) | v11 GA since 2026-04 with patches; not Expo-bundled | below | OPEN-SPIKE | P3.7 |
| react-native-maps | renderer candidate (S1; Google provider required on both platforms — its iOS default is Apple Maps) | 1.27.2 (Expo SDK 57 pinned) | MIT | Google Maps SDK + Play services; API key | SDK-pinned | expo-maps (Android only) | OPEN-SPIKE | P3.7 |
| expo-maps | renderer candidate for S1 on **Android only** — it renders Apple Maps on iOS (TECHNICAL), so it is not an S1 renderer there | ~57.0.4 (Expo SDK 57 bundled) | MIT | Google Maps SDK on Android | stability to verify (earlier SDKs marked it pre-stable) | react-native-maps (Google provider on both platforms) | OPEN-SPIKE | P3.7 |
| @rnmapbox/maps | renderer candidate (S2) | 10.3.7 | MIT wrapper; Mapbox SDK under Mapbox terms | Mapbox Maps SDK v11; token; MAU billing; telemetry opt-out required; Commercial Application License may apply to vehicle usage (FA-19, EXTERNAL — no S2 pilot/production freeze while unresolved) | stable line | MapLibre | OPEN-SPIKE | P3.7 |
| Maestro CLI | mobile E2E (ADR-052) | cli-2.11.0 | Apache-2.0 | dev/CI binary only; needs Java | stable release, checksum-pinned | Detox, Appium | PROPOSED | P3.5 |
| Android emulator runner action | CI emulator for Maestro | v2.38.0 (pin by commit SHA) | verify | CI minutes (FA-16 APPROVED: PR tier + manual full matrix) | stable | self-managed AVD script | PROPOSED | P3.5 |
| oasdiff | OpenAPI breaking-change gate (F-P3-09) | latest stable at P3.0 — verify | Apache-2.0 (verify) | CI binary, checksum-verified | per ADR-027 | openapi-diff | PROPOSED (ADR-027 direction) | P3.0 |
| OSRM | open-stack routing candidate | v26.10.0 (2026-10-01) — benchmark image | BSD-2-Clause | `geo-bench` compose profile only; never production in Phase 3 | release tag pinned by digest | Valhalla | OPEN-SPIKE | P3.2/P3.7 |
| Valhalla | open-stack routing candidate | 3.9.1 (2026-10-06) | MIT | as above | as above | OSRM | OPEN-SPIKE | P3.2/P3.7 |
| Photon | open-stack geocoder / autocomplete | 1.3.0 (2026-08-07) | Apache-2.0 | as above; self-hosted only | as above | Nominatim | OPEN-SPIKE | P3.2/P3.7 |
| Nominatim | open-stack geocoder / reverse | v5.3.2 | GPL-3.0 (unmodified, separate service) | as above; **public server not usable** (autocomplete and systematic reverse prohibited) | as above | Photon | OPEN-SPIKE | P3.2/P3.7 |
| OpenStreetMap Pakistan extract | data for open-stack benchmark | dated extract recorded in results | ODbL-1.0 (attribution; share-alike for derivative databases) | local disk | n/a | — | OPEN-SPIKE | P3.2 |
| OpenFreeMap / Protomaps tiles | open-stack tiles (S3) | n/a (service / PMTiles archive) | OpenFreeMap: OpenMapTiles + OSM attribution; Protomaps code BSD-3, data ODbL | OpenFreeMap public instance has **no SLA**; Protomaps self-hosted on S3-compatible storage | n/a | MapTiler free (non-commercial — rejected for production) | OPEN-SPIKE | P3.7 |
| Polyline encode/decode | route geometry | in-house (~40 lines + property tests with the already-installed fast-check 4.10.2 pin) | — | negligible | — | @mapbox/polyline (rejected) | PROPOSED | P3.2 |
| Circuit breaker | geo gateway | in-house in `packages/server-runtime` | — | negligible | — | opossum (rejected) | PROPOSED | P3.2 |
| placeRef sealing / cache-key HMAC | geo gateway | `node:crypto` (AES-256-GCM, HMAC-SHA-256) | — | none | ADR-038 conditions | — | PROPOSED | P3.2 |
| Urdu font asset | Urdu-script rendering if system fonts fail review | e.g. Noto Naskh/Nastaliq Urdu — verify | SIL OFL-1.1 (verify) | font size counts toward the download budget | n/a | system fonts | OPEN — only with FA-09 native review/device evidence | P3.9 |
| bundletool, Perfetto, adb | SP-02 measurement | versions recorded in evidence | Apache-2.0 | developer tools only | n/a | — | PROPOSED (already used for Phase 2 sizing: bundletool) | P3.6 |

## 4. Rejected or deferred

| Candidate | Status | Reason |
|---|---|---|
| Analytics, ads, attribution and crash-reporting SDKs | REJECTED for Phase 3 | U04/Q36 data minimisation; observability stays server-side (I07 Phase 4) |
| @react-native-community/netinfo | DEFERRED | Lite-mode suggestion uses request timing; reconsider only with SP-02 evidence that timing heuristics fail |
| react-native-reanimated / react-native-gesture-handler / worklets | DEFERRED | excluded by ADR-043; re-adding needs SP-02 size/perf headroom + ADR-043 amendment (F-P3-08) |
| jest / React Native Testing Library | REJECTED | overlaps vitest; Maestro covers UI flows (ADR-052) |
| opossum | REJECTED | small in-house breaker with Valkey hint fits the gateway; avoids a dependency |
| @mapbox/polyline | REJECTED | trivial algorithm implemented in-house with property tests |
| turf (client) | REJECTED | geometry decisions are server-side in PostGIS; client never decides zones |
| expo-updates | DEFERRED (ADR-031) | OTA is a Phase 7 decision |
| Transistorsoft react-native-background-geolocation | CONDITIONAL (FD-08) | only if SP-01 candidate A fails and the founder approves USD 399 (Starter) |
| Google Navigation SDK / Mapbox Navigation SDK | REJECTED for pilot | ADR-006 backlog: external-app navigation handoff at pilot (M23/S22) |
| On-device Places/Search SDKs (Google Places SDK, Mapbox Search SDK) | REJECTED | keys would live on device; server-only geo |
| expo-notifications, expo-background-fetch | REJECTED for Phase 3 | no notifications or background work in Phase 3; architecture test keeps them banned |
| Public Nominatim / OSM public tile servers | REJECTED | usage policies prohibit this use |
| MapTiler / Stadia free tiers | REJECTED for production | non-commercial free plans |
| i18n libraries (i18next etc.) | REJECTED | existing typed catalogue covers en/ur/ur-Latn |
| k6 / autocannon (load testing) | REJECTED for Phase 3 | `docs/phase3/PHASE3_TEST_STRATEGY.md` measures server latency budgets with a built-in `fetch` script; ADR-027's k6 proposal stays for a later phase |

## 5. Dependency discipline (binding for the Phase 3 run)

1. **Installation rule:** before adding any package, re-check current stable release, advisories (osv-scanner), licence, compatibility (Node 24, NestJS, Fastify 5, Expo SDK 57 / RN 0.86 / New Architecture, React 19.2.3), publish age and ADR-030 maturity; pnpm `minimumReleaseAge` stays on with no exclusions.
2. **Lockfile:** exact versions; the `pnpm install` lockfile diff is reviewed and limited to the intended package and its transitive closure; Expo-bundled modules installed with the SDK-pinned version.
3. **Security scanning:** osv-scanner must pass; any new exception in `osv-scanner.toml` needs an owner, expiry and a reachability reason that is true (F-P3-01 showed a false premise is a defect).
4. **Licence review:** licence recorded per dependency; GPL/AGPL software only as unmodified separate services or developer tools; OSM/ODbL attribution and share-alike checked for any stored derivative data; SBOM (CycloneDX) generation remains a later gate (U03).
5. **Native impact:** every native addition is measured (download size per ABI, cold start, memory) and checked by the permission and intent-filter gates; any single change adding > 1.5 MB needs written justification (ADR-050).
6. **No framework upgrades:** no Expo SDK, React Native, React, TypeScript, Node, NestJS or Next.js line change in Phase 3 (ADR-030); patch updates only as bounded, reviewed changes when a security/correctness fix requires it.
7. **Binaries in CI:** external binaries (Maestro, oasdiff) are downloaded with pinned versions and SHA-256 verification, matching the existing gitleaks/osv-scanner pattern in `.github/workflows/ci.yml`.
8. **Production isolation:** benchmark images, harnesses and synthetic doubles never enter deployable artefacts (ADR-045 ART-ISO).
