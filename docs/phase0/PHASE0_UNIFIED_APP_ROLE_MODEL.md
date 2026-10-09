# PHASE0_UNIFIED_APP_ROLE_MODEL — Account / profile / capability / restriction / mode model

**Date:** 2026-10-09 · **Status:** Phase 0 deliverable (plan-only; proposed canonical model for Phase 2/4 ADRs) · **Authority:** implements founder-locked ADR-026 (one public Wayvro app), `CLAUDE.md` §2–3, `docs/28`, requirements V01–V14 plus Phase 0 additions D26/D27/M26. This document **resolves contradiction CON-01** (three different driver-onboarding state machines in docs/04, docs/05 and docs/18) by defining one canonical machine; docs/04/05/18 are updated to point here.

## 1. Entities (conceptual; ADR-004 chooses the physical schema)

| Entity | Purpose | Key invariants |
|---|---|---|
| `Account` | The human's single identity container: verified +92 phone, linked OIDC identities, consents, devices/sessions, **account-wide** restrictions | Exactly one per verified phone; never duplicated to simulate roles (V02) |
| `RiderProfile` | Customer profile: preferences, saved places, rider rating/trust, rider history refs | Created implicitly at first sign-in; cannot be deleted while a trip is active |
| `DriverApplication` | The in-app "Earn with Wayvro" application lifecycle (§3) | At most one non-terminal application per account |
| `DriverProfile` | Earning profile after approval: compliance state, training, earnings/dues refs, driver rating | At most one per account; existence ≠ eligibility |
| `Vehicle` / `VehicleAffiliation` | Vehicle record with documents and Punjab artefacts (R46); affiliation links driver↔vehicle (owner, authorised user, fleet) | A vehicle may have many affiliated drivers; **at most one driver online with it at a time (D26)** |
| `ServiceCapability` | Grant of a service class in a city/zone for a driver+vehicle pair (car, bike, rickshaw, courier…) | Derived from documents + approvals; revalidated at go-online/accept/start (K12/V09) |
| `RoleRestriction` | Reason-coded restriction scoped to the driver role (earning blocked) | Blocks earning only (V13) |
| `AccountRestriction` | Reason-coded restriction scoped to the whole account (safety/fraud/legal) | Blocks both modes per policy (V13) |
| `Session` / `Device` | Server-issued session bound to a device; **one authorised Driver-mode session at a time (D27)** | Rotation/revocation (K09) |
| `ModePreference` | Client-side last-used mode hint | **Never authorisation** (docs/18 §D) |
| `IdentityEvidence`, `VerificationDecision`, `Appeal`, `ConsentRecord`, `AuditEvent` | KYC vault objects, reviewer decisions, appeals, consents, audit | Vault-isolated (K11); every privileged transition audited (Q39) |

Capability derivation (server-side, pure function, cached per request):
```
canGoOnline(account, driverProfile, vehicle, city, service) =
  account.restrictions ∌ ACCOUNT_BLOCK
  ∧ driverProfile.state = ACTIVE_ELIGIBLE
  ∧ driverProfile.roleRestrictions ∌ EARNING_BLOCK
  ∧ documents(driver, vehicle, city).allValidAt(now)   -- incl. R46 artefacts where configured
  ∧ serviceCapability(driver, vehicle, city, service).granted
  ∧ dues(driver) ≤ cap ∨ withinGrace (G17)
  ∧ ¬activeRiderTrip(account) (V04)
  ∧ ¬vehicleOnlineUnderOtherDriver(vehicle) (D26)
  ∧ ¬otherDriverSessionActive(account) (D27 — or displace per policy)
```
The same function is evaluated again at `accept`, `arrive`, `start` (K12); the client never computes it.

## 2. Account restriction model (V13)

| Scope | Examples | Effect | Lifted by |
|---|---|---|---|
| `RoleRestriction(DRIVER)` | expired licence/insurance/permit, failed re-verification, dues over cap, quality suspension | `Go online` blocked; driver mode still shows status/appeal/earnings; Rider mode unaffected | document renewal, dues settlement, reviewer decision, appeal |
| `AccountRestriction` | confirmed fraud, safety ban, legal hold, under-age | both modes blocked per policy; active trip handled by safety process | T&S decision with maker-checker, appeal |
| `DeviceRestriction` | tampered/emulator device as risk signal (Q02/Q03) | step-up or deny for abuse-sensitive actions, never a sole permanent ban | human review |

Every restriction carries `reason_code`, `actor`, `evidence_ref`, `effective_from/until`, `appealable`.

## 3. Canonical driver-capability state machine (replaces docs/04, docs/05 and docs/18 variants)

```
NONE
  └─(start application)──▶ DRAFT ──(phone already verified; consent captured)──▶ CONSENTED
CONSENTED ──(documents uploading)──▶ DOCUMENTS_PENDING ──(all required uploaded)──▶ SUBMITTED
SUBMITTED ──(automated quality/duplicate checks)──▶ AUTO_CHECK_PENDING
AUTO_CHECK_PENDING ──▶ MANUAL_REVIEW            (always; no automated approval path)
MANUAL_REVIEW ──▶ NEEDS_INFO ──(resubmit)──▶ SUBMITTED
MANUAL_REVIEW ──▶ REJECTED ──(appeal)──▶ APPEALED ──▶ MANUAL_REVIEW | REJECTED_FINAL
MANUAL_REVIEW ──(reviewer verifies identity, documents, licence class, vehicle, Punjab artefacts)──▶ VERIFIED
VERIFIED ──(training/inspection complete; service capability granted)──▶ ACTIVE_ELIGIBLE
ACTIVE_ELIGIBLE ──(document expiry)──▶ EXPIRED ──(renewal verified)──▶ ACTIVE_ELIGIBLE
ACTIVE_ELIGIBLE ──(periodic recheck due)──▶ REVERIFY_DUE ──(pass)──▶ ACTIVE_ELIGIBLE | ──(fail)──▶ SUSPENDED
ACTIVE_ELIGIBLE ──(T&S/quality/dues action)──▶ SUSPENDED ──(appeal/remedy)──▶ ACTIVE_ELIGIBLE | REJECTED_FINAL
any ──(account-wide action)──▶ (unchanged; AccountRestriction overlays)
```
Rules: a face-match score alone can never cause `VERIFIED` (K04); every transition is privileged, reason-coded and audited (K05); `ACTIVE_ELIGIBLE` is necessary but not sufficient to go online (§1 derivation); Rider mode remains available throughout unless an `AccountRestriction` applies (V03).

## 4. Driver presence / session state machine (D05, D06, D27, V06)

```
OFFLINE ──(go online; canGoOnline ✓; session authorised; FGS started)──▶ ONLINE_IDLE
ONLINE_IDLE ──(pause)──▶ ONLINE_PAUSED ──(resume)──▶ ONLINE_IDLE
ONLINE_IDLE ──(offer accepted & assignment committed)──▶ ASSIGNED
ASSIGNED ──▶ EN_ROUTE ──▶ ARRIVED ──▶ ON_TRIP ──(trip completed)──▶ ONLINE_IDLE | (back-to-back) ASSIGNED
ONLINE_* ──(go offline; no active obligation)──▶ OFFLINE
ONLINE_* ──(heartbeat stale > T_stale)──▶ STALE ──(heartbeat resumes)──▶ previous | ──(> T_offline)──▶ OFFLINE (server-forced, reason STALE)
ONLINE_* ──(permission revoked / FGS died / session displaced / restriction)──▶ OFFLINE (server-forced, reason-coded; active trip enters safety/reassignment policy)
```
Invariants: presence TTL is not proof of trip completion (docs/04); the location foreground service runs **only** in `ONLINE_*` and stops on `OFFLINE`/logout/suspension (V06); a second device's go-online either **displaces** the first (default, with push notice to the displaced device) or is **refused** while `ASSIGNED…ON_TRIP` (D27).

## 5. Mode switch and active-state conflict matrix (V04, V08)

Mode is a presentation context stored client-side; every mode-sensitive action re-checks server state.

| Current server state | Switch to Rider mode | Start rider booking | Switch to Driver mode | Go online |
|---|---|---|---|---|
| No driver profile | ✓ | ✓ | opens *Earn with Wayvro* (application) | ✗ (no capability) |
| Driver application pending/rejected | ✓ | ✓ | ✓ (status/appeal screens only) | ✗ reason `NOT_ELIGIBLE` |
| `ACTIVE_ELIGIBLE`, `OFFLINE`, no rider trip | ✓ | ✓ | ✓ | ✓ |
| Rider trip active (REQUESTED…IN_PROGRESS) | ✓ | ✗ one-active-ride (B07) | ✓ (view only) | ✗ reason `RIDER_TRIP_ACTIVE` |
| Driver `ONLINE_IDLE` | ✓ **auto go-offline first** (explicit confirm) | ✗ until offline | ✓ | — |
| Driver `ASSIGNED…ON_TRIP` | ✗ blocked with reason `DRIVER_OBLIGATION_ACTIVE`; account utilities (support/safety) remain reachable | ✗ | ✓ | — |
| `RoleRestriction(DRIVER)` | ✓ | ✓ | ✓ (health/appeal/earnings) | ✗ reason code |
| `AccountRestriction` | per policy (typically ✗ both) | ✗ | per policy | ✗ |

Policy decision recorded for ADR: **a driver who is online but idle may switch to Rider mode only by going offline first** (simplest safe rule; "simultaneous online + booking" is rejected for Phase 1–9). Reopen only with founder decision and evidence.

## 6. Crash / restart / device-change recovery (V04, I12, docs/07)

On every cold start, reconnect, deep link or notification tap:
1. Re-authenticate session; fetch `GET /v1/account/state` → `{ account, riderProfile, driverProfile?, capabilities, restrictions, activeRiderTrip?, activeDriverJob?, presence, requiredAction }`.
2. Route by **server** truth: active driver job → driver active-job screen; active rider trip → rider trip screen; otherwise last `ModePreference` if permitted, else Rider home.
3. Replay only idempotent, server-validated intents from the bounded offline queue (D24); never replay accept/go-online/complete blindly.
4. If the FGS is running but server says `OFFLINE`, stop it; if server says `ONLINE_*` but no FGS (process killed), show "tracking stopped" and require explicit resume (spike SP-01 criterion).
5. New device/reinstall: same account state; D27 displacement rules apply; no local flag can grant capability (docs/18 §D).

## 7. Permission lifecycle in one binary (V05, U05, A07; research R4)

| Permission | Rider mode | Driver mode | Request moment | Denial / revocation path |
|---|---|---|---|---|
| Foreground precise location | needed for pickup map | needed | first map use with rationale | manual pin/ search fallback (B01/B02); Play 2027 fine-location declaration (navigation/live tracking justification) |
| Background location (`ACCESS_BACKGROUND_LOCATION` / iOS Always) | **never requested** | only at first *Go online* after approval, with prominent disclosure ("location" wording) | go-online flow | cannot go online; recovery screen with settings deep link; iOS downgrade Always→WhileInUse detected (SP-01 #7) |
| Foreground service (location type) | never started | started on go-online; stopped on offline | go-online | server-forced offline on failure |
| Notifications | requested with benefit statement | dedicated high-priority offer channel used as a **wake/alert aid only**; while online the location FGS hosts the realtime socket/poll/recovery path, which is the primary offer channel; server offer state is authoritative; `USE_FULL_SCREEN_INTENT` **not requested by default** (M26/ADR-033) | first relevant moment | socket/poll keeps offers flowing; missed-push recovery on reconnect; critical trip states via SMS hierarchy (L13) |
| Camera | only for explicit rider flows (evidence/profile) | KYC capture, incident evidence | at the capture screen | manual-review alternative (K03) |
| Contacts | never (manual entry / picker) | never | — | S14; Play 2027 contacts change |
| Battery-optimisation exemption | never | guided OEM step (Xiaomi/Transsion/Vivo) during driver onboarding | go-online prerequisites | offers degrade to socket/poll with explicit warning (M26) |

Store declarations: exactly one background feature ("driver live trip tracking while online/on-trip"), FGS location type with demo video, Data safety entries for Government ID/Photos/Location (V14/U17).

## 8. Data and authorisation isolation (V07, RSK-028)

- Separate authorisation policies per resource class: `rider.trips`, `driver.jobs`, `driver.earnings`, `driver.documents`, `rider.payment_instruments`, `support.cases(role)`, `notifications(category)`.
- Queries are scoped by **profile id**, never by account id alone; a rider endpoint cannot return driver-job rows even for the same account.
- KYC evidence is reachable only through vault endpoints with reviewer roles and reason-for-access (K11/W07); never through trip APIs (docs/18 §D).
- Telemetry carries `mode`, `profile_kind`, `onboarding_state` as low-cardinality dimensions, never identifiers (V12/Q36).
- Negative tests (test family `security`): IDOR across profiles of the same account; cross-account; staff without scope; deep-link token replay.

## 9. Invariants and proof obligations (map to test families)

| ID | Invariant | Proof (Phase) |
|---|---|---|
| INV-01 | One active exclusive rider trip per account (B07) | DB unique partial index + concurrency test (4) |
| INV-02 | One exclusive driver assignment per driver (E02) | serialisable transaction / unique constraint + 100-concurrent-accept chaos test (4) |
| INV-03 | One driver online per vehicle; one vehicle per online driver (D26) | unique partial index on `driver_presence(vehicle_id) WHERE online` + test (4) |
| INV-04 | One authorised driver session per account (D27) | session table constraint + displacement test (4) |
| INV-05 | No go-online/accept/start without `canGoOnline` (K12/V04) | property tests over state combinations (2/4) |
| INV-06 | Mode switch cannot abandon `ASSIGNED…ON_TRIP` (V04) | API test: switch request → 409 with reason (4) |
| INV-07 | Rider-only account never receives background-location/FGS/KYC prompts (V05) | device test SP-01 #1 + mobile E2E (3) |
| INV-08 | FGS runs only in `ONLINE_*` (V06) | device test SP-01 #2/#3 + telemetry assertion (4) |
| INV-09 | Driver suspension ≠ account suspension (V13) | unit + API tests (2) |
| INV-10 | `sum(debits) = sum(credits)` per posted ledger transaction (G06) | property test + DB check constraint (5) |
| INV-11 | No double charge on webhook replay (G02/O09) | unique provider event key + replay test (5/9) |
| INV-12 | Trip status transitions monotonic/authorised (I10) | state-machine table + property test (5) |
| INV-13 | Dues over cap blocks go-online with reason, never silently (G17) | API test (5) |
| INV-14 | Cross-mode regression: rider release cannot break driver flows and vice versa (V10) | cross-mode E2E matrix in CI (from 4) |

## 10. Canonical trip lifecycle (resolves CON-02)

Trip aggregate (`trips.status`): `DRAFT → QUOTED → REQUESTED → SEARCHING → ASSIGNED → DRIVER_EN_ROUTE → DRIVER_ARRIVED → IN_PROGRESS → COMPLETED` with terminal exceptions `CANCELLED_BY_RIDER | CANCELLED_BY_DRIVER | CANCELLED_BY_PLATFORM | EXPIRED_NO_DRIVER | ABORTED_SAFETY`. A driver cancel after `ASSIGNED` returns the trip to `SEARCHING` through a new dispatch round when policy allows (CL-04).
**Settlement is a separate aggregate** (`trip_settlements.status`): `PENDING → COLLECTED_CASH | CAPTURED_DIGITAL | PARTIAL | FAILED → RECONCILED | DISPUTED → RESOLVED`. The earlier `SETTLEMENT_PENDING/SETTLED` trip states in docs/04 are removed; docs/04 now references this section.

## 11. Open decisions carried to ADRs
- ADR-029 background-location SDK (expo-location vs Transistorsoft) after SP-01.
- ADR-033 driver offer wake strategy (push + socket/poll inside FGS) after SP-01 #6.
- Simultaneous-use policy (§5) is proposed; founder may reopen with evidence.
- Pool/courier capabilities extend `ServiceCapability` rather than new accounts (CLAUDE.md §2), confirmed.
