# PROPOSED PHASE 1 PROMPT — Safe monorepo, reproducible local environment and architecture-validation entry (DO NOT EXECUTE)

**Status:** proposal produced in Phase 0 (deliverable 12), revised in the founder-review closure pass (2026-10-09). **Not authorised.** The founder forwards the closure handoff to ChatGPT, then issues a prompt based on this text. Claude must not start Phase 1 from this file on its own. Wayvro remains exactly Phase 0–12; the early-entry spikes below are bounded evidence tasks inside Phase 1, not a new macro phase.

---

# PHASE 1 — CLAUDE CODE — SAFE MONOREPO, LOCAL ENVIRONMENT AND ARCHITECTURE VALIDATION

## Authority and preconditions
1. Read root `CLAUDE.md`, `README.md`, `ALL_FILES_INDEX.md`, `docs/00`, `docs/06`, `docs/12`, `docs/27`, `docs/28`, and every file under `docs/phase0/` (closure handoff, gap report, architecture proposal, ADR backlog, role model, guardrails). The 531-ID register (schema 5.1) and `docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json` are the requirement authority.
2. Inspect repository state first (branch, HEAD, worktree, remotes, Git identity, CI). The Phase 0 baseline is committed on `main` of the private repository `haseeb1229/wayvro`. Work on a new branch `phase-1/<scope>` only after founder authorisation; no force-push, amend, rebase or history rewrite; founder identity only; no AI attribution trailers.
3. **Founder-approved direction** (FD-09, ADR-035): React Native + Expo **development builds** as the primary mobile direction (Flutter fallback if validation fails); modular monolith; PostgreSQL/PostGIS; Redis; transactional outbox; one public Wayvro app; separate worker and realtime runtime boundaries when justified.
4. **Still open — decided only by spikes in this phase:** HTTP framework (ADR-005, candidate NestJS + Fastify), query layer/locking (ADR-004, candidate Drizzle + raw SQL), realtime transport (ADR-005b, candidate Socket.IO). Do **not** couple business code or broad scaffolding to any candidate before its spike result is recorded in the ADR.
5. No paid provider accounts; no real user data; Docker Desktop must be running (named project `wayvro`; never prune); Android builds pin **JDK 17** (the machine also has JDK 25 — it must not be used for Gradle).

## Step 1 — Early-entry validation (must finish before Step 2 scaffolding grows)
Spikes live under `tests/spikes/<id>/`, are minimal, use synthetic data, and are deleted or rewritten under phase rules after their result is recorded. **A failed spike triggers the documented fallback; it is never forced green.**

| Spike | Goal | Pass criteria | Fallback |
|---|---|---|---|
| **SP-AND** Android build smoke | Expo dev build + release AAB build reproducibly with JDK 17 on the supported Expo SDK/RN/AGP/NDK combination | reproducible AAB; 16 KB alignment check passes; versions recorded in ADR-036; ABI set per Q49 (arm64-v8a + armeabi-v7a unless evidence justifies otherwise) | try the supported toolchain combination; escalate ADR-003 review if blocked |
| **SP-03** PostGIS + concurrent assignment | candidate query layer + locking under contention | exactly one assignment for 100 concurrent accepts; p95 candidate query <50 ms at 10k synthetic drivers; migration tooling works from clean + previous schema | Kysely + raw SQL; alternative locking (ADR-004) |
| **SP-05** API + realtime integration | candidate NestJS + Fastify with Socket.IO (Redis adapter) and snapshot recovery | 2k simulated sockets; gateway kill → no lost authoritative state; recovery <5 s p95; acceptable complexity | Fastify with explicit modules; raw WebSocket gateway (ADR-005/005b) |

Record each result (commands, versions, measurements, PASS/FAIL) in `docs/adr/` (ADR-004, ADR-005, ADR-005b, ADR-036) **before** Step 2 depends on it. SP-01 (background location/OEM reliability), SP-02 (rider cold start/size) and SP-04 (Lahore maps field test) are **not** Phase 1 exit criteria; they must complete before the Phase 3 mobile-architecture and map-provider freezes, using real devices acquired progressively (FD-13; emulator-only results cannot close real-device gates).

## Step 2 — Workspace bootstrap (after Step 1 results are recorded)
A. pnpm workspace + Turborepo; TypeScript strict base config; ESLint (typescript-eslint strict, eslint-plugin-boundaries, import cycles), Prettier; Knip; dependency-cruiser; syncpack; Node 24 LTS pinned; `.editorconfig`; `.gitignore` per guardrails §8; CODEOWNERS = founder.
B. Packages (skeletons only, no business features): `packages/contracts` (Zod + OpenAPI generation with one health contract), `packages/domain` (`Money` PKR minor-unit value object and `Phone` +92 E.164 normaliser with property tests — pure value objects allowed by docs/06), `packages/config` (typed env schema with boot validation; feature-flag registry with expiry check), `packages/observability` (OTel bootstrap, redaction list Q36, error-code shape), `packages/provider-interfaces` (interfaces + signed mocks bound only when `WAYVRO_ENV in {local,test}`, with a production-boot refusal test), `packages/db` (migration runner using the query layer chosen by SP-03; PostGIS extension migration only).
C. Apps (skeletons that build and boot, no product screens), each using the framework chosen by Step 1: `apps/api` (health/ready, request-id, idempotency-key middleware shape, OpenAPI export), `apps/worker` (queue bootstrap + outbox relay skeleton with idempotent consumer test), `apps/realtime` (gateway bootstrap with authenticated-connection test), `apps/wayvro-mobile` (Expo dev-build project; one app ID placeholder; feature-folder boundaries enforced by lint; shell screen only; **no permissions beyond INTERNET**; no `USE_FULL_SCREEN_INTENT`), `apps/web-public` and `apps/web-ops` (Next.js skeletons with CSP/security headers and a health page).
D. Local infrastructure: `infra/docker/compose.yml` (project `wayvro`; Postgres + PostGIS, Redis, an S3-compatible local server chosen under ADR-010 after licence/maintenance check, mail catcher); scripts never prune.
E. CI (GitHub Actions) implementing guardrails §2 stages 1–9 for the skeleton, including JDK 17-pinned Android release AAB build, 16 KB alignment check, manifest permission allowlist, and both Phase 0 consistency checks (`node docs/phase0/tools/phase0-coverage.js --check`, `node docs/phase0/tools/regen-manifest.js --check`).
F. Docs: ADR-027 (CI tooling), ADR-034 (monorepo tooling), ADR-036 (Android toolchain) and the spike-result ADRs; developer setup guide; PR template requiring requirement IDs and change class (docs/27 §1); `NOT RUN` reporting template.

## Explicitly out of scope
Any rider/driver product feature, auth/OTP implementation, KYC, dispatch logic beyond the SP-03 benchmark, trips, money flows, real provider integrations, store accounts, hosting purchases, SP-01/SP-02/SP-04 (scheduled before Phase 3 freezes), and any `CLAUDE.md` change.

## Gate (docs/12 Phase 1)
SP-AND, SP-03 and SP-05 results recorded with PASS or an executed documented fallback; clean-clone reproducibility in a second directory; security scans green with no unexplained exceptions; no secrets; skeleton tests pass; `pnpm dev:infra && pnpm dev` boots every app; Android dev build and release AAB build with JDK 17 and pass 16 KB checks (iOS reported **NOT RUN** without macOS/EAS credentials); no premature business features (Knip + reviewer check).

## Report
Per `CLAUDE.md` §17 and `prompts/PHASE_REPORT_HANDOFF_TO_CHATGPT.md`: files created, spike results with measurements, commands and exact outputs, tests PASSED/FAILED/SKIPPED/NOT RUN, dependency list with licences, Docker resources created, unverified assumptions, branch/SHA. Stop and wait for founder/ChatGPT review before merging to `main`.
