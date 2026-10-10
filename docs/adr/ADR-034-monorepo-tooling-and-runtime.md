# ADR-034 — Monorepo tooling and runtime

| Field | Value |
|---|---|
| Status | **ACCEPTED on Phase 1 evidence** — pending founder/ChatGPT review |
| Date | 2026-10-09 |
| Supersedes | `docs/phase0/PHASE0_ADR_BACKLOG.md` ADR-034 row (PROPOSED) |
| Requirements | I03, Q10/U03 (lockfiles), R41 |

## Decision
| Concern | Choice (pinned) | Evidence / reason |
|---|---|---|
| Runtime | **Node 24.20.0 LTS** (`.node-version`, `engines: >=24.20.0 <25`) | installed on the dev machine; CI reads `.node-version` |
| Package manager | **pnpm 12.10.1** via Corepack (`packageManager` with sha512) | workspace + strict lockfile; pnpm 12 ships supply-chain defaults (below) |
| Task runner | **Turborepo 2.11.7** (`agentGuidance: false`) | `build/typecheck/test` graph with `^build`; turbo writes an `AGENTS.md` when it detects an AI agent — disabled so no tool file lands in the repo |
| Language | **TypeScript 6.0.3**, strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax` (`tsconfig.base.json`) | see TypeScript 7 note |
| Modules | ESM everywhere (`"type": "module"`, `NodeNext`); Next.js apps use `Bundler` resolution; Expo uses `expo/tsconfig.base` with the same strict flags | NestJS 12 is ESM-only (ADR-005) |
| Lint / format | ESLint 10.12 + typescript-eslint 8.71 `strictTypeChecked` + eslint-plugin-boundaries 7.2; Prettier 3.9.9 (planning docs excluded so the Phase 0 manifest does not churn) | ADR-027 |
| Internal packages | compiled to `dist/` with `tsc`, consumed through `exports` | Nest/Node run compiled JS; Next uses `transpilePackages`; Metro resolves `exports` |
| Linker | **`nodeLinker: hoisted`** (flat `node_modules`) | **SP-AND finding**, below |

**TypeScript 7 note.** TypeScript 7.0.2 (native compiler) was npm `latest` on 2026-10-09, but typescript-eslint 8.71.1 declares `typescript >=4.8.4 <6.1.0`, and Expo SDK 57 ships `typescript ~6.0.3`. The workspace therefore pins 6.0.3. Moving to 7 is a separate, later decision once the lint toolchain supports it (and decorator support is re-verified, ADR-005).

**Why hoisted (evidence).** With pnpm's default isolated layout, React Native native modules live under `node_modules/.pnpm/<name>@<version>_<peer-hash>/node_modules/<name>/`. On Windows, CMake embeds that absolute source path again in each object path; for `expo-modules-core` the object directory alone was 232 characters against CMake's `CMAKE_OBJECT_PATH_MAX` of 250, and the build failed with `ninja: error: manifest 'build.ninja' still dirty after 100 tries` (excerpt committed as evidence: `tests/spikes/sp-and-android-build/results/isolated-linker-failure-excerpt.txt`; full logs stay local). The same spike reinstalled with `nodeLinker: hoisted` built the debug APK and the release AAB successfully. Linux CI is not affected by the limit, but the founder builds on Windows, so the workspace is hoisted for everyone (one layout, one lockfile, no per-OS divergence).

**Cost of hoisting and mitigation.** A flat `node_modules` lets code import packages it never declared ("phantom dependencies"). This is closed by `knip` (unlisted-dependency detection) in CI — verified with a negative control: a probe in `packages/domain` importing an undeclared `ioredis` was reported as `Unlisted dependencies: ioredis`. dependency-cruiser additionally enforces client/server and app boundaries on the resolved graph.

**Supply-chain policy.** pnpm 12's default `minimumReleaseAge` (24 h) stays on with **no exclusions**: when a dependency was too new (drizzle-orm 0.45.4, @fastify/helmet 13.1.2, knip 6.41.0, setup-node v7.1.0, upload-artifact v7.0.2) the previous release was pinned instead. Install scripts run only for packages reviewed in `pnpm-workspace.yaml` `allowBuilds` (esbuild allowed; protobufjs denied). All versions are exact (syncpack-enforced). Security overrides are listed with their advisory IDs (handlebars 4.7.10).

## Alternatives considered
- **npm/yarn workspaces** — no stronger guarantees than pnpm; pnpm's store, lockfile and supply-chain defaults are better.
- **Nx** — heavier, plugin-driven; Turborepo's task graph is sufficient for this repository.
- **Biome instead of ESLint+Prettier** — fast, but no equivalent of eslint-plugin-boundaries or type-aware typescript-eslint rules (Phase 0 recommendation kept).
- **Keeping pnpm isolated and building Android only in WSL/Linux** — rejected: it would make the founder's own Windows machine unable to build the app locally; revisit if Windows long-path support (or a shorter `virtualStoreDir`) is proven to make CMake builds reliable.

## Consequences / reversal path
Switching back to the isolated linker is a one-line change in `pnpm-workspace.yaml` plus a reinstall; the gates that make hoisting safe (knip, dependency-cruiser) stay useful either way. Bumping any pinned tool is a reviewed change that must pass the full CI.
