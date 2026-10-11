# PHASE2_P2_1_IMPLEMENTATION_RECORD — Consumer identity/session core + production test-double isolation

**Date:** 2026-10-10 · **Branch:** `phase-2/1-identity-session-core` from `main` @ `8c8e528bf2a975f2fe385fd49ed9de78f29ed530` · **Status:** **IMPLEMENTED ON THE BRANCH — PENDING FOUNDER/CHATGPT REVIEW; NOT MERGED; no PR opened.** P2.2 and later micro-phases have not started. · **Agent:** Claude Code (self-audit, not independent verification). · **Authorisation:** founder authorised P2.1 only.

Synthetic data only. No provider account was created, no SMS/OTP was sent to a device, no real phone number, CNIC or customer data was used. External gates EG-01..EG-23 remain open; none is claimed resolved.

## 1. Requirement status (P2.1 never completes a whole requirement: every ID below also has later micro-phases)

Vocabulary: **SATISFIED_IN_P2_1** = the P2.1 portion assigned by `PHASE2_IMPLEMENTATION_SEQUENCE.md` is implemented and tested; **PARTIAL** = the requirement as a whole is not yet satisfied; **EXTERNAL_GATED** = also blocked by an external gate; **NOT_IN_SCOPE** = explicitly left to a later micro-phase.

| ID | P2.1 portion | Whole requirement | Remaining (owner) |
|---|---|---|---|
| A02 | SATISFIED_IN_P2_1 — +92 → E.164 only, syntax-only 400, identical responses (SEC-ENUM), multi-dimensional limits | PARTIAL | mobile phone-entry view states (P2.3) |
| A03 | SATISFIED_IN_P2_1 (engineering) — CSPRNG code, MAC-only storage, TTL, single use, resend cooldown/escalation/cap, installation limits, outage → `DELIVERY_FAILED`/503 | PARTIAL + EXTERNAL_GATED | real OTP vendor + tested integration (EG-01, EG-14; P2.A1); mobile UI (P2.3). The recording sink is **not** EG-01 evidence |
| A05 | SATISFIED_IN_P2_1 — display name + preferred locale (allowlisted PATCH, audited) | PARTIAL | phone change with re-verification, recovery/lockout (P2.9); UI (P2.3) |
| A11 | SATISFIED_IN_P2_1 — session list (no IP/location), revoke one/all/others, logout, in-app security activity | PARTIAL + EXTERNAL_GATED | suspicious-login notices via SMS (EG-01) / push (Phase 4); UI (P2.3); notices (P2.9) |
| K01 | SATISFIED_IN_P2_1 — account, rider profile, phone ownership; DB invariants: one current verified phone ↔ at most one account (per lookup-key version) and one account ↔ at most one current verified phone; person uniqueness explicitly **not** a DB property | PARTIAL | staff realm (P2.4), driver profile (P2.5), OIDC linking (P2.10) |
| K08 | SATISFIED_IN_P2_1 — E.164, TTL, one-time, throttles, quotas, budget stop, prefix conversion monitor + friction, limiter fail-closed, outage handling | PARTIAL + EXTERNAL_GATED | SIM-swap heuristics, recovery (P2.9); vendor caps/cost (EG-01); operator data (EG-22). ASN signals not implemented (no approved IP-to-ASN source) |
| K09 | SATISFIED_IN_P2_1 (server) — opaque 256-bit tokens, SHA-256 at rest, 15-min access, rotating single-use refresh, reuse → family revocation, idempotent lost-response replay, logout/logout-all/revocation | PARTIAL | mobile secure storage + single-flight client (P2.3, Q01) |
| K13 | SATISFIED_IN_P2_1 — adversarial families for every P2.1 route (§3) | PARTIAL | completed in P2.9; independent test U01/EG-17 (Phase 7) |
| Q06 | SATISFIED_IN_P2_1 — OTP bombing/pumping limits, enumeration resistance on auth routes | PARTIAL + EXTERNAL_GATED | playbooks (P2.9); fare/driver abuse (Phase 3/4); vendor caps (EG-01) |
| Q36 | SATISFIED_IN_P2_1 — redaction keys/patterns for tokens, OTP codes, challenge/installation ids, idempotency keys, envelopes, presign parameters; canary tests on every P2.1 flow | PARTIAL | every later micro-phase extends the canaries |
| Q39 | SATISFIED_IN_P2_1 — append-only audit (grants + UPDATE/DELETE/TRUNCATE triggers), write path, Merkle/hash-chain seals and seal verification job | PARTIAL + EXTERNAL_GATED | staff audit viewer (P2.4); external anchoring of seals (EG-05) |
| S12 | SATISFIED_IN_P2_1 (signal foundation only) — dormant account + unknown installation recorded as security event + audit | PARTIAL | the restricted `RECOVERY_REVIEW` flow (P2.9). **Residual:** in P2.1 a recycled number still signs into the old account — acceptable only because no real user exists |
| V02 | SATISFIED_IN_P2_1 — one account, separate rider profile, server-side policy guard; client mode/role headers ignored | PARTIAL | driver profile/capabilities (P2.5+) |
| V07 | SATISFIED_IN_P2_1 — owner-scoped queries, foreign ids → 404, no cross-account reads | PARTIAL | full suite with driver/staff data (P2.9) |
| F-01 | SATISFIED_IN_P2_1 (ADR-045) | — | — |
| F-03 | SATISFIED_IN_P2_1 for every P2.1 mutating route | — | each later mutating route uses the same store |
| F-04 | SATISFIED_IN_P2_1 | — | — |
| F-05 | job runner SATISFIED_IN_P2_1 (ADR-042) | PARTIAL | outbox relay with its first consumer (P2.7) |
| F-06 | SATISFIED_IN_P2_1 — `DenyAllAuthenticator` replaced by the session authenticator | — | — |
| F-08 | SATISFIED_IN_P2_1 — every grant/authorization test runs as a LOGIN member of a restricted group role; objects are owned by `wayvro_migrator` | — | local developer DB user is still a superuser (by design for local infra) |

NOT_IN_SCOPE (untouched): A04, A15, R09, W05, K14 (P2.2); Q01, V01 (P2.3); H01, H08, K10, Q42, W07 (P2.4); D01–D04, K02–K07, K11, R02–R06, R46, V03, V13, Q08 activation (P2.5–P2.8); K15, K16, K17, S13, U06 (P2.9/P2.10); K22, Q44, Q45 (external).

## 2. Refinements of the accepted plan made during implementation (for review)

| # | Area | Plan text | Implemented | Reason |
|---|---|---|---|---|
| R-01 | OTP silent drop | identical 202 | additive challenge status `SUPPRESSED` (no MAC, never verifiable) | equal response shape and database work without creating a guessable live challenge |
| R-02 | OTP verification needs the phone | challenge stores lookup hash only | challenge also stores `phone_envelope` (contact key, AAD = challenge row) and `locale` | the verified number must be encrypted into `account_phones`; purged with the challenge (7-day retention placeholder) |
| R-03 | Async OTP send vs "code never stored" | job payload ids only | `platform.jobs.sealed_payload` (key class `job_secrets`, AAD = job id), purged on completion | the code never exists in clear at rest |
| R-04 | Key classes | contact, identity_numbers, identity_dates, oidc_contact, idempotency_responses (+ lookup keys) | P2.1 uses `contact`, `phone_lookup`, `otp_mac`, `idempotency_responses`, `job_secrets`, `risk_signals` | separate keys for MACs, transient secrets and keyed abuse dimensions (IP prefix) |
| R-05 | Idempotency record | PK (scope, key) | additional `id uuid` | the response envelope's AAD needs a row id |
| R-06 | Session cache | Valkey read-through ≤ 30 s | none — session row read per request | invalidation failure would weaken immediate revocation (ADR-038) |
| R-07 | Refresh replay retention | 60 s storage, 30 s leeway | record lifetime = leeway (30 s) | equivalent, shorter |
| R-08 | Roles | migrator, api, vault, worker, audit_sealer | + `wayvro_realtime` (column-level SELECT for session verification); `wayvro_vault` deferred to P2.6 | least privilege for the realtime handshake |
| R-09 | API grant on rotation progress | — | `SELECT (target, phase)` on `platform.key_rotations` | the lookup read set depends on the rotation phase |
| R-10 | Enumerated values | full Phase 2 sets | only values P2.1 produces (account `ACTIVE`; phone `VERIFIED`; device `NEW`/`KNOWN`; session revoke reasons for logout/logout-all/single revoke/reuse) | no speculative states; later micro-phases widen the CHECKs additively |
| R-11 | Revoke-all freshness | step-up ≤ 10 min | session created by OTP ≤ 10 min ago, or older than 24 h; otherwise 403 `WAYVRO_E_STEP_UP_REQUIRED` | step-up endpoint is P2.9 |
| R-12 | Error codes | 17 planned | 8 added (`FORBIDDEN`, `RATE_LIMITED`, `IDEMPOTENCY_CONFLICT`, `OTP_INVALID_OR_EXPIRED`, `OTP_LOCKED`, `STEP_UP_REQUIRED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`) + optional `details.retryAfterSeconds` | only codes P2.1 emits; additive |
| R-13 | Shared code location | identity owner module in `apps/api` | server-only packages `@wayvro/field-crypto` and `@wayvro/identity-core` (tokens, session verifier, phone lookup, OTP delivery job, rotation engines) | api, worker and realtime need the same primitives; apps never import each other |
| R-14 | Request body limit | 1 MiB (Phase 1) | 64 KiB | identity routes carry tiny JSON bodies |
| R-15 | Test infrastructure | — | dev-only `@wayvro/test-support` (throwaway DBs, restricted logins, barrier, log capture) | covered by the same ADR-045 isolation rules |

## 3. Test evidence index (all synthetic; real PostgreSQL 17.5/PostGIS 3.5.2 and Valkey 9.1.2 via `docker compose -p wayvro`)

| Family | Where |
|---|---|
| ART-ISO | `scripts/artifact-isolation.mjs` (CI `quality`, last step) |
| BOOT-NEG | `scripts/boot-smoke.mjs` §1–1c (CI `integration`) |
| SEC-OTP / PROP-OTP / CONC-OTP / SEC-ENUM | `apps/api/test/otp.integration.test.ts`, `apps/api/test/abuse.integration.test.ts` |
| SEC-SESS / CONC-SESS / API-SESS / SEC-IDOR / SEC-MA / SEC-LOG / idempotency / S12 signal / SEC-AUDIT (API level) | `apps/api/test/session.integration.test.ts` |
| Default deny, F-04 mapping, route table | `apps/api/test/app.test.ts` |
| SEC-RT | `apps/realtime/test/session-auth.integration.test.ts`, `apps/realtime/test/gateway.test.ts` |
| UNIT-CRYPTO / PROP-CRYPTO | `packages/field-crypto/src/crypto.test.ts`, `packages/identity-core/test/rotation.integration.test.ts` |
| SEC-AUDIT / PROP-AUDIT | `packages/db/test/identity-core.integration.test.ts`, `apps/worker/test/worker.integration.test.ts` |
| Migrations + grants as restricted roles | `packages/db/test/*.integration.test.ts` |
| Limiter / job runner | `packages/server-runtime/test/*.integration.test.ts` |
| OTP delivery job / session verifier | `packages/identity-core/test/delivery-session.integration.test.ts` |

## 3a. Review corrections applied on `phase-2/identity-controlled-onboarding` (2026-10-11)
The founder/ChatGPT review of this branch found two correctness defects; the original branch `phase-2/1-identity-session-core` is kept unchanged for audit and the corrections were made on the full Phase 2 branch (unreleased `0001_identity_core.sql` edited in place — no corrective migration, nothing was ever deployed).

| # | Defect | Correction | Evidence |
|---|---|---|---|
| RB-01 | Job completion fenced by `locked_by = workerId`; process-derived ids collide across containers | per-claim `platform.jobs.lease_token uuid` (fresh `gen_random_uuid()` on every claim, cleared on reclaim); success/retry/dead require `(id, RUNNING, lease_token)`; a stale worker updates 0 rows and reports `stale`; `workerId` diagnostic only (ADR-042) | `packages/server-runtime/test/jobs-audit.integration.test.ts` — shared-workerId stale success (both orders), stale retry, stale dead (no `onDead`), fresh token per claim, CHECK; 60-job exactly-once unchanged |
| RB-02 | Lookup writer used every live key version; after `READ_SWITCHED`/contract an old `DECRYPT_ONLY` key could resurrect old rows; completion did not re-check | ledger-derived read/write sets (BACKFILL dual; READ_SWITCHED/RETIRE_PENDING/DONE active-only; ABANDONED old-only), PostgreSQL advisory lock per target (writers SHARED to commit; start/contract/abandon/complete EXCLUSIVE), start data check, digest-mismatch conflicts, `completeRotation` requires zero old rows (ADR-038) | `packages/identity-core/test/rotation.integration.test.ts` — 9 tests incl. deterministic writer-vs-contract interleaving |
| DH-01 | PostgreSQL group roles are cluster-global | staging and production on separate clusters until namespaced roles exist (Phase 7 precondition, ADR-038) | documentation |
| DH-02 | `TRUST_PROXY=true` trusts every `X-Forwarded-For` hop | allowlist of proxy IP/CIDRs; trust-all refused in staging/production; real OTP activation requires a defined trusted proxy/network and a blocked direct origin | `apps/api/test/config.test.ts` |

## 4. Residual risks and debt
- No independent security assessment (EG-17); OWASP ASVS/MASVS conformance not claimed.
- S12 recycled-number inheritance is not prevented until P2.9 (signal only).
- Timing equality is checked coarsely (median difference < 100 ms over 8 requests); no microsecond claim.
- A database superuser/owner can rewrite audit rows and recompute seals; external anchoring is EG-05.
- At-least-once OTP delivery can re-send the same code once after a crash.
- The limiter script touches several keys; a Redis Cluster deployment needs co-located keys (ADR-028 open).
- Staging/production cannot boot: no KMS-backed key provider (EG-05) and no OTP adapter (EG-01) — intentional.
- Local and test key material is HKDF-derived from a committed synthetic seed; it protects nothing and is refused outside local/test.
- Mobile clients, real devices and iOS: NOT RUN (no mobile code in P2.1).
