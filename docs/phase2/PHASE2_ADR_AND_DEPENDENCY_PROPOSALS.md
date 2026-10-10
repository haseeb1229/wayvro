# PHASE2_ADR_AND_DEPENDENCY_PROPOSALS — Decisions and dependencies for Phase 2 (PROPOSED — nothing installed)

**Date:** 2026-10-10 (planning closure correction applied the same day) · **Status:** founder **conditionally approved the architecture direction of ADR-038..044** (Q-11); ADR-045 is added by the closure correction. **This is not approval to install the versions written here.** No package was installed and no ADR file was added to `docs/adr/`; each ADR is written there in the micro-phase that adopts it, with evidence. Registry/advisory facts below were read on 2026-10-10 and are **planning-time candidates only**.

**Installation rule (every micro-phase that first adds a dependency):** re-check the current stable releases, open and recent advisories, licence, compatibility (Node 24, NestJS 12, Fastify 5, Expo SDK 57/RN 0.86, Next.js 16.3), publish age and maturity, lockfile impact (`pnpm install` diff reviewed), and ADR-030 (latest patch of a seasoned line; no canary/beta/RC; no brand-new minor/major without a needed feature). pnpm `minimumReleaseAge` stays on with no exclusions.

## ADR-038 — Consumer authentication and session domain implemented directly

**Decision.** Implement the consumer auth/session **domain** (OTP challenges, sessions, refresh rotation, step-up, recovery rules, restrictions interplay) directly on the existing NestJS/PostgreSQL/Valkey architecture instead of adopting a general auth framework.

**What this decision is not.** It is **not** a claim that custom auth is inherently safer than a framework — it is not; it moves the burden of correctness onto Wayvro's own code and tests. It is **not** permission to invent cryptographic protocols or primitives.

**Binding conditions.**
1. Random tokens, MACs and AEAD use Node's standard `node:crypto` primitives only (random bytes, HMAC-SHA-256, SHA-256, AES-256-GCM, constant-time compare), in the formats defined in the data model §8.
2. Protocol-heavy standards use focused, mature libraries: `jose` for OIDC (ADR-040), SimpleWebAuthn for WebAuthn (ADR-039).
3. Every auth state transition whose correctness depends on concurrency uses database constraints and transactions (partial unique indexes, CAS updates), proven by concurrency tests against real PostgreSQL.
4. No auth implementation is accepted without the adversarial and concurrency families (K13) passing in CI.
5. An independent security assessment (EG-17/U01) remains a gate before any real user.

**Why direct (fit and control):** Wayvro's rules — purpose-bound OTP with multi-dimensional pumping controls, recycled-number recovery review, strong-proof-only recovery, risk holds, driver-specific constraints, server-authoritative capabilities — are product-specific; frameworks would need extensive customisation of exactly these parts.

| Option | Notes (checked 2026-10-10) | Verdict |
|---|---|---|
| Direct domain + `node:crypto` + focused libraries | full control; all risk in our code, mitigated only by tests, review and independent assessment | **chosen (conditions above)** |
| Better Auth 1.7.x (MIT) | very active; ≥ 12 GitHub advisories published May–Aug 2026 including high/critical issues in refresh-token rotation, OAuth auto-linking and e-mail OTP flows — showing these problem classes are hard; the **same classes must be tested in Wayvro's code** | rejected for fit (custom rules would fight its defaults; schema lock-in), not because custom code is assumed safer |
| Lucia | deprecated on npm | rejected |
| Passport.js | strategies only; no OTP/session lifecycle | rejected |
| Ory Kratos | mature self-hosted identity server; extra operated service and identity schema | viable alternative; reversal target |
| Keycloak / SuperTokens / Firebase / Supabase Auth | heavier services or BaaS lock-in | rejected |

**Reversal path:** plain documented tables; migrating to an IdP means importing accounts (phone envelopes + lookups) and re-verifying phones; sessions reset.

## ADR-039 — Staff authentication: WebAuthn-native + BFF; SSO federation later (founder Q-01 approved)
Library direction SimpleWebAuthn (`@simplewebauthn/server` + `/browser`, MIT). Planning-time facts: 13.x line since 2024-12; GHSA-6hxq-p678-4hr2 (low) affects ≤ 13.3.1, fixed in 13.3.2; 14.0.0 published 2026-09-02. Version chosen at P2.4 under the installation rule. Alternatives: hand-rolled WebAuthn (rejected), TOTP (phishable; not a primary factor), SSO-only (EG-19; P2.A6). Reversal: stored credentials are standard WebAuthn data. Two registered authenticators required before privileged real-data KYC operation; no static emergency credentials.

## ADR-040 — OIDC ID-token verification with `jose`
`jose` (MIT, zero dependencies; 6.x since 2025-02; JWE-only historical advisories not on Wayvro's JWS path). Alternatives: `google-auth-library`, `openid-client`, hand-rolled verification (rejected: algorithm confusion). Mobile SDKs (`@react-native-google-signin/google-signin` or `expo-auth-session`; `expo-apple-authentication`) only at activation P2.A2/P2.A3. Reversal: behind an internal `IdTokenVerifier`.

## ADR-041 — Evidence vault: storage client, encryption, scanning and image sanitisation (revised by the closure correction)
- **S3 client:** official AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, Apache-2.0), server-only, `requestChecksumCalculation: 'WHEN_REQUIRED'` (ADR-010 finding); version re-checked at P2.6. Reversal: `ObjectStoragePort` adapter swap.
- **Encryption:** `node:crypto` AES-256-GCM envelopes and per-object DEKs wrapped by a KMS KEK (EG-05); formats and rotation in the data model §8.
- **Malware scanning:** pinned `clamav/clamav` container (GPL-2.0, unmodified, separate service) via clamd `INSTREAM` over `node:net`.
- **Image sanitisation (changed):** **no hand-written JPEG/PNG parser or metadata stripper as the security boundary.** P2.6 begins with a bounded evaluation of mature decode/re-encode options run in an isolated, resource-limited, network-less sanitiser (preferred candidate: `sharp`/libvips with JPEG/PNG-only loaders and pixel limits; alternatives: libvips CLI container, pure-JS `jimp`; `jpeg-js`/`pngjs` rejected as unmaintained; ImageMagick not preferred). Criteria: advisories (sharp's 2026 advisories are inherited from bundled libvips/libheif/librsvg — mitigated by loader restriction, isolation, limits and patch cadence), licence, native-binary provenance, bomb controls, CPU/memory/time limits, determinism, metadata absence verified independently, Linux-container reproducibility for CI and the Windows developer machine. The decision, measurements and pinned version are recorded in this ADR before sanitiser code is written. A custom parser requires evidence that mature options failed **and** explicit founder approval.

## ADR-042 — Background jobs on PostgreSQL (`SKIP LOCKED`), not BullMQ
Transactional enqueue with domain writes; ADR-004 reserved `SKIP LOCKED` for job claiming; leases, bounded full-jitter backoff (Phase 1 `backoffDelayMs`), dead-letter + alert, idempotent handlers. Alternatives: BullMQ (second state store, non-transactional enqueue), pg-boss (reversal target).

## ADR-043 — Mobile platform additions (founder Q-13 approved for Expo Router + TanStack Query; versions re-checked at install)

| Package (SDK-57-compatible stable release chosen at install) | Licence | Why | Notes | Micro-phase |
|---|---|---|---|---|
| `expo-secure-store` | MIT | Q01 token storage | no permission | P2.3 |
| `expo-router` (+ required peers) | MIT | navigation; deep-link groundwork | thin route files delegating to `src/features/*` | P2.3 |
| `@tanstack/react-query` | MIT | server-state cache, retries, reconnect refetch | bundle delta measured | P2.3 |
| `expo-camera` | MIT | guided document/selfie capture | CAMERA (JIT); audio disabled | P2.8 |
| `expo-image-picker` | MIT | controlled document import (Q-04) | system photo picker; **must not add storage/media permissions** — verified by the permission gate at install, otherwise not adopted without a separate decision | P2.8 |
| `expo-file-system` | MIT | delete cached captures | already transitive; becomes declared | P2.8 |
| `@wayvro/contracts` (workspace) | — | typed client | Zod bundle cost measured | P2.3 |

## ADR-044 — Policy content (and age-policy explanation) as a versioned workspace package
Data-only package proposed as `packages/legal-content` (markdown + generated manifest with SHA-256, status, effective date) consumed by web-public (static, canonical URL — W05) and the API (seeds `legal.policy_documents`, validates consent hashes). Age-policy **values** live in `legal.age_eligibility_policies` (entered with maker-checker from counsel's decision), while the user-facing explanation text follows this package. Reversal: becomes a CMS export target with W01.

## ADR-045 (new) — Production test-double isolation (F-01, P2.1)
**Decision:** test doubles live only in the dev-only workspace package `@wayvro/provider-test-doubles`; `@wayvro/provider-interfaces` keeps ports and the binding guard only (mocks and `defaultProviderBindings()` removed); production composition roots import only real adapters; local runners live outside the production build; deployable artefacts contain production dependencies only; a release build marker refuses `WAYVRO_ENV=local|test`; dependency-cruiser/ESLint/Knip rules forbid production imports of the doubles; the CI `artifact-isolation` step proves absence, non-resolvability, marker refusal and route absence for api/worker/realtime. Runtime `bindProviders()` refusal stays as defence in depth. **Alternatives rejected:** environment-name checks alone (the Phase 1 state — insufficient by founder decision); build-time dead-code elimination of mocks inside the same package (fragile; artefact still resolvable). **Risk to verify in P2.1:** `pnpm deploy --prod` behaviour with pnpm 12 and the hoisted linker; fallback `turbo prune` + `pnpm install --prod --frozen-lockfile` in a clean directory.

## Web E2E tooling
Playwright + `@axe-core/playwright` (Apache-2.0 / MPL-2.0 dev-only) on an **appropriately seasoned, supported stable Playwright line selected at implementation time** — the version is not frozen because of a release that happened on planning day.

## Rejected / deferred dependencies
`rate-limiter-flexible` (limiter needs business keys and fail-closed semantics we control — small Lua implementation); `otplib` (TOTP not used); `class-validator` (contradicts ADR-005); CAPTCHA SDKs (not used in mobile); `jpeg-js`/`pngjs` (unmaintained); any custom image parser (not authorised).

## Smaller decisions (recorded in the adopting micro-phase report)
UUIDv7 server-side ids; one PostgreSQL schema per context with restricted roles; side lookup-index tables with key versions; relationship junction tables instead of id arrays; opaque storage keys; additive error-envelope `details`; route-policy completeness test as the "every route is authorised" gate.
