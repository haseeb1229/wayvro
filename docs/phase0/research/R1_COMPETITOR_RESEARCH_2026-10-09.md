# Phase 0 research evidence R1 — Competitor capability research (observed 2026-10-09)

**Provenance:** produced by a Claude research subagent during Phase 0 using live web search/fetch; sources and observation dates are listed inline. Treat every figure as *reported* unless marked official. This file is evidence for `PHASE0_COMPETITOR_MATRIX.md`; it is not itself canonical product policy.

Observed date for all sources: 2026-10-09 unless noted. "Reported" = credible press but not independently verified. "UNVERIFIED" = could not confirm from official/credible source. Note: Google Play listings and bykea.com returned truncated/403 responses during this session; Play-derived facts rely on search-engine snippets of those listings and are marked accordingly.

## (a) Capability matrix

| Capability | inDrive PK | Yango PK | Bykea | Uber (intl benchmark) | Careem (benchmark, exited PK rides) | Other PK |
|---|---|---|---|---|---|---|
| Fixed/upfront pricing | Partial — rider proposes fare; no pure fixed option found [1][3] | Yes — "no street haggling, unclear pricing" marketing; upfront fare [9] | Yes — app fare estimate [15] | Yes | Yes (historical) | PinkGo: suggested fare, negotiable in range [23] |
| Bidding/negotiation | Yes — rider offers, driver counter-offers, rider picks [3][4] | No | No | No | Careem "Flexi" 5%-commission bid product existed (RoW 2024) [20] | PinkGo Yes [23] |
| Driver choice (by price/rating/ETA/vehicle) | Yes [3] | No | No | No (Uber lets "favorite driver" on Reserve, 2020) [29] | No | PinkGo UNVERIFIED |
| Scheduling | UNVERIFIED (not on PK pages) | Yes — pre-book up to 2 days (yango.com/en_pk/rider snippet; page age ~1.5y) [9] | UNVERIFIED | Yes — Reserve up to 90 days [28] | Yes (historical) | UNVERIFIED |
| Multi-stop | UNVERIFIED for rides; delivery "multiple deliveries" [3] | Yes — up to 2 extra stops [9]; multi-stop delivery [11] | UNVERIFIED | Yes — up to 2 stops [30] | Yes (historical) | — |
| Pooling/shared | No | No | No | Partial (UberX Share, market-dependent) | No in PK | PinkGo lists "ride sharing" [23]; Swvl/Airlift defunct [24][25] |
| Women-only | No | No | No | No | No | VSisters (Lahore/Isb/Rwp, 2025), SheDrives (Lahore, bikes), PinkGo (Lahore) — all 2026 status Partial/UNVERIFIED [21][22][23] |
| Intercity | Yes — 200+ cities [1][2] | Partial — "Rides for Business" 3- to 62-seater; no consumer intercity found [10] | No | Yes (market-dependent) | No in PK | Drivver (announced, not launched) [26] |
| Delivery / COD | Yes — courier ≤20 kg, freight >20 kg truck; groceries (Karachi, Lahore) [3][2][19] | Yes — courier bike/rickshaw/car/cargo, free parcel insurance [11][12] | Yes — parcel, shop orders; COD reported [15] | Uber Connect (intl) | Careem food/grocery not confirmed live in PK 2026 [17][18] | — |
| Cash | Yes [5] | Yes [9] | Yes [15] | Yes (market-dependent) | Yes (hist.) | PinkGo Yes [23] |
| Card | Partial — card via in-app balance top-up [5][6] | Yes — Visa/MasterCard [9] | UNVERIFIED | Yes | Yes (hist.) | UNVERIFIED |
| JazzCash/Easypaisa/Raast | Yes — JazzCash & easypaisa listed on PK help [5]; Raast UNVERIFIED | UNVERIFIED (page says "bank card or wallet", unnamed) [9] | Yes — Easypaisa, JazzCash, bank transfer (June 2025) [16]; Raast UNVERIFIED | N/A | N/A | Drivver: JazzCash planned [26] |
| SOS | Yes — SOS/Emergency button [7][2] | UNVERIFIED (no official PK page found) | UNVERIFIED | Yes — Emergency button [27] | Yes (hist.) | PinkGo SOS [23] |
| Share trip | Yes — live location sharing [7][2] | Partial — "live tracking" only [9] | UNVERIFIED | Yes — Share My Trip [27] | Yes (hist.) | PinkGo Yes [23] |
| PIN verification | UNVERIFIED | UNVERIFIED | UNVERIFIED | Yes — 4-digit PIN; 6-digit airport pickup code (Aug 2026) [27][31] | — | — |
| Masked calls | Partial — driver→passenger calls hide driver number (PK driver safety page) [8] | UNVERIFIED | UNVERIFIED | Yes — number anonymization [27] | — | — |
| In-app chat | Yes [7] | UNVERIFIED | UNVERIFIED | Yes | Yes (hist.) | — |
| Audio recording | Yes — Trip Audio Recording rolled out in PK (The News) [8] | UNVERIFIED | No | Yes [27] | — | — |
| Low-data mode | No separate lite app found | Yes — Yango Lite (com.yango.lite), ~10x smaller, 2G-capable, promoted on Lahore page [13] | UNVERIFIED | Partial (Uber Lite, selected markets) | — | Drivver: zero-rated on Jazz network (planned) [26] |
| Web booking | UNVERIFIED | Partial — "Request via browser" links on PK city pages (page age ~1.5y) [13] | No | Yes (m.uber.com) | — | — |
| Call-center booking | No | No | Yes — official FAQ lists phone booking (+92 307-1234567 / 03-111-111-700; numbers conflict) [15] | No | No | Paxi (Karachi, 2017) phone booking; 2026 status UNVERIFIED |
| Driver app topology | ONE app, driver mode (see §b) | SEPARATE "Yango Pro" app (see §b) | SEPARATE "Bykea Partner" app (see §b) | Separate Uber Driver app | Separate Captain app (hist.) | VSisters/PinkGo UNVERIFIED |
| Driver KYC | Govt ID, licence, vehicle reg; age 18 (moto/rickshaw) / 21 (car/intercity); approval ~24h [4][14] | Licence, vehicle docs, personal details + periodic selfie checks (company statement to FOSPAH) [32]; contract via fleet "partner" [9] | CNIC, licence, selfie, bike papers, training video; franchise registration option [15] | Background check + real-time ID selfies [27] | — | Islamabad: mandatory City Islamabad app registration + QR (Feb 2026) [33]; Punjab: per-district 44B route permits (Jul 2026) [34] |
| Driver commission | Not published officially; reported 10–12.99% (Wikipedia), "5–10%" or "12.99%" (blog) — UNVERIFIED; Karachi 0% waiver Nov–Dec 2025 [20][35][36] | Not published; blog reports 9.71%+VAT — UNVERIFIED; partner promos "0%/50% commission" [20][37] | Not published; reported ~20% (reviews/aggregators) — UNVERIFIED [15] | Varies by market (not fixed %) | Historical 15% std / 5% Flexi (RoW) [20] | — |

## (b) App topology evidence

**inDrive — single app, in-app driver mode (confirmed).**
- Official PK install page FAQ: "The official inDrive app supports ride-hailing, courier delivery, and driver mode — all in one app." (indrive.com/en-pk/install-android-app, © 2013–2026) [1]
- Official PK help "How to Become a Driver": select "Driver mode" from the side menu → online registration → upload docs → approval (usually ≤24 h); choose driver vs courier and vehicle type during registration [14]. Driver wallet top-up is also under "Driver mode → Wallet" [6].
- App Store (PK) listing id780125801, "inDrive: rides at your price", developer SUOL INNOVATIONS LTD, v5.187.0 updated 1 Oct: "Sign up as a driver or courier and earn on your own terms" [2].
- Android package: `sinet.startup.inDriver` (Google Play; developer SUOL INNOVATIONS LTD). Play page would not render; package ID corroborated by multiple mirrors. No separate inDrive driver package found in any store search [38].
- Relevance to Wayvro: inDrive is the dominant PK player (reported ~60%+ share, data.ai 2M+ DAU in 2024 [20]) and runs exactly the single-app/mode-switch topology Wayvro has locked.

**Yango — separate rider and driver apps.**
- Rider: "Yango: taxi, food, delivery" (`com.yandex.yango`); lite variant "Yango Lite" (`com.yango.lite`) [13].
- Driver: "Yango Pro (Taximeter) — driver" (`com.yango.driver`, App Store id1561369989, developer YHub ZAF (Pty) Ltd, v13.71.02, prior release 30 Sep 2026). Listed on the PK App Store as a distinct listing [39]. Yango PK driver page title: "Earn as a driver with Yango Pro in Pakistan" [9]; Oct 2026 PakWheels deal requires drivers to "show their active Yango Pro app" [40].
- Drivers sign a contract with a Yango fleet "partner", not Yango directly; fees set by partner [37].

**Bykea — separate customer and partner apps.**
- Customer: "Bykea: Rides & Delivery App" (`com.bykea.pk`); Partner: "Bykea Partner: Drive & Earn" (`com.bykea.pk.partner`) — Play listing: earn via ride-hailing and delivery with bike, rickshaw or car; upload CNIC, licence, photo; complete training [15].

## (c) What changed since Oct 2025 (dated)

- **Nov–Dec 2025:** inDrive waived ride commission in Karachi (1 Nov–31 Dec) [36].
- **2 Dec 2025:** FOSPAH (Federal Ombudsperson for Protection Against Harassment) issued notices to Yango and inDrive after a harassment/route-deviation complaint, demanding proof of Workplace Act 2010 compliance, driver-vetting records, in-app safety tools within 7 days; Yango cited licence/document checks and periodic selfie verification; inDrive cited immediate suspension pending investigation [32]. Outcome UNVERIFIED.
- **8 Dec 2025:** Profit profile of Yango delivery: multi-stop, address photos, free parcel insurance, bikes→trucks; executives say "never price wars"; driver commission protests "flare periodically" [11].
- **Jan–Mar 2026:** inDrive launched groceries in Karachi via Krave Mart (Jan), CCP approved full acquisition (TechCrunch, 11 Mar 2026); Lahore launched as "inDrive.Groceries" [19].
- **3 Feb 2026:** Yango Basant campaign in Lahore: free rickshaw rides/deliveries, 5,000 safety rods for motorcycle partners, no penalties for drivers staying home [12]. Press (esmag, 8 Feb) reported riders could not find the promised free rides and a Rs150 trip quoted at Rs450 — reported, not verified.
- **10–12 Feb 2026:** Islamabad DC made City Islamabad app registration (CNIC, vehicle reg, QR code) mandatory for Bykea/inDrive/Yango drivers [33].
- **12 Mar 2026:** Petrol +Rs55/L; Karachi bike-hailing drivers raised fares 5–10% (Profit) [41]. No official Lahore fare table found.
- **Apr–May 2026:** Yango "Rides for Business" live in Karachi & Lahore (3- to 62-seat vehicles, consolidated billing, dashboard) [10]; Yango–Jazz Business driver bundles and "Benefits Hub" (May) [42]. Bykea riders received Saylani free-petrol charity (Apr) [16].
- **Jul 2025 (context) / 18 Jul 2025:** Careem ride-hailing ceased in Pakistan; Careem Care ran to 18 Sep 2025 for wallet refunds; ~400 staff retained on "Everything App" (food/grocery/payments) — no evidence of a PK consumer launch by Oct 2026 [17][18].
- **29 Jul 2026:** Punjab Section 44B: per-district, per-platform annual route permits for ride-hailing drivers across 36 districts; inDrive warned of reduced supply [34].
- **10 Aug 2026:** SheDrives (women/trans, Lahore, motorcycles) still operating; drivers ≥18 with licence [22].
- **25 Aug 2026 (Uber intl):** 6-digit airport pickup codes replace standard airport dispatch for eligible drivers [31].
- **3 Sep 2026:** "Drivver" announced — Jazz + iTecknologi MoU; cars/bikes/rickshaws, JazzCash payments, zero-rated data on Jazz; no launch date or cities [26].
- **4–6 Sep 2026:** inDrive says only ~5% of Pakistanis use ride-hailing (vs ~20% global); inDrive in 30 cities, intercity 200+, groceries in Karachi & Lahore; Yango reports PK post-trip safety contacts −31% [43][44].
- **2 Oct 2026:** Lahore Foodpanda/Yango/inDrive riders planned protest: withdrawn bonuses, new rider tax, alleged Rs1,500–2,000/day payments to stay active; petrol >Rs390/L with commercial vehicles excluded from relief — reported, not verified [45].
- **6 Oct 2026:** Yango–PakWheels: 50% off car care for Lahore partner drivers through 31 Dec 2026 [40].
- **Not found / negative findings:** No Bolt Pakistan launch (single 2024 passing mention only); Swvl exited Nov 2022, re-entry "hinted" Mar 2025, nothing since; Airlift shut Jul 2022; Uber ceased Lahore app ~Apr–May 2024 (Dawn/Tribune), no 2026 return [24][25][46].

## Status summary of other PK players (2026)
- **VSisters** — women-only, cars+bikes; 464 captains (356 Lahore) mid-2025 (Arab News); criticized as pricey; 2026 status UNVERIFIED [21].
- **SheDrives** — Lahore, women+trans, motorcycles; active Aug 2026 [22].
- **PinkGo** — Lahore HQ; AC/mini/bike classes, SOS, face verification, cash+wallet, fare negotiation; drivers "pre-register" → scale UNVERIFIED [23].
- **Pink Rider** — "being developed"; pre-launch [23].
- **Paxi/Pink Taxi (Karachi 2017)** — 2026 status UNVERIFIED.
- **Drivver** — announced Sep 2026, not launched [26].
- **Bolt, Swvl, Airlift, Uber** — not operating rides in PK.

## Reported fares/complaints (reported, not verified)
- inDrive bike ~PKR 12–25/km; Yango rides "from ~PKR 140" (The Dusk blog, Apr 2025) [35].
- Recurring complaint pattern: drivers demanding extra cash above app/promo fare then cancelling (Trustpilot/PissedConsumer reviews 2025; one Lahore review Rs321 promo vs Rs400 demanded); no refunds on cancelled card rides (inDrive) [47].
- Safety: FOSPAH notices (Dec 2025); Lahore police arrested a ride-hailing driver for harassment (Tribune 2026) [32].

## (d) Sources (all observed 2026-10-09)
1. https://indrive.com/en-pk/install-android-app (© 2013–2026)
2. https://apps.apple.com/pk/app/indrive-rides-at-your-price/id780125801 (v5.187.0, updated 1 Oct)
3. https://indrive.com/en-pk/delivery
4. https://indrive.com/en-pk/driver
5. inDrive PK help "Payment Methods in Pakistan" (cash, easyPaisa, JazzCash) — surfaced via search; page body mismatched URL when fetched: https://indrive.com/en-pk/help/passengers/how-to-check-my-rating — treat as Partial verification
6. https://indrive.com/en-pk/help/drivers/how-to-top-up-your-indrive-account
7. https://indrive.com/en-pk/safety
8. https://indrive.com/en-pk/safety/drivers ; https://www.thenews.pk/print/1426841-indrive-rolls-out-trip-audio-recording-in-pakistan
9. https://yango.com/en_pk/rider/ ; https://yango.com/en_pk/driver/ ; https://yango.com/en_pk/city/lahore/ (fetched pages truncated; details from search-indexed text, ~1.5 y old)
10. https://yango.com/en_int/news/corporate-mobility-redefined-yango-pakistan-launches-yango-rides-for-business (Apr/May 2026)
11. https://profit.pakistantoday.com.pk/2025/12/08/how-yango-is-conquering-pakistans-last-mile-delivery/ (8 Dec 2025)
12. https://propakistani.pk/2026/02/03/this-basant-yango-pakistan-paints-lahore-in-colour-with-free-rickshaw-rides-and-deliveries/ (3 Feb 2026)
13. https://play.google.com/store/apps/details?id=com.yango.lite ; Yango PK city pages (Lite, "Request via browser")
14. https://indrive.com/en-pk/help/drivers/how-to-become-a-driver ; https://indrive.com/en-pk/help/drivers/what-are-the-steps-for-driver-and-vehicle-verification
15. https://play.google.com/store/apps/details?id=com.bykea.pk.partner ; https://play.google.com/store/apps/details?id=com.bykea.pk ; https://bykea.com/faq/ ; https://bykea.com/pk/ (site returned 403; snippets via search)
16. https://www.brecorder.com/news/40369575 (Bykea digital payments, Jun 2025); https://www.brecorder.com/news/amp/40415476 (Saylani petrol, Apr 2026)
17. https://www.dawn.com/news/1917884 (18 Jun 2025)
18. https://propakistani.pk/2025/06/18/careem-to-rival-foodpanda-with-new-everything-app/ ; https://www.phoneworld.com.pk/careem-to-shut-down-in-pakistan-by-july-18-withdraw-your-careempay-balance-now/
19. https://techcrunch.com/2026/03/11/ride-hailing-indrive-acquires-pakistans-kravemart-to-bolster-grocery-delivery/ (11 Mar 2026)
20. https://restofworld.org/2024/careem-indrive-pakistan/ (2024); https://en.wikipedia.org/wiki/InDrive
21. https://www.arabnews.pk/pakistan/behind-the-wheel-pakistans-first-women-only-ride-hailing-service-promises-safer-commutes-2614510 (2025); https://propakistani.pk/2025/05/19/vsisters-introduces-a-ride-hailing-app-for-women-but-theres-a-problem/
22. https://www.24newshd.tv/10-Aug-2026/shedrives-offers-women-new-ride-hailing-option (10 Aug 2026)
23. https://pink-go.com/ride-hailing.php (© 2026); https://pinkrider.com.pk/
24. https://profit.pakistantoday.com.pk/2022/11/24/mobility-startup-swvl-shuts-operations-in-pakistan-its-second-biggest-market/ ; https://launchbaseafrica.com/2025/03/11/egypts-swvl-hints-at-pakistan-re-entry-three-years-after-abrupt-exit/
25. https://www.dawn.com/news/1699317 (Airlift, Jul 2022)
26. https://propakistani.pk/2026/09/03/new-ride-hailing-app-drivver-is-coming-to-pakistan/ (3 Sep 2026)
27. https://www.uber.com/us/en/ride/safety/ (© 2026)
28. https://www.uber.com/hk/en/blog/reserve-riderfaq/ (10 Aug 2026)
29. https://techcrunch.com/2020/11/10/uber-will-now-let-users-book-rides-30-days-in-advance-and-pick-a-favorite-driver
30. https://www.uber.com/info/get-trips-without-waiting ; https://www.uber.com/lk/en/drive/basics/driver-destinations (2 destinations/day)
31. https://www.uber.com/us/en/blog/airports-pickup-code/ (25 Aug 2026)
32. https://www.app.com.pk/national/safety-systems-under-scrutiny-fospah-issues-strong-directive-to-yango-pakistan-after-disturbing-harassment-allegations/ (2 Dec 2025); https://tribune.com.pk/story/2580125/ (403 on fetch); https://tribune.com.pk/story/2601169/
33. https://bloompakistan.com/islamabad-launches-registration-app-for-yango-bykea-indrive-and-their-drivers/ (12 Feb 2026)
34. https://www.pakwheels.com/blog/punjab-allots-route-permits-for-ride-hailing-drivers-what-you-need-to-know/ (29 Jul 2026)
35. https://www.dusk.com.pk/indrive-vs-yango/ (29 Apr 2025, blog — UNVERIFIED figures)
36. https://synergyzer.com/indrive-waives-commission-in-karachi-as-part-of-its-people-first-business-model/ (3 Nov 2025)
37. https://yango.com/en_pk/driver/ ("contact Yango partners" for service fees); https://yango.com/en_pk/driver/benefits/
38. https://play.google.com/store/apps/details?id=sinet.startup.inDriver (would not render; package corroborated by apkpure/appmagic)
39. https://apps.apple.com/pk/app/yango-pro-taximeter-driver/id1561369989 (v13.71.02)
40. https://propakistani.pk/2026/10/06/yango-pakistan-and-pakwheels-partner-to-strengthen-vehicle-quality-and-driver-economics/ (6 Oct 2026)
41. https://profit.pakistantoday.com.pk/2026/03/12/pakistan-railways-raises-fares-ride-hailing-services-hike-rates-after-fuel-price-surge/ (12 Mar 2026)
42. https://propakistani.pk/2026/05/21/yango-pakistan-partners-with-jazz-business-to-enhance-driver-and-courier-experience/amp/ (21 May 2026)
43. https://propakistani.pk/2026/09/04/indrive-reveals-how-much-of-pakistan-uses-ride-hailing-apps/ (4 Sep 2026)
44. https://tribune.com.pk/story/2627651/car-shortage-stifles-ride-hailing (6 Sep 2026)
45. https://www.lhrtimes.com/2026/10/02/lahore-foodpanda-yango-indrive-riders-protest-tax-fees-petrol-relief/ (2 Oct 2026)
46. https://www.uber.com/en-PK/newsroom/update-on-our-pakistan-operations (11 Oct 2022); https://www.dawn.com/news/1830696 (Uber ceases PK app, 2024)
47. https://www.trustpilot.com/review/indrive.com ; https://yango.pissedconsumer.com/review.html ; https://esmag.pk/2026/02/08/lahoreites-disappointed-as-yango-indrive-free-ride-scheme-stays-off-the-road/ (user reviews — unverified)

## Key takeaways for Wayvro
1. inDrive proves the single-app/driver-mode topology works at PK scale; Yango and Bykea use separate driver apps. No PK player publishes commission rates — all percentages are reported/unverified.
2. Verified PK payment baseline: cash + JazzCash/Easypaisa (inDrive, Bykea); card (Yango direct; inDrive via balance). Raast not evidenced by any player.
3. Safety baseline in PK today: SOS, share-trip, in-app chat, audio recording (inDrive); PIN verification is absent locally — an Uber-standard gap.
4. Regulatory load is rising (Islamabad registration, Punjab 44B permits, FOSPAH scrutiny) — plan KYC/compliance for per-district permits.
5. Gaps not closed this session: Yango PK official scheduling/multi-stop/safety pages (only search-indexed text ~1.5 y old), Bykea official site (403), live Google Play metadata, 2026 status of VSisters/PinkGo/Paxi.
