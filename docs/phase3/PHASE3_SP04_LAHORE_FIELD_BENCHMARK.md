# PHASE3_SP04_LAHORE_FIELD_BENCHMARK — SP-04 Lahore geo quality and cost field benchmark protocol (PROPOSED)
**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — founder/ChatGPT plan review recorded 2026-10-12 (targeted fixes applied, `docs/phase3/PHASE3_PLAN.md` §11); no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

**SP-04 result status: NOT RUN.** No case has been captured, no provider has been called, no metric exists.

## 0. Purpose

SP-04 answers one question from the Phase-0 spike register (`docs/phase0/PHASE0_ADR_BACKLOG.md`): **which licence-coherent provider bundle, and which component per SKU inside it, is accurate enough in Lahore at a cost inside the FD-14 envelope?** It does this by comparing every admissible candidate against ground truth that the founder captures on Lahore roads, using identical inputs for every candidate.

| Item | Value |
|---|---|
| Decision fed | ADR-006 provider per SKU (OPEN-SPIKE → ACCEPTED-ON-EVIDENCE at P3.7) and ADR-046 renderer (coupled by CON-P3-16) |
| Requirement IDs | E06, E07, B01, B02, B03, A06, I11 (cost per case), Q26 (latency) |
| Scoring and gates | `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md` §12 (weights 40/20/20/10/10 and gates G1–G6 approved as pre-measurement values, FA-07; G4 includes the route-critical hard gate §7.1) |
| Capture sheet | `docs/phase3/PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv` (header + three EXAMPLE rows; contains no real data) |
| Founder actions | FA-05 field drives, FA-06 evaluation accounts/keys (no credentials committed), FA-08 any paid spend, FA-19 Mapbox commercial-licence confirmation before any S2 freeze; FA-07 thresholds APPROVED 2026-10-12 |
| Earliest start | after P3.2 (harness + capture tooling exist). Field capture itself can start as soon as this protocol is approved, because it needs only a phone, a car and the sheet |

## 1. Candidates (bundles, from the evaluation doc §6)

| Bundle | Components evaluated | Admissible now? |
|---|---|---|
| S1 Google | Places Autocomplete + Place Details, Geocoding (forward + reverse), Routes | yes, if FA-06 Google account exists |
| S2 Mapbox | Search Box and temporary Geocoding (both compared for autocomplete), Geocoding reverse, Directions | yes, if FA-06 Mapbox account exists |
| S3 Open | Photon (autocomplete, forward, reverse), Nominatim self-hosted (forward/reverse, comparison only), OSRM and Valhalla (routing) — all in the optional `geo-bench` compose profile on a Pakistan extract | yes (no account needed) |
| S4 / S4c | TomTom or HERE search/geocode/routing; Google search + OSRM routing | **only if terms verified in writing**; otherwise not run (SKIPPED with reason) |

Tiles/rendering are not scored by field cases (a renderer does not change geocode or route accuracy); renderer evidence comes from SP-02 (size, memory, jank) and a short visual legibility check of the 10 C04/C09 places on each bundle's style (founder rates "landmark label visible at zoom 16–17": yes/no).

## 2. Case design

### 2.1 Case kinds

| Kind | What it tests | Ground truth captured |
|---|---|---|
| POINT | autocomplete, place resolution, forward geocode, reverse geocode | true pickup point (5 dp, GPS accuracy), correct place name, correct pickup instruction, expected reverse-geocode area/landmark, query texts in English, Roman Urdu, Urdu script |
| ROUTE | directions distance, ETA, route plausibility, constraint compliance | origin and destination POINT case ids, GPX track, odometer distance, actual minutes, traffic level, constraint notes |

Every ROUTE case starts and ends at POINT cases that are **public places**. Sessions are planned as chains of legs between public points so each leg is a ROUTE case.

### 2.2 Categories and minimum counts

At least **50** cases, target **60** (to allow discards). Counts below are cases of the category's primary kind; ROUTE legs between POINT cases are counted in §2.3.

| Code | Category | Primary kind | Min | Target | Examples of the pattern (illustrative; the founder picks the actual public places) |
|---|---|---|---|---|---|
| C01 | Dense urban streets | POINT | 5 | 6 | old-city lanes, Anarkali-type bazaar streets with shop-name addressing |
| C02 | Gated societies (gates and internal public roads) | POINT | 5 | 6 | DHA phases, Bahria Town, Johar Town blocks — only where public/visitor access is lawful |
| C03 | Society plot-format addresses | POINT | 5 | 5 | text in the form "Plot N, Block X, Phase Y" as typed by riders; **the true point is a public spot (e.g. block park, block market, mosque) — never a residence** (§4.1) |
| C04 | Commercial landmarks | POINT | 4 | 5 | Liberty Market type, MM Alam Road type, malls |
| C05 | Hospitals and universities | POINT | 4 | 5 | true point = the public pickup gate/entrance riders use |
| C06 | Underpasses and flyovers | ROUTE | 3 | 4 | legs that pass through or must avoid an underpass/flyover level |
| C07 | Service roads / parallel roads | ROUTE (+ reverse at end point) | 4 | 4 | destinations on a service road beside a main road; checks the route reaches the correct carriageway |
| C08 | Ambiguous road names | POINT | 4 | 5 | multiple "Main Boulevard"s, "Canal Road" spans, same block letters in different societies |
| C09 | Pickup landmarks (gates, chowks) | POINT | 5 | 6 | society main gates, named chowks, bus-stop landmarks |
| C10 | Difficult reverse-geocode points | POINT (reverse) | 4 | 5 | society interiors, canal-road stretches with no frontage, park edges |
| C11 | Airport-relevant routes | ROUTE | 3 | 4 | Allama Iqbal International Airport terminal access on lawful public roads only (§4.1) |
| C12 | Route deviation / U-turn constraints | ROUTE | 4 | 5 | canal-road U-turn points, one-way segments, no-right-turn junctions observed on the drive |
| | **Total** | | **50** | **60** | |

### 2.3 Cross-category minimums

| Dimension | Minimum |
|---|---|
| ROUTE legs in total (C06/C07/C11/C12 plus legs between POINT cases) | ≥ 20, of which ≥ 6 driven in a weekday peak hour (informational ETA) and ≥ 14 off-peak (gating ETA) |
| POINT cases with a Roman-Urdu query variant | every POINT case where a rider would plausibly type Roman Urdu; minimum 35 |
| POINT cases with an Urdu-script query variant | minimum 20 (blank allowed where the founder is unsure of spelling; never machine-translated) |
| POINT cases with a reverse-geocode expectation | all POINT cases |
| Plot-format queries (C03) typed exactly as a rider would (abbreviations such as "blk", "ph") | ≥ 5 |
| Short-prefix autocomplete tests (3, 5, 8 characters + full) | all POINT cases (generated by the harness from the full query) |

### 2.4 Case-ID scheme and case definition fields

- Case id: `LHR-SP04-001` … `LHR-SP04-099` (three digits; numbering in capture order; never reused; discarded cases keep their id with status DISCARDED and a reason).
- Session id: `LHR-SP04-S1` … `LHR-SP04-S9`.
- Case list version: `LHR-SP04-CASES-v1` (frozen when the last session ends; later re-runs use the same version, §10).

| Field | Kind | Rule |
|---|---|---|
| case_id | both | `LHR-SP04-NNN` |
| case_kind | both | POINT / ROUTE |
| category | both | C01…C12 |
| session_id | both | `LHR-SP04-Sn` |
| date, time_local | both | Asia/Karachi local; ROUTE = departure time |
| traffic_level | ROUTE | FREE / MODERATE / HEAVY / STOP_GO (founder judgement: FREE = posted speed mostly possible; MODERATE = some slowing; HEAVY = mostly below 20 km/h; STOP_GO = repeated full stops) |
| query_text_en, query_text_roman_urdu, query_text_urdu | POINT | as a rider would type, including real-world misspellings; no personal names or phone numbers |
| true_place_name | POINT | public place name as locals say it |
| true_point_lat_5dp, true_point_lng_5dp | POINT | WGS84, 5 decimals (~1 m), from the logger at the true pickup spot — **working sheet only, never committed** (§8) |
| gps_accuracy_m | POINT | logger's reported accuracy when the point was taken; retake if > 10 m |
| is_public_place | POINT | must be Y; a N row is invalid and deleted |
| pickup_instruction_text | POINT | the instruction a local would give a driver (e.g. "gate 2, opposite the petrol pump") |
| reverse_geocode_expected_area | POINT | what a useful reverse-geocode answer must mention (landmark and/or block/society/area) |
| route_origin_case_id, route_dest_case_id | ROUTE | POINT case ids |
| odometer_km | ROUTE | car trip meter, 1 decimal, reset at origin |
| actual_drive_minutes | ROUTE | door-to-door minutes from logger timestamps |
| followed_natural_route | ROUTE | Y if driven the way a local driver normally would; N + note if diverted (closure, wrong turn) |
| constraint_observed | ROUTE | e.g. NO_UTURN_AT_<landmark>, ONE_WAY, NO_RIGHT_TURN, UNDERPASS_REQUIRED, SERVICE_ROAD_ONLY |
| gpx_file_ref | both | file name on the founder's device; file never committed |
| photo_ref_local | POINT | local file name of the place photo; never committed |
| notes_no_pii | both | free text without names, phone numbers, plates, faces or private addresses |
| captured_by | both | role code FOUNDER or PASSENGER_HELPER (no names) |
| case_status | both | CAPTURED / DISCARDED (+ reason) |

## 3. Session plan

| Session | Time window | Content | Duration |
|---|---|---|---|
| S1 | weekday daylight off-peak (e.g. late morning) | C04, C05, C09 POINT cases + legs between them | 2–3 h |
| S2 | weekday daylight off-peak | C02, C03, C10 (society gates, block markets, interiors with lawful access) + legs | 2–3 h |
| S3 | weekday daylight off-peak | C01, C06, C07, C08, C12 route-centric legs | 2–3 h |
| S4 | **one weekday peak-hour session** (e.g. evening peak) | repeat ≥ 6 legs from S1–S3 + C11 airport access legs | 2 h |
| S5 (optional) | daylight | replacements for discarded cases | as needed |

All sessions in daylight. No session during severe smog-visibility advisories, rain flooding or public-order restrictions. The founder may split or reorder sessions; the per-category minimums are what matter.

Founder time estimate (estimate only; same figure as FA-05 in `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md`): 4 sessions — S1–S3 at 2–3 h each plus S4 at about 2 h — ≈ 8–11 h in the field (+ optional S5), plus ≈ 2–3 h desk work (pre-filling cases, after-session checks, blind reverse-geocode rating).

## 4. Founder field-test instructions (exact)

### 4.1 Safety, legality and privacy first

1. **The driver never touches the phone while the car is moving.** Either a passenger operates the phone and the sheet, or the GPS logger is started before moving and only touched again after parking. No typing, photographing or reading while driving.
2. Drive lawfully: obey speed limits, signals, one-ways and U-turn rules. A ROUTE case is never "tested" by making an illegal or unsafe manoeuvre; observe constraints, never violate them.
3. Park only where parking is lawful; stop the engine before stepping out to take a point.
4. Daylight sessions plus one peak-hour session only. Abort the session if traffic, weather, smog visibility or the situation feels unsafe; a missing case is fine, a risk is not.
5. Gated societies: use only roads and gates where visitors are lawfully allowed; follow security staff instructions; never argue entry. If access is refused, record the **gate** as the case point instead.
6. Airport (C11): public approach roads, the public drop-off/pick-up curb and public parking only. No restricted areas, no stopping where prohibited, **no photographs of security installations, checkpoints or staff**.
7. Cantonment and other security areas: no photographs of security installations, guards or checkpoints anywhere; if in doubt, no photo.
8. **No private homes.** Never use a residence (including the founder's or friends' homes) as a case point, route origin or destination. Start the GPS logger **after** leaving the home neighbourhood and stop it before returning, so no track reveals a home.
9. Photos: of the public spot only — no faces, no number plates, no house numbers of private homes, no documents. Photos stay on the founder's device and are never committed or shared.
10. No personal data in the sheet: no names, phone numbers, plates or private addresses in any column.

### 4.2 Equipment

| Item | Requirement |
|---|---|
| Android phone | location set to high accuracy; charged; mounted; data connection on |
| GPS logger app (category, no specific app endorsed) | an offline-capable GPS track logger that exports **GPX with per-point timestamps**, shows current accuracy in metres, can drop named waypoints, and does **not** require an account or cloud upload (cloud sync off if present) |
| Car trip meter | reset at each leg origin |
| Capture sheet | the CSV template (open in any spreadsheet app on a second device, or printed and transcribed the same day) |
| Power bank, cable | logger runs 2–3 h |
| Optional helper | a passenger to operate phone and sheet (captured_by = PASSENGER_HELPER) |

### 4.3 Before each session

1. Copy the template to a **private working file outside the repository** (e.g. a folder in the founder's documents), one file per session or one cumulative file.
2. Plan the chain of public points for the session; pre-fill case ids, categories, true place names and query texts (en, Roman Urdu, Urdu) while parked or at home — never while driving.
3. Note the session's date and planned time window; set traffic_level per leg during the drive by the helper, or immediately after parking.

### 4.4 Per POINT case

1. Park lawfully near the place; walk to the **true pickup spot** — where a rider would actually stand and a driver could actually stop (gate, curb, chowk corner).
2. Wait until the logger reports accuracy ≤ 10 m (about 30 s in open sky); drop a named waypoint `LHR-SP04-NNN`.
3. Record true_point_lat_5dp / true_point_lng_5dp and gps_accuracy_m from the waypoint into the working sheet.
4. Take one photo of the spot (no people, plates, homes); record photo_ref_local.
5. Write pickup_instruction_text exactly as you would tell a driver, and reverse_geocode_expected_area (what a useful address must mention).
6. Confirm the three query texts are what a rider would type for this place (keep real abbreviations and common misspellings).
7. Set is_public_place = Y, case_status = CAPTURED, captured_by.

### 4.5 Per ROUTE case (leg)

1. At the origin POINT, reset the trip meter and confirm the logger is recording; note time_local (departure).
2. Drive the way a local driver normally would; the helper (if present) notes traffic_level, any closures, diversions, U-turns taken, one-way segments and underpass/flyover choices.
3. At the destination POINT, park lawfully; record odometer_km (1 decimal), actual_drive_minutes, followed_natural_route (Y/N), constraint_observed, gpx_file_ref (the track file or segment name).
4. If the route was diverted for an unusual reason (accident, protest, closure), mark followed_natural_route = N with a note; the leg is kept but excluded from the gating distance/ETA metric.

### 4.6 After each session

1. Export the GPX track(s); keep them on the founder's device/private storage only.
2. Check every row: no PII, is_public_place = Y, coordinates present for POINT cases.
3. Hand Claude **the working CSV (privately, locally)** for the harness run. The GPX files are used locally by the harness for distance cross-checks only when the founder runs it or places them in the local untracked input folder.

## 5. Desk steps (Claude, after FA-05/FA-06)

1. Founder places keys for admissible vendors in a local untracked env file (never committed, never pasted into chat or prompts) and sets vendor-console hard quotas ≈ free tier (FA-06).
2. Start the optional `geo-bench` compose profile (OSRM, Valhalla, Photon, Nominatim on the Pakistan extract; extract date recorded) — benchmark only, not the default stack (CON-P3-14).
3. Run the proposed harness CLI (`tools/geo-bench`, server-side, dev-only) against the working CSV. For every case and every admissible candidate it issues identical requests through the **same adapters and normalisation** the API will use (so the benchmark measures what production would see): autocomplete on prefixes of 3/5/8 characters and the full query for each language variant, place resolution of each suggestion in the top 5, forward geocode of the full query, reverse geocode of the true point (≤ 5 dp), and a route for each ROUTE leg (car profile; for traffic-capable vendors with departure time set to the next same weekday and local time as the drive).
4. Raw responses are written only to a gitignored local output folder; the harness computes metrics (§6) into an aggregated per-case/per-candidate table and prints cost per case from the dated adapter price table.
5. **Blind rating:** the harness exports reverse-geocode answers with candidate labels replaced by random letters per case; the founder rates usefulness 0–3 (§6) without knowing the vendor; Claude un-blinds after rating.
6. Claude computes per-bundle scores (evaluation doc §12), runs the paired comparison (§9), and drafts the evidence record and ADR-006 recommendation for founder review.
7. Raw responses are deleted after the analysis and within 30 days of capture at the latest (the strictest V caching term seen: Google lat/lng 30 days); the deletion is recorded.

## 6. Metrics definitions and formulas

Distances use the haversine formula with mean Earth radius R = 6,371,008.8 m:
`d = 2R · asin( sqrt( sin²((φ2 − φ1)/2) + cos φ1 · cos φ2 · sin²((λ2 − λ1)/2) ) )`, φ = latitude, λ = longitude in radians.

| Metric | Applies to | Definition |
|---|---|---|
| Geocode error distance | POINT, forward geocode | d(result coordinate, true point) in metres for result rank 1, 2, 3 |
| Top-1 hit | POINT | 1 if d(rank-1, truth) ≤ 50 m, else 0; rate = hits / POINT cases attempted |
| Top-3 hit | POINT | 1 if any of ranks 1–3 within 50 m |
| Autocomplete rank | POINT, each language variant | position (1-based) of the first suggestion whose resolved coordinate is within 50 m of truth, on the full query; "not found" if absent from top 5 |
| Autocomplete top-5 hit | POINT | 1 if rank ≤ 5; reported overall and per language (en / Roman Urdu / Urdu) |
| Keystrokes to hit | POINT | shortest tested prefix (3/5/8/full) at which the correct place appears in top 5 (informational) |
| Reverse-geocode usefulness (0–3, founder-rated, blind) | POINT | 0 = wrong area or useless (city only, code only); 1 = correct area/society only; 2 = correct block/street or a nearby landmark a driver could use with one phone call; 3 = landmark/building-level, a driver could find the pickup unaided. "Useful" = score ≥ 2 |
| Urdu-script handling | POINT with Urdu variant | 1 if an Urdu-script query returns the correct place in top 5 or a result displayable in Urdu script; informational sub-metric for the coverage criterion |
| Route distance error % | ROUTE with followed_natural_route = Y | `|D_provider − D_true| / D_true × 100`, where D_true = GPX track length (sum of haversine segments after dropping points with accuracy > 25 m), cross-checked with odometer; if GPX and odometer differ by > 5 %, the leg is flagged and reported separately |
| Route corridor overlap | ROUTE | share of provider polyline vertices within 30 m of the GPX track (detects a plausible but different route; informational) |
| ETA error % | ROUTE | `(T_provider − T_actual) / T_actual × 100`; signed median = bias; absolute median and p90 = accuracy; **off-peak legs gate**, peak legs reported separately (informational) |
| Constraint plausibility | C06/C07/C11/C12 ROUTE | 1 if the provider route respects every constraint_observed (no illegal U-turn, no wrong-way one-way, correct carriageway/level), else 0 — judged by Claude from geometry vs notes, confirmed by founder |
| Latency p50 / p95 | each SKU per candidate | wall-clock request time measured by the harness from the founder's Lahore connection (≥ 3 repeats per request, cold cache); production-region latency is re-measured when hosting exists |
| Failure / empty rate | each SKU per candidate | (errors + timeouts + empty results) / requests; timeouts per the plan budgets (autocomplete 1.5 s, geocode 2.0 s, reverse 2.0 s, directions 2.5 s) |
| Cost per case | each candidate | Σ (billable calls × dated unit price) beyond free tier at modelled pilot volume, and modelled cost per 1,000 quotes (evaluation doc §7) |

## 7. Thresholds (APPROVED 2026-10-12 as pre-measurement thresholds, FA-07)

The Phase-0 backlog says thresholds are "set by founder"; the founder/ChatGPT plan review approved the values below as the **pre-measurement** thresholds, together with the route-critical hard gate in §7.1. They change only through explicit evidence and a reviewed ADR update — never after seeing measurements in order to obtain a PASS.

| Metric | Gating threshold | Scoring floor → target (for normalisation) |
|---|---|---|
| Geocode top-1 within 50 m (address/place cases) | ≥ 80 % | 50 % → 90 % |
| Geocode top-3 within 50 m | ≥ 90 % | 60 % → 97 % |
| Reverse geocode useful (score ≥ 2) | ≥ 80 % | 40 % → 90 % |
| Route distance error | median ≤ 10 %, p90 ≤ 20 % | median 25 % → 3 % |
| ETA error vs off-peak drive | absolute median ≤ 20 % (peak informational) | 40 % → 8 % |
| Autocomplete correct place in top 5, incl. Roman-Urdu | ≥ 85 % overall and reported per language | 50 % → 95 % |
| Constraint plausibility (C06/C07/C11/C12) | **minor** suboptimal routes are scored, not automatic failures; any **CRITICAL** route invalidity is a hard gate (§7.1) | 50 % → 100 % (minor only) |
| Latency p95 | ≤ performance budgets (`docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md`: autocomplete 450 ms, reverse 500 ms, quote incl. provider 800 ms server-side; harness latency from Lahore is indicative) | budget × 2 → budget × 0.5 |
| Failure/empty rate | ≤ 5 % per SKU | 20 % → 1 % |
| Cost | pilot ESTIMATE within the FD-14 envelope unless FA-08 (gate G2), stated with its explicit billing mode (Google PAYG vs subscription; Mapbox Search Box sessions vs requests, standard vs preview) and, for S2, any Commercial Application License (FA-19) | per evaluation doc §12 |

A candidate that misses a quantitative gating threshold is reported as such; it may still be selected only with a founder-signed acceptance of the shortfall and named mitigations (aliases, pin-first UX), recorded in the ADR. That acceptance route does **not** apply to a critical route invalidity (§7.1).

### 7.1 Route-critical hard gate (FA-07 addition, 2026-10-12)

For ride-hailing a severely invalid route is a safety defect, not a quality score. Every ROUTE case is classified by Claude from the provider geometry against the founder's ground truth (GPX track, notes, photos of signage where lawful) as **NONE**, **MINOR** (suboptimal but lawful and drivable: longer, slower, an avoidable U-turn) or **CRITICAL**:

| CRITICAL class | Example |
|---|---|
| Wrong-way travel | route traverses a one-way road against its direction |
| Impossible, private or inaccessible segment used as normal routing | through a gated society interior, private driveway or footpath not open to the trip |
| Prohibited or closed passage | closed road, barrier, restricted access, turn ban |
| Unsafe or physically impossible manoeuvre | crossing a median, U-turn where none exists, dropping onto a flyover/underpass without a connection |
| Systematic severe defect | the same severe error class recurring across cases (e.g. a whole corridor mis-modelled) |

Rules:
- A bundle with **any unresolved CRITICAL** case is **not eligible for freeze** (evaluation doc gate G4), whatever its weighted score; a high score never offsets it.
- A CRITICAL case is cleared **only** by (a) confirming the ground truth was wrong (re-check on site, recorded); (b) an evidence-backed provider/configuration/map-data correction followed by a re-run of the affected cases; or (c) a founder-signed, documented product mitigation proving that the route will not be presented or used (for example the leg is excluded from routing by a zone rule), recorded in the ADR.
- MINOR cases stay in the constraint-plausibility score.
- The classification, evidence and clearing action of every CRITICAL case are listed in the SP-04 evidence table (§11); raw provider geometry is not committed (§8).

## 8. Data handling

| Data | Where it lives | Committed? |
|---|---|---|
| Raw provider responses | harness local gitignored output folder | **never** (vendor terms; deleted ≤ 30 days, §5.7) |
| Working capture CSV with 5-dp coordinates | founder's private storage; local untracked harness input | **never** |
| GPX tracks | founder's device/private storage | **never** |
| Photos | founder's device | **never** |
| API keys | local untracked env file | **never** (gitleaks covers the repo) |
| Aggregated per-case metrics (errors in metres, hit flags, ranks, % errors, rubric scores, latency, cost) | future SP-04 evidence record in `docs/phase3/` (proposed, created at P3.7) | yes |
| Coordinates in committed evidence | only for **public places**, rounded to **3 decimals** (~110 m), only where needed to identify the case (e.g. airport curb); C03 plot-format cases never carry coordinates | yes, minimal |
| Query texts | committed only if they contain no personal data; plot-format queries are committed with plot numbers replaced by "N" | yes, sanitised |

The template file in the repository contains only a header and EXAMPLE rows with placeholder values; it must never be overwritten with real captures.

## 9. Sample-size caveats

- With ~50 POINT-type observations, a measured hit rate of 80 % has a 95 % Wilson interval of about **67 %–89 %** (±11 points). Differences between candidates smaller than ~10–15 points are not distinguishable from noise by independent comparison.
- Because every candidate is run on **the same cases**, compare candidates with a paired test: McNemar's test on discordant pairs for binary metrics (top-1, top-5, useful), and the Wilcoxon signed-rank test for paired continuous errors (distance %, ETA %). A difference that is not significant at α = 0.05 is reported as a tie and decided by cost and terms/ops risk (evaluation doc §12.2).
- Per-category counts (3–6) are indicative only; category results are used to find failure modes (e.g. C03 plot addresses), not to rank candidates.
- Peak-hour legs (≥ 6) are too few for a gating statistic; they are informational.
- One city, one season, one founder: results do not generalise to other cities or to monsoon conditions; vendor data can change after the test (§10).

## 10. Repeatability and regression

- The case list `LHR-SP04-CASES-v1` and the harness configuration (candidate adapters, request parameters, price table date, extract date) are versioned together.
- Re-runs use the same case list without new field drives (ground truth reused): before any vendor or bundle change, after each open-stack extract update (subset of ≥ 20 cases), and at least once before pilot (Phase 7).
- A regression is a drop of > 5 percentage points in any gating hit-rate metric or > 3 points in median distance/ETA error versus the frozen baseline; it opens a review, not an automatic switch.
- New cases may be added as `LHR-SP04-CASES-v2`; v1 results remain comparable.

## 11. Deliverables of SP-04 (at P3.7)

1. Evidence table: per case × candidate aggregated metrics (no raw responses), per-category summaries, per-language autocomplete results.
2. Per-bundle score with gates G1–G6 shown pass/fail and every CRITICAL route case with its classification evidence and clearing action (§7.1), paired-test results, cost ESTIMATE re-run with prices re-verified on the freeze date.
3. ADR-006 recommendation (bundle + per-SKU components, terms-derived cache TTLs, attribution duties, residual risks and mitigations) for founder approval; the future ADR-006 file is written as ACCEPTED-ON-EVIDENCE only after that approval.
4. Seed list of founder/field-sourced landmark aliases (`geo.landmark_aliases`, source FIELD) for places where every candidate failed.
5. Updated SDK inventory rows for the chosen renderer/tile host (`docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md`).

## 12. Status and blockers

| Item | Status |
|---|---|
| Protocol | APPROVED with the plan (FA-01, FA-07 on 2026-10-12); execution needs FA-05/FA-06 |
| Field capture | NOT RUN — needs FA-05 |
| Vendor comparison (S1/S2) | NOT RUN — needs FA-06 |
| Open-stack comparison (S3) | NOT RUN — needs P3.2 harness + `geo-bench` profile |
| S4/S4c | NOT RUN — SKIPPED unless terms verified |
| ADR-006 freeze | BLOCKED-EXTERNAL until the above exist |
