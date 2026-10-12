# PHASE3_PRICING_QUOTE_MODEL — Upfront quotes, rate cards, tax policy and maker-checker pricing configuration (PROPOSED)
**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — founder/ChatGPT plan review recorded 2026-10-12 (FA decisions in `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` §1a); no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

Requirement IDs: B04, B06, E05, H06 (primary); B03 (route/confidence display data), E07 (no invented route values), R28 (per-product pricing). ADR-013 (pricing/quote domain): FOUNDER-LOCKED scope (direction approved: upfront fixed price, FD-01/FD-02; parameters open) + PROPOSED (quote aggregate, components, rounding fields) + EXTERNAL (commission/tax/rounding values). Tables: `docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md` §6.3 (migration `0012_pricing`). The pricing engine and the quote service are authoritative server code in `apps/api/src/pricing/` (proposed); only the `Money` value object lives in the client-importable `packages/domain`. Gateway/routing: `docs/phase3/PHASE3_ARCHITECTURE.md` §5. State machine source: `docs/phase0/PHASE0_JOURNEYS_AND_STATE_MACHINES.md` SM-2.

**No real rate, fee, tax rate or rounding policy appears in this document.** Every number in §5 and §6 is SYNTHETIC, chosen only to exercise the arithmetic.

## 0. Repository truth used (verified 2026-10-12)

| Fact | Source |
|---|---|
| `Money { currency: 'PKR', minor: bigint }`; `ofMinor`, `add`, `subtract`, `multiplyByRatio(n, d, mode)`, `roundToStep(stepMinor, mode)`, `allocate`; modes `HALF_EVEN`, `HALF_UP`, `FLOOR`, `CEILING`; JSON `{currency, minor: string}`; the class carries no business rules | `packages/domain/src/money.ts` |
| Persistent idempotency per `(actor scope, key)`, SHA-256 request hash over the canonical payload, AEAD-encrypted stored response, same key + different body ⇒ 409 `WAYVRO_E_IDEMPOTENCY_CONFLICT`; a thrown handler commits nothing | `apps/api/src/platform/idempotency.ts` |
| Maker-checker template (requirement sets): drafter ≠ approver (service + CHECK), advisory-lock version allocation, one ACTIVE per scope (partial unique index), production refuses placeholders, every transition audited | `apps/api/src/compliance/compliance-admin.service.ts`, `packages/db/migrations/0004_compliance_core.sql` |
| Error envelope with optional `details.reasonCodes: string[]` and `retryAfterSeconds`; codes additive | `packages/contracts/src/errors.ts` |
| fast-check 4.10.2 is already a pinned dev dependency (`packages/domain`, `packages/server-runtime`, `packages/identity-core`, `packages/field-crypto`, `apps/api`, `apps/worker`) | workspace `package.json` files, verified 2026-10-12 — property tests add no new dependency |
| No pricing, quote, rate-card or tax object exists | repository search |

## 1. Concepts

| Concept | Definition |
|---|---|
| Rate card | versioned, maker-checker configuration per (city, product): header (`pricing.rate_cards`) + immutable values (`pricing.rate_card_components`) |
| Tax policy | versioned, maker-checker configuration of one tax treatment (`rate_bp`, `applies_to`, `inclusive`, rounding mode, placeholder flag), referenced by rate cards |
| Toll policy | per rate card: `NOT_APPLICABLE` or `EXCLUDED_DISCLOSED` (tolls not in the price; rider told) |
| Quote | one priced option for one product, own aggregate in schema `pricing` (CON-P3-09); immutable except status |
| Quote group (quote set) | all options returned by one `POST /v1/quotes`; share one route snapshot and one `quote_group_id` |
| Route snapshot | the routing result the prices were computed from (provider key, SKU, fetch time, cache status, confidence, distance, duration, simplified polyline). The 30-day quote record keeps Wayvro-derived `distance_m`/`duration_s`; the polyline is stored only if it is open-licensed or the bound vendor's terms permit storing it (storing Google/Mapbox route geometry for 30 days is a COUNSEL/terms item; otherwise the geometry follows the terms-derived TTL — `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md` §8) |
| Component | one signed line of the price (`BASE`, `DISTANCE`, `TIME`, `BOOKING_FEE`, `AIRPORT_FEE`, `MINIMUM_ADJUSTMENT`, `TOLL`, `TAX`, `DISCOUNT` (reserved), `ROUNDING`); Σ components = total |
| Pricing engine version | code version of the formula (`pe-v1`); any formula change ships as a new version, recorded on every quote |
| Expiry | `expires_at = created_at + quote_ttl_seconds`, both server time |
| Synthetic config | any zone set, rate card, tax policy or eligibility rule with `is_synthetic`/`is_placeholder`; never usable in staging/production |

## 2. Rate card structure (values PROPOSED as fields, never as numbers)

| Field | Type | Meaning |
|---|---|---|
| `base_minor` | bigint ≥ 0 | fixed start amount |
| `per_km_minor` | bigint ≥ 0 | per kilometre of routed distance |
| `per_min_minor` | bigint ≥ 0 | per minute of routed duration |
| `minimum_fare_minor` | bigint ≥ 0, multiple of `rounding_step_minor` | floor for BASE + DISTANCE + TIME |
| `booking_fee_minor` | bigint ≥ 0 | per-quote fee (0 ⇒ not emitted) |
| `airport_pickup_fee_minor` | bigint ≥ 0 | applied when the pickup snapped to an AIRPORT pickup point in an AIRPORT_PRECINCT zone |
| `rounding_step_minor`, `rounding_mode` | bigint 1..10000, mode | final rounding (CON-P3-10: step and mode are data; real values FA-15) |
| `toll_policy` | `NOT_APPLICABLE` / `EXCLUDED_DISCLOSED` | §3.2 |
| `tax_policy_id` | FK, APPROVED at submission | §3.1 |
| `quote_ttl_seconds` | 60..1800 | expiry |
| `max_distance_m`, `max_duration_s` | int | longer routes ⇒ product `unavailable` with `ROUTE_TOO_LONG` |
| header: `is_synthetic`, `source_reference`, `effective_from/until`, `scheduled`, `supersedes_id`, maker/checker ids, `version_lock` | | lifecycle §8 |

## 3. Policies

### 3.1 Tax policy

| Aspect | Rule |
|---|---|
| Fields | `rate_bp` (0..10000), `applies_to` ⊆ {BASE, DISTANCE, TIME, MINIMUM_ADJUSTMENT, BOOKING_FEE, AIRPORT_FEE}, `inclusive`, `rounding_mode` (default HALF_EVEN), `jurisdiction_code`, `legal_reference`, `is_placeholder` |
| Exclusive (`inclusive = false`) | `TAX = round(Σ taxable components × rate_bp / 10000, rounding_mode)` emitted as a component and included in Σ |
| Inclusive (`inclusive = true`) | amounts already contain tax; no additive TAX component; the option carries a disclosure `taxIncluded {rateBp, amount}` computed as `taxable × rate_bp / (10000 + rate_bp)` with the policy's rounding mode — informational, **not** part of Σ |
| Always emitted | when the rate card references a tax policy, an exclusive TAX line is emitted even at 0 bp, with `basis {taxPolicyId, version, rateBp, isPlaceholder}`, so the tax treatment is visible and auditable |
| Production | activation of a rate card whose tax policy `is_placeholder` is refused in production (service) and pricing with it is refused (defence in depth) |
| Real values | tax base, rate and whether fares or only commission are taxable are EXTERNAL decisions (accountant/counsel; `docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md` §6; FA-15) |

### 3.2 Toll policy

`NOT_APPLICABLE`: no TOLL line. `EXCLUDED_DISCLOSED`: TOLL line with amount 0 and `basis {policy: "EXCLUDED_DISCLOSED"}`; the option carries `tollPolicy: "EXCLUDED_DISCLOSED"` and the client shows the disclosure text key ("Tolls, if any, are not included"). No toll detection, toll pricing or toll-road routing preference in Phase 3.

### 3.3 Discount

`DISCOUNT` is a reserved component kind (DB CHECK admits it, amount ≤ 0). The Phase-3 engine never emits it; a test asserts no Phase-3 quote contains it. Promotions are Phase 9.

### 3.4 Airport fee

Applied iff the pickup lies in an `AIRPORT_PRECINCT` zone applicable to the product, was snapped to an `AIRPORT` pickup point, and `airport_pickup_fee_minor > 0`. Drop-off at an airport adds nothing in Phase 3. Real airport charges/permits are EXTERNAL; the synthetic fee in §5 is not a real charge.

### 3.5 Minimum fare

`MINIMUM_ADJUSTMENT = max(0, minimum_fare_minor − (BASE + DISTANCE + TIME))`, emitted only when > 0. Fees, toll and tax are outside the minimum.

### 3.6 Rounding

Final rounding of the pre-rounding total through `Money.roundToStep(rounding_step_minor, rounding_mode)`; `ROUNDING = rounded − preRounding` (signed), emitted only when ≠ 0. Intermediate fractions (distance, time, tax) use `Money.multiplyByRatio(…, mode)` — the only rounding paths. Because `minimum_fare_minor` is a multiple of the step and rounding is monotone, the total is never below the minimum fare (property P-04).

## 4. Algorithm (pricing engine `pe-v1`, pure; quote service around it)

Inputs: session account, `cityCode`, pickup/drop-off coordinates (± `placeRef` labels), optional `products`, optional `detail=lite`. The request schema is strict: any client-supplied fare, total, distance, duration or component field is rejected with 400 `WAYVRO_E_VALIDATION` (never read).

| Step | Work | Failure |
|---|---|---|
| 1 | rate limits (account/min, account/day, IP prefix/min) — before idempotency, so replays also count | 429 `WAYVRO_E_RATE_LIMITED`, `reasonCodes:["QUOTE_RATE_LIMITED"]`; limiter down ⇒ 503 (fail closed) |
| 2 | runtime switch `rider.quotes` not in safe state; account not restricted for rider use; city ENABLED | 503 `WAYVRO_E_FEATURE_DISABLED` / 403 `WAYVRO_E_ACCOUNT_RESTRICTED` |
| 3 | `idempotency.execute(scope "acct:<id>", operation "quotes.create", key, canonical body + detail)` | same key + different body ⇒ 409 `WAYVRO_E_IDEMPOTENCY_CONFLICT`; replay ⇒ stored response |
| 4 | validate coordinates: WGS84 range, normalise to 6 decimals, inside the coarse Pakistan bbox; pickup ≠ drop-off (≥ 50 m apart) | 400 `WAYVRO_E_VALIDATION` (`OUTSIDE_COUNTRY`, `SAME_POINT`) |
| 5 | resolve ACTIVE zone set of the city (server time `now`, one read per request) | none ACTIVE ⇒ 422 `WAYVRO_E_SERVICE_AREA` `ZONE_NOT_SERVED` |
| 6 | per candidate product (ENABLED ∩ requested): pickup and drop-off served (SERVICE_AREA covers incl. boundary, no EXCLUSION intersects incl. boundary); pickup in PICKUP_RESTRICTED or AIRPORT_PRECINCT ⇒ snap to the nearest ACTIVE pickup point of that zone within `PICKUP_SNAP_MAX_METERS` (AIRPORT kind for airports) | product `unavailable`: `ZONE_NOT_SERVED` / `PICKUP_RESTRICTED` |
| 7 | service hours at `now` in Asia/Karachi (product rows beat general rows; no rows ⇒ closed; open = close ⇒ 24 h) | product `unavailable`: `OUTSIDE_SERVICE_HOURS` |
| 8 | ACTIVE rate card + APPROVED tax policy present; production: none synthetic/placeholder | product `unavailable`: `NO_ACTIVE_RATE_CARD`; production synthetic ⇒ 503 + signal `QUOTE_SYNTHETIC_CONFIG_REFUSED` |
| 9 | if no product remains ⇒ refuse | 422 `WAYVRO_E_SERVICE_AREA`, `reasonCodes` = distinct reasons |
| 10 | ONE routing call: snapped pickup → drop-off, profile `CAR` (BIKE/RICKSHAW are never ENABLED in Phase 3), 15-min departure bucket; route cache ≤ 10 min (never stale; Google route caching TTL 0 until its route-caching terms are read at P3.7); **single attempt, no retry**, timeout = min(`GEO_ROUTE_TIMEOUT_MS` 2,500 ms, remaining overall quote deadline `QUOTE_DEADLINE_MS` 3,000 ms) — PROPOSED, ADR-047 | unbound/breaker/budget/timeout/deadline exceeded ⇒ **throw** 503 `WAYVRO_E_DEPENDENCY_UNAVAILABLE` `ROUTING_UNAVAILABLE` (no idempotency record; same key may retry; nothing invented) |
| 11 | per product: `distance_m > max_distance_m` or `duration_s > max_duration_s` ⇒ unavailable `ROUTE_TOO_LONG`; if none remains ⇒ 422 `ROUTE_TOO_LONG` | |
| 12 | engine per product (pure, §4.1) | engine invariant violation ⇒ 500 (bug), nothing persisted |
| 13 | transaction: `pg_advisory_xact_lock(hashtext('wayvro.quote:' ‖ account))`; mark the account's older `PRICED` unexpired quotes `SUPERSEDED`; insert route snapshot, quotes, components (deferred Σ check); complete idempotency record (encrypted response) | DB error ⇒ rollback, 500/503 |
| 14 | respond 201 | |

### 4.1 Engine `pe-v1` (per product)

```text
inputs: card (components), tax policy, distance_m, duration_s, airportPickup (bool)
BASE      = card.base_minor
DISTANCE  = Money(card.per_km_minor).multiplyByRatio(distance_m, 1000, HALF_EVEN)
TIME      = Money(card.per_min_minor).multiplyByRatio(duration_s, 60, HALF_EVEN)
trip      = BASE + DISTANCE + TIME
MIN_ADJ   = max(0, card.minimum_fare_minor − trip)                       (emit if > 0)
BOOKING   = card.booking_fee_minor                                      (emit if > 0)
AIRPORT   = airportPickup ? card.airport_pickup_fee_minor : 0           (emit if > 0)
TOLL      = 0 when toll_policy = EXCLUDED_DISCLOSED                     (emit, amount 0); absent when NOT_APPLICABLE
taxable   = Σ of the emitted components whose kind ∈ taxPolicy.applies_to
TAX       = exclusive ? Money(taxable).multiplyByRatio(rate_bp, 10000, taxPolicy.rounding_mode) : (not emitted)
preRound  = BASE + DISTANCE + TIME + MIN_ADJ + BOOKING + AIRPORT + TOLL + TAX
total     = preRound.roundToStep(card.rounding_step_minor, card.rounding_mode)
ROUNDING  = total − preRound                                            (emit if ≠ 0)
assert Σ components = total ∧ total ≥ 0 ∧ no DISCOUNT
component seq order: BASE 1, DISTANCE 2, TIME 3, MINIMUM_ADJUSTMENT 4, BOOKING_FEE 5, AIRPORT_FEE 6, TOLL 7, TAX 8, ROUNDING 9
basis (ids/numbers only): DISTANCE {distanceM, perKmMinor}, TIME {durationS, perMinMinor}, TAX {taxPolicyId, version, rateBp, isPlaceholder},
                          ROUNDING {stepMinor, mode}, AIRPORT_FEE {pickupPointId}, TOLL {policy}
```

The engine imports only `Money` and plain data; it never reads time, the database or the network (determinism, P-05).

## 5. Synthetic Lahore configuration (local/test only; production refuses it)

All values SYNTHETIC — chosen to exercise the arithmetic, not derived from any market price, regulation or tax rate.

| Field | LHR/ECONOMY synthetic v1 | LHR/COMFORT synthetic v1 |
|---|---|---|
| `base_minor` | 10000 (PKR 100.00) | 15000 |
| `per_km_minor` | 3500 | 5000 |
| `per_min_minor` | 500 | 700 |
| `minimum_fare_minor` | 25000 | 35000 |
| `booking_fee_minor` | 1000 | 1000 |
| `airport_pickup_fee_minor` | 20000 | 20000 |
| `rounding_step_minor` / mode | 1000 (PKR 10) / HALF_UP (CON-P3-10, labelled synthetic) | same |
| `toll_policy` | EXCLUDED_DISCLOSED | EXCLUDED_DISCLOSED |
| tax policy | `SYNTH-TAX-0` v1: 0 bp, exclusive, `is_placeholder = true` | same |
| `quote_ttl_seconds` | 300 | 300 |
| `max_distance_m` / `max_duration_s` | 60000 / 7200 | 60000 / 7200 |
| `is_synthetic`, `source_reference` | true, "SYNTHETIC — not a Wayvro price" | same |

Seeded only by the dev-only seed module (data-model doc §7); ECONOMY ENABLED, COMFORT CONFIGURED in local/test.

## 6. Worked SYNTHETIC examples (PKR minor units; 100 minor = PKR 1)

### Example A — standard trip, LHR/ECONOMY synthetic v1, tax `SYNTH-TAX-0` (0 bp)

Route snapshot (synthetic): `distance_m = 7351`, `duration_s = 1234`; pickup not in an airport precinct.

| seq | Kind | Computation | Amount |
|---|---|---|---|
| 1 | BASE | base | 10000 |
| 2 | DISTANCE | 3500 × 7351 / 1000 = 25728.5 → HALF_EVEN (tie; 25728 is even) | 25728 |
| 3 | TIME | 500 × 1234 / 60 = 10283.33… → HALF_EVEN | 10283 |
| — | (trip) | 10000 + 25728 + 10283 = 46011 ≥ 25000 ⇒ no MINIMUM_ADJUSTMENT | — |
| 5 | BOOKING_FEE | booking fee | 1000 |
| 7 | TOLL | EXCLUDED_DISCLOSED | 0 |
| 8 | TAX | taxable 47011 × 0 / 10000 | 0 |
| — | (preRound) | 46011 + 1000 + 0 + 0 = 47011 | — |
| 9 | ROUNDING | roundToStep(1000, HALF_UP): 47011 → 47000; 47000 − 47011 | −11 |
| | **Total** | | **47000 (PKR 470.00)** |

Σ check: 10000 + 25728 + 10283 + 1000 + 0 + 0 − 11 = 47000 ✓. Total is a multiple of 1000 ✓; ≥ minimum 25000 ✓.

### Example B — short airport pickup, LHR/ECONOMY synthetic v1, TEST-ONLY tax policy `SYNTH-TAX-10` (1000 bp exclusive, `applies_to` = BASE, DISTANCE, TIME, MINIMUM_ADJUSTMENT, BOOKING_FEE; AIRPORT_FEE deliberately not taxable; 1000 bp is a synthetic test value, not a Pakistani tax rate)

Route snapshot (synthetic): `distance_m = 2100`, `duration_s = 420`; pickup snapped to the synthetic AIRPORT pickup point.

| seq | Kind | Computation | Amount |
|---|---|---|---|
| 1 | BASE | base | 10000 |
| 2 | DISTANCE | 3500 × 2100 / 1000 (exact) | 7350 |
| 3 | TIME | 500 × 420 / 60 (exact) | 3500 |
| 4 | MINIMUM_ADJUSTMENT | trip = 20850 < 25000 ⇒ 25000 − 20850 | 4150 |
| 5 | BOOKING_FEE | booking fee | 1000 |
| 6 | AIRPORT_FEE | airport pickup fee | 20000 |
| 7 | TOLL | EXCLUDED_DISCLOSED | 0 |
| 8 | TAX | taxable = 10000 + 7350 + 3500 + 4150 + 1000 = 26000; 26000 × 1000 / 10000 (exact) | 2600 |
| — | (preRound) | 26000 + 20000 + 0 + 2600 = 48600 | — |
| 9 | ROUNDING | roundToStep(1000, HALF_UP): 48600 → 49000 | +400 |
| | **Total** | | **49000 (PKR 490.00)** |

Σ check: 10000 + 7350 + 3500 + 4150 + 1000 + 20000 + 0 + 2600 + 400 = 49000 ✓.

Both examples become golden unit tests of `pe-v1` (with the same synthetic inputs), alongside the property tests in §13.

## 7. Expiry, server time and the SM-2 Phase-3 subset

- `created_at` = one server timestamp per request (database `now()` of the quote transaction); `expires_at = created_at + quote_ttl_seconds` per product (cards may differ). Device time is never used; the mobile countdown uses the existing server-clock offset and is display-only.
- SM-2 (`docs/phase0/PHASE0_JOURNEYS_AND_STATE_MACHINES.md`) Phase-3 subset:

| From | To | Trigger | Where |
|---|---|---|---|
| (none) | PRICED | `POST /v1/quotes` success | quote transaction |
| PRICED | EXPIRED | `now ≥ expires_at` | computed lazily on read (`status` reported as EXPIRED), persisted in bounded batches by `maintenance.purge` |
| PRICED | SUPERSEDED | the same account creates a new quote group | same transaction as the new group (advisory lock per account ⇒ at most one live group per account) |
| EXPIRED / SUPERSEDED | (deleted) | retention (30 days placeholder, EG-16) | `maintenance.purge` |

`DRAFT` is not persisted (a quote exists only once priced). `ACCEPTED` (bound to a ride request) is added additively in Phase 4; Phase 4 accepts only `PRICED`, unexpired, non-superseded quotes and binds exactly one quote version (SM-2 invariant).

## 8. Contracts (PROPOSED sketches; zod in `packages/contracts/src/pricing.ts`)

### 8.1 `POST /v1/quotes` (session, `Idempotency-Key` required; optional `?detail=lite`)

Request (strict object):

```json
{
  "cityCode": "LHR",
  "pickup":  { "lat": 31.593, "lng": 74.310, "placeRef": "pr1.<sealed>" },
  "dropoff": { "lat": 31.513, "lng": 74.333 },
  "products": ["ECONOMY", "COMFORT"]
}
```

(Synthetic coordinates at public-landmark level, 3 decimals. `placeRef` optional: validated (owner, expiry; invalid, foreign or expired ⇒ 400 `WAYVRO_E_VALIDATION` with `PLACE_REF_INVALID` / `PLACE_REF_EXPIRED`, no provider call) and used only to label the option; never used for pricing, never resolved through a provider call in `POST /v1/quotes`, never persisted. `products` optional: default = all ENABLED. Request schemas are strict: any client-supplied fare, total, distance, duration or component ⇒ 400 `WAYVRO_E_VALIDATION`.)

Response 201:

```json
{
  "quoteGroupId": "0192f3c4-…",
  "createdAt": "2026-10-12T09:00:00.000Z",
  "pickup": { "snappedTo": null },
  "route": {
    "distanceM": 7351, "durationS": 1234,
    "polyline": "<encoded, simplified, ≤ 2 KB; omitted when detail=lite>",
    "confidence": "MEDIUM",
    "source": { "providerKey": "geo-a", "fetchedAt": "2026-10-12T09:00:00.000Z", "cacheStatus": "MISS", "attributionCode": null }
  },
  "options": [
    {
      "quoteId": "0192f3c4-…", "productCode": "ECONOMY", "status": "PRICED",
      "total": { "currency": "PKR", "minor": "47000" },
      "components": [
        { "kind": "BASE", "amount": { "currency": "PKR", "minor": "10000" } },
        { "kind": "DISTANCE", "amount": { "currency": "PKR", "minor": "25728" }, "basis": { "distanceM": 7351, "perKmMinor": "3500" } },
        { "kind": "TIME", "amount": { "currency": "PKR", "minor": "10283" }, "basis": { "durationS": 1234, "perMinMinor": "500" } },
        { "kind": "BOOKING_FEE", "amount": { "currency": "PKR", "minor": "1000" } },
        { "kind": "TOLL", "amount": { "currency": "PKR", "minor": "0" }, "basis": { "policy": "EXCLUDED_DISCLOSED" } },
        { "kind": "TAX", "amount": { "currency": "PKR", "minor": "0" }, "basis": { "rateBp": 0, "isPlaceholder": true } },
        { "kind": "ROUNDING", "amount": { "currency": "PKR", "minor": "-11" }, "basis": { "stepMinor": "1000", "mode": "HALF_UP" } }
      ],
      "taxIncluded": null,
      "tollPolicy": "EXCLUDED_DISCLOSED",
      "expiresAt": "2026-10-12T09:05:00.000Z",
      "rateCardVersion": 1,
      "pricingEngineVersion": "pe-v1",
      "display": { "nameKey": "product.economy.name", "seatsMax": 4, "luggageClass": "STANDARD" },
      "isSynthetic": true
    }
  ],
  "unavailable": [ { "productCode": "COMFORT", "reasonCode": "NO_ACTIVE_RATE_CARD" } ]
}
```

(`isSynthetic` lets local/test UIs label synthetic prices; in staging/production a synthetic option cannot exist. The rider-facing confidence label and toll disclosure are rendered from codes via the localisation catalogue.)

Errors:

| HTTP | Code | `details.reasonCodes` | When |
|---|---|---|---|
| 400 | `WAYVRO_E_VALIDATION` | `OUTSIDE_COUNTRY`, `SAME_POINT`, `PLACE_REF_INVALID`, `PLACE_REF_EXPIRED` | schema/coordinate/placeRef problems; unknown fields (e.g. a client fare) |
| 401 | `WAYVRO_E_UNAUTHENTICATED` | — | no session |
| 403 | `WAYVRO_E_ACCOUNT_RESTRICTED` | restriction reason codes (existing) | account-wide restriction |
| 409 | `WAYVRO_E_IDEMPOTENCY_CONFLICT` | — | same key, different body |
| 422 | `WAYVRO_E_SERVICE_AREA` (NEW, proposed) | `ZONE_NOT_SERVED`, `PICKUP_RESTRICTED`, `OUTSIDE_SERVICE_HOURS`, `ROUTE_TOO_LONG`, `NO_ACTIVE_RATE_CARD` | no product can be quoted |
| 426 | `WAYVRO_E_APP_UPDATE_REQUIRED` (NEW, proposed) | — | app-version gate |
| 429 | `WAYVRO_E_RATE_LIMITED` | `QUOTE_RATE_LIMITED` | limits; `retryAfterSeconds` |
| 503 | `WAYVRO_E_DEPENDENCY_UNAVAILABLE` | `ROUTING_UNAVAILABLE` | routing unbound/down/over budget/timed out, overall quote deadline exceeded, limiter down |
| 503 | `WAYVRO_E_FEATURE_DISABLED` | — | `rider.quotes` switch in safe state |
| 503 | `WAYVRO_E_MAINTENANCE` (NEW, proposed) | — | maintenance switch |

Only `WAYVRO_E_SERVICE_AREA`, `WAYVRO_E_APP_UPDATE_REQUIRED` and `WAYVRO_E_MAINTENANCE` are new codes; everything else is a reason code inside the existing envelope.

### 8.2 Idempotency semantics

| Case | Result |
|---|---|
| same key + same canonical body (+ same `detail`) within `QUOTE_IDEMPOTENCY_TTL_SECONDS` (900 s) | replay of the stored 201 body, byte-identical (may now be expired — the client compares `expiresAt` with server time and re-quotes with a NEW key) |
| same key + different body | 409 `WAYVRO_E_IDEMPOTENCY_CONFLICT` |
| concurrent duplicate | blocks on the idempotency row; then replays the committed outcome or executes after a rollback (existing mechanism) |
| 422 service-area refusal | recorded as an error outcome and replayed for the same key (state-dependent; a later attempt uses a new key) |
| 503 routing unavailable | thrown ⇒ nothing recorded ⇒ the same key retries for real |
| 429 | evaluated before the idempotency lookup; replays count against limits |

### 8.3 `GET /v1/quotes/{quoteGroupId}` (restore; owner only)

Returns the same shape as 201 with each option's `status` computed at read time (`PRICED` | `EXPIRED` | `SUPERSEDED`). Non-owner or purged ⇒ 404 `WAYVRO_E_NOT_FOUND` (no existence oracle). `?detail=lite` omits the polyline. Mobile restore: an EXPIRED or SUPERSEDED group shows "Prices updated — get a new price" (no silent re-quote).

## 9. Maker-checker, activation and rollback (H06)

| Transition | Who (permission) | Step-up | Rules |
|---|---|---|---|
| draft tax policy | `pricing.tax_policy.draft` | no | version via advisory lock; `is_placeholder` required unless `legal_reference` set |
| submit → PENDING_APPROVAL | drafter | no | values frozen (guard trigger) |
| approve / reject tax policy | `pricing.tax_policy.approve`, ≠ drafter | yes | REJECTED is terminal; APPROVED becomes referenceable |
| retire tax policy | `pricing.tax_policy.approve` | yes | refused while an ACTIVE card references it |
| draft rate card (new or from an existing card) | `pricing.rate_card.draft` | no | city ABAC (staff city scope, existing `citiesFor`); components editable only in DRAFT |
| submit | `pricing.rate_card.submit` (drafter) | no | tax policy must be APPROVED; card values frozen; preview attached automatically (§10) |
| approve / reject | `pricing.rate_card.approve`, ≠ drafter, city scope | yes | approval reason code required |
| activate now | `pricing.rate_card.activate` | yes | APPROVED → ACTIVE; previous ACTIVE → RETIRED (`effective_until = now`), one transaction; production: refuses `is_synthetic` cards and placeholder tax policies; outbox `pricing.rate-card.activated.v1`; audit |
| schedule activation | `pricing.rate_card.activate` | yes | sets `effective_from` (future) + `scheduled`; worker `config.scheduled-activation` activates at that time re-checking every rule; cancellable while APPROVED |
| rollback | `pricing.rate_card.rollback` (maker) then `pricing.rate_card.approve` (≠ maker) | yes | creates a NEW version cloned from a previously APPROVED/RETIRED card (`supersedes_id` = source), goes through PENDING_APPROVAL → APPROVED → ACTIVE; history is never rewritten; existing quotes keep their original card version |
| emergency stop | `catalog.product.suspend` (single staff, safe direction) or runtime switch `rider.quotes` | yes | stops quoting a product/city immediately while a corrected card goes through maker-checker |
| view quotes (support) | `pricing.quote.view` | no; access reason required (W07 pattern, `staff.access_reasons`) | shows product, district codes, amounts, components, card version, status, timestamps — never coordinates or polyline |

Roles (FA-10 APPROVED 2026-10-12): dedicated least-privilege role `PRICING_MANAGER` (draft/submit/rollback-request), with approval by a **second, distinct** `PRICING_MANAGER` (maker ≠ checker); pricing permissions are not added to `COMPLIANCE_ADMIN`/`STAFF_ADMIN`. Real maker-checker needs two distinct human actors before exposure; synthetic test staff are allowed in development. `AUDITOR` gets read-only views of configuration history.

## 10. Preview tool (staff)

`POST /v1/admin/pricing/previews` (Idempotency-Key; no persistence besides an audit event): input = up to 3 rate-card ids (any status, e.g. DRAFT vs ACTIVE) + up to 50 benchmark tuples `{label, distanceM, durationS, airportPickup}`; output = per tuple per card the full component breakdown and the delta vs the first card. No provider call, no quote row, no coordinates. A code-defined SYNTHETIC default benchmark set (≈ 12 tuples across short/medium/long, peak-like duration, airport) is used when no tuples are supplied; once SP-04 has run, Wayvro-derived distance/duration numbers (never raw provider responses) may be pasted as tuples. Submission of a card stores the default-set preview result in the audit trail so the approver sees the price impact.

## 11. Audit and configuration history

- Every transition writes `audit.audit_events` (actions such as `TAX_POLICY_DRAFTED|SUBMITTED|APPROVED|REJECTED|RETIRED`, `RATE_CARD_DRAFTED|SUBMITTED|APPROVED|REJECTED|ACTIVATED|SCHEDULED|SCHEDULE_CANCELLED|RETIRED|ROLLBACK_REQUESTED`, `RATE_CARD_PREVIEWED`, `QUOTE_VIEWED_BY_STAFF`) with object ids and reason codes only.
- Configuration rows are never deleted or edited after DRAFT (guard triggers); RETIRED/REJECTED rows remain as history. A rate card's full history = its version chain (`version`, `supersedes_id`) + audit events.
- Each quote records `rate_card_id`, `rate_card_version`, `pricing_engine_version`, `zone_set_id`, `route_snapshot_id` ⇒ any quote can be recomputed exactly by replaying `pe-v<n>` on the stored inputs (property P-05; replay test).

## 12. Not in Phase 3

Bidding/counter-offers (Phase 9), surge/dynamic pricing, promotions/discounts (Phase 9), fare adjustment on the actual driven route or destination change (Phase 5), waiting/cancellation fees, commission and driver earnings split, operational ledger, payments/receipts, quote acceptance (`ACCEPTED`, Phase 4), metered/estimate pricing when routing is down (CON-P3-08 — refuse instead), multi-currency, fuel-indexed revisions (E20), real rates or tax values.

## 13. Open founder / accounting decisions (FA-15 and related)

| ID | Decision | Phase-3 default | Needed by |
|---|---|---|---|
| FA-15a | rounding step and mode (e.g. PKR 10 HALF_UP or exact) | data field; synthetic PKR 10 HALF_UP | pilot (Phase 8) |
| FA-15b | tax base, rate, inclusive vs exclusive, which components are taxable, tax rounding | 0 bp placeholder | pilot (Phase 8); accountant/counsel |
| FA-15c | toll treatment (excluded-disclosed vs priced) | EXCLUDED_DISCLOSED | pilot |
| FA-15d | whether rounding happens before or after tax (pe-v1: after tax) | after tax | accountant review |
| FA-15e | real rate-card values per product, minimum fare, booking fee, airport fee | synthetic only | pilot |
| FA-15f | quote TTL | 300 s synthetic | pilot |
| FA-10 | pricing roles vs mapping | **APPROVED 2026-10-12**: 3 dedicated roles | decided |
| FA-12 | real zone boundaries/airport precinct | **DECIDED 2026-10-12**: synthetic geometry in Phase 3; real licensed boundaries later | pilot |

## 14. Property-test invariants (fast-check, already a pinned dev dependency)

| ID | Invariant |
|---|---|
| P-01 | Σ component amounts = total, for every generated card/route within CHECK bounds |
| P-02 | total ≥ 0 and total ≡ 0 (mod rounding step) |
| P-03 | `|ROUNDING| < step`; for HALF_UP/HALF_EVEN `|ROUNDING| ≤ step / 2` |
| P-04 | total ≥ minimum_fare_minor (minimum is a step multiple, all other components ≥ 0) |
| P-05 | determinism: identical inputs (card, tax policy, route numbers, airport flag) ⇒ identical component list (kinds, seq, amounts, basis) and total |
| P-06 | monotonicity: increasing distance (duration fixed) or duration (distance fixed) never decreases the total |
| P-07 | only ROUNDING may be negative; DISCOUNT never emitted; component kinds unique per quote |
| P-08 | exclusive TAX equals `multiplyByRatio(taxable, rate_bp, 10000, mode)` exactly; inclusive tax never enters Σ |
| P-09 | zero per-km/per-min ⇒ DISTANCE/TIME = 0 and still emitted |
| P-10 | bigint safety: max inputs within CHECK bounds (10^7 × 2·10^5) never exceed 2^53 when serialised as strings and never lose precision |
| P-11 | all options of one group share one route snapshot and one `created_at` |
| P-12 | `expires_at − created_at = quote_ttl_seconds` exactly |
| P-13 | idempotent replay returns a byte-identical body; same key + different body ⇒ 409 (integration) |
| P-14 | the engine never prices when distance/duration exceed the card's maxima (reported `ROUTE_TOO_LONG`) |
| P-15 | money never passes through `number`: amounts in contracts are decimal strings of minor units (contract test) |

Concurrency tests (integration, real PostgreSQL): two concurrent quote creations for one account ⇒ exactly one group remains PRICED; concurrent activation of two APPROVED cards for one (city, product) ⇒ exactly one ACTIVE (partial unique index + advisory lock); scheduled activation racing a manual activation ⇒ one winner, the other a clean 409.
