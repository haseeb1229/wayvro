# PHASE0_ARCHITECTURE_PROPOSAL — Modular contexts, monorepo and scaling

**Date:** 2026-10-09 · **Status:** Phase 0 deliverable (plan-only; proposal for founder review; exact versions frozen only after ADR-003/004/005 spikes). Refines `docs/06` and `docs/28` without changing founder-locked decisions. Guardrails in `PHASE0_ENGINEERING_GUARDRAILS.md`; role model in `PHASE0_UNIFIED_APP_ROLE_MODEL.md`.

## 1. Shape: modular monolith, one mobile app, separate web surfaces

- **One public mobile app** (`apps/wayvro-mobile`, RN + Expo dev builds) with feature-isolated Rider, Driver/Partner, Account, Safety, Support modules and platform services.
- **Founder-approved baseline (closure pass, ADR-035):** modular monolith, PostgreSQL/PostGIS, Redis, transactional outbox, one public mobile app, separate worker and realtime runtime boundaries when justified. **Framework candidates (NestJS + Fastify, Drizzle + raw SQL, Socket.IO) remain OPEN-SPIKE** until SP-05/SP-03 record results in Phase 1 early entry (ADR-005/004/005b); Phase 1 must not couple business code to them first.
- **One API** (`apps/api`, framework per ADR-005 — NestJS + Fastify is the candidate) exposing versioned, Zod-validated HTTP contracts; **one worker** (`apps/worker`, BullMQ over Redis) for outbox dispatch, dispatch rounds, expiries, reconciliation, notifications; **one realtime gateway** (`apps/realtime`, Socket.IO + Redis adapter) — separate process from day one so it can scale/restart independently (Stage B) without being a "microservice".
- **Web**: `apps/web-public` (Next.js; marketing, legal, help, web booking/trip status, driver lead capture, verify-ride page) and `apps/web-ops` (Next.js; staff modules behind server-side RBAC/ABAC). `apps/web-partner` only when fleet/corporate verticals activate (Phase 12).
- **PostgreSQL 17 + PostGIS 3.5** canonical; **Redis 7** ephemeral (presence, leases, rate limits, queues, socket fan-out); **S3-compatible object storage** for evidence; **transactional outbox** for events.

## 2. Bounded contexts → packages/modules (CLAUDE.md §4/§5; docs/06)

| Context | Owns | Key tables (draft; docs/07) | Phase |
|---|---|---|---|
| Identity & Consent | accounts, phones, OIDC links, sessions, devices, consents, privacy requests | `accounts, verified_contacts, linked_oidc_identities, sessions, devices, consents, privacy_requests` | 2 |
| Account/Profile/Capability | rider/driver profiles, capabilities, restrictions, mode conflict rules | `rider_profiles, driver_profiles, account_capabilities, role_restrictions, account_restrictions` | 2/4 |
| Driver & Vehicle Compliance | applications, documents, Punjab artefacts (R46), vehicles, affiliations, reviews, appeals, expiry jobs | `driver_applications, driver_documents, vehicles, vehicle_documents, vehicle_affiliations, compliance_artefacts, verification_cases, review_decisions, appeals` | 2 |
| Catalog & Geo Zones | cities, districts, zones, service categories, vehicle eligibility rules, service hours | `cities, districts, service_zones, service_categories, vehicle_eligibility_rules` | 3 |
| Geo Routing | provider adapters, caches, cost guards | `geo_provider_cache` | 3 |
| Pricing & Quotes | rate cards (versioned), quotes, fare components, surge caps, bids, fuel-indexed revisions (E20) | `pricing_plans, pricing_versions, quotes, fare_components, bid_offers` | 3/10 |
| Supply & Presence | presence, heartbeats, location samples (bounded), single-vehicle/session invariants (D26/D27), supply preview (B26) | `driver_presence, driver_location_samples` | 4 |
| Dispatch & Offers | dispatch rounds, candidate ranking, leases, offers, atomic assignment | `ride_requests, dispatch_rounds, driver_offers, assignments` | 4 |
| Trip Lifecycle | trips, stops, status events, cancellations, PIN, waiting timer, anomaly hooks | `trips, trip_stops, trip_status_events, cancellations` | 5 |
| Payments & Ledger | payment intents, provider events, append-only operational ledger (double-entry where useful; statutory classification by accountant — §6), dues (G17), refunds, reconciliation | `payment_intents, payment_provider_events, ledger_accounts, ledger_transactions, ledger_entries, driver_dues, refund_requests, reconciliation_runs` | 5/9 |
| Payouts & Reconciliation | payout bundles, payee verification, settlement | `payout_bundles, settlement_entries, payee_instruments` | 9 |
| Trust & Incidents | incidents, evidence, no-rematch, anomaly rules, FOSPAH kit (R47), post-trip lockdown (N31) | `safety_incidents, evidence_assets, incident_actions, blocks, enforcement_actions` | 6 |
| Support | cases, messages, lost items, call-centre bookings | `support_tickets, support_messages, lost_items` | 6 |
| Communication | notification hierarchy (L13), inbox, device tokens (S11), masked channels | `notifications, notification_inbox, device_tokens, masked_channels` | 4/6 |
| Pooling | pool groups/seats/stops/fares | `pool_*` | 11 |
| Fleet & Corporate | organisations, affiliations, invoices | `business_accounts, fleet_memberships, invoices` | 12 |
| Promotions & Growth | promos, referrals, budgets | `promotions, promotion_redemptions, referrals, campaign_costs` | 9 |
| Analytics & Experiments | event contracts, scorecards, flags | `analytics_events, feature_flags, config_revisions` | 4+ |
| Administration & Audit | staff identity realm, roles, permissions, audit, lawful requests | `staff, roles, permissions, audit_events, lawful_requests` | 2 |
| Platform/SRE | outbox, jobs, health, cost guards | `outbox_events, job_attempts` | 1/4 |

Context rules: each context exposes a TypeScript module API and domain events; **no cross-context table writes**; cross-context reads go through module services or read models; money and dispatch invariants are enforced in the database (unique partial indexes, check constraints, serialisable sections) **and** tested under concurrency.

## 3. Monorepo layout (harmonises docs/06 and docs/28 — resolves CON-03)

```text
apps/
  wayvro-mobile/            # ONE public app (Expo dev builds)
    src/core/account         # session, capabilities, consent, mode context (presentation only)
    src/features/rider/*     # booking, quotes, offers, trip, payment, history
    src/features/driver/*    # onboarding/KYC, online state, offers, navigation, earnings, compliance
    src/features/safety/*    # shared safety centre, role-aware
    src/features/support/*
    src/features/notifications/*
    src/platform/location/*  # permission lifecycle + driver background worker (lazy-loaded)
    src/platform/providers/* # client adapters (maps, push, attestation)
  web-public/               # Next.js marketing/legal/help/web booking/verify-ride (W01–W09)
  web-ops/                  # Next.js staff modules (W07), server-authorised
  web-partner/              # Phase 12, gated
  api/                      # HTTP API (framework per ADR-005 after SP-05; candidate NestJS+Fastify)
  worker/                   # BullMQ jobs, outbox relay, schedulers
  realtime/                 # realtime gateway, separate process (candidate Socket.IO per ADR-005b/SP-05)
packages/
  contracts/                # Zod schemas, OpenAPI + event schemas, generated clients (build products)
  domain/                   # pure value objects (Money in PKR minor units, Phone E.164, Coordinates), state-machine tables
  mobile-ui/                # tokens, primitives, view-state adapters (no business rules)
  web-ui/
  config/                   # typed env schema, feature-flag registry
  db/                       # SERVER-ONLY: drizzle schema, migrations, PostGIS SQL
  observability/            # OTel setup, redaction, error codes
  provider-interfaces/      # maps, otp, kyc, payments, storage, push, email, telemetry interfaces + signed mocks
  provider-adapters/*       # one package per vendor (server-only where applicable)
infra/
  docker/                   # compose for Postgres/PostGIS, Redis, S3-compatible server, mail catcher, OSRM
  ci/                       # workflow fragments, scripts
  deploy/                   # Terraform/OpenTofu + Ansible for VPS/compose, Cloudflare
  runbooks/
docs/
  adr/  threat-models/  operations/  prd/  phases/  reviews/  decisions/
tests/
  contract/  integration/  e2e/  load/  chaos/  spikes/
```
Import boundaries (enforced by dependency-cruiser/eslint-boundaries, see guardrails): `apps/wayvro-mobile`, `apps/web-*` → may import `contracts, domain, *-ui, config(client subset), observability(client), provider-interfaces(client)`; **never** `db`, server adapters, or `apps/api` internals. `features/rider/*` ↔ `features/driver/*` have **no direct imports**; they share only `core/account`, `platform/*`, `mobile-ui`, `contracts`.

## 4. Contracts and compatibility (docs/07, docs/27 §3)

- Canonical API contracts are Zod schemas in `packages/contracts`, exported to OpenAPI (build product, diffed in CI with `oasdiff`), with generated typed clients for mobile/web.
- Route groups as in docs/07 (`/v1/auth`, `/v1/account`, `/v1/driver-onboarding`, `/v1/vehicles`, `/v1/geo`, `/v1/catalog`, `/v1/quotes`, `/v1/rides`, `/v1/offers`, `/v1/trips`, `/v1/pools`, `/v1/payments`, `/v1/receipts`, `/v1/safety`, `/v1/support`, `/v1/admin`, `/v1/fleet`, `/v1/corporate`) plus **`/v1/account/state`** (role-model §6 snapshot) and **`/v1/compliance/*`** (R46 artefacts).
- Every mutating endpoint: `Idempotency-Key` header, request id, stable error codes (`WAYVRO_E_xxx`), rate-limit headers; version via path (`/v1`) and additive evolution; `X-Min-App-Version` enforcement for forced updates (A01/Q31).
- Events (`*.v1`) from the outbox with envelope per docs/07; consumers idempotent by `event_id`.

## 5. Dispatch and realtime design (docs/04 behaviour, made concrete)

1. `POST /v1/rides` (idempotent) validates quote version, actor, zone, one-active-ride (INV-01), anti-abuse → `REQUESTED` → enqueue `dispatch.round`.
2. Worker: candidate query `ST_DWithin` on `driver_presence.geom` (GiST) filtered by online state, freshness, capability, district coverage (R46), restrictions, no active assignment; rank by straight-line distance then bounded provider ETA for top-N; cap fan-out.
3. Offers issued with lease TTL (Redis + DB row); driver accept → single SQL CAS (`UPDATE assignments … WHERE status='OFFERED' AND lease_version=$v`) inside a transaction that also inserts the outbox event; losers get `409 OFFER_EXPIRED`.
4. Realtime gateway pushes `trip.*` and `offer.*` to scoped rooms; push (M26 channel) as parallel channel; clients reconcile via `/v1/trips/:id` + `/v1/account/state` on reconnect (docs/07 mobile reconciliation).
5. Location ingestion: batched samples with client sequence + server time; Redis geo set for live presence; Postgres `driver_location_samples` partitioned by day with TTL (Q25); trip polyline derived and kept for the trip retention period.

## 6. Money design (docs/07; G-family; G17) — corrected in the founder-review closure pass

**Product invariants (what the software must guarantee):**
- Money is integer PKR minor units (`bigint`) with deterministic rounding defined in one place; any cash-friendly rounding (for example to PKR 10) is a pricing-policy decision applied at quote time under ADR-013, never an ad-hoc client calculation.
- The trip/payment **operational ledger is append-only and auditable**: corrections, refunds and adjustments are new entries, never edits; where double-entry is used, each posted transaction balances (DB check + property tests, INV-10).
- The following are **independently traceable** per trip and per period: rider obligation, driver-collected cash, driver gross and net earnings, Wayvro commission/fees, taxes/withholding (configuration-driven, O20), adjustments, refunds and driver dues (G17).
- Wayvro **never records driver-collected cash as if it entered a Wayvro bank account**; only money actually received through a regulated rail or bank is recorded as received by Wayvro.
- The internal driver earnings/settlement ledger is **operational/accounting data, not an unlicensed stored-value wallet**; Wayvro does not issue or custody e-money unless appropriately licensed/authorised; digital collection and payouts use regulated bank/EMI/PSO/PSP partners.

**Deliberately not decided in Phase 0:** the statutory chart of accounts, principal-vs-agent revenue recognition, whether fares or only commission are Wayvro revenue, and the tax base (e.g. PRA on fare vs commission). These require Pakistani accountant/tax/counsel approval (A2/D3 in `PHASE0_LAUNCH_BLOCKERS.md`). The operational ledger is designed so that either treatment can be mapped onto it later without rewriting history (entries carry trip, party, component type and evidence references rather than baking in a revenue classification).

## 7. Mobile internal architecture (one binary, two modes)

- Shell: auth, account state hydration (`/v1/account/state`), mode context, navigation graphs per mode (docs/28 §8), notification/deep-link router that re-checks server state.
- Rider features load eagerly (hot path); driver features, map-navigation and KYC capture modules are **lazy `require`d** after capability check (V11); the background location task is registered only when the driver flow first needs it.
- State: server-state cache (TanStack Query or equivalent) + minimal local persistence (secure storage for tokens Q01; non-sensitive UI prefs only).
- View-state adapters map contract DTOs to screen view models; business rules stay server-side; tokens/primitives in `packages/mobile-ui` (CLAUDE.md §10).
- Lite mode (L08): reduced map refresh, text-first status, resumable booking, explicit stale indicators.

## 8. Scaling path (docs/06 stages, with triggers)

| Stage | Trigger | Change |
|---|---|---|
| A — pilot | ≤100 online drivers | single VPS (API+worker+realtime+Redis+OSRM in compose) + managed Postgres; daily backups + PITR |
| B — city | >100 online drivers or p95 assignment latency > target | second VPS; realtime gateway on its own node with Redis adapter; worker separation; read replica for ops/reporting; CDN for web |
| C — hotspots | profiling shows dispatch/location or ledger contention | partition location tables; dedicated dispatch worker pool; separate reconciliation worker |
| D — multi-city/region | SLO/economics justify | multi-AZ Postgres, queue sharding by city, independent services only by evidence; no Kafka/Kubernetes theatre |

## 9. Proposed SLOs (ADR-012; ratify after baselines)

| SLI | Pilot target |
|---|---|
| OTP delivered (primary or fallback) within 30 s | ≥97 % |
| Quote p95 latency | <800 ms |
| Request → assigned or explicit no-driver within search window | ≥99 % decided; duplicate assignments = 0 |
| Driver location freshness shown ≤10 s while on trip (or stale badge) | ≥95 % of trip minutes |
| Trip transition API p95 | <500 ms |
| Ledger imbalance | 0 |
| Unreconciled PSP events after T+1 | 0 |
| Realtime reconnect to authoritative state | <5 s p95 |
| Crash-free sessions (mobile) | ≥99.5 % |
| Safety signal → human acknowledgement | per staffed roster (published only when staffed) |

RPO 15 min (WAL/PITR), RTO 4 h at pilot; restore drill before Phase 7 exit (Q20/Q21).

## 10. Alternatives considered and rejected (summary; detail in ADR backlog)
- Two store apps (rejected: founder-locked; inDrive shows unified viability).
- Microservices/Kubernetes/Kafka at start (rejected: scale theatre; docs/06).
- Supabase/Firebase as backend-as-a-service (rejected: dispatch invariants, ledger and provider adapters need server-side control; free tiers sleep/pause).
- Serverless API (rejected: WebSockets, FGS-driven location streams and leases favour long-running processes at this scale).
- Flutter (fallback only; see ADR-003).
- Rider wallet/stored value (rejected: SBP e-money boundary).
