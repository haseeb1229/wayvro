# 06 — Proposed Technical Architecture (Architecture Decision DRAFT)

## Initial technology recommendation
- **Monorepo:** pnpm workspace + Turborepo; strict TypeScript; formatter/lint/typecheck/import-boundary rules and reproducible builds.
- **Mobile:** React Native + Expo development builds/custom native modules as required, with **one public Wayvro app** containing Rider and Driver/Partner feature domains behind one account/capability model. Do not assume Expo Go is sufficient for production. Phase 0 must prove background GPS, camera/KYC, push, navigation, deep links, secure storage and store permission behavior on real devices before freezing the mobile stack.
- **Web:** Next.js App Router for public website and private role-controlled operations/business portals where appropriate; server-side authorization is mandatory.
- **Core HTTP API:** NestJS + Fastify is the current proposal. Contracts use runtime validation and OpenAPI/typed client generation where useful. If realtime adapter/runtime interactions require different configuration, prove them in Phase 0 rather than forcing a preferred framework.
- **Data:** PostgreSQL + PostGIS as the canonical transactional/geospatial source of truth. ORM/query layer remains an ADR: evaluate Drizzle/Prisma/Kysely plus explicit SQL for PostGIS and concurrency-sensitive paths. Schema evolution is migration-first and versioned.
- **Ephemeral coordination:** Redis for presence, rate limits, short-lived leases, queues/cache and realtime fanout; Redis is not canonical trip or money storage.
- **Queues/events:** transactional outbox from PostgreSQL; queue technology (for example BullMQ) only after operational fit is verified. Consumers must tolerate at-least-once delivery and deduplicate/idempotently apply events.
- **Realtime:** Socket.IO or standard WebSockets behind an isolated gateway; authenticated subscriptions, sequence/version checks, Redis fanout if needed, API snapshot recovery after reconnect.
- **Maps/routing/navigation:** provider abstraction across map rendering, geocode/reverse-geocode, directions, matrix/ETA and turn-by-turn navigation. Compare providers using real Lahore routes, licences/attribution, free/paid thresholds, latency and coverage.
- **Push/communications:** FCM/APNs plus SMS/email/approved masked-contact providers. A delivered push is never treated as proof that a safety-critical message was seen.
- **KYC/media storage:** S3-compatible provider abstraction; MinIO/local equivalent for local tests, managed encrypted object storage for production; presigned access, malware/quarantine process, lifecycle/retention and strict evidence authorization.
- **Observability:** OpenTelemetry + an error/performance platform (for example Sentry or equivalent), structured logs/metrics/traces, PII redaction and cost/provider dashboards.
- **Infra:** Docker Compose for local dependencies; real staged cloud environments with secrets management, least privilege, backups, restore tests and environment parity where practical. Never use the developer laptop as the public production server.
- **Payments:** cash plus regulated/provider-approved digital rails through a payment orchestration boundary; signed webhooks/payment intents and an internal double-entry ledger. Do not implement unlicensed stored value.

## Unified mobile architecture
The public app is one distribution artifact but **not** one giant undifferentiated code module.

Recommended internal boundaries:
- `core/account` — identity/session/consent/capabilities/restrictions.
- `features/rider/*` — booking, quotes, offers, trips, payment, history.
- `features/driver/*` — onboarding/KYC, online state, offers, navigation, earnings.
- `features/safety/*` — shared safety centre with role-aware actions.
- `features/support/*` — role-aware support/cases.
- `features/notifications/*` — context/deep-link routing.
- `platform/location/*` — permission lifecycle and driver background worker.
- `platform/providers/*` — client-side provider adapters.

Rider modules must not initialize driver background services merely because they exist in the same binary. Server capability state remains authoritative; local mode is only presentation/context.

## Suggested monorepo layout
```text
apps/
  wayvro-mobile/           # ONE public iOS/Android app
  web-public/
  web-ops/
  web-partner/             # later, if corporate/fleet need justifies it
  api/
  worker/
packages/
  contracts/               # API/event schemas + generated clients
  domain/                  # shared pure value objects where justified
  mobile-ui/               # design tokens/primitives, no business authority
  web-ui/
  config/
  db/                      # server-only
  observability/
  provider-interfaces/
infra/
  docker/
  ci/
  deploy/
  runbooks/
docs/
  adr/
  prd/
  threat-models/
  operations/
  decisions/
  reviews/
  phases/
tests/
  contract/
  integration/
  e2e/
  load/
  chaos/
```

Exact folder names may change in Phase 1, but the **single public mobile distribution** and server-authorized multi-profile/capability model are founder-locked unless explicitly changed later. *(Phase 0: this tree and the one in docs/28 §13 were harmonised; the canonical proposal is `docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md` §3, which adds `apps/realtime` as a separate gateway process and `packages/provider-adapters/*`.)*

## Change-safe architecture rule
UI/presentation must remain replaceable behind explicit typed contracts. Mobile/web code must never import database/server implementation packages. A visual redesign should normally require no backend change. Contract/schema changes use compatibility tests and staged rollout; destructive database evolution uses **expand -> migrate/backfill -> switch -> contract**. Root `CLAUDE.md` and `docs/27_ENGINEERING_GUARDRAILS_AND_CHANGE_SAFETY.md` are permanent execution guidance.

## Bounded contexts
Identity & Consent; Account/Profile/Capability; Driver & Vehicle Compliance; Supply & Presence; Catalog & Geo Zones; Geo Routing; Pricing & Quotes; Dispatch & Offers; Trip Lifecycle; Pooling; Payments & Ledger; Payouts & Reconciliation; Trust & Incidents; Support; Communication/Notifications; Fleet/Corporate; Promotions/Growth; Analytics/Experiments; Administration & Audit.

Each context exposes explicit interfaces; no shared database table becomes an uncontrolled cross-domain mutation surface.

## Scaling path
**Stage A — build/pilot:** modular API + worker(s), PostgreSQL/PostGIS, Redis, object storage, DNS/TLS, backups and monitoring. Separate process roles where useful; use paid production capacity when free tiers sleep or lack required SLA/terms.

**Stage B — city growth:** horizontal API/worker replicas, websocket fanout, queue tuning, geospatial optimization, CDN/caching where appropriate, rate limits, private networking and stronger observability/on-call.

**Stage C — measured hotspots:** isolate dispatch/location or payment/reconciliation workloads only when profiling/load proves a need; partition high-volume location/event data; introduce dedicated services intentionally.

**Stage D — broader scale:** multi-AZ/region and more independent services only as SLO/economics/incident data justify. No Kafka/Kubernetes/microservice theatre.

## Core reliability patterns
- Authenticated APIs with idempotency/conflict semantics for critical transitions.
- Atomic/serialized driver assignment backed by database invariants and concurrency tests.
- Durable outbox + deduplicating consumers.
- Realtime/push are delivery channels, not authoritative state.
- Server time for expiries/leases/schedules.
- Provider timeouts/circuit-breaker/fallback policies without fabricating successful ETA/payment/KYC results.
- Role/capability authorization independent of mobile navigation state.
- Mode switching cannot bypass trip/driver obligations or KYC restrictions.
- Driver suspension and account-wide suspension are distinct policy concepts.

## Architecture research spikes before freeze
1. Unified React Native/Expo app: rider-only cold start, driver-mode lazy initialization, background GPS, crash/restart recovery and battery use across representative Android/iOS devices.
2. Store/permission review feasibility for one multi-role app that sometimes needs background location/camera/KYC but should not prompt rider-only users prematurely.
3. PostGIS nearest-driver queries and atomic concurrent assignment at synthetic scales.
4. Websocket/realtime reconnect and authoritative state recovery.
5. Lahore map/geocode/route/ETA/navigation quality and provider costs/licensing.
6. OTP/KYC/payment provider feasibility and Pakistan merchant terms.
7. End-to-end ride + ledger behavior under duplicate requests, crash/retry, payment-webhook replay and network loss.
8. Unified-app cross-mode regression harness proving rider changes do not break driver background/KYC and vice versa.

Exact framework/runtime/ORM/provider versions are frozen only after current compatibility, maintenance, licensing, security and migration proof.
