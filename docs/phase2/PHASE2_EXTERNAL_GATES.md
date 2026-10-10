# PHASE2_EXTERNAL_GATES — What code cannot approve (PROPOSED)

**Date:** 2026-10-10 (planning closure correction applied the same day; Phase 2 scope now 55 IDs incl. A15) · **Status:** Phase 2 PLAN ONLY. Builds on `docs/phase0/PHASE0_LAUNCH_BLOCKERS.md` (A1–F6) and `docs/22_LAUNCH_BLOCKERS_AND_EXTERNAL_DEPENDENCIES.md`. **An interface, mock, placeholder or passing local test never satisfies an EXTERNAL_GATED requirement.** Claude cannot obtain any of this evidence.

## 1. Status vocabulary used across the Phase 2 plan

| Status | Meaning | Reportable at Phase 2 exit as |
|---|---|---|
| `IMPLEMENTABLE_NOW` | fully buildable and verifiable with synthetic data and local infrastructure | SATISFIED (Phase 2 scope) once tests pass |
| `NOW + GATED_ACTIVATION` | engineering is completed now; real-world use needs external evidence | ENGINEERING COMPLETE — **NOT SATISFIED** until the gate evidence is attached |
| `EXTERNAL_GATED` | the requirement itself is an external decision/deliverable | BLOCKED_EXTERNAL (inputs prepared by Claude) |
| `DESIGN_NOW_ACTIVATE_LATER` | contract/design documented; code deliberately not written until activation (avoids dead code) | DESIGNED — NOT IMPLEMENTED |

## 2. Gate register

| Gate | What is needed | Owner | Blocks (IDs) | Phase 2 work possible without it | Earliest needed | Related Phase 0 blocker |
|---|---|---|---|---|---|---|
| **EG-01** OTP/SMS vendor contract (+ PTA sender mask, MNO registrations, WhatsApp BSP authentication template) | signed contract(s), sandbox/production credentials in managed secrets, delivery metrics, per-OTP cost, rate/abuse terms | Founder/ops | A03, K08 (delivery), K22, A11/K17 (SMS notices) | full OTP domain, limits, budget logic, outage behaviour with the local recording sink — **the sink is a development/test mechanism and never evidence toward this gate** | before any real user (Phase 7); sandbox earlier if available | D1, A1, A2 |
| **EG-02** Counsel-approved texts: Terms, Privacy Notice, Driver/Partner Agreement, Biometric/KYC notice, Community Guidelines, consent wording, deletion/retention explanation | approved text per locale, version, effective date | Counsel | A04, R09, K14, W05, U06 (disclosure wording) | versioning, acceptance proof, re-consent, web publication with placeholders marked NOT FOR PRODUCTION | before real users | — (W05/R09 blockers) |
| **EG-03** Current Punjab driver/vehicle/document matrix incl. the unread 19-Feb-2026 TNC Safety & Security Protocols | written counsel matrix per city/category/ownership type | Counsel | K06, D02, R02–R06, R46 | configurable requirement sets; placeholder `LHR/CAR v0` | before Phase 2 design freeze for real data (RSK-034); hard before Phase 8 | B2, B6, B7 |
| **EG-04** Route-permit (44B), fitness (VICS), insurance (MIR-linked), token tax, police character certificate, PSCA QR, licence/training/background requirements | instruments, procedures, scope (incl. motorcycles), fees | Counsel/ops | R02, R03, R04, R05, R06, R46 (and N28 Phase 8) | data model + review checklist items | Phase 8 | B3, B4, B5, B6, B7 |
| **EG-05** Production object storage + KMS + malware-scanning and image-sanitiser hosting | provider choice (R2 candidate), bucket policies, lifecycle, KMS/KEK custody (field keys, lookup keys, evidence KEK), scanner and isolated sanitiser hosting, external audit-seal anchor location | Founder (+Claude ADR) | K11, Q08, Q39 (anchoring), Q44 | full vault on SeaweedFS + local key + ClamAV container | before real evidence (Phase 7) | D8, ADR-010/028 |
| **EG-06** Google Cloud OAuth project | project, consent screen, Android/iOS/web client ids, verified domain | Founder | K15 | server verification + linking with synthetic keys | when founder chooses to activate | — |
| **EG-07** Apple Developer Program + Sign in with Apple configuration | org account (D-U-N-S), Services ID/key, server-to-server notification endpoint, token revocation key | Founder | K16 (and iOS store rule 4.8 if Google ships on iOS) | server verification + linking with synthetic keys | iOS release (Phase 7/9) | E2 |
| **EG-08** Vetted automated liveness provider | evaluation, contract | Founder + privacy counsel | K03 (automated part only) | none (manual path is canonical) | optional | D5 |
| **EG-09** Vetted face-to-ID provider | evaluation, contract | Founder + privacy counsel | K04 (automated part only) | none (manual comparison is canonical) | optional | D5 |
| **EG-10** Biometric/KYC DPIA | qualified DPIA covering necessity, alternatives, bias/error, retention, vendor access, breach, appeals | Privacy counsel | Q45; **gates any real CNIC/selfie capture** | DPIA input pack (vault doc §10) | before any non-synthetic KYC data | C1 |
| **EG-11** Provider DPAs/contracts and vendor risk entries | DPAs, sub-processor lists, exit plans for OTP, storage, KMS, (optional) KYC vendors, Google/Apple terms | Founder + counsel | K22, Q43 (Phase 7) | evaluation criteria (§4) | before each provider's production use | D1, D5 |
| **EG-12** Pakistan data-location / cross-border review | counsel opinion on hosting region (FD-03 Singapore provisional), KYC/biometric/location localisation, PDP Bill watch | Counsel | Q44 | inventory (vault doc §10), migratable adapters | before real data (Phase 7) | C2, FD-03 |
| **EG-13** NADRA access (Nishan Pakistan) — optional | eligibility ruling, agreement, tariff | Founder | none in Phase 2 (never claimed) | none — no NADRA code, wording or field | optional | C4 |
| **EG-14** Company incorporation, NTN | certificate, NTN | Founder + counsel/accountant | EG-01, EG-06/07 (org accounts), EG-11 | none needed for engineering | before vendor registrations | A1, A2 |
| **EG-15** Brand/domain clearance and public domain | registered domain, DNS custody | Founder + IP counsel | W05 canonical URLs, U06 web deletion URL, WebAuthn RP ID for production web-ops, OIDC redirect/verified domains | local/test hostnames | before public pages/store listing | A5 |
| **EG-16** Counsel-approved retention matrix | durations per data class, legal-hold rules, lawful-basis for fraud/safety/financial retention after deletion | Counsel | U06, K11 (deletion), Q24 (Phase 6), A10/Q47 (Phase 9) | configurable retention with `NOT_COUNSEL_APPROVED` placeholders | before real data | Q24 |
| **EG-17** Independent penetration test / security assessment | report + remediation + retest | External tester | real-user exposure of auth/KYC/admin (U01, Phase 7 gate) | adversarial suite K13 (self-test, not independent) | Phase 7 exit | F5 |
| **EG-18** Store accounts, data-safety/privacy declarations, account-deletion URL submission | Play/App Store accounts and approved declarations | Founder | U06 (store disclosure), V01 (single listing), V14 (Phase 9) | in-app + web deletion paths; draft declaration notes | Phase 7/9 | E1–E3 |
| **EG-19** Company IdP for staff SSO (optional) | Google Workspace/Entra tenant, MFA policy | Founder | H01 "SSO" clause (federation only) | WebAuthn-native staff auth | when staff > founder | — |
| **EG-20** KYC operations: qualified reviewers, in-person verification capacity, reviewer training, staffing for maker-checker | named staff, SOPs, location | Founder/ops | K02/K05/H02 operation at real scale; two-person controls | full tooling | Phase 8 | F2 |
| **EG-21** Alerting/on-call channel | paging/notification destination for break-glass and security alerts | Founder (+I07 Phase 4) | H08 alert delivery | structured alert events + web-ops banner | Phase 4/7 | — |
| **EG-22** Operator SIM-swap/recycling information | PTA/MNO recycling period; any SIM-swap API | Founder/counsel | S12/K08 tuning (heuristics work without it) | heuristic controls; the 90-day dormancy value is a **provisional local/test design threshold**, not a PTA/MNO rule (founder Q-07) | before pilot tuning | — (UNVERIFIED in R2/R5) |
| **EG-23** Age and guardian eligibility policy (A15) | qualified counsel/product decision on rider and driver age thresholds, the minimum declaration/evidence needed, guardian rules and under-age handling | Counsel + founder | A15 | policy-versioned declaration mechanism with **no hard-coded threshold**; placeholder policy only in local/test/staging; driver DOB reviewer check | before real users | — |

## 3. Classification of every Phase 2 requirement against the gates

| Status | IDs |
|---|---|
| `IMPLEMENTABLE_NOW` (21) | A02, A05, A11, D01, D04, H02, H08, K01, K05, K07, K09, K10, K13, K17, Q01, Q36, Q39, V02\*, V07\*, V13\*, W07\* |
| `NOW + GATED_ACTIVATION` (31) | A03 (EG-01), A04 (EG-02), A15 (EG-23), D02 (EG-03), D03 (EG-03; EG-10 for real data), H01 (EG-19 for the SSO-federation clause; RBAC/MFA now), K02 (EG-10, EG-20), K03 (manual path now; automated part EG-08/10/11), K04 (manual comparison now; automated part EG-09/10/11), K06 (EG-03), K08 (EG-01, EG-22), K11 (EG-05, EG-16), K14 (EG-02), K15 (EG-06), K16 (EG-07), Q06 (vendor-side caps EG-01), Q08 (EG-05), Q42 (production device/network controls with hosting), R02 (EG-04), R03 (EG-04), R04 (EG-04), R05 (EG-03), R06 (EG-04), R09 (EG-02), R46 (EG-03/04), S12 (EG-22 tuning), S13 (EG-06/07 for production OIDC collisions), U06 (EG-02, EG-16, EG-18), V01 (EG-18 store identity), V03 (EG-10/EG-20 for real onboarding), W05 (EG-02, EG-15) |
| `EXTERNAL_GATED` (3) | K22 (EG-11), Q44 (EG-12), Q45 (EG-10) |
| `DESIGN_NOW_ACTIVATE_LATER` (components, not whole IDs) | automated liveness/face-match signal integration (K03/K04 → P2.A5), staff SSO federation (H01 → P2.A6), e-mail contact channel (A02/A05 clarification, founder Q-03), external audit-seal anchoring (Q39), Android SMS Retriever (A03), Apple server-to-server notifications/token revocation (K16 → P2.A3) |

Counts: 21 + 31 + 3 = **55** (the verified 54 plus A15, added in the Phase 2 planning closure). \* No external blocker, but the Phase 2 slice is bounded: V02/V07/V13 are re-verified when later-phase data classes and consumers (trips, earnings, presence — Phases 4–6) arrive, and W07's production network controls arrive with hosting (Phase 7). Partial-scope items whose remaining slice belongs to a later phase (Q06 fare/driver-abuse surfaces, R04 incident linkage, R46 dispatch district check) are recorded as clarifications in `docs/phase2/PHASE2_PLAN.md` §8.

## 4. Vendor evaluation template (K22 — for the founder; Claude prepares, does not decide)

For each OTP/SMS, WhatsApp BSP, storage, KMS and (optional) KYC vendor: Pakistan coverage and delivery metrics (per MNO, sender-mask behaviour — Telenor/Ufone overwrite to shortcode per R5), published and negotiated pricing (per message/check, minimums), rate limits and burst behaviour, anti-pumping features (country/prefix allowlists, velocity caps, fraud scoring), data processed and retention, hosting region and sub-processors, DPA availability, security certifications and incident history, webhook signing and replay protection, SLA and support, outage history and failover options, API stability/versioning, exit plan (data export, number portability of sender ids), and contract term. Evidence links and access dates are mandatory; secondary reports are labelled SECONDARY_REPORT.

## 5. Activation micro-phases (each a separate, bounded, founder-authorised change)

| Activation | Prerequisite gates | Work | Exit evidence |
|---|---|---|---|
| P2.A1 OTP/SMS (+WhatsApp fallback, SMS Retriever) | EG-01, EG-11, EG-14 | real `OtpDeliveryPort` adapter(s) in `packages/provider-adapters/*`, signed delivery-receipt webhook, vendor-side caps, SMS Retriever template | sandbox + production smoke with founder-owned numbers only (no customer data), cost dashboards |
| P2.A2 Google sign-in | EG-06, EG-15 | mobile SDK + client ids; flag ON per environment | real-provider integration test; collision tests rerun |
| P2.A3 Sign in with Apple | EG-07, EG-15 | mobile SDK, S2S notifications endpoint, token revocation on deletion | real-provider integration test; App Review notes |
| P2.A4 Production storage + KMS + scanner | EG-05, EG-11, EG-12 | real `ObjectStoragePort` + `KeyProvider` adapters; presign checksum re-verification (ADR-010 finding); seal anchoring | restore/re-wrap drill; access-policy tests against the real provider |
| P2.A5 Automated liveness/face-to-ID (optional) | EG-08/09, EG-10, EG-11, EG-12 | advisory-signal integration (vault doc §9) | measured error rates; DPIA conditions met; manual path unchanged |
| P2.A6 Staff SSO federation (optional) | EG-19 | OIDC federation for staff + WebAuthn step-up retained | matrix suite rerun |
| P2.A7 Approved legal texts | EG-02, EG-15 | replace placeholders; re-consent where material | production boot check passes without placeholders |
| P2.A8 Approved Punjab requirement set | EG-03, EG-04 | approved `LHR/CAR v1` with source references | reviewer checklist updated; placeholder set retired |
| P2.A9 Approved age and guardian policy | EG-23, EG-02 | approved policy version entered by `COMPLIANCE_ADMIN` with maker-checker; published explanation | production boot check passes without the placeholder policy; declaration UI matches the approved mode |
