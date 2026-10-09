# 02 — Top-level Platform Hierarchy

**Founder-locked distribution decision:** Wayvro has **one public mobile app** for riders and earning partners. A single account may contain a normal Rider profile and, after onboarding/approval, a Driver/Partner profile. Users switch modes inside the same app. Staff/admin capabilities remain in separately secured web systems. See `docs/28_APP_SURFACES_AND_REPO_TOPOLOGY.md` and requirements `V01–V14`.

## 1. Wayvro public mobile app

### 1A. Shared account shell
1. Language/localization, accessibility, consent and privacy controls.
2. +92 phone OTP, optional Google/Apple account linking, session/device management and recovery.
3. One identity account with role/capability state; no duplicate rider-vs-driver accounts for the same user merely to switch modes.
4. Notifications/inbox, support, safety centre, trusted contacts, legal policies, data export/deletion and account settings.
5. Mode switch entry that clearly shows Rider mode, Driver/Partner application status and approved Driver/Partner mode.

### 1B. Rider mode
1. Home map, pickup/dropoff search, landmarks, saved places and geolocation consent.
2. Service classes: car, bike, rickshaw and later approved categories (comfort/XL/accessibility/women-focused/etc.).
3. Pricing modes: fixed/upfront and later negotiated/counter-offer mode where enabled.
4. Ride request, quote validity, driver offer/choice where applicable, dispatch, driver arrival and pickup verification/PIN.
5. Live trip, ETA/route, multi-stop, route change rules, masked communication, trip sharing and safety tools.
6. Cash/digital payment, receipts, tips, promotions, disputes/refunds and support.
7. Ratings, history, lost-item/help, blocked/no-rematch driver policy and trust controls.
8. Scheduled rides, guest/delegate/corporate-linked rides and later intercity/delivery/shared-ride products.
9. Women-focused preferences/service categories only when eligibility, supply, privacy and safety gates are approved.

### 1C. Driver/Partner onboarding inside the same app
1. “Earn with Wayvro” entry from the shared account shell.
2. Applicant details, +92 verified identity link, CNIC front/back, guided selfie/liveness/manual fallback, driving licence, vehicle registration, insurance/permit/fitness/token-tax evidence where applicable.
3. Training/policy acceptance, vehicle inspection/process status and approval/rejection/appeal states.
4. Document expiry/reverification and suspicious-account-sharing checks.
5. Approval creates/enables Driver/Partner capabilities without removing Rider mode.

### 1D. Driver/Partner mode
1. Go online/offline, driver status, service area, vehicle/service-capability selection and availability controls.
2. Ride/job offers, negotiated/fixed-fare handling, accept/counter/decline and offer expiry.
3. Navigation to pickup, rider details limited to approved information, arrival/wait/no-show/cancellation handling and pickup verification.
4. Live trip, stops, route safety, background GPS/location freshness, offline/resync behavior and completion.
5. Earnings, commission/fees, cash receivable, statements, incentives, tips, adjustments and payout/settlement status.
6. Driver safety centre, rider rating/reporting, emergency/support, appeal and account health.
7. Driver destination/queue/airport/heatmap/back-to-back or similar advanced marketplace tools when validated and approved.
8. Pool-seat/courier/delivery capabilities only after their own service gates pass.

### 1E. Mode-switch integrity
1. Mode is a UX context, not authorization.
2. Server blocks illegal conflicts: no incompatible active rider trip while serving driver work; no abandoning an active driver obligation by switching UI mode.
3. Role-specific restrictions are separate: expired driver documents can block earning while lawful Rider mode remains usable; account-wide safety/legal actions can block the whole account.
4. Deep links, notifications, app restart and crash recovery return the user to an authorized, consistent state.
5. Driver-only sensitive permissions/background services are requested/started only when justified by the driver flow.

## 2. Staff/operations web system (private, server-authorized)
Initial modules may share one application shell but must be permission-isolated:
- Operations command centre: active rides, drivers, zones, incidents, cancellations, reassignments and map monitoring.
- Trust & Safety: KYC review, fraud, restrictions, appeals, emergency incidents and evidence controls.
- Customer/driver support: cases, masked contact, refunds, lost items, complaints, SLAs and escalation.
- Finance: ledger, cash receivables, fees/commission, incentives, payout files, reconciliation, invoices and disputes.
- Pricing/revenue: city/service rate cards, caps/floors, negotiated-fare controls, experiments and versioning.
- Fleet/partner operations: organizations, vehicles, driver affiliation, documents, settlement and support.
- Corporate/business operations: organizations, cost centres, travellers/guests, policies, invoices and reporting.
- Growth/marketing: campaigns, vouchers, referrals, abuse controls and attribution.
- Platform/SRE: provider health, queues/jobs, feature flags, metrics, cost, incidents and audit.
- Privileged administration: least privilege, dual approval for high-risk actions, break-glass controls and audit.

## 3. Public/marketing/support web surface
Landing pages, city/service information, driver/partner signup lead-in, trust/safety centre, FAQs, pricing explanations, legal/privacy, accessibility, support/status, corporate/fleet leads, careers/press/partners and anti-phishing reporting. *(Phase 0: made atomic as requirements W01–W09 — see `docs/03` Phase 0 additions.)*

## 4. Corporate/fleet/partner web surfaces
Enable only when needed. Keep these separate from staff administration and the public consumer app. Potential functions: employee/guest booking, spend policy, invoices, reporting, fleet vehicle/driver management, document status and support.

## 5. Platform/system services
- Identity/account/profile/capability/restriction/consent.
- Driver KYC/document/vehicle/service eligibility.
- Pricing, quotes, negotiated offers and promotions.
- Geospatial search, maps, routing, ETA and location freshness.
- Supply presence, driver online state, dispatch/assignment and queues.
- Trip orchestration, scheduled jobs and state machines.
- Realtime streams, push/SMS/email communication and masked contact.
- Payment orchestration, double-entry ledger, cash settlement, payouts/refunds/disputes.
- Pool matching/seat assignment/route optimization.
- Trust/safety, incidents, fraud/risk, evidence retention and support cases.
- Config/feature flags, analytics, telemetry, experimentation and immutable audit trails.

## 6. Offline company operations
Driver onboarding/inspection, transport permits/compliance, insurance/takaful relationships, emergency response, support staffing, PSP/banking relationships, accounting/tax, data/privacy governance, marketing/partnerships, incident drills, physical driver/support centres and city expansion governance.

## 7. Future service families
Shared commute/pooling, scheduled airport, intercity, courier/delivery/COD, freight/cargo, subscriptions/passes, accessibility services, family/guardian arrangements, corporate/fleet, EV initiatives and partner APIs. Each is an independently gated vertical; presence in architecture is not permission to launch it.
