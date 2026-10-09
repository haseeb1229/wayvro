# ADR-027 — CI, dead-code, boundary and security tooling

| Field | Value |
|---|---|
| Status | **ACCEPTED on Phase 1 evidence** — pending founder/ChatGPT review |
| Date | 2026-10-09 |
| Supersedes | `docs/phase0/PHASE0_ADR_BACKLOG.md` ADR-027 row (PROPOSED); implements `docs/phase0/PHASE0_ENGINEERING_GUARDRAILS.md` §2 stages 1–9 for the skeleton |
| Requirements | I03, I09, Q09, Q10, Q11 (partly — branch protection is a GitHub setting the founder applies), Q48, R41, R45, U03 (partly) |

## Pipeline (`.github/workflows/ci.yml`, no secrets, actions pinned to commit SHAs)
| Job | Gates |
|---|---|
| **quality** | Prettier check · `turbo build` (all packages + api, worker, realtime, web-public, web-ops) · ESLint (typescript-eslint `strictTypeChecked`, eslint-plugin-boundaries) · `tsc` strict typecheck · dependency-cruiser · Knip (default **and** `--production`) · syncpack · feature-flag registry check · unit/property tests · coverage thresholds · OpenAPI generated-drift (`git diff --exit-code`) · Phase 0 consistency (`phase0-coverage.js --check`, `regen-manifest.js --check`) |
| **integration** | `docker compose -p wayvro` (PostGIS, Valkey, SeaweedFS) · migrations from clean then re-run must apply 0 · integration tests with coverage thresholds (db, server-runtime, api, realtime) · boot smoke of every deployable (`scripts/boot-smoke.mjs`) · ADR-010 S3 semantics harness |
| **security** | gitleaks 8.30.1 over full git history (checksum-verified binary) · osv-scanner 2.6.0 over every lockfile, exceptions only via `osv-scanner.toml` (reason + expiry) |
| **android** | Temurin JDK 17 · `scripts/android-build.mjs release` (prebuild → `bundleRelease` arm64-v8a + armeabi-v7a → 16 KB/ABI gate → permission allowlist gate) · `scripts/android-build.mjs debug` (dev-client APK) · artefacts (AAB + reports, 7 days) |
| iOS | **NOT RUN** in Phase 1 — no approved macOS/EAS/App Store environment; Android results do not imply iOS results |

## Tools and why
| Concern | Tool | Notes |
|---|---|---|
| Type-aware lint | typescript-eslint 8.71 `strictTypeChecked`, `no-explicit-any`, `ban-ts-comment` (description required), `no-console`, `no-warning-comments` (no TODO/FIXME/HACK), `reportUnusedDisableDirectives` | strictness is not relaxed per file except documented test/CLI allowances in `eslint.config.mjs` |
| Architecture boundaries | **eslint-plugin-boundaries 7.2** (`checkAllOrigins: true`) + **dependency-cruiser 18.5** | two independent layers: lint-time element/module policies and whole-graph rules (cycles, unresolvable, client→server workspace + npm, app→app, package→app, Rider↔Driver, production→test, production→devDependency) |
| Dead code | **Knip 6.39** | default mode (tests count) and production mode (only production entry points count) |
| Versions | **syncpack 15.3** | one version per dependency, exact pins, `workspace:*` for internal packages |
| Secrets | **gitleaks 8.30.1** | history scan in CI; local scans before every commit |
| Vulnerable deps | **osv-scanner 2.6.0** | all lockfiles incl. spike harnesses; Phase 0 named "OSV-Scanner or Snyk Free" — OSV chosen (no account) |

## Evidence the gates actually detect violations (negative controls, 2026-10-09)
- **Boundaries:** temporary probe in `apps/web-public` declaring and importing `@wayvro/db` and `pg` and importing `apps/web-ops` code → ESLint: 3 errors (module source `@wayvro/db`, module source `pg`, app→app); dependency-cruiser: `no-client-to-server-workspace`, `no-client-to-server-npm`, `no-app-to-app`; a probe in `packages/domain` importing `apps/api` → `no-package-to-app`. Two real configuration defects were found and fixed by these controls: boundaries ignored external modules until `checkAllOrigins` was enabled and classified `apps/<x>/node_modules/**` as app code until element patterns were narrowed to `{src,test}`; dependency-cruiser silently dropped workspace imports resolved into `dist/` until `dist` moved from `exclude` to `doNotFollow`.
- **Phantom dependencies (hoisted linker):** probe exported from `packages/domain` importing undeclared `ioredis` → Knip `Unlisted dependencies: ioredis`.
- **Permissions:** the un-configured Expo template release AAB → permission gate FAIL (SYSTEM_ALERT_WINDOW, READ/WRITE_EXTERNAL_STORAGE forbidden; VIBRATE unlisted). See ADR-036.
- **Concurrency:** SP-03 negative control produced duplicates in 20/20 rounds (ADR-004).

## Explained exceptions (all visible in config, none silent)
- `knip.jsonc`: worker `src/outbox/relay.ts` and `src/consumer/idempotent-consumer.ts` are ignored **in production mode only** — Phase 1 requires these skeletons, but their production caller needs the outbox table (first event-producing context). Removal gate: wire into `apps/worker/src/main.ts` then.
- Coverage: `src/main.ts` composition roots (api, worker, realtime) and `packages/db/src/bin/**` are excluded from coverage because they are process entry points; they are exercised by `scripts/boot-smoke.mjs` and the spawned-CLI integration test. Infrastructure-touching packages (db, server-runtime, api, realtime) measure coverage in the integration run, not with mocks.
- `osv-scanner.toml`: four dev/build-tooling advisories with no safe upgrade, each with reason and `ignoreUntil = 2027-01-09`.
- ESLint ignores `docs/**` (Phase 0 CommonJS generators validated by their own `--check`) and `tests/spikes/**` (disposable harnesses, typechecked in place).

## Deferred (NOT in Phase 1, with gate)
Semgrep custom rules (webhook signature, idempotency key on mutating routes) — when the first mutating route ships (Phase 2); CycloneDX SBOM + licence allowlist gate (U03) — before the first release artefact leaves CI (Phase 7); `oasdiff` breaking-change gate — needs a previous released contract (Phase 2); Trivy image/IaC scan — when container images/IaC exist (Phase 7); Maestro/Playwright E2E — with the first real screens (Phase 3); Turborepo remote cache — not needed at current CI duration. Branch protection on `main` (required checks, no force-push) must be enabled by the founder in GitHub settings (Q11) — not something CI can do.

## Reversal path
Each tool is isolated in its own config file and CI step; replacing one (e.g. Biome for Prettier) does not affect the others.
