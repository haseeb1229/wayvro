# Developer setup (clean machine → running stack)

Audience: anyone cloning `haseeb1229/wayvro` onto a new machine. Verified on Windows 11 (Git Bash + PowerShell) on 2026-10-09; the same commands work on Linux/macOS shells. Synthetic data only — never put real user data, CNICs, selfies, payment data or production credentials on a development machine (CLAUDE.md §11).

## 1. Install the toolchain (exact versions)
| Tool | Version | Notes |
|---|---|---|
| Git | any recent | `core.autocrlf` irrelevant: `.gitattributes` forces LF |
| Node.js | **24.20.0** (see `.node-version`) | Node 24 LTS; Corepack is bundled |
| pnpm | **12.10.1** via Corepack | `corepack enable pnpm` — the version comes from `package.json` `packageManager` |
| Docker Desktop | 29.x with Compose v2 | must be running for infra, integration tests and boot smoke |
| JDK | **Temurin 17** (Android builds only) | install side-by-side; do **not** change the machine default. Point `WAYVRO_JDK17_HOME` at it |
| Android SDK | platform 36, build-tools 36.0.0, cmdline-tools | `ANDROID_HOME` must point at it; Gradle installs the NDK (27.1.12297006) itself |
| bundletool | 1.18.3 (release gates only) | `BUNDLETOOL_JAR` = path to `bundletool-all-1.18.3.jar` (SHA-256 `a099cfa1…e29`) |

On Windows the JDK 17 used here was the Temurin 17.0.20.1 zip unpacked to `C:\Dev\tools\jdk-17.0.20.1+1` (SHA-256 verified from the Adoptium API).

## 2. Clone and install
```bash
git clone https://github.com/haseeb1229/wayvro.git
cd wayvro
corepack enable pnpm
pnpm install --frozen-lockfile
cp .env.example .env          # local, non-secret defaults; .env is git-ignored
```
`pnpm install` refuses packages younger than 24 h and runs install scripts only for reviewed packages (`pnpm-workspace.yaml`). Do not bypass either rule; pick an older release instead.

## 3. Start local infrastructure (Docker project `wayvro`)
```bash
pnpm infra:up        # PostGIS 127.0.0.1:25432, Valkey :26379, SeaweedFS S3 :28333 — waits until healthy
pnpm db:migrate      # applies packages/db/migrations: 0000 PostGIS, 0001 identity core (schemas, NOLOGIN roles, grants)
pnpm infra:status
pnpm infra:down      # stops containers, keeps data
pnpm infra:reset -- --confirm-wayvro-reset   # deletes ONLY wayvro_* volumes (synthetic data)
```
Never run `docker system prune` / `docker volume prune`; other projects' data may live in the same Docker Desktop.

## 4. Build, test, check
```bash
pnpm build                      # packages + api, worker, realtime, web-public, web-ops
pnpm build:local                # the API local runner (apps/api/dev -> dist-dev; never deployed, ADR-045)
pnpm check                      # format, lint, typecheck, boundaries, knip, syncpack, flags, unit tests, Phase 0 docs checks
set -a; . ./.env; set +a        # (bash) export DATABASE_URL/REDIS_URL/WAYVRO_LOCAL_KEY_SEED for the next commands
pnpm test:integration           # real PostGIS/Valkey as restricted DB roles; throwaway databases; coverage thresholds
node scripts/boot-smoke.mjs     # boots every deployable, BOOT-NEG refusals, end-to-end local sign-in
node scripts/artifact-isolation.mjs --negative-controls   # builds real release artefacts (clean, uncached) and proves
                                                          # no test double/local route can be in or resolve from them
```
Integration tests create and drop their own databases and LOGIN roles (members of `wayvro_api`, `wayvro_worker`, …); they never wipe the shared local `wayvro` database. The artefact check builds outside the repository (OS temp dir) and deletes/rebuilds the server packages' `dist/` without cache.

## 5. Run the services
```bash
pnpm --filter @wayvro/api start:local  # LOCAL RUNNER on :4000: binds the recording OTP sink, delivers in-process,
                                       # serves GET /__local/otp-inbox?phone=+92399…  (synthetic numbers only)
pnpm --filter @wayvro/api start        # production root (no test doubles): OTP requests answer 503 — no OTP vendor (EG-01)
pnpm --filter @wayvro/realtime start   # :4001 — accepts only live consumer sessions (handshake auth.token = access token)
pnpm --filter @wayvro/worker start     # health on :4002; runs audit sealing/verification, purge and key-rotation jobs
pnpm --filter @wayvro/web-public start  # http://127.0.0.1:3210
pnpm --filter @wayvro/web-ops start     # http://127.0.0.1:3310 — staff shell, NO auth: never deploy
```

Local keys: `WAYVRO_LOCAL_KEY_SEED` (in `.env.example`) derives synthetic field/lookup/MAC keys per key id; staging/production refuse it and have no key provider until KMS custody exists (EG-05), so they cannot boot by design. Rotations: set the key states in `WAYVRO_LOCAL_KEY_SPEC` (e.g. `contact.v1=DECRYPT_ONLY,contact.v2=ACTIVE,…`), then `pnpm --filter @wayvro/worker key-rotation start-field identity.account_phones.phone_envelope` (or `start-lookup`, `contract-lookup <id>`, `complete <id>`, `status`); the worker runs the resumable job.

## 6. Android (the one Wayvro app)
```bash
export WAYVRO_JDK17_HOME="C:\Dev\tools\jdk-17.0.20.1+1"   # any JDK 17; the script refuses other majors
export ANDROID_HOME="C:\Dev\AndroidSdk"
pnpm --filter @wayvro/wayvro-mobile android:debug         # dev-client APK (arm64-v8a + x86_64)
export BUNDLETOOL_JAR="C:\Dev\tools\bundletool\bundletool-all-1.18.3.jar"
pnpm --filter @wayvro/wayvro-mobile android:release       # release AAB + 16 KB/ABI + permission gates
pnpm --filter @wayvro/wayvro-mobile start                 # Metro for the dev client
```
The first Android build downloads Gradle, the NDK and Maven dependencies (≈2 h on a slow link; minutes when cached). The release AAB is signed with a generated debug key — it is a build proof, not an upload artefact. `android/` is generated (`expo prebuild`) and git-ignored. iOS builds need macOS/EAS credentials and are not set up in Phase 1.

## 7. Troubleshooting
- **`ninja: error: manifest 'build.ninja' still dirty`** on Windows: native paths too long — the workspace must use `nodeLinker: hoisted` (ADR-034); do not switch it back to isolated.
- **`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`**: a dependency was published < 24 h ago — pin the previous release.
- **`ConfigError: invalid configuration`** at boot: a required variable is missing or a staging/production setting points at local/plaintext infrastructure — this is the intended fail-fast behaviour.
- **`ArtifactPolicyError`**: a release artefact was started with `WAYVRO_ENV=local|test`, or a development build with `staging|production` (ADR-045) — intended.
- **`KeyProviderError: … requires WAYVRO_LOCAL_KEY_SEED`**: copy the value from `.env.example` into `.env`.
- **OTP requests answer 503 locally**: you started the production root (`start`) instead of the local runner (`start:local`), or Valkey is down (abuse controls fail closed).
- Postgres "connection terminated" right after `infra:up`: use `pnpm infra:up` (it waits for the TCP healthcheck) rather than raw `docker compose up -d`.
