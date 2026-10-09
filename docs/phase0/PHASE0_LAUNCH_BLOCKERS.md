# PHASE0_LAUNCH_BLOCKERS — External legal, vendor and human prerequisites

**Date:** 2026-10-09 · **Status:** Phase 0 deliverable (plan-only). Extends `docs/22_LAUNCH_BLOCKERS_AND_EXTERNAL_DEPENDENCIES.md` with current sourced evidence (R2/R3/R4/R6). **Claude output is not legal, tax, insurance or regulatory approval (R12).** A feature may be fully coded and still `BLOCKED_EXTERNAL`; the app hides/disables it until evidence is attached to the register (`release_gate`).

Legend — **Gate:** earliest phase whose exit requires the evidence. **Owner:** who must obtain it (Claude cannot). **Status:** as of 2026-10-09.

## A. Company and governance (gates Phase 2 vendor registrations and Phase 8 pilot)

| # | Blocker | Why it blocks | Evidence required | Owner | Gate | Status |
|---|---|---|---|---|---|---|
| A1 | SECP incorporation — **founder-approved to start now, in parallel with engineering (FD-10)**. Form: if the founder is the sole member, evaluate a **Single Member Company (SMC)**; an ordinary private limited company needs an appropriate multi-member structure; no nominee shareholder/co-founder is invented; final choice by founder + Pakistani corporate counsel/accountant | Needed for NTN, PRA, SMS sender mask, PSP KYB, Play/Apple organisation accounts (D-U-N-S), TNC licence application | Certificate of incorporation, constitutional documents | Founder + counsel/accountant | Before Phase 2 vendor registrations; hard before Phase 8 | Started per FD-10 (form OPEN; R08) |
| A2 | NTN / FBR registration; PRA registration for Punjab services | Tax invoices, withholding, 5 % PRA on ride-hailing services (base unresolved) | Registrations + accountant opinion on PRA base and FBR s.6A/153 applicability to fares/driver payouts | Accountant | Phase 8 | Open (T09/O20) |
| A3 | Company bank account and merchant onboarding | Receive digital fares, pay drivers | Bank account; PSP merchant agreement | Founder | Phase 9 (digital payments); Phase 8 for cash commission collection | Open (J05) |
| A4 | IP chain / cap table / founder agreements | Fundraising and contracting | Signed IP assignment, share register | Founder + counsel | Phase 8 | Open (T01/T02) |
| A5 | Brand clearance "Wayvro" | Store listing, domain, trademark | SECP name reservation, IPO Pakistan search (classes 9/39/42) with conflict review vs "Wayvero/Wayvr/Wayro", wayvro.com/.pk registrar status (DNS did not resolve on 2026-10-09 — registrar status UNVERIFIED) | Founder + IP counsel | Phase 9; domain before Phase 2 (legal pages W05) | Open (ADR-001/R21) |

## B. Transport regulation — Punjab (gates Phase 8 pilot)

| # | Blocker | Evidence required | Owner | Gate | Status |
|---|---|---|---|---|---|
| B1 | **PTA-Punjab TNC operating licence** (reported basis: MVO 1965 s.72-H via a search snippet; incumbent licence status reported in press is **SECONDARY_REPORT / NEEDS_OFFICIAL_RECONCILIATION** against the official Punjab Transport Department register) | Official licence requirements confirmed by counsel/authority: gazetted Provincial Motor Vehicles (Amendment) Act 2025 + Sixteenth Schedule fee (reported Rs 2 m/3 yr, UNVERIFIED); application with incorporation docs, safety protocol commitment, complaints mechanism | Counsel + founder | Phase 8 (no real rides without it) | Not started (R01) |
| B2 | **TNC Safety & Security Protocols notification (19 Feb 2026)** — scanned PDF, unread | Counsel reads/OCRs the notification; list of mandatory features (panic button, GPS, data sharing, recording, verification standards, women-only rules) fed back into requirements | Counsel | Phase 2 (affects design) / Phase 8 | Not read — **highest-priority document** |
| B3 | **Section 44B per-district, per-platform vehicle route permits** (reported Jul 2026) | Instrument text, effective date, fee, motorcycle scope, enforcement status | Counsel | Phase 8 | Reported, UNVERIFIED (R46; RSK-033) |
| B4 | **Police character certificate** for every driver (May 2026 government–TNC agreement) | Copy of the agreement; process at Police Khidmat Markaz (Rs 500, ~3 days) | Counsel/ops | Phase 8 | Terms unknown (R46) |
| B5 | **PSCA QR panic button** (mandatory in Lahore from Jul 2026), GPS tracker and dashcam phases | CTO Lahore written standard; PSCA portal process | Ops | Phase 8 | Standard unpublished (R46) |
| B6 | Vehicle fitness (VICS), token tax, commercial registration question, third-party insurance (MIR-linked permit checks from Apr 2026) | Excise/PTA-Punjab ruling on commercial registration for ride-hailing cars; document matrix | Counsel | Phase 8 | Open (R02–R06) |
| B7 | Driver licence category (LTV vs PSV), motorcycle licence for bike-taxi; bike-taxi and rickshaw legality, permits, insurance and helmet/pillion rules | **Written legal/permit/insurance position per category** — bike/rickshaw stay disabled and unadvertised in Phase 9 until it exists | Counsel | Phase 9 (B15, FD-02) | Open |
| B8 | Islamabad/Sindh differences (ICT mandatory driver registration app, Sindh insurance act) | Per-city checklist before any expansion | Counsel | Phase 12 | Noted (R27) |

## C. Privacy, identity and safety (gates Phase 2 KYC and Phase 8)

| # | Blocker | Evidence required | Owner | Gate | Status |
|---|---|---|---|---|---|
| C1 | Biometric/KYC privacy impact assessment (Q45) | Qualified DPIA covering necessity, alternatives, bias/error, retention, vendor access, breach response, appeals | Privacy counsel | Phase 2 exit (before any real CNIC/selfie capture) | Open |
| C2 | Personal Data Protection Bill — **not enacted** (2023/2025 drafts) | Counsel watch; design to draft (consent, localisation readiness, 72-h breach) | Counsel | Continuous (T25) | Monitoring |
| C3 | PECA 2025 / SMPRA enlistment exposure (chat/ratings may fall under "social media platform") | Legal opinion | Counsel | Phase 9 | Open |
| C4 | NADRA access via **Nishan Pakistan** (eligibility for a TNC licensee UNVERIFIED; fees unpublished) | Eligibility ruling + tariff; otherwise manual/human document review stays canonical (FD-06) | Founder | Optional; never claim NADRA integration/verification without actual authorised access | Unknown (K22/ADR-017) |
| C5 | Lawful-request process for police/NCCIA/regulator data requests (N14/R07) | Counsel-defined workflow | Counsel | Phase 6 | Open |
| C6 | Audio/dashcam recording policy (SC ruling Mar 2026 on covert recording) | Legal opinion before N07/N08/M25 activation | Counsel | Phase 12 | Open (ADR-021) |
| C7 | Women-focused eligibility and inclusion/edge-case policy — explicit consent-based, privacy-minimised policy with qualified human review, fallback and appeal; **no algorithmic gender inference from face/selfie/name/CNIC number/photo or any proxy**; any check of an attribute explicitly present on an authoritative document only for a counsel-approved limited purpose | Counsel-reviewed policy + supply threshold | Counsel + founder | Phase 11 | EXTERNAL_DECISION (ADR-009, CL-17) |
| C8 | PSCA Emergency-15 data-push integration | Signed MoU + tested integration; until then dialer-based "Call 15" + trip share only | Founder/ops | Optional before Phase 9 | Not started (ADR-032) |
| C9 | FOSPAH / Workplace Harassment Act 2010 applicability and inquiry committee | Counsel confirmation; committee constituted | Counsel/founder | Phase 6/8 | Open (R47) |

## D. Vendors and commercial (gates Phase 2/4/9)

| # | Blocker | Evidence required | Owner | Gate | Status |
|---|---|---|---|---|---|
| D1 | OTP/SMS: PTA sender-ID mask + 4 MNO registrations (needs A1/A2; 2–4 weeks) and a WhatsApp Business authentication template via a BSP | Signed gateway contract, delivery metrics, cost per OTP | Founder/ops | Phase 7 (real users) | Not started (ADR-007) |
| D2 | Maps/routing licence and Lahore accuracy field test (SP-04) | Provider terms; 50-route field benchmark results | Founder + Claude spike | Phase 3 | Not started (ADR-006) |
| D3 | PSP/merchant: Safepay or PayFast (cards+wallets+Raast) or direct JazzCash/Easypaisa + bank Raast; counsel/accountant review confirming the internal driver earnings/settlement ledger is operational accounting data (not e-money) and deciding statutory classification and principal-vs-agent treatment (CL-20) | **At least one contracted regulated digital-payment path** (FD-07), sandbox proof, written opinion | Founder/counsel/accountant | Phase 9 | Not started (ADR-008/022; G17) |
| D4 | Payout rail (JazzCash bulk, Raast via bank, PSP payouts) with payee title verification | Contract + test payouts | Founder | Phase 9 | Not started (D18/G12) |
| D5 | KYC boundary (FD-06): no in-house face/liveness ML; pilot uses guided capture + human/manual review; an **optional** vetted liveness/face-to-ID provider only after DPIA, accuracy/bias/privacy review, contract/DPA and fallback/appeal | Documented manual process (pilot) or vendor contract + DPIA | Founder | Phase 2 | Open (K22) |
| D6 | Insurance/takaful: third-party cover per vehicle (checked at permit) + group per-trip personal-accident policy (EFU/Waada precedent) | Insurer quotes and policy wording; marketing claims limited to actual cover | Founder/broker | Phase 8 | Open (R04/T14/L22) |
| D7 | Masked-call provider (PK DIDs via LDI-licensed CPaaS) or in-app VoIP only | Contract or decision to ship VoIP-only | Founder | Phase 6 | Open (P02) |
| D8 | Production hosting (always-on, non-hobby), domain/DNS custody, backups | Accounts in company custody; restore test | Founder | Phase 7 | Not started (I08/Q16/T06) |

## E. Store and release (gates Phase 7–9)

| # | Blocker | Evidence required | Owner | Gate | Status |
|---|---|---|---|---|---|
| E1 | Google Play organisation account ($25) with D-U-N-S; Android developer verification (global 2027) | Account, verified identity | Founder | Phase 7 | Not started |
| E2 | Apple Developer Program organisation ($99/yr) with D-U-N-S; **App Store Connect production submission/release** after TestFlight internal/external testing (Q49) | Account; review package | Founder | Phase 7 (TestFlight) / Phase 9 (App Store production) | Not started |
| E3 | Play background-location declaration (one feature: driver live trip tracking), FGS location type declaration with demo videos, Data safety form, account-deletion URL | Approved declarations | Founder + Claude | Phase 9 | Not started (V14/U17) |
| E4 | **Dated policy deadlines:** target API 36 since 2026-08-31; fine-location declaration form (Nov 2026) and location-button/contacts changes effective 2027-01-27; 16 KB page size enforced 2027-02-01; geofencing removed from location-FGS use cases 2027-01-27 | Compliance evidence in release checklist | Claude + founder | Every release | Tracked (U16) |
| E5 | Apple: Sign in with Apple required if Google login offered; privacy manifest; age rating questionnaire; Xcode 26 uploads | Review package | Claude + founder | Phase 9 | Tracked |
| E6 | **Staged** test-device procurement (FD-13): start with available/borrowed real devices + emulators; acquire representative physical Android devices progressively before background-location/device-matrix gates; cover Samsung, Xiaomi and Transsion (Tecno/Infinix)/Vivo classes before production release; at least one real iPhone before serious iOS release/pilot validation | Real-device evidence (emulator-only results cannot close real-device gates) | Founder | Before SP-01/SP-02 (Phase 3 freeze) and release matrix | Staged (Q27) |

## F. Human operations (gates Phase 6–8)

| # | Blocker | Evidence required | Owner | Gate | Status |
|---|---|---|---|---|---|
| F1 | Safety escalation roster and urgent-lane staffing (market benchmark: one competitor claims 24/7 with 5-min first contact — company-sourced, SECONDARY_REPORT) — no 24/7 claim until staffed | Roster, drills passed | Founder | Phase 6/8 | Open (C06/N21/T23) |
| F2 | Driver vetting/field centre capacity (original document inspection, bike/vehicle inspection) | SOPs, trained staff, centre decision | Founder | Phase 8 | Open (R14/M24/T17) |
| F3 | Customer support, finance reconciliation and incident ownership | Named owners, SOPs | Founder | Phase 8 | Open (R15/T08) |
| F4 | Field interviews / usability sessions (docs/12 Phase 0 item Claude cannot perform) | Interview notes, usability findings | Founder | Before Phase 8 marketing | Not started (J07) |
| F5 | Independent penetration test and qualified security/privacy/transport reviews | Reports with critical findings remediated | External | Phase 7 exit | Not started (U01) |
| F6 | Driver supply density and unit economics for the pilot zone | Measured supply, contribution model | Founder | Phase 8 exit | Not started (RSK-001/016) |

## G. Blockers that are also **design inputs now** (must not wait)
- B2 (TNC safety protocols) and B3 (44B) can change the driver/vehicle data model → R46 is dispositioned NOW for Phase 2 with configurable artefacts.
- A1 is the critical path for D1 (SMS mask), D3 (PSP KYB), E1/E2 (D-U-N-S): **started per FD-10**; the entity form (SMC vs multi-member private limited) is decided with counsel and does not block engineering.
- No implementation is hard-coded from news reporting: incumbent-specific licence/permit facts are SECONDARY_REPORT / NEEDS_OFFICIAL_RECONCILIATION until confirmed by the authority or counsel (CL-21).
- C1 (DPIA) must precede any real CNIC/selfie capture, i.e. before Phase 2 is tested with non-synthetic data.
