# PHASE3_EXTERNAL_FOUNDER_ACTIONS — What only the founder (or an external party) can do for Phase 3 (PROPOSED)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — founder/ChatGPT plan review recorded 2026-10-12 (decisions in §1a); no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

Phase 3 runs as **one authorised implementation run** with internal checkpoints P3.0–P3.10 (`docs/phase3/PHASE3_IMPLEMENTATION_SEQUENCE.md`). Anything below that is missing when its checkpoint arrives is reported **BLOCKED-EXTERNAL**; the run continues with independent checkpoints and **never fabricates evidence**. An interface, a synthetic double, an emulator run or a passing local test never satisfies an external action. Builds on `docs/phase2/PHASE2_EXTERNAL_GATES.md` (EG-01..EG-23) and `docs/phase0/PHASE0_LAUNCH_BLOCKERS.md`.

Cost figures are planning estimates: device prices are Phase 0 research (UNVERIFIED, PKR); provider prices were web-checked on 2026-10-12 and must be re-checked when used. Founder time is Claude's estimate.

## 1. Founder action register (FA-01..FA-19)

| FA | Action | Owner | Needed at (checkpoint) | Exact evidence to hand back | Blocks implementation? | Blocks freeze? | Blocks Phase 3 exit? | Founder time (est.) | Cost (est.) |
|---|---|---|---|---|---|---|---|---|---|
| FA-01 | Approve the Phase 3 plan (this pack) after ChatGPT review | Founder | before the run starts | **APPROVED 2026-10-12** (founder/ChatGPT plan review), subject to the review-closure correction being merged | no (approved) | — | — | done | 0 |
| FA-02 | Rider foreground location permission delta (COARSE + FINE only) | Founder | P3.5 location sub-step | **APPROVED 2026-10-12** for the Phase-3 implementation branch (exact scope in §2); the `infra/ci/android/permission-allowlist.json` diff is visible in the single Phase-3 PR | no (approved) | no | no (approved; A07/B01 current-location acceptance still needs its normal test evidence) | done | 0 |
| FA-03 | Provide SP-01 real devices (3 OEM classes), USB debugging, 60-min runs | Founder | P3.6 | **OPEN** — genuine founder action once P3.6 creates the harness: device sheet (model, Android version, OEM skin version, RAM; no serial/IMEI) as plain text in chat; devices connected for runs; founder confirms each run was performed as scripted | no | **YES** — ADR-029 and ADR-003 freeze | YES (SP-01 evidence; missing at P3.10 → BLOCKED-EXTERNAL/PARTIAL and Phase 3 is not merged as complete) | ≈ 15–17 h active / ≈ 21–26 h wall-clock for the three freeze devices, over ~1–2 weeks (per `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md` §16) | 0 if borrowed; buying a set ≈ PKR 120–150 K (Phase 0, UNVERIFIED) |
| FA-04 | Provide the SP-02 reference low-end device (may be the Transsion SP-01 device) | Founder | P3.6 (baseline before maps) and P3.7 (after renderer) | **OPEN** — genuine founder action: device sheet as FA-03; device available over USB for R1a (~1 h), R1b (~3–3.5 h) and R2 (~3–4 h) | no | **YES** — budget PASS, renderer freeze (ADR-046) | YES (V11/Q26/Q27 evidence; missing at P3.10 → BLOCKED-EXTERNAL/PARTIAL) | ≈ 7.5–9 h incl. setup, plus ~1.5 h per extra renderer candidate (per `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md` §14) | 0 if borrowed (same device as FA-03) |
| FA-05 | SP-04 Lahore field drives + desk captures (≥ 50 cases, target 60) | Founder | from P3.2 (harness ready) until P3.7 | **OPEN** — genuine founder action: completed `docs/phase3/PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv` copy (kept local, shared as instructed in `docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md`) + GPX tracks kept local | no | **YES** — ADR-006 provider freeze | YES for E06/B01–B03 freeze evidence (missing at P3.10 → BLOCKED-EXTERNAL/PARTIAL; no provider is guessed or frozen) | 4 sessions (S1–S3 2–3 h each, S4 ≈ 2 h; optional S5) ≈ 8–11 h + 2–3 h desk work | fuel/data — founder estimate |
| FA-06 | Create provider evaluation accounts (Google Cloud, Mapbox; optional HERE/TomTom) with quotas; keys only in local untracked `.env` | Founder | P3.2 (harness), before SP-04 runs | **OPEN** — genuine founder action; in chat: "FA-06 done: Google project created, APIs X/Y/Z enabled, quotas set to N/day, budget alert set; Mapbox token created; keys stored in local .env" — **never the keys themselves** | no | YES for comparing those vendors in SP-04 (open stack can still be benchmarked) | no (partial SP-04 possible) | 1.5–3 h | 0 within free allowances; a payment card is required to open Google Cloud billing (and may be for Mapbox) |
| FA-07 | SP-04 thresholds and Phase 3 performance budgets | Founder (+ChatGPT review) | before P3.6 measurements are judged | **APPROVED 2026-10-12** as the Phase-3 **pre-measurement** budgets (`docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md`) and SP-04 thresholds, plus the new SP-04 route-critical hard gate (§1a); budgets change only through explicit evidence + a reviewed ADR update, never tuned after seeing measurements to obtain PASS | no (approved) | no (approved; a PASS still needs measured evidence) | no (approved) | done | 0 |
| FA-08 | Approve any paid spend (Transistorsoft licence only if SP-01 candidate A fails; paid map/geo use beyond free tiers only if SP-04 shows a quality need) | Founder | P3.6 (FD-08) / P3.7 (provider) | **OPEN — no paid spend is pre-approved (2026-10-12)**; each spend needs a specific founder decision after evidence: written approval with amount and vendor; purchase done by founder | no | conditional — only if the free path fails | conditional | 30 min per decision | Transistorsoft Starter USD 399 one-time (1 app key, web-checked 2026-10-12); Google per SP-04 volumes |
| FA-09 | Native Urdu + Roman-Urdu reviewer for all new rider/driver strings and search aliases | Founder (recruits reviewer) | P3.9 export → before exit | **OPEN** — native human review remains required before Phase-3 exit (confirmed 2026-10-12; AI copy alone never satisfies it): returned review sheet (§6) with reviewer name/initials, date and declaration | no | no | **YES** for P18/A06/K19 (strings stay "pending native review" until then) | 1 h to brief; reviewer 3–6 h | founder decides (paid or volunteer) |
| FA-10 | New staff roles PRICING_MANAGER, CATALOG_MANAGER, RELEASE_MANAGER | Founder | P3.1 | **APPROVED 2026-10-12**: dedicated least-privilege roles (COMPLIANCE_ADMIN/STAFF_ADMIN are not overloaded); the expand-safe widening of the `staff.role_assignments.role` CHECK in migration `0010_catalog_products_zones` is **required**; real maker-checker needs distinct human actors before exposure (synthetic test staff allowed in development) | no (approved) | no | no | done | 0 |
| FA-11 | Product lifecycle policy | Founder | P3.1 | **APPROVED 2026-10-12**: BIKE/RICKSHAW may be MODELLED and stay DISABLED_LEGAL_GATE until written legal/permit/insurance evidence; ECONOMY may be CONFIGURED/ENABLED only in local/test synthetic Phase-3 configuration; production/pilot activation is separately gated | no (approved) | no | no | done | 0 |
| FA-12 | Synthetic vs real Lahore zone boundaries | Founder (+counsel for licence later) | P3.1 | **DECIDED 2026-10-12**: SYNTHETIC Lahore zones/boundaries for Phase-3 engineering; no unreviewed real boundary import; real licensed/approved boundaries are a later pilot/external item (source name, licence text/link, files kept local) | no (decided) | no | no (real boundaries needed only before pilot) | done now; more before pilot | 0 now |
| FA-13 | iPhone (iOS 26) physical device | Founder | **not Phase 3** — before serious iOS validation (Phase 7) | device model + iOS version | no | **no** (not an Android freeze blocker) | no | — | device cost later |
| FA-14 | TalkBack user / accessibility tester (optional, recommended) | Founder | P3.9–P3.10 | tester notes (screen, issue, severity) | no | no | no (A08 exit uses Claude's device checks + automated checks; external tester strengthens evidence) | 1 h coordination | founder decides |
| FA-15 | Toll, rounding and tax policy for the pilot | Founder + accountant/counsel | **Phase 8** (not Phase 3) | written policy | no | no | no (synthetic PKR 10 HALF_UP labelled synthetic) | — | accountant fees later |
| FA-16 | Maestro + GitHub Actions emulator minutes (runtime budget) | Founder | P3.5 (PR tier) / P3.10 (manual full matrix) | **APPROVED 2026-10-12** (§8): bounded PR smoke tier ≤ 15 min; full cross-mode matrix on a manual `workflow_dispatch` workflow, mandatory at Phase-3 final closure; no nightly/scheduled full matrix while the repository is private (a schedule only later, after observing Actions-minute cost) | no (approved) | no | no (approved) | done | within the free allowance (verify) |
| FA-17 | Temporary HTTPS-reachable **synthetic** API endpoint for the release app (ephemeral vetted tunnel or later staging) | Founder | P3.6 (SP-02 R1b/R2, SP-01 TC-01) | **APPROVED IN PRINCIPLE 2026-10-12 for SP-01/SP-02 only** (§8a): synthetic data only, minimum local synthetic API exposed, torn down after each session, tunnel terms/security verified before use; the founder is present for each session — never credentials, tunnel tokens or URLs committed | no | YES for SP-02 signed-in budgets (PB-01, PB-07, PB-09, PB-11, PB-12) and SP-01 TC-01 runtime check — if no acceptable free temporary option exists, those items stay **BLOCKED** (TLS is never weakened; never a cleartext release build) | YES (those SP-02/SP-01 items) | 30–60 min decision + presence per session | 0 for a free tunnel tier (verify terms); staging host cost per later hosting decision |
| FA-18 | FCM/Firebase project for the SP-01 push-wake test (R4 item 6, TC-22) | Founder | **Phase 4** | **DEFERRED to Phase 4 (2026-10-12)**: no Firebase project now; the SP-01 TC-22 push-wake portion is **NOT RUN** in Phase 3 | no | no (ADR-033: push is a wake aid only) | no | — | 0 now |
| FA-19 | Mapbox Commercial Application License confirmation (§8c) | Founder (+ counsel) | before P3.7, **only if** S2 (Mapbox) is a freeze candidate | written Mapbox sales/legal clarification of whether the Commercial Application License applies to Wayvro Rider/Driver use, and on what terms — no fee is invented or assumed | no | **YES for an S2 freeze** — no pilot/production S2 freeze while unresolved (SP-04 evaluation may still use a permitted evaluation/free account under its terms) | no (blocks only an S2 freeze) | 1–3 h + vendor response time | unknown — Mapbox describes an annual subscription and, where applicable, a per-user or seat component; not estimated |

## 1a. Founder/ChatGPT plan review decisions (2026-10-12)

| FA | Decision | Effect on the run |
|---|---|---|
| FA-01 | APPROVED (subject to the review-closure correction being merged) | the full implementation run may start |
| FA-02 | APPROVED for the Phase-3 implementation branch (scope in §2) | the P3.5 location sub-step proceeds; it has no BLOCKED-EXTERNAL path |
| FA-07 | APPROVED as Phase-3 **pre-measurement** budgets and SP-04 thresholds, with the new SP-04 **route-critical hard gate**: an unresolved CRITICAL route invalidity (wrong-way on a one-way, private/inaccessible segment used as normal routing, prohibited/closed passage, unsafe/impossible manoeuvre, systematic severe defect) makes a bundle ineligible for freeze; clearable only by ground-truth correction, evidence-backed provider/config/map-data correction plus re-run, or a founder-signed product mitigation proving the route is never presented/used. The 30.0 MB arm64-v8a / 29.0 MB armeabi-v7a download budget stays the initial hard target; if every admissible renderer exceeds it, it is not silently raised — evidence and a bounded founder decision come before the provider/renderer freeze | budgets/thresholds are fixed before measurement; they change only via evidence + a reviewed ADR update |
| FA-10 | APPROVED dedicated PRICING_MANAGER, CATALOG_MANAGER, RELEASE_MANAGER | the migration 0010 role CHECK widening is required (expand-safe) |
| FA-11 | APPROVED lifecycle policy | BIKE/RICKSHAW MODELLED + DISABLED_LEGAL_GATE; ECONOMY enabled only in local/test synthetic config |
| FA-12 | DECIDED synthetic Lahore zones/boundaries | no real boundary import in Phase 3 |
| FA-16 | APPROVED PR smoke ≤ 15 min + manual `workflow_dispatch` full matrix (mandatory at final closure); no nightly by default | no scheduled full-matrix workflow is created |
| FA-17 | APPROVED IN PRINCIPLE for SP-01/SP-02 only (§8a) | signed-in device runs proceed when the founder opens a vetted tunnel; otherwise BLOCKED (never cleartext) |
| FA-18 | DEFERRED to Phase 4 | SP-01 TC-22 push-wake portion NOT RUN in Phase 3 |
| FA-08 | no paid spend pre-approved | any Transistorsoft licence or paid map spend needs a specific founder decision after evidence |
| FA-09 | native Urdu/Roman-Urdu human review still required before Phase-3 exit | AI copy alone never satisfies P18/A06/K19 |
| FA-03..FA-06 | remain genuine founder/external actions once the harnesses exist | no provider credentials committed |
| FA-19 | NEW — Mapbox commercial-licence confirmation (§8c) | blocks an S2 freeze only, not implementation |

**Full-run evidence rule:** the run proceeds through P3.0–P3.10 automatically without routine founder approvals or per-checkpoint PRs, but Phase 3 is **not** declared or merged as complete while required real-world evidence is missing (SP-01 real devices, SP-02 low-end device, SP-04 Lahore field, native Urdu review). If missing at P3.10, the affected IDs/freezes are classified BLOCKED-EXTERNAL / PARTIAL, all safe engineering work is completed, and no provider or background-location architecture is guessed or frozen (`docs/phase3/PHASE3_IMPLEMENTATION_SEQUENCE.md` §1.1). This is not a new macro phase.

## 2. FA-02 — Approved permission delta (scope and how to check it)

**What was approved (2026-10-12, Phase-3 implementation branch):** the release app may declare `android.permission.ACCESS_COARSE_LOCATION` and `android.permission.ACCESS_FINE_LOCATION`, requested just in time **only** when the rider explicitly chooses "use current location"; the user may choose approximate; manual search/pin remains usable; denial/revocation has recovery UI; the driver readiness screen may only **read** the permission state — Phase 3 must **not** request background Driver location. Still forbidden in the Phase-3 release app: `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION` / any location foreground service for Driver mode, `POST_NOTIFICATIONS` (unless separately justified later), `USE_FULL_SCREEN_INTENT`, microphone, contacts and broad media/storage. SP-01 may use a **separate non-release spike build** for background-location experiments. Nothing else.

How to check the implementation against the approval:
1. Read `docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md` (when, why, denial and approximate-only behaviour) and `docs/phase3/PHASE3_SECURITY_COST_THREAT_MODEL.md` T3-34.
2. In the single Phase-3 PR, look at the diff of `infra/ci/android/permission-allowlist.json`. Check:
   - exactly two entries move from `forbidden` to `allowed`: `android.permission.ACCESS_COARSE_LOCATION` and `android.permission.ACCESS_FINE_LOCATION`;
   - each has a justification and requirement IDs (B01, B02, A07, V05, U05);
   - `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS` and `USE_FULL_SCREEN_INTENT` are **still forbidden**.
3. Look at the CI evidence in the PR: the release-AAB permission check output lists only INTERNET, the AndroidX dynamic-receiver permission, CAMERA, COARSE and FINE location.
4. Read the iOS usage text (`NSLocationWhenInUseUsageDescription`) and the in-app rationale copy in English (Urdu/Roman-Urdu go to FA-09).
5. Note for later (not Phase 3): from **2027-01-27** Google Play requires a location declaration and review for any app requesting location; FINE location is allowed only when COARSE cannot support the feature, so Wayvro's declaration must justify precise pickup (a driver must find the rider at the right gate/entrance). Play Console pre-review checks start **2026-10-27**, but they only matter once an AAB with location is uploaded to Play — there is no Play upload in Phase 3 (EG-18). Facts web-checked 2026-10-12.

No further approval text is needed; a diff that goes beyond the scope above is a defect to fix in the run, not a new approval request.

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
5. Terms to note (for the ADR-006 decision, not for you to resolve): temporary geocoding results may not be cached and may only be used with a Mapbox map; Mapbox mobile SDK telemetry requires an end-user opt-out; a Commercial Application License may apply to vehicle usage (FA-19, §8c); Search Box billing modes (sessions vs requests; introductory preview vs standard pricing) must not be conflated.
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

The repository is **private** (checked 2026-10-12), so GitHub Actions minutes are limited. Phase 0 recorded GitHub Free at 2,000 Actions minutes/month for private repositories; verify your plan in GitHub Settings → Billing. The existing `ci.yml` runs five jobs on every push/PR with no paths filter; the Android job alone takes ~30–40 minutes per run (75-minute timeout). A daily 60-minute nightly matrix (SP-08) would add ~1,800 minutes/month on its own, so **the proposed nightly cadence does not fit a 2,000-minute allowance**. **Decision (APPROVED 2026-10-12):** a bounded PR smoke tier (Maestro phase ≤ 15 min) on PRs touching mobile paths; the full cross-mode matrix on a **manual** workflow (`workflow_dispatch`), mandatory at Phase-3 final closure; **no** nightly/scheduled full matrix by default while the repository is private — a schedule may be added later only after observing Actions-minute cost; local emulator runs by Claude for daily development. Paid minutes and a self-hosted runner were not chosen.

How it is wired (built by Claude at P3.5/P3.10): a new short-named job (e.g. "Mobile E2E") in the existing CI workflow for the PR tier, building its own x86_64 emulator variant that never touches the gated release AAB (a release-purity check proves it); the full matrix in a **new manual (`workflow_dispatch`) workflow**. Making "Mobile E2E" a **required** check is a change to ruleset 24837051 that only you can make in GitHub Settings → Rules — keep the check name short, because required-check contexts are truncated at 100 characters (the Phase 2 closure recorded this for the Integration job). Until you change the ruleset, the job runs but does not block merges.

## 8a. FA-17 — Temporary HTTPS synthetic endpoint (SP-02 signed-in runs, SP-01 TC-01)

Why: the release app accepts only an `https` API origin outside development builds, and no staging host exists. Without an HTTPS endpoint, the signed-in SP-02 measurements (PB-01, PB-07, PB-09, PB-11, PB-12) and the runtime part of SP-01 TC-01 are **NOT RUN** (`docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md` §5.4, `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md` P-5).

**Decision (APPROVED IN PRINCIPLE 2026-10-12, SP-01/SP-02 only):** (a) an ephemeral, vetted tunnel from a publicly trusted HTTPS hostname to the local API runner, or (b) a later staging host. Conditions: **synthetic data only** (synthetic phone numbers through the local recording OTP sink, synthetic zones and rate cards) and no real customer data; expose only the minimum local synthetic API; tear the tunnel down after each session; verify the tunnel service's terms and security before use; no credentials, tokens or tunnel URL committed. Claude builds a local release AAB pointing at the session origin. If no acceptable free temporary option exists, the signed-in device measurements stay **BLOCKED** — TLS is never weakened and a cleartext release build is never produced.

## 8b. FA-18 — FCM/Firebase project (DEFERRED to Phase 4)

**Decision (2026-10-12): DEFERRED to Phase 4.** No Firebase project is created now. ADR-033 makes push a wake/alert aid only, so no freeze depends on it. The SP-01 TC-22 push-wake portion is reported **NOT RUN** in Phase 3 and push-wake measurement moves to Phase 4 (a dedicated Firebase project, separate from any production or OAuth project, config kept local and untracked).

## 8c. FA-19 — Mapbox Commercial Application License confirmation (NEW)

Mapbox's pricing page (https://www.mapbox.com/pricing, Licensing section, accessed 2026-10-12, no page date) states that a "Commercial Application License for vehicle, B2B, and internal business applications" is required "for vehicle usage (including ground, aerial, manned and unmanned vehicles)" and for "applications primarily intended for use within vehicles or use in any vehicle system or component thereof", and that it "consists of an annual subscription and, where applicable, a per-user or seat-based component."

- **Classification:** EXTERNAL — Mapbox commercial/legal confirmation. Claude does not decide whether it applies to Wayvro Rider/Driver use and does not invent a fee.
- **Required evidence:** written Mapbox sales/legal clarification before public pay-as-you-go pricing is treated as the complete production cost of S2.
- **What it blocks:** no pilot/production S2 (Mapbox) freeze while unresolved. It does **not** block implementation; SP-04 evaluation may still use a permitted evaluation/free Mapbox account under its terms.
- **Owner / timing:** founder (+ counsel); needed before P3.7 only if S2 is a freeze candidate. Any resulting licence cost is a separate FA-08 spend decision.

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
| Phase 0 E6 / D2 | staged devices; maps licence + field test | OPEN (FA-03..FA-06, FA-19) |

## 10. What Claude will NOT do

- Create, log into or configure any provider, store, cloud or billing account; accept any terms of service on the founder's behalf.
- Pay for, purchase, or approve any spend (devices, licences, minutes, provider usage).
- Drive, collect field ground truth, or handle the founder's GPS tracks beyond local analysis.
- Act as or sign for the native-language reviewer, accessibility tester, counsel, accountant or any approver; mark strings "reviewed" without the returned sheet.
- Receive, print, log, commit or repeat API keys or tokens; if one is pasted into chat, Claude will ask the founder to revoke it.
- Report any freeze, budget or threshold as PASS without real-device or field evidence; emulator results never close a real-device gate.
- Register an external URL scheme, App Link or universal link, or upload anything to Google Play or App Store Connect.
- Change the permission allowlist beyond the FA-02 approved scope (§2).
- Change the repository ruleset or required checks, or renew a security exception by silently moving its date.

## 11. Dated items during the Phase 3 run

| Date | Item | What happens | Who acts |
|---|---|---|---|
| 2026-10-27 | Google Play Console location pre-review checks start | no effect while no location-bearing AAB is uploaded to Play (none in Phase 3) | founder, later (EG-18) |
| 2026-12-31 | `osv-scanner.toml` exception for decode-uri-component (GHSA-vcc3-ghjq-m6fr) expires | the Security CI job fails from 2027-01-01 unless the dependency is upgraded or the exception is renewed with a fresh, true reachability justification in a reviewed change (after P3.0 removes the release scheme, "no external scheme" is true again) | Claude prepares the change; founder approves the renewal |
| 2027-01-09 | the four tooling exceptions in `osv-scanner.toml` expire | same rule: upgrade or reviewed renewal | Claude prepares; founder approves |
| 2027-01-27 | Play location declaration + review required for apps requesting location; FINE only if COARSE cannot support the feature | declaration text (precise pickup justification) is drafted in Phase 3; submission happens with the first Play upload (EG-18) | founder submits |
