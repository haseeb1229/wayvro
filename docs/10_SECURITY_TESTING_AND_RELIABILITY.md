# 10 — Security, Quality, Reliability and Release Assurance

## Threat modeling
Use STRIDE and abuse cases per boundary: unified Wayvro mobile client -> API, Rider-mode flows, Driver/Partner-mode background/location flows, mode switching/capability checks, realtime subscriptions, staff dashboards, PSP webhooks, driver KYC media storage, backend queues, admin role changes, shared-ride membership, map providers, email/SMS and fleet delegates. Every P0 feature requires at least one negative/abuse acceptance test.

## Application security baseline
- OWASP ASVS L2 target for server, OWASP MASVS for mobile; security assurance not limited to tools or dependency scans.
- Strict RBAC plus per-resource authorization; tenant/city scopes; automated authorization matrix tests; no staff access by merely knowing route IDs.
- Staff MFA and session rotation; strong recovery; authentication throttles and OTP pumping controls.
- Phase 2 identity tests: consented CNIC vault + selfie/liveness/manual fallback, face-replay/printed-photo/camera-injection abuse, failed-match appeals, Google/Apple OIDC account-link takeover, SMS replay and no master OTP. See docs/18.
- Input schemas, output encoding, strict CSP, secure cookies/CORS, upload quarantine/AV and disallowed MIME types.
- Secrets in vault/env injection, encrypted transport, key rotation and no real keys/logs in tickets or prompts.
- Replay-safe webhook signature and idempotent financial writes; source allowlists where justified; rate-limit by identity/device/IP.
- Mobile token handling via platform secure storage; certificate pinning is an ADR tradeoff, not a blanket requirement; device tamper signals must not create unsafe false negatives.
- Supply chain: exact lockfiles, dependency review, SCA, signed releases where supported, SBOM and vulnerability response policy.

## Tests by layer
1. Static check: format, lint, TypeScript strict, dependency boundaries, license audit, secret scanning.
2. Unit: quote arithmetic, bids, state machines, access decisions, cancellation refunds, flags.
3. Property-based: quote rounding, capacity invariants, impossible transitions, sum(debit)=sum(credit), pool fairness, idempotency.
4. Integration: actual Postgres/PostGIS+Redis+worker+object storage on Docker with signed provider mocks; migrations from empty and prior schemas.
5. Contract: app/API/webhook/event schema compatibility and backward version.
6. API e2e: rider create -> quote -> dispatch -> driver accept -> PIN -> trip -> receipt -> cash settlement; cancellation/no-driver/drivers unavailable.
7. Concurrency chaos: 100 simultaneous accepts for same request; 2 overlapping requests same driver; dual webhook; delayed websocket; process crash after DB commit before notification.
8. Mobile e2e: Android physical low-end and midrange devices, iOS devices, permission revoke, background/foreground, low memory, network toggles and no GPS.
9. Operations drills: genuine manual incident response, fake driver/car, emergency support unreachable, payment chargeback, leaked key, provider down, DB restore.
10. Load/soak: increasing connected sockets, search throughput, real GPS pings, batch jobs, PostGIS index profiles, P95/P99 latencies and cost/unit.

## Proposed service indicators (NOT contractual until tested)
- Ride requests that are either assigned or explicitly failed within advertised search window.
- ETA freshness and location visibility freshness measured and displayed.
- Successful dispatch rate, reassign/cancel rate, duplicate assignments (target ZERO).
- Ledger imbalance (target ZERO), unaccounted PSP payments (target ZERO after defined reconciliation cutoff).
- Driver approved/compliant at time of dispatch (target 100% by policy).
- Customer incident acknowledgement and human escalation time, with published SLA only when staffing supports it.
- Mobile crash-free users/sessions, user-visible error rate and cost per ride.

## Backups and disaster recovery
Daily encrypted DB backup plus WAL/PITR if supported, offsite copies, periodic tested restore, documented RPO/RTO and emergency kill switch. Payments and trip state need consistent restoration/reconciliation. Never claim backup success based solely on scheduled task green.

## Required phase gate evidence
`scope -> architecture ADR -> data/API contract -> implementation -> unit/integration/e2e/security/load as applicable -> independent diff review -> founder approval -> staging -> chaos/acceptance -> commit/push exact SHA -> CI green -> release authorization`. If gate fails, work remains blocked. No production release merely because AI reported tests passing.


## Codebase hygiene / dead-code gate
- Accepted production paths contain no abandoned duplicate implementations, commented-out code, reachable mocks/bypasses, hardcoded demo success, or untracked TODO/FIXME/HACK debt.
- CI should run strict TypeScript, lint/import boundaries, an approved dead-code/unreferenced-dependency detector and dependency-cycle checks after the Phase-0/1 tooling ADR. Static findings are reviewed before deletion; framework/native/generated entry points are not mass-deleted blindly.
- Tests may not be weakened/deleted/skipped merely to make CI green. `NOT RUN`, `SKIPPED`, `BLOCKED`, and `FAILED` are reported honestly.
- Affected deployable apps/services must actually build in CI. Shared-package green status alone cannot prove Rider/Driver/web/API release readiness.
- UI redesigns require user-flow regression plus contract-compatibility evidence; backend/domain changes require consumer compatibility evidence. See `docs/27_ENGINEERING_GUARDRAILS_AND_CHANGE_SAFETY.md`.
