# ADR-005b — Realtime transport and recovery model

| Field | Value |
|---|---|
| Status | **ACCEPTED on Phase 1 spike evidence (SP-05: correctness/recovery PASS; 2k-herd latency target NOT MET on the dev laptop — root-caused, re-test gate set)** — pending founder/ChatGPT review |
| Date | 2026-10-09 |
| Supersedes | `docs/phase0/PHASE0_ADR_BACKLOG.md` ADR-005b row (OPEN-SPIKE) |
| Requirements | groundwork for M26/ADR-033 (socket/poll primary offer channel), Q33 (resilience); SLO "realtime reconnect to authoritative state < 5 s p95" (`docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md` §9). No realtime product feature is implemented |
| Evidence | `tests/spikes/sp-05-api-realtime/` (`src/gateway.ts`, `src/client.ts`, `src/load.ts`, `src/connect-rate.ts`, `results/*.json`) |

## Context
Candidate: **Socket.IO in a separate realtime process with the Redis adapter**; snapshot-recovery API mandatory either way; fallback: raw WebSocket gateway. Pass criteria (Phase 0): 2k simulated sockets; gateway kill → no lost authoritative state; recovery < 5 s p95; acceptable complexity.

## Test design
- 1 API process (authoritative state in PostgreSQL; commits a versioned change, then publishes via `@socket.io/redis-emitter`), **2 gateway processes** (NestJS 12 + Fastify + `@nestjs/platform-socket.io`, `@socket.io/redis-adapter` 8.3.0 on Valkey 9.1.2), clients split across both.
- Handshake authentication: HMAC-signed token checked in `server.use` before the connection is accepted (fail closed); a forged token is tried first in every run.
- Clients (socket.io-client 4.8.4, websocket transport) track `lastVersion`; in-order events apply, gaps trigger a snapshot fetch, every (re)connect fetches the **authoritative HTTP snapshot**. A load-balancer is simulated by failing over to the other gateway with 100–500 ms jitter.
- 500 entities, 100 committed updates/s (≈400 deliveries/s at 2k clients) during 20 s steady state; then **SIGKILL gateway A while updates continue**, restart it, **SIGKILL gateway B** (by then carrying *all* clients). After quiescing, every client's `lastVersion` is compared with the database.

## Results
| Run (file) | Clients / client procs | Verdict | DB mismatches | Steady delivery p95 | Kill → recovered p95 (herd size) | Reconnect phase p95 | Snapshot phase p95 | Notes |
|---|---|---|---|---|---|---|---|---|
| 200-client smoke (file not kept: earlier harness revision mis-attributed kill windows) | 200 / 1 | PASS | 0 | 4 ms | disconnect→recovered p95 0.84 s | — | — | harness debugging run |
| `sp05-1000-w2.json` | 1,000 / 2 | **PASS** | **0** | 7 ms | **1.53 s** (500) · **2.23 s** (1,000) | 1.87 s | 0.52 s | meets < 5 s |
| first 2,000 run (overwritten, numbers from console) | 2,000 / 1 | PASS | 0 | 5 ms | 5.0 s overall (p95 4,996 ms) | — | — | at target |
| `sp05-2000-single-process-harness.json` | 2,000 / 1 | PASS | 0 | 8 ms | 5.07 s overall | 3.72 s | 0.92 s | harness event loop stalled up to 738 ms |
| `sp05-2000-w4-contended-7-node-procs.json` | 2,000 / 4 | PASS | 0 | 43 ms | 5.46 s (1,000) · 8.83 s (2,000) | 6.27 s | 1.66 s | 7 Node processes + DB VM on 4 cores; harness stalls up to 2 s |
| `sp05-2000-w2-run1-FAIL-unexplained-client-stall.json` | 2,000 / 2 | **FAIL** (1,000 clients unrecovered after 30 s) | **0** | 15 ms | 83.8 s (1,000) · 6.27 s (2,000) | 82.2 s | 2.5 s | one client worker's event loop blocked for 25 s and 3,729 connect attempts failed; **cause not established** (a Gradle NDK download was running; the identical configuration re-run under the same conditions passed); all clients still converged to DB truth |
| `sp05-2000-w2-run2.json` | 2,000 / 2 | PASS | 0 | 11 ms | **2.76 s** (1,000) · 6.39 s (2,000) | 4.77 s | 1.09 s | same conditions as run 1; harness stalls ≤ 0.9 s |

Every run: forged-token handshake **rejected**, 100 % of clients connected, **zero lost authoritative state** (every client equal to the database after recovery, including the contaminated run), Redis-adapter fan-out delivered API-emitted events to clients on both gateways. Gateway RSS ≈100 MB idle → 110–136 MB with 1,000 clients each.

**Connection-cost attribution** (`results/connect-rate-1000.json`, 1,000-socket bursts, 3 runs each): NestJS gateway 700–1,006 connects/s (1.1–1.5 CPU-s per 1,000); plain Socket.IO 529–1,264/s (0.9–1.7 CPU-s); raw `ws` with the same HMAC check but no rooms/fan-out/framing 1,590–2,119/s (0.56–0.77 CPU-s).

## Analysis
- **Correctness and recovery: PASS.** Realtime is a delivery channel only; the snapshot API restored truth in every scenario, including total loss of the gateway carrying all 2,000 clients and a pathological 25 s client stall.
- **Latency target:** met for herds up to 1,000 clients per surviving gateway (p95 1.5–2.2 s). For a **2,000-client herd onto a single surviving gateway on this laptop**, p95 is 5.0–8.8 s depending on how much of the 4-core machine the simulated clients consume. The dominant cost is the reconnect phase: Socket.IO handshakes cost ≈1–1.7 ms CPU each in a single Node process (≈600–1,000/s), so 2,000 near-simultaneous reconnects queue for 2–3 s before the snapshot phase. NestJS is not the cause (plain Socket.IO is equivalent); raw `ws` handshakes are ≈1.5–2× cheaper but would require rebuilding rooms, cross-process fan-out, acknowledgements and reconnection.
- The 5 s SLO is therefore a **capacity-planning** constraint, not an architecture blocker: provision gateways for N-1 failure so a single failure never moves more than ~1,000 clients onto one process on comparable hardware, spread reconnects with jitter proportional to herd size, and measure on the real staging host.

## Decision
**Socket.IO 4.8.x in a separate `apps/realtime` process (NestJS gateway, ADR-005), Redis adapter for horizontal fan-out, Redis-protocol server (Valkey locally — ADR-037), mandatory authoritative snapshot recovery.** The raw-WebSocket fallback is **not** triggered: correctness passed, and its only advantage (cheaper handshakes) is addressed by horizontal capacity. Contract rules carried into Phase 4:
- every realtime event carries an aggregate id and monotonic **version**; clients apply only `version == last + 1`, otherwise fetch the snapshot;
- every (re)connect fetches the authoritative snapshot before showing state; push/realtime never authoritative (CLAUDE.md §4, M26);
- handshake authentication happens before the connection is accepted; room membership is derived server-side from verified claims, never from client-sent room names;
- reconnect backoff with full jitter and a ceiling; gateways sized for N-1.

## Consequences / gates
- **Open item:** the one FAIL run (a 25 s client-harness stall followed by 3,729 failed connects) is unexplained; it did not reproduce, and correctness held, but the Phase 4 re-test must capture gateway/API CPU and event-loop telemetry so a recurrence can be attributed.
- **Phase 4 gate (re-test):** repeat SP-05 on staging-class hardware with clients on separate machines, ≥2k sockets, N-1 sizing, and silent network loss (no FIN — depends on ping interval/timeout tuning, not exercised here); target p95 < 5 s.
- `@socket.io/redis-adapter` 8.3.0 (2024-03) and `@socket.io/redis-emitter` 5.1.0 (2023-01) are low-churn; monitor maintenance. Socket.IO version follows Nest's exact pin (4.8.3 server side).

## Reversal path
The recovery model (versioned events + snapshot API) is transport-independent. Replacing Socket.IO with raw `ws` (or SSE for one-way streams) changes `apps/realtime` and the client transport adapter only.
