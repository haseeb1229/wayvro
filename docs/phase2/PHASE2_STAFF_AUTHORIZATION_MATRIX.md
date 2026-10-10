# PHASE2_STAFF_AUTHORIZATION_MATRIX — Staff identity, RBAC/ABAC, audit and break-glass (PROPOSED)

**Date:** 2026-10-10 (planning closure correction applied the same day) · **Status:** Phase 2 PLAN ONLY. Today `apps/web-ops` is a static Next.js 16.3.8 shell whose own copy says it "has no authentication and must not be deployed to any reachable environment" — it stays undeployable until P2.4. · **Founder Q-01 (approved):** WebAuthn-native staff authentication now; company SSO federation later. · **Requirements:** H01, H02, H08, K01 (staff realm), K10, Q39, Q42, W07, V07. · **Later IDs:** T05 (Phase 7), T18 (Phase 6), T24 (Phase 6), U08 (Phase 7), N14 (Phase 6).

## 1. Separate trust boundary

- **Separate realm:** `staff.*` tables, separate ids, sessions, token type and route group `/v1/admin/*`, separate surface `apps/web-ops`. Consumer tokens cannot call admin routes and vice versa. Staff capabilities are never a Rider/Driver mode.
- **No client-side authorization:** web-ops renders server-provided `allowedActions` for UX only; the API authorises every call.
- **BFF:** the browser talks only to web-ops; the Next.js server holds the staff token in an `HttpOnly; Secure; SameSite=Strict; __Host-` cookie and forwards it as a bearer; Origin check on every mutating BFF route; API CORS stays closed.
- **Bootstrap without emergency credentials:** the first `STAFF_ADMIN` is created by a one-time CLI run by the founder with infrastructure/database access; it refuses if any active staff admin exists, issues a single-use enrolment link (24 h) and writes an audit event and alert. **No static emergency password, shared key, default account or backdoor exists** (closure correction §13). If every admin loses every authenticator, recovery is the same audited CLI path, which requires infrastructure access (itself a controlled privilege, T05/Q12) — not a stored credential.

## 2. Staff authentication (K10, Q42, H01)

| Control | Design |
|---|---|
| Primary factor | **WebAuthn** (security keys or platform passkeys) with `userVerification: required`. Library direction: SimpleWebAuthn (`@simplewebauthn/server` + `/browser`), exact mature version re-checked at installation under ADR-030 (planning-time candidate: latest 13.3.x patch; 13.3.2+ fixes GHSA-6hxq-p678-4hr2). |
| Authenticators | Enrolment requires at least one authenticator; **two registered authenticators are required before an account may perform privileged KYC operations on real data** (production `ops.kyc-real-evidence` gate) and are strongly preferred everywhere. |
| Enrolment | single-use invitation (token hash, 24 h) delivered out of band by the inviting `STAFF_ADMIN` (no e-mail dependency — Q-03 deferred). |
| SSO | DESIGN_NOW_ACTIVATE_LATER: OIDC federation with a company IdP (EG-19, P2.A6); WebAuthn stays required at the Wayvro layer. |
| Session | access token 5 min (BFF refresh while active), idle lock 15 min, absolute 8 h; revocable by `STAFF_ADMIN` and on offboarding. |
| Step-up | fresh WebAuthn assertion ≤ 5 min for: KYC approve/reject, restriction create/lift, appeal decisions, evidence view, role grant/revoke, requirement-set approval, break-glass, offboarding, consumer session revocation, recovery-case decisions. |
| Recovery | lost authenticator → backup authenticator; both lost → re-enrolment issued by another `STAFF_ADMIN` with maker-checker (or the bootstrap CLI path when no second admin exists — audited and alerted). |
| Brute force | per-staff and per-IP throttles on assertions. |
| Device/network controls | private network / allowlists / managed devices are EXTERNAL with production hosting (Q42 partial; U08 Phase 7). |
| Environment banner | `LOCAL`/`TEST`/`STAGING`/`PRODUCTION` on every page (W07). |
| Offboarding | status `OFFBOARDED`, sessions + credentials revoked, role assignments ended, case claims released, audit; test proves the next request with an old token fails. |

## 3. Roles (code-defined) and attributes

Permissions and role→permission maps are typed constants reviewed via PR; the database stores only assignments (`staff.role_assignments`) and their city scope (`staff.role_assignment_cities` junction with FK to `catalog.cities`). No runtime role or permission creation.

| Role | Purpose | Maker-checker on grant |
|---|---|---|
| `KYC_REVIEWER` | review initial/resubmission/renewal cases in scoped cities | yes |
| `KYC_SENIOR_REVIEWER` | escalations, duplicate-signal cases, second approvals, KYC appeals, driver KYC recovery cases | yes |
| `COMPLIANCE_ADMIN` | requirement sets, document types, age-eligibility policy data entry (never both draft and approve one version) | yes |
| `TRUST_SAFETY_AGENT` | restrictions, restriction appeals, recovery cases | yes |
| `SUPPORT_AGENT` | masked account summary, consumer session revocation after verification, open recovery case (cannot decide it) | no |
| `STAFF_ADMIN` | invite, assign/revoke roles, offboard | yes |
| `AUDITOR` | audit events, seal verification, evidence-access log | yes |
| `FINANCE_*` (Phase 5+) | no identity/KYC/restriction permission; not created in Phase 2 | — |

ABAC attributes: `cityScope`; `caseAssignment` (evidence and decisions only on claimed cases, or break-glass); `notSelf/conflict` (staff's declared consumer phone lookup ≠ subject — CL-P2-03); `notOriginalDecider`; `makerNotChecker`; `assuranceFresh`; `environment` (`ops.kyc-real-evidence` default OFF until EG-05/EG-10/EG-17 and two authenticators); `breakGlass`.

## 4. Authorization matrix (✓ allowed · ✓s step-up · ✓m maker-checker · — denied)

| Permission | KYC_REVIEWER | KYC_SENIOR | COMPLIANCE_ADMIN | T&S_AGENT | SUPPORT | STAFF_ADMIN | AUDITOR |
|---|---|---|---|---|---|---|---|
| `kyc.queue.view` (scoped, paginated) | ✓ | ✓ | — | — | — | — | — |
| `kyc.case.claim` | ✓ | ✓ | — | — | — | — | — |
| `kyc.case.view_masked` | ✓ (claimed) | ✓ | — | ✓ (restriction/recovery link) | — | — | — |
| `vault.evidence.view` (+reason) | ✓s (claimed case) | ✓s | — | ✓s (recovery/duplicate case only) | — | — | — |
| `kyc.decision.needs_info` / `reject` | ✓s | ✓s | — | — | — | — | — |
| `kyc.decision.approve` | ✓s (no open duplicate signal) | ✓s / ✓m second approval | — | — | — | — | — |
| `kyc.decision.require_in_person` | ✓s | ✓s | — | — | — | — | — |
| `kyc.appeal.decide` | — | ✓s (not original) | — | — | — | — | — |
| `compliance.requirement_set.draft` | — | — | ✓ | — | — | — | — |
| `compliance.requirement_set.approve` | — | — | ✓s/✓m (not drafter) | — | — | — | — |
| `legal.age_policy.draft` / `approve` (data entry of counsel-approved values) | — | — | ✓ / ✓s/✓m | — | — | — | — |
| `compliance.expiry_roster.view` (paginated, scoped, in-app only) | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `restriction.create` (DRIVER_ROLE/VEHICLE/CAPABILITY/CITY) | — | ✓s (compliance reasons) | — | ✓s | — | — | — |
| `restriction.create` (ACCOUNT) | — | — | — | ✓s | — | — | — |
| `restriction.lift` | — | ✓s (own compliance scope) | — | ✓s (`SAFETY`/`FRAUD` ✓m) | — | — | — |
| `restriction.appeal.decide` | — | — | — | ✓s (not creator) | — | — | — |
| `account.summary.view_masked` (+reason) | — | — | — | ✓ | ✓ | — | — |
| `account.sessions.revoke_on_behalf` | — | — | — | ✓s | ✓s | — | — |
| `account.recovery_case.open` | — | — | — | ✓ | ✓ | — | — |
| `account.recovery_case.decide` (moves phone/OIDC link; strong proof only) | — | ✓s/✓m (driver KYC recovery) | — | ✓s/✓m (OIDC-proof recovery) | — | — | — |
| `staff.invite` / `staff.role.grant` / `staff.role.revoke` | — | — | — | — | — | ✓s/✓m | — |
| `staff.offboard` | — | — | — | — | — | ✓s | — |
| `audit.events.view` / `audit.seals.verify` | — | — | — | — | — | — | ✓ |
| `vault.access_log.view` | — | — | — | — | — | — | ✓ |
| `breakglass.activate` | ✓s | ✓s | ✓s | ✓s | — | ✓s | — |
| **any bulk/CSV export of identity or KYC data** | — | — | — | — | — | — | — |
| any permission on own / declared-related consumer account | — | — | — | — | — | — | — |

Self-assignment is denied and audited. With a single operator, two-person steps **block** rather than bypass (EG-20).

## 5. Reason-for-access, privileged confirmation and exports (W07, H08, CL-06)

- Every PII view requires a reason code (+ text for non-case reasons), enforced server-side and stored with the audit event.
- Privileged actions: confirmation dialog naming subject and effect (UX) + WebAuthn step-up (enforced by API).
- **Exports (founder Q-15: NO Phase 2 bulk export; closure correction §10):** Phase 2 provides **paginated, authorization-scoped rosters inside web-ops** (review queue, expiry roster) with hard page caps and no "export all", CSV or download of identity/KYC data. The architectural rule for any future export is recorded: deny-by-default, explicit permission, reason, maker-checker approval, expiry, audit and minimisation; an export capability is introduced only with a demonstrated operational need in a later bounded change.

## 6. Break-glass (H08)

Scoped, ≤ 60 min, step-up, immediately active, actions tagged, alert at start and end, mandatory review within 72 h. Phase 2 alert delivery: high-severity structured event + web-ops banner for `STAFF_ADMIN`/`AUDITOR`, SMS to the security contact once P2.A1 exists; paging is I07 (Phase 4/7, EG-21).

## 7. Tamper-evident audit (Q39)

Actor, action, object, reason/before-after digest, server time, request id and outcome for every privileged action **and every denied attempt**; `INSERT`-only grants + trigger; Merkle/hash-chain seals with scheduled verification; external anchoring DESIGN_NOW_ACTIVATE_LATER (EG-05). Limitation stated: a database superuser can still rewrite and re-seal until anchors exist.

## 8. Authorization tests

Table-driven suite over every `/v1/admin/*` route × {each role, none, offboarded, consumer token, stale step-up, wrong city, self/conflict subject, original decider, single-authenticator account in `ops.kyc-real-evidence` mode} asserting exact status and an audit event per denial; a completeness check fails when a route lacks a matrix row; a route-inventory check asserts that no export/download endpoint for identity or KYC data exists.
