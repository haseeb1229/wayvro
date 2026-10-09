# 24 — v4 Second-Pass A-to-Z Gap Audit

**Status:** HISTORICAL CONTEXT ONLY. This file explains omissions found in an earlier baseline. Current v5 founder decisions, `requirements-register.json`, root `CLAUDE.md`, and current canonical docs outrank this file if anything conflicts.
**Audit date:** 2026-10-09. **Inputs:** all four founder prompts, v3 package/427 requirements, current public competitor/platform/regulatory sources, and reusable Minhaj engineering controls.

## Conclusion
v3 is a strong product/engineering baseline, but the second pass found two remaining classes of omission:
1. **Edge product/marketplace workflows** that were not explicit enough to test.
2. **Startup/company controls** that existed only as narrative and therefore could be forgotten while focusing on code.

v4 adds **70 atomic requirements** (S01-S25, T01-T25, U01-U20). They are proposed until Phase 0 assigns disposition/phase/acceptance evidence.

## Important gaps made explicit in v4
- Driver acceptance/cancellation metrics and driver communications inbox.
- Round-trip/flexible-pickup options as separately gated products.
- Personal vs business rider profile, corporate guest/delegate ride, three-way communication, corporate API/webhooks and expense integration.
- Multi-drop courier batching.
- Support-call recording/transcription privacy.
- Push-token lifecycle, recycled phone numbers and OAuth/phone account-link conflicts.
- Contact-picker/manual trusted-contact privacy instead of broad contact upload.
- Optional CarPlay/Android Auto, road-hazard, preferred-driver and priority-pickup ideas kept future-gated rather than silently excluded.
- Company IP chain, cap table, personnel access/offboarding, company credential/asset custody, accounting close/tax calendar, runway, procurement, business continuity, insurance, governance, physical-center controls and crisis communications.
- Explicit independent penetration test, SDK/privacy-manifest inventory, permission minimization, store account-deletion compliance, privileged workstation security, breach response, algorithm/model governance, API fuzz/property testing and release go/no-go aggregation.

## Current official evidence sampled in the re-audit
- Yango Pakistan publicly advertises upfront pricing, cards/wallets, real-time tracking, verified drivers, route sharing, SOS/support, Lite mode, browser ordering, scheduled rides and Economy/Comfort/Bike/Rickshaw: https://yango.com/en_pk/ and https://yango.com/en_pk/city/lahore/
- Bykea advertises call-center booking, verified/insured partners, bike/car/rickshaw, parcel delivery/COD, in-app messaging and wallet/cash flows: https://bykea.com/pk/ , https://bykea.com/safety/ , https://www.bykea.com/how-it-works.php
- inDrive official materials describe phone verification, rider fare offers/counteroffers, deliberate driver selection using rating/vehicle/price, two-way safety expectations, trip sharing and multiple service verticals: https://blog.indrive.com/
- Uber official materials provide global benchmarks for two-way ratings, phone anonymization, RideCheck, PIN, audio/dashcam safety, teen/guardian controls, destination/area preferences, back-to-back trips, airport operations and business/delegate profiles/APIs: https://www.uber.com/
- Careem official materials provide benchmarks for scheduled/varied ride classes, child-seat/group categories, multiple payment methods, driver verification/vehicle requirements and business operations: https://www.careem.com/
- Punjab route-permit process requires evidence including ownership/registration, token tax, fitness and third-party risk insurance: https://transport.punjab.gov.pk/procedure-of-obtaining-route-permit
- SBP states businesses/merchants integrate Raast through banks/payment providers and documents P2M modes: https://www.sbp.org.pk/our-subsidiaries/raast/raast-person-to-merchant
- Google Play requires account deletion for account-creating apps and tightly limits sensitive/background-location permissions; policy changes effective 2027 also matter to this project: https://support.google.com/googleplay/android-developer/answer/13327111 and https://support.google.com/googleplay/android-developer/answer/16558241
- Apple requires in-app account-deletion initiation for apps with account creation and accurate privacy/data-use disclosure: https://developer.apple.com/support/offering-account-deletion-in-your-app/ and https://developer.apple.com/app-store/review/guidelines/
- SECP provides digital company-incorporation routes; FBR/PRA obligations require qualified current review for the actual entity/service model: https://www.secp.gov.pk/company-formation/registration-of-company/ and https://www.fbr.gov.pk/

## Not a completeness guarantee
The number of requirements is **not** the quality metric. v4 deliberately does not claim that no future law, abuse pattern, provider change or user need can be discovered. The freeze criterion is: no **known** founder instruction or researched domain may remain unexplained or merely implied. New discoveries trigger U20 and must be dispositioned before implementation. v5 additionally adds V01–V14 for the founder-corrected unified-app model.
