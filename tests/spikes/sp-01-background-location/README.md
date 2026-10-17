# SP-01 — real-device background location, permission hygiene and offer path (DISPOSABLE harness, candidate A)

Specification: `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md` (the protocol). Status: **harness built, NOT RUN on any device** — nothing in this directory is a measurement yet. A LOCAL_EMULATOR_SUPPLEMENTARY run (2026-10-16, `docs/phase3/evidence/laptop/SP01_EMULATOR_SUPPLEMENT.md`) debugged the harness and fixed two defects (design decisions 3 and 11); two more are open there (an orphan location FGS after a crash or permission-revoke kill, and a headless-start crash in the R8 build). It does not close SP-01. Results go to `results/` (aggregates only) after review.

## 1. What this is — and what it is not (protocol §2)
- A **disposable test app** (`dev.wayvro.spike.sp01`, "Wayvro SP-01 spike (not for distribution)") plus a **LAN receiver** and an **aggregator**. It exists only to measure candidate A — `expo-location` 57.0.20 `startLocationUpdatesAsync` + `expo-task-manager` 57.0.21 with a location foreground service (FGS), and a Socket.IO/poll offer path **without push** — on real Pakistani Android devices.
- It is **not** a shipped feature, not a second Wayvro app, never uploaded to any store and never distributed. Nothing here enters `apps/wayvro-mobile`; the release permission allowlist (`infra/ci/android/permission-allowlist.json`) is **not** widened. TC-01 (rider hygiene) uses the real release app, not this spike.
- Not a load test, not an iOS gate, not KYC capture, not cold start (SP-02). An emulator run may debug the harness; **an emulator result never closes SP-01**.
- Candidate B (Transistorsoft) and the Flutter fallback are **not** built (protocol §4/§14: only after A fails and a founder FA-08 decision).

Toolchain parity with the app (ADR-036): Expo SDK 57.0.27, React Native 0.86.3, New Architecture, Hermes, JDK 17, hoisted `node_modules`, release variant (non-debuggable, R8-minified per protocol §4), ABIs arm64-v8a + armeabi-v7a, targetSdk from the Expo SDK 57 defaults (verify 36 on the artefact, §4.3). No push library, no FCM configuration, `USE_FULL_SCREEN_INTENT` blocked, no boot receiver (but `RECEIVE_BOOT_COMPLETED` is declared — design decision 3).

## 2. Layout
| Path | What |
|---|---|
| `index.ts`, `App.tsx` | entry (defines the location task first) and the plain spike UI: rationale (prominent-disclosure draft), fine → background permission steps, Go online/offline, Rider/Driver toggle, Sign out, battery-optimisation button, status panel, TC-10/TC-15 debug controls |
| `src/client/engine.ts` | runtime: go-online/offline, location task handler, buffer + uploads, socket/poll/snapshot offer path, stop rules, restart reconciliation |
| `src/client/geo-delta.ts` | the **only** file that reads latitude/longitude (on-device distance; nothing leaves it but metres) |
| `src/client/{permissions,api,storage,log,copy,location-task}.ts` | permission steps, receiver HTTP client, minimal persisted state, counts-only log, all UI copy, `TaskManager.defineTask` |
| `src/shared/*.ts` | wire vocabulary, privacy payload builder/serialiser/strict parser, 720-point ring buffer, backoff, idempotent seq store, presence state machine, statistics |
| `receiver/server.ts`, `admin.ts`, `aggregate.ts` | LAN receiver, loopback admin CLI, §12 aggregator CLI (`core.ts`, `aggregate-core.ts`, `rows.ts`, `paths.ts` hold the logic) |
| `test/*.test.ts` | `node:test` unit tests (aggregator maths, seq store, buffer, backoff, stale/offline machine, receiver core, privacy rule, receiver safety rails) |
| `app.json`, `plugins/spike-manifest.mjs` | Expo config; spike-only manifest plugin (no boot/package-replaced receiver actions, no URL scheme, LAN cleartext) |
| `spike-permission-allowlist.json`, `check-spike-manifest.mjs` | spike-only permission policy + TC-21 artefact check |
| `capture-sheet-header.csv` | protocol §11 capture-sheet header |

## 3. Design decisions and deviations (record them in ADR-029/ADR-033 when the evidence is written up)
1. **Privacy by design (§5.2).** Uploads carry exactly `runId, seq, fixTimeMs, accuracyBucketM (5 m), deltaMBucket (10 m), mocked, appState, fgsActive, batteryPct, powerSave` (+ round-trip clock samples and buffer counters). The serialiser picks allow-listed keys and fails closed on any position-like key; the receiver rejects any unknown field (`PAYLOAD_FIELD_NOT_ALLOWED`); `test/privacy.test.ts` fails if a coordinate-like field is added or if any file other than `geo-delta.ts` reads latitude/longitude.
2. **JS timers pause in the background.** React Native's `JavaTimerManager` stops timers while the activity is paused unless a headless JS task is active; `expo-task-manager` registers one only while a task event executes. The engine therefore drives uploads, heartbeats, polling and permission checks from each location callback (`tick()`, bounded to 4 s), plus a 1 s UI interval in the foreground. Socket messages are native events and still run JS, so a server `STALE` push also triggers an immediate permission/provider check (the only client-side detection path when no location callback arrives at all, e.g. provider off). This is a Phase-4 design input (ADR-033): the offer path inside the FGS is paced by location callbacks.
3. **No automatic resume (TC-07/08/09/15/19).** `expo-task-manager` persists registered tasks and **restores them whenever its service starts in a new process** (app launch, `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`), which for expo-location restarts updates and the FGS without a user action, and `LocationTaskService` returns `START_REDELIVER_INTENT`. The spike (a) removes the boot/package-replaced actions from `TaskBroadcastReceiver` (it must still DECLARE `RECEIVE_BOOT_COMPLETED`: expo-task-manager hands every location batch to a *persisted* JobScheduler job, and JobScheduler throws `IllegalArgumentException` without that permission — with it blocked the spike crashed on its first location callback in the 2026-10-16 emulator run; `test/task-manager-permissions.test.ts`), (b) stops any registered task at app start that this process did not start (`STALE_FGS_STOPPED`), and (c) stops and reports any task callback outside a user-started session (`ORPHAN_TASK_STOPPED`). Whether an orphan FGS flashes up briefly is exactly what TC-07/08/09/15 record. Phase 4 must keep an equivalent launch reconciliation.
4. **TC-10 refusal source.** expo-location itself refuses an FGS start while the app is not foregrounded (`ForegroundServiceStartNotAllowedException` in `LocationModule`, before Android's own check). The spike reports it as `START_REFUSED_BACKGROUND` with expo's error code. The background attempt is scheduled without a JS timer: the receiver's `GET /delay?ms=30000` answers after 30 s and the response callback runs the attempt. On OS versions whose cached-app freezer holds a backgrounded process, the response may only be processed when the app returns to the foreground; the attempt is then recorded as invalid (`APP_WAS_IN_FOREGROUND`), and the 5 s variant button is used instead (record which one produced the result).
5. **Logcat tag.** Without a native module the JS log goes to tag `ReactNativeJS`; every spike line is prefixed `WayvroSp01` and holds counts/codes only. Use `adb logcat -d -v time -s ReactNativeJS:* | grep WayvroSp01` instead of the protocol's `-s WayvroSp01:*` (§10).
6. **Cleartext on the LAN, spike only.** The receiver is a Node process on the founder's laptop, so the spike sets `usesCleartextTraffic=true`. Only the metadata above and a `spike-local-only` token travel. The release app never does this.
7. **Ports.** API `:<port>` on the private LAN address, Socket.IO gateway `:<port+1>` (a separate server so "restart gateway" really drops and refuses connections), admin `127.0.0.1:<port+2>` (loopback only). Socket.IO ping defaults (25 s / 20 s) are recorded in the data file's session row.
8. **Server rules.** `T_stale` 20 s / `T_offline` 120 s (`TRACKING_LOST`). Liveness = a socket heartbeat (sent only while the device has a fix younger than 15 s) or an upload that stores a *fresh* fix — a replay of old buffered points never makes a dead tracker look alive. After a forced OFFLINE the receiver still stores buffered points fixed **before** that moment and rejects (counts) points fixed after it (TC-13 vs TC-19). One synthetic offer 60 s after go-online and every 120 s after (30 per 60-min window), 20 s validity.
9. **Permissions flow.** Go-online requires precise foreground location **and** "Allow all the time" (protocol §5.1/TC-02); notifications are asked in the flow on Android 13+ and denial is tolerated. `killServiceOnDestroy` is left `false` (expo default) so swipe-away behaviour is the OEM's.
10. **Stop rules.** Go offline (`USER_OFFLINE`), Rider-mode switch (confirm "go offline first"), sign-out (`SIGNED_OUT`, clears every stored key), server restriction / forced offline / `TRACKING_LOST` (via socket, poll, snapshot or upload response), permission revoke or downgrade (`PERMISSION_REVOKED` / `PERMISSION_DOWNGRADED`), location services off (`PROVIDER_DISABLED`), FGS gone (`FGS_LOST`).
11. **Only a current snapshot can stop a run.** A snapshot generated (server clock) before the receiver accepted this run's go-online describes the previous run and is ignored (`src/shared/snapshot-rule.ts`); an in-progress go-online is not an FGS loss. In the 2026-10-16 emulator run a stale OFFLINE/RESTRICTED snapshot stopped a freshly started run while the receiver marked it ONLINE.

## 4. Lead instructions (Claude Code session on the founder's laptop)
Commands are PowerShell unless marked; run from the repository root unless a `cd` is shown. `$S` is the session scratch directory (outside the repo).

### 4.1 Install and local checks (no device needed)
```powershell
cd tests/spikes/sp-01-background-location
pnpm install --frozen-lockfile --ignore-workspace --node-linker=hoisted   # --ignore-workspace alone would ignore pnpm-workspace.yaml and fall back to the isolated linker, which breaks Windows native builds
pnpm typecheck
pnpm test
```

### 4.2 Build (JDK 17, release variant, debug-signed, never distributed)
```powershell
cd tests/spikes/sp-01-background-location
$env:CI = '1'
npx expo prebuild --platform android --clean --no-install
node check-spike-manifest.mjs --manifest android/app/src/main/AndroidManifest.xml      # source sanity only (not evidence)
$env:JAVA_HOME = $env:WAYVRO_JDK17_HOME; & "$env:JAVA_HOME\bin\java.exe" -version       # must print version "17"
cd android
.\gradlew.bat --no-daemon assembleRelease bundleRelease "-PreactNativeArchitectures=arm64-v8a,armeabi-v7a" "-Pandroid.enableMinifyInReleaseBuilds=true"
cd ..
New-Item -ItemType Directory -Force "$S\sp01-build" | Out-Null
Copy-Item android\app\build\outputs\apk\release\app-release.apk "$S\sp01-build\sp01-release.apk"
Copy-Item android\app\build\outputs\bundle\release\app-release.aab "$S\sp01-build\sp01-release.aab"
```
The release build is signed with the template's debug keystore (as in `scripts/android-build.mjs`): it proves the build, it is not an upload artefact. `expo-location` and `expo-task-manager` ship consumer ProGuard keep rules for their task consumers, so R8 does not break task restoration; if R8 still fails, record it and rebuild without the minify property (a recorded deviation). Delete `android/` after copying (`Remove-Item -Recurse -Force android`); it is git-ignored and regenerated by prebuild.

### 4.3 TC-21 compliance gates on the spike AAB
```powershell
cd ../../..   # repository root
node infra/ci/android/check-16kb.mjs --aab "$S\sp01-build\sp01-release.aab" --bundletool $env:BUNDLETOOL_JAR --expect-abis arm64-v8a,armeabi-v7a --zipalign <build-tools>\zipalign.exe --report "$S\sp01-build\16kb.json"
node tests/spikes/sp-01-background-location/check-spike-manifest.mjs --aab "$S\sp01-build\sp01-release.aab" --bundletool $env:BUNDLETOOL_JAR --report "$S\sp01-build\manifest.json"
java -jar $env:BUNDLETOOL_JAR dump manifest --bundle="$S\sp01-build\sp01-release.aab" --xpath=/manifest/uses-sdk/@android:targetSdkVersion   # expect 36
```
`check-spike-manifest.mjs` runs `infra/ci/android/check-permissions.mjs --policy spike-permission-allowlist.json` (fails on `USE_FULL_SCREEN_INTENT` and anything unlisted) and checks: package `dev.wayvro.spike.sp01`, not debuggable, every FGS type is `location` (and one exists), no `BOOT_COMPLETED`/`LOCKED_BOOT_COMPLETED`/`MY_PACKAGE_REPLACED`/FCM actions, no URL scheme. Record the merged permission list in the capture notes ("whatever expo-location adds, recorded"). Play pre-launch report and declaration videos: **BLOCKED-EXTERNAL** (no Play Console).

### 4.4 Receiver session
```powershell
ipconfig                                     # note the Wi-Fi adapter's IPv4 (private, e.g. 192.168.x.y) — never commit it
New-NetFirewallRule -DisplayName "Wayvro SP-01 receiver (temporary)" -Direction Inbound -Protocol TCP -LocalPort 8787,8788 -Profile Private -Action Allow
cd tests/spikes/sp-01-background-location
pnpm receiver --host <LAN IPv4> --port 8787 --data "$S\sp01-<yyyymmdd>.jsonl"   # run in the background; prints the run token
pnpm admin --port 8787 --token <token> status
```
- The receiver refuses a non-private bind address and any data path inside a Git repository.
- Device sign-in (once per install): open the spike, tap the address field, then `adb shell input text "http://<LAN IPv4>:8787"`; tap the token field, `adb shell input text "<token>"`; tap Connect. Restarting the receiver with `--token <same token>` keeps the device signed in.
- Admin commands (each one is timestamped on the server clock and drives the detection analysis): `restrict`, `unrestrict`, `force-offline`, `restart-gateway [downMs]`, `mark <label>`, `status`, `stop`. Detection marks: `revoke-all`, `revoke-while-in-use`, `revoke-bg`, `approx`, `location-off`, `swipe`, `am-kill`, `force-stop`, `reboot`, `crash-js`, `crash-native`, `net-off`, `wifi-off`, `airplane-on`. Reconnect marks: `net-on`, `wifi-on`, `airplane-off`. Type the mark the moment the founder says "now" (or immediately before running the adb command) — human latency is part of the measurement error and must be noted.
- End of session: `pnpm admin --port 8787 --token <token> stop`; `Remove-NetFirewallRule -DisplayName "Wayvro SP-01 receiver (temporary)"`; after aggregation delete the `.jsonl` file (§15).

### 4.5 Aggregation (protocol §12)
```powershell
pnpm aggregate --data "$S\sp01-<yyyymmdd>.jsonl" --case TC-04 --run latest --interval-s 5 --window-min 60 --out "$S\agg\TC-04-xiaomi-guided" `
  --set oem_class=XIAOMI --set candidate=A --set config=GUIDED --set model_class="Redmi 14C class" --set spike_commit=<sha>
```
- Writes `<out>.json` + `<out>.md`: offset-corrected completeness over the window (points fixed in `[start, start+window)` and received by window end + 5 min), gaps > 2× interval (window edges included), longest gap, delivery latency p50/p95 (nearest rank), buffer drops, duplicates received/stored, points rejected after forced OFFLINE, offers by channel (live socket / poll / snapshot recovery / late / never acked) with latency p50/p95, reconnect + snapshot times after `restart-gateway` and reconnect marks, detection times from host actions (server STALE, server OFFLINE + reason, client signal), user-confirmed stop times (client request → server OFFLINE / FGS stopped), silent tracking losses relative to the last fix, and a capture-sheet row.
- `--window-start online` (default) = the run's server go-online time; use `--window-start <ISO or server ms>` for short cases, `--interval-s 10` for the economy profile, `--run <runId>` when a file holds several runs (the status panel shows the run id).
- Device facts, battery numbers, process deaths, `fgs_present_end` and the verdict are filled by the lead from §4.6 evidence (no serials).
- Review before copying anything into `results/`: aggregates only, no coordinates (none exist), no device serials, IPs, Wi-Fi names or phone numbers.

### 4.6 Evidence commands per run (protocol §10; raw output stays in `$S`)
```powershell
adb shell getprop ro.product.manufacturer; adb shell getprop ro.product.model; adb shell getprop ro.build.version.release; adb shell getprop ro.build.version.sdk; adb shell getprop ro.build.display.id; adb shell getprop ro.config.low_ram
adb shell cat /proc/meminfo | Select-String MemTotal
adb logcat -G 16M
adb shell dumpsys batterystats --reset                              # before the run
adb shell dumpsys battery | Select-String level                     # before and after
adb logcat -d -v time -s ReactNativeJS:* | Select-String WayvroSp01 > "$S\sp01-log-<case>.txt"
adb logcat -d -v time | Select-String dev.wayvro.spike.sp01 > "$S\sp01-lifecycle-<case>.txt"   # process deaths: count ActivityManager "Process dev.wayvro.spike.sp01 ... has died"/"Killing" lines
adb shell dumpsys activity services dev.wayvro.spike.sp01           # FGS present? count ServiceRecord entries (at most one)
adb shell dumpsys deviceidle                                        # informational Doze state
adb shell am get-standby-bucket dev.wayvro.spike.sp01
adb shell dumpsys batterystats --charged dev.wayvro.spike.sp01      # model-based estimate (informational)
```

## 5. Founder instructions (protocol §8)
**F** = founder (physical device steps), **C** = Claude Code session (all host commands above).

### 5.1 Once per laptop
1. C confirms `adb`, bundletool 1.18.3 (checksum as in CI) and JDK 17.
2. F approves the temporary Windows firewall rule (Private profile only, ports 8787–8788). C records its name and removes it at the end of the session.

### 5.2 Once per device
1. Charge to **≥ 80 %**. Insert a SIM with **mobile data on**; also join the **same home Wi-Fi** as the laptop.
2. New device: finish setup **without signing into personal accounts** (skip Google where the OEM allows). Install no personal, messaging or banking apps.
3. Developer options: Settings → About phone → tap **Build number** 7 times (Xiaomi: "OS version"; some Transsion/Vivo builds: under "Software information" — tell C the actual path).
4. Developer options → **USB debugging ON**. Xiaomi/HyperOS: also **Install via USB** and **USB debugging (Security settings)**; if a Xiaomi account is demanded, use a **dedicated test account**, never a personal one, and tell C. Vivo may ask to confirm USB installs on screen.
5. Connect USB and accept **"Allow USB debugging?"** (tick "Always allow from this computer"). C checks `adb devices -l` shows `device`.
6. C records device facts (no serial, IMEI or phone number).
7. Set **screen timeout to 30 s**; keep the phone **on a desk, stationary** for the 60-min runs.
8. C enlarges the log buffer (`adb logcat -G 16M`) and records the accepted size.

### 5.3 Install
C installs the spike (`adb install -r "$S\sp01-build\sp01-release.apk"`), opens it, and signs it in to the receiver (§4.4). Returning to DEFAULT between battery configurations is **uninstall + reinstall** (`adb uninstall dev.wayvro.spike.sp01`), never a factory reset.

### 5.4 OEM settings for GUIDED (firmware varies — tell C the exact path you used; screenshots of settings screens only, with no notifications or personal data visible)
| OEM | Apply for GUIDED |
|---|---|
| Xiaomi HyperOS | App info → **Autostart ON**; App info → Battery saver → **No restrictions**; open Recents and **lock** the spike (padlock) |
| Samsung One UI | App info → Battery → **Unrestricted**; Settings → Battery → Background usage limits → the spike is not in Sleeping / Deep sleeping apps; note the "Put unused apps to sleep" setting |
| Transsion XOS/HiOS | App info → Battery / Power management → **allow background activity**; App launch / Auto-start management → **allow auto-start and background launch**; check Phone Master / power saver for an app-specific restriction |
| Vivo FuntouchOS | Settings → Battery → Background power consumption management → **Allow**; i Manager → App management → **Autostart ON** |
STD-EXEMPT (only if the DEFAULT run is below 95 %): in the spike, Driver mode → **Request battery-optimisation exemption** → Allow, and nothing else.

### 5.5 Before every 60-min run
1. Battery ≥ 80 %; Wi-Fi on; SIM data on; **Battery Saver off** (except TC-14); Do-Not-Disturb as you normally use it.
2. C resets batterystats, checks the receiver, notes host time.
3. Open the spike → **Driver** → **Go online** (follow the prompts the first time) → check the notification "SP-01 spike: location on while online" is visible → press the **power button** (screen off) → **unplug USB** (USB power stops Doze and spoils battery numbers) → leave the phone untouched for **60 minutes**.
4. After 60 min: wake the phone, reconnect USB, tell C. C collects evidence and stops the run.

### 5.6 What NOT to do
- Do not sign into personal Google/Xiaomi/Samsung/Vivo accounts on the test phone; do not use your daily phone for the 60-min runs.
- Do not move the test phone to private places during a run; do not share screen recordings or logs outside the laptop.
- Do not enable push, install other location apps, or use **Force stop** unless a case says so.
- Do not commit or paste raw logcat, batterystats dumps, screenshots with other apps' notifications, device serials, phone numbers or Wi-Fi names.
- Do not grant any permission a case does not ask for (there is no full-screen-intent permission in this build).

## 6. Per-case runbook (protocol §9)
"Mark" = `pnpm admin --port 8787 --token <t> mark <label>`. Every case ends with §4.6 evidence and §4.5 aggregation; every run is logged, including failed and repeated ones (§12).

| TC | Build | F (physical) | C (host) | Pass rule (protocol) |
|---|---|---|---|---|
| **TC-01** Rider-only hygiene | **Release app**, not the spike | Fresh install; sign in with a synthetic number; Rider onboarding → where-to search → pin → route preview → quote; open Driver mode (readiness shell) and return. Tell C every prompt and the screen it appeared on | Static: `java -jar $env:BUNDLETOOL_JAR dump manifest --bundle=app-release.aab` (no BACKGROUND_LOCATION / FOREGROUND_SERVICE* / POST_NOTIFICATIONS / USE_FULL_SCREEN_INTENT, no location service). Runtime needs the FA-17 tunnel to a synthetic API; then `adb shell dumpsys package dev.wayvro.app`, `adb shell appops get dev.wayvro.app`, `adb shell dumpsys activity services dev.wayvro.app`. Install via `bundletool build-apks --connected-device` + `install-apks` | §TC-01. Runtime part **BLOCKED** if no acceptable FA-17 tunnel session (never a cleartext release build); a dev-client run is informational only |
| **TC-02** Go-online flow | Spike, DEFAULT | (1) Fresh install → Driver → Go online → Continue → allow **precise** → Open location settings → **Allow all the time** → back → (Android 13+) notifications → online. (2) Reinstall; grant **approximate only**. (3) Reinstall; at the background step choose **Allow only while using**. Count your taps per path | Reinstall between paths; read the status panel / log | each denial → recovery screen with Settings link and **no** FGS; approximate → `PRECISE_LOCATION_REQUIRED`; full grant → FGS + notification; record user steps per OEM |
| **TC-03** 60 min DEFAULT | Spike | §5.5 | `aggregate --case TC-03 --set config=DEFAULT` | §13 R1 (recorded; freeze rule is on GUIDED), R7 battery recorded |
| **TC-04** 60 min GUIDED (+ STD-EXEMPT if TC-03 < 95 %) | Spike | §5.4 settings, then §5.5 | `--case TC-04 --set config=GUIDED` (or `STD-EXEMPT`); one extra economy run on one device: switch profile to Economy (offline), `--interval-s 10` | R1 ≥ 95 % in GUIDED; R7 ≤ 6 %/h recorded |
| **TC-05** Offers without push | inside TC-03/04 | — | offers block of the same aggregate | R5: measured; lost-and-not-recovered offers flagged as an ADR-033 finding |
| **TC-06** Socket loss | Spike, GUIDED | (b) screen off, **Wi-Fi off 2 min** (SIM data on) then on; 5× | (a) `admin restart-gateway 3000` 5×; (b) mark `wifi-off` / `wifi-on` when F says so; `--case TC-06 --window-start <ISO>` | reconnect + snapshot < 5 s p95 (informational); zero duplicates stored; every pending offer recovered or expired |
| **TC-07** Swipe-away | Spike, DEFAULT and GUIDED (Xiaomi: locked and unlocked) | Online → Recents → swipe the spike away → wait 3 min → open it | mark `swipe` | FGS survives (record per OEM) **or** STALE ≤ 20 s and OFFLINE `TRACKING_LOST` ≤ 120 s and next open shows "Tracking stopped — go online again" with no automatic resume (`ORPHAN_TASK_STOPPED`/`STALE_FGS_STOPPED` counts recorded) |
| **TC-08** Process kill | Spike, GUIDED | Online → screen off; later open the app | mark `am-kill` then `adb shell am kill dev.wayvro.spike.sp01` (record whether it died); wait 2 min; mark `force-stop` then `adb shell am force-stop dev.wayvro.spike.sp01` | detection ≤ 60 s; server OFFLINE with reason; no auto-restart after force-stop; next open restores server state; ≤ 1 FGS (`dumpsys activity services`) |
| **TC-09** Reboot | Spike, GUIDED | Do not open the app for 5 min after boot, then open | mark `reboot` then `adb reboot`; after boot `adb shell dumpsys activity services dev.wayvro.spike.sp01` (expect none) | no FGS at boot; server OFFLINE `TRACKING_LOST`; app shows server state and needs explicit go-online |
| **TC-10** Background start | Spike, GUIDED, offline | Driver → **TC-10** button → press **Home immediately** → wait 40 s → reopen (if the notice says `APP_WAS_IN_FOREGROUND`, repeat with the **5 s variant** button and wait 15 s) | read notice + log (`START_REFUSED_BACKGROUND` + expo code); record Android version and which variant produced the result | no crash; refusal caught and reported; user must bring the app to the foreground. If neither variant reaches the background attempt, report TC-10 **NOT RUN** on that device with the reason (freezer), never PASS |
| **TC-11** Permission revoke | Spike, GUIDED | Online → Settings → App → Permissions → Location → **Don't allow**; separately (new session) **Allow only while using the app**. Say "now" at each change | mark `revoke-all` / `revoke-while-in-use`; on a fresh online session mark `revoke-bg` then `adb shell pm revoke dev.wayvro.spike.sp01 android.permission.ACCESS_BACKGROUND_LOCATION` | detection ≤ 30 s (server STALE or client signal); forced offline with reason (`TRACKING_LOST` server-side, `PERMISSION_REVOKED` from the client, possibly on next open); recovery screen with Settings link; no FGS without permission. Record whether Android killed the process |
| **TC-12** Approximate / location off | Spike, GUIDED | (a) Android 12+: switch **Use precise location** off; (b) quick-settings **Location** off while online | mark `approx` / `location-off` | (a) as TC-11 (`PERMISSION_DOWNGRADED`); (b) client detects `PROVIDER_DISABLED` ≤ 30 s, server OFFLINE with reason, FGS stops |
| **TC-13** Airplane mode | Spike, GUIDED | Online → **airplane on 2 min** → off; repeat for **10 min** | mark `airplane-on` / `airplane-off` | buffered points uploaded after return; zero duplicates stored; drops counted (none expected for 10 min); reconnect + snapshot measured. Note: > 120 s silence makes the server go OFFLINE `TRACKING_LOST` by design; the client then stops on reconnect and points fixed after that moment are counted as rejected |
| **TC-14** Battery saver | Spike, GUIDED | Online → Android **Battery Saver on** (+ OEM extra saver) → 30-min screen-off run | `--case TC-14 --window-min 30 --set config=SAVER` | recorded; < 95 % is an ADR-033 OEM-guidance finding, not an automatic fail |
| **TC-15** Crash recovery | Spike, GUIDED | (a) Online → **TC-15 JS crash** button → reopen the app | mark `crash-js` (app also sends `CRASH_TEST_TRIGGERED`); (b) mark `crash-native` then `adb shell am crash dev.wayvro.spike.sp01` → relaunch; `dumpsys activity services` | state restored from `GET /snapshot`; server OFFLINE + FGS running ⇒ FGS stopped; server ONLINE + no FGS ⇒ "Tracking stopped" + explicit resume; ≤ 1 FGS; no duplicate batch stored |
| **TC-16** Rider switch | Spike, GUIDED | Online → tap **Rider** → confirm **Go offline and switch** | aggregate "User-confirmed stops" (client `OFFLINE_REQUESTED` → server OFFLINE / client `FGS_STOPPED`); `fixes / after stop` counter in the status panel (Driver mode) and `orphan` log lines | FGS stopped and server OFFLINE `USER_OFFLINE` ≤ 5 s after confirm; no location callbacks after stop; no FGS notification in Rider mode |
| **TC-17** Sign-out | Spike, GUIDED | Online → **Sign out** → confirm → reopen | same "User-confirmed stops" table (`SIGNED_OUT`); check no further `point` rows; app starts signed-out | FGS stopped, go-offline sent (`SIGNED_OUT`), local state cleared, no uploads after |
| **TC-18** Restriction | Spike, GUIDED, screen off | — | `admin restrict` (then `unrestrict` after the case) | forced offline by socket/poll/snapshot and FGS stopped ≤ 30 s (client `FORCED_OFFLINE_APPLIED`); reason on next open; go-online refused while restricted |
| **TC-19** Stale-FGS reconciliation | Spike, GUIDED | Online → **Wi-Fi off** → (C forces offline) → **Wi-Fi on** | mark `wifi-off`; `admin force-offline`; mark `wifi-on` | on reconnect the client reads OFFLINE and stops the FGS; no points fixed after the forced OFFLINE are stored (`rejected after server OFFLINE` count) |
| **TC-20** Play Integrity | — | — | — | **BLOCKED-EXTERNAL**: needs a Play-installed build and a Google Cloud project linked to a Play Console app (EG-18); a sideloaded spike returns unrecognised-app verdicts. Not an SP-01 freeze input |
| **TC-21** Compliance build check | Spike AAB | — | §4.3 | 16 KB PASS; no USE_FULL_SCREEN_INTENT; FGS type `location` only. Play pre-launch report / declaration videos **BLOCKED-EXTERNAL** |
| **TC-22** Push wake | — | — | — | **NOT RUN in Phase 3** — FA-18 DEFERRED to Phase 4 (no Firebase project); the spike contains no push library by construction |

## 7. Capture sheet (protocol §11)
`capture-sheet-header.csv` is the header. The lead keeps the working sheet in `$S` (one row per device × candidate × config × case run; the aggregator prints the receiver-derived part of each row) and fills `result` with exactly PASS / FAIL / NOT RUN / BLOCKED / SKIPPED. Only the reviewed sheet without personal data may be committed under `results/`.

## 8. Evidence handling (protocol §15)
- **Committed (after review):** aggregate JSON + Markdown per device class × candidate × config × case, and the reviewed capture sheet, in `results/`; summarised later in ADR-029.
- **Never committed:** coordinates (none are transmitted), raw logcat, batterystats dumps, receiver `.jsonl` row files, screenshots/recordings, device serials/IMEI, phone numbers, Wi-Fi names, LAN IPs, account names, settings screenshots with personal data. `.gitignore` here blocks `*.jsonl`, APK/AAB files, `android/` and `build-reports/` as a second line of defence; the receiver refuses data paths inside any Git repository.
- Raw files stay in `$S` and are deleted within 7 days after the aggregate is reviewed; the receiver data file is deleted at the end of each session.

## 9. Disposal gate
Delete this directory once ADR-029 is decided and Phase 4 has its own production presence/location implementation with device tests (Phase 4 gate). Nothing here may be imported by `apps/` or `packages/`.
