# ADR-005 — HTTP API framework

| Field | Value |
|---|---|
| Status | **ACCEPTED on Phase 1 spike evidence (SP-05)** — in force since Phase 1 review and merge (PR #1, merge commit `eaa1fcb`, 2026-10-10) |
| Date | 2026-10-09 |
| Supersedes | `docs/phase0/PHASE0_ADR_BACKLOG.md` ADR-005 row (OPEN-SPIKE) |
| Requirements | I03, I04, I09 (API schemas/quality gates); no product endpoint is implemented |
| Evidence | `tests/spikes/sp-05-api-realtime/` (`src/api.ts`, `src/gateway.ts`, `src/plain-gateway.ts`, `src/raw-ws-gateway.ts`, `results/*.json`); realtime results in ADR-005b |

## Context
Phase 0 nominated **NestJS + Fastify adapter** as the candidate, **Fastify with explicit module boundaries** as the fallback, and required SP-05 before any API scaffold coupling. Contracts stay framework-independent (`packages/contracts`, Zod).

## What was built and run
A NestJS API (`@nestjs/core|common|platform-fastify` 12.1.2 on Fastify 5.12.5) holding authoritative state in PostgreSQL 17.5 (pg 8.23.1), exposing a health endpoint, an HMAC-authorised snapshot endpoint and a ticker that commits versioned state changes and then publishes them through `@socket.io/redis-emitter` to Valkey 9.1.2; plus a NestJS realtime gateway (see ADR-005b). Environment as in ADR-004 (i5-1145G7, Windows 11, Node 24.20.0, Docker Desktop 29.8.1). Commands:
```bash
cd tests/spikes/sp-05-api-realtime
pnpm install --frozen-lockfile && npx tsc -p .     # Nest needs tsc (see findings)
pnpm infra:up                                       # Postgres + Valkey, project wayvro-spike-sp05, tmpfs
node dist/load.js 2000 100 2                        # clients, updates/s, client worker processes
node dist/connect-rate.js 1000 3                    # Nest vs plain Socket.IO vs raw ws attribution
pnpm infra:down
```

## Findings
**Integration — works, with five concrete frictions (all manageable):**
1. **NestJS 12 is ESM-only** (`"type": "module"` in every `@nestjs/*` package). Apps must be ESM (`module: NodeNext`). Nest 12.0.0 shipped 2026-08-27; 12.1.2 (2026-09-30) is six weeks into the major, while 11.x is still patched — churn risk recorded.
2. **DI depends on legacy `experimentalDecorators` + `emitDecoratorMetadata`.** esbuild-based runners (tsx) do not emit decorator metadata, so constructor injection silently breaks there; builds must use `tsc` (or SWC with metadata). TypeScript 6.0.x supports both flags; the native TypeScript 7 toolchain's support was not verified (and typescript-eslint caps TypeScript at `<6.1.0`, so the workspace stays on 6.0.x anyway — ADR-034).
3. `@nestjs/platform-socket.io@12.1.2` **pins `socket.io` to exactly 4.8.3**; a direct dependency on 4.8.4 produced two incompatible copies and type errors. The workspace must align to Nest's pin (syncpack rule) — no `^` drift.
4. Nest's socket adapter passes a partial `ServerOptions` that socket.io types as required — one typed cast in the adapter subclass.
5. Fastify adapter + `IoAdapter` + Redis adapter compose cleanly: API 88 lines, gateway 68 lines including the Redis adapter subclass and handshake auth (plain Socket.IO equivalent: 30 lines).

**Runtime cost:** in a 1,000-socket burst-connect attribution test, the NestJS gateway (700–1,006 connects/s, 1.1–1.5 CPU-s per 1,000 handshakes) was within run-to-run noise of a plain Socket.IO server (529–1,264 connects/s, 0.9–1.7 CPU-s). NestJS adds no measurable cost on the connection path. Isolated HTTP throughput of Nest vs plain Fastify was **NOT RUN** (not required for the decision: the API hot paths at pilot scale are DB-bound — see ADR-004).

**Correctness/recovery** (with ADR-005b): authoritative state survived every gateway kill in every run (0 client/database mismatches); the snapshot endpoint served the reconnect herds (p95 0.5–0.9 s in uncontended runs, see ADR-005b).

## Decision
**NestJS 12 (ESM) on the Fastify adapter** for `apps/api` (and the same stack for `apps/realtime`, ADR-005b). The fallback (Fastify with explicit module boundaries) is **not** triggered: the spike found no correctness or performance defect attributable to NestJS, and its module/DI/guard/interceptor structure fits the modular-monolith contexts (ADR-035). Conditions:
- **every constructor dependency is injected with an explicit `@Inject(TOKEN)`** (as implemented in `apps/api` and `apps/realtime`), so DI never relies on `emitDecoratorMetadata`: apps build with plain `tsc` (`experimentalDecorators` only), Vitest/esbuild can run them directly, and a future TypeScript compiler without decorator-metadata emit does not block Nest. (The spike itself relied on metadata and therefore had to be compiled with `tsc`.)
- Zod contracts in `packages/contracts` remain the source of truth; Nest DTO classes/`class-validator` are **not** used, so the contract layer stays framework-independent and the fallback stays cheap;
- dependency versions follow Nest's exact pins (syncpack-enforced).

## Consequences
- All server apps are ESM; shared packages must publish ESM.
- Upgrades of `@nestjs/*` move as one group; any Nest minor is re-validated by the CI integration job.
- Watch items: Nest 12 maturity; TypeScript 7 decorator-metadata support before any TS 7 move.

## Alternatives considered
- **Fastify + explicit modules (documented fallback):** lighter, no decorator metadata; would require hand-built DI/guards/lifecycle. Kept as the reversal path.
- **Hono:** strong for edge runtimes; no benefit for long-lived Node processes with sockets and leases.
- **Nest 11 LTS line:** viable; rejected to avoid an immediate major upgrade, at the cost of adopting a six-week-old major.

## Reversal path
Because contracts are Zod and handlers are thin, moving to plain Fastify means replacing controllers/modules and DI wiring, not contracts or domain code. Trigger: a Nest 12 defect affecting correctness/security, or unacceptable upgrade churn.
