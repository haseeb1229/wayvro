# SP-02 on the reference device (Samsung Galaxy A30) — R1a baseline and R1b results

> **REFERENCE DEVICE BY FOUNDER DECISION (2026-10-27).** The founder accepted the Samsung Galaxy A30 class as the FA-04
> reference device in place of the Transsion Android Go class (`docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` §1b).
> The FA-07 budgets, the protocol statistics and the network profiles are unchanged
> (`docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md`). R2 (after the map renderer) has not run: no renderer is
> bound in Phase 3.

- **Dates:** 2026-10-27 to 2026-10-28. **Branch:** `phase-3/maps-quotes-unified-ux`; code = `af5d8e2`.
- **Device:** Samsung SM-A305F, Android 10 / API 29, 3.6 GB RAM (`MemTotal` 3,818,116 kB), arm64-v8a, `ro.config.low_ram`
  unset, stock firmware. The phone also carries personal apps (recorded deviation). Thermal status 0 at the start of
  each set; the harness waits out LIGHT/MODERATE states.
- **Harness:** the 2026-10-27 fail-closed SP-02 harness (local and git-ignored, under `evidence-local/sp02-device/`):
  - an explicit device kind and exact serial for every command;
  - FA-07 limits fixed in code (PB-07 = 160 MB = 156,250 KiB);
  - an unparseable launch or a wrong screen makes a set INCOMPLETE rather than being dropped;
  - parser self-tests 67/67 and device self-tests 14/14 PASS.

  The 2026-10-18 legacy scripts were not used for any number below.
- **Session (FA-17 D1-A, founder-authorised 2026-10-27):**
  - synthetic stack on a throwaway database;
  - a `/v1`-only proxy (`/__local` answers 404 through the tunnel);
  - an ephemeral Cloudflare quick tunnel, torn down after the session;
  - synthetic sign-in, with the OTP read host-side.

  No tunnel URL, token or account identifier is recorded.

## 1. Network conditions (read with every R1b result)

1. **Blocked Cloudflare edge address.** The quick-tunnel host resolves, one address per answer, to either 104.16.230.x
   or 104.16.231.x. From both the founder's home ISP and a mobile-data hotspot, **104.16.230.x completed TCP but never
   completed a TLS handshake** (for any server name), while 104.16.231.x completed TLS 1.3 in about 30 ms. Whenever the
   phone's resolver returned .230, the app's requests hung until the client's 15 s timeout ("Couldn't reach Wayvro").
2. **Mitigation used:**
   - the phone and the laptop moved to a mobile-data hotspot;
   - the phone's Private DNS was set to `dns.google` (restored to "opportunistic" afterwards);
   - a set was run only while the phone resolved the working address.

   The record TTL is 200 s and every public resolver rotates between the two addresses, so the working state did not
   hold. Sets that ran in a working window completed normally: every kept launch reached its target screen, which is
   impossible on the blocked address. The later sets could not get a working window (§3).
3. **Profile N0 only.** The founder chose not to run the N2 (≈ 1 Mbps) profile. Every set below is N0 over a phone
   hotspot (mobile data); N0 normally means unthrottled home Wi-Fi.
4. **Product note (not a budget finding):** a client whose resolver returns a blocked edge address has no second address
   to fail over to, and the request hangs for the full 15 s timeout. This matters for any Cloudflare-fronted production
   endpoint in Pakistan and is an input for the hosting/CDN decision.

## 2. Artefacts

| Round | Commit | Artefact | Notes |
|---|---|---|---|
| R1a (Phase-2 baseline) | `058fcea` | release AAB rebuilt locally (the CI artefact had expired after 7 days), sha256 `c0c7aec9…1419063`, 34,879,394 B | Clean detached worktree, frozen lockfile, JDK 17, bundletool 1.18.3 (checksum matches CI), `WAYVRO_API_URL` unset. That commit's gates: 16 KB PASS, permissions PASS. |
| R1b control | `af5d8e2` | CI release AAB, sha256 `279acf1d…daf2` | Unconfigured. Probe-free; contains `WayvroFullyDrawn` and the once-per-process early token refresh (SP02-F1); no map renderer. |
| R1b signed-in | `af5d8e2` | `node scripts/android-build.mjs release` with `WAYVRO_API_URL` = the session origin, debug-key signed, never an upload artefact; deleted after the session | Every release gate PASS (16 KB, permissions, intent filters, size, release purity, bundle secrets). Probe-free. Rebuilt once because the tunnel origin changed with the network move. |
| PB-06 instrumented | `af5d8e2` | **NON-SHIPPING** arm64-v8a APK built against the session origin, sha256 `57b17094…72d3d`; removed from the phone after the session | 14/14 static checks PASS (probe present, HTTPS origin is the argument, no cleartext, no network-security config, no dev client, release permission set, fully-drawn module, no map renderer). |

## 3. Budget verdicts (FA-07, reference device)

| Budget | Condition | Measured (n = 5 kept of 6 cold launches unless stated) | Limit | Verdict |
|---|---|---|---|---|
| **PB-01** cold start to Rider home (signed in, fully drawn) | N2 | p50 **2,419 ms**, p90 **3,237 ms** (CV 14.6 %) under **N0** | p50 ≤ 2,500, p90 ≤ 4,000 ms at N2 | **NOT RUN at N2** (founder choice). Within the numbers under N0, which is informational only. |
| **PB-02** cold start to sign-in (signed out, fully drawn) | N0 | p50 **1,756 ms**, p90 1,842 ms (CV 2.7 %) | p50 ≤ 2,000 ms | **PASS** |
| **PB-03** warm start to Rider home | N0 | p50 **82 ms**, p90 100 ms (CV 10.1 %); Android reported launch state HOT for all six | p50 ≤ 1,000, p90 ≤ 1,500 ms | **PASS** |
| **PB-04** download size | laptop, all device specs | arm64-v8a max 26,150,904 B; armeabi-v7a max 25,407,745 B (this device: 26,133,474 B) | ≤ 30,000,000 / 29,000,000 B | **PASS** |
| **PB-05** Hermes bundle | laptop | 3,688,896 B | ≤ 4,500,000 B | **PASS** |
| **PB-06** driver modules evaluated before fully drawn | N0, instrumented build | not measured | max 0 | **BLOCKED** (§1: no working DNS window in 10 min of waiting). The build is ready. The static isolation checks (architecture test + dependency-cruiser) still hold in CI. |
| **PB-07** PSS at Rider home | N0 | Cold-start set: p50 169,854 / **p90 170,214 KiB**. Memory-screens set: home p50 170,711 / p90 246,924 KiB (one outlier session; CV 20.1 % triggered the repeat rule). Repeat: home p50 161,687 / **p90 169,436 KiB**. | p90 ≤ 156,250 KiB (160 MB) | **FAIL**: every set exceeds, by about 8–9 % on the repeat |
| PB-08 PSS with map | R2 | — | p90 ≤ 253,906 KiB | **NOT RUN** (no renderer in Phase 3) |
| **PB-09** memory growth over 10 quote cycles | N0 | not measured | ≤ 10 % | **BLOCKED**. Attempt 1 failed at cycle 2 on an ambiguous test-flow tap (the flow tapped the selected-place caption, not the suggestion row; fixed in the local flow). Attempts 2–3 started on a white screen while the phone resolved the blocked address (§1). |
| PB-12a Lite data use | N2 | — | median ≤ 150,000 B | **NOT RUN** (N2 skipped) |

Informational (search and quote screens, PSS KiB):

| Set | Search p50 / p90 | Quote p50 / p90 | Valid sessions |
|---|---|---|---|
| Memory screens | 180,285 / 265,378 | 187,639 / 273,958 | 4 of 5 (one did not reach search) |
| Repeat | 178,076 / 179,025 | 186,453 / 186,574 | 3 of 5 (network) |

Not run in this session (no budget, or needs a stable tunnel): M-03 Perfetto, M-10 standard data, M-12 idle, M-13
constrained storage, M-14 memory pressure and process death, M-15 battery.

## 4. R1a and R1b control (unconfigured first screen)

| Metric | R1a `058fcea` | R1b `af5d8e2` |
|---|---|---|
| `am start` TotalTime p50 / p90 | 474 / 508 ms (CV 3.3 %) | 476 / 642 ms (CV 15.6 %) |
| PSS at the first screen p50 / p90 | 129,066 / 129,386 KiB | 150,938 / 151,623 KiB |
| Device download size | 25,669,195 B | 26,134,182 B |

The control sets ran on home Wi-Fi before the founder's decision, using the same harness. They have no budget. They show
that the Phase-3 code adds about 21.9 MiB of PSS at the first screen relative to the Phase-2 baseline, which bears on the
PB-07 failure.

## 5. What follows from this

- **PB-07 is the one measured budget failure.** Rider-home memory is about 166 MiB at p90 against a 160 MB budget. Under
  FA-07 the budget is not raised to fit the result. Either a bounded memory-reduction fix on the Phase-3 code (then a
  re-measurement), or an evidence-backed ADR-050 budget decision by the founder. The renderer round (R2, PB-08) will add
  map memory on top.
- PB-06 and PB-09 need one more session on a network path where the tunnel's working address is stable: a different
  network, a tunnel provider whose edge is reachable, or the staging host.
- PB-01 at N2 and PB-12a stay NOT RUN by founder choice.
