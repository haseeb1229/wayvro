# PHASE3_SP01_REAL_DEVICE_PROTOCOL — SP-01 real-device background location, permission hygiene and offer-path protocol (PROPOSED)
**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — founder/ChatGPT plan review recorded 2026-10-12 (FA-02/FA-07 APPROVED, FA-17 APPROVED IN PRINCIPLE, FA-18 DEFERRED; FA-03 open); no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

SP-01 result today: **NOT RUN** (`docs/phase0/PHASE0_ADR_BACKLOG.md` §E). Nothing in this file is a measurement. Every number below is either a pass criterion, a proposed spike input or an estimate, and is labelled as such.

## 1. Purpose and the decisions it feeds
SP-01 answers one question on real Pakistani Android hardware: **can one React Native + Expo binary keep Rider-mode users free of driver permission prompts while a Driver/Partner who is online keeps reliable background location and a working offer path without push?**

| Decision | Current status | What SP-01 supplies |
|---|---|---|
| ADR-029 background-location SDK | OPEN-SPIKE | candidate A (expo-location + expo-task-manager FGS) PASS/FAIL per OEM class; candidate B only if A fails and the founder makes a specific FA-08 spend decision after evidence (no paid spend is pre-approved) |
| ADR-003 mobile stack freeze | FOUNDER-LOCKED (direction approved, FD-09; parameters open) + OPEN-SPIKE | together with SP-02: freeze RN/Expo (ACCEPTED-ON-EVIDENCE) or trigger the Flutter fallback evaluation |
| ADR-033 offer delivery | FOUNDER-LOCKED (direction approved, M26), parameters OPEN-SPIKE | measured socket/poll delivery inside the location FGS with push absent; reconnect and missed-offer recovery times; OEM battery/autostart guidance content |
| Phase-4 presence parameters (heartbeat, `T_stale`, `T_offline`, location interval, batch size) | not decided | measured behaviour of the spike inputs in §5.3; Phase 4 picks final values in ADR-029/ADR-033 |

Phase-3 requirement IDs exercised: **V05** (just-in-time, mode-scoped permissions; rider path never sees driver prompts), **A07** (foreground/background rationale, revoke/regrant, approximate handling), **U05** (permission minimisation review evidence). Context only (not Phase-3 IDs): M26, D05, V06, INV-07, INV-08 in `docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md` §4, §6, §7, §9.

## 2. What SP-01 is NOT
- **Not a shipped feature.** No background location, foreground service (FGS), go-online, presence or offer code enters `apps/wayvro-mobile` in Phase 3 (`docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md`). The release permission allowlist `infra/ci/android/permission-allowlist.json` is not widened for SP-01.
- **The spike build is a disposable harness** in `tests/spikes/sp-01-background-location/` (proposed), outside the pnpm workspace like the existing spikes (`tests/spikes/README.md`), with its own lockfile and a distinct technical package id (proposed `dev.wayvro.spike.sp01`, mirroring the SP-AND precedent `dev.wayvro.spike.spand`). It is never uploaded to any store, never distributed, and is not a second Wayvro app.
- **The rider-hygiene part (TC-01) uses the real release app** (`apps/wayvro-mobile`, release AAB), because the claim under test is about what the shipped binary does.
- Not a load test (ADR-005b Phase-4 re-test is separate), not an iOS release gate (§17), not the KYC capture check (R4 item 9 — out of scope; Phase-2 device debt), not cold start (R4 item 5 belongs to SP-02, CON-P3-06).
- Emulator runs may be used to debug the harness; **an emulator result never closes SP-01** (backlog §E).

## 3. Preconditions and dependencies
| # | Precondition | Owner | Blocks |
|---|---|---|---|
| P-1 | Spike harness built (app + receiver) at checkpoint P3.6 | Claude Code session | all spike cases |
| P-2 | At least one device per OEM class acquired, USB debugging on (FA-03) | Founder | the ≥3-OEM-class pass rule |
| P-3 | Phase-3 release app with rider search→quote flow (P3.5) | Claude Code session | TC-01 runtime part |
| P-4 | FA-02 rider foreground location — **APPROVED 2026-10-12** (COARSE + FINE, just in time on "use current location" only; no background request in the release app) | done | TC-01 location sub-checks run against the approved scope |
| P-5 | HTTPS-reachable synthetic API for the release app — **FA-17 APPROVED IN PRINCIPLE 2026-10-12 for SP-01/SP-02 only**: an ephemeral, vetted HTTPS tunnel to the minimum local synthetic API (synthetic data only, no real customer data, torn down after each session, tunnel terms/security verified before use, no URL/token committed) or a later staging host; same decision as SP02-D1 in `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md` | Founder opens each session | TC-01 runtime part on the release build — **BLOCKED** if no acceptable free temporary option exists (TLS never weakened; never a cleartext release build) |
| P-6 | Laptop and test device on the same private Wi-Fi; a temporary inbound firewall rule for the receiver port (private profile only, removed afterwards) | Founder | spike receiver reachability |

## 4. Candidates
| Candidate | What | Cost | When evaluated |
|---|---|---|---|
| **A** | `expo-location` (`startLocationUpdatesAsync` + `TaskManager.defineTask`, config-plugin background + FGS options) at the version bundled with Expo SDK 57; the JS runtime kept alive by the location FGS hosts the socket/poll offer path | free (MIT) | first, on every device |
| **B** | Transistorsoft react-native-background-geolocation | ~USD 399/app key per Phase-0 research R4 (re-verify) | **only if A fails** the pass rules on an OEM class **and** the founder approves spend (FA-08). R4 records the SDK as free in debug builds; if the licence terms still say so when re-verified, a debug-build screening run may precede the purchase decision, but a debug build is not release evidence |
| Fallback | Flutter + flutter_background_geolocation re-run of TC-03/04/07/08 (ADR-003 fallback) | engineering time + same commercial licence class | only if A and B both fail |

A custom native Kotlin FGS module is a further conceivable option; it is **not proposed** here (it would need its own ADR, native-review capacity and the same device evidence) and is recorded only so that ADR-029 lists it as considered.

Both candidates are built with the same Expo SDK 57.0.27 / RN 0.86.3 / New Architecture / Hermes / JDK 17 toolchain as the app (ADR-036), targetSdk 36, release-variant (non-debuggable, minified) build.

## 5. Spike harness (proposed design)
### 5.1 Spike app (proposed `dev.wayvro.spike.sp01`)
- Screens: rationale screen ("prominent disclosure" wording containing "location" and naming background use — draft copy, not store copy), permission steps (fine → background "Allow all the time" via system settings on Android 11+), **Go online / Go offline**, a **mode toggle** (Rider / Driver), **Sign out**, battery-optimisation request button, status panel (FGS running, socket state, last upload, buffer depth).
- Permissions declared by the spike only: INTERNET, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION, POST_NOTIFICATIONS, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, plus whatever expo-location's plugin adds (recorded). **USE_FULL_SCREEN_INTENT is blocked and never requested**; the spike's own release manifest is checked with the existing `infra/ci/android/check-permissions.mjs` against a spike-only allowlist (proposed file inside the spike directory) and the check fails if USE_FULL_SCREEN_INTENT appears.
- **No push.** The spike contains no FCM configuration and no push library, so every offer measurement is "push disabled" by construction (ADR-033: push is a wake aid only).
- FGS starts **only** from a foreground user action (Go online). Background-start attempts are made only in TC-10 to prove they are refused gracefully.

### 5.2 Privacy-by-design payload — the spike sends no coordinates
The device's own location is real (it is the founder's device in a real place). The measurement does **not** need positions, so the spike reads the fix on-device and transmits only metadata:

| Field | Content |
|---|---|
| `runId`, `seq` | random per-run id, monotonically increasing sequence |
| `fixTimeMs` | fix timestamp from the OS (device clock; offset corrected, §12) |
| `accuracyBucketM` | accuracy rounded to 5 m |
| `deltaMBucket` | distance from the previous fix, computed on-device, rounded to 10 m (shows movement without absolute position) |
| `mocked` | OS mock-location flag |
| `appState`, `fgsActive`, `batteryPct`, `powerSave` | process/FGS/battery state at fix time |

Latitude/longitude never leave the device, are never logged (spike log tag prints counts only) and are not persisted by the spike. The OS location stack itself (for example Google Play services fused location, used by expo-location when available) behaves according to the device's own settings, exactly as for any location app; SP-01 adds no third party.

### 5.3 Spike inputs (PROPOSED spike parameters — not final ADR-029/Phase-4 values)
| Parameter | Spike value | Rationale |
|---|---|---|
| Location interval | 5 s, distance filter 0 m, high accuracy | Phase-0 SLO "location freshness ≤10 s while on trip" (`docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md` §9); distance filter 0 makes the expected count deterministic (720 per 60 min) |
| Economy profile (one device, battery comparison only) | 10 s, 10 m, balanced | informs the Phase-4 idle-online vs on-trip split |
| Upload | batch every 10 s or 5 points, HTTP POST, bounded exponential backoff with jitter | idempotent by (`runId`, `seq`); server stores each `seq` once |
| On-device buffer | ring of 720 points; overflow drops oldest and counts drops | bounded memory; drops are measured, never hidden |
| Socket | Socket.IO client to the receiver (ADR-005b transport), server ping defaults recorded | the primary offer path under ADR-033 |
| Poll fallback | when the socket has been down > 10 s: HTTP poll every 15 s for pending offers | ADR-033 "socket/poll" |
| Synthetic offers | server emits one synthetic offer every 120 s (30 per 60-min run), 20 s validity, client acks with receive time | offer delivery ratio and latency with push absent |
| Server stale rules | `T_stale` = 20 s without upload or socket heartbeat → STALE; `T_offline` = 120 s → OFFLINE reason `TRACKING_LOST` | sized so a revocation can be detected within the 30 s pass rule |
| Restriction | receiver admin command marks the spike account RESTRICTED → emits forced-offline event + returns it on next poll/snapshot | TC-18 |

### 5.4 Receiver (proposed, inside the spike directory)
A small Node process run by the Claude Code session on the founder's laptop, bound to the laptop's private LAN address, with a per-run shared token of the `spike-local-only` kind used by the existing spikes (not a secret). It serves: `POST /points`, `GET /time`, `GET /snapshot` (authoritative online state + pending offers), the Socket.IO namespace, and an admin CLI (restrict, force offline, restart gateway). It writes received rows to a local file **outside the repository** (scratch directory) and produces the aggregate described in §12. No coordinates exist in its data (§5.2). Raw run files are deleted after aggregation (§15).

Reachability note: the primary 60-min runs use the home Wi-Fi so the device can reach the laptop. A phone on mobile data cannot reach the laptop without a public tunnel; a public endpoint for the spike receiver is **not proposed** (the FA-17 in-principle approval covers only the minimum synthetic API for the release-app checks, not the receiver). Mobile-data behaviour is covered by keeping SIM data enabled (radio realism) and by TC-13 (network loss/return).

## 6. Device matrix and progressive acquisition (FA-03, FD-13)
Exact Android and OEM-skin versions are **recorded from each device**, not assumed. Model names are classes; any current model of the same class is acceptable.

| Order | OEM class | Example models (class) | Skin | Why | Required for Android freeze |
|---|---|---|---|---|---|
| 1 | Transsion | Infinix Smart 10 or Tecno Spark 30C (3–4 GB RAM) | XOS / HiOS; Android Go edition where applicable | largest PK share (R4 §5); budget reference device shared with SP-02 (FA-04) | **yes** |
| 2 | Xiaomi | Redmi 14C or Redmi A5 class | HyperOS | ranked among the most aggressive background killers (R4 §6, dontkillmyapp) | **yes** |
| 3 | Samsung **or** Vivo | Galaxy A06 class / Vivo Y-series class | One UI (Core) / FuntouchOS | third OEM class for the ≥3 rule | **yes (one of the two)** |
| 4 | the other of Samsung / Vivo | as above | as above | coverage before production release (FD-13) | no (recommended before pilot) |
| 5 | any device on Android 11–13 | borrowed is fine | any | ~11.5 % of PK devices still on Android 11 (R4 §5); FGS/permission behaviour differs by version; informs Q31/F-P3-10 | no (recommended) |
| later | iPhone on iOS 26 (FA-13) | — | iOS | iOS release evidence (§17) | **no** — not an Android freeze input |

Borrowed devices are acceptable if the owner agrees, the device is factory-reset or a secondary user/profile is not required, and no personal account data is read (§8.6).

## 7. Battery configurations under test
| Config | Meaning | Required |
|---|---|---|
| **DEFAULT** | factory state immediately after install; record what the OEM shows as the app's battery/background setting | every device |
| **STD-EXEMPT** | only the standard Android battery-optimisation exemption granted through the spike's system dialog | run only if DEFAULT < 95 %; shows whether the standard dialog alone is enough for that OEM |
| **GUIDED** | STD-EXEMPT + the OEM-specific settings a driver would be guided through (autostart, unrestricted background, recents lock where the OEM has one) | every device |

Interpretation of the backlog pass rule (fixed before measurement with the FA-07 pre-measurement budget set approved 2026-10-12, which references these rules through PB-15/PB-17): the freeze criterion "≥95 % over 60 min" is evaluated in **GUIDED**; DEFAULT and STD-EXEMPT results are mandatory records that decide how heavy the Phase-4 onboarding guidance must be per OEM (ADR-033 "explicit OEM battery/autostart guidance").

## 8. Founder setup instructions (step by step)
Roles: **F** = founder (physical device steps), **C** = Claude Code session on the founder's laptop (host commands, receiver, analysis). Host commands are written in POSIX form; the session runs the Windows equivalents.

### 8.1 Once per laptop
1. C: confirm Android SDK platform-tools (`adb`) and bundletool 1.18.3 (checksum as in CI) are available; confirm JDK 17 for builds (`scripts/android-build.mjs` refuses other majors).
2. F: approve the temporary Windows firewall inbound rule for the receiver port on the **Private** network profile only. C records the rule name; it is removed at the end of the session.

### 8.2 Once per device
1. F: charge to **≥ 80 %**. Insert a SIM with mobile data **on** (realistic radio state); also connect to the same home Wi-Fi as the laptop.
2. F: if the device is new, complete setup **without signing into personal accounts** (a Google account is not needed for SP-01; skip where the OEM allows). Do not install personal apps, messaging or banking apps on the test device.
3. F: enable Developer options: Settings → About phone → tap **Build number** 7 times (on Xiaomi: "OS version"; on some Transsion/Vivo builds the item sits under "Software information" — record the actual path).
4. F: Developer options → **USB debugging ON**. Xiaomi/HyperOS additionally shows **Install via USB** and **USB debugging (Security settings)**; community reports say these can require a Xiaomi account sign-in and an inserted SIM — if so, use a dedicated test account, never a personal one, and record it. Vivo may ask to confirm USB installs on-screen.
5. F: connect USB; accept the **"Allow USB debugging?"** fingerprint prompt (tick "Always allow from this computer"). C: `adb devices -l` must show `device`.
6. C: record device facts (no serial number, IMEI or phone number is recorded):
   - `adb shell getprop ro.product.manufacturer` · `ro.product.model` · `ro.build.version.release` · `ro.build.version.sdk` · `ro.build.display.id` · `ro.config.low_ram`
   - `adb shell cat /proc/meminfo` (MemTotal line only)
7. F: set screen-off timeout to 30 s (so screen-off happens quickly during runs) and keep the device on a desk, stationary, for the primary runs (stationary + unplugged + screen off is the worst case for Doze).
8. C: enlarge the log buffer where the OEM allows: `adb logcat -G 16M` (record the accepted size).

### 8.3 Install
- Spike: C builds the spike release APK/AAB in the spike directory and installs it, for example `adb install -r <spike-release.apk>` (signed with a local debug key; never distributed).
- Release app (TC-01): C installs the Phase-3 release AAB with bundletool: `java -jar "$BUNDLETOOL_JAR" build-apks --bundle=app-release.aab --output=wayvro-device.apks --connected-device --overwrite`, then `java -jar "$BUNDLETOOL_JAR" install-apks --apks=wayvro-device.apks`. bundletool signs the generated APKs with the local debug keystore (`~/.android/debug.keystore`) unless `--ks` is given; the CI AAB is itself debug-signed (`scripts/android-build.mjs`) — fine for measurement, never an upload artefact.

### 8.4 OEM settings for GUIDED (typical paths; firmware varies — record the exact path observed, screenshots only of settings screens)
| OEM | Settings to apply for GUIDED |
|---|---|
| Xiaomi HyperOS | App info → **Autostart ON**; App info → Battery saver → **No restrictions**; open Recents and **lock** the spike app (padlock) |
| Samsung One UI | App info → Battery → **Unrestricted**; Settings → Battery → Background usage limits → ensure the app is not in Sleeping / Deep sleeping apps; record the "Put unused apps to sleep" setting |
| Transsion XOS/HiOS | App info → Battery / Power management → **allow background activity**; App launch / Auto-start management → **allow auto-start and background launch**; check the Phone Master / power-saver app for an app-specific restriction |
| Vivo FuntouchOS | Settings → Battery → Background power consumption management → **Allow**; i Manager → App management → **Autostart ON** |

Return to DEFAULT between configs by uninstalling and reinstalling the spike (C: `adb uninstall dev.wayvro.spike.sp01`), never by factory reset.

### 8.5 Before every 60-min run
1. F: battery ≥ 80 %; Wi-Fi on; SIM data on; Battery Saver **off** (except TC-14); Do-Not-Disturb as normally used.
2. C: `adb shell dumpsys batterystats --reset`; start receiver; note host time.
3. F: open the spike, go online (Driver mode), confirm the FGS notification is visible, press the power button (screen off), **unplug USB** (USB power prevents Doze and invalidates battery numbers), leave the device untouched for 60 min.
4. F: after 60 min, wake the device, reconnect USB. C: collect evidence (§10), stop the run from the receiver.

### 8.6 What NOT to do
- Do not sign into personal Google/Xiaomi/Samsung/Vivo accounts on the test device; do not use the founder's daily phone for the 60-min runs.
- Do not move the test device to private places other than where it sits during the run; do not share the screen recording or logcat outside the laptop.
- Do not enable push, install other location apps, or use "Force stop" except where a case says so.
- Do not commit or paste raw logcat, batterystats dumps, screenshots with notifications from other apps, device serials or Wi-Fi names.
- Do not grant USE_FULL_SCREEN_INTENT or any permission the case does not ask for.

## 9. Test cases
Durations are estimates of wall-clock time per device. "Spike" = spike app; "Release" = Phase-3 release app.

| TC | Name | Build | R4 item | Config | Est. duration |
|---|---|---|---|---|---|
| TC-01 | Rider-only permission hygiene | Release | 1 | n/a | 25 min |
| TC-02 | Go-online permission flow, rationale, approximate-only handling | Spike | 2 (flow part), A07 | DEFAULT | 15 min |
| TC-03 | 60-min screen-off online, stationary | Spike | 2 | DEFAULT | 70 min |
| TC-04 | 60-min screen-off online, stationary | Spike | 2 | GUIDED (+ STD-EXEMPT if TC-03 < 95 %) | 70 min (140) |
| TC-05 | Offer path with push absent (runs inside TC-03/TC-04) | Spike | 6 (per ADR-033) | as host run | 0 extra |
| TC-06 | Socket loss and recovery | Spike | 6, 8 | GUIDED | 20 min |
| TC-07 | Swipe-away from Recents | Spike | 3 | DEFAULT and GUIDED | 20 min |
| TC-08 | Process kill (`am kill`, `am force-stop`) | Spike | 3 | GUIDED | 15 min |
| TC-09 | Reboot while online | Spike | 3 | GUIDED | 15 min |
| TC-10 | FGS start rules (background start refused) | Spike | 4 | GUIDED | 10 min |
| TC-11 | Permission revoke while online | Spike | 7 | GUIDED | 20 min |
| TC-12 | Precise → approximate downgrade; location services off | Spike | 7 | GUIDED | 15 min |
| TC-13 | Airplane mode toggle (2 min and 10 min) | Spike | 8 | GUIDED | 20 min |
| TC-14 | OS / OEM battery saver on while online | Spike | 2 | GUIDED | 35 min |
| TC-15 | JS crash and native crash while online | Spike | 8 | GUIDED | 15 min |
| TC-16 | Mode switch to Rider stops FGS | Spike | role model §5 | GUIDED | 10 min |
| TC-17 | Sign-out stops FGS and clears spike state | Spike | role model §4 | GUIDED | 10 min |
| TC-18 | Server restriction while online | Spike | role model §4 | GUIDED | 10 min |
| TC-19 | Stale-FGS reconciliation on restart | Spike | role model §6.4 | GUIDED | 10 min |
| TC-20 | Play Integrity verdict matrix | — | 10 | — | BLOCKED-EXTERNAL (see case) |
| TC-21 | Compliance build check of the spike artefact | Spike AAB | 11 | — | 10 min (laptop) |
| TC-22 | Push wake (optional) | — | 6 (push part) | — | **NOT RUN in Phase 3** — FA-18 DEFERRED to Phase 4 (no Firebase project now) |

### TC-01 Rider-only permission hygiene (Release)
- **Steps:** static: C runs `java -jar "$BUNDLETOOL_JAR" dump manifest --bundle=app-release.aab` and confirms no ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION, POST_NOTIFICATIONS or USE_FULL_SCREEN_INTENT and no location-type service (the CI permission gate already enforces the allowlist). Runtime: fresh install; F signs in with a synthetic number (local API runner, recording OTP sink — Phase-2 practice); F completes Rider onboarding, where-to search, pin, route preview and quote; F opens Driver mode (readiness shell) and returns to Rider mode.
- **Measurements:** prompts shown and the screen on which each appeared; `adb shell dumpsys package dev.wayvro.app` (requested/granted runtime permissions); `adb shell appops get dev.wayvro.app` (last access time of COARSE_LOCATION/FINE_LOCATION/CAMERA ops); `adb shell dumpsys activity services dev.wayvro.app` (no foreground service at any point).
- **Pass:** no background-location, FGS, notification or camera prompt anywhere in the rider path; the foreground location prompt (FA-02 approved scope) appears only after the "use current location" tap and after the in-app rationale; an approximate-only grant keeps the flow usable; denial leaves manual search + pin usable, with recovery UI; no location op access before that tap; Driver readiness only reads the permission state; zero foreground services.
- **If no acceptable FA-17 tunnel session is available (P-5):** the release-build runtime part is reported **BLOCKED** (R2 cannot PASS on it); TLS is never weakened and no cleartext release build is produced. The static release-manifest check still runs, and a supplementary runtime pass on the dev-client debug build (same JS paths; the debug manifest additionally carries SYSTEM_ALERT_WINDOW for the developer overlay, ADR-036) may be recorded as informational evidence only — never as PASS.
- **Evidence:** prompt log (screen → prompt), counts from the dumps (no raw dumps committed).

### TC-02 Go-online permission flow (Spike)
- **Steps:** fresh install → Go online → rationale → fine-location prompt → background "Allow all the time" (Android 11+ opens system settings) → FGS starts. Repeat granting only **approximate**; repeat denying background.
- **Pass:** each denial yields a recovery screen with a settings link and **no** FGS; approximate-only refuses go-online with reason `PRECISE_LOCATION_REQUIRED` (spike reason code); full grant starts the FGS with the persistent notification. Record the number of user steps per OEM.

### TC-03 / TC-04 60-min screen-off online (Spike)
- **Steps:** §8.5. TC-03 in DEFAULT; TC-04 in GUIDED (STD-EXEMPT run in between only if TC-03 < 95 %). One extra 60-min run with the economy profile on one device (battery comparison).
- **Measurements:** expected 720 points (5 s); received unique `seq`; gaps > 10 s (2× interval); longest gap; delivery latency (server receive − corrected fix time) p50/p95; buffer drops; process deaths (`adb logcat` ActivityManager lines for the spike package only); FGS notification present at end; Doze state (`adb shell dumpsys deviceidle` after reconnect, informational); app standby bucket (`adb shell am get-standby-bucket dev.wayvro.spike.sp01`); battery % start/end; `adb shell dumpsys batterystats --charged dev.wayvro.spike.sp01` estimated drain (model-based, OEM power profile).
- **Pass:** see §13.

### TC-05 Offer path with push absent (inside TC-03/TC-04)
- **Measurements:** synthetic offers emitted (30), delivered live via socket within validity, delivered via poll, recovered from snapshot after reconnect, lost; latency p50/p95 (server emit → client ack, offset-corrected).
- **Pass:** recorded per OEM/config (parameter input for ADR-033); the freeze rule requires only that it is **measured** with push disabled (§13). Lost offers that were not recoverable from the snapshot are flagged as an ADR-033 finding.

### TC-06 Socket loss and recovery
- **Steps:** while online with screen off: (a) C restarts the receiver's realtime gateway; (b) F turns Wi-Fi off for 2 min with SIM data available but the receiver unreachable over mobile data (§5.4), then Wi-Fi on; repeat each 5×.
- **Measurements:** time from network/gateway return to socket reconnected and snapshot fetched; offers emitted during the gap recovered; duplicate points stored.
- **Pass (informational target):** reconnect + snapshot < 5 s p95 (ADR-005b SLO, Phase-4 gate); zero duplicates stored; every pending offer either recovered or expired with reason.

### TC-07 Swipe-away from Recents
- **Steps:** online → open Recents → swipe the spike away; wait 3 min; repeat in DEFAULT and GUIDED (Xiaomi: locked and unlocked).
- **Pass (A):** either the FGS survives (record per OEM) or the server marks the driver STALE within 20 s and OFFLINE `TRACKING_LOST` within 120 s, and the next app open shows "tracking stopped — go online again" with no automatic resume. **(B, if evaluated):** service survives on Vivo/Xiaomi/Transsion in GUIDED (R4 item 3 PASS B); document each OEM.

### TC-08 Process kill
- **Steps:** online → screen off → `adb shell am kill dev.wayvro.spike.sp01` (kills only if the OS considers the process killable; record whether it died) → wait 2 min; then `adb shell am force-stop dev.wayvro.spike.sp01`.
- **Pass:** client-side or server-side detection within 60 s (R4 item 3); server forced OFFLINE with reason; no auto-restart after force-stop; next open restores authoritative server state; no duplicate FGS.

### TC-09 Reboot while online
- **Steps:** online → `adb reboot` → wait for boot → do not open the app for 5 min → open.
- **Pass:** no automatic FGS start at boot; server OFFLINE `TRACKING_LOST`; on open, the app shows the server state and requires an explicit go-online.

### TC-10 FGS start rules
- **Steps:** spike debug control schedules a go-online attempt 30 s after the app is backgrounded (simulates "go online from a notification/background trigger").
- **Pass:** no crash; the platform refusal (for example `ForegroundServiceStartNotAllowedException` on Android 12+) is caught, reported as `START_REFUSED_BACKGROUND`, and the app requires the user to bring it to the foreground. Record behaviour per Android version.

### TC-11 Permission revoke while online
- **Steps:** online → F revokes location in Settings (App info → Permissions → Location → "Don't allow"; then separately "Allow only while using the app"); also C: `adb shell pm revoke dev.wayvro.spike.sp01 android.permission.ACCESS_BACKGROUND_LOCATION` on a fresh online session. Note the host time of each action.
- **Measurements:** whether Android killed the process (expected on runtime-permission revoke; record); time from revoke to server STALE and to forced OFFLINE; reason shown on next open.
- **Pass:** revocation detected **≤ 30 s** (server STALE or client signal) and driver forced offline with a reason code (`TRACKING_LOST` server-side, `PERMISSION_REVOKED` reported by the client on next open); recovery screen offers settings deep link; no FGS without permission.

### TC-12 Approximate downgrade and location services off
- **Steps:** (a) precise → approximate in Settings (Android 12+); (b) quick-settings Location toggle off while online (process normally not killed).
- **Pass:** (a) as TC-11; (b) the client detects the provider-disabled state from the location callbacks within 30 s, reports it, the server forces OFFLINE with reason, FGS stops.

### TC-13 Airplane mode toggle
- **Steps:** online → airplane mode on for 2 min → off; repeat for 10 min.
- **Pass:** buffered points uploaded after return; zero duplicates stored (idempotent `seq`); buffer drops counted (none expected for 10 min at 5 s = 120 points); reconnect + snapshot measured as TC-06.

### TC-14 Battery saver on while online
- **Steps:** GUIDED, online, enable Android Battery Saver and, where present, the OEM's extra power-saving mode; 30-min screen-off run.
- **Pass:** recorded completeness and offer delivery; if completeness < 95 %, the finding goes to the ADR-033 OEM guidance ("battery saver degrades tracking") — not an automatic SP-01 fail, because the freeze rule is defined on GUIDED without saver.

### TC-15 Crash recovery
- **Steps:** online → (a) spike debug button throws an unhandled JS error; (b) `adb shell am crash dev.wayvro.spike.sp01` (native crash) → relaunch.
- **Pass:** authoritative state restored from `GET /snapshot`; if the server says OFFLINE while an FGS is running, the FGS is stopped; if the server says ONLINE but no FGS exists, the user sees "tracking stopped" and must resume explicitly; no duplicate FGS (`adb shell dumpsys activity services dev.wayvro.spike.sp01` shows at most one); no duplicate batch stored.

### TC-16 Mode switch to Rider stops FGS
- **Steps:** online → switch to Rider mode in the spike (which, per the role model §5, requires confirming "go offline first").
- **Pass:** FGS stopped and server OFFLINE reason `USER_OFFLINE` within 5 s of confirmation (proposed); no location callbacks after stop (spike log count); rider screens never show the FGS notification.

### TC-17 Sign-out stops FGS
- **Pass:** sign-out while online stops the FGS, sends go-offline, clears spike local state; no further uploads; next open starts signed-out with no FGS.

### TC-18 Server restriction while online
- **Steps:** C issues the restrict command on the receiver while the device is online and screen-off.
- **Pass:** forced-offline event delivered by socket (or by the next poll/snapshot) and FGS stopped within 30 s (proposed); reason shown on next open; go-online refused while restricted.

### TC-19 Stale-FGS reconciliation
- **Steps:** online → Wi-Fi off → C forces OFFLINE on the receiver → Wi-Fi on.
- **Pass:** on reconnect the client reads OFFLINE from the snapshot and stops the FGS (role model §6.4); no points accepted after the forced OFFLINE.

### TC-20 Play Integrity (R4 item 10) — BLOCKED-EXTERNAL
A meaningful verdict matrix needs a Play-installed build and a Google Cloud project linked to a Play Console app (EG-18 track). A sideloaded spike returns unrecognised-app verdicts. Recorded as **BLOCKED** with this reason; not an SP-01 freeze input (integrity is a risk signal, never a rider block — R4 §7).

### TC-21 Compliance build check (R4 item 11)
- **Steps:** C runs `infra/ci/android/check-16kb.mjs` and `infra/ci/android/check-permissions.mjs` (spike allowlist) on the spike AAB.
- **Pass:** 16 KB PASS; spike manifest contains no USE_FULL_SCREEN_INTENT; declared FGS type is `location` only. Play pre-launch report and store declaration videos: **BLOCKED-EXTERNAL** (no Play Console; Phase 4/7 with the real app).

### TC-22 Push wake (optional) — NOT RUN in Phase 3
Requires an FCM/Firebase project and credentials. **FA-18 is DEFERRED to Phase 4 (2026-10-12):** no Firebase project is created now, so the push-wake portion is **NOT RUN** in Phase 3 and push-wake measurement is a Phase-4 item. ADR-033 already makes push a wake aid only, so the freeze does not depend on TC-22; Phase 4 measures push before relying on it as an alert aid.

## 10. Evidence capture per run (commands)
| Evidence | Command (C) | Kept where |
|---|---|---|
| Spike log (counts only) | `adb logcat -d -v time -s WayvroSp01:*` | local scratch, deleted after aggregation |
| Process/FGS lifecycle for the spike | `adb logcat -d -v time` filtered on lines containing `dev.wayvro.spike.sp01` | local scratch |
| FGS state | `adb shell dumpsys activity services dev.wayvro.spike.sp01` | counts in sheet |
| Battery | `adb shell dumpsys battery` (level) before/after; `adb shell dumpsys batterystats --charged dev.wayvro.spike.sp01` | numbers in sheet |
| Doze / standby | `adb shell dumpsys deviceidle`; `adb shell am get-standby-bucket dev.wayvro.spike.sp01` | state in sheet |
| Received points/offers | receiver aggregate (counts, gaps, latencies) | aggregate committed (§15) |
| Settings paths | F's notes + settings-screen screenshots (no notifications/personal data visible) | local; paths transcribed into the sheet |

## 11. Data capture sheet (one row per device × candidate × config × case run)
| Column | Content |
|---|---|
| `run_id` | random id |
| `date`, `start_server_time`, `duration_min` | server clock |
| `oem_class` | TRANSSION / XIAOMI / SAMSUNG / VIVO / OTHER |
| `model_class`, `android_release`, `api_level`, `oem_build`, `low_ram`, `ram_total_gb` | from §8.2 (no serials) |
| `candidate` | A / B / FLUTTER |
| `spike_commit` | spike source commit |
| `config` | DEFAULT / STD-EXEMPT / GUIDED / SAVER |
| `case_id` | TC-xx |
| `interval_s`, `expected_points`, `received_points`, `completeness_pct` | §12 method |
| `gaps_gt_2x`, `longest_gap_s`, `buffer_drops`, `duplicates_stored` | |
| `delivery_latency_p50_s`, `delivery_latency_p95_s` | |
| `process_deaths`, `fgs_present_end` | |
| `offers_emitted`, `offers_live`, `offers_polled`, `offers_recovered`, `offers_lost`, `offer_latency_p50_s`, `offer_latency_p95_s` | |
| `reconnect_snapshot_p95_s` | TC-06/TC-13 |
| `detect_s`, `forced_offline_reason` | TC-07/08/11/12/18 |
| `battery_start_pct`, `battery_end_pct`, `drain_pct_per_h`, `batterystats_mah` | |
| `result` | PASS / FAIL / NOT RUN / BLOCKED / SKIPPED |
| `notes` | free text, no personal data |

## 12. Analysis method
- **Clock:** device time is not trusted. The spike calls `GET /time` at start and every upload response carries server time; the receiver estimates the device offset (median of round-trip-corrected samples) and corrects `fixTimeMs`. Host actions (revoke, kill) are timestamped by the receiver host, which shares the server clock.
- **Completeness** = unique `seq` with corrected fix time inside the 60-min window and received by the server no later than window end + 5 min, ÷ expected points (window ÷ interval = 720). Late-but-received points count for completeness; their lateness shows in the delivery-latency distribution.
- **Gaps:** consecutive corrected fix times differing by > 2× interval; report count, total gap time, longest gap.
- **Detection times:** server STALE/OFFLINE time − host action time (or − last fix time for silent deaths).
- **Battery:** %/h = (start % − end %) ÷ hours; batterystats estimate reported alongside (model-based, OEM-dependent; informational).
- **Offers:** delivered ratio by channel; latency p50/p95 (nearest-rank).
- All runs are logged, including failed and repeated ones; nothing is discarded silently.

## 13. Pass/fail rules (freeze criteria; fixed before measurement under the FA-07 approval of 2026-10-12)
| # | Rule | Source |
|---|---|---|
| R1 | Completeness **≥ 95 %** over a 60-min screen-off run in GUIDED, on **≥ 3 OEM classes** including **Transsion (Infinix/Tecno) and Xiaomi**, plus Samsung or Vivo | backlog SP-01; `docs/phase3/PHASE3_PLAN.md`; interpretation of the config in §7 |
| R2 | **No** background-location, FGS, notification or camera prompt in the rider path of the release app (TC-01) | backlog; V05; INV-07 |
| R3 | Revocation detected **≤ 30 s** and driver forced offline with a reason code (TC-11/TC-12) | backlog; R4 item 7 |
| R4 | Kill/crash/reboot recovery deterministic: authoritative state restored, no duplicate FGS, no duplicate batch, no automatic resume after force-stop/reboot (TC-07/08/09/15/19) | backlog; R4 items 3, 8 |
| R5 | Offer path **measured** with push disabled on every freeze device (TC-05), with recovery after reconnect (TC-06) | backlog; ADR-033 |
| R6 | FGS stops on mode switch to Rider, sign-out and restriction (TC-16/17/18) | role model §4–§5 |
| R7 | Battery drain recorded for every 60-min run; budget ≤ 6 %/h screen-off online (record actual) | `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md`; R4 item 2 |
| R8 | USE_FULL_SCREEN_INTENT absent from every SP-01 artefact (TC-21) | ADR-033, M26 |

Verdict: **PASS** only if R1–R6 and R8 pass and R7 is recorded. R7 above budget is a recorded finding that drives ADR-029 parameters (interval/profile) and is re-measured; it does not by itself trigger the Flutter fallback. A device that cannot be obtained makes the corresponding rule **BLOCKED**, never PASS.

## 14. Fallback decision tree
1. A fails R1 on an OEM class in GUIDED → tune spike inputs within reason (for example interval, accuracy, batching) and re-run once; record both runs.
2. Still failing → a specific FA-08 founder spend decision on candidate B (Transistorsoft), taken on this evidence (no paid spend is pre-approved). If approved: re-run TC-03/04/07/08/11/15 with B on the failing classes.
3. B also fails on a required class → ADR-003 Flutter fallback evaluation (R4 exit gate) — founder decision before any further mobile architecture work.
4. A passes R1 only in GUIDED → acceptable for freeze; Phase-4 onboarding must include the OEM guidance proven here (ADR-033).
5. Any R2 failure is a release-app bug, fixed in the app (not a candidate question) and TC-01 re-run.

## 15. Privacy and evidence handling
- **Committed (after review):** aggregated results only — per device class × candidate × config × case: counts, percentages, latencies, detection times, battery %/h, verdicts — as JSON + Markdown in the spike's `results/` folder (proposed, following the SP-03/SP-05 precedent), summarised in the future ADR-029 file.
- **Never committed:** coordinates (none are transmitted anyway), raw logcat, batterystats dumps, receiver row files, screenshots or screen recordings, device serials/IMEI, phone numbers, Wi-Fi names, account names, settings screenshots containing personal data.
- Raw files live in the session scratch directory and are deleted within 7 days after the aggregate is reviewed; the receiver data file is deleted at the end of each session.
- Synthetic sign-in numbers only for the release app (local recording OTP sink), as in the Phase-2 emulator smoke.

## 16. Founder time estimate (per device, estimate only)
| Block | Wall-clock | Founder active time |
|---|---|---|
| One-time device setup (§8.2) incl. OEM developer-option quirks | 30–45 min | 30–45 min |
| TC-01 (release app) | 25 min | 25 min |
| TC-02 + TC-03 (DEFAULT 60-min) | ~1 h 30 min | ~25 min |
| TC-04 (GUIDED 60-min) + optional STD-EXEMPT run | 1 h 10 min – 2 h 20 min | 10–20 min |
| TC-06 … TC-19 (short cases; TC-14 includes a 30-min run) | ~3 h 45 min | ~3 h 20 min |
| **Total per device** | **~7–9 h**, best split into 2–3 sessions | **~5–5.5 h** |
| **Three freeze devices** | **~21–26 h** over 1–2 weeks | **~15–17 h** |

The founder is needed for physical steps (settings, unplugging, revoking, airplane mode); the Claude Code session runs all host commands and the analysis. Optional synergy: a moving-device run (in a car) during an SP-04 field drive on a second phone, if the founder wants a moving-case data point; not required.

## 17. Android freeze evidence vs iOS release evidence
| | Android architectural freeze (Phase 3) | iOS release evidence (later, FA-13) |
|---|---|---|
| Purpose | decide ADR-029 / ADR-003 / ADR-033 parameters | prove iOS behaviour before serious iOS release/pilot validation (Phase 7) |
| Devices | Transsion + Xiaomi + Samsung/Vivo | one physical iPhone on iOS 26 |
| Build environment | Windows + JDK 17 (exists) | macOS or EAS build — **not approved** in any phase so far (ADR-036) → BLOCKED-EXTERNAL |
| Cases | TC-01…TC-21 above | When-In-Use first, Always upgrade only in go-online, `UIBackgroundModes: location`, background indicator, Always → While-Using downgrade detection (R4 item 7), app-kill behaviour, privacy-manifest entries |
| Effect on Phase 3 | blocks ADR-029/ADR-003 freeze | **does not block** the Android freeze; recorded as an open iOS release gate |

## 18. Open points recorded for review
- SP01-O1: the GUIDED-config interpretation of the ≥95 % rule (§7) is fixed before measurement with the FA-07 approval (2026-10-12); any change needs evidence and a reviewed ADR update, never post-measurement tuning.
- SP01-O2: FA-18 is DEFERRED to Phase 4; no push project exists, TC-22 is NOT RUN in Phase 3 and push-wake remains a Phase-4 item.
- SP01-O3: Xiaomi developer options may require a vendor account; a dedicated test account is the only acceptable route.
- SP01-O4: spike inputs in §5.3 are measurement settings, not product decisions; Phase 4 sets final values through ADR-029/ADR-033.
- SP01-O5: TC-01's release-build runtime check uses the FA-17 ephemeral vetted HTTPS tunnel (APPROVED IN PRINCIPLE, synthetic data only); if no acceptable free temporary option exists, that part stays BLOCKED (never a cleartext release build).
- SP01-O6: background-location experiments run only in this separate non-release spike build; the Phase-3 release app never requests background Driver location (FA-02 scope). If the FA-03 devices are not available by P3.10, ADR-029/ADR-003 stay unfrozen and the affected IDs are BLOCKED-EXTERNAL / PARTIAL; Phase 3 is not merged as complete without this evidence.
