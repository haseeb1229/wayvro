# PHASE3_ARCHITECTURE — Catalog, geo gateway, pricing, release controls and unified-app shell (PROPOSED)
**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — founder/ChatGPT plan review recorded 2026-10-12 (FA decisions in `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` §1a); no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

Companion documents: `docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md` (tables, migrations), `docs/phase3/PHASE3_PRICING_QUOTE_MODEL.md` (quote algorithm, contracts), `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md` (vendors, SP-04), `docs/phase3/PHASE3_MOBILE_UX_AND_NAVIGATION.md`, `docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md`, `docs/phase3/PHASE3_SECURITY_COST_THREAT_MODEL.md`, `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md`. Authority: `CLAUDE.md` §2–§13, `docs/28_APP_SURFACES_AND_REPO_TOPOLOGY.md`, `docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md` §2–§7, ADR-042 (PostgreSQL jobs), ADR-045 (test-double isolation), ADR-043 (mobile platform additions).

Every interface, name, endpoint, environment variable and number in this document is **PROPOSED** unless marked otherwise. Nothing here is implemented.

## 0. Repository truth this design starts from (verified 2026-10-12 at `6aed6a4`)

| Fact | Where | Consequence for Phase 3 |
|---|---|---|
| `ProviderPorts` = objectStorage, malwareScanner, imageSanitiser, otpDelivery, pushNotification, oidcKeys; `bindProviders()` refuses MOCK-branded doubles outside local/test; unbound port ⇒ 503 `WAYVRO_E_DEPENDENCY_UNAVAILABLE` | `packages/provider-interfaces/src/ports.ts`, `binding.ts` | geo ports are added additively to the same registry and inherit the binding guard |
| `RateLimiter` (Valkey Lua, atomic multi-rule consume/peek/hit, `LimiterUnavailableError`), request-path Redis client with 250 ms command timeout | `packages/server-runtime/src/rate-limiter.ts` | reused for geo/quote limits, budgets and usage counters; no new limiter |
| OTP budget precedent: Valkey day/month counters, log signals at 50/80/100 %, 503 at exhaustion, FAIL CLOSED when the limiter is unavailable | `apps/api/src/identity/otp-abuse.ts` | geo cost controls copy the pattern (F-P3-05) |
| Field encryption: AES-256-GCM envelope v1, AAD = field descriptor + row UUID + field-schema version + key id; key classes are an additive code list; staging/production key ring refused until KMS (EG-05) | `packages/field-crypto/src/envelope.ts`, `cipher.ts`, `provider.ts` | `placeRef` tokens reuse the envelope (§7) with a new key class; inherits the EG-05 gate |
| Persistent idempotency: `(actor scope, key)` PK, request hash, AEAD-encrypted response, same key + different body ⇒ 409 `WAYVRO_E_IDEMPOTENCY_CONFLICT` | `apps/api/src/platform/idempotency.ts` | `POST /v1/quotes` uses it unchanged |
| Request logging records the **route template** (`routeOptions.url`), never the raw URL | `apps/api/src/http/hooks.ts` | GET geo endpoints carry search text/coordinates in the query string; our logs stay clean, other hops need explicit scrubbing (§5.1) |
| Redaction: key-based (lat/lng/coordinates/geo/address …) + value-based (precise coordinate pairs) | `packages/observability/src/redaction.ts` | extended additively for `polyline`, `placeRef`, search text keys (§10) |
| No metrics SDK; OTel traces only; alerts are structured log signals | `packages/observability` | no new metrics stack (F-P3-05) |
| Jobs: `platform.jobs` SKIP LOCKED + `RecurringScheduler` with dedupe key; `maintenance.purge` batch job | `apps/worker/src/scheduler.ts`, `maintenance.ts` | new recurring jobs + purge extension (§3.4) |
| Code-only `FLAG_REGISTRY`, no runtime override | `packages/config/src/flags.ts` | runtime switches are a NEW DB-backed mechanism (§9), the flag registry stays |
| Staff roles are code-defined, but `staff.role_assignments.role` has a **DB CHECK listing the 7 Phase-2 roles** | `packages/db/migrations/0003_staff_realm.sql` | the FA-10-approved roles (PRICING_MANAGER, CATALOG_MANAGER, RELEASE_MANAGER) need the **required** expand-safe CHECK widening in 0010 (see data-model doc §6) |
| Import boundaries: depcruise `no-client-to-server-workspace`, `no-rider-driver-coupling`; eslint-plugin-boundaries element types incl. `mobile-feature-rider/driver` | `.dependency-cruiser.cjs`, `eslint.config.mjs` | extended in §4 |
| Mobile architecture test bans expo-location, expo-notifications, expo-task-manager, expo-background-fetch, react-native-maps, expo-media-library imports | `apps/wayvro-mobile/src/architecture.test.ts` | replaced by a narrower allowlist rule (§4), not deleted |

## 1. Bounded contexts and ownership

| Context | Schema | Owner module (proposed) | Owns | Writes | Reads from others |
|---|---|---|---|---|---|
| Catalog & Geo Zones | `catalog` (existing; extended) | `apps/api/src/catalog/` | service products, city enablement, zone sets/zones/pickup points/service hours, vehicle eligibility rules, district geometry column | only its own tables | `catalog.service_categories` (same context), `staff` principals |
| Geo Routing | `geo` (new) | `apps/api/src/geo/` (gateway) + `packages/geo-adapters` (vendors) | provider budgets, hourly usage rollups, landmark aliases; Valkey cache/counters | only `geo.*` + Valkey keys `wv:geo:*` / limiter keys | ACTIVE runtime switches (platform) |
| Pricing & Quotes | `pricing` (new) | `apps/api/src/pricing/` | tax policies, rate cards + components, quotes + components, route snapshots | only `pricing.*` | catalog read model (products, zone set, hours, pickup points), geo gateway (routing) through a module API |
| Platform release controls | `platform` (existing; extended) | `apps/api/src/platform/release/` | app version policies (+ blocked build ranges), runtime switches (+ change history) | only its own new tables | — |
| Identity/Profile/Compliance (Phase 2) | `identity`, `profile`, `compliance` | unchanged | — | unchanged | catalog products (additive read for driver readiness display) |
| Mobile shell | — | `apps/wayvro-mobile` | mode preference (hint), navigation graphs, intent router, permission state | none server-side | contracts only |

Rules (unchanged from Phase 0 §2): no cross-context table writes; cross-context reads go through a module service interface inside the monolith (e.g. `CatalogReadModel.resolveForQuote(city, point, at)`), never through another module's SQL. The pricing engine is **pure** and server-only (`apps/api/src/pricing/engine.ts`, proposed), following the Phase-2 precedent that authoritative eligibility logic never lives in a client-importable package (`apps/api/src/compliance/eligibility.ts`). `packages/domain` keeps only value objects (`Money`, coordinates value object, polyline codec).

## 2. Component diagram

```text
                         ┌───────────────────────────── apps/wayvro-mobile (ONE app) ─────────────────────────────┐
                         │ src/app/(session)/ride/*  eager    src/app/(session)/drive/*  lazy (+ earn/*)   /home hub │
                         │ src/core/mode (ModeController)  src/core/api (typed client, zod)  src/core/config         │
                         │ src/platform/maps  ── ONE renderer adapter file ──► map SDK (tiles/style only; P3.7)     │
                         │ src/platform/location ── expo-location (when-in-use only; FA-02)                        │
                         └───────────────┬───────────────────────────────────────────────────────┬────────────────┘
                                         │ HTTPS /v1 (+ X-Wayvro-Platform/App-Version/App-Build)  │ tiles/style (renderer only;
                                         ▼                                                        ▼  URL/token from app config)
┌──────────────────────────────────────── apps/api (modular monolith) ─────────────────────────┐   ┌──────────────────────┐
│ http hooks: request id · idempotency-key shape · app-version gate (426) · maintenance (503)  │   │ tile/style host of   │
│ ┌──────────────┐ ┌─────────────────────────── geo gateway ──────────────────────────────┐   │   │ the licence-coherent │
│ │ catalog      │ │ normalise → authz → rate limit → cache → budget → breaker → adapter    │   │   │ bundle (S1/S2/S3)    │
│ │ module       │ │ (timeout) → normalise → cache write → meter                            │   │   └──────────────────────┘
│ └──────┬───────┘ └───────┬───────────────────────┬───────────────────────────┬────────────┘   │
│        │ read model      │ GeoPorts (provider-interfaces, vendor-neutral)     │ Valkey        │
│ ┌──────▼───────┐ ┌───────▼────────────┐           │                           │ (cache, rate, │
│ │ pricing      │ │ ProviderRegistry   │           │                           │  budgets,     │
│ │ module +     ├─► (bindProviders +   │           │                           │  usage, breaker│
│ │ pure engine  │ │  GeoBundle check)  │           │                           │  hints)       │
│ └──────┬───────┘ └───────┬────────────┘           │                           │ never         │
│ ┌──────▼───────┐         │                        │                           │ authoritative │
│ │ release      │         │                        │                           │               │
│ │ controls     │         │                        │                           │               │
│ └──────────────┘         │                        │                           │               │
└───────┬──────────────────┼────────────────────────┼───────────────────────────┼───────────────┘
        │ SQL (wayvro_api) │ server-only            │                           │
        ▼                  ▼                        ▼                           ▼
┌─────────────────────────────┐   ┌──────────────────────────────────┐   ┌───────────────────────┐
│ PostgreSQL 17 + PostGIS 3.5 │   │ packages/geo-adapters (server)   │   │ Valkey (ADR-037)      │
│ catalog · pricing · geo ·   │   │ one adapter per (vendor, SKU),   │   │ wv:rl:* limiter keys  │
│ platform · audit · identity │   │ licence declaration per adapter  │   │ wv:geo:* cache keys   │
│ (+ compliance, staff …)     │   └───────────────┬──────────────────┘   └───────────────────────┘
└──────────────┬──────────────┘                   │ HTTPS, server keys (never on device)
               │                                  ▼
┌──────────────▼──────────────┐   ┌──────────────────────────────────┐
│ apps/worker (ADR-042 jobs)  │   │ geo providers (SP-04 decides):   │
│ geo.usage-rollup (hourly)   │   │ autocomplete · geocode · reverse │
│ config.scheduled-activation │   │ · routing (no matrix in Phase 3) │
│ maintenance.purge (+quotes) │   └──────────────────────────────────┘
│ outbox relay (existing)     │
└─────────────────────────────┘   apps/web-ops (staff BFF, WebAuthn) ──► apps/api staff routes (RBAC/ABAC, step-up, maker-checker)
```

Test doubles (`@wayvro/provider-test-doubles`, dev-only, MOCK-branded) replace `packages/geo-adapters` in local/test compositions only; ART-ISO (`scripts/artifact-isolation.mjs`) keeps them out of deployable artefacts (ADR-045).

## 3. Package and module layout (proposed additions only)

### 3.1 Packages

| Path (proposed) | Kind | Contents | Importable by |
|---|---|---|---|
| `packages/provider-interfaces/src/geo-ports.ts` | server-only (existing package) | `PlacesAutocompletePort`, `GeocodingPort`, `ReverseGeocodingPort`, `RoutingPort`, `GeoSourceMeta`, `GeoAdapterLicence`, normalised result types; `ProviderPorts` gains 4 optional keys | api, worker, geo-adapters, test doubles |
| `packages/geo-adapters` (NEW) | server-only, production | one adapter module per (vendor, SKU) after SP-04 + ADR-006 freeze; request signing/keys; response normalisation; licence declarations; per-adapter price table (micro-USD per call) | api composition root, dev-only SP-04 harness |
| `packages/provider-test-doubles/src/geo.ts` | dev-only (existing package) | deterministic synthetic doubles (fixed gazetteer of synthetic places; straight-line × 1.3 detour distance, 25 km/h synthetic speed) — MOCK-branded, refused outside local/test | tests, local composition |
| `packages/server-runtime/src/circuit-breaker.ts` | server-only (existing package) | in-house breaker (no opossum), §5.4 | api |
| `packages/domain/src/geo.ts` | shared value objects | `Coordinates` (WGS84 range check, 6-decimal normalisation), polyline encode/decode (~40 lines, in-house), coarse-cell helper | api, mobile |
| `packages/contracts/src/catalog.ts` | contracts | product/city-product/zone-set/eligibility DTOs (consumer + staff) | all |
| `packages/contracts/src/geo.ts` | contracts | autocomplete/geocode/reverse/place-resolve request/response, `GeoSource`, `placeRef` shape | all |
| `packages/contracts/src/pricing.ts` | contracts | quote request/response, components, staff rate-card/tax-policy/preview DTOs | all |
| `packages/contracts/src/app-config.ts` | contracts | app config response, app-version/maintenance states, client header schemas, runtime switch DTOs | all |
| `packages/config/src/runtime-switches.ts` | server-only (existing package) | code registry of runtime switch keys (owner, safe state, allowed scopes, requirement IDs, per-env default) | api, worker |

`packages/geo-adapters` is added to `SERVER_ONLY_WORKSPACE` (depcruise) and `SERVER_ONLY_PACKAGES` (eslint) in the same change that creates it (§4).

### 3.2 apps/api modules

| Module (proposed) | Responsibilities | Routes (consumer) | Routes (staff) |
|---|---|---|---|
| `src/catalog/` | read model for products/zones/hours/pickup points; zone-set + eligibility maker-checker; city-product lifecycle; pure zone-decision, service-hours and vehicle-eligibility evaluators (H10) — authoritative server code, never in the client-importable `packages/domain` | `GET /v1/catalog/products?cityCode=` (session; ENABLED products with display attributes, no pricing) | `/v1/admin/catalog/*` |
| `src/geo/` | gateway pipeline, placeRef sealing, Lahore address formatter, landmark alias expansion, usage meter, budget enforcement | `GET /v1/geo/autocomplete`, `GET /v1/geo/places/{placeRef}`, `GET /v1/geo/reverse` | `/v1/admin/geo/budgets*`, `/v1/admin/geo/usage`, `/v1/admin/geo/landmark-aliases*` |
| `src/pricing/` | quote service (transaction, idempotency, supersede), pure engine, rate-card/tax-policy maker-checker, preview | `POST /v1/quotes`, `GET /v1/quotes/{quoteGroupId}` | `/v1/admin/pricing/*` (rate cards, tax policies, previews) |
| `src/platform/release/` | app-config assembly, version policy evaluation, header gate hook, maintenance hook, runtime switch store + cache | `GET /v1/app/config` (public) | `/v1/admin/release/*`, `/v1/admin/switches/*` |
| `src/identity/account.service.ts` (existing) | additive `AccountState.modes` derivation (pure, from existing driver/restriction facts) | `GET /v1/account/state` (existing, additive field) | — |

Staff routes keep the existing `/v1/admin/*` prefix used by every Phase-2 staff route (e.g. `/v1/admin/requirement-sets`); the sub-paths above are proposed names.

### 3.3 apps/web-ops pages (proposed)

`src/app/catalog/` (products, city enablement, eligibility rules), `src/app/zones/` (zone-set drafts with GeoJSON import + read-only map preview **only after the renderer freeze**; until then a geometry summary table + validation report), `src/app/pricing/` (tax policies, rate cards, diff view, preview), `src/app/geo-usage/` (budgets, hourly usage, breaker state), `src/app/release/` (version policies, runtime switches, maintenance). All go through the existing BFF (`src/bff/proxy.ts`) — no direct API calls from the browser, no new auth path.

### 3.4 apps/worker jobs (proposed)

| Job type (`platform.jobs.type`) | Trigger | Work | Idempotency |
|---|---|---|---|
| `geo.usage-rollup` | recurring, every 15 min | for each completed hour still in Valkey (keys kept 48 h), upsert absolute counter values into `geo.provider_usage`; log `GEO_USAGE_GAP` when an hour's keys are missing | recomputed from the same counters ⇒ upsert of identical values |
| `config.scheduled-activation` | recurring, every 1 min | APPROVED rate cards / zone sets / eligibility rules / app version policies whose `effective_from <= now()` and that were scheduled: same transaction as staff activation (retire previous ACTIVE, activate, audit `actor_type=SYSTEM`, outbox event); re-checks every activation rule at run time (production refusal of synthetic/placeholder, legal gate) | advisory lock per (kind, scope) + status CAS (`WHERE status='APPROVED'`) |
| `maintenance.purge` (extension of the existing job) | existing schedule | mark `PRICED` quotes past `expires_at` as `EXPIRED` (bounded batch); delete quotes + components + unreferenced route snapshots older than `QUOTE_RETENTION_DAYS` (placeholder 30, NOT_COUNSEL_APPROVED until EG-16) | bounded batches, delete-by-ctid pattern as today |
| outbox relay (existing) | existing | relays new event types `catalog.zone-set.activated.v1`, `pricing.rate-card.activated.v1`, `platform.runtime-switch.changed.v1`, `platform.app-policy.activated.v1` (ids/codes only) | existing processed-events table |

No job calls a geo provider in Phase 3 (no pre-warming, no batch geocoding).

### 3.5 apps/wayvro-mobile (proposed; detail in PHASE3_MOBILE_UX_AND_NAVIGATION)

| Path | Contents |
|---|---|
| `src/core/mode/` | `ModeController`, `ModePreference` persistence (secure-store key `wayvro.mode-preference.v1`), pure `resolveEntry(accountState, preference)` |
| `src/core/intents/` | pure `resolveIntent(intent, accountState, mode)` router (allowlisted intent types) |
| `src/core/release/` | app-config fetch, version/maintenance state machine, header injection into the existing API client |
| `src/platform/maps/` | renderer-neutral `MapView` interface + exactly ONE adapter file importing the chosen SDK (P3.7); text-first fallback component |
| `src/platform/location/` | when-in-use permission state machine, one-shot fix, focused-screen watch; no background code |
| `src/app/(session)/ride/*` | thin rider route files (URL segment `/ride/*`, eager) |
| `src/app/(session)/drive/*` | thin driver route files (URL segment `/drive/*`, lazy via `lazyScreen`); existing `earn/*` routes retained; `/home` stays the shared account hub |
| `src/features/rider/home`, `search`, `pin`, `quote` | rider graph screens + view-state adapters |
| `src/features/driver/home` | driver home/readiness shell (lazy) |

Note: the mobile app already has `src/core/platform/` (crypto, ids). The new top-level `src/platform/` follows the Phase-0 layout (`docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md` §3) for device/vendor adapters; `src/core/platform/` is unchanged. If reviewers prefer one location, the alternative is `src/core/platform/{maps,location}` — naming only, no design impact.

## 4. Import-boundary rule additions (proposed; enforced in CI by depcruise + eslint-plugin-boundaries)

| Rule | Tool | From | To (forbidden) | Why |
|---|---|---|---|---|
| geo adapters are server-only | depcruise `no-client-to-server-workspace` (regex extended) + eslint `SERVER_ONLY_PACKAGES` | `apps/(wayvro-mobile|web-public|web-ops)/` | `packages/geo-adapters/`, `@wayvro/geo-adapters` | server keys, provider terms, quota control |
| only the composition root binds adapters | depcruise `geo-adapters-composition-only` | `apps/api/src/` except `composition.ts` / `app.ts`; `apps/worker/src/` | `packages/geo-adapters/` | modules depend on ports, never vendors (mirrors `vault-module-boundary`) |
| vendor HTTP shapes stay inside adapters | eslint `no-restricted-imports` | `apps/api/src/(geo|pricing|catalog)/` | any vendor SDK/npm module (list maintained with ADR-006) | CLAUDE.md §4 |
| rider/driver isolation (existing, extended) | depcruise `no-rider-driver-coupling` + eslint elements | `src/features/rider/**` ↔ `src/features/driver/**`; new `src/app/(session)/ride/**` ↔ `src/app/(session)/drive/**` | each other | V08/V11; shared code only via `src/core`, `src/platform`, `contracts`, `domain` |
| rider graph never evaluates driver modules at startup | architecture test (vitest) + SP-02 instrumentation | `src/app/(session)/ride/**`, `src/core/**` | static imports of `src/features/driver/**` (only `lazyScreen(() => import())`) | F-P3-07: deferred evaluation, not split download |
| one map SDK file | eslint `no-restricted-imports` + architecture test | every mobile file except `src/platform/maps/<renderer>-adapter.tsx` (one file) | the chosen map SDK module | renderer swap = one file + config (ADR-046) |
| location module confinement | architecture test (replaces the blanket expo-location ban with an allowlist) | every mobile file except `src/platform/location/**` | `expo-location` | permission requests happen in one audited place |
| still banned in Phase 3 | existing architecture test (kept) | whole app | `expo-task-manager`, `expo-background-fetch`, `expo-notifications`, `expo-media-library` | no background location/FGS/push in the shipped app (V05/U05) |
| pricing engine purity | depcruise | `apps/api/src/pricing/engine.ts` | `pg`, `ioredis`, any `geo`/`catalog` module file, `node:crypto` | deterministic, property-testable |

The existing `react-native-maps` ban becomes "allowed only in the single renderer adapter file, and only if ADR-046 selects it"; until then the ban stays as is.

## 5. Geo gateway

### 5.1 Endpoints (consumer; all require a session — no pre-sign-in geo access)

| Operation | Method/path (lead decision) | Query/params (summary) | Response (summary) |
|---|---|---|---|
| Autocomplete | `GET /v1/geo/autocomplete` | `cityCode`, `q` (3..80 chars), `locale`, `session` (uuid per search field), optional `bias` (server coarsens to 2 decimals), optional `mode=GEOCODE` | `{suggestions:[{placeRef, primaryText, secondaryText, kind}], source: GeoSource}` (max 5) |
| Resolve place | `GET /v1/geo/places/{placeRef}` | `session`, `locale` | `{point{lat,lng}, primaryText, secondaryText, districtCode|null, source}` |
| Reverse geocode | `GET /v1/geo/reverse` | `cityCode`, `lat`, `lng`, `locale` (server rounds to 4 decimals — the cache-key precision, within the ≤ 5-decimal privacy cap — and sends that rounded point to the provider, so a cached value always matches its key; threat model T3-10) | `{primaryText, secondaryText, landmarkText|null, inServiceArea, source}` |
| Quote | `POST /v1/quotes`, `GET /v1/quotes/{quoteGroupId}` | see PHASE3_PRICING_QUOTE_MODEL | — |

Geo reads are GET (no state change, no Idempotency-Key), session-only, `Cache-Control: no-store`. Because search text and coordinates then sit in the query string, three mitigations are **required and test-enforced**: (a) API request logs keep using the route template only (existing hook; a test asserts no query string in any log record for geo routes); (b) OTel HTTP instrumentation is configured to drop `url.query` / `url.full` for `/v1/geo/*` (span attribute test); (c) the reverse proxy / CDN access-log format in the deployment runbook omits query strings for `/v1/geo/*` (deployment checklist item, EXTERNAL until hosting exists). Forward geocoding ("type the full address" fallback when autocomplete is degraded) is `GET /v1/geo/autocomplete?mode=GEOCODE` — one client search path, a different adapter call and SKU meter.

### 5.2 Pipeline (every geo call, in this order)

| Step | Behaviour | Failure ⇒ |
|---|---|---|
| 1 normalise | zod contract validation; Unicode NFKC, whitespace collapse, case-fold for Latin script, Urdu script kept; landmark alias expansion (`geo.landmark_aliases`, ACTIVE, per city/locale); coordinates range + Pakistan bbox (lat 23.5–37.2, lng 60.8–77.9, coarse) | 400 `WAYVRO_E_VALIDATION` |
| 2 authz | session required; account not under an ACCOUNT-scope restriction that blocks rider use (existing `blocksRiderUse`); runtime switch for the SKU not DISABLED; `cityCode` ENABLED | 401 / 403 `WAYVRO_E_ACCOUNT_RESTRICTED` / 503 `WAYVRO_E_FEATURE_DISABLED` |
| 3 rate limit | `RateLimiter.consume` per account (+ per IP prefix for quotes); keys `geo:ac:m:<acct>` etc. | 429 `WAYVRO_E_RATE_LIMITED` (`retryAfterSeconds`); limiter unavailable ⇒ 503 (fail closed, §8) |
| 4 cache lookup | Valkey GET of `wv:geo:<providerKey>:<sku>:v1:<HMAC(normalised key)>` (provider-namespaced, threat model T3-12) — every text- or coordinate-derived key is a keyed HMAC (existing `KeyedHasher`; a dedicated key class `geo_cache` proposed, ADR-047 decision, recommended) so a Valkey dump reveals neither search text nor locations; TTL = min(adapter terms TTL, configured maximum) | miss ⇒ continue; Valkey error ⇒ fail closed (cache and limiter share the dependency) |
| 5 budget | `consume` on day + month call counters and month cost counter (micro-USD, adapter price table) per (providerKey, sku) against the ACTIVE `geo.provider_budgets` row (cached 60 s); signals at 50/80/100 % | 503 `WAYVRO_E_DEPENDENCY_UNAVAILABLE`, `details.reasonCodes:["GEO_BUDGET_EXHAUSTED"]`; client switches to manual fallback |
| 6 breaker | per (providerKey, sku) state CLOSED/OPEN/HALF_OPEN (§5.4) | OPEN ⇒ 503 `reasonCodes:["GEO_PROVIDER_UNAVAILABLE"]` without calling |
| 7 adapter call | timeout per SKU (§12), bounded by the request deadline (§5.4a); autocomplete/geocode/place-resolve/reverse: at most 1 retry, on a connect error only and only if the remaining deadline ≥ the SKU timeout (never on timeout or 5xx); routing inside `POST /v1/quotes`: single attempt, no retry; no retry storms; provider sees only the Wayvro server IP, the query and coarse bias — never account id, phone, installation id | timeout/error ⇒ breaker records failure ⇒ stale-serve if allowed (§5.3) else 503 |
| 8 normalise | provider response → Wayvro types (Lahore formatter §5.5); provider ids sealed into `placeRef` (§7); provider-specific fields dropped | adapter normalisation error ⇒ treated as provider error |
| 9 cache write | only when the adapter's licence declaration permits caching for that result class; `sharedAcrossUsers` respected | write failure ⇒ logged, response still returned |
| 10 meter | `hit` on hourly usage counters (calls, cache hits, errors, timeouts, budget refusals, est. cost); OTel span attributes (providerKey, sku, cacheStatus, outcome, latency) — never text or coordinates | best-effort, logged |

### 5.3 Cache policy — configured values are MAXIMA; adapters declare terms-derived TTLs

| Result class | Configured maximum | Key | Terms-derived TTL examples (web-verified 2026-10-12; re-verify at SP-04 freeze, see PHASE3_GEO_PROVIDER_EVALUATION) | Stale-serve |
|---|---|---|---|---|
| Autocomplete predictions | 24 h | normalised text + locale + coarse bias cell (2 decimals, ~1.1 km) + providerKey | Google Places predictions: TTL 0 unless the terms permit; Mapbox temporary results: TTL 0; self-hosted open stack: up to the maximum | only if TTL > 0: ≤ 2 × TTL, flagged `STALE_SERVED` |
| Forward geocode | 7 days | normalised text + locale + providerKey | Google lat/lng: ≤ 30 consecutive days and only as the temporary cache (cross-user sharing beyond that rule not allowed; per-user indefinite caching not used by Wayvro); Mapbox temporary: TTL 0 (permanent geocoding is a separate paid SKU); open stack: up to the maximum | no |
| Reverse geocode | 7 days | point rounded to 4 decimals (~11 m) + locale + providerKey | same rules as forward geocode per vendor | only if TTL > 0: ≤ 2 × TTL |
| Route | 10 min | origin/destination rounded to 4 decimals (the rounded points are what the provider receives) + routing profile + 15-min time bucket + providerKey | Google: TTL **0** until the Routes route-caching terms are read at P3.7 (CONTRACTUAL); Mapbox: 0 until verified; open stack: up to the maximum; never longer than 10 min | **never** for a route used in a new quote |
| Place resolve | 7 days | provider place id + providerKey | Google place_id storable indefinitely, but the resolved lat/lng follows the 30-day rule | no |

`placeRef` tokens are not a cache (they carry an id, not content). Raw provider responses are never persisted in PostgreSQL. `pricing.route_snapshots` keeps the Wayvro-derived `distance_m`/`duration_s` used for pricing for the 30-day quote retention; its simplified polyline is stored only when the geometry is open-licensed (S3) or the bound vendor's terms permit storing it. Storing Google or Mapbox route geometry in a 30-day snapshot is a **COUNSEL/terms item** decided at the SP-04 freeze (P3.7); until then the geometry TTL is the terms-derived one (polyline NULL at insert when that TTL is 0, otherwise nulled by the purge job when it ends; numbers stay).

### 5.4a Deadlines and deadline-aware retries (PROPOSED, ADR-047)

| Path | Deadline | Provider attempts |
|---|---|---|
| `POST /v1/quotes` | overall server-side deadline `QUOTE_DEADLINE_MS` = 3,000 ms from request receipt; exceeded ⇒ 503 `WAYVRO_E_DEPENDENCY_UNAVAILABLE` `ROUTING_UNAVAILABLE`, nothing persisted | routing: **one** attempt, timeout = min(`GEO_ROUTE_TIMEOUT_MS` 2,500 ms, remaining deadline); never retried |
| autocomplete, forward geocode / place resolve, reverse geocode | per request: SKU timeout + `GEO_RETRY_SLACK_MS` (500 ms) | at most 1 retry, on a connect error only, and only if the remaining deadline ≥ the SKU timeout (so only a connect failure inside the first 500 ms is retried) |

The `POST /v1/quotes` latency budget (p95 ≤ 800 ms, p99 ≤ 1,500 ms on a route-cache miss, `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md` PB-20) is measured over successful quotes on the cache-miss path with a single provider attempt; quotes refused at the timeout/deadline are counted in a separate refusal-rate budget (PROPOSED ≤ 1 % of quote requests per measurement window) and never hidden inside the latency percentile. There is therefore no retry whose duration could stack on top of the 2.5 s routing timeout.

### 5.4 Circuit breaker (in `packages/server-runtime`, no new dependency)

| Parameter | Default (PROPOSED, config) |
|---|---|
| Scope | per (providerKey, sku), per process; Valkey hint key `wv:geo:breaker:<pk>:<sku>` (OPEN-until timestamp) so other processes open quickly; Valkey is a hint only |
| Open when | ≥ 50 % failures over ≥ 20 calls in a 60 s sliding window, OR 5 consecutive timeouts |
| Open duration | 30 s, then HALF_OPEN |
| Half-open | up to 3 probe calls; all succeed ⇒ CLOSED; any failure ⇒ OPEN again |
| Counted as failure | timeout, connect error, 5xx, 429 from provider, normalisation error; NOT counted: 4xx caused by our own validated input (logged as `GEO_ADAPTER_CONTRACT_ERROR`, investigated) |
| Signals | `GEO_BREAKER_OPENED`, `GEO_BREAKER_HALF_OPEN`, `GEO_BREAKER_CLOSED` (log signals with providerKey/sku only) |

### 5.5 Lahore address formatter

Pure function in `apps/api/src/geo/address-format.ts` (proposed): from normalised components (place/landmark name, block/sector/phase, society/scheme, area, city) produce `primaryText` (landmark or "Block X, Society") and `secondaryText` (area, city); Urdu-script text only when the provider supplies it (never machine-transliterated); fallbacks never invent a landmark. Unit-tested with synthetic component fixtures; field quality judged in SP-04.

### 5.6 Sequence — autocomplete

```text
Mobile(search, debounce 300 ms, ≥3 chars)  API geo gateway                 Valkey              Adapter → Provider
  │ GET /v1/geo/autocomplete?q=…              │                              │                     │
  │──────────────────────────────────────────►│ validate, alias-expand       │                     │
  │                                           │ authz (session, switch)      │                     │
  │                                           │ consume rate rule ──────────►│ ok                  │
  │                                           │ GET cache key (HMAC) ───────►│ miss (or TTL 0)     │
  │                                           │ consume budget rules ───────►│ ok (signal @50/80)  │
  │                                           │ breaker CLOSED?              │                     │
  │                                           │ call(text, locale, cell, searchSessionId) ────────►│ timeout 1.5 s
  │                                           │◄───────────────────────────────────────── predictions
  │                                           │ normalise, seal placeRefs, format                   │
  │                                           │ SET cache (only if licence permits) ►│              │
  │                                           │ hit usage counters ─────────►│                     │
  │◄──────────────── 200 {suggestions[≤5], source{providerKey, fetchedAt, cacheStatus, confidence}}
  Degraded: 429 ⇒ client backs off; 503 (budget/breaker/switch/limiter) ⇒ client shows "type full address / drop a pin".
```

### 5.7 Sequence — reverse geocode (pin moved)

```text
Mobile(pin settles, debounce 600 ms)        API geo gateway                 Valkey              Adapter → Provider
  │ GET /v1/geo/reverse?lat=…&lng=…           │ validate, round to 4 dp      │                     │
  │──────────────────────────────────────────►│ authz, rate limit ──────────►│                     │
  │                                           │ HMAC(point@4dp) key ────────►│ hit? ⇒ return (HIT) │
  │                                           │ budget, breaker, call ───────────────────────────►│ timeout 2.0 s
  │                                           │ format landmark-first; inServiceArea from catalog read model (PostGIS)
  │◄──────────────── 200 {primaryText, secondaryText, inServiceArea, source}
  Degraded: 503 ⇒ pin stays usable; label "Pinned location (address unavailable)"; quoting still allowed (pricing uses coordinates).
```

### 5.8 Sequence — quote (route + price)

```text
Mobile                         Pricing module                         Catalog read model     Geo gateway (routing)      PostgreSQL
  │ POST /v1/quotes              │ rate limit (acct/min, acct/day, IP)   │                      │                          │
  │ Idempotency-Key ────────────►│ idempotency.execute(acct scope) ─────────────────────────────────────────────────────►│ PENDING row
  │                              │ validate coords + bbox                │                      │                          │
  │                              │ resolve ACTIVE zone set, zones, hours, pickup snap ─────────►│ PostGIS ST_Covers        │
  │                              │ products: ENABLED ∩ requested ∩ ACTIVE rate card              │                          │
  │                              │ route(pickup', dropoff, CAR, bucket) ─────────────────────────►│ cache(10 min) / budget / breaker / adapter
  │                              │◄──────────────────────────────────── RouteResult + GeoSourceMeta │ (unbound/503 ⇒ refuse)
  │                              │ engine.price(card, route, flags) per product (pure, Money)     │                          │
  │                              │ advisory lock(account); supersede older PRICED groups          │                          │
  │                              │ INSERT route_snapshot, quotes, components (one tx; deferred Σ check) ────────────────►│
  │                              │ complete idempotency record (encrypted response) ─────────────────────────────────────►│ COMMIT
  │◄──────── 201 {quoteGroupId, route, options[], unavailable[]}
  Refusals: 422 WAYVRO_E_SERVICE_AREA (reasonCodes), 503 ROUTING_UNAVAILABLE (thrown ⇒ no idempotency record ⇒ same key may retry), 429.
```

## 6. Vendor-neutral port sketches (PROPOSED TypeScript, illustrative only)

```ts
// packages/provider-interfaces/src/geo-ports.ts (proposed)
export type GeoSku = 'AUTOCOMPLETE' | 'GEOCODE' | 'REVERSE_GEOCODE' | 'PLACE_RESOLVE' | 'ROUTE';
export type GeoCacheStatus = 'HIT' | 'MISS' | 'STALE_SERVED';
export type GeoConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

/** Wayvro-normalised provenance attached to every geo result (never provider-specific). */
export interface GeoSourceMeta {
  readonly providerKey: string;          // opaque, e.g. "geo-a"; mapping to a vendor lives only in config/ADR-006
  readonly sku: GeoSku;
  readonly fetchedAt: Date;              // server time of the provider call (or of the cached call)
  readonly cacheStatus: GeoCacheStatus;
  readonly latencyMs: number;
  readonly confidence: GeoConfidence;
  readonly coverageNote: string | null;  // code, e.g. "PARTIAL_COVERAGE", "LOW_DENSITY_AREA"
  readonly attributionCode: string | null; // additive: licence attribution the client must show (e.g. "OSM_ODBL")
}

export interface GeoPoint { readonly lat: number; readonly lng: number } // WGS84, ≤ 6 decimals

export interface AutocompleteInput {
  readonly text: string; readonly locale: 'en' | 'ur' | 'ur-Latn';
  readonly biasCell: GeoPoint | null;     // already coarsened to 2 decimals by the gateway
  readonly countryCode: 'PK'; readonly searchSessionId: string; // mapped to a provider session token if supported
}
export interface PlaceCandidate {
  readonly providerPlaceId: string;      // NEVER leaves the server; sealed into a placeRef by the gateway
  readonly components: AddressComponents; readonly kind: 'LANDMARK' | 'ADDRESS' | 'AREA' | 'OTHER';
}
export interface PlacesAutocompletePort { suggest(input: AutocompleteInput): Promise<readonly PlaceCandidate[]> }
export interface GeocodingPort {
  geocode(input: { text: string; locale: string; countryCode: 'PK' }): Promise<readonly ResolvedPlace[]>;
  resolve(input: { providerPlaceId: string; searchSessionId: string; locale: string }): Promise<ResolvedPlace>;
}
export interface ReverseGeocodingPort { reverse(input: { point: GeoPoint; locale: string }): Promise<ResolvedPlace | null> }

export type RoutingProfile = 'CAR';     // TWO_WHEELER / THREE_WHEELER added only when those products can be ENABLED
export interface RouteInput { readonly origin: GeoPoint; readonly destination: GeoPoint; readonly profile: RoutingProfile; readonly departAt: Date }
export interface RouteResult {
  readonly distanceM: number;            // integer metres
  readonly durationS: number;            // integer seconds (provider ETA, traffic-aware only if the SKU is)
  readonly geometry: readonly GeoPoint[]; // simplified by the gateway before storage/response
  readonly confidence: GeoConfidence;
}
export interface RoutingPort { route(input: RouteInput): Promise<RouteResult> } // NO matrix in Phase 3 (Phase 4)

/** Licence/terms declaration each adapter exports; validated at boot (CON-P3-16). */
export interface GeoAdapterLicence {
  readonly providerKey: string; readonly sku: GeoSku;
  readonly requiresRenderer: 'google' | 'mapbox' | 'any';
  readonly maxCacheTtlSeconds: number;   // 0 = must not cache
  readonly cacheSharedAcrossUsers: boolean;
  readonly attributionCode: string | null;
  readonly microUsdPerCall: number;      // price table for budget estimation (verified at freeze)
}
```

Adapters throw on infrastructure failure (as the existing ports do); "no result" is an empty array / `null`, never a fabricated place. Ports return no provider-specific types.

### 6.1 GeoBundle — licence-coherent binding (CON-P3-16)

Web-verified terms (accessed 2026-10-12; sources and the CONTRACTUAL/TECHNICAL classification in `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md` §6.1): Google geo content (Places, Geocoding, Routes) must not be used in conjunction with a non-Google map (CONTRACTUAL — the APIs themselves do not prevent it); Mapbox geocoding results may only be used with a Mapbox map and temporary results must not be cached (CONTRACTUAL); the public Nominatim server prohibits autocomplete (CONTRACTUAL usage policy); expo-maps renders Apple Maps on iOS (TECHNICAL SDK limitation, which makes it non-S1 on iOS). The port abstraction (FD-04) is unchanged, but the **composition** binds a bundle:

| Bundle | Renderer descriptor | Geo SKUs | Notes |
|---|---|---|---|
| S1 Google | `google` on **both** platforms: react-native-maps with the Google provider (Google Maps SDK on Android and iOS). expo-maps qualifies on Android only — it renders Apple Maps on iOS, so it is **not** an S1 renderer there | Google autocomplete/geocode/reverse/routes | autocomplete/geocode/routes exceed free caps at pilot volume (cost per evaluation doc) |
| S2 Mapbox | `mapbox` (@rnmapbox/maps; end-user telemetry opt-out mandatory) | Mapbox search/geocoding/directions | temporary geocoding uncacheable |
| S3 Open | `maplibre` + hosted/self-hosted OSM tiles | self-hosted OSRM/Valhalla routing; self-hosted Photon/Nominatim geocoding | ODbL attribution; infra cost only; no public Nominatim |
| S4 Mixed | per terms | only where every vendor's terms allow use with the chosen renderer | TomTom/HERE terms not verified (NF) — counsel/vendor confirmation required |

Boot rule (proposed `assertGeoBundle(renderer, bindings)` next to `bindProviders`): every bound geo adapter's `requiresRenderer` must be `any` or equal to the configured `GEO_RENDERER_KIND`; otherwise the API refuses to start (`ProviderBindingError`, log `GEO_LICENCE_BINDING_REFUSED`). Google routing used only for pricing without display is treated as **requiring a Google renderer** unless counsel or the vendor confirms otherwise (lead decision). The bound renderer descriptor (kind, style URL, attribution codes, restricted client token if the SDK needs one) is exposed through `GET /v1/app/config`; if the compiled renderer in the installed build does not match the configured kind, the app hides the map and uses the text-first view (never shows one vendor's content on another vendor's map). Final licence review of the chosen bundle = founder + counsel (EXTERNAL).

## 7. placeRef sealing (reuses `@wayvro/field-crypto`)

| Aspect | Design |
|---|---|
| Purpose | clients never see raw provider place ids (vendor neutrality, terms, quota abuse) |
| Format | `pr1.` + base64url( tokenId (16 bytes, UUIDv7) ‖ envelope v1 ); target ≤ 400 chars; contract regex `^pr1\.[A-Za-z0-9_-]{40,512}$`; URL-path safe for `GET /v1/geo/places/{placeRef}` (logs record the route template, never the token) |
| Envelope | `FieldCipher.encrypt('place_refs', plaintext, { field: 'geo.place_refs.token', rowId: tokenId, fieldSchemaVersion: 1 })` — the existing AAD binding (field + row + schema version + key id) binds the ciphertext to its tokenId; `geo.place_refs.token` is a virtual field descriptor (no table) that satisfies the existing `<schema>.<table>.<column>` validation |
| Plaintext | canonical JSON `{v:1, pk:"geo-a", sku:"AUTOCOMPLETE", pid:"<provider place id>", acct:"<account uuid>", exp:<epoch seconds>}` |
| Validation on use | decrypt (typed `FieldDecryptionError` ⇒ 400 `reasonCodes:["PLACE_REF_INVALID"]`), `acct` = session account (else same 400 — no oracle), `exp` > server now (else `PLACE_REF_EXPIRED`), `pk` still bound (else `PLACE_REF_STALE`); client re-searches |
| Key class | NEW additive `place_refs` in `KEY_CLASSES` (`packages/field-crypto/src/cipher.ts`); `DEFAULT_LOCAL_KEY_SPEC` picks it up automatically; an explicitly configured `WAYVRO_LOCAL_KEY_SPEC` must add it (boot fails closed otherwise) |
| Staging/production | blocked exactly like every other key class until KMS custody (EG-05); no plaintext fallback, no HMAC-only shortcut |
| Nonce safety | every seal is one AES-GCM encryption under the active key: the existing per-key encryption counter (rotation trigger at 2^30) applies; at 5 suggestions × 100,000 autocomplete calls/day the trigger is ~2,100 days away — still counted |
| TTL | `GEO_PLACE_REF_TTL_SECONDS` default 900 |
| Not used for | pricing (quotes price coordinates only); persistence (placeRefs are never stored in PostgreSQL) |

## 8. Degradation matrix (no invented values anywhere — E07, CON-P3-08)

| Failure | Detection | Server behaviour | Client behaviour | Never |
|---|---|---|---|---|
| Map tiles/style down | renderer error events | none (server unaffected) | text-first route summary (Lite layout), pin via search or last confirmed point, banner "Map unavailable" | price from a client-drawn route |
| Autocomplete down / breaker OPEN | adapter error, breaker | 503 `GEO_PROVIDER_UNAVAILABLE` (stale-serve only if TTL > 0) | "Type the full address or drop a pin"; landmark aliases still help forward geocode | fake suggestions |
| Forward geocode down | same | 503 | pin on map (if map up) or "location unavailable — try again"; quote still possible from a pin | guess a point from text |
| Reverse geocode down | same | 503 | pin keeps working; label "Pinned location (address unavailable)" | invent a landmark/address |
| Routing down / unbound / budget exhausted | adapter error, breaker, unbound port, budget | quote refused 503 `WAYVRO_E_DEPENDENCY_UNAVAILABLE` `reasonCodes:["ROUTING_UNAVAILABLE"]`; nothing persisted | "Prices are temporarily unavailable" + retry with backoff; previously restored quote shown only while unexpired | straight-line ETA/distance (allowed ONLY inside the MOCK double, refused outside local/test by ADR-045), metered mode (CON-P3-08) |
| SKU budget exhausted | Valkey budget counters | that SKU refused 503 `GEO_BUDGET_EXHAUSTED`; signal `GEO_BUDGET_EXHAUSTED`; provider-console hard caps are the backstop (founder action) | as the matching row above | silently switch to an unapproved vendor |
| Valkey down | `LimiterUnavailableError` | **geo endpoints and `POST /v1/quotes` FAIL CLOSED (503)** — rationale below; `GET /v1/quotes/{id}` (DB only) still served; `GET /v1/app/config` served (no provider cost; limited by an in-process fallback bucket per IP prefix) | "temporarily unavailable"; restore still works | serve geo without limits/budgets |
| PostgreSQL down | readiness probe | all DB-backed routes 503 (existing); app config served from last-known in-process copy ≤ 10 min, flagged stale, else 503 | app proceeds with last policy (server enforces on next call) | serve quotes from Valkey |
| Key ring unavailable (no `place_refs` key) | boot check | API refuses to start in that env (fail closed at boot) | — | unsealed provider ids |
| Outbox/relay lag | outbox age signal (existing) | switch/policy caches are TTL-based (≤ 10 s / 60 s), so correctness does not depend on events | — | — |

Valkey fail-closed justification: the cache, rate limits and budget counters all live in Valkey. Without them, each keystroke and each quote becomes an unmetered paid provider call that nothing can cap except the provider console — a cost-amplification path an attacker (or a client bug) can trigger with valid sessions. This matches the OTP precedent (`otp-abuse.ts`: limiter unavailable ⇒ 503). Riders keep manual pin entry; nothing safety-critical depends on geo in Phase 3 (no trips exist).

## 9. Runtime switches and app config

### 9.1 Runtime switches (A01/V10/I11; F-P3-03)

| Aspect | Design |
|---|---|
| Registry | code registry `RUNTIME_SWITCH_REGISTRY` in `packages/config/src/runtime-switches.ts` (proposed): key (same pattern as flags: `^(rider|driver|ops|platform)\.[a-z0-9]+(-[a-z0-9]+)*$`), owner, purpose, requirement IDs, allowed scopes, **safe state** (the emergency direction), per-env default |
| Initial keys (proposed) | `platform.maintenance` (safe state ENABLED), `platform.geo-autocomplete`, `platform.geo-geocode`, `platform.geo-reverse`, `platform.geo-routing`, `rider.quotes` (safe state DISABLED for all five) |
| Storage | `platform.runtime_switches` (current state per key/scope/city) + `platform.runtime_switch_changes` (append-only history incl. pending requests) — data-model doc §6 |
| Moving to the safe state | single authorised staff member with step-up (`platform.switch.disable`), reason code, audited, outbox `platform.runtime-switch.changed.v1`, optional `effective_until` |
| Moving away from the safe state | maker-checker (`platform.switch.enable`, approver ≠ requester), step-up |
| Absence of a row | registry default for the environment |
| Evaluation | server-side only; in-process cache `RUNTIME_SWITCH_CACHE_SECONDS` (default 10 s); staff UI states "takes effect within 10 s" |
| Scope | ALL / RIDER / DRIVER (+ optional city); mode scope is a server concept keyed on the route's capability, never on a client header |
| Relationship to `FLAG_REGISTRY` | flags stay code-only release toggles (default per env); switches are operational kill switches; a feature may need both (flag ON and switch not in safe state) |

### 9.2 `GET /v1/app/config` (public, cacheable)

| Field | Content |
|---|---|
| `serverTime` | ISO timestamp (clients already derive offset from `Date`; duplicated for clarity) |
| `client` | `{state: OK|SOFT_UPDATE|HARD_UPDATE|MAINTENANCE, messageKey, storeUrlKey|null, recommendedBuild, minSupportedBuild}` evaluated from request headers `X-Wayvro-Platform`, `X-Wayvro-App-Version`, `X-Wayvro-App-Build` against the ACTIVE policy |
| `maintenance` | `{active, messageKey, expectedEnd|null}` |
| `switches` | presentation-relevant switch states only (e.g. `rider.quotes`), never security decisions |
| `map` | `{rendererKind: google|mapbox|maplibre|none, styleUrl|null, attributionCodes[], clientToken|null}` — `none` until P3.7; token (if the SDK needs one) restricted by package/signature and rotatable (FA) |
| `geo` | `{autocompleteMinChars: 3, autocompleteDebounceMs: 300, reverseDebounceMs: 600}` |
| `lite` | `{autoSuggestAfterSlowRequests: 3, slowRequestMs: 4000}` |

Caching: `Cache-Control: public, max-age=60`, `ETag`, `Vary: X-Wayvro-Platform, X-Wayvro-App-Build`. Rate-limited per IP prefix; falls back to an in-process bucket if Valkey is down (no provider cost behind it).

### 9.3 Server enforcement (hooks)

| Hook | Rule | Allowlist (always reachable) |
|---|---|---|
| app-version gate | request carries `X-Wayvro-Platform` and a build below `min_supported_build` or inside a blocked range ⇒ 426 `WAYVRO_E_APP_UPDATE_REQUIRED` | `GET /v1/app/config`, legal documents, account deletion request, sign-out, support contact, health, all staff `/v1/admin/*` routes |
| maintenance | `platform.maintenance` ENABLED ⇒ 503 `WAYVRO_E_MAINTENANCE` (`retryAfterSeconds` from `expectedEnd`) for consumer routes | same allowlist; staff routes stay available so staff can end maintenance |
| headers absent | allowed (web surfaces and Phase-2 dev builds send none) | — |

The version gate is a **compatibility** control, not a security boundary: a client can lie about its build. Security fixes rely on server-side checks; the gate only stops honest old clients from corrupting data or calling removed behaviour.

## 10. Observability (no metrics SDK — F-P3-05)

| Signal (log `signal` field) | Level | Emitted when |
|---|---|---|
| `GEO_BUDGET_THRESHOLD` (percent, window, providerKey, sku) | warn | 50 / 80 / 100 % of day or month calls/cost |
| `GEO_BUDGET_EXHAUSTED` | error | budget refusal |
| `GEO_BREAKER_OPENED` / `GEO_BREAKER_HALF_OPEN` / `GEO_BREAKER_CLOSED` | error / warn / info | breaker transitions |
| `GEO_PROVIDER_TIMEOUT` | warn | adapter timeout (sampled 1/10 after the first 10 per minute) |
| `GEO_ADAPTER_CONTRACT_ERROR` | error | provider rejected validated input or normalisation failed |
| `GEO_USAGE_GAP` | warn | rollup found no counters for a completed hour |
| `GEO_LICENCE_BINDING_REFUSED` | fatal | boot-time bundle mismatch |
| `QUOTE_ROUTING_UNAVAILABLE` | warn | quote refused for routing |
| `QUOTE_SYNTHETIC_CONFIG_REFUSED` | error | production asked to price with synthetic/placeholder config (must never happen) |
| `RUNTIME_SWITCH_CHANGED`, `APP_POLICY_ACTIVATED`, `RATE_CARD_ACTIVATED`, `ZONE_SET_ACTIVATED` | info (audit is the record) | lifecycle transitions |

Traces: spans `geo.gateway.<sku>`, `pricing.quote.create`, `pricing.engine.price` with attributes providerKey, sku, cacheStatus, outcome, product count, latency; never text, coordinates, polyline, placeRef or account id beyond the existing request context. Persisted usage: `geo.provider_usage` hourly rows (budget review/audit, not billing truth — the provider console is). Telemetry segmentation by mode: the client sends **no mode header in Phase 3** (`docs/phase3/PHASE3_MOBILE_UX_AND_NAVIGATION.md` §4.3; mode-segmented telemetry is V12, Phase 4); server-side, route families (`/v1/driver/*` vs rider routes) already separate the modes in logs. When Phase 4 adds a hint header it is optional, low-cardinality, recorded as a log/span attribute only and never used for authorisation.

Redaction additions (additive to `packages/observability/src/redaction.ts`, test-enforced): keys `polyline`, `place_?ref`, `search_?(text|query)`, `pickup`, `dropoff`, `bbox`, `route_?geometry`; a value pattern for `pr1.` tokens. Test: a geo request log record contains the route template and no coordinate pair, text or token.

## 11. Contracts, versioning and errors

| Item | Rule |
|---|---|
| Request strictness | request schemas are strict objects (Phase-2 practice): unknown fields — including any client-supplied fare, total, distance or duration — are rejected with 400 `WAYVRO_E_VALIDATION`, never read or used |
| Evolution | additive only within `/v1`; new modules `catalog.ts`, `geo.ts`, `pricing.ts`, `app-config.ts`; `AccountState.modes` additive (optional at first, required for clients only after mobile adoption) |
| Gates | `openapi:check` (existing, regenerate + diff `packages/contracts/openapi/wayvro-api.v1.json`) + **oasdiff breaking-change gate enabled at P3.0** against the Phase-2 baseline (F-P3-09) |
| Idempotency | every mutating `/v1` route keeps requiring `Idempotency-Key`; persistent replay for `POST /v1/quotes` and every staff mutation; geo reads are GET (no key) |
| New error codes (append to `ERROR_CODES`, names PROPOSED) | `WAYVRO_E_SERVICE_AREA` (422; `details.reasonCodes` e.g. `ZONE_NOT_SERVED`, `PICKUP_RESTRICTED`, `OUTSIDE_SERVICE_HOURS`, `ROUTE_TOO_LONG`, `NO_PRODUCT_AVAILABLE`), `WAYVRO_E_APP_UPDATE_REQUIRED` (426), `WAYVRO_E_MAINTENANCE` (503) |
| Reused codes | `WAYVRO_E_DEPENDENCY_UNAVAILABLE` (503; reasonCodes `ROUTING_UNAVAILABLE`, `GEO_PROVIDER_UNAVAILABLE`, `GEO_BUDGET_EXHAUSTED`), `WAYVRO_E_RATE_LIMITED` (429; reasonCodes e.g. `QUOTE_RATE_LIMITED`, `GEO_RATE_LIMITED`), `WAYVRO_E_FEATURE_DISABLED` (switch), `WAYVRO_E_VALIDATION` (400; reasonCodes `PLACE_REF_INVALID`, `PLACE_REF_EXPIRED`, `PLACE_REF_STALE`, `OUTSIDE_COUNTRY`), `WAYVRO_E_IDEMPOTENCY_CONFLICT` (409) |
| Reason codes | existing optional `details.reasonCodes: string[]` (P2.5) carries them — no schema change to `ErrorDetailsSchema` |
| Headers (additive to `packages/contracts/src/headers.ts`) | `X-Wayvro-Platform` (`ANDROID|IOS`), `X-Wayvro-App-Version` (existing `AppVersionSchema` shape), `X-Wayvro-App-Build` (positive integer); no mode header in Phase 3 |

## 12. Configuration additions (proposed; `apps/api/src/config.ts` style `int(default, min, max)`)

| Variable | Default | Min | Max | Notes |
|---|---|---|---|---|
| `GEO_RENDERER_KIND` | `none` | — | — | enum `none|google|mapbox|maplibre`; bundle check §6.1 |
| `GEO_AUTOCOMPLETE_TIMEOUT_MS` | 1500 | 200 | 5000 | |
| `GEO_GEOCODE_TIMEOUT_MS` | 2000 | 200 | 5000 | also place resolve |
| `GEO_REVERSE_TIMEOUT_MS` | 2000 | 200 | 5000 | |
| `GEO_ROUTE_TIMEOUT_MS` | 2500 | 200 | 8000 | |
| `GEO_CONNECT_RETRIES` | 1 | 0 | 1 | connect errors only; autocomplete/geocode/reverse only, and only while the remaining deadline ≥ the SKU timeout; routing in the quote path is never retried (§5.4a) |
| `GEO_RETRY_SLACK_MS` | 500 | 0 | 2000 | geo read deadline = SKU timeout + slack (§5.4a) |
| `QUOTE_DEADLINE_MS` | 3000 | 1000 | 10000 | overall `POST /v1/quotes` server deadline (§5.4a) |
| `GEO_BREAKER_MIN_CALLS` | 20 | 5 | 1000 | |
| `GEO_BREAKER_FAILURE_PERCENT` | 50 | 10 | 100 | |
| `GEO_BREAKER_WINDOW_SECONDS` | 60 | 10 | 600 | |
| `GEO_BREAKER_CONSECUTIVE_TIMEOUTS` | 5 | 1 | 100 | |
| `GEO_BREAKER_OPEN_SECONDS` | 30 | 5 | 600 | |
| `GEO_BREAKER_HALF_OPEN_PROBES` | 3 | 1 | 20 | |
| `GEO_CACHE_MAX_TTL_AUTOCOMPLETE_SECONDS` | 86400 | 0 | 86400 | maximum; adapter TTL may be lower (0) |
| `GEO_CACHE_MAX_TTL_GEOCODE_SECONDS` | 604800 | 0 | 2592000 | |
| `GEO_CACHE_MAX_TTL_REVERSE_SECONDS` | 604800 | 0 | 2592000 | |
| `GEO_CACHE_MAX_TTL_ROUTE_SECONDS` | 600 | 0 | 600 | |
| `GEO_PLACE_REF_TTL_SECONDS` | 900 | 60 | 3600 | |
| `GEO_AUTOCOMPLETE_PER_MINUTE_ACCOUNT` | 60 | 1 | 10000 | |
| `GEO_RESOLVE_PER_MINUTE_ACCOUNT` | 30 | 1 | 10000 | |
| `GEO_REVERSE_PER_MINUTE_ACCOUNT` | 30 | 1 | 10000 | |
| `QUOTES_PER_MINUTE_ACCOUNT` | 20 | 1 | 10000 | |
| `QUOTES_PER_DAY_ACCOUNT` | 200 | 1 | 100000 | |
| `QUOTES_PER_MINUTE_IP_PREFIX` | 60 | 1 | 100000 | IPv4 /24, IPv6 /56 (existing `ipPrefix`) |
| `QUOTE_IDEMPOTENCY_TTL_SECONDS` | 900 | 60 | 3600 | replay window for quote creation |
| `PICKUP_SNAP_MAX_METERS` | 300 | 25 | 2000 | restricted/airport zones |
| `GEO_LOCAL_DAILY_CALLS_PER_SKU` | 5000 | 1 | 1000000 | local/test only; staging/production require an ACTIVE `geo.provider_budgets` row (absent ⇒ SKU refused) |
| `RUNTIME_SWITCH_CACHE_SECONDS` | 10 | 1 | 60 | |
| `APP_CONFIG_CACHE_SECONDS` | 60 | 0 | 600 | |

Worker: `QUOTE_RETENTION_DAYS` default 30 (1–365, NOT_COUNSEL_APPROVED, EG-16), `GEO_USAGE_RETENTION_DAYS` default 400 (30–1100). Adapter credentials: per-adapter secret variables named at P3.7 with ADR-006; none exists; never committed (FA-06 keys live only in the founder's local untracked env). Environment rules (refused outside local/test): `GEO_RENDERER_KIND` bound to a bundle whose adapters are MOCK-branded; missing budget rows are not defaulted.

## 13. What is explicitly NOT built in Phase 3 (Phase 4+)

Ride requests, dispatch rounds, offers, assignment, driver presence/online state, location ingestion, background location, foreground services, push notifications, realtime trip channels, distance/ETA matrix, navigation, trips, fare adjustment on actual route, bidding, surge, promotions/discounts, commission, ledger, payments, receipts, metered/estimate fallback mode, OTA updates (no expo-updates, CON-P3-12), externally registered URL scheme (CON-P3-07), a metrics stack (I07), multi-city configuration beyond LHR rows, provider pre-warming or batch geocoding, persistent recent places on device, any real (non-synthetic) price or tax rate.

## 14. Open items for reviewers (architecture-specific)

| ID | Item | Status |
|---|---|---|
| ARCH-01 | Geo reads as GET (lead decision) with mandatory query-string scrubbing at every hop (route-template logs, OTel `url.query` dropped, proxy/CDN log format); POST was considered to keep text/coordinates out of URLs entirely but would force Idempotency-Key semantics onto reads | PROPOSED (GET + scrubbing) |
| ARCH-02 | Valkey outage ⇒ geo + quote creation fail closed | PROPOSED (matches OTP precedent) |
| ARCH-03 | Google routing used for pricing without a Google map treated as not allowed | lead decision; counsel/vendor confirmation EXTERNAL |
| ARCH-04 | `src/platform/` vs `src/core/platform/` naming in the mobile app | PROPOSED (`src/platform/`) |
| ARCH-05 | `placeRef` key class `place_refs` (new key material per environment) | PROPOSED; staging/production blocked by EG-05 like all classes |
| ARCH-06 | keyed-HMAC Valkey cache keys with a dedicated `geo_cache` key class (ADR-047) | PROPOSED (recommended by the lead) |
