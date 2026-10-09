# PHASE0_COMPETITOR_MATRIX — Current sourced capability vs benchmark vs Wayvro decision

**Date:** 2026-10-09 · **Status:** Phase 0 deliverable (plan-only) · **Evidence:** `docs/phase0/research/R1_COMPETITOR_RESEARCH_2026-10-09.md` (sources, observation dates, UNVERIFIED labels) plus R2/R3/R6 where noted. This matrix supersedes the competitor rows in `docs/01_COMPETITION_AND_STRATEGY.md` for currency; docs/01 keeps the positioning narrative.

**Reading rules.** "PK" columns describe what is observable in Pakistan today; "Uber (intl)" is an international benchmark only (Uber does not operate rides in Pakistan since 2024); Careem ceased Pakistan ride-hailing on 2025-07-18 and is a historical benchmark. "Reported" means credible press, not verified; "UNVERIFIED" means no official source could be opened. Competitor behaviour is evidence for prioritisation, never permission to copy proprietary design/code (RSK-021).

## 1. Capability matrix

| Capability | inDrive PK | Yango PK | Bykea | Uber (intl) | Careem (hist.) | Other PK | **Wayvro decision (ID / phase)** |
|---|---|---|---|---|---|---|---|
| Upfront fixed price | Partial (rider proposes) | Yes | Yes | Yes | Yes | PinkGo partial | **NOW** — B06/E05 Phase 3; pilot default (ADR-002/013) |
| Bidding / counter-offer | Yes (core) | No | No | No | Flexi (RoW) | PinkGo yes | **NOW, Phase 9** — B16/B17/E13/L03 (P1); controlled mutual bidding/counter-offer, feature-flagged (FD-02) |
| Rider chooses driver by price/ETA/rating | Yes | No | No | No | No | UNVERIFIED | **NOW, Phase 9** — L02/L03 (FD-02) |
| Scheduled rides | UNVERIFIED | Yes (≤2 days) | UNVERIFIED | Yes (≤90 days) | Yes | — | **NOW, Phase 9** — B19/E17/L24 (FD-02) |
| Multi-stop | UNVERIFIED | Yes (2 stops) | UNVERIFIED | Yes (2 stops) | Yes | — | **NOW, Phase 9** — B18/E14/L26 (FD-02) |
| Pooling / shared seats | No | No | No | Partial (market-dependent) | No | PinkGo claims; Swvl/Airlift defunct | **LATER, Phase 11** — F01–F18/E15/E16 (ADR-014) |
| Women-only / women-preference | No | No | No | No | No | VSisters, SheDrives, PinkGo (small supply) | **LATER, Phase 11** — F08–F11/K21/M05 (ADR-009; counsel) |
| Intercity | Yes (200+ cities) | Partial (business) | No | Yes | No | Drivver (announced) | **LATER, Phase 12** — B21/E18/R32 |
| Delivery / courier / COD | Yes (courier, freight, groceries) | Yes (courier, parcel insurance) | Yes (parcel, COD) | Uber Connect | — | — | **LATER, Phase 12** — D23/R29/R30/S09 (FBR COD withholding, R6 §8) |
| Cash | Yes | Yes | Yes | Yes | Yes | Yes | **NOW** — O01/G01/M10 Phase 5; pilot cash-only |
| Card | Via balance top-up | Yes | UNVERIFIED | Yes | Yes | UNVERIFIED | **NOW, Phase 9** — O02/O03/O08 (fixed-fee economics may defer cards; FD-07) |
| JazzCash / Easypaisa | Yes | Unnamed wallet | Yes | — | — | Drivver planned | **NOW, Phase 9** — O04/O05 (ADR-022) |
| Raast P2M | UNVERIFIED (none evidenced) | UNVERIFIED | UNVERIFIED | — | — | — | **NOW, Phase 9** — O06 via regulated participant; potential cost advantage (R3 §2) |
| SOS / emergency | Yes | UNVERIFIED (PSCA 15 integration reported) | UNVERIFIED | Yes | Yes | PinkGo yes | **NOW, Phase 6** — C04/N10/N11; PSCA data-push is **EXTERNAL** (ADR-032) |
| Share trip | Yes | Partial | UNVERIFIED | Yes | Yes | PinkGo yes | **NOW, Phase 6** — C03/N01 |
| Pickup PIN | UNVERIFIED (absent locally) | UNVERIFIED | UNVERIFIED | Yes (4-digit; airport 6-digit) | — | — | **NOW, Phase 5** — C02/B10 (local differentiator) |
| Masked calls | Partial (driver→rider) | UNVERIFIED (claims masking) | UNVERIFIED | Yes | Yes | — | **NOW, Phase 6** — P02/C08; provider path is EXTERNAL (no confirmed Twilio PK path, R5 §6) |
| In-app chat | Yes | UNVERIFIED | UNVERIFIED | Yes | Yes | — | **NOW, Phase 6** — P01 |
| Trip audio recording | Yes (PK rollout) | UNVERIFIED | No | Yes | — | — | **LATER, Phase 12** — N07 (consent law: SC Mar 2026, R6 §5) |
| Low-data / Lite | No | Yes (Yango Lite) | UNVERIFIED | Partial | — | — | **NOW, Phase 3** — L08/Q26/Q27 (in-app Lite mode, not a second app; ADR-019) |
| Web booking | UNVERIFIED | Partial | No | Yes | — | — | **NOW, Phase 9** — L09/W09 |
| Call-centre booking | No | No | Yes | No | No | Paxi (hist.) | **NOW, Phase 9** — L10/R18/S26 |
| Driver app topology | ONE app, driver mode | Separate Yango Pro | Separate Partner app | Separate Driver app | Separate Captain app | UNVERIFIED | **Founder-locked ONE app** — V01–V14 (ADR-026) |
| Driver KYC | ID, licence, vehicle reg; ~24 h | Licence, docs, periodic selfie | CNIC, licence, selfie, training | Background check, ID selfies | — | ICT registration app; Punjab police certificate (R2 §A.5) | **NOW, Phase 2** — K02–K07/D02/R46 (police certificate, PSCA QR, 44B permits) |
| Per-trip accident insurance | EFU in-ride (R2 §F) | Waada free per-trip | Advertised | Yes | Yes | — | **EXTERNAL** — R04/N15/L22/T14 (insurer agreement before advertising) |
| Driver commission | 10–12.99% reported | 9.71%+VAT reported | ~20% reported | Varies | 15%/5% hist. | VSisters 10% | **EXTERNAL** — ADR-013/J08 founder decision after unit economics |
| Support channel | Chat/form only (reported long waits) | 24/7, 5-min urgent first contact (company-sourced) | Phone + app | In-app + phone | 24×7 call centre (hist.) | — | **NOW, Phase 6/8** — C06/C13/P07/N21; staffing is EXTERNAL (T23) |
| Safety regulatory baseline | PSCA QR panic button, police certificate | TNC licence (first), PSCA 15 integration | PSCA QR | — | — | — | **EXTERNAL + NOW** — R01/R46/R47; PSCA MoU ADR-032 |

## 2. App-topology evidence (verifies docs/16 ADR-026 and docs/28)

- **inDrive:** official PK install FAQ states ride-hailing, courier delivery and driver mode are "all in one app"; official driver help instructs "Driver mode" from the side menu; App Store listing id780125801 and Android package `sinet.startup.inDriver`; no separate driver package found. inDrive is the reported market leader (~60% share, reported). → The unified topology is proven at Pakistan scale.
- **Yango:** rider app `com.yandex.yango` (+ `com.yango.lite`), driver app `com.yango.driver` ("Yango Pro"), separate listings; drivers contract via fleet partners.
- **Bykea:** `com.bykea.pk` (customer) and `com.bykea.pk.partner` (partner).
- **Uber/Careem:** separate driver/captain apps (benchmark only).

**Conclusion:** topology remains a product decision; the founder-locked unified app stands (ADR-026). No contradiction found. The mitigations V01–V14 plus new D27/M26/Q49 remain required because inDrive's success does not transfer its engineering.

## 3. What changed since the v5 research snapshot (2026-10-09 refresh)

| Change | Effect on Wayvro |
|---|---|
| Punjab TNC operating licence regime reported live; press reports a named incumbent as first licensee (Mar 2026) — **SECONDARY_REPORT / NEEDS_OFFICIAL_RECONCILIATION** | R01 remains a hard external blocker; official requirements via counsel/authority; fee reported Rs 2 m/3 yr (UNVERIFIED) — budget item |
| Section 44B per-district, per-platform route permits (Jul 2026, enforcement unclear) | New R46; supply-shrinkage risk RSK-033; district-boundary dispatch check |
| Police character certificate mandatory for all ride-hailing drivers (May 2026) | New R46 artefact; onboarding step and cost (Rs 500) |
| PSCA QR panic button mandatory in Lahore (reported); a reported incumbent–PSCA 15 data-push integration (SECONDARY_REPORT) | R46 artefact; ADR-032 (PSCA MoU); never claim integration before signed/tested |
| FOSPAH notices to Yango/inDrive (Dec 2025) | New R47 governance kit |
| Fuel price shocks (Rs 253 → 415/L in 2026) and driver protests (Oct 2026) | New E20; commission waiver windows in G17; RSK-026 severity up |
| inDrive 80k+ accounts blocked over pre-payment courier scam (Feb 2026); fake-app robbery gang (Aug 2025) | W04 anti-impersonation, Q49 no-APK-on-web, abuse cases in `PHASE0_SECURITY_PRIVACY.md` |
| Islamabad mandatory driver registration app (Feb 2026) | R27 city-expansion checklist must include ICT registration — multi-city rules differ |
| Careem fully exited; Uber absent; Drivver announced (Jazz/iTecknologi) | Competitive window is inDrive/Yango/Bykea; a telco-backed entrant may arrive |

## 4. Unexplained gaps check (Phase 0 gate: "competitor coverage matrix has no unexplained gap")

Every capability observed at a competitor maps to a Wayvro requirement ID and disposition above. Capabilities deliberately **not** adopted at launch and the reason:
- Rider wallet / balance top-up (inDrive card-via-balance): rejected — SBP e-money boundary (R3 §1c; G16 hard stop).
- Always-on trip audio recording: deferred — consent law and privacy review (N07, ADR-021).
- Separate Lite app (Yango Lite): rejected — contradicts one-app topology; in-app Lite mode instead (L08, ADR-019).
- Fleet-partner-only driver contracting (Yango model): not adopted at launch — direct driver onboarding first; fleet model later (R34, Phase 12).
- Groceries/food (inDrive.Groceries): OUT_OF_SCOPE (R38).

## 5. Evidence quality notes
Google Play pages and bykea.com did not render for the research agent; Play facts rely on search snippets. Yango PK pages were partially stale (~1.5 years). Commission rates are all unofficial. These gaps are listed in the handoff report as research limitations; founder field walkthroughs (docs/01 evidence plan) remain required before launch claims.
