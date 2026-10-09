# Phase 0 research evidence R6 — Lahore market, safety-ops and operations research (observed 2026-10-09)

**Provenance:** produced by a Claude research subagent during Phase 0. "Reported" = press/secondary coverage; "UNVERIFIED" = could not confirm from a primary source. No commission/earnings figure is an official disclosure. Feeds `PHASE0_GAP_REPORT.md` (new requirements N31, R46, R47, E20, S26, B26, D26), `PHASE0_SECURITY_PRIVACY.md` abuse cases and `PHASE0_LAUNCH_BLOCKERS.md`.

> **Phase 0 founder-review closure note (2026-10-09):** this file is preserved verbatim as historical research evidence. Where it prescribes a decision, the canonical outcome is in `docs/phase0/PHASE0_GAP_REPORT.md` (CL-17..CL-22, FD-01..FD-14) and the requirement register; bracketed *[Closure note]* annotations below mark superseded conclusions.

## 1. Women's mobility 2024–2026
- Market structure: Uber closed its Pakistan app in 2024; Careem suspended core ride-hailing 18 Jul 2025. Market now inDrive (reported ~60% share early 2026), Yango, Bykea.
- **VSisters** (launched Jun 2025; Islamabad/Rawalpindi/Lahore): 464 female captains (356 in Lahore), cars + company-provided bikes, >3,500 rides in first months, 10% platform take, verification = CNIC + licence + age 18 only; bike riders earn ~Rs2,500/day at ~12 rides; bike captains report street jeering (Arab News 8 Sep 2025, reported).
- **PinkGo** (Lahore; App Store 43 ratings): claims verified female drivers, SOS, live tracking, rider-set fares, carpooling. Scale UNVERIFIED. **SheDrives**: women + trans drivers/passengers; status Aug 2026 active. Pink Taxi/Paxi (2017) — no evidence of current operation.
- **Yango/inDrive**: no women-driver programmes beyond general safety features; Punjab e-taxi scheme reserves 30% of 1,100 EVs for women (reported Feb 2026).
- **Supply pipeline**: Lahore Traffic Police report 15,256 women trained (7,178 on motorcycle/scooter); Punjab issued 61,000 motorcycle licences to women in 2025 (reported).
- **Harassment incidents & responses**: FOSPAH ordered Yango Pakistan (2 Dec 2025) to prove compliance with the Protection Against Harassment of Women at the Workplace Act 2010 within 7 days: inquiry committee, code of conduct display, complaint procedures, vetting/route monitoring, and 3 years of harassment-complaint records. Lahore arrests for harassment (Dec 2025; 2026). Lok Sujag (13 Jul 2026) documents route diversions, drivers sharing drop-off location with third parties, post-trip WhatsApp contact, complaints closed without action.
- **Punjab regulation**: TNC licensing (Yango first licensee, Mar 2026). *[Closure note: SECONDARY_REPORT / NEEDS_OFFICIAL_RECONCILIATION (CL-21).]* PSCA QR panic buttons extended to inDrive/Yango fleets; CTO Lahore says installation is compulsory. Nearly 500 panic alerts generated, "most by women" (reported).
- **1043 / women safety app**: PCSW helpline 1043 reachable via Punjab Police-Women Safety App (PSCA); a "virtual women police station" is reachable via Yango's 15 integration (The News 7 Jan 2026).
- **Legal commentary on gender-restricted services**: no Pakistani case law found; Art. 25(3) allows special provisions for women. UNVERIFIED whether constitutional equality binds private platforms.

**Product implications**: Gender attribute must be CNIC-document-verified by reviewer, not self-declared or inferred; *[Closure note: superseded by CL-17 — Wayvro never algorithmically infers gender from face/selfie/name/CNIC number/photo or any proxy; eligibility uses an explicit consent-based, counsel-reviewed policy with qualified human review, fallback and appeal; a document attribute may be checked only if explicitly present and counsel approves that limited purpose.]* women-preference matching must degrade gracefully (fallback to any-driver only with explicit rider consent, ETA shown) given tiny female supply. Support female driver opt-in to "women passengers only" and rider opt-in "women drivers only". Build the FOSPAH-shaped compliance kit from day one. Post-trip contact prevention. Route-deviation alert with rider confirm/deny. Driver-side SOS and street-harassment reporting for female bike captains.

## 2. Pooling / carpooling / commute
- Swvl exited Pakistan Nov 2022; Airlift shut Jul 2022. Savaree acquired by Careem 2016; BusCaro (2023) status UNVERIFIED. Carpoolworld has informal Lahore listings for FAST, LUMS, Kinnaird, ITU routes.
- Lahore transit: ~200 Speedo buses on 21 feeder routes, 40 e-buses, 300 more arriving (reported); no TNC last-mile integration found.
- Demand evidence: Dawn 10 May 2026 quotes commuters paying Rs18,000–23,000/month on ride-hailing commutes; students cite poor evening/weekend bus frequency.
- Regulation: Punjab EPA (6 Oct 2026) told Lahore schools to arrange carpooling for smog with "mutual consent of families", "no extra financial burden". Under §44B, cross-district trips need permits — a pooled/commute product crossing district lines is exposed. UNVERIFIED whether cost-sharing carpool counts as "ride-hailing".

**Product implications**: Pool product should launch as fixed-corridor, pre-booked (school/office/university) with group formation by verified institution and consent capture; model "cost-share" pricing explicitly; treat district boundaries as a routing/eligibility attribute on every driver and trip.

## 3. Driver economics, Lahore 2026
- Petrol: Rs396.65/litre from 8 Oct 2026 (reported); Dawn 10 May 2026 cites Rs253 (27 Feb 2026) → Rs415 (May); pricing revisions now very frequent.
- Fuel cost per Yango spokesperson: Alto/Cultus does 200–250 km/day, ~15 L/day → Rs6,225/day at Rs415. Yango fares up 19–20% in Lahore/Karachi since Mar 2026.
- Commission (all reported): Yango 9.71% + VAT; inDrive 10–12.99%; Bykea ~20%. Relief scheme: Rs100/litre petrol relief applies only to private non-commercial vehicles.
- Earnings: Careem/Bykea captains ~Rs3,500/day (reported); VSisters bike ~Rs2,500/day.
- Protests: Foodpanda/Yango/inDrive riders in Lahore planned a march (2 Oct 2026) demanding restored bonuses, removal of a new rider tax, end of daily fees; vehicles mostly rented.
- Regulatory cost: §44B route permits — per district and per platform, annual renewal; experts estimate 20–40% fleet shrinkage (reported). Fees not published.
- Vehicles: Alto/Cultus hatchbacks, motorcycles, rickshaws; Yango–Mobilink Bank Murabaha financing for bikes/e-bikes/rickshaws + takaful (Aug 2026). Bykea rider complaints: cancellation losses, wallet top-up, blocked accounts when balance runs out.

**Product implications**: Fuel-indexed fare floors re-evaluated frequently with ops approval; per-district permit records with expiry; trips crossing a district edge check driver permit coverage; commission transparent per-trip with waiver windows; rented-vehicle drivers (owner ≠ driver) need fleet-owner accounts and vehicle-level bans; cancellation compensation and automatic commission refund are expected norms.

## 4. Rider market
- PTA Feb 2026: 204.8M mobile subs, 155.9M 3G/4G users; 4G 93.67% of connected time; 5G <4%. Smartphone ownership ~31% of population (UNVERIFIED). Bykea's Partner listing is in Roman Urdu.
- Payments: SBP FY26: 92% of retail transaction count digital, but value cash-heavy. No published cash share for ride-hailing; vendor commentary says the "overwhelming majority" of trips settle in cash (UNVERIFIED).
- Fares (indicative, Lahore): inDrive motorcycle ~Rs80 (4 km), 120 (8 km), 200 (16 km); Yango cars Rs20–35/km; Dawn May 2026: typical Karachi commute Rs600–650 → ~Rs700 avg.
- Complaints: Basant 2026 "free ride" promotion missing and fares 3× normal; Yango drivers asking extra cash; inDrive 30–40 min support waits; Bykea cancellation fee on cancelled ride.

**Product implications**: Android-first, low-end, 4G-degraded; Roman Urdu as a first-class locale; cash default with exact fare rounding to Rs10; cash-trip fraud needs rider/driver dual confirmation; promotion display server-authoritative with "why not applied" reasons.

## 5. Safety operations
- Careem (historic): Safety Button to Care centre + law enforcement, call masking, Mohafiz crisis-response contractor, helpline bookings during broadband suspension.
- Yango: real-time 15 integration with PSCA (7 Jan 2026): in-app call routed with priority flag, auto-shares live location, personal details, pickup/drop, driver identity and vehicle registration. Sept 2026 report: number masking, selfie anti-fraud expanded to Pakistan, urgent support 24/7 with first contact in 5 min for 90% of urgent cases, 17,275 passenger accounts blocked for fraud (company-sourced).
- PSCA QR panic button: rider scans cabin QR → sees registration, owner, driver background; shares trip with family via Public Safety App (works offline since Sep 2025); emergency via call/video/chat to 15; >66,000 installed in Lahore; enforcement from 1 Jul 2026; CTO says mandatory for online cabs.
- inDrive: no phone line; in-app chat/form; lost-item path is a web form with weeks-long waits (reported Dec 2025).
- Rescue 1122 and Police 15 are the Lahore emergency numbers; Edhi 115.
- Recording law: Supreme Court (reported 10 Mar 2026) held secret recording without consent violates Art. 14 privacy; forward-facing video lowest risk; cabin audio needs explicit per-passenger consent (inference).
- Insurance: Bykea listings claim accident cover Rs200,000 / hospital Rs25,000 (UNVERIFIED); motor third-party cover is compulsory but covers the other party only; passenger injury needs comprehensive/takaful.

**Product implications**: Target parity with Yango's 15/PSCA integration (requires formal PSCA agreement; do not claim before tested). Until then, SOS = one-tap call to 15 + share of trip payload to trusted contacts. Support PSCA QR panic button as a vehicle document type. 24/7 urgent lane with 5-minute SLA is the market benchmark; chat-only is a documented failure mode. Lost-and-found with masked re-contact and police-report handoff. Dashcam: forward video only by default; cabin audio off unless explicit consent logged.

## 5b. Incident patterns (Lahore 2024–2026)
- Fake ride-hailing app gang, Jail Road (Aug 2025): victim robbed after booking on a fake app; 4 arrests, 200+ SIMs recovered (Dawn 13 Aug 2025).
- Ex-franchise owner of a defunct platform reused driver records to pass courier verification on multiple platforms (The News 31 Jul 2025).
- inDrive courier absconded with Rs45,000 of goods; inDrive banned account and all accounts linked to the vehicle (Aug 2025).
- Staged robbery by a delivery rider to pocket company cash (Apr 2026). Harassment/assault arrests (Dec 2025; 2026). Basant promo abuse/fare spikes (Feb 2026).

**Edge cases**: SIM-farm account creation; vehicle-level bans (all accounts on a plate); recycled driver records from dead platforms; rider-side fraud (fake cancellations, staged robbery of COD cash); impersonation of the brand via cloned APKs.

## 6. Operational benchmarks
- Bykea: in-app form, CNIC + licence + selfie + bike papers, in-app training before first ride; franchise walk-ins exist.
- inDrive: Driver mode → Online registration → upload licence + registration; approval "usually up to 24 hours"; Lahore offices listed (directory listings with verification-delay complaints).
- Yango: app upload + verification; partner offices; >50 fleet partners (2024); Driver Benefits Hub (Apr 2026).
- Support: inDrive no phone; Yango claims 24/7; Careem ran a 24×7 call centre and phone bookings during internet shutdowns.
- Implications: plan a Lahore partner centre for original-document inspection + bike inspection; publish verification SLA; design for internet-shutdown phone booking; store licence as mandatory for all vehicle classes.

## 7. Brand check — "Wayvro"
- Web search for exact "Wayvro": no app, company or product; nearest hits are Wayvero (UK training software), Wayvr (waivers app), WayVR (Linux VR), Wayro (travel eSIM), "J Wayvro/Wavro Associates" (SF property firm). Instagram @wayvro exists as a K-pop fan account. No Google Play or App Store listing named Wayvro found.
- Domains: wayvro.com and wayvro.pk did not resolve (DNS ENOTFOUND) — suggests unregistered or unconfigured; registrar status UNVERIFIED (no WHOIS run).
- IPO Pakistan: online e-filing live since Jun 2023; lawyer-run clearance recommended in Classes 9, 39, 42 and conflict review against "Wayvero/Wayvr/Wayro".

## 8. Intercity / delivery
- inDrive Intercity lists Lahore–Islamabad ~379 km, recommended PKR 5,920. Daewoo Lahore–Rawalpindi Rs2,470 standard (undated).
- Bykea parcels: COD proceeds to sender wallet; older limit 10 kg. Yango Delivery added car courier (Oct 2025).
- Regulation: Pakistan Courier and Logistic Regulatory Authority Act 2018 status UNVERIFIED. Tax: Finance Act 2025 + SRO 1429(I)/2025 make couriers withholding agents — 2% withholding and sales tax on COD, monthly statements by the 10th.
- Implications: COD product must compute and remit FBR withholding and issue monthly statements; intercity needs §44B multi-district permits; prohibited-goods declaration + photo at pickup.

## Top 15 product requirements / edge cases a generic blueprint would miss
1. Per-driver, per-district, per-platform route-permit records (§44B) with expiry; trip-time check when route crosses a district boundary.
2. PSCA QR panic button as a mandatory vehicle artefact (install proof, expiry, QR shown in app) and a roadmap item for 15/PSCA priority-flag integration — never claimed before a signed, tested integration.
3. FOSPAH-ready harassment governance: inquiry committee, displayed code of conduct, 3-year exportable complaint register, 7-day regulator response playbook.
4. Women-preference matching backed by reviewer-verified gender, *[Closure note: per CL-17, consent-based counsel-reviewed eligibility with human review and appeal — no inference.]* explicit fallback consent and supply-aware ETAs; driver-side SOS and street-harassment reporting.
5. Post-trip contact lockdown: masked numbers auto-expire at trip end; driver never sees drop-off after completion; "driver contacted me after trip" as a first-class report reason.
6. Route-deviation detection with rider in-trip confirm/deny and automatic ops escalation.
7. Fuel-indexed fare floors updated from near-daily price changes; ops-approved repricing; commission waiver windows.
8. Fleet-owner/rented-vehicle model: owner ≠ driver, vehicle-level bans, owner document custody, payout splits.
9. Anti-impersonation: cloned-APK/fake-app detection, in-app driver/vehicle verification screen for riders, public "verify this ride" page; SIM-farm and recycled-driver-record fraud checks at onboarding.
10. Cash-first settlement with exact-change rounding, dual confirmation of cash receipt, and dispute flow for "driver demanded extra cash"; negative-balance handling that does not silently block drivers.
11. Cancellation economics: automatic commission refund and driver compensation on rider no-show, with booking-ID-based appeals.
12. Lost-and-found SLA: masked re-contact, escrow handover, police-report handoff; urgent 24/7 phone lane with 5-minute first-contact target (market benchmark).
13. Recording policy: forward dashcam only by default; cabin audio requires logged per-passenger consent.
14. Pool/commute as fixed-corridor institutional product with per-family consent and no-extra-cost pricing option; district-boundary aware.
15. Delivery/COD: FBR 2% withholding + sales-tax deduction, monthly statements, prohibited-goods declaration with photo, value caps; courier-regulator status tracked as an open legal dependency.

Key gaps (UNVERIFIED): official commission rates; cash share of trips; TNC licence conditions text; permit fees; PCLRA Act status; PinkGo/BusCaro status; domain registrar status for wayvro.com/.pk.

Selected sources (observed 2026-10-09): arabnews.pk VSisters (8 Sep 2025); apps.apple.com PinkGo id6738834537; app.com.pk FOSPAH (2 Dec 2025); tribune.com.pk/story/2601169; thenews.pk/print/1391214 (7 Jan 2026); propakistani.pk 5 Sep 2026 (Yango safety report); lhrtimes.com 31 Aug 2026 (PSCA); dawn.com/news/1930525 (13 Aug 2025); thenews.com.pk/print/1332064 (31 Jul 2025); dawn.com/news/1999091 (10 May 2026); lhrtimes.com 2 Oct 2026; pakwheels.com 29 Jul 2026 (§44B); dawn.com/news/2018867; propakistani.pk 25 Aug 2026 (Yango–Mobilink); phoneworld.com.pk PTA Feb 2026; techjuice Q2 2026; esmag.pk 8 Feb 2026; propakistani.pk 10 Mar 2026 (recording); profit.pakistantoday.com.pk/?p=203554 (COD tax); intercity.indrive.com; pitb.gov.pk/node/9273 (IPO e-filing).
