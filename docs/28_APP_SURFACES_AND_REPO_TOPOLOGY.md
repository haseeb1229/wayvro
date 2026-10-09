# 28 — App Surfaces, Unified Role Model and Repository Topology

## Founder decision — resolved
Wayvro will have **one public mobile application** for both passengers and earning partners.

A user installs Wayvro once. The default experience is Rider mode. Inside the same account, the user can choose **Earn with Wayvro**, complete Driver/Partner onboarding, and — once approved — switch between Rider and Driver/Partner modes.

This decision is founder-locked for v5. Claude must not split the public product into separate Wayvro Rider and Wayvro Driver store apps merely because other companies use that pattern.

## 1. Why one public app is valid
Current market patterns are mixed:
- inDrive currently distributes one app that supports rider, driver and delivery-partner use, including a switch into driver mode.
- Yango uses a rider app and a separate Yango Pro driver app.
- Bykea uses a separate Partner app for earning partners.
- Uber internationally uses separate rider and Driver apps.

Therefore separate apps are **not** an industry requirement. Wayvro intentionally chooses the unified pattern because it can reduce install/account friction and lets one person naturally be both a customer and an earning partner.

The unified pattern has costs: larger binary, broader store permission declarations, one release blast radius, more complex navigation/state restoration and the risk of driver-only services affecting rider UX. Requirements `V01–V14`, this document and `CLAUDE.md` are the mitigation plan.

## 2. Account and profile model
Treat these as different concepts:

### Identity Account
The human's canonical Wayvro identity/contact/session container. It owns phone verification, linked OIDC identities, consent, devices and account-wide restrictions.

### Rider Profile
Normal customer/traveller profile. It contains rider-facing preferences/trust/rating/history references as allowed by policy.

### Driver/Partner Profile
Optional earning profile linked to the same account. It contains application/KYC/compliance/training/earnings/restriction state.

### Vehicle Profiles / affiliations
A driver may have one or more approved vehicles or fleet affiliations, each with service/city/document eligibility.

### Service capabilities
Examples: car driver, bike driver, rickshaw driver, courier/delivery partner, intercity eligibility, women-focused service eligibility. A capability is not granted merely because the UI shows the mode.

### Mode
`Rider` or `Driver/Partner` is the current **presentation/work context** on the client. Mode does not grant authorization. The backend derives allowed actions from account/profile/capability/restriction state.

## 3. Rider mode
Rider mode contains the passenger experience: booking, fare/offer selection, live trip, safety, payment, history, support, scheduling, pooling and later approved verticals.

Rider-only users should never be forced through driver KYC or driver permissions.

## 4. Driver/Partner onboarding and mode
From Rider/shared account UI, a user can start `Earn with Wayvro`.

Expected onboarding states:
- not started;
- draft/application incomplete;
- submitted;
- document/identity review;
- additional information required;
- training/inspection required;
- approved but unavailable due to expired/missing service/vehicle eligibility;
- approved and able to enter Driver/Partner mode;
- restricted/suspended/appeal;
- permanently ineligible where policy/law requires.

Normal rider usage may continue while a driver application is pending/rejected/suspended **unless** an account-wide safety/fraud/legal restriction applies.

Driver/Partner mode contains online/offline, service/vehicle selection, offers, route-to-pickup, active trip/job, earnings, driver safety/support and compliance/account-health surfaces.

## 5. Mode-switch rules
The mode switch must be easy but not unsafe.

Server-enforced examples:
- Rider with no approved Driver profile -> switch entry opens `Earn with Wayvro` onboarding, not fake driver mode.
- Approved driver who is offline and has no incompatible active rider trip -> can enter Driver/Partner mode.
- Driver currently online/assigned/on-trip -> cannot escape obligations by switching to Rider mode; the app can expose rider/account utilities only if product rules explicitly permit them.
- User currently on an incompatible active passenger trip -> cannot go online as a driver.
- Driver documents expire/restriction activates -> driver mode may remain visible for account health/appeal/earnings but `Go online` is blocked.
- Severe account-wide restriction -> both modes are blocked according to policy.
- Crash/restart/new device -> authoritative backend state is restored before allowing a conflicting action.

Exact simultaneous-use policy must be an ADR/state-machine output in Phase 0/2. *(Phase 0 proposal: `docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md` §5 — an online-but-idle driver must go offline before booking as a rider; `ASSIGNED…ON_TRIP` blocks switching; D26 single-vehicle and D27 single-session invariants added.)*

## 6. Permission strategy in one binary
One app does **not** mean requesting every permission at install.

### Rider-related
- foreground location only when needed for pickup/map convenience;
- notifications with clear benefit and recoverable denial;
- camera/media only for an explicit rider flow (for example profile/evidence where allowed).

### Driver/Partner-related
- camera/document access during KYC/evidence capture;
- precise location required for relevant driver flows;
- background location/foreground service only when the user has entered an approved driver state that justifies it;
- navigation, Bluetooth/phone or other permissions only if a validated feature genuinely needs them.

The app must handle denied/revoked/“don't ask again” states, OS kill/relaunch and privacy disclosure. Rider mode must not initialize high-frequency driver tracking in the background.

## 7. State, data and authorization isolation
Same account does not mean blended data.

Keep explicit role-scoped boundaries for:
- rider rating/trust vs driver rating/performance;
- rider payment methods/receipts vs driver earnings/payouts/cash settlement;
- rider trip history vs driver completed-job history;
- driver KYC/CNIC/licence/vehicle evidence;
- rider/driver support cases;
- driver restrictions vs account-wide restrictions;
- notification categories and operational alerts.

UI filtering is insufficient. Backend authorization and query scoping must prevent cross-mode leakage.

## 8. Navigation and notification model
The app needs a shared shell plus role-specific navigation graphs.

Example conceptual structure:
```text
Wayvro App
├─ Shared account/auth/safety/support shell
├─ Rider mode navigation
│  ├─ Home / Where to?
│  ├─ Service + quote/offer
│  ├─ Active ride
│  ├─ Trips / receipts / support
│  └─ Rider settings
└─ Driver/Partner mode navigation
   ├─ Online map / demand
   ├─ Offer / pickup / active job
   ├─ Earnings
   ├─ Vehicle/service selection
   ├─ Compliance/account health
   └─ Driver support/safety
```

Deep links and push notifications carry a context, but the app must re-check server authorization and active state before routing. A driver payout notification must not dump a user into rider booking context; a rider trip notification must not silently switch an active driver out of their work state.

## 9. Performance and initialization boundaries
Because one binary includes both domains:
- establish cold-start/time-to-interactive budgets for rider-only use;
- do not initialize driver maps/background workers/KYC SDKs until needed;
- lazy/deferred-load heavy modules where the chosen mobile stack supports it;
- avoid duplicate provider SDKs/libraries;
- profile memory/battery/binary size on representative low-end Android devices;
- keep driver telemetry frequency adaptive and policy-driven;
- segment crash/performance dashboards by current mode and feature path.

## 10. Release blast-radius controls
One app release can affect both audiences, so release discipline is stricter:
- cross-mode regression suite on every release;
- mode-scoped feature flags/kill switches for risky non-core capabilities;
- staged rollout/canary cohort;
- backend compatibility with supported older Wayvro app versions;
- crash-free/session/ANR/background-location/payment/booking metrics segmented by version/mode;
- rollback/forward-fix procedure that considers active trips and drivers already online.

## 11. Staff/internal app boundary
Do **not** put staff/admin controls into the public Wayvro mobile app.

Initial private web application may contain role-isolated modules for:
- operations;
- support;
- trust & safety/KYC;
- finance/reconciliation;
- pricing/revenue;
- fleet/corporate operations;
- growth;
- SRE/platform;
- privileged administration.

All are server-authorized and audited. “Admin dashboard” is not one universal superuser role.

## 12. Other web surfaces
- Public marketing/support/trust/legal/status site.
- Corporate/fleet portal later if justified.
- Call-center/guest booking tools for authorized staff/business users.
- Partner/API developer surface only after a real integration need.

## 13. Recommended monorepo topology
```text
apps/
  wayvro-mobile/          # single public iOS/Android app
  web-public/
  web-ops/
  web-partner/            # later / gated
  api/
  worker/
packages/
  contracts/
  domain/
  mobile-ui/
  web-ui/
  config/
  db/                     # server-only
  observability/
  provider-interfaces/
infra/
  docker/
  ci/
  deploy/
  runbooks/
docs/
  adr/
  threat-models/
  operations/
tests/
  contract/
  integration/
  e2e/
  load/
  chaos/
```

Inside `apps/wayvro-mobile`, preserve feature boundaries such as `features/rider`, `features/driver`, `features/account`, `features/safety`, `features/support`, plus platform services like location/notifications. Do not create two hidden apps inside the repo and call that “one app”.

## 14. Shared-code rules
Safe to share:
- account/session transport;
- runtime-validated API contracts/generated clients;
- design tokens/primitives;
- localization infrastructure;
- pure utility/value objects;
- observability/config/provider abstractions.

Do not share by shortcut:
- database models as mobile API types;
- server repositories/secrets;
- staff authorization in public clients;
- driver KYC evidence objects with normal rider screens;
- giant `common` packages that mix unrelated domains.

## 15. Store identity
Before public distribution the single app needs:
- one approved Android application ID and iOS bundle ID;
- protected signing/release pipelines;
- store metadata that accurately describes both riding and earning capabilities;
- data-safety/privacy disclosures and account-deletion path;
- justified background-location/camera/notification declarations;
- deep/universal links;
- staged rollout and minimum-supported-version policy.

Final identifiers are not invented before company/domain/store/trademark checks.

## 16. Why this is the current Wayvro decision
The goal is not to copy inDrive merely because it uses one app. The goal is to honor the founder's product preference **and** make it technically disciplined: one install and one account, with modular role-specific UX and strict server authorization.

The correct standard is therefore:

> **One public Wayvro app, multiple approved profiles/modes, zero security assumptions based on the visible mode switch.**
