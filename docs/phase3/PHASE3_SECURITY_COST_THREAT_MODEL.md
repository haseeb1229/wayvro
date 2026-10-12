# PHASE3_SECURITY_COST_THREAT_MODEL — Phase 3 trust boundaries, threats, cost controls and fail-closed rules (PROPOSED)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — pending founder/ChatGPT review; no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

Extends `docs/phase0/PHASE0_SECURITY_PRIVACY.md` (TB1–TB10, AB-01..AB-22) and `docs/phase2/PHASE2_SECURITY_AND_ABUSE_MODEL.md` (T-01..T-41, still in force). Phase 3 threats are numbered **T3-01..T3-34**. OWASP ASVS L2 / MASVS remain design targets; **conformance is not claimed** (EG-17/U01, Phase 7). Every control below is PROPOSED and every test is **NOT RUN** — nothing in this document is implemented. Numbers marked "plan" come from the Phase 3 planning decisions summarised in `docs/phase3/PHASE3_PLAN.md`; numbers marked "PROPOSED here" are new in this document and need the same founder review. Requirement IDs touched: E05, E06, E07, E08, H06, H10, I11, U04, U05, V05, V08, A01, A07, B01–B04, B06, Q31, R28 (security/cost aspects only; full mapping in `docs/phase3/PHASE3_REQUIREMENT_MATRIX.md`). Test IDs refer to `docs/phase3/PHASE3_TEST_STRATEGY.md`; items marked (new) are proposed additions to that strategy.

## 1. Trust boundaries added or changed in Phase 3

| # | Boundary | What crosses it | Who is trusted | Phase 3 change |
|---|---|---|---|---|
| TB11 | API geo gateway ↔ geo providers (autocomplete, forward/reverse geocode, routing) | normalised queries, coarse bias cell, rounded coordinates, server API keys; provider results | nobody: provider output is validated like client input | NEW. Server is the only caller (keys never on device). Provider sees Wayvro server IP only; no account id/phone sent |
| TB12 | Mobile map renderer ↔ tile/style host | viewport tile requests (reveal approximate area + device IP), optional client renderer token, SDK telemetry | tile host is an external processor | NEW. The only client-side vendor surface; behind `src/platform/maps/` (proposed path); style/tile URL and any token come from `GET /v1/app/config` |
| TB13 | Valkey geo cache, rate-limit and budget counters | cached provider results, counters | never authoritative | CHANGED: Valkey becomes a data cache for the first time (Phase 2 used it for limits/budgets only) |
| TB14 | Staff web-ops ↔ pricing/catalog/zone/release-control configuration | rate cards, tax policies, zone geometries, eligibility rules, app version policies, runtime switches, provider budgets | staff only through maker-checker + step-up + audit | NEW config surfaces; new permissions and proposed roles PRICING_MANAGER / CATALOG_MANAGER / RELEASE_MANAGER (FA-10) |
| TB15 | Public `GET /v1/app/config` ↔ any client | version policy, maintenance state, map style descriptor, restricted renderer token | response is public data; enforcement is server-side | NEW unauthenticated endpoint |
| TB16 | OS location services ↔ app (foreground, rider; driver readiness only) | one-shot fix / focused-screen watch | device location is user input, never truth | NEW (FA-02 permission delta COARSE + FINE only) |
| TB17 | Internal intent router (`resolveIntent`) ↔ navigation | intent type + ids from restored state, internal links, future notifications | nothing: every intent is re-authorised from server state | NEW; external URL scheme stays unregistered in release (CON-P3-07, F-P3-01) |
| TB18 | SP-04 / SP-01 / SP-02 spike harnesses ↔ providers, devices and founder field data | provider evaluation keys, raw provider responses, founder GPS tracks, device logs | dev-only, never in deployable artefacts | NEW; evidence handling rules in §4 T3-32 |

Unchanged but exercised more: TB1 (new geo/quote/config routes), TB2 (mode controller), TB4 (new staff screens), TB9 (new `catalog`/`pricing`/`geo` tables with geometries and quote coordinates), TB10 (manifest/intent-filter gate added at P3.0).

## 2. Threat summary

| ID | Threat | Primary asset | Severity (PROPOSED) | Main control family |
|---|---|---|---|---|
| T3-01 | Fake / invalid coordinates | quote integrity, provider budget | MEDIUM | input validation + DB zone check |
| T3-02 | Device location spoofing (mock location) | pickup accuracy, future dispatch | LOW in Phase 3 (HIGH from Phase 4) | treat location as user input; N18 later |
| T3-03 | Quote tampering (client fare/distance/duration) | price integrity | HIGH | server recompute; strict schemas |
| T3-04 | Quote enumeration / cross-account read | rider privacy | HIGH | owner-only, 404 on foreign ids |
| T3-05 | Quote replay, idempotency misuse, stale-quote reuse | price integrity | MEDIUM | idempotency store, server expiry |
| T3-06 | Route parameter abuse | provider budget, DB | MEDIUM | bbox, max distance/duration, no via-points |
| T3-07 | placeRef forgery / tampering / label spoofing | provider budget, address integrity | MEDIUM | AEAD sealing, expiry, distance check |
| T3-08 | Provider quota exhaustion | availability, cost | HIGH | budgets, breaker, console quotas |
| T3-09 | Geocode/autocomplete enumeration and scraping | cost, provider terms | MEDIUM | session required, limits, result caps |
| T3-10 | Cache-busting via coordinate jitter | cost | MEDIUM | rounded, keyed cache keys |
| T3-11 | Per-keystroke autocomplete amplification | cost | MEDIUM | debounce, min chars, server limits |
| T3-12 | Cache poisoning / cross-provider cache bleed | result integrity, terms | MEDIUM | adapter-only writes, namespaced keys |
| T3-13 | Stale or fallback route misuse | price integrity | HIGH | no invented values, refuse on outage |
| T3-14 | Zone, pickup-point and service-hours bypass | operations, safety | HIGH | PostGIS check in DB, exclusion precedence |
| T3-15 | Legal-gated product activation bypass | legal exposure | HIGH | DB trigger + maker-checker + quote-time re-check |
| T3-16 | Client price-display manipulation | dispute integrity | LOW | server-held breakdown, quote reference |
| T3-17 | Malicious deep links / intent injection | navigation integrity, availability | HIGH until P3.0 fix | no external scheme, allowlist, re-check |
| T3-18 | Wrong-mode navigation / mode escalation | role isolation | HIGH | server-derived modes, route guards |
| T3-19 | Map SDK telemetry / tile-request leakage | rider privacy | MEDIUM | telemetry off/opt-out, inventory, Lite mode |
| T3-20 | Provider key leakage | cost, account standing | HIGH | env-only keys, restrictions, gitleaks |
| T3-21 | Malformed or malicious provider responses | API integrity, web-ops XSS | MEDIUM | schema validation, size caps, plain-text rendering |
| T3-22 | Provider licence/terms violation | legal exposure, account termination | HIGH | bundle compatibility check, terms-derived TTLs |
| T3-23 | Rate-card / tax-policy insider abuse | price integrity, money | HIGH | maker-checker, step-up, audit, envelope |
| T3-24 | Runtime-switch abuse | availability | MEDIUM | disable-only fast path, enable maker-checker |
| T3-25 | Version-policy abuse (bricking users) | availability, user rights | HIGH | guardrails, dry-run, expedited-security path |
| T3-26 | Version-header spoofing / public app-config abuse | compatibility, availability | LOW | server enforcement, caching, IP limits |
| T3-27 | Denial of wallet (aggregate) | money | HIGH | caps that bound worst case by construction |
| T3-28 | Logging/telemetry leakage of coordinates and geo queries | rider privacy | HIGH | redaction, route templates, URL scrubbing |
| T3-29 | Zone/geofence data integrity | quote correctness | MEDIUM | ST_IsValid, SRID, probe points, immutability |
| T3-30 | Time manipulation | expiry, hours, policy windows | MEDIUM | server time only |
| T3-31 | Synthetic configuration or geo test doubles in production | price integrity, safety | HIGH | activation refusal, ART-ISO extension |
| T3-32 | Benchmark/spike data leakage | founder privacy, provider terms | MEDIUM | local-only raw data, trimming, aggregate commits |
| T3-33 | Staff quote lookup used for tracking | rider privacy | MEDIUM | reason-gated, district-only, audited |
| T3-34 | Permission over-collection / driver prompt reaching riders | user privacy, store standing | HIGH | manifest gate, JIT, V05 tests |

## 3. Location spoofing analysis (why Phase 3 does not act on mock-location flags)

1. **The server already treats every pickup/dropoff as user-chosen.** The manual pin and text search are first-class inputs (B01/B02); a rider may legitimately quote from anywhere. A spoofed GPS fix therefore gives an attacker nothing that dragging the pin does not already give. Prices depend only on the submitted coordinates, the active zone set and rate card, and the server-side route snapshot.
2. **Phase 3 has no ride request, dispatch, driver presence or location stream**. A spoofed quote only changes the price *the spoofer* sees for a trip that cannot be booked.
3. **Phase 4 consequence (recorded, not built):** the pickup coordinate becomes the driver's navigation target. A rider who spoofs a pickup sends the driver to a place where the rider is not — it harms the spoofer (no-show, cancellation fee policy) and wastes driver time; it is handled by Phase 4 arrival/no-show rules and N18 signals. A rider who quotes a short route and travels further is a Phase 4/5 route-deviation/fare-adjustment problem, not a Phase 3 one.
4. **Driver-side spoofing (AB-09)** — teleporting to farm incentives or fake arrival — needs driver location, which Phase 3 neither collects nor ships (no background location code in the shipped app; SP-01 runs outside the release app).
5. **Decision (PROPOSED):** Phase 3 **does not collect, transmit, store or act on** mock-location / `isMocked`-style flags or emulator signals. Collecting a signal with no consumer and no retention decision contradicts data minimisation (U05, Q36). N18 (location-integrity signals with human review) is designed in Phase 4 together with its consumer, retention (EG-16) and appeal path.
6. **What Phase 3 does do:** validate coordinates (T3-01), enforce zones in the database (T3-14), rate-limit and budget every provider call (T3-08..T3-11), and never let the client's location, time or price influence anything except the coordinates it submits.

## 4. Threat register (detail)

### T3-01 Fake or invalid coordinates
- **Asset:** quote correctness; provider budget; DB integrity.
- **Attacker:** any signed-in account; scripted client.
- **Scenario:** submit NaN/Infinity, strings, out-of-range values, swapped lat/lng, null island (0,0), coordinates outside Pakistan, 15-decimal values to defeat caching, or pickup = dropoff.
- **Controls:** zod schema on `POST /v1/quotes` and geo routes: finite numbers only, lat ∈ [-90, 90], lng ∈ [-180, 180]; server normalises stored precision to 6 decimals; cheap configured **Pakistan bounding-box pre-filter** (coarse values in `docs/phase3/PHASE3_ARCHITECTURE.md` §5.2: lat 23.5–37.2, lng 60.8–77.9) rejects before any provider call; the **authoritative** check is the PostGIS zone query in the database (T3-14), so a bbox error can only over-reject, never admit; identical pickup/dropoff ⇒ `WAYVRO_E_VALIDATION`; geo calls are made **only after** validation, zone and service-hours checks pass (no provider spend on a request that will be refused).
- **Detection/signal:** validation-failure counter per account (log signal `GEO_INPUT_REJECTED`, no coordinates logged).
- **Residual risk:** a valid coordinate inside the service area that is simply not where the rider is — accepted by design (§3).
- **Test:** ZB-15 (invalid/out-of-bbox coordinates rejected before any DB or provider call), QT-10, PROP-ZONE-DECISION; (new) property: any rejected input produces zero adapter calls.

### T3-02 Device location spoofing (mock location)
- **Asset:** pickup accuracy (Phase 4+), driver integrity (Phase 4+).
- **Attacker:** rider with a mock-location app; rooted device.
- **Scenario:** fake GPS fix used for "use current location".
- **Controls:** §3 — location is user input; the rider must confirm the pin before quoting; approximate-only grants centre coarsely and require pin confirmation; no driver location in Phase 3; no flag collection.
- **Detection/signal:** none in Phase 3 (deliberate).
- **Residual risk:** N18 gap until Phase 4 — acceptable because no economic action depends on device location in Phase 3.
- **Test:** PIN-01..03, LOC-01..05 (pin confirmation always required; quote body carries only confirmed coordinates).

### T3-03 Quote tampering (client fare, distance, duration)
- **Asset:** price integrity (E05, B06).
- **Attacker:** rider with a modified client or an HTTP proxy.
- **Scenario:** send `total`, `distanceM`, `durationS`, `components`, `rateCardId`, `zoneSetId`, `expiresAt` or `productCode` for a disabled product in the request.
- **Controls:** request schema accepts only `{cityCode, pickup{lat,lng,placeRef?}, dropoff{...}, products?}` with strict object parsing — unknown keys such as `total`, `distanceM` or `components` rejected with 400 `WAYVRO_E_VALIDATION` (Phase 2 T-16 pattern); **server recomputes everything**: route from the routing port, components with `Money` (bigint minor units, HALF_EVEN for distance/time, rate-card rounding step/mode), total = Σ components enforced by a deferred DB constraint trigger + property tests; rate card, zone set and engine version are resolved server-side and stored on the quote; `products` is a filter only — disabled/ineligible products are returned in `unavailable[]` with a reason code, never priced.
- **Detection/signal:** unknown-key rejections counted per account (`QUOTE_SCHEMA_REJECTED`).
- **Residual risk:** none known for Phase 3 beyond implementation defects.
- **Test:** QT-01 (client fare/distance/components ⇒ 400), PROP-QUOTE, PROP-MONEY, TRIG-P3 (Σ components = total).

### T3-04 Quote enumeration / cross-account read (IDOR)
- **Asset:** rider trip intent and coordinates.
- **Attacker:** another account; scraper.
- **Scenario:** iterate `GET /v1/quotes/{quoteGroupId}` to read other riders' pickup/dropoff.
- **Controls:** ids are server-generated UUIDs (UUIDv7 per the Phase 2 convention; the timestamp part leaks only creation time); **owner-only** query (`account_id = session account` inside the SQL, not a post-filter); foreign or unknown ids both return the same 404 (`WAYVRO_E_NOT_FOUND`, Phase 2 T-15 pattern); GET is rate-limited per account; responses carry no account identifiers; staff access only via T3-33.
- **Detection/signal:** 404 rate per account above a threshold ⇒ signal `QUOTE_NOT_FOUND_BURST`.
- **Residual risk:** stolen session reads that account's own quotes (Phase 2 session controls apply).
- **Test:** QT-05 (foreign id indistinguishable from a random UUID).

### T3-05 Quote replay, idempotency misuse and stale-quote reuse
- **Asset:** price integrity; provider budget.
- **Attacker:** rider replaying requests or old responses.
- **Scenario:** replay `POST /v1/quotes` to multiply provider calls; reuse a cheap expired quote later; reuse one Idempotency-Key with a different body.
- **Controls:** Idempotency-Key required (existing rule); same key + same body (request hash) ⇒ stored response, **no new provider call**; same key + different body ⇒ 409 `WAYVRO_E_IDEMPOTENCY_CONFLICT`; keys scoped to the account; quote expiry = server now + `quote_ttl_seconds` (synthetic 300 s); status EXPIRED computed from server time on every read and by the purge job; a newer group SUPERSEDES older unexpired groups for display; **Phase 4 acceptance contract (documented, not built):** accept by `quoteId` only, owner check, status PRICED, server now < `expires_at`, compare-and-set to ACCEPTED exactly once.
- **Detection/signal:** idempotency-conflict counter; quote creation rate per account vs limits.
- **Residual risk:** none in Phase 3 (no acceptance exists).
- **Test:** QT-02, QT-03, QT-04, QT-06, QT-17, CONC-PRICING.

### T3-06 Route parameter abuse
- **Asset:** provider budget; DB size; price sanity.
- **Attacker:** scripted client.
- **Scenario:** request Lahore → Karachi; coordinates outside Pakistan; add via-points/waypoints; request alternatives or traffic models to raise per-call cost.
- **Controls:** pickup and dropoff must both pass zone checks for the city (T3-14) before routing; rate-card fields `max_distance_m` / `max_duration_s` enforced on the provider result ⇒ `ROUTE_TOO_LONG`; the routing port accepts **only** origin, destination and a server-chosen profile — no via-points, alternatives, avoid-flags or traffic options are exposed in the contract; adapters request the cheapest SKU tier that meets the ADR-006 decision (e.g. no traffic-aware tier unless the freeze says so); **route sanity check (PROPOSED here):** provider distance shorter than the great-circle distance ⇒ invalid result (refuse, `ROUTING_UNAVAILABLE`); longer than 3.0 × great-circle ⇒ confidence LOW + signal `ROUTE_RATIO_OUTLIER` (ratio is a config value).
- **Detection/signal:** `ROUTE_TOO_LONG` counts; ratio outliers.
- **Residual risk:** legitimate long cross-city trips inside one zone set are bounded by `max_distance_m` — a product decision.
- **Test:** QT-11, FG-03, CON-GEO (contract exposes no via-point/alternative/traffic fields); (new) route-ratio sanity cases with the synthetic double.

### T3-07 placeRef forgery, tampering and label spoofing
- **Asset:** provider budget (forced place-detail calls); address/label integrity; provider-id confidentiality (vendor lock-in and terms).
- **Attacker:** rider crafting tokens; harvester replaying tokens across accounts.
- **Scenario:** fabricate a placeRef for arbitrary provider ids to make the server pay for detail lookups; swap a placeRef labelled "airport" onto coordinates elsewhere; reuse a placeRef harvested from another account.
- **Controls:** placeRef = AES-256-GCM token sealed with the existing field-crypto envelope v1 exactly as specified in `docs/phase3/PHASE3_ARCHITECTURE.md` §7 (plaintext: provider key, SKU, provider place id, issuing account, expiry; AAD binds field descriptor, token id, field-schema version and key id; random 96-bit nonces per the Phase 2 envelope rules); expiry `GEO_PLACE_REF_TTL_SECONDS` default 900 s (max 3,600 s, PROPOSED); a decrypt/AAD/expiry/account failure rejects the request with 400 `WAYVRO_E_VALIDATION` (`PLACE_REF_INVALID` / `PLACE_REF_EXPIRED` / `PLACE_REF_STALE`; a foreign-account token gets the same `PLACE_REF_INVALID` — no oracle; client re-searches) — never "best effort"; **coordinates are priced, not the placeRef**: in `POST /v1/quotes` a placeRef only labels the option, is never resolved through a provider call and never changes components (QT-08); key custody: local key in dev/test, production key class added to the EG-05 KMS scope (new key class — see §8).
- **Detection/signal:** `PLACEREF_REJECTED` by reason (decrypt, expired, account mismatch, stale provider).
- **Residual risk:** placeRef key compromise lets an attacker mint refs (cost only; bounded by T3-27 caps) — rotation by key version.
- **Test:** UNIT-PLACEREF, QT-07 (400 validation, no provider call), QT-08 (placeRef never changes the price); (new) cross-account placeRef rejected.

### T3-08 Provider quota exhaustion
- **Asset:** availability of search/quote; provider spend.
- **Attacker:** abusive accounts; a bug (retry loop, re-render loop); legitimate growth.
- **Scenario:** a client bug fires reverse geocode per GPS sample; a farm of accounts consumes the daily directions budget.
- **Controls:** gateway order: normalise → per-account/installation/IP limits → cache → **budget check** → circuit breaker → adapter with timeout → normalise → cache write → usage meter; per (provider, sku) daily + monthly call budgets and monthly estimated cost (micro-USD from the adapter price table) in Valkey counters, persisted hourly to `geo.provider_usage`; signals at 50/80/100 %; 100 % ⇒ SKU refused (autocomplete degrades to "type full address / drop pin"; routing refusal ⇒ quote refused 503 `ROUTING_UNAVAILABLE`); **per-account daily share** so one account cannot consume more than a fixed fraction of a SKU's daily budget (PROPOSED here: quote 200/day/account from this plan is the routing share; autocomplete share derived from the same table); provider timeouts (autocomplete 1.5 s, geocode 2.0 s, reverse 2.0 s, directions 2.5 s) inside request deadlines — routing in `POST /v1/quotes` is a single attempt within the 3.0 s overall quote deadline, geo reads allow one connect-error retry only while the remaining deadline ≥ the SKU timeout (`docs/phase3/PHASE3_ARCHITECTURE.md` §5.4a, PROPOSED); client: no periodic polling, reverse geocode only on pin settle (600 ms debounce), never per GPS sample; provider-console hard quotas (FA-06) as the outer wall; global kill switch per SKU (runtime switch, T3-24).
- **Detection/signal:** `GEO_BUDGET_50/80/100`, `GEO_BREAKER_OPEN`, cache-hit ratio drop, per-account top-N consumers in the hourly rollup (no PII: hashed account key).
- **Residual risk:** a distributed farm can exhaust a daily budget and deny service until reset — availability loss, not unbounded spend (T3-27).
- **Test:** BUD-01..08, BRK-01..05, PROP-BREAKER, RL-01..04, FG-05.

### T3-09 Geocode/autocomplete enumeration and scraping
- **Asset:** provider spend; provider terms (bulk extraction is commonly prohibited); Wayvro landmark alias data.
- **Attacker:** competitor or data harvester using Wayvro as a free geocoding proxy.
- **Scenario:** systematic queries across a grid or dictionary to build an address database.
- **Controls:** every geo endpoint requires a signed-in session (no pre-sign-in geo) — which itself costs an OTP-verified phone (Phase 2 T-01 limits); per-account limits (autocomplete 60/min, place resolution 30/min (`GEO_RESOLVE_PER_MINUTE_ACCOUNT`), reverse geocode 30/min, quotes 20/min and 200/day; forward geocode via `GET /v1/geo/autocomplete?mode=GEOCODE` counts against the autocomplete limit — `docs/phase3/PHASE3_ARCHITECTURE.md` §12); per-IP-prefix ceilings (IPv4 /24, IPv6 /56 hashed — same `ipPrefix` convention as `apps/api/src/identity/otp-abuse.ts`; quotes 60/min/IP-prefix from this plan; geo values set at P3.2 from load tests, high because of CGNAT); **result caps**: autocomplete returns at most 5 suggestions, reverse geocode returns one formatted address, no paging, no bulk/batch endpoint, no "export"; responses carry only the fields the UI needs (label lines, placeRef, coarse confidence) — never raw provider payloads.
- **Detection/signal:** sustained near-limit usage per account; grid-like reverse-geocode patterns (distinct rounded cells per hour per account above a threshold ⇒ `GEO_SCRAPE_SUSPECTED`).
- **Residual risk:** slow, distributed scraping inside limits is possible; bounded by budgets and terms-derived caching.
- **Test:** RL-01..04, QT-16 (no pre-sign-in geo); (new) result-count caps and absence of any batch/export route (route-completeness check).

### T3-10 Cache-busting cost amplification (coordinate jitter)
- **Asset:** provider spend.
- **Attacker:** scripted client adding tiny offsets so each request misses the cache.
- **Controls:** cache keys use **rounded** inputs: reverse geocode and route endpoints rounded to 4 decimals (~11 m), autocomplete bias to a 2-decimal cell (~1.1 km), plus a 15-minute time bucket for routes; on a cache miss the gateway **sends the rounded coordinate** to the provider (PROPOSED here — keeps the cached value coherent with the key and is within the earlier draft "≤ 5 decimals sent" privacy rule); free-text queries are canonicalised (Unicode NFKC, case fold, whitespace collapse, punctuation trim) before keying; per-account limits apply to misses and hits alike.
- **Detection/signal:** per-account cache-miss ratio above threshold ⇒ `GEO_CACHE_BUST_SUSPECTED`.
- **Residual risk:** jitter larger than the rounding cell still misses — bounded by rate limits and budgets.
- **Test:** CS-01, CS-04, CS-07, PROP-NORM; (new) property: inputs within one rounding cell map to one key, different provider/sku/locale never collide.

### T3-11 Per-keystroke autocomplete amplification
- **Asset:** provider spend; device data budget.
- **Attacker:** none needed — the default UI pattern is the threat; also scripted clients.
- **Controls:** client debounce 300 ms and minimum 3 characters; in-flight request cancellation on new keystroke; server enforces a minimum query length and maximum length (PROPOSED here: 3–80 characters after canonicalisation) and the per-account limit; adapter uses the provider's **session** mechanism where it exists (Google lists "Autocomplete Session Usage" as an unlimited no-charge SKU alongside the charged "Autocomplete Requests" SKU — pricing page seen 2026-10-12, re-verify at SP-04) so a search session is billed as intended; Lite mode does not auto-search.
- **Detection/signal:** requests per search session above a threshold (`AUTOCOMPLETE_SESSION_LONG`).
- **Residual risk:** none beyond T3-09.
- **Test:** SRCH-01, RL-01..04, PROP-NORM; (new) server minimum/maximum query length.

### T3-12 Cache poisoning and cross-provider cache bleed
- **Asset:** integrity of addresses and routes served to every user; provider terms.
- **Attacker:** client trying to make the server cache attacker-chosen content; insider with Valkey access; a provider switch serving stale data from the previous provider.
- **Controls:** cache **values are written only by the adapter normalisation path** after schema validation (T3-21) — never from client input, never from staff input; keys = `env : geo : providerKey : sku : adapterVersion : locale : HMAC-SHA-256(normalised params)` (PROPOSED here: keyed hashing means a Valkey dump or `MONITOR` does not reveal what users searched or where they are); provider key in the key prevents serving provider A's content after switching to provider B (also a terms requirement, T3-22); errors are never cached; empty results cached only briefly (PROPOSED here ≤ 1 h); TTLs are **maxima** — each adapter declares a terms-derived TTL that may be lower, including 0 (T3-22); stale-serve only for autocomplete/reverse, flagged STALE_SERVED, ≤ 2 × TTL, never for routes used in a new quote beyond 10 min; Valkey is not reachable from outside the private network; API connects with an ACL user restricted to its key prefixes (PROPOSED here; Valkey ACL key patterns).
- **Detection/signal:** schema-validation failures on cache read (a corrupted entry is deleted and treated as a miss, signal `GEO_CACHE_ENTRY_INVALID`).
- **Residual risk:** an insider with Valkey write access can still alter entries until TTL — mitigated by validation on read and short TTLs; Valkey is never authoritative for price (the route snapshot is persisted with the quote).
- **Test:** CS-05, CS-06; (new) provider-namespaced keyed (HMAC) keys; client-controlled fields never reach a cache write; invalid entry on read ⇒ miss.

### T3-13 Stale or fallback route misuse
- **Asset:** price integrity; honesty of ETA/distance (E07).
- **Attacker:** none (failure mode); also an operator tempted to "keep quotes flowing" during an outage.
- **Scenario:** provider outage leads to straight-line estimates, old cached routes or a default distance being priced.
- **Controls:** **no invented values** — unbound routing port, breaker OPEN, budget exhausted or timeout ⇒ quote refused 503 `WAYVRO_E_DEPENDENCY_UNAVAILABLE` reason `ROUTING_UNAVAILABLE` (CON-P3-08: refuse only; metered/estimate mode not built); straight-line ETA exists **only** in the MOCK-branded synthetic double in `@wayvro/provider-test-doubles` and is refused outside local/test (ADR-045, T3-31); route cache entries older than 10 min are never used for a new quote; the route snapshot stores `providerKey`, `fetchedAt` (server), `cacheStatus`, `confidence`, and the response discloses them; clients never upgrade confidence labels.
- **Detection/signal:** `ROUTING_UNAVAILABLE` rate; breaker state.
- **Residual risk:** quote availability depends on one routing provider until a second adapter exists (ADR-006 decides).
- **Test:** FG-01, FG-02, FG-06, FG-09, FG-10, CS-02, ART-ISO (extended).

### T3-14 Zone, pickup-point and service-hours bypass
- **Asset:** operational coverage, safety exclusions, airport rules (E08).
- **Attacker:** rider choosing a pickup inside an excluded or restricted area; modified client sending its own "pickup point".
- **Controls:** single PostGIS query in the database against the **active** zone set: pickup and dropoff must be covered by a SERVICE_AREA (`ST_Covers`, boundary inclusive — choice recorded in ADR-051) and **not** inside any EXCLUSION (**exclusion beats service area**); PICKUP_RESTRICTED ⇒ the server snaps the pickup to the nearest ACTIVE designated pickup point of that zone within `PICKUP_SNAP_MAX_METERS` (else `PICKUP_RESTRICTED`) — the request has no pickup-point field, so the client cannot declare its own pickup point; AIRPORT_PRECINCT ⇒ snap to an AIRPORT pickup point + airport fee if configured, computed server-side; product applicability (`catalog.zone_products`) checked in the same transaction; service hours evaluated from **server time** in `Asia/Karachi`; no active zone set ⇒ every quote refused `ZONE_NOT_SERVED`; no service-hours rows for a product ⇒ treated as closed (PROPOSED here; fail-closed); zone set id/version stored on the quote; error details carry reason codes only (`WAYVRO_E_SERVICE_AREA`, 422, details.reasonCodes — names proposed in this plan).
- **Detection/signal:** refusal counts by reason and zone code (no coordinates).
- **Residual risk:** zone geometry quality depends on the founder-approved boundary source (FA-12, EXTERNAL); synthetic zones only until then.
- **Test:** ZB-01..16, HRS-01..11, PROP-ZONE-DECISION, PROP-HOURS.

### T3-15 Legal-gated product activation bypass
- **Asset:** legal exposure (BIKE/RICKSHAW remain DISABLED_LEGAL_GATE; R28, B7 Phase 0 blocker).
- **Attacker:** insider; staff mistake; client requesting a disabled product.
- **Controls:** DB trigger refuses `ENABLED` on `catalog.city_service_products` when the vehicle class is DISABLED_LEGAL_GATE or `legal_basis_ref` is null for gated classes; ENABLED requires maker-checker; production refuses ENABLED on synthetic configuration; the quote engine re-checks product status in the pricing transaction (defence in depth) and returns disabled products only in `unavailable[]`; the existing `catalog.service_categories` legal-gate states are never renamed or relaxed.
- **Detection/signal:** every status change audited + outbox event; refused activations logged as `CATALOG_ACTIVATION_REFUSED`.
- **Residual risk:** a fabricated `legal_basis_ref` string — the reference is a pointer to founder/counsel evidence; staff cannot verify counsel documents in code. Mitigated by maker-checker and audit.
- **Test:** TRIG-P3 (legal-gate trigger), QT-09, QT-15, AUTHZ-MATRIX (extended).

### T3-16 Client price-display manipulation
- **Asset:** dispute integrity; rider trust.
- **Attacker:** rider/driver editing the UI on a rooted device or faking screenshots.
- **Controls:** the displayed breakdown is rendered from server components only; money formatting works on the `minor` string/bigint — **never converted to binary floating point** (PROPOSED test); fare details show a short quote reference so support can retrieve the authoritative record (T3-33); Phase 4 acceptance references `quoteId` only, never a client amount.
- **Detection/signal:** n/a in Phase 3.
- **Residual risk:** social-engineering disputes using fake screenshots — resolved against server records.
- **Test:** quote view-state adapter tests (`docs/phase3/PHASE3_TEST_STRATEGY.md` §4.13); (new) money formatting from the minor string never uses `Number()`.

### T3-17 Malicious deep links and intent injection
- **Asset:** navigation integrity; availability (decode-uri-component DoS); user trust.
- **Attacker:** any web page or app that can fire an Android VIEW intent; a malicious notification payload (future).
- **Scenario:** **F-P3-01** — today's release AAB registers the `exp+wayvro` scheme via expo-dev-client (verified on the 2026-10-11 local release AAB; re-verification on the post-repair CI artefact recorded in `docs/phase3/PHASE3_PLAN.md`), so external input can reach expo-router's URL parser (decode-uri-component GHSA-vcc3-ghjq-m6fr, availability-only) and attempt navigation to arbitrary routes.
- **Controls:** P3.0 removes the generated scheme from release builds (decide by evidence between expo-dev-client `addGeneratedScheme: false` and excluding dev-client from the release variant) and adds a CI manifest gate failing on any unapproved exported component, intent filter or scheme (extending `infra/ci/android/check-permissions.mjs` into an allowlist); ADR-043 and the `osv-scanner.toml` runtime-exception reason are corrected in the same change; no external scheme, App Link or universal link in Phase 3 (CON-P3-07; EG-15); the internal router `resolveIntent(intent, accountState, mode)` accepts an **allowlist of intent types** with zod-validated ids (UUIDs, enum keys), bounds input length before parsing (≤ 512 characters, as `parseWayvroPath` in `docs/phase3/PHASE3_MOBILE_UX_AND_NAVIGATION.md` §7.2), never navigates to a raw path, never carries prices/flags/roles, and re-fetches server state (e.g. quote via owner-only GET) before rendering; notification payloads (future) carry ids only; the decode-uri-component exception (expires 2026-12-31) gate stands: upgrade expo-router/query-string or bound URL length **before** any external link is registered.
- **Detection/signal:** refused intents counted by reason (no payload logged).
- **Residual risk:** until P3.0 merges, released-from-main AABs carry the scheme (no public release exists; availability-only). **Dated item:** the `osv-scanner.toml` exception for GHSA-vcc3-ghjq-m6fr expires **2026-12-31**; if the Phase 3 run continues past that date the Security CI job fails until the exception is renewed with a fresh, true justification (after P3.0 the premise "no external scheme" becomes true again) or the dependency is upgraded — renewal is a reviewed change, never a silent date bump (also listed in `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` §11).
- **Test:** AAB intent-filter/exported-component gate with negative control, SEC-SCAN-OSV (URL length bound ≤ 512 characters before parsing; malformed percent-encoding fuzz), EXH-INTENT, NAV-04.

### T3-18 Wrong-mode navigation and mode escalation
- **Asset:** role isolation (V02/V07, INV-05/06).
- **Attacker:** rider-only account; suspended driver; stale device state.
- **Scenario:** restored navigation state, cached ModePreference=DRIVER after a driver restriction, or an internal intent opens driver screens; back stack crosses modes.
- **Controls:** ModePreference is a persisted **hint** (`wayvro.mode-preference.v1`), never authorisation; availability comes from server `AccountState.modes` (additive contract); route guards in the `/drive/*` routes re-check `modes.driver.entry/available` on every focus and on restore; **every driver endpoint is re-authorised server-side** (existing Phase 2 policies); a restricted driver lands on driver health/appeal or rider home with a reason, rider mode unaffected unless the restriction is account-wide (AccountGate); mode switch uses `router.replace` to the target mode home — no cross-mode back stack; driver modules are lazily evaluated and never evaluated for rider-only accounts (F-P3-07 measurement in SP-02); no client mode header in Phase 3 (mode-segmented telemetry is V12, Phase 4).
- **Detection/signal:** guard refusals counted by reason (`MODE_GUARD_REFUSED`).
- **Residual risk:** UI briefly showing cached driver content before the guard resolves — guards render a neutral loading state until server state arrives.
- **Test:** NAV-01..06, EXH-RESTORE, EXH-INTENT, AUTHZ-MATRIX (extended); SP-08 matrix accounts A–G (`docs/phase3/PHASE3_SP08_CROSS_MODE_E2E.md`).

### T3-19 Map SDK telemetry and tile-request privacy leakage
- **Asset:** rider approximate location, device identifiers, usage patterns (U04, Q36).
- **Attacker / processor:** map SDK vendor, tile host, network observers.
- **Scenario:** renderer SDK sends telemetry or location events by default; tile requests reveal the viewport (≈ where the rider is looking) plus device IP.
- **Controls:** **Mapbox mobile SDK telemetry is ON by default and Mapbox terms require an in-app end-user telemetry opt-out** (geo facts seen 2026-10-12) — if @rnmapbox/maps is chosen, telemetry is disabled by default in Wayvro configuration where permitted and an opt-out control is provided as required; MapLibre Native has removed Mapbox telemetry (secondary report — verify by network capture); Google Maps SDK for Android declares collection of device/SDK metadata, crash data, IP, pseudonymous id and map-interaction events (Play data disclosure seen 2026-10-12) — must be declared in Data safety (EG-18); every SDK and endpoint enters `docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md` (U04); Lite/text-first mode loads no tiles; tile cache capped (50 MB); no analytics/ads/crash SDKs added; privacy notice wording through EG-02; DPA/terms through EG-11.
- **Detection/signal:** NET-INVENTORY capture: every host contacted during scripted rider flows on a test device is compared with the inventory; an unknown host fails the check.
- **Residual risk:** vendor-side processing outside Wayvro control; disclosed, minimised, and reversible by switching renderer bundle (ADR-046).
- **Test:** SDK-INV, BUNDLE-SECRETS; (new) NET-INVENTORY — release build on a test device through a capturing proxy, every contacted host must be in the inventory (P3.7/P3.10).

### T3-20 Provider key leakage
- **Asset:** provider accounts (spend, standing); evaluation and production keys.
- **Attacker:** anyone reading the repo, CI logs, app binary, chat transcripts or screenshots.
- **Controls:** **server keys only in environment** — local untracked `.env` (verified git-ignored) for evaluation, managed secrets for production (Q07, Phase 7); never in Git, prompts, fixtures, reports or screenshots; gitleaks runs in CI today — verify at P3.2 that its rules match Google API key and Mapbox token formats and add custom rules if not; adapters send keys in headers where the provider supports it (Google Places (New)/Routes accept a key header) and **outbound URLs are never logged or traced** (T3-28) because some providers take tokens as query parameters; provider error bodies are mapped to stable codes, never passed through (they may echo request URLs); evaluation keys restricted by API and by server IP where possible, with console quotas (FA-06), and revoked after SP-04; **client renderer key** (only if the chosen renderer needs one) is delivered through `GET /v1/app/config`, restricted by Android package + signing certificate where the vendor supports it, and rotatable by config without an app release; separate projects/accounts for evaluation and production; never reuse the Google OAuth project (EG-06) for Maps keys.
- **Detection/signal:** gitleaks CI failure; provider console usage anomalies; budget signals.
- **Residual risk:** any client-side token is extractable from the binary or the config response — bounded by restrictions, console quotas and rotation.
- **Test:** SEC-SCAN-GITLEAKS (negative control for GCP-key and Mapbox-token formats), BUNDLE-SECRETS, LOG-GEO, FG-08.

### T3-21 Malformed or malicious provider responses
- **Asset:** API integrity; web-ops (stored XSS via address strings); memory.
- **Attacker:** compromised or misbehaving provider; DNS/TLS interception on the server path.
- **Controls:** every adapter response validated by a zod schema before normalisation; response body size cap (PROPOSED 1 MB) and timeouts; strings length-capped and stripped of control characters; numbers must be finite and non-negative; result coordinates must fall inside the Pakistan bbox; polylines simplified and capped (≤ 2 KB); unknown fields dropped; address text rendered as plain text in React Native and React (no HTML rendering paths, no `dangerouslySetInnerHTML`); TLS with system trust only; provider-specific types never leave the adapter package.
- **Detection/signal:** `GEO_PROVIDER_SCHEMA_FAIL` counts per provider/sku feed the circuit breaker as failures.
- **Residual risk:** plausible-but-wrong provider data (wrong place) — a quality issue measured in SP-04.
- **Test:** FG-03, FG-06, FG-08, CON-GEO; (new) oversized body and script-injection strings in synthetic fixtures (no real provider payloads committed).

### T3-22 Provider licence/terms violation (licence coupling)
- **Asset:** legal standing; provider account (termination risk); ability to keep cached data.
- **Attacker / cause:** Wayvro's own design or configuration drift.
- **Scenario:** Google geocoding/routes/places content displayed on or used with a non-Google map; Mapbox temporary geocoding results cached or shown on a non-Mapbox map; Google lat/lng cached beyond 30 days or shared across users beyond the permitted temporary cache; OSM attribution missing; a derived database triggering ODbL share-alike.
- **Facts (web-verified, accessed 2026-10-12, re-verify at SP-04 freeze; all CONTRACTUAL — none is enforced by the APIs; classification and URLs in `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md` §6.1):** Google Maps Platform Terms §3.2.3(e) "no use with non-Google maps"; Service Specific Terms permit Geocoding/Routes/Places without a Google map (with attribution) but **not in conjunction with a non-Google map**; latitude/longitude cacheable up to 30 consecutive days; place_id storable indefinitely. Mapbox temporary geocoding results must not be cached and geocoding responses may only be used with a Mapbox map; permanent geocoding is a separate paid SKU. OSM data requires visible "© OpenStreetMap" attribution and ODbL share-alike for derivative databases. Nominatim's public server prohibits autocomplete and systematic reverse geocoding.
- **Controls:** ADR-006 options are **licence-coherent bundles** (S1 Google, S2 Mapbox, S3 open stack, S4 terms-permitted mixes only — see `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md`); **boot-time bundle compatibility check:** each adapter declares the `GeoAdapterLicence` of `docs/phase3/PHASE3_ARCHITECTURE.md` §6 (`requiresRenderer`, `maxCacheTtlSeconds`, `cacheSharedAcrossUsers`, `attributionCode`) and `assertGeoBundle` (§6.1 there) refuses to start the API (`ProviderBindingError`, signal `GEO_LICENCE_BINDING_REFUSED`) when the bound geo adapters and the configured renderer violate any declared constraint, and the app-config endpoint never serves a renderer incompatible with the bound geo adapters; **terms-derived per-adapter TTLs** (the configured TTLs are maxima; Google lat/lng ≤ 30 days; Google Places predictions TTL 0 unless terms allow; Google route caching TTL 0 until the route-caching terms are read at P3.7; Mapbox temporary geocoding TTL 0; open stack by freshness only); storing Google/Mapbox route geometry in the 30-day quote route snapshot is a COUNSEL/terms item — only Wayvro-derived distance/duration plus open-licensed or provider-permitted geometry is kept, otherwise the geometry follows its terms-derived TTL; the pricing-only use of a provider route without display is treated as **not allowed** with a non-matching renderer unless counsel or the vendor confirms otherwise (CON-P3-16); `geo.landmark_aliases` content is founder/field-sourced, never copied from provider or OSM data; attribution strings shown wherever the bundle requires; Nominatim/Photon only self-hosted (SP-04 `geo-bench` profile); final licence reading = founder + counsel (EXTERNAL, EG-11).
- **Detection/signal:** boot refusal; config review in the ADR-006 freeze checklist.
- **Residual risk:** terms change after freeze — re-verified at each provider renewal; contractual interpretation is not an engineering decision.
- **Test:** CS-05 (TTL 0 never written); (new) CONFIG-BUNDLE — every incompatible adapter/renderer combination and every TTL above an adapter maximum refuses boot.

### T3-23 Rate-card and tax-policy insider abuse
- **Asset:** price integrity; future money (Phase 5); regulatory trust (H06, E05).
- **Attacker:** a single staff member, a compromised staff session, or two colluding staff.
- **Scenario:** silently raise per-km rates, set a zero minimum fare for friends, activate a card early, back-date effectiveness, or rewrite history.
- **Controls:** rate cards and tax policies follow the `compliance.requirement_sets` template: DRAFT → PENDING_APPROVAL → APPROVED → ACTIVE → RETIRED (or REJECTED), drafter ≠ approver enforced by a DB CHECK, one ACTIVE per (city, product) partial unique index, advisory-lock version allocation, components immutable after PENDING_APPROVAL, `effective_from` ≥ server now at activation (no back-dating), rollback = activate a **new** version cloned from a prior approved card (history never rewritten); step-up on approve/activate/rollback; every transition audited and emitted to the outbox; **sanity envelope (PROPOSED here):** each component validated against configured min/max bounds and maximum % change vs the active card — exceeding requires an explicit override reason code visible to the approver; preview diff on synthetic benchmark routes (no provider call) shown to the approver; production refuses activation of `is_synthetic` cards and of cards referencing a placeholder tax policy; new permissions `pricing.rate_card.*`, `pricing.tax_policy.*` granted only to PRICING_MANAGER (or the founder-chosen mapping, FA-10).
- **Detection/signal:** activation alerts (structured log signal; delivery channel EG-21); approver sees diff and history.
- **Residual risk:** single-operator pilots cannot satisfy two-person control (same residual as Phase 2); collusion between drafter and approver.
- **Test:** TRIG-P3, CONC-PRICING, QT-14, QT-15, AUTHZ-MATRIX (extended); (new) back-dating refused; sanity-envelope override requires a reason code.

### T3-24 Runtime-switch abuse
- **Asset:** availability of rider/driver features; safety-relevant gates.
- **Attacker:** insider, compromised staff session.
- **Scenario:** disable quoting for a whole city (DoS); enable a feature whose release gate has not passed; invent a switch key.
- **Controls:** switch keys exist only in a code registry (no arbitrary keys); **switches can only reduce capability** — no switch can disable authentication, authorisation, rate limits, budgets, zone checks or audit (PROPOSED invariant, test-enforced); DISABLE = single authorised staff with step-up, mandatory reason code, audited, outbox event, alert signal, optional `effective_until`; ENABLE = maker-checker; ENABLE of a sensitive feature additionally requires its registry gate evidence (Phase 2 `productionApprovedBy` pattern); scope ALL/RIDER/DRIVER + optional city; maintenance is the switch `platform.maintenance` with message key + expected end; clients re-read switches from server responses and never cache an "enabled" state beyond the server's.
- **Detection/signal:** every DISABLE raises an alert-level signal; dashboards in web-ops show who/why/until.
- **Residual risk:** a malicious single staff can cause an outage until another staff re-enables (maker-checker makes re-enable two-person) — PROPOSED: the original disabler may re-enable their own disable within 15 minutes as an "undo" without a checker (founder decision; listed in ADR-049).
- **Test:** API-CFG-01..06, BUD-07; (new) unknown switch key refused; the registry contains no switch able to disable a security control.

### T3-25 Version-policy abuse (bricking users)
- **Asset:** availability for every installed app; users' ability to reach legal pages, support and account deletion (U06).
- **Attacker:** insider; staff mistake.
- **Scenario:** set `min_supported_build` above every released build; block all ranges; publish a hard update with no store URL.
- **Controls (guardrails, PROPOSED in ADR-049):** `min_supported_build` ≤ latest **released** build for that platform — requires a released-build registry (gap: the earlier draft 0013 has no released-builds list; PROPOSED here: a code/config list or column maintained by the release process); `recommended_build` ≥ `min_supported_build`; `blocked_builds` ranges may never cover the latest released build; HARD_UPDATE requires a configured store URL key; **dry-run preview** showing affected-install counts by build from the hourly build-header counters before submit; maker-checker for every change; **security exception path:** a blocked range with reason SECURITY may be activated by one RELEASE_MANAGER with step-up and auto-reverts unless a checker confirms within 24 h; the HARD_UPDATE screen still allows legal pages, the web account-deletion link and support contact; server enforcement (426 `WAYVRO_E_APP_UPDATE_REQUIRED`) exempts `GET /v1/app/config`, legal, support and account-deletion routes; `effective_from` evaluated with server time.
- **Detection/signal:** 426 rate by build; alert when 426 share exceeds a threshold within an hour of a policy change.
- **Residual risk:** a correct but premature policy still frustrates users — mitigated by preview and soft-update first.
- **Test:** UNIT-POLICY, API-CFG-01..06, UPD-01/02; (new) each guardrail refuses; auto-revert of an unconfirmed SECURITY block.

### T3-26 Version-header spoofing and public app-config abuse
- **Asset:** compatibility enforcement; availability of the config endpoint.
- **Attacker:** user editing headers to dodge a hard update; bots hammering the public endpoint.
- **Controls:** headers (`X-Wayvro-App-Version`, `X-Wayvro-App-Build`, `X-Wayvro-Platform`) are **compatibility hints, not security controls** — a client lying about its build only affects itself, while every business rule stays server-authoritative; contract compatibility is maintained by additive evolution and the oasdiff gate (F-P3-09); missing headers: PROPOSED behaviour = allow + log signal while no public build exists, switch to "require" at the first public release (decision recorded in ADR-049); `GET /v1/app/config` returns only public data (no per-user data, no secrets beyond the restricted renderer token), short `Cache-Control` max-age (PROPOSED 60 s), per-IP-prefix rate limit; offline with no cached policy ⇒ app proceeds and the server enforces on the next call.
- **Detection/signal:** request rate on the public endpoint; distribution of reported builds.
- **Residual risk:** a determined user can run a blocked build against the API until an incompatible contract change rejects it — accepted.
- **Test:** QT-13, API-CFG-01..06; server latency budget for app config per `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md`.

### T3-27 Denial of wallet (aggregate)
- **Asset:** money (FD-14 envelope USD 250–300/month for the whole pilot stack).
- **Attacker:** account farms, scripted clients, leaked keys, a client bug.
- **Controls:** **by construction, maximum monthly spend per SKU ≤ its configured monthly cost cap**, because the budget check sits before every provider call and fails closed (T3-08, §6); provider-console hard quotas as a second wall where the vendor offers them (Google per-API daily quotas — FA-06); billing budget alerts (notify only — they do not cap spend); per-account and per-IP-prefix limits; session required (OTP cost per farmed account, Phase 2 T-01 controls); cache and rounding (T3-10); client-side tile usage bounded by renderer token restrictions, console quotas and the option to switch to keyless/self-hosted tiles (S3 bundle); quote rows bounded by 200/day/account and a 30-day purge of unaccepted quotes and route snapshots (EG-16 placeholder).
- **Detection/signal:** 50/80/100 % signals; daily cost estimate in `geo.provider_usage`; provider console comparison (manual weekly in Phase 3).
- **Residual risk:** vendors without hard caps (Mapbox — no console hard cap found; verify) rely on Wayvro's own counters — a counter bug could overspend; mitigated by the budget alert and a revoke-key runbook; a leaked client tile token is billed until rotated.
- **Test:** BUD-01..08, RL-01..04, QT-12; (new) hourly rollup reconciles with Valkey counters (BUD-06).

### T3-28 Logging/telemetry leakage of coordinates and geo queries
- **Asset:** precise rider location and search text (users type home addresses) — Q36.
- **Attacker / cause:** logs, traces, error reports, Valkey dumps, support tooling.
- **Controls:** existing pino key + value redaction (lat/lng/coordinates/address/geo keys and coordinate pairs) stays mandatory; geo and quote routes are logged by **route template only** — no query strings, no bodies (test-enforced); **OpenTelemetry HTTP client instrumentation must not record full outbound URLs or query parameters** (provider URLs contain search text, coordinates and sometimes keys) — span attributes scrubbed to host + route template, and error objects carrying URLs are sanitised before logging; no coordinates or query text in span attributes, metrics labels (none exist yet) or error `details`; usage rollups and budget counters contain no user identifiers (hashed account key only for top-N, PROPOSED); cache keys hashed with HMAC (T3-12); quotes store coordinates in the DB (needed for Phase 4 restore/audit) with 30-day purge; staff views show districts only (T3-33).
- **Detection/signal:** canary scans: synthetic canary coordinates, search strings and key-shaped values injected in integration tests must not appear in captured logs, spans or Valkey keys (extends Phase 2 SEC-LOG).
- **Residual risk:** provider-side logs of queries (disclosed via EG-11 DPAs and the privacy notice).
- **Test:** LOG-GEO (canaries in logs, span attributes, error bodies, audit rows, job payloads, usage rows); (new) Valkey key scan for canaries.

### T3-29 Zone/geofence data integrity
- **Asset:** correctness of every quote (E08, H10).
- **Attacker / cause:** staff error, bad import, axis-order swap, invalid geometry.
- **Controls:** `geom geometry(MultiPolygon,4326) NOT NULL CHECK (ST_IsValid(geom) AND ST_SRID(geom) = 4326)` and GiST index; hand-written SQL + migration tests per ADR-004; import validation **rejects rather than repairs** (no silent `ST_MakeValid`, CLAUDE.md §5): axis-order check (centroid inside the city envelope and the Pakistan bbox), vertex-count cap (20,000 points per zone, the `ST_NPoints` CHECK in `docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md` §6.1), area sanity bounds; **probe points:** each zone set carries founder-defined public-landmark-level probe points with expected classifications (inside/outside/excluded/airport) that must all pass before submit (PROPOSED here); zone sets immutable after APPROVED (guard trigger); maker-checker activation; `is_synthetic` and `source_reference` recorded; district geometry populated only from a founder-approved licensed source (FA-12).
- **Detection/signal:** probe failures block submission; refusal-rate jump after an activation ⇒ signal.
- **Residual risk:** a valid but wrong boundary (wrong street) — mitigated by probes and preview, not eliminated.
- **Test:** GEOM-01..07, MIG-P3, TRIG-P3 (immutability after APPROVED); (new) probe-point check blocks submission.

### T3-30 Time manipulation
- **Asset:** quote expiry, service hours, version-policy and switch windows, budget windows.
- **Attacker:** user changing the device clock or timezone.
- **Controls:** server time is authoritative for `created_at`/`expires_at`, service hours (`Asia/Karachi` IANA zone from server time), policy `effective_from`, switch `effective_until`, rate-limit and budget windows (Valkey TTLs set by the server); the client countdown uses the existing server-clock offset from the `Date` header and is display-only; GET quote returns server-computed status.
- **Detection/signal:** large client clock offset recorded as a coarse bucket (no identifiers) for UX diagnostics only.
- **Residual risk:** none for authority; display may be off by network latency.
- **Test:** HRS-10, QT-06, PROP-HOURS, BUD-04.

### T3-31 Synthetic configuration or geo test doubles reaching production
- **Asset:** price integrity; honesty (no fake provider success, CLAUDE.md §7).
- **Controls:** synthetic geo doubles live only in the dev-only `@wayvro/provider-test-doubles` (MOCK brand) and the ART-ISO checks are extended to cover them (absent, non-resolvable, no marker strings); `bindProviders()` refuses doubles outside local/test; production refuses activation of `is_synthetic` rate cards and zone sets, placeholder tax policies, and ENABLED products on synthetic configuration; the synthetic Lahore seed is a local/test script — **not** a migration (migrations carry no synthetic pricing); Maestro test accounts exist only in local/test seeds; **release-purity gate (PROPOSED):** the Maestro E2E build is a separate x86_64 variant (release-mode JS, cleartext allowed only to the emulator loopback) and a CI check proves the gated release AAB contains none of its markers — no cleartext-traffic setting or network-security exception, no E2E build flag, no loopback API URL, no test-account seed; staging/production with missing real adapter configuration ⇒ ConfigError when the port is bound, 503 when unbound.
- **Detection/signal:** boot refusals; activation refusals.
- **Residual risk:** none known.
- **Test:** ART-ISO (extended), BOOT-NEG (extended), QT-15, AAB release-purity gate (negative control: an E2E-variant AAB must fail).

### T3-32 Benchmark/spike data leakage (SP-04, SP-01, SP-02)
- **Asset:** founder location history (home/work), provider terms (raw responses), evaluation keys, device identifiers.
- **Controls:** SP-04 raw provider responses stored only in a git-ignored local directory (proposed under the harness; never committed — terms and privacy); committed results are **aggregated metrics** plus per-case ids and public-landmark-level coordinates (≤ 3 decimals); founder GPS tracks are trimmed — start and stop logging at least 500 m away from any private home, and never include private addresses in the capture sheet (`docs/phase3/PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv` holds synthetic EXAMPLE rows only); **bench-data guard (PROPOSED for P3.2):** a check that fails if files under the SP-04 results path contain coordinates with more than 3 decimals or key-shaped strings; SP-01 logs exclude raw location trails from commits (only counts, gaps and timings); device serials/IMEIs not recorded (model + OS build only); evaluation keys revoked after SP-04 (FA-06).
- **Detection/signal:** guard failure; gitleaks.
- **Residual risk:** the founder's own driving routes are personal data — kept local and deleted after analysis (PROPOSED: delete raw tracks within 30 days of the ADR-006 freeze).
- **Test:** GITIGNORE-HARNESS; (new) bench-data guard negative control.

### T3-33 Staff quote lookup used for tracking
- **Asset:** rider movements.
- **Attacker:** curious or malicious support staff.
- **Controls:** `pricing.quote.view` is reason-gated (case reference required), city-scoped (ABAC), shows **district codes, not coordinates**, audited per view, rate-limited with page caps, no export (Phase 2 T-29 pattern); lookup by quote reference or account (after an account-level authorised view), never by area.
- **Detection/signal:** view-volume alerts per staff (Phase 2 pattern).
- **Residual risk:** district-level knowledge of a rider's search — accepted for support needs.
- **Test:** SUPPORT-QUOTE, AUTHZ-MATRIX (extended).

### T3-34 Permission over-collection and driver prompts reaching riders
- **Asset:** user privacy (U05, V05); store standing (EG-18); INV-07.
- **Attacker / cause:** a library config plugin silently adding permissions; a code path requesting location at launch.
- **Controls:** release manifest permission allowlist (`infra/ci/android/permission-allowlist.json`) changes only with founder approval (FA-02): Phase 3 adds **COARSE + FINE only**; BACKGROUND_LOCATION, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION, POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT stay forbidden; expo-location configured foreground-only (its plugin adds background/FGS permissions only when those options are enabled — Expo docs seen 2026-10-12; the manifest gate proves the result); rider request only on "use current location" tap with rationale first; approximate-only grants supported end to end; the architecture test keeps banning expo-location imports outside the designated platform module (proposed `src/platform/location/`) and keeps banning expo-task-manager / expo-background-fetch / expo-notifications in the app; iOS `NSLocationWhenInUseUsageDescription` only.
- **Detection/signal:** CI manifest gate; runtime instrumentation in SP-08 asserting no driver prompt in rider flows.
- **Residual risk:** OEM-specific permission UI differences — covered by SP-01/SP-08 device runs.
- **Test:** AAB permission gate, RIDER-HYGIENE-01, LOC-01..05, UNIT-LOCPERM; architecture import test.

## 5. Production fail-closed checklist (each item becomes a test; all NOT RUN)

1. Routing port unbound, breaker OPEN, budget exhausted, timeout or limiter store unavailable ⇒ quote refused 503 `ROUTING_UNAVAILABLE`; zero quote rows written; never an invented distance/ETA.
2. Rate-limiter or budget counter store (Valkey) unavailable ⇒ provider calls refused (fail closed, same as the Phase 2 OTP limiter); a cache read failure alone is treated as a miss **only if** limiter and budget checks succeeded.
3. MOCK-branded geo doubles refused outside local/test; absent from deployable artefacts (ART-ISO extended).
4. Real adapter bound in staging/production without its key/config ⇒ ConfigError at boot.
5. Incompatible geo-adapter/renderer bundle or an adapter TTL above its terms maximum ⇒ boot refused (`ProviderBindingError`, T3-22).
6. No ACTIVE zone set for a city ⇒ every quote `ZONE_NOT_SERVED`; no service-hours rows ⇒ closed.
7. `is_synthetic` rate card or zone set, or a placeholder tax policy, cannot be activated in production; ENABLED products on synthetic configuration refused.
8. DISABLED_LEGAL_GATE vehicle classes cannot become ENABLED products without `legal_basis_ref` + maker-checker; quote engine re-checks.
9. placeRef decrypt/AAD/expiry/account failure ⇒ request rejected (client re-searches).
10. Unknown request fields (fare, distance, duration, components) ⇒ 400 validation error.
11. Idempotency-Key missing ⇒ 400 (existing rule); reused with a different body ⇒ 409.
12. Release manifest with an unapproved permission, exported component, intent filter or URL scheme ⇒ CI fails (P3.0 gate); the gated release AAB containing any E2E-variant marker (cleartext/loopback config, E2E flag) ⇒ CI fails (release-purity gate, T3-31).
13. Runtime switch registry has no switch that disables a security control; unknown switch keys refused.
14. Map renderer token/style missing from app config ⇒ text-first (Lite) rendering, never a crash and never a hard-coded fallback key.
15. Location permission denied/approximate ⇒ manual search + pin flow remains fully usable.
16. **Deliberate fail-open (documented):** absence of any app version policy ⇒ no update enforcement (availability over enforcement — an empty policy must not brick installs); runtime-switch store unreachable at boot ⇒ code-registry defaults (sensitive features default OFF).

## 6. Cost-control table (geo SKUs)

Budget fields live in `geo.provider_budgets` (maker-checker): `daily_calls`, `monthly_calls`, `monthly_cost_micro_usd`, `alert_thresholds_pct` (default 50/80/100). Usage rollups in `geo.provider_usage` (hourly: calls, cache hits, errors, estimated cost). Signals are structured log events (no metrics SDK, F-P3-05); delivery destination is EG-21. Evaluation-phase values are set below each vendor's free allowance; production values are set at P3.7 by the founder (FA-08 if any paid tier).

| SKU (caller) | Meter key | Per-caller limits (plan values unless marked) | Cache max TTL / terms note | 50 % | 80 % | 100 % behaviour | Provider-console control (FA-06) |
|---|---|---|---|---|---|---|---|
| Autocomplete (server) | (provider, AUTOCOMPLETE) | 60/min/account; min 3 chars, 300 ms debounce; ≤ 5 results | 24 h max; Google predictions TTL 0 unless terms allow; Mapbox temporary TTL 0 | signal | signal + web-ops banner | refused ⇒ "type full address / drop pin" | Google per-API daily quota; Mapbox: none found — Wayvro counters only (verify) |
| Forward geocode / place resolution (server) | (provider, GEOCODE) / (provider, PLACE_RESOLVE) | forward geocode counts against the autocomplete limit; place resolution 30/min/account | 7 days max; Google lat/lng ≤ 30 days; Mapbox temporary TTL 0 | signal | signal | refused ⇒ manual pin | as above |
| Reverse geocode (server) | (provider, REVERSE_GEOCODE) | 30/min/account; pin settle 600 ms debounce; rounded 4 decimals | 7 days max (stale-serve ≤ 2 × TTL); terms-derived | signal | signal | refused ⇒ show coordinates-free "Pinned location" label, user may type a note | as above |
| Directions / routes (server) | (provider, ROUTE) | quotes 20/min, 200/day/account, 60/min/IP-prefix | 10 min, 15-min bucket, no stale for new quotes | signal | signal + web-ops banner | quote refused 503 `ROUTING_UNAVAILABLE` | Google per-API daily quota |
| Map tiles / style / SDK MAU (client) | renderer vendor dashboard (not server-metered) | Lite mode no tiles; SDK cache ≤ 50 MB; no periodic refresh | SDK-managed | manual weekly check in Phase 3 | — | runtime switch hides the map ⇒ text-first UI | token restrictions + vendor quota where offered; self-hosted/keyless tiles in S3 |
| SP-04 harness (dev-only) | separate evaluation project/keys | harness-side hard stop per run (PROPOSED: refuse when the next call would exceed the free allowance minus 20 %) | raw responses local only | — | — | harness stops | console quotas + budget alert; keys revoked after SP-04 |

Reference prices (web-verified 2026-10-12, planning-time only; re-verify at SP-04): Google free caps per SKU/month Essentials 10,000 / Pro 5,000 / Enterprise 1,000; Autocomplete Requests USD 2.83 per 1,000 after 10,000; Geocoding and Place Details Essentials USD 5 per 1,000; Compute Routes Essentials USD 5 per 1,000; native mobile dynamic maps no charge listed. Mapbox: 25,000 mobile MAU free then USD 4 per 1,000 MAU; temporary geocoding 100,000 free then USD 0.75 per 1,000 (uncacheable); Directions 100,000 free then USD 2 per 1,000. At pilot volume (~500 trips/day, ~8 calls/trip, Phase 0 assumption) Google geo SKUs would exceed free caps — CON-P3-04 applies.

## 7. Residual risks (accepted only by founder decision)

1. Distributed account farms can exhaust a daily geo budget and deny search/quotes to everyone until reset (availability loss; spend bounded).
2. Vendors without console hard caps rely on Wayvro counters plus billing alerts.
3. Any client-side renderer token is extractable; bounded by restrictions, quotas and rotation.
4. Device location is unverified in Phase 3 (no N18); harmless while no booking exists, revisited in Phase 4.
5. Zone and district boundaries are synthetic until FA-12; real coverage quality is unknown.
6. Single-operator pilots cannot satisfy two-person controls for rate cards, zones, switches and version policies.
7. Provider-side processing of queries and tile requests is outside Wayvro control (disclosed via EG-02/EG-11/EG-18).
8. Provider terms can change after the ADR-006 freeze; licence interpretation is EXTERNAL.
9. Until P3.0 merges, release AABs built from `main` register the `exp+wayvro` scheme (F-P3-01; no public distribution exists).
10. Route quality (wrong but plausible routes) is a measured SP-04 quality risk, not a security control.

## 8. New secrets and key classes introduced by the plan (none exist yet)

| Secret / key | Scope | Storage | Rotation |
|---|---|---|---|
| Geo provider server keys (evaluation) | SP-04 harness, local only | founder's local untracked `.env` | revoke after SP-04 (FA-06) |
| Geo provider server keys (production) | API geo adapters | managed secrets (Q07, Phase 7) | per Q07 runbook; immediate on leak |
| Client renderer token (if the bundle needs one) | mobile renderer | server config, delivered by app config | config change, no app release |
| placeRef AEAD key | API | local key in dev/test; production KMS key class under EG-05 | key versioning in AAD; overlap window = placeRef expiry |
| Cache-key HMAC key | API | dedicated `geo_cache` key class (ADR-047), same custody as the placeRef class (local in dev/test; EG-05 KMS in production) | rotation = cache flush (non-authoritative) |
