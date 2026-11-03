# SP-05 — NestJS + Fastify API, Socket.IO gateways with Redis adapter, gateway loss and snapshot recovery (DISPOSABLE)

Evidence harness for `docs/adr/ADR-005-api-framework.md` and `docs/adr/ADR-005b-realtime-transport.md`. Synthetic data only; the HMAC token secret in `src/shared.ts` is a fixed local spike value, not a credential.

```bash
pnpm install --frozen-lockfile        # own pnpm-workspace.yaml (security overrides, 2026-10-29): no --ignore-workspace
npx tsc -p .                    # NestJS needs decorator metadata: compile with tsc, run with node
pnpm infra:up                   # Postgres + Valkey, docker compose -p wayvro-spike-sp05, tmpfs
node dist/load.js 2000 100 2    # clients, committed updates/s, client worker processes
node dist/connect-rate.js 1000 3
pnpm infra:down
```
Results: `results/*.json` (file names state the configuration; failed and contended runs are kept, not hidden).
Disposal gate: delete, or rewrite into `tests/load` and `tests/chaos`, by the Phase 4 gate.
