# 21 — Master Coverage Matrix (Canonical Review Domains)

Phase 0 must prove coverage across **all** domains below. A domain is RED if any critical behavior is only implied or lacks a requirement ID.

| Domain | Required surfaces / concerns | Primary IDs |
|---|---|---|
| Identity/Auth | +92 OTP, Google/Apple linking, sessions/devices, staff MFA, recovery, KYC/liveness | A/K/Q |
| Wayvro Rider mode | booking, maps, categories, quotes/bids, driver choice, trip, history, ratings, support | A/B/C/L/N/P/V |
| Wayvro Driver/Partner mode | in-app onboarding/KYC, mode switching, online/offline, offers/bids, navigation, wait/PIN/trip, earnings, safety, preferences | D/K/M/N/V |
| Marketplace/dispatch | geo eligibility, atomic assignment, offer leases, fairness, scheduled/pool queues | E/F/M |
| Pricing/finance | rate cards, quotes, bids, cash/digital, ledger, fees, payouts, reconciliation | G/O |
| Safety/trust | identity mismatch, Safety Center, SOS, share, anomalies, recording, incidents, insurance | C/K/N |
| Pooling/women | seats, detours, fares, consent, no-rematch, verified women preferences/modes | F/K/R |
| Payments Pakistan | Cash, regulated PSP card/wallet, JazzCash/Easypaisa/Raast ADRs, refunds | G/O |
| Support/assisted access | in-app/phone, call-center booking, tickets, help CMS, agent KB, low-data | C/L/P/R |
| Admin/ops | KYC, live trip, incidents, refunds, finance, config, city, fleet, audit | H/R |
| Fleet/corporate | KYB, vehicle/driver assignment, policy, billing, invoices, permissions | H/R |
| Delivery/freight/intercity | service-specific permits, proof, COD, prohibited goods, fatigue, disputes | D/R |
| Mobile quality | background GPS, permissions, killed app, low-end devices, battery/data, RTL/accessibility | I/Q |
| Security/privacy | vault, least privilege, app attestation, WAF, key management, audit, privacy requests | H/I/K/Q |
| Reliability/SRE | outbox/idempotency, CI/CD, SLO, backup/DR, rollout/rollback, status/on-call | I/Q |
| Data/analytics/growth | event quality, marketplace/safety/finance CX scorecards, CRM/promos/experiments | I/J/P/R |
| Legal/regulatory | TNC license, route permits, fitness, insurance, tax, payments, privacy/biometrics | J/R |
| Company/GTM | driver supply, support staffing, pilot, marketing, brand/app stores, city expansion | J/R |
| Engineering workflow | canonical docs, repo truth, gated phases, SHA evidence, Docker/Git safety | I/R |
| Change safety/code health | frontend/backend boundaries, typed contracts, backward compatibility, migrations, dead code/cycles, feature flags, CI/build/rollback discipline | I/Q/R + docs/27 |
| Unified mobile topology | one public Wayvro app, Rider + approved Driver/Partner profiles/modes, server capability boundaries, just-in-time driver permissions, cross-mode release regression, staff/public/partner web boundaries | A/D/I/Q/V + docs/28 |
| Startup governance/company controls | IP/cap table, personnel access, accounting/tax/runway, procurement, physical ops, crisis/continuity | T |
| Store/SDK/assurance closure | permissions, account deletion, SDK disclosures, external pentest, algorithm governance, release go/no-go, gap closure | U |
| Edge product/corporate mobility | business profiles/delegates/API, round trip, push/auth edge cases, multi-drop and future driver UX | S |
| Web ecosystem (Phase 0) | public website IA/CMS, legal pages as canonical versioned location, driver lead capture without document collection, anti-impersonation/official channels, web analytics consent, web infra security, web booking hardening, staff ops web shell baseline | W + J01/L09/L10 |
| Pakistan compliance artefacts (Phase 0) | TNC licence, 44B district permits, police character certificate, PSCA QR panic button, fitness/insurance/token tax, FOSPAH harassment governance, post-trip contact lockdown, dues policy, single-vehicle/session invariants, offer alerting, release artefact policy, fuel-indexed pricing, telecom-outage continuity, supply preview | R46/R47/N31/G17/D26/D27/M26/Q49/E20/S26/B26 |

## Cross-cutting state checklist for every user-visible feature
Happy path; loading; empty; offline; slow; retry; duplicate/replay; permission denied; provider outage; cancellation; timeout; background/killed app; stale data; abuse/fraud; support escalation; accessibility; localization; analytics; privacy/retention; rollback. Financial or safety features also need reconciliation/appeal/evidence states.
