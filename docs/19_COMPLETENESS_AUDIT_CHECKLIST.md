# 19 — Completeness Audit: Cross-Surface Requirements and Evidence

**No truthful plan can promise no unanticipated feature.** Use this checklist to actively discover omissions, not to claim completeness prematurely. Every check must map to feature IDs, exact UX/API contracts, negative/error/offline states, security, financial effects, owner, test and release target. Unknown means OPEN, never silently satisfied.

## Scope checklist
- Passenger: onboarding, OTP and OAuth links, profiles and consent, home map, address pin, quotes, bidding, book/cancel, route changes, driver photo, contacts, communication, trip PIN, live ride, safety, receipts, ride/rating history, refunds/disputes, accessibility/languages, deletion/export.
- Driver: onboarding/identity/CNIC+selfie, license and vehicle+insurance checks, approved statuses, online presence, offers, route/navigation/ETA, safe pickup, trip/stop flows, payment cash handling and earnings, settlement, support/appeals, offline/reconnect/device limitations, shift/battery, driver safety and working-hour choices.
- Pooling: passengers independent start/end, seat+route constraints, re-optimization detour limits, no unconsented co-rider, pool-specific cancellation/refunds/settlements, liability/safety, women-only pool safeguards, split group bill vs stranger pool separated.
- Corporate/fleet/delivery/intercity: separate roles/permissions, tariffs, insurance, contracts, pickups, goods prohibited list, COD, scheduled events, invoicing and payout terms, third-party driver ownership authorization, each behind explicit feature flag.
- Staff: KYC, complaint, live map, SOS escalation, monitoring, support staffing, refunds, payment exceptions, collections, abuse and fraud, price changes, feature flags, customer/driver account appeals, approvals audit, finance statements, incident recovery and own MFA.
- Backend: geospatial eligibility/dispatch, idempotency, quote snapshots, prices/tax, trip state transitions, no double match, reconciliation, event delivery, stale GPS, offline reconnect, expiry logic, session security, privacy vault, admin APIs, audit and retention.
- Mobile: Android + iOS platform testing; permission revocation, push delivery failure, killed process, GPS inaccurate/spoofed, poor connectivity, cold starts, disabled notifications, keyboard/font size, camera permission, OAuth redirect, store requirements and OS upgrades.
- Data+SRE: DB backups/restore, migration safety, monitoring, alerts, CI and provenance, rate limits, incident severity, security disclosures, crash telemetry scrubbing, asset/licensing, maps/provider cost, security tests and release rollback.
- Code health/change safety: frontend/backend separation, typed/versioned contracts, supported-client compatibility, expand/migrate/contract schema evolution, dead-code/cycle scans, dependency policy, feature-flag cleanup, no reachable mocks/backdoors, real deployable builds, staged rollout and rollback/forward-fix evidence.
- App topology: one public Wayvro mobile distribution with Rider and optional approved Driver/Partner profiles/modes, server-side capability isolation, just-in-time permissions, cross-mode regression, plus staff RBAC/ABAC web portal and separately bounded public/partner web surfaces.
- Business/legal: company registration and tax, routes/driver permits/insurance, PSP contracts, fare/commission disclosure, local helplines, operator staffing, labor and partner contracts, policies, brand/IP/trademark checks, driver acquisition, unit economics, field audit and region-by-region launch approvals.

## Gate review per feature
1. Does it exist in `requirements-register.json` with unique ID and assigned owner?
2. Does it have product/story details, P0–P3 priority, launch target and user-visible states (happy, error, offline, cancellation, failure and appeal)?
3. Are permitted actors, roles, privacy purpose, retention, access and misuse explicitly defined?
4. Are state, schema, API/event, rate limits, retries/idempotency, compatibility and financial accounting explicit?
5. Are unit, integration, device, concurrency, security, accessibility and human operational tests mapped, with proof at actual SHA?
6. Has the founder accepted the business claim, and has any required legal/vendor/field approver independently approved it?
7. Has staged rollout/flag/rollback, incident response and budget ceiling been specified?

## Report every phase
- New gaps proposed and their IDs; blocked/unresolved decisions; old requirements impacted by code; real test evidence; cost/credentials risks; what was NOT tested; readiness for next phase.
- Claude may self-review but it is **not** independent assurance. ChatGPT reviews repo/diff/test output where tools allow; pre-public-launch independent qualified human security/privacy/transport review remains mandatory.
