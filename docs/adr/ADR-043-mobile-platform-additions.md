# ADR-043 — Mobile platform additions for the ONE Wayvro app (P2.3 account slice)

| Field | Value |
|---|---|
| Status | **ACCEPTED on P2.3 evidence** (P2.3 packages). The P2.8 capture packages are recorded when they are installed. Pending founder/ChatGPT review of the full Phase 2 branch |
| Date | 2026-10-11 |
| Supersedes | `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-043 (proposal; founder Q-13 approved Expo Router + TanStack Query) |
| Requirements | Q01 (token storage), A02/A03/A05 (sign-in, sessions), A04/K09 (consent), A15 (age declaration UI), A11 (security activity), V13 (rider-facing restriction notice) |
| Evidence | `apps/wayvro-mobile/src/**` (18 test files, 124 tests); Android release AAB through `scripts/android-build.mjs release` (16 KB, ABI and permission gates); `docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md` §P2.3 |

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

## Consequences / reversal
- Navigation can move back to plain React Navigation by replacing the thin route files; the feature screens do not import the router.
- If a later screen needs gestures or animation, the exclusion is removed in that change, with a size measurement.
