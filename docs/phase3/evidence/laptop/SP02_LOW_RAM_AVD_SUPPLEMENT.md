# SP02_LOW_RAM_AVD_SUPPLEMENT — SP-02 metrics on a constrained API 35 emulator (supplementary)

**Date:** 2026-10-17 · **Branch:** `phase-3/maps-quotes-unified-ux` (HEAD `ef3cbd0` + uncommitted work) · **Agent:** Claude Code
(self-audit, not independent verification).

> **EMULATOR SUPPLEMENTARY — DOES NOT CLOSE SP-02 REAL-DEVICE GATE.** Classification: `LOCAL_EMULATOR_SUPPLEMENTARY`.
> Every number below comes from an x86_64 Android emulator with software rendering on an overloaded 4-core laptop. None
> is device evidence. The protocol says an emulator result never closes SP-02
> (`docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md` §2, §12). SP-02 stays **NOT RUN** on the reference device
> (FA-04), and no budget below is reported as PASS. Where the emulator already exceeds a budget, this file calls it an
> engineering finding to explain. It is not a device FAIL.

## 1. What was measured and how

| Item | Value |
|---|---|
| Artefact | `evidence-local/apk/wayvro-e2e.apk`. This is the CI-built **E2E/instrumented** release-mode APK for this head: x86_64, embedded Hermes, API origin `http://10.0.2.2:4120`. Its `e2e-build-report.json` result is PASS. It is **not** the release AAB. It carries the SP-02 §6.2 `WayvroPerf` probe and the E2E network config. |
| Backend | `tests/e2e-mobile/mobile-stack.mjs` on a throwaway DB `wayvro_e2e_laptop2` with synthetic accounts, synthetic catalog and rate cards, and synthetic geo doubles. The API ran on the same laptop. There is no real network path, no tunnel and no TLS (SP02-D1 does not apply to this build). |
| Host | Windows 11, 4 cores, 16 GB RAM, heavily loaded (Docker Desktop, PostgreSQL/Valkey/S3/ClamAV containers, the API, the worker and Maestro all ran at once). About 0.7–4 GB of host RAM was free during the runs. |
| AVD `wayvro-sp02-api35-2g` | `system-images;android-35;google_apis;x86_64` (`sdk_gphone64_x86_64`, Android 15, build `AE3A.240806.043`, userdebug). `hw.ramSize=2048M` with `-memory 2048`; the guest reports `MemTotal 2,532,420 kB` (recorded as observed). `hw.cpu.ncore=2`, `-cores 2`. 720×1600 at 320 dpi (low-end-like panel instead of the Pixel 6 default). `-gpu swiftshader_indirect` (software rendering). `-no-snapshot` (cold boot), `ro.config.low_ram` unset, Play Store off, 6 GB data partition. |
| AVD `wayvro-sp02-api35-3g` | Created with the same config and 3072 MB. **Not measured**: the time-box ran out (§6). |
| Session control | The emulator was cold booted, then waited on `sys.boot_completed=1`. Thermal status was 0. Animation scales stayed at the image defaults (`transition`/`window` 1.0, `animator` unset = 1.0), because run-flows' 0-scale setting was not used for these sets. Font scale was 1.0. |
| Scripts (local, not committed) | `evidence-local/laptop2/sp02/scripts/sp02-lib.sh`, `sp02-run.sh`, `stats.mjs`, plus the Maestro helpers under `evidence-local/laptop2/flows/`. Raw logcat, meminfo and netstats files are in `evidence-local/laptop2/sp02/api35-2g/` and are not committed (protocol §13). |

**Cold start (M-01).** Each sample:

1. `am force-stop dev.wayvro.app`
2. wait 10 s
3. `logcat -c`
4. `am start -W -n dev.wayvro.app/.MainActivity`: read `LaunchState` (all `COLD`), `TotalTime` and `WaitTime`
5. wait 15 s
6. read `Fully drawn dev.wayvro.app/.MainActivity: +…` (`ActivityTaskManager`) and the last `WayvroPerf eval n=… d=… driver=…` line before it (PB-06)
7. read `dumpsys meminfo` (TOTAL PSS/RSS) and the app process count

The first sample of each set is discarded (protocol §11). Percentiles use the nearest rank over the kept samples.

**Warm start (M-02).** The app is on its home screen. Send `KEYCODE_HOME`, wait 5 s, then run `am start -W`.

**Memory (M-04).** `dumpsys meminfo` is read 5 s after each screen settles. Each screen is read after a fresh cold start.

**Data (M-10).** `dumpsys netstats` `mAppUidStatsMap` rx+tx for the app UID, taken before and after the scripted quote flow.

## 2. Sizes (PB-04, PB-05) — artefact facts, not emulator timings

| Item | Value | Budget | Note |
|---|---|---|---|
| E2E APK (x86_64 only, instrumented) | 42,612,913 B | — (PB-04 is per-ABI Play download of the release AAB) | `e2e-build-report.json` |
| Hermes bundle in the E2E APK (`assets/index.android.bundle`, stored) | 3,717,196 B | PB-05 ≤ 4,500,000 B | includes the `WayvroPerf` probe; the release bundle has no probe |
| Native libraries in the E2E APK (`lib/x86_64`, 20 files, stored) | 17,853,912 B | — | largest: `libreactnative.so` 7,098,048 B; `libhermesvm.so` 2,591,976 B; `libexpo-modules-core.so` 1,419,792 B; `libc++_shared.so` 1,252,080 B; `libreact_codegen_rnscreens.so` 1,225,728 B |
| DEX in the E2E APK | 49,115,892 B uncompressed / 17,624,480 B compressed | — | E2E variant |
| Release AAB of `4347289` (CI, quoted from `PHASE3_IMPLEMENTATION_RECORD.md`) | arm64-v8a 26,131,920 B; armeabi-v7a 25,388,836 B; Hermes 3,687,008 B | 30,000,000 / 29,000,000 / 4,500,000 | CI gates CG-01/CG-02. This head's release AAB was **not rebuilt** here. |
| Founder preview APK (`wayvro-phase3-preview-arm64.apk`, debug dev client, arm64-v8a + x86_64) | 125,415,870 B | not applicable (debug dev client, JS from Metro) | §5 |

## 3. Startup and memory on `wayvro-sp02-api35-2g` (EMULATOR SUPPLEMENTARY — DOES NOT CLOSE SP-02 REAL-DEVICE GATE)

Nearest-rank percentiles; the first sample of each set discarded. "First frame" = `am start -W` `TotalTime`; "fully drawn" = the `reportFullyDrawn` marker (Rider home interactive, or the sign-in screen when signed out).

| Metric | n | p50 | p90 | p95 | max | Budget (REF-DEV) | On this emulator |
|---|---:|---:|---:|---:|---:|---|---|
| Cold start, signed out — first frame (M-01) | 20 | 1,497 ms | 2,244 ms | 2,479 ms | 2,540 ms | — | — |
| Cold start, signed out — fully drawn, sign-in screen (PB-02) | 20 | 3,093 ms | 4,529 ms | 6,027 ms | 6,377 ms | p50 ≤ 2.0 s | **exceeded** (finding SP02-F1) |
| Cold start, signed in — first frame (M-01) | 20 | 2,686 ms | 4,904 ms | 5,006 ms | 5,251 ms | — | — |
| Cold start, signed in — fully drawn, Rider home (PB-01) | 20 | 7,102 ms | 10,926 ms | 10,990 ms | 19,653 ms | p50 ≤ 2.5 s, p90 ≤ 4.0 s | **exceeded** (finding SP02-F1) |
| Warm start (PB-03), `LaunchState` HOT 20/20 | 20 | 329 ms | 559 ms | 587 ms | 826 ms | p50 ≤ 1.0 s, p90 ≤ 1.5 s | within |
| Driver modules evaluated before fully drawn (PB-06) | 40 | 0 | 0 | 0 | 0 | 0 | met (also enforced statically and in the CI full matrix) |
| TOTAL PSS at fully drawn, Rider home (PB-07) | 20 | 126,845 kB | 136,064 kB | 136,211 kB | 136,752 kB | ≤ 160 MB p90 | within (132.9 MiB p90) |
| TOTAL PSS at fully drawn, signed out | 20 | 126,121 kB | 126,936 kB | 133,808 kB | 134,269 kB | — | — |
| TOTAL RSS at fully drawn, Rider home | 20 | 249,264 kB | 258,352 kB | 258,412 kB | 259,032 kB | — | — |
| App processes | 40 | 1 | 1 | 1 | 1 | — | one process; no driver-only service started |

Raw: `cold-signedout-kept.csv` (sets `signedout` runs 1–13 and `signedout-b` runs 14–20, both after a discarded first sample), `cold-signedin.csv`, `warm.csv`, `raw/*.logcat.txt`.

### Finding SP02-F1 — signed-in cold start far above PB-01 on the constrained AVD (engineering finding, not fixed)

A per-sample logcat timeline (e.g. `raw/cold-signedin-5.logcat.txt`) splits the 8.0 s fully-drawn time as:

| Interval | Time | Present when signed out? | Interpretation |
|---|---:|---|---|
| process start → first frame (`Displayed`) | 2.2 s | yes (2.0 s) | native/RN start on 2 software-rendered vCPUs, host CPU at 100 % |
| first frame → `Running "main"` | 2.1 s | yes (1.0 s) | Hermes bundle load + native-module init |
| module evaluation up to `EntryRedirect` | 0.9 s | partly | 57 modules |
| **wait after `EntryRedirect` until the Rider home module graph** | **2.0 s** | **no** | the signed-in entry waits for the account state and the app policy (server-authoritative restoration, by design) from the local API on the same saturated host |
| Rider home graph → fully drawn | 0.6 s | — | 12 modules + first render |

A code read adds one avoidable cost: the access token lives 15 minutes (`SESSION_ACCESS_TTL_SECONDS` 900) and `SessionManager` restores `signed-in` from storage without checking `accessTokenExpiresAt`, so the first authenticated call after more than 15 minutes idle (the common real-world cold start) is `401 → token refresh → retry`: three sequential round trips before the account state arrives. The signed-in set ran for more than 15 minutes, which matches its long tail (max 19.7 s).

**Not fixed in this sweep.** The emulator numbers are dominated by host saturation (software GPU, 2 vCPUs, the API co-located on a host at 100 % CPU), so they cannot prove how much a change would gain on a phone, and the session/refresh code is a security-sensitive path. Recommended for the Phase-3/4 performance round, with a test: refresh proactively at restore when the stored access token is already past its expiry (server-issued expiry; a wrong device clock only costs one spare refresh or falls back to today's 401 path; the server stays authoritative), and confirm that the account and app-policy requests are issued in parallel (not verified in this sweep). PB-01/PB-02 must be measured on the reference device (FA-04) before any conclusion; this file does not report them as FAIL or PASS.

## 4. Other items

| Item | Result |
|---|---|
| Data, scripted Rider walk (PB-12a input) | **27,516 B** for the app UID (rx 19,476 + tx 8,040; `dumpsys netstats` before/after; UID 10212) over a whole walk: sign-in with OTP, Rider home, search, quote options, fare breakdown, account hub and security activity — a superset of the standard quote flow, standard (not Lite) mode, no map tiles exist in Phase 3. Below the PB-12a 150 KB Lite budget on the emulator; netstats buckets can lag, so treat it as indicative. |
| Lite mode behaviour | **NOT RUN** on the AVD (time-box). Lite logic is covered by unit tests and the CI E2E flows. |
| Low-memory / background kill recovery | **NOT RUN** as a timed measurement (time-box). Kill/restore correctness is covered by the CI flows pr-02/pr-11 (restore) and n-flows. |
| Memory growth over 10 quote cycles (PB-09) | **NOT RUN** (time-box). |
| 3 GB comparison AVD `wayvro-sp02-api35-3g` | created, **NOT RUN** (time-box). |
| Founder preview APK installability | **PASS (emulator)**: `adb install` of the debug dev client succeeded on the x86_64 AVD and it opened at `DevLauncherActivity` (`evidence-local/laptop2/logs/preview-install.log`; SHA-256 checked before install; same application id, so the E2E APK was reinstalled for the measurements). Not performance evidence. |

## 5. SP02-F1 instrumented root cause (2026-10-17 correction) — EMULATOR SUPPLEMENTARY

**Method.** Same 2 GB / 2-core API-35 AVD and release-mode instrumented E2E APK. A local copy of the synthetic stack with the API request log at `info` (`evidence-local/fix/stack/`, not committed) gives each request's route, status, server time and completion time. The device logcat (`-v epoch`) gives process start, first frame (`Displayed`), JS start (`Running "main"`), module evaluation (`WayvroPerf eval`) and `Fully drawn`. Both share the host clock, so each sample is one timeline. There are no new hooks in app code. Scripts and raw samples are in `evidence-local/fix/sp02/`. The host was less loaded than in §3, so absolute numbers are lower than in §3. The cohorts ran one after another on the same AVD.

| Cohort (kept samples) | first frame p50 | JS start p50 | entry module p50 | Rider home module p50 | fully drawn p50 / p90 | requests on the critical path |
|---|---:|---:|---:|---:|---:|---|
| A signed out (11) | 909 ms | 1,719 ms | 1,891 ms | 1,909 ms | **2,039 / 2,687 ms** | `GET /v1/app/config` (304, 7 ms) |
| B signed in, fresh token (11) | 962 ms | 1,766 ms | 1,989 ms | 2,849 ms | **2,970 / 3,290 ms** | `GET /v1/account/state` (37 ms) and `GET /v1/app/config` **in parallel** (start ≈ 2.27 s) |
| D signed in, after `am kill` in the background (9) | 857 ms | 1,671 ms | 1,850 ms | 2,699 ms | **2,767 / 3,559 ms** | as B |
| C signed in, access token already expired (9; local stack with `SESSION_ACCESS_TTL_SECONDS=60`, 65 s between samples) | 757 ms | 1,396 ms | 1,673 ms | 2,540 ms | **2,671 / 3,059 ms** | `GET /v1/account/state` **401** → `POST /v1/auth/token-refreshes` → `GET /v1/account/state` 200 on every sample |

**Findings:**
1. The 7.1 s p50 of §3 was dominated by host saturation. On this run the signed-in cold start is 2.97 s p50 / 3.29 s p90 (PB-01 is p50 ≤ 2.5 s, p90 ≤ 4.0 s on the reference device).
2. **No serial request chain exists with a fresh token.** The account state and the app policy are already requested in parallel, and the server answers in 3–60 ms.
3. About 1.7–1.8 s passes before JS starts. That is native, React Native and Hermes bootstrap on two software-rendered vCPUs, and only a reference device can measure it.
4. About 0.5 s passes between the account response and the Rider home module graph: response handling, validation, routing and first render.
5. **App-owned inefficiency (fixed).** In cohort C every cold start first sent a request that could only answer 401. Within one sample (`C-expired/3`), the account state took about 740 ms from first request to final answer, against about 40 ms with a fresh token. About 540 ms of it is the refresh's persisted-idempotency-key write to secure storage before the refresh request. That write is replay protection and stays.

**Fix (safe; security invariants unchanged).** `SessionManager.refreshDueAtFirstUse(now)` is true at most **once per process**, when the stored access token's server-issued `accessTokenExpiresAt` has already passed. The first authenticated call then refreshes **before** sending, through the unchanged single-flight `refreshAfterUnauthorized` path, which uses the same persisted idempotency key, rotation and wipe on refusal. The clock is the device clock plus the learnt server offset, and it is only a hint. A wrong clock costs at most one spare refresh per process or falls back to today's 401 path. The access-token TTL (900 s), idle/absolute lifetimes, refresh replay protection, token storage and every server check are unchanged. No stale account state is accepted, and no capability is pre-authorised. Tests are in `apps/wayvro-mobile/src/core/api/wayvro-client.test.ts`: early refresh before the request, at most once per process, no refresh for a valid token, and a refused early refresh ends the session.

**After the fix (cohort C again, same 60 s TTL stack, 9 kept samples):** `POST /v1/auth/token-refreshes` 200 then `GET /v1/account/state` 200 on **every** sample, with **0** 401 answers (before: 9 of 9 started with a 401). The doomed request is gone. This run overlapped a Gradle build on the same host, so its absolute times (fully drawn p50 8.3 s) are not comparable and are not reported as an improvement; the evidence is the request sequence (`evidence-local/fix/sp02/C-expired-fixed/`).

**Status.** `SP02-F1 = REAL_DEVICE_REQUIRED / EMULATOR SUPPLEMENTARY`. The remaining startup time is bootstrap and render cost that only FA-04's reference device can measure. PB-01 and PB-02 are reported neither as PASS nor as FAIL.

**Previously omitted laptop checks:** the 3 GB AVD comparison, Lite-mode cold/warm and quote-cycle memory growth (PB-09) are still **NOT RUN** in this correction (time). The cohort work above took priority.
