# Phase 0 research evidence R3 — Pakistan payment rails (observed 2026-10-09)

**Provenance:** produced by a Claude research subagent during Phase 0 using live web search/fetch (~60 searches). sbp.org.pk, easypaisa.com.pk and gopayfast.com block automated fetches, so several SBP circulars are cited via listing pages plus press. **Nothing here is legal/tax advice.** Every fee is "reported" unless from the provider's own page. Feeds ADR-008/ADR-022, `PHASE0_COST_PROVIDER_MATRIX.md`, `PHASE0_LAUNCH_BLOCKERS.md` and new requirement G17.

## 1. SBP licensing: what a marketplace needs (and doesn't)

**Three regulated buckets**
- **PSO/PSP** (PSO/PSP Rules, PSD Circular 3 of 2014, under the Payment Systems & EFT Act 2007): entities that operate payment systems or route/switch/process payments. Payment gateways (PayFast/APPS first commercially licensed May 2021; Paymob in-principle Nov 2024) sit here.
- **EMI** (Regulations for EMIs, PSP&OD Circular 3 of 2023, revised 21 Jun 2023): issuers of e-money ("monetary value represented by a claim on the issuer… accepted by parties other than the issuer"). Permissible activities include payment aggregation, payment initiation, escrow for domestic e-commerce (separate approval). Initial capital PKR 200m; customer funds in a trust account; no return on e-money. No exclusion for closed-loop instruments visible. [SBP EMI Regs PDF].
- **Bank/MFB merchant acquiring**: banks acquire card/QR/Raast P2M; PSP&OD Circular 02 of 2025 (25 Jul 2025) requires REs to give every merchant at least one digital acceptance solution incl. Raast QR by 31 Oct 2025.

**What this means for the marketplace (for counsel review)**
- (a) **Accepting rider digital payments via a licensed PSP/bank** → no SBP licence needed by the platform; it is a merchant/sub-merchant. PSP&OD Circular 04 of 2023 tells Raast Merchant Service Providers to onboard "merchants, aggregators, marketplaces and billers" — SBP contemplates marketplaces as acquired customers, not licensees.
- (b) **Collecting driver dues (commission)** → a receivable owed by the driver; collecting via RTP/IBFT/wallet into the platform's own account is ordinary B2B collection.
- (c) **Driver "balance/credit" as pure accounting** → the risk line is the EMI definition: redeemable value loaded by the driver/rider and usable to pay third parties looks like e-money. A ledger that only nets commission owed and incentives/digital-fare share owed, with no top-ups beyond dues, no cash-out-on-demand beyond what the platform owes, and no use as a payment instrument to others, is an ordinary payable/receivable. **Keep it that way: no rider wallet, no prepaid top-ups.**
- No SBP guidance specific to ride-hailing found. 2025 Karandaaz/SBP Raast onboarding initiative targets ride-hailing drivers as Raast QR merchants. inDrive "exploring possibilities with SBP" (2026) — exploratory only.

**2025–2026 circulars that matter**
- PSP&OD C01/2025 (21 Feb 2025) Raast Participation Criteria: corporates/business platforms/aggregators may apply indirectly via a DSP/DNSP; onboarding does not make them regulated.
- PSP&OD C02/2025 (25 Jul 2025) merchant facilitation; micro-merchant tier PKR 2m/month turnover.
- PSP&OD C03/2025 (23 Sep 2025) Raast P2M QR subsidy: PKR 3.5bn, 0.5% or Rs100 per txn, 1 Sep 2025–30 Jun 2026; REs may charge merchants up to 0.25%. **Extension beyond 30 Jun 2026: UNVERIFIED.**
- PSP&OD C04/2025 (3 Oct 2025) Technology Risk Management Framework for payment institutions.
- PSP&OD Circular Letter 01/2026 (3 Aug 2026): fuel-station card MDR cap — shows SBP's willingness to cap sector MDRs.
- Notification PSP&OD/DPS/443723/2026 dated 27 Aug 2026 exists on the Raast page; content UNVERIFIED. A Sep 2026 vendor article claims a "Unified Raast P2M interoperable QR standard" — UNVERIFIED.

## 2. Raast P2M
- **Flows (SBP C04/2023):** unified EMVCo QR (static/dynamic), Raast alias, IBAN push, Request-to-Pay (RTP Now / RTP Later); customers may initiate return/refund requests in-app; **customers may not be charged** for Raast payments.
- **How a business integrates:** via a bank (e.g. Bank Alfalah "Alfa Business"), via 1LINK's 1GO Raast P2M APIs (sandbox.1link.net.pk: P2M_RTP, P2M_QR, P2M_Merchant; pre-RTP alias/title fetch), or via a PSP/aggregator (Safepay "Raastwire", PayFast "Rah-e-Raast", NayaPay Arc, Kuickpay with JS Bank). Safepay aggregator API: create aggregator-merchants linked to a Raast merchant ID → KYB → RTP Now/Later, QR, payouts, signed webhooks.
- **Fees reported:** Bank Alfalah: MDR 0% on Raast QR. JazzCash business SOC Q1-2026: Raast QR/Till MDR 0.25%; Raast RTP 1%. Safepay 1.5%. NayaPay Arc 1.5%.
- **Settlement:** Raast is real-time gross; merchant payout per provider schedule (instant to T+1 reported).
- **Refunds:** SBP mandates in-app return requests; merchant-initiated refund API mechanics vary — UNVERIFIED. Raast pushes are irrevocable; refunds are a new credit.
- **Limits:** bank-set with a floor of Rs200,000/txn.

## 3. JazzCash (Mobilink Microfinance Bank)
- **Onboarding (sandbox portal):** free sandbox signup; go-live for a Pvt Ltd needs board resolution, MoA/AoA, incorporation cert, director CNICs, Form-A/B/29, account requisition, NTN. Timelines not published — UNVERIFIED.
- **Integration modes:** HTTP POST redirection; Hosted Checkout v1.1/v2.0; REST/SOAP Mobile Account API (`MWALLET`), Voucher/OTC API, Card API (Authorize, Capture, Void, Refund, Status Inquiry, 3DS Enrollment); `pp_Version` "1.1".
- **Security:** `pp_SecureHash` = HMAC-SHA256 keyed with merchant Shared Secret over sorted `pp_*` fields. Verification "recommended, not mandatory" — treat as mandatory, server-side. IPN webhook payload/verification not documented → always confirm with Status Inquiry.
- **Refund API:** `pp_TxnRefNo`, `pp_Amount` (minor units), PKR; partial amount sample shown.
- **Fees (Mobilink SOC):** Q2-2024 online gateway 2.32% blended. Q1-2026 business SOC: QR/Till 0.25%; merchant-account acceptance 1.25%; Raast RTP 1%; pay-via-link 3%; bulk C2C Rs10/txn; outgoing to bank free to Rs50k/month then 0.1% max Rs200.
- **Disbursement:** "MW Disbursement API v2.0" and "IBFT Disbursement API v2.0" reference docs exist (Scribd copies); official limits/pricing not public — UNVERIFIED.

## 4. Easypaisa (Telenor Microfinance Bank; Digital Retail Bank licence Jan 2025)
- Official gateway page (search snippet only; page 403s): no setup/annual fee; 1% (mobile account), 2% (OTC), taxes included; MA settlement daily; OTC 7 working days. **Treat rates as UNVERIFIED.**
- Integration: Merchant Integration Guide v4.1.2 (REST for MA/OTC; MA flow OTP/MPIN-approved in customer app), card via redirect; API Developer Portal (2021); Mini Apps inside Easypaisa (no public developer docs).
- Onboarding: application → KYC → Store ID + API creds + sandbox → production; timelines vary — UNVERIFIED. Disbursement: corporate bulk product; pricing/limits not public. Webhook security not documented → status inquiry/reconciliation required.

## 5. Card acquiring PSPs (online)
- **Stripe:** Pakistan not supported (stripe.com/global). **Adyen/Checkout.com:** no PK merchant onboarding evidence.
- **SBP context:** 3-D Secure mandated for e-commerce (2019; PSD CL 02/2021 2FA); POS MDR band 1.5–2.5%; no e-com MDR cap. Chargeback fee reported PKR 2,000–8,000; Safepay Rs3,000/dispute.

| Provider | Rails | Onboarding | Fees (reported) | API notes | Refund/dispute | Sandbox |
|---|---|---|---|---|---|---|
| **Safepay** (PSP) | Cards (Visa/MC/Amex), wallets (JazzCash/Easypaisa), Raast (QR, RTP, alias), payouts | Online; KYB same-day if Raast merchant exists | Cards 2.9%+Rs30 dom, wallets 1.5%, Raast 1.5%, standard payouts free, instant payouts 1.5%, dispute Rs3,000, tokenization incl. | Hosted checkout, components, SDKs, subscriptions, aggregator API, signed webhooks; best public docs | Refund API; dispute handled, fee | Yes |
| **PayFast / APPS** (first licensed gateway 2021; first Raast MSP) | Cards, bank accounts, wallets, Raast QR | 3–7 business days (blogs) | Not published; blogs 2.5–3.5% cards, 1.5–3% wallets; T+1/T+2 | Hosted + API | Not public | Yes |
| **Bank Alfalah APG** | Cards (3DS, tokenization), Raast P2M | Digital signup; corporates assisted | No setup; ~2–3% cards (blogs); Raast MDR 0% | Plugins; merchant portal | Yes (portal) | UNVERIFIED |
| **HBL IPG (CyberSource)** | Cards | HBL account → pricing → agreement | Negotiated | CyberSource APIs | Via bank | UNVERIFIED |
| **XPay (PostEx)** | Cards, wallets, bank transfer, COD | "30 minutes" (vendor claim) | Not published | Mobile SDKs, tokenization | Not public | UNVERIFIED |
| **NayaPay Arc** (EMI) | Cards online 2.99%+Rs30, Raast/QR/IBFT 1.5% | Free | As stated | Invoices/links; API not public | UNVERIFIED | UNVERIFIED |
| **SadaBiz** (EMI) | QR via PayFast | Free | Varies | No public API | UNVERIFIED | No |
| **Kuickpay** | Bill aggregation on 1LINK, Raast QR | Sales-led | Not published | Not public | UNVERIFIED | UNVERIFIED |
| **Paymob** | Cards, POS | In-principle PSO/PSP; commercial status UNVERIFIED | ~2.75% (blog) | Regional docs | UNVERIFIED | UNVERIFIED |
| **Simpaisa / Swich / ZarPay** (aggregators) | Wallets + IBFT + Raast collections and payouts | Days (claims) | Not published | Single API + file bulk | UNVERIFIED | Claimed |
| **1LINK 1GO** | Raast P2M only | Portal signup | Not published | Full REST spec | RTP cancel | Yes |

**Cards + wallets + Raast in one integration:** Safepay (documented), PayFast (claimed), likely Simpaisa/XPay (unverified).

## 6. Driver payouts
- **Rails:** wallet disbursement APIs (JazzCash MW Disbursement; Easypaisa corporate); IBFT via bank corporate portals/APIs or 1LINK; Raast bulk via a DSP; PSP payout endpoints (Safepay `/payout`, standard free).
- **Costs:** JazzCash bulk C2C Rs10/txn; outgoing to bank free to Rs50k/month then 0.1% max Rs200; corporate bulk pricing negotiated — UNVERIFIED.
- **Payee verification:** Raast title fetch exists (1LINK pre-RTP alias/title fetch); ask the PSP whether exposed.
- **Timing:** Raast/wallet instant; IBFT near-instant batch-settled; industry practice daily/weekly files, 24–72h, ~2–3% failures needing re-submission.

## 7. Tax — for accountant review
- **PRA:** ride-hailing/cab aggregators at reduced 5% (no input adjustment). Whether 5% applies to gross fare or platform commission, and whether the platform must charge it on commission to drivers, is **unresolved**. EIMS e-invoicing applicability UNVERIFIED.
- **FBR:** Finance Act 2025 s.6A/153(2A): payment intermediaries withhold 1% on digital payments and couriers 2% on COD for *digitally ordered goods* via online marketplaces; Sales Tax Circular 02 of 2025-26 defines "courier" to include "logistics and ride-hailing services" collecting cash for e-commerce *goods* — relevant if courier/delivery is added. Income-tax WHT on services (s.153) FY26: 15% general, 4% IT/ITeS, 6% specified; whether drivers are "service providers" subject to WHT by the platform needs an opinion.

## 8. Fraud / chargeback norms
- Cards: 3DS-authenticated transactions shift fraud liability to the issuer (general scheme rule); non-3DS CNP → merchant. Fee Rs2k–8k per dispute.
- Bank/wallet unauthorized transactions: BPRD Circular 04 of 2023 + PSP&OD Circular 01 of 2024 (effective 1 Jan 2025): banks/MFBs liable to compensate victims under a liability framework; wallet/IBFT credits not unilaterally reversible.
- Ride-hailing cash fraud reported: inDrive blocked 80,000+ accounts (Feb 2026) over a courier scam inducing riders to pay via JazzCash/Easypaisa before pickup; allegations that drivers take cash then mark rides cancelled — anecdotal.

## 9. Cost model (ESTIMATE, PKR 500 digital trip)

| Rail | Fee basis (reported) | Cost on Rs500 | % |
|---|---|---|---|
| Card via Safepay | 2.9% + Rs30 (+ tax on fee) | ~Rs45–52 | 9–10% |
| Card via bank gateway | ~2–3% negotiated, no fixed fee | ~Rs10–15 | 2–3% |
| JazzCash wallet | 1.5% (Safepay) / 2.32% (direct blended 2024) | Rs7.5–12 | 1.5–2.3% |
| Easypaisa wallet | 1% direct (unverified) / 1.5% via PSP | Rs5–7.5 | 1–1.5% |
| Raast QR/RTP | 0% (Alfalah) / 0.25% (JazzCash QR) / 1% (JazzCash RTP) / 1.5% (Safepay) | Rs0–7.5 | 0–1.5% |
| Driver payout (amortised) | Rs10 wallet bulk or free Raast; daily payout over ~10 trips | ~Rs0–1/trip | ≤0.2% |

**Takeaway:** at a Rs500 ticket, a fixed Rs30 card fee is ruinous; push Raast/wallets, keep cards for higher-value/corporate trips or negotiate a no-fixed-fee bank MDR. Blended digital cost target ~1–2% if Raast-heavy.

## Decisions the founder/accountant must make
1. Legal opinion that the driver ledger is a receivable/payable, not e-money; written policy: no top-ups beyond dues, no rider wallet, no balance transfers.
2. One PSP for cards+wallets+Raast (Safepay or PayFast) vs. direct JazzCash/Easypaisa + bank Raast.
3. Whether to offer cards at all at launch given fixed-fee economics.
4. Commission collection design: RTP-Later request to driver, auto-net from digital fares, cash-deposit via Raast QR, or combination; cut-off/suspension rules.
5. Payout rail and cadence; payee title verification requirement.
6. Who bears PRA 5% and PRA/EIMS registration — accountant.
7. Whether platform must withhold anything from driver payouts (s.153) and contractor documentation — accountant.
8. Refund policy for Raast (irrevocable) vs. card (chargeback window); dispute fee pass-through.
9. Confirm Raast subsidy status post-Jun 2026 and the Aug 2026 PSP&OD notification contents before pricing Raast at 0%.
10. Fraud controls: cash-trip completion confirmation, in-app "paid in cash" attestation, courier-style pre-payment ban, device/ID checks.

## Sources (observed 2026-10-09)
SBP: https://www.sbp.org.pk/psd/2023/C4.htm · https://www.sbp.org.pk/psd/2025/C2.htm · https://www.sbp.org.pk/psd/2025/c3.htm · https://www.sbp.org.pk/circulars/pspod-circular-no-01-of-2025 · https://www.sbp.org.pk/circulars/pspod-circular-no-01-of-2024 · https://www.sbp.org.pk/bprd/2023/C4.htm · https://www.sbp.org.pk/dfs/Raast.html · EMI Regulations https://www.sbp.org.pk/assets/documents/circulars/psd/2023/C3-Enclosure-Regulations-EMIs.pdf · PSO/PSP list https://www.sbp.org.pk/PS/PDF/List-PSOs-PSPs.pdf. Raast P2M coverage: tradechronicle.com (2023-12-06); propakistani 2025-02-23; profit.pakistantoday 2025-07-26; brecorder 40384460; brecorder 40161305; 1LINK sandbox https://sandbox.1link.net.pk/uat-1link/sandbox/product/7270; Bank Alfalah https://www.bankalfalah.com/business-banking/retail-payment-solution/raast-p2m-qr/. Safepay: https://getsafepay.pk/pricing; https://safepay.mintlify.app/guides/raast-integration-journey. JazzCash: https://sandbox.jazzcash.com.pk/SandboxDocumentation/index.html; https://mobilinkbank.com/assets/documents/SOC_Q1_2026.pdf. Easypaisa: https://easypaisa.com.pk/online-payment-gateway/ (403); propakistani 2021-05-24; simpaisa.com guide 2026-05-15. PayFast: propakistani 2021-05-25, 2025-12-24. Paymob: SBP press 2024-11-05. NayaPay: help.nayapay.com. XPay: https://xpay.postexglobal.com/. HBL IPG FAQs. Stripe: https://stripe.com/global. Payouts: simpaisa.com blogs 2026-07-29, 2026-06-10; swichnow.io. Tax: tribune 2243361; EY 2023-1638; conseric.pk 2026-07-14; FBR Circulars 02 (ST) and 01 (IT) of 2025-26; propakistani 2026-02-11; brecorder 40376952. Fraud: pakobserver; munaeem.org 2026-09; propakistani 2026-02-18; thenews 1332064. Legal commentary: courtingthelaw.com 2021-11-03; mondaq 707688.

**Open gaps:** full text of PSP&OD C04/2023 and C02/2025, PSO/PSP Rules definitions, Raast merchant-refund API mechanics, Easypaisa official rate page, JazzCash/Easypaisa disbursement pricing and limits, PRA Second Schedule primary text, subsidy extension status.
