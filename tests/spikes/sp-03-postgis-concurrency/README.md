# SP-03 — PostGIS candidate lookup, 100-way concurrent assignment, migrations (DISPOSABLE)

Evidence harness for `docs/adr/ADR-004-query-layer-and-migrations.md`. Synthetic data only; the tables here are **not** the Wayvro product schema.

```bash
pnpm install --frozen-lockfile --ignore-workspace
pnpm db:up                      # docker compose -p wayvro-spike-sp03, tmpfs, 127.0.0.1:55432
pnpm migrations                 # clean -> latest, previous -> latest, re-run; drizzle + Kysely migrators
pnpm bench -- 10000 2000        # candidate lookup: raw pg vs drizzle vs Kysely at concurrency 1/4/8/16
pnpm concurrency -- 20 100      # 8 strategies + negative control x 3 scenarios x 20 rounds x 100 attempts
pnpm typecheck
pnpm db:down
```
Results: `results/migrations.json`, `results/bench-10000.json`, `results/bench-50000.json`, `results/concurrency.json`, `results/concurrency-console.txt`.
Disposal gate: delete, or rewrite into `tests/integration` against the real dispatch schema, by the Phase 4 gate.
