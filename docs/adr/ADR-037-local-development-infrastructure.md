# ADR-037 — Local development infrastructure (Docker Compose)

| Field | Value |
|---|---|
| Status | **ACCEPTED** (local development and CI only) — pending founder/ChatGPT review |
| Date | 2026-10-09 |
| Requirements | I01, I02, R42 (Docker/data safety), CLAUDE.md §15 |
| Files | `infra/docker/compose.yaml`, `infra/docker/seaweedfs/s3.json`, `scripts/infra.mjs`, `.env.example` |

## Decision
One Compose project with the fixed name **`wayvro`**:

| Service | Image (pinned by digest) | Port (127.0.0.1 only) | Volume |
|---|---|---|---|
| PostgreSQL 17.5 + PostGIS 3.5.2 | `postgis/postgis:17-3.5@sha256:01a6a70e…6f6` | 25432 | `wayvro_pg_data` |
| Redis-protocol cache/queue/fan-out | `valkey/valkey:9.1.2-alpine@sha256:48332870…d11` | 26379 | `wayvro_valkey_data` |
| S3-compatible object storage | `chrislusf/seaweedfs:4.48@sha256:4e61d15f…72d` (ADR-010) | 28333 | `wayvro_s3_data` |

- Ports are bound to localhost and chosen outside the 5432–5434 range already used by other local projects on this machine; each is overridable (`WAYVRO_PG_PORT`, `WAYVRO_REDIS_PORT`, `WAYVRO_S3_PORT`).
- Healthchecks gate `up --wait`; the Postgres check uses TCP because the image's init phase listens only on the unix socket (a socket check turns healthy too early — observed in SP-05).
- `scripts/infra.mjs` provides `up`, `down` (keeps data), `status`, and `reset --confirm-wayvro-reset`, which removes **only** the three named volumes and only after verifying each carries the `com.docker.compose.project=wayvro` label. No script calls `prune`, `system prune`, `volume prune` or touches other projects.
- Credentials in compose/`.env.example` are fixed, obviously local values (`wayvro-local-only`, `wayvro-local-secret-not-for-production`); staging/production configuration refuses local hosts and plaintext transport at boot (`packages/config`).

**Valkey instead of the `redis` image.** The Phase 0 plan named "Redis 7" as a technology class. Licence facts checked 2026-10-09 (Docker Hub / GitHub): Redis ≤7.2.4 BSD-3-Clause; 7.4–7.8 RSALv2/SSPLv1; 8.x RSALv2/SSPLv1/AGPLv3; **Valkey 9.1.2 BSD-3-Clause**, wire-compatible. Applications use the Redis protocol through `ioredis` and the Socket.IO Redis adapter (both verified against Valkey in SP-05 and the realtime fan-out integration test), so the server choice is swappable. The production engine (managed Redis, self-hosted Redis 8, or Valkey) remains part of ADR-028.

**Mail catcher: deferred, not justified yet.** No Phase 1 code sends e-mail; a running service with no consumer would be unused infrastructure. Mailpit (MIT) is the candidate when the first e-mail-sending feature (staff notifications, Phase 2) needs it.

## Evidence (this machine, 2026-10-09)
`pnpm infra:up` → all three healthy in ~22 s; `pnpm db:migrate` applies `0000_postgis`; `scripts/boot-smoke.mjs` 16/16 PASS against it; ADR-010 S3 harness 11/11 PASS against port 28333; integration suites (db, server-runtime, api, realtime) PASS against it.

## Consequences
- Local data lives in named volumes that survive `down`; `reset` is the only destructive path and is scoped to Wayvro.
- CI runs the same compose file, so local and CI integration environments match.
- Images are large (SeaweedFS ≈724 MB); first `up` on a slow link takes time.

## Reversal path
Each service is independent; swapping Valkey↔Redis or SeaweedFS↔RustFS is a compose change only.
