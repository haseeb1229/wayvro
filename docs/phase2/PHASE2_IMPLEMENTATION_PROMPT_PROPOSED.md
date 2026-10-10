# PHASE2_IMPLEMENTATION_PROMPT_PROPOSED — Proposed prompt for micro-phase P2.1 (NOT AN AUTHORISATION)

**Date:** 2026-10-10 (updated by the planning closure correction) · **Status:** PROPOSED. This text authorises nothing. It may be executed only after the founder/ChatGPT accept the closed Phase 2 plan (`docs/phase2/PHASE2_PLAN.md`) and the founder explicitly authorises P2.1. Later micro-phases get their own prompts from `docs/phase2/PHASE2_IMPLEMENTATION_SEQUENCE.md` after each review.

---

WAYVRO — PHASE 2 — MICRO-PHASE P2.1 — CONSUMER IDENTITY/SESSION CORE AND PRODUCTION TEST-DOUBLE ISOLATION (IMPLEMENTATION)

Fresh session. Reconstruct context only from the then-current protected `main`, root `CLAUDE.md`, `docs/adr/`, the requirements register (532 IDs) and the accepted `docs/phase2/` plan. Verify branch, HEAD, `origin/main`, clean worktree, Git identity, `gh` auth and the `main` ruleset; STOP on any mismatch.

**Branch:** `phase-2/1-identity-session-core` from current `main`. Founder identity only; no AI attribution or co-author trailers; no force push/amend/rebase; do not touch `main`.

**In scope (IDs):** A02, A03 (engineering only), A05 (display name/locale), A11 (session list/revoke), K01 (account, phone, rider profile — per-phone/per-account uniqueness only; person uniqueness is not a DB claim), K08 (limits, outage, fail-closed), K09, Q06 (auth surfaces), Q36, Q39 (audit write path + seals), S12 (signal recording), V02, V07 (scoping pattern), K13 (families for P2.1 routes); **finding F-01 (ADR-045)**.

**Build exactly (per the accepted design docs):**
1. **Test-double isolation (first):** create dev-only `@wayvro/provider-test-doubles`; move the recording/in-memory doubles out of `@wayvro/provider-interfaces`; delete `defaultProviderBindings()`; production composition roots (api, worker, realtime) bind only real adapters (none exist yet → unbound features return `503`; staging/production config refuses to boot without adapter configuration); local runner entry points outside `src/` and outside the production build; release build marker that refuses `WAYVRO_ENV=local|test`; dependency-cruiser `no-production-to-test-doubles` + boundaries + Knip production checks; CI `artifact-isolation` step proving absence, `ERR_MODULE_NOT_FOUND`, marker refusal and no test-OTP route for each production artefact (verify `pnpm deploy --prod` with pnpm 12 + hoisted linker; otherwise use the documented fallback).
2. Migration `0001_identity_core` (reviewed SQL, five header fields) — schemas, NOLOGIN roles and grants, tables listed for P2.1 in the data-model doc §11 (incl. `phone_lookup_index` and `key_rotations`), partial unique indexes, audit trigger; migration tests incl. grants executed as each restricted role.
3. UUIDv7 helper (`packages/server-runtime`) with property tests.
4. Versioned AES-256-GCM envelope (format v1, random 96-bit nonce per encryption, AAD = field/row/schema version/key id), key states (`ACTIVE`/`DECRYPT_ONLY`/`RETIRED`), `KeyProvider` (local keys only in local/test), typed failure behaviour, HMAC lookups with key versions in side index tables, and the resumable rotation-job framework (dual-write → backfill → dual-read → switch → contract) — `node:crypto` only; UNIT-CRYPTO/PROP-CRYPTO.
5. Valkey limiter (atomic Lua) with business keys; fail-closed for OTP.
6. Persistent idempotency store wired into the existing `preHandler`.
7. Global policy guard (default deny) + route-policy completeness test.
8. OTP request/resend/verify, sessions, refresh rotation with reuse detection and 30-s idempotent leeway, logout, session list/revoke/revoke-all, `GET /v1/account/state` (P2.1 subset), `PATCH /v1/account/profile`, security events; session lifetimes as **configuration defaults** (15 min / 60 days / 180 days); dormancy threshold as configuration (90 days provisional, local/test design only).
9. PostgreSQL job runner in `apps/worker` with OTP-send and audit-seal jobs.
10. Realtime session-token authenticator replacing `DenyAllAuthenticator`.
11. Contracts, additive error codes, optional envelope `details`, explicit API error mapping (F-04).
12. Redaction keys/patterns + canary log scans; BOOT-NEG additions.

**Do NOT:** install any dependency beyond what P2.1 needs (expected: none) without the installation-time re-check; add real OTP/Google/Apple/KYC/storage/e-mail integrations; create tables for later micro-phases; add mobile or web-ops code; use real personal data; add deterministic/master OTP codes, bypass numbers, seeded users or emergency credentials; treat the recording sink as EG-01 evidence; weaken any gate; begin P2.2.

**Tests (report each PASSED/FAILED/SKIPPED/NOT RUN/BLOCKED with command and SHA):** ART-ISO, SEC-OTP, PROP-OTP, CONC-OTP, SEC-ENUM, SEC-SESS, CONC-SESS, API-SESS, SEC-RT, SEC-IDOR, SEC-MA, UNIT-CRYPTO, PROP-CRYPTO, SEC-AUDIT, PROP-AUDIT, SEC-LOG, BOOT-NEG; plus `pnpm check`, `pnpm test:coverage`, `pnpm openapi:check`, `pnpm test:integration`, `node scripts/boot-smoke.mjs`, migrations ×2, gitleaks, osv-scanner, `pnpm docs:check`.

**Docs in the same change:** ADR-038, ADR-042 and ADR-045 files under `docs/adr/` with evidence; Phase 2 status updates through generator sources where register data changes.

**Stop after P2.1.** Commit (founder identity, no AI trailer), push the branch, open a PR only if authorised, and report per `CLAUDE.md` §17 (files, IDs satisfied vs partial, commands/outcomes, migration/config impacts, security/privacy implications, compatibility evidence, blockers, NOT RUN items, SHA, CI URL).
