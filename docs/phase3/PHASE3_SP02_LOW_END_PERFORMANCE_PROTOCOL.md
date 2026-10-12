# PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL — SP-02 low-end Android startup, size, memory, jank and data protocol (PROPOSED)
**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — pending founder/ChatGPT review; no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

SP-02 result today: **NOT RUN** (`docs/phase0/PHASE0_ADR_BACKLOG.md` §E). Release startup time and memory have never been measured on any device (ADR-043 "Not verified"). The only existing numbers are build-time sizes from ADR-043 (§5.3).

## 1. Purpose and the decisions it feeds
SP-02 proves or disproves that Rider-mode users on a representative low-end Android phone get acceptable startup, memory, smoothness and data use **while the Driver/Partner modules stay dormant** — on the real release artefact, on real hardware, against budgets fixed **before** testing.

| Decision / requirement | What SP-02 supplies |
|---|---|
| ADR-003 mobile stack freeze (with SP-01) | startup/memory/size PASS or FAIL on the reference device |
| future ADR-046 map rendering client architecture | per-candidate renderer cost (size, memory, jank, startup delta) for the size-constrained choice (F-P3-06) |
| future ADR-050 Phase-3 performance budgets | first measured values against the PROPOSED budgets (FA-07) |
| **V11** | startup/memory/size budgets; driver modules not evaluated at rider startup (F-P3-07) |
| **Q26** | mobile cold/warm start, map interaction, data usage, battery (rider, informational) |
| **Q27** | low-end device + constrained memory/storage/network as first-class targets |
| **L08** | Lite-mode data budget and text-first behaviour under a slow network |

## 2. What SP-02 is NOT
- Not an emulator benchmark: emulator runs may debug scripts; **an emulator result never closes SP-02** (backlog §E).
- Not a server load test; server latency budgets live in `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md` and are measured separately.
- Not background-location or driver battery (that is SP-01).
- Not iOS.
- Not a reason to add test hooks to the shipped app: release-safe signals only (§6, F-P3-07).

## 3. Budgets under test (copied from the Phase-3 budget set; PROPOSED, FA-07; fixed before R1)
These numbers are frozen for SP-02 at the moment the founder approves FA-07 and **before the first measurement**. They are not adjusted after seeing results; a change needs founder approval and the future ADR-050 update.

| ID | Metric | Budget (PROPOSED) |
|---|---|---|
| PB-01 | Cold start to Rider home interactive (signed in, cached session) | p50 ≤ 2.5 s, p90 ≤ 4.0 s |
| PB-02 | Cold start to sign-in screen (signed out) | p50 ≤ 2.0 s |
| PB-03 | Warm start | p50 ≤ 1.0 s, p90 ≤ 1.5 s |
| PB-04 | Play download size per ABI (bundletool get-size MAX) | arm64-v8a ≤ 30.0 MB hard; armeabi-v7a ≤ 29.0 MB; any single change adding > 1.5 MB needs written justification |
| PB-05 | Hermes JS bundle | ≤ 4.5 MB |
| PB-06 | Driver feature modules evaluated at rider startup | 0 |
| PB-07 | PSS, Rider home without map | ≤ 160 MB p90 |
| PB-08 | PSS, Rider route preview with map | ≤ 260 MB p90 |
| PB-09 | Memory growth over 10 repeated quote cycles | ≤ 10 % |
| PB-10 | Janky frames, scripted 10-s pan/zoom | ≤ 10 % |
| PB-11 | Pin move → address shown, 4G (600 ms debounce included) | p75 ≤ 1.5 s |
| PB-12 | Data per standard quote flow | Lite ≤ 150 KB; standard, cold tile cache ≤ 2.0 MB; standard, warm ≤ 600 KB |
| PB-13 | On-device map tile cache | capped at 50 MB |
| PB-14 | Rider home refresh behaviour | no periodic polling; no re-render per GPS sample |

1 MB = 1,000,000 bytes throughout (the ADR-043 convention).

## 4. Devices
| Role | Device class | Notes |
|---|---|---|
| **Reference** | Transsion-class Android Go, 3–4 GB RAM: Infinix Smart 10 **or** Tecno Spark 30C class (FA-04; may be the same unit as the SP-01 Transsion device) | the only device whose results decide PASS/FAIL |
| Alternate 1 | Redmi A5 / 14C class (HyperOS) | confirms results are not Transsion-specific; informational |
| Alternate 2 | Galaxy A06 class | informational |
| Never | emulator, flagship phone | debugging/comparison only |

Record per device (C, no serials): `adb shell getprop ro.product.manufacturer`, `ro.product.model`, `ro.build.version.release`, `ro.build.version.sdk`, `ro.build.display.id`, `ro.config.low_ram`, `ro.product.cpu.abilist`; MemTotal from `adb shell cat /proc/meminfo`; free storage from `adb shell df /data`.

## 5. Builds under test
### 5.1 Rounds
| Round | Build | Checkpoint | Measures |
|---|---|---|---|
| **R1a** | Phase-2 main release AAB (CI artefact of `main` @ `058fcea`, whose app tree is unchanged from the Phase-2 baseline, or a local `node scripts/android-build.mjs release` of that commit) | can run as soon as the reference device exists (before or at P3.6) | size, JS bundle, TTID (time to initial display) to the first screen, PSS at the first screen, static driver-module check; **no TTI** (the Phase-2 build has no fully-drawn marker) |
| **R1b** | Phase-3 shell release AAB **before any map renderer** (after P3.5: mode controller, rider text-first search→quote, Lite mode, fully-drawn marker) | P3.6 (baseline before maps) | all budgets except PB-08/PB-10/PB-13 and the map parts of PB-12 |
| **R2** | Phase-3 release AAB **after renderer integration** (P3.7) | P3.7 | everything, including map budgets; regression vs R1b |
| R2-candidates | one throwaway local build per renderer candidate (`@maplibre/maplibre-react-native`, `react-native-maps`, `@rnmapbox/maps`) on a local branch that is never pushed or merged | P3.7, before ADR-046 freeze, if feasible within the run | size delta (laptop only) for every candidate; startup/memory/jank on the reference device for the candidates that fit the size headroom |

Only the chosen renderer is merged. Candidate builds exist only to produce numbers; they are deleted afterwards.

### 5.2 Artefact and installation
- Release AAB from the CI artifact `android-build-<sha>` (retention 7 days; contains `build-reports/app-release.aab`) via `gh run download <run-id> -n android-build-<sha>`, or a local `node scripts/android-build.mjs release` (JDK 17 enforced, 16 KB + permission gates).
- The release AAB is **debug-key signed** (`scripts/android-build.mjs` header) — fine for measurement; it is never an upload artefact.
- Install the splits Play would serve to that device:
  - `java -jar "$BUNDLETOOL_JAR" build-apks --bundle=app-release.aab --output=wayvro-device.apks --connected-device --overwrite`
  - `java -jar "$BUNDLETOOL_JAR" install-apks --apks=wayvro-device.apks`
  - bundletool signs the generated APKs with the local debug keystore unless `--ks` is passed; uninstall first (`adb uninstall dev.wayvro.app`) when switching between differently signed builds (this also signs the test session out).
- Resolve the launch component once: `adb shell cmd package resolve-activity --brief dev.wayvro.app` (expected `dev.wayvro.app/.MainActivity` from Expo prebuild; use what the device reports). `dev.wayvro.app` is the technical development identifier (ADR-036), not a store identity.

### 5.3 Existing baseline numbers (build-time only, ADR-043 P2.8, 2026-10-11)
| Item | Value |
|---|---|
| Release AAB | 34,845,150 B |
| Download arm64-v8a (get-size MIN–MAX) | 25,467,632 – 25,651,727 B |
| Download armeabi-v7a | 24,725,524 – 24,909,619 B |
| JS bundle | 3,321,764 B |
| Device startup / memory | **NOT RUN** |

### 5.4 SP02-D1 — API reachability for signed-in measurements (founder action FA-17)
The release app accepts only an `https` API origin outside `__DEV__` (`apps/wayvro-mobile/src/core/config/api-config.ts`), and a build without `WAYVRO_API_URL` (the CI artefact) shows "service not configured". Signed-in Rider home (PB-01, PB-07, PB-09, PB-11, PB-12) therefore needs an HTTPS endpoint with a publicly trusted certificate that reaches a synthetic API. Options:

| Option | Description | Trade-off |
|---|---|---|
| D1-A | founder-approved **temporary HTTPS tunnel** to the local API runner (synthetic data, synthetic numbers, torn down after each session); a local release AAB built with `WAYVRO_API_URL` set to the tunnel origin | real internet path (representative latency); a new external service → founder approval; tunnel hostnames may change per session → rebuild |
| D1-B | wait for a staging-class host | no new service; PB-01 and data budgets stay **NOT RUN** until then → blocks ADR-003/ADR-050 freeze |
| D1-C | special measurement build that allows cleartext/LAN | **rejected**: it would be a test hook in a release-config build (F-P3-07) and changes network security behaviour |

Recommendation: D1-A for R1b/R2, decided by the founder as **FA-17** (`docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md`: a founder-approved temporary HTTPS-reachable synthetic API endpoint, e.g. a tunnel to the local API with synthetic data only, or a staging host). Without FA-17 the signed-in measurements (PB-01, PB-07, PB-09, PB-11, PB-12) are reported **NOT RUN**. Independent of D1, every round also measures the **unmodified CI artefact** (signed out / unconfigured screen) as a control.

## 6. Release-safe instrumentation Phase 3 must add (implementation detail to verify in P3.5)
### 6.1 "Rider home interactive" marker (TTI)
- **Definition:** the first frame in which the Rider home is rendered with its primary action ("Where to?") enabled and account state resolved (from network or cache — the path is recorded per run).
- **Signal:** Android `Activity.reportFullyDrawn()`, called exactly once per process at that moment. Android then logs `Fully drawn dev.wayvro.app/.MainActivity: +<time>` (tag `ActivityTaskManager`, older releases `ActivityManager`), measured from the same launch start as `am start -W` TotalTime. It is a standard production lifecycle signal (used by Android vitals and Macrobenchmark), not a test hook.
- **How (to verify):** (a) a tiny local Expo module (Kotlin, a few lines) exposing `reportFullyDrawn()` — a native change, so its size is measured; no third-party dependency; (b) check first whether React Native, Expo or react-native-screens already expose an equivalent; (c) alternative/complement: Perfetto app trace sections via `android.os.Trace` from the same module. The choice is recorded in P3.5; sign-in screen gets the same marker for PB-02.

### 6.2 Driver-module evaluation check (F-P3-07)
Metro release builds are one Hermes bundle; `import()` defers **evaluation**, not download. "Lazy driver modules" is therefore checked as evaluation:
- **Static (CI, every PR):** the existing architecture test (`apps/wayvro-mobile/src/architecture.test.ts`) already requires driver feature imports to go through `lazyScreen(`; Phase 3 extends it to the new `/drive/*` route directory (including `drive/_layout.tsx`) and mode controller, and adds a dependency-cruiser rule that no static import path from the app root or rider graph reaches `src/features/driver/**`.
- **Runtime (instrumented build, never shipped):** a separate build profile adds, at bundle time, a marker call at the top of each driver feature module (dev/CI-only transform). It runs on the emulator nightly (SP-08 tier) and once per round on the reference device. Result = number of driver feature modules evaluated before the fully-drawn marker (PB-06 expects 0) and total modules evaluated (informational). The ART-ISO artefact-isolation script (`scripts/artifact-isolation.mjs`) is extended so the release bundle is proven free of the marker.

## 7. Session control (before every measurement set)
| Step | Who | Command / action |
|---|---|---|
| Reboot at session start, then wait 2 min for boot activity to settle | C | `adb reboot`; `adb wait-for-device`; poll `adb shell getprop sys.boot_completed` until `1` |
| Close other apps; no downloads/updates running; Play Store auto-update paused for the session if the device has it | F | — |
| Battery ≥ 50 %, USB connected for startup/memory sets (consistent power state); unplugged only for the battery set | F | — |
| Thermal state normal | C | `adb shell dumpsys thermalservice` (record status; wait if above normal) |
| Animation scales at device default (do not disable — they are part of real UX); record values | C | `adb shell settings get global animator_duration_scale` (and transition/window scales) |
| Screen timeout long enough for the set (record and restore the original value) | C | `adb shell settings get system screen_off_timeout`, then `put` and later restore |
| Network profile set (§9) | F/C | — |

## 8. Measurement procedures (exact commands)
### M-01 Cold start — TTID and TTI (PB-01, PB-02)
For each of 6 launches (first discarded):
1. `adb shell am force-stop dev.wayvro.app`
2. wait 10 s (host)
3. `adb logcat -c`
4. `adb shell am start -W -n dev.wayvro.app/.MainActivity` → record `LaunchState` (must be `COLD`), `TotalTime`, `WaitTime`
5. wait 15 s; `adb logcat -d -s ActivityTaskManager:I ActivityManager:I` → record the `Fully drawn` time (R1b/R2 only)

Run the set signed in (PB-01) and signed out (PB-02, after `adb shell pm clear dev.wayvro.app`, then sign in again for the next set). Additionally record **one first launch after reboot** separately (informational: coldest page cache). Root is not available, so page caches cannot be dropped; force-stop launches are "cold process" starts, as Android defines them.

### M-02 Warm start (PB-03)
1. ensure the app is on Rider home; `adb shell input keyevent KEYCODE_HOME`; wait 5 s
2. `adb shell am start -W -n dev.wayvro.app/.MainActivity` → `LaunchState` (`HOT` or `WARM` — record which), `TotalTime`
Repeat 6×, discard first.

### M-03 Perfetto startup trace (diagnosis, one per round and per network profile)
- `adb shell perfetto --background -o /data/misc/perfetto-traces/wayvro-startup.pftrace -t 20s -b 64mb sched freq idle am wm gfx view dalvik binder_driver -a dev.wayvro.app`
- then M-01 steps 1 and 4; after 20 s `adb pull /data/misc/perfetto-traces/wayvro-startup.pftrace`
- On Android 9–10 tracing may need `adb shell setprop persist.traced.enable 1` first. Analyse locally (Perfetto UI processes the trace in the browser; the optional trace processor `android_startup` metric gives a phase breakdown: process start, bind application, activity start, Hermes load, first frame, fully drawn). Traces contain other process names: **never committed**.

### M-04 Memory (PB-07, PB-08, PB-09)
- At each screen — sign-in, Rider home (no map), search, route preview/quote (R2 with map), Driver home shell (informational) — wait 5 s after the screen settles, then `adb shell dumpsys meminfo dev.wayvro.app`; record `TOTAL PSS` plus Java heap, Native heap, Graphics, Code rows.
- 5 cold sessions → p90 per screen.
- PB-09: from Rider home run 10 quote cycles (search → quote → back), reading PSS after cycle 1 and cycle 10; growth = (PSS10 − PSS1) ÷ PSS1.
- Pressure probe (informational): `adb shell am send-trim-memory dev.wayvro.app RUNNING_LOW` and `RUNNING_CRITICAL` while foreground; record PSS after and any crash.

### M-05 Download size (PB-04) — laptop only, CI-enforceable
- `java -jar "$BUNDLETOOL_JAR" build-apks --bundle=app-release.aab --output=size.apks --overwrite`
- `java -jar "$BUNDLETOOL_JAR" get-size total --apks=size.apks --dimensions=ABI` → CSV `ABI,MIN,MAX`; the budget uses **MAX**.

### M-06 JS bundle (PB-05) — laptop only, CI-enforceable
- List the AAB entries and read the size of the Hermes bundle asset (expected `base/assets/index.android.bundle`; confirm the entry name on the first run), e.g. `unzip -l app-release.aab`.

### M-07 Driver-module evaluation (PB-06)
- Static: CI result of the extended architecture test / dependency-cruiser rule (§6.2).
- Runtime: install the instrumented build (never the release artefact), cold start ×3 to Rider home, read the counter it logs under its own tag (`adb logcat -d -s WayvroPerf:*`). Expected 0 driver modules before the fully-drawn marker.

### M-08 Map jank (PB-10, R2)
- `adb shell dumpsys gfxinfo dev.wayvro.app reset`
- scripted 10-s pan sequence: e.g. 10 × `adb shell input swipe <x1> <y1> <x2> <y2> 300` across the map area, plus zoom via double-tap where the renderer supports it (`adb shell input` cannot pinch; a multi-touch script through Maestro or UIAutomator is an option to verify)
- `adb shell dumpsys gfxinfo dev.wayvro.app` → `Total frames rendered`, `Janky frames` (%), frame-time percentiles
- Caveat to verify per renderer: map engines that draw into their own SurfaceView/TextureView may not be fully represented in gfxinfo; for those, use the Perfetto FrameTimeline data source (Android 12+) and record which method produced the number.
- Pan in a public area of the map (a well-known landmark region), not around a private address.

### M-09 Pin move → address (PB-11, R2, 4G profile)
- enable touch visualisation: `adb shell settings put system show_touches 1` (restore after)
- `adb shell screenrecord --bit-rate 8000000 /sdcard/wayvro-pin.mp4` (max 180 s); F moves the pin 10 times in a public landmark area; `adb pull` the file
- frame-step the video: time from the finger-lift frame to the frame where the address text changes (resolution ±1 frame); p75 over 10 moves
- delete the video from device and laptop after measurement; never commit it.

### M-10 Network data per flow (PB-12)
- uid: `adb shell cmd package list packages -U dev.wayvro.app`
- snapshot before: `adb shell dumpsys netstats detail` (save to scratch); flush counters first if the device supports `adb shell dumpsys netstats --poll` (verify on the device; otherwise wait ≥ 60 s)
- run the scripted standard quote flow: open → where-to → 2 searches (about 8 debounced keystroke requests, min 3 chars) → quote → back
- snapshot after; sum `rb` + `tb` for the uid across all entries and diff
- variants: Lite mode; standard with **cold** tile cache (after `adb shell pm clear dev.wayvro.app` + sign-in; sign-in bytes measured separately and excluded); standard **warm** (immediate repeat)
- cross-check: Settings → Apps → Wayvro → Mobile data / Wi-Fi usage (coarse)
- Release apps do not trust user CAs, so traffic interception is neither possible nor wanted; counters are the method.

### M-11 Tile cache cap (PB-13, R2)
- after 20 min of map use across zoom levels: `adb shell dumpsys diskstats` (app cache size list) or Settings → Apps → Wayvro → Storage → Cache; record bytes. Verify the cap is set in renderer configuration (code review) and observed ≤ 50 MB.

### M-12 Polling/refresh check (PB-14)
- with Rider home open and idle for 5 min: M-10 counter diff (expect ≈ 0 bytes beyond any documented config fetch) and Perfetto trace showing no periodic JS work/re-render.

### M-13 Constrained storage (Q27)
- `adb shell df /data`; create a filler leaving < 1 GB free: `adb shell dd if=/dev/zero of=/sdcard/Download/wayvro-sp02-filler.bin bs=1048576 count=<N>`
- M-01 ×5 + one quote flow; record behaviour (errors, crashes, OS low-storage warnings)
- remove immediately: `adb shell rm /sdcard/Download/wayvro-sp02-filler.bin`; confirm free space restored. Never fill to zero.

### M-14 Constrained memory (Q27)
- F opens 5 preinstalled apps (camera, browser with 3 tabs, gallery, settings, store), then opens Wayvro → M-01 TotalTime/Fully drawn ×3 (informational; LaunchState may be COLD because the process was evicted)
- process-death restore: background Wayvro during a quote, `adb shell am kill dev.wayvro.app`, reopen → pending quote group restored or "prices updated" shown (cross-checks SP-08).

### M-15 Rider battery (informational, Q26)
- `adb shell dumpsys batterystats --reset`; unplug; 15 min idle on Rider home screen-on + 10 quote cycles; reconnect
- `adb shell dumpsys battery` (level) and `adb shell dumpsys batterystats --charged dev.wayvro.app` (model-based estimate; OEM power profile accuracy varies)

## 9. Network profiles
| Profile | How | Used for |
|---|---|---|
| N0 Wi-Fi unthrottled | home Wi-Fi | control |
| N1 real 4G | SIM data, Wi-Fi off; record network type shown in the status bar (no cell ids) | PB-11, PB-12, informational startup |
| **N2 3G-like** | downlink limited to about 1 Mbps: Developer options "Network download rate limit" (Android 13+, presence varies by OEM — verify) or a router per-device bandwidth limit; uplink and RTT are not controllable this way (limitation recorded) | **PB-01 budget condition** (backlog: "under 3G throttle"), PB-12 Lite |
| N3 airplane mode | — | startup to the offline state (informational): time to the offline/retry screen |
| Emulator shaping | `adb emu network speed umts` / `adb emu network delay umts` on an emulator only | comparison only; **never closes SP-02** |

## 10. Data capture sheet (one row per measurement)
| Column | Content |
|---|---|
| `round` | R1a / R1b / R2 / R2-<renderer> |
| `build_sha`, `artefact` | commit, CI run id or local build |
| `device_role`, `model_class`, `android_release`, `api_level`, `low_ram`, `ram_total_gb` | §4 (no serials) |
| `metric_id` | PB-xx / M-xx |
| `network_profile` | N0–N3 |
| `session_state` | SIGNED_IN / SIGNED_OUT / UNCONFIGURED |
| `run_index`, `discarded` | 0..5, first run discarded |
| `launch_state`, `total_time_ms`, `wait_time_ms`, `fully_drawn_ms`, `tti_path` | M-01/M-02 (`tti_path` = CACHE / NETWORK) |
| `screen`, `pss_kb`, `java_heap_kb`, `native_heap_kb`, `graphics_kb` | M-04 |
| `download_min_b`, `download_max_b`, `js_bundle_b` | M-05/M-06 |
| `driver_modules_evaluated`, `modules_evaluated_total` | M-07 |
| `frames_total`, `janky_pct`, `jank_method` | M-08 (GFXINFO / FRAMETIMELINE) |
| `pin_to_address_ms` | M-09 |
| `bytes_rx`, `bytes_tx`, `flow_variant` | M-10 (LITE / STD_COLD / STD_WARM) |
| `thermal_status`, `free_storage_mb` | session control |
| `result` | PASS / FAIL / NOT RUN / BLOCKED / SKIPPED |
| `notes` | free text, no personal data |

## 11. Statistics
- Startup: 6 launches per set, **first discarded**, 5 kept. Median = 3rd of 5 sorted values. p90 by nearest rank = ⌈0.9 × 5⌉ = 5th value, i.e. the **maximum** of the kept runs — stated explicitly so nobody reads p90-of-5 as more than it is. Report min, max and coefficient of variation.
- If CV > 20 % or one run > 1.5 × median, repeat the whole set once and report **both** sets; never drop individual runs selectively. Optionally extend to 10 kept runs (p90 = 9th value) when time allows.
- Memory: p90 (nearest rank) across 5 cold sessions per screen.
- Jank: per 10-s script, 3 repetitions, report the median and worst.
- Pin → address: p75 over 10 moves.
- Data: median of 3 flow repetitions per variant.

## 12. Pass/fail and regression rules
- A metric is **PASS** only when measured on the **reference device** in the stated profile and every stated statistic is within budget; otherwise **FAIL**. No device → **BLOCKED**; not yet measured → **NOT RUN**. Alternate-device results are informational.
- SP-02 overall PASS = PB-01…PB-07, PB-09, PB-12 (Lite) PASS at R1b **and** all PB-01…PB-14 PASS at R2.
- **Regression rule (R2 vs R1b and every later release round):** any startup p50 increase > 15 % or any PSS p90 increase > 15 % at the same screen requires a written analysis even when within budget; any single change adding > 1.5 MB download (PB-04) requires written justification before merge; any budget breach is FAIL and blocks the freeze checkpoint until fixed or until the founder approves a budget change via the future ADR-050 update.
- Renderer selection (ADR-046): a candidate whose measured per-ABI download delta exceeds the remaining headroom after the other Phase-3 additions (`docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md` §4) fails PB-04 unless the founder approves a budget change.
- Failure path (backlog): module restructuring / dependency reduction first → ADR-003 review if the RN/Expo stack itself cannot meet PB-01/PB-07.

## 13. Evidence to commit
- **Committed (after review):** per round, an aggregated Markdown summary and a JSON file of the data-sheet rows above, in a proposed docs/phase3/evidence/sp-02/ directory (one file pair per round), referenced from the future ADR-050 and ADR-046 files.
- **Never committed:** Perfetto traces, screen recordings, raw `dumpsys`/logcat output, netstats dumps, device serials, synthetic phone numbers, tunnel URLs, screenshots containing map areas around private addresses.
- Raw files stay in the session scratch directory and are deleted within 7 days after review.

## 14. Founder step-by-step and time estimate (estimates only)
| Step | Who | Time |
|---|---|---|
| Device setup (developer options, USB debugging, RSA prompt) — shared with SP-01 §8.2 if the same unit | F + C | 20–30 min |
| SP02-D1 decision (FA-17: tunnel/staging or wait) | F | — |
| R1a: install CI artefact, M-01 (unconfigured/signed-out), M-04 at first screen; laptop: M-05/M-06/static M-07 | F (presence) + C | ~1 h |
| R1b: sign in (synthetic number), M-01 N0+N2, M-02, M-03, M-04, M-07 runtime, M-10 Lite/standard, M-12, M-13, M-14, M-15 | F + C | ~3–3.5 h |
| R2 (chosen renderer): R1b set + M-08, M-09 (N1, needs a 4G location), M-10 cold/warm tiles, M-11 | F + C | ~3–4 h |
| R2-candidates (per extra renderer fitting the size headroom): M-01, M-04, M-08 | F + C | ~1.5 h each |
| **Total** | | **~7.5–9 h** for setup + R1a + R1b + R2, plus ~1.5 h per extra candidate |

Founder physical steps: plug/unplug, tapping through scripted flows where adb cannot (sign-in, pin moves, multi-app pressure), switching Wi-Fi/SIM profiles, setting the download rate limit. The Claude Code session runs every command, collects numbers and writes the aggregate.

## 15. Open points recorded for review
- SP02-D1 (API reachability) — founder action FA-17; without D1-A or a staging host, PB-01, PB-07, PB-09, PB-11 and PB-12 stay NOT RUN.
- The fully-drawn marker mechanism (§6.1) and the instrumented-build transform (§6.2) are implementation details to verify in P3.5; both must pass ART-ISO.
- On-device throttling availability (N2) varies by OEM; the router fallback may be needed.
- gfxinfo coverage of map surfaces is renderer-dependent (M-08 caveat).
