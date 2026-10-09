# 04 — Ride, Offer, Dispatch, Pooling and Safety Lifecycle Specifications

## Unified account / Driver capability lifecycle
Account identity and current UI mode are separate from earning eligibility. **The canonical driver-capability state machine is defined in `docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md` §3** (`NONE → DRAFT → CONSENTED → DOCUMENTS_PENDING → SUBMITTED → AUTO_CHECK_PENDING → MANUAL_REVIEW → NEEDS_INFO/REJECTED/VERIFIED → ACTIVE_ELIGIBLE → EXPIRED/REVERIFY_DUE/SUSPENDED → …` with appeal branches); earlier variants in this file, docs/05 and docs/18 were reconciled in Phase 0 (CON-01). Presence/session states (`OFFLINE → ONLINE_IDLE/PAUSED → ASSIGNED → EN_ROUTE → ARRIVED → ON_TRIP`) and the mode-conflict matrix are in the same document (§4–§5), including the single-vehicle (D26) and single-session (D27) invariants.

Rider mode remains available for a normal account unless an **account-wide** safety/legal restriction applies. Driver/Partner mode may remain visible for application status, earnings, documents or appeal even when `Go online` is blocked.

Mode switching is not a server-side role grant. Before `Go online`, accept, pickup or start-trip actions the backend revalidates driver profile, vehicle/service eligibility, document validity, city/zone permissions, restrictions and conflicting active rider/driver state. An app restart/reinstall/device change cannot bypass those invariants.

## Trip lifecycle (canonical server-side)
`DRAFT -> QUOTED -> REQUESTED -> SEARCHING -> ASSIGNED -> DRIVER_EN_ROUTE -> DRIVER_ARRIVED -> IN_PROGRESS -> COMPLETED`
Settlement is a **separate aggregate** (`trip_settlements`: `PENDING -> COLLECTED_CASH | CAPTURED_DIGITAL | PARTIAL | FAILED -> RECONCILED | DISPUTED -> RESOLVED`), per `docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md` §10 (Phase 0 resolution CON-02; the former `SETTLEMENT_PENDING/SETTLED` trip states are removed). A driver cancel after `ASSIGNED` returns the trip to `SEARCHING` through a new dispatch round when policy allows (CL-04).
Terminal/exception paths: `CANCELLED_BY_RIDER`, `CANCELLED_BY_DRIVER`, `CANCELLED_BY_PLATFORM`, `EXPIRED_NO_DRIVER`, `ABORTED_SAFETY`, `PAYMENT_DISPUTED` (prefer payment dispute as orthogonal financial state), with recorded reason codes, actor, authority and timestamps. Avoid illegal transition such as `COMPLETED -> IN_PROGRESS`. Split **Trip status** and **Payment/settlement status** to avoid combinatorial confusion.

## Offer and assignment lifecycle
`CREATED -> ELIGIBLE -> OFFERED -> ACCEPTED / DECLINED / EXPIRED / REVOKED` with versioned leases, timeouts and atomic assignment. Driver cannot be assigned two exclusive rides simultaneously, except an expressly governed pooled batch. Lease and presence TTL are not proof of trip completion. A driver who races to accept after offer expires receives a definitive conflict (not silently another booking). Always reconcile offline/online clients to server truth.

## Core matching pseudocode (behavioral only)
1. Get ride request with versioned quote; validate actor, zone, category, time, anti-abuse.
2. Query nearby candidate drivers by PostGIS location and permissions; filter stale heartbeats, approved documents, category, active assignment and safety restrictions.
3. Estimate realistic arrival with bounded routing calls/cache; rank for fairness/ETA/eligibility; cap candidate fanout.
4. Issue lease-bound offers; handle driver accept with serializable transaction or tested unique constraints/compare-and-swap.
5. Commit single assignment + outbox event in DB transaction; notify via websocket/push; retry events.
6. If realtime delivery fails, Driver/Partner mode resyncs authoritative server state; if pickup/assignment delivery fails, follow cancellation/reassignment policy.

## ETA and driver tracking
- Server timestamp + freshness + accuracy included; never show outdated GPS dot as current without stale badge.
- Unified Wayvro app permission/reliability behavior while in Driver/Partner mode across foreground, background and terminated/restarted states; OS battery restrictions. Platform cannot guarantee perpetual background location.
- GPS provider errors, tunnels, poor network, mock/spoof risks, unrealistic jumps, provider outages, degraded route accuracy.
- Prefer geometric proximity for candidate screening; routing provider for top candidates only; monitor cost per ride.

## Quoting and fare modes
- Fixed upfront price: base + distance/time model + allowed tolls/zone fees + taxes - discounts = quote; price and expiry shown; changes require policy and acceptance.
- Bid negotiation mode: rider offer within published floor/cap, driver accepts/counters, both confirm the same monetary version. Expired/changed offers cannot be selected.
- Surge is optional and capped, visible before acceptance, never quietly changed mid-trip.
- Bookings, bids, requests, assignments, receipts and ledger reference immutable pricing-rule version and currency.

## Shared ride / pooling (not equivalent to split fare)
- User A, B, C, D may share *one real vehicle trip* only if each explicitly selects pool, compatible vehicle/capacity, consent, safety and schedule constraints pass.
- Match pickups/dropoffs via route overlap and stop insertion; max additional walking distance, max detour minutes/percentage, max wait, max seat count, max groups, accessible needs and no hazardous locations. Thresholds require field validation.
- Separate per-seat booking and per-person start/end/incident/settlement states under immutable `pool_group_id`; driver route sequence and seat capacity are atomic.
- Before confirmation, show expected savings, added travel/wait, number of co-passengers (minimal identity), fare commitment, cancellation and no-match fallback.
- Split fares based on an *explicit disclosed allocation formula*: segment-distance/time cost allocation + shared-discount caps, platform/driver minimum, min/max per rider, rounding residual policy; nobody pays a surprise surcharge.
- If B cancels, A/C/D must either remain within guaranteed fare/detour bounds, reconsent to changed terms, or be compensated/cancelled under policy. No retroactive charging against original agreement.
- Pickup/drop privacy: don't reveal another passenger's precise historical address or personal phone; show only currently needed pickup route data.
- Rider drop-off to a safe location/early exit requires incident-safe branch and human intervention as needed.
- No pool with unaccompanied minors or unsupported accessibility/personal safety combinations.

## Women's preferred/only rides
- Maintain two separate design concepts: (a) rider **preference** for an eligible women driver; (b) legally reviewed women-only **service category** with driver/passenger eligibility and visibility policy.
- Do not infer gender from face photos, CNIC text, name or ML. Collect only necessary declared attributes and independent verification evidence through consent, role-restricted process, with appeals and data minimization.
- Women-only trip cannot silently convert to mixed-gender supply or add an ineligible pooled rider; show no availability rather than breaking promise.
- Supply scarcity, harassment response, restricted access to sensitive data, emergency escalation, shadow suspension and third-party report handling designed before rollout.

## Cancellation, no-show and disputes
- Explicit policy by actor/state/timestamp/safety reason; geofenced driver arrival with tolerance; proof artifacts; waiting timer; grace periods; quote lock; deductions and waivers.
- Customer cannot be charged twice on retries; driver cannot collect cash and also trigger electronic capture; refunds and adjustments posted as ledger reversals.
- Every manual override has reason, audit trail and approval by role/threshold.

## Scheduled, intercity and courier separate lifecycles
Do not shoehorn these into city trip state machine. Each has service-specific lifecycle, legal coverage, liability, payment, route/region, insurance, insurance exclusions and acceptance tests. Future modular products share identity/finance/notifications infrastructure, not necessarily state contracts.
