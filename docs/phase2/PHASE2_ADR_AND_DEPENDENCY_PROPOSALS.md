# PHASE2_ADR_AND_DEPENDENCY_PROPOSALS — Decisions and dependencies proposed for Phase 2 (PROPOSED — nothing installed)

**Date:** 2026-10-10 · **Status:** PROPOSED for founder/ChatGPT review. **No package was installed and no ADR file was added to `docs/adr/`**: each ADR below is written into `docs/adr/` (as ADR-038 … ADR-044) only in the micro-phase that adopts it, with its evidence. Registry facts were read with `npm view` / GitHub advisory API on 2026-10-10 (versions, licences, publish dates, advisories); they must be re-checked at implementation time. Version choice follows ADR-030: latest patch of a seasoned line, no canary/beta/RC, no brand-new minor/major without a needed feature; pnpm `minimumReleaseAge` stays on.

## ADR-038 (proposed) — Consumer authentication and session model (no auth framework)

**Context.** Wayvro needs purpose-bound phone OTP with multi-dimensional pumping controls, recycled-number recovery, SIM-swap cooldowns, driver-specific reauthentication and server-authoritative capabilities (K08/K09/K17/S12/V02). These rules are product-specific; generic frameworks cover only the generic parts.

**Options compared.**

| Option | Maturity / maintenance | Security history (checked 2026-10-10) | Mobile + Nest/Fastify fit | OIDC | Session model | Lock-in | Verdict |
|---|---|---|---|---|---|---|---|
| **Direct implementation** (NestJS modules + `node:crypto` + PostgreSQL + Valkey) | uses only Node built-ins and existing stack | no third-party auth code; risk is our own code → mitigated by K13 suite, review, U01 pen test | native fit; opaque bearer tokens for mobile | via `jose` (ADR-040) | exactly as specified (rotation, family reuse, leeway) | none (plain tables) | **Recommended** |
| Better Auth 1.7.7 (MIT) | very active, frequent releases | GitHub advisory DB lists ≥ 12 advisories published May–Aug 2026, several high/critical (e.g. refresh-token family forking on concurrent redemption, OAuth auto-link account takeover, pre-account hijacking on e-mail OTP, IPv6 rate-limit bypass) | framework handler mounted into Nest; Expo plugin; cookie-centric defaults | plugins | its own schema/semantics | high (schema + plugin semantics) | rejected: the exact classes of defect Wayvro must prevent appear in its recent history, and our custom rules would fight its defaults |
| Lucia | **deprecated** on npm ("see lucia-auth.com/lucia-v3/migrate") | — | — | — | — | — | rejected |
| Passport.js (+ `@nestjs/passport`) | old, stable | one 2022 advisory (session regeneration) | strategy middleware only; no OTP/session lifecycle | strategies | none (we would still build everything) | low | rejected: adds a layer without providing the hard parts |
| Ory Kratos (self-hosted, Apache-2.0) | mature identity server | separate service to patch/operate | native-app API flows; separate process and DB | yes | its own | medium–high (identity data in its schema) | viable alternative; rejected for pilot: extra operated service, SMS courier and recovery semantics would still need customisation |
| Keycloak / SuperTokens | mature; JVM-based services | — | heavier; phone OTP not first-class (Keycloak) | yes | their own | high | rejected (operational weight) |
| Firebase Auth / Supabase Auth | managed | — | — | yes | vendor | very high | rejected earlier (architecture §10; Firebase PK SMS pricing unverified, CON-05) |

**Decision (proposed).** Implement the consumer auth domain directly; use focused, mature primitives only where cryptographic protocol parsing is involved (`jose` for OIDC, `@simplewebauthn/*` for staff WebAuthn). Opaque tokens hashed with SHA-256; OTP codes MACed with a pepper; field encryption AES-256-GCM — all `node:crypto`.
**Consequences.** More code to review and test (K13 is mandatory, not optional); no framework upgrade churn. **Reversal path:** tables are plain and documented; migrating to Kratos/another IdP later means importing accounts (phone hash + ciphertext) and re-verifying phones — sessions would be reset.

## ADR-039 (proposed) — Staff authentication: WebAuthn-native + BFF; SSO federation later

- **Dependency:** `@simplewebauthn/server` **13.3.3** and `@simplewebauthn/browser` **13.3.x** (MIT). 13.x line since 2024-12-09, patches through 2026-08-26; advisory GHSA-6hxq-p678-4hr2 (low, attestation trust-anchor check) affects ≤ 13.3.1 and is fixed in 13.3.2. 14.0.0 was published 2026-09-02 (five weeks old) → not chosen (ADR-030) unless a needed feature appears.
- **Why needed:** WebAuthn ceremony verification (CBOR/COSE parsing, attestation, origin/RP-ID/UV checks) is protocol-heavy and error-prone to hand-roll.
- **Runtime cost:** server-only small library; browser bundle a few KB in web-ops only.
- **Compatibility:** framework-agnostic functions; used from Nest services; browser helper in Next.js client components.
- **Alternatives:** hand-written WebAuthn (rejected: risk), TOTP via `otplib` 13.5.0 (phishable; rejected as primary factor), company IdP SSO only (blocked by EG-19; kept as P2.A6 federation).
- **Reversal:** credentials table is standard WebAuthn data; swapping the library keeps stored credentials valid.

## ADR-040 (proposed) — OIDC ID-token verification with `jose`

- **Dependency:** `jose` **6.2.12** (MIT, zero dependencies, maintained by panva; 6.x since 2025-02-22, last publish 2026-09-05). Advisories: three historical medium issues (2021 padding-oracle timing, 2022 and 2024 JWE resource exhaustion) — all in JWE paths Wayvro does not use (JWS verification only).
- **Why:** JWS/JWK/JWKS handling with algorithm allowlists, `kid` rotation and claim validation.
- **Alternatives:** `google-auth-library` (Google-only, heavier), `openid-client` (full RP; unnecessary for native ID-token flows), hand-rolled verification over `crypto.createPublicKey({format:'jwk'})` (rejected: algorithm-confusion risk).
- **Mobile (activation P2.A2/P2.A3 only, not Phase 2 core):** `@react-native-google-signin/google-signin` 16.1.x (MIT) or `expo-auth-session` — decided at activation with the Google project; `expo-apple-authentication` 57.0.x (MIT, SDK-aligned).
- **Reversal:** verifier behind an internal `IdTokenVerifier` interface.

## ADR-041 (proposed) — Evidence vault: storage client, encryption, scanning

- **S3 client:** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (Apache-2.0; official; 3.1149.0 current — pin the release the Phase 1 ADR-010 harness already exercised (3.1146.x) or the newest patch that is ≥ 24 h old at implementation). Server-only (vault module + worker). Required setting: `requestChecksumCalculation: 'WHEN_REQUIRED'` (ADR-010 finding). Alternative `aws4fetch`/hand-rolled SigV4 rejected (signature edge cases). Reversal: `ObjectStoragePort` adapter swap.
- **Encryption:** envelope encryption with `node:crypto` AES-256-GCM; `KeyProvider` port (local env key in local/test only; production KMS chosen under EG-05). No crypto dependency.
- **Malware scanning:** ClamAV daemon as a pinned container `clamav/clamav:1.5.x@sha256:…` in the `wayvro` compose project (GPL-2.0; used unmodified as a separate service over the clamd TCP protocol — no linking, no redistribution); adapter speaks `INSTREAM` over `node:net` (no npm package). Signature updates via the container's `freshclam`; CI cost ≈ image pull + signature load time (to be measured). Alternatives: cloud scanning APIs (data leaves boundary; EG-11), no scanning (fails K11).
- **Image handling:** strict JPEG/PNG container validation + metadata stripping implemented in-house without pixel decoding. `sharp` 0.35.x (Apache-2.0, bundles libvips — LGPL, native binaries, image-parser CVE surface) is **deferred**; revisit only if transcoding/perceptual hashing is needed.
- **Licence note:** GPL service in a separate container does not affect Wayvro's licence; the CycloneDX/licence gate (U03, Phase 7) must classify it as an infrastructure service.

## ADR-042 (proposed) — Background jobs on PostgreSQL (`SKIP LOCKED`), not BullMQ

- **Why:** jobs (OTP send, scan/encrypt, expiry, seals, deletion, retention, orphan cleanup) must be enqueued atomically with domain writes; ADR-004 already reserved `SKIP LOCKED` for worker job claiming; volume is small.
- **Design:** `platform.jobs` table, lease + heartbeat, bounded retries with full-jitter backoff (reusing the Phase 1 `backoffDelayMs`), dead-letter status with alert, idempotent handlers keyed by job id.
- **Alternatives:** BullMQ on Valkey (named in the Phase 0 architecture; second state store, non-transactional enqueue), pg-boss (mature, MIT; viable if the hand-written runner grows — reversal path).
- **Reversal:** handler functions are queue-agnostic; moving to pg-boss/BullMQ replaces the runner only.

## ADR-043 (proposed) — Mobile platform additions for Phase 2

| Package (SDK 57 line) | Licence | Why | Cost / risk | Alternative | Micro-phase |
|---|---|---|---|---|---|
| `expo-secure-store` 57.0.x | MIT | Q01: Keychain/Keystore token storage | small native module; no permission | `react-native-keychain` (third-party) | P2.3 |
| `expo-router` 57.0.x (+ its required peers via `npx expo install`) | MIT | screens/navigation; deep-link groundwork for V08 | moderate JS size; file routes kept thin (delegating to `src/features/*`) so rider/driver boundaries stay enforceable | `@react-navigation/native` directly | P2.3 (founder Q-13) |
| `@tanstack/react-query` 5.x (latest patch ≥ 24 h) | MIT | server-state cache, retries, refetch on focus/reconnect, offline-aware status | ~12 KB gz; well established | hand-written fetch hooks (risk of re-inventing caching/retry) | P2.3 (founder Q-13) |
| `expo-camera` 57.0.x | MIT | K02/K03 guided capture | adds CAMERA permission (JIT); audio disabled via config plugin | `react-native-vision-camera` (heavier, more capable) | P2.8 |
| `expo-file-system` 57.0.x | MIT | delete cached captures after upload/logout | already a transitive dependency of `expo`; becomes declared | — | P2.8 |
| `@wayvro/contracts` (workspace) | — | typed client; Zod at runtime | Zod 4 bundle cost measured (consider `zod/mini` if large) | hand-copied types (drift risk) | P2.3 |

Exact versions are selected with `npx expo install` for SDK 57 and recorded; the Android permission allowlist changes only in P2.8 (CAMERA). Bundle/startup deltas are recorded per micro-phase (V11 baseline; real-device budgets remain SP-02).

## ADR-044 (proposed) — Policy content as a versioned workspace package

- **Decision:** proposed data-only package `packages/legal-content` (markdown per policy/version/locale + generated manifest with SHA-256, status, effective date). Consumed by `apps/web-public` (static rendering, canonical public URL — W05) and by `apps/api` (seeds `legal.policy_documents`; validates consent hashes). Git history is the change log provenance; the public change-log page is generated from the manifest.
- **Why:** one source for the text a user accepts in the app and the text published on the web; no app→app import; no CMS dependency before W01 (Phase 9).
- **Alternatives:** API/DB as source with web-public fetching at request time (legal pages would depend on API availability); CMS now (premature).
- **Reversal:** when a CMS arrives (W01), the manifest becomes its export target.

## Web E2E tooling (activation of the ADR-027 deferred item)

`@playwright/test` (Apache-2.0) — **1.64.0 was published on 2026-10-10**, so the latest 1.63.x patch is proposed under ADR-030; `@axe-core/playwright` 4.x (MPL-2.0, dev-only — MPL is on the Phase 0 licence allowlist). Runs in a new `e2e-web` CI job with browsers cached. Introduced in P2.2 (legal pages) or P2.4 (first authenticated screens), founder Q-11.

## Rejected / deferred dependencies (recorded so they are not added casually)

`rate-limiter-flexible` 11.2.1 (ISC, mature) — not needed: limiter logic is ~100 lines of Lua with business keys and fail-closed semantics we must control; revisit if limiter scope grows. `sharp` — deferred (above). `otplib` — TOTP not used. `class-validator` — contradicts ADR-005 (Zod contracts). Any CAPTCHA SDK — not used in mobile (AB-01).

## Smaller decisions (recorded in the adopting micro-phase's report, no separate ADR)

UUIDv7 primary keys generated server-side (RFC 9562 helper in `packages/server-runtime`); one PostgreSQL schema per context with restricted roles; opaque storage keys; error-envelope `details` (additive); route-policy completeness test as the "every route is authorised" gate (instead of a Semgrep rule now — Semgrep remains an ADR-027 deferred item).
