# PHASE0_GAP_REPORT — New gaps, duplicates, contradictions and dispositions

**Date:** 2026-10-09 · **Status:** Phase 0 deliverable (plan-only) · **Inputs:** complete read of the v5 pack (36 manifest files + 3 root duplicates), `docs/requirements-register.json` (511 IDs), six sourced research streams (`docs/phase0/research/R1–R6`), and the founder's Phase 0 kickoff instruction. **Output:** 20 new requirement IDs (511 → 531), 22 clarifications (CL-19..22 added in the founder-review closure pass), 13 duplicates mapped, 12 contradictions resolved, 14 founder decisions **recorded in the closure pass of 2026-10-09** (§7; see `PHASE0_CLOSURE_HANDOFF.md`). Every change is traceable via `docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json` and the `phase0` block in the register (schema 5.1). **Nothing was deleted, renamed or re-prioritised silently**; priority/phase conflicts are escalated as founder decisions.

## 1. Disposition summary (all 531 IDs)

| Disposition | Count | Meaning |
|---|---|---|
| NOW | 395 | buildable by Claude inside Phases 1–10 roadmap (some with external blockers attached) |
| LATER | 107 | Phases 11–12 verticals / P2–P3 architecture-aware items; not committed for day one |
| EXTERNAL_DECISION | 26 | requires counsel/accountant/vendor/founder/human-ops evidence (J02–J05, J07, J08, G16, K22, N21, N28, Q45, R01, R08, R12, R14, R15, R21, T01, T02, T04, T08, T09, T14, T23, U01, U02) |
| OUT_OF_SCOPE | 3 | H19 franchise/white-label, L21 teen program (disabled by its own text), R38 food/grocery marketplace |

By priority: P0 216 · P1 209 · P2 89 · P3 17. By target phase: see coverage JSON `summary.by_phase`. 76 IDs carry an explicit external blocker.

## 2. New requirements added (GAP-xx → ID) — all PROPOSED pending founder review

| GAP | New ID | P | Title (short) | Source | Phase | Impact (sec/priv/safety/fin) |
|---|---|---|---|---|---|---|
| GAP-01 | **B26** | P1 | Pre-request supply visibility (anonymised nearby drivers/ETA) | competitor parity R1; driver-location privacy E10 | 4 | privacy (driver positions), scraping |
| GAP-02 | **D26** | P0 | Vehicle single-active-driver invariant + plate-level restrictions | R6 §5b vehicle-level bans; shift drivers D21/M16 | 4 | safety, fraud |
| GAP-03 | **D27** | P0 | Single active Driver-mode session per account (displacement rules, FGS bound to session) | account-sharing N02/K07; V06 | 4 | security, safety |
| GAP-04 | **G17** | P0 | Driver dues policy (dues tracked in operational settlement ledger, cap, grace, reason-coded block, waivers; statutory classification by accountant) | R3 §1c e-money boundary; R6 §3 | 5 | financial, legal (SBP) |
| GAP-05 | **M26** | P0 | Driver offer alerting while online (location FGS + realtime socket/poll primary; push = wake aid only; missed-push recovery; OEM guidance; **no full-screen-intent dependency**) | R4 §6 OEM push kills | 4 | safety (missed offers), reliability |
| GAP-06 | **Q49** | P0 | Release artefact/distribution policy (Play AAB meeting 64-bit/target-SDK/16 KB rules with evidence-based ABI set; internal APKs for testers only; iOS signed archive → TestFlight → App Store Connect production; provenance to reviewed SHA) | R4 §1 deadlines; R6 fake-app fraud | 7 | security |
| GAP-07 | **R46** | P0 | Punjab compliance artefacts (police certificate, PSCA QR, 44B district permits, VICS, MIR insurance, token tax) + district-coverage dispatch check | R2 §A | 2 | legal, safety |
| GAP-08 | **R47** | P0 | Harassment-complaint governance kit (FOSPAH / Workplace Harassment Act 2010) | R6 §1 | 6 | legal, safety |
| GAP-09 | **N31** | P0 | Post-trip contact lockdown + "contacted after trip" report reason | R6 §1 Lok Sujag | 6 | privacy, safety |
| GAP-10 | **E20** | P1 | Fuel-indexed fare revision workflow | R6 §3 | 9 | financial |
| GAP-11 | **S26** | P1 | Telecom-outage / internet-shutdown continuity | R6 §5 Careem precedent | 9 | operations, safety |
| GAP-12 | **W01–W06, W08, W09** | P1 (W05 P0) | Public website & web ecosystem family (IA/CMS, a11y/perf, driver lead capture, anti-impersonation, legal pages canonical, analytics/consent, web infra security, web-booking hardening) | founder Phase 0 instruction ("public website/web ecosystem"); docs/02 §3 prose only; J01 single item | 2/9 | security, legal |
| GAP-13 | **W07** | P0 | Staff operations web application baseline (reason-for-access, idle lock, export approvals) | docs/02 §2 lists modules, no shell baseline | 2 | security, privacy |

Affected surfaces, dependencies, test families and blockers for each are in the coverage artefact. Docs updated for consistency: `docs/03` (appended), `docs/21` (W row), `docs/00/README/ALL_FILES_INDEX/17` (counts), `docs/15` (new risks), `docs/23` (founder-prompt traceability for the Phase 0 instruction).

## 3. Clarifications of existing requirements (CL-xx) — interpretation fixed, ID/priority unchanged

| CL | ID(s) | Clarification |
|---|---|---|
| CL-01 | A02 | Phone OTP is the only login credential at launch; email is a contact/receipt channel, not a credential (resolves CON-04). |
| CL-02 | A12 vs N01/C03/S14 | Trusted-contact sharing is P0 under N01/C03/S14; A12 covers only family/delegate booking (P2). |
| CL-03 | A13 vs P11/G09 | Referral product rules live in P11 (P1), accounting controls in G09 (P0); A13 is a duplicate pointer kept for traceability. |
| CL-04 | E03 | A driver cancel after `ASSIGNED` returns the trip to `SEARCHING` via a new dispatch round when policy allows; rider sees "finding a new driver", not a silent rebook. |
| CL-05 | G04 | Cash-friendly rounding to PKR 10 is a pricing-policy decision (ADR-013) applied at quote time; ledger truth stays in PKR minor units. |
| CL-06 | H08/Q39 | Every PII view in staff tooling captures a reason-for-access (now explicit in W07). |
| CL-07 | H10/R28 | Vehicle eligibility rules (model year/age, seats, body type, AC) are configurable per city/category, never hard-coded. |
| CL-08 | M23 | Driver navigation includes keep-awake/screen-on, call overlay and glanceable UI acceptance criteria. |
| CL-09 | Q23 | All timestamps stored/computed in UTC; PKT (UTC+5, no DST) is presentation only. |
| CL-10 | R05 | Model Pakistan "open-letter" (untransferred), bank-hypothecated and company-owned vehicles with authorised-use evidence; owner ≠ driver is normal. |
| CL-11 | N04 | Route-deviation detection includes an in-trip rider confirm/deny prompt before escalation. |
| CL-12 | M10 | Cash completion includes an optional rider confirmation of amount paid within a window; mismatch opens O17 dispute. |
| CL-13 | Q44 | Data-location inventory includes a documented migration path to Pakistan-hosted storage for identity/biometric/location data if the PDP Bill is enacted with localisation. |
| CL-14 | T25 | Legal-change register includes a regulator-relationship register (PTA-Punjab licence conditions, PSCA, police, PCSW, FOSPAH) with obligations and reporting cadence. |
| CL-15 | B16/E07 | When routing is unavailable, fixed-upfront quoting degrades to a disclosed metered/estimate mode or refuses — never an invented ETA/price. |
| CL-16 | U16 | Store policy watch carries dated entries: target API 36 (2026-08-31), Play fine-location declaration (form Nov 2026, effective 2027-01-27), contacts restriction (2027-01-27), 16 KB page size (2027-02-01), geofencing removed from location-FGS (2027-01-27), Android developer verification global (2027), Apple age-rating/Xcode 26. |
| CL-17 | K21/F09/F10/M05 | *(Corrected in the closure pass.)* Wayvro never algorithmically infers gender from face, selfie, name, CNIC number, photograph or any proxy. Women-focused eligibility uses an explicit, consent-based, privacy-minimised, counsel-reviewed policy with qualified human review, fallback and appeal. If an authoritative document explicitly contains a relevant attribute and counsel approves its limited use, it may be checked only for that purpose — never inferred. Identity evidence is never exposed to riders/drivers. Inclusion/edge-case policy remains EXTERNAL_DECISION (ADR-009). |
| CL-18 | E08 | District boundaries are a first-class zone attribute (Section 44B) used by dispatch eligibility. |
| CL-19 | K02/K03/K04 (FD-06) | *(Closure pass.)* Wayvro builds **no in-house face-recognition or liveness ML** for V1. Pilot baseline = guided CNIC/document capture + human/manual authenticity review (supervised/in-person where needed); OCR assists but never silently becomes identity truth. Remote automated liveness/face-to-ID only via a vetted provider or authorised integration after DPIA, accuracy/bias/privacy review, contract/DPA and fallback/appeal. A manual selfie upload is never labelled "liveness passed"; no NADRA claim without authorised access; no real CNIC/selfie data before the privacy/security/legal gate. |
| CL-20 | G03/G05/G06/G17/M11 | *(Closure pass.)* The product invariant is an append-only, auditable operational ledger in which rider obligation, driver-collected cash, driver gross/net earnings, Wayvro commission/fees, taxes/withholding, adjustments, refunds and driver dues are independently traceable; Wayvro never pretends driver-collected cash entered a Wayvro bank account; the internal driver earnings/settlement ledger is operational/accounting data, not e-money; Wayvro issues/custodies no e-money unless licensed; digital rails use regulated bank/EMI/PSO/PSP partners. **Statutory chart of accounts and principal-vs-agent revenue recognition require Pakistani accountant/tax/counsel approval** and are not encoded in Phase 0 artefacts. |
| CL-21 | R01/R02/R46 | *(Closure pass.)* Incumbent licence/permit status from press (e.g. reports that a named competitor received the first Punjab TNC licence) is classified **SECONDARY_REPORT / NEEDS_OFFICIAL_RECONCILIATION** and is never treated as law or used alone to hard-code implementation; official licence requirements, the scanned safety protocols, Section 44B interpretation, police-certificate scope, QR/panic requirements and bike/rickshaw legality remain external legal gates. |
| CL-22 | Q49/I17 | *(Closure pass.)* The project Android build JDK for the React Native/Expo path is **JDK 17** (the developer machine's JDK 25 is not the build JDK). NDK/AGP versions follow the supported Expo/RN/AGP combination; the gate is a successful, reproducible production build with verified 16 KB alignment — not a specific NDK release. |

## 4. Duplicates mapped (DUP-xx) — IDs retained; canonical owner recorded in coverage notes

| DUP | IDs | Canonical owner | Note |
|---|---|---|---|
| DUP-01 | root `28_APP_SURFACES_AND_REPO_TOPOLOGY.md`, `PHASE_0_DISCOVERY_CLAUDE.md`, `requirements-register.json` | `docs/28`, `prompts/PHASE_0_DISCOVERY_CLAUDE.md`, `docs/requirements-register.json` | Byte-identical copies (SHA-256 verified) not listed in the manifest; violate R40 once the canonical register changes. **Removed in Phase 0** (originals preserved in the scratchpad baseline snapshot; see handoff report). |
| DUP-02 | A11 ↔ K10/H01 | K10/H01 for staff MFA; A11 = consumer device/session management | |
| DUP-03 | A13 ↔ P11/G09 | P11 product, G09 accounting | |
| DUP-04 | C13 ↔ P07/P08 | C13 rider-facing surface; P08 CMS; P07 omnichannel | |
| DUP-05 | C10 ↔ N30 | N30 canonical lost-property workflow; C10 rider entry point | |
| DUP-06 | A07 ↔ V05/U05 | V05 canonical permission policy; A07 rider rationale UX | |
| DUP-07 | D06 ↔ V06 | V06 lifecycle; D06 presence semantics | |
| DUP-08 | I03 ↔ Q09 | Q09 security scans; I03 pipeline | |
| DUP-09 | I08 ↔ Q20/Q21 | Q20/Q21 canonical DR targets/drills | |
| DUP-10 | B19 ↔ E17/L24 | B19 rider booking; E17 dispatch window; L24 comms | |
| DUP-11 | C04 ↔ N10 | N10 emergency screen content; C04 SOS action | |
| DUP-12 | R02 ↔ R46 | R46 adds Punjab-specific artefacts; R02 remains route-permit modelling | |
| DUP-13 | docs/06 vs docs/28 monorepo trees | `PHASE0_ARCHITECTURE_PROPOSAL.md` §3 is canonical | resolves CON-03 |

## 5. Contradictions and inconsistencies (CON-xx)

| CON | Where | Issue | Resolution |
|---|---|---|---|
| CON-01 | docs/04 vs docs/05 vs docs/18 vs docs/28 | Four different driver-onboarding/capability state machines | **Resolved:** canonical machine in `PHASE0_UNIFIED_APP_ROLE_MODEL.md` §3; docs/04/05/18 updated to reference it |
| CON-02 | docs/04 | Trip lifecycle lists `SETTLEMENT_PENDING → SETTLED` while instructing to split trip and payment status | **Resolved:** settlement is a separate aggregate (role model §10); docs/04 corrected |
| CON-03 | docs/06 vs docs/28 | Different `docs/` subfolders in monorepo trees | **Resolved:** architecture proposal §3; docs/06 notes it |
| CON-04 | A02 title "Email/phone route" vs docs/18 phone-only | Email implied as login | **Resolved:** CL-01 |
| CON-05 | docs/09 lists Firebase phone auth as a production OTP candidate | Firebase phone auth is paid since 2024 and PK price UNVERIFIED; Twilio PK is $0.47/segment | **Resolved:** cost matrix + ADR-007; docs/09 annotated |
| CON-06 | A12 (P2), A13 (P2) vs N01/C03 (P0), P11 (P1) | Priority conflicts for trusted contacts and referrals | **Resolved:** CL-02/CL-03 (no ID re-prioritised) |
| CON-07 | README priority codes vs docs/12 phases | P1 = "required for initial public city launch" but B15–B19/E12–E14/L03/M03/M06/E17/L24/S21 (P1) were scheduled in **Phase 10**, after Public City V1 (Phase 9) | **Resolved in the closure pass:** priority codes redefined (P1 = mandatory when its assigned release/vertical activates; timing = target phase + release gate; README/docs/12/docs/14); per FD-02 the Phase-9 capability IDs **B15, B16, B17, B18, B19, E13, E14, E17, L03, L24** moved Phase 10 → 9 (no priority changed); E12 surge, M03, M06, S21 stay in Phase 10 |
| CON-08 | docs/17 "Phase 0 PLAN ONLY; no code" vs Phase 0 prompt §E "disposable technical spikes may answer architecture questions" | Spike authorisation ambiguous | **Resolved:** spikes were NOT RUN in Phase 0; FD-13 authorises them as bounded evidence tasks scheduled in Phase 1 early entry (SP-03, SP-05, Android JDK 17 smoke) and before the Phase 3 freeze (SP-01, SP-02, SP-04) — see `PHASE0_ADR_BACKLOG.md` §E |
| CON-09 | docs/12 Phase 0 "Interview target riders/drivers" | Claude cannot run field interviews | **Escalated:** J07 EXTERNAL_DECISION; docs/12 annotated |
| CON-10 | CLAUDE.md §14 "no AI co-author trailers" vs harness attribution reminder | Conflicting instructions | **Resolved:** CLAUDE.md wins (reminder defers to user instructions); no commits in Phase 0 anyway |
| CON-11 | docs/05 "August 2026 reporting refers to Section 44B" | Research shows reporting dated 28–29 Jul 2026 | **Resolved:** docs/05 wording corrected to "July 2026 reporting" |
| CON-12 | docs/16 ADR numbering (016–018 listed before 008) and backlog scattered across docs/16 | Ordering/currency | **Resolved:** `PHASE0_ADR_BACKLOG.md` is the current backlog; docs/16 points to it |

## 6. Underspecified / risky areas found (beyond new IDs) and where they are now specified

| Area | Finding | Now specified in |
|---|---|---|
| Mode-switch simultaneous-use policy | docs/28 §5 defers "exact simultaneous-use policy" | Role model §5 (online-idle must go offline before rider booking) |
| Conflict/recovery sequencing | prose only | Role model §6 |
| Driver offer delivery on OEM-killed apps | not addressed | M26, ADR-033 |
| Vehicle/driver many-to-many | implied | D26, role model §1 |
| Cash commission mechanics | spread across G01/M11/O18 | G17 + architecture §6 |
| Trip vs settlement status | contradictory | Role model §10 |
| Website | one requirement (J01) | W-family |
| Punjab compliance artefacts | generic R02–R06 | R46 |
| Supply preview privacy | absent | B26 |
| Store deadlines | generic U16 | CL-16, launch blockers §E |
| Data residency | inventory only | CL-13, cost matrix §4, FD-03 |
| Maps provider economics | principle only | cost matrix, ADR-006, SP-04 |
| Security test obligations | listed | security doc §10 + invariants INV-01..14 |

## 7. Founder decisions — recorded in the founder/ChatGPT review closure pass (2026-10-09)

All are **founder-approved proposals that remain subject to their external gates** (legal, vendor, staffing, evidence). None authorises purchasing paid infrastructure or claiming an unavailable capability.

| FD | Recorded founder decision |
|---|---|
| FD-01 | **Approved.** Phase 8 controlled pilot = limited Lahore zone, car only, fixed/upfront pricing, cash only (ADR-002). |
| FD-02 | **Approved.** Phase 9 public Lahore V1 = car; bike and/or rickshaw only where a written legal/permit/insurance position permits activation; upfront pricing; controlled mutual fare bidding/counter-offer; multi-stop; scheduled rides; public website/web booking; full safety/support stack; cash plus at least one production-approved regulated digital-payment path — all feature-flagged and category/zone controlled; legally blocked categories are never claimed as available. B15, B16, B17, B18, B19, E13, E14, E17, L03, L24 moved Phase 10 → 9; dynamic/surge (E12) stays later. |
| FD-03 | **Approved provisionally.** Singapore is the provisional early hosting region; sensitive KYC/biometric/location storage must remain migratable; data-residency/legal review is **not closed**. |
| FD-04 | **Approved.** Hybrid maps-provider abstraction; SP-04 Lahore field test required before any provider freeze. |
| FD-05 | **Approved as preferred direction.** Local Pakistan OTP/SMS provider primary + approved WhatsApp authentication fallback; no vendor or price is final until contracted and tested. |
| FD-06 | **Approved with the KYC boundary in CL-19** (no in-house face/liveness ML; manual/human review pilot baseline; vetted provider only after DPIA/DPA; no "liveness passed" label for manual uploads; no NADRA claim). |
| FD-07 | **Approved.** Cash-only controlled pilot; Phase 9 requires at least one contracted regulated digital-payment path; Raast/wallet-friendly economics preferred; cards depend on actual commercial terms. |
| FD-08 | **Conditionally approved.** Transistorsoft/commercial background-location SDK budget only if SP-01 shows the free/native approach is insufficient. |
| FD-09 | **Approved.** React Native + Expo development builds are the primary mobile direction, subject to the SP-01/SP-02 validation gates; Flutter remains the documented fallback. |
| FD-10 | **Approved: incorporation work starts now, in parallel with engineering.** Entity formation is required; if the founder is the sole member, evaluate an SECP **Single Member Company (SMC)**; an ordinary private limited company needs an appropriate multi-member structure; **no nominee shareholder/co-founder is invented**; the final SMC vs multi-member choice requires founder + Pakistani corporate counsel/accountant review; architecture/vendor planning does not depend on a specific entity form. |
| FD-11 | **Approved.** Removal of the three byte-identical root duplicates. |
| FD-12 | **Approved subject to CL-17.** Women-focused preference/category concept with consent, no inference, counsel review and appeal; inclusion/edge-case policy stays EXTERNAL_DECISION. |
| FD-13 | **Approved.** Spikes authorised as bounded evidence tasks (schedule in `PHASE0_ADR_BACKLOG.md` §E). Staged device procurement: start with available/borrowed real devices + emulators; acquire representative physical Android devices progressively before background-location/device-matrix gates; cover Samsung, Xiaomi and Transsion (Tecno/Infinix)/Vivo classes before production release; at least one real iPhone before serious iOS release/pilot validation. Emulator-only results never close a real-device gate. |
| FD-14 | **Accepted as a provisional planning envelope:** ≈ USD 250–300/month pilot infrastructure. Not permission to buy paid infrastructure now and not a guarantee of actual production cost. |

## 8. Risks added to the register (docs/15)
RSK-033 Section 44B district permits shrink supply / create illegal-trip exposure · RSK-034 TNC licence conditions unknown (scanned protocols unread) · RSK-035 OEM background kills cause missed offers/stale tracking · RSK-036 Fake/cloned apps and pre-payment scams damage trust · RSK-037 PDP Bill enactment forces data localisation · RSK-038 Telecom/internet shutdowns halt app-only operations · RSK-039 Card fixed fees make small digital trips uneconomic · RSK-040 Store policy deadlines (16 KB, fine-location declaration) block releases.

## 9. Items that remain implicit **nowhere** (freeze test, docs/20)
After this pass, every founder instruction (docs/23 incl. the Phase 0 kickoff instruction), every competitor capability (competitor matrix §4), every regulatory artefact discovered (R46/R47/launch blockers), every research "top-15" edge case (R6) maps to an ID or an explicit OUT_OF_SCOPE/EXTERNAL_DECISION entry. Known residual uncertainty is listed as UNVERIFIED research items in the handoff report §10/§13, not as missing requirements.
