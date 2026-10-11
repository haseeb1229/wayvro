# ADR-043 — Mobile platform additions for the ONE Wayvro app (P2.3 account slice, P2.8 capture)

| Field | Value |
|---|---|
| Status | **ACCEPTED on P2.3 and P2.8 build evidence** (physical-device behaviour NOT RUN, see below). **CAMERA allowlist entry APPROVED by founder/ChatGPT review (Phase-2 closure, 2026-10-11).** In force since Phase 2 review and merge (PR #4, merge commit `7da51b0`, 2026-10-11) |
| Date | 2026-10-11 |
| Supersedes | `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-043 (proposal; founder Q-13 approved Expo Router + TanStack Query) |
| Requirements | Q01 (token storage, capture cleanup), A02/A03/A05 (sign-in, sessions), A04/K09 (consent), A15 (age declaration UI), A11 (security activity), V13 (rider-facing restriction notice); P2.8: V01, V03, D01–D04 (UI), K02/K03 (capture), K05/K14 (explanations, appeals, corrections) |
| Evidence | `apps/wayvro-mobile/src/**` (P2.3: 18 test files, 124 tests; P2.8: 28 files, 211 tests); Android release AAB through `scripts/android-build.mjs release` (16 KB, ABI and permission gates); `docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md` §P2.3 and §P2.8 |

## Decision
All versions were chosen at install against the Expo SDK 57 `bundledNativeModules` floors. None is a beta or canary.

| Package | Version | Licence | Why |
|---|---|---|---|
| `expo-router` (+ `expo-linking` 57.0.12, `@expo/metro-runtime` 57.0.16, `expo-constants` 57.0.21, `react-native-screens` 4.26.2, `react-native-safe-area-context` 5.7.0) | 57.0.25 | MIT | file routes as thin wrappers over `src/features/*` |
| `@tanstack/react-query` | 5.103.3 | MIT | server-state cache, bounded retries, refetch on foreground |
| `expo-secure-store` | 57.0.4 | MIT | Q01: tokens + idempotency intents, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; never `requireAuthentication` |
| `expo-crypto` | 57.0.3 | MIT | installation id (128-bit) and idempotency keys from the platform CSPRNG |
| `@wayvro/contracts` (workspace) + `zod` 4.6.5 | — | — | every API response is validated against the contract schemas |

**Configuration decisions:**
- **Native code kept out (autolinking exclusion)** for `react-native-worklets`, `react-native-reanimated` and `react-native-gesture-handler`. These are peers of the drawer navigator that expo-router depends on; the app uses only the native stack.
  - **Measured:** none of their `.so` files or classes are in the release AAB.
  - **Static check of the release JS bundle:** no reanimated or gesture-handler module is bundled. The only worklets reference is `@expo/ui`'s optional `try { require('react-native-worklets') } catch {}`.
- **Two permissions added to `blockedPermissions`:** `USE_BIOMETRIC` and `USE_FINGERPRINT`, contributed by `androidx.biometric` via expo-secure-store. There is no biometric prompt; a biometric unlock would need its own decision.
- **The permission allowlist did not change:** the merged release manifest holds `INTERNET` plus the AndroidX dynamic-receiver permission only.
- **No URL scheme** until identifiers clear (docs/28 §15).
- **No API URL default:** a build without `WAYVRO_API_URL` shows "service not configured". Release builds require https. The emulator loopback is used only for `__DEV__` with `WAYVRO_DEV_LOCAL_API=1`.

## Measurements (2026-10-11, this machine)
- **Release AAB:** 31,683,900 bytes.
- **Download size** (bundletool `get-size total`):
  - arm64-v8a: 22,349,431–22,512,712 bytes;
  - armeabi-v7a: 21,610,570–21,773,851 bytes.
- **JS bundle:** 3,036,092 bytes.
- **Native libraries per ABI:** 14 → 18. The new ones are `librnscreens`, `libreact_codegen_rnscreens`, `libreact_codegen_safeareacontext` and `libandroidx.graphics.path`.
- **16 KB alignment:** PASS (18/18 64-bit libraries; `zipalign -P 16` on both split APKs).
- **ABIs:** exactly arm64-v8a + armeabi-v7a.
- **Comparison with Phase 1:** no Phase 1 release size was recorded, so no AAB delta is available. The debug APK grew from 102,354,278 to 121,235,376 bytes (debug builds are not a release measure).

## Not verified (stated, not hidden)
No emulator, AVD or physical device was available, so none of these has been checked on a device:
- release startup time and memory;
- Hermes behaviour of the zod 4 regexes and `Intl` formatting;
- runtime behaviour of the autolinking exclusion.

All are **NOT RUN** and must be checked on a representative low-end Android device before any release (CLAUDE.md §9).

## Supply-chain finding
expo-router 57.0.25 pins query-string 7.1.3 → decode-uri-component 0.2.2, which is affected by GHSA-vcc3-ghjq-m6fr (Medium, CPU-exhaustion DoS on malformed percent-encoding).
- The fixed 0.5.0 is ESM-only, and an override would break query-string 7.
- It is accepted as a time-boxed runtime exception in `osv-scanner.toml` (expires 2026-12-31), because no URL scheme or deep link exists, so no external input reaches the parser.
- **Gate:** before any deep link is wired, upgrade expo-router/query-string or bound URL length.

## P2.8 addendum — Driver/Partner capture (K02/K03/V03/Q01)
Versions re-checked at install (ADR-030): stable, MIT, not deprecated, published 2026-09-11 to 09-29.

| Package | Version | Why |
|---|---|---|
| `expo-camera` | 57.0.6 | in-app document photos and the one selfie for MANUAL review (front camera only; no liveness, no face matching) |
| `expo-image-picker` | 57.0.20 | controlled document import through the Android system Photo Picker (no media permission); never for the selfie |
| `expo-file-system` | 57.0.7 | already present transitively, now declared: one private cache folder for captures, the direct PUT to the signed URL, deletion after server confirmation |

New lockfile entries pulled in by these packages: barcode-detector 3.2.2, zxing-wasm 3.1.3, @types/emscripten 1.41.6, expo-image-loader 57.0.1, tagged-tag 1.0.0, type-fest 5.10.0 (MIT or MIT/CC0). A static check of the release JS bundle finds no zxing or barcode-detector code (web-only paths).

**Configuration decisions:**
- **Barcode scanning compiled out.** The prebuilt expo-camera AAR always links ML Kit barcode scanning and the Play services code scanner, so `barcodeScannerEnabled: false` alone had no effect (first release AAB: 40,158,411 bytes). `expo.autolinking.android.buildFromSource: ["expo-camera"]` compiles it from source so the flag applies; the final AAB has no ML Kit, barcode or code-scanner entries. Cost: a longer native build.
- **No microphone:** `microphonePermission: false`, `recordAudioAndroid: false`; RECORD_AUDIO stays blocked.
- **expo-image-picker keeps `cameraPermission` as a text, not `false`:** `false` makes the plugin block `android.permission.CAMERA` and delete the iOS usage string, which would break expo-camera. The picker's own camera launcher is never called.
- **Permission allowlist:** `android.permission.CAMERA` moved from forbidden to allowed with requirement IDs K02/K03/V03, requested just in time on the capture screen only. READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_VISUAL_USER_SELECTED and ACCESS_MEDIA_LOCATION are added to `blockedPermissions` and to the forbidden list. **Founder/ChatGPT approved this allowlist change in the Phase-2 closure (2026-10-11).** The approved release permission set is exactly `android.permission.INTERNET`, `${applicationId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` and `android.permission.CAMERA`; any further permission needs its own founder-approved change (CLAUDE.md §9).
- **Lazy loading:** every driver screen is a dynamic import; camera, picker and file-system code is imported only under `src/features/driver/` (enforced by the architecture test).

**P2.8 measurements (release build, this machine):** AAB 34,845,150 bytes (+3,161,250, +10.0% vs P2.3); download arm64-v8a 25,467,632–25,651,727 and armeabi-v7a 24,725,524–24,909,619 bytes (about +3.12 MB each); JS bundle 3,321,764 bytes (+285,672); 16 KB PASS (20/20 64-bit libraries, zipalign PASS on both splits); ABIs arm64-v8a + armeabi-v7a; permissions exactly CAMERA, INTERNET and the AndroidX dynamic-receiver permission.

**P2.8 not verified (NOT RUN):** no device or emulator: camera and permission prompts, the Photo Picker, the PUT upload, file deletion, lazy route loading at runtime, RTL, dynamic type and screen readers; no iOS build.

**Phase-2 closure emulator smoke (2026-10-11, API 35 x86_64 emulator, dev-client debug build):** PASS for one package, synthetic OTP sign-in against the local API, lazy Driver/Partner chunks, no CAMERA prompt before the capture screen, explicit prompt on it, usable denied path, Photo Picker without any media permission, return to rider mode and logout state wipe. Still NOT RUN: real capture/upload, file deletion, RTL, screen readers, dynamic type, physical low-end devices, iOS (`docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md` §"Phase-2 closure").

## Consequences / reversal
- Navigation can move back to plain React Navigation by replacing the thin route files; the feature screens do not import the router.
- If a later screen needs gestures or animation, the exclusion is removed in that change, with a size measurement.
