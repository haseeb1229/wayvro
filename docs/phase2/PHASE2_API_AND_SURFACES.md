# PHASE2_API_AND_SURFACES — Endpoint/contract inventory and mobile/web surface plan (PROPOSED)

**Date:** 2026-10-10 (planning closure correction applied the same day) · **Status:** Phase 2 PLAN ONLY — an inventory, not implemented contracts.

## 1. Conventions inherited from Phase 1 (verified)

Zod contracts in `packages/contracts` (no `class-validator`, ADR-005); `RouteContract` + `API_ROUTES` → OpenAPI 3.1 with CI drift check; `idempotency-key` required on every mutating `/v1/*` route (Phase 1 checks shape only — P2.1 adds the persistent store/replay); error envelope `{ error: { code, message, requestId } }` with additive codes (+ optional `details` in Phase 2); `x-request-id` correlation; `.strict()` request bodies with no server-owned fields. Groups: `/v1/auth/*`, `/v1/account/*`, `/v1/legal/*`, `/v1/driver-onboarding/*`, `/v1/driver/*`, `/v1/public/*`, `/v1/admin/*`.

## 2. Inventory

Legend — **Auth:** `public`, `consumer`, `consumer+su` (fresh phone step-up), `restricted-ok`, `staff`, `staff+su`, `staff+mc`. **Idem:** idempotency key (all mutations; replay returns the original response). **Audit:** `A` audit event, `S` account security event, `V` vault access log.

### 2.1 Auth (consumer) — P2.1 / P2.10

| Operation | Method & path | Auth | Rate limit | Audit | PII/log | Enumeration policy |
|---|---|---|---|---|---|---|
| Request OTP | `POST /v1/auth/otp-challenges` | public | OTP family | A (lookup hash only) | phone never logged | identical 202 for any valid number; silent drop on limits |
| Resend OTP | `POST /v1/auth/otp-challenges/{challengeId}/resends` | public | OTP family | A | — | unknown/foreign id ⇒ same generic error |
| Verify OTP → session | `POST /v1/auth/sessions` | public | per challenge + installation | A, S | code/tokens never logged | single generic invalid/expired error |
| Refresh | `POST /v1/auth/token-refreshes` | public (refresh token) | per session | A on reuse | token never logged | invalid/expired/reused ⇒ same 401 |
| Logout current | `DELETE /v1/auth/sessions/current` | consumer, restricted-ok | std | A, S | — | — |
| OIDC nonce | `POST /v1/auth/oidc-nonces` | public | per installation | — | — | — |
| OIDC sign-in | `POST /v1/auth/oidc-sessions` | public | per installation | A, S | ID token never logged | not-linked ⇒ generic 401 |

### 2.2 Account (consumer) — P2.1–P2.3, P2.9, P2.10

| Operation | Method & path | Auth | Audit | Notes |
|---|---|---|---|---|
| Account state | `GET /v1/account/state` | consumer, restricted-ok | — | `{ account, session, requiredActions[] (ACCEPT_POLICIES, AGE_DECLARATION, PHONE_STEP_UP, RECOVERY_REVIEW), riderProfile, driver{application?, profile?{earningEligibility{eligible, blockers[]}}}, restrictions[], features{} }`; later phases add active trip/job fields additively |
| Update profile | `PATCH /v1/account/profile` | consumer | A | allowlist `displayName`, `preferredLocale` |
| Sessions list / revoke one / revoke all-or-others | `GET /v1/account/sessions`, `DELETE /v1/account/sessions/{id}`, `POST /v1/account/session-revocations` | consumer (+su for new sessions) | A, S | owner-scoped; foreign ids 404 |
| Security activity | `GET /v1/account/security-events` | consumer, restricted-ok | — | |
| Step-up | `POST /v1/account/step-ups`, `POST /v1/account/step-ups/{id}/verifications` | consumer, restricted-ok | A, S | |
| Phone change | `POST /v1/account/phone-changes`, `POST /v1/account/phone-changes/{id}/verifications` | consumer+su | A, S | generic conflict refusal |
| Cancel phone change / recovery ("not me") | `POST /v1/account/phone-changes/{id}/cancellation` | consumer, restricted-ok | A, S | from any active session |
| Lost-phone recovery (strong proof only) | `POST /v1/account-recoveries` `{ proof: "LINKED_OIDC" | "DRIVER_KYC" }` | new-number session, restricted-ok | A, S | `LINKED_OIDC` available from P2.10; `DRIVER_KYC` opens a staff case; rider-only without proof ⇒ `WAYVRO_E_RECOVERY_REQUIRED` with "continue with a new account" guidance |
| Dormant-number review choice | `POST /v1/account/recovery-reviews/{id}/choices` | restricted session | A, S | `I_AM_NEW` always; `THIS_IS_MY_ACCOUNT` only with strong proof |
| Policies | `GET /v1/legal/policies` | public | — | versions, hashes, URLs, placeholder status |
| Age policy (public view) | `GET /v1/legal/age-eligibility-policy` | public | — | current version, declaration mode, placeholder status — no threshold hard-coded in clients |
| Record consent | `POST /v1/account/consents` | consumer, restricted-ok | A | server checks `contentSha256` |
| Record age declaration | `POST /v1/account/age-declarations` | consumer, restricted-ok | A | shape depends on policy mode; DOB accepted **only** if the policy requires it |
| Deletion (app) | `POST /v1/account/deletion-requests`, `GET …/current`, `POST …/{id}/cancellation` | consumer+su / consumer | A, S | blockers explicit |
| Deletion (web) | `POST /v1/public/account-deletion-requests` | public + OTP (`ACCOUNT_DELETION_WEB`) | A, S | stricter limits; generic responses |
| Appeals | `POST /v1/account/appeals`, `GET /v1/account/appeals` | consumer, restricted-ok | A | evidence attached through upload slots → `profile.appeal_evidence` |
| OIDC link/unlink | `POST /v1/account/oidc-links`, `DELETE /v1/account/oidc-links/{id}` | consumer+su | A, S | flag-gated |

### 2.3 Driver/Partner onboarding (flag `driver.onboarding`) — P2.5–P2.8

| Operation | Method & path | Auth | Audit | Notes |
|---|---|---|---|---|
| Create / current application | `POST /v1/driver-onboarding/applications`, `GET …/applications/current` | consumer (policies + age declaration satisfied) | A | one non-terminal per account (DB) |
| Update claims | `PATCH /v1/driver-onboarding/applications/{id}` (+ `If-Match`) | consumer | A | allowlist; categories via junction |
| Requirements checklist | `GET …/applications/{id}/requirements` | consumer | — | computed from pinned set |
| Vehicles | `POST …/applications/{id}/vehicles`, `PATCH …/vehicles/{vehicleId}` | consumer | A | duplicate plate ⇒ affiliation + signal |
| Capture challenge (optional) | `POST …/applications/{id}/capture-challenges`, `POST …/capture-challenges/{id}/declines` | consumer | A | accessible set; decline is neutral |
| Upload slot | `POST …/applications/{id}/evidence-uploads` `{ requirementKey, kind, captureSource, byteSize, mime }` | consumer | A | selfie kind ⇒ `IN_APP_CAMERA` only; documents ⇒ camera or import |
| Upload completion / discard | `POST /v1/driver-onboarding/evidence-uploads/{uploadId}/completion`, `DELETE …/{uploadId}` | consumer | A | |
| Submit / withdraw | `POST …/applications/{id}/submission`, `POST …/withdrawal` | consumer | A | CAS on version |
| Driver compliance view | `GET /v1/driver/compliance` | consumer with driver profile | — | driver-scoped (V07) |
| Document renewal | `POST /v1/driver/documents/{documentId}/renewals` | consumer with driver profile | A | |

Foreign ids ⇒ 404 (not 403).

### 2.4 Staff (`/v1/admin/*`) — P2.4, P2.5, P2.7, P2.9

| Area | Operations | Auth | Audit |
|---|---|---|---|
| Staff auth | `POST /v1/admin/auth/webauthn-options`, `…/auth/sessions`, `…/auth/step-ups`, `…/auth/unlocks`, `DELETE …/auth/sessions/current`, `POST …/auth/enrolments` | public→staff | A (incl. failures) |
| Staff admin | invitations, role assignments (+ approvals, city scope), offboarding, staff sessions | staff+su(+mc) | A |
| Review queue | `GET /v1/admin/review-cases` (paginated, scoped), claims, case detail (masked) | staff | A |
| Evidence | `POST /v1/admin/evidence-views`, `GET /v1/admin/evidence-views/{token}/content` | staff+su | A, V |
| Decisions | `POST /v1/admin/review-cases/{id}/decisions`, `POST /v1/admin/review-decisions/{id}/second-approvals` | staff+su(+mc) | A |
| Appeals | list, claim, decide | staff+su | A |
| Restrictions | list, create, lift (+ approval) | staff+su(+mc) | A |
| Requirement sets / age policy | draft, submit, approve | staff+su(+mc) | A |
| Expiry roster | `GET /v1/admin/compliance/expiry-roster` (paginated, scoped, **no download**) | staff | A |
| Accounts (support/T&S) | masked summary (reason), consumer session revocation, recovery cases (open / decide — strong proof only) | staff(+su,+mc) | A |
| Break-glass | activate, end, review | staff+su | A + alert |
| Audit | events, seal verification, evidence-access log | staff (AUDITOR) | A |

**No export/download endpoint for identity or KYC data exists in Phase 2** (founder Q-15).

### 2.5 Realtime and events
Consumer access token authenticates the handshake (P2.1). Phase 2 emits `session.hello` and an `account.state-changed.v1` hint (aggregate id/version only; client refetches). Outbox events (relay wired in P2.7 with its first consumer): `identity.account.created.v1`, `driver.application.submitted.v1`, `driver.application.decided.v1`, `driver.approved.v1`, `restriction.changed.v1` — ids and reason codes only.

### 2.6 Contract process
Free evolution inside Phase 2 until the exit snapshot; then the generated OpenAPI becomes the baseline and the deferred `oasdiff` gate (ADR-027) is enabled for Phase 3. Integration tests validate responses against schemas.

## 3. Mobile surface plan — `apps/wayvro-mobile` (the ONE public app)

Today: Expo SDK 57.0.27 / RN 0.86.3 static shell; no navigation, HTTP client, secure storage or `@wayvro/*` dependency; i18n `en`/`ur`; Android allowlist INTERNET only (CAMERA forbidden).

| Area | P2 | Content |
|---|---|---|
| `src/core/session/*` | P2.3 | secure token store (`expo-secure-store`), installation id, single-flight refresh, logout cleanup |
| `src/core/api/*` | P2.3 | typed client on `@wayvro/contracts`; persisted idempotency keys per intent; bounded jittered retries |
| `src/core/account/*` | P2.3 | account-state routing by server truth (required actions, restrictions) |
| `src/features/account/*` | P2.3, P2.9 | phone/OTP, policy acceptance, **age declaration in the form the policy requires** (A15), profile, sessions, security activity, phone change, recovery (strong-proof paths; "start a new account" guidance), deletion |
| `src/features/driver/onboarding/*` | P2.8 | lazy-loaded; consent; claims; **document capture via camera or controlled import**, **selfie camera-only** with the optional accessible challenge; upload queue with retry/resume and cache cleanup; checklist; status / NEEDS_INFO / rejected / appeal / in-person; driver compliance view + renewal |
| `src/core/i18n/*` | all UI | keys for `en`, `ur`, `ur-Latn` (non-English marked pending native review); RTL checks |
| View states | all | loading, empty, error+retry, offline, permission-denied (camera ⇒ import for documents / in-person path for selfie), partial success, disabled, destructive confirmation |

Not in Phase 2: location of any kind, foreground services, push/notification permission, driver online/offer UI, mode-switch navigation graphs (V08, Phase 3). Rider-only users never see camera/KYC prompts (unit test + dependency-cruiser rule: camera/picker modules only imported from the lazily loaded onboarding entry).

Permission allowlist change (P2.8, founder review per the allowlist rule): `android.permission.CAMERA` → allowed (K02/K03/D02, just-in-time). Controlled import uses the system photo picker; the import library's manifest contribution is verified at installation so that `READ_EXTERNAL_STORAGE`/`READ_MEDIA_IMAGES` are **not** added (if a library would add them, it is not adopted without a separate decision). iOS usage strings localised; `RECORD_AUDIO` stays forbidden.

Dependencies (architecture direction approved conditionally — founder Q-11/Q-13): `expo-secure-store`, `expo-router`, `@tanstack/react-query` (P2.3); `expo-camera`, `expo-image-picker`, `expo-file-system` (declared; already transitive) (P2.8). **Exact versions are re-checked when installed** (stable SDK-57-compatible releases via `npx expo install`, advisories, licence, publish age, lockfile impact, ADR-030); planning-time versions are not approvals.

## 4. Web surfaces

### apps/web-public (W05, U06, A15)
- `/legal/{policy}`, `/legal/{policy}/{version}` (immutable, dated), `/legal/changelog`; English + Urdu; placeholders show **"PLACEHOLDER — NOT FOR PRODUCTION — pending counsel approval"** and `noindex`. The age/guardian policy explanation is published the same way once counsel approves it.
- Content source: data-only package proposed as `packages/legal-content` (markdown + generated manifest with SHA-256/status/effective date); web-public renders statically; the API seeds `legal.policy_documents` from the same manifest. Production refuses required placeholders.
- `/account-deletion`: explanation + OTP-verified web request; no account information displayed.
- No driver documents on the public web (W03).

### apps/web-ops (W07, H01, H02, H08)
- P2.4 authenticated shell: WebAuthn login/enrolment, environment banner, idle lock, keyboard-accessible navigation, server-provided `allowedActions`, `noindex` + `no-store`.
- Modules: KYC queue & case (masked), evidence viewer (reason, one-time token, watermark, no download), decisions (checklist, step-up), appeals, restrictions, requirement sets and age-policy data (maker-checker), **paginated expiry/review rosters (no export)**, support summary, recovery cases, staff admin, break-glass, audit/seal verification.
- Real production KYC evidence stays unviewable until `ops.kyc-real-evidence` is enabled after EG-05/EG-10/EG-17 and two-authenticator enrolment.
- Accessibility: Playwright + axe on a **seasoned, supported stable Playwright line chosen at implementation time** (not frozen from planning-day release data), introduced with the first real screens (P2.2/P2.4).
