# tools/load-harness — local load harness and FAULT-GEO soak (DEV-ONLY)

Implements the Phase-3 full-tier lanes "load harness" and "FAULT-GEO soak (randomised fault mix for 10 min)"
(`docs/phase3/PHASE3_TEST_STRATEGY.md` §4.7, §4.20, §5; E07/Q26). Node built-ins only (`fetch`, `perf_hooks`,
`crypto`), no dependency, no `package.json`: the scripts are root-level dev CLIs (Knip root entries) and never part of a
deployable artefact (ART-ISO scans release artefacts for `tools/load-harness` and the local-runner switches below).

**Every result is LOCAL, NON-STAGING.** It does not satisfy the staging-class budgets PB-20..PB-24
(`docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md`). The MOCK geo doubles' provider latency is a configured synthetic value,
not measured provider data (SP-04 is open).

## What each run does

Both CLIs start their own throwaway stack (`stack.mjs`, modelled on `tests/e2e-mobile/mobile-stack.mjs`): database
`wayvro_load_<name>` (dropped and recreated, dropped again at the end — never the shared `wayvro` database), migrations,
the synthetic catalog and rate cards (all-day service hours), the API local runner (`apps/api/dist-dev`, MOCK geo
doubles) on its own port, and synthetic rider accounts signed in through the public OTP endpoints. The runner's own
per-account / IP-prefix limits are raised **through env for this local stack only**; the values are listed in
`LOCAL_LIMITS` (`stack.mjs`) and recorded in every report. Valkey keys use a per-run prefix.

Local-runner switches (local runner only, `apps/api/dev/`):

| Variable | Effect |
|---|---|
| `WAYVRO_LOCAL_GEO_LATENCY_MS` | synthetic per-SKU latency of the MOCK doubles, e.g. `ROUTE=250,AUTOCOMPLETE=120` |
| `WAYVRO_LOCAL_GEO_CONTROL=1` | mounts `GET /__local/geo-control` (call counters) and `PUT/DELETE /__local/geo-control/fault` (soak only) |

## Prerequisites

`pnpm infra:up`, `pnpm build`, `pnpm build:local`. Ports: load 4131, soak 4132 (`--port`, or `WAYVRO_LOAD_API_PORT` /
`WAYVRO_SOAK_API_PORT`); 4120 is the mobile E2E stack.

## Load harness

```sh
pnpm load:local                                   # defaults: 200 requests per scenario and level, concurrency 1,4,16
pnpm load:local --requests 50 --concurrency 1,4   # shorter
```

Flags: `--requests`, `--concurrency`, `--accounts`, `--scenarios quote-miss,quote-hit,autocomplete,reverse,app-config`,
`--latency`, `--port`, `--name`. Per scenario and level: request count, concurrency, p50/p95/p99/max, req/s, error rate
and statuses (a 2xx body failing the contract schema counts as an error), cache-hit ratio observed from the response
metadata (`route.source.cacheStatus` / `source.cacheStatus`) and the injected latency. Exit code 1 on any error.

## FAULT-GEO soak

```sh
pnpm soak:fault-geo                               # 600 s, random seed (printed)
pnpm soak:fault-geo --duration 90 --seed 12345    # short, reproducible fault plan
```

Sequential by design (every MOCK provider call is attributable to one request). Per request a seeded PRNG picks the
scenario (quote / autocomplete / reverse) and a fault mode (FG-01..08 plus rejected input) applied through the control
route. Invariants I1–I7 and I5b are listed in the header of `soak.mjs` (no 500; only 2xx, documented 4xx or 503 with
the documented reason; priced quotes carry the provider's route, never an invented ETA/distance; no raw provider text
in responses or logs; provider calls per request ≤ the documented maximum; bounded latency). A built-in negative
control plants one violation per checker before the run. Exit code 1 on any violation. Soak-only stack env:
`GEO_BREAKER_OPEN_SECONDS=5` (its configured minimum) so more requests reach the faulted MOCK provider; timeouts,
deadline, retries and breaker trip thresholds stay at the API defaults. The report also tallies the gateway's breaker,
cool-down and timeout signals from the runner log.

## Output

`build-logs/load/` (git-ignored): `load-<stamp>.{json,md}`, `fault-geo-soak-<stamp>.{json,md}` and the runner log
`<stamp>-api.log`. Every report header carries `LOCAL NON-STAGING — does not satisfy staging/production budgets`.

## Full tier (manual workflow)

After `pnpm infra:up`, `pnpm build` and `pnpm build:local`:

```sh
pnpm load:local
pnpm soak:fault-geo --duration 600
```

Upload `build-logs/load/` as the run's artefact.
