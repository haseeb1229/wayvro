# 07 — Data Model, API, Financial Integrity and Contracts

## Entities (draft logical model)
- `accounts`, `rider_profiles`, `driver_profiles`, `account_capabilities`, `role_restrictions`, `account_restrictions`, `verified_contacts`, `sessions`, `devices`, `consents`, `trusted_contacts`, `privacy_requests`, `mode_preferences` (client preference only, never authorization).
- `driver_applications`, `drivers`, `driver_eligibility`, `vehicles`, `vehicle_documents`, `driver_documents`, `verification_cases`, `review_decisions`, `permits`, `vehicle_insurance`, `fleet_memberships`.
- `cities`, `service_zones`, `service_categories`, `pickup_places`, `geo_provider_cache`, `driver_presence`, `driver_location_samples` (bounded retention).
- `pricing_plans`, `pricing_versions`, `quotes`, `fare_components`, `bid_offers`, `pricing_consents`.
- `ride_requests`, `dispatch_rounds`, `driver_offers`, `assignments`, `trips`, `trip_stops`, `trip_status_events`, `cancellations`, `trip_rider_participants`.
- `pool_groups`, `pool_seat_allocations`, `pool_stop_plans`, `pool_passenger_consent`, `pool_fare_allocations`.
- `payment_intents`, `payment_provider_events`, `payment_instruments_tokens`, `refund_requests`, `ledger_accounts`, `ledger_transactions`, `ledger_entries`, `payout_bundles`, `settlement_entries`, `reconciliation_runs`, `reconciliation_exceptions`.
- `safety_incidents`, `evidence_assets`, `incident_actions`, `support_tickets`, `support_messages`, `identity_access_audit`, `enforcement_actions`, `appeals`.
- `promotions`, `promotion_redemptions`, `referrals`, `campaign_costs`, `business_accounts`, `staff`, `roles`, `permissions`, `audit_events`, `outbox_events`, `job_attempts`, `feature_flags`, `config_revisions`, `analytics_events`.

## Core database invariants
1. One passenger active exclusive ride (unless exact allowed exception); one driver assigned exclusive trip at a time; seat capacity never exceeded. A single account cannot enter conflicting rider/driver active states merely by switching app mode.
2. Each ride status transition is valid and authenticated; immutable transition audit.
3. Only accounts with an approved Driver/Partner profile plus current driver/vehicle/service/city eligibility can go online or be assigned; visible client mode alone grants nothing.
4. Every final receipt references accepted quote/rule version, country/currency/amount and adjustment reasons.
5. Never debit customer twice from provider webhook retries; unique provider event and payment intent keys.
6. `sum(debits) = sum(credits)` in integer PKR minor units for posted transactions; no edits/deletes of posted ledger entries, only correcting transactions.
7. Every company obligation/cash receivable/payout traces to a ride or explicit approved adjustment.
8. Secrets, identity document bytes and sensitive GPS traces excluded from general logs.
9. Cross-user trip/identity access always checked server-side and audited; staff no wildcard silent access.
10. Outbox/worker/event processing idempotent and retryable, with dead-letter triage and reconciliation.

## Monetary examples (illustrative, NOT rate policy)
If passenger owes 1,000 PKR with 10% platform commission, driver earns 900 PKR before any other disclosed fees/taxes. A cash ride requires a properly modeled settlement/receivable because the driver may collect all 1,000 PKR directly. Do NOT model platform cash as if received into a bank. Rounding and tax policy require accounting review. Promo-funded reductions need distinct company subsidy expense. Refund and dispute do not delete original entries.

## API contract groups
`/v1/auth/*`, `/v1/account/*`, `/v1/driver-onboarding/*`, `/v1/vehicles/*`, `/v1/geo/*`, `/v1/catalog/*`, `/v1/quotes/*`, `/v1/rides/*`, `/v1/offers/*`, `/v1/trips/*`, `/v1/pools/*`, `/v1/payments/*`, `/v1/receipts/*`, `/v1/safety/*`, `/v1/support/*`, `/v1/admin/*`, `/v1/fleet/*`, `/v1/corporate/*`. Authorization, schema, request-id, rate limit, idempotency, API version and error codes documented per route.

## Event examples
`driver.approved.v1`, `driver.presence.updated.v1` (ephemeral), `ride.requested.v1`, `dispatch.offer.issued.v1`, `dispatch.offer.accepted.v1`, `trip.assigned.v1`, `trip.started.v1`, `trip.completed.v1`, `trip.cancelled.v1`, `payment.capture.confirmed.v1`, `ledger.transaction.posted.v1`, `incident.opened.v1`, `driver.suspended.v1`. Events contain schema version, unique event id, tenant/region, aggregate id/version, occurred timestamp, correlation/causation IDs, redaction classification, retry/dead-letter policy.

## Mobile reconciliation
On reconnect: authenticate/re-authorize the account and current capabilities, fetch canonical snapshot + event sequence, ignore stale/out-of-order updates, restore authorized Rider/Driver context, and never replay unsafe client-only trip-complete/accept/go-online actions. Driver offline queue is a bounded intent, not final authoritative state.

## Data retention/erasure
Create per-column/sensitivity retention matrix before implementing storage of real documents, real GPS tracks, payment metadata or safety reports. Legal holds override deletion where required; deletion pipeline leaves financial records only as lawful pseudonymous audit structures.


## Contract compatibility and consumer safety
- Public/mobile/web contracts are canonical schemas, not leaked database models. Runtime validation and typed clients are generated/reviewed where practical.
- Backend must remain compatible with supported released Wayvro mobile-app versions during staged rollout, across both Rider and Driver/Partner modes. Additive evolution is preferred; breaking changes need an explicit version/compatibility window and affected-consumer inventory.
- A frontend redesign should not mutate backend semantics by accident. Any API/event/schema change triggered by UI work is called out as a separate contract change and must pass contract tests.
- Database changes use explicit migrations and, for destructive evolution, expand -> migrate/backfill -> switch -> contract. No wipe/reseed shortcut for shared/production-like data.
- Never remove/rename a field, enum, event, route, permission or error semantic while an active consumer depends on it.
- See root `CLAUDE.md` and `docs/27_ENGINEERING_GUARDRAILS_AND_CHANGE_SAFETY.md`.
