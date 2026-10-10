# PHASE2_AUTH_SESSION_DESIGN — Phone OTP, sessions, recovery, step-up and OIDC linking (PROPOSED)

**Date:** 2026-10-10 · **Status:** Phase 2 PLAN ONLY. No auth code, dependency or provider account exists. · **Requirements:** A02, A03, A05, A11, K01, K08, K09, K13, K15, K16, K17, Q01, Q06, Q36, S12, S13, V02 (staff authentication: `docs/phase2/PHASE2_STAFF_AUTHORIZATION_MATRIX.md`). · **Entities/state machines:** `docs/phase2/PHASE2_DOMAIN_AND_DATA_MODEL.md`.

## 1. Decision summary

| Topic | Decision (proposed) | Alternatives rejected (detail: `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md`) |
|---|---|---|
| Auth framework | **Implement the consumer auth domain directly** as NestJS modules over `node:crypto`, PostgreSQL and Valkey. No auth framework. | Better Auth, Lucia (deprecated), Passport, Ory Kratos, Keycloak, SuperTokens, Firebase/Supabase Auth |
| Consumer credential | Phone OTP is the only credential (CL-01). Google/Apple are optional linked conveniences, never phone-ownership proof. | email/password; OIDC-only accounts |
| Token model | **Opaque** random tokens (256-bit, base64url), stored only as SHA-256: short access token (15 min) + rotating refresh token (single-use, family = session, reuse detection). | JWT access tokens (revocation latency, key management for no benefit at pilot scale) |
| Revocation | Immediate: every request validates the session row (Valkey read-through cache ≤ 30 s, invalidated on revoke via pub/sub; DB is truth). | stateless JWT + deny-list |
| Realtime | `apps/realtime` binds a session-token authenticator in place of `DenyAllAuthenticator`; same verifier, fail-closed. | separate HMAC socket tokens |
| Mobile storage | Tokens only in OS secure storage (`expo-secure-store`, Keychain/Keystore); nothing in AsyncStorage/logs (Q01). | AsyncStorage, MMKV |
| OIDC verification | `jose` 6.2.x for ID-token/JWKS verification (P2.10). | hand-rolled JOSE; `google-auth-library`; `openid-client` (full RP not needed) |
| OTP delivery | Existing `OtpDeliveryPort` (`send({to, message, channel})`); code generation/verification stays server domain logic (as the port comment already requires). Real SMS/WhatsApp adapters only in activation P2.A1. | vendor-side verify APIs (vendor would own the security property and the data) |

## 2. OTP design (A02, A03, K08, Q06)

### 2.1 Request
`POST /v1/auth/otp-challenges` `{ phone, purpose: "SIGN_IN", installationId, locale }` + `Idempotency-Key`.
1. Normalise with `normalisePakistanMobile()`; reject non-PK, landline, malformed with `WAYVRO_E_VALIDATION` (this reveals only syntax, never account existence). Only `+923XXXXXXXXX` is accepted at launch — this also removes international premium-rate pumping targets.
2. Evaluate limits atomically (Valkey Lua scripts; §2.4). **If Valkey is unavailable, OTP issuance fails closed** (`503 WAYVRO_E_DEPENDENCY_UNAVAILABLE`), because sending SMS without limits is the cost-abuse failure.
3. Supersede any `ISSUED` challenge for the same phone + purpose + installation.
4. Generate a 6-digit code with `crypto.randomInt(0, 1_000_000)` (uniform), store `code_mac = HMAC-SHA-256(OTP_PEPPER, challengeId ‖ code)`; never store or log the code.
5. Send through the configured channel order (SMS primary; WhatsApp authentication template fallback when activated — FD-05). The message template contains the code, a "never share" warning, no link, and (when P2.A1 adds it) the Android SMS Retriever app hash.
6. Respond **always** `202 { challengeId, expiresAt, resendAvailableAt, channel, maskedDestination }` for any syntactically valid number — whether or not an account exists, whether limits silently suppressed delivery (see 2.4 "silent drop"), or delivery is pending. Timing is equalised by doing the same DB/Valkey work on every path and sending asynchronously via the job table.

### 2.2 Verify
`POST /v1/auth/sessions` `{ challengeId, code, installationId, device: { platform, appVersion } }` + `Idempotency-Key`.
- Constant-time MAC comparison (`crypto.timingSafeEqual`). Wrong code → `attempts += 1`; at `max_attempts` (5) the challenge becomes `LOCKED`. Error: `401 WAYVRO_E_OTP_INVALID_OR_EXPIRED` for wrong/expired/consumed/superseded/unknown challenge (identical body); `WAYVRO_E_OTP_LOCKED` only for a challenge the caller already holds (reveals nothing about accounts).
- Success = CAS `ISSUED → CONSUMED` in the same transaction that: finds the account by `phone_lookup_hash` or creates `accounts` + `account_phones` + `rider_profiles` (the partial unique index resolves concurrent first-sign-in races: the loser re-reads and signs into the winner's account); runs the recycled-number check (§5); upserts the device; creates the session and refresh token; writes the audit and security events.
- Response: `201 { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, sessionId, isNewAccount, requiredActions[] }`. After ownership is proven, revealing `isNewAccount` to the phone owner is not enumeration.
- Server time only (Q23); the device clock is never consulted.

### 2.3 Resend
`POST /v1/auth/otp-challenges/{id}/resends` — allowed after `resendAvailableAt`; cooldown escalates 60 s → 120 s → 300 s; max 3 resends per challenge; resend re-generates the code (old code invalid) and counts against every limit.

### 2.4 Limits, quotas and pumping controls (initial values; all configuration, tuned with data)

| Dimension | Limit | On breach |
|---|---|---|
| Challenge TTL | 5 min | `EXPIRED` |
| Verify attempts per challenge | 5 | `LOCKED` |
| Sends per phone | 5 / hour, 10 / 24 h | generic 202 + **silent drop** (no SMS); counter visible to ops |
| Failed challenges per phone | 5 locked/expired-unverified / 24 h | phone cooldown 24 h; generic response; T&S review signal |
| Sends per installation | 10 / 24 h | `429 WAYVRO_E_RATE_LIMITED` (installation already holds its own history; no account information leaks) |
| Sends per client IP | soft 30 / h per IPv4 /24 or IPv6 /56 → risk score; hard 200 / h | `429` at hard limit only — Pakistani mobile carriers use CGNAT, so IP is a weak signal |
| Per number prefix (first 5 digits) and per ASN | conversion-rate monitor: verified ÷ sent < 30 % over ≥ 200 sends / h | alert + automatic temporary friction (longer cooldown) for that prefix/ASN |
| Global spend | daily and monthly budget per provider; alerts at 50/80/100 % (RSK-011/RSK-018) | at 100 %: new sends refused with `503 WAYVRO_E_DEPENDENCY_UNAVAILABLE`, existing sessions unaffected; never "verified without OTP" |

"Silent drop" is deliberate: telling an attacker "limit reached for this number" would confirm number-level state; the legitimate owner is told in-app "If you didn't receive a code, try again later" after the normal cooldown. Device attestation (Play Integrity/App Attest, Q02) is a Phase 4 signal that can later relax/tighten friction; CAPTCHA is not used in the mobile flow (AB-01).

### 2.5 Vendor outage
Channel order SMS → WhatsApp (when both are activated). If every channel fails: challenge `DELIVERY_FAILED`, response to the next status poll / resend explains "We couldn't send a code right now" (`503`), with retry-after; no verification without a delivered code; no master OTP, no bypass list, no "trusted tester" numbers in any environment beyond the local/test sink (§8).

### 2.6 Native conveniences
iOS `textContentType="oneTimeCode"` and Android `autoComplete="sms-otp"` are built into React Native — no dependency, single OTP input field (multi-field autofill bugs, R4 §6). Android SMS Retriever needs a native module and a vendor template with the app hash → DESIGN_NOW_ACTIVATE_LATER with P2.A1. Auto-read is a convenience, never proof (docs/18 §A.6).

## 3. Sessions and tokens (K09, A11, Q01)

| Parameter | Consumer (proposal — founder Q-06) | Staff (matrix doc) |
|---|---|---|
| Access token | opaque, 15 min | opaque, 5 min, BFF-held |
| Refresh token | opaque, single-use, rotated on every refresh | none (re-auth with WebAuthn; idle unlock) |
| Idle expiry | 60 days without refresh | 15 min (lock) |
| Absolute expiry | 180 days, then phone OTP again | 8 h |
| Step-up freshness | 10 min | 5 min |

- **Hashing:** tokens are random 32 bytes; the DB stores `SHA-256(token)` (high-entropy secrets need no slow hash). Lookup by hash; constant-time compare not needed for hash lookup, but token format is validated first.
- **Rotation & reuse detection:** `POST /v1/auth/token-refreshes { refreshToken }` + `Idempotency-Key`. CAS `used_at IS NULL → now()` inside a transaction that also checks session `ACTIVE`, idle/absolute expiry and that no `ACCOUNT` `SECURITY_HOLD` restriction exists. Presenting a `USED` token: if within a **30 s leeway** *and* the request carries the same `Idempotency-Key` as the original refresh, the stored (encrypted, 60 s TTL) response is replayed — this absorbs mobile retry after a lost response; otherwise the session is revoked (`REFRESH_REUSE`) and a security event is raised (stolen-token signal).
- **Mobile single-flight:** the client serialises refreshes (one in flight), persists the new pair to secure storage before releasing waiting requests, and retries a refresh only with the same `Idempotency-Key`.
- **Logout current:** `DELETE /v1/auth/sessions/current`. **Logout all / all others:** `POST /v1/account/session-revocations { scope: "ALL" | "ALL_OTHERS" }`. **Single device:** `DELETE /v1/account/sessions/{sessionId}` (owner only; IDOR-tested).
- **Session list:** `GET /v1/account/sessions` returns platform, app version, first/last seen (coarse), current flag — no IP, no location.
- **Lost device:** the owner revokes from another session; a user with no other session signs in with OTP on the new device and uses "sign out other devices"; support can revoke all sessions after identity verification (staff action `support.account.sessions.revoke`, step-up + reason, audited).
- **Account restriction / phone change / deletion / recovery** revoke sessions server-side; the cache invalidation message makes revocation effective within one request.
- **Realtime:** handshake token = current access token; on expiry the client reconnects after refresh; room membership derives from the verified session (ADR-005b rule).
- **Session fixation:** tokens are always freshly minted after OTP/OIDC success; nothing from a pre-auth state is promoted; challenge ids are not session identifiers.

## 4. Step-up (high-risk reauthentication)

`POST /v1/account/step-ups` → OTP to the **current** verified phone (purpose `STEP_UP`) → `POST /v1/account/step-ups/{id}/verifications` → session `assurance=OTP_STEP_UP`, `step_up_at=now`.
Required (fresh ≤ 10 min) for: phone change, link/unlink OIDC, revoke-all from a session that is itself new (< 24 h), deletion request, recovery completion, and — from Phase 4 — first driver go-online on a new device (D27/K18 interplay; founder Q-14 for the driver re-check policy). An OIDC-established session on a device unknown to the account always carries `requiredActions: [PHONE_STEP_UP]` before driver-scoped or account-changing actions (founder Q-02).

## 5. Recycled numbers, SIM swap and recovery (S12, K17, K08)

Pakistani operators recycle inactive numbers; the exact dormancy period is **UNVERIFIED** (no PTA/MNO source found in Phase 0). No operator SIM-swap API is known to be available to Wayvro (**UNVERIFIED**, EG-22). Controls are therefore heuristic and conservative:

1. **Dormant account + new device** (account `last_active_at` older than the dormancy threshold — proposal 90 days, founder Q-07 — and the installation unknown to the account): OTP success yields a session with `requiredActions: [RECOVERY_REVIEW]` and a **restricted scope**: no rider/driver history, no saved data, no profile details beyond "an older Wayvro account was linked to this number". The user chooses:
   - **"This is my account"** → must pass a continuity proof: re-authentication with a linked OIDC identity (if one exists, P2.10), or a staff-assisted recovery case (drivers: reviewer compares a fresh guided selfie + CNIC claim against vault evidence — manual, FD-06; riders without another factor: limited recovery, see founder Q-08).
   - **"I'm new to Wayvro"** → the old account's phone is `RELEASED(RECYCLED_NUMBER_NEW_OWNER)`, the old account is restricted `SECURITY_HOLD` and kept for its retention period (its owner can still recover via staff), and a **new** account is created for the new owner. The new owner never sees the previous owner's data (S12 core property).
2. **SIM-swap signals** (new device + recent number re-verification + high-value action): 24 h cooldown before phone-dependent sensitive changes (phone change, OIDC link, payout changes in Phase 9), notifications to all previously active sessions, and driver accounts require the manual re-check path before earning from the new device (Phase 4 enforcement).
3. **Phone change (self-service):** fresh step-up on the current phone → OTP to the new phone → if the new number is verified on another account: generic refusal "This number can't be added. If it's yours, sign in with it or contact support" — no merge, no disclosure of the other account → `COMPLETED`, all other sessions revoked, security events + notices.
4. **Lost phone (recovery):** user signs in with the new number (OTP) → "Recover my previous account" → proof (linked OIDC re-auth, or staff case with identity evidence) → **72 h cooldown** with notices to every old session ("Cancel if this wasn't you") → old phone `RELEASED`, new phone attached, sessions revoked. The empty account created for the new number during the attempt is deleted if unused.
5. **Notifications (A11/K17):** Phase 2 channels are (a) the in-app security activity list (`identity.security_events`) and (b) SMS for the highest-risk events (phone change started/completed, recovery started, all sessions revoked) through `OtpDeliveryPort`-family transactional SMS once a vendor is activated (P2.A1). Push (S11) arrives in Phase 4; email is DESIGN_NOW_ACTIVATE_LATER (founder Q-03).

## 6. Google and Apple OIDC linking (K15, K16, S13) — micro-phase P2.10, flags default OFF

Principles: optional convenience; never creates an account on its own (CL-01); never phone-ownership proof; never grants driver/staff status; immutable `(provider, sub)` is the key; **email is never used to find or merge accounts**.

| Flow | Rule |
|---|---|
| Token verification | Mobile obtains an ID token natively (Google Sign-In / Sign in with Apple) with a server-issued **nonce** (`POST /v1/auth/oidc-nonces`, single use, 5 min, bound to installation). Server verifies with `jose`: signature against cached provider JWKS (refresh on unknown `kid`, bounded), `iss`, `aud` = configured client ids, `exp`/`iat` with ≤ 60 s skew, `nonce` match, Apple `nonce_supported`, Google `email_verified` recorded but not trusted for linking. |
| Sign-in with linked identity | `POST /v1/auth/oidc-sessions { provider, idToken, nonce, installationId }` → if `(provider, sub)` is `LINKED`: session `assurance=OIDC`; if the device is unknown to the account → `requiredActions: [PHONE_STEP_UP]`. If not linked → generic `401 WAYVRO_E_OIDC_NOT_LINKED` ("Sign in with your phone number first, then link Google/Apple in Settings") — no hint whether an account with that email exists. |
| Link | Authenticated, fresh phone step-up, `POST /v1/account/oidc-links { provider, idToken, nonce }`. Conflicts: `(provider, sub)` linked to another account → `409 WAYVRO_E_OIDC_LINK_CONFLICT` (generic, audited, T&S signal); account already has a link for that provider → must unlink first. |
| Email collision | Irrelevant to linking by design. An OIDC email equal to another account's contact email changes nothing. |
| Unlink | Fresh step-up; allowed at any time because phone remains the credential; security event + notice. |
| Apple specifics | private-relay email stored only as contact (encrypted) and flagged; name is available only at first authorisation — offered to prefill display name, never required; server-to-server notifications (consent revoked, account deleted) set `REVOKED` (endpoint needs the Apple developer account — P2.A3); token revocation on account deletion (P2.A3). |
| Provider outage | Phone OTP path unaffected; linked identities preserved; OIDC sign-in returns `503` with "use your phone number". |
| Duplicate accounts / merge requests | **No account merging in Phase 2.** A user with two accounts proves both (OTP on each phone or OIDC + OTP) to a staff recovery case; staff may move a phone or an OIDC link after cooldown and delete the surplus account at the user's request; histories are never merged (S13, K07). |
| Manual conflict recovery | `ACCOUNT_RECOVERY` review case; maker-checker when the outcome moves a credential between accounts. |
| iOS store rule | If Google sign-in ships on iOS, Sign in with Apple must ship too (R4 §2, guideline 4.8) — P2.A2 and P2.A3 activate together for iOS. |

Engineering (verification, linking rules, collision handling, tests with locally generated synthetic keys and a local JWKS fixture server) is implementable now; **production use is EXTERNAL_GATED** by the Google Cloud OAuth project (EG-06) and the Apple Developer Program account (EG-07), and K15/K16 are not reported satisfied until a real-provider integration test passes.

## 7. Authorization model for consumer endpoints (V02, V07)

- A global NestJS guard requires every route to declare a policy (`@Policy('account.sessions.revoke')`); a boot-time/unit test enumerates registered routes and fails if any route lacks one (default deny). Health routes are explicitly `@Public()`.
- The principal is `{ accountId, sessionId, assurance, stepUpAt, riderProfileId, driverProfileId? }` resolved server-side from the token; client-supplied ids, roles, modes, KYC status or `email_verified` are never trusted.
- Resource queries are scoped by **profile id** (rider vs driver) — a rider endpoint cannot return driver rows for the same account; owner checks are part of the repository query (`WHERE account_id = $principal`), not a post-filter.
- Request DTOs are strict Zod objects (`.strict()`); unknown fields are rejected (mass assignment); server-owned fields (state, verified values, ids) do not exist in request schemas.
- Restricted sessions (`ACCOUNT` restriction, `RECOVERY_REVIEW`) carry a reduced policy set evaluated by the same guard.

## 8. Test/local OTP and mock fail-closed hardening

Phase 1 refuses mock-branded providers outside `local`/`test` (`bindProviders`), but the refusal depends only on `WAYVRO_ENV` (finding F-01, `PHASE2_PLAN.md` §7). Phase 2 adds:
1. The local/test OTP sink (`RecordingOtpDelivery`, already present) exposes captured codes only through a test-only route module registered when `WAYVRO_ENV ∈ {local,test}`; boot smoke asserts the route is **absent (404)** under staging/production configuration and that production config with a mock OTP binding refuses to boot.
2. Staging/production configuration schemas **require** real adapter configuration for `otpDelivery` (vendor URL/credentials references) — missing ⇒ `ConfigError` at boot.
3. The sink never generates deterministic codes; tests read the random code from the sink (no "123456").
4. Phase 7 (first deployable images) adds an immutable build marker so a release image refuses `WAYVRO_ENV=local|test` — recorded as a Phase 7 hardening item, not implemented in Phase 2.

## 9. Error codes (additive to `ERROR_CODES`, never renamed)

`WAYVRO_E_FORBIDDEN` (403), `WAYVRO_E_RATE_LIMITED` (429, `retryAfterSeconds`), `WAYVRO_E_CONFLICT` (409 version/state), `WAYVRO_E_INVALID_STATE_TRANSITION` (409), `WAYVRO_E_IDEMPOTENCY_CONFLICT` (422), `WAYVRO_E_OTP_INVALID_OR_EXPIRED` (401), `WAYVRO_E_OTP_LOCKED` (401), `WAYVRO_E_STEP_UP_REQUIRED` (403), `WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED` (403), `WAYVRO_E_ACCOUNT_RESTRICTED` (403, user-safe reason codes), `WAYVRO_E_RECOVERY_REQUIRED` (403), `WAYVRO_E_OIDC_NOT_LINKED` (401), `WAYVRO_E_OIDC_LINK_CONFLICT` (409), `WAYVRO_E_FEATURE_DISABLED` (404-equivalent semantics for flagged-off routes, 403 body), `WAYVRO_E_UPLOAD_REJECTED` (422), `WAYVRO_E_DELETION_BLOCKED` (409).
The error envelope gains an **optional** `details` object (`retryAfterSeconds`, `reasonCodes[]`, `requiredActions[]`) — an additive contract change called out for review. The API error filter's current mapping (any `HttpException` < 500 → `WAYVRO_E_VALIDATION`) is replaced by explicit `WayvroError` mapping.

## 10. Telemetry and logging (Q36)

Existing `packages/observability` redaction already covers keys such as `otp`, `token`, `authorization`, `cookie`, `session`, `phone`, `cnic`, `selfie`, `email` and value patterns for CNIC, PK phone numbers, JWTs and bearer tokens. Phase 2 adds keys/patterns for `refreshToken`, `idToken`, `nonce`, `code`, `challengeId` (low risk but no value in logs), presigned URL query parameters (`X-Amz-Signature`, `X-Amz-Credential`), `installationId`, storage keys; and **canary tests**: every Phase 2 integration flow is run with synthetic canary values (a fixed fake CNIC, phone, OTP, token prefix) and the captured log/trace/error output is scanned for them. Metrics carry low-cardinality dimensions only (`purpose`, `channel`, `outcome`, `mode`, `onboarding_state`).
