# PHASE0_JOURNEYS_AND_STATE_MACHINES — End-to-end journey maps and remaining state machines

**Date:** 2026-10-09 · **Status:** Phase 0 deliverable (mandatory work items C and D of `prompts/PHASE_0_DISCOVERY_CLAUDE.md`). Account/driver-capability/presence/mode-conflict/trip/settlement machines live in `PHASE0_UNIFIED_APP_ROLE_MODEL.md`; this file covers the journeys and the other machines. Each journey lists the **edge states** the Phase 0 instruction requires (denied permission, offline, cancellation, retry, appeal, suspension, expired documents, crash/restart, cross-mode conflict) with the requirement IDs that own them. Journeys are acceptance-test families, not UI designs.

## A. Journeys

### J1 — Shared account: first launch to usable Rider mode
Splash/version check (A01) → consent/privacy (A04, W05) → +92 OTP (A02/A03/K08) → optional Google/Apple link later (K15/K16) → account state snapshot (`/v1/account/state`) → Rider home.
Edge: OTP delivery failure → fallback channel (ADR-007), honest error (K08 §F); recycled number (S12); forced update (A01/Q31); offline on first launch → cached shell with retry (L08); notification permission denied → in-app banners (S25).

### J2 — Rider: fixed-price city ride (cash)
Home map + supply preview (B01, B26) → pickup/drop (B02/L16) → quote with expiry and components (B04/B06/E05) → confirm (L25) → `REQUESTED` → `SEARCHING` (B08) → offer accepted; driver card (B09/L02/C01) → en route / arrived / PIN (B10/C02/M09) → live trip, share, safety (B11/C03/N01) → destination change (B12/L26) → complete, receipt, rating (B14/L01) → cash settlement recorded (O01/M10).
Edge: location permission denied → manual pin (A07/B01); no driver → truthful alternatives (S24), no charge (journey 1 of docs/14); quote expired → requote; rider cancels at each state with fee rules (C09/O16/R11); driver cancels after assignment → new round (CL-04); mismatch at pickup → refuse boarding, incident, no fee (B13/N16); app crash mid-trip → restore from server (I12); network loss → stale badge, SOS still reachable via dialer (C04/N10); payment dispute → O17; post-trip contact → N31.

### J3 — Rider: controlled mutual fare bidding/counter-offer — Phase 9 (FD-02, feature-flagged per category/zone)
Rider offer within floor/cap (B16/E13) → competing driver offers with transparent fields (L03/L02) → rider picks → same lifecycle as J2 with immutable agreed price version (docs/04). Edge: expired/changed offers cannot be selected; lowball abuse limits (E09); accessibility without pressure (B17).

### J4 — Driver/Partner application inside the same account
Rider shell → *Earn with Wayvro* (V03) → consent/identity notice (K14, W05) → CNIC front/back guided capture (K02; OCR only assists the reviewer) → guided selfie capture for **human/manual comparison** (K03/K04 — no in-house face/liveness ML; never labelled "liveness passed"; automated liveness only via a vetted provider after DPIA/DPA, FD-06) → licence, registration, fitness, insurance, token tax, police certificate, PSCA QR evidence (D02/K06/R46) → submit → automated quality/duplicate checks (K07) → manual review, supervised/in-person where needed (K05/H02) → NEEDS_INFO / REJECTED / VERIFIED → training (D20) → `ACTIVE_ELIGIBLE` → Driver mode unlocked (V03). Real CNIC/selfie data is not processed before the privacy/security/legal gate (Q45).
Edge: camera permission denied → manual alternative (K03); upload interrupted → resumable (K02); offline resume (K19); rejection with reason + appeal (K05/D04); Rider mode usable throughout (V03); suspicious duplicate → human review (K07); vendor outage (if a vendor is later used) → manual path; no background-location prompt in this journey (V05).

### J5 — Mode switching and go-online
Driver mode entry (V08) → prerequisites screen (documents, dues G17, OEM battery guidance M26, background-location disclosure then permission V05) → go online (D05; INV-05) → `ONLINE_IDLE`.
Edge: active rider trip → blocked with reason (INV-06); second device → displacement (D27); permission revoked while online → forced offline (SP-01 #7); expired document → `RoleRestriction` with reminder trail (M17/K12); dues over cap → block with appeal (G17); switch to Rider while online → confirm go-offline first (role model §5); while `ASSIGNED…ON_TRIP` → switch blocked (V04).

### J6 — Driver: offer → trip → earnings
Offer delivered over the realtime socket/poll path inside the online foreground service, with a high-priority push as a wake/alert aid only (M26/D07/D08; server offer state authoritative; no full-screen intent by default) → accept (atomic, E02) → navigate (D09/M23/S22) → arrived with geofence/waiting timer (D10/M09) → PIN → trip (D11) → complete → cash collected declaration (M10) → earnings/dues statement (D13/M14/G17) → next offer or offline.
Edge: accept after lease expiry → definitive conflict (docs/04); push not delivered → offer still arrives via socket/poll, and on reconnect the app recovers pending offers from the server (M26); OS kills app → tracking stopped notice + server stale handling (V06); rider no-show (D12/M09); unsafe rider → driver SOS/refusal without retaliation (D14/M21); GPS spoof signals (N18); low battery/data; trip crossing a district without permit coverage → warned/excluded (R46).

### J7 — Women-focused flows — Phase 11
Rider preference for an eligible woman driver (F08/M05) or women-only category (F10/F11) — eligibility per the canonical rule: no algorithmic gender inference from face/selfie/name/CNIC number/photo or any proxy; explicit consent-based, counsel-reviewed policy with qualified human review, fallback and appeal; identity evidence never shown to the other party (CL-17, ADR-009) — → matching strictly within eligible supply → no availability shown honestly rather than silent fallback (docs/04) → explicit consent for any fallback. Driver: opt-in to women-passenger preference; street-harassment reporting (R6 §1).
Edge: wrong driver arrives → fail-closed cancel (docs/05); ineligible co-rider in pool → never assigned (F11/F14); supply scarcity → wait/alternatives; eligibility appeal (F09/F10).

### J8 — Scheduled ride — Phase 9 (FD-02; multi-stop B18/E14 also Phase 9)
Book with window (B19) → reminders (L24) → dispatch at T-x (E17) → driver assigned → standard trip. Edge: no driver at window → recovery options (B19/S24); rider cancel policy by lead time (O16); driver late/failed pickup (E17); push failure → SMS hierarchy (L13).

### J9 — Low-data / web / call-centre booking
Lite mode (L08) on poor networks; web booking with phone verification and scoped trip-status page (L09/W09); call-centre agent creates a ride after caller verification with full audit (L10/R18/S10); internet shutdown continuity (S26). Edge: agent cannot override compliance or money invariants (R18); guest rider safety parity (S05).

### J10 — Safety incident (rider or driver)
Safety Center (N01) → SOS: dialer to 15/1122 with trip payload on screen (C04/N10), trusted-contact share (C03), discreet report (N06) → incident ticket, severity S0–S3 (H04/C06) → human response per staffed roster (N21) → evidence chain (N12/N13) → actions (trip termination N25, driver freeze H09/V13, no-rematch N03) → appeal (T20). Edge: accidental SOS (N11); user unreachable (N11); poor network (docs/05); PSCA data-push only after signed MoU (ADR-032); FOSPAH-grade harassment handling (N24/R47); lawful request (N14).

### J11 — Cash/digital payment, refund and support
Cash: fare display, change guidance (O01), driver declaration + rider confirmation (M10/CL-12), dispute (O17). Digital (Phase 9): intent → PSP hosted flow → signed webhook → capture (G02/O09) → receipt (G11); failure → outstanding balance flow (O10); refund via original rail or documented cash resolution (O11) with maker-checker (G08); chargeback (O22). Support: in-app case with context (P07/H05), lost item (N30/C10), Urdu/English help (C13/P08). Edge: PSP outage → disclosed fallback (O24); duplicate webhook (INV-11); refund fraud (AB-16).

### J12 — Pooling — Phase 11
Explicit pool opt-in (F01) → matching within walk/detour/seat limits (F02/F03/E15) → per-seat booking and consent (F04/pool_passenger_consent) → disclosed fare allocation (F05) → per-passenger start/end/incident (F04/F13) → settlement (E16/G14). Edge: no match → solo fallback (F06); participant cancels → bounds or reconsent (docs/04); co-rider privacy (F07/N26); safety exit (F12).

### J13 — Corporate/fleet and delivery/intercity — Phase 12
Fleet owner KYB and driver affiliation with driver consent (R34/K23/D21); corporate profiles, delegates, invoices (R33/S04–S08/G13); courier with proof, prohibited goods, COD withholding (R29/R30/D23/S09); intercity permits and fatigue (R32/E18/M19). Each behind feature flags (R35-style gates) and separate lifecycles (docs/04).

### J14 — Account recovery, device change, deletion
Phone re-verification and high-risk reauth (K17/A05); OIDC link conflicts (S13); logout-all (K09); account deletion in-app + web with retention exceptions (A10/U06/Q47). Edge: active trip or dues outstanding → deletion deferred with explanation; legal hold (N13).

### J15 — Staff operations
Login/MFA (K10/W07) → role dashboard → KYC queue (H02), live map with reason-for-access (H03/W07), incidents (H04), support (H05), finance/reconciliation (H07/G07), rate cards with preview/scheduling (H06/E20), restrictions/appeals (H09), config/flags (P16), audit (Q39). Edge: break-glass (H08), maker-checker on money/KYC overrides (T24/T18), exports approval (W07), lawful requests (N14/R07).

## B. Remaining state machines

### SM-1 OTP / session / recovery (K08/K09/K17)
`OTP_ISSUED(ttl, attempts) → VERIFIED (single use) | EXPIRED | LOCKED(attempts/velocity) → COOLDOWN`. Session: `ISSUED → ACTIVE ↔ REFRESHED (rotating refresh, reuse detection → REVOKED_ALL) → REVOKED | EXPIRED`. Recovery: `REQUESTED → STEP_UP(phone re-verify, device age, cooldown) → GRANTED | DENIED(audit)`.

### SM-2 Quote (B06/E05)
`DRAFT → PRICED(version, expiry) → ACCEPTED(bound to request) | EXPIRED | SUPERSEDED(repricing with consent B12/L26)`. Invariant: a request references exactly one accepted quote version; receipts reference it immutably.

### SM-3 Bid / offers (B16/B17/E13) — Phase 9
Rider bid: `PROPOSED(within floor/cap) → OPEN → MATCHED(driver accept same version) | COUNTERED(driver) → RIDER_ACCEPTED | DECLINED | EXPIRED`. Driver offer (dispatch): `CREATED → ELIGIBLE → OFFERED(lease) → ACCEPTED | DECLINED | EXPIRED | REVOKED` (docs/04).

### SM-4 Assignment (E02)
`PENDING → COMMITTED(single row CAS) → RELEASED(cancel/reassign) | COMPLETED`; unique partial index on `(driver_id) WHERE status='COMMITTED'` and on `(trip_id)`.

### SM-5 Scheduled ride (B19/E17)
`SCHEDULED → REMINDED → DISPATCH_WINDOW_OPEN → (normal trip) | WINDOW_MISSED → RECOVERY(retry/alternative/refund) | CANCELLED_BY_*`.

### SM-6 Pool membership (F04/E15/E16)
`REQUESTED → MATCHED(pool_group_id) → CONSENTED → BOARDED → ALIGHTED → SETTLED | WITHDRAWN(before board) | CANCELLED(policy) ; group: FORMING → LOCKED(route+seats atomic) → ACTIVE → CLOSED`.

### SM-7 Payment intent / refund / payout (G02/O09/O11/G12)
Intent: `CREATED → AUTHORIZED? → CAPTURED | FAILED | VOIDED`; provider events unique by `(provider, event_id)`. Refund: `REQUESTED → APPROVED(maker-checker threshold) → SENT → COMPLETED | FAILED → RESOLVED_MANUAL`. Payout bundle: `DRAFT → PAYEE_VERIFIED → SUBMITTED → SETTLED | PARTIALLY_FAILED → RETRY/RETURNED`. Dues (G17): `ACCRUED → DUE → SETTLED | OVERDUE(grace) → BLOCKING(reason) → SETTLED | WAIVED(approved)`.

### SM-8 Incident (H04/N13)
`OPENED(severity) → ACKNOWLEDGED(human) → IN_RESPONSE → CONTAINED → UNDER_INVESTIGATION → DECIDED(actions) → CLOSED | REOPENED ; legal hold overlays`.

### SM-9 Support case (H05/P07)
`NEW → TRIAGED → IN_PROGRESS → WAITING_USER | ESCALATED → RESOLVED → CLOSED | REOPENED`; refunds branch to SM-7 with maker-checker.

### SM-10 Document / artefact expiry (D03/M17/R46)
`VALID → EXPIRING(reminders T-30/14/7/1) → EXPIRED(role restriction) → RENEWAL_SUBMITTED → VALID | REJECTED`; evaluated by a scheduled job with server time (Q23) and at every go-online/accept/start (K12).

### SM-11 Feature flag / kill switch (P16)
`REGISTERED(owner, expiry) → ENABLED(cohort, env) → DISABLED | EXPIRED(removal required)`; mode-scoped switches for driver-only capabilities (V10).

## C. Proof obligations (summary)
No double assignment (SM-4 + INV-02), no double charge (SM-7 + INV-11), no illegal go-online (role model §1 + INV-05), balanced ledger (INV-10), no mode-switch bypass (INV-06), vehicle/session uniqueness (INV-03/04), document expiry blocks dispatch (SM-10 + K12). Each is a named test in the Phase 4/5 plans and a CI gate per `PHASE0_ENGINEERING_GUARDRAILS.md`.
