# PHASE2_AUTH_SESSION_DESIGN — Phone OTP, sessions, recovery, step-up and OIDC linking (PROPOSED)

**Date:** 2026-10-10 (planning closure correction applied the same day) · **Status:** Phase 2 PLAN ONLY. No auth code, dependency or provider account exists. · **Requirements:** A02, A03, A05, A11, A15 (signup declaration), K01, K08, K09, K13, K15, K16, K17, Q01, Q06, Q36, S12, S13, V02 (staff authentication: `docs/phase2/PHASE2_STAFF_AUTHORIZATION_MATRIX.md`). · **Entities/state machines and crypto formats:** `docs/phase2/PHASE2_DOMAIN_AND_DATA_MODEL.md`.

## 1. Decision summary

| Topic | Decision (founder-approved direction, details re-checked at implementation) |
|---|---|
| Auth implementation (ADR-038) | Implement the consumer auth/session **domain** directly on the existing NestJS/PostgreSQL/Valkey architecture instead of adopting a general auth framework. This is a **fit/control** decision, **not** a claim that custom auth is inherently safer — it is not. It is **not** permission to invent cryptographic protocols: random tokens, MACs and AEAD use Node's standard primitives; protocol-heavy standards use focused mature libraries (`jose` for OIDC, SimpleWebAuthn for WebAuthn); every auth state transition whose correctness depends on concurrency uses database constraints/transactions; no auth code is accepted without the adversarial and concurrency suites (K13); an independent security assessment (EG-17/U01) remains a gate before any real user. |
| Consumer credential | Phone OTP only (CL-01). Google/Apple are optional linked conveniences, never phone-ownership proof. |
| Token model | Opaque random tokens (256-bit) stored only as SHA-256: short access token + rotating single-use refresh token, family = session, reuse detection. |
| Revocation | Immediate: every request validates the session row (Valkey read-through cache ≤ 30 s, invalidated on revoke; DB is truth). |
| Realtime | `apps/realtime` binds a session-token authenticator in place of `DenyAllAuthenticator`; fail-closed. |
| Mobile storage | OS secure storage only (`expo-secure-store`), nothing in AsyncStorage/logs (Q01). |
| OIDC | `jose` verification (P2.10); flags off; production externally gated. |
| OTP delivery | Existing `OtpDeliveryPort`; generation/verification stay server domain logic. Real adapters only in activation P2.A1. The local recording sink is a development/test mechanism only (§8). |

## 2. Account identity semantics (closure correction §1)

- A **current verified phone** belongs to **at most one** active account (database-enforced, per lookup-key version); an account has **at most one** current verified phone in Phase 2 (database-enforced).
- Wayvro intends one identity account per person, but **one-account-per-human is not a database invariant and is never claimed as one**: a person can create a second account with a different number before signals, review or recovery detect it.
- Duplicate-person handling = duplicate signals (KYC doc §8), staff review, recovery cases and **safe credential movement** (phone/OIDC link moved only through an audited, maker-checker, cooldown recovery case). **Histories are never merged.**
- Concurrent first sign-in for the same phone resolves to one account through the unique current-owner lookup index; the loser signs into the winner's account.

## 3. OTP design (A02, A03, K08, Q06)

### 3.1 Request
`POST /v1/auth/otp-challenges` `{ phone, purpose: "SIGN_IN", installationId, locale }` + `Idempotency-Key`.
1. Normalise with `normalisePakistanMobile()`; non-PK/landline/malformed ⇒ `WAYVRO_E_VALIDATION` (syntax only, never existence). Only `+923XXXXXXXXX` at launch.
2. Evaluate limits atomically (Valkey Lua, §3.4). **Limiter unavailable ⇒ fail closed** (`503`), no SMS.
3. Supersede any `ISSUED` challenge for the same phone + purpose + installation.
4. Code: `crypto.randomInt(0, 1_000_000)`, zero-padded; store only `code_mac = HMAC-SHA-256(otp_mac_key[v], challengeId ‖ code)` with `mac_key_version`; never log/store the code.
5. Send asynchronously via the job table through the configured channel order (SMS, then the WhatsApp authentication template when activated — FD-05).
6. Respond **always** `202 { challengeId, expiresAt, resendAvailableAt, channel, maskedDestination }` for any syntactically valid number, including silently dropped sends; DB/Valkey work is equalised across paths.

### 3.2 Verify
`POST /v1/auth/sessions` `{ challengeId, code, installationId, device }` + `Idempotency-Key`. Constant-time MAC comparison; wrong code increments attempts; 5 ⇒ `LOCKED`. Wrong/expired/consumed/superseded/unknown ⇒ one generic `401 WAYVRO_E_OTP_INVALID_OR_EXPIRED`. Success = CAS `ISSUED → CONSUMED` in one transaction that resolves/creates the account (§2), runs the recycled-number check (§6), upserts the device, creates session + refresh token, writes audit and security events, and returns `201 { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, sessionId, isNewAccount, requiredActions[] }` (`requiredActions` may include `ACCEPT_POLICIES` and `AGE_DECLARATION` per A15 policy). Server time only.

### 3.3 Resend
After `resendAvailableAt`; cooldown 60 s → 120 s → 300 s; max 3 resends; each resend issues a new code and counts against every limit.

### 3.4 Limits and pumping controls (configuration defaults, tuned with data)

| Dimension | Default | On breach |
|---|---|---|
| Challenge TTL / attempts | 5 min / 5 | `EXPIRED` / `LOCKED` |
| Sends per phone | 5 / h, 10 / 24 h | generic 202 + silent drop |
| Failed challenges per phone | 5 / 24 h | 24 h phone cooldown, generic response, T&S signal |
| Sends per installation | 10 / 24 h | `429 WAYVRO_E_RATE_LIMITED` |
| Sends per client IP | soft 30 / h per IPv4 /24 or IPv6 /56 (risk score), hard 200 / h | `429` at hard limit (CGNAT makes IP weak) |
| Prefix (first 5 digits) / ASN | verified ÷ sent < 30 % over ≥ 200 sends/h | alert + temporary friction |
| Global spend | daily/monthly budget per provider; alerts 50/80/100 % | new sends refused with `503` at 100 %; never "verified without OTP" |

### 3.5 Outage and native conveniences
All channels failing ⇒ `DELIVERY_FAILED`, honest `503` with retry-after; no verification without a delivered code; **no master OTP, no bypass list, no tester numbers** in any environment. iOS `textContentType="oneTimeCode"` / Android `autoComplete="sms-otp"` (built into React Native); Android SMS Retriever is DESIGN_NOW_ACTIVATE_LATER with P2.A1. Auto-read is never proof.

## 4. Sessions and tokens (K09, A11, Q01)

**Founder Q-06:** the following are **provisional configurable defaults**, not protocol constants:

| Parameter | Consumer default | Staff (matrix doc) |
|---|---|---|
| Access token | 15 min, opaque | 5 min, opaque, BFF-held |
| Refresh token | single-use, rotated on every refresh | none (WebAuthn re-assertion; idle unlock) |
| Idle expiry | 60 days without refresh | 15 min (lock) |
| Absolute expiry | 180 days, then phone OTP again | 8 h |
| Step-up freshness | 10 min | 5 min |

- Tokens = 32 random bytes; DB stores `SHA-256(token)`.
- **Rotation & reuse detection:** `POST /v1/auth/token-refreshes` + `Idempotency-Key`; CAS `used_at IS NULL → now()` in a transaction that also checks session state/expiry and the absence of an `ACCOUNT` `SECURITY_HOLD`. A `USED` token presented within a 30 s leeway **with the same idempotency key** replays the stored (encrypted, 60 s) response; otherwise the session is revoked (`REFRESH_REUSE`) and a security event raised.
- Mobile client: single-flight refresh, persist new pair to secure storage before releasing waiters, retry only with the same idempotency key.
- Logout current (`DELETE /v1/auth/sessions/current`), logout all / all others (`POST /v1/account/session-revocations`), single session (`DELETE /v1/account/sessions/{id}`, owner only, 404 for foreign ids), session list (platform, app version, coarse first/last seen — no IP/location).
- Lost device: revoke from another session; or OTP on the new device then "sign out other devices"; or support revocation after verification (step-up + reason, audited).
- Restriction / phone change / deletion / recovery revoke sessions server-side with immediate cache invalidation.
- Realtime handshake uses the access token; rooms derive from the verified session.
- Session fixation: tokens minted only after OTP/OIDC success; challenge ids are never session identifiers.

## 5. Step-up and new-device risk policy

`POST /v1/account/step-ups` → OTP to the **current** phone (`STEP_UP`) → verification ⇒ `assurance=OTP_STEP_UP`. Required (fresh ≤ 10 min) for: phone change, OIDC link/unlink, revoke-all from a session < 24 h old, deletion request, recovery completion.
**Founder Q-02 (approved):** an OIDC-established session on a device unknown to the account carries `requiredActions: [PHONE_STEP_UP]` before any account-changing or driver-sensitive action.
**Founder Q-14 (risk-triggered re-verification, not universal):** a new driver device gets the normal phone/session risk controls and step-up. **Earning may be temporarily restricted only when the risk policy triggers** (e.g. recent number re-verification + new device + dormancy, device/installation velocity, account-sharing reports, SIM-swap pattern) — implemented as a system-created, reason-coded, appealable, auto-expiring `DRIVER_ROLE` restriction with `reason_class=RISK_HOLD`, plus a `REVERIFICATION` review case. Selfie/manual/in-person re-verification is one possible **risk-triggered** outcome, never a blanket device-change rule; any real selfie re-check remains subject to the DPIA gate (EG-10). Phase 4 (D27/K12) consumes the resulting restriction/re-verification state at go-online.

## 6. Recycled numbers, SIM swap and recovery (S12, K17, K08)

The operator recycling period and any SIM-swap API are **UNVERIFIED** (EG-22). **Founder Q-07:** 90 days is a **provisional risk threshold for local/test design only**; it is not a PTA/MNO rule or a fact, and production tuning is gated by EG-22 and measured evidence.

1. **Dormant account + unknown installation** (account inactive longer than the threshold): OTP success yields a restricted session with `requiredActions: [RECOVERY_REVIEW]` exposing no history. Choices:
   - **"This is my account"** ⇒ requires **strong continuity proof** (§6.4); without it the choice is unavailable.
   - **"I'm new to Wayvro"** ⇒ old account's phone `RELEASED(RECYCLED_NUMBER_NEW_OWNER)`, old account `SECURITY_HOLD` and retained under policy, and a new clean account is created. The new owner never sees prior data.
2. **SIM-swap signals** (new device + recent re-verification + high-value action): 24 h cooldown before phone-dependent sensitive changes, notices to previously active sessions, and — for drivers — the risk policy of §5 may place a `RISK_HOLD`.
3. **Self-service phone change:** fresh step-up on the current phone → OTP to the new phone → if the new number is current on another account: generic refusal, no merge, no disclosure → complete, other sessions revoked, notices.
4. **Lost-phone recovery — strong proof only (founder Q-08, closure correction §4):**
   - **Previously linked OIDC identity** (P2.10 onward): fresh OIDC re-authentication of the same `(provider, sub)` + OTP on the new number + **72 h cooldown** with notices to every old session ("cancel if this wasn't you") ⇒ phone moved.
   - **Driver with enrolled KYC evidence:** strict `ACCOUNT_RECOVERY` review case: new-number OTP + fresh guided capture compared by a reviewer against vault evidence (manual, FD-06; real data only after EG-10) + **maker-checker** + 72 h cooldown + audit.
   - **Rider-only account without a pre-existing strong factor:** **no restoration of the old history through support judgement.** The old account stays on `SECURITY_HOLD`, retained under policy; the person continues with a new clean account (the account created by the new-number sign-in). Support may explain the policy and help with data/deletion requests per law, not move credentials.
   - Any credential movement between existing accounts keeps maker-checker and cooldowns.
5. **Notifications:** in-app security activity (`identity.security_events`) and SMS for the highest-risk events once a vendor exists (P2.A1); push arrives with S11 (Phase 4); e-mail deferred (Q-03).

## 7. Google and Apple OIDC linking (K15, K16, S13) — P2.10, flags default OFF

| Flow | Rule |
|---|---|
| Verification | Native ID token with a server-issued single-use nonce (5 min, installation-bound); `jose` verifies signature via cached JWKS (bounded refresh on unknown `kid`), `iss`, `aud`, `exp`/`iat` (≤ 60 s skew), `nonce`, algorithm allowlist. |
| Sign-in | Only for a `LINKED` `(provider, sub)`; unknown device ⇒ `PHONE_STEP_UP` required (Q-02). Not linked ⇒ generic `401 WAYVRO_E_OIDC_NOT_LINKED`. **No account creation via OIDC.** |
| Link | Authenticated, fresh phone step-up; `(provider, sub)` on another account ⇒ `409 WAYVRO_E_OIDC_LINK_CONFLICT` (generic, audited, T&S signal). |
| E-mail | Never a lookup or merge key; **no e-mail-based identity merge**; e-mail channel deferred (Q-03). |
| Unlink | Fresh step-up; always allowed (phone remains the credential). |
| Apple | relay e-mail stored as encrypted contact only; first-authorisation name optional; S2S notifications and token revocation on deletion in P2.A3. |
| Outage | Phone path unaffected; `503` for OIDC with "use your phone number". |
| Duplicates | No merge feature; recovery case with proof of both principals, maker-checker, cooldown; histories never merged. |
| iOS rule | If Google sign-in ships on iOS, Sign in with Apple ships too (P2.A2 + P2.A3 together for iOS). |

Production use is EXTERNAL_GATED (EG-06/EG-07); K15/K16 are not reported satisfied until real-provider integration tests pass.

## 8. Production test-double isolation — F-01 fixed in P2.1 (closure correction §2, §17)

**Problem (verified in Phase 1 code):** `@wayvro/provider-interfaces` ships `RecordingOtpDelivery`, `InMemoryObjectStorage`, `RecordingPushNotification` and `defaultProviderBindings(env)` in the same production package as the ports; `apps/api` binds them when `WAYVRO_ENV` is `local`/`test`. The environment name alone is therefore the boundary.

**Design (P2.1):**
1. **Physical separation.** Move every test double into a new private workspace package `@wayvro/provider-test-doubles` (recording OTP sink, in-memory storage, recording push, local JWKS fixture later). It is declared **only as a `devDependency`** of the apps/tests that use it. Remove the mocks and `defaultProviderBindings()` from `@wayvro/provider-interfaces`, which keeps ports and the binding guard only.
2. **Production composition roots cannot reference doubles.** `apps/api/src/main.ts`, `apps/worker/src/main.ts`, `apps/realtime/src/main.ts` bind only real adapters from `packages/provider-adapters/*` (none exist until activation tracks) — an unbound port makes its feature return `503 WAYVRO_E_DEPENDENCY_UNAVAILABLE`, and staging/production configuration refuses to boot without the required adapter configuration.
3. **Local development entry points live outside the deployable build.** A local runner (e.g. `apps/api/dev/main.local.ts`, outside `src/`, excluded from the production `tsc` build and from the deploy artefact) composes the same `createApp()` with test doubles for `pnpm dev`, boot smoke and E2E. The test-OTP inbox route is registered only by this local runner.
4. **Deployable artefact = production dependencies only.** Each server app gets a reproducible artefact build (`pnpm deploy --prod` into an isolated directory, or `turbo prune` + `pnpm install --prod --frozen-lockfile` if pnpm 12's deploy mode conflicts with the hoisted linker — verified in P2.1). Container images in Phase 7 are built from exactly this directory.
5. **Release build marker.** The production build writes an immutable `build-info.json` (`artifact: "release"`, commit SHA) into `dist/`; when present, boot **refuses `WAYVRO_ENV=local|test`**. So a production artefact accidentally configured as `local` neither has test doubles nor accepts the local environment.
6. **Static guards.** dependency-cruiser rule `no-production-to-test-doubles` (any `src/**` of an app/package → `@wayvro/provider-test-doubles` is an error; the existing `not-to-dev-dep` rule is a second layer); ESLint boundaries element for the package; Knip production mode must not see it as a production dependency.
7. **Runtime defence in depth (kept):** `bindProviders()` still refuses mock-branded implementations outside `local`/`test`; staging/production config rules still reject local hosts/plaintext transports.

**CI evidence (new `artifact-isolation` step, P2.1 exit gate) — for api, worker and realtime:**
- build the production artefact directory;
- assert `node_modules/@wayvro/provider-test-doubles` is absent and that no file in the artefact contains the double package specifier, the mock brand `wayvro.provider.mock` or the double class names;
- run `node --input-type=module -e "await import('@wayvro/provider-test-doubles')"` inside the artefact ⇒ must fail with `ERR_MODULE_NOT_FOUND`;
- boot the artefact with `WAYVRO_ENV=local` against local infrastructure ⇒ must **refuse** (release marker); boot with production-like config and no adapter config ⇒ must refuse; the test-OTP route must not exist in the artefact's route table (generated route manifest check).

**Recording OTP sink semantics:** random codes only (no deterministic, universal or master code); no bypass or tester numbers; only reachable through the local runner; **never evidence that EG-01 is complete** — real OTP stays externally gated (P2.A1).

## 9. Authorization model for consumer endpoints (V02, V07)

Global NestJS guard requiring every route to declare a policy; a route-inventory test fails if any route lacks one (default deny); `@Public()` only on health and public auth routes. Principal `{ accountId, sessionId, assurance, stepUpAt, riderProfileId, driverProfileId? }` comes from the server; client-supplied ids/roles/modes/KYC status/`email_verified` are ignored. Queries are scoped by profile id inside the repository query. Request schemas are `.strict()`; server-owned fields are absent. Restricted sessions (`ACCOUNT` restriction, `RECOVERY_REVIEW`) get a reduced policy set.

## 10. Error codes (additive to `ERROR_CODES`)

`WAYVRO_E_FORBIDDEN`, `WAYVRO_E_RATE_LIMITED`, `WAYVRO_E_CONFLICT`, `WAYVRO_E_INVALID_STATE_TRANSITION`, `WAYVRO_E_IDEMPOTENCY_CONFLICT`, `WAYVRO_E_OTP_INVALID_OR_EXPIRED`, `WAYVRO_E_OTP_LOCKED`, `WAYVRO_E_STEP_UP_REQUIRED`, `WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED`, `WAYVRO_E_AGE_DECLARATION_REQUIRED`, `WAYVRO_E_ACCOUNT_RESTRICTED`, `WAYVRO_E_RECOVERY_REQUIRED`, `WAYVRO_E_OIDC_NOT_LINKED`, `WAYVRO_E_OIDC_LINK_CONFLICT`, `WAYVRO_E_FEATURE_DISABLED`, `WAYVRO_E_UPLOAD_REJECTED`, `WAYVRO_E_DELETION_BLOCKED`. Optional envelope `details` (`retryAfterSeconds`, `reasonCodes[]`, `requiredActions[]`) — additive contract change. The API error filter's blanket `HttpException < 500 → WAYVRO_E_VALIDATION` mapping is replaced by explicit mapping (F-04).

## 11. Telemetry and logging (Q36)

Existing redaction covers `otp`, `token`, `authorization`, `cookie`, `session`, `phone`, `cnic`, `selfie`, `email` and CNIC/phone/JWT/bearer patterns. Phase 2 adds `refreshToken`, `idToken`, `nonce`, `code`, `challengeId`, `installationId`, storage keys, presigned query parameters (`X-Amz-Signature`, `X-Amz-Credential`), envelope bytes; plus canary scans of every flow's logs/traces/errors/audit rows/metric labels.
