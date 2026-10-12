# PHASE3_TEST_STRATEGY — Test layers, families, tiers and acceptance evidence for all 29 IDs (PROPOSED)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — pending founder/ChatGPT review; no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

**No test described here has been written or run.** Every Phase 3 test is **NOT RUN** at planning time. Requirement traceability: `docs/phase3/PHASE3_REQUIREMENT_MATRIX.md`. Checkpoints: `docs/phase3/PHASE3_IMPLEMENTATION_SEQUENCE.md`. Device protocols: `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md`, `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md`, `docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md`, `docs/phase3/PHASE3_SP08_CROSS_MODE_E2E.md`.

## 1. Baseline (verified on `main` @ `6aed6a4`, 2026-10-12)

| Item | Repository truth |
|---|---|
| Unit/property | Vitest 5.0.3 everywhere. **fast-check 4.10.2 is already installed** (pinned in `pnpm-lock.yaml`) as a devDependency of `packages/domain`, `packages/server-runtime`, `packages/identity-core`, `packages/field-crypto`, `apps/api` and `apps/worker`. It is **not** a dependency of `apps/wayvro-mobile`, `packages/contracts`, `packages/db`, `packages/provider-interfaces` or `packages/provider-test-doubles` (§7.1). |
| Integration | real PostgreSQL 17.5 + PostGIS 3.5.2, Valkey, SeaweedFS, ClamAV, sanitiser container via `docker compose -p wayvro` (Integration job); migrations clean→latest + re-run no-op in CI; `packages/db/test/migrations.integration.test.ts` covers previous-prefix upgrades; restricted roles `wayvro_api`, `wayvro_worker`, `wayvro_realtime`, `wayvro_vault`, `wayvro_audit_sealer`, `wayvro_migrator`. |
| Contract | zod 4.6.5 route contracts; `pnpm openapi:check` (regenerate + `git diff`) on `packages/contracts/openapi/wayvro-api.v1.json`; **no oasdiff gate yet** (F-P3-09). |
| Mobile | Vitest pure logic only (31 files / 246 tests); no component tests; **no Maestro**; architecture test `apps/wayvro-mobile/src/architecture.test.ts` bans expo-location, expo-notifications, expo-task-manager, expo-background-fetch, react-native-maps, expo-media-library. |
| Android | Android job: release AAB (arm64-v8a + armeabi-v7a) + dev-client debug APK; gates `infra/ci/android/check-16kb.mjs`, `infra/ci/android/check-permissions.mjs` with `infra/ci/android/permission-allowlist.json`. **No intent-filter / exported-component gate** — the release AAB currently carries an `exp+wayvro` VIEW/BROWSABLE filter (F-P3-01, verified on the 2026-10-11 local release AAB; re-verification on the post-repair CI artefact recorded in `docs/phase3/PHASE3_PLAN.md`). |
| Web E2E | Playwright + axe (`tests/e2e-web/`) in the e2e-web job. |
| Security | gitleaks 8.30.1 (full history), osv-scanner 2.6.0 with `osv-scanner.toml` (decode-uri-component runtime exception GHSA-vcc3-ghjq-m6fr, `ignoreUntil = 2026-12-31`). **Semgrep is not present** in the repository or CI. |
| Artefact isolation | `scripts/artifact-isolation.mjs --negative-controls` (ADR-045 ART-ISO) for api/worker/realtime. |
| CI triggers | one workflow `.github/workflows/ci.yml` (push to `main` and `phase-*/**`, all PRs, manual); no `schedule:` trigger, no paths filter. Ruleset 24837051 requires the five existing jobs. |

## 2. What CI can and cannot prove (stated before any test is written)

| CI **can** prove (repository evidence) | CI **cannot** prove (needs external evidence; never reported PASS from CI) |
|---|---|
| Server pricing arithmetic, determinism, Σ components = total, rounding | That synthetic rate cards are commercially or legally right (FA-15) |
| Zone/hours/eligibility logic against real PostGIS with synthetic geometry | That synthetic Lahore boundaries match reality (FA-12) |
| Geo gateway behaviour (cache, budgets, breaker, rate limits, degradation) against **MOCK doubles with fault injection** | Real provider behaviour, accuracy, quotas, latency, licence compliance — **mocked providers never prove real integration**; candidate adapters run only locally with founder keys (FA-06) and are reported NOT RUN in CI |
| Contract stability (zod, OpenAPI drift, oasdiff, N-1 client parse) | Store review outcomes, Play declarations (EG-18) |
| Mode/navigation/restoration logic; Maestro flows on an x86_64 **emulator** | Real OEM behaviour (background killing, permission UI variants), battery, thermal, real 3G/4G — the **emulator does not close SP-01 or SP-02** |
| Release manifest contents (permissions, intent filters, ABIs, 16 KB, size per ABI from bundletool) | Cold start / memory / jank on the reference device (SP-02, FA-04) |
| Log/trace redaction with canaries | Real TalkBack usability; VoiceOver/iOS at all (no iOS build in CI; FA-13) |
| Local load-harness numbers (labelled "local, non-staging") | Staging-class p95/p99 (no staging environment exists) |
| Catalogue completeness, RTL layout presence | Linguistic correctness of Urdu/Roman-Urdu (FA-09) |

## 3. Layers

| Layer | Tooling | Phase 3 scope | CI job / tier |
|---|---|---|---|
| Unit | Vitest | quote engine, zone-decision precedence, service-hours evaluator, eligibility evaluator, normaliser, landmark formatter, polyline codec, placeRef sealing, breaker state machine, budget maths, app-policy evaluation | quality (PR) |
| Property | fast-check (server packages) / exhaustive enumeration (mobile) | PROP-MONEY, PROP-QUOTE, PROP-HOURS, PROP-ZONE-DECISION, PROP-POLYLINE, PROP-NORM, PROP-ELIG-VEH, PROP-BREAKER; mobile EXH-INTENT, EXH-RESTORE | quality (PR, low runs) + nightly (high runs) |
| DB integration | real PostGIS | migrations 0010–0013, grants per restricted role, geometry validity/SRID, zone boundaries, triggers (MC, immutability, Σ) | integration (PR) |
| API integration | Vitest + real PG/Valkey + MOCK geo doubles | every new route incl. negative paths; quote tamper; fault injection; budgets; cache; rate limits; authz matrix extension | integration (PR) |
| Contract | zod, `openapi:check`, **oasdiff** (new), COMPAT-N1 | all new routes; additive-only evolution of shared schemas | quality (PR) |
| Mobile pure logic | Vitest | ModeController, `resolveIntent`, restoration precedence, location permission state machine, app-policy states, Lite heuristics, quote view states, catalogue completeness | quality (PR) |
| Mobile E2E | Maestro (SP-08; ADR-052 proposal) on Android emulator | PR tier smoke (accounts A, C, D, E core); scheduled full matrix A–G on API 29 + API 35 at the FA-16 cadence | new `e2e-mobile` (PR) + scheduled |
| Web E2E | Playwright + axe | web-ops catalog, zone sets, rate cards (preview/approve/activate/rollback), geo budgets, release controls | e2e-web (PR) |
| Security | gitleaks, osv-scanner, ART-ISO, BOOT-NEG, LOG-GEO, BUNDLE-SECRETS, SDK-INV | §4.11 | security / quality / integration (PR) |
| Release artefact gates | bundletool + gate scripts | AAB-GATES incl. NEW intent-filter/exported-component gate | android (PR) |
| Load (targeted) | in-repo Node script (built-in fetch; no new dependency) | quote/autocomplete/reverse/app-config latency + cache-hit ratio on the local stack | nightly (informational) |
| Device | physical devices per protocols | SP-01, SP-02 (R1, R2), physical SP-08 subset, TalkBack pass | manual-device (founder) |
| Field | founder drives + harness | SP-04 | manual-field (founder + Claude analysis) |

## 4. Families

Each family is numbered `-01..-n` in test names (Phase-2 convention). Test file paths are proposed names only.

### 4.1 Unit (selected, beyond the property families)

| Family | Cases |
|---|---|
| UNIT-QUOTE | each component kind computed from fixed inputs with hand-checked expected minor units; minimum adjustment emitted only when subtotal < minimum; airport fee only for AIRPORT_PRECINCT pickup with configured fee; TOLL EXCLUDED_DISCLOSED ⇒ amount 0 + disclosure flag; DISCOUNT never emitted; tax inclusive vs exclusive split |
| UNIT-FMT | landmark-first two-line address from normalised components (landmark present / block+society only / area only / Urdu name present / all missing ⇒ "Pinned location" + coordinates never shown raw) |
| UNIT-PLACEREF | seal/open round trip; bit flip in any byte ⇒ reject; expired ⇒ reject; sealed under a retired key ⇒ reject after grace; payload contains no account id |
| UNIT-POLICY | `evaluateAppPolicy` table: build < min ⇒ HARD_UPDATE; build in blocked range ⇒ HARD_UPDATE with reason; min ≤ build < recommended ⇒ SOFT_UPDATE; maintenance ⇒ MAINTENANCE overrides SOFT; offline without cached policy ⇒ OK (server enforces) |
| UNIT-LOCPERM | location permission state machine with the states of `docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md` §4.1 (UNKNOWN, NOT_DETERMINED, RATIONALE, REQUESTING, GRANTED_PRECISE, GRANTED_APPROXIMATE, DENIED_CAN_ASK, BLOCKED, REVOKED, SERVICES_OFF, FIXING/FIX_*); revocation on AppState foreground; one-shot fix parameters (balanced, 10 s timeout, max age 30 s); watch only while the pin screen is focused |
| UNIT-LITE | timing heuristic suggests Lite after N slow responses (threshold from config); stale indicator when data age > threshold; `detail=lite` requested in Lite |

### 4.2 Property (fast-check where installed; enumeration on mobile)

Run counts (proposed): PR `numRuns` 500 per property; nightly 50,000 with a logged seed; any failure prints seed + shrunk counterexample and is reproducible with the seed.

| Family | Package | Properties |
|---|---|---|
| PROP-MONEY | `packages/domain` | `roundToStep` result is a multiple of step for every mode; HALF_EVEN/HALF_UP adjustment magnitude ≤ step/2; FLOOR ≤ input ≤ CEILING; `multiplyByRatio` matches exact rational reference (bigint numerator/denominator oracle); `allocate` parts sum to the whole; JSON round trip `{currency, minor: string}` lossless |
| PROP-QUOTE | `apps/api` (engine `apps/api/src/pricing/engine.ts`, server-only; `Money` stays in `packages/domain`) | Σ components = total for every generated (rate card, distance_m ∈ [0, max_distance_m], duration_s ∈ [0, max_duration_s]); total ≥ 0; determinism (same inputs ⇒ deep-equal component list, run twice and across a JSON round trip of the rate card); total is a multiple of `rounding_step_minor` (step ∈ {1, 5, 10, 50, 100}); `|ROUNDING| ≤ step/2` for HALF modes and `< step` for FLOOR/CEILING; pre-rounding subtotal ≥ minimum fare; total non-decreasing in distance (fixed duration) and in duration (fixed distance); every amount is a bigint (no `number` money) |
| PROP-HOURS | `apps/api` (server-only evaluator) | `isOpen(t)` equals a brute-force oracle that expands the weekly schedule minute-by-minute in Asia/Karachi (UTC+05:00, no DST) for random instants across a year, including overnight windows stored as two rows (one per weekday) |
| PROP-ZONE-DECISION | `apps/api` (server-only evaluator) | for any combination of flags (in SERVICE_AREA, in EXCLUSION, in PICKUP_RESTRICTED, in AIRPORT_PRECINCT, near pickup point): EXCLUSION always yields ZONE_NOT_SERVED; not in SERVICE_AREA always yields ZONE_NOT_SERVED; PICKUP_RESTRICTED without a snapped pickup point never yields PRICED |
| PROP-POLYLINE | `packages/domain` (polyline codec location per PHASE3_ARCHITECTURE §3.1; fast-check 4.10.2 is already a devDependency there) | `decode(encode(xs))` within 1e-5° per coordinate; simplification output ≤ 2 KB and keeps first/last point; decode of malformed strings throws a typed error, never hangs (bounded length) |
| PROP-NORM | `apps/api` | normaliser idempotent; never empties a non-empty query; Urdu-script input passes through unchanged except whitespace; length bounded |
| PROP-ELIG-VEH | `apps/api` (`apps/api/src/catalog/vehicle-eligibility.ts`, proposed, server-only) | any failing attribute ⇒ ineligible; rule version recorded in the result; adding a stricter rule never makes an ineligible vehicle eligible |
| PROP-BREAKER | `packages/server-runtime` | random sequences of success/failure/timeout with a fake clock never let a call through while OPEN; at most 3 concurrent probes in HALF_OPEN; per-(provider, sku) isolation |
| EXH-INTENT (mobile) | `apps/wayvro-mobile` | **exhaustive** enumeration (finite space: every allowlisted intent type × {Rider, Driver} × account states A–G × required-action present/absent): never routes to the driver graph when `modes.driver.available = false`; never bypasses AccountGate; unknown intent ⇒ refuse(reason) |
| EXH-RESTORE (mobile) | `apps/wayvro-mobile` | exhaustive: restoration precedence (required actions → server state → permitted preference → Rider home → pending quote restore) for every combination of stored preference, server modes and quote state (none / valid / expired) |

### 4.3 ZONE-BOUNDARY and geometry (DB integration, real PostGIS)

Synthetic geometry only (seeded squares and rings with round coordinates, no real places). Proposed file: `packages/db/test/catalog-zones.integration.test.ts`.

| Case | Expected |
|---|---|
| GEOM-01 self-intersecting (bow-tie) polygon insert | rejected by CHECK `ST_IsValid` |
| GEOM-02 geometry with SRID 3857 | rejected (typmod SRID 4326) |
| GEOM-03 plain Polygon into MultiPolygon column | rejected by typmod; the staff import service wraps with `ST_Multi` and the test proves the stored type |
| GEOM-04 empty MultiPolygon | rejected by the `NOT ST_IsEmpty(geom)` CHECK (PHASE3_CATALOG_ZONES_AND_DATA_MODEL §6.1) |
| GEOM-05 lat/lng swapped GeoJSON import | rejected by the Pakistan-envelope validation with a validation report row |
| GEOM-06 axis order | `ST_MakePoint(lng, lat)` order verified with an asymmetric synthetic point that lands outside the zone if swapped |
| GEOM-07 quote pickup `geography(Point,4326)` vs zone `geometry` | cast path returns the same decision as a pure-geometry query for the seeded cases |
| ZB-01 point strictly inside SERVICE_AREA | served |
| ZB-02 point exactly on the SERVICE_AREA boundary (vertex and edge midpoint) | served (ST_Covers semantics — PROPOSED, recorded in ADR-051) |
| ZB-03 point 1e-7° outside the boundary | not served (ZONE_NOT_SERVED) |
| ZB-04 point inside a hole (interior ring) of a SERVICE_AREA polygon | not served |
| ZB-05 point inside the second component of a MultiPolygon | served |
| ZB-06 shared edge between two SERVICE_AREA zones | served exactly once (no duplicate rows, no error) |
| ZB-07 point inside an EXCLUSION nested in SERVICE_AREA | ZONE_NOT_SERVED (exclusion wins) |
| ZB-08 point on the EXCLUSION boundary | excluded (conservative — PROPOSED) |
| ZB-09 pickup in PICKUP_RESTRICTED without snap | PICKUP_RESTRICTED with candidate pickup points; with a snapped designated point ⇒ priced |
| ZB-10 pickup in AIRPORT_PRECINCT | airport pickup point required; AIRPORT_FEE component present when configured, absent when not |
| ZB-11 dropoff inside PICKUP_RESTRICTED | allowed (restriction is pickup-only — PROPOSED) |
| ZB-12 zone with product applicability excluding ECONOMY | ECONOMY in `unavailable[]` with ZONE_NOT_SERVED; other products unaffected |
| ZB-13 zone set not ACTIVE (DRAFT/APPROVED/RETIRED) | ignored |
| ZB-14 activation of a new zone set during quoting | quote records the `zone_set_id` it used; no mixed-set decision |
| ZB-15 coordinates out of range (lat > 90, lng > 180, NaN, Infinity, strings) and outside the Pakistan bbox | rejected by zod (400) before any DB or provider call |
| ZB-16 district geometry absent | `pickup_district_code` null, quote still priced |

Antimeridian and polar cases are not relevant to Pakistan and are not tested; invalid geometry is.

### 4.4 HOURS (service hours, Asia/Karachi)

| Case | Expected |
|---|---|
| HRS-01 instant equal to `opens_local` | open (inclusive) |
| HRS-02 instant equal to `closes_local` | closed (exclusive) |
| HRS-03 overnight window stored as two rows (Friday 22:00–24:00, Saturday 00:00–02:00), instant Saturday 01:00 Karachi | open (Saturday row) |
| HRS-04 same window, Saturday 02:00 | closed |
| HRS-05 23:59:59.999 and 00:00:00.000 transitions | correct on both sides |
| HRS-06 UTC date differs from Karachi date (e.g. Sunday 20:30 UTC = Monday 01:30 PKT) | Monday schedule applies |
| HRS-07 product-specific row vs general row | product-specific wins (PROPOSED) |
| HRS-08 no rows for a product/zone set | closed (fail-closed — PROPOSED) |
| HRS-09 `opens_local = closes_local` | 24 h open (convention fixed in PHASE3_CATALOG_ZONES_AND_DATA_MODEL §3) |
| HRS-10 client sends its own time / timezone field | rejected as unknown field; server clock (injected) decides |
| HRS-11 OUTSIDE_SERVICE_HOURS response | carries next opening time computed in Asia/Karachi |

### 4.5 Migrations, grants and immutability (DB integration)

| Family | Cases |
|---|---|
| MIG-P3 | clean DB → latest (0000–0013); every previous prefix (0000…0009, 0000…0010, 0000…0011, 0000…0012) → latest; second run applies 0; **live-row upgrade**: a database at 0009 with Phase-2 rows (requirement sets, applications, vehicles referencing `catalog.service_categories`) migrates to latest with those tables byte-identical (row checksums before/after); header lines present (wayvro-migration, compatibility, data-impact, rollback, verification); hand-written PostGIS SQL (no drizzle-kit geometry emission, ADR-004) |
| GRANT-P3 | executed **as each restricted role**: `wayvro_api` SELECT on new catalog tables, writes only through the column grants/service functions; `wayvro_api` INSERT on `pricing.quotes`/`pricing.quote_components`/`pricing.route_snapshots`, UPDATE only of `pricing.quotes.status`, no DELETE; `wayvro_worker` purge rights on expired quotes/snapshots and upsert on `geo.provider_usage`, nothing else; `wayvro_realtime` and `wayvro_vault` no access to `catalog` writes, `pricing` or `geo`; no PUBLIC grants (catalog query over `information_schema.role_table_grants`) |
| TRIG-P3 | MC: drafter = approver ⇒ CHECK violation; second ACTIVE per (city, product) / per city zone set ⇒ unique violation; components UPDATE after PENDING_APPROVAL ⇒ refused; zone set geometry UPDATE after APPROVED ⇒ refused; quote UPDATE of any column other than status ⇒ refused; Σ components ≠ total at COMMIT ⇒ deferred trigger rejects; `city_service_products` → ENABLED for a DISABLED_LEGAL_GATE vehicle class or null legal_basis_ref ⇒ refused |
| CONC-PRICING | two concurrent activations of different versions for the same (city, product) ⇒ exactly one ACTIVE; concurrent version allocation ⇒ distinct versions (advisory lock); concurrent quote creation with the same Idempotency-Key ⇒ one quote group |

### 4.6 API integration and QUOTE-TAMPER

All against the real local stack with MOCK geo doubles. Proposed files: `apps/api/test/quotes.integration.test.ts`, `apps/api/test/quote-tamper.integration.test.ts`, `apps/api/test/geo.integration.test.ts`, `apps/api/test/app-config.integration.test.ts`, `apps/api/test/catalog-admin.integration.test.ts`, `apps/api/test/pricing-admin.integration.test.ts`.

| Case | Expected |
|---|---|
| QT-01 body contains `fare`, `total`, `distanceM`, `durationS` or `components` | 400 WAYVRO_E_VALIDATION (unknown fields rejected, SEC-MA precedent) — never used in pricing |
| QT-02 same Idempotency-Key, same body | same 201 response and same `quoteGroupId`; no second provider call (usage counter unchanged) |
| QT-03 same Idempotency-Key, changed body | 409 WAYVRO_E_IDEMPOTENCY_CONFLICT |
| QT-04 same key used by a different account | independent quote (keys scoped per account) |
| QT-05 `GET /v1/quotes/{id}` for another account's group | 404 WAYVRO_E_NOT_FOUND, identical shape and status to a random UUID |
| QT-06 expired quote | GET returns status EXPIRED (lazily computed from server time); no endpoint extends expiry |
| QT-07 tampered / expired / foreign-account placeRef | 400 WAYVRO_E_VALIDATION with `details.reasonCodes` PLACE_REF_INVALID / PLACE_REF_EXPIRED (foreign account ⇒ PLACE_REF_INVALID, no oracle); no provider call |
| QT-08 placeRef never affects price | same coordinates with and without a valid placeRef ⇒ identical components and total; no provider call is made for the placeRef in `POST /v1/quotes` |
| QT-09 unknown product code | 400; DISABLED_LEGAL_GATE / not ENABLED product ⇒ `unavailable[]` with reason |
| QT-10 cityCode inconsistent with coordinates | WAYVRO_E_SERVICE_AREA ZONE_NOT_SERVED |
| QT-11 distance > `max_distance_m` | ROUTE_TOO_LONG |
| QT-12 21st quote within a minute (account) / IP-prefix limit | 429 WAYVRO_E_RATE_LIMITED, Retry-After present |
| QT-13 spoofed `X-Wayvro-App-Build` | affects only 426 evaluation; never pricing, eligibility or authorisation |
| QT-14 newer rate card activated after quoting | GET returns the original components and rateCardVersion (snapshot) |
| QT-15 production profile with only a synthetic card | activation refused; no quote possible ⇒ product in `unavailable[]` |
| QT-16 no session | 401; geo endpoints likewise (no pre-sign-in geo) |
| QT-17 SUPERSEDED | a newer quote group by the same account marks older unexpired groups SUPERSEDED; rows kept |
| API-CFG-01..06 | `GET /v1/app/config` public and cacheable; 426 on non-exempt routes for blocked builds; exempt routes (health, app config, legal reads, deletion, sign-out) work under HARD_UPDATE and MAINTENANCE; 503 WAYVRO_E_MAINTENANCE envelope; switch DISABLE single staff + step-up, ENABLE MC; audit + outbox event |
| AUTHZ-MATRIX (extended) | every new `/v1/admin/...` route × {each role incl. proposed PRICING_MANAGER/CATALOG_MANAGER/RELEASE_MANAGER or their FA-10 mapping, none, offboarded, consumer token, stale step-up, wrong city, drafter approving own draft}; denials audited; route-completeness check fails if a new admin route is missing from the matrix |
| SUPPORT-QUOTE | `pricing.quote.view` lookup is reason-gated and returns district codes, never coordinates |

### 4.7 FAULT-GEO (provider fault injection)

Implemented as fault modes of the MOCK geo doubles in `@wayvro/provider-test-doubles` (dev-only), selectable per test. Real adapters are tested for parsing with **hand-written synthetic fixtures shaped like the documented provider schema** — captured provider responses are never committed (licence terms).

| Case | Injected | Expected |
|---|---|---|
| FG-01 | routing timeout (no response within 2.5 s) | AbortController fires at the budget; quote 503 WAYVRO_E_DEPENDENCY_UNAVAILABLE reason ROUTING_UNAVAILABLE; breaker counts a timeout |
| FG-02 | 5xx / connect error | routing: never retried (single attempt inside the 3.0 s quote deadline) ⇒ 503 as above; autocomplete/reverse: one retry on a connect error only and only if the remaining deadline ≥ the SKU timeout, never on 5xx or timeout |
| FG-03 | malformed payload (missing fields, wrong types, negative distance, NaN duration, geometry outside bbox) | adapter normalisation rejects; counted as failure; no partial quote |
| FG-04 | slow drip (headers fast, body trickles past the timeout) | total-time timeout, not idle timeout, applies |
| FG-05 | quota exceeded (provider 429-equivalent) | SKU marked unavailable until the window resets; breaker not tripped by quota alone (separate signal); log signal emitted |
| FG-06 | partial results (route without duration; autocomplete with fewer results; reverse without locality) | route without duration ⇒ refused (no invented ETA); autocomplete returns what exists with confidence; reverse formats with available components |
| FG-07 | empty result set | autocomplete degrade copy; reverse ⇒ "Pinned location" |
| FG-08 | adapter throws an error whose message echoes the query | error mapped to a stable code; raw provider message never logged or returned |
| FG-09 | unbound routing port in a staging/production profile | quote 503 ROUTING_UNAVAILABLE; MOCK binding refused at boot (BOOT-NEG) |
| FG-10 | straight-line ETA double | available only in local/test; refused outside (ADR-045 mechanisms) |

### 4.8 BUDGET, BREAKER and rate limits

| Case | Expected |
|---|---|
| BUD-01 | counters at 50/80/100 % emit one structured log signal per threshold per window (dedupe) |
| BUD-02 | at 100 %: SKU refused; autocomplete returns degrade shape; routing ⇒ quote refused |
| BUD-03 | 100 concurrent calls at budget − 1 ⇒ exactly 1 provider call (Lua atomicity) |
| BUD-04 | day/month window rollover in server time; monthly cost estimate from the adapter price table (micro-USD config) |
| BUD-05 | Valkey unavailable ⇒ provider calls refused (fail-closed — PROPOSED in ADR-047) and a signal emitted |
| BUD-06 | hourly rollup to `geo.provider_usage` idempotent (re-run of the same hour does not double-count); counts equal the sum of gateway events |
| BUD-07 | per-SKU kill switch (runtime switch) refuses immediately; enable requires MC |
| BUD-08 | budget edit requires MC + `geo.budget.edit`; audit row |
| BRK-01 | ≥ 50 % failures over ≥ 20 calls in 60 s ⇒ OPEN; 19 failing calls ⇒ still CLOSED (minimum volume) |
| BRK-02 | 5 consecutive timeouts ⇒ OPEN regardless of volume |
| BRK-03 | OPEN refuses for 30 s with zero adapter invocations (spy) |
| BRK-04 | HALF_OPEN admits 3 probes; success closes; any failure re-opens |
| BRK-05 | isolation per (provider, sku); Valkey hint unavailable ⇒ process-local breaker still enforces |
| RL-01..04 | quotes 20/min/account and 200/day/account, 60/min/IP-prefix; autocomplete 60/min/account; reverse 30/min/account; limiter down ⇒ fail-closed for geo (as OTP precedent) |

### 4.9 CACHE-STALE

| Case | Expected |
|---|---|
| CS-01 | route cache key = origin/dest rounded to 4 decimals + routing profile + 15-min bucket; same key within TTL ⇒ HIT, `cacheStatus` HIT on the quote's route source |
| CS-02 | route entry older than 10 min (fake clock at 10:00.001) ⇒ MISS + provider call; if the provider then fails ⇒ quote refused, **never** the stale route |
| CS-03 | autocomplete provider down, entry age ≤ 2× TTL ⇒ served with `cacheStatus` STALE_SERVED; age > 2× TTL ⇒ not served (degrade shape) |
| CS-04 | reverse geocode keyed on 4-decimal rounding; two points 3 m apart share an entry, two points 30 m apart do not |
| CS-05 | adapter configured TTL = 0 (terms forbid caching) ⇒ never written to Valkey |
| CS-06 | cache entries carry `fetchedAt`; Valkey flush ⇒ only MISSes, no errors (never authoritative) |
| CS-07 | autocomplete key uses the coarse bias cell (2 decimals) — fine-grained coordinates never part of the key |

### 4.10 Contract

| Family | Cases |
|---|---|
| CON-OPENAPI | `pnpm openapi:check` drift (existing) for every new route |
| OASDIFF (F-P3-09) | breaking-change check of the PR spec against the merged-base spec (baseline = Phase-2 spec at `6aed6a4`); any breaking change fails unless the PR carries an approved compatibility plan (CLAUDE.md §4) |
| COMPAT-N1 | Phase-2 response schemas (frozen copy of `packages/contracts` at the Phase-2 baseline, test-only) parse Phase-3 responses of shared routes (notably `AccountState` with the additive `modes`); no new enum value appears in a field an older client parses as a closed enum unless that field is versioned |
| CON-GEO | `GeoSourceMeta` fields always present; `providerKey` opaque (matches `^geo-[a-z]$`-style token, never a vendor name); no provider-specific field leaks (response schemas reject extra keys in tests) |
| CON-ERR | new codes appended to `ERROR_CODES` only; existing codes unchanged (snapshot of the ordered list) |

### 4.11 Security, isolation and redaction

| Family | Cases |
|---|---|
| SEC-SCAN-GITLEAKS | existing full-history scan; plus a negative control: a fake key-shaped string (generated at run time in a temp directory outside the repo, never committed) for the GCP API-key and Mapbox-token formats must be flagged — proves the ruleset covers the vendors being evaluated (FA-06 keys stay in local untracked env) |
| SEC-SCAN-OSV | existing scan; **decode-uri-component re-check**: after P3.0 the CI asserts the release manifest has no VIEW/BROWSABLE filter (so the exception reason is true again); `resolveIntent` / `parseWayvroPath` bounds URL length (≤ 512 chars) before any parse and a fuzz set of malformed percent-encodings completes in bounded time; the exception expires 2026-12-31 — if Phase 3 runs past it the scan fails and renewal needs a fresh justification, never a silent date bump |
| SEC-SCAN-SEMGREP | Semgrep is not present; not proposed in Phase 3 (strict ESLint + dependency-cruiser + review); reported SKIPPED with this reason |
| ART-ISO (extended) | api/worker/realtime production artefacts contain no geo doubles, no straight-line ETA symbol, no SP-04 harness (`tools/geo-bench`, proposed) and no synthetic seed script; dynamic import of the doubles fails `ERR_MODULE_NOT_FOUND`; dependency-cruiser negative fixture for production → geo doubles fails lint |
| BOOT-NEG (extended) | staging/production: MOCK geo binding refused; synthetic zone set / rate card activation refused in production; missing map-style config refused |
| LOG-GEO | canary run: autocomplete query containing a unique canary token and pickup/dropoff with sentinel synthetic coordinates (distinctive 7-decimal suffix) through autocomplete, reverse, quote, quote GET, failure paths; assert absence of the canary and of any coordinate pair in pino logs, OTel span attributes (URL attributes carry route templates only), error bodies, audit rows, `platform.jobs` payloads and `geo.provider_usage` rows; access logs show `/v1/geo/autocomplete` without `?q=` |
| BUNDLE-SECRETS | built Hermes bundle and APK/AAB string scan: no provider API key patterns, no server env names for geo keys, no vendor tile/style URLs other than those delivered by `GET /v1/app/config` (unless the chosen SDK unavoidably embeds one — recorded in the inventory) |
| SDK-INV | every runtime dependency of `apps/wayvro-mobile` and every autolinked native module in the release build is listed APPROVED in the SDK inventory, else fail |
| GITIGNORE-HARNESS | `git check-ignore` confirms the SP-04 raw-response directory is ignored |

### 4.12 AAB-GATES (Android job)

| Gate | Rule |
|---|---|
| 16 KB | existing `check-16kb.mjs` on every native library |
| ABI | release contains exactly arm64-v8a and armeabi-v7a (no x86/x86_64) |
| Permissions | allowlist; FINE/COARSE allowed only after FA-02 with requirementIds B01, B02, A07, V05, U05; BACKGROUND_LOCATION, FOREGROUND_SERVICE_LOCATION, POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT stay forbidden |
| **Intent filters / exported components (NEW, F-P3-01)** | parse the merged base manifest via bundletool; allowed: MAIN/LAUNCHER on the main activity; any `<data android:scheme>` (including `exp+wayvro`), any VIEW/BROWSABLE filter, or any exported activity/service/receiver/provider not in the allowlist ⇒ FAIL; negative controls: a fixture manifest with `exp+wayvro` and one with an extra exported receiver must fail |
| Size | bundletool get-size per ABI: report-only until FA-07, then failing at arm64-v8a ≤ 30.0 MB, armeabi-v7a ≤ 29.0 MB; Hermes bundle ≤ 4.5 MB; delta > 1.5 MB needs a written justification in the PR |
| Release purity | release AAB has no E2E-only module-evaluation probe, no cleartext/localhost E2E config (`usesCleartextTraffic` not true), no dev-client launcher |

### 4.13 Mobile pure-logic (Vitest, `apps/wayvro-mobile`)

ModeController (preference is a hint; server `modes` decide; switch never grants), EXH-INTENT, EXH-RESTORE, UNIT-LOCPERM, UNIT-POLICY, UNIT-LITE, quote view-state adapter (loading / empty / priced / expired / service-area refusal / routing unavailable / rate limited / offline / stale), expiry countdown on server-offset clock (device clock ignored), fare breakdown renders every component kind and unknown kinds generically, catalogue completeness (every new key in en/ur/ur-Latn, placeholder parity), static scans (no hard-coded user-facing strings in new screens; no product-code switch statements in UI; rider-graph modules do not import driver features or camera), architecture test updated (expo-location allowed only inside `src/platform/location`; vendor map SDK only inside `src/platform/maps`).

### 4.14 Maestro (SP-08) — emulator

Detailed in `docs/phase3/PHASE3_SP08_CROSS_MODE_E2E.md`. Seeded synthetic accounts: A rider-only; B approved driver in Rider mode; C same account switching to Driver mode; D driver role restricted (rider OK); E account-wide restricted; F pending application; G expired documents. Runs against the local stack (API reached from the emulator at the host loopback alias) using a **release-mode JS bundle in a debug-signed E2E APK** (x86_64) so the shipped Hermes bundle is exercised, not Metro; the E2E variant is never the gated release AAB (§4.12 release purity). Synthetic OTP comes from the existing local-only sink (absent from production artefacts by ART-ISO).

| Flow | Accounts | Tier |
|---|---|---|
| NAV-01 mode switch Rider→Driver→Rider resets to each home (`router.replace`), Android back on home exits | C | PR |
| NAV-02 restricted driver: Driver mode shows health/appeal; Rider quote still works (INV-09) | D | PR |
| NAV-03 process death on quote screen → restore pending quote group; expired ⇒ "Prices updated" | A | PR |
| NAV-04 internal intent for a driver screen while in Rider mode ⇒ permitted switch prompt or refusal per `resolveIntent` | B, C, F | nightly |
| NAV-05 account-wide restriction ⇒ both modes blocked by AccountGate | E | nightly |
| NAV-06 pending application ⇒ Driver entry opens Earn onboarding, not driver home | F | nightly |
| SRCH-01..04 autocomplete (min 3 chars, debounce), degrade copy on budget exhaustion (fault-injected API), Roman-Urdu alias query, manual pin fallback | A | PR (01), nightly |
| PIN-01..03 text-first pin, accuracy prompt, manual override | A | nightly |
| QUOTE-01 option cards (seats/luggage/price/expiry/confidence/toll disclosure), "Request ride" absent | A | PR |
| QUOTE-02 service-area / hours / routing-unavailable / rate-limited states | A | nightly |
| LOC-01..05 precise grant, approximate grant, deny, deny permanently → settings link, revoke while backgrounded (`adb shell pm revoke` / `appops`) | A | nightly (only after FA-02) |
| RIDER-HYGIENE-01 full rider flow: no permission dialog except when-in-use location after the explicit tap; end-of-run `dumpsys package` shows no other runtime permission requested | A, B | PR |
| UPD-01/02, MAINT-01 soft update dismiss (24 h), hard update block with legal pages reachable, maintenance retry → recovered | A | nightly |
| ONB-01..03 pending state, expired documents renewal entry, process-death resume of capture intent | F, G | nightly |
| LITE-01 Lite mode under `-netspeed edge -netdelay gprs`: no polyline requested, stale indicators shown | A | nightly |
| A11Y-01 font scale 2.0 (`adb shell settings put system font_scale 2.0`): key CTAs visible and tappable on rider home, search, quote, driver home | A, C | nightly |
| RTL-01 `ur` locale: search and quote screens laid out RTL, amounts and mixed-script addresses bidi-isolated | A | nightly |

API levels: PR tier on API 35; nightly on API 29 and API 35; a low-RAM AVD (2 GB, Go image) lane nightly — labelled emulator-only, never SP-02 evidence.

### 4.15 Accessibility

| Family | Cases | Proves / does not prove |
|---|---|---|
| A11Y-TOKENS | WCAG contrast computed for every foreground/background token pair used in new screens: ≥ 4.5:1 text, ≥ 3:1 large text and UI components | tokens only |
| A11Y-PRIM | primitives enforce ≥ 48 dp hit area (incl. hitSlop) and require accessibility label/role props for interactive elements | static only |
| A11Y-01 (Maestro) | dynamic type 200 % | emulator layout, not real-user usability |
| A11Y-LABELS (Maestro) | label presence on interactive elements of new screens via accessibility-text selectors; live-region announcement props for price refresh and expiry | presence, not quality |
| A11Y-MAP | every map task has a text alternative (route summary, pickup/drop text, pin via search) | logic |
| A11Y-DEVICE (manual) | TalkBack walkthrough on the reference device (FA-04; FA-14 tester recommended): sign-in → where-to → quote → breakdown; driver home readiness | real usability — manual record |
| VoiceOver | **NOT RUN** in Phase 3 without an iPhone (FA-13) | — |
| Web | axe in Playwright for new web-ops pages | web-ops only |

### 4.16 RTL and localisation

Catalogue completeness and placeholder parity (unit); Urdu-script and Roman-Urdu review status markers present; RTL-01 Maestro; numerals and PKR amounts formatted consistently in all locales with bidi isolation; truncation check at 200 % in `ur`; native review package exported reproducibly (FA-09 performs the review — reported NOT RUN until signed off).

### 4.17 Low-data and network shaping

| Level | Method | Evidence |
|---|---|---|
| API | payload-size assertions: `detail=lite` responses omit polyline and stay under a byte ceiling; autocomplete response size bounded | CI (integration) |
| Emulator | `-netspeed`/`-netdelay` profiles (edge/gprs, 3G-like) in LITE-01; request counting via the API access log (template paths) for a standard quote flow (8 debounced keystroke requests max over 2 searches) | nightly, emulator-only |
| Device | SP-02 data-per-flow measurement (Lite ≤ 150 KB, standard cold tiles ≤ 2.0 MB, warm ≤ 600 KB — proposed) on real 4G + throttled Wi-Fi | manual-device (founder), SP-02 report |

### 4.18 Device and field families

| Family | Where | Pass criteria source | Runs |
|---|---|---|---|
| SP-01 | physical Samsung A-class, Xiaomi Redmi (HyperOS), Transsion and/or Vivo Y; spike build under `tests/spikes/` (proposed) + rider-hygiene on the real release AAB | `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md` (≥ 95 % points over 60 min screen-off on ≥ 3 OEM classes; revocation ≤ 30 s; deterministic recovery; push-disabled offer path) | founder (FA-03) with Claude-prepared builds and analysis |
| SP-02 R1/R2 | reference Transsion-class Android Go device, release AAB via bundletool install, 5 runs median/p90 | `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md` + `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md` | founder (FA-04) |
| SP-04 | founder field drives + desk captures; harness compares candidates per SKU | `docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md`; capture via `docs/phase3/PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv` | founder (FA-05, FA-06) + Claude analysis |
| SP-08 physical subset | PR-tier flows + LOC + RIDER-HYGIENE on ≥ 2 physical devices before release | SP-08 doc | founder |

### 4.19 Cross-mode regression (V10, INV-14)

Lanes, all run nightly regardless of which side changed: (1) rider quote lane (A, B, D); (2) driver readiness lane (C); (3) KYC/onboarding lane (F, G — Phase-2 capture flows with the emulator virtual camera); (4) restriction lane (D, E); (5) permission hygiene lane (RIDER-HYGIENE on A and B). Background-location lane is empty in Phase 3 (no background code ships) and is wired in Phase 4 with SP-01 parameters. Server-side regression: all Phase-2 integration suites and Playwright suites stay required in PR CI. Mode-scoped switch tests prove a RIDER-scoped switch never changes driver route behaviour and vice versa.

### 4.20 Load (targeted, local)

In-repo Node script using built-in `fetch` (no new dependency): `POST /v1/quotes` with route-cache miss (MOCK double latency injected at representative values) and hit, autocomplete, reverse, `GET /v1/app/config`; reports p50/p95/p99, error rate, cache-hit ratio. Results are labelled **local, non-staging**; they never satisfy the server budgets in `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md`, which need a staging-class environment (not available in Phase 3 — reported NOT RUN).

## 5. Tier split and runtime budgets (PROPOSED; FA-16 approves emulator minutes)

| Tier | Trigger | Contents | Runtime budget |
|---|---|---|---|
| PR (required) | every PR and push to `main` / `phase-*/**` | Quality: lint/types/depcruise/knip, unit + property (500 runs), mobile vitest, openapi:check, **oasdiff**, COMPAT-N1, SDK-INV, ART-ISO · Integration: MIG-P3, GRANT-P3, TRIG-P3, ZONE-BOUNDARY, HOURS, API integration, QUOTE-TAMPER, FAULT-GEO, BUDGET/BREAKER/RL, CACHE-STALE, LOG-GEO, BOOT-NEG · Security: gitleaks (+ negative control), osv · Android: AAB-GATES · e2e-web: new web-ops journeys · **NEW e2e-mobile**: Maestro PR tier (NAV-01..03, SRCH-01, QUOTE-01, RIDER-HYGIENE-01) on API 35 | Quality growth ≤ 5 min; Integration growth ≤ 8 min (both stay inside their 40-min timeouts); Security growth ≤ 1 min; Android unchanged except the new gate (< 1 min); e2e-mobile job ≤ 60 min total with the Maestro test phase ≤ 15 min (builds its own x86_64 E2E APK with the Gradle cache, runs in parallel with the Android job, so PR wall time is not extended beyond the Android job if both fit) |
| Nightly / scheduled | proposed separate scheduled workflow (`.github/workflows/nightly.yml`, proposed; `main` only); cadence per FA-16 — the repository is private and a daily 60-min matrix alone would use ~1,800 of a 2,000-minute monthly allowance, so the recommended option is weekly + before each checkpoint merge | Maestro full matrix A–G on API 29 + API 35 (parallel) + low-RAM AVD lane; property tests at 50,000 runs; load harness; FAULT-GEO soak (randomised fault mix for 10 min) | Maestro ≤ 60 min per API level; other lanes ≤ 30 min total |
| Release (pre-merge of Phase 3 and before any store build) | manual dispatch + founder | nightly suite on the release-candidate SHA; size report; SDK inventory final; physical SP-08 subset; TalkBack walkthrough; SP-02 R2 if the renderer changed | physical subset ≈ 2 h per device |
| Manual-device / field | founder schedule | SP-01 (≈ 15–17 h active / 21–26 h wall-clock across 3 freeze devices), SP-02 (≈ 7.5–9 h for setup + R1a + R1b + R2), SP-04 (4 sessions: S1–S3 2–3 h, S4 ≈ 2 h, + ≈ 2–3 h desk work) | per protocol |

Notes: making e2e-mobile a **required** check is a ruleset change (founder action; note the Phase-2 finding about required-check name truncation in ruleset 24837051 — use a short job name). The CI workflow has no paths filter, so docs-only PRs still run the full PR tier including Android (~30–40 min per run, 75-min timeout) and e2e-mobile; because the repository is private and Actions minutes are finite, FA-16 decides whether e2e-mobile runs only on PRs touching mobile paths.

## 6. CI changes (PROPOSED, implemented in Phase 3, none now)

| Change | Job | Checkpoint |
|---|---|---|
| intent-filter / exported-component gate + negative controls | android | P3.0 |
| oasdiff breaking-change gate (pinned, checksum-verified binary) | quality | P3.0 |
| gitleaks key-format negative control | security | P3.0 |
| new migrations in the existing migrate + prefix tests | integration | P3.1–P3.4 |
| ART-ISO / BOOT-NEG extensions for geo | quality / integration | P3.2 |
| SDK-INV, BUNDLE-SECRETS | quality / android | P3.5 |
| e2e-mobile job (Maestro CLI pinned and checksum-verified; emulator with KVM) | new | P3.5 |
| size gate switched from report-only to failing | android | after FA-07 |
| nightly workflow | new | P3.10 |
| F-P3-02 (stale Gradle cache / runner disk limit) — already fixed before planning by the workflow-only PR #6 (`docs/phase3/PHASE3_PLAN.md` §6); Phase 3 only keeps its disk/cache evidence green, no further change planned | android | — |

## 7. Tooling and dependency notes (for `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md`)

### 7.1 Property testing

fast-check 4.10.2 is already pinned and used in six workspaces, so server-side property tests need **no new dependency**. Mobile property needs are met by **exhaustive enumeration** in plain Vitest (the intent/restore state spaces are finite and small, which is stronger than random sampling). If a mobile or contracts-level generator is later needed (e.g. PROP-POLYLINE placed in a package without fast-check), the proposal is to add the **same pinned 4.10.2** as a devDependency of that workspace (no new package in the supply chain; syncpack keeps the version aligned) — recorded as a dependency proposal, not done now.

### 7.2 Other tools

Maestro CLI (external binary, dev/CI only; ADR-052 proposal); oasdiff (CI binary); Android emulator system images from the SDK manager (CI only). No Jest/React Native Testing Library (overlap with Vitest, ADR-052), no Semgrep, no autocannon/k6 (built-in `fetch` script suffices for Phase 3), no NetInfo. Expo/React Native upgrades are out of scope (ADR-030).

## 8. Reporting rules (CLAUDE.md §8)

Every command and suite is reported as **PASS / FAIL / NOT RUN / BLOCKED / SKIPPED** with the exact SHA and CI run URL. Emulator results are labelled "emulator" and never reported as device evidence; local load results are labelled "local, non-staging"; MOCK-double results are labelled "synthetic provider". Coverage thresholds for new packages start at the Phase-2 levels; no exclusions, skips or weakened assertions are added to make CI green. Planning-time status of every test in this document: **NOT RUN**.

## 9. Acceptance evidence per requirement (29)

"Runs": CI-PR / CI-nightly / Claude-local (during implementation, with outputs recorded) / founder (devices, field, accounts) / reviewer (FA-09) / tester (FA-14).

| ID | Families and concrete tests | Evidence artefact | Runs | Remains external at closure |
|---|---|---|---|---|
| A01 | UNIT-POLICY table; API-CFG-01..06 (426 on non-exempt routes, exempt routes under HARD_UPDATE/MAINTENANCE, 503 envelope, MC + step-up + audit); CON-ERR for WAYVRO_E_APP_UPDATE_REQUIRED / WAYVRO_E_MAINTENANCE; Maestro UPD-01/02, MAINT-01 | CI logs + Maestro report artefact | CI-PR, CI-nightly | store link (EG-18) |
| A06 | PROP-NORM; alias resolution integration (`geo.landmark_aliases`); catalogue completeness; Maestro SRCH-03 (Roman-Urdu alias) and RTL-01 | CI logs; review package export | CI-PR, CI-nightly, reviewer | FA-09 sign-off; SP-04 Roman-Urdu top-5 metric |
| A07 | UNIT-LOCPERM (all transitions incl. approximate, revoked); Maestro LOC-01..05; AAB permission gate showing the FA-02 set only | CI logs; manifest gate report | CI-PR, CI-nightly, founder (SP-01) | SP-01 background parameters (ADR-029); FA-02 |
| A08 | A11Y-TOKENS; A11Y-PRIM; A11Y-01 (200 %); A11Y-LABELS; A11Y-MAP; axe for web-ops; A11Y-DEVICE TalkBack walkthrough | CI logs; signed walkthrough record | CI-PR, CI-nightly, founder/tester | physical TalkBack record; VoiceOver NOT RUN (FA-13) |
| B01 | UNIT-FMT; reverse-geocode integration + FG-06/07; RL reverse; Maestro PIN-01..03; BUNDLE-SECRETS; after P3.7 renderer adapter contract test | CI logs; SP-02 R2 report | CI-PR, CI-nightly, founder | renderer freeze (ADR-046, SP-04 + SP-02); provider licence |
| B02 | UNIT-PLACEREF; autocomplete/resolve/reverse integration; CS-03/CS-07; BUD-02 degrade shape; mobile debounce/cancel tests; Maestro SRCH-01..04 | CI logs; SP-04 metric table | CI-PR, CI-nightly, founder + Claude (SP-04) | Lahore field accuracy, ADR-006 per SKU |
| B03 | PROP-POLYLINE; CON-GEO; route snapshot contract; FG-01..06 (no invented ETA); Lite payload test; confidence-label view-state tests | CI logs; SP-04 route/ETA table | CI-PR, founder + Claude (SP-04) | route/ETA accuracy (SP-04); rendered polyline after P3.7 |
| B04 | product attribute contract tests; QT-09 (DISABLED_LEGAL_GATE never priced); static scan (no client seat/luggage constants); Maestro QUOTE-01 | CI logs; Maestro report | CI-PR | none for engineering (synthetic values by design) |
| B06 | UNIT-QUOTE; PROP-QUOTE (Σ = total, ≥ 0, determinism, rounding bound); TRIG-P3 Σ deferred trigger; component-kind contract; breakdown view-state tests; Maestro QUOTE-01/02 | CI logs | CI-PR, CI-nightly | none for engineering |
| E05 | PROP-MONEY; PROP-QUOTE; QT-14 snapshot after newer card; TRIG-P3 immutability; tax inclusive/exclusive tests; placeholder-tax activation refusal | CI logs | CI-PR, CI-nightly | accountant review (FA-15, pilot) |
| E06 | port contract suite on MOCK doubles; CON-GEO (opaque providerKey, no leak); ART-ISO + BOOT-NEG geo; depcruise fixtures; candidate adapters against real providers locally with founder keys | CI logs; Claude-local run record (NOT RUN in CI) | CI-PR, Claude-local, founder (keys) | ADR-006 freeze + licence (P3.7) |
| E07 | CS-01..07; FG-01..10; QT refusal paths; load harness cache-hit ratio (local) | CI logs; nightly load report (local, non-staging) | CI-PR, CI-nightly | production TTLs recorded with ADR-006 |
| E08 | GEOM-01..07; ZB-01..16; HRS-01..11; PROP-HOURS; PROP-ZONE-DECISION; zone-set MC + production synthetic refusal; Playwright zone-set upload with validation report | CI logs; Playwright report | CI-PR, CI-nightly | real boundaries (FA-12) before pilot |
| H06 | TRIG-P3 MC; CONC-PRICING; rollback-as-new-version test; preview without provider call (usage counter unchanged); AUTHZ-MATRIX extension; Playwright pricing journey + axe | CI logs; Playwright report | CI-PR | second approver in operations (EG-20 precedent) |
| H10 | PROP-ELIG-VEH; eligibility-rule MC API tests; FK to `catalog.service_categories` unchanged (MIG-P3 live-row); Maestro driver-readiness step (account C) | CI logs | CI-PR, CI-nightly | EG-03 values |
| I11 | BUD-01..08; BRK-01..05; PROP-BREAKER; RL-01..04; rollup idempotency | CI logs; founder attestation of provider-console caps | CI-PR, CI-nightly, founder | console caps (FA-06); alert routing (EG-21); verified price table (P3.7) |
| K19 | state-coverage table test (every application/document status ↔ view state ↔ copy key in 3 locales); Maestro ONB-01..03; KYC regression lane | CI logs; Maestro report | CI-PR, CI-nightly, reviewer | FA-09; physical TalkBack |
| L08 | UNIT-LITE; Lite payload-size tests; Maestro LITE-01 (network shaped); quote-restore after process death (NAV-03) | CI logs; SP-02 data report | CI-PR, CI-nightly, founder (SP-02) | device data/perf (SP-02) |
| P18 | catalogue completeness + placeholder parity; hard-coded-string scan; safety/legal keys without sign-off fall back per Phase-2 rule (test); review package export | CI logs; export file | CI-PR, reviewer | FA-09; EG-02 for legal copy |
| Q26 | budget table with method per line; AAB size gate; Hermes bundle size check; local load report; SP-02 R1/R2; SP-01 battery/reconnect harness | CI size report; SP-02/SP-01 reports | CI-PR, CI-nightly, founder | device values; staging-class server numbers (no staging) |
| Q27 | low-RAM AVD nightly lane (emulator-labelled); SP-01 OEM runs; SP-02 constrained storage/network runs | device reports | CI-nightly, founder | physical devices (cannot be satisfied by CI) |
| Q31 | COMPAT-N1; OASDIFF; UNIT-POLICY; API-CFG blocked-build cases; matrix and deprecation policy in ADR-049 | CI logs; ADR-049 | CI-PR | founder minimum-OS decision (F-P3-10) |
| R28 | TRIG-P3 lifecycle (ENABLED refused for gated class / null legal basis / synthetic in production); QT-09 BIKE/RICKSHAW in `unavailable[]`; static scan (no product-code UI switches) | CI logs | CI-PR | FA-11; legal activation outside Phase 3 |
| U04 | SDK-INV gate; BUNDLE-SECRETS; inventory entries for expo-location and the renderer; iOS privacy-manifest draft (iOS build NOT RUN) | inventory doc + CI gate log | CI-PR, Claude-local | renderer entry until P3.7; store declarations (EG-18) |
| U05 | AAB-GATES (permissions + NEW intent-filter gate with negative controls); architecture-test bans; permission review table | Android gate reports | CI-PR | SP-01 background justification (Phase 4 request) |
| V05 | RIDER-HYGIENE-01 (A, B); static rider-graph import scan; UNIT-LOCPERM recovery paths; manifest gate; SP-01 rider-hygiene check on the real release AAB | Maestro report; SP-01 report | CI-PR, CI-nightly, founder | SP-01 physical OEM evidence |
| V08 | EXH-INTENT; EXH-RESTORE; ModeController tests; URL-length bound + malformed-encoding fuzz; Maestro NAV-01..06; intent-filter gate (no external scheme) | CI logs; Maestro report | CI-PR, CI-nightly | external deep links out of scope (EG-15 + decode-uri-component gate) |
| V10 | e2e-mobile PR tier green; nightly matrix report (A–G, API 29 + 35); cross-mode lanes §4.19; mode-scoped switch tests; Phase-2 suites still required | CI + nightly artefacts | CI-PR, CI-nightly, founder (physical subset) | physical subset; release-blocking enforcement from Phase 4 |
| V11 | depcruise rule (rider graph ↛ driver features); E2E-build module-evaluation probe = 0 driver modules after rider cold start; AAB size gate; SP-02 R1/R2 cold/warm start and PSS | CI logs; SP-02 reports | CI-PR, CI-nightly, founder | device-measured budgets (SP-02); battery (SP-01) |
