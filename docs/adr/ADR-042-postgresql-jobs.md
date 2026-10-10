# ADR-042 — Background jobs on PostgreSQL (`FOR UPDATE SKIP LOCKED`), not BullMQ

| Field | Value |
|---|---|
| Status | **ACCEPTED on P2.1 evidence** — pending founder/ChatGPT review of micro-phase P2.1 |
| Date | 2026-10-10 |
| Supersedes | `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-042 (proposal); resolves CON-P2-01 (BullMQ in the architecture proposal vs `SKIP LOCKED` in ADR-004) |
| Requirements / findings | F-05 (job runner part), A03 (OTP delivery), Q39 (sealing), Q08/§8 rotation jobs |
| Evidence | `packages/server-runtime/src/jobs.ts`, `packages/server-runtime/test/jobs-audit.integration.test.ts`, `packages/identity-core/src/otp-delivery.ts` (+ `test/delivery-session.integration.test.ts`), `apps/worker/src/*` (+ `test/worker.integration.test.ts`), table `platform.jobs` (migration `0001_identity_core`) |

## Decision
A small job runner on the `platform.jobs` table, no new dependency:
- **Transactional enqueue**: `enqueueJob(tx, …)` runs on the caller's transaction (a job exists iff the state change commits). Plain enqueues are INSERT-only, which is all `wayvro_api` is granted; `ON CONFLICT` is used only for dedupe-keyed recurring jobs (it needs SELECT on the arbiter columns — found by the restricted-role tests).
- **Claim**: one statement, `SELECT … FOR UPDATE SKIP LOCKED` on runnable jobs of the runner's registered types, marks them `RUNNING` with a lease and increments `attempts` (at-least-once).
- **Crash recovery**: each pass returns `RUNNING` jobs with an expired lease to `QUEUED` and clears their fencing token.
- **Fencing (corrected 2026-10-11 after the P2.1 review):** every claim writes a fresh random `platform.jobs.lease_token uuid` (`gen_random_uuid()`), carried in `ClaimedJob.leaseToken`; every success / retry / dead transition requires the exact `(id, status = 'RUNNING', lease_token)`. A worker whose lease expired and was re-claimed updates **zero rows** and reports the job as `stale` (`RunResult.stale`), never as succeeded/retried/dead, and never calls `onDead`. `locked_by` is a **diagnostic label only**: the P2.1 implementation fenced on `locked_by = workerId`, and process-derived worker ids (`worker-<pid>`) can collide across containers, so two workers could each "own" the same claim. The schema enforces `RUNNING ⇔ lease_expires_at, locked_by and lease_token NOT NULL`.
- **Bounded retry**: full-jitter exponential backoff (shared `backoffDelayMs`, also used by the outbox relay skeleton); after `max_attempts` → `DEAD` + `onDead` hook + error log. Stored errors are stable codes only (`last_error_code`), never raw messages.
- **Transient secrets**: `sealed_payload` holds an AES-256-GCM envelope (key class `job_secrets`, AAD bound to the job id) — used by `otp.deliver` for the destination number and code — and is purged when the job finishes. This resolves the plan's tension between "the code is never stored" and "send asynchronously via the job table": the code is never stored in clear, only sealed in flight.
- **Recurring jobs**: `RecurringScheduler` enqueues with dedupe key `recurring`; the partial unique index `(type, dedupe_key) WHERE status IN ('QUEUED','RUNNING')` keeps one open instance per type across worker processes.
- P2.1 job types: `otp.deliver` (registered only where an OTP adapter is bound: the API local runner in development; none in production before EG-01), `audit.seal`, `audit.verify-seals`, `maintenance.purge`, `crypto.key-rotation`.

## Evidence (real PostgreSQL 17.5, restricted roles)
- 60 jobs × 6 concurrent runners × batches of 5: every job processed exactly once.
- Retry → `DEAD` after `max_attempts` with `PROVIDER_REJECTED`; sealed payload purged; `onDead` called once; unexpected errors stored as `UNEXPECTED_ERROR` and the synthetic phone in the error never reaches logs.
- Expired lease → reclaimed and processed by another worker; the "dead" worker's late update is fenced (0 rows).
- Distributed fencing (2026-10-11): two runners **sharing one workerId**; the first stalls past its lease, the second re-claims with a fresh token. Stale success (before and after the new owner finishes), stale retry and stale dead-letter all update zero rows, are counted as `stale`, leave the new owner's `RUNNING` claim/token intact and never call `onDead`; five claims get five distinct tokens; `RUNNING` without a token violates the CHECK. The 60-job / 6-runner exactly-once test stays green.
- Dedupe: second open recurring job refused; the API role cannot use the dedupe path (permission denied).
- `otp.deliver`: single delivery + provider reference; redelivery is a no-op; expired/superseded challenges are skipped; provider outage → bounded retries → `DELIVERY_FAILED`; a sealed payload moved to another job fails AAD authentication (`SEALED_PAYLOAD_INVALID`).

Fencing protects the **job row**. Handler side effects outside that row must still be idempotent (at-least-once): a stale worker may already have performed its external call before discovering it lost the lease.

## Consequences
- One state store (PostgreSQL) for domain state and jobs; Valkey stays a cache/limiter/fan-out only.
- At-least-once: a crash between a provider call and the reference update can re-send the same OTP once (documented residual).
- Throughput is bounded by PostgreSQL; fine at pilot scale, re-measured before high-volume job types (Phase 4+).

## Alternatives / reversal path
BullMQ (second state store, non-transactional enqueue) rejected; pg-boss is the reversal target if the runner's surface grows. Handlers depend only on `JobDefinition`/`ClaimedJob`, so swapping the engine does not touch them.
