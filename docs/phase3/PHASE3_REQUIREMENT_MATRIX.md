# PHASE3_REQUIREMENT_MATRIX — Traceability for all 29 Phase 3 requirements (PROPOSED)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — founder/ChatGPT plan review recorded 2026-10-12 (FA decisions in `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` §1a); no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

Source of scope: `docs/requirements-register.json` (schema 5.1, 532 IDs), filtered on `phase0.target_phase = 3`. Titles below are the register titles (long titles abbreviated with "…" only where marked). Acceptance test detail per ID: `docs/phase3/PHASE3_TEST_STRATEGY.md` §9. Checkpoints P3.0–P3.10: `docs/phase3/PHASE3_IMPLEMENTATION_SEQUENCE.md`. Founder/external actions FA-xx: `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` (2026-10-12 decisions: FA-01/02/07/10/11/16 APPROVED, FA-12 DECIDED synthetic, FA-17 APPROVED IN PRINCIPLE, FA-18 DEFERRED to Phase 4; open: FA-03/04/05/06/08/09/19). External gates EG-xx carried from Phase 2: `docs/phase2/PHASE2_EXTERNAL_GATES.md`. Nothing in this file is implemented; every evidence item is a plan.

## 0. Scope verification (executed 2026-10-12 against `main` @ `6aed6a4`)

- `phase0.target_phase = 3` count: **29** — P0 **17**, P1 **11**, P2 **1**. Verified by script over the register on 2026-10-12; matches the kickoff scope exactly (0 missing, 0 extra).
- P0 (17): A01 A06 A07 B01 B02 B03 B04 B06 E05 E06 E07 E08 H06 I11 U04 U05 V05.
- P1 (11): A08 H10 K19 L08 P18 Q26 Q27 Q31 V08 V10 V11.
- P2 (1): R28.
- No register change is proposed by this plan (no new ID; register stays at 532). Clarifications below are interpretation only, recorded as CON-P3-xx / F-P3-xx in `docs/phase3/PHASE3_PLAN.md`.

## 1. Class definitions and closure vocabulary

| Class | Meaning in this plan |
|---|---|
| IMPL | Implementable in the Phase 3 run with repository-only evidence (unit/property/integration/contract/emulator tests in CI). |
| IMPL+FREEZE | Implementable, but a freeze or exit step needs spike evidence (SP-01 devices, SP-02 reference device, SP-04 field data) before the related ADR can move to ACCEPTED-ON-EVIDENCE. |
| IMPL+EXT | Implementable; activation or exit needs an external party (native Urdu reviewer, provider console/licence, physical devices, accessibility tester, legal). |

Closure statuses used at P3.10 (per ID): **ENGINEERING_SATISFIED** (every repository-provable item in the "Engineering evidence" column exists and passed in CI on the closure SHA) · **PARTIAL_EXTERNAL_GATED** (engineering evidence complete; the listed external item is still open) · **BLOCKED** (engineering evidence itself is incomplete because an external input is missing, e.g. no acceptable FA-17 tunnel session so a signed-in release-build check could not run). A class of IMPL+FREEZE or IMPL+EXT does **not** pre-decide the closure status; the evidence decides.

## 2. Summary

### 2.1 Counts by class and priority

| Class | P0 | P1 | P2 | Total | IDs |
|---|---|---|---|---|---|
| IMPL | 7 | 4 | 1 | 12 | A01 B04 B06 E05 E07 E08 H06 · H10 Q31 V08 V10 · R28 |
| IMPL+FREEZE | 8 | 3 | 0 | 11 | A07 B01 B02 B03 E06 U04 U05 V05 · L08 Q26 V11 |
| IMPL+EXT | 2 | 4 | 0 | 6 | A06 I11 · A08 K19 P18 Q27 |
| **Total** | **17** | **11** | **1** | **29** | |

### 2.2 Classification, sequencing and dependencies

| ID | P | Requirement (short) | Class | Checkpoint(s) | Surfaces (register) | External dependency / blocker |
|---|---|---|---|---|---|---|
| A01 | P0 | splash, version compatibility, hard/soft update, maintenance | IMPL | P3.4, P3.9, P3.10 | mob-shared, api | store listing URL (EG-18) for the update link only |
| A06 | P0 | Urdu/English + Roman-Urdu-aware search; fallback text; RTL | IMPL+EXT | P3.2, P3.5, P3.7, P3.9 | mob-shared, web-public | FA-09 native review; SP-04 Roman-Urdu autocomplete metric (FA-05) |
| A07 | P0 | foreground/background location rationale, revoke/regrant, approximate | IMPL+FREEZE | P3.5, P3.6, P3.8 | mob-shared, mob-driver | FA-02 APPROVED (rider permission); SP-01 / FA-03 (background parameters, ADR-029) |
| A08 | P1 | VoiceOver/TalkBack, dynamic text, contrast, tap targets | IMPL+EXT | P3.5, P3.8, P3.9, P3.10 | mob-shared | physical TalkBack pass (FA-04/FA-14); VoiceOver needs iPhone (FA-13, not Phase-3 blocking) |
| B01 | P0 | map, geolocation, manual pin, GPS accuracy, landmark address | IMPL+FREEZE | P3.2, P3.5, P3.7 | mob-rider, api | SP-04 + SP-02 renderer freeze (ADR-046); provider licence (register: "Maps provider licence"; FA-19 for an S2/Mapbox bundle); FA-02 APPROVED |
| B02 | P0 | autocomplete, reverse geocoding, fallback pin | IMPL+FREEZE | P3.2, P3.5, P3.7 | mob-rider, api | SP-04 (register: "Lahore geocode field accuracy"); FA-05, FA-06 |
| B03 | P0 | route visualisation, distance/ETA with confidence/coverage | IMPL+FREEZE | P3.2, P3.3, P3.5, P3.7 | mob-rider, api | SP-04 route/ETA accuracy; renderer (ADR-046) for the visual polyline |
| B04 | P0 | eligible car fare estimate; category/seat/luggage info | IMPL | P3.1, P3.3, P3.5 | mob-rider, api | real rates (FA-15, Phase 8) — synthetic config only in Phase 3 |
| B06 | P0 | fare components, final quote and expiry | IMPL | P3.3, P3.5 | mob-rider, api | tax/toll/rounding values (FA-15, CON-P3-10) — structure only in Phase 3 |
| E05 | P0 | pricing versioning, exact quote snapshot, tax/fee split, rounding | IMPL | P3.3 | api | accountant review of rounding/tax (FA-15) before pilot |
| E06 | P0 | route provider abstraction: ETA, distance, geocode, tiles, directions | IMPL+FREEZE | P3.2, P3.7 | api, worker | SP-04 per-SKU freeze (ADR-006); provider licence; FA-06 |
| E07 | P0 | cache and cost protection; degradation without invented ETAs | IMPL | P3.2, P3.3, P3.7 | api, worker | per-provider cache TTLs re-verified against terms at P3.7 (adapter TTL = 0 until verified) |
| E08 | P0 | zones, exclusions, airport pickup points, service hours | IMPL | P3.1, P3.3 | api, web-ops | real Lahore boundaries + district source (FA-12) before pilot only |
| H06 | P0 | config versioning, rate cards, fee policies, approval, rollback | IMPL | P3.1, P3.3, P3.4 | web-ops, api | second staff member for real maker-checker (EG-20 precedent); FA-10 roles APPROVED |
| H10 | P1 | zone/city management, categories, vehicle documents matrix | IMPL | P3.1, P3.8 | web-ops, api | approved Punjab matrix (EG-03) for real eligibility values |
| I11 | P0 | cost alerts, quotas, circuit breakers, usage budgets | IMPL+EXT | P3.2, P3.7 | api, worker, infra | provider-console hard caps (FA-06); verified price table at P3.7; alert channel (EG-21) |
| K19 | P1 | localized onboarding UX states, camera guidance, offline resume, a11y | IMPL+EXT | P3.8, P3.9 | mob-driver | FA-09 native review |
| L08 | P1 | Lite experience for weak networks and older Android … | IMPL+FREEZE | P3.5, P3.6, P3.7, P3.9 | mob-shared, api | SP-02 device data/perf measurement (FA-04) |
| P18 | P1 | localized content: English, Urdu, Roman Urdu, reviewed terminology … | IMPL+EXT | P3.9 | mob-shared, web-public, api | FA-09 (register: "Reviewed terminology"); counsel texts (EG-02) for legal copy |
| Q26 | P1 | performance budgets incl. start, map, data, battery, p95/p99, reconnect … | IMPL+FREEZE | P3.6, P3.7, P3.10 | mob-shared, api, infra | FA-07 budgets APPROVED (pre-measurement); SP-02 (FA-04); SP-01 for battery/reconnect (FA-03) |
| Q27 | P1 | representative low-end Android devices as first-class QA targets | IMPL+EXT | P3.6, P3.7, P3.10 | mob-shared | devices (register: "Representative test devices procured"; FA-03, FA-04) |
| Q31 | P1 | supported OS/app-version matrix and deprecation policy | IMPL | P3.4 | mob-shared, api | founder decision on minimum Android (F-P3-10) inside FA-01 |
| R28 | P2 | catalogue models Economy, Comfort, Bike, Rickshaw … as separate configs | IMPL | P3.1 | api, web-ops | product lifecycle APPROVED (FA-11); legal activation of BIKE/RICKSHAW outside Phase 3 |
| U04 | P0 | third-party SDK inventory: data, purpose, permissions, endpoints, disclosures | IMPL+FREEZE | P3.0, P3.5, P3.7, P3.10 | mob-shared, company | renderer/provider choice (P3.7); store declarations (EG-18) |
| U05 | P0 | permission-minimisation review, just-in-time, core-purpose justified | IMPL+FREEZE | P3.0, P3.5, P3.6, P3.8 | mob-shared | FA-02 APPROVED; SP-01 for background-location justification |
| V05 | P0 | just-in-time by mode/task; rider never gets driver prompts; recovery | IMPL+FREEZE | P3.5, P3.6, P3.8, P3.10 | mob-shared, mob-driver | SP-01 (register dependency); FA-02 APPROVED; FA-03 |
| V08 | P1 | mode-aware navigation, homes, deep-link/notification routing, restoration, back stack | IMPL | P3.0, P3.5, P3.8, P3.10 | mob-shared | external URL scheme waits EG-15 + decode-uri-component gate (CON-P3-07) |
| V10 | P1 | cross-mode regression matrix; mode-scoped flags/kill switches | IMPL | P3.0, P3.4, P3.5, P3.10 | infra, mob-shared | FA-16 APPROVED (PR tier + manual full matrix); enforcement from Phase 4 (register note) |
| V11 | P1 | startup/memory/battery/size budgets; lazy driver modules; profiled on devices | IMPL+FREEZE | P3.5, P3.6, P3.7, P3.10 | mob-shared | SP-02 (register dependency); FA-04; FA-07 APPROVED |

### 2.3 Dependency note — IDs that depend on SP-01 / SP-02 / SP-04

| Spike | Founder actions | IDs whose **exit** depends on it | What the spike decides for those IDs | If the spike evidence is missing at P3.10 |
|---|---|---|---|---|
| SP-01 (real-device background location, OEM behaviour, offer path) | FA-03, FA-08 (only if fallback is paid; no spend pre-approved), FA-17 (APPROVED IN PRINCIPLE; TC-01 release-build runtime check BLOCKED if no acceptable tunnel session), FA-18 (DEFERRED to Phase 4; TC-22 push-wake NOT RUN) | A07, V05, U05; partly Q26 (battery/reconnect clauses), Q27 (OEM classes), V10 (background-location regression lane, used from Phase 4) | ADR-029 (SDK) and ADR-003 (stack freeze); background rationale timing and revocation recovery parameters; justification text for BACKGROUND/FGS permissions requested in Phase 4 | A07/V05/U05 stay PARTIAL_EXTERNAL_GATED (foreground rider path and driver permission state machine can still be ENGINEERING-complete); ADR-029/ADR-003 stay OPEN-SPIKE; no background permission ships |
| SP-02 (low-end reference device, release AAB) | FA-04, FA-07 (APPROVED), FA-17 (APPROVED IN PRINCIPLE; signed-in measurements BLOCKED if no acceptable tunnel session) | V11, Q26, Q27, L08; B01 and U04 through the renderer freeze (ADR-046) | whether budgets (`docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md`) PASS on R1 (no map) and R2 (with map); renderer size/perf acceptability | budgets reported NOT RUN (never PASS from emulator); renderer freeze BLOCKED-EXTERNAL; map integration not merged into the shipped app |
| SP-04 (Lahore field benchmark, ≥50 cases) | FA-05, FA-06, FA-07 (APPROVED, incl. the route-critical hard gate), FA-08, FA-19 (S2 freeze only) | B01, B02, B03, E06; partly A06 (Roman-Urdu autocomplete), E07 (terms-based TTLs), I11 (cost per 1,000 quotes), U04 (provider data flows); B04 indirectly (fare depends on route distance accuracy) | ADR-006 provider per SKU (ACCEPTED-ON-EVIDENCE) and, with SP-02, ADR-046; licence-coherent renderer + geo bundle (CON-P3-16) | production adapters not bound; staging/production quote refused 503 ROUTING_UNAVAILABLE by design; IDs stay PARTIAL_EXTERNAL_GATED with the synthetic-double evidence only |
| SP-08 (cross-mode Maestro harness) | FA-16 (APPROVED) | V08, V10, V05, A01, A07, K19, L08 (E2E families) | not external: Phase 3 builds and runs it; physical-device release subset needs FA-03/FA-04 | the emulator tiers are engineering evidence; the physical-device subset is NOT RUN until devices exist |

Full-run evidence rule (`docs/phase3/PHASE3_IMPLEMENTATION_SEQUENCE.md` §1.1): if SP-01, SP-02 or SP-04 real-world evidence or the FA-09 native Urdu/Roman-Urdu review is missing at P3.10, the affected IDs/freezes are reported BLOCKED-EXTERNAL / PARTIAL, all safe engineering work is still completed, and Phase 3 is not declared or merged as complete until that closure evidence is supplied.

The Phase 2 Android emulator smoke and any Phase 3 emulator run do **not** satisfy SP-01 or SP-02 (`docs/12_PHASE_PLAN_AND_GATES.md`, Phase 3 open prerequisites).

## 3. docs/12 Phase 3 gate clauses → IDs and evidence

Gate text (`docs/12_PHASE_PLAN_AND_GATES.md`): "route/ETA confidence, price snapshot, provider bill controls, unified-app mode-switch/navigation correctness and representative device tests; SP-01, SP-02 and SP-04 results recorded on real devices/field drives before the mobile architecture and map provider are frozen". The phase scope line also names "Lahore geocoding accuracy, vehicle classes/zone policy, server-authoritative quote".

| Gate clause | IDs | Repository evidence (CI) | Real-world evidence (external) |
|---|---|---|---|
| Route/ETA confidence | B03, E06, E07, B02, B01 | `GeoSourceMeta` contract tests (confidence HIGH/MEDIUM/LOW/UNKNOWN, cacheStatus, fetchedAt server time) on every route and on `POST /v1/quotes` responses; FAULT-GEO suite proves routing failure ⇒ 503 ROUTING_UNAVAILABLE and never a straight-line/invented ETA outside the MOCK double; mobile confidence label + "estimate" copy tests | SP-04 per-SKU accuracy table (route distance error, off-peak ETA error, geocode top-1/top-3) recorded in the ADR-006 file at P3.7 |
| Lahore geocoding accuracy | B02, A06, B01 | Roman-Urdu normaliser and landmark-alias unit tests; landmark-first formatter tests | SP-04 geocode/reverse/autocomplete metrics vs the FA-07-approved thresholds |
| Vehicle classes / zone policy | R28, H10, E08 | catalog migration, lifecycle trigger, zone-boundary and service-hours tests (TEST_STRATEGY §4.3) | real boundaries only before pilot (FA-12 DECIDED: synthetic in Phase 3) |
| Price snapshot / server-authoritative quote | E05, B06, B04, H06 | PROP-MONEY/PROP-QUOTE (Σ components = total, determinism, rounding step); quote immutability trigger; GET restore returns byte-identical components after a newer rate card activates; QUOTE-TAMPER suite | — (real rates are Phase 8, FA-15) |
| Provider bill controls | I11, E07 | budget thresholds 50/80/100 % signals and refusal, atomic counter concurrency, breaker transitions, `geo.provider_usage` rollup idempotency, rate limits | founder attestation of provider-console hard caps (FA-06); price table verified at P3.7 |
| Unified-app mode-switch/navigation correctness | V08, V10, V05, A01, K19 | `resolveIntent` unit tests; restoration precedence tests; SP-08 Maestro PR tier + manual full matrix (accounts A–G, API 29 + 35); intent-filter manifest gate (F-P3-01) | physical-device release subset (FA-03/FA-04) |
| Representative device tests | Q27, V11, Q26, L08, A07, A08 | none sufficient in CI (emulator results are labelled as such) | SP-02 R1/R2 reports on the reference device; SP-01 device runs on ≥3 OEM classes; physical TalkBack pass |
| SP-01/02/04 recorded before freezes | A07, V05, U05, V11, Q26, Q27, B01, B02, B03, E06 | ADR files are written only with evidence attached; CI cannot produce this evidence | ADR-029 + ADR-003 (SP-01), ADR-050 + ADR-046 (SP-02), ADR-006 + ADR-046 (SP-04) moved to ACCEPTED-ON-EVIDENCE or left OPEN-SPIKE with BLOCKED-EXTERNAL recorded |

"Recorded" means the result is written down whatever it is (PASS or FAIL); a freeze additionally needs PASS or an approved fallback.

## 4. Per-requirement detail

Abbreviations: **MC** = maker-checker (drafter ≠ approver, step-up, audited, as `compliance.requirement_sets`); **RL** = Valkey fixed-window rate limit (`packages/server-runtime/src/rate-limiter.ts`); staff route paths below are **proposed names** under the existing `/v1/admin/*` prefix, following the `/v1/admin/requirement-sets/{id}/submission` pattern — the authoritative list is in `docs/phase3/PHASE3_ARCHITECTURE.md` §3.2. Only three error codes are new (WAYVRO_E_SERVICE_AREA 422, WAYVRO_E_APP_UPDATE_REQUIRED 426, WAYVRO_E_MAINTENANCE 503); every other refusal (ZONE_NOT_SERVED, PICKUP_RESTRICTED, OUTSIDE_SERVICE_HOURS, ROUTE_TOO_LONG, ROUTING_UNAVAILABLE, QUOTE_RATE_LIMITED, SAME_POINT, PLACE_REF_*) is a `details.reasonCodes` value under an existing or new code. Error code names WAYVRO_E_SERVICE_AREA, WAYVRO_E_APP_UPDATE_REQUIRED and WAYVRO_E_MAINTENANCE are proposed additive codes; WAYVRO_E_RATE_LIMITED, WAYVRO_E_IDEMPOTENCY_CONFLICT, WAYVRO_E_NOT_FOUND, WAYVRO_E_DEPENDENCY_UNAVAILABLE and WAYVRO_E_FEATURE_DISABLED already exist in `packages/contracts/src/errors.ts`.

### A01 — P0 — Splash, version compatibility, hard/soft update notices, maintenance mode

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.4 (server + mobile), P3.9 (strings), P3.10 (E2E) |
| Surfaces | mob-shared, api · register deps Q31, Q13, P16 |
| API | `GET /v1/app/config` (public, cacheable, no session; returns version status, maintenance state + expected end, client-presentation switches, map-style descriptor, server time). Request headers `X-Wayvro-App-Version`, `X-Wayvro-App-Build`, `X-Wayvro-Platform` on every request; server middleware returns 426 WAYVRO_E_APP_UPDATE_REQUIRED for blocked/below-minimum builds on non-exempt routes; 503 WAYVRO_E_MAINTENANCE during maintenance. Exempt routes: health, app config, legal policy reads, account deletion, sign-out, support contact (list owned by `docs/phase3/PHASE3_ARCHITECTURE.md` §9.3). |
| DB | `platform.app_version_policies` (0013): platform, min_supported_build, recommended_build, message keys, store_url_key, effective_from, MC status, with blocked build ranges in the child table `platform.app_blocked_builds` (int4range + reason code SECURITY / DATA_CORRUPTION / CONTRACT_BREAK); maintenance = runtime switch `platform.maintenance` (`platform.runtime_switches`). |
| UI | Mobile AppRoot states OK / SOFT_UPDATE (dismissible banner, once per 24 h) / HARD_UPDATE (blocking; legal pages, web deletion link and support contact stay reachable) / MAINTENANCE (blocking, retry, expected end); offline with no cached policy ⇒ proceed (server enforces); last policy in memory + secure-store key `wayvro.app-policy.v1`. Web-ops release-control pages. |
| Controls | Policy activation MC; guard: min build cannot exceed latest released build; maintenance is the runtime switch `platform.maintenance` whose safe state is ENABLED: starting maintenance = single authorised staff with step-up (move to the safe state), ending it = maker-checker (`docs/phase3/PHASE3_ARCHITECTURE.md` §9.1); audit + outbox event; new staff permissions platform.app_policy.*, platform.switch.* (FA-10 APPROVED: RELEASE_MANAGER role). |
| External | Store listing URL for the update button (EG-18); until then the HARD_UPDATE screen shows instructions without a store link. |
| Engineering evidence (→ ENGINEERING_SATISFIED) | contract tests for `GET /v1/app/config` + 426/503 envelopes; integration: exempt routes work under HARD_UPDATE and MAINTENANCE, non-exempt refused; blocked build range honoured; MC + step-up + audit tests; mobile pure-logic `evaluateAppPolicy` table tests incl. offline/no-cache/clock-offset; Maestro flows MAINT-01 (maintenance → retry → recovered) and UPD-01/02 (soft dismiss persistence, hard block with legal reachable) on emulator. |
| Remains PARTIAL_EXTERNAL_GATED | store link (EG-18). If store link is absent at closure the ID can still be ENGINEERING_SATISFIED with the instruction fallback documented. |

### A06 — P0 — Urdu/English and Roman Urdu-aware search; clear fallback text and RTL acceptance if actual Urdu script used

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+EXT · P3.2 (normalisation hook, aliases table), P3.5 (search UI), P3.7 (SP-04 metric), P3.9 (aliases, RTL) |
| Surfaces | mob-shared, web-public · register deps P18, Q30 |
| Domain/API/DB | Server query normaliser for autocomplete (case/diacritic folding, Roman-Urdu spelling variants e.g. "chowk/chauk", "mkt/market", "ph/phase", Urdu-script passthrough); `geo.landmark_aliases` (0011_geo_controls; Wayvro-curated alias → canonical search string, locale, source FOUNDER/FIELD, status MC) applied before provider call; locale passed to provider where supported; Urdu-script display names returned when the provider supplies them. |
| UI | Search screen with bidi-isolated mixed-script results; "Can't find it? Type the full address or drop a pin" fallback text in all three catalogues; RTL layout for Urdu locale on search/quote/fare screens. |
| Controls | Aliases are content, not provider data (no provider-derived content stored beyond terms); alias edits MC + audited. |
| External | FA-09 native Urdu/Roman-Urdu review; SP-04 Roman-Urdu autocomplete subset (FA-05). |
| Engineering evidence | normaliser unit + property tests (idempotent: normalise(normalise(x)) = normalise(x); never empties a non-empty query); alias resolution integration; catalogue completeness (every new key in en/ur/ur-Latn); RTL Maestro run in `ur` locale on search + quote screens; mixed-script rendering snapshot review recorded. |
| Remains PARTIAL_EXTERNAL_GATED | native review sign-off (FA-09); field accuracy for Roman-Urdu queries (SP-04 autocomplete top-5 metric). |

### A07 — P0 — Foreground/background location rationale, revoke/regrant and approximate handling

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+FREEZE · P3.5 (rider foreground), P3.6 (SP-01), P3.8 (driver readiness rationale) |
| Surfaces | mob-shared, mob-driver · register deps V05, V06, U05 |
| Mobile | `src/platform/location` wrapper over expo-location (FA-02 APPROVED 2026-10-12; background/FGS options disabled); permission state machine as pure logic with the states of `docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md` §4.1 (UNKNOWN, NOT_DETERMINED, RATIONALE, REQUESTING, GRANTED_PRECISE, GRANTED_APPROXIMATE, DENIED_CAN_ASK, BLOCKED, REVOKED, SERVICES_OFF, FIXING/FIX_*); rationale screen before the first OS prompt at the first "use current location" tap; approximate grant ⇒ coarse centre + mandatory pin confirm; revocation detected on AppState foreground ⇒ silent fallback to search/pin; settings deep link. Driver: readiness checklist shows location readiness (informational, foreground only) + rationale copy; no background request in Phase 3. |
| Manifest | ACCESS_COARSE_LOCATION + ACCESS_FINE_LOCATION move from `forbidden` to `allowed` in `infra/ci/android/permission-allowlist.json` per the FA-02 approval (requirementIds B01, B02, A07, V05, U05); ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE_LOCATION, POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT stay forbidden. iOS: NSLocationWhenInUseUsageDescription only. |
| Controls | Architecture test keeps expo-task-manager / expo-background-fetch banned and permits expo-location only inside `src/platform/location`. |
| External | FA-02 rider permission APPROVED (2026-10-12); SP-01 + FA-03 for background parameters (ADR-029). |
| Engineering evidence | pure-logic tests for every state transition incl. approximate and revocation; Maestro LOC-01..05 on emulator (grant precise, grant approximate, deny, deny permanently → settings, revoke while backgrounded) using `adb shell pm grant/revoke` and `appops`; release AAB permission gate shows exactly the approved set. |
| Remains PARTIAL_EXTERNAL_GATED | background rationale/revocation behaviour on real OEM devices (SP-01). |

### A08 — P1 — VoiceOver/TalkBack, dynamic text, accessible contrast, large tap targets, screen readers

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+EXT · P3.5, P3.8, P3.9, P3.10 |
| Surfaces | mob-shared · register deps Q29, U02 |
| Mobile | accessibility roles/labels/hints on all new primitives; focus order on quote options; live-region announcements for price refresh and quote expiry; text alternative for the map (route summary text, pickup/drop text) so no task needs the map; dynamic type to 200 % without clipping CTAs; touch targets ≥ 48 dp enforced in primitives; contrast AA from token pairs; reduced-motion respected (no gesture-driven sheets, F-P3-08). |
| Controls | token contrast checker in vitest; primitive minimum-size props. |
| External | physical TalkBack pass on the reference device (FA-04; FA-14 recommended); VoiceOver needs an iPhone (FA-13, not Phase-3 blocking). |
| Engineering evidence | A11Y-TOKENS (contrast ratios ≥ 4.5:1 text, ≥ 3:1 large text/UI); A11Y-PRIM (48 dp minimum); Maestro A11Y-01 at font scale 2.0 (key CTAs visible and tappable on rider home, search, quote, driver home); label presence assertions in Maestro (accessibility text selectors). |
| Remains PARTIAL_EXTERNAL_GATED | real TalkBack walkthrough record; VoiceOver (NOT RUN without FA-13). |

### B01 — P0 — Display map, correct geolocation, manual pin, GPS accuracy and landmark-oriented address

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+FREEZE · P3.2 (reverse geocode), P3.5 (text-first pin, location), P3.7 (renderer) |
| Surfaces | mob-rider, api · register deps E06, ADR-006 · register blocker "Maps provider licence" |
| API | reverse geocode endpoint (proposed `GET /v1/geo/reverse`; session required; coordinates sent to provider at ≤ 5 decimals); response carries landmark-first two-line address (primary: landmark/place or block/sector + society; secondary: area, city) + `GeoSourceMeta`. |
| Mobile | `src/platform/maps/` interface (one adapter file imports the vendor SDK; ADR-046) — renderer integrated only after P3.7 freeze; before that, text-first pin flow (address list + "adjust" by search). Pin move → reverse geocode debounced 600 ms; GPS accuracy radius shown; accuracy worse than threshold ⇒ "confirm your pickup" prompt; map style/tile URL + any client token from `GET /v1/app/config`. |
| Controls | RL reverse 30/min/account; no hard-coded vendor URLs/keys in the binary (BUNDLE-SECRETS scan); client key (if the SDK needs one) package/signature-restricted and rotatable. |
| External | SP-04 + SP-02 (renderer freeze ADR-046, licence-coherent bundle CON-P3-16); provider account (FA-06); FA-19 for an S2 (Mapbox) bundle freeze; FA-02 APPROVED for device geolocation. |
| Engineering evidence | landmark formatter unit tests over normalised component fixtures (synthetic, hand-written); reverse-geocode integration against the MOCK double incl. faults; Maestro PIN-01..03 (text-first pin, accuracy prompt, manual override); after P3.7: renderer adapter contract test + SP-02 R2. |
| Remains PARTIAL_EXTERNAL_GATED | rendered map in the shipped app (needs P3.7 freeze); field accuracy (SP-04). |

### B02 — P0 — Pickup/drop autocomplete; coordinate-to-address reverse geocoding; fallback pin selection

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+FREEZE · P3.2, P3.5, P3.7 |
| Surfaces | mob-rider, api · register deps E06, E07, ADR-006 · register blocker "Lahore geocode field accuracy" |
| API | proposed `GET /v1/geo/autocomplete` (min 3 chars, coarse bias cell ~1.1 km, locale), `GET /v1/geo/places/{placeRef}` (resolve/forward geocode), `GET /v1/geo/reverse`; `placeRef` = AEAD-sealed provider id + expiry (never raw provider ids); session required (no pre-sign-in geo). |
| Mobile | debounce 300 ms, min 3 chars, cancel in-flight on keystroke; "type full address / drop a pin" fallback when autocomplete is degraded or budget-exhausted. |
| Controls | RL autocomplete 60/min/account; budget per (provider, sku); cache 24 h autocomplete / 7 days geocode and reverse (capped by terms); route-template-only logging. |
| External | SP-04 (FA-05, FA-06; thresholds FA-07 APPROVED). |
| Engineering evidence | placeRef seal/open/expiry/tamper tests (foreign-key and bit-flip rejected); autocomplete integration incl. STALE_SERVED and budget-exhausted degrade shape; mobile debounce/cancel pure-logic tests; Maestro SRCH-01..04. |
| Remains PARTIAL_EXTERNAL_GATED | Lahore field accuracy and per-SKU provider freeze (SP-04, ADR-006). |

### B03 — P0 — Route visualization, distance/ETA with provider confidence/coverage indicator

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+FREEZE · P3.2 (routing port), P3.3 (route snapshot on quote), P3.5 (text summary), P3.7 (polyline render) |
| Surfaces | mob-rider, api · register deps E06, E07 |
| API/DB | `routing` port (geometry, distance, duration; no matrix in Phase 3); `pricing.route_snapshots` (provider_key opaque, sku, fetched_at, cache_status, confidence, distance_m, duration_s, simplified encoded polyline ≤ 2 KB, bbox, latency_ms); `POST /v1/quotes` response `route{distanceM, durationS, polyline, confidence, source{providerKey, fetchedAt, cacheStatus}}`; `?detail=lite` omits polyline. |
| Mobile | text route summary (distance, ETA range wording, confidence label LOW/UNKNOWN ⇒ "estimate may vary"), polyline only after renderer freeze. |
| Controls | ETA is never invented: unbound/failed routing ⇒ 503 WAYVRO_E_DEPENDENCY_UNAVAILABLE reason ROUTING_UNAVAILABLE; straight-line ETA exists only in the MOCK double and is refused outside local/test (ADR-045). |
| External | SP-04 route/ETA accuracy; renderer (ADR-046). |
| Engineering evidence | polyline encode/decode property tests (round trip within 1e-5°; ≤ 2 KB after simplification); route snapshot contract tests; FAULT-GEO routing cases; Lite payload test (no polyline, smaller body); mobile confidence-label view-state tests. |
| Remains PARTIAL_EXTERNAL_GATED | real route/ETA accuracy (SP-04); rendered polyline (P3.7). |

### B04 — P0 — Eligible car fare estimate and accurate category/seat/luggage info

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.1 (product attributes), P3.3 (quote engine), P3.5 (option cards) |
| Surfaces | mob-rider, api · register deps E05, R28, ADR-013 |
| Domain/DB | `catalog.service_products` (seats_max, luggage_class NONE/SMALL/STANDARD/LARGE, name keys, vehicle_class → `catalog.service_categories`); `catalog.city_service_products` status; quote options only for products that are ENABLED in the city with an ACTIVE rate card; others listed in `unavailable[]` with a reason code. |
| API | proposed `GET /v1/catalog/products?cityCode=` (rider-facing attributes; `docs/phase3/PHASE3_ARCHITECTURE.md` §3.2); `POST /v1/quotes` options carry productCode, total, components, tollPolicy, expiresAt, rateCardVersion. |
| UI | option cards: product name, seats, luggage, price, expiry countdown (server-offset clock), confidence label, toll disclosure; "Request ride" absent (flag `rider.ride-request` OFF, copy "Booking opens soon"). |
| Controls | server ignores any client fare/distance/duration; synthetic config only (`is_synthetic = true`), production refuses synthetic activation. |
| External | real rate values (FA-15, Phase 8). |
| Engineering evidence | product attribute contract tests; quote integration: DISABLED_LEGAL_GATE products never priced; seats/luggage come from catalog rows (no client constants — static scan); Maestro QUOTE-01 (option cards with correct attributes from seed). |
| Remains PARTIAL_EXTERNAL_GATED | none for engineering; business values are synthetic by design (recorded, not a Phase-3 gate). |

### B06 — P0 — Fare components: base, distance, time, tax/fees, tolls, discount, final quote and expiry

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.3, P3.5 |
| Surfaces | mob-rider, api · register deps E05, G04, ADR-013 |
| DB | `pricing.quote_components` kinds BASE, DISTANCE, TIME, BOOKING_FEE, AIRPORT_FEE, MINIMUM_ADJUSTMENT, TOLL, TAX, DISCOUNT (reserved, never emitted in Phase 3), ROUNDING; amount_minor signed bigint; Σ components = total (deferred constraint trigger). |
| UI | fare breakdown sheet (static panel, no gesture sheet): each component, toll policy disclosure (EXCLUDED_DISCLOSED ⇒ "tolls not included"), expiry countdown; expired ⇒ "Prices updated — get a new price". |
| Controls | components computed only server-side with `Money` (HALF_EVEN for distance/time, rounding step + mode from the rate card); expiry from server time. |
| External | tax/toll/rounding values (FA-15). |
| Engineering evidence | PROP-QUOTE (Σ = total, total ≥ 0, determinism, ROUNDING component bounded by step); DB trigger test (unbalanced insert rejected); contract test of component kinds; mobile breakdown view-state tests (every kind renders, unknown kind renders generically — forward compatibility). |
| Remains PARTIAL_EXTERNAL_GATED | none for engineering (values synthetic). |

### E05 — P0 — Pricing versioning, exact quote snapshot, tax/fee split, protected rounding

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.3 |
| Surfaces | api · register deps G04, B06, H06 |
| DB | `pricing.rate_cards` (version, status, is_synthetic, effective window, supersedes_id, version_lock) + `pricing.rate_card_components` (immutable after PENDING_APPROVAL); `pricing.tax_policies` (rate_bp, inclusive, is_placeholder); `pricing.quotes` stores rate_card_id + version, zone_set_id, pricing_engine_version, route_snapshot_id, request_hash; immutable except status (guard trigger). |
| Controls | rounding only via `Money.roundToStep` (`packages/domain/src/money.ts`); no float anywhere in pricing (lint/static check for `number` arithmetic on money fields); production refuses activation of a card referencing a placeholder tax policy. |
| External | accountant review of rounding/tax (FA-15) before pilot. |
| Engineering evidence | snapshot test: quote created, newer card activated, `GET /v1/quotes/{quoteGroupId}` returns identical components and the original version; UPDATE of total/components as `wayvro_api` fails; property tests for rounding modes; tax split test (inclusive vs exclusive) with placeholder 0 bp and a synthetic non-zero rate. |
| Remains PARTIAL_EXTERNAL_GATED | none for engineering. |

### E06 — P0 — Route provider abstraction: ETA, distance, geocode, map tiles, directions

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+FREEZE · P3.2, P3.7 |
| Surfaces | api, worker · register dep ADR-006 · register blocker "Maps provider licence" |
| Server | ports `placesAutocomplete`, `geocoding`, `reverseGeocoding`, `routing` in `@wayvro/provider-interfaces`; `mapStyle` descriptor from server config; every result carries `GeoSourceMeta`; provider-specific types never leave the adapter package (proposed server-only `packages/geo-adapters`); synthetic doubles in `@wayvro/provider-test-doubles` (MOCK brand). |
| Controls | dependency-cruiser: mobile/web cannot import geo adapters; adapters bound only in composition roots; unbound port in staging/production ⇒ 503, never a fallback double. |
| External | SP-04 per-SKU freeze (ADR-006 ACCEPTED-ON-EVIDENCE); provider licence/account (FA-06, FA-08). |
| Engineering evidence | shared port contract suite run against the doubles in CI (and against candidate adapters locally with founder keys — reported NOT RUN in CI); ART-ISO extended to geo doubles; BOOT-NEG (MOCK geo binding refused in staging/production); depcruise rule fixtures. |
| Remains PARTIAL_EXTERNAL_GATED | production adapter per SKU + licence (P3.7). |

### E07 — P0 — Cache and cost protection; route degradation strategy without invented ETAs

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.2, P3.3, P3.7 (TTL re-verification) |
| Surfaces | api, worker · register deps E06, I11 |
| Server | geo gateway pipeline: normalise → authz → RL → Valkey cache → budget → circuit breaker → adapter with timeout → normalise → cache write → usage meter. TTLs: autocomplete 24 h, geocode/reverse 7 days, route 10 min (15-min time bucket); STALE_SERVED only for autocomplete/reverse up to 2× TTL; never a stale route in a new quote beyond 10 min; adapter TTL = 0 when terms forbid caching. Degradation: autocomplete ⇒ "type full address / drop pin"; routing ⇒ quote refused 503 ROUTING_UNAVAILABLE (CON-P3-08: no metered/estimate mode). |
| Controls | Valkey never authoritative; cache entries carry fetchedAt; Google route caching TTL 0 until the route-caching terms are read at P3.7; provider timeouts 1.5/2.0/2.0/2.5 s inside request deadlines (quote: 3.0 s overall, single routing attempt, no retry; geo reads: one connect-error retry only while the remaining deadline ≥ the SKU timeout — PROPOSED, ADR-047). |
| External | per-adapter TTLs re-verified against provider terms at P3.7. |
| Engineering evidence | CACHE-STALE suite (TEST_STRATEGY §4.9); FAULT-GEO suite; quote refusal tests; load harness: cache-hit ratio and p95 on route-cache hit (local, informational). |
| Remains PARTIAL_EXTERNAL_GATED | none for engineering; production TTL values recorded with the ADR-006 freeze. |

### E08 — P0 — Geographic availability zones, exclusions, airport pickup points, service hours

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.1, P3.3 |
| Surfaces | api, web-ops · register deps H10, E01 |
| DB | `catalog.zone_sets` (MC, one ACTIVE per city, is_synthetic, source_reference, immutable after APPROVED), `catalog.zones` (kind SERVICE_AREA / EXCLUSION / PICKUP_RESTRICTED / AIRPORT_PRECINCT; `geometry(MultiPolygon,4326)` NOT NULL, CHECK ST_IsValid and SRID 4326, GiST), `catalog.service_hours` (weekday, opens_local, closes_local, Asia/Karachi), `catalog.pickup_points` (`geometry(Point,4326)`, kind AIRPORT/DESIGNATED/LANDMARK, name_en/name_ur); `catalog.districts.geom` nullable (expand). All PostGIS SQL hand-written (ADR-004). |
| API | quote refusal WAYVRO_E_SERVICE_AREA (422) with details.reasonCodes ZONE_NOT_SERVED / PICKUP_RESTRICTED / OUTSIDE_SERVICE_HOURS / ROUTE_TOO_LONG; PICKUP_RESTRICTED returns candidate pickup points; staff zone-set routes (proposed `/v1/admin/catalog/zone-sets`, `/{id}/submission`, `/approval`, `/activation`). |
| UI | web-ops zone-set upload (GeoJSON) with server validation report; mobile "outside service area / outside hours" states with next opening time. |
| Controls | MC + step-up; production refuses `is_synthetic` zone sets; server time only. |
| External | real licensed/approved Lahore boundaries + district source before pilot (FA-12 DECIDED: synthetic in Phase 3). |
| Engineering evidence | ZONE-BOUNDARY and HOURS suites (TEST_STRATEGY §4.3, §4.4); migration + grants; MC tests; quote integration per reason code. |
| Remains PARTIAL_EXTERNAL_GATED | none for engineering (boundaries synthetic by design). |

### H06 — P0 — Config versioning, rate cards, fee policies with approval and rollback

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.1 (zone/eligibility MC), P3.3 (rate cards, tax policies), P3.4 (version policies, switches) |
| Surfaces | web-ops, api · register deps E05, Q39 |
| API | proposed `/v1/admin/pricing/rate-cards` (+ `/{id}/submission`, `/approval`, `/activation`, `/rollback`), `/v1/admin/pricing/previews`, `/v1/admin/pricing/tax-policies`; rollback = activate a NEW version cloned from a prior approved card (history never rewritten); preview prices synthetic benchmark routes from stored snapshots (no provider call). |
| UI | web-ops pricing pages: draft, diff vs active, preview, submit, approve, activate, rollback. |
| Controls | drafter ≠ approver (DB CHECK); one ACTIVE per (city, product) partial unique index; advisory-lock version allocation; step-up; audit rows (append-only, Q39); new permissions pricing.rate_card.draft/submit/approve/activate/rollback, pricing.tax_policy.* (FA-10 APPROVED: PRICING_MANAGER role). |
| External | a second qualified staff member for real approvals (EG-20 precedent). |
| Engineering evidence | AUTHZ-MATRIX extended (every new admin route × roles × city scope × stale step-up); CONC-PRICING (two concurrent activations ⇒ one ACTIVE); rollback test (new version id, old rows untouched); Playwright web-ops pricing journey + axe. |
| Remains PARTIAL_EXTERNAL_GATED | none for engineering. |

### H10 — P1 — Service zone/city management, categories and vehicle documents matrix

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.1, P3.8 (driver readiness display) |
| Surfaces | web-ops, api · register deps E08, R28, D02 · register note CL-07 (eligibility rules per city/category) |
| DB/Domain | `catalog.vehicle_eligibility_rules` (versioned MC per (city, product): min_model_year or max_vehicle_age_years, min_seats, ac_required, allowed body types); pure evaluator in `apps/api/src/catalog/vehicle-eligibility.ts` (proposed; authoritative server code, not the client-importable `packages/domain`); consumed by driver readiness (Phase 3) and dispatch eligibility (Phase 4). Phase-2 `compliance.requirement_sets` remain the documents matrix (unchanged). |
| UI | web-ops eligibility-rule pages; mobile driver readiness "eligible products" list. |
| Controls | MC; vehicle class FK to `catalog.service_categories` (never renamed, F-P3-04). |
| External | approved Punjab matrix values (EG-03). |
| Engineering evidence | PROP-ELIG-VEH (any failing attribute ⇒ ineligible; rule version recorded); API + MC tests; driver-readiness Maestro step (account B shows eligible ECONOMY from seed). |
| Remains PARTIAL_EXTERNAL_GATED | none for engineering (values synthetic). |

### I11 — P0 — Cost alerts, quotas, provider circuit breakers and usage budgets

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+EXT · P3.2, P3.7 |
| Surfaces | api, worker, infra · register deps E07, Q35 |
| DB | `geo.provider_budgets` (provider_key, sku, daily_calls, monthly_calls, monthly_cost_micro_usd, alert_thresholds_pct; MC; migration 0011_geo_controls), `geo.provider_usage` (hour bucket, calls, cache_hits, errors, est_cost_micro_usd; worker upsert via `platform.jobs`). |
| Server | Valkey day/month counters (OTP-budget precedent, F-P3-05); log signals at 50/80/100 %; at 100 % the SKU is refused; per-SKU kill switch (`platform.runtime_switches`); circuit breaker per (provider, sku): open at ≥ 50 % failures over ≥ 20 calls in 60 s or 5 consecutive timeouts, open 30 s, 3 half-open probes (proposed values, config). |
| Controls | geo.budget.view/edit permissions; budget edits MC; Valkey unavailable ⇒ provider call refused (fail-closed, PROPOSED in ADR-047). |
| External | provider-console hard caps set by the founder (FA-06); verified price table (P3.7); alert destination (EG-21). |
| Engineering evidence | BUDGET suite and BREAKER suite (TEST_STRATEGY §4.8); rollup job idempotency; signal dedupe; concurrency (100 parallel calls at budget − 1 ⇒ exactly 1 allowed). |
| Remains PARTIAL_EXTERNAL_GATED | console caps attestation (FA-06); alert routing (EG-21). |

### K19 — P1 — Localized onboarding UX: pending/failed/review/approved/rejected/expired/suspended states, camera guidance, offline resume and accessibility

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+EXT · P3.8, P3.9 |
| Surfaces | mob-driver · register deps D04, K05, P18 · CON-P3-15 (Phase-2 UI exists; Phase-3 remainder) |
| Mobile | state-coverage audit of existing `earn/*` screens for every application/document state; "suspended" has no profile state — it is a DRIVER_ROLE restriction, surfaced on `/drive/health` as "earning paused" with rider use unaffected (`docs/phase3/PHASE3_MOBILE_UX_AND_NAVIGATION.md` §10.5); camera guidance copy; offline resume (pending upload intents survive process death; existing idempotency persistence); TalkBack labels on capture screens. |
| External | FA-09 native review. |
| Engineering evidence | state-coverage table test (every server status enum value maps to a view state and copy key in en/ur/ur-Latn); Maestro ONB-01..03 (account F pending, G expired documents, process-death resume); KYC regression lane in SP-08. |
| Remains PARTIAL_EXTERNAL_GATED | native review (FA-09); physical TalkBack pass. |

### L08 — P1 — Low-data/Lite experience for weak networks and older Android devices: reduced map refresh, compressed assets, text-first status, resumable booking and explicit stale-data indicators.

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+FREEZE · P3.5, P3.6 (SP-02 R1), P3.7 (R2), P3.9 |
| Surfaces | mob-shared, api · register deps Q26, Q27, ADR-019 (CON-P3-11: in-app Lite mode) |
| Mobile/API | Lite toggle + auto-suggest from request-timing heuristics (no NetInfo); no tiles, text-first route summary, `?detail=lite` (no polyline), no auto-refresh, stale indicators when data age exceeds threshold; "resumable booking" in Phase 3 = pending quote-group restore via `GET /v1/quotes/{quoteGroupId}` (ride requests are Phase 4). |
| Budgets | Lite ≤ 150 KB per standard quote flow (FA-07 approved, pre-measurement). |
| External | SP-02 device data measurement (FA-04). |
| Engineering evidence | API payload-size tests (lite vs standard); mobile pure-logic for heuristic and stale thresholds; Maestro LITE-01 on emulator with `-netspeed edge -netdelay gprs`; restore test after process death. |
| Remains PARTIAL_EXTERNAL_GATED | measured data/perf on the reference device (SP-02). |

### P18 — P1 — Localized content management handles English, Urdu script and Roman Urdu copy with reviewed terminology and no machine-translation-only safety/legal text.

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+EXT · P3.9 |
| Surfaces | mob-shared, web-public, api · register deps A06, Q30 · register blocker "Reviewed terminology" |
| Content | typed catalogues (`apps/wayvro-mobile/src/core/i18n/strings.ts` + driver catalogue) extended for all new keys; review-status marker per locale; glossary of fare/zone/permission terms; server message keys (app-version messages, maintenance, zone reasons) resolved client-side. |
| Controls | no machine-translation-only safety/legal text: any safety/legal-class key without reviewer sign-off shows English + "Urdu pending review" rule (existing Phase-2 mechanism); export of the review package for FA-09. |
| External | FA-09; counsel texts (EG-02) for legal copy. |
| Engineering evidence | catalogue completeness and placeholder-parity tests; static scan: no hard-coded user-facing strings in new screens; review-package export generated reproducibly. |
| Remains PARTIAL_EXTERNAL_GATED | reviewer sign-off (FA-09). |

### Q26 — P1 — Performance budgets include mobile cold/warm start, map interaction, data usage, battery, API p95/p99, realtime reconnect and dispatch assignment latency.

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+FREEZE · P3.6, P3.7, P3.10 |
| Surfaces | mob-shared, api, infra · register deps V11, Q27 |
| Artefacts | ADR-050 + `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md` (proposed numbers); server load harness for `POST /v1/quotes` (cache miss/hit), autocomplete, reverse, app config. |
| Scope note | dispatch assignment latency and realtime reconnect are budgeted but measured only in SP-01 harness / Phase 4 (no dispatch code in Phase 3). |
| External | FA-07 APPROVED (pre-measurement budgets); SP-02 (FA-04); SP-01 battery/reconnect (FA-03). |
| Engineering evidence | budget table committed with owner + measurement method per line; server load runs (local stack, labelled non-staging); AAB size gate (bundletool get-size) and Hermes bundle size check in CI. |
| Remains PARTIAL_EXTERNAL_GATED | device-measured start/memory/jank/data/battery values (SP-02/SP-01); staging-class server numbers (no staging exists). |

### Q27 — P1 — Representative low-end Android devices and constrained memory/storage/network are first-class QA targets, not only flagship emulator testing.

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+EXT · P3.6, P3.7, P3.10 |
| Surfaces | mob-shared · register deps Q26, Q32 · register blocker "Representative test devices procured" |
| Plan | reference device Transsion-class Android Go 3–4 GB RAM (Infinix Smart 10 / Tecno Spark 30C class); SP-01 OEM classes Samsung A-series, Xiaomi Redmi (HyperOS), Transsion and/or Vivo Y; constrained storage run (≤ 1 GB free) and constrained network profile in SP-02. |
| External | FA-03, FA-04. |
| Engineering evidence | device protocol docs + capture templates; release-tier checklist in CI docs; emulator low-RAM AVD (2 GB, Go image) full-matrix lane labelled emulator-only. |
| Remains PARTIAL_EXTERNAL_GATED | physical device runs (cannot be satisfied by Claude or CI). |

### Q31 — P1 — Supported OS/app-version matrix and deprecation policy define minimum Android/iOS, forced/soft upgrade, backend compatibility and security exception handling.

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.4 |
| Surfaces | mob-shared, api · register deps A01, Q15, U18 |
| Policy | supported-OS matrix (minSdk 24 today vs R4 recommendation 26–29 — founder decision F-P3-10); backend compatibility window (server supports every build ≥ min_supported_build; additive contract evolution; N-1 client compatibility test); security exception = blocked_builds range with reason SECURITY ⇒ HARD_UPDATE. |
| DB/API | `platform.app_version_policies`; `GET /v1/app/config`; 426 enforcement. |
| External | founder decision on minimum Android (F-P3-10, part of FA-01). |
| Engineering evidence | COMPAT-N1 (Phase-2 contract schemas parse Phase-3 responses for shared routes); oasdiff gate (F-P3-09) green; policy evaluation tests; matrix + deprecation policy recorded in ADR-049. |
| Remains PARTIAL_EXTERNAL_GATED | none for engineering once the founder records the minimum OS. |

### R28 — P2 — Service catalogue explicitly models Economy, Comfort, Bike, Rickshaw and later XL/Pet/Kids/accessible variants as separate eligibility/pricing/safety configurations rather than UI labels only.

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.1 |
| Surfaces | api, web-ops · register deps H10, E08, B04 · F-P3-04 (products ≠ vehicle classes) |
| DB | `catalog.service_products` rows ECONOMY (CAR), COMFORT (CAR), BIKE (BIKE), RICKSHAW (RICKSHAW) as MODELLED; per-city status in `catalog.city_service_products` (NOT_CONFIGURED / CONFIGURED / ENABLED / SUSPENDED / DISABLED_LEGAL_GATE, legal_basis_ref); separate eligibility rules, rate cards and safety_profile_code per product; later XL/Pet/Kids/accessible variants are new rows, not UI labels. |
| Controls | trigger refuses ENABLED when the vehicle class is DISABLED_LEGAL_GATE or legal_basis_ref is null for gated classes; production refuses ENABLED on synthetic config. |
| External | FA-11 lifecycle APPROVED; legal activation of BIKE/RICKSHAW outside Phase 3 (written legal/permit/insurance evidence). |
| Engineering evidence | lifecycle trigger tests; static scan: no product-code switch statements in UI (labels come from name keys); quote integration shows BIKE/RICKSHAW in `unavailable[]` with DISABLED_LEGAL_GATE. |
| Remains PARTIAL_EXTERNAL_GATED | none for engineering. |

### U04 — P0 — Mobile/web third-party SDK inventory maps data collected, purpose, permissions, network endpoints, subprocessors and store disclosure/privacy-manifest requirements; unapproved SDK data collection blocks release

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+FREEZE · P3.0 (baseline), P3.5 (expo-location), P3.7 (renderer/provider), P3.10 (final) |
| Surfaces | mob-shared, company · register deps P13, V14, U05 |
| Artefact | `docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md` (per SDK: data, purpose, permissions, endpoints, subprocessors, Play data-safety and iOS privacy-manifest entries) + a machine-checked list. |
| Controls | CI check: every native module in the release build (autolinking output) and every runtime dependency of `apps/wayvro-mobile` appears in the inventory with status APPROVED, else fail; no analytics/ads/crash SDK; network-endpoint allowlist review for the renderer. |
| External | renderer/provider choice (P3.7); store declarations (EG-18). |
| Engineering evidence | SDK-INV gate passing on the closure SHA; inventory entries for expo-location and the chosen renderer; iOS privacy-manifest entries drafted (iOS not built in CI — NOT RUN). |
| Remains PARTIAL_EXTERNAL_GATED | final renderer entry until P3.7; store submission (EG-18). |

### U05 — P0 — Permission-minimization review covers location, background location, camera, microphone, photos/files, contacts, notifications and Bluetooth/nearby if ever used; each request is just-in-time and core-purpose justified

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+FREEZE · P3.0 (intent-filter gate), P3.5, P3.6, P3.8 |
| Surfaces | mob-shared · register deps V05, A07, U04 |
| Controls | `infra/ci/android/permission-allowlist.json` with requirementIds and justification per permission; forbidden list keeps BACKGROUND/FGS location, POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT, RECORD_AUDIO, contacts, media; NEW exported-components and intent-filter allowlist (F-P3-01); architecture test bans and the location-wrapper exception. |
| External | FA-02 APPROVED; SP-01 for future background justification. |
| Engineering evidence | AAB-GATES on every PR (permissions, intent filters, 16 KB, ABI); negative-control fixtures (manifest with `exp+wayvro` scheme fails; manifest with ACCESS_BACKGROUND_LOCATION fails); permission review table in the inventory. |
| Remains PARTIAL_EXTERNAL_GATED | background-location justification (SP-01, Phase 4 request). |

### V05 — P0 — Sensitive permissions are requested just-in-time by mode and task; rider-only use does not trigger driver background-location/navigation/KYC permissions, and denial/revocation has an explicit recovery path.

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+FREEZE · P3.5, P3.6, P3.8, P3.10 |
| Surfaces | mob-shared, mob-driver · register deps A07, U05, SP-01 · invariant INV-07 (`docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md`) |
| Mobile | permission requests only from task screens (rider location at first "use current location"; driver camera only in capture); driver permission state machine foreground-only; recovery paths for denied/permanent/revoked. |
| External | SP-01 (FA-03); FA-02 APPROVED. |
| Engineering evidence | Maestro RIDER-HYGIENE-01 (account A full rider flow: no permission dialog other than when-in-use location after tapping "use current location"; asserted by dialog absence + `dumpsys package` runtime-permission state at end); same on account B in Rider mode; release manifest gate; static test that no rider-graph module imports camera/location-background APIs. |
| Remains PARTIAL_EXTERNAL_GATED | SP-01 rider-hygiene check on the real release AAB on physical OEM devices. |

### V08 — P1 — The unified app has explicit mode-aware navigation, home surfaces, deep-link routing, notification routing, state restoration and back-stack rules so Rider and Driver/Partner workflows never land in the wrong context.

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.0 (scheme removal), P3.5, P3.8, P3.10 |
| Surfaces | mob-shared · register deps L14, S11, V04 |
| Mobile | rider routes under the URL segment `/ride/*` (eager) and driver routes under `/drive/*` (lazy) inside the existing `(session)` group; `/home` stays the shared account hub; existing `earn/*` retained; new top-level `src/platform/` (maps, location) PROPOSED; `src/core/mode` ModeController (secure-store key `wayvro.mode-preference.v1`, hint only); additive `AccountState.modes`; pure `resolveIntent(intent, accountState, mode)` with allowlisted intent types; restoration precedence (required actions → server account state → preference if permitted else Rider home → pending quote restore); back-stack rules (mode switch = `router.replace` to that mode's home; Android back on a mode home exits). |
| Controls | no external URL scheme in release (CON-P3-07, intent-filter gate); intent payloads carry ids only; server re-checks every driver endpoint; URL length bound before parsing (decode-uri-component exposure). |
| External | external scheme registration waits EG-15 + the decode-uri-component upgrade gate. |
| Engineering evidence | `resolveIntent` table tests (every intent × modes × account states A–G); restoration precedence tests; Maestro NAV-01..06 (mode switch, back stack, process death restore, intent while in wrong mode, restricted driver, pending application). |
| Remains PARTIAL_EXTERNAL_GATED | none for Phase-3 scope; external deep links are explicitly out of Phase-3 release scope. |

### V10 — P1 — Unified-app releases require a cross-mode regression matrix: rider changes cannot silently break driver/KYC/background-location flows and driver changes cannot degrade booking, payments or rider safety; risky capabilities have mode-scoped feature flags/kill switches.

| Field | Content |
|---|---|
| Class / checkpoints | IMPL · P3.0 (gates), P3.4 (mode-scoped switches), P3.5 (PR tier), P3.10 (manual full matrix) |
| Surfaces | infra, mob-shared · register deps P16, Q13, Q32 · register note: scaffolded Phase 3, enforced from Phase 4 · INV-14 |
| Mechanisms | SP-08 Maestro matrix (accounts A–G; PR tier ≤ 15 min, full matrix ≤ 60 min on API 29 + 35 via manual `workflow_dispatch`, mandatory at final closure); `platform.runtime_switches` with scope ALL/RIDER/DRIVER and city; DISABLE = single authorised staff + step-up (emergency, audited, outbox event), ENABLE = MC; client-presentation switches delivered by `GET /v1/app/config`, enforced server-side (WAYVRO_E_FEATURE_DISABLED). |
| External | FA-16 APPROVED (CI emulator minutes: PR tier + manual full matrix, no nightly); physical subset (FA-03/FA-04). |
| Engineering evidence | PR-tier Maestro job green; full-matrix (`workflow_dispatch`) report artefact on the closure SHA; switch semantics tests (rider-scoped switch never affects driver routes and vice versa); proposal to make the PR-tier job a required check (ruleset change = founder action). |
| Remains PARTIAL_EXTERNAL_GATED | physical-device release subset; enforcement as a release blocker is Phase 4. |

### V11 — P1 — Startup time, memory, battery, binary size and low-end Android performance budgets protect rider users from driver-only complexity; expensive driver modules/providers/background workers are not initialized until needed and are profiled on representative devices.

| Field | Content |
|---|---|
| Class / checkpoints | IMPL+FREEZE · P3.5, P3.6, P3.7, P3.10 |
| Surfaces | mob-shared · register deps Q26, Q27, SP-02 · F-P3-07 (Hermes single bundle: lazy = deferred evaluation) |
| Mobile | driver graph via `lazyScreen(() => import())`; zero driver feature modules evaluated at rider startup (instrumented in an E2E-only build flag, absent from release); no background worker in Phase 3. |
| Budgets | Play download arm64-v8a ≤ 30.0 MB, armeabi-v7a ≤ 29.0 MB; Hermes bundle ≤ 4.5 MB; cold start p50 ≤ 2.5 s / p90 ≤ 4.0 s on the reference device (FA-07 approved, pre-measurement; the 30.0 MB / 29.0 MB target is never silently raised). |
| External | SP-02 (FA-04). |
| Engineering evidence | size gate in CI; dependency-cruiser rule: rider graph cannot statically import `features/driver`; E2E-build module-evaluation probe asserts 0 driver modules after rider cold start (emulator). |
| Remains PARTIAL_EXTERNAL_GATED | device-measured start/memory/battery (SP-02; battery via SP-01 harness). |

## 5. Invariants touched in Phase 3

| Invariant (`docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md`) | Phase 3 obligation | IDs |
|---|---|---|
| INV-07 rider-only account never receives background-location/FGS/KYC prompts | Maestro RIDER-HYGIENE + manifest gate in Phase 3; SP-01 #1 device check | V05, U05, A07 |
| INV-09 driver suspension ≠ account suspension | Phase-2 tests re-run; Maestro account D (driver restricted, rider quote works) | V08, V10 |
| INV-14 cross-mode regression | scaffold (PR tier + manual full matrix) in Phase 3; enforced from Phase 4 | V10 |
| INV-05/INV-06 (go-online / abandon active job) | NOT in Phase 3 (no presence, no trips); documented extension point only, no speculative code | — |

## 6. Reporting

Planning-time status of every evidence item in this file: **NOT RUN** (nothing exists). At P3.10 each ID is reported as ENGINEERING_SATISFIED, PARTIAL_EXTERNAL_GATED or BLOCKED with the exact test names, CI run id and closure SHA; individual tests use PASS / FAIL / NOT RUN / BLOCKED / SKIPPED.
