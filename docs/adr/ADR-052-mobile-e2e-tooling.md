# ADR-052 — Mobile E2E tooling (Maestro on an emulator) and the E2E build variant

| Field | Value |
|---|---|
| Status | **PROPOSED — implemented in the Phase 3 macro run (P3.5 scaffold + PR tier; full matrix workflow); acceptance at the Phase 3 review** |
| Date | 2026-10-13 |
| Supersedes | `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-052 (proposal) |
| Requirements / decisions | V10 (scaffold + PR tier + manual full matrix), V08, V05, V11, Q26, U04, U05, A01, L08, K19; INV-07, INV-09, INV-14; CON-P3-13; FA-16 APPROVED 2026-10-12 (PR tier ≤ 15 min, full matrix manual only, no schedule); FA-07 (size budgets) |
| Evidence | `tests/e2e-mobile/**` (stack, seed, runner, manifest, flows); `scripts/android-build.mjs` (`e2e` mode); `apps/wayvro-mobile/{metro.config.cjs,build-tools/perf-eval-transformer.cjs,plugins/e2e-loopback-network.mjs,modules/wayvro-fully-drawn}`; `infra/ci/android/check-{release-purity,size,sdk-inventory,bundle-secrets}.mjs` (each with `--self-test`); `.github/workflows/ci.yml` job `Mobile E2E`; `.github/workflows/mobile-full.yml` |

## Context
One binary serves riders and Driver/Partners, so every release can break the other mode (SP-08). Vitest covers pure
logic only; nothing exercised the running app. Constraints verified in the repository: the release AAB ships
arm64-v8a + armeabi-v7a only (CI emulators are x86_64); release builds accept only https API origins; the dev-client
debug APK loads JS from Metro and is not release-like.

## Options
1. **Maestro** (YAML flows, black-box via the accessibility tree + adb; one external CLI in dev/CI only) — chosen.
2. Detox — grey-box, test instrumentation and a test APK inside the Gradle build, a Jest runner beside Vitest. Rejected.
3. Jest + React Native Testing Library — overlaps Vitest, proves components not the native runtime. Rejected.
4. Appium — heavier server stack, no advantage for one Android app. Rejected.

## Decision
1. **Tool.** Maestro CLI **2.11.0** (GitHub release `cli-2.11.0`, 2026-09-29, Apache-2.0; ≥ 14 days old at adoption),
   `maestro.zip` SHA-256 `5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a`, verified in CI. Telemetry
   off (`MAESTRO_CLI_NO_ANALYTICS=1`, `MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true`, `MAESTRO_DISABLE_UPDATE_CHECK=true`).
   Location `tests/e2e-mobile/` (sibling of `tests/e2e-web/`; the Phase 0 guardrail's `tests/e2e/mobile` is equivalent).
   Emulator in CI: `reactivecircus/android-emulator-runner` **v2.38.0** pinned to commit
   `a421e43855164a8197daf9d8d40fe71c6996bb0d` (Google APIs x86_64, cold boot `-no-snapshot`, animations off, KVM).
2. **Build under test (SP-08 §3.2 E1).** `node scripts/android-build.mjs e2e`: `assembleRelease` (release-mode JS —
   embedded minified Hermes bundle, no Metro, no dev launcher; the release plugins/permissions), ABI x86_64 (optional
   `--abis x86_64,arm64-v8a`), debug-key signed. The build sets `WAYVRO_E2E_API_PORT` (default 4120) and
   `WAYVRO_PERF_INSTRUMENT=1`: app.config.ts then adds the E2E-only `e2eLoopbackPort` key and the
   `plugins/e2e-loopback-network.mjs` network security config (cleartext denied everywhere, permitted for `10.0.2.2`
   only, system CAs only). `resolveApiConfig` maps that key ONLY to `http://10.0.2.2:<port>` and refuses it together
   with a configured origin. The script self-checks the APK (E2E markers present, Hermes magic, no dev-client scheme, no
   launcher implementation, ABI set). `release` mode refuses to run while either variable is set.
3. **Release purity (gated release AAB).** `check-release-purity.mjs`: no `usesCleartextTraffic="true"`, no
   `networkSecurityConfig`, no E2E resource (by path or resource-table name), embedded app config without
   `e2eLoopbackPort` / `devLocalApi: true` / non-https or loopback/LAN origin, Hermes bundle without the instrumentation
   probe, dex without the dev-launcher / dev-menu implementation. ART-ISO (`scripts/artifact-isolation.mjs` 03/03d) scans
   the server artefacts for the same markers.
4. **SP-02 instrumentation.** (a) Fully-drawn marker: no RN/Expo/react-native-screens API exposes
   `Activity.reportFullyDrawn()` (searched in `node_modules`), so a local Expo module `modules/wayvro-fully-drawn`
   (Kotlin, no third-party code) reports it once per process (process-wide `AtomicBoolean`) from `FullyDrawnMarker`,
   rendered on Rider home only while "Where to?" is enabled with account state resolved (PB-01) and on the sign-in
   screen (PB-02). It is release-safe (standard lifecycle signal) and ships in the release AAB. (b) Driver-module
   evaluation probe: `metro.config.cjs` wraps Expo's Babel transformer with `build-tools/perf-eval-transformer.cjs` ONLY
   when `WAYVRO_PERF_INSTRUMENT=1`; every `src/**` module logs `WayvroPerf eval n=<app> d=<driver> …`; the instrumented
   transformer changes Metro's cache key so release transforms never reuse instrumented output. The E2E APK is that
   instrumented build.
5. **Fixtures.** `mobile-stack.mjs` + `seed-accounts.mjs`: throwaway DB `wayvro_e2e_mobile`, migrations, synthetic
   catalog and synthetic rate cards (`seedSyntheticCatalog` with a 60 s quote TTL, the rate card CHECK minimum), accounts A–G + APPLICANT created through the PUBLIC OTP/consent/age
   endpoints with the code read from the local-runner-only `/__local/otp-inbox`; Driver/Partner states by SQL in the
   review service's shapes. Release-control changes (HARD policy, `rider.quotes` switch) are hooks with seeded staff as
   maker and approver. No new route, no fixture endpoint, no in-app bypass.
6. **Tiers (FA-16).** CI job `Mobile E2E` (short name; informational, NOT in ruleset 24837051 — founder action): PR — *2026-10-18 status: founder APPROVED making it required (with merge-only); the ruleset update is pending (session permission refusal), see `docs/phase3/PHASE3_IMPLEMENTATION_RECORD.md` Current status.*
   tier on API 35 only when mobile/contracts/API paths changed vs the merge base (otherwise `SKIPPED (no
   mobile-affecting change)`), Gradle cache restore-only, Maestro phase budget 900 s, JUnit + screenshots + retry videos
   uploaded for 7 days. `mobile-full.yml`: `workflow_dispatch` ONLY (no `schedule`), API 29 + API 35 + a 2 GB low-RAM
   lane in parallel, property tests at `WAYVRO_PROPERTY_RUNS=50000`, merged per-flow summary.
7. **Flake policy (SP-08 §6)** in `run-flows.mjs`: one retry; FLAKY never PASS; INV-07 flows never quarantined;
   BLOCKED with cause; NOT RUN with reason (pricing pending); `flows/quarantine.json` empty.
8. **Gates added to the Android job** (inside `scripts/android-build.mjs release`, plus `--self-test` negative controls
   as a step): SDK-INV (`infra/ci/android/sdk-inventory.json`, machine-readable companion of
   `docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md`), size (PB-04/PB-05, failing), release purity, BUNDLE-SECRETS.

## Consequences
- The E2E variant is one more Gradle build per mobile-affecting PR (time measured in the job summary) and never
  replaces the gated release AAB.
- Maestro pre-grants all runtime permissions by default; flows pass `permissions: all: deny` (= the never-asked state,
  verified with `dumpsys package` on API 35) so permission hygiene is observable.
- Quote flows run against the synthetic rate cards seeded by `seedSyntheticCatalog` (60 s TTL); they are NOT RUN with the
  reason if the seed produced no ACTIVE card. (Before the P3.3 merge they were NOT RUN — pricing pending.)
- Results are EMULATOR evidence only; SP-01/SP-02 device evidence is separate.

## Reversal
Flows are YAML black-box scripts and the app carries only `testID`s and the release-safe fully-drawn module; replacing
Maestro (Detox/Appium/device farm) needs no app change beyond removing the probe-free `testID`s if unwanted. The E2E
build mode, its plugin, the Metro wrapper and the gates can be deleted together; the release build is unaffected.

## Measured (2026-10-13, local Windows 11 laptop shared with two other build agents — EMULATOR evidence only)
- Release AAB (`node scripts/android-build.mjs release`, built from a short checkout path): every gate PASS — SDK-INV
  (36 dependencies/modules), 16 KB (64-bit 20/20), permissions, intent filters, size (arm64-v8a MAX 26,128,927 B ≤
  30,000,000; armeabi-v7a 25,386,841 B ≤ 29,000,000; +477,200 B vs the ADR-043 baseline), Hermes bundle 3,644,316 B ≤
  4,500,000, release purity, BUNDLE-SECRETS; AAB 35,389,422 B; 2,723 s wall time. The release dex links only the
  dev-launcher/dev-menu package stubs (`DevLauncherPackage`, `ExpoDevLauncherModule`, `DevMenuModule`), not the
  launcher/menu implementation.
- Fully-drawn module: standalone d8 dex 6,372 B (upper bound of the dex delta; no native library, one autolinking
  entry). A get-size comparison against a build without the module was NOT RUN.
- E2E APK (x86_64): 42,568,449 B; 2,701 s wall time; self-check PASS. On the emulator, `Fully drawn` fired once per
  process: signed-out sign-in screen after 62 app modules evaluated, signed-in Rider home after 67, **0 Driver/Partner
  modules** before the marker in both (PB-06 emulator proxy); driver modules were evaluated only after a Driver/Partner
  entry tap.
- PR tier, API 35 emulator (`tests/e2e-mobile/run-flows.mjs --tier pr`, 14 manifest rows): 9 PASS, 2 NOT RUN (pricing
  pending), 1 FLAKY + 1 FAIL caused by the emulator's adb transport going offline during `launchApp` while a Gradle
  build ran in parallel (both PASS on an immediate re-run), 1 FAIL that is a product finding (below). Maestro phase
  2,883 s — over the 900 s CI budget on this machine (≈ 130–390 s per flow incl. ≈ 40 s Maestro JVM start per flow).

## Findings for the owning slices (fixed at the merge into the Phase 3 branch)
- **HARD update block, signed in:** "Read legal policies" opens the `(session)` legal route, whose AccountGate reads
  `/v1/account/state` → 426, so the legal text is not reachable from the HARD block (SP-08 #21 expects it). The
  `pr-13` flow reported this as FAIL. **Fixed:** under a blocking policy, the session guard renders the escape screens
  (legal; deletion under HARD_UPDATE) without the gated account state (`rendersWithoutAccountState`, unit-tested); the
  server's 426/503 gate is unchanged. Emulator re-run NOT RUN.
- **Blocking screen layout:** the update/maintenance title is drawn under the status bar (no top safe-area inset);
  Maestro/TalkBack treat it as not visible to the user. **Fixed:** `Screen topInset` (the overlay has no navigation
  header, so it insets the status bar as well). Emulator re-run NOT RUN.

## Not verified
CI runtime of the `Mobile E2E` job and of `mobile-full.yml` (boot time, KVM availability on the repository's plan,
flake rate) — NOT RUN until the first CI runs; physical-device runs (SP-08 R/M tiers) NOT RUN.
