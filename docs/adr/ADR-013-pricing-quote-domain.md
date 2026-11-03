# ADR-013 — Pricing and quote domain: upfront fixed quotes, rate cards, tax policy, maker-checker configuration

| Field | Value |
|---|---|
| Status | **ACCEPTED-ON-EVIDENCE (P3.3, local) — pending founder/ChatGPT review of the Phase-3 branch.** Only the clauses proven by the tests listed under *Evidence* are accepted. Every rate, fee, tax rate, rounding step/mode, toll treatment and quote TTL value stays **EXTERNAL** (FA-15a–f: founder + accountant/counsel); Phase 3 runs on SYNTHETIC values only. |
| Date | 2026-10-13 |
| Supersedes | the ADR-013 backlog/proposal entries in `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md` and `docs/phase3/PHASE3_PRICING_QUOTE_MODEL.md` (PROPOSED) |
| Requirements | B04, B06, E05, H06 (primary); B03 (route summary/confidence on the quote), E07 (no invented values), R28 (per-product pricing); threat model T3-03..T3-06, T3-13, T3-16, T3-23, T3-30, T3-31, T3-33 |
| Founder decisions | FD-01/FD-02 (upfront fixed price, direction approved); FA-10 (dedicated PRICING_MANAGER role, maker ≠ checker, APPROVED 2026-10-12); FA-15 (values) OPEN |
| Evidence | `packages/db/migrations/0012_pricing.sql`; `packages/db/test/pricing.integration.test.ts`; `apps/api/src/pricing/**`; `apps/api/test/pricing-engine.test.ts`, `quotes.integration.test.ts`, `quote-tamper.integration.test.ts`, `pricing-admin.integration.test.ts`, `catalog-admin.integration.test.ts`, `staff.integration.test.ts` (AUTHZ-MATRIX), `app.test.ts` (route table); `apps/worker/src/release/rate-card-activator.ts`, `apps/worker/src/maintenance.ts`, `apps/worker/test/pricing.integration.test.ts`; `packages/test-support/src/synthetic-catalog-seed.ts` |

## Context
Phase 3 must show a rider an exact, server-authoritative upfront price per eligible product (B04/B06), keep an exact, replayable snapshot of how each price was computed (E05), and let staff version, approve, activate and roll back price configuration under two-person control (H06). No real rate, fee or tax value exists (FA-15), routing may be unavailable (E07: never estimate), and a modified client must never influence an amount (T3-03).

## Alternatives
1. **Client-side or edge pricing** — rejected: the server is authoritative for money (CLAUDE.md §5); a client-computed fare cannot be trusted (T3-03/T3-16).
2. **Metered / estimate pricing when routing is down** — rejected (CON-P3-08): refuse with 503 `ROUTING_UNAVAILABLE` instead; nothing is invented.
3. **Floating-point money or a generic decimal library** — rejected: bigint minor units through the existing `Money` value object; JSON carries decimal strings.
4. **A generic approvals table** — rejected (Phase-2 precedent): each configuration table carries its own maker-checker columns, enforced by CHECKs and guard triggers.
5. **Chosen:** a pure server-only engine `pe-v1` + a quote service around it, a separate `pricing` schema (own aggregate, CON-P3-09) and maker-checker rate cards/tax policies modelled on the zone-set/requirement-set template.

## Decision
1. **Engine `pe-v1`** (`apps/api/src/pricing/engine.ts`) is pure and deterministic (imports only `Money`; enforced by the dependency-cruiser rule `pricing-engine-purity`): BASE, DISTANCE (`per_km × m / 1000`, HALF_EVEN), TIME (`per_min × s / 60`, HALF_EVEN), MINIMUM_ADJUSTMENT, BOOKING_FEE, AIRPORT_FEE (pickup snapped to an AIRPORT point of an AIRPORT_PRECINCT), TOLL (0, EXCLUDED_DISCLOSED), exclusive TAX always emitted (even 0 bp) or inclusive disclosure outside Σ, final `roundToStep(step, mode)` → ROUNDING; Σ components = total; only ROUNDING negative; DISCOUNT reserved and never emitted; routes beyond the card's maxima are `ROUTE_TOO_LONG`, never priced. Any formula change ships as a new engine version recorded on every quote.
2. **Quote service** (`POST /v1/quotes`, `GET /v1/quotes/{quoteGroupId}`): rate limits (20/min and 200/day per account, 60/min per IP prefix; configuration) before idempotency (replays count; limiter down ⇒ 503); runtime switch `rider.quotes`; persistent idempotency (scope `acct:<id>`, canonical body + `detail`; 900 s replay window); 6-decimal Pakistan-envelope coordinates ≥ 50 m apart; optional placeRefs opened (owner, city, expiry) and discarded — never a provider call, never stored, never priced; catalog read model (ACTIVE zone set, zones, hours, pickup snap) + ACTIVE rate card with an APPROVED tax policy per product; ONE routing call (single attempt inside `QUOTE_DEADLINE_MS`), thrown 503 on any failure (nothing recorded or persisted, the same key retries); one transaction under an advisory lock per account that supersedes the account's older PRICED groups, re-locks the priced cards (`FOR SHARE`), and writes the route snapshot (polyline only where vendor terms permit), quotes and components. A 422 `WAYVRO_E_SERVICE_AREA` (distinct reason codes, `nextOpenAt`) is a recorded outcome. Server time only: `created_at` = the transaction's `now()`, `expires_at = created_at + quote_ttl_seconds`; status is computed on read (PRICED → EXPIRED) and persisted by the purge. Restore is owner-only inside the SQL; foreign and unknown ids are the same 404.
3. **Database (migration 0012, schema `pricing`)**: tax policies and rate cards are versioned maker-checker rows (approver ≠ drafter by CHECK and guard; DRAFT-only inserts for application roles; values immutable after DRAFT; one ACTIVE card per (city, product) by partial unique index; no back-dated activation or past schedule; the referenced tax policy must be APPROVED at submission and activation; a tax policy referenced by an ACTIVE card cannot be retired); quotes are immutable except PRICED → EXPIRED | SUPERSEDED, created PRICED against the ACTIVE card they name; components are append-only with sign CHECKs; DEFERRED constraint triggers enforce Σ components = total and ≥ 1 component at COMMIT and tolerate a purged parent. Least-privilege grants: the API never deletes quotes, snapshots or configuration; the worker only expires/purges and activates scheduled cards.
4. **Maker-checker administration** (`/v1/admin/pricing/*`, PRICING_MANAGER; AUDITOR read-only): draft → submit (drafter) → approve/reject by a DIFFERENT manager with step-up and an approval reason → activate now (previous ACTIVE retired in one transaction; outbox `pricing.rate-card.activated.v1`; signal `RATE_CARD_ACTIVATED`) or schedule on server time (worker `config.scheduled-activation` re-checks every rule; cancellable while APPROVED); rollback = a NEW version cloned from an earlier APPROVED/RETIRED card through the full maker-checker path (history never rewritten; stored quotes keep their card version). A sanity envelope (placeholder bounds per component + `PRICING_ENVELOPE_MAX_CHANGE_PERCENT` vs the ACTIVE card) requires an explicit override reason visible to the approver. Submission records the default SYNTHETIC benchmark preview on the card. Break-glass grants no pricing permission and is never a shortcut; STAFF_ADMIN is no pricing approver.
5. **Previews and support view**: previews price numeric tuples (≤ 3 cards × ≤ 50 tuples; code-defined synthetic default set) with no provider call and no quote row, audited; the support quote lookup is reason-gated (closed reason list), audited (`QUOTE_VIEWED_BY_STAFF`) and shows district codes, amounts, components and versions — never coordinates or a polyline.
6. **Production refusals (T3-31)**: activation refuses synthetic cards and placeholder tax policies; the quote service refuses (503 + `QUOTE_SYNTHETIC_CONFIG_REFUSED`) to price with any synthetic/placeholder configuration in staging/production; synthetic pricing exists only via the dev-only seed, never a migration.
7. **Retention**: never-accepted quotes, components and unreferenced snapshots are purged after `QUOTE_RETENTION_DAYS` (placeholder 30, NOT_COUNSEL_APPROVED, EG-16); a polyline with a shorter terms-derived TTL (`polyline_expires_at`) is removed earlier.

## Evidence (2026-10-13, local Windows run against the compose PostgreSQL + PostGIS and Valkey)
Exact pass counts of the final runs are recorded in the P3.3 implementation report; the families covered are:

| Test | Covers |
|---|---|
| `packages/db/test/pricing.integration.test.ts` | clean → latest, every previous prefix → latest, re-run 0, live 0011 database with the synthetic catalog upgrading with row checksums unchanged, typmods, TRIG-P3 (each guard and CHECK proven separately), deferred Σ at COMMIT (accepted mid-transaction), sign CHECKs, CONC (concurrent activations ⇒ one ACTIVE), GRANT-P3 as api/worker/realtime/vault, nothing for PUBLIC |
| `apps/api/test/pricing-engine.test.ts` | golden examples A/B, PROP-QUOTE P-01..P-10/P-14 |
| `apps/api/test/quotes.integration.test.ts` | QT-02..QT-12, QT-16, QT-17, P-05 replay, P-11, P-12, P-13, P-15, CONC (one live group; one group per key), routing outage fault modes ⇒ 503 with zero rows and a real retry, unbound routing, `rider.quotes` switch, production synthetic refusal and limiter-down at service level, LOG-GEO-style canary |
| `apps/api/test/quote-tamper.integration.test.ts` | QT-01 (14 tamper shapes), QT-05, QT-13 |
| `apps/api/test/pricing-admin.integration.test.ts` | tax/card maker-checker (service + DB), break-glass and STAFF_ADMIN refusals, envelope override, activation/outbox/audit, scheduling, rollback, QT-14, QT-15 (service level), previews, SUPPORT-QUOTE, CONC-PRICING |
| `apps/worker/test/pricing.integration.test.ts` | purge (expire, retention delete with components, snapshots, polylines, idempotent, bounded), scheduled activation (apply, run-time re-checks, race ⇒ one winner) |

## Open (EXTERNAL or later phases)
- FA-15a–f real values (rounding step/mode, tax base/rate/inclusivity/taxable components, toll treatment, rounding before/after tax, rate-card values, quote TTL) — founder + accountant/counsel before pilot.
- The envelope bounds are PROPOSED placeholders; the real envelope is part of FA-15e.
- Terms-derived geometry TTLs per vendor (P3.7 / ADR-006): no adapter declares one yet (`polyline_expires_at` stays NULL).
- Quote acceptance (`ACCEPTED`, Phase 4), promotions/DISCOUNT (Phase 9), fare adjustment (Phase 5), real two-person staffing before exposure (EG-20 precedent).

## Consequences
- Every price can be recomputed exactly from the stored card version, engine version and route snapshot.
- A routing outage refuses quotes instead of degrading to an estimate (availability cost accepted, CON-P3-08).
- Two distinct PRICING_MANAGERs are required for any price change; a single-operator pilot cannot change prices (accepted residual, T3-23).

## Reversal path
Before any staff-entered pricing exists: `DROP SCHEMA pricing CASCADE` and remove the module. Afterwards: forward-fix only (configuration history is evidence). A formula change ships as `pe-v2` alongside `pe-v1`.
