# ADR-045 — Production test-double isolation

| Field | Value |
|---|---|
| Status | **ACCEPTED on P2.1 evidence** — pending founder/ChatGPT review of micro-phase P2.1 (branch `phase-2/1-identity-session-core`) |
| Date | 2026-10-10 |
| Supersedes | `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-045 (proposal) |
| Requirements / findings | F-01 (`docs/phase2/PHASE2_PLAN.md` §7), T-30, ART-ISO, BOOT-NEG; CLAUDE.md §7 (no mock success path reachable in production) |
| Evidence | `scripts/artifact-isolation.mjs`, `scripts/build-release-artifact.mjs`, `scripts/boot-smoke.mjs`, `packages/server-runtime/src/artifact.ts` (+ tests), `packages/provider-interfaces/src/binding.test.ts`, `packages/provider-test-doubles/` |

## Context
Phase 1 shipped `RecordingOtpDelivery`, `InMemoryObjectStorage`, `RecordingPushNotification` and `defaultProviderBindings(env)` inside the production package `@wayvro/provider-interfaces`; the only barrier against binding them in production was the `WAYVRO_ENV` value. The founder decided that an environment name must not be the security boundary.

## Decision
1. **Physical separation.** Test doubles live only in the dev-only workspace package `@wayvro/provider-test-doubles` (declared exclusively as a `devDependency`). `@wayvro/provider-interfaces` keeps the ports, the brand and the binding guard; `defaultProviderBindings()` is deleted. Test infrastructure (throwaway databases, restricted logins, barriers, log capture) lives in the equally dev-only `@wayvro/test-support`.
2. **Production composition roots bind real adapters only.** `apps/{api,worker,realtime}/src/main.ts` never import a double; with no real adapter yet (EG-01/EG-05/Phase 4) every port is unbound and dependent features answer `503 WAYVRO_E_DEPENDENCY_UNAVAILABLE` (API OTP) or are not registered (worker `otp.deliver`).
3. **Local runner outside the build.** `apps/api/dev/main.local.ts` (+ `dev/otp-inbox.ts`) composes the same `composeApi()` with the doubles, delivers OTPs in-process to the recording sink and exposes `GET /__local/otp-inbox`. It is compiled by `tsconfig.dev.json` into `dist-dev/` (git-ignored); the app's `files` field ships `dist/` only, and the runner refuses any `WAYVRO_ENV` other than `local`/`test`.
4. **Deployable artefact = clean production install.** `scripts/build-release-artifact.mjs` deletes every workspace `dist/`, rebuilds through Turborepo with `--force`, runs `pnpm --filter @wayvro/<app> deploy --prod --frozen-lockfile <dir outside the repo>`, reduces every manifest (app and injected `@wayvro/*`) to runtime fields and writes an immutable `dist/build-info.json` release marker. **`pnpm deploy --prod` works with pnpm 12.10.1 and the hoisted linker** (verified on Windows and in CI); the documented fallback (`turbo prune` + frozen production install) was not needed.
5. **Release marker.** `enforceArtifactPolicy()` (all three roots): a release artefact refuses `WAYVRO_ENV=local|test`; `staging`/`production` refuse anything that is not a release artefact.
6. **Static guards.** dependency-cruiser `no-production-to-test-doubles`; ESLint `no-restricted-imports` for production `src/` of every app/package; Knip `--production --strict --include unlisted` (added to `pnpm knip`) reports a production import of a dev-only package as an unlisted dependency. Plain `knip --production` does **not** detect it — verified by a negative control, which is why the strict pass was added.
7. **Runtime defence in depth (kept).** `bindProviders()` still refuses branded doubles outside `local`/`test`.

## Evidence (2026-10-10, local Windows run; CI runs the same script as the last step of the `quality` job)
`node scripts/artifact-isolation.mjs --negative-controls` → **PASS 39/39** for api, worker and realtime:

| Check | Result |
|---|---|
| ART-ISO-01 dev-only packages absent (top level and `.pnpm` store) | PASS ×3 |
| ART-ISO-02 artefact = `dist/` + production `node_modules` only | PASS ×3 |
| ART-ISO-03 no double specifier/class/local-runner/local-route marker in ~9.7k–15.1k text files; brand key only in `provider-interfaces/dist/brand.js` | PASS ×3 (+03b ×3) |
| ART-ISO-04 `import()`/`require.resolve` of `@wayvro/provider-test-doubles`, `@wayvro/test-support`, `vitest` from inside the artefact → `ERR_MODULE_NOT_FOUND`/`MODULE_NOT_FOUND`; positive control (`@nestjs/core`, `pg`, `socket.io`) resolves | PASS ×12 |
| ART-ISO-05 release marker present and well-formed | PASS ×3 |
| ART-ISO-06 artefact boot with `WAYVRO_ENV=local` and `test` refused by the marker | PASS ×6 |
| ART-ISO-07 artefact boot with a production-like configuration refused (`no production key provider … EG-05`) — api, worker | PASS ×2 |
| ART-ISO-08 the artefact's own compiled API records exactly the 13 contract routes, no local/test route | PASS |
| NC1/NC2/NC3 dependency-cruiser, ESLint and Knip reject a production import of the doubles | PASS ×3 |

Boot smoke (`scripts/boot-smoke.mjs`) adds: development builds of api/worker/realtime refuse `WAYVRO_ENV=production`; the local runner refuses non-local environments; the **production root started in local mode binds no double** (`POST /v1/auth/otp-challenges` → 503, `/__local/otp-inbox` → 404).

**Defects the checks found (and fixed) during P2.1:** a stale compiled `mocks.js` left in `provider-interfaces/dist/` by an earlier build (tsc never deletes removed outputs — hence the clean, uncached artefact build); a doc comment naming the dev-only package compiled into production output; manifests listing dev-only packages under `devDependencies`.

## Consequences
- The artefact is the unit of deployment; Phase 7 container images are built from exactly this directory.
- The local runner is the only way to exercise OTP sign-in locally (recording sink); the sink is never evidence for EG-01.
- Artefact builds take ~1–3 min (clean forced build); CI runs them once per push.

## Alternatives considered
- Environment-name checks only (Phase 1 state) — rejected by founder decision.
- Dead-code elimination of mocks inside the same package — fragile; the package would still be installed and resolvable.
- `turbo prune` + `pnpm install --prod --frozen-lockfile` — kept as the fallback; not needed.

## Reversal path
None intended. If `pnpm deploy` regresses with a future pnpm, switch the builder to the prune-based fallback; the checks are independent of how the directory is produced.
