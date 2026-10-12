# PHASE3_EXTERNAL_FOUNDER_ACTIONS — What only the founder (or an external party) can do for Phase 3 (PROPOSED)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — pending founder/ChatGPT review; no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

Phase 3 runs as **one authorised implementation run** with internal checkpoints P3.0–P3.10 (`docs/phase3/PHASE3_IMPLEMENTATION_SEQUENCE.md`). Anything below that is missing when its checkpoint arrives is reported **BLOCKED-EXTERNAL**; the run continues with independent checkpoints and **never fabricates evidence**. An interface, a synthetic double, an emulator run or a passing local test never satisfies an external action. Builds on `docs/phase2/PHASE2_EXTERNAL_GATES.md` (EG-01..EG-23) and `docs/phase0/PHASE0_LAUNCH_BLOCKERS.md`.

Cost figures are planning estimates: device prices are Phase 0 research (UNVERIFIED, PKR); provider prices were web-checked on 2026-10-12 and must be re-checked when used. Founder time is Claude's estimate.

## 1. Founder action register (FA-01..FA-18)

| FA | Action | Owner | Needed at (checkpoint) | Exact evidence to hand back | Blocks implementation? | Blocks freeze? | Blocks Phase 3 exit? | Founder time (est.) | Cost (est.) |
|---|---|---|---|---|---|---|---|---|---|
| FA-01 | Approve the Phase 3 plan (this pack) after ChatGPT review | Founder | before the run starts | written approval in chat or a PR review comment naming the planning commit SHA and any changes requested | **YES** — whole run | — | — | 3–5 h reading | 0 |
| FA-02 | Approve the rider foreground location permission delta (COARSE + FINE only) | Founder | P3.5 location sub-step | approval text (template in §2) given on the P3.5 PR diff of `infra/ci/android/permission-allowlist.json` | YES for the location sub-step only (manual search + pin flow proceeds) | no | YES for A07/B01 "current location" acceptance | 30–60 min | 0 |
| FA-03 | Provide SP-01 real devices (3 OEM classes), USB debugging, 60-min runs | Founder | P3.6 | device sheet (model, Android version, OEM skin version, RAM; no serial/IMEI) as plain text in chat; devices connected for runs; founder confirms each run was performed as scripted | no | **YES** — ADR-029 and ADR-003 freeze | YES (SP-01 evidence) | ≈ 15–17 h active / ≈ 21–26 h wall-clock for the three freeze devices, over ~1–2 weeks (per `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md` §16) | 0 if borrowed; buying a set ≈ PKR 120–150 K (Phase 0, UNVERIFIED) |
| FA-04 | Provide the SP-02 reference low-end device (may be the Transsion SP-01 device) | Founder | P3.6 (baseline before maps) and P3.7 (after renderer) | device sheet as FA-03; device available over USB for R1a (~1 h), R1b (~3–3.5 h) and R2 (~3–4 h) | no | **YES** — budget PASS, renderer freeze (ADR-046) | YES (V11/Q26/Q27 evidence) | ≈ 7.5–9 h incl. setup, plus ~1.5 h per extra renderer candidate (per `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md` §14) | 0 if borrowed (same device as FA-03) |
| FA-05 | SP-04 Lahore field drives + desk captures (≥ 50 cases, target 60) | Founder | from P3.2 (harness ready) until P3.7 | completed `docs/phase3/PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv` copy (kept local, shared as instructed in `docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md`) + GPX tracks kept local | no | **YES** — ADR-006 provider freeze | YES for E06/B01–B03 freeze evidence | 4 sessions (S1–S3 2–3 h each, S4 ≈ 2 h; optional S5) ≈ 8–11 h + 2–3 h desk work | fuel/data — founder estimate |
| FA-06 | Create provider evaluation accounts (Google Cloud, Mapbox; optional HERE/TomTom) with quotas; keys only in local untracked `.env` | Founder | P3.2 (harness), before SP-04 runs | in chat: "FA-06 done: Google project created, APIs X/Y/Z enabled, quotas set to N/day, budget alert set; Mapbox token created; keys stored in local .env" — **never the keys themselves** | no | YES for comparing those vendors in SP-04 (open stack can still be benchmarked) | no (partial SP-04 possible) | 1.5–3 h | 0 within free allowances; a payment card is required to open Google Cloud billing (and may be for Mapbox) |
| FA-07 | Approve SP-04 thresholds and Phase 3 performance budgets | Founder (+ChatGPT review) | before P3.6 measurements are judged | written approval naming `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md` and the SP-04 threshold table, with any changed numbers | no | YES — no budget or threshold can be reported PASS without it | YES | 1–2 h | 0 |
| FA-08 | Approve any paid spend (Transistorsoft licence only if SP-01 candidate A fails; Google beyond free tier only if SP-04 shows a quality need) | Founder | P3.6 (FD-08) / P3.7 (provider) | written approval with amount and vendor; purchase done by founder | no | conditional — only if the free path fails | conditional | 30 min per decision | Transistorsoft Starter USD 399 one-time (1 app key, web-checked 2026-10-12); Google per SP-04 volumes |
| FA-09 | Native Urdu + Roman-Urdu reviewer for all new rider/driver strings and search aliases | Founder (recruits reviewer) | P3.9 export → before exit | returned review sheet (§6) with reviewer name/initials, date and declaration | no | no | **YES** for P18/A06/K19 (strings stay "pending native review" until then) | 1 h to brief; reviewer 3–6 h | founder decides (paid or volunteer) |
| FA-10 | Approve new staff roles (PRICING_MANAGER, CATALOG_MANAGER, RELEASE_MANAGER) or a mapping onto existing roles | Founder | P3.1 | one-line decision in chat | no (if unanswered: the new permissions are mapped onto COMPLIANCE_ADMIN/STAFF_ADMIN and the conditional `0010_catalog_products_zones` section widening the `staff.role_assignments.role` CHECK is omitted) | no | no | 15 min | 0 |
| FA-11 | Approve the product lifecycle policy (BIKE/RICKSHAW stay MODELLED + DISABLED_LEGAL_GATE; ECONOMY CONFIGURED only in local/test) | Founder | P3.1 | one-line decision in chat | no | no | no | 15 min | 0 |
| FA-12 | Decide synthetic vs real Lahore zone boundaries and the district boundary source (licence) | Founder (+counsel for licence) | P3.1 (synthetic is the default) | decision; for real data: source name, licence text/link, and the boundary files kept local | no | no | no (real boundaries needed only before pilot) | 30 min now; more before pilot | 0 now |
| FA-13 | iPhone (iOS 26) physical device | Founder | **not Phase 3** — before serious iOS validation (Phase 7) | device model + iOS version | no | **no** (not an Android freeze blocker) | no | — | device cost later |
| FA-14 | TalkBack user / accessibility tester (optional, recommended) | Founder | P3.9–P3.10 | tester notes (screen, issue, severity) | no | no | no (A08 exit uses Claude's device checks + automated checks; external tester strengthens evidence) | 1 h coordination | founder decides |
| FA-15 | Toll, rounding and tax policy for the pilot | Founder + accountant/counsel | **Phase 8** (not Phase 3) | written policy | no | no | no (synthetic PKR 10 HALF_UP labelled synthetic) | — | accountant fees later |
| FA-16 | Approve Maestro + GitHub Actions emulator minutes (runtime budget) | Founder | P3.5 (PR tier) / P3.10 (scheduled matrix) | decision on tier schedule and minute budget (§8) | no | no | YES for V10 "scaffolded" evidence if no CI tier is allowed (local runs remain possible) | 15–30 min | depends on plan (§8) |
| FA-17 | Approve and provide a temporary HTTPS-reachable **synthetic** API endpoint for the release app (e.g. a tunnel to the local API runner with synthetic data only, torn down after each session) or a staging host | Founder | P3.6 (SP-02 R1b/R2, SP-01 TC-01) | in chat: "FA-17: option tunnel/staging approved for sessions on <dates>; synthetic data only" — never credentials or tunnel tokens | no | YES for SP-02 signed-in budgets (PB-01, PB-07, PB-09, PB-11, PB-12) and SP-01 TC-01 runtime check — those items are **NOT RUN** without it | YES (those SP-02/SP-01 items) | 30–60 min decision + presence per session | 0 for a free tunnel tier (verify terms); staging host cost per later hosting decision |
| FA-18 | (Optional) create an FCM/Firebase project for the SP-01 push-wake test (R4 item 6, TC-22) | Founder | P3.6 | in chat: "FA-18 done: Firebase project created, config stored locally" — never keys | no | no (ADR-033: push is a wake aid only) | no — without it TC-22 is **NOT RUN** and push-wake stays a Phase-4 item | 1–2 h | 0 within free allowances (verify) |

## 2. FA-02 — How to review and approve the permission delta

**What is being asked:** allow `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` (while the app is in use) in the **release** app, requested only when a rider taps "use current location". The driver readiness screen only **reads** the permission status and never requests it in Phase 3. Nothing else.

Steps:
1. Read `docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md` (when, why, denial and approximate-only behaviour) and `docs/phase3/PHASE3_SECURITY_COST_THREAT_MODEL.md` T3-34.
2. Open the P3.5 PR and look at the diff of `infra/ci/android/permission-allowlist.json`. Check:
   - exactly two entries move from `forbidden` to `allowed`: `android.permission.ACCESS_COARSE_LOCATION` and `android.permission.ACCESS_FINE_LOCATION`;
   - each has a justification and requirement IDs (B01, B02, A07, V05, U05);
   - `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS` and `USE_FULL_SCREEN_INTENT` are **still forbidden**.
3. Look at the CI evidence in the PR: the release-AAB permission check output lists only INTERNET, the AndroidX dynamic-receiver permission, CAMERA, COARSE and FINE location.
4. Read the iOS usage text (`NSLocationWhenInUseUsageDescription`) and the in-app rationale copy in English (Urdu/Roman-Urdu go to FA-09).
5. Note for later (not Phase 3): from **2027-01-27** Google Play requires a location declaration and review for any app requesting location; FINE location is allowed only when COARSE cannot support the feature, so Wayvro's declaration must justify precise pickup (a driver must find the rider at the right gate/entrance). Play Console pre-review checks start **2026-10-27**, but they only matter once an AAB with location is uploaded to Play — there is no Play upload in Phase 3 (EG-18). Facts web-checked 2026-10-12.

What to write (copy, edit if needed):
> "FA-02 approved for PR #<n> at commit <sha>: release app may declare ACCESS_COARSE_LOCATION and ACCESS_FINE_LOCATION, requested just in time for rider 'use current location' only (driver readiness reads the status, never requests), approximate-only must keep working, manual pin must always work. Background location, foreground service, notifications and full-screen intent remain forbidden."

If you do **not** approve, say "FA-02 not approved"; the rider flow stays manual search + pin and A07/B01 current-location acceptance is reported BLOCKED-EXTERNAL.

## 3. FA-03 / FA-04 — Device procurement and preparation

**Classes required for SP-01 (≥ 3 OEM classes, must include Transsion + Xiaomi + Samsung or Vivo):**

| Class | Acceptable models (or same-class successor; verify the exact model name locally) | Why |
|---|---|---|
| Transsion (required) | Infinix Smart 10 / Smart 9, Tecno Spark 30C / Spark Go class | most common low-end Pakistani class; aggressive battery management; also the SP-02 reference class |
| Xiaomi (required) | Redmi 14C / 13C / A5 / A3 class (HyperOS) | known background-kill behaviour |
| Samsung or Vivo (one required, both better) | Samsung Galaxy A06 / A05 / A15 / A16 class (One UI); Vivo Y04 / Y19s class (Funtouch/Origin OS) | second large market share; different battery policies |
| iPhone | not for Phase 3 (FA-13) | iOS evidence is Phase 7 |

**Minimum specs / conditions:**
- Stock OEM firmware (no custom ROM), **not rooted**, Google Play services present, Android 13 or newer on at least two devices and Android 14/15 on at least one; RAM 3–4 GB for the Transsion device (SP-02 reference), any for others.
- A working SIM with mobile data for the drive runs (4G), plus Wi-Fi for installs.
- Free storage ≥ 4 GB; battery health normal (record the battery percentage at start; SP-01 measures drain).
- **Borrowed devices are fine.** Ask the owner's permission; the owner's accounts stay as they are — Claude installs only the spike/release test app over USB and uninstalls it afterwards; no personal data is read; device serials/IMEIs are not recorded (model + OS build only).

**Preparation (founder, ~20 min per device):** Settings → About phone → tap "Build number" 7 times → Developer options → enable "USB debugging"; connect by USB to the laptop; accept the "Allow USB debugging" prompt; tell Claude "device <class> connected". For SP-01 runs follow `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md` (screen-off 60-min runs, carrying the device while moving or driving as scripted; **never handle the phone while driving** — mount it or let a passenger handle it). For SP-02 follow `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md`.

## 4. FA-05 — SP-04 Lahore field benchmark (summary)

Full procedure: `docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md`; capture sheet: `docs/phase3/PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv` (header + synthetic EXAMPLE rows only).
- ≥ 50 cases (target 60) across 12 categories, in 4 sessions (S1–S3 2–3 h each, S4 peak ≈ 2 h; optional S5) plus ≈ 2–3 h desk work.
- Founder captures ground truth: GPS track (phone GPS logger app exporting GPX), odometer/trip distance, actual drive time, the correct pickup point and the correct address text.
- **Safety:** a passenger records data, or you stop safely first. Never type while driving.
- **Privacy:** start and stop GPS logging at least 500 m away from any private home; use public landmarks; never write private addresses or phone numbers in the sheet; keep raw tracks local (T3-32).
- Claude runs the provider queries through the harness (server-side, dev-only) with identical inputs; raw provider responses stay local and are never committed (provider terms).

## 5. FA-06 — Provider evaluation accounts (step by step)

**Rules for every vendor:** create accounts in **your** name/custody for evaluation (production accounts move to company custody after EG-14); store keys **only** in the local, git-ignored `.env` at the repository root (confirmed ignored by `.gitignore`); **never paste a key into chat, an issue, a PR, a commit, a screenshot or a document**; tell Claude only the variable names. Console menu names below are from planning-time knowledge — **verify against the current console UI**.

### 5.1 Google Cloud (Maps Platform) — verify against current console UI
1. Go to the Google Cloud console, create a **new project** dedicated to evaluation (suggested name: `wayvro-geo-eval`). Do not reuse the OAuth project from EG-06.
2. Billing: link a billing account (Google requires one even for free usage). Free caps per SKU per month were Essentials 10,000 / Pro 5,000 / Enterprise 1,000 on 2026-10-12.
3. APIs & Services → Library: enable **only** the APIs SP-04 needs: Places API (New) (autocomplete + place details), Geocoding API (forward + reverse), Routes API (Compute Routes). Do **not** enable Maps SDK, Distance Matrix, Navigation or others unless Claude asks for a renderer test.
4. APIs & Services → each enabled API → **Quotas**: set per-day request limits so a month cannot exceed the free cap (rule of thumb: free monthly cap ÷ 31, minus 20 % — e.g. ≈ 250/day for a 10,000 cap). The harness also stops itself before that limit.
5. Billing → **Budgets & alerts**: create a budget of a small amount (e.g. USD 1) with alerts at 50 %, 80 % and 100 % to your e-mail. Budgets **only notify — they do not stop spending**; the per-day quotas are the hard stop.
6. APIs & Services → Credentials → **Create API key** → restrict it: *API restrictions* = only the three APIs above; *Application restrictions* = IP addresses = your current public IP (home broadband IPs in Pakistan can change — if calls start failing with a restriction error, update the IP). If IP restriction is impractical, keep the key unrestricted by IP but API-restricted, with quotas, and revoke it promptly after SP-04.
7. Copy the key into `.env` as `WAYVRO_GEO_BENCH_GOOGLE_KEY=<key>` (variable name proposed; Claude will confirm the exact name at P3.2). Tell Claude: "Google key stored in .env".
8. **Revoke after SP-04:** delete the API key, disable the three APIs, and optionally shut down the project; tell Claude "Google eval key revoked".

### 5.2 Mapbox — verify against current console UI
1. Create a free Mapbox account (a payment card may be requested; free allowances on 2026-10-12: 25,000 mobile MAU, 100,000 temporary geocoding requests, 100,000 Directions requests per month).
2. Account → Tokens → **Create a token** for evaluation with the **minimum scopes** (public read scopes only; no secret/write scopes). Add a note "wayvro sp-04 eval".
3. Mapbox offers no console hard quota that Claude could confirm — the harness counters are the cap; check the Statistics page after each session.
4. Store as `WAYVRO_GEO_BENCH_MAPBOX_TOKEN=<token>` in `.env`.
5. Terms to note (for the ADR-006 decision, not for you to resolve): temporary geocoding results may not be cached and may only be used with a Mapbox map; Mapbox mobile SDK telemetry requires an end-user opt-out.
6. **Revoke after SP-04:** delete the token in Account → Tokens.

### 5.3 Optional: TomTom / HERE
Only if you want a fourth candidate. TomTom listed free monthly allowances (e.g. 20,000 geocoding, 20,000 routing) on 2026-10-12; HERE requires a payment method (secondary report). Pakistan coverage for both is unknown. Same rules: evaluation key, minimal scope, `.env` only, revoke after SP-04.

### 5.4 Open stack
No account needed. Claude runs OSRM/Valhalla and Photon/Nominatim locally in an optional `geo-bench` compose profile with a Pakistan OpenStreetMap extract. The public Nominatim server is **not** used (its policy prohibits autocomplete and systematic reverse geocoding).

## 6. FA-09 — Native reviewer brief (Urdu + Roman-Urdu)

**Who:** a native Urdu speaker fluent in everyday Lahore usage, who also reads and writes Roman-Urdu the way people type on WhatsApp/SMS; ideally has used a ride-hailing app. Not machine-translation-only review (P18).

**What they receive (exported by Claude at P3.9):** a sheet with columns string key, screen, English, Urdu (script), Roman-Urdu, context note, maximum length, and screenshots of each new screen in each language (synthetic data only); plus a list of Roman-Urdu/Urdu search aliases for common Lahore areas and landmarks.

**What they check:**
1. Meaning matches the English; nothing unsafe or ambiguous in safety, price, permission or legal text.
2. Natural, polite, gender-neutral where possible; consistent terms (fare, pickup, drop-off, ride, driver/partner).
3. Numbers, currency ("Rs" vs "روپے") and time formats read naturally; right-to-left layout looks correct on the screenshots.
4. Text fits (no truncation on screenshots).
5. Search aliases: common spellings people actually type (e.g. several Roman-Urdu spellings of one area name), and wrong aliases flagged.

**What they return:** the same sheet with a status per row (OK / CHANGE / QUESTION), corrected text, their name or initials, the date, and the sentence "I reviewed this personally and did not rely only on machine translation." Claude applies the changes, and only then are the strings marked reviewed. Estimated reviewer time 3–6 h depending on string count. No personal user data is ever included.

## 7. FA-13 — iPhone timing

Not needed for any Phase 3 Android freeze (SP-01/SP-02/SP-04 Android). Needed before serious iOS release/pilot validation (Phase 7, TestFlight; App Store production in Phase 9 per Q49). Acceptable: a model that runs iOS 26 (Apple's supported list — verify before buying). Installing development builds on a physical iPhone also needs either the Apple Developer Program (EG-07/E2, organisation account after incorporation) or short-lived free provisioning through Xcode on a Mac — both are Phase 7 topics. Phase 3 keeps iOS-relevant code paths (location usage string, approximate handling) unit-tested and builds only what the existing CI builds.

## 8. FA-16 — Maestro and CI minutes

The repository is **private** (checked 2026-10-12), so GitHub Actions minutes are limited. Phase 0 recorded GitHub Free at 2,000 Actions minutes/month for private repositories; verify your plan in GitHub Settings → Billing. The existing `ci.yml` runs five jobs on every push/PR with no paths filter; the Android job alone takes ~30–40 minutes per run (75-minute timeout). A daily 60-minute nightly matrix (SP-08) would add ~1,800 minutes/month on its own, so **the proposed nightly cadence does not fit a 2,000-minute allowance**. Options for your decision:
- (a) PR-tier Maestro smoke (Maestro phase ≤ 15 min) only on PRs touching mobile paths; full matrix weekly + before each Phase-3 checkpoint merge; local emulator runs by Claude for daily development (Claude recommends this within the free allowance);
- (b) pay for extra minutes (price per minute — verify current GitHub pricing);
- (c) a self-hosted runner on your laptop (needs a separate security decision: a private-repo runner on a personal machine).
Write: "FA-16: option (a)/(b)/(c), monthly minute budget N".

How it would be wired (for your decision, built by Claude at P3.5/P3.10): a new short-named job (e.g. "Mobile E2E") in the existing CI workflow for the PR tier, building its own x86_64 emulator variant that never touches the gated release AAB (a release-purity check proves it); the broader matrix in a **new scheduled workflow**. Making "Mobile E2E" a **required** check is a change to ruleset 24837051 that only you can make in GitHub Settings → Rules — keep the check name short, because required-check contexts are truncated at 100 characters (the Phase 2 closure recorded this for the Integration job). Until you change the ruleset, the job runs but does not block merges.

## 8a. FA-17 — Temporary HTTPS synthetic endpoint (SP-02 signed-in runs, SP-01 TC-01)

Why: the release app accepts only an `https` API origin outside development builds, and no staging host exists. Without an HTTPS endpoint, the signed-in SP-02 measurements (PB-01, PB-07, PB-09, PB-11, PB-12) and the runtime part of SP-01 TC-01 are **NOT RUN** (`docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md` §5.4, `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md` P-5).

Options for your decision: (a) a temporary tunnel from a publicly trusted HTTPS hostname to the local API runner, opened only during a measurement session, serving **synthetic data only** (synthetic phone numbers through the local recording OTP sink, synthetic zones and rate cards), torn down afterwards — a new external service, so read its terms first; (b) a staging host once hosting is decided (later phase). Claude builds a local release AAB pointing at the approved origin and never commits tunnel URLs or tokens.

Write: "FA-17: option (a)/(b) approved for sessions on <dates>; synthetic data only."

## 8b. FA-18 — Optional FCM/Firebase project (SP-01 push-wake, TC-22)

Optional. ADR-033 makes push a wake/alert aid only, so no freeze depends on it. If you want R4 item 6's push part measured in Phase 3, create a dedicated Firebase project for the spike (separate from any production or OAuth project), keep its config file local and untracked, and tell Claude "FA-18 done". Without FA-18, TC-22 is reported **NOT RUN** and push-wake measurement moves to Phase 4.

## 9. Existing external gates that touch Phase 3 (all remain OPEN)

| Gate | Phase 3 impact | Status |
|---|---|---|
| EG-02 counsel-approved texts | privacy notice must describe location processing, map/geo provider sharing and quote retention; location rationale wording | OPEN |
| EG-03 Punjab driver/vehicle matrix | real vehicle eligibility rule values (H10) — Phase 3 uses synthetic rules | OPEN |
| EG-04 route permits etc. | BIKE/RICKSHAW stay DISABLED_LEGAL_GATE | OPEN |
| EG-05 production storage + KMS | placeRef and cache-key key classes join the KMS scope | OPEN |
| EG-06 Google Cloud OAuth project | must stay separate from the Maps evaluation project | OPEN |
| EG-11 provider DPAs/contracts | map/geo provider DPA, sub-processors and terms review before production use | OPEN |
| EG-12 data location | quote coordinates, route snapshots and geo usage data join the location-data inventory (Singapore provisional, FD-03) | OPEN |
| EG-14 company/NTN | production provider accounts in company custody | OPEN |
| EG-15 domain/brand | any external deep link, App Link or universal link (V08 external registration) and store URL keys | OPEN |
| EG-16 retention matrix | 30-day quote/route-snapshot purge is a placeholder; geo cache TTLs; SP-04 raw data deletion | OPEN |
| EG-17 independent security assessment | geo/quote/config/staff-pricing endpoints join the Phase 7 scope | OPEN |
| EG-18 store declarations | Play location declaration (from 2027-01-27; FINE justified only if COARSE insufficient), Data safety entries for location and map SDK collection, iOS privacy manifest | OPEN |
| EG-21 alerting/on-call | destination for budget, breaker, switch and version-policy signals | OPEN |
| Phase 0 E6 / D2 | staged devices; maps licence + field test | OPEN (FA-03..FA-06) |

## 10. What Claude will NOT do

- Create, log into or configure any provider, store, cloud or billing account; accept any terms of service on the founder's behalf.
- Pay for, purchase, or approve any spend (devices, licences, minutes, provider usage).
- Drive, collect field ground truth, or handle the founder's GPS tracks beyond local analysis.
- Act as or sign for the native-language reviewer, accessibility tester, counsel, accountant or any approver; mark strings "reviewed" without the returned sheet.
- Receive, print, log, commit or repeat API keys or tokens; if one is pasted into chat, Claude will ask the founder to revoke it.
- Report any freeze, budget or threshold as PASS without real-device or field evidence; emulator results never close a real-device gate.
- Register an external URL scheme, App Link or universal link, or upload anything to Google Play or App Store Connect.
- Change the permission allowlist beyond what FA-02 approves.
- Change the repository ruleset or required checks, or renew a security exception by silently moving its date.

## 11. Dated items during the Phase 3 run

| Date | Item | What happens | Who acts |
|---|---|---|---|
| 2026-10-27 | Google Play Console location pre-review checks start | no effect while no location-bearing AAB is uploaded to Play (none in Phase 3) | founder, later (EG-18) |
| 2026-12-31 | `osv-scanner.toml` exception for decode-uri-component (GHSA-vcc3-ghjq-m6fr) expires | the Security CI job fails from 2027-01-01 unless the dependency is upgraded or the exception is renewed with a fresh, true reachability justification in a reviewed change (after P3.0 removes the release scheme, "no external scheme" is true again) | Claude prepares the change; founder approves the renewal |
| 2027-01-09 | the four tooling exceptions in `osv-scanner.toml` expire | same rule: upgrade or reviewed renewal | Claude prepares; founder approves |
| 2027-01-27 | Play location declaration + review required for apps requesting location; FINE only if COARSE cannot support the feature | declaration text (precise pickup justification) is drafted in Phase 3; submission happens with the first Play upload (EG-18) | founder submits |
