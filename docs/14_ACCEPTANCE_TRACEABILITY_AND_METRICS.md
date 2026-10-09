# 14 — Coverage Matrix, Requirements Traceability and Metrics

## Why an A–Z inventory is never literally 'finished'
No one can honestly guarantee that an entire real-world mobility operation will never reveal an unanticipated feature, local rule or failure mode. The correct system is a **versioned requirement inventory** with discovery/acceptance ownership and gap checks. Unvalidated features are clearly labeled, not silently omitted.

## Mandatory requirement record
```
ID: B07
Title: Idempotent rider request
Actors: Passenger; Dispatch service
Priority: P0
Release target: Controlled pilot
User story and value: ...
Preconditions: ...
Functional behavior: ...
State-machine transitions: ...
Validation/errors/retries/offline: ...
Sensitive data and retention: ...
Authorization/rate limiting: ...
Financial effect: ...
Dependency: ...
UX states (loading/empty/error): ...
API/schema/events: ...
Acceptance criteria (Given/When/Then): ...
Tests: unit/integration/concurrency/mobile/security
Observability: ...
Rollback/feature flag: ...
Business/legal sign-off: ...
Status: PROPOSED | SPECIFIED | APPROVED | IMPLEMENTED | REVIEWED | PILOT_PASS | PUBLIC_PASS
Evidence: commit SHA / CI job URL / screenshot / test log
```

## Example P0 acceptance journeys
1. Verified rider -> accurate quote -> no drivers -> clean fail (no phantom assignment/no charge).
2. Verified rider -> eligible approved driver accepts -> rider PIN -> trip -> correct cash settlement/receipt.
3. Two drivers accept same request simultaneously -> exactly one committed assignment; loser receives expiry/conflict.
4. One driver accepts two different ride offers concurrently -> no simultaneous incompatible trip assignments.
5. App disconnects after accepting ride -> reconnected rider and driver see authoritative state; no duplicate charges.
6. Expired driver's insurance/document -> cannot go online or be dispatched; access logs retained.
7. Rider reports driver/plate mismatch before boarding -> immediate safe cancellation, incident and no unfair charge.
8. GPS stale -> visibly marked; SOS remains reachable with fallback directions and human incident.
9. Duplicate PSP webhook -> no doubled financial posting/refund; reconciliation reports exactly one obligation.
10. Driver completes cash ride -> platform receivable, driver payable and taxes reflected accurately, no fabricated bank receipt.
11. Role-limited support agent tries reading other-city incident -> denied, audited, no sensitive payload in logs.
12. Sensitive document upload wrong MIME -> quarantined; anti-malware rejects; no direct public URL.
13. Pool match proposes unacceptable detour -> decline/pure solo fallback; no silent forced pooling.
14. Women-only service booked -> an ineligible replacement or co-passenger cannot be assigned even under severe supply scarcity.
15. Cancelled pooled participant -> reserved seats/fare of remaining participants remain within consented guarantee or explicitly reauthorized.
16. Database restore -> trips, ledger and provider payments reconciled, no duplicate side effects after worker replay.
17. Merchant provider disabled -> digital payment unavailable transparently, no route into fake wallet.
18. Support coverage gap -> consumer not shown fake 24/7 promise; live rides may be suspended until staffed.

## New critical identity acceptance journeys
19. Pakistani +92 OTP expires/rotates correctly, cannot replay or brute-force; production refuses local test bypass.
20. Google/Apple same-email account link without proving both principals is blocked; staff and driver roles never inherited from OAuth.
21. CNIC photo and license submitted but selfie replay/face failure => blocked/manual review, never ACTIVE by score alone.
22. Driver docs valid then insurance/permit expires => cannot accept new offer; review evidence and appeal persist.
23. Every KYC document and sensitive biometric artifact is unreadable via unrelated passenger, driver, staff, fleet or public links.


## Unified-app / mode-switch acceptance journeys
24. Rider-only account opens `Earn with Wayvro` -> starts Driver/Partner application -> Rider mode remains usable while application is pending; no duplicate identity/account is created.
25. Approved driver goes online -> UI mode-switch attempt cannot abandon online/assigned/active driver obligation; server state remains authoritative after app restart.
26. User is in an incompatible active rider trip -> Driver/Partner `Go online` is blocked with a clear reason; reinstall/new device does not bypass the block.
27. Driver insurance expires -> earning capability is blocked, but lawful Rider-mode access remains available unless an account-wide restriction exists.
28. Rider-only user never receives background-location/KYC permission prompts until entering a justified driver/partner flow; revoked permission has a recoverable path.
29. A Driver-mode release change is regression-tested against Rider booking/payment/safety journeys and a Rider-mode redesign is regression-tested against KYC/background-location/offer flows before staged rollout.

## Coverage accounting
Use the canonical machine-readable `docs/requirements-register.json` (or a Phase-0-approved generated derivative) plus validation scripts that fail CI for: duplicate IDs; P0 without owner/spec/test; implemented code path with no requirement tag; released feature without signed approvals; uncovered state machine transition; exposed feature flag without pilot gate. Measure planned vs implemented vs field-verified counts separately.

## Pilot success KPIs (must set thresholds after data)
- Real driver supply per neighborhood/hour and first ride response rate.
- Driver net earnings / hour and median pickup ETA.
- Complete/no-driver/cancelled shares (split rider/driver/platform).
- Trip gross margin after PSP, incentives, fraud, support, insurance and acquisition costs.
- Trust safety reports / trips, serious incident acknowledgement time, KYC expiries.
- Week 1/week 4 retention, second ride conversion and repeat booking.
- P95 request/assignment event lag, GPS freshness, mobile crash rate and price discrepancy.
- Unreconciled payment and cash mismatch totals; customer support backlog.

## Go/no-go rules
P0 safety/financial consistency failures block all live ride releases. P1 features are mandatory when their assigned release/vertical activates (target phase + release gate, see README priority codes); until then they remain flagged off with no misleading claims. P2/P3 capabilities are documented architecture targets only until they pass independent gates.
