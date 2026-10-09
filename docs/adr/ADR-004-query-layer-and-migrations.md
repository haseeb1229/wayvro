# ADR-004 — Query layer, migration tooling and assignment locking

| Field | Value |
|---|---|
| Status | **ACCEPTED on Phase 1 spike evidence (SP-03 PASS)** — pending founder/ChatGPT review before merge to `main` |
| Date | 2026-10-09 |
| Supersedes | `docs/phase0/PHASE0_ADR_BACKLOG.md` ADR-004 row (OPEN-SPIKE) |
| Requirements | I03, Q15, R44 (process); groundwork for E-family dispatch invariants (INV-01/INV-03 in `docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md`) — no dispatch feature is implemented |
| Evidence | `tests/spikes/sp-03-postgis-concurrency/` (harness, migrations, `results/*.json`) |

## Context
Phase 0 nominated **Drizzle + raw SQL** as the candidate query layer and **Kysely + raw SQL** as the fallback, to be decided by SP-03: PostGIS candidate lookup at ~10k synthetic drivers (p95 < 50 ms target) and **exactly one winner for 100 concurrent accepts** on the same assignment opportunity, plus migrations from a clean and a previous schema.

## Environment (exact)
- Laptop: Intel i5-1145G7 (4 cores / 8 threads), 15.7 GB RAM, Windows 11 Pro 10.0.26300, Node 24.20.0.
- Docker Desktop 29.8.1 (WSL2 VM: 8 vCPU, 7.6 GiB). **DB container capped at 2 vCPU / 1 GiB** (`compose.yaml`), tmpfs storage, `max_connections=400`, `shared_buffers=256MB`.
- Image `postgis/postgis:17-3.5@sha256:01a6a70e…6f6` → PostgreSQL 17.5, PostGIS 3.5.2, GEOS 3.9.0, PROJ 7.2.1 (Debian bullseye base).
- **Noise:** unrelated containers of other local projects were running throughout (a SQL Server container at ~70 % CPU, ClamAV, three idle Postgres instances). They were not touched. The second concurrency run overlapped the start of a Gradle download for SP-AND. Latency numbers are therefore conservative laptop numbers, not production capacity figures.
- Packages: drizzle-orm 0.45.3, drizzle-kit 0.31.11, kysely 0.29.6, pg 8.23.1, TypeScript 6.0.3, tsx 4.23.15. (drizzle-orm 0.45.4 was published 2026-10-08 and was rejected by pnpm 12's default `minimumReleaseAge` supply-chain policy; the previous release was pinned instead of bypassing the policy.)

## Commands
```bash
cd tests/spikes/sp-03-postgis-concurrency
pnpm install --frozen-lockfile
pnpm db:up                                   # docker compose -p wayvro-spike-sp03 (tmpfs, no volumes)
npx drizzle-kit generate / --custom; npx drizzle-kit check
pnpm migrations                              # tsx src/migrations-test.ts
pnpm bench -- 10000 2000 ; pnpm bench -- 50000 2000
pnpm concurrency -- 20 100                   # 20 rounds x 100 simultaneous attempts per (strategy, scenario)
pnpm db:down
```

## Results

### 1. Migrations — PASS (with a documented PostGIS generator defect)
| Check | Result |
|---|---|
| drizzle migrator: clean DB → latest (4 migrations, PostGIS 3.5.2, `geography(Point,4326)`) | PASS (369 ms) |
| drizzle migrator: re-run is a no-op | PASS (4 → 4 recorded) |
| drizzle migrator: previous schema (3 migrations, with data) → latest (expand migration adds nullable column) | PASS, pre-existing rows preserved |
| Kysely migrator over the same SQL files: clean → latest, re-run no-op | PASS |
| `drizzle-kit check` | PASS |

**Defects found in drizzle-kit 0.31.11 PostGIS DDL generation (reproduced in the spike):**
1. `customType` names are always double-quoted, so `geography(Point,4326)` is emitted as `"geography(Point,4326)"` → PostgreSQL error `type "geography(Point,4326)" does not exist` (confirmed against the database).
2. The built-in `geometry('x', { type: 'point', srid: 4326 })` is emitted as `geometry(point)` — **the SRID is silently dropped**.

Workaround proven in the spike: declare the bare type (`"geography"`, valid when quoted) for query typing and apply the typmod in a reviewed custom SQL migration (`drizzle-kit generate --custom`), then assert the real column type (`format_type`) in the migration test. Silent SRID loss is exactly the kind of defect that must be caught by a test, so **every PostGIS column and index is written as reviewed custom SQL and verified by a migration test**.

### 2. Candidate lookup (nearest eligible drivers) — target met in the realistic regime
Query: eligible (`online`, not restricted, not busy, matching vehicle class, seen within 30 s) drivers within 3 km, ordered by geography KNN distance, `LIMIT 10`; GiST index on `geography` + partial b-tree on eligibility. 2,000 deterministic pickup points per run (after 100 warm-up queries); ≈5.9 candidates returned per query. Client-side latency including the Docker Desktop port-forward:

| Drivers | Concurrency | raw pg p50 / p95 / p99 (ms) | drizzle-orm `sql` p50 / p95 / p99 | Kysely `sql` p50 / p95 / p99 | Throughput (raw / drizzle / kysely, q/s) |
|---|---|---|---|---|---|
| 10,000 | 1 | 2.35 / **3.26** / 3.97 | 2.42 / **3.35** / 3.98 | 3.35 / 4.50 / 8.41 | 409 / 397 / 278 |
| 10,000 | 4 | 3.68 / **23.95** / 34.37 | 3.85 / **15.46** / 29.71 | 4.45 / 30.90 / 42.00 | 765 / 758 / 594 |
| 10,000 | 8 | 5.10 / 65.62 / 71.93 | 4.32 / 63.77 / 68.89 | 6.56 / 74.28 / 81.88 | 602 / 727 / 435 |
| 10,000 | 16 | 7.15 / 86.35 / 91.63 | 6.88 / 81.74 / 86.42 | 7.89 / 87.36 / 92.96 | 626 / 726 / 558 |
| 50,000 | 1 | 3.56 / 15.90 / 17.45 | 3.64 / 15.42 / 16.99 | 4.44 / 16.24 / 17.80 | 197 / 198 / 170 |
| 50,000 | 4 | 5.96 / 67.62 / 86.58 | 5.53 / 65.16 / 79.91 | 6.01 / 66.78 / 89.16 | 249 / 280 / 247 |

DB container CPU during the 10k run: mean 135 %, max 221 % of its 2-vCPU cap; memory 768 MiB of 1 GiB. `EXPLAIN (ANALYZE, BUFFERS)` (stored in `results/bench-*.json`): BitmapAnd of the GiST index and the eligibility partial index, top-N heapsort; ~7–9 ms server execution for a cold dense-hotspot point.

**Interpretation.** The p95 < 50 ms target is met with a wide margin at concurrency 1–4 for 10k drivers (3.3 ms / 15–31 ms). From concurrency 8 upward the **DB container is CPU-saturated at its 2-vCPU cap** (≈600–750 q/s), so the excess latency is queueing (Little's law: 16 in flight ÷ ~700 q/s ≈ 23 ms mean wait), not a query-plan defect. Dispatch at pilot/city scale issues candidate queries per ride request (≪ 100/s), far below the knee, so the architecture is acceptable. Bottlenecks to revisit in Phase 4 (not now): KNN index-ordered scan vs bitmap for dense hotspots, Redis GEO pre-filtering for live presence (already in the architecture), and DB sizing — measured on the real staging host, not this laptop.

### 3. Concurrent assignment — **correctness PASS**
Each round: 100 dedicated connections acquired first, released simultaneously through a barrier; afterwards SQL verifies the invariants (≤1 ACTIVE assignment per ride and per driver, exactly one winner, ride ASSIGNED once, offer ACCEPTED once, driver busy once). Scenarios: **A** one ride / 100 drivers; **B** one driver / 100 rides; **C** the same offer accepted 100 times (retry storm/double-tap). 20 rounds × 100 attempts per cell = 2,000 attempts per cell.

| Strategy | A correct | B correct | C correct | Duplicate rounds | Deadlocks | Attempt latency p95 under 100-way pile-up (A/B/C, ms) |
|---|---|---|---|---|---|---|
| CAS conditional UPDATEs (raw pg) | 20/20 | 20/20 | 20/20 | 0 | 0 | 161 / 253 / 196 |
| CAS via drizzle-orm query builder | 20/20 | 20/20 | 20/20 | 0 | 0 | 239 / 271 / 185 |
| CAS via Kysely query builder | 20/20 | 20/20 | 20/20 | 0 | 0 | 189 / 237 / 197 |
| `SELECT … FOR UPDATE` | 20/20 | 20/20 | 20/20 | 0 | 0 | 128 / 148 / 513 |
| `FOR UPDATE NOWAIT` (losers fail fast, 55P03) | 20/20 | 20/20 | 20/20 | 0 | 0 | 250 / 172 / 196 |
| `FOR UPDATE SKIP LOCKED` | 20/20 | 20/20 | 20/20 | 0 | 0 | 58 / 71 / 41 |
| `SERIALIZABLE` (losers 40001, no retry) | 20/20 | 20/20 | 20/20 | 0 | 0 | 174 / 257 / 178 |
| Partial unique indexes only (`ON CONFLICT DO NOTHING`) | 20/20 | 20/20 | 20/20 | 0 | 0 | 12 / 11 / 11 |
| **NEGATIVE CONTROL** check-then-act, no locks, no unique index | 0/20 | 0/20 | 0/20 | **20/20 rounds duplicated** (1,880–1,941 duplicate "wins" per 2,000) | 0 | — |

The negative control proves the harness can detect a broken strategy; every real strategy produced **exactly one valid winner and zero duplicate assignments in 6,000 contended attempts per strategy**. Latencies are dominated by 100 transactions queueing on one row on a 2-vCPU container; the uncontended winner path is a few milliseconds.

## Decision
1. **Query layer: drizzle-orm (0.45.x) with explicit `sql` templates for PostGIS and locking-sensitive statements** — the Phase 0 candidate is accepted. Runtime correctness and latency are equal to raw `pg`; the typed builder covers ordinary CRUD. Kysely (fallback) was equally correct but measured slightly slower in this harness (≈+0.9 ms p50 at c=1) and offers no decisive advantage, so the fallback is **not** triggered.
2. **Migration tooling: SQL-first, reviewed migrations applied by the drizzle migrator.** `drizzle-kit generate` may draft plain relational DDL, but every migration is a reviewed SQL file, **all PostGIS types/indexes are hand-written custom migrations**, and the migration test asserts real column types/extensions. Kysely's migrator was proven able to run the same SQL files, which is the escape hatch if drizzle-kit becomes a liability (no lock-in: the artefacts are plain SQL).
3. **Assignment locking pattern (for Phase 4 design, not implemented now):** single-transaction **conditional UPDATE (CAS) on ride → offer → driver in a fixed order**, backed by **partial unique indexes** (one ACTIVE assignment per ride and per driver) as the database-enforced last line of defence, and the outbox insert in the same transaction. `SKIP LOCKED` is reserved for worker job-claiming; `NOWAIT` is acceptable where fast failure is preferable; `SERIALIZABLE` is not chosen for the hot path (higher latency, mandatory retry loops).

## Consequences
- `packages/db` uses drizzle-orm + `pg`, a migrations folder of reviewed SQL, and a migration test that runs clean → latest, previous → latest and re-run, asserting extension/column facts.
- Every PostGIS schema change needs a custom migration and a type assertion in tests (drizzle-kit defects above).
- Concurrency tests with real Postgres (not mocks) are mandatory for every assignment/money invariant (CLAUDE.md §5); this harness is the template.
- Watch items: drizzle-kit is pre-1.0 with active churn; re-evaluate when drizzle 1.0 ships. The postgis image's Debian bullseye base and GEOS 3.9/PROJ 7.2 are old — production uses a managed PostgreSQL 17 + PostGIS 3.5 (ADR-028), and local images are pinned by digest.

## Alternatives considered
- **Kysely + raw SQL (documented fallback):** correct; marginally slower here; migration authoring fully manual. Kept as the escape hatch.
- **Prisma:** not benchmarked — its PostGIS support relies on `Unsupported()` types and raw queries for every spatial operation, and its query engine adds a separate runtime; no advantage for the hot paths measured here.
- **Raw `pg` only:** fastest and simplest for hot paths, but no typed builder for the long tail of CRUD; drizzle's `sql` template keeps raw SQL where needed.

## Reversal path
Migrations are plain SQL, so switching the runtime layer to Kysely or raw `pg` changes query code only (no schema rewrite). The spike already demonstrates Kysely's migrator running the same files. Trigger for reversal: a drizzle-orm runtime defect affecting correctness, or drizzle-kit defects that cannot be contained by the SQL-first policy.

## Spike disposal
`tests/spikes/sp-03-postgis-concurrency/` is a disposable evidence harness (not production code, excluded from the workspace). Its synthetic tables are not the product schema. It is retained only so reviewers can reproduce this evidence and must be deleted, or its concurrency suite rewritten into `tests/integration` against the real dispatch schema, by the **Phase 4 gate**.
