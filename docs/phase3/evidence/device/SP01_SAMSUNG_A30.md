# SP-01 real-device run — Samsung class (Galaxy A30, Android 10)

> **REAL_DEVICE — ONE OEM CLASS OF THREE (Samsung-or-Vivo).** This is real-device SP-01 evidence for the Samsung class
> only. SP-01 / FA-03 stays open: the protocol (`docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md`) needs the Transsion and
> Xiaomi classes too, and ADR-029 / ADR-003 / ADR-033 are not decided here. Deviations from the protocol are listed in §2
> and must be read with every result.

- **Date:** 2026-10-27. **Branch:** `phase-3/maps-quotes-unified-ux`; code = `af5d8e2` (docs-only commits after it).
- **Spike build:** r6 from the `af5d8e2` tree. The arm64 release APK was used on the device. The TC-21 gates ran on a
  separately built release AAB (arm64-v8a + armeabi-v7a, sha256 `c11477ce…0573547`).
- **Requirement IDs exercised (supporting evidence only, none satisfied by this run):** V05, A07, U05. Context: M26 /
  ADR-033 (offer path without push), INV-07.
- **Data:** synthetic. The spike transmits no coordinates (accuracy and distance buckets only). The phone lay stationary
  on a desk indoors. The receiver ran on the founder's laptop on the home LAN. Raw rows, logcat, batterystats and
  screenshots stay local (git-ignored or session scratch) and are deleted after review (protocol §15). This file contains
  no serials, addresses, network names or phone numbers.
- **Operator:** the lead drove the spike and Android Settings over ADB (`input tap` on the real system dialogs). The
  founder did the physical steps (unplug/replug, Wi-Fi and airplane toggles, screen unlock) and some permission taps.

## 1. Device

| Item | Value |
|---|---|
| Model class | Samsung Galaxy A30 (SM-A305F), One UI on Android 10 / API 29, arm64-v8a |
| RAM | 3.6 GB (`MemTotal` 3,818,116 kB); `ro.config.low_ram` unset |
| Role | SP-01 Samsung class. **Not** the SP-02 reference class (Transsion Android Go), so it gives no SP-02 PASS/FAIL. |
| Battery config | DEFAULT = fresh install. GUIDED = App info → Battery: "Allow background activity" On (default) and "Optimise battery usage" → All → spike **Off**, which puts the spike on the system's battery-optimisation exemption list (standby bucket 5). On this One UI version GUIDED and STD-EXEMPT are therefore the same state. |

## 2. Deviations (read with every result)

1. **Wi-Fi only.** The phone had no SIM data. Network-loss cases are full connectivity loss: Wi-Fi off, and airplane mode
   with no fallback network. TC-06(b) (Wi-Fi off with SIM data on) could not run.
2. **Not a clean test phone.** Personal apps were installed (protocol §5.2 asks for none). No personal data was read or
   recorded.
3. **Unstable USB cable.** ADB switched to Wi-Fi (`adb tcpip`) for most cases. It was disconnected during the 60-minute
   windows and reverted by the TC-09 reboot.
4. **One invalid run.** TC-03 attempt 1 was invalidated because the host laptop entered Modern Standby 2 minutes in.
   It was repeated with the laptop on AC and the lid open.
5. **TC-14 is partial.** USB was connected 12 minutes into the 30-minute battery-saver window. Only those 12 minutes are
   reported.
6. **Founder messages lagged the physical toggles** in TC-19 and TC-13. Timing comes from the device's own socket and
   airplane-mode log lines and the server's presence rows, not from host marks.
7. **Fix cadence.** With `timeInterval` 5 s, High accuracy, distance 0 and no deferred updates, this device delivered a
   fix every **7.16 s** (median, DEFAULT) and **6.82 s** (median, GUIDED). The completeness metric is measured against
   the 5 s nominal interval, unchanged, so no Samsung A30 run can exceed about 73 % even with zero gaps.

## 3. Results

| TC | Config | Result | Key numbers |
|---|---|---|---|
| TC-01 Rider hygiene (release app runtime) | — | **BLOCKED** | Needs the FA-17 HTTPS tunnel session. The static manifest part passes in CI. |
| TC-02 go-online flow | DEFAULT | **PASS** (paths 1 and 3); path 2 **NOT RUN** | Path 1: full grant gives FGS + notification + ONLINE in 5 taps ("Allow only while using" → Open location settings → "Allow all the time" in the Android 10 upgrade dialog), plus the Location switch if it is off. With Location off, the spike shows a recovery screen and starts no FGS. Path 3: "Keep while-in-use" leads to "Location is not allowed all the time" + Settings link, no FGS, server stays OFFLINE. Path 2 (approximate only) does not exist on Android 10. |
| TC-03 60 min | DEFAULT | **R1 NOT MET** (DEFAULT is recorded; the freeze rule applies to GUIDED) | Completeness 71.94 % (518/720); 0 gaps > 2× interval; longest gap 7.5 s; 0 drops; 0 duplicates; delivery latency p50/p95 5.36/9.91 s; battery 98 → 92 % (6.0 %/h); 0 process deaths; FGS present at end. |
| TC-04 60 min | GUIDED | **FAIL** (R1 ≥ 95 % not met); R7 battery **met** | Completeness 75.14 % (541/720); 1 gap > 2× (27.2 s, server STALE 16 s then resumed); 0 drops; 0 duplicates; latency p50/p95 5.94/7.73 s; battery 100 → 97 % in 67 min on battery (points: 2 %/h); batterystats spike estimate 67.9 mAh; Doze reached IDLE with the FGS alive; 0 process deaths. Root cause of the shortfall: the device's ~6.8 s fix cadence (§2.7), not tracking loss. |
| TC-05 offers without push | inside TC-03/04 | **PASS** (measured) | 30/30 and 30/30 offers via the live socket, 0 lost; latency p95 0.22 s and 0.46 s. |
| TC-06(a) gateway restart ×5 | GUIDED, screen off | **FAIL** (reconnect rule) | The socket dropped at the first restart and did not reconnect while the screen stayed off (0/5 recovered; it reconnected only when the app came to the foreground). Offers 2/2 delivered by poll, 0 lost; 0 duplicates. Same finding as the emulator run. |
| TC-06(b) Wi-Fi off, SIM on | — | **NOT RUN** | No SIM data (§2.1). |
| TC-07 swipe-away | GUIDED | **PASS** (FGS survives) | Same process and FGS after the Recents swipe; 3 min later still ONLINE, 0 gaps > 2×. DEFAULT variant NOT RUN. |
| TC-08 process kill | GUIDED | **PASS** | `am kill` did not kill the FGS-protected process. Force-stop: server STALE 17.8 s, OFFLINE `TRACKING_LOST` 117.7 s, no automatic restart, next open shows the server reason, no FGS. |
| TC-09 reboot | GUIDED | **PASS** | No process or FGS at boot or 5 min later; server OFFLINE `TRACKING_LOST`; open shows the reason and needs an explicit Go online. |
| TC-10 background start | GUIDED, offline | **PASS** (30 s variant) | `START_REFUSED_BACKGROUND` caught, no crash, no FGS, notice on next open. Android 10 has no OS background-FGS-start restriction (API 31+); the refusal comes from the app's foreground check. |
| TC-11 permission revoke | GUIDED | **FAIL** | `pm revoke` of background location (adb variant): Android killed the process (recorded); server STALE about 20 s, OFFLINE `TRACKING_LOST`; next open shows `PERMISSION_REVOKED` + Settings link. But the location FGS and its notification stayed alive without the permission for more than 3 min (orphan FGS). The Settings-UI variants were NOT RUN. |
| TC-12(a) approximate | — | **NOT RUN** | Android 10 has no "Use precise location" switch. |
| TC-12(b) Location off | GUIDED | **PASS** | Client `PROVIDER_DISABLED` + FGS stopped within about 8 s; server OFFLINE `PROVIDER_DISABLED`. |
| TC-13 airplane | GUIDED | **PASS** (both variants, with notes) | 10-min variant (Wi-Fi off, §2.1): 60 buffered points uploaded after return; 16 stored (fixed before OFFLINE) and 44 rejected (fixed after the server's `TRACKING_LOST`, by design); 0 duplicates; 0 drops. 2-min variant: airplane lasted about 127 s (> 120 s tOffline), so the server went OFFLINE by design and the client stopped on reconnect; 0 duplicates; 0 drops. Indoors with the radios off the device produced almost no fixes, so buffering was exercised only by the 10-min variant. |
| TC-14 battery saver | SAVER | **Recorded, PARTIAL** (§2.5) | 12 min: completeness 55.56 %, 19 gaps > 10 s, longest gap 27.2 s, 0 drops, 0 duplicates. Battery Saver clearly degrades the fix cadence on this device (ADR-033 OEM-guidance finding, not an automatic fail). |
| TC-15 crash recovery | GUIDED | **FAIL** (a and b) | (a) JS crash: the system restarted the process headless; the client logged `ORPHAN_TASK_STOPPED` and the UI showed "Tracking stopped …" with an explicit resume, but the location FGS and its notification stayed alive for more than 3 min with the server OFFLINE, even after "Stay offline". (b) `am crash`: two foreground service records were listed briefly (breaks the "≤ 1 FGS" rule); on open `STALE_FGS_STOPPED` + `ORPHAN_TASK_STOPPED`, yet an FGS stayed foreground for more than 3 min with the server OFFLINE. 0 duplicate batches stored. |
| TC-16 Rider switch | GUIDED | **PASS** | Server `USER_OFFLINE` 0.2 s, client stop 0.23 s after confirm; FGS and notification gone; 0 points after the stop. |
| TC-17 sign-out | GUIDED | **PASS** | Server `SIGNED_OUT` 0.21 s, client 0.26 s; FGS 0; 0 points after; the app reopens signed out with cleared fields. |
| TC-18 restriction | GUIDED, screen off | **PASS** | Server OFFLINE `RESTRICTED` at 0 s; client `FGS_STOPPED:RESTRICTED` + `FORCED_OFFLINE_APPLIED` 0.02 s after (next HTTP exchange); reason shown on next open; go-online refused (`GO_ONLINE_REFUSED`). |
| TC-19 stale-FGS reconciliation | GUIDED | **PASS** | Server already OFFLINE `TRACKING_LOST` before the admin force-offline (§2.6). On reconnect the client stopped the FGS within 0.6 s; 0 points fixed after OFFLINE were stored (44 rejected). |
| TC-20 Play Integrity | — | **BLOCKED-EXTERNAL** | EG-18. |
| TC-21 compliance build | spike AAB | **PASS** | 16 KB: 64-bit 14/14 aligned, zipalign -P 16 PASS ×2; spike permission policy PASS (no `USE_FULL_SCREEN_INTENT`); FGS type `location` only (0x8); artefact manifest check PASS; targetSdk 36. `RECEIVE_BOOT_COMPLETED` is merged by a library without a boot action (the check passes; recorded). Play pre-launch report and declaration videos are BLOCKED-EXTERNAL. |
| TC-22 push wake | — | **NOT RUN** | FA-18 deferred to Phase 4. |

## 4. Findings for ADR-029 / ADR-033 / Phase 4

1. **Delivered fix cadence (Samsung A30, Android 10).** A 5 s High-accuracy request yields fixes about every 6.8–7.2 s
   indoors, so completeness against the 5 s nominal interval caps at about 70–75 %. That fails R1 (≥ 95 % GUIDED) on this
   class with zero gaps and zero drops. The threshold is unchanged. ADR-029 must decide whether R1 is judged against the
   nominal interval (as now) or against the delivered cadence; that is a founder/ADR decision, not a re-scoring of this run.
2. **Orphan location FGS after crash or permission revoke (TC-11, TC-15).** The client detects the condition and shows
   the correct UI, but the `LocationTaskService` foreground service and its notification outlive the stop (more than
   3 min, including after the server is OFFLINE and after "Stay offline"). An `am crash` briefly produced two foreground
   service records. This confirms the emulator finding on real hardware. Phase 4 must own an FGS lifecycle that stops the
   service itself, not only the task. (The Phase 3 release app has no location service: `LocationTaskService` is removed
   from the release manifest and the release gate checks it.)
3. **Background socket reconnect stalls (TC-06a).** With the screen off the socket did not reconnect after a gateway
   restart; poll delivered every offer. This supports ADR-033's rule that poll/recovery, not the socket, is the
   dependable channel while the screen is off.
4. **Battery Saver degrades cadence (TC-14).** Gaps up to 27 s and 55.6 % completeness in 12 minutes.
5. **Battery (R7).** GUIDED drain was 2–3 %/h and DEFAULT about 6 %/h, both within the ≤ 6 %/h budget.
6. **After force-stop, reopening found an orphan task** (status panel: 2 orphan-task stops, 1 location callback after
   stop). This ties to finding 2.

## 5. What this does not show

- No result for the Transsion or Xiaomi classes; SP-01 needs both.
- No outdoor or moving-vehicle cadence; the phone was stationary indoors.
- No SIM-data fallback behaviour.
- No release-app runtime (TC-01 runtime) without the FA-17 tunnel.
