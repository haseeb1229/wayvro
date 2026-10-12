# PHASE3_IMPLEMENTATION_SEQUENCE — Internal checkpoints for one full Phase-3 run (PROPOSED)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — pending founder/ChatGPT review; no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

## 1. Shape of the run

The founder wants **one** implementation authorisation for the whole macro Phase 3. The checkpoints below are an internal engineering order, **not** new macro phases and **not** founder approval points. They exist so that:

- each checkpoint ends with a green local gate set and a pushed commit on the implementation branch (CI runs on `phase-*/**` pushes), so a context reset can resume at the right place;
- freeze decisions that need **real-world evidence** (SP-01, SP-02, SP-04) sit at fixed points and cannot be taken early;
- the founder's external work (devices, field drives, provider accounts, reviewers) can run **in parallel** with engineering from the first day.

Proposed implementation branch: `phase-3/maps-quotes-unified-ux` (matches the CI push trigger `phase-*/**`). One final PR to `main` after the closure report and founder/ChatGPT review — never an automatic merge.

### 1.1 Stop rules inside the single run

| Situation | Rule |
|---|---|
| A checkpoint's own gates fail | Fix inside the checkpoint; never weaken a test, skip a gate or add an exception to make CI green (CLAUDE.md §7/§8). |
| External evidence needed for a **freeze** is missing (SP-01 devices, SP-02 device, SP-04 field data, provider accounts) | Mark the freeze step **BLOCKED-EXTERNAL**, record exactly what is missing, and continue with checkpoints that do not depend on it. Never freeze on desk data, emulator data or guesses. |
| A founder approval needed to change the **shipped binary** is missing (FA-02 location permissions) | Build everything that does not need the permission (manual search/pin works without location); keep the permission out of the manifest; mark the sub-step BLOCKED-EXTERNAL. |
| An SP result is FAIL | Execute the documented fallback path (SP-01: Transistorsoft only with FA-08 approval → ADR-003 Flutter evaluation; SP-02: module restructuring / renderer change; SP-04: next-best provider per SKU). Record FAIL honestly; never re-run until green without a cause. |
| Main CI goes red for an external/transient reason | Re-run once through GitHub; if it fails again, stop and diagnose (same rule as the Phase-3 kickoff). |
| Scope pressure toward Phase 4 (dispatch, offers, presence, ride requests) | Refuse. Phase 3 ends at a priced, expiring quote and a mode-aware shell. |

### 1.2 Evidence each checkpoint leaves

Every checkpoint commit records in `docs/phase3/` (a Phase-3 implementation record file created at P3.0) the commands run with exact outcomes (PASS / FAIL / NOT RUN / BLOCKED / SKIPPED), migrations added, permission/size deltas, CI run id for the pushed SHA, and requirement IDs touched.

## 2. Checkpoints

### P3.0 — Main hygiene and guardrails (no product feature)

| Item | Detail |
|---|---|
| F-P3-01 | Remove the dev-client generated URL scheme (`exp+wayvro`) from **release** builds (evaluate `expo-dev-client` `addGeneratedScheme: false` vs excluding the dev client from the release variant; choose by evidence in the release manifest). Extend the Android release gate from a permission allowlist to an **exported-components and intent-filter allowlist** (fails on any VIEW/BROWSABLE filter or scheme not approved). Correct ADR-043 ("no URL scheme" wording is now true again) and the `osv-scanner.toml` decode-uri-component reason text in the same change. |
| osv expiry | The decode-uri-component runtime exception expires 2026-12-31; if the run can pass that date, either remove the reachability (upgrade path for expo-router/query-string within the Expo SDK 57 line, if one exists) or renew it with a fresh, truthful justification after F-P3-01 — never a silent date bump. The intent router caps URL length before any parsing. |
| F-P3-09 | Enable the `oasdiff` breaking-change gate in the Quality job against the merged Phase-2 OpenAPI baseline (ADR-027 deferral closed). |
| F-P3-02 | Already fixed before planning by the workflow-only PR #6 (exact-key Gradle dependency cache, explicit main-only save, disk evidence; `docs/phase3/PHASE3_PLAN.md` §6). P3.0 only confirms the Android job stays green with that evidence; any recurrence is diagnosed, never worked around. |
| Record | Create the Phase-3 implementation record; add new error codes skeleton only when first used (no dead exports — Knip). |
| Gates | Full local gate set + CI on the branch; release AAB manifest shows no external scheme. |
| IDs | V08 (prerequisite), U05 (manifest hygiene), V10 (gate) |

### P3.1 — Catalog: service products, zones, eligibility rules

| Item | Detail |
|---|---|
| Migration | `0010_catalog_products_zones` (expand-only): `catalog.service_products`, `catalog.city_service_products`, `catalog.vehicle_eligibility_rules`, `catalog.zone_sets`, `catalog.zones` (hand-written PostGIS SQL, GiST), `catalog.service_hours`, `catalog.pickup_points`, `catalog.districts.geom` (nullable). Guard triggers for lifecycle and immutability; grants. Detail: `docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md`. |
| Domain | Pure, server-only evaluators in `apps/api` (authoritative server code, not the client-importable `packages/domain`): zone policy (service area / exclusion / pickup-restricted / airport precinct), service hours (Asia/Karachi, server time), vehicle eligibility rules. |
| API | Staff maker-checker routes (draft → submit → approve → activate → retire) for zone sets, eligibility rules, product city status; consumer read routes for service products and service-area summary. Staff permissions + role mapping (FA-10); `0010_catalog_products_zones` widens the DB CHECK on `staff.role_assignments.role` (migration 0003) in a conditional section only if FA-10 approves PRICING_MANAGER / CATALOG_MANAGER / RELEASE_MANAGER. |
| web-ops | Catalog pages (zone-set upload as GeoJSON with validation preview, product status, eligibility rules) behind permissions. |
| Seed | Local/test-only synthetic Lahore seed script (`is_synthetic = true`); production refuses synthetic activation. |
| Tests | Migration clean + every-previous-prefix + live-row upgrade; restricted-role grants; geometry validity/SRID; zone boundary/hole/multipolygon/exclusion precedence; lifecycle triggers (BIKE/RICKSHAW cannot become ENABLED without legal basis); API authz/maker≠checker; audit rows. |
| IDs | E08, H10, R28 (+ B04 seats/luggage metadata) |

### P3.2 — Geo provider ports, gateway and SP-04 harness

| Item | Detail |
|---|---|
| Ports | `placesAutocomplete`, `geocoding`, `reverseGeocoding`, `routing` in `@wayvro/provider-interfaces` (vendor-neutral; `GeoSourceMeta`). Map-style descriptor in config. |
| Doubles | Deterministic synthetic geo doubles in `@wayvro/provider-test-doubles` (MOCK-branded; refused outside local/test; ART-ISO extended). |
| Gateway | Normalise → session authz → rate limits → Valkey cache → budget → circuit breaker → adapter with timeout and deadline-aware retry (ADR-047) → normalise → usage meter. `placeRef` sealing. Route-template-only logging for geo routes (test). |
| Migration | `0011_geo_controls`: `geo.provider_budgets` (maker-checker), `geo.provider_usage` (worker rollup), `geo.landmark_aliases`. |
| API | `GET` autocomplete / place resolve / reverse geocode (session-only, rate-limited). Unbound production adapters ⇒ 503 `WAYVRO_E_DEPENDENCY_UNAVAILABLE`. |
| Harness | SP-04 benchmark CLI (dev-only tool, never in a release artefact) that runs each candidate adapter per SKU against the case list and the founder's capture CSV; raw provider responses stay local (licence terms), only aggregated metrics are committed. Candidate adapters for the benchmark live in the server-only `packages/geo-adapters` package and are bound only when the founder supplies keys locally (FA-06). |
| External start | Founder field drives (FA-05) and provider evaluation accounts (FA-06) can start as soon as this checkpoint lands. |
| Tests | Port contract suite (run against doubles in CI; against real candidates only locally with founder keys — reported NOT RUN in CI); fault injection (timeouts, 5xx, malformed, slow, quota); breaker transitions; budget thresholds 50/80/100; cache keys/TTL/STALE_SERVED; rate limits; log-redaction tests. |
| IDs | E06, E07, I11, B02 (server side), A06 (search normalisation hooks) |

### P3.3 — Pricing, rate cards and quotes

| Item | Detail |
|---|---|
| Migration | `0012_pricing`: `pricing.tax_policies`, `pricing.rate_cards`, `pricing.rate_card_components`, `pricing.route_snapshots`, `pricing.quotes`, `pricing.quote_components` (Σ components = total enforced + tested; immutability guards). |
| Domain | Server-only quote engine in `apps/api/src/pricing/` on `Money` from `packages/domain` (bigint minor units, single rounding point); overall quote deadline with a single routing attempt (ADR-047); deterministic components; expiry on server time; SM-2 Phase-3 subset (PRICED → EXPIRED / SUPERSEDED). |
| API | `POST /v1/quotes` (idempotent), `GET /v1/quotes/{quoteGroupId}` (owner only); staff rate-card / tax-policy maker-checker + rollback-by-new-version + preview against stored benchmark route snapshots. |
| web-ops | Pricing pages (draft, diff vs active, preview, approve, activate, rollback). |
| Jobs | Quote/route-snapshot purge (30-day placeholder, EG-16); scheduled activation for `effective_from` in the future. |
| Tests | Property tests (Σ, non-negative, determinism, rounding step, minimum fare, monotonic in distance/time for fixed card); tamper tests (client fare ignored, idempotency conflict 409, other account's quote 404, expired); zone/hours refusals; routing outage ⇒ refuse (never invented); maker≠checker; synthetic refusal in production config. |
| IDs | B04, B06, E05, H06, B03 (route summary/confidence on quote) |

### P3.4 — Release controls: version policy, maintenance, runtime switches

| Item | Detail |
|---|---|
| Migration | `0013_platform_release_controls`: `platform.app_version_policies`, `platform.runtime_switches` (code-registry keys, mode/city scope; disable = single authorised staff with step-up, enable = maker-checker). |
| API | Public `GET /v1/app/config` (version status, maintenance, client-presentation switches, map-style descriptor, server time); header enforcement (`X-Wayvro-App-Version`, `X-Wayvro-App-Build`, `X-Wayvro-Platform`) → 426 `WAYVRO_E_APP_UPDATE_REQUIRED` on non-exempt routes; maintenance → 503 `WAYVRO_E_MAINTENANCE`. Guardrails: min build cannot exceed latest released build; dry-run preview of affected sessions by version. |
| web-ops | Release-control pages (policy draft/approve, switch disable/enable, maintenance window). |
| Mobile | AppRoot config fetch, headers on every request, SOFT/HARD/MAINTENANCE screens, offline policy (never brick offline without cached policy). |
| Tests | Contract + integration (exempt routes still work under hard update: legal, deletion, health, app config); switch semantics; audit; mobile pure-logic tests for policy evaluation. |
| IDs | A01, Q31, V10 (kill switches) |

### P3.5 — Mobile shell, mode navigation and text-first rider flow

| Item | Detail |
|---|---|
| Shell | `src/core/mode` ModeController (persisted preference = hint only; additive `AccountState.modes` from server), rider routes under the URL segment `/ride/*` (eager) and driver routes under `/drive/*` (lazy), `/home` kept as the shared account hub, existing `earn/*` kept, new `src/platform/` (maps, location) PROPOSED, restoration precedence, intent router (no external scheme), back-stack rules. |
| Rider | Home, where-to search (autocomplete via API), pin selection **text-first** (no renderer yet), route summary + quote options + fare breakdown, expiry/requote, outage/stale/outside-area/outside-hours states, Lite mode. "Request ride" not present (Phase 4). |
| Location | Rider foreground location through `src/platform/location` **only if FA-02 approved**: manifest/allowlist delta (COARSE + FINE when-in-use), expo-location with background/FGS disabled, architecture-test changes. Without FA-02 the flow is search + manual pin only and the sub-step is BLOCKED-EXTERNAL. |
| E2E | Maestro scaffolding + SP-08 PR tier (accounts A, C, D, E core flows; Maestro phase ≤ 15 min) on the emulator in CI. |
| Tests | Pure-logic vitest for ModeController, intent router, restoration, view-state adapters; Maestro flows; release AAB gates (permissions, intent filters, 16 KB, size). |
| IDs | V08, V05, A07, U05, L08, B02 (client), B03/B04/B06 (display), V10 |

### P3.6 — SP-02 baseline and SP-01 spike (device evidence)

| Item | Detail |
|---|---|
| SP-02 R1 | Measure the P3.5 release AAB (no map renderer) on the reference low-end device per `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md`. Needs FA-04; signed-in measurements also need FA-17 (HTTPS synthetic endpoint), otherwise NOT RUN. |
| SP-01 | Build the spike under `tests/spikes/` (not the release app) and run the device matrix per `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md`; rider-hygiene checks on the real release AAB (runtime part needs FA-17, otherwise NOT RUN). Needs FA-03; the optional push-wake case needs FA-18. |
| Freeze | ADR-029 (background-location SDK) and ADR-003 (mobile stack) move from OPEN-SPIKE to ACCEPTED-ON-EVIDENCE **only** with passing device evidence on the required OEM classes; otherwise BLOCKED-EXTERNAL or the documented fallback. |
| IDs | V05, V11, Q26, Q27, A07 |

### P3.7 — SP-04 analysis, provider-per-SKU and renderer freeze, map integration

| Item | Detail |
|---|---|
| SP-04 | Analyse ≥50 founder field cases with the harness; compare candidates per SKU against the founder-approved thresholds (FA-07). |
| Freeze | Write the ADR-006 file (provider per SKU, ACCEPTED-ON-EVIDENCE) and ADR-046 (map renderer) together — only with evidence; any paid tier only with FA-08. Renderer and geo SKUs are chosen as one **licence-coherent bundle** (CON-P3-16: Google geo content may not be used with a non-Google map; Mapbox geocoding only with a Mapbox map), so the two ADRs cannot be frozen independently. |
| Adapters | Production adapter(s) for the chosen SKUs in `packages/geo-adapters`, contract suite, budgets configured, provider-console quotas confirmed by the founder. |
| Mobile | Map renderer behind `src/platform/maps` (one adapter file imports the vendor SDK), map pin + route polyline, accessibility text alternative, tile cache cap; SP-02 R2 re-measure with the map. |
| Inventory | U04 SDK/privacy inventory updated with the actual chosen SDK(s). |
| IDs | B01, B02, B03, E06, E07, I11, U04, V11, Q26 |

### P3.8 — Driver/Partner mode shell

| Item | Detail |
|---|---|
| Driver home | Readiness checklist from server state (application/compliance, documents, vehicle, eligible products from eligibility rules), restriction/health/appeal routing, location-readiness rationale (informational; no background permission). |
| K19 | Complete localized onboarding state coverage (pending, failed, review, approved, rejected, expired, suspended), camera guidance, offline resume, accessibility on existing `earn/*` screens. |
| Rider fallback | Driver restriction never blocks Rider mode (V13 precedent); account-wide restriction blocks both. |
| IDs | V08, K19, V05, H10 (display) |

### P3.9 — Localization and accessibility hardening

| Item | Detail |
|---|---|
| Strings | All new rider/driver/release-control strings in en / ur / ur-Latn (typed catalogues), pending native review flag; no machine-translation-only safety/legal text. |
| Search | Roman-Urdu normalisation + founder-curated landmark aliases (`geo.landmark_aliases`). |
| A11y | TalkBack labels/focus order, dynamic type to 200 %, 48 dp targets, contrast AA, reduced motion, live regions for price/expiry changes, map text alternatives, RTL layouts for quote/fare screens. |
| External | Native-review package exported for FA-09; device a11y pass on at least one physical Android (FA-14 optional). |
| IDs | A06, A08, P18, K19 |

### P3.10 — Cross-mode regression, budgets and closure

| Item | Detail |
|---|---|
| SP-08 | Scheduled full matrix (accounts A–G, two API levels) at the cadence approved in FA-16 (private repository: Actions minutes are finite) + PR tier; runtime budgets and minutes measured. |
| Budgets | Performance budget table filled with measured values (device-only metrics need SP-02 evidence). |
| Inventory | U04 final; permission/intent-filter reports; size report. |
| Closure | Requirement reconciliation for all 29 IDs (ENGINEERING_SATISFIED / PARTIAL_EXTERNAL_GATED / BLOCKED), CI evidence on the final SHA, handoff report per CLAUDE.md §17, PR opened for review (not merged). |
| IDs | V10, V11, Q26, Q27, U04, all |

## 3. Dependency graph (engineering order)

```text
P3.0 ─► P3.1 ─► P3.2 ─► P3.3 ─► P3.4 ─► P3.5 ─► P3.8 ─► P3.9 ─► P3.10
                  │                        │
                  └─(harness)─► [FA-05/06 field + accounts] ─► P3.7 ◄─┘
                                           P3.5 ─► P3.6 (SP-02 R1 + SP-01) [FA-03/04]
                                           P3.7 ─► SP-02 R2
```

P3.6 and P3.7 depend on external evidence. If that evidence arrives late, P3.8–P3.9 proceed and P3.7 runs when the data exists; P3.10 closure lists anything still BLOCKED-EXTERNAL.

## 4. Exit-gate mapping (docs/12 Phase 3 gate)

| Gate clause | Checkpoint | Evidence |
|---|---|---|
| Route/ETA confidence | P3.2, P3.3, P3.7 | `GeoSourceMeta` on every quote; SP-04 per-SKU accuracy table |
| Price snapshot | P3.3 | Immutable quote + components + route snapshot; property tests |
| Provider bill controls | P3.2, P3.7 | Budgets, breaker, usage rollup, provider-console quotas (FA-06) |
| Mode-switch/navigation correctness | P3.5, P3.8, P3.10 | Maestro SP-08 matrix, intent-router tests |
| Representative device tests | P3.6, P3.7, P3.10 | SP-01 and SP-02 device evidence |
| SP-01/02/04 recorded before freezes | P3.6, P3.7 | ADR-029, ADR-003, ADR-006, ADR-046 files written only on evidence |
