# 03 — Master Feature Catalog (initial baseline)

**Scope contract:** Each item must have a requirement ID, exact actor, user story, conditions, acceptance tests, security/privacy notes, state/data/API dependencies and release flag before implementation. The following are **inventory features**, not promises all will be live on day one. Maintain a machine-readable catalog as the project matures; no orphan features in code or undocumented promises in marketing.

## A — Rider acquisition/account/accessibility
- A01 P0 Splash, version compatibility, hard/soft update notices, maintenance mode.
- A02 P0 Email/phone route with country code +92 normalization; no enumeration; abuse protection.
- A03 P0 Verified phone onboarding with tested provider; OTP expiry, resend throttles, device controls.
- A04 P0 Terms, privacy, consent and permission notices with policy version/time.
- A05 P0 Profile, display name, contact edits with reverify, account recovery/lockout.
- A06 P0 Urdu/English and Roman Urdu-aware search; clear fallback text and RTL acceptance if actual Urdu script used.
- A07 P0 Foreground/background location rationale, revoke/regrant and approximate handling.
- A08 P1 VoiceOver/TalkBack, dynamic text, accessible contrast, large tap targets, screen readers.
- A09 P1 Saved Home/Work/Favorites and recent trip places with delete controls.
- A10 P1 Account deletion request, retention explanation, export request, anonymization where law permits.
- A11 P1 Device/session management, suspicious login notices, MFA for privileged roles.
- A12 P2 Trusted contacts, family booking with delegate approval, consent and visibility separation.
- A13 P2 Referrals, eligibility, reward expiration, self-referral prevention.
- A14 P2 Consent-based tailored discovery, opt-out marketing without loss of essential service.

## B — Rider booking/search/service classes
- B01 P0 Display map, correct geolocation, manual pin, GPS accuracy and landmark-oriented address.
- B02 P0 Pickup/drop autocomplete; coordinate-to-address reverse geocoding; fallback pin selection.
- B03 P0 Route visualization, distance/ETA with provider confidence/coverage indicator.
- B04 P0 Eligible car fare estimate and accurate category/seat/luggage info.
- B05 P0 Pickup notes, gate instructions, contact masking and meeting point.
- B06 P0 Fare components: base, distance, time, tax/fees, tolls, discount, final quote and expiry.
- B07 P0 Request submit with idempotency; one active ride constraint (exceptions approved explicitly).
- B08 P0 Searching screen, cancellable search, timeout, no-driver fallback, retry cooldown.
- B09 P0 Driver offer/accept result: verified driver/vehicle match and ETA before ride.
- B10 P0 Driver enroute/arrived, precise curbside pickup, rider PIN/start verification.
- B11 P0 Active route and trip safety sharing, responsive location with stale-data indicator.
- B12 P0 Destination changes consent/repricing if permitted; driver agreement; immutable price history.
- B13 P0 Driver/vehicle mismatch rejection, report safety concern and refuse boarding.
- B14 P0 Trip completion, receipt (tax/fees), feedback, lost item/support entry points.
- B15 P1 Bike and rickshaw classes with permit/helmet/seat limits and local legal validation.
- B16 P1 Alternate price modes: upfront fixed fare vs controlled mutual bidding per city/category.
- B17 P1 Bid counteroffers, expiry, fair bounds, accessibility without bidding pressure.
- B18 P1 Multi-stop with stop ordering, wait budgets, price recalculation and stop limits.
- B19 P1 Scheduled ride booking with dispatch timing/cancel policy and missed-booking recovery.
- B20 P2 Comfort and preapproved accessible vehicle options with honest equipment availability.
- B21 P2 Airport, intercity and hourly hire with distinct permits, pricing and terms.
- B22 P2 Trip-for-someone-else, approved delegation, primary contact and safety consent.
- B23 P2 Price history/notifications for recurring commute planning, no unfair personalized rates.
- B24 P2 Recurring bookings, commute calendar, corporate expense attribution.
- B25 P3 Subscription packages and commuting partnerships.

## C — Rider safety, communications and support
- C01 P0 Driver photo, license plate, make/color/category, verification status.
- C02 P0 Trip PIN/OTP before trip start; never bypass except human-reviewed incident policy.
- C03 P0 Trip sharing link with expiry, access token scope, revoke and minimum necessary location.
- C04 P0 SOS to local emergency service/contact where technically available; no false dispatch guarantees.
- C05 P0 In-app incident/report flow available even on cancelled/completed trips.
- C06 P0 Safety escalation queue, staffed manual response schedule, incident SLA and contact directory.
- C07 P0 Notifications for accepted/arrival/start/change/end, push delivery failure fallback.
- C08 P0 Masked communication or privacy-preserving in-app messages; no permanent exposure of phone number.
- C09 P0 Cancellation fees transparently explained with evidence/appeal and safety waivers.
- C10 P1 Lost and found workflow with limited contact time, anonymized routes, retention.
- C11 P1 Anomaly detection for unusual stop/detour, stale GPS and suspicious endings; avoid false police claims.
- C12 P1 Rider block-driver request, after-trip feedback and appeals; never publish unverified allegations.
- C13 P1 Multi-lingual help center, live/ticket support, queue and escalation.
- C14 P2 Trusted ride scheduling for dependents; minors and vulnerable-rider special policies approved first.
- C15 P2 Accessibility-specific pickup/boarding safety checks.

## D — Driver onboarding, marketplace and route execution
- D01 P0 Signup, verified phone, unique driver identity, duplicate/fraud detection.
- D02 P0 CNIC/license/registration/fitness/insurance/permit upload and secure review.
- D03 P0 Document expiry, manual reviewer decisions, photo/device consent, evidence audit.
- D04 P0 Driver & vehicle status: applicant/pending/approved/suspended/rejected; reason and appeal.
- D05 P0 Approved categories and capacity, service zones, safe online/offline toggle.
- D06 P0 Driver presence heartbeats, foreground/background location consent and stale threshold.
- D07 P0 Eligible request offer preview: distance to pickup, distance of trip, fare, vehicle mode, warnings.
- D08 P0 Offer TTL, acknowledge, accept/decline, assignment acknowledgement and deduplicated notifications.
- D09 P0 Enroute navigation handoff; background tracking and reconnection state recovery.
- D10 P0 Arrived-at-pickup with geofence/accuracy; rider verification code/start.
- D11 P0 Active trip route, stop events, completion conditions; tamper-resistant server calculations.
- D12 P0 Cancel/no-show reason, waiting policy, rider safety exception.
- D13 P0 Earnings statement, fee transparency, unpaid cash receivables and payout request status.
- D14 P0 Driver incident/SOS and refusal of unsafe ride; zero retaliation for legitimate concern.
- D15 P0 Account/device restrictions, anti-fraud risk review and appeal.
- D16 P1 Driver ride preference and accepted service areas; fairness constraints.
- D17 P1 Incentive quests, versioned conditions and fraud limits.
- D18 P1 Payout schedule, bank/EMI verified payee, payout failure/returns.
- D19 P1 Driver performance insights with dispute rights and non-coercive rest breaks.
- D20 P1 Training modules/checklist and city regulations refresh.
- D21 P2 Alternate vehicle registration, shifts/fleet ownership delegation.
- D22 P2 Pool driver capacity management/stop order, rider-level PIN validation.
- D23 P2 Courier COD rules, parcel proof/photo/weight and prohibited-goods handling.
- D24 P2 Offline queue UX, delayed uploads with authoritative server state.
- D25 P3 Driver subscriptions, EV/accessible fleet incentives, maintenance partners.

## E — Dispatch/pricing/geospatial and marketplace controls
- E01 P0 Geo-indexed eligible nearby drivers by vehicle, approved region and staleness.
- E02 P0 Atomic driver assignment, idempotent requests; no double-booking.
- E03 P0 Active request timeout/cancel/retry/re-offer, driver reassignment if authorized.
- E04 P0 Driver offer lease TTL and throttled broadcast/round-robin/fairness policy.
- E05 P0 Pricing versioning, exact quote snapshot, tax/fee split, protected rounding.
- E06 P0 Route provider abstraction: ETA, distance, geocode, map tiles, directions.
- E07 P0 Cache and cost protection; route degradation strategy without invented ETAs.
- E08 P0 Geographic availability zones, exclusions, airport pickup points, service hours.
- E09 P0 Fraud/rate limits for spam offers, unrealistic GPS, fake trips, price gaming.
- E10 P0 Driver location privacy/access scope and retention rules.
- E11 P1 Demand/supply map, utilization, acceptance/cancel/no-driver metrics.
- E12 P1 Dynamic/surge with caps and user-visible disclosures, local legal review.
- E13 P1 Negotiated bid floors and maximums; non-manipulative fair pricing.
- E14 P1 Multi-stop waypoint routing, tolls and expected/actual journey reconciliation.
- E15 P2 Capacity-aware pool matching with stop insertion and bounded detour.
- E16 P2 Duplicate overlapping pool trip prevention and per-seat escrow/payment authorization.
- E17 P2 Scheduled dispatch window and late/failed pickup response.
- E18 P2 Intercity shared route/driver permits and fixed departure constraints.
- E19 P3 Predictive hotspot recommendations with privacy/fairness tests and explicit cost budget.

## F — Pooling, women-focused, trust differentiation
- F01 P2 Solo ride remains available; rider chooses pool explicitly with transparent disclosure.
- F02 P2 Pickup/drop approximate-route matching; bounded walk distance and deviations.
- F03 P2 Compatible time windows, vehicle seat capacity, luggage/bike incompatibilities.
- F04 P2 Separate seat booking, per-passenger pricing, independent proof of ride start/end.
- F05 P2 Transparent estimated savings, final fare allocations and max price guarantee rules.
- F06 P2 Time-to-match cap, match decline and solo fallback without silent changes.
- F07 P2 Driver and passengers see necessary pickup names/ETAs; no other passenger address history.
- F08 P2 Rider safety preferences, women-only mode when verified supply and policy approved.
- F09 P2 Women driver eligibility proven by consent-based documented verification; no image/ID gender inference.
- F10 P2 Explicit women-only passenger eligibility policy, legal/privacy review, appeals; do not expose identity docs.
- F11 P2 Women ride/pool matching strictly separated by opted-in mode; no unexpected male rider additions.
- F12 P2 Mid-trip safety exit, safe cancellation/reallocation and refund responsibility.
- F13 P2 Emergency escalation per passenger, driver and whole pool.
- F14 P2 Incidents/blocking across pools; never automatically place involved parties together.
- F15 P2 University/office commute pools with employer/community verification, not public trip history.
- F16 P3 Repeat commute buddy preferences with bounded privacy and explicit mutual consent.
- F17 P3 Split-fare group booking for people already traveling together, distinct from stranger pooling.
- F18 P3 Accessible/pre-approved women driver training and comfort preferences.

## G — Payments, accounting and incentives
- G01 P0 Cash price display, collection responsibility, driver debt/credit policies.
- G02 P0 PSP abstraction, payment intents/status, webhook signature validation, idempotency.
- G03 P0 Ledger for booked/completed/cancelled/refunded ride obligations and adjustments.
- G04 P0 Currency PKR minor units integer, canonical rounding and quote version.
- G05 P0 Provider fee, platform commission, taxes, tolls, tip and driver payable separation.
- G06 P0 Double-entry postings, reversal-only corrections, no mutable balance as accounting truth.
- G07 P0 Daily reconciliation: provider payment, cash collection, payouts, internal ledgers; exceptions queue.
- G08 P0 Refunds with maker-checker for thresholds; chargeback evidence and reversals.
- G09 P0 Promotion budget reservations/expiration, referral fraud controls and accounting treatment.
- G10 P1 In-app digital payments only after PSP/merchant readiness and processor confirmation.
- G11 P1 Receipts/invoices, tax fields, downloadable statements and consumer dispute channel.
- G12 P1 Driver payout batching, bank/EMI payee validation, statuses and failure resolution.
- G13 P1 Corporate invoicing, monthly statements and payment terms.
- G14 P2 Split fare/group authorization, individual passenger adjustments and recoverable default.
- G15 P2 Coupon constraints, geographic/time caps, new-user anti-abuse.
- G16 P3 Loyalty points, stored value only if legal/regulated partner model explicitly approved.

## H — Admin, operations, partners, finance
- H01 P0 SSO/MFA for staff, role + attribute based access, least privilege and audited access.
- H02 P0 Driver KYC reviewer queue, expiration monitoring, suspensions, appeals and evidence access.
- H03 P0 Live trip map using minimum necessary location, bounded access and audit.
- H04 P0 Incident triage, severity, responders, escalation clock, evidence retention and case closure.
- H05 P0 Support cases, masked contact, refunds with maker-checker, linked ride context.
- H06 P0 Config versioning, rate cards, fee policies with approval and rollback.
- H07 P0 Finance ledger/reconciliation and failed payout views; no silent override.
- H08 P0 RBAC, privileged action confirmation, break-glass access and alert.
- H09 P0 Customer/driver suspension with recorded reasons, appeal and controlled reinstatement.
- H10 P1 Service zone/city management, categories and vehicle documents matrix.
- H11 P1 Operational KPIs, complaint backlog, matching efficiency, support SLA.
- H12 P1 Campaign setup with coupon caps and ROI reports.
- H13 P1 Fleet/partner portal, license compliance, linked drivers and settlement.
- H14 P1 Staff scheduling, on-call handover, issue queues and outage communications.
- H15 P1 Audit exports, financial closing/adjustment approval and dispute reports.
- H16 P2 Corporate account dashboard, role seats, ride restrictions and invoice approvals.
- H17 P2 Driver community/partner performance reports with fairness checks.
- H18 P2 Data access/deletion request handling, privacy flags and policy exports.
- H19 P3 City franchise partner models and white-label controls only after legal review.

## I — Infrastructure, security, observability, documentation
- I01 P0 Environments local/test/staging/production with separate data/key scopes.
- I02 P0 Seed synthetic data; no real user data in development.
- I03 P0 CI lint/types/unit/integration/e2e/secrets/SCA and migration dry-run.
- I04 P0 Config validation on boot; least-privilege DB and per-env provider keys.
- I05 P0 Redis used for ephemeral matching/caching, never financial truth.
- I06 P0 Outbox/retries/dead letters for event delivery, idempotent workers.
- I07 P0 Log/metrics/traces with PII redaction, service-health dashboards and alerting.
- I08 P0 Backups with restore proof, migration rollback plan, retention and offsite strategy.
- I09 P0 API schemas, threat model, quality gates, ADRs and incident runbooks.
- I10 P0 Monotonic ride state machine and authorized transitions; no trust in client timestamps.
- I11 P0 Cost alerts, quotas, provider circuit breakers and usage budgets.
- I12 P0 Mobile reconnect, app background GPS behavior and stale status UI.
- I13 P1 Abuse analytics, device risk scoring with explainability and appeals.
- I14 P1 Load/soak testing of dispatch, websocket fanout and DB geospatial queries.
- I15 P1 Separate read/projection/search paths where proven needed; documented rebuild.
- I16 P1 Dependency upgrades and deprecation/OS compatibility matrix.
- I17 P1 Mobile beta distribution, crash reporting and signing key policies.
- I18 P2 Data warehouse and event analytics with privacy-safe retention.
- I19 P2 Blue/green/canary deployments when platform and rollout permit.
- I20 P3 Multi-region failover only when justified, with tested consistency behavior.

## J — Corporate, public web, growth and company logistics
- J01 P1 Public landing, driver signup, FAQ, trust, legal, marketing and support.
- J02 P1 Business hours, customer service SLA and real emergency workflow.
- J03 P1 Driver recruitment and training, local field vetting and dispute procedures.
- J04 P1 App store legal entity, brand/IP/trademark screening, privacy disclosures and app listing.
- J05 P1 SECP, tax/NTN, local transport permits, insurance, PSP agreements and bank account.
- J06 P1 Growth dashboards, cohort retention, conversion, city-area cohort and churn.
- J07 P1 Community feedback/interviews, market experiments and operational cost tracking.
- J08 P1 Pricing/commission pilot with transparent drivers/riders terms and change notices.
- J09 P2 Schools/universities/corporates and verified managed pickup points with signed agreements.
- J10 P2 Referral/affiliate campaigns with regulatory/advertising and anti-spam standards.
- J11 P2 Delivery merchant SLA, parcel protection, COD/fraud rules.
- J12 P3 Partnership marketplace, insurance assistance, vehicle inspection network.

## K — Identity, authentication, KYC, face/selfie verification (explicit cross-cutting requirements)
- K01 P0 Rider, driver, staff and fleet account identities have explicit roles, phone ownership, lifecycle and safe linked-account rules.
- K02 P0 Driver CNIC front/back guided capture, quality checks, redacted extraction, consent and human-verifiable authenticity review.
- K03 P0 Driver guided live selfie with consented liveness, anti-replay/spoof/device-injection checks and non-biometric manual fallback.
- K04 P0 Secure ID-portrait-to-live-selfie comparison with limited access, calibrated uncertainty, human review, appeal and no gender inference.
- K05 P0 KYC application status, evidence-proven reviewer decisions, rejection reason, resubmission, expiry, audit and appeals.
- K06 P0 Driving license class/expiry, vehicle registration/ownership, plate, permits, fitness and insurance eligibility evidence verified by approved process.
- K07 P0 Deduplicate risky driver identities/documents/accounts by proportionate evidence, prevent abusive merges and offer human appeal.
- K08 P0 Phone OTP abuse controls: E.164 +92 normalization, TTL, one-time use, throttles, quotas, SIM-swap risk, outages and safe recovery.
- K09 P0 Secure server-issued session lifecycle: hashed/rotating refresh tokens, short access tokens, logout all, revocation and lost-device response.
- K10 P0 Staff strong MFA and sensitive-action step-up, recovery, least privilege, break-glass audit and separate production access.
- K11 P0 KYC document/biometric evidence isolation: encryption, anti-malware, scoped presigned URLs, retention/deletion, access logs and no secrets or raw IDs in telemetry.
- K12 P0 Revalidate driver and vehicle eligibility before going online, assignment and trip start; block expired, rejected, suspended or fraudulent cases.
- K13 P0 Adversarial auth/KYC security test suite covering replayed OTP/selfies, spoofed clients, IDOR, mass assignment, account takeover and false matches.
- K14 P0 Consent and applicant-facing explanations for sensitive identity capture, manual option, disputed decision and correction/erasure where lawful.
- K15 P1 Google OpenID Connect sign-in with provider token verification, verified-email handling and explicit phone-proof account linking.
- K16 P1 Apple sign-in for applicable iOS experience, relay email, unlink/revoke, app-store compliance and safe account linking.
- K17 P1 Multi-device and account recovery with phone re-verification, high-risk reauthentication, disabled-number change safeguards and fraud notifications.
- K18 P1 Risk-triggered periodic driver selfie rechecks, never while driving; manual alternative, accuracy/accessibility review and appeal.
- K19 P1 Localized onboarding UX: pending/failed/review/approved/rejected/expired/suspended states, camera guidance, offline resume and accessibility.
- K20 P1 Optional risk-based passenger identity escalation only when justified by law/policy, with data minimization and appeals; not default mandatory CNIC/selfie.
- K21 P1 Women-focused ride eligibility and preference verification uses consent, reviewed policy and qualified reviewer; never predicts gender from face, name or CNIC.
- K22 P1 KYC/OTP/identity vendor operational evaluation: Pakistan coverage, accuracy, pricing, rate limits, DPAs, failover, contracts and exit plan.
- K23 P1 Fleet-managed driver onboarding requires driver consent and direct identity confirmation; fleet cannot override central eligibility controls.
- K24 P2 Optional enhanced trust badge/verification for special passenger programs only after consent, legal review, accessibility and proven fraud value.

## Catalog completion checks
For every ID: product owner, spec link, UX flows, backend contract, DB model, permissions, feature flag, threat scenario, business dependency, acceptance test, launch-gate status. Unassigned means NOT READY; code passing tests alone is insufficient.


# v3 explicit A-to-Z additions (previously missing or only implicit)

## L — Rider experience, booking and inclusion
- L01 P0 Explicit two-way rider/driver rating lifecycle after each completed/cancelled ride where eligible, with tags, safety escalation, anti-retaliation, aggregation rules and appeal.
- L02 P1 Driver offer/profile card exposes only approved fields needed for choice: price, pickup ETA/distance, rating, completed-trip count, vehicle make/model/color/plate, verification status and service class.
- L03 P1 Negotiated-fare mode presents competing driver offers/counteroffers and lets rider deliberately choose among eligible drivers; sorting must not hide price/ETA/rating tradeoffs or manipulate choice.
- L04 P1 Rider can add passenger count, luggage/bulky-item, accessibility note, child-seat request, pet request and pickup instructions before matching; incompatible drivers/categories are filtered.
- L05 P2 Child-seat ride/category is shown only when an actually equipped, verified vehicle/driver is available and local child-restraint rules and liability are approved.
- L06 P2 Pet-friendly ride/category with declared pet type/size, driver opt-in, cleaning policy and safety restrictions.
- L07 P2 XL/group category with server-enforced legal seat capacity and luggage limits; no over-capacity booking.
- L08 P1 Low-data/Lite experience for weak networks and older Android devices: reduced map refresh, compressed assets, text-first status, resumable booking and explicit stale-data indicators.
- L09 P1 Browser/web ride booking for supported service areas with phone verification, accessible map/pin fallback, secure payment selection and trip-status handoff.
- L10 P1 Assisted phone/call-center booking for users without smartphones or with low digital literacy, with verified caller identity, recorded consent, agent audit and SMS/voice trip details.
- L11 P3 Partner-assisted IVR/USSD or feature-phone request flow evaluated only if telecom/provider contracts, UX and abuse controls make it viable.
- L12 P1 In-app notification inbox keeps booking, safety, payment, support and policy notices with read state, deep links, expiry and redaction.
- L13 P0 Critical transactional communications use a documented delivery hierarchy (in-app/realtime, push, SMS/voice/approved WhatsApp where configured) and never treat a failed notification as acknowledged.
- L14 P1 Universal/deep links open the exact safe ride/support/payment screen after authentication without leaking trip tokens or accepting untrusted state.
- L15 P1 Ride-again/rebook from history recreates a fresh quote/request rather than replaying old price, driver or stale location.
- L16 P1 Pickup experience supports landmark/gate/building/terminal notes, safe meeting points, pin adjustment and rider live-location-at-pickup only with explicit short-lived consent.
- L17 P2 Comfort preferences such as AC/quiet/assistance are declared as preferences unless a service class contractually guarantees them.
- L18 P2 Optional pickup-location photo/entrance reference has consent, malware scanning, expiry and no permanent location-history exposure.
- L19 P1 Accessibility profile/preferences cover screen-reader, mobility, hearing/communication and boarding assistance without falsely claiming accessible vehicles that are unavailable.
- L20 P2 Family/delegate profile supports booking for another consenting adult, relationship/permission boundaries, trusted-contact visibility and separate trip receipts.
- L21 P3 Teen/minor program is disabled until guardian controls, age verification, safeguarding, insurance and local legal policy are approved.
- L22 P2 Optional per-ride insurance/takaful offer through a licensed partner clearly states coverage, exclusions, premium, beneficiary and claim path; never implied by default.
- L23 P2 Airport ride mode models terminal/zone pickup rules, meeting points, waiting, parking/airport fees, flight reference if used, and geofenced queue rules.
- L24 P1 Scheduled-ride reminders, driver assignment timing, ready-to-leave notices and missed pickup recovery are explicit and resilient to push failure.
- L25 P1 Payment method, promo and service-class availability are shown before confirmation and revalidated server-side at request creation.
- L26 P1 Rider can add/edit destination or stops only through server-authorized transitions with repricing disclosure and driver consent where policy requires.
- L27 P1 Rider profile may show a minimal trust/verification badge to drivers only if policy-approved; full CNIC, DOB, address or sensitive identity evidence is never exposed.
- L28 P2 Optional risk-triggered passenger liveness/identity check is separately consented, appealable and privacy-reviewed; it is not a universal passenger requirement.

## M — Driver marketplace, earnings and welfare
- M01 P0 Driver can rate/report rider after eligible trips; severe feedback enters trust/safety review, normal ratings are abuse-resistant and appeals exist.
- M02 P1 Driver offer screen may show rider first name, rating/trust status, pickup area, trip route/fare/category and approved notes, but not unnecessary phone/address history or identity documents.
- M03 P1 Destination-mode filter lets drivers set a bounded destination/time window without guaranteeing trips or unfairly starving other requests.
- M04 P2 Optional rider-rating threshold preference is evaluated for marketplace fairness and discrimination risk before enabling.
- M05 P1 Verified women drivers can opt into women-rider preference where lawful, with explicit opt-out, no gender inference and safe fallback when supply is unavailable.
- M06 P1 Back-to-back/next-ride queue can offer an eligible next trip near current destination without distracting the driver or double-booking.
- M07 P2 Airport/terminal driver queue uses geofence, eligibility, FIFO/priority policy, anti-spoofing and transparent queue position where the airport permits it.
- M08 P1 Demand heatmap/hotspot guidance is advisory, freshness-labelled and does not fabricate guaranteed earnings or demand.
- M09 P0 Pickup waiting timer has server time, free-wait allowance, rider notification, no-show eligibility, safety exception and fee policy.
- M10 P0 Cash trip completion records amount due, amount driver declares received, short/overpayment dispute path and no silent ledger mutation.
- M11 P1 Driver platform account shows commission receivable/payable, cash debt/credit and settlement history without representing an unlicensed stored-value wallet.
- M12 P1 Driver can settle platform dues/top-ups only through approved merchant/payment rails with reconciled reference IDs and failure recovery.
- M13 P1 Instant/same-day payout is offered only through a contracted provider with fee disclosure, cutoffs, payee verification, failure/return handling and fallback schedule.
- M14 P1 Daily/weekly/monthly earnings views reconcile completed fares, cash, platform fee, incentives, tips, taxes/withholding, adjustments and payouts.
- M15 P1 Driver incentive/quest tracker shows versioned eligibility, progress, exclusions, payout timing and dispute channel; no hidden retroactive changes.
- M16 P1 Approved driver can switch among verified vehicles without bypassing category, insurance, permit, fitness or ownership checks.
- M17 P0 Driver receives staged document/permit/insurance/fitness/token-tax expiry reminders before go-online blocking dates.
- M18 P1 Vehicle inspection/reinspection workflow stores approved inspector/source, date, defects, re-test and evidence without accepting self-attestation as official proof.
- M19 P1 Driving-hour/fatigue controls track eligible active/online driving time, send rest reminders and enforce legal/platform caps where approved.
- M20 P2 Speed-limit/driving-behavior insights are advisory unless a validated safety policy exists; disputed GPS/map data cannot automatically punish a driver.
- M21 P0 Driver Safety Center provides SOS, trip sharing, incident report, masked communication and current emergency information without requiring navigation away from the active trip.
- M22 P2 Optional auto-accept operates only within driver-selected categories/areas/price constraints and can be disabled instantly; it cannot accept while ineligible/offline.
- M23 P1 Navigation can use approved in-app or external provider handoff while preserving authoritative trip state and preventing destination/token leakage.
- M24 P1 Driver support surfaces digital help plus partner/field center location, hours and appointment/ticket linkage where centers exist.
- M25 P2 Registered dashcam capability stores device/coverage metadata and notifies riders before trip where recording is lawful; footage handling is separate from routine telemetry.

## N — Safety, trust and incident response
- N01 P0 Safety Center/Toolkit is a first-class passenger and driver surface before/during/after rides, grouping emergency, trusted contacts, share trip, report, support and safety settings.
- N02 P0 Community Guidelines/code of conduct cover harassment, discrimination, violence, sexual misconduct, drugs/weapons, smoking, fraud, property damage, unsafe driving and account sharing with proportionate enforcement.
- N03 P0 Blocking/no-rematch rules prevent future matching after approved safety block or severe rating/report while preserving appeals and avoiding disclosure of complainant details.
- N04 P0 Trip anomaly detection evaluates unexpected long stop, major route deviation, implausible teleport/speed and suspicious premature completion and triggers a non-alarmist check-in/escalation.
- N05 P1 Crash/sudden-impact detection may combine device/location signals but must expose uncertainty, avoid false emergency-dispatch claims and provide manual confirmation/escalation.
- N06 P1 Discreet in-trip safety report can be filed without alerting the other party and is queued for post-trip or urgent handling based on severity.
- N07 P2 Encrypted in-app audio recording is disabled until legal/privacy review; if enabled it has clear consent/notice policy, local protection, scoped upload/access, expiry and evidence handling.
- N08 P2 Driver dashcam/audio-video recording has registration/notice, retention/access rules and jurisdiction review; riders are not secretly recorded by platform design.
- N09 P0 Seat-belt and correct-vehicle reminders appear at appropriate trip stages without blocking genuine emergency use.
- N10 P0 Emergency screen exposes current coordinates, driver/rider identity fields allowed by policy, vehicle plate/model and trip ID for user relay to Punjab Police 15/Rescue 1122 or other locality-specific services.
- N11 P0 SOS accidental-trigger/cancel and unreachable-user procedures are defined; safety staff see event timestamps and failed-contact attempts.
- N12 P0 Incident cases accept controlled photo/video/audio/document evidence with malware scanning, metadata minimization, retention and access audit.
- N13 P0 Safety evidence has chain-of-custody/audit events, legal hold capability and immutable decision history appropriate to investigations and disputes.
- N14 P0 Law-enforcement/regulator requests follow a documented lawful-request workflow, authorization review, minimum disclosure, logging and emergency exception policy; no informal employee disclosure.
- N15 P1 Insurance/takaful claim intake links trip, people, vehicle, policy/coverage, incident evidence, provider case ID, status and appeal/contact without platform pretending to be insurer.
- N16 P0 Before start, both parties can flag rider/driver/vehicle identity mismatch and terminate safely without unjust cancellation penalty.
- N17 P1 Periodic vehicle photo/plate condition recheck can be risk- or schedule-triggered and routes uncertainty to review; it does not replace official fitness inspection.
- N18 P0 Location-integrity controls detect mocked GPS, impossible movement, emulator/device tampering and stale positions as risk signals with human appeal; no single signal auto-bans.
- N19 P0 Post-trip privacy redacts exact rider pickup/drop history from driver views except minimum information needed for current disputes, safety or legal obligations.
- N20 P1 Contextual safety check-ins for unusually long/night/high-anomaly rides use transparent rules and can be dismissed; they are not covert behavioral surveillance.
- N21 P0 Public-launch safety support coverage, escalation roster and response SLAs are published internally and staffed; pilot hours cannot be marketed as 24/7 unless actually staffed.
- N22 P1 Minor/child policy defines who may ride, guardian responsibility, child-seat requirements and escalation for apparent unaccompanied minors.
- N23 P1 Pet policy defines allowed animals/carriers, service-animal/accessibility treatment where applicable, allergies, cleaning and refusal rules.
- N24 P0 Harassment/discrimination/sexual-misconduct reports have specialist severity rules, survivor-sensitive contact preferences, evidence minimization and anti-retaliation/no-rematch controls.
- N25 P0 Unsafe-trip early termination supports safe stop, emergency escalation, fare/refund review, evidence and re-matching only when appropriate.
- N26 P1 Pooling supports per-co-rider block/no-rematch and safety case linkage without revealing one rider’s identity/history to unrelated co-riders.
- N27 P1 Safety transparency metrics define what can be published without exposing victims, gaming detection or making unsupported safety-superiority claims.
- N28 P1 Driver background/security screening is performed only through lawful authorized sources/providers with re-screen policy, adverse-action notice and appeal where required.
- N29 P1 Roadside breakdown flow protects riders/driver, marks trip state, rebooks/refunds as policy allows and links towing/assistance only through approved partners.
- N30 P1 Lost-property workflow prevents direct address disclosure, limits communication windows, records custody/return and supports safety escalation for sensitive items.

## O — Pakistan payments and financial edge cases
- O01 P0 Cash remains an explicit payment method with city/category eligibility, exact fare display, change guidance, driver collection responsibility and cash-fraud monitoring.
- O02 P1 Card payments use a PCI-scoped PSP/hosted/tokenized flow; platform never stores raw PAN/CVV and verifies signed provider callbacks.
- O03 P1 Provider-supported card authentication/tokenization such as 3-D Secure is handled through PSP contracts and tested for retries, abandonment and duplicate callbacks.
- O04 P1 JazzCash merchant/wallet payment integration is a provider ADR with sandbox proof, merchant onboarding, signed callbacks, refunds and reconciliation before launch.
- O05 P1 Easypaisa merchant/wallet payment integration is a provider ADR with merchant onboarding, callbacks, refunds and reconciliation before launch.
- O06 P1 Raast P2M payment option is implemented only through an SBP-regulated bank/EMI/PSP/MSP, supporting the selected QR/RTP/alias/IBAN flow, confirmation, refund and reconciliation.
- O07 P2 Additional regulated Pakistan wallets/banks can be plugged through the PSP abstraction without custom ride-state logic or unlicensed custody.
- O08 P1 Saved payment methods are provider tokens with clear brand/last4/expiry display, default selection, removal and lost-device revocation.
- O09 P1 Preauthorization/authorization/capture/void behavior is defined per payment method and trip lifecycle; retries are idempotent and never double-charge.
- O10 P1 Failed/insufficient digital payment creates a controlled outstanding balance/retry/support flow; it never silently converts to cash after trip without disclosed policy.
- O11 P1 Refunds return through original rail where possible, track pending/completed/failed statuses and have a documented cash-trip refund resolution.
- O12 P1 Driver tips are optional, clearly separated in ledger/receipt/driver earnings and cannot alter ratings or service eligibility.
- O13 P1 Waiting fee has free grace, server timer, cap, notification, evidence and appeal; safety-caused delays can be waived.
- O14 P1 Toll, parking and airport/terminal charges are categorized, disclosed/reconciled and cannot be arbitrary free-text driver additions.
- O15 P1 Cleaning/damage fee claims require timely evidence, policy caps, rider notice and appeal/maker-checker approval; no automatic card charge without valid authorization/policy.
- O16 P1 Cancellation/no-show fees have actor/reason/timing rules, transparent estimate, waiver cases, payment capture and appeal.
- O17 P1 Cash overpayment/shortpayment/change disputes create financial adjustments through ledger reversals/entries, not manual balance edits.
- O18 P1 Driver platform-dues payment/top-up has provider reference, idempotency, reconciliation and account restoration rules.
- O19 P1 Payout payee change/new bank or wallet requires step-up verification, cooling/risk control and audit before funds can be sent.
- O20 P1 Tax/withholding/GST or other statutory fields are configuration-driven per legal advice and reflected on statements/invoices without inventing tax treatment.
- O21 P1 Payment method availability can vary by city/category/rider risk and is server-authoritative; UI never offers an unavailable rail.
- O22 P1 Chargeback/payment dispute workflow freezes only necessary amounts, preserves evidence and posts reversals/fees through ledger.
- O23 P2 Voucher/gift credit is promotional liability, not withdrawable stored value, unless a licensed partner structure explicitly permits otherwise.
- O24 P1 Digital-payment provider outage has a disclosed fallback/retry plan; switching to cash requires policy and both parties’ awareness rather than silent server behavior.

## P — Communications, support content and growth
- P01 P0 In-app rider/driver chat is trip-scoped, rate-limited, retained per policy, abuse-reportable and blocks attachments/links unless explicitly secured.
- P02 P0 Masked call relay hides personal numbers where provider coverage exists and has honest outage/fallback behavior; raw phone number is not exposed by default.
- P03 P1 Approved WhatsApp Business transactional/authentication templates may be used only via contracted provider and user-consent/Meta rules, with SMS/voice fallback for critical flows.
- P04 P1 Email channel sends receipts, support updates and policy/account notices with verified domains, unsubscribe separation for marketing and no sensitive trip detail in subject lines.
- P05 P1 SMS channel covers OTP and selected critical trip/support fallbacks with templates, language choice, sender registration/cost limits and anti-spam controls.
- P06 P1 Communication preference center separates mandatory service/safety/account notices from optional marketing by channel and language.
- P07 P1 Omnichannel support chat/ticket links authenticated customer, trip, payment and incident context without agents asking users to resend CNIC/payment secrets.
- P08 P1 Help-center/CMS supports versioned Urdu/English content, searchable categories, city-specific policies, emergency separation and approval workflow.
- P09 P1 Support knowledge base gives agents approved scripts/runbooks, decision trees, refund limits, escalation and change history.
- P10 P1 Lifecycle CRM segmentation uses consented/non-sensitive attributes, frequency caps and suppression after complaints/opt-out.
- P11 P1 Referral codes/invites have attribution, eligibility, budget, fraud detection, reward status and terms; self-referral/device farms are blocked.
- P12 P1 Promo/voucher engine supports city/category/user/time caps, budget reservation, stackability rules, expiry and ledger treatment.
- P13 P1 Install/deep-link attribution is privacy-aware and cannot let third-party SDKs ingest raw trip/CNIC/location history beyond approved purpose.
- P14 P1 Lifecycle campaigns for onboarding, first ride, churn and driver activation are feature-flagged, measured and suppressible; safety/payment messages are never marketing experiments.
- P15 P2 A/B experimentation platform uses assignment IDs, guardrail metrics, exposure logging and excluded safety/identity/financial invariants.
- P16 P0 Remote config/kill switch can disable risky categories/providers/features per app version/city without changing historical trip/financial truth.
- P17 P0 Outage/status communications provide in-app banner and support script; status claims come from monitored systems, not manual optimism.
- P18 P1 Localized content management handles English, Urdu script and Roman Urdu copy with reviewed terminology and no machine-translation-only safety/legal text.
- P19 P1 Post-trip satisfaction/NPS or surveys are separate from mandatory safety reports and cannot hide support access after a poor rating.
- P20 P2 Corporate/partner bulk vouchers and campaign budgets have authorized issuer, spend controls, recipient eligibility and reporting.

## Q — Security, SRE, mobile quality and release governance
- Q01 P0 Mobile auth/session secrets are stored only in OS secure storage/keychain/keystore; no tokens, CNIC or payment secrets in AsyncStorage/plain preferences/logs.
- Q02 P0 Android Play Integrity and Apple App Attest/DeviceCheck or equivalent are evaluated as risk signals for abuse-sensitive actions; unsupported devices have controlled fallback.
- Q03 P0 Root/jailbreak/emulator/debugger/tampering detection contributes to risk scoring but is not the sole permanent-ban or accessibility decision.
- Q04 P0 TLS, secure cookies/headers where applicable and modern transport settings are mandatory; certificate pinning requires an ADR for rotation/outage/recovery before use.
- Q05 P0 Internet-facing services have DDoS/WAF/bot/rate-limit controls at edge/API plus application-level per-user/device/IP/business-key limits.
- Q06 P0 Credential stuffing, OTP bombing, enumeration, scraping and automated fare/driver abuse have dedicated detection/limits and incident playbooks.
- Q07 P0 Secrets are held in managed secret storage or protected CI variables with owner, rotation, environment scope and leak-revocation runbook.
- Q08 P0 Encryption at rest/in transit and key-management responsibilities are documented for databases, backups, object storage, KYC evidence and analytics exports.
- Q09 P0 CI performs SAST, dependency/SCA, secret, container/image and IaC scans with severity policy and documented exception expiry.
- Q10 P0 Build pipeline emits dependency lockfiles/SBOM and signed/provenance-aware release artifacts sufficient to trace production binaries to reviewed source SHA.
- Q11 P0 Protected default branch requires CI/review policy, disallows casual force-push/history rewrite and records release tags/SHAs.
- Q12 P0 Android/iOS signing keys, app-store credentials and production provider secrets have least-privilege custody, backup/recovery and offboarding procedures.
- Q13 P0 Mobile releases use staged/percentage rollout, minimum-compatible API version, remote kill switches and rollback/stop procedures.
- Q14 P0 Backend deployments use health gates, backward-compatible rollout, drain/rollback and active-trip protection; deploy cannot strand rides midway.
- Q15 P0 DB/schema/API/event changes preserve N-1 mobile compatibility during rollout and use expand/migrate/contract or equivalent safe migration pattern.
- Q16 P0 Production infrastructure is defined reproducibly as code/config with environment review; one-off console changes are detected/documented.
- Q17 P0 Core user journeys have explicit SLIs/SLOs: auth/OTP, quote, match, driver location freshness, trip transition, payment ledger, support/safety ingestion and admin availability.
- Q18 P0 Synthetic monitoring continuously tests safe non-monetary or sandbox paths plus health/dependency probes from relevant geography.
- Q19 P0 Incident management defines severity, incident commander, on-call contacts, comms, containment, evidence, postmortem and follow-up ownership.
- Q20 P0 RPO/RTO targets exist for ride state, financial ledger, KYC evidence, support/safety data and analytics, with restore/DR exercises proving claims.
- Q21 P0 Encrypted backups are periodically restored into isolated environments and checked for application usability, not merely backup-job success.
- Q22 P1 Public/internal status page communicates material outages without leaking security-sensitive internals and links to incident communication process.
- Q23 P0 Servers, workers, DB and queue infrastructure use reliable time synchronization; financial/lease/OTP decisions never trust client device clock.
- Q24 P0 Data retention/archival schedule is implemented by category: precise location, messages, KYC/biometrics, payments, safety evidence, logs, analytics, support and legal holds.
- Q25 P1 High-volume driver/location history has partitioning/downsampling/TTL strategy; canonical trip evidence is separated from raw telemetry.
- Q26 P1 Performance budgets include mobile cold/warm start, map interaction, data usage, battery, API p95/p99, realtime reconnect and dispatch assignment latency.
- Q27 P1 Representative low-end Android devices and constrained memory/storage/network are first-class QA targets, not only flagship emulator testing.
- Q28 P1 Background location/push/battery behavior is tested across OEM battery savers, app kill, reboot, permission downgrade and network switching.
- Q29 P1 Accessibility regression tests cover screen reader, font scaling, contrast, focus order, motion reduction and critical safety/payment flows.
- Q30 P1 Localization regression covers Urdu RTL, Roman Urdu search/copy, truncation, numerals, PKR formatting, dates/times and mixed-direction map/address text.
- Q31 P1 Supported OS/app-version matrix and deprecation policy define minimum Android/iOS, forced/soft upgrade, backend compatibility and security exception handling.
- Q32 P1 Real-device release matrix includes passenger and driver scenarios, background GPS, camera/KYC, low signal, calls/messages, payment redirects and deep links.
- Q33 P1 Fault-injection/chaos tests cover map, SMS, push, Redis, DB replica/connection, PSP, object storage and realtime failures without corrupting trip or ledger truth.
- Q34 P1 Capacity model defines expected riders, drivers, location updates/sec, concurrent sockets, quote/match QPS, storage growth and cost before each rollout tier.
- Q35 P1 FinOps dashboard tracks cost per active rider/driver/trip by maps, messaging, compute, DB, storage, observability, KYC and payment provider with alerts.
- Q36 P0 Telemetry has default deny/redaction for CNIC, selfie/biometric, access tokens, card data, OTPs, full phone, precise long-term location and support attachments.
- Q37 P1 Analytics uses pseudonymous IDs/minimized fields and consent/retention policies; production raw tables are not copied to developer laptops.
- Q38 P1 Data warehouse/BI ingestion is downstream, replayable and access-controlled; it cannot become transaction truth or bypass deletion/retention requirements.
- Q39 P0 Privileged audit logs are append-only/tamper-evident enough to identify actor, action, object, before/after or reason, timestamp and request trace.
- Q40 P1 Coordinated vulnerability disclosure/security contact and intake SLA exist before public launch; a bug bounty is optional later after triage capacity exists.
- Q41 P0 Company domains and transactional email use SPF/DKIM/DMARC, controlled DNS/registrar access, TLS and anti-phishing monitoring/recovery.
- Q42 P0 Production admin access uses SSO/MFA, least privilege, device/network controls where feasible, short sessions, step-up for high-risk actions and offboarding tests.
- Q43 P0 Third-party/vendor risk register records data shared, credentials, region, SLA, sub-processors, pricing limits, incident contact, contract/DPA and exit/migration plan.
- Q44 P0 Data-location/cross-border inventory documents where rider/driver/KYC/payment/safety data is processed and flags legal/contract review before provider adoption.
- Q45 P0 Biometric/KYC privacy impact assessment is a launch gate covering necessity, alternatives, bias/error, retention, vendor access, breach response and appeals.
- Q46 P0 Privacy Center exposes policy versions, permissions, marketing choices, linked devices/providers, data requests and understandable location/identity explanations.
- Q47 P0 Data access/export/correction/deletion requests have identity verification, exclusions/legal holds, downstream propagation, deadlines and audited completion.
- Q48 P0 Every phase report includes exact branch/SHA/worktree status, commands/tests, CI links/status, migrations, screenshots/device evidence where relevant, known failures, costs and untested items.

## R — Operations, regulation, verticals and engineering rules
- R01 P0 Punjab TNC operating-license requirement and application/renewal evidence are explicit external launch blockers; the product cannot self-declare legal authorization.
- R02 P0 Per-driver/vehicle route-permit status, district/platform scope, issue/expiry and evidence are modelled and revalidated according to current Punjab rules before accepting rides.
- R03 P0 Vehicle fitness certificate status, inspection source/date/expiry and failures are modelled; expired/failed vehicles cannot go online.
- R04 P0 Third-party/passenger insurance evidence and required coverage status are modelled by vehicle/service/city; claims contact is linked to incidents.
- R05 P0 Vehicle token-tax/registration ownership or authorized-use evidence is captured where required by permit/onboarding rules and rechecked at renewal.
- R06 P0 Driver licence category/endorsement, medical/training/background requirements are configurable by current regulation and cannot be bypassed by fleet/admin.
- R07 P0 Regulator data-access/export capability is built only to the exact legally required fields/process, with authorization, audit, minimization and no permanently open backdoor.
- R08 P0 Corporate legal entity, SECP/tax/NTN/bank/merchant onboarding dependencies are tracked as launch checklist items with owner/evidence/expiry.
- R09 P0 Separate current passenger Terms, driver/partner agreement, privacy notice, biometric/KYC notice and Community Guidelines have versioned acceptance and policy-change communication.
- R10 P1 Fleet/vehicle-owner agreement, corporate-customer terms, courier/freight terms and pooling/women-service terms are separate when those verticals activate.
- R11 P0 Cancellation/refund/no-show/waiting/damage/lost-property policies are publishable, city/version aware and match actual backend calculations.
- R12 P0 Transport, privacy/biometric, payments, consumer, tax, insurance and worker/contractor legal review is a real-human launch gate; Claude output is not legal clearance.
- R13 P0 Launch runbook defines pilot geofence, hours, eligible vehicles, driver count, support/safety staffing, payment modes, rollback/stop criteria and emergency contacts.
- R14 P0 Driver supply launch plan covers sourcing, identity/document vetting, training, vehicle checks, activation, support center and no-show/quality remediation before consumer marketing.
- R15 P0 Passenger support launch plan covers authenticated help, phone/in-app channels, safety escalation, lost items, refunds, payment issues, queue monitoring and staffing capacity.
- R16 P1 Support QA audits sampled cases for policy accuracy, privacy, tone, escalation and unauthorized refunds/data disclosure with coaching and correction.
- R17 P1 Operations staffing forecast is tied to active rides/drivers, incidents, KYC backlog and support contacts rather than assuming software replaces people.
- R18 P1 Manual booking/agent console can create, modify or cancel rides only after caller verification and with actor/reason audit; agents cannot override driver compliance or money invariants.
- R19 P0 Manual operational intervention in live trip/assignment is extremely limited, permissioned, reason-coded and cannot silently rewrite completed financial or safety history.
- R20 P1 Driver field/support center operations track appointments, identity, document resubmission, training and complaint tickets without local spreadsheets becoming source of truth.
- R21 P1 Marketing/brand launch covers trademark/name/domain/social-handle checks, original visual system, app-store creative, review-response process and crisis communication.
- R22 P1 App-store operations cover legal entity, privacy labels/data safety forms, background-location justification, account deletion, reviewer demo accounts and staged release notes.
- R23 P1 Marketplace health scorecard includes request-to-match, pickup ETA, completion, rider/driver cancellation, no-driver rate, driver utilization, earnings/hour, retention and geographic supply gaps.
- R24 P1 Safety scorecard includes incident rate/severity, SOS/check-in outcomes, mismatch, spoof/fraud, support response and repeat-offender controls without incentivizing under-reporting.
- R25 P1 Financial scorecard includes gross bookings, net revenue, driver payable, promo burn, payment success, refund/chargeback, cash receivable, payout/reconciliation breaks and unit economics.
- R26 P1 Customer experience scorecard includes rating distribution, complaints, support resolution, accessibility/low-data failures and cohort retention; metrics are segmented without discriminatory pricing.
- R27 P1 City expansion uses a repeatable regulatory/supply/operations/map/payment/safety readiness checklist; Lahore approval never automatically authorizes another city/province.
- R28 P2 Service catalogue explicitly models Economy, Comfort, Bike, Rickshaw and later XL/Pet/Kids/accessible variants as separate eligibility/pricing/safety configurations rather than UI labels only.
- R29 P2 Delivery/courier models sender/recipient verification, item description/size/photo, prohibited goods, pickup/delivery OTP or proof, failed delivery, return, insurance and disputes.
- R30 P2 COD delivery is disabled until cash custody, merchant/recipient fraud, proof, remittance, limits and legal/accounting model are approved.
- R31 P2 Cargo/freight models vehicle/body/load constraints, loaders if offered, quote/negotiation, commercial permits, proof and damage/dispute workflow separately from passenger rides.
- R32 P2 Intercity models route/permit/insurance, scheduled or negotiated departure, luggage, stops, driver fatigue, passenger guarantee where required and breakdown/emergency handling.
- R33 P2 Corporate/business portal supports organization verification, admins, users/guests, ride policy, cost centers, scheduled rides, approval, monthly invoice, tax/reporting and support.
- R34 P2 Fleet/vehicle-owner portal supports owner/KYB, drivers, vehicles, assignments, compliance, earnings/settlement, permissions and cannot activate noncompliant supply.
- R35 P2 Women-focused and pooled services remain independent feature flags with dedicated supply thresholds, consent, eligibility, safety, finance and rollback gates rather than marketing-only modes.
- R36 P2 University/office commute pools support verified community, recurring schedules, seat reservation, bounded stops/detours, no public member directory and institution escalation contacts.
- R37 P2 Family Safety Hub can let a consenting rider share selected trip status/history with trusted family/guardian without exposing unrelated trips or permanently sharing precise location.
- R38 P3 Food/grocery/merchant marketplace is a separate future business with merchant catalog/order/refund/food-safety operations and is not smuggled into ride V1.
- R39 P1 Founder/company decision register assigns every plausible feature one status: NOW, LATER, OUT-OF-SCOPE or EXTERNAL-DECISION; nothing remains merely implied in prose.
- R40 P0 Canonical documentation rule: one authoritative PRD/requirements register/phase plan/ADR set; superseded docs are clearly archived, not allowed to conflict silently.
- R41 P0 Repository safety rule: inspect branch/HEAD/worktree/remotes/CI/identity before change; no unauthorized force-push/amend/history rewrite and no AI co-author trailers.
- R42 P0 Docker/data safety rule: never prune unknown volumes or factory-reset/delete persistent state without explicit authorization and verified backup/ownership.
- R43 P0 Claude-only engineering rule: Claude plans/implements/self-audits; ChatGPT reviews reports and actual GitHub evidence when available; sensitive public-launch assurance still requires qualified humans.
- R44 P0 Phase gate rule: accepted green work is not reopened or refactored without regression/evidence; next phase starts only from current repo truth and current canonical docs.
- R45 P0 No real CNIC/selfie/payment secrets/API keys/auth-session files are put in prompts, issues, demo fixtures, commits or copied between machines; use synthetic licensed test data.



# v4 — Founder-prompt second-pass additions

## S — Remaining mobility/product edge cases
- S01 P1 Driver acceptance and post-accept cancellation metrics are calculated transparently with excluded uncontrollable cases, appeal context and no coercive punishment for declining unsafe or unsuitable requests.
- S02 P1 Driver inbox/activity center consolidates document-expiry, trip/support, policy, payout, incentive and safety messages with read state, deep links and retention.
- S03 P2 Round-trip/return booking creates explicit outbound and return legs or a clearly defined waiting/return contract with separate pricing, timing, cancellation and driver-consent rules.
- S04 P2 Rider can separate personal and business ride profiles with distinct payment methods, work email/receipt routing, cost center or memo fields and privacy boundaries.
- S05 P2 Corporate/authorized guest ride can serve a rider without the consumer app using verified phone/SMS or secure web trip status, while preserving consent, safety access and support.
- S06 P2 Delegate/assistant booking supports role-scoped trip management and three-way rider/driver/delegate communication without exposing unrelated account data.
- S07 P2 Corporate/partner ride API and webhooks, if offered, use scoped credentials, idempotency, quotas, signed callbacks, audit and the same compliance/dispatch/ledger invariants as first-party apps.
- S08 P2 Business expense export/integration supports approved CSV/API/provider workflows, receipt reconciliation and employee privacy without making external expense systems transaction truth.
- S09 P2 Multi-drop courier batching models ordered stops, capacity, per-parcel custody/proof, route changes, partial failure, returns and driver workload rather than treating a batch as one parcel.
- S10 P1 Support/booking call recording or transcription, if used, requires notice/consent or other lawful basis, access controls, retention, redaction and explicit exclusion from unrelated model training.
- S11 P0 Push notification device-token lifecycle handles rotation, reinstall, logout, invalid tokens, multi-device targeting and permission-disabled states without leaking another user’s ride notifications.
- S12 P0 Recycled/reassigned phone-number risk has account-recovery and takeover protections so a new SIM owner cannot silently inherit a previous rider/driver account or sensitive trip history.
- S13 P0 Phone/Google/Apple account-link collisions and duplicate-account merge requests use step-up proof, conflict-safe rules, immutable audit and manual recovery instead of auto-merging identities.
- S14 P1 Trusted-contact selection minimizes contacts access by manual entry or platform contact picker where feasible; broad address-book upload is not required for core safety sharing.
- S15 P2 App-store rating/review prompts occur only after appropriate non-safety user moments, respect platform rules/frequency limits and never block support or manipulate ratings.
- S16 P3 Driver vehicle-display integrations such as Android Auto/CarPlay are evaluated only after core driver safety UX is stable, with limited distraction and no trip-state divergence.
- S17 P3 Driver road-hazard/map issue reporting, if introduced, is moderation/quality controlled and cannot become authoritative routing or safety truth without provider validation.
- S18 P3 Optional preferred/favorite-driver repeat matching is privacy- and fairness-reviewed, mutual/consent-based, non-exclusive and cannot bypass driver availability, eligibility or safety blocks.
- S19 P3 Optional priority-pickup product, if introduced, has transparent fee/eligibility and dispatch fairness rules and never promises a guaranteed pickup time without operational evidence.
- S20 P2 Flexible-pickup or wait-and-save product, if introduced, clearly trades pickup time for price, preserves accessibility/safety and never silently downgrades an immediate booking.
- S21 P1 Navigation route preferences such as avoid tolls/highways or accessibility constraints are provider-validated, disclosed to both parties where relevant and repriced consistently.
- S22 P1 Driver can select among approved navigation providers or in-app navigation without exposing private trip tokens/contacts or changing server-authoritative route/trip state.
- S23 P2 Airport/scheduled transfer can optionally store airline/flight/terminal metadata and provider-derived delay updates with freshness labels; flight data never silently changes a paid booking without policy.
- S24 P1 No-driver recovery offers only truthful alternatives such as retry, different eligible category, later schedule or approved nearby pickup; it never fabricates supply or auto-books a materially different service.
- S25 P1 Notification-category and OS-permission UX distinguishes mandatory in-app safety/service state from optional push/marketing, explains disabled notifications and provides safe fallback for critical events.

## T — Startup/company governance and operating controls
- T01 P1 Founder/company IP chain-of-title is documented: code, designs, domains, trademarks, contractor work and third-party assets are owned or licensed by the correct legal entity before fundraising/public launch.
- T02 P1 Company maintains an accurate cap table/share register, founder ownership and authorized issuance records; product repositories and commercial accounts are not substitutes for legal ownership records.
- T03 P2 If cofounders or new equity holders are added, founder/cofounder vesting, roles, reserved matters, leaver/deadlock and IP/confidentiality terms are documented by qualified counsel.
- T04 P1 Employees/contractors/consultants handling code, support, KYC or operations sign appropriate confidentiality, IP, acceptable-use, privacy/security and role agreements before access.
- T05 P0 Personnel joiner/mover/leaver process provisions least-privilege access, MFA, training and rapid offboarding across GitHub, cloud, stores, support, finance, social and physical systems.
- T06 P0 Company credential inventory and approved password/secrets management cover registrar, email, GitHub, cloud, app stores, PSP, telecom, social and emergency recovery with no shared personal passwords.
- T07 P1 Company-managed laptop/phone/admin-device asset inventory records owner, encryption, screen lock, patch level, loss response and secure disposal for devices with production or customer-data access.
- T08 P1 Bookkeeping/chart-of-accounts and month-end close reconcile bank, PSP, driver payable, cash commission receivable, taxes, payroll/contractors, promotions, refunds and provider costs with evidence.
- T09 P1 Tax/compliance calendar tracks applicable FBR, PRA or other provincial/federal registration, filing, invoicing and withholding obligations with qualified accountant/legal ownership and no hard-coded invented tax rules.
- T10 P1 Operating budget and rolling runway forecast separate one-time launch, fixed monthly, per-trip variable, support/safety, legal/insurance and marketing costs with scenario and cash-buffer assumptions.
- T11 P1 Procurement/vendor onboarding requires business owner, pricing/budget approval, security/privacy review when relevant, contract/data terms, credentials ownership and documented replacement/exit path.
- T12 P1 Vendor renewal/SLA/expiry calendar tracks maps, SMS, KYC, PSP, hosting, insurance, support telephony, domains/certificates and licenses so silent expiry cannot disable live trips.
- T13 P1 Business continuity plan covers loss of key staff, office/driver-center outage, telecom/vendor failure, banking/PSP interruption and crisis communications in addition to technical disaster recovery.
- T14 P1 Company insurance matrix is reviewed for transport/ride liability plus any applicable cyber, employer/worker, office, professional/general liability or other exposures; marketing claims match actual policies.
- T15 P2 Board/shareholder/founder governance records material decisions, authorized signatories, reserved approvals and conflicts of interest as the company evolves; chat messages alone are not corporate authorization.
- T16 P2 Fundraising data room, when fundraising begins, contains verified cap table, incorporation/tax, IP chain, contracts, security/privacy, financials, KPIs and risks without exposing unrestricted rider/driver personal data.
- T17 P1 Physical driver/onboarding/support centers have staff identity, visitor/access controls, document handling, CCTV/recording policy where lawful, secure disposal and incident reporting.
- T18 P0 Anti-bribery, conflict-of-interest and fraud controls cover driver approval, vehicle inspection, refunds, payouts, promo issuance, vendor selection and manual account reinstatement with reporting/escalation.
- T19 P1 Any office/field cash collection has custody limits, receipts, dual control/reconciliation, safe storage/deposit and shortage/robbery procedure; avoid cash handling where regulated digital alternatives are practical.
- T20 P1 Formal customer/driver complaint escalation covers internal appeal, consumer/regulator/legal escalation and evidence retention without suppressing safety reports or retaliating against complainants.
- T21 P1 Brand/social/app-store/domain accounts are company/founder controlled with MFA, recovery, publishing approval and impersonation/takedown process.
- T22 P1 Crisis communications names an accountable spokesperson and approval path for serious safety, outage, breach, regulatory or misinformation events; public claims are evidence-based and privacy-safe.
- T23 P1 Support/safety workforce hiring, background/confidentiality where justified, training, quality calibration, wellbeing, schedules and escalation coverage are capacity-planned before advertised service hours.
- T24 P0 Segregation-of-duties/maker-checker rules apply to high-risk refunds, payout-account changes, manual ledger adjustments, KYC overrides, promo grants, production access and other financially/safety sensitive actions.
- T25 P1 Legal/policy change register has owner and review cadence for transport, tax, payments, app-store, privacy, telecom, employment/contractor and insurance rules; affected features are re-gated before deadlines.

## U — Assurance, store policy, data governance and completeness closure
- U01 P0 Independent qualified penetration test or equivalent external security assessment gates any controlled public-facing real-user pilot for auth/KYC/admin/payment/location surfaces, with remediation and retest of critical findings before public launch.
- U02 P1 Real-user accessibility and usability audit includes riders/drivers with representative needs and low-end devices; automated checks alone do not approve critical booking/safety/payment journeys.
- U03 P0 Open-source and third-party license inventory/SBOM records license obligations, notices, redistribution/source requirements and prohibited/incompatible use before release.
- U04 P0 Mobile/web third-party SDK inventory maps data collected, purpose, permissions, network endpoints, subprocessors and store disclosure/privacy-manifest requirements; unapproved SDK data collection blocks release.
- U05 P0 Permission-minimization review covers location, background location, camera, microphone, photos/files, contacts, notifications and Bluetooth/nearby if ever used; each request is just-in-time and core-purpose justified.
- U06 P0 Account deletion implementation satisfies both in-app initiation and required web/request path/store disclosures, while clearly documenting lawful fraud/safety/financial retention exceptions and downstream deletion.
- U07 P0 Compromised or policy-violating third-party SDK/provider has remote disable/removal and credential-revocation runbook that preserves core trip safety where possible.
- U08 P0 Privileged support/admin workstations follow baseline controls such as OS patching, disk encryption, screen lock, approved browser/extensions, malware protection and restricted local export of production data.
- U09 P0 Personal-data/security breach response assesses containment, credential rotation, evidence preservation, affected processors/users/regulators/partners and legally required notification with approved communications.
- U10 P2 Public bug-bounty program is enabled only after vulnerability intake, ownership, safe-harbor terms, triage capacity and remediation SLAs exist; a security contact/vulnerability disclosure channel comes first.
- U11 P1 Dispatch, pricing, incentives, fraud/risk and ranking algorithms have documented objectives, inputs, protected invariants, monitoring, manipulation/feedback-loop risks and fairness/appeal review before high-impact automation.
- U12 P2 Any ML model introduced for ETA, fraud, risk, identity or demand has versioned training/evaluation provenance, offline/online metrics, drift/rollback and human escalation appropriate to impact.
- U13 P1 Analytics/event/data contracts define owner, schema version, meaning, quality checks and deletion/retention classification so dashboards do not silently reinterpret business or safety metrics.
- U14 P1 API security testing includes schema fuzzing/property tests and abuse/replay/concurrency cases for high-risk state transitions beyond ordinary happy-path integration tests.
- U15 P0 Release go/no-go checklist explicitly aggregates product, real-device, CI, security, privacy, finance, legal/vendor, support/safety staffing, backups/rollback and city supply evidence; code-green alone cannot authorize launch.
- U16 P1 App-store policy watch tracks future effective requirements, including Google Play permission/location/contacts changes and Apple privacy/account rules, with owner/deadline and release impact.
- U17 P1 Store-review package maintains accurate demo/reviewer access, declarations, data-safety/privacy labels, background-location justification, account-deletion links and screenshots that match actual enabled functionality.
- U18 P1 Supported API/OS/provider versions have deprecation/end-of-life calendar, user communication, migration plan and emergency exception handling before upstream support ends.
- U19 P1 Cross-functional game day periodically exercises a severe outage or safety/communications/business-continuity scenario and records gaps/actions; tabletop success is not silently treated as production failover proof.
- U20 P0 Completeness closure rule: any newly discovered competitor feature, edge case, legal dependency, abuse mode or founder requirement is added to the canonical register with disposition before implementation; nothing may remain only in chat/prose.

# v5 — Unified public app / multi-profile role integrity

## V — One Wayvro app with Rider + Driver/Partner modes
- V01 P0 Wayvro ships as one public mobile application/store product for passengers and earning partners; one account can use Rider mode and, after approved onboarding, Driver/Partner mode without installing a second Wayvro app.
- V02 P0 A single identity account may contain distinct rider and driver/partner profiles/capabilities; the server, not the UI mode switch, authorizes role-specific actions and data access.
- V03 P0 Driver/partner application, CNIC/selfie/liveness/document onboarding, approval, training, suspension and re-verification occur inside the unified Wayvro app while normal rider access remains available unless an account-wide safety/legal restriction applies.
- V04 P0 Mode switching obeys server-enforced conflict rules: a user cannot accept/serve driver work while participating in an incompatible active rider trip, cannot switch away from an active driver obligation in a way that abandons it, and active-state recovery after crash/restart is deterministic.
- V05 P0 Sensitive permissions are requested just-in-time by mode and task; rider-only use does not trigger driver background-location/navigation/KYC permissions, and denial/revocation has an explicit recovery path.
- V06 P0 Driver background services, location streaming, foreground-service indicators and high-frequency telemetry initialize only when justified by driver onboarding/online/active-trip state and stop reliably when the driver goes offline, signs out, is suspended or no longer has a lawful purpose.
- V07 P0 Role-scoped histories, ratings, trust signals, earnings/settlement, payment instruments, documents, support cases and notifications are isolated by authorization policy so rider and driver data cannot leak across modes or staff boundaries.
- V08 P1 The unified app has explicit mode-aware navigation, home surfaces, deep-link routing, notification routing, state restoration and back-stack rules so Rider and Driver/Partner workflows never land in the wrong context.
- V09 P1 Driver/Partner mode supports service-capability and vehicle selection (for example car, bike, rickshaw, courier/delivery where approved) without creating duplicate accounts; eligibility is checked per city, vehicle and service before going online.
- V10 P1 Unified-app releases require a cross-mode regression matrix: rider changes cannot silently break driver/KYC/background-location flows and driver changes cannot degrade booking, payments or rider safety; risky capabilities have mode-scoped feature flags/kill switches.
- V11 P1 Startup time, memory, battery, binary size and low-end Android performance budgets protect rider users from driver-only complexity; expensive driver modules/providers/background workers are not initialized until needed and are profiled on representative devices.
- V12 P1 Analytics, crash reporting, SLOs and support diagnostics segment Rider mode, Driver/Partner mode, onboarding state, service capability and app version without exposing unnecessary sensitive data.
- V13 P0 Role-specific restriction semantics are explicit: driver suspension/expired documents may block earning while preserving lawful rider use; severe fraud/safety/legal actions may be account-wide; every transition is reason-coded, auditable and appeal-aware.
- V14 P1 The single store listing/privacy disclosures accurately explain its multi-role nature and permission use; driver-only background location, camera/document and notification behavior is disclosed and reviewed against current Google Play/Apple policy before release.

# Phase 0 additions (2026-10-09) — discovered gaps closed via docs/26 completeness closure

Each item below was added in Phase 0 with a recorded source and disposition (see `docs/phase0/PHASE0_GAP_REPORT.md` and `docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json`). They remain PROPOSED until founder review.

## B — Rider booking/search/service classes (Phase 0 additions)
- B26 P1 Pre-request supply visibility shows nearby available-driver markers/ETA preview that are anonymised, jittered/aggregated, rate-limited and anti-scraping; exact off-trip driver positions are never exposed to riders or third parties.

## D — Driver onboarding, marketplace and route execution (Phase 0 additions)
- D26 P0 Vehicle single-active-driver invariant: a vehicle/plate can be online under at most one driver at a time and a driver online with at most one vehicle; conflicts are rejected server-side with reason codes; plate-level (vehicle) restrictions block every linked driver account.
- D27 P0 Single active Driver-mode session per account: going online from a second device displaces or is refused with an explicit reason, the location foreground service is bound to the authorised session, and displacement is audited and notified.

## E — Dispatch/pricing/geospatial and marketplace controls (Phase 0 additions)
- E20 P1 Fuel-indexed fare revision workflow: ops-approved rate-card revisions triggered by fuel-price changes are versioned, previewed, scheduled, and communicated to drivers/riders before taking effect; no silent mid-trip or retroactive repricing.

## G — Payments, accounting and incentives (Phase 0 additions)
- G17 P0 Driver dues policy: Wayvro commission/fees on driver-collected cash trips are tracked as driver dues in the append-only operational settlement ledger with a defined settlement cadence, dues cap with grace period, transparent statement, reason-coded go-online block above the cap with appeal, and ops-approved waiver windows (for example weather events); no silent blocking, no stored-value or e-money semantics, and statutory accounting classification is decided by a Pakistani accountant.

## M — Driver marketplace, earnings and welfare (Phase 0 additions)
- M26 P0 Driver offer alerting while online: an active Driver/Partner session runs a policy-compliant location foreground service whose realtime socket/poll/recovery path is the primary offer channel; FCM high-priority or heads-up notifications on a dedicated offer channel are a wake/alert aid only and never authoritative trip state; server offer state is authoritative with missed-push recovery on reconnect; explicit OEM battery-optimisation/autostart guidance during driver onboarding; Android full-screen intent is not requested by default for ordinary ride offers and may be used only if a future Google Play policy review confirms eligibility, the driver explicitly grants it and graceful degradation exists.

## N — Safety, trust and incident response (Phase 0 additions)
- N31 P0 Post-trip contact lockdown: masked communication channels expire at trip end (bounded lost-item window excepted), drivers cannot see rider drop-off/pickup after completion beyond dispute needs, and 'contacted me after the trip' is a first-class report reason routed to trust & safety.

## Q — Security, SRE, mobile quality and release governance (Phase 0 additions)
- Q49 P0 Release artefact and distribution policy: Android production releases ship to Google Play as an Android App Bundle meeting current Google 64-bit, target-SDK and 16 KB page-size requirements, using AAB split delivery and an ABI set chosen from dependency compatibility and measured Pakistan device coverage (arm64-v8a required; armeabi-v7a included when dependencies support it and coverage justifies it; arm64-only only after explicit device/market evidence); signed internal APKs only for controlled testers; iOS ships as a signed production archive through TestFlight internal/external testing and App Store Connect production submission/release; the public website never distributes unofficial production APKs; build provenance links every Android and iOS binary to a reviewed commit SHA.

## R — Operations, regulation, verticals and engineering rules (Phase 0 additions)
- R46 P0 Punjab-specific compliance artefacts are modelled per driver/vehicle with issue/expiry/evidence: Punjab Police character certificate, PSCA QR panic-button installation, per-district per-platform route permit (Section 44B), VICS fitness, third-party insurance (MIR-linked) and token tax; dispatch checks district coverage for cross-district trips; all configurable per city and revalidated at go-online.
- R47 P0 Harassment-complaint governance kit (Protection Against Harassment of Women at the Workplace Act 2010 / FOSPAH): inquiry-committee records, displayed code of conduct, exportable complaint register retained 3 years, regulator-response playbook with 7-day turnaround, linked to N24 case handling.

## S — Remaining mobility/product edge cases (Phase 0 additions)
- S26 P1 Telecom-outage / internet-shutdown continuity: call-centre booking and SMS/voice trip details keep essential service running during mobile-data shutdowns, driver trip completion tolerates prolonged offline periods, and ops has a documented degraded-mode playbook.

## W — Public website, web booking and staff web ecosystem (Phase 0 additions)
- W01 P1 Public website information architecture: home, how it works, rider and driver pages, cities/service areas, fare explanation, safety & trust centre, legal, help/support, careers/press, contact and corporate/fleet lead-in, managed through a CMS with approval workflow and versioning.
- W02 P1 Web accessibility and performance: public and booking web surfaces meet WCAG 2.2 AA, Core Web Vitals budgets on low-end/3G devices, and English/Urdu/Roman-Urdu parity with the app.
- W03 P1 Driver-signup web lead capture collects minimal contact details and consent, hands off to in-app onboarding via deep link/SMS, and never collects CNIC, selfie or documents through public web forms.
- W04 P1 Official-channel and anti-impersonation surface: published list of official domains, app identifiers, phone numbers and social handles; a 'verify this is Wayvro / verify this ride' page; phishing and fake-app reporting channel; store-only app distribution links.
- W05 P0 Legal and policy pages (terms, privacy, biometric/KYC notice, community guidelines, cancellation/refund policies) are hosted on the public web as the canonical versioned, dated location linked from the app, store listings and consent flows, with a change log.
- W06 P1 Web analytics, SEO and consent: privacy-aware analytics, consent banner where required, structured data/sitemaps, and no third-party trackers that ingest personal or trip data.
- W07 P0 Staff operations web application baseline: responsive and keyboard-accessible shell, MFA-backed sessions with idle lock and short lifetimes, reason-for-access prompts on PII views, approval-gated bulk exports, environment/audit banners and no client-side authorisation decisions.
- W08 P1 Web infrastructure security and operations: commercial hosting plan (never non-commercial/hobby tiers), CSP/HSTS/secure headers, registrar/DNS custody, uptime monitoring, CMS access control, backups and a deploy pipeline isolated from the API.
- W09 P1 Web booking and trip-status hardening (extends L09): phone-verified web sessions, bot/abuse controls, scoped short-lived trip-status tokens, no map-provider key leakage, and parity of safety/support entry points with the app.

# Phase 2 planning closure (2026-10-10) — approved gaps closed via docs/26 completeness closure

Each item below was added after Phase 0 with a recorded source and approval (see `post_phase0_additions` in `docs/requirements-register.json` and `docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json`). They remain PROPOSED until implemented and verified.

## A — Rider acquisition/account/accessibility (Phase 2 planning closure (2026-10-10))
- A15 P0 Wayvro must maintain a counsel-approved age and guardian eligibility policy. Consumer signup collects only the minimum age declaration/evidence necessary for that policy; driver/partner eligibility uses verified date-of-birth/licence and applicable regulatory requirements. Under-age/guardian/teen handling must be explicit, reason-coded and privacy-minimised, and future guardian/teen programmes must not require replacing the core identity model.
