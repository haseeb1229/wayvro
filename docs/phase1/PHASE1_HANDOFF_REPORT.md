# PHASE 1 HANDOFF — Safe monorepo, reproducible local environment and architecture validation

**Date:** 2026-10-09 · **Branch:** `phase-1/foundation` (from Phase 0 baseline `41ff67d5b06f8d788dcd773141f75e274411678c`) · **Agent:** Claude Code (self-audit — not independent verification) · **Status:** delivered for founder/ChatGPT review; **not merged to `main`; Phase 2 not started.** Commit SHAs, push result and CI run URLs are reported in the chat handoff (a commit cannot contain its own SHA).

## 1. Scope delivered (and not delivered)
Delivered: the three Phase 1 entry spikes with evidence; pnpm/Turborepo workspace; packages `contracts`, `domain`, `config`, `observability`, `provider-interfaces`, `db`, plus `server-runtime` and `web-security` (shared runtime code that would otherwise be duplicated); skeletons `api`, `worker`, `realtime`, `wayvro-mobile` (the one public app), `web-public`, `web-ops`; Docker Compose infrastructure; GitHub Actions CI; ADRs and developer setup guide.

Not delivered by design (out of Phase 1 scope): any rider/driver/business feature, auth/OTP, KYC, maps, dispatch, pricing, payments, real provider integrations, store accounts, production deployment, SP-01/SP-02/SP-04. No real user, CNIC, biometric or payment data was used.

## 2. Spike verdicts
| Spike | Verdict | Key evidence | ADR |
|---|---|---|---|
| SP-03 PostGIS + concurrency | **Correctness PASS** — 8 strategies × 3 scenarios × 20 rounds × 100 simultaneous attempts: exactly one winner, 0 duplicates; negative control duplicated 20/20. Candidate lookup p95 3.3 ms (c=1) / 15–31 ms (c=4) at 10k drivers on a 2-vCPU-capped DB; CPU-bound above ~600–750 q/s. Migrations clean→latest, previous→latest, re-run PASS. drizzle-kit PostGIS DDL defects contained | `tests/spikes/sp-03-postgis-concurrency/results/` | ADR-004 |
| SP-05 API + realtime | **Correctness/recovery PASS; latency target partially met** — 2,000 sockets, gateway SIGKILL ×2, 0 client/DB mismatches in every run; kill→recovered p95 1.5–2.8 s for ≤1,000-client herds, 5.0–8.8 s for a 2,000-client single-survivor herd on the laptop (handshake CPU, not NestJS — attributed with plain Socket.IO and raw `ws`); one unexplained FAIL run kept | `tests/spikes/sp-05-api-realtime/results/` | ADR-005, ADR-005b |
| SP-AND Android | **PASS via executed fallback** — pnpm isolated layout FAILED (Windows CMake path limit); hoisted layout: dev-client APK and release AAB built with JDK 17; 16 KB PASS (14/14 64-bit libs, zipalign -P 16 PASS); ABIs arm64-v8a + armeabi-v7a; permission gate fails the unconfigured template as intended | `tests/spikes/sp-and-android-build/results/` | ADR-036, ADR-034 |

## 3. Decisions (ADR index: `docs/adr/README.md`)
NestJS 12 (ESM) on Fastify with explicit `@Inject` tokens · Socket.IO 4.8 in a separate realtime process + Redis adapter + mandatory snapshot recovery · Next.js 16.3.8 for both web shells — mature-line pin after founder review, with a no-automatic-framework-upgrade policy (ADR-030) · drizzle-orm + SQL-first reviewed migrations; CAS + partial unique indexes for assignment · Expo SDK 57 / RN 0.86 / JDK 17 / AGP 8.12 / Gradle 9.3.1 / NDK 27.1 · pnpm 12.10.1 hoisted + Turborepo 2.11.7 + TypeScript 6.0.3 + Node 24.20.0 · Valkey 9.1.2 and SeaweedFS 4.48 locally · ESLint+boundaries, dependency-cruiser, Knip, syncpack, gitleaks, osv-scanner in CI.

## 4. Requirement traceability (Phase 1 target IDs)
| ID | Status | Where |
|---|---|---|
| I01 environments | Implemented for config: `WAYVRO_ENV` local/test/staging/production; staging/production refuse local hosts, plaintext DB/Redis and debug logging | `packages/config` |
| I02 synthetic data only | Met: spikes and tests use generated data only | spikes, tests |
| I03 CI lint/types/unit/integration/e2e/secrets/SCA/migration dry-run | Met except browser/mobile E2E (boot smoke instead; Playwright/Maestro start in Phase 3) | `.github/workflows/ci.yml` |
| I04 config validation on boot | Met; least-privilege DB roles and per-env provider keys arrive with the first deployed environment (Phase 7) | `packages/config`, apps |
| I09 API schemas, quality gates, ADRs | Met for schemas/gates/ADRs; incident runbooks NOT in scope until operations phases | contracts, ADRs |
| Q04 TLS/headers | Security headers + CSP implemented and tested; TLS enforced by config rules for staging/production; no certificate pinning | api, realtime, web apps, config |
| Q07 secrets | No secrets exist or are needed; managed secret storage is an external/founder setup item | — |
| Q09 SAST/SCA/secret/container/IaC scans | SCA (osv-scanner) + secret scan (gitleaks) + exception expiry implemented; SAST (Semgrep), container and IaC scans deferred with gates (ADR-027) | CI |
| Q10 lockfiles/SBOM/provenance | Lockfiles exact; SBOM + provenance deferred to the first release artefact (Phase 7) | — |
| Q11 protected branch | **Founder action:** enable branch protection on `main` (required checks, no force-push) | GitHub settings |
| Q15 safe migrations | Migration header discipline (compatibility, data impact, rollback, verification) enforced by test; expand/contract demonstrated in SP-03 | `packages/db` |
| Q23 server time | Server timestamps (UTC ISO) in health/realtime contracts; no client clock trusted anywhere | contracts |
| Q48 phase report | This document + chat handoff | — |
| R41/R42/R44/R45 | Followed: branch only, no force/amend/rebase, no AI trailers; Docker scoped to `wayvro*` projects, no prune; synthetic data only | — |
| T06/T21/U03 | External/founder items or later phases (licence inventory/SBOM before release) | — |

## 5. Local verification (Windows 11 dev laptop, 2026-10-09; CI results are in the chat handoff)
| Check | Command | Result |
|---|---|---|
| Format | `pnpm format:check` | PASS |
| Lint (strict + boundaries) | `pnpm lint` | PASS (0 findings) |
| Strict typecheck | `pnpm typecheck` | PASS (21 tasks) |
| Boundaries + cycles | `pnpm depcruise` | PASS (no violations) |
| Dead code / unlisted deps | `pnpm knip` (default + `--production`) | PASS (one explained production-mode ignore, ADR-027) |
| Version policy | `pnpm syncpack` | PASS |
| Flag registry | `pnpm flags:check` | PASS (0 flags) |
| Unit + property tests | `pnpm test` | PASS — domain 39, observability 23, api 16, config 9, worker 9, contracts 7, provider-interfaces 7, realtime 6, server-runtime 4, web-security 4, db 2, wayvro-mobile 2 |
| Coverage thresholds (unit) | `pnpm test:coverage` | PASS — statements: domain 99.2 %, contracts 100 %, config 98.5 %, observability 98.2 %, provider-interfaces 93.8 %, web-security 100 %, worker 100 % |
| Integration (real PostGIS + Valkey) | `pnpm test:integration` | PASS — db 7, server-runtime 6, api 16, realtime 7 (incl. cross-gateway Redis fan-out); coverage db 95.2 %, server-runtime 97.4 %, api 98.3 %, realtime 100 % stmts |
| Migrations | `pnpm db:migrate` ×2; clean/previous/re-run tests | PASS (clean → latest; re-run applies 0) |
| Boot smoke | `node scripts/boot-smoke.mjs` | PASS 16/16 (all five server/web skeletons healthy; production config refused; realtime fail-closed; nonce CSP applied; identity of each port verified) |
| Local S3 semantics | `tests/spikes/adr-010-s3-local-eval` | PASS 11/11 |
| Android release AAB (monorepo app) | `pnpm --filter @wayvro/wayvro-mobile android:release` | PASS — 16 KB/ABI PASS, permission gate PASS (INTERNET + AndroidX internal only) |
| Android dev-client debug APK (monorepo app) | `… android:debug` | PASS |
| Secret scan | gitleaks 8.30.1 over all committed paths | PASS (one synthetic test value marked `gitleaks:allow`) |
| Vulnerable dependencies | osv-scanner 2.6.0 over all lockfiles | PASS after handlebars override; 4 documented tooling exceptions until 2027-01-09 |
| Phase 0 consistency | `phase0-coverage.js --check`, `regen-manifest.js --check` | PASS — 531 IDs consistent; manifest 78 files, 0 problems. Two Phase 0 tooling adjustments: the manifest scope is narrowed to the planning package (code/build output are protected by Git + CI; the separate-app path check still scans the whole repo), and `docs/phase0/tools/package.json` (`"type": "commonjs"`) keeps the CommonJS generators runnable under the workspace root `"type": "module"` (they failed with an ESM error before this fix) |

## 6. NOT RUN / BLOCKED / FAILED (exact)
- **iOS build: NOT RUN** — no approved macOS/EAS/App Store environment.
- **Android install/launch on a device or emulator: NOT RUN** — no device attached, no emulator image installed; real-device gates are SP-01/SP-02 (before Phase 3).
- **Web/mobile E2E (Playwright/Maestro): NOT RUN** — no real screens yet; boot smoke covers the shells.
- **SP-05 recovery latency for a 2,000-client herd onto one gateway: target NOT MET on this laptop** (5.0–8.8 s p95); one SP-05 run FAILED with an unexplained 25 s client-harness stall — kept as evidence (ADR-005b).
- **SP-AND primary path (pnpm isolated layout) FAILED on Windows** — fallback executed (ADR-036).
- **Deferred tools:** Semgrep SAST, CycloneDX SBOM/licence gate, oasdiff, Trivy, provenance attestation (ADR-027 gates).
- **Branch protection on `main`:** founder action in GitHub settings.

## 7. Known risks / debt
NestJS 12 is a six-week-old major; drizzle-kit pre-1.0 with PostGIS DDL defects (contained by SQL-first migrations); Socket.IO Redis adapter/emitter are low-churn packages; the realtime herd-latency capacity must be re-measured on staging hardware (Phase 4); four osv-scanner exceptions expire 2027-01-09; Expo debug builds carry `SYSTEM_ALERT_WINDOW` (debug only); the laptop is shared with other projects' containers, which affected some timings (documented per result); the worker outbox relay is a skeleton until the outbox table ships; the disposable spikes must be deleted or rewritten at their gates (`tests/spikes/README.md`).

## 8. Observations outside Wayvro (no action taken)
Other local projects' containers (`minhaj-*`, `new-laptop-*`) were found stopped at 15:00–15:02 UTC with exit 137/143, not OOM-killed, Docker daemon not restarted; no Wayvro command targeted them, and they were left untouched. Port 3000 is used by another local project's Next.js server, which is why the Wayvro web shells use 3210/3310.

## 9. Recommended next action
Founder/ChatGPT review of this branch and its CI run; decide on the ADR statuses; enable branch protection on `main`; then authorise either the Phase 1 merge or corrective work. Phase 2 is not started.
