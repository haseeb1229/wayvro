# 16 — Primary Sources, Dated Research, Architecture/Open Decisions

**Research snapshot:** 2026-10-09. This pack synthesizes publicly advertised capabilities; it has NOT inspected private competitor code, tested every current app feature in every city, completed field interviews or established Pakistan-wide legal advice. Links are for verification and future refresh.

## Market/competitor sources
- inDrive Pakistan: https://indrive.com/en-pk
- inDrive Delivery: https://indrive.com/en-pk/delivery
- Yango Pakistan rider: https://yango.com/en_pk/rider/
- Yango driver and vehicle classes: https://yango.com/en_pk/driver/
- Bykea: https://bykea.com/ and https://bykea.com/bykea-ride/
- PinkGo: https://pink-go.com/ride-sharing.php
- HazRide: https://www.hazride.com/
- Careem ceased ride-hailing Pakistan 2025-07-18 (Reuters 2025-06-18): https://www.reuters.com/world/asia-pacific/ride-hailer-careem-suspend-decade-old-pakistan-service-2025-06-18/
- inDrive global 2025 growth, Reuters 2026-03-16: https://www.reuters.com/world/asia-pacific/ride-hailing-app-indrive-says-revenue-up-31-2025-eyes-delivery-expansion-2026-03-16/

## Legal / privacy / payments source leads (requires counsel)
- SECP formation: https://www.secp.gov.pk/start-your-company/
- Punjab route permits: https://transport.punjab.gov.pk/procedure-of-obtaining-route-permit
- Punjab Transport Co permits: https://ptc.punjab.gov.pk/route_permit
- Punjab 2026 ride-hailing permit amendment reporting: https://www.brecorder.com/news/40432256/punjab-motor-vehicles-ordinance-ride-hailing-vehicles-required-to-possess-route-permits
- State Bank of Pakistan licensed EMIs and PSO/PSPs: https://www.sbp.org.pk/our-operations/payments-ecosystem-and-infrastructure/emis-and-pso-psps
- Pakistan personal data protection law status (2026 overview): https://practiceguides.chambers.com/practice-guides/data-protection-privacy-2026/pakistan
- Pakistani regulatory notices frequently change. Determine legally enforceable local obligations directly with regulators and licensed counsel before pilot.

## Technology/provider source leads
- Google Maps billing/free caps: https://developers.google.com/maps/billing-and-pricing/overview
- Mapbox prices: https://www.mapbox.com/pricing
- OSM tile usage: https://operations.osmfoundation.org/policies/tiles/
- Neon Free (2026-10-02): https://neon.com/blog/neon-free-plan-1-gb-per-project
- Supabase free project pausing: https://supabase.com/docs/guides/platform/free-project-pausing
- Firebase SMS pricing/limits: https://firebase.google.com/docs/auth/limits
- Firebase service pricing: https://firebase.google.com/pricing
- Expo Build: https://docs.expo.dev/build/ and https://expo.dev/pricing
- Cloudflare R2: https://developers.cloudflare.com/r2/pricing/
- Resend: https://resend.com/pricing
- Github Student Pack updates: https://github.com/github-education-resources/Student-Developer-Pack-Current-Partners-FAQ/blob/main/SDP-changelog.md
- Apple Developer membership: https://developer.apple.com/programs/

## Proposed ADR decisions requiring review before hard freeze
- ADR-001 product name — **FOUNDER-LOCKED as Wayvro (WAY-VRO)**. No rename without explicit founder decision. Company-name/trademark/domain/app-store/social-handle/IP clearance remains OPEN and must be evidenced before public brand launch.
- ADR-002 exact city-zone and vehicle classes for first controlled pilot — PROPOSED Lahore/car.
- ADR-003 React Native Expo managed + development builds vs React Native bare for background/navigation — OPEN TECH SPIKE.
- ADR-004 Drizzle vs Prisma/Kysely+raw PostGIS SQL for geo-critical transactions — OPEN BENCHMARK.
- ADR-005 Socket.IO vs standard WebSocket gateway with Nest/Fastify — OPEN TECH SPIKE.
- ADR-006 Mapbox vs Google vs licensed OSM rendering/navigation stack — OPEN CITY FIELD TEST and COST.
- ADR-007 Identity/OTP provider and failover in Pakistan — OPEN VENDOR AND COST.
- ADR-016 Google/Apple OIDC integration, session and account linking — OPEN SECURITY/VENDOR TEST.
- ADR-017 Driver CNIC, selfie liveness, face-to-ID, manual fallback, retention and accuracy — OPEN PRIVACY/CONTRACT/LEGAL AND INDEPENDENT REVIEW.
- ADR-018 Passenger KYC triggers vs default phone OTP — OPEN PRODUCT/LEGAL/SAFETY REVIEW.
- ADR-008 Merchant PSP payments/payouts and cash-collection structure — OPEN COMMERCIAL/LEGAL.
- ADR-009 Driver vetting/insurance and women-only category policies — OPEN LEGAL/OPERATIONS.
- ADR-010 Storage, encryption and retention — OPEN PRIVACY REVIEW.
- ADR-011 Business legal entity, tax and route permit model — OPEN.
- ADR-012 P0 service SLO/incident SLA and staffing — OPEN.
- ADR-013 Pricing model for initial zone, commission, driver economics, dispute policies — OPEN MARKET TEST.
- ADR-014 Pool constraints, fare allocation and passenger safety — OPEN before Phase 11.
- ADR-015 License compatibility for all open-source/map/mobile libraries — OPEN BEFORE RELEASE.

## Decision workflow
Each ADR has context, options, objective tradeoffs, cost/operational burden, backward compatibility, legal and privacy considerations, experiments, recommendation, decision date, approving founder, accepted tradeoffs and re-evaluation trigger. Do not smuggle unresolved assumptions into package.json or production deployment.

## Additional verified official sources (October 2026)
- Vercel Hobby excludes commercial use: https://vercel.com/docs/plans/hobby
- GitHub Student Pack current offers: https://education.github.com/pack
- Google Play Console sign-up and USD $25: https://support.google.com/googleplay/android-developer/answer/6112435
- Apple membership and USD $99: https://developer.apple.com/programs/


## v3 research refresh — official/current evidence added 2026-10-09
- Yango Lahore/Pakistan: low-data Yango Lite, browser ordering, verified drivers, live route sharing, SOS/support, Economy/Comfort/Bike/Rickshaw, in-app card/wallet claims, scheduled rides and multiple stops: https://yango.com/en_pk/city/lahore/ and https://yango.com/en_pk/rider/
- Bykea Safety/FAQ: phone verification, driver checks/training, ratings, GPS tracking, 24/7 helpline, optional insurance/takaful claims and phone booking without smartphone: https://bykea.com/safety/ and https://bykea.com/faq/
- inDrive company/services and driver choice: city rides, City-to-City, Courier, Freight, Fleet; rider chooses offers using price, ETA/distance, rating/trip count and vehicle; safety and real-time controls: https://indrive.com/company and https://blog.indrive.com/
- Uber safety benchmark: Safety Toolkit, two-way ratings, RideCheck, anonymous communications, audio recording, PIN, emergency contacts, dashcam notices, periodic driver selfie and driver hour limits: https://www.uber.com/us/en/ride/safety/ and https://www.uber.com/pk/en/ride/safety/
- Careem benchmark: scheduled rides, multiple service classes including Kids/XL, real-time tracking and secure payments: https://www.careem.com/en-AE/ride/
- Punjab Transport Authority explicitly regulates TNCs, including Bykea/inDrive/Yango: https://pta.punjab.gov.pk/pta-regulatory-powers
- Punjab route-permit requirements include CNIC, vehicle registration/ownership, token tax, fitness certificate and third-party risk insurance: https://transport.punjab.gov.pk/procedure-of-obtaining-route-permit
- Punjab official TNC operating-license page: https://transport.punjab.gov.pk/TRANSPORT%20NETWORK%20COMPANIES%20OPERATING%20LICENSE
- SBP Raast P2M supports QR, Request-to-Pay, IBAN and Merchant Alias and directs businesses to banks/payment providers for integration: https://www.sbp.org.pk/our-subsidiaries/raast/raast-person-to-merchant and https://www.sbp.org.pk/our-subsidiaries/raast/join-raast
- JazzCash merchant sandbox documents payment-gateway/API modes; production commercial onboarding and current terms still require direct verification: https://sandbox.jazzcash.com.pk/SandboxDocumentation/index.html
- MoITT legislation page still lists the 2023 Personal Data Protection Bill as Draft; do not claim a comprehensive private-sector data-protection act is enacted without counsel/current gazette verification: https://www.moitt.gov.pk/Legislations

### New ADRs required by v3
- ADR-019 low-data/Lite mode and web/call-center assisted booking architecture.
- ADR-020 rider/driver ratings, reputation, blocking/no-rematch and offer-profile fields.
- ADR-021 safety recording/dashcam/anomaly/crash-check policy and evidence retention.
- ADR-022 Pakistan payment rails: cash, card PSP, JazzCash/Easypaisa/Raast and payout/commission settlement.
- ADR-023 driver hour/fatigue, destination/queue preferences and airport operations.
- ADR-024 device attestation/mobile tamper, release signing/provenance, SLO/RPO/RTO and IaC baseline.
- ADR-025 TNC license/route-permit/fitness/insurance/token-tax data model and regulator-facing lawful export.

## v5 app-topology correction — official/current evidence 2026-10-09
The prior v4.1 recommendation incorrectly treated separate rider/driver apps as the default. Public market evidence shows both valid patterns:
- **inDrive unified app:** current Google Play listing explicitly markets the same app for rider, driver and delivery-partner use: https://play.google.com/store/apps/details?gl=pk&hl=en-gb&id=sinet.startup.inDriver
- **inDrive mode switching:** official inDrive driver guide instructs users to open the same app and select “Switch to driver”: https://blog.indrive.com/en-za/article/drivers-101-how-to-use-our-app
- **Yango separate driver distribution:** Pakistan driver pages direct earning partners to `Yango Pro`: https://yango.com/en_pk/driver/lahore/
- **Bykea separate Partner app:** Bykea's own partner onboarding directs drivers to the Bykea Partner app: https://bykea.com/about-partner/
- Uber internationally also maintains a separate Driver app, while its rider product is separate; this remains a benchmark rather than a Wayvro architecture mandate.

**Decision:** Wayvro intentionally adopts the unified-public-app model. This is not because a competitor does it; it is because the founder wants one install/account where a person can ride and, after approved onboarding, earn. Technical risks are handled by V01–V14 and docs/28.

### ADR-026 — Unified Wayvro public mobile app — FOUNDER-LOCKED
- **Decision:** one public iOS/Android Wayvro application; Rider mode + optional approved Driver/Partner profile/mode in the same account.
- **Not allowed by default:** separate Wayvro Rider and Wayvro Driver store apps, duplicate identities for role switching, or client mode as authorization.
- **Phase-0 technical work:** validate permissions, background location, navigation, deep links, app size/startup/battery, crash recovery, mode conflicts, store declarations and cross-mode regression strategy.
- **Reopen condition:** only an explicit founder decision based on strong evidence, not coding convenience.

## Phase 0 update — 2026-10-09
- The current ADR backlog (ADR-001..ADR-026 plus new ADR-027 CI/dead-code tooling, ADR-028 hosting topology/region, ADR-029 background-location SDK, ADR-030 web framework/hosting, ADR-031 OTA update policy, ADR-032 PSCA/emergency integration, ADR-033 driver offer wake strategy, ADR-034 monorepo tooling/runtime) with options, recommendations, statuses and spike definitions is `docs/phase0/PHASE0_ADR_BACKLOG.md`; this file keeps the dated sources. Spikes SP-01..SP-08 are defined and **NOT RUN**.
- Fresh sourced research (observed 2026-10-09) is filed under `docs/phase0/research/R1–R6` and supersedes older figures here where they differ (notably: Firebase phone auth is paid; Twilio PK SMS ≈ $0.47/segment; Punjab TNC licence regime reported live since March 2026 (incumbent-specific status = SECONDARY_REPORT / NEEDS_OFFICIAL_RECONCILIATION); Section 44B permits reported July 2026; PDP Bill still unenacted; Neon Free scale-to-zero cannot be disabled; MinIO upstream reportedly archived).
- Founder-review closure pass (2026-10-09): founder decisions FD-01..FD-14 recorded; ADR-009 (no gender inference), ADR-011 (SMC vs multi-member entity, incorporation started), ADR-017 (no in-house face/liveness ML), ADR-033 (no full-screen-intent dependency), new ADR-035 (modular monolith baseline) and ADR-036 (JDK 17 Android toolchain) updated in `docs/phase0/PHASE0_ADR_BACKLOG.md`; spike schedule set (SP-AND/SP-03/SP-05 in Phase 1 early entry; SP-01/SP-02/SP-04 before Phase 3 freezes).
- ADR-026 (one public app) was re-verified against inDrive's current single-app/driver-mode distribution versus Yango Pro and Bykea Partner separate apps; the founder-locked decision stands.
