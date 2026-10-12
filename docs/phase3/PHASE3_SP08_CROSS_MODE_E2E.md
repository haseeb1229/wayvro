# PHASE3_SP08_CROSS_MODE_E2E — Cross-mode mobile E2E regression matrix (PROPOSED)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — pending founder/ChatGPT review; no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

Requirement IDs: **V10** (scaffold in Phase 3, enforced from Phase 4), V08, V05, V11, A01, A07, L08, K19 (regression), B01–B06 (rider quote UX). Invariants: INV-07 (proved here at E2E level), INV-09 (driver restriction ≠ account restriction), INV-14 (cross-mode regression, CI from Phase 4). ADR: **ADR-052 Mobile E2E tooling — PROPOSED**. Founder action: **FA-16** (approve Maestro + GitHub Actions emulator minutes).

Nothing in this document has run. Every result is NOT RUN until the Phase-3 run records it.

---

## 1. Purpose

One binary serves riders and Driver/Partners, so every release can break the other mode. SP-08 proves, on a real Android runtime, that:
- rider-only use never touches driver code paths or driver permissions (V05, V11, INV-07);
- mode switching, restoration after process death, back stack and internal intent routing land on server-correct screens for every account shape (V08);
- driver onboarding/compliance (Phase 2) keeps working while rider features land (V10), and rider quote UX keeps working while driver features land;
- kill switches, version/maintenance policy and Lite mode behave per mode (A01, L08, `docs/28_APP_SURFACES_AND_REPO_TOPOLOGY.md` §10).

Unit-level logic (resolver, intent router, view-state adapters, ModeController) is covered by vitest; SP-08 covers what only a running app can show.

---

## 2. Tool — Maestro (ADR-052, PROPOSED; CON-P3-13)

| Option | Fit | Why not / why |
|---|---|---|
| **Maestro** (CLI, YAML flows, black-box via accessibility tree + adb) | **Proposed** | No test code inside the app or its build; drives any APK by app id; built-in waiting reduces flakiness; system dialogs reachable; one external binary in dev/CI only (never in the app); named in `docs/phase0/PHASE0_ENGINEERING_GUARDRAILS.md` as the primary mobile E2E tool |
| Detox | rejected for Phase 3 | gray-box: native test instrumentation and a separate test APK in the Gradle build, Jest runner alongside vitest (two runners, two configs), larger CI cost and coupling to RN/Expo upgrades |
| Jest + React Native Testing Library component tests | rejected for Phase 3 | overlaps vitest; needs jest-expo presets; proves components, not the native runtime, permissions or process death |
| Appium | rejected | heavier server stack, slower, no advantage for one Android app |

Maestro version is pinned and checksum-verified in CI like bundletool/gitleaks; licence and data-collection settings (analytics opt-out flag) recorded in `docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md`. Proposed location: `tests/e2e-mobile/` (sibling of `tests/e2e-web/`; the Phase 0 guardrail names `tests/e2e/mobile` — either is acceptable, record the choice in ADR-052). Flows as `.yaml`, a stack script as `.mjs` (all proposed).

---

## 3. Build under test and environments

### 3.1 The build problem (verified constraints)
- Release AAB ABIs are arm64-v8a + armeabi-v7a only; CI emulators are x86_64 (`scripts/android-build.mjs`).
- Release builds accept only `https` API origins; `http://10.0.2.2:4000` is allowed only for `__DEV__` builds (`src/core/config/api-config.ts`).
- The dev-client debug APK (arm64-v8a + x86_64) loads JS from Metro in dev mode and still carries the dev-client scheme (F-P3-01).

### 3.2 Proposed build for PR and nightly tiers (OPEN — decide at P3.5 by evidence)

| Option | Description | Pros | Cons |
|---|---|---|---|
| **E1 (proposed)** | new `e2e` mode of `scripts/android-build.mjs`: release-mode JS (embedded Hermes bundle, minified, no Metro), same plugins/permissions as release, ABI x86_64 (+ arm64-v8a for local devices), debug-key signed, API origin = local runner. Cleartext limited to the emulator loopback host via an e2e-only network security config; the `release` mode refuses the e2e marker and a release gate asserts its absence from the AAB | closest to release behaviour (lazy evaluation, minification, no dev menu) | one more Gradle build (time measured, not assumed); must prove the e2e marker cannot reach release |
| E2 (fallback) | dev-client debug APK + Metro (Phase-2 closure smoke precedent, `docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md`) | works today | dev-mode JS, Metro flakiness in CI, not release-like |

The real release AAB is still exercised by: the manifest/permission/intent-filter gates (every CI run), SP-02 on the reference device, and the manual-device release tier for signed-out/permission hygiene. A full release-AAB journey against an HTTPS environment needs a staging environment, which does not exist (Phase 7).

### 3.3 Environments

| Environment | Spec | Status |
|---|---|---|
| CI emulator | `reactivecircus/android-emulator-runner` (pinned by SHA), Google APIs x86_64 images **API 29 (Android 10)** and **API 35 (Android 15)**, KVM on `ubuntu-24.04`, cold boot, animations off, snapshot disabled | runtime **unverified** (boot time, KVM availability on the repo's plan, flake rate) |
| CI backend | compose project for the E2E job: PostgreSQL+PostGIS, Valkey; SeaweedFS + ClamAV + sanitiser only for the nightly onboarding-upload flows; API local runner (dist-dev, ADR-045 doubles incl. recording OTP sink and synthetic geo doubles) | same infrastructure as the Integration job |
| Local | developer emulator (API 35 x86_64) + same stack script | used before pushing |
| Physical devices (release tier) | SP-01/SP-02 devices (FA-03/FA-04): Transsion-class reference + Samsung/Xiaomi classes | manual, per release candidate |

---

## 4. Test-account fixtures (synthetic only)

- **No new production routes, no fixture endpoints, no in-app bypass.** A stack script (proposed `tests/e2e-mobile/mobile-stack.mjs`) follows the existing `tests/e2e-web/ops-stack.mjs` pattern: create a throwaway database `wayvro_e2e_mobile` (owned by the script only, recreated each run), run migrations, seed account states with SQL/service functions the integration tests already use, start the API local runner.
- **Sign-in** uses the real OTP flow; the flow reads the code from the existing local-runner-only `/__local/otp-inbox` route (ADR-045: present only in the non-deployable runner; ART-ISO proves absence from release artefacts). No master or fixed code.
- **Phone numbers** are generated per run in the Pakistani mobile format; the recording sink never sends SMS; numbers appear only in run artefacts.
- **Geo and pricing** use the synthetic deterministic doubles (MOCK-branded, refused outside local/test) and a synthetic local rate card (`is_synthetic=true`) with a short quote TTL (e.g. 45 s) so expiry is testable; deterministic double inputs produce outside-area, outside-hours and routing-unavailable outcomes. Synthetic place names only; no private-home coordinates.
- **Runtime switches / app policy** are set by the seed (and, where the flow tests staff effects, through the staff API with seeded staff identities) — never from the app.

| Account | Seeded server state |
|---|---|
| A rider-only | policies accepted, age declared, no application, `driver.onboarding` ON |
| B approved driver (starts in Rider mode) | VERIFIED application, driver profile ACTIVE_ELIGIBLE, CAR vehicle, valid documents, preference RIDER |
| C approved driver switching | same as B; flows switch to Driver mode and back |
| D driver role restricted | as B + DRIVER_ROLE restriction (appealable), no ACCOUNT restriction |
| E account-wide restricted | ACCOUNT-scope restriction with `affectsRiderUse=true`; has a driver profile |
| F pending application | application MANUAL_REVIEW |
| G expired documents | as B, one required document EXPIRED (renewal due) |

Optional extensions (PROPOSED beyond the earlier draft A–G, nightly only): H deletion pending; I required action pending (ACCEPT_POLICIES after a policy version bump).

---

## 5. Matrix

Tiers: **PR** (smoke, API 35 only) · **N** nightly (full, API 29 + 35) · **R** release (physical-device subset, manual-device) · **M** manual-device only.

| # | Scenario | Accounts | Expected result | Tier | Proves |
|---|---|---|---|---|---|
| 1 | Cold start signed out → OTP sign-in | A | lands on `/ride`; no permission dialog of any kind before a location tap | PR, N | V08, V05, INV-07 |
| 2 | Session restore after `am force-stop` + relaunch | A, C | A ⇒ `/ride`; C with preference DRIVER ⇒ `/drive`; no flash of the other mode's screens | PR (A, C), N (all) | V08 |
| 3 | Process death mid-quote (`am kill` while backgrounded) | A | relaunch offers "Continue with your last price check" or "Prices have been updated" by server state; no coordinates restored from device | N | V08, L08 |
| 4 | Mode switch Rider → Driver | A | opens `/earn` intro (Earn with Wayvro), not a driver home | PR, N | V08, `docs/28` §5 |
|  |  | C | `/drive` readiness; back exits app; switch back ⇒ `/ride` with reset stack | PR, N | V08 |
|  |  | F | `/earn` status "in review"; rider home unaffected | N | V08, K19 |
|  |  | D | `/drive` with "Earning paused" health card; rider quote still works | PR, N | V13, INV-09 |
|  |  | G | `/drive` lists expired document → renewal screen opens | N | K19, V08 |
|  |  | E | rider Where-to disabled with reason + appeal; driver area shows the same restriction, nothing actionable | PR, N | V13, V08 |
| 5 | Back-stack rules | A, C | hardware back on a mode home exits; quote → back → search keeps pickup/drop-off; account hub back returns to the current mode home | N | V08 |
| 6 | Internal intent routing (in-app banners, restoration) | C, G, D | renewal banner → renewal screen in Driver mode; driver intent for A ⇒ refused (`MODE_NOT_AVAILABLE`) with rider home kept; unknown/malformed intent ⇒ mode home | N | V08 |
| 7 | External links | — | **not testable in Phase 3**: no external scheme in release (CON-P3-07, F-P3-01); covered by router unit tests; activated after EG-15 | — | — |
| 8 | Location: rationale → grant precise | A | rationale shown first; one OS dialog; pickup card filled; user confirms | N (API 35 dialog taps) | A07, V05 |
| 9 | Location: approximate only | A | pickup never auto-set; pin confirmation required | N (API 35) | A07 |
| 10 | Location: deny / don't ask again | A | search + pin + pickup points work; settings link shown; no dialog loop | PR (deny via `pm revoke`), N | A07, B02 |
| 11 | Location revoked while backgrounded (`pm revoke`) | A | silent fallback on foreground; no crash | N | A07 |
| 12 | Rider-only permission hygiene after full journey | A | `dumpsys package`: no camera use (`appops`), no background/notification permission declared; only foreground location granted if tapped | PR, N, R | INV-07, V05 |
| 13 | Lazy driver modules (behavioural proxy) | A | no driver screen reachable without tapping Earn; no camera appop; module-evaluation count is proved by SP-02, not here (F-P3-07) | N | V11 |
| 14 | Rider quote happy path | A, B, D | search (synthetic) → quote options (Economy priced; Comfort unavailable with reason) → fare breakdown sums to total as displayed | PR (A), N | B03, B04, B06 |
| 15 | Quote expiry | A | countdown reaches 0 ⇒ "Prices have been updated"; "Get new price" creates a new quote | N | B06, E05 (UI) |
| 16 | Outside area / outside hours / pickup restricted / routing unavailable | A | each state shown with its own copy; no price or ETA shown on routing failure | N | E07, E08, CON-P3-08 |
| 17 | Rate limit | A | 429 copy with seconds; no retry storm | N | I11 (client) |
| 18 | KYC/onboarding regression (no upload) | A → applicant | intro → consent → details → vehicle → documents list; CAMERA dialog appears **only** on the capture screen; denial path usable | PR (to documents list), N | V10, K19, V03 |
| 19 | KYC upload + submission | applicant | photo-picker import (seeded emulator image) → upload → submit → status "received" | N | V10, K19 |
| 20 | Compliance + renewal | B, G | compliance view; renewal start for the expired document | N | V10, D03 |
| 21 | Version policy | A | SOFT ⇒ dismissible banner once; HARD ⇒ blocking screen with legal + sign-out + deletion reachable; MAINTENANCE ⇒ blocking + retry | PR (HARD), N | A01, Q31 |
| 22 | Mode-scoped kill switch: rider quotes OFF | A, C | rider Where-to disabled with reason; C's Driver area and onboarding unaffected | N | `docs/28` §10, A01 |
| 23 | Mode-scoped kill switch: driver onboarding OFF | A, F, C | A sees no Earn entry; F sees status only; rider quotes unaffected | N | `docs/28` §10, V10 |
| 24 | Lite mode | A | toggle on ⇒ no map, `detail=lite`, manual refresh, stale indicators; toggle persists across restart | N | L08 |
| 25 | Sign-out wipe | C → A on same emulator | after C signs out and A signs in, A starts in Rider mode (preference wiped); no driver data visible | PR, N | V07 (client), Q01 |
| 26 | Urdu + RTL + 200 % font scale screenshots | A, C | screenshots of rider home, quote, fare, driver readiness for review; no clipped CTA (reviewed by a person) | N (capture), M (review) | P18, A06, A08 |
| 27 | TalkBack journey | A, C | labels and focus order per `docs/phase3/PHASE3_MOBILE_UX_AND_NAVIGATION.md` §15 | M | A08 |
| 28 | Release AAB rider hygiene on physical devices | A | first launch, sign-in screen, no prompts; driver modules not evaluated (SP-02 trace) | R | INV-07, V11, Q27 |

---

## 6. Flake policy

- At most **one** automatic retry per flow; a pass on retry is reported as FLAKY in the summary, never as a clean PASS.
- A flow that is flaky twice in 7 days is **quarantined**: moved to a quarantine list with an owner and an expiry date (≤ 14 days), still run nightly, reported in every summary. Quarantine never applies to INV-07 flows (#1, #12) — those block.
- Never silently skip: a flow that cannot run (emulator boot failure, infra failure) is reported BLOCKED with the cause; the job fails rather than passing with fewer flows.
- No `sleep`-based waits; waits are on visible elements with bounded timeouts.
- System-dialog taps are limited to API 35 flows; other permission states are set with `pm grant/revoke` to avoid OEM/locale wording drift.

---

## 7. Runtime budgets

| Tier | Budget | Content |
|---|---|---|
| PR | **≤ 15 min** wall time for emulator boot + flows (build time excluded and reported separately) | flows marked PR, API 35, accounts A, C, D, E core |
| Nightly / scheduled | **≤ 60 min** per run | full matrix, API 29 + API 35 (parallel jobs), screenshots for #26; cadence per FA-16 |
| Release | per release candidate, manual | #12, #26–#28 on physical devices |

The E2E APK is built once (in the Android job or a dedicated job) and passed as an artifact; the added Gradle time and total Actions minutes are measured in Phase 3 and reported to the founder (FA-16). **Cadence justification:** the repository is private, so Actions minutes are finite (GitHub Free: 2,000/month per Phase 0; verify the plan). The Android job already takes ~30–40 min per CI run, and a daily 60-min matrix would add ~1,800 min/month on its own, so "nightly" is not affordable by default. The proposed default (FA-16 option (a)) is: PR tier only on PRs touching mobile paths, the full matrix weekly and before each checkpoint merge, and local emulator runs for daily development; a true nightly needs FA-16 option (b) paid minutes or (c) a self-hosted runner. The PR tier stays ≤ 15 min (Maestro phase) whatever the cadence. If budgets are exceeded, flows move from PR to nightly with founder visibility — PR coverage of #1, #2, #4 (A, C, D, E), #12 and #21 is the floor.

---

## 8. Artefacts

- Per flow: Maestro report (JUnit XML), screenshots at assertions, video for failed flows only; logcat filtered to the app process.
- Synthetic data only; no real phone numbers, OTPs, CNICs, selfies or coordinates of private places. Seeded evidence images are generated and labelled synthetic (as in the web-ops seed).
- Retention 7 days (matching the Android build artefact); nightly summary records PASS/FAIL/FLAKY/BLOCKED/SKIPPED counts per flow and per API level.

---

## 9. V10 enforcement plan

| Step | Phase | Owner |
|---|---|---|
| Maestro scaffold, stack script, E2E build, PR-tier flows running on PRs as an informational (non-required) job | Phase 3 (P3.5) | Claude Code run |
| Full matrix on `main` from a scheduled workflow at the FA-16 cadence + manual dispatch | Phase 3 (P3.10) | Claude Code run |
| Matrix extended with go-online, offers, presence conflicts (INV-05/06), rider trip conflicts | Phase 4 | Phase-4 run |
| PR tier becomes a **required check** in ruleset 24837051 | Phase 4 | **Founder action** (ruleset change; CI cannot change it) |
| Release-tier device runs recorded per release | Phase 7+ | founder devices / device farm decision |

---

## 10. Mode-scoped kill-switch tests

Covered by #22 and #23, plus: a switch disabled at runtime while the app is open takes effect on the next API call or foreground policy refresh (no restart needed); re-enabling requires maker-checker on the server (tested in integration, not in E2E); the app never caches a switch as "enabled" beyond the server's policy response. Driver-scoped switches never change rider screens and vice versa (asserted by screenshots of the unaffected mode).

---

## 11. Phase-3 exit criteria for SP-08

1. ADR-052 accepted by the founder (or replaced) and FA-16 answered.
2. PR tier running on every PR (informational) with the floor flows; three consecutive green runs on `main` reported with run IDs.
3. Full scheduled matrix (accounts A–G, API 29 + 35) executed at least three times (at the FA-16 cadence or by manual dispatch) with results recorded per flow; any FAIL has an issue or fix; quarantine list empty or every entry owned and dated.
4. INV-07 flows (#1, #12) PASS on both API levels; physical-device rider hygiene (#28) PASS on the reference device or recorded BLOCKED-EXTERNAL (FA-03/FA-04).
5. Runtime budgets measured and reported (not assumed).
6. External-link routing explicitly recorded as NOT TESTABLE until EG-15 (not as PASS).
7. Nothing reported as PASS that did not run; emulator results never presented as device evidence.
