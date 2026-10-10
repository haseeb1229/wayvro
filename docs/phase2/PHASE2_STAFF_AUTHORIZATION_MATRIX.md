# PHASE2_STAFF_AUTHORIZATION_MATRIX — Staff identity, RBAC/ABAC, audit and break-glass (PROPOSED)

**Date:** 2026-10-10 · **Status:** Phase 2 PLAN ONLY. Today `apps/web-ops` is a static Next.js 16.3.8 shell whose own copy says it "has no authentication and must not be deployed to any reachable environment" — it stays undeployable until P2.4 lands. · **Requirements:** H01, H02, H08, K01 (staff realm), K10, Q39, Q42, W07, V07 (staff boundary). · **Related later IDs:** T05 (joiner/mover/leaver, Phase 7), T18 (conflict of interest, Phase 6), T24 (maker-checker generalised, Phase 6), U08 (privileged workstations, Phase 7), N14 (lawful requests, Phase 6).

## 1. Separate trust boundary

- **Separate realm:** `staff.*` tables, separate id space, separate session table, separate token type, separate route group `/v1/admin/*`, separate web surface (`apps/web-ops`). A consumer session can never call `/v1/admin/*` and a staff session can never call consumer routes (guard checks token type first). Staff capabilities are never a Rider/Driver "mode".
- **No client-side authorization:** web-ops renders actions from a server-provided `allowedActions` list for UX only; every API call is authorised again server-side.
- **BFF:** the browser talks only to `apps/web-ops`; the Next.js server holds the staff access token in an `HttpOnly; Secure; SameSite=Strict; __Host-` cookie and forwards it as a bearer token to the API. CSRF: SameSite=Strict + Origin check on every mutating BFF route. The BFF makes no authorization decisions; it relays and forwards request ids. CORS stays closed on the API (no browser calls it directly).
- **Bootstrap:** the first `STAFF_ADMIN` is created by a one-time CLI run by the founder with database access; it refuses if any staff account exists, prints a single-use enrolment link (24 h) and writes an audit event. No default credentials, seeded admin, or backdoor (CLAUDE.md §7).

## 2. Staff authentication (K10, Q42, H01)

| Control | Design |
|---|---|
| Primary factor | **WebAuthn** (FIDO2 security keys or platform passkeys) with `userVerification: required` — phishing-resistant and inherently multi-factor (possession + PIN/biometric on the authenticator). Server library proposal `@simplewebauthn/server` 13.3.x (latest patch of the mature line; 13.3.2+ fixes GHSA-6hxq-p678-4hr2; 14.0.0 is five weeks old as of 2026-10-10 → not chosen under ADR-030); browser `@simplewebauthn/browser` 13.3.x. |
| Enrolment | single-use invitation link (token hash stored, 24 h) delivered out of band by the inviting `STAFF_ADMIN` (no e-mail dependency in Phase 2); staff registers **two** authenticators (primary + backup) before the account becomes `ACTIVE`. |
| SSO | **DESIGN_NOW_ACTIVATE_LATER:** OIDC federation with a company IdP (Google Workspace/Microsoft Entra) once the company tenant exists (EG-19; P2.A6). WebAuthn remains required at the Wayvro layer even with SSO (step-up). Founder decision Q-01. |
| Session | access token 5 min (BFF refreshes silently while active), idle lock 15 min (re-assert WebAuthn to unlock), absolute 8 h, one active session per staff device; all sessions revocable by `STAFF_ADMIN` and on offboarding. |
| Step-up | WebAuthn assertion fresh ≤ 5 min for: KYC approve/reject, restriction create/lift, appeal decision, evidence view, role grant/revoke, requirement-set approval, break-glass, export approval, staff offboarding, session revocation on a consumer's behalf. |
| Recovery | lost authenticator → use backup authenticator; both lost → another `STAFF_ADMIN` re-issues an enrolment (maker-checker: requested by one admin, approved by another; with a single admin in the pilot, founder-only manual path with audit — stated limitation). |
| Brute force | per-staff and per-IP throttles on assertion attempts; WebAuthn makes credential stuffing inapplicable. |
| Device/network controls | Production access through the BFF only; IP allowlist / private network / managed-device checks are **EXTERNAL** with production hosting (Q42 partial; U08 Phase 7). |
| Environment banner | web-ops shows `LOCAL`/`TEST`/`STAGING`/`PRODUCTION` banner from server config on every page (W07). |
| Offboarding | `POST /v1/admin/staff/{id}/offboarding` (step-up): status `OFFBOARDED`, all sessions revoked, credentials revoked, role assignments ended, open case claims released, audit event; integration test proves a revoked staff token fails on the next request (Q42 "offboarding tests"). |

## 3. Roles (code-defined) and attributes

Permissions and role→permission maps are **defined in code** (typed constants, reviewed via PR); the database stores only **assignments** (role, city scope, validity, granter, approver). Nobody can create a new role or permission at runtime.

| Role | Purpose | Assignable by | Maker-checker on grant |
|---|---|---|---|
| `KYC_REVIEWER` | review initial/resubmission/renewal cases in scoped cities | STAFF_ADMIN | yes |
| `KYC_SENIOR_REVIEWER` | escalations, duplicate-signal cases, second approvals, KYC appeals | STAFF_ADMIN | yes |
| `COMPLIANCE_ADMIN` | requirement sets and document types (draft/approve — never both on one set) | STAFF_ADMIN | yes |
| `TRUST_SAFETY_AGENT` | account/driver/vehicle restrictions, restriction appeals, recovery cases | STAFF_ADMIN | yes |
| `SUPPORT_AGENT` | masked account summary, consumer session revocation after verification, open recovery case | STAFF_ADMIN | no (least-privileged) |
| `STAFF_ADMIN` | invite, assign/revoke roles, offboard, view staff sessions | founder bootstrap / another STAFF_ADMIN | yes |
| `AUDITOR` | read audit events and seal verification; read evidence-access log | STAFF_ADMIN | yes |
| `FINANCE_*` (Phase 5+) | — | — | Finance roles receive **no** identity/KYC/restriction permission; defined when the first finance surface exists (not created in Phase 2 to avoid dead code) |

Attributes evaluated on every check (ABAC):
- `cityScope` — case/account city ∈ assignment's cities (Phase 2: `LHR`).
- `caseAssignment` — evidence view and decision only on a case claimed by the actor (or break-glass).
- `notSelf` / `conflict` — the case subject's phone hash ≠ the staff member's declared consumer phone hash; staff cannot act on their own consumer account or one they declared as related (T18 baseline pulled forward as CL-P2-03).
- `notOriginalDecider` — appeal decider ≠ original decision maker / restriction creator.
- `makerNotChecker` — approver ≠ requester for role grants, requirement sets, export requests, in-person overrides, duplicate-signal approvals.
- `assuranceFresh` — WebAuthn step-up within 5 min for privileged actions.
- `environment` — production evidence views require the production KYC activation flag (`ops.kyc-real-evidence`, default OFF until EG-05/EG-10 gates).
- `breakGlass` — an active grant widens scope only for the named scope and duration.

## 4. Authorization matrix (✓ allowed · ✓s step-up required · ✓m maker-checker · — denied)

| Permission (code) | KYC_REVIEWER | KYC_SENIOR | COMPLIANCE_ADMIN | T&S_AGENT | SUPPORT | STAFF_ADMIN | AUDITOR |
|---|---|---|---|---|---|---|---|
| `kyc.queue.view` (scoped) | ✓ | ✓ | — | — | — | — | — |
| `kyc.case.claim` | ✓ | ✓ | — | — | — | — | — |
| `kyc.case.view_masked` | ✓ (claimed) | ✓ | — | ✓ (restriction/recovery link) | — | — | — |
| `vault.evidence.view` (+reason) | ✓s (claimed case) | ✓s | — | ✓s (recovery/duplicate case only) | — | — | — |
| `kyc.decision.needs_info` / `reject` | ✓s | ✓s | — | — | — | — | — |
| `kyc.decision.approve` | ✓s (no open duplicate signal) | ✓s / ✓m second approval | — | — | — | — | — |
| `kyc.decision.require_in_person` | ✓s | ✓s | — | — | — | — | — |
| `kyc.appeal.decide` | — | ✓s (not original) | — | — | — | — | — |
| `compliance.requirement_set.draft` | — | — | ✓ | — | — | — | — |
| `compliance.requirement_set.approve` | — | — | ✓s/✓m (not drafter) | — | — | — | — |
| `compliance.expiry_roster.view` | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `restriction.create` (DRIVER_ROLE/VEHICLE/CAPABILITY/CITY) | — | ✓s (compliance reasons) | — | ✓s | — | — | — |
| `restriction.create` (ACCOUNT) | — | — | — | ✓s | — | — | — |
| `restriction.lift` | — | ✓s (own compliance scope) | — | ✓s (SAFETY/FRAUD lift ✓m) | — | — | — |
| `restriction.appeal.decide` | — | — | — | ✓s (not creator) | — | — | — |
| `account.summary.view_masked` (+reason) | — | — | — | ✓ | ✓ | — | — |
| `account.sessions.revoke_on_behalf` | — | — | — | ✓s | ✓s | — | — |
| `account.recovery_case.open` | — | — | — | ✓ | ✓ | — | — |
| `account.recovery_case.decide` (moves phone/OIDC link) | — | — | — | ✓s/✓m | — | — | — |
| `export.request` | — | — | ✓ | ✓ | — | — | — |
| `export.approve` | — | ✓s/✓m | ✓s/✓m | — | — | — | — |
| `staff.invite` / `staff.role.grant` / `staff.role.revoke` | — | — | — | — | — | ✓s/✓m | — |
| `staff.offboard` | — | — | — | — | — | ✓s | — |
| `audit.events.view` / `audit.seals.verify` | — | — | — | — | — | — | ✓ |
| `vault.access_log.view` | — | — | — | — | — | — | ✓ |
| `breakglass.activate` | ✓s | ✓s | ✓s | ✓s | — | ✓s | — |
| any permission on own consumer account / declared related account | — | — | — | — | — | — | — |

Self-assignment of roles is impossible (`staff.role.grant` with target = self → denied and audited). With a single founder operator in early pilot, maker-checker steps that need two people are **blocked** rather than bypassed; the plan states this operational dependency (EG-20 staffing).

## 5. Reason-for-access, privileged confirmation and exports (W07, H08, CL-06)

- Every PII view (masked account summary, KYC case detail, evidence) requires a reason code (+ text for non-case reasons); the reason is stored with the audit event; views without a reason are rejected server-side (not just hidden in UI).
- Privileged confirmation: destructive or high-impact actions show a confirmation dialog naming the subject and effect, then require a WebAuthn step-up; the API enforces the step-up, the dialog is UX.
- **Bulk export:** deny-by-default. List endpoints are paginated with hard page caps and no "export all". Phase 2 ships the `export_requests` maker-checker workflow with **one** export type that ops needs — the compliance expiry roster (pseudonymous driver ids, document type, expiry date; no names/numbers/images); outputs are encrypted, expire after 24 h, downloads audited. Founder decision Q-15 (alternative: ship no export type and leave W07's export clause DESIGN_NOW).

## 6. Break-glass (H08)

`POST /v1/admin/break-glass-grants { scope (e.g. CITY:LHR KYC_CASES), reason, durationMinutes ≤ 60 }` (step-up) → immediately active (emergency), all actions under it tagged, **alert** raised at activation and expiry, mandatory post-hoc review by `AUDITOR`/founder within 72 h recorded as `REVIEWED`. Alert delivery in Phase 2: high-severity structured log event + web-ops banner for all `STAFF_ADMIN`/`AUDITOR` sessions + SMS to the configured security contact once the SMS vendor is activated (P2.A1). Paging/on-call integration is I07 (Phase 4) — stated, not claimed.

## 7. Tamper-evident audit (Q39)

- Actor, action, object, reason/before-after digest, server timestamp, request id, outcome (`ALLOWED`/`DENIED`) for every privileged action **and every denied privileged attempt**.
- Append-only enforcement: `INSERT`-only grants + trigger rejecting `UPDATE`/`DELETE`/`TRUNCATE`; the migrator role is the only owner.
- Seals: worker job seals closed batches into `audit.audit_seals` (Merkle root + hash chain); `audit.seals.verify` recomputes and reports the first broken batch; a scheduled verification job alerts on mismatch.
- Limits stated honestly: a database owner/superuser can still tamper and re-seal; external anchoring of seal hashes (write-once storage or founder-held copies) closes that gap and is DESIGN_NOW_ACTIVATE_LATER (EG-05). "Tamper-evident enough" per Q39, not tamper-proof.

## 8. Authorization tests (H01 matrix tests)

A table-driven integration suite enumerates **every** `/v1/admin/*` route × every role (+ no role, + offboarded, + consumer token, + expired step-up, + wrong city, + self/conflict subject, + original decider) and asserts the exact expected status and that each denial produced an audit event. Adding a route without a matrix row fails the suite (completeness check over registered routes).
