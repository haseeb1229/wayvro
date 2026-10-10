# PHASE2_IMPLEMENTATION_PROMPT_PROPOSED — Proposed prompt for micro-phase P2.1 (NOT AN AUTHORISATION)

**Date:** 2026-10-10 · **Status:** PROPOSED. This text does not authorise anything. It may be executed only after the founder approves the Phase 2 plan (`docs/phase2/PHASE2_PLAN.md`), answers the blocking founder questions (§10 there: at least Q-05, Q-06, Q-10, Q-11) and explicitly authorises P2.1. Later micro-phases get their own prompts derived from `docs/phase2/PHASE2_IMPLEMENTATION_SEQUENCE.md` after each review.

---

WAYVRO — PHASE 2 — MICRO-PHASE P2.1 — CONSUMER IDENTITY AND SESSION CORE (IMPLEMENTATION)

Fresh session. Reconstruct context only from the then-current protected `main`, root `CLAUDE.md`, `docs/adr/`, the requirements register and the approved `docs/phase2/` plan. Verify branch, HEAD, `origin/main`, clean worktree, Git identity, `gh` auth and the `main` ruleset; STOP on any mismatch.

**Branch:** `phase-2/1-identity-session-core` from current `main`. Founder Git identity only; no AI attribution or co-author trailers; no force push/amend/rebase; do not touch `main`.

**In scope (IDs):** A02, A03 (engineering only), A05 (display name/locale), A11 (session list/revoke), K01 (account, phone, rider profile), K08 (limits, outage, fail-closed), K09, Q06 (auth surfaces), Q36, Q39 (audit write path + seals), S12 (dormancy signal recording only), V02 (principal + global policy guard), V07 (profile-scoped query pattern), K13 (families for P2.1 routes).

**Build exactly (per the approved design docs):**
1. Migration `0001_identity_core` (reviewed SQL, five header fields): schemas `identity`, `profile`, `platform`, `audit`; NOLOGIN group roles and grants; tables listed for P2.1 in the data-model doc §10; partial unique indexes; audit no-update/no-delete trigger. Migration tests: clean→latest, previous→latest, re-run = 0, constraint/trigger existence, **grant behaviour executed as each restricted role**.
2. Server-side UUIDv7 helper (`packages/server-runtime`) with property tests.
3. `FieldCipher` + `KeyProvider` (AES-256-GCM, key ids; local key only in local/test; refused in staging/production) and HMAC phone lookup with a pepper.
4. Valkey limiter (atomic Lua) with business keys and fail-closed policy for OTP issuance.
5. Persistent idempotency store wired into the existing `preHandler` (replay, conflict on different payload, encrypted short-TTL storage for token responses).
6. Global NestJS policy guard (default deny), `@Public()` only on health and public auth routes, route-policy completeness test.
7. OTP challenge request/resend/verify, sessions, token refresh with rotation/reuse detection/30-s idempotent leeway, logout current, session list/revoke/revoke-all, `GET /v1/account/state` (P2.1 subset), `PATCH /v1/account/profile`, security events.
8. PostgreSQL job runner in `apps/worker` (`FOR UPDATE SKIP LOCKED`, leases, bounded backoff, dead-letter) with the OTP-send and audit-seal jobs.
9. Realtime: replace `DenyAllAuthenticator` with the session-token authenticator (fail-closed).
10. Contracts: Zod schemas, `API_ROUTES`, OpenAPI regeneration, additive error codes and optional envelope `details`; explicit error mapping in the API filter.
11. Redaction keys/patterns + canary log-scan harness; BOOT-NEG additions (staging/production refuse mock OTP, require OTP adapter config, test-OTP route 404, local key refused).

**Do NOT:** add any dependency not approved in ADR-038/042 (none is needed for P2.1); add a real OTP vendor, Google/Apple, KYC, storage or e-mail integration; create tables for later micro-phases; add mobile or web-ops code; use real phone numbers, CNICs or any personal data (synthetic only); add deterministic OTP codes, bypass numbers, seeded users or master codes; weaken lint/type/coverage/test gates; begin P2.2.

**Tests required (report each as PASSED/FAILED/SKIPPED/NOT RUN/BLOCKED with command and SHA):** SEC-OTP, PROP-OTP, CONC-OTP, SEC-ENUM, SEC-SESS, CONC-SESS, API-SESS, SEC-RT, SEC-IDOR and SEC-MA for P2.1 routes, SEC-AUDIT/PROP-AUDIT, SEC-LOG, UNIT-CRYPTO, BOOT-NEG; plus `pnpm check`, `pnpm test:coverage`, `pnpm openapi:check`, `pnpm test:integration`, `node scripts/boot-smoke.mjs`, migrations ×2, gitleaks, osv-scanner, and `pnpm docs:check`.

**Docs in the same change:** ADR-038 and ADR-042 files under `docs/adr/` with evidence; register evidence notes only through the generator workflow if approved; Phase 2 status line updates.

**Stop after P2.1.** Commit (founder identity, no AI trailer), push the branch, open a PR only if the founder authorises it, and return a complete report per `CLAUDE.md` §17: files, IDs satisfied vs partially satisfied, commands and exact outcomes, migration/config impacts, security/privacy implications, compatibility evidence, blockers/unverified assumptions, NOT RUN items (OTP vendor, devices), commit SHA and CI run URL.
