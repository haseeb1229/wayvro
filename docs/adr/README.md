# Architecture Decision Records

ADRs record decisions with evidence. Numbering follows `docs/phase0/PHASE0_ADR_BACKLOG.md`; that backlog remains the list of **open** decisions, and the files here record decisions taken since Phase 0. An ADR here supersedes the matching backlog row once the founder approves the phase that created it. Until then an ADR is **ACCEPTED on evidence — pending founder/ChatGPT review**.

Every ADR states: status, context, alternatives, evidence (commands, versions, measurements, environment), decision, consequences and reversal path. A failed spike is recorded as FAIL together with the fallback that was executed — history is never rewritten to make a first choice look successful.

## Phase 1 decisions (2026-10-09)

| ADR | Title | Status |
|---|---|---|
| [ADR-004](ADR-004-query-layer-and-migrations.md) | Query layer, migration tooling and assignment locking (SP-03) | ACCEPTED on evidence — SP-03 correctness PASS |
| [ADR-005](ADR-005-api-framework.md) | HTTP API framework (SP-05) | ACCEPTED on evidence |
| [ADR-005b](ADR-005b-realtime-transport.md) | Realtime transport and recovery model (SP-05) | ACCEPTED on evidence — recovery PASS; 2k-herd latency target not met on the dev laptop, re-test gate at Phase 4 |
| [ADR-010](ADR-010-object-storage-local-s3.md) | Local S3-compatible development server (production storage still PROPOSED) | ACCEPTED (local only) |
| [ADR-027](ADR-027-ci-quality-and-dead-code-tooling.md) | CI, dead-code, boundary and security tooling | ACCEPTED on evidence |
| [ADR-030](ADR-030-web-framework-and-version-maturity.md) | Web framework version line (Next.js 16.3.8) and framework-maturity policy | ACCEPTED — founder review correction 2026-10-10 |
| [ADR-034](ADR-034-monorepo-tooling-and-runtime.md) | Monorepo tooling and runtime | ACCEPTED on evidence |
| [ADR-036](ADR-036-android-build-toolchain.md) | Android build toolchain (SP-AND) | ACCEPTED on evidence — SP-AND PASS via the executed fallback (pnpm hoisted layout after an isolated-layout Windows FAIL) |
| [ADR-037](ADR-037-local-development-infrastructure.md) | Local development infrastructure (Docker Compose) | ACCEPTED |

Founder-locked decisions that are not repeated here: ADR-001 (name), ADR-026 (one public Wayvro app), ADR-035 (modular monolith baseline) — see the Phase 0 backlog.
