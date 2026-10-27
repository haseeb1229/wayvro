# SP-02 on a Samsung Galaxy A30 — informational alternate-device runs and artefact readiness

> **INFORMATIONAL — DOES NOT CLOSE SP-02 / FA-04.** The Galaxy A30 (Android 10, 3.6 GB) is not the FA-04 reference class
> (Transsion Android Go, 3–4 GB). Protocol §4/§12: every number below is informational, never a budget PASS or FAIL.
> SP-02 still needs the reference device, and its signed-in sets (PB-01, PB-03, PB-06 runtime, PB-07 at Rider home, PB-09)
> also need the FA-17 HTTPS session.

- **Date:** 2026-10-27. **Branch:** `phase-3/maps-quotes-unified-ux`; code = `af5d8e2`.
- **Harness:** the 2026-10-27 fail-closed SP-02 harness (local and git-ignored, under `evidence-local/sp02-device/`):
  - an explicit device kind and exact serial for every command;
  - FA-07 limits fixed in code (PB-07 = 160 MB = 156,250 KiB);
  - any unparseable launch makes a set INCOMPLETE rather than being dropped;
  - parser self-tests 67/67 and device self-tests 14/14 PASS.

  The 2026-10-18 legacy scripts (automatic device pick, a PB-07 limit 4.9 % too lenient, a meminfo row-parsing defect)
  were not used for the numbers below.
- **Conditions:** the same phone as `SP01_SAMSUNG_A30.md`. ADB over Wi-Fi with the phone on battery, after the harness
  waited out a thermal LIGHT state (status 0 at the start of each set). Unconfigured release builds, so the first screen
  is "Service not configured"; no network profile applies (N0).

## 1. Artefacts

| Round | Commit | Artefact | Notes |
|---|---|---|---|
| R1a (Phase-2 baseline) | `058fcea` | release AAB rebuilt locally (the CI artefact had expired after 7 days), sha256 `c0c7aec9…1419063`, 34,879,394 B | Clean detached worktree, frozen lockfile, JDK 17, bundletool 1.18.3 (checksum matches CI), `WAYVRO_API_URL` unset. That commit's gates: 16 KB PASS, permissions PASS. |
| R1b (pre-renderer closure code) | `af5d8e2` | CI release AAB, sha256 `279acf1d…daf2` | Probe-free; contains `WayvroFullyDrawn` and the once-per-process early token refresh (SP02-F1); no map renderer. |
| PB-06 instrumented | `af5d8e2` | **NON-SHIPPING** arm64-v8a APK, sha256 `2ab777b6…e9b3d` | Built with a placeholder HTTPS origin for readiness. 14/14 static checks PASS: probe present, Hermes bytecode, HTTPS origin is the argument, no loopback E2E port, no dev local API, no cleartext, no network-security config, no dev-client scheme or launcher, release permission set, fully-drawn module present, no map renderer, arm64 only. The runtime PB-06 measurement needs a rebuild against the FA-17 session origin and a signed-in run. |

Laptop size metrics (M-05/M-06, informational until the reference run; 1 MB = 1,000,000 B):

| Metric | R1a `058fcea` | R1b `af5d8e2` | FA-07 limit |
|---|---|---|---|
| PB-04 download, arm64-v8a (get-size max, all dimensions) | 25,685,197 B | 26,150,904 B | ≤ 30,000,000 B |
| PB-04 download, armeabi-v7a | 24,943,048 B | 25,407,745 B | ≤ 29,000,000 B |
| PB-05 Hermes bundle (uncompressed) | 3,406,464 B | 3,688,896 B | ≤ 4,500,000 B |

## 2. A30 control sets (6 cold launches, first discarded, §11 statistics)

| Metric | R1a `058fcea` | R1b `af5d8e2` |
|---|---|---|
| Launch state | COLD ×6 | COLD ×6 |
| `am start` TotalTime p50 / p90 (n = 5) | 474 / 508 ms (CV 3.3 %) | 476 / 642 ms (CV 15.6 %) |
| WaitTime p50 / p90 | 480 / 517 ms | 482 / 653 ms |
| PSS at the first screen p50 / p90 | 129,066 / 129,386 KiB | 150,938 / 151,623 KiB |
| Repeat rule (CV > 20 % or a run > 1.5 × median) | not triggered | not triggered |
| Device download size (bundletool, this device spec) | 25,669,195 B | 26,134,182 B |

Reading (informational):
- Time to the first screen is unchanged between the Phase-2 baseline and the Phase-3 code on this device. One R1b launch
  at 642 ms widened p90.
- PSS at the unconfigured first screen grew by about 21.9 MiB (+17 %) from R1a to R1b. It stays below the 156,250 KiB
  PB-07 figure, but PB-07 is defined at Rider home on the reference device, which this set does not measure.
- Fully drawn is not reported on the unconfigured screen, so PB-01/PB-02 are not measurable from a control set.

## 3. Not run here

| Item | Status | Reason |
|---|---|---|
| Signed-out / signed-in cold start (PB-02 / PB-01), warm start (PB-03), Rider-home PSS (PB-07), quote cycles (PB-09), PB-06 runtime | **BLOCKED** | Need a release-like build against an HTTPS origin: FA-17 D1-A tunnel session, which the permission layer denied (external ingress). |
| Any SP-02 verdict | **NOT RUN** | No reference-class device (FA-04). |
