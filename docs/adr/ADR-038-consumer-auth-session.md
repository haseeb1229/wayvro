# ADR-038 — Consumer authentication and session domain implemented directly

| Field | Value |
|---|---|
| Status | **ACCEPTED on P2.1 evidence** — pending founder/ChatGPT review of micro-phase P2.1. Not a security certification: the independent assessment EG-17/U01 remains a gate before any real user |
| Date | 2026-10-10 |
| Supersedes | `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-038 (proposal, founder Q-11 conditional approval) |
| Requirements | P2.1 portions of A02, A03 (engineering), A05 (display name/locale), A11, K01, K08, K09, K13, Q06, Q36, Q39, S12 (signal), V02, V07; findings F-03, F-04, F-06 |
| Design | `docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md`, `docs/phase2/PHASE2_DOMAIN_AND_DATA_MODEL.md` §8; implementation record `docs/phase2/PHASE2_P2_1_IMPLEMENTATION_RECORD.md` |

## Decision
Implement the consumer auth/session **domain** on NestJS/PostgreSQL/Valkey without a general auth framework, under the founder's binding conditions — each met as follows:

| Condition | How P2.1 meets it |
|---|---|
| 1. `node:crypto` primitives only, formats per data model §8 | `@wayvro/field-crypto`: AES-256-GCM envelope v1 (random 96-bit nonce, 128-bit tag, AAD = field/row/field-schema version/key id), HMAC-SHA-256 lookups/MACs, `timingSafeEqual`, `randomBytes`/`randomInt`, SHA-256 token hashes; HKDF only to derive synthetic local keys. No custom primitive, mode or protocol |
| 2. protocol-heavy standards use focused libraries | not applicable in P2.1 (OIDC `jose` P2.10, WebAuthn P2.4) |
| 3. concurrency-sensitive transitions use DB constraints/transactions | partial unique indexes (current-owner phone per lookup version, one verified phone per account, one live refresh token per session, one rider profile), row locks + CAS on challenges and refresh tokens, idempotency rows inserted in the mutation transaction |
| 4. adversarial + concurrency suites in CI | SEC-OTP, PROP-OTP, CONC-OTP, SEC-ENUM, SEC-SESS, CONC-SESS, API-SESS, SEC-RT, SEC-IDOR, SEC-MA, SEC-LOG, SEC-AUDIT, PROP-AUDIT, UNIT/PROP-CRYPTO, BOOT-NEG, ART-ISO run in the `quality`/`integration` jobs |
| 5. independent assessment before real users | remains open (EG-17) |

**Mechanics (configurable defaults, founder Q-06/Q-07):** OTP 6 digits / 5 min / 5 attempts / resend 60→120→300 s / 3 resends; access token 15 min (opaque `wva_…`, rotated on every refresh), refresh token single-use (`wvr_…`), idle 60 days, absolute 180 days; replay leeway 30 s; dormancy risk threshold 90 days (provisional local/test value, EG-22). Tokens are 256-bit random values; only SHA-256 hashes are stored. Rate limits run in one atomic Valkey Lua script; **the limiter fails closed** for issuing and verifying codes and for refreshes.

## Deliberate refinements of the accepted design (for review)
1. **No session cache.** Every authenticated request (and every realtime handshake/re-validation) reads the session row. The design allowed a ≤ 30 s Valkey read-through cache; it was not built because a failed invalidation would weaken immediate revocation, and pilot-scale load does not need it. Revisit with measurements.
2. **Refresh replay window = idempotency-record lifetime = the leeway (30 s).** The design stored the replayable response for 60 s while accepting replays for 30 s; storing it exactly as long as it can be replayed is equivalent and shorter.
3. **Access token rotates on refresh** (one live access token per session); a client's in-flight requests with the previous token get 401 and retry with the new one.
4. **Silent drops create a `SUPPRESSED` challenge** (no MAC, never verifiable) so the response and database work match a real issuance; `SUPPRESSED` is an additive challenge status.
5. **Revoke-all freshness without a step-up flow:** allowed when the calling session was created by OTP within 10 min or is older than 24 h; otherwise `403 WAYVRO_E_STEP_UP_REQUIRED` (the explicit step-up endpoint is P2.9).
6. **S12 is signal-only in P2.1**: a dormant account signing in from an unknown installation records `DORMANT_ACCOUNT_NEW_INSTALLATION` + audit `RECYCLED_NUMBER_SIGNAL`; it does **not** yet restrict the session. The restricted `RECOVERY_REVIEW` flow is P2.9, so P2.1 alone must not face real users (none exist).

## Lookup-key rotation synchronisation (corrected 2026-10-11 after the P2.1 review)
The P2.1 writer inserted lookup rows for **every live (non-retired) key version**. After `READ_SWITCHED`/contract, a still-live `DECRYPT_ONLY` key let a writer that had planned under `BACKFILL` insert old-version rows after the contract deleted them (old rows reappear; completion did not re-check). Corrected semantics (`packages/identity-core/src/phone-lookup.ts`):

| Latest rotation for the target | Write set | Read set |
|---|---|---|
| none | authoritative (= oldest live ring version) | same |
| `BACKFILL` | new + old (dual-write) | new + old (dual-read) |
| `READ_SWITCHED` / `RETIRE_PENDING` / `DONE` | new (ACTIVE) only | new only |
| `ABANDONED` | old only (abandon deletes the partial new rows; BACKFILL only) | old only |

The sets come from the rotation ledger, not the key ring alone, so a ring that already holds a newer ACTIVE key before its rotation starts never hides rows that exist only under the older version; a ledger version missing from the ring fails closed. **Synchronisation:** a PostgreSQL transaction-level advisory lock per rotation target (`pg_advisory_xact_lock[_shared]`, not a process-local lock) — lookup writers take it SHARED before reading the ledger and hold it to commit; start / contract / abandon / complete take it EXCLUSIVE before the ledger row lock (consistent lock order; backfill steps use only the row lock, so no deadlock cycle). Start additionally refuses unless every existing lookup row is under the starting version; the backfill treats an existing new-version row with a different digest as a counted data conflict (previously `ON CONFLICT DO NOTHING` could keep it); `completeRotation` verifies **zero old-version lookup rows** (and the old key `RETIRED`) before `DONE`. Evidence: `packages/identity-core/test/rotation.integration.test.ts` — BACKFILL dual-write, READ_SWITCHED/RETIRE_PENDING active-only writes, a deterministic writer-vs-contract interleaving (writer paused between its BACKFILL plan and its insert; the contract is observed blocked on the advisory lock, then deletes the writer's old row), injected old row ⇒ completion fails closed, completion only after zero rows + RETIRED key, flipped-ring-before-start, abandon, per-version uniqueness; same-phone concurrent first sign-in unchanged (`apps/api/test/session.integration.test.ts`).

## Deployment hardening findings (P2.1 review, 2026-10-11)
- **PostgreSQL group roles are cluster-global.** `wayvro_migrator`, `wayvro_api`, `wayvro_worker`, `wayvro_realtime`, `wayvro_audit_sealer` (and later `wayvro_vault`) exist once per cluster. Until environment-namespaced role names or an equivalently reviewed isolation design exists, **staging and production must run on separate PostgreSQL clusters** (never two databases of one cluster); a LOGIN role granted membership for one environment would otherwise reach the other. Recorded as a Phase 7 deployment precondition (hosting is EG-05/ADR-028).
- **Trusted proxy and OTP IP limits.** `TRUST_PROXY` is now `false` (default), an explicit allowlist of reverse-proxy IP/CIDR entries, or `true` (trust every hop) — **refused in staging/production** at config load. Before real OTP activation (P2.A1) the trusted reverse proxy/network must be defined and direct untrusted access to the API origin blocked, so the client IP used for IP-prefix limits cannot be spoofed via `X-Forwarded-For`. No provider CIDRs are invented here.

## Consequences
- All correctness burden is in Wayvro's code and tests; the suites above are mandatory for every change to these modules.
- Realtime and API share one session verifier; revocation reaches open sockets within the re-validation interval (default 60 s) and at access-token expiry at the latest.
- Staging/production cannot boot until a KMS-backed key provider (EG-05) and an OTP adapter (EG-01) exist — by design.

## Alternatives / reversal path
As in the proposal (Better Auth, Ory Kratos, Keycloak, SuperTokens, Firebase/Supabase Auth). Reversal: the tables are plain and documented; migrating to an IdP means importing accounts (phone envelopes + lookups) and re-verifying phones; sessions reset.
