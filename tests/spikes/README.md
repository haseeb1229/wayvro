# Phase 1 early-entry spikes (disposable evidence harnesses)

These directories are **bounded evidence tasks, not product code** (`docs/phase0/PHASE0_ADR_BACKLOG.md` §E, FD-13). Each one is a standalone package with its own lockfile, deliberately **outside** the pnpm workspace, so its dependencies, synthetic schemas and shortcuts never leak into `apps/` or `packages/`. Lint, Knip and dependency-cruiser do not scan them; they are typechecked with `tsc --noEmit` inside each directory.

| Spike | Directory | Result | ADR | Disposal gate |
|---|---|---|---|---|
| SP-AND — Expo/Android dev build + release AAB, JDK 17, 16 KB, ABI, permissions | `sp-and-android-build/` | see ADR-036 | `docs/adr/ADR-036-android-build-toolchain.md` | delete once `apps/wayvro-mobile` CI reproduces the evidence (Phase 1 exit) |
| SP-03 — PostGIS candidate lookup + 100-way concurrent assignment + migrations | `sp-03-postgis-concurrency/` | correctness **PASS** | `docs/adr/ADR-004-query-layer-and-migrations.md` | delete or rewrite into `tests/integration` against the real dispatch schema by the Phase 4 gate |
| SP-05 — NestJS + Fastify API, Socket.IO gateway + Redis adapter, gateway loss, snapshot recovery | `sp-05-api-realtime/` | correctness/recovery **PASS**; 2k-herd latency target not met on the dev laptop | `docs/adr/ADR-005-api-framework.md`, `docs/adr/ADR-005b-realtime-transport.md` | delete or rewrite into `tests/load` + `tests/chaos` by the Phase 4 gate |
| ADR-010 evidence — local S3 server semantics | `adr-010-s3-local-eval/` | PASS (with SDK checksum setting) | `docs/adr/ADR-010-object-storage-local-s3.md` | delete when the storage adapter's own integration tests exist (Phase 2) |
| SP-01 (Phase 3) — real-device background location (candidate A: expo-location + expo-task-manager FGS), permission hygiene, socket/poll offer path without push; LAN receiver + §12 aggregator | `sp-01-background-location/` | harness built; device runs **NOT RUN** (needs FA-03 devices) | `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md` → future ADR-029/ADR-033 | delete once ADR-029 is decided and Phase 4 has its own presence/location implementation with device tests |

Rules: synthetic data only; local-only spike credentials (`spike-local-only`) that are not secrets; Docker projects are named `wayvro-spike-*` and use **tmpfs** storage, so `docker compose -p wayvro-spike-<id> down` leaves nothing behind; never prune.

Reproduce a spike: `cd tests/spikes/<dir> && pnpm install --frozen-lockfile` and follow the commands in the linked ADR. pnpm will look for a parent workspace; these directories are excluded from `pnpm-workspace.yaml`, so run pnpm with `--ignore-workspace` once the root workspace exists. Spikes that build React Native natively (SP-AND, SP-01) carry their own `pnpm-workspace.yaml` with `nodeLinker: hoisted`; `--ignore-workspace` makes pnpm ignore that file, so add `--node-linker=hoisted` (SP-01 README §4.1).

SP-01 additionally runs a receiver on the founder's private LAN with a `spike-local-only` run token and writes its raw rows **outside** the repository (the receiver refuses a path inside any Git repository); only reviewed aggregates are committed under `sp-01-background-location/results/`.
