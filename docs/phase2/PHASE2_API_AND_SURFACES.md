# PHASE2_API_AND_SURFACES — Endpoint/contract inventory and mobile/web surface plan (PROPOSED)

**Date:** 2026-10-10 · **Status:** Phase 2 PLAN ONLY — an inventory, not implemented contracts. Names follow existing Phase 1 conventions and may be refined during each micro-phase's contract review.

## 1. Conventions inherited from Phase 1 (verified)

- Contracts are Zod schemas in `packages/contracts` (framework-independent; no `class-validator`, ADR-005); `RouteContract { operationId, method, path:'/v1/...', summary, responses }`; `API_ROUTES` drives OpenAPI 3.1 generation into `packages/contracts/openapi/` with CI drift check (`pnpm openapi:check`).
- Every mutating `/v1/*` route already requires an `idempotency-key` header (shape-checked in `apps/api/src/http/hooks.ts`); Phase 2 adds the persistent store and replay (`platform.idempotency_records`).
- Errors: `{ error: { code, message, requestId } }` with additive `WAYVRO_E_*` codes; Phase 2 adds an optional `details` object (auth design §9).
- `x-request-id` correlation exists end to end.
- Groups from docs/07: `/v1/auth/*`, `/v1/account/*`, `/v1/driver-onboarding/*`, `/v1/vehicles/*` (folded into onboarding in Phase 2), `/v1/admin/*`. Phase 2 adds `/v1/legal/*` (public policy registry) and `/v1/driver/*` (approved-driver compliance view).
- Request bodies are `.strict()`; server-owned fields never appear in request schemas.

## 2. Inventory

Legend — **Auth:** `public` (no session), `consumer` (consumer session), `consumer+su` (fresh phone step-up), `restricted-ok` (callable from a restricted session), `staff` / `staff+su` (WebAuthn step-up), `staff+mc` (maker-checker). **Idem:** idempotency key required (all mutations; ✓ = replay returns the original response). **RL:** rate-limit family (see auth design §2.4; `std` = per-session 60/min, `upl` = upload slot limits). **Audit:** `A` audit event, `S` account security event, `V` vault access log. **Enum:** enumeration policy.

### 2.1 Auth (consumer) — P2.1 / P2.10

| Operation | Method & path | Auth | Idem | RL | Audit | PII/log rules | Enumeration policy |
|---|---|---|---|---|---|---|---|
| Request OTP | `POST /v1/auth/otp-challenges` | public | ✓ | OTP family | A (hashed phone) | phone never logged; masked destination only in response | identical 202 for any valid number; silent drop on limits |
| Resend OTP | `POST /v1/auth/otp-challenges/{challengeId}/resends` | public | ✓ | OTP family | A | — | unknown/foreign challenge id ⇒ same generic error |
| Verify OTP → session | `POST /v1/auth/sessions` | public | ✓ | per challenge + per installation | A, S | code/tokens never logged | single generic invalid/expired error |
| Refresh | `POST /v1/auth/token-refreshes` | public (refresh token) | ✓ (30 s leeway replay) | per session | A on reuse | token never logged | invalid/expired/reused ⇒ same 401 |
| Logout current | `DELETE /v1/auth/sessions/current` | consumer, restricted-ok | ✓ | std | A, S | — | — |
| OIDC nonce | `POST /v1/auth/oidc-nonces` | public | ✓ | per installation | — | — | — |
| OIDC sign-in | `POST /v1/auth/oidc-sessions` | public | ✓ | per installation | A, S | ID token never logged | not-linked ⇒ generic 401, no account/email hint |

### 2.2 Account (consumer) — P2.1–P2.3, P2.9, P2.10

| Operation | Method & path | Auth | Idem | Audit | Notes |
|---|---|---|---|---|---|
| Account state snapshot | `GET /v1/account/state` | consumer, restricted-ok | — | — | `{ account{id,status,displayName,locale,phoneMasked}, session{assurance,stepUpFresh}, requiredActions[], riderProfile{id,status}, driver{application?{id,state,itemsNeedingAction[]}, profile?{id,state,earningEligibility{eligible,blockers[]}}}, restrictions[{scope,reasonCode,appealable,appealId?}], features{} }`; later phases add `activeRiderTrip`/`activeDriverJob` additively |
| Update profile | `PATCH /v1/account/profile` | consumer | ✓ | A | allowlist: `displayName`, `preferredLocale` |
| List sessions | `GET /v1/account/sessions` | consumer | — | — | own sessions only |
| Revoke one session | `DELETE /v1/account/sessions/{sessionId}` | consumer | ✓ | A, S | 404 for foreign ids (IDOR-safe) |
| Revoke all / others | `POST /v1/account/session-revocations` | consumer (+su if session < 24 h old) | ✓ | A, S | `{scope: ALL|ALL_OTHERS}` |
| Security activity | `GET /v1/account/security-events` | consumer, restricted-ok | — | — | A11 |
| Start step-up | `POST /v1/account/step-ups` | consumer, restricted-ok | ✓ | A | OTP to current phone |
| Complete step-up | `POST /v1/account/step-ups/{id}/verifications` | consumer, restricted-ok | ✓ | A, S | |
| Start phone change | `POST /v1/account/phone-changes` | consumer+su | ✓ | A, S | conflict ⇒ generic refusal |
| Verify new phone | `POST /v1/account/phone-changes/{id}/verifications` | consumer+su | ✓ | A, S | |
| Cancel phone change / recovery ("not me") | `POST /v1/account/phone-changes/{id}/cancellation` | consumer, restricted-ok | ✓ | A, S | from any active session |
| Recovery request (lost phone) | `POST /v1/account-recoveries` | consumer (new-number session), restricted-ok | ✓ | A, S | proof: OIDC re-auth or staff case |
| Recovery-review choice (dormant number) | `POST /v1/account/recovery-reviews/{id}/choices` | restricted session | ✓ | A, S | `THIS_IS_MY_ACCOUNT` / `I_AM_NEW` |
| Current policies | `GET /v1/legal/policies` | public | — | — | versions, hashes, canonical URLs, status (placeholder flagged) |
| Record consent | `POST /v1/account/consents` | consumer, restricted-ok | ✓ | A | `{policyKey, version, contentSha256, locale, action}`; server rejects mismatched hash |
| List consents | `GET /v1/account/consents` | consumer | — | — | |
| Request deletion | `POST /v1/account/deletion-requests` | consumer+su, restricted-ok | ✓ | A, S | blockers returned explicitly |
| Deletion status | `GET /v1/account/deletion-requests/current` | consumer, restricted-ok | — | — | |
| Cancel deletion | `POST /v1/account/deletion-requests/{id}/cancellation` | consumer | ✓ | A, S | within grace |
| Web deletion request | `POST /v1/public/account-deletion-requests` | public + OTP challenge (`ACCOUNT_DELETION_WEB`) | ✓ | A, S | stricter OTP limits; generic responses |
| Appeals (submit/list) | `POST /v1/account/appeals`, `GET /v1/account/appeals` | consumer, restricted-ok | ✓ | A | subject must belong to the caller |
| Link OIDC | `POST /v1/account/oidc-links` | consumer+su | ✓ | A, S | flag-gated |
| Unlink OIDC | `DELETE /v1/account/oidc-links/{id}` | consumer+su | ✓ | A, S | |

### 2.3 Driver/Partner onboarding (consumer; flag `driver.onboarding`) — P2.5–P2.8

| Operation | Method & path | Auth | Idem | Audit | Notes |
|---|---|---|---|---|---|
| Create application | `POST /v1/driver-onboarding/applications` | consumer (policies accepted) | ✓ | A | one non-terminal per account (DB) |
| Current application | `GET /v1/driver-onboarding/applications/current` | consumer, restricted-ok | — | — | masked values only |
| Update claims | `PATCH /v1/driver-onboarding/applications/{id}` | consumer | ✓ + `If-Match` version | A | allowlist; only in DRAFT/CONSENTED/DOCUMENTS_PENDING/NEEDS_INFO |
| Requirements checklist | `GET /v1/driver-onboarding/applications/{id}/requirements` | consumer | — | — | computed from pinned set |
| Vehicle add/update | `POST /v1/driver-onboarding/applications/{id}/vehicles`, `PATCH …/vehicles/{vehicleId}` | consumer | ✓ | A | duplicate-plate ⇒ affiliation + signal, generic message |
| Selfie capture challenge | `POST /v1/driver-onboarding/applications/{id}/selfie-challenges` | consumer | ✓ | A | 5 min |
| Upload slot | `POST /v1/driver-onboarding/applications/{id}/evidence-uploads` | consumer | ✓ | A | RL `upl`; returns presigned PUT (quarantine) |
| Upload completion | `POST /v1/driver-onboarding/evidence-uploads/{uploadId}/completion` | consumer | ✓ | A | |
| Discard upload | `DELETE /v1/driver-onboarding/evidence-uploads/{uploadId}` | consumer | ✓ | A | before submission only |
| Submit | `POST /v1/driver-onboarding/applications/{id}/submission` | consumer | ✓ | A | CAS on version |
| Withdraw | `POST /v1/driver-onboarding/applications/{id}/withdrawal` | consumer | ✓ | A | |
| Driver compliance view | `GET /v1/driver/compliance` | consumer with driver profile | — | — | documents (masked), expiries, blockers, restrictions — driver-scoped (V07) |
| Document renewal | `POST /v1/driver/documents/{documentId}/renewals` | consumer with driver profile | ✓ | A | opens renewal case; uploads via the same slot flow |

All onboarding reads/writes are scoped by `account_id = principal` **and** the application/profile id; a rider session of another account receives 404 (not 403) for foreign ids.

### 2.4 Staff (`/v1/admin/*`) — P2.4, P2.5, P2.7, P2.9

| Area | Operations (method & path) | Auth (matrix doc) | Audit |
|---|---|---|---|
| Staff auth | `POST /v1/admin/auth/webauthn-options`, `POST /v1/admin/auth/sessions`, `POST /v1/admin/auth/step-ups`, `POST /v1/admin/auth/unlocks`, `DELETE /v1/admin/auth/sessions/current`, `POST /v1/admin/auth/enrolments` (invitation token) | public→staff | A (incl. failures) |
| Staff admin | `POST /v1/admin/staff-invitations`, `GET /v1/admin/staff`, `POST /v1/admin/staff/{id}/role-assignments`, `POST /v1/admin/role-assignments/{id}/approvals`, `DELETE /v1/admin/role-assignments/{id}`, `POST /v1/admin/staff/{id}/offboarding`, `GET /v1/admin/staff/{id}/sessions`, `DELETE /v1/admin/staff-sessions/{id}` | staff+su(+mc) | A |
| Review queue | `GET /v1/admin/review-cases`, `POST /v1/admin/review-cases/{id}/claims`, `DELETE /v1/admin/review-cases/{id}/claims/current`, `GET /v1/admin/review-cases/{id}` | staff | A (views with reason) |
| Evidence | `POST /v1/admin/evidence-views`, `GET /v1/admin/evidence-views/{token}/content` | staff+su | A, V |
| Decisions | `POST /v1/admin/review-cases/{id}/decisions`, `POST /v1/admin/review-decisions/{id}/second-approvals` | staff+su(+mc) | A |
| Appeals | `GET /v1/admin/appeals`, `POST /v1/admin/appeals/{id}/claims`, `POST /v1/admin/appeals/{id}/decisions` | staff+su | A |
| Restrictions | `GET /v1/admin/restrictions`, `POST /v1/admin/restrictions`, `POST /v1/admin/restrictions/{id}/lifts`, `POST /v1/admin/restriction-lifts/{id}/approvals` | staff+su(+mc) | A |
| Requirement sets | `GET/POST /v1/admin/requirement-sets`, `PATCH /v1/admin/requirement-sets/{id}`, `POST …/{id}/submissions`, `POST …/{id}/approvals` | staff+su(+mc) | A |
| Expiry roster | `GET /v1/admin/compliance/expiry-roster` | staff | A |
| Accounts (support/T&S) | `GET /v1/admin/accounts/{id}` (reason required), `POST /v1/admin/accounts/{id}/session-revocations`, `POST /v1/admin/recovery-cases`, `POST /v1/admin/recovery-cases/{id}/decisions` | staff(+su,+mc) | A |
| Exports | `POST /v1/admin/export-requests`, `POST …/{id}/approvals`, `GET …/{id}/download` | staff+su(+mc) | A |
| Break-glass | `POST /v1/admin/break-glass-grants`, `POST …/{id}/end`, `POST …/{id}/reviews` | staff+su | A + alert |
| Audit | `GET /v1/admin/audit-events`, `POST /v1/admin/audit-seal-verifications`, `GET /v1/admin/evidence-access-log` | staff (AUDITOR) | A |

### 2.5 Realtime and events

- Realtime: handshake authenticated with the consumer access token (P2.1); Phase 2 emits only `session.hello` plus an `account.state-changed.v1` hint (no payload beyond the aggregate id/version — client refetches `/v1/account/state`), used when a reviewer decision or restriction changes what the app should show. Realtime is never authoritative (ADR-005b).
- Outbox events (worker relay, first real use — removes the Knip production-mode exception for `relay.ts`/`idempotent-consumer.ts` if wired in P2.7; otherwise the exception stays with its gate): `identity.account.created.v1`, `driver.application.submitted.v1`, `driver.application.decided.v1`, `driver.approved.v1` (docs/07 name), `restriction.changed.v1`. Payloads carry ids and reason codes only (redaction class `INTERNAL_NO_PII`). Only add an event with a consumer in the same micro-phase.

### 2.6 Contract and compatibility process

- Phase 2 is the first product contract; no released consumer exists, so changes inside Phase 2 are free **until the Phase 2 exit snapshot**. At Phase 2 exit, the generated OpenAPI is snapshotted as the baseline and the deferred `oasdiff` breaking-change gate (ADR-027) is enabled for Phase 3 onward.
- Contract tests: every route's request/response schema is exercised by integration tests (responses validated against the Zod schema at test time); OpenAPI drift check stays in CI; mobile/web clients consume only `@wayvro/contracts` types.

## 3. Mobile surface plan — `apps/wayvro-mobile` (the ONE public app)

**Today:** Expo SDK 57.0.27 / RN 0.86.3 static shell; no navigation, no HTTP client, no secure storage, no `@wayvro/*` dependency; i18n `en`/`ur` table in `src/core/i18n/strings.ts`; feature READMEs only; Android permission allowlist = INTERNET only, CAMERA forbidden.

| Area (path) | P2 micro-phase | Content |
|---|---|---|
| `src/core/session/*` | P2.3 | secure token store (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` / Android Keystore-backed), installation id (random, secure store), single-flight refresh, logout cleanup (tokens, cached files, query cache) |
| `src/core/api/*` | P2.3 | typed client over `fetch` using `@wayvro/contracts` schemas, `Idempotency-Key` generation per user intent (persisted for retry), request ids, error envelope mapping to view states, bounded retries with jitter (no retry storms) |
| `src/core/account/*` | P2.3 | account-state query + routing by server truth (required actions → consent/recovery screens; restrictions → explanation screens) |
| `src/features/account/*` | P2.3, P2.9 | phone entry (+92 hint, Urdu digits accepted), OTP (single field, autofill props), profile (name/locale), sessions list + revoke, security activity, consents, phone change, recovery, deletion (in-app) |
| `src/features/driver/onboarding/*` | P2.8 | lazy-loaded after `driver.apply` capability; explanation/consent, claims form, camera capture screens (`expo-camera`, requested **just in time** at the first capture step), upload queue with retry/resume, requirement checklist, status/NEEDS_INFO/rejected/appeal/in-person screens, driver compliance view for approved drivers |
| `src/core/i18n/*` | every UI micro-phase | all copy via keys; `en` complete; `ur` and Roman-Urdu (`ur-Latn`) placeholders clearly marked until native-speaker review; RTL layout checks; no hard-coded strings in logic |
| View states | every screen | loading, empty, error (with retry), offline, permission-denied (camera → manual path), partial success (some uploads failed), disabled (flag off / restricted), destructive confirmation (logout all, deletion, withdrawal) |

Not in Phase 2: background location, location permission, foreground services, push/notification permission, driver online/offer UI, mode-switch navigation graphs (V08, Phase 3). Rider-only users never see camera/KYC prompts (V05/INV-07 groundwork; enforced by a mobile unit test that the camera module is only imported from the lazily loaded onboarding entry, plus dependency-cruiser rule).

Permission allowlist change (P2.8): move `android.permission.CAMERA` from `forbidden` to `allowed` with justification "Driver/Partner onboarding document and selfie capture; requested just in time; requirement IDs K02/K03/D02" — **requires founder review per the allowlist's own rule**; iOS `NSCameraUsageDescription` text localised; `RECORD_AUDIO` stays forbidden (`expo-camera` audio disabled via config plugin option).

Dependencies (proposals, not installed): `expo-secure-store` 57.0.x, `expo-camera` 57.0.x, `expo-router` (SDK-57-aligned) + required peers, `@tanstack/react-query` (founder Q-13), `expo-file-system` (already a transitive dependency of `expo`; becomes declared to delete cached captures). Exact versions chosen by `npx expo install` for SDK 57 at implementation time and recorded in the ADR. Bundle/startup impact measured in P2.3/P2.8 (V11 baseline numbers, device measurements remain SP-02).

## 4. Web surfaces

### apps/web-public (W05, U06)
- `/legal/{policy}` (current) and `/legal/{policy}/{version}` (immutable, dated), `/legal/changelog`; English + Urdu routes; every placeholder version displays a prominent **"PLACEHOLDER — NOT FOR PRODUCTION — pending counsel approval"** banner and `noindex`.
- Content source: a new data-only package proposed as `packages/legal-content` (markdown per policy/version/locale + a generated manifest with SHA-256, status, effective date). web-public renders it statically; the API seeds `legal.policy_documents` from the same manifest, so the hash a user accepts in the app is the hash of the text published on the web (single source, no app→app import). Production build/boot refuses placeholders for required policies.
- `/account-deletion`: explains in-app deletion, retention exceptions (placeholder until counsel) and offers the OTP-verified web request (uses `/v1/public/account-deletion-requests`); bot controls = OTP limits + per-IP throttle; no account information displayed.
- No driver-document collection on the public web (W03 rule).

### apps/web-ops (W07, H01, H02, H08)
- Authenticated shell (P2.4): WebAuthn login/enrolment, environment banner, idle lock overlay, keyboard-accessible navigation, responsive layout, server-provided `allowedActions`, `noindex` + `no-store` (already present).
- Modules (P2.4–P2.7): KYC queue & case view (masked by default), evidence viewer (reason modal, one-time token, watermark overlay, no download), decision forms with checklist and reason codes + step-up, appeals, restrictions, requirement sets (draft/approve), expiry roster, support account summary (reason-gated), recovery cases, staff admin, break-glass, audit viewer/seal verification, export requests.
- Real production KYC evidence is not viewable until `ops.kyc-real-evidence` is enabled after EG-05/EG-10/EG-17 (and the DPIA's conditions); staging/local use synthetic evidence only.
- Accessibility: keyboard paths and screen-reader labels checked with Playwright + axe when E2E tooling lands (ADR-027 deferred Playwright to the first real screens — P2.4 brings real screens, so Playwright is proposed for P2.4; founder Q-11 covers the dependency set).
