# SP-AND — Expo/Android dev build + release AAB with JDK 17, 16 KB, ABI and permission gates (DISPOSABLE)

Evidence harness for `docs/adr/ADR-036-android-build-toolchain.md`. Generated from `create-expo-app@5.0.0 --template blank-typescript@sdk-57` (template licence 0BSD; the template icons in `assets/` are its unmodified placeholders), plus `expo-dev-client`, a technical spike identifier `dev.wayvro.spike.spand`, and **no** permission configuration on purpose (it is the negative control for the permission gate).

```bash
pnpm install --frozen-lockfile        # this directory is its own pnpm workspace with nodeLinker: hoisted (see pnpm-workspace.yaml)
CI=1 npx expo prebuild --platform android --no-install
cd android
# JAVA_HOME=<JDK 17>; ANDROID_HOME=<SDK>
./gradlew --no-daemon assembleDebug -PreactNativeArchitectures=x86_64,arm64-v8a
./gradlew --no-daemon bundleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
cd ../../../..
node infra/ci/android/check-16kb.mjs --aab tests/spikes/sp-and-android-build/android/app/build/outputs/bundle/release/app-release.aab --bundletool <bundletool.jar> --expect-abis arm64-v8a,armeabi-v7a --zipalign <zipalign>
node infra/ci/android/check-permissions.mjs --aab <same aab> --bundletool <bundletool.jar>   # expected to FAIL (template defaults)
```
Results: `results/16kb-report.json`, `results/permissions-report-unconfigured-template.json`, `results/isolated-linker-failure-excerpt.txt` (the primary pnpm layout's Windows failure). `android/`, `node_modules/` and `build-logs/` are generated and git-ignored.
Disposal gate: delete once `apps/wayvro-mobile` CI reproduces the evidence (Phase 1 exit).
