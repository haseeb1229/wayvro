# PHASE3_FOUNDER_EVIDENCE_PACK — Real-world evidence the founder must supply before Phase 3 can close

**Date:** 2026-10-13 · **Branch:** `phase-3/maps-quotes-unified-ux` · **Status:** the engineering harnesses for every item below exist on this branch; **none of these steps has been performed** (NOT RUN). Claude Code cannot perform them: they need real devices, real Lahore drives, provider accounts, a native speaker or a vendor's written answer. Nothing here authorises paid spend (FA-08: none is pre-approved). · **Authority:** `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` (FA-xx definitions), the protocols named per item, and the authorisation's rule that Phase 3 is not called complete while this evidence is missing.

Roles: **F** = founder (physical/legal/commercial steps), **C** = a Claude Code session on the founder's laptop (host commands, builds, analysis). Synthetic data only; never real customer data, never committed keys, raw logs, coordinates, screenshots of personal data, device serials or phone numbers.

## 0. Summary — what is still needed and what it unblocks

| FA | Evidence | Unblocks | Harness on this branch | Effort (estimate) |
|---|---|---|---|---|
| FA-03 | SP-01 real Android devices: Transsion (Infinix/Tecno), Xiaomi (HyperOS), Samsung **or** Vivo | ADR-029 (background-location SDK) and ADR-003 (mobile stack) freeze; V05/A07/Q26/Q27 device evidence | `tests/spikes/sp-01-background-location/` (spike app + receiver + aggregator + runbook) | ~7–9 h per device, ~21–26 h for three |
| FA-04 | SP-02 reference low-end device (Transsion-class Android Go, 3–4 GB) | ADR-050 budgets measured, V11/Q26/Q27/L08 device evidence, renderer choice (with SP-04) | release AAB (CI artefact) + `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md` + the SP-08 e2e/instrumented build | ~7.5–9 h (setup + R1a + R1b; R2 after the renderer) |
| FA-17 | ephemeral vetted HTTPS tunnel per measurement session (synthetic API only) | the signed-in parts of SP-01 TC-01 and SP-02 (otherwise BLOCKED; TLS is never weakened) | — (founder chooses a tunnel whose terms/security were checked) | per session |
| FA-05 | SP-04 Lahore field data: ≥ 50 cases per the capture template (4 sessions incl. one peak) | ADR-006 provider-per-SKU and ADR-046 renderer freeze; B01/B02/B03/E06 accuracy evidence | `tools/geo-bench/` + `docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md` + `docs/phase3/PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv` | 4 sessions (2–3 h each) + 2–3 h desk |
| FA-06 | evaluation accounts/keys for the candidate bundles, each with a provider-console HARD quota below the free allowance | the SP-04 run; any real adapter contract test (`pnpm --filter @wayvro/geo-adapters test:live`) | `packages/geo-adapters` (candidates, not bound), `tools/geo-bench` budget hard stop | ~1 h per provider |
| FA-09 | native Urdu and Roman-Urdu human review of all new copy (safety/legal/price explanations first) | P18, A06, K19 (and the Urdu parts of A08/L08) exit | the i18n review export (P3.9; `pnpm --filter @wayvro/wayvro-mobile i18n:export`) | reviewer time |
| FA-19 | written Mapbox sales/legal answer on the Commercial Application License for vehicle usage | any pilot/production freeze of bundle S2 (Mapbox) only | — | email exchange |
| FA-08 | a specific spend decision, only if evidence shows a paid tier is needed (e.g. Transistorsoft after an SP-01 candidate-A failure, or a paid geo tier) | the corresponding fallback | — | decision |

If any of FA-03/04/05/09 is still missing at the closure checkpoint (P3.10), the affected requirement IDs and freezes are reported **PARTIAL_EXTERNAL_GATED / BLOCKED-EXTERNAL** and macro Phase 3 is **not** called complete or merged as complete.

## 1. SP-01 — real-device background location (FA-03, FA-17)

What it proves: Rider-mode users of the release app never see driver prompts, while a Driver/Partner who is online keeps ≥ 95 % location completeness over 60 minutes screen-off (GUIDED battery configuration) on ≥ 3 OEM classes including Transsion and Xiaomi, with revocation detected ≤ 30 s and deterministic kill/crash/reboot recovery, and the offer path measured with push absent. The pass rules are fixed before measurement (FA-07; `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md` §13) and are never tuned after seeing results; a failed run is FAIL evidence until a cause and an evidence-backed fix/re-run exist.

Steps:
1. **F** acquire or borrow one device per class (§6 of the protocol); no personal accounts on them; charge ≥ 80 %; SIM data on; same Wi-Fi as the laptop.
2. **F** enable Developer options + USB debugging (Xiaomi may require a dedicated test Mi account — never a personal one); accept the RSA prompt.
3. **C** build the spike (README §4.2: own lockfile, hoisted linker, JDK 17, `assembleRelease bundleRelease`, debug-signed, never distributed) and run its TC-21 gates (16 KB, spike permission allowlist without USE_FULL_SCREEN_INTENT or boot restart, targetSdk 36).
4. **F/C** follow the per-case runbook (README §5–§6): TC-01 (release app rider hygiene; the signed-in runtime part needs an FA-17 tunnel session, otherwise BLOCKED), TC-02…TC-19, TC-21. TC-20 (Play Integrity) is BLOCKED-EXTERNAL; TC-22 (push wake) is NOT RUN (FA-18 deferred to Phase 4).
5. **C** aggregate (README §4.5) and commit only the aggregate JSON/Markdown in the spike's `results/` folder; raw files stay in the session scratch directory and are deleted within 7 days.
6. **C** write ADR-029 / ADR-003 as ACCEPTED-ON-EVIDENCE only if R1–R6 and R8 pass on the required classes; otherwise record FAIL/BLOCKED and follow the fallback tree (§14: re-tune once with both runs recorded → FA-08 decision on candidate B → ADR-003 Flutter evaluation).

## 2. SP-02 — low-end performance (FA-04, FA-17)

What it proves: the FA-07 pre-measurement budgets PB-01…PB-14 on the reference device (cold start p50 ≤ 2.5 s / p90 ≤ 4.0 s signed in; download ≤ 30.0 MB arm64-v8a / ≤ 29.0 MB armeabi-v7a; Hermes bundle ≤ 4.5 MB; 0 driver modules evaluated at rider start-up; PSS; data per flow; …). Budgets are never raised after measurement; a breach needs evidence, a bounded founder decision and an ADR-050 amendment.

Steps:
1. **F** the reference device (Infinix Smart 10 / Tecno Spark 30C class); developer options as in §1.
2. **C** R1a: install the CI release AAB of `main` (Phase-2 baseline) with bundletool; M-01 (unconfigured/signed-out), M-04 at the first screen, M-05/M-06/static M-07.
3. **C** R1b: a local release AAB built with `WAYVRO_API_URL` = the FA-17 tunnel origin (synthetic API only; tunnel torn down after the session; URL never committed), then M-01…M-15 per the protocol (fully-drawn marker for TTI; the instrumented build for the driver-module count, never the release artefact).
4. **C** commit only the aggregated rows (`docs/phase3/evidence/sp-02/`), never traces, recordings or raw dumps.
5. R2 happens after the SP-04 bundle/renderer decision (P3.7), with the map renderer integrated.

## 3. SP-04 — Lahore field benchmark (FA-05, FA-06, FA-19)

What it proves: per-SKU accuracy, Roman-Urdu search quality, route/ETA error, latency and cost per 1,000 quotes for each licence-coherent bundle (S1 Google, S2 Mapbox, S3 self-hosted open stack), against the FA-07 thresholds — plus the **route-critical hard gate**: a bundle with any unresolved CRITICAL route invalidity (wrong-way on a one-way road, private/inaccessible road as normal routing, prohibited/closed passage, unsafe/impossible manoeuvre, systematic severe defect) is INELIGIBLE whatever its score, until the ground truth is corrected, a provider/config/map-data fix is re-run, or a founder-signed mitigation proves the route will never be presented or used.

Steps:
1. **F** (FA-06) create evaluation accounts only under terms that permit evaluation; set a provider-console HARD quota per SKU below the free allowance; keep keys in an untracked local env file only; never paste keys into chats, prompts, issues or screenshots. Public Nominatim/OSM tile servers must not be used (the harness refuses them); the open stack is self-hosted.
2. **F** (FA-05) drive the four sessions per `docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md` §3–§4 (safety, legality and privacy first: public places only, no private homes, a passenger-helper captures while the driver drives), filling the capture template (delete the EXAMPLE rows).
3. **C** validate the sheet (`tools/geo-bench` README §2 — no provider call), run with the budget hard stop (§3), do the manual route review (§4), score (§5), and commit only the aggregate report.
4. **F** (FA-19) if S2 (Mapbox) remains a candidate for pilot/production, obtain written Mapbox clarification on whether the Commercial Application License for vehicle usage applies to Wayvro's Rider/Driver use, before any S2 freeze. Re-check Google's applicable subscription vs pay-as-you-go paths at the freeze point; no paid plan without a specific FA-08 decision.
5. **C** write ADR-006 (provider per SKU) and ADR-046 (renderer) together, only on this evidence; then integrate the renderer behind `src/platform/maps` and run SP-02 R2.

## 4. Native Urdu / Roman-Urdu review (FA-09)

1. **C** generate the reviewer package: `pnpm --filter @wayvro/wayvro-mobile i18n:export` (written to a git-ignored path; columns: key, screen/context, en, ur, ur-Latn, placeholders, safety/legal flag, maximum length).
2. **F** give it to a native Urdu reader and a Roman-Urdu reader (safety, legal and price-explanation strings first); reviewers correct the text, keep placeholders intact and sign with name + date.
3. **C** import with the reviewed-import script (it accepts only the export's keys and records reviewer + date); the strings then lose their "pending review" marker. AI-drafted text alone never satisfies P18/A06/K19.

## 5. Optional / later

- FA-14 accessibility tester (TalkBack walkthrough on a physical device) — recommended before pilot; VoiceOver needs an iPhone (FA-13) and is NOT RUN in Phase 3.
- Ruleset change: making the informational `Mobile E2E` job a required check is a founder action (Phase 4 per the SP-08 plan; keep the check name short — ruleset contexts are truncated at 100 characters). **Update 2026-10-18:** the founder APPROVED this (plus merge-only) on 2026-10-17; the payload was built from the live ruleset (`evidence-local/fix/ruleset-payload.json`, local) but the session permission policy refused the PUT, so it remains a founder action: `gh api -X PUT repos/haseeb1229/wayvro/rulesets/24837051 --input <payload>` (adds `Mobile E2E` as the sixth context, `allowed_merge_methods: ["merge"]`, nothing else changed).

## Founder preview APK (synthetic data only) — closure correction §17

**Purpose:** let the founder install Wayvro on their own ARM64 Android phone to look at the UI. This is **not performance evidence**: SP-02 uses the release-like device protocol in `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md`. Use synthetic data only: no real SMS, no provider keys, no real accounts. OTP codes come from the local runner's OTP inbox.

**Why the CI builds are not installable previews:**
- The release AAB (`apps/wayvro-mobile/build-reports/app-release.aab`) has no API origin, so it opens on "service not configured".
- The E2E APK is x86_64 and reaches only the emulator loopback `10.0.2.2`.
- The development debug APK needs Metro.

### Option A — release-like preview (preferred; needs FA-17)
1. **Founder:** provide an HTTPS tunnel endpoint (FA-17, approved in principle) that forwards to a laptop-local synthetic stack: throwaway database, synthetic seed, API local runner — for example `node tests/e2e-mobile/mobile-stack.mjs`. Release builds accept only `https` origins.
2. **Build the AAB:** `WAYVRO_API_URL=https://<tunnel-host> node scripts/android-build.mjs release`. This produces the gated release AAB for arm64-v8a + armeabi-v7a, debug-key signed, which is not an upload artefact.
3. **Make an installable APK:**
   - `java -jar bundletool.jar build-apks --bundle apps/wayvro-mobile/build-reports/app-release.aab --output wayvro-preview.apks --mode=universal --ks <the generated debug keystore> --ks-key-alias androiddebugkey`, using the keystore's standard debug password;
   - unzip `universal.apk` from the `.apks` file.
4. **Install:**
   - with USB debugging on, run `adb install universal.apk`; or copy the file to the phone and allow "install unknown apps" for that one installation;
   - sign in with a synthetic phone number, taking the code from the local runner's OTP inbox.

### Option B — LAN development preview (UI only)
1. Phone and laptop on the same Wi-Fi.
2. Bind the local runner to the laptop's LAN address (`HOST`/`PORT` config of the API local runner), and allow that one port in Windows Firewall — this is a founder decision.
3. **Build:** `WAYVRO_API_URL=http://<laptop-LAN-IP>:<port> node scripts/android-build.mjs debug`. This is the development client for arm64-v8a + x86_64; development builds accept `http`.
4. **Run:** `pnpm --filter @wayvro/wayvro-mobile exec expo start --dev-client` on the laptop. Install the debug APK on the phone and open the Metro URL.

**Status (2026-10-14):** NOT BUILT. Option A waits for the FA-17 tunnel. Option B needs the founder's consent to the firewall rule and the LAN binding. Neither changes app code.
