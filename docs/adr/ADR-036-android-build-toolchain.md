# ADR-036 — Android build toolchain (SP-AND)

| Field | Value |
|---|---|
| Status | **ACCEPTED on Phase 1 evidence — SP-AND PASS through the executed fallback** (primary pnpm layout FAILED on Windows) — pending founder/ChatGPT review |
| Date | 2026-10-09 |
| Supersedes | `docs/phase0/PHASE0_ADR_BACKLOG.md` ADR-036 row (FOUNDER-APPROVED, gated by this build smoke) |
| Requirements | Q49 (Play AAB, 64-bit/target SDK/16 KB, evidence-based ABI set), V01 (one public app), CLAUDE.md §9 (JDK 17, permissions), M26/ADR-033 (no full-screen intent) |
| Evidence | `tests/spikes/sp-and-android-build/` (spike app, `results/16kb-report.json`, `results/permissions-report-unconfigured-template.json`, `results/isolated-linker-failure-excerpt.txt`); `infra/ci/android/` gates; `scripts/android-build.mjs` |

## Question
Does the React Native + Expo development-build direction (FD-09) build reproducibly with **JDK 17** into a dev-client build and a **release Android App Bundle** that passes 16 KB page-size checks, with an ABI set chosen per Q49 and no unjustified permissions?

## Environment and versions (exact)
| Item | Version |
|---|---|
| Host | Windows 11 Pro 10.0.26300, i5-1145G7 4C/8T, 15.7 GB RAM; slow network (≈360 KB/s on large downloads) |
| JDK used by Gradle | **Temurin 17.0.20.1+1** (portable, SHA-256 verified); machine default JDK 25.0.3 (Android Studio JBR) was **not** used |
| Expo SDK / CLI | expo **57.0.27**, expo-dev-client 57.0.19, expo-status-bar 57.0.1, create-expo-app 5.0.0 (`blank-typescript@sdk-57`), expo-doctor 1.20.4 (21/21 checks) |
| React Native / React | **0.86.3** / 19.2.3 (New Architecture, Hermes) |
| Gradle / AGP / Kotlin | **Gradle 9.3.1** wrapper · **AGP 8.12.0** · Kotlin Gradle plugin **2.1.20** (from `gradlew buildEnvironment`) |
| NDK | **27.1.12297006** (selected by React Native's version catalog and auto-installed by Gradle; NDK 28.2 was already installed but not used) |
| SDK levels | compileSdk 36 · **targetSdk 36** · minSdk 24 (read from the release AAB manifest) · build-tools 36.0.0 |
| Gate tools | bundletool **1.18.3** (SHA-256 verified) · zipalign (build-tools 36.0.0) · `infra/ci/android/check-16kb.mjs` · `infra/ci/android/check-permissions.mjs` |

## Commands
```bash
npx create-expo-app@5.0.0 sp-and-android-build --template blank-typescript@sdk-57 --no-install
pnpm install && npx expo install expo-dev-client && npx expo-doctor
CI=1 npx expo prebuild --platform android --no-install
# JAVA_HOME=<Temurin 17>
./gradlew --no-daemon assembleDebug  -PreactNativeArchitectures=x86_64,arm64-v8a     # dev-client build
./gradlew --no-daemon bundleRelease  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a # release AAB
node infra/ci/android/check-16kb.mjs --aab <aab> --bundletool <jar> --expect-abis arm64-v8a,armeabi-v7a --zipalign <zipalign>
node infra/ci/android/check-permissions.mjs --aab <aab> --bundletool <jar>
```

## Results
| Step | Result | Detail |
|---|---|---|
| Install + expo-doctor | PASS | 21/21 checks, pnpm 12 |
| **Dev-client debug build, pnpm isolated layout (primary)** | **FAIL** | `ninja: error: manifest 'build.ninja' still dirty after 100 tries` in `:expo-modules-core:buildCMakeDebug[arm64-v8a]`; CMake warned the object directory under `node_modules/.pnpm/expo-modules-core@57.0.21_r_<hash>/…` was 232 characters against `CMAKE_OBJECT_PATH_MAX` 250. Windows path-length limit; `BUILD FAILED in 1h 41m 28s` (mostly first-time downloads). Excerpt committed |
| Fallback: reinstall with `nodeLinker: hoisted` | executed | flat `node_modules`, 19 s reinstall from the store |
| **Dev-client debug build (hoisted)** | **PASS** | `BUILD SUCCESSFUL in 2h 10m 42s` (machine shared with other heavy jobs); `app-debug.apk` 102.6 MB, ABIs arm64-v8a + x86_64, compile/target SDK 36 |
| **Release AAB (hoisted)** | **PASS** | `BUILD SUCCESSFUL in 37m 3s`; `app-release.aab` 21.3 MB; Gradle ran on JDK 17.0.20.1 |
| **ABI set (Q49)** | **PASS** | exactly `arm64-v8a, armeabi-v7a` |
| **16 KB page size** | **PASS** | 14/14 64-bit `.so` have every PT_LOAD `p_align ≥ 16384`; bundletool split APKs `base-arm64_v8a.apk` and `base-armeabi_v7a.apk` store all 14 libs uncompressed at 16 KB-aligned offsets; `zipalign -c -P 16 -v 4` PASS on both. 32-bit libs are 4 KB-aligned (6/14 at 16 KB) — informational, the Play rule applies to 64-bit ABIs |
| **Permission gate on the un-configured template (negative control)** | **FAIL as expected** | the template's *release* manifest declares SYSTEM_ALERT_WINDOW, READ/WRITE_EXTERNAL_STORAGE (forbidden) and VIBRATE (unlisted) besides INTERNET — proving the gate catches template defaults |
| Install/launch on a device or emulator | **NOT RUN** | no physical device attached and no emulator system image installed; real-device behaviour is the SP-01/SP-02 gate before Phase 3 (FD-13) |
| iOS | **NOT RUN** | no macOS/EAS/App Store environment approved in Phase 1; Android results say nothing about iOS |

## Reproduction in the monorepo app (`apps/wayvro-mobile`)
_Recorded after the monorepo build completes — see the section appended below._

## Decision
1. **Primary direction confirmed:** Expo SDK 57 development builds (RN 0.86) for the one public Wayvro app, built with **JDK 17 pinned** by `scripts/android-build.mjs` (refuses any other JDK major; never the machine default) and Temurin 17 in CI.
2. **Package layout fallback adopted:** the workspace uses pnpm `nodeLinker: hoisted` (ADR-034) because the isolated layout cannot build RN native code on the founder's Windows machine. This is the documented fallback for a blocked toolchain path, executed and evidenced — not a framework change; Flutter (ADR-003 fallback) is not triggered.
3. **Release artefact policy (Q49):** release AAB with ABIs **arm64-v8a + armeabi-v7a** (arm64-only only after device/market evidence), dev-client debug builds add x86_64 for emulators; NDK/AGP follow the Expo/RN combination (no hard-coded NDK release) — the gate is the 16 KB/ABI check on every AAB.
4. **Permissions:** the app blocks every default permission not justified by an approved feature (`app.config.ts` `blockedPermissions`), and CI fails any release AAB whose manifest contains a permission outside `infra/ci/android/permission-allowlist.json`. `USE_FULL_SCREEN_INTENT`, background location and location FGS are explicitly forbidden in Phase 1.
5. **Identifiers:** `dev.wayvro.app` (and the spike's `dev.wayvro.spike.spand`) are technical development identifiers, not registered or reserved store identities.

## Consequences
- First Android builds on a fresh machine are slow (Gradle, NDK and Maven downloads); CI caches Gradle.
- The release AAB is signed with the generated debug key — a build proof, never an upload artefact. Upload signing, Play App Signing and provenance attestation (Q49/Q10) are Phase 7 release work.
- Gates that remain open before Phase 3 freezes: SP-01 (background location, OEM behaviour, offer delivery) and SP-02 (rider cold start/size) on real devices.

## Reversal path
If Expo/RN cannot meet SP-01/SP-02, ADR-003's Flutter fallback is evaluated then. If Windows long-path support makes the isolated layout reliable, ADR-034 can switch back; the gates are layout-independent.
