# PHASE0_ENGINEERING_GUARDRAILS — Exact CI, compatibility, migration, dead-code and release controls

**Date:** 2026-10-09 · **Status:** Phase 0 deliverable (plan-only; proposed tooling ADR-027). Validates root `CLAUDE.md` and `docs/27` against the proposed stack (RN/Expo, Next.js, NestJS+Fastify, Drizzle, PostGIS, Redis, pnpm/Turborepo). **No safeguard is weakened.** Proposed edits to `CLAUDE.md` are listed in §9 and are **not applied** (founder approval required; Phase 0 prompt deliverable 11).

## 1. Audit result: CLAUDE.md and docs/27 vs proposed stack

| Rule | Status against stack | Action |
|---|---|---|
| §4 clients never import server/db packages | enforceable with dependency-cruiser + eslint-plugin-boundaries + pnpm workspace `publishConfig`/`exports` | GR-01 |
| §4 typed, runtime-validated, versioned contracts | Zod in `packages/contracts`; OpenAPI generated; `oasdiff` breaking-change gate | GR-02 |
| §5 money never binary float | `Money` value object (bigint) + ESLint rule banning `number` in money types; property tests | GR-06 |
| §5 DB-enforced invariants | unique partial indexes, check constraints, triggers; concurrency tests with real Postgres in CI | GR-07 |
| §6 migrations from clean + previous schema | drizzle-kit SQL migrations, CI job applies to empty DB and to previous-tag snapshot; `expand→migrate→switch→contract` checklist in PR template | GR-04 |
| §7 no dead/fake code | Knip, dependency-cruiser cycles, `no-only-tests`, lint-disable budget, mock-reachability check | GR-03, GR-05 |
| §8 no fake green | tests cannot be skipped without a tracked gate; `NOT RUN` reporting template | GR-08 |
| §8 CI builds deployable artefacts | affected-app builds (Expo EAS/local AAB, Next.js, API image) | GR-09 |
| §9 mobile permission hygiene | manifest diff gate + cross-mode E2E | GR-10 |
| §12 dependency discipline | lockfile + Renovate with grouped PRs + OSV/Snyk + licence allowlist + SBOM | GR-11 |
| §14 Git discipline | protected branch, no force-push, required checks, CODEOWNERS = founder | GR-12 |
| §15 Docker safety | named project compose, no prune in scripts | GR-13 |
| §16 register-before-code | `phase0-coverage.js --check` + requirement-tag lint | GR-14 |
| Harness attribution reminder vs §14 "no AI co-author trailers" | **CLAUDE.md wins** (reminder states user instructions take precedence) | note in §9 |

No contradiction between CLAUDE.md and docs/27 found. One wording gap: CLAUDE.md §12 "approved dead-code tool after Phase 0" — this document names the tools (ADR-027).

## 2. CI pipeline (GitHub Actions; every PR + main; `turbo run --filter=...[origin/main]` for affected scopes)

| Stage | Tool(s) | Gate | Ref |
|---|---|---|---|
| 1. Format + strict typecheck | Prettier `--check`; `tsc --noEmit` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | fail on any error | GR-02 |
| 2. Lint + boundaries | ESLint (typescript-eslint strict), `eslint-plugin-boundaries` (feature/rider ↔ feature/driver isolation; client→server bans), `eslint-plugin-import` cycles, custom rules: no `any`/`@ts-ignore` without justification comment linking an issue; no `console.log` in apps; no float money | fail | GR-01, GR-06 |
| 3. Dead code / cycles / deps | Knip (unused files/exports/deps), dependency-cruiser (`no-circular`, layer rules), `pnpm dedupe --check`, `syncpack` version policy | fail on new findings (baseline file reviewed in PR) | GR-03 |
| 4. Secrets / SAST / SCA / licences | gitleaks, Semgrep CE (OWASP + custom rules: webhook signature required, idempotency key required on mutating routes), OSV-Scanner or Snyk Free, CycloneDX SBOM + licence allowlist (MIT/Apache/BSD/ISC/MPL; GPL/AGPL need ADR) | fail on high/critical; exceptions with expiry | GR-11, Q09/U03 |
| 5. Unit + property | Vitest; fast-check property tests for quotes, rounding, ledger balance, state machines, capacity | fail; coverage thresholds per package (no exclusions to pass) | GR-08 |
| 6. Contract compatibility | regenerate OpenAPI/event schemas → `git diff --exit-code` (generated drift) + `oasdiff breaking` vs main; consumer contract tests (mobile/web clients against API) | breaking change requires `contract-change` label + compatibility plan file | GR-02 |
| 7. Migrations | apply all migrations to empty Postgres+PostGIS; apply from last release-tag schema snapshot; `drizzle-kit check`; destructive-change detector (DROP/ALTER TYPE) requires `migration-contract` label referencing expand/migrate/switch plan | fail | GR-04 |
| 8. Integration | Docker services (Postgres 17/PostGIS 3.5, Redis 7, S3-compatible server, mail catcher) via `docker compose -p wayvro-ci`; API + worker + realtime; signed provider mocks only; concurrency suites (100 concurrent accepts, dual webhooks) | fail | GR-07 |
| 9. Build deployables | API/worker/realtime container images; Next.js builds; mobile: `expo prebuild` + Gradle release AAB on a Linux runner with **JDK 17 pinned** (machine-default JDKs are never used) and the NDK/AGP of the supported Expo SDK/RN/AGP combination; ABI set from the approved Q49 list (arm64-v8a required; armeabi-v7a while dependencies support it and device coverage justifies it); 16 KB alignment check (`bundletool`/zipalign) on every AAB; Android manifest permission diff vs allowlist (fails if `USE_FULL_SCREEN_INTENT` or `ACCESS_BACKGROUND_LOCATION` appear outside the approved list); iOS signed archive via EAS when credentials exist + Apple privacy manifest presence | fail | GR-09, GR-10, Q49 |
| 10. E2E | Playwright (web-public, web-ops); API journeys (rider→quote→dispatch→PIN→trip→cash settlement; cancel; no-driver); mobile Maestro flows on emulator for smoke + **cross-mode matrix** (rider booking, driver onboarding, go-online, offer accept, mode switch conflict) | fail; device-farm/real-device runs reported per release (not simulated as green) | V10 |
| 11. Accessibility + localisation | axe/Playwright a11y checks on web; RN accessibility lint; i18n key completeness (en/ur/roman-ur) | fail on new violations | Q29/Q30 |
| 12. Requirement traceability | `node docs/phase0/tools/phase0-coverage.js --check`; PR template requires requirement IDs; lint: new route/job/flag must reference a requirement ID in metadata | fail | GR-14 |
| 13. Release only | provenance attestation (`actions/attest-build-provenance`), SBOM upload, tag = SHA, changelog, feature-flag registry diff, kill-switch smoke | manual founder approval environment | GR-12 |

Runtime budget: PR pipeline ≤25 min via Turborepo remote cache (self-hosted cache on R2) and affected-only filtering; nightly full matrix incl. load (k6) and chaos (toxiproxy).

## 3. Dead-code and architecture hygiene (GR-03/GR-05)

- Knip config lists framework entry points (Expo router screens, Next.js app routes, Nest modules, BullMQ processors, migrations) so they are not falsely flagged; findings are a PR comment + fail on *new* items; deletions require attribution reasoning in the PR (CLAUDE.md §7).
- **Mock reachability check:** a Semgrep rule + startup assertion ensure `provider-interfaces` mocks are only bound when `WAYVRO_ENV in {local,test}`; production boot refuses mock adapters, deterministic OTP, bypass flags (I04).
- Feature flags live in `packages/config/flags.ts` registry with owner, purpose, default per env, enforcement side, expiry; CI fails on flags past expiry or referenced-but-unregistered (docs/27 §6).
- `TODO|FIXME|HACK` allowed only with `(#issue, owner, gate)` suffix; lint enforces.
- No `old/new/final-v2/tmp` paths; dependency-cruiser forbids `archive/`-style directories in apps.

## 4. Contract compatibility and N-1 mobile support (GR-02; Q15/Q31)

- Minimum-supported-app-version table per platform in `packages/config`; API returns `426`/soft-update advisory per A01; backend tests run against the **previous** released contract snapshot (stored under `tests/contract/snapshots/<version>`).
- Breaking change procedure: label → consumer inventory (mobile versions in the wild, web, workers) → compatibility window → rollout order (backend additive → mobile adopt → backend contract) → rollback note. CI blocks merge without the plan file.
- Events: schema registry in `packages/contracts/events`; consumers tolerate unknown fields; removal only after no consumer in `N-1`.

## 5. Database evolution (GR-04; CLAUDE.md §6)

- One migration per change with header: compatibility class, data impact, backfill plan (resumable, batched, observable), rollback/forward-fix, verification query.
- Destructive steps (drop column/table, enum value removal, type narrowing) only in a later release than the code that stopped depending on them; CI detector enforces label + plan.
- Hot-table changes benchmarked on a production-sized synthetic dataset (10k drivers/1M trips) before merge; `lock_timeout`/`statement_timeout` set in migration runner.
- Never wipe/reseed shared DBs; seeds are synthetic and idempotent (I02).

## 6. Release and rollback (GR-12; Q13/Q14/Q49)

- Backend: image per SHA, health gates, drain + rolling restart that protects active trips (in-flight transitions complete; realtime clients reconnect to snapshot), DB migrations expand-first; rollback = previous image + no contract step.
- Mobile artefacts (Q49): Play production = Android App Bundle meeting current 64-bit, target-SDK and 16 KB rules with AAB split delivery and an evidence-based ABI set; signed internal APKs only for controlled testers; iOS = signed production archive → TestFlight internal/external → App Store Connect production submission/release; provenance links every binary to a reviewed commit SHA; the public website never distributes unofficial production APKs.
- Mobile: staged rollout (Play %; TestFlight then App Store phased release), remote kill switches per risky capability and per mode (P16/V10), minimum version policy, crash/ANR/background-location/booking metrics segmented by version and mode; "halt rollout" runbook that accounts for drivers online.
- OTA (EAS Update): JS-only, signed, staged by channel; never used to change permissions/native modules.
- Web: atomic deploys with instant rollback (Cloudflare Pages/compose tags).

## 7. Testing strategy by layer (docs/10 made concrete)

| Layer | Tooling | Where |
|---|---|---|
| Unit/property | Vitest + fast-check | packages, api, worker |
| Contract | Zod schema tests, oasdiff, consumer-driven tests | tests/contract |
| Integration | Vitest + real Docker services; testcontainers-like compose | tests/integration |
| Concurrency/chaos | custom harness + autocannon/k6 + toxiproxy | tests/chaos |
| API E2E | Vitest/Playwright API journeys | tests/e2e/api |
| Web E2E | Playwright | tests/e2e/web |
| Mobile E2E | Maestro (primary; low-end device friendly) — Detox considered | tests/e2e/mobile |
| Load/soak | k6 (sockets, dispatch, location ingest) | tests/load |
| Migration | CI job (clean + previous) | infra/ci |
| Security | gitleaks, Semgrep, OSV, Trivy; ZAP baseline on web-ops nightly; adversarial auth/KYC suite (K13) | CI |
| Device matrix | real devices per Q27/Q32 recorded per release, never simulated | release checklist |

Report format per run: `PASSED / FAILED / SKIPPED(reason+gate) / NOT RUN / BLOCKED` with command and SHA (Q48).

## 8. Repository, Git and Docker discipline (GR-12/GR-13)

- Branches: `main` protected (required checks, linear history, no force-push, founder-only merge); work in `phase-N/<scope>` branches; squash merges with founder-authored commit identity; **no AI co-author trailers** (CLAUDE.md §14 overrides harness attribution reminders).
- `.gitignore` covers `.env*`, keystores, provisioning profiles, local DB dumps, device screenshots with PII; pre-commit: gitleaks + lint-staged.
- Docker: `docker compose -p wayvro` named project; scripts never call `prune`/`down -v` without explicit `--i-know` flag and founder instruction; volumes named `wayvro_*`.

## 9. Edits to `CLAUDE.md` — applied in the founder-review closure pass (2026-10-09)

Applied (non-duplicative only):
1. §7: names the approved dead-code/dependency-boundary tools (Knip, dependency-cruiser, eslint-plugin-boundaries per ADR-027).
2. §9: driver offers never depend on push or Android full-screen intent — realtime socket/poll inside the online foreground service is primary, push is a wake aid, server offer state is authoritative (M26/ADR-033); Android builds pin JDK 17.
3. §16: Phase 0 artefacts under `docs/phase0/` and the 531-ID register (schema 5.1) are the authority until superseded by founder-approved ADRs; `node docs/phase0/tools/phase0-coverage.js --check` and `node docs/phase0/tools/regen-manifest.js --check` must pass before claiming documentation consistency.

Not applied: the proposed §14 attribution sentence — the existing "No Claude/AI co-author trailers or tool branding" rule already covers it (founder instruction: no redundant wording).

## 10. Guardrail IDs referenced
GR-01 import boundaries · GR-02 contracts/typecheck · GR-03 dead code/cycles · GR-04 migrations · GR-05 flags/mocks · GR-06 money types · GR-07 DB invariants/concurrency · GR-08 no fake green · GR-09 deployable builds · GR-10 permission diff/cross-mode · GR-11 dependencies/licences · GR-12 Git/release · GR-13 Docker · GR-14 traceability.
