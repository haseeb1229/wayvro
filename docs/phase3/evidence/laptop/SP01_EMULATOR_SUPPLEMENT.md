# SP-01 emulator supplement — background location, permission hygiene and offer path on Android emulators

> **LOCAL_EMULATOR_SUPPLEMENTARY — DOES NOT CLOSE SP-01 / FA-03 (REAL_DEVICE_REQUIRED).** Every result below comes from
> Android emulators on one Windows laptop. An emulator result never closes SP-01 (protocol §2, backlog §E). SP-01, FA-03
> and the ADR-029 / ADR-003 / ADR-033 decisions stay open until the real-device protocol
> (`docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md`) has run on at least three OEM classes. Nothing here measures OEM
> battery policy (Samsung, Xiaomi, Transsion, Vivo), real GNSS or radio behaviour, real battery drain or heat, or OEM
> background-kill behaviour.

- **Date:** 2026-10-16 (laptop evidence sweep, section 2). **Branch:** `phase-3/maps-quotes-unified-ux`. The run started at
  HEAD `ef3cbd0`; the lead committed `364efc9` during the run (no spike or app-permission files changed in it). These
  are uncommitted working-tree changes; the lead commits them.
- **Requirement IDs exercised (supporting evidence only, none satisfied by this run):** V05, A07, U05 (protocol §1).
  Context: M26 / ADR-033 (offer path without push), INV-07.
- **Data:** synthetic only. The location feed is a generated circle (radius 150 m, one lap per 10 min) around an
  arbitrary round-number point, sent with `adb emu geo fix` at 1 Hz. It is not anyone's movement trail. The spike
  sends no coordinates anyway (protocol §5.2). The release-app checks used the synthetic E2E accounts of
  `tests/e2e-mobile/mobile-stack.mjs` on a throwaway database (`wayvro_e2e_sp01`).
- **Raw evidence** (git-ignored, never committed): `evidence-local/sp01/` — receiver aggregates (`agg/`), recovery
  analysis, logcat extracts with counts and codes only, Maestro output of the release-app flows, build logs, AVD/device
  facts. The receiver row files stay in the session scratch directory (the receiver refuses data paths inside a Git
  repository) and are deleted after review (protocol §15).

## 1. Host and emulator configuration

| Item | Value |
|---|---|
| Host | Windows 11 Pro, Intel Core i5-1145G7 (4 cores / 8 threads), 16 GB RAM, WHPX acceleration. The laptop was heavily loaded the whole time (another project's build and test servers, the lead's main-app Gradle build; 1.2–2.4 GB free RAM). Timing results are therefore pessimistic and noisy. |
| Emulator | Android Emulator 37.2.12.0, `-memory 2048 -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot`, one emulator at a time |
| JDK / build | Temurin 17.0.20.1 (`C:\Dev\tools\jdk-17.0.20.1+1`), Gradle `--no-daemon --max-workers=2`, `-Xmx2g` |
| Receiver | `pnpm receiver` bound to `127.0.0.1:8787` (gateway `:8788`, admin `:8789`). The emulator reaches the host loopback through the emulator alias **`10.0.2.2`** (the spike was signed in with `http://10.0.2.2:8787`). No LAN address and no firewall rule were needed. Note: through the emulator NAT the guest can also reach the host's loopback-only admin port; the admin still requires the run token. |
| Location feed | `adb emu geo fix` at 1 Hz from a host script (synthetic circle, see above); paused and resumed on purpose for the feed-interruption checks |

| AVD | System image | API | RAM (config / guest MemTotal) | ABI | `ro.config.low_ram` | Used for |
|---|---|---|---|---|---|---|
| `wayvro-sp01-api35` | `system-images;android-35;google_apis;x86_64` r9 (Google Play services 24.23.35) | 35 (Android 15) | 2048 MB / 2.47 GB | x86_64 | not set | all spike TCs, the 60-minute session, release-app rider flows |
| `wayvro-sp01-api29` | `system-images;android-29;google_apis;x86_64` r13 | 29 (Android 10) | 2048 MB | x86_64 | not set | quick high-value TCs |
| `wayvro-sp01-api35-lowram` | `system-images;android-35;google_apis;x86_64` r9 | 35 | 2048 MB | x86_64 | see §5 | quick high-value TCs |
| AOSP `default` image | `system-images;android-35;default;x86_64` | — | — | — | — | **NOT RUN**: the official SDK download failed three times with "Connection reset" |

Device profile: `pixel_6` with the screen reduced to 720 × 1600 @ 320 dpi and 2 vCPUs to save host resources.
Throwaway data only; no Google account was signed in.

## 2. Builds and deviations from the protocol

| Artefact | What | Deviation |
|---|---|---|
| Spike `dev.wayvro.spike.sp01` | release variant, R8-minified, debug-signed, Hermes, JDK 17, targetSdk 36 (verified on the AAB) | **ABI x86_64 only** (emulator ABI) instead of the protocol's arm64-v8a + armeabi-v7a. Built four times (r1–r4) because three harness defects were fixed during the run (§4); the final artefact is r4. |
| Release app | `evidence-local/apk/wayvro-e2e.apk` (CI-built SP-08 **E2E variant**, x86_64, Hermes embedded, cleartext only to `10.0.2.2:4120`) | Not the store release AAB: the protocol's TC-01 runtime part needs the FA-17 tunnel and the real release build (still **BLOCKED**). The E2E variant has the release permission set and runs the release JS paths. The CI `android-build` artefact (release AAB) had not arrived locally during the run, so its static manifest check is **NOT RUN** here (CI's permission gate covers it on every run). |

TC-21 gates on the final spike AAB (r4): spike permission policy **PASS**, `check-spike-manifest.mjs` artefact check
**PASS** (package, not debuggable, FGS type `location` only, no boot / package-replaced / FCM actions, no URL scheme),
16 KB check **PASS** (14/14 x86_64 libraries aligned, `zipalign -P 16` PASS — x86_64 only, so this does not replace the
arm64/armv7 device artefact check), targetSdk **36**. Merged spike permissions (9): ACCESS_BACKGROUND_LOCATION,
ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION, INTERNET,
POST_NOTIFICATIONS, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, `<pkg>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, plus
RECEIVE_BOOT_COMPLETED since the defect-1 fix (§4), 10 in total. No USE_FULL_SCREEN_INTENT.

Final spike artefact = **r3** (APK sha256 `3311fb27…1568`, AAB sha256 `308544b3…28e0`), built from the final source in
this change. An r4 build with an extra socket-reconnect change was made and then **withdrawn** (the change is reverted,
see §4 note); r4 was never installed.

## 3. Test-case results

Result values: **PASS (emulator)** = the protocol's pass rule held on the emulator — still not SP-01 evidence;
**FAIL**; **NOT RUN** (with reason); **NOT EMULATABLE** (an emulator cannot honestly produce the evidence);
**BLOCKED-EXTERNAL**. Times are receiver (server-clock) times from the spike aggregator unless noted. API 29 and the
low-RAM AVD were created but not used: the founder asked to finish quickly and another agent needed the emulator, so
every API 29 / low-RAM cell is **NOT RUN (time; founder asked to hurry)**.

| TC | What was run on the emulator | API 35 | API 29 / low-RAM |
|---|---|---|---|
| TC-01 Rider hygiene (release app) | Static: `aapt2 dump badging` + manifest of the E2E-variant APK — permissions exactly ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION, CAMERA, INTERNET, DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION; **no** ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE*, POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT. Runtime: 10 SP-08 Maestro flows (pr-01, pr-03, pr-04, pr-07, pr-09, n-04, n-05, n-06, n-07, n-24) with their `dumpsys package` / `appops` hygiene checks, then `dumpsys activity services dev.wayvro.app` = 0 service records, 0 foreground services, 0 log lines starting `LocationTaskService`, `requested permissions` = the five above | **PASS (emulator)** with one **FLAKY**: 9 PASS, n-24 (deny permanently) failed attempt 1 and passed attempt 2. Known item, not new: the merged manifest declares expo-location's non-exported `LocationTaskService` with `foregroundServiceType=location` (already recorded in `PHASE3_IMPLEMENTATION_RECORD.md`); it is never started and the app holds no FGS permission. The protocol wording "no location-type service" is therefore not literally met; this needs a decision before store upload, not an app change here | NOT RUN |
| TC-02 Go-online flow | Spike r1 (paths a–c; no location callback reached) and r2 (full grant): (a) deny → recovery "Location is not allowed…" + Open Settings (opens the app's settings page), no FGS; deny twice → `USER_FIXED`, third try shows **no** OS dialog, recovery screen again (deny permanently); (b) approximate → `PRECISE_LOCATION_REQUIRED`, no FGS; (c) precise + "Allow only while using" → background step → Settings page → "Allow only while using the app" → `BACKGROUND_PERMISSION_DENIED`, no FGS; (d) precise → settings "Allow all the time" → notifications prompt → online, FGS + notification "SP-01 spike: location on while online" (`FOREGROUND_SERVICE` flag). Notification denial is tolerated (FGS runs, no drawer entry). Steps for the full grant: 9 taps/keys | **PASS (emulator)** after the defect-1 fix. With r1 the full-grant path **FAILED**: crash on the first location callback (defect 1) | NOT RUN |
| TC-03 / TC-04 60-min screen-off | One API 35 session, standard 5 s profile, screen off, `dumpsys battery unplug`, synthetic feed, scheduled perturbations (§3.1). **Interrupted at ~53 min**: the host process that drove the emulator exited at ~18:39Z, during the Doze phase | **INTERRUPTED — partial (emulator)**: completeness 99.21 % (631/636) over the 53 min that ran; see §3.1. There is no OEM, DEFAULT/GUIDED or battery meaning on an emulator | NOT RUN |
| TC-05 Offers without push | Inside the session | 26 offers emitted, 24 live by socket (latency p50/p95 0 s / 0 s), 0 by poll, 0 from snapshot, **2 lost** (not acknowledged; both emitted while the socket was down during network/airplane loss and expired before reconnect) | NOT RUN |
| TC-06 Socket loss | r2: gateway restart 3 s × 5, network off (`svc wifi`/`svc data`) 120 s × 2, screen off | **FAIL (emulator, see note)**: after the first gateway restart the socket did **not** reconnect for the rest of the case (≥ 3.5 min); offers then came only by the 15 s poll (2 live, 1 polled, 1 lost). The first 120 s network loss hit `T_offline` → `TRACKING_LOST` (by design, protocol TC-13 note). Zero duplicates stored. Note: this process still held the socket leaked by defect 2 (§4), so the result is confounded. In the r3 session (§3.1) the socket reconnected 6 s after a gateway restart and 10–30 s after network return (reconnect + snapshot p50 10 s / p95 29.5 s, 3 samples) — above the 5 s target. Re-run needed | NOT RUN |
| TC-07 Swipe-away | — | **NOT RUN** (time) and **NOT EMULATABLE** for its purpose (OEM recents behaviour) | NOT RUN |
| TC-08 Process kill | r3 online, Home, screen off: `am kill` → wait 30 s → `am force-stop` → wait 150 s → open | **PASS (emulator)**: `am kill` did not kill the FGS process (same pid; recorded). After `force-stop`: server STALE 17.2 s, OFFLINE `TRACKING_LOST` 117.4 s (detection ≤ 60 s holds on STALE); no automatic restart in 150 s (no process); next open shows "You are offline… TRACKING_LOST" from the snapshot; 0 FGS; 0 duplicates stored | NOT RUN |
| TC-09 Reboot | r3 online → `adb reboot` → after boot wait ~3 min without opening the app (protocol: 5 min) → open | **PASS (emulator)**: after boot no spike process, 0 service records, no FGS notification; permissions kept; server STALE 19.4 s, OFFLINE `TRACKING_LOST` 119.4 s; open shows the server state and needs an explicit go-online. Once, the first open after boot showed the system "app isn't responding — Wait" dialog (slow cold-booted emulator) | NOT RUN |
| TC-10 Background start | — | **NOT RUN** (time) | NOT RUN |
| TC-11 Permission revoke | r3 online, screen off: `pm revoke … ACCESS_BACKGROUND_LOCATION` (revoke-all, while-in-use via Settings, and app-ops variants NOT RUN — time) | **FAIL (emulator) on "no FGS without permission"**: detection PASS — Android killed the process ("permissions revoked"), the restarted process reported `PERMISSION_REVOKED` and the server went OFFLINE 1.8 s after the revoke; the app showed the recovery notice with Settings link. But the restarted process held a **location FGS with its "location on while online" notification for ≥ 58 s while offline** (defect 3), and two headless restarts crashed first (defect 4) | NOT RUN |
| TC-12 Approximate / location off | r3 online, screen off: `cmd location set-location-enabled false` (the approximate downgrade, part a, NOT RUN — time) | **PASS (emulator) for part b**: client `PROVIDER_DISABLED` 19.1 s, server OFFLINE `PROVIDER_DISABLED` 20.0 s after (≤ 30 s), FGS stopped and notification gone, notice shown | NOT RUN |
| TC-13 Airplane mode | Inside the session: airplane on 92 s → off (the protocol's 2 min would exceed `T_offline` = 120 s and end the run by design) | **PASS (emulator) for the 92 s variant**: server STALE after 15.5 s, back ONLINE 10 s after airplane off, buffered points uploaded (first received 30 s after return), 0 buffer drops, 0 duplicates stored. 2 min and 10 min variants **NOT RUN** | NOT RUN |
| TC-14 Battery saver | Inside the session: `settings put global low_power 1` for 6 min | **Recorded (emulator)**: no degradation — 71 points in the 6 min window, longest fix gap 5.1 s. Not the protocol's 30-min run; OEM extra savers **NOT EMULATABLE** | NOT RUN |
| TC-15 Crash recovery | r3 online: `am crash` (native) → reopen; repeated once with 60 s observation. JS-crash button NOT RUN (time) | **FAIL (emulator)**: server STALE 17.5–20.0 s after; on reopen the app stopped the restored task (`STALE_FGS_STOPPED`) and showed "Tracking stopped — go online again" (correct), but Android had restarted `LocationTaskService` (sticky restart, `createdFromFg=false`, `restartCount=1`) and the **location FGS + notification stayed for ≥ 60 s** while the app was offline (defect 3). ≤ 1 FGS record; 0 duplicates stored | NOT RUN |
| TC-16 Rider switch | r2 online → Rider → "Go offline and switch" | **PASS (emulator)**: server OFFLINE `USER_OFFLINE` 0.77 s and FGS stopped 0.55 s after the confirmed request; FGS notification gone; 0 fixes after stop. A bound, non-foreground `LocationTaskService` record stays while the process lives (not started, not foreground) | NOT RUN |
| TC-17 Sign-out | r2 online → Sign out → confirm, then force-stop + reopen | **PASS (emulator)**: server OFFLINE `SIGNED_OUT` 0.40 s, FGS stopped 0.16 s; no uploads after; reopen starts on the sign-in screen with no FGS | NOT RUN |
| TC-18 Restriction | r2 online, screen off, `admin restrict` | **PASS (emulator)**: server OFFLINE `RESTRICTED` at once; FGS stop and `FORCED_OFFLINE_APPLIED` on the device with the presence push (client event 86 s after the command by device clock — see note); reason shown on open; go-online refused with `RESTRICTED`. Going online again right after `unrestrict` hit **defect 2** (r2) | NOT RUN |
| TC-19 Stale-FGS reconciliation | r2: network off → `force-offline` after 30 s → network on | **NOT RUN (invalid attempt)**: the run had already gone OFFLINE `TRACKING_LOST` during the preceding 120 s network loss, so the force-offline did not test reconciliation | NOT RUN |
| Activity recreation | r2 online: rotation (`user_rotation`), `cmd uimode night yes/no`, don't-keep-activities + Home + relaunch | **PASS (emulator)**: same process, still ONLINE, 1 FGS, 0 orphan stops. Rotation and uiMode do not recreate this portrait app (`configChanges`); don't-keep-activities does | NOT RUN |
| Doze / idle | Inside the session: `dumpsys deviceidle force-idle` (deep) | **Partial (emulator)**: fixes and uploads continued for the 4 min 20 s that ran (52 points, longest gap 5.1 s) before the interruption; `unforce` NOT RUN. Emulator Doze is not OEM Doze | NOT RUN |
| Feed interruption | Inside the session: synthetic feed paused 91 s | **Not measurable on this image**: the fused provider kept delivering fixes (19 points in 91 s, longest gap 5.1 s) without new GNSS input. A real loss of GNSS cannot be simulated this way | NOT RUN |
| Release-app permission leakage | TC-01 checks above + spike/app isolation (different package ids; release manifest unchanged) | **PASS (emulator)**: no background-location or FGS permission requested or granted in the release app | NOT RUN |
| TC-20 Play Integrity | — | **BLOCKED-EXTERNAL** (protocol) | — |
| TC-21 Compliance build check | r1–r4 spike AABs | **PASS** (x86_64 artefact only; device ABIs NOT RUN) | — |
| TC-22 Push wake | — | **NOT RUN** (FA-18 deferred) | — |

Note on device-clock event times (TC-18): client events carry the device clock, corrected by the median offset of the
run's clock samples (≈ +130 ms). The 86 s figure for the restricted run is far longer than the server-side offline
(0 s) and the in-app result observed live (FGS gone within the 30 s check); it reflects when the event batch was
flushed and the run's few clock samples, not a measured stop delay. Treat client-side stop times of short runs as
indicative only.

### 3.1 Interrupted long session (API 35, run `mvb9en5x`, build r3)

Window: 17:46:30Z → 18:39:30Z (**53 min of the planned 60**; the host process exited at ~18:39Z, during the Doze
phase). Expected points 636 at 5 s; clock offset +130 ms from 290 samples.

| Metric | Value |
|---|---|
| Completeness | **99.21 %** (631 / 636 unique `seq`) |
| Gaps > 10 s | **0**; longest gap 5.95 s |
| Delivery latency p50 / p95 | 5.3 s / 40.6 s (the tail is the buffered points of the network and airplane outages) |
| Buffer drops / duplicates received / duplicates stored / rejected after OFFLINE | 0 / 0 / 0 / 0 |
| App state of points | 621 background, 10 active; every point `fgsActive=true`; 0 mocked flags |
| Offers | 26 emitted, 24 live (socket), 0 poll, 0 snapshot, 2 lost |
| Presence | ONLINE the whole window except two STALE periods (network loss, airplane); never OFFLINE |
| Battery | not measurable (emulator battery stays 100 %) — R7 **NOT EMULATABLE** |

| Perturbation (offset from go-online) | Duration | Server detection | Recovery |
|---|---|---|---|
| Network off (`svc wifi`+`svc data`) at 10:49 | 88 s | STALE 16.1 s after | buffered points arrived 13.8 s after network on; ONLINE again 14 s after; socket back 30 s after |
| Feed paused at 16:47 | 91 s | none (fixes continued) | n/a — see "Feed interruption" |
| Gateway restart (3 s down) at 22:47 | 3 s | — | socket reconnected 6 s after the gateway came up; points never stopped |
| Airplane mode at 28:48 | 92 s | STALE 15.5 s after | ONLINE again 10 s after airplane off; socket back 10 s after; buffered points received 30 s after |
| Battery saver (`low_power 1`) at 34:50 | 6 min | — | no effect seen |
| Doze forced deep idle at 48:49 | (interrupted after 4 min 20 s) | — | points continued; `unforce` and the end-of-run evidence (`dumpsys deviceidle`, standby bucket, batterystats) **NOT RUN** |
| Process kill | not part of the session (it ends a run by design) | see TC-08 | see TC-08 |

Unplanned cold boot: the emulator was killed while the spike was ONLINE (the host process exit). After the next cold
boot, before opening the app: no spike process, 0 service records, no FGS notification; runtime permissions were kept
(fine, coarse, background, notifications granted). This is a power-loss-like observation, not TC-09.

## 4. Defects found in the spike harness

Fixed, with tests:

1. **Spike crashed on its first location callback (candidate A needs RECEIVE_BOOT_COMPLETED).** expo-task-manager
   57.0.21 delivers every location batch through a **persisted** JobScheduler job (`TaskManagerUtils.createJobInfo`,
   `setPersisted(true)`). JobScheduler refuses persisted jobs without RECEIVE_BOOT_COMPLETED
   (`IllegalArgumentException: Requested job cannot be persisted without holding RECEIVE_BOOT_COMPLETED`), and the
   spike blocked that permission. Result: FATAL exception on the first callback; Android then restarted the crashed
   `LocationTaskService` in a new process (sticky service), which re-registered location updates **without any user
   action** and crashed again. Fix: the spike declares RECEIVE_BOOT_COMPLETED (`app.json`, spike allowlist with
   justification) while the boot / package-replaced **actions** stay stripped and forbidden, so there is still no boot
   receiver. Test: `test/task-manager-permissions.test.ts` (negative control: fails against the previous `app.json`).
   **ADR-029 input:** candidate A cannot run without RECEIVE_BOOT_COMPLETED, which the Phase-3 permission model lists as
   "Phase 4 decision, only if the chosen SDK needs them" — it does. Persisted jobs also survive a reboot, which TC-09
   must check on devices.
2. **A stale snapshot stopped a freshly started run.** After TC-18 (`unrestrict`) a snapshot fetched before the
   receiver accepted the new go-online (still OFFLINE / RESTRICTED for the previous run) was applied to the new session:
   the client stopped tracking while the receiver had just marked the run ONLINE (STALE after 21 s, `TRACKING_LOST`
   after 2 min, 0 points), and a socket stayed connected for the finished run. Fix: `src/shared/snapshot-rule.ts` — a
   snapshot generated (server clock) before the receiver accepted this run's go-online is ignored; an in-progress
   go-online is not an FGS loss in `reconcile`; no socket is opened for a run that already ended. Test:
   `test/snapshot-rule.test.ts`.

Found and **NOT fixed** (open; they need a design decision or more device evidence, and the run had to stop):

3. **Orphan location FGS after a crash or permission-revoke kill (R4 / design decision 3).** When the process dies
   while online, Android schedules a restart of the started `LocationTaskService` (sticky service). The new process
   correctly stops the restored task (`STALE_FGS_STOPPED`) and shows "Tracking stopped", but the restarted service
   stays **foreground with the "location on while online" notification** (`isForeground=true`, type location,
   `createdFromFg=false`, `restartCount=1`) for at least 58–60 s while the app and the server say OFFLINE (TC-11, TC-15;
   `evidence-local/sp01/orphan-fgs-check.txt`). `stopLocationUpdatesAsync` does not stop a service instance that the OS
   restarted. A fix needs native-side handling (stop the restored service when the JS side has no session, or a
   `killServiceOnDestroy` / non-sticky decision) and is an ADR-029 / Phase-4 design input; it must be re-checked on
   devices. Until fixed, TC-11 and TC-15 cannot pass on any device.
4. **Headless start crashes in the R8-minified release build.** Every process start without an activity (the location
   broadcast and the persisted TaskJobService after a kill) crashed with `ClassNotFoundException:
   expo.modules.adapters.react.apploader.RNHeadlessAppLoader` → `NullPointerException` in `JobServiceEngine`
   (TC-11 run). R8 removed the class that the manifest meta-data `org.unimodules.core.AppLoader#react-native-headless`
   names. The README already allows a recorded rebuild without minification; the better fix is a ProGuard keep rule for
   the app loader (needs a config-plugin change and a rebuild, not done in this run). Phase-4 note: the one Wayvro app
   carries the same meta-data and will hit this as soon as it runs headless tasks under R8.

Withdrawn change (not a fix): after the confounded TC-06 run a tick-driven socket reconnect was added (r4), on the
theory that socket.io-client's timer-based backoff never runs in the background. The r3 session then showed the socket
reconnecting in the background (6–30 s), so the theory was not supported and the change was reverted before it was
tested. Background reconnect time stays an ADR-033 measurement for real devices.

No defect was found in the release app's permission hygiene (TC-01); the release permission model
(`infra/ci/android/permission-allowlist.json`, `apps/wayvro-mobile` app config) was not touched.

## 5. What this run could not do and what still needs real devices

Not done here: API 29 and low-RAM runs (AVDs exist, unused — time), TC-07, TC-10, valid TC-19, TC-11 revoke-all /
while-in-use / app-ops variants, TC-12 approximate downgrade, TC-15 JS crash, the 2 / 10 min airplane variants, a
complete 60-min run, Doze exit, fixes for defects 3 and 4, the AOSP image (download failed), the release AAB static check on the CI
artefact (not available locally), and `ro.config.low_ram` on the low-RAM AVD (never booted).

Requires real devices (FA-03), in every case:
- OEM background-kill and battery policy (Xiaomi HyperOS, Samsung One UI, Transsion XOS/HiOS, Vivo FuntouchOS), the
  DEFAULT / STD-EXEMPT / GUIDED configurations, autostart and recents-lock behaviour, swipe-away (TC-07) per OEM.
- Real GNSS / fused-location behaviour, indoor loss of fix, and real feed interruption (the emulator's fused provider
  keeps reporting).
- Real cellular and Wi-Fi radio behaviour, handover, and network loss timing (emulator networking is a host NAT).
- Battery drain (%/h, batterystats), thermal behaviour and performance on low-end hardware (R7).
- Real Doze / app standby / app freezer timing on OEM builds (forced idle on an emulator is not the same), TC-10 on OEM
  freezers.
- FGS notification UX on OEM skins (drawer, Task Manager on Android 13+, OEM "running in background" surfaces).
- arm64-v8a / armeabi-v7a artefacts and their 16 KB check; Play pre-launch report; Play Integrity (TC-20).
- The release AAB on devices via the FA-17 tunnel (TC-01 runtime part stays BLOCKED until then).

## 6. Changed files (this run)

- `tests/spikes/sp-01-background-location/app.json`, `spike-permission-allowlist.json`, `plugins/spike-manifest.mjs`,
  `check-spike-manifest.mjs`, `README.md` — defect 1 and documentation.
- `tests/spikes/sp-01-background-location/src/client/engine.ts`, `src/shared/snapshot-rule.ts` — defect 2.
- `tests/spikes/sp-01-background-location/test/task-manager-permissions.test.ts`, `test/snapshot-rule.test.ts` — tests.
- This file.

## 7. Correction re-run (2026-10-17)

> **LOCAL_EMULATOR_SUPPLEMENTARY — DOES NOT CLOSE SP-01 / FA-03 (REAL_DEVICE_REQUIRED).** This section re-runs the
> cases that defects 3 and 4 affected, on one API 35 emulator. It is not OEM or real-device evidence; nothing here
> changes the status of SP-01, ADR-029 or ADR-033.

- **Date:** 2026-10-17 (founder correction §6). **Branch:** `phase-3/maps-quotes-unified-ux`, HEAD `9647d80` at the start;
  the lead committed `6832ad4` (which contains the keep rule below) during the run. No spike code was changed in this
  re-run.
- **Emulator:** `emulator-5554`, AVD `wayvro-sp02-api35-2g` (the lead's SP-02 AVD, already booted and handed over;
  `system-images;android-35;google_apis;x86_64`, guest MemTotal 2.53 GB, `ro.config.low_ram` not set, 720 × 1600). This is
  not the §1 `wayvro-sp01-api35` AVD; it uses the same image family. The host was loaded by the lead's builds, so timings
  are noisy. API 29 and the low-RAM AVD: **NOT RUN** (one emulator, time).
- **Harness:** as in §1 — receiver on `127.0.0.1:8787` reached through `10.0.2.2`, a new spike-local-only run token,
  the synthetic 1 Hz circle feed, aggregator. Raw evidence (git-ignored): `evidence-local/fix/sp01/` (case logs, `agg/`).
  The logcat extracts and the receiver rows stayed in the session scratch directory. The rows file was deleted after
  aggregation (protocol §15).

### 7.1 Build r5 and the keep-rule evidence

| Item | Value |
|---|---|
| Build | r5, built by the lead (`evidence-local/fix/build-spike-r5.ps1`): `expo prebuild --clean` with `plugins/spike-proguard.mjs`, `assembleRelease`, R8 minify on, **x86_64 only**, JDK 17. Build log: `PREBUILD=0`, `KEEP-RULE: 1` (rule present once in the generated `android/app/proguard-rules.pro`), source manifest check PASS, `BUILD SUCCESSFUL`, `EXIT=0` |
| Artefact | `sp01-r5.apk`, sha256 `8860ca67…4fbebc8`. No AAB was built, so the TC-21 gates (16 KB, artefact manifest check, targetSdk) were **NOT RUN on r5**. The r3/r4 results in §2 still stand for the manifest; the keep rule changes only R8 |
| Keep rule | `-keep class expo.modules.adapters.react.apploader.RNHeadlessAppLoader { *; }` (`plugins/spike-proguard.mjs`, test `test/proguard-keep.test.ts`) |
| R8 mapping | `mapping-r5.txt` line 153297: `expo.modules.adapters.react.apploader.RNHeadlessAppLoader -> expo.modules.adapters.react.apploader.RNHeadlessAppLoader` (kept under its original name) |
| Dex check (independent of the mapping) | `dexdump` of r5 `classes.dex`: 13 references to `Lexpo/modules/adapters/react/apploader/RNHeadlessAppLoader;`. Negative control, the r3 APK (`3311fb27…1568`): **0**. The manifest meta-data `org.unimodules.core.AppLoader#react-native-headless` names that class in both builds |

### 7.2 Results on API 35 (build r5)

| Case | What was run | Result |
|---|---|---|
| **Headless start** (defect 4) | Four process starts without an activity: three after a background-location revoke (`Start proc … for broadcast {…/expo.modules.taskManager.TaskBroadcastReceiver}` 0.13–0.61 s after Android's "permissions revoked" kill, screen off) and one after a native crash with no reopen (`Start proc … for service {…/LocationTaskService}`, the sticky restart, 329 s after the crash). In each one the persisted job ran a headless JS task (`TaskService: Started headless task 1`) and the spike's orphan path ran and uploaded `ORPHAN_TASK_STOPPED` (`HEADLESS_OR_RESTORED`) to the receiver 2.2–5.0 s after the revoke | **PASS (emulator)** — defect 4 fixed. There were 0 `ClassNotFoundException` and 0 `RNHeadlessAppLoader` lines in any of the r5 case logcat captures. The only `FATAL EXCEPTION` lines are the `CrashedByAdbException: shell-induced crash` that `am crash` causes on purpose |
| **TC-06** Socket loss | Run `mvcfcri8`, screen off: `admin restart-gateway 3000` × 5 (45 s apart), then network off (`svc wifi` + `svc data`) for **90 s** × 2 (not 120 s, because `T_offline` = 120 s ends the run by design) | **FAIL (emulator) on the informational < 5 s target; no duplicates.** The socket came back after every gateway restart (no permanent loss as in the confounded r2 run). It reconnected 11–43 s after the gateway was up again (restart 1: 42.6 s; restart 2: not up before restart 3; restart 3: 11.4 s; 4: 25.9 s; 5: 30.8 s) and 19.3 s after the first network return. Aggregator reconnect + snapshot p50 / p95: **19.4 s / 34.0 s**, 6 samples, 1 unrecovered (the second network loss ended at OFFLINE `TRACKING_LOST` 113.4 s after net-off, 0.5 s before the socket reconnected 19.8 s after net-on; the client then stopped as designed). An unprompted `transport close` 36 s after the first reconnect left the socket down until the end of the second loss. While the socket was down the 15 s poll kept running in the background. Duplicates stored **0**, buffer drops 0, rejected after OFFLINE 0. Offers: 4 emitted, 1 live by socket (4.5 s), 1 by poll (10.6 s), **2 lost** (emitted during the socket-down periods). Server STALE after net-off: 21.8 s and 13.5 s. Completeness over the 10-min window: 89.2 % (107/120) |
| **TC-11** Background-location revoke | Three runs (`mvcied4t`, `mvciswpp`, `mvcj7ahp`), screen off: mark `revoke-bg` → `pm revoke … ACCESS_BACKGROUND_LOCATION` → open the app after 45 s → observe the FGS for 7 min | **Detection PASS, "no FGS without permission" FAIL (emulator) — defect 3 still open.** Android killed the process each time (`Killing …: permissions revoked`). The headless orphan path ran (above), server STALE after 18.4 / 16.4 / 13.1 s (≤ 30 s), server OFFLINE `PERMISSION_REVOKED` after 59.7 / 50.4 / 49.6 s, sent on the next open (`PERMISSION_REVOKED:ON_NEXT_OPEN`, which the pass rule allows). The recovery notice with the Settings link was shown. But a **location FGS with its notification stayed for ≥ 425 / ≥ 421 / ≥ 420 s** (§7.3) while the app held no background-location permission. 0 duplicates stored |
| **TC-15** Native crash | Five valid runs: `am crash` while online, then (a) reopen after 16 s and stay in the foreground (`mvcfuipl`, `mvcgj937`, `mvci3var`); (b) reopen, then Home (`mvchl43d`); (c) no reopen (`mvch4hf6`, the headless case above). A sixth run was **invalid** (the go-online UI step failed, so the crash happened while offline; not counted) | **FAIL (emulator) — defect 3 still open.** Server STALE after 19.1 / 24.2 / 16.0 / 20.4 / 19.3 s, OFFLINE `TRACKING_LOST` after 116–124 s. On reopen the app stopped the restored task (`STALE_FGS_STOPPED`) and showed "Tracking stopped — go online again" (correct). The location FGS and notification stayed for **≥ 602 / ≥ 314 / ≥ 307 s** (a), **≥ 606 s** (b) and **≥ 485 s** (c, present from the sticky restart at +329 s to the end). ≤ 1 FGS record; 0 duplicates stored. JS-crash button: NOT RUN |
| Long session | — | **NOT RUN (skipped).** A 30-min run could not finish reliably in the remaining emulator window, and the cases above came first. The §3.1 interrupted 53-min run is still the only long-session data |

### 7.3 The lingering location FGS (defect 3): root cause and measured durations

**Measured.** dumpsys `activity services` and `notification` were polled every 5–10 s from the host action. In **none of
the 8 valid samples** did Android remove the service or the notification. Each one was still `isForeground=true`,
type `0x00000008` (location), with the "location on while online" notification, when the observation window ended. The
case script then cleaned up with `am force-stop`, which removed it at once.

| Trigger | Samples | FGS + notification present at end of observation | Ended by |
|---|---|---|---|
| Native crash, reopen, app in foreground | 3 | ≥ 602 s, ≥ 314 s, ≥ 307 s | `force-stop` (cleanup) |
| Native crash, reopen, then Home | 1 | ≥ 606 s | `force-stop` |
| Native crash, no reopen (headless) | 1 | ≥ 485 s after the crash (≥ 156 s after the OS restart at +329 s) | `force-stop` |
| Background-location revoke (Android kills the process) | 3 | ≥ 425 s, ≥ 421 s, ≥ 420 s | `force-stop` |

So the "≥ 58–60 s" in §3 / §4 was only the length of the earlier observation window. Not one of the 8 samples showed
the OS removing the service later (no `Stopping service due to app idle` line in any capture). On this image the orphan
FGS lasts as long as the process does. It is **not delayed OS cleanup** and **not spike-app code**. It is the
`expo-location` 57.0.20 / `expo-task-manager` 57.0.21 service lifecycle together with Android's restart of crashed
started services.

**Mechanism** (source lines are from `tests/spikes/sp-01-background-location/node_modules`; the OS side is as observed
in logcat and dumpsys on this image, not checked against AOSP source):

1. `expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt:35-42` —
   `onStartCommand` only reads the extras and returns **`START_REDELIVER_INTENT`** (line 41). It never calls
   `startForeground` or `stopSelf` itself. When the process dies (crash, or the kill on a permission revoke), Android
   keeps the start request and schedules a restart (`Scheduling restart of crashed service …/LocationTaskService in
   125126–1794438 ms for start-requested`). The ServiceRecord keeps `isForeground=true` and its `foregroundNoti` while
   no process exists (dumpsys: `pid=none`, foreground flag set, no notification posted). When a new process attaches,
   Android starts the pending service in it at once. This happens whether the process starts for the activity, for the
   FLP location broadcast (`TaskBroadcastReceiver`), or for the delayed restart. Android then posts the location FGS
   notification again (`createdFromFg=false`, `restartCount=1`, `startRequested=true`, `stopIfKilled=true`,
   `lastStartId=1`), without any `startForeground` call from the app (no `Background started FGS` line for these
   restarts).
2. `expo-task-manager/android/src/main/java/expo/modules/taskManager/TaskService.java:83-91` (constructor →
   `restoreTasks()`, line 90), `:550-592` (`restoreTasks` → `internalRegisterTask`, line 574), `:454-479`
   (`consumer.didRegister(task)`, line 478). The new process restores the persisted location task.
   `TaskBroadcastReceiver.java:11-15` also builds a `TaskService` on every location broadcast, which is how the revoke
   case restarts the process.
3. `expo-location/…/taskConsumers/LocationTaskConsumer.kt:56-60` (`didRegister` → `maybeStartForegroundService`) and
   **`:181-184`**: `AppForegroundedSingleton.isForegrounded` is still false when the task is restored. This was so in
   every sample, including the activity launches, because the restore runs before `OnActivityEntersForeground`
   (`LocationModule.kt:373-374`). So the consumer logs `Foreground location task cannot be started while the app is in
   the background!` and returns. It never calls `bindService` (`:204-232`), so `mService` stays `null`.
4. The spike then stops the restored task correctly: `src/client/engine.ts` `init()` (`STALE_FGS_STOPPED`) or
   `onLocationTask` (`ORPHAN_TASK_STOPPED`) → `Location.stopLocationUpdatesAsync` → `LocationModule.kt:338-339` →
   `TaskService.java:122-142` (`didUnregister`, line 140) → `LocationTaskConsumer.kt:62-68` → **`:239-241`
   `stopForegroundService()` = `mService?.stop()`, a no-op while `mService == null`**.
   `LocationTaskService.stop()` (`LocationTaskService.kt:50-53`: `stopForeground(true)` + `stopSelf()`) is the only
   code in expo-location that ends the service (`grep stopSelf|stopForeground`), and it is never reached for the
   instance Android restarted. `onTaskRemoved` (`:55-60`) acts only with `killServiceOnDestroy` (false in the spike,
   design decision 9) and only on swipe-away, so it plays no part here.

The spike cannot fix this from JS: no public expo-location API reaches a service instance the consumer never bound to.
Re-registering the task to force a bind is racy (`didUnregister` can run before `onServiceConnected`, and
`onServiceConnected` then calls `startForeground`). It is also impossible after a revoke. No spike code was changed.

**Classification:** defect 3 = **third-party library lifecycle (candidate A) + Android sticky-service restart**, not a
spike-app defect and not delayed OS cleanup. Defect 4 = **fixed** by the keep rule (headless start PASS (emulator)).
TC-11 and TC-15 stay **FAIL (emulator)** on "no FGS without permission / ≤ 1 FGS while offline", and still need devices.
TC-06 is **FAIL (emulator)** on the informational reconnect target, with zero duplicates. None of this is SP-01
evidence.

**Phase-4 architecture implication (ADR-029 / ADR-033 input; no Phase-3 change):**
- Candidate A as shipped cannot meet "no FGS without permission" or "no orphan FGS after a crash". A Phase-4 driver
  location service needs native ownership of the FGS lifecycle. Options: a patched or owned service that stops itself in
  `onStartCommand` when there is no active user-started session (for example on a redelivered or restarted start with no
  bound consumer), or that returns `START_NOT_STICKY`; or a different SDK (candidate B, only after an FA-08 decision).
  Whichever is chosen, the restart path must not need JS. It must also check the location permission before the
  service can be foreground again, because Android restored a location-type FGS here **without** the background-location
  permission.
- Each candidate must be re-measured on the three OEM classes for: crash, permission revoke, `am kill`, swipe-away and
  reboot. The measure is the presence of the FGS and its notification over ≥ 10 min, not 60 s.
- The release app is not affected in Phase 3. As of `6832ad4` it has no `LocationTaskService` in its merged manifest and
  no FGS type. Whoever adds a driver FGS in Phase 4 inherits this finding, together with the R8 keep rule for the
  headless app loader (defect 4) if headless JS tasks are used.
- ADR-033: background socket reconnect stays slow (11–43 s; p95 34 s here) and a socket loss without a host action was
  seen. The offer path inside the FGS must keep a poll or snapshot fallback, and its lost-offer rate must be measured on
  devices (2 of 4 lost here, both while the socket was down).

**Emulator state after the run:** spike uninstalled, receiver and feed stopped, the emulator left running. Wi-Fi, data
and location were back on. Logcat buffer at 16 MB, `stay_on_while_plugged_in` = 15 (set by the screen helper). The
generated `tests/spikes/sp-01-background-location/android/` was deleted (git-ignored, regenerated by prebuild).
